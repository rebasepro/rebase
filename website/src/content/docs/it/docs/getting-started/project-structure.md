---
sourceHash: 10e6c0404ca260a3
title: Struttura del progetto
sidebar_label: Struttura del progetto
description: "La struttura di un progetto Rebase: le tabelle in backend/schema, i moduli backend letti dal runtime e le personalizzazioni del pannello di amministrazione in frontend/src/cms, con e senza pannello."
---

:::note[Sei termini utilizzati in questa pagina]
Ciascuno di essi ha un significato specifico in questo contesto, e la maggior parte di essi assume un significato diverso altrove nel settore.

- **Table (Tabella)** — una tabella Postgres, dichiarata in TypeScript con `defineTable` in
  `backend/schema/`. L'SQL, le policy di row-level security, l'API, i tipi
  dell'SDK e le impostazioni predefinite del pannello di amministrazione derivano tutti da essa.
- **Collection (Collezione)** — ciò che mostra il pannello di amministrazione: una tabella visualizzata come elenco e
  modulo, personalizzata in `frontend/src/cms/`, oppure una collezione Firestore letta
  direttamente dal pannello.
- **Studio** — la parte per sviluppatori del pannello di amministrazione: editor di schema, console
  SQL, visualizzatore di policy. La stessa applicazione utilizzata dal team dei contenuti, dietro un selettore.
- **Managed runtime (Runtime gestito)** — l'immagine pubblicata `rebasepro/server` avvia il tuo
  progetto. Non devi scrivere alcun file per il server e ricevi gli aggiornamenti del runtime senza bisogno
  di ricompilare. L'alternativa è `rebase eject`, spiegato di seguito.
- **Bundle** — ciò che produce `rebase build`: le tue tabelle, funzioni e cron,
  compilati, con un manifest che indica dove si trova ciascuno di essi. È ciò che il runtime
  gestito avvia.
- **Resource (Risorsa)** — qualcosa di cui il progetto ha bisogno dall'ambiente in cui viene eseguito: un database,
  un bucket, un topic. Dichiarata in `backend/resources.ts`, associata tramite variabili
  di ambiente.
:::

`rebase init` genera una delle due possibili strutture. Entrambe condividono lo stesso `backend/`; la
differenza sta nella presenza o meno del pannello di amministrazione nel progetto.

**Con il pannello di amministrazione** (l'impostazione predefinita):

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

**Solo backend** (`rebase init --headless`): lo stesso `backend/`, senza `frontend/`
— e senza nemmeno `backend/schema/`. Il server legge le tabelle del database stesso
all'avvio e serve ciascuna tabella su cui è abilitata la row-level security. Consulta
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

Altri due file compaiono quando ne hai bisogno, ed entrambi vengono letti dal runtime:
`backend/hooks.ts`, la cui esportazione `hooks` viene eseguita per ogni tabella
([Hook globali](/docs/backend/hooks/)), e `backend/crons/`, per i job pianificati.
`rebase generate-sdk --register` aggiunge `backend/generated/`.

`tsc --noEmit` nella root controlla `scripts/`; in `backend/` o `frontend/`
controlla quel rispettivo workspace. Non esiste un package `config/` separato: il frontend
importa una tabella da `backend/schema` solo come tipo (`import type`). Un'importazione di valore
di qualsiasi elemento in `backend/` trasferirebbe codice server — gli hook e i segreti
da essi letti — al browser, quindi `rebaseBackendGuard()` da
`@rebasepro/app/vitePlugin`, presente in `frontend/vite.config.ts` dello scaffold, blocca
`vite build` e `vite dev` qualora qualcosa si risolva all'interno di `backend/`, indicando
il modulo importatore, l'importazione e il file. `rebase build` rifiuta un frontend privo di
questo controllo. Per aggiungerlo a un progetto esistente, importalo e aggiungi `rebaseBackendGuard()`
a `plugins` in `frontend/vite.config.ts`.

:::note[Non c'è alcun `backend/src/index.ts`]
E nessun `Dockerfile`. Un progetto creato tramite scaffolding dichiara `runtime: "managed"` in
`rebase.json`, il che significa che l'**immagine pubblicata `rebasepro/server` avvia il tuo
progetto come un bundle** — lo stesso artefatto, sia che tu scelga il self-hosting sia che effettui il deploy
su Rebase Cloud. Puoi configurare il server tramite `rebase.json`, i file in
`backend/` e le variabili di ambiente invece di dover scrivere un entry point.

Se desideri avere il pieno controllo del processo — i tuoi middleware, le tue route, la tua
gestione dell'autenticazione — `rebase eject` genera l'entry point, un Dockerfile e un
file compose per compilarli. Consulta [Integrazione server personalizzato](/docs/backend/custom-server).
:::

## Tabelle (`backend/schema/`)

Le tabelle sono l'**unica fonte di verità** per il tuo modello di dati:

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
obbligatorio. Una tabella viene considerata non appena `backend/schema/index.ts` la esporta — un
`defineTable` tralasciato dall'index impedirà l'avvio. La sezione [Tabelle](/docs/schema/)
illustra tutte le opzioni disponibili.

## Frontend (`frontend/`)

Il frontend è un'applicazione standard **Vite + React + TypeScript**. Il file principale è `App.tsx`, che collega tutti i controller di Rebase:

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

`main.tsx` effettua il montaggio sotto un `basename` di `react-router` ricavato da
`import.meta.env.BASE_URL`, che `rebase build` imposta a partire dal `path` dichiarato da questa
app in `rebase.json` — in questo modo gli asset, il router e il server concordano su
un unico valore senza doverlo specificare tre volte.

### Concetti chiave

- **`createRebaseClient`** — Crea il client SDK che gestisce le richieste HTTP, le connessioni WebSocket e la gestione dei token di autenticazione. Richiamalo una sola volta, a livello di modulo: all'interno di un componente, perfino dentro uno `useMemo`, `<React.StrictMode>` crea un secondo client in modalità di sviluppo
- **`<RebaseCMS tableCustomizations>`** — il pannello esegue il rendering di ogni tabella servita dal backend all'endpoint `GET /api/schema/tables`; gli oggetti `customizeTable` definiti in `frontend/src/cms/` modificano l'aspetto di alcune di esse, mentre `uiConfig` fornisce il layout condiviso da `frontend/src/cms/ui-config.json`. Consulta [Personalizzare una tabella](/docs/frontend/customize-table/#customizations-ui-configjson-and-preferences)
- **`useRebaseAuthController`** — Mantiene lo stato dell'utente autenticato e il ciclo di vita dei token, ed è ciò che `<Rebase>` distribuisce a tutti i componenti sottostanti

## Backend (`backend/`)

Non c'è alcun file server da leggere, ed è stato progettato appositamente così: un progetto
generato tramite scaffolding dichiara `runtime: "managed"`, perciò l'immagine pubblicata
`rebasepro/server` si occupa di avviare il progetto. La cartella `backend/` contiene il codice
che il runtime carica:

| Percorso | Che cos'è |
|---|---|
| `backend/schema/` | Le tabelle e il `defaultRls` esportato dal loro file index |
| `backend/resources.ts`, `backend/storage.ts`, `backend/hooks.ts` | Risorse dichiarate, `storageAuthorize` e hook globali delle tabelle |
| `backend/functions/` | Route personalizzate, montate automaticamente su `/api/functions/<filename>` |
| `backend/crons/` | Job pianificati, individuati allo stesso modo (crea la cartella quando ne hai bisogno) |
| `backend/src/schema.generated.ts` | Lo schema Drizzle delle tue tabelle: generato da `rebase init` e rigenerato a ogni esecuzione di `rebase dev` e `rebase build` |

Il runtime predispone:

- **API REST** su `/api/data/*` — operazioni CRUD generate per ogni tabella
- **Autenticazione** su `/api/auth/*` — registrazione, login, refresh dei token, OAuth
- **Storage** su `/api/storage/*` — upload e download
- **WebSocket** — sincronizzazione in tempo reale tramite Postgres LISTEN/NOTIFY
- **Funzioni e cron**, a partire dalle directory indicate sopra

La configurazione proviene da `rebase.json`, dai file presenti in `backend/` e dalle
variabili di ambiente. Consulta [Ambiente e configurazione](/docs/getting-started/configuration).

`rebase build` trasforma tutto questo in un **bundle** — le tabelle compilate,
le funzioni e i cron insieme a un manifest — che viene avviato dal runtime gestito. Nulla
del bundle viene scritto manualmente; se desideri esaminarne uno, la documentazione
[Runtime e bundle](/docs/architecture/runtime-and-bundles/) descrive dettagliatamente il suo contenuto.

Il pannello servito dal frontend è composto da due sezioni. **Studio** è quella dedicata agli
sviluppatori — l'editor di schema, la console SQL, il visualizzatore di policy RLS — ed è
accessibile tramite il selettore nel menu a scomparsa, non come deployment separato. Consulta [Studio](/docs/studio/).

Se invece desideri assumere il pieno controllo del processo — con middleware, route e
gestione dell'autenticazione personalizzati — esegui `rebase eject`. **Tutto ciò che segue questo paragrafo riguarda esclusivamente la modalità ejected**:
un progetto generato via scaffolding non include nessuno di questi file e nulla al suo interno richiama
`initializeRebaseBackend`. Il comando genera un entry point che chiama
`initializeRebaseBackend` direttamente, oltre a un Dockerfile e a un file compose per la relativa
compilazione; da quel momento in poi dovrai occuparti personalmente della manutenzione del server e gli aggiornamenti del runtime
della piattaforma non verranno più applicati automaticamente al progetto. Questa superficie di integrazione è documentata in
[Integrazione server personalizzato](/docs/backend/custom-server).

## Come si collegano tra loro

1. **Tu dichiari** le tabelle in `backend/schema/`
2. **Il backend** le compila, crea le tabelle e le relative policy, e monta le route REST, realtime e MCP
3. **Il pannello di amministrazione** le legge tramite `GET /api/schema/tables` ed esegue il rendering di una vista per ciascuna, personalizzata dai file in `frontend/src/cms/`
4. **La CLI** le analizza per generare lo schema Drizzle (`rebase schema generate`), i tipi dell'SDK (`rebase generate-sdk`) e, a partire da tale schema, i file di migrazione (`rebase db generate`)

Mentre `rebase dev` è in esecuzione, il salvataggio di un file all'interno di `backend/schema/`
rigenera `backend/src/schema.generated.ts` e i tipi dell'SDK in
`generated/sdk/`, riavvia il backend e l'avvio provvede a creare le tabelle e le colonne
mancanti. Al di fuori di `rebase dev`, le stesse operazioni si eseguono con `rebase schema generate`
e `rebase generate-sdk`.

Un progetto creato prima della versione 0.31 include invece la cartella `config/collections/`. Ogni
comando rifiuterà tale struttura indicando di eseguire `rebase migrate collections-to-tables`, che si occupa
del passaggio — consulta [la guida all'aggiornamento](/docs/upgrading/0-30-to-0-31/).

## Passaggi successivi

- **[Guida rapida](/docs/getting-started/quickstart)** — Inizia a lavorare con un nuovo progetto Rebase
- **[Tabelle](/docs/schema/)** — Dichiara il tuo modello di dati
- **[Configurazione](/docs/getting-started/configuration)** — Tutte le variabili di ambiente e le opzioni disponibili
