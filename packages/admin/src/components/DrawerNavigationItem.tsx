import React from "react";

import { NavLink } from "react-router";
import { cls, Tooltip } from "@rebasepro/ui";

/**
 * Props of a drawer navigation row, named so an app overriding
 * `Shell.DrawerNavigationItem` can type its wrapper against them.
 */
export type DrawerNavigationItemProps = {
    icon: React.ReactElement,
    name: string,
    /** @deprecated No longer read: the tooltip is uncontrolled. */
    tooltipsOpen?: boolean,
    drawerOpen: boolean,
    /** @deprecated No longer read: the tooltip is uncontrolled. */
    adminMenuOpen?: boolean,
    url: string,
    onClick?: () => void,
    /**
     * Drop the row's icon and indent the label into the space it occupied, so the
     * row reads as a child of the group header above it.
     *
     * Nothing in the framework sets this: the stock drawer always passes `false`,
     * and an app that wants the categorised look opts into it by overriding
     * `Shell.DrawerNavigationItem` and deciding for itself which rows get it.
     */
    indented?: boolean,
};

export function DrawerNavigationItem({
    name,
    icon,
    drawerOpen,
    url,
    onClick,
    indented = false
}: DrawerNavigationItemProps) {

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

    const [wantsTooltip, setWantsTooltip] = React.useState(false);

    // Radix will not report a close it never noticed: while the tooltip is masked
    // the pointer can leave the row without `onOpenChange(false)` ever firing. So
    // the stale `true` is dropped on the way *into* the masked state — otherwise
    // it surfaces the moment the mask lifts, as a tooltip hanging over a rail the
    // pointer left long ago.
    if (drawerOpen && wantsTooltip) setWantsTooltip(false);

    const listItem = <div>
        <NavLink
            onClick={onClick}
            // The label below is `hidden` (display:none) while the rail is
            // collapsed, which takes it out of the accessibility tree along with
            // the row's only text — a collapsed rail was a column of links with no
            // accessible name at all. The tooltip does not cover this: Radix wires
            // a trigger to its content with `aria-describedby`, which is a
            // description rather than a name, and only while the tooltip is open —
            // and this one is masked shut whenever the drawer is open.
            //
            // Named unconditionally rather than only when collapsed: expanded, this
            // is the same string the row already displays, so the accessible name
            // stays stable across the transition instead of appearing with it.
            aria-label={name}
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

    // Per row, and always controlled. The old shared flag could only say "every
    // tooltip" or "none", and the state it needed was unreachable, so no entry
    // tooltip ever opened — leaving a bare rail of unlabelled icons. Radix decides
    // when this one wants to be open, from the pointer and from focus; the drawer
    // only masks it once the label says the same thing.
    //
    // Masked rather than withheld: dropping `open`, or the title, would move the
    // tooltip between controlled and uncontrolled as the drawer opens, which
    // strands the old state — a tooltip left up over a pointer nowhere near it.
    return <Tooltip
        open={!drawerOpen && wantsTooltip}
        onOpenChange={setWantsTooltip}
        side="right"
        title={name}>
        {listItem}
    </Tooltip>;
}
