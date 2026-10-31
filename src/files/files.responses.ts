import { ApiProperty } from '@nestjs/swagger';

export class UploadIntentResponse {
    @ApiProperty({ example: '3f2b8a52-6f0c-4c6b-9d6e-2a9f6c1b7e10' })
    fileId: string;

    @ApiProperty({ example: 'uploads/7/3f2b8a52-6f0c-4c6b-9d6e-2a9f6c1b7e10.png' })
    key: string;

    @ApiProperty({ example: 'PUT' })
    method: 'PUT';

    @ApiProperty({ description: 'Presigned URL: клієнт кладе байти напряму сюди, повз наш API' })
    url: string;

    @ApiProperty({ example: { 'content-type': 'image/png' }, description: 'Заголовки, які обов\'язково надіслати при PUT' })
    headers: Record<string, string>;

    @ApiProperty({ example: 300 })
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