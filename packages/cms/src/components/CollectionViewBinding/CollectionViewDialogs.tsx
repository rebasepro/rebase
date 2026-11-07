import React from "react";
import { PopupFormField } from "../CollectionTableBinding/internal/popup_field/PopupFormField";
import { DeleteEntityDialog } from "../DeleteEntityDialog";
import type { CollectionViewState } from "./useCollectionViewState";

/**
 * What a collection view opens over itself: the table's cell editor popup
 * and the delete (or, on a linked tab, remove) confirmation.
 */
export function CollectionViewDialogs({ state }: { state: CollectionViewState }) {
    const {
        path,
        collection,
        popupCell,
        onPopupClose,
        tableKey,
        uniqueFieldValidator,
        onValueChange,
        containerRef,
        deleteEntityClicked,
        setDeleteEntityClicked,
        isLinkedChildView,
        internalOnEntityDelete,
        internalOnMultipleEntitiesDelete
    } = state;

    return (
        <>
            {popupCell && <PopupFormField
                key={`popup_form_${popupCell?.propertyKey}_${popupCell?.entityId}`}
                open={Boolean(popupCell)}
                onClose={onPopupClose}
                cellRect={popupCell?.cellRect}
                propertyKey={popupCell?.propertyKey}
                collection={collection}
                entityId={popupCell.entityId}
                tableKey={tableKey.current}
                customFieldValidator={uniqueFieldValidator}
                path={path}
                onCellValueChange={onValueChange}
                container={containerRef.current}/>}

            {deleteEntityClicked &&
                <DeleteEntityDialog
                    target={deleteEntityClicked}
                    path={path}
                    collection={collection}
                    // A linked tab's rows are shared through a junction:
                    // the server removes them from this record and deletes
                    // nothing, so the dialog must not say "delete".
                    variant={isLinkedChildView ? "unlink" : "delete"}
                    open={Boolean(deleteEntityClicked)}
                    onEntityDelete={internalOnEntityDelete}
                    onMultipleEntitiesDelete={internalOnMultipleEntitiesDelete}
                    onClose={() => setDeleteEntityClicked(undefined)}/>}
        </>
    );
}
