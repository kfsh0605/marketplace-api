export const CARD_TTL_BASE_SEC = 300;
export const CARD_TTL_SPREAD_SEC = 60;
export const NEGATIVE_TTL_SEC = 30;

export function jitteredTtl(
    baseSec: number = CARD_TTL_BASE_SEC,
    spreadSec: number = CARD_TTL_SPREAD_SEC,
): number {
    return baseSec + Math.floor(Math.random() * (spreadSec + 1));
}