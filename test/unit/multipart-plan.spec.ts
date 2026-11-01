import {
    expectedPartSize,
    MAX_PARTS,
    MIB,
    MIN_PART_BYTES,
    MULTIPART_THRESHOLD_BYTES,
    planMultipart,
} from '../../src/files/multipart-plan';

const GIB = 1024 * MIB;
const TIB = 1024 * GIB;

describe('planMultipart: розмір частини рахується, а не вписується', () => {
    it('поріг дорівнює двом мінімальним частинам', () => {
        expect(MULTIPART_THRESHOLD_BYTES).toBe(2 * MIN_PART_BYTES);
    });

    it('11 МіБ: три частини 5 + 5 + 1 МіБ', () => {
        const plan = planMultipart(11 * MIB);

        expect(plan).toEqual({ partSize: 5 * MIB, partCount: 3 });
        expect(expectedPartSize(plan, 11 * MIB, 1)).toBe(5 * MIB);
        expect(expectedPartSize(plan, 11 * MIB, 3)).toBe(1 * MIB);
    });

    it('останню частину може бути меншою за мінімум навіть у один байт', () => {
        const total = 10 * MIB + 1;
        const plan = planMultipart(total);

        expect(plan.partCount).toBe(3);
        expect(expectedPartSize(plan, total, 3)).toBe(1);
    });

    it('жорсткі 5 МіБ на 60 ГіБ дали б понад 10 000 частин, а план вкладається', () => {
        const total = 60 * GIB;

        expect(Math.ceil(total / MIN_PART_BYTES)).toBeGreaterThan(MAX_PARTS);
        expect(planMultipart(total).partCount).toBeLessThanOrEqual(MAX_PARTS);
    });

    it.each([MULTIPART_THRESHOLD_BYTES + 1, 100 * MIB, 50 * GIB, 1 * TIB, 5 * TIB])(
        'розмір %d: частин не більше 10 000, усі крім останньої не менші за 5 МіБ, сума збігається з файлом',
        (total) => {
            const plan = planMultipart(total);
            let sum = 0;
            for (let partNumber = 1; partNumber <= plan.partCount; partNumber++) {
                const size = expectedPartSize(plan, total, partNumber);
                if (partNumber < plan.partCount) {
                    expect(size).toBeGreaterThanOrEqual(MIN_PART_BYTES);
                }
                expect(size).toBeGreaterThan(0);
                sum += size;
            }

            expect(plan.partCount).toBeLessThanOrEqual(MAX_PARTS);
            expect(plan.partSize % MIB).toBe(0);
            expect(plan.partSize).toBeLessThanOrEqual(5 * GIB);
            expect(sum).toBe(total);
        },
    );
});