export function resolveCacheUrl(): string | null {
    if (process.env.REDIS_DISABLED === '1') {
        return null;
    }
    return process.env.REDIS_URL ?? null;
}