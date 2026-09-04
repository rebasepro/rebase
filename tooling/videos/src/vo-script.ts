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
    { at: 126, words: ["An", "agent", "built", "this", "backend", "in", "an", "afternoon.", "Ten", "seconds", "of", "audit", "found", "two", "ways", "in."] },
    { at: 386, words: ["Rebase", "puts", "authorization", "in", "the", "database,", "where", "nothing", "can", "route", "around", "it."] },
    { at: 570, words: ["You", "describe", "a", "collection", "once.", "The", "API,", "the", "SDK", "and", "the", "policies", "all", "come", "from", "that", "file."] },
    { at: 788, words: ["Every", "endpoint,", "an", "OpenAPI", "spec,", "and", "types", "that", "know", "your", "columns."] },
    { at: 1000, words: ["One", "package,", "your", "Postgres,", "and", "everything", "that", "follows."] },
    { at: 1166, words: ["Auth,", "storage,", "realtime,", "functions,", "cron,", "backups", "\u2014", "running,", "not", "scaffolded."] },
    { at: 1385, words: ["Every", "write", "arrives", "on", "a", "socket,", "filtered", "by", "the", "same", "policies,", "without", "a", "subscription", "server."] },
    { at: 1599, words: ["Your", "team", "gets", "a", "real", "admin", "panel.", "The", "same", "data,", "the", "same", "API,", "nothing", "duplicated", "for", "them."] },
    { at: 1860, words: ["Boards,", "tables,", "cards,", "forms,", "a", "record", "open", "beside", "them.", "All", "generated,", "all", "live."] },
    { at: 2081, words: ["And", "you", "run", "the", "database", "from", "inside", "it.", "No", "second", "tool."] },
    { at: 2294, words: ["Studio", "reads", "the", "catalogue,", "so", "the", "schema", "you", "see", "is", "the", "one", "that", "exists."] },
    { at: 2554, words: ["One", "call,", "two", "people,", "different", "rows.", "Neither", "can", "ask", "for", "the", "other's,", "ever."] },
    { at: 2794, words: ["Run", "it", "on", "whatever", "you", "are", "running", "today.", "Ours,", "or", "anyone's."] },
    { at: 2990, words: ["Agents", "get", "what", "you", "get.", "There", "is", "nothing", "to", "negotiate", "with."] },
    { at: 3185, words: ["Three", "commands.", "No", "account,", "no", "container", "to", "pull,", "nothing", "to", "sign", "up", "for."] },
    { at: 3390, words: ["MIT,", "end", "to", "end,", "on", "your", "own", "machine.", "Nobody", "holds", "your", "keys."] },
    { at: 3565, words: ["Start", "with", "the", "database", "you", "already", "have."] },
];
