---
sourceHash: c01ec36e7192bb7f
title: Rebase Storage
sidebar_label: Rebase Storage
description: "Object storage compatibile con S3 in Rebase Cloud: l'endpoint, bucket e chiavi, le operazioni S3 supportate, limiti, prezzi, dove sono archiviati i dati e come connettere aws-cli, rclone, boto3 e l'SDK AWS per JavaScript."
---

Rebase Storage è l'object storage in Rebase Cloud. Supporta l'API S3, quindi
qualsiasi client o SDK S3 funziona fornendo semplicemente l'endpoint e una chiave.
Un'app Rebase su Rebase Cloud lo utilizza senza alcuna configurazione; qualsiasi
altra cosa — uno script, un processo di backup, un altro servizio — si connette
tramite una chiave creata dall'utente.

## Endpoint e regione

| | |
|---|---|
| Endpoint | `https://s3.eu-central-1.rebase.pro` |
| Regione | `eu-central-1` |
| URL path-style | `https://s3.eu-central-1.rebase.pro/<bucket>/<key>` |
| URL virtual-hosted | `https://<bucket>.s3.eu-central-1.rebase.pro/<key>` |

Entrambi gli stili di URL sono supportati, quindi un client può utilizzare l'uno o l'altro.

## Bucket

Crea un bucket nella console o tramite la CLI:

```bash
rebase cloud storage create my-bucket
rebase cloud storage delete my-bucket
```

I nomi dei bucket sono globali in Rebase Storage: da 3 a 63 caratteri, lettere
minuscole, cifre e trattini, nessun punto.

I bucket non vengono creati tramite la chiamata S3 `CreateBucket`. La chiamata
`CreateBucket` per un bucket già posseduto restituisce `BucketAlreadyOwnedByYou`.

## Chiavi

<span class="since-badge" data-since="0.35">Da 0.35</span>

Rebase emette le chiavi di accesso. Ciascuna chiave è in **sola lettura** o in
**lettura e scrittura**, e si applica a un singolo bucket o a tutti i bucket del progetto.

```bash
rebase cloud storage keys create
rebase cloud storage keys rotate
rebase cloud storage keys revoke
```

La console esegue la stessa operazione. Il secret viene mostrato una sola volta,
al momento della creazione o della rotazione della chiave, ed è memorizzato
crittografato. Una chiave revocata smette di funzionare nel giro di pochi secondi.

## App Rebase su Rebase Cloud

Un'app Rebase distribuita su Rebase Cloud ottiene automaticamente il proprio bucket
e una chiave. La piattaforma imposta queste variabili d'ambiente sull'app:

| Variabile | Valore |
|---|---|
| `STORAGE_TYPE` | `s3` |
| `S3_ENDPOINT` | L'endpoint dello storage |
| `S3_REGION` | `eu-central-1` |
| `S3_BUCKET` | Il bucket del progetto |
| `S3_ACCESS_KEY_ID` | La chiave dell'app |
| `S3_SECRET_ACCESS_KEY` | Il secret dell'app |
| `S3_FORCE_PATH_STYLE` | `true` |

Il traffico tra l'app e Rebase Storage rimane all'interno del cluster. Il modo in
cui l'app serve e autorizza i file è descritto in
[File storage](/docs/backend/storage/) e
[Managed backend runtime](/docs/deployment/managed-runtime/#storage-for-generated-files).

## Operazioni S3 supportate

| Area | Operazioni |
|---|---|
| Oggetti | `PutObject`, `GetObject` (range, intestazioni condizionali, override di `response-*`), `HeadObject`, `DeleteObject`, `DeleteObjects`, `CopyObject` all'interno dello stesso bucket (fino a 5 GB) |
| Elenco | `ListObjectsV2`, `ListObjects` |
| Upload multipart | `CreateMultipartUpload`, `UploadPart`, `CompleteMultipartUpload`, `AbortMultipartUpload`, `ListParts`, `ListMultipartUploads` |
| Bucket | `HeadBucket`, `ListBuckets`, `GetBucketLocation`, `GetBucketCors` |
| URL pre-firmati | Validi fino a 7 giorni |

Le richieste sono firmate esclusivamente con **SigV4**. Sono accettati caricamenti con
codifica `aws-chunked` e checksum finali (trailing checksums), con CRC32, CRC32C,
CRC64NVME, SHA1 o SHA256, garantendo il funzionamento senza configurazione del
comportamento predefinito di checksum degli SDK AWS.

Tutto il resto restituisce `NotImplemented`. Ciò include:

- ACL e policy di bucket. Gli oggetti sono sempre privati; per condividere un file,
  fornisci un URL pre-firmato.
- Bucket pubblici.
- Versioni degli oggetti e `versionId`.
- Tagging degli oggetti, blocco degli oggetti (object lock) e regole del ciclo di vita.
- Intestazioni di crittografia lato server.
- `UploadPartCopy` e copia tra bucket.
- Upload via `POST` da browser (upload da form HTML). Utilizza invece una `PUT` pre-firmata.

### CORS

Configura le regole CORS di un bucket nella console o con `rebase cloud storage cors`.
Rebase Storage risponde alle richieste preflight in base a tali regole, consentendo a
un browser di eseguire richieste `GET` o `PUT` su un URL pre-firmato dal tuo sito.

## Limiti

| | Limite |
|---|---|
| Singola `PUT` | 5 GB |
| Upload multipart | 10.000 parti, 5 GB per parte |
| Dimensione oggetto | 5 TB |
| Metadati utente | 2 KB per oggetto |
| Bucket | 100 per progetto |
| Chiavi | 200 per progetto |

Ogni progetto ha inoltre un limite sulla frequenza delle richieste (request rate).
Le richieste che superano tale limite ricevono `503 SlowDown`, che i client S3
ritentano applicando un backoff.

## Prezzi

Ogni progetto include **10 GB**. Oltre tale soglia, lo spazio di archiviazione costa
**0,03 € per GB al mese**, conteggiato esclusivamente sulla versione corrente di
ciascun oggetto.

I file eliminati e sovrascritti vengono conservati per 30 giorni e possono essere
ripristinati dal supporto durante questo periodo. Non vengono fatturati.

**Limite di archiviazione (storage cap).** Ciascun progetto ha un limite massimo
impostato dal relativo proprietario: 50 GB per impostazione predefinita, fino a 1 TB
dalla console, o superiore su richiesta. Vengono inviati avvisi al raggiungimento
dell'80% e del 100%. Al raggiungimento del limite, i caricamenti vengono rifiutati
con l'errore `QuotaExceeded`; le operazioni di lettura ed eliminazione continuano
a funzionare.

**Traffico in uscita (egress).** Il traffico in uscita è monitorato per progetto e
attualmente non viene fatturato. L'uso corretto (fair use) è di 1 TB per progetto
al mese. È prevista una tariffa di 0,01 € per GB oltre la soglia di fair use, ma
al momento non viene addebitata e qualsiasi modifica verrà annunciata in anticipo.

## Dove sono archiviati i dati

Gli oggetti sono archiviati in Germania, a Falkenstein (regione del data center
eu-central), su storage con codifica di cancellazione (erasure coding) gestito
dal nostro fornitore di infrastruttura, Hetzner Online GmbH. Una seconda copia
viene effettuata ogni ora in una sede separata a Norimberga. Tale copia esiste
affinché Rebase possa eseguire un ripristino di emergenza (disaster recovery);
non è accessibile per il normale servizio.

Rebase Storage non prevede uno SLA di uptime.

## Crittografia

Il traffico verso Rebase Storage è sempre crittografato tramite TLS.

Gli oggetti non sono crittografati a riposo (at rest): l'object storage del provider
non applica la crittografia lato server predefinita e questa versione di Rebase Storage
non ne aggiunge alcuna. Per i dati sensibili, è consigliabile crittografarli sul client
prima del caricamento.

## Importare un bucket esistente

<span class="since-badge" data-since="0.35">Da 0.35</span>

`rebase cloud storage import` copia un bucket da qualsiasi servizio compatibile
con S3 in Rebase Storage:

```bash
rebase cloud storage import --from s3://old-bucket --endpoint https://s3.example.com --to my-bucket
```

Copia ogni oggetto, verifica la copia e non modifica mai la sorgente.
Con `--switch-app`, reindirizza l'app Rebase verso il nuovo bucket (le sue
impostazioni di archiviazione e le relative variabili `S3_*`, se definite). L'app
utilizzerà il nuovo bucket a partire dalla distribuzione successiva; fino ad allora
continuerà a scrivere su quello precedente.

Per un'app su Rebase Cloud, `--from-app-storage` seleziona il bucket attualmente
utilizzato dall'app, con la chiave già memorizzata dalla piattaforma, evitando di
inserire informazioni sensibili nella riga di comando. Dopo il passaggio e la
ridistribuzione, copia quanto pervenuto nel vecchio bucket nel frattempo con
`--from-import <id>`, che legge nuovamente l'origine della precedente importazione:

```bash
rebase cloud storage import --from-app-storage --to my-bucket --switch-app
rebase cloud deploy
rebase cloud storage import --from-import <importId> --to my-bucket
```

Gli oggetti già copiati con la stessa dimensione vengono ignorati, quindi una seconda
importazione copia solo i contenuti nuovi.

Per Google Cloud Storage, utilizza il relativo endpoint di interoperabilità S3
(`https://storage.googleapis.com`) con una chiave HMAC. `rebase cloud storage
import --help` mostra come passare le credenziali della sorgente.

## Connettere un client

<span class="since-badge" data-since="0.35">Da 0.35</span>

Gli esempi seguenti utilizzano una chiave creata con `rebase cloud storage keys create`.

### aws-cli

Memorizza la chiave in un profilo:

```bash
aws configure --profile rebase
# AWS Access Key ID:     <your access key>
# AWS Secret Access Key: <your secret>
# Default region name:   eu-central-1
```

Quindi passa l'endpoint a ogni comando:

```bash
aws s3 ls s3://my-bucket --profile rebase --endpoint-url https://s3.eu-central-1.rebase.pro
aws s3 cp ./report.pdf s3://my-bucket/reports/ --profile rebase --endpoint-url https://s3.eu-central-1.rebase.pro
```

### rclone

```ini title="rclone.conf"
[rebase]
type = s3
provider = Other
access_key_id = <your access key>
secret_access_key = <your secret>
endpoint = https://s3.eu-central-1.rebase.pro
region = eu-central-1
```

Entrambi gli stili di URL sono supportati, quindi `force_path_style` può essere lasciato al valore predefinito.

```bash
rclone ls rebase:my-bucket
```

### Python (boto3)

```python
import boto3

s3 = boto3.client(
    "s3",
    endpoint_url="https://s3.eu-central-1.rebase.pro",
    region_name="eu-central-1",
    aws_access_key_id="<your access key>",
    aws_secret_access_key="<your secret>",
    # Optional: both addressing styles work.
    # config=botocore.config.Config(s3={"addressing_style": "path"}),
)

s3.upload_file("report.pdf", "my-bucket", "reports/report.pdf")
url = s3.generate_presigned_url(
    "get_object",
    Params={"Bucket": "my-bucket", "Key": "reports/report.pdf"},
    ExpiresIn=3600,
)
```

### JavaScript (AWS SDK v3)

```js
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";

const s3 = new S3Client({
    endpoint: "https://s3.eu-central-1.rebase.pro",
    region: "eu-central-1",
    credentials: {
        accessKeyId: "<your access key>",
        secretAccessKey: "<your secret>"
    },
    forcePathStyle: true
});

await s3.send(new PutObjectCommand({
    Bucket: "my-bucket",
    Key: "hello.txt",
    Body: "Hello"
}));
```
