/**
 * One recorded `execa(file, args, options)` call, read back from a mock.
 *
 * `vi.mocked(execa).mock.calls` is typed by execa's last overload,
 * `(file, options?)`, so the argument list and the options of the
 * `(file, args, options)` form the CLI uses are not where the type says. Each
 * call is read as the plain list it is and narrowed here.
 */
export interface SpawnCall {
    file: string;
    args: string[];
    cwd?: string;
    env?: Record<string, string>;
}

export function spawnCall(call: readonly unknown[] | undefined): SpawnCall | undefined {
    if (!call) return undefined;
    const [file, args, options] = call;
    const read: SpawnCall = {
        file: String(file),
        args: Array.isArray(args) ? args.filter((arg): arg is string => typeof arg === "string") : []
    };
    if (typeof options === "object" && options !== null) {
        if ("cwd" in options && typeof options.cwd === "string") read.cwd = options.cwd;
        if ("env" in options && typeof options.env === "object" && options.env !== null) {
            const env: Record<string, string> = {};
            for (const [key, value] of Object.entries(options.env)) {
                if (typeof value === "string") env[key] = value;
            }
            read.env = env;
        }
    }
    return read;
}
