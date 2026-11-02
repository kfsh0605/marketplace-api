import { startEdge } from './cdn/edge';
import { loadStorageConfig } from './storage/storage.config';
import { StorageService } from './storage/storage.service';

async function main(): Promise<void> {
    const storage = new StorageService(loadStorageConfig());
    const edge = await startEdge(storage, Number(process.env.EDGE_PORT ?? 3100));
    console.log(`edge слухає http://127.0.0.1:${edge.port}, публічний префікс assets/`);
}

void main();