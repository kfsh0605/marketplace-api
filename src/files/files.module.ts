import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { StoredFile } from '../entities/stored-file.entity';
import { StorageModule } from '../storage/storage.module';
import { FilesController } from './files.controller';
import { FilesService } from './files.service';

@Module({
    imports: [TypeOrmModule.forFeature([StoredFile]), StorageModule],
    controllers: [FilesController],
    providers: [FilesService],
})
export class FilesModule {}