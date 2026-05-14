---
title: Armazenamento
sidebar_label: Armazenamento
description: Configure o armazenamento de arquivos com sistema de arquivos local ou backends compatíveis com S3 para uploads de arquivos, imagens e mídia.
---

## Visão Geral

Rebase oferece armazenamento de arquivos integrado com duas opções de backend:

-   **Sistema de arquivos local** — Arquivos armazenados em disco (ótimo para desenvolvimento)
-   **Compatível com S3** — AWS S3, MinIO, Cloudflare R2, DigitalOcean Spaces

## Configuração do Backend

### Armazenamento Local

```typescript
await initializeRebaseBackend({
    // ...
    storage: {
        type: "local",
        basePath: "./uploads"   // Directory for file storage
    }
});
```

### Armazenamento S3

```typescript
import { env } from "./env";

await initializeRebaseBackend({
    // ...
    storage: {
        type: "s3",
        bucket: env.S3_BUCKET!,
        region: env.S3_REGION || "us-east-1",
        accessKeyId: env.S3_ACCESS_KEY_ID!,
        secretAccessKey: env.S3_SECRET_ACCESS_KEY!,
        // Optional: custom endpoint for MinIO, R2, etc.
        endpoint: env.S3_ENDPOINT
    }
});
```

### Múltiplos Backends de Armazenamento

Você pode configurar múltiplos backends de armazenamento e direcionar diferentes campos para diferentes backends:

```typescript
storage: {
    "(default)": { type: "local", basePath: "./uploads" },
    "media": { type: "s3", bucket: "media-bucket", region: "us-east-1", ... }
}
```

## Endpoints de Armazenamento

| Método | Caminho | Descrição |
|--------|------|-------------|
| `POST` | `/api/storage/upload` | Fazer upload de um arquivo |
| `GET` | `/api/storage/files/:path` | Baixar/servir um arquivo |
| `DELETE` | `/api/storage/files/:path` | Excluir um arquivo |

## Frontend: Campos de Upload de Arquivo

Para adicionar uploads de arquivo às suas coleções, use a propriedade `storage` em campos de string:

```typescript
properties: {
    image: {
        type: "string",
        name: "Product Image",
        storage: {
            storagePath: "products",       // Subdirectory in storage
            acceptedFiles: ["image/*"],    // MIME type filter
            maxSize: 5 * 1024 * 1024,      // 5MB max
            fileName: (context) => {        // Custom filename
                return context.entityId + "_" + context.file.name;
            }
        }
    },
    documents: {
        type: "array",
        name: "Documents",
        of: {
            type: "string",
            storage: {
                storagePath: "documents",
                acceptedFiles: ["application/pdf", "image/*"]
            }
        }
    }
}
```

![Campo de upload de arquivo](/img/fields/File_upload.png)

### Opções de Configuração de Armazenamento

| Propriedade | Tipo | Descrição |
|----------|------|-------------|
| `storagePath` | `string` | Subdiretório dentro do backend de armazenamento |
| `acceptedFiles` | `string[]` | Tipos MIME permitidos (por exemplo, `["image/*"]`, `["application/pdf"]`) |
| `maxSize` | `number` | Tamanho máximo do arquivo em bytes |
| `fileName` | `function` | Gerador de nome de arquivo personalizado |
| `metadata` | `object` | Metadados adicionais para armazenar com o arquivo |
| `storeUrl` | `boolean` | Armazena a URL completa em vez do caminho relativo |

### Múltiplos Uploads de Arquivo

Envolva a propriedade storage em um array para múltiplos uploads de arquivo:

```typescript
photos: {
    type: "array",
    name: "Photos",
    of: {
        type: "string",
        storage: {
            storagePath: "photos",
            acceptedFiles: ["image/*"]
        }
    }
}
```

![Upload de múltiplos arquivos](/img/fields/Multi_file_upload.png)

## Frontend: Hook useStorageSource

Para operações programáticas de arquivo:

```typescript
import { useStorageSource } from "@rebasepro/core";

const storageSource = useStorageSource();

// Upload a file
const result = await storageSource.uploadFile({
    file,
    fileName: "my-file.pdf",
    path: "documents"
});

// Get download URL
const url = await storageSource.getDownloadURL(result.path);
```

## Dicas para Produção

:::caution
**Armazenamento local não é adequado para implantações em produção** em plataformas efêmeras (Cloud Run, Heroku, etc.) onde o sistema de arquivos é apagado a cada deploy. Use S3 para produção.
:::

-   Monte um **volume persistente** se estiver usando armazenamento local em Docker/Kubernetes
-   Use **S3** ou compatível (R2, MinIO) para implantações em produção
-   Configure uma **CDN** (CloudFront, Cloudflare) na frente do seu bucket S3 para desempenho

## Próximos Passos

-   **[SDK do Cliente](/docs/sdk)** — Operações programáticas de dados e arquivos
-   **[Propriedades](/docs/collections/properties)** — Todos os tipos de propriedade
---
