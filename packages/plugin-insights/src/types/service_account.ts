
export interface ServiceAccountInfo {
    name: string,
    projectId: string,
    uniqueId: string,
    email: string,
    displayName: string,
    etag: string,
    description: string,
    oauth2ClientId: string
}

export interface ServiceAccountKey {
    type: string,
    project_id: string,
    private_key_id: string,
    private_key: string,
    client_email: string,
    client_id: string,
    auth_uri: string,
    token_uri: string,
    auth_provider_x509_cert_url: string,
    client_x509_cert_url: string,
    universe_domain: string
}

export interface IAMBinding {
    role: string,
    members: string[]
}

export interface IAMPolicy {
    bindings: IAMBinding[];
    etag: string;
    version: number;
}
