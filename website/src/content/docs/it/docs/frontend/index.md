---
sourceHash: f04fd00564e10891
title: Panoramica del frontend
sidebar_label: Frontend
description: "Costruisci e personalizza il pannello — Rebase CMS e Rebase Studio — con React: controller, scaffold, routing e viste."
---

## Panoramica

Il frontend di Rebase è un **framework React** che esegue il rendering del tuo pannello di amministrazione. Legge le definizioni delle tue collection e genera automaticamente tabelle, form, navigazione e routing.

Nello scaffold predefinito, il pannello di amministrazione **è** il frontend: viene servito alla radice dell'URL di deploy. Se invece crei la tua applicazione di prodotto, puoi montare l'admin sotto un prefisso come `/admin` all'interno dello stesso deployment — vedi [Modificare l'URL di base](/docs/getting-started/deployment#changing-the-base-url).

Questo è `frontend/src/App.tsx` così come viene scritto da `rebase init`, senza le importazioni dei font, l'error boundary e il client id di Google — l'intero pannello di amministrazione, quattro dichiarazioni all'interno di un unico provider:

```tsx
import React from "react";
import { Rebase, RebaseAuth, useRebaseAuthController } from "@rebasepro/app";
import { RebaseCMS, RebaseShell } from "@rebasepro/cms";
import { RebaseStudio } from "@rebasepro/studio";
import { createRebaseClient } from "@rebasepro/client";
import { collections } from "virtual:rebase-collections";

const client = createRebaseClient({
    baseUrl: import.meta.env.VITE_API_URL,
    auth: { authFlowMode: "cookie" }
});

export function App() {
    const authController = useRebaseAuthController({ client });

    return (
        <Rebase client={client} authController={authController}>
            {/* Sign-in screen. Pass `loginView` to replace it. */}
            <RebaseAuth/>
            <RebaseCMS collections={collections}/>
            <RebaseStudio/>
            <RebaseShell title="My App"/>
        </Rebase>
    );
}
```

I primi tre non renderizzano nulla: *registrano* la configurazione all'interno del provider. `<RebaseShell>` è ciò che disegna i componenti — legge tale registro e costruisce la navigazione, le route e il layout a partire da esso. Di conseguenza, l'ordine in cui appaiono non ha importanza, e aggiungere una funzionalità significa aggiungere un componente, non dover ricablare l'albero.

| Componente | Pacchetto | Registra |
|---|---|---|
| `<RebaseAuth>` | `@rebasepro/app` | la schermata di accesso (`loginView`) |
| `<RebaseCMS>` | `@rebasepro/cms` | collection, viste personalizzate, la home page, l'editor delle collection |
| `<RebaseStudio>` | `@rebasepro/studio` | gli strumenti per sviluppatori (SQL, RLS, log, backup…) |
| `<RebaseShell>` | `@rebasepro/cms` | nulla — renderizza l'admin a partire da tutto quanto sopra |

Rimuovi `<RebaseStudio>` e otterrai un CMS dedicato unicamente ai contenuti; rimuovi `<RebaseCMS>` e avrai soltanto gli strumenti per sviluppatori. Per strutturare la shell manualmente, consulta [Avanzato: layout manuale](#advanced-manual-layout).

## Il provider Rebase

`<Rebase>` è il provider root che rende disponibili a tutti i componenti figli le funzionalità di Rebase tramite context. Accetta:

Tutte e ventitré, per intero — in precedenza la tabella ne elencava dieci, e due di queste erano prop che il componente non leggeva mai:

<!-- rebase-props:start -->
| Prop | Descrizione |
|------|-------------|
| `children` | I componenti root dell'admin — `<RebaseCMS>`, `<RebaseStudio>`, `<RebaseShell>`. Una render function rappresenta la via di fuga per il layout manuale. |
| `apiUrl` | URL di base dell'API di backend, reso disponibile a ogni hook tramite `useApiConfig()` |
| `dateTimeFormat` | Come vengono stampate le date. Il valore predefinito è `MMMM dd, yyyy, HH:mm:ss` |
| `locale` | Lingua iniziale dell'admin e locale in cui sono formattate le date — vedi [Traduzioni](/docs/frontend/i18n) |
| `client` | Istanza di `RebaseClient`: la sorgente predefinita per dati, autenticazione e storage |
| `dataSources` | Data source aggiuntivi, per le collection che ne specificano uno — vedi [Sorgenti multiple](/docs/backend/multiple-sources) |
| `authController` | Stato e metodi di autenticazione. Sostituisce completamente la sottoscrizione a `client.auth` |
| `storageSource` | La sorgente di storage predefinita, sovrascrive `client.storage` |
| `storageSources` | Sorgenti di storage con nome oltre a quella predefinita |
| `databaseAdmin` | Operazioni amministrative sul database (SQL, individuazione dello schema). Necessario solo a Studio |
| `userConfigPersistence` | Preferenze locali dell'interfaccia utente — larghezza delle colonne, gruppi compressi |
| `onAnalyticsEvent` | Chiamato per ogni evento di analitica emesso dall'admin |
| `entityLinkBuilder` | Restituisce un URL per il pulsante "apri nella tua app" su un form di entità |
| `plugins` | Istanze di plugin — vedi [Plugin](/docs/plugins) |
| `slots` | Contributi di slot dichiarati direttamente, senza un plugin |
| `propertyConfigs` | Widget di campi personalizzati, indicizzati in base al nome indicato da una proprietà in `propertyConfig` |
| `entityViews` | Tab di viste entità personalizzate, disponibili per qualsiasi collection che includa la loro `key` in `admin.entityViews` |
| `collectionViews` | Modalità di visualizzazione personalizzate per le collection, disponibili per qualsiasi collection tramite `key` |
| `entityActions` | Azioni sulle entità, disponibili per qualsiasi collection che includa la loro `key` in `admin.entityActions` |
| `effectiveRoleController` | Simula un ruolo diverso mentre la modalità di sviluppo è attiva |
| `modeController` | Assegna a Rebase la modalità chiara/scura dell'app host; in questo modo Rebase non modifica mai `<html>`, `prefers-color-scheme` o localStorage — vedi [Stili](#styling) |
| `translations` | Sovrascrive o estende qualsiasi stringa dell'interfaccia utente, indicizzata per locale — vedi [Traduzioni](/docs/frontend/i18n) |
| `components` | Sostituisce i componenti integrati — vedi [Override dei componenti](/docs/frontend/component-overrides) |
<!-- rebase-props:end -->

I controller per navigazione, URL e registro delle collection **non** sono prop di `<Rebase>` — vengono creati dagli hook seguenti e utilizzati all'interno dell'albero dell'admin (`<RebaseShell>` li configura automaticamente nello scaffold predefinito).

Lo stesso vale per il prefisso dell'URL. Quando l'admin viene montato sotto un determinato percorso, questo va specificato su `<RebaseCMS basePath="/admin">`, che è il componente che risolve gli URL nelle collection — e solo quando il router non dispone già di un proprio `basename`. Consulta [Modificare l'URL di base](/docs/getting-started/deployment#changing-the-base-url).

## Due formati di dati

Esistono due livelli di dati e **non** sono intercambiabili. Passare l'uno dove è previsto l'altro genera un errore di tipo, quindi è importante tenerlo presente prima di configurare manualmente un controller.

| | Formato | Dove si ottiene | Aspetto di una riga |
|---|---|---|---|
| **SDK** | `RebaseSdkData` — righe piatte | `client.data`, e `context.data` nei callback di backend | `row.title` |
| **Admin** | `RebaseData` — view-model `Entity` | `useData()`, all'interno dell'albero `<Rebase>` | `entity.values.title` |

Il livello SDK è la superficie pubblica e simmetrica: identica sul client frontend e nei callback di backend. Il livello `Entity` è il view-model dell'admin — aggiunge l'involucro `id` / `path` / `values` su cui si basano i form e le viste delle collection per il rendering. `CollectionAccessor` e `FindResponse` appartengono a questo livello e sono contrassegnati come `@internal` per questo motivo.

`<Rebase>` funge da confine tra i due: prende il tuo `client.data` piatto e lo avvolge con `wrapAsEntityData()` prima di fornirlo come `RebaseData` per l'admin. Non dovrai mai chiamarlo direttamente — basta prelevare il formato necessario dalla posizione corretta:

```tsx
// Flat rows — anywhere, including outside React.
const { data: posts } = await client.data.posts.find();
posts[0].title;

// Entity view-model — inside the <Rebase> tree only.
// `data.posts` also works at runtime; `collection()` is the typed accessor.
const data = useData();
const { data: entities } = await data.collection("posts").find();
entities[0].values.title;
```

## Una singola collection o un record in una tua pagina

Non è necessario utilizzare l'intero admin per mostrare una tabella. `<CollectionPanel>`, `<EntityFormPanel>`, `<EntityViewPanel>` e `<FieldValue>` funzionano ovunque all'interno di `<Rebase>` e di un router React Router, senza bisogno di `<RebaseCMS>`, `<RebaseNavigation>` o `<RebaseShell>`: una collection con le colonne e la toolbar che preferisci, il form di un singolo record con solo alcuni campi o con un layout personalizzato, un record in sola lettura, o un singolo valore renderizzato nello stesso modo in cui lo visualizza l'admin. Consulta [Pannelli in una pagina personalizzata](/docs/frontend/panels).

## Avanzato: layout manuale

Tutto ciò che segue sostituisce `<RebaseShell>`. È necessario solo quando il layout predefinito rappresenta un ostacolo — una cornice differente attorno all'admin, un albero di route personalizzato, un'applicazione in cui l'admin è solo una pagina tra le tante. Se non hai intenzione di sostituire il layout, puoi passare direttamente a [Viste personalizzate](#custom-views).

`<RebaseShell>` è una semplificazione per quattro livelli, che puoi gestire singolarmente:

```tsx
<Rebase client={client} authController={authController}>
    <RebaseCMS collections={collections}/>
    <RebaseStudio/>

    {/* login screen until there is a user */}
    <RebaseAuthGate>
        {/* builds the navigation, URL and collection-registry controllers */}
        <RebaseNavigation>
            {/* the admin's routes, drawn inside the layout you pass */}
            <RebaseRouteDefs layout={<RebaseLayout title="My App"/>}/>
        </RebaseNavigation>
    </RebaseAuthGate>
</Rebase>
```

L'ordine è obbligatorio: `RebaseAuthGate → RebaseNavigation → RebaseRouteDefs → RebaseLayout`. `RebaseAuthGate` mostra la vista di login finché non è presente un utente, impedendo il rendering di ciò che si trova al di sotto per un visitatore non autenticato; `RebaseNavigation` genera i controller per la navigazione, l'URL e il registro delle collection letti da `RebaseRouteDefs` e da ogni vista di collection, quindi usare `RebaseRouteDefs` al di fuori di esso solleverà un'eccezione. Per incorporare la vista di una collection o il form di un record all'interno di una pagina personalizzata senza le route dell'admin, è possibile usare il componente più leggero `CollectionsProvider` per costruire tali controller — consulta [Pannelli in una pagina personalizzata](/docs/frontend/panels).

Ogni livello può essere utilizzato autonomamente. `<RebaseAuthGate>` da solo protegge la tua applicazione dietro il login di Rebase. Sostituisci `<RebaseLayout>` con un tuo componente per mantenere il routing eliminando la cornice grafica; rimuovi anche `<RebaseRouteDefs>` e potrai costruire le route autonomamente a partire dai componenti illustrati in [Componenti di Scaffold](#scaffold-components).

Al di sotto di questa soglia, `<Rebase>` accetta anche una **render prop** al posto dei children, la quale fornisce il context e il flag di caricamento lasciando l'intero albero sotto il tuo controllo:

```tsx
<Rebase client={rebaseClient} authController={authController}>
    {({ context, loading }) => (
        <Scaffold>
            <AppBar/>
            <Drawer title="My App"/>
            <Outlet/>
            <SideDialogs/>
        </Scaffold>
    )}
</Rebase>
```

A questo punto non vi è alcun cablaggio automatico: dovrai creare i controller sottostanti manualmente ed eseguire il rendering delle route per conto tuo.

### Controller

I controller sono hook React che configurano aspetti specifici del framework. `<RebaseNavigation>` li chiama tutti al posto tuo — utilizzali manualmente solo all'interno di una render prop.

#### `useBuildNavigationStateController`

Il controller principale che collega tutti gli elementi:

Il suo parametro `data` è `RebaseData` nel **formato Entity**, per cui proviene da `useData()` — non da `rebaseClient.data`, che appartiene al livello SDK a righe piatte. `<Rebase>` converte l'uno nell'altro per te (vedi [Due formati di dati](#two-data-shapes) sotto), pertanto questo hook deve essere chiamato all'interno dell'albero `<Rebase>`.

```typescript
const data = useData();

const navigationStateController = useBuildNavigationStateController({
    collections: () => [...collections],  // Collection definitions
    views: customViews,                   // Custom navigation views
    plugins,                              // Plugin instances
    authController,
    data,
    collectionRegistryController,
    urlController,
    adminMode: adminModeController.mode
});
```

#### `useBuildCollectionRegistryController`

Gestisce il modo in cui le collection vengono risolte a partire dai percorsi URL:

```typescript
const collectionRegistryController = useBuildCollectionRegistryController({
    userConfigPersistence
});
```

#### `useBuildUrlController`

Configura la generazione degli URL:

```typescript
const urlController = useBuildUrlController({
    basePath: "/",
    baseCollectionPath: "/c",
    collectionRegistryController
});
```

#### `useBuildModeController`

Gestisce il tema chiaro/scuro. Quando è abilitato controlla il tema della pagina: applica la classe `dark` su `<html>`, segue `prefers-color-scheme` fino a quando l'utente non seleziona una modalità, e memorizza tale preferenza in localStorage.

```typescript
const modeController = useBuildModeController();

modeController.mode;             // "light" | "dark"
modeController.setMode("dark");  // "light" | "dark" | "system" — "system" follows the OS again
```

`<Rebase>` ne crea uno autonomamente.

Quando il componente che lo utilizza viene smontato, la classe `dark` aggiunta viene rimossa; un'eventuale classe `dark` già presente sulla pagina rimane inalterata. Creane uno tuo a monte di `<Rebase>` solo quando anche i componenti esterni hanno bisogno di conoscere la modalità corrente, e passalo tramite la [prop `modeController`](#styling), così da avere un unico controller anziché due. `useBuildModeController({ enabled: false })` crea un controller inerte: mantiene `mode` nello stato di React e non modifica alcuna classe, media query o localStorage. Quando la tua applicazione gestisce già il tema, questo hook non è necessario: passa semplicemente il tuo controller come `modeController`.

#### `useBuildAdminModeController`

Consente di alternare tra le modalità Studio e Content:

```typescript
const adminModeController = useBuildAdminModeController();
// Provides: adminModeController.mode ("cms" | "studio")
```

### Componenti di Scaffold

| Componente | Descrizione |
|-----------|-------------|
| `<Scaffold>` | Contenitore di layout principale con sidebar responsive |
| `<AppBar>` | Barra di navigazione superiore con ricerca, selezione modalità, menu utente |
| `<Drawer>` | Navigazione laterale con elenco delle collection e link alle viste |
| `<SideDialogs>` | Contenitore per gli editor di entità a pannello laterale |
| `<RebaseRoutes>` | Contenitore di route integrato con React Router |
| `<RebaseRoute>` | Gestisce le route delle collection (`/c/*`) |
| `<ContentHomePage>` | Home page predefinita che mostra le schede delle collection |
| `<StudioHomePage>` | Home page della modalità Studio con strumenti per sviluppatori |

## Viste personalizzate

Aggiungi viste di navigazione di primo livello per dashboard, strumenti o pagine personalizzate. Un oggetto `AppView` è una struttura piatta — tutti gli elementi elencati di seguito si trovano al livello principale, non è presente alcun blocco `admin` annidato:

```tsx
import type { AppView } from "@rebasepro/cms-types";

const views: AppView[] = [
    {
        slug: "dashboard",
        name: "Dashboard",
        icon: "LayoutDashboard",
        view: <MyDashboard/>
    },
    {
        slug: "settings",
        name: "App Settings",
        icon: "Settings",
        group: "Admin",
        // Register `settings/*` too, so the view can route inside itself.
        nestedRoutes: true,
        // Reachable by URL, but not listed in the drawer.
        hideFromNavigation: true,
        view: <AppSettings/>
    }
];
```

Passale a `<RebaseCMS>`, insieme alle tue collection — è questo il componente deputato alla registrazione della navigazione:

```tsx
<RebaseCMS collections={collections} views={views}/>
```

| Campo | |
|---|---|
| `slug` | il percorso al quale è raggiungibile, sotto la radice dell'admin |
| `name` | l'etichetta nel drawer e nella home page |
| `view` | l'elemento di cui eseguire il rendering, oppure un `ComponentType` per caricarlo in modalità lazy |
| `icon` | il nome di un'icona [Lucide](https://lucide.dev/icons/), ad es. `"ShoppingCart"` — o qualsiasi nodo |
| `group` | raggruppa le viste all'interno del drawer; `"Admin"` e `"Settings"` vengono posizionati in fondo |
| `pinToBottom` | posiziona il gruppo in fondo indipendentemente dal nome — preferibile rispetto all'uso delle due stringhe speciali |
| `nestedRoutes` | registra anche `slug/*`, per le viste dotate di percorsi interni |
| `hideFromNavigation` | mantiene attiva la route escludendo la voce dal menu di navigazione |
| `roles` | la vista sarà visibile o accessibile solo agli utenti che possiedono uno di questi ruoli |
| `description` | Markdown, mostrato nella scheda della home page |

Per inserire una vista sotto **Studio** anziché nel CMS, passala a [`<RebaseStudio devViews>`](/docs/studio#adding-your-own-tool).

## Stili

Rebase utilizza **Tailwind CSS v4** e supporta le modalità chiara/scura. Puoi personalizzarlo tramite:

- **Proprietà CSS personalizzate** — Per sovrascrivere i design token
- **`<Rebase modeController>`** — Per passare a Rebase la modalità chiara/scura della tua app
- **Configurazione Tailwind** — Standard personalizzazione di Tailwind

```css
/* Override design tokens */
:root {
    --font-sans: "Instrument Sans", sans-serif;
    --font-headers: "Instrument Sans", sans-serif;
    --font-mono: "JetBrains Mono", monospace;
}
```

### Modalità chiara e scura

Per impostazione predefinita, `<Rebase>` gestisce direttamente il tema della pagina: assegna la classe `dark` su `<html>`, segue `prefers-color-scheme` fino a quando l'utente non seleziona una modalità all'interno dell'admin, e memorizza la scelta nel localStorage.

Quando `<Rebase>` viene smontato, rimuove la classe `dark` aggiunta; un'eventuale classe già presente sulla pagina viene conservata. Nella versione 0.24 la classe non viene rimossa.

Se la tua applicazione dispone già di un sistema di gestione del tema, passalo come `modeController`. Rebase leggerà `mode` da esso, chiamerà il rispettivo `setMode` tramite il proprio toggle del tema, e non modificherà in alcun modo `<html>`, `prefers-color-scheme` o localStorage:

```tsx
import { useEffect, useMemo, useState } from "react";
import { Rebase, type ModeController } from "@rebasepro/app";

export function App() {
    const [mode, setMode] = useState<"light" | "dark">("light");
    const modeController = useMemo<ModeController>(() => ({
        mode,
        setMode: (next) => setMode(next === "dark" ? "dark" : "light")
    }), [mode]);

    // Your app applies the mode, as it does for the rest of the page.
    useEffect(() => {
        document.documentElement.classList.toggle("dark", mode === "dark");
    }, [mode]);

    return (
        <Rebase client={client} modeController={modeController}>
            <MyAdmin/>
        </Rebase>
    );
}
```

Il CSS dello scaffold applica lo stile della modalità scura a qualsiasi elemento all'interno della classe `dark` (`@custom-variant dark (&:where(.dark, .dark *))`). I pannelli laterali, i dialog e i menu vengono renderizzati tramite portale su `<body>`, pertanto è preferibile applicare la classe su `<html>` o `<body>` anziché su un contenitore wrapper attorno a `<Rebase>`.

Avvolgere `<Rebase>` con un `ModeControllerProvider` non produce questo effetto: `<Rebase>` crea già un proprio controller internamente. Nella versione 0.24 la prop non esiste e non vi è modo di passare a `<Rebase>` la modalità dell'applicazione host.

## Passaggi successivi

- **[Campi personalizzati](/docs/frontend/custom-fields)** — Crea campi form personalizzati
- **[Viste entità](/docs/frontend/entity-views)** — Aggiungi tab agli editor di entità
- **[Modalità di visualizzazione](/docs/frontend/view-modes)** — Lista, Tabella, Schede, Kanban
- **[Traduzioni](/docs/frontend/i18n)** — Modifica qualsiasi stringa o aggiungi una nuova lingua
- **[Plugin](/docs/plugins)** — Estendi le funzionalità del framework
