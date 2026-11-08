---
sourceHash: 0b034023f28eb28f
title: Panoramica Frontend
sidebar_label: Frontend
description: "Costruisci e personalizza il pannello — Rebase CMS e Rebase Studio — con React: controller, scaffold, routing e viste."
---

## Panoramica

Il frontend di Rebase è un **framework React** che esegue il rendering del tuo pannello di amministrazione. Legge le definizioni delle tue collezioni e genera automaticamente tabelle, form, navigazione e routing.

Nello scaffold predefinito, il pannello di amministrazione **è** il frontend: viene servito alla radice dell'URL del tuo deployment. Se invece crei la tua applicazione di prodotto, puoi montare l'admin sotto un prefisso come `/admin` nello stesso deployment — vedi [Modifica del Base URL](/docs/getting-started/deployment#changing-the-base-url).

Questo è `frontend/src/App.tsx` così come viene generato da `rebase init`, senza le importazioni dei font, l'error boundary e il client ID Google — l'intero pannello di amministrazione, quattro dichiarazioni all'interno di un unico provider:

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

I primi tre non renderizzano nulla: *registrano* la configurazione nel provider. `<RebaseShell>` è ciò che disegna l'interfaccia — legge quel registro e costruisce la navigazione, le rotte e il layout a partire da esso. L'ordine in cui compaiono non ha quindi importanza, e aggiungere una funzionalità significa aggiungere un componente, non riconfigurare un albero.

| Componente | Pacchetto | Registra |
|---|---|---|
| `<RebaseAuth>` | `@rebasepro/app` | la schermata di accesso (`loginView`) |
| `<RebaseCMS>` | `@rebasepro/cms` | collezioni, viste personalizzate, la home page, l'editor delle collezioni |
| `<RebaseStudio>` | `@rebasepro/studio` | gli strumenti per sviluppatori (SQL, RLS, log, backup…) |
| `<RebaseShell>` | `@rebasepro/cms` | nulla — renderizza l'admin a partire da tutto quanto sopra |

Rimuovi `<RebaseStudio>` e otterrai un CMS per soli contenuti; rimuovi `<RebaseCMS>` e avrai unicamente gli strumenti per sviluppatori. Per strutturare la shell manualmente, vedi [Avanzate: layout manuale](#avanzate-layout-manuale).

## Il Rebase Provider

`<Rebase>` è il provider principale (root) che rende disponibili tutte le funzionalità di Rebase ai componenti figli tramite context. Accetta:

Tutte e ventitré, per intero — la tabella ne elencava dieci, e due di queste erano prop che il componente non leggeva mai:

<!-- rebase-props:start -->
| Prop | Descrizione |
|------|-------------|
| `children` | I componenti root dell'admin — `<RebaseCMS>`, `<RebaseStudio>`, `<RebaseShell>`. Una funzione di rendering è la via di fuga per il layout manuale. |
| `apiUrl` | URL di base dell'API backend, reso disponibile a ogni hook tramite `useApiConfig()` |
| `dateTimeFormat` | Come vengono stampate le date. Il valore predefinito è `MMMM dd, yyyy, HH:mm:ss` |
| `locale` | Lingua iniziale dell'admin e locale in cui sono formattate le date — vedi [Traduzioni](/docs/frontend/i18n) |
| `client` | Istanza di `RebaseClient`: la sorgente predefinita per dati, autenticazione e storage |
| `dataSources` | Sorgenti dati aggiuntive, per le collezioni che ne specificano una — vedi [Sorgenti multiple](/docs/backend/multiple-sources) |
| `authController` | Stato e metodi di autenticazione. Sostituisce del tutto la sottoscrizione a `client.auth` |
| `storageSource` | La sorgente di storage predefinita, sovrascrive `client.storage` |
| `storageSources` | Sorgenti di storage con nome oltre a quella predefinita |
| `databaseAdmin` | Operazioni amministrative del database (SQL, schema discovery). Necessario solo a Studio |
| `userConfigPersistence` | Preferenze UI locali — larghezza colonne, gruppi compressi |
| `onAnalyticsEvent` | Chiamato per ogni evento di analitica emesso dall'admin |
| `entityLinkBuilder` | `({ row, id, path }) => string`: l'URL per il pulsante "apri nella tua app" su un record, a partire dal record così come il server invia la riga |
| `plugins` | Istanze di plugin — vedi [Plugin](/docs/plugins) |
| `slots` | Contributi di slot dichiarati direttamente, senza un plugin |
| `propertyConfigs` | Widget per campi personalizzati, indicizzati in base al nome specificato da una proprietà in `propertyConfig` |
| `entityViews` | Schede personalizzate per le viste delle entità, disponibili per qualsiasi collezione che indichi la loro `key` in `admin.entityViews` |
| `collectionViews` | Modalità personalizzate di visualizzazione delle collezioni, disponibili per qualsiasi collezione tramite `key` |
| `entityActions` | Azioni di entità, disponibili per qualsiasi collezione che indichi la loro `key` in `admin.entityActions` |
| `effectiveRoleController` | Simula un ruolo diverso mentre la modalità di sviluppo è attiva |
| `modeController` | Passa a Rebase la modalità chiaro/scuro dell'app host; Rebase non toccherà mai `<html>`, `prefers-color-scheme` o localStorage — vedi [Stili](#stili) |
| `translations` | Sovrascrivi o estendi qualsiasi stringa dell'interfaccia, indicizzata per locale — vedi [Traduzioni](/docs/frontend/i18n) |
| `components` | Sostituisci i componenti integrati — vedi [Override dei componenti](/docs/frontend/component-overrides) |
<!-- rebase-props:end -->

I controller per la navigazione, gli URL e il registro delle collezioni **non** sono prop di `<Rebase>` — vengono creati dagli hook indicati di seguito e utilizzati all'interno dell'albero dell'admin (`<RebaseShell>` li collega per te nello scaffold predefinito).

Neppure il prefisso URL lo è. Quando l'admin viene montato sotto un percorso, questo appartiene a `<RebaseCMS basePath="/admin">`, che è ciò che risolve gli URL nelle collezioni — e solo quando il router non ha un proprio `basename`. Vedi [Modificare il Base URL](/docs/getting-started/deployment#changing-the-base-url).

## Un unico formato dei dati

<span class="since-badge" data-since="0.29">Since 0.29</span>
Il tuo codice riceve le righe così come le invia il server, ovunque le richieda: `client.data`, `context.data` (sia in un callback di backend che nel browser), `useRows`, `useRow` e `useRowWrites`, i `data` dei builder di collezioni e viste, e ciò che viene passato ai `browserCallbacks` di una collezione. Una riga è un oggetto piatto: `row.title`, una data come stringa ISO, un belongsTo come colonna di chiave esterna.

```tsx
// Anywhere, including outside React.
const { data: posts } = await client.data.posts.find();
posts[0].title;

// Inside the <Rebase> tree: the same rows, kept current after every write.
const { rows } = useRows("posts");
rows[0].title;
```

L'admin stesso renderizza un view model `Entity` — il wrapper con `id` / `path` / `values` da cui le sue viste di collezione e i form attingono, con le date come oggetti `Date` e una relazione come `EntityRelation`. Quel layer è interno all'admin e non fa parte dell'interfaccia pubblica: a un'azione di entità, a un resolver di visualizzazione, a `tableController.rows` nel `Builder` di una modalità di visualizzazione, alla selezione di un'azione di collezione e a uno slot vengono passate righe, con l'ID di ogni record accanto alla relativa riga. Incontri `Entity` solo in una copia di una delle parti proprie dell'admin (`Collection.Table`, una card), a cui viene passato il record così come l'admin lo disegna. I valori di un form sono quelli dell'editor: oggetti `Date` e relazioni, così come li modifica un campo.

## Una collezione o un singolo record in una pagina personalizzata

Non hai bisogno dell'intero pannello di amministrazione per mostrare una tabella. `<CollectionPanel>`, `<EntityFormPanel>`, `<EntityViewPanel>` e `<FieldValue>` funzionano ovunque all'interno di `<Rebase>` e di un router di React Router, senza `<RebaseCMS>`, `<RebaseNavigation>` o `<RebaseShell>`: una collezione con le colonne e la toolbar che preferisci, il form di un singolo record con solo alcuni campi o con un layout personalizzato, un singolo record in sola lettura, o un singolo valore visualizzato nello stesso modo in cui lo disegna l'admin. Vedi [Pannelli in una pagina personalizzata](/docs/frontend/panels).

## Avanzate: layout manuale

Tutto ciò che segue sostituisce `<RebaseShell>`. Ne hai bisogno solo quando il layout predefinito rappresenta un ostacolo — un'interfaccia (chrome) diversa attorno all'admin, un albero di rotte personalizzato, un'app in cui l'admin è solo una pagina tra le tante. Se non devi sostituire il layout, puoi fermarti a [Viste personalizzate](#viste-personalizzate).

`<RebaseShell>` è zucchero sintattico per quattro layer, e puoi utilizzarli uno alla volta:

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

L'ordine è fisso: `RebaseAuthGate → RebaseNavigation → RebaseRouteDefs → RebaseLayout`. `RebaseAuthGate` mostra la vista di login finché non c'è un utente, quindi nulla al di sotto di esso viene renderizzato per un visitatore non autenticato; `RebaseNavigation` crea i controller per navigazione, URL e registro delle collezioni letti da `RebaseRouteDefs` e da ogni vista di collezione, quindi `RebaseRouteDefs` al di fuori di esso genera un errore. Per incorporare una vista di collezione o il form di un record in una pagina personalizzata, senza le rotte dell'admin, il più leggero `CollectionsProvider` crea invece tali controller — vedi [Pannelli in una pagina personalizzata](/docs/frontend/panels).

Ciascun layer è utilizzabile singolarmente. `<RebaseAuthGate>` da solo protegge la tua app richiedendo il login di Rebase. Sostituisci `<RebaseLayout>` con un tuo componente per mantenere il routing senza la grafica standard; rimuovi anche `<RebaseRouteDefs>` e potrai costruire le rotte manualmente utilizzando i componenti in [Componenti di scaffold](#componenti-di-scaffold).

Al di sotto di questo livello, `<Rebase>` accetta anche una **render prop** invece di children, che ti fornisce il context e il flag di caricamento lasciando a te la gestione dell'intero albero:

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

A quel punto nulla è collegato automaticamente: dovrai costruire manualmente i controller descritti di seguito ed effettuare tu stesso il rendering delle rotte.

### Controller

I controller sono hook React che configurano aspetti specifici del framework. `<RebaseNavigation>` li chiama tutti per te — utilizzali direttamente solo all'interno di una render prop.

#### `useBuildNavigationStateController`

Il controller principale che collega tutto:

I suoi `data` corrispondono a ciò che viene passato ai builder di collezioni e viste: il `context.data` piatto del `<Rebase>` genitore (vedi [Un unico formato dei dati](#un-unico-formato-dei-dati)), pertanto questo hook deve essere chiamato all'interno dell'albero di `<Rebase>`.

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

Gestisce il modo in cui le collezioni vengono risolte a partire dai percorsi URL:

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

Gestisce il tema chiaro/scuro. Quando è abilitato controlla il tema della pagina: applica la classe `dark` su `<html>`, segue `prefers-color-scheme` finché l'utente non sceglie una modalità e memorizza tale preferenza in localStorage.

```typescript
const modeController = useBuildModeController();

modeController.mode;             // "light" | "dark"
modeController.setMode("dark");  // "light" | "dark" | "system" — "system" follows the OS again
```

`<Rebase>` ne crea uno autonomamente.

Quando il componente che lo utilizza viene smontato, rimuove la classe `dark` che aveva aggiunto; un'eventuale classe `dark` già presente nella pagina viene mantenuta. Creane uno tuo a monte di `<Rebase>` solo quando anche componenti esterni hanno bisogno della modalità, e passalo tramite la [prop `modeController`](#stili), in modo da avere un unico controller e non due. `useBuildModeController({ enabled: false })` crea un controller inerte: mantiene `mode` nello stato di React senza toccare classi, media query o localStorage. Quando la tua applicazione gestisce già il tema, non hai affatto bisogno di questo hook: passa semplicemente il tuo controller come `modeController`.

#### `useBuildAdminModeController`

Alterna tra le modalità Studio e Content:

```typescript
const adminModeController = useBuildAdminModeController();
// Provides: adminModeController.mode ("cms" | "studio")
```

### Componenti di scaffold

| Componente | Descrizione |
|-----------|-------------|
| `<Scaffold>` | Contenitore principale del layout con sidebar responsive |
| `<AppBar>` | Barra di navigazione superiore con ricerca, selettore tema, menu utente |
| `<Drawer>` | Navigazione laterale con elenco delle collezioni e link alle viste |
| `<SideDialogs>` | Contenitore per gli editor di entità nel pannello laterale |
| `<RebaseRoutes>` | Contenitore delle rotte integrato con React Router |
| `<RebaseRoute>` | Gestisce le rotte delle collezioni (`/c/*`) |
| `<ContentHomePage>` | Home page predefinita che mostra le card delle collezioni |
| `<StudioHomePage>` | Home page della modalità Studio con strumenti per sviluppatori |

## Viste personalizzate

Aggiungi viste di navigazione di primo livello per dashboard, strumenti o pagine personalizzate. Una `AppView` è un oggetto piatto — tutte le proprietà sottostanti risiedono al primo livello, non c'è alcun blocco `admin` annidato:

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

Passale a `<RebaseCMS>`, insieme alle tue collezioni — questo è il componente che registra la navigazione:

```tsx
<RebaseCMS collections={collections} views={views}/>
```

| Campo | |
|---|---|
| `slug` | il percorso con cui viene raggiunta, sotto la radice dell'admin |
| `name` | l'etichetta nel drawer e nella home page |
| `view` | l'elemento da renderizzare, oppure un `ComponentType` per il rendering lazy |
| `icon` | il nome di un'icona [Lucide](https://lucide.dev/icons/), ad es. `"ShoppingCart"` — o qualsiasi nodo |
| `group` | raggruppa le viste nel drawer; `"Admin"` e `"Settings"` vengono posizionati in fondo |
| `pinToBottom` | posiziona il gruppo in fondo indipendentemente dal nome — da preferire rispetto alle due stringhe magiche |
| `nestedRoutes` | registra anche `slug/*`, per una vista dotata di rotte interne |
| `hideFromNavigation` | mantiene la rotta, ma rimuove la voce di navigazione |
| `roles` | solo gli utenti con uno di questi ruoli possono vedere la vista o accedervi |
| `description` | Markdown, mostrato sulla card della home page |

Per posizionare una vista in **Studio** invece che nel CMS, passala a [`<RebaseStudio devViews>`](/docs/studio#adding-your-own-tool).

## Stili

Rebase utilizza **Tailwind CSS v4** e supporta le modalità chiaro/scuro. Personalizzabile tramite:

- **Proprietà custom CSS** — Sovrascrivi i design token
- **`<Rebase modeController>`** — Passa a Rebase la modalità chiaro/scuro della tua app
- **Configurazione Tailwind** — Personalizzazione standard di Tailwind

```css
/* Override design tokens */
:root {
    --font-sans: "Instrument Sans", sans-serif;
    --font-headers: "Instrument Sans", sans-serif;
    --font-mono: "JetBrains Mono", monospace;
}
```

### Modalità chiaro e scuro

Per impostazione predefinita `<Rebase>` gestisce il tema della pagina: assegna la classe `dark` a `<html>`, segue `prefers-color-scheme` finché l'utente non seleziona una modalità nell'admin e memorizza tale selezione in localStorage.

Quando `<Rebase>` viene smontato, rimuove la classe `dark` che aveva aggiunto; un'eventuale classe già presente nella pagina rimane. Nella versione 0.24 la classe non veniva rimossa.

Quando la tua app ha già un tema, passalo come `modeController`. Rebase leggerà `mode` da esso, chiamerà il rispettivo `setMode` dal proprio toggle del tema e non toccherà mai `<html>`, `prefers-color-scheme` o localStorage:

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

Il CSS dello scaffold applica gli stili della modalità scura a qualsiasi elemento con la classe `dark` (`@custom-variant dark (&:where(.dark, .dark *))`). I pannelli laterali, le finestre di dialogo e i menu vengono renderizzati all'interno di un portal su `<body>`, quindi applica la classe su `<html>` o `<body>` piuttosto che su un wrapper attorno a `<Rebase>`.

Avvolgere `<Rebase>` in un `ModeControllerProvider` non produce questo effetto: `<Rebase>` fornisce già un proprio controller al suo interno. Nella versione 0.24 la prop non esiste e non c'è modo di passare a `<Rebase>` la modalità della tua app.

## Prossimi passi

- **[Campi personalizzati](/docs/frontend/custom-fields)** — Crea campi per i form personalizzati
- **[Viste delle entità](/docs/frontend/entity-views)** — Aggiungi schede agli editor delle entità
- **[Modalità di visualizzazione](/docs/frontend/view-modes)** — Elenco, Tabella, Card, Kanban
- **[Traduzioni](/docs/frontend/i18n)** — Modifica qualsiasi stringa o aggiungi una lingua
- **[Plugin](/docs/plugins)** — Estendi il framework
