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
                shrink && "w-full max-w-full min-h-0 scale-75"
            )}
            onClick={() => {
                onClick?.();
            }}
        >

            <div className="flex items-start gap-3.5 h-full">
                <div className="shrink-0 flex items-center justify-center w-9 h-9 rounded-lg bg-surface-raised text-text-secondary dark:text-text-secondary-dark transition-colors duration-150 group-hover:bg-surface-raised-hover group-hover:text-text-primary dark:group-hover:text-text-primary-dark">
                    {icon}
                </div>

                <div className="flex flex-col min-w-0 flex-1 h-full">
                    {/* Header: title left, actions right */}
                    <div className="flex items-center w-full justify-between gap-2">
                        <Typography variant="subtitle1"
                            component="h2"
                            className="truncate">
                            {name}
                        </Typography>

                        <div
                            className="flex items-center gap-0.5 shrink-0"
                            onClick={(event: React.MouseEvent) => {
                                event.preventDefault();
                                event.stopPropagation();
                            }}>
                            {actions}
                        </div>
                    </div>

                    {/* Description */}
                    {description && (
                        <div className="mt-0.5">
                            <Typography variant="caption"
                                color="secondary"
                                component="div">
                                <Markdown source={description} size={"small"}/>
                            </Typography>
                        </div>
                    )}

                    {additionalContent && (
                        <div className="mt-2 pointer-events-none">
                            {additionalContent}
                        </div>
                    )}

                    {/* Spacer pushes content above to align at the top across grid siblings */}
                    <div className="grow"/>
                </div>
            </div>

        </Card>)
});
