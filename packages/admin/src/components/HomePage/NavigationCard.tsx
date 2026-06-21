import { ArrowRightIcon, Card, cls, iconSize, Markdown, Typography } from "@rebasepro/ui";
import React from "react";

export type NavigationCardProps = {
    name: string,
    description?: string;
    actions: React.ReactNode;
    icon: React.ReactNode;
    additionalContent?: React.ReactNode;
    onClick?: () => void,
    shrink?: boolean
};

// Wrap the component with React.memo
export const NavigationCard = React.memo(function NavigationCard({
    name,
    description,
    icon,
    actions,
    additionalContent,
    onClick,
    shrink
}: NavigationCardProps) {

    return (
        <Card
            className={cls(
                "group h-full p-4 cursor-pointer transition-colors duration-150 ease-in-out",
                "hover:bg-primary/5 dark:hover:bg-primary/5",
                shrink && "w-full max-w-full min-h-0 scale-75"
            )}
            onClick={() => {
                onClick?.();
            }}
        >

            <div className="flex flex-col h-full">
                {/* Header: title + icon left, actions right */}
                <div className="flex items-center w-full justify-between mb-1">
                    <div className="flex items-center gap-3">
                        <div className="flex items-center justify-center w-5 h-5 text-surface-400 dark:text-surface-500 transition-colors duration-150 group-hover:text-primary dark:group-hover:text-primary">
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
                <div className="pl-8">
                    {description && <Typography variant="caption"
                        color="secondary"
                        component="div">
                        <Markdown source={description} size={"small"}/>
                    </Typography>}
                </div>

                {additionalContent && (
                    <div className="pl-8 pointer-events-none">
                        {additionalContent}
                    </div>
                )}

                {/* Spacer pushes content above to align at the top across grid siblings */}
                <div className="grow"/>

            </div>

        </Card>)
});
