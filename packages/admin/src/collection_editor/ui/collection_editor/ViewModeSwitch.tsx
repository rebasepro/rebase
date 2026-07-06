import { ViewMode } from "@rebasepro/types";
import {
    cls,
    KanbanIcon,
    LayoutGridIcon,
    ListIcon,
    TableIcon,
    ToggleButtonGroup,
    Typography
} from "@rebasepro/ui";

export function ViewModeSwitch({
    value,
    onChange,
    className
}: {
    value: ViewMode;
    onChange: (value: ViewMode) => void;
    className?: string;
}) {

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
                    }
                ]}
            />
        </div>
        <Typography variant={"caption"} color={"secondary"} className={"ml-3.5"}>Choose how entitys should be displayed by default</Typography>
    </div>
}
