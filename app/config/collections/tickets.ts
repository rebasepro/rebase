import customersCollection from "./customers";
import type { PostgresCollectionConfig } from "@rebasepro/types";

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
        icon: "Ticket",
        group: "Support",
        defaultViewMode: "kanban",
        enabledViews: ["table", "kanban"],
        kanban: {
            columnProperty: "status"
        },
        orderProperty: "__order",
        display: { title: "subject" },
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
