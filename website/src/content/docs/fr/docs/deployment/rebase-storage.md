---
sourceHash: 527ed0c2f1a85b8e
title: Rebase Storage
sidebar_label: Rebase Storage
description: "Stockage d'objets compatible S3 dans Rebase Cloud : l'endpoint, les buckets et les clés, les opérations S3 prises en charge, les limites, les tarifs, l'emplacement de stockage des données et comment connecter aws-cli, rclone, boto3 et le SDK AWS pour JavaScript."
---

Rebase Storage est le service de stockage d'objets de Rebase Cloud. Il prend en
charge l'API S3, de sorte que tout client ou SDK S3 fonctionne avec lui dès lors
que vous lui fournissez l'endpoint et une clé. Une application Rebase sur Rebase
Cloud l'utilise sans aucune configuration requise ; tout le reste — un script,
une tâche de sauvegarde, un autre service — s'y connecte à l'aide d'une clé que
vous créez.

## Endpoint et région

| | |
|---|---|
| Endpoint | `https://s3.eu-central-1.rebase.pro` |
| Région | `eu-central-1` |
| URL de type path-style | `https://s3.eu-central-1.rebase.pro/<bucket>/<key>` |
| URL de type virtual-hosted | `https://<bucket>.s3.eu-central-1.rebase.pro/<key>` |

Les deux styles d'URL fonctionnent, un client peut donc utiliser l'un ou l'autre.

## Buckets

Créez un bucket dans la console ou avec la CLI :

```bash
rebase cloud storage create my-bucket
rebase cloud storage delete my-bucket
```

Les noms de buckets sont globaux à l'échelle de Rebase Storage : de 3 à 63
caractères, lettres minuscules, chiffres et tirets, aucun point.

Les buckets ne sont pas créés via l'appel S3 `CreateBucket`. `CreateBucket` pour
un bucket que vous possédez déjà renvoie `BucketAlreadyOwnedByYou`.

## Clés

Rebase émet les clés d'accès. Chaque clé est soit en **lecture seule**
(**read-only**), soit en **lecture-écriture** (**read-write**), et couvre soit
un seul bucket, soit tous les buckets du projet.

```bash
rebase cloud storage keys create
rebase cloud storage keys rotate
rebase cloud storage keys revoke
```

La console permet de faire de même. Le secret n'est affiché qu'une seule fois,
lors de la création ou de la rotation de la clé, et est stocké chiffré. Une clé
révoquée cesse de fonctionner en quelques secondes.

## Applications Rebase sur Rebase Cloud

Une application Rebase déployée sur Rebase Cloud obtient automatiquement son
bucket et une clé. La plateforme définit ces variables d'environnement sur
l'application :

| Variable | Valeur |
|---|---|
| `STORAGE_TYPE` | `s3` |
| `S3_ENDPOINT` | L'endpoint de stockage |
| `S3_REGION` | `eu-central-1` |
| `S3_BUCKET` | Le bucket du projet |
| `S3_ACCESS_KEY_ID` | La clé de l'application |
| `S3_SECRET_ACCESS_KEY` | Le secret de l'application |
| `S3_FORCE_PATH_STYLE` | `true` |

Le trafic entre l'application et Rebase Storage reste au sein du cluster. La
manière dont l'application distribue et autorise l'accès aux fichiers est traitée
dans [Stockage de fichiers](/docs/backend/storage/) et
[Runtime backend managé](/docs/deployment/managed-runtime/#storage-for-generated-files).

## Opérations S3 prises en charge

| Domaine | Opérations |
|---|---|
| Objets | `PutObject`, `GetObject` (plages de données, en-têtes conditionnels, surcharges `response-*`), `HeadObject`, `DeleteObject`, `DeleteObjects`, `CopyObject` au sein du même bucket (jusqu'à 5 Go) |
| Listage | `ListObjectsV2`, `ListObjects` |
| Téléversements multipart | `CreateMultipartUpload`, `UploadPart`, `CompleteMultipartUpload`, `AbortMultipartUpload`, `ListParts`, `ListMultipartUploads` |
| Buckets | `HeadBucket`, `ListBuckets`, `GetBucketLocation`, `GetBucketCors` |
| URL présignées | Valables jusqu'à 7 jours |

Les requêtes sont signées avec **SigV4** uniquement. Les téléversements avec
l'encodage `aws-chunked` et les sommes de contrôle finales (trailing checksums)
sont acceptés, avec CRC32, CRC32C, CRC64NVME, SHA1 ou SHA256, de sorte que le
comportement par défaut des SDK AWS concernant les sommes de contrôle fonctionne
sans configuration supplémentaire.

Tout le reste renvoie `NotImplemented`. Cela inclut :

- Les ACL et les politiques de bucket (bucket policies). Les objets sont toujours
  privés ; pour partager un fichier, distribuez une URL présignée.
- Les buckets publics.
- Le versionnement des objets et `versionId`.
- Le taggage d'objets, le verrouillage d'objets (object lock) et les règles de
  cycle de vie.
- Les en-têtes de chiffrement côté serveur.
- `UploadPartCopy` et la copie entre buckets.
- Les téléversements `POST` depuis un navigateur (formulaires HTML). Utilisez un
  `PUT` présigné à la place.

### CORS

Configurez les règles CORS d'un bucket dans la console ou avec `rebase cloud storage cors`.
Rebase Storage répond aux requêtes préliminaires (preflight requests) à partir de
ces règles, permettant ainsi à un navigateur d'effectuer des requêtes `GET` ou
`PUT` vers une URL présignée depuis votre site.

## Limites

| | Limite |
|---|---|
| `PUT` unique | 5 Go |
| Téléversement multipart | 10 000 parties, 5 Go par partie |
| Taille d'objet | 5 To |
| Métadonnées utilisateur | 2 Ko par objet |
| Buckets | 100 par projet |
| Clés | 200 par projet |

Chaque projet dispose également d'une limite de débit de requêtes. Les requêtes
dépassant ce seuil reçoivent une erreur `503 SlowDown`, que les clients S3
réessaient avec un délai exponentiel (backoff).

## Tarifs

Chaque projet inclut **10 Go**. Au-delà, le stockage coûte **0,03 € par
Go-mois**, calculé uniquement sur la version actuelle de chaque objet.

Les fichiers supprimés et écrasés sont conservés pendant 30 jours et peuvent
être restaurés par le support durant cette période. Ils ne sont pas facturés.

**Plafond de stockage.** Chaque projet a un plafond défini par son propriétaire :
50 Go par défaut, jusqu'à 1 To depuis la console, plus sur demande. Vous recevez
une alerte à 80 % et à 100 %. Une fois le plafond atteint, les téléversements
sont refusés avec l'erreur `QuotaExceeded` ; les lectures et les suppressions
continuent de fonctionner.

**Trafic sortant (egress).** Le trafic sortant est mesuré par projet et n'est
pas facturé à ce jour. L'utilisation équitable (fair use) est de 1 To par projet
et par mois. Un tarif de 0,01 € par Go au-delà de l'utilisation équitable est
réservé, mais il n'est pas appliqué pour le moment, et tout changement à ce
sujet serait annoncé à l'avance.

## Emplacement de stockage des données

Les objets sont stockés en Allemagne, à Falkenstein (région de centre de données
eu-central), sur un stockage avec code d'effacement (erasure coding) exploité par
notre fournisseur d'infrastructure, Hetzner Online GmbH. Une seconde copie est
effectuée chaque heure vers un site distinct à Nuremberg. Cette copie existe afin
que Rebase puisse effectuer une reprise après sinistre ; elle n'est pas accessible
directement.

Rebase Storage n'a pas de SLA de disponibilité.

## Chiffrement

Le trafic vers Rebase Storage est toujours chiffré avec TLS.

Les objets ne sont pas chiffrés au repos : le stockage d'objets du fournisseur
n'applique pas de chiffrement côté serveur par défaut, et cette version de
Rebase Storage n'en ajoute aucun. Pour les données sensibles, chiffrez-les côté
client avant de les téléverser.

## Importer un bucket existant

`rebase cloud storage import` copie un bucket depuis n'importe quel service
compatible S3 vers Rebase Storage :

```bash
rebase cloud storage import --from s3://old-bucket --endpoint https://s3.example.com --to my-bucket
```

La commande copie chaque objet, vérifie la copie et ne modifie jamais la source.
Avec `--switch-app`, elle fait ensuite pointer votre application Rebase vers le
nouveau bucket (ses paramètres de stockage et ses propres variables `S3_*` si
elle en définit). L'application utilise le nouveau bucket dès son prochain
déploiement ; d'ici là, elle continue d'écrire dans l'ancien.

Pour une application sur Rebase Cloud, `--from-app-storage` sélectionne le
bucket actuellement utilisé par l'application, avec la clé déjà détenue par la
plateforme, afin qu'aucun secret ne transite sur la ligne de commande. Après le
basculement et le redéploiement, copiez les fichiers arrivés entre-temps dans
l'ancien bucket grâce à `--from-import <id>`, qui relit la source de cet import
précédent :

```bash
rebase cloud storage import --from-app-storage --to my-bucket --switch-app
rebase cloud deploy
rebase cloud storage import --from-import <importId> --to my-bucket
```

Les objets déjà copiés ayant la même taille sont ignorés, ainsi un second import
ne copie que les nouveautés.

Pour Google Cloud Storage, utilisez son endpoint d'interopérabilité S3
(`https://storage.googleapis.com`) avec une clé HMAC. La commande `rebase cloud storage
import --help` indique comment transmettre les identifiants de la source.

## Connecter un client

Les exemples ci-dessous utilisent une clé créée avec `rebase cloud storage keys create`.

### aws-cli

Enregistrez la clé dans un profil :

```bash
aws configure --profile rebase
# AWS Access Key ID:     <your access key>
# AWS Secret Access Key: <your secret>
# Default region name:   eu-central-1
```

Transmettez ensuite l'endpoint à chaque commande :

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

Les deux styles d'URL fonctionnent, `force_path_style` peut donc être laissé à sa valeur par défaut.

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
