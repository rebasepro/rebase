---
sourceHash: 1fb30b9d3983d379
title: Distribuzione
sidebar_label: Distribuzione
description: Distribuisci il tuo progetto Rebase in produzione utilizzando Docker, piattaforme cloud o configurazioni manuali.
---

## Cosa serve un deployment

Un progetto Rebase viene distribuito come **un unico server** (su Rebase Cloud: `https://<project>.rebase.website`). Quel server gestisce:

- **`/api/*`** — l'API dei dati, l'autenticazione, il realtime e lo storage
- **tutto il resto** — il tuo `frontend/` compilato come SPA statica

Non esiste un servizio di amministrazione separato: il pannello di amministrazione fa parte di un frontend, quindi la sua posizione dipende da cosa sia il tuo frontend e se gli assegni o meno un hostname dedicato.

| Tipo di progetto | L'URL root mostra | Il pannello di amministrazione si trova su |
|------------------|-------------------|-------------------------------------------|
| Scaffold predefinito (`rebase init`) | Il pannello di amministrazione | `/` — il frontend **è** l'admin |
| Frontend di prodotto personalizzato | La tua app | Ovunque lo monti, comunemente `/admin` — vedi [Modificare l'URL di base](#modificare-lurl-di-base) |
| Admin come app su un hostname dedicato | La tua app | `https://admin.example.com/`, servito dallo stesso server — vedi [Modificare l'URL di base](#modificare-lurl-di-base) |
| Progetto solo backend | Niente (solo API) | Non distribuito |

:::note[Prima visita]
Un nuovo deployment di **produzione** non offre una schermata di bootstrap e la prima registrazione crea un account ordinario. Definisci invece l'amministratore prima del primo avvio — vedi [Il tuo primo admin](#il-tuo-primo-admin).
:::

## Docker Compose (Consigliato)

Il progetto generato include già un file `docker-compose.yml` funzionante — **questo è il file da utilizzare per un progetto scaffoldato**, così com'è anziché scritto a mano o copiato da altrove. `rebase init` ha inserito i suoi secret, il suo primo account admin e la versione del runtime fissata, e viene avviato dal gate di accettazione del framework stesso a ogni push. Esegue **due** container: Postgres e il runtime Rebase pubblicato con il bundle compilato montato al suo interno. Non c'è alcuna immagine dell'applicazione da compilare.

La guida al [Self-Hosting](/docs/deployment/self-hosting) tratta lo stesso deployment senza uno scaffold alle spalle, utilizzando [`infra/docker/docker-compose.selfhost.yml`](https://github.com/rebasepro/rebase/blob/main/infra/docker/docker-compose.selfhost.yml) dal repository di Rebase — e le due cose che questo file tralascia deliberatamente: un connection pooler e l'esecuzione di funzioni e job worker come processi a sé stanti.

```bash
rebase build          # produces ./dist-bundle
docker compose up -d
```

Prima sempre `rebase build`: il servizio `api` monta `./dist-bundle`, e senza di esso il container si avvia a partire da una directory vuota.

La struttura del file generato:

```yaml title="docker-compose.yml (generated — abridged)"
services:
  db:
    image: pgvector/pgvector:pg18
    environment:
      POSTGRES_USER: rebase_app
      POSTGRES_PASSWORD: ${DATABASE_PASSWORD:-changeme}
      POSTGRES_DB: rebase
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U rebase_app -d rebase"]

  api:
    # The published runtime. Upgrading Rebase is a tag change, not a rebuild.
    image: rebasepro/server:${REBASE_VERSION:-latest}
    depends_on:
      db:
        condition: service_healthy
    ports:
      - "${PORT:-3001}:3001"
    environment:
      NODE_ENV: production
      DATABASE_URL: postgresql://rebase_app:${DATABASE_PASSWORD:-changeme}@db:5432/rebase
      JWT_SECRET: ${JWT_SECRET:?set JWT_SECRET in .env}
      REBASE_SERVICE_KEY: ${REBASE_SERVICE_KEY:?set REBASE_SERVICE_KEY in .env}
      CORS_ORIGINS: ${CORS_ORIGINS:?set CORS_ORIGINS in .env}
      # This service runs in production, where the first account to register is
      # not promoted to admin. So the admin is named instead.
      REBASE_ADMIN_EMAIL: ${REBASE_ADMIN_EMAIL:?set REBASE_ADMIN_EMAIL in .env}
      REBASE_ADMIN_PASSWORD: ${REBASE_ADMIN_PASSWORD:?set REBASE_ADMIN_PASSWORD in .env}
      DISABLE_SELF_REGISTRATION: ${DISABLE_SELF_REGISTRATION:-true}
    volumes:
      # Your built project, from `rebase build`. Read-only: the build vendors
      # the bundle's dependencies by default, so nothing has to write here.
      - ./dist-bundle:/bundle:ro

volumes:
  postgres_data:
```

Le tre righe `REBASE_ADMIN_*` / `DISABLE_SELF_REGISTRATION` sono nuove — nella versione 0.17.3 il primo account registrato diventa l'amministratore, anche in produzione. Vedi [Il tuo primo admin](#il-tuo-primo-admin) di seguito.

Il bundle è montato in sola lettura. `rebase build` installa le dipendenze dichiarate del progetto in `dist-bundle`, a meno che non si passi `--no-vendor`, nel qual caso il runtime le installa a ogni avvio e il mount deve essere scrivibile — rimuovi il `:ro`. Vedi [Self-hosting](/docs/deployment/self-hosting/#dependencies).

`rebase init` scrive tutte queste variabili nel tuo file `.env`, inclusa una password admin generata. Ciascuna è dichiarata con `${VAR:?…}`, in modo che l'assenza di una di esse arresti lo stack con un messaggio indicante la variabile mancante anziché avviare un sistema parzialmente configurato — e poiché Compose interpola l'intero file prima di selezionare i servizi, una variabile mancante bloccherà anche `docker compose up -d db`.

Modifica l'email dell'admin con la tua, accedi e cambia la password. Vedi [Il tuo primo admin](#il-tuo-primo-admin).

### Lo schema

Il runtime crea le tabelle mancanti all'avvio, **comprese quelle delle tue collezioni** — il valore predefinito di `REBASE_MIGRATE_ON_BOOT` è `ensure`, che opera in modo additivo sull'intero schema e applica di conseguenza la row-level security. Un primo `docker compose up` eseguito su un database vuoto si avvia servendo già le tue collezioni.

Ciò che l'avvio non fa mai è modificare elementi già esistenti: non altera il tipo di una colonna, non elimina nulla e non modifica i valori di un enum esistente, poiché il riavvio di un container non deve rimodellare uno schema come effetto collaterale di un deploy. Tali operazioni avvengono tramite la CLI, da un checkout locale o da un job di CI puntato verso il database di produzione:

```bash
pnpm run db:push
```

Eseguilo per qualsiasi modifica che non sia puramente additiva — una colonna rinominata, un tipo ristretto, un campo rimosso.

Per un **flusso di lavoro in team con versionamento**, esegui il commit dei file di migrazione con `pnpm run db:generate` ed esegui invece `pnpm run db:migrate` come passaggio di rilascio. In entrambi i casi, l'esecuzione avviene da un checkout del progetto, non all'interno del container in esecuzione — l'immagine di runtime viene fornita senza la CLI.

## Il tuo primo admin

**Imposta `REBASE_ADMIN_EMAIL` e `REBASE_ADMIN_PASSWORD` prima del primo avvio.** Tutte le guide delle piattaforme su questo sito rimandano a questo punto, poiché questo è l'unico passaggio che non consente ripristino dall'esterno.

Un database nuovo non contiene utenti e, al di fuori della produzione, i criteri di registrazione accettano la prima iscrizione promuovendola ad admin. Deve essere così: il bootstrap di un admin richiede un chiamante già autenticato, quindi un database vuoto privo di tale regola rappresenterebbe un vicolo cieco. Su un laptop la persona alla tastiera è l'operatore, ed è perfettamente corretto.

È invece del tutto sbagliato su un host con un nome pubblico. Gli artefatti rilasciati attivano DNS e TLS prima ancora che l'operatore abbia digitato qualcosa, lasciando la finestra aperta a Internet fin dal primo secondo — e chiunque raggiunga per primo il modulo di registrazione prende il controllo dell'intero deployment.

Pertanto, sotto `NODE_ENV=production` tale finestra è chiusa. Una tabella utenti vuota rifiuta la registrazione di bootstrap con `SETUP_REQUIRED`, un account creato tramite registrazione aperta è un account ordinario, `GET /api/auth/config` non segnala mai `needsSetup` e `POST /api/admin/bootstrap` restituisce un rifiuto. Nella versione 0.17.3 e precedenti la finestra era aperta anche in produzione, quindi effettua l'upgrade prima di esporre un nuovo deployment.

`rebase dev` legge lo stesso `.env` e ignora deliberatamente entrambe le variabili, notificandolo all'avvio: in locale la prima registrazione rimane la modalità di accesso iniziale. I valori scritti da `rebase init` appartengono all'avvio di produzione. Eseguire il seed da entrambe le parti consumerebbe la finestra prima ancora che lo sviluppatore abbia aperto l'applicazione, ed è ciò che portava il primo passaggio della guida rapida a produrre un account privo di ruoli.

Rimangono quindi due modalità di accesso, nessuna delle quali comporta una race condition:

```bash
REBASE_ADMIN_EMAIL=you@example.com
REBASE_ADMIN_PASSWORD=<at least 12 characters>
DISABLE_SELF_REGISTRATION=true
```

Il runtime crea quell'account una sola volta, quando la tabella utenti è vuota, e non esegue alcuna azione nei successivi avvii. In alternativa, assegna il ruolo a un utente esistente tramite la service key, se effettui il provisioning degli account out-of-band.

Due regole applicate dal runtime all'avvio, entrambe le quali producono un account inutilizzabile se errate:

- La password deve contenere **almeno 12 caratteri**, altrimenti viene rifiutata e non viene creato alcun account.
- L'indirizzo deve essere accettato da `POST /api/auth/login` — il body viene validato con `z.string().email()`, perciò un dominio privo di punto (`admin@localhost`) supera il seed iniziale ma risponde con 400 a ogni tentativo di accesso. L'avvio rifiuta anche questo tipo di indirizzo.

Imposta entrambe le variabili o nessuna: mezza credenziale è considerata un errore di battitura, e il deployment che ne risulta — auto-registrazione disattivata, nessun admin — richiede un prompt `psql` per essere ripristinato. L'avvio segnala un avviso quando la tabella è vuota in produzione e non viene specificato alcun admin.

Accedi e cambia la password: si trova in testo non crittografato ovunque tu abbia salvato il tuo ambiente.

## Checklist per la produzione

Prima di distribuire in produzione, assicurati di:

| Elemento | Dettagli |
|----------|----------|
| **Primo admin** | Imposta `REBASE_ADMIN_EMAIL` e `REBASE_ADMIN_PASSWORD` **prima del primo avvio**, insieme a `DISABLE_SELF_REGISTRATION=true`. In produzione il primo account a registrarsi non viene promosso — vedi [Il tuo primo admin](#il-tuo-primo-admin). |
| **NODE_ENV** | `NODE_ENV=production`. È ciò che chiude la finestra di bootstrap, rifiuta lo storage di file locale, richiede `CORS_ORIGINS` e disattiva la documentazione OpenAPI. Un deployment lasciato al valore predefinito viene eseguito in modalità di sviluppo. |
| **Schema del database** | L'avvio crea le tabelle delle tue collezioni e le relative RLS in modo additivo. Esegui `pnpm run db:push` (o `pnpm run db:migrate`) per qualsiasi modifica non puramente additiva. |
| **JWT_SECRET** | Utilizza una stringa casuale crittograficamente sicura (≥ 32 caratteri). Non riutilizzarla mai tra ambienti diversi. |
| **DATABASE_URL** | Utilizza un'istanza Postgres gestita (Neon, Supabase, RDS) con TLS abilitato |
| **CORS_ORIGINS** | Sempre, non solo quando il frontend si trova su un altro dominio. Il runtime si rifiuta di avviarsi in produzione se non sono impostati né `CORS_ORIGINS` né `FRONTEND_URL`, poiché un'API che tenta di indovinare le origini consentite finisce inevitabilmente per autorizzare quella sbagliata. |
| **Controllo degli accessi allo storage** | Un bucket configurato **si rifiuta di avviarsi in produzione** senza un modello di controllo degli accessi. Lo storage non è coperto da row-level security e le sue chiavi condividono un unico namespace piatto; pertanto, un'impostazione predefinita che consenta tutto permette a qualsiasi utente autenticato di elencare (`GET /storage/list?prefix=`) e poi leggere, sovrascrivere o eliminare i file di tutti gli altri utenti. Risolvi il problema con un hook `storageAuthorize` o con `storagePolicies` (lo scaffold include un hook in `config/storage.ts`), oppure dichiara esplicitamente l'intento con `STORAGE_PUBLIC_READ` per una vera e propria CDN pubblica, o `STORAGE_ALLOW_ANY_AUTHENTICATED` per un'app a singolo tenant in cui ogni account è considerato attendibile per tutti i file. |
| **Backend di storage** | In produzione `STORAGE_TYPE=local` viene **ignorato**, e i caricamenti rispondono con `501 STORAGE_NOT_CONFIGURED` — il filesystem del container viene distrutto al successivo riavvio, quindi un backend locale causa una perdita silenziosa di dati. Utilizza `s3` o `gcs`, oppure imposta `FORCE_LOCAL_STORAGE=true` se il percorso corrisponde effettivamente a un volume persistente. |
| **MFA_ENCRYPTION_KEY** | Impostala (32+ caratteri casuali) se utilizzi TOTP. Se non configurata, i segreti archiviati vengono cifrati con `JWT_SECRET` — pertanto, la rotazione di quest'ultimo disconnetterà tutti gli utenti *e* renderà indecifrabili tutti gli autenticatori registrati. |
| **HTTPS** | Termina TLS sul tuo reverse proxy (nginx, Cloudflare, bilanciatore di carico) |
| **Le letture pubbliche richiedono comunque un chiamante** | `access: "public"` amplia quali *righe* un chiamante può visualizzare, non chi ha il permesso di effettuare la chiamata: una richiesta anonima a `/api/data/*` risponde con 401 finché `AUTH_REQUIRE` è attivo. Imposta `AUTH_REQUIRE=false` per un sito pubblico che legge il proprio backend, lasciando decidere unicamente alla RLS. Essendo una variabile d'ambiente, un file `.env` locale che la definisce **non** viaggia automaticamente con il deploy. |

## Moduli nativi sul runtime gestito

Il runtime gestito di Rebase Cloud esegue il tuo bundle all'interno di un'immagine condivisa. Non dispone di un compilatore né di un modo per caricare un **modulo nativo** — ovvero qualsiasi elemento che includa un binario `.node` precompilato. Il più comune in assoluto è `sharp`, che rappresenta anche l'ovvia dipendenza per qualsiasi servizio che distribuisca immagini.

`rebase cloud deploy` rifiuta questa configurazione prima dell'upload anziché dopo:

```
This bundle depends on native modules (sharp), which the managed runtime cannot run
```

Tre possibili soluzioni, nell'ordine in cui sono generalmente più indicate:

1. **Sposta il carico di lavoro al momento della build.** Ridimensiona e ricodifica le immagini durante la fase di build e distribuisci i risultati. Nessun componente nativo verrà eseguito nel percorso della richiesta.
2. **Utilizza un servizio esterno.** Una CDN di immagini o un'API di trasformazione compiono lo stesso lavoro dietro un URL.
3. **Esegui un container dedicato.** Un deployment self-hosted (Docker, Kubernetes, o una qualsiasi delle [guide alle piattaforme](/docs/deployment/self-hosting)) si basa su una tua immagine, che può quindi contenere tutto ciò di cui hai bisogno.

Le funzioni che necessitano semplicemente di Node anziché di un binario nativo sono supportate — il deploy le segnala separatamente (`1 of 3 function(s) depend on Node`) e le esegue. La guida sul [Runtime di backend gestito](/docs/deployment/managed-runtime/) illustra tutto il resto di ciò che il runtime gestito supporta: binari, memoria, timeout, filesystem, secret, storage e rete in uscita.

## Servire il frontend

In produzione, il backend può servire il frontend come SPA statica:

```typescript
import { serveSPA } from "@rebasepro/server";
import path from "path";

// After initializeRebaseBackend()
serveSPA(app, { frontendPath: path.resolve(process.cwd(), "../frontend/dist") });
```

Compila prima il frontend:

```bash
cd frontend && pnpm build
```

In questo modo devi distribuire un solo server che gestisce sia la SPA sia l'API.

## Guide alla distribuzione sulle piattaforme

Guide dettagliate passo-passo per ciascuna piattaforma:

| Piattaforma | Tipo | Guida |
|-------------|------|-------|
| **AWS** | App Runner / ECS + RDS | [Distribuisci su AWS →](/docs/deployment/aws) |
| **Google Cloud** | Cloud Run + Cloud SQL | [Distribuisci su GCP →](/docs/deployment/gcp) |
| **Azure** | Container Apps + PostgreSQL | [Distribuisci su Azure →](/docs/deployment/azure) |
| **Hetzner Cloud** | VPS + Docker Compose | [Distribuisci su Hetzner →](/docs/deployment/hetzner) |
| **Scaleway** | Serverless Containers | [Distribuisci su Scaleway →](/docs/deployment/scaleway) |
| **Railway** | PaaS (auto-rilevamento Dockerfile) | [Distribuisci su Railway →](/docs/deployment/railway) |
| **Fly.io** | Runtime di container | [Distribuisci su Fly.io →](/docs/deployment/flyio) |

:::caution
Cloud Run e altre piattaforme serverless sono stateless. Utilizza uno **storage S3** anziché il filesystem locale per l'upload dei file e imposta `--min-instances 1` se utilizzi le funzionalità realtime di Rebase (le connessioni WebSocket vengono terminate quando le istanze scalano verso il basso).
:::


## Modificare l'URL di base

Se desideri che l'admin venga eseguito su un sotto-percorso (ad es. `/admin`), modifica il parametro `path` dell'app in `rebase.json`, e contestualmente il relativo `cms`:

```json title="rebase.json"
"admin": {
    "type": "static",
    "root": "frontend",
    "build": "npm run build --workspace frontend",
    "output": "frontend/dist",
    "path": "/admin",
    "cms": "/admin"
}
```

`cms` indica la posizione del CMS a cui Rebase Cloud punta, e deve trovarsi all'interno del `path` dell'app. Lo scaffold imposta entrambi su `/`, pertanto spostare unicamente `path` viene rifiutato — il CMS si troverebbe su `/`, all'esterno di un'app che ora inizia su `/admin`.

Per assegnare all'admin un hostname dedicato invece di un sotto-percorso, imposta `path` su un URL completo — `"path": "https://admin.example.com"` — e lascia `cms` impostato su `"/"`. L'admin risponderà quindi solo su quell'hostname e non sull'indirizzo del progetto, rimanendo irraggiungibile finché il DNS dell'hostname non viene verificato. Anche l'API rimane su `/api` su quell'hostname. Consulta [Un'app sul proprio hostname](/docs/architecture/apps-and-repositories/#an-app-on-its-own-hostname) per informazioni su come vengono associate le richieste e su cosa fa un deploy di Rebase Cloud con l'hostname.

`rebase build` passa `path` a Vite come `base` (tramite `REBASE_APP_BASE`), Vite lo restituisce come `import.meta.env.BASE_URL`, e il file `main.tsx` dello scaffold lo fornisce già al router — in questo modo gli asset, le route e il server sono tutti allineati senza dover specificare il prefisso tre volte:

```tsx title="frontend/src/main.tsx"
// At "/" this is "".
const basename = import.meta.env.BASE_URL.replace(/\/$/, "");

const router = createBrowserRouter([
    {
        path: "/*",
        element: <App/>
    }
], { basename });
```

Mantieni l'admin su un **data router** — `createBrowserRouter` con `<RouterProvider>`, come fa lo scaffold. In questo modo, un record con modifiche non salvate blocca anche la navigazione interna all'app (un link nel menu laterale, il pulsante indietro del browser) e richiede conferma tramite `useBlocker`, funzionalità offerta esclusivamente da un data router.

L'admin può anche essere eseguito sotto un normale `<BrowserRouter>`. In questo caso la protezione delle modifiche non salvate ricade sul prompt di uscita dal sito nativo del browser, che gestisce il ricaricamento, la chiusura della scheda o l'inserimento di un nuovo URL; la navigazione all'interno dell'app proseguirà invece senza richiedere conferma. Nella versione 0.24 l'admin genera un'eccezione se eseguito al di fuori di un data router.

**Backend** — se sposti anche l'API, aggiorna il suo percorso di base:

```typescript no-verify
await initializeRebaseBackend({
    // ...
    basePath: "/admin/api"
});
```

:::note[Montaggio senza `basename` del router]
L'approccio con `basename` descritto sopra è quello consigliato — react-router rimuove il prefisso dalla location, consentendo all'admin di funzionare senza modifiche. Se invece incorpori l'admin all'interno di una **route con prefisso nel path** di un'applicazione più ampia (ad es. `<Route path="/admin/*">`) senza specificare `basename`, il path corrente manterrà il prefisso `/admin`. Notificalo al CMS affinché la risoluzione URL⇄collezione tenga conto del prefisso — altrimenti le visualizzazioni rimarranno bloccate su uno spinner senza recuperare alcun dato:

```tsx
<RebaseCMS collections={collections} basePath="/admin" />
```

Imposta **o** il `basename` del router **o** `RebaseCMS basePath` — non entrambi, altrimenti il prefisso verrà applicato due volte.
:::

### App di prodotto + Admin in un unico deployment

Il motivo comune per spostare l'admin su `/admin` è il rilascio della **propria app di prodotto** nella root dello stesso deployment. Un singolo entry point Vite può gestire entrambe, separate dall'URL, in modo che ogni app venga caricata tramite lazy loading e i visitatori del prodotto non scarichino mai il bundle dell'admin:

```tsx title="frontend/src/main.tsx"
const isAdmin = window.location.pathname.startsWith("/admin");

const ProductApp = lazy(() => import("./App"));
const AdminApp = lazy(() => import("./AdminApp"));

const router = isAdmin
    // The admin lives under /admin, and `basename` is how the router is told.
    ? createBrowserRouter([{ path: "/*", element: <AdminApp/> }], { basename: "/admin" })
    : createBrowserRouter([{ path: "/*", element: <ProductApp/> }]);

root.render(<RouterProvider router={router}/>);
```

Un unico router per entrambe le parti: per l'admin è preferibile un data router, che consente alle modifiche non salvate di bloccare la navigazione in-app, e non c'è motivo per cui l'app di prodotto debba utilizzarne uno diverso.

Il backend non necessita di modifiche per questo pattern — l'API rimane su `/api` e il catch-all della SPA serve `index.html` sia per `/` sia per `/admin/*`.

## Passaggi successivi

- **[Panoramica del backend](/docs/backend)** — Configurazione completa del backend
- **[Configurazione dello storage](/docs/backend/storage)** — Configurazione S3 per la produzione
