/**
 * The voiceover for the desk film, on an ABSOLUTE timeline. Same pace as
 * the slide film's (180 words a minute, 10 frames a word), same rules —
 * plain English, every "this" and "it" points at something on screen, no
 * line contradicts its picture, no Rebase Cloud — and one new one:
 *
 * THE LINE FOLLOWS THE CAMERA. A beat's line starts a few frames before the
 * camera begins its move, so the words are already going when the picture
 * arrives. The three tour beats share one line split three ways, timed so
 * each clause lands as its window comes into frame.
 *
 * It is one story now. The backend from the first line is the backend that
 * gets fixed; "the same scan" in the fourth is the scan from the first.
 */
import { tempo, TEMPO } from "./beats";

/** 10 frames a word at the original tempo; 11 at the film's. */
export const DESK_FRAMES_PER_WORD = Math.round(10 * TEMPO);

export const DESK_NARRATION: { at: number; words: string[] }[] = [
    // hook
    { at: tempo(92), words: ["This", "backend", "was", "built", "by", "an", "agent", "in", "an", "afternoon.", "It", "works.", "A", "ten-second", "scan", "found", "three", "ways", "in."] },
    // rule
    { at: tempo(334), words: ["That's", "what", "Rebase", "is", "for.", "You", "describe", "your", "data", "once,", "and", "every", "rule", "about", "who", "sees", "what", "is", "enforced", "by", "Postgres", "—", "not", "by", "your", "code."] },
    // push + rescan
    { at: tempo(612), words: ["Push", "it,", "and", "run", "the", "same", "scan", "again.", "Fifteen", "checks,", "nothing", "found.", "It's", "free,", "it", "works", "on", "any", "Postgres,", "and", "nothing", "leaves", "your", "machine."] },
    // users
    { at: tempo(856), words: ["The", "same", "request,", "from", "two", "different", "people,", "gets", "two", "different", "answers.", "Robert", "sees", "his", "own", "orders.", "Dana,", "on", "support,", "sees", "all", "of", "them."] },
    // agent
    { at: tempo(1092), words: ["An", "agent", "gets", "your", "permissions,", "and", "no", "way", "around", "them.", "Same", "rules,", "same", "database,", "same", "answer."] },
    // panel
    { at: tempo(1286), words: ["And", "your", "team", "gets", "a", "real", "admin", "panel", "—", "on", "the", "same", "data,", "the", "same", "rules.", "Nobody", "built", "these", "views", "by", "hand."] },
    // views
    { at: tempo(1548), words: ["Boards,", "tables,", "cards,", "forms", "—", "every", "view,", "from", "your", "data."] },
    // schema
    { at: tempo(1650), words: ["The", "schema,", "read", "from", "the", "running", "database", "—", "never", "out", "of", "date."] },
    // studio
    { at: tempo(1772), words: ["And", "a", "database", "workspace,", "in", "the", "same", "app."] },
    // commands
    { at: tempo(1868), words: ["Three", "commands,", "and", "it's", "running", "on", "your", "own", "machine.", "No", "account,", "nothing", "to", "sign", "up", "for."] },
    // all
    { at: tempo(2046), words: ["Open", "source.", "Runs", "anywhere", "—", "your", "laptop,", "your", "servers,", "any", "cloud.", "Nobody", "else", "holds", "your", "data.", "So", "build", "it", "by", "lunch.", "This", "time,", "you'll", "know", "it's", "safe."] },
];
