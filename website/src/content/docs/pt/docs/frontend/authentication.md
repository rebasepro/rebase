---
sourceHash: 9c7b1e0ee0076030
title: Autenticação & Login
sidebar_label: Autenticação & Login
description: Configure o controlador de autenticação, a tela de login e a simulação de papéis no seu frontend React do Rebase.
---

## Visão Geral

O Rebase fornece componentes e hooks React prontos para uso para autenticação:

- **`useRebaseAuthController`** — Gerencia o estado de autenticação, tokens e persistência de sessão
- **`LoginView`** — Formulário pré-construído de login/cadastro com suporte a OAuth
- **Simulação de papéis** — Teste diferentes papéis (roles) sem sair da conta

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

Passe o `authController` para `<Rebase authController>`. O `<RebaseShell>` (ou `<RebaseAuthGate>` em um layout manual) o lê a partir dali e restringe todo o painel de administração através da autenticação.

## Seu Próprio Provedor de Autenticação

Se o seu aplicativo autenticar usuários com seu próprio provedor (Clerk, Firebase Auth, uma sessão própria), forneça ao cliente passado para `<Rebase client>` uma função para obtenção de token (token getter). Tanto as requisições HTTP do painel quanto seu socket em tempo real enviam o que ela retorna, fazendo com que as visualizações em tempo real sejam executadas como o mesmo usuário:

```typescript
client.setAuthTokenGetter(() => clerk.session?.getToken() ?? Promise.resolve(null));
```

O `authController` ao lado dele então reporta o usuário conectado do seu provedor (um `AuthController` de `@rebasepro/cms-types`) em vez de encapsular o `client.auth`. O backend também precisa aceitar o token: consulte [Adaptadores de autenticação personalizados](/docs/backend/auth-adapters) e [Seu Próprio Provedor de Autenticação](/docs/sdk/your-own-auth-provider/) para ver a implementação completa do lado do cliente.

## Login View

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

A tela de login gerencia:
- Login e cadastro com e-mail/senha
- Login OAuth com Google, GitHub e LinkedIn (quando configurado)
- Fluxo de redefinição de senha
- Validação de formulários e estados de erro

## Modelo de Papéis (Roles)

<span class="since-badge" data-since="0.31">Desde 0.31</span>

Os papéis são armazenados como uma coluna de array `text[]` na tabela de usuários. Você define os papéis que um usuário pode ter como um conjunto fechado nessa coluna, na tabela declarada com [`defineAuthTable`](/docs/schema/auth-table/):

```typescript title="backend/schema/users.ts"
roles: col.text({ enum: ["admin", "editor", "viewer"] }).array(),
```

Para adicionar ou remover um papel, altere essa lista. Os rótulos que o painel exibe para cada valor pertencem ao frontend: `enumLabels` no campo em `frontend/src/cms/users.tsx` (consulte [Personalizando uma tabela](/docs/frontend/customize-table/)).

Um papel nessa lista é um nome com o qual suas [regras de segurança](/docs/collections/security-rules) podem corresponder. O que ele pode fazer além de suas linhas (gerenciar usuários, ler logs, alterar o schema) é declarado separadamente, em `auth.roles` na mesma tabela. O papel `admin` é integrado e tem acesso total. Consulte [Papéis e escopos](/docs/backend/roles-and-scopes).

## Testando o acesso: Simular acesso

Para verificar o que um papel, um usuário ou uma chave de serviço pode ler, um administrador usa **Simular acesso** (Simulate access), o botão em formato de pílula acima do seu avatar no menu lateral (drawer) do painel de administração (na barra do aplicativo em telas menores, ou quando o shell não possui menu lateral). Escolha um papel (com um ID de usuário opcional, que não precisa ser uma conta real), um usuário ou uma chave de serviço ativa.
Cada visualização de dados e a aba Histórico de um registro leem através do servidor como essa identidade, contra as políticas reais de segurança a nível de linha (RLS): uma grade exibe exatamente as linhas que ela pode ler, campos que seus papéis não podem ler são mascarados e o banner contabiliza as tabelas nas quais ela não vê nada. O servidor verifica a cada requisição se você é um administrador.

O acesso simulado é somente leitura. Enquanto estiver ativo, as visualizações não oferecem criação, edição, exclusão ou reversão de histórico, e o servidor recusa qualquer gravação que carregue uma simulação com `403 SIMULATION_READ_ONLY`, garantindo que nada seja salvo como se fosse outra pessoa. Interrompa a simulação para fazer alterações.

O que ele não simula: o controle `requireAuth` da API de dados, que permite a passagem de uma chamada anônima simulada para que você veja o que as políticas das linhas concedem a ela (uma função customizada a enxerga como sem sessão, exatamente como um chamador anônimo real); o armazenamento (storage), cujos arquivos são lidos como você, com uploads desativados durante a simulação; e atualizações em tempo real, que ficam pausadas até você encerrar a simulação.

O mesmo comportamento via código, no SDK, é obtido com `client.simulate()`. Ele deriva um cliente cujas requisições carregam a simulação, e apenas a própria sessão de um administrador pode usá-lo:

```typescript
const asCustomer = client.simulate({ role: "customer", userId: "u_1" });
const { data } = await asCustomer.data.table("tickets").find();
asCustomer.close();
```

O cliente derivado é tipado pelo mesmo `Database` daquele de onde se originou e é um cliente próprio: execute `close()` nele quando terminar.

A alternância de papel efetivo (effective-role switch) não é um testador de RLS: ela apenas altera quais visualizações do Studio aparecem nas listas de navegação, não envia nada ao servidor e não avalia nenhuma política. O `useBuildEffectiveRoleController`, que criava um, está obsoleto e emite um aviso ao ser chamado: o `<Rebase>` cria seu próprio controlador quando nenhum é passado, e a opção Simular acesso é o meio correto para testar o que um papel pode fazer.

## Próximos Passos

- **[Autenticação no Backend](/docs/backend/authentication)** — JWT, provedores OAuth, configuração de SMTP
- **[Segurança a nível de linha (RLS)](/docs/collections/security-rules)** — Controle de acesso a nível de linha por tabela
- **[Autenticação no SDK Tipado](/docs/sdk/authentication)** — Métodos programáticos de autenticação
