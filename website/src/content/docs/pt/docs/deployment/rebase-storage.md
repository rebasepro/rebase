---
sourceHash: 527ed0c2f1a85b8e
title: Rebase Storage
sidebar_label: Rebase Storage
description: "Armazenamento de objetos compatível com S3 no Rebase Cloud: o endpoint, buckets e chaves, as operações S3 suportadas, limites, preços, onde os dados são armazenados e como conectar aws-cli, rclone, boto3 e o AWS SDK para JavaScript."
---

O Rebase Storage é o armazenamento de objetos no Rebase Cloud. Ele utiliza a API S3, portanto, qualquer cliente ou SDK S3 funciona com ele depois que você fornecer o endpoint e uma chave. Uma aplicação Rebase no Rebase Cloud o utiliza sem nenhuma configuração; qualquer outra coisa — um script, uma rotina de backup, outro serviço — conecta-se com uma chave criada por você.

## Endpoint e região

| | |
|---|---|
| Endpoint | `https://s3.eu-central-1.rebase.pro` |
| Região | `eu-central-1` |
| URL path-style | `https://s3.eu-central-1.rebase.pro/<bucket>/<key>` |
| URL virtual-hosted | `https://<bucket>.s3.eu-central-1.rebase.pro/<key>` |

Ambos os estilos de URL funcionam, portanto um cliente pode usar qualquer um deles.

## Buckets

Crie um bucket no console ou com a CLI:

```bash
rebase cloud storage create my-bucket
rebase cloud storage delete my-bucket
```

Os nomes dos buckets são globais em todo o Rebase Storage: de 3 a 63 caracteres, letras minúsculas, dígitos e hífens, sem pontos.

Os buckets não são criados por meio da chamada `CreateBucket` do S3. `CreateBucket` para um bucket que você já possui retorna `BucketAlreadyOwnedByYou`.

## Chaves

O Rebase emite as chaves de acesso. Cada chave é **somente leitura** ou **leitura e escrita**, e abrange um único bucket ou todos os buckets do projeto.

```bash
rebase cloud storage keys create
rebase cloud storage keys rotate
rebase cloud storage keys revoke
```

O console faz o mesmo. O secret é exibido apenas uma vez, quando a chave é criada ou rotacionada, e é armazenado criptografado. Uma chave revogada para de funcionar em questão de segundos.

## Aplicações Rebase no Rebase Cloud

Uma aplicação Rebase implantada no Rebase Cloud recebe seu bucket e uma chave automaticamente. A plataforma define estas variáveis de ambiente na aplicação:

| Variável | Valor |
|---|---|
| `STORAGE_TYPE` | `s3` |
| `S3_ENDPOINT` | O endpoint do storage |
| `S3_REGION` | `eu-central-1` |
| `S3_BUCKET` | O bucket do projeto |
| `S3_ACCESS_KEY_ID` | A chave da aplicação |
| `S3_SECRET_ACCESS_KEY` | O secret da aplicação |
| `S3_FORCE_PATH_STYLE` | `true` |

O tráfego entre a aplicação e o Rebase Storage permanece dentro do cluster. A forma como a aplicação serve e autoriza arquivos é abordada em [Armazenamento de arquivos](/docs/backend/storage/) e [Runtime de backend gerenciado](/docs/deployment/managed-runtime/#storage-for-generated-files).

## Operações S3 suportadas

| Área | Operações |
|---|---|
| Objetos | `PutObject`, `GetObject` (ranges, headers condicionais, substituições de `response-*`), `HeadObject`, `DeleteObject`, `DeleteObjects`, `CopyObject` dentro do mesmo bucket (até 5 GB) |
| Listagem | `ListObjectsV2`, `ListObjects` |
| Uploads multipart | `CreateMultipartUpload`, `UploadPart`, `CompleteMultipartUpload`, `AbortMultipartUpload`, `ListParts`, `ListMultipartUploads` |
| Buckets | `HeadBucket`, `ListBuckets`, `GetBucketLocation`, `GetBucketCors` |
| URLs pré-assinadas | Válidas por até 7 dias |

As requisições são assinadas apenas com **SigV4**. Uploads com codificação `aws-chunked` e checksums finais são aceitos, com CRC32, CRC32C, CRC64NVME, SHA1 ou SHA256, portanto o comportamento padrão de checksum dos SDKs da AWS funciona sem configuração adicional.

Qualquer outra operação responde com `NotImplemented`. Isso inclui:

- ACLs e políticas de bucket. Os objetos são sempre privados; para compartilhar um arquivo, forneça uma URL pré-assinada.
- Buckets públicos.
- Versões de objetos e `versionId`.
- Marcação de objetos (object tagging), bloqueio de objetos (object lock) e regras de ciclo de vida.
- Cabeçalhos de criptografia no lado do servidor (server-side encryption).
- `UploadPartCopy` e cópia entre buckets.
- Uploads `POST` via navegador (uploads de formulário HTML). Use um `PUT` pré-assinado em vez disso.

### CORS

Defina as regras de CORS de um bucket no console ou com `rebase cloud storage cors`. O Rebase Storage responde a requisições preflight com base nessas regras, permitindo que um navegador faça `GET` ou `PUT` em uma URL pré-assinada a partir do seu site.

## Limites

| | Limite |
|---|---|
| `PUT` individual | 5 GB |
| Upload multipart | 10.000 partes, 5 GB por parte |
| Tamanho do objeto | 5 TB |
| Metadados do usuário | 2 KB por objeto |
| Buckets | 100 por projeto |
| Chaves | 200 por projeto |

Cada projeto também possui uma taxa limite de requisições. Requisições acima do limite recebem `503 SlowDown`, as quais os clientes S3 tentam novamente com recuo exponencial (backoff).

## Preços

Cada projeto inclui **10 GB**. Acima disso, o armazenamento custa **€0,03 por GB-mês**, contabilizado apenas sobre a versão atual de cada objeto.

Arquivos excluídos e sobrescritos são mantidos por 30 dias e podem ser restaurados pelo suporte durante esse período. Eles não são cobrados.

**Limite de armazenamento.** Cada projeto tem um limite definido pelo seu proprietário: 50 GB por padrão, até 1 TB pelo console, ou mais mediante solicitação. Alertas são enviados a 80% e a 100%. Ao atingir o limite, os uploads são recusados com `QuotaExceeded`; leituras e exclusões continuam funcionando.

**Tráfego de saída (Egress).** O tráfego de saída é medido por projeto e atualmente não é faturado. O uso aceitável é de 1 TB por projeto ao mês. Uma tarifa de €0,01 por GB além do uso aceitável está reservada, mas não é cobrada no momento, e qualquer alteração nisso será anunciada com antecedência.

## Onde os dados são armazenados

Os objetos são armazenados na Alemanha, em Falkenstein (região de data center eu-central), em armazenamento com código de apagamento (erasure-coded) operado por nosso provedor de infraestrutura, Hetzner Online GmbH. Uma segunda cópia é feita a cada hora para um local separado em Nuremberg. Essa cópia existe para que o Rebase possa se recuperar de um desastre; ela não é servida diretamente.

O Rebase Storage não possui SLA de disponibilidade.

## Criptografia

O tráfego para o Rebase Storage é sempre criptografado com TLS.

Os objetos não são criptografados em repouso: o armazenamento de objetos do provedor não aplica criptografia padrão no lado do servidor, e esta versão do Rebase Storage não adiciona nenhuma. Para dados confidenciais, criptografe-os no cliente antes de fazer o upload.

## Importando um bucket existente

O comando `rebase cloud storage import` copia um bucket de qualquer serviço compatível com S3 para o Rebase Storage:

```bash
rebase cloud storage import --from s3://old-bucket --endpoint https://s3.example.com --to my-bucket
```

Ele copia todos os objetos, verifica a cópia e nunca modifica a origem. Com `--switch-app`, ele direciona sua aplicação Rebase para o novo bucket (suas configurações de armazenamento e suas próprias variáveis `S3_*`, caso estejam definidas). A aplicação passa a usar o novo bucket a partir do próximo deploy; até lá, continuará gravando no antigo.

Para uma aplicação no Rebase Cloud, `--from-app-storage` seleciona o bucket que a aplicação usa atualmente, com a chave que a plataforma já possui, de forma que nenhum dado confidencial seja exposto na linha de comando. Após a troca e o novo deploy, copie o que chegou ao bucket antigo nesse intervalo com `--from-import <id>`, que lê novamente a origem daquela importação anterior:

```bash
rebase cloud storage import --from-app-storage --to my-bucket --switch-app
rebase cloud deploy
rebase cloud storage import --from-import <importId> --to my-bucket
```

Objetos já copiados com o mesmo tamanho são ignorados, de modo que uma segunda importação copia apenas o que há de novo.

Para o Google Cloud Storage, utilize seu endpoint de interoperabilidade S3 (`https://storage.googleapis.com`) com uma chave HMAC. O comando `rebase cloud storage import --help` mostra como passar as credenciais de origem.

## Conectando um cliente

Os exemplos abaixo usam uma chave criada com `rebase cloud storage keys create`.

### aws-cli

Armazene a chave em um perfil:

```bash
aws configure --profile rebase
# AWS Access Key ID:     <your access key>
# AWS Secret Access Key: <your secret>
# Default region name:   eu-central-1
```

Em seguida, informe o endpoint em cada comando:

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

Ambos os estilos de URL funcionam, portanto `force_path_style` pode ser mantido em seu valor padrão.

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
