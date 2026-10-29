import { SetMetadata } from '@nestjs/common';
import type { UserRole } from './roles';

export const ROLES_KEY = 'requiredRoles';

export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES_KEY, roles);