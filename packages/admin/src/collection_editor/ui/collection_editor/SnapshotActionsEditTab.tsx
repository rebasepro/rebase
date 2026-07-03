
import React from "react";
import {
    ConfirmationDialog,
    useCustomizationController
} from "@rebasepro/core";
import { resolveSnapshotAction } from "../../_cms_internals";
import { type SnapshotCollection } from "@rebasepro/types";
import { SnapshotAction } from "@rebasepro/types";
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
import { useFormex } from "@rebasepro/formex";
import { SnapshotActionsSelectDialog } from "./SnapshotActionsSelectDialog";

export function SnapshotActionsEditTab({
    collection,
    embedded = false
}: {
    collection: SnapshotCollection,
    embedded?: boolean;
}) {

    const { snapshotActions: contextSnapshotActions } = useCustomizationController();

    const [addSnapshotActionDialogOpen, setAddSnapshotActionDialogOpen] = React.useState<boolean>(false);
    const [actionToDelete, setActionToDelete] = React.useState<string | undefined>();

    const {
        values,
        setFieldValue
    } = useFormex<SnapshotCollection>();

    const resolvedSnapshotActions = ((values.snapshotActions ?? []) as (string | SnapshotAction<any>)[])
        .filter((e): e is string => typeof e === "string")
        .map((e: string) => resolveSnapshotAction(e, contextSnapshotActions))
        .filter(Boolean) as SnapshotAction<any>[] ?? [];
    const hardCodedSnapshotActions = collection.snapshotActions?.filter((e: string | SnapshotAction<any>): e is SnapshotAction<any> => typeof e !== "string") ?? [];
    const totalSnapshotActions = resolvedSnapshotActions.length + hardCodedSnapshotActions.length;

    const content = (
        <div className={"flex flex-col gap-12"}>
            <div className={"flex-grow flex flex-col gap-4 items-start w-full"}>
                <Typography variant={"h6"}>
                    Custom actions
                </Typography>

                {<>
                    <div className={"flex flex-col gap-4 w-full"}>
                        {totalSnapshotActions > 0 && <Table>
                            <TableBody>
                                {resolvedSnapshotActions.map((action) => (
                                    <TableRow key={action.key}>
                                        <TableCell
                                            align="left">
                                            <Typography variant={"subtitle2"} className={"flex-grow"}>
                                                {action.name}
                                            </Typography>
                                        </TableCell>
                                        <TableCell
                                            align="right">
                                            <Tooltip title={"Remove"}
                                                asChild={true}>
                                                <IconButton size="small"
                                                    onClick={(e) => {
                                                        e.preventDefault();
                                                        e.stopPropagation();
                                                        setActionToDelete(action.key);
                                                    }}
                                                    color="inherit">
                                                    <Trash2Icon size={iconSize.small}/>
                                                </IconButton>
                                            </Tooltip>
                                        </TableCell>
                                    </TableRow>
                                ))}
                                {hardCodedSnapshotActions.map((action: SnapshotAction<any>) => (
                                    <TableRow key={action.key}>
                                        <TableCell
                                            align="left">
                                            <Typography variant={"subtitle2"} className={"flex-grow"}>
                                                {action.name}
                                            </Typography>
                                            <Typography variant={"caption"} className={"flex-grow"}>
                                                This action is defined in code with
                                                key <code>{action.key}</code>
                                            </Typography>
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>}

                        <Button
                            onClick={() => {
                                setAddSnapshotActionDialogOpen(true);
                            }}
                            variant="filled"
                            color="neutral"
                            startIcon={<PlusIcon/>}>
                            Add custom snapshot action
                        </Button>
                    </div>

                </>}

            </div>

        </div>
    );

    return (
        <>
            {embedded ? (
                content
            ) : (
                <div className={"overflow-auto my-auto"}>
                    <Container maxWidth={"2xl"} className={"flex flex-col gap-4 p-8 m-auto"}>
                        {content}
                    </Container>
                    <div style={{ height: "52px" }}/>
                </div>
            )}

            {actionToDelete &&
                <ConfirmationDialog open={Boolean(actionToDelete)}
                    onAccept={() => {
                        setFieldValue("snapshotActions", values.snapshotActions?.filter((e: string | SnapshotAction<any>) => e !== actionToDelete));
                        setActionToDelete(undefined);
                    }}
                    onCancel={() => setActionToDelete(undefined)}
                    title={<>Remove this action?</>}
                    body={<>This will <b>not
                        delete any data</b>, only
                        the action in the CMS</>}/>}

            <SnapshotActionsSelectDialog
                open={addSnapshotActionDialogOpen}
                onClose={(selectedActionKey) => {
                    if (selectedActionKey) {
                        const value = [...(values.snapshotActions ?? []), selectedActionKey]
                            // only actions that are defined in the registry
                            .filter((e: string | SnapshotAction<any>): e is string => typeof e === "string" && (contextSnapshotActions ?? []).some(action => action.key === e));
                        ;
                        setFieldValue("snapshotActions", value);
                    }
                    setAddSnapshotActionDialogOpen(false);
                }}/>
        </>
    );
}
