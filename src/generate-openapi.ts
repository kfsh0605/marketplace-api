import 'reflect-metadata';
import { writeFileSync } from 'fs';
import { resolve } from 'path';
import { dump } from 'js-yaml';
import { NestFactory } from '@nestjs/core';
import { SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { buildSwaggerConfig } from './swagger-config';

async function main() {
    const app = await NestFactory.create(AppModule, { logger: false });

    const document = SwaggerModule.createDocument(app, buildSwaggerConfig());
    const yaml = dump(document, { noRefs: true });

    const outPath = resolve(process.cwd(), 'openapi.yaml');
    writeFileSync(outPath, yaml, 'utf8');
    console.log(`OpenAPI-специфікація записана в ${outPath}`);

    await app.close();
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});