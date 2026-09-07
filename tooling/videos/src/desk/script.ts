import { TEMPO } from "./beats";

/**
 * The voiceover for the desk film, on an ABSOLUTE timeline.
 *
 * FRIENDLY AND PROFESSIONAL. Brisk, warm, second person, present tense —
 * one engineer showing another something they built. Nothing at anyone's
 * expense: no jabs at the viewer, no jokes about their code, no threats
 * dressed as jokes. The register of a good conference demo, not of a
 * roast.
 *
 * ABOUT 200 WORDS A MINUTE, NO DEAD AIR. Nine frames a word, gaps of half
 * a second or so, and the sheet lands on 3000 frames: a hundred seconds.
 * The pictures run under the words; the words never wait for them, except
 * where the terminal has to print before "it finds nothing" can be said.
 *
 * EVERY LINE IS A SENTENCE. A subject, a verb, and the thing the verb is
 * about. Nothing here needs a second reading to parse.
 *
 * And the rules that never change: it opens on the presenter with the
 * question; every "this" and "it" points at something on screen; every
 * line is caused by the one before; no line contradicts its picture; no
 * line refers to Rebase Cloud; no slogans; nothing is singled out as free
 * because all of it is; and every claim is checked against the repo —
 * MIT, three commands, nine tables, three findings, the container image.
 */

/** Nine frames a word — about 200 a minute — scaled with the tempo. */
export const DESK_FRAMES_PER_WORD = 9 * TEMPO;

export const DESK_NARRATION: { at: number; words: string[] }[] = [
    // the question, to camera
    { at: 15, words: ["It's", "2026.", "Anyone", "can", "build", "a", "backend", "in", "an", "afternoon.", "But", "can", "you", "trust", "it?"] },
    // the evidence
    // reads the two windows: the agent's summary, then the scan's verdict
    { at: 167, words: ["A", "coding", "agent", "built", "this", "one.", "It", "says", "it's", "done:", "auth,", "CRUD", "for", "nine", "tables,", "a", "REST", "API,", "deployed.", "And", "a", "ten-second", "scan", "of", "the", "same", "database", "finds", "two", "critical", "issues", "and", "one", "high."] },
    // init
    { at: 495, words: ["So", "you", "point", "Rebase", "at", "that", "same", "database.", "It", "reads", "the", "tables", "that", "are", "already", "there", "and", "writes", "a", "TypeScript", "file", "for", "each", "one.", "That's", "the", "whole", "setup."] },
    // rule
    { at: 763, words: ["Access", "rules", "go", "in", "that", "same", "file.", "This", "one", "says", "customers", "can", "only", "see", "their", "own", "orders.", "It", "doesn't", "compile", "into", "middleware.", "It", "compiles", "into", "a", "Postgres", "row-level", "security", "policy,", "and", "the", "database", "enforces", "it."] },
    // push + rescan
    { at: 1098, words: ["You", "push", "it,", "you", "run", "the", "exact", "same", "scan", "again,", "and", "it", "finds", "nothing."] },
    // run
    { at: 1242, words: ["Then", "you", "run", "it."] },
    // users
    { at: 1323, words: ["Robert", "is", "a", "customer,", "so", "he", "gets", "his", "own", "orders.", "Dana", "works", "in", "support,", "so", "she", "gets", "all", "of", "them.", "It's", "the", "same", "query.", "The", "database", "decides", "who", "gets", "what,", "not", "your", "application", "code."] },
    // agent
    { at: 1645, words: ["And", "an", "agent", "works", "the", "same", "way.", "It", "gets", "a", "key", "with", "permissions", "on", "it,", "and", "it", "cannot", "get", "around", "them.", "The", "rules", "hold", "no", "matter", "what", "the", "prompt", "says."] },
    // panel
    { at: 1931, words: ["Your", "team", "also", "gets", "an", "admin", "panel.", "It", "is", "generated", "from", "the", "same", "files,", "with", "the", "same", "rules", "applied,", "and", "nobody", "had", "to", "build", "it."] },
    // views
    { at: 2176, words: ["Every", "collection", "gets", "boards,", "tables,", "cards", "and", "forms,", "straight", "from", "its", "schema."] },
    // schema
    { at: 2296, words: ["The", "schema", "view", "is", "read", "from", "the", "live", "database,", "so", "it", "is", "always", "current."] },
    // studio
    { at: 2434, words: ["And", "you", "can", "work", "on", "the", "database", "itself", "from", "the", "same", "app."] },
    // all
    { at: 2554, words: ["So", "that", "was", "three", "commands.", "It's", "open", "source,", "MIT", "licensed,", "and", "you", "can", "run", "it", "on", "your", "laptop,", "on", "your", "own", "servers,", "or", "on", "any", "cloud", "that", "can", "run", "a", "container.", "The", "scan", "works", "on", "any", "Postgres", "database,", "so", "it's", "a", "good", "place", "to", "start."] },
];
