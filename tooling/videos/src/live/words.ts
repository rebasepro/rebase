/**
 * WORDS — how a word the recogniser heard is compared with a word of the
 * script.
 *
 * Speech recognition does not return the script. It returns "9" for
 * "nine", "back end" for "backend", "crowd" for "CRUD", "Donna" for
 * "Dana", and drops or doubles small words. The follower (follow.ts) only
 * has to know where in the script the presenter is, never what they said,
 * so the comparison is forgiving on purpose: case, punctuation and digits
 * are normalised away, known mishearings of the script's jargon are listed,
 * and a long word matches anything within about a third of its letters.
 */

/** A script word's tokens: most words are one; "ten-second" is two. */
export function tokensOf(word: string): string[] {
    return word
        .toLowerCase()
        .replace(/[‘’]/g, "'")
        .split(/[-–—/\s]+/)
        .map(clean)
        .flatMap((t) => (NUMBERS[t] ? NUMBERS[t].split(" ") : [t]))
        .filter(Boolean);
}

/** What the recogniser returned, as tokens in the same form. */
export function tokensOfTranscript(text: string): string[] {
    return text
        .split(/\s+/)
        .flatMap((w) => tokensOf(w))
        .filter(Boolean);
}

function clean(t: string): string {
    return t
        .replace(/[^a-z0-9']/g, "")
        .replace(/^'+|'+$/g, "")
        .replace(/'/g, "");
}

const NUMBERS: Record<string, string> = {
    "0": "zero",
    "1": "one",
    "2": "two",
    "3": "three",
    "4": "four",
    "5": "five",
    "6": "six",
    "7": "seven",
    "8": "eight",
    "9": "nine",
    "10": "ten",
    "1st": "first",
    "2nd": "second",
};

/** Mishearings of the script's own vocabulary, heard in practice or near
 *  enough to it. Keys are script tokens. */
const HEARD_AS: Record<string, string[]> = {
    crud: ["crowd", "cred", "crude", "curd", "crud", "quad", "cruds"],
    api: ["apis", "ape", "abi", "app", "apr"],
    sdk: ["sdks", "stk", "sd"],
    sql: ["sequel", "seql", "equal"],
    rebase: ["rebates", "rebate", "rebased", "rebays", "debase", "rebus", "wrebase"],
    postgres: ["postgresql", "postgress", "postgre", "postgrads", "postgrass", "postgresql's"],
    typescript: ["types", "typescripts"],
    isomorphic: ["isomorphics", "isomorph"],
    cron: ["chron", "crown", "kron", "cronk", "chrome", "crons", "ron", "corn"],
    dana: ["donna", "dina", "diana", "danna", "dena", "dan"],
    robert: ["roberts", "robbert", "rupert"],
    auth: ["off", "oath", "orth", "auths", "oauth", "of"],
    its: ["it", "is", "it's"],
    thats: ["that", "that's"],
    theres: ["there", "there's", "theirs"],
    realtime: ["real"],
    backend: ["back"],
    schema: ["skimmer", "schemer", "scheme", "kima"],
    admin: ["admins", "adman"],
    storage: ["storages"],
    whole: ["hole"],
    logs: ["log", "locks", "lugs", "logs"],
    sync: ["sink", "synced", "think", "syncs"],
    jobs: ["job", "jobs"],
    scan: ["scam", "skin", "scanned", "scans"],
    open: ["opened", "opens"],
    code: ["coat", "coded", "codes"],
    team: ["teams", "tim"],
    file: ["files", "phile"],
    orders: ["order"],
    rules: ["rule", "rulers"],
    query: ["queries", "curie", "quarry"],
};

/* In the same form as a heard token: "it's" arrives as "its". */
const ALIASES = new Map<string, Set<string>>(Object.entries(HEARD_AS).map(([k, v]) => [k, new Set(v.map(clean))]));

/**
 * Words too common to steer by. One of these moves the follower only if it
 * is the very next word expected (or the one after — a word is sometimes
 * dropped). Without the rule a stray "the" jumps the cursor to the next
 * "the" in the window, and the film runs ahead of the speaker.
 */
export const COMMON = new Set([
    "a", "an", "the", "and", "or", "of", "to", "in", "on", "at", "by", "for", "from", "with", "as",
    "is", "it", "its", "you", "your", "we", "i", "but", "so", "that", "this", "these", "those",
    "one", "no", "not", "can", "be", "are", "was", "what", "who", "how", "all", "any", "own",
    "his", "her", "them", "their", "there", "theres", "thats", "same", "every", "more", "also",
    "just", "then", "than", "into", "gets", "get", "says", "see", "sees", "only", "right", "next",
    "has", "have", "had", "do", "does", "did", "up", "out", "if",
]);

function levenshtein(a: string, b: string): number {
    if (a === b) return 0;
    const prev = new Array<number>(b.length + 1);
    for (let j = 0; j <= b.length; j++) prev[j] = j;
    for (let i = 1; i <= a.length; i++) {
        let diag = prev[0];
        prev[0] = i;
        for (let j = 1; j <= b.length; j++) {
            const up = prev[j];
            prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
            diag = up;
        }
    }
    return prev[b.length];
}

/** Whether `heard` is `want` or a known mishearing of it — no fuzzy
 *  matching. What a jump far ahead is allowed to rest on. */
export function exactWord(heard: string, want: string): boolean {
    return heard === want || (ALIASES.get(want)?.has(heard) ?? false);
}

/** Whether `heard` can be the script token `want`. */
export function sameWord(heard: string, want: string): boolean {
    if (heard === want) return true;
    if (ALIASES.get(want)?.has(heard)) return true;
    /* Fuzzy only from five letters: at four, one edit turns "fine" into
       "file" and "four" into "for" — measured, that was enough to move the
       film into the next line while the presenter was finishing this one. */
    const n = Math.max(heard.length, want.length);
    if (Math.min(heard.length, want.length) < 5) return false;
    return levenshtein(heard, want) <= Math.floor(n * 0.3);
}
