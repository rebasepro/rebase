const YES = new Set(["true", "1", "yes", "on"]);
const NO = new Set(["false", "0", "no", "off"]);

/**
 * Read a boolean environment variable — one spelling rule for every reader.
 *
 * `true`, `1`, `yes` and `on` are true; `false`, `0`, `no` and `off` are
 * false. Case and surrounding whitespace are ignored. Anything else — unset,
 * blank, or a value that spells neither — is `undefined`, so the caller's
 * default decides and a typo lands on the side the caller chose:
 *
 * ```ts
 * parseEnvBoolean(env.FORCE_LOCAL_STORAGE) === true            // off unless said
 * parseEnvBoolean(env.REBASE_MCP_OPEN_REGISTRATION) !== false  // on unless said
 * ```
 *
 * It exists because every reader used to spell this itself, and they
 * disagreed. The reader that mattered tested the raw string for truthiness —
 * `!process.env.FORCE_LOCAL_STORAGE` — and every non-empty string is truthy,
 * so `FORCE_LOCAL_STORAGE=false`, written to say "there is no durable volume
 * here", switched the production storage guard off and sent uploads to a
 * container filesystem the next redeploy erased. Beside it, `=== "true"` made
 * `DISABLE_DB_ROLE_SWITCHING=1` do nothing and `!== "false"` made
 * `REBASE_MCP_OPEN_REGISTRATION=0` leave registration open.
 *
 * The boot schemas in `@rebasepro/server` (`loadEnv`, `loadBootEnv`) accept a
 * strict subset — `true`, `false` and blank — and refuse any other value
 * before the server starts. On that subset they read exactly what this reads,
 * so a variable a schema declares and something else reads lazily cannot mean
 * two different things.
 *
 * It lives in this package, with no dependencies, for the reason
 * {@link storageEnvSuffix} does: the runtime, its drivers and the CLI all read
 * these variables, and a second parser is a second chance to disagree.
 *
 * @group Models
 */
export function parseEnvBoolean(value: string | undefined): boolean | undefined {
    if (value === undefined) return undefined;
    const spelled = value.trim().toLowerCase();
    if (YES.has(spelled)) return true;
    if (NO.has(spelled)) return false;
    return undefined;
}
