---
sourceHash: 17ca6f6a285eea43
title: Indizes
sidebar_label: Indizes
description: Deklarieren Sie gewöhnliche Postgres-Indizes für eine Collection – btree, GIN und BRIN, partiell, zusammengesetzt, abdeckend und eindeutig – und warum ein handgeschriebener früher verschwand.
---

Eine Collection deklariert die Indizes, die ihre Abfragen benötigen, in derselben Datei wie die Properties, die sie abdecken:

```typescript
import type { PostgresCollectionConfig } from "@rebasepro/types";

const posts: PostgresCollectionConfig = {
    slug: "posts",
    table: "posts",
    name: "Blog posts",
    properties: {
        id: { name: "ID", type: "string", isId: "uuid" },
        title: { name: "Title", type: "string" },
        status: { name: "Status", type: "string", enum: { draft: "Draft", published: "Published" } },
        publish_date: { name: "Publish date", type: "date" }
    },
    indexes: [
        {
            on: ["status", { prop: "publish_date", direction: "desc" }],
            reason: "admin list: filter by status, newest first"
        }
    ]
};
```

Nur Postgres. Bei einer anderen Engine wird der Schlüssel beim Booten abgelehnt, anstatt stillschweigend ignoriert zu werden.

## Warum es das gibt

Der DDL-Generator hat schon immer Index-Anweisungen für genau zwei Dinge ausgegeben, und bei beiden handelt es sich um Strukturen, die einem *Feature* gehören, anstatt von Ihnen geschriebenen Abfragen: der GIN-Index hinter einem [`search`-Block](/docs/backend/search) und der ANN-Index hinter einer [`vector`-Property](/docs/sdk/aggregates-and-search#the-index). Der Standardfall – der B-Tree hinter einer `where`-Klausel – hatte überhaupt keinen Ort zur Deklaration.

Der einzige Weg, einen solchen zu haben, bestand also darin, ihn manuell zu schreiben. Und:

:::caution[Wenn Sie manuell geschriebene Indizes auf einer von Rebase verwalteten Tabelle haben]
`rebase db push` ist deklarativ. Ein Index auf einer verwalteten Tabelle, der in `schema.sql` fehlte, zählte als Drift, und Atlas plante dafür ein `DROP INDEX` ein – was nicht in der Liste destruktiver Anweisungen steht, sodass die automatisch genehmigte Anwendung dies ohne Nachfrage ausführte. Jeder manuell geschriebene Index auf einer verwalteten Tabelle lebte auf geborgter Zeit.

Das wird durch die unten stehende Eigentümerregel behoben: Ein Index, den Rebase nicht erstellt hat, wird nun anhand des Namens aus dem Diff ausgeschlossen und niemals angerührt. Das Deklarieren Ihrer manuell geschriebenen Indizes ist immer noch der bessere Endzustand – ein deklarierter Index wird auf einer neuen Datenbank und auf jedem Mandanten erstellt, ein manuell geschriebener hingegen nicht –, aber in der Zwischenzeit werden sie durch nichts mehr gelöscht.
:::

## Die Struktur

| Feld | Typ | Beschreibung |
|-------|------|-------------|
| `on` | `(string \| IndexKey)[]` | **Erforderlich.** Die Schlüsselspalten in Reihenfolge. 1–5 Einträge. |
| `reason` | `string` | **Erforderlich.** Warum dieser Index existiert, in einer Zeile. |
| `using` | `"btree" \| "gin" \| "brin"` | Zugriffsmethode. Standardmäßig `btree`. |
| `where` | `IndexPredicate` | Macht den Index partiell – er deckt nur die Zeilen ab, die hierauf zutreffen. |
| `unique` | `boolean` | Nur btree. Eine zusammengesetzte Eindeutigkeitsgarantie. |
| `include` | `string[]` | Nur btree. Payload-Spalten für Index-only Scans. |

### `on` akzeptiert Property-Schlüssel, niemals Spaltennamen

Das ist die typische Falle. Eine `belongsTo`-Relation kompiliert zu ihrem aufgelösten `localKey`, sodass die Property `author` der Spalte `author_id` entspricht:

```typescript
// Correct — `author` is the relation property.
{ on: ["author"], reason: "an author's posts, and the ON DELETE cascade" }
```

Hier `author_id` zu schreiben, würde für die meisten Properties funktionieren und bei einem Fremdschlüssel – genau dem, den man eigentlich meint – stillschweigend gar nichts indizieren. Postgres indiziert eine Fremdschlüsselspalte nicht automatisch für Sie – ohne diesen Index sind sowohl „die Beiträge dieses Autors auflisten“ als auch die `ON DELETE`-Kaskade sequenzielle Scans.

Eine `hasMany`- oder Many-to-Many-Relation besitzt keine Spalte auf dieser Tabelle und wird unter Verweis auf die Collection abgelehnt, die den Fremdschlüssel tatsächlich besitzt.

### Die Reihenfolge ist wichtig, und nur eine führende Teilmenge ist nutzbar

Postgres kann eine führende Teilmenge der Schlüsselspalten verwenden, sodass `["ownerId", "createdAt"]` eine Abfrage bedient, die nach `ownerId` filtert, sowie eine, die nach beiden filtert, und **niemals** eine, die nur nach `createdAt` filtert.

`direction` und `nulls` haben ihre Daseinsberechtigung nur dann, wenn das `ORDER BY` einer Abfrage Richtungen mischt. Ein einzelner `DESC`-Index ist redundant zu seinem `ASC`-Zwilling – Postgres scannt einen B-Tree rückwärts genauso schnell –, sodass ein einziger Index sowohl den Filter *als auch* die Sortierung im Beispiel oben auf dieser Seite bedient.

```typescript
{ on: [{ prop: "createdAt", direction: "desc", nulls: "last" }], reason: "…" }
```

Den Postgres-Standard explizit hinzuschreiben, ist unschädlich: Der abgeleitete Name hasht die *effektive* Reihenfolge, sodass das Hinzufügen von `direction: "asc"` zu einer Spalte, die ohnehin bereits aufsteigend war, keine Neudefinition darstellt und nichts neu aufbaut.

Die Obergrenze liegt bei fünf Schlüsseln. Postgres erlaubt zweiunddreißig; ab vier sind die nachfolgenden Spalten bei jedem Schreibvorgang nur noch Ballast, und die Deklaration ist meist Ausdruck der Hoffnung, dass eine Abfrage durch bloßes Anhäufen schneller wird. Payload-Spalten, nach denen nicht gesucht wird, gehören in `include`, was nicht auf das Limit angerechnet wird.

### `where` ist strukturiert, kein SQL

```typescript
{
    on: ["publish_date"],
    where: { prop: "status", op: "=", value: "published" },
    reason: "public feed: published posts by date"
}
```

Der Index enthält dann nur veröffentlichte Zeilen und bleibt klein, während sich Entwürfe ansammeln.

Operatoren sind `=`, `!=`, `<`, `<=`, `>`, `>=`, `in`, `is null` und `is not null`, kombiniert mit `and`:

```typescript
{
    on: ["assignee"],
    where: {
        and: [
            { prop: "status", op: "in", value: ["open", "in_progress"] },
            { prop: "archived_at", op: "is null" }
        ]
    },
    reason: "the open-work queue, which is a fraction of the table"
}
```

Es gibt ganz bewusst kein `or`. Ein OR-Prädikat bedeutet fast immer, dass der Index überhaupt nicht partiell sein sollte; wenn Sie wirklich eines benötigen, deklarieren Sie zwei Indizes.

Ein Prädikat ist eine Struktur und kein String, da ein String nicht anhand der Properties der Collection überprüft werden könnte, nicht mit einem Fingerprint versehen werden könnte, ohne seinen eigenen Text in den Indexnamen aufzunehmen – eine Neuformatierung würde also einen Live-Index umbenennen – und es wäre die einzige Stelle, an der ein Aufrufer zu einer Operator-Klasse einer Extension greifen könnte, die der Planner nicht nachvollziehen kann.

### `unique` ist nur für zusammengesetzte Indizes

Die Eindeutigkeit für einzelne Spalten wird über `validation.unique` auf der Property geregelt; sie hier ebenfalls zu deklarieren, wird abgelehnt, anstatt als Synonym akzeptiert zu werden. `validation.unique` kompiliert zu einem Inline-`UNIQUE`, dessen zugrunde liegenden Index Postgres – nicht Rebase – `<table>_<column>_key` nennt.

```typescript
{ on: ["workspaceId", "slug"], unique: true, reason: "one slug per workspace" }
```

### `include` ermöglicht einen Index-only Scan

Payload-Spalten liegen in den Blattseiten: nicht durchsuchbar, nicht sortiert, und sie sparen einen Heap-Fetch auf Kosten eines größeren Index. Sie dürfen sich nicht mit `on` überschneiden.

```typescript
{ on: ["status"], include: ["title"], reason: "the status sidebar counts, without touching the heap" }
```

### `using`

`btree` (Standard) deckt Gleichheit, Bereiche, `ORDER BY` und Eindeutigkeit ab.

`gin` dient der Enthaltenseins-Prüfung (Containment) über eine `array`-Property oder eine JSONB-`map`. `brin` ist für eine natürlich geordnete Spalte auf einer Append-Only-Tabelle gedacht – winzig und nutzlos in dem Moment, in dem Zeilen unvollständig geordnet eintreffen. Keiner von beiden besitzt eine Sortierung, daher sind `direction` und `nulls` bei ihnen nicht darstellbar, anstatt erst später von Postgres abgelehnt zu werden.

Es gibt weder `gist` noch `hash`: Jede interessante Gist-Operator-Klasse wird über eine Extension bereitgestellt, und Hash-Indizes können weder eindeutig noch zusammengesetzt oder sortiert sein. Diese Einschränkung hält das gesamte Modell auf dem Atlas-Pfad – `rebase db push` materialisiert den gewünschten Zustand in einer leeren Scratch-Datenbank, um dagegen zu planen, und `CREATE EXTENSION` darf nicht in dieser Datei stehen. **Trigramm-Suche ist [`search:`](/docs/backend/search); ANN ist eine [`vector`-Property](/docs/sdk/aggregates-and-search#the-index).** Ein Index, der `gin_trgm_ops` oder `vector_cosine_ops` benötigt, wird zur Build-Zeit abgelehnt, anstatt erst später auf einer Datenbank fehlzuschlagen, die Sie noch nie gesehen haben.

### `reason` ist erforderlich

Es ist das einzige Pflichtfeld, hinter dem kein SQL steht.

Ein Index ist das Einzige, was eine Rebase-Konfiguration deklarieren kann, das dauerhaft Geld kostet und dessen Nutzen aus der Konfiguration heraus unsichtbar ist. Der Grund (`reason`) ist das, was neben „0 Scans in 34 Tagen, 412 MB“ ausgegeben wird – genau der Moment, in dem jemand in der Lage ist zu entscheiden, ob er gelöscht werden soll. Ohne ihn kann niemand entscheiden, also tut es niemand, und die Tabelle häuft über die gesamte Lebensdauer des Produkts Indizes an.

Er ist ganz bewusst **nicht** Teil der Identität des Index – das Umformulieren einer Begründung baut einen Index niemals neu auf.

## Wie eine Deklaration benannt wird

`<table>_<columns>_ix_<7 hex>`, oder `_ux_`, wenn eindeutig. Zum Beispiel `posts_status_publish_date_ix_a91c3f4`.

Der Hash wird über die *Semantik* des Index gebildet – Methode, Spalten, Reihenfolge, Eindeutigkeit, enthaltene Spalten, Prädikat – und nicht über dessen gerendertes SQL, sodass eine Änderung an der Art und Weise, wie Rebase DDL formatiert, niemals etwas in Ihrer Datenbank umbenennt.

Der Hash ist tragend. `CREATE INDEX IF NOT EXISTS` prüft auf den **Namen**, nicht auf die Definition: Bei einem lesbaren Namen würde eine Änderung einer Deklaration den alten Index beibehalten und für immer Erfolg melden. Mit dem Hash im Namen ist eine Neudefinition ein anderes Objekt, sodass es neu erstellt und das alte gelöscht wird.

Zwei erwähnenswerte Konsequenzen:

- **Das Ändern einer Deklaration ist ein DROP und ein CREATE**, direkt ausgeführt – ohne `CONCURRENTLY` und mit einem Zeitfenster dazwischen, in dem kein Index existiert. Auf einer Entwicklungsdatenbank ist das in Ordnung; auf einer großen Produktivtabelle sollten Sie dies zu einem selbst gewählten Zeitpunkt anwenden.
- Der Name ist [ein eingefrorener abgeleiteter Name](/docs/architecture/schema-as-code). Er steht in `contracts/derived-names.txt` und kann sich über Releases hinweg nicht ändern.

## Wer Eigentümer eines Index ist

`_ix_`/`_ux_` plus sieben Hex-Zeichen ist für jeden anderen Namensgeber hier unerreichbar – `_fkey`, `_gin`, `_trgm`, `_pkey`, `_key`, die Vektordistanzen, das `idx_`-Präfix von Auth. Daher entscheidet der Name allein über die Eigentümerschaft:

| Der Index | Im Plan? | Von Rebase benannt? | Was passiert |
|---|---|---|---|
| deklariert | ja | ja | wird erstellt, dann beibehalten |
| Deklaration gelöscht | nein | ja | **wird gelöscht (dropped)**, wie beabsichtigt |
| manuell geschrieben oder aus Introspektion | nein | nein | **ausgeschlossen – wird niemals angerührt** |

Keiner der Fälle erfordert eine Bestätigung. Das Löschen einer Deklaration *sollte* den Index stillschweigend entfernen; was niemals gelöscht werden darf, ist ein Index, den Rebase nicht erstellt hat. Das ist auch das, was den Roundtrip bei der Introspektion sicher macht: Die vorhandenen Indizes einer Datenbank, auf die Sie Rebase gerichtet haben, gelten als fremd, bis jemand sie deklariert.

## Wann sie erstellt werden

Beide Producer geben sie aus, was wichtig ist, da nicht jedes Deployment `db push` ausführt:

- **`rebase db push` / `rebase db generate`** schreiben sie in `schema.sql`, auf dem normalen Atlas-Pfad – sodass sie wie jedes andere Objekt Migrationen, Drift-Erkennung und Rollbacks erhalten.
- **`rebase schema generate`** schreibt sie auch in `schema.generated.ts`, sodass das Drizzle-Schema dieselbe Tabelle beschreibt, die die Datenbank besitzt. Die `INCLUDE`-Spalten eines abdeckenden Index sind die einzige Ausnahme: Drizzle kann sie nicht abbilden, und die generierte Zeile enthält einen entsprechenden Kommentar, der auf `schema.sql` verweist, wo dies möglich ist.
- **Schema-Ensure beim Booten** erstellt sie mit `CREATE INDEX CONCURRENTLY IF NOT EXISTS` zu denselben Bedingungen wie die ANN-Indizes daneben. Ein Managed-Runtime-Mandant wird beim Booten bereitgestellt und führt niemals `db push` aus; ohne diesen Mechanismus würde er ohne deklarierte Indizes starten, ohne dass darauf hingewiesen würde.

## Was abgelehnt wird, und wann

All dies führt zur Build-Zeit zu Fehlern, unter Nennung der Collection und der Position im Array – ein Index, der stillschweigend nicht existiert, ist genau der Fehler, den dieses gesamte Feature beseitigt:

- eine Property, die nicht in der Collection vorhanden ist, oder eine Relation, deren Fremdschlüssel auf der anderen Tabelle liegt
- mehr als fünf Schlüssel in `on` oder dieselbe Spalte doppelt
- exakt die Primärschlüsselspalten – `<table>_pkey` indiziert diese bereits
- eine Spalte sowohl in `on` als auch in `include`
- `unique` auf einer einzelnen Spalte, deren Property bereits `validation.unique` deklariert
- `direction` oder `nulls` unter `gin` oder `brin`
- eine `in`-Liste, die einen Wert wiederholt
- zwei Deklarationen, die denselben Namen ableiten – es handelt sich zweimal um denselben Index
- eine leere oder fehlende `reason`

## Verwandte Themen

- [Suche](/docs/backend/search) – gerankte Volltextsuche, die ihren eigenen GIN-Index über einen generierten `tsvector` aufbaut
- [Vektorsuche](/docs/sdk/aggregates-and-search#vector-search) – der ANN-Index über einer Embedding-Spalte, konfiguriert an der Property
- [Schema as Code](/docs/architecture/schema-as-code) – wie Deklarationen die Datenbank erreichen und was ein abgeleiteter Name ist

---
