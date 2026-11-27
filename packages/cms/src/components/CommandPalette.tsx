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
    iconSize,
    isKeyHandled,
    MoonIcon,
    SearchIcon,
    SlidersHorizontalIcon,
    SunIcon,
    TableIcon,
    Typography
} from "@rebasepro/ui";

export const OPEN_COMMAND_PALETTE_EVENT = "rebase:open-command-palette";

export function openCommandPalette(): void {
    if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent(OPEN_COMMAND_PALETTE_EVENT));
    }
}

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
        const handleOpenEvent = () => setOpen(true);
        window.addEventListener("keydown", handleKeyDown);
        window.addEventListener(OPEN_COMMAND_PALETTE_EVENT, handleOpenEvent);
        return () => {
            window.removeEventListener("keydown", handleKeyDown);
            window.removeEventListener(OPEN_COMMAND_PALETTE_EVENT, handleOpenEvent);
        };
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
                icon: <TableIcon size={iconSize.small} className="text-surface-500 shrink-0" />,
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
                icon: <SlidersHorizontalIcon size={iconSize.small} className="text-surface-500 shrink-0" />,
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
                ? <MoonIcon size={iconSize.small} className="text-surface-500 shrink-0" />
                : <SunIcon size={iconSize.small} className="text-surface-500 shrink-0" />,
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

    const grouped = useMemo(() => {
        const order: CommandPaletteItem["group"][] = ["Collections", "Navigation", "Actions"];
        const map = new Map<CommandPaletteItem["group"], Array<{ item: CommandPaletteItem; flatIndex: number }>>();
        filtered.forEach((item, flatIndex) => {
            const list = map.get(item.group) ?? [];
            list.push({ item, flatIndex });
            map.set(item.group, list);
        });
        return order
            .filter((group) => (map.get(group)?.length ?? 0) > 0)
            .map((group) => ({ group, entries: map.get(group)! }));
    }, [filtered]);

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
                    <SearchIcon size={iconSize.small} className="text-surface-500 shrink-0" />
                    <input
                        ref={inputRef}
                        type="text"
                        value={query}
                        onChange={(e) => {
                            setQuery(e.target.value);
                            setActiveIndex(0);
                        }}
                        onKeyDown={handleInputKeyDown}
                        placeholder="Type a command or jump to collection…"
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
                    className="max-h-[340px] overflow-y-auto p-1.5 space-y-2"
                >
                    {filtered.length === 0 ? (
                        <div className="px-3 py-8 text-center">
                            <Typography variant="body2" color="secondary">
                                No matching collections or actions.
                            </Typography>
                        </div>
                    ) : (
                        grouped.map(({ group, entries }) => (
                            <div key={group} className="space-y-0.5">
                                <div className="px-2.5 pt-1 pb-0.5">
                                    <Typography
                                        variant="caption"
                                        className="text-[11px] font-medium uppercase tracking-wider text-text-disabled dark:text-text-disabled-dark"
                                    >
                                        {group}
                                    </Typography>
                                </div>
                                {entries.map(({ item, flatIndex }) => {
                                    const selected = flatIndex === safeActiveIndex;
                                    return (
                                        <button
                                            key={item.id}
                                            type="button"
                                            role="option"
                                            aria-selected={selected}
                                            onMouseEnter={() => setActiveIndex(flatIndex)}
                                            onClick={item.onSelect}
                                            className={cls(
                                                "w-full h-[34px] flex items-center justify-between gap-3 px-2.5 rounded-lg text-left transition-colors duration-100",
                                                selected ? "bg-surface-active" : "hover:bg-surface-hover"
                                            )}
                                        >
                                            <span className="flex items-center gap-2.5 min-w-0">
                                                {item.icon}
                                                <Typography variant="body2" className="text-[13px] truncate font-medium">
                                                    {item.label}
                                                </Typography>
                                            </span>
                                            <span className="flex items-center gap-2 shrink-0">
                                                {item.hint && (
                                                    <Typography variant="caption" color="secondary" className="font-mono text-[11px]">
                                                        {item.hint}
                                                    </Typography>
                                                )}
                                                {selected && (
                                                    <kbd className="rounded px-1 py-0.5 text-[10px] leading-none font-mono bg-surface-raised text-surface-500">
                                                        ↵
                                                    </kbd>
                                                )}
                                            </span>
                                        </button>
                                    );
                                })}
                            </div>
                        ))
                    )}
                </div>
                <div className="flex items-center justify-between px-3.5 py-2 border-t border-hairline bg-surface-sheet">
                    <Typography variant="caption" color="secondary" className="text-[11px]">
                        ↑↓ navigate · ↵ open · esc close
                    </Typography>
                    <Typography variant="caption" color="secondary" className="text-[11px] font-mono">
                        ⌘K
                    </Typography>
                </div>
            </div>
        </Dialog>
    );
}
