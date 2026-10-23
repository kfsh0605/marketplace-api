import type { NextFunction, Request, Response } from 'express';
import type { SessionData, SessionStore } from './session-store';

export const SESSION_COOKIE = 'sid';

export interface SessionRequest extends Request {
    sessionId?: string;
    session?: SessionData;
}

export function readCookie(header: string | undefined, name: string): string | undefined {
    if (!header) {
        return undefined;
    }
    for (const part of header.split(';')) {
        const index = part.indexOf('=');
        if (index === -1) {
            continue;
        }
        if (part.slice(0, index).trim() === name) {
            return decodeURIComponent(part.slice(index + 1).trim());
        }
    }
    return undefined;
}

export function setSessionCookie(res: Response, sid: string, ttlSec: number): void {
    const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
    res.append(
        'Set-Cookie',
        `${SESSION_COOKIE}=${encodeURIComponent(sid)}; Max-Age=${ttlSec}; Path=/; HttpOnly; SameSite=Lax${secure}`,
    );
}

export function sessionMiddleware(store: SessionStore) {
    return async (req: SessionRequest, res: Response, next: NextFunction): Promise<void> => {
        try {
            const sid = readCookie(req.headers.cookie, SESSION_COOKIE);
            if (sid) {
                const session = await store.get(sid);
                if (session) {
                    req.sessionId = sid;
                    req.session = session;
                    setSessionCookie(res, sid, store.ttlSec);
                }
            }
            next();
        } catch (err) {
            next(err);
        }
    };
}

export async function startSession(
    store: SessionStore,
    res: Response,
    values: Record<string, unknown>,
): Promise<string> {
    const sid = await store.create(values);
    setSessionCookie(res, sid, store.ttlSec);
    return sid;
}