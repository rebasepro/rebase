import React, { PropsWithChildren, useState } from "react";
import { cls, ExpandablePanel, IconButton, iconSize, PencilIcon, Typography } from "@rebasepro/ui";
import { useNavigationGroupLabel } from "@rebasepro/app";
import { NAVIGATION_DEFAULT_GROUP_NAME } from "../../hooks/navigation/utils";

export function NavigationGroup({
    children,
    group,
    minimised,
    isPreview,
    isPotentialCardDropTarget,
    onEditGroup,
    dndDisabled,
    collapsed,
    onToggleCollapsed
}: PropsWithChildren<{
    group: string | undefined,
    minimised?: boolean,
    isPreview?: boolean,
    isPotentialCardDropTarget?: boolean,
    onEditGroup?: (groupName: string) => void;
    dndDisabled?: boolean;
    collapsed?: boolean;
    onToggleCollapsed?: () => void;
}>) {

    const groupLabel = useNavigationGroupLabel();
    const [isHovered, setIsHovered] = useState(false);

    /**
     * The group's *name*, which is an identifier — it is what `onEditGroup`
     * renames, what the card ordering compares, and what the drawer keys its
     * icons off. Never the translated heading.
     */
    const currentGroupName = group ?? NAVIGATION_DEFAULT_GROUP_NAME;

    /**
     * What the heading reads.
     *
     * This used to translate only the default group (`t("views_group")`) and
     * render every other name raw, while the drawer used
     * `useNavigationGroupLabel` — so the same three groups had two sets of
     * labels on one screen: `VISTAS / DATABASE / SETTINGS` on the home page
     * against `VIEWS / BASE DE DATOS / SETTINGS` in the drawer beside it. One
     * lookup, in both places.
     */
    const currentGroupLabel = groupLabel(currentGroupName);

    // Show caret only when not in preview and there is a toggle handler
    const showCaret = !isPreview && !!onToggleCollapsed;

    // Helper for the title content (left side)
    const TitleContent = (
        <div className={cls("flex items-center", isPreview ? "px-1 py-0.5" : "")}
        >
            <Typography
                variant={isPreview ? "body2" : "caption"}
                component={"h2"}
                color="secondary"
                className={cls(
                    "px-4 py-1 rounded",
                    "font-medium text-[10px] uppercase tracking-[0.08em] text-primary/50 dark:text-primary/70"
                )}
            >
                {currentGroupLabel}
            </Typography>
            {!isPreview && onEditGroup && !dndDisabled && (
                <IconButton
                    size="smallest"
                    onClick={(e) => {
                        e.stopPropagation(); // Prevent toggle on click
                        onEditGroup(currentGroupName);
                    }}
                    className={cls("ml-2 ", isHovered ? "opacity-100" : "opacity-0", "transition-opacity duration-100")}
                >
                    <PencilIcon size={iconSize.smallest}/>
                </IconButton>
            )}
        </div>
    );

    return (
        <div className={cls(
            !isPotentialCardDropTarget ? "my-10" : "my-6",
            "transition-all duration-200 ease-in-out"
        )}
        >
            {/* Preview: static header + content (no caret / no collapse) */}
            {isPreview && (
                <>
                    <div
                        className={cls(
                            "flex items-center justify-between w-full",
                            "p-4 py-2"
                        )}
                        onMouseEnter={() => setIsHovered(true)}
                        onMouseLeave={() => setIsHovered(false)}
                    >
                        {TitleContent}
                    </div>
                    {children}
                </>
            )}

            {/* Interactive collapsible version when a toggle handler is provided */}
            {!isPreview && showCaret && (
                <ExpandablePanel
                    invisible
                    expanded={!collapsed}
                    onExpandedChange={(open) => {
                        if (open !== !collapsed) {
                            onToggleCollapsed?.();
                        }
                    }}
                    className={cls("mt-6")}
                    titleClassName={cls(
                        "min-h-0 p-0 border-none",
                        "rounded flex items-center justify-between w-full",
                        "hover:bg-transparent",
                        "cursor-pointer select-none",
                        collapsed && "bg-surface-100 dark:bg-surface-900/50"
                    )}
                    innerClassName={cls("mt-4", !minimised ? "pt-0" : "")}
                    title={
                        <div
                            onMouseEnter={() => setIsHovered(true)}
                            onMouseLeave={() => setIsHovered(false)}
                            className="flex items-center"
                        >
                            {TitleContent}
                        </div>
                    }
                >
                    {minimised ? (
                        <div className={cls("mt-4 p-8 bg-surface-accent-200 dark:bg-surface-accent-800 rounded-lg")}
                            style={{ minHeight: "50px" }}>
                        </div>
                    ) : (
                        <div className={cls("mt-4", !minimised ? "pt-0" : "")}>
                            {children}
                        </div>
                    )}
                </ExpandablePanel>
            )}

            {/* Non-collapsible (no caret) runtime, keep old behavior */}
            {!isPreview && !showCaret && (
                <>
                    <div
                        className={cls(
                            "flex items-center justify-between w-full",
                            "mt-6"
                        )}
                        onMouseEnter={() => setIsHovered(true)}
                        onMouseLeave={() => setIsHovered(false)}
                    >
                        {TitleContent}
                    </div>

                    {!collapsed && (
                        minimised ? (
                            <div className={cls("mt-4 p-8 bg-surface-accent-200 dark:bg-surface-accent-800 rounded-lg")}
                                style={{ minHeight: "50px" }}>
                            </div>
                        ) : (
                            <div className={cls("mt-4", !minimised ? "pt-0" : "")}>
                                {children}
                            </div>
                        )
                    )}
                </>
            )}
        </div>
    );
}
