import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ProblemExceptionFilter } from './common/filters/problem-exception.filter';

export function configureApp(app: INestApplication): void {
    app.useGlobalPipes(
        new ValidationPipe({
            whitelist: true,
            forbidNonWhitelisted: true,
            transform: true,
        }),
    );

    app.useGlobalFilters(new ProblemExceptionFilter());
}