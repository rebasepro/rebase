import { Trash2 } from "lucide-react";
import React, { useEffect, useRef, useState } from "react";
import { TextItem } from "../../../types";
import { cls, IconButton, Tooltip } from "@rebasepro/ui";
import { useDataki } from "../../../DatakiContext";
// Removed unused import

type GridTextWrapperProps = {
    widget: TextItem;
    dashboardId: string;
    pageId: string;
    readOnly: boolean;
};

export default function GridTextWrapper({
    widget,
    dashboardId,
    pageId,
    readOnly,
    onNodesDelete
}: GridTextWrapperProps & { onNodesDelete: (widgetIds: string[]) => void }) {
    const datakiConfig = useDataki();

    const [text, setText] = useState<string>(widget.text);
    const [isFocused, setIsFocused] = useState(false);
    const [isDragging, setIsDragging] = useState(false);
    const [isHovered, setIsHovered] = useState(false);
    const [isMenuHovered, setIsMenuHovered] = useState(false);
    const hoverHideTimeoutRef = useRef<NodeJS.Timeout | null>(null);
    const timeoutRef = useRef<NodeJS.Timeout | null>(null);
    const textareaRef = useRef<HTMLTextAreaElement | null>(null);

    // Debounced save - wait 500ms after user stops typing
    useEffect(() => {
        if (text !== widget.text) {
            if (timeoutRef.current) {
                clearTimeout(timeoutRef.current);
            }

            timeoutRef.current = setTimeout(() => {
                datakiConfig.updateDashboardText(dashboardId, pageId, widget.id, {
                    ...widget,
                    text
                });
            }, 500);

            return () => {
                if (timeoutRef.current) {
                    clearTimeout(timeoutRef.current);
                }
            };
        }
        return undefined;
    }, [text, widget, dashboardId, pageId, datakiConfig]);

    // Auto-resize textarea to fit content with single-line compact height
    useEffect(() => {
        if (textareaRef.current) {
            const ta = textareaRef.current;
            // Reset to auto to measure
            ta.style.height = "auto";
            const computed = window.getComputedStyle(ta);
            const lineHeight = parseFloat(computed.lineHeight || "0");
            let scrollHeight = ta.scrollHeight;
            // Estimated number of lines
            const approxLines = lineHeight > 0 ? Math.round(scrollHeight / lineHeight) : 1;
            // If content is logically single-line (no newline) but browser reports 2 lines, force one line
            if (!text.includes("\n") && approxLines > 1) {
                scrollHeight = lineHeight; // collapse to a single line
            }
            // Fallback minimum one line
            const finalHeight = Math.max(scrollHeight, lineHeight || 20) + 8;
            ta.style.height = `${finalHeight}px`;
        }
    }, [text]);

    let textClass: string;
    if (widget.type === "title") {
        textClass = "typography-h3";
    } else if (widget.type === "subtitle") {
        textClass = "typography-h5";
    } else {
        textClass = "text-body";
    }

    return (
        <div
            className={cls(
                textClass,
                "relative group w-full h-full flex flex-col px-2 pt-2 pb-0 rounded-lg transition-colors",
                isFocused ? "bg-surface-accent-100 dark:bg-surface-accent-800 ring-2 ring-primary/50" : "",
                !readOnly && "hover:bg-surface-accent-100 dark:hover:bg-surface-accent-800"
            )}
            style={{
                fontFamily: "var(--dataki-font-family)",
                color: "var(--dataki-text)",
            } as React.CSSProperties}
            onMouseEnter={() => {
                if (hoverHideTimeoutRef.current) {
                    clearTimeout(hoverHideTimeoutRef.current);
                    hoverHideTimeoutRef.current = null;
                }
                setIsHovered(true);
            }}
            onMouseLeave={() => {
                if (hoverHideTimeoutRef.current) {
                    clearTimeout(hoverHideTimeoutRef.current);
                }
                hoverHideTimeoutRef.current = setTimeout(() => {
                    setIsHovered(false);
                    if (isDragging) setIsDragging(false);
                }, 140);
            }}
            onMouseDown={() => setIsDragging(true)}
            onMouseUp={() => {
                // Reset dragging state and force blur any hover state
                setIsDragging(false);
            }}
        >
            {/* Toolbar menu - absolutely positioned above the text with hover bridge */}
            {!readOnly && !isDragging && (
                <div
                    onMouseEnter={() => {
                        if (hoverHideTimeoutRef.current) {
                            clearTimeout(hoverHideTimeoutRef.current);
                            hoverHideTimeoutRef.current = null;
                        }
                        setIsMenuHovered(true);
                    }}
                    onMouseLeave={() => setIsMenuHovered(false)}
                    onMouseDown={(e) => {
                        e.stopPropagation();
                    }}
                    onMouseUp={(e) => {
                        e.stopPropagation();
                    }}
                    className={cls(
                        "absolute -top-10 right-0 z-50 nodrag",
                        (isHovered || isFocused || isMenuHovered) ? "flex" : "hidden"
                    )}>
                    {/* Invisible bridge to prevent menu from disappearing when moving mouse */}
                    <div className="absolute top-full right-0 w-full h-6" />

                    <div
                        className="flex flex-row items-center gap-1 bg-white/95 dark:bg-surface-950/95 rounded-lg p-1 shadow-sm backdrop-blur-sm border border-surface-200/40 dark:border-surface-700/40">
                        <Tooltip title={"Remove this text"}>
                            <IconButton size={"small"}
                                onClick={() => {
                                    console.log("Removing text widget", widget.id);
                                    onNodesDelete([widget.id]);
                                }}>
                                <Trash2 size={"small"} />
                            </IconButton>
                        </Tooltip>
                    </div>
                </div>
            )}

            {readOnly ? (
                <div
                    style={{
                        width: "100%",
                        overflow: "auto"
                    }}
                    className="flex-1 overflow-auto flex flex-col justify-end"
                >
                    <div>{text || ""}</div>
                </div>
            ) : (
                <div
                    className={cls("w-full flex-1 flex flex-col justify-end")}
                    onClick={(e) => {
                        // Focus the textarea on click if not already focused
                        if (!isFocused) {
                            const textarea = e.currentTarget.querySelector("textarea");
                            if (textarea) {
                                textarea.focus();
                            }
                        }
                    }}
                >
                    <textarea
                        ref={textareaRef}
                        rows={1}
                        value={text}
                        className={cls( isFocused ? "nodrag" : "")}
                        style={{
                            width: "100%",
                            resize: "none",
                            border: "none",
                            background: "transparent",
                            outline: "none",
                            borderRadius: "6px",
                            fontFamily: "inherit",
                            fontSize: "inherit",
                            lineHeight: "1.2",
                            color: "inherit",
                            overflow: "hidden",
                            boxSizing: "border-box",
                            padding: 0,
                            margin: 0,
                            boxShadow: "none"
                        }}
                        placeholder={"Click to edit"}
                        onFocus={() => setIsFocused(true)}
                        onBlur={() => setIsFocused(false)}
                        onChange={(e) => {
                            setText(e.target.value);
                        }}
                    />
                </div>
            )}
        </div>
    );
}
