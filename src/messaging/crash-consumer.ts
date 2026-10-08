import { startOrderPlacedConsumer } from './consumer';
import { openDemo } from './demo-kit';

/**
 * Споживач, який гине в найнебезпечніший момент: ПІСЛЯ ефекту, але ДО ack.
 * Запускається демо-скриптом як окремий процес. kill -9: жодного close(), жодного ack.
 */
async function main(): Promise<void> {
    const demo = await openDemo();
    await startOrderPlacedConsumer(demo.ch, demo.store, {
        prefetch: 1,
        onDelivery: (d) => console.log(`[crash-consumer] доставка ${d.eventId} #${d.deliveryCount}`),
        afterEffect: (_info, applied) => {
            console.log(
                `[crash-consumer] ефект застосовано (${applied ? 'вперше' : 'дубль'}), ack НЕ надіслано. Вмираю: kill -9`,
            );
            process.kill(process.pid, 'SIGKILL');
            // Сюди виконання не дійде. Якщо раптом дійшло, requeue безпечніший за ack
            return 'requeue';
        },
    });
}

main().catch((err) => {
    console.error('[crash-consumer] помилка запуску:', err);
    process.exit(2);
});