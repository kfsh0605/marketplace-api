import {
    BadRequestException,
    ConflictException,
    Controller,
    Headers,
    HttpCode,
    NotFoundException,
    Post,
    Req,
    ServiceUnavailableException,
    UnauthorizedException,
    UnprocessableEntityException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiExcludeController } from '@nestjs/swagger';
import type { Request } from 'express';
import { Public } from '../auth/public.decorator';
import { Env } from '../config/env.schema';
import { createLogger } from '../observability/logger';
import { parsePaymentEvent } from './payment-event';
import { PaymentWebhookService } from './payment-webhook.service';
import { SIGNATURE_HEADER, verifySignature } from './signature';

const log = createLogger('payment-webhook');

/**
 * Вхідний вебхук платіжного провайдера. JWT тут немає (стукає не користувач), автентичність дає підпис.
 * Сире тіло приходить Buffer-ом від express.raw (див. configure-app.ts), бо HMAC рахується над байтами.
 */
@ApiExcludeController()
@Public()
@Controller('webhooks/payments')
export class PaymentWebhookController {
    constructor(
        private readonly config: ConfigService<Env, true>,
        private readonly service: PaymentWebhookService,
    ) {}

    @Post()
    @HttpCode(200)
    async receive(@Req() req: Request, @Headers(SIGNATURE_HEADER) signature: string | undefined) {
        const secret = this.config.get('PAYMENT_WEBHOOK_SECRET', { infer: true });
        if (!secret) {
            // Закрито за замовчуванням: без секрету підпис перевірити нічим, тож нікого не пропускаємо
            throw new ServiceUnavailableException('Payment webhook is not configured');
        }

        const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
        const check = verifySignature({
            secret,
            header: signature,
            rawBody,
            nowSeconds: Math.floor(Date.now() / 1000),
        });
        if ('reason' in check) {
            log.warn({ reason: check.reason }, 'payment webhook rejected');
            // Причину клієнту не віддаємо: однакова відповідь на відсутній, зламаний, застарілий і чужий підпис
            throw new UnauthorizedException('Invalid webhook signature');
        }

        const parsed = parsePaymentEvent(rawBody);
        if (parsed.kind === 'invalid') {
            throw new BadRequestException(parsed.message);
        }
        if (parsed.kind === 'ignored') {
            return { status: 'ignored' };
        }

        const outcome = await this.service.applySucceeded(parsed.event);
        log.info({ eventId: parsed.event.id, orderId: parsed.event.data.orderId, outcome }, 'payment webhook processed');

        switch (outcome) {
            case 'accepted':
                return { status: 'accepted' };
            case 'duplicate':
                // Провайдер повторює доставку, поки не отримає 2xx: на дубль відповідаємо 200 і нічого не міняємо
                return { status: 'duplicate' };
            case 'order_not_found':
                throw new NotFoundException(`Order ${parsed.event.data.orderId} not found`);
            case 'amount_mismatch':
                throw new UnprocessableEntityException('Amount or currency does not match the order');
            case 'not_payable':
                throw new ConflictException('Order cannot be paid in its current status');
        }
    }
}
