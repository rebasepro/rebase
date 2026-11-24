---
sourceHash: 6d4a5f8b72b38f97
title: Endpoints de autenticação e tokens
sidebar_label: Endpoints de autenticação
description: As rotas de autenticação montadas pelo backend do Rebase, seus formatos de resposta, autenticação multifator, o contexto de banco de dados visto por uma política, JWKS e chaves de serviço.
---

As rotas que [o bloco `auth`](/docs/backend/authentication/) monta e os tokens que elas retornam.

## Endpoints de autenticação

Todos os endpoints de autenticação são montados em `/api/auth/`:

| Método | Caminho | Descrição |
|--------|---------|-----------|
| `POST` | `/api/auth/register` | Criar uma nova conta |
| `POST` | `/api/auth/login` | Login com e-mail/senha |
| `POST` | `/api/auth/refresh` | Atualizar o token de acesso |
| `POST` | `/api/auth/<provider>` | Login via OAuth (ex.: `/api/auth/google`, `/api/auth/linkedin`) |
| `POST` | `/api/auth/link/<provider>` | Vincular um provedor OAuth à conta autenticada. Para um convidado, isso é um registro: requer `allowRegistration`, assume o endereço do provedor quando o provedor o valida e responde com uma sessão para a conta na qual o convidado se tornou |
| `POST` | `/api/auth/logout` | Revogar o token de atualização |
| `POST` | `/api/auth/forgot-password` | Enviar e-mail de redefinição de senha |
| `POST` | `/api/auth/reset-password` | Redefinir senha com token |
| `POST` | `/api/auth/find-user` | Resolver um e-mail para um perfil público mínimo (opcional — `AUTH_ALLOW_USER_LOOKUP`) |
| `POST` | `/api/auth/change-password` | Alterar a própria senha de quem chama (autenticado). Encerra todas as outras sessões e responde com uma nova sessão para o solicitante |
| `GET` | `/api/auth/me` | O próprio perfil do solicitante |
| `PATCH` | `/api/auth/me` | Atualizar o próprio perfil do solicitante |
| `POST` | `/api/auth/change-email` | `{ newEmail }`: transfere a própria conta do solicitante para outro endereço. Envia um link por e-mail para o novo endereço e um aviso para o antigo; nada muda até que o link seja acessado. Requer `aal2` em uma conta com um segundo fator. `409 EMAIL_EXISTS` ou `UNDELIVERABLE_ADDRESS`, `400 EMAIL_UNCHANGED`, `403 ANONYMOUS_USER` para um convidado — veja [Alterando um endereço de e-mail](#alterando-um-endereço-de-e-mail) |
| `POST` | `/api/auth/confirm-email-change` | `{ token }` do link. Nenhuma sessão necessária. Transfere a conta para o novo endereço, verificado; `400 INVALID_TOKEN` para um link já utilizado, substituído ou expirado, `409 EMAIL_EXISTS` quando o endereço foi ocupado enquanto aguardava |
| `GET` | `/api/auth/config` | O que este backend oferece para uma tela de login — `needsSetup`, `registrationEnabled`, `passwordReset`, `emailVerification`, `magicLink`, `anonymousLogin`, `adminPasswordReset`, `enabledProviders` e `storage`, que indica se o backend oferece armazenamento de arquivos. Não autenticado e calculado a partir dos mesmos predicados que as rotas impõem, para que o que a tela anuncia não divirja do que ela pode fazer |
| `POST` | `/api/auth/send-verification` | Enviar um link de verificação de e-mail para o solicitante |
| `GET` | `/api/auth/verify-email` | Consumir um link de verificação (o URL naquele e-mail). Mantém o que uma sessão ativa da conta comprova e remove o que ninguém comprovou — veja [Verificação de e-mail](/docs/backend/email-verification/) |
| `POST` | `/api/auth/verify-email` | O mesmo com `{ token, password?, removeUnproven? }`: a senha o mantém e faz login; sem nenhuma comprovação, uma conta que a possui responde `409 PROOF_REQUIRED` |
| `POST` | `/api/auth/magic-link` | Enviar um link de login de uso único por e-mail. `503 EMAIL_NOT_CONFIGURED` sem SMTP |
| `POST` | `/api/auth/magic-link/verify` | Trocar um token de magic link por uma sessão |
| `POST` | `/api/auth/otp` | Enviar um código de login de seis dígitos por e-mail. Responde o mesmo quer o endereço possua ou não uma conta |
| `POST` | `/api/auth/otp/verify` | Trocar `{ email, code }` por uma sessão |
| `POST` | `/api/auth/anonymous` | Criar uma sessão anônima (opcional — `ALLOW_ANONYMOUS`) |
| `POST` | `/api/auth/anonymous/link` | Anexar credenciais reais à conta anônima já conectada. Requer tanto `allowAnonymous` quanto registro aberto: `403 ANONYMOUS_AUTH_DISABLED` quando o login anônimo está desativado, incluindo convidados conectados anteriormente, e `403 REGISTRATION_DISABLED` enquanto o registro estiver fechado |
| `GET` | `/api/auth/sessions` | Listar as sessões ativas do solicitante, uma por login. A sessão do próprio solicitante é marcada como `isCurrentSession` |
| `DELETE` | `/api/auth/sessions` | Revogar todas as sessões, incluindo esta — logout remoto em todos os dispositivos |
| `DELETE` | `/api/auth/sessions/:id` | Revogar uma sessão: seu token de atualização e o token de acesso retido por esse dispositivo |
| `GET` | `/api/auth/scopes` | Todos os [escopos](/docs/backend/roles-and-scopes/) que este backend conhece e aqueles que o solicitante possui |
| `GET` | `/api/auth/keys` | As próprias [chaves de API pessoais](/docs/backend/api-keys/#personal-keys) do solicitante |
| `POST` | `/api/auth/keys` | Criar uma chave pessoal. `403 PERSONAL_KEYS_DISABLED` a menos que a tabela de usuários configure `auth.personalKeys` |
| `DELETE` | `/api/auth/keys/:id` | Revogar uma das próprias chaves do solicitante |
| `GET` | `/.well-known/jwks.json` | O JWKS público — montado na raiz, não sob `basePath`, porque é onde um verificador procura. Montado sempre que o backend emite seus próprios tokens; um conjunto de chaves vazio até que a [assinatura assimétrica](#tokens-assimétricos-e-jwks) seja configurada |
| `POST` | `/api/auth/mfa/enroll` | Iniciar o registro de TOTP (retorna o segredo e os códigos de recuperação) |
| `POST` | `/api/auth/mfa/verify` | Confirmar um registro com um código do aplicativo autenticador |
| `GET` | `/api/auth/mfa/factors` | Listar os fatores registrados do solicitante |
| `POST` | `/api/auth/mfa/challenge` | Abrir um desafio contra um fator verificado |
| `POST` | `/api/auth/mfa/challenge/verify` | Responder a um desafio — é isso que emite a sessão |
| `DELETE` | `/api/auth/mfa/unenroll` | Remover um fator (requer uma sessão `aal2` quando a conta possuir um fator verificado) |
| `POST` | `/api/auth/mfa/recovery-codes` | Substituir os códigos de recuperação do solicitante por dez novos (requer uma sessão `aal2`) |

O gerenciamento administrativo de usuários e funções é uma **superfície separada**, montada em
`/api/admin/` em vez de `/api/auth/`. A leitura precisa do escopo `users:read` e
a alteração precisa de `users:write`, exceto pela leitura restrita do seletor de usuários abaixo. Um administrador e a chave de serviço possuem ambos; o mesmo vale para uma
função que os declare. Ninguém pode alterar uma conta que possua mais privilégios do que
ele próprio. Veja [Funções e escopos](/docs/backend/roles-and-scopes/).

| Método | Caminho | Descrição |
|--------|---------|-----------|
| `GET` | `/api/admin/users` | Listar usuários (paginado). `?search=` faz correspondência sem distinção entre maiúsculas e minúsculas de parte do e-mail ou do nome de exibição. Também corresponde a qualquer função que o usuário possua e ao uid |
| `GET` | `/api/admin/users/pick` | A leitura do seletor de usuários: `uid`, `displayName`, `email` e `photoURL` por usuário, nada mais. Aceita `?search=`, `?limit=` (25 por padrão) e `?offset=`, ou `?ids=a,b` para os usuários nomeados por um valor armazenado. Responde a `users:read` e também a qualquer pessoa que possa gravar em uma coleção com um campo [`userSelect`](/docs/collections/properties/) — para que um editor possa preenchê-lo. Uma regra escrita como SQL puro (`using` / `withCheck` que o modelo de política não consegue ler) não pode ser avaliada com antecedência, portanto conta como recusa aqui: em tal coleção, apenas os detentores de `users:read` podem selecionar. Qualquer outra pessoa recebe `403 SCOPE_MISSING` |
| `POST` | `/api/admin/users` | Criar um usuário. `invite: false` sem `password` o cria sem senha e não envia nada |
| `POST` | `/api/admin/users/import` | Importar contas de outro sistema, mantendo seus IDs. Veja [Importando contas](#importando-contas) |
| `GET` | `/api/admin/users/:uid` | Ler um usuário |
| `PUT` | `/api/admin/users/:uid` | Atualizar um usuário. `{ disabled: true }` desativa a conta sem excluí-la: todo login e atualização são recusados (`ACCOUNT_DISABLED`), suas sessões são encerradas e todos os tokens que ela possui são recusados; `false` a reativa |
| `DELETE` | `/api/admin/users/:uid` | Excluir um usuário. Suas sessões são encerradas e todos os tokens de acesso que ele possui são recusados a partir dessa requisição |
| `POST` | `/api/admin/users/:uid/reset-password` | Redefinir a senha de um usuário sem a senha atual. O comando `rebase auth reset-password` o chama e grava diretamente no banco de dados apenas quando o backend não puder ser alcançado; de qualquer forma, as sessões da conta são encerradas |
| `DELETE` | `/api/admin/users/:uid/mfa` | Remover os segundos fatores e códigos de recuperação de um usuário e encerrar suas sessões — para alguém que perdeu ambos |
| `GET` | `/api/admin/roles` | `admin` e as funções que a tabela de usuários declara, com seus respectivos escopos |
| `POST` | `/api/admin/bootstrap` | Permitir que o usuário registrado mais antigo reivindique a função de administrador enquanto nenhuma existir. Recusado em produção — veja [Inicialização do primeiro usuário](/docs/backend/authentication/#first-user-bootstrap) |

Todos os endpoints da API de dados exigem um cabeçalho `Authorization: Bearer <token>` válido quando `requireAuth: true` (o padrão).

### Importando contas

`POST /api/admin/users/import` cria contas que já existem em outro
sistema, sob os IDs que elas têm lá, para que cada linha que mencione uma delas
ainda faça referência à mesma conta. Ele requer `users:write`, assim como `POST /api/admin/users`.

```json
{
  "users": [
    { "id": "5b0a3c9e-21f4-4d3b-8a6e-7c1d2e3f4a5b", "email": "ada@example.com", "displayName": "Ada",
      "createdAt": "2024-05-02T08:30:00Z", "emailVerified": true, "roles": ["editor"] }
  ],
  "dryRun": false
}
```

Com hashes de senha:

```json
{
  "passwordHashAlgorithm": "bcrypt",
  "users": [
    { "id": "5b0a3c9e-21f4-4d3b-8a6e-7c1d2e3f4a5b", "email": "ada@example.com", "emailVerified": true,
      "passwordHash": "$2a$10$…" }
  ]
}
```

- **`id`** é mantido e é opcional. Um UUID é o caso comum; qualquer ID formado por
  letras, dígitos e `_ - . : |`, começando com uma letra ou dígito, de até 128
  caracteres, também é aceito (IDs do Firebase, Auth0, Clerk). `service`, `anonymous`,
  `anon` e `default` são recusados, assim como qualquer outra coisa: `400 INVALID_ID` para
  essa conta. Uma tabela de usuários cuja coluna `id` seja um `uuid` aceita apenas UUIDs.
- **`email`** é obrigatório. `displayName`, `photoUrl`, `createdAt` (ISO 8601) e
  `roles` são opcionais; `emailVerified` é `false`, a menos que seja fornecido. Uma conta não
  verificada é confirmada pelo primeiro magic link ou link de redefinição que acessar e não poderá
  receber login por meio de um provedor até então.
- **Sem envio de e-mail e sem senha, a menos que você traga o hash.** Nada é enviado por e-mail.
  Um campo `password` faz com que essa conta falhe. Uma conta sem `passwordHash`
  faz login via magic link, código por e-mail, um provedor ou redefinição de senha.
- **`passwordHash`** é o hash que o outro sistema armazenou, aceito apenas quando a
  requisição especifica seu formato em `passwordHashAlgorithm`. Atualmente, esse formato é
  `"bcrypt"` (`$2a$`, `$2b$` ou `$2y$`): o que o Supabase mantém em
  `auth.users.encrypted_password`, e o que Auth0, Clerk e a maioria das aplicações Rails,
  Laravel e Django-bcrypt armazenam. A conta então faz login com a
  senha que já possuía, e seu primeiro login substitui o hash pelo
  scrypt nativo do Rebase, sem encerrar outras sessões. Um hash sem `passwordHashAlgorithm`,
  ou um que não esteja nesse formato, falha essa conta (`INVALID_INPUT`,
  `INVALID_PASSWORD_HASH`); o hash nunca é retornado. Um projeto com seus
  próprios hooks `hashPassword` ou `verifyPassword` mantém o hash conforme importado, e
  seu `verifyPassword` decide o que aceita.
- **Nada é atualizado.** Uma conta cujo ID já foi utilizado é ignorada (`skipped`) com
  `ID_EXISTS`, e uma cujo e-mail já foi utilizado com `EMAIL_EXISTS` (incluindo uma conta anterior
  na mesma requisição). Executar a mesma importação duas vezes é seguro.
- **Nenhuma função acima da do próprio solicitante**, assim como em `POST /api/admin/users`, e
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
por vez, e `client.admin.importUsers(users, { dryRun })` é a chamada do SDK.

### Política de senhas

Uma nova senha precisa ter pelo menos 8 caracteres, com uma letra maiúscula, uma
letra minúscula e um dígito. O registro, a redefinição e a alteração recusam uma senha que
falhe com `400 WEAK_PASSWORD`, listando cada regra violada, assim como um
administrador ao definir uma senha: `POST /api/admin/users`, uma criação na
tabela de usuários por meio da API de dados (`POST /api/data/users`, seu `/bulk`, uma
gravação via socket ou MCP), `PUT /api/admin/users/:uid` e
`POST /api/admin/users/:uid/reset-password`. Em um `/bulk`, a mensagem começa com
`Row <n>: ` (contada a partir de 0), assim como os outros erros de linha da operação em lote.

Para criar contas cujas senhas foram definidas por outro sistema, como em uma importação, envie
`skipPasswordPolicy: true` no corpo da criação (em cada linha de um `/bulk`). O
servidor o respeita apenas para um administrador ou para a chave de serviço; para qualquer
outra pessoa ele não dispensa nada, e a recusa informa isso. Isso nunca é armazenado. A importação
do painel de administração o envia para cada linha que contenha um campo `password`. O login
nunca verifica a política, portanto uma senha mais antiga continua funcionando. Para definir suas próprias regras, passe
`auth.hooks.validatePasswordStrength` a partir de um backend [ejetado](/docs/backend/authentication/#configuration).
O primeiro administrador inicializado a partir de `REBASE_ADMIN_PASSWORD` segue uma
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

Envie o token de acesso de volta como `Authorization: Bearer <accessToken>`.
`accessTokenExpiresAt` está em milissegundos da época Unix.

`POST /api/auth/refresh` responde com o mesmo envelope, exceto que `user` é
omitido inteiramente quando a conta não puder ser lida novamente, portanto trate-o como opcional
nesse caso.

`providerId` informa como a sessão foi iniciada: `password`, `anonymous`,
`magic-link`, `otp`, `mfa` (um login concluído com um segundo fator) ou o
ID do provedor, como `google`. Ele é armazenado com a sessão no momento do login, para que
`refresh` e `GET /api/auth/me` forneçam a mesma resposta enquanto a
sessão durar. Uma sessão conectada antes da versão 0.24 exibe `password`.

:::caution[O SDK tipado nivela este envelope — o HTTP puro não]
O JSON acima é o formato transmitido na rede e é o que `fetch("/api/auth/login")`
retorna: o token reside em **`body.tokens.accessToken`**.

O [SDK tipado](/docs/sdk/authentication) desempacota `tokens` antes de retornar a
sessão, de modo que `auth.signInWithEmail()` é resolvido para uma estrutura nivelada
**`{ user, accessToken, refreshToken }`**.

Ambos os formatos são reais; eles pertencem a duas camadas diferentes. Ler o
formato do SDK a partir de um `fetch` puro resulta em `undefined`, o que aparece como "login
bem-sucedido, mas não há token de acesso" — o login ocorreu bem, o token estava apenas um nível abaixo.
:::

### Alterando um endereço de e-mail

Um usuário autenticado
transfere sua própria conta para outro endereço em duas etapas:

1. `POST /api/auth/change-email { newEmail }` registra a alteração e envia um
   link por e-mail, `<frontend>/confirm-email-change?token=…`, para o novo endereço, e um
   aviso sem link para o endereço atual. O link dura 24 horas, e uma
   nova requisição substitui a anterior. `GET /api/auth/me` relata o endereço aguardando
   como `pendingEmail`.
2. `POST /api/auth/confirm-email-change { token }` transfere a conta: o novo
   endereço torna-se seu endereço, verificado. Cada identidade OAuth cujo provedor
   atestou o endereço antigo é desvinculada (`removedProviders` lista seus nomes),
   porque quem quer que controle o endereço antigo poderia, de outra forma, continuar fazendo login
   por meio dele, e qualquer link de redefinição enviado para o endereço antigo deixa de funcionar.
   As sessões são mantidas.

O novo endereço não é reservado enquanto o link aguarda: reservá-lo permitiria que qualquer
conta impedisse um desconhecido de se cadastrar com seu próprio endereço. Se outra
conta tiver assumido o endereço até o momento em que o link for acessado, o link responde
`409 EMAIL_EXISTS` e nada é transferido; entre duas contas que solicitarem o mesmo
endereço, a primeira a acessar seu respectivo link fica com ele. O hook `beforeEmailChange` pode
recusar um endereço, assim como `beforeUserCreate` faz no cadastro.

No CMS, o endereço é alterado em **Account settings → Profile**, e o
link abre a própria tela do CMS, estando conectado ou não. Outro frontend pode disponibilizar uma página
em `/confirm-email-change` que chama a rota com o token do link.

Com [`cookieAuth`](/docs/backend/authentication/#refresh-tokens-in-an-httponly-cookie) ativado (o padrão), o token de
atualização trafega como um cookie `httpOnly` e `tokens.refreshToken` é uma string vazia
no corpo. O token de acesso não é afetado.

### Autenticação multifator (TOTP)

**Um segundo fator controla o login, não apenas operações individuais.** Assim que uma
conta tem um fator TOTP *verificado*, nenhuma rota emite uma sessão para ela até que um
código seja apresentado — login por senha, todos os provedores OAuth, magic link,
código por e-mail e vínculo anônimo, todos recusam com `401 MFA_REQUIRED`:

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

`mfaToken` **não é uma sessão**: ele tem escopo de finalidade específica, expira em cinco minutos
e é rejeitado por todas as rotas autenticadas. Envie-o como o token bearer para
`POST /api/auth/mfa/challenge` (com um `factorId`) e, em seguida, para
`POST /api/auth/mfa/challenge/verify` (com o `challengeId` e o código de seis dígitos,
ou um código de recuperação). Essa última chamada é o que emite os tokens de acesso e atualização,
no nível `aal2`; o nível é armazenado na sessão e mantido no
`POST /api/auth/refresh`.

O registro também é controlado. O primeiro fator em uma conta pode ser registrado a partir de uma
sessão comum, mas, uma vez que um tenha sido verificado, `enroll`, `verify` e `unenroll`
exigem uma sessão `aal2` — caso contrário, uma senha roubada poderia registrar um
fator próprio, elevar os privilégios com ele e excluir o fator real.

A verificação é limitada em ambos os eixos: um desafio expira após cinco tentativas incorretas,
cada conta é limitada a dez tentativas de verificação a cada 15 minutos
(contadas por usuário, portanto alternar IPs não ajuda) e um código aceito é
registrado contra o fator para que não possa ser reutilizado pelo restante de sua
janela de tolerância de ±1 passo.

Na tabela de usuários do CMS, **Reset two-step verification**
(`DELETE /api/admin/users/:uid/mfa`) e **Disable or enable account**
(`PUT /api/admin/users/:uid { disabled }`) são oferecidos a quem possuir
`users:write`, assim como as rotas; a opção nunca é oferecida para a sua própria
conta, e uma conta que tenha privilégios superiores aos seus é recusada com a justificativa do servidor.

Defina `MFA_ENCRYPTION_KEY` (32+ caracteres aleatórios) para criptografar os segredos TOTP
armazenados. Sem isso, o servidor recorre a `JWT_SECRET` e emite um aviso. Defina-o
**antes** que qualquer pessoa se registre: os segredos armazenados não possuem identificador de chave (key id), portanto alterar a chave
posteriormente deixará os fatores existentes indecifráveis e seus proprietários incapazes de
concluir um desafio.

### Convidando membros da equipe por e-mail

Fluxos de convite precisam transformar um endereço de e-mail em um ID de usuário, mas a
tabela `users` é protegida por RLS contra o cliente. Em vez de criar manualmente uma função
de servidor de administração, habilite a busca nativa:

```typescript no-verify
await initializeRebaseBackend({
    auth: {
        // ...
        allowUserLookup: true,   // enables POST /api/auth/find-user
    },
});
```

Em seguida, a partir do cliente:

```typescript
const profile = await client.auth.findUserByEmail("teammate@example.com");
// → { uid, displayName, photoURL } | null   (never email/roles/metadata)
if (profile) {
    await client.data.team_members.create({ team_id, user_id: profile.uid });
}
```

O endpoint é **apenas para usuários autenticados** e retorna apenas `uid`, `displayName`
e `photoURL` — nunca o e-mail, as funções ou os metadados do usuário pesquisado. Ele
fica **desativado por padrão** porque permite que qualquer usuário conectado sonde quais e-mails possuem
contas; ative-o apenas quando a experiência de convite da sua aplicação exigir.

## Contexto de banco de dados para Row-Level Security (RLS)

O Rebase conecta a autenticação de requisições diretamente ao Row-Level Security (RLS) do PostgreSQL. Cada consulta ao banco de dados executada por meio de um driver com escopo de usuário é executada dentro de uma transação de banco de dados (`db.transaction()`) que define parâmetros de configuração locais da transação:

*   `app.uid` — O ID exclusivo do usuário autenticado (`uid`). O padrão é `'anonymous'` para requisições não autenticadas. O `app.user_id` anterior à renomeação ainda é gravado junto a ele, para políticas compiladas antes da renomeação.
*   `app.user_roles` — Uma string separada por vírgulas listando as funções atribuídas ao usuário.
*   `app.is_anonymous` — `'true'` para uma sessão de convidado (login anônimo), `'false'` caso contrário.
*   `app.jwt` — Uma string JSON com as claims personalizadas do token mais `sub`, `roles` e `is_anonymous` (`{"sub": "<uid>", "roles": [...], "is_anonymous": false, …}`).

Esses parâmetros são configurados localmente durante a transação usando a função `set_config` do Postgres:
```sql
SELECT 
    set_config('app.uid', $1, true),
    set_config('app.user_id', $1, true),
    set_config('app.user_roles', $2, true),
    set_config('app.is_anonymous', $3, true),
    set_config('app.jwt', $4, true);
```

### Funções auxiliares de política do PostgreSQL

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
*   **`rebase.roles()`** — Retorna a string de funções separadas por vírgula:
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
*   **`rebase.is_anonymous()`** — Indica se o solicitante é um convidado, como `boolean` (`false` quando não estiver definido), permitindo que uma política use `NOT rebase.is_anonymous()`.

Você pode usar essas funções auxiliares diretamente em suas regras de segurança personalizadas ou migrações de banco de dados:
```sql
CREATE POLICY owner_access ON posts
    FOR ALL
    TO public
    USING (author_id = rebase.uid() OR string_to_array(rebase.roles(), ',') && ARRAY['admin']);
```

## Tokens assimétricos e JWKS

Por padrão, os tokens de acesso são assinados com `jwtSecret` (HS256). Isso funciona, mas
significa que qualquer entidade que precise *verificar* um token precisa possuir a chave que os *emite* —
portanto, um gateway ou edge worker que verifica uma sessão também pode forjar uma — e
alterar o segredo desconecta todos os usuários de uma só vez.

Configure uma chave de assinatura e o Rebase passará a assinar tokens de acesso de forma assimétrica,
publicando a metade pública em **`/.well-known/jwks.json`** para que qualquer um possa verificar
contra ela:

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

Chaves RSA também funcionam e assinam `RS256`; chaves EC P-256 assinam `ES256`. Apenas a chave
privada é configurada — a metade pública é derivada dela, garantindo que o par não fique
incompatível. O `jwtSecret` continua sendo obrigatório de qualquer forma: ele ainda assina os
tokens com escopo de finalidade específica (links de download, MFA pendente, redefinição de senha) que
apenas este servidor lê.

### Rotacionando uma chave

Coloque a nova chave primeiro e mantenha a antiga listada. Os novos tokens são assinados pela
nova chave; os tokens já em circulação continuam sendo verificados contra a antiga até
expirarem, para que ninguém seja desconectado.

```typescript no-verify
signingKeys: [
    { kid: "2026-09", privateKey: process.env.JWT_PRIVATE_KEY_NEW! },
    { kid: "2026-08", privateKey: process.env.JWT_PRIVATE_KEY_OLD! }
]
```

Assim que o tempo de vida do token de acesso mais longo tiver passado, remova a entrada antiga. Use
`activeKid` se desejar publicar uma chave antes de assinar com ela.

### Verificando em outro local

Os tokens carregam o `kid` da chave de assinatura em seu cabeçalho, que é como um verificador
escolhe a chave correta no JWKS e como ele sabe quando buscar novamente após uma
rotação. Qualquer biblioteca padrão faz isso por você — por exemplo, com `jose`:

```typescript no-verify
import { createRemoteJWKSet, jwtVerify } from "jose";

const jwks = createRemoteJWKSet(new URL("https://api.example.com/.well-known/jwks.json"));
const { payload } = await jwtVerify(token, jwks);
```

:::note
Sem nenhum `signingKeys` configurado, `/.well-known/jwks.json` responde
`{"keys":[]}` e os tokens continuam sendo HS256. Nada muda até que você adicione uma chave.
:::

## Autenticação por chave de serviço

Para comunicação entre servidores (ex.: cron jobs, serviços externos), configure uma chave de serviço estática:

```typescript
auth: {
    serviceKey: process.env.REBASE_SERVICE_KEY,
    // ...
}
```

Os clientes se autenticam com o cabeçalho `Authorization: Bearer <service-key>`. 

### Chave interna por inicialização (Per-Boot)

Se `REBASE_SERVICE_KEY` não for fornecido na sua configuração, o Rebase gera automaticamente uma **chave interna por inicialização** aleatória. 

Essa chave nunca é registrada em logs e nunca sai do processo. Ela é usada pelo singleton `rebase` para autenticar nas APIs do próprio plano de controle do servidor (autenticação, armazenamento, etc.). Isso garante que tarefas administrativas (como enviar um e-mail de boas-vindas ou gerar um URL de armazenamento) sempre funcionem imediatamente no desenvolvimento e em produção sem exigir o gerenciamento manual de chaves.

### Proteção contra Timing Attacks e requisitos de chave

Para evitar ataques de temporização (timing attacks), o Rebase valida tanto a chave de serviço configurada pelo usuário quanto a chave interna usando comparação de strings em tempo constante (`safeCompare`). A chave de serviço configurada pelo usuário **deve ter pelo menos 32 caracteres**; se uma chave com menos de 32 caracteres for configurada, o Rebase lançará um erro de configuração na inicialização e falhará de forma segura (fail-closed).

## Próximos passos

- **[Autenticação](/docs/backend/authentication/)** — a configuração de onde essas rotas se originam
- **[Adaptadores de autenticação personalizados](/docs/backend/auth-adapters/)** — substituindo o provedor por trás delas
- **[Regras de segurança (RLS)](/docs/collections/security-rules/)** — o que uma política faz com `rebase.uid()`
- **[Autenticação do SDK tipado](/docs/sdk/authentication/)** — chamando essas rotas a partir do SDK
