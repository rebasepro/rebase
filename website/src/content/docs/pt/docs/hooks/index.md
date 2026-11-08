---
sourceHash: e73caf2e48ec0dd6
title: Referência de Hooks
sidebar_label: Hooks
description: React hooks fornecidos pelo Rebase para acessar autenticação, dados, navegação, painéis laterais, armazenamento e estado da UI.
---

## Visão Geral

O Rebase fornece hooks do React para acessar as funcionalidades do framework a partir de qualquer componente dentro da árvore do provedor `<Rebase>`.

## `useRebaseContext`

<span class="since-badge" data-since="0.29">Desde 0.29</span>
O hook principal — acesse tudo:

```typescript
import { useRebaseContext } from "@rebasepro/app";

function MyComponent() {
    const context = useRebaseContext();

    context.data                      // Rows, as the server sends them; writes run browserCallbacks
    context.client                    // The full SDK client
    context.storageSource             // File operations
    context.authController            // Auth state
    context.navigationStateController // Navigation state
    context.sidePanelController       // Side panel control
    context.snackbarController        // Toast notifications
}
```

`context.data` é a mesma camada simples que os hooks de linha leem: `context.data.orders.find()`
é resolvido para `{ data: rows, meta }`, uma data é a sua string ISO e um belongsTo é a sua
coluna de chave estrangeira, exatamente como o `context.data` de um callback do backend e
o `client.data` os retornam. Suas operações `create`, `update` e `delete` executam o
`admin.browserCallbacks` da coleção e atualizam cada visualização da coleção,
assim como o `useRowWrites` faz. Recorra a ele onde o estado do React não se encaixar: no
`onClick` de uma ação de entidade, em um callback ou em um construtor de coleção.

## `useAuthController`

Acesse o estado e os recursos de autenticação:

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

Leia e grave as linhas de uma coleção no formato em que o servidor as envia: datas como strings ISO, um belongsTo sob sua coluna de chave estrangeira (`author_id`). É o mesmo formato retornado por `client.data` e `context.data`, portanto, o código escrito com esses hooks se lê como código escrito diretamente com o SDK.

As linhas de cada coleção vêm da fonte de dados declarada por ela (`dataSource`, consulte [Múltiplas fontes de dados](/docs/backend/multiple-sources)), e as de qualquer outra coleção vêm da fonte de dados padrão da aplicação. Com um `client`, o padrão é `client.data`, e as agregações são feitas via HTTP. Sem um cliente, utiliza-se o driver da fonte de dados padrão (um driver do Firebase, por exemplo). Onde a fonte de dados suportar subscrição, as linhas permanecem ativas em tempo real. Onde não suportar, todos os hooks de uma coleção realizam uma nova leitura após cada gravação dentro do mesmo `<Rebase>` (através de `useRowWrites`, `context.data`, um formulário de registro ou uma visualização de coleção) e após cada alteração anunciada pelo driver da fonte de dados. O mesmo se aplica às visualizações de coleção do painel administrativo. As opções são comparadas por valor, portanto, um objeto inline não dispara uma nova leitura a cada renderização. `error` é uma string de mensagem, e uma gravação que falha também rejeita a Promise.

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
| `useRowWrites()` | `{ create(collection, values, id?), update(collection, id, values), remove(collection, id), saving, error }`. Cada gravação bem-sucedida atualiza todos os hooks de linha e visualizações dessa coleção. Uma gravação executa os `admin.browserCallbacks` da coleção assim como o salvamento do formulário de registro faz: `beforeSave` (que pode alterar a linha ou lançar um erro para interromper a gravação), depois `afterSave` ou `afterSaveError`; `beforeDelete`, depois `afterDelete`. Cada um recebe as linhas exatamente como o servidor as envia. |

## `usePermissions`

Hook para avaliar papéis e permissões do usuário atual. Ele elimina a necessidade de passar manualmente o `authController` para funções de verificação de permissão.

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
|--------|------------|-----------|
| `canCreate` | `(collection, path) => boolean` | Verifica se o usuário tem permissão para criar entidades na coleção. |
| `canEdit` | `(collection, path, row) => boolean` | Verifica se o usuário tem permissão para editar a linha fornecida, como retornado por `useRows` ou `context.data`. `null` consulta a coleção sem nenhuma linha específica. |
| `canDelete` | `(collection, path, row) => boolean` | Verifica se o usuário tem permissão para excluir a linha fornecida. `null` consulta a coleção sem nenhuma linha específica. |
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
|-------|------|-----------|
| `copiedDuration` | `number` | Opcional. Tempo em milissegundos antes de redefinir `isCoppied` de volta para `false`. |
| `onSuccess` | `(text) => void` | Opcional. Callback acionado ao copiar com sucesso. |
| `onError` | `(err) => void` | Opcional. Callback acionado em caso de erro. |

### Valor de Retorno

| Propriedade | Tipo | Descrição |
|-------------|------|-----------|
| `ref` | `MutableRefObject` | Ref do React para anexar a elementos input/textarea de onde copiar. |
| `copy` | `(text?: string) => void` | Dispara a cópia do texto fornecido ou do conteúdo do elemento referenciado. |
| `cut` | `() => void` | Dispara o recorte do conteúdo do elemento referenciado. |
| `isCoppied` | `boolean` | `true` se o texto foi copiado recentemente. |
| `clipboard` | `string` | O valor atual do texto copiado. |
| `clearClipboard` | `() => void` | Limpa a área de transferência. |

## `useSidePanel`

Abra entidades programaticamente em um painel lateral:

```typescript
import { useSidePanel } from "@rebasepro/cms";

function OpenProductButton({ productId }) {
    const sidePanel = useSidePanel();

    return (
        <button onClick={() => {
            sidePanel.open({
                path: "products",
                id: productId,
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
|--------|-----------|
| `open({ path, id, collection })` | Abre uma entidade em um painel lateral |
| `close()` | Fecha o painel lateral atual |
| `replace({ path, id, collection })` | Substitui o conteúdo do painel lateral atual |

## `useSnackbarController`

Exiba notificações toast:

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
desfazer (undo) pertence — a janela na qual desfazer tem sentido é o período
em que o snackbar está na tela:

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

O snackbar fecha a si mesmo assim que a ação é clicada, impedindo que a mesma
ação de desfazer seja disparada duas vezes. Dois snackbars com a mesma mensagem
aparecem quando ambos possuem uma ação — rejeitar duas candidaturas em sequência
deixa um caminho para reverter cada uma delas.

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

Controle o tema claro/escuro:

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

Abre um diálogo lateral para selecionar linhas de uma coleção. As linhas são
entregues a você exatamente como o servidor as envia, no formato retornado por
`useRows`, e seus ids ao lado delas — as strings aceitas por `selectedIds` e
`useSidePanel().open`:

```typescript
import { useSelectionDialog } from "@rebasepro/cms";

function SelectProduct() {
    const selectionDialog = useSelectionDialog({
        path: "products",
        collection: productsCollection,
        onSingleRowSelected: (row, id) => {
            console.log("Selected:", id, row?.name);
        }
    });

    return <button onClick={selectionDialog.open}>Select Product</button>;
}
```

Com `multiselect: true`, `onMultipleRowsSelected(rows, ids)` notifica a cada
marcação e `onSelectionDone(rows, ids)` informa a seleção final uma única vez,
quando "Done" (Concluir) for pressionado — use-o quando agir sobre a seleção envolver
alguma gravação de dados. `selectedIds` especifica as linhas mostradas como selecionadas,
e exibidas primeiro, quando o diálogo se abre.

## `useSelectionController`

Uma seleção de linhas de uma coleção mantida por você: passe-a para uma visualização
como `admin.selectionController` (em um `CollectionPanel`, por meio de
`collectionOverrides`) e leia o que o usuário marca lá:

```tsx
import { CollectionPanel, useSelectionController } from "@rebasepro/cms";
import { Button } from "@rebasepro/ui";

function ShipOrders() {
    const selection = useSelectionController(ordersCollection);
    return <>
        <CollectionPanel collection={ordersCollection}
            collectionOverrides={{ selectionController: selection }}/>
        <Button disabled={!selection.hasSelection}>
            Ship {selection.selectedCount ?? "all"}
        </Button>
    </>;
}
```

`selection.selection` é `{ type: "rows", ids, rows }` para linhas marcadas, ou
`{ type: "query", query, excludedIds, count }` quando "todos os correspondentes" for selecionado;
`resolveSelection({ selection: selection.selection, data: context.data,
collection })` lê as linhas de uma seleção por consulta e fornece `{ rows, ids }` em qualquer um dos modos. `isSelected(id)`,
`toggleSelection(row)`, `setSelectedRows(rows)` e `clearSelection()` realizam alterações na seleção.

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

## `useRebaseClient`

Recupere a instância tipada do SDK subjacente (`RebaseClient`) a partir do contexto do React. Isso é útil para invocar operações diretas do SDK (como chamar endpoints customizados ou uploads manuais) dentro de seus componentes.

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

Evite a navegação ou o descarregamento da página quando os dados do formulário tiverem alterações não salvas. Ele solicita confirmação antes do recarregamento ou fechamento da aba (`beforeunload`) e, dentro do painel administrativo sob um data router do React Router (`createBrowserRouter`), também antes da navegação interna no app, via `useBlocker`. Sob qualquer outro roteador, como um `<BrowserRouter>` simples, apenas a confirmação a nível de navegador se aplica.

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
|-----------|------|-----------|
| `when` | `boolean` | Flag para ativar o bloqueio de navegação da página/roteador. |
| `onOk` | `() => void` | Callback disparado quando o usuário confirma o descarte das alterações. |

### Valor de Retorno

| Propriedade | Tipo | Descrição |
|-------------|------|-----------|
| `dialogProps` | `UnsavedChangesDialogProps` | Props do modal para passar diretamente a um componente de UI `UnsavedChangesDialog`. |
| `triggerDialog` | `() => void` | Dispara a exibição manual do diálogo programaticamente. |

## `useEffectiveRoleController`

Alterne o papel para o qual a navegação do painel administrativo foi construída, sem desconectar-se:
quais visualizações do Studio são listadas. Ele não envia nada para o servidor e não avalia nenhuma
política de segurança em nível de linha (RLS), portanto, uma visualização de dados ainda mostra o que você pode ler. Para
testar RLS, use **Simulate access** (acima do seu avatar na gaveta lateral) ou `client.simulate()` via
código; consulte [Testando acesso](/docs/frontend/authentication/#testing-access-simulate-access).

O `<Rebase>` fornece o controlador. O `useBuildEffectiveRoleController`, hook
que criava um para passar como `effectiveRoleController`, foi descontinuado em favor do
Simulate access e emite um aviso quando chamado.

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

Alterne os modos de visualização de layout administrativo dentro do painel administrativo.

```typescript
import { useAdminModeController } from "@rebasepro/app";

function ModeToggle() {
    const { mode, setMode } = useAdminModeController(); // mode is "cms" | "studio"

    return <button onClick={() => setMode("studio")}>Switch to Studio View</button>;
}
```

## `useDialogsController`

Abra telas de diálogo de forma imperativa a partir de qualquer ponto da árvore de componentes.

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

Capture ações da UI do CMS e eventos de usuário globalmente.

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
- **[SDK Tipado](/docs/sdk)** — SDK de operações de dados
