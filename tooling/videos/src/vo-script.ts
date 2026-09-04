/**
 * The voiceover, on an ABSOLUTE timeline.
 *
 * Two things set the numbers here, and neither is taste.
 *
 * The PACE is 180 words per minute, which is a brisk conversational read
 * rather than an announcer's. It was 150, which was an average I picked and
 * not a measurement of anyone.
 *
 * The LENGTH of each line is a budget, not a preference. The film is 3671
 * frames and the scenes are as long as their content needs — several are
 * still revealing items two hundred frames in, so they cannot be trimmed to
 * suit the script. That leaves a fixed amount of room per scene, and a line
 * written short does not create a pause worth having; it creates dead air.
 * So each line is written to fill its own scene, and the silence that is
 * left is spent deliberately: three real pauses, at the three act joins.
 *
 * Every line starts 24 frames BEFORE its own cut, so the narration carries
 * across the cut instead of restarting at it. The exception is the first,
 * which waits out the cold open.
 *
 * Frames are absolute from the first frame of the film. If a scene duration
 * changes these do NOT follow it — regenerate them.
 *
 * PLAIN ENGLISH IS A HARD RULE HERE, not a preference. "Live" was the word
 * that proved it: it meant real-time in one scene, running in another, and
 * not-a-mockup in a third, all within thirty seconds. A word that means three
 * things means none of them. Nothing here should need a second listen —
 * no idiom ("wire up"), no metaphor the app can't literally do ("hears
 * about it"), and no abstraction where a concrete noun exists.
 */
export const WORDS_PER_SECOND = 3.0;

/** Frames per word at that pace, at 30fps. */
export const FRAMES_PER_WORD = 10;

export const NARRATION: { at: number; words: string[] }[] = [
    { at: 126, words: ["An", "agent", "built", "this", "backend", "in", "an", "afternoon.", "A", "ten-second", "check", "found", "two", "ways", "anyone", "could", "read", "the", "data."] },   // Plausible
    { at: 372, words: ["So", "Rebase", "puts", "the", "rules", "about", "who", "sees", "what", "inside", "the", "database", "itself,", "where", "nothing", "can", "get", "around", "them."] },   // Claim
    { at: 582, words: ["You", "describe", "your", "data", "once,", "and", "the", "API,", "the", "code", "and", "the", "security", "rules", "all", "come", "from", "it.", "Change", "it,", "all", "three", "change."] },   // OneDefinition
    { at: 837, words: ["It's", "one", "install,", "and", "it", "brings", "you", "everything", "you're", "about", "to", "see.", "Nothing", "else", "to", "set", "up."] },   // Headline
    { at: 1017, words: ["Logins,", "file", "storage,", "real-time", "updates,", "scheduled", "jobs", "and", "backups", "—", "all", "of", "it", "already", "running."] },   // Headless
    { at: 1192, words: ["Real-time", "updates,", "so", "when", "data", "changes", "your", "app", "sees", "it", "immediately", "—", "and", "only", "the", "records", "that", "this", "person", "is", "allowed", "to", "see."] },   // Stream
    { at: 1432, words: ["And", "your", "team", "gets", "a", "real", "admin", "panel.", "It", "runs", "on", "the", "same", "data", "and", "the", "same", "rules", "as", "your", "app,", "so", "you", "never", "build", "the", "same", "thing", "twice."] },   // Panel
    { at: 1732, words: ["Boards,", "tables,", "cards,", "forms,", "filters", "and", "search", "—", "nobody", "built", "these", "by", "hand.", "They", "come", "from", "your", "data,", "and", "they", "all", "work."] },   // Everything
    { at: 1972, words: ["Run", "a", "query,", "change", "a", "field,", "or", "fix", "a", "permission,", "without", "opening", "a", "database", "tool."] },   // Studio
    { at: 2147, words: ["This", "diagram", "is", "read", "from", "the", "running", "database,", "so", "it", "is", "never", "out", "of", "date.", "Nobody", "has", "to", "update", "it."] },   // SchemaMap
    { at: 2407, words: ["The", "same", "request,", "sent", "by", "two", "different", "people,", "returns", "two", "completely", "different", "sets", "of", "records.", "Neither", "of", "them", "can", "see", "the", "other's", "data."] },   // TwoUsers
    { at: 2647, words: ["Try", "it", "on", "the", "database", "you", "already", "use", "today.", "It", "works", "on", "any", "Postgres,", "anywhere", "you", "run", "it."] },   // Proof
    { at: 2847, words: ["An", "agent", "gets", "your", "permissions,", "and", "it", "cannot", "go", "around", "them."] },   // Agent
    { at: 3012, words: ["Three", "commands", "and", "it's", "running", "on", "your", "own", "machine.", "No", "account", "to", "make,", "and", "nothing", "to", "sign", "up", "for."] },   // OneCommand
    { at: 3217, words: ["It's", "open", "source,", "it", "runs", "on", "your", "own", "machine,", "and", "nobody", "else", "ever", "has", "a", "copy", "of", "your", "data."] },   // Ownership
    { at: 3427, words: ["So", "go", "and", "build", "it", "by", "lunch,", "if", "you", "like.", "The", "difference", "is", "that", "this", "time,", "you'll", "know", "it's", "safe."] },   // Close
];
