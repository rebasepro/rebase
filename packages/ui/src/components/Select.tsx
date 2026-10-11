
"use client";
import { CheckIcon, ChevronDownIcon } from "lucide-react";
import { iconSize } from "../icons/Icon";
import React, { ChangeEvent, Children, forwardRef, useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as SelectPrimitive from "@radix-ui/react-select";
import {
    defaultBorderMixin,
    fieldBackgroundDisabledMixin,
    fieldBackgroundHoverMixin,
    fieldBackgroundInvisibleMixin,
    fieldBackgroundMixin,
    focusedDisabled
} from "../styles";

import { cls } from "../util";
import { SelectInputLabel } from "./common/SelectInputLabel";
import { usePortalContainer } from "../hooks/PortalContainerContext";

export type SelectValue = string | number | boolean;

/**
 * Above this many options a closed select renders only the one it shows.
 *
 * Radix renders a closed select's items anyway — into a detached fragment, so
 * that a letter typed on the focused trigger can pick one, and inside a form
 * into the hidden native `<select>` as well. An enum field paid for its whole
 * list on every render of the form around it: 500 options were 100 ms to mount
 * and 17 ms per re-render in jsdom, linear in the count. Small lists keep
 * Radix's own behaviour untouched; long ones answer typed letters here
 * ({@link findNextOption}) and render their items when opened.
 */
const LAZY_OPTIONS_THRESHOLD = 50;

/** How long typed letters accumulate into one search — Radix's own window. */
const TYPEAHEAD_RESET_MS = 1000;

type SelectOption = {
    element: React.ReactElement<SelectItemProps<SelectValue>>,
    value: string,
    disabled: boolean
};

/**
 * The `SelectItem`s among `children`, in document order: through fragments,
 * `SelectGroup`s and any other element wrapping them. An item rendered by a
 * component of the caller's own is not seen, so such a list never counts as
 * long and keeps the default behaviour.
 */
function collectOptions(children: React.ReactNode, into: SelectOption[] = []): SelectOption[] {
    Children.forEach(children, (child) => {
        if (!React.isValidElement(child)) return;
        if (child.type === SelectItem) {
            const props = child.props as SelectItemProps<SelectValue>;
            into.push({
                element: child as React.ReactElement<SelectItemProps<SelectValue>>,
                value: String(props.value),
                disabled: Boolean(props.disabled)
            });
            return;
        }
        const nested = (child.props as { children?: React.ReactNode }).children;
        if (nested !== undefined) collectOptions(nested, into);
    });
    return into;
}

/** The text a node would render, as far as its elements' own children say. */
function textOf(node: React.ReactNode): string {
    if (node === null || node === undefined || typeof node === "boolean") return "";
    if (typeof node === "string" || typeof node === "number") return String(node);
    if (Array.isArray(node)) return node.map(textOf).join("");
    if (React.isValidElement(node)) return textOf((node.props as { children?: React.ReactNode }).children);
    return "";
}

/**
 * What a typed letter matches an option against: its `textValue`, else the
 * text of its children, else its value. Radix reads the rendered text, which
 * an unrendered item does not have — an item whose label is drawn by a
 * component (a chip) passes `textValue`.
 */
function optionLabel(option: SelectOption): string {
    const { textValue, children } = option.element.props;
    if (textValue !== undefined) return textValue;
    return textOf(children).trim() || option.value;
}

/**
 * Radix's `findNextItem`, over options that are not rendered: the next option
 * after the current one whose label starts with the search; the same letter
 * typed again cycles through the options it starts.
 */
function findNextOption(options: SelectOption[], search: string, current: SelectOption | undefined): SelectOption | undefined {
    if (options.length === 0) return undefined;
    const isRepeated = search.length > 1 && Array.from(search).every((char) => char === search[0]);
    const normalizedSearch = (isRepeated ? search[0] : search).toLowerCase();
    const start = Math.max(current ? options.indexOf(current) : -1, 0);
    let wrapped = options.map((_, index) => options[(start + index) % options.length]);
    if (normalizedSearch.length === 1) wrapped = wrapped.filter((option) => option !== current);
    const next = wrapped.find((option) => optionLabel(option).toLowerCase().startsWith(normalizedSearch));
    return next !== current ? next : undefined;
}

export type SelectProps<T extends SelectValue = string> = {
    open?: boolean,
    name?: string,
    fullWidth?: boolean,
    id?: string,
    onOpenChange?: (open: boolean) => void,
    value?: T,
    className?: string,
    inputClassName?: string,
    viewportClassName?: string,
    onChange?: React.EventHandler<ChangeEvent<HTMLSelectElement>>,
    onValueChange?: (updatedValue: T) => void,
    placeholder?: React.ReactNode,
    renderValue?: (value: T) => React.ReactNode,
    size?: "smallest" | "small" | "medium" | "large",
    label?: React.ReactNode | string,
    disabled?: boolean,
    error?: boolean,
    position?: "item-aligned" | "popper",
    endAdornment?: React.ReactNode,
    inputRef?: React.Ref<HTMLButtonElement>,
    padding?: boolean,
    invisible?: boolean,
    /**
     * Whether the trigger draws its own chevron. A table cell turns it off:
     * the cell draws one opener for every kind of editor, in the same place.
     */
    chevron?: boolean,
    /**
     * Replaces everything the trigger draws — the value, the box, its padding,
     * its height and the chevron — with this node. For a caller that frames
     * the select itself: a table cell passes the preview it shows at rest, so
     * selecting the cell moves nothing.
     */
    triggerContent?: React.ReactNode,
    children?: React.ReactNode;
    dataType?: "string" | "number" | "boolean";
    portalContainer?: HTMLElement | null; // Explicitly added to props type if missing
    /**
     * Accessible name for the trigger, for a select whose `label` is a node
     * rather than a string — or which shows no label at all.
     *
     * Without it such a select announces the literal fallback "Select an
     * option", which is indistinguishable from every other unlabelled select
     * on the screen.
     */
    "aria-label"?: string;
};

export const Select = forwardRef<HTMLDivElement, SelectProps>(({
    inputRef,
    open,
    name,
    fullWidth = false,
    id,
    onOpenChange,
    value,
    onChange,
    onValueChange,
    className,
    inputClassName,
    viewportClassName,
    placeholder,
    renderValue,
    label,
    size = "large",
    error,
    disabled,
    padding = true,
    position = "item-aligned",
    endAdornment,
    invisible,
    chevron = true,
    triggerContent,
    children,
    dataType = "string",
    portalContainer: manualContainer, // Rename to avoid confusion
    "aria-label": ariaLabel,
    ...props
}, ref) => {

    const [openInternal, setOpenInternal] = useState(open ?? false);

    useEffect(() => {
        setOpenInternal(open ?? false);
    }, [open]);

    // Get the portal container from context
    const contextContainer = usePortalContainer();

    // Resolve final container (Manual Prop > Context Container > Undefined/Body)
    const finalContainer = (manualContainer ?? contextContainer ?? undefined) as HTMLElement | undefined;

    const onValueChangeInternal = useCallback((newValue: string) => {
        let typedValue: SelectValue = newValue;
        if (dataType === "boolean") {
            if (newValue === "true") typedValue = true;
            else if (newValue === "false") typedValue = false;
        } else if (dataType === "number") {
            if (!isNaN(Number(newValue)) && newValue.trim() !== "") typedValue = Number(newValue);
        }

        onValueChange?.(typedValue as SelectValue & typeof value);
        if (onChange) {
            const event = {
                target: {
                    name,
                    value: typedValue
                }
            } as ChangeEvent<HTMLSelectElement>;
            onChange(event);
        }
    }, [onChange, onValueChange, name, dataType]);

    const hasValue = Array.isArray(value) ? value.length > 0 : (value != null && value !== "" && value !== undefined);
    const stringValue = value !== undefined ? String(value) : undefined;

    // A long list renders its items only while open; closed, it renders the
    // one it shows, which keeps that option in the native `<select>` a form
    // submits. See LAZY_OPTIONS_THRESHOLD.
    const options = useMemo(() => collectOptions(children), [children]);
    const lazyOptions = options.length > LAZY_OPTIONS_THRESHOLD;
    const renderedOptions = !lazyOptions || openInternal
        ? children
        : (options.find((option) => option.value === stringValue)?.element ?? null);

    // Type-ahead on the closed trigger of a long list, where Radix has no
    // rendered items to search. Radix's own handler still runs after this one
    // and finds nothing to change; it keeps its own buffer in step, so a space
    // typed mid-search does not open the list, as before.
    const typeahead = useRef<{ search: string, timer?: ReturnType<typeof setTimeout> }>({ search: "" });
    useEffect(() => () => clearTimeout(typeahead.current.timer), []);
    const resetTypeahead = useCallback(() => {
        clearTimeout(typeahead.current.timer);
        typeahead.current.search = "";
    }, []);
    const onTriggerKeyDown = useCallback((event: React.KeyboardEvent<HTMLButtonElement>) => {
        if (!lazyOptions || disabled) return;
        if (event.ctrlKey || event.altKey || event.metaKey || event.key.length !== 1) return;
        const state = typeahead.current;
        // A space starts nothing: it opens the list.
        if (event.key === " " && state.search === "") return;
        const search = state.search + event.key;
        state.search = search;
        clearTimeout(state.timer);
        state.timer = setTimeout(() => {
            state.search = "";
        }, TYPEAHEAD_RESET_MS);
        const enabled = options.filter((option) => !option.disabled);
        const current = enabled.find((option) => option.value === stringValue);
        const next = findNextOption(enabled, search, current);
        if (next) onValueChangeInternal(next.value);
    }, [lazyOptions, disabled, options, stringValue, onValueChangeInternal]);

    // Inside a form Radix mirrors the value into a hidden native `<select>` and
    // reports whatever that select then holds. A closed long list has only its
    // shown option in there, so when the value moves to another option — typed,
    // or set by the form — the select has no match for one commit and reports
    // "", a change nobody made, which would clear the field. A real "" can only
    // come from an option whose value is "".
    const hasEmptyOption = useMemo(() => options.some((option) => option.value === ""), [options]);
    const onRootValueChange = useCallback((newValue: string) => {
        if (lazyOptions && newValue === "" && !hasEmptyOption) return;
        onValueChangeInternal(newValue);
    }, [lazyOptions, hasEmptyOption, onValueChangeInternal]);

    const displayChildren = useMemo(() => {
        if (!hasValue || renderValue) return null;

        // Find the child that matches the current value to display its content
        let found: React.ReactNode = null;
        Children.forEach(children, (child) => {
            if (React.isValidElement<SelectItemProps>(child) && String(child.props.value) === String(value)) {
                found = child.props.children;
            }
        });
        return found;
    }, [children, hasValue, renderValue, value]);

    // Radix reads a value of "" as nothing selected and shows the placeholder
    // slot, whatever the Value's children say. So an item whose value really is
    // "" (an "inherit the default" choice) is shown through that slot, or the
    // trigger stays blank while it is the selected one.
    const emptyItemDisplay = useMemo(() => {
        if (stringValue !== "") return null;
        const emptyItem = Children.toArray(children).find((child): child is React.ReactElement<SelectItemProps> =>
            React.isValidElement<SelectItemProps>(child) && String(child.props.value) === "");
        if (!emptyItem) return null;
        return value !== undefined && renderValue ? renderValue(value) : emptyItem.props.children;
    }, [children, renderValue, stringValue, value]);

    const bare = triggerContent !== undefined;
    // Radix's value slot is an inline `span` that drops the class it is
    // given, so a chip inside it sits on a text baseline and the slot stands
    // a pixel taller than the chip. A block of its own takes it off the line.
    const bareContent = bare ? <div className={"flex w-full"}>{triggerContent}</div> : undefined;

    const controlHeight = {
        "min-h-[28px]": size === "smallest",
        "min-h-[32px]": size === "small",
        "min-h-[40px]": size === "medium",
        "min-h-[48px]": size === "large"
    };

    return (
        <SelectPrimitive.Root
            name={name}
            value={stringValue}
            open={openInternal}
            disabled={disabled}
            onValueChange={onRootValueChange}
            onOpenChange={(open) => {
                if (open) resetTypeahead();
                onOpenChange?.(open);
                setOpenInternal(open);
            }}
            {...props}>
            {typeof label === "string" ? <SelectInputLabel error={error}>{label}</SelectInputLabel> : label}
            <div className={cls(
                "select-none",
                !bare && "rounded-lg text-sm",
                !bare && (invisible ? fieldBackgroundInvisibleMixin : fieldBackgroundMixin),
                // An invisible field has no hover fill of its own: whatever frames it (a table cell) carries the hover.
                !bare && (disabled ? fieldBackgroundDisabledMixin : (invisible ? "" : fieldBackgroundHoverMixin)),
                "relative flex items-center",
                className,
                !bare && controlHeight,
                {
                    "w-fit": !fullWidth,
                    "w-full": fullWidth
                }
            )}>
                <SelectPrimitive.Trigger
                    ref={inputRef}
                    id={id}
                    asChild={false}
                    type="button"
                    onKeyDown={onTriggerKeyDown}
                    // A `label` that is an element — which every entity form
                    // passes, because the label carries the property's type
                    // icon — fell through to a hard-coded English literal, so
                    // every enum field in every form announced itself as
                    // "Select an option". Callers pass `aria-label` now; the
                    // literal stays as the last resort, and is unreachable for
                    // anything that names itself.
                    aria-label={ariaLabel ?? (typeof label === "string" ? label : (typeof renderValue === "string" ? renderValue : "Select an option"))}
                    aria-invalid={error || undefined}
                    className={cls(
                        "h-full",
                        padding && !bare ? {
                            "px-4": size === "large",
                            "px-3": size === "medium",
                            "px-2": size === "small" || size === "smallest"
                        } : "",
                        "outline-hidden focus:outline-hidden",
                        "outline-none focus:outline-none",
                        "select-none",
                        !bare && [
                            "rounded-lg text-sm",
                            error ? "text-red-500 dark:text-red-600" : "focus:text-text-primary dark:focus:text-text-primary-dark",
                            error ? "border border-red-500 dark:border-red-600" : "",
                            disabled ? "text-surface-accent-600 dark:text-surface-accent-400" : "text-surface-accent-800 dark:text-white",
                            controlHeight
                        ],
                        "relative flex flex-row items-center",
                        {
                            "w-full": fullWidth,
                            "w-fit": !fullWidth
                        },
                        inputClassName
                    )}
                >
                    <div
                        ref={ref}
                        className={cls(
                            "flex-grow max-w-full flex flex-row gap-2 items-center",
                            "overflow-visible",
                            !bare && controlHeight
                        )}>
                        <SelectPrimitive.Value
                            onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                            }}
                            placeholder={bareContent ?? emptyItemDisplay ?? placeholder}
                            className={"w-full"}>

                            {bareContent ?? (hasValue && value !== undefined && renderValue
                                ? renderValue(value)
                                : (displayChildren || placeholder)
                            )}

                        </SelectPrimitive.Value>
                    </div>

                    {chevron && !bare && <SelectPrimitive.Icon asChild>
                        <ChevronDownIcon size={size === "large" ? iconSize.medium : iconSize.small}
                            className={cls("transition", open ? "rotate-180" : "", {
                                "px-2": size === "large",
                                "px-1": size === "medium" || size === "small"
                            })}/>
                    </SelectPrimitive.Icon>}
                </SelectPrimitive.Trigger>

                {endAdornment && (
                    <div
                        className={cls("h-full flex items-center absolute right-0 pr-12")}
                        onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                        }}>
                        {endAdornment}
                    </div>
                )}
            </div>

            {/* Pass the calculated finalContainer */}
            <SelectPrimitive.Portal container={finalContainer}>
                <SelectPrimitive.Content position={position}
                    className={cls(focusedDisabled, "z-50 relative overflow-hidden border bg-surface-card p-2 rounded-lg shadow-lg animate-in fade-in-0 zoom-in-95 duration-150", defaultBorderMixin)}>
                    <SelectPrimitive.Viewport className={cls("p-1", viewportClassName)}
                        style={{ maxHeight: "var(--radix-select-content-available-height)" }}>
                        {renderedOptions}
                    </SelectPrimitive.Viewport>
                </SelectPrimitive.Content>
            </SelectPrimitive.Portal>
        </SelectPrimitive.Root>
    );
});

Select.displayName = "Select";

export type SelectItemProps<T extends SelectValue = string> = {
    value: T,
    children?: React.ReactNode,
    disabled?: boolean,
    className?: string,
    /**
     * The text a letter typed on the focused select matches this option by.
     * Defaults to the option's text. Set it when the option is drawn by a
     * component (a chip, an icon with a name inside it): a closed select with
     * more than 50 options does not render them, so their text cannot be read.
     */
    textValue?: string,
};

export const SelectItem = React.memo(function SelectItem<T extends SelectValue = string>({
    value,
    children,
    disabled,
    className,
    textValue
}: SelectItemProps<T>) {
    // Convert value to string for Radix UI
    const stringValue = String(value);

    return <SelectPrimitive.Item
        key={stringValue}
        value={stringValue}
        disabled={disabled}
        textValue={textValue}
        className={cls(
            "w-full",
            "relative flex items-center p-2 rounded-md text-sm text-surface-accent-700 dark:text-surface-accent-300",
            "focus:z-10",
            "data-[state=checked]:bg-surface-active focus:bg-surface-hover",
            "data-[state=checked]:focus:bg-surface-active",
            disabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer",
            "[&>*]:w-full",
            "overflow-visible",
            className
        )}>
        <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
        <div
            className="absolute left-1 data-[state=checked]:block hidden">
            <CheckIcon size={iconSize.smallest}/>
        </div>
    </SelectPrimitive.Item>;
});

export type SelectGroupProps = {
    label: React.ReactNode,
    children: React.ReactNode,
    className?: string
};

export const SelectGroup = React.memo(function SelectGroup({
    label,
    children,
    className
}: SelectGroupProps) {
    // The items go inside the group and the label is Radix's own, so the
    // `role="group"` holds its options and is named by the label.
    return <SelectPrimitive.Group className="mt-6 first:mt-2">
        <SelectPrimitive.Label
            className={cls(
                "text-xs text-surface-accent-900 dark:text-white uppercase tracking-wider font-semibold",
                "px-2 py-2",
                className
            )}>
            {label}
        </SelectPrimitive.Label>
        {children}
    </SelectPrimitive.Group>;
});
