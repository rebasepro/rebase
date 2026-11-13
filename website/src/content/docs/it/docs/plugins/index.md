---
sourceHash: d1b243f804318232
title: Sistema di plugin
sidebar_label: Plugin
description: Estendi Rebase con i plugin — inserisci componenti UI, modifica collezioni, aggiungi azioni alla barra degli strumenti e crea costruttori di campi personalizzati.
---

## Panoramica

**I plugin sono un concetto relativo al pannello di amministrazione.** Vengono eseguiti nel browser, all'interno
dell'admin React, e sono registrati nel punto in cui lo crei. Niente in questa pagina raggiunge
il backend: un plugin non può aggiungere una route, una callback o un cron. Per questi elementi, consulta
[Custom Functions](/docs/backend/custom-functions), [Entity
Callbacks](/docs/collections/callbacks) e [Cron Jobs](/docs/backend/cron-jobs).

I plugin rappresentano il meccanismo di estensione principale del pannello. Possono:

- Avvolgere l'intera applicazione con un **provider** (contesto, gestione dello stato)
- Aggiungere **azioni della home page** e widget
- Inserire componenti per la **vista collezione** (barra degli strumenti, intestazioni di colonna)
- Aggiungere componenti per i **moduli** (costruttori di campi, pannelli aggiuntivi)
- **Inserire o modificare collezioni** in modo dinamico

## Interfaccia dei plugin

```typescript
interface RebasePlugin {
    key: string;                    // Unique identifier
    loading?: boolean;              // Hold admin content until the plugin is ready

    // UI contributions — a flat array, each entry naming its slot.
    // This replaced the old per-area objects (homePage, collectionView, form).
    slots?: AnySlotContribution[];

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

    // onMount, onAuthStateChange, onUnmount — see below.
    lifecycle?: PluginLifecycle;
}
```

Ognuno di questi campi è opzionale, ad eccezione di `key`. L'elenco completo dei nomi degli slot si trova nella
pagina **[Slot](/docs/frontend/slots)**.

### Ciclo di vita

- `onMount(context)` viene eseguito una sola volta, quando l'autenticazione diventa pronta per la prima volta: un utente ha effettuato
  l'accesso oppure l'accesso è stato saltato.
- `onAuthStateChange(user)` viene eseguito a ogni successivo cambio di utente: il nuovo utente al momento
  dell'accesso, `null` alla disconnessione. Il plugin rimane montato in entrambi i casi.
- `onUnmount()` viene eseguito quando `<Rebase>` si smonta.

`lifecycle.onCollectionChange` è deprecato. Nessun componente lo ha mai chiamato. Un plugin che lo definisce continua a compilare, e `<Rebase>` emette un avviso una volta per
plugin. Per seguire le righe di una collezione, iscriviti da `onMount` ed
esegui l'annullamento dell'iscrizione in `onUnmount`:

```tsx
import type { RebasePlugin } from "@rebasepro/cms-types";

let stopListening: (() => void) | undefined;

const openOrdersPlugin: RebasePlugin = {
    key: "open_orders",
    lifecycle: {
        onMount: (context) => {
            stopListening = context.data.orders.listen(
                { where: { status: ["==", "open"] } },
                ({ data }) => console.log(`${data.length} open orders`)
            );
        },
        onUnmount: () => stopListening?.()
    }
};
```

## Utilizzo dei plugin

I plugin vengono passati a `<Rebase>`, accanto al client. Tutto ciò che si trova al di sotto — la
navigazione, le viste collezione, i moduli — li legge da lì:

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
            <RebaseCMS tableCustomizations={tableCustomizations}/>
            <RebaseShell title="My App"/>
        </Rebase>
    );
}
```

I plugin sono solitamente generati da un hook, quindi l'array viene ricostruito a ogni render;
questo è previsto, ed è il motivo per cui `plugins` è una prop anziché qualcosa da
memorizzare manualmente. Due plugin con la stessa `key` rappresentano un errore — `<Rebase>`
registra i duplicati nei log invece di ignorarne silenziosamente uno.

Per un singolo contributo non hai affatto bisogno di un plugin: `<Rebase slots>`
accetta direttamente le stesse voci `SlotContribution`.

### Con composizione manuale

Solo nel caso in cui tu abbia sostituito `<RebaseShell>` con i layer sottostanti,
l'elenco dei plugin deve essere propagato manualmente all'interno del controller di navigazione:

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

`<RebaseNavigation>` esegue esattamente questa chiamata per te, leggendo `plugins`
dal controller di personalizzazione fornito da `<Rebase>`. Consulta
[Avanzato: layout manuale](/docs/frontend#advanced-manual-layout).

## Creazione di un plugin

Ecco un plugin minimale che aggiunge un'azione alla barra degli strumenti di ogni collezione:

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
        // a *component* (or null to leave the field as it is) — it is not
        // a render function and no longer lives under `form`.
        fieldBuilder: {
            wrap: ({ property }) =>
                property.propertyConfig === "my_custom_field" ? MyCustomField : null
        }
    };
}
```

### Wrapper di campi provenienti da più plugin

I wrapper di più plugin si compongono seguendo l'ordine dell'array `plugins`.
La funzione `wrap` di ciascun plugin riceve, come `params.Field`, il campo così come è stato lasciato
dai plugin precedenti, quindi il wrapper del primo plugin è il più interno e quello
dell'ultimo è il più esterno. Un plugin il cui `wrap` restituisce `null`, o il cui guard
`enabled` restituisce `false` per il campo, lo propaga invariato. Un wrapper che
effettua il render di `Field` mantiene quindi tutti i wrapper che lo precedono:

```tsx
import type { RebasePlugin } from "@rebasepro/cms-types";
import { Typography } from "@rebasepro/ui";

const descriptionPlugin: RebasePlugin = {
    key: "description_below",
    fieldBuilder: {
        // `Field` is the built-in field, or the earlier plugins' wrapper of it.
        wrap: ({ Field, property }) => property.description
            ? (props) => (
                <>
                    <Field {...props}/>
                    <Typography variant="caption" color="secondary">
                        {property.description}
                    </Typography>
                </>
            )
            : null
    }
};
```

## Plugin integrati



### Plugin Data Enhancement

Completamento automatico dei campi basato su intelligenza artificiale:

```typescript
import { useDataEnhancementPlugin } from "@rebasepro/plugin-ai";

const enhancementPlugin = useDataEnhancementPlugin();
```

Aggiunge un'azione di compilazione automatica (Autofill) a ogni modulo e un comando slash **Autocomplete**
a ogni campo markdown, che prosegue il testo a partire dal cursore. Entrambi compaiono
solo dove il plugin è abilitato: il servizio si dichiara disponibile e
`getConfigForPath` (se specificato) autorizza la collezione. Un campo il cui
`customProps.editorProps.aiController` indica un controller proprietario utilizzerà
quello. Un altro plugin può assegnare un controller ai campi markdown nello stesso modo, usando
`EditorAIControllerProvider` da `@rebasepro/cms` in un provider con scope a livello di form.

![Miglioramento dei dati](/img/data_enhancement.png)

:::caution[Questo plugin invia dati all'esterno della tua macchina]
Autofill invia i valori dei campi dell'entità a un servizio hosted per generare un
suggerimento: esclusivamente i valori delle proprietà dichiarate, mai di una proprietà in sola lettura,
disabilitata o nascosta, con `dynamicProps`, o di una colonna non dichiarata dalla collezione.
Per impostazione predefinita, tale servizio è **`https://app.rebase.pro/api/functions/ai`**,
gestito da Rebase — gratuito, senza configurazione e senza credenziali associate:
le richieste sono anonime, limitate da un rate limit anziché dall'identità. Il tuo
JWT non viene inviato. Anche l'autocompletamento con comando slash dell'editor invia testo: fino a 8.000
caratteri su ciascun lato del cursore, mai l'intero documento.

L'accettabilità di questo comportamento dipende dal contenuto dei campi. Indirizza `endpoint` verso
il tuo deployment per mantenere la generazione all'interno della tua infrastruttura:

```typescript no-verify
const enhancementPlugin = useDataEnhancementPlugin({
    endpoint: "https://ai.internal.example.com"
});
```

Il formato di trasmissione costituisce l'intero contratto — consulta `api.ts` in `@rebasepro/plugin-ai`,
con un'implementazione di riferimento in `functions/ai.ts` del control plane. Il
plugin non esegue alcun render finché l'host a cui punta non si dichiara disponibile su
`GET /status`, pertanto un URL errato si tradurrà in un pulsante mancante anziché in una richiesta non riuscita.

Tutti gli altri plugin integrati sono locali al browser e non inviano dati altrove.
:::

## Iniezione di collezioni

I plugin possono aggiungere dinamicamente nuove collezioni:

```typescript
hooks: {
    // Receives the resolved collections and returns the full list to use.
    injectCollections: (collections) => [...collections, auditLogCollection]
}
```

## Modifica delle collezioni

<span class="since-badge" data-since="0.31">Dalla versione 0.31</span>

I plugin possono modificare le collezioni esistenti:

```typescript
hooks: {
    // Receives one collection, returns the modified one.
    modifyCollection: (collection) => ({
        ...collection,
        description: `${collection.description ?? ""} Managed by the ops team.`.trim()
    })
}
```

La collezione ricevuta da un plugin è la vista risolta della tabella dal pannello, dopo
l'applicazione del relativo `customizeTable`, per cui un plugin vede ciò che il pannello sta per
disegnare.

`modifyCollection` è sincrono e l'admin lo applica nel momento in cui risolve
le proprie collezioni, non a ogni modifica del plugin. Quando la modifica richiede dati
da recuperare, esegui il fetch prima di renderizzare `<Rebase>` e costruisci il plugin
a partire da ciò che è stato restituito:

```tsx
import { useEffect, useMemo, useState } from "react";
import { Rebase, useRebaseAuthController } from "@rebasepro/app";
import { RebaseCMS, RebaseShell } from "@rebasepro/cms";
import type { RebasePlugin } from "@rebasepro/cms-types";
import { CircularProgressCenter } from "@rebasepro/ui";

export function App() {
    const authController = useRebaseAuthController({ client });
    const [labels, setLabels] = useState<Record<string, string>>();

    useEffect(() => {
        fetch("/collection-labels.json")
            .then((response) => response.json())
            .then(setLabels);
    }, []);

    const labelsPlugin = useMemo<RebasePlugin | undefined>(() => labels && {
        key: "collection_labels",
        hooks: {
            modifyCollection: (collection) => ({
                ...collection,
                name: labels[collection.slug] ?? collection.name
            })
        }
    }, [labels]);

    if (!labelsPlugin) return <CircularProgressCenter/>;

    return (
        <Rebase client={client} authController={authController} plugins={[labelsPlugin]}>
            <RebaseCMS tableCustomizations={tableCustomizations}/>
            <RebaseShell title="My App"/>
        </Rebase>
    );
}
```

`hooks.modifyCollectionAsync` è deprecato. Nessun componente lo ha mai chiamato. Un plugin che lo definisce continua a compilare, e `<Rebase>` emette un avviso una volta per
plugin. Utilizza `modifyCollection` come illustrato sopra.

## Passaggi successivi

- **[Studio Tools](/docs/studio)** — Console SQL, console JS, editor RLS
- **[Campi personalizzati](/docs/frontend/custom-fields)** — Creazione di campi modulo personalizzati
