import React, { useEffect } from "react";
import type { AdminCollection } from "@rebasepro/cms-types";
import type { Property } from "@rebasepro/types";
import { enumToObjectEntries } from "@rebasepro/common";
import { Alert, Button, Dialog, DialogActions, DialogContent, DialogTitle, Typography } from "@rebasepro/ui";
import { getPropertyInPath } from "../util/property_utils";
import type { WriteIntent, WritePlan } from "./tool_driver";

/**
 * A write, as the person reads it before or after it happens.
 *
 * The server's plan is written for the model — a row id, which tools run, how
 * to undo through `details.current` — and it was shown as it came. The
 * person is told the same thing in their terms instead: the row by its title,
 * and each field it changes with the value it has and the value it gets, by
 * the field's own label and the enum's own label.
 */

interface FieldChange {
    label: string;
    from?: string;
    to: string;
}

const MAX_VALUE = 80;

/** One value as text, the way the field names it. */
export function shownValue(value: unknown, property: Property | undefined): string {
    if (value === undefined || value === null || value === "") return "empty";
    if (property && (property.type === "string" || property.type === "number") && property.enum) {
        const entry = enumToObjectEntries(property.enum).find(option => String(option.id) === String(value));
        if (entry) return entry.label;
    }
    if (typeof value === "boolean") return value ? "Yes" : "No";
    if (property?.type === "date" && (typeof value === "string" || value instanceof Date)) {
        const date = new Date(value);
        if (!Number.isNaN(date.getTime())) return date.toLocaleString();
    }
    if (Array.isArray(value)) return value.length === 1 ? "1 item" : `${value.length} items`;
    if (typeof value === "object") {
        const id = (value as { id?: unknown }).id;
        return id !== undefined ? String(id) : "changed";
    }
    const text = String(value).replace(/\s+/g, " ").trim();
    return text.length > MAX_VALUE ? `${text.slice(0, MAX_VALUE - 1)}…` : text;
}

/** Each field a write sets, labelled, with its old value where it is known and differs. */
export function fieldChanges(intent: WriteIntent, collection: AdminCollection | undefined): FieldChange[] {
    return Object.entries(intent.values ?? {}).flatMap(([key, value]) => {
        const property = collection ? getPropertyInPath(collection.properties, key) as Property | undefined : undefined;
        const to = shownValue(value, property);
        const before = intent.previous && key in intent.previous ? shownValue(intent.previous[key], property) : undefined;
        if (before === to) return [];
        return [{ label: property?.name ?? key, ...(before !== undefined && { from: before }), to }];
    });
}

/** What the row is called: its title, else the collection's word for one. */
function rowName(intent: WriteIntent, collection: AdminCollection | undefined): string {
    if (intent.title) return `“${intent.title}”`;
    const singular = collection?.singularName ?? collection?.name ?? intent.collection;
    return `this ${singular.toLowerCase()}`;
}

function heading(intent: WriteIntent, collection: AdminCollection | undefined): string {
    if (intent.action === "create") {
        const singular = (collection?.singularName ?? collection?.name ?? intent.collection).toLowerCase();
        return `Create a new ${singular}?`;
    }
    if (intent.action === "delete") return `Delete ${rowName(intent, collection)}?`;
    return `Save changes to ${rowName(intent, collection)}?`;
}

function Changes({ changes }: { changes: FieldChange[] }) {
    if (changes.length === 0) return null;
    return (
        <div className="grid gap-x-4 gap-y-1.5" style={{ gridTemplateColumns: "auto 1fr" }}>
            {changes.map(change => (
                <React.Fragment key={change.label}>
                    <Typography variant="body2" color="secondary">{change.label}</Typography>
                    <Typography variant="body2" className="min-w-0 break-words">
                        {change.from !== undefined && (
                            <span className="text-text-secondary dark:text-text-secondary-dark line-through">{change.from}</span>
                        )}
                        {change.from !== undefined && <span className="text-text-secondary dark:text-text-secondary-dark"> → </span>}
                        <span className="font-medium">{change.to}</span>
                    </Typography>
                </React.Fragment>
            ))}
        </div>
    );
}

/** The person's yes or no on a write that needs one. */
export function WriteConfirmDialog({ plan, collectionOf, onAnswer }: {
    plan: WritePlan | undefined;
    collectionOf: (name: string) => AdminCollection | undefined;
    onAnswer: (confirmed: boolean) => void;
}) {
    const intent = plan?.write;
    const collection = intent ? collectionOf(intent.collection) : undefined;
    const changes = intent && intent.action !== "delete" ? fieldChanges(intent, collection) : [];
    const deleting = intent?.action === "delete";
    return (
        <Dialog open={plan !== undefined} onOpenChange={open => !open && onAnswer(false)} maxWidth="sm">
            <DialogTitle variant="subtitle1">{intent ? heading(intent, collection) : "Save this change?"}</DialogTitle>
            <DialogContent className="flex flex-col gap-3">
                {intent
                    ? <Changes changes={changes}/>
                    : <Typography variant="body2">{plan?.summary}</Typography>}
                {deleting && (
                    <Typography variant="body2" color="secondary">It is removed from the project for everyone.</Typography>
                )}
            </DialogContent>
            <DialogActions>
                <Button variant="text" color="neutral" onClick={() => onAnswer(false)}>Cancel</Button>
                <Button variant="filled" color={deleting ? "error" : "primary"} onClick={() => onAnswer(true)}>
                    {deleting ? "Delete" : intent?.action === "create" ? "Create" : "Save"}
                </Button>
            </DialogActions>
        </Dialog>
    );
}

const NOTICE_MS = 5000;

/** What a write that did not ask first changed, said once it is saved, then gone. */
export function SavedNotice({ intent, collectionOf, onDismiss }: {
    intent: WriteIntent | undefined;
    collectionOf: (name: string) => AdminCollection | undefined;
    onDismiss: () => void;
}) {
    useEffect(() => {
        if (!intent) return;
        const timer = setTimeout(onDismiss, NOTICE_MS);
        return () => clearTimeout(timer);
    }, [intent, onDismiss]);
    if (!intent) return null;
    const collection = collectionOf(intent.collection);
    const changes = fieldChanges(intent, collection);
    const what = changes.map(change => `${change.label} → ${change.to}`).join(", ");
    const name = intent.title ? `“${intent.title}”` : (collection?.singularName ?? "the row").toLowerCase();
    return (
        <Alert color="success" size="small" outerClassName="sticky top-0 z-10" onDismiss={onDismiss}>
            {what ? `Saved ${name}: ${what}.` : `Saved ${name}.`}
        </Alert>
    );
}
