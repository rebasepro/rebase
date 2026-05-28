
"use client";
import { SearchIcon, XIcon } from "lucide-react";
import { iconSize } from "../icons/Icon";
import React, { useCallback, useState } from "react";

import { defaultBorderMixin } from "../styles";
import { CircularProgress, IconButton } from "./index";

import { cls } from "../util";
import { useDebounceValue } from "../hooks";

interface SearchBarProps {
    onClick?: () => void;
    onTextSearch?: (searchString?: string) => void;
    placeholder?: string;
    expandable?: boolean;
    /**
     * Size of the search bar.
     * - "small": 32px height (matches TextField small)
     * - "medium": 44px height (matches TextField medium)
     * @default "medium"
     */
    size?: "smallest" | "small" | "medium";
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
    placeholder = "Search",
    expandable = false,
    size = "medium",
    innerClassName,
    className,
    autoFocus,
    disabled,
    loading,
    inputRef,
    initialValue
}: SearchBarProps) {

    const [searchText, setSearchText] = useState<string>(initialValue ?? "");
    const [active, setActive] = useState<boolean>(false);

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
    const heightClass = size === "smallest" ? "h-8" : size === "small" ? "h-[36px]" : "h-[44px]";
    const iconPaddingClass = size === "smallest" ? "px-2" : size === "small" ? "px-2" : "px-4";
    const inputPaddingClass = size === "smallest" ? "pl-8" : size === "small" ? "pl-8" : "pl-12";

    return (
        <div
            role="search"
            aria-label="Search"
            onClick={onClick}
            className={cls("relative transition-all",
                heightClass,
                "bg-surface-accent-50 dark:bg-surface-900 border",
                defaultBorderMixin,
                "focus-within:ring-1 focus-within:ring-primary/60 focus-within:border-primary focus-within:shadow-[0_0_0_3px_rgba(0,112,244,0.1)]",
                "rounded-lg overflow-hidden",
                className)}>
            <div
                className={cls("absolute p-0 h-full pointer-events-none flex items-center justify-center top-0", iconPaddingClass)}>
                {loading ? <CircularProgress size={"smallest"}/> : <SearchIcon className={"text-text-disabled dark:text-text-disabled-dark"} size={size === "smallest" ? 14 : size === "small" ? 18 : 20}/>}
            </div>
            <input
                value={searchText ?? ""}
                ref={inputRef as any}
                onClick={onClick}
                placeholder={placeholder}
                aria-label={placeholder}
                readOnly={!onTextSearch}
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
                    size === "small" ? "text-sm" : "",
                    expandable ? (active ? "w-[220px]" : "w-[180px]") : "",
                    innerClassName
                )}
            />
            {searchText
                ? <IconButton
                    className={`${size === "small" ? "mr-0 top-0" : "mr-1 top-0"} absolute right-0 z-10`}
                    size={"small"}
                    aria-label="Clear search"
                    onClick={clearText}>
                    <XIcon size={iconSize.smallest}/>
                </IconButton>
                : <div style={{ width: 26 }}/>
            }
        </div>
    );
}
