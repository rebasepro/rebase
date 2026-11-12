// @ts-nocheck — a frozen legacy input of the plan-golden corpus: see plan-corpus-legacy/legacy-model.ts.
import customersCollection from "./customers";
import type { PostgresCollectionConfig } from "../../legacy-model";
import { fullName, included, joinParts } from "../display";
import { updateRecord } from "../actions";

const ticketsCollection: PostgresCollectionConfig = {
    name: "Tickets",
    singularName: "Ticket",
    slug: "tickets",
    table: "tickets",
    history: true,
    properties: {
        id: {
            name: "ID",
            type: "string",
            isId: "uuid"
        },
        ticket_number: {
            name: "Ticket #",
            type: "string",
            validation: {
                required: true,
                unique: true
            },
            description: "Human-readable ticket identifier (e.g. TK-2025-0042)"
        },
        subject: {
            name: "Subject",
            type: "string",
            validation: {
                required: true
            },
            description: "Brief summary of the issue or request"
        },
        description: {
            name: "Description",
            type: "string",
            admin: { markdown: true },
            description: "Detailed description of the ticket in Markdown"
        },
        resolution_notes: {
            name: "Resolution Notes",
            type: "string",
            admin: { markdown: true },
            description: "Internal notes about how the issue was resolved"
        },
        status: {
            name: "Status",
            type: "string",
            validation: {
                required: true
            },
            defaultValue: "open",
            enum: [
                {
                    id: "open",
                    label: "Open",
                    color: "blue"
                },
                {
                    id: "in_progress",
                    label: "In Progress",
                    color: "orange"
                },
                {
                    id: "waiting",
                    label: "Waiting on Customer",
                    color: "yellow"
                },
                {
                    id: "resolved",
                    label: "Resolved",
                    color: "green"
                },
                {
                    id: "closed",
                    label: "Closed",
                    color: "gray"
                }
            ]
        },
        priority: {
            name: "Priority",
            type: "string",
            validation: {
                required: true
            },
            defaultValue: "medium",
            enum: [
                {
                    id: "low",
                    label: "Low",
                    color: "gray"
                },
                {
                    id: "medium",
                    label: "Medium",
                    color: "blue"
                },
                {
                    id: "high",
                    label: "High",
                    color: "orange"
                },
                {
                    id: "urgent",
                    label: "Urgent",
                    color: "red"
                }
            ]
        },
        category: {
            name: "Category",
            type: "string",
            enum: [
                {
                    id: "bug",
                    label: "Bug",
                    color: "red"
                },
                {
                    id: "feature_request",
                    label: "Feature Request",
                    color: "purple"
                },
                {
                    id: "question",
                    label: "Question",
                    color: "blue"
                },
                {
                    id: "billing",
                    label: "Billing",
                    color: "green"
                },
                {
                    id: "account",
                    label: "Account",
                    color: "cyan"
                },
                {
                    id: "other",
                    label: "Other",
                    color: "gray"
                }
            ]
        },
        customer: {
            name: "Customer",
            type: "relation",
            relation: {
                kind: "belongsTo",
                target: () => customersCollection,
            }
        },
        assigned_to: {
            name: "Assigned To",
            type: "string",
            userSelect: true,
            description: "Team member assigned to this ticket"
        },
        created_at: {
            name: "Created at",
            type: "date",
            autoValue: "on_create",
            admin: {
                readOnly: true,
                hideFromCollection: true
            }
        },
        updated_at: {
            name: "Updated at",
            type: "date",
            autoValue: "on_update",
            admin: {
                readOnly: true,
                hideFromCollection: true
            }
        },
        __order: {
            name: "Order",
            type: "string",
            admin: {
                disabled: true,
                hideFromCollection: true
            }
        }
    },
    admin: {
        // Sample record actions — see ../actions.ts. Picking a ticket up and
        // resolving it are buttons; escalating and reopening are in the menu.
        entityActions: [
            {
                key: "assign_to_me",
                name: "Assign to me",
                icon: "UserCheck",
                collapsed: false,
                isEnabled: ({ row, context }) => Boolean(context?.authController.user)
                    && row?.assigned_to !== context?.authController.user?.uid
                    && !["resolved", "closed"].includes(String(row?.status)),
                disabledReason: ({ row, context }) => row?.assigned_to === context?.authController.user?.uid
                    ? "Already assigned to you"
                    : "This ticket is closed",
                onClick: ({ row, id, path, context, collection }) => row &&
                    updateRecord(context, collection?.slug ?? path, id, {
                        assigned_to: context?.authController.user?.uid,
                        status: row.status === "open" ? "in_progress" : row.status
                    }, "Assigned to you")
            },
            {
                key: "resolve",
                name: "Resolve",
                icon: "CircleCheck",
                collapsed: false,
                isEnabled: ({ row }) => !["resolved", "closed"].includes(String(row?.status)),
                disabledReason: ({ row }) => `Already ${String(row?.status)}`,
                onClick: ({ row, id, path, context, collection }) => row &&
                    updateRecord(context, collection?.slug ?? path, id, { status: "resolved" }, "Ticket resolved")
            },
            {
                key: "escalate",
                name: "Escalate priority",
                icon: "CircleArrowUp",
                isEnabled: ({ row }) => row?.priority !== "urgent"
                    && !["resolved", "closed"].includes(String(row?.status)),
                disabledReason: ({ row }) => row?.priority === "urgent"
                    ? "Already at the highest priority"
                    : "Closed tickets can't be escalated",
                onClick: ({ row, id, path, context, collection }) => {
                    if (!row) return;
                    const order = ["low", "medium", "high", "urgent"];
                    const next = order[Math.min(order.indexOf(String(row.priority)) + 1, order.length - 1)];
                    return updateRecord(context, collection?.slug ?? path, id, { priority: next }, `Priority raised to ${next}`);
                }
            },
            {
                key: "reopen",
                name: "Reopen",
                icon: "RotateCcw",
                isEnabled: ({ row }) => ["resolved", "closed"].includes(String(row?.status)),
                disabledReason: () => "This ticket is still open",
                onClick: ({ row, id, path, context, collection }) => row &&
                    updateRecord(context, collection?.slug ?? path, id, { status: "open" }, "Ticket reopened")
            }
        ],
        icon: "Ticket",
        group: "Support",
        defaultViewMode: "kanban",
        // Triage — state, urgency, who owns it — to the rail, where it stays
        // visible while you read the thing being triaged.
        form: {
            sidebar: ["status", "priority", "category", "assigned_to"],
            sections: [
                { key: "ticket", properties: ["ticket_number", "subject", "customer"] },
                { key: "detail", title: "Description", properties: ["description"] },
                {
                    key: "resolution",
                    title: "Resolution",
                    properties: ["resolution_notes"],
                    // Empty until the ticket is closed, so it starts folded
                    // rather than sitting open under every open ticket.
                    collapsed: true
                }
            ]
        },
        kanban: {
            columnProperty: "status"
        },
        orderProperty: "__order",
        // The board is this collection's default view, and a triage card has to
        // answer "whose problem, how urgent" without being opened. `subject` was
        // already declared — the ranking would otherwise have taken
        // `ticket_number`, which is the one string on the row that says nothing.
        display: {
            title: "subject",
            subtitle: ({ row }) => joinParts(
                row.ticket_number,
                fullName(included(row.customer))
            ),
            status: "status",
            date: "created_at",
            tags: "priority"
        },
        propertiesOrder: [
            "ticket_number",
            "subject",
            "status",
            "priority",
            "category",
            "customer",
            "assigned_to",
            "description",
            "resolution_notes",
            "created_at",
            "updated_at",
            "__order"
        ],
        filterPresets: [
            {
                label: "Urgent & High priority",
                filterValues: {
                    priority: ["in", ["urgent", "high"]]
                }
            },
            {
                label: "Bugs",
                filterValues: {
                    category: ["==", "bug"]
                }
            },
            {
                label: "Feature requests",
                filterValues: {
                    category: ["==", "feature_request"]
                }
            },
            {
                label: "Unassigned",
                filterValues: {
                    assigned_to: ["==", null]
                }
            }
        ]
    }
};

export default ticketsCollection;
