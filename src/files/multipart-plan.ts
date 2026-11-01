export const MIB = 1024 * 1024;
export const MIN_PART_BYTES = 5 * MIB;
export const MAX_PARTS = 10_000;
export const MULTIPART_THRESHOLD_BYTES = 2 * MIN_PART_BYTES;

export interface MultipartPlan {
    partSize: number;
    partCount: number;
}

export function planMultipart(totalSize: number): MultipartPlan {
    const neededForCount = Math.ceil(totalSize / MAX_PARTS);
    const partSize = Math.ceil(Math.max(MIN_PART_BYTES, neededForCount) / MIB) * MIB;
    return { partSize, partCount: Math.ceil(totalSize / partSize) };
}

export function expectedPartSize(plan: MultipartPlan, totalSize: number, partNumber: number): number {
    return partNumber < plan.partCount ? plan.partSize : totalSize - plan.partSize * (plan.partCount - 1);
}