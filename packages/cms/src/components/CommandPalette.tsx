import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router";
import {
    useAdminModeController,
    useModeController,
    useRebaseRegistry
} from "@rebasepro/app";
import { useNavigationStateController } from "../hooks/navigation/contexts/NavigationStateContext";
import {
    cls,
    Dialog,
    isKeyHandled,
    MoonIcon,
    SearchIcon,
    SlidersHorizontalIcon,
    SunIcon,
    TableIcon,
    Typography
} from "@rebasepro/ui";

export interface CommandPaletteItem {
    id: string;
    label: string;
    group: "Collections" | "Navigation" | "Actions";
    hint?: string;
    icon: React.ReactNode;
    onSelect: () => void;
}

export interface CommandPaletteProps {
    /** Extra custom commands to include in the palette. */
    extraItems?: CommandPaletteItem[];
}

/**
 * Keyboard-first command palette (`⌘K` / `Ctrl+K`) for instant navigation
 * between collections, CMS/Studio mode switching, and theme toggling.
 *
 * Follows `@rebasepro/ui` Keyboard Ownership: listens in the bubble phase and
 * checks `isKeyHandled(event)` first so active overlays/editors keep priority.
 */
export function CommandPalette({ extraItems }: CommandPaletteProps = {}) {
    const [open, setOpen] = useState(false);
    const [query, setQuery] = useState("");
    const [activeIndex, setActiveIndex] = useState(0);
    const inputRef = useRef<HTMLInputElement | null>(null);

    const navigate = useNavigate();
    const navigation = useNavigationStateController();
    const adminMode = useAdminModeController();
    const themeMode = useModeController();
    const registry = useRebaseRegistry();

    const close = useCallback(() => {
        setOpen(false);
        setQuery("");
        setActiveIndex(0);
    }, []);

    useEffect(() => {
        const handleKeyDown = (event: KeyboardEvent) => {
            if (isKeyHandled(event)) return;
            if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
                event.preventDefault();
                setOpen((prev) => {
                    if (prev) {
                        setQuery("");
                        setActiveIndex(0);
                        return false;
                    }
                    return true;
                });
            }
        };
        window.addEventListener("keydown", handleKeyDown);
        return () => window.removeEventListener("keydown", handleKeyDown);
    }, []);

    const items = useMemo<CommandPaletteItem[]>(() => {
        const result: CommandPaletteItem[] = [];

        const entries = navigation.topLevelNavigation?.navigationEntries ?? [];
        for (const entry of entries) {
            result.push({
                id: `${entry.type}:${entry.slug}`,
                label: entry.name,
                group: entry.type === "collection" ? "Collections" : "Navigation",
                hint: entry.slug,
                icon: <TableIcon size="small" className="text-surface-500" />,
                onSelect: () => {
                    navigate(entry.url);
                    close();
                }
            });
        }

        const hasStudio = Boolean(registry.studioConfig);
        if (hasStudio) {
            const nextMode = adminMode.mode === "studio" ? "cms" : "studio";
            result.push({
                id: "action:toggle-admin-mode",
                label: nextMode === "studio" ? "Switch to Studio mode" : "Switch to CMS mode",
                group: "Actions",
                hint: nextMode.toUpperCase(),
                icon: <SlidersHorizontalIcon size="small" className="text-surface-500" />,
                onSelect: () => {
                    adminMode.setMode(nextMode);
                    navigate(nextMode === "studio" ? "/s" : "/");
                    close();
                }
            });
        }

        const nextTheme = themeMode.mode === "dark" ? "light" : "dark";
        result.push({
            id: "action:toggle-theme",
            label: nextTheme === "dark" ? "Switch to Dark theme" : "Switch to Light theme",
            group: "Actions",
            icon: nextTheme === "dark"
                ? <MoonIcon size="small" className="text-surface-500" />
                : <SunIcon size="small" className="text-surface-500" />,
            onSelect: () => {
                themeMode.setMode(nextTheme);
                close();
            }
        });

        if (extraItems?.length) {
            result.push(...extraItems);
        }

        return result;
    }, [navigation, registry.studioConfig, adminMode, themeMode, extraItems, navigate, close]);

    const filtered = useMemo(() => {
        const q = query.trim().toLowerCase();
        if (!q) return items;
        return items.filter(
            (item) =>
                item.label.toLowerCase().includes(q)
                || (item.hint && item.hint.toLowerCase().includes(q))
                || item.group.toLowerCase().includes(q)
        );
    }, [items, query]);

    const safeActiveIndex = filtered.length === 0 ? 0 : Math.min(activeIndex, filtered.length - 1);

    const handleInputKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
        if (event.key === "ArrowDown") {
            event.preventDefault();
            setActiveIndex((prev) => (filtered.length ? (prev + 1) % filtered.length : 0));
        } else if (event.key === "ArrowUp") {
            event.preventDefault();
            setActiveIndex((prev) => (filtered.length ? (prev - 1 + filtered.length) % filtered.length : 0));
        } else if (event.key === "Enter" && filtered[safeActiveIndex]) {
            event.preventDefault();
            filtered[safeActiveIndex].onSelect();
        }
    };

    return (
        <Dialog
            open={open}
            onOpenChange={(next) => {
                if (!next) close();
                else setOpen(true);
            }}
            dismissOnBackdrop={true}
            initialFocus={inputRef}
            maxWidth="md"
        >
            <div className="flex flex-col overflow-hidden bg-surface-card rounded-xl">
                <div className="flex items-center gap-3 px-4 py-3 border-b border-hairline">
                    <SearchIcon size="small" className="text-surface-500 shrink-0" />
                    <input
                        ref={inputRef}
                        type="text"
                        value={query}
                        onChange={(e) => {
                            setQuery(e.target.value);
                            setActiveIndex(0);
                        }}
                        onKeyDown={handleInputKeyDown}
                        placeholder="Jump to collection or run action…"
                        aria-label="Command palette search"
                        className="w-full bg-transparent text-sm text-text-primary dark:text-text-primary-dark placeholder:text-surface-500 outline-none"
                    />
                    <kbd className="rounded px-1.5 py-0.5 text-[11px] font-mono bg-surface-raised text-surface-500 shrink-0">
                        Esc
                    </kbd>
                </div>
                <div
                    role="listbox"
                    aria-label="Command results"
                    className="max-h-[340px] overflow-y-auto p-1.5"
                >
                    {filtered.length === 0 ? (
                        <div className="px-3 py-6 text-center">
                            <Typography variant="body2" color="secondary">
                                No matching collections or actions.
                            </Typography>
                        </div>
                    ) : (
                        filtered.map((item, index) => {
                            const selected = index === safeActiveIndex;
                            return (
                                <button
                                    key={item.id}
                                    type="button"
                                    role="option"
                                    aria-selected={selected}
                                    onMouseEnter={() => setActiveIndex(index)}
                                    onClick={item.onSelect}
                                    className={cls(
                                        "w-full flex items-center justify-between gap-3 px-3 py-2 rounded-lg text-left transition-colors duration-100",
                                        selected ? "bg-surface-active" : "hover:bg-surface-hover"
                                    )}
                                >
                                    <span className="flex items-center gap-2.5 min-w-0">
                                        {item.icon}
                                        <Typography variant="body2" className="truncate font-medium">
                                            {item.label}
                                        </Typography>
                                    </span>
                                    <span className="flex items-center gap-2 shrink-0">
                                        {item.hint && (
                                            <Typography variant="caption" color="secondary" className="font-mono">
                                                {item.hint}
                                            </Typography>
                                        )}
                                        <Typography variant="caption" color="secondary">
                                            {item.group}
                                        </Typography>
                                    </span>
                                </button>
                            );
                        })
                    )}
                </div>
            </div>
        </Dialog>
    );
}
