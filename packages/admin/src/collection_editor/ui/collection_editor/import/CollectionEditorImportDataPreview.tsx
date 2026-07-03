import { useCollectionRegistryController } from "../../../_cms_internals";
import { convertDataToSnapshot, ImportConfig } from "../../../_cms_internals";
import { useAuthController } from "@rebasepro/core";
import { SnapshotCollectionTable } from "../../../../components/SnapshotCollectionTable/SnapshotCollectionTable";
import { useSelectionController } from "../../../../components/SnapshotCollectionView/useSelectionController";
import { CircularProgressCenter } from "@rebasepro/ui";
import { Properties } from "@rebasepro/types";
import { useEffect, useState } from "react";
import { Typography } from "@rebasepro/ui";

export function CollectionEditorImportDataPreview({
    importConfig,
    properties,
    propertiesOrder
}: {
    importConfig: ImportConfig,
    properties: Properties,
    propertiesOrder: string[]
}) {

    const authController = useAuthController();
    const registry = useCollectionRegistryController();
    const [loading, setLoading] = useState<boolean>(false);

    async function loadSnapshots() {
        const mappedData = importConfig.importData.map(d => convertDataToSnapshot(authController,
            registry,
            d,
            importConfig.idColumn,
            importConfig.headersMapping,
            properties,
            "TEMP_PATH",
            importConfig.defaultValues));
        importConfig.setSnapshots(mappedData);
    }

    useEffect(() => {
        loadSnapshots().finally(() => setLoading(false));
    }, []);

    const selectionController = useSelectionController();
    if (loading)
        return <CircularProgressCenter/>

    return <SnapshotCollectionTable
        title={<div>
            <Typography variant={"subtitle2"}>Imported data preview</Typography>
            <Typography variant={"caption"}>Snapshots with the same id will be overwritten</Typography>
        </div>}
        tableController={{
            data: importConfig.snapshots,
            dataLoading: false,
            noMoreToLoad: false
        }}
        endAdornment={<div className={"h-12"}/>}
        filterable={false}
        sortable={false}
        selectionController={selectionController}
        displayedColumnIds={propertiesOrder.map(p => ({
            key: p,
            disabled: false
        }))}
        openSnapshotMode={"side_panel"}
        properties={properties}
        enablePopupIcon={false}/>

}
