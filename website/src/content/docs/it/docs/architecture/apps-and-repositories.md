---
sourceHash: 2b5f4b5b83a711a3
title: App e repository
sidebar_label: App & repository
description: Un progetto è un backend insieme alle app che comunicano con esso, ognuna delle quali può risiedere nel proprio repository.
---

## Progetti e app

Un **progetto** è il backend: database, autenticazione, storage, realtime e
funzioni. Un'**app** è qualsiasi cosa comunichi con esso.

| Tipo | Descrizione |
| --- | --- |
| `backend` | Le collection, gli hook e le funzioni che definiscono l'API. Esattamente uno per progetto. |
| `static` | Un bundle client compilato: una SPA o un sito statico, servito sul proprio percorso, o su un hostname tutto suo. |

Questo è l'elenco completo. Il pannello di amministrazione è un'app `static` come
qualsiasi altra: viene compilato nel tuo repository, in base alle tue collection,
ed è per questo che i campi personalizzati e le viste personalizzate funzionano fin
dal primo giorno.

Chi gestisce il processo del server è una proprietà del backend, non un tipo di app
separato:

| `runtime` | Cosa significa |
| --- | --- |
| `managed` | L'immagine runtime della piattaforma esegue il tuo bundle. Tu fornisci collection, funzioni, cron e schema. |
| `custom` | Fornisci tu il server: il tuo Dockerfile e l'entrypoint. `rebase eject` si occupa di configurarlo. |

Questo è indipendente da *dove* viene eseguito. Entrambi possono essere eseguiti su
Rebase Cloud ed entrambi possono essere ospitati in self-hosting: la destinazione
risiede in `.rebase/cloud.json`, non nel manifest.

La parte importante è chi *possiede* l'elenco. Un repository dichiara solo le app
che contiene; il progetto possiede l'insieme delle app esistenti. Due repository non
hanno mai bisogno di conoscersi a vicenda: devono solo conoscere il progetto. Questo
è ciò che rende un repository frontend separato, o un'app mobile senza alcuna
relazione di repository, una situazione ordinaria piuttosto che un caso speciale.

## `rebase.json`

Il manifest dichiara la topologia e nient'altro. Schema, regole di sicurezza, hook
e funzioni rimangono in TypeScript, dove un sistema di tipi può verificarli.

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
`/admin`. Questa è la modalità self-hosting, nonché un ottimo tier base su
Rebase Cloud.

## Indicare dove si trova il CMS

`cms` è il percorso URL in cui un'app monta `<RebaseCMS>`. È opzionale, è
l'unico campo qui che descrive cosa c'è *all'interno* di un'app anziché dove risiede
l'app, ed esiste perché nessun altro elemento può scoprirlo.

Il CMS è un componente React all'interno del tuo frontend, quindi il suo indirizzo
è una route lato client. Non è una route del server, non è un file nella build e
non è distinguibile da qualsiasi altro percorso non corrispondente in una SPA: una
richiesta a `/admin` riceve lo stesso `index.html` di una richiesta a `/anything-else`.
Pertanto, nessun deploy, nessun server in esecuzione e nessuna scansione possono
determinare dove si trova il tuo pannello di amministrazione. Se non lo specifichi,
nessun sistema può saperlo.

I sistemi che ne sono a conoscenza lo utilizzano in questo modo:

- **Rebase Cloud** inserisce un link *Open CMS* nell'intestazione del progetto ed
  elenca l'indirizzo nella panoramica del progetto, sull'hostname dell'app quando
  ne ha uno. Senza `cms`, la console può
  offrire solo l'host del progetto, che raggiunge il CMS solo se questo si trova per
  caso alla radice.
- **`rebase dev`** stampa l'URL del CMS nel banner di avvio quando questo non coincide
  semplicemente con la home page del frontend.
- **`rebase apps list`** lo mostra accanto all'app che lo serve.

Tre forme possibili, tutte comuni:

```jsonc
// The whole app is the CMS — what `rebase init` scaffolds.
"admin": { "type": "static", "root": "frontend", "output": "frontend/dist", "path": "/", "cms": "/" }

// The CMS is one route of a bigger app, sharing its session and its client.
"web": { "type": "static", "root": "frontend", "output": "frontend/dist", "path": "/", "cms": "/admin" }

// The CMS is an app of its own, on a hostname of its own — see the next section.
"admin": { "type": "static", "root": "admin", "output": "admin/dist", "path": "https://admin.example.com", "cms": "/" }
```

Il valore è il percorso che digiteresti dopo l'hostname, non un percorso relativo
a `path`, e deve trovarsi all'interno dell'app che lo dichiara: è il fallback SPA
di quell'app a rispondere lì. È sempre un percorso, anche quando il `path`
dell'app è un URL: il CMS si trova allora a quel percorso sull'hostname dell'app,
quindi `"cms": "/"` qui sopra significa `https://admin.example.com/`. Un progetto
ha un solo CMS; dichiararne un secondo è un errore,
piuttosto che tirare a indovinare a quale dei due punterà la console.

`path` è un parametro utile sia in fase di **build** che di serving. Un'app montata su
`/admin` deve essere *compilata* per `/admin`, altrimenti `index.html` viene caricato
ma tutti gli asset restituiscono un errore 404, lasciando una pagina vuota senza alcun
errore apparente. `rebase build` passa questo valore come `REBASE_APP_BASE`, che il tuo
bundler legge come base path:

```ts
// vite.config.ts
export default defineConfig({
  base: process.env.REBASE_APP_BASE ?? "/",
  // …
});
```

e rifiuta di distribuire una build che lo ha ignorato.

Un progetto esistente non ne ha bisogno. La CLI deduce la stessa struttura a partire
da quella delle directory, e `rebase apps init` la rende esplicita su richiesta:

```bash
rebase apps list      # what this repository contributes
rebase apps init      # write an inferred rebase.json
```

## Un'app su un hostname tutto suo

`path` può anche essere un URL `https://` completo, che dà all'app un hostname
tutto suo:

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

`https://admin.example.com` serve `admin`. Ogni altro hostname su cui risponde
il progetto — `example.com`, o l'indirizzo del progetto su Rebase Cloud — serve
`web`, e lì `admin` non è raggiungibile affatto. Resta un unico processo e un
unico deploy; l'hostname decide solo quale app risponde a una richiesta.

Lo decidono due regole:

- Un'app con un hostname risponde solo su quell'hostname. Un'app senza risponde
  su tutti.
- Tra le app rimaste vince quella con il percorso più lungo, come sempre. A
  parità di percorso, l'app che nomina l'hostname vince su quella che non lo fa.

Nell'esempio entrambe le app sono su `/`, quindi su `admin.example.com` la
seconda regola sceglie `admin`. Dichiara invece l'admin su
`"https://admin.example.com/cms"` e risponderà solo sotto `/cms` su
quell'hostname: `admin.example.com/pricing` va a `web`. Un hostname restringe
dove un'app risponde; non le consegna tutto ciò che sta su quell'hostname. Due
app non possono avere in comune sia l'hostname sia il percorso.

Il backend non è un'app, e un hostname non lo sposta. `/api`, `/health` e gli
altri percorsi riservati al backend ricevono risposta prima che venga
consultata qualsiasi app, su ogni hostname, quindi
`https://admin.example.com/api` è la stessa API di `https://example.com/api`.
Un'app che chiama la propria origine — il `VITE_API_URL` vuoto dello scaffold —
non ha bisogno di un URL dell'API tutto suo né di alcuna impostazione CORS. Per
lo stesso motivo quei percorsi vengono rifiutati dopo un hostname esattamente
come da soli: `https://admin.example.com/api` non è più valido di `/api`.

Tutto il resto di `path` si applica alla parte dopo l'hostname. L'app viene
comunque compilata per quella parte: `https://admin.example.com` viene compilato
con `REBASE_APP_BASE` impostato a `/`, `https://admin.example.com/cms` con
`/cms`, e un bundler che lo ignora produce comunque una pagina vuota. `cms` è un
percorso sull'hostname dell'app, all'interno di quella parte di percorso. L'URL
deve essere `https://` e contenere un hostname e un percorso e nient'altro:
niente porta, query o frammento. Un `admin.example.com` scritto da solo viene
rifiutato, indicando l'URL che avrebbe dovuto essere.

In locale, niente viene instradato per hostname. `rebase dev` esegue l'app in
`frontend/` alla radice di una porta di localhost, come ha sempre fatto, e per
un'app con un hostname il suo banner stampa anche l'indirizzo `https://` che
avrà una volta distribuita.

In self-hosting, il processo fa la stessa scelta a partire dall'header `Host`
di ogni richiesta. Puntare l'hostname al server e dargli un certificato spetta a
te, come per l'hostname principale del progetto, e un reverse proxy davanti deve
inoltrare l'`Host` originale: Caddy lo fa di default, nginx ha bisogno di
`proxy_set_header Host $host;`. `X-Forwarded-Host` non viene letto, perché
qualsiasi client può inviarne uno.

### Su Rebase Cloud

`rebase cloud deploy` registra l'hostname sul progetto — quello che fa
`rebase cloud domains add` — quindi non c'è un passaggio separato da
dimenticare. Cosa succede dopo dipende dal DNS:

- **I record esistono già.** Il deploy verifica l'hostname, che è attivo al
  termine del deploy.
- **Non esistono.** Il deploy va avanti e stampa i due record da creare: un
  record TXT che dimostra che il nome è tuo e un CNAME che lo punta al progetto
  (un record A, se l'hostname è l'apex del dominio).

Una volta pubblicati i record:

```bash
rebase cloud domains verify admin.example.com
```

`rebase cloud domains list` stampa di nuovo i record se li perdi. Quando la
verifica passa, la piattaforma emette il certificato HTTPS per l'hostname; non
c'è niente da caricare. Fino ad allora `admin` non risponde da nessuna parte,
perché l'unico hostname su cui risponde non raggiunge ancora il progetto; il
resto del progetto è attivo in ogni caso.

La console segue l'app sul suo hostname: il link *Open CMS* e l'indirizzo del
CMS nella panoramica del progetto sono `https://admin.example.com/`, non l'host
del progetto.

Un hostname già detenuto da un altro progetto fa fallire il deploy prima che
venga distribuito qualsiasi cosa, e lo stesso vale per uno sotto il dominio
della piattaforma. Togliere l'app da `rebase.json` lascia l'hostname registrato
sul progetto; rimuovilo con `rebase cloud domains remove admin.example.com`.

### Un hostname appartiene a un'app, non a una route

Un hostname viene dato a un'intera app. Non può puntare a una route al suo
interno. Quando il CMS è una route di un'unica SPA — `web` su `/` con
`"cms": "/admin"` — si trova su `/admin`, su ogni hostname a cui risponde il
progetto. Dare a quell'app `https://admin.example.com` sposterebbe lì l'intera
SPA, con il CMS ancora su `/admin` al suo interno. Per dare al CMS un hostname
tutto suo, rendilo un'app a sé, con la propria build, come nell'esempio sopra.

## Compilazione e deploy delle app

```bash
rebase build              # every app in this repository
rebase build backend      # just the bundle
rebase build admin        # just that app's static assets
```

Il backend viene compilato per primo, poiché la build di un'app client potrebbe
utilizzare un SDK generato a partire dalle sue collection.

## Repository multipli

Il monorepo rimane l'impostazione predefinita: un repository con un backend e un
pannello di amministrazione è la soluzione più semplice e funzionante, ed è ciò
che `rebase init` genera. Suddividere in più repository è un passaggio successivo,
non un obbligo.

In un repository frontend separato sono necessarie due cose: un manifest che dichiara
il contributo di questo repository e un collegamento al progetto:

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

Il collegamento viene scritto in `.rebase/cloud.json` e **non viene committato**:
è specifico per ogni checkout locale, proprio come un remote git. Il manifest viene
tracciato con commit, il collegamento no.

## Client tipizzati senza le collection

Questo è il meccanismo che rende possibile il funzionamento multi-repo. Un repository
che non contiene collection genera il proprio SDK tipizzato direttamente dal progetto:

```bash
rebase generate-sdk --from link
rebase generate-sdk --from https://api.example.com --token $REBASE_SERVICE_KEY
```

La CLI recupera `/api/meta/contract`, ricostruisce le definizioni delle collection —
inclusi i target delle relazioni, di cui il generatore di tipi ha bisogno per stabilire
se una foreign key è una stringa o un numero — ed emette esattamente lo stesso output
che avrebbe prodotto a partire dai sorgenti locali.

L'endpoint del contratto richiede lo scope `schema:read`, che un amministratore possiede. Le definizioni delle
collection descrivono ogni tabella, colonna e relazione nel progetto, comprese quelle
che nessuna regola di sicurezza esporrebbe mai; si tratta di una mappa del database,
non di una documentazione pubblica dell'API.

## Rilevamento del drift

Separare i repository comporta un unico svantaggio degno di nota: una modifica dello
schema e il frontend che la utilizza non si trovano più nello stesso commit. Il backend
potrebbe rilasciare una modifica lasciando bloccato un client compilato sulla vecchia
struttura.

Ogni SDK generato memorizza lo schema da cui proviene:

```ts
// src/rebase/schema.meta.ts — generated
export const SCHEMA_VERSION = "v1:c5d97d0f96b7f87a";
```

E ogni progetto pubblica la propria versione attuale, senza autenticazione, poiché
un identificatore di versione non rivela nulla sullo schema che rappresenta:

```bash
curl -s https://api.example.com/api/meta/schema-version
# {"schemaVersion":"v1:c5d97d0f96b7f87a"}
```

Confrontare i due valori in CI trasforma una mancata corrispondenza silenziosa in un
controllo fallito. Il valore di versione cambia solo quando i tipi generati potrebbero
subire variazioni — una nuova proprietà, una relazione modificata — e deliberatamente
*non* quando cambia un hook, una regola di sicurezza o un'icona, evitando così falsi
allarmi.

## Configurazione del client

```bash
rebase apps config web
```

Stampa le informazioni necessarie a un client per raggiungere il progetto. Non stampa
mai segreti: l'URL dell'API e l'identità pubblicabile di un'app sono destinati a essere
inclusi nel bundle del client, e tutto ciò che non è sicuro includere lì non appartiene
a un output che finirà in un file `.env` tracciato con commit.

## Contenuti correlati

- [Runtime & Bundles](/docs/architecture/runtime-and-bundles/) — cosa produce `rebase build` e cosa lo avvia
- [Split Processes](/docs/deployment/split-processes/) — eseguire un singolo bundle come processi multipli
- [CLI Commands](/docs/cli/) — `rebase apps` e il resto
