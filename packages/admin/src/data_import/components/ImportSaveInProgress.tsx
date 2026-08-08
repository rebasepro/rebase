import { useData } from "@rebasepro/app";
import { Button, CenteredView, CircularProgress, Typography } from "@rebasepro/ui";
import { useEffect, useRef, useState } from "react";
import { ImportConfig } from "../types";
import type { AdminCollection } from "@rebasepro/admin-types";
import { IMPORT_BATCH_SIZE, ImportSaveError, saveImportedEntities } from "../utils/save_entities";

export function ImportSaveInProgress<C extends AdminCollection<any>>
    ({
        path,
        importConfig,
        collection,
        onImportSuccess
    }:
        {
            path: string,
            importConfig: ImportConfig,
            collection: C,
            onImportSuccess: (collection: C) => void
        }) {

    const [errorSaving, setErrorSaving] = useState<ImportSaveError | undefined>(undefined);
    const dataClient = useData();

    const savingRef = useRef<boolean>(false);

    // Rows confirmed as written. A retry resumes here rather than re-sending
    // rows that now exist and conflicting on its first batch, forever.
    const committedRef = useRef<number>(0);
    const bulkUnsupportedRef = useRef<{ current: boolean }>({ current: false });

    const [processedEntities, setProcessedEntities] = useState<number>(0);

    function save() {

        if (savingRef.current)
            return;

        savingRef.current = true;
        setErrorSaving(undefined);

        saveImportedEntities(
            dataClient,
            path,
            importConfig.entities,
            {
                offset: committedRef.current,
                batchSize: IMPORT_BATCH_SIZE,
                onBatchCommitted: (written) => {
                    committedRef.current = written;
                    setProcessedEntities(written);
                },
                bulkUnsupported: bulkUnsupportedRef.current
            }
        ).then(() => {
            onImportSuccess(collection);
            savingRef.current = false;
        }).catch((e) => {
            const error = e as ImportSaveError;
            committedRef.current = error.committed ?? committedRef.current;
            setProcessedEntities(committedRef.current);
            setErrorSaving(error);
            savingRef.current = false;
        });
    }

    useEffect(() => {
        save();
    }, []);

    if (errorSaving) {
        const total = importConfig.entities.length;
        const failedRows = errorSaving.failedTo - errorSaving.failedFrom > 1
            ? `rows ${errorSaving.failedFrom + 1}–${errorSaving.failedTo}`
            : `row ${errorSaving.failedFrom + 1}`;
        return (
            <CenteredView className={"flex flex-col gap-4 items-center"}>
                <Typography variant={"h6"}>
                    Error saving data
                </Typography>

                <Typography variant={"body2"} color={"error"}>
                    {errorSaving.message}
                </Typography>

                <Typography variant={"body2"}>
                    {errorSaving.committed} of {total} rows were imported.
                    The import stopped on {failedRows}, which {errorSaving.failedTo - errorSaving.failedFrom > 1 ? "were" : "was"} not written.
                </Typography>

                <Button
                    onClick={save}
                >
                    {errorSaving.committed > 0
                        ? `Retry from row ${errorSaving.committed + 1}`
                        : "Retry"}
                </Button>
            </CenteredView>
        );
    }

    return (
        <div className={"flex flex-col gap-4 items-center"}>
            <CircularProgress/>

            <Typography variant={"h6"}>
                Saving data
            </Typography>

            <Typography variant={"body2"}>
                {processedEntities}/{importConfig.entities.length} entities saved
            </Typography>

            <Typography variant={"caption"}>
                Do not close this tab or the import will be interrupted.
            </Typography>

        </div>
    );

}
