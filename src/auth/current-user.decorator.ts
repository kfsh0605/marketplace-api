import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { AuthenticatedRequest } from './authenticated-request';
import type { AccessPrincipal } from './token.service';

export const CurrentUser = createParamDecorator((_data: unknown, context: ExecutionContext): AccessPrincipal => {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (!request.user) {
        throw new Error('CurrentUser використано на маршруті без AuthGuard');
    }
    return request.user;
});