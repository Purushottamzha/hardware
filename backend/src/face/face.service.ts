import { Injectable, Logger } from '@nestjs/common';

export interface FaceCandidate {
  studentId: string;
  embedding: number[];
}

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
    this.baseUrl = process.env.FACE_SERVICE_URL || 'http://face-service:8000';
  }

  private toBlob(photo: Buffer): Blob {
    const copy = new Uint8Array(photo.length);
    copy.set(photo);
    return new Blob([copy.buffer as ArrayBuffer], { type: 'image/jpeg' });
  }

  async enroll(photo: Buffer, filename: string): Promise<FaceEnrollResult> {
    const form = new FormData();
    form.append('photo', this.toBlob(photo), filename);

    const res = await fetch(`${this.baseUrl}/enroll`, { method: 'POST', body: form });
    if (!res.ok) {
      throw new Error(`face-service /enroll failed: ${res.status}`);
    }
    return res.json();
  }

  async identify(photo: Buffer, filename: string, candidates: FaceCandidate[]): Promise<FaceIdentifyResult> {
    const form = new FormData();
    form.append('photo', this.toBlob(photo), filename);
    form.append('candidateEmbeddings', JSON.stringify(candidates));

    const res = await fetch(`${this.baseUrl}/identify`, { method: 'POST', body: form });
    if (!res.ok) {
      throw new Error(`face-service /identify failed: ${res.status}`);
    }
    return res.json();
  }
}
