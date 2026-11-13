---
sourceHash: 23be8a1faf1d5f49
title: Documenti JSON
sidebar_label: Documenti JSON
description: "Tipizza una colonna jsonb con col.jsonb().$type<T>(), oppure assegnale una forma con json.* in modo che il server convalidi i campi annidati, applichi valori predefiniti e stamp, individui i file referenziati da un documento e cerchi al suo interno."
---

<span class="since-badge" data-since="0.31">Since 0.31</span>

Una colonna `jsonb` può essere dichiarata in due modi. `col.jsonb().$type<T>()` tipizza il documento
solo per TypeScript e non fornisce alcuna informazione al server. `col.jsonb(shape)` accetta una
struttura definita con `json.*`, che tipizza il documento nello stesso modo e contemporaneamente
lo descrive al server.

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

Con una forma definita, il server:

- **convalida** ogni campo prima di una scrittura, con le stesse regole accettate da una colonna;
- **applica i valori predefiniti** ai campi assenti al momento della creazione;
- **applica timestamp/stamp** ai campi data con `.onCreateNow()` / `.onUpdateNow()`, e ai campi utente con `.onCreateUser()` / `.onUpdateUser()`, a qualsiasi livello di annidamento;
- **esegue** gli hook `.transform()` di ciascun campo;
- **trova i file** referenziati da un documento (`json.storage()`), in modo che la pulizia degli orfani
  li conteggi;
- **può effettuare ricerche** all'interno del documento: un campo `search` può indicare un percorso come
  `"seo.title"` (vedi [Search](/docs/backend/search/)).

La forma viene fornita insieme al descrittore della tabella, così il CMS può generare automaticamente un form per
il documento senza istruzioni aggiuntive. `col.jsonb().$type<T>()` riceve invece
un editor JSON generico.

## Costruttori

<span class="since-badge" data-since="0.31">Since 0.31</span>

| Costruttore | Contiene | Tipo TypeScript |
|---|---|---|
| `json.string()` | una stringa | `string` |
| `json.number()` | un numero | `number` |
| `json.boolean()` | un booleano | `boolean` |
| `json.date()` | un istante temporale, come stringa ISO | `string` |
| `json.geopoint()` | un punto geografico sulla Terra | `{ latitude: number; longitude: number }` |
| `json.storage(options)` | il percorso di un file archiviato | `string` |
| `json.object(fields, { additional? })` | un oggetto con chiavi note | un tipo oggetto: i campi obbligatori sono required, gli altri opzionali |
| `json.array(of)` | un array di una singola forma | un array del tipo specificato in `of` |
| `json.oneOf(variants, { typeField?, valueField? })` | un blocco tipizzato | un'unione di `{ type: "<variant>"; value: <il suo tipo> }` |
| `json.unknown()` | qualsiasi valore | `unknown` |

`json.storage()` accetta le stesse opzioni di [`col.storage()`](/docs/schema/columns/#storage-columns).
`json.object(fields, { additional: true })` accetta anche chiavi non esplicitamente definite.

## Modificatori

<span class="since-badge" data-since="0.31">Since 0.31</span>

| Modificatore | Applicabile a | Cosa fa |
|---|---|---|
| `.required()` | ogni campo | La chiave deve essere presente nel documento. Rende la chiave non opzionale nel tipo. |
| `.default(value)` | ogni campo | Il valore scritto quando la chiave è assente in fase di creazione. |
| `.describe(text)` | ogni campo | Descrizione del valore, per OpenAPI ed MCP. |
| `.validate(rules)` | ogni campo | Le regole accettate da una colonna dello stesso tipo: regole per stringhe su `json.string()`, numeriche su `json.number()`, limiti di data su `json.date()`, numero di elementi, `uniqueItems` e `uniqueBy` su `json.array()`. Vedi [Validation](/docs/schema/columns/#validation). |
| `.transform({ beforeSave?, afterRead? })` | ogni campo | Hook a livello di campo, eseguiti sul server. `value` è `T \| undefined` a meno che non sia preceduto da `.required()`. |
| `.oneOf(values)` | `json.string()`, `json.number()` | Un insieme chiuso di valori accettati, tipizzato come loro unione. |
| `.onCreateNow()` | `json.date()` | Il server scrive l'orario corrente quando la riga viene creata. |
| `.onUpdateNow()` | `json.date()` | Il server scrive l'orario corrente a ogni operazione di scrittura. |
| `.onCreateUser()` | `json.string()` | Il server scrive l'ID dell'utente attivo alla creazione della riga, o `null` se nessun utente è attivo. |
| `.onUpdateUser()` | `json.string()` | Il server scrive l'ID dell'utente attivo a ogni operazione di scrittura. |
| `.userId()` | `json.string()` | Il valore è l'ID di un utente: il pannello offre un selettore utente e un chiamante autorizzato a scrivere sulla tabella può cercare gli utenti per compilarlo. Vedi [User columns](/docs/schema/columns/#user-columns). |

I campi sono opzionali a meno che non sia specificato `.required()`. Una chiave obbligatoria è obbligatoria anche nel
tipo TypeScript:

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

### Stamp all'interno di un documento

Gli stamp funzionano a qualsiasi livello di annidamento di una colonna JSON: campi di oggetti, singoli elementi di array e
il valore di un elemento `oneOf` il cui `type` corrisponde alla variante. Durante la creazione, gli oggetti
mancanti lungo il percorso verso uno stamp vengono creati automaticamente. Durante un aggiornamento, vengono applicati
solo gli stamp dei campi `onUpdate*`, ed esclusivamente all'interno dei documenti inviati dall'aggiornamento; un
documento non inviato mantiene il valore memorizzato. Uno stamp sovrascrive qualsiasi valore inviato
dalla scrittura, e il `.default()` di un campo lo popola preventivamente.

## Array e blocchi tipizzati

<span class="since-badge" data-since="0.31">Since 0.31</span>

`json.array(of)` è una lista di un'unica forma. `json.oneOf(variants)` è un blocco la cui
chiave `type` indica quale variante rappresenta e la cui chiave `value` contiene il
contenuto di tale variante. Come elementi di un array, rappresenta la forma tipica di un editor a blocchi:

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

Il campo `body` di una riga viene quindi tipizzato come un array di:

```ts
type Block =
    | { type: "paragraph"; value: string }
    | { type: "image"; value: string }
    | { type: "quote"; value: { text: string; author?: string } };
```

`json.array(json.object({...})).validate({ uniqueBy: ["sku"] })` rifiuta due
elementi che condividono lo stesso valore in un campo specificato (`unique_by`; i valori assenti e
`null` non vengono confrontati, e un'operazione di `$push` verifica gli elementi inseriti tra
loro). `validate({ uniqueItems: true })` rifiuta due elementi identici.
La radice di un documento può essere essa stessa uno scalare o un `json.oneOf`, e
`json.unknown()` rappresenta un campo con qualsiasi valore JSON valido; il server convalida ogni forma durante
le scritture via REST, MCP e socket.

`typeField` e `valueField` consentono di rinominare le due chiavi, per documenti che usano
già nomi differenti: `json.oneOf({ … }, { typeField: "kind", valueField: "data" })`.

## `jsonb` o `json`

<span class="since-badge" data-since="0.31">Since 0.31</span>

`col.json()` accetta gli stessi argomenti di `col.jsonb()`. Memorizza il testo esattamente come
è stato fornito, inclusi l'ordine delle chiavi e gli spazi bianchi, e non può essere indicizzato o cercato
nel modo in cui lo permette `jsonb`. Usalo solo quando il testo esatto è rilevante;
in caso contrario, usa `col.jsonb()`.

Un punto sulla Terra ha un costruttore di colonna dedicato, `col.geopoint()`, archiviato come `jsonb`.
Un elenco di valori semplici che Postgres deve indicizzare è spesso preferibile definirlo come colonna array:
`col.text().array()`. Le liste annidate appartengono a `jsonb`: `.array()` di
un array non è consentito.

## Passaggi successivi

<span class="since-badge" data-since="0.31">Since 0.31</span>

- [Columns](/docs/schema/columns/): i costruttori di colonne e le relative regole di convalida
- [Search](/docs/backend/search/): ricerca nei percorsi all'interno di un documento
- [Table hooks](/docs/collections/callbacks/): `.transform()` e gli hook a livello di tabella
