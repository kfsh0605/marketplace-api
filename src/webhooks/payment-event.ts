import { z } from 'zod';

/** Подія, яка нас цікавить: платіж пройшов. Решту типів провайдера підтверджуємо 200 і ігноруємо. */
export const PAYMENT_SUCCEEDED = 'payment.succeeded';

const envelopeSchema = z.object({
    id: z.string().min(1).max(128),
    type: z.string().min(1).max(64),
});

const succeededSchema = envelopeSchema.extend({
    type: z.literal(PAYMENT_SUCCEEDED),
    data: z.object({
        orderId: z.number().int().positive(),
        amountCents: z.number().int().nonnegative(),
        currency: z.string().length(3),
    }),
});

export type PaymentSucceeded = z.infer<typeof succeededSchema>;

export type ParsedPaymentEvent =
    | { kind: 'succeeded'; event: PaymentSucceeded }
    | { kind: 'ignored'; id: string; type: string }
    | { kind: 'invalid'; message: string };

export function parsePaymentEvent(rawBody: Buffer): ParsedPaymentEvent {
    let json: unknown;
    try {
        json = JSON.parse(rawBody.toString('utf8'));
    } catch {
        return { kind: 'invalid', message: 'Body is not valid JSON' };
    }

    const envelope = envelopeSchema.safeParse(json);
    if (!envelope.success) {
        return { kind: 'invalid', message: 'Event must have string fields "id" and "type"' };
    }
    if (envelope.data.type !== PAYMENT_SUCCEEDED) {
        return { kind: 'ignored', id: envelope.data.id, type: envelope.data.type };
    }

    const succeeded = succeededSchema.safeParse(json);
    if (!succeeded.success) {
        const detail = succeeded.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ');
        return { kind: 'invalid', message: `Invalid payment.succeeded payload: ${detail}` };
    }
    return { kind: 'succeeded', event: succeeded.data };
}
