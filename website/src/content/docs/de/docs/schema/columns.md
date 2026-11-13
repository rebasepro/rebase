---
sourceHash: a919caafccd81923
title: Spalten
sidebar_label: Spalten
description: "Jeder col.*-Builder und -Modifikator: der Postgres-Typ, den jeder erzeugt, der Typ, den ein Client liest und schreibt, und was die API erzwingt – Nullwertfähigkeit, Standardwerte, Stempel, Validierung, geschlossene Wertemengen, Zugriff und Speicherung."
---

<span class="since-badge" data-since="0.31">Since 0.31</span>

Eine Spalte ist ein `col.*`-Builder, verfeinert durch Modifikatoren. Der Builder bestimmt den
Postgres-Typ; die Modifikatoren bestimmen alles andere: ob die Spalte `null` sein
darf, ihren Standardwert, ihre Validierung und wer sie lesen und schreiben darf.

```ts
import { defineTable, col } from "@rebasepro/server/schema";

export const products = defineTable("products", {
    columns: {
        id:        col.uuid().primaryKey().defaultRandom(),
        sku:       col.varchar({ length: 32 }).notNull().unique(),
        name:      col.text().notNull().validate({ min: 2, max: 120, trim: true }),
        price:     col.numeric({ precision: 10, scale: 2 }).notNull().validate({ min: 0 }),
        status:    col.enum(["draft", "active", "retired"]).notNull().default("draft"),
        tags:      col.text().array().validate({ maxItems: 10 }),
        photo:     col.storage({ path: "products/", accept: ["image/*"], maxBytes: "5MB" }),
        createdBy: col.uuid().onCreateUser().readOnly(),
        createdAt: col.timestamp({ withTimezone: true }).notNull().onCreateNow(),
        updatedAt: col.timestamp({ withTimezone: true }).notNull().onUpdateNow(),
    },
    rls: "admin-only",
});
```

Builder sind unveränderlich (immutable): Jeder Modifikator gibt einen neuen Builder zurück, sodass eine Spalte
einmal deklariert und von mehreren Tabellen gemeinsam genutzt werden kann.

Nach dem Punkt liest sich eine Spalte wie `pg-core` von [Drizzle](https://orm.drizzle.team/docs/column-types/pg):
dieselben Builder-Namen, ein optionaler SQL-Spaltenname an erster Stelle, dann
Drizzles Konfigurationsobjekt, dann die Kette – `col.varchar({ length: 32 })`,
`col.timestamp({ withTimezone: true })`, `col.text().array()`,
`` .default(sql`now()`) ``. Eine Drizzle-Schreibweise, die hier etwas anderes bedeuten
würde, kompiliert nicht, und der Fehler erklärt, was stattdessen geschrieben werden muss. Zwei
Unterschiede sollten beachtet werden:

- **Ein Fremdschlüssel ist eine Relation.** Deklarieren Sie ihn unter `relations`:
  `author: rel.belongsTo(() => users, { localKey: "author_id" })`. Der
  Schlüssel der Relation ist das, was `include` benennt. `.references()` existiert nicht
  und weist darauf hin. Siehe [Relationen](/docs/collections/relations/).
- **`.defaultNow()` ist ausschließlich ein Datenbank-Standardwert**: `DEFAULT now()`,
  den ein Client weiterhin überschreiben kann. `.onCreateNow()` ist ein Server-[Stempel](#stempel): Der Server
  schreibt die Zeit bei der Erstellung, unabhängig davon, was der Client gesendet hat.

## Builder

<span class="since-badge" data-since="0.31">Since 0.31</span>

Ein Builder pro Postgres-Typ. Der Wire-Typ ist das, was ein Client in einer Zeile liest und
bei einem Schreibvorgang sendet, und wie das SDK sowie [`InferRow`](/docs/schema/types/)
die Spalte typisieren. Jeder Builder akzeptiert als erstes Argument einen optionalen SQL-Spaltennamen
(`col.text("legacy_title")`); ohne diesen entspricht der SQL-Name dem
snake_case des Schlüssels.

| Builder | Postgres-Typ | Wire-Typ | Hinweise |
|---|---|---|---|
| `col.uuid()` | `UUID` | `string` | `.defaultRandom()` für `gen_random_uuid()` |
| `col.text()` | `TEXT` | `string` | `col.text({ enum: [...] })` akzeptiert nur diese Werte; siehe [Geschlossene Wertemengen](#geschlossene-wertemengen) |
| `col.varchar({ length })` | `VARCHAR(n)` | `string` | die Länge ist erforderlich; akzeptiert auch `enum` |
| `col.char({ length })` | `CHAR(n)` | `string` | die Länge ist erforderlich; akzeptiert auch `enum` |
| `col.enum(values)` | ein Postgres-Enum-Typ, `<table>_<column>` | die Union von `values` | siehe [Geschlossene Wertemengen](#geschlossene-wertemengen) |
| `pgEnum(name, values)`, dann `status()` | ein benannter Postgres-Enum-Typ | die Union von `values` | jede Spalte davon teilt sich den einen Typ |
| `col.smallint()` | `SMALLINT` | `number` | |
| `col.integer()` | `INTEGER` | `number` | |
| `col.bigint({ mode: "number" })` | `BIGINT` | `number` | als JavaScript-Zahl gelesen und geschrieben |
| `col.smallserial()` | `SMALLSERIAL` | `number` | hat einen Standardwert; in einem neuen Schema `col.smallint().generatedByDefaultAsIdentity()` bevorzugen |
| `col.serial()` | `SERIAL` | `number` | hat einen Standardwert; `col.integer().generatedByDefaultAsIdentity()` bevorzugen |
| `col.bigserial({ mode: "number" })` | `BIGSERIAL` | `number` | hat einen Standardwert; `col.bigint({ mode: "number" }).generatedByDefaultAsIdentity()` bevorzugen |
| `col.real()` | `REAL` | `number` | |
| `col.doublePrecision()` | `DOUBLE PRECISION` | `number` | |
| `col.numeric({ precision?, scale? })` | `NUMERIC`, `NUMERIC(p)`, `NUMERIC(p, s)` | `number` | eine Skala erfordert eine Präzision; `col.decimal()` ist derselbe Builder |
| `col.boolean()` | `BOOLEAN` | `boolean` | |
| `col.timestamp({ withTimezone: true })` | `TIMESTAMPTZ` | `string` (ISO 8601) | ein Schreibvorgang akzeptiert auch ein `Date`; ein Zeitstempel ohne Zeitzone ist `col.custom({ dataType: "timestamp" })` |
| `col.date()` | `DATE` | `string` (`YYYY-MM-DD`) | ein Schreibvorgang akzeptiert auch ein `Date` |
| `col.time()` | `TIME` | `string` (`HH:MM:SS`) | ein Schreibvorgang akzeptiert auch ein `Date` |
| `col.jsonb()` / `col.jsonb(shape)` | `JSONB` | `unknown` (`.$type<T>()` typisiert es) oder der Typ der Form | siehe [JSON-Dokumente](/docs/schema/json/) |
| `col.json()` / `col.json(shape)` | `JSON` | wie `jsonb` | behält den übergebenen Text bei; `jsonb` bevorzugen |
| `<builder>.array()` | `<inner>[]` | ein Array des inneren Wire-Typs | `col.text().array()`; keine Arrays von Arrays; siehe [Arrays](#arrays) |
| `col.vector({ dimensions, index? })` | `vector(dimensions)` (pgvector) | `number[]` | ein HNSW-Kosinus-Index, sofern `index` nichts anderes angibt; siehe [Vektorsuche](/docs/backend/vector-search/) |
| `col.bytea()` | `BYTEA` | `string` (base64) | |
| `col.geopoint()` | `JSONB` | `{ latitude: number; longitude: number }` | |
| `col.storage(options)` | `TEXT` | `string` (Pfad der Datei) | `.multiple()` macht daraus `TEXT[]`; siehe [Storage-Spalten](#storage-spalten) |
| `col.custom({ dataType })` | jeder andere Postgres-Typ, wörtlich (`"inet"`, `"citext"`) | `string` (`.$type<T>()` typisiert es) | Rebase benennt den Typ im DDL und leitet Werte unverändert durch |

## Modifikatoren

<span class="since-badge" data-since="0.31">Since 0.31</span>

Jeder Builder verfügt über die erste Gruppe. Der Rest existiert nur bei den Buildern, für die
sie sinnvoll sind; der Aufruf an anderer Stelle ist ein Typfehler.

| Modifikator | An | Datenbank | API und Typen |
|---|---|---|---|
| `.notNull()` | jede Spalte | `NOT NULL` | niemals `null` in einer Zeile; bei Erstellung erforderlich, sofern kein Standardwert vorliegt |
| `.primaryKey()` | jede Spalte | Teil des Primärschlüssels, `NOT NULL` | im `Update`-Typ nicht vorhanden |
| `.unique()` | jede Spalte | Einspaltiges `UNIQUE` | ein Duplikat ergibt `409` |
| `.default(value)` | jede Spalte | `DEFAULT <value>` | wird vom Treiber auch bei Erstellung angewendet; optional bei Erstellung |
| `` .default(sql`expr`) `` | jede Spalte | `DEFAULT <expr>` | optional bei Erstellung; `sql` wird neben `col` importiert |
| `.dbDefault()` | jede Spalte | belässt den bestehenden Standardwert der Datenbank | optional bei Erstellung |
| `` .generatedAlwaysAs(sql`expr`) `` | jede Spalte | `GENERATED ALWAYS AS (<expr>) STORED` | niemals beschreibbar, von niemandem |
| `.$type<T>()` | jede Spalte | keine | typisiert den Wert nur für TypeScript, wie in Drizzle |
| `.array()` | jede Spalte | `<type>[]` | siehe [Arrays](#arrays) |
| `.readOnly()` | jede Spalte | keine | Schreibvorgänge von Clients werden abgelehnt; nicht in `Insert` und `Update` vorhanden |
| `.private()` | jede Spalte | keine | niemals über das Netzwerk, im SDK oder in OpenAPI |
| `.access({ read?, write? })` | jede Spalte | keine | rollenbasierter Lese- und Schreibzugriff; siehe [Feldzugriff](/docs/collections/field-access/) |
| `.describe(text)` | jede Spalte | keine | die Beschreibung in OpenAPI und MCP |
| `.validate(rules)` | jede Spalte | keine | vor jedem Schreibvorgang geprüft; Regeln hängen vom Typ ab, siehe [Validierung](#validierung) |
| `.transform({ beforeSave?, afterRead? })` | jede Spalte | keine | Hooks auf Feldebene; `value` ist `T \| null`, es sei denn, `.notNull()` steht davor; siehe [Tabellen-Hooks](/docs/collections/callbacks/#field-hooks-transform) |
| `.oneOf(values)` | numerische Spalten | keine | nur diese Werte werden akzeptiert; als deren Union typisiert (eine Textspalte verwendet `{ enum: [...] }`) |
| `.defaultRandom()` | `col.uuid()` | `DEFAULT gen_random_uuid()` | optional bei Erstellung |
| `.generatedByDefaultAsIdentity()` | `col.smallint()`, `col.integer()`, `col.bigint({ mode: "number" })` | `GENERATED BY DEFAULT AS IDENTITY` | optional bei Erstellung |
| `.defaultNow()` | `timestamptz`, `date`, `time` | `DEFAULT now()` | optional bei Erstellung; ein Client kann dennoch einen Wert senden |
| `.onCreateNow()` | `timestamptz`, `date`, `time` | `DEFAULT now()` | der Server stempelt die Zeit bei der Erstellung |
| `.onUpdateNow()` | `timestamptz`, `date`, `time` | `DEFAULT now()` und ein `BEFORE UPDATE`-Trigger | der Server stempelt die Zeit bei der Erstellung und bei jeder Aktualisierung |
| `.onCreateUser()` | Textspalten, `col.uuid()` | keine | der Server schreibt die ID des Aufrufers bei der Erstellung |
| `.onUpdateUser()` | Textspalten, `col.uuid()` | keine | der Server schreibt die ID des Aufrufers bei jedem Schreibvorgang |
| `.userId()` | Textspalten, `col.uuid()` | keine | die Spalte enthält die ID eines Benutzers; das Panel bietet eine Benutzerauswahl; siehe [Benutzerspalten](#benutzerspalten) |
| `.multiple()` | `col.storage()` | `TEXT[]` | die Spalte enthält mehrere Dateipfade |

## Null, erforderlich und Standardwerte

<span class="since-badge" data-since="0.31">Since 0.31</span>

Spalten sind standardmäßig nullable. `.notNull()` und `.primaryKey()` machen eine Spalte
`NOT NULL`, und die API erfordert sie dann bei der Erstellung, sofern sie keinen Standardwert hat. Eine
`NOT NULL`-Spalte ist `T` in einer Zeile; jede andere Spalte ist `T | null`.

Ein Standardwert ist eines von `.default()`, `` .default(sql`…`) ``, `.defaultNow()`,
`.dbDefault()`, `.defaultRandom()`, `.generatedByDefaultAsIdentity()`, ein Stempel
oder ein Serial-Builder. Eine Spalte mit einem
Standardwert kann bei einer Erstellung weggelassen werden:

```ts
import { defineTable, col, sql } from "@rebasepro/server/schema";

export const tickets = defineTable("tickets", {
    columns: {
        id:       col.integer().primaryKey().generatedByDefaultAsIdentity(),
        code:     col.text().notNull().default(sql`gen_short_id()`),
        priority: col.smallint().notNull().default(3),
        legacy:   col.text().dbDefault(),
    },
    rls: "admin-only",
});
```

- **`.default(value)`** wird als `DEFAULT` der Spalte geschrieben und vom
  Treiber auch bei der Erstellung angewendet, sodass eine Zeile unabhängig davon, wer sie einfügt,
  identisch ausfällt. Eine zeitbezogene Spalte akzeptiert auch ein `Date`, das als ISO-String gespeichert wird.
  Der Standardwert einer Enum-Spalte muss einer ihrer Werte sein.
- **`` .default(sql`expression`) ``** wird von Postgres ausgewertet. Der Ausdruck wird
  unverändert in das DDL geschrieben, weshalb das `sql`-Tag kein `${…}` akzeptiert.
  `.defaultNow()` entspricht `` .default(sql`now()`) ``.
- **`.dbDefault()`** besagt, dass die Datenbank bereits einen Standardwert enthält, den das
  Schema nicht deklariert. Ein Create-Aufruf kann die Spalte weglassen, und ein Schema-Push entfernt
  den Standardwert nicht.

`.generatedAlwaysAs()` kann keinen Standardwert oder Stempel haben: Postgres berechnet die Spalte
bei jedem Schreibvorgang. Eine Primärschlüssel-Spalte kann nicht `.private()` sein.

## Stempel

<span class="since-badge" data-since="0.31">Since 0.31</span>

Ein Stempel ist ein Wert, den der Server selbstständig in eine Spalte schreibt. Er überschreibt
alles, was ein Client für diese Spalte sendet.

| Stempel | Schreibt | Wann |
|---|---|---|
| `.onCreateNow()` | die aktuelle Zeit | bei der Erstellung |
| `.onUpdateNow()` | die aktuelle Zeit | bei der Erstellung und bei jeder Aktualisierung |
| `.onCreateUser()` | die Benutzer-ID des Aufrufers | bei der Erstellung |
| `.onUpdateUser()` | die Benutzer-ID des Aufrufers | bei der Erstellung und bei jeder Aktualisierung |

Eine Spalte kann einen Stempel enthalten. Der Aufruf eines zweiten, anderen Stempels löst beim
Laden des Moduls einen Fehler aus; `.onUpdateNow()` allein versieht die Zeile bereits bei ihrer Erstellung
mit einem Stempel. Stempel-Spalten bleiben nullable, es sei denn, Sie definieren `.notNull()`.

Über `.onCreateUser()` erhält eine Spalte ihren Wert, die eine Row-Level-Security-Regel
mit dem Aufrufer vergleicht (`ownerField`). Eine Spalte, die der Aufrufer befüllt, ist eine Spalte,
bei der der Aufrufer falsche Angaben machen kann.

## Benutzerspalten

<span class="since-badge" data-since="0.31">Since 0.31</span>

`.userId()` gibt an, dass eine Spalte die ID eines Benutzers enthält. Es handelt sich um eine semantische Bedeutung, nicht um
einen Typ: Die Spalte bleibt `text` (oder `varchar`, `char`, `uuid`), und der vom
Server bereitgestellte Deskriptor trägt `semantic: "user"`.

```ts
import { defineTable, col } from "@rebasepro/server/schema";

export const tickets = defineTable("tickets", {
    columns: {
        id: col.uuid().primaryKey().defaultRandom(),
        subject: col.text().notNull(),
        assignedTo: col.text().userId().describe("Team member assigned to this ticket"),
        watchers: col.text().userId().array()
    },
    rls: "admin-only"
});
```

Daraus folgt zweierlei:

- Das Admin-Panel rendert für die Spalte eine Benutzerauswahl anstelle eines Texteingabefelds
  und zeigt den Benutzer anstelle der rohen ID an.
- Ein Aufrufer, der in die Tabelle schreiben darf, kann Benutzer nachschlagen, um sie auszufüllen. Die
  Leseabfrage der Auswahlkomponente liefert Ergebnisse, selbst wenn Row-Level Security die Zeilen anderer
  Benutzer vor ihnen verbirgt.

Es funktioniert auf `col.text()`, `col.varchar()`, `col.char()` und `col.uuid()`,
auf den Elementen eines Arrays (`col.text().userId().array()`) sowie auf
`json.string()` innerhalb eines [JSON-Dokuments](/docs/schema/json/). Überall sonst
löst es beim Laden des Moduls einen Fehler aus. Es deklariert keinen Fremdschlüssel: Schreiben Sie
`rel.belongsTo(() => users)`, wenn die Datenbank einen erzwingen soll. Um die
Spalte vom Server mit der ID des Aufrufers füllen zu lassen, verwenden Sie stattdessen einen [Stempel](#stempel).

## Validierung

<span class="since-badge" data-since="0.31">Since 0.31</span>

`.validate(rules)` nimmt die Regeln für den Spaltentyp entgegen. Die API prüft sie
vor einer Erstellung oder Aktualisierung und verweigert den Schreibvorgang mit einem `400`-Fehler,
der die Spalte benennt. Das zweifache Aufrufen von `.validate()` führt die Regeln zusammen.

| Regel | Textspalten und `col.storage()` | Numerische Spalten | `timestamptz`, `date`, `time` | Arrays |
|---|---|---|---|---|
| `min`, `max` | Länge | inklusive Grenzen | frühester und spätester Wert (ISO-String oder `Date`) | |
| `length` | genaue Länge | | | |
| `matches`, `matchesFlags`, `matchesMessage` | ein Muster (String oder `RegExp`) und die Fehlermeldung | | | |
| `email`, `url` | der Wert ist eine E-Mail-Adresse oder eine URL | | | |
| `trim`, `lowercase`, `uppercase` | der Wert wird normalisiert, bevor er gespeichert wird | | | |
| `lessThan`, `moreThan` | | exklusive Grenzen | | |
| `positive`, `negative`, `integer` | | Vorzeichen, ganze Zahl | | |
| `minItems`, `maxItems`, `uniqueItems` | | | | Anzahl der Elemente, keine Duplikate |
| `requiredMessage` | ✓ | ✓ | ✓ | ✓ |

`requiredMessage` ist der Fehler, den ein Create-Aufruf erhält, wenn eine `.notNull()`-Spalte
ohne Standardwert weggelassen wird. Jeder andere Spaltentyp (`uuid`, `enum`, `boolean`,
JSON, `vector`, `bytea`, `geopoint`) akzeptiert ausschließlich `requiredMessage`.

Ein `RegExp` wird als Quelle und Flags gespeichert, und eine `Date`-Grenze als ISO-String,
sodass die über das Netzwerk übertragenen Regeln genau den Regeln entsprechen, die der Server prüft.

```ts
import { defineTable, col } from "@rebasepro/server/schema";

export const signups = defineTable("signups", {
    columns: {
        id:       col.uuid().primaryKey().defaultRandom(),
        email:    col.text().notNull().validate({ email: true, lowercase: true, trim: true, requiredMessage: "Enter your e-mail address." }),
        handle:   col.varchar({ length: 32 }).validate({ matches: /^[a-z0-9_]+$/, matchesMessage: "Lower-case letters, digits and _ only." }),
        age:      col.smallint().validate({ integer: true, min: 13 }),
        birthday: col.date().validate({ max: "2013-01-01" }),
    },
    rls: "admin-only",
});
```

Bei `col.varchar({ length })` und `col.char({ length })` wird die Länge sowohl von
Postgres als auch von der API erzwungen. Ein davon abweichendes `max` widerspricht diesem Wert;
geben Sie die Länge nur einmal an.

## Geschlossene Wertemengen

<span class="since-badge" data-since="0.31">Since 0.31</span>

Zwei Möglichkeiten, nur bestimmte Werte zu akzeptieren:

- **Ein Postgres-Enum-Typ**, sodass auch die Datenbank die Menge erzwingt.
  `col.enum(values)` erstellt einen Typ namens `<table>_<column>`. Ein Typ mit einem Namen
  Ihrer Wahl, der von mehreren Spalten geteilt wird, wird einmal mit
  `pgEnum(name, values)` deklariert – wie in Drizzle – und in jeder Spalte aufgerufen:
  `postStatus()`. Zwei Deklarationen desselben Namens müssen dieselben Werte
  in derselben Reihenfolge auflisten.
- **Eine von der API geprüfte Menge** ohne Postgres-Typ: `{ enum: [...] }` auf
  `col.text()`, `col.varchar()` oder `col.char()` und `.oneOf(values)` auf einer
  numerischen Spalte. Dies ist auch das Format für ein Array bekannter Strings:
  `col.text({ enum: ["a", "b"] }).array()`.

Alle typisieren die Spalte als Union ihrer Werte: `status` unten ist in der Zeile
`"draft" | "published"`, `kind` ist `"news" | "guide"` und `rating`
ist `1 | 2 | 3 | 4 | 5`.

```ts
import { defineTable, col, pgEnum } from "@rebasepro/server/schema";

const reviewStatus = pgEnum("review_status", ["draft", "published"]);

export const reviews = defineTable("reviews", {
    columns: {
        id:     col.uuid().primaryKey().defaultRandom(),
        status: reviewStatus().notNull().default("draft"),
        kind:   col.text({ enum: ["news", "guide"] }),
        rating: col.smallint().notNull().oneOf([1, 2, 3, 4, 5]),
        labels: col.text({ enum: ["bug", "praise", "question"] }).array(),
    },
    rls: "admin-only",
});
```

Bezeichnungen und Farben für die Werte dienen der Darstellung. Sie gehören ins CMS, nicht
in die Tabelle.

## Arrays

<span class="since-badge" data-since="0.31">Since 0.31</span>

`.array()` erstellt ein Postgres-Array des Spaltentyps, wie in Drizzle:
`col.text().array()` ist `TEXT[]`, `col.integer().array()` ist `INTEGER[]`. Was
vor `.array()` verkettet wird, beschreibt jedes einzelne Element: sein `{ enum }`, `.validate()`,
`.oneOf()`, Speicheroptionen und `.transform()`. Was danach kommt, beschreibt
die Array-Spalte: deren eigenes `.validate()` akzeptiert `minItems`, `maxItems` und
`uniqueItems`.

Modifikatoren, die eine Spalte beschreiben (`.notNull()`, ein Standardwert, `.unique()`,
`.access()`), stehen nach `.array()` – `col.text().array().notNull().default([])`;
davor kompilieren sie nicht. Ein Array von Arrays wird abgewiesen; verwenden Sie
`col.jsonb()` für verschachtelte Listen. Ein Array enthält Skalare – Text, `uuid`, Zahlen,
Booleans, Datumsangaben, Enums: ein `.array()` von `jsonb`, `json`, `vector`, `bytea`,
Geopoints oder `col.custom()` wird abgewiesen, und eine Liste von Dokumenten, Punkten oder
Vektoren wird über `col.jsonb(json.array(…))` abgebildet. Ein benutzerdefinierter Listentyp wird direkt benannt:
`col.custom({ dataType: "inet[]" })`.

Jedes Element wird so ausgeliefert, wie sein Typ auf einer skalaren Spalte ausgeliefert wird: ein
`timestamptz[]`-Element als RFC-3339-String, ein `numeric[]`-Element als Zahl und
ein Null-Element als `null`.

## Schlüssel, Identity und Serials

<span class="since-badge" data-since="0.31">Since 0.31</span>

`.generatedByDefaultAsIdentity()` macht eine Integer-Spalte zu `GENERATED BY DEFAULT
AS IDENTITY`. Dies ist das Format für einen Integer-Schlüssel in einem neuen Schema
(`.generatedAlwaysAsIdentity()` kompiliert nicht: Rebase erstellt Identities ausschließlich
by default). Die Serial-Builder (`col.smallserial()`, `col.serial()`,
`col.bigserial({ mode: "number" })`) existieren für Schemas, die diese
bereits verwenden; eine Spalte, die auf einen Serial-Schlüssel verweist, ist die einfache Ganzzahl
derselben Breite. Siehe [Primärschlüssel](/docs/schema/#primary-keys) für zusammengesetzte Schlüssel.

`col.bigint({ mode: "number" })` wird als JavaScript-`number` gelesen und geschrieben
(Drizzles `mode: "bigint"` kompiliert nicht), was bis
2⁵³ − 1 exakt ist. `col.numeric()` ist ebenfalls eine `number`, überträgt also die Genauigkeit
eines Double über das Netzwerk, unabhängig von der Genauigkeit, die Postgres speichert.

## Wer eine Spalte lesen und schreiben darf

<span class="since-badge" data-since="0.31">Since 0.31</span>

Row-Level Security entscheidet, welche Zeilen ein Aufrufer erreicht. Drei Modifikatoren schränken ein,
was dieser von einer Zeile sieht und setzen darf:

- **`.readOnly()`** lehnt jeden clientseitigen Schreibzugriff auf die Spalte ab, sowohl bei der Erstellung als auch bei der
  Aktualisierung, unabhängig von der Rolle des Aufrufers. Die Datenbank (ein Standardwert, ein Trigger) und
  Server-Code können sie weiterhin befüllen. Die Spalte ist in den Typen `Insert` und `Update`
  nicht vorhanden.
- **`.private()`** belässt die Spalte auf dem Server: sie fehlt in jeder Zeile über das
  Netzwerk, im SDK, in OpenAPI und wird in Filtern und Sortierungen abgewiesen. Hooks und
  Server-Code haben weiterhin Zugriff darauf. Eine private Spalte kann nicht zusätzlich `.access()` deklarieren.
- **`.access({ read, write })`** listet die Rollen auf, die die Spalte empfangen, und die
  Rollen, die sie schreiben dürfen. Wird eine Liste weggelassen, unterliegt diese Richtung der Zeile; eine
  leere Liste sperrt sie für jeden Aufrufer.

[Feldzugriff](/docs/collections/field-access/) behandelt, was ein Aufrufer sieht, wenn
eine Spalte vorenthalten wird, sowie jeden Zugriffsweg, für den die Regel gilt.

## Storage-Spalten

<span class="since-badge" data-since="0.31">Since 0.31</span>

`col.storage(options)` enthält den Pfad einer Datei in einem Storage-Bucket. Die Upload-Route
erzwingt `accept` und `maxBytes`, und der Orphan-Sweep wertet die Datei als
referenziert, solange eine Zeile ihren Pfad enthält. `.multiple()` sorgt dafür, dass die Spalte
mehrere Pfade enthält (`TEXT[]`).

```ts
import { defineTable, col } from "@rebasepro/server/schema";

export const listings = defineTable("listings", {
    columns: {
        id:     col.uuid().primaryKey().defaultRandom(),
        cover:  col.storage({ path: "listings/{id}/", accept: ["image/*"], maxBytes: "10MB",
                              imageResize: { maxWidth: 1600, format: "webp", quality: 80 } }),
        photos: col.storage({ path: "listings/{id}/gallery/", accept: ["image/*"] }).multiple(),
        terms:  col.storage({ path: "listings/terms/", accept: ["application/pdf"], public: true }),
    },
    rls: "admin-only",
});
```

| Option | Funktion |
|---|---|
| `path` | **Erforderlich.** Zielort der Dateien als Pfad-Template: `"posts/heroes/"`, `"users/{id}/"`. |
| `source` | Der in `backend/resources.ts` deklarierte Bucket. Ohne Angabe der Standard-Bucket. |
| `accept` | Akzeptierte MIME-Typen, mit Wildcards: `["image/*", "application/pdf"]`. |
| `maxBytes` | Die maximal akzeptierte Dateigröße: eine Anzahl von Bytes oder eine Größenangabe wie `"10MB"`, `"512 kb"`, `"1.5GB"`. Binäre Vielfache: 1 MB entspricht 1.048.576 Bytes. Eine ungültige Größenangabe löst einen Fehler aus. |
| `imageResize` | Bilder vor dem Speichern skalieren: `maxWidth`, `maxHeight`, `mode` (`"contain"` oder `"cover"`), `format` (`"original"`, `"jpeg"`, `"png"`, `"webp"`), `quality`. |
| `public` | Dateien sind ohne signierte URL lesbar. |
| `fileName` | Der gespeicherte Dateiname als Template. Ohne Angabe der hochgeladene Name. |
| `metadata` | Metadaten, die mit jeder Datei gespeichert werden. |
| `includeBucketUrl` | Die Bucket-URL vor dem Pfad speichern. |
| `storeUrl` | Die Download-URL anstelle des Pfads speichern. |

Eine Storage-Spalte übernimmt die Validierungsregeln für Textspalten. Eine Datei innerhalb eines JSON-Dokuments
wird mit denselben Optionen über `json.storage()` definiert; siehe
[JSON-Dokumente](/docs/schema/json/). Wer welche Pfade hoch- und herunterladen darf, regelt die
[Storage-Autorisierung](/docs/backend/storage-authorization/); die Bereitstellung und
das Caching der Dateien wird unter [Storage](/docs/backend/storage/) beschrieben.

## Was abgelehnt wird

<span class="since-badge" data-since="0.31">Since 0.31</span>

Beim Laden des Moduls wirft ein Builder einen Fehler bei:

- `col.varchar()` oder `col.char()` ohne Längenangabe; einer `length` oder `dimensions`,
  die keine positive ganze Zahl ist, und `col.numeric({ scale })` ohne Präzision;
- `col.enum([])`, `pgEnum(name, { … })` und dem `.array()` eines Arrays;
- einem `sql`-Standardwert oder einem generierten Ausdruck mit Interpolation;
- einem zweiten, unterschiedlichen Stempel auf einer Spalte und `.oneOf()` mit einem Wert, der
  weder String noch Zahl ist;
- `.access()`, dessen `read` oder `write` keine Liste nicht-leerer Rollennamen ist;
- `col.storage()` ohne `path` oder mit einem `maxBytes`, das keine gültige Größenangabe ist.

Beim Kompilieren des Schemas wird die Tabelle abgelehnt bei:

- einem Standardwert in Kombination mit `.generatedAlwaysAs()` oder einem Stempel in Kombination damit;
- `.generatedByDefaultAsIdentity()` auf einer Nicht-Integer-Spalte, `.defaultRandom()` auf einer Nicht-`uuid`-Spalte,
  einem Zeitstempel auf einer nicht-zeitbezogenen Spalte, einem Benutzer-Stempel auf einer Spalte, die
  weder Text noch `uuid` ist;
- einem `.private()`-Primärschlüssel oder einem Primärschlüssel vom Typ `timestamptz` oder `time`;
- einem Primärschlüssel auf einer Spalte vom Typ `jsonb`, `json`, Geopoint, `vector`, `bytea`, Array oder
  benutzerdefinierte Liste: Ein Schlüssel ist ein Skalar (Text, `varchar`, `char`, `uuid`, ein
  Enum, eine Zahl, ein Boolean oder ein Datum). `schema introspect` überspringt eine auf diese Weise
  geschlüsselte Tabelle und gibt den Grund an;
- einem `.array()` von `jsonb`, `json`, `vector`, `bytea`, Geopoints oder
  `col.custom()` (siehe [Arrays](#arrays));
- einer `.validate()`-Regel, die vom Spaltentyp, seinen Elementen oder einem JSON-Knoten nicht
  geprüft wird (`integer` auf einer Textspalte, `trim` auf einer Zahl, `minItems` auf einem Skalar);
- einer Spalte, die sowohl `.private()` als auch `.access()` deklariert;
- einem `.transform()` auf einer Spalte und einem weiteren auf deren JSON-Form;
- einem `col.custom({ dataType })`, dessen Typname nicht dem Format eines Postgres-Typnamens
  entspricht;
- `.oneOf([])` und `.oneOf()` auf einer Spalte, die weder Text noch numerisch ist;
- einem Enum mit einem leeren oder doppelten Wert oder einem Standardwert, der nicht zu seinen
  Werten gehört;
- zwei Schlüsseln, die in dieselbe SQL-Spalte aufgelöst werden, auch nachdem Postgres
  die Namen auf 63 Bytes kürzt;
- einem benannten Enum-Typ, dem zwei unterschiedliche Wertelisten übergeben wurden.

Jede Ablehnung nennt die Tabelle, die Spalte und was stattdessen zu schreiben ist.

Drizzle-Schreibweisen, die hier etwas anderes bedeuten würden, kompilieren nicht, und der
Compiler gibt aus, was geschrieben werden soll: `col.timestamp()` ohne `withTimezone: true`,
`.references()`, `.$defaultFn()`, `.$onUpdate()`, `.generatedAlwaysAsIdentity()`,
`.unique("name")`, `mode: "string"` bei `numeric` sowie `col.inet()`, `col.interval()`
und die anderen Typen, die Rebase ausschließlich über `col.custom({ dataType })` anspricht.

## Nächste Schritte

<span class="since-badge" data-since="0.31">Since 0.31</span>

- [JSON-Dokumente](/docs/schema/json/): die Struktur einer `jsonb`-Spalte
- [Relationen](/docs/collections/relations/): Fremdschlüssel stammen aus `rel.*`, nicht aus Spalten
- [Feldzugriff](/docs/collections/field-access/): `.access()`, `.private()` und `.readOnly()` im Detail
- [Typinferenz](/docs/schema/types/): was jeder Modifikator für `InferRow` und `InferInsert` bewirkt
