---
sourceHash: 90e2137462c112d2
title: Autenticação e Login
sidebar_label: Autenticação e Login
description: Configure o controlador de autenticação, a tela de login e a simulação de papéis no seu frontend React do Rebase.
---

## Visão Geral

O Rebase fornece componentes React e hooks prontos para uso para autenticação:

- **`useRebaseAuthController`** — Gerencia o estado de autenticação, tokens e persistência de sessão
- **`LoginView`** — Formulário pré-construído de login/cadastro com suporte a OAuth
- **Simulação de papéis (roles)** — Teste diferentes papéis sem sair da conta

## Controlador de Autenticação

O hook `useRebaseAuthController` é o núcleo da autenticação no frontend. Ele gerencia o usuário atual, tokens e sessão:

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

Passe o `authController` para o controlador de navegação do Rebase para proteger todo o painel de administração com autenticação.

## Login View

O componente `LoginView` fornece um formulário completo de login e registro:

```tsx
import { LoginView } from "@rebasepro/app";

function App() {
    if (!authController.user) {
        return (
            <LoginView
                authController={authController}
                googleClientId={GOOGLE_CLIENT_ID}
            />
        );
    }
    return <MyApp />;
}
```

A tela de login gerencia:
- Login e cadastro com e-mail/senha
- Login via OAuth com Google, GitHub e LinkedIn (quando configurado)
- Fluxo de redefinição de senha
- Validação de formulários e estados de erro

## Modelo de Papéis (Roles)

Os papéis são armazenados como uma coluna de array `text[]` diretamente na tabela `rebase.users`. Você define os papéis disponíveis como um enum na definição da sua coleção de usuários:

```typescript title="config/collections/users.ts" no-verify
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

Para adicionar ou remover opções de papéis, atualize o mapeamento `enum` na sua coleção de usuários e gere o schema novamente.

## Simulação de Papéis (Modo Dev)

No modo de desenvolvedor, você pode simular diferentes papéis sem precisar fazer logout. Isso é útil para testar políticas de RLS:

```typescript
import { useBuildEffectiveRoleController } from "@rebasepro/app";

const effectiveRoleController = useBuildEffectiveRoleController();

// When active, the UI behaves as if the current user has this role
effectiveRoleController.setEffectiveRole("editor");
```

## Próximos Passos

- **[Autenticação no Backend](/docs/backend/authentication)** — JWT, provedores OAuth, configuração de SMTP
- **[Regras de Segurança (RLS)](/docs/collections/security-rules)** — Controle de acesso a nível de linha por coleção
- **[Autenticação do SDK do Cliente](/docs/sdk/authentication)** — Métodos programáticos de autenticação
