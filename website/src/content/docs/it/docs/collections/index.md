---
sourceHash: 8bade8e09da44b98
title: Collezioni
sidebar_label: Collezioni
description: Le collezioni sono l'elemento fondamentale di Rebase — ogni collezione mappa una tabella di database e ne definisce schema, relazioni, sicurezza e comportamento dell'interfaccia utente.
---

## Cos'è una Collezione?

Una **collezione** è un oggetto TypeScript che descrive una tabella di database e come dovrebbe apparire in Rebase CMS. Definisce:

- **Schema** — Proprietà (colonne), i loro tipi e regole di validazione
- **Relazioni** — Chiavi esterne (foreign key), tabelle di giunzione (junction table) e percorsi di join
- **Sicurezza** — Criteri di Row Level Security (RLS)
- **Hook del ciclo di vita** — Callback per le operazioni di creazione, aggiornamento ed eliminazione
- **Comportamento nel CMS** — Modalità di visualizzazione, modifica inline, viste di dettaglio dell'entità, azioni — tutto all'interno di `admin`

## Dichiararne una: `defineCollection`

Avvolgi il letterale in `defineCollection`. A runtime è la funzione identità — restituisce
l'oggetto invariato — quindi non costa nulla. Il suo vantaggio è l'inferenza: un parametro
di tipo `const` cattura le chiavi delle tue `properties` come tipi letterali, e i campi conformi
alle chiavi del blocco `admin` vengono poi verificati rispetto ad esse. Un nome che non corrisponde
a una delle tue proprietà è un **errore di compilazione**, non solo un suggerimento mancante.

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

I campi verificati sono `display`, `sort`, `propertiesOrder` e `listProperties`.
Oltre a una semplice chiave di proprietà, sono accettate tre forme:

| Formato | Esempio | Note |
| --- | --- | --- |
| Percorso con notazione a punti in una `map` | `"profile.displayName"` | La **radice** deve essere una proprietà reale; il percorso sottostante non viene verificato. |
| Colonna di una sotto-collezione | `"subcollection:orders"` | Solo per `propertiesOrder` / `listProperties`. |
| Una chiave di `additionalFields` | `"score" as AdditionalFieldKey` | Richiede il cast — vedi sotto. |

`AdditionalFieldDelegate.key` è una semplice `string`, quindi il sistema di tipi non ha modo
di sapere quali chiavi extra dichiari una collezione. Piuttosto che riaprire questi campi a
qualsiasi stringa, il cast rende l'eccezione esplicita:

```typescript
import type { AdditionalFieldKey } from "@rebasepro/cms-types";

propertiesOrder: ["title", "score" as AdditionalFieldKey]
```

Importalo da `@rebasepro/cms-types` in un progetto che dispone di un pannello di amministrazione — è
quella la copia che controlla anche i tipi del blocco `admin`. Un progetto BaaS headless, che non
ha un blocco admin, importa la stessa funzione da `@rebasepro/common`.

Annotare il tipo direttamente funziona ancora e viene comunque verificato:

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

ma un'annotazione *valida solo la struttura (shape)* — non può vedere i nomi delle tue proprietà,
quindi i campi chiave di `admin` tornano ad accettare qualsiasi stringa. È preferibile usare
`defineCollection` a meno che tu non abbia bisogno di assegnare un nome al tipo.

:::note
`buildCollection` e `buildProperty` non esistono più. `buildCollection` è
`defineCollection` senza l'inferenza; `buildProperty` avvolgeva una proprietà in un tipo che
già possedeva. Consulta il [changelog](/docs/changelog) per la migrazione in un'unica riga.
:::

## Anatomia: il contratto e il pannello

Un file, due destinatari. Tutto ciò che interessa al *database e all'API* si trova al
livello principale; tutto ciò che viene renderizzato dal *pannello di amministrazione* si trova all'interno di `admin`.

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

- Un progetto **BaaS o headless** non scrive mai un blocco `admin`. Le sue collezioni — o nessuna
  collezione, poiché la modalità BaaS esegue l'introspezione del database — descrivono dati e
  autorizzazioni, nient'altro. `@rebasepro/types` non include codice UI, quindi l'albero delle
  dipendenze di un progetto headless rimane limitato al server.
- Il **backend non legge mai all'interno del blocco**. Viene rimosso prima che una collezione venga
  serializzata per l'endpoint del contratto o in un bundle di build, ed è escluso dalla versione
  dello schema — perciò cambiare un'icona non segnala ogni SDK generato come obsoleto.

### Il blocco `admin` esiste solo se installi i tipi admin

`@rebasepro/types` non dichiara alcun campo `admin` — né su una collezione, né su una proprietà. In
un progetto BaaS, scriverne uno genera un **errore di tipo**. `@rebasepro/cms-types` lo aggiunge tramite
declaration merging, quindi basta una riga per progetto per abilitarlo:

```typescript no-verify
// config/cms.d.ts
/// <reference types="@rebasepro/cms-types" />
```

Successivamente, i tipi base del core includeranno un blocco completamente tipizzato — un refuso come `icoon` è un errore,
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
Un'augmentation si applica all'intero *programma* TypeScript, e `config/` e `frontend/`
sono programmi separati — motivo per cui il riferimento appartiene al pacchetto config. Non
esiste un tipo wrapper `AdminCollectionConfig`: con il campo unito, `CollectionConfig`
è il tipo di creazione (authoring type).

:::note[Perché un progetto BaaS non ha costi aggiuntivi]
Il tipo di una proprietà in un'installazione BaaS non ha `Field`, né `columnWidth`, né
`hideFromCollection` — questi risiedono in `AdminPropertyOptions` nel pacchetto admin. La
garanzia viene verificata tramite asserzione, non solo dichiarata: `e2e/baas-typecheck/src/admin_absent.ts` usa
`@ts-expect-error` su `admin`, quindi la compilazione fallisce se il campo dovesse mai tornare scrivibile nel
core.
:::

### Migrazione da una collezione flat

Prima della versione 0.11 questi campi si trovavano al livello principale. Per spostarli:

```bash
node scripts/codemod/collections-admin-block.mjs config/collections
```

Segnala qualsiasi elemento che non può spostare in modo sicuro — in particolare la presentazione all'interno di
`relations[].overrides`, che richiede `overrides: { admin: { … } }` manualmente.

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

## Proprietà Principali

### Identificazione

| Proprietà | Tipo | Descrizione |
|----------|------|-------------|
| `slug` | `string` | **Obbligatorio.** Identificatore compatibile con gli URL. Usato nell'URL dell'interfaccia di amministrazione e nel percorso dell'API REST (`/api/data/{slug}`). |
| `name` | `string` | **Obbligatorio.** Nome visualizzato (plurale). Mostrato nella navigazione e nelle intestazioni delle pagine. |
| `singularName` | `string` | Nome visualizzato per una singola entità. Usato in "Nuovo prodotto", "Modifica prodotto", ecc. |
| `description` | `string` | Una frase che descrive il contenuto di questa collezione, mostrata sopra l'elenco. Markdown. |
| `table` | `string` | Nome della tabella PostgreSQL. Il valore predefinito è `toSnakeCase(slug)` — impostalo solo per disaccoppiare l'URL dalla tabella, ad es. una tabella `blog_posts` esistente servita su `/posts`. |
| `admin.icon` | `string` | Il nome di un'icona [Lucide](https://lucide.dev/icons), ad es. `"FileText"`, `"ShoppingCart"`. Funziona anche un elemento renderizzato, ma il nome sopravvive alla serializzazione, quindi è ciò che l'editor di schemi riscrive. |

### Schema

| Proprietà | Tipo | Descrizione |
|----------|------|-------------|
| `properties` | `Properties` | **Obbligatorio.** Mappa di chiave proprietà → definizione proprietà. Ogni chiave diventa una colonna del database. |
| `relations` | `Relation[]` | Relazioni SQL — chiavi esterne, tabelle di giunzione. Vedi [Relazioni](/docs/collections/relations). |
| `securityRules` | `SecurityRule[]` | Criteri di Row Level Security. Vedi [Regole di Sicurezza](/docs/collections/security-rules). |
| `indexes` | `CollectionIndex[]` | Indici Postgres di cui questa tabella ha bisogno. Vedi [Indici](/docs/backend/indexes). |
| `search` | `SearchConfig` | Ricerca full-text con ranking sui campi specificati, inclusi i contenuti JSONB e gli array. Solo Postgres. Vedi [Ricerca](/docs/backend/search). |
| `auth` | `boolean \| AuthCollectionConfig` | Contrassegna la collezione come collezione di autenticazione (gestione utenti, reimpostazione password, ecc.) |
| `schema` | `string` | Schema Postgres in cui risiede la tabella — `"public"`, `"rebase"`, `"auth"`. Predefinito: `"public"`. |
| `disableDefaultPolicies` | `boolean` | Rimuove i criteri di base inseriti dal generatore — una SELECT admin/server e, su una collezione auth, una lettura per se stessi più un controllo di scrittura per soli admin — e assume la piena responsabilità della RLS per questa collezione. `false` per impostazione predefinita. Vedi [Regole di Sicurezza](/docs/collections/security-rules). |
| `softDelete` | `boolean \| { field?: string }` | Converte il comando `delete` in un timestamp e nasconde le righe contrassegnate da ogni lettura. `true` usa `deletedAt`; la forma a oggetto rinomina il campo. La collezione deve dichiarare direttamente tale proprietà `date`. Solo Postgres — vedi [Soft delete](/docs/collections/soft-delete). |
| `strictWrites` | `boolean` | Rifiuta con un errore 400 una scrittura che specifica un campo non dichiarato da questa collezione. `true` per impostazione predefinita. Impostalo su `false` solo quando la colonna esiste realmente ma non è dichiarata — popolata da un trigger, o derivata da introspezione anziché definita esplicitamente. |

### Configurazione della UI

Tutti i seguenti parametri vanno all'interno di `admin`.

| Proprietà | Tipo | Predefinito | Descrizione |
|----------|------|---------|-------------|
| `defaultViewMode` | `"list" \| "table" \| "cards" \| "kanban"` | `"list"` | Modalità di visualizzazione predefinita |
| `enabledViews` | `ViewMode[]` | Tutte e quattro | Modalità di visualizzazione disponibili |
| `kanban` | `KanbanConfig` | — | Configurazione Kanban (proprietà della colonna). Da abbinare sempre a `orderProperty` — vedi [Modalità di Visualizzazione](/docs/frontend/view-modes) |
| `orderProperty` | `string` | — | Chiave della proprietà di tipo **string** che memorizza la chiave di ordinamento drag-and-drop. Obbligatoria per il corretto funzionamento di una bacheca Kanban |
| `openEntityMode` | `"side_panel" \| "full_screen" \| "split" \| "dialog"` | `"full_screen"` | Modalità di apertura delle entità per la modifica |
| `sideDialogWidth` | `number \| string` | — | Larghezza del pannello laterale (side dialog) |
| `inlineEditing` | `boolean` | `true` | Abilita la modifica inline nella vista a foglio di calcolo |
| `defaultSize` | `"xs" \| "s" \| "m" \| "l" \| "xl"` | `"m"` | Altezza riga predefinita nella tabella |
| `pagination` | `boolean \| number` | `true` (50) | Abilita la paginazione e/o imposta la dimensione della pagina |
| `listProperties` | `string[]` | — | Proprietà da mostrare nella vista a elenco |
| `propertiesOrder` | `string[]` | — | Ordine delle colonne nella vista a tabella |
| `selectionEnabled` | `boolean` | `true` | Abilita la selezione delle righe |
| `hideFromNavigation` | `boolean` | `false` | Nascondi dalla barra laterale di navigazione |
| `defaultSelectedView` | `string \| function` | — | Vista o sotto-collezione predefinita da aprire |

### Opzioni delle Entità

All'interno di `admin`, tranne `history`, che è una funzionalità di backend e rimane al livello principale.

| Proprietà | Tipo | Predefinito | Descrizione |
|----------|------|---------|-------------|
| `formAutoSave` | `boolean` | `false` | Salvataggio automatico alla modifica del campo |
| `localChangesBackup` | `"manual_apply" \| "auto_apply" \| false` | `"manual_apply"` | Backup delle modifiche non salvate |
| `hideIdFromForm` | `boolean` | `false` | Nasconde l'ID dell'entità dal form |
| `hideIdFromCollection` | `boolean` | `false` | Nasconde la colonna ID dalla tabella |
| `includeJsonView` | `boolean` | `true` | Mostra i valori grezzi nell'inspector del record |
| `history` | `boolean` | `false` | Traccia le modifiche nella cronologia dell'entità |
| `alwaysApplyDefaultValues` | `boolean` | `false` | Applica i valori predefiniti a ogni salvataggio |
| `previewProperties` | `string[]` | — | Proprietà da visualizzare nelle anteprime dei riferimenti |
| `display` | `EntityDisplay` | — | Cosa valorizza ciascun ruolo di visualizzazione — vedi [Visualizzazione dell'entità](#visualizzazione-dellentità) |

### Avanzate

Al livello principale, poiché il backend li legge:

| Proprietà | Tipo | Descrizione |
|----------|------|-------------|
| `callbacks` | `CollectionCallbacks` | Hook del ciclo di vita (`beforeSave`, `afterSave`, `beforeDelete`, ecc.) |
| `childCollections` | `() => CollectionConfig[]` | Le collezioni annidate sotto un'entità di questa. Popolato durante la normalizzazione a partire da qualsiasi costrutto utilizzato dal driver — `subcollections` in Firestore, una relazione `hasMany` in Postgres — quindi un driver personalizzato è l'unico motivo per impostarlo manualmente |
| `dataSource` | `string` | Quale origine dati registrata supporta questa collezione (predefinita: quella senza nome) |
| `engine` | `string` | Il motore sottostante — `"postgres"`, `"firestore"`, `"mongodb"`. Risolto da `dataSource`; impostalo solo per sovrascriverlo |
| `databaseId` | `string` | Database o schema all'interno del motore |
| `metadata` | `Record<string, unknown>` | Qualsiasi informazione aggiuntiva di cui il tuo codice ha bisogno da associare a una collezione. Rebase non la legge; viene preservata immutata durante la serializzazione |
| `ownerId` | `string` | **Solo per il form admin — non applicato dall'API o dal database.** L'ID utente che l'editor di collezioni assegna alla collezione che crea, e mostra accanto al suo nome. Nulla nel percorso di gestione delle richieste lo consulta |

`subcollections` e `path` sono presenti solo nelle configurazioni dei **database orientati ai documenti** —
`FirebaseCollectionConfig` e, per `path`, `MongoDBCollectionConfig`:

| Proprietà | Tipo | Descrizione |
|----------|------|-------------|
| `subcollections` | `() => CollectionConfig[]` | **Solo Firestore.** Collezioni annidate sotto ciascun documento. Una collezione Postgres esprime la stessa cosa con una [relazione](/docs/collections/relations) `hasMany`, che è ciò che popola `childCollections` |
| `path` | `string` | **Solo Firestore e MongoDB.** Il percorso o nome della collezione nel motore, quando differisce dallo slug |

E all'interno di `admin`, poiché solo il pannello li renderizza:

| Proprietà | Tipo | Descrizione |
|----------|------|-------------|
| `admin.entityActions` | `EntityAction[]` | Azioni personalizzate sulle entità (archivia, pubblica, ecc.) |
| `admin.Actions` | `React.ComponentType` | Componente personalizzato per le azioni della barra degli strumenti |
| `admin.entityViews` | `EntityCustomView[]` | Schede personalizzate nella vista di dettaglio dell'entità |
| `admin.additionalFields` | `AdditionalFieldDelegate[]` | Colonne calcolate/virtuali |
| `admin.exportable` | `boolean \| ExportConfig` | Abilita l'esportazione dei dati |
| `admin.components` | `CollectionComponentOverrideMap` | Override dei componenti UI con ambito limitato alla collezione |

Scrivere uno qualsiasi di questi sei al livello principale genera un errore all'avvio, con un messaggio
che indica la chiave e dove è stata spostata.

## Visualizzazione dell'entità

Ogni superficie che disegna un record mostra un sottoinsieme di sei ruoli: **title**,
**subtitle**, **image**, **status**, **date** e **tags**. Una riga di elenco è image +
title + subtitle + status + date, una card è lo stesso con l'immagine in alto, un
selettore di riferimenti è title + subtitle, e l'intestazione di una pagina è solo il title.

Ciascun ruolo è derivato dalle tue proprietà, e ciascuno può essere specificato esplicitamente — come
percorso di una proprietà, o come funzione:

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

Tutto ciò che tralasci mantiene il suo valore derivato, quindi specificare un ruolo non
implica doverli definire tutti e sei.

### Ruoli calcolati e asincroni

Un resolver può essere `async`, consentendo a un ruolo di leggere dati non presenti
nel record stesso — un documento in una sotto-collezione, un valore accessibile tramite API:

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

Mentre la promise è in corso, l'interfaccia mostra il valore derivato e lo sostituisce con
quello risolto non appena arriva — un titolo non mostrerà mai uno spinner di caricamento. I risultati
vengono memorizzati nella cache per record e per ruolo, e richieste concorrenti per la stessa coppia
condividono un'unica chiamata; in questo modo, un elenco di cinquanta righe risolve ogni riga una sola
volta anziché a ogni rendering.

Restituisci `undefined` quando un record non ha alcun dato per quel ruolo; il fallback nativo
dell'interfaccia è più indicato per gestire ciò che deve apparire al suo posto (un'intestazione
usa il nome singolare della collezione, un link usa l'ID). Un resolver che genera un'eccezione viene
trattato come `undefined` e registrato nei log una sola volta — un titolo che non può essere recuperato
non deve compromettere l'intera riga che lo visualizza.

Prediligi un percorso (path) ogni volta che il valore è presente nel record: un percorso mantiene il
rendering specifico della proprietà, quindi uno stato enum rimane un badge colorato e una data rimane
formattata, cosa che un resolver che restituisce una stringa semplice non può esprimere.

:::note[Sostituito `titleProperty`]
`admin.titleProperty` è stato rimosso a favore di `admin.display.title`. La stessa
stringa funziona anche lì, e il nuovo campo accetta anche un resolver. Una collezione che include
ancora la vecchia chiave viene rifiutata da `defineCollection` con il consueto errore di chiave
sconosciuta.
:::

### Selezione della proprietà Title
Quando `display.title` non è impostato, la proprietà utilizzata come titolo di visualizzazione dell'entità (anteprime, intestazioni) viene risolta automaticamente:
1. Se `propertiesOrder` è definito esplicitamente, la prima proprietà diversa da ID che sia di tipo `relation` o `string` viene scelta come titolo.
2. Se non è definito alcun `propertiesOrder`, il framework esamina le proprietà in ordine e sceglie la prima proprietà di tipo string.

### Anteprime delle relazioni nelle tabelle
Quando `propertiesOrder` è impostato esplicitamente, le proprietà di tipo relazione **non** vengono filtrate automaticamente dalle colonne di anteprima predefinite (mentre vengono escluse dai valori predefiniti non ordinati per evitare operazioni di join lente).

### Come viene renderizzato il valore di un titolo
Qualunque cosa contenga la proprietà title, il pannello renderizza una stringa. Una data viene formattata, un array viene unito, e una relazione — che arriva come `{ id, data: { values } }` anziché come testo — viene ispezionata cercando il primo tra `name`, `title`, `label` o `displayName` sulla riga correlata, tornando al suo ID come fallback. Di conseguenza, un titolo può fare riferimento a una proprietà `relation` e continuare a essere visualizzato come un nome anziché come uno uuid.

Questo non è un helper esportato: è ciò che fa già ogni superficie che renderizza un record. Non c'è nulla da chiamare, e nulla da importare.

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

## Filtraggio e Ordinamento

Puoi impostare filtri predefiniti o forzati. Entrambi riguardano la presentazione — ciò con
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

        // Fixed filter — cannot be changed
        fixedFilter: { tenantId: ["==", currentTenantId] },

        // Default sort
        sort: ["createdAt", "desc"]
    }
});
```

Un `fixedFilter` restringe ciò che il pannello *richiede*; non è una barriera di sicurezza. Ciò che un
chiamante è autorizzato a leggere è una [regola di sicurezza](/docs/collections/security-rules),
che il database applica per ogni chiamante, che utilizzi il pannello o meno.

## Passaggi Successivi

- **[Callback dell'Entità](/docs/collections/callbacks)** — Hook del ciclo di vita per sincronizzare i dati tra collezioni, validazione, effetti collaterali
- **[Proprietà](/docs/collections/properties)** — Tutti i tipi di proprietà e opzioni
- **[Relazioni](/docs/collections/relations)** — Chiavi esterne, tabelle di giunzione, join
- **[Regole di Sicurezza](/docs/collections/security-rules)** — Row Level Security
- **[Modalità di Visualizzazione](/docs/frontend/view-modes)** — List, Table, Cards, Kanban
