/**
 * @jest-environment jsdom
 */
import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import { ListView, CardView, TableView, KanbanView, BoardItem, BoardItemViewProps } from "../src";

// Mock react-use-measure so virtualized elements measure a fixed container size in tests
jest.mock("react-use-measure", () => {
    return () => [
        () => {},
        {
            width: 800,
            height: 600,
            top: 0,
            left: 0,
            bottom: 0,
            right: 0,
            x: 0,
            y: 0
        }
    ];
});

// Mock ResizeObserver for container resizing triggers
global.ResizeObserver = class ResizeObserver {
    callback: any;
    constructor(callback: any) {
        this.callback = callback;
    }
    observe() {}
    unobserve() {}
    disconnect() {}
};

// Mock item data type
interface TestItem {
    id: string;
    name: string;
    status: "todo" | "doing" | "done";
}

const mockData: TestItem[] = [
    { id: "1", name: "Task 1", status: "todo" },
    { id: "2", name: "Task 2", status: "doing" },
    { id: "3", name: "Task 3", status: "done" }
];

describe("Decoupled UI Views", () => {

    describe("ListView Component", () => {
        const renderRowMock = jest.fn(({ item, onClick, onSelectionChange, selected }) => (
            <div
                data-testid={`row-${item.id}`}
                onClick={onClick}
                className={selected ? "selected-row" : ""}
            >
                <span>{item.name}</span>
                <button
                    data-testid={`select-${item.id}`}
                    onClick={(e) => {
                        e.stopPropagation();
                        onSelectionChange(true);
                    }}
                >
                    Select
                </button>
            </div>
        ));

        beforeEach(() => {
            renderRowMock.mockClear();
        });

        it("renders standard list items", () => {
            render(
                <ListView<TestItem>
                    data={mockData}
                    renderRow={renderRowMock}
                />
            );

            expect(screen.getByText("Task 1")).toBeInTheDocument();
            expect(screen.getByText("Task 2")).toBeInTheDocument();
            expect(screen.getByText("Task 3")).toBeInTheDocument();
            expect(renderRowMock.mock.calls.length).toBeGreaterThanOrEqual(3);
        });

        it("displays custom emptyComponent when data is empty", () => {
            render(
                <ListView<TestItem>
                    data={[]}
                    renderRow={renderRowMock}
                    emptyComponent={<div data-testid="empty-view">No tasks found</div>}
                />
            );

            expect(screen.getByTestId("empty-view")).toBeInTheDocument();
            expect(screen.queryByText("Task 1")).not.toBeInTheDocument();
        });

        it("displays loading indicator when dataLoading is true", () => {
            render(
                <ListView<TestItem>
                    data={mockData}
                    dataLoading={true}
                    renderRow={renderRowMock}
                />
            );

            // CircularProgress displays standard spinner/animation elements
            const spinners = document.getElementsByClassName("animate-spin");
            expect(spinners.length).toBeGreaterThan(0);
        });

        it("handles onItemClick successfully", () => {
            const handleItemClick = jest.fn();
            render(
                <ListView<TestItem>
                    data={mockData}
                    renderRow={renderRowMock}
                    onItemClick={handleItemClick}
                />
            );

            const row = screen.getByTestId("row-1");
            fireEvent.click(row);
            expect(handleItemClick).toHaveBeenCalledWith(mockData[0]);
        });

        it("marks rows as selected based on selectedIds", () => {
            const selectedIds = new Set(["1", "3"]);
            render(
                <ListView<TestItem>
                    data={mockData}
                    renderRow={renderRowMock}
                    selectedIds={selectedIds}
                />
            );

            expect(screen.getByTestId("row-1")).toHaveClass("selected-row");
            expect(screen.getByTestId("row-2")).not.toHaveClass("selected-row");
            expect(screen.getByTestId("row-3")).toHaveClass("selected-row");
        });

        it("handles onSelectionChange callback when checkbox/toggle is triggered", () => {
            const handleSelectionChange = jest.fn();
            render(
                <ListView<TestItem>
                    data={mockData}
                    renderRow={renderRowMock}
                    onSelectionChange={handleSelectionChange}
                />
            );

            const selectButton = screen.getByTestId("select-2");
            fireEvent.click(selectButton);
            expect(handleSelectionChange).toHaveBeenCalledWith(mockData[1], true);
        });
    });

    describe("CardView Component", () => {
        const renderCardMock = jest.fn((item, { selected, onSelectionChange, onClick }) => (
            <div
                data-testid={`card-${item.id}`}
                onClick={onClick}
                className={selected ? "selected-card" : ""}
            >
                <h3>{item.name}</h3>
                <button
                    data-testid={`card-select-${item.id}`}
                    onClick={(e) => {
                        e.stopPropagation();
                        onSelectionChange(true);
                    }}
                >
                    Toggle Select
                </button>
            </div>
        ));

        beforeEach(() => {
            renderCardMock.mockClear();
        });

        it("renders items as cards", () => {
            render(
                <CardView<TestItem>
                    data={mockData}
                    renderCard={renderCardMock}
                />
            );

            expect(screen.getByText("Task 1")).toBeInTheDocument();
            expect(screen.getByText("Task 2")).toBeInTheDocument();
            expect(screen.getByText("Task 3")).toBeInTheDocument();
            expect(renderCardMock.mock.calls.length).toBeGreaterThanOrEqual(3);
        });

        it("displays custom emptyComponent when empty", () => {
            render(
                <CardView<TestItem>
                    data={[]}
                    renderCard={renderCardMock}
                    emptyComponent={<div data-testid="empty-cards">Empty Grid</div>}
                />
            );

            expect(screen.getByTestId("empty-cards")).toBeInTheDocument();
        });

        it("marks card as selected and triggers selection events", () => {
            const handleSelection = jest.fn();
            render(
                <CardView<TestItem>
                    data={mockData}
                    renderCard={renderCardMock}
                    selectedIds={new Set(["2"])}
                    onSelectionChange={handleSelection}
                />
            );

            expect(screen.getByTestId("card-1")).not.toHaveClass("selected-card");
            expect(screen.getByTestId("card-2")).toHaveClass("selected-card");

            const toggleBtn = screen.getByTestId("card-select-3");
            fireEvent.click(toggleBtn);
            expect(handleSelection).toHaveBeenCalledWith(mockData[2], true);
        });
    });

    describe("TableView Component", () => {
        const columns = [
            { key: "id", title: "ID", width: 100 },
            { key: "name", title: "Name", width: 200 }
        ];

        const cellRendererMock = jest.fn(({ cellData }) => (
            <div data-testid="table-cell">{String(cellData)}</div>
        ));

        beforeEach(() => {
            cellRendererMock.mockClear();
        });

        it("renders TableView with headers and cell data", () => {
            render(
                <TableView<any>
                    data={mockData as any}
                    columns={columns}
                    cellRenderer={cellRendererMock}
                />
            );

            // Verify header title exists in the DOM
            expect(screen.getByText("ID")).toBeInTheDocument();
            expect(screen.getByText("Name")).toBeInTheDocument();
        });
    });

    describe("KanbanView Component", () => {
        const columns: ("todo" | "doing" | "done")[] = ["todo", "doing", "done"];
        const columnLabels = {
            todo: "To Do Column",
            doing: "In Progress Column",
            done: "Finished Column"
        };

        const boardData: BoardItem<TestItem>[] = mockData.map(item => ({
            id: item.id,
            data: item
        }));

        const ItemComponentMock = jest.fn(({ item }) => (
            <div data-testid={`kanban-item-${item.id}`}>
                {item.data.name}
            </div>
        ));

        beforeEach(() => {
            ItemComponentMock.mockClear();
        });

        it("renders board columns with titles and places items into respective columns", () => {
            render(
                <KanbanView<TestItem, "todo" | "doing" | "done">
                    columns={columns}
                    columnLabels={columnLabels}
                    data={boardData}
                    assignColumn={(item) => item.data.status}
                    ItemComponent={ItemComponentMock}
                />
            );

            // Columns headers check
            expect(screen.getByText("To Do Column")).toBeInTheDocument();
            expect(screen.getByText("In Progress Column")).toBeInTheDocument();
            expect(screen.getByText("Finished Column")).toBeInTheDocument();

            // Rendered cards check
            expect(screen.getByTestId("kanban-item-1")).toBeInTheDocument();
            expect(screen.getByTestId("kanban-item-2")).toBeInTheDocument();
            expect(screen.getByTestId("kanban-item-3")).toBeInTheDocument();
        });

        it("renders loading state on specific columns when provided", () => {
            const columnLoadingState = {
                todo: { loading: true, hasMore: false, itemCount: 0 },
                doing: { loading: false, hasMore: false, itemCount: 1 },
                done: { loading: false, hasMore: false, itemCount: 1 }
            };

            render(
                <KanbanView<TestItem, "todo" | "doing" | "done">
                    columns={columns}
                    columnLabels={columnLabels}
                    data={boardData}
                    assignColumn={(item) => item.data.status}
                    ItemComponent={ItemComponentMock}
                    columnLoadingState={columnLoadingState}
                />
            );

            // The todo column should show circular progress
            const spinners = document.getElementsByClassName("animate-spin");
            expect(spinners.length).toBeGreaterThan(0);
        });
    });
});
