import { makePayload, uploadMissingParts } from './multipart-client';

async function main(): Promise<void> {
    const apiBase = process.env.API_BASE ?? '';
    const token = process.env.API_ACCESS_TOKEN ?? '';
    const [fileId, totalRaw, stopAfterRaw] = process.argv.slice(2);

    const payload = makePayload(Number(totalRaw));
    const stopAfter = stopAfterRaw ? Number(stopAfterRaw) : undefined;
    const uploaded = await uploadMissingParts({ apiBase, token }, fileId, payload, stopAfter);
    console.log(JSON.stringify({ uploaded }));
}

main().catch((error: Error) => {
    console.error(error.message);
    process.exit(1);
});