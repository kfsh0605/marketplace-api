import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ArgumentsHost } from '@nestjs/common';
import { ProblemExceptionFilter } from '../../src/common/filters/problem-exception.filter';

interface Captured {
    status?: number;
    type?: string;
    body?: Record<string, unknown>;
}

function run(exception: unknown): Captured {
    const captured: Captured = {};
    const response = {
        status(code: number) {
            captured.status = code;
            return response;
        },
        type(value: string) {
            captured.type = value;
            return response;
        },
        json(body: Record<string, unknown>) {
            captured.body = body;
            return response;
        },
    };
    const host = {
        switchToHttp: () => ({
            getResponse: () => response,
            getRequest: () => ({ originalUrl: '/orders/1' }),
        }),
    } as unknown as ArgumentsHost;

    new ProblemExceptionFilter().catch(exception, host);
    return captured;
}

describe('ProblemExceptionFilter', () => {
    it('віддає HttpException у форматі problem+json зі своїм статусом', () => {
        const result = run(new NotFoundException('Order 1 not found'));

        expect(result.status).toBe(404);
        expect(result.type).toBe('application/problem+json');
        expect(result.body).toMatchObject({ status: 404, title: 'Not Found', detail: 'Order 1 not found', instance: '/orders/1' });
    });

    it('зводить помилки валідації в один detail', () => {
        const result = run(new BadRequestException(['customerEmail must be an email', 'items must not be empty']));

        expect(result.status).toBe(400);
        expect(result.body?.detail).toBe('customerEmail must be an email; items must not be empty');
    });

    it('не розкриває клієнту текст внутрішньої помилки (500)', () => {
        const result = run(new Error('relation "orders" does not exist: SELECT * FROM orders WHERE secret = 1'));

        expect(result.status).toBe(500);
        expect(result.body).toMatchObject({ status: 500, title: 'Internal Server Error', detail: 'Internal server error' });
        expect(JSON.stringify(result.body)).not.toContain('relation');
    });
});
