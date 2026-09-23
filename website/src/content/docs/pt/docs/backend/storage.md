---
sourceHash: 68889c97cefde465
title: Configuração de Armazenamento
sidebar_label: Configuração de Armazenamento
description: Configure backends de armazenamento em sistema de arquivos local, compatíveis com S3 ou GCS/Firebase Storage para uploads de arquivos, imagens e mídia.
---

## Visão Geral

O Rebase suporta três backends de armazenamento:

- **Sistema de arquivos local** — Arquivos armazenados em disco (ótimo para desenvolvimento)
- **Compatível com S3** — AWS S3, MinIO, Cloudflare R2, DigitalOcean Spaces
- **Google Cloud Storage / Firebase Storage** — Suporte nativo ao GCS via `@google-cloud/storage`

## Configuração

:::note[Onde isso vai]
**Runtime gerenciado** — as variáveis `STORAGE_*` no `.env` (`STORAGE_TYPE`, `STORAGE_BUCKET` ou `S3_BUCKET` / `GCS_BUCKET`, `STORAGE_PATH`, `STORAGE_PUBLIC_READ`, … — adicione o sufixo `__<KEY>` em qualquer uma delas para uma fonte nomeada), além de uma declaração `bucket("<key>")` em `config/resources.ts` para cada bucket além do padrão, e `export const storageAuthorize` a partir de `config/index.ts`. O `storageAuthorize` não possui uma forma em variável de ambiente intencionalmente: nenhuma variável pode expressar "este usuário pode ler esta chave".

**Ejetado** — o bloco `storage` em `initializeRebaseBackend({ … })`. O `storagePolicies` e o `storageTriggers` estão disponíveis apenas no modo ejetado.

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

### Armazenamento GCS / Firebase Storage

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

Na GCP (Cloud Run, GCE, GKE), as credenciais padrão da conta de serviço são usadas automaticamente. Fora da GCP, defina a variável de ambiente `GOOGLE_APPLICATION_CREDENTIALS` com o caminho para o arquivo de chave da sua conta de serviço.

### Múltiplos Backends de Armazenamento

Você pode configurar múltiplos backends nomeados e direcionar diferentes campos para armazenamentos distintos:

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
| `GET` | `/api/storage/file/*` | Obter um arquivo — tudo após `/file/` é a chave do objeto |
| `GET` | `/api/storage/file/*?storageId=<key>` | Obter um arquivo de um backend específico |
| `GET` | `/api/storage/metadata/*` | Tamanho, content-type e última modificação de um objeto, sem os seus bytes |
| `DELETE` | `/api/storage/file/*` | Excluir um arquivo |
| `GET` | `/api/storage/list` | Listar objetos sob um prefixo (`prefix`, `bucket`, `maxResults`, `pageToken`, `storageId`). Um `maxResults` menor que 1, ou um `pageToken` que a fonte nunca emitiu, resulta em `400 INVALID_LIST_OPTIONS` |
| `POST` | `/api/storage/folder` | Criar um marcador de pasta vazia |
| `GET` | `/api/storage/sources` | As fontes de armazenamento atendidas por este backend, por chave |
| `OPTIONS` | `/api/storage/tus` | Consultar capacidades suportadas do protocolo TUS |
| `POST` | `/api/storage/tus` | Iniciar uma sessão de upload retomável (resumable) TUS |
| `HEAD` | `/api/storage/tus/:id` | Verificar o progresso do upload (offset de bytes) |
| `PATCH` | `/api/storage/tus/:id` | Anexar bloco de dados ao arquivo temporário |
| `DELETE` | `/api/storage/tus/:id` | Encerrar/abortar sessão de upload TUS |

**O que eles respondem.** Um único envelope, o mesmo que o `/api/data` usa: o payload
fica sob `data`, e uma falha é `{ "error": { message, code, requestId } }`
com os códigos na [referência de erros](/docs/backend/errors/). O `/api/storage/file/*`
é a exceção, porque seu payload é o próprio arquivo — ele responde com os bytes, com
`Content-Type`, `Content-Length` e os cabeçalhos de cache.

```json
// GET /api/storage/list?prefix=products/images/
{ "data": { "items": [ { "bucket": "default", "fullPath": "products/images/a.jpg", "name": "a.jpg" } ], "prefixes": [] } }
```

O `POST /api/storage/upload` responde com `201` contendo `{ key, bucket, storageUrl }`
do objeto armazenado sob `data`; o `GET /api/storage/metadata/*` retorna os metadados
do objeto e, para um objeto privado, o `token` de curta duração;
o `GET /api/storage/sources` retorna o array de fontes configuradas.
O `DELETE /api/storage/file/*` e o `POST /api/storage/folder` trazem apenas uma
`message`, já que não há nada a retornar.

No S3 e no GCS, um `bucket` precisa ser um que a fonte serve, em escritas como
em leituras: um upload, um `POST /api/storage/folder` ou um upload TUS que
nomeie qualquer outro bucket responde `404 UNKNOWN_STORAGE_SOURCE`, como a
listagem. O armazenamento local continua criando um bucket na primeira escrita.

**Como a leitura de um arquivo é autorizada.** As rotas de leitura — `/api/storage/file/*` e
`/api/storage/metadata/*` — aceitam o token assinado de curta duração emitido por
[`getSignedUrl()`](/docs/sdk/storage), passado como `?token=<token>` ou como
`Bearer`. Um JWT de acesso comum é **recusado** em `/file/*` com `401
Unauthorized: Access JWT not allowed on file routes`: o token que funciona em
todas as outras rotas não funciona ali, intencionalmente, porque uma URL de arquivo é
algo que você entrega a um navegador, a uma CDN ou a uma tag `<img>`. Todas as outras linhas acima
aceitam o JWT de acesso normalmente.

## Transformações de Imagem Dinâmicas (On-the-Fly)

O Rebase inclui um pipeline de processamento de imagens integrado baseado no **Sharp**. Ao servir recursos de imagem do armazenamento, você pode aplicar operações dinâmicas usando parâmetros de busca (query parameters):

```bash
# Serve image scaled to 300px width in webp format
GET /api/storage/file/products/laptop.jpg?width=300&format=webp
```

### Parâmetros Suportados

- `width`, `height`: Limites de redimensionamento, `1`–`4096` (a imagem nunca é ampliada além do original).
- `quality`: `1`–`100`.
- `format`: Converte o formato da imagem. Formatos suportados: `webp`, `jpeg`, `png`, `avif`.
- `fit`: `cover`, `contain`, `fill`, `inside` ou `outside`.

Um parâmetro fora desses limites resulta em um erro **400**, e não em um valor ajustado silenciosamente —
`?width=99999` costumava retornar uma imagem de 4096px e `?format=tiff` uma imagem webp, e
nenhum deles avisava sobre isso.

### Desempenho e Cache LRU

A transformação consome muita CPU e memória e, em um objeto público, o endpoint pode ser
acessado anonimamente, de modo que o trabalho é limitado em vez de apenas armazenado em cache:
- **Capacidade**: uma LRU limitada a **500 entradas** globalmente, indexada por fonte de
  armazenamento, bucket e chave canônica.
- **TTL (Time to Live)**: Variantes em cache expiram após **1 hora**.
- Requisições concorrentes para a mesma variante não armazenada em cache produzem **uma** única transformação,
  e não uma para cada requisição.
- Um pequeno número de transformações é executado simultaneamente; além de uma fila limitada, o servidor
  responde com **503 `TRANSFORM_OVERLOADED`** em vez de aceitar trabalho que não conseguirá processar.

Esse cache reside no processo, o que significa que ele não é compartilhado entre instâncias
e não sobrevive a uma reinicialização. Duas réplicas computam cada variante individualmente, e um
deploy descarta tudo.

### Renditions que sobrevivem a uma reinicialização

O `storageRenditionCache` grava cada imagem derivada de volta no mesmo bucket da sua
fonte, para que o trabalho seja feito uma vez para todo o deployment, em vez de uma vez por
instância a cada versão:

```ts
storageRenditionCache: { enabled: true }
```

ou `STORAGE_RENDITION_CACHE=true` para uma implantação em bundle. As renditions são armazenadas
sob o prefixo reservado `_rebase/renditions/`, indexadas pela versão do
objeto de origem — assim, substituir uma imagem serve a nova imediatamente.

Três coisas que você deve saber antes de ativá-lo:

- **Uma leitura agora realiza uma escrita.** Cada nova variante custa um `PUT` no seu bucket. Esse
  recurso vem desativado por padrão por esse motivo.
- **Uma falha de escrita não é uma requisição com falha.** Credenciais somente leitura, ou uma política
  de bucket que recuse o prefixo, degradam suavemente para o cache em memória do processo; a imagem
  continua sendo servida e o motivo é registrado em log uma vez.
- **Renditions substituídas não são coletadas automaticamente.** Substituir um objeto de origem
  abandona suas renditions antigas. Defina uma regra de ciclo de vida (lifecycle rule) em `_rebase/renditions/`
  — esse prefixo é fixo, não configurável, exatamente para que uma regra possa apontar para ele.

O prefixo não é acessível a partir da API. Ler ou escrever nele diretamente
responde com **400 `INVALID_STORAGE_KEY`**: todas as regras de acesso no produto —
tanto o `storageAuthorize` quanto as políticas declarativas — são escritas em relação à
chave de *origem*, e uma rendition servida em seu próprio caminho responderia a uma pergunta
que ninguém fez.

### O que é servido

O content-type armazenado é aquele que quem fez o upload declarou — nada inspeciona
os bytes — portanto, o `/api/storage/file/*` só renderizará uma **allowlist restrita** inline:
imagens (exceto SVG), vídeo, áudio, `application/pdf` e `text/plain`. Qualquer
outra coisa, incluindo `text/html` e `image/svg+xml`, é servida como
`application/octet-stream` com `Content-Disposition: attachment`, e toda
resposta traz `X-Content-Type-Options: nosniff`. Armazenamento não é hospedagem web:
uma página carregada e renderizada na mesma origem da API pode ler os cookies dessa origem e
chamar seus endpoints.

## Protocolo de Upload Retomável TUS

Para o upload de arquivos grandes (até **5GB**) ou para lidar com condições de rede instáveis, o Rebase implementa o protocolo aberto **TUS v1.0.0**, incluindo as extensões `Creation` e `Termination`.

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

### Mecânica do Ciclo de Vida do Upload

1. **Inicialização da Sessão (`POST`)**: O cliente envia o tamanho total do arquivo no cabeçalho `Upload-Length` e metadados em base64 via `Upload-Metadata`. O servidor cria um arquivo temporário vazio sob o diretório oculto `.tus-uploads/` e retorna a URL de upload.
2. **Consultas de Progresso (`HEAD`)**: Se um upload for interrompido, o cliente consulta a URL de upload usando uma requisição `HEAD`. O servidor retorna a posição atual em bytes no cabeçalho `Upload-Offset`.
3. **Anexo de Dados (`PATCH`)**: O cliente retoma o envio de dados binários a partir do offset retornado com `Content-Type: application/offset+octet-stream`. O servidor grava os blocos recebidos diretamente no arquivo temporário usando as APIs de baixo nível do Node `open` e `write` no offset de bytes especificado.
4. **Finalização**: Quando o `Upload-Offset` acumulado corresponde ao `Upload-Length` declarado, o Rebase lê o arquivo temporário concluído, envolve-o como um objeto JavaScript `File` padrão e o salva no backend de armazenamento configurado (disco local ou S3). O arquivo temporário é então excluído.
5. **Varredura Periódica**: Um limpador em segundo plano é executado a cada **60 segundos** para excluir uploads temporários incompletos e órfãos que excederam o limite de retenção de **24 horas**.

## Variáveis de Ambiente

| Variável | Descrição |
|----------|-----------|
| `STORAGE_TYPE` | `"local"`, `"s3"` ou `"gcs"` |
| `STORAGE_PATH` | Diretório de armazenamento local (padrão: `./uploads`) |
| `S3_BUCKET` | Nome do bucket S3 |
| `S3_REGION` | Região da AWS (padrão: `"auto"`) |
| `S3_ACCESS_KEY_ID` | Chave de acesso AWS |
| `S3_SECRET_ACCESS_KEY` | Chave secreta AWS |
| `S3_ENDPOINT` | Endpoint S3 personalizado (para MinIO, R2) |
| `S3_FORCE_PATH_STYLE` | Usar URLs no estilo path-style (necessário para MinIO) |
| `GCS_BUCKET` | Nome do bucket do Google Cloud Storage |
| `GCS_PROJECT_ID` | ID do projeto GCP para GCS |
| `GCS_KEY_FILENAME` | Caminho para um arquivo de chave de conta de serviço GCP (omita no GKE — Workload Identity/ADC fornece credenciais) |
| `GOOGLE_APPLICATION_CREDENTIALS` | Variável padrão do ADC, lida pelo próprio SDK do Google (desnecessária na GCP com credenciais padrão) |
| `FORCE_LOCAL_STORAGE` | Permitir `STORAGE_TYPE=local` em produção — veja abaixo |
| `STORAGE_PUBLIC_READ` | Servir objetos armazenados para leitores não autenticados. A forma em variável de ambiente de `storagePublicRead`, e uma das três maneiras de satisfazer a [proteção de inicialização em produção](#autorização-por-objeto-per-object-authorization). |
| `STORAGE_ALLOW_ANY_AUTHENTICATED` | Desativa a proteção de inicialização, restaurando o comportamento onde qualquer usuário conectado pode ler, sobrescrever, excluir ou listar qualquer chave. A forma em variável de ambiente de `storageInsecureAllowAnyAuthenticated`. Só é defensável quando todos os usuários conectados são confiáveis para acessar todos os arquivos. |

## Múltiplos Buckets

Um projeto pode ter mais de um bucket. Declare cada um em `config/resources.ts`
— o único lugar lido pela plataforma, pelo runtime e pelo console:

```ts
import { bucket } from "@rebasepro/types";

export const uploads = bucket({ engine: "s3" });    // the default one
export const media = bucket("media", { engine: "s3", label: "Media" });
```

Em seguida, execute `rebase resources --write`, que regenera `rebase.resources.json`
para que um host possa ler sua topologia sem executar um build. Consulte
[Múltiplas Fontes](/docs/backend/multiple-sources) para bancos de dados, buckets e
tópicos juntos.

Cada fonte é configurada a partir dos **mesmos nomes de variáveis com seu próprio
sufixo**. A fonte padrão não leva sufixo, portanto, um projeto de bucket único continua
usando os nomes comuns acima e não precisa declarar nada:

```bash
S3_BUCKET=app-uploads             # (default)
S3_BUCKET__MEDIA=app-media        # media
S3_ACCESS_KEY_ID__MEDIA=…
S3_SECRET_ACCESS_KEY__MEDIA=…
```

O sufixo é derivado da chave: em maiúsculas, caracteres não alfanuméricos convertidos em
sublinhados, antecedidos por um **duplo** sublinhado (`media-cdn` → `__MEDIA_CDN`). Um
sublinhado simples colidiria com nomes reais de variáveis — `S3_BUCKET_NAME`
seria interpretado como o bucket `name`.

Roteie uma propriedade para uma fonte usando `storageSource`:

```ts
{
    name: "Cover",
    dataType: "string",
    storage: { storageSource: "media", acceptedFiles: ["image/*"] }
}
```

Uma fonte que você declara mas nunca configura é **ignorada**, não fatal: uploads
roteados para ela respondem com `501 STORAGE_SOURCE_NOT_CONFIGURED`. Declarar um bucket geralmente
acontece antes que alguém anexe armazenamento a ele, e um erro de inicialização ali faria
o backend entrar em crash-loop até que alguém o configurasse. Uma fonte que o ambiente configura
*incorretamente* — um tipo sem bucket, ou um bucket sem credenciais — é recusada
na inicialização, porque isso é um erro e não uma ausência.

### Buckets que compartilham uma mesma conta

As credenciais geralmente descrevem o **provedor**, e não o bucket. Quinze buckets em
uma única instalação do MinIO significariam, de outra forma, quinze cópias da mesma chave de acesso, e
uma rotação exigiria quinze alterações em pares. Em vez disso, nomeie uma conta:

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
o par do GCS `GCS_PROJECT_ID` / `GCS_KEY_FILENAME`. O nome do bucket nunca tem fallback:
ele é o que distingue uma fonte de outra. Um valor específico por bucket ainda prevalece,
de modo que uma fonte pode mudar de provedor sem afetar as demais.

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

A `key` de cada fonte deve coincidir com uma chave de backend registrada no mapa `storage` do servidor. O contexto React `StorageSourcesContext` resolve a fonte ativa para cada campo de upload.

## Cache e CDNs

Cada objeto passa por proxy pelo servidor em vez de ser redirecionado para uma
URL assinada — uma URL assinada falha em conteúdo misto (uma página HTTPS, um MinIO HTTP) e em
endpoints acessíveis apenas pelo cluster. Portanto, os cabeçalhos de resposta são o que fazem
o cache funcionar.

Cada resposta inclui um `ETag` fraco e `Last-Modified`, construídos a partir do
tamanho do objeto e do horário de modificação. Um cliente que já possui o objeto envia
`If-None-Match` e recebe **304 sem corpo**, de modo que um carregamento repetido custa apenas um
round-trip em vez de uma transferência.

O `Cache-Control` depende de quem tem permissão para ler o objeto:

| Objeto | Cabeçalho |
|---|---|
| Sob o prefixo `public/`, ou `publicRead: true` | `public, max-age=60, stale-while-revalidate=86400, must-revalidate` |
| Qualquer outro | `private, max-age=60, must-revalidate` |
| Transformações de imagem | o mesmo, com `max-age=3600` |

`private` é deliberado: um objeto que necessitou de credenciais para ser obtido não deve ser
armazenado por um cache compartilhado, sob risco de uma CDN entregar o arquivo de um usuário para a próxima requisição.
`Vary: Authorization` é enviado pelo mesmo motivo.

Nada é marcado como `immutable`. Uma chave de armazenamento pode ser sobrescrita — gravar
em uma chave existente é uma operação comum — portanto, uma promessa de nunca revalidar
tornaria um arquivo substituído invisível até que a janela expirasse.

### Navegação (Seeking) em áudio e vídeo

Toda resposta de objeto inclui `Accept-Ranges: bytes`, e uma requisição com `Range` é
respondida com `206 Partial Content` e um `Content-Range`. Sem isso, o navegador
não oferecerá o recurso de avançar/retroceder (seek) em um elemento de mídia servido aqui — e o Safari se recusa
a reproduzir um `<video>` cuja primeira resposta não seja um `206` — portanto, para mídia, essa é
a diferença entre um player funcional e um com defeito.

- Um range por requisição: `bytes=0-499`, `bytes=500-`, `bytes=-500`. É isso que
  os navegadores enviam para reprodução.
- Múltiplos ranges em um único cabeçalho são respondidos com o objeto inteiro e um `200`,
  o que é sempre válido. Nenhum cliente relevante os envia.
- Um range que começa além do fim resulta em um `416` com `Content-Range: bytes */<size>`,
  e não em uma resposta silenciosa com o arquivo inteiro.
- A revalidação tem precedência sobre o range: uma requisição contendo tanto `If-None-Match` quanto
  `Range` recebe o `304`.

No armazenamento local, apenas o trecho solicitado é lido do disco. No S3 e GCS, o
objeto ainda é buscado por inteiro — um `StorageController` não possui leitura particionada —, portanto
a economia acontece na resposta, e não no tráfego upstream.

### Colocando uma CDN na frente

Como objetos públicos são definidos como `public` com uma janela de `stale-while-revalidate` e um
validador, qualquer proxy reverso comum ou CDN pode armazená-los em cache sem nenhuma configuração
adicional. Aponte-o para a origem da API e deixe-o honrar os cabeçalhos.

Duas coisas para configurar na própria CDN:

- **Respeitar `Vary: Authorization`**, ou não armazenar em cache rotas autenticadas de forma alguma.
  Uma CDN que ignora `Vary` e armazena em cache respostas `private` é a falha que
  este cabeçalho existe para evitar.
- **Esperar revalidação.** O `max-age` curto significa que a CDN fará novas requisições
  regularmente; essas requisições são 304s leves, e são elas que evitam que um
  objeto sobrescrito seja servido desatualizado.

## Dicas de Produção

:::caution
**Em produção, `type: "local"` desativa o armazenamento de arquivos em vez de utilizá-lo.** Em uma plataforma efêmera (Cloud Run, Heroku, um pod do Kubernetes), o sistema de arquivos é apagado a cada deploy, reinicialização e despejo (eviction) — logo, uploads seriam concluídos com sucesso, lidos perfeitamente e sumiriam no próximo rollout, sem nenhum erro em momento algum.

Por isso, o padrão local não é registrado, e uma requisição a `/api/storage/*` que não nomeia nenhuma fonte de armazenamento responde com **`501 STORAGE_NOT_CONFIGURED`**, indicando as fontes servidas. Uma fonte nomeada que está configurada, como `bucket("media", { engine: "s3" })`, continua funcionando. Os uploads falham explicitamente e de forma recuperável; o restante do app continua operando. O armazenamento de arquivos é opt-in em produção: ele só existe a partir do momento em que um bucket existir.

Defina `STORAGE_TYPE=s3` ou `gcs`. Se um **volume persistente** estiver realmente montado em `STORAGE_PATH`, defina `FORCE_LOCAL_STORAGE=true` para declarar isso explicitamente.
:::

- Monte um **volume persistente** se estiver usando armazenamento local no Docker/Kubernetes e defina `FORCE_LOCAL_STORAGE=true`
- Use **S3** ou compatível (R2, MinIO), ou **GCS**, para deployments em produção
- Configure uma **CDN** (CloudFront, Cloudflare) à frente do seu bucket para melhor desempenho
- **Qualquer aplicação com armazenamento em produção deve declarar um modelo de acesso** — veja abaixo.
  Não apenas as multi-tenant: o servidor *se recusa a inicializar* sem um.

## Autorização por Objeto (Per-Object Authorization)

### Políticas (Policies)

A forma declarativa. Uma lista de padrões de caminho, lida sem executar nenhum código:

```ts
storagePolicies: [
    { path: "public/**", operations: ["read"], allow: "public" },
    { path: "users/:uid/**", allow: ({ params, user }) => user?.uid === params.uid }
]
```

**Uma chave que não coincide com nenhuma política é recusada.** Toda ampliação de permissão é uma linha explícita,
e um erro resulta em negação em vez de concessão.

Padrões coincidem **por segmento, nunca por substring** — `public/**` não coincide com
`publicity/secret.png`:

| Padrão | O que coincide |
|---|---|
| `avatars/logo.png` | exatamente essa chave |
| `users/*/avatar.png` | exatamente um segmento onde está o `*` |
| `users/:uid/**` | um segmento capturado, depois o restante — incluindo nada |

`**` só é permitido como o segmento final. `:name` captura um segmento e nunca
atravessa uma `/`; as capturas chegam como `params` no predicado.

`allow` pode ser `"public"` (qualquer pessoa), `"authenticated"` (qualquer chamador com um uid), ou um
predicado recebendo os parâmetros capturados, o usuário, a operação e o bucket.
`operations` tem como padrão todas as quatro — `read`, `write`, `delete`, `list`.

As políticas satisfazem a proteção de inicialização em produção por si sós, e um padrão malformado
faz a inicialização falhar imediatamente, em vez de falhar no primeiro upload.

### O hook

`requireAuth` e `publicRead` são interruptores *globais*: eles decidem se um chamador precisa estar autenticado, e não o que esse chamador pode acessar. Sem um hook de autorização, **qualquer usuário autenticado pode ler qualquer chave cujo nome ele saiba** — a única coisa que separa os arquivos de dois clientes (tenants) é o fato de a chave não poder ser adivinhada, o que não constitui um modelo de controle de acesso. Pior ainda, eles podem executar `GET /storage/list?prefix=` antes, de modo que nem precisam adivinhar as chaves.

:::caution[O armazenamento não iniciará em produção sem um]
Collections são protegidas por segurança em nível de linha (RLS); o armazenamento não é. Não há
equivalente por objeto no bucket, portanto este hook *é* o modelo — e
`initializeRebaseBackend` **lança uma exceção na inicialização** sob `NODE_ENV=production` quando
o armazenamento está configurado e nenhuma destas opções está definida:

- `storageAuthorize` — um hook, por objeto. Recomendado.
- `storagePublicRead: true` — o bucket é genuinamente uma CDN pública somente leitura.
- `storageInsecureAllowAnyAuthenticated: true` — um aplicativo de cliente único (single-tenant) onde qualquer
  usuário autenticado é confiável para acessar todos os arquivos. Nomeado deliberadamente para exigir atenção dobrada.

Em desenvolvimento, ele apenas registra um aviso em log, de modo que um projeto pode estar incorreto quanto a isso e
funcionar bem localmente até o momento em que for publicado. Um projeto criado pelo gerador já vem com um hook em
`config/storage.ts` — leia-o antes de substituí-lo e observe que ele modela uma
*biblioteca de conteúdo compartilhado* de um CMS, o que difere da estrutura de arquivos individuais por usuário.
:::

O `storageAuthorize` é o análogo no armazenamento das regras de segurança de uma collection, e é executado após a autenticação em cada rota de armazenamento:

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
| `key` | Chave do objeto, com o prefixo do bucket removido e proteção contra path traversal tratada |
| `bucket` | Bucket resolvido (`"default"` quando não especificado) |
| `operation` | `"read"`, `"write"`, `"delete"` ou `"list"` |
| `user` | `{ uid, email?, roles? }`, ou `null` quando a rota permite acesso anônimo |
| `storageId` | O backend nomeado, quando a requisição teve um como destino |
| `data` | Acesso de leitura confiável que **ignora RLS** — `data.collection(slug).find(query)` / `.findById(id)`. A propriedade do recurso reside em uma linha, e não no prefixo de uma chave, portanto o hook precisa de um leitor para responder "quem é o dono deste objeto?". Ele ignora a segurança em nível de linha deliberadamente: este hook *é* a decisão de autorização, e fazê-la por meio de um leitor já limitado pelas permissões do próprio chamador criaria uma dependência circular. Somente leitura por concepção. |

Retorne `false` para negar o acesso com um erro **403**. Lançar um erro também nega o acesso — uma consulta de propriedade que falha não concede acesso acidentalmente.

Vale a pena saber:

- **A rota de metadados é onde o acesso de leitura é realmente decidido.** Ela emite o token de download de curta duração e com escopo de caminho que a rota de arquivos valida, logo o hook atua nela. Requisições que já carregam tal token, ou que atingem um caminho público declarado, ignoram o hook — o token já foi emitido sob suas regras e é válido apenas para o seu próprio caminho.
- **O `list` é controlado no prefixo.** Listar é a forma de descobrir chaves que ninguém informou a você.
- **Uploads retomáveis (TUS) são controlados no momento da criação**, de forma que um upload negado não deixa nenhum arquivo temporário para trás.
- Omitir o hook preserva o comportamento anterior, de modo que aplicativos single-tenant não são afetados.

## Reagindo a um Upload

Todas as outras gravações no Rebase podem ser interceptadas — uma linha tem `beforeSave` e
`afterSave`, um agendamento tem um cron job — mas um upload não tinha nada. Tudo o que
um upload implicava precisava ser feito pelo cliente, em uma segunda chamada, o que significa que
não era feito caso o cliente se desconectasse no meio do processo.

```ts
storageTriggers: [
    {
        path: "uploads/:uid/**",
        events: ["finalize"],
        handler: async ({ key, params, size, user }) => {
            await jobs.enqueue("index-upload", { key, uid: params.uid, size });
        }
    }
]
```

A sintaxe de padrões é a mesma de `storagePolicies` — segmentos literais, `*`
para um segmento, `:name` para capturar um, `**` para o restante — e um padrão
malformado faz a inicialização falhar, em vez de silenciosamente não coincidir com nada.

| Evento | Quando ocorre |
| --- | --- |
| `finalize` | após o objeto ser gravado de forma durável; nunca para uma gravação que falhou |
| `delete` | após o objeto ter sido excluído |

O evento `finalize` é acionado tanto para caminhos multipart quanto para uploads retomáveis (TUS) — uma vez
por upload, e não uma vez por bloco (chunk) — e um upload retomável informa o usuário que
o *criou*, já que essa foi a identidade verificada pela autorização.

O que um handler não deve assumir:

- **Um handler que lança um erro não falha a requisição.** O objeto já está armazenado
  no momento em que ele roda, portanto responder ao cliente com um erro indicaria que o
  upload falhou quando na verdade não falhou, e os clientes repetem uploads. Falhas são registradas em log
  e a resposta não é alterada. Se o trabalho for essencial, enfileire um job.
- **Handlers são aguardados (awaited)**, na ordem de declaração, antes de a resposta ser enviada —
  usar fire-and-forget deixaria uma promise que um runtime serverless poderia
  congelar no meio da execução. Um handler lento, portanto, significa um upload lento, o que é o
  outro motivo para enfileirar em vez de processar tudo aqui.
- **Gravações internas não disparam triggers.** O cache de renditions de imagens grava
  objetos derivados direto no controlador de armazenamento; um trigger `**` disparado
  nelas estaria reagindo à sua própria saída.

## Próximos Passos

- **[Armazenamento no Frontend & Uploads de Arquivos](/docs/frontend/storage)** — Campos de upload de arquivos e hooks
- **[Propriedades](/docs/collections/properties)** — Configuração de propriedades de armazenamento
