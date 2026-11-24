import React, { useCallback, useMemo } from "react";
import { useSearchParams } from "react-router";
import { asBoolean, asString, isRecord, useAdminFetch } from "../../utils/adminFetch";
import { SQLEditor } from "./SQLEditor";
import type { Snippet } from "./SQLEditorSidebar";
import type { SqlSnippetRemote } from "./useSqlSnippets";

/**
 * The query parameter other Studio views open the console with:
 * `/sql?sqlDraft=<encodeURIComponent(sql)>` opens that SQL in a new tab.
 * Namespaced, and removed on its own once read: the hosted console keeps its
 * open tab in `?tab=`, and a host app may use any other name.
 */
export const SQL_DRAFT_PARAM = "sqlDraft";

function snippetOf(value: unknown): Snippet {
    const record = isRecord(value) ? value : {};
    const createdAt = Date.parse(asString(record.createdAt));
    return {
        id: asString(record.id),
        name: asString(record.name),
        sql: asString(record.sql),
        createdAt: Number.isNaN(createdAt) ? Date.now() : createdAt,
        isFavorite: asBoolean(record.favorite),
        visibility: record.visibility === "team" ? "team" : "personal",
        ownerId: asString(record.ownerId)
    };
}

/**
 * The SQL console as Studio routes it: the draft another view sent in the
 * URL, and the project's snippet store at `/api/admin/sql/snippets`.
 */
export const SQLEditorRoute = () => {
    const [searchParams, setSearchParams] = useSearchParams();
    const draft = searchParams.get(SQL_DRAFT_PARAM);
    const { requestJson } = useAdminFetch();

    // Only this view's own parameter goes, on a functional update: the rest
    // of the query string — `?tab=` in the hosted console — is the host's.
    const consumeDraft = useCallback(() => {
        setSearchParams(previous => {
            const next = new URLSearchParams(previous);
            next.delete(SQL_DRAFT_PARAM);
            return next;
        }, { replace: true });
    }, [setSearchParams]);

    const snippetRemote = useMemo((): SqlSnippetRemote => ({
        async list() {
            const answer = await requestJson("/admin/sql/snippets");
            const snippets = isRecord(answer) && Array.isArray(answer.snippets) ? answer.snippets : [];
            return snippets.map(snippetOf);
        },
        async create(input) {
            const answer = await requestJson("/admin/sql/snippets", { method: "POST", body: input });
            return snippetOf(isRecord(answer) ? answer.snippet : undefined);
        },
        async update(id, patch) {
            const answer = await requestJson(`/admin/sql/snippets/${encodeURIComponent(id)}`, { method: "PATCH", body: patch });
            return snippetOf(isRecord(answer) ? answer.snippet : undefined);
        },
        async remove(id) {
            await requestJson(`/admin/sql/snippets/${encodeURIComponent(id)}`, { method: "DELETE" });
        }
    }), [requestJson]);

    return <SQLEditor incomingDraft={draft} onDraftConsumed={consumeDraft} snippetRemote={snippetRemote}/>;
};
