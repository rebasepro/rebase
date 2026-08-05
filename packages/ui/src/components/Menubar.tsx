
import * as React from "react";

import * as MenubarPrimitive from "@radix-ui/react-menubar";
import { cls } from "../util";
import { CheckIcon, ChevronRightIcon } from "lucide-react";
import { iconSize } from "../icons/Icon";
import { usePortalContainer } from "../hooks/PortalContainerContext";

export function Menubar({
                            children,
                            onSelect,
                            value,
                            defaultValue,
                            onValueChange,
                            className
                        }: {
    children: React.ReactNode,
    onSelect?: (event: React.SyntheticEvent) => void,
    /** Value of the open menu, controlled. Pair with `onValueChange`. */
    value?: string,
    /** Value of the menu open on mount, uncontrolled. */
    defaultValue?: string,
    onValueChange?: (value: string) => void,
    className?: string
}) {
    return (
        <MenubarPrimitive.Root
            onSelect={onSelect}
            value={value}
            defaultValue={defaultValue}
            onValueChange={onValueChange}
            className={cls("z-10 flex bg-white dark:bg-surface-900 p-[3px] rounded-lg shadow-sm", className)}>
            {children}
        </MenubarPrimitive.Root>
    )
}

export function MenubarMenu({
                                children,
                                value
                            }: {
    children: React.ReactNode,
    /** Identifies this menu to the parent Menubar's `value`/`defaultValue`. */
    value?: string
}) {
    return (
        <MenubarPrimitive.Menu value={value}>
            {children}
        </MenubarPrimitive.Menu>
    )
}

export function MenubarTrigger({
                                   children,
                                   onSelect,
                                   className
                               }: {
    children: React.ReactNode,
    onSelect?: (event: React.SyntheticEvent) => void,
    className?: string
}) {
    return (
        <MenubarPrimitive.Trigger
            onSelect={onSelect}
            className={cls("py-2 px-3 outline-none select-none font-medium leading-none rounded-md text-text-primary dark:text-text-primary-dark text-sm transition-colors duration-150 flex items-center justify-between gap-[2px] data-[highlighted]:bg-surface-accent-100 data-[highlighted]:dark:bg-surface-900 data-[state=open]:bg-surface-accent-100 data-[state=open]:dark:bg-surface-900 hover:bg-surface-accent-200 hover:bg-opacity-75 hover:bg-surface-accent-200/75 dark:hover:bg-surface-accent-800",
                className)}>
            {children}
        </MenubarPrimitive.Trigger>
    )
}

export function MenubarPortal({
                                  children,
                                  portalContainer
                              }: {
    children: React.ReactNode;
    portalContainer?: HTMLElement | null;
}) {
    // Get the portal container from context
    const contextContainer = usePortalContainer();

    // Prioritize manual prop, fallback to context container
    const finalContainer = (portalContainer ?? contextContainer ?? undefined) as HTMLElement | undefined;

    return (
        <MenubarPrimitive.Portal container={finalContainer}>
            {children}
        </MenubarPrimitive.Portal>
    )
}

export function MenubarContent({
                                   children,
                                   className,
                                   align,
                                   sideOffset,
                                   alignOffset,
                                   onSelect,
                                   ...rest
                               }: {
    children: React.ReactNode,
    className?: string,
    onSelect?: (event: React.SyntheticEvent) => void,
    align?: "start" | "center" | "end",
    sideOffset?: number,
    alignOffset?: number
}) {
    return (
        <MenubarPrimitive.Content
            onSelect={onSelect}
            // `z-50`, the floating layer — see the note in `Menu`. This carried
            // no z-index at all, so the wrapper Radix portals out to the body
            // got `auto` and the menu opened underneath any dialog or panel it
            // was hosted in.
            className={cls("z-50 min-w-[220px] bg-white dark:bg-surface-900 rounded-md p-[6px] shadow-[0px_10px_38px_-10px_rgba(22,_23,_24,_0.35),_0px_10px_20px_-15px_rgba(22,_23,_24,_0.2)] [animation-duration:_400ms] [animation-timing-function:_cubic-bezier(0.16,_1,_0.3,_1)] will-change-[transform,opacity]", className)}
            align={align ?? "start"}
            sideOffset={sideOffset ?? 5}
            alignOffset={alignOffset ?? -3}
            {...rest}
        >
            {children}
        </MenubarPrimitive.Content>
    )
}

export function MenubarItem({
                                children,
                                leftPadding,
                                className,
                                disabled,
                                onSelect,
                                ...rest
                            }: {
    children: React.ReactNode,
    onSelect?: (event: Event) => void;
    leftPadding?: boolean,
    className?: string,
    disabled?: boolean
}) {
    return (
        <MenubarPrimitive.Item
            onSelect={onSelect}
            className={cls("group text-sm leading-none rounded-md flex items-center h-[32px] px-[10px] py-[2px] relative select-none transition-colors duration-150 outline-none data-[state=open]:bg-surface-accent-100 data-[state=open]:dark:bg-surface-900 data-[state=open]:text-text-primary data-[state=open]:dark:text-text-primary-dark data-[highlighted]:bg-surface-accent-100 data-[highlighted]:dark:bg-surface-900  data-[disabled]:text-text-disabled data-[disabled]:dark:text-text-disabled-dark data-[disabled]:pointer-events-none",
                leftPadding ? "pl-5" : "",
                disabled ? "pointer-events-none text-text-secondary dark:text-text-secondary-dark" : "text-text-primary dark:text-text-primary-dark",
                className)}
            disabled={disabled}
            {...rest}
        >
            {children}
        </MenubarPrimitive.Item>
    )
}

export function MenubarSeparator({
                                     children,
                                     className,
                                     ...rest
                                 }: {
    children?: React.ReactNode,
    className?: string,
}) {
    return (
        <MenubarPrimitive.Separator
            className={cls("h-[1px] bg-surface-accent-100 dark:bg-surface-900 m-[5px]", className)}
            {...rest}
        >
            {children}
        </MenubarPrimitive.Separator>
    )
}

export function MenubarSub({
                               children,
                               ...rest
                           }: {
    children?: React.ReactNode,
}) {
    return (
        <MenubarPrimitive.Sub
            {...rest}
        >
            {children}
        </MenubarPrimitive.Sub>
    )
}

export function MenubarSubTrigger({
                                      children,
                                      className,
                                      onSelect,
                                      ...rest
                                  }: {
    children?: React.ReactNode,
    onSelect?: (event: React.SyntheticEvent) => void,
    className?: string,
}) {
    return (
        <MenubarPrimitive.SubTrigger
            onSelect={onSelect}
            className={cls("group text-sm leading-none text-text-primary dark:text-text-primary-dark rounded-md flex items-center h-[32px] px-[10px] py-[2px] relative select-none transition-colors duration-150 outline-none data-[state=open]:bg-surface-accent-100 data-[state=open]:dark:bg-surface-900 data-[state=open]:text-text-primary data-[state=open]:dark:text-text-primary-dark data-[highlighted]:bg-surface-accent-100 data-[highlighted]:dark:bg-surface-900  data-[disabled]:text-text-disabled data-[disabled]:dark:text-text-disabled-dark data-[disabled]:pointer-events-none",
                className)}
            {...rest}
        >
            {children}
        </MenubarPrimitive.SubTrigger>
    )
}

export function MenubarSubContent({
                                      children,
                                      alignOffset,
                                      className,
                                      onSelect,
                                      ...rest
                                  }: {
    children?: React.ReactNode,
    onSelect?: (event: React.SyntheticEvent) => void,
    alignOffset?: number,
    className?: string,
}) {
    return (
        <MenubarPrimitive.SubContent
            onSelect={onSelect}
            alignOffset={alignOffset ?? -5}
            className={cls("min-w-[220px] bg-white dark:bg-surface-900 rounded-md p-[6px] shadow-[0px_10px_38px_-10px_rgba(22,_23,_24,_0.35),_0px_10px_20px_-15px_rgba(22,_23,_24,_0.2)] [animation-duration:_400ms] [animation-timing-function:_cubic-bezier(0.16,_1,_0.3,_1)] will-change-[transform,opacity]",
                className)}
            {...rest}
        >
            {children}
        </MenubarPrimitive.SubContent>
    )
}

export function MenubarCheckboxItem({
                                        children,
                                        checked,
                                        onCheckedChange,
                                        className,
                                        onSelect,
                                        ...rest
                                    }: {
    children?: React.ReactNode,
    onSelect?: (event: Event) => void;
    checked?: boolean,
    onCheckedChange?: () => void,
    className?: string,
}) {
    return (
        <MenubarPrimitive.CheckboxItem
            onSelect={onSelect}
            className={cls("text-sm leading-none text-text-primary dark:text-text-primary-dark rounded-md flex items-center h-[32px] px-[10px] py-[2px] relative select-none transition-colors duration-150 pl-5 outline-none data-[highlighted]:bg-surface-accent-100 data-[highlighted]:dark:bg-surface-900 data-[disabled]:text-text-disabled data-[disabled]:dark:text-text-disabled-dark data-[disabled]:pointer-events-none",
                className)}
            checked={checked}
            onCheckedChange={onCheckedChange}
            {...rest}
        >
            {children}
        </MenubarPrimitive.CheckboxItem>
    )
}

export function MenubarItemIndicator({
                                         children,
                                         className,
                                         ...rest
                                     }: {
    children?: React.ReactNode,
    className?: string,
}) {
    return (
        <MenubarPrimitive.ItemIndicator
            className={cls("absolute left-0 w-4 inline-flex items-center justify-center", className)}
            {...rest}>
            {children ?? <CheckIcon size={iconSize.smallest}/>}
        </MenubarPrimitive.ItemIndicator>
    )
}

export function MenubarRadioGroup({
                                      children,
                                      className,
                                      value,
                                      onValueChange,
                                      onSelect,
                                      ...rest
                                  }: {
    children?: React.ReactNode,
    onSelect?: (event: React.SyntheticEvent) => void,
    value?: string,
    onValueChange?: (value: string) => void,
    className?: string,
}) {
    return (
        <MenubarPrimitive.RadioGroup
            className={cls(className)}
            value={value}
            onValueChange={onValueChange}
            onSelect={onSelect}
            {...rest}>
            {children ?? <CheckIcon size={iconSize.small}/>}
        </MenubarPrimitive.RadioGroup>
    )
}

export function MenubarRadioItem({
                                     children,
                                     className,
                                     value,
                                     onSelect,
                                     ...rest
                                 }: {
    children?: React.ReactNode,
    onSelect?: (event: Event) => void;
    value: string,
    className?: string,
}) {
    return (
        <MenubarPrimitive.RadioItem
            onSelect={onSelect}
            className={cls("text-sm leading-none text-text-primary dark:text-text-primary-dark rounded-md flex items-center h-[32px] px-[10px] py-[2px] relative select-none transition-colors duration-150 pl-5 outline-none data-[highlighted]:bg-surface-accent-100 data-[highlighted]:dark:bg-surface-900 data-[disabled]:text-text-disabled data-[disabled]:dark:text-text-disabled-dark data-[disabled]:pointer-events-none",
                className)}
            value={value}
            {...rest}>
            {children ?? <CheckIcon size={iconSize.small}/>}
        </MenubarPrimitive.RadioItem>
    )
}

export function MenubarShortcut({
                                    children,
                                    className,
                                    ...rest
                                }: {
    children?: React.ReactNode,
    className?: string,
}) {
    return (
        <div
            className={cls("ml-auto pl-5 group-data-[disabled]:text-text-disabled data-[disabled]:dark:text-text-disabled-dark",
                className)}
            {...rest}>
            {children}
        </div>
    )
}

export function MenubarSubTriggerIndicator() {
    return (
        <div className="ml-auto pl-5 ">
            <ChevronRightIcon size={iconSize.small}/>
        </div>
    )
}
