export const PROFILES = ['zero', 'naive'] as const;
export type Profile = (typeof PROFILES)[number];

export const APP_PORT = 3000;

export const PROBE_PATHS = {
    readiness: '/readyz',
    liveness: '/healthz',
} as const;

export interface ProfileSpec {
    strategy: { maxUnavailable: number | string; maxSurge: number | string };
    probes: boolean;
    drainMs: number;
    gracePeriodSeconds?: number;
}

export const PROFILE_SPECS: Record<Profile, ProfileSpec> = {
    zero: {
        strategy: { maxUnavailable: 0, maxSurge: 1 },
        probes: true,
        drainMs: 5000,
        gracePeriodSeconds: 20,
    },
    naive: {
        strategy: { maxUnavailable: '25%', maxSurge: '25%' },
        probes: false,
        drainMs: 0,
    },
};