/**
 * The line `rebase schema generate` ends on.
 *
 * Its own module because `generate-drizzle-schema.ts` uses `import.meta` to
 * decide whether it was executed directly, which the driver's jest suite cannot
 * load at all — so the one sentence in that file with a decision in it had no
 * test and could not have one where it stood.
 */

export const formatTerminalText = (text: string, options: {
    bold?: boolean;
    backgroundColor?: "blue" | "green" | "red" | "yellow" | "cyan" | "magenta";
    textColor?: "white" | "black" | "red" | "green" | "yellow" | "blue" | "magenta" | "cyan";
} = {}): string => {
    let codes = "";
    if (options.bold) codes += "\x1b[1m";
    if (options.backgroundColor) {
        const bgColors = {
            blue: "\x1b[44m",
            green: "\x1b[42m",
            red: "\x1b[41m",
            yellow: "\x1b[43m",
            cyan: "\x1b[46m",
            magenta: "\x1b[45m"
        } as const;
        codes += bgColors[options.backgroundColor];
    }
    if (options.textColor) {
        const textColors = {
            white: "\x1b[37m",
            black: "\x1b[30m",
            red: "\x1b[31m",
            green: "\x1b[32m",
            yellow: "\x1b[33m",
            blue: "\x1b[34m",
            magenta: "\x1b[35m",
            cyan: "\x1b[36m"
        } as const;
        codes += textColors[options.textColor];
    }
    return `${codes}${text}\x1b[0m`;
};

/**
 * What to do with the file that was just generated.
 *
 * Not the same answer on the managed development database: `rebase db generate`
 * plans with Atlas, Atlas needs a second empty database to diff against, and
 * PGlite serves exactly one — so the CLI refuses that command outright there.
 * This line recommended it unconditionally, which meant every stock scaffold
 * was told, by the tool itself, to run something the same tool would refuse.
 *
 * The kind arrives as `REBASE_DEV_DATABASE_KIND`, set by the CLI from the
 * ordered resolution in `dev-db/resolve.ts`. It is a pure decision — nothing is
 * started to make it — and the driver cannot make it for itself: on the managed
 * path `DATABASE_URL` is a perfectly ordinary connection string to a Postgres
 * on loopback. Absent (the driver run directly, outside the CLI) keeps the
 * original wording.
 */
export const nextStepAfterGenerate = (): string => {
    if (process.env.REBASE_DEV_DATABASE_KIND === "managed") {
        return `Start or restart ${formatTerminalText("rebase dev", {
            bold: true,
            backgroundColor: "blue",
            textColor: "black"
        })} — boot applies your collections to the managed development database.`;
    }

    return `You can now run ${formatTerminalText("rebase db generate", {
        bold: true,
        backgroundColor: "blue",
        textColor: "black"
    })} to generate the SQL migration files.`;
};
