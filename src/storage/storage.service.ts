import {
    AbortMultipartUploadCommand,
    CompleteMultipartUploadCommand,
    CreateBucketCommand,
    CreateMultipartUploadCommand,
    DeleteObjectCommand,
    GetObjectCommand,
    GetObjectCommandOutput,
    HeadBucketCommand,
    HeadObjectCommand,
    ListMultipartUploadsCommand,
    ListPartsCommand,
    PutObjectCommand,
    S3Client,
    UploadPartCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { sleep } from '../lib/sleep';
import { PRESIGN_GET_TTL_SECONDS, PRESIGN_PART_TTL_SECONDS, PRESIGN_PUT_TTL_SECONDS } from './storage.constants';
import { createS3Client } from './s3-client';
import type { StorageConfig } from './storage.config';

export interface ObjectHead {
    size: number;
    etag: string;
    contentType?: string;
}

export interface UploadedPart {
    partNumber: number;
    size: number;
    etag: string;
}

export interface PendingUpload {
    key: string;
    uploadId: string;
}

export interface ObjectData {
    body: Buffer;
    contentType?: string;
    cacheControl?: string;
    etag?: string;
}

interface S3ErrorShape {
    name?: string;
    $metadata?: { httpStatusCode?: number };
}

function isNotFound(error: unknown): boolean {
    const shape = error as S3ErrorShape;
    return shape?.name === 'NotFound' || shape?.name === 'NoSuchKey' || shape?.$metadata?.httpStatusCode === 404;
}

function isNotModified(error: unknown): boolean {
    const shape = error as S3ErrorShape;
    return shape?.name === 'NotModified' || shape?.$metadata?.httpStatusCode === 304;
}

async function toObjectData(result: GetObjectCommandOutput): Promise<ObjectData> {
    const body = result.Body ? Buffer.from(await result.Body.transformToByteArray()) : Buffer.alloc(0);
    return {
        body,
        contentType: result.ContentType,
        cacheControl: result.CacheControl,
        etag: result.ETag,
    };
}

function isTransient(error: unknown): boolean {
    const status = (error as S3ErrorShape)?.$metadata?.httpStatusCode;
    return status === undefined || status >= 500;
}

function isBucketAlreadyThere(error: unknown): boolean {
    const name = (error as S3ErrorShape)?.name;
    return name === 'BucketAlreadyOwnedByYou' || name === 'BucketAlreadyExists';
}

export class StorageService {
    readonly client: S3Client;
    readonly bucket: string;

    constructor(config: StorageConfig, client: S3Client = createS3Client(config)) {
        this.client = client;
        this.bucket = config.bucket;
    }

    async ensureBucket(timeoutMs = 20_000): Promise<void> {
        const deadline = Date.now() + timeoutMs;
        for (;;) {
            try {
                await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
                return;
            } catch (error) {
                if (isNotFound(error)) {
                    try {
                        await this.client.send(new CreateBucketCommand({ Bucket: this.bucket }));
                    } catch (createError) {
                        if (!isBucketAlreadyThere(createError)) {
                            throw createError;
                        }
                    }
                    return;
                }
                if (!isTransient(error) || Date.now() >= deadline) {
                    throw error;
                }
                await sleep(250);
            }
        }
    }

    presignPut(key: string, contentType: string, expiresIn = PRESIGN_PUT_TTL_SECONDS): Promise<string> {
        return getSignedUrl(
            this.client,
            new PutObjectCommand({ Bucket: this.bucket, Key: key, ContentType: contentType }),
            { expiresIn, signableHeaders: new Set(['content-type']) },
        );
    }

    presignGet(key: string, expiresIn = PRESIGN_GET_TTL_SECONDS): Promise<string> {
        return getSignedUrl(this.client, new GetObjectCommand({ Bucket: this.bucket, Key: key }), { expiresIn });
    }

    async head(key: string): Promise<ObjectHead | null> {
        try {
            const result = await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
            return {
                size: result.ContentLength ?? 0,
                etag: result.ETag ?? '',
                contentType: result.ContentType,
            };
        } catch (error) {
            if (isNotFound(error)) {
                return null;
            }
            throw error;
        }
    }

    async delete(key: string): Promise<void> {
        await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
    }

    async createMultipartUpload(key: string, contentType: string): Promise<string> {
        const result = await this.client.send(
            new CreateMultipartUploadCommand({ Bucket: this.bucket, Key: key, ContentType: contentType }),
        );
        if (!result.UploadId) {
            throw new Error('сховище не повернуло UploadId');
        }
        return result.UploadId;
    }

    presignUploadPart(
        key: string,
        uploadId: string,
        partNumber: number,
        expiresIn = PRESIGN_PART_TTL_SECONDS,
    ): Promise<string> {
        return getSignedUrl(
            this.client,
            new UploadPartCommand({ Bucket: this.bucket, Key: key, UploadId: uploadId, PartNumber: partNumber }),
            { expiresIn },
        );
    }

    async listParts(key: string, uploadId: string): Promise<UploadedPart[]> {
        const parts: UploadedPart[] = [];
        let marker: string | undefined;
        for (;;) {
            const page = await this.client.send(
                new ListPartsCommand({ Bucket: this.bucket, Key: key, UploadId: uploadId, PartNumberMarker: marker }),
            );
            for (const part of page.Parts ?? []) {
                parts.push({ partNumber: part.PartNumber ?? 0, size: part.Size ?? 0, etag: part.ETag ?? '' });
            }
            if (!page.IsTruncated) {
                return parts;
            }
            marker = page.NextPartNumberMarker;
        }
    }

    async completeMultipartUpload(key: string, uploadId: string, parts: UploadedPart[]): Promise<void> {
        await this.client.send(
            new CompleteMultipartUploadCommand({
                Bucket: this.bucket,
                Key: key,
                UploadId: uploadId,
                MultipartUpload: { Parts: parts.map((part) => ({ PartNumber: part.partNumber, ETag: part.etag })) },
            }),
        );
    }

    async abortMultipartUpload(key: string, uploadId: string): Promise<void> {
        await this.client.send(new AbortMultipartUploadCommand({ Bucket: this.bucket, Key: key, UploadId: uploadId }));
    }

    async listMultipartUploads(prefix: string): Promise<PendingUpload[]> {
        const uploads: PendingUpload[] = [];
        let keyMarker: string | undefined;
        let uploadIdMarker: string | undefined;
        for (;;) {
            const page = await this.client.send(
                new ListMultipartUploadsCommand({
                    Bucket: this.bucket,
                    Prefix: prefix,
                    KeyMarker: keyMarker,
                    UploadIdMarker: uploadIdMarker,
                }),
            );
            for (const upload of page.Uploads ?? []) {
                uploads.push({ key: upload.Key ?? '', uploadId: upload.UploadId ?? '' });
            }
            if (!page.IsTruncated) {
                return uploads;
            }
            keyMarker = page.NextKeyMarker;
            uploadIdMarker = page.NextUploadIdMarker;
        }
    }

    async putObject(key: string, body: Buffer, contentType: string, cacheControl?: string): Promise<void> {
        await this.client.send(
            new PutObjectCommand({
                Bucket: this.bucket,
                Key: key,
                Body: body,
                ContentType: contentType,
                CacheControl: cacheControl,
            }),
        );
    }

    async getObject(key: string): Promise<ObjectData | null> {
        try {
            const result = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
            return await toObjectData(result);
        } catch (error) {
            if (isNotFound(error)) {
                return null;
            }
            throw error;
        }
    }

    async getObjectIfChanged(key: string, etag: string): Promise<ObjectData | 'not-modified' | null> {
        try {
            const result = await this.client.send(
                new GetObjectCommand({ Bucket: this.bucket, Key: key, IfNoneMatch: etag }),
            );
            return await toObjectData(result);
        } catch (error) {
            if (isNotModified(error)) {
                return 'not-modified';
            }
            if (isNotFound(error)) {
                return null;
            }
            throw error;
        }
    }

    onApplicationShutdown(): void {
        this.client.destroy();
    }
}