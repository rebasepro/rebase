---
sourceHash: 3e810cd447c9dd8a
title: Armazenamento e Upload de Arquivos
sidebar_label: Armazenamento e Upload de Arquivos
description: Adicione campos de upload de arquivos às suas coleções, gerencie arquivos programaticamente e direcione uploads para diferentes backends de armazenamento.
---

## Visão Geral

O Rebase oferece suporte integrado a upload de arquivos em formulários de coleção:

- Campos de upload de arquivos por **arrastar e soltar**
- **Pré-visualizações de imagens** em formulários e células de tabela
- **Upload de múltiplos arquivos** por meio de propriedades de array
- **Filtragem por tipo MIME** e limites de tamanho
- **Nomes de arquivo personalizados** por meio de funções de callback

## Campos de Upload de Arquivo

Um campo de arquivo é uma propriedade string com um bloco `storage`, ou um array delas para múltiplos arquivos. [Campos de upload de arquivos](/docs/collections/file-uploads/) aborda como declarar um: todas as opções de `storage`, e quais delas o servidor impõe em vez de apenas o uploader do painel.

## Armazenamento Multi-Backend

Quando o seu backend tiver múltiplos backends de armazenamento configurados (por exemplo, local + S3 + GCS), você poderá direcionar propriedades individuais para backends específicos usando `storageSource`:

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

### Fontes Diretas no Frontend

Para backends de armazenamento **diretos** (por exemplo, Firebase Storage, onde o navegador faz o upload diretamente para a nuvem), registre-os por meio da prop `storageSources` no `<Rebase>`:

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
| `key` | `string` | Identificador único — deve corresponder a `storageSource` nas configurações da propriedade |
| `engine` | `string` | Nome do mecanismo de armazenamento (por exemplo, `"firebase"`, `"gcs"`, `"s3"`) |
| `transport` | `"server" \| "direct"` | `"server"` faz proxy pelo backend; `"direct"` faz o upload a partir do navegador |
| `source` | `StorageSource` | Implementação do `StorageSource` do lado do cliente (obrigatório para o transporte `"direct"`) |

O sistema resolve automaticamente a fonte correta por propriedade — propriedades de coleção com `storageSource: "firebase"` usarão a fonte direta correspondente, enquanto propriedades sem `storageSource` (ou com `transport: "server"`) farão proxy por meio do backend do Rebase.

## Hook useStorageSource

Para operações programáticas de arquivos fora dos formulários de coleção:

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
`useStorageSource()` retorna a fonte de armazenamento **padrão**. Para configurações multi-backend, a resolução por propriedade é gerenciada automaticamente pelas vinculações dos campos de formulário e pelo `StorageSourcesContext`. Você não precisa resolver as fontes manualmente na maioria dos casos.
:::

## Próximos Passos

- **[Configuração de Armazenamento do Backend](/docs/backend/storage)** — Configuração de S3, GCS e armazenamento local
- **[Propriedades](/docs/collections/properties)** — Todos os tipos de propriedades, incluindo armazenamento
