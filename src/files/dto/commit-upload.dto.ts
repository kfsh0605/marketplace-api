import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';

export class CommitUploadDto {
    @ApiProperty({ example: '3f2b8a52-6f0c-4c6b-9d6e-2a9f6c1b7e10', description: 'fileId з відповіді intent' })
    @IsUUID()
    fileId: string;
}