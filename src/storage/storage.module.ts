import { Module } from '@nestjs/common';
import { loadStorageConfig } from './storage.config';
import { StorageService } from './storage.service';

@Module({
    providers: [
        {
            provide: StorageService,
            useFactory: (): StorageService => new StorageService(loadStorageConfig()),
        },
    ],
    exports: [StorageService],
})
export class StorageModule {}