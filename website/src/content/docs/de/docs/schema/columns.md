---
sourceHash: b2705ba2e3901257
title: Spalten
sidebar_label: Spalten
description: "Jeder col.*-Builder und Modifikator: der Postgres-Typ, den jeder erzeugt, der Typ, den ein Client liest und schreibt, und was die API erzwingt – Nullable-Status, Standardwerte, Stamps, Validierung, geschlossene Wertemengen, Zugriff und Speicher."
---

Eine Spalte ist ein `col.*`-Builder, der durch Modifikatoren verfeinert wird. Der Builder bestimmt den Postgres-Typ; die Modifikatoren bestimmen alles andere: ob die Spalte null sein darf, ihren Standardwert, ihre Validierung sowie wer sie lesen und schreiben darf.

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

Builder sind unveränderlich (immutable): Jeder Modifikator gibt einen neuen Builder zurück, sodass eine Spalte einmal deklariert und von mehreren Tabellen gemeinsam genutzt werden kann.

Hinter dem Punkt liest sich eine Spalte wie `pg-core` von [Drizzle](https://orm.drizzle.team/docs/column-types/pg): dieselben Builder-Namen, ein optionaler SQL-Spaltenname an erster Stelle, dann Drizzles Konfigurationsobjekt, gefolgt von der Kette – `col.varchar({ length: 32 })`, `col.timestamp({ withTimezone: true })`, `col.text().array()`, `` .default(sql`now()`) ``. Eine Drizzle-Schreibweise, die hier etwas anderes bedeuten würde, kompiliert nicht, und der Fehlerhinweis gibt an, was stattdessen zu schreiben ist. Zwei Unterschiede, die zu beachten sind:

- **Ein Fremdschlüssel ist eine Relation.** Deklarieren Sie ihn unter `relations`: `author: rel.belongsTo(() => users, { localKey: "author_id" })`. Der Schlüssel der Relation ist das, was `include` benennt. `.references()` existiert nicht und weist explizit darauf hin. Siehe [Relationen](/docs/collections/relations/).
- **`.defaultNow()` ist ausschließlich ein Datenbank-Standardwert**: `DEFAULT now()`, den ein Client weiterhin überschreiben kann. `.onCreateNow()` ist ein Server-[Stamp](#stamps): Der Server schreibt beim Erstellen den Zeitstempel, unabhängig davon, was der Client gesendet hat.

## Builder

Ein Builder pro Postgres-Typ. Der Wire-Typ ist das, was ein Client in einer Zeile liest und bei einem Schreibvorgang sendet, und wie das SDK und [`InferRow`](/docs/schema/types/) die Spalte typisieren. Jeder Builder nimmt als erstes Argument einen optionalen SQL-Spaltennamen entgegen (`col.text("legacy_title")`); ohne diesen entspricht der SQL-Name dem `snake_case` des Schlüssels.

| Builder | Postgres-Typ | Wire-Typ | Hinweise |
|---|---|---|---|
| `col.uuid()` | `UUID` | `string` | `.defaultRandom()` für `gen_random_uuid()` |
| `col.text()` | `TEXT` | `string` | `col.text({ enum: [...] })` akzeptiert nur diese Werte; siehe [Geschlossene Wertemengen](#geschlossene-wertemengen) |
| `col.varchar({ length })` | `VARCHAR(n)` | `string` | die Länge ist erforderlich; nimmt auch `enum` an |
| `col.char({ length })` | `CHAR(n)` | `string` | die Länge ist erforderlich; nimmt auch `enum` an |
| `col.enum(values)` | ein Postgres-Enum-Typ, `<table>_<column>` | die Union von `values` | siehe [Geschlossene Wertemengen](#geschlossene-wertemengen) |
| `pgEnum(name, values)`, dann `status()` | ein benannter Postgres-Enum-Typ | die Union von `values` | jede Spalte daraus teilt sich denselben Typ |
| `col.smallint()` | `SMALLINT` | `number` | |
| `col.integer()` | `INTEGER` | `number` | |
| `col.bigint({ mode: "number" })` | `BIGINT` | `number` | gelesen und geschrieben als JavaScript-`number` |
| `col.smallserial()` | `SMALLSERIAL` | `number` | hat einen Standardwert; in einem neuen Schema `col.smallint().generatedByDefaultAsIdentity()` bevorzugen |
| `col.serial()` | `SERIAL` | `number` | hat einen Standardwert; `col.integer().generatedByDefaultAsIdentity()` bevorzugen |
| `col.bigserial({ mode: "number" })` | `BIGSERIAL` | `number` | hat einen Standardwert; `col.bigint({ mode: "number" }).generatedByDefaultAsIdentity()` bevorzugen |
| `col.real()` | `REAL` | `number` | |
| `col.doublePrecision()` | `DOUBLE PRECISION` | `number` | |
| `col.numeric({ precision?, scale? })` | `NUMERIC`, `NUMERIC(p)`, `NUMERIC(p, s)` | `number` | `scale` erfordert `precision`; `col.decimal()` ist derselbe Builder |
| `col.boolean()` | `BOOLEAN` | `boolean` | |
| `col.timestamp({ withTimezone: true })` | `TIMESTAMPTZ` | `string` (ISO 8601) | ein Schreibvorgang akzeptiert auch ein `Date`; ein Timestamp ohne Zeitzone ist `col.custom({ dataType: "timestamp" })` |
| `col.date()` | `DATE` | `string` (`YYYY-MM-DD`) | ein Schreibvorgang akzeptiert auch ein `Date` |
| `col.time()` | `TIME` | `string` (`HH:MM:SS`) | ein Schreibvorgang akzeptiert auch ein `Date` |
| `col.jsonb()` / `col.jsonb(shape)` | `JSONB` | `unknown` (`.$type<T>()` typisiert es) oder der Typ der Shape | siehe [JSON-Dokumente](/docs/schema/json/) |
| `col.json()` / `col.json(shape)` | `JSON` | wie `jsonb` | behält den übergebenen Text bei; `jsonb` bevorzugen |
| `<builder>.array()` | `<inner>[]` | ein Array des inneren Wire-Typs | `col.text().array()`; keine Arrays von Arrays; siehe [Arrays](#arrays) |
| `col.vector({ dimensions, index? })` | `vector(dimensions)` (pgvector) | `number[]` | ein HNSW-Kosinus-Index, sofern `index` nichts anderes angibt; siehe [Vektorsuche](/docs/backend/vector-search/) |
| `col.bytea()` | `BYTEA` | `string` (base64) | |
| `col.geopoint()` | `JSONB` | `{ latitude: number; longitude: number }` | |
| `col.storage(options)` | `TEXT` | `string` (der Pfad der Datei) | `.multiple()` macht daraus `TEXT[]`; siehe [Storage-Spalten](#storage-spalten) |
| `col.custom({ dataType })` | jeder andere Postgres-Typ, wörtlich (`"inet"`, `"citext"`) | `string` (`.$type<T>()` typisiert es) | Rebase nennt den Typ in DDL und reicht Werte unverändert durch |

## Modifikatoren

Jeder Builder verfügt über die erste Gruppe. Die restlichen existieren nur auf den Buildern, für die sie sinnvoll sind; der Aufruf an anderer Stelle führt zu einem Typfehler.

| Modifikator | Anwendbar auf | Datenbank | API und Typen |
|---|---|---|---|
| `.notNull()` | jede Spalte | `NOT NULL` | niemals `null` in einer Zeile; beim Erstellen erforderlich, sofern kein Standardwert vorhanden ist |
| `.primaryKey()` | jede Spalte | Teil des Primärschlüssels, `NOT NULL` | fehlt im `Update`-Typ |
| `.unique()` | jede Spalte | Einzelspalten-`UNIQUE` | ein Duplikat führt zu einem `409` |
| `.default(value)` | jede Spalte | `DEFAULT <value>` | wird beim Erstellen auch vom Treiber angewendet; beim Erstellen optional |
| `` .default(sql`expr`) `` | jede Spalte | `DEFAULT <expr>` | beim Erstellen optional; `sql` wird neben `col` importiert |
| `.dbDefault()` | jede Spalte | belässt den bestehenden Standardwert der Datenbank unverändert | beim Erstellen optional |
| `.serverDefault()` | jede Spalte | keine | ein Hook befüllt ihn; beim Erstellen optional, und das Formular des Panels erfordert ihn nicht |
| `` .generatedAlwaysAs(sql`expr`) `` | jede Spalte | `GENERATED ALWAYS AS (<expr>) STORED` | niemals beschreibbar, von niemandem |
| `.$type<T>()` | jede Spalte | keine | typisiert den Wert ausschließlich für TypeScript, wie in Drizzle |
| `.array()` | jede Spalte | `<type>[]` | siehe [Arrays](#arrays) |
| `.readOnly()` | jede Spalte | keine | Schreibzugriffe von Clients werden verweigert; fehlt in `Insert` und `Update` |
| `.private()` | jede Spalte | keine | niemals über die Leitung übertragen, weder im SDK noch in OpenAPI |
| `.access({ read?, write? })` | jede Spalte | keine | rollenbasierter Lese- und Schreibzugriff; siehe [Feldzugriff](/docs/collections/field-access/) |
| `.describe(text)` | jede Spalte | keine | die Beschreibung in OpenAPI und MCP |
| `.validate(rules)` | jede Spalte | keine | vor jedem Schreibvorgang geprüft; Regeln hängen vom Typ ab, siehe [Validierung](#validierung) |
| `.transform({ beforeSave?, afterRead? })` | jede Spalte | keine | Hooks auf Feldebene; `value` ist `T \| null`, es sei denn, `.notNull()` steht davor; siehe [Tabellen-Hooks](/docs/collections/callbacks/#field-hooks-transform) |
| `.oneOf(values)` | numerische Spalten | keine | nur diese Werte werden akzeptiert; als deren Union typisiert (eine Textspalte verwendet `{ enum: [...] }`) |
| `.defaultRandom()` | `col.uuid()` | `DEFAULT gen_random_uuid()` | beim Erstellen optional |
| `.generatedByDefaultAsIdentity()` | `col.smallint()`, `col.integer()`, `col.bigint({ mode: "number" })` | `GENERATED BY DEFAULT AS IDENTITY` | beim Erstellen optional |
| `.defaultNow()` | `timestamptz`, `date`, `time` | `DEFAULT now()` | beim Erstellen optional; ein Client kann weiterhin einen Wert übergeben |
| `.onCreateNow()` | `timestamptz`, `date`, `time` | `DEFAULT now()` | der Server setzt beim Erstellen den Zeitstempel |
| `.onUpdateNow()` | `timestamptz`, `date`, `time` | `DEFAULT now()` und ein `BEFORE UPDATE`-Trigger | der Server setzt den Zeitstempel beim Erstellen und bei jeder Aktualisierung |
| `.onCreateUser()` | Textspalten, `col.uuid()` | keine | der Server schreibt beim Erstellen die ID des Aufrufers |
| `.onUpdateUser()` | Textspalten, `col.uuid()` | keine | der Server schreibt bei jedem Schreibvorgang die ID des Aufrufers |
| `.userId()` | Textspalten, `col.uuid()` | keine | die Spalte enthält die ID eines Benutzers; das Panel bietet eine Benutzerauswahl; siehe [Benutzer-Spalten](#benutzer-spalten) |
| `.multiple()` | `col.storage()` | `TEXT[]` | die Spalte enthält mehrere Dateipfade |

## Null, erforderlich und Standardwerte

Spalten sind standardmäßig nullable. `.notNull()` und `.primaryKey()` machen eine Spalte `NOT NULL`, und die API verlangt sie dann beim Erstellen, es sei denn, sie besitzt einen Standardwert. Eine `NOT NULL`-Spalte ist `T` in einer Zeile; jede andere Spalte ist `T | null`.

Ein Standardwert ist eine der folgenden Optionen: `.default()`, `` .default(sql`…`) ``, `.defaultNow()`, `.dbDefault()`, `.serverDefault()`, `.defaultRandom()`, `.generatedByDefaultAsIdentity()`, ein Stamp oder ein Serial-Builder. Eine Spalte mit einem Standardwert kann beim Erstellen weggelassen werden:

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

- **`.default(value)`** wird als `DEFAULT` der Spalte geschrieben und beim Erstellen auch vom Treiber angewendet, sodass eine Zeile unabhängig davon, wer sie einfügt, identisch ausfällt. Eine temporale Spalte akzeptiert auch ein `Date`, das als ISO-String gespeichert wird. Der Standardwert einer Enum-Spalte muss einer ihrer Werte sein.
- **`` .default(sql`expression`) ``** wird von Postgres ausgewertet. Der Ausdruck wird unverändert in das DDL geschrieben, weshalb das `sql`-Tag keine `${…}`-Interpolation annimmt. `.defaultNow()` entspricht `` .default(sql`now()`) ``.
- **`.dbDefault()`** besagt, dass die Datenbank bereits einen Standardwert enthält, den das Schema nicht deklariert. Ein Erstellungsvorgang darf die Spalte weglassen, und ein Schema-Push entfernt den Standardwert nicht.
- **`.serverDefault()`** besagt, dass der tabelleneigene Servercode die Spalte befüllt, wenn sie beim Erstellen weggelassen wird: etwa ein `hooks.beforeSave`, der einen Slug aus dem Titel ableitet, oder das `.transform()` der Spalte. Ein Hook ist Code, den niemand von außen einsehen kann, weshalb die Spalte explizit deklariert, was sie tut. Es wird kein DDL-Standardwert geschrieben; ein Erstellungsvorgang kann die Spalte weglassen, OpenAPI listet sie nicht als erforderlich auf, und das Formular des Panels erlaubt das Erstellen eines Datensatzes ohne sie (kein `filledByServer` in der Anpassung erforderlich).

`.generatedAlwaysAs()` kann weder einen Standardwert noch einen Stamp besitzen: Postgres berechnet die Spalte bei jedem Schreibvorgang. Eine Primärschlüssel-Spalte kann nicht `.private()` sein.

## Stamps

Ein Stamp ist ein Wert, den der Server selbstständig in eine Spalte schreibt. Er überschreibt alles, was ein Client für diese Spalte sendet.

| Stamp | Schreibt | Wann |
|---|---|---|
| `.onCreateNow()` | die aktuelle Zeit | beim Erstellen |
| `.onUpdateNow()` | die aktuelle Zeit | beim Erstellen und bei jeder Aktualisierung |
| `.onCreateUser()` | die Benutzer-ID des Aufrufers | beim Erstellen |
| `.onUpdateUser()` | die Benutzer-ID des Aufrufers | beim Erstellen und bei jeder Aktualisierung |

Eine Spalte kann genau einen Stamp haben. Der Aufruf eines zweiten, abweichenden Stamps löst beim Laden des Moduls einen Fehler aus; `.onUpdateNow()` allein versieht die Zeile bereits beim Erstellen mit einem Stamp. Stamp-Spalten bleiben nullable, es sei denn, Sie geben `.notNull()` an.

Über `.onCreateUser()` erhält eine Spalte ihren Wert, die eine Row-Level-Security-Regel mit dem Aufrufer vergleicht (`ownerField`). Eine Spalte, die der Aufrufer selbst befüllt, ist eine Spalte, bei der der Aufrufer falsche Angaben machen kann.

## Benutzer-Spalten

`.userId()` gibt an, dass eine Spalte die ID eines Benutzers enthält. Es handelt sich um eine semantische Bedeutung, nicht um einen Typ: Die Spalte bleibt `text` (oder `varchar`, `char`, `uuid`), und der vom Server bereitgestellte Deskriptor trägt `semantic: "user"`.

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

Daraus ergeben sich zwei Dinge:

- Das Admin-Panel rendert für die Spalte eine Benutzerauswahl anstelle eines Texteingabefelds und zeigt den Benutzer anstelle der reinen ID an.
- Ein Aufrufer, der in die Tabelle schreiben darf, kann Benutzer nachschlagen, um das Feld zu befüllen. Die Leseabfrage der Auswahl antwortet ihnen selbst dann, wenn Row-Level Security die Zeilen anderer Benutzer vor ihnen verbirgt.

Dies funktioniert auf `col.text()`, `col.varchar()`, `col.char()` und `col.uuid()`, auf den Elementen eines Arrays (`col.text().userId().array()`) sowie auf `json.string()` innerhalb eines [JSON-Dokuments](/docs/schema/json/). An jeder anderen Stelle wird beim Laden des Moduls ein Fehler ausgelöst. Es deklariert keinen Fremdschlüssel: Schreiben Sie `rel.belongsTo(() => users)`, wenn die Datenbank einen solchen erzwingen soll. Um die Spalte vom Server mit der ID des Aufrufers befüllen zu lassen, verwenden Sie stattdessen einen [Stamp](#stamps).

## Validierung

`.validate(rules)` nimmt die Regeln für den Typ der Spalte entgegen. Die API überprüft sie vor jedem Erstellen oder Aktualisieren und verweigert den Schreibvorgang mit einem `400`-Fehler, der die Spalte benennt. Der zweimalige Aufruf von `.validate()` führt die Regeln zusammen.

| Regel | Textspalten und `col.storage()` | Numerische Spalten | `timestamptz`, `date`, `time` | Arrays |
|---|---|---|---|---|
| `min`, `max` | Länge | inklusive Grenzen | frühester und spätester Wert (ISO-String oder `Date`) | |
| `length` | exakte Länge | | | |
| `matches`, `matchesFlags`, `matchesMessage` | ein Muster (String oder `RegExp`) und die Fehlermeldung | | | |
| `email`, `url` | der Wert ist eine E-Mail-Adresse oder eine URL | | | |
| `trim`, `lowercase`, `uppercase` | der Wert wird normalisiert, bevor er gespeichert wird | | | |
| `lessThan`, `moreThan` | | exklusive Grenzen | | |
| `positive`, `negative`, `integer` | | Vorzeichen, ganze Zahl | | |
| `minItems`, `maxItems`, `uniqueItems` | | | | Anzahl der Elemente, keine Duplikate |
| `requiredMessage` | ✓ | ✓ | ✓ | ✓ |

`requiredMessage` ist der Fehler, den ein Erstellungsvorgang erhält, wenn eine `.notNull()`-Spalte ohne Standardwert weggelassen wird. Jeder andere Spaltentyp (`uuid`, `enum`, `boolean`, JSON, `vector`, `bytea`, `geopoint`) akzeptiert ausschließlich `requiredMessage`.

Ein `RegExp` wird als Quelle und Flags gespeichert, und eine `Date`-Grenze als ISO-String, sodass die über die Leitung bereitgestellten Regeln genau den Regeln entsprechen, die der Server überprüft.

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

Bei `col.varchar({ length })` und `col.char({ length })` wird die Länge sowohl von Postgres als auch von der API erzwungen. Ein `max`, das davon abweicht, steht im Widerspruch dazu; geben Sie die Länge nur einmal an.

## Geschlossene Wertemengen

Zwei Wege, um nur bestimmte Werte zu akzeptieren:

- **Ein Postgres-Enum-Typ**, sodass die Datenbank die Menge ebenfalls erzwingt. `col.enum(values)` erstellt einen Typ mit dem Namen `<table>_<column>`. Ein Typ mit einem Namen Ihrer Wahl, der von mehreren Spalten gemeinsam genutzt wird, wird einmalig mit `pgEnum(name, values)` deklariert – wie in Drizzle – und in jeder Spalte aufgerufen: `postStatus()`. Zwei Deklarationen desselben Namens müssen dieselben Werte in derselben Reihenfolge auflisten.
- **Eine von der API geprüfte Menge** ohne Postgres-Typ: `{ enum: [...] }` auf `col.text()`, `col.varchar()` oder `col.char()` sowie `.oneOf(values)` auf einer numerischen Spalte. Dies ist auch die Form für ein Array bekannter Strings: `col.text({ enum: ["a", "b"] }).array()`.

Alle Varianten typisieren die Spalte als Union ihrer Werte: `status` unten ist `"draft" | "published"` in der Zeile, `kind` ist `"news" | "guide"` und `rating` ist `1 | 2 | 3 | 4 | 5`.

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

Labels und Farben für die Werte dienen der Präsentation. Sie gehören in das CMS, nicht in die Tabelle.

## Arrays

`.array()` erzeugt ein Postgres-Array des Typs der Spalte, wie in Drizzle: `col.text().array()` ist `TEXT[]`, `col.integer().array()` ist `INTEGER[]`. Was vor `.array()` verkettet wird, beschreibt jedes einzelne Element: dessen `{ enum }`, `.validate()`, `.oneOf()`, Storage-Optionen und `.transform()`. Was danach folgt, beschreibt die Array-Spalte: Ihr eigenes `.validate()` akzeptiert `minItems`, `maxItems` und `uniqueItems`.

Modifikatoren, die eine Spalte beschreiben (`.notNull()`, ein Standardwert, `.unique()`, `.access()`), stehen hinter `.array()` – `col.text().array().notNull().default([])`; davor kompilieren sie nicht. Ein Array von Arrays wird abgelehnt; verwenden Sie `col.jsonb()` für verschachtelte Listen. Ein Array enthält Skalare – Text, `uuid`, Zahlen, Booleans, Daten, Enums: Ein `.array()` von `jsonb`, `json`, `vector`, `bytea`, Geopoints oder `col.custom()` wird abgelehnt; eine Liste von Dokumenten, Punkten oder Vektoren ist `col.jsonb(json.array(…))`. Ein benutzerdefinierter Listentyp wird direkt benannt: `col.custom({ dataType: "inet[]" })`.

Jedes Element wird so bereitgestellt, wie sein Typ auf einer skalaren Spalte bereitgestellt wird: ein `timestamptz[]`-Element als RFC 3339-String, ein `numeric[]`-Element als Zahl und ein Null-Element als `null`.

## Schlüssel, Identität und Serials

`.generatedByDefaultAsIdentity()` macht eine ganzzahlige Spalte zu `GENERATED BY DEFAULT AS IDENTITY`. Dies ist das Standardformat für einen ganzzahligen Schlüssel in einem neuen Schema (`.generatedAlwaysAsIdentity()` kompiliert nicht: Rebase erstellt Identitäten ausschließlich by default). Die Serial-Builder (`col.smallserial()`, `col.serial()`, `col.bigserial({ mode: "number" })`) existieren für Schemas, die diese bereits nutzen; eine Spalte, die auf einen Serial-Schlüssel verweist, ist die einfache Ganzzahl derselben Breite. Siehe [Primärschlüssel](/docs/schema/#primary-keys) für zusammengesetzte Schlüssel.

`col.bigint({ mode: "number" })` wird als JavaScript-`number` gelesen und geschrieben (Drizzles `mode: "bigint"` kompiliert nicht), was bis 2⁵³ − 1 exakt ist. `col.numeric()` ist ebenfalls eine `number`, weshalb es über die Leitung die Genauigkeit eines Doubles trägt, unabhängig davon, welche Präzision Postgres speichert.

## Wer eine Spalte lesen und schreiben darf

Row-Level Security bestimmt, welche Zeilen ein Aufrufer erreicht. Drei Modifikatoren schränken ein, was Aufrufer von einer Zeile sehen und was sie setzen dürfen:

- **`.readOnly()`** verweigert jeden clientseitigen Schreibzugriff auf die Spalte, sowohl beim Erstellen als auch beim Aktualisieren, unabhängig von der Rolle des Aufrufers. Die Datenbank (ein Standardwert, ein Trigger) und Servercode befüllen sie weiterhin. Die Spalte fehlt in den Typen `Insert` und `Update`.
- **`.private()`** belässt die Spalte auf dem Server: Sie fehlt in jeder Zeile über die Leitung, im SDK und in OpenAPI und wird in Filtern und Sortierungen abgewiesen. Hooks und Servercode sehen sie weiterhin. Eine private Spalte kann nicht gleichzeitig `.access()` deklarieren.
- **`.access({ read, write })`** listet die Rollen auf, die die Spalte empfangen, und die Rollen, die sie schreiben dürfen. Wird eine Liste weggelassen, bestimmt die Zeile die jeweilige Richtung; eine leere Liste sperrt den Zugriff für alle Aufrufer.

[Feldzugriff](/docs/collections/field-access/) beschreibt, was ein Aufrufer sieht, wenn eine Spalte vorenthalten wird, sowie jeden Einstiegspunkt, für den die Regel gilt.

## Storage-Spalten

`col.storage(options)` speichert den Pfad einer Datei in einem Storage-Bucket. Die Upload-Route erzwingt `accept` und `maxBytes`, und der Orphan-Bereinigungsprozess zählt die Datei als referenziert, solange eine Zeile ihren Pfad hält. `.multiple()` sorgt dafür, dass die Spalte mehrere Pfade enthält (`TEXT[]`).

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

| Option | Was sie bewirkt |
|---|---|
| `path` | **Erforderlich.** Der Speicherort der Dateien als Pfad-Template: `"posts/heroes/"`, `"users/{id}/"`. |
| `source` | Der Bucket, deklariert in `backend/resources.ts`. Sofern weggelassen, der Standard-Bucket. |
| `accept` | Akzeptierte MIME-Typen, mit Wildcards: `["image/*", "application/pdf"]`. |
| `maxBytes` | Die maximal akzeptierte Dateigröße: eine Anzahl von Bytes oder eine Größenangabe wie `"10MB"`, `"512 kb"`, `"1.5GB"`. Binäre Vielfache: 1 MB entspricht 1.048.576 Bytes. Eine unlesbare Größenangabe löst einen Fehler aus. |
| `imageResize` | Bilder vor dem Speichern skalieren: `maxWidth`, `maxHeight`, `mode` (`"contain"` oder `"cover"`), `format` (`"original"`, `"jpeg"`, `"png"`, `"webp"`), `quality`. |
| `public` | Dateien sind ohne signierte URL lesbar. |
| `fileName` | Der gespeicherte Dateiname als Template. Bei Auslassung der hochgeladene Name. |
| `metadata` | Metadaten, die mit jeder Datei gespeichert werden. |
| `includeBucketUrl` | Speichert die Bucket-URL vor dem Pfad. |
| `storeUrl` | Speichert die Download-URL anstelle des Pfads. |

Eine Storage-Spalte übernimmt die Validierungsregeln für Textspalten. Eine Datei innerhalb eines JSON-Dokuments ist `json.storage()` mit denselben Optionen; siehe [JSON-Dokumente](/docs/schema/json/). Wer welche Pfade hoch- und herunterladen darf, regelt die [Storage-Autorisierung](/docs/backend/storage-authorization/); die Bereitstellung und das Caching von Dateien wird unter [Storage](/docs/backend/storage/) behandelt.

## Was abgelehnt wird

Beim Laden des Moduls löst ein Builder einen Fehler aus bei:

- `col.varchar()` oder `col.char()` ohne Längenangabe; einer `length` oder `dimensions`, die keine positive ganze Zahl ist, und `col.numeric({ scale })` ohne `precision`;
- `col.enum([])`, `pgEnum(name, { … })` und dem `.array()` eines Arrays;
- einem `sql`-Standardwert oder einem generierten Ausdruck mit Interpolation;
- einem zweiten, abweichenden Stamp auf derselben Spalte und `.oneOf()` mit einem Wert, der weder String noch Zahl ist;
- `.access()`, dessen `read` oder `write` keine Liste von nicht-leeren Rollennamen ist;
- `col.storage()` ohne `path` oder mit einem `maxBytes`, das keine gültige Größenangabe darstellt.

Beim Kompilieren des Schemas wird die Tabelle abgelehnt bei:

- einem Standardwert zusammen mit `.generatedAlwaysAs()` oder einem Stamp zusammen damit;
- `.generatedByDefaultAsIdentity()` auf einer nicht-ganzzahligen Spalte, `.defaultRandom()` auf einer Nicht-`uuid`-Spalte, einem Zeit-Stamp auf einer nicht-temporalen Spalte, einem Benutzer-Stamp auf einer Spalte, die weder Text noch `uuid` ist;
- einem `.private()` Primärschlüssel oder einem `timestamptz`- bzw. `time`-Primärschlüssel;
- einem Primärschlüssel auf einer `jsonb`-, `json`-, Geopoint-, `vector`-, `bytea`-, Array- oder benutzerdefinierten Listenspalte: Ein Schlüssel ist ein Skalar (Text, `varchar`, `char`, `uuid`, ein Enum, eine Zahl, ein Boolean oder ein Datum). `schema introspect` überspringt eine so geschlüsselte Tabelle und gibt den Grund an;
- einem `.array()` von `jsonb`, `json`, `vector`, `bytea`, Geopoints oder `col.custom()` (siehe [Arrays](#arrays));
- einer `.validate()`-Regel, die vom Spaltentyp, seinen Elementen oder einem JSON-Knoten nicht geprüft wird (`integer` auf einer Textspalte, `trim` auf einer Zahl, `minItems` auf einem Skalar);
- einer Spalte, die sowohl `.private()` als auch `.access()` deklariert;
- einem `.transform()` auf einer Spalte und einem weiteren auf deren JSON-Shape;
- einem `col.custom({ dataType })`, dessen Typname nicht der Form eines Postgres-Typnamens entspricht;
- `.oneOf([])` sowie `.oneOf()` auf einer Spalte, die weder Text noch numerisch ist;
- einem Enum mit einem leeren oder mehrfachen Wert oder einem Standardwert, der nicht zu seinen Werten gehört;
- zwei Schlüsseln, die zum selben SQL-Spaltennamen aufgelöst werden, einschließlich des Falls, dass Postgres die Namen auf 63 Bytes kürzt;
- einem benannten Enum-Typ, dem zwei unterschiedliche Wertelisten übergeben wurden.

Jede Ablehnung nennt die Tabelle, die Spalte und was stattdessen geschrieben werden muss.

Drizzle-Schreibweisen, die hier etwas anderes bedeuten würden, kompilieren nicht, und der Compiler gibt aus, was zu schreiben ist: `col.timestamp()` ohne `withTimezone: true`, `.references()`, `.$defaultFn()`, `.$onUpdate()`, `.generatedAlwaysAsIdentity()`, `.unique("name")`, `mode: "string"` bei `numeric` sowie `col.inet()`, `col.interval()` und die anderen Typen, die Rebase ausschließlich über `col.custom({ dataType })` bereitstellt.

## Nächste Schritte

- [JSON-Dokumente](/docs/schema/json/): Die Struktur einer `jsonb`-Spalte
- [Relationen](/docs/collections/relations/): Fremdschlüssel stammen aus `rel.*`, nicht aus Spalten
- [Feldzugriff](/docs/collections/field-access/): `.access()`, `.private()` und `.readOnly()` im Detail
- [Typinferenz](/docs/schema/types/): Wie sich die einzelnen Modifikatoren auf `InferRow` und `InferInsert` auswirken
