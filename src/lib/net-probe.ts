import net from 'node:net';

export function isPortOpen(port: number, host = '127.0.0.1', timeoutMs = 1000): Promise<boolean> {
    return new Promise((resolve) => {
        const socket = net.connect({ host, port });
        socket.setTimeout(timeoutMs);
        socket.once('connect', () => {
            socket.destroy();
            resolve(true);
        });
        socket.once('timeout', () => {
            socket.destroy();
            resolve(false);
        });
        socket.once('error', () => {
            resolve(false);
        });
    });
}