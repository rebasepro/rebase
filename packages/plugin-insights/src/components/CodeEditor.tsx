import { cls } from "@rebasepro/ui";
import { useModeController } from "@rebasepro/core";

import * as monaco from "monaco-editor";
import { editor } from "monaco-editor";

import { useEffect, useRef, useState } from "react";
import { Parser } from "node-sql-parser";
import IStandaloneCodeEditor = editor.IStandaloneCodeEditor;

const parser = new Parser();

monaco.editor.defineTheme("vs-dark-custom", {
    base: "vs-dark",
    inherit: true,
    rules: [],
    colors: {
        "editor.background": "#18181c"
    }
});

export type CodeEditorProps = {
    value?: string;
    autoHeight?: boolean;
    onChange?: (value?: string) => void;
    onMount?: (editor: any) => void;
    maxWidth?: number;
    loading?: boolean;
    defaultLanguage: string;
    sqlDialect?: string;
    onTextSelection?: (text: string) => void;
    disabled?: boolean;
};

export function CodeEditor({
    value,
    autoHeight,
    onChange,
    maxWidth,
    loading,
    defaultLanguage,
    sqlDialect,
    onTextSelection,
    disabled, // Destructured disabled prop
    ...props
}: CodeEditorProps) {

    const editorRef = useRef<IStandaloneCodeEditor | null>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const initialised = useRef(false);
    const [height, setHeight] = useState("100%");
    const { mode } = useModeController();

    useEffect(() => {
        if (containerRef.current && !initialised.current) {
            initialised.current = true;
            editorRef.current = monaco.editor.create(containerRef.current, {
                value,
                theme: mode === "dark" ? "vs-dark-custom" : "light",
                language: defaultLanguage,
                scrollBeyondLastLine: false,
                minimap: { enabled: false },
                readOnly: loading || disabled, // Updated readOnly
                wordWrap: "on",
                wrappingStrategy: "advanced",
                overviewRulerLanes: 0,
                scrollbar: {
                    vertical: "hidden",
                    alwaysConsumeMouseWheel: false
                }
            });
            editorRef.current.onDidContentSizeChange(updateSize);
            editorRef.current?.getModel()?.onDidChangeContent((event) => {
                onChangeInternal(editorRef.current?.getValue());
            });
            updateSize();
        }
    }, []);

    // Update readOnly option when disabled or loading prop changes
    useEffect(() => {
        if (editorRef.current) {
            editorRef.current.updateOptions({ readOnly: loading || disabled });
        }
    }, [disabled, loading]);

    // Update editor value when value prop changes
    useEffect(() => {
        if (editorRef.current && value !== undefined) {
            const currentValue = editorRef.current.getValue();
            if (currentValue !== value) {
                editorRef.current.setValue(value);
            }
        }
    }, [value]);

    // add size observer to container
    useEffect(() => {
        if (containerRef.current) {
            const resizeObserver = new ResizeObserver(() => {
                updateSize();
            });
            resizeObserver.observe(containerRef.current);
            return () => {
                resizeObserver.disconnect();
            };
        }
        return undefined;
    }, [containerRef.current]);

    function onChangeInternal(value?: string) {
        if (disabled) return; // Do not call onChange if disabled
        onChange?.(value);
        updateSize();
        if (value && defaultLanguage === "sql") {
            parseAndValidateSQL(value);
        }
    }

    const updateSize = () => {
        const contentWidth = editorRef.current?.getContentWidth();
        const contentHeight = editorRef.current?.getContentHeight();
        if (!contentWidth || !contentHeight) {
            return;
        }
        // measure container width
        const containerWidth = containerRef.current?.clientWidth;
        const containerHeight = containerRef.current?.clientHeight;

        editorRef.current?.layout({
            width: containerWidth!,
            height: autoHeight ? contentHeight : containerHeight!
        });
        setHeight(contentHeight + "px");
    };

    const parseAndValidateSQL = (sql: string) => {
        if (!sqlDialect) {
            throw new Error("CodeEditor: sqlDialect is required when language is sql");
        }
        const markers = [];

        try {
            parser.astify(sql, {
                database: sqlDialect
            });
        } catch (e: any) {
            const { location } = e;
            if (location) {
                markers.push({
                    startLineNumber: location.start.line,
                    startColumn: location.start.column,
                    endLineNumber: location.end.line,
                    endColumn: location.end.column,
                    message: e.message,
                    severity: monaco.MarkerSeverity.Error
                });
            }
        }
        const model = editorRef.current?.getModel();
        if (model)
            monaco.editor.setModelMarkers(model, "sql", markers);
    };

    return <div
        ref={containerRef}
        style={{
            height: autoHeight ? height : "100%",
            width: "100%"
        }}
        className={cls("rounded-xl flex-1 border border-surface-100 dark:border-surface-800/80 min-h-[48px]", {
            "overflow-hidden": autoHeight,
            "overflow-auto h-full": !autoHeight
        })}
    />
}
