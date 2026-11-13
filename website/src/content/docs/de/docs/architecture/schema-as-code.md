---
sourceHash: 507990241e43f026
title: Schema as Code
sidebar_label: Schema as Code
description: Wie Rebase die TypeScript-Tabellen in backend/schema als Single Source of Truth für Ihr Datenbankschema, Ihre API, Ihr SDK und Ihr Admin-Panel verwendet.
---

## Die Kernidee

<span class="since-badge" data-since="0.31">Seit 0.31</span>

In Rebase sind die **Tabellen, die Sie mit `defineTable` in `backend/schema/` deklarieren, die Single Source of Truth**. Daraus generiert Rebase:

- **PostgreSQL-Tabellen** über die Schema-Generierung von Drizzle ORM
- **RLS-Policies** – Row Level Security in Postgres, basierend auf dem erforderlichen `rls` jeder Tabelle
- **REST-API**-Endpunkte mit Filterung, Sortierung und Paginierung sowie Realtime und MCP
- **Typisiertes SDK** – typsichere Datenoperationen
- **Die Standardeinstellungen des Admin-Panels** – Formulare, Listen, Validierung und Feldtypen, gerendert aus den Tabellen-Deskriptoren, die das Backend unter `GET /api/schema/tables` bereitstellt; was das Panel darüber hinaus anzeigt, befindet sich in `frontend/src/cms/`

Das bedeutet, dass Ihr Schema:
- **Versionsverwaltet** ist – jede Änderung ist ein Git-Commit
- **Typsicher** ist – TypeScript erkennt Fehler zur Compile-Zeit
- **Überprüfbar (Reviewable)** ist – Schemaänderungen durchlaufen Pull Requests
- **Portabel** ist – dieselbe Definition wird vom Backend, der CLI, dem SDK-Generator und – als Typen – dem Frontend gelesen

## Visuelle Bearbeitung mit AST-Manipulation

<span class="since-badge" data-since="0.31">Seit 0.31</span>

Rebase bietet außerdem einen **visuellen Schema-Editor** im Studio. Wenn jemand diesen verwendet, um eine Spalte hinzuzufügen:

1. Das Studio modifiziert die Datenbank **nicht** direkt
2. Stattdessen sendet es die Änderung als `TablePatch`, und der Server verwendet [ts-morph](https://ts-morph.com/), um die Datei der Tabelle in `backend/schema/` als AST zu parsen
3. Es fügt den neuen `col.*`-Builder präzise in den `columns`-Block ein
4. **Jeglicher bestehende Code, Hooks und benutzerdefinierte Logik bleiben unberührt erhalten**; eine Bearbeitung, die in Code eingreifen würde, den sie nicht umschreibt, wird verweigert
5. Die Datei wird gespeichert, was einen Hot-Reload auslöst

Wie eine Tabelle im Panel *aussieht*, ist nicht Teil davon: Labels, Icons und Ansichten werden als Einstellungen des Panels gespeichert oder in `frontend/src/cms/` geschrieben. Unter [Live schema editing](/docs/backend/live-schema-editing/) erfahren Sie mehr über die Änderungen und darüber, was der Editor verweigert.

Dieser „UI as Code Generator“-Ansatz bedeutet, dass visuelle Bearbeitungen denselben sauberen TypeScript-Code erzeugen, den ein Entwickler von Hand schreiben würde.

## Schema-Generierungs-Pipeline

<span class="since-badge" data-since="0.31">Seit 0.31</span>

Ihre Tabellen werden einmal gelesen und zweimal ausgegeben – als Drizzle-Schema, über das der laufende Server Abfragen durchführt, und als SQL, das die gewünschte Datenbank beschreibt. Es ist das SQL, an das die Datenbank angepasst wird – und zwar durch [Atlas](https://atlasgo.io), das Ihr gewünschtes Schema mit dem Live-Schema abgleicht (diff) und die Änderung plant:

```
                      Tables (backend/schema)
                                  │
            ┌─────────────────────┴─────────────────────┐
            ▼                                           ▼
   rebase schema generate                   (db push and db generate write
            │                               the SQL below on every run, into
            ▼                               .rebase/sql/, which is not committed)
  backend/src/schema.generated.ts                       │
  the Drizzle schema the runtime                        ▼
  reads and writes rows through             schema.sql              ← Atlas's desired state
                                            policies.sql            ← RLS, applied separately
                                            search.sql, vector.sql, ← Atlas cannot manage these
                                            triggers.sql
                                                        │
                                          ┌─────────────┴─────────────┐
                                          ▼                           ▼
                                   rebase db push              rebase db generate
                                   Atlas plans the diff        Atlas writes the diff
                                   and applies it now          to drizzle/migrations/
                                          │                           │
                                          │                           ▼
                                          │                    rebase db migrate
                                          │                    applies them in order
                                          └─────────────┬─────────────┘
                                                        ▼
                                                  PostgreSQL
```

`db push` ist der Entwicklungs-Workflow; `db generate` + `db migrate` ist der überprüfbare Workflow, der in der Produktion verwendet werden sollte. Beide nutzen dasselbe generierte SQL, sodass keine Unstimmigkeiten darüber entstehen können, was Ihre Tabellen bedeuten. Zudem schreiben beide das SQL vor dem Lesen frisch aus den Tabellen, sodass keine veraltete Kopie in Ihrem Repository verbleibt. Die Migrationen sind das, was Sie committen. Siehe [Schema Generation](/docs/cli/schema) für alle Flags.

### Beispiel

<span class="since-badge" data-since="0.31">Seit 0.31</span>

Ausgehend von dieser Tabelle:

<!-- schema-sample: table -->
```ts
import { defineTable, col, sql } from "@rebasepro/server/schema";

export const products = defineTable("products", {
    columns: {
        id: col.text().primaryKey().default(sql`gen_random_uuid()::text`),
        name: col.text().notNull(),
        price: col.numeric(),
        active: col.boolean().default(true),
        createdAt: col.timestamp({ withTimezone: true }).onCreateNow()
    },
    rls: "admin-only"
});
```

Rebase generiert dieses Drizzle-Schema – die gesamte Datei, inklusive Standard-Policies und allem:

<!-- schema-sample: drizzle -->
```typescript
// schema.generated.ts
// This file is auto-generated by the Rebase Drizzle generator. Do not edit manually.

import { boolean, numeric, pgPolicy, pgTable, text, timestamp } from 'drizzle-orm/pg-core';
import { relations as drizzleRelations, sql } from 'drizzle-orm';


export const products = pgTable("products", {
    name: text("name").notNull(),
    price: numeric("price"),
    active: boolean("active").default(sql`TRUE`),
    createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).default(sql`now()`),
    id: text("id").primaryKey().default(sql`gen_random_uuid()::text`)
}, (table) => ([
    pgPolicy("products_default_admin_read", { as: "permissive", for: "select", to: ["rebase_admin"], using: sql`(SELECT (rebase.uid() IS NULL) OR (string_to_array(rebase.roles(), ',') && ARRAY['admin']))` }),
    pgPolicy("products_default_admin_write_insert", { as: "permissive", for: "insert", to: ["rebase_admin"], withCheck: sql`(SELECT (rebase.uid() IS NULL) OR (string_to_array(rebase.roles(), ',') && ARRAY['admin']))` }),
    pgPolicy("products_default_admin_write_update", { as: "permissive", for: "update", to: ["rebase_admin"], using: sql`(SELECT (rebase.uid() IS NULL) OR (string_to_array(rebase.roles(), ',') && ARRAY['admin']))`, withCheck: sql`(SELECT (rebase.uid() IS NULL) OR (string_to_array(rebase.roles(), ',') && ARRAY['admin']))` }),
    pgPolicy("products_default_admin_write_delete", { as: "permissive", for: "delete", to: ["rebase_admin"], using: sql`(SELECT (rebase.uid() IS NULL) OR (string_to_array(rebase.roles(), ',') && ARRAY['admin']))` }),
])).enableRLS();

export const tables = { products };
export const enums = {  };
export const relations = {  };
```

Drei Dinge darin sind einen zweiten Blick wert. Die `id`-Spalte: Die Datenbank füllt sie mit einer UUID (`gen_random_uuid()::text`), sodass eine über das Admin-Panel, die REST-API oder das SDK erstellte Zeile keinen eigenen Schlüssel benötigt, und ein übergebener Schlüssel wie angegeben verwendet wird. Der `pgPolicy`-Block: `rls: "admin-only"` aktiviert Row-Level-Security und generiert nur die Basis-Policies, die sicherstellen, dass der vertrauenswürdige Server-Kontext und die Rolle `admin` darauf zugreifen können – und sonst niemand; siehe [Row-level security](/docs/collections/security-rules). Und `active`, das den von Ihnen geschriebenen `.default(true)`-Wert als **Spalten**-Standardwert übernimmt: Ein literaler Standardwert kompiliert zu einem echten `DEFAULT`, sodass auch eine über die REST-API, ein Seed-Skript oder `psql` eingefügte Zeile diesen Wert erhält, nicht nur eine über das Admin-Panel eingegebene.

Und dieses SQL, das Atlas als Soll-Zustand übergeben wird:

<!-- schema-sample: sql -->
```sql
-- This file is auto-generated by the Rebase DDL generator. Do not edit manually.

CREATE SCHEMA IF NOT EXISTS "rebase";

CREATE TABLE "public"."products" (
  "id" TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "name" TEXT NOT NULL,
  "price" NUMERIC,
  "active" BOOLEAN DEFAULT TRUE,
  "created_at" TIMESTAMP WITH TIME ZONE DEFAULT now()
);
```

Policies, Suchspalten, Vektorindizes und `updated_at`-Trigger werden in eigene Dateien geschrieben und von der CLI separat angewendet – Atlas verwaltet keinen dieser vier Bereiche.

## Sicherheit & nicht zugeordnete Datenbankobjekte

Wenn Rebase das Datenbankschema aktualisiert, ordnet es die von Ihnen deklarierten Tabellen Datenbanktabellen zu. Um sicherzustellen, dass **nicht zugeordnete Datenbankobjekte (z. B. Tabellen, Views, Enums) niemals gelöscht oder geändert werden**, implementiert Rebase mehrere Sicherheitsebenen:

1. **Ausschluss nicht zugeordneter Tabellen**: Vor jedem Push listet die CLI jede Tabelle und View in der Datenbank auf und übergibt Atlas ein `--exclude` für jedes Objekt, dem keine deklarierte Tabelle (oder die Verbindungstabelle einer deklarierten Tabelle) zugeordnet ist, sodass Atlas niemals eine Änderung daran plant. Wenn die Datenbank nicht gelesen werden kann, bricht der Push ab, anstatt mit einer unvollständigen Liste fortzufahren.
2. **Schemas im Besitz von Rebase**: Das `rebase`-Schema (Auth-Tabellen, RLS-Hilfsfunktionen, Atlas-Revisionstabelle) und jedes `auth`-Schema werden vollständig ausgeschlossen, sodass ein Push niemals ein `DROP SCHEMA … CASCADE` planen kann.
3. **Objekte, die Atlas nicht modellieren kann**: Suchspalten, Vektorindizes und Trigger werden ebenfalls von Atlas ausgeschlossen und aus ihren eigenen generierten Dateien angewendet.
4. **Schutz vor destruktiven Änderungen**: `rebase db push` führt den Plan zunächst als Trockenlauf aus. Ein Befehl, der Daten zerstören würde – eine gelöschte Spalte oder Tabelle, eine verlustbehaftete Typänderung –, stoppt den Push: Im Terminal werden Sie aufgefordert, `yes` einzugeben, und ohne interaktives Terminal (CI, Skripte, Agents) wird die Ausführung verweigert, es sei denn, Sie übergeben `--allow-destructive`.
5. **Index-Zugehörigkeit nach Name**: Indizes sind das einzige Objekt, das *auf* einer zugeordneten Tabelle existiert, sodass eine Tabellenfilterung sie nicht schützen kann – und früher plante ein Push `DROP INDEX` für jeden Index, der im Soll-Zustand fehlte, was jeden manuell erstellten Index betraf. Rebase benennt die von ihm generierten Indizes nun nach dem Schema `<table>_<columns>_ix_<7 hex>` (`_ux_` bei Eindeutigkeit), ein Format, das kein anderer Namensgenerator hier erzeugt, und schließt alles andere namentlich aus dem Diff aus. Ein Index, den Sie von Hand geschrieben haben oder der durch Introspektion hinzugefügt wurde, wird niemals angetastet; eine Deklaration, die Sie löschen, wird weiterhin entfernt, was genau so beabsichtigt ist. Siehe **[Indexes](/docs/backend/indexes)**.

## Nächste Schritte

<span class="since-badge" data-since="0.31">Seit 0.31</span>

- **[Tables](/docs/schema/)** – Alle `defineTable`-Optionen
- **[Columns](/docs/schema/columns/)** – Detaillierte Spaltentyps-Zuordnungen
- **[Indexes](/docs/backend/indexes)** – Deklarieren der Indizes, die Ihre Abfragen benötigen
