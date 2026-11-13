---
sourceHash: c6b361597710219f
title: Struttura del progetto
sidebar_label: Struttura del progetto
description: "La struttura di un progetto Rebase — le tabelle in backend/schema, i moduli backend letti dal runtime e le personalizzazioni del pannello di amministrazione in frontend/src/cms — con e senza il pannello."
---

:::note[Sei termini utilizzati in questa pagina]
Ognuno di essi ha un significato specifico qui, e la maggior parte ha un significato diverso altrove nel settore.

- **Table** — una tabella Postgres, dichiarata in TypeScript con `defineTable` in
  `backend/schema/`. Da essa derivano il codice SQL, i criteri di row-level security, l'API, i
  tipi dell'SDK e le impostazioni predefinite del pannello di amministrazione.
- **Collection** — ciò che mostra il pannello di amministrazione: una tabella renderizzata come elenco e
  modulo, personalizzata in `frontend/src/cms/`, oppure una collezione Firestore letta direttamente dal pannello.
- **Studio** — la parte per sviluppatori del pannello di amministrazione: editor di schema, console SQL,
  browser dei criteri. La stessa applicazione utilizzata dal team editoriale, accessibile tramite un selettore.
- **Managed runtime** — l'immagine pubblicata `rebasepro/server` avvia il tuo
  progetto. Non devi scrivere alcun file server e ricevi gli aggiornamenti del runtime senza
  dover ricompilare. L'alternativa è `rebase eject`, descritta di seguito.
- **Bundle** — ciò che produce `rebase build`: tabelle, funzioni e cron job
  compilati, accompagnati da un manifesto che specifica dove si trova ciascuno. È ciò che viene
  avviato dal runtime gestito.
- **Resource** — un elemento di cui il progetto ha bisogno dall'ambiente in cui viene eseguito: un database,
  un bucket, un topic. Viene dichiarata in `backend/resources.ts` e associata tramite
  variabili d'ambiente.
:::

<span class="since-badge" data-since="0.31">Da 0.31</span>

`rebase init` genera uno dei due layout disponibili. Entrambi condividono la stessa cartella `backend/`; la
differenza sta nella presenza o meno del pannello di amministrazione.

**Con il pannello di amministrazione** (predefinito):

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

**Solo backend** (`rebase init --headless`): la stessa cartella `backend/`, ma senza
`frontend/` — e senza `backend/schema/`. All'avvio, il server legge le tabelle del database
ed espone ciascuna di quelle per cui è abilitata la row-level security. Consulta
[Solo backend](/docs/getting-started/headless/).

```
my-api/
├── .env
├── rebase.json
├── package.json
└── backend/
    ├── storage.ts
    └── functions/
```

Altri due elementi compaiono quando necessario, ed entrambi vengono letti dal runtime:
`backend/hooks.ts`, la cui esportazione `hooks` viene eseguita per ogni tabella
([Hook globali](/docs/backend/hooks/)), e `backend/crons/`, dedicato ai
processi pianificati (cron job). Il comando `rebase generate-sdk --register` aggiunge la cartella `backend/generated/`.

`tsc --noEmit` nella root controlla `scripts/`; all'interno di `backend/` o `frontend/`
controlla il rispettivo workspace. Non esiste un package `config/` separato: il frontend
importa una tabella da `backend/schema` unicamente come tipo (`import type`). Un'importazione
di valori di qualsiasi elemento all'interno di `backend/` invierebbe codice server — hook e
i segreti da essi letti — al browser; per questo motivo `rebaseBackendGuard()` da
`@rebasepro/app/vitePlugin`, presente nel file `frontend/vite.config.ts` generato, interrompe con un errore
`vite build` e `vite dev` qualora qualcosa si risolva all'interno di `backend/`, indicando il modulo
importatore, l'importazione e il file. `rebase build` rifiuta un frontend privo di questa
protezione. Per aggiungerla a un progetto esistente, importala e aggiungi `rebaseBackendGuard()`
a `plugins` in `frontend/vite.config.ts`.

:::note[Non è presente alcun file `backend/src/index.ts`]
E nessun `Dockerfile`. Un progetto generato dichiara `runtime: "managed"` in
`rebase.json`, il che significa che **l'immagine pubblicata `rebasepro/server` avvia il tuo
progetto come bundle** — lo stesso artefatto, sia in caso di self-hosting che di deployment
su Rebase Cloud. La configurazione del server avviene tramite `rebase.json`, i file in
`backend/` e le variabili d'ambiente, anziché scrivendo un entry point.

Se desideri avere il pieno controllo del processo — con middleware personalizzati, route dedicate
e la tua configurazione di autenticazione — `rebase eject` genera l'entry point, un Dockerfile e un
file compose per compilarli. Consulta [Integrazione server personalizzato](/docs/backend/custom-server).
:::

## Tabelle (`backend/schema/`)

<span class="since-badge" data-since="0.31">Da 0.31</span>

Le tabelle rappresentano l'**unica fonte di verità** (single source of truth) per il tuo modello di dati:

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
Postgres e la route del pannello; `table` e `slug` consentono di sovrascriverli. `rls` è
obbligatorio. Una tabella viene inclusa non appena viene esportata da `backend/schema/index.ts` — una
chiamata a `defineTable` omessa dall'index impedirà l'avvio. La sezione [Tabelle](/docs/schema/)
descrive tutte le opzioni disponibili.

## Frontend (`frontend/`)

Il frontend è una comune applicazione **Vite + React + TypeScript**. Il file principale è `App.tsx`, che collega insieme tutti i controller di Rebase:

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
// How the collection editor laid out the tables in development (labels, columns, views).
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

`main.tsx` esegue il mount dell'applicazione impostando come `basename` di `react-router` il valore ottenuto da
`import.meta.env.BASE_URL`, impostato da `rebase build` a partire dal `path` dichiarato dall'app
in `rebase.json` — in questo modo gli asset statici, il router e il server condividono
lo stesso valore senza doverlo definire tre volte.

### Concetti chiave

<span class="since-badge" data-since="0.31">Da 0.31</span>

- **`createRebaseClient`** — Crea il client SDK che gestisce le richieste HTTP, le connessioni WebSocket e la gestione dei token di autenticazione. Va invocato una sola volta a livello di modulo: all'interno di un componente, anche in un `useMemo`, `<React.StrictMode>` creerebbe un secondo client durante lo sviluppo.
- **`<RebaseCMS tableCustomizations>`** — il pannello esegue il rendering di ogni tabella esposta dal backend all'endpoint `GET /api/schema/tables`; gli oggetti `customizeTable` definiti in `frontend/src/cms/` ne modificano l'aspetto, mentre `uiConfig` memorizza ciò che è stato salvato nell'editor delle collezioni durante lo sviluppo. Consulta [Personalizzare una tabella](/docs/frontend/customize-table/#customizations-ui-configjson-and-preferences)
- **`useRebaseAuthController`** — Mantiene lo stato dell'utente autenticato e il ciclo di vita dei token, distribuendoli tramite `<Rebase>` a tutti i componenti sottostanti

## Backend (`backend/`)

Non è presente alcun file server da consultare, ed è progettato appositamente così: un progetto generato
dichiara `runtime: "managed"`, per cui l'immagine pubblicata `rebasepro/server` avvia
il progetto. La cartella `backend/` contiene il codice che il runtime rileva ed esegue:

| Percorso | Descrizione |
|---|---|
| `backend/schema/` | Le tabelle e il `defaultRls` esportato dal loro index |
| `backend/resources.ts`, `backend/storage.ts`, `backend/hooks.ts` | Le risorse dichiarate, `storageAuthorize` e gli hook globali delle tabelle |
| `backend/functions/` | Route personalizzate, montate automaticamente su `/api/functions/<filename>` |
| `backend/crons/` | Processi pianificati (cron job), rilevati nello stesso modo (crea la cartella all'occorrenza) |
| `backend/src/schema.generated.ts` | Lo schema Drizzle delle tabelle: generato da `rebase init` e rigenerato a ogni esecuzione di `rebase dev` e `rebase build` |

Il runtime configura automaticamente:

- **REST API** su `/api/data/*` — operazioni CRUD generate per ogni tabella
- **Autenticazione** su `/api/auth/*` — registrazione, accesso, refresh dei token, OAuth
- **Storage** su `/api/storage/*` — caricamento e download di file
- **WebSocket** — sincronizzazione in tempo reale tramite LISTEN/NOTIFY di Postgres
- **Funzioni e cron job**, a partire dalle directory sopra indicate

La configurazione viene definita tramite `rebase.json`, i file in `backend/` e le variabili
d'ambiente. Consulta [Ambiente e configurazione](/docs/getting-started/configuration).

`rebase build` trasforma il tutto in un **bundle** — tabelle, funzioni e cron job
compilati, oltre a un manifesto — che viene avviato dal runtime gestito. Nessuna parte
del bundle viene scritta manualmente; per approfondirne la struttura,
[Runtime e bundle](/docs/architecture/runtime-and-bundles/) descrive cosa include.

Il pannello fornito dal frontend è suddiviso in due sezioni. **Studio** è quella dedicata agli sviluppatori —
con editor di schema, console SQL e visualizzatore dei criteri RLS — ed è accessibile
tramite il selettore nel pannello laterale (drawer), non come deployment separato. Consulta [Studio](/docs/studio/).

Se invece desideri assumere il controllo completo del processo — middleware personalizzati, route
proprie e logica di autenticazione dedicata — esegui `rebase eject`. **Tutto ciò che segue questo paragrafo riguarda esclusivamente i progetti "ejected"**:
un progetto appena generato non include alcuno di questi file e nulla al suo interno richiama
`initializeRebaseBackend`. Il comando genera un entry point che chiama direttamente
`initializeRebaseBackend`, oltre a un Dockerfile e a un file compose per la compilazione;
da quel momento in poi la manutenzione del server spetta a te e gli aggiornamenti del runtime della
piattaforma non verranno più applicati automaticamente al progetto. Questo argomento è documentato in
[Integrazione server personalizzato](/docs/backend/custom-server).

## Come si collegano i componenti

<span class="since-badge" data-since="0.31">Da 0.31</span>

1. **Dichiari** le tabelle in `backend/schema/`
2. **Il backend** le compila, crea tabelle e criteri di sicurezza ed espone le route REST, realtime e MCP
3. **Il pannello di amministrazione** le legge da `GET /api/schema/tables` e renderizza una vista per ciascuna, personalizzata tramite i file in `frontend/src/cms/`
4. **La CLI** le legge per generare lo schema Drizzle (`rebase schema generate`), i tipi dell'SDK (`rebase generate-sdk`) e, partendo da tale schema, i file di migrazione (`rebase db generate`)

Mentre `rebase dev` è in esecuzione, il salvataggio di un file all'interno di `backend/schema/`
rigenera `backend/src/schema.generated.ts` e i tipi dell'SDK in `generated/sdk/`, riavvia il
backend e la fase di boot crea le tabelle e le colonne mancanti. Al di fuori di `rebase dev`,
gli stessi passaggi si eseguono con `rebase schema generate` e `rebase generate-sdk`.

Un progetto precedente alla versione 0.31 ha invece una directory `config/collections/`. I comandi la
rifiuteranno suggerendo di eseguire `rebase migrate collections-to-tables`, che provvede a
spostarla — vedi [la guida all'aggiornamento](/docs/upgrading/0-30-to-0-31/).

## Passaggi successivi

- **[Guida rapida](/docs/getting-started/quickstart)** — Inizia a lavorare con un nuovo progetto Rebase
- **[Tabelle](/docs/schema/)** — Dichiara il tuo modello di dati
- **[Configurazione](/docs/getting-started/configuration)** — Tutte le variabili d'ambiente e le opzioni
