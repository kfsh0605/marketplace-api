import { AsyncLocalStorage, AsyncResource } from 'node:async_hooks';

export interface RequestContext {
    userId?: string;
    tenant?: string;
    idempotencyKey?: string;
}

const storage = new AsyncLocalStorage<RequestContext>();

export function runWithContext<T>(context: RequestContext, fn: () => T): T {
    return storage.run(context, fn);
}

export function getContext(): RequestContext {
    return storage.getStore() ?? {};
}

export function setContextValue<K extends keyof RequestContext>(key: K, value: RequestContext[K]): void {
    const store = storage.getStore();
    if (store) {
        store[key] = value;
    }
}

export function bindToContext<F extends (...args: any[]) => any>(fn: F): F {
    return AsyncResource.bind(fn);
}