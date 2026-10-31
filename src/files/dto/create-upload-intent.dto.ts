import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { ALLOWED_CONTENT_TYPE_LIST, MAX_FILE_SIZE_BYTES } from '../files.constants';

export class CreateUploadIntentDto {
    @ApiProperty({
        enum: ALLOWED_CONTENT_TYPE_LIST,
        example: 'image/png',
        description: 'MIME-тип файла. Лише з allowlist; саме цей тип клієнт обов\'язаний надіслати в заголовку Content-Type при PUT',
    })
    @IsIn(ALLOWED_CONTENT_TYPE_LIST)
    contentType: string;

    @ApiPropertyOptional({
        example: 204800,
        description: 'Очікуваний розмір у байтах. Якщо вказано, commit звіряє його з реальним розміром у сховищі',
    })
    @IsOptional()
    @IsInt()
    @Min(1)
    @Max(MAX_FILE_SIZE_BYTES)
    size?: number;

    @ApiPropertyOptional({
        example: 'avatar.png',
        description: 'Лише для довідки клієнта. Ігнорується: ключ об\'єкта завжди генерує сервер',
    })
    @IsOptional()
    @IsString()
    @MaxLength(255)
    filename?: string;
}