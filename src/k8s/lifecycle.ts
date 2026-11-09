export type Phase = 'starting' | 'ready' | 'draining' | 'closed';

export class Lifecycle {
    private current: Phase = 'starting';

    get phase(): Phase {
        return this.current;
    }

    get isReady(): boolean {
        return this.current === 'ready';
    }

    markReady(): void {
        if (this.current === 'starting') {
            this.current = 'ready';
        }
    }

    beginDrain(): void {
        if (this.current === 'starting' || this.current === 'ready') {
            this.current = 'draining';
        }
    }

    markClosed(): void {
        this.current = 'closed';
    }
}