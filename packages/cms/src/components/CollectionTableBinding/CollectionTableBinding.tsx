import type { AdditionalFieldDelegate, AdminCollection } from "@rebasepro/cms-types";
import { AdditionalFieldValue } from "../AdditionalFieldValue";
import React, { useCallback, useContext, useMemo, useRef } from "react";
import { Entity, User, Property } from "@rebasepro/types";
import { CollectionSize, RebaseContext } from "@rebasepro/cms-types";
import { PropertyTableCell } from "./PropertyTableCell";
import { ErrorBoundary } from "@rebasepro/ui";
import { useRebaseContext, useLargeLayout, useCollectionScope } from "@rebasepro/app";
import { CellRendererParams, VirtualTableColumn } from "@rebasepro/ui";
import { CollectionRowActions } from "./CollectionRowActions";
import { CollectionTableToolbar } from "./internal/CollectionTableToolbar";
import { CollectionTableBindingProps } from "./CollectionTableBindingProps";
import { EntityTableCell } from "./internal/EntityTableCell";
import { CustomFieldValidator } from "../../form/validation";
import { renderSkeletonText } from "../../preview";
import { propertiesToColumns } from "./column_utils";
import { ErrorView } from "@rebasepro/app";
import { SelectableTable } from "../SelectableTable/SelectableTable";
import { cls } from "@rebasepro/ui";
import { getRowHeight, isDisabled } from "@rebasepro/app";
import { getValueInPath } from "@rebasepro/utils";
import { deepEqual as equal } from "fast-equals";

/**
 * This component is in charge of rendering a collection table with a high
 * degree of customization.
 *
 * This component is used internally by {@link CollectionViewBinding} and
 * {@link useReferenceDialog}
 *
 * Please note that you only need to use this component if you are building
 * a custom view. If you just need to create a default view you can do it
 * exclusively with config options.
 *
 * If you want to bind a {@link AdminCollection} to a table with the default
 * options you see in collections in the top level navigation, you can
 * check {@link CollectionViewBinding}.
 *
 * The data displayed in the table is managed by a {@link EntityTableController}.
 * You can build the default, bound to a path in the driver, by using the hook
 * {@link useDataTableController}
 *
 * @see CollectionTableBindingProps
 * @see CollectionViewBinding
 * @see VirtualTable
 * @group Components
 */
export const CollectionTableBinding = function CollectionTableBinding<M extends Record<string, unknown> = Record<string, unknown>, USER extends User = User>
    ({
        className,
        style,
        fixedFilter,
        actionsStart,
        actions,
        viewModeToggle,
        title,
        tableRowActionsBuilder,
        uniqueFieldValidator,
        getPropertyFor,
        onValueChange,
        selectionController,
        highlightedEntities,
        onEntityClick,
        onColumnResize,
        initialScroll,
        onScroll,
        onSizeChanged,

        hoverRow = true,
        inlineEditing = false,
        additionalFields,
        displayedColumnIds,
        defaultSize,
        properties,
        tableController,
        filterable = true,
        sortable = true,
        endAdornment,
        AddColumnComponent,
        AdditionalHeaderWidget,
        additionalIDHeaderWidget,
        emptyComponent,
        getIdColumnWidth,
        enablePopupIcon,
        openEntityMode = "side_panel",
        onColumnsOrderChange,
        hideToolbar = false
    }: CollectionTableBindingProps<M>) {

    const ref = useRef<HTMLDivElement>(null);

    const largeLayout = useLargeLayout();
    // Asked per row rather than held as a list: a query selection has no list,
    // and the one this replaced would have answered with whatever the view had
    // scrolled. `highlightedEntities` is the fallback the table has always had
    // — the row you navigated to, shown lit when nothing is selected.
    const hasSelection = Boolean(selectionController?.hasSelection);
    const isRowHighlighted = useCallback((entity: Entity<M>) => {
        if (hasSelection) return selectionController!.isEntitySelected(entity);
        return Boolean(highlightedEntities?.some(e => e && e.id === entity.id && e.path === entity.path));
    }, [hasSelection, selectionController, highlightedEntities]);

    // What the row actions are drawn from besides their row. Handed down by
    // context rather than through the cell renderer, so that a change here
    // draws the id column of each row and nothing else: it used to be the
    // cells' memo key, and ticking one checkbox re-ran the renderer of every
    // cell on screen (~460) to redraw the one column that shows a selection.
    //
    // The selection and the highlighted rows are dependencies, not fields: a
    // builder may read either from its closure, and a change to them has to
    // reach the actions it built. The highlighted rows by identity, not by
    // array: a caller passing a new `[]` each render changes nothing.
    const highlightedKey = JSON.stringify(highlightedEntities?.map(e => e ? [e.path, e.id] : null) ?? []);
    const rowActionsContext: RowActionsContextValue<M> = useMemo(() => ({
        tableRowActionsBuilder,
        openEntityMode
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }), [tableRowActionsBuilder, openEntityMode, selectionController?.selection, highlightedKey]);

    const context: RebaseContext<USER> = useRebaseContext<USER>();

    const [size, setSize] = React.useState<CollectionSize>(defaultSize ?? "m");

    // Sync internal size with defaultSize prop when it changes
    React.useEffect(() => {
        if (defaultSize) {
            setSize(defaultSize);
        }
    }, [defaultSize]);

    const updateSize = useCallback((size: CollectionSize) => {
        if (onSizeChanged)
            onSizeChanged(size);
        setSize(size);
    }, []);

    const onTextSearch = useCallback((newSearchString?: string) => tableController.setSearchString?.(newSearchString), []);

    const additionalFieldsMap: Record<string, AdditionalFieldDelegate<M, USER>> = useMemo(() => {
        return (additionalFields
            ? additionalFields
                .map((aC) => ({ [aC.key]: aC as AdditionalFieldDelegate<M, USER> }))
                .reduce((a, b) => ({ ...a,
...b }), {})
            : {}) as Record<string, AdditionalFieldDelegate<M, USER>>;
    }, [additionalFields]);

    const customFieldValidator: CustomFieldValidator | undefined = uniqueFieldValidator;

    const propertyCellRenderer = useCallback(({
        column,
        columnIndex,
        rowData,
        rowIndex,
        sortableNodeRef,
        sortableStyle,
        sortableAttributes,
        isDragging,
        isDraggable,
        frozen
    }: CellRendererParams<Entity<M>>) => {

        const entity: Entity<M> | undefined = rowData;
        if (!entity) return null;

        const propertyKey = column.key;

        const columnCustom = column.custom as { disabled?: boolean; resolvedProperty?: Property } | undefined;
        let disabled: boolean = columnCustom?.disabled ?? false;
        const property = getPropertyFor?.({
            propertyKey,
            entity
        }) ?? columnCustom?.resolvedProperty;
        if (!property || !isDisabled(property)) {
            disabled = false;
        }

        if (!property) {
            return null;
        }

        return (
            <ErrorBoundary>
                {entity
                    ? <PropertyTableCell
                        key={`property_table_cell_${entity.id}_${propertyKey}`}
                        readonly={!inlineEditing}
                        align={column.align ?? "left"}
                        propertyKey={propertyKey as string}
                        property={property}
                        value={entity?.values ? getValueInPath(entity.values, propertyKey) : undefined}
                        customFieldValidator={customFieldValidator}
                        columnIndex={columnIndex}
                        width={column.width}
                        height={getRowHeight(size)}
                        entity={entity}
                        disabled={disabled}
                        enablePopupIcon={enablePopupIcon}
                        path={entity.path}
                        sortableNodeRef={sortableNodeRef}
                        sortableStyle={sortableStyle}
                        sortableAttributes={sortableAttributes}
                        isDragging={isDragging}
                        isDraggable={isDraggable}
                        frozen={frozen}/>
                    : renderSkeletonText()
                }
            </ErrorBoundary>);

    }, [getPropertyFor, customFieldValidator, inlineEditing, enablePopupIcon, size]);

    const additionalCellRenderer = useCallback(({
        column,
        rowData,
        width,
        sortableNodeRef,
        sortableStyle,
        sortableAttributes,
        isDragging,
        isDraggable,
        frozen
    }: CellRendererParams<Entity<M>>) => {

        const entity: Entity<M> | undefined = rowData;
        if (!entity) return null;

        const additionalField = additionalFieldsMap[column.key as string];
        const value = additionalField.dependencies
            ? Object.entries(entity.values)
                .filter(([key, value]) => additionalField.dependencies!.includes(key as Extract<keyof M, string>))
                .reduce((a, b) => ({ ...a,
...b }), {})
            : entity;

        const Builder = additionalField.Builder;
        if (!Builder && !additionalField.value) {
            throw new Error("When using additional fields you need to provide a Builder or a value");
        }

        const child: React.ReactNode = Builder
            ? <Builder entity={entity} context={context}/>
            : <AdditionalFieldValue
                field={additionalField}
                entity={entity}
                context={context as RebaseContext}/>;

        return (
            <EntityTableCell
                key={`additional_table_cell_${entity.id}_${column.key}`}
                width={width}
                size={size}
                value={value}
                selected={false}
                disabled={true}
                align={"left"}
                allowScroll={false}
                showExpandIcon={false}
                disabledTooltip={"This column can't be edited directly"}
                sortableNodeRef={sortableNodeRef}
                sortableStyle={sortableStyle}
                sortableAttributes={sortableAttributes as Record<string, string | number | undefined>}
                isDragging={isDragging}
                isDraggable={isDraggable}
                frozen={frozen}
            >
                <ErrorBoundary>
                    {child}
                </ErrorBoundary>
            </EntityTableCell>
        );

    }, [size, additionalFieldsMap, context]);

    // Same source the filter fields read their engine from, so the header's
    // filter control and the field it opens cannot disagree about what the
    // collection's driver can answer.
    const engine = useCollectionScope()?.engine;

    const collectionColumns: VirtualTableColumn[] = useMemo(() => {
        const columnsResult: VirtualTableColumn[] = propertiesToColumns({
            properties,
            sortable,
            fixedFilter,
            engine,
            AdditionalHeaderWidget
        });

        // Get keys from property columns to filter out duplicate additional fields
        const propertyColumnKeys = new Set(columnsResult.map(col => col.key));

        const additionalTableColumns: VirtualTableColumn[] = additionalFields
            // Filter out additional fields whose key already exists in property columns
            ? additionalFields
                .filter((additionalField) => !propertyColumnKeys.has(additionalField.key))
                .map((additionalField) =>
                ({
                    key: additionalField.key,
                    align: "left",
                    sortable: false,
                    title: additionalField.name,
                    width: additionalField.width ?? 200
                }))
            : [];
        return [...columnsResult, ...additionalTableColumns];
    }, [properties, sortable, fixedFilter, engine, AdditionalHeaderWidget, additionalFields]);

    // Held by value: the widget is an element, and a caller that builds it
    // inline hands over a new one on every render. Each new one rebuilt the
    // id column, so the table's columns, so every cell on screen.
    const idHeaderWidgetRef = useRef(additionalIDHeaderWidget);
    if (idHeaderWidgetRef.current !== additionalIDHeaderWidget && !equal(idHeaderWidgetRef.current, additionalIDHeaderWidget)) {
        idHeaderWidgetRef.current = additionalIDHeaderWidget;
    }
    const stableIdHeaderWidget = idHeaderWidgetRef.current;

    const idColumn: VirtualTableColumn = useMemo(() => ({
        key: "id_ewcfedcswdf3",
        width: getIdColumnWidth?.() ?? (largeLayout ? 140 : 120),
        title: "ID",
        resizable: false,
        frozen: largeLayout,
        headerAlign: "center",
        align: "center",
        AdditionalHeaderWidget: () => stableIdHeaderWidget
    }), [getIdColumnWidth, largeLayout, stableIdHeaderWidget]);

    const columns: VirtualTableColumn[] = useMemo(() => [
        idColumn,
        ...(displayedColumnIds
            ? displayedColumnIds
                .map((p) => {
                    return collectionColumns.find(c => c.key === p.key);
                }).filter(Boolean)
            : collectionColumns) as VirtualTableColumn[]
    ], [idColumn, displayedColumnIds, collectionColumns]);

    const cellRenderer = useCallback((props: CellRendererParams<Entity<M>>) => {
        const column = props.column;
        const columns = props.columns;
        const columnKey = column.key;

        // A row that exists but has not been read: above a scroll position
        // the view came back to, until it is scrolled to.
        if (!props.rowData) {
            return <div className="w-full h-full flex items-center px-4" style={{ width: column.width }} aria-busy={true}>
                {renderSkeletonText(undefined, Math.min(120, Math.max(24, column.width - 32)))}
            </div>;
        }

        try {
            if (props.columnIndex === 0) {
                return <TableRowActions entity={props.rowData!}
                    size={size}
                    width={column.width}
                    frozen={column.frozen}
                    sortableNodeRef={props.sortableNodeRef}
                    sortableStyle={props.sortableStyle}
                    sortableAttributes={props.sortableAttributes}
                    isDragging={props.isDragging}
                    isDraggable={props.isDraggable}/>;
            } else if (additionalFieldsMap[columnKey]) {
                return additionalCellRenderer(props);
            } else if (props.columnIndex < columns.length + 1) {
                return propertyCellRenderer(props);
            } else {
                throw Error("Internal: columns not mapped properly");
            }
        } catch (e: unknown) {
            console.error("Error rendering cell", e);
            return <EntityTableCell
                size={size}
                width={column.width}
                savedTimestamp={undefined}
                value={null}
                align={"left"}
                fullHeight={false}
                disabled={true}
                sortableNodeRef={props.sortableNodeRef}
                sortableStyle={props.sortableStyle}
                sortableAttributes={props.sortableAttributes as Record<string, string | number | undefined>}
                isDragging={props.isDragging}
                isDraggable={props.isDraggable}
                frozen={props.frozen}>
                <ErrorView error={e instanceof Error ? e : new Error(String(e))}/>
            </EntityTableCell>;
        }
    }, [additionalFieldsMap, additionalCellRenderer, propertyCellRenderer, size]);

    return (

        <div ref={ref}
            style={style}
            className={cls("h-full w-full flex flex-col bg-surface-card", className)}>

            {!hideToolbar && <CollectionTableToolbar
                onTextSearch={onTextSearch}
                title={title}
                actionsStart={actionsStart}
                actions={actions}
                viewModeToggle={viewModeToggle}
                loading={tableController.dataLoading}/>}

            <RowActionsContext.Provider value={rowActionsContext as RowActionsContextValue<Record<string, unknown>>}>
            <SelectableTable columns={columns}
                size={size}
                inlineEditing={inlineEditing}
                cellRenderer={cellRenderer}
                onEntityClick={onEntityClick}
                highlightedRow={isRowHighlighted}
                tableController={tableController}
                onValueChange={onValueChange}
                initialScroll={initialScroll}
                onScroll={onScroll}
                onColumnResize={onColumnResize}
                hoverRow={hoverRow}
                filterable={filterable}
                emptyComponent={emptyComponent}
                endAdornment={endAdornment}
                AddColumnComponent={AddColumnComponent}
                onColumnsOrderChange={onColumnsOrderChange}/>
            </RowActionsContext.Provider>

        </div>
    );

};

type RowActionsContextValue<M extends Record<string, unknown>> = {
    tableRowActionsBuilder: CollectionTableBindingProps<M>["tableRowActionsBuilder"];
    openEntityMode: NonNullable<CollectionTableBindingProps<M>["openEntityMode"]>;
};

const RowActionsContext = React.createContext<RowActionsContextValue<Record<string, unknown>>>({
    tableRowActionsBuilder: undefined,
    openEntityMode: "side_panel"
});

/**
 * The first cell of a row: its actions, from the table's builder or the
 * default ones. Reads the builder from context, so a new builder or a new
 * selection redraws this cell in every row and leaves the property cells
 * alone.
 */
function TableRowActions<M extends Record<string, unknown>>({
    entity,
    size,
    width,
    frozen,
    sortableNodeRef,
    sortableStyle,
    sortableAttributes,
    isDragging,
    isDraggable
}: {
    entity: Entity<M>;
    size: CollectionSize;
    width: number;
    frozen?: boolean;
    sortableNodeRef?: (node: HTMLElement | null) => void;
    sortableStyle?: React.CSSProperties;
    sortableAttributes?: Record<string, unknown>;
    isDragging?: boolean;
    isDraggable?: boolean;
}) {
    const { tableRowActionsBuilder, openEntityMode } = useContext(RowActionsContext) as RowActionsContextValue<M>;
    if (tableRowActionsBuilder)
        return <>{tableRowActionsBuilder({
            entity,
            size,
            width,
            frozen
        })}</>;
    return <CollectionRowActions entity={entity}
        width={width}
        frozen={frozen}
        isSelected={false}
        size={size}
        openEntityMode={openEntityMode}
        sortableNodeRef={sortableNodeRef}
        sortableStyle={sortableStyle}
        sortableAttributes={sortableAttributes}
        isDragging={isDragging}
        isDraggable={isDraggable}/>;
}
