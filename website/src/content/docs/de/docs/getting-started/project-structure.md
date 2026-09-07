---
sourceHash: 8fb63312e30e41a2
title: Projektstruktur
sidebar_label: Projektstruktur
description: Verstehen Sie die Struktur eines Rebase-Projekts – Frontend, Backend und gemeinsame Collections.
---

Ein Rebase-Starterprojekt besteht aus drei miteinander verbundenen Paketen:

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

Das Frontend ist eine Standard **Vite + React + TypeScript** Anwendung. Die Schlüsselfile ist `App.tsx`, welche alle Rebase-Controller miteinander verbindet:

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

### Schlüsselkonzepte

- **`createRebaseClient`** — Erstellt den SDK-Client, der HTTP-Anfragen, WebSocket-Verbindungen und die Verwaltung von Auth-Tokens handhabt
- **`virtual:rebase-collections`** — Ein Vite-Plugin, das Ihre gemeinsam genutzten Collections zur Build-Zeit automatisch importiert
- **Controller** — `useBuildNavigationStateController`, `useBuildCollectionRegistryController`, etc. — diese konfigurieren Routing, Collection-Auflösung und UI-Konfiguration

## Backend (`backend/`)

Das Backend ist ein **Node.js-Server**, der auf [Hono](https://hono.dev/) (einem schnellen, leichtgewichtigen HTTP-Framework) basiert. Der Einstiegspunkt `index.ts` initialisiert alles:

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

`initializeRebaseBackend` richtet Folgendes ein:
- **REST-API**-Routen unter `/api/data/*` – automatisch generiertes CRUD für jede Collection
- **Auth**-Routen unter `/api/auth/*` – Registrierung, Login, Refresh, OAuth
- **Storage**-Routen unter `/api/storage/*` – Datei-Upload/-Download
- **WebSocket**-Server – Echtzeit-Entitätssynchronisation über Postgres LISTEN/NOTIFY
- **Verlauf** – Aufzeichnung von Audit-Trails bei jeder Entitätsänderung

## Gemeinsame Collections (`config/`)

Collections sind die **einzige Quelle der Wahrheit** für Ihr Datenmodell. Sie werden als TypeScript definiert und sowohl vom Frontend (für die UI-Generierung) als auch vom Backend (für die Schema-Generierung und das API-Routing) konsumiert.

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

Der `slug` wird zum URL-Pfad in der Admin-Benutzeroberfläche und zum REST-API-Endpunkt (`/api/data/products`). Die `table` bildet den Namen der PostgreSQL-Tabelle ab.

## Wie sie sich verbinden

1.  **Sie definieren** Collections in `config/`
2.  **Das Backend** liest diese, um Drizzle-Schemas zu generieren und REST-Routen zu mounten
3.  **Das Frontend** liest diese (über das Vite-Plugin), um Tabellen, Formulare und Navigation zu rendern
4.  **Die CLI** liest diese, um Migrationsdateien mit `rebase schema generate` zu generieren

Änderungen an Collections verbreiten sich automatisch überall.

## Nächste Schritte

- **[Quickstart](/docs/getting-started/quickstart)** – Beginnen Sie mit einem neuen Rebase-Projekt
- **[Konfiguration](/docs/getting-started/configuration)** – Alle Umgebungsvariablen und Optionen
---
