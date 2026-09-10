---
sourceHash: f90b94eda083f704
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
| `static` | Un bundle client compilato: una SPA o un sito statico, servito sul proprio percorso. |

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
  elenca l'indirizzo nella panoramica del progetto. Senza `cms`, la console può
  offrire solo l'host del progetto, che raggiunge il CMS solo se questo si trova per
  caso alla radice.
- **`rebase dev`** stampa l'URL del CMS nel banner di avvio quando questo non coincide
  semplicemente con la home page del frontend.
- **`rebase apps list`** lo mostra accanto all'app che lo serve.

Due forme possibili, ed entrambe comuni:

```jsonc
// The whole app is the CMS — what `rebase init` scaffolds.
"admin": { "type": "static", "root": "frontend", "output": "frontend/dist", "path": "/", "cms": "/" }

// The CMS is one route of a bigger app, sharing its session and its client.
"web": { "type": "static", "root": "frontend", "output": "frontend/dist", "path": "/", "cms": "/admin" }
```

Il valore è l'indirizzo che digiteresti, non un percorso relativo a `path`, e deve
trovarsi all'interno dell'app che lo dichiara: è il fallback SPA di quell'app a
rispondere lì. Un progetto ha un solo CMS; dichiararne un secondo è un errore,
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

L'endpoint del contratto è accessibile solo agli amministratori. Le definizioni delle
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

---
