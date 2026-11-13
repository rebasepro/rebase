import type { AdminCollection } from "@rebasepro/cms-types";
import { EntityReference } from "@rebasepro/cms-types";
import React from "react";
import { useTranslation } from "@rebasepro/app";
import {
    ArrowRightToLineIcon,
    Button,
    cls,
    focusedDisabled,
    IconButton,
    iconSize,
    Popover,
    SearchIcon,
    TextField,
    Tooltip
} from "@rebasepro/ui";
import { ReferencePreview } from "../../preview";
import { navigateToEntity } from "../../util/navigation_utils";
import { OpenEntityMode } from "../../util/view_mode";
import { useUrlController } from "../../hooks/navigation/contexts/UrlContext";
import { useSidePanel } from "../../hooks/useSidePanel";
import { addRecentId, getRecentIds } from "./utils";

/**
 * The ID column's header control: find a record by its id, or reopen one of
 * the last few opened from this collection.
 */
export function EntityIdHeaderWidget({
    collection,
    path,
    idPath,
    openEntityMode
}: {
    collection: AdminCollection,
    path: string,
    idPath: string,
    /**
     * Resolved by the parent so that finding an entity by id lands it in the
     * same surface a row click would — not a different one.
     */
    openEntityMode: OpenEntityMode
}) {

    const { t } = useTranslation();
    const urlController = useUrlController();
    const [openPopup, setOpenPopup] = React.useState(false);
    const [searchString, setSearchString] = React.useState("");
    const [recentIds, setRecentIds] = React.useState<string[]>(getRecentIds(collection.slug).map(String));
    const sidePanelController = useSidePanel();

    return (
        <Tooltip title={!openPopup ? t("find_by_id") : undefined} asChild={false}>
            <Popover
                open={openPopup}
                onOpenChange={setOpenPopup}
                sideOffset={0}
                align={"start"}
                alignOffset={-117}
                trigger={
                    <IconButton aria-label={t("search")} size={"small"}>
                        <SearchIcon size={iconSize.small}/>
                    </IconButton>
                }>
                <div
                    className={cls("my-2 rounded-lg bg-surface-sheet text-surface-900 dark:text-white")}>
                    <form noValidate={true}
                        onSubmit={(e) => {
                            e.preventDefault();
                            if (!searchString) return;
                            setOpenPopup(false);
                            const entityId = searchString.trim();
                            setRecentIds(addRecentId(collection.slug, entityId).map(String));
                            navigateToEntity({
                                openEntityMode,
                                collection,
                                id: entityId,
                                path,

                                sidePanelController,
                                navigation: urlController
                            })
                        }}
                        className={"w-96 max-w-full"}>

                        <div className="flex p-2 w-full gap-2">
                            <TextField
                                autoFocus={openPopup}
                                aria-label={t("find_entity_by_id")}
                                placeholder={t("find_entity_by_id")}
                                size="small"
                                onChange={(e) => {
                                    setSearchString(e.target.value);
                                }}
                                value={searchString}
                                className="flex-grow"
                                inputClassName={cls("rounded-lg bg-surface-card", focusedDisabled)}
                            />
                            <Button variant={"text"}
                                disabled={!(searchString.trim())}
                                type={"submit"}
                            ><ArrowRightToLineIcon/></Button>
                        </div>
                    </form>
                    {recentIds && recentIds.length > 0 && <div className="flex flex-col gap-2 p-2">
                        {recentIds.map(id => (
                            <ReferencePreview reference={new EntityReference({ id,
path })}
                                key={id}
                                hover={true}
                                onClick={() => {
                                    setOpenPopup(false);
                                    navigateToEntity({
                                        openEntityMode,
                                        collection,
                                        id,
                                        path,

                                        sidePanelController,
                                        navigation: urlController
                                    })
                                }}
                                includeEntityLink={false}
                                size={"small"}/>
                        ))}
                    </div>}
                </div>
            </Popover>

        </Tooltip>
    );
}
