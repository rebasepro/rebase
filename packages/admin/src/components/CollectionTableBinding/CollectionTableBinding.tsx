import type { AdditionalFieldDelegate, AdminCollection } from "@rebasepro/admin-types";
import { AdditionalFieldValue } from "../AdditionalFieldValue";
import React, { useCallback, useMemo, useRef } from "react";
import { Entity, User, Property } from "@rebasepro/types";
import { CollectionSize, RebaseContext } from "@rebasepro/admin-types";
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
    const selectedEntities = useMemo(() => {
        return (selectionController?.selectedEntities?.length > 0 ? selectionController?.selectedEntities : highlightedEntities)?.filter(Boolean);
    }, [selectionController?.selectedEntities, highlightedEntities]);

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

    }, [size]);

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

    const idColumn: VirtualTableColumn = useMemo(() => ({
        key: "id_ewcfedcswdf3",
        width: getIdColumnWidth?.() ?? (largeLayout ? 140 : 120),
        title: "ID",
        resizable: false,
        frozen: largeLayout,
        headerAlign: "center",
        align: "center",
        AdditionalHeaderWidget: () => additionalIDHeaderWidget
    }), [getIdColumnWidth, largeLayout, additionalIDHeaderWidget]);

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

        try {
            if (props.columnIndex === 0) {
                if (tableRowActionsBuilder)
                    return tableRowActionsBuilder({
                        entity: props.rowData!,
                        size,
                        width: column.width,
                        frozen: column.frozen
                    });
                else
                    return <CollectionRowActions entity={props.rowData!}
                        width={column.width}
                        frozen={column.frozen}
                        isSelected={false}
                        size={size}
                        openEntityMode={openEntityMode}
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
    }, [tableRowActionsBuilder, additionalCellRenderer, propertyCellRenderer, size]);

    return (

        <div ref={ref}
            style={style}
            className={cls("h-full w-full flex flex-col bg-white dark:bg-surface-900", className)}>

            {!hideToolbar && <CollectionTableToolbar
                onTextSearch={onTextSearch}
                title={title}
                actionsStart={actionsStart}
                actions={actions}
                viewModeToggle={viewModeToggle}
                loading={tableController.dataLoading}/>}

            <SelectableTable columns={columns}
                size={size}
                inlineEditing={inlineEditing}
                cellRenderer={cellRenderer}
                onEntityClick={onEntityClick}
                highlightedRow={useCallback((entity: Entity<M>) => Boolean(selectedEntities?.find(e => e.id === entity.id && e.path === entity.path)), [selectedEntities])}
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
                onColumnsOrderChange={onColumnsOrderChange}
                extraData={useMemo(() => ({ selectedEntityIds: selectedEntities?.map(e => e.id) }), [selectedEntities])}/>

        </div>
    );

};
