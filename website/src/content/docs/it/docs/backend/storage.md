---
sourceHash: c6ff4a9052df3362
title: Configurazione dell'archiviazione
sidebar_label: Configurazione archiviazione
description: Configura backend di archiviazione su filesystem locale, compatibili con S3 o GCS/Firebase Storage per caricamenti di file, immagini e media.
---

## Panoramica

Rebase supporta tre backend di archiviazione:

- **Filesystem locale** — File archiviati su disco (ideale per lo sviluppo)
- **Compatibile con S3** — AWS S3, MinIO, Cloudflare R2, DigitalOcean Spaces
- **Google Cloud Storage / Firebase Storage** — Supporto nativo di GCS tramite `@google-cloud/storage`

## Configurazione

L'archiviazione viene configurata nel blocco `storage` di `initializeRebaseBackend`:

### Archiviazione Locale

```typescript no-verify
const backend = await initializeRebaseBackend({
    // ...
    storage: {
        type: "local",
        basePath: "./uploads"   // Directory for file storage
    }
});
```

### Archiviazione S3

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

Su GCP (Cloud Run, GCE, GKE), le credenziali dell'account di servizio predefinito vengono usate automaticamente. Al di fuori di GCP, imposta la variabile d'ambiente `GOOGLE_APPLICATION_CREDENTIALS` sul percorso del file di chiave del tuo account di servizio.

### Backend di Archiviazione Multipli

Puoi configurare più backend con nome e indirizzare campi diversi verso archiviazioni diverse:

```typescript
storage: {
    "(default)": { type: "local", basePath: "./uploads" },
    "media": { type: "s3", bucket: "media-bucket", region: "us-east-1", ... }
}
```

Poi, nelle proprietà della collezione, fai riferimento a un backend specifico:

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

## Endpoint di Archiviazione

| Metodo | Percorso | Descrizione |
|--------|------|-------------|
| `POST` | `/api/storage/upload` | Caricamento diretto del file |
| `POST` | `/api/storage/upload?storageId=<key>` | Caricare su un backend con nome specifico |
| `GET` | `/api/storage/file/*` | Recuperare un file — tutto ciò che segue `/file/` è la chiave dell'oggetto |
| `GET` | `/api/storage/file/*?storageId=<key>` | Recuperare un file da un backend specifico |
| `GET` | `/api/storage/metadata/*` | Dimensione, content type e ultima modifica di un oggetto, senza i suoi byte |
| `DELETE` | `/api/storage/file/*` | Eliminare un file |
| `GET` | `/api/storage/list` | Elencare gli oggetti sotto un prefisso (`prefix`, `bucket`, `maxResults`, `pageToken`, `storageId`) |
| `POST` | `/api/storage/folder` | Creare un marcatore di cartella vuota |
| `GET` | `/api/storage/sources` | Le sorgenti di storage servite da questo backend, per chiave |
| `OPTIONS` | `/api/storage/tus` | Interrogare le funzionalità supportate del protocollo TUS |
| `POST` | `/api/storage/tus` | Avviare una sessione di caricamento ripristinabile TUS |
| `HEAD` | `/api/storage/tus/:id` | Controllare l'avanzamento del caricamento (offset in byte) |
| `PATCH` | `/api/storage/tus/:id` | Aggiungere un blocco di dati al file temporaneo |
| `DELETE` | `/api/storage/tus/:id` | Terminare/annullare la sessione di caricamento TUS |

**Che cosa rispondono.** Una sola busta, la stessa di `/api/data`: il payload sta
sotto `data`, e un fallimento è `{ "error": { message, code, requestId } }` con i
codici del [riferimento degli errori](/docs/backend/errors/). `/api/storage/file/*`
è l'eccezione, perché il suo payload è il file — risponde con i byte, con
`Content-Type`, `Content-Length` e le intestazioni di cache.

```json
// GET /api/storage/list?prefix=products/images/
{ "data": { "items": [ { "bucket": "default", "fullPath": "products/images/a.jpg", "name": "a.jpg" } ], "prefixes": [] } }
```

`POST /api/storage/upload` risponde `201` con il `{ key, bucket, storageUrl }`
dell'oggetto salvato sotto `data`; `GET /api/storage/metadata/*` i metadati
dell'oggetto e, per un oggetto privato, il `token` di breve durata;
`GET /api/storage/sources` l'array delle sorgenti configurate.
`DELETE /api/storage/file/*` e `POST /api/storage/folder` portano solo un
`message`, perché non c'è nulla da restituire.

**Come viene autorizzata la lettura di un file.** Le rotte di lettura —
`/api/storage/file/*` e `/api/storage/metadata/*` — accettano il token firmato e di
breve durata emesso da [`getSignedUrl()`](/docs/sdk/storage), passato come
`?token=<token>` o come `Bearer`. Un normale JWT di accesso viene **rifiutato** su
`/file/*` con `401 Unauthorized: Access JWT not allowed on file routes`: il token che
funziona su ogni altra rotta qui non funziona, di proposito, perché l'URL di un file lo
si consegna a un browser, a una CDN o a un tag `<img>`. Ogni altra riga qui sopra
accetta il JWT di accesso come sempre.

## Trasformazioni delle Immagini al Volo

Rebase include una pipeline di elaborazione delle immagini integrata basata su **Sharp**. Quando servi asset immagine dall'archiviazione, puoi applicare operazioni dinamiche usando parametri di query:

```bash
# Serve image scaled to 300px width in webp format
GET /api/storage/file/products/laptop.jpg?width=300&format=webp
```

### Parametri Supportati

- `width`: Ridimensiona l'immagine alla larghezza specificata (mantenendo le proporzioni).
- `format`: Converte il formato dell'immagine. Formati supportati: `webp`, `jpeg`, `png`, `avif`.

### Prestazioni e Cache LRU

Per prevenire un elevato utilizzo della CPU e la latenza di scalabilità sotto traffico intenso, le immagini elaborate vengono archiviate in una **cache LRU** basata su memoria:
- **Capacità**: Limitata a **500 voci** globalmente.
- **TTL (Time to Live)**: Le varianti in cache scadono dopo **1 ora**.
- Le richieste successive per la stessa combinazione dimensione/formato colpiscono istantaneamente la cache LRU, prevenendo manipolazioni ridondanti dei file.

## Protocollo di Caricamento Ripristinabile TUS

Per caricare file di grandi dimensioni (fino a **5 GB**) o gestire condizioni di rete instabili, Rebase implementa il protocollo aperto **TUS v1.0.0**, incluse le estensioni `Creation` e `Termination`.

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

### Meccanica del Ciclo di Vita del Caricamento

1. **Inizializzazione della sessione (`POST`)**: Il client invia la dimensione totale del file nell'header `Upload-Length` e i metadati in base64 tramite `Upload-Metadata`. Il server crea un file segnaposto vuoto in una directory temporanea nascosta `.tus-uploads/` e restituisce l'URL di caricamento.
2. **Richieste di avanzamento (`HEAD`)**: Se un caricamento viene interrotto, il client interroga l'URL di caricamento usando una richiesta `HEAD`. Il server restituisce la posizione corrente in byte nell'header `Upload-Offset`.
3. **Aggiunta di dati (`PATCH`)**: Il client riprende l'invio di dati binari a partire dall'offset restituito con `Content-Type: application/offset+octet-stream`. Il server scrive i blocchi in arrivo direttamente nel file temporaneo usando le API di basso livello `open` e `write` di Node all'offset in byte specificato.
4. **Finalizzazione**: Quando l'`Upload-Offset` accumulato corrisponde all'`Upload-Length` dichiarato, Rebase legge il file temporaneo completato, lo avvolge come un oggetto `File` standard di JavaScript e lo salva nel backend di archiviazione configurato (disco locale o S3). Il file temporaneo viene quindi eliminato.
5. **Pulizia periodica**: Un pulitore in background viene eseguito ogni **60 secondi** per eliminare i caricamenti temporanei orfani e incompleti che hanno superato la soglia di conservazione di **24 ore**.

## Variabili d'Ambiente

| Variabile | Descrizione |
|----------|-------------|
| `STORAGE_TYPE` | `"local"`, `"s3"` o `"gcs"` |
| `STORAGE_PATH` | Directory di archiviazione locale (predefinito: `./uploads`) |
| `S3_BUCKET` | Nome del bucket S3 |
| `S3_REGION` | Regione AWS (predefinito: `"auto"`) |
| `S3_ACCESS_KEY_ID` | Chiave di accesso AWS |
| `S3_SECRET_ACCESS_KEY` | Chiave segreta AWS |
| `S3_ENDPOINT` | Endpoint S3 personalizzato (per MinIO, R2) |
| `S3_FORCE_PATH_STYLE` | Usare URL in stile path (richiesto per MinIO) |
| `GCS_BUCKET` | Nome del bucket Google Cloud Storage |
| `GCS_PROJECT_ID` | ID progetto GCP per GCS |
| `GOOGLE_APPLICATION_CREDENTIALS` | Percorso del file di chiave dell'account di servizio GCP (non necessario su GCP con credenziali predefinite) |

## Sorgenti di Archiviazione del Frontend

Quando usi più backend di archiviazione, passa `storageSources` al provider `<Rebase>` in modo che il frontend sappia come indirizzare i caricamenti direttamente:

```tsx
import { Rebase } from "@rebasepro/app";

<Rebase
    apiUrl="https://api.example.com"
    storageSources={[
        { key: "media", label: "Media CDN" },
        { key: "firebase", label: "Firebase Storage" },
    ]}
>
    {/* ... */}
</Rebase>
```

La `key` di ogni sorgente deve corrispondere a una chiave di backend registrata nella mappa `storage` del server. Il contesto React `StorageSourcesContext` risolve la sorgente attiva per ogni campo di caricamento.

## Suggerimenti per la Produzione

:::caution
**In produzione `type: "local"` disattiva l'archiviazione dei file invece di usarla.** Su piattaforme effimere (Cloud Run, Heroku, un pod Kubernetes) il filesystem viene cancellato a ogni deployment, riavvio ed eviction: i caricamenti riuscirebbero, si rileggerebbero correttamente e sparirebbero al rollout successivo, senza alcun errore.

Per questo non viene registrato alcun backend di archiviazione e `/api/storage/*` risponde **`501 STORAGE_NOT_CONFIGURED`**. I caricamenti falliscono in modo visibile e recuperabile, e il resto dell'applicazione continua a funzionare.

Imposta `STORAGE_TYPE=s3` o `gcs`. Se un **volume durevole** è davvero montato su `STORAGE_PATH`, dichiaralo esplicitamente con `FORCE_LOCAL_STORAGE=true`.
:::

- Monta un **volume persistente** se usi l'archiviazione locale su Docker/Kubernetes, e imposta `FORCE_LOCAL_STORAGE=true`
- Usa **S3** o compatibile (R2, MinIO) per i deployment di produzione
- Configura una **CDN** (CloudFront, Cloudflare) davanti al tuo bucket S3 per le prestazioni

## Prossimi Passi

- **[Archiviazione e caricamento file nel Frontend](/docs/frontend/storage)** — Campi e hook per il caricamento dei file
- **[Proprietà](/docs/collections/properties)** — Configurazione della proprietà di archiviazione
