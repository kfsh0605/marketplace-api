import type { Request } from 'express';
import type { AccessPrincipal } from './token.service';

export interface AuthenticatedRequest extends Request {
    user?: AccessPrincipal;
}