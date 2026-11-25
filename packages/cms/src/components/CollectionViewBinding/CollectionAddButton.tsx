import React, { useContext } from "react";
import { createPortal } from "react-dom";
import type { AdminCollection } from "@rebasepro/cms-types";
import { usePermissions, useTranslation } from "@rebasepro/app";
import { Button, IconButton, iconSize, PlusIcon } from "@rebasepro/ui";
import { useToolbarLabels, useToolbarTrailingSlot } from "../CollectionTableBinding/internal/CollectionTableToolbar";
import { CollectionViewScopeContext } from "./CollectionViewScope";

/**
 * @group Collection components
 */
export type CollectionAddButtonProps = {
    /** Defaults to the collection of the view the button is drawn in. */
    collection?: AdminCollection;
    /** Defaults to the path of the view the button is drawn in. */
    path?: string;
    /** Defaults to opening the view's new-record form. */
    onClick?: () => void;
    /**
     * The icon-only form, whatever the room. Defaults to the view's compact
     * split-list toolbar.
     */
    compact?: boolean;
};

/**
 * The button that adds a record: labelled "Add <name>" where the toolbar has
 * room, an icon otherwise. Drawn only for someone who may create one.
 *
 * Inside a collection toolbar it renders at the toolbar's trailing edge,
 * wherever it is placed: that edge stays put while the rest of a narrow
 * toolbar scrolls, so the button is never scrolled out of reach.
 *
 * Inside a collection view — in a `toolbar` given to `CollectionPanel` — it
 * needs no props. A copy of `Collection.Actions` passes them.
 *
 * @group Collection components
 */
export function CollectionAddButton(props: CollectionAddButtonProps) {
    const scope = useContext(CollectionViewScopeContext);
    const { canCreate } = usePermissions();
    const toolbarLabels = useToolbarLabels();
    const trailingSlot = useToolbarTrailingSlot();
    const { t } = useTranslation();

    const collection = props.collection ?? scope?.collection;
    const path = props.path ?? scope?.path;
    const onClick = props.onClick ?? scope?.onNewClick;
    const compact = props.compact ?? scope?.isCompact ?? false;
    if (!collection || path === undefined || !onClick || !canCreate(collection, path)) return null;

    // Labelled where the toolbar has room for it.
    const labelled = !compact && toolbarLabels;
    const label = t("add_specific", { name: collection.singularName ?? collection.name });

    const button = labelled
        ? <Button
            id={`add_entity_${path}`}
            onClick={onClick}
            startIcon={<PlusIcon size={iconSize.small}/>}
            size="small"
            variant="filled"
            color="primary">
            {label}
        </Button>
        // In the compact split-list toolbar the add action is the one filled
        // control: a rounded square, so it reads as a button and not a badge.
        : <IconButton
            id={`add_entity_${path}`}
            onClick={onClick}
            variant="filled"
            shape="square"
            size="small"
            aria-label={label}
        >
            <PlusIcon size={iconSize.small}/>
        </IconButton>;

    return trailingSlot ? createPortal(button, trailingSlot) : button;
}
