import { expectAtLeast, expectEq, printLines, runStandalone } from './lib/demo-output';
import { Sample, request, scrape, startObsServer, sumOf } from './lib/obs-demo-kit';
import { sleep } from './lib/sleep';

const OK_REQUESTS = 60;
const FAIL_REQUESTS = 15;
const CARDINALITY_REQUESTS = 100;
const CONCURRENCY = 10;
const ROUTE = '/orders/:id';

const totalOf = (samples: Sample[]): number => sumOf(samples, 'http_requests_total');
const errorsOf = (samples: Sample[]): number => sumOf(samples, 'http_requests_total', (labels) => /^5\d\d$/.test(labels.status));
const seriesOf = (samples: Sample[]): number => samples.filter((sample) => sample.name === 'http_requests_total').length;

async function sendAll(port: number, paths: string[]): Promise<number[]> {
    const statuses: number[] = new Array(paths.length);
    let next = 0;
    const worker = async (): Promise<void> => {
        while (next < paths.length) {
            const index = next++;
            statuses[index] = (await request(port, 'GET', paths[index])).status;
        }
    };
    await Promise.all(Array.from({ length: CONCURRENCY }, worker));
    return statuses;
}

async function scrapeUntil(port: number, minTotal: number): Promise<Sample[]> {
    const deadline = Date.now() + 3000;
    let samples = await scrape(port);
    while (totalOf(samples) < minTotal && Date.now() < deadline) {
        await sleep(50);
        samples = await scrape(port);
    }
    return samples;
}

function aboveTopBucket(samples: Sample[], route: string): { above: number; top: number; count: number } {
    const buckets = samples.filter((sample) => sample.name === 'http_request_duration_seconds_bucket' && sample.labels.route === route);
    const finite = buckets.map((sample) => Number(sample.labels.le)).filter((le) => Number.isFinite(le));
    const top = Math.max(...finite);
    const count = sumOf(samples, 'http_request_duration_seconds_count', (labels) => labels.route === route);
    const inTop = buckets.filter((sample) => Number(sample.labels.le) === top).reduce((sum, sample) => sum + sample.value, 0);
    return { above: count - inTop, top, count };
}

runStandalone(async (failures) => {
    const server = await startObsServer();
    try {
        await request(server.port, 'GET', '/orders/warm');
        await sleep(200);
        const before = await scrape(server.port);

        const okPaths = Array.from({ length: OK_REQUESTS }, (_, index) => (index === 0 ? '/orders/slow' : `/orders/red-${index}`));
        const failPaths = Array.from({ length: FAIL_REQUESTS }, () => '/orders/boom');
        const statuses = await sendAll(server.port, [...okPaths, ...failPaths]);
        const sentOk = statuses.filter((status) => status === 200).length;
        const sentFail = statuses.filter((status) => status >= 500).length;

        const afterRed = await scrapeUntil(server.port, totalOf(before) + sentOk + sentFail);
        const counterDelta = totalOf(afterRed) - totalOf(before);
        const errorsDelta = errorsOf(afterRed) - errorsOf(before);

        const seriesBefore = seriesOf(afterRed);
        const ids = Array.from({ length: CARDINALITY_REQUESTS }, (_, index) => `/orders/user-${index}`);
        await sendAll(server.port, ids);
        const afterIds = await scrapeUntil(server.port, totalOf(afterRed) + CARDINALITY_REQUESTS);
        const seriesAfter = seriesOf(afterIds);
        const tail = aboveTopBucket(afterIds, ROUTE);

        printLines({
            'sent-ok': sentOk,
            'sent-fail': sentFail,
            'counter-delta': counterDelta,
            'errors-delta': errorsDelta,
            'above-top-bucket': tail.above,
            'series-before': seriesBefore,
            'series-after': seriesAfter,
            'top-bucket-s': tail.top,
        });

        expectEq(failures, 'sent-ok', sentOk, OK_REQUESTS);
        expectEq(failures, 'sent-fail', sentFail, FAIL_REQUESTS);
        expectAtLeast(failures, 'sent-ok + sent-fail', sentOk + sentFail, 50);
        expectEq(failures, 'counter-delta', counterDelta, sentOk + sentFail);
        expectEq(failures, 'errors-delta', errorsDelta, sentFail);
        expectEq(failures, 'above-top-bucket', tail.above, 0);
        expectEq(failures, 'top-bucket-s is finite', Number.isFinite(tail.top), true);
        expectEq(failures, 'route samples in histogram', tail.count, 1 + sentOk + sentFail + CARDINALITY_REQUESTS);
        expectEq(failures, 'series-after', seriesAfter, seriesBefore);
    } finally {
        await server.stop();
    }
});