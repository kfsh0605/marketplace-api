import type { Logger } from 'typeorm';

export class QueryCounter implements Logger {
    private readonly counts = new Map<string, number>();

    constructor(private readonly tags: string[]) {}

    logQuery(query: string): void {
        for (const tag of this.tags) {
            if (query.includes(tag)) {
                this.counts.set(tag, (this.counts.get(tag) ?? 0) + 1);
            }
        }
    }

    count(tag: string): number {
        return this.counts.get(tag) ?? 0;
    }

    reset(): void {
        this.counts.clear();
    }

    logQueryError(): void {}

    logQuerySlow(): void {}

    logSchemaBuild(): void {}

    logMigration(): void {}

    log(): void {}
}