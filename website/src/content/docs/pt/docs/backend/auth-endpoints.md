---
sourceHash: 51c0059da14c6fd7
title: Endpoints de autenticação e tokens
sidebar_label: Endpoints de autenticação
description: As rotas de autenticação que o backend Rebase disponibiliza, seus formatos de resposta, autenticação multifator, o contexto de banco de dados visível por uma política, JWKS e chaves de serviço.
---

As rotas que [o bloco `auth`](/docs/backend/authentication/) disponibiliza e os tokens que elas retornam.

## Endpoints de autenticação

Todos os endpoints de autenticação estão montados em `/api/auth/`:

| Método | Caminho | Descrição |
|--------|---------|-----------|
| `POST` | `/api/auth/register` | Criar uma nova conta |
| `POST` | `/api/auth/login` | Entrar com e-mail/senha |
| `POST` | `/api/auth/refresh` | Atualizar o token de acesso |
| `POST` | `/api/auth/<provider>` | Autenticação OAuth (por exemplo, `/api/auth/google`, `/api/auth/linkedin`) |
| `POST` | `/api/auth/link/<provider>` | Vincular um provedor OAuth à conta autenticada. Em um convidado, isso equivale a um cadastro: requer `allowRegistration`, assume o endereço do provedor quando este o atesta e responde com uma sessão para a conta em que o convidado se tornou |
| `POST` | `/api/auth/logout` | Revogar o token de atualização |
| `POST` | `/api/auth/forgot-password` | Enviar e-mail de redefinição de senha |
| `POST` | `/api/auth/reset-password` | Redefinir a senha com token |
| `POST` | `/api/auth/find-user` | Resolver um e-mail para um perfil público mínimo (opt-in — `AUTH_ALLOW_USER_LOOKUP`) |
| `POST` | `/api/auth/change-password` | Alterar a própria senha do solicitante (autenticado). Encerra todas as outras sessões e responde com uma nova sessão para o solicitante |
| `GET` | `/api/auth/me` | O próprio perfil do solicitante |
| `PATCH` | `/api/auth/me` | Atualizar o próprio perfil do solicitante |
| `POST` | `/api/auth/change-email` | `{ newEmail }`: transfere a conta do solicitante para outro endereço. Envia um link para o novo endereço e uma notificação para o antigo; nada muda até que o link seja acessado. Requer `aal2` em uma conta com um segundo fator. `409 EMAIL_EXISTS` ou `UNDELIVERABLE_ADDRESS`, `400 EMAIL_UNCHANGED`, `403 ANONYMOUS_USER` para convidados — consulte [Alterando um endereço de e-mail](#alterando-um-endereço-de-e-mail-changing-an-email-address) |
| `POST` | `/api/auth/confirm-email-change` | `{ token }` do link. Nenhuma sessão necessária. Transfere a conta para o novo endereço, verificado; `400 INVALID_TOKEN` para um link já utilizado, substituído ou expirado, `409 EMAIL_EXISTS` quando o endereço foi ocupado enquanto aguardava |
| `GET` | `/api/auth/config` | O que este backend oferece a uma tela de login — `needsSetup`, `registrationEnabled`, `passwordReset`, `emailVerification`, `magicLink`, `anonymousLogin`, `adminPasswordReset`, `enabledProviders` e `storage`, que indica se o backend fornece armazenamento de arquivos. Não autenticado e calculado a partir dos mesmos predicados aplicados pelas rotas, de modo que o anunciado na tela não possa divergir do que ele realmente pode fazer |
| `POST` | `/api/auth/send-verification` | Enviar um link de verificação de e-mail ao solicitante |
| `GET` | `/api/auth/verify-email` | Consumir um link de verificação (a URL naquele e-mail). Mantém o que uma sessão ativa da conta comprova e remove o que ninguém comprovou — consulte [Verificação de e-mail](/docs/backend/email-verification/) |
| `POST` | `/api/auth/verify-email` | O mesmo com `{ token, password?, removeUnproven? }`: a senha o mantém e faz login; sem nenhuma das comprovações, uma conta que possua uma responde com `409 PROOF_REQUIRED` |
| `POST` | `/api/auth/magic-link` | Enviar um link de login de uso único por e-mail. `503 EMAIL_NOT_CONFIGURED` sem SMTP |
| `POST` | `/api/auth/magic-link/verify` | Trocar um token de magic-link por uma sessão |
| `POST` | `/api/auth/otp` | Enviar um código de login de seis dígitos por e-mail. Responde da mesma forma, existindo ou não uma conta para o endereço |
| `POST` | `/api/auth/otp/verify` | Trocar `{ email, code }` por uma sessão |
| `POST` | `/api/auth/anonymous` | Criar uma sessão anônima (opt-in — `ALLOW_ANONYMOUS`) |
| `POST` | `/api/auth/anonymous/link` | Vincular credenciais reais à conta anônima já autenticada. Requer `allowAnonymous` e cadastro aberto: `403 ANONYMOUS_AUTH_DISABLED` assim que o login anônimo for desativado, incluindo convidados autenticados anteriormente, e `403 REGISTRATION_DISABLED` enquanto o cadastro estiver fechado |
| `GET` | `/api/auth/sessions` | Listar as sessões ativas do solicitante, uma por login. A do próprio solicitante é marcada com `isCurrentSession` |
| `DELETE` | `/api/auth/sessions` | Revogar todas as sessões, incluindo esta — logout remoto em todos os dispositivos |
| `DELETE` | `/api/auth/sessions/:id` | Revogar uma sessão: seu token de atualização e o token de acesso que aquele dispositivo possui |
| `GET` | `/api/auth/scopes` | Todos os [escopos](/docs/backend/roles-and-scopes/) conhecidos por este backend e aqueles que o solicitante possui |
| `GET` | `/api/auth/keys` | As próprias [chaves de API pessoais](/docs/backend/api-keys/#personal-keys) do solicitante |
| `POST` | `/api/auth/keys` | Criar uma chave pessoal. `403 PERSONAL_KEYS_DISABLED`, a menos que a tabela de usuários defina `auth.personalKeys` |
| `DELETE` | `/api/auth/keys/:id` | Revogar uma das chaves do próprio solicitante |
| `GET` | `/.well-known/jwks.json` | O JWKS público — montado na raiz, não sob `basePath`, porque é onde um verificador procura. Montado sempre que o backend emite seus próprios tokens; um conjunto de chaves vazio até que a [assinatura assimétrica](#tokens-assimétricos-e-jwks-asymmetric-tokens-and-jwks) seja configurada |
| `POST` | `/api/auth/mfa/enroll` | Iniciar o registro de TOTP (retorna o segredo e os códigos de recuperação) |
| `POST` | `/api/auth/mfa/verify` | Confirmar um registro com um código do aplicativo autenticador |
| `GET` | `/api/auth/mfa/factors` | Listar os fatores registrados do solicitante |
| `POST` | `/api/auth/mfa/challenge` | Abrir um desafio contra um fator verificado |
| `POST` | `/api/auth/mfa/challenge/verify` | Responder a um desafio — é isso que emite a sessão |
| `DELETE` | `/api/auth/mfa/unenroll` | Remover um fator (requer uma sessão `aal2` assim que a conta tiver um fator verificado) |
| `POST` | `/api/auth/mfa/recovery-codes` | Substituir os códigos de recuperação do solicitante por dez novos códigos (requer uma sessão `aal2`) |

O gerenciamento administrativo de usuários e funções é uma **área separada**, montada em
`/api/admin/` em vez de `/api/auth/`. A leitura exige o escopo `users:read` e a
alteração exige `users:write`, exceto a leitura restrita do seletor de usuários abaixo. Um administrador e a chave de serviço possuem ambos; o mesmo vale para uma
função que os declare. Ninguém pode alterar uma conta que possua mais privilégios do que
os seus próprios. Consulte [Funções e escopos](/docs/backend/roles-and-scopes/).

| Método | Caminho | Descrição |
|--------|---------|-----------|
| `GET` | `/api/admin/users` | Listar usuários (paginado). `?search=` busca uma correspondência sem distinção entre maiúsculas e minúsculas em parte do e-mail ou do nome de exibição. Também faz correspondência com qualquer função que o usuário possua e com o uid |
| `GET` | `/api/admin/users/pick` | A leitura do seletor de usuários: `uid`, `displayName`, `email` e `photoURL` por usuário, nada mais. Aceita `?search=`, `?limit=` (25 por padrão) e `?offset=`, ou `?ids=a,b` para os usuários indicados por um valor armazenado. Atende a `users:read` e também a qualquer pessoa que possa gravar em uma coleção com um campo [`userSelect`](/docs/collections/properties/) — para que um editor possa preenchê-lo. Uma regra escrita em SQL puro (`using` / `withCheck` que o modelo de política não consegue ler) não pode ser avaliada com antecedência, portanto conta como recusa aqui: em tal coleção, apenas detentores de `users:read` podem selecionar. Qualquer outro recebe `403 SCOPE_MISSING` |
| `POST` | `/api/admin/users` | Criar um usuário |
| `GET` | `/api/admin/users/:uid` | Ler um usuário |
| `PUT` | `/api/admin/users/:uid` | Atualizar um usuário. `{ disabled: true }` desativa a conta sem excluí-la: todo login e atualização são recusados (`ACCOUNT_DISABLED`), suas sessões são encerradas e todos os tokens que ela possui são recusados; `false` a reativa |
| `DELETE` | `/api/admin/users/:uid` | Excluir um usuário. Suas sessões são encerradas e todos os tokens de acesso que ele possui são recusados a partir daquela requisição |
| `POST` | `/api/admin/users/:uid/reset-password` | Redefinir a senha de um usuário sem precisar da senha atual. O comando `rebase auth reset-password` a chama e só grava no banco de dados diretamente quando o backend não puder ser alcançado; de qualquer forma, as sessões da conta são encerradas |
| `DELETE` | `/api/admin/users/:uid/mfa` | Remover os segundos fatores e códigos de recuperação de um usuário e encerrar suas sessões — para alguém que perdeu ambos |
| `GET` | `/api/admin/roles` | `admin` e as funções que a tabela de usuários declara, com seus respectivos escopos |
| `POST` | `/api/admin/bootstrap` | Permitir que o usuário registrado mais antigo reivindique a função de admin enquanto nenhuma existir. Recusado em produção — consulte [Bootstrap do primeiro usuário](/docs/backend/authentication/#first-user-bootstrap) |

Todos os endpoints da API de dados exigem um cabeçalho `Authorization: Bearer <token>` válido quando `requireAuth: true` (o padrão).

### Política de senhas

Uma nova senha precisa ter pelo menos 8 caracteres, com uma letra maiúscula, uma
letra minúscula e um dígito. O cadastro, a redefinição e a alteração recusam qualquer
senha que falhe nesses requisitos com `400 WEAK_PASSWORD`, listando cada regra violada, e o mesmo se aplica a um
administrador definindo uma senha: `POST /api/admin/users`, uma criação na
tabela de usuários por meio da API de dados (`POST /api/data/users`, seu `/bulk`, uma
gravação via socket ou MCP), `PUT /api/admin/users/:uid` e
`POST /api/admin/users/:uid/reset-password`. Em um `/bulk`, a mensagem começa com
`Row <n>: ` (contado a partir de 0), assim como os outros erros de linha do bulk.

Para criar contas cujas senhas tenham sido definidas por outro sistema, como em uma importação, envie
`skipPasswordPolicy: true` no corpo da criação (em cada linha de um `/bulk`). O
servidor só honra isso para um administrador ou para a chave de serviço; para qualquer
outra pessoa, nada é dispensado e a recusa informa isso. Esse valor nunca é armazenado. A importação
do painel de administração o envia para cada linha que contenha uma `password`. O login
nunca verifica a política, portanto senhas antigas continuam funcionando. Para definir suas próprias regras, passe
`auth.hooks.validatePasswordStrength` a partir de um backend [ejetado](/docs/backend/authentication/#configuration).
O primeiro administrador gerado a partir de `REBASE_ADMIN_PASSWORD` segue uma
regra diferente: pelo menos 12 caracteres, e nada mais.

### Formato da resposta

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
omitido completamente quando a conta não puder ser lida novamente, portanto trate-o como opcional
aqui.

`providerId` indica como a sessão foi iniciada: `password`, `anonymous`,
`magic-link`, `otp`, `mfa` (um login concluído com um segundo fator), ou o
id do provedor, como `google`. Ele é armazenado com a sessão no momento do login, de modo que
`refresh` e `GET /api/auth/me` retornem a mesma resposta enquanto a
sessão durar. Uma sessão iniciada antes da versão 0.24 retorna `password`.

:::caution[O SDK tipado simplifica este envelope — o HTTP puro não]
O JSON acima é o formato de rede bruto (wire format), e é o que `fetch("/api/auth/login")`
retorna: o token reside em **`body.tokens.accessToken`**.

O [SDK tipado](/docs/sdk/authentication) desempacota `tokens` antes de entregar a
sessão de volta, de modo que `auth.signInWithEmail()` resolve diretamente em um formato simplificado
**`{ user, accessToken, refreshToken }`**.

Ambos os formatos são reais; eles pertencem a duas camadas diferentes. Ler o
formato do SDK diretamente de um `fetch` puro resulta em `undefined`, o que aparece como "login bem-sucedido,
mas não há token de acesso" — o login funcionou perfeitamente, o token estava apenas um nível abaixo.
:::

### Alterando um endereço de e-mail {#changing-an-email-address}

Um usuário autenticado
transfere sua própria conta para outro endereço em duas etapas:

1. `POST /api/auth/change-email { newEmail }` registra a alteração e envia um
   link, `<frontend>/confirm-email-change?token=…`, para o novo endereço, além de uma
   notificação sem link para o endereço atual. O link é válido por 24 horas, e uma
   nova solicitação substitui a anterior. `GET /api/auth/me` informa o endereço em
   espera como `pendingEmail`.
2. `POST /api/auth/confirm-email-change { token }` realiza a alteração da conta: o novo
   endereço se torna o endereço da conta, verificado. Todas as identidades OAuth cujo provedor
   atestou o endereço antigo são desconectadas (`removedProviders` lista quais são),
   pois quem controla o endereço antigo poderia, caso contrário, continuar acessando
   por meio dele, e qualquer link de redefinição enviado para o endereço antigo deixa de funcionar.
   As sessões são mantidas.

O novo endereço não fica reservado enquanto o link aguarda: retê-lo permitiria que qualquer
conta impedisse uma pessoa desconhecida de se cadastrar com seu próprio endereço. Se outra
conta assumir o endereço antes que o link seja acessado, o link responderá com
`409 EMAIL_EXISTS` e nada será alterado; entre duas contas solicitando o mesmo
endereço, a primeira a acessar seu respectivo link fica com ele. O hook `beforeEmailChange` pode
recusar um endereço, assim como o `beforeUserCreate` faz no cadastro.

No CMS, o endereço é alterado em **Account settings → Profile**, e o
link abre a própria tela do CMS, estando autenticado ou não. Outro frontend disponibiliza uma página
em `/confirm-email-change` que chama a rota com o token do link.

Com [`cookieAuth`](/docs/backend/authentication/#refresh-tokens-in-an-httponly-cookie) habilitado (o padrão), o token de
atualização trafega como um cookie `httpOnly` e `tokens.refreshToken` é uma string
vazia no corpo da resposta. O token de acesso não é afetado.

### Autenticação multifator (TOTP)

**Um segundo fator restringe o login, e não apenas operações individuais.** Assim que uma
conta possui um fator TOTP *verificado*, nenhuma rota emite uma sessão até que um
código seja apresentado — login por senha, todos os provedores OAuth, link mágico,
código por e-mail e vínculo anônimo são recusados com `401 MFA_REQUIRED`:

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

`mfaToken` **não é uma sessão**: ele possui escopo específico, expira em cinco minutos
e é rejeitado por todas as rotas autenticadas. Envie-o como token bearer para
`POST /api/auth/mfa/challenge` (com um `factorId`) e depois para
`POST /api/auth/mfa/challenge/verify` (com o `challengeId` e o código de seis dígitos,
ou um código de recuperação). Essa última chamada é a que emite os tokens de acesso e
de atualização, no nível `aal2`; esse nível é armazenado na sessão e mantido através
de `POST /api/auth/refresh`.

O registro também é controlado. O primeiro fator em uma conta pode ser registrado a partir de uma
sessão comum, mas, uma vez que um fator esteja verificado, `enroll`, `verify` e `unenroll`
passam a exigir uma sessão `aal2` — caso contrário, uma senha roubada permitiria registrar um
fator próprio, elevar os privilégios com ele e excluir o fator verdadeiro.

A verificação possui limites em ambos os eixos: um desafio expira após cinco tentativas
incorretas, cada conta é limitada a dez tentativas de verificação a cada 15 minutos
(contabilizadas por usuário, portanto alternar IPs não adianta), e um código aceito é
registrado para o fator, de forma que não pode ser reutilizado durante o restante de sua
janela de tolerância de ±1 passo.

Na tabela de usuários do CMS, as opções **Reset two-step verification**
(`DELETE /api/admin/users/:uid/mfa`) e **Disable or enable account**
(`PUT /api/admin/users/:uid { disabled }`) são disponibilizadas a quem possui
`users:write`, da mesma forma que as rotas; a opção de alternar nunca é oferecida na
sua própria conta, e a ação sobre uma conta com nível superior ao seu é recusada com a justificativa do servidor.

Defina `MFA_ENCRYPTION_KEY` (32+ caracteres aleatórios) para criptografar os segredos
TOTP armazenados. Sem essa chave, o servidor recorre a `JWT_SECRET` e emite um aviso. Defina-a
**antes** que qualquer usuário realize o registro: os segredos armazenados não contêm identificador de chave,
portanto alterar a chave posteriormente tornará os fatores existentes indecifráveis e seus proprietários
incapazes de concluir um desafio.

### Convidando membros da equipe por e-mail

Fluxos de convite precisam converter um endereço de e-mail em um ID de usuário, mas a tabela
`users` é protegida por RLS em relação ao cliente. Em vez de criar manualmente uma
função de servidor administrativa, habilite a busca nativa:

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
e `photoURL` — nunca o e-mail, funções ou metadados do usuário consultado. Ele vem
**desativado por padrão** porque permite que qualquer usuário autenticado verifique quais e-mails possuem
contas; ative-o apenas quando a experiência de convite do seu produto realmente exigir.

## Contexto de banco de dados para Row-Level Security (RLS)

O Rebase conecta a autenticação das requisições diretamente ao Row-Level Security (RLS) do PostgreSQL. Cada consulta ao banco de dados executada por meio de um driver com escopo de usuário é executada dentro de uma transação de banco de dados (`db.transaction()`) que configura parâmetros locais à transação:

*   `app.uid` — O ID exclusivo do usuário autenticado (`uid`). O padrão é `'anonymous'` para requisições não autenticadas. O parâmetro anterior à renomeação, `app.user_id`, ainda é gravado paralelamente a ele, para políticas compiladas antes da renomeação.
*   `app.user_roles` — Uma string separada por vírgulas listando as funções atribuídas ao usuário.
*   `app.is_anonymous` — `'true'` para uma sessão de convidado (login anônimo), `'false'` caso contrário.
*   `app.jwt` — Uma string JSON contendo as claims personalizadas do token acrescidas de `sub`, `roles` e `is_anonymous` (`{"sub": "<uid>", "roles": [...], "is_anonymous": false, …}`).

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

Para facilitar a escrita de políticas de Row-Level Security, o Rebase cria funções auxiliares sob o schema `rebase` durante a inicialização do banco de dados:

*   **`rebase.uid()`** — Retorna o ID do usuário autenticado como `text`, ou `NULL` se não estiver definido:
    ```sql
    CREATE OR REPLACE FUNCTION rebase.uid() RETURNS text AS $$
        SELECT COALESCE(
            NULLIF(current_setting('app.uid', true), ''),
            NULLIF(current_setting('app.user_id', true), '')
        );
    $$ LANGUAGE sql STABLE;
    ```
*   **`rebase.roles()`** — Retorna a string com as funções separadas por vírgula:
    ```sql
    CREATE OR REPLACE FUNCTION rebase.roles() RETURNS text AS $$
        SELECT COALESCE(NULLIF(current_setting('app.user_roles', true), ''), '');
    $$ LANGUAGE sql STABLE;
    ```
*   **`rebase.jwt()`** — Retorna a carga útil (payload) completa do JWT como um objeto `jsonb`:
    ```sql
    CREATE OR REPLACE FUNCTION rebase.jwt() RETURNS jsonb AS $$
        SELECT COALESCE(NULLIF(current_setting('app.jwt', true), ''), '{}')::jsonb;
    $$ LANGUAGE sql STABLE;
    ```
*   **`rebase.is_anonymous()`** — Informa se o solicitante é um convidado, retornando um `boolean` (`false` quando não estiver definido), permitindo que uma política use `NOT rebase.is_anonymous()`.

Você pode usar essas funções auxiliares diretamente em suas regras de segurança personalizadas ou em migrações de banco de dados:
```sql
CREATE POLICY owner_access ON posts
    FOR ALL
    TO public
    USING (author_id = rebase.uid() OR string_to_array(rebase.roles(), ',') && ARRAY['admin']);
```

## Tokens assimétricos e JWKS {#asymmetric-tokens-and-jwks}

Por padrão, os tokens de acesso são assinados com `jwtSecret` (HS256). Isso funciona, mas
significa que qualquer serviço que precise *verificar* um token precisa possuir a chave que o *emite*
— assim, um gateway ou um edge worker verificando uma sessão também poderia forjar uma — e
alterar o segredo desconecta todos os usuários de uma só vez.

Configure uma chave de assinatura e o Rebase passará a assinar os tokens de acesso de forma assimétrica,
publicando a metade pública em **`/.well-known/jwks.json`** para que qualquer pessoa possa realizar
a verificação:

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

Chaves RSA também funcionam e assinam com `RS256`; chaves EC P-256 assinam com `ES256`. Apenas a chave
privada é configurada — a metade pública é derivada dela, de modo que o par nunca fique
incompatível. `jwtSecret` continua sendo obrigatório em ambos os casos: ele ainda assina os
tokens de finalidade restrita (links para download, pendência de MFA, redefinição de senha) que apenas
este servidor lê.

### Rotacionando uma chave

Coloque a nova chave em primeiro lugar e mantenha a antiga listada. Os novos tokens serão assinados pela
nova chave; os tokens já em circulação continuarão sendo validados pela antiga até
expirarem, para que ninguém seja desconectado.

```typescript no-verify
signingKeys: [
    { kid: "2026-09", privateKey: process.env.JWT_PRIVATE_KEY_NEW! },
    { kid: "2026-08", privateKey: process.env.JWT_PRIVATE_KEY_OLD! }
]
```

Assim que o maior tempo de vida de token de acesso tiver transcorrido, remova a entrada antiga. Use
`activeKid` se desejar publicar uma chave antes de começar a assinar com ela.

### Verificando em outro lugar

Os tokens trazem o `kid` da chave de assinatura em seu cabeçalho, que é como o verificador
escolhe a chave correta no JWKS e sabe quando buscar novamente após uma
rotação. Qualquer biblioteca padrão faz isso por você — por exemplo, com `jose`:

```typescript no-verify
import { createRemoteJWKSet, jwtVerify } from "jose";

const jwks = createRemoteJWKSet(new URL("https://api.example.com/.well-known/jwks.json"));
const { payload } = await jwtVerify(token, jwks);
```

:::note
Sem nenhuma chave em `signingKeys`, `/.well-known/jwks.json` responde com
`{"keys":[]}` e os tokens permanecem em HS256. Nada muda até que você adicione uma chave.
:::

## Autenticação por chave de serviço

Para comunicação de servidor para servidor (por exemplo, tarefas cron, serviços externos), configure uma chave de serviço estática:

```typescript
auth: {
    serviceKey: process.env.REBASE_SERVICE_KEY,
    // ...
}
```

Os clientes autenticam-se com o cabeçalho `Authorization: Bearer <service-key>`.

### Chave interna por inicialização

Se `REBASE_SERVICE_KEY` não for informada em sua configuração, o Rebase gerará automaticamente uma **chave interna por inicialização** aleatória.

Essa chave nunca é registrada em logs e nunca sai do processo. Ela é utilizada pelo singleton `rebase` para autenticar contra as APIs do próprio plano de controle do servidor (autenticação, armazenamento, etc.). Isso garante que tarefas administrativas (como enviar um e-mail de boas-vindas ou gerar uma URL de armazenamento) funcionem sempre de forma imediata tanto em desenvolvimento quanto em produção, sem a necessidade de gerenciamento manual de chaves.

### Proteção contra ataques de temporização e requisitos da chave

Para evitar ataques de temporização (timing attacks), o Rebase valida tanto a chave de serviço configurada pelo usuário quanto a chave interna usando comparação de strings em tempo constante (`safeCompare`). A chave de serviço configurada pelo usuário **deve ter pelo menos 32 caracteres**; caso uma chave com menos de 32 caracteres seja configurada, o Rebase lançará um erro de configuração na inicialização e falhará de forma segura (fail-closed).

## Próximos passos

- **[Autenticação](/docs/backend/authentication/)** — a configuração de onde essas rotas se originam
- **[Adaptadores de autenticação personalizados](/docs/backend/auth-adapters/)** — substituindo o provedor por trás delas
- **[Regras de segurança (RLS)](/docs/collections/security-rules/)** — o que uma política faz com `rebase.uid()`
- **[Autenticação no SDK tipado](/docs/sdk/authentication/)** — chamando essas rotas pelo SDK
