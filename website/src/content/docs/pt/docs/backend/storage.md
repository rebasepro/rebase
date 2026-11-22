---
sourceHash: 1eae92c45ebedd91
title: Configuração de Storage
sidebar_label: Configuração de Storage
description: Configure backends de sistema de arquivos local, compatíveis com S3 ou GCS/Firebase Storage para uploads de arquivos, imagens e mídia.
---

## Visão Geral

O Rebase oferece suporte a três backends de storage:

- **Sistema de arquivos local** — Arquivos armazenados em disco (ótimo para desenvolvimento)
- **Compatível com S3** — AWS S3, MinIO, Cloudflare R2, DigitalOcean Spaces
- **Google Cloud Storage / Firebase Storage** — Suporte nativo ao GCS via `@google-cloud/storage`

## Configuração

<span class="since-badge" data-since="0.35">Desde 0.35</span>

:::note[Onde isso fica]
**Runtime gerenciado** — as variáveis `STORAGE_*` no `.env` (`STORAGE_TYPE`, `S3_BUCKET` / `GCS_BUCKET`, `STORAGE_PATH`, `STORAGE_PUBLIC_READ`, … — adicione o sufixo `__<KEY>` a qualquer uma delas para uma fonte nomeada), além de uma declaração `bucket("<key>")` em `backend/resources.ts` para cada bucket além do padrão, e `export const storageAuthorize` de `backend/storage.ts`. Regras por objeto também podem ser definidas como dados em `STORAGE_POLICIES` — "public", "authenticated", "owner" (o segmento `:uid` da chave é o chamador) e roles — consulte [Autorização de storage](/docs/backend/storage-authorization/#as-data-storage_policies).

**Ejetado** — o bloco `storage` em `initializeRebaseBackend({ … })`. `storagePolicies` e `storageTriggers` são exclusivos para projetos ejetados.

O mapeamento completo está na [Visão Geral do Backend](/docs/backend/#where-each-option-lives).
:::

O storage é configurado no bloco `storage` de `initializeRebaseBackend`:

### Storage Local

```typescript no-verify
const backend = await initializeRebaseBackend({
    // ...
    storage: {
        type: "local",
        basePath: "./uploads"   // Directory for file storage
    }
});
```

O storage local mantém os metadados de cada objeto ao lado dele, como `<key>.metadata.json`, portanto, uma chave cujo último segmento termine em `.metadata.json` é recusada com `400 INVALID_STORAGE_KEY` em todas as rotas. O S3 e o GCS mantêm os metadados no próprio objeto e armazenam qualquer chave. Em um sistema de arquivos que não diferencia maiúsculas de minúsculas (macOS e Windows por padrão), `Avatar.png` e `avatar.png` são o mesmo arquivo local, mas dois objetos no S3, GCS ou em um disco Linux; portanto, o servidor emite um aviso na inicialização quando a pasta de storage estiver em um desses sistemas.

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

No GCP (Cloud Run, GCE, GKE), as credenciais da conta de serviço padrão são usadas automaticamente. Fora do GCP, defina a variável de ambiente `GOOGLE_APPLICATION_CREDENTIALS` com o caminho para o arquivo de chave da conta de serviço.

### Múltiplos Backends de Storage

Você pode configurar múltiplos backends nomeados e rotear diferentes campos para storages distintos:

```typescript
storage: {
    "(default)": { type: "local", basePath: "./uploads" },
    "media": { type: "s3", bucket: "media-bucket", region: "us-east-1", ... }
}
```

Em seguida, aponte uma coluna de storage para um backend específico com `source`:

```typescript
image: col.storage({ path: "products/", source: "media" }),  // Routes to the "media" S3 backend
```

## Endpoints de Storage

| Método | Caminho | Descrição |
|--------|---------|-----------|
| `POST` | `/api/storage/upload` | Upload direto de arquivo, um corpo `multipart/form-data`: `file` (obrigatório); `key`, a chave do objeto, incluindo pastas (`author_pictures/ada.jpg`), caso contrário, o nome do arquivo na raiz; `bucket`, caso contrário, o padrão; `storageId`; `collection` e `property`, que restringem o arquivo ao `maxSize` e `acceptedFiles` dessa propriedade; e `metadata_<name>` para metadados personalizados. Qualquer outro campo é ignorado: não existe o campo `path` |
| `POST` | `/api/storage/upload?storageId=<key>` | Upload para um backend nomeado específico |
| `GET` | `/api/storage/file/*` | Obter um arquivo — tudo após `/file/` é a chave do objeto |
| `GET` | `/api/storage/file/*?storageId=<key>` | Obter um arquivo de um backend específico |
| `GET` | `/api/storage/metadata/*` | Tamanho, tipo de conteúdo e metadados personalizados de um objeto, sem seus bytes, além de um token de download de curta duração quando for privado |
| `POST` | `/api/storage/metadata` | O mesmo para até 100 objetos de uma fonte: corpo `{ keys, storageId? }` |
| `DELETE` | `/api/storage/file/*` | Excluir um arquivo |
| `GET` | `/api/storage/list` | Listar objetos sob um prefixo (`prefix`, `bucket`, `maxResults`, `pageToken`, `storageId`). Um `maxResults` menor que 1 ou um `pageToken` que a fonte nunca emitiu resulta em `400 INVALID_LIST_OPTIONS` |
| `POST` | `/api/storage/folder` | Criar um marcador de pasta vazia |
| `GET` | `/api/storage/sources` | As fontes de storage que este backend disponibiliza, por chave |
| `OPTIONS` | `/api/storage/tus` | Consultar capacidades suportadas do protocolo TUS |
| `POST` | `/api/storage/tus` | Iniciar uma sessão de upload retomável TUS |
| `HEAD` | `/api/storage/tus/:id` | Verificar o progresso do upload (byte offset) |
| `PATCH` | `/api/storage/tus/:id` | Anexar bloco de dados ao arquivo temporário |
| `DELETE` | `/api/storage/tus/:id` | Encerrar/abortar sessão de upload TUS |

**O que eles respondem.** Um único envelope, o mesmo que `/api/data` utiliza: o payload
fica sob `data`, e uma falha retorna `{ "error": { message, code, requestId } }`
com os códigos na [referência de erros](/docs/backend/errors/). `/api/storage/file/*`
é a exceção, pois seu payload é o próprio arquivo — ele responde com os bytes,
`Content-Type`, `Content-Length` e os cabeçalhos de cache.

```json
// GET /api/storage/list?prefix=products/images/
{ "data": { "items": [ { "bucket": "default", "fullPath": "products/images/a.jpg", "name": "a.jpg",
  "size": 48213, "updated": "2026-10-01T12:00:00.000Z", "contentType": "image/jpeg" } ], "prefixes": [] } }
```

Uma listagem descreve cada arquivo retornado: seu `size` em bytes e
`updated`, quando foi gravado pela última vez, no storage local, S3 e GCS, e seu
`contentType` no storage local e GCS. Uma listagem do S3 não inclui o tipo,
portanto no S3 ele fica ausente e `/api/storage/metadata/*` ainda o informa. Uma pasta em
`prefixes` não carrega nenhum deles, assim como um `StorageController` customizado que
não os defina.

`POST /api/storage/upload` responde `201` com o `{ key, bucket, storageUrl }` do objeto armazenado sob `data`;
`GET /api/storage/metadata/*` retorna os metadados do objeto e, para um objeto privado, o `token` de curta duração; `POST
/api/storage/metadata` retorna um objeto indexado pelos caminhos que lhe foram enviados, cada um contendo o que o `GET` teria respondido para
ele (veja abaixo). Uma pasta não é um objeto: `/metadata` em uma chave terminada em `/` retorna `404` em qualquer store, mesmo onde o S3
ou GCS mantêm um marcador `folder/`, portanto nenhum token de download é gerado para um prefixo; `GET /api/storage/sources` retorna o array de
fontes configuradas, com `configured: true`. Em um deployment sem nenhum storage configurado, ele responde `200 {"data": [],
"configured": false}`, enquanto todas as outras rotas respondem `501 STORAGE_NOT_CONFIGURED`. O `GET /api/auth/config` reporta
o mesmo fato como `storage: false`, para que o cliente possa evitar a requisição. `GET /api/storage/sources` é público: responde
sem token mesmo quando `requireAuth` está ativado. Ele lista as fontes (sua chave, engine, transporte e label) e nunca
um arquivo, e o SDK cliente o lê para configurar suas fontes, o que pode ocorrer antes de qualquer usuário fazer login. Um aplicativo que
lê uma fonte `direct` anonimamente também precisa dele. Todas as rotas que listam, leem ou gravam um arquivo mantêm sua autenticação.
`DELETE /api/storage/file/*` e `POST /api/storage/folder` trazem apenas uma `message`, já que não há nada a retornar.

No S3 e no GCS, o `bucket` precisa ser um dos que a fonte atende, tanto na gravação quanto na
leitura: um upload, um `POST /api/storage/folder` ou um upload TUS que especifique qualquer outro
bucket responde `404 UNKNOWN_STORAGE_SOURCE`, assim como a listagem. O storage local
continua criando o bucket em sua primeira gravação.

**Múltiplos objetos de uma só vez.** `POST /api/storage/metadata` aceita
`{ "keys": ["photos/a.png", "photos/b.png"], "storageId": "media" }` — até 100
caminhos de objetos de uma fonte, cada um formatado como `GET /api/storage/metadata/<key>`
recebe — e responde com uma entrada por chave:

```json
{ "data": {
  "photos/a.png": { "fullPath": "photos/a.png", "size": 48213, "contentType": "image/png", "token": "…", "tokenExpiresIn": 300 },
  "photos/b.png": { "error": { "code": "FORBIDDEN", "message": "Not authorized for this object", "status": 403 } }
} }
```

Cada chave é avaliada exatamente como o `GET` a avalia — o mesmo hook `storageAuthorize`
e escopo de storage, a mesma regra pública, um token de download próprio — e uma
chave recusada, ausente ou malformada responde com seu próprio `error` sem falhar
ou expor as demais. Um chamador sem sessão em um deployment que exige uma recebe
o `401` que o `GET` responderia, a menos que todas as chaves sejam públicas. Mais de
100 chaves, ou um corpo sem `keys`, retorna `400 BAD_REQUEST`. O limitador de taxa conta
a requisição como ⌈N/10⌉ requisições para N chaves, portanto uma página com 100 miniaturas custa 10.
`client.storage.getSignedUrl()` e o painel de administração enviam as consultas feitas por uma página
juntas dessa maneira e recorrem a um `GET` por arquivo em um servidor sem essa rota.

**Como a leitura de arquivos é autorizada.** As rotas de leitura — `/api/storage/file/*` e
`/api/storage/metadata/*` — aceitam o token assinado de curta duração gerado por
[`getSignedUrl()`](/docs/sdk/storage), passado como `?token=<token>` ou como
`Bearer`. Um JWT de acesso comum é **recusado** em `/file/*` com `401
Unauthorized: Access JWT not allowed on file routes`: o token que funciona em
todas as outras rotas não funciona ali, propositalmente, porque a URL de um arquivo é
algo fornecido a um navegador, uma CDN ou uma tag `<img>`. Todas as outras linhas acima
aceitam o JWT de acesso normalmente.

## Transformações de Imagem em Tempo Real

O Rebase inclui um pipeline integrado de processamento de imagens desenvolvido com **Sharp**. Ao disponibilizar imagens do storage, você pode aplicar operações dinâmicas usando parâmetros de consulta:

```bash
# Serve image scaled to 300px width in webp format
GET /api/storage/file/products/laptop.jpg?width=300&format=webp
```

### Parâmetros Suportados

- `width`, `height`: Limites de redimensionamento, de `1` a `4096` (a imagem nunca é ampliada).
- `quality`: `1` a `100`.
- `format`: Converte o formato da imagem. Formatos suportados: `webp`, `jpeg`, `png`, `avif`.
- `fit`: `cover`, `contain`, `fill`, `inside` ou `outside`.

Um parâmetro fora desses limites resulta em **400**, e não em um valor ajustado silenciosamente —
antigamente, `?width=99999` retornava uma imagem de 4096px e `?format=tiff` retornava webp, sem
nenhum aviso explícito.

As miniaturas de imagens armazenadas no painel de administração utilizam este endpoint: uma prévia
em tabela ou card solicita uma renderização webp com cerca do dobro do tamanho de exibição (96–800px)
em vez da original. Arquivos SVG e GIF são sempre exibidos como são.
O `sharp` é opcional:
sem ele, uma solicitação de transformação recebe o arquivo original, e o backend emite um aviso sugerindo
executar `pnpm add sharp` em `backend/`.

### Desempenho e Cache LRU

A transformação consome muita CPU e memória e, em objetos públicos, o endpoint pode ser
acessado anonimamente; portanto, o trabalho é limitado em vez de apenas armazenado em cache:
- **Capacidade**: um cache LRU limitado a **500 entradas** globalmente, indexado pela
  fonte de storage, bucket e chave canônica.
- **TTL (Time to Live)**: Variantes em cache expiram após **1 hora**.
- Requisições concorrentes para a mesma variante não armazenada em cache produzem **uma única** transformação,
  e não uma para cada requisição.
- Um número reduzido de transformações é executado simultaneamente; além de um limite de espera (backlog), o servidor
  responde **503 `TRANSFORM_OVERLOADED`** em vez de aceitar trabalho que não conseguirá processar a tempo.

Esse cache reside no processo, o que significa que ele não é compartilhado entre instâncias
e não sobrevive a uma reinicialização. Duas réplicas calculam, cada uma, todas as variantes, e um
novo deploy descarta tudo.

### Renderizações que sobrevivem a uma reinicialização

`storageRenditionCache` grava cada imagem derivada de volta no mesmo bucket de sua
origem, para que o trabalho seja feito uma única vez para todo o deployment, e não uma vez por
instância a cada release:

```ts
storageRenditionCache: { enabled: true }
```

ou `STORAGE_RENDITION_CACHE=true` para deploys em bundle. As renderizações são armazenadas
sob o prefixo reservado `_rebase/renditions/`, indexadas pela versão do objeto
de origem — portanto, substituir uma imagem faz com que a nova seja disponibilizada imediatamente.

Três pontos importantes antes de ativá-lo:

- **Uma leitura agora realiza uma gravação.** Cada nova variante custa um `PUT` no seu bucket. Por
  esse motivo, o recurso vem desativado por padrão.
- **Uma gravação com falha não significa uma requisição com falha.** Credenciais somente leitura, ou uma política
  de bucket que recuse o prefixo, degradam suavemente para o cache em processo; a imagem continua
  sendo servida e o motivo é registrado em log uma única vez.
- **Renderizações obsoletas não são coletadas.** Substituir um objeto de origem
  abandona suas renderizações antigas. Configure uma regra de ciclo de vida em `_rebase/renditions/`
  — esse prefixo é fixo e não configurável, justamente para que uma regra possa apontar para ele.

O prefixo não pode ser acessado a partir da API. Lê-lo ou gravá-lo diretamente
responde **400 `INVALID_STORAGE_KEY`**: todas as regras de acesso no produto —
tanto o `storageAuthorize` quanto as políticas declarativas — são escritas em relação à chave de
*origem*, e uma renderização servida sob seu próprio caminho responderia a uma pergunta
que ninguém fez.

`_rebase/maintenance/` é reservado da mesma forma. O comando `rebase storage orphans` mantém
o registro de cada varredura lá, na fonte que varreu, para que o processo que
executa a varredura e o processo que responde pelo seu status leiam o mesmo registro. Um
chamador que pudesse gravar um registro poderia escolher o que uma exclusão posterior remove; portanto,
ler, gravar ou listar o prefixo também retorna 400. Os registros são excluídos 7
dias após sua última gravação, quando a próxima varredura dessa fonte é iniciada.

### O que é servido

O content type armazenado é aquele que quem fez o upload declarou — nada inspeciona os
bytes —, portanto `/api/storage/file/*` só renderizará inline uma **lista de permissões restrita**:
imagens, vídeo, áudio, `application/pdf` e `text/plain`. Qualquer outra coisa,
incluindo `text/html`, é servida como `application/octet-stream` com
`Content-Disposition: attachment`, e todas as respostas contêm
`X-Content-Type-Options: nosniff`. O storage não é uma hospedagem web: uma página enviada e
renderizada na mesma origem da API poderia ler os cookies dessa origem e chamar seus
endpoints.

Um SVG é uma imagem que também é um documento e pode conter `<script>`. Ele é
servido como `image/svg+xml` — para que seja renderizado em uma tag `<img>` e nas miniaturas do
painel de administração — com
`Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline'; sandbox`
em todas as respostas, incluindo URLs transformadas e URLs com token de download. Aberto
diretamente, ele é renderizado com scripts desativados e em uma origem opaca, não podendo
acessar cookies nem endpoints da API.

## Limite de tamanho de arquivo

Cada fonte de storage aceita arquivos até seu próprio limite: **50 MB**, a menos que
`STORAGE_MAX_FILE_SIZE` (em bytes, com o sufixo `__<KEY>` para uma fonte nomeada) ou o
`maxFileSize` da fonte especifique o contrário. Todos os pontos de entrada aplicam o mesmo
limite. Acima desse valor, `POST /api/storage/upload` responde `413 PAYLOAD_TOO_LARGE`; um
upload retomável é recusado na criação, antes de seu primeiro chunk; e
`OPTIONS /api/storage/tus` o anuncia como `Tus-Max-Size` — para a fonte
especificada por `?storageId=` ou para a padrão, caso contrário.

```bash
STORAGE_MAX_FILE_SIZE=209715200          # (default): 200 MB
STORAGE_MAX_FILE_SIZE__MEDIA=1073741824  # media: 1 GB
```

A quantidade de dados do arquivo que o servidor retém na memória de uma só vez depende da porta de entrada.
`POST /api/storage/upload` é um corpo multipart único, que o servidor analisa por inteiro:
de três a cinco vezes o tamanho do arquivo em sua memória. Um upload retomável (TUS) mantém um
chunk por vez. O `client.storage.putObject()` e o painel de administração enviam arquivos
maiores que 8 MiB de forma retomável. Consulte
[Uploads retomáveis (TUS)](/docs/backend/storage-resumable-uploads/) para conhecer o
protocolo, o que ele responde e como se comporta entre diferentes instâncias.

## Variáveis de Ambiente

<span class="since-badge" data-since="0.35">Desde 0.35</span>

| Variável | Descrição |
|----------|-----------|
| `STORAGE_TYPE` | `"local"`, `"s3"` ou `"gcs"` |
| `STORAGE_PATH` | Diretório de storage local (padrão: `<project>/uploads`, tanto em `rebase dev` quanto em um servidor gerado por `rebase eject`). Um caminho relativo é lido a partir do diretório em que o servidor executa, que após `rebase eject` é `backend/`. Um bucket local nomeado mantém seus arquivos ao lado, em `<STORAGE_PATH>__<key>`, a menos que `STORAGE_PATH__<KEY>` especifique o seu próprio |
| `S3_BUCKET` | Nome do bucket S3 |
| `S3_REGION` | Região AWS (padrão: `"auto"`) |
| `S3_ACCESS_KEY_ID` | Chave de acesso AWS |
| `S3_SECRET_ACCESS_KEY` | Chave secreta AWS |
| `S3_ENDPOINT` | Endpoint S3 customizado (para MinIO, R2) |
| `S3_FORCE_PATH_STYLE` | Usar URLs no estilo path-style (obrigatório para MinIO) |
| `GCS_BUCKET` | Nome do bucket do Google Cloud Storage |
| `GCS_PROJECT_ID` | ID do projeto GCP para o GCS |
| `GCS_KEY_FILENAME` | Caminho para o arquivo de chave da conta de serviço do GCP (omita no GKE — o Workload Identity/ADC fornece as credenciais) |
| `GOOGLE_APPLICATION_CREDENTIALS` | Variável padrão do ADC, lida pelo próprio SDK do Google (não necessária no GCP com credenciais padrão) |
| `STORAGE_DOWNLOAD_TOKEN_TTL` | Por quanto tempo a URL de download de um arquivo privado é válida, em segundos — o tempo de vida do token gerado por `/api/storage/metadata/*` (padrão `300`, no máximo `604800`, uma semana). Aumente para vídeos e áudios privados, que continuam solicitando intervalos de bytes após a renderização da página. É a versão em variável de ambiente de `storageDownloadTokenTtl` |
| `STORAGE_MAX_FILE_SIZE` | Maior arquivo que a fonte aceita, em bytes (padrão `52428800`, 50 MB). Adicione o sufixo `__<KEY>` para uma fonte nomeada. Um valor que não seja um número inteiro de bytes recusa a inicialização. Consulte [Limite de tamanho de arquivo](#limite-de-tamanho-de-arquivo) |
| `FORCE_LOCAL_STORAGE` | Permitir `STORAGE_TYPE=local` em produção — veja abaixo |
| `STORAGE_PUBLIC_READ` | Disponibilizar objetos armazenados para leitores não autenticados. É a versão em variável de ambiente de `storagePublicRead`, e uma das três formas de atender à [proteção de inicialização em produção](#autorização-por-objeto). |
| `STORAGE_POLICIES` | Regras de acesso ao storage como JSON: `[{ "path", "operations"?, "allow" }]`, onde `allow` pode ser `"public"`, `"authenticated"`, `"owner"` ou `{ "roles": [...] }`. Bloqueia por padrão; atende à [proteção de inicialização em produção](#autorização-por-objeto). Uma lista inválida recusa a inicialização. Consulte [Autorização de storage](/docs/backend/storage-authorization/#as-data-storage_policies). |
| `STORAGE_ALLOW_ANY_AUTHENTICATED` | Desativa a proteção de inicialização, restaurando o comportamento onde qualquer usuário autenticado pode ler, sobrescrever, excluir ou listar qualquer chave. É a versão em variável de ambiente de `storageInsecureAllowAnyAuthenticated`. Aceitável apenas quando todos os usuários conectados são confiáveis para acessar qualquer arquivo. |

## Múltiplos Buckets

Um projeto pode ter mais de um bucket. Declare cada um em `backend/resources.ts`
— o local único lido pela plataforma, pelo runtime e pelo console:

```ts
import { bucket } from "@rebasepro/types";

export const uploads = bucket({ engine: "s3" });    // the default one
export const media = bucket("media", { engine: "s3", label: "Media" });
```

Em seguida, execute `rebase resources --write`, que regenera `rebase.resources.json`
para que um host possa ler sua topologia sem precisar executar um build. Consulte
[Múltiplas Fontes](/docs/backend/multiple-sources) para bancos de dados, buckets e
tópicos juntos.

Cada fonte é configurada a partir dos **mesmos nomes de variáveis, acompanhados de seu próprio
sufixo**. A fonte padrão não recebe sufixo, de modo que um projeto com um único bucket continua
usando os nomes simples acima e não precisa declarar absolutamente nada, e declarar
buckets nomeados ao lado dela não as altera ([detalhes](/docs/backend/multiple-sources/#which-bucket-receives-an-unqualified-upload)):

```bash
S3_BUCKET=app-uploads             # (default)
S3_BUCKET__MEDIA=app-media        # media
S3_ACCESS_KEY_ID__MEDIA=…
S3_SECRET_ACCESS_KEY__MEDIA=…
```

O sufixo é derivado da chave: em maiúsculas, caracteres não alfanuméricos convertidos em
sublinhados, precedidos por um sublinhado **duplo** (`media-cdn` → `__MEDIA_CDN`). Um
sublinhado simples colidiria com nomes reais de variáveis — `S3_BUCKET_NAME`
seria interpretado como o bucket `name`.

Roteie uma coluna para uma fonte com `source`:

```ts
cover: col.storage({ path: "covers/", source: "media", accept: ["image/*"] }),
```

Uma fonte que você declara, mas nunca configura, é **ignorada**, não fatal: uploads
roteados para ela respondem `501 STORAGE_SOURCE_NOT_CONFIGURED`. A declaração de um bucket geralmente
ocorre antes de alguém vincular um storage a ele, e um erro de inicialização ali faria o
backend entrar em crash-loop até que isso fosse feito. Já uma fonte que o ambiente configura
*incorretamente* — um tipo sem bucket, ou um bucket sem credenciais — é recusada
na inicialização, pois se trata de um erro e não de uma ausência.

### Buckets que compartilham uma conta

Geralmente, as credenciais descrevem o **provedor**, e não o bucket. Caso contrário, quinze buckets em
uma instalação do MinIO exigiriam quinze cópias da mesma chave de acesso, e
uma rotação exigiria quinze edições pareadas. Em vez disso, dê um nome para a conta:

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
`S3_SECRET_ACCESS_KEY`, `S3_ENDPOINT`, `S3_REGION`, `S3_FORCE_PATH_STYLE` e
o par do GCS `GCS_PROJECT_ID` / `GCS_KEY_FILENAME`. O nome do bucket nunca faz fallback:
ele é o que diferencia uma fonte de outra. Um valor específico por bucket continua tendo precedência,
de modo que uma fonte pode migrar de provedor sem afetar as demais.

### Exclusão agendada de arquivos que nenhuma linha referencia

Excluir uma linha mantém seus arquivos no bucket. Nada é excluído junto com a linha:
outra linha, uma versão no [histórico](/docs/backend/history/) ou seu próprio código
mantendo a chave em uma string comum ainda podem referenciar o arquivo. Um bucket pode solicitar
a limpeza capaz de inspecionar tudo isso:

```ts
export const voice = bucket("voice", { engine: "s3", orphanSweep: { olderThanHours: 72 } });
export const media = bucket("media", { orphanSweep: true }); // a week, daily at 04:17 UTC
```

Cada varredura declarada é um cron job, `storage-orphan-sweep-<bucket>`
(`storage-orphan-sweep-default` para o bucket padrão). Ela executa a verificação por trás de
`rebase storage orphans --delete`. Essa verificação lê todas as linhas de todas as
tabelas e todas as entradas do histórico, preservando:

- arquivos que ainda são referenciados por qualquer registro;
- arquivos mais recentes do que `olderThanHours` (no mínimo 24 horas, uma semana por padrão);
- todos os arquivos, durante aquela execução, se alguma tabela não puder ser lida.

Em seguida, ela verifica cada arquivo novamente antes de excluí-lo. Defina `schedule` com uma
expressão cron (UTC) para alterar quando ela é executada. Por ser um cron job, ela executa em uma
única instância por slot. O histórico de execuções registra quantos arquivos foram excluídos e preservados,
e a tarefa pode ser pausada ou executada manualmente na lista de cron jobs do painel de administração. Ela requer um
bucket atendido por este backend: um bucket com `transport: "direct"` é recusado na inicialização
com um aviso.

## Fontes de Storage no Frontend

O frontend obtém as fontes do servidor a partir de `GET /api/storage/sources`, portanto uma fonte `server` não precisa de entrada explícita. Passe `storageSources` para o provider `<Rebase>` para uma fonte `direct`, que faz o upload direto para o provedor, ou para definir manualmente um label ou transport:

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

A `key` de uma fonte `server` deve corresponder a uma chave de backend registrada no mapa `storage` do servidor. O contexto React `StorageSourcesContext` resolve a fonte ativa para cada campo de upload.

## Cache e CDNs

Todos os objetos passam pelo proxy do servidor, com um `ETag` para revalidação
econômica, um cabeçalho `Cache-Control` que depende de quem pode lê-lo e suporte a byte ranges
para busca em áudio e vídeo. A documentação de [Cache de storage e CDNs](/docs/backend/storage-caching/)
apresenta os cabeçalhos e o que configurar em uma CDN à frente.

## Dicas de Produção

:::caution
**Em produção, `type: "local"` desativa o storage de arquivos em vez de usá-lo.** Em plataformas efêmeras (Cloud Run, Heroku, pods do Kubernetes), o sistema de arquivos é apagado a cada deploy, reinicialização e despejo — logo, os uploads seriam concluídos com sucesso, poderiam ser lidos normalmente e desapareceriam no próximo rollout, sem qualquer indicação de erro.

Por isso, o padrão local não é registrado, e qualquer requisição para `/api/storage/*` que não especifique uma fonte de storage responde com **`501 STORAGE_NOT_CONFIGURED`**, listando as fontes que estão disponíveis. Uma fonte nomeada que esteja configurada, como `bucket("media", { engine: "s3" })`, continua atendendo. Os uploads falham de forma clara e recuperável; o restante da aplicação continua funcionando. O storage de arquivos é opt-in em produção: ele só passa a existir quando houver um bucket configurado.

Defina `STORAGE_TYPE=s3` ou `gcs`. Se um **volume persistente** realmente mantiver o `STORAGE_PATH`, defina `FORCE_LOCAL_STORAGE=true` para declarar isso explicitamente. Monte-o no diretório pai de `STORAGE_PATH`, para que o diretório `<STORAGE_PATH>__<key>` de cada bucket local nomeado também fique nele.
:::

- Monte um **volume persistente** sobre o diretório pai de `STORAGE_PATH` se for usar storage local no Docker/Kubernetes, e defina `FORCE_LOCAL_STORAGE=true` — consulte [Self-hosting](/docs/deployment/self-hosting/#file-storage)
- Use o **S3** ou compatível (R2, MinIO), ou o **GCS**, para deployments em produção
- Configure uma **CDN** (CloudFront, Cloudflare) à frente para melhorar o desempenho — consulte [Configurando uma CDN à frente](/docs/backend/storage-caching/#putting-a-cdn-in-front)
- **Qualquer aplicação com storage em produção deve declarar um modelo de acesso** — consulte
  [Autorização de Storage](/docs/backend/storage-authorization/).
  Não apenas aplicações multi-tenant: o servidor *recusa a inicialização* sem isso.

## Autorização por Objeto

Quem pode ler, gravar, excluir ou listar cada chave é determinado por `storagePolicies`
e pelo hook `storageAuthorize`, e uma chave de API também precisa do escopo de storage correspondente
à operação. Em produção, a inicialização é recusada se houver storage configurado sem um modelo de acesso. Consulte
[Autorização de Storage](/docs/backend/storage-authorization/).

## Reagindo a um Upload

Todas as outras operações de gravação no Rebase podem acionar reações — uma linha possui `beforeSave` e
`afterSave`, um agendamento tem um cron job —, mas um upload não tinha nada. Qualquer ação que um
upload demandasse precisava ser feita pelo cliente, em uma segunda chamada, o que significava que
não era feita se o cliente fechasse a conexão nesse intervalo.

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

A linguagem de padrões é a mesma de `storagePolicies` — segmentos literais, `*`
para um segmento, `:name` para capturar um, `**` para o restante — e um padrão
malformado causa falha na inicialização em vez de silenciosamente não casar com nada.

| Evento | Quando |
| --- | --- |
| `finalize` | após o objeto ser gravado de forma duradoura; nunca para gravações que falharam |
| `delete` | após o objeto ter sido removido |

O evento `finalize` é acionado tanto no fluxo multipart quanto no retomável (TUS) — uma vez
por upload, não por chunk — e um upload retomável reporta o usuário que o
*criou*, já que essa foi a identidade verificada pela autorização.

O que um handler não deve presumir:

- **Um handler que lança um erro não falha a requisição.** O objeto já está armazenado
  no momento em que ele executa, portanto responder ao cliente com um erro indicaria que o
  upload falhou quando não falhou, e os clientes tentam novamente uploads com falha. Falhas são registradas em log
  e a resposta permanece inalterada. Se a execução for obrigatória, enfileire um job.
- **Os handlers são aguardados**, na ordem de declaração, antes de a resposta ser enviada —
  fazer fire and forget deixaria uma promise sujeita a ser congelada no meio da execução por um ambiente serverless.
  Portanto, um handler lento resulta em um upload lento, sendo este outro motivo para enfileirar em vez de processar aqui.
- **Gravações internas não disparam gatilhos.** O cache de renderização de imagens grava
  os objetos derivados diretamente no storage controller; um gatilho `**` disparado
  para eles acabaria disparando sobre a própria saída.

## Próximos Passos

- **[Storage no Frontend e Upload de Arquivos](/docs/frontend/storage)** — Campos de upload de arquivos e hooks
- **[Colunas](/docs/schema/columns/#storage-columns)** — `col.storage()` e suas opções
