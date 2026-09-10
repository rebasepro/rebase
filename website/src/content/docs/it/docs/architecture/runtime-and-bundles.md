---
sourceHash: 236f1a01516e7d29
title: Runtime e Bundle
sidebar_label: Runtime & Bundle
description: Come un progetto Rebase si suddivide in un bundle di progetto e un runtime con versionamento, e perché questa separazione rende possibili aggiornamenti, app multi-repo e hosting gestito.
---

## Le due metà di un deployment

Un deployment di Rebase è composto da due elementi, non uno:

- **Il bundle** — il tuo progetto. Collection compilate, hook, funzioni e cron
  job, oltre a un manifest generato che descrive ciò di cui hanno bisogno.
- **Il runtime** — l'engine. `@rebasepro/server`, distribuito come immagine
  container `rebasepro/server` pubblicata.

Vengono creati, versionati e distribuiti separatamente. È da questa singola
decisione che discende tutto il resto in questa pagina: poiché l'engine non è
incorporato nell'immagine della tua applicazione, può essere sostituito sotto al
tuo progetto — per una correzione di sicurezza, un miglioramento delle prestazioni
o una nuova funzionalità — senza dover ricompilare nulla di ciò che hai scritto.

```
  your repository                 built artifact              running container
  ───────────────                 ──────────────              ─────────────────
  config/collections/*.ts   ──►   dist-bundle/config/     ──►  rebasepro/server
  backend/functions/*.ts          dist-bundle/backend/         + /bundle mounted
  rebase.json                     dist-bundle/manifest.json
```

Il runtime che esegui in self-hosting è lo stesso runtime eseguito da Rebase Cloud.
Non esiste una build di "piattaforma" separata e nulla del tier gestito è
precluso a chi esegue `docker compose up`.

## Creare un bundle

```bash
rebase build
```

Questo comando rigenera lo schema del database a partire dalle tue collection, ne
esegue il type-checking e la compilazione, risolve gli specificatori di importazione
in modo che Node possa caricare direttamente l'output e scrive `dist-bundle/`
contenente:

| Path | Cos'è |
| --- | --- |
| `manifest.json` | Generato. Il contratto che questo bundle dichiara di soddisfare. |
| `package.json` | Generato. Le dipendenze runtime del tuo progetto. |
| `config/` | Collection compilate. |
| `backend/functions/` | Funzioni server compilate. |
| `backend/crons/` | Cron job compilati. |
| `backend/src/schema.generated.js` | Schema del database compilato. |

Vale la pena comprendere il manifest, poiché è ciò che un runtime convalida prima
di acconsentire all'avvio:

```jsonc
{
  "bundleFormat": 2,
  "runtime": { "range": "^1", "builtAgainst": "0.20.0", "contract": 1 },
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

`kind` è `backend` — avvia il server, oltre a qualsiasi app statica in
`entry.static` — oppure `static`, che serve tali asset e nient'altro: nessun
database, nessuna autenticazione. Il fatto che un backend dichiari le sue
collection nel codice o ne esegua l'introspezione dal database attivo non
costituisce un terzo tipo; dipende semplicemente dalla presenza o meno di
`entry.config`.

## Eseguire un bundle

```bash
rebase start                       # locally
docker run -v ./dist-bundle:/bundle rebasepro/server   # anywhere
```

`rebase start` carica il bundle nello stesso processo, consentendo a segnali e
stack trace di raggiungerti direttamente. In locale, collega le dipendenze già
installate all'interno del bundle evitando una seconda installazione; un
deployment, invece, installa il `package.json` del bundle stesso.

## Compatibilità

Due numeri di versione determinano se un bundle e un runtime possono funzionare
insieme, e non corrispondono intenzionalmente alla versione del pacchetto.

**`bundleFormat`** rappresenta il layout su disco. Un runtime accetta qualsiasi
bundle il cui formato sia inferiore o uguale al proprio, e rifiuta un formato più
recente anziché caricarlo solo parzialmente. Un bundle precedente eseguito su un
runtime più recente deve continuare a funzionare — questo è il principio
fondamentale della separazione, motivo per cui un runtime legge qualsiasi formato
mai rilasciato. I bundle con formato 1, che chiamavano questo campo `mode` e
includevano una singola directory statica, continuano ad avviarsi senza modifiche.

**`runtime.contract`** è l'interfaccia tra un bundle e l'engine. All'interno
della stessa major version del contratto, qualsiasi bundle convalidato continua
a essere valido. Le patch e le minor version sono intercambiabili; una major non
lo è, e un runtime rifiuterà un bundle associato a una major diversa anziché
avviarsi e presentare anomalie in seguito.

Questo è il motivo per cui l'aggiornamento di Rebase in un deployment self-hosted
richiede solo il cambio di un tag:

```yaml
image: rebasepro/server:0.20.0   # a newer tag — your bundle is untouched
```

## Lo sviluppo utilizza lo stesso percorso

`rebase dev` avvia lo stesso runtime direttamente sul tuo codice sorgente TypeScript
anziché su un bundle compilato. L'hot reload continua a funzionare e l'ambiente di
sviluppo riflette fedelmente la produzione, poiché entrambi seguono lo stesso
percorso di avvio anziché due implementazioni destinate a divergere.

Un progetto che necessita di funzionalità non previste dal runtime predefinito
può comunque creare il proprio file `backend/src/index.ts` e importare il server
come libreria. `rebase dev` lo rileva e lo esegue. Consulta [Server personalizzato](/docs/backend/custom-server/) —
perderai il runtime predefinito, ma non la superficie delle API.

## Cosa legge il runtime dall'ambiente

Il runtime è configurato interamente tramite variabili d'ambiente, trattandosi
dello standard supportato da qualsiasi target di deployment.

| Variabile | Significato |
| --- | --- |
| `DATABASE_URL` | Stringa di connessione per il database predefinito. Obbligatoria. |
| `JWT_SECRET` | Chiave segreta di firma, almeno 32 caratteri. Obbligatoria in produzione. |
| `CORS_ORIGINS` | Origini consentite separate da virgola per chiamare l'API. Obbligatoria in produzione. |
| `PORT` | Porta a cui effettuare il bind. Predefinito `3001` in locale, `8080` nell'immagine. |
| `REBASE_SERVICE_KEY` | Chiave server-to-server che garantisce l'accesso da amministratore. |
| `REBASE_METRICS` | `true` per esporre le metriche Prometheus su `/metrics`. |
| `REBASE_MIGRATE_ON_BOOT` | `none` lascia inalterato lo schema; qualsiasi altro valore — incluso non impostato — esegue il passaggio di provisioning additivo. Il valore predefinito è `ensure` ovunque, inclusa la produzione. |
| `REBASE_SERVE_STATIC` | Serve gli asset statici del bundle da questo processo. Abilitato per impostazione predefinita. |

La configurazione di più database e più bucket avviene aggiungendo il suffisso con
la chiave sorgente alla variabile — consulta [Database e bucket multipli](/docs/backend/multiple-sources/).

## Endpoint serviti sempre dal runtime

| Path | Scopo |
| --- | --- |
| `GET /health` | Readiness. Esegue un round-trip verso il database. |
| `GET /livez` | Liveness. Intenzionalmente *non* interagisce con il database, in modo che un problema temporaneo del database non spinga un orchestratore a terminare un processo integro. |
| `GET /api/meta/schema-version` | La versione corrente dello schema. Non autenticato — si tratta di un contrassegno di versione, non dello schema. |
| `GET /api/meta/contract` | L'intero contratto delle collection. Riservato agli amministratori. |
| `GET /metrics` | Metriche Prometheus, quando `REBASE_METRICS=true`. |

---
