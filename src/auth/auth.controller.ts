import { Body, Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import {
    ApiBearerAuth,
    ApiNoContentResponse,
    ApiOkResponse,
    ApiOperation,
    ApiServiceUnavailableResponse,
    ApiTags,
    ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { LoginDto, RefreshDto, TokenPairDto } from './auth.dto';
import { AuthGuard } from './auth.guard';
import { AuthService } from './auth.service';
import { CurrentUser } from './current-user.decorator';
import type { AccessPrincipal } from './token.service';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
    constructor(private readonly auth: AuthService) {}

    @Post('login')
    @HttpCode(200)
    @ApiOperation({ operationId: 'login', summary: 'Увійти за email і паролем' })
    @ApiOkResponse({ type: TokenPairDto })
    @ApiUnauthorizedResponse({ description: 'Невірний email або пароль' })
    login(@Body() dto: LoginDto): Promise<TokenPairDto> {
        return this.auth.login(dto.email, dto.password);
    }

    @Post('refresh')
    @HttpCode(200)
    @ApiOperation({ operationId: 'refreshTokens', summary: 'Обміняти refresh-токен на нову пару (ротація)' })
    @ApiOkResponse({ type: TokenPairDto })
    @ApiUnauthorizedResponse({ description: 'Refresh невідомий, використаний повторно, відкликаний або протермінований' })
    refresh(@Body() dto: RefreshDto): Promise<TokenPairDto> {
        return this.auth.refresh(dto.refreshToken);
    }

    @Post('logout')
    @HttpCode(204)
    @UseGuards(AuthGuard)
    @ApiBearerAuth()
    @ApiOperation({ operationId: 'logout', summary: 'Вийти: відкликати refresh-сім\'ю й access-токен' })
    @ApiNoContentResponse({ description: 'Сесію завершено' })
    @ApiUnauthorizedResponse({ description: 'Немає або недійсний access-токен' })
    @ApiServiceUnavailableResponse({ description: 'Денілист недоступний: повторіть logout' })
    logout(@CurrentUser() principal: AccessPrincipal): Promise<void> {
        return this.auth.logout(principal);
    }
}