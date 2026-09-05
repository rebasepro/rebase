import { tempo, TEMPO } from "./beats";

/**
 * The voiceover for the desk film, on an ABSOLUTE timeline. Same rules as
 * the slide film's — every "this" and "it" points at something on screen,
 * no line contradicts its picture, no Rebase Cloud — and three of its own:
 *
 * IT IS SAID THE WAY A PERSON WOULD SAY IT TO ANOTHER PERSON. Short
 * sentences. "You". No dash-inserts, no fragments doing the work of a
 * sentence, nothing you would only ever read. "And on the other port, your
 * team gets an admin panel" was a line only a terminal could love; "your
 * team gets an admin panel too" is what you would actually say.
 *
 * IT OPENS ON YOU, WITH A QUESTION. "You can build a backend in an
 * afternoon now. But can you trust it?" — said to camera, before any
 * evidence. Then the evidence: this one, built by an agent, three ways in.
 * The close answers the question in the same words: this time, you'll know
 * you can trust it.
 *
 * EVERY LINE IS CAUSED BY THE ONE BEFORE. "So you point Rebase at that same
 * database" answers the scan; "that file" is the file init just wrote;
 * "push it" pushes the rule; "the same scan" is the one from the opening;
 * "then run it" is what puts an API up for Robert, Dana and an agent, and a
 * panel for the team. "Three commands" at the end is a count of what the
 * viewer watched.
 *
 * The line follows the camera: it starts a few frames before the move so
 * the words are already going when the picture arrives.
 */

/** 10 frames a word at the original tempo; 11 at the film's. */
export const DESK_FRAMES_PER_WORD = Math.round(10 * TEMPO);

export const DESK_NARRATION: { at: number; words: string[] }[] = [
    // the question, to camera
    { at: tempo(92), words: ["You", "can", "build", "a", "backend", "in", "an", "afternoon", "now.", "But", "can", "you", "trust", "it?"] },
    // the evidence
    { at: tempo(245), words: ["This", "one", "was", "built", "by", "an", "agent.", "It", "works.", "A", "free", "ten-second", "scan", "found", "three", "ways", "in."] },
    // init
    { at: tempo(456), words: ["So", "you", "point", "Rebase", "at", "that", "same", "database.", "It", "reads", "the", "tables,", "and", "writes", "one", "file", "per", "table."] },
    // rule
    { at: tempo(672), words: ["Who", "can", "see", "what", "goes", "in", "that", "file.", "Here,", "customers", "only", "see", "their", "own", "orders.", "And", "Postgres", "enforces", "it,", "not", "your", "code."] },
    // push + rescan
    { at: tempo(916), words: ["Push", "it,", "and", "run", "the", "same", "scan", "again.", "Nothing", "found."] },
    // run
    { at: tempo(1050), words: ["Then", "run", "it."] },
    // users
    { at: tempo(1156), words: ["The", "same", "request,", "from", "two", "different", "people,", "gets", "two", "different", "answers.", "Robert", "sees", "his", "own", "orders.", "Dana,", "on", "support,", "sees", "all", "of", "them."] },
    // agent
    { at: tempo(1396), words: ["An", "agent", "gets", "your", "permissions,", "and", "it", "can't", "get", "around", "them.", "Same", "rules,", "same", "database,", "same", "answer."] },
    // panel
    { at: tempo(1596), words: ["And", "your", "team", "gets", "an", "admin", "panel.", "Same", "data,", "same", "rules.", "Nobody", "built", "any", "of", "this", "by", "hand."] },
    // views
    { at: tempo(1858), words: ["Boards,", "tables,", "cards,", "forms.", "It", "all", "comes", "from", "your", "data."] },
    // schema
    { at: tempo(1968), words: ["The", "schema,", "straight", "from", "the", "database,", "so", "it's", "never", "out", "of", "date."] },
    // studio
    { at: tempo(2090), words: ["And", "you", "can", "work", "on", "the", "database", "itself,", "right", "there."] },
    // all
    { at: tempo(2196), words: ["That", "was", "three", "commands.", "It's", "open", "source,", "and", "it", "runs", "anywhere.", "Your", "laptop,", "your", "servers,", "any", "cloud.", "Nobody", "else", "holds", "your", "data.", "So", "go", "build", "it", "by", "lunch.", "This", "time,", "you'll", "know", "you", "can", "trust", "it."] },
];
