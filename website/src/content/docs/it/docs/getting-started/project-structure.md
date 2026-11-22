---
sourceHash: e8ad34a809d7352c
title: Struttura del progetto
sidebar_label: Struttura del progetto
description: "La struttura di un progetto Rebase: le tabelle in backend/schema, i moduli backend letti dal runtime e le personalizzazioni del pannello di amministrazione in frontend/src/cms, con e senza il pannello."
---

:::note[Sei termini utilizzati in questa pagina]
Ognuno di essi ha un significato specifico in questo contesto, e la maggior parte assume un significato diverso altrove nel settore.

- **Table** — una tabella Postgres, dichiarata in TypeScript con `defineTable` in
  `backend/schema/`. L'SQL, le policy di Row-Level Security, l'API, i tipi
  dell'SDK e le impostazioni predefinite del pannello di amministrazione provengono tutti da essa.
- **Collection** — ciò che mostra il pannello di amministrazione: una tabella visualizzata come
  elenco e form, personalizzata in `frontend/src/cms/`, oppure una collezione Firestore letta
  direttamente dal pannello.
- **Studio** — la sezione per sviluppatori del pannello di amministrazione: console SQL, policy
  RLS, diagramma dello schema, branch, log. La stessa applicazione utilizzata dal team editoriale,
  dietro un selettore (toggle).
- **Managed runtime** — l'immagine pubblicata `rebasepro/server` avvia il
  tuo progetto. Non devi scrivere alcun file server e ricevi gli aggiornamenti del runtime
  senza dover ricompilare. L'alternativa è `rebase eject`, descritto più avanti.
- **Bundle** — il risultato generato da `rebase build`: le tue tabelle, funzioni e cron,
  compilati, con un manifest che indica dove si trova ciascun elemento. È ciò che il
  runtime gestito avvia.
- **Resource** — qualcosa di cui il progetto ha bisogno dall'ambiente in cui viene eseguito: un database,
  un bucket, un topic. Dichiarata in `backend/resources.ts`, collegata tramite variabili
  d'ambiente.
:::

`rebase init` genera tramite scaffolding una tra due possibili strutture. Entrambe condividono lo stesso `backend/`; la
differenza sta nella presenza o meno del pannello di amministrazione.

**Con il pannello di amministrazione** (opzione predefinita):

```
my-app/
├── .env                    # Generated for you: JWT_SECRET, a database password, a free port
├── rebase.json             # Which apps this repository contains, and how each is built
├── package.json            # Root workspace config
├── tsconfig.json           # Typechecks scripts/; each workspace typechecks on its own
├── docker-compose.yml      # Self-hosting: Postgres + the published runtime image
├── scripts/
│   └── example.ts          # A health check and an SDK call to uncomment: `pnpm example`
│
├── backend/
│   ├── schema/             # Your tables
│   │   ├── index.ts        # Exports every table, and the optional defaultRls
│   │   ├── posts.ts        # defineTable("posts", …)
│   │   └── users.ts        # defineAuthTable("users", …)
│   ├── resources.ts        # What this project needs from wherever it runs
│   ├── storage.ts          # Who may read, write and list files (storageAuthorize)
│   ├── functions/          # Custom API routes, auto-mounted at /api/functions/<name>
│   │   └── hello.ts
│   └── src/
│       └── schema.generated.ts   # Drizzle schema, regenerated from your tables
│
└── frontend/               # The admin panel (React + Vite)
    ├── src/
    │   ├── App.tsx
    │   ├── main.tsx
    │   └── cms/            # How tables look in the panel: customizeTable(...)
    │       └── posts.tsx
    └── vite.config.ts
```

**Solo backend** (`rebase init --headless`): lo stesso `backend/`, senza
`frontend/` — e senza neanche `backend/schema/`. All'avvio il server legge le
tabelle del database stesso ed espone ciascuna di quelle con la Row-Level Security
abilitata. Consulta [Solo backend](/docs/getting-started/headless/).

```
my-api/
├── .env
├── rebase.json
├── package.json
└── backend/
    ├── storage.ts
    └── functions/
```

Altri due file compaiono quando ne hai bisogno, ed entrambi vengono letti dal runtime:
`backend/hooks.ts`, il cui export `hooks` viene eseguito per ogni tabella
([Hook globali](/docs/backend/hooks/)), e `backend/crons/`, per i job
pianificati. `rebase generate-sdk --register` aggiunge `backend/generated/`.

`tsc --noEmit` alla radice controlla `scripts/`; in `backend/` o `frontend/`
controlla il rispettivo workspace. Non esiste un package `config/` separato: il frontend
importa una tabella da `backend/schema` solo come tipo (`import type`). Un import di
valore per qualsiasi elemento all'interno di `backend/` invierebbe codice server — gli hook
e i secret che essi leggono — al browser; per questo motivo `rebaseBackendGuard()` da
`@rebasepro/app/vitePlugin`, presente nel file `frontend/vite.config.ts` dello scaffolding,
interrompe con un errore `vite build` e `vite dev` se qualcosa si risolve all'interno di `backend/`,
indicando il file importatore, l'import e il file di destinazione. `rebase build` rifiuta un
frontend che ne sia privo. Per aggiungerlo a un progetto esistente, importalo e aggiungi `rebaseBackendGuard()`
a `plugins` in `frontend/vite.config.ts`.

:::note[Non esiste alcun `backend/src/index.ts`]
E nessun `Dockerfile`. Un progetto creato tramite scaffolding dichiara `runtime: "managed"` in
`rebase.json`, il che significa che l'**immagine pubblicata `rebasepro/server` avvia il tuo
progetto come bundle** — lo stesso artefatto sia per il self-hosting sia per il deployment
su Rebase Cloud. Il server si configura tramite `rebase.json`, i file in
`backend/` e le variabili d'ambiente, anziché scrivendo un entry point.

Se desideri avere il pieno controllo del processo — middleware personalizzati, route dedicate,
configurazione dell'autenticazione — `rebase eject` genera l'entry point, un Dockerfile e un
file compose per compilarli. Consulta [Integrazione server personalizzato](/docs/backend/custom-server).
:::

## Tabelle (`backend/schema/`)

Le tabelle sono la **singola fonte di verità** per il tuo data model:

```typescript title="backend/schema/products.ts"
import { defineTable, col } from "@rebasepro/server/schema";

export const products = defineTable("products", {
    columns: {
        id:    col.uuid().primaryKey().defaultRandom(),
        name:  col.text().notNull(),
        price: col.numeric(),
    },
    rls: "admin-only",
});
```

Il nome diventa l'endpoint REST (`/api/data/products`), il nome della tabella in
Postgres e la route del pannello; `table` e `slug` permettono di sovrascriverli. `rls` è
obbligatorio. Una tabella diventa effettiva una volta esportata da `backend/schema/index.ts` — un
`defineTable` non incluso nell'index impedirà l'avvio. La sezione [Tabelle](/docs/schema/)
illustra ogni opzione disponibile.

## Frontend (`frontend/`)

Il frontend è una standard applicazione **Vite + React + TypeScript**. Il file chiave è `App.tsx`, che collega tra loro tutti i controller di Rebase:

```tsx title="frontend/src/App.tsx"
import "@fontsource/jetbrains-mono";
import "@fontsource-variable/inter";
import "@fontsource-variable/instrument-sans";

import { Rebase, RebaseAuth, useRebaseAuthController } from "@rebasepro/app";
import { RebaseCMS, RebaseShell } from "@rebasepro/cms";
import { ErrorBoundary } from "@rebasepro/ui";
import { RebaseStudio } from "@rebasepro/studio";
import { createRebaseClient } from "@rebasepro/client";
import { postsCms } from "./cms/posts";
import { authorsCms } from "./cms/authors";
import { tagsCms } from "./cms/tags";
import { usersCms } from "./cms/users";
// The admin panel's shared layout for each table (labels, columns, views).
import uiConfig from "./cms/ui-config.json";

// `rebase dev` injects VITE_API_URL with the port it actually bound, and that
// port is derived from this project's path rather than fixed — so a
// `http://localhost:3001` fallback here names a port nothing is listening on.
// A deployed build serves the admin from the same origin as the API, where an
// empty value is exactly what you want.
const API_URL = import.meta.env.VITE_API_URL;
const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID;

// One client for the page, created when this module loads. Inside a component,
// even in a `useMemo`, `<React.StrictMode>` builds a second one in development,
// and both restore the session and open their own connections.
const rebaseClient = createRebaseClient({
    baseUrl: API_URL,
    // Store the refresh token in an httpOnly cookie (XSS-safe) rather than
    // localStorage. The backend issues it via `auth.cookieAuth`.
    auth: { authFlowMode: "cookie" }
});

export function App() {
    const authController = useRebaseAuthController({
        client: rebaseClient,
        googleClientId: GOOGLE_CLIENT_ID
    });

    return (
        <ErrorBoundary fullPage>
            <Rebase
                client={rebaseClient}
                authController={authController}
            >
                {/* The sign-in screen. On its own this changes nothing —
                    it is where you pass `loginView` to replace it. */}
                <RebaseAuth />
                {/* Every table the backend serves gets an admin view with no
                    code. A file in ./cms changes how one of them looks:
                    labels, icons, enum colours, custom fields and actions. */}
                <RebaseCMS tableCustomizations={[postsCms, authorsCms, tagsCms, usersCms]} uiConfig={uiConfig} />
                <RebaseStudio/>
                <RebaseShell title="Rebase"/>
            </Rebase>
        </ErrorBoundary>
    );
}
```

`main.tsx` la monta sotto un `basename` di `react-router` ricavato da
`import.meta.env.BASE_URL`, che `rebase build` imposta a partire dal `path`
dichiarato da questa app in `rebase.json` — in questo modo gli asset, il router e il server concordano
su un unico valore senza doverlo specificare tre volte.

### Concetti chiave

- **`createRebaseClient`** — Crea il client SDK che gestisce le richieste HTTP, le connessioni WebSocket e la gestione dei token di autenticazione. Invocalo una sola volta, a livello di modulo: all'interno di un componente, anche in un `useMemo`, `<React.StrictMode>` crea un secondo client in fase di sviluppo
- **`<RebaseCMS tableCustomizations>`** — il pannello esegue il rendering di ogni tabella esposta dal backend su `GET /api/schema/tables`; gli oggetti `customizeTable` definiti in `frontend/src/cms/` ne modificano l'aspetto, mentre `uiConfig` applica il layout condiviso da `frontend/src/cms/ui-config.json`. Consulta [Personalizzare una tabella](/docs/frontend/customize-table/#customizations-ui-configjson-and-preferences)
- **`useRebaseAuthController`** — Gestisce l'utente autenticato e il ciclo di vita del token, ed è ciò che `<Rebase>` distribuisce a tutti i componenti sottostanti

## Backend (`backend/`)

Non c'è alcun file server da esaminare, ed è una scelta architetturale precisa: un progetto
creato con scaffolding dichiara `runtime: "managed"`, quindi l'immagine pubblicata `rebasepro/server`
avvia il tuo progetto. La cartella `backend/` contiene esclusivamente il codice che il runtime carica:

| Percorso | Descrizione |
|---|---|
| `backend/schema/` | Le tabelle e il `defaultRls` esportato dal loro index |
| `backend/resources.ts`, `backend/storage.ts`, `backend/hooks.ts` | Risorse dichiarate, `storageAuthorize` e gli hook globali delle tabelle |
| `backend/functions/` | Route personalizzate, montate automaticamente su `/api/functions/<filename>` |
| `backend/crons/` | Job pianificati, individuati con lo stesso meccanismo (crea la cartella quando ne hai bisogno) |
| `backend/src/schema.generated.ts` | Lo schema Drizzle delle tue tabelle: generato da `rebase init` e rigenerato a ogni `rebase dev` e `rebase build` |

Il runtime mette a disposizione:

- **API REST** su `/api/data/*` — CRUD generato per ogni tabella
- **Autenticazione** su `/api/auth/*` — registrazione, accesso, refresh, OAuth
- **Storage** su `/api/storage/*` — upload e download
- **WebSocket** — sincronizzazione in tempo reale tramite Postgres LISTEN/NOTIFY
- **Le tue funzioni e i tuoi cron**, a partire dalle directory sopra elencate

La configurazione viene definita in `rebase.json`, nei file all'interno di `backend/` e nelle
variabili d'ambiente. Consulta [Ambiente e configurazione](/docs/getting-started/configuration).

`rebase build` trasforma l'intero contenuto in un **bundle** — le tabelle compilate,
funzioni e cron, più un manifest — che viene avviato dal runtime gestito. Nessun elemento
del bundle viene scritto manualmente; se desideri approfondirne la composizione,
[Runtime e bundle](/docs/architecture/runtime-and-bundles/) ne descrive la struttura.

Il pannello fornito dal frontend è suddiviso in due sezioni. **Studio** è quella dedicata agli sviluppatori —
la console SQL, l'esploratore delle policy RLS, il diagramma dello schema — ed è accessibile
tramite il selettore nel pannello laterale (drawer), non tramite un deployment separato. Consulta [Studio](/docs/studio/).

Se preferisci gestire direttamente il processo — inserendo middleware personalizzati, route proprietarie e
la tua logica di autenticazione — esegui `rebase eject`. **Tutto ciò che segue questo paragrafo riguarda esclusivamente i progetti su cui è stato eseguito l'eject**:
un progetto con scaffolding non contiene nessuno di questi file e nulla al suo interno invoca
`initializeRebaseBackend`. Il comando genera un entry point che invoca direttamente
`initializeRebaseBackend`, oltre a un Dockerfile e a un file compose per la compilazione;
da quel momento in poi sarai tu a gestire il server e gli aggiornamenti del runtime della piattaforma
non raggiungeranno più il progetto. Tale interfaccia è documentata in
[Integrazione server personalizzato](/docs/backend/custom-server).

## Come interagiscono i componenti

1. **Tu dichiari** le tabelle in `backend/schema/`
2. **Il backend** le compila, crea le tabelle e le policy, e monta le route REST, realtime e MCP
3. **Il pannello di amministrazione** le legge da `GET /api/schema/tables` e genera una vista per ciascuna, personalizzata dai file in `frontend/src/cms/`
4. **La CLI** le analizza per generare lo schema Drizzle (`rebase schema generate`), i tipi dell'SDK (`rebase generate-sdk`) e, a partire da tale schema, i file di migrazione (`rebase db generate`)

Mentre `rebase dev` è in esecuzione, il salvataggio di un file in `backend/schema/`
rigenera `backend/src/schema.generated.ts` e i tipi dell'SDK in
`generated/sdk/`, riavvia il backend e l'avvio crea automaticamente le tabelle e le colonne
mancanti. Al di fuori di `rebase dev`, gli stessi passaggi si eseguono con `rebase schema generate`
e `rebase generate-sdk`.

Un progetto creato prima della versione 0.31 include invece una directory `config/collections/`. Ciascun
comando ne rifiuterà l'utilizzo suggerendo `rebase migrate collections-to-tables`, che provvede
a migrarla — consulta [la guida all'aggiornamento](/docs/upgrading/0-30-to-0-31/).

## Passaggi successivi

- **[Guida rapida](/docs/getting-started/quickstart)** — Inizia a utilizzare un nuovo progetto Rebase
- **[Tabelle](/docs/schema/)** — Dichiara il tuo data model
- **[Configurazione](/docs/getting-started/configuration)** — Tutte le variabili d'ambiente e le opzioni
