import {
    CanActivate,
    ExecutionContext,
    Injectable,
    Logger,
    ServiceUnavailableException,
    UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Response } from 'express';
import { AccessDenylist } from './access-denylist';
import type { AuthenticatedRequest } from './authenticated-request';
import { IS_PUBLIC_KEY } from './public.decorator';
import { AccessPrincipal, TokenService } from './token.service';

const BEARER_PATTERN = /^Bearer\s+(\S+)$/i;

@Injectable()
export class AuthGuard implements CanActivate {
    private readonly logger = new Logger(AuthGuard.name);

    constructor(
        private readonly tokens: TokenService,
        private readonly denylist: AccessDenylist,
        private readonly reflector: Reflector,
    ) {}

    async canActivate(context: ExecutionContext): Promise<boolean> {
        if (context.getType() !== 'http') {
            return true;
        }

        const isPublic = this.reflector.getAllAndOverride<boolean | undefined>(IS_PUBLIC_KEY, [
            context.getHandler(),
            context.getClass(),
        ]);
        if (isPublic) {
            return true;
        }

        const http = context.switchToHttp();
        const request = http.getRequest<AuthenticatedRequest>();
        const response = http.getResponse<Response>();

        const match = BEARER_PATTERN.exec(request.headers.authorization ?? '');
        if (!match) {
            throw this.unauthorized(response, 'Потрібен заголовок Authorization: Bearer <access-токен>');
        }

        let principal: AccessPrincipal;
        try {
            principal = this.tokens.verifyAccess(match[1]);
        } catch {
            throw this.unauthorized(response, 'Access-токен недійсний або прострочений');
        }

        let denied: boolean;
        try {
            denied = await this.denylist.isDenied(principal);
        } catch (error) {
            this.logger.error(`денілист недоступний, запит відхилено (fail-closed): ${(error as Error).message}`);
            throw new ServiceUnavailableException('Не вдалося перевірити відкликання токена, спробуйте пізніше');
        }
        if (denied) {
            throw this.unauthorized(response, 'Access-токен відкликано');
        }

        request.user = principal;
        return true;
    }

    private unauthorized(response: Response, detail: string): UnauthorizedException {
        response.setHeader('WWW-Authenticate', 'Bearer');
        return new UnauthorizedException(detail);
    }
}