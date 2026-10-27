import { Inject, Injectable, Module, OnApplicationShutdown } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import type { Redis } from 'ioredis';
import { User } from '../entities/user.entity';
import { createSessionClient } from '../redis/connect';
import { AUTH_REDIS } from '../redis/tokens';
import { AccessDenylist } from './access-denylist';
import { AuthController } from './auth.controller';
import { AuthGuard } from './auth.guard';
import { AuthService } from './auth.service';
import { KeyStore } from './key-store';
import { RefreshTokenService } from './refresh-token.service';
import { TokenService } from './token.service';

@Injectable()
class AuthRedisShutdown implements OnApplicationShutdown {
    constructor(@Inject(AUTH_REDIS) private readonly redis: Redis) {}

    async onApplicationShutdown(): Promise<void> {
        await this.redis.quit().catch(() => undefined);
    }
}

@Module({
    imports: [TypeOrmModule.forFeature([User])],
    controllers: [AuthController],
    providers: [
        { provide: AUTH_REDIS, useFactory: (): Promise<Redis> => createSessionClient() },
        {
            provide: AccessDenylist,
            inject: [AUTH_REDIS],
            useFactory: (redis: Redis): AccessDenylist => new AccessDenylist(redis),
        },
        KeyStore,
        TokenService,
        RefreshTokenService,
        AuthService,
        AuthGuard,
        AuthRedisShutdown,
    ],
    exports: [TokenService, AccessDenylist, AuthGuard],
})
export class AuthModule {}