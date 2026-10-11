
"use client";

import React from "react";
import { defaultBorderMixin } from "../styles";
import { cls } from "../util";

export type TableProps = {
    children: React.ReactNode;
    className?: string;
    style?: React.CSSProperties;
} & React.TableHTMLAttributes<HTMLTableElement>;

export const Table = React.memo(({
                          children,
                          className,
                          style,
                          ...rest
                      }: TableProps) => (
    <table
        className={cls("text-left text-text-primary dark:text-text-primary-dark rounded-lg overflow-x-auto", className)}
        style={style}
        {...rest}
    >
        {children}
    </table>
));

export type TableBodyProps = {
    children?: React.ReactNode;
    className?: string;
} & React.HTMLAttributes<HTMLTableSectionElement>;

export const TableBody = React.memo(({
                              children,
                              className,
                              ...rest
                          }: TableBodyProps) => (
    <tbody
        className={cls("bg-surface-card text-sm divide-y divide-hairline", className)}
        {...rest}
    >
    {children}
    </tbody>
));

export type TableHeaderProps = {
    children?: React.ReactNode;
    className?: string;
} & React.HTMLAttributes<HTMLTableSectionElement>;

/**
 * True for a cell rendered inside {@link TableHeader}, so it renders as a
 * column header (`th scope="col"`) without having to pass `header`.
 */
const TableHeaderContext = React.createContext(false);

export const TableHeader = React.memo(({
                                children,
                                className,
                                ...rest
                            }: TableHeaderProps) => (
    <thead {...rest}>
    <tr
        className={cls(
            defaultBorderMixin,
            "text-sm font-medium text-surface-700 dark:text-surface-accent-300",
            "bg-surface-sheet border-b",
            className
        )}
    >
        <TableHeaderContext.Provider value={true}>
            {children}
        </TableHeaderContext.Provider>
    </tr>
    </thead>
));

export type TableRowProps = {
    children?: React.ReactNode;
    className?: string;
    onClick?: React.MouseEventHandler<HTMLTableRowElement>;
    style?: React.CSSProperties;
    /** The rendered `<tr>`, e.g. for an IntersectionObserver. */
    ref?: React.Ref<HTMLTableRowElement>;
} & React.HTMLAttributes<HTMLTableRowElement>;

export const TableRow = React.memo(({
                             children,
                             className,
                             onClick,
                             style,
                             ref,
                             ...rest
                         }: TableRowProps) => (
    <tr
        ref={ref}
        onClick={onClick}
        style={style}
        className={cls(
            "bg-surface-card",
            onClick ? "transition-colors duration-150 hover:bg-surface-card-hover cursor-pointer" : "",
            className
        )}
        {...rest}
    >
        {children}
    </tr>
));

export type TableCellProps = {
    children?: React.ReactNode;
    /** Render as a header cell (`th`). Implied inside {@link TableHeader}. */
    header?: boolean;
    /** Defaults to `col` for a cell inside {@link TableHeader}. */
    scope?: string;
    className?: string;
    style?: React.CSSProperties;
    align?: "left" | "center" | "right";
    colspan?: number;
} & React.HTMLAttributes<HTMLTableCellElement>;

export const TableCell = React.memo(({
                              children,
                              header = false,
                              scope,
                              align,
                              className,
                              style,
                              colspan,
                              ...rest
                          }: TableCellProps) => {
    const inHeader = React.useContext(TableHeaderContext);
    const isHeader = header || inHeader;
    const Tag = isHeader ? "th" : "td";
    return (
        <Tag
            scope={scope ?? (inHeader ? "col" : undefined)}
            colSpan={colspan}
            style={style}
            className={cls(
                "px-4 py-3 text-clip ",
                align === "center" ? "text-center" : (align === "right" ? "text-right" : "text-left"),
                className
            )}
            {...rest}
        >
            {children}
        </Tag>
    );
});

Table.displayName = "Table";
TableBody.displayName = "TableBody";
TableHeader.displayName = "TableHeader";
TableRow.displayName = "TableRow";
TableCell.displayName = "TableCell";
