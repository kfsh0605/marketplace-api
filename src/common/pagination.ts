export interface PaginatedResult<T> {
    items: T[];
    next_cursor: string | null;
}

export function encodeCursor(id: string): string {
    return Buffer.from(JSON.stringify({ id })).toString('base64url');
}

export function decodeCursor(cursor: string): { id: string } | null {
    try {
        const decoded = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
        if (typeof decoded?.id !== 'string') return null;
        return decoded;
    } catch {
        return null;
    }
}

export function paginate<T extends { id: string }>(
    list: T[],
    { limit, cursor }: { limit: number; cursor?: string },
): PaginatedResult<T> {
    let startIndex = 0;

    if (cursor) {
        const decoded = decodeCursor(cursor);
        if (decoded) {
            const foundIndex = list.findIndex((item) => item.id === decoded.id);
            if (foundIndex !== -1) {
                startIndex = foundIndex + 1;
            }
        }
    }

    const page = list.slice(startIndex, startIndex + limit);
    const hasMore = startIndex + limit < list.length;
    const lastItem = page[page.length - 1];
    const next_cursor = hasMore && lastItem ? encodeCursor(lastItem.id) : null;

    return { items: page, next_cursor };
}