import { ALLOWED_CONTENT_TYPES, AllowedContentType } from './files.constants';

export function extensionFor(contentType: string): string | undefined {
    return Object.prototype.hasOwnProperty.call(ALLOWED_CONTENT_TYPES, contentType)
        ? ALLOWED_CONTENT_TYPES[contentType as AllowedContentType]
        : undefined;
}

export function buildFileKey(userId: number, fileId: string, extension: string): string {
    return `uploads/${userId}/${fileId}.${extension}`;
}