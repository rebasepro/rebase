---
title: Collezioni
sidebar_label: Collezioni
description: Le collezioni sono i blocchi costitutivi fondamentali di Rebase — ogni collezione mappa una tabella di database e ne definisce lo schema, le relazioni, la sicurezza e il comportamento dell'interfaccia utente.
---

## Cos'è una Collezione?

Una **collezione** è un oggetto TypeScript che descrive una tabella di database e come dovrebbe apparire nell'interfaccia utente di amministrazione. Essa definisce:

-   **Schema** — Proprietà (colonne), i loro tipi e regole di validazione
-   **Relazioni** — Chiavi esterne, tabelle di congiunzione e percorsi di join
-   **Sicurezza** — Policy di Row Level Security
-   **Comportamento dell'interfaccia utente** — Modalità di visualizzazione, modifica inline, viste entità, azioni
-   **Hook del ciclo di vita** — Callback per operazioni di creazione, aggiornamento, eliminazione

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
            readOnly: true
        }
    },
    admin: {
        icon: "inventory_2"           // Material icon key
    }
});

```

## Dichiararne una: `defineCollection`

Racchiudi il literal in `defineCollection`. A runtime è la funzione identità — restituisce l'oggetto invariato — quindi non costa nulla. Ciò che offre è l'inferenza: un parametro di tipo `const` cattura le chiavi di `properties` come tipi literal, ed è questo che le porta nel completamento dell'editor per `admin.display`, `admin.sort` e `admin.propertiesOrder`.

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
        display: { title: "name" },   // completamento: "name" | "price"
        sort: ["price", "asc"]   // completamento sul primo elemento
    }
});
```

Importala da `@rebasepro/cms-types` in un progetto con pannello di amministrazione — è la copia che controlla anche il blocco `admin`. Un progetto BaaS headless, senza blocco `admin` e senza React, importa la stessa funzione da `@rebasepro/common`.

Annotare direttamente il tipo funziona ancora ed è ancora controllato:

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

Ma un'annotazione si limita a *validare* l'oggetto — non vede i nomi delle tue proprietà, quindi non ottieni completamento. Preferisci `defineCollection`, a meno che tu non debba nominare il tipo.

:::note
`buildCollection` e `buildProperty` non esistono più. `buildCollection` è `defineCollection` senza l'inferenza; `buildProperty` avvolgeva una proprietà in un tipo che aveva già. Vedi il [changelog](/docs/changelog) per la migrazione in una riga.
:::

## Proprietà Chiave

### Identificazione

| Proprietà | Tipo | Descrizione |
|----------|------|-------------|
| `slug` | `string` | **Obbligatorio.** Identificatore URL-safe. Utilizzato nell'URL dell'interfaccia utente di amministrazione e nel percorso dell'API REST (`/api/data/{slug}`). |
| `name` | `string` | **Obbligatorio.** Nome visualizzato (plurale). Mostrato nella navigazione e nelle intestazioni delle pagine. |
| `singularName` | `string` | Nome visualizzato per una singola entità. Utilizzato in "Nuovo Prodotto", "Modifica Prodotto", ecc. |
| `table` | `string` | **Obbligatorio.** Nome della tabella PostgreSQL. Se diverso da `slug`, permette di disaccoppiare gli URL dai nomi delle tabelle. |
| `admin.icon` | `string` | Chiave dell'icona Material. Vedi [Google Fonts Icons](https://fonts.google.com/icons). |

### Schema

| Proprietà | Tipo | Descrizione |
|----------|------|-------------|
| `properties` | `Properties` | **Obbligatorio.** Mappa della chiave di proprietà → definizione della proprietà. Ogni chiave diventa una colonna del database. |
| `relations` | `Relation[]` | Relazioni SQL — chiavi esterne, tabelle di congiunzione. Vedi [Relazioni](/docs/collections/relations). |
| `securityRules` | `SecurityRule[]` | Policy di Row Level Security. Vedi [Regole di Sicurezza](/docs/collections/security-rules). |
| `indexes` | `CollectionIndex[]` | Indici Postgres di cui questa tabella ha bisogno. Vedi [Indici](/docs/backend/indexes). |
| `search` | `SearchConfig` | Ricerca full-text con ranking sui campi che indichi, inclusi i contenuti JSONB e array. Solo Postgres. Vedi [Ricerca](/docs/backend/search). |
| `auth` | `boolean \| AuthCollectionConfig` | Contrassegna la collezione come collezione di autenticazione (gestione utenti, reimpostazione password, ecc.) |

### Configurazione dell'interfaccia utente

Tutti i campi seguenti vanno dentro `admin`.

| Proprietà | Tipo | Predefinito | Descrizione |
|----------|------|---------|-------------|
| `defaultViewMode` | `"list" \| "table" \| "cards" \| "kanban"` | `"table"` | Modalità di visualizzazione predefinita |
| `enabledViews` | `ViewMode[]` | Tutte e quattro | Quali modalità di visualizzazione sono disponibili |
| `kanban` | `KanbanConfig` | — | Configurazione Kanban (proprietà colonna). Va sempre abbinata a `orderProperty` — vedi [Modalità di visualizzazione](/docs/frontend/view-modes) |
| `orderProperty` | `string` | — | Chiave della proprietà **string** che contiene la chiave di ordinamento drag-and-drop. Necessaria perché una board Kanban funzioni |
| `openEntityMode` | `"side_panel" \| "full_screen" \| "split"` | `"full_screen"` | Come le entità si aprono per la modifica |
| `sideDialogWidth` | `number \| string` | — | Larghezza della finestra di dialogo laterale |
| `inlineEditing` | `boolean` | `true` | Abilita la modifica inline nella vista a foglio di calcolo |
| `defaultSize` | `"xs" \| "s" \| "m" \| "l" \| "xl"` | `"m"` | Altezza predefinita della riga nella tabella |
| `pagination` | `boolean \| number` | `true` (50) | Abilita la paginazione e/o imposta la dimensione della pagina |
| `listProperties` | `string[]` | — | Proprietà da visualizzare nella vista elenco |
| `propertiesOrder` | `string[]` | — | Ordine delle colonne nella vista tabella |
| `selectionEnabled` | `boolean` | `true` | Abilita la selezione delle righe |
| `hideFromNavigation` | `boolean` | `false` | Nascondi dalla navigazione della barra laterale |
| `defaultSelectedView` | `string \| function` | — | Vista o sottocollezione predefinita da aprire |

### Opzioni Entità

Dentro `admin`, tranne `history`, che è una funzionalità del backend e resta al livello superiore.

| Proprietà | Tipo | Predefinito | Descrizione |
|----------|------|---------|-------------|
| `formAutoSave` | `boolean` | `false` | Salvataggio automatico alla modifica del campo |
| `localChangesBackup` | `"manual_apply" \| "auto_apply" \| false` | `"manual_apply"` | Backup delle modifiche non salvate |
| `hideIdFromForm` | `boolean` | `false` | Nasconde l'ID dell'entità dal modulo |
| `hideIdFromCollection` | `boolean` | `false` | Nasconde la colonna ID dalla tabella |
| `includeJsonView` | `boolean` | `true` | Offre i valori grezzi nell'ispettore del record |
| `history` | `boolean` | `false` | Traccia le modifiche nella cronologia dell'entità |
| `alwaysApplyDefaultValues` | `boolean` | `false` | Applica i valori predefiniti ad ogni salvataggio |
| `previewProperties` | `string[]` | — | Proprietà da visualizzare nelle anteprime di riferimento |
| `display` | `EntityDisplay` | — | Cosa riempie ogni ruolo di visualizzazione — `title`, `subtitle`, `image`, `status`, `date`, `tags` |

### Avanzate

| Proprietà | Tipo | Descrizione |
|----------|------|-------------|
| `callbacks` | `CollectionCallbacks` | Hook del ciclo di vita (`beforeSave`, `afterSave`, `beforeDelete`, ecc.) |
| `entityActions` | `EntityAction[]` | Azioni personalizzate sulle entità (archivia, pubblica, ecc.) |
| `Actions` | `React.ComponentType` | Componente per azioni personalizzate della barra degli strumenti |
| `entityViews` | `EntityCustomView[]` | Schede personalizzate nella vista dettagli dell'entità |
| `additionalFields` | `AdditionalFieldDelegate[]` | Colonne calcolate/virtuali |
| `childCollections` | `() => CollectionConfig[]` | Collezioni figlio annidate |
| `subcollections` | `() => CollectionConfig[]` | Collezioni annidate (es. ordine → voci d'ordine) |
| `exportable` | `boolean \| ExportConfig` | Abilita l'esportazione dei dati |
| `ownerId` | `string` | ID utente proprietario (usato da plugin/codice personalizzato) |
| `overrides` | `EntityOverrides` | Override per la vista entità |
| `driver` | `string` | Driver di database da usare (predefinito: `"(default)"`) |
| `databaseId` | `string` | ID database/schema all'interno del driver |

## Costruttore di Collezioni

Per collezioni dinamiche che cambiano in base all'utente o a dati esterni, usa una funzione costruttore:

```typescript
const collectionsBuilder: CollectionConfigsBuilder = ({ user, authController }) => {
    const collections = [productsCollection];

    if (authController.extra?.role === "admin") {
        collections.push(adminSettingsCollection);
    }

    return collections;
};
```

## Filtraggio e Ordinamento

Puoi impostare filtri predefiniti o forzati:

```typescript
{
    // Default filter — users can change it
    filter: { active: ["==", true] },

    // Forced filter — cannot be changed
    forceFilter: { tenant_id: ["==", currentTenantId] },

    // Default sort
    sort: ["createdAt", "desc"]
}
```

## Passi Successivi

-   **[Callback delle Entità](/docs/collections/callbacks)** — Hook del ciclo di vita per sincronizzare i dati tra collezioni, validazione, effetti collaterali
-   **[Proprietà](/docs/collections/properties)** — Tutti i tipi e le opzioni delle proprietà
-   **[Relazioni](/docs/collections/relations)** — Chiavi esterne, tabelle di congiunzione, join
-   **[Regole di Sicurezza](/docs/collections/security-rules)** — Row Level Security
-   **[Modalità di Visualizzazione](/docs/frontend/view-modes)** — Elenco, Tabella, Carte, Kanban

---
