---
sourceHash: 13b88a3ab6a85263
title: Autenticação e Login
sidebar_label: Autenticação e Login
description: Configure o controlador de autenticação, a visualização de login e a simulação de papéis no seu frontend React Rebase.
---

## Visão Geral

O Rebase fornece componentes e hooks React prontos para uso para autenticação:

- **`useRebaseAuthController`** — Gerencia o estado de autenticação, tokens e persistência de sessão
- **`LoginView`** — Formulário pré-construído de login/cadastro com suporte a OAuth
- **Simulação de papéis (roles)** — Teste diferentes papéis sem sair da conta

## Auth Controller

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

Passe o `authController` para `<Rebase authController>`. O `<RebaseShell>` (ou `<RebaseAuthGate>` em um layout manual) o lê a partir dali e restringe todo o painel de administração atrás de autenticação.

## Seu Próprio Provedor de Autenticação

Na versão 0.24, o getter autentica apenas requisições HTTP, e o socket em tempo real do painel permanece anônimo.

Se o seu aplicativo autentica usuários com seu próprio provedor (Clerk, Firebase Auth, uma sessão própria), forneça ao cliente passado para `<Rebase client>` um getter de token. Tanto as requisições HTTP do painel quanto seu socket em tempo real enviam o que ele retorna, para que as visualizações de coleções em tempo real sejam executadas como o mesmo usuário:

```typescript
client.setAuthTokenGetter(() => clerk.session?.getToken() ?? Promise.resolve(null));
```

O `authController` ao lado dele então reporta o usuário autenticado do seu provedor (um `AuthController` de `@rebasepro/cms-types`) em vez de encapsular `client.auth`. O backend também precisa aceitar o token: consulte [Adaptadores de autenticação personalizados](/docs/backend/auth-adapters) e [Seu Próprio Provedor de Autenticação](/docs/sdk/your-own-auth-provider/) para ver o lado do cliente na íntegra.

## Visualização de Login

O componente `LoginView` fornece um formulário completo de login e cadastro:

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

A visualização de login lida com:
- Login e cadastro por e-mail/senha
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

Para adicionar ou remover opções de papéis, atualize o mapa de `enum` na sua coleção de usuários e regenere o schema.

Um papel nesta lista é um nome com o qual suas [regras de segurança](/docs/collections/security-rules) podem corresponder. O que ele pode fazer além de suas linhas (gerenciar usuários, ler logs, alterar o schema) é declarado separadamente, sob `auth.roles` na mesma coleção. O `admin` é integrado e detém todas as permissões. Consulte [Papéis e escopos](/docs/backend/roles-and-scopes).

## Testando o acesso: Simular acesso

Para verificar o que um papel, um usuário ou uma chave de serviço pode ler, um administrador usa **Simulate access** (Simular acesso), o botão em formato de pílula acima do seu avatar na barra lateral (drawer) do painel de administração (na barra do aplicativo em telas menores, ou quando o shell não tiver barra lateral). Escolha um papel (com um ID de usuário opcional, que não precisa ser uma conta real), um usuário ou uma chave de serviço ativa.
Cada visualização de dados e a aba Histórico de um registro passam a ser lidas através do servidor como essa identidade, contra as políticas reais de segurança em nível de linha (RLS): uma grade mostra exatamente as linhas que ela pode ler, campos que seus papéis não podem ler são mascarados, e o banner contabiliza as coleções nas quais nada é visível. O servidor verifica a cada requisição se você é um administrador.

O acesso simulado é somente leitura. Enquanto estiver ativado, as visualizações não oferecem opções de criação, edição, exclusão ou reversão de histórico, e o servidor recusa qualquer gravação que carregue uma simulação com `403 SIMULATION_READ_ONLY`, garantindo que nada seja salvo como se fosse outra pessoa. Interrompa a simulação para fazer alterações.

O que ele não simula: a barreira `requireAuth` da API de dados, que permite a passagem de um chamador anônimo simulado para que você veja o que as políticas das linhas concedem a ele (uma função customizada o enxerga como sem sessão, exatamente como um chamador anônimo real); o storage, cujos arquivos são lidos como você, com uploads desativados durante a simulação; e atualizações em tempo real, que são pausadas até que você pare a simulação.

A mesma operação via código, no SDK, é feita com `client.simulate()`. Ele deriva um cliente cujas requisições carregam a simulação, e apenas a sessão do próprio administrador pode usá-lo:

```typescript
const asCustomer = client.simulate({ role: "customer", userId: "u_1" });
const { data } = await asCustomer.data.collection("tickets").find();
asCustomer.close();
```

O cliente derivado é tipado pelo mesmo `Database` de onde se originou e atua como um cliente próprio: chame `close()` quando terminar.

A alternância de papel efetivo (effective-role) não é um testador de RLS: ela apenas altera quais visualizações do Studio são listadas na navegação, não envia nada ao servidor e não avalia nenhuma política. `useBuildEffectiveRoleController`, que construía um seletor desse tipo, está obsoleto e emite um aviso ao ser chamado: o `<Rebase>` constrói seu próprio controlador quando nenhum é fornecido, e o recurso Simular acesso é a forma recomendada de testar o que um papel pode fazer.

## Próximos Passos

- **[Autenticação no Backend](/docs/backend/authentication)** — JWT, provedores OAuth, configuração de SMTP
- **[Regras de Segurança (RLS)](/docs/collections/security-rules)** — Controle de acesso em nível de linha por coleção
- **[Autenticação no SDK Tipado](/docs/sdk/authentication)** — Métodos programáticos de autenticação
