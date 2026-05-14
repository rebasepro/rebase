---
title: Avvio Rapido
sidebar_label: Avvio Rapido
slug: it/docs/getting-started/quickstart
description: Crea un nuovo progetto Rebase e avvialo localmente in meno di 2 minuti.
---

## Crea un Nuovo Progetto

```bash
pnpm dlx @rebasepro/cli init my-app
```

Questo crea la struttura di un progetto con tre pacchetti:

| Cartella | Descrizione |
|--------|-------------|
| `frontend/` | SPA React — Vite + TypeScript con l'interfaccia utente di amministrazione Rebase |
| `backend/` | Server Node.js — Hono, PostgreSQL tramite Drizzle ORM, WebSocket |
| `shared/` | Definizioni di collezioni TypeScript condivise da entrambi i lati |

## Prerequisiti

- **Node.js** 18+
- **PostgreSQL** — installazione locale, Docker o qualsiasi database gestito (Neon, Supabase, ecc.)
- **pnpm** (consigliato) o npm

## Configura il tuo Ambiente

Dopo aver creato la struttura, modifica il file `.env` nella root del progetto:

```bash
# Stringa di connessione PostgreSQL
DATABASE_URL=postgresql://username:password@localhost:5432/your_database

# Segreto JWT per l'autenticazione (genera una stringa casuale robusta)
JWT_SECRET=change-me-to-a-random-secret

# URL Frontend per CORS
VITE_API_URL=http://localhost:3001

# Opzionale: ID client Google OAuth
# VITE_GOOGLE_CLIENT_ID=your-google-client-id
```

## Avvia i Server di Sviluppo

```bash
pnpm dev
```

Questo avvia:
- **Backend** all'indirizzo `http://localhost:3001` — API REST, autenticazione, storage, WebSocket
- **Frontend** all'indirizzo `http://localhost:5173` — Pannello di amministrazione Rebase
- **Hot reload** per entrambi — le modifiche hanno effetto istantaneamente

Puoi anche avviarle individualmente:

```bash
pnpm dev:backend   # Solo Backend
pnpm dev:frontend  # Solo Frontend
```

## Primo Accesso

Quando apri `http://localhost:5173`, vedrai la schermata di accesso. Il **primo utente** a registrarsi diventa automaticamente un amministratore — questo è il flusso di bootstrap.

1. Clicca su **Registrati**
2. Inserisci la tua email e password
3. Sei dentro — con accesso amministrativo completo

## Definisci la Tua Prima Collezione

Apri `shared/collections/` e crea un nuovo file:

```typescript title="shared/collections/products.ts"
import { EntityCollection } from "@rebasepro/types";

export const productsCollection: EntityCollection = {
    slug: "products",
    name: "Products",
    singularName: "Product",
    table: "products",
    properties: {
        name: {
            type: "string",
            name: "Name",
            validation: { required: true }
        },
        price: {
            type: "number",
            name: "Price",
            validation: { required: true, min: 0 }
        },
        description: {
            type: "string",
            name: "Description",
            multiline: true
        },
        active: {
            type: "boolean",
            name: "Active",
            defaultValue: true
        },
        created_at: {
            type: "date",
            name: "Created At",
            autoValue: "on_create"
        }
    }
};
```

## Genera lo Schema del Database

```bash
rebase schema generate   # Genera lo schema Drizzle dalle tue collezioni
rebase db push           # Invia lo schema al tuo database
```

Riavvia i server di sviluppo e la tua nuova collezione **Prodotti** apparirà nella navigazione.

## Riferimento ai Comandi del Database

| Comando | Descrizione |
|---------|-------------|
| `rebase schema generate` | Genera lo schema Drizzle dalle tue collezioni TypeScript |
| `rebase db push` | Invia le modifiche allo schema direttamente al database (solo dev) |
| `rebase db generate` | Genera i file di migrazione SQL |
| `rebase db migrate` | Esegui le migrazioni in sospeso |

## Cosa Succede Dopo

- **[Struttura del Progetto](/docs/getting-started/project-structure)** — Comprendi il codice generato
- **[Collezioni](/docs/collections)** — Approfondimento sulla definizione dello schema
- **[Ambiente e Configurazione](/docs/getting-started/configuration)** — Tutte le opzioni di configurazione
- **[Deployment](/docs/getting-started/deployment)** — Distribuisci in produzione

---
