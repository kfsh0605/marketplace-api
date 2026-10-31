export const ALLOWED_CONTENT_TYPES = {
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/webp': 'webp',
    'application/pdf': 'pdf',
    'application/gzip': 'gz',
} as const;

export type AllowedContentType = keyof typeof ALLOWED_CONTENT_TYPES;

export const ALLOWED_CONTENT_TYPE_LIST: string[] = Object.keys(ALLOWED_CONTENT_TYPES);

export const MAX_FILE_SIZE_BYTES = 5 * 1024 ** 3;