import {
    CollectionsConfigController,
    SaveCollectionParams,
    UpdateCollectionParams,
    DeleteCollectionParams,
    SavePropertyParams,
    DeletePropertyParams,
    UpdatePropertiesOrderParams,
    UpdateKanbanColumnsOrderParams,
    TableSourceInfo
} from "./types/config_controller";
import type { TableDescriptor, TablePatch, UiTablePreferences } from "@rebasepro/types";

import React, { useEffect, useMemo, useRef, useState } from "react";
import type { AdminCollection, AdminPostgresCollection } from "@rebasepro/cms-types";
import type { PostgresProperty, Property } from "@rebasepro/types";
import { DEFAULT_API_PATH } from "@rebasepro/app";
import { useLiveSchemaEditing } from "./useLiveSchemaEditing";
import { LiveSchemaError, type SchemaEditProblem } from "./liveSchemaClient";
import type { SplitEdit } from "./split_edit";
import { SplitEditError } from "./split_edit_error";
import { useDetachRulesConfirmation } from "./useDetachRulesConfirmation";

/**
 * What the backend said about its schema editor, and how sure we are.
 *
 * `unknown` covers both "still asking" and "could not ask" — a backend too old
 * to have the endpoint, or one that is unreachable. Those fall back to the
 * build-mode guess below rather than locking the editor for someone whose
 * editor used to work.
 */
type SchemaEditorAvailability =
    | { state: "unknown" }
    | { state: "known", enabled: boolean, reason?: string };

/**
 * The guess this hook used to make on its own.
 *
 * `process.env.NODE_ENV` here is the *frontend bundle's* build mode. Whether
 * the schema editor exists is decided by a different process entirely — the
 * server's own `NODE_ENV`, its `schemaDir`, whether its tables were
 * introspected, whether `ts-morph` is installed. It is kept only as the answer
 * for a backend too old to be asked.
 */
const buildModeGuess = (): boolean => process.env.NODE_ENV === "production";

/**
 * Where the collection editor's presentation edits go: the UI preferences
 * store (`usePresentationPersistence`). Absent, an edit that changes how a
 * table is presented is refused, never silently dropped.
 */
export interface PresentationWriter {
    /** Merge `delta` into the workspace's preferences for `slug`. */
    save: (slug: string, delta: UiTablePreferences) => Promise<void>;
}

/** The client the controller is built over: a base URL, or the Rebase client. */
export interface SchemaEditorTransport {
    baseUrl?: string;
    apiPath?: string;
    resolveToken?: () => Promise<string | null | undefined>;
}

/** How the server's `GET /schema-editor/tables` describes one table. */
interface TableSourceSummary {
    slug: string;
    file: string;
    editedInCode?: string;
    columns?: { key: string; editedInCode?: string }[];
    relations?: { name: string; editedInCode?: string }[];
    rlsEditedInCode?: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === "object" && value !== null && !Array.isArray(value);

function readSummaries(body: unknown): TableSourceSummary[] {
    if (!isRecord(body) || !Array.isArray(body.tables)) return [];
    return body.tables.flatMap((entry): TableSourceSummary[] => {
        if (!isRecord(entry) || typeof entry.slug !== "string" || typeof entry.file !== "string") return [];
        const listed = (value: unknown, name: "key" | "name") => Array.isArray(value)
            ? value.flatMap(item => isRecord(item) && typeof item[name] === "string"
                ? [{ id: String(item[name]), reason: typeof item.editedInCode === "string" ? item.editedInCode : undefined }]
                : [])
            : [];
        return [{
            slug: entry.slug,
            file: entry.file,
            ...(typeof entry.editedInCode === "string" ? { editedInCode: entry.editedInCode } : {}),
            columns: listed(entry.columns, "key").map(c => ({ key: c.id, ...(c.reason ? { editedInCode: c.reason } : {}) })),
            relations: listed(entry.relations, "name").map(r => ({ name: r.id, ...(r.reason ? { editedInCode: r.reason } : {}) })),
            ...(typeof entry.rlsEditedInCode === "string" ? { rlsEditedInCode: entry.rlsEditedInCode } : {})
        }];
    });
}

function sourceInfoOf(summary: TableSourceSummary): TableSourceInfo {
    const columns: Record<string, string> = {};
    for (const column of summary.columns ?? []) if (column.editedInCode) columns[column.key] = column.editedInCode;
    for (const relation of summary.relations ?? []) if (relation.editedInCode) columns[relation.name] = relation.editedInCode;
    return {
        file: summary.file,
        ...(summary.editedInCode ? { editedInCode: summary.editedInCode } : {}),
        fields: columns,
        ...(summary.rlsEditedInCode ? { rlsEditedInCode: summary.rlsEditedInCode } : {})
    };
}

/**
 * An error a save ends with that the editor shows as more than a line:
 * `SCHEMA_EDIT_DOES_NOT_COMPILE` with its problems, a refusal, a file changed
 * on disk since the preview. Carries the server's code and problems.
 */
export class SchemaEditRefused extends Error {
    constructor(message: string, readonly code: string | undefined, readonly problems: readonly SchemaEditProblem[] = []) {
        super(message);
        this.name = "SchemaEditRefused";
    }
}

/**
 * The collections config controller the panel builds when the collection
 * editor is on.
 *
 * A save is split ({@link splitEdit}) into the schema edit — `TablePatch`
 * operations for the server's schema editor, through the plan-and-confirm
 * dialog when live schema editing is on, straight to the source-only editor
 * when it is not — and the presentation delta, written to the UI preferences
 * store. Collections whose rows live elsewhere (Firestore) are defined in the
 * frontend and are read-only here.
 */
export function useLocalCollectionsConfigController(
    clientOrUrl: string | SchemaEditorTransport | null | undefined,
    baseCollections: AdminCollection[] = [],
    options?: {
        readOnly?: boolean;
        getAuthToken?: () => Promise<string | null>;
        /**
         * Identity of the signed-in user, if any. Only used to re-ask the
         * backend when it changes.
         */
        authKey?: string | null;
        /**
         * Whether the signed-in user holds `schema:read`, which both status
         * routes require. `false` asks neither and leaves the editor
         * read-only. Absent means ask.
         */
        mayReadSchema?: boolean;
        /**
         * The tables the server serves, as descriptors: what a save keeps from
         * a column the view model cannot fully describe, and which collections
         * are tables at all (the others are external, and read-only here).
         */
        tables?: readonly TableDescriptor[];
        /** Where presentation edits are written. */
        presentation?: PresentationWriter;
    }
): CollectionsConfigController {

    const parsedCollections = baseCollections;

    const optionsRef = useRef(options);
    optionsRef.current = options;

    const transport: SchemaEditorTransport = typeof clientOrUrl === "string" ? { baseUrl: clientOrUrl } : clientOrUrl ?? {};
    const clientBaseUrl = String(transport.baseUrl ?? "").replace(/\/$/, "");
    const clientApiPath = transport.apiPath || DEFAULT_API_PATH;
    const editorUrl = `${clientBaseUrl}${clientApiPath}/admin/schema-editor`;

    const resolveToken = async (): Promise<string | null> => {
        let token = optionsRef.current?.getAuthToken ? await optionsRef.current.getAuthToken() : null;
        if (!token && transport.resolveToken) token = (await transport.resolveToken()) ?? null;
        return token ?? null;
    };

    /** A call to the source-only editor; a refusal becomes {@link SchemaEditRefused} with the server's problems. */
    const request = async (method: "GET" | "POST", endpoint: string, payload?: Record<string, unknown>): Promise<unknown> => {
        const token = await resolveToken();
        const headers: Record<string, string> = { "Content-Type": "application/json" };
        if (token) headers.Authorization = `Bearer ${token}`;
        const response = await fetch(`${editorUrl}${endpoint}`, {
            method,
            headers,
            ...(payload ? { body: JSON.stringify(payload) } : {})
        });
        const text = await response.text();
        let body: unknown;
        try {
            body = text ? JSON.parse(text) : undefined;
        } catch {
            body = undefined;
        }
        if (response.ok) return body;
        const error = isRecord(body) && isRecord(body.error) ? body.error : undefined;
        const details = error && isRecord(error.details) ? error.details : undefined;
        const problems: SchemaEditProblem[] = Array.isArray(details?.problems)
            ? details.problems.flatMap((p): SchemaEditProblem[] => isRecord(p) && typeof p.message === "string"
                ? [{ table: typeof p.table === "string" ? p.table : "", ...(typeof p.key === "string" ? { key: p.key } : {}), message: p.message }]
                : [])
            : [];
        throw new SchemaEditRefused(
            (typeof error?.message === "string" && error.message) || text || `The schema editor answered ${response.status}.`,
            typeof error?.code === "string" ? error.code : undefined,
            problems
        );
    };

    // ── Ask the backend whether it will accept an edit ────────────────
    const noSchemaAccess = options?.mayReadSchema === false;
    const forcedReadOnly = noSchemaAccess ? true : options?.readOnly;
    const authKey = options?.authKey ?? null;
    const [availability, setAvailability] = useState<SchemaEditorAvailability>({ state: "unknown" });
    const [sources, setSources] = useState<Record<string, TableSourceInfo>>({});

    useEffect(() => {
        if (forcedReadOnly === true) return;

        let cancelled = false;
        (async () => {
            try {
                const token = await resolveToken();
                const response = await fetch(`${editorUrl}/status`, {
                    headers: token ? { Authorization: `Bearer ${token}` } : {}
                });
                if (cancelled) return;
                if (response.status === 404) {
                    setAvailability({ state: "unknown" });
                    return;
                }
                const body = await response.json().catch(() => ({})) as {
                    enabled?: boolean,
                    reason?: string,
                    error?: { message?: string }
                };
                if (cancelled) return;
                if (response.ok) {
                    setAvailability({ state: "known", enabled: body.enabled === true, reason: body.reason });
                    if (body.enabled === true) {
                        // What is edited in code, so the editor shows it read-only
                        // rather than offering an edit the server refuses.
                        const listed = await request("GET", "/tables").catch(() => undefined);
                        if (!cancelled && listed !== undefined) {
                            const next: Record<string, TableSourceInfo> = {};
                            for (const summary of readSummaries(listed)) next[summary.slug] = sourceInfoOf(summary);
                            setSources(next);
                        }
                    }
                } else {
                    setAvailability({
                        state: "known",
                        enabled: false,
                        reason: body.error?.message
                            ?? `The backend refused to say whether tables are editable (HTTP ${response.status}).`
                    });
                }
            } catch {
                if (!cancelled) setAvailability({ state: "unknown" });
            }
        })();

        return () => { cancelled = true; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [editorUrl, forcedReadOnly, authKey]);

    // ── Live schema editing ───────────────────────────────────────────
    const liveSchema = useLiveSchemaEditing({
        baseUrl: `${clientBaseUrl}${clientApiPath}/admin/schema`,
        getAuthToken: resolveToken,
        authKey,
        enabled: forcedReadOnly !== true
    });

    const detach = useDetachRulesConfirmation();

    const tablesBySlug = useMemo(() => {
        const map = new Map<string, TableDescriptor>();
        for (const table of options?.tables ?? []) map.set(table.slug, table);
        return map;
    }, [options?.tables]);

    /**
     * Send a schema edit: through the live editor (planned, shown, confirmed)
     * when there is one, to the source-only editor when there is not.
     */
    const writeSchema = async (table: string, patches: TablePatch[]): Promise<void> => {
        if (patches.length === 0) return;
        const available = await liveSchema.ready();
        if (available.enabled) {
            await liveSchema.reviewChange({ table, patches });
            return;
        }
        try {
            await request("POST", "/apply", { patches });
        } catch (error) {
            if (error instanceof LiveSchemaError) throw new SchemaEditRefused(error.message, error.code, error.problems);
            throw error;
        }
    };

    const writePresentation = async (slug: string, delta: UiTablePreferences): Promise<void> => {
        if (Object.keys(delta).length === 0) return;
        const writer = optionsRef.current?.presentation;
        if (!writer) {
            throw new Error(`How "${slug}" is presented (labels, columns, view modes) is stored as a UI preference, and this panel has no preferences store. Sign in, or customize the table with customizeTable in the frontend.`);
        }
        await writer.save(slug, delta);
    };

    const findCollection = (id: string): AdminCollection | undefined =>
        parsedCollections.find(c => c.slug === id);

    /** A collection that is not a served table is defined in the frontend: refuse to edit it here. */
    const assertTable = (collection: AdminCollection | undefined, slug: string): void => {
        if (!collection || tablesBySlug.size === 0 || tablesBySlug.has(slug)) return;
        throw new SplitEditError("EXTERNAL_COLLECTION",
            `"${slug}" is not a table of this backend: it is defined in the frontend (frontend/src/cms), which the schema editor does not write. Edit it there.`);
    };

    /** Write one split edit: the schema first, then — once the schema took — the presentation. */
    const commit = async (edit: SplitEdit): Promise<void> => {
        if (edit.detachesInheritedRules) await detach.confirm(edit.table);
        await writeSchema(edit.table, edit.schema);
        await writePresentation(edit.table, edit.presentation);
    };

    const save = async (slug: string, after: AdminCollection, before?: AdminCollection): Promise<void> => {
        const loaded = before ?? findCollection(slug);
        assertTable(loaded, slug);
        // Loaded with the first save: the boot path of every admin session
        // builds this controller, and most sessions never save a table.
        const { splitEdit } = await import("./split_edit");
        await commit(splitEdit({ before: loaded, after, table: tablesBySlug.get(slug) }));
    };

    // Live schema editing, when it is on, is where every write goes, so the
    // source-only editor's answer does not lock the editor then.
    const liveEditing = liveSchema.status?.enabled === true;
    const servedRedacted = parsedCollections.some(c => (c.securityRules ?? []).some(rule => isRecord(rule) && rule.redacted === true));
    const readOnly = forcedReadOnly
        ?? (servedRedacted ? true : liveEditing ? false : availability.state === "known" ? !availability.enabled : buildModeGuess());

    const readOnlyReason = noSchemaAccess
        ? undefined
        : servedRedacted
            ? "Some of the rules were served to you redacted: only an admin can save schema changes, because saving would write the redacted marker back."
            : liveEditing
                ? undefined
                : availability.state === "known" && availability.reason
                    ? availability.reason
                    : "Tables can only be edited against a backend running the schema editor, which is off in production.";

    const currentOf = (id: string): AdminCollection => {
        const found = findCollection(id);
        if (!found) throw new Error(`No table "${id}" is open in the editor.`);
        return found;
    };

    /** The collection of a table, or a refusal naming where an external collection is defined. */
    const tableOf = (id: string): AdminPostgresCollection => {
        const found = currentOf(id);
        if (found.engine === "firestore") {
            throw new SplitEditError("EXTERNAL_COLLECTION",
                `"${id}" is a Firestore collection: it is defined in the frontend (frontend/src/cms), which the schema editor does not write. Edit it there.`);
        }
        return found;
    };

    const columnProperty = (key: string, property: Property): PostgresProperty => {
        if (property.type === "reference") {
            throw new SplitEditError("NOT_A_COLUMN",
                `"${key}" is a reference, which a table stores as a text column: make it a text field and point it at the other table with \`referenceTo\` in its customization.`, key);
        }
        return property;
    };

    return useMemo(() => ({
        loading: false,
        readOnly,
        readOnlyReason,
        collections: parsedCollections,
        tableSource: (slug: string) => sources[slug],
        dialog: (
            <>
                {liveSchema.dialog}
                {detach.dialog}
            </>
        ),
        getCollection: (id: string) => currentOf(id),

        saveCollection: async ({ id, collectionData, baseline }: SaveCollectionParams) => {
            await save(id, collectionData, baseline);
        },
        // `collectionData` is a partial: the keys it names, set over the
        // collection as it is.
        updateCollection: async ({ id, collectionData }: UpdateCollectionParams) => {
            const after: AdminPostgresCollection = { ...tableOf(id) };
            for (const [key, value] of Object.entries(collectionData)) {
                // Absent rather than `undefined` when cleared.
                if (value === undefined) Reflect.deleteProperty(after, key);
                else Reflect.set(after, key, value);
            }
            await save(id, after);
        },
        // The table's definition and its export from the index go; the SQL
        // table and its rows stay, and the plan says so.
        deleteCollection: async ({ id }: DeleteCollectionParams) => {
            assertTable(findCollection(id), id);
            await writeSchema(id, [{ op: "deleteTable", table: id }]);
        },
        applyTablePatches: async (table: string, patches: TablePatch[]) => {
            await writeSchema(table, patches);
        },

        saveProperty: async ({ path, propertyKey, property, newPropertiesOrder }: SavePropertyParams) => {
            const current = tableOf(path);
            await save(path, {
                ...current,
                properties: { ...current.properties, [propertyKey]: columnProperty(propertyKey, property) },
                ...(newPropertiesOrder ? { propertiesOrder: newPropertiesOrder } : {})
            });
        },
        deleteProperty: async ({ path, propertyKey, newPropertiesOrder }: DeletePropertyParams) => {
            const current = tableOf(path);
            const { [propertyKey]: _removed, ...properties } = current.properties ?? {};
            void _removed;
            await save(path, {
                ...current,
                properties,
                ...(newPropertiesOrder ? { propertiesOrder: newPropertiesOrder } : {})
            });
        },

        // Column order is presentation: a preference, never a schema edit.
        updatePropertiesOrder: async ({ collection, newPropertiesOrder }: UpdatePropertiesOrderParams) => {
            await writePresentation(collection.slug, { fieldOrder: [...newPropertiesOrder] });
        },
        // The board's column order is the order of the enum's values: presentation too.
        updateKanbanColumnsOrder: async ({ collection, kanbanColumnProperty, newColumnsOrder }: UpdateKanbanColumnsOrderParams) => {
            await writePresentation(collection.slug, { fields: { [kanbanColumnProperty]: { enumOrder: [...newColumnsOrder] } } });
        },

        navigationEntries: [],
        saveNavigationEntries: async () => { }
        // Every input that can change is listed under the name it varies with;
        // the helpers rebuilt per render close over exactly these.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }), [
        clientOrUrl,
        parsedCollections,
        readOnly,
        readOnlyReason,
        sources,
        tablesBySlug,
        options?.getAuthToken,
        liveSchema.dialog,
        liveSchema.status,
        detach.dialog
    ]);
}
