---
sourceHash: a4b27cb5ae61a96e
title: Runtime e Bundle
sidebar_label: Runtime & Bundle
description: In che modo un progetto Rebase si suddivide in un bundle di progetto e un runtime con controllo delle versioni, e perché tale separazione rende possibili aggiornamenti, app multi-repo e hosting gestito.
---

## Le due metà di un deployment

Un deployment di Rebase è composto da due elementi, non da uno solo:

- **Il bundle** — il tuo progetto. Collection, hook, funzioni e cron job compilati, oltre a un manifest generato che descrive ciò di cui hanno bisogno.
- **Il runtime** — il motore. `@rebasepro/server`, distribuito come immagine container pubblicata `rebasepro/server`.

Vengono compilati, versionati e distribuiti separatamente. Questa singola decisione è la base di tutto il resto descritto in questa pagina: poiché il motore non è integrato nell'immagine della tua applicazione, può essere sostituito sotto al tuo progetto — per una correzione di sicurezza, un miglioramento delle prestazioni o una nuova funzionalità — senza dover ricompilare nulla di ciò che hai scritto.

```
  your repository                 built artifact              running container
  ───────────────                 ──────────────              ─────────────────
  config/collections/*.ts   ──►   dist-bundle/config/     ──►  rebasepro/server
  backend/functions/*.ts          dist-bundle/backend/         + /bundle mounted
  rebase.json                     dist-bundle/manifest.json
```

Il runtime che esegui in self-hosting è lo stesso identico runtime eseguito da Rebase Cloud. Non esiste una build "platform" separata e nessuna funzionalità del piano gestito è preclusa a chi esegue `docker compose up`.

## Compilare un bundle

```bash
rebase build
```

Questo comando rigenera lo schema del database a partire dalle tue collection, ne esegue il type-checking e la compilazione, risolve gli identificatori di importazione in modo che Node possa caricare direttamente l'output e scrive `dist-bundle/` contenente:

| Percorso | Descrizione |
| --- | --- |
| `manifest.json` | Generato. Il contratto che questo bundle dichiara di soddisfare. |
| `package.json` | Generato. Le dipendenze di runtime del tuo progetto. |
| `config/` | Collection compilate. |
| `backend/functions/` | Funzioni server compilate. |
| `backend/crons/` | Cron job compilati. |
| `backend/src/schema.generated.js` | Schema del database compilato. |

Vale la pena comprendere il manifest, poiché è ciò che un runtime convalida prima di acconsentire all'avvio:

```jsonc
{
  "bundleFormat": 2,
  "runtime": { "range": "^1", "builtAgainst": "0.19.1", "contract": 1 },
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

`kind` può essere `backend` — avvia il server, oltre a eventuali app statiche in `entry.static` — oppure `static`, che distribuisce tali asset e nient'altro: nessun database, nessuna autenticazione. Il fatto che un backend dichiari le proprie collection nel codice o ne esegua l'introspezione dal database live non costituisce un terzo tipo; dipende semplicemente dalla presenza o meno di `entry.config`.

## Eseguire un bundle

```bash
rebase start                       # locally
docker run -v ./dist-bundle:/bundle rebasepro/server   # anywhere
```

`rebase start` carica il bundle in-process, consentendo a segnali e stack trace di raggiungerti direttamente. In locale, collega le dipendenze già installate al bundle in modo da evitare una seconda installazione; un deployment installa invece il `package.json` specifico del bundle.

## Compatibilità

Due numeri di versione stabiliscono se un bundle e un runtime possono interagire, e sono deliberatamente distinti dalla versione del pacchetto.

**`bundleFormat`** definisce il layout su disco. Un runtime accetta qualsiasi bundle il cui formato sia inferiore o uguale al proprio, e rifiuta un formato più recente anziché caricarlo solo parzialmente. Un bundle precedente su un runtime più recente deve continuare a funzionare: questo è il punto fondamentale della separazione, quindi un runtime supporta tutti i formati che abbia mai rilasciato. I bundle con formato 1, che chiamavano questo campo `mode` e contenevano una singola directory statica, si avviano ancora senza modifiche.

**`runtime.contract`** è l'interfaccia tra un bundle e il motore. All'interno della stessa versione major del contratto, qualsiasi bundle precedentemente convalidato continua a essere valido. Le patch e le minor release sono intercambiabili (drop-in); le major release non lo sono, e un runtime rifiuterà un bundle proveniente da una versione major differente invece di avviarsi e funzionare in modo errato in seguito.

Ecco perché l'aggiornamento di Rebase in un deployment in self-hosting consiste semplicemente nella modifica di un tag:

```yaml
image: rebasepro/server:0.19.1   # a newer tag — your bundle is untouched
```

## Lo sviluppo utilizza lo stesso percorso

`rebase dev` avvia lo stesso runtime sul codice sorgente TypeScript anziché su un bundle compilato. L'hot reload continua a funzionare e l'ambiente di sviluppo rispecchia fedelmente la produzione, poiché entrambi utilizzano un unico percorso di avvio invece di due implementazioni suscettibili a divergenze.

Un progetto che necessita di funzionalità non presenti nel runtime predefinito può comunque creare il proprio file `backend/src/index.ts` e importare il server come libreria. `rebase dev` lo rileva e lo esegue. Consulta [Custom server](/docs/backend/custom-server/) — perderai il runtime standard, ma non l'API surface.

## Cosa legge il runtime dall'ambiente

Il runtime è configurato interamente tramite variabili d'ambiente, in quanto rappresentano lo standard comune condiviso da qualsiasi target di deployment.

| Variabile | Significato |
| --- | --- |
| `DATABASE_URL` | Stringa di connessione per il database predefinito. Obbligatoria. |
| `JWT_SECRET` | Segreto di firma, di almeno 32 caratteri. Obbligatorio in produzione. |
| `CORS_ORIGINS` | Origini separate da virgola autorizzate a chiamare l'API. Obbligatorio in produzione. |
| `PORT` | Porta su cui effettuare il bind. Predefinito `3001` in locale, `8080` nell'immagine. |
| `REBASE_SERVICE_KEY` | Chiave server-to-server che garantisce l'accesso admin. |
| `REBASE_METRICS` | `true` per esporre le metriche Prometheus su `/metrics`. |
| `REBASE_MIGRATE_ON_BOOT` | `none` lascia invariato lo schema; qualsiasi altro valore — inclusa la mancata impostazione — esegue il passaggio di provisioning incrementale. Il valore predefinito è `ensure` ovunque, produzione inclusa. |
| `REBASE_SERVE_STATIC` | Distribuisce gli asset statici del bundle da questo processo. Abilitato per impostazione predefinita. |

È possibile configurare più database e più bucket aggiungendo come suffisso alla variabile la chiave della sorgente — consulta [Database e bucket multipli](/docs/backend/multiple-sources/).

## Endpoint sempre forniti dal runtime

| Percorso | Scopo |
| --- | --- |
| `GET /health` | Readiness. Esegue un round-trip verso il database. |
| `GET /livez` | Liveness. Deliberatamente *non* interagisce con il database, in modo che un problema temporaneo del database non spinga l'orchestratore a terminare un processo sano. |
| `GET /api/meta/schema-version` | La versione corrente dello schema. Non autenticato — si tratta di un marcatore di versione, non dello schema stesso. |
| `GET /api/meta/contract` | Il contratto completo delle collection. Riservato agli admin. |
| `GET /metrics` | Metriche Prometheus, quando `REBASE_METRICS=true`. |

---
