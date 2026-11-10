import { NodeSDK } from '@opentelemetry/sdk-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { BatchSpanProcessor } from '@opentelemetry/sdk-trace';
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http';
import { ExpressInstrumentation } from '@opentelemetry/instrumentation-express';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { ATTR_SERVICE_NAME } from '@opentelemetry/semantic-conventions';

const serviceName = process.env.OTEL_SERVICE_NAME ?? 'marketplace-api';

const spanProcessor = new BatchSpanProcessor({
    exporter: new OTLPTraceExporter(),
    scheduledDelayMillis: 500,
});

const sdk = new NodeSDK({
    resource: resourceFromAttributes({ [ATTR_SERVICE_NAME]: serviceName }),
    spanProcessors: [spanProcessor],
    instrumentations: [new HttpInstrumentation(), new ExpressInstrumentation()],
});

sdk.start();

export async function flushTraces(): Promise<void> {
    await spanProcessor.forceFlush();
}

export async function shutdownTracing(): Promise<void> {
    await sdk.shutdown();
}