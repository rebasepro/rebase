---
sourceHash: d74cc2ea4835551d
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

Hier `author_id` zu schreiben, wird beim Build abgelehnt: Es ist eine Spalte, keine Property der Collection, und `on` benennt Properties. Postgres indiziert eine Fremdschlüsselspalte nicht automatisch für Sie – ohne diesen Index sind sowohl „die Beiträge dieses Autors auflisten“ als auch die `ON DELETE`-Kaskade sequenzielle Scans.

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
- **Schema-Ensure beim Booten** erstellt sie ebenfalls, zu denselben Bedingungen wie die Such- und ANN-Indizes daneben. Ein Managed-Runtime-Mandant wird beim Booten bereitgestellt und führt niemals `db push` aus; ohne diesen Mechanismus würde er ohne deklarierte Indizes starten, ohne dass darauf hingewiesen würde. Eine Tabelle, die der Boot anlegt, erhält ihre Indizes mit der Tabelle. Auf einer bereits vorhandenen Tabelle baut der Boot einen fehlenden Index, nachdem der Server bedient, im Hintergrund, so wie er die [Fremdschlüssel-Indizes](#was-ein-upgrade-mit-einer-bestehenden-datenbank-macht) baut. Er verwendet `CREATE INDEX CONCURRENTLY` auf einer eigenen Verbindung, sodass das `statement_timeout` des Pools von 30 s einen langen Build nicht abbrechen kann. Ein Index, den ein unterbrochener Build unter seinem Namen als `INVALID` hinterlassen hat, wird entfernt und neu gebaut. `IF NOT EXISTS` vergleicht den Namen, repariert also nie einen solchen. Ein `unique`-Index wird auf dieselbe Weise gebaut, aber bevor der Server bedient, und der Boot schlägt fehl, wenn er nicht gebaut werden kann. Ohne ihn zu bedienen, würden doppelte Zeilen hineinkommen.

## Fremdschlüssel werden für Sie indiziert

Postgres erstellt den Index, auf den ein Fremdschlüssel *zeigt* — den Primärschlüssel des Ziels —, und nie einen auf der Spalte, die ihn *hält*. Jeder Lesezugriff von der anderen Seite einer Verknüpfung filtert auf dieser Spalte: ein `hasMany`- oder `hasOne`-Include, eine verschachtelte Auflistung wie `/authors/5/posts` (ihre Seite und ihre Zählung), die Rückseite einer `manyToMany` und die `ON DELETE`-Prüfung, wenn eine übergeordnete Zeile gelöscht wird. Ohne Index liest jeder davon jede Zeile der Kind-Tabelle.

Rebase leitet daher einen einfachen B-Tree ab für:

- den `localKey` jeder [`belongsTo`](/docs/collections/relations#belongsto--the-key-is-on-this-table) — das ist auch die Spalte, die das `hasOne` / `hasMany` der Gegenseite liest;
- die Zielspalte jeder `manyToMany`-Junction. Der Primärschlüssel `(source, target)` der Junction bedient bereits Abfragen nach der Quellspalte; die Rückseite der Verknüpfung braucht diesen hier. Eine Junction ist die Tabelle von Rebase, daher gibt es hierfür kein Opt-out.

Gemessen auf Postgres 18 mit warmem Cache, 1 Mio. Kommentare auf 50.000 Beiträgen:

| Der Lesezugriff | Ohne den Index | Mit ihm |
|---|---|---|
| `include=comments` auf einer Seite mit 25 Beiträgen (`post_id IN (…)`) | 38 ms | 0,3 ms |
| `GET /posts/77/comments?limit=25` — die Seite | 28 ms | 0,3 ms |
| …und sein `count(*)` | 29 ms | 0,2 ms |
| einen Beitrag löschen (`ON DELETE SET NULL`-Prüfung) | 129 ms | 1,7 ms |

Nichts wird doppelt indiziert. Der abgeleitete Index wird übersprungen, wenn die Spalte den Primärschlüssel bereits anführt, ein `UNIQUE` trägt (`validation.unique` an der Relation oder an der Property, der die Spalte gehört) oder einen Index in `indexes:` anführt — einfach oder zusammengesetzt, solange es ein B-Tree ohne `where` ist. Ein partieller Index kann keine Abfrage bedienen, die jede Zeile erreichen muss, und ein GIN- oder BRIN-Index beantwortet eine andere Frage, daher zählt keiner von beiden.

Der Name ist der, den [eine Deklaration](#wie-eine-deklaration-benannt-wird) eines einfachen Index auf dieser Spalte ableitet — `posts_author_id_ix_00ad191` —, sodass der abgeleitete Index und `indexes: [{ on: ["author"], … }]` ein Objekt sind, nicht zwei. Er ist wie jeder andere ein [eingefrorener abgeleiteter Name](/docs/architecture/schema-as-code).

Um die Constraint zu behalten und den Index wegzulassen — bei einer Tabelle, die so schreibintensiv ist, dass der Index mehr kostet als die Lookups, die er bedient, oder bei einer, auf der Sie einen eigenen Index außerhalb von `indexes:` führen —, sagen Sie es an der Relation:

```typescript
author: {
    name: "Author",
    type: "relation",
    relation: { kind: "belongsTo", target: () => authors, index: false }
}
```

`index` wird nur bei einer `belongsTo` akzeptiert; bei den anderen Arten lehnt der Config-Validator es ab, weil ihr Fremdschlüssel eine Spalte auf dem Ziel ist (setzen Sie `index` an der `belongsTo` des Ziels) oder in einer Junction liegt.

Rebase liest zu dieser Entscheidung nur Ihre Collections, nie die Datenbank: `db push` und der Boot müssen dieselbe Menge an Indizes mit denselben Namen erreichen, sonst würde der nächste Push entfernen, was der Boot gebaut hat. Ein Index, den Sie von Hand auf derselben Spalte außerhalb von `indexes:` angelegt haben, wird daher nicht gesehen — deklarieren Sie ihn in `indexes:` oder setzen Sie `index: false`, um einen Index statt zwei zu behalten.

### Was ein Upgrade mit einer bestehenden Datenbank macht

Die Indizes sind neue Objekte auf Tabellen, die bereits Daten enthalten, und die beiden Wege bauen sie unterschiedlich:

- **Der Boot wartet nicht auf sie.** Auf einer bereits vorhandenen Tabelle lässt das Schema-Ensure die fehlenden Fremdschlüssel-Indizes aus dem Boot heraus und baut sie, nachdem der Server bedient, einen nach dem anderen, mit `CREATE INDEX CONCURRENTLY` auf einer eigenen Verbindung (das `statement_timeout` des Pools von 30 s gilt dafür nicht). Das nimmt keine Sperre, auf die Lese- oder Schreibzugriffe warten. Eine Tabelle, die eine andere Sitzung hält — der Build einer anderen Instanz, ein `ALTER TABLE` —, wird innerhalb des Sperrbudgets des Boots aufgegeben und beim nächsten Boot erneut versucht. Ein Index, den ein unterbrochener Build als `INVALID` hinterlassen hat (ein Deploy, der den Prozess mitten im Build ersetzt hat, zwei Instanzen, die um einen Namen konkurrieren), wird entfernt und neu gebaut. Jeder wird beim Start und Ende protokolliert; ein Fehler ist eine Warnung, nie ein fehlgeschlagener Boot. Eine Tabelle, die dieser Boot anlegt, erhält ihre Indizes mit der Tabelle, bevor irgendetwas darauf schreiben kann. Unter `REBASE_PROVISION_ONLY` laufen die Builds, bevor der Prozess endet, da nichts danach sie ausführen würde.
- **`rebase db push` baut sie, bevor es plant**, mit demselben Builder und zu denselben Bedingungen wie der Boot: `CREATE INDEX CONCURRENTLY`, einen nach dem anderen, sodass Lese- und Schreibzugriffe weiterlaufen (etwa 0,4 s bei 1 Mio. Zeilen und 6 s bei 10 Mio. als einfacher Build auf einer Laptop-SSD, `maintenance_work_mem` 64 MB; ein nebenläufiger dauert länger und blockiert nichts). Atlas findet dann jeden Index vor und plant nichts dafür. Ein Index, den es zuvor nicht bauen konnte — eine Tabelle, die eine andere Sitzung das gesamte Sperrbudget über hielt —, bleibt Atlas überlassen, das ihn innerhalb der Transaktion des Push baut und damit Schreibzugriffe auf diese Tabelle für die Dauer des Builds blockiert; der Push sagt, welcher es ist. Eine Fremdschlüsselspalte, die der Push selbst hinzufügt, erhält ihren Index von Atlas zusammen mit der Spalte, bevor irgendetwas darin steht. `--dry-run` baut nichts: Es nennt die Indizes, die ein echter Push zuerst bauen würde, und der Plan, den es ausgibt, listet sie, da sie noch nicht existieren.

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
