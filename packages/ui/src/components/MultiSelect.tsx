
"use client";
import { CheckIcon, ChevronDownIcon, XIcon } from "lucide-react";
import { iconSize } from "../icons/Icon";
import * as PopoverPrimitive from "@radix-ui/react-popover";
import * as React from "react";
import { ChangeEvent, Children, useEffect, useState } from "react";
import { Command as CommandPrimitive } from "cmdk";
import { cls } from "../util";

import { Separator } from "./Separator";
import { Chip } from "./Chip";
import { SelectInputLabel } from "./common/SelectInputLabel";
import {
    defaultBorderMixin,
    fieldBackgroundDisabledMixin,
    fieldBackgroundHoverMixin,
    fieldBackgroundInvisibleMixin,
    fieldBackgroundMixin,
    focusedDisabled
} from "../styles";
import { useInjectStyles } from "../hooks";
import { usePortalContainer } from "../hooks/PortalContainerContext";

export type MultiSelectValue = string | number | boolean;

// Make the context properly generic
interface MultiSelectContextProps<T extends MultiSelectValue = string> {
    fieldValue?: T[];
    onItemClick: (v: T) => void;
}

// Create a proper generic context
export const MultiSelectContext = React.createContext<MultiSelectContextProps<MultiSelectValue>>(null! as MultiSelectContextProps<MultiSelectValue>);

/**
 * Props for MultiSelect component
 */
interface MultiSelectProps<T extends MultiSelectValue = string> {
    modalPopover?: boolean;
    className?: string;
    open?: boolean,
    name?: string,
    id?: string,
    onOpenChange?: (open: boolean) => void,
    value?: T[],
    inputClassName?: string,
    onChange?: React.EventHandler<ChangeEvent<HTMLSelectElement>>,
    onValueChange?: (updatedValue: T[]) => void,
    placeholder?: React.ReactNode,
    size?: "smallest" | "small" | "medium" | "large",
    useChips?: boolean,
    label?: React.ReactNode | string,
    disabled?: boolean,
    error?: boolean,
    position?: "item-aligned" | "popper",
    endAdornment?: React.ReactNode,
    multiple?: boolean,
    includeSelectAll?: boolean,
    includeClear?: boolean,
    inputRef?: React.Ref<HTMLButtonElement>,
    padding?: boolean,
    invisible?: boolean,
    children: React.ReactNode;
    renderValues?: (values: T[]) => React.ReactNode;
    portalContainer?: HTMLElement | null;
    /**
     * Accessible name for the trigger.
     *
     * Without it the name is whatever the button happens to contain — the
     * selected chips, or nothing at all when the field is empty — so an empty
     * multi-select announced itself as an unnamed button. `label` cannot serve:
     * an entity form passes an element there, because the label carries the
     * property's type icon.
     */
    "aria-label"?: string;
}

// Use generic type for the forwarded ref
export const MultiSelect = React.forwardRef<
    HTMLButtonElement,
    MultiSelectProps
>(
    (
        {
            value,
            size = "large",
            label,
            error,
            onValueChange,
            invisible,
            disabled,
            placeholder,
            modalPopover = true,
            includeClear = true,
            includeSelectAll = true,
            useChips = true,
            className,
            inputClassName,
            inputRef,
            children,
            renderValues,
            open,
            onOpenChange,
            portalContainer,
            "aria-label": ariaLabel
        },
        ref
    ) => {
        const [isMounted, setIsMounted] = useState(false);
        const [isPopoverOpen, setIsPopoverOpen] = useState(open ?? false);
        const [selectedValues, setSelectedValues] = useState<string[]>(value ?? []);

        // Get the portal container from context
        const contextContainer = usePortalContainer();

        // Prioritize manual prop, fallback to context container
        const finalContainer = (portalContainer ?? contextContainer ?? undefined) as HTMLElement | undefined;

        useEffect(() => {
            setIsMounted(true);
        }, []);

        const onPopoverOpenChange = (open: boolean) => {
            setIsPopoverOpen(open);
            onOpenChange?.(open);
        }

        useEffect(() => {
            setIsPopoverOpen(open ?? false);
        }, [open]);

        const allValues = React.useMemo(() => children
            ?
            Children.map(children, (child) => {
                if (React.isValidElement<MultiSelectItemProps>(child)) {
                    return child.props.value;
                }
                return null;
            })?.filter(Boolean) ?? []
            : [], [children]);

        const optionsMap = React.useMemo(() => {
            const map = new Map<string, React.ReactNode>();
            Children.forEach(children, (child) => {
                if (React.isValidElement<MultiSelectItemProps>(child)) {
                    map.set(String(child.props.value), child.props.children);
                }
            });
            return map;
        }, [children]);

        React.useEffect(() => {
            setSelectedValues(value ?? []);
        }, [value]);

        const updateValues = React.useCallback((values: string[]) => {
            setSelectedValues(values);
            onValueChange?.(values);
        }, [onValueChange]);

        const onItemClick = React.useCallback((newValue: MultiSelectValue) => {
            let newSelectedValues: string[];
            if (selectedValues.some(v => String(v) === String(newValue))) {
                newSelectedValues = selectedValues.filter(v => String(v) !== String(newValue));
            } else {
                newSelectedValues = [...selectedValues, String(newValue)];
            }
            updateValues(newSelectedValues);
        }, [selectedValues, updateValues]);

        const handleInputKeyDown = (
            event: React.KeyboardEvent<HTMLInputElement>
        ) => {
            if (event.key === "Enter") {
                onPopoverOpenChange(true);
            } else if (event.key === "Backspace" && !event.currentTarget.value) {
                const newSelectedValues = [...selectedValues];
                newSelectedValues.pop();
                updateValues(newSelectedValues);
            }
        };

        const toggleOption = (value: string) => {
            const newSelectedValues = selectedValues.some(v => String(v) === String(value))
                ? selectedValues.filter(v => String(v) !== String(value))
                : [...selectedValues, value];
            updateValues(newSelectedValues);
        };

        const handleClear = () => {
            updateValues([]);
        };

        const handleTogglePopover = () => {
            onPopoverOpenChange(!isPopoverOpen);
        };

        const toggleAll = () => {
            if (selectedValues.length === allValues.length) {
                handleClear();
            } else {
                updateValues(allValues);
            }
            onPopoverOpenChange(false);
        };

        // Scoped to this popover. Unscoped, it reached every other cmdk list on
        // the page — the relation and user selectors set their own height on
        // the list and got a second, competing scroll container inside it.
        useInjectStyles("MultiSelect", `
[data-multi-select-content] [cmdk-group] {
  max-height: 45vh;
  overflow-y: auto;
} `)

        const contextValue = React.useMemo(() => ({
            fieldValue: selectedValues,
            onItemClick
        }), [selectedValues, onItemClick]);

        return (
            <MultiSelectContext.Provider value={contextValue}>

                {typeof label === "string" ? <SelectInputLabel error={error}>{label}</SelectInputLabel> : label}

                <PopoverPrimitive.Root
                    open={isMounted && isPopoverOpen}
                    onOpenChange={onPopoverOpenChange}
                    modal={modalPopover}
                >
                    <PopoverPrimitive.Trigger asChild>
                        <button
                            ref={inputRef ?? ref}
                            aria-label={ariaLabel ?? (typeof label === "string" ? label : undefined)}
                            onClick={handleTogglePopover}
                            className={cls(
                                {
                                    "min-h-[28px]": size === "smallest",
                                    "min-h-[32px]": size === "small",
                                    "min-h-[40px]": size === "medium",
                                    "min-h-[48px]": size === "large"
                                },
                                {
                                    // Kept tight so the min-height above governs:
                                    // py-2 plus a medium Chip overflowed it and made
                                    // smallest/small render at the same height.
                                    "py-0": size === "smallest",
                                    "py-0.5": size === "small",
                                    "py-1": size === "medium" || size === "large"
                                },
                                {
                                    "px-2": size === "small" || size === "smallest",
                                    "px-4": size === "medium" || size === "large"
                                },
                                "select-none rounded-lg text-sm",
                                "focus:ring-0 focus-visible:ring-0 outline-none focus:outline-none focus-visible:outline-none",
                                invisible ? fieldBackgroundInvisibleMixin : fieldBackgroundMixin,
                                disabled ? fieldBackgroundDisabledMixin : fieldBackgroundHoverMixin,
                                "relative flex items-center",
                                className,
                                inputClassName
                            )}
                        >
                            {selectedValues.length > 0 ? (
                                <div className="flex justify-between items-center w-full">
                                    <div className="flex flex-wrap items-center gap-1.5 text-start">
                                        {renderValues && renderValues(selectedValues)}
                                        {!renderValues && selectedValues.map((value) => {

                                            const optionChildren = optionsMap.get(String(value));
                                            if (!useChips) {
                                                return optionChildren;
                                            }
                                            return (
                                                <Chip
                                                    size={size === "smallest" || size === "small" ? "smallest" : "small"}
                                                    key={String(value)}
                                                    className={cls("flex flex-row items-center p-1")}
                                                >
                                                    {optionChildren}
                                                    <XIcon
                                                        size={iconSize.smallest}
                                                        onClick={(event) => {
                                                            event.stopPropagation();
                                                            toggleOption(value);
                                                        }}
                                                    />
                                                </Chip>
                                            );
                                        })}
                                    </div>
                                    <div className="flex items-center justify-between">
                                        {includeClear && <XIcon
                                            className={"ml-4"}
                                            size={iconSize.small}
                                            onClick={(event) => {
                                                event.stopPropagation();
                                                handleClear();
                                            }}
                                        />}
                                        <div className={cls("px-2 h-full flex items-center")}>
                                            <ChevronDownIcon size={size === "large" ? iconSize.medium : iconSize.small}
                                                className={cls("transition", isPopoverOpen ? "rotate-180" : "")}/>
                                        </div>
                                    </div>
                                </div>
                            ) : (
                                <div className="flex items-center justify-between w-full mx-auto">
                                    <span className="text-sm">
                                        {placeholder}
                                    </span>
                                    <div className={cls("px-2 h-full flex items-center")}>
                                        <ChevronDownIcon size={size === "large" ? iconSize.medium : iconSize.small}
                                            className={cls("transition", isPopoverOpen ? "rotate-180" : "")}/>
                                    </div>
                                </div>
                            )}
                        </button>
                    </PopoverPrimitive.Trigger>
                    <PopoverPrimitive.Portal container={finalContainer}>
                        <PopoverPrimitive.Content
                            data-multi-select-content
                            className={cls("z-50 overflow-hidden border bg-white dark:bg-surface-800 rounded-lg w-[400px]", defaultBorderMixin)}
                            align="start"
                            sideOffset={8}
                            onEscapeKeyDown={() => onPopoverOpenChange(false)}
                        >
                            <CommandPrimitive>
                                <div className={"flex flex-row items-center"}>
                                    <CommandPrimitive.Input
                                        className={cls(focusedDisabled, "bg-transparent outline-none flex-1 h-full w-full m-4 flex-grow text-surface-accent-900 dark:text-white")}
                                        placeholder="Search..."
                                        onKeyDown={handleInputKeyDown}
                                    />
                                    {selectedValues.length > 0 && (
                                        <div
                                            onClick={handleClear}
                                            className="text-sm justify-center cursor-pointer py-3 px-4 text-text-secondary dark:text-text-secondary-dark">
                                            Clear
                                        </div>
                                    )}
                                </div>
                                <Separator orientation={"horizontal"} className={"my-0"}/>
                                <CommandPrimitive.List>
                                    <CommandPrimitive.Empty className={"px-4 py-2 text-sm text-text-secondary dark:text-text-secondary-dark"}>
                                        No results found.
                                    </CommandPrimitive.Empty>
                                    <CommandPrimitive.Group>
                                        {includeSelectAll && <CommandPrimitive.Item
                                            key="all"
                                            onSelect={toggleAll}
                                            className={
                                                cls(
                                                    "flex flex-row items-center gap-1.5",
                                                    "cursor-pointer",
                                                    "m-1",
                                                    "ring-offset-transparent",
                                                    "p-1 rounded-md aria-[selected=true]:outline-none aria-[selected=true]:ring-2 aria-[selected=true]:ring-primary aria-[selected=true]:ring-opacity-75 aria-[selected=true]:ring-primary/75 aria-[selected=true]:ring-offset-2",
                                                    "aria-[selected=true]:bg-surface-accent-100 aria-[selected=true]:dark:bg-surface-accent-900",
                                                    "cursor-pointer p-2 rounded-md aria-[selected=true]:bg-surface-accent-100 aria-[selected=true]:dark:bg-surface-accent-900"
                                                )
                                            }
                                        >
                                            <InnerCheckBox checked={selectedValues.length === allValues.length}/>
                                            <span className={"text-sm text-text-secondary dark:text-text-secondary-dark"}>(Select All)</span>
                                        </CommandPrimitive.Item>}
                                        {children}
                                    </CommandPrimitive.Group>
                                </CommandPrimitive.List>
                            </CommandPrimitive>
                        </PopoverPrimitive.Content>
                    </PopoverPrimitive.Portal>
                </PopoverPrimitive.Root>
            </MultiSelectContext.Provider>
        );
    }
);

MultiSelect.displayName = "MultiSelect";

export interface MultiSelectItemProps<T extends MultiSelectValue = string> {
    value: T;
    children?: React.ReactNode,
    className?: string;
}

export const MultiSelectItem = React.memo(function MultiSelectItem<T extends MultiSelectValue = string>({
    children,
    value,
    className
}: MultiSelectItemProps<T>) {
    const context = React.useContext(MultiSelectContext);
    if (!context) throw new Error("MultiSelectItem must be used inside a MultiSelect");
    const {
        fieldValue,
        onItemClick
    } = context;

    const isSelected = (fieldValue ?? []).some(v => String(v) === String(value));

    return <CommandPrimitive.Item
        onMouseDown={(e) => {
            e.preventDefault();
            e.stopPropagation();
        }}
        onSelect={(_) => {
            onItemClick(value);
        }}
        className={cls(
            "flex flex-row items-center gap-1.5",
            isSelected ? "bg-surface-accent-200 dark:bg-surface-accent-950" : "",
            "cursor-pointer",
            "m-1",
            "ring-offset-transparent",
            "p-1 rounded-md aria-[selected=true]:outline-none aria-[selected=true]:ring-2 aria-[selected=true]:ring-primary aria-[selected=true]:ring-opacity-75 aria-[selected=true]:ring-primary/75 aria-[selected=true]:ring-offset-2",
            "aria-[selected=true]:bg-surface-accent-100 aria-[selected=true]:dark:bg-surface-accent-900",
            "cursor-pointer p-2 rounded-md aria-[selected=true]:bg-surface-accent-100 aria-[selected=true]:dark:bg-surface-accent-900",
            "text-surface-accent-700 dark:text-surface-accent-300",
            className
        )}
    >
        <InnerCheckBox checked={isSelected}/>
        {children}
    </CommandPrimitive.Item>;
});

const InnerCheckBox = React.memo(function InnerCheckBox({ checked }: { checked: boolean }) {
    return <div className={cls(
        "p-2",
        "w-8 h-8",
        "inline-flex items-center justify-center text-sm font-medium focus:outline-none transition-colors ease-in-out duration-150"
    )}>
        <div
            className={cls(
                "border-2 relative transition-colors ease-in-out duration-150",
                "w-4 h-4 rounded-sm flex items-center justify-center",
                (checked ? "bg-primary" : "bg-white dark:bg-surface-accent-900"),
                (checked) ? "text-surface-accent-100 dark:text-surface-accent-900" : "",
                (checked ? "border-transparent" : "border-surface-accent-800 dark:border-surface-accent-200")
            )}>
            {checked && <CheckIcon size={iconSize.smallest} className={"absolute"}/>}
        </div>
    </div>
});
