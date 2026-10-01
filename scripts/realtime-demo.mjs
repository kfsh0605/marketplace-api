import { io } from 'socket.io-client';

const BASE_URL = process.env.DEMO_BASE_URL ?? 'http://localhost:3000';
const ORDER_A = Number(process.env.DEMO_ORDER_A ?? 1);
const ORDER_B = Number(process.env.DEMO_ORDER_B ?? 7);
const USER_ID = Number(process.env.DEMO_USER_ID ?? 1);
const SAME_ROOM = process.argv.includes('--same-room');
const TIMEOUT_MS = 3000;

const roomBOrderId = SAME_ROOM ? ORDER_A : ORDER_B;
const expectedBReceived = SAME_ROOM ? 1 : 0;

function connectAndJoin(label, orderId) {
    return new Promise((resolve, reject) => {
        const socket = io(BASE_URL, { forceNew: true });

        const timer = setTimeout(() => {
            socket.close();
            reject(new Error(`[${label}] timed out connecting/joining orders:${orderId}`));
        }, TIMEOUT_MS);

        socket.on('connect_error', (err) => {
            clearTimeout(timer);
            reject(new Error(`[${label}] connect_error: ${err.message}`));
        });

        socket.on('connect', () => {
            socket.emit('join', { orderId, userId: USER_ID }, (ack) => {
                clearTimeout(timer);
                if (!ack?.joined) {
                    reject(new Error(`[${label}] join rejected: ${ack?.reason ?? 'unknown reason'}`));
                    return;
                }
                resolve(socket);
            });
        });
    });
}

function waitForStatusEvent(socket, timeoutMs) {
    return new Promise((resolve) => {
        const timer = setTimeout(() => resolve(false), timeoutMs);
        socket.once('order.status', () => {
            clearTimeout(timer);
            resolve(true);
        });
    });
}

async function changeStatus(orderId, status) {
    const res = await fetch(`${BASE_URL}/orders/${orderId}/status`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ status }),
    });
    if (!res.ok) {
        throw new Error(`PATCH /orders/${orderId}/status failed: ${res.status} ${await res.text()}`);
    }
}

async function main() {
    console.error(`Режим: ${SAME_ROOM ? '--same-room (контрольний)' : 'основний'}`);
    console.error(`Клієнт A слухає orders:${ORDER_A}, клієнт B слухає orders:${roomBOrderId}`);

    const clientA = await connectAndJoin('A', ORDER_A);
    const clientB = await connectAndJoin('B', roomBOrderId);

    // Обидва listener'и реєструємо ДО зміни статусу — інакше подія могла б
    // вилетіти раніше, ніж ми почали її чекати.
    const aReceivedPromise = waitForStatusEvent(clientA, TIMEOUT_MS);
    const bReceivedPromise = waitForStatusEvent(clientB, TIMEOUT_MS);

    await changeStatus(ORDER_A, 'packed');

    const [aReceived, bReceived] = await Promise.all([aReceivedPromise, bReceivedPromise]);

    console.log(`A_RECEIVED=${aReceived ? 1 : 0}`);
    console.log(`B_RECEIVED=${bReceived ? 1 : 0}`);

    clientA.close();
    clientB.close();

    const aOk = aReceived === true;
    const bOk = (bReceived ? 1 : 0) === expectedBReceived;

    process.exit(aOk && bOk ? 0 : 1);
}

main().catch((err) => {
    console.error('realtime-demo failed:', err.message);
    process.exit(1);
});