import { buildFileKey, extensionFor } from '../../src/files/file-key';

describe('ключ об\'єкта генерується сервером', () => {
    it('розширення береться з allowlist за contentType', () => {
        expect(extensionFor('image/png')).toBe('png');
        expect(extensionFor('image/jpeg')).toBe('jpg');
        expect(extensionFor('application/pdf')).toBe('pdf');
    });

    it('невідомі типи і службові імена властивостей не дають розширення', () => {
        expect(extensionFor('text/html')).toBeUndefined();
        expect(extensionFor('image/svg+xml')).toBeUndefined();
        expect(extensionFor('__proto__')).toBeUndefined();
        expect(extensionFor('constructor')).toBeUndefined();
    });

    it('ключ має форму uploads/{userId}/{uuid}.{ext}', () => {
        const key = buildFileKey(7, '3f2b8a52-6f0c-4c6b-9d6e-2a9f6c1b7e10', 'png');

        expect(key).toBe('uploads/7/3f2b8a52-6f0c-4c6b-9d6e-2a9f6c1b7e10.png');
    });
});