import { createHash } from 'node:crypto';
import type { StorageService } from '../storage/storage.service';

export const ASSETS_PREFIX = 'assets/';
export const IMMUTABLE_CACHE_CONTROL = 'public, max-age=31536000, immutable';

export function hashedAssetName(baseName: string, extension: string, content: Buffer): string {
    const digest = createHash('sha256').update(content).digest('hex').slice(0, 8);
    return `${baseName}.${digest}.${extension}`;
}

export async function publishAsset(
    storage: Pick<StorageService, 'putObject'>,
    baseName: string,
    extension: string,
    content: Buffer,
    contentType: string,
): Promise<{ name: string; key: string }> {
    const name = hashedAssetName(baseName, extension, content);
    const key = `${ASSETS_PREFIX}${name}`;
    await storage.putObject(key, content, contentType, IMMUTABLE_CACHE_CONTROL);
    return { name, key };
}