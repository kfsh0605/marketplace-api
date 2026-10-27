import {
    Injectable,
    Logger,
    ServiceUnavailableException,
    UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../entities/user.entity';
import { AccessDenylist } from './access-denylist';
import { TokenPairDto } from './auth.dto';
import { verifyPassword } from './password';
import { RefreshTokenService } from './refresh-token.service';
import { AccessPrincipal, TokenService } from './token.service';
import type { UserRole } from './roles';

const INVALID_CREDENTIALS = 'Невірний email або пароль';
const INVALID_REFRESH = 'Refresh-токен недійсний';

@Injectable()
export class AuthService {
    private readonly logger = new Logger(AuthService.name);

    constructor(
        @InjectRepository(User) private readonly users: Repository<User>,
        private readonly tokens: TokenService,
        private readonly refreshTokens: RefreshTokenService,
        private readonly denylist: AccessDenylist,
    ) {}

    async login(email: string, password: string): Promise<TokenPairDto> {
        const user = await this.users
            .createQueryBuilder('u')
            .addSelect('u.passwordHash')
            .where('u.email = :email', { email })
            .getOne();

        const passwordOk = await verifyPassword(user?.passwordHash, password);
        if (!user || !passwordOk) {
            throw new UnauthorizedException(INVALID_CREDENTIALS);
        }

        const { token, familyId } = await this.refreshTokens.issue(user.id);
        return this.buildPair(user.id, user.role, familyId, token);
    }

    async refresh(refreshToken: string): Promise<TokenPairDto> {
        const result = await this.refreshTokens.rotate(refreshToken);

        if (result.kind === 'rejected') {
            if (result.reason === 'reused' && result.familyId) {
                await this.denylist.revokeFamily(result.familyId).catch((error: Error) => {
                    this.logger.error(
                        `сім'ю ${result.familyId} відкликано в БД, але не вдалося внести в денілист: ${error.message}`,
                    );
                });
            }
            throw new UnauthorizedException(INVALID_REFRESH);
        }

        const user = await this.users.findOneBy({ id: result.userId });
        if (!user) {
            throw new UnauthorizedException(INVALID_REFRESH);
        }
        return this.buildPair(user.id, user.role, result.familyId, result.token);
    }

    async logout(principal: AccessPrincipal): Promise<void> {
        await this.refreshTokens.revokeFamily(principal.familyId);
        try {
            await this.denylist.revokeAccess(principal.jti, principal.expiresAt);
        } catch (error) {
            this.logger.error(
                `logout: refresh-сім'ю ${principal.familyId} відкликано в БД, але jti не внесено в денілист: ${(error as Error).message}`,
            );
            throw new ServiceUnavailableException(
                'Refresh відкликано, але access-токен ще не внесено в денілист: повторіть logout',
            );
        }
    }

    private buildPair(userId: number, role: UserRole, familyId: string, refreshToken: string): TokenPairDto {
        const access = this.tokens.signAccess({ userId, role, familyId });
        return {
            accessToken: access.token,
            refreshToken,
            tokenType: 'Bearer',
            expiresIn: access.expiresIn,
        };
    }
}