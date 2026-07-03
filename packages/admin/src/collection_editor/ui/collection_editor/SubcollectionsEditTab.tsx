
import React from "react";
import {
    ConfirmationDialog,
    useCustomizationController
} from "@rebasepro/core";
import { resolveSnapshotView } from "../../_cms_internals";
import { SnapshotCollection, SnapshotCustomView, User } from "@rebasepro/types";
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
import { SnapshotCustomViewsSelectDialog } from "./SnapshotCustomViewsSelectDialog";
import { useFormex } from "@rebasepro/formex";

export function SubcollectionsEditTab({
    collection,
    parentCollection,
    configController,
    collectionInference,
    getUser,
    parentCollectionSlugs
}: {
    collection: SnapshotCollection,
    parentCollection?: SnapshotCollection,
    configController: CollectionsConfigController;
    collectionInference?: CollectionInference;
    getUser?: (uid: string) => User | null;
    parentCollectionSlugs?: string[], parentSnapshotIds?: string[];
}) {

    const { snapshotViews: contextSnapshotViews } = useCustomizationController();

    const [subcollectionToDelete, setSubcollectionToDelete] = React.useState<string | undefined>();
    const [addSnapshotViewDialogOpen, setAddSnapshotViewDialogOpen] = React.useState<boolean>(false);
    const [viewToDelete, setViewToDelete] = React.useState<string | undefined>();

    const [currentDialog, setCurrentDialog] = React.useState<{
        isNewCollection: boolean,
        editedCollectionId?: string,
    }>();

    const {
        values,
        setFieldValue
    } = useFormex<SnapshotCollection>();

    const [subcollections, setSubcollections] = React.useState<SnapshotCollection[]>(getSubcollections(collection) ?? []);
    const resolvedSnapshotViews = values.snapshotViews?.filter(e => typeof e === "string")
        .map(e => resolveSnapshotView(e, contextSnapshotViews))
        .filter(Boolean) as SnapshotCustomView[] ?? [];
    const hardCodedSnapshotViews = collection.snapshotViews?.filter(e => typeof e !== "string") as SnapshotCustomView[] ?? [];
    const totalSnapshotViews = resolvedSnapshotViews.length + hardCodedSnapshotViews.length;

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
                                {totalSnapshotViews > 0 && <Table>
                                    <TableBody>
                                        {resolvedSnapshotViews.map((view) => (
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
                                        {hardCodedSnapshotViews.map((view) => (
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
                                        setAddSnapshotViewDialogOpen(true);
                                    }}
                                    variant="filled"
                                    color="neutral"
                                    startIcon={<PlusIcon/>}>
                                    Add custom snapshot view
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
                        the collection in the CMS</>}/>}
            {viewToDelete &&
                <ConfirmationDialog open={Boolean(viewToDelete)}
                    onAccept={() => {
                        setFieldValue("snapshotViews", values.snapshotViews?.filter(e => e !== viewToDelete));
                        setViewToDelete(undefined);
                    }}
                    onCancel={() => setViewToDelete(undefined)}
                    title={<>Remove this view?</>}
                    body={<>This will <b>not
                        delete any data</b>, only
                        the view in the CMS</>}/>}

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

            <SnapshotCustomViewsSelectDialog
                open={addSnapshotViewDialogOpen}
                onClose={(selectedViewKey) => {
                    if (selectedViewKey) {
                        setFieldValue("snapshotViews", [...(values.snapshotViews ?? []), selectedViewKey]);
                    }
                    setAddSnapshotViewDialogOpen(false);
                }}/>
        </>
    );
}
