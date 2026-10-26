import { createSessionClient } from './redis/connect';
import { SessionStore } from './sessions/session-store';

async function main(): Promise<void> {
    const sid = process.argv[2];
    const ttlSec = Number(process.argv[3]);
    const redis = await createSessionClient();
    try {
        const session = await new SessionStore(redis, { ttlSec }).get(sid);
        console.log(`found=${session ? 1 : 0}`);
    } finally {
        await redis.quit();
    }
}

main().catch((err) => {
    console.error(err);
    process.exit(2);
});