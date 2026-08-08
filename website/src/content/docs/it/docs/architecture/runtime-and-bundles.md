---
title: Runtime e Bundle
sidebar_label: Runtime & Bundle
description: Come un progetto Rebase si separa in un bundle di progetto e un runtime con versione, e perché questa separazione è ciò che rende possibili gli aggiornamenti, le app multi-repo e l'hosting gestito.
---

## Le due metà di un deployment

Un deployment di Rebase è composto da due cose, non una:

- **Il bundle** — il tuo progetto. Collection compilate, hook, funzioni e cron job,
  più un manifesto generato che descrive ciò di cui hanno bisogno.
- **Il runtime** — il motore. `@rebasepro/server`, distribuito come immagine container
  pubblicata `rebasepro/server`.

Vengono creati, versionati e distribuiti separatamente. È da questa singola decisione
che deriva tutto il resto in questa pagina: poiché il motore non è incorporato
nell'immagine della tua applicazione, può essere sostituito sotto al tuo progetto — per
una correzione di sicurezza, un miglioramento delle prestazioni o una nuova funzionalità —
senza dover ricompilare nulla di ciò che hai scritto.

```
  your repository                 built artifact              running container
  ───────────────                 ──────────────              ─────────────────
  config/collections/*.ts   ──►   dist-bundle/config/     ──►  rebasepro/server
  backend/functions/*.ts          dist-bundle/backend/         + /bundle mounted
  rebase.json                     dist-bundle/manifest.json
```

Il runtime su cui fai self-hosting è lo stesso runtime eseguito da Rebase Cloud.
Non esiste una build di "piattaforma" separata, e nulla del piano gestito è
precluso a chi esegue `docker compose up`.

## Creazione di un bundle

```bash
rebase build
```

Questo rigenera lo schema del database a partire dalle tue collection, ne esegue
la verifica dei tipi e la compilazione, risolve gli identificatori di importazione
in modo che Node possa caricare direttamente l'output e scrive `dist-bundle/` contenente:

| Percorso | Che cos'è |
| --- | --- |
| `manifest.json` | Generato. Il contratto che questo bundle dichiara di soddisfare. |
| `package.json` | Generato. Le dipendenze di runtime del tuo progetto. |
| `config/` | Collection compilate. |
| `backend/functions/` | Funzioni server compilate. |
| `backend/crons/` | Cron job compilati. |
| `backend/src/schema.generated.js` | Schema del database compilato. |

Vale la pena comprendere il manifesto, poiché è ciò che un runtime convalida prima
di acconsentire all'avvio:

```jsonc
{
  "bundleFormat": 2,
  "runtime": { "range": "^1", "builtAgainst": "0.13.0", "contract": 1 },
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

`kind` è `backend` — avvia il server, più eventuali app statiche in
`entry.static` — oppure `static`, che serve tali asset e niente altro: no
database, no autenticazione. Il fatto che un backend dichiari le sue collection
nel codice o ne esegua l'introspezione dal database in esecuzione non costituisce
un terzo tipo; riguarda semplicemente la presenza o meno di `entry.config`.

## Esecuzione di un bundle

```bash
rebase start                       # locally
docker run -v ./dist-bundle:/bundle rebasepro/server   # anywhere
```

`rebase start` carica il bundle nello stesso processo, in modo che i segnali e gli
stack trace ti raggiungano direttamente. In locale collega le dipendenze già installate
all'interno del bundle, evitando così una seconda installazione; un deployment
installa invece il `package.json` proprio del bundle.

## Compatibilità

Due numeri di versione regolano la possibilità per un bundle e un runtime di
funzionare insieme, e deliberatamente non coincidono con la versione del pacchetto.

**`bundleFormat`** è il layout su disco. Un runtime accetta qualsiasi bundle il cui
formato sia inferiore o uguale al proprio e rifiuta un formato più recente piuttosto
che caricarlo parzialmente. Un bundle più vecchio su un runtime più recente deve
continuare a funzionare — è proprio questo il punto fondamentale della separazione, per
cui un runtime legge qualsiasi formato abbia mai rilasciato. I bundle in Formato 1,
che chiamavano questo campo `mode` e contenevano una singola directory statica,
continuano ad avviarsi senza modifiche.

**`runtime.contract`** è l'interfaccia tra un bundle e il motore. All'interno di una
stessa versione major del contratto, qualsiasi bundle convalidato continuerà a essere
valido. Le patch e le release minor sono intercambiabili (drop-in); una major non lo è,
e un runtime rifiuterà un bundle basato su una major differente anziché avviarsi e
comportarsi in modo anomalo successivamente.

Ecco perché aggiornare Rebase in un deployment self-hosted richiede semplicemente
di modificare un tag:

```yaml
image: rebasepro/server:0.13.0   # era 0.12.0 — il tuo bundle rimane intatto
```

## Lo sviluppo utilizza lo stesso percorso

`rebase dev` avvia lo stesso runtime sul tuo codice sorgente TypeScript anziché su un
bundle compilato. L'hot reload continua a funzionare e l'ambiente di sviluppo
rispecchia fedelmente la produzione poiché entrambi condividono un unico percorso
di avvio invece di due implementazioni che potrebbero divergere.

Un progetto che necessita di funzionalità non presenti nel runtime predefinito può
comunque scrivere il proprio `backend/src/index.ts` e importare il server come
libreria. `rebase dev` lo rileva e lo esegue. Consulta [Custom server](/docs/backend/custom-server/) —
perderai il runtime predefinito, ma non le API disponibili.

## Cosa legge il runtime dall'ambiente

Il runtime è configurato interamente tramite variabili d'ambiente, in quanto rappresentano
lo standard condiviso da qualsiasi destinazione di deployment.

| Variabile | Significato |
| --- | --- |
| `DATABASE_URL` | Stringa di connessione per il database predefinito. Obbligatoria. |
| `JWT_SECRET` | Segreto di firma, di almeno 32 caratteri. Obbligatorio in produzione. |
| `CORS_ORIGINS` | Origini separate da virgola autorizzate a chiamare l'API. Obbligatorio in produzione. |
| `PORT` | Porta a cui effettuare il bind. Predefinita `3001` in locale, `8080` nell'immagine. |
| `REBASE_SERVICE_KEY` | Chiave server-to-server che garantisce l'accesso amministrativo. |
| `REBASE_METRICS` | `true` per esporre le metriche Prometheus su `/metrics`. |
| `REBASE_MIGRATE_ON_BOOT` | `none`, `ensure` o `push`. Il valore predefinito è `none` in produzione. |
| `REBASE_SERVE_STATIC` | Serve gli asset statici del bundle da questo processo. Attivo di default. |

È possibile configurare più database e più bucket aggiungendo un suffisso alla
variabile con la chiave della fonte — consulta [Database e bucket
multipli](/docs/backend/multiple-sources/).

## Endpoint che il runtime offre sempre

| Percorso | Scopo |
| --- | --- |
| `GET /health` | Readiness. Esegue un round-trip verso il database. |
| `GET /livez` | Liveness. Intenzionalmente *non* interagisce con il database, in modo che un'interruzione momentanea del database non spinga l'orchestratore a terminare un processo sano. |
| `GET /api/meta/schema-version` | La versione corrente dello schema. Non autenticato — si tratta di un'etichetta di versione, non dello schema. |
| `GET /api/meta/contract` | Il contratto completo delle collection. Riservato agli amministratori. |
| `GET /metrics` | Metriche Prometheus, quando `REBASE_METRICS=true`. |
