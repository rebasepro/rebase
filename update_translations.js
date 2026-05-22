const fs = require('fs');
const path = require('path');

const locales = ['de', 'es', 'fr', 'it', 'pt'];
const basePath = path.join(__dirname, 'website/src/content/docs');

function processFile(filePath) {
    if (!fs.existsSync(filePath)) return;
    let content = fs.readFileSync(filePath, 'utf-8');

    // 1. Directory names
    content = content.replace(/shared\/collections/g, 'config/collections');
    content = content.replace(/shared\//g, 'config/');

    // 2. Package names
    content = content.replace(/@rebasepro\/backend/g, '@rebasepro/server-core');
    content = content.replace(/@rebasepro\/postgresql-backend/g, '@rebasepro/server-postgresql');

    // 3. Bootstrappers -> Adapter in backend/index.md and custom-server.md and architecture
    content = content.replace(/createPostgresBootstrapper/g, 'createPostgresAdapter');
    // Replace bootstrappers array with database object (simple heuristic for code blocks)
    content = content.replace(/bootstrappers:\s*\[\s*createPostgresAdapter\(\{([\s\S]*?)\}\)\s*\]/g, 'database: createPostgresAdapter({$1})');

    // 4. CLI generate SDK
    content = content.replace(/rebase generate_sdk/g, 'rebase generate-sdk');

    // 5. serveSPA
    content = content.replace(/serveSPA\(app,\s*"\.\/frontend\/dist"\);/g, 'import path from "path";\n\n// After initializeRebaseBackend()\nserveSPA(app, { frontendPath: path.resolve(process.cwd(), "../frontend/dist") });');

    // 6. STORAGE_BASE_PATH -> STORAGE_PATH
    content = content.replace(/STORAGE_BASE_PATH/g, 'STORAGE_PATH');
    
    // 7. JWT_SECRET auto-generated note in configuration.md table
    // We won't translate the note perfectly, but we can ensure the variable exists and the code blocks are right.
    
    // 8. email.smtp nesting in auth/index.md
    if (filePath.includes('auth/index.md')) {
        content = content.replace(/email:\s*\{[\s\S]*?smtpHost: "smtp.gmail.com"[\s\S]*?\}/, 
`email: {
            smtp: {
                host: "smtp.gmail.com",
                port: 587,
                secure: false,
                user: "noreply@example.com",
                pass: "app-password",
                from: "Rebase <noreply@example.com>"
            }
        }`);
        
        // OAuth providers array -> direct keys
        content = content.replace(/oauthProviders:\s*\[\s*createGoogleProvider\(process\.env\.GOOGLE_CLIENT_ID!\),\s*createLinkedinProvider\(\{[\s\S]*?clientSecret: process\.env\.LINKEDIN_CLIENT_SECRET!\s*\}\)\s*\]/, 
`google: process.env.GOOGLE_CLIENT_ID ? {
            clientId: process.env.GOOGLE_CLIENT_ID,
            clientSecret: process.env.GOOGLE_CLIENT_SECRET
        } : undefined,
        linkedin: process.env.LINKEDIN_CLIENT_ID ? {
            clientId: process.env.LINKEDIN_CLIENT_ID,
            clientSecret: process.env.LINKEDIN_CLIENT_SECRET
        } : undefined`);
    }

    // 9. configuration.md
    if (filePath.includes('configuration.md')) {
        // Just replace the whole backend config block because it's mostly code
        const backendConfigTarget = `await initializeRebaseBackend({
    app,
    server,
    collections,
    basePath: "/api",        // Base path for all API routes (default: "/api")

    database: createPostgresAdapter({
        connection: db,
        schema: { tables, enums, relations }
    }),

    auth: {                  // Authentication config
        jwtSecret: env.JWT_SECRET,
        accessExpiresIn: env.JWT_ACCESS_EXPIRES_IN,
        refreshExpiresIn: env.JWT_REFRESH_EXPIRES_IN,
        requireAuth: true,    // Require auth for data API (default: true)
        allowRegistration: env.ALLOW_REGISTRATION,
        google: {
            clientId: env.GOOGLE_CLIENT_ID
        }
    },

    storage: {               // File storage config
        type: "local",
        basePath: "./uploads"
    },`;
        const backendConfigReplacement = `await initializeRebaseBackend({
    app,
    server,
    collectionsDir: "./config/collections",
    basePath: "/api",        // Base path for all API routes (default: "/api")

    database: createPostgresAdapter({
        connection: db,
        schema: { tables, enums, relations }
    }),

    auth: {                  // Authentication config
        jwtSecret: env.JWT_SECRET,
        accessExpiresIn: env.JWT_ACCESS_EXPIRES_IN,
        refreshExpiresIn: env.JWT_REFRESH_EXPIRES_IN,
        requireAuth: true,    // Require auth for data API (default: true)
        allowRegistration: env.ALLOW_REGISTRATION,
        google: env.GOOGLE_CLIENT_ID
            ? {
                clientId: env.GOOGLE_CLIENT_ID,
                clientSecret: env.GOOGLE_CLIENT_SECRET
            }
            : undefined,
        serviceKey: env.REBASE_SERVICE_KEY
    },

    storage: env.STORAGE_TYPE === "s3"
        ? {
            type: "s3",
            bucket: env.S3_BUCKET!,
            region: env.S3_REGION,
            accessKeyId: env.S3_ACCESS_KEY_ID,
            secretAccessKey: env.S3_SECRET_ACCESS_KEY,
            endpoint: env.S3_ENDPOINT
        }
        : {
            type: "local",
            basePath: env.STORAGE_PATH || "./uploads"
        },`;
        content = content.replace(/await initializeRebaseBackend\(\{[\s\S]*?storage:\s*\{\s*type: "local",\s*basePath: "\.\/uploads"\s*\},/g, backendConfigReplacement);
        
        // Add SMTP_SECURE if missing
        if (!content.includes('SMTP_SECURE')) {
            content = content.replace(/SMTP_PORT([^\n]+)\n/, 'SMTP_PORT$1\n| `SMTP_SECURE` | Enable secure connection (`true`/`false`) |\n');
        }
    }

    fs.writeFileSync(filePath, content, 'utf-8');
}

function processAllLocales() {
    for (const locale of locales) {
        const docsPath = path.join(basePath, locale, 'docs');
        if (!fs.existsSync(docsPath)) continue;
        
        const filesToProcess = [
            'getting-started/quickstart.md',
            'getting-started/project-structure.md',
            'getting-started/configuration.md',
            'getting-started/deployment.md',
            'backend/index.md',
            'architecture/index.md',
            'cli/index.md',
            'auth/index.md',
            'recipes/blog-cms.md'
        ];

        for (const file of filesToProcess) {
            processFile(path.join(docsPath, file));
        }
    }
}

processAllLocales();
console.log("Translation docs processed!");
