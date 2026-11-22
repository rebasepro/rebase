---
sourceHash: e3293eb3c0e15be1
title: App e repository
sidebar_label: App & repository
description: Un progetto è un backend più le app che comunicano con esso, ciascuna delle quali può risiedere nel proprio repository.
---

## Progetti e app

Un **progetto** è il backend: il database, l'autenticazione, lo storage, il realtime e
le funzioni. Un'**app** è qualcosa che comunica con esso.

| Tipo | Cos'è |
| --- | --- |
| `backend` | Le tabelle, gli hook e le funzioni che definiscono l'API. Esattamente uno per progetto. |
| `static` | Un bundle client compilato — una SPA o un sito statico, servito su un proprio path o su un proprio hostname. |

Questo è l'elenco completo. Il pannello di amministrazione è un'app `static` come
tutte le altre: viene compilato nel tuo repository, con le tue personalizzazioni in
`frontend/src/cms`, ed è per questo che campi e viste personalizzati funzionano fin
dal primo giorno.

A chi appartiene il processo del server è una proprietà del backend, non un tipo
di app separato:

| `runtime` | Cosa significa |
| --- | --- |
| `managed` | L'immagine runtime della piattaforma esegue il tuo bundle. Tu fornisci tabelle, funzioni, cron e schema. |
| `custom` | Tu fornisci il server: il tuo Dockerfile e il tuo entrypoint. `rebase eject` configura tutto questo. |

Questo è indipendente da *dove* viene eseguito. Entrambi funzionano su Rebase Cloud ed
entrambi possono essere eseguiti in self-hosting — la destinazione risiede in
`.rebase/cloud.json`, non nel manifest.

La parte importante è chi *possiede* l'elenco. Un repository dichiara solo le app che
contiene; il progetto possiede l'insieme delle app esistenti. Due repository non hanno
mai bisogno di conoscersi a vicenda — devono solo conoscere il progetto. Questo è ciò
che rende un repository frontend separato, o un'app mobile senza alcuna relazione di
repository, una cosa ordinaria anziché un caso speciale.

## `rebase.json`

Il manifest dichiara la topologia, e nient'altro. Schema, regole di sicurezza, hook e
funzioni rimangono in TypeScript dove un sistema di tipi può verificarli.

```jsonc
{
  "rebase": "^1",
  "apps": {
    "backend": { "type": "backend", "runtime": "managed" },
    "site": {
      "type": "static",
      "root": "frontend",
      "build": "npm run build --workspace frontend",
      "output": "frontend/dist",
      "path": "/"
    },
    "admin": {
      "type": "static",
      "root": "admin",
      "build": "npm run build --workspace admin",
      "output": "admin/dist",
      "path": "/admin",
      "cms": "/admin"
    }
  }
}
```

Un unico processo serve tutto: l'API su `/api`, il sito su `/`, l'admin su
`/admin`. Questa è la formula per il self-hosting, nonché un ottimo piano base su
Rebase Cloud.

Il `path` di un'app statica assume una di due forme:

| `path` | Dove risponde l'app |
| --- | --- |
| `"/"`, `"/admin"` | A quel path, su ogni hostname su cui viene servito il progetto. |
| `"https://www.example.com"`, `"https://admin.example.com/cms"` | Solo su quell'hostname, al path successivo ad esso. Vedi [Un'app sul proprio hostname](#an-app-on-its-own-hostname). |

La forma basata su URL è il modo in cui un progetto con un sito per dominio, come un
progetto Vercel o Netlify per dominio, diventa un unico progetto Rebase: un'app statica
per hostname, tutte servite dallo stesso deploy.

## Indicare dove si trova il CMS

`cms` è il path URL in cui un'app monta `<RebaseCMS>`. È facoltativo, è l'unico campo
qui che descrive cosa c'è *all'interno* di un'app piuttosto che dove essa risiede, ed
esiste perché nessun'altra cosa può rilevarlo.

Il CMS è un componente React nel tuo stesso frontend, quindi il suo indirizzo è una
route client-side. Non è una route del server, né un file nella build, e non è
distinguibile da qualsiasi altro percorso non corrispondente in una SPA — una richiesta
a `/admin` riceve lo stesso `index.html` di una richiesta a `/anything-else`. Pertanto
nessun deploy, nessun server in esecuzione e nessuna scansione o probing può capire dove
si trovi il tuo pannello di amministrazione. Se non lo specifichi, niente potrà saperlo.

Gli strumenti che ne sono a conoscenza lo utilizzano attivamente:

- **Rebase Cloud** inserisce un link *Open CMS* nell'intestazione del progetto e mostra
  l'indirizzo nella panoramica del progetto — sull'hostname dell'app stessa, quando ne ha
  uno. Senza `cms`, la console può offrire solo l'host del progetto — che raggiunge il
  CMS solo se questo si trova casualmente alla radice dello stesso.
- **`rebase dev`** stampa l'URL del CMS nel banner di avvio quando non corrisponde
  semplicemente alla home page del frontend.
- **`rebase apps list`** lo mostra accanto all'app che lo serve.

Tre configurazioni possibili, tutte ordinarie.

```jsonc
// The whole app is the CMS — what `rebase init` scaffolds.
"admin": { "type": "static", "root": "frontend", "output": "frontend/dist", "path": "/", "cms": "/" }

// The CMS is one route of a bigger app, sharing its session and its client.
"web": { "type": "static", "root": "frontend", "output": "frontend/dist", "path": "/", "cms": "/admin" }

// The CMS is an app of its own, on a hostname of its own — see the next section.
"admin": { "type": "static", "root": "admin", "output": "admin/dist", "path": "https://admin.example.com", "cms": "/" }
```

Il valore è il path che digiteresti dopo l'hostname, non un path relativo a `path`, e
deve trovarsi all'interno dell'app che lo dichiara — il fallback SPA di quell'app è ciò
che risponde lì. È sempre un path, anche quando il `path` dell'app è un URL: in quel caso
il CMS si trova a quel path sull'hostname dell'app, quindi `"cms": "/"` sopra significa
`https://admin.example.com/`. Un progetto ha un solo CMS; dichiararne un secondo genera
un errore anziché affidare a una monetina la scelta di quale linkare nella console.

`path` è un input sia di **build-time** che di erogazione (serving). Un'app montata su
`/admin` deve essere *compilata* per `/admin`, altrimenti `index.html` si carica e ogni
asset restituisce un 404 — una pagina bianca senza alcun errore visibile. `rebase build`
passa il valore come `REBASE_APP_BASE`, che il tuo bundler legge come base path:

```ts
// vite.config.ts
export default defineConfig({
  base: process.env.REBASE_APP_BASE ?? "/",
  // …
});
```

e rifiuta di distribuire una build che lo ha ignorato.

Un progetto esistente non ne ha necessariamente bisogno. La CLI deduce la stessa struttura
dalla gerarchia delle directory, e `rebase apps init` la scrive esplicitamente quando lo
desideri:

```bash
rebase apps list      # what this repository contributes
rebase apps init      # write an inferred rebase.json
```

L'inferenza non può conoscere due cose che il `rebase.json` di uno scaffold dichiara.
Chiama l'app statica `web`, mentre uno scaffold la chiama `admin`, e non può sapere quale
sia la route `cms` dell'app. Il nome non cambia: Rebase Cloud registrava `web` per ogni
progetto distribuito senza un `rebase.json`. `rebase apps init --force` mantiene i nomi,
`path`, `cms`, `routes`, `frameAncestors`, <span class="since-badge" data-since="0.35">Since 0.35</span> `redirects` e `cleanUrls` delle app dichiarate nel file che sostituisce,
e contrassegna come rimossa un'app che non trova più.

## An app on its own hostname

`path` può anche essere un URL `https://` completo, che assegna all'app un proprio
hostname:

```jsonc
{
  "rebase": "^1",
  "apps": {
    "backend": { "type": "backend", "runtime": "managed" },
    "web": {
      "type": "static",
      "root": "frontend",
      "build": "npm run build --workspace frontend",
      "output": "frontend/dist",
      "path": "/"
    },
    "admin": {
      "type": "static",
      "root": "admin",
      "build": "npm run build --workspace admin",
      "output": "admin/dist",
      "path": "https://admin.example.com",
      "cms": "/"
    }
  }
}
```

`https://admin.example.com` serve `admin`. Ogni altro hostname su cui il progetto
risponde — `example.com`, o l'indirizzo stesso del progetto su Rebase Cloud — serve
`web`, e `admin` non è affatto raggiungibile lì. Rimane pur sempre un unico processo e
un unico deploy; l'hostname determina unicamente quale app risponde a una richiesta.

A stabilirlo sono due regole:

- Un'app con un hostname risponde solo su quell'hostname. Un'app senza hostname risponde
  su tutti gli hostname.
- Tra le app rimanenti, vince quella con il path più lungo, come è sempre stato. A parità
  di path, l'app che specifica l'hostname ha la precedenza su quella che non lo fa.

Nell'esempio entrambe le app si trovano su `/`, quindi su `admin.example.com` la seconda
regola seleziona `admin`. Se invece dichiari l'admin su `"https://admin.example.com/cms"`,
essa risponderà solo sotto `/cms` su quell'hostname: `admin.example.com/pricing` andrà a
`web`. Un hostname restringe l'ambito in cui un'app risponde; non assegna all'app tutto
ciò che risiede su quell'hostname. Non possono esistere due app che condividano sia
l'hostname che il path.

Il backend non è un'app, e un hostname non ne modifica la posizione. `/api`, `/health`
e gli altri path riservati dal backend ricevono risposta prima che venga consultata
qualsiasi app, su ogni hostname, per cui `https://admin.example.com/api` è la medesima
API di `https://example.com/api`. Un'app che chiama la propria origin — il valore vuoto
di `VITE_API_URL` dello scaffold — non ha bisogno di un proprio URL API né di configurazioni
CORS. Per la stessa ragione, tali percorsi vengono rifiutati dopo un hostname esattamente
come verrebbero rifiutati da soli: `https://admin.example.com/api` non è valido, esattamente
come non lo è `/api`.

Tutto il resto relativo a `path` si applica alla parte successiva all'hostname. L'app
viene comunque compilata per quel path: `https://admin.example.com` viene compilata con
`REBASE_APP_BASE` impostato su `/`, `https://admin.example.com/cms` con `/cms/`, e un
bundler che ignora questo valore produrrà comunque una pagina vuota. `cms` è un path
sull'hostname dell'app, all'interno di quella parte di percorso. L'URL deve essere
`https://` e contenere un hostname e un path e nient'altro — nessuna porta, query o
frammento. Un valore semplice come `admin.example.com` viene rifiutato, indicando come
avrebbe dovuto essere formattato l'URL.

Con `rebase dev`, nulla viene instradato in base all'hostname. Esegue l'app in
`frontend/` alla radice di una porta su localhost, come ha sempre fatto, e per un'app
con un hostname il banner stampa anche l'indirizzo `https://` che avrà una volta
distribuita.

`rebase start` è diverso, perché esegue il bundle compilato tramite lo stesso runtime
utilizzato da una distribuzione — routing per hostname incluso. Un'app dotata di
hostname risponde solo alle richieste il cui header `Host` corrisponde a tale hostname;
pertanto `http://localhost:3001/` mostrerà l'app priva di hostname, e un bundle la cui
unica app specifica un hostname risponderà con un 404 a quell'indirizzo. Per raggiungerla
localmente, invia tu stesso l'header:

```bash
curl -H "Host: admin.example.com" http://localhost:3001/
```

oppure fai puntare l'hostname a `127.0.0.1` in `/etc/hosts` e apri
`http://admin.example.com:3001/`. Non esiste deliberatamente alcun parametro di query o
header per sovrascrivere il routing: uno che funzionasse localmente funzionerebbe anche
in produzione su un deployment, e scegliere l'app tramite qualcosa di diverso dal vero
header `Host` è proprio ciò che il routing si prefigge di evitare.

In ambiente self-hosted, il processo opera la medesima scelta a partire dall'header
`Host` di ciascuna richiesta. Far puntare l'hostname al server e fornirgli un certificato
spetta a te, esattamente come per l'hostname principale del progetto, e un reverse proxy
a monte deve inoltrare l'header `Host` originale — Caddy lo fa di default, nginx richiede
`proxy_set_header Host $host;`. `X-Forwarded-Host` non viene letto, poiché qualunque client
potrebbe inviarne uno.

### Su Rebase Cloud

`rebase cloud deploy` registra l'hostname sul progetto — la stessa operazione eseguita
da `rebase cloud domains add` — quindi non c'è alcun passaggio separato che si possa
dimenticare. Ciò che accade dopo dipende dal DNS:

- **I record esistono già.** Il deploy verifica l'hostname, che diventa attivo al termine
  del deploy stesso.
- **Non esistono.** Il deploy procede e stampa i due record da creare: un record TXT che
  dimostra la proprietà del nome e un CNAME che lo fa puntare al progetto (un record A,
  se l'hostname è l'apex del dominio).

Una volta pubblicati i record:

```bash
rebase cloud domains verify admin.example.com
```

`rebase cloud domains list` stampa nuovamente i record se li perdi. Un hostname che non
viene verificato entro 7 giorni dalla registrazione viene rilasciato, e il deploy successivo
lo registrerà di nuovo. Quando la verifica va a buon fine, la piattaforma emette il
certificato HTTPS per l'hostname; non c'è nulla da caricare. Fino ad allora `admin` non
risponderà da nessuna parte, poiché l'unico hostname su cui risponde non raggiunge ancora
il progetto — il resto del progetto è comunque regolarmente attivo.

La console segue l'app sul suo hostname: il link *Open CMS* e l'indirizzo del CMS nella
panoramica del progetto diventano `https://admin.example.com/`, non l'host del progetto.

Un hostname già verificato da un altro progetto fa fallire il deploy prima che venga
avviato qualsiasi rilascio, e lo stesso vale per uno appartenente al dominio stesso della
piattaforma. Uno che un altro progetto ha registrato ma non ha mai verificato non
costituisce un ostacolo: il rifiuto ti fornisce un record TXT per il tuo progetto e, una
volta creato, il deploy successivo (o `rebase cloud domains add`) acquisirà l'hostname.
L'aggiunta di un hostname non ancora presente nel progetto modifica i domini del progetto,
cosa che un token di accesso creato con `--can deploy` non è autorizzato a fare: dalla CI,
aggiungi l'hostname una sola volta con `rebase cloud domains add` mentre sei autenticato,
dopodiché il token potrà distribuirlo come qualsiasi altro hostname già presente nel
progetto. La rimozione dell'app da `rebase.json` lascia l'hostname registrato nel
progetto; rimuovilo con `rebase cloud domains remove admin.example.com`.

### Un hostname appartiene a un'app, non a una route

Un hostname viene assegnato a un'intera app. Non può puntare a una route al suo interno.
Quando il CMS è una route di una singola SPA — `web` su `/` con `"cms": "/admin"` — esso
risiede su `/admin`, su ciascun hostname su cui risponde il progetto. Assegnare a quell'app
`https://admin.example.com` sposterebbe l'intera SPA su quell'indirizzo, con il CMS sempre
situato sotto `/admin`. Per dare al CMS un hostname dedicato, trasformalo in un'app a sé
stante, con una propria build, come nell'esempio sopra.

## Servire una funzione su un path di un'app

Una funzione personalizzata risponde su `/api/functions/<name>`, e un'app statica non può
rivendicare `/api`. Un sito editoriale necessita di alcuni percorsi che nessuna build può
contenere — una sitemap e un feed che elencano gli ultimi articoli, una pagina renderizzata
a partire dal database. `routes` serve la risposta di una funzione su un path all'indirizzo
dell'app stessa:

```jsonc
"site": {
  "type": "static",
  "root": "site",
  "output": "site/dist",
  "path": "https://www.example.com",
  "routes": [
    { "path": "/sitemap.xml", "function": "sitemap" },
    { "path": "/feed.xml", "function": "feed" },
    { "path": "/blog/*", "function": "blog" }
  ]
}
```

`https://www.example.com/sitemap.xml` corrisponde quindi a qualsiasi cosa restituisca
`functions/sitemap.ts`, con il proprio `Content-Type`, status code e header. Tutto il
resto sull'hostname corrisponde alla build del sito, come in precedenza.

- **Esatto o wildcard.** `/sitemap.xml` corrisponde solo a quel path. `/blog/*` corrisponde
  a `/blog` e a ogni percorso sottostante, passando il resto alla funzione: `/blog/hello`
  raggiunge la route `/:slug` della funzione con `slug` impostato su `hello`, e `/blog`
  raggiunge la sua route `/`.
- **La funzione riceve una normale chiamata.** La richiesta le perviene esattamente come
  se fosse stata inviata a `/api/functions/<name>`, attraversando la stessa autenticazione,
  controlli di scope, rate limit e timeout. Il metodo, gli header, il body e la query
  string vengono inoltrati, così come `Host`, per cui `new URL(c.req.url).origin`
  rappresenta l'origin del sito — su cui si basano gli URL assoluti di una sitemap. La
  funzione continua inoltre a rispondere anche su `/api/functions/<name>`.
- **Vince la route più specifica**: un path esatto prima di qualsiasi wildcard, e una
  wildcard più lunga prima di una più corta. Una route ha inoltre la precedenza su un file
  con lo stesso path nella build, evitando così che un file obsoleto `public/sitemap.xml`
  possa nasconderla.
- **Solo dove risponde l'app.** Una route si applica alle richieste a cui risponderebbe
  l'app stessa — sul suo hostname, se ne ha uno, e non sotto il path di un'altra app.
  `rebase.json` viene rifiutato se una route si trova dove risponde un'altra app.
- **All'interno dell'app, e mai in quelle del backend.** Il path di una route è assoluto,
  interno al `path` dell'app, e non può trovarsi sotto `/api`, `/health`, `/healthz`,
  `/livez`, `/readyz` o `/metrics`, né avere un segmento che inizi con `.`. Una wildcard
  non può coprire l'intera app, poiché ciò lascerebbe la sua build non servita.

Le route sono servite dal processo backend in cui l'app è incorporata, poiché è lì che
vengono eseguite le funzioni: `rebase build` e `rebase cloud deploy` incorporano ogni app
statica nel bundle del backend, e la build fallisce se una route indica una funzione che
il backend non possiede. Un'app statica distribuita da sola non ha funzioni da chiamare,
pertanto `rebase cloud deploy` ne rifiuta una contenente route, e il runtime rifiuta di
avviare un bundle puramente statico che le dichiara.

Una risposta instradata che non invia un header `Content-Security-Policy` eredita quello
dell'app, così che le origin specificate nel suo [`frameAncestors`](/docs/deployment/self-hosting/#letting-another-origin-frame-an-app)
possano incorporare una pagina renderizzata lato server proprio come possono farlo con
il resto del sito.

Durante `rebase dev`, l'app viene servita dal proprio dev server, che non conosce tali
route; in questo contesto, chiama la funzione su `/api/functions/<name>`, oppure testa le
route a fronte di una build con `rebase start`.

## Redirect e clean URL

<span class="since-badge" data-since="0.35">Since 0.35</span>

Un'app statica accetta `redirects` (`{ "from": "/blog/:slug", "to": "/posts/:slug" }`,
anche verso un altro dominio) e `cleanUrls: true` (`/x` serve `x.html`). Consulta
[Redirect e clean URL](/docs/architecture/redirects-and-clean-urls/), che mostra anche
la mappatura da un `vercel.json` a `rebase.json`.

## Build e deploy delle app

```bash
rebase build              # every app in this repository
rebase build backend      # just the bundle
rebase build admin        # just that app's static assets
```

Il backend viene compilato per primo, poiché la build di un'app client potrebbe consumare
un SDK generato dalle sue tabelle.

## Repository multipli

Il monorepo rimane l'impostazione predefinita: un repository con un backend e un pannello
di amministrazione è la soluzione più semplice e funzionante, ed è ciò che `rebase init`
predispone. La suddivisione è uno step evolutivo successivo, non un requisito obbligatorio.

In un repository frontend separato hai bisogno di due cose: un manifest che dichiari
cosa fornisce questo repository e un collegamento al progetto:

```jsonc
// rebase.json
{
  "rebase": "^1",
  "apps": {
    "marketing": {
      "type": "static",
      "root": ".",
      "build": "npm run build",
      "output": "dist"
    }
  }
}
```

```bash
rebase cloud link https://api.example.com   # a self-hosted project
rebase cloud link                           # or pick a Rebase Cloud project
```

Il collegamento viene scritto in `.rebase/cloud.json` e **non viene committato** — è
specifico per checkout locale, come un remote git. Il manifest viene committato; il link no.

## Client tipizzati senza le tabelle

Questo è il meccanismo che rende possibile il multi-repo. Un repository che non contiene
tabelle genera il proprio SDK tipizzato direttamente dal progetto:

```bash
rebase generate-sdk --from link
rebase generate-sdk --from https://api.example.com --token $REBASE_SERVICE_KEY
```

La CLI recupera `/api/meta/contract` e ne legge le `tables` — i descrittori compilati,
inclusi i target delle relazioni, di cui il generatore di tipi ha bisogno per decidere
se una foreign key sia una stringa o un numero — producendo esattamente lo stesso output
che avrebbe generato dal sorgente locale.

L'endpoint del contract richiede lo scope `schema:read`, di cui dispone un admin. Descrive
ogni tabella, colonna e relazione nel progetto, comprese quelle che nessuna regola di
sicurezza esporrebbe mai; si tratta di una mappa del database, non di documentazione API
pubblica.

## Rilevamento del drift

Separare i repository comporta un prezzo degno di nota: una modifica allo schema e il
frontend che la utilizza non finiscono più nello stesso commit. Il backend potrebbe
rilasciare una modifica lasciando bloccato un client compilato in base alla struttura
precedente.

Ogni SDK generato registra lo schema da cui proviene:

```ts
// generated/sdk/schema.meta.ts — generated
export const SCHEMA_VERSION = "v1:c5d97d0f96b7f87a";
```

E ogni progetto pubblica la propria versione corrente, senza autenticazione, poiché un
identificativo di versione non rivela nulla sullo schema che rappresenta:

```bash
curl -s https://api.example.com/api/meta/schema-version
# {"schemaVersion":"v1:c5d97d0f96b7f87a","runtime":{"version":"0.34.2","contract":1}}
```

Il confronto tra i due nella CI trasforma una discrepanza silenziosa in un controllo
fallito. L'identificativo cambia solo quando i tipi generati potrebbero cambiare — una
nuova proprietà, una relazione modificata — e deliberatamente *non* quando cambia un hook,
una regola di sicurezza o un'icona, evitando così falsi allarmi.

## Configurazione del client

```bash
rebase apps config web
```

Stampa quanto necessario a un client per raggiungere il progetto. Non stampa mai dati
segreti: l'URL dell'API e l'identità pubblicabile di un'app sono destinati a essere
inclusi nel bundle client, e tutto ciò che non è sicuro non appartiene a un output
destinato a finire in un file `.env` committato.

## Correlati

- [Runtime & Bundle](/docs/architecture/runtime-and-bundles/) — cosa produce `rebase build` e cosa lo avvia
- [Processi separati](/docs/deployment/split-processes/) — eseguire un singolo bundle come più processi
- [Comandi della CLI](/docs/cli/) — `rebase apps` e il resto
