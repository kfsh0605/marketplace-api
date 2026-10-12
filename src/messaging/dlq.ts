/** Причини, з яких RabbitMQ відправляє повідомлення в DLX. */
export const DEATH_REASONS = ['rejected', 'expired', 'maxlen', 'delivery_limit'] as const;
export type DeathReason = (typeof DEATH_REASONS)[number];

export interface DeathInfo {
    /** Причина смерті; 'unknown', якщо штампів у заголовках немає */
    reason: string;
    /** З якої черги повідомлення "померло" */
    queue: string | null;
    /** Скільки разів воно помирало з цієї причини в цій черзі */
    count: number;
}

/**
 * Читає "штампи на конверті": заголовок x-death (масив записів, найновіший перший)
 * і запасний x-first-death-reason / x-first-death-queue.
 */
export function readDeathInfo(headers: Record<string, any> | undefined): DeathInfo {
    const xDeath = headers?.['x-death'];
    const first = Array.isArray(xDeath) ? xDeath[0] : undefined;
    const reason = first?.reason ?? headers?.['x-first-death-reason'];
    const queue = first?.queue ?? headers?.['x-first-death-queue'];
    return {
        reason: reason ? String(reason) : 'unknown',
        queue: queue ? String(queue) : null,
        count: Number(first?.count ?? 1),
    };
}