---
title: Schnellstart
sidebar_label: Schnellstart
description: Erstellen Sie ein neues Rebase-Projekt und bringen Sie es in weniger als 2 Minuten lokal zum Laufen.
---

## Erstellen Sie ein neues Projekt

```bash
pnpm dlx @rebasepro/cli init my-app
```

Dies erstellt ein Projekt mit drei Paketen:

| Ordner | Beschreibung |
|--------|-------------|
| `frontend/` | React SPA — Vite + TypeScript mit der Rebase Admin-Benutzeroberfläche |
| `backend/` | Node.js Server — Hono, PostgreSQL über Drizzle ORM, WebSocket |
| `shared/` | TypeScript-Sammlungsdefinitionen, die von beiden Seiten geteilt werden |

## Voraussetzungen

- **Node.js** 18+
- **PostgreSQL** — lokale Installation, Docker oder eine beliebige verwaltete Datenbank (Neon, Supabase usw.)
- **pnpm** (empfohlen) oder npm

## Konfigurieren Sie Ihre Umgebung

Nach der Generierung bearbeiten Sie die Datei `.env` im Projektstammverzeichnis:

```bash
# PostgreSQL connection string
DATABASE_URL=postgresql://username:password@localhost:5432/your_database

# JWT secret for authentication (generate a strong random string)
JWT_SECRET=change-me-to-a-random-secret

# Frontend URL for CORS
VITE_API_URL=http://localhost:3001

# Optional: Google OAuth client ID
# VITE_GOOGLE_CLIENT_ID=your-google-client-id
```

## Starten Sie die Entwicklungs-Server

```bash
pnpm dev
```

Dies startet:
- **Backend** unter `http://localhost:3001` — REST API, Authentifizierung, Speicher, WebSocket
- **Frontend** unter `http://localhost:5173` — Rebase Admin-Panel
- **Hot-Reload** für beides — Änderungen werden sofort wirksam

Sie können sie auch einzeln starten:

```bash
pnpm dev:backend   # Backend only
pnpm dev:frontend  # Frontend only
```

## Erster Login

Wenn Sie `http://localhost:5173` öffnen, sehen Sie den Anmeldebildschirm. Der **erste Benutzer**, der sich registriert, wird automatisch zum Administrator – dies ist der Bootstrap-Prozess.

1. Klicken Sie auf **Registrieren**
2. Geben Sie Ihre E-Mail-Adresse und Ihr Passwort ein
3. Sie sind drin — mit vollem Administratorzugriff

## Definieren Sie Ihre erste Sammlung

Öffnen Sie `shared/collections/` und erstellen Sie eine neue Datei:

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

## Datenbank-Schema generieren

```bash
rebase schema generate   # Generate Drizzle schema from your collections
rebase db push           # Push the schema to your database
```

Starten Sie die Entwicklungs-Server neu und Ihre neue **Produkte**-Sammlung erscheint in der Navigation.

## Referenz der Datenbank-Befehle

| Befehl | Beschreibung |
|---------|-------------|
| `rebase schema generate` | Drizzle-Schema aus Ihren TypeScript-Sammlungen generieren |
| `rebase db push` | Schema-Änderungen direkt an die Datenbank übertragen (nur Entwicklung) |
| `rebase db generate` | SQL-Migrationsdateien generieren |
| `rebase db migrate` | Ausstehende Migrationen ausführen |

## Was kommt als Nächstes

- **[Projektstruktur](/docs/getting-started/project-structure)** — Verstehen Sie den generierten Code
- **[Sammlungen](/docs/collections)** — Ausführlicher Einblick in die Schema-Definition
- **[Umgebung & Konfiguration](/docs/getting-started/configuration)** — Alle Konfigurationsoptionen
- **[Bereitstellung](/docs/getting-started/deployment)** — In Produktion bereitstellen

---
