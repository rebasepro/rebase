---
sourceHash: fe474014627c7510
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

Passe o `authController` para `<Rebase authController>`. O `<RebaseShell>` (ou o `<RebaseAuthGate>` em um layout manual) o lê dali e protege todo o painel de administração com autenticação.

## Seu próprio provedor de autenticação

Na 0.24 o
getter autentica apenas as requisições HTTP, e o socket de tempo real do painel
continua anônimo.

Se o seu app autentica os usuários com um provedor próprio (Clerk, Firebase Auth,
uma sessão sua), dê ao cliente que você passa para `<Rebase client>` um getter de
token. As requisições HTTP do painel e o seu socket de tempo real enviam ambos o
que ele retorna, de modo que as visualizações ao vivo das coleções rodam como o
mesmo usuário:

```typescript
client.setAuthTokenGetter(() => clerk.session?.getToken() ?? Promise.resolve(null));
```

O `authController` ao lado dele passa então a reportar o usuário autenticado do seu
provedor (um `AuthController` de `@rebasepro/cms-types`), em vez de envolver o
`client.auth`. O backend também precisa aceitar o token: veja
[Adaptadores de autenticação personalizados](/docs/backend/auth-adapters), e
[Usando seu próprio provedor de autenticação](/docs/sdk/authentication#using-your-own-auth-provider)
para o lado do cliente por inteiro.

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

Um papel nesta lista é um nome ao qual suas [regras de segurança](/docs/collections/security-rules) podem corresponder. O que ele pode fazer além das suas linhas (gerenciar usuários, ler logs, alterar o schema) é declarado separadamente, em `auth.roles` na mesma coleção. `admin` é embutido e tem tudo. Consulte [Papéis e escopos](/docs/backend/roles-and-scopes).

## Testando o acesso: Simulate access

Para conferir o que um papel, um usuário ou uma service key pode ler, um administrador usa
**Simulate access**, a pílula acima do seu avatar no drawer do painel de administração (na
barra do app em uma tela pequena, ou quando o shell não tem drawer). Escolha um papel
(com um id de usuário opcional, que não precisa ser uma conta), um usuário ou uma
service key ativa.
Todas as views de dados, e a aba History de um registro, passam então a ler pelo servidor como
essa identidade, contra as políticas reais de row-level security: uma grade mostra
exatamente as linhas que ela pode ler,
os campos que seus papéis não podem ler são mascarados, e o banner conta as coleções
em que ela não vê nada. O servidor verifica a cada requisição que você é um
administrador.

O acesso simulado é somente leitura. Enquanto está ativo, as views não oferecem criar, editar,
excluir nem reverter o histórico, e o servidor recusa qualquer escrita que traga uma simulação com
`403 SIMULATION_READ_ONLY`, então nada é salvo como outra pessoa. Pare de simular
para fazer alterações.

O que ele não simula: o gate `requireAuth` da API de dados, que deixa passar um
chamador anônimo simulado para que você veja o que as políticas das linhas lhe dão
(uma função personalizada o vê como sem sessão, como a um chamador anônimo real);
o armazenamento, cujos arquivos são lidos como você, com uploads desativados durante a simulação; e
as atualizações em tempo real, que pausam até você parar.

A mesma coisa a partir do código, no SDK, é `client.simulate()`. Ele deriva um
client cujas requisições carregam a simulação, e apenas a sessão do próprio
administrador pode usá-lo:

```typescript
const asCustomer = client.simulate({ role: "customer", userId: "u_1" });
const { data } = await asCustomer.data.collection("tickets").find();
asCustomer.close();
```

O client derivado é tipado pelo mesmo `Database` que aquele de que veio, e
é um client próprio: faça `close()` nele quando terminar.

A troca de papel efetivo não é um testador de RLS: ela apenas muda quais views do Studio
a navegação lista, não envia nada ao servidor e não avalia nenhuma
política. `useBuildEffectiveRoleController`, que construía uma, está obsoleto e
avisa uma vez quando é chamado: `<Rebase>` constrói o próprio controlador quando nenhum é
passado, e Simulate access é o jeito de testar o que um papel pode fazer.

## Próximos Passos

- **[Autenticação no Backend](/docs/backend/authentication)** — JWT, provedores OAuth, configuração de SMTP
- **[Regras de Segurança (RLS)](/docs/collections/security-rules)** — Controle de acesso a nível de linha por coleção
- **[Autenticação do SDK tipado](/docs/sdk/authentication)** — Métodos programáticos de autenticação
