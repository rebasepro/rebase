---
sourceHash: 2ed2b6947b459eef
title: Referência de Hooks
sidebar_label: Hooks
description: Hooks React fornecidos pelo Rebase para acessar autenticação, dados, navegação, painéis laterais, armazenamento e estado da UI.
---

## Visão Geral

O Rebase fornece hooks React para acessar a funcionalidade do framework a partir de qualquer componente dentro da árvore do provider `<Rebase>`.

## `useRebaseContext`

O hook mestre — acesso a tudo:

```typescript
import { useRebaseContext } from "@rebasepro/app";

function MyComponent() {
    const context = useRebaseContext();

    context.data                      // Data operations (flat rows)
    context.client                    // The full SDK client
    context.storageSource             // File operations
    context.authController            // Auth state
    context.navigationStateController // Navigation state
    context.sidePanelController       // Side panel control
    context.snackbarController        // Toast notifications
}
```

## `useAuthController`

Acessar o estado e as capacidades de autenticação:

```typescript
import { useAuthController } from "@rebasepro/app";

function UserMenu() {
    const auth = useAuthController();

    auth.user            // Current user (or null)
    auth.authLoading     // True when auth operation is in progress
    auth.initialLoading  // Loading initial session on app startup
    auth.signOut()       // Log out (returns Promise<void>)
    auth.getAuthToken()  // Get JWT for API calls (returns Promise<string>)
    auth.extra           // Additional user data (roles, etc.)
    auth.capabilities    // Capabilities advertised by auth provider (e.g. registration, reset)
}
```

## `useCollection`

Carrega e assina uma lista de entidades de uma coleção. Estabelece automaticamente uma assinatura WebSocket em tempo real se o driver a suportar, recorrendo a requisições REST caso contrário.

```typescript
import { useCollection } from "@rebasepro/app";
import type { User } from "@rebasepro/types";
import { productsCollection } from "../config/collections";

function ProductList() {
    // The row shape drives `filterValues`, `sortBy` and `entity.values` — without it
    // TypeScript infers M from whichever key it sees first.
    type Product = { name: string; price: number; active: boolean; createdAt: string };

    const { data, dataLoading, dataLoadingError, noMoreToLoad } = useCollection<Product, User>({
        path: "products",
        collection: productsCollection,
        itemCount: 20,
        filterValues: {
            active: ["==", true],
            price: [">=", 100]
        },
        sortBy: ["createdAt", "desc"],
        searchString: "laptop"
    });

    if (dataLoading) return <p>Loading products...</p>;
    if (dataLoadingError) return <p>Error: {dataLoadingError.message}</p>;

    return (
        <ul>
            {data.map(product => (
                <li key={product.id}>{product.values.name} (${product.values.price})</li>
            ))}
        </ul>
    );
}
```

### Parâmetros

| Parâmetro | Tipo | Descrição |
|-----------|------|-------------|
| `path` | `string` | Caminho absoluto da coleção (por ex., `"products"`). |
| `collection` | `CollectionConfig` | O objeto de definição da coleção. |
| `itemCount` | `number` | Opcional. Número de entidades a carregar (limite SQL). |
| `offset` | `number` | Opcional. Número de itens a pular. |
| `page` | `number` | Opcional. Número da página (começando em 1), alternativa ao `offset`. |
| `filterValues` | `FilterValues` | Opcional. Filtros de consulta. Suporta igualdade abreviada, tuplas `[op, val]` e strings de operador do PostgREST. |
| `sortBy` | `[string, "asc" \| "desc"]` | Opcional. Tupla com o campo de ordenação e a direção. |
| `searchString` | `string` | Opcional. Consulta para a busca de texto completo. |

### Valor de retorno

| Propriedade | Tipo | Descrição |
|----------|------|-------------|
| `data` | `Entity[]` | Array das entidades carregadas. |
| `dataLoading` | `boolean` | True se o carregamento inicial estiver em andamento. |
| `dataLoadingError` | `Error` | Objeto de erro se a requisição falhar. |
| `noMoreToLoad` | `boolean` | True se não houver mais registros além da página ou do limite atuais. |
| `totalCount` | `number` | Opcional. A contagem total de registros no banco que correspondem ao filtro. |

## `useFetch`

Carrega e assina uma única entidade por ID. Renderiza instantaneamente a partir do cache se ela já tiver sido carregada por uma requisição de coleção, e depois atualiza em segundo plano.

```typescript
import { useFetch } from "@rebasepro/app";
import { productsCollection } from "../config/collections";

function ProductDetail({ productId }) {
    const { entity, dataLoading, dataLoadingError } = useFetch({
        path: "products",
        entityId: productId,
        collection: productsCollection
    });

    if (dataLoading) return <p>Loading product...</p>;
    if (dataLoadingError) return <p>Error: {dataLoadingError.message}</p>;
    if (!entity) return <p>Product not found</p>;

    return (
        <div>
            <h1>{entity.values.name}</h1>
            <p>{entity.values.description}</p>
        </div>
    );
}
```

### Parâmetros

| Parâmetro | Tipo | Descrição |
|-----------|------|-------------|
| `path` | `string` | Caminho absoluto da coleção. |
| `entityId` | `string \| number` | O ID da entidade a carregar. |
| `collection` | `CollectionConfig` | O objeto de definição da coleção. |
| `useCache` | `boolean` | Opcional. Se `true` e a entidade estiver em cache, pula a atualização em segundo plano. (Padrão: `false`). |

### Utilitários de cache

O Rebase mantém um cache global em memória para evitar piscadas na UI. Você pode manipular esse cache diretamente:

- `populateFetchCache(path, entities)`: Pré-popula o cache com uma lista de entidades (por ex., após uma ação em massa ou uma chamada a uma API própria).
- `clearFetchCache()`: Limpa o cache. Recomenda-se chamá-lo no logout do usuário para evitar vazamento de dados.

## `usePermissions`

Hook para avaliar papéis e permissões do usuário atual. Ele dispensa você de passar manualmente o `authController` às funções de verificação de permissões.

```typescript
import { usePermissions } from "@rebasepro/app";
import { productsCollection } from "../config/collections";

function CreateProductButton() {
    const { canCreate } = usePermissions();

    const allowedToCreate = canCreate(productsCollection, "products");

    return (
        <button disabled={!allowedToCreate}>
            Create Product
        </button>
    );
}
```

### Valor de retorno

| Método | Assinatura | Descrição |
|--------|-----------|-------------|
| `canCreate` | `(collection, path) => boolean` | Verifica se o usuário pode criar entidades na coleção. |
| `canEdit` | `(collection, path, entity) => boolean` | Verifica se o usuário pode editar a entidade informada. |
| `canDelete` | `(collection, path, entity) => boolean` | Verifica se o usuário pode excluir a entidade informada. |
| `canRead` | `(collection) => boolean` | Verifica se o usuário pode ler a coleção. |

## `useClipboard`

Hook utilitário para copiar ou recortar texto para a área de transferência, com suporte automático a mecanismos de fallback em navegadores antigos.

> [!NOTE]
> Repare na grafia exata de `isCoppied` (com dois `p`) no valor retornado.

```typescript
import { useClipboard } from "@rebasepro/app";

function CopyButton({ text }) {
    const { copy, isCoppied } = useClipboard({ copiedDuration: 2000 });

    return (
        <button onClick={() => copy(text)}>
            {isCoppied ? "Copied!" : "Copy Text"}
        </button>
    );
}
```

### Parâmetros

| Opção | Tipo | Descrição |
|--------|------|-------------|
| `copiedDuration` | `number` | Opcional. Tempo em milissegundos antes de retornar `isCoppied` a `false`. |
| `onSuccess` | `(text) => void` | Opcional. Callback disparado quando a cópia é bem-sucedida. |
| `onError` | `(err) => void` | Opcional. Callback disparado em caso de erro. |

### Valor de retorno

| Propriedade | Tipo | Descrição |
|----------|------|-------------|
| `ref` | `MutableRefObject` | Ref do React para anexar a elementos input/textarea dos quais copiar. |
| `copy` | `(text?: string) => void` | Copia o texto informado, ou o conteúdo do elemento do ref. |
| `cut` | `() => void` | Recorta o conteúdo do elemento do ref. |
| `isCoppied` | `boolean` | True se um texto foi copiado recentemente. |
| `clipboard` | `string` | O valor de texto copiado atualmente. |
| `clearClipboard` | `() => void` | Limpa a área de transferência. |

## `useSidePanel`

Abrir entidades programaticamente em um painel lateral:

```typescript
import { useSidePanel } from "@rebasepro/cms";

function OpenProductButton({ productId }) {
    const sidePanel = useSidePanel();

    return (
        <button onClick={() => {
            sidePanel.open({
                path: "products",
                entityId: productId,
                collection: productsCollection
            });
        }}>
            Open Product
        </button>
    );
}
```

Métodos:

| Método | Descrição |
|--------|-------------|
| `open({ path, entityId, collection })` | Abrir uma entidade em um painel lateral |
| `close()` | Fechar o painel lateral atual |
| `replace({ path, entityId, collection })` | Substituir o conteúdo do painel lateral atual |

## `useSnackbarController`

Exibir notificações toast:

```typescript
import { useSnackbarController } from "@rebasepro/app";

function SaveButton() {
    const snackbar = useSnackbarController();

    const handleSave = async () => {
        try {
            await saveData();
            snackbar.open({ type: "success", message: "Saved successfully!" });
        } catch (error) {
            snackbar.open({ type: "error", message: "Save failed" });
        }
    };
}
```

`open()` recebe `{ type, title?, message, autoHideDuration?, action? }`.

O slot `action` renderiza um botão ao lado da mensagem, que é onde o desfazer
pertence — a janela em que desfazer significa alguma coisa é a janela em que a
snackbar está na tela:

```typescript
const rejectApplication = async (application: Application) => {
    const previous = application.status;
    await setStatus(application.id, "rejected");

    snackbar.open({
        type: "success",
        message: `Rejected ${application.name}`,
        action: {
            label: "Undo",
            onClick: () => setStatus(application.id, previous)
        }
    });
};
```

A snackbar se fecha sozinha assim que a ação é clicada, então o mesmo desfazer
não pode disparar duas vezes. Duas snackbars com a mesma mensagem aparecem ambas
quando cada uma tem uma ação — rejeitar duas candidaturas seguidas deixa você com
um caminho de volta para cada uma.

## `useStorageSource`

Acessar as operações de armazenamento de arquivos:

```typescript
import { useStorageSource } from "@rebasepro/app";

function FileUploader() {
    const storage = useStorageSource();

    const upload = async (file: File) => {
        const result = await storage.putObject({
            file,
            key: `documents/${file.name}`
        });
        const { url } = await storage.getSignedUrl(result.key);
        return url;
    };
}
```

## `useModeController`

Controlar o tema claro/escuro:

```typescript
import { useModeController } from "@rebasepro/app";

function ThemeToggle() {
    const mode = useModeController();

    return (
        <button onClick={() => mode.setMode(mode.mode === "dark" ? "light" : "dark")}>
            Current: {mode.mode} {/* "light" | "dark" */}
        </button>
    );
}
```

## `useSelectionDialog`

Abrir um diálogo lateral para selecionar entidades de uma coleção. Este é o mesmo hook usado internamente quando uma propriedade de relação é renderizada:

```typescript
import { useSelectionDialog } from "@rebasepro/cms";

function SelectProduct() {
    const selectionDialog = useSelectionDialog({
        path: "products",
        collection: productsCollection,
        onSingleEntitySelected: (entity) => {
            console.log("Selected:", entity);
        }
    });

    return <button onClick={selectionDialog.open}>Select Product</button>;
}
```

## `useNavigationStateController`

Acessar o estado de navegação e as coleções resolvidas:

```typescript
import { useNavigationStateController } from "@rebasepro/cms";

function MyComponent() {
    const navigation = useNavigationStateController();

    navigation.views              // Custom views
    navigation.adminViews         // Admin-mode views
    navigation.topLevelNavigation // Resolved top-level entries
}
```

## `useRelationSelector`

Gerenciar seleções de relações complexas, com busca, debouncing e paginação integrados.

```typescript
import { useRelationSelector } from "@rebasepro/app";
import { categoriesCollection } from "../config/collections";

function CategorySelector({ onSelect }) {
    const { items, isLoading, search, loadMore, hasMore } = useRelationSelector({
        path: "categories",
        collection: categoriesCollection,
        pageSize: 10
    });

    return (
        <div>
            <input type="text" onChange={(e) => search(e.target.value)} placeholder="Search..." />
            <ul>
                {items.map(item => (
                    <li key={item.id} onClick={() => onSelect(item.relation)}>
                        {item.label}
                    </li>
                ))}
            </ul>
            {hasMore && <button onClick={loadMore} disabled={isLoading}>Load More</button>}
        </div>
    );
}
```

### Parâmetros

| Opção | Tipo | Descrição |
|--------|------|-------------|
| `path` | `string` | Caminho absoluto da coleção. |
| `collection` | `CollectionConfig` | Definição da coleção de destino. |
| `fixedFilter` | `FilterValues` | Opcional. Filtros estáticos para restringir os resultados da busca. |
| `pageSize` | `number` | Opcional. Número de itens por página. (Padrão: `10`). |
| `getLabelFromEntity` | `(entity) => string` | Opcional. Personaliza o texto do rótulo exibido. |
| `getDescriptionFromEntity` | `(entity) => string` | Opcional. Personaliza o texto da descrição. |

## `useRebaseClient`

Recupera do contexto do React a instância do SDK cliente subjacente (`RebaseClient`). Útil para invocar operações diretas do SDK (como chamar endpoints próprios ou fazer uploads manuais) dentro dos seus componentes.

```typescript
import { useRebaseClient } from "@rebasepro/app";

function CustomAction() {
    const client = useRebaseClient();

    const handleAction = async () => {
        const result = await client.functions.invoke("send-invoice", { invoiceId: "123" });
        console.log(result);
    };

    return <button onClick={handleAction}>Process Invoice</button>;
}
```

## `useUnsavedChangesDialog`

Impede a navegação ou o descarregamento da página quando um formulário tem alterações não salvas. Intercepta automaticamente a navegação interna do React Router via `useBlocker`, bem como os recarregamentos no nível do navegador via `beforeunload`.

```typescript
import { useUnsavedChangesDialog } from "@rebasepro/app";
import { useState } from "react";

function EditForm() {
    const [isDirty, setIsDirty] = useState(false);

    const { dialogProps, triggerDialog } = useUnsavedChangesDialog(
        isDirty,
        () => console.log("Navigation allowed (discarded or saved changes)")
    );

    // dialogProps contains { open, handleOk, handleCancel, body }
}
```

### Parâmetros

| Parâmetro | Tipo | Descrição |
|-----------|------|-------------|
| `when` | `boolean` | Flag para ativar o bloqueio da navegação de página/roteador. |
| `onOk` | `() => void` | Callback disparado quando o usuário confirma descartar as alterações. |

### Valor de retorno

| Propriedade | Tipo | Descrição |
|----------|------|-------------|
| `dialogProps` | `UnsavedChangesDialogProps` | Props do modal, para passar diretamente a um componente de UI `UnsavedChangesDialog`. |
| `triggerDialog` | `() => void` | Exibe o diálogo de forma programática. |

## `useEffectiveRoleController`

Trocar de papel em tempo de execução para pré-visualizar permissões e testar políticas de Row-Level Security (RLS) localmente sem sair da sessão.

```typescript
import { useEffectiveRoleController } from "@rebasepro/app";

function RoleSwitcher() {
    const { effectiveRole, setEffectiveRole } = useEffectiveRoleController();

    return (
        <select value={effectiveRole || ""} onChange={(e) => setEffectiveRole(e.target.value || null)}>
            <option value="">Default (No Simulation)</option>
            <option value="admin">Admin</option>
            <option value="editor">Editor</option>
            <option value="user">Standard User</option>
        </select>
    );
}
```

## `useAdminModeController`

Alterna os modos de visualização do layout dentro do painel de administração.

```typescript
import { useAdminModeController } from "@rebasepro/app";

function ModeToggle() {
    const { mode, setMode } = useAdminModeController(); // mode is "cms" | "studio"

    return <button onClick={() => setMode("studio")}>Switch to Studio View</button>;
}
```

## `useDialogsController`

Abrir telas de diálogo de forma imperativa a partir de qualquer ponto da árvore de componentes.

```typescript
import { useDialogsController } from "@rebasepro/app";
import { MyCustomDialog } from "./MyCustomDialog";

function OpenModalButton() {
    const dialogs = useDialogsController();

    return (
        <button onClick={() => dialogs.open({
            key: "my-custom-modal",
            Component: MyCustomDialog,
            props: { title: "Custom Title" }
        })}>
            Open Custom Dialog
        </button>
    );
}
```

## `useAnalyticsController`

Capturar globalmente as ações da UI do CMS e os eventos de usuário.

```typescript
import { useAnalyticsController } from "@rebasepro/app";
import { useEffect } from "react";

function AnalyticsLogger() {
    const analytics = useAnalyticsController();

    useEffect(() => {
        analytics.onAnalyticsEvent = (event, data) => {
            console.log(`CMS Event: ${event}`, data);
        };
    }, [analytics]);
}
```

## Próximos Passos

- **[Visão Geral do Frontend](/docs/frontend)** — Referência do framework React
- **[SDK do cliente](/docs/sdk)** — SDK de operações de dados
