import React from "react";

import { coolIconKeys, debounce, IconButton, iconKeys, SearchBar, Tooltip, iconSize } from "@rebasepro/ui";
import { icons as lucideIcons } from "lucide-react";
import { iconsSearch, iconSynonyms } from "@rebasepro/core";
import { useTranslation } from "@rebasepro/core";

const UPDATE_SEARCH_INDEX_WAIT_MS = 220;

if (iconSynonyms && process.env.NODE_ENV !== "production") {
    Object.keys(iconSynonyms).forEach((icon: string) => {
        if (!iconKeys.includes(icon)) {
            console.warn(`The icon ${icon} no longer exists. Remove it from \`iconSynonyms\``);
        }
    });
}

function toPascalCase(str: string): string {
    return str.split(/[-_]/).map(word => word.charAt(0).toUpperCase() + word.slice(1)).join('');
}

function resolveIcon(iconKey: string): React.ComponentType<{ size: number }> | null {
    const allIcons = lucideIcons as Record<string, React.ComponentType<{ size: number }>>;
    let icon = allIcons[iconKey];
    if (!icon) {
        icon = allIcons[toPascalCase(iconKey)];
    }
    return icon ?? null;
}

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
                {icons.map((icon: string) => {
                    const LucideIcon = resolveIcon(icon);
                    if (!LucideIcon) return null;
                    return (
                        <Tooltip title={icon} key={icon}
                            asChild={true}>
                            <IconButton
                                shape={"square"}
                                toggled={selectedIcon === icon}
                                onClick={onIconSelected ? () => onIconSelected(icon) : undefined}
                                className="box-content m-1"
                            >
                                <LucideIcon size={iconSize.medium}/>
                            </IconButton>
                        </Tooltip>
                    );
                })}
            </div>
        </>
    );
}
