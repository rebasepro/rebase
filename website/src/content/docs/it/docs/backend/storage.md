---
sourceHash: 5be4e3768bac692e
title: Configurazione dello storage
sidebar_label: Configurazione dello storage
description: Configura backend di storage per filesystem locale, compatibili con S3 o GCS/Firebase Storage per il caricamento di file, immagini e contenuti multimediali.
---

## Panoramica

Rebase supporta tre backend di storage:

- **Filesystem locale** — File archiviati su disco (ideale per lo sviluppo)
- **Compatibile con S3** — AWS S3, MinIO, Cloudflare R2, DigitalOcean Spaces
- **Google Cloud Storage / Firebase Storage** — Supporto nativo per GCS tramite `@google-cloud/storage`

## Configurazione

:::note[Dove va inserito]
**Runtime gestito** — le variabili `STORAGE_*` in `.env` (`STORAGE_TYPE`, `STORAGE_BUCKET` o `S3_BUCKET` / `GCS_BUCKET`, `STORAGE_PATH`, `STORAGE_PUBLIC_READ`, … — aggiungi a ciascuna di esse il suffisso `__<KEY>` per una sorgente con nome), più una dichiarazione `bucket("<key>")` in `config/resources.ts` per ogni bucket oltre a quello predefinito, ed `export const storageAuthorize` da `config/index.ts`. `storageAuthorize` non ha intenzionalmente una forma basata su variabili d'ambiente: nessuna variabile può esprimere "questo utente può leggere questa chiave".

**Ejected** — il blocco `storage` in `initializeRebaseBackend({ … })`. `storagePolicies` e `storageTriggers` sono disponibili solo in modalità ejected.

La mappa completa si trova in [Panoramica del backend](/docs/backend/#where-each-option-lives).
:::

Lo storage viene configurato nel blocco `storage` di `initializeRebaseBackend`:

### Storage locale

```typescript no-verify
const backend = await initializeRebaseBackend({
    // ...
    storage: {
        type: "local",
        basePath: "./uploads"   // Directory for file storage
    }
});
```

Lo storage locale conserva i metadati di ogni oggetto accanto ad esso, come `<key>.metadata.json`, quindi una chiave il cui ultimo segmento termina con `.metadata.json` viene rifiutata con `400 INVALID_STORAGE_KEY` su ogni route. S3 e GCS mantengono i metadati sull'oggetto e archiviano qualsiasi chiave. Su un file system senza distinzione tra maiuscole e minuscole (case-insensitive, come macOS e Windows per impostazione predefinita), `Avatar.png` e `avatar.png` rappresentano un unico file locale ma due oggetti distinti su S3, GCS o su un disco Linux; pertanto, il server genera un avviso all'avvio se la cartella di storage si trova su uno di essi.

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

### GCS / Firebase Storage

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

Su GCP (Cloud Run, GCE, GKE), le credenziali del service account predefinito vengono utilizzate automaticamente. Al di fuori di GCP, imposta la variabile d'ambiente `GOOGLE_APPLICATION_CREDENTIALS` sul percorso del file della chiave del tuo service account.

### Backend di storage multipli

È possibile configurare più backend con nome e indirizzare campi diversi verso storage differenti:

```typescript
storage: {
    "(default)": { type: "local", basePath: "./uploads" },
    "media": { type: "s3", bucket: "media-bucket", region: "us-east-1", ... }
}
```

Successivamente, nelle proprietà della tua collection, fai riferimento a uno specifico backend:

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

## Endpoint di storage

| Metodo | Percorso | Descrizione |
|--------|------|-------------|
| `POST` | `/api/storage/upload` | Caricamento diretto di file |
| `POST` | `/api/storage/upload?storageId=<key>` | Caricamento su uno specifico backend con nome |
| `GET` | `/api/storage/file/*` | Recupera un file — tutto ciò che segue `/file/` è la chiave dell'oggetto |
| `GET` | `/api/storage/file/*?storageId=<key>` | Recupera un file da uno specifico backend |
| `GET` | `/api/storage/metadata/*` | Dimensioni, tipo di contenuto e metadati personalizzati di un oggetto, senza i relativi byte, più un token di download di breve durata quando è privato |
| `POST` | `/api/storage/metadata` | <span class="since-badge" data-since="0.25">Da 0.25</span> Lo stesso per un massimo di 100 oggetti di una sorgente: body `{ keys, storageId? }` |
| `DELETE` | `/api/storage/file/*` | Elimina un file |
| `GET` | `/api/storage/list` | Elenca gli oggetti sotto un prefisso (`prefix`, `bucket`, `maxResults`, `pageToken`, `storageId`). Un `maxResults` inferiore a 1, o un `pageToken` mai emesso dalla sorgente, restituisce `400 INVALID_LIST_OPTIONS` |
| `POST` | `/api/storage/folder` | Crea un marcatore di cartella vuota |
| `GET` | `/api/storage/sources` | Le sorgenti di storage servite da questo backend, per chiave |
| `OPTIONS` | `/api/storage/tus` | Interroga le funzionalità supportate del protocollo TUS |
| `POST` | `/api/storage/tus` | Avvia una sessione di caricamento ripristinabile (resumable) TUS |
| `HEAD` | `/api/storage/tus/:id` | Verifica l'avanzamento del caricamento (offset dei byte) |
| `PATCH` | `/api/storage/tus/:id` | Aggiunge un chunk di dati al file temporaneo |
| `DELETE` | `/api/storage/tus/:id` | Termina/interrompe la sessione di caricamento TUS |

**Cosa restituiscono.** Un unico envelope, lo stesso utilizzato da `/api/data`: il payload si trova sotto `data`, e un errore corrisponde a `{ "error": { message, code, requestId } }` con i codici presenti nel [riferimento degli errori](/docs/backend/errors/). `/api/storage/file/*` rappresenta un'eccezione, poiché il suo payload è il file stesso: restituisce i byte, insieme a `Content-Type`, `Content-Length` e agli header di caching.

```json
// GET /api/storage/list?prefix=products/images/
{ "data": { "items": [ { "bucket": "default", "fullPath": "products/images/a.jpg", "name": "a.jpg",
  "size": 48213, "updated": "2026-10-01T12:00:00.000Z", "contentType": "image/jpeg" } ], "prefixes": [] } }
```

<span class="since-badge" data-since="0.25">Da 0.25</span> Un elenco descrive ciascun file restituito: la sua dimensione `size` in byte e `updated`, data dell'ultima scrittura, su storage locale, S3 e GCS, e il suo `contentType` su storage locale e GCS. Un elenco S3 non include il tipo, quindi su S3 questo campo è assente e `/api/storage/metadata/*` continua a fornirlo. Una cartella in `prefixes` non include nessuno di questi valori, così come un `StorageController` personalizzato che non li imposta.

`POST /api/storage/upload` restituisce `201` con l'oggetto `{ key, bucket, storageUrl }` memorizzato sotto `data`; `GET /api/storage/metadata/*` restituisce i metadati dell'oggetto e, per un oggetto privato, il `token` di breve durata; `POST /api/storage/metadata` restituisce un oggetto indicizzato per i percorsi inviati, ciascuno contenente ciò che avrebbe restituito la `GET` per esso (vedi sotto). Una cartella non è un oggetto: chiamare `/metadata` su una chiave che termina con `/` restituisce `404` su ogni storage, anche laddove S3 o GCS mantengono un marcatore `folder/`, quindi non viene generato alcun token di download per un prefisso; `GET /api/storage/sources` restituisce l'array delle sorgenti configurate, con `configured: true`. Su un deployment senza alcuno storage configurato, restituisce `200 {"data": [], "configured": false}`, mentre ogni altra route restituisce `501 STORAGE_NOT_CONFIGURED`. `GET /api/auth/config` riporta lo stesso fatto con `storage: false`, in modo che un client possa evitare di richiederlo. `GET /api/storage/sources` è pubblico: risponde senza token anche quando `requireAuth` è attivo. Riporta le sorgenti (chiave, motore, trasporto ed etichetta) e mai un file, e l'SDK client lo legge per collegare le proprie sorgenti, il che può avvenire prima che chiunque abbia effettuato l'accesso. Anche un'app che legge una sorgente `direct` in modo anonimo ne ha bisogno. Ogni route che elenca, legge o scrive un file mantiene la propria autenticazione. `DELETE /api/storage/file/*` e `POST /api/storage/folder` contengono solo un `message`, poiché non c'è nulla da restituire.

Su S3 e GCS, un `bucket` deve essere tra quelli serviti dalla sorgente, sia in scrittura che in lettura: un caricamento, un `POST /api/storage/folder` o un caricamento TUS che specifichi qualsiasi altro bucket restituisce `404 UNKNOWN_STORAGE_SOURCE`, così come l'elenco. Lo storage locale continua a creare un bucket alla prima scrittura.

**Molti oggetti contemporaneamente.** <span class="since-badge" data-since="0.25">Da 0.25</span> `POST /api/storage/metadata` accetta `{ "keys": ["photos/a.png", "photos/b.png"], "storageId": "media" }` — fino a 100 percorsi di oggetti di una sorgente, ciascuno formattato come farebbe `GET /api/storage/metadata/<key>` — e restituisce una voce per chiave:

```json
{ "data": {
  "photos/a.png": { "fullPath": "photos/a.png", "size": 48213, "contentType": "image/png", "token": "…", "tokenExpiresIn": 300 },
  "photos/b.png": { "error": { "code": "FORBIDDEN", "message": "Not authorized for this object", "status": 403 } }
} }
```

Ciascuna chiave viene valutata esattamente come farebbe la `GET` — con lo stesso hook `storageAuthorize` e scope di storage, la stessa regola pubblica, un proprio token di download — e una chiave rifiutata, mancante o non valida restituisce il proprio `error` senza fallire o esporre le altre. Un chiamante senza sessione in un deployment che ne richiede una riceve il `401` che la `GET` avrebbe restituito, a meno che tutte le chiavi non siano pubbliche. Più di 100 chiavi, o un body privo di `keys`, restituisce `400 BAD_REQUEST`. Il rate limiter conteggia la richiesta come ⌈N/10⌉ richieste per N chiavi, quindi una pagina di 100 miniature costa 10. `client.storage.getSignedUrl()` e il pannello di amministrazione inviano in questo modo le ricerche aggregate effettuate da una pagina, ricorrendo a una `GET` per file sui server privi della route.

**Come viene autorizzata la lettura di un file.** Le route di lettura — `/api/storage/file/*` e `/api/storage/metadata/*` — accettano il token firmato di breve durata generato da [`getSignedUrl()`](/docs/sdk/storage), passato come `?token=<token>` o come `Bearer`. Un normale JWT di accesso viene **rifiutato** su `/file/*` con `401 Unauthorized: Access JWT not allowed on file routes`: il token che funziona su ogni altra route non funziona lì, di proposito, perché l'URL di un file è qualcosa che viene fornito a un browser, a una CDN o a un tag `<img>`. Tutte le altre route sopra indicate accettano il JWT di accesso come di consueto.

## Trasformazioni di immagini al volo

Rebase include una pipeline integrata di elaborazione delle immagini basata su **Sharp**. Quando si distribuiscono risorse grafiche dallo storage, è possibile applicare operazioni dinamiche utilizzando parametri di query:

```bash
# Serve image scaled to 300px width in webp format
GET /api/storage/file/products/laptop.jpg?width=300&format=webp
```

### Parametri supportati

- `width`, `height`: Limiti di ridimensionamento, da `1` a `4096` (l'immagine non viene mai ingrandita).
- `quality`: Da `1` a `100`.
- `format`: Converte il formato dell'immagine. Formati supportati: `webp`, `jpeg`, `png`, `avif`.
- `fit`: `cover`, `contain`, `fill`, `inside` o `outside`.

Un parametro al di fuori di questi limiti restituisce un **400**, non un valore limitato silenziosamente (clamp) — in precedenza `?width=99999` restituiva un'immagine da 4096px e `?format=tiff` un'immagine in formato webp, senza alcun avviso.

Le miniature delle immagini archiviate nel pannello di amministrazione utilizzano questo endpoint: l'anteprima di una tabella o di una scheda richiede una versione in formato webp di dimensioni pari a circa il doppio della dimensione renderizzata (96–800px) invece dell'originale. `sharp` è una dipendenza opzionale; in sua assenza la trasformazione risponde con 500, quindi il pannello effettua una verifica a ogni caricamento della pagina con una singola richiesta di rendering, mostrando gli originali se il server non è in grado di ridimensionarli. I file SVG e GIF vengono sempre mostrati così come sono.

### Prestazioni e caching LRU

La trasformazione richiede un uso intensivo di CPU e memoria e, per gli oggetti pubblici, l'endpoint è raggiungibile in modo anonimo; pertanto, il carico di lavoro viene delimitato oltre che memorizzato nella cache:
- **Capacità**: una cache LRU con un limite massimo di **500 voci** a livello globale, indicizzata per sorgente di storage, bucket e chiave canonica.
- **TTL (Time to Live)**: Le varianti in cache scadono dopo **1 ora**.
- Richieste simultanee per la stessa variante non presente in cache generano **una sola** trasformazione, non una per ciascuna richiesta.
- Viene eseguito un numero limitato di trasformazioni contemporaneamente; oltre una determinata coda di attesa, il server risponde con **503 `TRANSFORM_OVERLOADED`** invece di accettare elaborazioni che non riuscirebbe a gestire.

Questa cache risiede nel processo, il che significa che non è condivisa tra istanze e non sopravvive a un riavvio. Due repliche calcolano ciascuna ogni variante, e un nuovo deployment cancella tutto.

### Versioni renderizzate che sopravvivono a un riavvio

`storageRenditionCache` riscrive ciascuna immagine derivata nello stesso bucket della sorgente, in modo che l'elaborazione venga eseguita una sola volta per l'intero deployment anziché una volta per istanza a ogni release:

```ts
storageRenditionCache: { enabled: true }
```

oppure `STORAGE_RENDITION_CACHE=true` per un deployment in bundle. Le versioni renderizzate vengono archiviate sotto il prefisso riservato `_rebase/renditions/`, indicizzate in base alla versione dell'oggetto sorgente — quindi la sostituzione di un'immagine rende immediatamente disponibile la nuova versione.

Tre aspetti da considerare prima di abilitarlo:

- **Una lettura ora scrive.** Ogni nuova variante comporta una `PUT` nel tuo bucket. Per questa ragione è disabilitato per impostazione predefinita.
- **Una scrittura non riuscita non equivale a una richiesta non riuscita.** Credenziali di sola lettura o una policy del bucket che rifiuta il prefisso causano un degrado alla cache interna al processo; l'immagine viene comunque servita e il motivo viene registrato nei log una sola volta.
- **Le versioni sostituite non vengono eliminate automaticamente.** La sostituzione di un oggetto sorgente abbandona le sue vecchie versioni generate. Configura una regola di ciclo di vita (lifecycle rule) su `_rebase/renditions/` — questo prefisso è fisso e non configurabile proprio per consentire a una regola di farvi riferimento.

Il prefisso non è accessibile direttamente tramite l'API. Leggerlo o scriverlo direttamente risponde con **400 `INVALID_STORAGE_KEY`**: ogni regola di accesso nel prodotto — sia `storageAuthorize` che le policy dichiarative — è scritta rispetto alla chiave *sorgente*, e una versione renderizzata servita tramite il proprio percorso risponderebbe a una richiesta non prevista.

### Cosa viene servito

Il content type memorizzato corrisponde a quello dichiarato da chi carica il file — non viene effettuato alcuno sniffing dei byte — quindi `/api/storage/file/*` effettuerà il rendering inline solo per una **allowlist limitata**: immagini, video, audio, `application/pdf` e `text/plain`. Qualsiasi altra cosa, incluso `text/html`, viene servita come `application/octet-stream` con `Content-Disposition: attachment`, e ogni risposta include `X-Content-Type-Options: nosniff`. Lo storage non è un web host: una pagina caricata e renderizzata sull'origine dell'API potrebbe leggere i cookie di quell'origine e chiamarne gli endpoint.

Un SVG è un'immagine che funge anche da documento e può contenere tag `<script>`. Viene servito come `image/svg+xml` — in modo da essere renderizzato in un tag `<img>` e nelle miniature del pannello di amministrazione — con `Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline'; sandbox` su ogni risposta, inclusi gli URL trasformati e quelli con token di download. Se aperto direttamente, viene renderizzato con gli script disabilitati e un'origine opaca, impedendogli di accedere ai cookie o agli endpoint dell'API.

## Limiti di dimensione dei file

Ciascuna sorgente di storage accetta file fino al proprio limite: **50 MB**, a meno che `STORAGE_MAX_FILE_SIZE` (in byte, con suffisso `__<KEY>` per una sorgente con nome) o il valore `maxFileSize` della sorgente non indichino diversamente. Ogni punto di accesso applica lo stesso limite. `POST /api/storage/upload` risponde con `413 PAYLOAD_TOO_LARGE` oltre tale valore; un caricamento ripristinabile viene rifiutato al momento della creazione, prima del suo primo chunk; e `OPTIONS /api/storage/tus` lo notifica come `Tus-Max-Size` — per la sorgente specificata da `?storageId=`, o per quella predefinita in caso contrario.

Per quanto riguarda `STORAGE_MAX_FILE_SIZE`: sulla versione 0.23 solo `maxFileSize` della sorgente definisce il limite, e la variabile non viene letta.

```bash
STORAGE_MAX_FILE_SIZE=209715200          # (default): 200 MB
STORAGE_MAX_FILE_SIZE__MEDIA=1073741824  # media: 1 GB
```

La quantità di file che il server gestisce contemporaneamente in memoria dipende dal punto di accesso. `POST /api/storage/upload` è un corpo multipart singolo, che il server analizza per intero: da tre a cinque volte la dimensione del file nella sua memoria. Un caricamento ripristinabile (TUS) gestisce un chunk alla volta. <span class="since-badge" data-since="0.25">Da 0.25</span> `client.storage.putObject()` e il pannello di amministrazione inviano i file superiori a 8 MiB in modalità ripristinabile. Consulta [Caricamenti ripristinabili (TUS)](/docs/backend/storage-resumable-uploads/) per i dettagli sul protocollo, sulle risposte e sul comportamento tra le diverse istanze.

## Variabili d'ambiente

| Variabile | Descrizione |
|-----------|-------------|
| `STORAGE_TYPE` | `"local"`, `"s3"`, o `"gcs"` |
| `STORAGE_PATH` | Directory di storage locale (predefinita: `./uploads`). Un bucket locale con nome conserva i propri file accanto ad esso, in `<STORAGE_PATH>__<key>`, a meno che `STORAGE_PATH__<KEY>` non specifichi il proprio |
| `S3_BUCKET` | Nome del bucket S3 |
| `S3_REGION` | Regione AWS (predefinita: `"auto"`) |
| `S3_ACCESS_KEY_ID` | Access key AWS |
| `S3_SECRET_ACCESS_KEY` | Secret key AWS |
| `S3_ENDPOINT` | Endpoint S3 personalizzato (per MinIO, R2) |
| `S3_FORCE_PATH_STYLE` | Utilizza URL in stile path-style (richiesto per MinIO) |
| `GCS_BUCKET` | Nome del bucket Google Cloud Storage |
| `GCS_PROJECT_ID` | ID progetto GCP per GCS |
| `GCS_KEY_FILENAME` | Percorso del file della chiave del service account GCP (omettere su GKE — Workload Identity/ADC fornisce le credenziali) |
| `GOOGLE_APPLICATION_CREDENTIALS` | Variabile standard ADC, letta direttamente dall'SDK di Google (non necessaria su GCP con credenziali predefinite) |
| `STORAGE_DOWNLOAD_TOKEN_TTL` | Durata di validità dell'URL di download di un file privato, in secondi — il tempo di vita del token generato da `/api/storage/metadata/*` (predefinito `300`, massimo `604800`, ovvero una settimana). Da aumentare per video e audio privati, che continuano a richiedere intervalli di byte dopo il rendering della pagina. È la versione variabile d'ambiente di `storageDownloadTokenTtl` |
| `STORAGE_MAX_FILE_SIZE` | Dimensione massima del file accettata dalla sorgente, in byte (predefinita `52428800`, 50 MB). Aggiungi il suffisso `__<KEY>` per una sorgente con nome. Un valore che non sia un numero intero di byte impedisce l'avvio. Consulta [Limiti di dimensione dei file](#limiti-di-dimensione-dei-file) |
| `FORCE_LOCAL_STORAGE` | Consente `STORAGE_TYPE=local` in produzione — vedi sotto |
| `STORAGE_PUBLIC_READ` | Distribuisce gli oggetti archiviati a lettori non autenticati. È la versione variabile d'ambiente di `storagePublicRead`, e uno dei tre modi per soddisfare il [controllo di sicurezza all'avvio in produzione](#autorizzazione-per-singolo-oggetto). |
| `STORAGE_ALLOW_ANY_AUTHENTICATED` | Disattiva il controllo di sicurezza all'avvio, ripristinando il comportamento in cui qualsiasi utente autenticato può leggere, sovrascrivere, eliminare o elencare qualsiasi chiave. È la versione variabile d'ambiente di `storageInsecureAllowAnyAuthenticated`. Accettabile solo quando ogni utente autenticato è considerato affidabile per ogni file. |

## Bucket multipli

Un progetto può avere più di un bucket. Dichiarane ciascuno in `config/resources.ts` — l'unico punto letto dalla piattaforma, dal runtime e dalla console:

```ts
import { bucket } from "@rebasepro/types";

export const uploads = bucket({ engine: "s3" });    // the default one
export const media = bucket("media", { engine: "s3", label: "Media" });
```

Quindi esegui `rebase resources --write`, che rigenera `rebase.resources.json` in modo che un host possa leggere la topologia senza dover eseguire una build. Consulta [Sorgenti multiple](/docs/backend/multiple-sources) per approfondire database, bucket e topic insieme.

Ogni sorgente viene configurata tramite gli **stessi nomi di variabili a cui viene aggiunto il proprio suffisso**. La sorgente predefinita non accetta alcun suffisso, quindi un progetto con un singolo bucket continua a usare i nomi semplici sopra indicati e non deve dichiarare nulla:

```bash
S3_BUCKET=app-uploads             # (default)
S3_BUCKET__MEDIA=app-media        # media
S3_ACCESS_KEY_ID__MEDIA=…
S3_SECRET_ACCESS_KEY__MEDIA=…
```

Il suffisso deriva dalla chiave: trasformata in maiuscolo, i caratteri non alfanumerici convertiti in underscore, preceduti da un **doppio** underscore (`media-cdn` → `__MEDIA_CDN`). Un singolo underscore entrerebbe in conflitto con i nomi reali delle variabili — `S3_BUCKET_NAME` verrebbe interpretato come bucket `name`.

Indirizza una proprietà a una sorgente con `storageSource`:

```ts
{
    name: "Cover",
    dataType: "string",
    storage: { storageSource: "media", acceptedFiles: ["image/*"] }
}
```

Una sorgente dichiarata ma mai configurata viene **ignorata**, senza provocare errori irreversibili: i caricamenti indirizzati verso di essa rispondono con `501 STORAGE_SOURCE_NOT_CONFIGURED`. La dichiarazione di un bucket avviene solitamente prima che qualcuno vi colleghi effettivamente dello storage, e un errore di avvio causerebbe un crash loop del backend finché l'operazione non viene completata. Una sorgente configurata in modo *errato* nell'ambiente — ad esempio un tipo senza bucket, o un bucket senza credenziali — viene invece rifiutata all'avvio, trattandosi di un errore e non di una semplice assenza.

### Bucket che condividono un unico account

Le credenziali descrivono solitamente il **provider**, non il bucket. Altrimenti, quindici bucket su una singola installazione MinIO richiederebbero quindici copie della stessa chiave di accesso, e una rotazione comporterebbe quindici modifiche coordinate. È possibile invece assegnare un nome a un account:

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

Solo le variabili con ambito account (account-scoped) utilizzano il fallback — `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_ENDPOINT`, `S3_REGION`, `S3_FORCE_PATH_STYLE` e la coppia GCS `GCS_PROJECT_ID` / `GCS_KEY_FILENAME`. Il nome del bucket non usa mai il fallback: è ciò che distingue una sorgente dall'altra. Un valore impostato a livello di singolo bucket ha comunque sempre la precedenza, consentendo a una sorgente di cambiare provider senza compromettere le altre.

## Sorgenti di storage nel frontend

Quando si utilizzano più backend di storage, passa `storageSources` al provider `<Rebase>` in modo che il frontend sappia come instradare i caricamenti direttamente:

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

La proprietà `key` di ciascuna sorgente deve corrispondere a una chiave backend registrata nella mappa `storage` del server. Il contesto React `StorageSourcesContext` risolve la sorgente attiva per ciascun campo di caricamento.

## Caching e CDN

Ogni oggetto viene veicolato tramite proxy attraverso il server, con un `ETag` per una convalida efficiente, un `Cache-Control` che varia in base a chi è autorizzato a leggerlo e intervalli di byte per la ricerca (seeking) in contenuti audio e video. La documentazione su [Caching dello storage e CDN](/docs/backend/storage-caching/) illustra gli header e la configurazione di una CDN a monte.

## Suggerimenti per la produzione

:::caution
**In produzione, `type: "local"` disabilita lo storage dei file invece di utilizzarlo.** Su una piattaforma effimera (Cloud Run, Heroku, un pod Kubernetes) il filesystem viene cancellato a ogni deploy, riavvio o eviction — pertanto i caricamenti andrebbero a buon fine, la lettura funzionerebbe regolarmente, ma i file scomparirebbero al rollout successivo, senza alcun errore in nessun momento.

Pertanto, l'opzione locale predefinita non viene registrata e una richiesta a `/api/storage/*` che non specifichi alcuna sorgente di storage risponde con **`501 STORAGE_NOT_CONFIGURED`**, indicando le sorgenti effettivamente servite. Una sorgente con nome configurata, come `bucket("media", { engine: "s3" })`, continuerà a funzionare. I caricamenti falliscono in modo esplicito e recuperabile; il resto dell'applicazione continua a funzionare regolarmente. Lo storage dei file è opt-in in produzione: esiste solo a partire dal momento in cui viene configurato un bucket.

Imposta `STORAGE_TYPE=s3` o `gcs`. Se `STORAGE_PATH` risiede effettivamente su un **volume permanente**, imposta `FORCE_LOCAL_STORAGE=true` per dichiararlo esplicitamente. Montalo sulla directory padre di `STORAGE_PATH`, in modo che anche la directory `<STORAGE_PATH>__<key>` di ciascun bucket locale con nome sia inclusa in esso.
:::

- Monta un **volume persistente** sulla cartella padre di `STORAGE_PATH` se utilizzi lo storage locale su Docker/Kubernetes e imposta `FORCE_LOCAL_STORAGE=true` — vedi [Self-hosting](/docs/deployment/self-hosting/#file-storage)
- Utilizza **S3** o compatibili (R2, MinIO), oppure **GCS**, per i deployment di produzione
- Configura una **CDN** (CloudFront, Cloudflare) a monte per migliorare le prestazioni — vedi [Posizionare una CDN a monte](/docs/backend/storage-caching/#putting-a-cdn-in-front)
- **Qualsiasi app con storage in produzione deve dichiarare un modello di accesso** — vedi sotto.
  Non solo quelle multi-tenant: il server *rifiuta l'avvio* se ne è sprovvisto.

## Autorizzazione per singolo oggetto

### Policy

La forma dichiarativa. Un elenco di pattern di percorso, analizzati senza eseguire codice:

```ts
storagePolicies: [
    { path: "public/**", operations: ["read"], allow: "public" },
    { path: "users/:uid/**", allow: ({ params, user }) => user?.uid === params.uid }
]
```

**Una chiave che non corrisponde ad alcuna policy viene rifiutata.** Ogni estensione dei permessi richiede una riga esplicita, e un errore nega l'accesso anziché concederlo.

I pattern effettuano la corrispondenza **per segmento, mai per sottostringa** — `public/**` non corrisponde a `publicity/secret.png`:

| Pattern | Corrispondenza |
|---|---|
| `avatars/logo.png` | esattamente quella chiave |
| `users/*/avatar.png` | esattamente un segmento al posto di `*` |
| `users/:uid/**` | un segmento catturato, poi il resto — compreso nulla |

`**` è valido solo come segmento finale. `:name` cattura un segmento e non include mai uno `/`; le acquisizioni arrivano come `params` nel predicato.

`allow` può essere `"public"` (chiunque), `"authenticated"` (qualsiasi chiamante dotato di uid), oppure un predicato che riceve i parametri catturati, l'utente, l'operazione e il bucket. Per impostazione predefinita, `operations` include tutti e quattro — `read`, `write`, `delete`, `list`.

Le policy soddisfano autonomamente il controllo di sicurezza all'avvio in produzione, e un pattern malformato causa il fallimento dell'avvio anziché del primo caricamento.

### L'hook

`requireAuth` e `publicRead` sono selettori *globali*: determinano se un chiamante debba essere autenticato, non cosa tale chiamante possa toccare. Senza un hook di autorizzazione, **qualsiasi utente autenticato può leggere qualsiasi chiave di cui conosca il nome** — l'unico fattore a separare i file di due tenant diversi è l'imprevedibilità delle chiavi, che non costituisce un modello di controllo accessi. Peggio ancora, è possibile effettuare preliminarmente una richiesta `GET /storage/list?prefix=`, eliminando persino la necessità di indovinare le chiavi.

:::caution[In produzione lo storage non si avvia in assenza di una configurazione]
Le collection sono protette da row-level security; lo storage no. Nel bucket non esiste un equivalente a livello di singolo oggetto, pertanto questo hook *è* il modello — e `initializeRebaseBackend` **genera un'eccezione all'avvio** con `NODE_ENV=production` quando lo storage è configurato e nessuno di questi elementi è impostato:

- `storageAuthorize` — un hook, per singolo oggetto. Consigliato.
- `storagePublicRead: true` — il bucket è effettivamente una CDN pubblica in sola lettura.
- `storageInsecureAllowAnyAuthenticated: true` — un'app single-tenant in cui ogni utente autenticato è ritenuto affidabile per qualunque file. Denominato appositamente per richiedere una seconda lettura.

In fase di sviluppo viene invece registrato un avviso nei log, consentendo al progetto di avere una configurazione scorretta e funzionare localmente fino al momento del deployment. Un progetto generato tramite scaffold include già un hook in `config/storage.ts` — leggilo prima di sostituirlo e tieni presente che modella una *libreria di contenuti condivisa* tipica di un CMS, con una struttura diversa rispetto ai file specifici per utente.
:::

`storageAuthorize` è l'equivalente per lo storage delle regole di sicurezza di una collection, e viene eseguito dopo l'autenticazione su ogni route di storage:

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
| `key` | Chiave dell'oggetto, privata del prefisso del bucket e ripulita da problemi di path traversal |
| `bucket` | Bucket risolto (`"default"` se non specificato) |
| `operation` | `"read"`, `"write"`, `"delete"` o `"list"` |
| `user` | `{ uid, email?, roles? }`, oppure `null` dove la route consente l'accesso anonimo |
| `storageId` | Il backend con nome, se la richiesta ne indicava uno — la sua chiave canonica (`storageId=%20media` corrisponde a `"media"`). Assente per la sorgente predefinita, indipendentemente da come la richiesta l'abbia indicata (senza parametro, vuota o `(default)`) |
| `data` | Accesso in lettura affidabile che **ignora la RLS** — `data.collection(slug).find(query)` / `.findById(id)`. La proprietà risiede in un record, non nel prefisso di una chiave, quindi l'hook necessita di un lettore per stabilire "chi è il proprietario di questo oggetto?". Bypassa intenzionalmente la row-level security: questo hook *costituisce* la decisione di autorizzazione, e subordinarla a un lettore già vincolato dai permessi del chiamante creerebbe un paradosso circolare. Di sola lettura per progettazione. |

Restituisci `false` per negare l'accesso con un codice **403**. Anche il lancio di un'eccezione nega l'accesso — un controllo di proprietà fallito non lascia le porte aperte.

Informazioni utili:

- **La route dei metadati è il luogo in cui viene realmente decisa l'autorizzazione di lettura.** È qui che viene generato il token di download temporaneo vincolato al percorso considerato valido dalla route del file, quindi l'hook ne controlla l'accesso a questo livello. Due letture ignorano l'hook, per progettazione. La prima è quella che include tale token: l'hook l'ha già approvata al momento della generazione del token, limitatamente a quel percorso e a quella sorgente, quindi un hook che ora rifiuterebbe l'accesso (ad esempio per una revoca di appartenenza avvenuta nel frattempo) non lo blocca prima della scadenza del token — definita da `storageDownloadTokenTtl`, pari a 300 secondi per impostazione predefinita. La seconda è la lettura di una chiave situata sotto `public/` da parte di un chiamante privo di credenziali: il prefisso costituisce la dichiarazione che chiunque può leggerla, compresi i visitatori anonimi e le CDN. La lettura della stessa da parte di un utente autenticato viene comunque verificata, ma quella anonima no; di conseguenza, un hook non può rendere privata una chiave sotto `public/`; archivia invece il file al di fuori di `public/`. Solo queste due modalità di lettura lo ignorano: un utente che il tuo adapter di autenticazione per coincidenza chiama `public` viene verificato normalmente come chiunque altro.
- **Un solo bucket, un solo nome.** Su S3 e GCS il valore di `bucket` nell'hook è sempre `"default"`, anche quando una richiesta menziona il bucket del provider, raggiungendo gli stessi oggetti.
- **Un percorso è pubblico solo quando lo è la chiave a cui fa riferimento.** Il prefisso `public/` viene verificato sulla chiave canonica servita dalla route — dopo che il segmento iniziale del bucket `default/` è stato rimosso e sequenze come `//`, `./` e lo `/` iniziale sono state normalizzate — mai sull'URL così come scritto. `/api/storage/file/notes://public/x.txt` fa riferimento alla chiave privata `notes:/public/x.txt`, e la chiave `default/public/x.txt` (raggiunta come `/api/storage/file/default/default/public/x.txt`) risiede in una cartella denominata `default`; nessuna delle due è pubblica. All'interno di un hook, verifica la `key` ricevuta con `isPublicStorageKey` da `@rebasepro/types` — `isPublicStoragePath` analizza un percorso o URL lato client, e interpreterebbe entrambi come pubblici.
- **`list` è vincolato al prefisso.** L'elenco è la modalità con cui si scoprono chiavi di cui non si conosceva l'esistenza.
- **I caricamenti ripristinabili (TUS) sono vincolati al momento della creazione**, evitando che un caricamento rifiutato lasci file temporanei residui.
- L'omissione dell'hook preserva il comportamento precedente, non impattando sulle applicazioni single-tenant.

### Chiavi API e token

Un utente autenticato possiede tutti gli scope di storage, per cui la decisione spetta all'hook e alle policy descritte sopra. Una [chiave API](/docs/backend/api-keys/) necessita inoltre dello scope di storage appropriato per l'operazione, sulla sorgente specificata dalla richiesta: `storage:read` per download, metadati ed elenchi, `storage:write` per caricamenti, cartelle e ogni fase di un caricamento ripristinabile, `storage:delete` per le eliminazioni. La destinazione è l'id della sorgente, e quello della sorgente predefinita è `(default)`: `storage:read:(default)`, `storage:write:avatars`. Senza di esso, la risposta è `403 SCOPE_MISSING`. Con lo scope presente, l'hook viene comunque eseguito impersonando l'identità associata alla chiave.

## Reagire a un caricamento

In Rebase è possibile reagire a qualsiasi altra operazione di scrittura — un record dispone di `beforeSave` e `afterSave`, una pianificazione di un cron job — mentre per un caricamento non era previsto nulla. Tutto ciò che un caricamento comportava doveva essere eseguito dal client con una seconda chiamata, il che significava che l'operazione non veniva affatto eseguita se il client si disconnetteva nel frattempo.

```ts
storageTriggers: [
    {
        path: "uploads/:uid/**",
        events: ["finalize"],
        handler: async ({ key, params, size, user }) => {
            await indexUpload.enqueue({ key, uid: params.uid, size }); // a `queue()` in config/resources.ts
        }
    }
]
```

Il linguaggio dei pattern è lo stesso di `storagePolicies` — segmenti letterali, `*` per un singolo segmento, `:name` per catturarne uno, `**` per i restanti — e un pattern malformato causa il fallimento dell'avvio anziché non corrispondere a nulla silenziosamente.

| Evento | Quando |
| --- | --- |
| `finalize` | dopo che l'oggetto è stato scritto in modo persistente; mai per una scrittura fallita |
| `delete` | dopo che l'oggetto è stato eliminato |

`finalize` scatta sia per i caricamenti multipart che per quelli ripristinabili (TUS) — una sola volta per caricamento, non per singolo chunk — e un caricamento ripristinabile segnala l'utente che lo ha *creato*, poiché è l'entità verificata dall'autorizzazione.

Cosa un handler non deve presumere:

- **Un handler che genera un'eccezione non fa fallire la richiesta.** L'oggetto è già stato archiviato nel momento in cui l'handler viene eseguito, quindi rispondere al client con un errore indicherebbe che il caricamento è fallito anche se non è così, inducendo i client a ritentare. I fallimenti vengono registrati nei log e la risposta rimane inalterata. Se l'operazione deve essere necessariamente completata, inserisci un job in coda.
- **Gli handler vengono attesi (awaited)**, nell'ordine di dichiarazione, prima dell'invio della risposta — un approccio di tipo "fire-and-forget" lascerebbe una promise che un runtime serverless potrebbe congelare a metà esecuzione. Un handler lento rallenta di conseguenza il caricamento, motivo per cui è preferibile accodare l'attività anziché elaborarla qui.
- **Le scritture interne non attivano i trigger.** La cache delle versioni renderizzate delle immagini scrive gli oggetti derivati direttamente nel controller di storage; un trigger `**` attivato su di essi scatterebbe sul proprio stesso output.

## Passaggi successivi

- **[Storage lato frontend e caricamento file](/docs/frontend/storage)** — Campi e hook per il caricamento dei file
- **[Proprietà](/docs/collections/properties)** — Configurazione delle proprietà di storage
