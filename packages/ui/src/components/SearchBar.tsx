
"use client";
import { SearchIcon, XIcon } from "lucide-react";
import { iconSize } from "../icons/Icon";
import React, { useCallback, useState } from "react";

import { CircularProgress } from "./CircularProgress";
import { IconButton } from "./IconButton";

import { cls } from "../util";
import { useDebounceValue } from "../hooks";
import { useUiLabels } from "../hooks/UiLabelsContext";

interface SearchBarProps {
    onClick?: () => void;
    onTextSearch?: (searchString?: string) => void;
    placeholder?: string;
    expandable?: boolean;
    /**
     * Rest as an icon — the size of an icon button beside it, with no fill —
     * while the field is empty and not focused. Clicking it focuses the field,
     * which widens in place and scrolls itself into view. For a toolbar with
     * no room for the whole bar.
     */
    collapsible?: boolean;
    /**
     * Size of the search bar.
     * - "small": 32px height (matches TextField small)
     * - "medium": 44px height (matches TextField medium)
     * @default "medium"
     */
    size?: "smallest" | "small" | "medium" | "large";
    innerClassName?: string;
    className?: string;
    autoFocus?: boolean;
    disabled?: boolean;
    loading?: boolean;
    inputRef?: React.Ref<HTMLInputElement>;
    /**
     * Optional initial value for the search input, e.g. from URL params.
     */
    initialValue?: string;
}

export function SearchBar({
    onClick,
    onTextSearch,
    placeholder,
    expandable = false,
    collapsible = false,
    size = "medium",
    innerClassName,
    className,
    autoFocus,
    disabled,
    loading,
    inputRef,
    initialValue
}: SearchBarProps) {

    const labels = useUiLabels();
    const placeholderText = placeholder ?? labels.search;

    const [searchText, setSearchText] = useState<string>(initialValue ?? "");
    const [active, setActive] = useState<boolean>(false);
    // Collapsed to an icon: empty and not being typed in.
    const idle = collapsible && !active && !searchText;

    const deferredValues = useDebounceValue(searchText, 200);

    /**
     * Debounce on SearchIcon text update
     */
    React.useEffect(() => {
        if (!onTextSearch) return;
        if (deferredValues) {
            onTextSearch(deferredValues);
        } else {
            onTextSearch(undefined);
        }
    }, [deferredValues]);

    const clearText = useCallback(() => {
        if (!onTextSearch) return;
        setSearchText("");
        onTextSearch(undefined);
    }, [onTextSearch]);

    // Height classes matching TextField sizes
    // Heights come from the shared control scale (styles.ts) so a SearchBar
    // lines up with the Button and Select beside it in a toolbar.
    const heightClass = { smallest: "h-[28px]", small: "h-[32px]", medium: "h-[40px]", large: "h-[48px]" }[size];
    const iconPaddingClass = size === "smallest" || size === "small" ? "px-2" : size === "medium" ? "px-3" : "px-4";
    const inputPaddingClass = size === "smallest" || size === "small" ? "pl-8" : size === "medium" ? "pl-10" : "pl-12";

    return (
        <div
            role="search"
            aria-label={labels.search}
            onClick={onClick}
            // Widened from an icon inside a scrolling toolbar, the field can
            // grow past the scroller's edge: bring it back once it has.
            onTransitionEnd={collapsible && active
                ? (event) => event.currentTarget.scrollIntoView({ block: "nearest", inline: "nearest" })
                : undefined}
            className={cls("relative transition-all",
                heightClass,
                // A field like any other: filled, with its border kept but
                // transparent so focus can colour it without moving anything.
                // Collapsed, it is drawn as the icon buttons beside it are.
                idle
                    ? "bg-transparent hover:bg-surface-hover border border-transparent rounded-full cursor-pointer"
                    : "bg-surface-field border border-transparent rounded-lg",
                "focus-within:ring-1 focus-within:ring-primary/60 focus-within:border-primary focus-within:shadow-[0_0_0_3px_rgba(0,112,244,0.1)]",
                "overflow-hidden",
                className)}>
            <div
                className={cls("absolute p-0 h-full pointer-events-none flex items-center justify-center top-0", iconPaddingClass)}>
                {loading
                    ? <CircularProgress size={"smallest"}/>
                    : idle
                        ? <SearchIcon className={"text-surface-accent-500 dark:text-surface-accent-300"} size={iconSize.smallest}/>
                        : <SearchIcon className={"text-text-disabled dark:text-text-disabled-dark"} size={size === "smallest" || size === "small" ? 14 : 18}/>}
            </div>
            <input
                value={searchText ?? ""}
                ref={inputRef}
                onClick={onClick}
                placeholder={placeholderText}
                aria-label={placeholderText}
                readOnly={!onTextSearch}
                disabled={disabled}
                onChange={onTextSearch
                    ? (event) => {
                        setSearchText(event.target.value);
                    }
                    : undefined}
                autoFocus={autoFocus}
                onFocus={() => setActive(true)}
                onBlur={() => setActive(false)}
                className={cls(
                    (disabled || loading) && "pointer-events-none",
                    "placeholder-text-disabled dark:placeholder-text-disabled-dark",
                    "relative flex items-center transition-all bg-transparent outline-none focus:outline-none focus:ring-0 appearance-none border-none focus:border-transparent",
                    inputPaddingClass, "h-full w-full text-current",
                    size === "smallest" || size === "small" ? "text-xs" : "",
                    collapsible
                        ? (idle ? "w-8 cursor-pointer placeholder-transparent dark:placeholder-transparent" : active ? "w-[200px]" : "w-[180px]")
                        : expandable ? (active ? "w-[220px]" : "w-[180px]") : "",
                    innerClassName
                )}
            />
            {searchText
                ? <IconButton
                    className={`${size === "small" ? "mr-0 top-0" : "mr-1 top-0"} absolute right-0 z-10`}
                    size={"small"}
                    aria-label={labels.clearSearch}
                    onClick={clearText}>
                    <XIcon size={iconSize.smallest}/>
                </IconButton>
                // Room for the clear button, so the field does not jump when
                // it appears. Not while collapsed: the icon is all there is.
                : !idle && <div style={{ width: 26 }}/>
            }
        </div>
    );
}
