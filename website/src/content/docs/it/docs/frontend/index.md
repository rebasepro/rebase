---
sourceHash: 648bcb814d96b084
title: Panoramica del frontend
sidebar_label: Frontend
description: "Costruisci e personalizza il pannello — Rebase CMS e Rebase Studio — con React: controller, scaffold, routing e viste."
---

## Panoramica

Il frontend di Rebase è un **framework React** che renderizza il tuo pannello di amministrazione. Legge le definizioni delle tue collection e genera automaticamente tabelle, form, navigazione e routing.

Nello scaffold predefinito, il pannello di amministrazione **è** il frontend: viene servito alla radice dell'URL di deploy. Se invece crei la tua app di prodotto, puoi montare l'admin sotto un prefisso come `/admin` nello stesso deployment — consulta [Modificare l'URL di base](/docs/getting-started/deployment#changing-the-base-url).

Questo è `frontend/src/App.tsx` così come viene scritto da `rebase init`, senza le importazioni dei font, l'error boundary e il Google client id — l'intero pannello di amministrazione, quattro dichiarazioni all'interno di un unico provider:

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

I primi tre non renderizzano nulla: *registrano* la configurazione nel provider. `<RebaseShell>` è ciò che disegna l'interfaccia — legge quel registro e costruisce la navigazione, le route e il layout a partire da esso. Quindi l'ordine in cui appaiono non ha importanza, e aggiungere una funzionalità significa aggiungere un componente, non ricablare un albero.

| Componente | Pacchetto | Registra |
|---|---|---|
| `<RebaseAuth>` | `@rebasepro/app` | la schermata di accesso (`loginView`) |
| `<RebaseCMS>` | `@rebasepro/cms` | collection, viste personalizzate, la home page, l'editor delle collection |
| `<RebaseStudio>` | `@rebasepro/studio` | gli strumenti per sviluppatori (SQL, RLS, log, backup…) |
| `<RebaseShell>` | `@rebasepro/cms` | nulla — renderizza l'admin a partire da tutto ciò che precede |

Rimuovi `<RebaseStudio>` e otterrai un CMS dedicato esclusivamente ai contenuti; rimuovi `<RebaseCMS>` e avrai solo gli strumenti per sviluppatori. Per strutturare manualmente la shell, consulta [Avanzato: layout manuale](#avanzato-layout-manuale).

## Il provider Rebase

`<Rebase>` è il provider radice che rende disponibili tutte le funzionalità di Rebase ai componenti figli tramite context. Accetta:

Tutte e ventitré, per intero — in precedenza la tabella ne elencava dieci, e due di queste erano prop che il componente non leggeva mai:

<!-- rebase-props:start -->
| Prop | Descrizione |
|------|-------------|
| `children` | I componenti radice dell'admin — `<RebaseCMS>`, `<RebaseStudio>`, `<RebaseShell>`. Una funzione di render è la via di fuga per il layout manuale. |
| `apiUrl` | URL di base dell'API di backend, reso disponibile a ogni hook tramite `useApiConfig()` |
| `dateTimeFormat` | Come vengono stampate le date. Il valore predefinito è `MMMM dd, yyyy, HH:mm:ss` |
| `locale` | Lingua iniziale dell'admin e locale utilizzato per formattare le date — vedi [Traduzioni](/docs/frontend/i18n) |
| `client` | Istanza di `RebaseClient`: la sorgente predefinita per dati, autenticazione e storage |
| `dataSources` | Sorgenti dati aggiuntive, per le collection che ne specificano una — vedi [Sorgenti multiple](/docs/backend/multiple-sources) |
| `authController` | Stato e metodi di autenticazione. Sostituisce completamente la sottoscrizione `client.auth` |
| `storageSource` | La sorgente di storage predefinita, che sovrascrive `client.storage` |
| `storageSources` | Sorgenti di storage con nome oltre a quella predefinita |
| `databaseAdmin` | Operazioni amministrative sul database (SQL, schema discovery). Necessario solo per Studio |
| `userConfigPersistence` | Preferenze UI locali — larghezza delle colonne, gruppi compressi |
| `onAnalyticsEvent` | Chiamato per ogni evento di analytics emesso dall'admin |
| `entityLinkBuilder` | `({ row, id, path }) => string`: l'URL per il pulsante "apri nella tua app" su un record, a partire dal record così come il server invia la riga |
| `plugins` | Istanze di plugin — vedi [Plugin](/docs/plugins) |
| `slots` | Contributi agli slot dichiarati direttamente, senza un plugin |
| `propertyConfigs` | Widget di campo personalizzati, indicizzati in base al nome specificato da una proprietà in `propertyConfig` |
| `entityViews` | Tab personalizzati delle viste entità, disponibili per qualsiasi collection che specifichi la loro `key` in `admin.entityViews` |
| `collectionViews` | Modalità personalizzate di vista collection, disponibili per qualsiasi collection tramite `key` |
| `entityActions` | Azioni entità, disponibili per qualsiasi collection che specifichi la loro `key` in `admin.entityActions` |
| `effectiveRoleController` | Simula un ruolo diverso quando la modalità dev è attiva |
| `modeController` | Passa a Rebase la modalità chiaro/scuro dell'app host; Rebase quindi non toccherà mai `<html>`, `prefers-color-scheme` o localStorage — vedi [Stile](#stile) |
| `translations` | Sovrascrivi o estendi qualsiasi stringa dell'interfaccia utente, indicizzata per locale — vedi [Traduzioni](/docs/frontend/i18n) |
| `components` | Sostituisci i componenti integrati — vedi [Override dei componenti](/docs/frontend/component-overrides) |
<!-- rebase-props:end -->

I controller per navigazione, URL e registro delle collection **non** sono prop di `<Rebase>` — vengono creati dagli hook sottostanti e consumati all'interno dell'albero dell'admin (`<RebaseShell>` li collega per te nello scaffold predefinito).

Nemmeno il prefisso dell'URL lo è. Quando l'admin viene montato sotto un percorso, questo appartiene a `<RebaseCMS basePath="/admin">`, che è ciò che risolve gli URL nelle collection — e solo quando il router non ha un proprio `basename`. Consulta [Modificare l'URL di base](/docs/getting-started/deployment#changing-the-base-url).

## Un unico formato dati

<span class="since-badge" data-since="0.29">Da 0.29</span>
Il tuo codice riceve le righe così come le invia il server, ovunque le richieda: `client.data`, `context.data` (sia in un callback di backend che nel browser), `useRows`, `useRow` e `useRowWrites`, il parametro `data` dei builder di collection e viste, e ciò che viene passato ai `browserCallbacks` di una collection. Una riga è un oggetto piatto: `row.title`, una data come stringa ISO, un belongsTo come colonna di chiave esterna.

```tsx
// Anywhere, including outside React.
const { data: posts } = await client.data.posts.find();
posts[0].title;

// Inside the <Rebase> tree: the same rows, kept current after every write.
const { rows } = useRows("posts");
rows[0].title;
```

L'admin stesso renderizza un view model `Entity` — il wrapper con `id` / `path` / `values` da cui attingono le viste delle collection e i form, con date come istanze di `Date` e una relazione come `EntityRelation`. Quel livello appartiene internamente all'admin e non fa parte dell'interfaccia pubblica: a un'azione di entità, a un display resolver, al `tableController.rows` del `Builder` di una modalità di vista, alla selezione di un'azione di collection e a uno slot vengono passate tutte righe, con l'id di ciascun record accanto alla propria riga. Si incontra `Entity` solo in una copia di una delle parti interne dell'admin (`Collection.Table`, una card), a cui viene passato il record nel modo in cui l'admin lo disegna. I valori di un form sono quelli dell'editor: `Date` e relazioni, come vengono modificati da un campo.

## Una singola collection o un singolo record in una pagina personalizzata

Non hai bisogno dell'intero admin per mostrare una singola tabella. `<CollectionPanel>`, `<EntityFormPanel>`, `<RecordDetail>` e `<FieldValue>` funzionano ovunque sotto `<Rebase>` e un router React Router, senza `<RebaseCMS>`, `<RebaseNavigation>` o `<RebaseShell>`: una collection con le colonne e la barra degli strumenti che preferisci, il form di un singolo record con solo alcuni campi o con il tuo layout, un record in sola lettura o un singolo valore renderizzato come lo disegna l'admin. Consulta [Pannelli in una pagina personalizzata](/docs/frontend/panels).

## Avanzato: layout manuale

Tutto ciò che segue sostituisce `<RebaseShell>`. Ne hai bisogno solo quando il layout predefinito rappresenta un ostacolo: una cornice grafica diversa intorno all'admin, un albero di route personalizzato, un'applicazione in cui l'admin è solo una pagina tra le tante. Se non intendi sostituire il layout, puoi fermarti a [Viste personalizzate](#viste-personalizzate).

`<RebaseShell>` è zucchero sintattico per quattro livelli, e puoi utilizzarli uno alla volta:

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

L'ordine è fisso: `RebaseAuthGate → RebaseNavigation → RebaseRouteDefs → RebaseLayout`. `RebaseAuthGate` mostra la vista di login finché non è presente un utente, quindi nulla al di sotto di esso viene renderizzato per un visitatore non autenticato; `RebaseNavigation` crea i controller per navigazione, URL e registro delle collection letti da `RebaseRouteDefs` e da ogni vista di collection, pertanto l'utilizzo di `RebaseRouteDefs` al di fuori di esso genererà un errore. Per incorporare una vista di collection o il form di un record in una pagina personalizzata, senza le route dell'admin, il componente più leggero `CollectionsProvider` crea invece questi controller — consulta [Pannelli in una pagina personalizzata](/docs/frontend/panels).

Ciascun livello può essere utilizzato singolarmente. Solo `<RebaseAuthGate>` protegge la tua applicazione dietro il login di Rebase. Sostituisci `<RebaseLayout>` con un tuo componente per mantenere il routing ed eliminare l'interfaccia predefinita; rimuovi anche `<RebaseRouteDefs>` per costruire autonomamente le route utilizzando i componenti descritti in [Componenti dello scaffold](#componenti-dello-scaffold).

Al di sotto di questo livello, `<Rebase>` accetta anche una **render prop** invece dei children, che ti fornisce il context e il flag di caricamento lasciando a te la gestione dell'intero albero:

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

A quel punto nulla è configurato automaticamente: dovrai costruire a mano i controller sottostanti e renderizzare autonomamente le route.

### Controller

I controller sono hook React che configurano aspetti specifici del framework. `<RebaseNavigation>` li invoca tutti per te — utilizzali direttamente solo all'interno di una render prop.

#### `useBuildNavigationStateController`

Il controller principale che collega tutto insieme:

Il suo parametro `data` è ciò che viene passato ai builder di collection e viste: il `context.data` piatto del `<Rebase>` contenitore (vedi [Un unico formato dati](#un-unico-formato-dati)), pertanto questo hook deve essere chiamato all'interno dell'albero di `<Rebase>`.

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

Gestisce il modo in cui le collection vengono risolte dai percorsi URL:

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

Gestisce il tema chiaro/scuro. Quando è abilitato, controlla il tema della pagina: applica la classe `dark` su `<html>`, segue `prefers-color-scheme` fino a quando l'utente non seleziona una modalità e memorizza tale preferenza in localStorage.

```typescript
const modeController = useBuildModeController();

modeController.mode;             // "light" | "dark"
modeController.setMode("dark");  // "light" | "dark" | "system" — "system" follows the OS again
```

`<Rebase>` ne crea uno autonomamente.

Quando il componente che lo utilizza si smonta, rimuove la classe `dark` che aveva aggiunto; un'eventuale classe `dark` già presente nella pagina rimane. Crea il tuo controller al di sopra di `<Rebase>` solo quando anche i componenti esterni necessitano della modalità, e passalo tramite la [prop `modeController`](#stile), in modo da avere un unico controller anziché due. `useBuildModeController({ enabled: false })` crea un controller inerte: mantiene `mode` nello stato di React e non modifica alcuna classe, media query o localStorage. Quando la tua applicazione gestisce già il tema, non hai affatto bisogno di questo hook: passa semplicemente il tuo controller come `modeController`.

#### `useBuildAdminModeController`

Alterna tra la modalità Studio e la modalità Contenuti:

```typescript
const adminModeController = useBuildAdminModeController();
// Provides: adminModeController.mode ("cms" | "studio")
```

### Componenti dello scaffold

| Componente | Descrizione |
|-----------|-------------|
| `<Scaffold>` | Contenitore principale del layout con barra laterale responsive |
| `<AppBar>` | Barra di navigazione superiore con ricerca, selettore tema, menu utente |
| `<Drawer>` | Navigazione laterale con elenco delle collection e link alle viste |
| `<SideDialogs>` | Contenitore per i pannelli laterali di modifica delle entità |
| `<RebaseRoutes>` | Contenitore delle route che si integra con React Router |
| `<RebaseRoute>` | Gestisce le route delle collection (`/c/*`) |
| `<ContentHomePage>` | Home page predefinita che mostra le card delle collection |
| `<StudioHomePage>` | Home page della modalità Studio con strumenti per sviluppatori |

## Viste personalizzate

Aggiungi viste di navigazione di primo livello per dashboard, strumenti o pagine personalizzate. Un oggetto `AppView` è piatto: tutto ciò che segue si trova al livello principale, non è presente alcun blocco `admin` nidificato:

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

Passali a `<RebaseCMS>`, insieme alle tue collection — è questo il componente che registra la navigazione:

```tsx
<RebaseCMS collections={collections} views={views}/>
```

| Campo | |
|---|---|
| `slug` | il percorso con cui viene raggiunta, sotto la radice dell'admin |
| `name` | l'etichetta nel drawer e nella home page |
| `view` | l'elemento da renderizzare, oppure un `ComponentType` per il caricamento lazy |
| `icon` | il nome di un'icona [Lucide](https://lucide.dev/icons/), ad es. `"ShoppingCart"` — o qualsiasi nodo |
| `group` | raggruppa le viste nel drawer; `"Admin"` e `"Settings"` vengono posizionati in fondo |
| `pinToBottom` | posiziona il gruppo in fondo indipendentemente dal nome — preferibile rispetto alle due stringhe predefinite |
| `nestedRoutes` | registra anche `slug/*`, per una vista con route proprie |
| `hideFromNavigation` | mantiene la route, ma rimuove la voce di navigazione |
| `roles` | solo gli utenti che possiedono uno di questi ruoli vedono la vista o possono accedervi |
| `description` | Markdown, mostrato sulla card della home page |

Per posizionare una vista in **Studio** invece che nel CMS, passala a [`<RebaseStudio devViews>`](/docs/studio#adding-your-own-tool).

## Stile

Rebase utilizza **Tailwind CSS v4** e supporta le modalità chiaro/scuro. Personalizzabile tramite:

- **Custom property CSS** — Sovrascrivi i design token
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

Per impostazione predefinita `<Rebase>` controlla il tema della pagina: inserisce la classe `dark` su `<html>`, segue `prefers-color-scheme` fino a quando l'utente non seleziona una modalità nell'admin e memorizza tale preferenza in localStorage.

Quando `<Rebase>` viene smontato, rimuove la classe `dark` che aveva aggiunto; una classe già presente nella pagina rimane invariata. Nella versione 0.24 la classe non veniva rimossa.

Quando la tua applicazione ha già un tema, passalo come `modeController`. Rebase leggerà `mode` da esso, chiamerà il suo `setMode` tramite il proprio selettore di tema e non toccherà mai `<html>`, `prefers-color-scheme` o localStorage:

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

Il CSS dello scaffold applica lo stile della modalità scura a qualsiasi elemento con la classe `dark` (`@custom-variant dark (&:where(.dark, .dark *))`). Pannelli laterali, finestre di dialogo e menu vengono renderizzati all'interno di un portal su `<body>`, quindi inserisci la classe su `<html>` o `<body>` anziché su un wrapper intorno a `<Rebase>`.

Avvolgere `<Rebase>` in un `ModeControllerProvider` non produce questo risultato: `<Rebase>` fornisce un proprio controller al suo interno. Nella versione 0.24 la prop non esiste e non c'è modo di passare a `<Rebase>` la modalità della tua app.

## Prossimi passi

- **[Campi personalizzati](/docs/frontend/custom-fields)** — Crea campi form personalizzati
- **[Viste entità](/docs/frontend/entity-views)** — Aggiungi tab agli editor di entità
- **[Modalità di vista](/docs/frontend/view-modes)** — Elenco, Tabella, Card, Kanban
- **[Traduzioni](/docs/frontend/i18n)** — Modifica qualsiasi stringa o aggiungi una lingua
- **[Plugin](/docs/plugins)** — Estendi il framework
