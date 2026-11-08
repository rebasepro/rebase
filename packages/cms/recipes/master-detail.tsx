/**
 * Recipe: master-detail — a list of rows beside the form of the one picked.
 *
 * `SplitView` from `@rebasepro/ui` lays the two out by the width of its own
 * container, not the window's: side by side when there is room, and in a
 * narrow container (a phone, a side panel, Claude's frame) the form covers the
 * list under a back bar. Both stay mounted across the switch, so the list
 * keeps its scroll and the form its edits.
 *
 * The master is a `CollectionPanel`: `fields` picks its columns, `onRowClick`
 * hands over the clicked row instead of opening it, and `highlightedEntityId`
 * draws that row as the selected one. The row is the server's: its primary
 * key under its own column (`id` here), dates as ISO strings. The detail is
 * an `EntityFormPanel` at that id, with `fields` choosing what it edits. A
 * save there reaches the list by itself.
 *
 * To use it: add `customersMasterDetailView` to `<RebaseCMS views={[…]}>`.
 * Change `COLLECTION`, the field lists, and `TITLE_FIELD` to your own.
 */
import React, { useState } from "react";
import type { AppView } from "@rebasepro/cms-types";
import { CollectionPanel, EntityFormPanel, useCollectionRegistryController } from "@rebasepro/cms";
import { CircularProgressCenter, SplitView, Typography } from "@rebasepro/ui";

const COLLECTION = "customers";
/** The list's columns, in order. */
const LIST_FIELDS = ["name", "status"];
/** What the form edits, in order. A required field left out must have a default. */
const FORM_FIELDS = ["name", "email", "status", "notes"];
/** Names the open record in the narrow layout's back bar. */
const TITLE_FIELD = "name";

type Row = Record<string, unknown>;

/** A row's primary key, as `EntityFormPanel` and `highlightedEntityId` take it. */
function idOf(row: Row): string | number | undefined {
    return typeof row.id === "string" || typeof row.id === "number" ? row.id : undefined;
}

export function CustomersMasterDetail() {
    // The form takes the collection as a value; the list finds it by slug.
    const registry = useCollectionRegistryController();
    const collection = registry.initialised ? registry.getCollection(COLLECTION) : undefined;
    const [selected, setSelected] = useState<Row | null>(null);
    const selectedId = selected ? idOf(selected) : undefined;

    if (!registry.initialised) return <CircularProgressCenter/>;
    if (!collection) return <Typography color={"error"} className={"p-8"}>{`No collection "${COLLECTION}" is registered.`}</Typography>;

    return (
        // SplitView fills its parent, so the parent needs a height.
        <div className={"h-full min-h-0"}>
            <SplitView
                master={
                    <CollectionPanel path={COLLECTION}
                        title={false}
                        fields={LIST_FIELDS}
                        onRowClick={setSelected}
                        highlightedEntityId={selectedId ?? null}
                        className={"h-full"}/>
                }
                detail={selectedId !== undefined && (
                    <div className={"h-full overflow-auto p-4"}>
                        <EntityFormPanel
                            // Another record is another form: remount rather
                            // than carry one record's edits into the next.
                            key={String(selectedId)}
                            collection={collection}
                            entityId={selectedId}
                            fields={FORM_FIELDS}/>
                    </div>
                )}
                detailTitle={selected ? String(selected[TITLE_FIELD] ?? selectedId) : undefined}
                onBack={() => setSelected(null)}/>
        </div>
    );
}

export const customersMasterDetailView: AppView = {
    slug: "customers/browse",
    name: "Customers",
    icon: "Users",
    view: <CustomersMasterDetail/>
};
