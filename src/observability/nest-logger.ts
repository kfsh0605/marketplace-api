import type { LoggerService } from '@nestjs/common';
import { createLogger } from './logger';

type Level = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';

const logger = createLogger('nest');

function text(message: unknown): string {
    if (typeof message === 'string') {
        return message;
    }
    if (message instanceof Error) {
        return message.message;
    }
    return JSON.stringify(message);
}

function write(level: Level, message: unknown, params: unknown[]): void {
    const strings = params.filter((item): item is string => typeof item === 'string');
    const context = strings.length > 0 ? strings[strings.length - 1] : undefined;
    const stack = level === 'error' && strings.length > 1 ? strings[0] : undefined;
    logger[level]({ context, ...(stack ? { stack } : {}) }, text(message));
}

export class PinoNestLogger implements LoggerService {
    log(message: unknown, ...params: unknown[]): void {
        write('info', message, params);
    }

    error(message: unknown, ...params: unknown[]): void {
        write('error', message, params);
    }

    warn(message: unknown, ...params: unknown[]): void {
        write('warn', message, params);
    }

    debug(message: unknown, ...params: unknown[]): void {
        write('debug', message, params);
    }

    verbose(message: unknown, ...params: unknown[]): void {
        write('trace', message, params);
    }

    fatal(message: unknown, ...params: unknown[]): void {
        write('fatal', message, params);
    }
}