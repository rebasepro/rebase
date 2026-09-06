---
sourceHash: 2078e2f99041a59e
title: Umgebung & Konfiguration
sidebar_label: Konfiguration
description: Alle Umgebungsvariablen und Konfigurationsoptionen für Rebase-Projekte.
---

## Umgebungsvariablen

Die gesamte Konfiguration erfolgt über Umgebungsvariablen in Ihrer `.env`-Datei im Projekt-Stammverzeichnis.

> **Wichtig**: Rebase validiert Umgebungsvariablen beim Start mit **Zod**. Fehlt
> etwas Erforderliches oder ist es falsch formatiert (eine URL, die keine ist, ein
> Port, der keine Zahl ist), verweigert der Server den Start und nennt die Variable.
>
> Wo das Schema liegt, hängt davon ab, wie Sie das Backend betreiben. Ein von der
> Runtime gebootetes Projekt — `rebase dev`, `rebase start`, das veröffentlichte
> Image — verwendet das Schema der Runtime (`loadBootEnv` in `@rebasepro/server`),
> die Vereinigung aller Tabellen unten. Ein Projekt, das [`rebase eject`](/docs/cli)
> ausgeführt hat, besitzt eine eigene `backend/src/env.ts` mit
> `loadEnv({ extend })` und kann dort eigene typisierte Variablen ergänzen.

### Erforderlich

| Variable | Beschreibung | Beispiel |
|----------|-------------|---------|
| `DATABASE_URL` | PostgreSQL-Verbindungszeichenfolge | `postgresql://user:pass@localhost:5432/mydb` |
| `JWT_SECRET` | Geheimer Schlüssel zum Signieren von JWT-Tokens. Verwenden Sie eine starke Zufallszeichenfolge (mind. 32 Zeichen). | `a1b2c3d4e5...` |

### Frontend

| Variable | Beschreibung | Standard |
|----------|-------------|---------|
| `VITE_API_URL` | Backend-API-URL für das Client-SDK. **Nur in der Entwicklung setzen.** | Ursprung der Seite |
| `VITE_GOOGLE_CLIENT_ID` | Google OAuth Client-ID. Ermöglicht "Mit Google anmelden". | — |

### Backend

| Variable | Beschreibung | Standard |
|----------|-------------|---------|
| `PORT` | Port für den Backend-HTTP-Server | `3001` |
| `LOG_LEVEL` | Logging-Ausführlichkeit: `error`, `warn`, `info`, `debug` | `info` |
| `NODE_ENV` | Umgebung: `development` oder `production` | `development` |

### Authentifizierung

| Variable | Beschreibung | Standard |
|----------|-------------|---------|
| `JWT_SECRET` | Geheimnis für JWT-Signierung (erforderlich, wenn Authentifizierung aktiviert ist) | — |
| `JWT_ACCESS_EXPIRES_IN` | Lebensdauer des Zugriffstokens | `1h` |
| `JWT_REFRESH_EXPIRES_IN` | Lebensdauer des Refresh-Tokens | `30d` |
| `ALLOW_REGISTRATION` | Ermöglicht neuen Benutzern die Registrierung (`true`/`false`). Der erste Benutzer kann sich immer registrieren. | `true` |
| `AUTH_COOKIE_SECURE` | `Secure` am Refresh-Cookie. Standardmäßig an; `AUTH_COOKIE_SECURE=false` für einfaches HTTP — etwa eine Bereitstellung unter einer LAN-Adresse, bei der der Browser das Cookie sonst verwirft und die Sitzung beim Ablauf des Access-Tokens ohne Fehlermeldung endet. Der Start warnt dann. `http://localhost` braucht das nicht. | `true` |
| `GOOGLE_CLIENT_ID` | Google OAuth Client-ID (Backend-Validierung) | — |

### Speicher

| Variable | Beschreibung | Standard |
|----------|-------------|---------|
| `STORAGE_TYPE` | Speicher-Backend: `local` oder `s3` | `local` |
| `STORAGE_PATH` | Basispfad für lokalen Speicher | `./uploads` |
| `S3_BUCKET` | S3-Bucket-Name (wenn `STORAGE_TYPE=s3`) | — |
| `S3_REGION` | AWS-Region | — |
| `S3_ACCESS_KEY_ID` | AWS-Zugriffsschlüssel | — |
| `S3_SECRET_ACCESS_KEY` | AWS-Geheimschlüssel | — |
| `S3_ENDPOINT` | Benutzerdefinierter S3-Endpunkt (für MinIO, Cloudflare R2, etc.) | — |

### E-Mail (Optional)

| Variable | Beschreibung |
|----------|-------------|
| `SMTP_HOST` | SMTP-Server-Host |
| `SMTP_PORT` | SMTP-Server-Port |
| `SMTP_SECURE` | Enable secure connection (`true`/`false`) |
| `SMTP_USER` | SMTP-Benutzername |
| `SMTP_PASS` | SMTP-Passwort |
| `EMAIL_FROM` | Absenderadresse für System-E-Mails |

## Backend-Konfigurationsobjekt

Das an `initializeRebaseBackend()` übergebene `RebaseBackendConfig`-Objekt bietet programmatische Steuerung:

```typescript
import { initializeRebaseBackend } from "@rebasepro/server";
import { createPostgresAdapter } from "@rebasepro/server-postgres";
import { env } from "./env";

await initializeRebaseBackend({
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
        },

    history: true,           // Enable entity change history

    enableSwagger: true,     // Enable OpenAPI docs at /api/docs

    logging: {
        level: "info"
    }
});
```

## Nächste Schritte

- **[Bereitstellung](/docs/getting-started/deployment)** — Anleitung zur Produktionsbereitstellung
- **[Backend-Übersicht](/docs/backend)** — Vollständige Referenz zur Backend-Konfiguration
---
