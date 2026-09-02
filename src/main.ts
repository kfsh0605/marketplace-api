import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { ProblemExceptionFilter } from './common/filters/problem-exception.filter';
import { Env } from './config/env.schema';

async function bootstrap() {
    const app = await NestFactory.create(AppModule);

    app.useGlobalPipes(
        new ValidationPipe({
            whitelist: true,
            forbidNonWhitelisted: true,
            transform: true,
        }),
    );

    app.useGlobalFilters(new ProblemExceptionFilter());

    const config = new DocumentBuilder()
        .setTitle('Marketplace API')
        .setDescription('API для навчального курсового проєкту: товари та замовлення')
        .setVersion('1.0.0')
        .addServer('http://localhost:3000', 'Локальний сервер розробки')
        .build();

    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup('docs', app, document);

    const configService = app.get(ConfigService<Env, true>);
    const port = configService.get('PORT', { infer: true });

    await app.listen(port);
    console.log(`Nest Marketplace API listening on http://localhost:${port}`);
    console.log(`Swagger docs available on http://localhost:${port}/docs`);
}

bootstrap();