import { useCallback, useEffect, useRef, useState } from "react";
import { isArrayValue, readStoredJson, writeStoredJson } from "@rebasepro/utils";
import type { Snippet, SnippetVisibility } from "./SQLEditorSidebar";

/**
 * Where saved snippets live when the project keeps them: the server's
 * `/api/admin/sql/snippets`. Handed to the console by its route, which knows
 * how to reach the server; without it, snippets stay in this browser.
 */
export interface SqlSnippetRemote {
    list(): Promise<Snippet[]>;
    create(input: { name: string; sql: string; visibility: SnippetVisibility; favorite: boolean }): Promise<Snippet>;
    update(id: string, patch: { name?: string; sql?: string; visibility?: SnippetVisibility; favorite?: boolean }): Promise<Snippet>;
    remove(id: string): Promise<void>;
}

/**
 * `server`: the project keeps the snippets. `local`: this browser does,
 * because there is no server store to reach (an older server, a data source
 * without SQL, a role that may not read it). `loading` until that is known.
 */
export type SnippetStorage = "loading" | "server" | "local";

function isStoredSnippet(value: unknown): value is Snippet {
    if (typeof value !== "object" || value === null) return false;
    return "id" in value && typeof value.id === "string"
        && "name" in value && typeof value.name === "string"
        && "sql" in value && typeof value.sql === "string";
}

/**
 * The console's saved snippets, from the project's store when it has one.
 *
 * Snippets this browser kept before the project could are uploaded once,
 * each removed from local storage only when the server has confirmed it: an
 * upload cut short leaves the rest local, shown beside the server's and
 * uploaded on the next visit.
 */
export function useSqlSnippets(projectPrefix: string, remote: SqlSnippetRemote | undefined) {
    const storageKey = `rebase_sql_snippets_${projectPrefix}`;
    const [serverSnippets, setServerSnippets] = useState<Snippet[]>([]);
    const [localSnippets, setLocalSnippets] = useState<Snippet[]>([]);
    const [storage, setStorage] = useState<SnippetStorage>(remote ? "loading" : "local");

    const readLocal = useCallback(
        () => readStoredJson<unknown[]>(storageKey, { fallback: [], accept: isArrayValue }).filter(isStoredSnippet),
        [storageKey]
    );
    const writeLocal = useCallback((snippets: Snippet[]) => {
        setLocalSnippets(snippets);
        writeStoredJson(storageKey, snippets);
    }, [storageKey]);

    // A store answered for another project, or after the console moved on, is not this one's.
    const generationRef = useRef(0);

    useEffect(() => {
        const generation = ++generationRef.current;
        const current = () => generation === generationRef.current;
        const local = readLocal();
        setLocalSnippets(local);
        setServerSnippets([]);
        if (!remote) {
            setStorage("local");
            return;
        }
        setStorage("loading");
        (async () => {
            let listed: Snippet[];
            try {
                listed = await remote.list();
            } catch {
                if (current()) setStorage("local");
                return;
            }
            if (!current()) return;
            setServerSnippets(listed);
            setStorage("server");

            let pending = local;
            for (const snippet of local) {
                try {
                    const created = await remote.create({
                        name: snippet.name,
                        sql: snippet.sql,
                        visibility: "personal",
                        favorite: snippet.isFavorite === true
                    });
                    if (!current()) return;
                    pending = pending.filter(entry => entry.id !== snippet.id);
                    writeStoredJson(storageKey, pending);
                    setLocalSnippets(pending);
                    setServerSnippets(previous => [...previous, created]);
                } catch {
                    // Kept local, and offered again next time.
                    return;
                }
            }
        })();
    }, [remote, readLocal, storageKey]);

    const isLocal = useCallback((id: string) => localSnippets.some(snippet => snippet.id === id), [localSnippets]);

    const createSnippet = useCallback(async (input: { name: string; sql: string; visibility: SnippetVisibility }): Promise<void> => {
        if (storage === "server" && remote) {
            const created = await remote.create({ ...input, favorite: false });
            setServerSnippets(previous => [created, ...previous]);
            return;
        }
        writeLocal([...localSnippets, {
            id: Math.random().toString(36).substring(2, 9),
            name: input.name,
            sql: input.sql,
            createdAt: Date.now()
        }]);
    }, [storage, remote, localSnippets, writeLocal]);

    const setFavorite = useCallback(async (id: string, favorite: boolean): Promise<void> => {
        if (isLocal(id) || !remote) {
            writeLocal(localSnippets.map(snippet => snippet.id === id ? { ...snippet, isFavorite: favorite } : snippet));
            return;
        }
        const updated = await remote.update(id, { favorite });
        setServerSnippets(previous => previous.map(snippet => snippet.id === id ? updated : snippet));
    }, [isLocal, remote, localSnippets, writeLocal]);

    const deleteSnippet = useCallback(async (id: string): Promise<void> => {
        if (isLocal(id) || !remote) {
            writeLocal(localSnippets.filter(snippet => snippet.id !== id));
            return;
        }
        await remote.remove(id);
        setServerSnippets(previous => previous.filter(snippet => snippet.id !== id));
    }, [isLocal, remote, localSnippets, writeLocal]);

    return {
        snippets: [...serverSnippets, ...localSnippets],
        storage,
        createSnippet,
        setFavorite,
        deleteSnippet
    };
}
