import { INestApplication, ValidationPipe } from '@nestjs/common';
import { raw } from 'express';
import { ProblemExceptionFilter } from './common/filters/problem-exception.filter';

/** Шлях вебхука: тут тіло лишається сирими байтами (Buffer), бо підпис рахується над ними. */
export const PAYMENT_WEBHOOK_PATH = '/webhooks/payments';

export function configureApp(app: INestApplication): void {
    // Має стояти ДО JSON-парсера Nest (той підключається в init): розібране тіло вже не можна перевірити підписом
    app.use(PAYMENT_WEBHOOK_PATH, raw({ type: () => true, limit: '64kb' }));

    app.useGlobalPipes(
        new ValidationPipe({
            whitelist: true,
            forbidNonWhitelisted: true,
            transform: true,
        }),
    );

    app.useGlobalFilters(new ProblemExceptionFilter());
}