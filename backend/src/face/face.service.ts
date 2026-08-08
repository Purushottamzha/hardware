import { Injectable, Logger } from '@nestjs/common';

export interface FaceEnrollResult {
  faceDetected: boolean;
  embedding: number[] | null;
}

export interface FaceIdentifyResult {
  studentId: string | null;
  confidence: number;
}

/**
 * Thin HTTP client for the standalone face-service container.
 * Stateless: never touches Prisma. All vector math happens in face-service.
 */
@Injectable()
export class FaceService {
  private readonly logger = new Logger(FaceService.name);
  private readonly baseUrl: string;

  constructor() {
    // Native Windows face-service (see face-service/run_native.bat). Backend runs
    // inside Docker, so it reaches the Windows host via host.docker.internal.
    this.baseUrl = process.env.FACE_SERVICE_URL || 'http://host.docker.internal:5001';
  }

  private toBlob(photo: Buffer): Blob {
    const copy = new Uint8Array(photo.length);
    copy.set(photo);
    return new Blob([copy.buffer as ArrayBuffer], { type: 'image/jpeg' });
  }

  async enroll(photo: Buffer, filename: string, studentId?: string): Promise<FaceEnrollResult & { stored?: boolean; studentId?: string | null }> {
    const form = new FormData();
    form.append('photo', this.toBlob(photo), filename);
    if (studentId) form.append('studentId', studentId);

    const res = await fetch(`${this.baseUrl}/enroll`, { method: 'POST', body: form });
    if (!res.ok) {
      throw new Error(`face-service /enroll failed: ${res.status}`);
    }
    return res.json();
  }

  /**
   * New self-contained contract: the face-service keeps its own enrollment
   * store (populated via /enroll with studentId). Match just sends the photo.
   */
  async match(photo: Buffer, filename: string): Promise<FaceIdentifyResult> {
    const form = new FormData();
    form.append('photo', this.toBlob(photo), filename);

    const res = await fetch(`${this.baseUrl}/match`, { method: 'POST', body: form });
    if (!res.ok) {
      throw new Error(`face-service /match failed: ${res.status}`);
    }
    return res.json();
  }

  async ping(): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/health`, { signal: AbortSignal.timeout(1500) });
      return res.ok;
    } catch {
      return false;
    }
  }

  async deleteStudent(studentId: string): Promise<{ deleted: boolean; studentId: string }> {
    const form = new FormData();
    form.append('studentId', studentId);

    const res = await fetch(`${this.baseUrl}/delete-student`, { method: 'DELETE', body: form });
    if (!res.ok) {
      throw new Error(`face-service /delete-student failed: ${res.status}`);
    }
    return res.json();
  }
}
