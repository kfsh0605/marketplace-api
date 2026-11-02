export interface ApiAccess {
    apiBase: string;
    token: string;
}

interface PartsListing {
    partSize: number;
    partCount: number;
    parts: Array<{ partNumber: number; size: number }>;
}

interface PartUrls {
    urls: Array<{ partNumber: number; url: string }>;
}

const URL_BATCH = 100;

export function makePayload(size: number): Buffer {
    const buffer = Buffer.allocUnsafe(size);
    let state = 0x9e3779b9;
    for (let index = 0; index < size; index++) {
        state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
        buffer[index] = state >>> 24;
    }
    return buffer;
}

async function callApi<T>(access: ApiAccess, method: string, path: string, body?: unknown): Promise<T> {
    const headers: Record<string, string> = { authorization: `Bearer ${access.token}` };
    if (body !== undefined) {
        headers['content-type'] = 'application/json';
    }
    const response = await fetch(`${access.apiBase}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!response.ok) {
        throw new Error(`${method} ${path}: HTTP ${response.status}`);
    }
    return (await response.json()) as T;
}

export async function uploadMissingParts(
    access: ApiAccess,
    fileId: string,
    payload: Buffer,
    stopAfter?: number,
): Promise<number> {
    const listing = await callApi<PartsListing>(access, 'GET', `/uploads/${fileId}/parts`);
    const present = new Set(listing.parts.map((part) => part.partNumber));
    const missing: number[] = [];
    for (let partNumber = 1; partNumber <= listing.partCount; partNumber++) {
        if (!present.has(partNumber)) {
            missing.push(partNumber);
        }
    }

    let uploaded = 0;
    for (let from = 0; from < missing.length; from += URL_BATCH) {
        const batch = missing.slice(from, from + URL_BATCH);
        const issued = await callApi<PartUrls>(access, 'POST', `/uploads/${fileId}/parts/urls`, {
            partNumbers: batch,
        });
        for (const { partNumber, url } of [...issued.urls].sort((a, b) => a.partNumber - b.partNumber)) {
            const offset = (partNumber - 1) * listing.partSize;
            const chunk = payload.subarray(offset, Math.min(offset + listing.partSize, payload.length));
            const response = await fetch(url, { method: 'PUT', body: new Uint8Array(chunk) });
            await response.arrayBuffer();
            if (!response.ok) {
                throw new Error(`частина ${partNumber}: HTTP ${response.status}`);
            }
            uploaded += 1;
            if (stopAfter !== undefined && uploaded >= stopAfter) {
                process.kill(process.pid, 'SIGKILL');
                process.exit(137);
            }
        }
    }
    return uploaded;
}