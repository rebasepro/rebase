import { Button, PlusIcon } from "@rebasepro/ui";
import { useCollectionEditorController } from "../useCollectionEditorController";
import { useAdminModeController, useTranslation } from "@rebasepro/app";

export function NewCollectionButton() {
    const adminModeController = useAdminModeController();
    const collectionEditorController = useCollectionEditorController();
    const { t } = useTranslation();

    if (adminModeController.mode === "studio") {
        return null;
    }

    return <div className={"bg-surface-50 dark:bg-surface-900 min-w-fit rounded-xs"}>
        <Button className={"min-w-fit"}

            onClick={() => collectionEditorController.createCollection({
                parentCollectionSlugs: [],
                parentEntityIds: [],
                redirect: true,
                sourceClick: "new_collection_button"
            })}>
            <PlusIcon/>
            {t("studio_new_collection")}
        </Button>
    </div>
}
