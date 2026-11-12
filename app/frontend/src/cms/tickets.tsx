import { customizeTable } from "@rebasepro/cms";
import type { tickets } from "../../../backend/schema/tickets";
import { updateRecord } from "./lib/actions";
import { joinParts, fullName, included } from "./lib/display";

export const ticketsCms = customizeTable<typeof tickets>("tickets", {
    icon: "Ticket",
    group: "Support",
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
    defaultViewMode: "kanban",
    form: {
        sidebar: ["status", "priority", "category", "assigned_to"],
        sections: [
            {
                key: "ticket",
                fields: ["ticket_number", "subject", "customer"]
            },
            {
                key: "detail",
                title: "Description",
                fields: ["description"]
            },
            {
                key: "resolution",
                title: "Resolution",
                collapsed: true,
                fields: ["resolution_notes"]
            }
        ]
    },
    kanban: {
        columnField: "status",
        orderField: "__order"
    },
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
    fieldOrder: [
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
                priority: [
                    "in",
                    ["urgent", "high"]
                ]
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
    ],
    fields: {
        ticket_number: {
            name: "Ticket #"
        },
        description: {
            markdown: true
        },
        resolution_notes: {
            markdown: true
        },
        status: {
            enumLabels: {
                open: {
                    label: "Open",
                    color: "blue"
                },
                in_progress: {
                    label: "In Progress",
                    color: "orange"
                },
                waiting: {
                    label: "Waiting on Customer",
                    color: "yellow"
                },
                resolved: {
                    label: "Resolved",
                    color: "green"
                },
                closed: {
                    label: "Closed",
                    color: "gray"
                }
            }
        },
        priority: {
            enumLabels: {
                low: {
                    label: "Low",
                    color: "gray"
                },
                medium: {
                    label: "Medium",
                    color: "blue"
                },
                high: {
                    label: "High",
                    color: "orange"
                },
                urgent: {
                    label: "Urgent",
                    color: "red"
                }
            }
        },
        category: {
            enumLabels: {
                bug: {
                    label: "Bug",
                    color: "red"
                },
                feature_request: {
                    label: "Feature Request",
                    color: "purple"
                },
                question: {
                    label: "Question",
                    color: "blue"
                },
                billing: {
                    label: "Billing",
                    color: "green"
                },
                account: {
                    label: "Account",
                    color: "cyan"
                },
                other: {
                    label: "Other",
                    color: "gray"
                }
            }
        },
        created_at: {
            name: "Created at",
            readOnly: true,
            hidden: true
        },
        updated_at: {
            name: "Updated at",
            readOnly: true,
            hidden: true
        },
        __order: {
            disabled: true,
            hidden: true
        }
    }
});
