import {
    useAuthController,
    useTranslation
} from "@rebasepro/app";
import { PluginHomePageAdditionalCardsProps } from "@rebasepro/cms-types";
import { Card, cls, PlusIcon, Typography } from "@rebasepro/ui";
import { useCollectionEditorController } from "../useCollectionEditorController";

export function NewCollectionCard({
    group,
    context
}: PluginHomePageAdditionalCardsProps) {

    const authController = useAuthController();
    const collectionEditorController = useCollectionEditorController();
    const { t } = useTranslation();

    if (!context.navigationStateController?.topLevelNavigation)
        return null;
    const canCreateCollections = !collectionEditorController?.configController?.readOnly;

    return (
        <Card className={cls("h-full p-4 min-h-[124px]")}
            onClick={collectionEditorController && canCreateCollections
                ? () => collectionEditorController.createCollection({
                    initialValues: group ? { group } : undefined,
                    parentCollectionSlugs: [],
                    parentEntityIds: [],
                    redirect: true,
                    sourceClick: "new_collection_card"
                })
                : undefined}>

            <div
                className="flex items-center justify-center h-full w-full grow flex-col">
                <PlusIcon className="text-primary"/>
                <Typography color="primary"
                    variant={"caption"}
                    className={"font-medium"}>{t("studio_new_collection_add").toUpperCase()}</Typography>

                {!canCreateCollections &&
                    <Typography variant={"caption"}>{t("studio_new_collection_no_permission")}</Typography>
                }
            </div>

        </Card>
    );
}
