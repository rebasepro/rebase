---
sourceHash: 552bf6fc4d37691a
title: Configuração de Storage
sidebar_label: Configuração de Storage
description: Configure backends de sistema de arquivos local, compatíveis com S3 ou GCS/Firebase Storage para uploads de arquivos, imagens e mídia.
---

## Visão Geral

O Rebase suporta três backends de armazenamento:

- **Sistema de arquivos local** — Arquivos armazenados em disco (ótimo para desenvolvimento)
- **Compatível com S3** — AWS S3, MinIO, Cloudflare R2, DigitalOcean Spaces
- **Google Cloud Storage / Firebase Storage** — Suporte nativo ao GCS via `@google-cloud/storage`

## Configuração

:::note[Onde isso fica]
**Runtime gerenciado** — as variáveis `STORAGE_*` no `.env` (`STORAGE_TYPE`, `STORAGE_BUCKET` ou `S3_BUCKET` / `GCS_BUCKET`, `STORAGE_PATH`, `STORAGE_PUBLIC_READ`, … — adicione o sufixo `__<KEY>` a qualquer uma delas para uma fonte nomeada), além de uma declaração `bucket("<key>")` em `config/resources.ts` para cada bucket além do padrão, e `export const storageAuthorize` a partir de `config/index.ts`. `storageAuthorize` não possui uma forma via variável de ambiente de propósito: nenhuma variável pode expressar "este usuário pode ler esta chave".

**Ejetado** — o bloco `storage` em `initializeRebaseBackend({ … })`. `storagePolicies` e `storageTriggers` são exclusivos do modo ejetado.

O mapa completo está na [Visão Geral do Backend](/docs/backend/#where-each-option-lives).
:::

O armazenamento é configurado no bloco `storage` de `initializeRebaseBackend`:

### Armazenamento Local

```typescript no-verify
const backend = await initializeRebaseBackend({
    // ...
    storage: {
        type: "local",
        basePath: "./uploads"   // Directory for file storage
    }
});
```

O armazenamento local mantém os metadados de cada objeto ao lado dele, como `<key>.metadata.json`, portanto, uma chave cujo último segmento termine em `.metadata.json` é recusada com `400 INVALID_STORAGE_KEY` em todas as rotas. O S3 e o GCS mantêm os metadados no próprio objeto e armazenam qualquer chave. Em um sistema de arquivos que não diferencia maiúsculas de minúsculas (macOS e Windows por padrão), `Avatar.png` e `avatar.png` são um único arquivo local, mas dois objetos no S3, GCS ou em um disco Linux; portanto, o servidor emite um aviso na inicialização quando a pasta de armazenamento está em um deles.

### Armazenamento S3

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

No GCP (Cloud Run, GCE, GKE), as credenciais padrão da conta de serviço são usadas automaticamente. Fora do GCP, defina a variável de ambiente `GOOGLE_APPLICATION_CREDENTIALS` com o caminho do arquivo de chave da sua conta de serviço.

### Múltiplos Backends de Armazenamento

Você pode configurar múltiplos backends nomeados e rotear diferentes campos para diferentes armazenamentos:

```typescript
storage: {
    "(default)": { type: "local", basePath: "./uploads" },
    "media": { type: "s3", bucket: "media-bucket", region: "us-east-1", ... }
}
```

Em seguida, nas propriedades da sua collection, faça referência a um backend específico:

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

## Endpoints de Armazenamento

| Método | Caminho | Descrição |
|--------|---------|-----------|
| `POST` | `/api/storage/upload` | Upload direto de arquivo |
| `POST` | `/api/storage/upload?storageId=<key>` | Upload para um backend nomeado específico |
| `GET` | `/api/storage/file/*` | Recuperar um arquivo — tudo após `/file/` é a chave do objeto |
| `GET` | `/api/storage/file/*?storageId=<key>` | Recuperar um arquivo de um backend específico |
| `GET` | `/api/storage/metadata/*` | Tamanho, tipo de conteúdo e metadados personalizados de um objeto, sem seus bytes, além de um token de download de curta duração quando for privado |
| `POST` | `/api/storage/metadata` | <span class="since-badge" data-since="0.25">Desde 0.25</span> O mesmo para até 100 objetos de uma única fonte: corpo `{ keys, storageId? }` |
| `DELETE` | `/api/storage/file/*` | Excluir um arquivo |
| `GET` | `/api/storage/list` | Listar objetos sob um prefixo (`prefix`, `bucket`, `maxResults`, `pageToken`, `storageId`). Um `maxResults` menor que 1, ou um `pageToken` que a fonte nunca emitiu, resulta em `400 INVALID_LIST_OPTIONS` |
| `POST` | `/api/storage/folder` | Criar um marcador de pasta vazia |
| `GET` | `/api/storage/sources` | As fontes de armazenamento que este backend atende, por chave |
| `OPTIONS` | `/api/storage/tus` | Consultar capacidades suportadas do protocolo TUS |
| `POST` | `/api/storage/tus` | Iniciar uma sessão de upload retomável TUS |
| `HEAD` | `/api/storage/tus/:id` | Verificar o progresso do upload (deslocamento de bytes) |
| `PATCH` | `/api/storage/tus/:id` | Anexar bloco de dados a um arquivo temporário |
| `DELETE` | `/api/storage/tus/:id` | Encerrar/abortar sessão de upload TUS |

**O que eles respondem.** Um único envelope, o mesmo utilizado por `/api/data`: o payload
fica sob `data`, e uma falha é `{ "error": { message, code, requestId } }`
com os códigos na [referência de erros](/docs/backend/errors/). `/api/storage/file/*`
é a exceção, porque seu payload é o próprio arquivo — ele responde com os bytes, junto com
`Content-Type`, `Content-Length` e os cabeçalhos de cache.

```json
// GET /api/storage/list?prefix=products/images/
{ "data": { "items": [ { "bucket": "default", "fullPath": "products/images/a.jpg", "name": "a.jpg",
  "size": 48213, "updated": "2026-10-01T12:00:00.000Z", "contentType": "image/jpeg" } ], "prefixes": [] } }
```

<span class="since-badge" data-since="0.25">Desde 0.25</span> Uma listagem descreve cada arquivo retornado: seu `size` em bytes e
`updated`, quando foi gravado pela última vez, no armazenamento local, S3 e GCS, e seu
`contentType` no armazenamento local e GCS. Uma listagem do S3 não carrega o tipo,
portanto, no S3 ele fica ausente e `/api/storage/metadata/*` ainda o informa. Uma pasta em
`prefixes` não traz nenhum deles, assim como um `StorageController` personalizado que
não os defina.

`POST /api/storage/upload` responde `201` com `{ key, bucket, storageUrl }` do objeto armazenado sob `data`;
`GET /api/storage/metadata/*` os metadados do objeto e, para um objeto privado, o `token` de curta duração; `POST
/api/storage/metadata` um objeto indexado pelos caminhos enviados, cada um contendo o que o `GET` teria respondido para
ele (veja abaixo). Uma pasta não é um objeto: `/metadata` em uma chave terminada em `/` resulta em `404` em qualquer armazenamento, mesmo onde o S3
ou o GCS mantenha um marcador `folder/`, portanto, nenhum token de download é gerado para um prefixo; `GET /api/storage/sources` retorna o array de
fontes configuradas, com `configured: true`. Em uma implantação sem nenhum armazenamento, responde `200 {"data": [],
"configured": false}`, enquanto qualquer outra rota responde `501 STORAGE_NOT_CONFIGURED`. `GET /api/auth/config` relata
o mesmo fato como `storage: false`, para que o cliente possa evitar fazer a consulta. `GET /api/storage/sources` é público: ele responde
sem um token mesmo quando `requireAuth` está ativo. Ele nomeia as fontes (sua chave, mecanismo, transporte e rótulo) e nunca
um arquivo, e o SDK do cliente o lê para conectar suas fontes, o que pode acontecer antes de qualquer usuário fazer login. Um aplicativo que
lê uma fonte `direct` anonimamente também precisa disso. Cada rota que lista, lê ou grava um arquivo mantém sua autenticação.
`DELETE /api/storage/file/*` e `POST /api/storage/folder` trazem apenas uma `message`, já que não há nada para retornar.

No S3 e no GCS, um `bucket` deve ser um dos atendidos pela fonte, tanto em gravações quanto em
leituras: um upload, um `POST /api/storage/folder` ou um upload TUS informando qualquer outro
bucket responde `404 UNKNOWN_STORAGE_SOURCE`, assim como a listagem. O armazenamento local
ainda cria um bucket em sua primeira gravação.

**Múltiplos objetos de uma só vez.** <span class="since-badge" data-since="0.25">Desde 0.25</span> `POST /api/storage/metadata` aceita
`{ "keys": ["photos/a.png", "photos/b.png"], "storageId": "media" }` — até 100
caminhos de objeto de uma única fonte, cada um formatado como `GET /api/storage/metadata/<key>`
recebe — e responde com uma entrada por chave:

```json
{ "data": {
  "photos/a.png": { "fullPath": "photos/a.png", "size": 48213, "contentType": "image/png", "token": "…", "tokenExpiresIn": 300 },
  "photos/b.png": { "error": { "code": "FORBIDDEN", "message": "Not authorized for this object", "status": 403 } }
} }
```

Cada chave é avaliada exatamente como o `GET` a avalia — o mesmo hook
`storageAuthorize` e escopo de armazenamento, a mesma regra pública, um token de download próprio — e uma
chave que for recusada, ausente ou malformada responde com seu próprio `error` sem falhar
ou expor as demais. Um chamador sem sessão em uma implantação que exige
uma recebe o `401` que o `GET` responderia, a menos que todas as chaves sejam públicas. Mais de
100 chaves, ou um corpo sem `keys`, resulta em `400 BAD_REQUEST`. O limitador de taxa conta
a requisição como ⌈N/10⌉ requisições para N chaves, portanto, uma página de 100 miniaturas consome 10.
`client.storage.getSignedUrl()` e o painel administrativo enviam as consultas feitas por uma página
juntas dessa forma, e recorrem a um `GET` por arquivo em um servidor sem essa
rota.

**Como a leitura de um arquivo é autorizada.** As rotas de leitura — `/api/storage/file/*` e
`/api/storage/metadata/*` — aceitam o token assinado de curta duração gerado por
[`getSignedUrl()`](/docs/sdk/storage), passado como `?token=<token>` ou como
`Bearer`. Um JWT de acesso comum é **recusado** em `/file/*` com `401
Unauthorized: Access JWT not allowed on file routes`: o token que funciona em
todas as outras rotas não funciona ali, propositalmente, porque a URL de um arquivo é
algo fornecido a um navegador, CDN ou tag `<img>`. Todas as outras linhas acima
aceitam o JWT de acesso normalmente.

## Transformações de Imagem Dinâmicas (On-the-Fly)

O Rebase inclui um pipeline integrado de processamento de imagens desenvolvido com **Sharp**. Ao servir recursos de imagem do armazenamento, você pode aplicar operações dinâmicas usando parâmetros de query:

```bash
# Serve image scaled to 300px width in webp format
GET /api/storage/file/products/laptop.jpg?width=300&format=webp
```

### Parâmetros Suportados

- `width`, `height`: Limites de redimensionamento, `1`–`4096` (a imagem nunca é ampliada além do original).
- `quality`: `1`–`100`.
- `format`: Converte o formato da imagem. Formatos suportados: `webp`, `jpeg`, `png`, `avif`.
- `fit`: `cover`, `contain`, `fill`, `inside` ou `outside`.

Um parâmetro fora desses limites resulta em um **400**, e não em um valor ajustado silenciosamente —
`?width=99999` costumava retornar uma imagem de 4096px e `?format=tiff` uma em webp, e
nenhum dos dois avisava sobre isso.

As miniaturas de imagens armazenadas no painel administrativo utilizam este endpoint: uma tabela ou prévia
em card solicita uma versão em webp com cerca do dobro do tamanho renderizado (96–800px)
em vez do original. Arquivos SVG e GIF são sempre exibidos como estão.
O `sharp` é opcional: <span class="since-badge" data-since="0.25">Desde 0.25</span>
sem ele, uma requisição de transformação recebe o original, e o backend avisa uma vez
para executar `pnpm add sharp` em `backend/` (na 0.24 ele responde 500, e o painel exibe os originais).

### Desempenho e Cache LRU

A transformação consome muita CPU e memória, e em um objeto público o endpoint é
acessível anonimamente, portanto o trabalho é delimitado em vez de apenas armazenado em cache:
- **Capacidade**: um LRU limitado a **500 entradas** globalmente, indexado por fonte
  de armazenamento, bucket e chave canônica.
- **TTL (Time to Live)**: Variantes em cache expiram após **1 hora**.
- Requisições concorrentes para a mesma variante não armazenada em cache produzem **uma** transformação,
  e não uma para cada requisição.
- Um número reduzido de transformações é executado simultaneamente; além de uma fila limitada, o servidor
  responde **503 `TRANSFORM_OVERLOADED`** em vez de aceitar um trabalho que não
  conseguirá processar.

Esse cache reside no processo, o que significa que não é compartilhado entre instâncias
e não sobrevive a uma reinicialização. Duas réplicas calculam, cada uma, todas as variantes, e um
deploy descarta tudo.

### Renderizações que sobrevivem a uma reinicialização

`storageRenditionCache` grava cada imagem derivada de volta no mesmo bucket de sua
origem, para que o trabalho seja feito uma vez para toda a implantação, em vez de uma vez por
instância a cada release:

```ts
storageRenditionCache: { enabled: true }
```

ou `STORAGE_RENDITION_CACHE=true` para uma implantação empacotada (bundle). As renderizações são armazenadas
sob o prefixo reservado `_rebase/renditions/`, indexadas pela versão
do objeto de origem — portanto, substituir uma imagem serve a nova imediatamente.

Três coisas para saber antes de ativá-lo:

- **Uma leitura agora grava.** Cada nova variante custa um `PUT` no seu bucket. Ele fica
  desativado por padrão por esse motivo.
- **Uma falha na gravação não é uma requisição com falha.** Credenciais somente leitura, ou uma política
  de bucket que recuse o prefixo, degradam para o cache no processo; a imagem ainda é
  servida e o motivo é registrado em log uma vez.
- **Renderizações substituídas não são coletadas.** Substituir um objeto de origem
  abandona suas renderizações antigas. Configure uma regra de ciclo de vida em `_rebase/renditions/`
  — esse prefixo é fixo, não configurável, justamente para que uma regra possa apontar para ele.

O prefixo não é acessível a partir da API. Lê-lo ou gravá-lo diretamente
responde **400 `INVALID_STORAGE_KEY`**: todas as regras de acesso no produto —
`storageAuthorize` e as políticas declarativas da mesma forma — são escritas contra a
chave de *origem*, e uma renderização servida sob seu próprio caminho responderia a uma pergunta
que ninguém fez.

### O que é servido

O tipo de conteúdo armazenado é o que o uploader declarou — nada inspeciona os
bytes — portanto `/api/storage/file/*` só renderizará uma **allowlist restrita** inline:
imagens, vídeo, áudio, `application/pdf` e `text/plain`. Qualquer outra coisa,
incluindo `text/html`, é servida como `application/octet-stream` com
`Content-Disposition: attachment`, e todas as respostas trazem
`X-Content-Type-Options: nosniff`. Armazenamento não é hospedagem web: uma página enviada
renderizada na origem da API pode ler os cookies dessa origem e chamar seus
endpoints.

Um SVG é uma imagem que também é um documento e pode conter `<script>`. Ele é
servido como `image/svg+xml` — para que seja renderizado em uma tag `<img>` e nas miniaturas do
painel administrativo — com
`Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline'; sandbox`
em todas as respostas, incluindo URLs transformadas e URLs com token de download. Aberto
diretamente, ele é renderizado com scripts desativados e uma origem opaca, de modo que não pode
acessar os cookies ou endpoints da API.

## Limite de tamanho de arquivo

Cada fonte de armazenamento aceita arquivos até o seu próprio limite: **50 MB**, a menos que
`STORAGE_MAX_FILE_SIZE` (bytes, com sufixo `__<KEY>` para uma fonte nomeada) ou o
`maxFileSize` da fonte indique o contrário. Todas as portas limitam o arquivo ao mesmo
valor. `POST /api/storage/upload` responde `413 PAYLOAD_TOO_LARGE` acima disso; um
upload retomável é recusado na criação, antes de seu primeiro bloco; e
`OPTIONS /api/storage/tus` o divulga como `Tus-Max-Size` — para a fonte
indicada por `?storageId=`, ou a padrão caso contrário.

Na versão 0.23 apenas o `maxFileSize` da fonte define o limite; `STORAGE_MAX_FILE_SIZE` não é lido.

```bash
STORAGE_MAX_FILE_SIZE=209715200          # (default): 200 MB
STORAGE_MAX_FILE_SIZE__MEDIA=1073741824  # media: 1 GB
```

A quantidade de um arquivo que o servidor mantém de uma só vez depende da porta de entrada.
`POST /api/storage/upload` é um único corpo multipart, que o servidor analisa por inteiro:
de três a cinco vezes o tamanho do arquivo em sua memória. Um upload retomável (TUS) mantém um
bloco por vez. <span class="since-badge" data-since="0.25">Desde 0.25</span> `client.storage.putObject()` e o painel administrativo enviam arquivos
acima de 8 MiB pelo método retomável. Consulte
[Uploads retomáveis (TUS)](/docs/backend/storage-resumable-uploads/) para saber mais sobre o
protocolo, o que ele responde e como se comporta entre instâncias.

## Variáveis de Ambiente

| Variável | Descrição |
|----------|-----------|
| `STORAGE_TYPE` | `"local"`, `"s3"`, ou `"gcs"` |
| `STORAGE_PATH` | Diretório de armazenamento local (padrão: `<project>/uploads`, tanto sob `rebase dev` quanto em um servidor escrito por `rebase eject`). Um caminho relativo é lido a partir do diretório em que o servidor roda, que depois de `rebase eject` é `backend/`. Um bucket local nomeado mantém seus arquivos ao lado dele, em `<STORAGE_PATH>__<key>`, a menos que `STORAGE_PATH__<KEY>` defina o seu próprio |
| `S3_BUCKET` | Nome do bucket S3 |
| `S3_REGION` | Região AWS (padrão: `"auto"`) |
| `S3_ACCESS_KEY_ID` | Chave de acesso AWS |
| `S3_SECRET_ACCESS_KEY` | Chave secreta AWS |
| `S3_ENDPOINT` | Endpoint S3 personalizado (para MinIO, R2) |
| `S3_FORCE_PATH_STYLE` | Usar URLs no estilo path-style (obrigatório para MinIO) |
| `GCS_BUCKET` | Nome do bucket Google Cloud Storage |
| `GCS_PROJECT_ID` | ID do projeto GCP para o GCS |
| `GCS_KEY_FILENAME` | Caminho para o arquivo de chave da conta de serviço GCP (omita no GKE — o Workload Identity/ADC fornece as credenciais) |
| `GOOGLE_APPLICATION_CREDENTIALS` | Variável padrão do ADC, lida pelo próprio SDK do Google (não necessária no GCP com credenciais padrão) |
| `STORAGE_DOWNLOAD_TOKEN_TTL` | Por quanto tempo a URL de download de um arquivo privado funciona, em segundos — o tempo de vida do token gerado por `/api/storage/metadata/*` (padrão `300`, no máximo `604800`, uma semana). Aumente para vídeos e áudios privados, que continuam solicitando intervalos após a renderização da página. O formato em variável de ambiente de `storageDownloadTokenTtl` |
| `STORAGE_MAX_FILE_SIZE` | Maior arquivo que a fonte aceita, em bytes (padrão `52428800`, 50 MB). Sufixo `__<KEY>` para uma fonte nomeada. Um valor que não seja um número inteiro de bytes recusa a inicialização. Consulte [Limite de tamanho de arquivo](#limite-de-tamanho-de-arquivo) |
| `FORCE_LOCAL_STORAGE` | Permitir `STORAGE_TYPE=local` em produção — veja abaixo |
| `STORAGE_PUBLIC_READ` | Servir objetos armazenados para leitores não autenticados. A forma em variável de ambiente de `storagePublicRead`, e uma das três maneiras de satisfazer a [proteção de inicialização em produção](#autorização-por-objeto). |
| `STORAGE_ALLOW_ANY_AUTHENTICATED` | Desativa a proteção de inicialização, restaurando o comportamento onde qualquer usuário autenticado pode ler, sobrescrever, excluir ou listar qualquer chave. A forma em variável de ambiente de `storageInsecureAllowAnyAuthenticated`. Aceitável apenas quando todos os usuários conectados são confiáveis com relação a todos os arquivos. |

## Múltiplos Buckets

Um projeto pode ter mais de um bucket. Declare cada um em `config/resources.ts`
— o local único lido pela plataforma, pelo runtime e pelo console:

```ts
import { bucket } from "@rebasepro/types";

export const uploads = bucket({ engine: "s3" });    // the default one
export const media = bucket("media", { engine: "s3", label: "Media" });
```

Em seguida, execute `rebase resources --write`, que regenera `rebase.resources.json`
para que um host possa ler sua topologia sem executar um build. Consulte
[Múltiplas Fontes](/docs/backend/multiple-sources) para bancos de dados, buckets e
tópicos juntos.

Cada fonte é configurada a partir dos **mesmos nomes de variáveis carregando seu próprio
sufixo**. A fonte padrão não leva sufixo, portanto, um projeto de bucket único continua
usando os nomes comuns acima e não precisa declarar nada, e declarar buckets
nomeados ao lado dele não os altera (<span class="since-badge" data-since="0.25">Desde 0.25</span>, [detalhes](/docs/backend/multiple-sources/#which-bucket-receives-an-unqualified-upload)):

```bash
S3_BUCKET=app-uploads             # (default)
S3_BUCKET__MEDIA=app-media        # media
S3_ACCESS_KEY_ID__MEDIA=…
S3_SECRET_ACCESS_KEY__MEDIA=…
```

O sufixo é derivado da chave: em maiúsculas, caracteres não alfanuméricos convertidos em
sublinhados, após um sublinhado **duplo** (`media-cdn` → `__MEDIA_CDN`). Um
único sublinhado colidiria com nomes de variáveis reais — `S3_BUCKET_NAME`
seria interpretado como bucket `name`.

Direcione uma propriedade para uma fonte com `storageSource`:

```ts
{
    name: "Cover",
    dataType: "string",
    storage: { storageSource: "media", acceptedFiles: ["image/*"] }
}
```

Uma fonte declarada mas nunca configurada é **ignorada**, não fatal: uploads
direcionados a ela respondem `501 STORAGE_SOURCE_NOT_CONFIGURED`. A declaração de um bucket geralmente
ocorre antes que alguém conecte o armazenamento a ele, e um erro de inicialização ali
derrubaria o backend em loop de travamento até que alguém o fizesse. Uma fonte configurada
*incorretamente* pelo ambiente — um tipo sem bucket, ou um bucket sem credenciais — é recusada
na inicialização, pois isso representa um erro e não uma ausência.

### Buckets que compartilham uma conta

Geralmente, as credenciais descrevem o **provedor**, e não o bucket. Quinze buckets em
uma única instalação do MinIO significariam, de outra forma, quinze cópias da mesma chave de acesso, e
uma rotação exigiria quinze edições pareadas. Em vez disso, nomeie uma conta:

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

Apenas as variáveis com escopo de conta têm fallback — `S3_ACCESS_KEY_ID`,
`S3_SECRET_ACCESS_KEY`, `S3_ENDPOINT`, `S3_REGION`, `S3_FORCE_PATH_STYLE`, e
o par do GCS `GCS_PROJECT_ID` / `GCS_KEY_FILENAME`. O nome do bucket nunca tem:
ele é o que distingue uma fonte da outra. Um valor definido por bucket ainda prevalece,
para que uma fonte possa migrar de provedor sem quebrar as restantes.

## Fontes de Armazenamento no Frontend

Ao usar múltiplos backends de armazenamento, passe `storageSources` para o provedor `<Rebase>` para que o frontend saiba como rotear os uploads diretamente:

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

A propriedade `key` de cada fonte deve coincidir com uma chave de backend registrada no mapa `storage` do servidor. O contexto React `StorageSourcesContext` resolve a fonte ativa para cada campo de upload.

## Cache e CDNs

Cada objeto é intermediado via proxy pelo servidor, com um `ETag` para revalidação
econômica, um `Cache-Control` que depende de quem pode lê-lo e intervalos de bytes (byte ranges)
para busca em áudio e vídeo. [Cache de armazenamento e CDNs](/docs/backend/storage-caching/)
descreve os cabeçalhos e o que configurar em uma CDN à frente.

## Dicas para Produção

:::caution
**Em produção, `type: "local"` desativa o armazenamento de arquivos em vez de usá-lo.** Em uma plataforma efêmera (Cloud Run, Heroku, um pod do Kubernetes), o sistema de arquivos é apagado a cada deploy, reinicialização e desalocação — portanto, os uploads seriam bem-sucedidos, poderiam ser lidos normalmente e desapareceriam na próxima implantação, sem nenhum erro em momento algum.

Por essa razão, o padrão local não é registrado, e uma requisição para `/api/storage/*` que não informe nenhuma fonte de armazenamento responde **`501 STORAGE_NOT_CONFIGURED`**, listando as fontes atendidas. Uma fonte nomeada que esteja configurada, como `bucket("media", { engine: "s3" })`, continua operando normalmente. Os uploads falham de maneira explícita e recuperável; o restante do aplicativo continua funcionando. O armazenamento de arquivos é opcional (opt-in) em produção: ele existe assim que um bucket existir.

Defina `STORAGE_TYPE=s3` ou `gcs`. Se um **volume persistente** realmente mantiver o `STORAGE_PATH`, defina `FORCE_LOCAL_STORAGE=true` para declarar isso explicitamente. Monte-o no diretório pai de `STORAGE_PATH`, para que o diretório `<STORAGE_PATH>__<key>` de cada bucket local nomeado também fique nele.
:::

- Monte um **volume persistente** sobre o diretório pai de `STORAGE_PATH` se estiver usando armazenamento local no Docker/Kubernetes, e defina `FORCE_LOCAL_STORAGE=true` — consulte [Auto-hospedagem](/docs/deployment/self-hosting/#file-storage)
- Utilize **S3** ou compatível (R2, MinIO), ou **GCS**, para implantações em produção
- Configure uma **CDN** (CloudFront, Cloudflare) à frente para melhorar o desempenho — consulte [Configurando uma CDN na frente](/docs/backend/storage-caching/#putting-a-cdn-in-front)
- **Qualquer aplicativo com armazenamento em produção deve declarar um modelo de acesso** — veja abaixo.
  Não apenas os multi-tenant: o servidor *recusa a inicialização* sem um.

## Autorização por Objeto

### Políticas

A forma declarativa. Uma lista de padrões de caminho, lida sem executar nenhum código:

```ts
storagePolicies: [
    { path: "public/**", operations: ["read"], allow: "public" },
    { path: "users/:uid/**", allow: ({ params, user }) => user?.uid === params.uid }
]
```

**Uma chave que não corresponda a nenhuma política é recusada.** Cada liberação é uma linha explícita,
e um erro nega o acesso em vez de concedê-lo.

Os padrões correspondem **por segmento, nunca por substring** — `public/**` não corresponde a
`publicity/secret.png`:

| Padrão | Corresponde a |
|---|---|
| `avatars/logo.png` | exatamente essa chave |
| `users/*/avatar.png` | exatamente um segmento onde `*` estiver |
| `users/:uid/**` | um segmento capturado, seguido pelo restante — inclusive vazio |

`**` só é válido como o último segmento. `:name` captura um segmento e nunca
atravessa uma `/`; as capturas chegam como `params` no predicado.

`allow` é `"public"` (qualquer pessoa), `"authenticated"` (qualquer chamador com um uid), ou um
predicado recebendo os parâmetros capturados, o usuário, a operação e o bucket.
`operations` tem como padrão as quatro — `read`, `write`, `delete`, `list`.

As políticas atendem à proteção de inicialização em produção por si só, e um padrão malformado
falha na inicialização em vez de falhar no primeiro upload.

### O Hook

`requireAuth` e `publicRead` são interruptores *globais*: eles decidem se um chamador deve estar autenticado, e não o que esse chamador pode acessar. Sem um hook de autorização, **qualquer usuário autenticado pode ler qualquer chave que conseguir nomear** — a única barreira que separa os arquivos de dois clientes (tenants) é a impossibilidade de adivinhar a chave, o que não constitui um modelo de controle de acesso. Pior ainda: eles podem executar `GET /storage/list?prefix=` primeiro, de modo que nem sequer precisam adivinhar as chaves.

:::caution[O Storage não inicializa em produção sem um hook]
As collections são protegidas por segurança em nível de linha (RLS); o armazenamento, não. Não existe
um equivalente por objeto no bucket, portanto este hook *é* o modelo — e
o `initializeRebaseBackend` **lança um erro na inicialização** com `NODE_ENV=production` quando
o armazenamento estiver configurado e nenhuma destas opções estiver definida:

- `storageAuthorize` — um hook, por objeto. Recomendado.
- `storagePublicRead: true` — o bucket é genuinamente uma CDN pública somente leitura.
- `storageInsecureAllowAnyAuthenticated: true` — uma aplicação single-tenant onde todos os
  usuários autenticados são confiáveis para acessar qualquer arquivo. Nomeado propositalmente para exigir atenção.

Em desenvolvimento, ele emite um aviso no log, de modo que um projeto pode ter uma configuração incorreta
e funcionar perfeitamente em ambiente local até o momento em que for implantado. Um projeto inicializado via scaffold já traz um hook em
`config/storage.ts` — leia-o antes de substituí-lo, lembrando que ele modela uma
*biblioteca de conteúdo compartilhado* de um CMS, que não possui a mesma estrutura que arquivos específicos por usuário.
:::

`storageAuthorize` é o equivalente no storage das regras de segurança de uma collection, e é executado após a autenticação em todas as rotas de armazenamento:

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

| Campo | Descrição |
|-------|-----------|
| `key` | Chave do objeto, sem o prefixo do bucket e com proteção contra path traversal |
| `bucket` | Bucket resolvido (`"default"` quando não especificado) |
| `operation` | `"read"`, `"write"`, `"delete"` ou `"list"` |
| `user` | `{ uid, email?, roles? }`, ou `null` onde a rota permitir acesso anônimo |
| `storageId` | O backend nomeado, quando a requisição tiver um como alvo — sua chave canônica (`storageId=%20media` é `"media"`). Ausente para a fonte padrão, independentemente de como a requisição a nomeou (sem parâmetro, vazio ou `(default)`) |
| `data` | Acesso de leitura confiável que **ignora RLS** — `data.collection(slug).find(query)` / `.findById(id)`. A propriedade reside em uma linha, e não em um prefixo de chave, portanto o hook precisa de um leitor para responder "quem é o proprietário deste objeto?". Ele ignora a segurança em nível de linha deliberadamente: este hook *é* a decisão de autorização, e fazê-la por meio de um leitor já restrito pelas próprias permissões do chamador seria circular. Somente leitura por design. |

Retorne `false` para negar com um **403**. Lançar uma exceção também nega o acesso — uma busca de propriedade que falhar não deixará o acesso aberto.

Vale saber:

- **A rota de metadados é onde o acesso de leitura é realmente decidido.** Ela gera o token de download de curta duração com escopo de caminho no qual a rota de arquivo confia, portanto o hook atua ali. Duas leituras ignoram o hook, por design. Uma portando esse token: o hook o aprovou quando o token foi emitido, para aquele caminho e fonte específicos, de modo que um hook que agora recusaria (uma associação revogada posteriormente) não o interrompe antes que o token expire — `storageDownloadTokenTtl`, 300 segundos por padrão. E a leitura de uma chave sob `public/` feita por um chamador sem credenciais: o prefixo é a declaração de que qualquer pessoa pode lê-la, incluindo visitantes anônimos e CDNs. A leitura feita por um chamador autenticado ainda consulta o hook, mas a de um chamador anônimo não, de forma que um hook não pode tornar privada uma chave em `public/`; em vez disso, armazene o arquivo fora de `public/`. Apenas essas duas leituras ignoram o hook: um usuário que o seu adaptador de autenticação por acaso denomine `public` será verificado como qualquer outro.
- **Um bucket, um nome.** No S3 e no GCS o `bucket` do hook é sempre `"default"`, mesmo quando uma requisição especifica o bucket do provedor, que acessa os mesmos objetos.
- **Um caminho é público quando a chave que ele referencia for pública.** O prefixo `public/` é testado na chave canônica que a rota serve — depois que o segmento de bucket inicial `default/` for removido e `//`, `./` e a barra `/` inicial forem normalizados — nunca na URL como foi escrita. `/api/storage/file/notes://public/x.txt` referencia a chave privada `notes:/public/x.txt`, e a chave `default/public/x.txt` (acessada como `/api/storage/file/default/default/public/x.txt`) reside em uma pasta chamada `default`; nenhuma das duas é pública. Em um hook, teste a `key` recebida usando `isPublicStorageKey` do pacote `@rebasepro/types` — `isPublicStoragePath` analisa um caminho ou URL do lado do cliente, interpretando ambos como públicos.
- **`list` é protegido no prefixo.** A listagem é como você descobre chaves sobre as quais ninguém o informou.
- **Uploads retomáveis (TUS) são validados no momento da criação**, de modo que um upload negado não deixa arquivos temporários para trás.
- Omitir o hook preserva o comportamento anterior, de modo que aplicativos single-tenant não são afetados.

### Chaves de API e tokens

Uma pessoa autenticada possui todos os escopos de armazenamento, portanto o hook e as políticas acima
decidem por ela. Uma [chave de API](/docs/backend/api-keys/) também precisa do escopo de armazenamento
para a operação, na fonte indicada pela requisição: `storage:read` para
downloads, metadados e listagens, `storage:write` para uploads, pastas e cada
etapa de um upload retomável, `storage:delete` para exclusões. O destino é o
id da fonte, e o da fonte padrão é `(default)`: `storage:read:(default)`,
`storage:write:avatars`. Sem isso, a resposta é `403 SCOPE_MISSING`. Com isso,
o hook ainda é executado, agindo como a identidade representada pela chave.

## Reagindo a um upload

Qualquer outra gravação no Rebase permite uma reação — uma linha tem `beforeSave` e
`afterSave`, um agendamento tem um cron job — e um upload não possuía nada. Qualquer ação que
um upload implicasse precisava ser executada pelo cliente, em uma segunda chamada, o que significa que
não era executada caso o cliente se desconectasse no intervalo.

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

A sintaxe de padrões é a mesma de `storagePolicies` — segmentos literais, `*`
para um segmento, `:name` para capturar um, `**` para o restante — e um padrão
malformado falha na inicialização em vez de silenciosamente não corresponder a nada.

| Evento | Quando |
| --- | --- |
| `finalize` | após o objeto ser gravado de forma persistente; nunca para uma gravação que falhou |
| `delete` | após o objeto ter sido excluído |

`finalize` é disparado tanto para uploads multipart quanto para retomáveis (TUS) — uma vez
por upload, e não uma vez por bloco — e um upload retomável reporta o usuário que o
*criou*, já que essa foi a identidade verificada pela autorização.

O que um handler não deve presumir:

- **Um handler que lance uma exceção não falha a requisição.** O objeto já está armazenado
  no momento em que ele roda, portanto responder ao cliente com um erro informaria que o
  upload falhou quando na verdade não falhou, e os clientes realizam novas tentativas de upload. As falhas são registradas em log
  e a resposta permanece inalterada. Se o processamento for indispensável, enfileire um job.
- **Os handlers são aguardados (awaited)**, na ordem de declaração, antes do envio da resposta —
  disparar e esquecer (fire and forget) deixaria uma promise que um runtime serverless pode
  congelar no meio da execução. Um handler lento, portanto, resulta em um upload lento, o que é o
  outro motivo para enfileirar em vez de processar aqui.
- **Gravações internas não disparam triggers.** O cache de renderização de imagem grava
  objetos derivados diretamente no controlador de armazenamento; um trigger `**` disparando
  sobre eles estaria disparando sobre sua própria saída.

## Próximos Passos

- **[Frontend Storage e Upload de Arquivos](/docs/frontend/storage)** — Campos e hooks para upload de arquivos
- **[Propriedades](/docs/collections/properties)** — Configuração de propriedades de storage
