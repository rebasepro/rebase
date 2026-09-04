/**
 * The voiceover, on an ABSOLUTE timeline.
 *
 * It used to be one line per scene, each starting a beat after its own cut. The
 * effect was a metronome: the narrator stopped at every single cut, nineteen
 * times, whether the sentence had finished a thought or not. Silence has to
 * mean something, and it cannot mean anything if it happens everywhere.
 *
 * So a line now starts where the RHYTHM wants it, not where the scene does.
 * Several begin before their own cut and carry across it — the line about the
 * API and the policies starts while the security slide is still up, because it
 * is finishing that slide's sentence. Where a pause is wanted it is a real one:
 * after the opening, and at the act joins.
 *
 * Frames are absolute from the first frame of the film. If a scene duration
 * changes these do NOT follow it — regenerate them.
 */
export const WORDS_PER_SECOND = 2.5;

/** Frames per word at that pace, at 30fps. */
export const FRAMES_PER_WORD = 12;

export const NARRATION: { at: number; words: string[] }[] = [
    { at: 126, words: ["An", "agent", "built", "this", "backend", "in", "an", "afternoon.", "Ten", "seconds", "later,", "an", "audit", "found", "two", "ways", "in."] },
    { at: 386, words: ["So", "Rebase", "keeps", "authorization", "down", "in", "the", "database,", "where", "nothing", "can", "route", "around", "it."] },
    { at: 610, words: ["You", "describe", "a", "collection", "once,", "and", "the", "API,", "the", "SDK", "and", "the", "policies", "all", "come", "from", "it."] },
    { at: 909, words: ["It's", "one", "package,", "your", "own", "Postgres,", "and", "everything", "you're", "about", "to", "see."] },
    { at: 1067, words: ["Auth,", "storage,", "realtime,", "functions,", "cron,", "backups", "\u2014", "all", "of", "it", "already", "running."] },
    { at: 1230, words: ["Every", "write", "shows", "up", "on", "a", "socket,", "filtered", "by", "those", "same", "policies.", "You", "didn't", "build", "that."] },
    { at: 1444, words: ["Your", "team", "gets", "a", "real", "admin", "panel", "\u2014", "same", "data,", "same", "API,", "and", "nothing", "rebuilt", "for", "them."] },
    { at: 1705, words: ["Boards,", "tables,", "cards,", "forms,", "a", "record", "open", "beside", "them.", "All", "of", "it", "generated,", "all", "of", "it", "live."] },
    { at: 1926, words: ["And", "you", "can", "run", "the", "database", "from", "right", "inside", "it."] },
    { at: 2139, words: ["Studio", "reads", "it", "straight", "from", "the", "catalogue,", "so", "what", "you're", "looking", "at", "is", "what's", "really", "there."] },
    { at: 2399, words: ["One", "call,", "two", "people,", "different", "rows", "\u2014", "and", "neither", "can", "reach", "the", "other's."] },
    { at: 2639, words: ["Try", "it", "on", "whatever", "you're", "running", "today.", "Ours,", "or", "anyone's."] },
    { at: 2835, words: ["Agents", "get", "exactly", "what", "you", "get", "\u2014", "there's", "nothing", "to", "talk", "around."] },
    { at: 3030, words: ["Three", "commands,", "no", "account,", "and", "nothing", "to", "sign", "up", "for."] },
    { at: 3235, words: ["It's", "MIT,", "end", "to", "end,", "on", "your", "own", "machine.", "Nobody", "else", "holds", "your", "keys."] },
    { at: 3445, words: ["Start", "with", "the", "database", "you've", "already", "got."] },
];
