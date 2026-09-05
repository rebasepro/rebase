import { tempo, TEMPO } from "./beats";

/**
 * The voiceover for the desk film, on an ABSOLUTE timeline. Same pace rules
 * as the slide film's — plain English, every "this" and "it" points at
 * something on screen, no line contradicts its picture, no Rebase Cloud —
 * and two of its own:
 *
 * THE LINE FOLLOWS THE CAMERA. A beat's line starts a few frames before the
 * camera begins its move, so the words are already going when the picture
 * arrives. The three tour beats share one breath split three ways.
 *
 * EVERY LINE IS CAUSED BY THE ONE BEFORE. "So point Rebase at the same
 * database" answers the scan; "that file" is the file init just wrote;
 * "push it" pushes the rule; "the same scan" is the one from the opening;
 * "then run it" is what puts an API on :3001 for Robert and Dana and a
 * panel on :5173 for the team. "Three commands" at the end is a count of
 * what the viewer watched, not a feature. The film had these facts in a
 * different order once, and it read as a tour with a story stapled to the
 * front.
 *
 * The climax is two short lines with the terminal doing the talking between
 * them: "Nothing found." lands on the scan's green line; "Then run it." lands
 * as `rebase dev` prints its ports. What is said there is less than anywhere
 * else in the film, on purpose.
 */

/** 10 frames a word at the original tempo; 11 at the film's. */
export const DESK_FRAMES_PER_WORD = Math.round(10 * TEMPO);

export const DESK_NARRATION: { at: number; words: string[] }[] = [
    // hook
    { at: tempo(92), words: ["This", "backend", "was", "built", "by", "an", "agent", "in", "an", "afternoon.", "It", "works.", "A", "free", "ten-second", "scan", "found", "three", "ways", "in."] },
    // init
    { at: tempo(336), words: ["So", "point", "Rebase", "at", "the", "same", "database.", "It", "reads", "the", "tables", "it", "finds,", "and", "writes", "a", "file", "for", "each."] },
    // rule
    { at: tempo(552), words: ["Every", "rule", "about", "who", "sees", "what", "goes", "in", "that", "file", "—", "customers", "see", "their", "own", "orders", "—", "and", "Postgres", "enforces", "it,", "not", "your", "code."] },
    // push + rescan
    { at: tempo(796), words: ["Push", "it,", "and", "run", "the", "same", "scan", "again.", "Nothing", "found."] },
    // run
    { at: tempo(930), words: ["Then", "run", "it."] },
    // users
    { at: tempo(1036), words: ["The", "same", "request,", "from", "two", "different", "people,", "gets", "two", "different", "answers.", "Robert", "sees", "his", "own", "orders.", "Dana,", "on", "support,", "sees", "all", "of", "them."] },
    // agent
    { at: tempo(1276), words: ["An", "agent", "gets", "your", "permissions,", "and", "no", "way", "around", "them.", "Same", "rules,", "same", "database,", "same", "answer."] },
    // panel
    { at: tempo(1476), words: ["And", "on", "the", "other", "port,", "your", "team", "gets", "an", "admin", "panel", "—", "on", "the", "same", "data,", "the", "same", "rules.", "Nobody", "built", "these", "views", "by", "hand."] },
    // views
    { at: tempo(1738), words: ["Boards,", "tables,", "cards,", "forms", "—", "every", "view,", "from", "your", "data."] },
    // schema
    { at: tempo(1848), words: ["The", "schema,", "read", "from", "the", "running", "database", "—", "never", "out", "of", "date."] },
    // studio
    { at: tempo(1970), words: ["And", "a", "database", "workspace,", "in", "the", "same", "app."] },
    // all
    { at: tempo(2076), words: ["Three", "commands.", "Open", "source,", "and", "it", "runs", "anywhere", "—", "your", "laptop,", "your", "servers,", "any", "cloud.", "Nobody", "else", "holds", "your", "data.", "So", "build", "it", "by", "lunch.", "This", "time,", "you'll", "know", "it's", "safe."] },
];
