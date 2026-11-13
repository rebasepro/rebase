---
sourceHash: 14cb375a352ba487
title: Armazenamento e Arquivos
sidebar_label: Armazenamento
description: Faça upload, download, listagem e exclusão de arquivos usando o módulo de armazenamento do SDK tipado do Rebase.
---

## Visão Geral

O módulo `client.storage` fornece métodos para gerenciamento de arquivos — upload, download, listagem e exclusão. Ele funciona tanto com disco local quanto com backends de armazenamento compatíveis com S3, dependendo da configuração do seu servidor.

Todos os métodos de armazenamento utilizam o transporte compartilhado, portanto, os tokens de autenticação são injetados automaticamente.

## Fazer Upload de um Arquivo

Use `putObject()` para fazer upload de um arquivo. Ele aceita um objeto `File` ou `Blob` juntamente com uma chave de armazenamento opcional e metadados:

```typescript
const result = await client.storage.putObject({
    file: fileObject,                   // File or Blob
    key: "products/images/camera.jpg",  // Storage path (optional)
    bucket: "uploads",                  // Bucket name (optional)
    public: false,                      // Store public (permanent token-less URL) — optional, default false
    metadata: {                         // Custom metadata (optional)
        description: "Product photo",
        uploadedBy: "user-123"
    }
});

// result: { key: string; bucket: string; storageUrl: string }
```

Um arquivo com mais de 8 MiB sobe através do endpoint retomável (TUS) do servidor, 8 MiB por requisição, em vez de uma única requisição multipart que o servidor processa inteira — portanto, um upload grande custa ao servidor um chunk de memória, não três a cinco vezes o tamanho do arquivo. Um chunk que falha no caminho é enviado novamente a partir do ponto onde o servidor parou. O resultado, o objeto armazenado e as verificações do servidor são os mesmos em ambos os casos. Quando o endpoint retomável não puder receber o arquivo (um servidor mais antigo ou várias instâncias que não compartilham uploads), ele é enviado como um único `POST /api/storage/upload`, e o mesmo acontece com todos os arquivos subsequentes desse cliente. Consulte [Uploads retomáveis (TUS)](/docs/backend/storage-resumable-uploads/).

### A partir de um Input de Arquivo

```typescript
const input = document.querySelector<HTMLInputElement>("#file-input");
const file = input?.files?.[0];

if (file) {
    const result = await client.storage.putObject({
        file,
        key: `avatars/${userId}/${file.name}`
    });
    console.log("Uploaded to:", result.key);
}
```

## Obter uma URL Assinada

Recupere uma URL de download e metadados para um arquivo armazenado:

```typescript
const { url, metadata, fileNotFound } = await client.storage.getSignedUrl(
    "products/images/camera.jpg"
);

if (url) {
    console.log("Download URL:", url);
    console.log("Content type:", metadata?.contentType);
} else {
    console.log("File not found");
}
```

:::caution[O argumento `bucket` é um prefixo de caminho atualmente]
No `getSignedUrl`, `getObject` e `deleteObject`, o segundo argumento é incorporado à chave do objeto (`<bucket>/<key>`) e nunca chega ao servidor como um bucket, portanto, um nome que a implantação não atende é reportado como um *arquivo* ausente, e não como um bucket desconhecido — e um arquivo gravado com `putObject({ bucket: "media" })` não é lido de volta com `getSignedUrl(key, "media")`. Leia um arquivo de volta com o mesmo formato de chamada usado para gravá-lo. O lado do servidor já responde com `404 UNKNOWN_STORAGE_SOURCE` para um bucket que ele não atende em `/api/storage/list`, e no S3 ou GCS em uploads também; o argumento do SDK está sendo reformulado para corresponder a isso.
:::

Com um bucket específico:

```typescript
const { url } = await client.storage.getSignedUrl(
    "camera.jpg",
    "product-images"   // bucket
);
```

O SDK armazena URLs assinadas em cache para evitar chamadas redundantes ao servidor, até que o token de download de cada uma expire. Consultas feitas juntas — uma página de pré-visualizações chamando `getSignedUrl()` no mesmo tick — vão para o servidor como um único `POST /api/storage/metadata` a cada 100 arquivos, o que o limitador de taxa (rate limiter) conta como um décimo das requisições que ele substitui; um arquivo que um chamador não pode ler falha apenas nessa chamada. O cache pertence à credencial que solicitou: quando o token de acesso muda — um logout, outro usuário fazendo login, uma atualização —, ele recomeça do zero, de modo que um usuário nunca receba uma URL gerada para outro.

### URLs privadas vs. públicas

- **Arquivos privados** recebem uma URL com um **token de download de curta duração e com escopo de caminho** (`?token=…`, 5 minutos, a menos que o servidor defina `STORAGE_DOWNLOAD_TOKEN_TTL`, o qual a versão 0.23 não lê) — nunca o seu token de acesso. Como ele expira, **não persista uma URL privada**; armazene o **caminho** do arquivo e chame `getSignedUrl()` novamente ao renderizá-lo.
- **Arquivos públicos** (armazenados sob o prefixo `public/` — defina `storage: { public: true }` na propriedade ou passe `public: true` para `putObject`) recebem uma URL **estável, sem token, permanente e passível de cache em CDN** sem ida e volta ao servidor. Estas são seguras para armazenar em um banco de dados e usar como hotlink.

### Arquivos dentro de texto

Textos que incorporam um arquivo — as imagens em um campo markdown — também não podem conter uma URL privada; portanto, contêm uma **referência de armazenamento** no lugar: `rebase-storage:posts/cover.png`, com `?storageId=media` quando o arquivo está em uma fonte nomeada. É isso que o editor markdown do painel de administração grava para uma imagem enviada. Troque as referências por URLs ao renderizar o texto:

```typescript
import { resolveStorageReferences } from "@rebasepro/client";

const post = await client.data.table("posts").findById("post-1");
const body = await resolveStorageReferences(String(post?.body ?? ""), client);
// `body` is the same markdown, each reference replaced by a fresh URL.
```

Cada objeto é assinado uma vez por chamada, a partir de sua própria fonte, para que uma imagem privada continue funcionando independentemente de quanto tempo atrás foi enviada. Uma referência que nomeia um objeto que não existe mais é deixada como está. `storageReference(key, storageId?)` cria uma referência, para textos que você mesmo escreve.

Textos salvos antes da existência das referências contêm a própria URL de download do arquivo privado, `…/storage/file/posts/cover.png?token=…`, cujo token expirou minutos após ter sido gravado. O `resolveStorageReferences` renova essas também: o token ainda nomeia o objeto, portanto a URL é substituída por uma nova. Para armazenar referências em vez disso, reescreva o texto uma vez com `storageReferencesForDownloadUrls(text)`, o que mantém todas as outras URLs como estão.

## Baixar um Arquivo

Recupere um arquivo como um objeto `File`:

```typescript
const file = await client.storage.getObject("products/images/camera.jpg");

if (file) {
    console.log("File name:", file.name);
    console.log("File type:", file.type);
    console.log("File size:", file.size);

    // Create a download link
    const url = URL.createObjectURL(file);
    window.open(url);
} else {
    console.log("File not found");
}
```

Com um bucket específico:

```typescript
const file = await client.storage.getObject("camera.jpg", "product-images");
```

## Excluir um Arquivo

```typescript
await client.storage.deleteObject("products/images/camera.jpg");

// With bucket
await client.storage.deleteObject("camera.jpg", "product-images");
```

Excluir um arquivo inexistente não lança um erro.

## Listar Arquivos

Liste arquivos por prefixo, com paginação opcional:

```typescript
const result = await client.storage.listObjects("products/images/", {
    bucket: "uploads",
    maxResults: 50,
    pageToken: undefined   // for pagination
});

for (const item of result.items) {
    console.log(item.fullPath, item.name, item.size, item.updated, item.contentType);
}

// Paginate
if (result.nextPageToken) {
    const nextPage = await client.storage.listObjects("products/images/", {
        pageToken: result.nextPageToken
    });
}
```

Cada item carrega seu `size` em bytes e `updated` (um timestamp ISO 8601) no armazenamento local, S3 e GCS, e seu `contentType` no armazenamento local e GCS — o suficiente para exibir uma pasta sem um `getSignedUrl()` por arquivo. Uma listagem do S3 não possui tipo de conteúdo; pastas (`result.prefixes`) não carregam nenhum dos três.

## Formatos de Chaves de Armazenamento

O SDK lida de forma transparente com prefixos de chaves de armazenamento. Você pode passar chaves com ou sem o prefixo do protocolo:

```typescript
// All equivalent — the SDK strips the prefix internally
await client.storage.getSignedUrl("local://products/image.jpg");
await client.storage.getSignedUrl("s3://products/image.jpg");
await client.storage.getSignedUrl("products/image.jpg");
```

## Referência da API

| Método | Descrição | Retorna |
|--------|-----------|---------|
| `putObject({ file, key?, bucket?, metadata? })` | Fazer upload de um arquivo | `UploadFileResult` |
| `getSignedUrl(key, bucket?)` | Obter URL de download + metadados | `DownloadConfig` |
| `getObject(key, bucket?)` | Baixar como objeto `File` | `File \| null` |
| `deleteObject(key, bucket?)` | Excluir um arquivo | `void` |
| `listObjects(prefix, options?)` | Listar arquivos por prefixo | `StorageListResult` |

## Próximos Passos

- **[Configuração de Armazenamento](/docs/backend/storage)** — Configure S3 ou armazenamento local no servidor
- **[Consultando Dados](/docs/sdk/querying)** — Operações CRUD e construtor de consultas
- **[Autenticação](/docs/sdk/authentication)** — Login e gerenciamento de sessão
