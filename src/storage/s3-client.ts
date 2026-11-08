import { S3Client } from '@aws-sdk/client-s3';
import type { StorageConfig } from './storage.config';

export function createS3Client(config: StorageConfig): S3Client {
    return new S3Client({
        region: config.region,
        endpoint: config.endpoint,
        forcePathStyle: Boolean(config.endpoint),
        credentials: {
            accessKeyId: config.accessKeyId,
            secretAccessKey: config.secretAccessKey,
        },
        requestChecksumCalculation: 'WHEN_REQUIRED',
        responseChecksumValidation: 'WHEN_REQUIRED',
    });
}