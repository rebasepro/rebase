---
sourceHash: 47f5760918cfd724
title: Runtime e bundle
sidebar_label: Runtime & Bundle
description: Come un progetto Rebase si suddivide in un bundle di progetto e un runtime con versione, e perché questa separazione rende possibili aggiornamenti, app multi-repo e hosting gestito.
---

## Le due metà di un deployment

<span class="since-badge" data-since="0.31">Da 0.31</span>

Un deployment di Rebase è composto da due elementi distinti:

- **Il bundle** — il tuo progetto. Tabelle compilate, hook, funzioni e cron
  job, oltre a un manifest generato che descrive ciò di cui hanno bisogno.
- **Il runtime** — il motore. `@rebasepro/server`, distribuito come immagine
  container pubblicata `rebasepro/server`.

Vengono compilati, versionati e distribuiti separatamente. Questa singola
decisione è ciò da cui deriva tutto il resto in questa pagina: poiché il motore
non è integrato nell'immagine dell'applicazione, può essere sostituito al di
sotto del tuo progetto — per una correzione di sicurezza, un miglioramento delle
prestazioni, una nuova funzionalità — senza dover ricompilare nulla di ciò che
hai scritto.

```
  your repository                 built artifact              running container
  ───────────────                 ──────────────              ─────────────────
  backend/schema/*.ts       ──►   dist-bundle/backend/schema/  ──►  rebasepro/server
  backend/functions/*.ts          dist-bundle/backend/             + /bundle mounted
  rebase.json                     dist-bundle/manifest.json
```

Il runtime eseguito in self-hosting è lo stesso runtime eseguito da Rebase
Cloud. Non esiste una build "platform" separata e nulla del livello gestito è
precluso a chi esegue `docker compose up`.

## Creazione di un bundle

```bash
rebase build
```

Questo comando rigenera lo schema del database a partire dalle tue tabelle, ne
esegue il type-checking e la compilazione, risolve gli specificatori di
importazione in modo che Node possa caricare direttamente l'output e scrive
`dist-bundle/` contenente:

| Percorso | Descrizione |
| --- | --- |
| `manifest.json` | Generato. Il contratto che questo bundle dichiara di soddisfare. |
| `package.json` | Generato. Le dipendenze di runtime del tuo progetto. |
| `backend/schema/` | Tabelle compilate: l'`index` che le esporta e un modulo per tabella. |
| `backend/resources.js`, `backend/storage.js`, `backend/hooks.js` | I moduli compilati che il runtime legge accanto alle tabelle, quando il progetto li prevede. |
| `backend/functions/` | Funzioni server compilate. |
| `backend/crons/` | Cron job compilati. |
| `backend/src/schema.generated.js` | Schema del database compilato. |

È importante comprendere il manifest, perché è ciò che un runtime convalida
prima di consentire l'avvio:

```jsonc
{
  "bundleFormat": 3,
  "runtime": { "range": "^1", "builtAgainst": "0.30.1", "contract": 2 },
  "schemaVersion": "v2:3f0c9a1e7d2b5c48",
  "kind": "backend",
  "entry": {
    "tables": "backend/schema",
    "resources": "backend/resources.js",
    "storage": "backend/storage.js",
    "functions": "backend/functions",
    "static": [{ "path": "/", "dir": "static/admin", "spa": true }]
  },
  "tables": ["authors", "posts", "tags", "users"],
  "hooks": { "native": false },
  "storage": { "authorize": true },
  "deps": { "declared": { "zod": "^4.4.3" } }
}
```

<span class="since-badge" data-since="0.31">Da 0.31</span> `bundleFormat`
3 e runtime contract 2: lo schema è `entry.tables`, la directory compilata
`backend/schema`, accanto a `entry.resources`, `entry.storage` ed
`entry.hooks`. `schemaVersion` inizia con `v2:` — viene calcolato a partire
dalle tabelle compilate.

`kind` può essere `backend` — avvia il server, più eventuali app statiche in
`entry.static` — oppure `static`, che serve tali asset e nient'altro: nessun
database, nessuna autenticazione. Il fatto che un backend dichiari le sue
tabelle nel codice o ne esegua l'introspezione dal database attivo non
costituisce un terzo tipo; dipende semplicemente dalla presenza o meno di
`entry.tables`.

## Esecuzione di un bundle

```bash
rebase start                       # locally
docker run -v ./dist-bundle:/bundle rebasepro/server   # anywhere
```

`rebase start` carica il bundle in-process, così che segnali e stack trace
arrivino direttamente a te. In locale collega tramite symlink le dipendenze già
installate nel bundle, evitando una seconda installazione; un deployment installa
invece il `package.json` del bundle stesso.

## Compatibilità

<span class="since-badge" data-since="0.31">Da 0.31</span>

Due numeri di versione stabiliscono se un bundle e un runtime possono funzionare
insieme, e volutamente non coincidono con la versione del pacchetto.

**`bundleFormat`** rappresenta il layout su disco. Un runtime rifiuta un formato
più recente piuttosto che caricarlo solo a metà. Un bundle più vecchio su un
runtime più recente continua a funzionare dove il layout lo consente — questo è
il senso della separazione — con un'eccezione: **un bundle con formato 1 o 2
viene rifiutato** da un runtime 0.31. Tali bundle contengono `config/collections`
— oggetti `defineCollection` — e un runtime che legge solo `backend/schema` non
ha nulla con cui leggerli; avviarne uno comporterebbe l'introspezione del database
invece di servire le tabelle dichiarate. Il rifiuto indica la soluzione: eseguire
[`rebase migrate collections-to-tables`](/docs/cli/schema/#rebase-migrate) sul
codice sorgente del progetto, quindi ricompilare il bundle.

**`runtime.contract`** è l'interfaccia tra un bundle e il motore; la versione
0.31 lo ha portato a `2`. All'interno della stessa versione major del contratto,
qualsiasi bundle convalidato continua a superare la convalida. Patch e versioni
minor sono intercambiabili senza modifiche; una major no, e un runtime rifiuterà
un bundle appartenente a una major diversa piuttosto che avviarsi e comportarsi in
modo anomalo successivamente.

Ecco perché aggiornare Rebase in un deployment self-hosted richiede solo una
modifica del tag:

```yaml
image: rebasepro/server:0.30.1   # a newer tag — your bundle is untouched
```

## Lo sviluppo utilizza lo stesso percorso

`rebase dev` avvia lo stesso runtime sul tuo codice sorgente TypeScript anziché
su un bundle compilato. L'hot reload continua a funzionare e lo sviluppo
rispecchia fedelmente la produzione perché entrambi passano attraverso un unico
percorso di boot, anziché due implementazioni destinate a divergere.

Un progetto che necessita di funzionalità non previste dal runtime standard può
comunque creare il proprio `backend/src/index.ts` e importare il server come
libreria. `rebase dev` lo rileva e lo esegue. Consulta [Server personalizzato](/docs/backend/custom-server/)
— si perde il runtime predefinito, ma non la superficie delle API.

## Cosa legge il runtime dall'ambiente

Il runtime è configurato interamente tramite variabili d'ambiente, poiché questo
è il modello condiviso da qualsiasi target di deployment.

| Variabile | Significato |
| --- | --- |
| `DATABASE_URL` | Stringa di connessione per il database predefinito. Obbligatoria. |
| `JWT_SECRET` | Segreto di firma, di almeno 32 caratteri. Obbligatorio in produzione. |
| `CORS_ORIGINS` | Origini separate da virgola autorizzate a chiamare l'API. Obbligatorio in produzione. |
| `PORT` | Porta a cui effettuare il binding. Predefinita a `3001` in locale, `8080` nell'immagine. |
| `REBASE_SERVICE_KEY` | Chiave server-to-server che concede l'accesso di amministrazione. |
| `REBASE_METRICS` | `true` per esporre le metriche Prometheus su `/metrics`. |
| `REBASE_MIGRATE_ON_BOOT` | `ensure` — il valore predefinito ovunque, produzione inclusa — esegue il passaggio di provisioning additivo; `none` lascia intatto lo schema. Qualsiasi altro valore impedisce l'avvio, e l'immagine di runtime rifiuta anche `push`. |
| `REBASE_SERVE_STATIC` | Serve gli asset statici del bundle da questo processo. Attivo per impostazione predefinita. |

La presenza di più database e più bucket viene configurata aggiungendo come
suffisso alla variabile la chiave della sorgente — consulta [Database e bucket
multipli](/docs/backend/multiple-sources/).

## Endpoint sempre serviti dal runtime

| Percorso | Scopo |
| --- | --- |
| `GET /health` | Readiness. Esegue un round-trip verso il database. |
| `GET /livez` | Liveness. Deliberatamente *non* tocca il database, evitando che un'interruzione momentanea del database spinga un orchestratore a terminare un processo integro. |
| `GET /api/meta/schema-version` | La versione corrente dello schema. Non autenticato — è un marcatore di versione, non uno schema. |
| `GET /api/schema/tables` | Le tabelle, così come ciascun chiamante può visualizzarle — su cui si basa il rendering del pannello di amministrazione. Consulta [Endpoint](/docs/backend/endpoints/#schema). |
| `GET /api/meta/contract` | La versione dello schema, il runtime e ogni tabella così come visualizzati da un amministratore. Richiede `schema:read`. |
| `GET /metrics` | Metriche Prometheus, quando `REBASE_METRICS=true`. |
