import { ApiProperty } from '@nestjs/swagger';
import { ArrayMaxSize, ArrayMinSize, ArrayUnique, IsArray, IsInt, Max, Min } from 'class-validator';
import { MAX_PARTS } from '../multipart-plan';

export const MAX_PART_URLS_PER_REQUEST = 100;

export class RequestPartUrlsDto {
    @ApiProperty({
        type: [Number],
        example: [3],
        description: 'Номери частин (з 1), для яких потрібні presigned URL; не більше 100 за один запит',
    })
    @IsArray()
    @ArrayMinSize(1)
    @ArrayMaxSize(MAX_PART_URLS_PER_REQUEST)
    @ArrayUnique()
    @IsInt({ each: true })
    @Min(1, { each: true })
    @Max(MAX_PARTS, { each: true })
    partNumbers: number[];
}