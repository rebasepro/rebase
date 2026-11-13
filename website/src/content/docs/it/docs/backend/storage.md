---
sourceHash: dde397d03ef58183
title: Configurazione dello Storage
sidebar_label: Configurazione dello Storage
description: Configura backend di storage su filesystem locale, compatibili con S3 o GCS/Firebase Storage per il caricamento di file, immagini e contenuti multimediali.
---

## Panoramica

Rebase supporta tre backend di storage:

- **Filesystem locale** — File archiviati su disco (ideale per lo sviluppo)
- **Compatibile con S3** — AWS S3, MinIO, Cloudflare R2, DigitalOcean Spaces
- **Google Cloud Storage / Firebase Storage** — Supporto nativo per GCS tramite `@google-cloud/storage`

## Configurazione

:::note[Dove va inserito]
**Runtime gestito** — le variabili `STORAGE_*` in `.env` (`STORAGE_TYPE`, `S3_BUCKET` / `GCS_BUCKET`, `STORAGE_PATH`, `STORAGE_PUBLIC_READ`, … — aggiungi il suffisso `__<KEY>` a qualsiasi di esse per una sorgente con nome), più una dichiarazione `bucket("<key>")` in `backend/resources.ts` per ogni bucket oltre a quello predefinito, ed `export const storageAuthorize` da `backend/storage.ts`. `storageAuthorize` non ha intenzionalmente una forma di variabile d'ambiente: nessuna variabile può esprimere "questo utente può leggere questa chiave".

**Espulso (Ejected)** — il blocco `storage` su `initializeRebaseBackend({ … })`. `storagePolicies` e `storageTriggers` sono disponibili solo nella modalità ejected.

La mappa completa si trova in [Panoramica del Backend](/docs/backend/#where-each-option-lives).
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

Lo storage locale mantiene i metadati di ogni oggetto accanto ad esso, come `<key>.metadata.json`, quindi una chiave il cui ultimo segmento termina con `.metadata.json` viene rifiutata con `400 INVALID_STORAGE_KEY` su ogni route. S3 e GCS mantengono i metadati sull'oggetto e archiviano qualsiasi chiave. Su un file system senza distinzione tra maiuscole e minuscole (case-insensitive, come macOS e Windows per impostazione predefinita) `Avatar.png` e `avatar.png` corrispondono a un unico file locale ma a due oggetti distinti su S3, GCS o su un disco Linux; pertanto, il server genera un avviso all'avvio quando la cartella di archiviazione si trova su uno di essi.

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

Su GCP (Cloud Run, GCE, GKE), le credenziali dell'account di servizio predefinito vengono utilizzate automaticamente. Al di fuori di GCP, imposta la variabile d'ambiente `GOOGLE_APPLICATION_CREDENTIALS` con il percorso del file della chiave del tuo account di servizio.

### Backend di Storage Multipli

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

## Endpoint di Storage

| Metodo | Percorso | Descrizione |
|--------|------|-------------|
| `POST` | `/api/storage/upload` | Caricamento diretto di file, un corpo `multipart/form-data`: `file` (obbligatorio); `key`, la chiave dell'oggetto, cartelle incluse (`author_pictures/ada.jpg`), altrimenti il nome del file alla radice; `bucket`, altrimenti quello predefinito; `storageId`; `collection` e `property`, che vincolano il file a `maxSize` e `acceptedFiles` di tale proprietà; e `metadata_<name>` per metadati personalizzati. Qualsiasi altro campo viene ignorato: non esiste un campo `path` |
| `POST` | `/api/storage/upload?storageId=<key>` | Caricamento su uno specifico backend con nome |
| `GET` | `/api/storage/file/*` | Recupero di un file — tutto ciò che segue `/file/` è la chiave dell'oggetto |
| `GET` | `/api/storage/file/*?storageId=<key>` | Recupero di un file da uno specifico backend |
| `GET` | `/api/storage/metadata/*` | Dimensione, content type e metadati personalizzati di un oggetto, senza i relativi byte, più un token di download a breve durata se è privato |
| `POST` | `/api/storage/metadata` | Lo stesso per un massimo di 100 oggetti di una sorgente: body `{ keys, storageId? }` |
| `DELETE` | `/api/storage/file/*` | Eliminazione di un file |
| `GET` | `/api/storage/list` | Elenco di oggetti sotto un prefisso (`prefix`, `bucket`, `maxResults`, `pageToken`, `storageId`). Un valore di `maxResults` inferiore a 1, o un `pageToken` mai emesso dalla sorgente, restituisce `400 INVALID_LIST_OPTIONS` |
| `POST` | `/api/storage/folder` | Creazione di un marcatore di cartella vuota |
| `GET` | `/api/storage/sources` | Le sorgenti di storage servite da questo backend, per chiave |
| `OPTIONS` | `/api/storage/tus` | Query sulle funzionalità del protocollo TUS supportate |
| `POST` | `/api/storage/tus` | Avvio di una sessione di caricamento TUS ripristinabile |
| `HEAD` | `/api/storage/tus/:id` | Verifica dell'avanzamento del caricamento (offset in byte) |
| `PATCH` | `/api/storage/tus/:id` | Aggiunta di un blocco di dati al file temporaneo |
| `DELETE` | `/api/storage/tus/:id` | Chiusura/annullamento della sessione di caricamento TUS |

**Cosa restituiscono.** Un unico wrapper, lo stesso utilizzato da `/api/data`: il payload
è sotto `data`, e un errore restituisce `{ "error": { message, code, requestId } }`
con i codici presenti nel [riferimento agli errori](/docs/backend/errors/). `/api/storage/file/*`
rappresenta l'eccezione, poiché il suo payload è il file stesso: restituisce i byte, con
`Content-Type`, `Content-Length` e gli header di caching.

```json
// GET /api/storage/list?prefix=products/images/
{ "data": { "items": [ { "bucket": "default", "fullPath": "products/images/a.jpg", "name": "a.jpg",
  "size": 48213, "updated": "2026-10-01T12:00:00.000Z", "contentType": "image/jpeg" } ], "prefixes": [] } }
```

Un elenco descrive ciascun file restituito: la sua dimensione `size` in byte e
`updated`, ovvero quando è stato scritto l'ultima volta, su storage locale, S3 e GCS, e il suo
`contentType` su storage locale e GCS. Un elenco di S3 non include il tipo,
quindi su S3 è assente e `/api/storage/metadata/*` continuerà a indicarlo. Una cartella in
`prefixes` non riporta nessuno di questi attributi, così come un `StorageController` personalizzato
che non li imposta.

`POST /api/storage/upload` risponde `201` con `{ key, bucket, storageUrl }` dell'oggetto archiviato sotto `data`;
`GET /api/storage/metadata/*` restituisce i metadati dell'oggetto e, per un oggetto privato, il `token` di breve durata; `POST
/api/storage/metadata` restituisce un oggetto indicizzato dai percorsi inviati, ciascuno contenente ciò che la `GET` avrebbe
restituito (vedi sotto). Una cartella non è un oggetto: `/metadata` su una chiave che termina con `/` restituisce `404` su ogni storage, anche dove S3
o GCS mantengono un marcatore `folder/`, pertanto nessun token di download viene generato per un prefisso; `GET /api/storage/sources` restituisce l'array delle
sorgenti configurate, con `configured: true`. Su un'installazione senza storage configurato, risponde `200 {"data": [],
"configured": false}`, mentre ogni altra route restituisce `501 STORAGE_NOT_CONFIGURED`. `GET /api/auth/config` riporta
lo stesso stato come `storage: false`, consentendo a un client di evitare di richiederlo. `GET /api/storage/sources` è pubblico: risponde
senza token anche quando `requireAuth` è abilitato. Elenca le sorgenti (la loro chiave, motore, trasporto ed etichetta) e mai
un file, e l'SDK client lo legge per collegare le proprie sorgenti, operazione che può avvenire prima che chiunque abbia effettuato l'accesso. Anche un'app che
legge una sorgente `direct` in modo anonimo ne ha bisogno. Ogni route che elenca, legge o scrive un file mantiene la propria autenticazione.
`DELETE /api/storage/file/*` e `POST /api/storage/folder` restituiscono solo un `message`, poiché non c'è nulla da ritornare.

Su S3 e GCS, un `bucket` deve essere uno di quelli serviti dalla sorgente, sia in scrittura
che in lettura: un caricamento, un `POST /api/storage/folder` o un caricamento TUS che specifichi qualsiasi altro
bucket restituisce `404 UNKNOWN_STORAGE_SOURCE`, esattamente come l'elenco. Lo storage locale
continua invece a creare un bucket alla sua prima scrittura.

**Molti oggetti contemporaneamente.** `POST /api/storage/metadata` accetta
`{ "keys": ["photos/a.png", "photos/b.png"], "storageId": "media" }` — fino a 100
percorsi di oggetti di una sorgente, ciascuno formattato come verrebbe accettato da `GET /api/storage/metadata/<key>`
— e restituisce una voce per chiave:

```json
{ "data": {
  "photos/a.png": { "fullPath": "photos/a.png", "size": 48213, "contentType": "image/png", "token": "…", "tokenExpiresIn": 300 },
  "photos/b.png": { "error": { "code": "FORBIDDEN", "message": "Not authorized for this object", "status": 403 } }
} }
```

Ogni chiave viene valutata esattamente come farebbe la `GET` — lo stesso
hook `storageAuthorize` e scope di storage, la stessa regola pubblica, un proprio token di download — e una
chiave rifiutata, mancante o non valida risponde con il proprio `error` senza fallire
o rivelare le altre. Un chiamante senza sessione in un'istanza che ne richiede
una riceverà il `401` che la `GET` avrebbe restituito, a meno che tutte le chiavi non siano pubbliche. Più di
100 chiavi, o un body privo di `keys`, comporta un `400 BAD_REQUEST`. Il rate limiter conteggia
la richiesta come ⌈N/10⌉ richieste per N chiavi, quindi una pagina di 100 miniature costa 10 richieste.
`client.storage.getSignedUrl()` e il pannello di amministrazione inviano in blocco le ricerche richieste da una pagina
in questo modo, ripiegando su una singola `GET` per file su un server sprovvisto della
route.

**Come viene autorizzata la lettura di un file.** Le route di lettura — `/api/storage/file/*` e
`/api/storage/metadata/*` — accettano il token firmato a breve durata generato da
[`getSignedUrl()`](/docs/sdk/storage), passato come `?token=<token>` o come
`Bearer`. Un normale JWT di accesso viene **rifiutato** su `/file/*` con `401
Unauthorized: Access JWT not allowed on file routes`: il token che funziona su
ogni altra route non funziona lì, intenzionalmente, poiché l'URL di un file è
qualcosa che viene fornito a un browser, a una CDN o a un tag `<img>`. Tutte le altre righe sopra
accettano il JWT di accesso come di consueto.

## Trasformazioni delle Immagini al Volo

Rebase include una pipeline integrata di elaborazione delle immagini basata su **Sharp**. Durante la distribuzione di risorse immagine dallo storage, è possibile applicare operazioni dinamiche tramite parametri di query:

```bash
# Serve image scaled to 300px width in webp format
GET /api/storage/file/products/laptop.jpg?width=300&format=webp
```

### Parametri Supportati

- `width`, `height`: Limiti di ridimensionamento, `1`–`4096` (l'immagine non viene mai ingrandita).
- `quality`: `1`–`100`.
- `format`: Converte il formato dell'immagine. Formati supportati: `webp`, `jpeg`, `png`, `avif`.
- `fit`: `cover`, `contain`, `fill`, `inside` o `outside`.

Un parametro al di fuori di questi intervalli restituisce un **400**, non un valore silenziosamente limitato —
in precedenza `?width=99999` restituiva un'immagine da 4096px e `?format=tiff` una in webp,
senza alcuna segnalazione.

Le miniature delle immagini archiviate nel pannello di amministrazione utilizzano questo endpoint: l'anteprima
di una tabella o di una scheda richiede una versione webp di circa il doppio delle dimensioni renderizzate (96–800px)
anziché l'originale. I file SVG e GIF vengono sempre mostrati così come sono.
`sharp` è opzionale:
in sua assenza, una richiesta di trasformazione riceve l'originale e il backend avverte una sola volta di
eseguire `pnpm add sharp` in `backend/`.

### Prestazioni e Caching LRU

La trasformazione richiede un elevato uso di CPU e memoria e, su un oggetto pubblico, l'endpoint è
accessibile anonimamente; pertanto, il carico di lavoro viene delimitato anziché semplicemente memorizzato nella cache:
- **Capacità**: una cache LRU limitata a **500 voci** a livello globale, indicizzata per sorgente
  di storage, bucket e chiave canonica.
- **TTL (Time to Live)**: Le varianti memorizzate nella cache scadono dopo **1 ora**.
- Richieste simultanee per la stessa variante non presente nella cache producono **una sola** trasformazione,
  non una per ciascuna.
- Viene eseguito contemporaneamente solo un numero ridotto di trasformazioni; superato un limite di backlog prefissato, il server
  risponde con **503 `TRANSFORM_OVERLOADED`** invece di accettare lavoro che non riuscirà
  a smaltire.

Tale cache risiede nel processo, il che significa che non è condivisa tra le istanze
e non sopravvive a un riavvio. Due repliche elaboreranno ciascuna ogni variante e un
nuovo deployment eliminerà l'intera cache.

### Rendition che Sopravvivono al Riavvio

`storageRenditionCache` riscrive ciascuna immagine derivata nello stesso bucket della sua
sorgente, in modo che l'elaborazione venga eseguita una sola volta per l'intera infrastruttura anziché una volta per
istanza per release:

```ts
storageRenditionCache: { enabled: true }
```

oppure `STORAGE_RENDITION_CACHE=true` per un deployment tramite bundle. Le rendition sono archiviate
sotto il prefisso riservato `_rebase/renditions/`, indicizzate in base alla versione dell'oggetto sorgente
— pertanto la sostituzione di un'immagine rende immediatamente disponibile la nuova versione.

Tre aspetti fondamentali da considerare prima di abilitarlo:

- **Una lettura comporta ora una scrittura.** Ogni nuova variante richiede un `PUT` nel tuo bucket. Per
  questa ragione la funzionalità è disattivata per impostazione predefinita.
- **Una scrittura fallita non compromette la richiesta.** Credenziali di sola lettura, o una policy
  del bucket che rifiuta il prefisso, degradano l'operazione all'uso della cache in-process; l'immagine viene
  comunque servita e la motivazione viene registrata nei log una sola volta.
- **Le rendition sostituite non vengono eliminate automaticamente.** La sostituzione di un oggetto sorgente
  lascia orfane le sue vecchie rendition. Configura una regola di ciclo di vita su `_rebase/renditions/`
  — tale prefisso è fisso e non configurabile, proprio per consentire di specificarlo in una regola.

Il prefisso non è indirizzabile tramite API. La lettura o scrittura diretta su di esso
risponde con **400 `INVALID_STORAGE_KEY`**: ogni regola di accesso nel prodotto —
sia `storageAuthorize` che le policy dichiarative — è definita rispetto alla
chiave *sorgente*, e una rendition servita sotto il proprio percorso risponderebbe a una richiesta
non prevista.

`_rebase/maintenance/` è riservato allo stesso modo. `rebase storage orphans` memorizza
lì i record di ogni scansione, nella sorgente che ha scansionato, in modo che il processo che
esegue la scansione e quello che ne restituisce lo stato leggano lo stesso record. Un
chiamante in grado di scrivere un record potrebbe scegliere cosa verrebbe rimosso da una successiva eliminazione, quindi
anche la lettura, la scrittura o l'elenco del prefisso restituiscono 400. I record vengono eliminati 7
giorni dopo l'ultima scrittura, all'avvio della scansione successiva di quella sorgente.

### Cosa Viene Servito

Il content type memorizzato è quello dichiarato da chi effettua l'upload — nessun processo analizza
i byte — pertanto `/api/storage/file/*` eseguirà il rendering inline solo per una **ristretta allowlist**:
immagini, video, audio, `application/pdf` e `text/plain`. Qualsiasi altro formato,
incluso `text/html`, viene servito come `application/octet-stream` con
`Content-Disposition: attachment`, e ogni risposta include l'header
`X-Content-Type-Options: nosniff`. Lo storage non funge da host web: una pagina caricata
e renderizzata sull'origine dell'API potrebbe leggere i cookie di tale origine e chiamarne
gli endpoint.

Un SVG è un'immagine che costituisce anche un documento e può contenere tag `<script>`. Viene
servito come `image/svg+xml` — così da poter essere renderizzato in un tag `<img>` e nelle miniature
del pannello di amministrazione — con l'header
`Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline'; sandbox`
in ogni risposta, inclusi gli URL trasformati e gli URL con token di download. Se aperto
direttamente, viene renderizzato con gli script disabilitati e un'origine opaca, impedendogli di
accedere ai cookie o agli endpoint dell'API.

## Limiti di Dimensione dei File

Ogni sorgente di storage accetta file fino al proprio limite: **50 MB** a meno che
`STORAGE_MAX_FILE_SIZE` (in byte, con suffisso `__<KEY>` per una sorgente con nome) o il parametro
`maxFileSize` della sorgente non indichino diversamente. Ogni punto di accesso vincola il file alla stessa
dimensione. `POST /api/storage/upload` risponde con `413 PAYLOAD_TOO_LARGE` se superato; un
caricamento ripristinabile viene rifiutato al momento della creazione, prima del suo primo blocco; e
`OPTIONS /api/storage/tus` lo dichiara come `Tus-Max-Size` — per la sorgente
indicata da `?storageId=`, oppure per quella predefinita.

```bash
STORAGE_MAX_FILE_SIZE=209715200          # (default): 200 MB
STORAGE_MAX_FILE_SIZE__MEDIA=1073741824  # media: 1 GB
```

La quantità di dati di un file che il server trattiene contemporaneamente in memoria dipende dal metodo di caricamento.
`POST /api/storage/upload` consiste in un unico corpo multipart, che il server analizza per intero:
da tre a cinque volte la dimensione del file nella sua memoria. Un caricamento ripristinabile (TUS) gestisce un solo
blocco alla volta. `client.storage.putObject()` e il pannello di amministrazione inviano i file
superiori a 8 MiB tramite caricamento ripristinabile. Consulta
[Caricamenti ripristinabili (TUS)](/docs/backend/storage-resumable-uploads/) per il
protocollo, le risposte e il comportamento tra diverse istanze.

## Variabili d'Ambiente

| Variabile | Descrizione |
|----------|-------------|
| `STORAGE_TYPE` | `"local"`, `"s3"` o `"gcs"` |
| `STORAGE_PATH` | Directory di storage locale (predefinita: `<project>/uploads`, sia con `rebase dev` che in un server generato da `rebase eject`). Un percorso relativo viene risolto a partire dalla directory in cui è in esecuzione il server, che dopo `rebase eject` è `backend/`. Un bucket locale con nome archivia i propri file a fianco, in `<STORAGE_PATH>__<key>`, a meno che `STORAGE_PATH__<KEY>` non specifichi un percorso personalizzato |
| `S3_BUCKET` | Nome del bucket S3 |
| `S3_REGION` | Regione AWS (predefinita: `"auto"`) |
| `S3_ACCESS_KEY_ID` | Chiave di accesso AWS |
| `S3_SECRET_ACCESS_KEY` | Chiave segreta AWS |
| `S3_ENDPOINT` | Endpoint S3 personalizzato (per MinIO, R2) |
| `S3_FORCE_PATH_STYLE` | Utilizza URL in formato path-style (richiesto per MinIO) |
| `GCS_BUCKET` | Nome del bucket Google Cloud Storage |
| `GCS_PROJECT_ID` | GCP project ID per GCS |
| `GCS_KEY_FILENAME` | Percorso del file della chiave dell'account di servizio GCP (omettere su GKE — le credenziali vengono fornite da Workload Identity/ADC) |
| `GOOGLE_APPLICATION_CREDENTIALS` | Variabile standard ADC, letta direttamente dall'SDK di Google (non necessaria su GCP con credenziali predefinite) |
| `STORAGE_DOWNLOAD_TOKEN_TTL` | Durata di validità in secondi dell'URL di download di un file privato — la durata del token generato da `/api/storage/metadata/*` (predefinito `300`, massimo `604800`, ossia una settimana). Aumentalo per audio e video privati, che continuano a richiedere intervalli di byte (range) dopo il rendering della pagina. È la versione variabile d'ambiente di `storageDownloadTokenTtl` |
| `STORAGE_MAX_FILE_SIZE` | File più grande accettato dalla sorgente, in byte (predefinito `52428800`, 50 MB). Aggiungi il suffisso `__<KEY>` per una sorgente con nome. Un valore che non corrisponde a un numero intero di byte impedisce l'avvio. Consulta [Limiti di Dimensione dei File](#limiti-di-dimensione-dei-file) |
| `FORCE_LOCAL_STORAGE` | Consente l'uso di `STORAGE_TYPE=local` in produzione — vedi sotto |
| `STORAGE_PUBLIC_READ` | Distribuisce gli oggetti archiviati a lettori non autenticati. È la versione variabile d'ambiente di `storagePublicRead`, nonché uno dei tre modi per soddisfare il [controllo di sicurezza all'avvio in produzione](#autorizzazione-per-oggetto). |
| `STORAGE_ALLOW_ANY_AUTHENTICATED` | Disattiva il controllo di sicurezza all'avvio, ripristinando il comportamento in base al quale qualsiasi utente autenticato può leggere, sovrascrivere, eliminare o elencare qualsiasi chiave. È la versione variabile d'ambiente di `storageInsecureAllowAnyAuthenticated`. Ammissibile solo quando ogni utente autenticato è ritenuto affidabile per qualunque file. |

## Bucket Multipli

Un progetto può disporre di più di un bucket. Dichiarane ciascuno in `backend/resources.ts`
— l'unico punto letto congiuntamente dalla piattaforma, dal runtime e dalla console:

```ts
import { bucket } from "@rebasepro/types";

export const uploads = bucket({ engine: "s3" });    // the default one
export const media = bucket("media", { engine: "s3", label: "Media" });
```

Quindi esegui `rebase resources --write`, che rigenera `rebase.resources.json`
affinché un host possa interpretare la tua topologia senza dover eseguire una build. Consulta
[Sorgenti Multiple](/docs/backend/multiple-sources) per la gestione combinata di database, bucket e
topic.

Ciascuna sorgente viene configurata tramite gli **stessi nomi di variabile che includono il relativo
suffisso**. La sorgente predefinita non accetta suffissi, per cui un progetto a bucket singolo continua
a utilizzare i nomi base descritti in precedenza senza richiedere alcuna dichiarazione aggiuntiva; inoltre, dichiarare
bucket con nome al suo fianco non ne modifica la configurazione ([dettagli](/docs/backend/multiple-sources/#which-bucket-receives-an-unqualified-upload)):

```bash
S3_BUCKET=app-uploads             # (default)
S3_BUCKET__MEDIA=app-media        # media
S3_ACCESS_KEY_ID__MEDIA=…
S3_SECRET_ACCESS_KEY__MEDIA=…
```

Il suffisso deriva dalla chiave: convertito in lettere maiuscole, con caratteri non alfanumerici trasformati
in underscore, preceduto da un **doppio** underscore (`media-cdn` → `__MEDIA_CDN`). Un
singolo underscore entrerebbe in conflitto con i nomi effettivi delle variabili — `S3_BUCKET_NAME`
verrebbe interpretato come bucket `name`.

Indirizza una colonna a una specifica sorgente tramite `source`:

```ts
cover: col.storage({ path: "covers/", source: "media", accept: ["image/*"] }),
```

Una sorgente dichiarata ma mai configurata viene **ignorata**, non genera errori bloccanti: i caricamenti
indirizzati ad essa rispondono con `501 STORAGE_SOURCE_NOT_CONFIGURED`. La dichiarazione di un bucket avviene
solitamente prima che vi venga collegato uno storage, e generare un errore all'avvio provocherebbe
un ciclo continuo di crash del backend fino alla sua configurazione. Una sorgente configurata nell'ambiente
in modo *errato* — una tipologia senza bucket, o un bucket privo di credenziali — viene invece rifiutata
all'avvio, poiché si tratta di un errore di configurazione e non di una semplice assenza.

### Bucket che Condividono lo Stesso Account

Le credenziali descrivono solitamente il **provider**, non il bucket. Quindici bucket su
una singola installazione di MinIO richiederebbero altrimenti quindici copie della stessa chiave di accesso, e
una rotazione implicherebbe quindici modifiche coordinate. È possibile specificare un account condiviso:

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

Solo le variabili associate all'account prevedono il fallback — `S3_ACCESS_KEY_ID`,
`S3_SECRET_ACCESS_KEY`, `S3_ENDPOINT`, `S3_REGION`, `S3_FORCE_PATH_STYLE`, e
la coppia di variabili GCS `GCS_PROJECT_ID` / `GCS_KEY_FILENAME`. Il nome del bucket non effettua mai il fallback:
è ciò che distingue una sorgente dall'altra. Un valore specificato per singolo bucket ha comunque la priorità,
consentendo a una sorgente di cambiare provider senza intaccare le altre.

### Eliminazione Programmata dei File Non Associati a Record

L'eliminazione di un record lascia i suoi file nel bucket. Nessun file viene eliminato contestualmente al record:
un altro record, una versione nello [storico](/docs/backend/history/), o il tuo stesso codice
che memorizza la chiave in una stringa potrebbero fare ancora riferimento al file. Un bucket può richiedere
l'operazione di pulizia in grado di rilevare tutti questi riferimenti:

```ts
export const voice = bucket("voice", { engine: "s3", orphanSweep: { olderThanHours: 72 } });
export const media = bucket("media", { orphanSweep: true }); // a week, daily at 04:17 UTC
```

Ogni sweep dichiarato costituisce un cron job, `storage-orphan-sweep-<bucket>`
(`storage-orphan-sweep-default` per il bucket predefinito). Esegue la scansione sottostante a
`rebase storage orphans --delete`. Tale scansione analizza ogni riga di ciascuna
tabella e ogni voce dello storico, preservando:

- qualsiasi file a cui si faccia ancora riferimento;
- qualsiasi file più recente di `olderThanHours` (minimo 24 ore, una settimana per impostazione predefinita);
- tutti i file, per tale esecuzione, nel caso in cui una tabella non possa essere letta.

Verifica nuovamente ciascun file subito prima di eliminarlo. Imposta `schedule` con
un'espressione cron (UTC) per modificarne la frequenza di esecuzione. Trattandosi di un cron job, viene eseguito su
una sola istanza per slot temporale. Lo storico delle esecuzioni registra quanti file sono stati eliminati e quanti preservati,
e l'operazione può essere sospesa o avviata manualmente dall'elenco cron dell'amministratore. Richiede un
bucket servito da questo backend: un bucket con `transport: "direct"` viene rifiutato all'avvio
con un avviso.

## Sorgenti di Storage nel Frontend

Il frontend recupera le sorgenti del server tramite `GET /api/storage/sources`, pertanto una sorgente di tipo `server` non richiede alcuna dichiarazione. Passa `storageSources` al provider `<Rebase>` per una sorgente `direct`, che effettua i caricamenti direttamente al rispettivo provider, oppure per definire autonomamente un'etichetta o un trasporto:

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

La proprietà `key` di una sorgente `server` deve corrispondere a una chiave backend registrata nella mappa `storage` del server. Il contesto React `StorageSourcesContext` risolve la sorgente attiva per ciascun campo di caricamento.

## Caching e CDN

Tutti gli oggetti vengono instradati tramite proxy attraverso il server, con un `ETag` per una validazione
a basso costo, un `Cache-Control` calibrato in base a chi è autorizzato alla lettura e intervalli di byte (byte ranges)
per la riproduzione con avanzamento di audio e video. La documentazione su [Caching dello storage e CDN](/docs/backend/storage-caching/)
illustra gli header disponibili e come configurare una CDN di frontiera.

## Suggerimenti per la Produzione

:::caution
**In produzione, `type: "local"` disabilita lo storage dei file anziché utilizzarlo.** Su una piattaforma effimera (Cloud Run, Heroku, un pod Kubernetes) il filesystem viene cancellato a ogni deploy, riavvio o rimozione dell'istanza — i caricamenti andrebbero a buon fine, la lettura funzionerebbe correttamente, ma i file andrebbero persi al successivo rilascio, senza generare alcun errore.

Pertanto, l'impostazione predefinita locale non viene registrata e una richiesta a `/api/storage/*` che non specifica alcuna sorgente di storage risponde con **`501 STORAGE_NOT_CONFIGURED`**, indicando le sorgenti effettivamente disponibili. Una sorgente con nome configurata, come ad esempio `bucket("media", { engine: "s3" })`, continua a funzionare regolarmente. I caricamenti falliscono in modo esplicito e recuperabile; il resto dell'applicazione continua a essere operativo. Lo storage dei file è attivabile esplicitamente in produzione: diventa disponibile non appena viene definito un bucket.

Imposta `STORAGE_TYPE=s3` o `gcs`. Se un **volume durevole** gestisce effettivamente `STORAGE_PATH`, imposta `FORCE_LOCAL_STORAGE=true` per dichiararlo esplicitamente. Montalo sulla directory padre di `STORAGE_PATH`, in modo che anche la cartella `<STORAGE_PATH>__<key>` di ciascun bucket locale con nome risieda su di esso.
:::

- Monta un **volume persistente** sulla cartella padre di `STORAGE_PATH` se utilizzi lo storage locale su Docker/Kubernetes, e imposta `FORCE_LOCAL_STORAGE=true` — consulta [Self-hosting](/docs/deployment/self-hosting/#file-storage)
- Utilizza **S3** o compatibili (R2, MinIO), o **GCS**, per distribuzioni in ambienti di produzione
- Configura una **CDN** (CloudFront, Cloudflare) a monte per ottimizzare le prestazioni — consulta [Configurare una CDN](/docs/backend/storage-caching/#putting-a-cdn-in-front)
- **Qualsiasi applicazione con storage in produzione deve dichiarare un modello di accesso** — consulta
  [Autorizzazione dello Storage](/docs/backend/storage-authorization/).
  Non solo quelle multi-tenant: il server *rifiuterà l'avvio* in assenza di un modello definito.

## Autorizzazione per Oggetto

I permessi di lettura, scrittura, eliminazione o elenco per ciascuna chiave sono determinati da `storagePolicies`
e dall'hook `storageAuthorize`; inoltre, una chiave API necessita dello scope di storage adeguato per
l'operazione richiesta. L'ambiente di produzione impedisce l'avvio in presenza di storage senza un modello di accesso. Consulta
[Autorizzazione dello Storage](/docs/backend/storage-authorization/).

## Reagire a un Caricamento

Qualsiasi altra scrittura in Rebase consente di agganciare azioni di risposta — un record dispone di `beforeSave` e
`afterSave`, una pianificazione di un cron job — mentre per il caricamento non era previsto nulla. Qualsiasi logica
derivata da un caricamento doveva essere eseguita dal client con una seconda chiamata, rischiando di non essere
completata se il client si disconnetteva nel frattempo.

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

La sintassi dei pattern è la medesima di `storagePolicies` — segmenti letterali, `*`
per un singolo segmento, `:name` per catturarne uno, `**` per il resto — e un pattern
malformato blocca l'avvio anziché ignorare le corrispondenze in modo silenzioso.

| Evento | Quando |
| --- | --- |
| `finalize` | dopo che l'oggetto è stato scritto in modo persistente; mai per una scrittura fallita |
| `delete` | dopo che l'oggetto è stato eliminato |

`finalize` viene attivato sia per i flussi multipart che per quelli ripristinabili (TUS) — una sola volta
per caricamento, non una volta per blocco — e un caricamento ripristinabile riporta l'utente che lo ha
*creato*, essendo l'identità verificata durante l'autorizzazione.

Cosa un gestore (handler) non deve presupporre:

- **Un errore nel gestore non fa fallire la richiesta.** L'oggetto è già stato archiviato
  nel momento in cui il gestore viene eseguito, pertanto restituire un errore al client indicherebbe
  il fallimento del caricamento anche se avvenuto con successo, inducendo i client a ritentare. Gli errori vengono registrati nei log
  e la risposta rimane invariata. Se l'operazione deve essere garantita, accoda un job.
- **I gestori vengono attesi (await)**, nell'ordine di dichiarazione, prima dell'invio della risposta —
  un approccio basato su fire-and-forget lascerebbe una promise che un runtime serverless potrebbe
  congelare durante l'esecuzione. Un gestore lento rende quindi il caricamento lento, ulteriore
  motivo per preferire l'accodamento di job rispetto all'elaborazione sincrona in questa sede.
- **Le scritture interne non attivano i trigger.** La cache delle rendition delle immagini scrive gli
  oggetti derivati direttamente nel controller di archiviazione; un trigger `**` attivato su
  questi finirebbe per essere scatenato dal suo stesso output.

## Passaggi Successivi

- **[Storage Frontend e Caricamento File](/docs/frontend/storage)** — Campi e hook per il caricamento dei file
- **[Colonne](/docs/schema/columns/#storage-columns)** — `col.storage()` e le sue opzioni
