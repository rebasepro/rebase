---
sourceHash: 15779772a2359662
title: Panoramica del Frontend
sidebar_label: Frontend
description: "Crea e personalizza il pannello — Rebase CMS e Rebase Studio — con React: controller, scaffold, routing e viste."
---

## Panoramica

Il frontend di Rebase è un **framework React** che esegue il rendering del tuo pannello di amministrazione.
Legge le tabelle fornite dal backend e genera la navigazione, le tabelle,
i form e le route a partire da esse, senza alcuna configurazione (vedi
[Tabelle nel CMS](/docs/collections/)). Ciò che aggiungi è ciò che differisce.

Nello scaffold predefinito, il pannello di amministrazione **è** il frontend: viene servito alla radice dell'URL di deploy. Se invece crei la tua app di prodotto, puoi montare l'admin sotto un prefisso come `/admin` nello stesso deployment — vedi [Modificare l'URL di base](/docs/getting-started/deployment#changing-the-base-url).

Questo è un `frontend/src/App.tsx` senza le importazioni dei font, l'error boundary e
il client id di Google — l'intero pannello di amministrazione, quattro dichiarazioni all'interno di un unico
provider:

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

I primi tre non eseguono alcun rendering: *registrano* la configurazione all'interno del
provider. `<RebaseShell>` è ciò che disegna — legge quel registro e crea la
navigazione, le route e il layout partendo da esso. Quindi l'ordine in cui compaiono non ha
importanza, e aggiungere una funzionalità significa aggiungere un componente, non riconfigurare un albero.

| Componente | Pacchetto | Registra |
|---|---|---|
| `<RebaseAuth>` | `@rebasepro/app` | la schermata di accesso (`loginView`) |
| `<RebaseCMS>` | `@rebasepro/cms` | le tabelle servite con le relative personalizzazioni, le collezioni esterne, le viste personalizzate, la home page, l'editor di collezioni |
| `<RebaseStudio>` | `@rebasepro/studio` | gli strumenti per sviluppatori (SQL, RLS, log, backup…) |
| `<RebaseShell>` | `@rebasepro/cms` | nulla — esegue il rendering dell'admin a partire da tutto quanto sopra |

Rimuovi `<RebaseStudio>` e otterrai un CMS per soli contenuti; rimuovi `<RebaseCMS>` e
avrai esclusivamente gli strumenti per sviluppatori. Per impostare il layout della shell manualmente, vedi
[Avanzato: layout manuale](#avanzato-layout-manuale).

## Dove risiedono i file del CMS

<span class="since-badge" data-since="0.31">Da 0.31</span>

```text
frontend/src/
├── App.tsx
└── cms/
    ├── index.ts      # export const tableCustomizations = [postsCms, …]
    ├── posts.tsx     # customizeTable("posts", { … })
    └── events.ts     # defineFirestoreCollection({ … })
```

`frontend/src/cms/` contiene ciò che il pannello non può dedurre automaticamente: una
chiamata a [`customizeTable`](/docs/frontend/customize-table/) per ogni tabella che desideri
presentare in modo diverso, e le [collezioni Firestore](/docs/frontend/firebase/)
che il browser legge direttamente. Questi file vengono eseguiti solo nel browser, quindi un campo
personalizzato è un componente che importi per valore.

Il frontend importa il **tipo** di una tabella da `backend/schema`, mai un valore:
`import type { posts } from "../../../backend/schema/posts"`. Un'importazione di tipo viene
rimossa dal bundle, così gli hook e il codice server del backend non raggiungono mai il
browser. Il backend non importa nulla dal frontend.

## Prop di RebaseCMS

<span class="since-badge" data-since="0.31">Da 0.31</span>

<!-- rebase-cms-props:start -->
| Prop | Descrizione |
|------|-------------|
| `tableCustomizations` | Risultati di `customizeTable(...)`, al massimo uno per tabella. Due per la stessa tabella generano un errore; uno per una tabella non servita al chiamante viene ignorato, con un avviso in fase di sviluppo |
| `externalCollections` | Collezioni le cui righe risiedono su un'altra origine dati, come i risultati di `defineFirestoreCollection`, mostrate accanto alle tabelle nella stessa navigazione, ricerca e nei selettori di riferimenti |
| `uiConfig` | Le preferenze UI del workspace scritte durante lo sviluppo: `import uiConfig from "./cms/ui-config.json"`. Applicate sopra a `tableCustomizations`, subordinate alle preferenze del singolo utente |
| `tables` | Per incorporamento e test: le tabelle di cui effettuare il rendering al posto di quelle fornite dal server (`compileTables([...])`). Se specificate, non viene richiesta alcuna tabella al server |
| `views` | Pagine di primo livello nella navigazione, o un builder per crearle — vedi [Viste personalizzate](#viste-personalizzate) |
| `homePage` | Sostituisce la home page dei contenuti |
| `entityViews` | Schede di record a cui qualsiasi tabella può fare riferimento tramite `key` nei suoi `entityViews` |
| `collectionViews` | Modalità di visualizzazione a cui qualsiasi tabella può fare riferimento tramite `key` nei suoi `customViews` |
| `entityActions` | Azioni su record a cui qualsiasi tabella può fare riferimento tramite `key` nei suoi `entityActions` |
| `collectionEditor` | `true` o opzioni per l'editor visivo dello schema |
| `navigationGroupMappings` | Gruppi con nome e le collezioni e viste all'interno di ciascuno, in ordine |
| `basePath` | Il prefisso URL sotto cui è montato l'admin, quando il router non ha un `basename` |
<!-- rebase-cms-props:end -->

Le collezioni del pannello sono composte in questo ordine, che è anche quello
della navigazione: ogni tabella servita (con la sua personalizzazione, applicando poi
le preferenze UI del workspace e quelle dell'utente), seguita da `externalCollections`. Uno slug
identifica una sola collezione:

| Collisione | Cosa succede |
|---|---|
| due risultati `customizeTable` per uno stesso slug | genera errore: uniscili in uno solo |
| una collezione esterna e una tabella servita, oppure un'altra collezione esterna | il pannello mostra un errore di caricamento indicando entrambe; assegna a una delle due un altro slug |

Il modo in cui il pannello attende le tabelle, e cosa mostra quando non possono essere
caricate, è descritto in [Tabelle nel CMS](/docs/collections/#loading-and-errors).

## Il Provider Rebase

`<Rebase>` è il provider principale che rende disponibili tutte le funzionalità di Rebase ai componenti figli tramite context. Accetta:

Tutte e ventitré, per intero — in precedenza la tabella ne elencava dieci, e due di esse
erano prop che il componente non leggeva nemmeno:

<!-- rebase-props:start -->
| Prop | Descrizione |
|------|-------------|
| `children` | I componenti radice dell'admin — `<RebaseCMS>`, `<RebaseStudio>`, `<RebaseShell>`. Una funzione di rendering è la via di fuga per il layout manuale. |
| `apiUrl` | URL di base dell'API di backend, reso disponibile a ogni hook tramite `useApiConfig()` |
| `dateTimeFormat` | Come vengono formattate le date. Valore predefinito: `MMMM dd, yyyy, HH:mm:ss` |
| `locale` | Lingua iniziale dell'admin e locale utilizzato per formattare le date — vedi [Traduzioni](/docs/frontend/i18n) |
| `client` | Istanza di `RebaseClient`: l'origine predefinita per dati, autenticazione e storage |
| `dataSources` | Origini dati aggiuntive, per collezioni che ne indicano una specifica — vedi [Origini multiple](/docs/backend/multiple-sources) |
| `authController` | Stato e metodi di autenticazione. Sostituisce completamente la sottoscrizione a `client.auth` |
| `storageSource` | L'origine di storage predefinita, che sovrascrive `client.storage` |
| `storageSources` | Origini di storage con nome oltre a quella predefinita |
| `databaseAdmin` | Operazioni amministrative sul database (SQL, individuazione dello schema). Necessario solo a Studio |
| `userConfigPersistence` | Preferenze UI locali — larghezze delle colonne, gruppi compressi |
| `onAnalyticsEvent` | Chiamato per ogni evento di analytics emesso dall'admin |
| `entityLinkBuilder` | `({ row, id, path }) => string`: l'URL per il pulsante "apri nella tua app" su un record, ricavato dal record come il server invia la riga |
| `plugins` | Istanze di plugin — vedi [Plugin](/docs/plugins) |
| `slots` | Contributi slot dichiarati direttamente, senza un plugin |
| `propertyConfigs` | Widget di campi personalizzati, indicizzati in base al nome indicato da un campo in `propertyConfig` |
| `entityViews` | Schede personalizzate della vista entità, disponibili per qualsiasi tabella che indichi la loro `key` in `entityViews` |
| `collectionViews` | Modalità personalizzate di visualizzazione delle collezioni, disponibili per qualsiasi collezione tramite `key` |
| `entityActions` | Azioni su entità, disponibili per qualsiasi tabella che indichi la loro `key` in `entityActions` |
| `effectiveRoleController` | Simula un ruolo diverso mentre la modalità di sviluppo è attiva |
| `modeController` | Assegna a Rebase la modalità chiaro/scuro dell'app ospitante; Rebase non toccherà mai `<html>`, `prefers-color-scheme` o localStorage — vedi [Stili](#stili) |
| `translations` | Sovrascrive o estende qualsiasi stringa dell'interfaccia, indicizzata per locale — vedi [Traduzioni](/docs/frontend/i18n) |
| `components` | Sostituisce componenti integrati — vedi [Override dei componenti](/docs/frontend/component-overrides) |
<!-- rebase-props:end -->

I controller per la navigazione, gli URL e il registro delle collezioni **non** sono
prop di `<Rebase>` — vengono creati dagli hook indicati sotto e consumati all'interno dell'albero dell'admin
(`<RebaseShell>` li collega per te nello scaffold predefinito).

Non lo è nemmeno il prefisso dell'URL. Quando l'admin è montato sotto un percorso, tale prefisso deve essere specificato
su `<RebaseCMS basePath="/admin">`, che è ciò che risolve gli URL nelle collezioni —
e solo quando il router non ha un proprio `basename`. Vedi
[Modificare l'URL di base](/docs/getting-started/deployment#changing-the-base-url).

## Un'unica struttura dati

Il tuo codice riceve le righe così come le invia il server, ovunque le richieda: `client.data`,
`context.data` (sia in una callback di backend che nel browser), `useRows`,
`useRow` e `useRowWrites`, il `data` dei builder di collezioni e viste, e ciò che
viene passato ai `browserCallbacks` di una tabella. Una riga è un oggetto semplice: `row.title`,
una data come stringa ISO, un belongsTo come colonna di chiave esterna.

```tsx
// Anywhere, including outside React.
const { data: posts } = await client.data.posts.find();
posts[0].title;

// Inside the <Rebase> tree: the same rows, kept current after every write.
const { rows } = useRows("posts");
rows[0].title;
```

L'admin in sé esegue il rendering di un view model `Entity` — il wrapper
`id` / `path` / `values` da cui attingono le viste delle collezioni e i form, con date come istanze di `Date` e una
relazione come `EntityRelation` (le classi di valori `EntityRelation`, `EntityReference`,
`GeoPoint` e `Vector` provengono da `@rebasepro/cms-types`). Prima di ogni scrittura e
di ogni filtro, l'admin li converte in valori di trasmissione (wire values) nel browser — relazioni come
chiavi, vettori come elenchi di numeri, punti come `{ latitude, longitude }`, date come testo ISO —
in modo che il server veda ciò che qualsiasi altro client invierebbe. Quel livello appartiene all'admin stesso e non fa parte
della superficie pubblica: a un'azione di entità, a un resolver di visualizzazione, a `tableController.rows` del
`Builder` di una modalità di vista, alla selezione di un'azione di collezione e a uno slot
vengono tutte passate righe, con l'ID di ogni record accanto alla relativa riga. Troverai `Entity` solo in una copia di una delle parti
interne dell'admin (`Collection.Table`, una card), a cui viene passato il record così come l'admin lo
disegna. I valori di un form sono quelli dell'editor: `Date` e relazioni, nel modo in cui un campo
li modifica.

## Una collezione o un singolo record in una pagina personalizzata

Non hai bisogno dell'intero admin per mostrare una tabella. `<CollectionPanel>`,
`<RecordForm>`, `<RecordDetail>` e `<FieldValue>` funzionano ovunque sotto
`<Rebase>` e un router React Router, senza bisogno di `<RebaseCMS>`,
`<RebaseNavigation>` o `<RebaseShell>`: una collezione con le colonne e la
toolbar che preferisci, il form di un singolo record con solo alcuni campi o con un layout
personalizzato, un singolo record in sola lettura o un singolo valore disegnato come lo disegna l'admin. Vedi
[Pannelli in una pagina personalizzata](/docs/frontend/panels).

## Avanzato: layout manuale

Tutto ciò che segue sostituisce `<RebaseShell>`. Ne hai bisogno solo quando il layout
predefinito è d'intralcio — un'interfaccia differente attorno all'admin, un albero di route
personalizzato, un'app in cui l'admin è una pagina tra tante. Se non intendi
sostituire il layout, puoi fermarti a [Viste personalizzate](#viste-personalizzate).

`<RebaseShell>` è zucchero sintattico per quattro livelli, e puoi utilizzarli singolarmente:

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

L'ordine è fisso: `RebaseAuthGate → RebaseNavigation → RebaseRouteDefs →
RebaseLayout`. `RebaseAuthGate` mostra la vista di login finché non è presente un utente, quindi
nulla al di sotto di esso viene renderizzato per un visitatore non autenticato; `RebaseNavigation` crea
i controller per navigazione, URL e registro delle collezioni che `RebaseRouteDefs`
e ogni vista di collezione leggono, quindi usare `RebaseRouteDefs` al di fuori di esso genera un errore.
Per incorporare una vista di collezione o un form di record in una propria pagina, senza le
route dell'admin, il più leggero `CollectionsProvider` crea questi controller
al suo posto — vedi
[Pannelli in una pagina personalizzata](/docs/frontend/panels).

Ogni livello è utilizzabile singolarmente. `<RebaseAuthGate>` da solo protegge la tua app
dietro l'autenticazione di Rebase. Sostituisci `<RebaseLayout>` con un tuo componente per mantenere il
routing eliminando la cornice grafica; rimuovi anche `<RebaseRouteDefs>` per creare
le route autonomamente a partire dai componenti descritti in
[Componenti Scaffold](#componenti-scaffold).

Al di sotto di questa base, `<Rebase>` accetta anche una **render prop** invece dei children,
la quale fornisce il context e il flag di caricamento e lascia l'intero albero a
tua disposizione:

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

A questo punto nulla è collegato per te: dovrai creare i controller sottostanti
manualmente ed eseguire tu stesso il rendering delle route.

### Controller

I controller sono hook React che configurano aspetti specifici del framework.
`<RebaseNavigation>` li chiama tutti per te — utilizzali direttamente solo all'interno di una
render prop.

#### `useBuildNavigationStateController`

Il controller principale che collega tutto insieme:

Il suo parametro `data` è ciò che viene passato ai builder di collezioni e viste: il
`context.data` piatto del `<Rebase>` che lo racchiude (vedi [Un'unica struttura dati](#ununica-struttura-dati)),
quindi questo hook deve essere chiamato all'interno dell'albero di `<Rebase>`.

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

Gestisce il tema chiaro/scuro. Quando è abilitato controlla il tema della pagina: applica
la classe `dark` su `<html>`, segue `prefers-color-scheme` finché l'utente non
sceglie una modalità e memorizza tale scelta nel localStorage.

```typescript
const modeController = useBuildModeController();

modeController.mode;             // "light" | "dark"
modeController.setMode("dark");  // "light" | "dark" | "system" — "system" follows the OS again
```

`<Rebase>` ne crea uno autonomamente.

Quando il
componente che lo utilizza viene smontato, rimuove la classe `dark` aggiunta; un'eventuale
classe `dark` già presente nella pagina rimane. Crea il tuo
al di sopra di `<Rebase>` solo quando anche i componenti esterni ad esso hanno bisogno della modalità, e passalo
tramite la [prop `modeController`](#stili), così da avere un solo controller
invece di due. `useBuildModeController({ enabled: false })` crea un controller
inerte: mantiene `mode` nello stato di React e non tocca alcuna classe, media query
o localStorage. Quando la tua applicazione gestisce già il tema non hai affatto bisogno di questo
hook: passa il tuo controller come `modeController`.

#### `useBuildAdminModeController`

Consente di alternare tra le modalità Studio e Content:

```typescript
const adminModeController = useBuildAdminModeController();
// Provides: adminModeController.mode ("cms" | "studio")
```

### Componenti Scaffold

| Componente | Descrizione |
|-----------|-------------|
| `<Scaffold>` | Container di layout principale con barra laterale reattiva |
| `<AppBar>` | Barra di navigazione superiore con ricerca, selettore tema, menu utente |
| `<Drawer>` | Navigazione laterale con elenco delle collezioni e collegamenti alle viste |
| `<SideDialogs>` | Contenitore per gli editor di entità nel pannello laterale |
| `<RebaseRoutes>` | Contenitore di route integrato con React Router |
| `<RebaseRoute>` | Gestisce le route delle collezioni (`/c/*`) |
| `<ContentHomePage>` | Home page predefinita che mostra le schede delle collezioni |
| `<StudioHomePage>` | Home page della modalità Studio con strumenti per sviluppatori |

## Viste personalizzate

Aggiungi viste di navigazione di primo livello per dashboard, strumenti o pagine personalizzate. Un
`AppView` è un oggetto piatto — tutto ciò che segue si trova al livello principale, non c'è un blocco
`admin` annidato:

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

Passale a `<RebaseCMS>`, insieme alle tue personalizzazioni — è questo il
componente che registra la navigazione:

```tsx
<RebaseCMS tableCustomizations={tableCustomizations} views={views}/>
```

| Campo | |
|---|---|
| `slug` | il percorso a cui è raggiungibile, sotto la radice dell'admin |
| `name` | l'etichetta nel drawer e nella home page |
| `view` | l'elemento da visualizzare, o un `ComponentType` per il rendering lazy |
| `icon` | il nome di un'icona [Lucide](https://lucide.dev/icons/), ad es. `"ShoppingCart"` — o qualsiasi nodo |
| `group` | raggruppa le viste nel drawer; `"Admin"` e `"Settings"` vengono posizionati in fondo |
| `pinToBottom` | sposta il gruppo in fondo indipendentemente dal nome — preferibile rispetto alle due stringhe magiche |
| `nestedRoutes` | registra anche `slug/*`, per una vista che gestisce route interne proprie |
| `hideFromNavigation` | mantiene la route, omette la voce dalla navigazione |
| `roles` | solo gli utenti con uno di questi ruoli vedono la vista o possono accedervi |
| `description` | Markdown, mostrato nella scheda della home page |

Per inserire una vista sotto **Studio** invece che nel CMS, passala a
[`<RebaseStudio devViews>`](/docs/studio#adding-your-own-tool).

## Stili

Rebase utilizza **Tailwind CSS v4** e supporta le modalità chiaro/scuro. Personalizzabile tramite:

- **Proprietà personalizzate CSS** — Sovrascrivi i design token
- **`<Rebase modeController>`** — Assegna a Rebase la modalità chiaro/scuro della tua app
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

Per impostazione predefinita `<Rebase>` gestisce il tema della pagina: inserisce la classe `dark` su
`<html>`, segue `prefers-color-scheme` finché l'utente non sceglie una modalità
nell'admin, e ricorda tale preferenza in localStorage.

Quando `<Rebase>`
viene smontato, rimuove la classe `dark` aggiunta; un'eventuale classe già presente sulla pagina
rimane intatta.

Quando la tua app
ha già un tema, passalo come `modeController`. Rebase ne legge il `mode`,
chiama il rispettivo `setMode` dal proprio toggle del tema, e non tocca mai `<html>`,
`prefers-color-scheme` o localStorage:

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

Il CSS dello scaffold applica lo stile della modalità scura a qualsiasi elemento con la classe `dark`
(`@custom-variant dark (&:where(.dark, .dark *))`). I pannelli laterali, le finestre di dialogo e
i menu vengono renderizzati in un portale su `<body>`, quindi inserisci la classe su `<html>` o `<body>`
anziché su un contenitore attorno a `<Rebase>`.

Avvolgere `<Rebase>` in un `ModeControllerProvider` non produce questo risultato:
`<Rebase>` fornisce già un controller proprio al suo interno.

## Passaggi successivi

- **[customizeTable](/docs/frontend/customize-table)** — Tutte le opzioni per la collezione di una tabella
- **[Campi personalizzati](/docs/frontend/custom-fields)** — Crea campi form personalizzati
- **[Viste entità](/docs/frontend/entity-views)** — Aggiungi schede agli editor di entità
- **[Modalità di visualizzazione](/docs/frontend/view-modes)** — Elenco, Tabella, Card, Kanban
- **[Traduzioni](/docs/frontend/i18n)** — Modifica qualsiasi stringa o aggiungi una lingua
- **[Plugin](/docs/plugins)** — Estendi il framework
