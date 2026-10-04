---
sourceHash: eb3d7dba66d373fb
title: Endpoints de autenticação e tokens
sidebar_label: Endpoints de autenticação
description: As rotas de autenticação que o backend do Rebase disponibiliza, seus formatos de resposta, autenticação multifator, o contexto de banco de dados que uma política visualiza, JWKS e chaves de serviço.
---

As rotas que [o bloco `auth`](/docs/backend/authentication/) disponibiliza e os tokens que elas retornam.

## Endpoints de autenticação

Todos os endpoints de autenticação são montados em `/api/auth/`:

| Método | Caminho | Descrição |
|--------|---------|-----------|
| `POST` | `/api/auth/register` | Criar uma nova conta |
| `POST` | `/api/auth/login` | Fazer login com e-mail/senha |
| `POST` | `/api/auth/refresh` | Atualizar o access token |
| `POST` | `/api/auth/<provider>` | Login via OAuth (ex.: `/api/auth/google`, `/api/auth/linkedin`) |
| `POST` | `/api/auth/link/<provider>` | Vincular um provedor OAuth à conta autenticada. Em um convidado isso é um registro: requer `allowRegistration`, usa o endereço do provedor quando ele o garante, e responde com uma sessão para a conta em que o convidado se tornou |
| `POST` | `/api/auth/logout` | Revogar o refresh token |
| `POST` | `/api/auth/forgot-password` | Enviar e-mail de redefinição de senha |
| `POST` | `/api/auth/reset-password` | Redefinir senha com token |
| `POST` | `/api/auth/find-user` | Resolver um e-mail para um perfil público mínimo (opcional — `AUTH_ALLOW_USER_LOOKUP`) |
| `POST` | `/api/auth/change-password` | Alterar a própria senha do chamador (autenticado). Encerra todas as outras sessões e responde com uma nova para o chamador |
| `GET` | `/api/auth/me` | O próprio perfil do chamador |
| `PATCH` | `/api/auth/me` | Atualizar o próprio perfil do chamador |
| `POST` | `/api/auth/change-email` | `{ newEmail }`: move a própria conta do chamador para outro endereço. Envia um link para o novo endereço e um aviso para o antigo; nada muda até que o link seja seguido. Requer `aal2` em uma conta com um segundo fator. `409 EMAIL_EXISTS` ou `UNDELIVERABLE_ADDRESS`, `400 EMAIL_UNCHANGED`, `403 ANONYMOUS_USER` para um convidado — veja [Alterando um endereço de e-mail](#alterando-um-endereço-de-e-mail) |
| `POST` | `/api/auth/confirm-email-change` | `{ token }` do link. Nenhuma sessão é necessária. Move a conta para o novo endereço, verificado; `400 INVALID_TOKEN` para um link usado, substituído ou expirado, `409 EMAIL_EXISTS` quando o endereço foi tomado enquanto ele esperava |
| `GET` | `/api/auth/config` | O que este backend oferece a uma tela de login — `needsSetup`, `registrationEnabled`, `passwordReset`, `emailVerification`, `magicLink`, `anonymousLogin`, `adminPasswordReset`, `enabledProviders`. Não autenticado e calculado a partir dos mesmos predicados que as rotas impõem, de forma que o anunciado pela tela não divirja do que ela pode fazer |
| `POST` | `/api/auth/send-verification` | Enviar ao chamador um link de verificação de e-mail |
| `GET` | `/api/auth/verify-email` | Consumir um link de verificação (a URL contida nesse e-mail). Mantém o que uma sessão ativa da conta prova e remove o que ninguém provou — veja [Verificação de e-mail](/docs/backend/email-verification/) |
| `POST` | `/api/auth/verify-email` | O mesmo com `{ token, password?, removeUnproven? }`: a senha a mantém e faz login; sem nenhuma das duas provas, uma conta que já possui uma responde `409 PROOF_REQUIRED` |
| `POST` | `/api/auth/magic-link` | Enviar por e-mail um link de uso único para login. `503 EMAIL_NOT_CONFIGURED` sem SMTP |
| `POST` | `/api/auth/magic-link/verify` | Trocar um token de magic link por uma sessão |
| `POST` | `/api/auth/otp` | Enviar por e-mail um código de seis dígitos para login. Responde da mesma forma quer o endereço possua uma conta ou não |
| `POST` | `/api/auth/otp/verify` | Trocar `{ email, code }` por uma sessão |
| `POST` | `/api/auth/anonymous` | Criar uma sessão anônima (opcional — `ALLOW_ANONYMOUS`) |
| `POST` | `/api/auth/anonymous/link` | Vincular credenciais reais à conta anônima que já está conectada |
| `GET` | `/api/auth/sessions` | Listar as sessões ativas do chamador, uma por login. A do próprio chamador é marcada como `isCurrentSession` |
| `DELETE` | `/api/auth/sessions` | Revogar todas as sessões, incluindo esta — logout remoto em todos os dispositivos |
| `DELETE` | `/api/auth/sessions/:id` | Revogar uma sessão: seu refresh token, e o access token que aquele dispositivo possui |
| `GET` | `/api/auth/scopes` | Todos os [escopos](/docs/backend/roles-and-scopes/) que este backend conhece, e os que o chamador tem |
| `GET` | `/api/auth/keys` | As próprias [chaves de API pessoais](/docs/backend/api-keys/#personal-keys) do chamador |
| `POST` | `/api/auth/keys` | Criar uma chave pessoal. `403 PERSONAL_KEYS_DISABLED` a menos que a coleção de usuários defina `auth.personalKeys` |
| `DELETE` | `/api/auth/keys/:id` | Revogar uma das chaves do próprio chamador |
| `GET` | `/.well-known/jwks.json` | O JWKS público — montado na raiz, não sob `basePath`, pois é onde um verificador procura. Presente quando o [assinamento assimétrico](#asymmetric-tokens-and-jwks) estiver configurado |
| `POST` | `/api/auth/mfa/enroll` | Iniciar o cadastro no TOTP (retorna o segredo e os códigos de recuperação) |
| `POST` | `/api/auth/mfa/verify` | Confirmar o cadastro com um código do aplicativo autenticador |
| `GET` | `/api/auth/mfa/factors` | Listar os fatores cadastrados do chamador |
| `POST` | `/api/auth/mfa/challenge` | Abrir um desafio (challenge) contra um fator verificado |
| `POST` | `/api/auth/mfa/challenge/verify` | Responder a um desafio — é isso que emite a sessão |
| `DELETE` | `/api/auth/mfa/unenroll` | Remover um fator (requer uma sessão `aal2`) |
| `POST` | `/api/auth/mfa/recovery-codes` | Substituir os códigos de recuperação do chamador por dez novos (requer uma sessão `aal2`) |

O gerenciamento administrativo de usuários e papéis (roles) é uma **superfície separada**, montada em
`/api/admin/` em vez de `/api/auth/`. Ler requer o escopo `users:read` e
alterar requer `users:write`. Um admin e a chave de serviço têm os dois; o mesmo vale para uma
role que os declara. Ninguém pode alterar uma conta que tenha mais do que ele próprio.
Consulte [Papéis e escopos](/docs/backend/roles-and-scopes/).

| Método | Caminho | Descrição |
|--------|---------|-----------|
| `GET` | `/api/admin/users` | Listar usuários (paginado) |
| `POST` | `/api/admin/users` | Criar um usuário |
| `GET` | `/api/admin/users/:uid` | Ler um usuário |
| `PUT` | `/api/admin/users/:uid` | Atualizar um usuário. `{ disabled: true }` desliga a conta sem excluí-la: todo login e refresh é recusado (`ACCOUNT_DISABLED`), suas sessões terminam e todo token que ela possui é recusado; `false` a liga de volta |
| `DELETE` | `/api/admin/users/:uid` | Excluir um usuário. Suas sessões terminam, e todo access token que ela possui é recusado a partir dessa requisição |
| `POST` | `/api/admin/users/:uid/reset-password` | Redefinir a senha de um usuário sem a senha atual dele. `rebase auth reset-password` o chama, e escreve diretamente no banco de dados apenas quando o backend não pode ser alcançado; de qualquer forma, as sessões da conta terminam |
| `DELETE` | `/api/admin/users/:uid/mfa` | Remover os segundos fatores e os códigos de recuperação de um usuário, e terminar suas sessões — para alguém que perdeu os dois |
| `GET` | `/api/admin/roles` | `admin` e as roles que a coleção de usuários declara, com seus escopos |
| `POST` | `/api/admin/bootstrap` | Permitir que o primeiro usuário registrado assuma a role de admin enquanto nenhuma existir. Recusado em produção — veja [First User Bootstrap](/docs/backend/authentication/#first-user-bootstrap) |

Todos os endpoints da API de dados requerem um cabeçalho `Authorization: Bearer <token>` válido quando `requireAuth: true` (o padrão).

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

Envie o access token de volta como `Authorization: Bearer <accessToken>`.
`accessTokenExpiresAt` é em milissegundos epoch.

`POST /api/auth/refresh` responde com o mesmo envelope, exceto que `user` é
omitido por completo quando a conta não puder ser lida novamente, portanto trate-o como opcional
aqui.

`providerId` indica como a sessão foi autenticada: `password`, `anonymous`,
`magic-link`, `otp`, `mfa` (um login concluído com um segundo fator), ou o
id do provedor, como `google`. Ele é armazenado junto com a sessão no momento do login, de modo que
`refresh` e `GET /api/auth/me` dão a mesma resposta enquanto a
sessão existir. Uma sessão autenticada antes da 0.24 lê `password`.

:::caution[O SDK tipado simplifica este envelope — o HTTP puro não]
O JSON acima é o formato de transmissão (wire format) e é o que `fetch("/api/auth/login")`
retorna: o token reside em **`body.tokens.accessToken`**.

O [SDK tipado](/docs/sdk/authentication) desempacota `tokens` antes de retornar a
sessão, então `auth.signInWithEmail()` resolve diretamente para
**`{ user, accessToken, refreshToken }`**.

Ambos os formatos são reais; eles pertencem a duas camadas diferentes. Ler o formato
do SDK a partir de um `fetch` puro resulta em `undefined`, o que se manifesta como "o login foi bem-sucedido,
mas não há access token" — o login funcionou perfeitamente, o token estava apenas um nível abaixo.
:::

### Alterando um endereço de e-mail

<span class="since-badge" data-since="0.24">Since 0.24</span> Um usuário conectado
move a própria conta para outro endereço em duas etapas:

1. `POST /api/auth/change-email { newEmail }` registra a alteração e envia um
   link, `<frontend>/confirm-email-change?token=…`, para o novo endereço, e um
   aviso sem link para o atual. O link vive por 24 horas, e uma
   nova requisição substitui a última. `GET /api/auth/me` reporta o
   endereço em espera como `pendingEmail`.
2. `POST /api/auth/confirm-email-change { token }` move a conta: o novo
   endereço se torna o seu endereço, verificado. Toda identidade OAuth cujo provedor
   garantiu o endereço antigo é desvinculada (`removedProviders` as nomeia),
   porque quem controla o endereço antigo poderia de outra forma ainda fazer login
   por meio dele, e qualquer link de redefinição enviado ao endereço antigo deixa de funcionar.
   As sessões são mantidas.

O novo endereço não é reservado enquanto o link espera: retê-lo permitiria que qualquer
conta impedisse um estranho de se cadastrar com o próprio endereço. Se outra
conta já tiver o endereço quando o link for seguido, o link responde
`409 EMAIL_EXISTS` e nada se move; de duas contas pedindo o mesmo
endereço, a primeira a seguir seu link o obtém. O hook `beforeEmailChange` pode
recusar um endereço, assim como `beforeUserCreate` faz no cadastro.

No CMS, o endereço é alterado em **Account settings → Profile**, e o
link abre a própria tela do CMS, conectado ou não. Outro frontend serve uma página
em `/confirm-email-change` que chama a rota com o token do link.

Com [`cookieAuth`](/docs/backend/authentication/#refresh-tokens-in-an-httponly-cookie) habilitado, o refresh
token trafega como um cookie `httpOnly` e `tokens.refreshToken` é uma string vazia
no corpo da resposta. O access token não é afetado.

### Autenticação multifator (TOTP)

**Um segundo fator restringe o login, não apenas operações individuais.** Uma vez que uma
conta possui um fator TOTP *verificado*, nenhuma rota emitirá uma sessão até que um
código seja apresentado — login por senha, todos os provedores OAuth, magic link e
anonymous-link recusam com `401 MFA_REQUIRED`:

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

`mfaToken` **não é uma sessão**: possui escopo de finalidade específica, expira em cinco minutos
e é rejeitado por todas as rotas autenticadas. Envie-o como bearer token para
`POST /api/auth/mfa/challenge` (com um `factorId`) e, em seguida, para
`POST /api/auth/mfa/challenge/verify` (com o `challengeId` e o código de seis dígitos,
ou um código de recuperação). Essa última chamada é o que gera os tokens de acesso e de atualização,
em `aal2`; o nível é armazenado na sessão e mantido através de
`POST /api/auth/refresh`.

O cadastro também é protegido. O primeiro fator em uma conta pode ser cadastrado a partir de uma
sessão comum, mas assim que um é verificado, `enroll`, `verify` e `unenroll`
exigem uma sessão `aal2` — caso contrário, uma senha roubada poderia cadastrar um
fator próprio, elevar os privilégios com ele e excluir o fator legítimo.

A verificação é limitada em ambos os eixos: um desafio expira após cinco tentativas
incorretas, cada conta é limitada a dez tentativas de verificação a cada 15 minutos
(contadas por usuário, portanto rotacionar IPs não ajuda), e um código aceito é
registrado para aquele fator, impedindo que seja reutilizado pelo restante da sua
janela de ±1 etapa.

<span class="since-badge" data-since="0.24">Since 0.24</span> Na tabela de usuários, **Reset two-step verification**
(`DELETE /api/admin/users/:uid/mfa`) e **Disable or enable account**
(`PUT /api/admin/users/:uid { disabled }`) são oferecidos a quem possui
`users:write`, assim como as rotas são; a opção nunca é oferecida na própria
conta, e uma conta que supera a sua é recusada com o motivo do servidor.

Defina `MFA_ENCRYPTION_KEY` (32+ caracteres aleatórios) para criptografar os segredos
de TOTP armazenados. Sem ela, o servidor recorre ao `JWT_SECRET` e emite um aviso. Configure-a
**antes** que qualquer pessoa se cadastre: os segredos armazenados não possuem identificador de chave,
portanto alterar a chave posteriormente tornará os fatores existentes indecifráveis e seus proprietários
incapazes de concluir um desafio.

### Convidando colegas de equipe por e-mail

Fluxos de convite precisam converter um endereço de e-mail em um ID de usuário, mas a
coleção `users` é protegida por RLS contra o cliente. Em vez de implementar manualmente
uma função administrativa no servidor, habilite a busca nativa:

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

O endpoint é **exclusivo para usuários autenticados** e retorna apenas `uid`, `displayName`
e `photoURL` — nunca o e-mail, as roles ou os metadados do usuário consultado. Ele fica
**desativado por padrão** porque permite que qualquer usuário conectado sonde quais e-mails possuem
contas; ative-o apenas quando a experiência de convite do seu produto exigir.

## Contexto de banco de dados do Row-Level Security (RLS)

O Rebase conecta a autenticação da requisição diretamente ao Row-Level Security (RLS) do PostgreSQL. Toda consulta de banco de dados executada por meio de um driver com escopo de usuário é executada dentro de uma transação de banco de dados (`db.transaction()`) que configura parâmetros locais à transação:

*   `app.user_id` — O ID exclusivo do usuário autenticado (`uid`). O padrão é `'anon'` para requisições não autenticadas.
*   `app.user_roles` — Uma string separada por vírgulas listando as roles atribuídas ao usuário.
*   `app.jwt` — Uma string JSON contendo a carga completa de claims do JWT (`{"sub": "<uid>", "roles": [...]}`).

Esses parâmetros são configurados localmente durante a transação usando a função `set_config` do Postgres:
```sql
SELECT 
    set_config('app.user_id', $1, true),
    set_config('app.user_roles', $2, true),
    set_config('app.jwt', $3, true);
```

### Funções auxiliares de políticas do PostgreSQL

Para simplificar a escrita de políticas de Row-Level Security, o Rebase cria funções auxiliares no schema `auth` durante a inicialização do banco de dados:

*   **`rebase.uid()`** — Retorna o ID do usuário autenticado como `text`, ou `NULL` caso não esteja definido:
    ```sql
    CREATE OR REPLACE FUNCTION rebase.uid() RETURNS text AS $$
        SELECT NULLIF(current_setting('app.user_id', true), '');
    $$ LANGUAGE sql STABLE;
    ```
*   **`rebase.roles()`** — Retorna a string de roles separadas por vírgula:
    ```sql
    CREATE OR REPLACE FUNCTION rebase.roles() RETURNS text AS $$
        SELECT COALESCE(NULLIF(current_setting('app.user_roles', true), ''), '');
    $$ LANGUAGE sql STABLE;
    ```
*   **`rebase.jwt()`** — Retorna a carga completa do JWT como um objeto `jsonb`:
    ```sql
    CREATE OR REPLACE FUNCTION rebase.jwt() RETURNS jsonb AS $$
        SELECT COALESCE(NULLIF(current_setting('app.jwt', true), ''), '{}')::jsonb;
    $$ LANGUAGE sql STABLE;
    ```

Você pode usar essas funções auxiliares diretamente em suas regras de segurança personalizadas ou migrações de banco de dados:
```sql
CREATE POLICY owner_access ON posts
    FOR ALL
    TO public
    USING (author_id = rebase.uid() OR string_to_array(rebase.roles(), ',') && ARRAY['admin']);
```

## Tokens assimétricos e JWKS {#asymmetric-tokens-and-jwks}

Por padrão, os access tokens são assinados com `jwtSecret` (HS256). Isso funciona, mas
significa que qualquer parte que precise *verificar* um token deve possuir a chave que o *emite*
— assim, um gateway ou edge worker verificando uma sessão também pode forjar uma — e
alterar o segredo desconecta todos os usuários de uma só vez.

Configure uma chave de assinatura e o Rebase passará a assinar os access tokens de forma assimétrica,
publicando a metade pública em **`/.well-known/jwks.json`** para que qualquer um possa fazer
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
privada é configurada — a parte pública é derivada dela, de modo que o par nunca fique
incompatível. O `jwtSecret` continua obrigatório em qualquer caso: ele ainda assina os
tokens de finalidade específica (links de download, MFA pendente, redefinição de senha) que apenas
este servidor lê.

### Rotacionando uma chave

Coloque a nova chave primeiro e mantenha a antiga listada. Os novos tokens são assinados pela
nova chave; os tokens já em circulação continuam sendo verificados em relação à chave antiga até
expirarem, de modo que ninguém seja desconectado.

```typescript no-verify
signingKeys: [
    { kid: "2026-09", privateKey: process.env.JWT_PRIVATE_KEY_NEW! },
    { kid: "2026-08", privateKey: process.env.JWT_PRIVATE_KEY_OLD! }
]
```

Assim que o maior tempo de vida de um access token tiver decorrido, remova a entrada antiga. Use
`activeKid` caso queira publicar uma chave antes de começar a assinar com ela.

### Verificando em outros locais

Os tokens carregam o `kid` da chave de assinatura em seu cabeçalho, permitindo que um verificador
selecione a chave correta no JWKS e saiba quando deve buscar novamente após
uma rotação. Qualquer biblioteca padrão faz isso por você — por exemplo, com `jose`:

```typescript no-verify
import { createRemoteJWKSet, jwtVerify } from "jose";

const jwks = createRemoteJWKSet(new URL("https://api.example.com/.well-known/jwks.json"));
const { payload } = await jwtVerify(token, jwks);
```

:::note
Sem `signingKeys` configuradas, `/.well-known/jwks.json` responde com
`{"keys":[]}` e os tokens permanecem em HS256. Nada muda até que você adicione uma chave.
:::

## Autenticação por chave de serviço

Para comunicação servidor a servidor (ex.: tarefas agendadas via cron, serviços externos), configure uma chave de serviço estática:

```typescript
auth: {
    serviceKey: process.env.REBASE_SERVICE_KEY,
    // ...
}
```

Os clientes se autenticam com o cabeçalho `Authorization: Bearer <service-key>`.

### Chave interna por inicialização

Se `REBASE_SERVICE_KEY` não for fornecida em sua configuração, o Rebase gerará automaticamente uma **chave interna por inicialização** aleatória.

Esta chave nunca é registrada em logs e nunca sai do processo. Ela é utilizada pelo singleton `rebase` para se autenticar nas próprias APIs do plano de controle do servidor (auth, storage, etc.). Isso garante que tarefas administrativas (como enviar um e-mail de boas-vindas ou gerar uma URL de armazenamento) funcionem de fábrica em desenvolvimento e produção, sem a necessidade de gerenciamento manual de chaves.

### Proteção contra Timing Attacks e requisitos de chave

Para prevenir timing attacks, o Rebase valida tanto a chave de serviço configurada pelo usuário quanto a chave interna utilizando comparação de strings em tempo constante (`safeCompare`). A chave de serviço configurada pelo usuário **deve ter pelo menos 32 caracteres**; se uma chave com menos de 32 caracteres for configurada, o Rebase emitirá um erro de configuração na inicialização e falhará de forma segura (fail-closed).

## Próximos passos

- **[Autenticação](/docs/backend/authentication/)** — a configuração de onde essas rotas se originam
- **[Adaptadores de autenticação personalizados](/docs/backend/auth-adapters/)** — substituindo o provedor por trás delas
- **[Regras de segurança (RLS)](/docs/collections/security-rules/)** — o que uma política faz com `rebase.uid()`
- **[Autenticação no SDK tipado](/docs/sdk/authentication/)** — chamando essas rotas a partir do SDK
