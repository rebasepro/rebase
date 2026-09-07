---
sourceHash: 1134b2a4207579d3
title: Armazenamento e Upload de Arquivos
sidebar_label: Armazenamento e Upload de Arquivos
description: Adicione campos de upload de arquivos às suas coleções, gerencie arquivos programaticamente e roteie uploads para diferentes backends de armazenamento.
---

## Visão Geral

A Rebase fornece suporte integrado a upload de arquivos nos formulários de coleção:

- Campos de upload de arquivos **arrastar e soltar**
- **Pré-visualizações de imagens** em formulários e células de tabela
- **Uploads de múltiplos arquivos** via propriedades de array
- **Filtragem por tipo MIME** e limites de tamanho
- **Nomes de arquivo personalizados** via funções de callback

## Campos de Upload de Arquivos

Para adicionar uploads de arquivos a uma coleção, use a configuração `storage` em uma propriedade do tipo string:

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
    }
}
```

### Opções de Configuração do Storage

| Propriedade | Tipo | Descrição |
|----------|------|-------------|
| `storagePath` | `string` | Subdiretório dentro do backend de armazenamento |
| `storageSource` | `string` | Fonte de armazenamento nomeada — roteia os uploads para um backend específico (por ex., `"firebase"`, `"media"`). Veja [Armazenamento Multi-Backend](#armazenamento-multi-backend). |
| `public` | `boolean` | Armazena os arquivos sob o prefixo `public/` e os serve via URLs estáveis, sem token, permanentes e cacheáveis por CDN (seguras para persistir e vincular diretamente). O padrão é `false` (arquivos privados usam URLs assinadas de curta duração). |
| `acceptedFiles` | `string[]` | Tipos MIME permitidos (por ex., `["image/*"]`, `["application/pdf"]`) |
| `maxSize` | `number` | Tamanho máximo do arquivo em bytes |
| `fileName` | `function` | Gerador de nome de arquivo personalizado |
| `metadata` | `object` | Metadados adicionais para armazenar com o arquivo |
| `storeUrl` | `boolean` | Armazena a URL completa em vez do caminho relativo |

## Uploads de Múltiplos Arquivos

Envolva a propriedade de storage em um array para enviar vários arquivos:

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

## Uploads de Documentos

Envie arquivos que não sejam imagens, como PDFs:

```typescript
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
```

## Armazenamento Multi-Backend

Quando o seu backend tem vários backends de armazenamento configurados (por ex., local + S3 + GCS), você pode rotear propriedades individuais para backends específicos usando `storageSource`:

```typescript
image: {
    type: "string",
    name: "Product Image",
    storage: {
        storageSource: "firebase",     // Routes to the "firebase" backend
        storagePath: "products/{entityId}",
        acceptedFiles: ["image/*"],
    }
}
```

### Fontes Diretas do Frontend

Para backends de armazenamento **diretos** (por ex., Firebase Storage, onde o navegador envia diretamente para a nuvem), registre-os via a prop `storageSources` em `<Rebase>`:

```tsx
import type { RebaseStorageSource } from "@rebasepro/app";

<Rebase
    client={rebaseClient}
    storageSources={[
        { key: "firebase", engine: "firebase", transport: "direct", source: firebaseStorageSource }
    ]}
>
    {/* your app */}
    …
</Rebase>
```

| Propriedade | Tipo | Descrição |
|----------|------|-------------|
| `key` | `string` | Identificador único — deve corresponder a `storageSource` nas configurações de propriedade |
| `engine` | `string` | Nome do motor de armazenamento (por ex., `"firebase"`, `"gcs"`, `"s3"`) |
| `transport` | `"server" \| "direct"` | `"server"` faz proxy através do backend; `"direct"` envia a partir do navegador |
| `source` | `StorageSource` | Implementação `StorageSource` do lado do cliente (necessária para o transporte `"direct"`) |

O sistema resolve automaticamente a fonte correta por propriedade — as propriedades de coleção com `storageSource: "firebase"` usarão a fonte direta correspondente, enquanto as propriedades sem `storageSource` (ou com `transport: "server"`) farão proxy através do backend da Rebase.

## Hook useStorageSource

Para operações de arquivo programáticas fora dos formulários de coleção:

```typescript
import { useStorageSource } from "@rebasepro/app";

// Returns the default storage source
const storageSource = useStorageSource();

// Upload a file — the object is addressed by `key`
const result = await storageSource.putObject({
    file,
    key: "documents/my-file.pdf"
});

// Get a download URL
const { url } = await storageSource.getSignedUrl(result.key);
```

:::tip
`useStorageSource()` retorna a fonte de armazenamento **padrão**. Para configurações multi-backend, a resolução por propriedade é tratada automaticamente pelos bindings de campo de formulário e pelo `StorageSourcesContext`. Na maioria dos casos, você não precisa resolver as fontes manualmente.
:::

## Próximos Passos

- **[Configuração de Armazenamento do Backend](/docs/backend/storage)** — Configuração de S3, GCS e armazenamento local
- **[Propriedades](/docs/collections/properties)** — Todos os tipos de propriedade, incluindo armazenamento
