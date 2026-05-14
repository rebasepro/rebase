---
title: Proprietà
sidebar_label: Proprietà
description: I tipi di proprietà definiscono il tipo di dato, la validazione e il rendering dell'interfaccia utente per ogni campo in una collection. Rebase supporta i tipi stringa, numero, booleano, data, array, mappa, riferimento, relazione e geopoint.
---

## Panoramica

Le proprietà definiscono le colonne nella tabella del database e come vengono renderizzate nell'interfaccia utente di amministrazione. Ogni proprietà ha un `type` che determina:

- Il **tipo di colonna del database** (tramite la generazione dello schema Drizzle)
- Il componente **campo del modulo**
- Il renderer della **cella di tabella**
- Le regole di **validazione**

## Tipi di Proprietà

| Type | Descrizione | Colonna PostgreSQL |
|------|-------------|-------------------|
| `string` | Testo, selezione, markdown, caricamento file, URL, email | `varchar`, `text`, `jsonb` |
| `number` | Intero, decimale, valuta | `integer`, `numeric`, `bigint`, `serial` |
| `boolean` | Interruttore vero/falso | `boolean` |
| `date` | Data, data e ora, timestamp | `timestamp`, `date` |
| `array` | Elenco ordinato di valori | `jsonb` |
| `map` | Oggetto chiave-valore | `jsonb` |
| `geopoint` | Coppia latitudine/longitudine | `jsonb` |
| `reference` | Riferimento incorporato a un'altra entità | `varchar` (memorizza ID) |
| `relation` | Relazione di chiave esterna SQL | Usa l'array `relations` |

## Proprietà Comuni

Tutti i tipi di proprietà condividono queste opzioni:

| Proprietà | Tipo | Descrizione |
|----------|------|-------------|
| `type` | `string` | **Obbligatorio.** Tipo di dato (vedi sopra) |
| `name` | `string` | **Obbligatorio.** Etichetta di visualizzazione |
| `description` | `string` | Testo di aiuto mostrato sotto il campo |
| `columnWidth` | `number` | Larghezza della colonna in pixel (vista tabella) |
| `readOnly` | `boolean` | Impedisce la modifica |
| `disabled` | `boolean \| PropertyDisabledConfig` | Disabilita con tooltip opzionale |
| `hideFromCollection` | `boolean` | Nasconde dalla vista tabella |
| `defaultValue` | `any` | Valore predefinito per nuove entità |
| `validation` | `object` | Regole di validazione |
| `Field` | `React.ComponentType` | Componente campo personalizzato |
| `Preview` | `React.ComponentType` | Componente cella di tabella personalizzato |
| `propertyConfig` | `string` | Chiave di configurazione della proprietà registrata |
| `editable` | `boolean` | Abilita la modifica inline nella tabella (predefinito: true) |

## Proprietà Stringa

```typescript
name: {
    type: "string",
    name: "Name",
    validation: { required: true, min: 2, max: 200 }
}

description: {
    type: "string",
    name: "Description",
    multiline: true,       // Textarea
    markdown: true         // Markdown editor
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
    email: true,           // Email validation
    validation: { required: true }
}

website: {
    type: "string",
    name: "Website",
    url: true              // URL validation
}

avatar: {
    type: "string",
    name: "Avatar",
    storage: {             // File upload
        storagePath: "avatars",
        acceptedFiles: ["image/*"],
        maxSize: 2 * 1024 * 1024
    }
}
```

### Opzioni Stringa

| Proprietà | Tipo | Descrizione |
|----------|------|-------------|
| `multiline` | `boolean` | Renderizza come textarea |
| `markdown` | `boolean` | Renderizza come editor markdown |
| `email` | `boolean` | Validazione formato email |
| `url` | `boolean` | Validazione formato URL |
| `storage` | `StorageConfig` | Abilita il caricamento di file |
| `enum` | `EnumValues` | Renderizza come menu a discesa di selezione |
| `multiSelect` | `boolean` | Consente selezioni multiple di enum |
| `columnType` | `string` | Colonna del database: `"varchar"`, `"text"` |
| `isId` | `string` | Generazione ID: `"uuid"`, `"cuid"`, `"increment"`, `"manual"` |
| `userSelect` | `boolean` | Renderizza come selettore utente |
| `previewAsTag` | `boolean` | Renderizza questa stringa come un tag nelle anteprime |
| `clearable` | `boolean` | Aggiunge un'icona per cancellare il valore (imposta su null) |

## Proprietà Numero

```typescript
price: {
    type: "number",
    name: "Price",
    validation: { required: true, min: 0 }
}

quantity: {
    type: "number",
    name: "Quantity",
    columnType: "integer"  // Store as integer
}
```

### Opzioni Numero

| Proprietà | Tipo | Descrizione |
|----------|------|-------------|
| `enum` | `EnumValues` | Renderizza come selezione con valori numerici |
| `columnType` | `string` | `"integer"`, `"bigint"`, `"numeric"`, `"serial"`, `"smallint"` |
| `isId` | `string` | Strategia di generazione ID |
| `clearable` | `boolean` | Aggiunge un'icona per cancellare il valore (imposta su null) |

## Proprietà Booleane

```typescript
active: {
    type: "boolean",
    name: "Active",
    defaultValue: true
}
```

![Switch field](/img/fields/Switch.png)

## Proprietà Data

```typescript
created_at: {
    type: "date",
    name: "Created At",
    autoValue: "on_create",   // Set automatically on creation
    readOnly: true
}

updated_at: {
    type: "date",
    name: "Updated At",
    autoValue: "on_update"    // Set automatically on every save
}

event_date: {
    type: "date",
    name: "Event Date",
    mode: "date"              // Date only (no time)
}
```

![Date field](/img/fields/Date.png)

### Opzioni Data

| Proprietà | Tipo | Descrizione |
|----------|------|-------------|
| `mode` | `"date" \| "date_time"` | Solo data o data + ora (predefinito: `"date_time"`) |
| `autoValue` | `"on_create" \| "on_update"` | Imposta automaticamente i timestamp |
| `columnType` | `string` | `"timestamp"`, `"date"` |
| `timezone` | `string` | Stringa del fuso orario per valutare la data |
| `clearable` | `boolean` | Aggiunge un'icona per cancellare il valore (imposta su null) |

## Proprietà Array

```typescript
tags: {
    type: "array",
    name: "Tags",
    of: { type: "string" }    // Array of strings
}

images: {
    type: "array",
    name: "Images",
    of: {
        type: "string",
        storage: { storagePath: "images", acceptedFiles: ["image/*"] }
    }
}

// Block editor (multiple types)
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

![Block field](/img/fields/Block.png)

### Opzioni Array

| Proprietà | Tipo | Descrizione |
|----------|------|-------------|
| `of` | `Property \| Property[]` | Schema di proprietà per gli elementi dell'array |
| `oneOf` | `object` | Array di oggetti tipizzati con più tipi discriminatori |
| `expanded` | `boolean` | Il campo dovrebbe essere inizialmente espanso (predefinito: true) |
| `minimalistView` | `boolean` | Visualizza le proprietà figlie direttamente senza pannello estendibile |
| `sortable` | `boolean` | Gli elementi possono essere riordinati (predefinito: true) |
| `canAddElements` | `boolean` | Possono essere aggiunti nuovi elementi (predefinito: true) |

## Proprietà Mappa

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
    keyValue: true    // Free-form key-value editor
}
```

![Group field](/img/fields/Group.png)

### Opzioni Mappa

| Proprietà | Tipo | Descrizione |
|----------|------|-------------|
| `properties` | `Properties` | Record delle proprietà incluse nella mappa |
| `propertiesOrder` | `string[]` | Chiavi ordinate per il rendering |
| `previewProperties` | `string[]` | Quali proprietà mostrare nell'anteprima della tabella |
| `pickOnlySomeKeys` | `boolean` | Permette all'utente di aggiungere chiavi selettivamente nell'interfaccia utente |
| `spreadChildren` | `boolean` | Renderizza le proprietà figlie come colonne separate nella vista tabella |
| `minimalistView` | `boolean` | Visualizza le proprietà senza un pannello di contenimento |
| `expanded` | `boolean` | Il campo dovrebbe essere inizialmente espanso (predefinito: true) |
| `keyValue` | `boolean` | Renderizza come editor di coppie chiave-valore arbitrario |

## Valori Enum

Usato con proprietà stringa o numero per renderizzare i selettori:

```typescript
// Simple array
enum: ["draft", "published", "archived"]

// With labels
enum: [
    { id: "draft", label: "Draft" },
    { id: "published", label: "Published" },
    { id: "archived", label: "Archived" }
]

// With colors (for Kanban columns and chips)
enum: [
    { id: "draft", label: "Draft", color: "grayDark" },
    { id: "published", label: "Published", color: "greenDark" },
    { id: "archived", label: "Archived", color: "orangeDark" }
]
```

![Select field](/img/fields/Select.png)

## Validazione

```typescript
validation: {
    required: true,             // Campo obbligatorio
    unique: true,               // Deve essere unico nella tabella
    requiredMessage: "Custom error message",

    // Specifico per stringhe
    min: 2,                     // Lunghezza minima
    max: 200,                   // Lunghezza massima
    matches: /^[a-z]+$/,       // Pattern Regex
    email: true,                // Formato email
    url: true,                  // Formato URL

    // Specifico per numeri
    min: 0,                     // Valore minimo
    max: 1000,                  // Valore massimo
    integer: true,              // Deve essere un intero

    // Specifico per array
    min: 1,                     // Numero minimo di elementi
    max: 10,                    // Numero massimo di elementi
}
```

## Campi Condizionali

È possibile rendere i campi dinamici in modo che reagiscano ai valori dell'entità. Ci sono due modi per farlo:

### 1. Condizioni JSON Logic (Dichiarative)

È possibile utilizzare la proprietà `conditions` per definire regole JSON Logic dichiarative che possono essere serializzate e modificate visivamente nell'editor di collection.

```typescript
price: {
    type: "number",
    name: "Price",
    conditions: {
        disabled: { "==": [{ "var": "values.is_free" }, true] },
        required: { "!=": [{ "var": "values.is_free" }, true] },
        min: 0,
        clearOnDisabled: true // Imposta su null se il campo viene disabilitato
    }
}
```

L'oggetto conditions ti dà accesso a:
- `disabled`, `hidden`, `readOnly`
- `required`, `min`, `max`
- `defaultValue`
- `enumConditions`, `allowedEnumValues`, `excludedEnumValues`
- `referencePath`, `referenceFilter`
- `canAddElements`, `sortable` (per array)

### 2. Costruttori di Proprietà (Programmatici)

Per comportamenti complessi che non possono essere espressi tramite JSON Logic, è possibile utilizzare `dynamicProps` che valuta una funzione Javascript.

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

## Prossimi Passi

- **[Relazioni](/docs/collections/relations)** — Chiavi esterne e join
- **[Regole di Sicurezza](/docs/collections/security-rules)** — Sicurezza a Livello di Riga
- **[Campi Personalizzati](/docs/frontend/custom-fields)** — Costruisci componenti di campi personalizzati
---
