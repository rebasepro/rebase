---
sourceHash: 1a6f27afc2ce649a
title: Armazenamento e Arquivos
sidebar_label: Armazenamento
description: Envie, baixe, liste e exclua arquivos usando o módulo de armazenamento do SDK tipado do Rebase.
---

## Visão Geral

O módulo `client.storage` fornece métodos para gerenciamento de arquivos — envio, download, listagem e exclusão. Funciona tanto com disco local quanto com backends de armazenamento compatíveis com S3, dependendo da configuração do seu servidor.

Todos os métodos de armazenamento usam o transporte compartilhado, então os tokens de autenticação são injetados automaticamente.

## Enviar um Arquivo

Use `putObject()` para enviar um arquivo. Aceita um objeto `File` ou `Blob` junto com uma chave de armazenamento e metadados opcionais:

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

### A Partir de um Campo de Arquivo

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

Recupere uma URL de download e os metadados de um arquivo armazenado:

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

:::caution[O argumento `bucket` é hoje um prefixo de caminho]
Em `getSignedUrl`, `getObject` e `deleteObject`, o segundo argumento é dobrado dentro da chave do objeto (`<bucket>/<key>`) e nunca chega ao servidor como bucket, por isso um nome que o deployment não serve é reportado como *ficheiro* em falta, não como bucket desconhecido — e um ficheiro escrito com `putObject({ bucket: "media" })` não é lido de volta com `getSignedUrl(key, "media")`. Leia um ficheiro com a mesma forma de chamada que o escreveu. O lado do servidor já responde `404 UNKNOWN_STORAGE_SOURCE` para um bucket que não serve em `/api/storage/list`, e no S3 ou GCS também nos uploads; o argumento do SDK está a ser reformulado para corresponder.
:::

Com um bucket específico:

```typescript
const { url } = await client.storage.getSignedUrl(
    "camera.jpg",
    "product-images"   // bucket
);
```

O SDK armazena em cache as URLs assinadas para evitar chamadas redundantes ao servidor.

### URLs privadas vs. públicas

- **Arquivos privados** recebem uma URL com um **token de download de curta duração e restrito ao caminho** (`?token=…`, 5 minutos a menos que o servidor defina `STORAGE_DOWNLOAD_TOKEN_TTL`, que a 0.23 não lê) — nunca seu token de acesso. Como ele expira, **não persista uma URL privada**; armazene o **caminho** do arquivo e chame `getSignedUrl()` novamente ao renderizá-lo.
- **Arquivos públicos** (armazenados sob o prefixo `public/` — defina `storage: { public: true }` na propriedade, ou passe `public: true` para `putObject`) recebem uma URL **estável, sem token, permanente e cacheável por CDN**, sem ida e volta ao servidor. São seguros para armazenar em um banco de dados e vincular diretamente.

### Arquivos dentro de texto

Um texto que incorpora um arquivo — as imagens em um campo markdown — também
não pode conter uma URL privada, então ele contém uma **referência de
storage**: `rebase-storage:posts/cover.png`, com `?storageId=media` quando o
arquivo está em uma fonte nomeada. É isso que o editor markdown do painel de
administração grava para uma imagem enviada. Troque as referências por URLs
ao renderizar o texto:

```typescript
import { resolveStorageReferences } from "@rebasepro/client";

const post = await client.data.collection("posts").findById("post-1");
const body = await resolveStorageReferences(String(post?.body ?? ""), client);
// `body` é o mesmo markdown, cada referência substituída por uma URL nova.
```

Cada objeto é assinado uma vez por chamada, a partir de sua própria fonte, então
uma imagem privada continua funcionando por mais tempo que tenha passado desde
o upload. Uma referência que nomeia um objeto que não existe mais é deixada
como está. `storageReference(key, storageId?)` constrói uma, para texto que
você mesmo escreve.

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
    console.log(item.fullPath, item.name);
}

// Paginate
if (result.nextPageToken) {
    const nextPage = await client.storage.listObjects("products/images/", {
        pageToken: result.nextPageToken
    });
}
```

## Formatos de Chave de Armazenamento

O SDK lida de forma transparente com os prefixos das chaves de armazenamento. Você pode passar chaves com ou sem o prefixo de protocolo:

```typescript
// All equivalent — the SDK strips the prefix internally
await client.storage.getSignedUrl("local://products/image.jpg");
await client.storage.getSignedUrl("s3://products/image.jpg");
await client.storage.getSignedUrl("products/image.jpg");
```

## Referência da API

| Método | Descrição | Retorna |
|--------|-------------|---------|
| `putObject({ file, key?, bucket?, metadata? })` | Enviar um arquivo | `UploadFileResult` |
| `getSignedUrl(key, bucket?)` | Obter URL de download + metadados | `DownloadConfig` |
| `getObject(key, bucket?)` | Baixar como objeto `File` | `File \| null` |
| `deleteObject(key, bucket?)` | Excluir um arquivo | `void` |
| `listObjects(prefix, options?)` | Listar arquivos por prefixo | `StorageListResult` |

## Próximos Passos

- **[Configuração de Armazenamento](/docs/backend/storage)** — Configurar S3 ou armazenamento local no servidor
- **[Consultar Dados](/docs/sdk/querying)** — Operações CRUD e construtor de consultas
- **[Autenticação](/docs/sdk/authentication)** — Login e gerenciamento de sessões
