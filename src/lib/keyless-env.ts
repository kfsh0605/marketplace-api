const PASS_THROUGH = ['PATH', 'Path', 'SystemRoot', 'SYSTEMROOT', 'TEMP', 'TMP'];

export function keylessEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
    const env: NodeJS.ProcessEnv = {};
    for (const name of PASS_THROUGH) {
        const value = process.env[name];
        if (value !== undefined) {
            env[name] = value;
        }
    }
    return { ...env, ...extra };
}