---
sourceHash: 758100d13ca5c533
title: Panoramica del frontend
sidebar_label: Frontend
description: "Crea e personalizza il pannello — Rebase CMS e Rebase Studio — con React: controller, scaffold, routing e viste."
---

## Panoramica

Il frontend di Rebase è un **framework React** che esegue il rendering del pannello di amministrazione. Legge le definizioni delle tue collection e genera automaticamente tabelle, form, navigazione e routing.

Nello scaffold predefinito, il pannello di amministrazione **è** il frontend: viene servito alla radice dell'URL di distribuzione. Se invece sviluppi la tua applicazione prodotto, puoi montare l'admin sotto un prefisso come `/admin` nello stesso deployment — consulta [Modificare l'URL di base](/docs/getting-started/deployment#changing-the-base-url).

Questo è `frontend/src/App.tsx` come viene generato da `rebase init`, senza le importazioni dei font, l'error boundary e il client id di Google — l'intero pannello di amministrazione, quattro dichiarazioni all'interno di un unico provider:

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

I primi tre non renderizzano nulla: *registrano* la configurazione nel provider. `<RebaseShell>` è ciò che effettua il rendering — legge tale registro e costruisce da esso la navigazione, le route e il layout. Di conseguenza, l'ordine in cui compaiono non ha importanza, e aggiungere una funzionalità significa aggiungere un componente, non ricollegare un intero albero.

| Componente | Pacchetto | Registra |
|---|---|---|
| `<RebaseAuth>` | `@rebasepro/app` | la schermata di accesso (`loginView`) |
| `<RebaseCMS>` | `@rebasepro/cms` | collection, viste personalizzate, la home page, l'editor delle collection |
| `<RebaseStudio>` | `@rebasepro/studio` | gli strumenti per sviluppatori (SQL, RLS, log, backup…) |
| `<RebaseShell>` | `@rebasepro/cms` | nulla — renderizza l'admin a partire da tutto quanto sopra |

Rimuovi `<RebaseStudio>` e otterrai un CMS per soli contenuti; rimuovi `<RebaseCMS>` e avrai unicamente gli strumenti per sviluppatori. Per strutturare la shell manualmente, consulta [Avanzato: layout manuale](#avanzato-layout-manuale).

## Il provider Rebase

`<Rebase>` è il provider radice che rende disponibili tutte le funzionalità di Rebase ai componenti figli tramite context. Accetta:

Tutte e ventitré, per intero — la tabella prima ne elencava dieci, e due di queste erano prop che il componente non leggeva mai:

<!-- rebase-props:start -->
| Prop | Descrizione |
|------|-------------|
| `children` | I componenti radice dell'admin — `<RebaseCMS>`, `<RebaseStudio>`, `<RebaseShell>`. Una render function rappresenta la via d'uscita per il layout manuale. |
| `apiUrl` | URL di base dell'API di backend, resa disponibile a ciascun hook tramite `useApiConfig()` |
| `dateTimeFormat` | Come vengono formattate le date. Il valore predefinito è `MMMM dd, yyyy, HH:mm:ss` |
| `locale` | Lingua iniziale dell'admin e locale utilizzato per formattare le date — consulta [Traduzioni](/docs/frontend/i18n) |
| `client` | Istanza di `RebaseClient`: la sorgente predefinita per dati, autenticazione e storage |
| `dataSources` | Sorgenti dati aggiuntive, per le collection che ne specificano una — consulta [Sorgenti multiple](/docs/backend/multiple-sources) |
| `authController` | Stato e metodi di autenticazione. Sostituisce completamente la sottoscrizione a `client.auth` |
| `storageSource` | La sorgente di storage predefinita, sovrascrive `client.storage` |
| `storageSources` | Sorgenti di storage con nome oltre a quella predefinita |
| `databaseAdmin` | Operazioni amministrative sul database (SQL, rilevamento dello schema). Necessario solo per Studio |
| `userConfigPersistence` | Preferenze UI locali — larghezza delle colonne, gruppi compressi |
| `onAnalyticsEvent` | Chiamato per ogni evento di analytics emesso dall'admin |
| `entityLinkBuilder` | `({ row, id, path }) => string`: l'URL per il pulsante "apri nella tua app" su un record, a partire dal record così come il server invia la riga |
| `plugins` | Istanze di plugin — consulta [Plugin](/docs/plugins) |
| `slots` | Contributi slot dichiarati direttamente, senza un plugin |
| `propertyConfigs` | Widget di campi personalizzati, indicizzati in base al nome specificato da una proprietà in `propertyConfig` |
| `entityViews` | Tab personalizzati per le viste entità, disponibili per qualsiasi collection che specifichi la loro `key` in `admin.entityViews` |
| `collectionViews` | Modalità di visualizzazione personalizzate delle collection, disponibili per qualsiasi collection tramite `key` |
| `entityActions` | Azioni sulle entità, disponibili per qualsiasi collection che specifichi la loro `key` in `admin.entityActions` |
| `effectiveRoleController` | Simula un ruolo diverso mentre la modalità sviluppatore è attiva |
| `modeController` | Passa a Rebase la modalità light/dark dell'app host; Rebase non modificherà mai `<html>`, `prefers-color-scheme` o localStorage — consulta [Stile](#stile) |
| `translations` | Sovrascrivi o estendi qualsiasi stringa dell'interfaccia utente, indicizzata per locale — consulta [Traduzioni](/docs/frontend/i18n) |
| `components` | Sostituisci i componenti integrati — consulta [Sostituzione dei componenti](/docs/frontend/component-overrides) |
<!-- rebase-props:end -->

I controller di navigazione, URL e del registro delle collection **non** sono prop di `<Rebase>` — vengono creati dagli hook sottostanti e consumati all'interno dell'albero dell'admin (`<RebaseShell>` li collega per te nello scaffold predefinito).

Non lo è neanche il prefisso URL. Quando l'admin è montato sotto un percorso, questo va impostato su `<RebaseCMS basePath="/admin">`, che è ciò che risolve gli URL verso le collection — e solo quando il router non ha un proprio `basename`. Consulta [Modificare l'URL di base](/docs/getting-started/deployment#changing-the-base-url).

## Un'unica struttura dati

Il tuo codice riceve le righe così come le invia il server, ovunque le richieda: `client.data`, `context.data` (sia in una callback di backend che nel browser), `useRows`, `useRow` e `useRowWrites`, il `data` dei builder di collection e viste, e ciò che viene passato ai `browserCallbacks` di una collection. Una riga è un oggetto piatto: `row.title`, una data come stringa ISO, un belongsTo come colonna della sua chiave esterna.

```tsx
// Anywhere, including outside React.
const { data: posts } = await client.data.posts.find();
posts[0].title;

// Inside the <Rebase> tree: the same rows, kept current after every write.
const { rows } = useRows("posts");
rows[0].title;
```

L'admin stesso effettua il rendering di un view model `Entity` — il wrapper `id` / `path` / `values` da cui attingono le viste delle collection e i form, con date come istanze di `Date` e una relazione come `EntityRelation`. Tale livello è interno all'admin e non fa parte della superficie pubblica: a un'azione sull'entità, a un display resolver, a `tableController.rows` di un `Builder` di modalità di visualizzazione, alla selezione di un'azione sulla collection e a uno slot vengono tutti passati oggetti riga. Incontrerai `Entity` solo in una copia di una delle parti interne dell'admin (`Collection.Table`, una card), a cui viene passato il record così come l'admin lo renderizza. I valori di un form sono quelli dell'editor: `Date` e relazioni, nel modo in cui un campo li modifica.

## Una singola collection o un singolo record in una pagina personalizzata

Non è necessario l'intero admin per mostrare una singola tabella. `<CollectionPanel>`, `<EntityFormPanel>`, `<EntityViewPanel>` e `<FieldValue>` funzionano ovunque sotto `<Rebase>` e un router di React Router, senza `<RebaseCMS>`, `<RebaseNavigation>` o `<RebaseShell>`: una collection con le colonne e la barra degli strumenti scelte da te, il form di un singolo record con solo alcuni campi o un layout personalizzato, un singolo record in sola lettura, oppure un singolo valore renderizzato come lo farebbe l'admin. Consulta [Pannelli in una pagina personalizzata](/docs/frontend/panels).

## Avanzato: layout manuale

Tutto ciò che segue sostituisce `<RebaseShell>`. Ne hai bisogno solo quando il layout predefinito rappresenta un ostacolo — una cornice differente attorno all'admin, un albero di route personalizzato, un'app in cui l'admin è solo una pagina tra le tante. Se non devi sostituire il layout, puoi passare a [Viste personalizzate](#viste-personalizzate).

`<RebaseShell>` è un wrapper semplificato per quattro livelli, e puoi gestirli singolarmente:

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

L'ordine è fisso: `RebaseAuthGate → RebaseNavigation → RebaseRouteDefs → RebaseLayout`. `RebaseAuthGate` mostra la vista di login finché non è presente un utente, quindi nulla al di sotto di esso viene renderizzato per un visitatore disconnesso; `RebaseNavigation` crea i controller di navigazione, URL e registro delle collection letti da `RebaseRouteDefs` e da ogni vista delle collection, pertanto l'uso di `RebaseRouteDefs` al di fuori di esso genera un errore. Per incorporare la vista di una collection o il form di un record in una pagina personalizzata, senza le route dell'admin, il più leggero `CollectionsProvider` crea questi controller al suo posto — consulta [Pannelli in una pagina personalizzata](/docs/frontend/panels).

Ciascun livello può essere utilizzato autonomamente. `<RebaseAuthGate>` da solo protegge la tua app dietro il login di Rebase. Sostituisci `<RebaseLayout>` con un tuo componente per mantenere il routing ed eliminare l'interfaccia grafica circostante; rimuovi anche `<RebaseRouteDefs>` e costruirai le route tu stesso a partire dai componenti in [Componenti di scaffold](#componenti-di-scaffold).

A un livello ancora inferiore, `<Rebase>` accetta anche una **render prop** al posto di children, fornendo il context e il flag di caricamento e lasciando l'intero albero nelle tue mani:

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

A quel punto nulla è preconfigurato per te: dovrai costruire manualmente i controller descritti di seguito ed effettuare tu stesso il rendering delle route.

### Controller

I controller sono hook di React che configurano aspetti specifici del framework. `<RebaseNavigation>` li chiama tutti per te — ricorri a essi solo all'interno di una render prop.

#### `useBuildNavigationStateController`

Il controller principale che collega tutto insieme:

Il suo parametro `data` è ciò che viene passato ai builder delle collection e delle viste: l'oggetto piatto `context.data` del componente `<Rebase>` genitore (consulta [Un'unica struttura dati](#ununica-struttura-dati)), quindi questo hook deve essere chiamato all'interno dell'albero `<Rebase>`.

```typescript
const { data } = useRebaseContext();

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

Gestisce la risoluzione delle collection a partire dai percorsi URL:

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

Gestisce il tema chiaro/scuro. Quando è abilitato gestisce il tema dell'intera pagina: applica la classe `dark` a `<html>`, segue `prefers-color-scheme` finché l'utente non sceglie una modalità e memorizza tale scelta in localStorage.

```typescript
const modeController = useBuildModeController();

modeController.mode;             // "light" | "dark"
modeController.setMode("dark");  // "light" | "dark" | "system" — "system" follows the OS again
```

`<Rebase>` ne crea uno autonomamente.

Quando il componente che lo utilizza viene smontato, rimuove la classe `dark` aggiunta; un'eventuale classe `dark` già presente sulla pagina viene mantenuta. Creane uno personalizzato a monte di `<Rebase>` solo quando anche i componenti esterni necessitano di conoscere la modalità, e passalo tramite la [prop `modeController`](#stile), così da avere un solo controller anziché due. `useBuildModeController({ enabled: false })` crea un controller inerte: mantiene `mode` nello stato di React senza toccare classi, media query o localStorage. Se la tua app gestisce già il tema, questo hook non è affatto necessario: passa direttamente il tuo controller come `modeController`.

#### `useBuildAdminModeController`

Consente di passare dalla modalità Studio alla modalità Contenuto e viceversa:

```typescript
const adminModeController = useBuildAdminModeController();
// Provides: adminModeController.mode ("cms" | "studio")
```

### Componenti di scaffold

| Componente | Descrizione |
|-----------|-------------|
| `<Scaffold>` | Contenitore di layout principale con barra laterale reattiva |
| `<AppBar>` | Barra di navigazione superiore con ricerca, selettore tema, menu utente |
| `<Drawer>` | Navigazione laterale con elenco delle collection e link alle viste |
| `<SideDialogs>` | Contenitore per gli editor di entità nel pannello laterale |
| `<RebaseRoutes>` | Contenitore di route integrato con React Router |
| `<RebaseRoute>` | Gestisce le route delle collection (`/c/*`) |
| `<ContentHomePage>` | Home page predefinita che mostra le schede delle collection |
| `<StudioHomePage>` | Home page della modalità Studio con strumenti per sviluppatori |

## Viste personalizzate

Aggiungi viste di navigazione di primo livello per dashboard, strumenti o pagine personalizzate. Un oggetto `AppView` è piatto — tutto ciò che segue si trova al livello principale, senza blocchi `admin` annidati:

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

Passale a `<RebaseCMS>`, accanto alle tue collection — è questo il componente che registra la navigazione:

```tsx
<RebaseCMS collections={collections} views={views}/>
```

| Campo | |
|---|---|
| `slug` | il percorso a cui è raggiungibile, sotto la radice dell'admin |
| `name` | l'etichetta nel drawer e nella home page |
| `view` | l'elemento di cui effettuare il rendering, o un `ComponentType` per caricarlo in modo lazy |
| `icon` | il nome di un'icona [Lucide](https://lucide.dev/icons/), ad es. `"ShoppingCart"` — o qualsiasi nodo |
| `group` | raggruppa le viste insieme nel drawer; `"Admin"` e `"Settings"` vengono posizionati in fondo |
| `pinToBottom` | posiziona il gruppo in fondo indipendentemente dal nome — preferibile rispetto alle due stringhe convenzionali |
| `nestedRoutes` | registra anche `slug/*`, per una vista che gestisce route interne proprie |
| `hideFromNavigation` | mantiene attiva la route, escludendo la voce di navigazione |
| `roles` | solo gli utenti con uno di questi ruoli possono vedere la vista o accedervi |
| `description` | Markdown, mostrato nella scheda della home page |

Per posizionare una vista sotto **Studio** anziché nel CMS, passala a [`<RebaseStudio devViews>`](/docs/studio#adding-your-own-tool).

## Stile

Rebase utilizza **Tailwind CSS v4** e supporta le modalità chiara/scura. Personalizzabile tramite:

- **Proprietà personalizzate CSS** — Sovrascrivi i token di design
- **`<Rebase modeController>`** — Passa a Rebase la modalità light/dark della tua app
- **Configurazione di Tailwind** — Personalizzazione standard di Tailwind

```css
/* Override design tokens */
:root {
    --font-sans: "Instrument Sans", sans-serif;
    --font-headers: "Instrument Sans", sans-serif;
    --font-mono: "JetBrains Mono", monospace;
}
```

### Modalità chiara e scura

Per impostazione predefinita, `<Rebase>` gestisce il tema della pagina: assegna la classe `dark` a `<html>`, segue `prefers-color-scheme` finché l'utente non seleziona una modalità nell'admin e memorizza tale selezione in localStorage.

Quando `<Rebase>` viene smontato, rimuove la classe `dark` aggiunta; un'eventuale classe già presente sulla pagina viene mantenuta. Nella versione 0.24 la classe non viene rimossa.

Se la tua app dispone già di un tema, passalo come `modeController`. Rebase leggerà `mode` da esso, chiamerà il suo `setMode` tramite il proprio selettore di tema e non toccherà mai `<html>`, `prefers-color-scheme` o localStorage:

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

Il CSS dello scaffold applica gli stili della modalità scura a qualsiasi elemento dotato della classe `dark` (`@custom-variant dark (&:where(.dark, .dark *))`). I pannelli laterali, le finestre di dialogo e i menu vengono renderizzati in un portal su `<body>`, pertanto applica la classe su `<html>` o `<body>` piuttosto che su un wrapper attorno a `<Rebase>`.

Avvolgere `<Rebase>` all'interno di un `ModeControllerProvider` non ha questo effetto: `<Rebase>` fornisce già un proprio controller al suo interno. Nella versione 0.24 la prop non esiste e non vi è alcun modo per passare a `<Rebase>` la modalità della tua app.

## Prossimi passi

- **[Campi personalizzati](/docs/frontend/custom-fields)** — Crea campi di form personalizzati
- **[Viste entità](/docs/frontend/entity-views)** — Aggiungi tab agli editor di entità
- **[Modalità di visualizzazione](/docs/frontend/view-modes)** — Lista, Tabella, Schede, Kanban
- **[Traduzioni](/docs/frontend/i18n)** — Modifica qualsiasi stringa o aggiungi una lingua
- **[Plugin](/docs/plugins)** — Estendi il framework
