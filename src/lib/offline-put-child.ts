const FORBIDDEN = /STORAGE|AWS_|JWT|SECRET|ACCESS_KEY|PASSWORD|DATABASE|TOKEN/i;

async function main(): Promise<void> {
    const leaked = Object.keys(process.env).filter((name) => FORBIDDEN.test(name));
    if (leaked.length > 0) {
        console.error(`у середовищі є ключі: ${leaked.join(', ')}`);
        process.exit(3);
    }

    const [url, contentType] = process.argv.slice(2);
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) {
        chunks.push(chunk as Buffer);
    }

    try {
        const response = await fetch(url, {
            method: 'PUT',
            headers: { 'content-type': contentType },
            body: Buffer.concat(chunks),
        });
        await response.arrayBuffer();
        console.log(response.status);
    } catch {
        console.log(0);
    }
}

void main();