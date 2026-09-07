import { TEMPO } from "./beats";

/**
 * The voiceover for the desk film, on an ABSOLUTE timeline — and in the
 * register of a fast explainer, not a product page read aloud:
 *
 * IT'S 2026, AND YOU. Present tense, second person, blunt. "Anyone can
 * build a backend in an afternoon. You don't even need to know what one
 * is." One dry line per beat, always with a point under it: "not an
 * if-statement you wrote at 2 AM"; "the database doesn't care how nicely
 * you ask"; "nobody had to build a CRUD app on top of the CRUD app";
 * "ideally before somebody else does". No slogans, no taglines; the jokes
 * are where a slogan would have been.
 *
 * ~200 WORDS A MINUTE, NO DEAD AIR. 8.5 frames a word, gaps of half a
 * second at most, and the whole thing lands on 3000 frames: a hundred
 * seconds. The pictures run under the words; the words never wait for
 * them, except the one place the terminal has to print before "it finds
 * nothing" can be said.
 *
 * STILL SENTENCES. A subject, a verb, and the thing the verb is about.
 * "Zero findings." would have been on brand and is not a sentence.
 *
 * And the rules that never change: every "this" and "it" points at
 * something on screen; every line is caused by the one before; no line
 * contradicts its picture; no line refers to Rebase Cloud; every claim is
 * checked against the repo (MIT, three commands, nine tables, three
 * findings, the container image).
 */

/** 8.5 frames a word — about 200 a minute — scaled with the tempo. */
export const DESK_FRAMES_PER_WORD = 8.5 * TEMPO;

export const DESK_NARRATION: { at: number; words: string[] }[] = [
    // the question, to camera
    { at: 15, words: ["It's", "2026.", "Anyone", "can", "build", "a", "backend", "in", "an", "afternoon.", "You", "don't", "even", "need", "to", "know", "what", "one", "is.", "But", "can", "you", "trust", "it?"] },
    // the evidence
    { at: 236, words: ["This", "one", "was", "vibe-coded", "by", "an", "agent", "over", "lunch.", "It", "works.", "And", "a", "ten-second", "scan", "found", "three", "holes,", "including", "a", "customers", "table", "that", "anyone", "can", "read."] },
    // init
    { at: 496, words: ["So", "you", "point", "Rebase", "at", "that", "same", "database.", "It", "reads", "the", "tables", "that", "are", "already", "there", "and", "writes", "a", "TypeScript", "file", "for", "each", "one.", "That's", "the", "whole", "setup."] },
    // rule
    { at: 746, words: ["Access", "rules", "go", "in", "that", "same", "file.", "This", "one", "says", "customers", "can", "only", "see", "their", "own", "orders.", "And", "it", "doesn't", "compile", "into", "middleware", "you", "might", "forget", "to", "call.", "It", "compiles", "into", "a", "Postgres", "row-level", "security", "policy.", "The", "database", "enforces", "it."] },
    // push + rescan
    { at: 1106, words: ["You", "push", "it,", "you", "run", "the", "exact", "same", "scan", "again,", "and", "it", "finds", "nothing."] },
    // run
    { at: 1240, words: ["Then", "you", "run", "it."] },
    // users
    { at: 1314, words: ["Robert", "is", "a", "customer,", "so", "he", "gets", "his", "own", "orders.", "Dana", "works", "in", "support,", "so", "she", "gets", "all", "of", "them.", "It's", "the", "same", "query.", "The", "database", "decides", "who", "gets", "what,", "not", "an", "if-statement", "you", "wrote", "at", "2", "AM."] },
    // agent
    { at: 1649, words: ["And", "an", "agent", "works", "the", "exact", "same", "way.", "It", "gets", "a", "key", "with", "permissions", "on", "it,", "and", "it", "cannot", "get", "around", "them.", "The", "database", "doesn't", "care", "how", "nicely", "you", "ask."] },
    // panel
    { at: 1916, words: ["Your", "team", "also", "gets", "an", "admin", "panel,", "generated", "from", "the", "same", "files,", "with", "the", "same", "rules", "applied.", "Nobody", "had", "to", "build", "a", "CRUD", "app", "on", "top", "of", "the", "CRUD", "app."] },
    // views
    { at: 2183, words: ["Every", "collection", "gets", "boards,", "tables,", "cards", "and", "forms,", "straight", "from", "its", "schema."] },
    // schema
    { at: 2293, words: ["The", "schema", "view", "is", "read", "from", "the", "live", "database,", "so", "it", "can't", "lie", "to", "you."] },
    // studio
    { at: 2428, words: ["And", "you", "can", "work", "on", "the", "database", "itself", "from", "the", "same", "app."] },
    // all
    { at: 2533, words: ["So", "that", "was", "three", "commands.", "It's", "open", "source,", "MIT", "licensed,", "and", "you", "can", "run", "it", "on", "your", "laptop,", "on", "your", "own", "servers,", "or", "on", "any", "cloud", "that", "can", "run", "a", "container.", "The", "scan", "works", "on", "any", "Postgres,", "so", "go", "run", "it", "on", "your", "own", "database,", "ideally", "before", "somebody", "else", "does."] },
];
