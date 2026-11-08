---
sourceHash: 11a70a4f7a976bf5
title: Armazenamento e Uploads de Arquivos
sidebar_label: Armazenamento e Uploads de Arquivos
description: Adicione campos de upload de arquivos às suas coleções, gerencie arquivos programaticamente e direcione uploads para diferentes backends de armazenamento.
---

## Visão Geral

O Rebase oferece suporte integrado a upload de arquivos em formulários de coleção:

- Campos de upload de arquivos com **arrastar e soltar**
- **Pré-visualizações de imagens** em formulários e células de tabela
- **Uploads de múltiplos arquivos** via propriedades de array
- **Filtragem por tipo MIME** e limites de tamanho
- **Nomes de arquivo personalizados** via funções de callback

## Campos de Upload de Arquivo

Um campo de arquivo é uma propriedade string com um bloco `storage`, ou um array deles
para múltiplos arquivos. [Campos de upload de arquivo](/docs/collections/file-uploads/) aborda
a declaração de um: todas as opções de `storage` e quais delas o servidor impõe
em vez de apenas o uploader do painel.

## Armazenamento Multi-Backend

Quando seu backend possui múltiplos backends de armazenamento configurados (por exemplo, local + S3 + GCS), você pode rotear propriedades individuais para backends específicos usando `storageSource`:

```typescript
image: {
    type: "string",
    name: "Product Image",
    storage: {
        storageSource: "firebase",     // Routes to the "firebase" backend
        storagePath: "products/{id}",
        acceptedFiles: ["image/*"],
    }
}
```

### Fontes Diretas no Frontend

Para backends de armazenamento **diretos** (por exemplo, Firebase Storage, onde o navegador faz o upload diretamente para a nuvem), registre-os através da prop `storageSources` no `<Rebase>`:

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
|-------------|------|-----------|
| `key` | `string` | Identificador único — deve corresponder ao `storageSource` nas configurações da propriedade |
| `engine` | `string` | Nome do mecanismo de armazenamento (por exemplo, `"firebase"`, `"gcs"`, `"s3"`) |
| `transport` | `"server" \| "direct"` | `"server"` faz proxy através do backend; `"direct"` faz o upload a partir do navegador |
| `source` | `StorageSource` | Implementação client-side do `StorageSource` (obrigatório para o transporte `"direct"`) |

O sistema resolve automaticamente a fonte correta por propriedade — propriedades de coleção com `storageSource: "firebase"` usarão a fonte direta correspondente, enquanto propriedades sem `storageSource` (ou com `transport: "server"`) farão proxy através do backend do Rebase.

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
`useStorageSource()` retorna a fonte de armazenamento **padrão**. Para configurações multi-backend, a resolução por propriedade é gerenciada automaticamente pelas vinculações de campos de formulário e pelo `StorageSourcesContext`. Na maioria dos casos, você não precisa resolver as fontes manualmente.
:::

## Próximos Passos

- **[Configuração de Armazenamento no Backend](/docs/backend/storage)** — Configuração de S3, GCS e armazenamento local
- **[Propriedades](/docs/collections/properties)** — Todos os tipos de propriedade, incluindo armazenamento
