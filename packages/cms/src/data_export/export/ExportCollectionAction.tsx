
import React, { useCallback } from "react";

import {
    useAuthController,
    useCustomizationController,
    useData,
    useTranslation
} from "@rebasepro/app";
import { useAdminContext } from "../../hooks";
import { Entity, User } from "@rebasepro/types";
import { CollectionActionsProps, ExportConfig, RebaseContext, AdminCollection } from "@rebasepro/cms-types";
import { getDefaultValuesFor } from "@rebasepro/common";
import {
    Alert,
    BooleanSwitchWithLabel,
    Button,
    CircularProgress,
    Dialog,
    DialogActions,
    DialogContent,
    DialogTitle,
    DownloadIcon,
    IconButton,
    iconSize,
    Label,
    RadioGroup,
    RadioGroupItem,
    Tooltip
} from "@rebasepro/ui";
import { downloadEntitiesExport } from "./export";
import { fetchAllEntitiesForExport, MAX_EXPORT_ROWS } from "./fetch_export_data";

const DOCS_LIMIT = 500;

/**
 * Additional-field builders run per row and may do I/O, so a `Promise.all` over
 * the whole export is one request per row all at once. That was bounded only by
 * the 50-row cap the export used to have; now that the read is paginated, it is
 * bounded here instead.
 */
const ADDITIONAL_FIELDS_CONCURRENCY = 50;

async function mapInChunks<T, R>(items: T[], fn: (item: T) => Promise<R>, chunkSize = ADDITIONAL_FIELDS_CONCURRENCY): Promise<R[]> {
    const results: R[] = [];
    for (let i = 0; i < items.length; i += chunkSize) {
        results.push(...await Promise.all(items.slice(i, i + chunkSize).map(fn)));
    }
    return results;
}

export function ExportCollectionAction<M extends Record<string, unknown>, USER extends User>({
    collection,
    path,
    collectionEntitiesCount,
    onAnalyticsEvent,
    exportAllowed,
    notAllowedView
}: CollectionActionsProps<M, USER, AdminCollection<M>> & {
    exportAllowed?: (props: { collectionEntitiesCount: number, path: string, collection: AdminCollection }) => boolean;
    notAllowedView?: React.ReactNode;
    onAnalyticsEvent?: (event: string, params?: any) => void;
}) {

    const { t } = useTranslation();

    const exportConfig = typeof collection.exportable === "object" ? collection.exportable : undefined;

    const dateRef = React.useRef<Date>(new Date());

    const [includeUndefinedValues, setIncludeUndefinedValues] = React.useState<boolean>(false);
    const [flattenArrays, setFlattenArrays] = React.useState<boolean>(true);
    const [exportType, setExportType] = React.useState<"csv" | "json">("csv");
    const [dateExportType, setDateExportType] = React.useState<"timestamp" | "string">("string");

    const context = useAdminContext<USER>();
    const dataClient = useData();

    // Said before the download starts, not discovered halfway through it: the
    // walk refuses rather than writing a short file, so the dialog has to name
    // the ceiling it is about to hit.
    const tooManyToExport = collectionEntitiesCount !== undefined && collectionEntitiesCount > MAX_EXPORT_ROWS;

    const canExport = !exportAllowed || exportAllowed({
        collectionEntitiesCount: collectionEntitiesCount ?? 0,
        path,
        collection
    });

    const [dataLoading, setDataLoading] = React.useState<boolean>(false);
    const [dataLoadingError, setDataLoadingError] = React.useState<Error | undefined>();
    const [progress, setProgress] = React.useState<{ loaded: number, total?: number }>({ loaded: 0 });

    const [open, setOpen] = React.useState(false);

    const handleClickOpen = useCallback(() => {
        setOpen(true);
    }, [setOpen]);

    const handleClose = useCallback(() => {
        setOpen(false);
    }, [setOpen]);

    const fetchAdditionalFields = useCallback(async (entities: Entity<M>[]) => {

        const additionalExportFields = exportConfig?.additionalFields;
        const additionalFields = collection.additionalFields;

        const resolvedExportColumnsValues: Record<string, any>[] = additionalExportFields
            ? await mapInChunks(entities, async (entity) => {
                return (await Promise.all(additionalExportFields.map(async (column) => {
                    return {
                        [column.key]: await column.builder({
                            entity,
                            context: context as RebaseContext
                        })
                    };
                }))).reduce((a, b) => ({ ...a,
...b }), {});
            })
            : [];

        const resolvedColumnsValues: Record<string, any>[] = additionalFields
            ? await mapInChunks(entities, async (entity) => {
                return (await Promise.all(additionalFields
                    .map(async (field) => {
                        if (!field.value)
                            return {};
                        return {
                            [field.key]: await field.value({
                                entity,
                                context: context as RebaseContext
                            })
                        };
                    }))).reduce((a, b) => ({ ...a,
...b }), {});
            })
            : [];
        return [...resolvedExportColumnsValues, ...resolvedColumnsValues];
    }, [exportConfig?.additionalFields]);

    const doDownload = useCallback(async (collection: AdminCollection<M>,
        exportConfig: ExportConfig<any> | undefined): Promise<boolean> => {

        onAnalyticsEvent?.("export_collection", {
            collection: collection.slug
        });
        setDataLoading(true);
        setDataLoadingError(undefined);
        setProgress({ loaded: 0 });
        try {
            // Paginated, not `find({})`: an absent limit resolves to 50 rows
            // server-side, so the export used to be the first page of the
            // collection under a filename that read like all of it.
            const data = await fetchAllEntitiesForExport<M>({
                accessor: dataClient.collection(path) as { find: (params?: any) => Promise<any> },
                onProgress: (loaded, total) => setProgress({ loaded,
                    total })
            });
            const additionalData = await fetchAdditionalFields(data);
            const additionalHeaders = [
                ...exportConfig?.additionalFields?.map(column => column.key) ?? [],
                ...collection.additionalFields?.map(field => field.key) ?? []
            ];

            const defaultValues = includeUndefinedValues ? getDefaultValuesFor(collection.properties) : undefined;
            const dataWithDefaults = defaultValues
                ? data.map(entity => ({
                    ...entity,
                    values: { ...defaultValues,
...entity.values }
                }))
                : data;
            downloadEntitiesExport({
                data: dataWithDefaults,
                additionalData,
                properties: collection.properties,
                propertiesOrder: collection.propertiesOrder,
                name: collection.name,
                flattenArrays,
                additionalHeaders,
                exportType,
                dateExportType
            });
            onAnalyticsEvent?.("export_collection_success", {
                collection: collection.slug
            });
            return true;
        } catch (e) {
            console.error("Error loading export data", e);
            setDataLoadingError(e as Error);
            return false;
        } finally {
            setDataLoading(false);
        }

    }, [onAnalyticsEvent, dataClient, path, fetchAdditionalFields, includeUndefinedValues, flattenArrays, exportType, dateExportType]);

    const onOkClicked = useCallback(() => {
        // The dialog stays open until the walk finishes: it is the only place a
        // multi-page export reports progress, or reports that it failed.
        doDownload(collection, exportConfig).then((downloaded) => {
            if (downloaded) handleClose();
        });
    }, [doDownload, collection, exportConfig, handleClose]);

    return <>

        <Tooltip title={"Export"}
            asChild={true}>
            <IconButton
                size={"small"}
                color={"primary"}
                onClick={handleClickOpen}>
                <DownloadIcon size={iconSize.small}/>
            </IconButton>
        </Tooltip>

        <Dialog
            open={open}
            onOpenChange={setOpen}
            maxWidth={"xl"}>

            <DialogTitle variant={"h6"}>{t("export_data")}</DialogTitle>

            <DialogContent className={"flex flex-col gap-4 my-4"}>

                <div>{t("download_table_csv")}</div>

                {collectionEntitiesCount !== undefined && collectionEntitiesCount > DOCS_LIMIT && !tooManyToExport &&
                    <Alert color={"warning"}>
                        <div>
                            {t("large_number_of_documents", { count: collectionEntitiesCount.toString() })}
                        </div>
                    </Alert>}

                {tooManyToExport &&
                    <Alert color={"error"}>
                        <div>
                            {t("too_many_documents_to_export", {
                                count: (collectionEntitiesCount ?? 0).toString(),
                                limit: MAX_EXPORT_ROWS.toString()
                            })}
                        </div>
                    </Alert>}

                <div className={"flex flex-row gap-4"}>
                    <div className={"p-4 flex flex-col"}>
                        <RadioGroup value={exportType} onValueChange={(v) => setExportType(v as "csv" | "json")}>
                            <div className="flex items-center gap-2">
                                <RadioGroupItem value="csv" id="radio-csv"/>
                                <Label htmlFor="radio-csv">{t("csv")}</Label>
                            </div>
                            <div className="flex items-center gap-2">
                                <RadioGroupItem value="json" id="radio-json"/>
                                <Label htmlFor="radio-json">{t("json")}</Label>
                            </div>
                        </RadioGroup>
                    </div>

                    <div className={"p-4 flex flex-col"}>
                        <RadioGroup value={dateExportType} onValueChange={(v) => setDateExportType(v as "timestamp" | "string")}>
                            <div className="flex items-center gap-2">
                                <RadioGroupItem value="timestamp" id="radio-timestamp"/>
                                <Label htmlFor="radio-timestamp">{t("dates_as_timestamps")} ({dateRef.current.getTime()})</Label>
                            </div>
                            <div className="flex items-center gap-2">
                                <RadioGroupItem value="string" id="radio-string"/>
                                <Label htmlFor="radio-string">{t("dates_as_strings")} ({dateRef.current.toISOString()})</Label>
                            </div>
                        </RadioGroup>
                    </div>
                </div>

                <BooleanSwitchWithLabel
                    size={"small"}
                    disabled={exportType !== "csv"}
                    value={flattenArrays}
                    onValueChange={setFlattenArrays}
                    label={t("flatten_arrays")}/>

                <BooleanSwitchWithLabel
                    size={"small"}
                    value={includeUndefinedValues}
                    onValueChange={setIncludeUndefinedValues}
                    label={t("include_undefined_values")}/>

                {dataLoadingError && <Alert color={"error"}>
                    <div>{dataLoadingError.message}</div>
                </Alert>}

                {!canExport && notAllowedView}

            </DialogContent>

            <DialogActions>

                {dataLoading && <CircularProgress size={"smallest"}/>}

                {dataLoading && <Label>
                    {progress.total !== undefined
                        ? `${progress.loaded} / ${progress.total}`
                        : `${progress.loaded}`}
                </Label>}

                <Button onClick={handleClose}
                    variant={"text"}>
                    {t("cancel")}
                </Button>

                <Button onClick={onOkClicked}
                    disabled={dataLoading || !canExport || tooManyToExport}>
                    {t("download")}
                </Button>

            </DialogActions>

        </Dialog>

    </>;
}
