import { customizeTable, updateRecord } from "@rebasepro/cms";
import type { customers } from "../../../backend/schema/customers";
import { text, openInNewTab, copyToClipboard } from "./lib/actions";
import { fullName, joinParts, money } from "./lib/display";

export const customersCms = customizeTable<typeof customers>("customers", {
    icon: "Users",
    group: "E-Commerce",
    entityActions: [
        {
            key: "recalculate_vip",
            name: "Recalculate VIP",
            icon: "Crown",
            collapsed: false,
            onClick: ({ row, id, path, context, collection }) => {
                if (!row) return;
                const isVip = Number(row.lifetime_value ?? 0) >= 1000;
                return updateRecord(context, collection?.slug ?? path, id, { is_vip: isVip },
                    isVip ? "VIP: spent $1,000 or more" : "Not VIP: spent under $1,000");
            }
        },
        {
            key: "email",
            name: "Email customer",
            icon: "Mail",
            collapsed: false,
            isEnabled: ({ row }) => Boolean(text(row?.email)),
            disabledReason: () => "No email on file",
            onClick: ({ row }) => {
                if (row) openInNewTab(`mailto:${String(row.email)}`);
            }
        },
        {
            key: "copy_email",
            name: "Copy email address",
            icon: "ClipboardCopy",
            isEnabled: ({ row }) => Boolean(text(row?.email)),
            disabledReason: () => "No email on file",
            onClick: ({ row, context }) => row &&
                copyToClipboard(context, String(row.email), "Email address copied")
        }
    ],
    defaultEntityAction: "view",
    display: {
        title: ({ row }) => fullName(row),
        subtitle: ({ row }) => joinParts(row.company, row.email),
        image: "avatar",
        date: "created_at",
        tags: ({ row }) => [
            row.is_vip ? "VIP" : undefined,
            money(row.lifetime_value)
        ].filter((tag): tag is string => Boolean(tag))
    },
    previewFields: ["company", "email"],
    sort: [
        ["is_vip", "desc"],
        ["lifetime_value", "desc"]
    ],
    form: {
        sidebar: ["is_vip", "lifetime_value", "total_orders"],
        sections: [
            {
                key: "person",
                fields: ["avatar", "first_name", "last_name", "email", "phone", "company"]
            },
            {
                key: "addresses",
                title: "Addresses",
                fields: ["shipping_address", "billing_address"]
            },
            {
                key: "internal",
                title: "Internal",
                collapsed: true,
                fields: ["notes"]
            }
        ]
    },
    fieldOrder: [
        "first_name",
        "last_name",
        "email",
        "phone",
        "avatar",
        "company",
        "is_vip",
        "lifetime_value",
        "total_orders",
        "shipping_address",
        "billing_address",
        "notes",
        "created_at",
        "updated_at"
    ],
    fields: {
        is_vip: {
            name: "VIP",
            readOnly: true
        },
        lifetime_value: {
            readOnly: true
        },
        total_orders: {
            readOnly: true
        },
        shipping_address: {
            multiline: true
        },
        billing_address: {
            multiline: true
        },
        notes: {
            multiline: true
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
        }
    }
});
