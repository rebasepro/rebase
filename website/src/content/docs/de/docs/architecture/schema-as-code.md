---
sourceHash: 1c4ef039b2fe0f8a
title: Schema as Code
sidebar_label: Schema as Code
description: Wie Rebase die TypeScript-Tabellen in backend/schema als Single Source of Truth für Ihr Datenbankschema, Ihre API, Ihr SDK und Ihr Admin-Panel verwendet.
---

## Die Kernidee

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

Rebase bietet außerdem einen **visuellen Schema-Editor** im Studio. Wenn jemand diesen verwendet, um eine Spalte hinzuzufügen:

1. Das Studio modifiziert die Datenbank **nicht** direkt
2. Stattdessen sendet es die Änderung als `TablePatch`, und der Server verwendet [ts-morph](https://ts-morph.com/), um die Datei der Tabelle in `backend/schema/` als AST zu parsen
3. Es fügt den neuen `col.*`-Builder präzise in den `columns`-Block ein
4. **Jeglicher bestehende Code, Hooks und benutzerdefinierte Logik bleiben unberührt erhalten**; eine Bearbeitung, die in Code eingreifen würde, den sie nicht umschreibt, wird verweigert
5. Die Datei wird gespeichert, was einen Hot-Reload auslöst

Wie eine Tabelle im Panel *aussieht*, ist nicht Teil davon: Labels, Icons und Ansichten werden als Einstellungen des Panels gespeichert oder in `frontend/src/cms/` geschrieben. Unter [Live schema editing](/docs/backend/live-schema-editing/) erfahren Sie mehr über die Änderungen und darüber, was der Editor verweigert.

Dieser „UI as Code Generator“-Ansatz bedeutet, dass visuelle Bearbeitungen denselben sauberen TypeScript-Code erzeugen, den ein Entwickler von Hand schreiben würde.

## Schema-Generierungs-Pipeline

Ihre Tabellen werden einmal gelesen und zweimal ausgegeben: als Drizzle-Schema für den
laufenden Server und als SQL für den gewünschten Datenbankzustand. Ptah Compat plant die
Änderungen aus diesem SQL. `db push` vergleicht es mit der aktuellen Datenbank; `db
generate` vergleicht es mit der Migrationshistorie:

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
  reads and writes rows through             schema.sql              ← full desired state
                                            ptah-managed.json       ← owned objects
                                            policies.sql, search.sql,
                                            vector.sql, triggers.sql,
                                            views.sql               ← boot and recovery
                                                        │
                                          ┌─────────────┴─────────────┐
                                          ▼                           ▼
                                   rebase db push              rebase db generate
                                   Ptah plans the diff         Ptah writes the diff
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

Ein Ausschnitt des SQL, das Ptah als Soll-Zustand erhält:

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

Die vollständige Soll-Datei enthält auch deklarierte Policies, Funktionen, Such- und
Vektorindizes, `updated_at`-Trigger und Views. Die separaten SQL-Dateien bleiben für
Boot und Recovery. `db push` und `db generate` planen diese Objekte gemeinsam.

## Sicherheit & nicht zugeordnete Datenbankobjekte

Rebase beschränkt Ptahs Plan auf deklarierte Objekte. Ihre Namen, auch nach dem
Entfernen einer Deklaration, stehen in `drizzle/ptah-managed.json`. Eine entfernte
Deklaration kann daher ein `DROP` auslösen. Fremde Tabellen, Views, Funktionen und
Erweiterungen bleiben außerhalb des Plans.

Auth-Provisionierung und Migrationsrevisionen sind ausgeschlossen. Von Rebase
deklarierte Hilfsfunktionen im Schema `rebase` gehören dagegen zum Plan. Bei
ausgewählten Tabellen schützt die CLI außerdem benutzerdefinierte Policies, Trigger,
Indizes sowie CHECK- und EXCLUDE-Constraints anhand ihrer Namen. Sie liest dafür die
Datenbank und die Migrationshistorie. Schlägt ein erforderlicher Katalogzugriff fehl,
stoppt die Planung.

Vor der Anwendung zeigt `db push` den Plan und prüft destruktive Anweisungen,
einschließlich `DROP EXTENSION`. Mit `--dry-run` sehen Sie den Plan, ohne ihn
anzuwenden. Unter [Indizes](/docs/backend/indexes) steht, wie Rebase deklarierte und
benutzerdefinierte Indizes unterscheidet.

## Nächste Schritte

- **[Tables](/docs/schema/)** – Alle `defineTable`-Optionen
- **[Columns](/docs/schema/columns/)** – Detaillierte Spaltentyps-Zuordnungen
- **[Indexes](/docs/backend/indexes)** – Deklarieren der Indizes, die Ihre Abfragen benötigen
