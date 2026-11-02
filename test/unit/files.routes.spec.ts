import { RequestMethod } from '@nestjs/common';
import {
    HEADERS_METADATA,
    HTTP_CODE_METADATA,
    METHOD_METADATA,
    PATH_METADATA,
    REDIRECT_METADATA,
} from '@nestjs/common/constants';
import { FilesController } from '../../src/files/files.controller';

interface RouteSpec {
    handler: string;
    method: RequestMethod;
    path: string;
    httpCode?: number;
}

const ROUTES: RouteSpec[] = [
    { handler: 'createIntent', method: RequestMethod.POST, path: 'uploads/intent', httpCode: 200 },
    { handler: 'commit', method: RequestMethod.POST, path: 'uploads/commit', httpCode: 200 },
    { handler: 'listParts', method: RequestMethod.GET, path: 'uploads/:fileId/parts' },
    { handler: 'presignParts', method: RequestMethod.POST, path: 'uploads/:fileId/parts/urls', httpCode: 200 },
    { handler: 'download', method: RequestMethod.GET, path: 'files/:id' },
];

const prototype = FilesController.prototype as unknown as Record<string, object>;

describe('FilesController: метадані маршрутів', () => {
    it('контролер без префікса, а кожен маршрут задекорований', () => {
        expect(['/', '']).toContain(Reflect.getMetadata(PATH_METADATA, FilesController));

        const decorated = Object.getOwnPropertyNames(prototype).filter(
            (name) => name !== 'constructor' && Reflect.getMetadata(METHOD_METADATA, prototype[name]) !== undefined,
        );

        expect(decorated.sort()).toEqual(ROUTES.map((route) => route.handler).sort());
    });

    it.each(ROUTES)('$handler: $method $path', ({ handler, method, path, httpCode }) => {
        const target = prototype[handler];

        expect(Reflect.getMetadata(PATH_METADATA, target)).toBe(path);
        expect(Reflect.getMetadata(METHOD_METADATA, target)).toBe(method);
        expect(Reflect.getMetadata(HTTP_CODE_METADATA, target)).toBe(httpCode);
    });

    it('download: редірект і Cache-Control: no-store на місці', () => {
        const target = prototype.download;
        const headers = Reflect.getMetadata(HEADERS_METADATA, target) as Array<{ name: string; value: string }>;

        expect(Reflect.getMetadata(REDIRECT_METADATA, target)).toBeDefined();
        expect(headers).toEqual(expect.arrayContaining([{ name: 'Cache-Control', value: 'no-store' }]));
    });
});