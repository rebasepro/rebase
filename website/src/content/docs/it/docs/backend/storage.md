---
sourceHash: bbee7bded8a1462e
title: Configurazione dello storage
sidebar_label: Configurazione dello storage
description: Configura backend di storage su filesystem locale, compatibili con S3 o GCS/Firebase per il caricamento di file, immagini e contenuti multimediali.
---

## Panoramica

Rebase supporta tre backend di storage:

- **Filesystem locale** — File archiviati su disco (ideale per lo sviluppo)
- **Compatibile con S3** — AWS S3, MinIO, Cloudflare R2, DigitalOcean Spaces
- **Google Cloud Storage / Firebase Storage** — Supporto nativo GCS tramite `@google-cloud/storage`

## Configurazione

:::note[Dove va configurato]
**Runtime gestito** — le variabili `STORAGE_*` in `.env` (`STORAGE_TYPE`, `S3_BUCKET` / `GCS_BUCKET`, `STORAGE_PATH`, `STORAGE_PUBLIC_READ`, … — aggiungi il suffisso `__<KEY>` a ciascuna di esse per una sorgente con nome), più una dichiarazione `bucket("<key>")` in `backend/resources.ts` per ogni bucket oltre a quello predefinito, ed `export const storageAuthorize` da `backend/storage.ts`. Le regole per singolo oggetto possono anche essere impostate come dati in `STORAGE_POLICIES` — "public", "authenticated", "owner" (il segmento `:uid` della chiave corrisponde al chiamante) e ruoli — consulta [Autorizzazione dello storage](/docs/backend/storage-authorization/#as-data-storage_policies).

**Ejected** — il blocco `storage` su `initializeRebaseBackend({ … })`. `storagePolicies` e `storageTriggers` sono disponibili solo in modalità ejected.

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

Lo storage locale conserva i metadati di ciascun oggetto accanto ad esso, come `<key>.metadata.json`, quindi una chiave il cui ultimo segmento termina con `.metadata.json` viene rifiutata con `400 INVALID_STORAGE_KEY` su qualsiasi route. S3 e GCS conservano i metadati sull'oggetto e memorizzano qualsiasi chiave. Su un filesystem case-insensitive (macOS e Windows per impostazione predefinita) `Avatar.png` e `avatar.png` rappresentano un unico file locale ma due oggetti distinti su S3, GCS o su un disco Linux; pertanto, il server emette un avviso all'avvio se la cartella di storage si trova su uno di essi.

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

Su GCP (Cloud Run, GCE, GKE), vengono utilizzate automaticamente le credenziali del service account predefinito. Al di fuori di GCP, imposta la variabile d'ambiente `GOOGLE_APPLICATION_CREDENTIALS` con il percorso del file delle chiavi del service account.

### Backend di storage multipli

È possibile configurare più backend con nome e indirizzare campi diversi verso storage differenti:

```typescript
storage: {
    "(default)": { type: "local", basePath: "./uploads" },
    "media": { type: "s3", bucket: "media-bucket", region: "us-east-1", ... }
}
```

Quindi indirizza una colonna di storage a uno specifico backend tramite `source`:

```typescript
image: col.storage({ path: "products/", source: "media" }),  // Routes to the "media" S3 backend
```

## Endpoint di storage

| Metodo | Percorso | Descrizione |
|--------|----------|-------------|
| `POST` | `/api/storage/upload` | Caricamento diretto di file, un corpo `multipart/form-data`: `file` (obbligatorio); `key`, la chiave dell'oggetto, cartelle incluse (`author_pictures/ada.jpg`), altrimenti il nome del file nella radice; `bucket`, altrimenti quello predefinito; `storageId`; `collection` e `property`, che vincolano il file a `maxSize` e `acceptedFiles` di tale proprietà; e `metadata_<name>` per i metadati personalizzati. Qualsiasi altro campo viene ignorato: non esiste un campo `path` |
| `POST` | `/api/storage/upload?storageId=<key>` | Caricamento verso uno specifico backend con nome |
| `GET` | `/api/storage/file/*` | Recupera un file — tutto ciò che segue `/file/` è la chiave dell'oggetto |
| `GET` | `/api/storage/file/*?storageId=<key>` | Recupera un file da un backend specifico |
| `GET` | `/api/storage/metadata/*` | Dimensioni, tipo di contenuto e metadati personalizzati di un oggetto, senza i relativi byte, più un token di download a breve durata se privato |
| `POST` | `/api/storage/metadata` | Lo stesso per un massimo di 100 oggetti di una sorgente: corpo `{ keys, storageId? }` |
| `DELETE` | `/api/storage/file/*` | Elimina un file |
| `GET` | `/api/storage/list` | Elenca gli oggetti sotto un prefisso (`prefix`, `bucket`, `maxResults`, `pageToken`, `storageId`). Un valore di `maxResults` inferiore a 1 o un `pageToken` mai emesso dalla sorgente restituisce `400 INVALID_LIST_OPTIONS` |
| `POST` | `/api/storage/folder` | Crea un marcatore di cartella vuota |
| `GET` | `/api/storage/sources` | Le sorgenti di storage gestite da questo backend, per chiave |
| `OPTIONS` | `/api/storage/tus` | Esegue una query sulle funzionalità supportate del protocollo TUS |
| `POST` | `/api/storage/tus` | Avvia una sessione di caricamento TUS ripristinabile |
| `HEAD` | `/api/storage/tus/:id` | Verifica lo stato di avanzamento del caricamento (offset in byte) |
| `PATCH` | `/api/storage/tus/:id` | Aggiunge un blocco di dati al file temporaneo |
| `DELETE` | `/api/storage/tus/:id` | Termina/interrompe la sessione di caricamento TUS |

**Cosa restituiscono.** Un unico envelope, lo stesso utilizzato da `/api/data`: il payload si trova sotto `data`, e un errore restituisce `{ "error": { message, code, requestId } }` con i codici presenti nel [riferimento agli errori](/docs/backend/errors/). `/api/storage/file/*` costituisce l'eccezione, poiché il suo payload è il file stesso — restituisce direttamente i byte, con `Content-Type`, `Content-Length` e gli header di caching.

```json
// GET /api/storage/list?prefix=products/images/
{ "data": { "items": [ { "bucket": "default", "fullPath": "products/images/a.jpg", "name": "a.jpg",
  "size": 48213, "updated": "2026-10-01T12:00:00.000Z", "contentType": "image/jpeg" } ], "prefixes": [] } }
```

Un elenco descrive ciascun file restituito: la sua dimensione `size` in byte e `updated`, data dell'ultima scrittura, su storage locale, S3 e GCS, e il suo `contentType` su storage locale e GCS. Un elenco su S3 non include il tipo, quindi su S3 questo è assente, ma `/api/storage/metadata/*` continua a fornirlo. Una cartella in `prefixes` non contiene nessuno di questi valori, così come un `StorageController` personalizzato che non li imposti.

`POST /api/storage/upload` risponde con `201` fornendo `{ key, bucket, storageUrl }` dell'oggetto archiviato sotto `data`; `GET /api/storage/metadata/*` restituisce i metadati dell'oggetto e, per un oggetto privato, il `token` a breve durata; `POST /api/storage/metadata` restituisce un oggetto indicizzato dai percorsi inviati, ciascuno contenente ciò che la `GET` avrebbe risposto per esso (vedi sotto). Una cartella non è un oggetto: chiamare `/metadata` su una chiave che termina con `/` restituisce `404` su qualsiasi storage, anche dove S3 o GCS mantengono un marcatore `folder/`, pertanto non viene generato alcun token di download per un prefisso; `GET /api/storage/sources` restituisce l'array delle sorgenti configurate, con `configured: true`. In un deployment privo di storage, risponde con `200 {"data": [], "configured": false}`, mentre tutte le altre route rispondono con `501 STORAGE_NOT_CONFIGURED`. `GET /api/auth/config` segnala la stessa informazione come `storage: false`, consentendo al client di evitare la richiesta. `GET /api/storage/sources` è pubblica: risponde senza token anche quando `requireAuth` è abilitato. Elenca i nomi delle sorgenti (chiave, engine, transport ed etichetta) e mai un file, e l'SDK client la legge per configurare le proprie sorgenti, operazione che può avvenire prima dell'accesso di qualsiasi utente. Anche un'app che legge una sorgente `direct` in modo anonimo ne ha bisogno. Ogni route che elenca, legge o scrive un file mantiene la propria autenticazione. `DELETE /api/storage/file/*` e `POST /api/storage/folder` contengono solo un `message`, poiché non c'è nulla da restituire.

Su S3 e GCS, un `bucket` deve essere tra quelli gestiti dalla sorgente, sia in scrittura che in lettura: un caricamento, una `POST /api/storage/folder` o un caricamento TUS che specifichi qualsiasi altro bucket restituisce `404 UNKNOWN_STORAGE_SOURCE`, analogamente a quanto fa l'elenco. Lo storage locale continua invece a creare un bucket alla sua prima scrittura.

**Più oggetti contemporaneamente.** `POST /api/storage/metadata` accetta `{ "keys": ["photos/a.png", "photos/b.png"], "storageId": "media" }` — fino a 100 percorsi di oggetti di una sorgente, ciascuno formattato come accettato da `GET /api/storage/metadata/<key>` — e risponde con una voce per chiave:

```json
{ "data": {
  "photos/a.png": { "fullPath": "photos/a.png", "size": 48213, "contentType": "image/png", "token": "…", "tokenExpiresIn": 300 },
  "photos/b.png": { "error": { "code": "FORBIDDEN", "message": "Not authorized for this object", "status": 403 } }
} }
```

Ciascuna chiave viene valutata esattamente come farebbe la `GET` — lo stesso hook `storageAuthorize` e scope di storage, la stessa regola pubblica, un token di download dedicato — e una chiave rifiutata, mancante o non valida risponde con il proprio `error` senza fallire o esporre le altre. Un chiamante senza sessione in un deployment che ne richiede una riceve il `401` che la `GET` avrebbe restituito, a meno che tutte le chiavi non siano pubbliche. Più di 100 chiavi, o un body privo di `keys`, restituisce `400 BAD_REQUEST`. Il rate limiter conteggia la richiesta come ⌈N/10⌉ richieste per N chiavi, quindi una pagina di 100 miniature costa 10. `client.storage.getSignedUrl()` e il pannello di amministrazione inviano le ricerche di una pagina raggruppate in questo modo, ricorrendo a una `GET` per file come fallback sui server sprovvisti della route.

**Come viene autorizzata la lettura di un file.** Le route di lettura — `/api/storage/file/*` e `/api/storage/metadata/*` — accettano il token firmato a breve durata generato da [`getSignedUrl()`](/docs/sdk/storage), passato come `?token=<token>` o come intestazione `Bearer`. Un normale JWT di accesso viene **rifiutato** su `/file/*` con `401 Unauthorized: Access JWT not allowed on file routes`: il token valido su tutte le altre route qui non funziona, intenzionalmente, poiché l'URL di un file è un elemento destinato a essere fornito a un browser, a una CDN o a un tag `<img>`. Tutte le altre righe sopra indicate accettano il JWT di accesso come di consueto.

## Trasformazioni delle immagini al volo

Rebase include una pipeline integrata per l'elaborazione delle immagini basata su **Sharp**. Durante la distribuzione di risorse grafiche dallo storage, è possibile applicare operazioni dinamiche utilizzando parametri di query:

```bash
# Serve image scaled to 300px width in webp format
GET /api/storage/file/products/laptop.jpg?width=300&format=webp
```

### Parametri supportati

- `width`, `height`: Limiti di ridimensionamento, da `1` a `4096` (l'immagine non viene mai ingrandita).
- `quality`: Da `1` a `100`.
- `format`: Converte il formato dell'immagine. Formati supportati: `webp`, `jpeg`, `png`, `avif`.
- `fit`: `cover`, `contain`, `fill`, `inside` o `outside`.

Un parametro al di fuori di questi intervalli restituisce **400**, e non un valore corretto silenziosamente — in precedenza `?width=99999` restituiva un'immagine a 4096px e `?format=tiff` una in formato webp, senza alcuna segnalazione.

Le miniature delle immagini archiviate nel pannello di amministrazione utilizzano questo endpoint: l'anteprima di una tabella o di una scheda richiede una versione in formato webp grande circa il doppio delle dimensioni di rendering (96–800px) anziché l'originale. I file SVG e GIF vengono sempre mostrati così come sono. `sharp` è opzionale: in sua assenza, una richiesta di trasformazione restituisce l'originale e il backend mostra un avviso una tantum che invita a eseguire `pnpm add sharp` in `backend/`.

### Prestazioni e caching LRU

L'elaborazione comporta un elevato consumo di CPU e memoria e, su un oggetto pubblico, l'endpoint è accessibile in modo anonimo; per questo motivo le operazioni sono limitate oltre che memorizzate nella cache:
- **Capacità**: una cache LRU limitata a **500 voci** globali, indicizzata per sorgente di storage, bucket e chiave canonica.
- **TTL (Time to Live)**: Le varianti nella cache scadono dopo **1 ora**.
- Richieste simultanee per la stessa variante non presente nella cache producono **una sola** trasformazione, non una per ciascuna richiesta.
- Viene eseguito contemporaneamente un numero ridotto di trasformazioni; al superamento di un backlog prefissato, il server risponde con **503 `TRANSFORM_OVERLOADED`** invece di accettare elaborazioni che non potrebbe gestire.

Tale cache risiede nel processo, il che significa che non è condivisa tra le istanze e non sopravvive a un riavvio. Due repliche calcolano ciascuna ogni variante e un deployment cancella completamente la cache.

### Versioni elaborate che sopravvivono a un riavvio

`storageRenditionCache` riscrive ciascuna immagine derivata nello stesso bucket della sorgente, in modo che l'elaborazione venga eseguita una sola volta per l'intero deployment anziché una volta per istanza per release:

```ts
storageRenditionCache: { enabled: true }
```

oppure `STORAGE_RENDITION_CACHE=true` per un deployment in bundle. Le elaborazioni sono archiviate sotto il prefisso riservato `_rebase/renditions/`, indicizzate in base alla versione dell'oggetto sorgente — pertanto la sostituzione di un'immagine distribuisce immediatamente quella nuova.

Tre aspetti da conoscere prima di abilitarlo:

- **Una lettura ora scrive.** Ciascuna nuova variante comporta una richiesta `PUT` nel bucket. È disattivata per impostazione predefinita per questa ragione.
- **Una scrittura non riuscita non invalida la richiesta.** Credenziali di sola lettura o una policy del bucket che rifiuti il prefisso ripiegano sulla cache in-process; l'immagine viene comunque distribuita e il motivo viene registrato nei log una sola volta.
- **Le elaborazioni sostituite non vengono eliminate automaticamente.** La sostituzione di un oggetto sorgente abbandona le sue vecchie elaborazioni. Imposta una regola del ciclo di vita (lifecycle rule) su `_rebase/renditions/` — questo prefisso è fisso e non configurabile proprio per consentire a una regola di farvi riferimento.

Il prefisso non è accessibile direttamente dalle API. La lettura o la scrittura diretta su di esso risponde con **400 `INVALID_STORAGE_KEY`**: ogni regola di accesso nel prodotto — sia `storageAuthorize` che le policy dichiarative — è scritta rispetto alla chiave *sorgente*, e una versione elaborata fornita tramite il proprio percorso risponderebbe a una richiesta priva di contesto.

`_rebase/maintenance/` è riservato allo stesso modo. `rebase storage orphans` conserva lì il resoconto di ogni scansione, all'interno della sorgente analizzata, affinché il processo che esegue la scansione e quello che ne comunica lo stato leggano lo stesso record. Un chiamante in grado di scrivere un record potrebbe determinare cosa una successiva eliminazione rimuoverà; pertanto, la lettura, la scrittura o l'elenco di questo prefisso risponde a sua volta con 400. I record vengono eliminati 7 giorni dopo l'ultima scrittura, all'avvio della successiva scansione di tale sorgente.

### Cosa viene distribuito

Il content-type archiviato corrisponde esattamente a quanto dichiarato dall'autore del caricamento — non viene effettuato alcuno sniffing dei byte — pertanto `/api/storage/file/*` mostrerà inline solo una **ristretta allowlist**: immagini, video, audio, `application/pdf` e `text/plain`. Tutto il resto, compreso `text/html`, viene distribuito come `application/octet-stream` con `Content-Disposition: attachment`, e ogni risposta include l'intestazione `X-Content-Type-Options: nosniff`. Lo storage non è un hosting web: una pagina caricata e renderizzata sull'origine dell'API potrebbe accedere ai cookie di tale origine e chiamarne gli endpoint.

Un SVG è un'immagine che costituisce anche un documento e può contenere tag `<script>`. Viene distribuito come `image/svg+xml` — in modo da essere renderizzato all'interno di un tag `<img>` e nelle miniature del pannello di amministrazione — con l'intestazione `Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline'; sandbox` su ogni risposta, inclusi gli URL trasformati e quelli con token di download. Se aperto direttamente, viene visualizzato con gli script disabilitati e un'origine opaca, impedendogli di accedere ai cookie o agli endpoint dell'API.

## Dimensioni massime consentite per un file

Ciascuna sorgente di storage accetta file fino al proprio limite: **50 MB**, salvo diversamente specificato da `STORAGE_MAX_FILE_SIZE` (in byte, con suffisso `__<KEY>` per una sorgente con nome) o da `maxFileSize` della sorgente. Tutti i punti di accesso applicano lo stesso limite numerico. `POST /api/storage/upload` risponde con `413 PAYLOAD_TOO_LARGE` se superato; un caricamento ripristinabile viene rifiutato alla creazione, prima del primo blocco; e `OPTIONS /api/storage/tus` lo dichiara come `Tus-Max-Size` — per la sorgente specificata da `?storageId=`, o per quella predefinita in caso contrario.

```bash
STORAGE_MAX_FILE_SIZE=209715200          # (default): 200 MB
STORAGE_MAX_FILE_SIZE__MEDIA=1073741824  # media: 1 GB
```

La quantità di file che il server trattiene contemporaneamente in memoria dipende dal punto di accesso. `POST /api/storage/upload` consiste in un unico corpo multipart analizzato per intero dal server: da tre a cinque volte la dimensione del file in memoria. Un caricamento ripristinabile (TUS) mantiene in memoria un blocco alla volta. `client.storage.putObject()` e il pannello di amministrazione inviano i file superiori a 8 MiB tramite caricamento ripristinabile. Consulta [Caricamenti ripristinabili (TUS)](/docs/backend/storage-resumable-uploads/) per il protocollo, le risposte fornite e il comportamento su più istanze.

## Variabili d'ambiente

| Variabile | Descrizione |
|-----------|-------------|
| `STORAGE_TYPE` | `"local"`, `"s3"` o `"gcs"` |
| `STORAGE_PATH` | Directory di storage locale (predefinita: `<project>/uploads`, sia con `rebase dev` che in un server generato da `rebase eject`). Un percorso relativo viene risolto a partire dalla directory in cui è in esecuzione il server, che dopo `rebase eject` corrisponde a `backend/`. Un bucket locale con nome mantiene i file accanto ad esso, in `<STORAGE_PATH>__<key>`, a meno che `STORAGE_PATH__<KEY>` non specifichi il proprio |
| `S3_BUCKET` | Nome del bucket S3 |
| `S3_REGION` | Regione AWS (predefinita: `"auto"`) |
| `S3_ACCESS_KEY_ID` | Chiave di accesso AWS |
| `S3_SECRET_ACCESS_KEY` | Chiave segreta AWS |
| `S3_ENDPOINT` | Endpoint S3 personalizzato (per MinIO, R2) |
| `S3_FORCE_PATH_STYLE` | Utilizza URL in formato path-style (richiesto per MinIO) |
| `GCS_BUCKET` | Nome del bucket Google Cloud Storage |
| `GCS_PROJECT_ID` | ID progetto GCP per GCS |
| `GCS_KEY_FILENAME` | Percorso di un file di chiavi del service account GCP (omettere su GKE — le credenziali sono fornite da Workload Identity/ADC) |
| `GOOGLE_APPLICATION_CREDENTIALS` | Variabile ADC standard, letta direttamente dall'SDK di Google (non necessaria su GCP con credenziali predefinite) |
| `STORAGE_DOWNLOAD_TOKEN_TTL` | Durata di validità in secondi dell'URL di download di un file privato — la durata del token emesso da `/api/storage/metadata/*` (predefinita `300`, massimo `604800`, una settimana). Aumentala per video e audio privati, che continuano a richiedere intervalli (range) dopo il rendering della pagina. Equivalente come variabile d'ambiente di `storageDownloadTokenTtl` |
| `STORAGE_MAX_FILE_SIZE` | File di dimensioni massime accettato dalla sorgente, in byte (predefinito `52428800`, 50 MB). Aggiungi il suffisso `__<KEY>` per una sorgente con nome. Un valore che non sia un numero intero di byte impedisce l'avvio. Consulta [Dimensioni massime consentite per un file](#dimensioni-massime-consentite-per-un-file) |
| `FORCE_LOCAL_STORAGE` | Consente `STORAGE_TYPE=local` in produzione — vedi sotto |
| `STORAGE_PUBLIC_READ` | Distribuisce gli oggetti archiviati a lettori non autenticati. Equivalente come variabile d'ambiente di `storagePublicRead`, e uno dei tre modi per soddisfare il [controllo di avvio in produzione](#autorizzazione-per-singolo-oggetto). |
| `STORAGE_POLICIES` | Regole di accesso allo storage in formato JSON: `[{ "path", "operations"?, "allow" }]`, dove `allow` può essere `"public"`, `"authenticated"`, `"owner"` o `{ "roles": [...] }`. Blocca per impostazione predefinita (deny by default); soddisfa il [controllo di avvio in produzione](#autorizzazione-per-singolo-oggetto). Un elenco non valido impedisce l'avvio. Consulta [Autorizzazione dello storage](/docs/backend/storage-authorization/#as-data-storage_policies). |
| `STORAGE_ALLOW_ANY_AUTHENTICATED` | Disabilita il controllo di avvio, ripristinando il comportamento in cui qualsiasi utente autenticato può leggere, sovrascrivere, eliminare o elencare qualsiasi chiave. Equivalente come variabile d'ambiente di `storageInsecureAllowAnyAuthenticated`. Giustificabile solo quando ogni utente autenticato è considerato completamente attendibile per qualsiasi file. |

## Più bucket

Un progetto può disporre di più di un bucket. Dichiarane ciascuno in `backend/resources.ts` — l'unico punto letto dalla piattaforma, dal runtime e dalla console:

```ts
import { bucket } from "@rebasepro/types";

export const uploads = bucket({ engine: "s3" });    // the default one
export const media = bucket("media", { engine: "s3", label: "Media" });
```

Quindi esegui `rebase resources --write`, che rigenera `rebase.resources.json` affinché l'host possa leggere la topologia senza eseguire una build. Consulta [Sorgenti multiple](/docs/backend/multiple-sources) per database, bucket e topic combinati.

Ciascuna sorgente viene configurata tramite i **medesimi nomi di variabile arricchiti dal proprio suffisso**. La sorgente predefinita non accetta suffissi, pertanto un progetto a bucket singolo continua a utilizzare i nomi semplici indicati sopra senza necessità di dichiarare alcunché, e l'aggiunta di bucket con nome accanto ad essa non li modifica ([dettagli](/docs/backend/multiple-sources/#which-bucket-receives-an-unqualified-upload)):

```bash
S3_BUCKET=app-uploads             # (default)
S3_BUCKET__MEDIA=app-media        # media
S3_ACCESS_KEY_ID__MEDIA=…
S3_SECRET_ACCESS_KEY__MEDIA=…
```

Il suffisso è ricavato dalla chiave: convertita in maiuscolo, i caratteri non alfanumerici trasformati in trattini bassi, preceduta da un **doppio** trattino basso (`media-cdn` → `__MEDIA_CDN`). Un singolo trattino basso entrerebbe in collisione con i nomi di variabili reali — `S3_BUCKET_NAME` verrebbe interpretato come bucket `name`.

Indirizza una colonna a una sorgente tramite `source`:

```ts
cover: col.storage({ path: "covers/", source: "media", accept: ["image/*"] }),
```

Una sorgente dichiarata ma mai configurata viene **ignorata**, senza conseguenze critiche: i caricamenti indirizzati verso di essa rispondono con `501 STORAGE_SOURCE_NOT_CONFIGURED`. La dichiarazione di un bucket avviene solitamente prima che venga collegato lo storage effettivo, e un errore di avvio in questa fase provocherebbe un crash-loop del backend. Una sorgente configurata in modo *errato* nell'ambiente — un tipo privo di bucket o un bucket senza credenziali — viene invece rifiutata all'avvio, trattandosi di un errore e non di una semplice assenza.

### Bucket che condividono lo stesso account

Le credenziali solitamente descrivono il **provider**, non il bucket. Quindici bucket su una singola installazione MinIO implicherebbero altrimenti quindici copie della stessa chiave di accesso, e la loro rotazione richiederebbe quindici modifiche coordinate. È invece preferibile assegnare un nome a un account:

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

Solo le variabili con ambito account (account-scoped) utilizzano il fallback — `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_ENDPOINT`, `S3_REGION`, `S3_FORCE_PATH_STYLE` e la coppia GCS `GCS_PROJECT_ID` / `GCS_KEY_FILENAME`. Il nome del bucket non utilizza mai il fallback: è ciò che distingue una sorgente dall'altra. Un valore specifico per bucket ha comunque la priorità, consentendo a una sorgente di cambiare provider senza intaccare le altre.

### Eliminazione pianificata dei file orfani

L'eliminazione di una riga lascia i suoi file nel bucket. Nessun elemento viene eliminato contestualmente alla riga: un'altra riga, una versione nella [cronologia](/docs/backend/history/) o il proprio codice che memorizza la chiave come semplice stringa potrebbero continuare a fare riferimento al file. Un bucket può invece richiedere una procedura di pulizia in grado di tenere conto di tutti questi riferimenti:

```ts
export const voice = bucket("voice", { engine: "s3", orphanSweep: { olderThanHours: 72 } });
export const media = bucket("media", { orphanSweep: true }); // a week, daily at 04:17 UTC
```

Ogni pulizia dichiarata è un cron job, `storage-orphan-sweep-<bucket>` (`storage-orphan-sweep-default` per il bucket predefinito). Esegue la scansione sottostante a `rebase storage orphans --delete`. Tale scansione analizza ogni riga di ogni tabella e ogni voce della cronologia, mantenendo:

- qualsiasi file a cui qualcosa faccia ancora riferimento;
- qualsiasi file più recente di `olderThanHours` (minimo 24, per impostazione predefinita una settimana);
- tutti i file, per quella specifica esecuzione, nel caso in cui una tabella non possa essere letta.

Verifica poi nuovamente ogni file subito prima di eliminarlo. Imposta `schedule` con un'espressione cron (UTC) per modificarne l'orario di esecuzione. Trattandosi di un cron job, viene eseguito su una sola istanza per intervallo. La cronologia delle esecuzioni registra quanti file sono stati eliminati e quanti conservati, e il job può essere sospeso o avviato manualmente dall'elenco cron dell'amministratore. Richiede un bucket gestito da questo backend: un bucket con `transport: "direct"` viene rifiutato all'avvio con un avviso.

## Sorgenti di storage nel frontend

Il frontend rileva le sorgenti del server tramite `GET /api/storage/sources`, quindi una sorgente di tipo `server` non richiede alcuna voce. Passa `storageSources` al provider `<Rebase>` per una sorgente `direct`, che esegue il caricamento direttamente verso il provider, o per specificare autonomamente un'etichetta o un transport:

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

La `key` di una sorgente `server` deve corrispondere a una chiave del backend registrata nella mappa `storage` del server. Il contesto React `StorageSourcesContext` individua la sorgente attiva per ciascun campo di caricamento.

## Caching e CDN

Ogni oggetto viene inoltrato tramite il server come proxy, con un `ETag` per una revalidazione economica, un `Cache-Control` che dipende da chi è autorizzato a leggerlo e byte range per lo scorrimento di audio e video. [Caching dello storage e CDN](/docs/backend/storage-caching/) illustra gli header e la configurazione da applicare a una CDN posizionata a monte.

## Suggerimenti per la produzione

:::caution
**In produzione, `type: "local"` disabilita lo storage dei file anziché utilizzarlo.** Su una piattaforma temporanea/effimera (Cloud Run, Heroku, un pod Kubernetes) il filesystem viene cancellato a ogni deploy, riavvio o eviction — di conseguenza i caricamenti andrebbero a buon fine, i file verrebbero letti correttamente, ma svanirebbero al successivo rollout, senza generare alcun errore in nessun momento.

Pertanto, l'impostazione predefinita locale non viene registrata e una richiesta a `/api/storage/*` che non specifichi alcuna sorgente di storage risponde con **`501 STORAGE_NOT_CONFIGURED`**, elencando le sorgenti effettivamente gestite. Una sorgente con nome configurata, come `bucket("media", { engine: "s3" })`, continua a funzionare regolarmente. I caricamenti falliscono in modo esplicito e recuperabile; il resto dell'applicazione continua a essere operativo. Lo storage dei file è facoltativo (opt-in) in produzione: esiste solo nel momento in cui è presente un bucket.

Imposta `STORAGE_TYPE=s3` o `gcs`. Se `STORAGE_PATH` risiede effettivamente su un **volume permanente**, imposta `FORCE_LOCAL_STORAGE=true` per indicarlo esplicitamente. Montalo sulla directory principale (parent) di `STORAGE_PATH`, in modo che anche la directory `<STORAGE_PATH>__<key>` di ogni bucket locale con nome si trovi su di esso.
:::

- Monta un **volume permanente** sulla directory padre di `STORAGE_PATH` se utilizzi lo storage locale su Docker/Kubernetes, e imposta `FORCE_LOCAL_STORAGE=true` — consulta [Self-hosting](/docs/deployment/self-hosting/#file-storage)
- Utilizza **S3** o compatibili (R2, MinIO), oppure **GCS**, per i deployment in produzione
- Configura una **CDN** (CloudFront, Cloudflare) a monte per migliorare le prestazioni — consulta [Configurare una CDN a monte](/docs/backend/storage-caching/#putting-a-cdn-in-front)
- **Qualsiasi applicazione con storage in produzione deve dichiarare un modello di accesso** — consulta [Autorizzazione dello storage](/docs/backend/storage-authorization/). Non solo le applicazioni multi-tenant: il server *rifiuta l'avvio* se ne è sprovvisto.

## Autorizzazione per singolo oggetto

Chi sia autorizzato a leggere, scrivere, eliminare o elencare ciascuna chiave viene stabilito da `storagePolicies` e dall'hook `storageAuthorize`, e anche una chiave API necessita dello scope di storage appropriato per l'operazione. In produzione il server rifiuta l'avvio in presenza di storage privo di un modello di accesso. Consulta [Autorizzazione dello storage](/docs/backend/storage-authorization/).

## Reagire a un caricamento

A qualsiasi altra scrittura in Rebase è possibile associare una reazione — una riga dispone di `beforeSave` e `afterSave`, una pianificazione ha un cron job — mentre per un caricamento non c'era nulla. Qualsiasi azione successiva richiesta da un caricamento doveva essere eseguita dal client con una seconda chiamata, il che comportava la mancata esecuzione se il client si disconnetteva nel frattempo.

```ts
storageTriggers: [
    {
        path: "uploads/:uid/**",
        events: ["finalize"],
        handler: async ({ key, params, size, user }) => {
            await indexUpload.enqueue({ key, uid: params.uid, size }); // a `queue()` in backend/resources.ts
        }
    }
]
```

La sintassi dei pattern è la stessa di `storagePolicies` — segmenti letterali, `*` per un singolo segmento, `:name` per catturarne uno, `**` per la parte restante — e un pattern malformato blocca l'avvio anziché non corrispondere silenziosamente a nulla.

| Evento | Quando |
| --- | --- |
| `finalize` | dopo che l'oggetto è stato scritto in modo permanente; mai per una scrittura non riuscita |
| `delete` | dopo che l'oggetto è stato rimosso |

`finalize` viene attivato sia per i percorsi multipart che per quelli ripristinabili (TUS) — una volta per caricamento, non una volta per blocco — e un caricamento ripristinabile segnala l'utente che lo ha *creato*, poiché è su tale entità principale che è stata verificata l'autorizzazione.

Cosa un handler non deve dare per scontato:

- **Un handler che solleva un'eccezione non fa fallire la richiesta.** L'oggetto è già archiviato nel momento in cui l'handler viene eseguito, pertanto rispondere al client con un errore indicherebbe che il caricamento è fallito quando in realtà non lo è, inducendo i client a riprovare il caricamento. Gli errori vengono registrati nei log e la risposta rimane inalterata. Se l'operazione deve necessariamente essere eseguita, accodala come job.
- **Gli handler vengono attesi (`await`)**, nell'ordine di dichiarazione, prima dell'invio della risposta — un approccio fire-and-forget lascerebbe una promise che un runtime serverless potrebbe congelare a metà esecuzione. Un handler lento rende pertanto lento l'intero caricamento; questo è un ulteriore motivo per accodare l'elaborazione anziché gestirla qui.
- **Le scritture interne non attivano i trigger.** La cache delle versioni elaborate delle immagini scrive gli oggetti derivati direttamente nello storage controller; un trigger `**` che si attivasse su di essi finirebbe per attivarsi sul proprio stesso output.

## Passaggi successivi

- **[Storage frontend e caricamento file](/docs/frontend/storage)** — Campi e hook per il caricamento dei file
- **[Colonne](/docs/schema/columns/#storage-columns)** — `col.storage()` e le relative opzioni
