import { Body, Controller, Get, Header, HttpCode, Param, ParseUUIDPipe, Post, Redirect } from '@nestjs/common';
import {
    ApiBadRequestResponse,
    ApiBearerAuth,
    ApiConflictResponse,
    ApiFoundResponse,
    ApiNotFoundResponse,
    ApiOkResponse,
    ApiOperation,
    ApiParam,
    ApiTags,
    ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AccessPrincipal } from '../auth/token.service';
import { CommitUploadDto } from './dto/commit-upload.dto';
import { CreateUploadIntentDto } from './dto/create-upload-intent.dto';
import { FilesService } from './files.service';
import { FileResponse, UploadIntentResponse } from './files.responses';

@ApiTags('files')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Немає або недійсний access-токен' })
@Controller()
export class FilesController {
    constructor(private readonly filesService: FilesService) {}

    @Post('uploads/intent')
    @HttpCode(200)
    @ApiOperation({
        operationId: 'createUploadIntent',
        summary: 'Крок 1: отримати presigned URL, щоб покласти байти напряму у сховище',
    })
    @ApiOkResponse({ type: UploadIntentResponse })
    @ApiBadRequestResponse({ description: 'Тип файла поза allowlist або некоректний розмір' })
    createIntent(
        @Body() dto: CreateUploadIntentDto,
        @CurrentUser() user: AccessPrincipal,
    ): Promise<UploadIntentResponse> {
        return this.filesService.createIntent(user.userId, dto);
    }

    @Post('uploads/commit')
    @HttpCode(200)
    @ApiOperation({
        operationId: 'commitUpload',
        summary: 'Крок 3: підтвердити завантаження (сервер перевіряє об\'єкт у сховищі через HeadObject)',
    })
    @ApiOkResponse({ type: FileResponse })
    @ApiNotFoundResponse({ description: 'Файл не існує або належить іншому користувачу' })
    @ApiConflictResponse({ description: 'Об\'єкта ще немає у сховищі або його розмір не збігається із заявленим' })
    commit(@Body() dto: CommitUploadDto, @CurrentUser() user: AccessPrincipal): Promise<FileResponse> {
        return this.filesService.commit(user.userId, dto.fileId);
    }

    @Get('files/:id')
    @Redirect()
    @Header('Cache-Control', 'no-store')
    @ApiOperation({
        operationId: 'downloadFile',
        summary: '302 на свіжий presigned GET URL (дійсний 60 секунд); гард спрацьовує на кожен запит',
    })
    @ApiParam({ name: 'id', example: '3f2b8a52-6f0c-4c6b-9d6e-2a9f6c1b7e10' })
    @ApiFoundResponse({ description: 'Редирект на короткоживучий presigned URL' })
    @ApiNotFoundResponse({ description: 'Файл не існує, ще не завершений або належить іншому користувачу' })
    async download(
        @Param('id', ParseUUIDPipe) id: string,
        @CurrentUser() user: AccessPrincipal,
    ): Promise<{ url: string; statusCode: number }> {
        const url = await this.filesService.downloadUrl(user.userId, id);
        return { url, statusCode: 302 };
    }
}