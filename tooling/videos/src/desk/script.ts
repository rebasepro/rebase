import { TEMPO } from "./beats";

/**
 * The voiceover for the desk film, on an ABSOLUTE timeline.
 *
 * THIS IS A MARKETING FILM, NOT A TUTORIAL. The subject of every line is
 * what Rebase does for you — reads the database you already have, turns a
 * rule into a policy, answers every client from the database itself — and
 * never what to type. The commands appear on screen as proof that it is
 * three of them, not as steps to follow. A version that narrated the
 * terminal ("So you point Rebase at that same database. That's the first
 * command.") was a how-to with a person in the corner.
 *
 * EXCITING BECAUSE IT IS CONCRETE. No slogans, no taglines, nothing at
 * anyone's expense. The excitement is in what happens: nine critical
 * findings become a clean scan; one file becomes an API, an admin panel
 * and a safe place for agents; "point it at your database this afternoon"
 * is a thing you can actually do.
 *
 * EVERY LINE IS A SENTENCE, friendly and professional. About 200 words a
 * minute, with a breath between lines and a beat after every picture.
 *
 * And the rules that never change: every "this" and "it" points at
 * something on screen; every line is caused by the one before; no line
 * contradicts its picture; no line refers to Rebase Cloud; every claim is
 * checked against the repo or captured from the tools (scan-output.ts).
 */

/** Nine frames a word — about 200 a minute — scaled with the tempo. */
export const DESK_FRAMES_PER_WORD = 9 * TEMPO;

export const DESK_NARRATION: { at: number; words: string[] }[] = [
    // the question, to camera
    { at: 15, words: ["It's", "2026.", "Anyone", "can", "build", "a", "backend", "in", "an", "afternoon.", "But", "can", "you", "trust", "it?"] },
    // the evidence: the agent's summary, then the scan's tally
    { at: 167, words: ["A", "coding", "agent", "built", "this", "one.", "It", "says", "it's", "done:", "auth,", "CRUD", "for", "nine", "tables,", "a", "REST", "API,", "deployed.", "And", "a", "ten-second", "scan", "of", "the", "same", "database", "finds", "nine", "critical", "issues.", "Every", "table", "is", "open."] },
    // what Rebase does with that database
    { at: 526, words: ["Rebase", "starts", "from", "the", "database", "you", "already", "have.", "One", "command", "reads", "every", "table", "and", "writes", "a", "typed", "collection", "file", "for", "each", "one.", "Your", "schema,", "as", "code,", "in", "seconds."] },
    // the rule
    { at: 796, words: ["Access", "rules", "live", "in", "that", "file,", "right", "next", "to", "the", "table", "they", "protect.", "This", "one", "says", "customers", "only", "see", "their", "own", "orders.", "Rebase", "compiles", "it", "into", "a", "Postgres", "policy,", "so", "the", "database", "enforces", "it", "on", "every", "query,", "from", "every", "client."] },
    // push + the same scan
    { at: 1176, words: ["Push", "it,", "run", "the", "same", "scan", "again,", "and", "it", "comes", "back", "clean."] },
    // run it → the API answers two people
    { at: 1320, words: ["Then", "run", "it,", "and", "every", "request", "is", "answered", "by", "the", "database", "itself.", "Robert", "sees", "his", "own", "orders.", "Dana,", "in", "support,", "sees", "them", "all.", "Same", "query.", "Postgres", "decides", "who", "sees", "what."] },
    // the agent
    { at: 1626, words: ["Give", "an", "agent", "a", "key,", "and", "it", "gets", "exactly", "the", "permissions", "on", "that", "key,", "and", "nothing", "more.", "The", "rules", "hold", "no", "matter", "what", "the", "prompt", "says."] },
    // the panel
    { at: 1896, words: ["And", "your", "team", "gets", "an", "admin", "panel", "on", "day", "one,", "generated", "from", "the", "same", "files,", "with", "the", "same", "rules.", "Nobody", "had", "to", "build", "it."] },
    // views
    { at: 2168, words: ["Boards,", "tables,", "cards", "and", "forms:", "every", "collection", "gets", "the", "views", "that", "fit", "it."] },
    // schema
    { at: 2348, words: ["The", "schema,", "read", "live", "from", "your", "database,", "so", "it", "is", "always", "current."] },
    // studio
    { at: 2513, words: ["And", "a", "place", "to", "work", "on", "the", "database", "itself:", "SQL,", "schema,", "policies", "and", "logs,", "in", "the", "same", "app."] },
    // close
    { at: 2703, words: ["Rebase", "is", "open", "source,", "MIT", "licensed,", "and", "runs", "on", "your", "laptop,", "your", "own", "servers", "or", "any", "cloud.", "Three", "commands,", "on", "the", "Postgres", "you", "already", "have.", "Point", "it", "at", "your", "database", "this", "afternoon.", "Then", "run", "the", "scan."] },
];
