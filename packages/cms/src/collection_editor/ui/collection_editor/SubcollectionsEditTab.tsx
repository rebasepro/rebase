
import React from "react";
import {
    ConfirmationDialog,
    useCustomizationController
} from "@rebasepro/app";
import { resolveEntityView } from "../../_cms_internals";
import { User } from "@rebasepro/types";
import { EntityCustomView, AdminCollection } from "@rebasepro/cms-types";
import { getSubcollections } from "@rebasepro/common";
import {
    Alert,
    Button,
    Container,
    IconButton,
    iconSize,
    Paper,
    PlusIcon,
    Table,
    TableBody,
    TableCell,
    TableRow,
    Tooltip,
    Trash2Icon,
    Typography
} from "@rebasepro/ui";
import { CollectionEditorDialog } from "./CollectionEditorDialog";
import { CollectionsConfigController } from "../../types/config_controller";
import { CollectionInference } from "../../types/collection_inference";
import { EntityCustomViewsSelectDialog } from "./EntityCustomViewsSelectDialog";
import { useFormex } from "@rebasepro/forms";

export function SubcollectionsEditTab({
    collection,
    parentCollection,
    configController,
    collectionInference,
    getUser,
    parentCollectionSlugs
}: {
    collection: AdminCollection,
    parentCollection?: AdminCollection,
    configController: CollectionsConfigController;
    collectionInference?: CollectionInference;
    getUser?: (uid: string) => User | null;
    parentCollectionSlugs?: string[], parentEntityIds?: string[];
}) {

    const { entityViews: contextEntityViews } = useCustomizationController();

    const [subcollectionToDelete, setSubcollectionToDelete] = React.useState<string | undefined>();
    const [addEntityViewDialogOpen, setAddEntityViewDialogOpen] = React.useState<boolean>(false);
    const [viewToDelete, setViewToDelete] = React.useState<string | undefined>();

    const [currentDialog, setCurrentDialog] = React.useState<{
        isNewCollection: boolean,
        editedCollectionId?: string,
    }>();

    const {
        values,
        setFieldValue
    } = useFormex<AdminCollection>();

    const [subcollections, setSubcollections] = React.useState<AdminCollection[]>(getSubcollections(collection) ?? []);
    const resolvedEntityViews = values.entityViews?.filter(e => typeof e === "string")
        .map(e => resolveEntityView(e, contextEntityViews))
        .filter(Boolean) as EntityCustomView[] ?? [];
    const hardCodedEntityViews = collection.entityViews?.filter(e => typeof e !== "string") as EntityCustomView[] ?? [];
    const totalEntityViews = resolvedEntityViews.length + hardCodedEntityViews.length;

    return (
        <>
            <div className={"flex flex-col gap-12 w-full"}>

                    <div className={"grow flex flex-col gap-4 items-start w-full"}>
                        <Typography variant={"h6"}>
                            Subcollections of {values.name}
                        </Typography>

                        <div className={"flex flex-col gap-4 w-full"}>
                            {subcollections && subcollections.length > 0 && <Table>
                                <TableBody>
                                    {subcollections.map((subcollection) => (
                                        <TableRow key={subcollection.slug}
                                            onClick={() => setCurrentDialog({
                                                isNewCollection: false,
                                                editedCollectionId: subcollection.slug
                                            })}>
                                            <TableCell
                                                align="left">
                                                <Typography variant={"subtitle2"} className={"grow"}>
                                                    {subcollection.name}
                                                </Typography>
                                            </TableCell>
                                            <TableCell
                                                align="right">
                                                <Tooltip title={"Remove"}
                                                    asChild={true}>
                                                    <IconButton size="small"
                                                        onClick={(e: React.MouseEvent) => {
                                                            e.preventDefault();
                                                            e.stopPropagation();
                                                            setSubcollectionToDelete(subcollection.slug);
                                                        }}
                                                        color="inherit">
                                                        <Trash2Icon size={iconSize.small}/>
                                                    </IconButton>
                                                </Tooltip>
                                            </TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>}

                            <Button
                                onClick={() => {
                                    setCurrentDialog({
                                        isNewCollection: true
                                    });
                                }}
                                variant="filled"
                                color="neutral"
                                startIcon={<PlusIcon/>}>
                                Add subcollection
                            </Button>

                        </div>

                    </div>

                    <div className={"grow flex flex-col gap-4 items-start w-full"}>
                        <Typography variant={"h6"}>
                            Custom views
                        </Typography>

                        {<>
                            <div className={"flex flex-col gap-4 w-full"}>
                                {totalEntityViews > 0 && <Table>
                                    <TableBody>
                                        {resolvedEntityViews.map((view) => (
                                            <TableRow key={view.key}>
                                                <TableCell
                                                    align="left">
                                                    <Typography variant={"subtitle2"} className={"grow"}>
                                                        {view.name}
                                                    </Typography>
                                                </TableCell>
                                                <TableCell
                                                    align="right">
                                                    <Tooltip title={"Remove"}
                                                        asChild={true}>
                                                        <IconButton size="small"
                                                            onClick={(e: React.MouseEvent) => {
                                                                e.preventDefault();
                                                                e.stopPropagation();
                                                                setViewToDelete(view.key);
                                                            }}
                                                            color="inherit">
                                                            <Trash2Icon size={iconSize.small}/>
                                                        </IconButton>
                                                    </Tooltip>
                                                </TableCell>
                                            </TableRow>
                                        ))}
                                        {hardCodedEntityViews.map((view) => (
                                            <TableRow key={view.key}>
                                                <TableCell
                                                    align="left">
                                                    <Typography variant={"subtitle2"} className={"grow"}>
                                                        {view.name}
                                                    </Typography>
                                                    <Typography variant={"caption"} className={"grow"}>
                                                        This view is defined in code with
                                                        key <code>{view.key}</code>
                                                    </Typography>
                                                </TableCell>
                                            </TableRow>
                                        ))}
                                    </TableBody>
                                </Table>}

                                <Button
                                    onClick={() => {
                                        setAddEntityViewDialogOpen(true);
                                    }}
                                    variant="filled"
                                    color="neutral"
                                    startIcon={<PlusIcon/>}>
                                    Add custom entity view
                                </Button>
                            </div>

                        </>}

                    </div>

                </div>

            {subcollectionToDelete &&
                <ConfirmationDialog open={Boolean(subcollectionToDelete)}
                    onAccept={() => {
                        const props = {
                            id: subcollectionToDelete!,
                            parentCollectionSlugs: [...(parentCollectionSlugs ?? []), collection.slug]
                        };
                        console.debug("Deleting subcollection", props)
                        configController.deleteCollection(props).then(() => {
                            setSubcollectionToDelete(undefined);
                            setSubcollections(subcollections?.filter(e => e.slug !== subcollectionToDelete))
                        });
                    }}
                    onCancel={() => setSubcollectionToDelete(undefined)}
                    title={<>Delete this subcollection?</>}
                    body={<> This will <b>not
                        delete any data</b>, only
                        the collection in the admin</>}/>}
            {viewToDelete &&
                <ConfirmationDialog open={Boolean(viewToDelete)}
                    onAccept={() => {
                        setFieldValue("entityViews", values.entityViews?.filter(e => e !== viewToDelete));
                        setViewToDelete(undefined);
                    }}
                    onCancel={() => setViewToDelete(undefined)}
                    title={<>Remove this view?</>}
                    body={<>This will <b>not
                        delete any data</b>, only
                        the view in the admin</>}/>}

            <CollectionEditorDialog
                open={Boolean(currentDialog)}
                configController={configController}
                parentCollection={collection}
                collectionInference={collectionInference}
                parentCollectionSlugs={[...parentCollectionSlugs ?? [], values.slug]}
                isNewCollection={false}
                {...currentDialog}
                getUser={getUser}
                handleClose={(updatedCollection) => {
                    if (updatedCollection && !subcollections.map(e => e.slug).includes(updatedCollection.slug)) {
                        setSubcollections([...subcollections, updatedCollection]);
                    }
                    setCurrentDialog(undefined);
                }}/>

            <EntityCustomViewsSelectDialog
                open={addEntityViewDialogOpen}
                onClose={(selectedViewKey) => {
                    if (selectedViewKey) {
                        setFieldValue("entityViews", [...(values.entityViews ?? []), selectedViewKey]);
                    }
                    setAddEntityViewDialogOpen(false);
                }}/>
        </>
    );
}
