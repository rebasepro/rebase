---
sourceHash: 59fc3060e8bce0e2
title: Tabellen
sidebar_label: Tabellen
description: "Deklarieren Sie Postgres-Tabellen in backend/schema mit defineTable: Spalten, Relationen und eine obligatorische Row-Level-Security-Konfiguration. Jede Tabelle wird zu SQL, Policies, REST-, Realtime- und MCP-Routen sowie SDK-Typen."
---

<span class="since-badge" data-since="0.31">Seit 0.31</span>

Eine Tabelle wird einmalig in TypeScript im Verzeichnis `backend/schema/` deklariert.
Diese Deklaration ist das Einzige, was das Backend über Ihre Daten weiß. Daraus
generiert Rebase die Tabelle und deren Row-Level-Security-Policies in Postgres,
stellt die Tabelle über REST, Realtime und MCP bereit und typisiert das SDK.

```ts
// backend/schema/posts.ts
import { defineTable, col, rel } from "@rebasepro/server/schema";
import { users } from "./users";

export const posts = defineTable("posts", {
    columns: {
        id:          col.uuid().primaryKey().defaultRandom(),
        title:       col.text().notNull().validate({ min: 3, max: 200 }),
        status:      col.enum(["draft", "published", "archived"]).notNull().default("draft"),
        publishDate: col.timestamp({ withTimezone: true }),
        createdAt:   col.timestamp({ withTimezone: true }).notNull().onCreateNow(),
    },
    relations: {
        author: rel.belongsTo(() => users, { notNull: true }),
    },
    rls: [
        { operation: "select", access: "public", condition: { status: "published" } },
        { operations: ["select", "insert", "update"], roles: ["editor"] },
        { operation: "delete", roles: ["admin"] },
    ],
});
```

Drei Dinge sind an diesem Beispiel vor allem bemerkenswert:

- **Spalten sind nullable, sofern nicht anders angegeben**, wie in SQL. `.notNull()`
  macht eine Spalte zu `NOT NULL` und bei der Erstellung erforderlich. Siehe [Spalten](/docs/schema/columns/).
- **Der Fremdschlüssel wird durch die Relation deklariert.** `author` leitet eine
  `author_id`-Spalte, deren Constraint und deren Index ab. Siehe
  [Relationen](/docs/collections/relations/).
- **`rls` ist erforderlich.** Eine Tabelle ohne Row-Level-Security-Konfiguration ist ein Typfehler
  und wird bei der Kompilierung des Schemas abgelehnt. Siehe
  [Row-Level-Security](/docs/collections/security-rules/).

:::note[Kommen Sie von Collections?]
Tabellen ersetzen die `config/collections`-Dateien früherer Versionen. Das CMS
liest seine Standardwerte aus den Tabellen; eigene Anpassungen befinden sich im
Frontend. Der Upgrade-Leitfaden für diese Version beschreibt die Umstellung.
:::

## Das Verzeichnis `backend/schema`

<span class="since-badge" data-since="0.31">Seit 0.31</span>

```text
backend/
├── schema/
│   ├── index.ts      # exports every table and view, and optionally defaultRls
│   ├── users.ts      # defineAuthTable("users", …)
│   ├── posts.ts      # defineTable("posts", …)
│   └── tags.ts       # defineTable("tags", …)
├── functions/
└── crons/
```

Eine Datei pro Tabelle ist eine Konvention, keine Regel. Entscheidend ist
`backend/schema/index.ts`: Das Backend liest die Tabellen und Views, die darin exportiert
werden, und sonst nichts.

```ts
// backend/schema/index.ts
import type { DefaultRls } from "@rebasepro/server/schema";

export { users } from "./users";
export { posts } from "./posts";
export { tags } from "./tags";

// What every table declared with `rls: "inherit"` takes.
export const defaultRls: DefaultRls = [
    { operation: "select", access: "authenticated" },
];
```

`defaultRls` ist optional. Es wird nur von Tabellen gelesen, die
`rls: "inherit"` angeben; ein Projekt, das niemals `"inherit"` verwendet, benötigt es nicht.

Das Verzeichnis ist `backend/schema`, es sei denn, `rebase.json` gibt über den
Schlüssel `tables` ein anderes an. Der Schlüssel `schema` behält seine bisherige Bedeutung: das
generierte Drizzle-Modul.

```json
{
    "apps": {
        "backend": {
            "type": "backend",
            "runtime": "managed",
            "tables": "backend/schema"
        }
    }
}
```

Ein Projekt ohne `backend/schema/index.ts` deklariert keine Tabellen. Das Backend
liest die Tabellen dann beim Start aus der Live-Datenbank und stellt nur diejenigen
bereit, für die Row-Level-Security aktiviert ist. Siehe [Backend only](/docs/getting-started/headless/).

Die Schema-Dateien sind reines TypeScript ohne Server-Abhängigkeiten:
`@rebasepro/server/schema` lädt nichts vom Server. Ein Frontend kann
`import type { posts } from "../../backend/schema/posts"` verwenden, um seinen eigenen Code
typensicher an eine Tabelle zu binden, ohne Backend-Code in das Browser-Bundle einzubinden.

## Was aus einer Tabelle wird

<span class="since-badge" data-since="0.31">Seit 0.31</span>

| Aus der Deklaration | Rebase generiert |
|---|---|
| `columns`, `relations`, `indexes` | das `CREATE TABLE`, Fremdschlüssel, Junction-Tabellen und Indizes, geschrieben in `schema.sql` durch `rebase db push` und `rebase db generate` |
| `rls`, `tenant`, die Auth-Tabelle | `ENABLE ROW LEVEL SECURITY` und ein `CREATE POLICY` pro Regel und Operation in `policies.sql` |
| `search`, Vektorspalten | die generierte `tsvector`-Spalte sowie die GIN- und ANN-Indizes |
| der Slug | die REST-Routen unter `/api/data/<slug>`, Realtime-Subscriptions, die MCP-Tools und das OpenAPI-Dokument |
| die Typen und Modifikatoren der Spalten | die Typen `Row`, `Insert` und `Update` des SDKs sowie die [inferierten Typen](/docs/schema/types/), die Sie in Ihrem eigenen Code verwenden können |

Jede Oberfläche liest dieselbe kompilierte Form der Tabelle, die als Deskriptor
bezeichnet wird: Spalten mit ihren Postgres-Typen, Nullability, Validierungs- und
Speicherregeln, zu Slugs aufgelöste Relationen und die Row-Level-Security-Konfiguration.
Hook-Code verlässt niemals den Server; der Deskriptor gibt lediglich an, welche
Hooks existieren. Das Backend stellt die Deskriptoren unter `GET /api/schema/tables` bereit,
woraus das CMS, das Studio und die MCP-Apps rendern.

Die Pipeline von der Deklaration bis zur Datenbank wird in
[Schema as code](/docs/architecture/schema-as-code/) beschrieben.

## `defineTable`-Optionen

<span class="since-badge" data-since="0.31">Seit 0.31</span>

`defineTable(name, config)` nimmt den Namen der Tabelle und die folgenden Schlüssel entgegen:

| Schlüssel | Funktion |
|---|---|
| `columns` | **Erforderlich.** `col.*`-Builder nach Schlüssel, in physischer Reihenfolge. Mindestens einer muss `.primaryKey()` sein. Siehe [Spalten](/docs/schema/columns/). |
| `rls` | **Erforderlich.** `"admin-only"`, `"inherit"` oder eine nicht-leere Liste von Regeln. Siehe [Row-Level-Security](/docs/collections/security-rules/). |
| `relations` | `rel.*`-Builder nach Relationsname. Siehe [Relationen](/docs/collections/relations/). |
| `slug` | Der Name in der API, im SDK und in Scopes. Bei Auslassung der Name der Tabelle. |
| `table` | Der SQL-Tabellenname, falls er vom Namen abweicht. |
| `schema` | Das Postgres-Schema. `public`, wenn nicht angegeben. |
| `database` | Eine vom Standard abweichende Postgres-Datenbank, deklariert in `backend/resources.ts`. Siehe [Mehrere Quellen](/docs/backend/multiple-sources/). |
| `description` | Was die Tabelle enthält. Wird in OpenAPI und in den Beschreibungen der MCP-Tools angezeigt. |
| `defaultPolicies` | `false` generiert nur Ihre Regeln ohne die standardmäßigen Admin-Baseline-Policies. Bei `rls: "admin-only"` abgelehnt. <span class="since-badge" data-since="0.31">Seit 0.31</span> `true` behält die Baseline bei, wenn die Datenbank der Tabelle sie für alle Tabellen deaktiviert (`database({ rls: { defaultPolicies: false } })`). Wenn weggelassen, entscheidet die Einstellung der Datenbank. |
| `tenant` | Weist jede Zeile einem Mandanten zu. Siehe [Mandantenfähigkeit](/docs/collections/tenancy/). |
| `softDelete` | `true` oder `{ field }`: Ein Löschvorgang setzt einen Zeitstempel, anstatt die Zeile zu entfernen. Siehe [Soft Delete](/docs/collections/soft-delete/). |
| `history` | `true` zeichnet jeden Schreibvorgang in der Verlaufstabelle auf. Siehe [Entitätsverlauf](/docs/backend/history/). |
| `search` | Bewertete Volltextsuche über die angegebenen Spalten. Siehe [Suche](/docs/backend/search/). |
| `indexes` | Indizes, jeweils mit der Abfrage, die sie bedienen. Siehe [Indizes](/docs/backend/indexes/). |
| `hooks` | Serverseitige Lifecycle-Hooks. Siehe [Tabellen-Hooks](/docs/collections/callbacks/). |
| `strictWrites` | Ein Schreibvorgang, der eine Spalte benennt, die die Tabelle nicht deklariert, führt zu einem 400-Fehler. `false` akzeptiert dies für eine Spalte, die in der Datenbank existiert, ohne deklariert zu sein (z. B. durch einen Trigger befüllt). Die Spalte muss dennoch existieren. |
| `metadata` | Beliebige Daten, die mit dem Deskriptor der Tabelle bereitgestellt werden sollen. Rebase liest diese nicht. |

Zwei weitere Definitionen teilen die meisten dieser Schlüssel:
[`defineAuthTable`](/docs/schema/auth-table/) für die Tabelle, in der Benutzer gespeichert
werden, und [`defineView`](/docs/collections/views/) für SQL-Views.

## Namen

<span class="since-badge" data-since="0.31">Seit 0.31</span>

Das erste Argument von `defineTable` ist der Name der Tabelle und dient als Standardwert
für alles andere:

| Name | Standard | Override |
|---|---|---|
| SQL-Tabelle | der Name | `table: "blog_posts"` |
| API-Slug, SDK-Accessor, Scope-Ziel | der Name | `slug: "articles"` |
| Postgres-Schema | `public` | `schema: "content"` |
| SQL-Spalte einer Spalte | das snake_case ihres Schlüssels | das erste Argument des Builders: `col.text("legacy_name")` |

Der Schlüssel einer Spalte ist ihr Name in der JSON-Zeile, im SDK sowie in Filtern und
Sortierungen. Ihr SQL-Name ist das snake_case des Schlüssels: `publishDate` ist die Spalte
`publish_date` und `photoURL` ist `photo_url`. Das erste Argument eines Builders ordnet
einen Schlüssel einem beliebigen anderen SQL-Namen zu, wie in Drizzle (`col.text("legacy_name")`).
So kann eine Tabelle die Namen einer bestehenden Datenbank übernehmen, ohne das zu ändern,
was Clients sehen.

`table` und `schema` müssen einfache SQL-Bezeichner sein. Zwei Definitionen dürfen sich
keinen Namen, Slug oder eine SQL-Tabelle teilen. Der Slug ist über die URL hinaus wichtig:
Fremdschlüssel- und Junction-Spaltennamen werden daraus abgeleitet, sodass das Ändern des
Slugs einer bereits bereitgestellten Tabelle Spalten umbenennen kann. Setzen Sie `slug` explizit,
wenn er vom Namen der Tabelle abweichen soll, und ändern Sie ihn danach nicht mehr.

## Primärschlüssel

<span class="since-badge" data-since="0.31">Seit 0.31</span>

Es gibt keine implizite `id`-Spalte. Jede Tabelle markiert mindestens eine Spalte
mit `.primaryKey()`:

```ts
import { defineTable, col } from "@rebasepro/server/schema";

export const invoices = defineTable("invoices", {
    columns: {
        id:     col.uuid().primaryKey().defaultRandom(),
        number: col.integer().notNull().unique(),
    },
    rls: "admin-only",
});

// Several key columns form a composite key, in declaration order.
export const dailyStats = defineTable("daily_stats", {
    columns: {
        siteId: col.uuid().primaryKey(),
        day:    col.date().primaryKey(),
        views:  col.integer().notNull().default(0),
    },
    rls: "admin-only",
});
```

Eine Schlüsselspalte ist per Definition `NOT NULL`. Ein `uuid`-Schlüssel verwendet üblicherweise
`.defaultRandom()`; ein Integer-Schlüssel verwendet `.generatedByDefaultAsIdentity()`. Ein Schlüssel ohne
Standardwert wird vom Aufrufer bei der Erstellung übergeben. Eine Schlüsselspalte kann nicht
`.private()` sein und darf kein `timestamptz` oder `time` sein.

## Wann eine Definition abgelehnt wird

<span class="since-badge" data-since="0.31">Seit 0.31</span>

Ein Schema, das eine Tabelle ungeschützt oder unbrauchbar hinterlassen würde, erreicht niemals die
Datenbank. Es wird an drei Stellen abgelehnt:

1. **Im Editor.** `rls` und `columns` sind durch die Typen erforderlich, und
   `rls: []` ist keine gültige Konfiguration. Ein `tenant`- oder `softDelete`-Feld oder eine
   Indexspalte, die als einfacher Schlüssel geschrieben wurde und keine Spalte benennt, ist ein Typfehler.
2. **Beim Laden des Moduls.** `defineTable` wirft einen Fehler bei einer Tabelle ohne Spalten,
   einer Spalte, die kein `col.*`-Builder ist, einer Relation, die kein `rel.*`-Ergebnis
   ist, einer Relation mit demselben Schlüssel wie eine Spalte oder wenn kein verwendbares `rls` vorliegt.
   Dies fängt auch JavaScript-Code und Typecasts ab, die das Typsystem nicht erkennen kann.
3. **Beim Kompilieren des Schemas.** `rebase db generate`, `rebase db push`,
   `rebase doctor` und der Serverstart kompilieren alle Tabellen gemeinsam und brechen mit
   einem `SchemaDefinitionError` ab, der jedes Problem auflistet – jeweils mit Tabelle, der
   Spalte oder Relation und was stattdessen angegeben werden sollte:

```text
The schema cannot be used (2 problems):
  - posts: the table has no primary key. Mark a column `.primaryKey()` — e.g. `id: col.uuid().primaryKey().defaultRandom()`; several make a composite key in declaration order.
  - comments: `rls: "inherit"` takes the project's `defaultRls`, and none was given. Export `defaultRls` from backend/schema/index.ts (`"admin-only"` or a list of rules), or write this table's own `rls`.
```

Der Kompilierungsschritt prüft alles, wofür alle Tabellen gleichzeitig benötigt werden: Relationsziele und
deren Schlüsseltypen, Junction-Tabellen, die von zwei Relationen beansprucht werden, Slugs und SQL-Namen,
die kollidieren (einschließlich Namen, die kollidieren, sobald Postgres sie auf 63 Bytes kürzt), Regeln,
die eine Spalte benennen, die die Tabelle nicht besitzt, und `"inherit"` ohne `defaultRls`. Eine Tabelle,
die aus einer Datei neben `index.ts`, aber nicht aus `index.ts` selbst exportiert wird, wird ebenfalls
abgelehnt: Der Index ist die maßgebliche Liste der Tabellen.

## Nächste Schritte

<span class="since-badge" data-since="0.31">Seit 0.31</span>

- [Spalten](/docs/schema/columns/): alle `col.*`-Builder und -Modifikatoren
- [JSON-Dokumente](/docs/schema/json/): typisiertes und validiertes `jsonb` mit `json.*`
- [Relationen](/docs/collections/relations/): die fünf `rel.*`-Arten
- [Row-Level-Security](/docs/collections/security-rules/): die `rls`-Konfiguration und ihre Regeln
- [Tabellen-Hooks](/docs/collections/callbacks/): serverseitige Lifecycle-Hooks
- [Typinferenz](/docs/schema/types/): `InferRow`, `InferInsert` und `InferUpdate`
