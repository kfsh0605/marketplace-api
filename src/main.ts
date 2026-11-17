import './observability/tracing';
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { SwaggerModule } from '@nestjs/swagger';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { AppModule } from './app.module';
import { configureApp } from './configure-app';
import { buildSwaggerConfig } from './swagger-config';
import { Env } from './config/env.schema';
import { createLogger } from './observability/logger';
import { configureObservability } from './observability/nest-setup';

const log = createLogger('bootstrap');

async function bootstrap() {
    const app = await NestFactory.create(AppModule, { bufferLogs: true });

    configureObservability(app);

    app.useWebSocketAdapter(new IoAdapter(app));

    configureApp(app);

    const document = SwaggerModule.createDocument(app, buildSwaggerConfig());
    SwaggerModule.setup('docs', app, document);

    const configService = app.get(ConfigService<Env, true>);
    const trustProxyHops = configService.get('TRUST_PROXY_HOPS', { infer: true });
    if (trustProxyHops > 0) {
        app.getHttpAdapter().getInstance().set('trust proxy', trustProxyHops);
    }
    const port = configService.get('PORT', { infer: true });

    await app.listen(port);
    log.info({ port }, 'Nest Marketplace API listening');
    log.info({ docs: `http://localhost:${port}/docs` }, 'Swagger docs available');
}

bootstrap();