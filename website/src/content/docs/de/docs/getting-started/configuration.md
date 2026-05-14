---
title: Umgebung & Konfiguration
sidebar_label: Konfiguration
description: Alle Umgebungsvariablen und Konfigurationsoptionen für Rebase-Projekte.
---

## Umgebungsvariablen

Die gesamte Konfiguration erfolgt über Umgebungsvariablen in Ihrer `.env`-Datei im Projekt-Stammverzeichnis.

> **Wichtig**: Rebase verwendet **Zod**, um Umgebungsvariablen beim Start in `src/env.ts` zu validieren. Wenn erforderliche Variablen fehlen oder falsch formatiert sind (z. B. URLs oder Ports), schlägt der Serverstart fehl und liefert eine klare Fehlermeldung.

### Erforderlich

| Variable | Beschreibung | Beispiel |
|----------|-------------|---------|
| `DATABASE_URL` | PostgreSQL-Verbindungszeichenfolge | `postgresql://user:pass@localhost:5432/mydb` |
| `JWT_SECRET` | Geheimer Schlüssel zum Signieren von JWT-Tokens. Verwenden Sie eine starke Zufallszeichenfolge (mind. 32 Zeichen). | `a1b2c3d4e5...` |

### Frontend

| Variable | Beschreibung | Standard |
|----------|-------------|---------|
| `VITE_API_URL` | Backend-API-URL. Wird vom Client-SDK verwendet. | `http://localhost:3001` |
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
| `GOOGLE_CLIENT_ID` | Google OAuth Client-ID (Backend-Validierung) | — |

### Speicher

| Variable | Beschreibung | Standard |
|----------|-------------|---------|
| `STORAGE_TYPE` | Speicher-Backend: `local` oder `s3` | `local` |
| `STORAGE_BASE_PATH` | Basispfad für lokalen Speicher | `./uploads` |
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
| `SMTP_USER` | SMTP-Benutzername |
| `SMTP_PASS` | SMTP-Passwort |
| `EMAIL_FROM` | Absenderadresse für System-E-Mails |

## Backend-Konfigurationsobjekt

Das an `initializeRebaseBackend()` übergebene `RebaseBackendConfig`-Objekt bietet programmatische Steuerung:

```typescript
import { env } from "./env";

await initializeRebaseBackend({
    app,
    server,
    collections,
    basePath: "/api",        // Base path for all API routes (default: "/api")

    bootstrappers: [         // Database and service bootstrappers
        createPostgresBootstrapper({
            connection: db,
            schema: { tables, enums, relations }
        })
    ],

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
    },

    history: true,           // Enable entity change history

    enableSwagger: true,     // Enable OpenAPI docs at /api/data/docs

    logging: {
        level: "info"
    }
});
```

## Nächste Schritte

- **[Bereitstellung](/docs/getting-started/deployment)** — Anleitung zur Produktionsbereitstellung
- **[Backend-Übersicht](/docs/backend)** — Vollständige Referenz zur Backend-Konfiguration
---
