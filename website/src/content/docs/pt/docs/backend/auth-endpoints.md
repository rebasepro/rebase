---
sourceHash: 928eebeb904fa5e0
title: Endpoints de autenticação e tokens
sidebar_label: Endpoints de autenticação
description: As rotas de autenticação que o backend do Rebase monta, seus formatos de resposta, autenticação multifator, o contexto de banco de dados que uma política enxerga, JWKS e chaves de serviço.
---

As rotas que [o bloco `auth`](/docs/backend/authentication/) monta e os tokens que elas retornam.

## Endpoints de autenticação

Todos os endpoints de autenticação são montados em `/api/auth/`:

| Método | Caminho | Descrição |
|--------|---------|-----------|
| `POST` | `/api/auth/register` | Cria uma nova conta |
| `POST` | `/api/auth/login` | Faz login com e-mail/senha |
| `POST` | `/api/auth/refresh` | Atualiza o token de acesso |
| `POST` | `/api/auth/<provider>` | Login via OAuth (ex.: `/api/auth/google`, `/api/auth/linkedin`) |
| `POST` | `/api/auth/link/<provider>` | Vincula um provedor OAuth à conta autenticada. Em um convidado, isso é um registro: requer `allowRegistration`, assume o endereço do provedor quando o provedor o valida, e responde com uma sessão para a conta em que o convidado se tornou |
| `POST` | `/api/auth/logout` | Revoga o token de atualização (refresh token) |
| `POST` | `/api/auth/forgot-password` | Envia e-mail de redefinição de senha |
| `POST` | `/api/auth/reset-password` | Redefine a senha com token |
| `POST` | `/api/auth/find-user` | Resolve um e-mail para um perfil público mínimo (opt-in — `AUTH_ALLOW_USER_LOOKUP`) |
| `POST` | `/api/auth/change-password` | Altera a própria senha do chamador (autenticado). Encerra todas as outras sessões e responde com uma nova para o chamador |
| `GET` | `/api/auth/me` | O perfil do próprio chamador |
| `PATCH` | `/api/auth/me` | Atualiza o perfil do próprio chamador |
| `POST` | `/api/auth/change-email` | `{ newEmail }`: transfere a própria conta do chamador para outro endereço. Envia um link para o novo endereço e um aviso para o antigo; nada muda até que o link seja acessado. Requer `aal2` em uma conta com segundo fator. `409 EMAIL_EXISTS` ou `UNDELIVERABLE_ADDRESS`, `400 EMAIL_UNCHANGED`, `403 ANONYMOUS_USER` para um convidado — veja [Alterando um endereço de e-mail](#alterando-um-endereço-de-e-mail) |
| `POST` | `/api/auth/confirm-email-change` | `{ token }` do link. Nenhuma sessão necessária. Transfere a conta para o novo endereço, verificada; `400 INVALID_TOKEN` para um link já utilizado, substituído ou expirado, `409 EMAIL_EXISTS` se o endereço foi ocupado enquanto aguardava |
| `GET` | `/api/auth/config` | O que este backend oferece a uma tela de login — `needsSetup`, `registrationEnabled`, `passwordReset`, `emailVerification`, `magicLink`, `anonymousLogin`, `adminPasswordReset`, `enabledProviders` e `storage`, que indica se o backend fornece armazenamento de arquivos. Não autenticado e calculado a partir dos mesmos predicados que as rotas aplicam, para que o anunciado pela tela não divirja do que ela pode fazer |
| `POST` | `/api/auth/send-verification` | Envia ao chamador um link de verificação de e-mail |
| `GET` | `/api/auth/verify-email` | Consome um link de verificação (a URL naquele e-mail). Mantém o que uma sessão ativa da conta comprova e remove o que ninguém comprovou — veja [Verificação de e-mail](/docs/backend/email-verification/) |
| `POST` | `/api/auth/verify-email` | O mesmo com `{ token, password?, removeUnproven? }`: a senha mantém e realiza login; sem nenhuma comprovação, uma conta que possua uma responde com `409 PROOF_REQUIRED` |
| `POST` | `/api/auth/magic-link` | Envia por e-mail um link de acesso único (magic link). `503 EMAIL_NOT_CONFIGURED` sem SMTP |
| `POST` | `/api/auth/magic-link/verify` | Troca um token de magic link por uma sessão |
| `POST` | `/api/auth/otp` | Envia por e-mail um código de acesso de seis dígitos. Responde da mesma forma independentemente de o endereço possuir ou não uma conta |
| `POST` | `/api/auth/otp/verify` | Troca `{ email, code }` por uma sessão |
| `POST` | `/api/auth/anonymous` | Cria uma sessão anônima (opt-in — `ALLOW_ANONYMOUS`) |
| `POST` | `/api/auth/anonymous/link` | Associa credenciais reais à conta anônima já autenticada. Requer `allowAnonymous` e registro aberto: `403 ANONYMOUS_AUTH_DISABLED` se o login anônimo for desativado (incluindo convidados logados anteriormente), e `403 REGISTRATION_DISABLED` enquanto o registro estiver fechado |
| `GET` | `/api/auth/sessions` | Lista as sessões ativas do chamador, uma por login. A do próprio chamador é marcada com `isCurrentSession` |
| `DELETE` | `/api/auth/sessions` | Revoga todas as sessões, incluindo esta — logout remoto em todos os dispositivos |
| `DELETE` | `/api/auth/sessions/:id` | Revoga uma sessão: seu token de atualização e o token de acesso mantido por aquele dispositivo |
| `GET` | `/api/auth/scopes` | Todos os [escopos](/docs/backend/roles-and-scopes/) conhecidos por este backend e aqueles que o chamador possui |
| `GET` | `/api/auth/keys` | As próprias [chaves de API pessoais](/docs/backend/api-keys/#personal-keys) do chamador |
| `POST` | `/api/auth/keys` | Cria uma chave pessoal. `403 PERSONAL_KEYS_DISABLED` a menos que a tabela de usuários configure `auth.personalKeys` |
| `DELETE` | `/api/auth/keys/:id` | Revoga uma das chaves do próprio chamador |
| `GET` | `/.well-known/jwks.json` | O JWKS público — montado na raiz, não sob `basePath`, pois é onde os verificadores procuram. Montado sempre que o backend emite seus próprios tokens; um conjunto de chaves vazio até que a [assinatura assimétrica](#tokens-assimétricos-e-jwks) seja configurada |
| `POST` | `/api/auth/mfa/enroll` | Inicia o registro de TOTP (retorna o segredo e códigos de recuperação) |
| `POST` | `/api/auth/mfa/verify` | Confirma um registro com um código do autenticador |
| `GET` | `/api/auth/mfa/factors` | Lista os fatores registrados do chamador |
| `POST` | `/api/auth/mfa/challenge` | Abre um desafio para um fator verificado |
| `POST` | `/api/auth/mfa/challenge/verify` | Responde a um desafio — é isso que emite a sessão |
| `DELETE` | `/api/auth/mfa/unenroll` | Remove um fator (requer uma sessão `aal2` quando a conta tem um fator verificado) |
| `POST` | `/api/auth/mfa/recovery-codes` | Substitui os códigos de recuperação do chamador por dez novos códigos (requer uma sessão `aal2`) |

O gerenciamento administrativo de usuários e funções (roles) é uma **superfície separada**, montada em
`/api/admin/` em vez de `/api/auth/`. A leitura requer o escopo `users:read` e
a alteração requer `users:write`, com exceção da leitura restrita do seletor de usuários abaixo. Um administrador e a chave de serviço possuem ambos; assim como uma
função que os declare. Ninguém pode alterar uma conta que detenha mais permissões do que
si mesmo. Veja [Funções e escopos](/docs/backend/roles-and-scopes/).

| Método | Caminho | Descrição |
|--------|---------|-----------|
| `GET` | `/api/admin/users` | Lista usuários (paginado). `?search=` faz correspondência sem distinção entre maiúsculas e minúsculas com parte do e-mail ou nome de exibição. Também corresponde a qualquer função que o usuário possua e ao uid |
| `GET` | `/api/admin/users/pick` | A leitura do seletor de usuários: `uid`, `displayName`, `email` e `photoURL` por usuário, nada mais. Aceita `?search=`, `?limit=` (25 por padrão) e `?offset=`, ou `?ids=a,b` para os usuários nomeados por um valor armazenado. Responde a `users:read`, e também a quem tiver permissão de escrita em uma coleção com um campo [`userSelect`](/docs/collections/properties/) — para que um editor possa preenchê-lo. Uma regra escrita como SQL puro (`using` / `withCheck` que o modelo de política não consegue ler) não pode ser avaliada com antecedência, contando como recusa aqui: em tal coleção apenas detentores de `users:read` podem selecionar. Qualquer outra pessoa recebe `403 SCOPE_MISSING` |
| `POST` | `/api/admin/users` | Cria um usuário. `invite: false` sem `password` cria-o sem senha e não envia nada |
| `POST` | `/api/admin/users/import` | Importa contas de outro sistema, mantendo seus IDs. Veja [Importando contas](#importando-contas) |
| `GET` | `/api/admin/users/:uid` | Lê um usuário |
| `PUT` | `/api/admin/users/:uid` | Atualiza um usuário. `{ disabled: true }` desativa a conta sem excluí-la: todo login e atualização de token é recusado (`ACCOUNT_DISABLED`), suas sessões terminam e todos os tokens que ela possui são recusados; `false` a reativa |
| `DELETE` | `/api/admin/users/:uid` | Exclui um usuário. Suas sessões são encerradas e todos os tokens de acesso mantidos por ele são recusados a partir dessa requisição |
| `POST` | `/api/admin/users/:uid/reset-password` | Redefine a senha de um usuário sem precisar da atual. `rebase auth reset-password` a invoca e grava diretamente no banco de dados apenas quando o backend não puder ser alcançado; de qualquer forma, as sessões da conta são encerradas |
| `DELETE` | `/api/admin/users/:uid/mfa` | Remove os segundos fatores e códigos de recuperação de um usuário, e encerra suas sessões — útil para quem perdeu ambos |
| `GET` | `/api/admin/roles` | `admin` e as funções que a tabela de usuários declara, com seus respectivos escopos |
| `POST` | `/api/admin/bootstrap` | Permite que o primeiro usuário registrado assuma a função de admin enquanto nenhuma existir. Recusado em produção — veja [Inicialização do Primeiro Usuário](/docs/backend/authentication/#first-user-bootstrap) |

Todos os endpoints da API de dados requerem um cabeçalho `Authorization: Bearer <token>` válido quando `requireAuth: true` (o padrão).

### Importando contas

`POST /api/admin/users/import` cria contas que já existem em outro
sistema, sob os mesmos IDs que possuem lá, para que cada registro que aponte para uma delas
continue apontando para a mesma conta. Requer `users:write`, assim como `POST /api/admin/users`.

```json
{
  "users": [
    { "id": "5b0a3c9e-21f4-4d3b-8a6e-7c1d2e3f4a5b", "email": "ada@example.com", "displayName": "Ada",
      "createdAt": "2024-05-02T08:30:00Z", "emailVerified": true, "roles": ["editor"] }
  ],
  "dryRun": false
}
```

- **`id`** é mantido e é opcional. Um UUID é o caso comum; qualquer ID formado por
  letras, dígitos e `_ - . : |`, começando com uma letra ou dígito, de até 128
  caracteres, também é aceito (IDs do Firebase, Auth0, Clerk). `service`, `anonymous`,
  `anon` e `default` são recusados, assim como qualquer outro formato inválido: `400 INVALID_ID` para
  aquela conta. Uma tabela de usuários cuja coluna `id` seja um `uuid` aceita apenas UUIDs.
- **`email`** é obrigatório. `displayName`, `photoUrl`, `createdAt` (ISO 8601) e
  `roles` são opcionais; `emailVerified` é `false`, a menos que seja informado. Uma conta
  não verificada é confirmada pelo primeiro magic link ou link de redefinição que acessar, e não
  poderá ser acessada via provedor até lá.
- **Sem senha, sem e-mail.** Um campo `password` ou `passwordHash` causará falha naquela
  conta, e nenhum e-mail será enviado. A conta realiza login por magic link,
  código por e-mail, provedor ou redefinição de senha.
- **Nada é atualizado.** Uma conta cujo ID já exista é ignorada (`skipped`) com
  `ID_EXISTS`, e aquela cujo e-mail já exista com `EMAIL_EXISTS` (incluindo uma conta anterior
  na mesma requisição). Executar a mesma importação duas vezes é seguro.
- **Nenhuma função superior à do próprio chamador**, assim como em `POST /api/admin/users`, e
  `beforeUserCreate` é executado para cada conta e pode recusá-la.
- **No máximo 100 contas por requisição** (`400 TOO_MANY_USERS` acima disso).
  `dryRun: true` executa todas as verificações e não grava nada.

A resposta é `200` com um resultado por conta, em ordem:

```json
{
  "dryRun": false, "created": 1, "skipped": 1, "failed": 1,
  "results": [
    { "index": 0, "status": "created", "uid": "5b0a3c9e-…", "email": "ada@example.com" },
    { "index": 1, "status": "skipped", "uid": "…", "email": "bob@example.com", "code": "EMAIL_EXISTS", "message": "…" },
    { "index": 2, "status": "failed", "email": "eve@example.com", "code": "INVALID_ID", "message": "…" }
  ]
}
```

`rebase users import <file>` envia um arquivo CSV ou JSON dessa forma, 100 contas
por vez, e `client.admin.importUsers(users, { dryRun })` é a chamada pelo SDK.

### Política de senhas

Uma nova senha precisa de pelo menos 8 caracteres, com uma letra maiúscula, uma
letra minúscula e um dígito. O registro, a redefinição e a alteração recusarão senhas que
falhem com `400 WEAK_PASSWORD`, listando cada regra violada, assim como um
administrador definindo uma senha: `POST /api/admin/users`, uma criação na
tabela de usuários pela API de dados (`POST /api/data/users`, seu `/bulk`, uma
gravação via socket ou MCP), `PUT /api/admin/users/:uid` e
`POST /api/admin/users/:uid/reset-password`. Em um `/bulk`, a mensagem começa com
`Row <n>: ` (contado a partir de 0), assim como os outros erros de linha do bulk.

Para criar contas cujas senhas foram definidas por outro sistema, como em uma importação, envie
`skipPasswordPolicy: true` no corpo da criação (em cada linha de um `/bulk`). O
servidor só honra isso para um administrador ou para a chave de serviço; para qualquer
outra pessoa nada é ignorado, e a recusa informa isso. Esse valor nunca é armazenado. A importação
do painel administrativo envia isso para cada linha que contenha uma `password`. O login
nunca valida a política, de modo que senhas mais antigas continuam funcionando. Para definir suas próprias regras, passe
`auth.hooks.validatePasswordStrength` a partir de um backend [ejetado](/docs/backend/authentication/#configuration).
O primeiro admin inicializado a partir de `REBASE_ADMIN_PASSWORD` segue uma
regra diferente: pelo menos 12 caracteres, e nada mais.

### Formato de resposta

Cada endpoint que emite uma sessão responde com o mesmo envelope — `register`,
`login`, cada provedor OAuth, `magic-link/verify`, `otp/verify`, `anonymous`,
`anonymous/link` e `mfa/challenge/verify`:

```json
{
  "user": {
    "uid": "8f1c2a6e-…",
    "email": "jane@example.com",
    "displayName": "Jane Doe",
    "photoURL": null,
    "providerId": "password",
    "isAnonymous": false,
    "emailVerified": true,
    "roles": ["editor"],
    "metadata": {}
  },
  "tokens": {
    "accessToken": "eyJhbGciOi…",
    "refreshToken": "9b2e…",
    "accessTokenExpiresAt": 1700000000000
  }
}
```

Envie o token de acesso de volta no formato `Authorization: Bearer <accessToken>`.
`accessTokenExpiresAt` é expresso em milissegundos epoch.

`POST /api/auth/refresh` responde com o mesmo envelope, exceto que `user` é
omitido inteiramente quando a conta não pode ser relida; portanto, trate-o como opcional
nessa rota.

`providerId` indica como a sessão foi autenticada: `password`, `anonymous`,
`magic-link`, `otp`, `mfa` (um login concluído com um segundo fator), ou o
ID do provedor, como `google`. Ele é armazenado com a sessão no momento do login, para que
`refresh` e `GET /api/auth/me` forneçam a mesma resposta enquanto a
sessão durar. Uma sessão autenticada antes da versão 0.24 retorna `password`.

:::caution[O SDK tipado nivela este envelope — o HTTP puro não]
O JSON acima é o formato trafegado na rede, e é o que `fetch("/api/auth/login")`
retorna: o token fica em **`body.tokens.accessToken`**.

O [SDK tipado](/docs/sdk/authentication) desenvelopa `tokens` antes de entregar
a sessão, de modo que `auth.signInWithEmail()` resolve em um formato nivelado:
**`{ user, accessToken, refreshToken }`**.

Ambos os formatos são reais; eles pertencem a duas camadas diferentes. Ler o formato
do SDK diretamente de um `fetch` comum resultará em `undefined`, o que se manifesta como "login bem-sucedido,
mas não há token de acesso" — o login funcionou, o token estava apenas um nível abaixo.
:::

### Alterando um endereço de e-mail

Um usuário autenticado
transfere sua própria conta para outro endereço em duas etapas:

1. `POST /api/auth/change-email { newEmail }` registra a alteração e envia um
   link, `<frontend>/confirm-email-change?token=…`, para o novo endereço, e um
   aviso sem link para o endereço atual. O link é válido por 24 horas, e uma
   nova requisição substitui a anterior. `GET /api/auth/me` informa o endereço
   aguardando confirmação como `pendingEmail`.
2. `POST /api/auth/confirm-email-change { token }` efetiva a mudança da conta: o novo
   endereço se torna o endereço oficial, verificado. Toda identidade OAuth cujo provedor
   tenha atestado o endereço antigo é desvinculada (`removedProviders` lista-os),
   pois quem controla o endereço antigo poderia, caso contrário, continuar fazendo login
   por meio dele, e qualquer link de redefinição enviado para o endereço antigo deixa de funcionar.
   As sessões são mantidas.

O novo endereço não fica reservado enquanto o link aguarda: retê-lo permitiria que qualquer
conta impedisse um terceiro de se cadastrar com o próprio endereço. Se outra
conta assumir o endereço antes de o link ser acessado, o link responderá
`409 EMAIL_EXISTS` e nada será alterado; entre duas contas solicitando o mesmo
endereço, a primeira a acessar seu respectivo link o obtém. O hook `beforeEmailChange` pode
recusar um endereço, assim como `beforeUserCreate` faz no cadastro.

No CMS, o endereço é alterado em **Account settings → Profile**, e o
link abre a própria tela do CMS, esteja o usuário logado ou não. Outro frontend pode servir uma página
em `/confirm-email-change` que chama a rota com o token fornecido no link.

Com [`cookieAuth`](/docs/backend/authentication/#refresh-tokens-in-an-httponly-cookie) ativado (o padrão), o refresh
token trafega como um cookie `httpOnly` e `tokens.refreshToken` será uma string
vazia no corpo da resposta. O token de acesso não é afetado.

### Autenticação multifator (TOTP)

**Um segundo fator restringe o login, não apenas operações individuais.** Uma vez que uma
conta possua um fator TOTP *verificado*, nenhuma rota emitirá uma sessão para ela até que um
código seja apresentado — login com senha, todos os provedores OAuth, magic link, código
por e-mail e vínculo anônimo são recusados com `401 MFA_REQUIRED`:

```json
{
  "error": {
    "code": "MFA_REQUIRED",
    "message": "Multi-factor authentication is required to complete sign-in.",
    "details": {
      "mfaToken": "<short-lived pre-auth token>",
      "factors": [{ "id": "…", "factorType": "totp", "friendlyName": "Phone" }]
    }
  }
}
```

O `mfaToken` **não é uma sessão**: ele possui escopo específico, expira em cinco minutos
e é rejeitado por todas as rotas autenticadas. Envie-o como bearer token para
`POST /api/auth/mfa/challenge` (com um `factorId`) e, em seguida, para
`POST /api/auth/mfa/challenge/verify` (com o `challengeId` e o código de seis
dígitos, ou um código de recuperação). Essa última chamada é a que emite os tokens de acesso
e de atualização em `aal2`; esse nível é armazenado na sessão e mantido através
de `POST /api/auth/refresh`.

O registro também possui restrições. O primeiro fator de uma conta pode ser registrado a partir de
uma sessão comum, mas, uma vez que haja um verificado, `enroll`, `verify` e `unenroll`
passam a exigir uma sessão `aal2` — caso contrário, uma senha roubada poderia registrar um
fator próprio, elevar seus privilégios com ele e excluir o fator verdadeiro.

A verificação possui limites em ambos os eixos: um desafio expira após cinco tentativas
incorretas, cada conta é limitada a dez tentativas de verificação a cada 15 minutos
(contadas por usuário, portanto alternar IPs não ajuda), e um código aceito é
registrado contra o fator para que não possa ser reutilizado pelo restante de sua
janela de tolerância de ±1 passo.

Na tabela de usuários do CMS, **Reset two-step verification**
(`DELETE /api/admin/users/:uid/mfa`) e **Disable or enable account**
(`PUT /api/admin/users/:uid { disabled }`) são oferecidos a quem possuir
`users:write`, conforme as rotas; a opção nunca é exibida para a sua própria
conta, e uma conta com privilégios superiores aos seus é recusada com o motivo fornecido pelo servidor.

Defina `MFA_ENCRYPTION_KEY` (32+ caracteres aleatórios) para criptografar os segredos
TOTP armazenados. Sem isso, o servidor recorre a `JWT_SECRET` e emite um aviso. Configure isso
**antes** de qualquer usuário se registrar: os segredos armazenados não contêm identificador de chave, portanto, alterar a chave
posteriormente tornará os fatores existentes indecifráveis e seus proprietários incapazes de
concluir um desafio.

### Convidando membros da equipe por e-mail

Fluxos de convite precisam converter um endereço de e-mail em um ID de usuário, mas a tabela
`users` é protegida por RLS em relação ao cliente. Em vez de implementar manualmente uma função de
administrador no servidor, habilite a busca nativa:

```typescript no-verify
await initializeRebaseBackend({
    auth: {
        // ...
        allowUserLookup: true,   // habilita POST /api/auth/find-user
    },
});
```

Em seguida, a partir do cliente:

```typescript
const profile = await client.auth.findUserByEmail("teammate@example.com");
// → { uid, displayName, photoURL } | null   (nunca email/roles/metadata)
if (profile) {
    await client.data.team_members.create({ team_id, user_id: profile.uid });
}
```

O endpoint é **exclusivamente autenticado** e retorna apenas `uid`, `displayName`
e `photoURL` — nunca o e-mail, as funções ou os metadados do usuário consultado. Ele vem
**desativado por padrão** porque permite que qualquer usuário autenticado teste quais e-mails possuem
contas; ative-o apenas se a experiência de convite da sua aplicação exigir.

## Contexto de Banco de Dados de Row-Level Security (RLS)

O Rebase conecta a autenticação das requisições diretamente ao Row-Level Security (RLS) do PostgreSQL. Cada consulta ao banco de dados executada por meio de um driver com escopo de usuário é executada dentro de uma transação de banco de dados (`db.transaction()`) que configura parâmetros locais de transação:

*   `app.uid` — O ID único do usuário autenticado (`uid`). O padrão é `'anonymous'` para requisições não autenticadas. O nome anterior `app.user_id` ainda é gravado paralelamente, para compatibilidade com políticas compiladas antes da renomeação.
*   `app.user_roles` — Uma string separada por vírgulas listando as funções atribuídas ao usuário.
*   `app.is_anonymous` — `'true'` para uma sessão de convidado (login anônimo), `'false'` caso contrário.
*   `app.jwt` — Uma string JSON contendo as claims personalizadas do token acrescidas de `sub`, `roles` e `is_anonymous` (`{"sub": "<uid>", "roles": [...], "is_anonymous": false, …}`).

Esses parâmetros são configurados localmente durante a duração da transação utilizando a função `set_config` do Postgres:
```sql
SELECT 
    set_config('app.uid', $1, true),
    set_config('app.user_id', $1, true),
    set_config('app.user_roles', $2, true),
    set_config('app.is_anonymous', $3, true),
    set_config('app.jwt', $4, true);
```

### Funções auxiliares de políticas do PostgreSQL

Para simplificar a escrita de políticas de Row-Level Security, o Rebase cria funções auxiliares sob o schema `rebase` durante a inicialização do banco de dados:

*   **`rebase.uid()`** — Retorna o ID do usuário autenticado como `text`, ou `NULL` se não estiver definido:
    ```sql
    CREATE OR REPLACE FUNCTION rebase.uid() RETURNS text AS $$
        SELECT COALESCE(
            NULLIF(current_setting('app.uid', true), ''),
            NULLIF(current_setting('app.user_id', true), '')
        );
    $$ LANGUAGE sql STABLE;
    ```
*   **`rebase.roles()`** — Retorna a string de funções separada por vírgulas:
    ```sql
    CREATE OR REPLACE FUNCTION rebase.roles() RETURNS text AS $$
        SELECT COALESCE(NULLIF(current_setting('app.user_roles', true), ''), '');
    $$ LANGUAGE sql STABLE;
    ```
*   **`rebase.jwt()`** — Retorna o payload completo do JWT como um objeto `jsonb`:
    ```sql
    CREATE OR REPLACE FUNCTION rebase.jwt() RETURNS jsonb AS $$
        SELECT COALESCE(NULLIF(current_setting('app.jwt', true), ''), '{}')::jsonb;
    $$ LANGUAGE sql STABLE;
    ```
*   **`rebase.is_anonymous()`** — Indica se o chamador é um convidado, como `boolean` (`false` quando não definido), permitindo que uma política use `NOT rebase.is_anonymous()`.

Você pode utilizar esses utilitários diretamente em suas regras de segurança personalizadas ou migrações de banco de dados:
```sql
CREATE POLICY owner_access ON posts
    FOR ALL
    TO public
    USING (author_id = rebase.uid() OR string_to_array(rebase.roles(), ',') && ARRAY['admin']);
```

## Tokens assimétricos e JWKS

Por padrão, os tokens de acesso são assinados com `jwtSecret` (HS256). Isso funciona, mas
significa que qualquer serviço que precise *verificar* um token precisa possuir a chave que o *emite*
— assim, um gateway ou um edge worker verificando uma sessão também pode forjar tokens — e
alterar o segredo desconecta todos os usuários de uma só vez.

Configure uma chave de assinatura e o Rebase passará a assinar tokens de acesso assimetricamente,
publicando a parte pública em **`/.well-known/jwks.json`** para verificação por qualquer
parte interessada:

```typescript no-verify
auth: {
    jwtSecret: process.env.JWT_SECRET,
    signingKeys: [
        { kid: "2026-08", privateKey: process.env.JWT_PRIVATE_KEY! }
    ]
}
```

Ou a partir do ambiente, para uma única chave:

```bash
JWT_PRIVATE_KEY="$(cat jwt-key.pem)"
JWT_KEY_ID=2026-08
```

Gere uma chave com:

```bash
openssl genpkey -algorithm EC -pkeyopt ec_paramgen_curve:P-256 -out jwt-key.pem
```

Chaves RSA também funcionam e assinam com `RS256`; chaves EC P-256 assinam com `ES256`. Apenas a chave privada
é configurada — a parte pública é derivada dela, evitando inconsistências no
par de chaves. O `jwtSecret` continua sendo obrigatório em ambos os casos: ele ainda assina os
tokens de finalidade específica (links de download, MFA pendente, redefinição de senha) que apenas
este servidor lê.

### Rotacionando uma chave

Coloque a nova chave em primeiro lugar e mantenha a antiga listada. Novos tokens serão assinados pela
nova chave; tokens já em circulação continuam sendo validados pela antiga até
expirarem, para que ninguém seja desconectado.

```typescript no-verify
signingKeys: [
    { kid: "2026-09", privateKey: process.env.JWT_PRIVATE_KEY_NEW! },
    { kid: "2026-08", privateKey: process.env.JWT_PRIVATE_KEY_OLD! }
]
```

Assim que o maior tempo de vida de token de acesso tiver passado, remova a entrada antiga. Use
`activeKid` se desejar publicar uma chave antes de começar a assinar com ela.

### Verificando em outro lugar

Os tokens trazem o `kid` da chave de assinatura em seu cabeçalho, permitindo que um verificador
escolha a chave correta no JWKS e saiba quando buscar as chaves novamente após uma
rotação. Qualquer biblioteca padrão faz isso automaticamente — por exemplo, com `jose`:

```typescript no-verify
import { createRemoteJWKSet, jwtVerify } from "jose";

const jwks = createRemoteJWKSet(new URL("https://api.example.com/.well-known/jwks.json"));
const { payload } = await jwtVerify(token, jwks);
```

:::note
Sem nenhum `signingKeys` configurado, `/.well-known/jwks.json` responde com
`{"keys":[]}` e os tokens permanecem em HS256. Nada muda até que você adicione uma chave.
:::

## Autenticação com chave de serviço (Service Key)

Para comunicação servidor-a-servidor (ex.: cron jobs, serviços externos), configure uma chave de serviço estática:

```typescript
auth: {
    serviceKey: process.env.REBASE_SERVICE_KEY,
    // ...
}
```

Os clientes autenticam-se com o cabeçalho `Authorization: Bearer <service-key>`.

### Chave interna por inicialização (Per-Boot Key)

Se `REBASE_SERVICE_KEY` não for informada em sua configuração, o Rebase gera automaticamente uma **chave interna por inicialização** aleatória.

Esta chave nunca é registrada em logs e nunca sai do processo. Ela é utilizada pelo singleton do `rebase` para autenticar contra as APIs do próprio plano de controle do servidor (autenticação, armazenamento, etc.). Isso garante que tarefas administrativas (como enviar um e-mail de boas-vindas ou gerar uma URL de armazenamento) sempre funcionem imediatamente no desenvolvimento e em produção sem exigir o gerenciamento manual de chaves.

### Proteção contra Timing Attacks e requisitos de chave

Para prevenir ataques de temporização (timing attacks), o Rebase valida tanto a chave de serviço configurada pelo usuário quanto a chave interna utilizando comparação de strings em tempo constante (`safeCompare`). A chave de serviço configurada pelo usuário **deve ter pelo menos 32 caracteres**; se for configurada uma chave com menos de 32 caracteres, o Rebase lançará um erro de configuração na inicialização e falhará de forma segura (fail-closed).

## Próximos passos

- **[Autenticação](/docs/backend/authentication/)** — a configuração de onde essas rotas se originam
- **[Adaptadores de autenticação personalizados](/docs/backend/auth-adapters/)** — substituindo o provedor por trás delas
- **[Regras de Segurança (RLS)](/docs/collections/security-rules/)** — o que uma política faz com `rebase.uid()`
- **[Autenticação no SDK Tipado](/docs/sdk/authentication/)** — chamando essas rotas a partir do SDK
