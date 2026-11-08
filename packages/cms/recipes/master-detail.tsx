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
 * hands over the clicked row and its id instead of opening it, and
 * `highlightedIds` draws that row as the selected one. The row is the
 * server's: its columns, dates as ISO strings. The id is the string the admin
 * addresses the record by. The detail is an `EntityFormPanel` at that id,
 * with `fields` choosing what it edits. A save there reaches the list by
 * itself.
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

export function CustomersMasterDetail() {
    // The form takes the collection as a value; the list finds it by slug.
    const registry = useCollectionRegistryController();
    const collection = registry.initialised ? registry.getCollection(COLLECTION) : undefined;
    // The row picked, and its id: what `EntityFormPanel` and `highlightedIds` take.
    const [selected, setSelected] = useState<{ row: Row; id: string } | null>(null);
    const selectedId = selected?.id;

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
                        onRowClick={(row, id) => setSelected({ row, id })}
                        highlightedIds={selectedId !== undefined ? [selectedId] : []}
                        className={"h-full"}/>
                }
                detail={selectedId !== undefined && (
                    <div className={"h-full overflow-auto p-4"}>
                        <EntityFormPanel
                            // Another record is another form: remount rather
                            // than carry one record's edits into the next.
                            key={selectedId}
                            collection={collection}
                            id={selectedId}
                            fields={FORM_FIELDS}/>
                    </div>
                )}
                detailTitle={selected ? String(selected.row[TITLE_FIELD] ?? selected.id) : undefined}
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
