---
sourceHash: 2524bc9337abdb23
title: App e repository
sidebar_label: App e repository
description: Un progetto è un backend insieme alle app che comunicano con esso, ciascuna delle quali può risiedere nel proprio repository.
---

## Progetti e app

Un **progetto** è il backend: database, autenticazione, archiviazione, realtime e
funzioni. Un'**app** è qualcosa che comunica con esso.

| Tipo | Cos'è |
| --- | --- |
| `backend` | Le tabelle, gli hook e le funzioni che definiscono l'API. Esattamente uno per progetto. |
| `static` | Un bundle client compilato — una SPA o un sito statico, servito sul proprio percorso o su un proprio hostname. |

Questo è l'elenco completo. Il pannello di amministrazione è un'app `static` come
le altre: viene compilato nel tuo repository, con le tue personalizzazioni in
`frontend/src/cms`, motivo per cui i campi personalizzati e le viste personalizzate
funzionano fin dal primo giorno.

Chi possiede il processo del server è una proprietà del backend, non un tipo di app
separato:

| `runtime` | Cosa significa |
| --- | --- |
| `managed` | L'immagine runtime della piattaforma esegue il tuo bundle. Tu fornisci tabelle, funzioni, cron e schema. |
| `custom` | Tu fornisci il server: il tuo Dockerfile ed entrypoint personalizzati. `rebase eject` lo configura. |

Questo è indipendente da *dove* viene eseguito. Entrambi girano su Rebase Cloud ed
entrambi sono self-hosted — la destinazione risiede in `.rebase/cloud.json`, non nel manifest.

La parte importante è chi *possiede* l'elenco. Un repository dichiara solo le app
che contiene; il progetto possiede l'insieme delle app esistenti. Due repository non
hanno mai bisogno di conoscersi a vicenda — devono solo conoscere il progetto. Questo
è ciò che rende un repository frontend separato, o un'app mobile senza alcuna relazione
di repository, un caso normale anziché un'eccezione.

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

Un unico processo serve tutto: l'API a `/api`, il sito a `/`, l'admin a
`/admin`. Questo è l'approccio self-hosting, ed è una configurazione perfettamente
adatta per un piano ridotto su Rebase Cloud.

Il `path` di un'app statica può assumere una di due forme:

| `path` | Dove risponde l'app |
| --- | --- |
| `"/"`, `"/admin"` | A quel percorso, su ogni hostname su cui viene servito il progetto. |
| `"https://www.example.com"`, `"https://admin.example.com/cms"` | Solo su quell'hostname, al percorso successivo. Vedi [Un'app sul proprio hostname](#an-app-on-its-own-hostname). |

La forma a URL è il modo in cui un progetto con un sito per dominio, come un progetto
Vercel o Netlify per dominio, diventa un unico progetto Rebase: un'app statica per
hostname, tutte servite dallo stesso deploy.

## Indicare dove si trova il CMS

`cms` è il percorso URL in cui un'app monta `<RebaseCMS>`. È facoltativo, è
l'unico campo qui che descrive cosa c'è *all'interno* di un'app anziché dove risiede
l'app, ed esiste perché nient'altro può scoprirlo.

Il CMS è un componente React nel tuo frontend, quindi il suo indirizzo è una
route lato client. Non è una route del server, non è un file nella build e non
è distinguibile da qualsiasi altro percorso non corrispondente in una SPA — una richiesta
a `/admin` riceve lo stesso `index.html` di una richiesta a `/anything-else`. Pertanto
nessun deploy, nessun server in esecuzione e nessuna quantità di tentativi di probing
possono determinare dove si trovi il tuo pannello di amministrazione. Se non lo specifichi,
nulla può saperlo.

Gli strumenti che ne sono a conoscenza lo utilizzano:

- **Rebase Cloud** inserisce un link *Open CMS* nell'intestazione del progetto ed elenca
  l'indirizzo nella panoramica del progetto — sull'hostname proprio dell'app quando ne ha
  uno. Senza `cms`, la console può offrire solo l'host del progetto — che raggiunge il CMS
  solo se questo si trova casualmente alla radice.
- **`rebase dev`** stampa l'URL del CMS nel banner di avvio quando non corrisponde
  semplicemente alla home page del frontend.
- **`rebase apps list`** lo mostra accanto all'app che lo serve.

Tre forme, e tutte sono ordinarie.

```jsonc
// The whole app is the CMS — what `rebase init` scaffolds.
"admin": { "type": "static", "root": "frontend", "output": "frontend/dist", "path": "/", "cms": "/" }

// The CMS is one route of a bigger app, sharing its session and its client.
"web": { "type": "static", "root": "frontend", "output": "frontend/dist", "path": "/", "cms": "/admin" }

// The CMS is an app of its own, on a hostname of its own — see the next section.
"admin": { "type": "static", "root": "admin", "output": "admin/dist", "path": "https://admin.example.com", "cms": "/" }
```

Il valore è il percorso che digiteresti dopo l'hostname, non un percorso relativo a
`path`, e deve trovarsi all'interno dell'app che lo dichiara — il fallback SPA di
quell'app è ciò che risponde lì. È sempre un percorso, anche quando il `path` dell'app
è un URL: il CMS si trova quindi a quel percorso sull'hostname dell'app, perciò
`"cms": "/"` sopra significa `https://admin.example.com/`. Un progetto ha un solo CMS;
dichiararne un secondo è un errore anziché un lancio della monetina su quale collegare
nella console.

`path` è un input in fase di **compilazione (build-time)** oltre che di servizio. Un'app
montata su `/admin` deve essere *compilata* per `/admin`, altrimenti `index.html` si
carica e ogni asset restituisce 404 — una pagina vuota senza alcun errore da nessuna
parte. `rebase build` passa il valore come `REBASE_APP_BASE`, che il tuo bundler legge
come percorso di base:

```ts
// vite.config.ts
export default defineConfig({
  base: process.env.REBASE_APP_BASE ?? "/",
  // …
});
```

e si rifiuta di distribuire una build che lo ha ignorato.

Un progetto esistente non ne ha bisogno. La CLI deduce lo stesso layout dalla
struttura delle directory, e `rebase apps init` lo scrive nel file quando desideri
renderlo esplicito:

```bash
rebase apps list      # what this repository contributes
rebase apps init      # write an inferred rebase.json
```

L'inferenza non può conoscere due cose dichiarate dal `rebase.json` di uno scaffolding.
Chiama l'app statica `web`, mentre lo scaffolding la chiama `admin`, e non può conoscere
la route `cms` dell'app. Il nome non cambia: Rebase Cloud ha registrato `web` per
ogni progetto distribuito senza un `rebase.json`.
`rebase apps init --force` mantiene i nomi, `path`, `cms`, `routes`,
`frameAncestors`, `redirects` e `cleanUrls` delle app dichiarate dal file che sostituisce,
e contrassegna come rimossa un'app che non trova più.

## An app on its own hostname

`path` può anche essere un URL `https://` completo, che assegna all'app un hostname
proprio:

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
risponde — `example.com`, o l'indirizzo stesso del progetto su Rebase Cloud —
serve `web`, e `admin` non è raggiungibile affatto lì. Si tratta comunque di un unico
processo e di un unico deploy; l'hostname determina soltanto quale app risponde a una
richiesta.

La decisione si basa su due regole:

- Un'app con un hostname risponde solo su quell'hostname. Un'app senza hostname
  risponde su tutti gli hostname.
- Tra le app rimanenti, prevale quella con il percorso più lungo, come è sempre
  stato. A parità di percorso, l'app che specifica l'hostname ha la precedenza
  su quella che non lo fa.

Nell'esempio entrambe le app si trovano su `/`, quindi su `admin.example.com` la seconda
regola seleziona `admin`. Se invece dichiari l'admin su `"https://admin.example.com/cms"`,
risponde solo sotto `/cms` su quell'hostname: `admin.example.com/pricing` va a `web`.
Un hostname restringe i casi in cui un'app risponde; non assegna all'app tutto ciò che
si trova su quell'hostname. Due app diverse non possono condividere sia l'hostname sia
il percorso.

Il backend non è un'app e un hostname non lo sposta. A `/api`, `/health` e agli
altri percorsi riservati dal backend viene data risposta prima che qualsiasi app
venga consultata, su ogni hostname, quindi `https://admin.example.com/api` è la stessa
API di `https://example.com/api`. Un'app che chiama la propria origine — il valore vuoto
di `VITE_API_URL` dello scaffolding — non necessita di un proprio URL API né di
configurazioni CORS. Per lo stesso motivo tali percorsi vengono rifiutati dopo un
hostname esattamente come lo sono da soli: `https://admin.example.com/api` non è
valido, esattamente come non lo è `/api`.

Tutto il resto riguardante `path` si applica alla parte successiva all'hostname. L'app
viene comunque compilata per esso: `https://admin.example.com` viene compilata con
`REBASE_APP_BASE` impostato su `/`, `https://admin.example.com/cms` con `/cms/`, e
un bundler che lo ignora restituirà comunque una pagina bianca. `cms` è un percorso
sull'hostname dell'app, all'interno di quella parte di percorso. L'URL deve essere
`https://` e contenere solo un hostname e un percorso, nient'altro — nessuna porta,
query o frammento. Un semplice `admin.example.com` viene rifiutato, indicando l'URL
corretto che avrebbe dovuto essere utilizzato.

In `rebase dev`, nulla viene instradato per hostname. Esegue l'app in `frontend/`
alla radice di una porta localhost, come ha sempre fatto, e per un'app con un
hostname il banner stampa anche l'indirizzo `https://` che avrà una volta distribuita.

`rebase start` è diverso, perché esegue il bundle compilato tramite lo stesso
runtime di un deployment — routing per hostname incluso. Un'app con un hostname
risponde solo alle richieste il cui header `Host` è quell'hostname, quindi
`http://localhost:3001/` mostra l'app priva di hostname, e un bundle la cui unica
app specifica un hostname risponderà con 404. Per raggiungerla localmente, invia
tu stesso l'header:

```bash
curl -H "Host: admin.example.com" http://localhost:3001/
```

oppure fai puntare l'hostname a `127.0.0.1` in `/etc/hosts` e apri
`http://admin.example.com:3001/`. Non esiste deliberatamente alcun parametro di
query o header per sovrascrivere il routing: uno che funzionasse localmente funzionerebbe
anche in produzione, e selezionare l'app tramite qualcosa di diverso dal reale `Host`
è proprio ciò che il routing intende prevenire.

In modalità self-hosted, il processo effettua la stessa scelta a partire dall'header
`Host` di ciascuna richiesta. Far puntare l'hostname al server e fornirgli un
certificato spetta a te, come per l'hostname principale del progetto, e un reverse
proxy a monte deve inoltrare l'header `Host` originale — Caddy lo fa per impostazione
predefinita, nginx richiede `proxy_set_header Host $host;`. `X-Forwarded-Host` non
viene letto, poiché qualsiasi client può inviarne uno.

### On Rebase Cloud

`rebase cloud deploy` registra l'hostname nel progetto — esattamente ciò che fa
`rebase cloud domains add` — quindi non c'è alcun passaggio separato da dimenticare.
Ciò che accade dopo dipende dal DNS:

- **I record esistono già.** Il deploy verifica l'hostname, che diventa attivo al
  termine del deploy.
- **Non esistono.** Il deploy procede e stampa i due record da creare: un record TXT
  che dimostra che il nome è tuo e un CNAME che lo punta al progetto (un record A
  se l'hostname è l'apex del dominio).

Una volta pubblicati i record:

```bash
rebase cloud domains verify admin.example.com
```

`rebase cloud domains list` stampa nuovamente i record se li perdi. Un hostname che
non viene verificato entro 7 giorni dalla registrazione viene rilasciato, e il deploy
successivo lo registrerà di nuovo. Quando la verifica va a buon fine, la piattaforma
emette il certificato HTTPS per l'hostname; non c'è nulla da caricare. Fino ad allora
`admin` non risponde da nessuna parte, poiché l'unico hostname su cui risponde non
raggiunge ancora il progetto — il resto del progetto è comunque attivo.

La console segue l'app sul suo hostname: il link *Open CMS* e l'indirizzo del CMS
nella panoramica del progetto sono `https://admin.example.com/`, non l'host del
progetto.

Un hostname verificato da un altro progetto fa fallire il deploy prima che venga
distribuito qualsiasi elemento, e lo stesso vale per uno situato sotto il dominio
stesso della piattaforma. Uno registrato da un altro progetto e mai verificato non
è di ostacolo: il rifiuto ti fornisce un record TXT per il tuo progetto e, una volta
creato, il deploy successivo (o `rebase cloud domains add`) acquisisce l'hostname.
L'aggiunta di un hostname che il progetto non possiede ancora modifica i domini del
progetto, cosa che un token di accesso creato con `--can deploy` non è autorizzato
a fare: da CI, aggiungi l'hostname una volta con `rebase cloud domains add` dopo aver
effettuato l'accesso; a quel punto il token eseguirà il deploy come per qualsiasi
hostname già presente nel progetto. Rimuovere l'app da `rebase.json` lascia l'hostname
registrato sul progetto; rimuovilo con `rebase cloud domains remove admin.example.com`.

### Un hostname appartiene a un'app, non a una route

Un hostname viene assegnato a un'intera app. Non può puntare a una route al suo
interno. Quando il CMS è una route di una singola SPA — `web` su `/` con
`"cms": "/admin"` — risiede in `/admin`, su ogni hostname a cui il progetto risponde.
Assegnare a quell'app `https://admin.example.com` sposterebbe l'intera SPA lì, con il
CMS ancora su `/admin` al suo interno. Per assegnare al CMS un hostname dedicato,
trasformalo in un'app a sé stante con una propria build, come nell'esempio sopra.

## Servire una funzione su un percorso di un'app

Una funzione personalizzata risponde a `/api/functions/<name>`, e un'app statica non
può rivendicare `/api`. Un sito editoriale ha bisogno di alcuni percorsi che nessuna
build può contenere — una sitemap e un feed che elencano gli ultimi post, una pagina
renderizzata a partire dal database. `routes` serve la risposta di una funzione su un
percorso dell'indirizzo proprio dell'app:

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

`https://www.example.com/sitemap.xml` corrisponde quindi a ciò che restituisce
`functions/sitemap.ts`, con il proprio `Content-Type`, stato e intestazioni. Tutto
il resto sull'hostname è la build del sito, come in precedenza.

- **Esatto o con wildcard.** `/sitemap.xml` corrisponde unicamente a quel percorso.
  `/blog/*` corrisponde a `/blog` e a ogni percorso sottostante, passando alla
  funzione la parte rimanente: `/blog/hello` raggiunge la route `/:slug` della
  funzione con `slug` impostato su `hello`, e `/blog` raggiunge la sua route `/`.
- **La funzione vede una normale chiamata.** La richiesta la raggiunge come se
  fosse stata inviata a `/api/functions/<name>`, attraverso gli stessi controlli di
  autenticazione, di scope, di rate limit e di timeout. Il metodo, le intestazioni, il
  body e la query string vengono inoltrati, così come `Host`, pertanto
  `new URL(c.req.url).origin` è l'origine del sito — su cui vengono costruiti gli
  URL assoluti di una sitemap. La funzione continua inoltre a rispondere anche a
  `/api/functions/<name>`.
- **Prevale la route più specifica**: un percorso esatto prima di qualsiasi wildcard,
  e una wildcard più lunga prima di una più corta. Una route prevale anche su un file
  con lo stesso percorso presente nella build, quindi un file `public/sitemap.xml`
  obsoleto non può nasconderla.
- **Solo dove risponde l'app.** Una route si applica alle richieste a cui risponderebbe
  l'app stessa — sul suo hostname, se ne ha uno, e non sotto il percorso di un'altra app.
  `rebase.json` viene rifiutato se una route si trova dove risponde un'altra app.
- **All'interno dell'app e mai del backend.** Il percorso di una route è assoluto,
  interno al `path` dell'app, e non può trovarsi sotto `/api`, `/health`, `/healthz`,
  `/livez`, `/readyz` o `/metrics`, né avere un segmento che inizia con `.`. Una
  wildcard non può coprire l'intera app, altrimenti la sua build rimarrebbe non servita.

Le route vengono servite dal processo di backend in cui l'app è integrata, poiché è
lì che vengono eseguite le funzioni: `rebase build` e `rebase cloud deploy` integrano
ogni app statica nel bundle del backend, e la build fallisce se una route fa riferimento
a una funzione non presente nel backend. Un'app statica distribuita da sola non ha
funzioni da chiamare, pertanto `rebase cloud deploy` ne rifiuta una contenente route,
e il runtime si rifiuta di avviare un bundle solo statico che le dichiara.

Una risposta instradata che non invia alcun `Content-Security-Policy` riceve quello
dell'app, in modo che le origini specificate nel suo [`frameAncestors`](/docs/deployment/self-hosting/#letting-another-origin-frame-an-app)
possano incorporare tramite frame una pagina renderizzata dal server, così come possono
farlo per il resto del sito.

In `rebase dev` l'app viene servita dal proprio dev server, che non conosce le
route; chiama la funzione su `/api/functions/<name>` in tale ambiente, oppure
prova le route a fronte di una build con `rebase start`.

## Redirect e clean URL

Un'app statica supporta `redirects` (`{ "from": "/blog/:slug", "to": "/posts/:slug" }`,
anche verso un altro dominio) e `cleanUrls: true` (`/x` serve `x.html`). Consulta
[Redirects and clean URLs](/docs/architecture/redirects-and-clean-urls/), che
illustra anche la mappatura di un `vercel.json` su `rebase.json`.

## App Link, Universal Link e altri file `/.well-known`

Gli Android App Link e gli iOS Universal Link vengono verificati recuperando un
file dall'origine del sito: `https://<host>/.well-known/assetlinks.json` e
`https://<host>/.well-known/apple-app-site-association`. Finché una piattaforma non
riesce a recuperarlo, un link toccato o scansionato si apre nel browser anziché
nell'app installata. Inserisci i file nella cartella `.well-known/` della build (con Vite,
`public/.well-known/`) e l'app su `/` li servirà:

```text
site/dist/
  index.html
  .well-known/
    assetlinks.json
    apple-app-site-association
```

- **Un file o un 404.** `/.well-known/<name>` risponde con quel file della build, o con
  404 se la build non ne contiene alcuno, mai con l'`index.html` dell'app e mai con un
  redirect. I file che terminano in `.json` e il file senza estensione
  `apple-app-site-association` vengono inviati come `application/json`; gli altri in base
  alla loro estensione (`security.txt` come `text/plain`). Ognuno include un `ETag` e
  `Cache-Control: no-cache`.
- **I documenti del backend hanno la precedenza.** `jwks.json`, `oauth-protected-resource`,
  `oauth-authorization-server`, `openid-configuration` e `acme-challenge/` non vengono mai
  serviti da una build, anche in un processo in cui il backend non li serve direttamente,
  in modo che una build non possa pubblicare chiavi di firma o metadati OAuth.
- **Nessun altro file con punto.** Un segmento che inizia con `.` sotto `.well-known`
  (`/.well-known/.secret`), e ogni altro percorso con punto (`/.env`, `/.git/config`),
  vengono comunque rifiutati, codificati o meno, e un file che è un symlink verso l'esterno
  della build non viene servito.
- **Solo l'app su `/`.** `/.well-known` appartiene all'origine, quindi un'app sotto un
  percorso (`/admin`) non pubblica nulla dalla propria cartella `.well-known/`. Con le
  [app sul proprio hostname](#an-app-on-its-own-hostname), l'app su `/` di ciascun
  hostname serve i propri, consentendo a `admin.example.com` e `www.example.com` di
  pubblicare file differenti.

I file vengono serviti dal processo di backend in cui l'app è integrata
(`rebase start`, un deployment self-hosted o Cloud), esattamente come il resto della
build. Il percorso di una route non può trovarsi sotto `/.well-known`; per generare uno
di questi documenti, scrivilo all'interno della build.

## Compilazione e deploy delle app

```bash
rebase build              # every app in this repository
rebase build backend      # just the bundle
rebase build admin        # just that app's static assets
```

Il backend viene compilato per primo, poiché la build di un'app client potrebbe
utilizzare un SDK generato dalle sue tabelle.

## Repository multipli

Il monorepo rimane l'impostazione predefinita: un unico repository con un backend e
un pannello di amministrazione è la soluzione funzionante più semplice, e `rebase init`
ne crea lo scaffolding. La suddivisione è un passaggio evolutivo successivo, non un
requisito obbligatorio.

In un repository frontend separato sono necessarie due cose: un manifest che dichiara
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

Il collegamento viene scritto in `.rebase/cloud.json` e **non viene committato** —
è specifico per checkout, come un remote git. Il manifest viene committato; il
collegamento no.

## Client tipizzati senza le tabelle

Questo è il meccanismo che fa funzionare l'approccio multi-repo. Un repository che
non contiene tabelle genera il proprio SDK tipizzato direttamente dal progetto:

```bash
rebase generate-sdk --from link
rebase generate-sdk --from https://api.example.com --token $REBASE_SERVICE_KEY
```

La CLI recupera `/api/meta/contract` e legge le sue `tables` — i descrittori
compilati, comprese le destinazioni delle relazioni, di cui il generatore di tipi ha
bisogno per decidere se una chiave esterna sia una stringa o un numero — ed emette
esattamente lo stesso output che avrebbe prodotto a partire dal sorgente locale.

L'endpoint del contract richiede lo scope `schema:read`, che un amministratore
possiede. Descrive ogni tabella, colonna e relazione nel progetto, incluse quelle
che nessuna regola di sicurezza esporrebbe mai; si tratta di una mappa del database,
non di documentazione API pubblica.

## Rilevare il drift

La suddivisione dei repository comporta un costo degno di nota: una modifica allo
schema e il frontend che lo utilizza non atterrano più nello stesso commit. Il backend
può distribuire una modifica che lascia isolato un client compilato in base alla
struttura precedente.

Ogni SDK generato registra lo schema da cui proviene:

```ts
// generated/sdk/schema.meta.ts — generated
export const SCHEMA_VERSION = "v1:c5d97d0f96b7f87a";
```

E ogni progetto pubblica quello attuale, senza autenticazione, poiché un contrassegno
di versione non rivela nulla sullo schema che rappresenta:

```bash
curl -s https://api.example.com/api/meta/schema-version
# {"schemaVersion":"v1:c5d97d0f96b7f87a","runtime":{"version":"0.35.1","contract":1}}
```

Il confronto dei due in CI trasforma una discrepanza silenziosa in un controllo
fallito. Il contrassegno cambia quando i tipi generati potrebbero cambiare — una nuova
proprietà, una relazione modificata — e deliberatamente *non* quando cambia un hook,
una regola di sicurezza o un'icona, evitando così falsi allarmi.

## Configurazione del client

```bash
rebase apps config web
```

Stampa ciò di cui un client ha bisogno per raggiungere il progetto. Non stampa mai un
segreto: l'URL dell'API e l'identità pubblicabile di un'app sono destinati a essere
inclusi all'interno di un bundle client, e qualsiasi cosa non sia sicura lì non deve
trovarsi in un output che finirà in un `.env` committato.

## Correlati

- [Runtime e bundle](/docs/architecture/runtime-and-bundles/) — cosa produce `rebase build` e cosa lo avvia
- [Processi suddivisi](/docs/deployment/split-processes/) — eseguire un bundle sotto forma di più processi
- [Comandi della CLI](/docs/cli/) — `rebase apps` e il resto
