import React from "react";

import {
    coolIconKeys,
    debounce,
    IconButton,
    iconSize,
    LucideIconByName,
    SearchBar,
    Tooltip
} from "@rebasepro/ui";
import { iconsSearch } from "@rebasepro/app";
import { useTranslation } from "@rebasepro/app";

const UPDATE_SEARCH_INDEX_WAIT_MS = 220;

export interface SearchIconsProps {
    selectedIcon?: string;
    onIconSelected?: (icon: string) => void;
}

export function SearchIconsView({
    selectedIcon = "",
    onIconSelected
}: SearchIconsProps) {
    const { t } = useTranslation();
    const [keys, setKeys] = React.useState<string[] | null>(null);
    const [query, setQuery] = React.useState<string>("");

    const updateSearchResults = React.useMemo(() =>
        debounce((value: string) => {
            if (!value || value === "") {
                setKeys(null);
            } else {
                const searchResult = iconsSearch.search(value);
                const limit = 50;
                const limited = searchResult.slice(0, limit);
                setKeys(limited.map((e) => e.item.key));
            }
        }, UPDATE_SEARCH_INDEX_WAIT_MS), []
    );

    React.useEffect(() => {
        updateSearchResults(query);
        return () => {
            updateSearchResults.clear();
        };
    }, [query, updateSearchResults]);

    const icons = keys === null ? coolIconKeys : keys;

    return (
        <>
            <SearchBar
                autoFocus={false}
                innerClassName={"w-full sticky top-0 z-10"}
                onTextSearch={(value?: string) => setQuery(value ?? "")}
                placeholder={t("search_for_more_icons")}
            />

            <div className={"flex max-w-full flex-wrap mt-4"}>
                {icons.map((icon: string) => (
                    <Tooltip title={icon} key={icon}
                        asChild={true}>
                        <IconButton
                            shape={"square"}
                            toggled={selectedIcon === icon}
                            onClick={onIconSelected ? () => onIconSelected(icon) : undefined}
                            className="box-content m-1"
                        >
                            <LucideIconByName name={icon} size={iconSize.medium}/>
                        </IconButton>
                    </Tooltip>
                ))}
            </div>
        </>
    );
}
