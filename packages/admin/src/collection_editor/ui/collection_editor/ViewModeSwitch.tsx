import { CollectionCustomView, ViewMode } from "@rebasepro/admin-types";
import {
    cls,
    KanbanIcon,
    LayoutGridIcon,
    ListIcon,
    TableIcon,
    ToggleButtonGroup,
    Typography
} from "@rebasepro/ui";
import { getIcon, useCustomizationController } from "@rebasepro/app";

export function ViewModeSwitch({
    value,
    onChange,
    className
}: {
    value: ViewMode;
    onChange: (value: ViewMode) => void;
    className?: string;
}) {

    const customizationController = useCustomizationController();

    // Only app-registered views are offerable here. A view declared inline on
    // a collection carries a `Builder` function, which the editor cannot write
    // back into a config file — registering it on `<RebaseAdmin>` and naming
    // the key is what makes it editable, the same bargain `entityViews` makes.
    const registeredViews: CollectionCustomView[] = customizationController.collectionViews ?? [];

    return <div className={cls(className)}>
        <Typography variant={"label"} color={"secondary"} className={"ml-3.5"}>Default collection view</Typography>
        <div className={"my-2"}>
            <ToggleButtonGroup
                value={value}
                onValueChange={onChange}
                options={[
                    {
                        value: "list",
                        label: "List",
                        icon: <ListIcon/>
                    },
                    {
                        value: "table",
                        label: "Table",
                        icon: <TableIcon/>
                    },
                    {
                        value: "cards",
                        label: "Cards",
                        icon: <LayoutGridIcon/>
                    },
                    {
                        value: "kanban",
                        label: "Kanban",
                        icon: <KanbanIcon/>
                    },
                    ...registeredViews.map((view) => ({
                        value: view.key,
                        label: view.name,
                        icon: getIcon(view.icon) ?? <ListIcon/>
                    }))
                ]}
            />
        </div>
        <Typography variant={"caption"} color={"secondary"} className={"ml-3.5"}>Choose how entities should be displayed by default</Typography>
    </div>
}
