// Defines the supported database types
export type DatabaseType  = "mysql" | "postgresql";

export interface DatabaseConnectionConfig {
    /**
     * Unique identifier for this database connection.
     * e.g., generated UUID.
     */
    id: string;

    /**
     * User-friendly name or alias for this connection.
     * e.g., "Production Reporting DB", "Staging Analytics Postgres"
     */
    name: string;

    /**
     * The type of the database.
     */
    type: DatabaseType;

    /**
     * Identifier for the team or workspace this connection belongs to.
     * Essential for multi-tenancy.
     */
    teamId: string;

    /**
     * Database server hostname or IP address.
     */
    host: string;

    /**
     * Port number for the database server.
     * MySQL default: 3306
     * PostgreSQL default: 5432
     */
    port: number;

    /**
     * Username for database authentication.
     */
    user: string;

    /**
     * Plaintext password for database authentication.
     * This field is only used when creating or updating a password.
     * It should NOT be stored directly in the database.
     * It should NOT be returned by API GET calls.
     */
    password?: string;

    /**
     * Encrypted password for database authentication, stored in the database.
     * This is the result of encrypting the 'password' field using KMS.
     */
    passwordCiphertext?: string;

    /**
     * The name of the specific database to connect to on the server.
     */
    databaseName: string;

    /**
     * Optional SSL/TLS configuration.
     */
    sslConfig?: SSLConfig;

    /**
     * Optional additional JDBC or driver parameters as a key-value store or string.
     * e.g., { "allowPublicKeyRetrieval": "true" } for some MySQL setups.
     * Or as a string: "param1=value1&param2=value2"
     */
    additionalParams?: Record<string, string> | string;

    /**
     * Timeout for establishing the connection in milliseconds.
     */
    connectionTimeout?: number; // in milliseconds

    /**
     * Maximum number of connections for a pool, if you implement pooling on your side.
     */
    maxPoolSize?: number;

    /**
     * Timestamp of when this connection configuration was created.
     * ISO 8601 format string or Date object.
     */
    createdAt: string | Date;

    /**
     * Timestamp of when this connection configuration was last updated.
     * ISO 8601 format string or Date object.
     */
    updatedAt: string | Date;

    /**
     * Identifier of the user who created this connection configuration.
     */
    createdByUserId?: string;

    /**
     * Identifier of the user who last updated this connection configuration.
     */
    lastUpdatedByUserId?: string;

    /**
     * A flag to indicate if the connection is currently active/usable or disabled.
     * @default true
     */
    isEnabled?: boolean;

    /**
     * Stores the result of the last connection test (e.g., "SUCCESS", "FAILED_AUTH", "FAILED_UNREACHABLE").
     */
    lastTestStatus?: 'PENDING' | 'SUCCESS' | 'FAILED_AUTH' | 'FAILED_UNREACHABLE' | 'FAILED_SSL' | 'ERROR_CONFIG' | 'UNKNOWN';

    /**
     * Timestamp of the last connection test.
     */
    lastTestAt?: string | Date;

    /**
     * Any message or error details from the last connection test.
     */
    lastTestMessage?: string;
}


// Interface for SSL/TLS configuration options
export interface SSLConfig {
    /**
     * Enable or disable SSL/TLS for the connection.
     * @default false
     */
    enabled: boolean;

    /**
     * Certificate Authority (CA) certificate string.
     * Required if the server uses a self-signed certificate or a CA not trusted by the client's system.
     */
    ca?: string;

    /**
     * Client certificate string.
     * Required if the database server requires client certificate authentication.
     */
    cert?: string;

    /**
     * Client private key string.
     * Required if the database server requires client certificate authentication.
     */
    key?: string;

    /**
     * If true, the server's certificate will not be verified against the CA.
     * Use with caution, primarily for development/testing.
     * @default false
     */
    rejectUnauthorized?: boolean;

    /**
     * For PostgreSQL, this can be 'verify-ca' or 'verify-full'.
     * For MySQL, specific ssl mode.
     * Consult driver documentation for specific values like 'require', 'verify-ca', 'verify-full'.
     */
    mode?: string;
}
