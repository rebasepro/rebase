/** The review plugin's strings in en. */
export const en = {
    review_queue: "Review queue",
    review_queue_count: "Review queue ({{count}})",
    review_queue_title: "Review queue: {{collection}}",
    review_queue_empty: "Nothing is waiting for review.",
    review_queue_loading: "Loading proposed changes…",
    review_queue_error: "Could not load the review queue: {{message}}",
    review_approve: "Approve",
    review_reject: "Reject",
    review_approve_selected: "Approve {{count}}",
    review_reject_selected: "Reject {{count}}",
    review_select_change: "Select this change",
    review_select_all: "Select all",
    review_op_insert: "Insert",
    review_op_update: "Update",
    review_op_delete: "Delete",
    review_no_reason: "No reason given",
    review_actor_unknown: "Unknown proposer",
    review_field: "Field",
    review_before: "Before",
    review_after: "After",
    review_empty_value: "empty",
    review_no_changes: "Changes nothing",
    review_keyboard_hint: "j / k to move · a to approve · r to reject · space to select",
    review_note_placeholder: "Note for the proposer (optional)",
    review_approved_toast: "Changes approved: {{count}}",
    review_rejected_toast: "Changes rejected: {{count}}",
    review_decide_error: "Could not save the decision: {{message}}",
    review_record: "Record {{id}}",
    review_new_record: "New record",
    review_close: "Close",
    review_pending_rows: "Rows waiting in “{{value}}”",
    review_proposed_at: "Proposed {{date}}",
    review_reload: "Reload"
};

/** Every key the review plugin translates. */
export type ReviewTranslationKey = keyof typeof en;

/** A bundle: a string for every key. */
export type ReviewTranslations = Record<ReviewTranslationKey, string>;
