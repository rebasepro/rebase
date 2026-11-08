---
sourceHash: 92f11ec9a842b6d9
title: Collezioni
sidebar_label: Collezioni
description: Le collezioni sono l'elemento fondamentale di Rebase — ogni collezione mappa su una tabella di database e definisce il suo schema, le relazioni, la sicurezza e il comportamento dell'interfaccia utente.
---

## Cos'è una Collezione?

Una **collezione** è un oggetto TypeScript che descrive una tabella di database e come dovrebbe apparire in Rebase CMS. Definisce:

- **Schema** — Proprietà (colonne), i loro tipi e regole di validazione
- **Relazioni** — Chiavi esterne, tabelle di giunzione (junction tables) e percorsi di join
- **Sicurezza** — Criteri di Row Level Security (RLS)
- **Hook del ciclo di vita** — Callback per le operazioni di creazione, aggiornamento, eliminazione
- **Comportamento del CMS** — Modalità di visualizzazione, modifica inline, viste delle entità, azioni — tutto all'interno di `admin`

## Dichiararne una: `defineCollection`

Racchiudi il letterale in `defineCollection`. A runtime è una funzione identità — restituisce
l'oggetto invariato — quindi non ha alcun costo in termini di prestazioni. Il suo vantaggio è l'inferenza: un
parametro di tipo `const` cattura le chiavi delle tue `properties` come tipi letterali, e i campi
a forma di chiave del blocco `admin` vengono quindi controllati rispetto a esse. Un nome che non corrisponde
a una delle tue proprietà genera un **errore di compilazione**, non semplicemente un suggerimento mancante.

```typescript
import { defineCollection } from "@rebasepro/cms-types";

const products = defineCollection({
    name: "Products",
    slug: "products",
    table: "products",
    properties: {
        name: { name: "Name", type: "string" },
        price: { name: "Price", type: "number" }
    },
    admin: {
        display: { title: "name" },  // completion: "name" | "price"
        sort: ["price", "asc"],      // completion on the first element
        propertiesOrder: ["name", "price"]
    }
});
```

```typescript
    admin: {
        display: { title: "nmae" }
        //                ~~~~~~ Type '"nmae"' is not assignable to type
        //                       'PropertyPath<…>'. Did you mean '"name"'?
    }
```

I campi controllati sono `display`, `sort`, `propertiesOrder`, `listProperties`,
`previewProperties`, `orderProperty` e i filtri `defaultFilter`, `fixedFilter`
e `filterPresets`. Oltre a una semplice chiave di proprietà, sono accettate tre forme:

| Forma | Esempio | Note |
| --- | --- | --- |
| Percorso puntato in una `map` | `"profile.displayName"` | La **radice** deve essere una proprietà reale; il percorso sottostante non viene controllato. Non consentito su `previewProperties` / `orderProperty`, che accettano una chiave di primo livello. |
| Colonna di una child-collection | `"subcollection:orders"` | Solo per `propertiesOrder` / `listProperties`. |
| Una chiave di `additionalFields` | `"score" as AdditionalFieldKey` | Solo per `propertiesOrder` / `listProperties`. Richiede il cast — vedi sotto. |

`AdditionalFieldDelegate.key` è una semplice `string`, quindi il sistema di tipi non ha modo di sapere
quali chiavi aggiuntive dichiara una collezione. Invece di riaprire questi campi a qualsiasi stringa,
il cast rende l'eccezione esplicita:

```typescript
import type { AdditionalFieldKey } from "@rebasepro/cms-types";

propertiesOrder: ["title", "score" as AdditionalFieldKey]
```

Importalo da `@rebasepro/cms-types` in un progetto che dispone di un pannello di amministrazione: quella è
la copia che esegue anche il typechecking del blocco `admin`. Un progetto BaaS headless, che non dispone di un
blocco admin, importa invece la stessa funzione da `@rebasepro/common`.

L'annotazione diretta del tipo continua a funzionare e viene comunque verificata:

```typescript
import type { PostgresCollectionConfig } from "@rebasepro/types";

const products: PostgresCollectionConfig = {
    name: "Products",
    slug: "products",
    table: "products",
    properties: {
        name: { name: "Name", type: "string" }
    }
};
```

tuttavia un'annotazione si limita a *validare la struttura* — non può vedere i nomi delle tue proprietà, quindi
i campi chiave di `admin` tornano ad accettare qualsiasi stringa. È preferibile usare `defineCollection` a meno che tu
non abbia bisogno di nominare esplicitamente il tipo.

:::note
`buildCollection` e `buildProperty` non esistono più. `buildCollection` è
`defineCollection` senza inferenza; `buildProperty` racchiudeva una proprietà in un tipo che
già possedeva. Consulta il [changelog](/docs/changelog) per la migrazione su una sola riga.
:::

## Anatomia: il contratto e il pannello

Un file, due destinatari. Tutto ciò che interessa al *database e all'API* si trova al
livello principale; tutto ciò che il *pannello di amministrazione* renderizza si trova all'interno di `admin`.

```typescript
const posts = {
    // ── The backend reads these ──────────────────────────────
    slug: "posts",
    table: "posts",
    properties: { /* … */ },
    relations: [ /* … */ ],
    securityRules: [ /* … */ ],
    callbacks: { /* … */ },
    history: true,

    // ── The admin panel reads these ──────────────────────────
    admin: {
        icon: "FileText",
        listProperties: ["title", "status"],
        defaultViewMode: "table",
        entityViews: ["preview"]
    }
};
```

La separazione non è puramente estetica. È ciò che consente a Rebase di essere un backend autonomo:

- Un progetto **BaaS o headless** non scrive mai un blocco `admin`. Le sue collezioni — o nessuna
  collezione, dato che la modalità BaaS esegue l'introspezione del database — descrivono dati e
  autorizzazioni, nient'altro. `@rebasepro/types` non include codice UI, per cui l'albero delle
  dipendenze di un progetto headless rimane limitato al solo server.
- Il **backend non legge mai all'interno del blocco**. Questo viene rimosso prima che una collezione
  venga serializzata verso l'endpoint del contratto o in un bundle di build, ed è escluso dalla
  versione dello schema — quindi la modifica di un'icona non contrassegna ogni SDK generato come
  obsoleto.

### Il blocco `admin` esiste solo se installi i tipi admin

`@rebasepro/types` non dichiara alcun campo `admin` — né su una collezione, né su una proprietà. In
un progetto BaaS, scriverne uno è un **errore di tipo**. `@rebasepro/cms-types` lo reintroduce tramite
declaration merging, quindi basta una sola riga per progetto per attivarlo:

```typescript no-verify
// config/cms.d.ts
/// <reference types="@rebasepro/cms-types" />
```

Dopodiché, i normali tipi core supportano un blocco completamente tipizzato — un refuso come `icoon` genera un errore,
e ottieni il completamento automatico:

```typescript
import { defineCollection } from "@rebasepro/cms-types";

const posts = defineCollection({
    slug: "posts",
    name: "Posts",
    table: "posts",
    properties: {
        title: { name: "Title", type: "string", admin: { multiline: true } }
    },
    admin: { icon: "FileText" }
});
```

<!-- docs-verify: ignore -->
Un'estensione (augmentation) si applica all'intero *programma* TypeScript, e `config/` e `frontend/`
sono programmi separati — motivo per cui il riferimento appartiene al pacchetto di configurazione. Non
esiste un tipo wrapper `AdminCollectionConfig`: con il campo unito tramite merging, `CollectionConfig`
diventa il tipo di creazione (authoring type).

:::note[Perché un progetto BaaS non ha costi aggiuntivi]
Il tipo di una proprietà in un'installazione BaaS non ha `Field`, né `columnWidth`, né
`hideFromCollection` — questi risiedono in `AdminPropertyOptions` nel pacchetto admin. La
garanzia è verificata attivamente, non solo dichiarata: `tests/e2e/baas-typecheck/src/admin_absent.ts` utilizza
`@ts-expect-error` su `admin`, in modo che la build fallisca se il campo dovesse mai tornare a essere scrivibile
nel core.
:::

### Migrazione da una collezione flat

Prima della versione 0.11 questi campi si trovavano al livello principale. Per spostarli:

```bash
node tooling/scripts/codemod/collections-admin-block.mjs config/collections
```

Il comando segnala qualsiasi cosa non riesca a spostare in sicurezza — in particolare la presentazione all'interno
di `relations[].overrides`, che richiede manualmente `overrides: { admin: { … } }`.

```typescript
import { defineCollection } from "@rebasepro/cms-types";

export const productsCollection = defineCollection({
    slug: "products",              // URL path and API endpoint
    name: "Products",              // Display name (plural)
    singularName: "Product",       // Display name (singular)
    table: "products",            // PostgreSQL table name

    properties: {
        name: {
            type: "string",
            name: "Product Name",
            validation: { required: true }
        },
        price: {
            type: "number",
            name: "Price",
            validation: { required: true, min: 0 }
        },
        category: {
            type: "string",
            name: "Category",
            enum: [
                { id: "electronics", label: "Electronics", color: "blue" },
                { id: "clothing", label: "Clothing", color: "pink" },
                { id: "books", label: "Books", color: "orange" }
            ]
        },
        description: {
            type: "string",
            name: "Description",
            admin: { multiline: true }
        },
        active: {
            type: "boolean",
            name: "Active",
            defaultValue: true
        },
        createdAt: {
            type: "date",
            name: "Created At",
            autoValue: "on_create",
            admin: { readOnly: true }
        }
    },
    admin: {
        icon: "Package"               // Lucide icon name
    }
});

```

## Proprietà Chiave

### Identificazione

| Proprietà | Tipo | Descrizione |
|----------|------|-------------|
| `slug` | `string` | **Obbligatorio.** Identificatore URL-safe. Utilizzato nell'URL della UI di amministrazione e nel percorso dell'API REST (`/api/data/{slug}`). |
| `name` | `string` | **Obbligatorio.** Nome visualizzato (plurale). Mostrato nella navigazione e nelle intestazioni di pagina. |
| `singularName` | `string` | Nome visualizzato per una singola entità. Utilizzato in "Nuovo prodotto", "Modifica prodotto", ecc. |
| `description` | `string` | Una frase che descrive cosa contiene questa collezione, mostrata sopra l'elenco. Markdown. |
| `table` | `string` | Nome della tabella PostgreSQL. Il valore predefinito è `toSnakeCase(slug)` — impostalo solo per disaccoppiare l'URL dalla tabella, ad es. una tabella `blog_posts` esistente servita su `/posts`. |
| `admin.icon` | `string` | Nome di un'icona [Lucide](https://lucide.dev/icons), ad es. `"FileText"`, `"ShoppingCart"`. Funziona anche un elemento renderizzato, ma il nome resiste alla serializzazione, quindi è ciò che l'editor dello schema riscrive. |

### Schema

| Proprietà | Tipo | Descrizione |
|----------|------|-------------|
| `properties` | `Properties` | **Obbligatorio.** Mappa di chiave proprietà → definizione proprietà. Ogni chiave diventa una colonna del database. |
| `relations` | `Relation[]` | Relazioni SQL — chiavi esterne, tabelle di giunzione. Consulta [Relazioni](/docs/collections/relations). |
| `securityRules` | `SecurityRule[]` | Criteri di Row Level Security. Consulta [Regole di Sicurezza](/docs/collections/security-rules). |
| `indexes` | `CollectionIndex[]` | Indici Postgres richiesti da questa tabella. Consulta [Indici](/docs/backend/indexes). |
| `search` | `SearchConfig` | Ricerca full-text con ranking sui campi specificati, inclusi contenuti JSONB e array. Solo Postgres. Consulta [Ricerca](/docs/backend/search). |
| `auth` | `boolean \| AuthCollectionConfig` | Contrassegna la collezione come collezione di autenticazione (gestione utenti, reimpostazione password, ecc.). |
| `schema` | `string` | Schema Postgres in cui risiede la tabella — `"public"`, `"rebase"`, `"auth"`. Il valore predefinito è `"public"`. |
| `disableDefaultPolicies` | `boolean` | Rimuove i criteri di base inseriti dal generatore — un SELECT per admin/server, e su una collezione auth una lettura autonoma più un vincolo di scrittura per soli amministratori — assumendo la piena responsabilità dell'RLS di questa collezione. `false` per impostazione predefinita. Consulta [Regole di Sicurezza](/docs/collections/security-rules). |
| `softDelete` | `boolean \| { field?: string }` | Trasforma `delete` in un timestamp e nasconde le righe contrassegnate da ogni operazione di lettura. `true` usa `deletedAt`; la forma a oggetto rinomina il campo. La collezione deve dichiarare esplicitamente tale proprietà `date`. Solo Postgres — consulta [Soft delete](/docs/collections/soft-delete). |
| `strictWrites` | `boolean` | Rifiuta una scrittura che specifica un campo non dichiarato da questa collezione, restituendo un 400. `true` per impostazione predefinita. Impostalo su `false` solo quando la colonna esiste effettivamente nel database ma non è dichiarata — popolata da un trigger o ricavata da introspezione invece che scritta esplicitamente. |

### Configurazione UI

Tutte le seguenti proprietà vanno all'interno di `admin`.

| Proprietà | Tipo | Predefinito | Descrizione |
|----------|------|---------|-------------|
| `defaultViewMode` | `"list" \| "table" \| "cards" \| "kanban"` | `"list"` | Modalità di visualizzazione predefinita |
| `enabledViews` | `ViewMode[]` | Le quattro integrate più ogni vista personalizzata dichiarata (kanban solo quando è presente una proprietà `enum`) | Quali modalità di visualizzazione sono disponibili |
| `kanban` | `KanbanConfig` | — | Configurazione Kanban (proprietà della colonna). Abbinala sempre a `orderProperty` — consulta [Modalità di Visualizzazione](/docs/frontend/view-modes) |
| `orderProperty` | `string` | — | Chiave della proprietà **string** contenente la chiave di ordinamento drag-and-drop. Obbligatoria per il corretto funzionamento della bacheca Kanban |
| `openEntityMode` | `"side_panel" \| "full_screen" \| "split" \| "dialog"` | Dalla vista: `"split"` per list, `"full_screen"` per table e cards, `"side_panel"` per kanban e viste personalizzate | Modalità di apertura delle entità per la modifica |
| `sideDialogWidth` | `number \| string` | — | Larghezza del dialogo laterale |
| `inlineEditing` | `boolean` | `true` | Abilita la modifica inline nella vista a foglio di calcolo |
| `defaultSize` | `"xs" \| "s" \| "m" \| "l" \| "xl"` | `"m"` | Densità predefinita delle viste list, table e cards (l'altezza della riga della tabella) |
| `pagination` | `boolean \| number` | `true` (50) | Abilita la paginazione e/o imposta la dimensione della pagina. `false` carica tutte le righe; in ambiente di sviluppo la console emette un avviso una volta se sono più di 10.000 righe |
| `listProperties` | `string[]` | — | Proprietà da visualizzare nella vista a elenco |
| `propertiesOrder` | `string[]` | — | Ordine delle colonne nella vista a tabella |
| `selectionEnabled` | `boolean` | `true` | Abilita la selezione delle righe |
| `hideFromNavigation` | `boolean` | `false` | Nascondi dalla barra di navigazione laterale |
| `defaultSelectedView` | `string \| function` | — | Vista o subcollezione predefinita da aprire |

### Opzioni Entità

All'interno di `admin`, ad eccezione di `history`, che è una funzionalità backend e rimane al livello principale.

| Proprietà | Tipo | Predefinito | Descrizione |
|----------|------|---------|-------------|
| `formAutoSave` | `boolean` | `false` | Salva automaticamente due secondi dopo una modifica, una volta validato il form. Un form "Nuovo" non viene salvato finché non viene inserito qualcosa. |
| `localChangesBackup` | `"manual_apply" \| "auto_apply" \| false` | `"manual_apply"` | Backup delle modifiche non salvate |
| `hideIdFromForm` | `boolean` | `false` | Nascondi l'ID dell'entità dal form |
| `hideIdFromCollection` | `boolean` | `false` | Nascondi la colonna ID dalla tabella |
| `includeJsonView` | `boolean` | `true` | Mostra i valori grezzi nell'ispettore dei record |
| `history` | `boolean` | `false` | Traccia le modifiche nella cronologia dell'entità |
| `alwaysApplyDefaultValues` | `boolean` | `false` | Quando un record esistente viene aperto nel form, inserisce il `defaultValue` dichiarato per ciascuna proprietà nei campi lasciati vuoti (`null` o mancanti), in modo che il salvataggio successivo li scriva |
| `previewProperties` | `string[]` | — | Proprietà da mostrare nelle anteprime dei riferimenti |
| `display` | `EntityDisplay` | — | Cosa popola ciascun ruolo di visualizzazione — vedi [Visualizzazione dell'entità](#visualizzazione-dellentità) |

### Avanzate

Al livello principale, poiché vengono lette dal backend:

| Proprietà | Tipo | Descrizione |
|----------|------|-------------|
| `callbacks` | `CollectionCallbacks` | Hook del ciclo di vita (`beforeSave`, `afterSave`, `beforeDelete`, ecc.) |
| `childCollections` | `() => CollectionConfig[]` | Le collezioni annidate sotto un'entità di questa collezione. Compilate durante la normalizzazione a partire da qualsiasi costrutto utilizzato dal driver — una `subcollections` di Firestore, una relazione `hasMany` di Postgres — quindi un driver personalizzato è l'unico motivo per impostarle manualmente |
| `dataSource` | `string` | Quale data source registrato supporta questa collezione (predefinito: quello senza nome) |
| `engine` | `string` | Il motore sottostante — `"postgres"`, `"firestore"`, `"mongodb"`. Risolto da `dataSource`; impostalo solo per sovrascriverlo |
| `databaseId` | `string` | Database o schema all'interno del motore |
| `metadata` | `Record<string, unknown>` | Qualsiasi dato che il tuo codice debba associare a una collezione. Rebase non lo legge; viene preservato intatto durante la serializzazione |
| `ownerId` | `string` | **Solo form admin — non applicato dall'API o dal database.** L'ID utente che l'editor delle collezioni appone su una collezione creata, mostrato accanto al suo nome. Nulla lungo il percorso della richiesta lo consulta |

`subcollections` e `path` si trovano esclusivamente nelle configurazioni per **database orientati ai documenti** —
`FirebaseCollectionConfig` e, per `path`, `MongoDBCollectionConfig`:

| Proprietà | Tipo | Descrizione |
|----------|------|-------------|
| `subcollections` | `() => CollectionConfig[]` | **Solo Firestore.** Collezioni annidate sotto ciascun documento. Una collezione Postgres esprime lo stesso concetto tramite una [relazione](/docs/collections/relations) `hasMany`, che è ciò che popola `childCollections` |
| `path` | `string` | **Solo Firestore e MongoDB.** Il percorso o il nome della collezione nel motore, quando differisce dallo slug |

E all'interno di `admin`, poiché vengono renderizzate esclusivamente dal pannello:

| Proprietà | Tipo | Descrizione |
|----------|------|-------------|
| `admin.entityActions` | `EntityAction[]` | Azioni personalizzate sulle entità (archivia, pubblica, ecc.) |
| `admin.Actions` | `ComponentRef<CollectionActionsProps>[]` | Componenti personalizzati per le azioni nella barra degli strumenti |
| `admin.entityViews` | `EntityCustomView[]` | Schede personalizzate nella vista di dettaglio dell'entità |
| `admin.additionalFields` | `AdditionalFieldDelegate[]` | Colonne calcolate/virtuali |
| `admin.exportable` | `boolean \| ExportConfig` | Abilita l'esportazione dei dati |
| `admin.components` | `CollectionComponentOverrideMap` | Override dei componenti UI con ambito a livello di collezione |

Scrivere una qualsiasi di queste sei proprietà al livello principale genera un errore all'avvio, con un messaggio
che specifica la chiave e la posizione in cui è stata spostata.

## Visualizzazione dell'entità

Ogni interfaccia che disegna un record mostra un sottoinsieme di sei ruoli: **title**,
**subtitle**, **image**, **status**, **date** e **tags**. Una riga di un elenco è immagine +
titolo + sottotitolo + stato + data; una card è identica ma con l'immagine in alto; un
selettore di riferimenti è titolo + sottotitolo; e l'intestazione di una pagina è solo il titolo.

Ciascun ruolo è derivato dalle tue proprietà, e ciascuno può essere specificato esplicitamente — come
percorso di una proprietà o come funzione:

```typescript
const exercises = defineCollection({
    name: "Exercises",
    slug: "exercises",
    table: "exercises",
    properties: {
        name: { name: "Name", type: "string" },
        cover: { name: "Cover", type: "string", storage: { storagePath: "covers/" } },
        city: { name: "City", type: "string" }
    },
    admin: {
        display: {
            title: "name",                                  // a property path
            image: "cover",
            subtitle: ({ row }) => `in ${String(row.city)}`        // computed
        }
    }
});
```

Tutto ciò che ometti mantiene il suo valore derivato, quindi definire un ruolo non
significa doverli definire tutti e sei.

Un resolver riceve `{ row, id, context }`. `row` è il record così come lo invia il server,
la struttura restituita da `useRows` e `context.data`: date come stringhe ISO,
un belongsTo rappresentato dalla sua colonna di chiave esterna (`authorId`), e `id` solo se la tabella possiede tale colonna. `id`
è l'ID del record a fianco: la sua chiave primaria come stringa, oppure le parti di una chiave composita
unite da `:::`. Una relazione caricata dall'admin arriva annidata sotto il suo
nome, così come restituita da `include` di REST — `row.author` è la riga dell'autore, contenente solo
le sue colonne, accanto ad `authorId` — quindi un resolver può leggere il campo di un record
correlato senza eseguire una richiesta separata:

```typescript
admin: {
    display: {
        // Undefined where the row holds only the author's id.
        subtitle: ({ row }) => typeof row.author === "object" && row.author !== null && "name" in row.author
            ? String(row.author.name)
            : undefined
    }
}
```

### Ruoli calcolati e asincroni

Un resolver può essere `async`, consentendo a un ruolo di leggere dati non contenuti
direttamente nel record — un documento in una subcollezione, un valore dietro un'API:

```typescript
admin: {
    display: {
        // The exercise's name lives one document down, per locale.
        title: async ({ id, context }) => {
            const locale = await context.data.exercise_locales.findById(`${id}/de-DE`);
            return locale?.exercise_title;
        }
    }
}
```

Mentre la promise è in corso, l'interfaccia mostra il valore derivato e lo sostituisce con
quello risolto una volta disponibile — un titolo non mostrerà mai uno spinner. I risultati vengono memorizzati
in cache per record e per ruolo, e le richieste simultanee per la stessa coppia condividono un'unica chiamata; di conseguenza,
un elenco di cinquanta righe risolve ogni riga una sola volta anziché a ogni render.

Restituisci `undefined` quando un record non ha alcun dato per il ruolo; il fallback nativo
dell'interfaccia ha informazioni migliori su cosa mostrare in alternativa (un'intestazione usa il
nome singolare della collezione, un link usa l'ID). Un resolver che lancia un'eccezione viene trattato
come `undefined` e registrato una sola volta nei log — un titolo che non può essere recuperato non deve
compromettere l'intera riga che lo visualizza.

Preferisci sempre un percorso quando il valore è presente sul record: un percorso mantiene la
resa visiva nativa della proprietà, per cui uno stato di tipo enum rimane un badge colorato e una data rimane
formattata, cosa che un resolver che restituisce una stringa semplice non è in grado di esprimere.

:::note[`titleProperty` sostituito]
`admin.titleProperty` è stato rimosso in favore di `admin.display.title`. La stessa
stringa funziona anche lì, e il nuovo campo accetta anche un resolver. Una collezione che utilizza
ancora la vecchia chiave viene rifiutata da `defineCollection` con il consueto errore di chiave sconosciuta.
:::

### Selezione della proprietà del titolo
Quando `display.title` non è impostato, la proprietà utilizzata come titolo visualizzato dell'entità (anteprime, intestazioni) viene determinata automaticamente:
1. Se `propertiesOrder` è definito esplicitamente, viene scelta la prima proprietà in tale ordine che può fungere da titolo: una `string`, una `relation` a cardinalità singola o una `reference`. Gli identificatori (chiavi primarie ed esterne, colonne `uuid`, `isId`), i campi di caricamento file e le proprietà nascoste non sono mai idonei.
2. Se non è definito alcun `propertiesOrder`, gli stessi candidati vengono classificati: prima una stringa la cui chiave descrive un'etichetta (`name`, `title`, `label`, …), poi testo breve semplice, un'email, un enum, testo lungo, un selettore di relazione o utente, e infine una reference. A parità di rango prevale l'ordine di dichiarazione.

### Anteprime delle relazioni nelle tabelle
Quando `propertiesOrder` è impostato esplicitamente, le proprietà di tipo relazione **non** vengono automaticamente escluse dalle colonne di anteprima predefinite (mentre vengono escluse dalle configurazioni predefinite non ordinate per evitare operazioni di join lente).

### Come viene renderizzato il valore di un titolo
Indipendentemente da cosa contiene la proprietà del titolo, il pannello renderizza una stringa. Una data viene formattata, un array viene concatenato e una relazione — che arriva come `{ id, data: { values } }` anziché come testo — viene analizzata cercando il primo valore tra `name`, `title`, `label` o `displayName` sulla riga correlata, poi il suo primo valore stringa breve, tornando infine al suo id. Pertanto, un titolo può fare riferimento a una proprietà `relation` ed essere comunque visualizzato come un nome anziché come un uuid.

Questo non è un helper esportato: è il comportamento standard già adottato da ogni interfaccia che disegna un record. Non c'è nulla da chiamare né nulla da importare.

## Collection Builder

Per collezioni dinamiche che cambiano in base all'utente o a dati esterni, utilizza una funzione builder:

```typescript
const collectionsBuilder: CollectionConfigsBuilder = ({ user, authController }) => {
    const collections = [productsCollection];

    // `extra` is whatever your auth provider put there, so name its shape here.
    const extra = authController.extra as { role?: string };
    if (extra.role === "admin") {
        collections.push(adminSettingsCollection);
    }

    return collections;
};
```

Il builder riceve anche `data`, che legge le righe così come le invia il server,
allo stesso modo di `context.data`: `await data.collection("tenants").find()` si risolve in
`{ data: rows, meta }`.

## Filtro e ordinamento

È possibile impostare filtri predefiniti o forzati. Entrambi riguardano la presentazione — ciò con
cui il pannello si apre — quindi risiedono in `admin`:

```typescript
import { defineCollection } from "@rebasepro/cms-types";

const invoices = defineCollection({
    slug: "invoices",
    name: "Invoices",
    table: "invoices",
    properties: {
        active: { name: "Active", type: "boolean" },
        tenantId: { name: "Tenant", type: "string" },
        createdAt: { name: "Created", type: "date" }
    },
    admin: {
        // Default filter — users can change it
        defaultFilter: { active: ["==", true] },

        // Fixed filter — cannot be changed; filters the user applies
        // on other fields combine with it
        fixedFilter: { tenantId: ["==", currentTenantId] },

        // Default sort
        sort: ["createdAt", "desc"]
    }
});
```

L'utente può comunque filtrare una collezione con un `fixedFilter`: qualunque filtro
applichi su altri campi viene combinato con esso (AND), e i campi bloccati rimangono invariati.

Un `fixedFilter` restringe ciò che il pannello *richiede*; non è una barriera di sicurezza. Ciò che un
chiamante è autorizzato a leggere è definito da una [regola di sicurezza](/docs/collections/security-rules),
applicata dal database per qualsiasi chiamante, sia esso il pannello o un client esterno.

## Gestione di molte collezioni

In Rebase non c'è limite al numero di collezioni, ma ci sono due fattori il cui impatto cresce proporzionalmente:

- **Il primo download dell'admin.** Il pannello ha bisogno della navigazione nell'istante in cui
  un utente effettua l'accesso, quindi la configurazione di ogni collezione viene inclusa nel bundle
  scaricato dal browser per la schermata di login — circa 2,4 KB minificati per ciascuna, quindi 200
  collezioni aggiungono circa 480 KB, ossia circa 80 KB compressi con gzip. Ciò che serve per aprire
  una collezione (la tabella, le viste dei record, il form) viene caricato solo al momento dell'apertura.
- **`rebase db push`.** Atlas pianifica il push calcolando le differenze sull'intero schema, e tale
  operazione cresce più rapidamente rispetto al semplice conteggio delle tabelle: con 400 o più tabelle un push richiede
  diverse decine di secondi — consulta [quanto dura un push](/docs/cli/schema#rebase-db-push).

## Passaggi successivi

- **[Callback delle entità](/docs/collections/callbacks)** — Hook del ciclo di vita per sincronizzare i dati tra collezioni, validazioni ed effetti collaterali
- **[Proprietà](/docs/collections/properties)** — Tutti i tipi di proprietà e le relative opzioni
- **[Relazioni](/docs/collections/relations)** — Chiavi esterne, tabelle di giunzione, join
- **[Regole di sicurezza](/docs/collections/security-rules)** — Row Level Security
- **[Modalità di visualizzazione](/docs/frontend/view-modes)** — Elenco, Tabella, Schede, Kanban
