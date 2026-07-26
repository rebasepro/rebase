
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
import { Relation, JoinStep, OnAction } from "@rebasepro/types";
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
type RelationDraft = {
    kind?: Relation["kind"];
    relationName?: string;
    target?: string;
    localKey?: string;
    foreignKeyOnTarget?: string;
    through?: { table?: string; sourceColumn?: string; targetColumn?: string };
    joinPath?: JoinStep[];
    cardinality?: "one" | "many";
    onUpdate?: OnAction;
    onDelete?: OnAction;
};


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

        const newRelations = [...relations];
        if (editingRelationIndex === -1) {
            newRelations.push(editingRelationState as unknown as Relation);
        } else if (editingRelationIndex !== null) {
            newRelations[editingRelationIndex] = editingRelationState as unknown as Relation;
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
                                <TableCell header>Cardinality</TableCell>
                                <TableCell header>Direction</TableCell>
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
                                        <SelectItem value="belongsTo">Belongs to — the key is on this table</SelectItem>
                                        <SelectItem value="hasOne">Has one — the key is on the target</SelectItem>
                                        <SelectItem value="hasMany">Has many — the key is on the target</SelectItem>
                                        <SelectItem value="manyToMany">Many to many — through a junction</SelectItem>
                                        <SelectItem value="via">Via — an explicit join path</SelectItem>
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
                                </div>
                            </DialogContent>
                            <DialogActions>
                                <Button variant="text" onClick={handleCancel}>Cancel</Button>
                                <Button
                                    variant="filled"
                                    color="primary"
                                    onClick={handleSave}
                                    disabled={!editingRelationState.relationName || !editingRelationState.target}
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
