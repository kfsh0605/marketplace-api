import type { FileStorage } from '../../../src/files/files.service';
import type { UploadedPart } from '../../../src/storage/storage.service';

interface PendingUpload {
    key: string;
    parts: Map<number, number>;
}

export class FakeStorage implements FileStorage {
    readonly objects = new Map<string, number>();
    readonly uploads = new Map<string, PendingUpload>();
    readonly putRequests: Array<{ key: string; contentType: string; expiresIn?: number }> = [];
    readonly completions: Array<{ key: string; partNumbers: number[] }> = [];

    async presignPut(key: string, contentType: string, expiresIn?: number): Promise<string> {
        this.putRequests.push({ key, contentType, expiresIn });
        return `fake://put/${key}`;
    }

    async presignGet(key: string, expiresIn = 60): Promise<string> {
        return `fake://get/${key}?expires=${expiresIn}`;
    }

    async head(key: string): Promise<{ size: number } | null> {
        const size = this.objects.get(key);
        return size === undefined ? null : { size };
    }

    async createMultipartUpload(key: string): Promise<string> {
        const uploadId = `upload-${this.uploads.size + 1}`;
        this.uploads.set(uploadId, { key, parts: new Map() });
        return uploadId;
    }

    async presignUploadPart(key: string, uploadId: string, partNumber: number, expiresIn = 900): Promise<string> {
        return `fake://part/${key}?upload=${uploadId}&part=${partNumber}&expires=${expiresIn}`;
    }

    async listParts(_key: string, uploadId: string): Promise<UploadedPart[]> {
        const upload = this.uploads.get(uploadId);
        if (!upload) {
            throw Object.assign(new Error('NoSuchUpload'), { name: 'NoSuchUpload' });
        }
        return [...upload.parts.entries()]
            .sort(([a], [b]) => a - b)
            .map(([partNumber, size]) => ({ partNumber, size, etag: `"etag-${partNumber}"` }));
    }

    async completeMultipartUpload(key: string, uploadId: string, parts: UploadedPart[]): Promise<void> {
        const upload = this.uploads.get(uploadId);
        if (!upload) {
            throw Object.assign(new Error('NoSuchUpload'), { name: 'NoSuchUpload' });
        }
        this.objects.set(key, parts.reduce((sum, part) => sum + part.size, 0));
        this.completions.push({ key, partNumbers: parts.map((part) => part.partNumber) });
        this.uploads.delete(uploadId);
    }

    putPart(uploadId: string, partNumber: number, size: number): void {
        this.uploads.get(uploadId)?.parts.set(partNumber, size);
    }
}