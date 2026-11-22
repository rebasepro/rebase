---
sourceHash: 3d9958fb7e16f02e
title: Panoramica del Frontend
sidebar_label: Frontend
description: "Costruisci e personalizza il pannello — Rebase CMS e Rebase Studio — con React: controller, scaffold, routing e viste."
---

## Panoramica

Il frontend di Rebase è un **framework React** che esegue il rendering del tuo pannello di amministrazione. Legge le tabelle fornite dal backend e genera la navigazione, le tabelle, i moduli e le rotte a partire da esse, senza alcuna configurazione (vedi [Tabelle nel CMS](/docs/collections/)). Ciò che aggiungi è solo ciò che differisce.

Nello scaffold predefinito, il pannello di amministrazione **è** il frontend: viene servito alla radice dell'URL distribuito. Se invece crei la tua app di prodotto personalizzata, puoi montare l'admin sotto un prefisso come `/admin` nello stesso deployment — vedi [Modificare l'URL di base](/docs/getting-started/deployment#changing-the-base-url).

Questo è un file `frontend/src/App.tsx` senza le importazioni dei font, l'error boundary e il client id di Google — l'intero pannello di amministrazione, quattro dichiarazioni all'interno di un unico provider:

```tsx
import React from "react";
import { Rebase, RebaseAuth, useRebaseAuthController } from "@rebasepro/app";
import { RebaseCMS, RebaseShell } from "@rebasepro/cms";
import { RebaseStudio } from "@rebasepro/studio";
import { createRebaseClient } from "@rebasepro/client";
import { tableCustomizations } from "./cms";

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
            {/* Every table the backend serves, plus your customizations. */}
            <RebaseCMS tableCustomizations={tableCustomizations}/>
            <RebaseStudio/>
            <RebaseShell title="My App"/>
        </Rebase>
    );
}
```

I primi tre non renderizzano nulla: *registrano* la configurazione all'interno del provider. `<RebaseShell>` è ciò che disegna i componenti — legge quel registro e costruisce la navigazione, le rotte e il layout partendo da esso. L'ordine in cui compaiono non ha quindi importanza, e aggiungere una funzionalità significa aggiungere un componente, non dover ricablare l'albero.

| Componente | Pacchetto | Cosa registra |
|---|---|---|
| `<RebaseAuth>` | `@rebasepro/app` | la schermata di accesso (`loginView`) |
| `<RebaseCMS>` | `@rebasepro/cms` | le tabelle fornite con le relative personalizzazioni, collezioni esterne, viste personalizzate, la home page |
| `<RebaseStudio>` | `@rebasepro/studio` | gli strumenti per sviluppatori (SQL, RLS, log, backup…) |
| `<RebaseShell>` | `@rebasepro/cms` | nulla — esegue il rendering dell'admin a partire da tutto quanto sopra |

Rimuovi `<RebaseStudio>` e avrai un CMS per soli contenuti; rimuovi `<RebaseCMS>` e avrai unicamente gli strumenti per sviluppatori. Per impostare manualmente il layout della shell, vedi [Avanzate: layout manuale](#avanzate-layout-manuale).

## Dove risiedono i file del CMS

```text
frontend/src/
├── App.tsx
└── cms/
    ├── index.ts      # export const tableCustomizations = [postsCms, …]
    ├── posts.tsx     # customizeTable("posts", { … })
    └── events.ts     # defineFirestoreCollection({ … })
```

`frontend/src/cms/` contiene ciò che il pannello non può dedurre automaticamente: un [`customizeTable`](/docs/frontend/customize-table/) per ciascuna tabella che desideri presentare diversamente, e le [collezioni Firestore](/docs/frontend/firebase/) che il browser legge direttamente. Questi file vengono eseguiti solo nel browser, quindi un campo personalizzato è un componente importato per valore.

Il frontend importa il **tipo** di una tabella da `backend/schema`, mai un valore: `import type { posts } from "../../../backend/schema/posts"`. L'importazione di un tipo viene eliminata dal bundle finale, evitando che gli hook del backend e il codice del server raggiungano il browser. Il backend non importa nulla dal frontend.

## Proprietà di RebaseCMS

<!-- rebase-cms-props:start -->
| Proprietà | Descrizione |
|------|-------------|
| `tableCustomizations` | Risultati di `customizeTable(...)`, al massimo uno per tabella. Due per la stessa tabella generano un errore; uno per una tabella non fornita al chiamante viene ignorato, con un avviso in sviluppo |
| `externalCollections` | Collezioni le cui righe risiedono su un'altra origine dati, come i risultati di `defineFirestoreCollection`, mostrate accanto alle tabelle nella stessa navigazione, ricerca e selettori di riferimenti |
| `uiConfig` | Le preferenze di interfaccia grafica dell'area di lavoro scritte in sviluppo: `import uiConfig from "./cms/ui-config.json"`. Applicate sopra a `tableCustomizations`, subordinate alle preferenze del singolo utente |
| `tables` | Per incorporamento e test: le tabelle di cui effettuare il rendering al posto di quelle fornite dal server (`compileTables([...])`). Se specificato, non ne viene richiesta alcuna al server |
| `views` | Pagine di primo livello nella navigazione, o un loro builder — vedi [Viste Personalizzate](#viste-personalizzate) |
| `homePage` | Sostituisce la home page dei contenuti |
| `entityViews` | Schede dei record a cui qualsiasi tabella può fare riferimento tramite `key` nel proprio `entityViews` |
| `collectionViews` | Modalità di visualizzazione a cui qualsiasi tabella può fare riferimento tramite `key` nel proprio `customViews` |
| `entityActions` | Azioni sui record a cui qualsiasi tabella può fare riferimento tramite `key` nel proprio `entityActions` |
| `collectionEditor` | Opzioni per il controller dello schema attraverso cui l'editor RLS di Studio salva i dati (`readOnly`, `getAuthToken`) |
| `navigationGroupMappings` | Gruppi con nome e le collezioni e viste in ciascuno di essi, in ordine |
| `basePath` | Il prefisso URL sotto cui è montato l'admin, quando il router non dispone di un `basename` |
<!-- rebase-cms-props:end -->

Le collezioni del pannello vengono composte nel seguente ordine, che è anche quello della navigazione: ogni tabella servita (con la sua personalizzazione, applicando poi le preferenze UI dell'area di lavoro e dell'utente), seguita da `externalCollections`. Uno slug identifica una sola collezione:

| Collisione | Cosa succede |
|---|---|
| due risultati `customizeTable` per uno stesso slug | genera un errore: uniscili in uno solo |
| una collezione esterna e una tabella servita, o un'altra collezione esterna | il pannello mostra un errore di caricamento indicando entrambe; assegna a una delle due uno slug diverso |

Il modo in cui il pannello attende il caricamento delle tabelle e ciò che mostra in caso di errore è illustrato in [Tabelle nel CMS](/docs/collections/#loading-and-errors).

## Il Provider Rebase

`<Rebase>` è il provider principale che rende disponibili tutte le funzionalità di Rebase ai componenti figli tramite context. Accetta:

Tutte e ventitré le proprietà complete — la tabella in precedenza ne elencava dieci, e due di esse erano proprietà che il componente non leggeva mai:

<!-- rebase-props:start -->
| Proprietà | Descrizione |
|------|-------------|
| `children` | I componenti radice dell'admin — `<RebaseCMS>`, `<RebaseStudio>`, `<RebaseShell>`. Una render function funge da via di fuga per il layout manuale. |
| `apiUrl` | URL di base dell'API di backend, resa disponibile a ciascun hook tramite `useApiConfig()` |
| `dateTimeFormat` | Come vengono stampate le date. Il valore predefinito è `MMMM dd, yyyy, HH:mm:ss` |
| `locale` | Lingua iniziale dell'admin e locale con cui formattare le date — vedi [Traduzioni](/docs/frontend/i18n) |
| `client` | Istanza di `RebaseClient`: l'origine predefinita per dati, autenticazione e storage |
| `dataSources` | Origini dati aggiuntive, per collezioni che ne specificano una — vedi [Origini multiple](/docs/backend/multiple-sources) |
| `authController` | Stato e metodi di autenticazione. Sostituisce del tutto la sottoscrizione a `client.auth` |
| `storageSource` | L'origine di archiviazione predefinita, sovrascrive `client.storage` |
| `storageSources` | Origini di archiviazione con nome oltre a quella predefinita |
| `databaseAdmin` | Operazioni amministrative sul database (SQL, individuazione schema). Necessario solo per Studio |
| `userConfigPersistence` | Preferenze UI locali — larghezze delle colonne, gruppi compressi |
| `onAnalyticsEvent` | Chiamato per ogni evento di analitica emesso dall'admin |
| `entityLinkBuilder` | `({ row, id, path }) => string`: l'URL per il pulsante "apri nella tua app" su un record, generato a partire dal record inviato dal server |
| `plugins` | Istanze di plugin — vedi [Plugin](/docs/plugins) |
| `slots` | Contributi slot dichiarati direttamente, senza un plugin |
| `propertyConfigs` | Widget di campi personalizzati, indicizzati in base al nome referenziato in `propertyConfig` |
| `entityViews` | Schede di visualizzazione entità personalizzate, disponibili per qualsiasi tabella che ne referenzia la `key` nel proprio `entityViews` |
| `collectionViews` | Modalità di visualizzazione personalizzate delle collezioni, disponibili per qualsiasi collezione tramite `key` |
| `entityActions` | Azioni sull'entità, disponibili per qualsiasi tabella che ne referenzia la `key` nel proprio `entityActions` |
| `effectiveRoleController` | Simula un ruolo diverso mentre la modalità di sviluppo è attiva |
| `simulateAccess` | Mostra "Simula accesso", il controllo per l'amministratore che esegue ogni vista dati come un ruolo, un utente o una chiave di servizio, in sola lettura, rispetto alle vere policy di row-level security. Disattivato a meno che non sia `true` |
| `modeController` | Assegna a Rebase la modalità light/dark dell'app host; Rebase non toccherà quindi `<html>`, `prefers-color-scheme` o il localStorage — vedi [Stili](#stili) |
| `translations` | Sovrascrivi o estendi qualsiasi stringa dell'interfaccia utente, indicizzata per locale — vedi [Traduzioni](/docs/frontend/i18n) |
| `components` | Sostituisci i componenti predefiniti — vedi [Sovrascrittura dei Componenti](/docs/frontend/component-overrides) |
<!-- rebase-props:end -->

I controller di navigazione, URL e del registro delle collezioni **non** sono proprietà di `<Rebase>`: vengono costruiti dagli hook sottostanti e consumati all'interno dell'albero dell'admin (`<RebaseShell>` li collega per te nello scaffold predefinito).

Lo stesso vale per il prefisso URL. Quando l'admin è montato sotto un percorso, tale configurazione appartiene a `<RebaseCMS basePath="/admin">`, che è ciò che risolve gli URL nelle collezioni — e solo quando il router non possiede già un proprio `basename`. Vedi [Modificare l'URL di base](/docs/getting-started/deployment#changing-the-base-url).

## Un'unica struttura dati

Il tuo codice riceve le righe così come le invia il server, ovunque vengano richieste: `client.data`, `context.data` (sia in una callback di backend che nel browser), `useRows`, `useRow` e `useRowWrites`, il parametro `data` dei builder di collezioni e viste, e ciò che viene passato ai `browserCallbacks` di una tabella. Una riga è un oggetto semplice: `row.title`, una data come stringa ISO, una relazione belongsTo come colonna di chiave esterna.

```tsx
// Anywhere, including outside React.
const { data: posts } = await client.data.posts.find();
posts[0].title;

// Inside the <Rebase> tree: the same rows, kept current after every write.
const { rows } = useRows("posts");
rows[0].title;
```

L'admin stesso effettua il rendering di un view model `Entity`: l'involucro `id` / `path` / `values` da cui le viste delle collezioni e i moduli attingono, con le date rappresentate come `Date` e le relazioni come `EntityRelation` (le classi di valori `EntityRelation`, `EntityReference`, `GeoPoint` e `Vector` provengono da `@rebasepro/cms-types`). Prima di ogni operazione di scrittura e di ogni filtro, l'admin converte questi valori nei tipi di trasporto grezzi all'interno del browser — le relazioni come chiavi, i vettori come elenchi di numeri, i punti come `{ latitude, longitude }`, le date come testo ISO — in modo che il server riceva lo stesso formato inviato da qualsiasi altro client. Questo strato è interno all'admin e non fa parte dell'interfaccia pubblica: a un'azione di entità, un resolver di visualizzazione, al `tableController.rows` del `Builder` di una modalità di vista, alla selezione di un'azione di collezione e a uno slot vengono sempre passate righe regolari, con l'ID di ciascun record accanto alla propria riga. Si incontra `Entity` solo copiando una delle parti interne dell'admin (`Collection.Table`, una card), a cui viene passato il record così come l'admin lo disegna. I valori di un form appartengono invece all'editor: `Date` e relazioni, nel formato gestito durante la modifica di un campo.

## Una collezione o un record all'interno di una pagina personalizzata

Non è necessario caricare l'intero admin per mostrare una singola tabella. `<CollectionPanel>`, `<RecordForm>`, `<RecordDetail>` e `<FieldValue>` funzionano ovunque all'interno di `<Rebase>` e di un router React Router, senza bisogno di `<RebaseCMS>`, `<RebaseNavigation>` o `<RebaseShell>`: una collezione con le colonne e la barra degli strumenti a tua scelta, il modulo di un record con solo determinati campi o con un layout personalizzato, un record in sola lettura o un singolo valore visualizzato come nell'admin. Vedi [Pannelli in una pagina personalizzata](/docs/frontend/panels).

## Avanzate: layout manuale

Tutto ciò che segue serve a sostituire `<RebaseShell>`. È necessario solo quando il layout predefinito rappresenta un limite: una struttura visiva differente attorno all'admin, un albero di rotte personalizzato, un'app in cui l'admin è una delle tante pagine. Se non stai sostituendo il layout, puoi fermarti a [Viste Personalizzate](#viste-personalizzate).

`<RebaseShell>` è una sintassi abbreviata per quattro livelli distinti, che possono essere gestiti singolarmente:

```tsx
<Rebase client={client} authController={authController}>
    <RebaseCMS tableCustomizations={tableCustomizations}/>
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

L'ordine è obbligatorio: `RebaseAuthGate → RebaseNavigation → RebaseRouteDefs → RebaseLayout`. `RebaseAuthGate` mostra la vista di accesso finché non è presente un utente, in modo che nulla di quanto sta al suo interno venga renderizzato per un visitatore non autenticato; `RebaseNavigation` crea i controller di navigazione, URL e registro delle collezioni letti da `RebaseRouteDefs` e da ogni vista delle collezioni, quindi usare `RebaseRouteDefs` al di fuori di esso genera un errore. Per incorporare la vista di una collezione o il modulo di un record all'interno di una pagina personalizzata, senza le rotte dell'admin, il componente più leggero `CollectionsProvider` si occupa di creare tali controller — vedi [Pannelli in una pagina personalizzata](/docs/frontend/panels).

Ciascun livello è utilizzabile singolarmente. Il solo `<RebaseAuthGate>` protegge la tua applicazione dietro il login di Rebase. Sostituisci `<RebaseLayout>` con un componente personalizzato per preservare il routing eliminando l'interfaccia predefinita; ometti anche `<RebaseRouteDefs>` e potrai costruire le rotte autonomamente utilizzando i componenti descritti in [Componenti di Scaffold](#componenti-di-scaffold).

A un livello ancora più basso, `<Rebase>` accetta anche una **render prop** al posto dei figli, la quale restituisce il contesto e il flag di caricamento lasciando l'intero albero di componenti sotto il tuo controllo:

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

In questa modalità nulla viene configurato automaticamente: sarà necessario creare manualmente i controller descritti di seguito ed effettuare il rendering delle rotte in autonomia.

### Controller

I controller sono hook React che configurano aspetti specifici del framework. `<RebaseNavigation>` li invoca tutti automaticamente — ricorri ad essi solo all'interno di una render prop.

#### `useBuildNavigationStateController`

Il controller principale che collega tutti gli elementi:

Il suo parametro `data` è ciò che viene passato ai builder di collezioni e viste: il `context.data` piatto del componente `<Rebase>` contenitore (vedi [Un'unica struttura dati](#ununica-struttura-dati)), pertanto questo hook deve essere chiamato all'interno dell'albero di `<Rebase>`.

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

Gestisce il tema chiaro/scuro. Quando è abilitato controlla direttamente il tema della pagina: applica la classe `dark` su `<html>`, segue le preferenze di `prefers-color-scheme` finché l'utente non seleziona una modalità, e salva tale scelta in localStorage.

```typescript
const modeController = useBuildModeController();

modeController.mode;             // "light" | "dark"
modeController.setMode("dark");  // "light" | "dark" | "system" — "system" follows the OS again
```

`<Rebase>` ne istanzia uno internamente.

Quando il componente che lo utilizza viene smontato, rimuove la classe `dark` che aveva aggiunto; un'eventuale classe `dark` già presente in precedenza sulla pagina viene preservata. Creane uno autonomamente a monte di `<Rebase>` solo quando anche componenti esterni necessitano di conoscere la modalità corrente, e passalo tramite la [proprietà `modeController`](#stili), così da avere un unico controller invece di due. `useBuildModeController({ enabled: false })` genera un controller inerte: mantiene `mode` nello stato di React senza toccare classi, media query o il localStorage. Se la tua applicazione gestisce già il tema in autonomia non avrai affatto bisogno di questo hook: passa semplicemente il tuo controller come `modeController`.

#### `useBuildAdminModeController`

Consente di alternare tra la modalità Studio e la modalità Contenuti:

```typescript
const adminModeController = useBuildAdminModeController();
// Provides: adminModeController.mode ("cms" | "studio")
```

### Componenti di Scaffold

| Componente | Descrizione |
|-----------|-------------|
| `<Scaffold>` | Contenitore di layout principale con barra laterale reattiva |
| `<AppBar>` | Barra di navigazione superiore con ricerca, selettore di tema, menu utente |
| `<Drawer>` | Navigazione laterale con elenco delle collezioni e collegamenti alle viste |
| `<SideDialogs>` | Contenitore per gli editor di entità a pannello laterale |
| `<RebaseRoutes>` | Contenitore di rotte integrato con React Router |
| `<RebaseRoute>` | Gestisce le rotte delle collezioni (`/c/*`) |
| `<ContentHomePage>` | Home page predefinita che mostra le schede delle collezioni |
| `<StudioHomePage>` | Home page in modalità Studio con strumenti per sviluppatori |

## Viste Personalizzate

Aggiungi viste di navigazione di primo livello per dashboard, strumenti o pagine personalizzate. Un oggetto `AppView` ha una struttura piatta — tutte le opzioni si trovano al livello principale, senza blocchi `admin` annidati:

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

Passale a `<RebaseCMS>`, insieme alle tue personalizzazioni — è il componente responsabile della registrazione della navigazione:

```tsx
<RebaseCMS tableCustomizations={tableCustomizations} views={views}/>
```

| Campo | |
|---|---|
| `slug` | il percorso al quale è raggiungibile, sotto la radice dell'admin |
| `name` | l'etichetta nel menu laterale e nella home page |
| `view` | l'elemento da renderizzare, o un `ComponentType` per il rendering lazy |
| `icon` | il nome di un'icona [Lucide](https://lucide.dev/icons/), ad es. `"ShoppingCart"` — o un qualsiasi nodo |
| `group` | raggruppa le viste nel menu laterale; `"Admin"` e `"Settings"` vengono posizionati in fondo |
| `pinToBottom` | fissa il gruppo in fondo indipendentemente dal nome — opzione preferibile rispetto all'uso delle due stringhe speciali |
| `nestedRoutes` | registra anche `slug/*`, per le viste provviste di routing interno |
| `hideFromNavigation` | mantiene la rotta attiva ma la rimuove dalla navigazione |
| `roles` | solo gli utenti con uno di questi ruoli possono vedere o raggiungere la vista |
| `description` | Markdown mostrato nella scheda della home page |

Per posizionare una vista all'interno di **Studio** anziché del CMS, passala a [`<RebaseStudio devViews>`](/docs/studio#adding-your-own-tool).

## Stili

Rebase utilizza **Tailwind CSS v4** e supporta le modalità light/dark. Può essere personalizzato tramite:

- **Proprietà personalizzate CSS** — Sovrascrivi i design token
- **`<Rebase modeController>`** — Assegna a Rebase la modalità light/dark della tua app
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

Per impostazione predefinita `<Rebase>` gestisce autonomamente il tema della pagina: inserisce la classe `dark` su `<html>`, adotta le preferenze di `prefers-color-scheme` fino a quando l'utente non seleziona manualmente una modalità nell'admin, e memorizza la scelta nel localStorage.

Quando `<Rebase>` viene smontato, rimuove la classe `dark` aggiunta; un'eventuale classe già presente sul documento rimane invariata.

Se la tua applicazione include già un sistema di temi, passalo tramite `modeController`. Rebase leggerà `mode` da esso, ne invocherà `setMode` dal proprio interruttore di tema e non toccherà mai `<html>`, `prefers-color-scheme` o il localStorage:

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

Il CSS dello scaffold applica lo stile della modalità scura a qualsiasi elemento dotato della classe `dark` (`@custom-variant dark (&:where(.dark, .dark *))`). Poiché pannelli laterali, finestre di dialogo e menu vengono renderizzati all'interno di un portale su `<body>`, è opportuno inserire la classe su `<html>` o `<body>` piuttosto che su un wrapper intorno a `<Rebase>`.

Avvolgere `<Rebase>` all'interno di un `ModeControllerProvider` non produce questo effetto: `<Rebase>` fornisce già un proprio controller internamente.

## Passaggi Successivi

- **[customizeTable](/docs/frontend/customize-table)** — Tutte le opzioni per la collezione di una tabella
- **[Campi Personalizzati](/docs/frontend/custom-fields)** — Costruisci campi modulo personalizzati
- **[Viste Entità](/docs/frontend/entity-views)** — Aggiungi schede agli editor delle entità
- **[Modalità di Visualizzazione](/docs/frontend/view-modes)** — Elenco, Tabella, Schede, Kanban
- **[Traduzioni](/docs/frontend/i18n)** — Modifica qualsiasi stringa o aggiungi una lingua
- **[Plugin](/docs/plugins)** — Estendi le funzionalità del framework
