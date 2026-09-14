---
sourceHash: 91344f4bf4cb8889
title: Sistema dei plugin
sidebar_label: Plugin
description: Estendi Rebase con i plugin — inserisci componenti UI, modifica collection, aggiungi azioni alla barra degli strumenti e crea field builder personalizzati.
---

## Panoramica

**I plugin sono un concetto relativo al pannello di amministrazione.** Vengono eseguiti nel browser, all'interno dell'admin React, e sono registrati nel punto in cui lo crei. Nulla in questa pagina raggiunge il backend: un plugin non può aggiungere una route, una callback o un cron job. Per questi, consulta [Custom Functions](/docs/backend/custom-functions), [Entity Callbacks](/docs/collections/callbacks) e [Cron Jobs](/docs/backend/cron-jobs).

I plugin costituiscono il meccanismo primario di estensione nel pannello. Possono:

- Avvolgere l'intera app con un **provider** (contesto, gestione dello stato)
- Aggiungere **azioni per la home page** e widget
- Inserire componenti per la **vista delle collection** (barra degli strumenti, column builder)
- Aggiungere componenti per i **form** (field builder, pannelli aggiuntivi)
- **Iniettare o modificare collection** in modo dinamico

## Interfaccia dei plugin

```typescript
interface RebasePlugin {
    key: string;                    // Unique identifier
    loading?: boolean;              // Hold admin content until the plugin is ready

    // UI contributions — a flat array, each entry naming its slot.
    // This replaced the old per-area objects (homePage, collectionView, form).
    slots?: SlotContribution[];

    // HOC providers. `scope: "root"` wraps the whole admin below
    // RebaseContext; `scope: "form"` wraps each entity form / edit view.
    providers?: PluginProvider[];

    // Behavioural (non-UI) hooks: collection modification and injection,
    // column reordering, navigation entries.
    hooks?: PluginHooks;

    // Custom field rendering (e.g. data enhancement).
    fieldBuilder?: FieldBuilderConfig;

    // Views added to the navigation automatically.
    views?: AppView[];

    lifecycle?: PluginLifecycle;
}
```

Ognuna di queste proprietà è facoltativa tranne `key`. L'elenco completo dei nomi degli slot è disponibile nella pagina **[Slots](/docs/frontend/slots)**.

## Utilizzo dei plugin

I plugin vengono passati a `<Rebase>`, accanto al client. Tutto ciò che si trova al di sotto di esso — la navigazione, le viste delle collection, i form — li legge da lì:

```tsx
import { Rebase, useRebaseAuthController } from "@rebasepro/app";
import { RebaseCMS, RebaseShell } from "@rebasepro/cms";
import { useDataEnhancementPlugin } from "@rebasepro/plugin-ai";

export function App() {
    const authController = useRebaseAuthController({ client });
    const dataEnhancementPlugin = useDataEnhancementPlugin();

    return (
        <Rebase
            client={client}
            authController={authController}
            plugins={[dataEnhancementPlugin]}
        >
            <RebaseCMS collections={collections}/>
            <RebaseShell title="My App"/>
        </Rebase>
    );
}
```

I plugin vengono solitamente creati tramite un hook, quindi l'array viene ricreato a ogni render; questo è normale ed è il motivo per cui `plugins` è una prop anziché qualcosa da memorizzare manualmente. Due plugin con la stessa `key` rappresentano un errore — `<Rebase>` registra i duplicati nei log anziché scartarne uno silenziosamente.

Per un singolo contributo non hai affatto bisogno di un plugin: `<Rebase slots>` accetta direttamente le stesse voci `SlotContribution`.

### In caso di composizione manuale

Solo se hai sostituito `<RebaseShell>` con i layer sottostanti, l'elenco dei plugin deve essere inoltrato manualmente al navigation controller:

```tsx
const navigationStateController = useBuildNavigationStateController({
    plugins,
    collections: () => collections,
    // These four are required — the controller resolves navigation against them.
    authController,
    data,
    collectionRegistryController,
    urlController
});
```

`<RebaseNavigation>` esegue esattamente questa chiamata per te, leggendo `plugins` dal customization controller fornito da `<Rebase>`. Consulta [Advanced: manual layout](/docs/frontend#advanced-manual-layout).

## Creazione di un plugin

Ecco un plugin minimale che aggiunge un'azione alla barra degli strumenti per ogni collection:

```tsx
import type { RebasePlugin } from "@rebasepro/cms-types";

function useMyPlugin(): RebasePlugin {
    return {
        key: "my_plugin",

        // `slots` is a flat array of contributions, each naming its slot.
        // See the Slots page for the full list of slot names.
        slots: [
            { slot: "collection.actions", Component: MyToolbarAction }
        ],

        // `fieldBuilder` is top-level and takes a `wrap` function that returns
        // a *component* (or null to leave the default field alone) — it is not
        // a render function and no longer lives under `form`.
        fieldBuilder: {
            wrap: ({ property }) =>
                property.propertyConfig === "my_custom_field" ? MyCustomField : null
        }
    };
}
```

## Plugin integrati



### Plugin Data Enhancement

Completamento automatico dei campi basato sull'IA:

```typescript
import { useDataEnhancementPlugin } from "@rebasepro/plugin-ai";

const enhancementPlugin = useDataEnhancementPlugin();
```

![Data enhancement](/img/data_enhancement.png)

:::caution[Questo plugin invia dati all'esterno della tua macchina]
L'autocompletamento invia tramite richiesta POST i valori dei campi dell'entità a un servizio ospitato per generare un suggerimento. Per impostazione predefinita, tale servizio è **`https://app.rebase.pro/api/functions/ai`**, gestito da Rebase — gratuito, senza necessità di configurazione e senza credenziali associate: le richieste sono anonime e limitate da un rate limit anziché dall'identità. Il tuo JWT non viene inviato.

Se questo sia accettabile dipende dal contenuto dei campi. Punta `endpoint` verso la tua distribuzione per mantenere la generazione all'interno della tua infrastruttura:

```typescript no-verify
const enhancementPlugin = useDataEnhancementPlugin({
    endpoint: "https://ai.internal.example.com"
});
```

Il formato di trasmissione (wire format) definisce l'intero contratto — consulta `api.ts` in `@rebasepro/plugin-ai`, con un'implementazione di riferimento in `functions/ai.ts` del control plane. Il plugin non renderizza nulla finché l'host a cui punta non segnala di essere disponibile su `GET /status`, quindi un URL errato si tradurrà in un pulsante mancante anziché in una richiesta fallita.

Tutti gli altri plugin integrati sono locali al browser e non inviano nulla all'esterno.
:::

## Iniezione di collection

I plugin possono aggiungere nuove collection dinamicamente:

```typescript
hooks: {
    // Receives the resolved collections and returns the full list to use.
    injectCollections: (collections) => [...collections, auditLogCollection]
}
```

## Modifica delle collection

I plugin possono modificare le collection esistenti:

```typescript
hooks: {
    // Receives one collection, returns the modified one.
    // Use `modifyCollectionAsync` when the change needs a fetch.
    modifyCollection: (collection) => ({
        ...collection,
        properties: {
            ...collection.properties,
            last_modified_by: {
                type: "string",
                name: "Modified By",
                admin: { readOnly: true }
            }
        }
    })
}
```

## Passaggi successivi

- **[Studio Tools](/docs/studio)** — Console SQL, console JS, editor RLS
- **[Custom Fields](/docs/frontend/custom-fields)** — Creazione di campi form personalizzati
