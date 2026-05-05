import { Card, cls, Markdown, Typography } from "@rebasepro/ui";
import { ArrowRightIcon } from "lucide-react";
import React from "react";

export type NavigationCardProps = {
    name: string,
    description?: string;
    actions: React.ReactNode;
    icon: React.ReactNode;
    onClick?: () => void,
    shrink?: boolean
};

// Wrap the component with React.memo
export const NavigationCard = React.memo(function NavigationCard({
    name,
    description,
    icon,
    actions,
    onClick,
    shrink
}: NavigationCardProps) {

    return (
        <Card
            className={cls(
                "group h-full p-5 cursor-pointer transition-all duration-200 ease-in-out",
                "border-surface-200/40 dark:border-surface-700/40",
                "hover:-translate-y-0.5 hover:shadow-md hover:shadow-primary/5",
                "hover:border-primary/30 dark:hover:border-primary/20",
                shrink && "w-full max-w-full min-h-0 scale-75"
            )}
            onClick={() => {
                onClick?.();
            }}
        >

            <div className="flex flex-col h-full">
                {/* Header: title + icon left, actions right */}
                <div className="flex items-center w-full justify-between mb-1">
                    <div className="flex items-center gap-4">
                        <div className="flex items-center justify-center w-7 h-7 rounded-lg bg-primary/8 dark:bg-primary/10 text-primary/70 dark:text-primary/60 transition-colors duration-200 group-hover:bg-primary/12 dark:group-hover:bg-primary/15 group-hover:text-primary dark:group-hover:text-primary/80">
                            {icon}
                        </div>
                        <Typography variant="subtitle1"
                            component="h2">
                            {name}
                        </Typography>
                    </div>

                    <div
                        className="flex items-center gap-0.5"
                        onClick={(event: React.MouseEvent) => {
                            event.preventDefault();
                            event.stopPropagation();
                        }}>
                        {actions}
                    </div>
                </div>

                {/* Description */}
                <div className="grow pl-[44px]">
                    {description && <Typography variant="caption"
                        color="secondary"
                        component="div">
                        <Markdown source={description} size={"small"}/>
                    </Typography>}
                </div>

                {/* Arrow */}
                <div className="self-end mt-1">
                    <div className={"transition-transform duration-200 group-hover:translate-x-0.5"}>
                        <ArrowRightIcon className="text-primary"/>
                    </div>
                </div>

            </div>

        </Card>)
});
