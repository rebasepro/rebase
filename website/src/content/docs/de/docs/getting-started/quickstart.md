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

Keine Datenbank zu installieren, und **kein Docker**. `rebase dev` betreibt eine verwaltete PostgreSQL für das Projekt, deren Daten unter `.rebase/` liegen. Siehe [Ihre eigene PostgreSQL verwenden](#ihre-eigene-postgresql-verwenden), wenn Sie lieber selbst eine bereitstellen — eine lokale Installation, Neon, Supabase oder den Container, den dieser Scaffold mitliefert.

## Ihre Umgebung ist bereits konfiguriert

`init` generiert eine sofort einsatzbereite `.env` im Projektstammverzeichnis mit einem echten `JWT_SECRET`, einem Datenbank-Passwort und einem freien lokalen Datenbank-Port. Sie müssen nichts erstellen oder bearbeiten, um loszulegen.

:::caution
Führen Sie nicht `cp .env.example .env` aus. `.env.example` ist eine Referenz für die verfügbaren Variablen — sie über Ihre `.env` zu kopieren verwirft die generierten Geheimnisse und lässt `DATABASE_URL` auf eine nicht existierende Datenbank zeigen. Bearbeiten Sie `.env` direkt, wenn Sie einen Wert ändern möchten.
:::

## Starten Sie die Entwicklungs-Server

```bash
pnpm install   # only if you declined the install `init` offered
pnpm dev
```

Das ist der gesamte erste Lauf — es gibt keine Datenbank zu starten und keinen Schema-Schritt zu merken. `rebase dev` erledigt drei Dinge, bevor es ausliefert:

1. Es generiert `backend/src/schema.generated.ts` aus `config/collections/`.
2. Es startet eine verwaltete PostgreSQL für dieses Projekt, deren Daten unter `.rebase/` liegen.
3. Es wendet Ihre Sammlungen darauf an, sodass die Beispieltabellen `posts`, `authors` und `tags` existieren.

Danach startet es beide Hälften zusammen:

- **Backend** — REST API, Authentifizierung, Speicher, WebSocket
- **Frontend** — das Rebase Admin-Panel
- **Hot-Reload** für beides — Änderungen werden sofort wirksam

Beide Ports werden **aus dem Projektpfad abgeleitet** statt fest vergeben, sodass
mehrere Rebase-Projekte parallel laufen können. `rebase dev` gibt die beiden
gebundenen URLs aus — verwenden Sie diese, nicht `localhost:3001`/`localhost:5173`.
(`PORT` und `VITE_API_URL` in `.env` konfigurieren `rebase start`, den
Produktionsserver, und werden hier ignoriert.) Mit `rebase dev --port 3001` legen
Sie einen festen Port fest.

## Ihre eigene PostgreSQL verwenden

`DATABASE_URL` ist in `.env` mit Absicht auskommentiert — genau das macht die verwaltete Datenbank zur Vorgabe. Setzen Sie sie auf eine beliebige PostgreSQL (lokale Installation, Neon, Supabase), und sie hat Vorrang vor der verwalteten:

```bash
DATABASE_URL=postgresql://username:password@localhost:5432/your_database
```

Der Scaffold liefert außerdem eine `docker-compose.yml` mit einem PostgreSQL-Dienst, und die URL, die bereits in `.env` steht, zeigt darauf. Kommentieren Sie diese Zeile ein, dann:

```bash
docker compose up -d db
pnpm run db:push
pnpm dev
```

`db:push` ist das, was Ihre Sammlungstabellen auf einer Datenbank anlegt, die Rebase nicht für Sie verwaltet.

:::caution
`db:push`, `db:generate` und `db:migrate` planen ihre Änderungen mit [Atlas](https://atlasgo.io), das Ihr Schema gegen eine zweite, leere Datenbank vergleicht. Die verwaltete Entwicklungsdatenbank stellt genau eine bereit, also verweigern alle drei die Ausführung dagegen und sagen das, statt auf halbem Weg zu scheitern. Dort brauchen Sie sie nicht — `rebase dev` wendet Ihre Sammlungen beim Start an. Greifen Sie darauf zurück, sobald Sie auf einer eigenen PostgreSQL sind, und für Migrationen, das Entfernen und Umbenennen von Spalten.
:::

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

Starten Sie `rebase dev` neu. Es regeneriert das Schema aus Ihren Sammlungen und wendet die neue Tabelle an, bevor es ausliefert — **Produkte** erscheint dann in der Navigation.

Auf einer eigenen PostgreSQL ist das stattdessen die Aufgabe von `db:push`:

```bash
pnpm run db:push
```

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
