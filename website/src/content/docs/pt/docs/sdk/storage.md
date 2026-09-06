---
sourceHash: 8e6b49d8e91f586c
title: Armazenamento e Arquivos
sidebar_label: Armazenamento
description: Envie, baixe, liste e exclua arquivos usando o módulo de armazenamento do SDK Cliente da Rebase.
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

// result: { key: string, url: string, ... }
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

Com um bucket específico:

```typescript
const { url } = await client.storage.getSignedUrl(
    "camera.jpg",
    "product-images"   // bucket
);
```

O SDK armazena em cache as URLs assinadas para evitar chamadas redundantes ao servidor.

### URLs privadas vs. públicas

- **Arquivos privados** recebem uma URL com um **token de download de curta duração e restrito ao caminho** (`?token=…`, 5 min por padrão) — nunca seu token de acesso. Como ele expira, **não persista uma URL privada**; armazene o **caminho** do arquivo e chame `getSignedUrl()` novamente ao renderizá-lo.
- **Arquivos públicos** (armazenados sob o prefixo `public/` — defina `storage: { public: true }` na propriedade, ou passe `public: true` para `putObject`) recebem uma URL **estável, sem token, permanente e cacheável por CDN**, sem ida e volta ao servidor. São seguros para armazenar em um banco de dados e vincular diretamente.

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
