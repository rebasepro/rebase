import { tempo, TEMPO } from "./beats";

/**
 * The voiceover for the desk film, on an ABSOLUTE timeline. Same rules as
 * the slide film's — every "this" and "it" points at something on screen,
 * no line contradicts its picture, no Rebase Cloud — and these:
 *
 * EVERY LINE IS A SENTENCE. A subject, a verb, and the thing the verb is
 * about. "Who can see what goes in that file" parsed two ways and neither
 * of them out loud; "The schema, read from the database, so it matches
 * what's actually there" had no main verb at all. "Nothing found." was two
 * words standing in for a sentence. Each is now a sentence a person could
 * say to another person: "The access rules go in that file." "The schema
 * is read from the database, so it matches what is there." "It finds
 * nothing." No fronted clauses, no dash doing a verb's job, no list where
 * a sentence should be.
 *
 * IT OPENS ON YOU, WITH A QUESTION. "You can build a backend in an
 * afternoon now. But can you trust it?" — said to camera, before any
 * evidence. Then the evidence: an agent built this one, and a scan found
 * three security holes.
 *
 * NO SLOGANS. The facts stay — open source, runs where you want, three
 * commands — and the last thing said is a practical next step, not a
 * tagline. Not "the scan is free", either: the whole product is, and
 * singling the scan out made the rest sound like it was not.
 *
 * EVERY LINE IS CAUSED BY THE ONE BEFORE, and the line follows the camera:
 * it starts a few frames before the move so the words are already going
 * when the picture arrives.
 */

/** 10 frames a word at the original tempo, scaled with it. Fractional is
 *  fine: the prompter compares frames, it does not count them. */
export const DESK_FRAMES_PER_WORD = 10 * TEMPO;

export const DESK_NARRATION: { at: number; words: string[] }[] = [
    // the question, to camera
    { at: tempo(92), words: ["You", "can", "build", "a", "backend", "in", "an", "afternoon", "now.", "But", "can", "you", "trust", "it?"] },
    // the evidence
    { at: tempo(245), words: ["An", "agent", "built", "this", "one.", "It", "works.", "A", "ten-second", "scan", "found", "three", "security", "holes."] },
    // init
    { at: tempo(456), words: ["So", "you", "point", "Rebase", "at", "the", "same", "database.", "It", "reads", "the", "tables", "and", "writes", "one", "file", "for", "each", "of", "them."] },
    // rule
    { at: tempo(672), words: ["The", "access", "rules", "go", "in", "that", "file.", "This", "one", "says", "customers", "can", "only", "see", "their", "own", "orders.", "Postgres", "enforces", "it.", "Your", "code", "doesn't", "have", "to."] },
    // push + rescan
    { at: tempo(924), words: ["You", "push", "it,", "and", "you", "run", "the", "same", "scan", "again.", "It", "finds", "nothing."] },
    // run
    { at: tempo(1060), words: ["Then", "you", "run", "it."] },
    // users
    { at: tempo(1156), words: ["Two", "people", "send", "the", "same", "request.", "Robert", "is", "a", "customer,", "so", "he", "sees", "his", "own", "orders.", "Dana", "works", "in", "support,", "so", "she", "sees", "every", "order."] },
    // agent
    { at: tempo(1406), words: ["An", "agent", "works", "the", "same", "way.", "It", "gets", "a", "key", "with", "permissions,", "and", "it", "can't", "get", "around", "them."] },
    // panel
    { at: tempo(1596), words: ["Your", "team", "also", "gets", "an", "admin", "panel.", "It", "is", "generated", "from", "the", "same", "files,", "so", "the", "same", "rules", "apply."] },
    // views
    { at: tempo(1858), words: ["Every", "collection", "gets", "its", "own", "views:", "boards,", "tables,", "cards", "and", "forms."] },
    // schema
    { at: tempo(1968), words: ["The", "schema", "is", "read", "from", "the", "database,", "so", "it", "matches", "what", "is", "there."] },
    // studio
    { at: tempo(2098), words: ["And", "you", "can", "edit", "the", "database", "itself", "from", "the", "same", "app."] },
    // all
    // "the scan is free" implied the rest was not. It is all MIT.
    { at: tempo(2208), words: ["That", "was", "three", "commands.", "It", "is", "open", "source,", "and", "you", "can", "run", "it", "on", "your", "laptop,", "on", "your", "own", "servers,", "or", "on", "any", "cloud.", "The", "scan", "runs", "on", "any", "Postgres,", "so", "you", "can", "start", "by", "scanning", "your", "own", "database."] },
];
