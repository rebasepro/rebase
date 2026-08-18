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
| `config/` | TypeScript-Sammlungsdefinitionen, die von beiden Seiten geteilt werden |

## Voraussetzungen

- **Node.js** 18+
- **Docker** — um den mitgelieferten PostgreSQL-Container auszuführen. (Oder bringen Sie Ihre eigene PostgreSQL mit: lokale Installation, Neon, Supabase usw.)
- **pnpm** (empfohlen) oder npm

## Ihre Umgebung ist bereits konfiguriert

`init` generiert eine sofort einsatzbereite `.env` im Projektstammverzeichnis mit einem echten `JWT_SECRET`, einem Datenbank-Passwort und einem freien lokalen Datenbank-Port. Sie müssen nichts erstellen oder bearbeiten, um loszulegen.

:::caution
Führen Sie nicht `cp .env.example .env` aus. `.env.example` ist eine Referenz für die verfügbaren Variablen — sie über Ihre `.env` zu kopieren verwirft die generierten Geheimnisse und lässt `DATABASE_URL` auf eine nicht existierende Datenbank zeigen. Bearbeiten Sie `.env` direkt, wenn Sie einen Wert ändern möchten.
:::

Wenn Sie lieber auf Ihre eigene PostgreSQL statt auf den mitgelieferten Container zeigen möchten, bearbeiten Sie `DATABASE_URL` in `.env`:

```bash
DATABASE_URL=postgresql://username:password@localhost:5432/your_database
```

## Starten Sie die Datenbank

Der Scaffold liefert eine `docker-compose.yml` mit einem PostgreSQL-Dienst. Starten Sie ihn:

```bash
docker compose up -d db
```

(Überspringen Sie dies, wenn Sie `DATABASE_URL` auf Ihre eigene Datenbank ausgerichtet haben.)

## Erstellen Sie die Tabellen

Übertragen Sie Ihre Sammlungen in die Datenbank. Dies erstellt die Tabellen für die Beispiel-Sammlungen `posts`, `authors` und `tags`:

```bash
pnpm run db:push
```

Ohne diesen Schritt öffnet sich das Admin-Panel zwar trotzdem, aber jede Sammlung ist leer und ihre API-Aufrufe schlagen fehl, bis die Tabellen existieren.

## Eine bestehende Datenbank introspektieren (Optional)

Wenn Sie eine Verbindung zu einer bestehenden Datenbank mit bereits vorhandenen Tabellen herstellen, können Sie diese introspektieren, um Ihre TypeScript-Sammlungsdateien automatisch zu generieren:

```bash
pnpm rebase schema introspect
```

Dies analysiert Ihre Datenbanktabellen, Enums und Beziehungen und schreibt die entsprechenden Sammlungsdateien in `config/collections/`.

## Starten Sie die Entwicklungs-Server

```bash
pnpm dev
```

Dies startet beide zusammen:
- **Backend** — REST API, Authentifizierung, Speicher, WebSocket
- **Frontend** — das Rebase Admin-Panel
- **Hot-Reload** für beides — Änderungen werden sofort wirksam

Beide Ports werden **aus dem Projektpfad abgeleitet** statt fest vergeben, sodass
mehrere Rebase-Projekte parallel laufen können. `rebase dev` gibt die beiden
gebundenen URLs aus — verwenden Sie diese, nicht `localhost:3001`/`localhost:5173`.
(`PORT` und `VITE_API_URL` in `.env` konfigurieren `rebase start`, den
Produktionsserver, und werden hier ignoriert.) Mit `rebase dev --port 3001` legen
Sie einen festen Port fest.

## Erster Login

Wenn Sie die von `rebase dev` ausgegebene Frontend-URL öffnen, sehen Sie den Anmeldebildschirm. Der **erste Benutzer**, der sich registriert, wird automatisch zum Administrator – dies ist der Bootstrap-Prozess.

1. Klicken Sie auf **Registrieren**
2. Geben Sie Ihre E-Mail-Adresse und Ihr Passwort ein
3. Sie sind drin — mit vollem Administratorzugriff

## Definieren Sie Ihre erste Sammlung

Öffnen Sie `config/collections/` und erstellen Sie eine neue Datei. Exportieren Sie die Sammlung als **Default-Export** — so wird sie von der Registry erkannt:

```typescript title="config/collections/products.ts"
import { defineCollection } from "@rebasepro/admin-types";

const productsCollection = defineCollection({
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
            admin: { multiline: true }
        },
        active: {
            type: "boolean",
            name: "Active",
            defaultValue: true
        },
        createdAt: {
            type: "date",
            name: "Created At",
            autoValue: "on_create"
        }
    }
});

export default productsCollection;
```

Registrieren Sie sie anschließend in `config/collections/index.ts`, damit sowohl das Backend als auch das Admin-Panel davon wissen:

```typescript title="config/collections/index.ts" {2,5}
// ...existing imports
import productsCollection from "./products.js";

export const collections = [
    postsCollection, authorsCollection, tagsCollection, usersCollection, productsCollection
];
```

## Erstellen Sie die Tabelle

Übertragen Sie die neue Sammlung in die Datenbank:

```bash
pnpm run db:push
```

Dies regeneriert das Schema aus Ihren Sammlungen und wendet es an. Starten Sie die Entwicklungs-Server neu und Ihre neue **Produkte**-Sammlung erscheint in der Navigation.

## Referenz der Datenbank-Befehle

| Befehl | Beschreibung |
|---------|-------------|
| `rebase schema generate` | Drizzle-Schema aus Ihren TypeScript-Sammlungen generieren |
| `rebase schema introspect` | TypeScript-Sammlungen aus einer bestehenden Datenbank generieren |
| `rebase db push` | Schema-Änderungen direkt an die Datenbank übertragen (nur Entwicklung) |
| `rebase db generate` | SQL-Migrationsdateien generieren |
| `rebase db migrate` | Ausstehende Migrationen ausführen |

## Was kommt als Nächstes

- **[Projektstruktur](/docs/getting-started/project-structure)** — Verstehen Sie den generierten Code
- **[Sammlungen](/docs/collections)** — Ausführlicher Einblick in die Schema-Definition
- **[Umgebung & Konfiguration](/docs/getting-started/configuration)** — Alle Konfigurationsoptionen
- **[Bereitstellung](/docs/getting-started/deployment)** — In Produktion bereitstellen

---
