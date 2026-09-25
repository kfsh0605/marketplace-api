import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { configureApp } from './configure-app';
import { buildSwaggerConfig } from './swagger-config';
import { Env } from './config/env.schema';

async function bootstrap() {
    const app = await NestFactory.create(AppModule);

    configureApp(app);

    const document = SwaggerModule.createDocument(app, buildSwaggerConfig());
    SwaggerModule.setup('docs', app, document);

    const configService = app.get(ConfigService<Env, true>);
    const port = configService.get('PORT', { infer: true });

    await app.listen(port);
    console.log(`Nest Marketplace API listening on http://localhost:${port}`);
    console.log(`Swagger docs available on http://localhost:${port}/docs`);
}

bootstrap();