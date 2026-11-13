---
sourceHash: 23be8a1faf1d5f49
title: JSON-Dokumente
sidebar_label: JSON-Dokumente
description: "Typisieren Sie eine jsonb-Spalte mit col.jsonb().$type<T>() oder geben Sie ihr eine Struktur mit json.*, damit der Server verschachtelte Felder validiert, Standardwerte und Zeitstempel anwendet, referenzierte Dateien findet und das Dokument durchsucht."
---

<span class="since-badge" data-since="0.31">Seit 0.31</span>

Eine `jsonb`-Spalte kann auf zwei Arten deklariert werden. `col.jsonb().$type<T>()` typisiert das
Dokument für TypeScript und teilt dem Server nichts darüber mit. `col.jsonb(shape)` nimmt eine
mit `json.*` erstellte Struktur entgegen, die das Dokument auf dieselbe Weise typisiert und es
zudem für den Server beschreibt.

```ts
import { defineTable, col, json } from "@rebasepro/server/schema";

export const pages = defineTable("pages", {
    columns: {
        id: col.uuid().primaryKey().defaultRandom(),

        // Typed for TypeScript only.
        settings: col.jsonb().$type<{ theme?: "light" | "dark"; pinned?: boolean }>(),

        // Typed, and known to the server.
        seo: col.jsonb(json.object({
            title:        json.string().validate({ max: 60 }).required(),
            canonicalUrl: json.string().validate({ url: true }),
            noIndex:      json.boolean().default(false),
        })),
    },
    rls: "admin-only",
});
```

Mit einer Struktur führt der Server Folgendes aus:

- **validiert** jedes Feld vor einem Schreibvorgang mit denselben Regeln, die auch für Spalten gelten;
- **wendet Standardwerte an** auf Felder, die beim Erstellen fehlen;
- **versieht Felder mit Zeitstempeln**: Datumsfelder mit `.onCreateNow()` / `.onUpdateNow()` und Benutzerfelder mit `.onCreateUser()` / `.onUpdateUser()`, in beliebiger Schachtelungstiefe;
- **führt die `.transform()`-Hooks** jedes Feldes aus;
- **findet die referenzierten Dateien** eines Dokuments (`json.storage()`), damit der Orphan-Sweep
  sie berücksichtigen kann;
- **kann innerhalb des Dokuments suchen**: Ein `search`-Feld kann einen Pfad wie
  `"seo.title"` angeben (siehe [Suche](/docs/backend/search/)).

Die Struktur wird mit dem Deskriptor der Tabelle bereitgestellt, sodass das CMS ein Formular für
das Dokument erstellen kann, ohne dass man ihm mitteilen muss, wie. `col.jsonb().$type<T>()` erhält
stattdessen einen generischen JSON-Editor.

## Builder

<span class="since-badge" data-since="0.31">Seit 0.31</span>

| Builder | Inhalt | TypeScript-Typ |
|---|---|---|
| `json.string()` | ein String | `string` |
| `json.number()` | eine Zahl | `number` |
| `json.boolean()` | ein Boolean | `boolean` |
| `json.date()` | ein Zeitpunkt als ISO-String | `string` |
| `json.geopoint()` | ein Punkt auf der Erde | `{ latitude: number; longitude: number }` |
| `json.storage(options)` | der Pfad einer gespeicherten Datei | `string` |
| `json.object(fields, { additional? })` | ein Objekt mit bekannten Schlüsseln | ein Objekttyp: erforderliche Felder erforderlich, der Rest optional |
| `json.array(of)` | ein Array einer Struktur | ein Array des Typs von `of` |
| `json.oneOf(variants, { typeField?, valueField? })` | ein typisierter Block | eine Union von `{ type: "<variant>"; value: <its type> }` |
| `json.unknown()` | beliebiger Inhalt | `unknown` |

`json.storage()` akzeptiert dieselben Optionen wie [`col.storage()`](/docs/schema/columns/#storage-columns).
`json.object(fields, { additional: true })` akzeptiert auch Schlüssel, die nicht explizit genannt werden.

## Modifikatoren

<span class="since-badge" data-since="0.31">Seit 0.31</span>

| Modifikator | Für | Funktion |
|---|---|---|
| `.required()` | jedes Feld | Der Schlüssel muss im Dokument vorhanden sein. Macht den Schlüssel im Typ nicht-optional. |
| `.default(value)` | jedes Feld | Der Wert, der geschrieben wird, wenn der Schlüssel beim Erstellen fehlt. |
| `.describe(text)` | jedes Feld | Beschreibung des Werts für OpenAPI und MCP. |
| `.validate(rules)` | jedes Feld | Die Regeln, die eine Spalte derselben Art akzeptiert: Textregeln für `json.string()`, numerische Regeln für `json.number()`, Datumsgrenzen für `json.date()`, Elementanzahl, `uniqueItems` und `uniqueBy` für `json.array()`. Siehe [Validierung](/docs/schema/columns/#validation). |
| `.transform({ beforeSave?, afterRead? })` | jedes Feld | Feldbezogene Hooks, die auf dem Server ausgeführt werden. `value` ist `T \| undefined`, es sei denn, `.required()` steht an erster Stelle. |
| `.oneOf(values)` | `json.string()`, `json.number()` | Eine geschlossene Menge akzeptierter Werte, typisiert als deren Union. |
| `.onCreateNow()` | `json.date()` | Der Server schreibt die aktuelle Uhrzeit, wenn die Zeile erstellt wird. |
| `.onUpdateNow()` | `json.date()` | Der Server schreibt die aktuelle Uhrzeit bei jedem Schreibvorgang. |
| `.onCreateUser()` | `json.string()` | Der Server schreibt die ID des agierenden Benutzers beim Erstellen der Zeile, oder `null`, wenn kein Benutzer agiert. |
| `.onUpdateUser()` | `json.string()` | Der Server schreibt die ID des agierenden Benutzers bei jedem Schreibvorgang. |
| `.userId()` | `json.string()` | Der Wert ist die ID eines Benutzers: Das Panel bietet eine Benutzerauswahl, und Aufrufer mit Schreibrechten für die Tabelle können Benutzer nachschlagen, um das Feld zu befüllen. Siehe [Benutzerspalten](/docs/schema/columns/#user-columns). |

Felder sind standardmäßig optional, sofern sie nicht mit `.required()` markiert sind. Ein erforderlicher Schlüssel ist
auch im TypeScript-Typ erforderlich:

```ts
import { col, json } from "@rebasepro/server/schema";

const address = json.object({
    street:  json.string().required(),
    city:    json.string().required(),
    country: json.string().validate({ length: 2, uppercase: true }).required(),
    notes:   json.string(),
});

// { street: string; city: string; country: string; notes?: string }
const shipping = col.jsonb(address);
```

### Stempel innerhalb eines Dokuments

Stempel funktionieren in jeder Tiefe einer JSON-Spalte: Objektfelder, jedes Array-Element und
der Wert eines `oneOf`-Elements, dessen `type` die Variante benennt. Beim Erstellen werden
fehlende Objekte auf dem Weg zu einem Stempel automatisch angelegt. Bei einer Aktualisierung werden
nur die `onUpdate*`-Felder gestempelt, und zwar nur innerhalb eines Dokuments, das das Update
sendet; ein Dokument, das nicht gesendet wird, behält seinen gespeicherten Wert. Ein Stempel
ersetzt jeden übermittelten Wert, und das `.default()` eines Feldes befüllt es zuerst.

## Arrays und typisierte Blöcke

<span class="since-badge" data-since="0.31">Seit 0.31</span>

`json.array(of)` ist eine Liste einer bestimmten Struktur. `json.oneOf(variants)` ist ein Block,
dessen `type`-Schlüssel angibt, um welche Variante es sich handelt, und dessen `value`-Schlüssel den
Inhalt dieser Variante enthält. Als Elemente eines Arrays ergibt sich die Struktur eines Block-Editors:

```ts
import { defineTable, col, json } from "@rebasepro/server/schema";

export const articles = defineTable("articles", {
    columns: {
        id: col.uuid().primaryKey().defaultRandom(),
        body: col.jsonb(json.array(json.oneOf({
            paragraph: json.string(),
            image:     json.storage({ path: "articles/images/", accept: ["image/*"] }),
            quote:     json.object({ text: json.string().required(), author: json.string() }),
        }))),
    },
    rls: "admin-only",
});
```

Das `body`-Feld einer Zeile wird dann als ein Array typisiert aus:

```ts
type Block =
    | { type: "paragraph"; value: string }
    | { type: "image"; value: string }
    | { type: "quote"; value: { text: string; author?: string } };
```

`json.array(json.object({...})).validate({ uniqueBy: ["sku"] })` verweigert zwei
Elemente, die denselben Wert in einem angegebenen Feld teilen (`unique_by`; fehlende und `null`-Werte
werden nicht verglichen, und ein `$push` prüft die hinzugefügten Elemente untereinander).
`validate({ uniqueItems: true })` weist zwei identische Elemente ab.
Die oberste Ebene eines Dokuments kann selbst ein Skalar oder ein `json.oneOf` sein, und
`json.unknown()` ist ein Feld für beliebige JSON-Werte; der Server überprüft jede Struktur bei
REST-, MCP- und Socket-Schreibvorgängen.

`typeField` und `valueField` benennen die beiden Schlüssel um, falls Dokumente bereits
andere Namen verwenden: `json.oneOf({ … }, { typeField: "kind", valueField: "data" })`.

## `jsonb` oder `json`

<span class="since-badge" data-since="0.31">Seit 0.31</span>

`col.json()` akzeptiert dieselben Argumente wie `col.jsonb()`. Es speichert den Text genau so,
wie er übergeben wurde, einschließlich Schlüsselreihenfolge und Leerzeichen, und kann nicht auf die
gleiche Weise wie `jsonb` indiziert oder durchsucht werden. Verwenden Sie es nur, wenn der exakte Text
eine Rolle spielt; verwenden Sie ansonsten `col.jsonb()`.

Ein Punkt auf der Erde verfügt über einen eigenen Spalten-Builder, `col.geopoint()`, der als `jsonb`
gespeichert wird. Eine Liste einfacher Werte, die von Postgres indiziert werden soll, ist oft als
Array-Spalte besser geeignet: `col.text().array()`. Verschachtelte Listen gehören in `jsonb`:
`.array()` eines Arrays wird abgewiesen.

## Nächste Schritte

<span class="since-badge" data-since="0.31">Seit 0.31</span>

- [Spalten](/docs/schema/columns/): Die Spalten-Builder und ihre Validierungsregeln
- [Suche](/docs/backend/search/): Durchsuchen von Pfaden innerhalb eines Dokuments
- [Tabellen-Hooks](/docs/collections/callbacks/): `.transform()` und Hooks auf Tabellenebene
