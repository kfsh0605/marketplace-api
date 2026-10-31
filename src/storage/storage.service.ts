import {
    CreateBucketCommand,
    DeleteObjectCommand,
    GetObjectCommand,
    HeadBucketCommand,
    HeadObjectCommand,
    PutObjectCommand,
    S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { sleep } from '../lib/sleep';
import { PRESIGN_GET_TTL_SECONDS, PRESIGN_PUT_TTL_SECONDS } from './storage.constants';
import { createS3Client } from './s3-client';
import type { StorageConfig } from './storage.config';

export interface ObjectHead {
    size: number;
    etag: string;
    contentType?: string;
}

interface S3ErrorShape {
    name?: string;
    $metadata?: { httpStatusCode?: number };
}

function isNotFound(error: unknown): boolean {
    const shape = error as S3ErrorShape;
    return shape?.name === 'NotFound' || shape?.name === 'NoSuchKey' || shape?.$metadata?.httpStatusCode === 404;
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

    onApplicationShutdown(): void {
        this.client.destroy();
    }
}