---
sourceHash: 7b2e4e449b0ca1dc
title: Schnellstart
sidebar_label: Schnellstart
description: Erstellen Sie ein neues Rebase-Projekt und führen Sie es in weniger als 2 Minuten lokal aus.
---

## Ein neues Projekt erstellen

```bash
pnpm dlx @rebasepro/cli init my-app
```

Dadurch wird ein Projekt mit drei Packages gerüstet (scaffolded). Wenn Ihnen Begriffe wie *Collection*, *Studio*,
*Managed Runtime*, *Bundle* oder *Resource* neu sind, werden sie im 5-Wörter-Kasten unter
[Projektstruktur](/docs/getting-started/project-structure/) definiert.



| Ordner | Beschreibung |
|--------|-------------|
| `frontend/` | React SPA — Vite + TypeScript mit der Rebase Admin-UI |
| `backend/` | Ihre benutzerdefinierten Funktionen und Crons sowie das generierte Drizzle-Schema. Es gibt keine Server-Datei — die veröffentlichte Runtime startet das Projekt |
| `config/` | Konfigurationsdateien und Collection-Definitionen, die von beiden Seiten geteilt werden |

## Voraussetzungen

- **Node.js** 22.22+ — jedes Gerüst, inklusive Headless, deklariert `"node": ">=22.22.0"`
- **pnpm** (empfohlen) oder npm

Keine Datenbank muss installiert werden und kein Docker ist nötig. `rebase dev` führt ein verwaltetes PostgreSQL für das Projekt aus, dessen Daten unter `.rebase/` liegen. Siehe [Variante: Eigene PostgreSQL-Instanz verwenden](#variante-eigene-postgresql-instanz-verwenden), falls Sie lieber eine eigene bereitstellen möchten — eine lokale Installation, Neon, Supabase oder den mit diesem Gerüst gelieferten Container.

## Ihre Umgebung ist bereits konfiguriert

`init` generiert ein sofort einsatzbereites `.env` im Projektstammverzeichnis mit einem echten `JWT_SECRET`, einem Datenbankpasswort und einem freien lokalen Datenbankport. Sie müssen nichts erstellen oder bearbeiten, um loszulegen.

:::caution
Führen Sie nicht `cp .env.example .env` aus. `.env.example` dient als Referenz für die verfügbaren Variablen — das Überschreiben Ihrer `.env` verwirft die generierten Secrets und setzt `DATABASE_URL` auf eine Datenbank, die nicht existiert. Bearbeiten Sie stattdessen die `.env` direkt, wenn Sie einen Wert ändern möchten.
:::

## Die Dev-Server starten

```bash
pnpm install
pnpm run dev
```

Das ist bereits der gesamte erste Durchlauf. Es muss keine Datenbank installiert und kein Schemaschritt ausgeführt werden:
Wenn keine `DATABASE_URL` gesetzt ist, startet `rebase dev` ein **verwaltetes PostgreSQL (PGlite)**
im Projektverzeichnis, generiert das Drizzle-Schema aus Ihren Collections und
erstellt die Tabellen beim Booten — einschließlich der Beispiel-Tabellen `posts`, `authors` und `tags`.

Es startet beide Teile zusammen:

- **Backend** — REST-API, Auth, Storage, WebSocket
- **Frontend** — das Dashboard: Rebase CMS und Rebase Studio
- **Hot-Reload** für beide

Beide Ports werden **aus dem Pfad dieses Projekts abgeleitet** statt fest vorgegeben zu sein, sodass mehrere
Rebase-Projekte nebeneinander laufen können. `rebase dev` gibt die beiden gebundenen URLs aus —
**verwenden Sie diese**, nicht `localhost:3001` / `localhost:5173`. (`PORT` und `VITE_API_URL`
in der `.env` konfigurieren `rebase start`, den Produktionsserver, und werden hier ignoriert.)
Einen Port können Sie mit `rebase dev --port 3001` festlegen.

### Nützliche Flags

| Flag | Bei | Funktion |
|---|---|---|
| `--yes` | `init` | Niemals nachfragen. **Erforderlich, wenn kein Terminal für Eingaben vorhanden ist**, z. B. in CI. Überspringt Git-Init und Dependency-Installation — die interaktiven Standardwerte bejahen beides; übergeben Sie also `--git` / `--install`, wenn Sie dies wünschen |
| `--headless` | `init` | Ein Backend ohne Collection-Dateien und ohne UI — siehe [Nur Backend](/docs/getting-started/headless/) |
| `--template <name>` | `init` | Von einer anderen Vorlage als der Standardvorlage starten |
| `--install` / `--no-install` | `init` | Paketmanager automatisch ausführen oder überspringen |
| `--docker` | `dev` | PostgreSQL in einem Container anstelle der verwalteten Version verwenden |
| `--no-db` | `dev` | Gar keine Datenbank starten — weder den Container noch die verwaltete Version. Setzen Sie `DATABASE_URL` selbst |

## Variante: Eigene PostgreSQL-Instanz verwenden

Die verwaltete Datenbank ist eine Erleichterung, keine Voraussetzung. Um das Projekt auf
ein selbst betriebenes Postgres zu verweisen, kommentieren Sie `DATABASE_URL` in der `.env` ein:

```bash
DATABASE_URL=postgresql://username:password@localhost:5432/your_database
```

Starten Sie dann die Dev-Server wie oben beschrieben. Eine gesetzte `DATABASE_URL` wird niemals
angetastet, und eine URL, die auf einen anderen Rechner verweist, bleibt völlig unberührt.

Mit einer eigenen Datenbank stehen Ihnen auch die Migrationsbefehle zur Verfügung, die die verwaltete Datenbank
nicht bieten kann — diese planen Änderungen mit [Atlas](https://atlasgo.io/), der Schema-Migrationsengine,
die Rebase zur Planung nutzt. Atlas benötigt eine zweite leere Datenbank
für den Vergleich, und PGlite stellt exakt eine bereit:

```bash
pnpm run db:push
```

Der Bootvorgang erstellt fehlende Tabellen bereits additiv. `db push` ist daher für die zwei
Dinge gedacht, die bewusst unberührt gelassen werden: Junction-Table-
[RLS](/docs/collections/security-rules/) — PostgreSQLs Row-Level Security, womit
Rebase steuert, wer eine Zeile lesen darf — bei Many-to-Many-Relationen,
sowie alle Änderungen, die nicht rein additiv sind — eine umbenannte Spalte, ein
eingeschränkter Typ oder ein entferntes Feld.

Das Gerüst enthält außerdem eine `docker-compose.yml` mit einem PostgreSQL-Dienst, falls Sie
einen Container anstelle eines lokal installierten Postgres bevorzugen:

```bash
docker compose up -d db
```

## Eine bestehende Datenbank introspektieren (Optional)

Wenn Sie eine Verbindung zu einer bestehenden Datenbank mit bereits vorhandenen Tabellen herstellen, können Sie diese introspektieren, um Ihre TypeScript-Collection-Dateien automatisch zu generieren:

```bash
pnpm rebase schema introspect
```

Dadurch werden Ihre Datenbanktabellen analysiert und entsprechende TypeScript-Dateien in `config/collections/` generiert, sodass Sie diese nicht manuell schreiben müssen.

## Erste Anmeldung

Wenn Sie die Frontend-URL öffnen, die `rebase dev` ausgegeben hat, sehen Sie den Anmeldebildschirm. Der **erste Benutzer**, der sich registriert, wird automatisch Administrator — das ist der Bootstrap-Ablauf.

1. Klicken Sie auf **Sign Up**
2. Geben Sie Ihre E-Mail-Adresse und ein Passwort ein
3. Sie sind eingeloggt — mit vollen Administratorrechten

`rebase init` hat außerdem `REBASE_ADMIN_EMAIL` und ein generiertes `REBASE_ADMIN_PASSWORD` in die `.env` geschrieben. Das sind hier nicht Ihre Zugangsdaten: `rebase dev` ignoriert sie und weist beim Booten darauf hin. Sie gehören zu einem Produktionsstart — `docker compose up` oder allem mit `NODE_ENV=production` —, bei dem dieses Bootstrap-Zeitfenster geschlossen ist, da der Server bereits auf einem Hostnamen antwortet, bevor Sie etwas eingegeben haben. Siehe [Ihr erster Administrator](/docs/getting-started/deployment#your-first-admin).

## Ihre erste Collection definieren

Öffnen Sie `config/collections/` und erstellen Sie eine neue Datei. Exportieren Sie die Collection als **Default-Export** — so wird sie von der Registry erfasst. Der Tabellenname ist optional: Er entspricht standardmäßig dem Slug, setzen Sie ihn also nur, wenn sie voneinander abweichen:

```typescript title="config/collections/products.ts"
import { defineCollection } from "@rebasepro/cms-types";

const productsCollection = defineCollection({
    slug: "products",
    name: "Products",
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

## Die Tabelle erstellen

Speichern Sie die Datei. Das ist bereits der gesamte Schritt: `rebase dev` regeneriert
`backend/src/schema.generated.ts` aus Ihren Collections, startet das Backend neu
und der Bootvorgang erstellt die neue Tabelle — sodass Ihre Collection **Products** in der
Navigation erscheint.

Dasselbe gilt für eine Property, die einer bereits vorhandenen Collection hinzugefügt wird: Speichern,
und die Spalte ist vorhanden.

`rebase db push` wird für Änderungen benötigt, die der Bootvorgang bewusst auslässt — eine umbenannte
Spalte, ein eingeschränkter Typ, ein entferntes Feld und Junction-Table-RLS bei
Many-to-Many-Relationen. Dafür wird ein eigenes PostgreSQL benötigt:

```bash
pnpm run db:push
```

## Referenz der Datenbankbefehle

| Befehl | Beschreibung |
|---------|-------------|
| `rebase schema generate` | Drizzle-Schema aus Ihren TypeScript-Collections generieren. Keine Datenbank erforderlich — `rebase dev` führt dies für Sie aus |
| `rebase schema introspect` | TypeScript-Collections aus einer bestehenden Datenbank generieren |
| `rebase db push` | Schema-Änderungen direkt in die Datenbank übertragen. Erfordert ein eigenes PostgreSQL |
| `rebase db generate` | SQL-Migrationsdateien generieren. Erfordert ein eigenes PostgreSQL |
| `rebase db migrate` | Ausstehende Migrationen ausführen. Erfordert ein eigenes PostgreSQL |

## Nächste Schritte

- **[Projektstruktur](/docs/getting-started/project-structure)** — Den generierten Code verstehen
- **[Collections](/docs/collections)** — Detaillierte Einführung in die Schemadefinition
- **[Umgebung & Konfiguration](/docs/getting-started/configuration)** — Alle Konfigurationsoptionen
- **[Deployment](/docs/getting-started/deployment)** — In Produktion bereitstellen
