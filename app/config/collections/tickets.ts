import { PostgresCollection } from "@rebasepro/types";
import customersCollection from "./customers";

const ticketsCollection: PostgresCollection = {
    name: "Tickets",
    singularName: "Ticket",
    slug: "tickets",
    table: "tickets",
    icon: "ConfirmationNumber",
    group: "Support",
    history: true,
    openEntityMode: "split",
    defaultViewMode: "kanban",
    enabledViews: ["table", "kanban"],
    kanban: {
        columnProperty: "status"
    },
    properties: {
        id: {
            name: "ID",
            type: "number",
            isId: "increment"
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
            multiline: true,
            description: "Detailed description of the ticket"
        },
        status: {
            name: "Status",
            type: "string",
            validation: {
                required: true
            },
            defaultValue: "open",
            enum: [
                { id: "open", label: "Open", color: "blue" },
                { id: "in_progress", label: "In Progress", color: "orange" },
                { id: "waiting", label: "Waiting on Customer", color: "yellow" },
                { id: "resolved", label: "Resolved", color: "green" },
                { id: "closed", label: "Closed", color: "gray" }
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
                { id: "low", label: "Low", color: "gray" },
                { id: "medium", label: "Medium", color: "blue" },
                { id: "high", label: "High", color: "orange" },
                { id: "urgent", label: "Urgent", color: "red" }
            ]
        },
        category: {
            name: "Category",
            type: "string",
            enum: [
                { id: "bug", label: "Bug", color: "red" },
                { id: "feature_request", label: "Feature Request", color: "purple" },
                { id: "question", label: "Question", color: "blue" },
                { id: "billing", label: "Billing", color: "green" },
                { id: "account", label: "Account", color: "cyan" },
                { id: "other", label: "Other", color: "gray" }
            ]
        },
        customer: {
            name: "Customer",
            type: "relation",
            relationName: "customer",
            relation: {
                relationName: "customer",
                cardinality: "one",
                direction: "owning",
                target: () => customersCollection
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
            readOnly: true,
            hideFromCollection: true
        },
        updated_at: {
            name: "Updated at",
            type: "date",
            autoValue: "on_update",
            readOnly: true,
            hideFromCollection: true
        }
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
        "created_at",
        "updated_at"
    ],
    relations: [
        {
            relationName: "customer",
            target: () => customersCollection,
            cardinality: "one",
            direction: "owning"
        }
    ]
};

ticketsCollection.securityRules = [
    {
        name: "test_policy",
        mode: "permissive",
        operation: "all",
        pgRoles: ["public"],
        using: "true"
    }
];

export default ticketsCollection;
