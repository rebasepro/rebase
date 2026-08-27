import {
    ConfirmationDialog,
    useAuthController,
    useSnackbarController,
    useTranslation
} from "@rebasepro/app";
import { PluginHomePageActionsProps } from "@rebasepro/cms-types";
import { CopyIcon, IconButton, Menu, MenuItem, MoreVerticalIcon, SettingsIcon, Trash2Icon } from "@rebasepro/ui";
import { useCollectionEditorController } from "../useCollectionEditorController";
import { useState } from "react";
import { useCollectionsConfigController } from "../useCollectionsConfigController";

export function HomePageEditorCollectionAction({
    slug,
    collection
}: PluginHomePageActionsProps) {

    const snackbarController = useSnackbarController();
    const authController = useAuthController();
    const configController = useCollectionsConfigController();
    const collectionEditorController = useCollectionEditorController();
    const { t } = useTranslation();

    const canCreateCollections = !configController.readOnly;
    const canEditCollections = !configController.readOnly;
    const canDeleteCollections = !configController.readOnly;

    const onEditCollectionClicked = () => {
        collectionEditorController?.editCollection({
            id: collection.slug,
            parentCollectionSlugs: [],
            parentEntityIds: []
        });
    };

    const onDuplicateCollectionClicked = () => {
        // Use copyFrom to duplicate the collection with all properties
        // The editor will handle clearing name, path, and id
        collectionEditorController?.createCollection({
            copyFrom: collection,
            parentCollectionSlugs: [],
            parentEntityIds: [],
            redirect: true,
            sourceClick: "home_page_duplicate"
        });
    };

    const [deleteRequested, setDeleteRequested] = useState(false);

    const deleteCollection = () => {
        configController?.deleteCollection({ id: collection.slug }).then(() => {
            setDeleteRequested(false);
            snackbarController.open({
                message: t("studio_home_collection_deleted"),
                type: "success"
            });
        });
    };

    return <>

        <div>
            {canDeleteCollections &&
                <Menu
                    trigger={<IconButton size={"small"}>
                        <MoreVerticalIcon/>
                    </IconButton>}
                >
                    {canCreateCollections &&
                        <MenuItem
                            dense={true}
                            onClick={(event: React.MouseEvent) => {
                                event.preventDefault();
                                event.stopPropagation();
                                onDuplicateCollectionClicked();
                            }}>
                            <CopyIcon/>
                            {t("studio_home_duplicate_collection")}
                        </MenuItem>
                    }
                    <MenuItem
                        dense={true}
                        onClick={(event: React.MouseEvent) => {
                            event.preventDefault();
                            event.stopPropagation();
                            setDeleteRequested(true);
                        }}>
                        <Trash2Icon/>
                        {t("studio_home_delete")}
                    </MenuItem>

                </Menu>

            }

            {canEditCollections &&
                <IconButton
                    size={"small"}
                    onClick={(event: React.MouseEvent) => {
                         onEditCollectionClicked();
                    }}>
                    <SettingsIcon/>
                </IconButton>}
        </div>

        <ConfirmationDialog
            open={deleteRequested}
            onAccept={deleteCollection}
            onCancel={() => setDeleteRequested(false)}
            title={<>{t("studio_home_confirm_delete_title")}</>}
            body={<>{t("studio_home_confirm_delete_no_data")}</>}/>
    </>;

}
