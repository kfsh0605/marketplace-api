import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'node:crypto';
import { Repository } from 'typeorm';
import { StoredFile } from '../entities/stored-file.entity';
import { User } from '../entities/user.entity';
import { PRESIGN_PART_TTL_SECONDS, PRESIGN_PUT_TTL_SECONDS } from '../storage/storage.constants';
import { StorageService } from '../storage/storage.service';
import type { UploadedPart } from '../storage/storage.service';
import { CreateUploadIntentDto } from './dto/create-upload-intent.dto';
import { buildFileKey, extensionFor } from './file-key';
import { expectedPartSize, MULTIPART_THRESHOLD_BYTES, planMultipart } from './multipart-plan';
import type { MultipartPlan } from './multipart-plan';
import type { FileResponse, PartsResponse, PartUrlsResponse, UploadIntentResponse } from './files.responses';

export interface FileStorage {
    presignPut(key: string, contentType: string, expiresIn?: number): Promise<string>;
    presignGet(key: string, expiresIn?: number): Promise<string>;
    head(key: string): Promise<{ size: number } | null>;
    createMultipartUpload(key: string, contentType: string): Promise<string>;
    presignUploadPart(key: string, uploadId: string, partNumber: number, expiresIn?: number): Promise<string>;
    listParts(key: string, uploadId: string): Promise<UploadedPart[]>;
    completeMultipartUpload(key: string, uploadId: string, parts: UploadedPart[]): Promise<void>;
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

        if (dto.size !== undefined && dto.size > MULTIPART_THRESHOLD_BYTES) {
            return this.createMultipartIntent(userId, fileId, key, dto.contentType, dto.size);
        }

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
            mode: 'single',
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
        if (file.uploadId !== null) {
            return this.commitMultipart(file);
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

    async listUploadedParts(userId: number, fileId: string): Promise<PartsResponse> {
        const file = await this.findPendingMultipart(fileId, userId);
        const plan = planMultipart(file.size);
        const parts = await this.listPartsOrConflict(file);
        return {
            fileId: file.id,
            partSize: plan.partSize,
            partCount: plan.partCount,
            parts: parts.map(({ partNumber, size, etag }) => ({ partNumber, size, etag })),
        };
    }

    async presignParts(userId: number, fileId: string, partNumbers: number[]): Promise<PartUrlsResponse> {
        const file = await this.findPendingMultipart(fileId, userId);
        const plan = planMultipart(file.size);
        for (const partNumber of partNumbers) {
            if (partNumber < 1 || partNumber > plan.partCount) {
                throw new BadRequestException(`Номер частини ${partNumber} поза діапазоном 1..${plan.partCount}`);
            }
        }

        const urls = await Promise.all(
            partNumbers.map(async (partNumber) => ({
                partNumber,
                url: await this.storage.presignUploadPart(file.key, file.uploadId, partNumber, PRESIGN_PART_TTL_SECONDS),
            })),
        );
        return { expiresInSeconds: PRESIGN_PART_TTL_SECONDS, urls };
    }

    async downloadUrl(userId: number, fileId: string): Promise<string> {
        const file = await this.findAccessible(fileId, userId, true);
        if (file.status !== 'COMPLETED') {
            throw new NotFoundException(`File ${fileId} not found`);
        }
        return this.storage.presignGet(file.key);
    }

    private async createMultipartIntent(
        userId: number,
        fileId: string,
        key: string,
        contentType: string,
        size: number,
    ): Promise<UploadIntentResponse> {
        const plan = planMultipart(size);
        const uploadId = await this.storage.createMultipartUpload(key, contentType);
        await this.files.save(
            this.files.create({ id: fileId, key, ownerId: userId, contentType, size, uploadId, status: 'PENDING' }),
        );
        return {
            mode: 'multipart',
            fileId,
            key,
            multipart: { partSize: plan.partSize, partCount: plan.partCount },
            expiresInSeconds: PRESIGN_PART_TTL_SECONDS,
        };
    }

    private async commitMultipart(file: StoredFile): Promise<FileResponse> {
        let head = await this.storage.head(file.key);
        if (!head) {
            const plan = planMultipart(file.size);
            const parts = await this.listPartsOrConflict(file);
            const ordered = this.requireAllParts(file.size, plan, parts);
            await this.storage.completeMultipartUpload(file.key, file.uploadId, ordered);
            head = await this.storage.head(file.key);
        }
        if (!head || head.size !== file.size) {
            throw new ConflictException(
                `Розмір зібраного об'єкта (${head?.size ?? 'немає'}) не збігається із заявленим (${file.size})`,
            );
        }

        await this.files.update(
            { id: file.id, status: 'PENDING' },
            { status: 'COMPLETED', size: head.size, uploadId: null, completedAt: new Date() },
        );
        return this.toResponse(await this.files.findOneByOrFail({ id: file.id }));
    }

    private requireAllParts(totalSize: number, plan: MultipartPlan, parts: UploadedPart[]): UploadedPart[] {
        const byNumber = new Map(parts.map((part) => [part.partNumber, part]));
        const ordered: UploadedPart[] = [];
        const missing: number[] = [];

        for (let partNumber = 1; partNumber <= plan.partCount; partNumber++) {
            const part = byNumber.get(partNumber);
            if (!part) {
                missing.push(partNumber);
                continue;
            }
            const expected = expectedPartSize(plan, totalSize, partNumber);
            if (part.size !== expected) {
                throw new ConflictException(`Частина ${partNumber} має розмір ${part.size}, очікувалось ${expected}`);
            }
            ordered.push(part);
        }

        if (missing.length > 0) {
            throw new ConflictException(
                `Не вистачає частин: ${missing.length} з ${plan.partCount} (перші: ${missing.slice(0, 20).join(', ')})`,
            );
        }
        return ordered;
    }

    private async listPartsOrConflict(file: StoredFile): Promise<UploadedPart[]> {
        try {
            return await this.storage.listParts(file.key, file.uploadId);
        } catch (error) {
            if ((error as { name?: string }).name === 'NoSuchUpload') {
                throw new ConflictException('Multipart-завантаження скасовано або вже завершено');
            }
            throw error;
        }
    }

    private async findPendingMultipart(fileId: string, actorId: number): Promise<StoredFile> {
        const file = await this.findAccessible(fileId, actorId, false);
        if (file.status !== 'PENDING' || file.uploadId === null || file.size === null) {
            throw new ConflictException('Файл не очікує multipart-завантаження');
        }
        return file;
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