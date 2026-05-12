---
title: Eigenschaften
sidebar_label: Eigenschaften
slug: de/docs/collections/properties
description: Eigenschaftstypen definieren den Datentyp, die Validierung und das UI-Rendering für jedes Feld in einer Sammlung. Rebase unterstützt die Typen string, number, boolean, date, array, map, reference, relation und geopoint.
---

## Überblick

Eigenschaften definieren die Spalten in Ihrer Datenbanktabelle und wie sie in der Admin-Benutzeroberfläche gerendert werden. Jede Eigenschaft hat einen `type`, der Folgendes bestimmt:

- Den **Datenbankspaltentyp** (über Drizzle-Schema-Generierung)
- Die **Formularfeld**-Komponente
- Den **Tabellenzellen**-Renderer
- Die **Validierungs**-Regeln

## Eigenschaftstypen

| Type | Beschreibung | PostgreSQL-Spalte |
|------|-------------|-------------------|
| `string` | Text, Auswahl, Markdown, Dateiupload, URL, E-Mail | `varchar`, `text`, `jsonb` |
| `number` | Ganzzahl, Dezimalzahl, Währung | `integer`, `numeric`, `bigint`, `serial` |
| `boolean` | Wahr/Falsch-Umschalter | `boolean` |
| `date` | Datum, Datum/Uhrzeit, Zeitstempel | `timestamp`, `date` |
| `array` | Geordnete Liste von Werten | `jsonb` |
| `map` | Schlüssel-Wert-Objekt | `jsonb` |
| `geopoint` | Breiten-/Längengrad-Paar | `jsonb` |
| `reference` | Eingebetteter Verweis auf eine andere Entität | `varchar` (speichert ID) |
| `relation` | SQL-Fremdschlüsselbeziehung | Verwendet das `relations`-Array |

## Allgemeine Eigenschaften

Alle Eigenschaftstypen teilen diese Optionen:

| Property | Type | Beschreibung |
|----------|------|-------------|
| `type` | `string` | **Erforderlich.** Datentyp (siehe oben) |
| `name` | `string` | **Erforderlich.** Anzeigebezeichnung |
| `description` | `string` | Hilfetext, der unterhalb des Feldes angezeigt wird |
| `columnWidth` | `number` | Spaltenbreite in Pixeln (Tabellenansicht) |
| `readOnly` | `boolean` | Bearbeitung verhindern |
| `disabled` | `boolean \| PropertyDisabledConfig` | Deaktivieren mit optionalem Tooltip |
| `hideFromCollection` | `boolean` | Aus der Tabellenansicht ausblenden |
| `defaultValue` | `any` | Standardwert für neue Entitäten |
| `validation` | `object` | Validierungsregeln |
| `Field` | `React.ComponentType` | Benutzerdefinierte Feldkomponente |
| `Preview` | `React.ComponentType` | Benutzerdefinierte Tabellenzellenkomponente |
| `propertyConfig` | `string` | Registrierter Eigenschafts-Konfigurationsschlüssel |
| `editable` | `boolean` | Inline-Bearbeitung in der Tabelle aktivieren (Standard: true) |

## String-Eigenschaften

```typescript
name: {
    type: "string",
    name: "Name",
    validation: { required: true, min: 2, max: 200 }
}

description: {
    type: "string",
    name: "Description",
    multiline: true,       // Textbereich
    markdown: true         // Markdown-Editor
}

category: {
    type: "string",
    name: "Category",
    enum: [
        { id: "electronics", label: "Electronics", color: "blueDark" },
        { id: "clothing", label: "Clothing", color: "pinkLight" },
    ]
}

email: {
    type: "string",
    name: "Email",
    email: true,           // E-Mail-Validierung
    validation: { required: true }
}

website: {
    type: "string",
    name: "Website",
    url: true              // URL-Validierung
}

avatar: {
    type: "string",
    name: "Avatar",
    storage: {             // Dateiupload
        storagePath: "avatars",
        acceptedFiles: ["image/*"],
        maxSize: 2 * 1024 * 1024
    }
}
```

### String-Optionen

| Property | Type | Beschreibung |
|----------|------|-------------|
| `multiline` | `boolean` | Als Textbereich rendern |
| `markdown` | `boolean` | Als Markdown-Editor rendern |
| `email` | `boolean` | E-Mail-Formatvalidierung |
| `url` | `boolean` | URL-Formatvalidierung |
| `storage` | `StorageConfig` | Dateiupload aktivieren |
| `enum` | `EnumValues` | Als Auswahl-Dropdown rendern |
| `multiSelect` | `boolean` | Mehrere Enum-Auswahlen zulassen |
| `columnType` | `string` | Datenbankspalte: `"varchar"`, `"text"` |
| `isId` | `string` | ID-Generierung: `"uuid"`, `"cuid"`, `"increment"`, `"manual"` |
| `userSelect` | `boolean` | Als Benutzerauswahl rendern |
| `previewAsTag` | `boolean` | Diese Zeichenkette als Tag in Vorschauen rendern |
| `clearable` | `boolean` | Ein Symbol zum Löschen des Wertes hinzufügen (auf null setzen) |

## Zahlen-Eigenschaften

```typescript
price: {
    type: "number",
    name: "Price",
    validation: { required: true, min: 0 }
}

quantity: {
    type: "number",
    name: "Quantity",
    columnType: "integer"  // Als Ganzzahl speichern
}
```

### Zahlen-Optionen

| Property | Type | Beschreibung |
|----------|------|-------------|
| `enum` | `EnumValues` | Als Auswahl mit numerischen Werten rendern |
| `columnType` | `string` | `"integer"`, `"bigint"`, `"numeric"`, `"serial"`, `"smallint"` |
| `isId` | `string` | ID-Generierungsstrategie |
| `clearable` | `boolean` | Ein Symbol zum Löschen des Wertes hinzufügen (auf null setzen) |

## Boolean-Eigenschaften

```typescript
active: {
    type: "boolean",
    name: "Active",
    defaultValue: true
}
```

![Schalterfeld](/img/fields/Switch.png)

## Datums-Eigenschaften

```typescript
created_at: {
    type: "date",
    name: "Created At",
    autoValue: "on_create",   // Automatisch bei Erstellung festlegen
    readOnly: true
}

updated_at: {
    type: "date",
    name: "Updated At",
    autoValue: "on_update"    // Automatisch bei jedem Speichern festlegen
}

event_date: {
    type: "date",
    name: "Event Date",
    mode: "date"              // Nur Datum (keine Zeit)
}
```

![Datumsfeld](/img/fields/Date.png)

### Datums-Optionen

| Property | Type | Beschreibung |
|----------|------|-------------|
| `mode` | `"date" \| "date_time"` | Nur Datum oder Datum + Uhrzeit (Standard: `"date_time"`) |
| `autoValue` | `"on_create" \| "on_update"` | Zeitstempel automatisch setzen |
| `columnType` | `string` | `"timestamp"`, `"date"` |
| `timezone` | `string` | Zeitzonen-String, um das Datum auszuwerten |
| `clearable` | `boolean` | Ein Symbol zum Löschen des Wertes hinzufügen (auf null setzen) |

## Array-Eigenschaften

```typescript
tags: {
    type: "array",
    name: "Tags",
    of: { type: "string" }    // Array von Zeichenketten
}

images: {
    type: "array",
    name: "Images",
    of: {
        type: "string",
        storage: { storagePath: "images", acceptedFiles: ["image/*"] }
    }
}

// Block-Editor (mehrere Typen)
content: {
    type: "array",
    name: "Content Blocks",
    oneOf: {
        properties: {
            text: {
                type: "map",
                properties: {
                    body: { type: "string", name: "Body", markdown: true }
                }
            },
            image: {
                type: "map",
                properties: {
                    src: { type: "string", name: "Image", storage: { ... } },
                    caption: { type: "string", name: "Caption" }
                }
            }
        }
    }
}
```

![Blockfeld](/img/fields/Block.png)

### Array-Optionen

| Property | Type | Beschreibung |
|----------|------|-------------|
| `of` | `Property \| Property[]` | Eigenschaftsschema für Array-Elemente |
| `oneOf` | `object` | Array von typisierten Objekten mit mehreren Diskriminator-Typen |
| `expanded` | `boolean` | Soll das Feld anfänglich erweitert sein (Standard: true) |
| `minimalistView` | `boolean` | Untergeordnete Eigenschaften direkt ohne erweiterbares Panel anzeigen |
| `sortable` | `boolean` | Können Elemente neu angeordnet werden (Standard: true) |
| `canAddElements` | `boolean` | Können neue Elemente hinzugefügt werden (Standard: true) |

## Map-Eigenschaften

```typescript
address: {
    type: "map",
    name: "Address",
    properties: {
        street: { type: "string", name: "Street" },
        city: { type: "string", name: "City" },
        zip: { type: "string", name: "ZIP Code" },
        country: { type: "string", name: "Country" }
    }
}

metadata: {
    type: "map",
    name: "Metadata",
    keyValue: true    // Freiform-Schlüssel-Wert-Editor
}
```

![Gruppenfeld](/img/fields/Group.png)

### Map-Optionen

| Property | Type | Beschreibung |
|----------|------|-------------|
| `properties` | `Properties` | Datensatz der in der Map enthaltenen Eigenschaften |
| `propertiesOrder` | `string[]` | Geordnete Schlüssel für das Rendern |
| `previewProperties` | `string[]` | Welche Eigenschaften in der Tabellenvorschau angezeigt werden sollen |
| `pickOnlySomeKeys` | `boolean` | Dem Benutzer ermöglichen, Schlüssel selektiv in der UI hinzuzufügen |
| `spreadChildren` | `boolean` | Untergeordnete Eigenschaften als separate Spalten in der Tabellenansicht rendern |
| `minimalistView` | `boolean` | Eigenschaften ohne umhüllendes Panel anzeigen |
| `expanded` | `boolean` | Soll das Feld anfänglich erweitert sein (Standard: true) |
| `keyValue` | `boolean` | Als Editor für beliebige Schlüssel-Wert-Paare rendern |

## Enum-Werte

Wird mit String- oder Zahlen-Eigenschaften verwendet, um Auswahlen zu rendern:

```typescript
// Einfaches Array
enum: ["draft", "published", "archived"]

// Mit Bezeichnungen
enum: [
    { id: "draft", label: "Draft" },
    { id: "published", label: "Published" },
    { id: "archived", label: "Archived" }
]

// Mit Farben (für Kanban-Spalten und Chips)
enum: [
    { id: "draft", label: "Draft", color: "grayDark" },
    { id: "published", label: "Published", color: "greenDark" },
    { id: "archived", label: "Archived", color: "orangeDark" }
]
```

![Auswahlfeld](/img/fields/Select.png)

## Validierung

```typescript
validation: {
    required: true,             // Feld ist erforderlich
    unique: true,               // Muss in der Tabelle eindeutig sein
    requiredMessage: "Custom error message",

    // Zeichenketten-spezifisch
    min: 2,                     // Minimale Länge
    max: 200,                   // Maximale Länge
    matches: /^[a-z]+$/,       // Regex-Muster
    email: true,                // E-Mail-Format
    url: true,                  // URL-Format

    // Zahlen-spezifisch
    min: 0,                     // Minimaler Wert
    max: 1000,                  // Maximaler Wert
    integer: true,              // Muss eine Ganzzahl sein

    // Array-spezifisch
    min: 1,                     // Minimale Anzahl von Elementen
    max: 10,                    // Maximale Anzahl von Elementen
}
```

## Bedingte Felder

Sie können Felder dynamisch gestalten, sodass sie auf die Werte der Entität reagieren. Dafür gibt es zwei Möglichkeiten:

### 1. JSON Logic Bedingungen (Deklarativ)

Sie können die Eigenschaft `conditions` verwenden, um deklarative JSON Logic-Regeln zu definieren, die im Sammlungseditor serialisiert und visuell geändert werden können.

```typescript
price: {
    type: "number",
    name: "Price",
    conditions: {
        disabled: { "==": [{ "var": "values.is_free" }, true] },
        required: { "!=": [{ "var": "values.is_free" }, true] },
        min: 0,
        clearOnDisabled: true // Auf null setzen, wenn das Feld deaktiviert wird
    }
}
```

Das conditions-Objekt bietet Ihnen Zugriff auf:
- `disabled`, `hidden`, `readOnly`
- `required`, `min`, `max`
- `defaultValue`
- `enumConditions`, `allowedEnumValues`, `excludedEnumValues`
- `referencePath`, `referenceFilter`
- `canAddElements`, `sortable` (für Arrays)

### 2. Property Builders (Programmatisch)

Für komplexes Verhalten, das nicht über JSON Logic ausgedrückt werden kann, können Sie `dynamicProps` verwenden, das eine Javascript-Funktion auswertet.

```typescript
price: {
    type: "number",
    name: "Price",
    dynamicProps: ({ values, user }) => ({
        disabled: values.is_free === true || !user.roles.includes("admin"),
        validation: values.is_free ? {} : { required: true, min: 0 }
    })
}
```

## Nächste Schritte

- **[Beziehungen](/docs/collections/relations)** — Fremdschlüssel und Joins
- **[Sicherheitsregeln](/docs/collections/security-rules)** — Zeilenebenen-Sicherheit
- **[Benutzerdefinierte Felder](/docs/frontend/custom-fields)** — Benutzerdefinierte Feldkomponenten erstellen
---
