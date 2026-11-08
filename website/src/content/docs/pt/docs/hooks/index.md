---
sourceHash: 09a9548b22748eda
title: Referência de Hooks
sidebar_label: Hooks
description: Hooks React fornecidos pelo Rebase para acessar autenticação, dados, navegação, painéis laterais, armazenamento e estado da UI.
---

## Visão Geral

O Rebase fornece hooks React para acessar funcionalidades do framework a partir de qualquer componente dentro da árvore do provedor `<Rebase>`.

## `useRebaseContext`

O hook principal — acesse tudo:

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

Acesse o estado de autenticação e seus recursos:

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

## Linhas: `useRows`, `useRow`, `useRowCount`, `useAggregate`, `useRowWrites`

Leia e grave linhas de uma coleção no formato em que o servidor as envia: datas como strings ISO, um belongsTo sob sua coluna de chave estrangeira (`author_id`). É o mesmo formato retornado por `client.data` e o mesmo que `context.data` retorna em um callback de backend, de modo que o código escrito com esses hooks se assemelha ao código escrito diretamente com o SDK.

As linhas vêm da fonte de dados padrão do aplicativo. Com um `client`, isso é `client.data`, e as agregações ocorrem via HTTP. Sem ele, utiliza-se o driver da fonte de dados padrão (um driver do Firebase, por exemplo). Onde a fonte de dados oferece suporte a subscrição, as linhas permanecem em tempo real. Onde não oferece, cada hook de uma coleção realiza uma nova leitura após cada gravação nela dentro do mesmo `<Rebase>` (por meio de `useRowWrites`, um formulário de registro, uma visualização de coleção ou `useData()`) e após cada alteração anunciada pelo driver da fonte de dados. O mesmo se aplica às visualizações de coleção do painel de administração. As opções são comparadas por valor, portanto, um objeto inline não dispara uma nova leitura a cada renderização. `error` é uma string de mensagem, e uma gravação com falha também rejeita a promessa.

```typescript
import { useRowWrites, useRows } from "@rebasepro/app";
type Order = { id: number; status: string; total: number; created_at: string };
function PendingOrders() {
    const { rows, hasMore, loadMore } = useRows<Order>("orders", {
        where: { status: ["==", "pending"] }, orderBy: ["created_at", "desc"], limit: 20 });
    const { update, saving } = useRowWrites();
    return (
        <ul>
            {rows.map(order => (
                <li key={order.id} onClick={() => !saving && update<Order>("orders", order.id, { status: "shipped" })}>
                    {order.created_at}: {order.total}
                </li>
            ))}
            {hasMore && <li onClick={loadMore}>Load more</li>}
        </ul>
    );
}
```

| Hook | Retorno |
|------|---------|
| `useRows(collection, { where, orderBy, limit, offset, searchString })` | `{ rows, total, hasMore, loadMore, loading, error, refresh }`. `limit` é o tamanho da página, e `loadMore` adiciona uma página à mesma leitura, até 1000 linhas. |
| `useRow(collection, id)` | `{ row, loading, error, refresh }`. `id` pode ser `undefined`, caso em que nada é lido. |
| `useRowCount(collection, where)` | `{ count, loading, error }` |
| `useAggregate(collection, { select, groupBy, where, orderBy, limit, offset })` | `{ result, loading, error }`. Os parâmetros e o resultado são os mesmos de `client.data.<collection>.aggregate()`. Uma fonte de dados que não suporta agregação define `error` e nunca retorna um resultado vazio. |
| `useRowWrites()` | `{ create(collection, values, id?), update(collection, id, values), remove(collection, id), saving, error }`. Cada gravação bem-sucedida atualiza todos os hooks de linha e visualizações de coleção daquela coleção. Uma gravação executa os `admin.browserCallbacks` da coleção assim como o salvamento do formulário de registro faz, com os mesmos valores: `beforeSave` (que pode alterar os valores ou lançar um erro para interromper a gravação), depois `afterSave` ou `afterSaveError`; `beforeDelete`, depois `afterDelete`. |

## `useCollection`

Busca e se inscreve em uma lista de entidades em uma coleção. Estabelece automaticamente uma subscrição WebSocket em tempo real se suportado pelo driver, recorrendo a requisições REST caso contrário.

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
| `path` | `string` | Caminho absoluto da coleção (ex.: `"products"`). |
| `collection` | `AdminCollection` | O objeto de definição da coleção. |
| `itemCount` | `number` | Opcional. Quantidade de entidades a serem buscadas (limite SQL). |
| `offset` | `number` | Opcional. Quantidade de itens a serem ignorados. |
| `page` | `number` | Opcional. Número da página (iniciando em 1), alternativa ao offset. |
| `filterValues` | `FilterValues` | Opcional. Filtros de consulta. Suporta igualdade abreviada, tuplas `[op, val]` e strings de operadores do PostgREST. |
| `sortBy` | `[string, "asc" \| "desc"]` | Opcional. Tupla com o campo de ordenação e a direção. |
| `searchString` | `string` | Opcional. Consulta para busca em texto completo. |

### Valor de Retorno

| Propriedade | Tipo | Descrição |
|-------------|------|-------------|
| `data` | `Entity[]` | Array de entidades buscadas. |
| `dataLoading` | `boolean` | Verdadeiro se o carregamento inicial estiver em andamento. |
| `dataLoadingError` | `Error` | Objeto de erro caso a busca falhe. |
| `noMoreToLoad` | `boolean` | Verdadeiro se não houver mais registros além da página/limite atual. |
| `totalCount` | `number` | Opcional. A contagem total de registros correspondentes ao filtro no banco de dados. |

## `useFetch`

Busca e se inscreve em uma única entidade por ID. Renderiza instantaneamente usando dados em cache se já carregados via busca de coleção e, em seguida, atualiza em segundo plano.

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
| `entityId` | `string \| number` | O ID da entidade a ser buscada. |
| `collection` | `AdminCollection` | O objeto de definição da coleção. |
| `useCache` | `boolean` | Opcional. Se `true` e a entidade estiver no cache, pula a atualização em segundo plano. (Padrão: `false`). |

### Utilitários de Cache

O Rebase mantém um cache em memória global para evitar oscilações visuais na UI. Você pode manipular este cache diretamente:

- `populateFetchCache(path, entities)`: Pré-preenche o cache com uma lista de entidades (ex.: após uma ação em massa ou chamada de API personalizada). O cache mantém os 2.000 registros gravados ou lidos mais recentemente. Uma visualização de coleção não grava mais todas as linhas que exibe no cache: clicar em uma linha, ou em sua ação **Edit** ou **Copy**, armazena essa linha específica, garantindo que o registro ainda abra com seus valores na tela.
- `clearFetchCache()`: Limpa o cache. Recomendado chamar esta função no logout do usuário para evitar vazamento de dados.

## `usePermissions`

Hook para avaliar papéis e permissões do usuário atual. Ele abstrai a necessidade de passar manualmente o `authController` para funções de verificação de permissão.

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

### Valor de Retorno

| Método | Assinatura | Descrição |
|--------|------------|-------------|
| `canCreate` | `(collection, path) => boolean` | Verifica se o usuário tem permissão para criar entidades na coleção. |
| `canEdit` | `(collection, path, entity) => boolean` | Verifica se o usuário tem permissão para editar a entidade fornecida. |
| `canDelete` | `(collection, path, entity) => boolean` | Verifica se o usuário tem permissão para excluir a entidade fornecida. |
| `canRead` | `(collection) => boolean` | Verifica se o usuário tem permissão para ler a coleção. |

## `useClipboard`

Hook utilitário para copiar ou recortar texto para a área de transferência, com suporte automático a mecanismos de fallback em navegadores mais antigos.

> [!NOTE]
> Observe a grafia exata de `isCoppied` (com dois `p`s) no payload de retorno.

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
|-------|------|-------------|
| `copiedDuration` | `number` | Opcional. Tempo em milissegundos antes de redefinir `isCoppied` de volta para `false`. |
| `onSuccess` | `(text) => void` | Opcional. Callback disparado após uma cópia bem-sucedida. |
| `onError` | `(err) => void` | Opcional. Callback disparado em caso de erro. |

### Valor de Retorno

| Propriedade | Tipo | Descrição |
|-------------|------|-------------|
| `ref` | `MutableRefObject` | Ref do React para anexar a elementos de input/textarea dos quais copiar. |
| `copy` | `(text?: string) => void` | Dispara a cópia do texto fornecido ou do conteúdo do elemento referenciado por `ref`. |
| `cut` | `() => void` | Dispara o recorte do conteúdo do elemento referenciado por `ref`. |
| `isCoppied` | `boolean` | Verdadeiro se o texto foi copiado recentemente. |
| `clipboard` | `string` | O valor atual do texto copiado. |
| `clearClipboard` | `() => void` | Limpa a área de transferência. |

## `useSidePanel`

Abre entidades programaticamente em um painel lateral:

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
| `open({ path, entityId, collection })` | Abre uma entidade em um painel lateral |
| `close()` | Fecha o painel lateral atual |
| `replace({ path, entityId, collection })` | Substitui o conteúdo do painel lateral atual |

## `useSnackbarController`

Exibe notificações toast:

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

`open()` aceita `{ type, title?, message, autoHideDuration?, action? }`.

O slot `action` renderiza um botão ao lado da mensagem, que é onde a ação de
desfazer pertence — a janela em que desfazer tem sentido é o período em que a snackbar
permanece na tela:

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

A snackbar se fecha automaticamente assim que a ação é clicada, impedindo que a
mesma ação de desfazer seja acionada duas vezes. Duas snackbars com a mesma mensagem
aparecem simultaneamente quando cada uma tem uma ação — rejeitar duas candidaturas em
sequência mantém uma forma de desfazer cada uma delas.

## `useStorageSource`

Acesse operações de armazenamento de arquivos:

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

Controla o tema claro/escuro:

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

Abre um diálogo lateral para selecionar entidades de uma coleção. Este é o mesmo hook utilizado internamente quando uma propriedade de relação é renderizada:

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

Acesse o estado de navegação e as coleções resolvidas:

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

Gerencie seleções complexas de relações com busca integrada, debounce e paginação.

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
|-------|------|-------------|
| `path` | `string` | Caminho absoluto da coleção. |
| `collection` | `AdminCollection` | Definição da coleção de destino. |
| `fixedFilter` | `FilterValues` | Opcional. Filtros estáticos para restringir os resultados da busca. |
| `pageSize` | `number` | Opcional. Quantidade de itens por página. (Padrão: `10`). |
| `getLabelFromEntity` | `(entity) => string` | Opcional. Personaliza o texto do rótulo de exibição. |
| `getDescriptionFromEntity` | `(entity) => string` | Opcional. Personaliza o texto de descrição. |

## `useRebaseClient`

Recupera a instância tipada subjacente do SDK (`RebaseClient`) a partir do contexto do React. Isso é útil para invocar operações diretas do SDK (como chamar endpoints customizados ou uploads manuais) dentro de seus componentes.

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

Impede a navegação ou o descarregamento da página quando os dados do formulário têm alterações não salvas. Ele solicita confirmação antes de um recarregamento ou fechamento de aba (`beforeunload`) e, dentro do painel administrativo sob um roteador de dados do React Router (`createBrowserRouter`), também antes da navegação interna da aplicação, via `useBlocker`. Sob qualquer outro roteador, como um `<BrowserRouter>` simples, apenas o prompt em nível de navegador é aplicado.

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
| `when` | `boolean` | Flag para ativar o bloqueio de navegação da página/roteador. |
| `onOk` | `() => void` | Callback disparado quando o usuário confirma o descarte das alterações. |

### Valor de Retorno

| Propriedade | Tipo | Descrição |
|-------------|------|-------------|
| `dialogProps` | `UnsavedChangesDialogProps` | Props do modal para passar diretamente a um componente de UI `UnsavedChangesDialog`. |
| `triggerDialog` | `() => void` | Dispara a exibição manual do diálogo programaticamente. |

## `useEffectiveRoleController`

Altera o papel para o qual a navegação do painel de administração é construída, sem a necessidade de sair da sessão:
quais visualizações do Studio são listadas. Não envia nada para o servidor e não avalia
políticas de segurança em nível de linha (RLS), portanto, uma visualização de dados ainda mostra o que você pode ler. Para
testar RLS, use **Simulate access** (acima do seu avatar no drawer) ou `client.simulate()` via
código; consulte [Testing access](/docs/frontend/authentication/#testing-access-simulate-access).

O `<Rebase>` fornece o controlador. O `useBuildEffectiveRoleController`, hook
que construía um controlador para ser passado como `effectiveRoleController`, foi descontinuado em favor do
Simulate access e emite um aviso ao ser chamado.

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

Alterna os modos de visualização de layout administrativo dentro do painel de administração.

```typescript
import { useAdminModeController } from "@rebasepro/app";

function ModeToggle() {
    const { mode, setMode } = useAdminModeController(); // mode is "cms" | "studio"

    return <button onClick={() => setMode("studio")}>Switch to Studio View</button>;
}
```

## `useDialogsController`

Abre telas de diálogo de forma imperativa a partir de qualquer lugar na árvore de componentes.

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

Captura ações da UI do CMS e eventos de usuário globalmente.

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
- **[SDK Tipado](/docs/sdk)** — SDK para operações de dados
