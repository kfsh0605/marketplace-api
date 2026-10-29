import { Body, Controller, HttpCode, HttpException, HttpStatus, Ip, Post, Res } from '@nestjs/common';
import type { Response } from 'express';
import {
    ApiBearerAuth,
    ApiNoContentResponse,
    ApiOkResponse,
    ApiOperation,
    ApiServiceUnavailableResponse,
    ApiTags,
    ApiTooManyRequestsResponse,
    ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { LoginDto, RefreshDto, TokenPairDto } from './auth.dto';
import { AuthService } from './auth.service';
import { CurrentUser } from './current-user.decorator';
import { Public } from './public.decorator';
import type { AccessPrincipal } from './token.service';
import { LoginThrottle } from './login-throttle';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
    constructor(
        private readonly auth: AuthService,
        private readonly throttle: LoginThrottle,
    ) {}

    @Post('login')
    @Public()
    @HttpCode(200)
    @ApiOperation({ operationId: 'login', summary: 'Увійти за email і паролем' })
    @ApiOkResponse({ type: TokenPairDto })
    @ApiUnauthorizedResponse({ description: 'Невірний email або пароль' })
    @Post('login')
    @Public()
    @HttpCode(200)
    @ApiOperation({ operationId: 'login', summary: 'Увійти за email і паролем' })
    @ApiOkResponse({ type: TokenPairDto })
    @ApiUnauthorizedResponse({ description: 'Невірний email або пароль' })
    @ApiTooManyRequestsResponse({ description: 'Забагато спроб входу з цього IP для цього email; див. Retry-After' })
    @ApiServiceUnavailableResponse({ description: 'Не вдалося перевірити ліміт спроб: повторіть пізніше' })
    async login(
        @Body() dto: LoginDto,
        @Ip() ip: string,
        @Res({ passthrough: true }) res: Response,
    ): Promise<TokenPairDto> {
        const verdict = await this.throttle.consume(ip, dto.email);
        if (!verdict.allowed) {
            res.setHeader('Retry-After', String(verdict.retryAfterSec));
            throw new HttpException('Забагато спроб входу, спробуйте пізніше', HttpStatus.TOO_MANY_REQUESTS);
        }
        return this.auth.login(dto.email, dto.password);
    }

    @Post('refresh')
    @Public()
    @HttpCode(200)
    @ApiOperation({ operationId: 'refreshTokens', summary: 'Обміняти refresh-токен на нову пару (ротація)' })
    @ApiOkResponse({ type: TokenPairDto })
    @ApiUnauthorizedResponse({ description: 'Refresh невідомий, використаний повторно, відкликаний або протермінований' })
    refresh(@Body() dto: RefreshDto): Promise<TokenPairDto> {
        return this.auth.refresh(dto.refreshToken);
    }

    @Post('logout')
    @HttpCode(204)
    @ApiBearerAuth()
    @ApiOperation({ operationId: 'logout', summary: 'Вийти: відкликати refresh-сім\'ю й access-токен' })
    @ApiNoContentResponse({ description: 'Сесію завершено' })
    @ApiUnauthorizedResponse({ description: 'Немає або недійсний access-токен' })
    @ApiServiceUnavailableResponse({ description: 'Денілист недоступний: повторіть logout' })
    logout(@CurrentUser() principal: AccessPrincipal): Promise<void> {
        return this.auth.logout(principal);
    }
}