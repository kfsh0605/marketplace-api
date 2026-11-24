import { ServiceUnavailableException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import type { Env } from '../../src/config/env.schema';
import { PaymentWebhookController } from '../../src/webhooks/payment-webhook.controller';
import type { PaymentWebhookService } from '../../src/webhooks/payment-webhook.service';
import { parsePaymentEvent } from '../../src/webhooks/payment-event';
import { buildSignatureHeader, computeSignature, verifySignature } from '../../src/webhooks/signature';

const SECRET = 'unit-test-webhook-secret';
const NOW = 1_800_000_000;
const body = Buffer.from('{"id":"evt_1","type":"payment.succeeded","data":{"orderId":1,"amountCents":1000,"currency":"UAH"}}');

const check = (header: string | undefined, rawBody = body, secret = SECRET, nowSeconds = NOW) =>
    verifySignature({ secret, header, rawBody, nowSeconds });

describe('verifySignature: підпис над сирим тілом', () => {
    it('правильний підпис проходить', () => {
        expect(check(buildSignatureHeader(SECRET, body, NOW))).toEqual({ ok: true });
    });

    it('без заголовка: missing', () => {
        expect(check(undefined)).toEqual({ ok: false, reason: 'missing' });
        expect(check('')).toEqual({ ok: false, reason: 'missing' });
    });

    it('зламаний заголовок: malformed (немає t, немає v1, не hex, коротший за 64 символи)', () => {
        for (const header of ['garbage', `v1=${'a'.repeat(64)}`, `t=${NOW}`, `t=${NOW},v1=zz`, `t=${NOW},v1=${'a'.repeat(63)}`]) {
            expect(check(header)).toEqual({ ok: false, reason: 'malformed' });
        }
    });

    it('чужий секрет: mismatch', () => {
        expect(check(buildSignatureHeader('another-secret', body, NOW))).toEqual({ ok: false, reason: 'mismatch' });
    });

    it('змінене тіло: mismatch (підпис прив\'язаний до байтів)', () => {
        const header = buildSignatureHeader(SECRET, body, NOW);
        expect(check(header, Buffer.from(body.toString().replace('1000', '1'))).ok).toBe(false);
    });

    it('тіло, розібране й записане заново, має інші байти й не збігається', () => {
        const pretty = Buffer.from(JSON.stringify(JSON.parse(body.toString()), null, 2));
        const header = buildSignatureHeader(SECRET, pretty, NOW);
        expect(check(header, body)).toEqual({ ok: false, reason: 'mismatch' });
    });

    it('мітку часу підмінити не можна: підпис рахується разом із нею', () => {
        const signature = computeSignature(SECRET, NOW, body);
        expect(check(`t=${NOW + 1},v1=${signature}`)).toEqual({ ok: false, reason: 'mismatch' });
    });

    it('застаріла подія з вірним підписом: stale; межа допуску включно', () => {
        expect(check(buildSignatureHeader(SECRET, body, NOW - 301))).toEqual({ ok: false, reason: 'stale' });
        expect(check(buildSignatureHeader(SECRET, body, NOW + 301))).toEqual({ ok: false, reason: 'stale' });
        expect(check(buildSignatureHeader(SECRET, body, NOW - 300))).toEqual({ ok: true });
    });

    it('кілька v1 (ротація секрету): достатньо одного вірного', () => {
        const good = computeSignature(SECRET, NOW, body);
        expect(check(`t=${NOW},v1=${'0'.repeat(64)},v1=${good}`)).toEqual({ ok: true });
    });
});

describe('parsePaymentEvent', () => {
    const parse = (value: unknown) => parsePaymentEvent(Buffer.from(typeof value === 'string' ? value : JSON.stringify(value)));

    it('payment.succeeded розбирається', () => {
        const result = parsePaymentEvent(body);
        expect(result.kind).toBe('succeeded');
        if (result.kind === 'succeeded') {
            expect(result.event.data).toEqual({ orderId: 1, amountCents: 1000, currency: 'UAH' });
        }
    });

    it('інший тип події: ignored, без перевірки data', () => {
        expect(parse({ id: 'evt_2', type: 'payment.refunded' })).toEqual({ kind: 'ignored', id: 'evt_2', type: 'payment.refunded' });
    });

    it('не JSON, немає id, сума не ціла, від\'ємна або валюта не з трьох літер: invalid', () => {
        const ok = { id: 'e', type: 'payment.succeeded', data: { orderId: 1, amountCents: 5, currency: 'UAH' } };
        expect(parse('not json').kind).toBe('invalid');
        expect(parse({ type: 'payment.succeeded' }).kind).toBe('invalid');
        expect(parse({ ...ok, data: { ...ok.data, amountCents: 1.5 } }).kind).toBe('invalid');
        expect(parse({ ...ok, data: { ...ok.data, amountCents: -1 } }).kind).toBe('invalid');
        expect(parse({ ...ok, data: { ...ok.data, currency: 'UAHH' } }).kind).toBe('invalid');
        expect(parse({ ...ok, data: { ...ok.data, orderId: '1' } }).kind).toBe('invalid');
    });
});

describe('PaymentWebhookController без секрету', () => {
    it('закрито за замовчуванням: 503, а не «пропускаємо без перевірки»', async () => {
        const config = { get: () => undefined } as unknown as ConfigService<Env, true>;
        const controller = new PaymentWebhookController(config, {} as PaymentWebhookService);
        await expect(controller.receive({ body } as Request, buildSignatureHeader(SECRET, body, NOW))).rejects.toBeInstanceOf(
            ServiceUnavailableException,
        );
    });
});
