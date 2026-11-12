process.env.OTEL_SERVICE_NAME = 'demo-trace-client';
process.env.OTEL_EXPORTER_OTLP_ENDPOINT = process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? 'http://127.0.0.1:22918';

export {};