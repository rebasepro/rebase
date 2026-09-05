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
 * The film opens on a QUESTION — but the SLIDE asks it, and the line under
 * it supplies the evidence. Both saying it is how nine of eighteen lines
 * ended up paraphrasing their own picture once before.
 *
 * Anyone can ship a backend in an afternoon now, so "you can build one fast"
 * persuades nobody — the slide
 * already shows an agent that did it, and an audit finding three ways in.
 * The line asks whether you can trust the thing, and the rest of the film
 * answers it. Security is the argument, not a feature listed halfway down.
 *
 * There are NO references to Rebase Cloud. "Any cloud" in the ownership line
 * means the viewer's own infrastructure, which is the deploy-anywhere claim.
 *
 * EVERY "this" AND "it" MUST POINT AT SOMETHING ON SCREEN. The first line
 * once opened "An agent built this one in an afternoon" — "this one" named
 * nothing, in the first sentence of the film, before the viewer knew what
 * was being discussed. It says "This backend" now, and the terminal beside
 * it shows that backend being built. Same defect as an earlier cut's
 * "generated from that same file", pointing at a file never named.
 *
 * THE LINE MAY NOT CONTRADICT THE PICTURE. The two-users line said "neither
 * of them can see the other's data" while Dana, on screen, was looking at
 * all 48 rows including Robert's two — the scene exists to show that a
 * support role sees more, and the narration denied it. The wire's line
 * promised "only the records the user is allowed to see" over a feed that
 * shows every table there is. Each now describes what is in front of the
 * viewer: Robert sees his orders, Dana sees all of them; every insert,
 * update and delete, in every subscribed collection.
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
    { at: 126, words: ["This", "backend", "was", "built", "by", "an", "agent", "in", "an", "afternoon.", "It", "works.", "A", "ten-second", "scan", "found", "three", "ways", "in."] },   // Plausible
    { at: 372, words: ["That's", "what", "Rebase", "is", "for.", "Every", "rule", "about", "who", "sees", "what", "is", "enforced", "by", "Postgres,", "not", "by", "your", "code."] },   // Claim
    { at: 582, words: ["You", "describe", "your", "data", "once.", "The", "API,", "the", "types,", "the", "security", "rules,", "the", "admin", "panel", "—", "all", "of", "it", "comes", "from", "one", "file."] },   // OneDefinition
    { at: 837, words: ["It's", "one", "install,", "and", "it", "brings", "you", "everything", "you're", "about", "to", "see.", "Nothing", "else", "to", "set", "up."] },   // Headline
    { at: 1017, words: ["Logins,", "file", "storage,", "real-time", "updates,", "scheduled", "jobs", "and", "backups", "—", "all", "of", "it", "already", "running."] },   // Headless
    { at: 1192, words: ["Real-time", "updates.", "When", "data", "changes,", "your", "app", "sees", "it", "immediately", "—", "every", "insert,", "every", "update,", "every", "delete,", "in", "every", "collection", "you", "subscribed", "to."] },   // Stream
    { at: 1432, words: ["And", "your", "team", "gets", "a", "real", "admin", "panel.", "It", "runs", "on", "the", "same", "data", "and", "the", "same", "rules", "as", "your", "app,", "so", "you", "never", "build", "the", "same", "thing", "twice."] },   // Panel
    { at: 1732, words: ["Boards,", "tables,", "cards,", "forms,", "filters", "and", "search", "—", "nobody", "built", "these", "by", "hand.", "They", "come", "from", "your", "data,", "and", "they", "all", "work."] },   // Everything
    { at: 1972, words: ["Run", "a", "query,", "change", "a", "field,", "or", "fix", "a", "permission,", "without", "opening", "a", "database", "tool."] },   // Studio
    { at: 2147, words: ["This", "diagram", "is", "read", "from", "the", "running", "database,", "so", "it", "is", "never", "out", "of", "date.", "Nobody", "has", "to", "update", "it."] },   // SchemaMap
    { at: 2407, words: ["The", "same", "request,", "from", "two", "different", "people,", "gets", "two", "different", "answers.", "Robert", "sees", "his", "own", "orders.", "Dana,", "on", "support,", "sees", "all", "of", "them."] },   // TwoUsers
    { at: 2647, words: ["You", "can", "run", "the", "audit", "yourself,", "on", "the", "database", "you", "use", "today.", "It", "works", "on", "any", "Postgres,", "anywhere."] },   // Proof
    { at: 2847, words: ["An", "agent", "gets", "your", "permissions,", "and", "it", "cannot", "go", "around", "them."] },   // Agent
    { at: 3012, words: ["Three", "commands", "and", "it's", "running", "on", "your", "own", "machine.", "No", "account", "to", "make,", "and", "nothing", "to", "sign", "up", "for."] },   // OneCommand
    { at: 3217, words: ["Open", "source,", "and", "it", "runs", "anywhere", "—", "your", "laptop,", "your", "servers,", "any", "cloud.", "Nobody", "else", "ever", "holds", "your", "data."] },   // Ownership
    { at: 3427, words: ["So", "go", "and", "build", "it", "by", "lunch,", "if", "you", "like.", "The", "difference", "is", "that", "this", "time,", "you'll", "know", "it's", "safe."] },   // Close
];
