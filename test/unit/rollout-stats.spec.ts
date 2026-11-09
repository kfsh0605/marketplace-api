export {};

const { summarizeCodes, formatCodes, judge } = require('../../demo/lib/rollout-stats.cjs');

describe('rollout: підсумок рахується з файлу кодів відповіді', () => {
    it('рахує запити, успішні та невдалі, включно з 000 для обриву', () => {
        const result = summarizeCodes('200\n200\n503\n000\n200\n');
        expect(result.requests).toBe(5);
        expect(result.ok).toBe(3);
        expect(result.failed).toBe(2);
        expect(result.byCode).toEqual({ '200': 3, '503': 1, '000': 1 });
    });

    it('порожній файл дає нуль запитів, а не NaN', () => {
        expect(summarizeCodes('')).toEqual({ requests: 0, ok: 0, failed: 0, byCode: {} });
    });

    it('ігнорує порожні рядки та CRLF', () => {
        expect(summarizeCodes('200\r\n\r\n200\r\n').requests).toBe(2);
    });

    it('форматує коди відсортовано', () => {
        expect(formatCodes({ '503': 1, '200': 9 })).toBe('200:9,503:1');
    });
});

describe('rollout: вердикт', () => {
    const good = { profile: 'zero', requests: 6000, failed: 0, oldRev: 3000, newRev: 3000, minRequests: 5000 };

    it('проходить, коли все добре', () => {
        expect(judge(good)).toEqual([]);
    });

    it('падає, якщо є хоч один невдалий запит у профілі zero', () => {
        expect(judge({ ...good, failed: 1 })).toHaveLength(1);
    });

    it('падає, якщо запитів менше за мінімум', () => {
        expect(judge({ ...good, requests: 4999 })).toHaveLength(1);
    });

    it('падає, якщо відповіді не з обох ревізій: оновлення не було під навантаженням', () => {
        expect(judge({ ...good, newRev: 0 })).toHaveLength(1);
        expect(judge({ ...good, oldRev: 0 })).toHaveLength(1);
    });

    it('у контрольному профілі naive втрати не вважаються помилкою', () => {
        expect(judge({ ...good, profile: 'naive', failed: 40 })).toEqual([]);
    });
});
