import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
    Dashboard,
    DashboardFilterConfig,
    DashboardItem,
    DashboardPage,
    DashboardUpdateType,
    DateParams,
    FilterOp,
    ParamFilter,
    Position,
    WidgetSize
} from "../types";

export interface DashboardState {
    dashboard: Dashboard;
    page: DashboardPage;
    params: DateParams;
    paramFilters: ParamFilter[];
    setParamFilters: (paramFilters: ParamFilter[]) => void;
    filters: DashboardFilterConfig[];
    widgetErrors: Map<string, Error>;
    readOnly: boolean;
    onUndo: () => void;
    onRedo: () => void;
    onNodesDelete: (ids: string[]) => void;
    onNodeResize: (widgetId: string, params: { position: Position, size: WidgetSize }) => void;
    onPaperResize: (size: WidgetSize) => void;
    onWidgetError: (widget: DashboardItem, error: Error | null) => void;
    updateStateAndHistory: (newWidgets: DashboardItem[], updateType: DashboardUpdateType, prevWidgets?: DashboardItem[]) => void;
    onWidgetEdit: (widget: DashboardItem, error?: Error) => void;
    onFilterValueChange: (key: string, value: any, operator?: FilterOp) => void;
    canUndo: boolean;
    canRedo: boolean;
    dashboardContainerRef: React.RefObject<HTMLDivElement | null>;
}

export function useCreateDashboardState({
    dashboard,
    page,
    onWidgetsUpdate,
    params,
    paramFilters,
    setParamFilters,
    filters,
    readOnly,
    onPaperResize,
    dashboardContainerRef,
    onWidgetEdit
}: {
    dashboard: Dashboard;
    page: DashboardPage;
    onWidgetsUpdate: (widgets: DashboardItem[], updateType: DashboardUpdateType) => void;
    params: DateParams,
    paramFilters: ParamFilter[];
    setParamFilters: (paramFilters: ParamFilter[]) => void;
    filters: DashboardFilterConfig[];
    readOnly: boolean,
    onPaperResize: (size: WidgetSize) => void,
    onWidgetEdit: (widget: DashboardItem, error?: Error) => void;
    dashboardContainerRef?: React.RefObject<HTMLDivElement | null>
}): DashboardState {

    const [undoStack, setUndoStack] = useState<Array<{ widgets: DashboardItem[], updateType: DashboardUpdateType }>>([]);
    const [redoStack, setRedoStack] = useState<Array<{ widgets: DashboardItem[], updateType: DashboardUpdateType }>>([]);

    const canUndo = undoStack.length > 0;
    const canRedo = redoStack.length > 0;

    const widgetErrors = useRef<Map<string, Error>>(new Map());

    const onWidgetError = (widget: DashboardItem, error: Error | null) => {
        if (!widget.id) {
            throw new Error("onWidgetError: Widget ID is not defined");
        }
        if (error === null) {
            widgetErrors.current.delete(widget.id);
        } else {
            widgetErrors.current.set(widget.id, error);
        }
    };

    const updateStateAndHistory = useCallback((newWidgets: DashboardItem[], updateType: DashboardUpdateType, prevWidgets?: DashboardItem[]) => {
        const beforeWidgets = prevWidgets ?? page.widgets.map((widget) => deepCopy(widget));
        // Store both the widgets AND the update type that's being performed
        setUndoStack(prev => [...prev, { widgets: beforeWidgets, updateType }]);
        setRedoStack([]); // Clear redo stack when new action is performed
        onWidgetsUpdate(newWidgets, updateType);
    }, [page.widgets, onWidgetsUpdate]);

    const onUndo = useCallback(() => {
        if (undoStack.length === 0) return;
        const undoEntry = undoStack[undoStack.length - 1];
        if (undoEntry) {
            const currentWidgets = page.widgets.map((widget) => deepCopy(widget));
            // Get the current update type from the last action
            const currentUpdateType = undoEntry.updateType;

            // Push current state to redo stack with the update type
            setRedoStack(prev => [...prev, { widgets: currentWidgets, updateType: currentUpdateType }]);
            setUndoStack(prev => prev.slice(0, -1));

            // Restore previous state using the original update type
            onWidgetsUpdate(undoEntry.widgets, undoEntry.updateType);
        }
    }, [undoStack, page.widgets, onWidgetsUpdate]);

    const onRedo = useCallback(() => {
        if (redoStack.length === 0) return;
        const redoEntry = redoStack[redoStack.length - 1];
        if (redoEntry) {
            const currentWidgets = page.widgets.map((widget) => deepCopy(widget));
            // Get the update type from the redo entry
            const currentUpdateType = redoEntry.updateType;

            // Push current state to undo stack with the update type
            setUndoStack(prev => [...prev, { widgets: currentWidgets, updateType: currentUpdateType }]);
            setRedoStack(prev => prev.slice(0, -1));

            // Restore redo state using the original update type
            onWidgetsUpdate(redoEntry.widgets, redoEntry.updateType);
        }
    }, [redoStack, page.widgets, onWidgetsUpdate]);

    const onNodesDelete = useCallback((ids: string[]) => {
        const newWidgets = page.widgets.filter(
            (widget) => !ids.some((id) => id === widget.id)
        );
        updateStateAndHistory(newWidgets, "widgets_remove");
    }, [page.widgets, updateStateAndHistory]);

    useEffect(() => {
        const handleKeyDown = (event: KeyboardEvent) => {
            // Check if the active element is a text input field
            const isEditableElement = (element: Element | null): boolean => {
                if (!element) return false;

                const tagName = element.tagName.toLowerCase();
                const isContentEditable = element.hasAttribute("contenteditable") &&
                    element.getAttribute("contenteditable") !== "false";

                return (
                    tagName === "input" ||
                    tagName === "textarea" ||
                    tagName === "select" ||
                    isContentEditable
                );
            };

            // Don't handle shortcuts when focus is on an editable element
            if (isEditableElement(document.activeElement)) {
                return;
            }

            const isMac = /Mac|iPod|iPhone|iPad/.test(navigator.userAgent);
            const isCmdOrCtrl = isMac ? event.metaKey : event.ctrlKey;

            if (event.key === "z" && isCmdOrCtrl) {
                console.log("Undo/Redo shortcut detected", { shiftKey: event.shiftKey, undoStack, canUndo, canRedo });
                if (event.shiftKey && canRedo) {
                    onRedo();
                    event.preventDefault();
                } else if (!event.shiftKey && canUndo) {
                    onUndo();
                    event.preventDefault();
                }
            }
        };

        window.addEventListener("keydown", handleKeyDown);
        return () => {
            window.removeEventListener("keydown", handleKeyDown);
        };
    }, [canUndo, canRedo, onUndo, onRedo]);

    const onNodeResize = useCallback((widgetId: string, params: { position: Position, size: WidgetSize }) => {
        const beforeWidgets = page.widgets.map((widget) => deepCopy(widget));
        const updatedWidgets = page.widgets.map((widget) => {
            if (widget.id === widgetId) {
                return {
                    ...widget,
                    position: params.position,
                    size: params.size
                };
            }
            return widget;
        });
        updateStateAndHistory(updatedWidgets, "widget_resize", beforeWidgets);
    }, [page.widgets, updateStateAndHistory]);

    const onFilterValueChange = useCallback((key: string, value: any, operator?: FilterOp) => {
        const existingFilterIndex = paramFilters.findIndex(f => f.key === key);
        const filterConfig = filters.find(f => f.key === key);

        let newParamFilters: ParamFilter[];
        if (existingFilterIndex >= 0) {
            newParamFilters = paramFilters.map((f, idx) =>
                idx === existingFilterIndex
                    ? { ...f, value, operator: operator as FilterOp | undefined }
                    : f
            );
        } else {
            newParamFilters = [
                ...paramFilters,
                {
                    key,
                    value,
                    operator: operator as FilterOp | undefined,
                    type: filterConfig?.type
                }
            ];
        }

        setParamFilters(newParamFilters);
    }, [paramFilters, filters, setParamFilters]);

    return useMemo(() => ({
        dashboard,
        page,
        params,
        paramFilters,
        setParamFilters,
        filters,
        widgetErrors: widgetErrors.current,
        readOnly,
        onNodesDelete,
        onUndo,
        onRedo,
        updateStateAndHistory,
        onNodeResize,
        onPaperResize,
        onWidgetError,
        onWidgetEdit,
        onFilterValueChange,
        canUndo,
        canRedo,
        dashboardContainerRef: dashboardContainerRef ?? { current: null }
    }), [
        dashboard,
        page,
        params,
        paramFilters,
        setParamFilters,
        filters,
        readOnly,
        onNodesDelete,
        onUndo,
        onRedo,
        updateStateAndHistory,
        onNodeResize,
        onPaperResize,
        onWidgetEdit,
        onFilterValueChange,
        canUndo,
        canRedo,
        dashboardContainerRef
    ]);
}

function deepCopy<T>(obj: T): T {
    if (obj === null || typeof obj !== "object") {
        return obj;
    }

    if (Array.isArray(obj)) {
        const arrCopy = [] as any[];
        for (const item of obj) {
            arrCopy.push(deepCopy(item));
        }
        return arrCopy as any;
    }

    const objCopy = {} as { [key in keyof T]: T[key] };
    for (const key in obj) {
        if (Object.prototype.hasOwnProperty.call(obj, key)) {
            objCopy[key] = deepCopy(obj[key]);
        }
    }
    return objCopy;
}

