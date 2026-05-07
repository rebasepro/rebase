export type GCPProject = {
    name: string;
    projectId: string; // Unique identifier for the project
    projectNumber: string; // Unique number associated with the project
    createTime: string; // ISO 8601 date string
    // Using index signature for labels to support various key-value pairs
    labels: {
        [key: string]: string;
    };
    lifecycleState: "ACTIVE" | "DELETE_REQUESTED" | "DELETE_IN_PROGRESS" | "DELETED" | "PURGING";
    parent: {
        type: "organization" | "folder"; // Valid parent types
        id: string; // Parent ID is typically a string
    };
    linked: boolean;
    related_users?: string[]; // Optional field for related users
}
