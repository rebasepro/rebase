---
sourceHash: 7bd4e27e22c6c53b
title: Collezioni
sidebar_label: Collezioni
description: Le collezioni sono l'elemento costitutivo fondamentale di Rebase — ogni collezione mappa una tabella di database e ne definisce schema, relazioni, sicurezza e comportamento dell'interfaccia utente.
---

## Che cos'è una collezione?

Una **collezione** (o **collection**) è un oggetto TypeScript che descrive una tabella di database e come deve apparire nell'interfaccia utente di amministrazione. Definisce:

- **Schema** — Proprietà (colonne), i relativi tipi e regole di validazione
- **Relazioni** — Chiavi esterne, tabelle di giunzione e percorsi di join
- **Sicurezza** — Criteri di Row Level Security
- **Hook del ciclo di vita** — Callback per le operazioni di creazione, aggiornamento ed eliminazione
- **Comportamento dell'interfaccia di amministrazione** — Modalità di visualizzazione, modifica inline, viste entità, azioni — tutto sotto `admin`

## Dichiararne una: `defineCollection`

Racchiudi il letterale in `defineCollection`. A runtime è una funzione identità — restituisce
l'oggetto invariato — quindi non comporta alcun costo. Ciò che offre è l'inferenza: un
parametro di tipo `const` cattura le chiavi di `properties` come tipi letterali, e i campi
a forma di chiave del blocco `admin` vengono controllati rispetto a esse. Un nome che non
fa parte delle tue proprietà diventa un **errore di compilazione**, non solo un suggerimento mancante.

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

I campi controllati sono `display`, `sort`, `propertiesOrder` e `listProperties`.
Oltre a una semplice chiave di proprietà, sono accettate tre forme:

| Forma | Esempio | Note |
| --- | --- | --- |
| Percorso con punti all'interno di una `map` | `"profile.displayName"` | La **radice** deve essere una proprietà reale; il percorso sottostante non viene controllato. |
| Colonna di una sotto-collezione | `"subcollection:orders"` | Solo `propertiesOrder` / `listProperties`. |
| Una chiave di `additionalFields` | `"score" as AdditionalFieldKey` | Richiede il cast — vedi sotto. |

`AdditionalFieldDelegate.key` è una semplice `string`, quindi il sistema di tipi non ha modo di sapere
quali chiavi extra dichiari una collezione. Piuttosto che riaprire questi campi a qualsiasi stringa,
il cast rende esplicita l'eccezione:

```typescript
import type { AdditionalFieldKey } from "@rebasepro/cms-types";

propertiesOrder: ["title", "score" as AdditionalFieldKey]
```

Importalo da `@rebasepro/cms-types` in un progetto dotato di un pannello di amministrazione — quella è
la copia che esegue anche il typecheck del blocco `admin`. Un progetto BaaS headless, privo di blocco
admin, importa invece la stessa funzione da `@rebasepro/common`.

Anche l'annotazione diretta del tipo continua a funzionare e viene comunque verificata:

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

tuttavia un'annotazione si limita a *validare la forma* — non può verificare i nomi delle proprietà,
quindi i campi chiave di `admin` ricadono nell'accettare qualsiasi stringa. Prediligi `defineCollection`
a meno che tu non abbia bisogno di specificare esplicitamente il tipo.

:::note
`buildCollection` e `buildProperty` non esistono più. `buildCollection` è `defineCollection`
senza l'inferenza; `buildProperty` avvolgeva una proprietà in un tipo che possedeva già.
Consulta il [changelog](/docs/changelog) per la procedura di migrazione in una sola riga.
:::

## Anatomia: il contratto e il pannello

Un unico file, due destinatari. Tutto ciò che riguarda il *database e l'API* si trova al
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

La separazione non è puramente estetica. È ciò che consente a Rebase di fungere da backend autonomo:

- Un progetto **BaaS o headless** non scrive mai un blocco `admin`. Le sue collezioni — o nessuna
  collezione, dato che la modalità BaaS esegue l'introspezione del database — descrivono dati e
  autorizzazioni, nient'altro. `@rebasepro/types` non include codice UI, quindi l'albero delle dipendenze
  di un progetto headless rimane limitato al server.
- Il **backend non legge mai l'interno del blocco**. Viene scartato prima che una collezione sia
  serializzata verso l'endpoint del contratto o all'interno di un bundle di build, ed è escluso dalla
  versione dello schema — in questo modo la modifica di un'icona non segnala ogni SDK generato come
  obsoleto.

### Il blocco `admin` esiste solo se si installano i tipi di amministrazione

`@rebasepro/types` non dichiara alcun campo `admin` — né su una collezione, né su una proprietà. In
un progetto BaaS, scriverne uno genera un **errore di tipo**. `@rebasepro/cms-types` lo aggiunge tramite
declaration merging, quindi basta una sola riga per progetto per abilitarlo:

```typescript no-verify
// config/cms.d.ts
/// <reference types="@rebasepro/cms-types" />
```

Dopodiché, i tipi base standard supportano un blocco completamente tipizzato — un errore di battitura come `icoon`
è un errore e si ottiene l'autocompletamento:

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
Un'augmentation si applica all'intero *programma* TypeScript, e `config/` e `frontend/`
sono programmi separati — motivo per cui il riferimento appartiene al pacchetto di configurazione. Non
esiste un tipo wrapper `AdminCollectionConfig`: con il campo unito tramite merging, `CollectionConfig`
è il tipo di definizione.

:::note[Perché un progetto BaaS non paga alcun costo]
Un tipo di proprietà in un'installazione BaaS non contiene `Field`, `columnWidth` o
`hideFromCollection` — questi risiedono in `AdminPropertyOptions` all'interno del pacchetto admin. La
garanzia è testata con asserzioni, non presunta: `e2e/baas-typecheck/src/admin_absent.ts` usa
`@ts-expect-error` su `admin`, quindi la build fallisce se il campo dovesse mai tornare scrivibile
nel core.
:::

### Migrazione da una collezione flat

Prima della versione 0.11 questi campi si trovavano al livello principale. Per spostarli:

```bash
node scripts/codemod/collections-admin-block.mjs config/collections
```

Lo script segnala qualsiasi elemento che non possa essere spostato in sicurezza — in particolare la presentazione
all'interno di `relations[].overrides`, che richiede l'aggiornamento manuale in `overrides: { admin: { … } }`.

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
        icon: "inventory_2"           // Material icon key
    }
});

```

## Proprietà principali

### Identificazione

| Proprietà | Tipo | Descrizione |
|----------|------|-------------|
| `slug` | `string` | **Obbligatorio.** Identificatore compatibile con gli URL. Utilizzato nell'URL dell'interfaccia di amministrazione e nel percorso dell'API REST (`/api/data/{slug}`). |
| `name` | `string` | **Obbligatorio.** Nome visualizzato (plurale). Mostrato nella navigazione e nelle intestazioni di pagina. |
| `singularName` | `string` | Nome visualizzato per una singola entità. Utilizzato in "Nuovo prodotto", "Modifica prodotto", ecc. |
| `description` | `string` | Una frase che descrive il contenuto di questa collezione, mostrata sopra l'elenco. Markdown. |
| `table` | `string` | Nome della tabella PostgreSQL. Il valore predefinito è `toSnakeCase(slug)` — impostalo solo per disaccoppiare l'URL dalla tabella, ad es. una tabella `blog_posts` esistente servita su `/posts`. |
| `admin.icon` | `string` | Un nome di icona [Lucide](https://lucide.dev/icons), ad es. `"FileText"`, `"ShoppingCart"`. È supportato anche un elemento renderizzato, ma il nome resiste alla serializzazione, quindi è ciò che l'editor di schemi riscrive. |

### Schema

| Proprietà | Tipo | Descrizione |
|----------|------|-------------|
| `properties` | `Properties` | **Obbligatorio.** Mappa di chiave proprietà → definizione proprietà. Ciascuna chiave diventa una colonna del database. |
| `relations` | `Relation[]` | Relazioni SQL — chiavi esterne, tabelle di giunzione. Consulta [Relazioni](/docs/collections/relations). |
| `securityRules` | `SecurityRule[]` | Criteri di Row Level Security. Consulta [Regole di sicurezza](/docs/collections/security-rules). |
| `indexes` | `CollectionIndex[]` | Indici Postgres richiesti da questa tabella. Consulta [Indici](/docs/backend/indexes). |
| `search` | `SearchConfig` | Ricerca full-text indicizzata sui campi specificati, inclusi i contenuti JSONB e array. Solo Postgres. Consulta [Ricerca](/docs/backend/search). |
| `auth` | `boolean \| AuthCollectionConfig` | Contrassegna la collezione come collezione di autenticazione (gestione utenti, reimpostazione password, ecc.) |
| `schema` | `string` | Schema Postgres in cui risiede la tabella — `"public"`, `"rebase"`, `"auth"`. Il valore predefinito è `"public"`. |
| `disableDefaultPolicies` | `boolean` | Rimuove i criteri di base inseriti dal generatore — una SELECT per admin/server e, su una collezione auth, una lettura autonoma più un vincolo di scrittura per soli admin — assumendo la piena responsabilità per l'RLS di questa collezione. `false` per impostazione predefinita. Consulta [Regole di sicurezza](/docs/collections/security-rules). |
| `softDelete` | `boolean \| { field?: string }` | Trasforma l'operazione `delete` in un timestamp e nasconde le righe con timestamp da ogni operazione di lettura. `true` utilizza `deletedAt`; la forma a oggetto consente di rinominare il campo. La collezione deve dichiarare autonomamente tale proprietà `date`. Solo Postgres — consulta [Soft delete](/docs/collections/soft-delete). |
| `strictWrites` | `boolean` | Rifiuta con un errore 400 qualsiasi scrittura che indichi un campo non dichiarato da questa collezione. `true` per impostazione predefinita. Impostalo su `false` solo se la colonna esiste realmente nel database ma non è dichiarata — ad esempio popolata da un trigger o ricavata per introspezione anziché definita a codice. |

### Configurazione UI

Tutte le seguenti opzioni vanno inserite all'interno di `admin`.

| Proprietà | Tipo | Predefinito | Descrizione |
|----------|------|---------|-------------|
| `defaultViewMode` | `"list" \| "table" \| "cards" \| "kanban"` | `"list"` | Modalità di visualizzazione predefinita |
| `enabledViews` | `ViewMode[]` | Tutte e quattro | Quali modalità di visualizzazione sono disponibili |
| `kanban` | `KanbanConfig` | — | Configurazione Kanban (proprietà colonna). Da associare sempre a `orderProperty` — consulta [Modalità di visualizzazione](/docs/frontend/view-modes) |
| `orderProperty` | `string` | — | Chiave della proprietà **string** contenente l'ordinamento tramite drag-and-drop. Obbligatoria per il corretto funzionamento della bacheca Kanban |
| `openEntityMode` | `"side_panel" \| "full_screen" \| "split" \| "dialog"` | `"full_screen"` | Modalità di apertura delle entità per la modifica |
| `sideDialogWidth` | `number \| string` | — | Larghezza della finestra di dialogo laterale |
| `inlineEditing` | `boolean` | `true` | Abilita la modifica inline nella vista a tabella/foglio di calcolo |
| `defaultSize` | `"xs" \| "s" \| "m" \| "l" \| "xl"` | `"m"` | Altezza predefinita delle righe nella tabella |
| `pagination` | `boolean \| number` | `true` (50) | Abilita la paginazione e/o imposta la dimensione della pagina |
| `listProperties` | `string[]` | — | Proprietà da visualizzare nella vista elenco |
| `propertiesOrder` | `string[]` | — | Ordine delle colonne nella vista tabella |
| `selectionEnabled` | `boolean` | `true` | Abilita la selezione delle righe |
| `hideFromNavigation` | `boolean` | `false` | Nasconde la collezione dalla navigazione nella barra laterale |
| `defaultSelectedView` | `string \| function` | — | Vista o sotto-collezione predefinita da aprire |

### Opzioni entità

All'interno di `admin`, a eccezione di `history`, che è una funzionalità di backend e rimane al livello principale.

| Proprietà | Tipo | Predefinito | Descrizione |
|----------|------|---------|-------------|
| `formAutoSave` | `boolean` | `false` | Salvataggio automatico alla modifica del campo |
| `localChangesBackup` | `"manual_apply" \| "auto_apply" \| false` | `"manual_apply"` | Backup delle modifiche non salvate |
| `hideIdFromForm` | `boolean` | `false` | Nasconde l'ID dell'entità dal modulo |
| `hideIdFromCollection` | `boolean` | `false` | Nasconde la colonna ID dalla tabella |
| `includeJsonView` | `boolean` | `true` | Mostra i valori grezzi nell'ispettore del record |
| `history` | `boolean` | `false` | Traccia le modifiche nella cronologia dell'entità |
| `alwaysApplyDefaultValues` | `boolean` | `false` | Applica i valori predefiniti a ogni salvataggio |
| `previewProperties` | `string[]` | — | Proprietà da visualizzare nelle anteprime dei riferimenti |
| `display` | `EntityDisplay` | — | Definisce cosa valorizza ciascun ruolo di visualizzazione — consulta [Visualizzazione delle entità](#entity-display) |

### Avanzate

Al livello principale, poiché vengono lette dal backend:

| Proprietà | Tipo | Descrizione |
|----------|------|-------------|
| `callbacks` | `CollectionCallbacks` | Hook del ciclo di vita (`beforeSave`, `afterSave`, `beforeDelete`, ecc.) |
| `childCollections` | `() => CollectionConfig[]` | Le collezioni nidificate sotto un'entità di questa. Popolato durante la normalizzazione a partire da qualsiasi meccanismo utilizzi il driver per esprimerle — un `subcollections` di Firestore, una relazione `hasMany` di Postgres — pertanto un driver personalizzato è l'unico motivo per impostarlo manualmente |
| `dataSource` | `string` | Quale data source registrata gestisce questa collezione (predefinito: quella senza nome) |
| `engine` | `string` | Il motore sottostante — `"postgres"`, `"firestore"`, `"mongodb"`. Risolto a partire da `dataSource`; impostalo solo per sovrascriverlo |
| `databaseId` | `string` | Database o schema all'interno del motore |
| `metadata` | `Record<string, unknown>` | Qualsiasi dato personalizzato che il tuo codice debba associare a una collezione. Rebase non lo legge; sopravvive invariato alla serializzazione |
| `ownerId` | `string` | **Solo per il modulo admin — non vincolante per l'API o il database.** L'ID utente che l'editor delle collezioni assegna a una collezione creata e mostra accanto al relativo nome. Nessun elemento nel flusso della richiesta lo consulta |

`subcollections` e `path` sono presenti solo nelle configurazioni per **database a documenti** —
`FirebaseCollectionConfig` e, per `path`, `MongoDBCollectionConfig`:

| Proprietà | Tipo | Descrizione |
|----------|------|-------------|
| `subcollections` | `() => CollectionConfig[]` | **Solo Firestore.** Collezioni nidificate sotto ciascun documento. Una collezione Postgres definisce la stessa cosa tramite una [relazione](/docs/collections/relations) `hasMany`, che si occupa di popolare `childCollections` |
| `path` | `string` | **Solo Firestore e MongoDB.** Il percorso o il nome della collezione nel motore, quando differisce dallo slug |

E all'interno di `admin`, poiché vengono visualizzate solo dal pannello:

| Proprietà | Tipo | Descrizione |
|----------|------|-------------|
| `admin.entityActions` | `EntityAction[]` | Azioni personalizzate sulle entità (archiviazione, pubblicazione, ecc.) |
| `admin.Actions` | `React.ComponentType` | Componente personalizzato per le azioni della barra degli strumenti |
| `admin.entityViews` | `EntityCustomView[]` | Schede personalizzate nella vista di dettaglio dell'entità |
| `admin.additionalFields` | `AdditionalFieldDelegate[]` | Colonne calcolate/virtuali |
| `admin.exportable` | `boolean \| ExportConfig` | Abilita l'esportazione dei dati |
| `admin.components` | `CollectionComponentOverrideMap` | Override dei componenti UI limitati all'ambito della collezione |

Scrivere una qualsiasi di queste sei proprietà al livello principale genera un errore in fase di avvio, con un messaggio che indica la chiave e la posizione in cui è stata spostata.

## Visualizzazione delle entità

Ogni interfaccia che disegna un record mostra un sottoinsieme di sei ruoli: **title**,
**subtitle**, **image**, **status**, **date** e **tags**. Una riga di elenco è composta da image +
title + subtitle + status + date, una card corrisponde alla stessa struttura con l'immagine in alto, un
selettore di riferimenti comprende title + subtitle, e l'intestazione di una pagina è costituita dal solo title.

Ciascun ruolo è derivato dalle tue proprietà, e ciascuno può essere specificato esplicitamente — tramite
un percorso di proprietà o una funzione:

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
            subtitle: ({ entity }) => `in ${entity.values.city}`   // computed
        }
    }
});
```

Tutti i ruoli non specificati mantengono il proprio valore derivato, quindi definirne uno
non obbliga a configurarli tutti e sei.

### Ruoli calcolati e asincroni

Un resolver può essere `async`, consentendo a un ruolo di recuperare informazioni non presenti
nel record — un documento in una sotto-collezione o un valore esposto da un'API:

```typescript
admin: {
    display: {
        // The exercise's name lives one document down, per locale.
        title: async ({ entity, context }) => {
            const locale = await context.data.exercise_locales.get(`${entity.id}/de-DE`);
            return locale?.exercise_title;
        }
    }
}
```

Mentre la promise è in sospeso, l'interfaccia mostra il valore derivato per poi sostituirlo
con quello risolto non appena disponibile — un titolo non si trasforma mai in uno spinner. I risultati
vengono memorizzati in cache per record e per ruolo, e le richieste concorrenti per la stessa coppia
condividono una singola chiamata: in questo modo, un elenco di cinquanta righe risolve ciascuna riga una
sola volta anziché a ogni render.

Restituisci `undefined` quando un record non ha valori per quel ruolo; il meccanismo di fallback nativo
dell'interfaccia saprà meglio cosa posizionarvi (un'intestazione userà il nome singolare della collezione,
un link userà l'id). Un resolver che genera un'eccezione viene trattato come `undefined` e registrato nei log
una sola volta — l'impossibilità di recuperare un titolo non deve bloccare la riga che lo visualizza.

Prediligi un percorso ogni volta che il valore si trova già nel record: un percorso preserva il rendering
nativo della proprietà, garantendo che uno stato enum rimanga un chip colorato e che una data rimanga
formattata, cosa che un resolver che restituisce una stringa semplice non può gestire.

:::note[Sostituzione di `titleProperty`]
`admin.titleProperty` è stato rimosso a favore di `admin.display.title`. La stessa stringa
continua a funzionare, e il nuovo campo accetta anche un resolver. Una collezione che contiene ancora la
vecchia chiave viene rifiutata da `defineCollection` con il consueto errore di chiave sconosciuta.
:::

### Selezione della proprietà del titolo
Quando `display.title` non è impostato, la proprietà utilizzata come titolo di visualizzazione dell'entità (anteprime, intestazioni) viene determinata automaticamente:
1. Se `propertiesOrder` è definito esplicitamente, la prima proprietà non-ID che sia di tipo `relation` o `string` viene scelta come titolo.
2. Se non è definito alcun `propertiesOrder`, il framework esamina le proprietà in ordine e sceglie la prima proprietà di tipo stringa.

### Anteprime delle relazioni nelle tabelle
Quando `propertiesOrder` è impostato esplicitamente, le proprietà di tipo relazione **non** vengono filtrate automaticamente dalle colonne di anteprima predefinite (mentre vengono escluse dalle viste predefinite non ordinate per evitare join lenti).

### Formato di renderizzazione del valore del titolo
Indipendentemente da ciò che contiene la proprietà del titolo, il pannello renderizza una stringa. Una data viene formattata, un array viene concatenato e una relazione — che arriva nella forma `{ id, data: { values } }` anziché come testo — viene ispezionata cercando il primo tra i campi `name`, `title`, `label` o `displayName` sulla riga correlata, con fallback al suo id. Di conseguenza, un titolo può indicare una proprietà `relation` e continuare a essere visualizzato come un nome anziché come un uuid.

Questo non è un helper esportato: è il comportamento predefinito di qualsiasi interfaccia che disegna un record. Non occorre invocare né importare nulla.

## Collection Builder

Per collezioni dinamiche che variano in base all'utente o a dati esterni, utilizza una funzione builder:

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

## Filtri e ordinamento

È possibile impostare filtri predefiniti o vincolanti. Poiché entrambi riguardano la presentazione — ovvero
lo stato iniziale all'apertura del pannello — vanno inseriti in `admin`:

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

        // Fixed filter — cannot be changed
        fixedFilter: { tenantId: ["==", currentTenantId] },

        // Default sort
        sort: ["createdAt", "desc"]
    }
});
```

Un `fixedFilter` restringe ciò che il pannello *richiede*; non costituisce una barriera di sicurezza. Ciò che un
chiamante è autorizzato a leggere è definito da una [regola di sicurezza](/docs/collections/security-rules),
che il database applica a ogni operazione, sia essa originata dal pannello o meno.

## Passaggi successivi

- **[Callback delle entità](/docs/collections/callbacks)** — Hook del ciclo di vita per sincronizzare dati tra collezioni, validazione ed effetti collaterali
- **[Proprietà](/docs/collections/properties)** — Tutti i tipi di proprietà e le relative opzioni
- **[Relazioni](/docs/collections/relations)** — Chiavi esterne, tabelle di giunzione, join
- **[Regole di sicurezza](/docs/collections/security-rules)** — Row Level Security
- **[Modalità di visualizzazione](/docs/frontend/view-modes)** — Elenco, Tabella, Card, Kanban

---
