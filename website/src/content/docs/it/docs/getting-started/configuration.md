---
sourceHash: 3346d2728eb8f2e4
title: Ambiente e Configurazione
sidebar_label: Configurazione
description: Tutte le variabili d'ambiente e le opzioni di configurazione per i progetti Rebase.
---

## Variabili d'ambiente

Tutta la configurazione viene gestita tramite variabili d'ambiente nel tuo file `.env` alla radice del progetto.

> **Importante**: Rebase convalida le variabili d'ambiente con **Zod** all'avvio.
> Se manca qualcosa di obbligatorio o è malformato (un URL che non è un URL, una
> porta che non è un numero), il server rifiuta di avviarsi e nomina la variabile.
>
> Dove si trova lo schema dipende da come esegui il backend. Un progetto avviato
> dal runtime — `rebase dev`, `rebase start`, l'immagine pubblicata — usa lo schema
> del runtime stesso (`loadBootEnv` in `@rebasepro/server`), che è l'unione di
> tutte le tabelle qui sotto. Un progetto che ha eseguito
> [`rebase eject`](/docs/cli) possiede un proprio `backend/src/env.ts` con
> `loadEnv({ extend })`, e può aggiungervi le proprie variabili tipizzate.

### Obbligatorie

| Variabile | Descrizione | Esempio |
|----------|-------------|---------|
| `DATABASE_URL` | Stringa di connessione PostgreSQL | `postgresql://user:pass@localhost:5432/mydb` |
| `JWT_SECRET` | Chiave segreta per la firma dei token JWT. Utilizzare una stringa casuale forte (min 32 caratteri). | `a1b2c3d4e5...` |

### Frontend

| Variabile | Descrizione | Predefinito |
|----------|-------------|---------|
| `VITE_API_URL` | URL dell'API backend per l'SDK client. **Impostalo solo in sviluppo.** | origine della pagina |
| `VITE_GOOGLE_CLIENT_ID` | ID client Google OAuth. Abilita "Accedi con Google". | — |

### Backend

| Variabile | Descrizione | Predefinito |
|----------|-------------|---------|
| `PORT` | Porta per il server HTTP del backend | `3001` |
| `LOG_LEVEL` | Verbosità del logging: `error`, `warn`, `info`, `debug` | `info` |
| `NODE_ENV` | Ambiente: `development` o `production` | `development` |

### Autenticazione

| Variabile | Descrizione | Predefinito |
|----------|-------------|---------|
| `JWT_SECRET` | Segreto per la firma JWT (richiesto se l'autenticazione è abilitata) | — |
| `JWT_ACCESS_EXPIRES_IN` | Durata del token di accesso | `1h` |
| `JWT_REFRESH_EXPIRES_IN` | Durata del token di refresh | `30d` |
| `ALLOW_REGISTRATION` | Consente ai nuovi utenti di registrarsi (`true`/`false`). Il primo utente può sempre registrarsi. | `true` |
| `GOOGLE_CLIENT_ID` | ID client Google OAuth (validazione backend) | — |

### Archiviazione

| Variabile | Descrizione | Predefinito |
|----------|-------------|---------|
| `STORAGE_TYPE` | Backend di archiviazione: `local` o `s3` | `local` |
| `STORAGE_PATH` | Percorso base per l'archiviazione locale | `./uploads` |
| `S3_BUCKET` | Nome del bucket S3 (quando `STORAGE_TYPE=s3`) | — |
| `S3_REGION` | Regione AWS | — |
| `S3_ACCESS_KEY_ID` | Chiave di accesso AWS | — |
| `S3_SECRET_ACCESS_KEY` | Chiave segreta AWS | — |
| `S3_ENDPOINT` | Endpoint S3 personalizzato (per MinIO, Cloudflare R2, ecc.) | — |

### Email (Opzionale)

| Variabile | Descrizione |
|----------|-------------|
| `SMTP_HOST` | Host del server SMTP |
| `SMTP_PORT` | Porta del server SMTP |
| `SMTP_SECURE` | Enable secure connection (`true`/`false`) |
| `SMTP_USER` | Nome utente SMTP |
| `SMTP_PASS` | Password SMTP |
| `EMAIL_FROM` | Indirizzo del mittente per le email di sistema |

## Oggetto di Configurazione del Backend

Il `RebaseBackendConfig` passato a `initializeRebaseBackend()` fornisce controllo programmatico:

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

## Prossimi Passi

- **[Deployment](/docs/getting-started/deployment)** — Guida al deployment in produzione
- **[Panoramica del Backend](/docs/backend)** — Riferimento completo alla configurazione del backend

---
