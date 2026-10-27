import {
    CanActivate,
    ExecutionContext,
    ForbiddenException,
    Injectable,
    UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../entities/user.entity';
import type { AuthenticatedRequest } from './authenticated-request';
import { ROLES_KEY } from './roles.decorator';
import type { UserRole } from './roles';

@Injectable()
export class RolesGuard implements CanActivate {
    constructor(
        private readonly reflector: Reflector,
        @InjectRepository(User) private readonly users: Repository<User>,
    ) {}

    async canActivate(context: ExecutionContext): Promise<boolean> {
        if (context.getType() !== 'http') {
            return true;
        }

        const required = this.reflector.getAllAndOverride<UserRole[] | undefined>(ROLES_KEY, [
            context.getHandler(),
            context.getClass(),
        ]);
        if (!required || required.length === 0) {
            return true;
        }

        const principal = context.switchToHttp().getRequest<AuthenticatedRequest>().user;
        if (!principal) {
            throw new UnauthorizedException('Потрібна автентифікація');
        }

        const current = await this.users.findOne({
            where: { id: principal.userId },
            select: { id: true, role: true },
        });
        if (!current) {
            throw new UnauthorizedException('Обліковий запис більше не існує');
        }
        if (!required.includes(current.role)) {
            throw new ForbiddenException(`Недостатньо прав: потрібна роль ${required.join(' або ')}`);
        }
        return true;
    }
}