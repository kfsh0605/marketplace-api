import {
    ArgumentsHost,
    Catch,
    ExceptionFilter,
    HttpException,
    HttpStatus,
} from '@nestjs/common';
import { Request, Response } from 'express';

const PROBLEM_BASE = 'https://example.com/problems';

const TITLES: Record<number, string> = {
    400: 'Bad Request',
    404: 'Not Found',
    422: 'Unprocessable Entity',
    500: 'Internal Server Error',
    503: 'Service Unavailable',
};

@Catch()
export class ProblemExceptionFilter implements ExceptionFilter {
    catch(exception: unknown, host: ArgumentsHost) {
        const ctx = host.switchToHttp();
        const response = ctx.getResponse<Response>();
        const request = ctx.getRequest<Request>();

        let status = HttpStatus.INTERNAL_SERVER_ERROR;
        let detail = 'Internal server error';

        if (exception instanceof HttpException) {
            status = exception.getStatus();
            const res = exception.getResponse();

            if (typeof res === 'string') {
                detail = res;
            } else if (typeof res === 'object' && res !== null) {
                const message = (res as { message?: string | string[] }).message;
                detail = Array.isArray(message) ? message.join('; ') : (message ?? exception.message);
            }
        } else if (exception instanceof Error) {
            detail = exception.message;
        }

        const title = TITLES[status] ?? 'Error';

        response
            .status(status)
            .type('application/problem+json')
            .json({
                type: `${PROBLEM_BASE}/${status}`,
                title,
                status,
                detail,
                instance: request.originalUrl,
            });
    }
}