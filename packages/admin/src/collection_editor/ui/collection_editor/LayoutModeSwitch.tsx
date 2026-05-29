import {
    AppWindow,
    cls,
    ColumnsIcon,
    PanelLeftIcon,
    SquareIcon,
    ToggleButtonGroup,
    Typography
} from "@rebasepro/ui";

export function LayoutModeSwitch({
    value,
    onChange,
    className
}: {
    value: "side_panel" | "full_screen" | "split" | "dialog";
    onChange: (value: "side_panel" | "full_screen" | "split" | "dialog") => void;
    className?: string;
}) {

    return <div className={cls(className)}>
        <Typography variant={"label"} color={"secondary"} className={"ml-3.5"}>Document view</Typography>
        <div className={"my-2"}>
            <ToggleButtonGroup
                value={value}
                onValueChange={onChange}
                options={[
                    {
                        value: "side_panel",
                        label: "Side panel",
                        icon: <ColumnsIcon/>
                    },
                    {
                        value: "full_screen",
                        label: "Full screen",
                        icon: <SquareIcon/>
                    },
                    {
                        value: "split",
                        label: "Split view",
                        icon: <PanelLeftIcon/>
                    },
                    {
                        value: "dialog",
                        label: "Centered dialog",
                        icon: <AppWindow/>
                    }
                ]}
            />
        </div>
        <Typography variant={"caption"} color={"secondary"} className={"ml-3.5"}>Should documents be opened full screen, inline side dialog, or centered dialog</Typography>
    </div>
}
