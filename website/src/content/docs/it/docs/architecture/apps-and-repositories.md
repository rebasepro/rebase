---
sourceHash: ee6fa328c0acbd31
title: App e Repository
sidebar_label: App & Repository
description: Un progetto è un backend unito alle app che comunicano con esso, ognuna delle quali può risiedere nel proprio repository.
---

## Progetti e app

Un **progetto** è il backend: il database, l'autenticazione, lo storage, le funzionalità in tempo reale e le function. Un'**app** è qualcosa che comunica con esso.

| Tipo | Che cos'è |
| --- | --- |
| `backend` | Le collection, gli hook e le function che definiscono l'API. Esattamente uno per progetto. |
| `static` | Un bundle client compilato: un'SPA o un sito statico, servito sul proprio percorso. |

Questo è l'elenco completo. Il pannello di amministrazione è un'app `static` come qualsiasi altra: viene compilata nel tuo repository, sulla base delle tue collection, ed è per questo che i campi e le viste personalizzati funzionano fin dal primo giorno.

Chi gestisce il processo server è una proprietà del backend, non un tipo di app separato:

| `runtime` | Cosa significa |
| --- | --- |
| `managed` | L'immagine runtime della piattaforma esegue il tuo bundle. Tu fornisci collection, function, cron e schema. |
| `custom` | Tu fornisci il server: il tuo Dockerfile ed entrypoint personalizzati. `rebase eject` configura questa opzione. |

Questo è indipendente da *dove* viene eseguito. Entrambi vengono eseguiti su Rebase Cloud ed entrambi possono essere gestiti in self-hosting: la destinazione risiede in `.rebase/cloud.json`, non nel manifesto.

La parte importante è chi *possiede* l'elenco. Un repository dichiara solo le app che contiene; il progetto possiede l'insieme di app esistenti. Due repository non hanno mai bisogno di conoscersi a vicenda: devono solo conoscere il progetto. Questo è ciò che rende un repository frontend separato, o un'app mobile senza alcuna relazione di repository, una cosa ordinaria piuttosto che un caso speciale.

## `rebase.json`

Il manifesto dichiara la topologia e niente altro. Schema, regole di sicurezza, hook e function rimangono in TypeScript dove il sistema di tipi può verificarli.

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
      "path": "/admin"
    }
  }
}
```

Un solo processo serve tutto: l'API su `/api`, il sito su `/`, l'admin su `/admin`. Questa è la modalità self-hosting, ed è un piano di dimensioni ridotte perfettamente adeguato su Rebase Cloud.

`path` è un input di **build-time** oltre che di erogazione. Un'app montata su `/admin` deve essere *compilata* per `/admin`, altrimenti viene caricato `index.html` e ogni asset restituisce un errore 404: una pagina bianca senza alcun errore visibile. `rebase build` passa il valore come `REBASE_APP_BASE`, che il tuo bundler legge come percorso di base:

```ts
// vite.config.ts
export default defineConfig({
  base: process.env.REBASE_APP_BASE ?? "/",
  // …
});
```

e si rifiuta di rilasciare una build che lo ha ignorato.

Un progetto esistente non ne ha bisogno. La CLI deduce il medesimo layout dalla struttura delle directory, e `rebase apps init` lo scrive quando desideri renderlo esplicito:

```bash
rebase apps list      # what this repository contributes
rebase apps init      # write an inferred rebase.json
```

## Compilazione e deployment delle app

```bash
rebase build              # every app in this repository
rebase build backend      # just the bundle
rebase build admin        # just that app's static assets
```

Il backend viene compilato per primo, poiché la build di un'app client potrebbe utilizzare un SDK generato dalle sue collection.

## Repository multipli

Il monorepo rimane l'opzione predefinita: un unico repository con un backend e un pannello di amministrazione è la soluzione più semplice che funziona, e `rebase init` ne crea la struttura iniziale. La separazione in più repository è un passo successivo facoltativo, non un requisito.

In un repository frontend separato sono necessarie due cose: un manifesto che dichiari ciò che questo repository fornisce e un collegamento al progetto:

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

Il collegamento viene scritto in `.rebase/cloud.json` e **non viene inviato al repository**: è specifico per ogni checkout locale, come un remote di git. Il manifesto viene committato; il collegamento no.

## Client con tipizzazione senza le collection

Questo è il meccanismo che fa funzionare l'architettura multi-repo. Un repository che non contiene collection genera il suo SDK tipizzato direttamente dal progetto stesso:

```bash
rebase generate-sdk --from link
rebase generate-sdk --from https://api.example.com --token $REBASE_SERVICE_KEY
```

La CLI recupera `/api/meta/contract`, ricostruisce le definizioni delle collection — inclusi i target delle relazioni, che il generatore di tipi utilizza per stabilire se una chiave esterna sia una stringa o un numero — ed emette esattamente lo stesso output che avrebbe prodotto dal sorgente locale.

L'endpoint del contratto è ad accesso esclusivo degli amministratori. Le definizioni delle collection descrivono ogni tabella, colonna e relazione nel progetto, comprese quelle che nessuna regola di sicurezza esporrebbe mai; si tratta di una mappa del database, non di una documentazione API pubblica.

## Rilevamento del disallineamento

Separare i repository comporta uno svantaggio degno di nota: una modifica allo schema e il frontend che la utilizza non vengono più inclusi nello stesso commit. Il backend può distribuire una modifica che lascia bloccato un client compilato sulla base della vecchia struttura.

Ogni SDK generato registra lo schema da cui proviene:

```ts
// src/rebase/schema.meta.ts — generated
export const SCHEMA_VERSION = "v1:c5d97d0f96b7f87a";
```

E ogni progetto pubblica quello corrente, senza autenticazione, poiché un contrassegno di versione non rivela nulla sullo schema che rappresenta:

```bash
curl -s https://api.example.com/api/meta/schema-version
# {"schemaVersion":"v1:c5d97d0f96b7f87a"}
```

Il confronto tra i due nella CI trasforma un disallineamento silenzioso in un controllo fallito. Il contrassegno cambia quando i tipi generati potrebbero cambiare — una nuova proprietà, una relazione modificata — e intenzionalmente *non* quando cambia un hook, una regola di sicurezza o un'icona, in modo da evitare falsi allarmi.

## Configurazione del client

```bash
rebase apps config web
```

Stampa ciò di cui un client ha bisogno per raggiungere il progetto. Non stampa mai informazioni segrete: l'URL dell'API e l'identità pubblicabile di un'app sono pensati per essere inclusi all'interno di un bundle client, e qualsiasi dato non sicuro in quel contesto non deve finire in un output destinato a un file `.env` committato.

---
