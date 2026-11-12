// @ts-nocheck — a frozen legacy input of the plan-golden corpus: see plan-corpus-legacy/legacy-model.ts.
import { defineCollection } from "../../../legacy-model";
import type { AnyCollectionConfig } from "../../../legacy-model";
import changesetCommentsCollection from "./changeset_comments";
import changesetsCollection from "./changesets";
import diaryCommentsCollection from "./diary_comments";
import diaryEntriesCollection from "./diary_entries";
import friendsCollection from "./friends";
import gpxFilesCollection from "./gpx_files";
import issueCommentsCollection from "./issue_comments";
import issuesCollection from "./issues";
import messagesCollection from "./messages";
import noteCommentsCollection from "./note_comments";
import notesCollection from "./notes";
import oauthAccessGrantsCollection from "./oauth_access_grants";
import oauthAccessTokensCollection from "./oauth_access_tokens";
import oauthApplicationsCollection from "./oauth_applications";
import redactionsCollection from "./redactions";
import reportsCollection from "./reports";
import socialLinksCollection from "./social_links";
import userBlocksCollection from "./user_blocks";
import userMutesCollection from "./user_mutes";
import userPreferencesCollection from "./user_preferences";
import userRolesCollection from "./user_roles";

// ⚠ Not reproduced exactly by `rebase db push` — read before pushing:
//   - "email" is a varchar with no length, declared as text: a push would plan converting it to text, which keeps every value.
//   - "pass_crypt" is a varchar with no length, declared as text: a push would plan converting it to text, which keeps every value.
//   - "creation_time" is timestamp without time zone; a date property stores timestamptz, date or time, so a push would plan converting it to timestamptz (and ask before applying it).
//   - "display_name" is a varchar with no length, declared as text: a push would plan converting it to text, which keeps every value.
//   - "home_zoom" is smallint, which no `columnType` names; it is declared integer, so a push widens it (every value survives).
//   - "pass_salt" is a varchar with no length, declared as text: a push would plan converting it to text, which keeps every value.
//   - "new_email" is a varchar with no length, declared as text: a push would plan converting it to text, which keeps every value.
//   - "languages" is a varchar with no length, declared as text: a push would plan converting it to text, which keeps every value.
//   - "status" uses the enum type "user_status_enum", and Rebase names a column's enum type <table>_<column>. Rename it before pushing: ALTER TYPE "user_status_enum" RENAME TO "users_status";
//   - "terms_agreed" is timestamp without time zone; a date property stores timestamptz, date or time, so a push would plan converting it to timestamptz (and ask before applying it).
//   - "auth_uid" is a varchar with no length, declared as text: a push would plan converting it to text, which keeps every value.
//   - "preferred_editor" is a varchar with no length, declared as text: a push would plan converting it to text, which keeps every value.
//   - "description_format" uses the enum type "format_enum", which other columns share; Rebase gives each column its own type (<table>_<column>), so a push would plan "users_description_format" and a conversion Postgres cannot cast.
//   - "auth_provider" is a varchar with no length, declared as text: a push would plan converting it to text, which keeps every value.
//   - "tou_agreed" is timestamp without time zone; a date property stores timestamptz, date or time, so a push would plan converting it to timestamptz (and ask before applying it).
//   - "creation_address" is inet, which no property type stores; it is read as text, and a push would plan converting the column to text.
//   - "home_location_name" is a varchar with no length, declared as text: a push would plan converting it to text, which keeps every value.
//   - "company" is a varchar with no length, declared as text: a push would plan converting it to text, which keeps every value.

const usersCollection = defineCollection({
    name: "Users",
    singularName: "User",
    slug: "users",
    table: "users",
    properties: {
        id: {
            name: "Id",
            columnName: "id",
            type: "number",
            isId: "manual",
            columnType: "bigserial",
        },
        displayName: {
            name: "Display Name",
            columnName: "display_name",
            type: "string",
            defaultValue: "",
            validation: {
                required: true,
                unique: true
            },
        },
        homeLocationName: {
            name: "Home Location Name",
            columnName: "home_location_name",
            type: "string",
        },
        email: {
            name: "Email",
            columnName: "email",
            type: "string",
            validation: {
                required: true,
                unique: true
            },
        },
        status: {
            name: "Status",
            columnName: "status",
            type: "string",
            enum: [{ id: "pending", label: "Pending" }, { id: "active", label: "Active" }, { id: "confirmed", label: "Confirmed" }, { id: "suspended", label: "Suspended" }, { id: "deleted", label: "Deleted" }],
            defaultValue: "pending",
            validation: {
                required: true
            },
        },
        descriptionFormat: {
            name: "Description Format",
            columnName: "description_format",
            type: "string",
            enum: [{ id: "html", label: "Html" }, { id: "markdown", label: "Markdown" }, { id: "text", label: "Text" }],
            defaultValue: "markdown",
            validation: {
                required: true
            },
        },
        passCrypt: {
            name: "Pass Crypt",
            columnName: "pass_crypt",
            type: "string",
            validation: {
                required: true
            },
        },
        passSalt: {
            name: "Pass Salt",
            columnName: "pass_salt",
            type: "string",
        },
        newEmail: {
            name: "New Email",
            columnName: "new_email",
            type: "string",
        },
        languages: {
            name: "Languages",
            columnName: "languages",
            type: "string",
        },
        authUid: {
            name: "Auth Uid",
            columnName: "auth_uid",
            type: "string",
        },
        preferredEditor: {
            name: "Preferred Editor",
            columnName: "preferred_editor",
            type: "string",
        },
        authProvider: {
            name: "Auth Provider",
            columnName: "auth_provider",
            type: "string",
        },
        creationAddress: {
            name: "Creation Address",
            columnName: "creation_address",
            type: "string",
        },
        company: {
            name: "Company",
            columnName: "company",
            type: "string",
        },
        dataPublic: {
            name: "Data Public",
            columnName: "data_public",
            type: "boolean",
            defaultValue: false,
            validation: {
                required: true
            },
        },
        emailValid: {
            name: "Email Valid",
            columnName: "email_valid",
            type: "boolean",
            defaultValue: false,
            validation: {
                required: true
            },
        },
        considerPd: {
            name: "Consider Pd",
            columnName: "consider_pd",
            type: "boolean",
            defaultValue: false,
            validation: {
                required: true
            },
        },
        termsSeen: {
            name: "Terms Seen",
            columnName: "terms_seen",
            type: "boolean",
            defaultValue: false,
            validation: {
                required: true
            },
        },
        publicHeatmap: {
            name: "Public Heatmap",
            columnName: "public_heatmap",
            type: "boolean",
            defaultValue: true,
            validation: {
                required: true
            },
        },
        homeLat: {
            name: "Home Lat",
            columnName: "home_lat",
            type: "number",
            columnType: "double precision",
        },
        homeLon: {
            name: "Home Lon",
            columnName: "home_lon",
            type: "number",
            columnType: "double precision",
        },
        homeZoom: {
            name: "Home Zoom",
            columnName: "home_zoom",
            type: "number",
            columnType: "integer",
            defaultValue: 3,
        },
        changesetsCount: {
            name: "Changesets Count",
            columnName: "changesets_count",
            type: "number",
            columnType: "integer",
            defaultValue: 0,
            validation: {
                required: true
            },
        },
        tracesCount: {
            name: "Traces Count",
            columnName: "traces_count",
            type: "number",
            columnType: "integer",
            defaultValue: 0,
            validation: {
                required: true
            },
        },
        diaryEntriesCount: {
            name: "Diary Entries Count",
            columnName: "diary_entries_count",
            type: "number",
            columnType: "integer",
            defaultValue: 0,
            validation: {
                required: true
            },
        },
        homeTile: {
            name: "Home Tile",
            columnName: "home_tile",
            type: "number",
            columnType: "bigint",
        },
        diaryCommentsCount: {
            name: "Diary Comments Count",
            columnName: "diary_comments_count",
            type: "number",
            columnType: "integer",
            defaultValue: 0,
        },
        noteCommentsCount: {
            name: "Note Comments Count",
            columnName: "note_comments_count",
            type: "number",
            columnType: "integer",
            defaultValue: 0,
        },
        creationTime: {
            name: "Creation Time",
            columnName: "creation_time",
            type: "date",
            validation: {
                required: true
            },
        },
        termsAgreed: {
            name: "Terms Agreed",
            columnName: "terms_agreed",
            type: "date",
        },
        touAgreed: {
            name: "Tou Agreed",
            columnName: "tou_agreed",
            type: "date",
        },
        description: {
            name: "Description",
            columnName: "description",
            type: "string",
            admin: {
                multiline: true
            },
            defaultValue: "",
            validation: {
                required: true
            },
        },
        imageUseGravatar: {
            name: "Image Use Gravatar",
            columnName: "image_use_gravatar",
            type: "boolean",
            defaultValue: false,
            validation: {
                required: true
            },
        },
    },
    relations: [
        {
            kind: "hasMany",
            relationName: "changeset_comments",
            target: (): AnyCollectionConfig => changesetCommentsCollection,
            // the changeset_comments.author_id FK points back here
            foreignKeyOnTarget: "author_id"
        },
        {
            kind: "hasMany",
            relationName: "changesets",
            target: (): AnyCollectionConfig => changesetsCollection,
            // the changesets.user_id FK points back here
            foreignKeyOnTarget: "user_id"
        },
        {
            kind: "hasMany",
            relationName: "diary_comments",
            target: (): AnyCollectionConfig => diaryCommentsCollection,
            // the diary_comments.user_id FK points back here
            foreignKeyOnTarget: "user_id"
        },
        {
            kind: "hasMany",
            relationName: "diary_entries",
            target: (): AnyCollectionConfig => diaryEntriesCollection,
            // the diary_entries.user_id FK points back here
            foreignKeyOnTarget: "user_id"
        },
        {
            kind: "hasMany",
            relationName: "friends",
            target: (): AnyCollectionConfig => friendsCollection,
            // the friends.friend_user_id FK points back here
            foreignKeyOnTarget: "friend_user_id"
        },
        {
            kind: "hasMany",
            relationName: "friends_by_user_id",
            target: (): AnyCollectionConfig => friendsCollection,
            // the friends.user_id FK points back here
            foreignKeyOnTarget: "user_id"
        },
        {
            kind: "hasMany",
            relationName: "gpx_files",
            target: (): AnyCollectionConfig => gpxFilesCollection,
            // the gpx_files.user_id FK points back here
            foreignKeyOnTarget: "user_id"
        },
        {
            kind: "hasMany",
            relationName: "issue_comments",
            target: (): AnyCollectionConfig => issueCommentsCollection,
            // the issue_comments.user_id FK points back here
            foreignKeyOnTarget: "user_id"
        },
        {
            kind: "hasMany",
            relationName: "issues",
            target: (): AnyCollectionConfig => issuesCollection,
            // the issues.reported_user_id FK points back here
            foreignKeyOnTarget: "reported_user_id"
        },
        {
            kind: "hasMany",
            relationName: "issues_by_resolved_by",
            target: (): AnyCollectionConfig => issuesCollection,
            // the issues.resolved_by FK points back here
            foreignKeyOnTarget: "resolved_by"
        },
        {
            kind: "hasMany",
            relationName: "issues_by_updated_by",
            target: (): AnyCollectionConfig => issuesCollection,
            // the issues.updated_by FK points back here
            foreignKeyOnTarget: "updated_by"
        },
        {
            kind: "hasMany",
            relationName: "messages",
            target: (): AnyCollectionConfig => messagesCollection,
            // the messages.from_user_id FK points back here
            foreignKeyOnTarget: "from_user_id"
        },
        {
            kind: "hasMany",
            relationName: "messages_by_to_user_id",
            target: (): AnyCollectionConfig => messagesCollection,
            // the messages.to_user_id FK points back here
            foreignKeyOnTarget: "to_user_id"
        },
        {
            kind: "hasMany",
            relationName: "note_comments",
            target: (): AnyCollectionConfig => noteCommentsCollection,
            // the note_comments.author_id FK points back here
            foreignKeyOnTarget: "author_id"
        },
        {
            kind: "hasMany",
            relationName: "notes",
            target: (): AnyCollectionConfig => notesCollection,
            // the notes.user_id FK points back here
            foreignKeyOnTarget: "user_id"
        },
        {
            kind: "hasMany",
            relationName: "oauth_access_grants",
            target: (): AnyCollectionConfig => oauthAccessGrantsCollection,
            // the oauth_access_grants.resource_owner_id FK points back here
            foreignKeyOnTarget: "resource_owner_id"
        },
        {
            kind: "hasMany",
            relationName: "oauth_access_tokens",
            target: (): AnyCollectionConfig => oauthAccessTokensCollection,
            // the oauth_access_tokens.resource_owner_id FK points back here
            foreignKeyOnTarget: "resource_owner_id"
        },
        {
            kind: "hasMany",
            relationName: "oauth_applications",
            target: (): AnyCollectionConfig => oauthApplicationsCollection,
            // the oauth_applications.owner_id FK points back here
            foreignKeyOnTarget: "owner_id"
        },
        {
            kind: "hasMany",
            relationName: "redactions",
            target: (): AnyCollectionConfig => redactionsCollection,
            // the redactions.user_id FK points back here
            foreignKeyOnTarget: "user_id"
        },
        {
            kind: "hasMany",
            relationName: "reports",
            target: (): AnyCollectionConfig => reportsCollection,
            // the reports.user_id FK points back here
            foreignKeyOnTarget: "user_id"
        },
        {
            kind: "hasMany",
            relationName: "social_links",
            target: (): AnyCollectionConfig => socialLinksCollection,
            // the social_links.user_id FK points back here
            foreignKeyOnTarget: "user_id"
        },
        {
            kind: "hasMany",
            relationName: "user_blocks",
            target: (): AnyCollectionConfig => userBlocksCollection,
            // the user_blocks.creator_id FK points back here
            foreignKeyOnTarget: "creator_id"
        },
        {
            kind: "hasMany",
            relationName: "user_blocks_by_revoker_id",
            target: (): AnyCollectionConfig => userBlocksCollection,
            // the user_blocks.revoker_id FK points back here
            foreignKeyOnTarget: "revoker_id"
        },
        {
            kind: "hasMany",
            relationName: "user_blocks_by_user_id",
            target: (): AnyCollectionConfig => userBlocksCollection,
            // the user_blocks.user_id FK points back here
            foreignKeyOnTarget: "user_id"
        },
        {
            kind: "hasMany",
            relationName: "user_mutes",
            target: (): AnyCollectionConfig => userMutesCollection,
            // the user_mutes.owner_id FK points back here
            foreignKeyOnTarget: "owner_id"
        },
        {
            kind: "hasMany",
            relationName: "user_mutes_by_subject_id",
            target: (): AnyCollectionConfig => userMutesCollection,
            // the user_mutes.subject_id FK points back here
            foreignKeyOnTarget: "subject_id"
        },
        {
            kind: "hasMany",
            relationName: "user_preferences",
            target: (): AnyCollectionConfig => userPreferencesCollection,
            // the user_preferences.user_id FK points back here
            foreignKeyOnTarget: "user_id"
        },
        {
            kind: "hasMany",
            relationName: "user_roles",
            target: (): AnyCollectionConfig => userRolesCollection,
            // the user_roles.granter_id FK points back here
            foreignKeyOnTarget: "granter_id"
        },
        {
            kind: "hasMany",
            relationName: "user_roles_by_user_id",
            target: (): AnyCollectionConfig => userRolesCollection,
            // the user_roles.user_id FK points back here
            foreignKeyOnTarget: "user_id"
        },
        {
            kind: "manyToMany",
            relationName: "changesets_via_changesets_subscribers",
            target: (): AnyCollectionConfig => changesetsCollection,
            through: {
                table: "changesets_subscribers",
                sourceColumn: "subscriber_id",
                targetColumn: "changeset_id"
            }
        },
        {
            kind: "manyToMany",
            relationName: "diary_entries_via_diary_entry_subscriptions",
            target: (): AnyCollectionConfig => diaryEntriesCollection,
            through: {
                table: "diary_entry_subscriptions",
                sourceColumn: "user_id",
                targetColumn: "diary_entry_id"
            }
        },
        {
            kind: "manyToMany",
            relationName: "notes_via_note_subscriptions",
            target: (): AnyCollectionConfig => notesCollection,
            through: {
                table: "note_subscriptions",
                sourceColumn: "user_id",
                targetColumn: "note_id"
            }
        },
    ],
    admin: {
        icon: "Users",
        display: { title: "email" },
        // A board over "status" fits this table, but a board needs a string column to keep each card's order in. Add one, then declare kanban: { columnProperty: "status" } and orderProperty: "<that property>".,
        listProperties: [
            "id",
            "displayName",
            "homeLocationName",
            "email",
            "status",
            "descriptionFormat"
        ],
        propertiesOrder: [
            "id",
            "displayName",
            "homeLocationName",
            "email",
            "status",
            "descriptionFormat",
            "passCrypt",
            "passSalt",
            "newEmail",
            "languages",
            "authUid",
            "preferredEditor",
            "authProvider",
            "creationAddress",
            "company",
            "dataPublic",
            "emailValid",
            "considerPd",
            "termsSeen",
            "publicHeatmap",
            "homeLat",
            "homeLon",
            "homeZoom",
            "changesetsCount",
            "tracesCount",
            "diaryEntriesCount",
            "homeTile",
            "diaryCommentsCount",
            "noteCommentsCount",
            "creationTime",
            "termsAgreed",
            "touAgreed",
            "description",
            "imageUseGravatar"
        ]
    }
});

export default usersCollection;
