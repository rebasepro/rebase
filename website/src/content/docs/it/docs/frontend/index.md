---
sourceHash: 8e814603c912d2a1
title: Panoramica del Frontend
sidebar_label: Frontend
description: Costruisci e personalizza il pannello di amministrazione Rebase con React — controller, scaffold, routing e viste.
---

## Panoramica

Il frontend di Rebase è un **framework React** che renderizza il tuo pannello di amministrazione. Legge le tue definizioni di collezioni e genera automaticamente tabelle, form, navigazione e routing.

Nello scaffold predefinito, il pannello di amministrazione **è** il frontend: viene servito alla radice dell'URL di deploy. Se invece costruisci la tua applicazione di prodotto, puoi montare l'admin sotto un prefisso come `/admin` nello stesso deploy — vedi [Cambiare l'URL di base](/docs/getting-started/deployment#changing-the-base-url).

Questo è `frontend/src/App.tsx` così come lo scrive `rebase init` — l'intero
pannello di amministrazione, quattro dichiarazioni dentro un solo provider:

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

I primi tre non renderizzano nulla: *registrano* configurazione nel provider.
`<RebaseShell>` è ciò che disegna — legge quel registro e da lì costruisce
navigazione, rotte e layout. L'ordine in cui compaiono quindi non conta, e
aggiungere una funzionalità significa aggiungere un componente, non ricablare un
albero.

| Componente | Pacchetto | Registra |
|---|---|---|
| `<RebaseAuth>` | `@rebasepro/app` | la schermata di accesso (`loginView`) |
| `<RebaseCMS>` | `@rebasepro/cms` | collezioni, viste personalizzate, la home page, l'editor di collezioni |
| `<RebaseStudio>` | `@rebasepro/studio` | gli strumenti per sviluppatori (SQL, RLS, log, backup…) |
| `<RebaseShell>` | `@rebasepro/cms` | nulla — renderizza l'admin a partire da tutto quanto sopra |

Togli `<RebaseStudio>` e hai un CMS di soli contenuti; togli `<RebaseCMS>` e hai
i soli strumenti per sviluppatori. Per impaginare la shell a mano, vedi
[Avanzato: layout manuale](#avanzato-layout-manuale).

## Il Provider Rebase

`<Rebase>` è il provider radice che rende tutte le funzionalità di Rebase disponibili ai componenti figli tramite il contesto. Accetta:

Tutte e ventidue, per intero — la tabella ne elencava dieci, e due di quelle
erano prop che il componente non ha mai letto:

<!-- rebase-props:start -->
| Prop | Descrizione |
|------|-------------|
| `children` | I componenti radice dell'admin — `<RebaseCMS>`, `<RebaseStudio>`, `<RebaseShell>`. Una render function è la via di fuga per il layout manuale. |
| `apiUrl` | URL di base dell'API backend, resa disponibile a ogni hook tramite `useApiConfig()` |
| `dateTimeFormat` | Come vengono stampate le date. Predefinito `MMMM dd, yyyy, HH:mm:ss` |
| `locale` | Lingua iniziale dell'admin, e locale con cui vengono formattate le date — vedi [Traduzioni](/docs/frontend/i18n) |
| `client` | Istanza di `RebaseClient`: la sorgente predefinita per dati, autenticazione e storage |
| `dataSources` | Sorgenti dati aggiuntive, per le collezioni che ne indicano una — vedi [Sorgenti multiple](/docs/backend/multiple-sources) |
| `authController` | Stato e metodi di autenticazione. Sostituisce del tutto la sottoscrizione a `client.auth` |
| `storageSource` | La sorgente di storage predefinita, che ha la precedenza su `client.storage` |
| `storageSources` | Sorgenti di storage con nome oltre a quella predefinita |
| `databaseAdmin` | Operazioni amministrative sul database (SQL, scoperta dello schema). Serve solo a Studio |
| `userConfigPersistence` | Preferenze locali di UI — larghezze delle colonne, gruppi compressi |
| `onAnalyticsEvent` | Chiamata per ogni evento di analytics emesso dall'admin |
| `entityLinkBuilder` | Restituisce un URL per il pulsante «apri nella tua app» sul form di un'entità |
| `plugins` | Istanze di plugin — vedi [Plugin](/docs/plugins) |
| `slots` | Contributi agli slot dichiarati direttamente, senza un plugin |
| `propertyConfigs` | Widget di campo personalizzati, indicizzati per il nome che una proprietà indica in `propertyConfig` |
| `entityViews` | Tab globali di viste entità personalizzate |
| `collectionViews` | Modalità di visualizzazione delle collezioni personalizzate, disponibili a qualsiasi collezione tramite `key` |
| `entityActions` | Azioni globali sulle entità |
| `effectiveRoleController` | Simula un ruolo diverso mentre la modalità dev è attiva |
| `translations` | Sovrascrive o estende qualsiasi stringa della UI, indicizzata per locale — vedi [Traduzioni](/docs/frontend/i18n) |
| `components` | Sostituisce i componenti integrati — vedi [Override dei componenti](/docs/frontend/component-overrides) |
<!-- rebase-props:end -->

I controller di navigazione, URL e registro delle collezioni **non** sono prop di
`<Rebase>` — vengono costruiti dagli hook qui sotto e consumati dentro l'albero
dell'admin (`<RebaseShell>` li collega per te nello scaffold predefinito).

Nemmeno il prefisso dell'URL lo è. Quando l'admin è montato sotto un percorso,
quello va su `<RebaseCMS basePath="/admin">`, che è ciò che risolve gli URL nelle
collezioni — e solo quando il router non ha un `basename` proprio. Vedi
[Cambiare l'URL di base](/docs/getting-started/deployment#changing-the-base-url).

## Due forme di dati

Ci sono due livelli di dati, e **non** sono intercambiabili. Passare l'uno dove è
atteso l'altro è un errore di tipo, quindi vale la pena saperlo prima di
collegare un controller a mano.

| | Forma | Dove la ottieni | Com'è fatta una riga |
|---|---|---|---|
| **SDK** | `RebaseSdkData` — righe piatte | `client.data`, e `context.data` nei callback del backend | `row.title` |
| **Admin** | `RebaseData` — view-model `Entity` | `useData()`, dentro l'albero `<Rebase>` | `entity.values.title` |

Il livello SDK è la superficie pubblica e simmetrica: identica sul client
frontend e nei callback del backend. Il livello `Entity` è il view-model
dell'admin — aggiunge l'involucro `id` / `path` / `values` su cui le viste di
collezione e i form fanno il rendering. `CollectionAccessor` e `FindResponse`
appartengono a esso e sono marcati `@internal` proprio per questo.

`<Rebase>` è il confine tra i due: prende il tuo `client.data` piatto e lo
avvolge con `wrapAsEntityData()` prima di fornirlo come `RebaseData` dell'admin.
Non lo chiami mai tu — prendi semplicemente la forma che ti serve dal posto
giusto:

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

## Avanzato: layout manuale

Tutto ciò che segue sostituisce `<RebaseShell>`. Ti serve solo quando il layout
di serie è d'intralcio — una cornice diversa attorno all'admin, un albero di
rotte tuo, un'app in cui l'admin è una pagina fra tante. Se non stai sostituendo
il layout, fermati a [Viste personalizzate](#viste-personalizzate).

`<RebaseShell>` è zucchero sintattico per quattro livelli, e puoi prenderli uno
alla volta:

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

L'ordine è fisso: `RebaseAuthGate → RebaseNavigation → RebaseRouteDefs →
RebaseLayout`. `RebaseAuthGate` mostra la vista di login finché non c'è un
utente, quindi nulla sotto di esso viene renderizzato per un visitatore non
autenticato; `RebaseNavigation` costruisce i controller di navigazione, URL e
registro delle collezioni che `RebaseRouteDefs` e ogni vista di collezione
leggono, per cui un `RebaseRouteDefs` fuori da esso solleva un'eccezione.

Ogni livello è utilizzabile per conto suo. `<RebaseAuthGate>` da solo mette la
tua app dietro il login di Rebase. Sostituisci `<RebaseLayout>` con un tuo
componente per tenere il routing e perdere la cornice; togli anche
`<RebaseRouteDefs>` e ti stai costruendo le rotte da solo con i componenti in
[Componenti dello scaffold](#componenti-dello-scaffold).

Sotto quel pavimento `<Rebase>` accetta anche una **render prop** al posto dei
children, che ti consegna il contesto e il flag di caricamento e lascia a te
l'intero albero:

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

A quel punto non c'è più nulla collegato per te: costruisci a mano i controller
qui sotto e renderizzi tu le rotte.

### Controller

I controller sono hook React che configurano aspetti specifici del framework.
`<RebaseNavigation>` li chiama tutti per te — ricorri a questi solo dentro una
render prop.

#### `useBuildNavigationStateController`

Il controller principale che collega tutto:

Il suo `data` è il `RebaseData` **in forma Entity**, quindi arriva da `useData()`
— non da `rebaseClient.data`, che è il livello SDK a righe piatte. `<Rebase>`
converte l'uno nell'altro per te (vedi
[Due forme di dati](#due-forme-di-dati) sopra), perciò questo hook va chiamato
dentro l'albero `<Rebase>`.

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

Gestisce come le collezioni vengono risolte dai percorsi URL:

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

Gestisce il tema chiaro/scuro:

```typescript
const modeController = useBuildModeController();
// Provides: modeController.mode ("light" | "dark"), modeController.toggleMode()
```

#### `useBuildAdminModeController`

Alterna tra le modalità Studio e Contenuto:

```typescript
const adminModeController = useBuildAdminModeController();
// Provides: adminModeController.mode ("cms" | "studio")
```

### Componenti dello scaffold

| Componente | Descrizione |
|-----------|-------------|
| `<Scaffold>` | Container di layout principale con barra laterale responsive |
| `<AppBar>` | Barra di navigazione superiore con ricerca, selettore di modalità, menu utente |
| `<Drawer>` | Navigazione laterale con l'elenco delle collezioni e i link alle viste |
| `<SideDialogs>` | Container per gli editor di entità a pannello laterale |
| `<RebaseRoutes>` | Container di rotte integrato con React Router |
| `<RebaseRoute>` | Gestisce le rotte di collezione (`/c/*`) |
| `<ContentHomePage>` | Home page predefinita con le schede delle collezioni |
| `<StudioHomePage>` | Home page della modalità Studio con gli strumenti per sviluppatori |

## Viste personalizzate

Aggiungi viste di navigazione di primo livello per dashboard, strumenti o pagine
personalizzate. Un `AppView` è un oggetto piatto — tutto ciò che segue sta al
livello superiore, non c'è alcun blocco `admin` annidato:

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

Passale a `<RebaseCMS>`, accanto alle tue collezioni — è quello il componente che
registra la navigazione:

```tsx
<RebaseCMS collections={collections} views={views}/>
```

| Campo | |
|---|---|
| `slug` | il percorso a cui è raggiungibile, sotto la radice dell'admin |
| `name` | l'etichetta nel drawer e nella home page |
| `view` | l'elemento da renderizzare, o un `ComponentType` per renderizzarlo in modo lazy |
| `icon` | un nome di icona [Lucide](https://lucide.dev/icons/), es. `"ShoppingCart"` — o un nodo qualsiasi |
| `group` | raggruppa le viste nel drawer; `"Admin"` e `"Settings"` scendono in fondo |
| `pinToBottom` | fa scendere il gruppo in fondo con qualsiasi nome — preferiscilo alle due stringhe magiche |
| `nestedRoutes` | registra anche `slug/*`, per una vista con rotte proprie |
| `hideFromNavigation` | mantiene la rotta, elimina la voce di navigazione |
| `roles` | solo gli utenti con uno di questi ruoli vedono la vista, o possono raggiungerla |
| `description` | Markdown, mostrato sulla scheda della home page |

Per mettere una vista sotto **Studio** invece che nel CMS, passala a
[`<RebaseStudio devViews>`](/docs/studio#adding-your-own-tool).

## Styling

Rebase utilizza **Tailwind CSS v4** e supporta le modalità chiara/scura. Personalizza tramite:

- **Proprietà personalizzate CSS** — Sovrascrivi i design token
- **`ModeControllerProvider`** — Controlla la modalità chiara/scura
- **Configurazione Tailwind** — Personalizzazione standard di Tailwind

```css
/* Override design tokens */
:root {
    --font-sans: "Instrument Sans", sans-serif;
    --font-headers: "Instrument Sans", sans-serif;
    --font-mono: "JetBrains Mono", monospace;
}
```

## Passi Successivi

- **[Campi personalizzati](/docs/frontend/custom-fields)** — Crea campi di form personalizzati
- **[Viste entità](/docs/frontend/entity-views)** — Aggiungi tab agli editor di entità
- **[Modalità di visualizzazione](/docs/frontend/view-modes)** — Lista, Tabella, Schede, Kanban
- **[Traduzioni](/docs/frontend/i18n)** — Cambia qualsiasi stringa, o aggiungi una lingua
- **[Plugin](/docs/plugins)** — Estendi il framework
