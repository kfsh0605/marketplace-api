import { DocumentBuilder } from '@nestjs/swagger';

export function buildSwaggerConfig() {
    return new DocumentBuilder()
        .setTitle('Marketplace API')
        .setDescription('API для навчального курсового проєкту: товари та замовлення')
        .setVersion('1.0.0')
        .addServer('http://localhost:3000', 'Локальний сервер розробки')
        .build();
}