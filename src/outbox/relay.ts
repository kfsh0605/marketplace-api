import type { Pool } from 'pg';
import type { OrderPlacedEvent } from '../messaging/events';
import { sleep } from '../lib/sleep';
import { withTimeout } from '../lib/with-timeout';

/**
 * Как курьер берёт конверты:
 *  skip-locked: FOR UPDATE SKIP LOCKED  (занятые строки пропускаем: рабочий режим)
 *  for-update:  FOR UPDATE              (дублей нет, но курьеры ждут друг друга)
 *  none:        без блокировок          (только для демо: показывает дубли)
 */
export type LockMode = 'skip-locked' | 'for-update' | 'none';

const LOCK_SQL: Record<LockMode, string> = {
    'skip-locked': 'FOR UPDATE SKIP LOCKED',
    'for-update': 'FOR UPDATE',
    none: '',
};

/** Сколько ждём подтверждения брокера. Дольше: считаем конверт неотнесённым и уходим на следующий проход. */
const PUBLISH_TIMEOUT_MS = 5000;

/** Всё, что relay требует от брокера. EventPublisher из ДЗ19 этому подходит. */
export interface RelaySink {
    publish(event: OrderPlacedEvent, routingKey?: string): Promise<void>;
}

export interface RelayOptions {
    /** Сколько конвертов берём за один проход */
    batchSize?: number;
    lockMode?: LockMode;
    /**
     * Брать только строки, созданные не раньше этого момента. Нужно демо: оно работает
     * лишь со своими конвертами и не трогает чужие неотправленные. В рабочем режиме не задаётся.
     */
    notBefore?: Date | string;
    /**
     * Хук для демо. Вызывается ПОСЛЕ publish всей пачки, но ДО UPDATE published_at.
     * Именно сюда демо ставит kill -9: самая опасная точка курьера.
     */
    afterPublish?: (publishedCount: number) => void | Promise<void>;
}

export interface RelayPass {
    /** Сколько конвертов отнесено и отмечено в этом проходе */
    published: number;
    /** 1, если на каком-то конверте publish упал (проход на нём остановился) */
    failed: number;
}

type OutboxRow = {
    id: string;
    type: string;
    payload: OrderPlacedEvent;
};

/** Один проход курьера: взять пачку, отнести, отметить, закрыть транзакцию. */
export async function relayOnce(pool: Pool, sink: RelaySink, options: RelayOptions = {}): Promise<RelayPass> {
    const batchSize = options.batchSize ?? 100;
    const lock = LOCK_SQL[options.lockMode ?? 'skip-locked'];

    // ОДИН клиент на всю транзакцию (см. теорию: pool.query('BEGIN') ушёл бы на случайное соединение)
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // 1. Берём пачку неотнесённых и вешаем на них бирку "занято" (до конца транзакции)
        const { rows } = await client.query<OutboxRow>(
            `SELECT id, type, payload
               FROM outbox
              WHERE published_at IS NULL
                AND ($2::timestamptz IS NULL OR created_at >= $2)
              ORDER BY created_at, id
              ${lock}
              LIMIT $1`,
            [batchSize, options.notBefore ? new Date(options.notBefore).toISOString() : null],
        );

        // 2. Относим каждый конверт брокеру и запоминаем, какие реально доехали
        const sentIds: string[] = [];
        let failedId: string | null = null;

        for (const row of rows) {
            try {
                // publish ждёт подтверждения брокера (publisher confirm), но не дольше таймаута
                await withTimeout(sink.publish(row.payload, row.type), PUBLISH_TIMEOUT_MS, 'publish outbox row');
                sentIds.push(row.id);
            } catch (err) {
                console.error(`[relay] не вдалося опублікувати ${row.payload?.eventId}: ${(err as Error).message}`);
                failedId = row.id;
                break; // решту пачки віднесе наступний прохід
            }
        }

        // ← тут relay может умереть: конверты уже у брокера, а в outbox ещё ничего не отмечено
        await options.afterPublish?.(sentIds.length);

        // 3. Отмечаем "отнесено" ТОЛЬКО то, что реально доехало. Порядок publish → UPDATE менять нельзя.
        if (sentIds.length > 0) {
            await client.query(
                `UPDATE outbox SET published_at = now(), attempts = attempts + 1 WHERE id = ANY($1::uuid[])`,
                [sentIds],
            );
        }
        if (failedId) {
            // упавший конверт: published_at остаётся пустым, но попытку засчитываем
            await client.query(`UPDATE outbox SET attempts = attempts + 1 WHERE id = $1`, [failedId]);
        }

        // 4. COMMIT: бирки снимаются, отметки становятся видимыми остальным
        await client.query('COMMIT');
        return { published: sentIds.length, failed: failedId ? 1 : 0 };
    } catch (err) {
        await client.query('ROLLBACK').catch(() => undefined);
        throw err;
    } finally {
        client.release();
    }
}

export interface RelayLoopOptions extends RelayOptions {
    /** Пауза, когда относить нечего (или проход упал). Это же и задержка доставки: ~pollMs. */
    pollMs?: number;
    signal?: AbortSignal;
    onPass?: (pass: RelayPass) => void;
}

/** Крутит relayOnce, пока не попросят остановиться. Пустой или неудачный проход: пауза pollMs. */
export async function relayLoop(pool: Pool, sink: RelaySink, options: RelayLoopOptions = {}): Promise<void> {
    const pollMs = options.pollMs ?? 500;
    while (!options.signal?.aborted) {
        let pass: RelayPass = { published: 0, failed: 0 };
        try {
            pass = await relayOnce(pool, sink, options);
            options.onPass?.(pass);
        } catch (err) {
            console.error(`[relay] помилка проходу: ${(err as Error).message}`);
        }
        // Есть что относить: сразу следующий проход. Нет или был сбой: передохнуть, не мучая базу
        if (pass.published === 0 || pass.failed > 0) {
            await sleep(pollMs);
        }
    }
}