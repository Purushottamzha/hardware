"""SafeRide face-service: lightweight native face enrollment + matching.

Runs as a PLAIN Python venv on the Windows host (NOT in Docker / WSL).
Start it with:

    face-service\\run_native.bat
    # or:
    native-venv\\Scripts\\uvicorn app.main:app --host 127.0.0.1 --port 5001

Contracts (this is what the friend's real face API must replicate):

POST /enroll
    multipart:  photo   (file, jpeg/png)
    form:       studentId (optional for /match flow, but enables storing)
    -> { "faceDetected": bool, "embedding": [float, ...] | null,
         "studentId": str|null, "stored": bool, "processingTime": int }
    Computes a face embedding. When studentId is given it is APPENDED to that
    student's reference set (multiple reference images supported and averaged
    at match time for a more robust comparison).

GET /list-students
    -> { "students": [{ "studentId": str, "referenceCount": int, "createdAt": str }] }

DELETE /delete-student?studentId=...
    -> { "deleted": bool, "studentId": str }

POST /match
    multipart:  photo  (file, jpeg/png)
    -> { "studentId": str|null, "confidence": float, "processingTime": int }
    Compares the given face against the ENROLLMENT STORE (via /enroll).
    A student is scored by the BEST cosine similarity across all of their
    reference images. Confidence is cosine similarity of normalized MediaPipe
    478-landmark embeddings (range roughly -1..1, same-person > 0.98,
    stranger < 0.7).

POST /identify
    multipart:  photo (file); optional form candidateEmbeddings = JSON array
    -> { "studentId": str|null, "confidence": float, "processingTime": int }
    Uses the ENROLLMENT STORE by default. If candidateEmbeddings is provided
    it is used instead (stateless, backward compatible with the old NestJS
    pipeline). Returned record also includes "processingTime" and averaged
    "embedding" per student.

GET /health
    -> { "status": "ok" }

Backend must reach this service from inside Docker via:
    FACE_SERVICE_URL=http://host.docker.internal:5001
"""

import json
import logging
import threading
import time
from contextlib import asynccontextmanager
from pathlib import Path

import anyio
import numpy as np
from fastapi import FastAPI, File, Form, UploadFile

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("face-service")

BASE_DIR = Path(__file__).resolve().parent.parent
MODEL_PATH = BASE_DIR / "models" / "face_landmarker.task"
ENROLLMENTS_PATH = BASE_DIR / "enrollments.json"

# Memory-only store for /match and /identify. Persisted to enrollments.json
# on change so a service restart does not wipe enrollments. A record is:
#   studentId -> {"embeddings": [[float,...], ...], "createdAt": str}
_store_lock = threading.Lock()
_store = {}  # studentId -> {"embeddings": [...], "createdAt": ...}

_LANDMARKER = None
_landmarker_lock = threading.Lock()


def load_store():
    global _store
    if ENROLLMENTS_PATH.exists():
        try:
            raw = json.loads(ENROLLMENTS_PATH.read_text(encoding="utf-8"))
            _store = {}
            for sid, rec in raw.items():
                if isinstance(rec, dict) and isinstance(rec.get("embeddings"), list):
                    _store[sid] = rec
                elif isinstance(rec, dict) and isinstance(rec.get("embedding"), list):
                    # legacy single-embedding record -> upgrade to list format
                    _store[sid] = {
                        "embeddings": [rec["embedding"]],
                        "createdAt": rec.get("createdAt"),
                    }
        except Exception as e:
            logger.warning(f"could not load enrollments.json: {e}")
            _store = {}


def save_store():
    try:
        ENROLLMENTS_PATH.write_text(
            json.dumps(_store), encoding="utf-8"
        )
    except Exception as e:
        logger.error(f"could not persist enrollments.json: {e}")


def get_landmarker():
    """Lazy single FaceLandmarker instance (thread-safe)."""
    with _landmarker_lock:
        global _LANDMARKER
        if _LANDMARKER is None:
            from mediapipe.tasks import python as mpp
            from mediapipe.tasks.python import vision

            if not MODEL_PATH.exists():
                raise FileNotFoundError(
                    f"model not found: {MODEL_PATH}. Download it into face-service/models/"
                )
            opts = vision.FaceLandmarkerOptions(
                base_options=mpp.BaseOptions(model_asset_path=str(MODEL_PATH)),
                running_mode=vision.RunningMode.IMAGE,
                num_faces=1,
                min_face_detection_confidence=0.3,
                min_face_presence_confidence=0.3,
                min_tracking_confidence=0.3,
            )
            _LANDMARKER = vision.FaceLandmarker.create_from_options(opts)
        return _LANDMARKER


def represent_simple(data: bytes):
    """Same as represent() but using cv2.imdecode -> bytes buffer (no temp file)."""
    import mediapipe as mp
    import cv2

    buf = np.frombuffer(data, np.uint8)
    bgr = cv2.imdecode(buf, cv2.IMREAD_COLOR)
    if bgr is None:
        return None
    rgb = cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)
    mpi = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)
    res = get_landmarker().detect(mpi)
    if not res.face_landmarks:
        return None
    return extract_embedding(res.face_landmarks[0])


def extract_embedding(lms):
    pts = np.array([[p.x, p.y, p.z] for p in lms], dtype=np.float64)
    dist = np.linalg.norm(pts[263] - pts[33])
    if dist < 1e-6:
        return None
    return ((pts - pts[1]) / dist).flatten()


def cosine_similarity(a, b):
    a = np.asarray(a, dtype=np.float64)
    b = np.asarray(b, dtype=np.float64)
    denom = np.linalg.norm(a) * np.linalg.norm(b)
    if denom == 0:
        return 0.0
    return float(np.dot(a, b) / denom)


@asynccontextmanager
async def lifespan(app: FastAPI):
    load_store()
    yield
    logger.info("face-service shutting down")


app = FastAPI(title="SafeRide Face Service (native)", lifespan=lifespan)


def best_score(embedding, rec):
    """Best cosine similarity against every reference embedding for a student."""
    embs = [np.asarray(e, dtype=np.float64) for e in (rec.get("embeddings") or []) if e]
    if not embs:
        return -1.0
    best = -1.0
    for e in embs:
        s = cosine_similarity(embedding, e)
        if s > best:
            best = s
    return best


@app.get("/health")
async def health():
    return {"status": "ok"}


@app.post("/enroll")
async def enroll_svc(
    photo: UploadFile = File(...),
    studentId: str = Form(None),
):
    t0 = time.time()
    data = await photo.read()
    try:
        embedding = await anyio.to_thread.run_sync(represent_simple, data)
    except Exception as e:
        logger.warning(f"enroll failed: {e}")
        embedding = None

    if embedding is None:
        return {
            "faceDetected": False,
            "embedding": None,
            "studentId": studentId,
            "stored": False,
            "processingTime": int((time.time() - t0) * 1000),
        }

    stored = False
    if studentId:
        with _store_lock:
            rec = _store.get(studentId)
            if rec and isinstance(rec.get("embeddings"), list):
                rec["embeddings"].append(embedding.tolist())
            else:
                _store[studentId] = {
                    "embeddings": [embedding.tolist()],
                    "createdAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                }
            save_store()
        stored = True

    return {
        "faceDetected": True,
        "embedding": embedding.tolist(),
        "studentId": studentId,
        "stored": stored,
        "processingTime": int((time.time() - t0) * 1000),
    }


@app.get("/list-students")
async def list_students():
    with _store_lock:
        students = [
            {
                "studentId": sid,
                "referenceCount": len(rec.get("embeddings") or []),
                "createdAt": rec.get("createdAt"),
            }
            for sid, rec in _store.items()
        ]
    return {"students": students}


@app.delete("/delete-student")
async def delete_student(studentId: str = Form(...)):
    with _store_lock:
        existed = studentId in _store
        if existed:
            del _store[studentId]
            save_store()
    return {"deleted": existed, "studentId": studentId}


@app.post("/match")
async def match(photo: UploadFile = File(...)):
    t0 = time.time()
    data = await photo.read()
    try:
        embedding = await anyio.to_thread.run_sync(represent_simple, data)
    except Exception as e:
        logger.warning(f"match failed: {e}")
        embedding = None

    if embedding is None:
        return {"studentId": None, "confidence": 0.0, "processingTime": int((time.time() - t0) * 1000)}

    with _store_lock:
        candidates = list(_store.items())

    if not candidates:
        return {"studentId": None, "confidence": 0.0, "processingTime": int((time.time() - t0) * 1000)}

    best = None
    best_score_val = -1.0
    for sid, rec in candidates:
        try:
            score = best_score(embedding, rec)
        except Exception:
            continue
        if score > best_score_val:
            best_score_val = score
            best = sid

    return {
        "studentId": best,
        "confidence": best_score_val,
        "processingTime": int((time.time() - t0) * 1000),
    }


@app.post("/identify")
async def identify(
    photo: UploadFile = File(...),
    candidateEmbeddings: str = Form(None),
):
    """Identify against the enrollment store; optional stateless candidate list."""
    t0 = time.time()
    data = await photo.read()
    try:
        embedding = await anyio.to_thread.run_sync(represent_simple, data)
    except Exception as e:
        logger.warning(f"identify failed: {e}")
        embedding = None

    if embedding is None:
        return {"studentId": None, "confidence": 0.0, "processingTime": int((time.time() - t0) * 1000)}

    if candidateEmbeddings:
        try:
            candidates = json.loads(candidateEmbeddings)
        except json.JSONDecodeError:
            candidates = None
        if isinstance(candidates, list) and candidates:
            best_student_id = None
            best_score_val = -1.0
            for cand in candidates:
                try:
                    score = cosine_similarity(embedding, np.asarray(cand["embedding"], dtype=np.float64))
                except (KeyError, TypeError, ValueError):
                    continue
                if score > best_score_val:
                    best_score_val = score
                    best_student_id = cand["studentId"]
            return {
                "studentId": best_student_id,
                "confidence": best_score_val,
                "processingTime": int((time.time() - t0) * 1000),
            }

    with _store_lock:
        candidates = list(_store.items())
    if not candidates:
        return {"studentId": None, "confidence": 0.0, "processingTime": int((time.time() - t0) * 1000)}

    best = None
    best_score_val = -1.0
    for sid, rec in candidates:
        try:
            score = best_score(embedding, rec)
        except Exception:
            continue
        if score > best_score_val:
            best_score_val = score
            best = sid

    return {
        "studentId": best,
        "confidence": best_score_val,
        "processingTime": int((time.time() - t0) * 1000),
    }