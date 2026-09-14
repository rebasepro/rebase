---
sourceHash: c6ff4a9052df3362
title: Configurazione dello Storage
sidebar_label: Configurazione dello Storage
description: Configura backend di storage su filesystem locale, compatibili con S3 o GCS/Firebase Storage per il caricamento di file, immagini e contenuti multimediali.
---

## Panoramica

Rebase supporta tre backend di storage:

- **Filesystem locale** — File archiviati su disco (ottimo per lo sviluppo)
- **Compatibile con S3** — AWS S3, MinIO, Cloudflare R2, DigitalOcean Spaces
- **Google Cloud Storage / Firebase Storage** — Supporto nativo GCS tramite `@google-cloud/storage`

## Configurazione

:::note[Dove va inserito]
**Runtime gestito** — le variabili `STORAGE_*` in `.env` (`STORAGE_TYPE`, `STORAGE_BUCKET` o `S3_BUCKET` / `GCS_BUCKET`, `STORAGE_PATH`, `STORAGE_PUBLIC_READ`, … — aggiungi il suffisso `__<KEY>` a una qualsiasi di esse per una sorgente con nome), più una dichiarazione `bucket("<key>")` in `config/resources.ts` per ogni bucket oltre a quello predefinito, ed `export const storageAuthorize` da `config/index.ts`. `storageAuthorize` non ha intenzionalmente una forma basata su variabili d'ambiente: nessuna variabile può esprimere "questo utente può leggere questa chiave".

**Ejected** — il blocco `storage` su `initializeRebaseBackend({ … })`. `storagePolicies` e `storageTriggers` sono disponibili solo in modalità ejected.

La mappatura completa si trova in [Panoramica del Backend](/docs/backend/#where-each-option-lives).
:::

Lo storage viene configurato nel blocco `storage` di `initializeRebaseBackend`:

### Storage Locale

```typescript no-verify
const backend = await initializeRebaseBackend({
    // ...
    storage: {
        type: "local",
        basePath: "./uploads"   // Directory for file storage
    }
});
```

### Storage S3

```typescript no-verify
const backend = await initializeRebaseBackend({
    // ...
    storage: {
        type: "s3",
        bucket: env.S3_BUCKET!,
        region: env.S3_REGION || "auto",
        accessKeyId: env.S3_ACCESS_KEY_ID || "",
        secretAccessKey: env.S3_SECRET_ACCESS_KEY || "",
        endpoint: env.S3_ENDPOINT,          // For MinIO, R2, etc.
        forcePathStyle: env.S3_FORCE_PATH_STYLE  // Required for MinIO
    }
});
```

### Storage GCS / Firebase

```typescript no-verify
const backend = await initializeRebaseBackend({
    // ...
    storage: {
        type: "gcs",
        bucket: env.GCS_BUCKET!,
        projectId: env.GCS_PROJECT_ID,
    }
});
```

Su GCP (Cloud Run, GCE, GKE), le credenziali predefinite del service account vengono utilizzate automaticamente. Al di fuori di GCP, imposta la variabile d'ambiente `GOOGLE_APPLICATION_CREDENTIALS` sul percorso del file delle chiavi del service account.

### Backend di Storage Multipli

È possibile configurare più backend con nome e indirizzare campi diversi verso storage differenti:

```typescript
storage: {
    "(default)": { type: "local", basePath: "./uploads" },
    "media": { type: "s3", bucket: "media-bucket", region: "us-east-1", ... }
}
```

Quindi, nelle proprietà della tua collezione, fai riferimento a uno specifico backend:

```typescript
image: {
    type: "string",
    name: "Image",
    storage: {
        storagePath: "products",
        storageSource: "media"  // Routes to the "media" S3 backend
    }
}
```

## Endpoint di Storage

| Metodo | Percorso | Descrizione |
|--------|----------|-------------|
| `POST` | `/api/storage/upload` | Caricamento diretto di file |
| `POST` | `/api/storage/upload?storageId=<key>` | Caricamento verso uno specifico backend con nome |
| `GET` | `/api/storage/file/*` | Recupera un file — tutto ciò che segue `/file/` è la chiave dell'oggetto |
| `GET` | `/api/storage/file/*?storageId=<key>` | Recupera un file da uno specifico backend |
| `GET` | `/api/storage/metadata/*` | Dimensione, content type e ultima modifica di un oggetto, senza i suoi byte |
| `DELETE` | `/api/storage/file/*` | Elimina un file |
| `GET` | `/api/storage/list` | Elenca gli oggetti sotto un prefisso (`prefix`, `bucket`, `maxResults`, `pageToken`, `storageId`) |
| `POST` | `/api/storage/folder` | Crea un marker di cartella vuota |
| `GET` | `/api/storage/sources` | Le sorgenti di storage servite da questo backend, per chiave |
| `OPTIONS` | `/api/storage/tus` | Interroga le funzionalità supportate dal protocollo TUS |
| `POST` | `/api/storage/tus` | Avvia una sessione di caricamento TUS ripristinabile |
| `HEAD` | `/api/storage/tus/:id` | Verifica l'avanzamento del caricamento (offset dei byte) |
| `PATCH` | `/api/storage/tus/:id` | Aggiunge un blocco di dati al file temporaneo |
| `DELETE` | `/api/storage/tus/:id` | Termina/interrompe la sessione di caricamento TUS |

**Cosa restituiscono.** Un singolo envelope, lo stesso utilizzato da `/api/data`: il payload
si trova sotto `data`, e un fallimento è `{ "error": { message, code, requestId } }`
con i codici presenti nel [riferimento degli errori](/docs/backend/errors/). `/api/storage/file/*`
fa eccezione, poiché il suo payload è il file stesso — restituisce i byte, con
`Content-Type`, `Content-Length` e gli header di caching.

```json
// GET /api/storage/list?prefix=products/images/
{ "data": { "items": [ { "bucket": "default", "fullPath": "products/images/a.jpg", "name": "a.jpg" } ], "prefixes": [] } }
```

`POST /api/storage/upload` risponde con `201` contenente `{ key, bucket, storageUrl }`
dell'oggetto archiviato sotto `data`; `GET /api/storage/metadata/*` con i metadati dell'oggetto
e, per un oggetto privato, il `token` di breve durata;
`GET /api/storage/sources` con l'array delle sorgenti configurate.
`DELETE /api/storage/file/*` e `POST /api/storage/folder` contengono solo un
`message`, poiché non c'è nulla da restituire.

**Come viene autorizzata la lettura di un file.** Le rotte di lettura — `/api/storage/file/*` e
`/api/storage/metadata/*` — accettano il token firmato di breve durata generato da
[`getSignedUrl()`](/docs/sdk/storage), passato come `?token=<token>` o come
`Bearer`. Un normale JWT di accesso viene **rifiutato** su `/file/*` con `401
Unauthorized: Access JWT not allowed on file routes`: il token valido su
qualsiasi altra rotta non funziona lì, intenzionalmente, poiché l'URL di un file è
qualcosa che si passa a un browser, a una CDN o a un tag `<img>`. Tutte le altre
righe sopra indicate accettano il normale JWT di accesso.

## Trasformazioni delle Immagini al Volo

Rebase include una pipeline integrata di elaborazione delle immagini basata su **Sharp**. Quando si servono asset di immagini dallo storage, è possibile applicare operazioni dinamiche utilizzando i parametri di query:

```bash
# Serve image scaled to 300px width in webp format
GET /api/storage/file/products/laptop.jpg?width=300&format=webp
```

### Parametri Supportati

- `width`, `height`: Limiti di ridimensionamento, da `1` a `4096` (l'immagine non viene mai ingrandita).
- `quality`: `1`–`100`.
- `format`: Converte il formato dell'immagine. Formati supportati: `webp`, `jpeg`, `png`, `avif`.
- `fit`: `cover`, `contain`, `fill`, `inside` o `outside`.

Un parametro al di fuori di questi limiti restituisce un **400**, non un valore
limitato silenziosamente — in passato `?width=99999` restituiva un'immagine a 4096px
e `?format=tiff` una webp, senza alcun avviso.

### Prestazioni e Caching LRU

La trasformazione è onerosa in termini di CPU e memoria, e su un oggetto pubblico
l'endpoint è accessibile anonimamente, per cui il lavoro viene limitato oltre che
semplicemente memorizzato nella cache:
- **Capacità**: una LRU limitata a **500 voci** a livello globale, indicizzata per sorgente
  di storage, bucket e chiave canonica.
- **TTL (Time to Live)**: Le varianti nella cache scadono dopo **1 ora**.
- Richieste concorrenti per la stessa variante non presente nella cache producono **una sola**
  trasformazione, non una per ciascuna.
- Viene eseguito solo un numero limitato di trasformazioni contemporaneamente; superata una
  coda delimitata, il server risponde con **503 `TRANSFORM_OVERLOADED`** invece di
  accettare lavoro che non riuscirà a completare.

Tale cache risiede nel processo, il che significa che non è condivisa tra le istanze
e non sopravvive a un riavvio. Due repliche elaborano ciascuna ogni variante e un
deploy cancella tutto.

### Rendition che sopravvivono a un riavvio

`storageRenditionCache` riscrive ciascuna immagine derivata nello stesso bucket della
sua sorgente, in modo che il lavoro venga svolto una sola volta per l'intero deployment
anziché una volta per istanza per ogni release:

```ts
storageRenditionCache: { enabled: true }
```

oppure `STORAGE_RENDITION_CACHE=true` per un bundle deployment. Le rendition vengono
archiviate sotto il prefisso riservato `_rebase/renditions/`, indicizzate in base alla versione
dell'oggetto sorgente — pertanto la sostituzione di un'immagine serve immediatamente quella nuova.

Tre aspetti da sapere prima di abilitarla:

- **Una lettura ora comporta una scrittura.** Ogni nuova variante richiede una `PUT` nel tuo
  bucket. Per questo motivo è disabilitata per impostazione predefinita.
- **Una scrittura fallita non equivale a una richiesta fallita.** Credenziali in sola lettura
  o una policy del bucket che rifiuta il prefisso effettuano il fallback sulla cache in-process;
  l'immagine viene comunque servita e la motivazione viene registrata una volta nei log.
- **Le rendition sostituite non vengono eliminate automaticamente.** La sostituzione di un oggetto
  sorgente abbandona le sue vecchie rendition. Imposta una regola del ciclo di vita (lifecycle rule)
  su `_rebase/renditions/` — tale prefisso è fisso e non configurabile, proprio per consentire a una
  regola di farvi riferimento.

Il prefisso non è indirizzabile dall'API. La lettura o scrittura diretta
restituisce **400 `INVALID_STORAGE_KEY`**: qualsiasi regola di accesso nel prodotto —
sia `storageAuthorize` sia le policy dichiarative — è scritta rispetto alla chiave
*sorgente*, e una rendition servita sotto il proprio percorso risponderebbe a una
domanda mai formulata.

### Cosa viene servito

Il content type archiviato corrisponde a quanto dichiarato dall'autore del caricamento —
nulla esamina i byte — pertanto `/api/storage/file/*` eseguirà il rendering inline solo per
una **ristretta allowlist**: immagini (eccetto SVG), video, audio, `application/pdf` e `text/plain`.
Qualsiasi altra cosa, inclusi `text/html` e `image/svg+xml`, viene servita come
`application/octet-stream` con `Content-Disposition: attachment`, e ogni
risposta include `X-Content-Type-Options: nosniff`. Lo storage non è un web host:
una pagina caricata e renderizzata sull'origine dell'API potrebbe leggere i cookie di
quell'origine e chiamare i suoi endpoint.

## Protocollo di Caricamento Ripristinabile TUS

Per il caricamento di file di grandi dimensioni (fino a **5GB**) o per gestire condizioni di rete instabili, Rebase implementa il protocollo aperto **TUS v1.0.0**, incluse le estensioni `Creation` e `Termination`.

```
Client                                                   Rebase Server
  │                                                           │
  │─── POST /api/storage/tus (Upload-Length: 50000000) ──────>│ (Generates session ID)
  │<── 201 Created (Location: /api/storage/tus/uuid-abc) ────│
  │                                                           │
  │─── PATCH /api/storage/tus/uuid-abc (Upload-Offset: 0) ───>│ (Appends chunk via open/write)
  │<── 204 No Content (Upload-Offset: 1500000) ───────────────│
  │                                                           │
  │─── PATCH /api/storage/tus/uuid-abc (Upload-Offset: 1.5M) ─>│ (Upload finishes)
  │<── 204 No Content (Upload-Offset: 50000000) ──────────────│ (Copies to storage, unlinks temp)
```

### Meccaniche del Ciclo di Vita del Caricamento

1. **Inizializzazione della sessione (`POST`)**: Il client invia la dimensione totale del file nell'header `Upload-Length` e i metadati in base64 tramite `Upload-Metadata`. Il server crea un file segnaposto vuoto in una directory temporanea nascosta `.tus-uploads/` e restituisce l'URL di caricamento.
2. **Verifica dello stato di avanzamento (`HEAD`)**: Se un caricamento viene interrotto, il client interroga l'URL di caricamento con una richiesta `HEAD`. Il server restituisce la posizione corrente in byte nell'header `Upload-Offset`.
3. **Aggiunta di dati (`PATCH`)**: Il client riprende l'invio dei dati binari a partire dall'offset restituito con `Content-Type: application/offset+octet-stream`. Il server scrive i blocchi in arrivo direttamente nel file temporaneo utilizzando le API di basso livello del filesystem di Node `open` e `write` all'offset di byte specificato.
4. **Finalizzazione**: Quando l'`Upload-Offset` accumulato corrisponde all'`Upload-Length` dichiarato, Rebase legge il file temporaneo completato, lo incapsula in un oggetto `File` standard di JavaScript e lo salva nel backend di storage configurato (disco locale o S3). Il file temporaneo viene quindi eliminato.
5. **Pulizia periodica**: Un processo di pulizia in background viene eseguito ogni **60 secondi** per eliminare i caricamenti temporanei orfani e incompleti che hanno superato la soglia di conservazione di **24 ore**.

## Variabili d'Ambiente

| Variabile | Descrizione |
|-----------|-------------|
| `STORAGE_TYPE` | `"local"`, `"s3"` o `"gcs"` |
| `STORAGE_PATH` | Directory di storage locale (predefinito: `./uploads`) |
| `S3_BUCKET` | Nome del bucket S3 |
| `S3_REGION` | Regione AWS (predefinita: `"auto"`) |
| `S3_ACCESS_KEY_ID` | Access key AWS |
| `S3_SECRET_ACCESS_KEY` | Secret key AWS |
| `S3_ENDPOINT` | Endpoint S3 personalizzato (per MinIO, R2) |
| `S3_FORCE_PATH_STYLE` | Usa URL in path-style (richiesto per MinIO) |
| `GCS_BUCKET` | Nome del bucket Google Cloud Storage |
| `GCS_PROJECT_ID` | ID progetto GCP per GCS |
| `GCS_KEY_FILENAME` | Percorso di un file di chiavi di un service account GCP (omettere su GKE — Workload Identity/ADC fornisce le credenziali) |
| `GOOGLE_APPLICATION_CREDENTIALS` | Variabile ADC standard, letta direttamente dall'SDK Google (non necessaria su GCP con credenziali predefinite) |
| `FORCE_LOCAL_STORAGE` | Consente `STORAGE_TYPE=local` in produzione — vedi sotto |
| `STORAGE_PUBLIC_READ` | Serve gli oggetti archiviati a lettori non autenticati. Versione per variabili d'ambiente di `storagePublicRead`, e uno dei tre modi per soddisfare il [guard di avvio in produzione](#autorizzazione-per-oggetto). |
| `STORAGE_ALLOW_ANY_AUTHENTICATED` | Disattiva il guard di avvio, ripristinando il comportamento in cui qualsiasi utente autenticato può leggere, sovrascrivere, eliminare o elencare qualsiasi chiave. Versione per variabili d'ambiente di `storageInsecureAllowAnyAuthenticated`. Giustificabile solo se ogni utente autenticato è ritenuto affidabile per qualsiasi file. |

## Più Bucket

Un progetto può avere più di un bucket. Dichiarane ciascuno in `config/resources.ts`
— l'unico punto letto dalla piattaforma, dal runtime e dalla console:

```ts
import { bucket } from "@rebasepro/types";

export const uploads = bucket({ engine: "s3" });    // the default one
export const media = bucket("media", { engine: "s3", label: "Media" });
```

Esegui quindi `rebase resources --write`, che rigenera `rebase.resources.json`
in modo che un host possa leggere la tua topologia senza dover eseguire una build. Consulta
[Sorgenti Multiple](/docs/backend/multiple-sources) per database, bucket e
topic insieme.

Ciascuna sorgente viene configurata tramite i **medesimi nomi di variabile provvisti del proprio
suffisso**. La sorgente predefinita non richiede alcun suffisso, pertanto un progetto a singolo bucket
continua a utilizzare i nomi semplici sopra indicati e non necessita di alcuna dichiarazione aggiuntiva:

```bash
S3_BUCKET=app-uploads             # (default)
S3_BUCKET__MEDIA=app-media        # media
S3_ACCESS_KEY_ID__MEDIA=…
S3_SECRET_ACCESS_KEY__MEDIA=…
```

Il suffisso è ricavato dalla chiave: convertita in maiuscolo, caratteri non alfanumerici
trasformati in trattini bassi, preceduta da un **doppio** trattino basso (`media-cdn` → `__MEDIA_CDN`). Un
singolo trattino basso entrerebbe in collisione con nomi di variabile reali — `S3_BUCKET_NAME`
verrebbe interpretato come bucket `name`.

Indirizza una proprietà a una sorgente con `storageSource`:

```ts
{
    name: "Cover",
    dataType: "string",
    storage: { storageSource: "media", acceptedFiles: ["image/*"] }
}
```

Una sorgente dichiarata ma mai configurata viene **ignorata**, senza conseguenze fatali:
i caricamenti indirizzati verso di essa rispondono con `501 STORAGE_NOT_CONFIGURED`. La dichiarazione
di un bucket avviene solitamente prima che vi venga collegato uno storage, e un errore di
avvio in questo caso provocherebbe un crash-loop del backend. Una sorgente configurata in modo
*errato* tramite variabili d'ambiente — un tipo senza bucket o un bucket senza credenziali — viene
invece rifiutata all'avvio, trattandosi di un errore piuttosto che di una semplice assenza.

### Bucket che condividono un unico account

Le credenziali descrivono solitamente il **provider**, non il bucket. Quindici bucket su
una singola installazione di MinIO significherebbero altrimenti quindici copie della stessa
access key, e una rotazione richiederebbe quindici modifiche correlate. È possibile invece
assegnare un nome a un account:

```ts
export const media = bucket("media", { engine: "s3", account: "minio" });
export const avatars = bucket("avatars", { engine: "s3", account: "minio" });
```

```bash
S3_BUCKET__MEDIA=b-media          # per bucket, always
S3_BUCKET__AVATARS=b-avatars
S3_ACCESS_KEY_ID__MINIO=…         # shared by both
S3_SECRET_ACCESS_KEY__MINIO=…
S3_ENDPOINT__MINIO=https://minio.internal
```

Solo le variabili con ambito account (account-scoped) effettuano il fallback — `S3_ACCESS_KEY_ID`,
`S3_SECRET_ACCESS_KEY`, `S3_ENDPOINT`, `S3_REGION`, `S3_FORCE_PATH_STYLE` e
la coppia GCS `GCS_PROJECT_ID` / `GCS_KEY_FILENAME`. Il nome del bucket non lo fa mai:
è ciò che distingue una sorgente dall'altra. Un valore specificato per singolo bucket ha
comunque la precedenza, consentendo a una sorgente di cambiare provider senza interrompere le altre.

## Sorgenti di Storage per il Frontend

Quando si utilizzano più backend di storage, passa `storageSources` al provider `<Rebase>` in modo che il frontend sappia come instradare direttamente i caricamenti:

```tsx
import { Rebase } from "@rebasepro/app";

<Rebase
    apiUrl="https://api.example.com"
    storageSources={[
        // `engine` names the provider, `transport` says who talks to it:
        // "server" proxies through the Rebase backend, "direct" goes
        // client-to-provider (and needs a `source` implementation).
        { key: "media", engine: "s3", transport: "server", label: "Media CDN" },
        { key: "firebase", engine: "firebase", transport: "server", label: "Firebase Storage" },
    ]}
>
    {() => <MyApp />}
</Rebase>
```

La `key` di ciascuna sorgente deve corrispondere a una chiave backend registrata nella mappa `storage` del server. Il contesto React `StorageSourcesContext` risolve la sorgente attiva per ciascun campo di caricamento.

## Caching e CDN

Ogni oggetto viene veicolato tramite proxy attraverso il server anziché reindirizzato a un
URL firmato — un URL firmato genera errori in caso di contenuti misti (una pagina HTTPS, un MinIO
su HTTP) e su endpoint raggiungibili esclusivamente all'interno del cluster. Di conseguenza, sono
gli header di risposta a rendere possibile il funzionamento della cache.

Ciascuna risposta include un `ETag` debole e `Last-Modified`, ricavati dalla dimensione
dell'oggetto e dall'orario di modifica. Un client che possiede già l'oggetto invia
`If-None-Match` e riceve un **304 senza corpo**, per cui un caricamento ripetuto
comporta solo un round trip anziché un trasferimento.

`Cache-Control` dipende da chi è autorizzato a leggere l'oggetto:

| Oggetto | Header |
|---|---|
| Sotto il prefisso `public/`, o `publicRead: true` | `public, max-age=60, stale-while-revalidate=86400, must-revalidate` |
| Qualsiasi altra cosa | `private, max-age=60, must-revalidate` |
| Trasformazioni di immagini | lo stesso, con `max-age=3600` |

`private` è intenzionale: un oggetto per il cui recupero sono state necessarie credenziali
non deve essere memorizzato da una cache condivisa, altrimenti una CDN potrebbe consegnare
il file di un utente a quello successivo. `Vary: Authorization` viene inviato per lo stesso motivo.

Nulla viene mai contrassegnato come `immutable`. Una chiave di storage può essere
sovrascritta — la scrittura su una chiave esistente è un'operazione comune — quindi la
promessa di non effettuare mai una riconvalida renderebbe invisibile un file sostituito
fino alla scadenza dell'intervallo temporale.

### Seeking in audio e video

Ogni risposta di un oggetto include `Accept-Ranges: bytes`, e a una richiesta `Range`
si risponde con `206 Partial Content` e un `Content-Range`. Senza di questo, un browser
non consentirà il seeking in un elemento multimediale servito da qui — e Safari rifiuta
di riprodurre un tag `<video>` la cui prima risposta non sia un `206` — perciò per i media
questa è la differenza tra un player funzionante e uno non funzionante.

- Un singolo intervallo per richiesta: `bytes=0-499`, `bytes=500-`, `bytes=-500`. Questo è ciò
  che i browser inviano per la riproduzione.
- A intervalli multipli in un singolo header si risponde con l'intero oggetto e un `200`,
  operazione sempre valida. Nessun client rilevante ne invia.
- Un intervallo che inizia oltre la fine riceve un `416` con `Content-Range: bytes */<size>`,
  e non una risposta silenziosa con l'intero file.
- La riconvalida ha la priorità su un range: una richiesta contenente sia `If-None-Match` sia
  `Range` riceve un `304`.

Nello storage locale viene letta da disco solo la porzione richiesta. Su S3 e GCS l'oggetto
viene comunque recuperato per intero — un `StorageController` non dispone di lettura a
intervalli — pertanto il risparmio riguarda la risposta, non l'upstream.

### Inserire una CDN davanti

Poiché gli oggetti pubblici sono `public` con una finestra di `stale-while-revalidate` e un
validatore, qualsiasi normale reverse proxy o CDN può memorizzarli nella cache senza configurazioni
aggiuntive. È sufficiente puntarlo all'origine dell'API e lasciare che rispetti gli header.

Due aspetti da configurare direttamente sulla CDN:

- **Rispettare `Vary: Authorization`**, oppure non inserire affatto in cache le rotte autenticate.
  Una CDN che ignora `Vary` e mette in cache risposte `private` rappresenta l'errore per cui questo
  header è stato creato.
- **Aspettarsi la riconvalida.** Il breve `max-age` fa sì che la CDN ripeta la richiesta
  regolarmente; tali richieste sono leggeri 304, ed è proprio questo a evitare che un oggetto
  sovrascritto venga servito obsoleto.

## Consigli per la Produzione

:::caution
**In produzione, `type: "local"` disabilita l'archiviazione dei file anziché utilizzarla.** Su una piattaforma effimera (Cloud Run, Heroku, un pod Kubernetes) il filesystem viene cancellato a ogni deploy, riavvio o eviction — pertanto i caricamenti andrebbero a buon fine, verrebbero letti correttamente, ma svanirebbero al successivo rollout, senza generare alcun errore in nessun momento.

Di conseguenza non viene registrato alcun backend di storage e `/api/storage/*` risponde con **`501 STORAGE_NOT_CONFIGURED`**. I caricamenti falliscono in modo esplicito e recuperabile; il resto dell'applicazione continua a funzionare. L'archiviazione dei file richiede un'abilitazione esplicita in produzione: esiste solo nel momento in cui è presente un bucket.

Imposta `STORAGE_TYPE=s3` o `gcs`. Se è effettivamente montato un **volume permanente** su `STORAGE_PATH`, imposta `FORCE_LOCAL_STORAGE=true` per specificarlo esplicitamente.
:::

- Monta un **volume persistente** se utilizzi lo storage locale su Docker/Kubernetes, e imposta `FORCE_LOCAL_STORAGE=true`
- Utilizza **S3** o compatibili (R2, MinIO), oppure **GCS**, per i deployment in produzione
- Configura una **CDN** (CloudFront, Cloudflare) davanti al tuo bucket per migliorare le prestazioni
- **Qualsiasi applicazione con storage in produzione deve dichiarare un modello di accesso** — vedi sotto.
  Non solo quelle multi-tenant: il server *rifiuterà di avviarsi* senza di esso.

## Autorizzazione per Oggetto

### Policy

La forma dichiarativa. Un elenco di pattern di percorso, letti senza eseguire nulla:

```ts
storagePolicies: [
    { path: "public/**", operations: ["read"], allow: "public" },
    { path: "users/:uid/**", allow: ({ params, user }) => user?.uid === params.uid }
]
```

**Una chiave che non corrisponde ad alcuna policy viene rifiutata.** Ogni estensione
dei permessi è una riga esplicita, e un errore nega l'accesso anziché concederlo.

I pattern effettuano il match **per segmento, mai per sottostringa** — `public/**` non
corrisponde a `publicity/secret.png`:

| Pattern | Corrispondenza |
|---|---|
| `avatars/logo.png` | quella chiave esattamente |
| `users/*/avatar.png` | esattamente un segmento dove si trova `*` |
| `users/:uid/**` | un segmento catturato, poi il resto — compreso il vuoto |

`**` è valido solo come segmento finale. `:name` cattura un segmento e non oltrepassa mai
uno `/`; le catture arrivano come `params` nel predicato.

`allow` può essere `"public"` (chiunque), `"authenticated"` (qualsiasi chiamante con uno uid),
oppure un predicato che riceve i parametri catturati, l'utente, l'operazione e il bucket.
`operations` assume come valore predefinito tutte e quattro le operazioni — `read`, `write`, `delete`, `list`.

Le policy soddisfano autonomamente il boot guard di produzione, e un pattern non valido
fa fallire l'avvio anziché il primo caricamento.

### L'hook

`requireAuth` e `publicRead` sono switch *globali*: determinano se un chiamante debba essere
autenticato, non cosa tale chiamante possa toccare. Senza un hook di autorizzazione, **qualsiasi utente
autenticato può leggere qualsiasi chiave di cui conosca il nome** — l'unica cosa che separa i file
di due tenant è l'impossibilità di indovinare le chiavi, che non costituisce un modello di controllo
accessi. Peggio ancora, possono prima eseguire `GET /storage/list?prefix=`, quindi le chiavi non
devono nemmeno essere indovinate.

:::caution[Lo storage non si avvierà in produzione senza di esso]
Le collezioni sono protette dalla row-level security; lo storage no. Non esiste un
equivalente per-oggetto nel bucket, pertanto questo hook *è* il modello — e
`initializeRebaseBackend` **genera un'eccezione all'avvio** con `NODE_ENV=production` quando
lo storage è configurato e nessuno di questi elementi è impostato:

- `storageAuthorize` — un hook per singolo oggetto. Consigliato.
- `storagePublicRead: true` — il bucket è a tutti gli effetti una CDN pubblica in sola lettura.
- `storageInsecureAllowAnyAuthenticated: true` — un'app single-tenant in cui ogni
  utente autenticato è considerato affidabile per ogni file. Denominato appositamente per invitare a rileggerlo con cautela.

In ambiente di sviluppo registra invece un avviso, quindi un progetto può essere configurato
male sotto questo aspetto e funzionare correttamente in locale fino al momento del deployment.
Un progetto generato tramite scaffolding include già un hook in `config/storage.ts` — leggilo prima
di sostituirlo e tieni presente che modella una *libreria di contenuti condivisa* tipica di un CMS,
che non ha la stessa struttura dei file per singolo utente.
:::

`storageAuthorize` è l'analogo per lo storage delle regole di sicurezza di una collezione, ed viene eseguito dopo l'autenticazione su ciascuna rotta di storage:

```typescript no-verify
await initializeRebaseBackend({
    storage: { type: "s3", bucket: "app-files", /* ... */ },
    storageAuthorize: async ({ key, bucket, operation, user }) => {
        if (!user) return false;
        // Keys are laid out as `{teamId}/{docId}/...`
        const [teamId] = key.split("/");
        return isTeamMember(user.uid, teamId);
    }
});
```

| Campo | Descrizione |
|-------|-------------|
| `key` | Chiave dell'oggetto, senza prefisso del bucket e ripulita da directory traversal |
| `bucket` | Bucket risolto (`"default"` se non specificato) |
| `operation` | `"read"`, `"write"`, `"delete"` o `"list"` |
| `user` | `{ uid, email?, roles? }`, oppure `null` dove la rotta consente l'accesso anonimo |
| `storageId` | Il backend con nome, quando la richiesta ne ha preso di mira uno |
| `data` | Accesso in lettura affidabile che **ignora l'RLS** — `data.collection(slug).find(query)` / `.findById(id)`. La proprietà risiede in una riga, non nel prefisso di una chiave, quindi l'hook necessita di un lettore per rispondere a "chi possiede questo oggetto?". Ignora deliberatamente la row-level security: questo hook *è* la decisione di autorizzazione, e prenderla attraverso un lettore già limitato dai permessi del chiamante stesso risulterebbe circolare. In sola lettura per progettazione. |

Restituisci `false` per negare l'accesso con un **403**. Anche il sollevamento di un'eccezione
(throw) nega l'accesso — un controllo di proprietà fallito non lascia la porta aperta.

Da sapere:

- **La rotta dei metadati è il punto in cui viene realmente decisa l'autorizzazione di lettura.** È qui che viene generato il token di download temporaneo associato al percorso di cui la rotta del file si fida, perciò l'hook ne regola l'accesso in questo punto. Le richieste che dispongono già di tale token o che raggiungono un percorso pubblico dichiarato ignorano l'hook — il token è stato emesso sotto di esso ed è valido esclusivamente per il proprio percorso.
- **`list` è regolato in base al prefisso.** L'elenco è il modo in cui si scoprono chiavi di cui nessuno ti ha parlato.
- **I caricamenti ripristinabili (TUS) vengono regolati al momento della creazione**, evitando che un caricamento negato lasci file temporanei residui.
- L'omissione dell'hook mantiene il comportamento precedente, non impattando le app single-tenant.

## Reagire a un Caricamento

In Rebase è possibile reagire a qualsiasi altra scrittura — una riga dispone di `beforeSave` e
`afterSave`, una pianificazione ha un cron job — mentre per un caricamento non c'era nulla.
Qualsiasi azione derivante da un caricamento doveva essere eseguita dal client, con una seconda
chiamata, il che significa che non veniva eseguita affatto se il client si disconnetteva nel frattempo.

```ts
storageTriggers: [
    {
        path: "uploads/:uid/**",
        events: ["finalize"],
        handler: async ({ key, params, size, user }) => {
            await jobs.enqueue("index-upload", { key, uid: params.uid, size });
        }
    }
]
```

La sintassi dei pattern è la stessa di `storagePolicies` — segmenti letterali, `*`
per un segmento, `:name` per catturarne uno, `**` per il resto — e un pattern malformato
causa il fallimento dell'avvio anziché non corrispondere silenziosamente a nulla.

| Evento | Quando |
| --- | --- |
| `finalize` | dopo che l'oggetto è stato scritto in modo persistente; mai per una scrittura fallita |
| `delete` | dopo che l'oggetto è stato rimosso |

`finalize` si attiva sia per i percorsi multipart sia per quelli ripristinabili (TUS) — una
volta per caricamento, non una volta per blocco — e un caricamento ripristinabile riporta l'utente
che lo ha *creato*, poiché è il principal verificato durante l'autorizzazione.

Cosa un handler non deve presumere:

- **Un handler che solleva un'eccezione non fa fallire la richiesta.** L'oggetto è già stato
  archiviato nel momento in cui l'handler viene eseguito, pertanto rispondere al client con un
  errore indicherebbe che il caricamento è fallito quando in realtà non è così, e i client
  ritentano i caricamenti. Gli errori vengono registrati nei log e la risposta rimane invariata.
  Se il lavoro deve essere necessariamente completato, accoda un job.
- **Gli handler vengono attesi (`await`)**, nell'ordine di dichiarazione, prima dell'invio della
  risposta — eseguire operazioni in modalità 'fire and forget' lascerebbe una promise che un runtime
  serverless è libero di congelare a metà esecuzione. Un handler lento rende pertanto lento il
  caricamento, ed è questo l'altro motivo per accodare un job anziché eseguire il lavoro qui.
- **Le scritture interne non attivano i trigger.** La cache delle rendition di immagini scrive gli
  oggetti derivati direttamente nel controller di storage; un trigger `**` che scattasse su di essi
  si attiverebbe sul proprio stesso output.

## Passaggi Successivi

- **[Storage frontend e caricamento file](/docs/frontend/storage)** — Campi e hook per il caricamento di file
- **[Proprietà](/docs/collections/properties)** — Configurazione delle proprietà di storage
