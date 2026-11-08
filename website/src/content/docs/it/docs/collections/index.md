---
sourceHash: 6f0489ae490ff4b1
title: Collezioni
sidebar_label: Collezioni
description: Le collezioni sono l'elemento fondamentale di Rebase — ogni collezione mappa una tabella del database e ne definisce schema, relazioni, sicurezza e comportamento dell'interfaccia utente.
---

## Cos'è una collezione?

Una **collezione** è un oggetto TypeScript che descrive una tabella del database e come dovrebbe apparire in Rebase CMS. Definisce:

- **Schema** — Proprietà (colonne), i loro tipi e regole di validazione
- **Relazioni** — Chiavi esterne, tabelle di giunzione e percorsi di join
- **Sicurezza** — Policy di Row Level Security
- **Hook del ciclo di vita** — Callback per operazioni di creazione, aggiornamento ed eliminazione
- **Comportamento del CMS** — Modalità di visualizzazione, modifica inline, viste entità, azioni — tutto sotto `admin`

## Dichiararne una: `defineCollection`

Racchiudi il letterale in `defineCollection`. A runtime è una funzione identità — restituisce l'oggetto invariato — quindi non costa nulla. Ciò che offre è l'inferenza: un parametro di tipo `const` acquisisce le chiavi delle tue `properties` come tipi letterali, e i campi sotto forma di chiave del blocco `admin` vengono quindi verificati a fronte di essi. Un nome che non corrisponde a una delle tue proprietà rappresenta un **errore di compilazione**, non semplicemente un suggerimento mancante.

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

I campi controllati sono `display`, `sort`, `propertiesOrder`, `listProperties`, `previewProperties`, `orderProperty` e i filtri `defaultFilter`, `fixedFilter` e `filterPresets`. Oltre a una semplice chiave di proprietà, sono accettate tre forme:

| Forma | Esempio | Note |
| --- | --- | --- |
| Percorso con notazione a punti in una `map` | `"profile.displayName"` | La **radice** deve essere una proprietà reale; il percorso sottostante non viene controllato. Non consentito su `previewProperties` / `orderProperty`, che accettano una chiave di primo livello. |
| Colonna di una child-collection | `"subcollection:orders"` | Solo per `propertiesOrder` / `listProperties`. |
| Una chiave di `additionalFields` | `"score" as AdditionalFieldKey` | Solo per `propertiesOrder` / `listProperties`. Richiede il cast — vedi sotto. |

`AdditionalFieldDelegate.key` è una semplice `string`, quindi il sistema di tipi non ha modo di sapere quali chiavi extra dichiari una collezione. Piuttosto che riaprire questi campi a qualsiasi stringa, il cast rende l'eccezione esplicita:

```typescript
import type { AdditionalFieldKey } from "@rebasepro/cms-types";

propertiesOrder: ["title", "score" as AdditionalFieldKey]
```

Importalo da `@rebasepro/cms-types` in un progetto che dispone di un pannello di amministrazione — è quella la copia che esegue anche il typecheck del blocco `admin`. Un progetto BaaS headless, che non ha un blocco admin, importa invece la stessa funzione da `@rebasepro/common`.

Anche annotare direttamente il tipo funziona ed è comunque verificato:

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

ma un'annotazione *valida solo la struttura* — non può visualizzare i nomi delle tue proprietà, quindi i campi chiave di `admin` tornano ad accettare qualsiasi stringa. È preferibile usare `defineCollection` a meno che non sia necessario specificare esplicitamente il tipo.

:::note
`buildCollection` e `buildProperty` non esistono più. `buildCollection` è `defineCollection` senza l'inferenza; `buildProperty` racchiudeva una proprietà in un tipo che già possedeva. Consulta il [changelog](/docs/changelog) per la migrazione in una riga.
:::

## Anatomia: il contratto e il pannello

Un solo file, due destinatari. Tutto ciò di cui si occupano il *database e l'API* si trova al livello principale; tutto ciò di cui si occupa il *pannello di amministrazione* si trova all'interno di `admin`.

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

La separazione non è cosmetica. È ciò che consente a Rebase di essere un backend autonomo:

- Un progetto **BaaS o headless** non scrive mai un blocco `admin`. Le sue collezioni — o nessuna collezione, dato che la modalità BaaS esegue l'introspezione del database — descrivono dati e autorizzazioni, nient'altro. `@rebasepro/types` non include codice UI, quindi l'albero delle dipendenze di un progetto headless rimane limitato al server.
- Il **backend non legge mai all'interno del blocco**. Questo viene rimosso prima che una collezione venga serializzata verso l'endpoint di contratto o in un bundle di build, ed è escluso dalla versione dello schema — quindi la modifica di un'icona non contrassegna ogni SDK generato come obsoleto.

### Il blocco `admin` esiste solo se installi i tipi admin

`@rebasepro/types` non dichiara alcun campo `admin` — né su una collezione, né su una proprietà. In un progetto BaaS, scriverne uno è un **errore di tipo**. `@rebasepro/cms-types` lo riaggiunge tramite il declaration merging, quindi basta una riga per progetto per attivarlo:

```typescript no-verify
// config/cms.d.ts
/// <reference types="@rebasepro/cms-types" />
```

Successivamente, i tipi base del core includono un blocco completamente tipizzato — un refuso come `icoon` è un errore e ottieni il completamento automatico:

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
Un'augmentation si applica all'intero *programma* TypeScript, e `config/` e `frontend/` sono programmi separati — motivo per cui il riferimento appartiene al pacchetto di configurazione. Non esiste un tipo wrapper `AdminCollectionConfig`: una volta unito il campo, `CollectionConfig` è il tipo di authoring.

:::note[Perché un progetto BaaS non ha costi aggiuntivi]
Il tipo di una proprietà in un'installazione BaaS non ha `Field`, `columnWidth` o `hideFromCollection` — questi risiedono in `AdminPropertyOptions` nel pacchetto admin. Questa garanzia è formalmente verificata: `tests/e2e/baas-typecheck/src/admin_absent.ts` usa `@ts-expect-error` su `admin`, quindi la build fallisce se il campo dovesse mai tornare scrivibile nel core.
:::

### Migrazione da una collezione flat

Prima della versione 0.11 questi campi si trovavano al livello principale. Per spostarli:

```bash
node tooling/scripts/codemod/collections-admin-block.mjs config/collections
```

Segnala tutto ciò che non può spostare in modo sicuro — in particolare la presentazione all'interno di `relations[].overrides`, che richiede l'aggiornamento manuale a `overrides: { admin: { … } }`.

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

## Proprietà principali

### Identificazione

| Proprietà | Tipo | Descrizione |
|----------|------|-------------|
| `slug` | `string` | **Obbligatorio.** Identificatore compatibile con gli URL (URL-safe). Utilizzato nell'URL della UI di amministrazione e nel percorso delle API REST (`/api/data/{slug}`). |
| `name` | `string` | **Obbligatorio.** Nome visualizzato (plurale). Mostrato nella navigazione e nelle intestazioni di pagina. |
| `singularName` | `string` | Nome visualizzato per una singola entità. Usato in "Nuovo prodotto", "Modifica prodotto", ecc. |
| `description` | `string` | Una frase che descrive il contenuto della collezione, mostrata sopra l'elenco. Markdown. |
| `table` | `string` | Nome della tabella PostgreSQL. Il valore predefinito è `toSnakeCase(slug)` — impostalo solo per disaccoppiare l'URL dalla tabella, ad es. una tabella esistente `blog_posts` servita su `/posts`. |
| `admin.icon` | `string` | Il nome di un'icona [Lucide](https://lucide.dev/icons), ad es. `"FileText"`, `"ShoppingCart"`. Funziona anche un elemento renderizzato, ma il nome sopravvive alla serializzazione, quindi è ciò che l'editor di schema riscrive. |

### Schema

| Proprietà | Tipo | Descrizione |
|----------|------|-------------|
| `properties` | `Properties` | **Obbligatorio.** Mappa di chiave proprietà → definizione proprietà. Ciascuna chiave diventa una colonna del database. |
| `relations` | `Relation[]` | Relazioni SQL — chiavi esterne, tabelle di giunzione. Consulta [Relazioni](/docs/collections/relations). |
| `securityRules` | `SecurityRule[]` | Policy di Row Level Security. Consulta [Regole di sicurezza](/docs/collections/security-rules). |
| `indexes` | `CollectionIndex[]` | Indici Postgres necessari per questa tabella. Consulta [Indici](/docs/backend/indexes). |
| `search` | `SearchConfig` | Ricerca full-text con classificazione (ranking) sui campi specificati, inclusi contenuti JSONB e array. Solo Postgres. Consulta [Ricerca](/docs/backend/search). |
| `auth` | `boolean \| AuthCollectionConfig` | Contrassegna la collezione come collezione di autenticazione (gestione utenti, reset password, ecc.) |
| `schema` | `string` | Schema Postgres in cui risiede la tabella — `"public"`, `"rebase"`, `"auth"`. Il valore predefinito è `"public"`. |
| `disableDefaultPolicies` | `boolean` | Rimuove le policy di base inserite dal generatore — una SELECT admin/server e, su una collezione auth, una lettura autonoma (self-read) più un vincolo di scrittura per soli admin — assumendo la piena responsabilità della RLS per questa collezione. `false` per impostazione predefinita. Consulta [Regole di sicurezza](/docs/collections/security-rules). |
| `softDelete` | `boolean \| { field?: string }` | Trasforma `delete` in un timestamp e nasconde le righe contrassegnate da ogni operazione di lettura. `true` usa `deletedAt`; la forma a oggetto rinomina il campo. La collezione deve dichiarare direttamente tale proprietà `date`. Solo Postgres — consulta [Soft delete](/docs/collections/soft-delete). |
| `strictWrites` | `boolean` | Rifiuta una scrittura che indica un campo non dichiarato da questa collezione, restituendo un errore 400. `true` per impostazione predefinita. Impostalo su `false` solo quando la colonna esiste realmente ma non è dichiarata — popolata da un trigger o ricavata tramite introspezione anziché esplicitata nel codice. |

### Configurazione dell'interfaccia utente

Tutte le seguenti voci vanno all'interno di `admin`.

| Proprietà | Tipo | Predefinito | Descrizione |
|----------|------|---------|-------------|
| `defaultViewMode` | `"list" \| "table" \| "cards" \| "kanban"` | `"list"` | Modalità di visualizzazione predefinita |
| `enabledViews` | `ViewMode[]` | I quattro predefiniti più ogni vista personalizzata dichiarata (kanban solo quando esiste una proprietà `enum`) | Quali modalità di visualizzazione sono disponibili |
| `kanban` | `KanbanConfig` | — | Configurazione Kanban (proprietà della colonna). Da abbinare sempre a `orderProperty` — consulta [Modalità di visualizzazione](/docs/frontend/view-modes) |
| `orderProperty` | `string` | — | Chiave della proprietà **string** contenente la chiave d'ordine del drag-and-drop. Obbligatoria per il corretto funzionamento di una bacheca Kanban |
| `openEntityMode` | `"side_panel" \| "full_screen" \| "split" \| "dialog"` | In base alla vista: `"split"` per list, `"full_screen"` per table e cards, `"side_panel"` per kanban e viste personalizzate | Modalità di apertura delle entità per la modifica |
| `sideDialogWidth` | `number \| string` | — | Larghezza della finestra di dialogo laterale |
| `inlineEditing` | `boolean` | `true` | Abilita la modifica inline nella vista a foglio di calcolo |
| `defaultSize` | `"xs" \| "s" \| "m" \| "l" \| "xl"` | `"m"` | Densità predefinita delle viste elenco, tabella e schede (l'altezza delle righe della tabella) |
| `pagination` | `boolean \| number` | `true` (50) | Abilita la paginazione e/o imposta la dimensione della pagina. `false` carica ogni riga; in fase di sviluppo la console emette un avviso quando sono presenti più di 10.000 righe |
| `listProperties` | `string[]` | — | Proprietà da visualizzare nella vista elenco |
| `propertiesOrder` | `string[]` | — | Ordine delle colonne nella vista tabella |
| `selectionEnabled` | `boolean` | `true` | Abilita la selezione delle righe |
| `hideFromNavigation` | `boolean` | `false` | Nasconde dalla navigazione nella barra laterale |
| `defaultSelectedView` | `string \| function` | — | Vista o sottocollezione predefinita da aprire |

### Opzioni entità

All'interno di `admin`, eccetto `history`, che è una funzionalità di backend e rimane al livello principale.

| Proprietà | Tipo | Predefinito | Descrizione |
|----------|------|---------|-------------|
| `formAutoSave` | `boolean` | `false` | Salvataggio automatico due secondi dopo una modifica, una volta convalidato il form. Un form "Nuovo" non viene salvato finché non viene inserito qualcosa. |
| `localChangesBackup` | `"manual_apply" \| "auto_apply" \| false` | `"manual_apply"` | Esegue il backup delle modifiche non salvate |
| `hideIdFromForm` | `boolean` | `false` | Nasconde l'ID dell'entità dal form |
| `hideIdFromCollection` | `boolean` | `false` | Nasconde la colonna ID dalla tabella |
| `includeJsonView` | `boolean` | `true` | Rende disponibili i valori non elaborati nell'ispettore dei record |
| `history` | `boolean` | `false` | Tiene traccia delle modifiche nella cronologia dell'entità |
| `alwaysApplyDefaultValues` | `boolean` | `false` | Quando un record esistente viene aperto nel form, compila il `defaultValue` dichiarato per ciascuna proprietà in un valore che il record lascia vuoto (`null` o mancante), in modo che il salvataggio successivo lo scriva |
| `previewProperties` | `string[]` | — | Proprietà da mostrare nelle anteprime dei riferimenti |
| `display` | `EntityDisplay` | — | Cosa popola ciascun ruolo di visualizzazione — consulta [Visualizzazione entità](#visualizzazione-entità) |

### Avanzate

Al livello principale, poiché vengono lette dal backend:

| Proprietà | Tipo | Descrizione |
|----------|------|-------------|
| `callbacks` | `CollectionCallbacks` | Hook del ciclo di vita (`beforeSave`, `afterSave`, `beforeDelete`, ecc.) |
| `childCollections` | `() => CollectionConfig[]` | Le collezioni nidificate sotto un'entità di questa. Compilate durante la normalizzazione a partire da ciò con cui il driver le esprime — `subcollections` in Firestore, una relazione `hasMany` in Postgres — quindi un driver personalizzato è l'unico motivo per impostarlo manualmente |
| `dataSource` | `string` | Quale origine dati registrata supporta questa collezione (predefinita: quella senza nome) |
| `engine` | `string` | Il motore sottostante — `"postgres"`, `"firestore"`, `"mongodb"`. Risolto da `dataSource`; impostalo solo per sovrascriverlo |
| `databaseId` | `string` | Database o schema all'interno del motore |
| `metadata` | `Record<string, unknown>` | Qualsiasi dato di cui il tuo codice ha bisogno da associare a una collezione. Rebase non lo legge; sopravvive alla serializzazione invariato |
| `ownerId` | `string` | **Solo form di amministrazione — non vincolato dall'API o dal database.** L'ID utente che l'editor della collezione assegna a una collezione creata e mostra accanto al suo nome. Nulla nel percorso di richiesta lo consulta |

`subcollections` e `path` sono presenti solo nelle configurazioni dei **database a documenti** — `FirebaseCollectionConfig` e, per `path`, `MongoDBCollectionConfig`:

| Proprietà | Tipo | Descrizione |
|----------|------|-------------|
| `subcollections` | `() => CollectionConfig[]` | **Solo Firestore.** Collezioni nidificate sotto ciascun documento. Una collezione Postgres esprime la stessa cosa con una [relazione](/docs/collections/relations) `hasMany`, che è ciò che compila `childCollections` |
| `path` | `string` | **Solo Firestore e MongoDB.** Il percorso o il nome della collezione nel motore, quando differisce dallo slug |

E all'interno di `admin`, poiché solo il pannello si occupa di renderizzarli:

| Proprietà | Tipo | Descrizione |
|----------|------|-------------|
| `admin.entityActions` | `EntityAction[]` | Azioni personalizzate sulle entità (archivia, pubblica, ecc.) |
| `admin.Actions` | `ComponentRef<CollectionActionsProps>[]` | Componenti personalizzati per le azioni della barra degli strumenti |
| `admin.entityViews` | `EntityCustomView[]` | Schede personalizzate nella vista di dettaglio dell'entità |
| `admin.additionalFields` | `AdditionalFieldDelegate[]` | Colonne calcolate/virtuali |
| `admin.exportable` | `boolean \| ExportConfig` | Abilita l'esportazione dei dati |
| `admin.components` | `CollectionComponentOverrideMap` | Override dei componenti UI con ambito a livello di collezione |

Scrivere una qualsiasi di queste sei proprietà al livello principale genera un errore all'avvio, con un messaggio che indica la chiave e la posizione in cui è stata spostata.

## Visualizzazione entità

Ogni superficie che mostra un record visualizza un sottoinsieme di sei ruoli: **title**, **subtitle**, **image**, **status**, **date** e **tags**. Una riga di un elenco è composta da image + title + subtitle + status + date, una scheda (card) è la stessa cosa con l'immagine in alto, un selettore di riferimenti è title + subtitle, e l'intestazione di una pagina è il solo title.

Ciascun ruolo è derivato dalle tue proprietà e ciascuno può invece essere dichiarato esplicitamente — come percorso di proprietà (property path) o come funzione:

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

Tutto ciò che viene tralasciato mantiene il proprio valore derivato, quindi specificare un ruolo non implica doverli definire tutti e sei.

A un resolver viene passato `{ row, context }`. `row` è il record così come inviato dal server, nella struttura restituita da `useRows` e `context.data`: date come stringhe ISO, un belongsTo come la relativa colonna di chiave esterna (`authorId`), e l'`id` incluso. Una relazione caricata dall'admin arriva nidificata sotto il proprio nome, così come restituita da `include` di REST — `row.author` è la riga dell'autore, accanto ad `authorId` — quindi un resolver legge il campo di un record correlato senza effettuare una propria richiesta:

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

Un resolver può essere `async`, consentendo a un ruolo di leggere elementi non presenti direttamente nel record — un documento in una sottocollezione, un valore fornito da un'API:

```typescript
admin: {
    display: {
        // The exercise's name lives one document down, per locale.
        title: async ({ row, context }) => {
            const locale = await context.data.exercise_locales.findById(`${String(row.id)}/de-DE`);
            return locale?.exercise_title;
        }
    }
}
```

Mentre la promise è in corso, la superficie mostra il valore derivato e lo sostituisce con quello risolto non appena disponibile — un titolo non mostra mai uno spinner. I risultati vengono memorizzati nella cache per record e per ruolo, e le richieste concorrenti per la stessa coppia condividono un'unica chiamata, quindi un elenco di cinquanta righe risolve ciascuna riga una volta sola anziché a ogni render.

Restituisci `undefined` quando un record non ha nulla per il ruolo; il fallback nativo della superficie è strutturato per gestire meglio ciò che dovrebbe apparire al suo posto (un'intestazione usa il nome singolare della collezione, un link usa l'id). Un resolver che genera un'eccezione viene trattato come `undefined` e registrato nei log una sola volta — un titolo che non può essere recuperato non deve compromettere la riga che lo visualizza.

Preferisci un percorso ogni volta che il valore è presente sul record: un percorso preserva il rendering nativo della proprietà, facendo sì che uno stato enum rimanga un chip colorato e una data rimanga formattata, cosa che un resolver che restituisce una semplice stringa non può esprimere.

:::note[`titleProperty` sostituita]
`admin.titleProperty` è stata rimossa a favore di `admin.display.title`. La stessa stringa funziona anche lì, e il nuovo campo accetta anche un resolver. Una collezione che contiene ancora la vecchia chiave viene rifiutata da `defineCollection` con il consueto errore di chiave sconosciuta.
:::

### Selezione della proprietà titolo
Quando `display.title` non è impostato, la proprietà utilizzata come titolo visualizzato dell'entità (anteprime, intestazioni) viene risolta automaticamente:
1. Se `propertiesOrder` è definito esplicitamente, viene scelta la prima proprietà in tale ordine che può fungere da titolo: una `string`, una `relation` a cardinalità singola o un `reference`. Gli identificatori (chiavi primarie ed esterne, colonne `uuid`, `isId`), i campi di caricamento file e le proprietà nascoste non sono mai idonei.
2. Se non è definito alcun `propertiesOrder`, i medesimi candidati vengono classificati: prima una stringa la cui chiave richiama un'etichetta (`name`, `title`, `label`, …), poi testo breve semplice, un'email, un enum, testo lungo, un selettore di relazioni o di utenti, e infine un reference. In caso di parità, prevale l'ordine di dichiarazione.

### Anteprime delle relazioni nelle tabelle
Quando `propertiesOrder` è impostato esplicitamente, le proprietà di relazione **non** vengono escluse automaticamente dalle colonne di anteprima predefinite (mentre vengono escluse dalle impostazioni predefinite non ordinate per evitare operazioni di join lente).

### Come viene visualizzato il valore di un titolo
Indipendentemente da cosa contenga la proprietà titolo, il pannello esegue il rendering di una stringa. Una data viene formattata, un array viene concatenato (joined), e una relazione — che arriva come `{ id, data: { values } }` anziché come testo — viene analizzata per trovare il primo tra `name`, `title`, `label` o `displayName` nella riga correlata, poi per il suo primo valore stringa breve, tornando come fallback al suo id. Di conseguenza, un titolo può fare riferimento a una proprietà `relation` e continuare a essere letto come un nome piuttosto che come un uuid.

Questo non è un helper esportato: è ciò che ogni superficie che visualizza un record fa già. Non c'è nulla da chiamare né da importare.

## Collection Builder

Per collezioni dinamiche che cambiano in base all'utente o a dati esterni, usa una funzione builder:

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

Il builder riceve anche `data`, che legge le righe così come le invia il server, esattamente come `context.data`: `await data.collection("tenants").find()` si risolve in `{ data: rows, meta }`.

## Filtri e ordinamento

È possibile impostare filtri predefiniti o forzati. Tutti e tre riguardano la presentazione — ciò con cui si apre il pannello — quindi risiedono in `admin`:

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

L'utente può comunque filtrare una collezione che presenta un `fixedFilter`: qualsiasi filtro applichi su altri campi viene combinato con esso (AND), e i campi fissi rimangono bloccati.

Un `fixedFilter` limita ciò che il pannello *richiede*; non costituisce un limite di sicurezza. Ciò che un chiamante è autorizzato a leggere è definito da una [regola di sicurezza](/docs/collections/security-rules), che il database applica per ogni chiamante, che si tratti del pannello o meno.

## Molte collezioni

Nulla in Rebase limita il numero di collezioni, ma con la loro crescita aumentano due costi:

- **Il primo download dell'admin.** Il pannello ha bisogno della navigazione nell'istante in cui qualcuno effettua l'accesso, quindi la configurazione di ogni collezione viene inclusa in ciò che il browser scarica per la schermata di login — circa 2,4 KB minificati ciascuna, quindi 200 collezioni aggiungono circa 480 KB, circa 80 KB compressi con gzip. Ciò che serve all'apertura di una collezione (la tabella, le viste dei record, il form) viene caricato solo in quel momento.
- **`rebase db push`.** Atlas pianifica un push confrontando l'intero schema, e questo processo cresce più velocemente rispetto al conteggio delle tabelle: con 400 o più tabelle un push richiede decine di secondi — vedi [quanto dura un push](/docs/cli/schema#rebase-db-push).

## Passaggi successivi

- **[Callback delle entità](/docs/collections/callbacks)** — Hook del ciclo di vita per sincronizzare i dati tra collezioni, validazione, effetti collaterali
- **[Proprietà](/docs/collections/properties)** — Tutti i tipi di proprietà e opzioni
- **[Relazioni](/docs/collections/relations)** — Chiavi esterne, tabelle di giunzione, join
- **[Regole di sicurezza](/docs/collections/security-rules)** — Row Level Security
- **[Modalità di visualizzazione](/docs/frontend/view-modes)** — Elenco, Tabella, Schede, Kanban
