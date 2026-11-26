"use client";
import React from "react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { ChevronRightIcon } from "lucide-react";
import { focusedDisabled, paperMixin } from "../styles";
import { cls } from "../util";
import { useInjectStyles } from "../hooks";
import { usePortalContainer } from "../hooks/PortalContainerContext";
import { iconSize } from "../icons/Icon";

const menuStyles = `
.MenuContent,
.MenuSubContent {
  transform-origin: var(--radix-dropdown-menu-content-transform-origin);
  animation-duration: 120ms;
  animation-timing-function: cubic-bezier(0.16, 1, 0.3, 1);
  will-change: transform, opacity;
}
.MenuContent[data-state='open'],
.MenuSubContent[data-state='open'] {
  animation-name: menuDirectionalIn;
}

@keyframes menuDirectionalIn {
  from {
    opacity: 0;
    transform: scale(0.96);
  }
  to {
    opacity: 1;
    transform: scale(1);
  }
}

@media (prefers-reduced-motion: reduce) {
  .MenuContent[data-state],
  .MenuSubContent[data-state] {
    animation: none;
  }
}
`;

export type MenuProps = {
    children: React.ReactNode;
    trigger: React.ReactNode;

    open?: boolean;
    defaultOpen?: boolean;
    onOpenChange?(open: boolean): void;

    portalContainer?: HTMLElement | null;
    side?: "top" | "right" | "bottom" | "left";
    align?: "start" | "center" | "end";

    sideOffset?: number;
    className?: string;
}

const Menu = React.forwardRef<
    React.ElementRef<typeof DropdownMenu.Trigger>,
    MenuProps
>(({
       children,
       trigger,
       open,
       defaultOpen,
       side,
       align,
       onOpenChange,
       portalContainer,
       sideOffset = 4,
       className
   }, ref) => {
    useInjectStyles("Menu", menuStyles);

    // Get the portal container from context
    const contextContainer = usePortalContainer();

    // Prioritize manual prop, fallback to context container
    const finalContainer = (portalContainer ?? contextContainer ?? undefined) as HTMLElement | undefined;

    return (
        <DropdownMenu.Root
            open={open}
            defaultOpen={defaultOpen}
            onOpenChange={onOpenChange}>
            <DropdownMenu.Trigger
                ref={ref}
                asChild>
                {trigger}
            </DropdownMenu.Trigger>
            <DropdownMenu.Portal container={finalContainer}>
                <DropdownMenu.Content
                    side={side}
                    sideOffset={sideOffset}
                    align={align}
                    // `z-50` is the floating layer — the tier `Dialog`, `Sheet`,
                    // `Select` and `Tooltip` all sit on. Radix copies this value
                    // onto the popper wrapper it portals next to them, so at any
                    // lower value the menu opens *behind* the dialog or sheet it
                    // was opened from: visible in the DOM, painted under the
                    // overlay, and unclickable. Peers on this tier stack by mount
                    // order, which is what puts a menu above the dialog holding
                    // its trigger, and a dialog that menu opens above them both.
                    className={cls("MenuContent", paperMixin, focusedDisabled, "py-2 z-50", className)}>
                    {children}
                </DropdownMenu.Content>
            </DropdownMenu.Portal>
        </DropdownMenu.Root>
    );
})
Menu.displayName = "Menu"

export { Menu }

export type MenuItemProps = {
    children: React.ReactNode;
    dense?: boolean;
    disabled?: boolean;
    onClick?: (event: React.MouseEvent) => void;
    className?: string;
};

export const MenuItem = React.memo(({
                                        children,
                                        dense = false, // Default value is false if not provided
                                        disabled = false,
                                        onClick,
                                        className
                                    }: MenuItemProps) => {
    // Dynamically adjusting the class based on the "dense" prop
    const classNames = cls(
        onClick && !disabled && "cursor-pointer",
        disabled && "opacity-50 cursor-not-allowed",
        "rounded-md text-sm font-medium text-surface-accent-700 dark:text-surface-accent-300 flex items-center gap-4 transition-colors duration-150",
        !disabled && "hover:bg-surface-hover",
        dense ? "px-4 py-1.5" : "px-4 py-2",
        className
    );

    return (
        <DropdownMenu.Item
            className={classNames}
            disabled={disabled}
            onClick={disabled ? undefined : onClick}>
            {children}
        </DropdownMenu.Item>
    );
});

MenuItem.displayName = "MenuItem";

/**
 * Nested submenu inside a {@link Menu}. Uses Radix `DropdownMenu.Sub`, which
 * includes safe-triangle pointer tolerance so diagonal cursor travel toward
 * a lower submenu item does not accidentally close the submenu.
 */
export type MenuSubProps = {
    children: React.ReactNode;
    open?: boolean;
    defaultOpen?: boolean;
    onOpenChange?: (open: boolean) => void;
};

export function MenuSub({ children, open, defaultOpen, onOpenChange }: MenuSubProps) {
    return (
        <DropdownMenu.Sub open={open} defaultOpen={defaultOpen} onOpenChange={onOpenChange}>
            {children}
        </DropdownMenu.Sub>
    );
}

export type MenuSubTriggerProps = {
    children: React.ReactNode;
    dense?: boolean;
    disabled?: boolean;
    className?: string;
};

export const MenuSubTrigger = React.memo(({
    children,
    dense = false,
    disabled = false,
    className
}: MenuSubTriggerProps) => {
    const classNames = cls(
        !disabled && "cursor-pointer",
        disabled && "opacity-50 cursor-not-allowed",
        "rounded-md text-sm font-medium text-surface-accent-700 dark:text-surface-accent-300 flex items-center justify-between gap-4 transition-colors duration-150 outline-none",
        !disabled && "hover:bg-surface-hover data-[state=open]:bg-surface-hover",
        dense ? "px-4 py-1.5" : "px-4 py-2",
        className
    );
    return (
        <DropdownMenu.SubTrigger className={classNames} disabled={disabled}>
            <span className="flex items-center gap-4">{children}</span>
            <ChevronRightIcon size={iconSize.small} className="opacity-60" aria-hidden="true" />
        </DropdownMenu.SubTrigger>
    );
});
MenuSubTrigger.displayName = "MenuSubTrigger";

export type MenuSubContentProps = {
    children: React.ReactNode;
    sideOffset?: number;
    alignOffset?: number;
    portalContainer?: HTMLElement | null;
    className?: string;
};

export function MenuSubContent({
    children,
    sideOffset = 4,
    alignOffset = -4,
    portalContainer,
    className
}: MenuSubContentProps) {
    const contextContainer = usePortalContainer();
    const finalContainer = (portalContainer ?? contextContainer ?? undefined) as HTMLElement | undefined;

    return (
        <DropdownMenu.Portal container={finalContainer}>
            <DropdownMenu.SubContent
                sideOffset={sideOffset}
                alignOffset={alignOffset}
                className={cls("MenuSubContent", paperMixin, focusedDisabled, "py-2 z-50 min-w-[160px]", className)}
            >
                {children}
            </DropdownMenu.SubContent>
        </DropdownMenu.Portal>
    );
}
