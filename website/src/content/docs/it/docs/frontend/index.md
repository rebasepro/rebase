---
sourceHash: 58385fe3e9894cb2
title: Panoramica Frontend
sidebar_label: Frontend
description: "Crea e personalizza il pannello — Rebase CMS e Rebase Studio — con React: controller, scaffold, routing e viste."
---

## Panoramica

Il frontend di Rebase è un **framework React** che esegue il rendering del tuo pannello di amministrazione. Legge le definizioni delle tue collection e genera automaticamente tabelle, form, navigazione e routing.

Nello scaffold predefinito, il pannello di amministrazione **è** il frontend: viene servito alla radice dell'URL del deployment. Se invece crei la tua app di prodotto, puoi montare l'admin sotto un prefisso come `/admin` nello stesso deployment — consulta [Modificare l'URL di base](/docs/getting-started/deployment#changing-the-base-url).

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

I primi tre non renderizzano nulla: *registrano* la configurazione all'interno del provider. `<RebaseShell>` è ciò che effettua il rendering — legge tale registro e costruisce da esso la navigazione, le route e il layout. L'ordine in cui appaiono non ha quindi importanza, e aggiungere una funzionalità significa aggiungere un componente, non ricablare un albero.

| Componente | Pacchetto | Registra |
|---|---|---|
| `<RebaseAuth>` | `@rebasepro/app` | la schermata di accesso (`loginView`) |
| `<RebaseCMS>` | `@rebasepro/cms` | collection, viste personalizzate, la home page, l'editor delle collection |
| `<RebaseStudio>` | `@rebasepro/studio` | gli strumenti per sviluppatori (SQL, RLS, log, backup…) |
| `<RebaseShell>` | `@rebasepro/cms` | niente — esegue il rendering dell'admin a partire da tutto quanto sopra |

Rimuovi `<RebaseStudio>` e otterrai un CMS dedicato esclusivamente ai contenuti; rimuovi `<RebaseCMS>` e avrai solo gli strumenti per sviluppatori. Per strutturare la shell manualmente, consulta [Avanzato: layout manuale](#avanzato-layout-manuale).

## Il Provider Rebase

`<Rebase>` è il provider principale (root) che rende disponibili tutte le funzionalità di Rebase ai componenti figli tramite context. Accetta:

Tutte e ventitré, per intero — in precedenza la tabella ne elencava dieci, e due di queste erano prop che il componente non leggeva mai:

<!-- rebase-props:start -->
| Prop | Descrizione |
|------|-------------|
| `children` | I componenti root dell'admin — `<RebaseCMS>`, `<RebaseStudio>`, `<RebaseShell>`. Una render function funge da soluzione alternativa per il layout manuale. |
| `apiUrl` | URL di base dell'API backend, resa disponibile a ogni hook tramite `useApiConfig()` |
| `dateTimeFormat` | Formato di visualizzazione delle date. Il valore predefinito è `MMMM dd, yyyy, HH:mm:ss` |
| `locale` | Lingua iniziale dell'admin e locale in cui vengono formattate le date — vedi [Traduzioni](/docs/frontend/i18n) |
| `client` | Istanza di `RebaseClient`: la sorgente predefinita per dati, autenticazione e storage |
| `dataSources` | Origini dati aggiuntive, per le collection che ne indicano una — vedi [Sorgenti multiple](/docs/backend/multiple-sources) |
| `authController` | Stato e metodi di autenticazione. Sostituisce completamente la sottoscrizione a `client.auth` |
| `storageSource` | La sorgente di storage predefinita, che sovrascrive `client.storage` |
| `storageSources` | Sorgenti di storage con nome oltre a quella predefinita |
| `databaseAdmin` | Operazioni amministrative sul database (SQL, schema discovery). Richiesto solo da Studio |
| `userConfigPersistence` | Preferenze UI locali — larghezza delle colonne, gruppi compressi |
| `onAnalyticsEvent` | Chiamato per ogni evento di analisi emesso dall'admin |
| `entityLinkBuilder` | `({ row, id, path }) => string`: l'URL per il pulsante "apri nella tua app" su un record, a partire dal record così come il server invia la riga |
| `plugins` | Istanze di plugin — vedi [Plugin](/docs/plugins) |
| `slots` | Contributi di slot dichiarati direttamente, senza un plugin |
| `propertyConfigs` | Widget di campo personalizzati, indicizzati tramite il nome specificato da una proprietà in `propertyConfig` |
| `entityViews` | Schede di vista entità personalizzate, disponibili per qualsiasi collection che specifichi la relativa `key` in `admin.entityViews` |
| `collectionViews` | Modalità di visualizzazione personalizzate per le collection, disponibili per qualsiasi collection tramite `key` |
| `entityActions` | Azioni per entità, disponibili per qualsiasi collection che specifichi la relativa `key` in `admin.entityActions` |
| `effectiveRoleController` | Simula un ruolo differente mentre la modalità dev è attiva |
| `modeController` | Passa a Rebase la modalità chiara/scura dell'app host; Rebase non toccherà mai `<html>`, `prefers-color-scheme` o il localStorage — vedi [Stili](#stili) |
| `translations` | Sovrascrivi o estendi qualsiasi stringa dell'interfaccia utente, indicizzata per lingua — vedi [Traduzioni](/docs/frontend/i18n) |
| `components` | Sostituisci i componenti integrati — vedi [Override dei componenti](/docs/frontend/component-overrides) |
<!-- rebase-props:end -->

I controller per navigazione, URL e registro delle collection **non** sono prop di `<Rebase>` — vengono creati dagli hook seguenti e utilizzati all'interno dell'albero dell'admin (`<RebaseShell>` li collega automaticamente nello scaffold predefinito).

Lo stesso vale per il prefisso dell'URL. Quando l'admin viene montato sotto un percorso, questo appartiene a `<RebaseCMS basePath="/admin">`, che è ciò che risolve gli URL nelle collection — e solo quando il router non ha un proprio `basename`. Consulta [Modificare l'URL di base](/docs/getting-started/deployment#changing-the-base-url).

## Un'unica struttura dati

<span class="since-badge" data-since="0.29">Da 0.29</span>
Il tuo codice riceve le righe così come le invia il server, ovunque vengano richieste: `client.data`, `context.data` (sia in un callback backend che nel browser), `useRows`, `useRow` e `useRowWrites`, il `data` dei builder di collection e viste, e ciò che viene passato ai `browserCallbacks` di una collection. Una riga è un oggetto piatto: `row.title`, una data come stringa ISO, una relazione belongsTo come colonna della chiave esterna.

```tsx
// Anywhere, including outside React.
const { data: posts } = await client.data.posts.find();
posts[0].title;

// Inside the <Rebase> tree: the same rows, kept current after every write.
const { rows } = useRows("posts");
rows[0].title;
```

L'admin stesso effettua il rendering di un view model `Entity` — il wrapper di `id` / `path` / `values` da cui attingono le viste di collection e i form, con date come oggetti `Date` e relazioni come `EntityRelation`. Questo layer è interno all'admin e non fa parte dell'interfaccia pubblica: a un'azione di entità, a un display resolver, a `tableController.rows` del `Builder` di una modalità di visualizzazione, alla selezione di un'azione di collection e a uno slot vengono sempre passate righe, con l'id di ciascun record accanto alla rispettiva riga. Si incontra `Entity` solo in una copia di una delle parti native dell'admin (`Collection.Table`, una card), a cui viene passato il record così come l'admin lo disegna. I valori di un form sono quelli dell'editor: oggetti `Date` e relazioni, così come vengono modificati da un campo.

## Una singola collection o un singolo record in una tua pagina

Non è necessario l'intero admin per mostrare una singola tabella. `<CollectionPanel>`, `<RecordForm>`, `<RecordDetail>` e `<FieldValue>` funzionano ovunque sotto `<Rebase>` e un router React Router, senza richiedere `<RebaseCMS>`, `<RebaseNavigation>` o `<RebaseShell>`: una collection con le colonne e la toolbar che preferisci, il form di un record con solo alcuni campi o con un layout personalizzato, un record di sola lettura o un singolo valore renderizzato come farebbe l'admin. Consulta [Pannelli in una tua pagina](/docs/frontend/panels).

## Avanzato: layout manuale

Tutto ciò che segue sostituisce `<RebaseShell>`. Ne hai bisogno solo quando il layout predefinito rappresenta un ostacolo — una cornice differente attorno all'admin, un albero di route personalizzato, un'app in cui l'admin è solo una pagina tra le tante. Se non devi sostituire il layout, puoi fermarti a [Viste personalizzate](#viste-personalizzate).

`<RebaseShell>` è zucchero sintattico per quattro layer distinti, che puoi adottare singolarmente:

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

L'ordine è obbligatorio: `RebaseAuthGate → RebaseNavigation → RebaseRouteDefs → RebaseLayout`. `RebaseAuthGate` mostra la vista di login finché non è presente un utente, quindi nulla di ciò che si trova al di sotto viene renderizzato per un visitatore non autenticato; `RebaseNavigation` crea i controller per navigazione, URL e registro delle collection letti da `RebaseRouteDefs` e da ogni vista di collection, pertanto `RebaseRouteDefs` genererà un errore se utilizzato al suo esterno. Per incorporare la vista di una collection o il form di un record in una tua pagina senza le route dell'admin, il più leggero `CollectionsProvider` crea tali controller in sua vece — consulta [Pannelli in una tua pagina](/docs/frontend/panels).

Ciascun layer può essere utilizzato autonomamente. `<RebaseAuthGate>` da solo protegge la tua app dietro l'autenticazione di Rebase. Sostituisci `<RebaseLayout>` con un componente personalizzato per mantenere il routing eliminando la cornice grafica; rimuovi anche `<RebaseRouteDefs>` per costruire direttamente le route utilizzando i componenti descritti in [Componenti Scaffold](#componenti-scaffold).

Al livello più basso, `<Rebase>` accetta anche una **render prop** al posto dei children, fornendo il context e il flag di caricamento e lasciando l'intero albero nelle tue mani:

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

A quel punto non ci sarà nulla di preconfigurato: dovrai creare i controller sottostanti manualmente ed eseguire tu stesso il rendering delle route.

### Controller

I controller sono hook React che configurano aspetti specifici del framework. `<RebaseNavigation>` li chiama tutti per te — utilizzali direttamente solo all'interno di una render prop.

#### `useBuildNavigationStateController`

Il controller principale che collega ogni cosa:

Il suo parametro `data` è ciò che viene fornito ai builder di collection e viste: il `context.data` piatto dell'elemento `<Rebase>` contenitore (vedi [Un'unica struttura dati](#ununica-struttura-dati)), pertanto questo hook deve essere chiamato all'interno dell'albero di `<Rebase>`.

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

Gestisce il tema chiaro/scuro. Quando è abilitato, controlla il tema della pagina: applica la classe `dark` su `<html>`, segue `prefers-color-scheme` finché l'utente non seleziona una modalità e memorizza tale preferenza in localStorage.

```typescript
const modeController = useBuildModeController();

modeController.mode;             // "light" | "dark"
modeController.setMode("dark");  // "light" | "dark" | "system" — "system" follows the OS again
```

`<Rebase>` ne crea uno autonomamente.

Quando il componente che lo utilizza viene smontato, rimuove la classe `dark` che aveva aggiunto; un'eventuale classe `dark` già presente nella pagina viene mantenuta. Crea il tuo controller al di sopra di `<Rebase>` solo quando anche componenti esterni necessitano della modalità, e passalo tramite la [prop `modeController`](#stili), così da avere un solo controller invece di due. `useBuildModeController({ enabled: false })` genera un controller inerte: mantiene `mode` nello stato di React e non interagisce con classi, media query o localStorage. Se la tua app gestisce già il tema, non hai bisogno di questo hook: passa direttamente il tuo controller come `modeController`.

#### `useBuildAdminModeController`

Consente di alternare tra la modalità Studio e la modalità Content:

```typescript
const adminModeController = useBuildAdminModeController();
// Provides: adminModeController.mode ("cms" | "studio")
```

### Componenti Scaffold

| Componente | Descrizione |
|-----------|-------------|
| `<Scaffold>` | Container di layout principale con barra laterale reattiva (responsive) |
| `<AppBar>` | Barra di navigazione superiore con ricerca, selettore di modalità e menu utente |
| `<Drawer>` | Navigazione laterale con elenco delle collection e collegamenti alle viste |
| `<SideDialogs>` | Contenitore per gli editor di entità a pannello laterale |
| `<RebaseRoutes>` | Contenitore di route che si integra con React Router |
| `<RebaseRoute>` | Gestisce le route delle collection (`/c/*`) |
| `<ContentHomePage>` | Home page predefinita che mostra le schede delle collection |
| `<StudioHomePage>` | Home page della modalità Studio con gli strumenti per sviluppatori |

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

Passali a `<RebaseCMS>`, insieme alle tue collection — questo è il componente deputato alla registrazione della navigazione:

```tsx
<RebaseCMS collections={collections} views={views}/>
```

| Campo | |
|---|---|
| `slug` | il percorso a cui è raggiungibile, sotto la root dell'admin |
| `name` | l'etichetta nel drawer e nella home page |
| `view` | l'elemento da renderizzare, o un `ComponentType` per caricarlo in modalità lazy |
| `icon` | il nome di un'icona [Lucide](https://lucide.dev/icons/), ad es. `"ShoppingCart"` — o qualsiasi nodo |
| `group` | raggruppa le viste nel drawer; `"Admin"` e `"Settings"` vengono posizionati in fondo |
| `pinToBottom` | sposta il gruppo in fondo indipendentemente dal nome — preferibile rispetto alle due stringhe predefinite |
| `nestedRoutes` | registra anche `slug/*`, per le viste che gestiscono route interne |
| `hideFromNavigation` | mantiene la route, ma la rimuove dalla barra di navigazione |
| `roles` | solo gli utenti con uno di questi ruoli possono vedere la vista o accedervi |
| `description` | Markdown, mostrato nella scheda della home page |

Per posizionare una vista sotto **Studio** anziché nel CMS, passala a [`<RebaseStudio devViews>`](/docs/studio#adding-your-own-tool).

## Stili

Rebase utilizza **Tailwind CSS v4** e supporta la modalità chiara/scura. Puoi personalizzarlo tramite:

- **Proprietà CSS personalizzate (custom properties)** — Sovrascrivi i design token
- **`<Rebase modeController>`** — Passa a Rebase la modalità chiara/scura della tua app
- **Configurazione Tailwind** — Personalizzazione standard di Tailwind

```css
/* Override design tokens */
:root {
    --font-sans: "Instrument Sans", sans-serif;
    --font-headers: "Instrument Sans", sans-serif;
    --font-mono: "JetBrains Mono", monospace;
}
```

### Modalità chiara e scura

Per impostazione predefinita, `<Rebase>` controlla il tema della pagina: applica la classe `dark` a `<html>`, segue `prefers-color-scheme` finché l'utente non sceglie una modalità nell'admin e memorizza tale selezione in localStorage.

Quando `<Rebase>` viene smontato, rimuove la classe `dark` aggiunta; un'eventuale classe già presente sulla pagina viene mantenuta. Nella versione 0.24 la classe non veniva rimossa.

Se la tua app gestisce già un tema, forniscilo come `modeController`. Rebase leggerà `mode` da esso, chiamerà il suo `setMode` tramite il proprio selettore di tema e non toccherà mai `<html>`, `prefers-color-scheme` o localStorage:

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

Il CSS dello scaffold applica lo stile della modalità scura a qualsiasi elemento con la classe `dark` (`@custom-variant dark (&:where(.dark, .dark *))`). I pannelli laterali, le finestre di dialogo e i menu vengono renderizzati all'interno di un portale su `<body>`, pertanto è opportuno applicare la classe su `<html>` o su `<body>` anziché su un contenitore attorno a `<Rebase>`.

Avvolgere `<Rebase>` in un `ModeControllerProvider` non produce questo effetto: `<Rebase>` fornisce già un proprio controller al suo interno. Nella versione 0.24 questa prop non esiste e non è possibile trasmettere a `<Rebase>` la modalità della propria app.

## Passaggi successivi

- **[Campi personalizzati](/docs/frontend/custom-fields)** — Crea campi di form personalizzati
- **[Viste entità](/docs/frontend/entity-views)** — Aggiungi schede agli editor delle entità
- **[Modalità di visualizzazione](/docs/frontend/view-modes)** — Lista, Tabella, Card, Kanban
- **[Traduzioni](/docs/frontend/i18n)** — Modifica qualsiasi stringa o aggiungi una lingua
- **[Plugin](/docs/plugins)** — Estendi il framework
