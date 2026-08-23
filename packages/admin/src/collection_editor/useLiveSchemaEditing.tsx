/**
 * The plan-then-confirm flow, as a hook.
 *
 * Owns three things that belong together and nothing else: whether the backend
 * can edit its schema, the plan for the change somebody is making, and the
 * dialog they confirm it in. The config controller calls `reviewChange` and
 * awaits it; everything about *how* the confirmation happens stays here.
 *
 * ## Why `reviewChange` returns a promise that can reject
 *
 * Because the editor needs to know. A save that was cancelled must not leave
 * the form thinking it succeeded — the collection on screen would then differ
 * from the one on disk, and the next save would be computed from the wrong
 * `before`. Rejecting with {@link SchemaChangeCancelled} is how "the person
 * said no" reaches the caller as an outcome rather than as silence.
 */
import React, { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { lazyChunk } from "@rebasepro/ui";

import {
    createLiveSchemaClient,
    LiveSchemaError,
    type LiveSchemaClient,
    type LiveSchemaPlan,
    type LiveSchemaResult,
    type LiveSchemaStatus,
    type ProposedCollectionChange
} from "./liveSchemaClient";

/**
 * Loaded when a change is actually being reviewed, not before.
 *
 * This hook is reached from the collections config controller, which is
 * constructed on every admin boot — so a static import would put the dialog and
 * the `@rebasepro/ui` surface it draws on into the **eager** bundle: everything
 * a browser downloads before the login screen paints. It cost 14 kB there, for
 * a dialog most sessions never open. The bundle budget caught it.
 */
const SchemaChangeDialog = lazyChunk(() =>
    import("./ui/collection_editor/SchemaChangeDialog")
        .then(m => ({ default: m.SchemaChangeDialog }))
);

/** The person closed the dialog without applying. Not an error; an answer. */
export class SchemaChangeCancelled extends Error {
    constructor() {
        super("The schema change was not applied.");
        this.name = "SchemaChangeCancelled";
    }
}

export interface UseLiveSchemaEditingOptions {
    /** Base for the routes, e.g. `https://api.example.com/api/admin/schema`. */
    baseUrl: string;
    getAuthToken?: () => Promise<string | null> | string | null;
    /**
     * Identity of the signed-in user.
     *
     * Only used to re-ask: whether this backend will accept a schema change
     * depends on who is asking, and the answer to an anonymous probe does not
     * survive a sign-in.
     */
    authKey?: string | null;
    /**
     * Write the collection source and leave the database alone — what the
     * editor did before this existed. Offered in the dialog when a change is
     * refused, so a dev can still delete a field from a collection they are
     * designing. Omit it and the fallback is not offered.
     */
    writeSourceOnly?: (change: ProposedCollectionChange) => Promise<void>;
    /** Swappable for the tests, which have no server. */
    client?: LiveSchemaClient;
}

interface PendingChange {
    change: ProposedCollectionChange;
    resolve: () => void;
    reject: (err: Error) => void;
}

export interface LiveSchemaEditing {
    /** `undefined` until the backend has answered. For rendering. */
    status?: LiveSchemaStatus;
    /**
     * The same answer, for deciding.
     *
     * `status` is undefined for one round trip after mount, and a caller that
     * read it to choose a code path would take the "not available" branch for
     * that window — so a save issued quickly after a page load would silently
     * skip the confirmation and write source only, while the same save a second
     * later would not. Timing-dependent behaviour with no visible difference is
     * the worst shape this could have.
     *
     * Resolves once, cached; never rejects, because every way of failing to get
     * an answer means the same thing to whoever is deciding.
     */
    ready: () => Promise<LiveSchemaStatus>;
    /**
     * Plan the change, show it, and settle when the person has decided.
     *
     * Resolves once the change has been applied — or written source-only, if
     * they chose that. Rejects with {@link SchemaChangeCancelled} if they
     * closed the dialog, and with the underlying error if planning or applying
     * failed in a way they did not choose.
     */
    reviewChange: (change: ProposedCollectionChange) => Promise<void>;
    /** Render this once, high enough that a dialog over the editor is not clipped. */
    dialog: React.ReactNode;
}

export function useLiveSchemaEditing(options: UseLiveSchemaEditingOptions): LiveSchemaEditing {
    const { baseUrl, authKey, writeSourceOnly } = options;

    const optionsRef = useRef(options);
    optionsRef.current = options;

    const client = useMemo(
        () => options.client ?? createLiveSchemaClient({
            baseUrl,
            getAuthToken: () => optionsRef.current.getAuthToken?.() ?? null
        }),
        // `client` is either supplied once by a test or built from the URL. The
        // token getter is read through the ref so a new closure on every render
        // does not rebuild the client underneath an in-flight request.
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [baseUrl, options.client]
    );

    const [status, setStatus] = useState<LiveSchemaStatus | undefined>();
    const [pending, setPending] = useState<PendingChange | undefined>();
    const [plan, setPlan] = useState<LiveSchemaPlan | undefined>();
    const [planError, setPlanError] = useState<string | undefined>();
    const [result, setResult] = useState<LiveSchemaResult | undefined>();
    const [applying, setApplying] = useState(false);
    const [applyError, setApplyError] = useState<string | undefined>();

    // The in-flight probe, so `ready()` can await the same one the effect
    // started rather than issuing a second. Keyed by client+authKey the same way
    // the effect is: a sign-in changes the answer, so it has to be re-asked.
    // `undefined` passed explicitly: React 19's `useRef` takes no zero-argument
    // overload, and omitting it is an error rather than a default.
    const probe = useRef<{ key: unknown[]; promise: Promise<LiveSchemaStatus> } | undefined>(undefined);

    const ready = useCallback((): Promise<LiveSchemaStatus> => {
        const key = [client, authKey];
        const current = probe.current;
        if (!current || current.key[0] !== key[0] || current.key[1] !== key[1]) {
            probe.current = { key, promise: client.status() };
        }
        return probe.current!.promise;
    }, [client, authKey]);

    useEffect(() => {
        let cancelled = false;
        void ready().then(answer => {
            if (!cancelled) setStatus(answer);
        });
        return () => { cancelled = true; };
    }, [ready]);

    const clear = useCallback(() => {
        setPending(undefined);
        setPlan(undefined);
        setPlanError(undefined);
        setResult(undefined);
        setApplyError(undefined);
        setApplying(false);
    }, []);

    const reviewChange = useCallback((change: ProposedCollectionChange) => {
        return new Promise<void>((resolve, reject) => {
            setPlan(undefined);
            setPlanError(undefined);
            setResult(undefined);
            setApplyError(undefined);
            setApplying(false);
            setPending({ change, resolve, reject });

            void client.plan(change).then(
                answer => setPlan(answer),
                (err: unknown) => setPlanError(
                    err instanceof LiveSchemaError || err instanceof Error
                        ? err.message
                        : String(err)
                )
            );
        });
    }, [client]);

    const onConfirm = useCallback(() => {
        if (!pending) return;
        setApplying(true);
        setApplyError(undefined);
        void client.apply(pending.change).then(
            answer => {
                setResult(answer);
                setApplying(false);
                // Resolved here, not on close. The change has happened, and the
                // dialog is now a receipt somebody may read for as long as they
                // like — holding the caller open until they close it would
                // leave the editor mid-save for no reason.
                pending.resolve();
                setPending(undefined);
            },
            (err: unknown) => {
                setApplying(false);
                setApplyError(err instanceof Error ? err.message : String(err));
            }
        );
    }, [client, pending]);

    const onSourceOnly = useCallback(() => {
        if (!pending || !writeSourceOnly) return;
        setApplying(true);
        setApplyError(undefined);
        const settle = pending;
        void writeSourceOnly(settle.change).then(
            () => { clear(); settle.resolve(); },
            (err: unknown) => {
                setApplying(false);
                setApplyError(err instanceof Error ? err.message : String(err));
            }
        );
    }, [pending, writeSourceOnly, clear]);

    const onClose = useCallback(() => {
        const settle = pending;
        clear();
        // A dialog showing a result has already resolved; closing it is not a
        // cancellation of anything.
        if (settle && !result) settle.reject(new SchemaChangeCancelled());
    }, [pending, result, clear]);

    // Not even a Suspense boundary until there is something to review — the
    // chunk is fetched by the first `reviewChange`, and an admin session that
    // never edits a collection never pays for it.
    const open = Boolean(pending) || Boolean(result);
    const dialog = open
        ? (
            <Suspense fallback={null}>
                <SchemaChangeDialog
                    open={open}
                    collectionId={pending?.change.collectionId ?? ""}
                    plan={plan}
                    planError={planError}
                    result={result}
                    applying={applying}
                    applyError={applyError}
                    onConfirm={onConfirm}
                    onSourceOnly={writeSourceOnly ? onSourceOnly : undefined}
                    onClose={onClose}
                    applyRefusedBecause={
                        status && !status.canApply ? status.applyRefusedBecause : undefined
                    }
                />
            </Suspense>
        )
        : null;

    return { status, ready, reviewChange, dialog };
}
