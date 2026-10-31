import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'node:crypto';
import { Repository } from 'typeorm';
import { StoredFile } from '../entities/stored-file.entity';
import { User } from '../entities/user.entity';
import { PRESIGN_PUT_TTL_SECONDS } from '../storage/storage.constants';
import { StorageService } from '../storage/storage.service';
import { CreateUploadIntentDto } from './dto/create-upload-intent.dto';
import { buildFileKey, extensionFor } from './file-key';
import type { FileResponse, UploadIntentResponse } from './files.responses';

export interface FileStorage {
    presignPut(key: string, contentType: string, expiresIn?: number): Promise<string>;
    presignGet(key: string, expiresIn?: number): Promise<string>;
    head(key: string): Promise<{ size: number } | null>;
}

@Injectable()
export class FilesService {
    constructor(
        @InjectRepository(StoredFile) private readonly files: Repository<StoredFile>,
        @Inject(StorageService) private readonly storage: FileStorage,
    ) {}

    async createIntent(userId: number, dto: CreateUploadIntentDto): Promise<UploadIntentResponse> {
        const extension = extensionFor(dto.contentType);
        if (!extension) {
            throw new BadRequestException(`Тип ${dto.contentType} не дозволений`);
        }

        const fileId = randomUUID();
        const key = buildFileKey(userId, fileId, extension);
        await this.files.save(
            this.files.create({
                id: fileId,
                key,
                ownerId: userId,
                contentType: dto.contentType,
                size: dto.size ?? null,
                status: 'PENDING',
            }),
        );

        const url = await this.storage.presignPut(key, dto.contentType, PRESIGN_PUT_TTL_SECONDS);
        return {
            fileId,
            key,
            method: 'PUT',
            url,
            headers: { 'content-type': dto.contentType },
            expiresInSeconds: PRESIGN_PUT_TTL_SECONDS,
        };
    }

    async commit(userId: number, fileId: string): Promise<FileResponse> {
        const file = await this.findAccessible(fileId, userId, false);
        if (file.status === 'COMPLETED') {
            return this.toResponse(file);
        }

        const head = await this.storage.head(file.key);
        if (!head) {
            throw new ConflictException('Об\'єкта ще немає у сховищі: спершу завантаж байти за presigned URL');
        }
        if (file.size !== null && head.size !== file.size) {
            throw new ConflictException(
                `Розмір у сховищі (${head.size}) не збігається із заявленим (${file.size})`,
            );
        }

        await this.files.update(
            { id: file.id, status: 'PENDING' },
            { status: 'COMPLETED', size: head.size, completedAt: new Date() },
        );
        return this.toResponse(await this.files.findOneByOrFail({ id: file.id }));
    }

    async downloadUrl(userId: number, fileId: string): Promise<string> {
        const file = await this.findAccessible(fileId, userId, true);
        if (file.status !== 'COMPLETED') {
            throw new NotFoundException(`File ${fileId} not found`);
        }
        return this.storage.presignGet(file.key);
    }

    private async findAccessible(fileId: string, actorId: number, allowAdmin: boolean): Promise<StoredFile> {
        const file = await this.files.findOneBy({ id: fileId });
        if (!file) {
            throw new NotFoundException(`File ${fileId} not found`);
        }
        if (file.ownerId === actorId) {
            return file;
        }
        if (allowAdmin && (await this.isAdmin(actorId))) {
            return file;
        }
        throw new NotFoundException(`File ${fileId} not found`);
    }

    private async isAdmin(userId: number): Promise<boolean> {
        const user = await this.files.manager.findOne(User, {
            where: { id: userId },
            select: { id: true, role: true },
        });
        return user?.role === 'admin';
    }

    private toResponse(file: StoredFile): FileResponse {
        return {
            id: file.id,
            key: file.key,
            status: file.status,
            contentType: file.contentType,
            size: file.size,
            completedAt: file.completedAt ? file.completedAt.toISOString() : null,
        };
    }
}