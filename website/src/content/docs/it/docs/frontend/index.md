---
sourceHash: 867178ccdf409a3f
title: Panoramica del Frontend
sidebar_label: Frontend
description: "Crea e personalizza il pannello — Rebase CMS e Rebase Studio — con React: controller, scaffold, routing e viste."
---

## Panoramica

Il frontend di Rebase è un **framework React** che esegue il rendering del pannello di amministrazione. Legge le definizioni delle tue collezioni e genera automaticamente tabelle, moduli, navigazione e routing.

Nello scaffold predefinito, il pannello di amministrazione **è** il frontend: viene servito alla radice dell'URL distribuito. Se invece crei la tua applicazione prodotto personalizzata, puoi montare l'admin sotto un prefisso come `/admin` nella stessa distribuzione — vedi [Modifica dell'URL di base](/docs/getting-started/deployment#changing-the-base-url).

Questo è `frontend/src/App.tsx` come viene scritto da `rebase init` — l'intero pannello di amministrazione, quattro dichiarazioni all'interno di un unico provider:

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

I primi tre non renderizzano nulla: *registrano* la configurazione nel provider. `<RebaseShell>` è ciò che disegna l'interfaccia — legge quel registro e costruisce la navigazione, i percorsi e il layout a partire da esso. Quindi l'ordine in cui compaiono non ha importanza, e aggiungere una funzionalità significa aggiungere un componente, non ricablare un albero.

| Componente | Pacchetto | Registra |
|---|---|---|
| `<RebaseAuth>` | `@rebasepro/app` | la schermata di accesso (`loginView`) |
| `<RebaseCMS>` | `@rebasepro/cms` | collezioni, viste personalizzate, la home page, l'editor delle collezioni |
| `<RebaseStudio>` | `@rebasepro/studio` | gli strumenti per sviluppatori (SQL, RLS, log, backup…) |
| `<RebaseShell>` | `@rebasepro/cms` | nulla — renderizza l'admin a partire da tutto quanto sopra |

Rimuovi `<RebaseStudio>` e otterrai un CMS dedicato solo ai contenuti; rimuovi `<RebaseCMS>` e avrai solo gli strumenti per sviluppatori. Per disporre manualmente la shell, vedi [Avanzate: layout manuale](#avanzate-layout-manuale).

## Il provider Rebase

`<Rebase>` è il provider radice che rende disponibile tutta la funzionalità di Rebase ai componenti figli tramite context. Accetta:

Tutte e ventitré, al completo — la tabella prima ne elencava dieci, e due di esse erano prop che il componente non leggeva mai:

<!-- rebase-props:start -->
| Prop | Descrizione |
|------|-------------|
| `children` | I componenti radice dell'admin — `<RebaseCMS>`, `<RebaseStudio>`, `<RebaseShell>`. Una render function rappresenta la via di fuga per il layout manuale. |
| `apiUrl` | URL di base dell'API di backend, reso disponibile a ogni hook tramite `useApiConfig()` |
| `dateTimeFormat` | Come vengono stampate le date. Il valore predefinito è `MMMM dd, yyyy, HH:mm:ss` |
| `locale` | Lingua iniziale dell'admin e locale con cui vengono formattate le date — vedi [Traduzioni](/docs/frontend/i18n) |
| `client` | Istanza di `RebaseClient`: la sorgente predefinita per dati, autenticazione e archiviazione |
| `dataSources` | Sorgenti dati aggiuntive, per le collezioni che ne specificano una — vedi [Sorgenti multiple](/docs/backend/multiple-sources) |
| `authController` | Stato e metodi di autenticazione. Sostituisce completamente la sottoscrizione a `client.auth` |
| `storageSource` | La sorgente di archiviazione predefinita, che sovrascrive `client.storage` |
| `storageSources` | Sorgenti di archiviazione con nome oltre a quella predefinita |
| `databaseAdmin` | Operazioni amministrative sul database (SQL, discovery dello schema). Necessario solo per Studio |
| `userConfigPersistence` | Preferenze UI locali — larghezza delle colonne, gruppi compressi |
| `onAnalyticsEvent` | Chiamato per ogni evento di analytics emesso dall'admin |
| `entityLinkBuilder` | Restituisce un URL per il pulsante "apri nella tua app" su un modulo di entità |
| `plugins` | Istanze di plugin — vedi [Plugin](/docs/plugins) |
| `slots` | Contributi slot dichiarati direttamente, senza un plugin |
| `propertyConfigs` | Widget di campo personalizzati, indicizzati in base al nome indicato da una proprietà in `propertyConfig` |
| `entityViews` | Schede di vista entità personalizzate globali |
| `collectionViews` | Modalità di visualizzazione personalizzate delle collezioni, disponibili per qualsiasi collezione tramite `key` |
| `entityActions` | Azioni globali sulle entità |
| `effectiveRoleController` | Simula un ruolo diverso mentre la modalità dev è attiva |
| `modeController` | Passa a Rebase la modalità chiaro/scuro dell'app ospitante; Rebase non tocca più `<html>`, `prefers-color-scheme` né localStorage — vedi [Stile](#stile) |
| `translations` | Sovrascrivi o estendi qualsiasi stringa dell'interfaccia utente, indicizzata per locale — vedi [Traduzioni](/docs/frontend/i18n) |
| `components` | Sostituisci i componenti integrati — vedi [Override dei componenti](/docs/frontend/component-overrides) |
<!-- rebase-props:end -->

I controller di navigazione, URL e registro delle collezioni **non** sono prop di `<Rebase>` — vengono creati dagli hook sottostanti e consumati all'interno dell'albero admin (`<RebaseShell>` li collega per te nello scaffold predefinito).

Non lo è nemmeno il prefisso URL. Quando l'admin viene montato sotto un percorso, questo appartiene a `<RebaseCMS basePath="/admin">`, che è ciò che risolve gli URL nelle collezioni — e solo quando il router non dispone di un proprio `basename`. Vedi [Modifica dell'URL di base](/docs/getting-started/deployment#changing-the-base-url).

## Due strutture di dati

Esistono due livelli di dati e **non** sono intercambiabili. Passare l'uno dove è previsto l'altro genera un errore di tipo, quindi è importante saperlo prima di collegare manualmente un controller.

| | Formato | Dove si ottiene | Come appare una riga |
|---|---|---|---|
| **SDK** | `RebaseSdkData` — righe piatte | `client.data` e `context.data` nei callback di backend | `row.title` |
| **Admin** | `RebaseData` — view-model `Entity` | `useData()`, all'interno dell'albero `<Rebase>` | `entity.values.title` |

Il livello SDK è la superficie pubblica e simmetrica: identico sul client frontend e nei callback di backend. Il livello `Entity` è il view-model dell'admin — aggiunge il wrapper `id` / `path` / `values` su cui si basano il rendering delle viste di collezione e dei moduli. `CollectionAccessor` e `FindResponse` appartengono ad esso e per tale motivo sono contrassegnati come `@internal`.

`<Rebase>` costituisce il confine tra i due: prende il tuo `client.data` piatto e lo racchiude con `wrapAsEntityData()` prima di fornirlo come `RebaseData` dell'admin. Non chiamerai mai questa funzione direttamente — basta estrarre il formato di cui hai bisogno dalla posizione corretta:

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

## Una collezione o un record in una pagina tua

Su 0.24
`CollectionPanel` accetta solo un `path` registrato e mostra "Collection not
found" fuori dall'albero completo dell'admin, mentre `EntityFormPanel` e
`CollectionsProvider` non esistono.

Non ti serve l'intero admin per mostrare una sola tabella. `<CollectionPanel>` accetta
la collezione come valore e funziona ovunque sotto `<Rebase>` e un router di React
Router, senza `<RebaseCMS>`, `<RebaseNavigation>` né `<RebaseShell>`:

```tsx
import { Rebase, useRebaseAuthController } from "@rebasepro/app";
import { CollectionPanel } from "@rebasepro/cms";
import { postsCollection } from "../config/collections/posts";
// Plus BrowserRouter, or any other router, from "react-router".

export function App() {
    const authController = useRebaseAuthController({ client });

    return (
        <Rebase client={client} authController={authController}>
            <BrowserRouter>
                <MyPageLayout>
                    <CollectionPanel collection={postsCollection}/>
                </MyPageLayout>
            </BrowserRouter>
        </Rebase>
    );
}
```

Un record si apre sopra la tua pagina, in un pannello laterale o in una finestra di
dialogo, e mai tramite URL: nessuna route dell'admin serve la pagina, quindi `full_screen`
e `split` si aprono come pannello laterale, e `useUrlController().routesMounted` è `false`
per i tuoi componenti lì. Va bene qualsiasi router: un semplice `<BrowserRouter>`, un
`<MemoryRouter>` o un data router. Un router è comunque richiesto. Un data router permette
inoltre a un record con modifiche non salvate di fermare la navigazione interna all'app;
con gli altri lo protegge soltanto il prompt di uscita dalla pagina del browser. Avvolgi il
pannello in `<RebaseAuthGate>` se vuoi che la pagina mostri prima l'accesso di Rebase.

`<EntityFormPanel>` fa lo stesso per il form di un singolo record. Carica il record
tramite `entityId`, lo salva attraverso il livello dati di `<Rebase>` come fa il form
dell'admin, e chiama `onSaved` dopo ogni salvataggio. Ometti `entityId` per creare un
record. `onClose` viene chiamato quando il form chiede di essere abbandonato, ad esempio
dopo l'eliminazione del suo record:

```tsx
<EntityFormPanel
    collection={postsCollection}
    entityId={postId}
    onSaved={({ entity }) => console.log("saved", entity.id)}
    onClose={() => navigate("/posts")}/>
```

Entrambi portano con sé un proprio `CollectionsProvider` quando non ce n'è uno sopra di
loro. È il passo sottostante, e puoi montarlo tu stesso per condividere un unico ambito
tra più pannelli, o per usare i componenti di livello più basso (`CollectionViewBinding`,
`useSidePanel`) al suo interno. Al suo interno, un pannello può indicare la propria
collezione per `path`:

```tsx
import { CollectionPanel, CollectionsProvider } from "@rebasepro/cms";

const collections = [postsCollection, authorsCollection];

<CollectionsProvider collections={collections}>
    <CollectionPanel path="posts"/>
    <CollectionPanel path="authors"/>
</CollectionsProvider>
```

`CollectionsProvider` conserva un registro delle collezioni che gli passi, con i
`modifyCollection` e gli `injectCollections` dei tuoi plugin applicati come nell'admin,
più i pannelli laterali e le finestre di dialogo in cui si aprono i record, e la guardia
contro le modifiche non salvate. Mantieni stabile l'array `collections`: una costante di
modulo, oppure `useMemo`.

## Avanzate: layout manuale

Tutto ciò che segue sostituisce `<RebaseShell>`. Ne hai bisogno solo se il layout predefinito è d'intralcio — un'interfaccia diversa attorno all'admin, un albero di percorsi personalizzato, un'app in cui l'admin è una pagina tra tante. Se non devi sostituire il layout, puoi fermarti a [Viste personalizzate](#viste-personalizzate).

`<RebaseShell>` è una sintassi semplificata per quattro livelli, e puoi gestirli uno alla volta:

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

L'ordine è fisso: `RebaseAuthGate → RebaseNavigation → RebaseRouteDefs → RebaseLayout`. `RebaseAuthGate` mostra la vista di login finché non è presente un utente, quindi nulla al di sotto di esso viene renderizzato per un visitatore non autenticato; `RebaseNavigation` crea i controller di navigazione, URL e registro delle collezioni letti da `RebaseRouteDefs` e da ogni vista di collezione, pertanto chiamare `RebaseRouteDefs` all'esterno genererà un'eccezione.
Per incorporare una
vista di collezione o il form di un record in una pagina tua, senza le route
dell'admin, il più leggero `CollectionsProvider` costruisce invece quei controller
— vedi
[Una collezione o un record in una pagina tua](#una-collezione-o-un-record-in-una-pagina-tua).

Ciascun livello è utilizzabile singolarmente. `<RebaseAuthGate>` da solo protegge la tua applicazione dietro il login di Rebase. Sostituisci `<RebaseLayout>` con un tuo componente per mantenere il routing eliminando l'interfaccia predefinita; rimuovi anche `<RebaseRouteDefs>` per costruire direttamente le route usando i componenti in [Componenti dello Scaffold](#componenti-dello-scaffold).

Oltre a ciò, `<Rebase>` accetta anche una **render prop** al posto dei children, passandoti il context e il flag di caricamento e lasciando a te l'intero albero:

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

A quel punto non c'è nulla di preconfigurato: dovrai creare i controller sottostanti manualmente ed eseguire il rendering dei percorsi in autonomia.

### Controller

I controller sono hook React che configurano aspetti specifici del framework. `<RebaseNavigation>` li chiama tutti per te — usali direttamente solo all'interno di una render prop.

#### `useBuildNavigationStateController`

Il controller principale che collega tutto insieme:

Il suo `data` è il `RebaseData` **in formato Entity**, quindi proviene da `useData()` — non da `rebaseClient.data`, che è il livello SDK a righe piatte. `<Rebase>` converte l'uno nell'altro per te (vedi [Due strutture di dati](#due-strutture-di-dati) più sotto), quindi questo hook deve essere chiamato all'interno dell'albero `<Rebase>`.

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

Gestisce il tema chiaro/scuro. Finché è abilitato possiede il tema della pagina: mette
la classe `dark` su `<html>`, segue `prefers-color-scheme` finché l'utente non sceglie una
modalità, e ricorda quella scelta in localStorage.

```typescript
const modeController = useBuildModeController();

modeController.mode;             // "light" | "dark"
modeController.setMode("dark");  // "light" | "dark" | "system" — "system" follows the OS again
```

`<Rebase>` ne costruisce uno da sé.

Quando il componente che lo
usa viene smontato, rimuove la classe `dark` che aveva aggiunto; una classe `dark` che la
pagina aveva già resta. Costruiscine uno tuo sopra `<Rebase>` solo quando anche i
componenti al suo esterno hanno bisogno della modalità, e passalo con la
[prop `modeController`](#stile), così c'è un solo controller e non due.
`useBuildModeController({ enabled: false })` costruisce un controller inerte: tiene
`mode` nello stato di React e non tocca alcuna classe, media query o localStorage. Quando
la tua app possiede già il tema, questo hook non ti serve affatto: passa il tuo controller
come `modeController`.

#### `useBuildAdminModeController`

Alterna tra le modalità Studio e Content:

```typescript
const adminModeController = useBuildAdminModeController();
// Provides: adminModeController.mode ("cms" | "studio")
```

### Componenti dello Scaffold

| Componente | Descrizione |
|-----------|-------------|
| `<Scaffold>` | Contenitore principale del layout con barra laterale responsive |
| `<AppBar>` | Barra di navigazione superiore con ricerca, selettore di modalità e menu utente |
| `<Drawer>` | Navigazione laterale con elenco delle collezioni e link alle viste |
| `<SideDialogs>` | Contenitore per gli editor di entità nel pannello laterale |
| `<RebaseRoutes>` | Contenitore di route che si integra con React Router |
| `<RebaseRoute>` | Gestisce i percorsi delle collezioni (`/c/*`) |
| `<ContentHomePage>` | Home page predefinita che mostra le schede delle collezioni |
| `<StudioHomePage>` | Home page della modalità Studio con gli strumenti per sviluppatori |

## Viste personalizzate

Aggiungi viste di navigazione di primo livello per dashboard, strumenti o pagine personalizzate. Un `AppView` è un oggetto piatto — tutto ciò che segue si trova al livello superiore, non c'è alcun blocco `admin` annidato:

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

Passale a `<RebaseCMS>`, insieme alle tue collezioni — è quello il componente che registra la navigazione:

```tsx
<RebaseCMS collections={collections} views={views}/>
```

| Campo | |
|---|---|
| `slug` | il percorso a cui è raggiungibile, sotto la radice dell'admin |
| `name` | l'etichetta nel drawer e nella home page |
| `view` | l'elemento di cui eseguire il rendering, oppure un `ComponentType` per renderizzarlo in modalità lazy |
| `icon` | il nome di un'icona [Lucide](https://lucide.dev/icons/), ad es. `"ShoppingCart"` — o qualsiasi nodo |
| `group` | raggruppa le viste nel drawer; `"Admin"` e `"Settings"` vanno in fondo |
| `pinToBottom` | sposta il gruppo in fondo indipendentemente dal nome — preferibile rispetto alle due stringhe speciali |
| `nestedRoutes` | registra anche `slug/*`, per una vista con percorsi interni propri |
| `hideFromNavigation` | mantiene il percorso, ma rimuove la voce dalla navigazione |
| `roles` | solo gli utenti con uno di questi ruoli possono vedere la vista o accedervi |
| `description` | Markdown, mostrato nella scheda della home page |

Per posizionare una vista sotto **Studio** anziché nel CMS, passala a [`<RebaseStudio devViews>`](/docs/studio#adding-your-own-tool).

## Stile

Rebase utilizza **Tailwind CSS v4** e supporta le modalità chiara/scura. Personalizzabile tramite:

- **Proprietà personalizzate CSS** — Sovrascrivi i token di design
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

Per impostazione predefinita `<Rebase>` possiede il tema della pagina: mette la classe
`dark` su `<html>`, segue `prefers-color-scheme` finché l'utente non sceglie una modalità
nell'admin, e ricorda quella scelta in localStorage.

Quando `<Rebase>` viene
smontato, rimuove la classe `dark` che aveva aggiunto; una classe che la pagina aveva già
resta. Su 0.24 la classe rimane.

Quando la tua app ha già un
tema, passalo come `modeController`. Rebase legge `mode` da esso, chiama il suo `setMode`
dal proprio interruttore del tema, e non tocca mai `<html>`, `prefers-color-scheme` né
localStorage:

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

Il CSS dello scaffold applica lo stile scuro sotto qualsiasi elemento con la classe `dark`
(`@custom-variant dark (&:where(.dark, .dark *))`). Pannelli laterali, finestre di dialogo
e menu vengono renderizzati in un portal su `<body>`, quindi metti la classe su `<html>` o
su `<body>` anziché su un wrapper attorno a `<Rebase>`.

Avvolgere `<Rebase>` in un `ModeControllerProvider` non ottiene questo risultato:
`<Rebase>` fornisce al suo interno un controller proprio. Su 0.24 la prop non esiste, e
non c'è modo di passare a `<Rebase>` la modalità della tua app.

## Prossimi passi

- **[Campi personalizzati](/docs/frontend/custom-fields)** — Crea campi di modulo personalizzati
- **[Viste entità](/docs/frontend/entity-views)** — Aggiungi schede agli editor di entità
- **[Modalità di visualizzazione](/docs/frontend/view-modes)** — Elenco, Tabella, Schede, Kanban
- **[Traduzioni](/docs/frontend/i18n)** — Modifica qualsiasi stringa o aggiungi una lingua
- **[Plugin](/docs/plugins)** — Estendi il framework
