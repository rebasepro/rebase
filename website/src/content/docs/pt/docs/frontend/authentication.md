---
title: Autenticação e Login
sidebar_label: Autenticação e Login
description: Configure o controlador de autenticação, a visão de login e a simulação de papéis no seu frontend React da Rebase.
---

## Visão Geral

A Rebase fornece componentes e hooks React prontos para uso para autenticação:

- **`useRebaseAuthController`** — Gerencia o estado de autenticação, os tokens e a persistência da sessão
- **`LoginView`** — Formulário de login/cadastro pré-construído com suporte a OAuth
- **Simulação de papéis** — Teste diferentes papéis sem sair da conta

## Controlador de Autenticação

O hook `useRebaseAuthController` é o núcleo da autenticação do frontend. Ele gerencia o usuário atual, os tokens e a sessão:

```typescript
import { useRebaseAuthController } from "@rebasepro/app";
import { createRebaseClient } from "@rebasepro/client";

const client = createRebaseClient({ baseUrl: API_URL, websocketUrl: WS_URL });

const authController = useRebaseAuthController({
    client,
    googleClientId: GOOGLE_CLIENT_ID  // Optional — enables Google OAuth
});

// Available properties:
authController.user           // Current user object (or null)
authController.initialLoading // True while checking stored session
authController.signOut()      // Log out
authController.getAuthToken() // Get current JWT for API calls
```

Passe o `authController` para o controlador de navegação da Rebase para proteger todo o painel de administração por trás da autenticação.

## Visão de Login

O componente `LoginView` fornece um formulário completo de login e cadastro:

```tsx
import { LoginView } from "@rebasepro/app";

if (!authController.user) {
    return (
        <LoginView
            authController={authController}
            googleClientId={GOOGLE_CLIENT_ID}
        />
    );
}
```

A visão de login cuida de:
- Login e cadastro com e-mail/senha
- Login com Google, GitHub e LinkedIn (quando configurado)
- Fluxo de redefinição de senha
- Validação de formulário e estados de erro

## Modelo de Papéis

Os papéis são armazenados como uma coluna de array `text[]` diretamente na tabela `rebase.users`. Você define os papéis disponíveis como um enum na definição da sua coleção de usuários:

```typescript title="config/collections/users.ts"
roles: {
    name: "Roles",
    type: "array",
    columnType: "text[]",
    of: {
        name: "Role",
        type: "string",
        enum: {
            admin: "Admin",
            editor: "Editor",
            viewer: "Viewer"
        }
    },
    admin: {
        readOnly: false
    }
}
```

Para adicionar ou remover opções de papel, atualize o mapa `enum` na sua coleção de usuários e regenere o esquema.

## Simulação de Papéis (Modo Desenvolvimento)

No modo desenvolvedor, você pode simular diferentes papéis sem sair da conta. Isso é útil para testar as políticas RLS:

```typescript
import { useBuildEffectiveRoleController } from "@rebasepro/app";

const effectiveRoleController = useBuildEffectiveRoleController();

// When active, the UI behaves as if the current user has this role
effectiveRoleController.setEffectiveRole("editor");
```

## Próximos Passos

- **[Autenticação no Backend](/docs/backend/authentication)** — JWT, provedores OAuth, configuração SMTP
- **[Regras de Segurança (RLS)](/docs/collections/security-rules)** — Controle de acesso em nível de linha por coleção
- **[Autenticação do SDK Cliente](/docs/sdk/authentication)** — Métodos de autenticação programáticos
