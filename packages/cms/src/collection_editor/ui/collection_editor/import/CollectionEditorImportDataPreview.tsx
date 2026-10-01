import { useCollectionRegistryController } from "../../../_cms_internals";
import { convertImportData, ImportConfig, ImportConversionProblems } from "../../../_cms_internals";
import type { ImportConversionProblem } from "../../../../data_import/utils/data";
import { useAuthController } from "@rebasepro/app";
import { CollectionTableBinding } from "../../../../components/CollectionTableBinding/CollectionTableBinding";
import { useSelectionController } from "../../../../components/CollectionViewBinding/useSelectionController";
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
    const [problems, setProblems] = useState<ImportConversionProblem[]>([]);

    async function loadEntities() {
        const converted = convertImportData(authController,
            registry,
            importConfig.importData,
            importConfig.idColumn,
            importConfig.headersMapping,
            properties,
            "TEMP_PATH",
            importConfig.defaultValues);
        importConfig.setEntities(converted.entities);
        setProblems(converted.problems);
    }

    useEffect(() => {
        loadEntities().finally(() => setLoading(false));
    }, []);

    const selectionController = useSelectionController();
    if (loading)
        return <CircularProgressCenter/>

    return <div className={"flex flex-col h-full w-full"}>
        <ImportConversionProblems problems={problems}/>
        <div className={"flex-1 min-h-0"}>
            <CollectionTableBinding
                title={<div>
                    <Typography variant={"subtitle2"}>Imported data preview</Typography>
                    <Typography variant={"caption"}>Entities with the same id will be overwritten</Typography>
                </div>}
                tableController={{
                    data: importConfig.entities,
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
                openEntityMode={"side_panel"}
                properties={properties}
                enablePopupIcon={false}/>
        </div>
    </div>;

}
