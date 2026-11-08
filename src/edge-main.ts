import { DEFAULT_MAX_CACHE_BYTES, startEdge } from './cdn/edge';
import { loadStorageConfig } from './storage/storage.config';
import { StorageService } from './storage/storage.service';

async function main(): Promise<void> {
    const storage = new StorageService(loadStorageConfig());
    const maxCacheBytes = Number(process.env.EDGE_CACHE_MAX_BYTES ?? DEFAULT_MAX_CACHE_BYTES);
    const edge = await startEdge(storage, Number(process.env.EDGE_PORT ?? 3100), { maxCacheBytes });
    console.log(
        `edge слухає http://127.0.0.1:${edge.port}, публічний префікс assets/, ліміт кешу ${maxCacheBytes} байт`,
    );
}

void main();