import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class MultipartInfo {
    @ApiProperty({ example: 5242880, description: 'Розмір кожної частини, крім останньої' })
    partSize: number;

    @ApiProperty({ example: 3 })
    partCount: number;
}

export class UploadIntentResponse {
    @ApiProperty({ enum: ['single', 'multipart'], description: 'single: один PUT на url; multipart: частини через /uploads/{fileId}/parts' })
    mode: 'single' | 'multipart';

    @ApiProperty({ example: '3f2b8a52-6f0c-4c6b-9d6e-2a9f6c1b7e10' })
    fileId: string;

    @ApiProperty({ example: 'uploads/7/3f2b8a52-6f0c-4c6b-9d6e-2a9f6c1b7e10.png' })
    key: string;

    @ApiPropertyOptional({ example: 'PUT', description: 'Лише для mode=single' })
    method?: 'PUT';

    @ApiPropertyOptional({ description: 'Лише для mode=single: presigned URL, клієнт кладе байти напряму сюди, повз наш API' })
    url?: string;

    @ApiPropertyOptional({
        example: { 'content-type': 'image/png' },
        description: 'Лише для mode=single: заголовки, які обов\'язково надіслати при PUT',
    })
    headers?: Record<string, string>;

    @ApiPropertyOptional({ type: MultipartInfo, description: 'Лише для mode=multipart' })
    multipart?: MultipartInfo;

    @ApiProperty({ example: 300, description: 'Строк дії виданого URL (для multipart: URL однієї частини)' })
    expiresInSeconds: number;
}

export class FileResponse {
    @ApiProperty()
    id: string;

    @ApiProperty()
    key: string;

    @ApiProperty({ enum: ['PENDING', 'COMPLETED'] })
    status: 'PENDING' | 'COMPLETED';

    @ApiProperty({ example: 'image/png' })
    contentType: string;

    @ApiProperty({ type: Number, nullable: true })
    size: number | null;

    @ApiProperty({ type: String, format: 'date-time', nullable: true })
    completedAt: string | null;
}

export class PartInfo {
    @ApiProperty({ example: 1 })
    partNumber: number;

    @ApiProperty({ example: 5242880 })
    size: number;

    @ApiProperty({ example: '"5d41402abc4b2a76b9719d911017c592"' })
    etag: string;
}

export class PartsResponse {
    @ApiProperty()
    fileId: string;

    @ApiProperty({ example: 5242880 })
    partSize: number;

    @ApiProperty({ example: 3 })
    partCount: number;

    @ApiProperty({ type: [PartInfo], description: 'Частини, які вже лежать у сховищі (ListParts)' })
    parts: PartInfo[];
}

export class PartUrl {
    @ApiProperty({ example: 3 })
    partNumber: number;

    @ApiProperty({ description: 'Presigned PUT URL однієї частини' })
    url: string;
}

export class PartUrlsResponse {
    @ApiProperty({ example: 900 })
    expiresInSeconds: number;

    @ApiProperty({ type: [PartUrl] })
    urls: PartUrl[];
}