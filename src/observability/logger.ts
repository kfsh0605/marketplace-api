import pino from 'pino';
import { trace } from '@opentelemetry/api';
import { getContext } from './request-context';

const REDACT_PATHS = [
    'req.headers.authorization',
    'req.headers.cookie',
    'req.body.password',
    'req.body.refreshToken',
    'res.body.accessToken',
    'res.body.refreshToken',
    'authorization',
    'password',
    'token',
    '*.password',
    '*.token',
    '*.accessToken',
    '*.refreshToken',
];

export const rootLogger = pino({
    level: process.env.LOG_LEVEL ?? 'info',
    base: { service: process.env.OTEL_SERVICE_NAME ?? 'marketplace-api' },
    timestamp: pino.stdTimeFunctions.isoTime,
    formatters: {
        level: (label) => ({ level: label }),
    },
    mixin() {
        const spanContext = trace.getActiveSpan()?.spanContext();
        return {
            ...getContext(),
            ...(spanContext ? { trace_id: spanContext.traceId, span_id: spanContext.spanId } : {}),
        };
    },
    redact: {
        paths: REDACT_PATHS,
        censor: '[ЗАМАЗАНО]',
    },
});

export function createLogger(layer: string) {
    return rootLogger.child({ layer });
}