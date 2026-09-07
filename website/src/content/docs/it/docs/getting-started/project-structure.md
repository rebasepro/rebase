---
sourceHash: 8fb63312e30e41a2
title: Struttura del Progetto
sidebar_label: Struttura del Progetto
description: Comprendi la struttura di un progetto Rebase — frontend, backend e collezioni condivise.
---

Un progetto starter Rebase ha tre pacchetti interconnessi:

```
my-app/
├── .env                    # Environment variables (DATABASE_URL, JWT_SECRET, etc.)
├── package.json            # Root workspace config
│
├── frontend/               # React admin panel (Vite)
│   ├── src/
│   │   ├── App.tsx         # Main application component
│   │   ├── main.tsx        # React entry point
│   │   └── index.css       # Global styles
│   ├── package.json
│   └── vite.config.ts
│
├── backend/                # Node.js API server (Hono)
│   ├── src/
│   │   ├── index.ts        # Server entry — initializes Rebase backend
│   │   └── schema.generated.ts  # Auto-generated Drizzle schema
│   ├── drizzle.config.ts   # Drizzle ORM configuration
│   ├── Dockerfile
│   └── package.json
│
└── config/                 # Collection definitions
    └── collections/
        ├── index.ts        # Exports all collections
        └── products.ts     # Example: products collection
```

## Frontend (`frontend/`)

Il frontend è un'applicazione standard **Vite + React + TypeScript**. Il file chiave è `App.tsx`, che collega tutti i controller di Rebase:

```typescript title="frontend/src/App.tsx"
import { Rebase } from "@rebasepro/app";
import { Scaffold, AppBar, Drawer } from "@rebasepro/cms";
import { createRebaseClient } from "@rebasepro/client";
import { collections } from "virtual:rebase-collections";

// The client connects to your backend API and WebSocket
const rebaseClient = createRebaseClient({
    baseUrl: import.meta.env.VITE_API_URL
});

// Collections are imported via a Vite virtual module
// that reads from the config/ directory
```

### Concetti Chiave

- **`createRebaseClient`** — Crea il client SDK che gestisce le richieste HTTP, le connessioni WebSocket e la gestione dei token di autenticazione
- **`virtual:rebase-collections`** — Un plugin Vite che importa automaticamente le tue collezioni condivise al momento della build
- **Controller** — `useBuildNavigationStateController`, `useBuildCollectionRegistryController`, ecc. — questi configurano il routing, la risoluzione delle collezioni e la configurazione dell'interfaccia utente

## Backend (`backend/`)

Il backend è un **server Node.js** basato su [Hono](https://hono.dev/) (un framework HTTP veloce e leggero). Il punto di ingresso `index.ts` inizializza tutto:

```typescript title="backend/src/index.ts"
import { initializeRebaseBackend } from "@rebasepro/server";
import { createPostgresAdapter } from "@rebasepro/server-postgres";
import { Hono } from "hono";
import type { HonoEnv } from "@rebasepro/server";

const app = new Hono<HonoEnv>();

await initializeRebaseBackend({
    app,
    server,
    collectionsDir: "./config/collections",
    database: createPostgresAdapter({
            connection: db,
            schema: { tables, enums, relations }
        }),
    auth: {
        jwtSecret: process.env.JWT_SECRET!,
        google: { clientId: process.env.GOOGLE_CLIENT_ID },
    },
    storage: {
        type: "local",
        basePath: "./uploads"
    },
    history: true
});
```

`initializeRebaseBackend` configura:
- **API REST** routes a `/api/data/*` — CRUD auto-generato per ogni collezione
- **Auth** routes a `/api/auth/*` — registrazione, login, refresh, OAuth
- **Storage** routes a `/api/storage/*` — caricamento/download di file
- **Server WebSocket** — sincronizzazione di entità in tempo reale tramite Postgres LISTEN/NOTIFY
- **Cronologia** — registrazione del log di audit su ogni modifica dell'entità

## Collezioni Condivise (`config/`)

Le collezioni sono la **singola fonte di verità** per il tuo modello di dati. Sono definite in TypeScript e utilizzate sia dal frontend (per la generazione dell'interfaccia utente) che dal backend (per la generazione dello schema e il routing delle API).

```typescript title="config/collections/products.ts"
import { defineCollection } from "@rebasepro/cms-types";

export const productsCollection = defineCollection({
    slug: "products",
    name: "Products",
    table: "products",
    properties: {
        name: { type: "string", name: "Name" },
        price: { type: "number", name: "Price" }
    }
});
```

Lo `slug` diventa il percorso URL nell'interfaccia utente di amministrazione e l'endpoint dell'API REST (`/api/data/products`). La `table` mappa al nome della tabella PostgreSQL.

## Come Si Connettono

1. **Definisci** le collezioni in `config/`
2. **Il backend** le legge per generare gli schemi Drizzle e montare le route REST
3. **Il frontend** le legge (tramite plugin Vite) per renderizzare tabelle, form e navigazione
4. **La CLI** le legge per generare i file di migrazione con `rebase schema generate`

Le modifiche alle collezioni si propagano automaticamente ovunque.

## Prossimi Passi

- **[Guida Rapida](/docs/getting-started/quickstart)** — Inizia con un nuovo progetto Rebase
- **[Configurazione](/docs/getting-started/configuration)** — Tutte le variabili d'ambiente e le opzioni

---
