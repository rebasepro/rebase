---
sourceHash: 03742ec4ecbebca1
title: Rebase Storage
sidebar_label: Rebase Storage
description: "Almacenamiento de objetos compatible con S3 en Rebase Cloud: el endpoint, buckets y claves, las operaciones S3 compatibles, límites, precios, dónde se almacenan los datos y cómo conectar aws-cli, rclone, boto3 y el AWS SDK para JavaScript."
---

Rebase Storage es el almacenamiento de objetos en Rebase Cloud. Utiliza la API de S3, por lo que cualquier cliente o SDK de S3 funciona con él una vez que le proporciones el endpoint y una clave. Una aplicación de Rebase en Rebase Cloud lo utiliza sin necesidad de configuración previa; cualquier otra cosa —un script, una tarea de respaldo, otro servicio— se conecta con una clave que tú crees.

## Endpoint y región

| | |
|---|---|
| Endpoint | `https://s3.eu-central-1.rebase.pro` |
| Región | `eu-central-1` |
| URL path-style | `https://s3.eu-central-1.rebase.pro/<bucket>/<key>` |
| URL virtual-hosted | `https://<bucket>.s3.eu-central-1.rebase.pro/<key>` |

Ambos estilos de URL funcionan, por lo que un cliente puede usar cualquiera de los dos.

## Buckets

Crea un bucket en la consola o con la CLI:

```bash
rebase cloud storage create my-bucket
rebase cloud storage delete my-bucket
```

Los nombres de los buckets son globales en todo Rebase Storage: de 3 a 63 caracteres, letras minúsculas, dígitos y guiones, sin puntos.

Los buckets no se crean mediante la llamada `CreateBucket` de S3. `CreateBucket` para un bucket del que ya eres propietario responde con `BucketAlreadyOwnedByYou`.

## Claves

Rebase emite las claves de acceso. Cada clave es de **solo lectura** o de **lectura y escritura**, y cubre un solo bucket o todos los buckets del proyecto.

```bash
rebase cloud storage keys create
rebase cloud storage keys rotate
rebase cloud storage keys revoke
```

La consola hace lo mismo. El secreto se muestra una sola vez, cuando se crea o se rota la clave, y se almacena cifrado. Una clave revocada deja de funcionar en cuestión de segundos.

## Aplicaciones Rebase en Rebase Cloud

Una aplicación Rebase desplegada en Rebase Cloud obtiene su bucket y una clave automáticamente. La plataforma establece estas variables de entorno en la aplicación:

| Variable | Valor |
|---|---|
| `STORAGE_TYPE` | `s3` |
| `S3_ENDPOINT` | El endpoint de almacenamiento |
| `S3_REGION` | `eu-central-1` |
| `S3_BUCKET` | El bucket del proyecto |
| `S3_ACCESS_KEY_ID` | La clave de la aplicación |
| `S3_SECRET_ACCESS_KEY` | El secreto de la aplicación |
| `S3_FORCE_PATH_STYLE` | `true` |

Un bucket que el código de la aplicación declara además del predeterminado — `bucket("media")` en `backend/resources.ts` — obtiene un bucket y una clave propios en el siguiente despliegue, vinculados con las mismas variables con su clave como sufijo: `S3_BUCKET__MEDIA`, `S3_ACCESS_KEY_ID__MEDIA`, etc. Un proyecto puede tener hasta 100 buckets.

El tráfico entre la aplicación y Rebase Storage permanece dentro del clúster. La forma en que la aplicación sirve y autoriza archivos se describe en [File storage](/docs/backend/storage/) y en [Managed backend runtime](/docs/deployment/managed-runtime/#storage-for-generated-files).

## Operaciones S3 admitidas

| Área | Operaciones |
|---|---|
| Objetos | `PutObject`, `GetObject` (rangos, encabezados condicionales, anulaciones de `response-*`), `HeadObject`, `DeleteObject`, `DeleteObjects`, `CopyObject` dentro del mismo bucket (hasta 5 GB) |
| Listado | `ListObjectsV2`, `ListObjects` |
| Cargas multiparte | `CreateMultipartUpload`, `UploadPart`, `CompleteMultipartUpload`, `AbortMultipartUpload`, `ListParts`, `ListMultipartUploads` |
| Buckets | `HeadBucket`, `ListBuckets`, `GetBucketLocation`, `GetBucketCors` |
| URLs prefirmadas | Válidas por hasta 7 días |

Las solicitudes solo se firman con **SigV4**. Se aceptan subidas con codificación `aws-chunked` y sumas de verificación finales (trailing checksums), con CRC32, CRC32C, CRC64NVME, SHA1 o SHA256, por lo que el comportamiento predeterminado de sumas de verificación de los SDK de AWS funciona sin configuración adicional.

Todo lo demás responde con `NotImplemented`. Eso incluye:

- ACLs y políticas de bucket. Los objetos son siempre privados; para compartir un archivo, entrega una URL prefirmada.
- Buckets públicos.
- Versiones de objetos y `versionId`.
- Etiquetado de objetos (object tagging), bloqueo de objetos (object lock) y reglas de ciclo de vida.
- Encabezados de cifrado del lado del servidor.
- `UploadPartCopy` y copia entre buckets.
- Subidas `POST` desde el navegador (subidas mediante formularios HTML). Utiliza un `PUT` prefirmado en su lugar.

### CORS

Define las reglas CORS de un bucket en la consola o con `rebase cloud storage cors`. Rebase Storage responde a las solicitudes preflight basándose en esas reglas, de modo que un navegador pueda realizar peticiones `GET` o `PUT` contra una URL prefirmada desde tu sitio.

## Límites

| | Límite |
|---|---|
| `PUT` individual | 5 GB |
| Carga multiparte | 10.000 partes, 5 GB por parte |
| Tamaño de objeto | 5 TB |
| Metadatos de usuario | 2 KB por objeto |
| Buckets | 100 por proyecto |
| Claves | 200 por proyecto |

Cada proyecto también cuenta con un límite en la tasa de solicitudes. Las solicitudes que lo superen recibirán un error `503 SlowDown`, ante el cual los clientes S3 reintentan aplicando un retardo exponencial (backoff).

## Precios

Cada proyecto incluye **10 GB**. A partir de esa cantidad, el almacenamiento cuesta **0,03 € por GB al mes**, calculado únicamente sobre la versión actual de cada objeto, en todos los buckets del proyecto.

Los archivos eliminados y sobrescritos se conservan durante 30 días y el equipo de soporte puede restaurarlos durante ese período. No se facturan.

**Límite de almacenamiento (cap).** Cada proyecto tiene un tope definido por su propietario: 50 GB de forma predeterminada, hasta 1 TB desde la consola, y más previa solicitud. Recibirás avisos al alcanzar el 80% y el 100%. Al llegar al límite, las subidas se rechazan con `QuotaExceeded`; las lecturas y eliminaciones siguen funcionando.

**Tráfico saliente (Egress).** El tráfico de salida se mide por proyecto y actualmente no se factura. El uso razonable (fair use) es de 1 TB por proyecto al mes. Se contempla una tarifa de 0,01 € por GB por encima del uso razonable, pero no se aplica en este momento, y cualquier cambio al respecto se anunciará con anticipación.

## Dónde se almacenan los datos

Los objetos se almacenan en Alemania, en Falkenstein (región de centros de datos eu-central), en almacenamiento con código de borrado (erasure coding) operado por nuestro proveedor de infraestructura, Hetzner Online GmbH. Se realiza una segunda copia cada hora en una ubicación independiente en Núremberg. Dicha copia existe para que Rebase pueda recuperarse ante desastres; no se utiliza para servir solicitudes.

Rebase Storage no cuenta con un SLA de disponibilidad.

## Cifrado

El tráfico hacia Rebase Storage siempre está cifrado mediante TLS.

Los objetos no se cifran en reposo: el almacenamiento de objetos del proveedor no aplica cifrado predeterminado del lado del servidor, y esta versión de Rebase Storage no añade ninguno. Para datos confidenciales, cífrelos en el cliente antes de subirlos.

## Importar un bucket existente

`rebase cloud storage import` copia un bucket desde cualquier servicio compatible con S3 hacia Rebase Storage:

```bash
rebase cloud storage import --from s3://old-bucket --endpoint https://s3.example.com --to my-bucket
```

Copia cada objeto, verifica la copia y nunca modifica el origen. Con `--switch-app`, apunta tu aplicación Rebase al nuevo bucket (sus ajustes de almacenamiento y sus propias variables `S3_*` si las tuviera definidas). La aplicación utilizará el nuevo bucket a partir de su próximo despliegue; hasta entonces, continuará escribiendo en el anterior.

Para una aplicación en Rebase Cloud, `--from-app-storage` toma el bucket que la aplicación usa actualmente, con la clave que la plataforma ya posee, de modo que no se expone información secreta en la línea de comandos. Tras realizar el cambio y el nuevo despliegue, copia los archivos que hayan llegado al bucket antiguo en el intervalo intermedio usando `--from-import <id>`, que vuelve a leer el origen de esa importación previa:

```bash
rebase cloud storage import --from-app-storage --to my-bucket --switch-app
rebase cloud deploy
rebase cloud storage import --from-import <importId> --to my-bucket
```

Los objetos ya copiados que tengan el mismo tamaño se omiten, por lo que una segunda importación solo copiará el contenido nuevo.

Para Google Cloud Storage, utiliza su endpoint de interoperabilidad S3 (`https://storage.googleapis.com`) junto con una clave HMAC. `rebase cloud storage import --help` muestra cómo proporcionar las credenciales del origen.

## Conectar un cliente

Los siguientes ejemplos utilizan una clave creada con `rebase cloud storage keys create`.

### aws-cli

Guarda la clave en un perfil:

```bash
aws configure --profile rebase
# AWS Access Key ID:     <your access key>
# AWS Secret Access Key: <your secret>
# Default region name:   eu-central-1
```

Luego, proporciona el endpoint en cada comando:

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

Ambos estilos de URL funcionan, por lo que `force_path_style` puede mantenerse con su valor predeterminado.

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
