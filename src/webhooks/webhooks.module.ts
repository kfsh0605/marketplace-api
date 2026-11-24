import { Module } from '@nestjs/common';
import { OrdersModule } from '../orders/orders.module';
import { PaymentWebhookController } from './payment-webhook.controller';
import { PaymentWebhookService } from './payment-webhook.service';

@Module({
    imports: [OrdersModule],
    controllers: [PaymentWebhookController],
    providers: [PaymentWebhookService],
})
export class WebhooksModule {}
