---
sourceHash: 4ad669042dfd8fc9
title: App e Repository
sidebar_label: App e Repository
description: Un progetto è composto da un backend più le app che comunicano con esso, ciascuna delle quali può risiedere nel proprio repository.
---

## Progetti e app

<span class="since-badge" data-since="0.31">Da 0.31</span>

Un **progetto** è il backend: il database, l'autenticazione, lo storage, il realtime e le
funzioni. Un'**app** è qualcosa che comunica con esso.

| Tipo | Cos'è |
| --- | --- |
| `backend` | Le tabelle, gli hook e le funzioni che definiscono l'API. Esattamente uno per progetto. |
| `static` | Un bundle client compilato — una SPA o un sito statico, servito sul proprio percorso o su un proprio hostname. |

Questo è l'elenco completo. Il pannello di amministrazione è un'app `static` come le altre: viene
compilato nel tuo repository, con le tue personalizzazioni in `frontend/src/cms`, motivo
per cui i campi e le viste personalizzati funzionano fin dal primo giorno.

Chi possiede il processo del server è una proprietà del backend, non un tipo di app
separato:

| `runtime` | Cosa significa |
| --- | --- |
| `managed` | L'immagine runtime della piattaforma esegue il tuo bundle. Tu fornisci tabelle, funzioni, cron e schema. |
| `custom` | Sei tu a fornire il server: il tuo Dockerfile e il tuo entrypoint. `rebase eject` configura questa modalità. |

Questo è indipendente da *dove* viene eseguito. Entrambi funzionano su Rebase Cloud ed entrambi supportano
il self-hosting — la destinazione risiede in `.rebase/cloud.json`, non nel manifest.

La parte importante è chi *possiede* l'elenco. Un repository dichiara solo le app
che contiene; il progetto possiede l'insieme delle app esistenti. Due repository non
hanno mai bisogno di conoscersi a vicenda — devono solo conoscere il progetto. Questo è ciò
che rende un repository frontend separato, o un'app mobile senza alcuna relazione di
repository, una cosa del tutto normale anziché un caso speciale.

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
`/admin`. Questa è l'esperienza del self-hosting, nonché un ottimo piano base su
Rebase Cloud.

## Specificare dove si trova il CMS

`cms` è il percorso URL in cui un'app monta `<RebaseCMS>`. È facoltativo, è
l'unico campo qui che descrive cosa c'è *all'interno* di un'app anziché dove si
trova l'app, ed esiste perché nessun altro meccanismo può scoprirlo autonomamente.

Il CMS è un componente React all'interno del tuo frontend, quindi il suo indirizzo è una
route lato client. Non è una route del server, non è un file nella build e non è
distinguibile da qualsiasi altro percorso non corrispondente in una SPA — una richiesta a
`/admin` riceve lo stesso `index.html` di una richiesta a `/qualsiasi-altra-cosa`. Pertanto, nessun
deploy, nessun server in esecuzione e nessuna quantità di verifiche può determinare dove si trovi il tuo pannello
di amministrazione. Se non lo dichiari, nulla può saperlo.

Gli strumenti che ne sono a conoscenza lo utilizzano in questo modo:

- **Rebase Cloud** inserisce un link *Open CMS* nell'intestazione del progetto e mostra
  l'indirizzo nella panoramica del progetto — sull'hostname dell'app stessa, quando ne ha
  uno. Senza `cms`, la console può proporre solo l'host del progetto — che
  raggiunge il CMS solo se questo si trova casualmente alla radice dello stesso.
- **`rebase dev`** stampa l'URL del CMS nel banner di avvio quando non corrisponde
  semplicemente alla home page del frontend.
- **`rebase apps list`** lo mostra accanto all'app che lo serve.

Tre configurazioni possibili, tutte del tutto standard.

```jsonc
// L'intera app è il CMS — ciò che `rebase init` genera tramite scaffolding.
"admin": { "type": "static", "root": "frontend", "output": "frontend/dist", "path": "/", "cms": "/" }

// Il CMS è una route di un'app più grande, di cui condivide sessione e client.
"web": { "type": "static", "root": "frontend", "output": "frontend/dist", "path": "/", "cms": "/admin" }

// Il CMS è un'app a sé stante, su un proprio hostname — vedi la sezione successiva.
"admin": { "type": "static", "root": "admin", "output": "admin/dist", "path": "https://admin.example.com", "cms": "/" }
```

Il valore è il percorso che digiteresti dopo l'hostname, non un percorso relativo
a `path`, e deve trovarsi all'interno dell'app che lo dichiara — è il fallback
SPA di quell'app a rispondere lì. È sempre un percorso, anche quando il `path`
dell'app è un URL: in tal caso il CMS si trova su quel percorso sull'hostname dell'app, quindi `"cms": "/"`
nell'esempio sopra significa `https://admin.example.com/`. Un progetto ha un solo CMS; dichiararne un
secondo costituisce un errore, evitando ambiguità su quale link mostrare nella console.

`path` è sia un input in fase di **compilazione (build-time)** sia di erogazione (serving). Un'app montata su
`/admin` deve essere *compilata* per `/admin`, altrimenti `index.html` viene caricato ma ogni asset
restituisce un 404 — una schermata bianca senza alcun errore visibile. `rebase build` passa il valore come
`REBASE_APP_BASE`, che il tuo bundler legge come base path:

```ts
// vite.config.ts
export default defineConfig({
  base: process.env.REBASE_APP_BASE ?? "/",
  // …
});
```

e si rifiuta di rilasciare una build che lo abbia ignorato.

Un progetto esistente non ne ha necessariamente bisogno. La CLI deduce la stessa disposizione dalla
struttura delle directory, e `rebase apps init` la scrive su file quando desideri renderla
esplicita:

```bash
rebase apps list      # cosa fornisce questo repository
rebase apps init      # genera un rebase.json dedotto
```

L'inferenza automatica non può determinare due elementi che un `rebase.json` generato tramite scaffold dichiara. Chiama
l'app statica `web`, laddove lo scaffold la chiama `admin`, e non può conoscere la
route `cms` dell'app. Il nome non cambia: Rebase Cloud ha registrato `web` per
ogni progetto distribuito senza un file `rebase.json`.
`rebase apps init --force` mantiene i nomi, il `path` e il `cms` delle app dichiarate dal file
che viene sostituito, e contrassegna come rimossa un'app che non trova più.

## Un'app su un proprio hostname

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
risponde — `example.com`, o l'indirizzo del progetto su Rebase Cloud —
serve `web`, e `admin` non è affatto raggiungibile da lì. Si tratta sempre di un unico
processo e di un unico deploy; l'hostname decide soltanto quale app risponde a una determinata richiesta.

La risoluzione segue due regole:

- Un'app con un hostname risponde solo su quell'hostname. Un'app priva di hostname
  risponde su tutti gli hostname.
- Tra le app rimanenti, prevale quella con il percorso più lungo, come da comportamento standard. A
  parità di percorso, l'app che specifica l'hostname ha la precedenza su quella che non lo fa.

Nell'esempio entrambe le app si trovano su `/`, quindi su `admin.example.com` la seconda regola
seleziona `admin`. Se invece dichiari l'admin su `"https://admin.example.com/cms"`,
risponderà solo sotto `/cms` su quell'hostname: `admin.example.com/pricing`
verrà instradato a `web`. L'hostname restringe l'ambito in cui un'app risponde; non le assegna
automaticamente tutte le richieste su quell'hostname. Due app diverse non possono condividere contemporaneamente sia l'hostname sia il percorso.

Il backend non è un'app, e la presenza di un hostname non ne altera la posizione. `/api`, `/health`
e gli altri percorsi riservati dal backend vengono serviti prima di consultare qualsiasi app, su ogni hostname; di conseguenza `https://admin.example.com/api` è la stessa
API di `https://example.com/api`. Un'app che chiama la propria origine — il valore vuoto di
`VITE_API_URL` generato dallo scaffold — non necessita di un URL API dedicato né di alcuna configurazione CORS. Per lo stesso motivo, questi percorsi non sono ammessi dopo un hostname esattamente come non lo sono da soli: `https://admin.example.com/api` non è valido, esattamente come non lo è `/api`.

Tutto il resto relativo a `path` si applica alla parte successiva all'hostname. L'app
deve comunque essere compilata per tale percorso: `https://admin.example.com` viene compilata con
`REBASE_APP_BASE` impostato su `/`, `https://admin.example.com/cms` con `/cms/`, e
un bundler che ignora questo parametro produrrà una schermata bianca. `cms` è un percorso sull'hostname
dell'app, all'interno di quella porzione di path. L'URL deve essere in `https://` e contenere
un hostname e un percorso e nient'altro — nessuna porta, query string o frammento. Un valore come
`admin.example.com` privo di schema viene rifiutato, indicando il formato URL corretto previsto.

Con `rebase dev`, il routing per hostname non viene applicato. L'app in
`frontend/` viene eseguita alla radice di una porta localhost, come di consueto, e per un'app
con hostname il banner di avvio mostrerà anche l'indirizzo `https://` che avrà
una volta distribuita.

`rebase start` funziona diversamente, poiché esegue il bundle compilato tramite lo stesso
runtime utilizzato in ambiente di produzione — routing per hostname incluso. Un'app associata a un hostname
risponde solo alle richieste il cui header `Host` corrisponde a quell'hostname; di conseguenza,
`http://localhost:3001/` mostrerà l'app priva di hostname, e un bundle la cui unica app
dichiara un hostname risponderà con un errore 404. Per raggiungerla in locale, invia l'header
manualmente:

```bash
curl -H "Host: admin.example.com" http://localhost:3001/
```

oppure associa l'hostname a `127.0.0.1` nel file `/etc/hosts` e apri
`http://admin.example.com:3001/`. Non esiste deliberatamente alcun parametro di query o
header speciale per forzare il routing: uno stratagemma funzionante in locale funzionerebbe anche
in produzione, e determinare l'app di destinazione basandosi su elementi diversi dal vero header `Host` è
proprio ciò che questo sistema di routing mira a prevenire.

In modalità self-hosted, il processo opera la medesima selezione leggendo l'header `Host`
di ogni richiesta. L'indirizzamento dell'hostname verso il server e la configurazione del certificato TLS
sono a tuo carico, così come per l'hostname principale del progetto; un reverse proxy
posto a monte deve inoltrare l'header `Host` originale — Caddy lo fa in modo predefinito, mentre nginx richiede la direttiva `proxy_set_header Host $host;`. L'header `X-Forwarded-Host` non viene letto,
poiché qualsiasi client potrebbe inviarlo arbitrariamente.

### Su Rebase Cloud

Il comando `rebase cloud deploy` registra automaticamente l'hostname sul progetto — la medesima operazione eseguita da
`rebase cloud domains add` — evitando il rischio di dimenticare passaggi separati. La procedura
successiva dipende dallo stato del DNS:

- **I record esistono già.** La fase di deploy verifica l'hostname, che diventa immediatamente
  attivo al completamento del deployment.
- **I record non esistono ancora.** Il deploy procede e mostra a schermo i due record da configurare:
  un record TXT che dimostra la proprietà del dominio e un CNAME che lo punta verso il
  progetto (oppure un record A, se l'hostname coincide con l'apex domain).

Una volta pubblicati i record DNS:

```bash
rebase cloud domains verify admin.example.com
```

Il comando `rebase cloud domains list` mostrerà nuovamente i record necessari nel caso vengano smarriti. Un
hostname non verificato entro 7 giorni dalla registrazione viene rilasciato,
e il successivo deploy tenterà di registrarlo di nuovo. Una volta completata con successo la verifica,
la piattaforma emette automaticamente il certificato HTTPS per l'hostname,
senza richiedere alcun caricamento manuale. Fino a quel momento `admin` non risponderà da nessuna parte, dato che
l'unico hostname su cui è configurato non raggiunge ancora il progetto — il resto del
progetto rimane comunque attivo e funzionante.

La console si aggiorna coerentemente con l'hostname dell'app: il link *Open CMS* e l'indirizzo
del CMS nella panoramica del progetto mostreranno `https://admin.example.com/`, anziché
l'host del progetto.

Un hostname già verificato da un altro progetto provocherà l'interruzione immediata del deploy prima dell'avvio
di qualsiasi rollout; lo stesso vale per un hostname che ricada sotto il dominio gestito dalla piattaforma stessa. Un hostname registrato
da un altro progetto ma mai verificato non costituirà invece un ostacolo: l'errore restituito
fornirà il record TXT per il tuo progetto e, non appena configurato, il deploy successivo (o il comando
`rebase cloud domains add`) ne acquisirà la proprietà. L'aggiunta di un nuovo hostname
modifica i domini configurati per il progetto; questa operazione non è consentita a un token di accesso
creato con il solo permesso `--can deploy`: dalle pipeline di CI, aggiungi l'hostname una tantum eseguendo
`rebase cloud domains add` dopo aver effettuato l'autenticazione; il token potrà poi utilizzarlo per i deploy successivi
come qualsiasi altro hostname già associato al progetto. Se rimuovi l'app da
`rebase.json`, l'hostname rimarrà registrato sul progetto; puoi eliminarlo tramite il comando
`rebase cloud domains remove admin.example.com`.

### Un hostname appartiene a un'app, non a una route

Un hostname viene associato a un'intera app e non può puntare a una route interna ad essa. Se
il CMS è semplicemente una route all'interno di una SPA — ad esempio `web` su `/` con `"cms": "/admin"` — esso
risiederà su `/admin`, su ciascun hostname gestito dal progetto. Assegnare a quell'app
l'URL `https://admin.example.com` comporterebbe lo spostamento dell'intera SPA su quel dominio, mantenendo il CMS
sempre raggiungibile al sottopercorso `/admin`. Per fare in modo che il CMS risponda su un proprio hostname dedicato,
è necessario configurarlo come app indipendente, dotata di un proprio processo di build, come illustrato nell'esempio precedente.

## Compilare ed eseguire il deploy delle app

```bash
rebase build              # tutte le app in questo repository
rebase build backend      # solo il bundle del backend
rebase build admin        # solo le risorse statiche di quell'app
```

Il backend viene compilato per primo, poiché la build di un'app client potrebbe dipendere da un SDK
generato a partire dalle definizioni delle tabelle.

## Repository multipli

L'approccio a monorepo rimane l'impostazione predefinita: un unico repository contenente il backend e il pannello di amministrazione
rappresenta la soluzione più semplice e funzionale, ed è quella predisposta automaticamente da `rebase init`. La suddivisione in più repository
rappresenta un passo successivo di maturazione dell'architettura, non un prerequisito obbligatorio.

All'interno di un repository frontend separato sono necessari due elementi: un file manifest che dichiari
cosa fornisce tale repository e un collegamento (link) verso il progetto:

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
rebase cloud link https://api.example.com   # un progetto self-hosted
rebase cloud link                           # oppure seleziona un progetto Rebase Cloud
```

Il collegamento viene memorizzato nel file `.rebase/cloud.json` e **non deve essere committato** — è
specifico per ogni ambiente di lavoro locale, in modo analogo a un remote git. Il manifest viene committato; il collegamento no.

## Client tipizzati senza definizioni di tabelle locali

Questo è il meccanismo che abilita l'architettura multi-repo. Un repository privo delle
definizioni delle tabelle può generare il proprio SDK tipizzato connettendosi direttamente al progetto:

```bash
rebase generate-sdk --from link
rebase generate-sdk --from https://api.example.com --token $REBASE_SERVICE_KEY
```

La CLI interroga l'endpoint `/api/meta/contract` ed estrae la proprietà `tables` — i descrittori
compilati, comprensivi delle relazioni di destinazione, necessari al generatore di tipi per determinare
se una chiave esterna sia una stringa o un numero — producendo esattamente il medesimo
output che avrebbe generato a partire dai sorgenti locali.

L'endpoint del contract richiede lo scope `schema:read`, normalmente assegnato a un utente amministratore. Esso
descrive ogni tabella, colonna e relazione presente nel progetto, incluse quelle non esposte
da alcuna regola di sicurezza: si tratta a tutti gli effetti di una mappatura integrale del database, non di una documentazione API ad accesso pubblico.

## Rilevare il disallineamento dello schema (drift)

La separazione dei repository comporta un compromesso fondamentale: le modifiche allo schema del database e il
codice frontend che le consuma non vengono più rilasciati contestualmente all'interno dello stesso commit. Di conseguenza, il backend potrebbe distribuire una
modifica che rende incompatibile un client compilato secondo la struttura precedente.

Ogni SDK generato tiene traccia dello schema da cui ha avuto origine:

```ts
// generated/sdk/schema.meta.ts — generato
export const SCHEMA_VERSION = "v1:c5d97d0f96b7f87a";
```

Inoltre, ciascun progetto espone pubblicamente la propria versione corrente, senza richiedere autenticazione,
poiché un identificativo di versione non svela dettagli strutturali sullo schema che rappresenta:

```bash
curl -s https://api.example.com/api/meta/schema-version
# {"schemaVersion":"v1:c5d97d0f96b7f87a","runtime":{"version":"0.30.1","contract":1}}
```

Confrontare questi due identificatori all'interno della pipeline di CI trasforma un potenziale disallineamento silente in un controllo fallito prima del rilascio. L'identificativo
cambia esclusivamente quando si verificano variazioni che impattano i tipi generati — come l'aggiunta di una proprietà o la modifica di una
relazione — ed evita deliberatamente di aggiornarsi in caso di modifiche a hook, regole di sicurezza o icone,
prevenendo la generazione di falsi allarmi.

## Configurazione del client

```bash
rebase apps config web
```

Mostra a terminale i parametri necessari al client per stabilire la connessione con il progetto. L'output non include mai informazioni segrete:
l'URL dell'API e l'identificativo pubblico dell'app sono concepiti per essere inclusi nel bundle
del client; qualsiasi dato la cui esposizione non sia sicura non deve apparire in un output destinato
a confluire all'interno di un file `.env` tracciato nel repository.

## Risorse correlate

- [Runtime e Bundle](/docs/architecture/runtime-and-bundles/) — cosa genera `rebase build` e come viene inizializzato
- [Processi separati](/docs/deployment/split-processes/) — eseguire un singolo bundle suddiviso in più processi
- [Comandi della CLI](/docs/cli/) — `rebase apps` e tutti gli altri comandi disponibili
