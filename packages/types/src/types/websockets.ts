export interface WebSocketErrorPayload {
    error?: string | { message: string; code?: string };
    message?: string;
    code?: string;
}

export interface WebSocketMessage {
    type: string;
    payload?: unknown;
    subscriptionId?: string;
    requestId?: string;
    rows?: Record<string, unknown>[];
    row?: Record<string, unknown> | null;
    error?: string;
    /**
     * Channel name, on broadcast and presence frames.
     *
     * These are addressed by channel rather than by `requestId` or
     * `subscriptionId`, so this is the only field that routes them.
     */
    channel?: string;
}

/**
 * The key columns a collection's rows are addressed by.
 *
 * A row is exactly its columns and carries no address, so a subscriber that has
 * to recognise one — to patch it, or to keep its reference across a refetch —
 * derives the address from these. The SDK is usable with no collections
 * declared at all, so the server is the only side that knows them.
 *
 * Undefined when the server cannot resolve them: a table with no primary key
 * and no `id` column has no address, and rows of it cannot be recognised by
 * anyone.
 */
export type WirePrimaryKeys = { fieldName: string; type: "string" | "number"; isUUID?: boolean }[];

/**
 * What a `collection_update` frame says about the page it carries.
 *
 * The same shape a REST list's `meta` has, and for the same reason: a
 * subscriber renders the list it was handed, and rendering it needs to know how
 * many rows there are in total and whether there is another page.
 *
 * It used not to be sent. The frame carried rows and primary keys and nothing
 * else, so the SDK issued a `GET /<collection>/count` **on every push** to
 * recover it — one extra round trip per write, per subscriber, and a window in
 * which the count and the rows described different states of the collection.
 * The refetch already knows the query, so it counts once, beside the rows,
 * inside the same RLS-bound transaction that read them.
 */
export interface CollectionUpdateMeta {
    /** Rows matching the subscription's query. Absent when the count failed. */
    total?: number;
    /** Page size the rows were read with. */
    limit: number;
    /** Rows skipped to reach them. */
    offset: number;
    /** Whether rows exist beyond this page. */
    hasMore: boolean;
    /** The opaque cursor continuing this listing — see `PaginationMeta.nextCursor`. */
    nextCursor?: string;
    /**
     * The count could not be taken, so `total` is missing and `hasMore` is a
     * floor rather than an answer.
     *
     * Flagged rather than guessed: a subscriber that knows the total is unknown
     * can keep the last one it had, which is what the SDK does. Substituting
     * `rows.length` would claim a page read at offset 10 held two rows.
     */
    partial?: boolean;
}

export interface CollectionUpdateMessage extends WebSocketMessage {
    type: "collection_update";
    subscriptionId: string;
    rows: Record<string, unknown>[];
    /**
     * See {@link WirePrimaryKeys}. Sent with the rows themselves — and not only
     * with a patch — because a CDC-originated change sends no patch at all: it
     * invalidates and goes straight to a refetch, and the merge that preserves
     * unchanged rows' references needs an address to match them by.
     */
    pks?: WirePrimaryKeys;
    /** See {@link CollectionUpdateMeta}. */
    meta?: CollectionUpdateMeta;
}

export interface SingleUpdateMessage extends WebSocketMessage {
    type: "single_update";
    subscriptionId: string;
    row: Record<string, unknown> | null;
}

/**
 * Lightweight patch message sent to collection subscribers when a single
 * row is created, updated, or deleted. The client can merge this into
 * its cached collection data for near-instant cross-tab updates without
 * waiting for a full collection refetch.
 */
export interface CollectionPatchMessage extends WebSocketMessage {
    type: "collection_patch";
    subscriptionId: string;
    /** The address of the row this patch refers to — derived, never read off it. */
    id: string;
    /** The updated row, or null if deleted */
    row: Record<string, unknown> | null;
    /** See {@link WirePrimaryKeys}: how the subscriber finds {@link id} in its cache. */
    pks?: WirePrimaryKeys;
}

// =============================================================================
// Channel-addressed frames
// =============================================================================

/**
 * A presence roster, keyed by the server's client id.
 *
 * The id is per socket rather than per user: the same person in two tabs is two
 * entries, and a reconnect replaces an entry rather than updating it. What the
 * values hold is entirely the application's — the server stores and echoes back
 * whatever `presence_track` was given, and never reads into it.
 */
export type PresenceState = Record<string, Record<string, unknown>>;

/**
 * Server → client: a message broadcast into a channel.
 *
 * The body is `payload`, inherited from {@link WebSocketMessage} — the server
 * passes it through untouched, so its shape is the application's business. The
 * sender is never sent its own broadcast back.
 */
export interface BroadcastMessage extends WebSocketMessage {
    type: "broadcast";
    channel: string;
    /**
     * The application-chosen event name. The only thing
     * `channel.onBroadcast(event, …)` filters on; the server does not interpret
     * it.
     */
    event: string;
    /**
     * Per-channel sequence number, present only on a channel the server has a
     * retention rule for.
     *
     * Dense and monotonically increasing, so a client that remembers the last
     * one it applied can name exactly where to resume from — see
     * {@link ChannelHistoryMessage}. Absent on an ephemeral channel, where
     * there is nothing to resume from and messages are delivered straight
     * through.
     */
    seq?: number;
}

/**
 * Server → client: the whole roster of a channel.
 *
 * Sent only in answer to a `presence_state` request. Joining does not push one,
 * and a client that has just tracked itself is told only about its own join, so
 * a client that waits for diffs alone believes it is the only one there until
 * somebody else happens to move. This is why the SDK's `join()` asks for a
 * roster rather than waiting to be given one.
 */
export interface PresenceStateMessage extends WebSocketMessage {
    type: "presence_state";
    channel: string;
    /**
     * Everyone currently tracked, this client included. Empty for a channel
     * nobody is tracking presence in — an answer, not an omission.
     */
    presences: PresenceState;
}

/**
 * Server → client: what moved in a channel's roster.
 *
 * Carries only the movement, never the roster, so a receiver maintains its own
 * copy by applying these to what it already had (which is why it needs a
 * {@link PresenceStateMessage} to start from).
 */
export interface PresenceDiffMessage extends WebSocketMessage {
    type: "presence_diff";
    channel: string;
    /**
     * Entries added or changed. A state update is a join over the same client
     * id, since that is what a receiver has to do with it either way.
     */
    joins: PresenceState;
    /**
     * Entries removed — by `presence_untrack`, by a closed socket, or by the
     * 30s expiry that reaps a client which stopped sending heartbeats.
     *
     * Keyed by client id like `joins`, and carrying each departing entry's last
     * state rather than just its id: enough to say who left without having kept
     * the roster.
     */
    leaves: PresenceState;
}

/**
 * Server → client: a refusal about one channel.
 *
 * Channel frames are fire-and-forget — there is no pending request to reject
 * and no subscription id to match — so a refused join, broadcast or history
 * read is addressed by channel like any other channel frame. Without the
 * `channel` field these fell through every branch of the client's message
 * handler into a console warning, which is why it is the one thing that makes
 * this a channel frame rather than a generic error.
 *
 * `type` is lowercase from the realtime service and uppercase from the socket
 * gateway (auth, rate limiting). Both are sent; a client must accept both.
 */
export interface ChannelErrorMessage extends WebSocketMessage {
    type: "error" | "ERROR";
    channel: string;
    /**
     * The refusal. `error` is a bare string when there is no code, and
     * `{ message, code }` when there is — `CHANNEL_FORBIDDEN`, `RATE_LIMITED`,
     * `CHANNEL_HISTORY_READ_FAILED` / `_WRITE_FAILED`,
     * `CHANNEL_BUS_PAYLOAD_TOO_LARGE`.
     *
     * The channel is echoed inside the envelope as well as beside it, for a
     * reader that has only the payload.
     */
    payload?: WebSocketErrorPayload & { channel?: string };
}

/**
 * One retained broadcast, as it travels on the wire.
 *
 * `seq` is per-channel, dense and monotonically increasing — it is the only
 * thing a reconnecting client needs to say where it got to. See
 * {@link ChannelHistoryMessage}.
 */
export interface ChannelHistoryEntry {
    seq: number;
    event: string;
    payload: unknown;
    /**
     * The server-side client id of whoever sent it, for information only.
     *
     * Deliberately not used to filter a client's own messages out of a replay:
     * a reconnect assigns a brand-new client id, so the very case replay exists
     * for is the case where this would fail to match. Consumers that cannot
     * tolerate re-applying their own operations must make them idempotent.
     */
    senderId?: string;
    /** When the server accepted it, ISO-8601. */
    at: string;
}

/**
 * Server → client: the retained messages a client missed.
 *
 * `retained: false` means the channel has no retention rule configured, so
 * there is no history to replay and there never will be — an explicit answer
 * rather than an empty one, so a client can tell "nothing missed" apart from
 * "this channel does not keep history".
 */
export interface ChannelHistoryMessage extends WebSocketMessage {
    type: "channel_history";
    channel: string;
    messages: ChannelHistoryEntry[];
    retained: boolean;
    /**
     * The highest seq the server holds for this channel, whether or not it was
     * returned. Lets a client that capped its request with `limit` see that it
     * is still behind, and decide to resync wholesale instead of paging.
     */
    latestSeq?: number;
}

/**
 * Every frame routed by channel name rather than by `requestId` or
 * `subscriptionId`.
 *
 * A discriminated union: each member fixes `type` to a literal, so a `switch`
 * over a value of this type narrows to the member and its fields. Narrowing
 * *into* it is the part that needs a predicate — a frame arrives as a
 * {@link WebSocketMessage}, whose `type` is a bare `string`, and a `string`
 * discriminates nothing.
 */
export type ChannelMessage =
    | BroadcastMessage
    | PresenceStateMessage
    | PresenceDiffMessage
    | ChannelHistoryMessage
    | ChannelErrorMessage;
