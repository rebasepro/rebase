---
sourceHash: c01ec36e7192bb7f
title: Rebase Storage
sidebar_label: Rebase Storage
description: "S3-kompatibler Objektspeicher in Rebase Cloud: der Endpunkt, Buckets und Schlüssel, die unterstützten S3-Operationen, Limits, Preise, Speicherort der Daten und wie Sie aws-cli, rclone, boto3 und das AWS SDK für JavaScript verbinden."
---

Rebase Storage ist der Objektspeicher in Rebase Cloud. Er nutzt die S3-API, sodass
jeder S3-Client oder jedes S3-SDK damit funktioniert, sobald Sie den Endpunkt und einen
Schlüssel angeben. Eine Rebase-App auf Rebase Cloud verwendet ihn ohne jegliche Konfiguration;
alles andere – ein Skript, ein Backup-Job, ein anderer Dienst – verbindet sich mit
einem von Ihnen erstellten Schlüssel.

## Endpunkt und Region

| | |
|---|---|
| Endpunkt | `https://s3.eu-central-1.rebase.pro` |
| Region | `eu-central-1` |
| Path-Style-URL | `https://s3.eu-central-1.rebase.pro/<bucket>/<key>` |
| Virtual-Hosted-URL | `https://<bucket>.s3.eu-central-1.rebase.pro/<key>` |

Beide URL-Stile funktionieren, sodass ein Client beide verwenden kann.

## Buckets

Erstellen Sie einen Bucket in der Konsole oder über das CLI:

```bash
rebase cloud storage create my-bucket
rebase cloud storage delete my-bucket
```

Bucket-Namen sind in Rebase Storage global: 3 bis 63 Zeichen, Kleinbuchstaben,
Ziffern und Bindestriche, keine Punkte.

Buckets werden nicht über den S3-Aufruf `CreateBucket` erstellt. `CreateBucket` für
einen Bucket, den Sie bereits besitzen, antwortet mit `BucketAlreadyOwnedByYou`.

## Schlüssel

<span class="since-badge" data-since="0.35">Seit 0.35</span>

Rebase stellt die Zugriffsschlüssel aus. Jeder Schlüssel ist entweder **read-only**
oder **read-write** und deckt entweder einen einzelnen Bucket oder alle Buckets des Projekts ab.

```bash
rebase cloud storage keys create
rebase cloud storage keys rotate
rebase cloud storage keys revoke
```

Die Konsole bietet dieselben Funktionen. Das Secret wird nur einmal angezeigt, wenn der
Schlüssel erstellt oder rotiert wird, und verschlüsselt gespeichert. Ein widerrufener
Schlüssel funktioniert innerhalb von Sekunden nicht mehr.

## Rebase-Apps auf Rebase Cloud

Eine in Rebase Cloud bereitgestellte Rebase-App erhält ihren Bucket und einen Schlüssel automatisch.
Die Plattform setzt diese Umgebungsvariablen für die App:

| Variable | Wert |
|---|---|
| `STORAGE_TYPE` | `s3` |
| `S3_ENDPOINT` | Der Storage-Endpunkt |
| `S3_REGION` | `eu-central-1` |
| `S3_BUCKET` | Der Bucket des Projekts |
| `S3_ACCESS_KEY_ID` | Der Schlüssel der App |
| `S3_SECRET_ACCESS_KEY` | Das Secret der App |
| `S3_FORCE_PATH_STYLE` | `true` |

Der Datenverkehr zwischen der App und Rebase Storage bleibt innerhalb des Clusters. Wie die
App Dateien bereitstellt und autorisiert, wird unter
[Dateispeicher](/docs/backend/storage/) und
[Managed Backend Runtime](/docs/deployment/managed-runtime/#storage-for-generated-files) beschrieben.

## Unterstützte S3-Operationen

| Bereich | Operationen |
|---|---|
| Objekte | `PutObject`, `GetObject` (Ranges, bedingte Header, `response-*`-Überschreibungen), `HeadObject`, `DeleteObject`, `DeleteObjects`, `CopyObject` innerhalb desselben Buckets (bis zu 5 GB) |
| Auflistung | `ListObjectsV2`, `ListObjects` |
| Multipart-Uploads | `CreateMultipartUpload`, `UploadPart`, `CompleteMultipartUpload`, `AbortMultipartUpload`, `ListParts`, `ListMultipartUploads` |
| Buckets | `HeadBucket`, `ListBuckets`, `GetBucketLocation`, `GetBucketCors` |
| Presigned URLs | Bis zu 7 Tage gültig |

Anfragen werden ausschließlich mit **SigV4** signiert. Uploads mit `aws-chunked`-Codierung
und nachgestellten Prüfsummen werden mit CRC32, CRC32C, CRC64NVME, SHA1 oder SHA256 akzeptiert,
sodass das Standard-Prüfsummenverhalten der AWS SDKs ohne Konfiguration funktioniert.

Alles andere antwortet mit `NotImplemented`. Dazu gehören:

- ACLs und Bucket-Richtlinien. Objekte sind immer privat; um eine Datei zu teilen,
  stellen Sie eine Presigned URL aus.
- Öffentliche Buckets.
- Objektversionierung und `versionId`.
- Objekt-Tagging, Object Lock und Lifecycle-Regeln.
- Server-Side-Encryption-Header.
- `UploadPartCopy` und das Kopieren zwischen Buckets.
- Browser-`POST`-Uploads (HTML-Formular-Uploads). Verwenden Sie stattdessen ein Presigned `PUT`.

### CORS

Legen Sie die CORS-Regeln eines Buckets in der Konsole oder mit `rebase cloud storage cors` fest.
Rebase Storage beantwortet Preflight-Anfragen anhand dieser Regeln, sodass ein Browser per
`GET` oder `PUT` auf eine Presigned URL von Ihrer Website zugreifen kann.

## Limits

| | Limit |
|---|---|
| Einzelnes `PUT` | 5 GB |
| Multipart-Upload | 10.000 Teile, 5 GB pro Teil |
| Objektgröße | 5 TB |
| Benutzermetadaten | 2 KB pro Objekt |
| Buckets | 100 pro Projekt |
| Schlüssel | 200 pro Projekt |

Jedes Projekt verfügt außerdem über eine Anfragerate. Anfragen darüber hinaus erhalten `503 SlowDown`,
woraufhin S3-Clients den Versuch mit Backoff wiederholen.

## Preise

Jedes Projekt beinhaltet **10 GB**. Darüber hinaus kostet der Speicher **0,03 € pro
GB-Monat**, wobei nur die jeweils aktuelle Version jedes Objekts gezählt wird.

Gelöschte und überschriebene Dateien werden 30 Tage lang aufbewahrt und können während dieser
Zeit vom Support wiederhergestellt werden. Sie werden nicht in Rechnung gestellt.

**Speicherobergrenze (Storage Cap).** Jedes Projekt hat eine Obergrenze, die der Eigentümer festlegt: standardmäßig 50 GB,
bis zu 1 TB über die Konsole, mehr auf Anfrage. Sie werden bei 80 % und bei
100 % benachrichtigt. Bei Erreichen der Obergrenze werden Uploads mit `QuotaExceeded` verweigert;
Lese- und Löschvorgänge funktionieren weiterhin.

**Egress.** Ausgehender Datenverkehr wird pro Projekt gemessen und derzeit nicht berechnet.
Die Fair-Use-Grenze liegt bei 1 TB pro Projekt und Monat. Eine Gebühr von 0,01 € pro GB über das Fair-Use-Kontingent
hinaus bleibt vorbehalten, wird derzeit jedoch nicht erhoben; etwaige Änderungen daran werden vorab angekündigt.

## Wo die Daten gespeichert werden

Objekte werden in Deutschland in Falkenstein (Rechenzentrumsregion eu-central) auf
Erasure-Coded-Speicher gespeichert, der von unserem Infrastrukturanbieter, der Hetzner
Online GmbH, betrieben wird. Jede Stunde wird eine zweite Kopie an einem separaten Standort in
Nürnberg erstellt. Diese Kopie dient der Notfallwiederherstellung durch Rebase; sie wird
nicht ausgeliefert.

Für Rebase Storage gibt es kein Verfügbarkeits-SLA (Uptime SLA).

## Verschlüsselung

Der Datenverkehr zu Rebase Storage ist immer mit TLS verschlüsselt.

Objekte sind im Ruhezustand (at rest) nicht verschlüsselt: Der Objektspeicher des Anbieters
wendet keine standardmäßige serverseitige Verschlüsselung an, und diese Version von Rebase Storage
fügt keine hinzu. Verschlüsseln Sie sensible Daten auf dem Client, bevor Sie sie hochladen.

## Einen bestehenden Bucket importieren

<span class="since-badge" data-since="0.35">Seit 0.35</span>

`rebase cloud storage import` kopiert einen Bucket von jedem S3-kompatiblen Dienst
nach Rebase Storage:

```bash
rebase cloud storage import --from s3://old-bucket --endpoint https://s3.example.com --to my-bucket
```

Der Befehl kopiert jedes Objekt, verifiziert die Kopie und verändert die Quelle zu keinem Zeitpunkt.
Mit `--switch-app` wird Ihre Rebase-App anschließend auf den neuen Bucket verwiesen (deren
Speichereinstellungen und ihre eigenen `S3_*`-Variablen, falls sie diese setzt). Die App verwendet
den neuen Bucket ab dem nächsten Deployment; bis dahin schreibt sie weiterhin in den alten.

Bei einer App auf Rebase Cloud übernimmt `--from-app-storage` den Bucket, den die App derzeit
verwendet, zusammen mit dem Schlüssel, den die Plattform bereits besitzt, sodass keine vertraulichen Daten
über die Befehlszeile übergeben werden müssen. Nach dem Wechsel und dem erneuten Deployment können Sie mit
`--from-import <id>` alles nachkopieren, was in der Zwischenzeit im alten Bucket angekommen ist,
wodurch die Quelle dieses vorherigen Imports erneut ausgelesen wird:

```bash
rebase cloud storage import --from-app-storage --to my-bucket --switch-app
rebase cloud deploy
rebase cloud storage import --from-import <importId> --to my-bucket
```

Bereits kopierte Objekte mit gleicher Größe werden übersprungen, sodass ein zweiter Import
nur neue Daten kopiert.

Verwenden Sie für Google Cloud Storage dessen S3-Interoperabilitätsendpunkt
(`https://storage.googleapis.com`) mit einem HMAC-Schlüssel. `rebase cloud storage import --help`
zeigt, wie die Anmeldeinformationen der Quelle übergeben werden.

## Einen Client verbinden

<span class="since-badge" data-since="0.35">Seit 0.35</span>

Die folgenden Beispiele verwenden einen Schlüssel, der mit `rebase cloud storage keys create` erstellt wurde.

### aws-cli

Speichern Sie den Schlüssel in einem Profil:

```bash
aws configure --profile rebase
# AWS Access Key ID:     <your access key>
# AWS Secret Access Key: <your secret>
# Default region name:   eu-central-1
```

Übergeben Sie den Endpunkt anschließend bei jedem Befehl:

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

Beide URL-Stile funktionieren, daher kann `force_path_style` auf dem Standardwert belassen werden.

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
