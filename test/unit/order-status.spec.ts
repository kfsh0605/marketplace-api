import { ORDER_STATUSES, ORDER_TRANSITIONS, canTransition, statusesBefore } from '../../src/orders/order-status';

describe('order-status: життєвий цикл замовлення', () => {
    it('основний шлях проходиться крок за кроком', () => {
        const path = ['created', 'pending', 'paid', 'packed', 'shipped', 'delivered'];
        for (let i = 0; i < path.length - 1; i += 1) {
            expect(canTransition(path[i], path[i + 1])).toBe(true);
        }
    });

    it('delivered і cancelled кінцеві: з них нікуди', () => {
        for (const to of ORDER_STATUSES) {
            expect(canTransition('delivered', to)).toBe(false);
            expect(canTransition('cancelled', to)).toBe(false);
        }
    });

    it('назад і через крок не можна', () => {
        expect(canTransition('shipped', 'paid')).toBe(false);
        expect(canTransition('paid', 'created')).toBe(false);
        expect(canTransition('created', 'shipped')).toBe(false);
        expect(canTransition('packed', 'delivered')).toBe(false);
    });

    it('той самий статус не є переходом', () => {
        for (const status of ORDER_STATUSES) {
            expect(canTransition(status, status)).toBe(false);
        }
    });

    it('невідомий статус не має переходів ні звідки, ні куди', () => {
        expect(canTransition('refunded', 'paid')).toBe(false);
        expect(canTransition('paid', 'refunded')).toBe(false);
    });

    it('скасувати можна до пакування, але не після', () => {
        expect(statusesBefore('cancelled')).toEqual(['created', 'pending', 'paid']);
        expect(canTransition('packed', 'cancelled')).toBe(false);
    });

    it('statusesBefore: created ні з чого не досяжний, pending лише з created', () => {
        expect(statusesBefore('created')).toEqual([]);
        expect(statusesBefore('pending')).toEqual(['created']);
    });

    it('таблиця переходів описує кожен статус рівно один раз', () => {
        expect(Object.keys(ORDER_TRANSITIONS).sort()).toEqual([...ORDER_STATUSES].sort());
    });
});
