
import React, { useState } from "react";
import {
    Button,
    cls,
    Container,
    defaultBorderMixin,
    Dialog,
    DialogActions,
    DialogContent,
    DialogTitle,
    IconButton,
    Select,
    SelectItem,
    Table,
    TableBody,
    TableCell,
    TableHeader,
    TableRow,
    TextField,
    Trash2Icon,
    Typography
} from "@rebasepro/ui";
import { useFormex } from "@rebasepro/forms";
import { Relation, RelationKind, JoinStep, OnAction } from "@rebasepro/types";
import { RELATION_KINDS, RELATION_KIND_ORDER } from "../../relation_kinds";
import { useCollectionsConfigController } from "../../useCollectionsConfigController";
import type { AdminPostgresCollection } from "@rebasepro/admin-types";

/**
 * A relation being edited.
 *
 * Deliberately not `Partial<Relation>`: `Relation` is a union, and a partial of
 * a union distributes into "partial of each member", so a draft that has picked
 * `kind: "manyToMany"` but not yet a junction table does not typecheck as any
 * member. A form in progress is not a relation — it becomes one on save.
 */
export type RelationDraft = {
    kind?: Relation["kind"];
    relationName?: string;
    target?: string;
    localKey?: string;
    foreignKeyOnTarget?: string;
    sourceKey?: string;
    through?: { table?: string; sourceColumn?: string; targetColumn?: string };
    joinPath?: JoinStep[];
    cardinality?: "one" | "many";
    onUpdate?: OnAction;
    onDelete?: OnAction;
};


/**
 * The dropdown's options, keyed by kind.
 *
 * Typed `Record<RelationKind, string>` rather than written inline as JSX, so
 * adding a sixth kind to the union fails to compile here instead of quietly
 * producing a picker that cannot author it.
 */
export const KIND_LABELS: Record<RelationKind, string> = Object.fromEntries(
    RELATION_KIND_ORDER.map(k => [k, `${RELATION_KINDS[k].label} — ${RELATION_KINDS[k].description}`])
) as Record<RelationKind, string>;

/** An empty step, for a `via` chain being built up. */
const EMPTY_STEP: JoinStep = { table: "",
on: { from: "",
to: "" } };

/**
 * Whether a draft is complete enough to be a relation of its kind.
 *
 * `via` is the reason this exists. Every other kind can fall back on a derived
 * default — a `belongsTo` with no `localKey` resolves to `<name>_id` — but a
 * join chain has nothing to derive from, so a `via` with an empty `joinPath`
 * joins nothing and returns nothing. The dialog used to let it be saved.
 */
export { relationFromDraft };

export function draftIsComplete(draft: RelationDraft): boolean {
    if (!draft.relationName || !draft.target) return false;
    if (draft.kind === "via") {
        const steps = draft.joinPath ?? [];
        if (steps.length === 0) return false;
        return steps.every(s => s.table && s.on?.from && s.on?.to);
    }
    return true;
}

/**
 * Build a relation from a draft, keeping only the fields its kind owns.
 *
 * The dialog used to cast the draft straight to `Relation`. A draft accumulates
 * whatever the user has typed, and switching kind does not clear what the
 * previous kind collected — so filling in a junction table, then switching to
 * "Belongs to", saved a relation carrying both `localKey` and `through`. That
 * is exactly the shape the union exists to make impossible, smuggled past it by
 * the cast. Reloading would then fail validation on a collection the editor
 * itself had written.
 *
 * Returns null for a draft that is not a relation yet, so the caller can bail
 * rather than persist a half-built one.
 */
function relationFromDraft(draft: RelationDraft): Relation | null {
    if (!draft.kind || !draft.relationName || !draft.target) return null;

    const common = {
        relationName: draft.relationName,
        target: draft.target as unknown as Relation["target"],
        ...(draft.onUpdate ? { onUpdate: draft.onUpdate } : {}),
        ...(draft.onDelete ? { onDelete: draft.onDelete } : {})
    };

    switch (draft.kind) {
        case "belongsTo":
            return { ...common,
kind: "belongsTo",
...(draft.localKey ? { localKey: draft.localKey } : {}) };
        case "hasOne":
        case "hasMany":
            return {
                ...common,
                kind: draft.kind,
                ...(draft.foreignKeyOnTarget ? { foreignKeyOnTarget: draft.foreignKeyOnTarget } : {}),
                ...(draft.sourceKey ? { sourceKey: draft.sourceKey } : {})
            };
        case "manyToMany":
            return { ...common,
kind: "manyToMany",
...(draft.through ? { through: draft.through } : {}) };
        case "via":
            return {
                ...common,
                kind: "via",
                cardinality: draft.cardinality ?? "many",
                joinPath: draft.joinPath ?? []
            };
        default: {
            const exhaustive: never = draft.kind;
            throw new Error(`Unhandled relation kind: ${String(exhaustive)}`);
        }
    }
}

export function CollectionRelationsTab() {
    const { values, setFieldValue } = useFormex<AdminPostgresCollection>();
    const { collections } = useCollectionsConfigController();
    const [editingRelationIndex, setEditingRelationIndex] = useState<number | null>(null);
    const [editingRelationState, setEditingRelationState] = useState<RelationDraft | null>(null);

    const getTargetSlug = (target: any) => {
        if (typeof target === "string") {
            const match = target.match(/\(\)\s*=>\s*([a-zA-Z0-9_]+)/);
            return match ? match[1] : target;
        }
        if (typeof target === "function") {
            try {
                // If we attached a slug manually
                if (target.slug) return target.slug;
                const col = target();
                return col?.slug || col?.name || "";
            } catch (e) {
                return "";
            }
        }
        return "";
    };

    const relations = values.relations || [];

    const handleDelete = (index: number) => {
        const newRelations = [...relations];
        newRelations.splice(index, 1);
        setFieldValue("relations", newRelations);
    };

    const handleSave = () => {
        if (!editingRelationState) return;

        const relation = relationFromDraft(editingRelationState);
        if (!relation) return;

        const newRelations = [...relations];
        if (editingRelationIndex === -1) {
            newRelations.push(relation);
        } else if (editingRelationIndex !== null) {
            newRelations[editingRelationIndex] = relation;
        }
        setFieldValue("relations", newRelations);

        setEditingRelationIndex(null);
        setEditingRelationState(null);
    };

    const handleCancel = () => {
        setEditingRelationIndex(null);
        setEditingRelationState(null);
    };

    return (
        <div className="overflow-auto my-auto h-full w-full">
            <Container maxWidth="4xl" className="flex flex-col gap-4 p-8 m-auto h-full">
                <div className="flex items-center justify-between mb-8">
                    <Typography variant="h5">Relations</Typography>
                    <Button variant="filled" color="neutral" onClick={() => {
                        setEditingRelationIndex(-1);
                        setEditingRelationState({ relationName: "",
target: "",
kind: "hasMany" });
                    }}>
                        ADD RELATION
                    </Button>
                </div>

                {relations.length > 0 ? (
                    <div className="w-full overflow-auto border dark:border-surface-800 rounded-lg">
                        <Table className="w-full">
                            <TableHeader>
                                <TableCell header className="w-16"></TableCell>
                                <TableCell header>Name</TableCell>
                                <TableCell header>Target</TableCell>
                                <TableCell header>Kind</TableCell>
                            </TableHeader>
                            <TableBody>
                                {relations.map((relation, index) => (
                                    <TableRow key={index}
                                              className="cursor-pointer hover:bg-surface-100 dark:hover:bg-surface-800"
                                              onClick={() => {
                                                  setEditingRelationIndex(index);
                                                  setEditingRelationState(relation as unknown as RelationDraft);
                                              }}>
                                        <TableCell style={{ width: "64px" }}>
                                            <IconButton size="small" onClick={(e) => {
                                                e.stopPropagation();
                                                handleDelete(index);
                                            }}>
                                                <Trash2Icon/>
                                            </IconButton>
                                        </TableCell>
                                        <TableCell className="font-medium">{relation.relationName}</TableCell>
                                        <TableCell>{getTargetSlug(relation.target) || "Function"}</TableCell>
                                        <TableCell>{relation.kind}</TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    </div>
                ) : (
                    <div className="flex-grow flex flex-col border border-dashed dark:border-surface-700 rounded-lg items-center justify-center text-text-disabled py-20">
                        <Typography variant="body2" className="mb-4">No relations defined for this collection.</Typography>
                        <Button variant="text" onClick={() => {
                            setEditingRelationIndex(-1);
                            setEditingRelationState({ relationName: "",
target: "",
kind: "hasMany" });
                        }}>Create your first relation</Button>
                    </div>
                )}

                <Dialog open={!!editingRelationState} onOpenChange={(open) => !open && handleCancel()} maxWidth="2xl">
                    {editingRelationState && (
                        <>
                            <DialogTitle className="flex justify-between items-center w-full" variant="h6">
                                {editingRelationIndex === -1 ? "New Relation" : "Edit Relation"}
                            </DialogTitle>
                            <DialogContent includeMargin={false} className={cls("p-4 md:p-6 border-t bg-white dark:bg-surface-900", defaultBorderMixin)}>
                                <div className="flex flex-col gap-4 max-w-2xl mx-auto">
                                    <TextField
                                        label="Relation Name"
                                        name="relationName"
                                        placeholder="e.g. posts"
                                        value={editingRelationState.relationName || ""}
                                        onChange={(e) => setEditingRelationState(prev => prev ? { ...prev,
relationName: e.target.value } : null)}
                                    />
                                    <Select
                                        fullWidth
                                        label="Target Collection"
                                        value={getTargetSlug(editingRelationState.target)}
                                        onValueChange={(val) => {
                                            setEditingRelationState(prev => {
                                                if (!prev) return null;
                                                                                                return { ...prev,
target: val };
                                            });
                                        }}
                                    >
                                        {collections?.map(col => (
                                            <SelectItem key={col.slug} value={col.slug}>{col.name || col.slug}</SelectItem>
                                        ))}
                                    </Select>
                                    <Select
                                        fullWidth
                                        label="Kind"
                                        value={editingRelationState.kind ?? "hasMany"}
                                        onValueChange={(val) => setEditingRelationState(prev => prev ? { ...prev,
kind: val as unknown as Relation["kind"] } : null)}
                                    >
                                        {(Object.keys(KIND_LABELS) as RelationKind[]).map(k => (
                                            <SelectItem key={k} value={k}>{KIND_LABELS[k]}</SelectItem>
                                        ))}
                                    </Select>

                                    {editingRelationState.kind === "manyToMany" && (
                                        <div className={cls("flex flex-col gap-4 mt-4 pt-4 border-t", defaultBorderMixin)}>
                                            <Typography variant="subtitle2" className="text-text-primary">Intermediate Table</Typography>
                                            <Typography variant="body2" className="text-text-secondary -mt-3">
                                                Required for many-to-many relationships. This defines the junction table linking both collections.
                                            </Typography>

                                            <TextField
                                                label="Table Name"
                                                name="throughTable"
                                                placeholder="e.g. user_roles"
                                                value={editingRelationState.through?.table || ""}
                                                onChange={(e) => setEditingRelationState(prev => prev ? { ...prev,
through: { ...(prev.through || { sourceColumn: "",
targetColumn: "" }),
table: e.target.value } } : null)}
                                            />
                                            <div className="flex gap-4">
                                                <TextField
                                                    className="flex-1"
                                                    label="Source Column"
                                                    name="sourceColumn"
                                                    placeholder="FK to this collection"
                                                    value={editingRelationState.through?.sourceColumn || ""}
                                                    onChange={(e) => setEditingRelationState(prev => prev ? { ...prev,
through: { ...(prev.through || { table: "",
targetColumn: "" }),
sourceColumn: e.target.value } } : null)}
                                                />
                                                <TextField
                                                    className="flex-1"
                                                    label="Target Column"
                                                    name="targetColumn"
                                                    placeholder="FK to target collection"
                                                    value={editingRelationState.through?.targetColumn || ""}
                                                    onChange={(e) => setEditingRelationState(prev => prev ? { ...prev,
through: { ...(prev.through || { table: "",
sourceColumn: "" }),
targetColumn: e.target.value } } : null)}
                                                />
                                            </div>
                                        </div>
                                    )}

                                    {editingRelationState.kind === "via" && (
                                        <div className={cls("flex flex-col gap-4 mt-4 pt-4 border-t", defaultBorderMixin)}>
                                            <Typography variant="subtitle2" className="text-text-primary">Join Path</Typography>
                                            <Typography variant="body2" className="text-text-secondary -mt-3">
                                                Each step joins one more table. <strong>From</strong> names a column on the
                                                previous table — this collection&apos;s own table for the first step — and
                                                <strong> to</strong> names a column on the table being joined. The last step
                                                should land on the target&apos;s table. A join path is read-only: Rebase will
                                                not invent which hop to write to.
                                            </Typography>

                                            <Select
                                                fullWidth
                                                label="Cardinality"
                                                value={editingRelationState.cardinality ?? "many"}
                                                onValueChange={(val) => setEditingRelationState(prev => prev
                                                    ? { ...prev,
cardinality: val as "one" | "many" }
                                                    : null)}
                                            >
                                                <SelectItem value="many">Many — the chain yields a list</SelectItem>
                                                <SelectItem value="one">One — the chain yields a single row</SelectItem>
                                            </Select>

                                            {(editingRelationState.joinPath ?? []).map((step, stepIndex) => {
                                                const updateStep = (patch: Partial<JoinStep> & { from?: string; to?: string }) =>
                                                    setEditingRelationState(prev => {
                                                        if (!prev) return null;
                                                        const steps = [...(prev.joinPath ?? [])];
                                                        const current = steps[stepIndex];
                                                        steps[stepIndex] = {
                                                            table: patch.table ?? current.table,
                                                            on: {
                                                                from: patch.from ?? current.on.from,
                                                                to: patch.to ?? current.on.to
                                                            }
                                                        };
                                                        return { ...prev,
joinPath: steps };
                                                    });

                                                return (
                                                    <div key={stepIndex} className={cls("flex flex-col gap-2 p-3 rounded border", defaultBorderMixin)}>
                                                        <div className="flex items-center gap-2">
                                                            <Typography variant="label" className="text-text-secondary flex-1">
                                                                Step {stepIndex + 1}
                                                            </Typography>
                                                            <IconButton
                                                                size="small"
                                                                onClick={() => setEditingRelationState(prev => prev
                                                                    ? { ...prev,
joinPath: (prev.joinPath ?? []).filter((_, i) => i !== stepIndex) }
                                                                    : null)}
                                                            >
                                                                <Trash2Icon size="smallest"/>
                                                            </IconButton>
                                                        </div>
                                                        <TextField
                                                            label="Join into table"
                                                            placeholder="e.g. user_roles"
                                                            value={step.table}
                                                            onChange={(e) => updateStep({ table: e.target.value })}
                                                        />
                                                        <div className="flex gap-4">
                                                            <TextField
                                                                className="flex-1"
                                                                label="From column"
                                                                placeholder={stepIndex === 0 ? "column on this table" : "column on the previous table"}
                                                                value={typeof step.on.from === "string" ? step.on.from : step.on.from.join(", ")}
                                                                onChange={(e) => updateStep({ from: e.target.value })}
                                                            />
                                                            <TextField
                                                                className="flex-1"
                                                                label="To column"
                                                                placeholder={`column on ${step.table || "that table"}`}
                                                                value={typeof step.on.to === "string" ? step.on.to : step.on.to.join(", ")}
                                                                onChange={(e) => updateStep({ to: e.target.value })}
                                                            />
                                                        </div>
                                                    </div>
                                                );
                                            })}

                                            <Button
                                                variant="outlined"
                                                size="small"
                                                onClick={() => setEditingRelationState(prev => prev
                                                    ? { ...prev,
joinPath: [...(prev.joinPath ?? []), { ...EMPTY_STEP,
on: { ...EMPTY_STEP.on } }] }
                                                    : null)}
                                            >
                                                Add step
                                            </Button>
                                        </div>
                                    )}
                                </div>
                            </DialogContent>
                            <DialogActions>
                                <Button variant="text" onClick={handleCancel}>Cancel</Button>
                                <Button
                                    variant="filled"
                                    color="primary"
                                    onClick={handleSave}
                                    disabled={!draftIsComplete(editingRelationState)}
                                >
                                    Save
                                </Button>
                            </DialogActions>
                        </>
                    )}
                </Dialog>
            </Container>
        </div>
    );
}
