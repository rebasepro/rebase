export type DatakiUser = {
    id: string;
    email: string;
    name: string;
    picture: string;
    roles: string[];
    lastLogin: number;
    createdAt: number;
    updatedAt: number;
    displayName?: string;
    photoURL?: string;
    created_at: Date;
    updated_at: Date;
    deleted?: boolean;
    initial_team?: string;
}

export type Credentials = {
    refresh_token: string;
    expiry_date: number;
    access_token: string;
    token_type: string;
    id_token: string;
    scope: string;
}
