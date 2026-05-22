---
title: Autenticação
sidebar_label: Autenticação
description: Configure autenticação JWT, provedores OAuth (Google, LinkedIn), gerenciamento de usuários e controle de acesso baseado em função.
---

## Visão Geral

Rebase inclui um sistema de autenticação completo:

- **Tokens JWT** — Fluxo de token de acesso e atualização
- **Plugins OAuth** — Arquitetura plugável para Google, LinkedIn e outros
- **Gerenciamento de usuários** — Cadastro, login, redefinição de senha
- **Acesso baseado em função** — Atribua funções a usuários, verifique permissões em coleções
- **Auto-inicialização** — O primeiro usuário obtém automaticamente a função de administrador

## Configuração do Backend

```typescript
import { createGoogleProvider, createLinkedinProvider } from "@rebasepro/server-core";

await initializeRebaseBackend({
    // ...
    auth: {
        jwtSecret: process.env.JWT_SECRET!,  // Required
        accessExpiresIn: "1h",               // Access token lifetime
        refreshExpiresIn: "30d",             // Refresh token lifetime
        requireAuth: true,                   // Require auth for data API
        allowRegistration: false,            // Allow new signups
        google: process.env.GOOGLE_CLIENT_ID ? {
            clientId: process.env.GOOGLE_CLIENT_ID,
            clientSecret: process.env.GOOGLE_CLIENT_SECRET
        } : undefined,
        linkedin: process.env.LINKEDIN_CLIENT_ID ? {
            clientId: process.env.LINKEDIN_CLIENT_ID,
            clientSecret: process.env.LINKEDIN_CLIENT_SECRET
        } : undefined,
        email: {
            smtp: {
                host: "smtp.gmail.com",
                port: 587,
                secure: false,
                user: "noreply@example.com",
                pass: "app-password",
                from: "Rebase <noreply@example.com>"
            }
        }
    }
});
```

As tabelas de autenticação (`rebase.users`, `rebase.roles`, `rebase.user_roles`, `rebase.refresh_tokens`) são **criadas automaticamente** na primeira inicialização.

### Adaptadores de Autenticação Personalizados

O Rebase permite a substituição completa do sistema de autenticação padrão por meio da interface `AuthAdapter`. Passe um adaptador personalizado para a propriedade `auth` para ignorar completamente o mecanismo integrado de JWT e tabela de usuários (por exemplo, para integrar com Firebase Auth, Auth0 ou um provedor externo de SSO corporativo).

As tabelas de autenticação (`rebase.users`, `rebase.roles`, `rebase.user_roles`, `rebase.refresh_tokens`) são **criadas automaticamente** na primeira inicialização.

## Endpoints de Autenticação

| Método | Caminho | Descrição |
|--------|---------|-------------|
| `POST` | `/api/auth/register` | Criar uma nova conta |
| `POST` | `/api/auth/login` | Login com e-mail/senha |
| `POST` | `/api/auth/refresh` | Atualizar o token de acesso |
| `POST` | `/api/auth/<provider-id>` | Endpoint dinâmico de login para qualquer provedor OAuth configurado (por exemplo, `/api/auth/google`, `/api/auth/linkedin`) |
| `POST` | `/api/auth/logout` | Revogar token de atualização |
| `POST` | `/api/auth/forgot-password` | Enviar e-mail de redefinição de senha |
| `POST` | `/api/auth/reset-password` | Redefinir senha com token |

## Configuração do Frontend

### Controlador de Autenticação

```typescript
import { useRebaseAuthController } from "@rebasepro/auth";
import { createRebaseClient } from "@rebasepro/client";

const client = createRebaseClient({ baseUrl: API_URL, websocketUrl: WS_URL });

const authController = useRebaseAuthController({
    client,
    googleClientId: GOOGLE_CLIENT_ID  // Optional
});

// Propriedades disponíveis:
authController.user          // Objeto do usuário atual (ou nulo)
authController.initialLoading // Verdadeiro enquanto verifica a sessão armazenada
authController.signOut()     // Sair
authController.getAuthToken() // Obter JWT atual para chamadas de API
```

### Visualização de Login

```tsx
import { RebaseLoginView } from "@rebasepro/auth";

if (!authController.user) {
    return (
        <RebaseLoginView
            authController={authController}
            googleEnabled={!!GOOGLE_CLIENT_ID}
            googleClientId={GOOGLE_CLIENT_ID}
        />
    );
}
```

## Gerenciamento de Usuários e Funções

### Serviços de Backend

Após a inicialização, a instância do backend fornece `userService` e `roleService`:

```typescript
const { userService, roleService } = instance;

// Listar todos os usuários
const users = await userService.listUsers();

// Atribuir uma função
await roleService.assignRole(userId, roleId);
```

### Componentes de Frontend

Rebase fornece visualizações integradas para gerenciar usuários e funções:

```tsx
import { UsersView, RolesView } from "@rebasepro/core";
import { useBackendUserManagement } from "@rebasepro/auth";

const userManagement = useBackendUserManagement({
    client: rebaseClient,
    currentUser: authController.user
});

// Nas suas rotas:
<Route path="/users" element={<UsersView userManagement={userManagement} />} />
<Route path="/roles" element={<RolesView userManagement={userManagement} />} />
```

![Interface de gerenciamento de usuários](/img/user_management.png)

## Simulação de Função (Modo Dev)

No modo de desenvolvedor, você pode simular diferentes funções sem sair da sua conta:

```typescript
import { useBuildEffectiveRoleController } from "@rebasepro/core";

const effectiveRoleController = useBuildEffectiveRoleController();

// Quando ativo, a UI se comporta como se o usuário atual tivesse esta função
effectiveRoleController.setEffectiveRole("editor");
```

## Inicialização do Primeiro Usuário

Quando não há usuários no banco de dados, a primeira pessoa a se registrar torna-se automaticamente um administrador. Depois disso, o registro é controlado pela configuração `allowRegistration`.

Isso garante que você sempre possa inicializar uma nova implantação sem precisar preencher o banco de dados manualmente.

## Próximos Passos

- **[Armazenamento](/docs/storage)** — Configuração de armazenamento de arquivos
- **[Coleções](/docs/collections)** — Permissões por coleção
---
