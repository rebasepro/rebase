---
sourceHash: 04353ad7d35cfe5c
title: Schnellstart
sidebar_label: Schnellstart
description: Erstelle ein neues Rebase-Projekt und führe es lokal in unter 2 Minuten aus.
---

## Ein neues Projekt erstellen

```bash
pnpm dlx @rebasepro/cli init my-app
```

Dies richtet ein Projekt mit zwei Packages ein (Scaffolding). Falls Begriffe wie *table*, *collection*,
*Studio*, *managed runtime*, *bundle* oder *resource* neu für dich sind, werden sie im Kasten unter
[Projektstruktur](/docs/getting-started/project-structure/) definiert.

| Ordner | Beschreibung |
|--------|-------------|
| `backend/` | Deine Tabellen (`backend/schema/`), was die Runtime zusätzlich liest (`resources.ts`, `storage.ts`), deine Funktionen und Crons sowie das generierte Drizzle-Schema. Es gibt keine Server-Datei – die veröffentlichte Runtime startet das Projekt |
| `frontend/` | React-SPA – Vite + TypeScript mit der Rebase-Admin-UI und den Tabellenanpassungen in `src/cms/` |

## Voraussetzungen

- **Node.js** 22.22+ – jedes Scaffold, headless eingeschlossen, deklariert `"node": ">=22.22.0"`
- **pnpm** (empfohlen) oder npm

Keine Datenbankinstallation und kein Docker erforderlich. `rebase dev` führt ein verwaltetes PostgreSQL für das Projekt aus, dessen Daten unter `.rebase/` liegen. Siehe [Variante: Eigene PostgreSQL-Datenbank verwenden](#variante-eigene-postgresql-datenbank-verwenden), wenn du lieber eine eigene bereitstellen möchtest – eine lokale Installation, Neon, Supabase oder den Container, der mit diesem Scaffold mitgeliefert wird.

## Deine Umgebung ist bereits konfiguriert

`init` generiert ein sofort einsatzbereites `.env` im Projekt-Root mit einem echten `JWT_SECRET`, einem Datenbank-Passwort und einem freien lokalen Datenbank-Port. Du musst nichts erstellen oder bearbeiten, um loszulegen.

:::caution
Führe nicht `cp .env.example .env` aus. `.env.example` dient als Referenz für die verfügbaren Variablen – das Überschreiben deiner `.env` verwirft die generierten Secrets: `JWT_SECRET`, den Service-Key, das Datenbank-Passwort und die Anmeldedaten des ersten Admins, die dort alle leer oder auskommentiert sind. Bearbeite `.env` direkt, wenn du einen Wert ändern möchtest.
:::

## Dev-Server starten

```bash
cd my-app
pnpm install
pnpm run dev
```

Das ist bereits der gesamte erste Durchlauf. Es muss keine Datenbank installiert und kein Schema-Schritt ausgeführt werden:
Wenn keine `DATABASE_URL` gesetzt ist, startet `rebase dev` eine **verwaltete PostgreSQL-Datenbank (PGlite)**
im Projektverzeichnis, generiert das Drizzle-Schema aus deinen Tabellen und
erstellt die Tabellen beim Booten – einschließlich der Beispieltabellen `posts`, `authors` und `tags`.

Es startet beide Teile zusammen:

- **Backend** – REST-API, Auth, Storage, WebSocket
- **Frontend** – das Panel: Rebase CMS und Rebase Studio
- **Hot Reload** für beides

Beide Ports werden **aus dem Pfad dieses Projekts abgeleitet** und sind nicht fest vorgegeben, sodass mehrere
Rebase-Projekte parallel laufen können. `rebase dev` gibt die beiden gebundenen URLs aus –
**verwende diese**, nicht `localhost:3001` / `localhost:5173`. (`PORT` und `VITE_API_URL`
in `.env` konfigurieren `rebase start`, das das erstellte Bundle ausführt, und werden hier ignoriert.)
Mit `rebase dev --port 3001` kannst du einen festen Port vorgeben.

### Wissenswerte Flags

| Flag | Bei | Funktion |
|---|---|---|
| `--yes` | `init` | Niemals nachfragen. **Erforderlich, wenn kein Terminal für Eingaben vorhanden ist**, wie z. B. in CI. Überspringt git init und die Installation der Abhängigkeiten – die interaktiven Standardwerte stimmen beiden zu; übergib also `--git` / `--install`, wenn du sie möchtest |
| `--headless` | `init` | Ein Backend ohne `backend/schema/` und ohne UI, das die eigenen Tabellen deiner Datenbank bereitstellt – siehe [Nur Backend](/docs/getting-started/headless/) |
| `--template <name>` | `init` | Mit einem anderen Template als dem Standard starten |
| `--install` / `--no-install` | `init` | Den Paketmanager automatisch ausführen oder überspringen |
| `--docker` | `dev` | PostgreSQL in einem Container anstelle der verwalteten Instanz verwenden. Die anderen Befehle folgen diesem Verhalten, bis `rebase dev` ohne dieses Flag ausgeführt wird. Eine gesetzte `DATABASE_URL` hat Vorrang: In dem Fall wird nichts gestartet, worauf hingewiesen wird |
| `--no-db` | `dev` | Überhaupt keine Datenbank starten – weder den Container noch die verwaltete Instanz. Setze `DATABASE_URL` selbst |

## Variante: Eigene PostgreSQL-Datenbank verwenden

Die verwaltete Datenbank ist ein Komfortmerkmal, keine Voraussetzung. Um das Projekt auf ein
eigenes PostgreSQL zu verweisen, entferne den Kommentar vor `DATABASE_URL` in `.env`:

```bash
DATABASE_URL=postgresql://username:password@localhost:5432/your_database
```

Starte die Dev-Server anschließend wie oben beschrieben. Eine gesetzte `DATABASE_URL` wird niemals
angetastet, und URLs, die auf eine andere Maschine verweisen, bleiben völlig
unberührt.

Die Migrationsbefehle planen Änderungen mit [Atlas](https://atlasgo.io/), der
Schema-Migrations-Engine, mit der Rebase plant. Diese benötigt eine zweite, leere Datenbank für den
Abgleich. Bei deiner eigenen Datenbank erstellt Rebase eine zusätzliche Instanz daneben; auf der verwalteten
Datenbank, die genau eine Datenbank bedient, wird für die Dauer des Befehls eine temporäre PGlite-Instanz
gestartet.
So oder so:

```bash
pnpm run db:push
```

Beim Booten werden fehlende Tabellen – sowie deren
[RLS](/docs/collections/security-rules/)-Richtlinien (PostgreSQL Row-Level
Security, womit Rebase steuert, wer eine Zeile lesen darf) – bereits additiv erstellt.
`db push` ist daher für Änderungen gedacht, die beim Booten bewusst unberührt bleiben:
jede Änderung, die nicht rein additiv ist – eine umbenannte Spalte, ein eingeschränkter Datentyp oder ein entferntes Feld.

Das Scaffold enthält außerdem eine `docker-compose.yml` mit einem PostgreSQL-Dienst, falls du
lieber einen Container statt einer lokal installierten Postgres-Instanz verwenden möchtest:

```bash
docker compose up -d db
```

## Eine bestehende Datenbank introspektieren (Optional)

<span class="since-badge" data-since="0.31">Seit 0.31</span>

Wenn du dich mit einer bestehenden Datenbank verbindest, die bereits Tabellen enthält, kannst du sie introspektieren, um für jede davon eine `defineTable`-Datei zu generieren:

```bash
pnpm rebase schema introspect
```

Dies liest jede Tabelle, Spalte, jeden Fremdschlüssel und jede Row-Level-Security-Richtlinie aus und schreibt `backend/schema/<table>.ts` sowie die `index.ts`, die sie exportiert, sodass du sie nicht manuell erstellen musst. Siehe [`schema introspect`](/docs/cli/schema/#rebase-schema-introspect).

## Erster Login

Wenn du die Frontend-URL öffnest, die `rebase dev` ausgegeben hat, siehst du den Anmeldebildschirm. Der **erste Benutzer**, der sich registriert, wird automatisch zum Admin – dies ist der Bootstrap-Flow.

1. Der Bildschirm öffnet sich mit **Welcome!**, dem Formular für dieses erste Konto
2. Gib deine E-Mail-Adresse und dein Passwort ein und klicke auf **Create account**
3. Du bist eingeloggt – mit vollem Admin-Zugriff

`rebase init` hat außerdem `REBASE_ADMIN_EMAIL` und ein generiertes `REBASE_ADMIN_PASSWORD` in die `.env` geschrieben. Das sind hier nicht deine Anmeldedaten: `rebase dev` ignoriert sie und weist beim Booten darauf hin. Sie gehören zu einem Produktionsstart – `docker compose up` oder allem mit `NODE_ENV=production` –, bei dem dieses Bootstrap-Zeitfenster geschlossen ist, da der Server bereits unter einem Hostnamen antwortet, bevor du etwas eingeben konntest. Siehe [Dein erster Admin](/docs/getting-started/deployment#your-first-admin).

## Definiere deine erste Tabelle

<span class="since-badge" data-since="0.31">Seit 0.31</span>

Erstelle eine Datei in `backend/schema/`:

```typescript title="backend/schema/products.ts"
import { defineTable, col } from "@rebasepro/server/schema";

export const products = defineTable("products", {
    columns: {
        id:          col.uuid().primaryKey().defaultRandom(),
        name:        col.text().notNull(),
        price:       col.numeric().notNull().validate({ min: 0 }),
        description: col.text(),
        active:      col.boolean().default(true),
        createdAt:   col.timestamp({ withTimezone: true }).onCreateNow(),
    },
    // Takes the defaultRls the scaffold's index.ts exports: everyone reads, admins write.
    rls: "inherit",
});
```

Exportiere sie anschließend aus `backend/schema/index.ts`. Der Index ist das, was das Backend,
die CLI und der SDK-Generator einlesen: Ein `defineTable`, das dort nicht exportiert wird, verweigert
den Start unter Nennung des Dateinamens.

```typescript title="backend/schema/index.ts"
// ...existing exports
export { products } from "./products";
```

## Die Tabelle erstellen

<span class="since-badge" data-since="0.31">Seit 0.31</span>

Speichere die Datei. Das ist bereits der gesamte Schritt: `rebase dev` generiert
`backend/src/schema.generated.ts` und die SDK-Typen in `generated/sdk/` aus deinen
Tabellen neu, startet das Backend neu und beim Booten werden die neue Tabelle sowie ihre Row-Level-Security-Richtlinien
erstellt – und **Products** erscheint in der Navigation des Admin-Panels,
zusammen mit einer Liste, einem Formular und Filtern, die aus den Spalten abgeleitet wurden.

Dasselbe gilt für eine Spalte, die du einer bestehenden Tabelle hinzufügst: speichern, und die
Spalte ist da.

Um das Erscheinungsbild der Tabelle im Panel anzupassen – ein mehrzeiliger Editor für
`description`, ein Icon, eine Gruppe –, füge eine Datei zu `frontend/src/cms/` hinzu und übergebe sie
an `<RebaseCMS tableCustomizations>` in `App.tsx`:

```tsx title="frontend/src/cms/products.tsx"
import { customizeTable } from "@rebasepro/cms";
import type { products } from "../../../backend/schema/products";

export const productsCms = customizeTable<typeof products>("products", {
    icon: "ShoppingCart",
    fields: {
        description: { multiline: true },
    },
});
```

Siehe [Anpassen einer Tabelle](/docs/frontend/customize-table/).

`rebase db push` ist für Änderungen gedacht, die beim Booten bewusst unberührt bleiben – eine umbenannte
Spalte, ein eingeschränkter Datentyp, ein entferntes Feld:

```bash
pnpm run db:push
```

Es funktioniert auf der
verwalteten Datenbank genauso wie auf deiner eigenen.

## Referenz der Datenbankbefehle

<span class="since-badge" data-since="0.31">Seit 0.31</span>

| Befehl | Beschreibung |
|---------|-------------|
| `rebase schema generate` | Drizzle-Schema aus deinen Tabellen generieren. Keine Datenbank erforderlich – `rebase dev` führt dies automatisch aus |
| `rebase schema introspect` | `defineTable`-Dateien aus einer bestehenden Datenbank generieren |
| `rebase db push` | Schemaänderungen direkt in die Datenbank übertragen, einschließlich der verwalteten |
| `rebase db generate` | SQL-Migrationsdateien generieren |
| `rebase db migrate` | Ausstehende Migrationen ausführen |

Die drei `db`-Befehle
funktionieren auch auf der verwalteten Datenbank.

## Nächste Schritte

- **[Projektstruktur](/docs/getting-started/project-structure)** — Den generierten Code verstehen
- **[Tabellen](/docs/schema/)** — Detaillierte Einblicke in die Schemadefinition
- **[Umgebung & Konfiguration](/docs/getting-started/configuration)** — Alle Konfigurationsoptionen
- **[Deployment](/docs/getting-started/deployment)** — In die Produktion deployen
