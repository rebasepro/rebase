import type { AdminCollection, EntityAction, EntityActionClickProps, EntitySelectionController } from "@rebasepro/cms-types";
import { Entity } from "@rebasepro/types";
import React, { useCallback, useContext } from "react";
import { getIcon, useTranslation } from "@rebasepro/app";
import { IconButton, Menu, MenuItem, MoreVerticalIcon, Separator, Tooltip } from "@rebasepro/ui";
import { useAdminContext } from "../../hooks/useAdminContext";
import { entityActionName, placeEntityActions, resolveEntityActionState } from "../../util/entity_actions";
import { ActionMenuLabel } from "../common/ActionMenuLabel";
import { rowOfEntity, selectionControllerOf } from "@rebasepro/app";
import type { OpenEntityMode } from "../../util/view_mode";

/**
 * What a card's actions are built from: the actions a row of this collection
 * has, and what the table hands an action it runs.
 */
export type EntityActionsScope<M extends Record<string, unknown> = Record<string, unknown>> = {
    getActions: (entity: Entity<M>) => EntityAction[];
    collection: AdminCollection<M>;
    path: string;
    openEntityMode: OpenEntityMode;
    selectionController?: EntitySelectionController<M>;
    onCollectionChange: () => void;
    highlightRow: (id: string | number) => void;
    unhighlightRow: () => void;
};

/**
 * Reaches the card's actions through context, not through the card's props:
 * the grid and the board draw memoised cards, and a scope that changes with
 * the selection would redraw every one of them.
 */
export const EntityActionsScopeContext = React.createContext<EntityActionsScope | null>(null);

/**
 * The actions of one record on a card or a kanban card, placed as a table row
 * places them: `collapsed: false` ones as buttons, the rest in a menu — the
 * collection's own, then Copy, then Delete apart. Edit is left out: clicking
 * the card is what opens it.
 */
function CollectionEntityActions({ entity }: { entity: Entity<Record<string, unknown>> }) {
    const scope = useContext(EntityActionsScopeContext);
    const context = useAdminContext();
    const { t } = useTranslation();
    const stopPropagation = useCallback((event: React.MouseEvent) => event.stopPropagation(), []);
    if (!scope) return null;

    const actions = scope.getActions(entity).filter(action => action.key !== "edit");
    if (actions.length === 0) return null;

    const placed = placeEntityActions(actions);
    const collapsedGroups = [placed.own, placed.generic, placed.destructive].filter(group => group.length > 0);
    const clickProps: EntityActionClickProps<Record<string, unknown>> = {
        view: "collection",
        row: rowOfEntity(entity, scope.collection),
        id: String(entity.id),
        path: scope.path,
        collection: scope.collection,
        context,
        sidePanelController: context.sidePanelController,
        selectionController: scope.selectionController
            ? selectionControllerOf(scope.selectionController, scope.collection, scope.path)
            : undefined,
        highlightRow: scope.highlightRow,
        unhighlightRow: scope.unhighlightRow,
        onCollectionChange: scope.onCollectionChange,
        openEntityMode: scope.openEntityMode
    };

    return (
        <div className="flex items-center gap-0.5 shrink-0" onClick={stopPropagation}>
            {placed.inline.map((action, index) => {
                const { enabled, disabledReason } = resolveEntityActionState(action, clickProps);
                const name = entityActionName(action, t);
                // A disabled icon takes no pointer events: wrapped, the
                // wrapper hovers, and the tooltip can still say why.
                return (
                    <Tooltip key={action.key ?? index}
                        title={disabledReason ? `${name}: ${disabledReason}` : name}
                        asChild={enabled}>
                        <IconButton
                            aria-label={name}
                            disabled={!enabled}
                            size="small"
                            onClick={(event: React.MouseEvent) => {
                                event.stopPropagation();
                                action.onClick(clickProps);
                            }}>
                            {getIcon(action.icon, undefined, undefined, "smallest")}
                        </IconButton>
                    </Tooltip>
                );
            })}
            {collapsedGroups.length > 0 &&
                <Menu
                    trigger={<IconButton aria-label={t("more_actions")} size="small">
                        <MoreVerticalIcon/>
                    </IconButton>}>
                    {collapsedGroups.map((group, groupIndex) => (
                        <React.Fragment key={groupIndex}>
                            {groupIndex > 0 && <Separator orientation={"horizontal"}/>}
                            {group.map((action, index) => {
                                const { enabled, disabledReason } = resolveEntityActionState(action, clickProps);
                                return <MenuItem
                                    key={action.key ?? index}
                                    disabled={!enabled}
                                    onClick={(event) => {
                                        event.stopPropagation();
                                        action.onClick(clickProps);
                                    }}>
                                    {getIcon(action.icon, undefined, undefined, "smallest")}
                                    <ActionMenuLabel name={entityActionName(action, t)} disabledReason={disabledReason}/>
                                </MenuItem>;
                            })}
                        </React.Fragment>
                    ))}
                </Menu>}
        </div>
    );
}

/**
 * Draws a record's actions where a card puts them. One function for the life
 * of the module, so a memoised card is never redrawn for a new one.
 */
export function renderCollectionEntityActions(entity: Entity<Record<string, unknown>>): React.ReactNode {
    return <CollectionEntityActions entity={entity}/>;
}
