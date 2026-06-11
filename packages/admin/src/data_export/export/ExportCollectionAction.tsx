
import React, { useCallback } from "react";

import {
    useAuthController,
    useCustomizationController,
    useData,
    useTranslation
} from "@rebasepro/core";
import { useCMSContext } from "../../hooks";
import { CollectionActionsProps, Entity, EntityCollection, ExportConfig, RebaseContext, User } from "@rebasepro/types";
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

const DOCS_LIMIT = 500;

export function ExportCollectionAction<M extends Record<string, unknown>, USER extends User>({
    collection,
    path,
    collectionEntitiesCount,
    onAnalyticsEvent,
    exportAllowed,
    notAllowedView
}: CollectionActionsProps<M, USER, EntityCollection<M>> & {
    exportAllowed?: (props: { collectionEntitiesCount: number, path: string, collection: EntityCollection }) => boolean;
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

    const context = useCMSContext<USER>();
    const dataClient = useData();

    const canExport = !exportAllowed || exportAllowed({
        collectionEntitiesCount: collectionEntitiesCount ?? 0,
        path,
        collection
    });

    const [dataLoading, setDataLoading] = React.useState<boolean>(false);
    const [dataLoadingError, setDataLoadingError] = React.useState<Error | undefined>();

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
            ? await Promise.all(entities.map(async (entity) => {
                return (await Promise.all(additionalExportFields.map(async (column) => {
                    return {
                        [column.key]: await column.builder({
                            entity,
                            context: context as RebaseContext
                        })
                    };
                }))).reduce((a, b) => ({ ...a,
...b }), {});
            }))
            : [];

        const resolvedColumnsValues: Record<string, any>[] = additionalFields
            ? await Promise.all(entities.map(async (entity) => {
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
            }))
            : [];
        return [...resolvedExportColumnsValues, ...resolvedColumnsValues];
    }, [exportConfig?.additionalFields]);

    const doDownload = useCallback(async (collection: EntityCollection<M>,
        exportConfig: ExportConfig<any> | undefined) => {

        onAnalyticsEvent?.("export_collection", {
            collection: collection.slug
        });
        setDataLoading(true);
        dataClient.collection(path).find({})
            .then(async (res) => {
                const data = res.data as Entity<M>[];
                setDataLoadingError(undefined);
                const additionalData = await fetchAdditionalFields(data);
                const additionalHeaders = [
                    ...exportConfig?.additionalFields?.map(column => column.key) ?? [],
                    ...collection.additionalFields?.map(field => field.key) ?? []
                ];

                const dataWithDefaults = includeUndefinedValues
                    ? data.map(entity => {
                        const defaultValues = getDefaultValuesFor(collection.properties);
                        return {
                            ...entity,
                            values: { ...defaultValues,
...entity.values }
                        };
                    })
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
            })
            .catch((e) => {
                console.error("Error loading export data", e);
                setDataLoadingError(e);
            })
            .finally(() => setDataLoading(false));

    }, [onAnalyticsEvent, dataClient, path, fetchAdditionalFields, includeUndefinedValues, flattenArrays, exportType, dateExportType]);

    const onOkClicked = useCallback(() => {
        doDownload(collection, exportConfig);
        handleClose();
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

                {collectionEntitiesCount !== undefined && collectionEntitiesCount > DOCS_LIMIT &&
                    <Alert color={"warning"}>
                        <div>
                            {t("large_number_of_documents", { count: collectionEntitiesCount.toString() })}
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

                {!canExport && notAllowedView}

            </DialogContent>

            <DialogActions>

                {dataLoading && <CircularProgress size={"smallest"}/>}

                <Button onClick={handleClose}
                    variant={"text"}>
                    {t("cancel")}
                </Button>

                <Button onClick={onOkClicked}
                    disabled={dataLoading || !canExport}>
                    {t("download")}
                </Button>

            </DialogActions>

        </Dialog>

    </>;
}
