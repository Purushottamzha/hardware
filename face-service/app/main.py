"""SafeRide face-service: stateless face embedding / identification.

Stateless by design: never touches Postgres. It receives a photo (and, for
/identify, candidate embeddings in the request body) and returns either a
computed embedding (/enroll) or the best-matching candidate (/identify).
All vector math happens here; the NestJS backend stores the embeddings.
"""

import json
import logging
import threading
from contextlib import asynccontextmanager

import anyio
import cv2
import numpy as np
from fastapi import FastAPI, File, Form, UploadFile

logger = logging.getLogger("face-service")

MODEL_NAME = "ArcFace"
DETECTOR_BACKEND = "retinaface"


def load_image(data: bytes):
    arr = np.frombuffer(data, np.uint8)
    return cv2.imdecode(arr, cv2.IMREAD_COLOR)


def cosine_similarity(a, b):
    a = np.asarray(a, dtype=np.float64)
    b = np.asarray(b, dtype=np.float64)
    denom = np.linalg.norm(a) * np.linalg.norm(b)
    if denom == 0:
        return 0.0
    return float(np.dot(a, b) / denom)


def represent(data: bytes):
    from deepface import DeepFace

    img = load_image(data)
    if img is None:
        return None
    results = DeepFace.represent(
        img_path=img,
        model_name=MODEL_NAME,
        detector_backend=DETECTOR_BACKEND,
        enforce_detection=False,
    )
    if not results:
        return None
    embedding = results[0].get("embedding")
    if not embedding:
        return None
    return embedding


def warmup():
    try:
        from deepface import DeepFace

        DeepFace.build_model(MODEL_NAME)
        logger.info("ArcFace model loaded")
    except Exception as e:
        logger.warning(f"warmup ArcFace failed: {e}")
    try:
        from deepface.detectors import FaceDetector

        FaceDetector.build_model(DETECTOR_BACKEND)
        logger.info("retinaface detector loaded")
    except Exception as e:
        logger.warning(f"warmup retinaface failed: {e}")


@asynccontextmanager
async def lifespan(app: FastAPI):
    threading.Thread(target=warmup, daemon=True).start()
    yield


app = FastAPI(title="SafeRide Face Service", lifespan=lifespan)


@app.get("/health")
async def health():
    return {"status": "ok"}


@app.post("/enroll")
async def enroll(photo: UploadFile = File(...)):
    data = await photo.read()
    try:
        embedding = await anyio.to_thread.run_sync(represent, data)
    except Exception as e:
        logger.warning(f"enroll failed: {e}")
        embedding = None
    if embedding is None:
        return {"faceDetected": False, "embedding": None}
    return {"faceDetected": True, "embedding": embedding}


@app.post("/identify")
async def identify(
    photo: UploadFile = File(...),
    candidateEmbeddings: str = Form(...),
):
    try:
        candidates = json.loads(candidateEmbeddings)
    except json.JSONDecodeError:
        return {"studentId": None, "confidence": 0.0}

    if not isinstance(candidates, list) or not candidates:
        return {"studentId": None, "confidence": 0.0}

    data = await photo.read()
    try:
        embedding = await anyio.to_thread.run_sync(represent, data)
    except Exception as e:
        logger.warning(f"identify failed: {e}")
        embedding = None

    if embedding is None:
        return {"studentId": None, "confidence": 0.0}

    best_student_id = None
    best_score = -1.0
    for candidate in candidates:
        try:
            score = cosine_similarity(embedding, candidate["embedding"])
        except (KeyError, TypeError, ValueError):
            continue
        if score > best_score:
            best_score = score
            best_student_id = candidate["studentId"]

    return {"studentId": best_student_id, "confidence": best_score}
