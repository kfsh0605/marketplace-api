import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import * as zlib from 'node:zlib';

export function countOccurrences(text, needle) {
    return text.split(needle).length - 1;
}

function* walk(dir) {
    for (const name of readdirSync(dir)) {
        const full = join(dir, name);
        if (statSync(full).isDirectory()) {
            yield* walk(full);
        } else {
            yield full;
        }
    }
}

function decompress(data) {
    if (data[0] === 0x1f && data[1] === 0x8b) {
        return zlib.gunzipSync(data);
    }
    if (data[0] === 0x28 && data[1] === 0xb5 && data[2] === 0x2f && data[3] === 0xfd && typeof zlib.zstdDecompressSync === 'function') {
        return zlib.zstdDecompressSync(data);
    }
    return data;
}

function isTar(data) {
    return data.length > 262 && data.toString('latin1', 257, 262) === 'ustar';
}

export function countLayersWithToken(unpackedDir, token) {
    const needle = Buffer.from(token);
    let layers = 0;
    let hits = 0;

    for (const file of walk(unpackedDir)) {
        const data = decompress(readFileSync(file));
        if (!isTar(data)) {
            continue;
        }
        layers += 1;
        if (data.includes(needle)) {
            hits += 1;
        }
    }

    return { layers, hits };
}

export function countTokenInImageConfigs(unpackedDir, token) {
    let total = 0;

    for (const file of walk(unpackedDir)) {
        const data = readFileSync(file);
        if (data[0] !== 0x7b) {
            continue;
        }
        const text = data.toString('utf8');
        if (text.includes('"rootfs"')) {
            total += countOccurrences(text, token);
        }
    }

    return total;
}