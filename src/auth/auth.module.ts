import { Inject, Injectable, Module, OnApplicationShutdown } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
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
import { RolesGuard } from './roles.guard';
import { TokenService } from './token.service';
import { SlidingWindowLimiter } from '../ratelimit/sliding-window-limiter';
import { LOGIN_ATTEMPT_LIMIT, LOGIN_ATTEMPT_WINDOW_MS } from './auth.constants';
import { LoginThrottle } from './login-throttle';

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
        {
            provide: LoginThrottle,
            inject: [AUTH_REDIS],
            useFactory: (redis: Redis): LoginThrottle =>
                new LoginThrottle(
                    new SlidingWindowLimiter(redis, {
                        limit: LOGIN_ATTEMPT_LIMIT,
                        windowMs: LOGIN_ATTEMPT_WINDOW_MS,
                        prefix: 'rl:login',
                        failOpen: false,
                    }),
                ),
        },
        KeyStore,
        TokenService,
        RefreshTokenService,
        AuthService,
        { provide: APP_GUARD, useClass: AuthGuard },
        { provide: APP_GUARD, useClass: RolesGuard },
        AuthRedisShutdown,
    ],
    exports: [TokenService, AccessDenylist],
})
export class AuthModule {}