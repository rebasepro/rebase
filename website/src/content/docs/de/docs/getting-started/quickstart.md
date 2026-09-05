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
- **pnpm** (empfohlen) oder npm

Keine Datenbank zu installieren, und kein Docker. `rebase dev` betreibt eine verwaltete PostgreSQL für das Projekt, deren Daten unter `.rebase/` liegen. Siehe [Variante: Ihre eigene PostgreSQL](#variante-ihre-eigene-postgresql), wenn Sie lieber selbst eine bereitstellen — eine lokale Installation, Neon, Supabase oder den Container, den dieser Scaffold mitliefert.

## Ihre Umgebung ist bereits konfiguriert

`init` generiert eine sofort einsatzbereite `.env` im Projektstammverzeichnis mit einem echten `JWT_SECRET`, einem Datenbank-Passwort und einem freien lokalen Datenbank-Port. Sie müssen nichts erstellen oder bearbeiten, um loszulegen.

:::caution
Führen Sie nicht `cp .env.example .env` aus. `.env.example` ist eine Referenz für die verfügbaren Variablen — sie über Ihre `.env` zu kopieren verwirft die generierten Geheimnisse und lässt `DATABASE_URL` auf eine nicht existierende Datenbank zeigen. Bearbeiten Sie `.env` direkt, wenn Sie einen Wert ändern möchten.
:::

## Starten Sie die Entwicklungs-Server

```bash
pnpm install
pnpm run dev
```

Das ist der gesamte erste Start. Es gibt keine Datenbank zu installieren und
keinen Schema-Schritt: ohne gesetzte `DATABASE_URL` startet `rebase dev` eine
**verwaltete PostgreSQL (PGlite)** im Projektverzeichnis, erzeugt das
Drizzle-Schema aus Ihren Collections und legt die Tabellen beim Start an —
einschließlich der Beispiele `posts`, `authors` und `tags`.

Beide Hälften starten zusammen:

- **Backend** — REST-API, Auth, Storage, WebSocket
- **Frontend** — das Rebase-Admin-Panel
- **Hot Reload** für beide

Beide Ports werden **aus dem Pfad dieses Projekts abgeleitet** statt fest
vergeben, sodass mehrere Rebase-Projekte nebeneinander laufen können. `rebase
dev` gibt die beiden gebundenen URLs aus — **verwenden Sie diese**, nicht
`localhost:3001` / `localhost:5173`. (`PORT` und `VITE_API_URL` in `.env`
konfigurieren `rebase start`, den Produktionsserver, und werden hier ignoriert.)
Einen Port festlegen: `rebase dev --port 3001`.

### Wichtige Flags

| Flag | Bei | Wirkung |
|---|---|---|
| `--yes` | `init` | Übernimmt alle Vorgaben. **Erforderlich, wenn kein Terminal zum Nachfragen da ist**, etwa in CI |
| `--headless` | `init` | Ein Backend ohne Collection-Dateien und ohne UI |
| `--template <name>` | `init` | Startet von einer anderen Vorlage als der Standardvorlage |
| `--install` / `--no-install` | `init` | Führt den Paketmanager aus — oder eben nicht |
| `--docker` | `dev` | Nutzt PostgreSQL im Container statt der verwalteten Datenbank |
| `--no-db` | `dev` | Fasst keine Datenbank an; Sie bringen Ihre eigene mit |

## Variante: Ihre eigene PostgreSQL

Die verwaltete Datenbank ist eine Bequemlichkeit, keine Voraussetzung. Um das
Projekt auf eine eigene PostgreSQL zu richten, kommentieren Sie `DATABASE_URL` in
`.env` ein:

```bash
DATABASE_URL=postgresql://username:password@localhost:5432/your_database
```

Starten Sie danach die Entwicklungs-Server wie oben. Eine gesetzte
`DATABASE_URL` wird nie angefasst, und eine, die nicht auf diese Maschine zeigt,
bleibt vollständig unberührt.

Mit einer eigenen Datenbank stehen zusätzlich die Migrationsbefehle zur
Verfügung, die die verwaltete nicht anbieten kann — sie planen Änderungen mit
Atlas, das eine zweite, leere Datenbank zum Vergleich benötigt, und PGlite
bedient genau eine:

```bash
pnpm run db:push
```

Der Start legt fehlende Tabellen bereits additiv an; `db push` ist also für die
zwei Dinge da, die er bewusst auslässt: RLS auf Junction-Tabellen bei
Many-to-Many-Relationen und jede nicht rein additive Änderung — eine umbenannte
Spalte, ein verengter Typ, ein entferntes Feld.

Der Scaffold liefert außerdem eine `docker-compose.yml` mit einem
PostgreSQL-Dienst, falls Sie einen Container statt einer installierten Postgres
bevorzugen:

```bash
docker compose up -d db
```

## Eine bestehende Datenbank introspektieren (Optional)

Wenn Sie eine Verbindung zu einer bestehenden Datenbank mit bereits vorhandenen Tabellen herstellen, können Sie diese introspektieren, um Ihre TypeScript-Sammlungsdateien automatisch zu generieren:

```bash
pnpm rebase schema introspect
```

Dies analysiert Ihre Datenbanktabellen, Enums und Beziehungen und schreibt die entsprechenden Sammlungsdateien in `config/collections/`.

## Erster Login

Wenn Sie die von `rebase dev` ausgegebene Frontend-URL öffnen, sehen Sie den Anmeldebildschirm. Der **erste Benutzer**, der sich registriert, wird automatisch zum Administrator – dies ist der Bootstrap-Prozess.

1. Klicken Sie auf **Registrieren**
2. Geben Sie Ihre E-Mail-Adresse und Ihr Passwort ein
3. Sie sind drin — mit vollem Administratorzugriff

## Definieren Sie Ihre erste Sammlung

Öffnen Sie `config/collections/` und erstellen Sie eine neue Datei. Exportieren Sie die Sammlung als **Default-Export** — so wird sie von der Registry erkannt:

```typescript title="config/collections/products.ts"
import { defineCollection } from "@rebasepro/cms-types";

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
| `rebase schema generate` | Drizzle-Schema aus Ihren TypeScript-Sammlungen generieren. Braucht keine Datenbank — `rebase dev` führt es für Sie aus |
| `rebase schema introspect` | TypeScript-Sammlungen aus einer bestehenden Datenbank generieren |
| `rebase db push` | Schema-Änderungen direkt an die Datenbank übertragen. Braucht Ihre eigene PostgreSQL |
| `rebase db generate` | SQL-Migrationsdateien generieren. Braucht Ihre eigene PostgreSQL |
| `rebase db migrate` | Ausstehende Migrationen ausführen. Braucht Ihre eigene PostgreSQL |

## Was kommt als Nächstes

- **[Projektstruktur](/docs/getting-started/project-structure)** — Verstehen Sie den generierten Code
- **[Sammlungen](/docs/collections)** — Ausführlicher Einblick in die Schema-Definition
- **[Umgebung & Konfiguration](/docs/getting-started/configuration)** — Alle Konfigurationsoptionen
- **[Bereitstellung](/docs/getting-started/deployment)** — In Produktion bereitstellen

---
