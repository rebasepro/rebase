
import React, { useCallback } from "react";

import { useTranslation } from "@rebasepro/app";
import { Entity, Properties } from "@rebasepro/types";
import {
    BooleanSwitchWithLabel,
    Button,
    Dialog,
    DialogActions,
    DialogContent,
    DialogTitle,
    DownloadIcon,
    IconButton,
    Label,
    RadioGroup,
    RadioGroupItem,
    Tooltip,
    Typography
} from "@rebasepro/ui";
import { downloadEntitiesExport } from "./export";

export type BasicExportActionProps = {
    data: Entity<any>[];
    properties: Properties;
    propertiesOrder?: string[];
}

export function BasicExportAction({
    data,
    properties,
    propertiesOrder
}: BasicExportActionProps) {

    const { t } = useTranslation();
    const dateRef = React.useRef<Date>(new Date());
    const [flattenArrays, setFlattenArrays] = React.useState<boolean>(true);
    const [exportType, setExportType] = React.useState<"csv" | "json">("csv");
    const [dateExportType, setDateExportType] = React.useState<"timestamp" | "string">("string");

    const [open, setOpen] = React.useState(false);

    const handleClickOpen = useCallback(() => {
        setOpen(true);
    }, [setOpen]);

    const handleClose = useCallback(() => {
        setOpen(false);
    }, [setOpen]);

    const onOkClicked = useCallback(() => {
        downloadEntitiesExport({
            data,
            additionalData: [],
            properties,
            propertiesOrder,
            name: "export.csv",
            flattenArrays,
            additionalHeaders: [],
            exportType,
            dateExportType
        });
        handleClose();
    }, []);

    return <>

        <Tooltip title={"Export"}
            asChild={true}>
            <IconButton
                size={"small"}
                color={"primary"} onClick={handleClickOpen}>
                <DownloadIcon
                    size={"small"}/>
            </IconButton>
        </Tooltip>

        <Dialog
            open={open}
            onOpenChange={setOpen}
            maxWidth={"xl"}>

            <DialogTitle variant={"h6"}>{t("export_data")}</DialogTitle>

            <DialogContent className={"flex flex-col gap-4 my-4"}>

                <div>{t("download_table_csv")}</div>

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

            </DialogContent>

            <DialogActions>

                <Button onClick={handleClose}
                    variant={"text"}>
                    {t("cancel")}
                </Button>

                <Button onClick={onOkClicked}>
                    {t("download")}
                </Button>

            </DialogActions>

        </Dialog>

    </>;
}
