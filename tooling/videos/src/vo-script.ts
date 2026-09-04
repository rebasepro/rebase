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
    { at: 126, words: ["An", "agent", "built", "this", "backend", "in", "an", "afternoon.", "A", "ten-second", "check", "found", "two", "ways", "anyone", "could", "read", "the", "data."] },
    { at: 386, words: ["So", "Rebase", "keeps", "the", "rules", "about", "who", "sees", "what", "inside", "the", "database", "itself."] },
    { at: 610, words: ["You", "describe", "your", "data", "once,", "and", "the", "API,", "the", "code", "and", "the", "security", "rules", "all", "come", "from", "it."] },
    { at: 909, words: ["It's", "one", "install,", "your", "own", "Postgres,", "and", "everything", "you're", "about", "to", "see."] },
    { at: 1067, words: ["Logins,", "file", "storage,", "live", "updates,", "scheduled", "jobs,", "backups", "\u2014", "already", "running."] },
    { at: 1230, words: ["When", "data", "changes", "your", "app", "hears", "about", "it", "instantly,", "and", "only", "what", "that", "person", "may", "see."] },
    { at: 1444, words: ["Your", "team", "gets", "a", "real", "admin", "panel,", "on", "the", "same", "data", "and", "the", "same", "rules.", "Nothing", "built", "twice."] },
    { at: 1705, words: ["Boards,", "tables,", "cards,", "forms,", "filters", "and", "search", "\u2014", "all", "of", "it", "generated,", "all", "of", "it", "live."] },
    { at: 1926, words: ["And", "you", "can", "query", "the", "database", "and", "change", "the", "schema", "right", "here."] },
    { at: 2139, words: ["This", "diagram", "is", "read", "from", "the", "live", "database,", "so", "it", "can", "never", "be", "out", "of", "date."] },
    { at: 2399, words: ["The", "same", "request,", "from", "two", "people,", "returns", "different", "rows.", "Neither", "can", "see", "the", "other's."] },
    { at: 2639, words: ["Try", "it", "on", "the", "database", "you", "use", "today.", "It", "works", "on", "any", "Postgres."] },
    { at: 2835, words: ["An", "agent", "gets", "your", "permissions,", "and", "it", "can't", "argue", "past", "them."] },
    { at: 3030, words: ["Three", "commands,", "no", "account,", "and", "nothing", "to", "sign", "up", "for."] },
    { at: 3235, words: ["It's", "open", "source,", "it", "runs", "on", "your", "machine,", "and", "nobody", "else", "has", "your", "password."] },
    { at: 3445, words: ["So", "build", "it", "by", "lunch", "if", "you", "like.", "The", "difference", "is", "you'll", "know", "it's", "safe."] },
];
