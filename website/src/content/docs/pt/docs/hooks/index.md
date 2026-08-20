---
title: Referência de Hooks
sidebar_label: Hooks
description: Hooks React fornecidos pelo Rebase para acessar autenticação, dados, navegação, painéis laterais, armazenamento e estado da UI.
---

## Visão Geral

Rebase fornece hooks React para acessar a funcionalidade do framework a partir de qualquer componente dentro da árvore de provedores `<Rebase>`.

## `useRebaseContext`

O hook principal — acesse tudo:

```typescript
import { useRebaseContext } from "@rebasepro/app";

function MyComponent() {
    const context = useRebaseContext();

    context.data          // Operações de dados
    context.storageSource       // Operações de arquivo
    context.authController      // Estado de autenticação
    context.navigation          // Estado de navegação
    context.sidePanel // Controle de painel lateral
    context.snackbarController  // Notificações toast
}
```

## `useAuthController`

Acesse o estado de autenticação:

```typescript
import { useAuthController } from "@rebasepro/app";

function UserMenu() {
    const auth = useAuthController();

    auth.user            // Usuário atual (ou null)
    auth.initialLoading  // Carregando sessão inicial
    auth.signOut()       // Sair
    auth.getAuthToken()  // Obter JWT para chamadas de API
    auth.extra           // Dados adicionais do usuário (funções, etc.)
}
```

## `useSidePanel`

Abra entidades programaticamente em um painel lateral:

```typescript
import { useSidePanel } from "@rebasepro/admin";

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
            Abrir Produto
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

Mostrar notificações toast:

```typescript
import { useSnackbarController } from "@rebasepro/app";

function SaveButton() {
    const snackbar = useSnackbarController();

    const handleSave = async () => {
        try {
            await saveData();
            snackbar.open({ type: "success", message: "Salvo com sucesso!" });
        } catch (error) {
            snackbar.open({ type: "error", message: "Falha ao salvar" });
        }
    };
}
```

## `useStorageSource`

Acessar operações de armazenamento de arquivos:

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

Controlar tema claro/escuro:

```typescript
import { useModeController } from "@rebasepro/app";

function ThemeToggle() {
    const mode = useModeController();

    return (
        <button onClick={() => mode.setMode(mode.mode === "dark" ? "light" : "dark")}>
            Atual: {mode.mode} {/* "light" | "dark" */}
        </button>
    );
}
```

## `useSelectionDialog`

Abra um diálogo lateral para selecionar entidades de uma coleção. Este é o mesmo hook usado internamente quando uma propriedade de relação é renderizada:

```typescript
import { useSelectionDialog } from "@rebasepro/admin";

function SelectProduct() {
    const selectionDialog = useSelectionDialog({
        path: "products",
        collection: productsCollection,
        onSingleEntitySelected: (entity) => {
            console.log("Selected:", entity);
        }
    });

    return <button onClick={selectionDialog.open}>Selecionar Produto</button>;
}
```

## `useNavigationStateController`

Acessar estado de navegação e coleções resolvidas:

```typescript
import { useNavigationStateController } from "@rebasepro/admin";

function MyComponent() {
    const navigation = useNavigationStateController();

    navigation.collections     // Todas as coleções registradas
    navigation.views           // Vistas personalizadas
    navigation.adminViews      // Vistas em modo administrador
    navigation.getCollection(path) // Obter coleção para um caminho
}
```

## Próximos Passos

- **[Visão Geral do Frontend](/docs/frontend)** — Referência do framework React
- **[SDK do Cliente](/docs/sdk)** — SDK de operações de dados
---
