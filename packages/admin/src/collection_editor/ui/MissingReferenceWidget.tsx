import { useCollectionRegistryController } from "../_cms_internals";
import { ErrorView, useTranslation } from "@rebasepro/core";
import { useCollectionEditorController } from "../useCollectionEditorController";
import { Button } from "@rebasepro/ui";
import { prettifyIdentifier } from "@rebasepro/utils";
import { getLastSegment } from "@rebasepro/common";

export function MissingReferenceWidget({ path: pathProp }: {
    path: string
}) {
    const registry = useCollectionRegistryController();
    const path = getLastSegment(pathProp);
    const parentCollectionIds = registry.getParentCollectionIds(pathProp);
    const collectionEditor = useCollectionEditorController();
    const { t } = useTranslation();
    return <div className={"p-1 flex flex-col items-center"}>
        <ErrorView error={t("studio_missing_reference_error", { path })}/>
        <Button className={"mx-2"}
            size={"small"}
            onClick={() => {
                collectionEditor.createCollection({
                    initialValues: { path,
name: prettifyIdentifier(path) },
                    parentCollectionIds,
                    redirect: false,
                    sourceClick: "missing_reference"
                });
            }}>
            {t("studio_missing_reference_create")}
        </Button>
    </div>;
}

