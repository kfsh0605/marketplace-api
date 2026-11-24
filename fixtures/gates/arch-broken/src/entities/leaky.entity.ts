// Зумисне зламаний вхід для сходинки «архітектура»: сутність домену тягне HTTP-контролер.
import { OrdersController } from '../orders/orders.controller';

export class LeakyEntity {
    controller = new OrdersController();
}
