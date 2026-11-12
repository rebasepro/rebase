import { defineTable, col, rel } from "@rebasepro/server/schema";
import { customers } from "./customers";

export const tickets = defineTable("tickets", {
    columns: {
        id: col.uuid().primaryKey().defaultRandom(),
        ticket_number: col.text().notNull().unique().describe("Human-readable ticket identifier (e.g. TK-2025-0042)"),
        subject: col.text().notNull().describe("Brief summary of the issue or request"),
        description: col.text().describe("Detailed description of the ticket in Markdown"),
        resolution_notes: col.text().describe("Internal notes about how the issue was resolved"),
        status: col.enum(["open", "in_progress", "waiting", "resolved", "closed"]).notNull().default("open"),
        priority: col.enum(["low", "medium", "high", "urgent"]).notNull().default("medium"),
        category: col.enum(["bug", "feature_request", "question", "billing", "account", "other"]),
        customerId: col.uuid(),
        assigned_to: col.text().userId().describe("Team member assigned to this ticket"),
        created_at: col.timestamptz().onCreateNow(),
        updated_at: col.timestamptz().onUpdateNow(),
        __order: col.text()
    },
    relations: {
        customer: rel.belongsTo(() => customers)
    },
    rls: "inherit",
    history: true
});
