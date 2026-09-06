---
sourceHash: c6ff4a9052df3362
title: Configuração de Armazenamento
sidebar_label: Configuração de Armazenamento
description: Configure backends de armazenamento em sistema de arquivos local, compatíveis com S3 ou GCS/Firebase Storage para uploads de arquivos, imagens e mídia.
---

## Visão Geral

A Rebase suporta três backends de armazenamento:

- **Sistema de arquivos local** — Arquivos armazenados em disco (ótimo para desenvolvimento)
- **Compatível com S3** — AWS S3, MinIO, Cloudflare R2, DigitalOcean Spaces
- **Google Cloud Storage / Firebase Storage** — Suporte nativo a GCS via `@google-cloud/storage`

## Configuração

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

No GCP (Cloud Run, GCE, GKE), as credenciais da conta de serviço padrão são usadas automaticamente. Fora do GCP, defina a variável de ambiente `GOOGLE_APPLICATION_CREDENTIALS` com o caminho do arquivo de chave da sua conta de serviço.

### Múltiplos Backends de Armazenamento

Você pode configurar vários backends nomeados e rotear diferentes campos para diferentes armazenamentos:

```typescript
storage: {
    "(default)": { type: "local", basePath: "./uploads" },
    "media": { type: "s3", bucket: "media-bucket", region: "us-east-1", ... }
}
```

Depois, nas propriedades da sua coleção, referencie um backend específico:

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
|--------|------|-------------|
| `POST` | `/api/storage/upload` | Upload direto de arquivo |
| `POST` | `/api/storage/upload?storageId=<key>` | Upload para um backend nomeado específico |
| `GET` | `/api/storage/file/*` | Recuperar um arquivo — tudo o que vem depois de `/file/` é a chave do objeto |
| `GET` | `/api/storage/file/*?storageId=<key>` | Recuperar um arquivo de um backend específico |
| `GET` | `/api/storage/metadata/*` | Tamanho, tipo de conteúdo e última modificação de um objeto, sem os seus bytes |
| `DELETE` | `/api/storage/file/*` | Excluir um arquivo |
| `GET` | `/api/storage/list` | Listar objetos sob um prefixo (`prefix`, `bucket`, `maxResults`, `pageToken`, `storageId`) |
| `POST` | `/api/storage/folder` | Criar um marcador de pasta vazia |
| `GET` | `/api/storage/sources` | As fontes de armazenamento que este backend serve, por chave |
| `OPTIONS` | `/api/storage/tus` | Consultar os recursos suportados do protocolo TUS |
| `POST` | `/api/storage/tus` | Iniciar uma sessão de upload retomável TUS |
| `HEAD` | `/api/storage/tus/:id` | Verificar o progresso do upload (offset de bytes) |
| `PATCH` | `/api/storage/tus/:id` | Anexar um bloco de dados ao arquivo temporário |
| `DELETE` | `/api/storage/tus/:id` | Encerrar/abortar a sessão de upload TUS |

**O que respondem.** Um envelope, o mesmo que `/api/data` usa: a carga útil fica
sob `data`, e uma falha é `{ "error": { message, code, requestId } }` com os
códigos da [referência de erros](/docs/backend/errors/). `/api/storage/file/*` é a
exceção, porque a sua carga útil é o ficheiro — responde com os bytes, com
`Content-Type`, `Content-Length` e os cabeçalhos de cache.

```json
// GET /api/storage/list?prefix=products/images/
{ "data": { "items": [ { "bucket": "default", "fullPath": "products/images/a.jpg", "name": "a.jpg" } ], "prefixes": [] } }
```

`POST /api/storage/upload` responde `201` com o `{ key, bucket, storageUrl }` do
objeto guardado sob `data`; `GET /api/storage/metadata/*` os metadados do objeto
e, para um objeto privado, o `token` de curta duração;
`GET /api/storage/sources` o array das fontes configuradas.
`DELETE /api/storage/file/*` e `POST /api/storage/folder` transportam apenas uma
`message`, porque não há nada a devolver.

**Como a leitura de um arquivo é autorizada.** As rotas de leitura —
`/api/storage/file/*` e `/api/storage/metadata/*` — aceitam o token assinado e de curta
duração que [`getSignedUrl()`](/docs/sdk/storage) emite, passado como `?token=<token>`
ou como `Bearer`. Um JWT de acesso comum é **recusado** em `/file/*` com `401
Unauthorized: Access JWT not allowed on file routes`: o token que funciona em todas as
outras rotas não funciona aqui, de propósito, porque a URL de um arquivo é algo que se
entrega a um navegador, a uma CDN ou a uma tag `<img>`. Todas as outras linhas acima
aceitam o JWT de acesso como sempre.

## Transformações de Imagem em Tempo Real

A Rebase inclui um pipeline de processamento de imagens integrado, alimentado pelo **Sharp**. Ao servir ativos de imagem do armazenamento, você pode aplicar operações dinâmicas usando parâmetros de consulta:

```bash
# Serve image scaled to 300px width in webp format
GET /api/storage/file/products/laptop.jpg?width=300&format=webp
```

### Parâmetros Suportados

- `width`: Redimensiona a imagem para a largura especificada (mantendo a proporção).
- `format`: Converte o formato da imagem. Formatos suportados: `webp`, `jpeg`, `png`, `avif`.

### Desempenho e Cache LRU

Para evitar alta utilização de CPU e latência de escalonamento sob tráfego intenso, as imagens processadas são armazenadas em um **Cache LRU** baseado em memória:
- **Capacidade**: Limitada a **500 entradas** globalmente.
- **TTL (tempo de vida)**: As variantes em cache expiram após **1 hora**.
- Requisições subsequentes para a mesma combinação de tamanho/formato atingem o cache LRU instantaneamente, evitando a manipulação redundante de arquivos.

## Protocolo de Upload Retomável TUS

Para enviar arquivos grandes (até **5 GB**) ou lidar com condições de rede instáveis, a Rebase implementa o protocolo aberto **TUS v1.0.0**, incluindo as extensões `Creation` e `Termination`.

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

1. **Inicialização da sessão (`POST`)**: O cliente envia o tamanho total do arquivo no cabeçalho `Upload-Length` e metadados em base64 via `Upload-Metadata`. O servidor cria um arquivo de espaço reservado vazio sob um diretório temporário oculto `.tus-uploads/` e retorna a URL de upload.
2. **Consultas de progresso (`HEAD`)**: Se um upload for interrompido, o cliente consulta a URL de upload usando uma requisição `HEAD`. O servidor retorna a posição atual de bytes no cabeçalho `Upload-Offset`.
3. **Anexação de dados (`PATCH`)**: O cliente retoma o envio de dados binários a partir do offset retornado com `Content-Type: application/offset+octet-stream`. O servidor grava os blocos recebidos diretamente no arquivo temporário usando as APIs de baixo nível `open` e `write` do Node no offset de bytes especificado.
4. **Finalização**: Quando o `Upload-Offset` acumulado coincide com o `Upload-Length` declarado, a Rebase lê o arquivo temporário concluído, empacota-o como um objeto `File` padrão do JavaScript e o salva no backend de armazenamento configurado (disco local ou S3). O arquivo temporário é então excluído.
5. **Varredura periódica**: Um limpador em segundo plano é executado a cada **60 segundos** para excluir uploads temporários órfãos e incompletos que excederam o limite de retenção de **24 horas**.

## Variáveis de Ambiente

| Variável | Descrição |
|----------|-------------|
| `STORAGE_TYPE` | `"local"`, `"s3"` ou `"gcs"` |
| `STORAGE_PATH` | Diretório de armazenamento local (padrão: `./uploads`) |
| `S3_BUCKET` | Nome do bucket S3 |
| `S3_REGION` | Região AWS (padrão: `"auto"`) |
| `S3_ACCESS_KEY_ID` | Chave de acesso AWS |
| `S3_SECRET_ACCESS_KEY` | Chave secreta AWS |
| `S3_ENDPOINT` | Endpoint S3 personalizado (para MinIO, R2) |
| `S3_FORCE_PATH_STYLE` | Usar URLs no estilo path (necessário para MinIO) |
| `GCS_BUCKET` | Nome do bucket do Google Cloud Storage |
| `GCS_PROJECT_ID` | ID do projeto GCP para GCS |
| `GOOGLE_APPLICATION_CREDENTIALS` | Caminho para o arquivo de chave da conta de serviço do GCP (não necessário no GCP com credenciais padrão) |

## Fontes de Armazenamento do Frontend

Ao usar múltiplos backends de armazenamento, passe `storageSources` para o provedor `<Rebase>` para que o frontend saiba como rotear os uploads diretamente:

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

A `key` de cada fonte deve corresponder a uma chave de backend registrada no mapa `storage` do servidor. O contexto React `StorageSourcesContext` resolve a fonte ativa para cada campo de upload.

## Dicas para Produção

:::caution
**Em produção, `type: "local"` desativa o armazenamento de arquivos em vez de usá-lo.** Em plataformas efêmeras (Cloud Run, Heroku, um pod Kubernetes) o sistema de arquivos é apagado a cada implantação, reinício e remoção: os uploads teriam sucesso, seriam lidos normalmente e desapareceriam na implantação seguinte, sem erro algum.

Por isso nenhum backend de armazenamento é registrado e `/api/storage/*` responde **`501 STORAGE_NOT_CONFIGURED`**. Os uploads falham de forma visível e recuperável, e o resto da aplicação continua funcionando.

Defina `STORAGE_TYPE=s3` ou `gcs`. Se realmente houver um **volume durável** montado em `STORAGE_PATH`, declare isso explicitamente com `FORCE_LOCAL_STORAGE=true`.
:::

- Monte um **volume persistente** se usar armazenamento local no Docker/Kubernetes, e defina `FORCE_LOCAL_STORAGE=true`
- Use **S3** ou compatível (R2, MinIO) para implantações em produção
- Configure uma **CDN** (CloudFront, Cloudflare) na frente do seu bucket S3 para desempenho

## Próximos Passos

- **[Armazenamento e Upload de Arquivos no Frontend](/docs/frontend/storage)** — Campos e hooks de upload de arquivos
- **[Propriedades](/docs/collections/properties)** — Configuração da propriedade de armazenamento
