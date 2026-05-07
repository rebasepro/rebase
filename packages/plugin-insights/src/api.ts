import {
    BigQueryDataSource,
    ChatMessage,
    ChatSessionItem,
    Dashboard,
    DatabaseConnectionConfig,
    DataRow,
    DataSource,
    DateParams,
    DryChartWidgetConfig,
    DryScorecardWidgetConfig,
    DryTableWidgetConfig,
    DryWidgetConfig,
    FileDataSource,
    FunctionCall,
    GCPProject,
    GoogleSheetsDataSource,
    Model,
    ParamFilter,
    WidgetConfig
} from "./types";
import JSON5 from "json5";

interface StreamDatakiCommandParams {
    firebaseAccessToken: string | null;
    command: string;
    apiEndpoint: string;
    sessionId: string;
    initialWidgetConfig?: DryWidgetConfig;
    sources: DataSource[];
    messages: ChatMessage[];
    widgetErrors?: Map<string, Error>;
    onDelta: (delta: string, thought: boolean) => void;
    onFunctionCall: (call: FunctionCall) => void;
    model: Model;
    dashboardId?: string;
    dashboardPageId?: string;
    params: DateParams;
    paramFilters: ParamFilter[];
    abortController?: AbortController;
    onAbort?: () => void;
    userMessageId?: string; // ID of the user message for backend persistence
    attachedFiles?: FileDataSource[]; // Files attached to the message
}

export class ApiError extends Error {

    public code?: string;

    constructor(message: string, code?: string) {
        super(message);
        this.code = code;
    }
}

// Centralized helpers for JSON requests and error handling
async function parseJsonSafe(res: Response): Promise<any | null> {
    try {
        return await res.json();
    } catch (_) {
        return null;
    }
}

async function handleJsonResponse<T>(
    res: Response,
    opts: { expectDataWrapper?: boolean; allow404ReturnNull?: boolean } = {}
): Promise<T> {
    const {
        expectDataWrapper = true,
        allow404ReturnNull = false
    } = opts;

    if (allow404ReturnNull && res.status === 404) {
        // @ts-expect-error allow returning null for optional endpoints
        return null;
    }

    const json = await parseJsonSafe(res);

    if (!res.ok) {
        const message = json?.error || json?.message || `HTTP ${res.status}`;
        const code = json?.code;
        throw new ApiError(message, code);
    }

    return (expectDataWrapper ? (json?.data as T) : (json as T));
}

async function requestJson<T>(
    url: string,
    init: RequestInit,
    opts?: { expectDataWrapper?: boolean; allow404ReturnNull?: boolean }
): Promise<T> {
    const res = await fetch(url, init);
    return handleJsonResponse<T>(res, opts);
}

export async function streamDatakiCommand({
    firebaseAccessToken,
    command,
    apiEndpoint,
    sessionId,
    initialWidgetConfig,
    sources,
    messages,
    widgetErrors,
    onDelta,
    onFunctionCall,
    model,
    dashboardId,
    dashboardPageId,
    params,
    paramFilters,
    abortController,
    onAbort,
    userMessageId,
    attachedFiles
}: StreamDatakiCommandParams
): Promise<string> {

    let isRejected = false;

    const serializedWidgetErrors = widgetErrors ?
        Array.from(widgetErrors.entries()).map(([widgetId, error]) => ({
            widgetId,
            error: error.message
        })) :
        undefined;

    // eslint-disable-next-line no-async-promise-executor
    return new Promise<string>(async (resolve, reject) => {
        try {
            const history = messages;
            const response = await fetch(apiEndpoint + "/dataki/command", {
                method: "POST",
                headers: getHeaders(firebaseAccessToken),
                body: JSON.stringify({
                    sessionId,
                    model,
                    command,
                    sources,
                    history,
                    initialWidgetConfig,
                    dashboardId,
                    dashboardPageId,
                    params,
                    paramFilters,
                    widgetErrors: serializedWidgetErrors,
                    userMessageId,
                    attachedFiles
                }),
                signal: abortController?.signal
            });

            if (!response.ok) {
                const data = await response.json();
                console.error("Error streaming data talk command", data);
                reject(new ApiError(data.message, data.code));
                return;
            }

            if (response.body) {
                const reader = response.body.getReader();
                const decoder = new TextDecoder();
                let buffer = "";
                const result: ChatSessionItem[] = [];

                const normalizeLine = (line: string) => {
                    // Handle CRLF and optional SSE 'data:' prefix
                    const trimmed = line.replace(/\r$/, "").trim();
                    if (trimmed.startsWith("data:")) return trimmed.slice("data:".length).trim();
                    return trimmed;
                };

                const tryParseMessage = (rawLine: string): any | undefined => {
                    const line = normalizeLine(rawLine);
                    if (!line) return undefined;

                    // Keepalive / SSE markers
                    if (line === "[DONE]") return { type: "done" };

                    // Parse JSON (supports JSON5)
                    return JSON5.parse(line);
                };

                const processMessage = (message: any) => {
                    if (!message) return;
                    if (message.type === "done") {
                        onDelta("", false);
                        return;
                    }

                    if (message.type === "delta") {
                        result.push(message.data.delta);
                        onDelta(message.data.delta, message.data.thought);
                    } else if (message.type === "function_call") {
                        onFunctionCall(message.data.call);
                    } else if (message.type === "error") {
                        console.error("Error received:", message.data);
                        isRejected = true;
                        reject(message.data);
                    } else {
                        console.warn("Unknown message type:", message);
                    }
                };

                const processBufferLines = () => {
                    // Split by newline; keep trailing partial line in buffer
                    const lines = buffer.split("\n");
                    buffer = lines.pop() || "";

                    // Parse each complete line; if a line isn't valid JSON (partial), put back into buffer
                    for (const rawLine of lines) {
                        const line = normalizeLine(rawLine);
                        if (!line) continue;

                        try {
                            const message = tryParseMessage(line);
                            processMessage(message);
                            if (isRejected) return;
                        } catch (parseError) {
                            // Most common failure mode: JSON object split across chunks/newlines.
                            // Put it back into the buffer and wait for more data.
                            buffer = line + "\n" + buffer;
                            break;
                        }
                    }
                };

                const processChunk = async (chunk: ReadableStreamReadResult<Uint8Array>): Promise<void> => {
                    try {
                        if (isRejected) return;

                        if (chunk.done) {
                            // Flush remaining buffer if it contains a complete JSON object
                            if (buffer.trim()) {
                                try {
                                    const msg = tryParseMessage(buffer);
                                    processMessage(msg);
                                } catch (_) {
                                    // ignore incomplete trailing data
                                }
                            }

                            console.log("Stream completed", { result });
                            if (!isRejected) {
                                resolve("");
                            } else {
                                console.error("Stream ended with rejection", { result });
                                reject(new Error("Stream ended with rejection"));
                            }
                            return;
                        }

                        const text = decoder.decode(chunk.value, { stream: true });
                        buffer += text;

                        processBufferLines();

                        if (!isRejected) {
                            try {
                                const nextChunk = await reader.read();
                                await processChunk(nextChunk);
                            } catch (error) {
                                if (!isRejected) {
                                    isRejected = true;
                                    reject(error);
                                }
                            }
                        }
                    } catch (error) {
                        if (!isRejected) {
                            isRejected = true;
                            reject(error);
                        }
                    }
                };

                reader.read()
                    .then(processChunk)
                    .catch(error => {
                        if (abortController?.signal.aborted) {
                            if (!isRejected) {
                                isRejected = true;
                                onAbort?.();
                                resolve("");
                            }
                            return;
                        }
                        if (!isRejected) {
                            isRejected = true;
                            reject(error);
                        }
                    });
            } else {
                resolve("");
            }
        } catch (error: any) {
            if (abortController?.signal.aborted) {
                onAbort?.();
                if (!isRejected) {
                    isRejected = true;
                    resolve("");
                }
                return;
            }
            if (!isRejected) {
                isRejected = true;
                console.error("Error streaming data talk command", error);
                reject(error);
            }
        }
    });
}

export function hydrateWidgetConfig(firebaseAccessToken: string | null,
    apiEndpoint: string,
    config: DryChartWidgetConfig | DryTableWidgetConfig | DryScorecardWidgetConfig,
    dashboardId?: string,
    params?: DateParams,
    paramFilters?: ParamFilter[],
    embedApiKey?: string
): Promise<WidgetConfig> {
    return requestJson<WidgetConfig>(apiEndpoint + "/dataki/hydrate_chart" + (config.id ? "?id=" + config.id : ""), {
        method: "POST",
        headers: getHeaders(firebaseAccessToken, embedApiKey),
        body: JSON.stringify({
            config,
            params,
            paramFilters,
            dashboardId
        })
    });
}

export interface SQLQueryRequest {
    firebaseAccessToken: string | null;
    apiEndpoint: string;
    sql: string;
    dataSources: DataSource[];
    orderBy?: [string, "asc" | "desc"][],
    params?: DateParams;
    paramFilters?: ParamFilter[]
    limit?: number;
    offset?: number;
    dashboardId?: string;
    signal?: AbortSignal;
    embedApiKey?: string;
}

export function makeSQLQuery({
    firebaseAccessToken,
    apiEndpoint,
    sql,
    dataSources,
    orderBy,
    params,
    paramFilters,
    limit,
    offset,
    dashboardId,
    signal,
    embedApiKey
}: SQLQueryRequest
): Promise<DataRow[]> {

    return requestJson<DataRow[]>(apiEndpoint + "/data/query", {
        method: "POST",
        headers: getHeaders(firebaseAccessToken, embedApiKey),
        body: JSON.stringify({
            sql,
            dataSources,
            params,
            paramFilters,
            orderBy,
            limit,
            offset,
            dashboardId
        }),
        signal
    });
}

export function getDatakiPromptSuggestions(firebaseAccessToken: string | null,
    apiEndpoint: string,
    dataSources: DataSource[],
    messages?: ChatMessage[],
    initialWidgetConfig?: DryWidgetConfig
): Promise<string[]> {
    const history = (messages ?? []).filter(message => message.user === "USER" || message.user === "SYSTEM");
    return requestJson<string[]>(apiEndpoint + "/dataki/prompt_suggestions", {
        method: "POST",
        headers: getHeaders(firebaseAccessToken),
        body: JSON.stringify({
            dataSources,
            history,
            initialWidgetConfig
        })
    });
}

export function fetchDataSourcesForGoogleProject(firebaseAccessToken: string | null, apiEndpoint: string, projectId: string): Promise<BigQueryDataSource[]> {
    return requestJson<BigQueryDataSource[]>(apiEndpoint + "/gcp_projects/" + projectId + "/datasets", {
        method: "GET",
        headers: getHeaders(firebaseAccessToken),
    });
}

export function createServiceAccountLink(firebaseAccessToken: string | null, apiEndpoint: string, projectId: string): Promise<boolean> {
    return requestJson<boolean>(apiEndpoint + "/gcp_projects/" + projectId + "/service_accounts", {
        method: "POST",
        headers: getHeaders(firebaseAccessToken),
    });
}

export function deleteServiceAccountLink(firebaseAccessToken: string | null, apiEndpoint: string, projectId: string): Promise<boolean> {
    return requestJson<boolean>(apiEndpoint + "/gcp_projects/" + projectId + "/service_accounts", {
        method: "DELETE",
        headers: getHeaders(firebaseAccessToken),
    });
}

function getHeaders(firebaseAccessToken: string | null, embedApiKey?: string): Record<string, string> {
    const headers: Record<string, string> = {
        "Content-Type": "application/json",
    };
    if (firebaseAccessToken) {
        headers.Authorization = `Bearer ${firebaseAccessToken}`;
    }
    if (embedApiKey) {
        headers["X-Embed-Api-Key"] = embedApiKey;
    }
    return headers;
}

export function fetchUserGCPProjects(firebaseAccessToken: string | null, apiEndpoint: string): Promise<GCPProject[]> {
    return requestJson<GCPProject[]>(apiEndpoint + "/gcp_projects",
        {
            method: "GET",
            headers: getHeaders(firebaseAccessToken)
        });
}

/**
 * Generate the authorization URL for the OAuth2 flow
 *
 */
export async function generateAuthUrl(redirectUri: string, includeGCPScope: boolean, includeSheetsScope: boolean, apiEndpoint: string) {
    const url = new URL(`${apiEndpoint}/oauth/generate_auth_url`);
    url.searchParams.append("redirect_uri", redirectUri);
    if (includeGCPScope)
        url.searchParams.append("gcp", "true");
    if (includeSheetsScope)
        url.searchParams.append("sheets", "true");

    return requestJson<any>(url.toString(), {
        method: "GET",
        headers: {
            "Content-Type": "application/json"
        }
    }, { expectDataWrapper: false });
}

/**
 * Exchange the authorization code for an access token
 *
 */
export async function exchangeCodeForToken(redirectUri: string, code: string, apiEndpoint: string): Promise<Record<string, string>> {
    const url = new URL(`${apiEndpoint}/oauth/exchange_code_for_token`);
    url.searchParams.append("redirect_uri", redirectUri);
    url.searchParams.append("code", code);

    return requestJson<Record<string, string>>(url.toString(), {
        method: "GET",
        headers: {
            "Content-Type": "application/json"
        }
    });
}

/**
 * Refresh the access token
 *
 */
export async function postUserCredentials(credentials: object, firebaseAccessToken: string | null, apiEndpoint: string) {
    const url = `${apiEndpoint}/oauth/credentials`;

    const response = await fetch(url, {
        method: "POST",
        headers: getHeaders(firebaseAccessToken),
        body: JSON.stringify(credentials)
    });

    if (!response.ok) {
        throw new Error(`Error: ${response.status}`);
    }

    return response.json();
}

export function getUserGoogleCredentials(
    firebaseAccessToken: string | null,
    apiEndpoint: string
): Promise<any | null> {
    return requestJson<any | null>(`${apiEndpoint}/oauth/credentials`, {
        method: "GET",
        headers: getHeaders(firebaseAccessToken)
    }, { allow404ReturnNull: true });
}

export function checkUserHasGCPPermissions(uid: string, apiEndpoint: string): Promise<boolean> {
    const url = new URL(`${apiEndpoint}/users/${uid}/has_gcp_scopes`);

    return requestJson<boolean>(url.toString(), {
        method: "GET",
        headers: {
            "Content-Type": "application/json"
        }
    });
}

export function checkUserHasGoogleSheetsPermissions(uid: string, apiEndpoint: string): Promise<boolean> {
    const url = new URL(`${apiEndpoint}/users/${uid}/has_google_sheets_scopes`);

    return requestJson<boolean>(url.toString(), {
        method: "GET",
        headers: {
            "Content-Type": "application/json"
        }
    });
}

export function checkUserHasDrivePermission(
    firebaseAccessToken: string | null,
    apiEndpoint: string
): Promise<boolean> {
    return requestJson<boolean>(`${apiEndpoint}/oauth/check_drive_scope`, {
        method: "GET",
        headers: getHeaders(firebaseAccessToken)
    });
}

export function linkGcpProjectToTeam(teamId: string,
    projectId: string,
    projectName: string,
    firebaseAccessToken: string | null,
    apiEndpoint: string): Promise<boolean> {
    return requestJson<boolean>(`${apiEndpoint}/teams/${teamId}/gcp_link`, {
        method: "POST",
        headers: getHeaders(firebaseAccessToken),
        body: JSON.stringify({
            projectId,
            projectName
        })
    });
}

export const unlinkGcpProjectFromTeam = (teamId: string,
    projectId: string,
    firebaseAccessToken: string | null,
    apiEndpoint: string): Promise<boolean> => {
    return requestJson<boolean>(`${apiEndpoint}/teams/${teamId}/gcp_link`, {
        method: "DELETE",
        headers: getHeaders(firebaseAccessToken),
        body: JSON.stringify({
            projectId
        })
    });
}

export function inviteUserToTeam(email: string,
    teamId: string,
    firebaseAccessToken: string | null,
    apiEndpoint: string): Promise<boolean> {
    return requestJson<boolean>(`${apiEndpoint}/teams/${teamId}/invite`, {
        method: "POST",
        headers: getHeaders(firebaseAccessToken),
        body: JSON.stringify({
            email,
        })
    });
}

export function deleteUserFromTeam(uid: string,
    teamId: string,
    firebaseAccessToken: string | null,
    apiEndpoint: string): Promise<boolean> {
    return requestJson<boolean>(`${apiEndpoint}/teams/${teamId}/delete_user`, {
        method: "POST",
        headers: getHeaders(firebaseAccessToken),
        body: JSON.stringify({
            deleteUid: uid
        })
    });
}

export function getDashboard(
    dashboardId: string,
    firebaseAccessToken: string | null,
    apiEndpoint: string
): Promise<Dashboard> {
    return requestJson<Dashboard>(`${apiEndpoint}/dashboards/${dashboardId}`, {
        method: "GET",
        headers: getHeaders(firebaseAccessToken),
    }, { expectDataWrapper: false });
}

export function inviteUserToDashboard(emailOrEmails: string,
    uids: string[],
    teamIds: string[],
    type: "read" | "write",
    dashboardId: string,
    firebaseAccessToken: string | null,
    apiEndpoint: string): Promise<boolean> {
    return requestJson<boolean>(`${apiEndpoint}/dashboards/${dashboardId}/invite`, {
        method: "POST",
        headers: getHeaders(firebaseAccessToken),
        body: JSON.stringify({
            uids,
            teamIds,
            email: emailOrEmails,
            type
        })
    });
}

interface DeleteUserFromDashboardParams {
    email?: string;
    teamId?: string;
    dashboardId: string;
    firebaseAccessToken: string | null;
    apiEndpoint: string;
}

export function deletePermissionFromDashboard({
    email,
    teamId,
    dashboardId,
    firebaseAccessToken,
    apiEndpoint
}: DeleteUserFromDashboardParams): Promise<boolean> {
    if (!email && !teamId) {
        throw new Error("Either email or teamId must be provided to delete a user from the dashboard.");
    }
    return requestJson<boolean>(`${apiEndpoint}/dashboards/${dashboardId}/delete_user`, {
        method: "POST",
        headers: getHeaders(firebaseAccessToken),
        body: JSON.stringify({
            email: email ?? null,
            teamId: teamId ?? null
        })
    });
}

export function refreshTeamDataSources(
    teamId: string,
    firebaseAccessToken: string | null,
    apiEndpoint: string
): Promise<DataSource[]> {
    console.log("Fetching data sources for team", {
        teamId,
    });
    return requestJson<DataSource[]>(`${apiEndpoint}/teams/${teamId}/datasources`, {
        method: "GET",
        headers: getHeaders(firebaseAccessToken),
    });
}

// Database Connections CRUD
export function listDbConnections(
    teamId: string,
    firebaseAccessToken: string | null,
    apiEndpoint: string
): Promise<DatabaseConnectionConfig[]> {
    return requestJson<DatabaseConnectionConfig[]>(`${apiEndpoint}/teams/${teamId}/db_connections`, {
        method: "GET",
        headers: getHeaders(firebaseAccessToken),
    });
}

export function createDbConnection(
    teamId: string,
    conn: Omit<DatabaseConnectionConfig, "id" | "createdAt" | "updatedAt" | "passwordCiphertext">, // passwordCiphertext is not sent from client
    firebaseAccessToken: string | null,
    apiEndpoint: string
): Promise<DatabaseConnectionConfig> { // Return type should also exclude password fields for safety, but API sends it sanitized
    return requestJson<DatabaseConnectionConfig>(`${apiEndpoint}/teams/${teamId}/db_connections`, {
        method: "POST",
        headers: getHeaders(firebaseAccessToken),
        body: JSON.stringify(conn)
    });
}

export function updateDbConnection(
    teamId: string,
    id: string,
    conn: Partial<Omit<DatabaseConnectionConfig, "passwordCiphertext">>, // passwordCiphertext is not sent from client
    firebaseAccessToken: string | null,
    apiEndpoint: string
): Promise<boolean> {
    return requestJson<boolean>(`${apiEndpoint}/teams/${teamId}/db_connections/${id}`, {
        method: "PUT",
        headers: getHeaders(firebaseAccessToken),
        body: JSON.stringify(conn)
    });
}

export function deleteDbConnection(
    teamId: string,
    id: string,
    firebaseAccessToken: string | null,
    apiEndpoint: string
): Promise<boolean> {
    return requestJson<boolean>(`${apiEndpoint}/teams/${teamId}/db_connections/${id}`, {
        method: "DELETE",
        headers: getHeaders(firebaseAccessToken),
    });
}

// Google Sheets Data Sources CRUD
export function listSheets(
    teamId: string,
    firebaseAccessToken: string | null,
    apiEndpoint: string
): Promise<DataSource[]> {
    return requestJson<DataSource[]>(`${apiEndpoint}/teams/${teamId}/sheets`, {
        method: "GET",
        headers: getHeaders(firebaseAccessToken),
    });
}

export function createSheet(
    teamId: string,
    sheet: Omit<GoogleSheetsDataSource, "id" | "type" | "uid" | "teamId" | "title">,
    firebaseAccessToken: string | null,
    apiEndpoint: string
): Promise<GoogleSheetsDataSource> {
    return requestJson<GoogleSheetsDataSource>(`${apiEndpoint}/teams/${teamId}/sheets`, {
        method: "POST",
        headers: getHeaders(firebaseAccessToken),
        body: JSON.stringify(sheet)
    });
}

export function updateSheet(
    teamId: string,
    id: string,
    sheet: Partial<GoogleSheetsDataSource>,
    firebaseAccessToken: string | null,
    apiEndpoint: string
): Promise<GoogleSheetsDataSource> {
    return requestJson<GoogleSheetsDataSource>(`${apiEndpoint}/teams/${teamId}/sheets/${id}`, {
        method: "PUT",
        headers: getHeaders(firebaseAccessToken),
        body: JSON.stringify(sheet)
    });
}

export function deleteSheet(
    teamId: string,
    id: string,
    firebaseAccessToken: string | null,
    apiEndpoint: string
): Promise<boolean> {
    return requestJson<boolean>(`${apiEndpoint}/teams/${teamId}/sheets/${id}`, {
        method: "DELETE",
        headers: getHeaders(firebaseAccessToken),
    });
}

export function testDatabaseConnection(
    firebaseAccessToken: string | null,
    apiEndpoint: string,
    databaseConnection: DatabaseConnectionConfig,
): Promise<boolean> {
    return requestJson<boolean>(`${apiEndpoint}/data/db_connections_test`, {
        method: "POST",
        headers: getHeaders(firebaseAccessToken),
        body: JSON.stringify({ database_connection: databaseConnection })
    });
}

// Supabase Management API methods

/**
 * Initiates the Supabase Management API OAuth flow.
 * @returns The authorization URL to redirect the user to.
 */
export function initiateSupabaseConnection(
    firebaseAccessToken: string | null,
    apiEndpoint: string,
    redirectUrl: string
): Promise<{ auth_url: string }> {
    return requestJson<{ auth_url: string }>(`${apiEndpoint}/supabase/connect`, {
        method: "POST",
        headers: getHeaders(firebaseAccessToken),
        body: JSON.stringify({
            redirect_url: redirectUrl
        })
    });
}

/**
 * Gets stored Supabase Management API credentials for the user.
 */
export function getSupabaseCredentials(
    firebaseAccessToken: string | null,
    apiEndpoint: string
): Promise<any | null> {
    return requestJson<any | null>(`${apiEndpoint}/supabase/management/credentials`, {
        method: "GET",
        headers: getHeaders(firebaseAccessToken)
    }, { allow404ReturnNull: true });
}

/**
 * Fetches the user's organizations from the Supabase Management API.
 */
export function getSupabaseOrganizations(
    firebaseAccessToken: string | null,
    apiEndpoint: string
): Promise<any[]> {
    return requestJson<any[]>(`${apiEndpoint}/supabase/management/organizations`, {
        method: "GET",
        headers: getHeaders(firebaseAccessToken),
    });
}

/**
 * Fetches databases for a specific Supabase project.
 */
export function getSupabaseDatabases(
    firebaseAccessToken: string | null,
    apiEndpoint: string,
    projectRef: string
): Promise<any[]> {
    return requestJson<any[]>(`${apiEndpoint}/supabase/management/databases/${projectRef}`, {
        method: "GET",
        headers: getHeaders(firebaseAccessToken),
    });
}

/**
 * Fetches the user's projects from the Supabase Management API.
 */
export function getSupabaseProjects(
    firebaseAccessToken: string | null,
    apiEndpoint: string
): Promise<any[]> {
    return requestJson<any[]>(`${apiEndpoint}/supabase/management/projects`, {
        method: "GET",
        headers: getHeaders(firebaseAccessToken),
    });
}

/**
 * Disconnects the user's Supabase integration by deleting stored credentials.
 */
export function disconnectSupabase(
    firebaseAccessToken: string | null,
    apiEndpoint: string
): Promise<boolean> {
    return requestJson<any>(`${apiEndpoint}/supabase/disconnect`, {
        method: "POST",
        headers: getHeaders(firebaseAccessToken),
    }).then(() => true);
}

// Google Sheets API methods
export interface GoogleSheetsData {
    values: any[][];
    headers: string[];
    rows: Record<string, any>[];
    spreadsheetId: string;
}

export function fetchGoogleSheetsData(
    firebaseAccessToken: string | null,
    apiEndpoint: string,
    url: string,
): Promise<GoogleSheetsData> {
    return requestJson<GoogleSheetsData>(`${apiEndpoint}/sheets/fetch`, {
        method: "POST",
        headers: getHeaders(firebaseAccessToken),
        body: JSON.stringify({
            url,
        })
    });
}

export function validateGoogleSheetsAccess(
    firebaseAccessToken: string | null,
    apiEndpoint: string,
    url: string
): Promise<{
    accessible: boolean;
    spreadsheetId: string;
    title?: string;
    error?: string;
}> {
    return requestJson(`${apiEndpoint}/sheets/validate`, {
        method: "POST",
        headers: getHeaders(firebaseAccessToken),
        body: JSON.stringify({ url })
    });
}

export interface FileRecord {
    id: string;
    teamId?: string;
    sessionId?: string;
    name: string;
    originalName: string;
    size: number;
    mimeType?: string;
    storagePath: string;
    uploadedAt: Date;
    uploaderId: string;
}

// Legacy type alias for backward compatibility
export type TeamFileRecord = FileRecord;

export async function listTeamFiles(firebaseAccessToken: string | null, apiEndpoint: string, teamId: string): Promise<FileRecord[]> {
    return requestJson<FileRecord[]>(`${apiEndpoint}/teams/${teamId}/files`, {
        method: "GET",
        headers: getHeaders(firebaseAccessToken)
    });
}

export interface UploadTeamFilesResult {
    files: FileRecord[];
    dataSources?: DataSource[];
}

export async function uploadTeamFiles(firebaseAccessToken: string | null, apiEndpoint: string, teamId: string, files: File[], names: string[]): Promise<UploadTeamFilesResult> {
    console.log("Uploading files:", files.map(f => ({
        name: f.name,
        size: f.size,
        type: f.type
    })));

    const form = new FormData();
    files.forEach(f => form.append("files", f));
    form.append("names", JSON.stringify(names));

    const headers: Record<string, string> = {};
    if (firebaseAccessToken) headers.Authorization = `Bearer ${firebaseAccessToken}`;

    // Don't set Content-Type header - let browser set it with proper boundary for multipart/form-data

    return fetch(`${apiEndpoint}/teams/${teamId}/files`, {
        method: "POST",
        headers,
        body: form
    }).then(async (res) => {
        if (!res.ok) {
            let message = "Failed to upload files";
            try {
                const data = await res.json();
                message = data.message || message;
            } catch (_) {
            }
            throw new ApiError(message);
        }
        const data = await res.json();
        return {
            files: data.data as TeamFileRecord[],
            dataSources: data.dataSources as DataSource[] | undefined
        };
    });
}

export async function deleteTeamFile(firebaseAccessToken: string | null, apiEndpoint: string, teamId: string, fileId: string): Promise<boolean> {
    const headers: Record<string, string> = {};
    if (firebaseAccessToken) headers.Authorization = `Bearer ${firebaseAccessToken}`;
    const res = await fetch(`${apiEndpoint}/teams/${teamId}/files/${fileId}`, {
        method: "DELETE",
        headers
    });
    if (!res.ok) {
        try {
            const data = await res.json();
            throw new ApiError(data.message || "Failed to delete file");
        } catch (e) {
            throw new ApiError("Failed to delete file");
        }
    }
    return true;
}

// Chat Session Files API

export interface UploadChatSessionFilesResult {
    files: FileRecord[];
    dataSources: FileDataSource[];
}

export async function uploadChatSessionFiles(
    firebaseAccessToken: string | null,
    apiEndpoint: string,
    sessionId: string,
    files: File[],
    names: string[]
): Promise<UploadChatSessionFilesResult> {
    console.log("Uploading chat session files:", files.map(f => ({
        name: f.name,
        size: f.size,
        type: f.type
    })));

    const form = new FormData();
    files.forEach(f => form.append("files", f));
    form.append("names", JSON.stringify(names));

    const headers: Record<string, string> = {};
    if (firebaseAccessToken) headers.Authorization = `Bearer ${firebaseAccessToken}`;

    return fetch(`${apiEndpoint}/chat/sessions/${sessionId}/files`, {
        method: "POST",
        headers,
        body: form
    }).then(async (res) => {
        if (!res.ok) {
            let message = "Failed to upload chat session files";
            try {
                const data = await res.json();
                message = data.message || message;
            } catch (_) {
            }
            throw new ApiError(message);
        }
        const data = await res.json();
        return {
            files: data.data as FileRecord[],
            dataSources: data.dataSources as FileDataSource[]
        };
    });
}

export async function listChatSessionFiles(
    firebaseAccessToken: string | null,
    apiEndpoint: string,
    sessionId: string
): Promise<FileRecord[]> {
    return requestJson<FileRecord[]>(`${apiEndpoint}/chat/sessions/${sessionId}/files`, {
        method: "GET",
        headers: getHeaders(firebaseAccessToken)
    });
}

export async function deleteChatSessionFile(
    firebaseAccessToken: string | null,
    apiEndpoint: string,
    sessionId: string,
    fileId: string
): Promise<boolean> {
    const headers: Record<string, string> = {};
    if (firebaseAccessToken) headers.Authorization = `Bearer ${firebaseAccessToken}`;
    const res = await fetch(`${apiEndpoint}/chat/sessions/${sessionId}/files/${fileId}`, {
        method: "DELETE",
        headers
    });
    if (!res.ok) {
        try {
            const data = await res.json();
            throw new ApiError(data.message || "Failed to delete chat session file");
        } catch (e) {
            throw new ApiError("Failed to delete chat session file");
        }
    }
    return true;
}
