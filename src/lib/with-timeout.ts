/** Відхиляє проміс, якщо він не завершився за ms мілісекунд. Таймер завжди прибирається. */
export function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
    let timer: NodeJS.Timeout;
    const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label}: таймаут ${ms} мс`)), ms);
    });
    return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}