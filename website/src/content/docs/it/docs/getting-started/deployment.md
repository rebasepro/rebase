---
sourceHash: 0d34ea230c0dfdc6
title: Deployment
sidebar_label: Deployment
description: Distribuisci il tuo progetto Rebase in produzione utilizzando Docker, piattaforme cloud o configurazioni manuali.
---

## Cosa viene servito da un deployment

Un progetto Rebase viene distribuito come **un unico server** (su Rebase Cloud: `https://<project>.rebase.website`). Quel server gestisce:

- **`/api/*`** — l'API dei dati, l'autenticazione, il realtime e lo storage
- **tutto il resto** — il tuo `frontend/` compilato come SPA statica

Non esiste un servizio di amministrazione separato: il pannello di amministrazione fa parte di un frontend, quindi la sua posizione dipende da cosa è il tuo frontend e se gli assegni o meno un proprio hostname.

| Tipo di progetto | L'URL radice mostra | Il pannello di amministrazione si trova su |
|------------------|---------------------|--------------------------------------------|
| Scaffold predefinito (`rebase init`) | Il pannello di amministrazione | `/` — il frontend **è** l'admin |
| Frontend del prodotto personalizzato | La tua app | Ovunque lo monti, solitamente `/admin` — vedi [Modifica dell'URL di base](#modifica-dellurl-di-base) |
| Admin come app su un proprio hostname | La tua app | `https://admin.example.com/`, servito dallo stesso server — vedi [Modifica dell'URL di base](#modifica-dellurl-di-base) |
| Progetto solo backend | Niente (solo API) | Non distribuito |

:::note[Prima visita]
Un nuovo deployment di **produzione** non offre una schermata di bootstrap e la sua prima registrazione corrisponde a un account ordinario. Specifica invece l'amministratore prima del primo avvio — vedi [Il tuo primo admin](#il-tuo-primo-admin).
:::

## Docker Compose (Consigliato)

Il progetto generato include già un file `docker-compose.yml` funzionante — **questo è il file da usare per un progetto scaffoldato**, così com'è anziché scritto a mano o copiato altrove. `rebase init` ha inserito i suoi secret, il primo account admin e la versione del runtime bloccata (pinned), e viene avviato dall'acceptance gate del framework a ogni push. Esegue **due** container: Postgres e il runtime Rebase pubblicato, con il bundle compilato montato al suo interno. Non c'è alcuna immagine applicativa da compilare.

La guida [Self-Hosting](/docs/deployment/self-hosting) descrive lo stesso deployment senza uno scaffold di base, utilizzando [`infra/docker/docker-compose.selfhost.yml`](https://github.com/rebasepro/rebase/blob/main/infra/docker/docker-compose.selfhost.yml) dal repository di Rebase — e le due cose che questo file tralascia deliberatamente: un connection pooler e l'esecuzione di funzioni e job worker come processi separati.

```bash
rebase build          # produces ./dist-bundle
docker compose up -d
```

Esegui sempre prima `rebase build`: il servizio `api` monta `./dist-bundle`, e senza di esso il container si avvia puntando a una directory vuota.

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

Le tre righe `REBASE_ADMIN_*` / `DISABLE_SELF_REGISTRATION` sono nuove: nella versione 0.17.3 il primo account a registrarsi diventa l'amministratore, anche in produzione. Consulta [Il tuo primo admin](#il-tuo-primo-admin) più sotto.

Il bundle è montato in sola lettura. `rebase build` installa le dipendenze dichiarate del progetto all'interno di `dist-bundle` a meno che non si passi `--no-vendor`, nel qual caso il runtime le installa a ogni avvio e il punto di mount deve essere scrivibile — rimuovi il `:ro`. Consulta [Self-hosting](/docs/deployment/self-hosting/#dependencies).

`rebase init` scrive tutte queste variabili in `.env` per te, inclusa una password di admin generata. Ciascuna è dichiarata con `${VAR:?…}`, quindi una variabile mancante arresta lo stack con un messaggio che ne indica il nome anziché avviare un ambiente configurato a metà — e Compose interpola l'intero file prima di selezionare i servizi, quindi una variabile mancante blocca anche `docker compose up -d db`.

Modifica l'email dell'amministratore con la tua, effettua il login e cambia la password. Consulta [Il tuo primo admin](#il-tuo-primo-admin).

### Lo schema

Il runtime crea le tabelle mancanti all'avvio, **incluse quelle delle tue collection** — `REBASE_MIGRATE_ON_BOOT` è impostato di default su `ensure`, che è incrementale su tutto lo schema e applica contestualmente la row-level security. Un primo `docker compose up` su un database vuoto si avvia servendo già le tue collection.

Ciò che l'avvio non fa mai è modificare elementi già esistenti: non altera il tipo di una colonna, non elimina nulla e non modifica i valori di un enum esistente, poiché il riavvio di un container non deve rimodellare lo schema come effetto collaterale di un deploy. Queste modifiche passano attraverso la CLI, da un checkout locale o da un job di CI puntato al database di produzione:

```bash
pnpm run db:push
```

Eseguilo per qualsiasi modifica che non sia puramente incrementale: una colonna rinominata, un tipo reso più restrittivo, un campo rimosso.

Per un **flusso di lavoro di team con versionamento**, esegui invece il commit dei file di migrazione con `pnpm run db:generate` ed esegui `pnpm run db:migrate` come passaggio di rilascio. In entrambi i casi viene eseguito da un checkout del progetto, non all'interno del container in esecuzione — l'immagine di runtime viene distribuita senza la CLI.

## Il tuo primo admin

**Imposta `REBASE_ADMIN_EMAIL` e `REBASE_ADMIN_PASSWORD` prima del primo avvio.** Tutte le guide alle piattaforme su questo sito rimandano a questa sezione, poiché questo è l'unico passaggio per cui non è possibile un ripristino dall'esterno.

Un database nuovo non contiene utenti e, al di fuori della produzione, i criteri di registrazione accettano la prima registrazione promuovendola ad admin. Deve essere così: il bootstrap di un amministratore richiede un chiamante già autenticato, quindi un database vuoto senza una regola del genere rappresenterebbe un vicolo cieco. Su un portatile la persona alla tastiera è l'operatore, ed è esattamente ciò che ci si aspetta.

È invece del tutto sbagliato su un host con un nome pubblico. Gli artifact distribuiti rendono operativi DNS e TLS prima che l'operatore abbia digitato qualsiasi cosa, lasciando la finestra aperta a internet fin dal primo secondo — e chiunque raggiunga per primo il form di registrazione assume il controllo del deployment.

Pertanto, sotto `NODE_ENV=production`, questa finestra è chiusa. Una tabella utenti vuota rifiuta la registrazione di bootstrap con `SETUP_REQUIRED`, un account creato tramite registrazione aperta è un account ordinario, `GET /api/auth/config` non restituisce mai `needsSetup` e `POST /api/admin/bootstrap` rifiuta la richiesta. Nella versione 0.17.3 e precedenti la finestra era aperta anche in produzione, quindi esegui l'aggiornamento prima di esporre un nuovo deployment.

`rebase dev` legge lo stesso `.env` e ignora deliberatamente entrambe le variabili, segnalandolo all'avvio: in locale la prima registrazione rimane la modalità di accesso iniziale. I valori scritti da `rebase init` appartengono all'avvio in produzione. Eseguire il seed su entrambi i lati consumerebbe la finestra prima ancora che lo sviluppatore abbia aperto l'app, il che causava la creazione di un account privo di ruoli al primo passaggio della guida rapida.

Questo lascia due modalità di accesso, nessuna delle quali è soggetta a race condition:

```bash
REBASE_ADMIN_EMAIL=you@example.com
REBASE_ADMIN_PASSWORD=<at least 12 characters>
DISABLE_SELF_REGISTRATION=true
```

Il runtime crea tale account una sola volta, quando la tabella utenti è vuota, e non fa nulla a ogni avvio successivo. In alternativa, puoi assegnare il ruolo a un utente esistente tramite la service key, se effettui il provisioning degli account out-of-band.

Due regole applicate dal runtime all'avvio, che generano entrambe un account inutilizzabile se errate:

- La password deve essere di **almeno 12 caratteri**, altrimenti viene rifiutata e non viene creato alcun account.
- L'indirizzo deve essere accettato da `POST /api/auth/login`: il parsing del body avviene tramite `z.string().email()`, quindi un dominio privo di punto (`admin@localhost`) viene inserito correttamente nel seed ma risponde con un 400 a ogni accesso. L'avvio rifiuta anche questo tipo di indirizzo.

Imposta entrambe le variabili o nessuna delle due: mezza credenziale è considerata un refuso e il deployment che ne risulta — registrazione autonoma disattivata, nessun admin — richiede un prompt `psql` per essere ripristinato. L'avvio avvisa quando la tabella è vuota in produzione e non è stato specificato alcun amministratore.

Accedi e modifica la password. Attualmente si trova in testo non crittografato ovunque tu abbia salvato il tuo ambiente.

## Checklist per la produzione

Prima di effettuare il deployment in produzione, verifica quanto segue:

| Voce | Dettagli |
|------|----------|
| **Primo admin** | Imposta `REBASE_ADMIN_EMAIL` e `REBASE_ADMIN_PASSWORD` **prima del primo avvio**, insieme a `DISABLE_SELF_REGISTRATION=true`. In produzione il primo account registrato non viene promosso — vedi [Il tuo primo admin](#il-tuo-primo-admin). |
| **NODE_ENV** | `NODE_ENV=production`. È ciò che chiude la finestra di bootstrap, rifiuta lo storage su file locale, richiede `CORS_ORIGINS` e disattiva la documentazione OpenAPI. Un deployment lasciato al valore predefinito viene eseguito in modalità di sviluppo. |
| **Schema del database** | L'avvio crea le tabelle delle collection e la relativa RLS in modo incrementale. Esegui `pnpm run db:push` (o `pnpm run db:migrate`) per qualsiasi modifica che non sia puramente incrementale. |
| **JWT_SECRET** | Usa una stringa casuale crittograficamente sicura (≥ 32 caratteri). Non riutilizzarla mai tra ambienti diversi. |
| **DATABASE_URL** | Usa un'istanza Postgres gestita (Neon, Supabase, RDS) con TLS abilitato |
| **CORS_ORIGINS** | Sempre, non solo quando il frontend si trova su un altro dominio. Il runtime rifiuta di avviarsi in produzione se non sono specificati né `CORS_ORIGINS` né `FRONTEND_URL`, poiché un'API che tenta di indovinare le origini consentite finirà per autorizzare quella sbagliata. |
| **Controllo degli accessi allo storage** | Un bucket configurato **rifiuta l'avvio in produzione** senza un modello di controllo degli accessi. Lo storage non è gestito dalla row-level security e le sue chiavi condividono un unico namespace piatto; pertanto un'impostazione predefinita permissiva consentirebbe a qualsiasi utente autenticato di elencare (`GET /storage/list?prefix=`) e quindi leggere, sovrascrivere o eliminare i file di tutti gli altri utenti. Risolvi questo requisito con un hook `storageAuthorize` o con `storagePolicies` (lo scaffold include un hook in `config/storage.ts`), oppure specifica l'intento tramite `STORAGE_PUBLIC_READ` per un vero e proprio CDN pubblico, o `STORAGE_ALLOW_ANY_AUTHENTICATED` per un'applicazione single-tenant in cui ogni account è considerato attendibile per tutti i file. |
| **Backend di storage** | In produzione `STORAGE_TYPE=local` viene **ignorato** e i caricamenti rispondono con `501 STORAGE_NOT_CONFIGURED` — il filesystem del container viene distrutto al riavvio successivo, quindi un backend locale causa una perdita silenziosa di dati. Usa `s3` o `gcs`, oppure imposta `FORCE_LOCAL_STORAGE=true` se il percorso corrisponde effettivamente a un volume persistente. |
| **MFA_ENCRYPTION_KEY** | Impostala (32+ caratteri casuali) se utilizzi TOTP. Se non impostata, i secret archiviati vengono crittografati con `JWT_SECRET` — di conseguenza, la sua rotazione disconnette tutti gli utenti *e* rende indecifrabili tutti gli autenticatori registrati. |
| **HTTPS** | Termina TLS a livello di reverse proxy (nginx, Cloudflare, load balancer) |
| **Le letture pubbliche richiedono comunque un chiamante** | `access: "public"` estende le *righe* visibili al chiamante, non chi è autorizzato a chiamare: una richiesta anonima a `/api/data/*` risponde 401 quando `AUTH_REQUIRE` è attivo. Imposta `AUTH_REQUIRE=false` per un sito pubblico che legge il proprio backend, lasciando che sia solo la RLS a decidere. Essendo una variabile d'ambiente, un file `.env` locale che la imposta **non** viene trasferito con il deployment. |

## Moduli nativi sul runtime gestito

Il runtime gestito di Rebase Cloud esegue il tuo bundle all'interno di un'immagine condivisa. Non dispone di un compilatore né del supporto per caricare un **modulo nativo** — qualsiasi pacchetto che distribuisca un binario precompilato `.node`. Il più comune in assoluto è `sharp`, che è anche la dipendenza naturale per qualunque servizio che gestisca immagini.

`rebase cloud deploy` rifiuta questa operazione prima del caricamento anziché dopo:

```
This bundle depends on native modules (sharp), which the managed runtime cannot run
```

Tre possibili soluzioni, nell'ordine in cui risultano solitamente preferibili:

1. **Sposta il carico di lavoro al momento della compilazione.** Ridimensiona e ricodifica le immagini durante la fase di build e distribuisci i risultati. In questo modo nessun codice nativo viene eseguito nel percorso della richiesta.
2. **Usa un servizio dedicato.** Un CDN per immagini o un'API di trasformazione svolgono lo stesso compito dietro a un URL.
3. **Esegui un container personalizzato.** Un deployment self-hosted (Docker, Kubernetes, una qualsiasi delle [guide alle piattaforme](/docs/deployment/self-hosting)) utilizza la tua immagine, che può quindi includere qualsiasi componente necessario.

Le funzioni che necessitano semplicemente di Node anziché di un binario nativo funzionano senza problemi — il deploy le segnala separatamente (`1 of 3 function(s) depend on Node`) e le esegue. La guida [Managed backend runtime](/docs/deployment/managed-runtime/) illustra il resto di ciò che il runtime gestito consente: binari, memoria, timeout, filesystem, secret, storage e rete in uscita.

## Servire il frontend

In produzione, il backend può servire il frontend come una SPA statica:

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

In questo modo è sufficiente distribuire un unico server che gestisce sia la SPA sia l'API.

## Guide al deployment sulle piattaforme

Guide dettagliate passo dopo passo per ogni piattaforma:

| Piattaforma | Tipo | Guida |
|-------------|------|-------|
| **AWS** | App Runner / ECS + RDS | [Deploy su AWS →](/docs/deployment/aws) |
| **Google Cloud** | Cloud Run + Cloud SQL | [Deploy su GCP →](/docs/deployment/gcp) |
| **Azure** | Container Apps + PostgreSQL | [Deploy su Azure →](/docs/deployment/azure) |
| **Hetzner Cloud** | VPS + Docker Compose | [Deploy su Hetzner →](/docs/deployment/hetzner) |
| **Scaleway** | Serverless Containers | [Deploy su Scaleway →](/docs/deployment/scaleway) |
| **Railway** | PaaS (auto-detect Dockerfile) | [Deploy su Railway →](/docs/deployment/railway) |
| **Fly.io** | Container runtime | [Deploy su Fly.io →](/docs/deployment/flyio) |
| **InstaPods** | Node + PostgreSQL in one pod, no Docker | [Deploy su InstaPods →](/docs/deployment/instapods) |
| **Hostman** | App Platform + Managed PostgreSQL, or a VPS | [Deploy su Hostman →](/docs/deployment/hostman) |

:::caution
Cloud Run e altre piattaforme serverless sono stateless. Usa lo **storage S3** anziché il filesystem locale per il caricamento dei file e imposta `--min-instances 1` se utilizzi le funzionalità realtime di Rebase (le connessioni WebSocket vengono interrotte quando le istanze scalano a zero o si riducono).
:::


## Modifica dell'URL di base

Se desideri che l'admin sia eseguito su un sotto-percorso (ad es. `/admin`), modifica il parametro `path` dell'app in `rebase.json`, e di conseguenza anche il suo `cms`:

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

`cms` indica la posizione del CMS a cui Rebase Cloud si collega e deve trovarsi all'interno del `path` dell'applicazione. Lo scaffold imposta entrambi su `/`, quindi lo spostamento del solo `path` viene rifiutato: il CMS si troverebbe su `/`, all'esterno di un'app che ora inizia su `/admin`.

Per assegnare all'admin un proprio hostname anziché un sotto-percorso, imposta `path` su un URL completo — `"path": "https://admin.example.com"` — e lascia `cms` impostato su `"/"`. L'admin risponderà quindi solo su quell'hostname e non sull'indirizzo del progetto, risultando quindi irraggiungibile finché il DNS dell'hostname non viene verificato. Anche l'API rimane su `/api` su tale hostname. Consulta [Un'app su un proprio hostname](/docs/architecture/apps-and-repositories/#an-app-on-its-own-hostname) per informazioni su come vengono associate le richieste e su come un deploy su Rebase Cloud gestisce l'hostname.

`rebase build` passa `path` a Vite come `base` (tramite `REBASE_APP_BASE`), Vite lo restituisce come `import.meta.env.BASE_URL` e il file `main.tsx` dello scaffold lo passa già al router — in questo modo asset, route e server sono allineati senza dover specificare il prefisso tre volte:

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

L'admin funziona anche con un semplice `<BrowserRouter>`. In questo caso, il controllo delle modifiche non salvate ricade sul prompt nativo del browser di abbandono della pagina, che copre il ricaricamento, la chiusura della scheda o l'inserimento di un URL; la navigazione all'interno dell'app procede invece senza conferme. Dalla versione 0.24 l'admin genera un errore se eseguito all'esterno di un data router.

**Backend** — se sposti anche l'API, aggiorna il suo percorso di base:

```typescript no-verify
await initializeRebaseBackend({
    // ...
    basePath: "/admin/api"
});
```

:::note[Montaggio senza un `basename` del router]
L'approccio basato su `basename` descritto sopra è quello consigliato: react-router rimuove il prefisso dal percorso, consentendo all'admin di funzionare senza modifiche. Se invece incorpori l'admin all'interno di una **route con prefisso di percorso** in un'applicazione più ampia (ad es. `<Route path="/admin/*">`) senza specificare un `basename`, il percorso corrente mantiene il prefisso `/admin`. Segnalalo al CMS in modo che la risoluzione URL⇄collection tenga conto del prefisso — altrimenti le viste rimarranno bloccate su uno spinner senza recuperare alcun dato:

```tsx
<RebaseCMS collections={collections} basePath="/admin" />
```

Imposta **il `basename` del router** oppure **il `basePath` di `RebaseCMS`** — non entrambi, altrimenti il prefisso verrebbe applicato due volte.
:::

### App di prodotto + Admin in un unico deployment

Il motivo comune per spostare l'admin su `/admin` è rilasciare la **propria app di prodotto** alla radice dello stesso deployment. Un singolo entry point Vite può gestire entrambe, suddivise per URL, consentendo il lazy loading di ciascuna app ed evitando che gli utenti del prodotto scarichino il bundle dell'admin:

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

Un solo router per entrambe le metà: per l'admin è preferibile utilizzare un data router, che consente alle modifiche non salvate di intercettare la navigazione in-app, e non vi è alcun motivo per cui l'app di prodotto debba utilizzarne uno diverso.

Il backend non richiede modifiche per questo pattern: l'API rimane su `/api` e la route catch-all della SPA serve `index.html` sia per `/` sia per `/admin/*`.

## Passaggi successivi

- **[Panoramica del backend](/docs/backend)** — Configurazione completa del backend
- **[Configurazione dello storage](/docs/backend/storage)** — Configurazione di S3 per la produzione
