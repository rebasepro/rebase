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
 * Column metadata returned by table introspection.
 */
export interface TableColumnInfo {
    column_name: string;
    data_type: string;
    udt_name: string;
    is_nullable: string;
    column_default: string | null;
    character_maximum_length: number | null;
    /** Enum values, populated for USER-DEFINED (enum) columns */
    enum_values?: string[];
}

export interface TableForeignKeyInfo {
    column_name: string;
    foreign_table_name: string;
    foreign_column_name: string;
}

export interface TableJunctionInfo {
    junction_table_name: string;
    source_column_name: string;
    target_table_name: string;
    target_column_name: string;
}

export interface TablePolicyInfo {
    policy_name: string;
    roles: string[];
    cmd: string;
    qual?: string;
    with_check?: string;
}

export interface TableMetadata {
    columns: TableColumnInfo[];
    foreignKeys: TableForeignKeyInfo[];
    junctions: TableJunctionInfo[];
    policies: TablePolicyInfo[];
}
