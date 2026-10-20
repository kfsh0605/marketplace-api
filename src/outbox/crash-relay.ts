import { EventPublisher } from '../messaging/publisher';
import { createPool } from './pool';
import { relayOnce } from './relay';

/**
 * Relay, який гине в найнебезпечніший момент: ПІСЛЯ publish (брокер уже підтвердив), але ДО UPDATE published_at.
 * Запускається демо-скриптом окремим процесом. kill -9: жодного COMMIT, жодного close().
 */
async function main(): Promise<void> {
    const pool = createPool(2);
    const publisher = new EventPublisher();

    await relayOnce(pool, publisher, {
        notBefore: process.env.RELAY_NOT_BEFORE,
        afterPublish: async (publishedCount) => {
            console.log(
                `[crash-relay] брокер підтвердив ${publishedCount} publish, UPDATE published_at ще НЕ виконано. Вмираю: kill -9`,
            );
            process.kill(process.pid, 'SIGKILL');
            // Сюди виконання не повинно дійти; блокуємося, щоб жоден наступний рядок relay не встиг виконатись
            await new Promise<never>(() => undefined);
        },
    });
}

main().catch((err) => {
    console.error('[crash-relay] помилка запуску:', err);
    process.exit(2);
});