---
sourceHash: 61fe21675b54e7a5
title: Runtime e Bundle
sidebar_label: Runtime & Bundle
description: Come un progetto Rebase si divide in un bundle di progetto e un runtime con controllo di versione, e perché tale separazione rende possibili aggiornamenti, app multi-repo e hosting gestito.
---

## Le due metà di un deployment

Un deployment Rebase è costituito da due elementi, non uno:

- **Il bundle** — il tuo progetto. Collezioni, hook, funzioni e cron job compilati, oltre a un manifest generato che descrive ciò di cui hanno bisogno.
- **Il runtime** — il motore. `@rebasepro/server`, distribuito come immagine container `rebasepro/server` pubblicata.

Vengono creati, versionati e distribuiti separatamente. È da questa singola decisione che discende tutto il resto in questa pagina: poiché il motore non è incorporato nell'immagine dell'applicazione, può essere sostituito sotto il tuo progetto — per una correzione di sicurezza, un miglioramento delle prestazioni o una nuova funzionalità — senza dover ricompilare nulla di ciò che hai scritto.

```
  your repository                 built artifact              running container
  ───────────────                 ──────────────              ─────────────────
  config/collections/*.ts   ──►   dist-bundle/config/     ──►  rebasepro/server
  backend/functions/*.ts          dist-bundle/backend/         + /bundle mounted
  rebase.json                     dist-bundle/manifest.json
```

Il runtime che ospiti autonomamente (self-host) è lo stesso runtime eseguito da Rebase Cloud. Non esiste una build separata per la "piattaforma", e nessuna funzionalità del piano gestito è preclusa a chi esegue `docker compose up`.

## Creazione di un bundle

```bash
rebase build
```

Questo comando rigenera lo schema del database a partire dalle tue collezioni, ne esegue il type-checking e la compilazione, risolve gli import specifier in modo che Node possa caricare direttamente l'output e scrive `dist-bundle/` contenente:

| Percorso | Descrizione |
| --- | --- |
| `manifest.json` | Generato. Il contratto che questo bundle dichiara di soddisfare. |
| `package.json` | Generato. Le dipendenze runtime del tuo progetto. |
| `config/` | Collezioni compilate. |
| `backend/functions/` | Funzioni server compilate. |
| `backend/crons/` | Cron job compilati. |
| `backend/src/schema.generated.js` | Schema del database compilato. |

È importante comprendere il manifest, poiché è ciò che un runtime valida prima di acconsentire all'avvio:

```jsonc
{
  "bundleFormat": 2,
  "runtime": { "range": "^1", "builtAgainst": "0.22.0", "contract": 1 },
  "schemaVersion": "v1:c5d97d0f96b7f87a",
  "kind": "backend",
  "entry": {
    "config": "config",
    "functions": "backend/functions",
    "static": [{ "path": "/", "dir": "static/admin", "spa": true }]
  },
  "hooks": { "native": false },
  "deps": { "declared": { "zod": "^4.4.3" } }
}
```

`kind` può essere `backend` — avvia il server, oltre a eventuali app statiche in `entry.static` — oppure `static`, che serve tali asset e nient'altro: niente database, niente autenticazione. Il fatto che un backend dichiari le proprie collezioni nel codice o ne esegua l'introspezione dal database attivo non costituisce un terzo tipo; dipende semplicemente dalla presenza o meno di `entry.config`.

## Esecuzione di un bundle

```bash
rebase start                       # locally
docker run -v ./dist-bundle:/bundle rebasepro/server   # anywhere
```

`rebase start` carica il bundle in-process, così che segnali e stack trace ti raggiungano direttamente. In locale, collega le dipendenze già installate al bundle in modo da evitare una seconda installazione; un deployment installa invece il `package.json` del bundle stesso.

## Compatibilità

Due numeri di versione determinano se un bundle e un runtime possono funzionare insieme, e deliberatamente non coincidono con la versione del pacchetto.

**`bundleFormat`** rappresenta il layout su disco. Un runtime accetta qualsiasi bundle il cui formato sia inferiore o uguale al proprio, e ne rifiuta uno più recente anziché caricarlo parzialmente. Un bundle precedente su un runtime più recente deve continuare a funzionare — è proprio questo lo scopo della separazione, quindi un runtime supporta la lettura di ogni formato mai distribuito. I bundle in Formato 1, che chiamavano questo campo `mode` e contenevano una singola directory statica, si avviano ancora inalterati.

**`runtime.contract`** è l'interfaccia tra un bundle e il motore. All'interno della stessa major version del contratto, qualsiasi bundle validato continua a essere valido. Patch e minor version sono retrocompatibili e intercambiabili (drop-in); una major non lo è, e un runtime rifiuterà un bundle appartenente a una versione diversa anziché avviarsi e comportarsi in modo anomalo successivamente.

Ecco perché aggiornare Rebase in un deployment self-hosted richiede solo la modifica di un tag:

```yaml
image: rebasepro/server:0.22.0   # a newer tag — your bundle is untouched
```

## Lo sviluppo utilizza lo stesso percorso

`rebase dev` avvia lo stesso runtime direttamente sul tuo codice sorgente TypeScript invece che su un bundle compilato. L'hot reload continua a funzionare, e l'ambiente di sviluppo rispecchia la produzione poiché entrambi condividono lo stesso percorso di avvio anziché affidarsi a due implementazioni che potrebbero divergere.

Un progetto che necessita di funzionalità non previste dal runtime standard può comunque scrivere il proprio `backend/src/index.ts` e importare il server come libreria. `rebase dev` lo rileva e lo esegue. Consulta [Custom server](/docs/backend/custom-server/) — perderai il runtime standard, ma non la superficie dell'API.

## Cosa legge il runtime dall'ambiente

Il runtime è configurato interamente tramite variabili d'ambiente, poiché è lo standard supportato da qualsiasi target di deployment.

| Variabile | Significato |
| --- | --- |
| `DATABASE_URL` | Stringa di connessione per il database predefinito. Obbligatoria. |
| `JWT_SECRET` | Segreto per la firma, di almeno 32 caratteri. Obbligatorio in produzione. |
| `CORS_ORIGINS` | Origini separate da virgola autorizzate a chiamare l'API. Obbligatorio in produzione. |
| `PORT` | Porta a cui collegarsi. Predefinito `3001` in locale, `8080` nell'immagine. |
| `REBASE_SERVICE_KEY` | Chiave server-to-server che concede l'accesso di amministratore. |
| `REBASE_METRICS` | `true` per esporre le metriche Prometheus su `/metrics`. |
| `REBASE_MIGRATE_ON_BOOT` | `none` non modifica lo schema; qualsiasi altro valore — incluso non impostato — esegue il passaggio di provisioning additivo. Il valore predefinito è `ensure` ovunque, inclusa la produzione. |
| `REBASE_SERVE_STATIC` | Serve gli asset statici del bundle da questo processo. Abilitato per impostazione predefinita. |

È possibile configurare più database e più bucket aggiungendo come suffisso alla variabile la chiave sorgente — consulta [Multiple databases and buckets](/docs/backend/multiple-sources/).

## Endpoint sempre serviti dal runtime

| Percorso | Scopo |
| --- | --- |
| `GET /health` | Readiness. Esegue un round-trip verso il database. |
| `GET /livez` | Liveness. Intenzionalmente *non* interagisce con il database, in modo che un glitch momentaneo del database non spinga l'orchestratore a terminare un processo integro. |
| `GET /api/meta/schema-version` | La versione corrente dello schema. Non autenticato — si tratta di un marcatore di versione, non di uno schema. |
| `GET /api/meta/contract` | Il contratto completo delle collezioni. Solo per admin. |
| `GET /metrics` | Metriche Prometheus, quando `REBASE_METRICS=true`. |
