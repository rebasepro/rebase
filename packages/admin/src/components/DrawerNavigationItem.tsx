import React from "react";

import { NavLink } from "react-router-dom";
import { cls, Tooltip } from "@rebasepro/ui";

export function DrawerNavigationItem({
    name,
    icon,
    drawerOpen,
    adminMenuOpen,
    tooltipsOpen,
    url,
    onClick,
    indented = false
}: {
    icon: React.ReactElement,
    name: string,
    tooltipsOpen: boolean,
    drawerOpen: boolean,
    adminMenuOpen?: boolean,
    url: string,
    onClick?: () => void,
    /**
     * Render as a child of an icon-bearing group: no icon of its own, indented to
     * sit under the group's label. Set by {@link DrawerNavigationGroup} only when
     * the group actually has an icon and the drawer is expanded.
     */
    indented?: boolean,
}) {

    // Indented rows give up the icon rather than keeping it *and* indenting: a
    // per-row icon repeated down a group is what flattens the hierarchy, since
    // every row then reads at the weight of the category above it. The indent is
    // the same 44px the icon occupied, so labels stay on the original grid and the
    // rail width does not change.
    const iconWrap = indented
        ? <div className={"shrink-0 w-[44px] h-[30px]"} aria-hidden={true}/>
        : <div
            className={"shrink-0 flex items-center justify-center w-[44px] h-[30px] text-surface-500 dark:text-text-secondary-dark [&>svg]:size-4 group-hover/nav:text-primary transition-colors duration-150"}>
            {icon}
        </div>;

    const listItem = <div>
        <NavLink
            onClick={onClick}
            style={{
                width: "100%",
                transition: drawerOpen ? "width 150ms ease-in" : undefined
            }}
            className={({ isActive }: { isActive: boolean }) => cls("rounded-lg truncate group/nav",
                "hover:bg-primary/5 dark:hover:bg-primary/5 text-surface-700 dark:text-surface-300 hover:text-surface-900 dark:hover:text-white",
                "flex flex-row items-center",
                drawerOpen ? "pr-4 h-[30px]" : "h-[30px]",
                "font-medium text-[13px]",
                isActive ? "bg-primary/8 dark:bg-primary/10 text-primary dark:text-primary [&_div]:text-primary" : ""
            )}
            to={url}
        >

            {iconWrap}

            <div
                className={cls(
                    "text-text-primary dark:text-surface-200",
                    drawerOpen ? "opacity-100" : "opacity-0 hidden",
                    "font-inherit truncate space-x-2"
                )}>
                {name}
            </div>
        </NavLink>
    </div>;

    return <Tooltip
        open={drawerOpen || adminMenuOpen ? false : tooltipsOpen}
        side="right"
        title={name}>
        {listItem}
    </Tooltip>;
}
