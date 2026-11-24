
import React, { useMemo, useState } from "react";
import { Chip, cls, defaultBorderMixin, HeartIcon, IconButton, iconSize, SearchBar, Tab, Tabs, Trash2Icon, Typography } from "@rebasepro/ui";
import { useTranslation } from "@rebasepro/app";
import { SchemaBrowser } from "./SchemaBrowser";
import type { TableInfo } from "./sql_editor_types";

/** Who sees a snippet the project keeps: its owner, or everyone who opens the console. */
export type SnippetVisibility = "personal" | "team";

export interface Snippet {
    id: string;
    name: string;
    sql: string;
    createdAt: number;
    isFavorite?: boolean;
    /** Set for a snippet the project keeps; absent for one this browser keeps. */
    visibility?: SnippetVisibility;
    ownerId?: string;
}

interface SQLEditorSidebarProps {
    onSelectSnippet: (sql: string) => void;
    onTableClick: (tableName: string) => void;
    snippets: Snippet[];
    history: string[];
    onDeleteSnippet: (id: string) => void;
    onToggleFavorite?: (snippet: Snippet) => void;
    schemas: Record<string, TableInfo[]>;
    isSchemaLoading: boolean;
    schemaError: string | null;
    onRetrySchema: () => void;
}

/** One saved snippet: its name and first line, opened on click, with its own favorite and delete controls. */
function SnippetCard({ snippet, onSelect, onDelete, onToggleFavorite }: {
    snippet: Snippet;
    onSelect: (sql: string) => void;
    onDelete: (id: string) => void;
    onToggleFavorite?: (snippet: Snippet) => void;
}) {
    const { t } = useTranslation();
    return (
        <div
            className={cls("group p-2 rounded-lg border bg-surface-card hover:bg-surface-card-hover transition-colors cursor-pointer flex items-start gap-1", defaultBorderMixin)}
            onClick={() => onSelect(snippet.sql)}
        >
            <div className="min-w-0 flex-grow">
                <div className="flex items-center gap-1.5 min-w-0">
                    <Typography variant="body2" className="font-medium text-[13px] truncate">{snippet.name}</Typography>
                    {snippet.visibility === "team" && (
                        <Chip size="smallest" className="shrink-0">{t("studio_sql_snippet_team")}</Chip>
                    )}
                </div>
                <Typography variant="caption" color="secondary" className="text-xs block mt-1 truncate font-mono">{snippet.sql}</Typography>
            </div>
            {onToggleFavorite && (
                <IconButton
                    aria-label={snippet.isFavorite ? t("studio_sql_remove_from_favorites") : t("studio_sql_add_to_favorites")}
                    size="smallest"
                    onClick={(e) => {
                        e.stopPropagation();
                        onToggleFavorite(snippet);
                    }}
                >
                    <HeartIcon size={iconSize.smallest} fill={snippet.isFavorite ? "currentColor" : "none"} className={snippet.isFavorite ? "text-red-500" : "text-text-disabled dark:text-text-disabled-dark"}/>
                </IconButton>
            )}
            <IconButton
                aria-label={t("studio_sql_sidebar_delete_snippet")}
                size="smallest"
                className="text-text-disabled dark:text-text-disabled-dark hover:text-red-500"
                onClick={(e) => {
                    e.stopPropagation();
                    onDelete(snippet.id);
                }}
            >
                <Trash2Icon size={iconSize.smallest}/>
            </IconButton>
        </div>
    );
}

export const SQLEditorSidebar = ({
    onSelectSnippet,
    onTableClick,
    snippets,
    history,
    onDeleteSnippet,
    onToggleFavorite,
    schemas,
    isSchemaLoading,
    schemaError,
    onRetrySchema
}: SQLEditorSidebarProps) => {
    const [activeTab, setActiveTab] = useState<"schema" | "snippets" | "history">("schema");
    const [historySearch, setHistorySearch] = useState("");
    const { t } = useTranslation();
    const matchingHistory = useMemo(() => {
        const needle = historySearch.trim().toLowerCase();
        const newestFirst = [...history].reverse();
        return needle ? newestFirst.filter(sql => sql.toLowerCase().includes(needle)) : newestFirst;
    }, [history, historySearch]);

    return (
        <div className={cls("flex flex-col h-full w-full bg-surface-card border-r", defaultBorderMixin)}>
            <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as "schema" | "snippets" | "history")} variant="boxy" className="border-b border-hairline px-2 bg-surface-sheet shrink-0">
                <Tab value="schema">{t("studio_sql_sidebar_schema")}</Tab>
                <Tab value="snippets">{t("studio_sql_sidebar_snippets")}</Tab>
                <Tab value="history">{t("studio_sql_sidebar_history")}</Tab>
            </Tabs>

            <div className="flex-grow overflow-hidden relative">
                {activeTab === "schema" && (
                    <SchemaBrowser
                        onTableClick={onTableClick}
                        schemas={schemas}
                        isSchemaLoading={isSchemaLoading}
                        schemaError={schemaError}
                        onRetrySchema={onRetrySchema}
                    />
                )}

                {activeTab === "snippets" && (() => {
                    const favorites = snippets.filter(s => s.isFavorite);
                    const others = snippets.filter(s => !s.isFavorite);

                    return (
                        <div className="flex flex-col h-full">
                            <div className={cls("flex items-center justify-between px-3 py-2 border-b bg-surface-sheet h-10 shrink-0", defaultBorderMixin)}>
                                <Typography variant="caption" className="font-semibold uppercase tracking-wider text-text-disabled dark:text-text-disabled-dark">{t("studio_sql_sidebar_snippets")}</Typography>
                            </div>
                            <div className="flex-grow overflow-y-auto p-2 space-y-2 no-scrollbar">
                                {snippets.length === 0 ? (
                                    <div className="p-4 text-center">
                                        <Typography variant="caption" className="text-text-disabled dark:text-text-disabled-dark">{t("studio_sql_sidebar_no_snippets")}</Typography>
                                    </div>
                                ) : (
                                    <>
                                        {favorites.length > 0 && (
                                            <div className="mb-4">
                                                <Typography variant="caption" className="text-[10px] font-semibold uppercase tracking-wider text-text-disabled dark:text-text-disabled-dark mb-2 px-1 flex items-center">
                                                    <svg className="w-3 h-3 mr-1 text-red-500" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M3.172 5.172a4 4 0 015.656 0L10 6.343l1.172-1.171a4 4 0 115.656 5.656L10 17.657l-6.828-6.829a4 4 0 010-5.656z" clipRule="evenodd"/></svg>
                                                    {t("studio_sql_sidebar_favorites")}
                                                </Typography>
                                                <div className="space-y-2">
                                                    {favorites.map(snippet => (
                                                        <SnippetCard key={snippet.id} snippet={snippet} onSelect={onSelectSnippet} onDelete={onDeleteSnippet} onToggleFavorite={onToggleFavorite}/>
                                                    ))}
                                                </div>
                                            </div>
                                        )}
                                        {others.length > 0 && (
                                            <div>
                                                {favorites.length > 0 && (
                                                    <Typography variant="caption" className="text-[10px] font-semibold uppercase tracking-wider text-text-disabled dark:text-text-disabled-dark mb-2 px-1 mt-4">
                                                        {t("studio_sql_sidebar_other_snippets")}
                                                    </Typography>
                                                )}
                                                <div className="space-y-2">
                                                    {others.map(snippet => (
                                                        <SnippetCard key={snippet.id} snippet={snippet} onSelect={onSelectSnippet} onDelete={onDeleteSnippet} onToggleFavorite={onToggleFavorite}/>
                                                    ))}
                                                </div>
                                            </div>
                                        )}
                                    </>
                                )}
                            </div>
                        </div>
                    );
                })()}

                {activeTab === "history" && (
                    <div className="flex flex-col h-full">
                        <div className={cls("flex items-center justify-between px-3 py-2 border-b bg-surface-sheet h-10 shrink-0", defaultBorderMixin)}>
                            <Typography variant="caption" className="font-semibold uppercase tracking-wider text-text-disabled dark:text-text-disabled-dark">{t("studio_sql_sidebar_history")}</Typography>
                        </div>
                        {history.length > 0 && (
                            <div className="px-2 pt-2 shrink-0">
                                <SearchBar
                                    size="small"
                                    placeholder={t("studio_sql_sidebar_search_history")}
                                    onTextSearch={(value) => setHistorySearch(value ?? "")}
                                />
                            </div>
                        )}
                        <div className="flex-grow overflow-y-auto p-1 space-y-1 no-scrollbar">
                            {history.length === 0 ? (
                                <div className="p-4 text-center">
                                    <Typography variant="caption" className="text-text-disabled dark:text-text-disabled-dark">{t("studio_sql_sidebar_no_history")}</Typography>
                                </div>
                            ) : matchingHistory.length === 0 ? (
                                <div className="p-4 text-center">
                                    <Typography variant="caption" className="text-text-disabled dark:text-text-disabled-dark">{t("studio_sql_sidebar_no_history_match")}</Typography>
                                </div>
                            ) : (
                                matchingHistory.map((sql, i) => (
                                    <div
                                        key={i}
                                        className="p-2 py-1.5 rounded hover:bg-surface-hover cursor-pointer group transition-colors flex items-start"
                                        onClick={() => onSelectSnippet(sql)}
                                    >
                                        <svg className="w-3 h-3 mt-1 mr-2 text-text-disabled dark:text-text-disabled-dark group-hover:text-primary transition-colors flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
                                        <Typography variant="caption" className="text-text-secondary dark:text-text-secondary-dark group-hover:text-text-primary dark:group-hover:text-text-primary-dark text-xs line-clamp-2 leading-tight flex-grow">{sql}</Typography>
                                    </div>
                                ))
                            )}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};
