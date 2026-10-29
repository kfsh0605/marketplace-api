export const SIGNING_ALG = 'ES256';
export const JWT_ISSUER = 'marketplace-api';
export const JWT_AUDIENCE = 'marketplace-clients';
export const ACCESS_TTL_SEC = 600;
export const REFRESH_TTL_SEC = 7 * 24 * 60 * 60;
export const REFRESH_ABSOLUTE_TTL_SEC = 30 * 24 * 60 * 60;
export const LOGIN_ATTEMPT_LIMIT = 10;
export const LOGIN_ATTEMPT_WINDOW_MS = 15 * 60 * 1000;