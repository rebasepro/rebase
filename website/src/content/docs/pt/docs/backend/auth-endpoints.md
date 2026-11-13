---
sourceHash: 26d38afcbfd02569
title: Endpoints de autenticação e tokens
sidebar_label: Endpoints de autenticação
description: As rotas de autenticação que o backend do Rebase monta, seus formatos de resposta, autenticação multifator, o contexto de banco de dados que uma política vê, JWKS e chaves de serviço.
---

As rotas que [o bloco `auth`](/docs/backend/authentication/) monta, e os tokens que elas retornam.

## Endpoints de autenticação

Todos os endpoints de autenticação são montados em `/api/auth/`:

| Método | Caminho | Descrição |
|--------|---------|-----------|
| `POST` | `/api/auth/register` | Cria uma nova conta |
| `POST` | `/api/auth/login` | Faz login com e-mail/senha |
| `POST` | `/api/auth/refresh` | Atualiza o access token |
| `POST` | `/api/auth/<provider>` | Login via OAuth (ex.: `/api/auth/google`, `/api/auth/linkedin`) |
| `POST` | `/api/auth/link/<provider>` | Vincula um provedor OAuth à conta autenticada. Em um convidado, isso funciona como registro: requer `allowRegistration`, assume o endereço do provedor quando este o valida, e responde com uma sessão para a conta na qual o convidado se transformou |
| `POST` | `/api/auth/logout` | Revoga o refresh token |
| `POST` | `/api/auth/forgot-password` | Envia e-mail de redefinição de senha |
| `POST` | `/api/auth/reset-password` | Redefine a senha com token |
| `POST` | `/api/auth/find-user` | Resolve um e-mail para um perfil público mínimo (opcional — `AUTH_ALLOW_USER_LOOKUP`) |
| `POST` | `/api/auth/change-password` | Altera a própria senha do chamador (autenticado). Encerra todas as outras sessões e responde com uma nova para o chamador |
| `GET` | `/api/auth/me` | O próprio perfil do chamador |
| `PATCH` | `/api/auth/me` | Atualiza o próprio perfil do chamador |
| `POST` | `/api/auth/change-email` | `{ newEmail }`: transfere a conta do chamador para outro endereço. Envia um link para o novo endereço e uma notificação para o antigo; nada muda até que o link seja acessado. Requer `aal2` em uma conta com um segundo fator. Retorna `409 EMAIL_EXISTS` ou `UNDELIVERABLE_ADDRESS`, `400 EMAIL_UNCHANGED`, `403 ANONYMOUS_USER` para um convidado — consulte [Alterando um endereço de e-mail](#alterando-um-endereço-de-e-mail) |
| `POST` | `/api/auth/confirm-email-change` | `{ token }` do link. Não requer sessão. Transfere a conta para o novo endereço, verificado; `400 INVALID_TOKEN` para um link já utilizado, substituído ou expirado, `409 EMAIL_EXISTS` se o endereço foi ocupado enquanto aguardava |
| `GET` | `/api/auth/config` | O que este backend oferece para uma tela de login — `needsSetup`, `registrationEnabled`, `passwordReset`, `emailVerification`, `magicLink`, `anonymousLogin`, `adminPasswordReset`, `enabledProviders` e `storage`, que indica se o backend oferece armazenamento de arquivos. Não autenticado e calculado a partir dos mesmos predicados que as rotas impõem, de forma que o que a tela anuncia não pode divergir do que ela pode fazer |
| `POST` | `/api/auth/send-verification` | Envia ao chamador um link de verificação de e-mail |
| `GET` | `/api/auth/verify-email` | Consome um link de verificação (a URL naquele e-mail). Mantém o que uma sessão ativa da conta comprova e remove o que ninguém comprovou — consulte [Verificação de e-mail](/docs/backend/email-verification/) |
| `POST` | `/api/auth/verify-email` | O mesmo com `{ token, password?, removeUnproven? }`: a senha mantém e faz login; sem nenhuma comprovação, uma conta que possua uma responde com `409 PROOF_REQUIRED` |
| `POST` | `/api/auth/magic-link` | Envia por e-mail um link de login de uso único. `503 EMAIL_NOT_CONFIGURED` sem SMTP |
| `POST` | `/api/auth/magic-link/verify` | Troca um token de magic link por uma sessão |
| `POST` | `/api/auth/otp` | Envia por e-mail um código de login de seis dígitos. Responde da mesma forma independentemente de o endereço possuir ou não uma conta |
| `POST` | `/api/auth/otp/verify` | Troca `{ email, code }` por uma sessão |
| `POST` | `/api/auth/anonymous` | Cria uma sessão anônima (opcional — `ALLOW_ANONYMOUS`) |
| `POST` | `/api/auth/anonymous/link` | Associa credenciais reais à conta anônima já conectada. Requer tanto `allowAnonymous` quanto registro aberto: `403 ANONYMOUS_AUTH_DISABLED` quando o login anônimo for desativado, incluindo convidados conectados anteriormente, e `403 REGISTRATION_DISABLED` enquanto o registro estiver fechado |
| `GET` | `/api/auth/sessions` | Lista as sessões ativas do chamador, uma por login. A própria sessão do chamador é marcada com `isCurrentSession` |
| `DELETE` | `/api/auth/sessions` | Revoga todas as sessões, incluindo esta — logout remoto em todos os dispositivos |
| `DELETE` | `/api/auth/sessions/:id` | Revoga uma sessão: seu refresh token e o access token que o dispositivo possui |
| `GET` | `/api/auth/scopes` | Todos os [escopos](/docs/backend/roles-and-scopes/) que este backend conhece, e os que o chamador possui |
| `GET` | `/api/auth/keys` | As próprias [chaves de API pessoais](/docs/backend/api-keys/#personal-keys) do chamador |
| `POST` | `/api/auth/keys` | Cria uma chave pessoal. `403 PERSONAL_KEYS_DISABLED`, a menos que a coleção de usuários defina `auth.personalKeys` |
| `DELETE` | `/api/auth/keys/:id` | Revoga uma das chaves do próprio chamador |
| `GET` | `/.well-known/jwks.json` | O JWKS público — montado na raiz, não sob `basePath`, porque é onde um verificador procura. Montado sempre que o backend emite seus próprios tokens; um conjunto de chaves vazio até que a [assinatura assimétrica](#tokens-assimétricos-e-jwks) seja configurada |
| `POST` | `/api/auth/mfa/enroll` | Inicia o registro de TOTP (retorna o segredo e os códigos de recuperação) |
| `POST` | `/api/auth/mfa/verify` | Confirma um registro com um código do autenticador |
| `GET` | `/api/auth/mfa/factors` | Lista os fatores registrados do chamador |
| `POST` | `/api/auth/mfa/challenge` | Abre um desafio contra um fator verificado |
| `POST` | `/api/auth/mfa/challenge/verify` | Responde a um desafio — é isso que emite a sessão |
| `DELETE` | `/api/auth/mfa/unenroll` | Remove um fator (requer uma sessão `aal2` assim que a conta tiver um fator verificado) |
| `POST` | `/api/auth/mfa/recovery-codes` | Substitui os códigos de recuperação do chamador por dez novos (requer uma sessão `aal2`) |

O gerenciamento administrativo de usuários e papéis é uma **superfície separada**, montada em
`/api/admin/` em vez de `/api/auth/`. A leitura requer o escopo `users:read` e a
alteração requer `users:write`, com exceção da leitura restrita do seletor de usuários abaixo. Um administrador e a chave de serviço possuem ambos; assim como um
papel que os declare. Ninguém pode alterar uma conta que detenha mais permissões do que a sua
própria. Consulte [Papéis e escopos](/docs/backend/roles-and-scopes/).

| Método | Caminho | Descrição |
|--------|---------|-----------|
| `GET` | `/api/admin/users` | Lista usuários (paginado). `?search=` faz correspondência sem distinção entre maiúsculas e minúsculas com parte do e-mail ou do nome de exibição. Também corresponde a qualquer papel que o usuário tenha, e ao uid |
| `GET` | `/api/admin/users/pick` | A leitura do seletor de usuários: `uid`, `displayName`, `email` e `photoURL` por usuário, nada mais. Aceita `?search=`, `?limit=` (25 por padrão) e `?offset=`, ou `?ids=a,b` para os usuários nomeados por um valor armazenado. Atende `users:read`, e também qualquer um que possa gravar em uma coleção com um campo [`userSelect`](/docs/collections/properties/) — para que um editor possa preenchê-lo. Uma regra escrita como SQL bruto (`using` / `withCheck` que o modelo de política não consegue interpretar) não pode ser avaliada com antecedência, portanto conta como recusa aqui: em tal coleção, apenas detentores de `users:read` podem selecionar. Qualquer outra pessoa recebe `403 SCOPE_MISSING` |
| `POST` | `/api/admin/users` | Cria um usuário |
| `GET` | `/api/admin/users/:uid` | Lê um usuário |
| `PUT` | `/api/admin/users/:uid` | Atualiza um usuário. `{ disabled: true }` desativa a conta sem excluí-la: todo login e refresh são recusados (`ACCOUNT_DISABLED`), suas sessões são encerradas e todo token que ela detém é recusado; `false` a reativa |
| `DELETE` | `/api/admin/users/:uid` | Exclui um usuário. Suas sessões são encerradas e todo access token que ele detém é recusado a partir daquela requisição |
| `POST` | `/api/admin/users/:uid/reset-password` | Redefine a senha de um usuário sem a sua senha atual. `rebase auth reset-password` chama isso e grava diretamente no banco de dados apenas quando o backend não pode ser alcançado; de qualquer forma, as sessões da conta são encerradas |
| `DELETE` | `/api/admin/users/:uid/mfa` | Remove os segundos fatores e códigos de recuperação de um usuário, e encerra suas sessões — para alguém que perdeu ambos |
| `GET` | `/api/admin/roles` | `admin` e os papéis que a coleção de usuários declara, com seus escopos |
| `POST` | `/api/admin/bootstrap` | Permite que o primeiro usuário registrado assuma o papel de administrador enquanto nenhum existir. Recusado em produção — consulte [Primeiro Usuário Bootstrap](/docs/backend/authentication/#first-user-bootstrap) |

Todos os endpoints da API de dados exigem um cabeçalho `Authorization: Bearer <token>` válido quando `requireAuth: true` (o padrão).

### Política de senha

Uma nova senha precisa de pelo menos 8 caracteres, com uma letra maiúscula, uma
letra minúscula e um dígito. Registro, redefinição e alteração recusam senhas que
falham com `400 WEAK_PASSWORD`, listando cada regra violada, assim como um
administrador definindo uma senha: `POST /api/admin/users`, uma criação na
coleção de usuários através da API de dados (`POST /api/data/users`, seu `/bulk`, uma
gravação via socket ou MCP), `PUT /api/admin/users/:uid` e
`POST /api/admin/users/:uid/reset-password`. Em um `/bulk`, a mensagem começa com
`Row <n>: ` (contado a partir de 0), como os outros erros de linha do bulk.

Para criar contas cujas senhas foram definidas por outro sistema, como uma importação, envie
`skipPasswordPolicy: true` no corpo da criação (em cada linha de um `/bulk`). O
servidor só honra isso para um administrador ou para a chave de serviço; para qualquer
outra pessoa, ele não dispensa nada, e a recusa explicita isso. O parâmetro nunca é armazenado. A importação
do painel de administração envia-o para cada linha que contenha uma `password`. O login
nunca verifica a política, portanto senhas antigas continuam funcionando. Para definir suas próprias regras, passe
`auth.hooks.validatePasswordStrength` a partir de um backend [ejetado](/docs/backend/authentication/#configuration).
O primeiro administrador semeado a partir de `REBASE_ADMIN_PASSWORD` segue uma
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

Envie o access token de volta como `Authorization: Bearer <accessToken>`.
`accessTokenExpiresAt` está em milissegundos de época.

`POST /api/auth/refresh` responde com o mesmo envelope, exceto que `user` é
omitido inteiramente quando a conta não puder ser lida novamente, portanto trate-o como opcional
nesse caso.

`providerId` informa como a sessão foi iniciada: `password`, `anonymous`,
`magic-link`, `otp`, `mfa` (um login concluído com um segundo fator), ou o
id do provedor, como `google`. Ele é armazenado com a sessão no login, portanto
`refresh` e `GET /api/auth/me` dão a mesma resposta durante todo o período em que a
sessão estiver ativa. Uma sessão iniciada antes da versão 0.24 retorna `password`.

:::caution[O SDK tipado achata este envelope — o HTTP puro não]
O JSON acima é o formato na rede, e é o que `fetch("/api/auth/login")`
retorna: o token reside em **`body.tokens.accessToken`**.

O [SDK tipado](/docs/sdk/authentication) desempacota `tokens` antes de entregar a
sessão de volta, de modo que `auth.signInWithEmail()` é resolvido para um objeto achatado
**`{ user, accessToken, refreshToken }`**.

Ambos os formatos são reais; eles pertencem a duas camadas diferentes. Ler o formato
do SDK diretamente de um `fetch` comum resultará em `undefined`, o que aparenta ser "o login foi bem-sucedido,
mas não há access token" — o login funcionou perfeitamente, o token estava apenas um nível abaixo.
:::

### Alterando um endereço de e-mail

Um usuário autenticado
transfere sua própria conta para outro endereço em duas etapas:

1. `POST /api/auth/change-email { newEmail }` registra a alteração e envia um
   link, `<frontend>/confirm-email-change?token=…`, para o novo endereço, e uma
   notificação sem link para o atual. O link permanece válido por 24 horas, e uma
   nova requisição substitui a anterior. `GET /api/auth/me` informa o endereço
   pendente como `pendingEmail`.
2. `POST /api/auth/confirm-email-change { token }` move a conta: o novo
   endereço torna-se seu endereço oficial, verificado. Toda identidade OAuth cujo provedor
   garantiu o endereço antigo é desconectada (`removedProviders` lista quais foram),
   porque quem controla o endereço antigo poderia, caso contrário, continuar fazendo login
   por meio dele, e qualquer link de redefinição enviado ao endereço antigo para de funcionar.
   As sessões são mantidas.

O novo endereço não fica reservado enquanto o link aguarda: reservá-lo permitiria que qualquer
conta impedisse um terceiro de se registrar com seu próprio endereço. Se outra
conta tiver assumido o endereço no momento em que o link for acessado, o link responderá
`409 EMAIL_EXISTS` e nada será alterado; entre duas contas solicitando o mesmo
endereço, a primeira a acessar o link o obtém. O hook `beforeEmailChange` pode
recusar um endereço, assim como `beforeUserCreate` faz no momento do registro.

No CMS, o endereço é alterado a partir de **Configurações da conta → Perfil**, e o
link abre a própria tela do CMS, autenticado ou não. Outro frontend fornece uma página
em `/confirm-email-change` que chama a rota com o token do link.

Com [`cookieAuth`](/docs/backend/authentication/#refresh-tokens-in-an-httponly-cookie) habilitado (o padrão), o refresh
token viaja como um cookie `httpOnly` e `tokens.refreshToken` vem como uma string
vazia no corpo. O access token não é afetado.

### Autenticação multifator (TOTP)

**Um segundo fator restringe o login, não apenas operações individuais.** Assim que uma
conta possui um fator TOTP *verificado*, nenhuma rota emitirá uma sessão para ela até que um
código seja apresentado — login por senha, qualquer provedor OAuth, magic link, código
por e-mail e vinculação anônima recusam com `401 MFA_REQUIRED`:

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

`mfaToken` **não é uma sessão**: ele possui escopo de finalidade restrita, expira em cinco minutos
e é rejeitado por todas as rotas autenticadas. Envie-o como o token bearer para
`POST /api/auth/mfa/challenge` (com um `factorId`) e depois para
`POST /api/auth/mfa/challenge/verify` (com o `challengeId` e o código de seis dígitos,
ou um código de recuperação). Essa última chamada é o que gera os tokens de
acesso e refresh, no nível `aal2`; o nível é armazenado na sessão e mantido através
de `POST /api/auth/refresh`.

O registro também possui restrições. O primeiro fator de uma conta pode ser registrado a partir de
uma sessão comum, mas assim que um for verificado, `enroll`, `verify` e `unenroll`
exigirão uma sessão `aal2` — caso contrário, uma senha roubada poderia registrar um
fator próprio, autenticar-se por ele e excluir o fator verdadeiro.

A verificação é limitada em ambos os eixos: um desafio é invalidado após cinco tentativas
incorretas, cada conta é limitada a dez tentativas de verificação a cada 15 minutos
(contabilizadas por usuário, portanto alternar IPs não ajuda), e um código aceito é
registrado contra o fator para que não possa ser reutilizado pelo restante de sua
janela de tolerância de ±1 passo.

Na tabela de usuários do CMS, **Redefinir verificação em duas etapas**
(`DELETE /api/admin/users/:uid/mfa`) e **Desativar ou ativar conta**
(`PUT /api/admin/users/:uid { disabled }`) são oferecidos para quem detém
`users:write`, conforme as rotas exigem; a opção de desativação nunca é oferecida para a sua própria
conta, e uma tentativa em uma conta com privilégios superiores aos seus é recusada com a justificativa do servidor.

Defina `MFA_ENCRYPTION_KEY` (32+ caracteres aleatórios) para criptografar os segredos
TOTP armazenados. Sem ela, o servidor recorre ao `JWT_SECRET` e emite um aviso. Defina-a
**antes** que qualquer pessoa se registre: segredos armazenados não contêm identificador de chave, portanto alterar a chave
posteriormente tornará os fatores existentes indecifráveis e seus proprietários incapazes de
concluir um desafio.

### Convidando membros de equipe por e-mail

Fluxos de convite precisam transformar um endereço de e-mail em um id de usuário, mas a
coleção `users` é protegida por RLS contra acessos diretos do cliente. Em vez de implementar manualmente uma
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

O endpoint é **exclusivo para usuários autenticados** e retorna apenas `uid`, `displayName`
e `photoURL` — nunca o e-mail, papéis ou metadados do usuário consultado. Ele vem
**desativado por padrão** porque permite que qualquer usuário autenticado verifique quais e-mails possuem
contas; ative-o apenas se a sua experiência de convites exigir.

## Contexto de banco de dados do Row-Level Security (RLS)

O Rebase integra a autenticação da requisição diretamente com o Row-Level Security (RLS) do PostgreSQL. Toda consulta ao banco de dados executada através de um driver com escopo de usuário é executada dentro de uma transação de banco de dados (`db.transaction()`) que define parâmetros de configuração locais à transação:

*   `app.uid` — O ID exclusivo do usuário autenticado (`uid`). O padrão é `'anonymous'` para requisições não autenticadas. O parâmetro anterior `app.user_id` ainda é gravado paralelamente, para compatibilidade com políticas compiladas antes da renomeação.
*   `app.user_roles` — Uma string separada por vírgulas listando os papéis atribuídos ao usuário.
*   `app.is_anonymous` — `'true'` para uma sessão de convidado (login anônimo), `'false'` caso contrário.
*   `app.jwt` — Uma string JSON com as claims personalizadas do token mais `sub`, `roles` e `is_anonymous` (`{"sub": "<uid>", "roles": [...], "is_anonymous": false, …}`).

Esses parâmetros são configurados localmente para a duração da transação usando a função `set_config` do Postgres:
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
*   **`rebase.roles()`** — Retorna a string de papéis separados por vírgula:
    ```sql
    CREATE OR REPLACE FUNCTION rebase.roles() RETURNS text AS $$
        SELECT COALESCE(NULLIF(current_setting('app.user_roles', true), ''), '');
    $$ LANGUAGE sql STABLE;
    ```
*   **`rebase.jwt()`** — Retorna o payload JWT completo como um objeto `jsonb`:
    ```sql
    CREATE OR REPLACE FUNCTION rebase.jwt() RETURNS jsonb AS $$
        SELECT COALESCE(NULLIF(current_setting('app.jwt', true), ''), '{}')::jsonb;
    $$ LANGUAGE sql STABLE;
    ```
*   **`rebase.is_anonymous()`** — Indica se o chamador é um convidado, como `boolean` (`false` quando não definido), permitindo que uma política use `NOT rebase.is_anonymous()`.

Você pode usar esses utilitários diretamente em suas regras de segurança personalizadas ou migrações de banco de dados:
```sql
CREATE POLICY owner_access ON posts
    FOR ALL
    TO public
    USING (author_id = rebase.uid() OR string_to_array(rebase.roles(), ',') && ARRAY['admin']);
```

## Tokens assimétricos e JWKS

Por padrão, os access tokens são assinados com `jwtSecret` (HS256). Isso funciona, mas
significa que qualquer serviço que precise *verificar* um token deve possuir a chave que o *emite*
— assim, um gateway ou edge worker validando uma sessão também pode forjar uma — e
trocar o segredo desconecta todos os usuários de uma só vez.

Configure uma chave de assinatura e o Rebase assinará os access tokens assimetricamente,
publicando a metade pública em **`/.well-known/jwks.json`** para verificação por qualquer
entidade:

```typescript no-verify
auth: {
    jwtSecret: process.env.JWT_SECRET,
    signingKeys: [
        { kid: "2026-08", privateKey: process.env.JWT_PRIVATE_KEY! }
    ]
}
```

Ou através do ambiente, para uma única chave:

```bash
JWT_PRIVATE_KEY="$(cat jwt-key.pem)"
JWT_KEY_ID=2026-08
```

Gere uma chave com:

```bash
openssl genpkey -algorithm EC -pkeyopt ec_paramgen_curve:P-256 -out jwt-key.pem
```

Chaves RSA também funcionam e assinam com `RS256`; chaves EC P-256 assinam com `ES256`. Apenas a chave
privada é configurada — a metade pública é derivada dela, garantindo que o par não apresente
inconsistências. O `jwtSecret` continua sendo obrigatório em ambos os casos: ele ainda assina
os tokens com escopo de uso específico (links de download, MFA pendente, redefinição de senha) que apenas
este servidor lê.

### Rotacionando uma chave

Insira a nova chave primeiro e mantenha a antiga na lista. Novos tokens serão assinados pela
nova chave; tokens já em circulação continuam sendo verificados pela chave antiga até
que expirem, evitando que usuários sejam desconectados.

```typescript no-verify
signingKeys: [
    { kid: "2026-09", privateKey: process.env.JWT_PRIVATE_KEY_NEW! },
    { kid: "2026-08", privateKey: process.env.JWT_PRIVATE_KEY_OLD! }
]
```

Assim que o maior tempo de vida de access token tiver decorrido, remova a entrada antiga. Use
`activeKid` se desejar publicar uma chave antes de começar a assinar com ela.

### Verificando externamente

Os tokens carregam o `kid` da chave de assinatura em seu cabeçalho, que é a forma como o verificador
identifica a chave correta no JWKS e sabe quando realizar uma nova busca após uma
rotação. Qualquer biblioteca padrão faz isso automaticamente — por exemplo, com `jose`:

```typescript no-verify
import { createRemoteJWKSet, jwtVerify } from "jose";

const jwks = createRemoteJWKSet(new URL("https://api.example.com/.well-known/jwks.json"));
const { payload } = await jwtVerify(token, jwks);
```

:::note
Sem nenhuma chave em `signingKeys`, `/.well-known/jwks.json` responde com
`{"keys":[]}` e os tokens continuam usando HS256. Nada muda até que você adicione uma chave.
:::

## Autenticação com chave de serviço

Para comunicação entre servidores (ex.: tarefas cron, serviços externos), configure uma chave de serviço estática:

```typescript
auth: {
    serviceKey: process.env.REBASE_SERVICE_KEY,
    // ...
}
```

Os clientes se autenticam com o cabeçalho `Authorization: Bearer <service-key>`.

### Chave interna por inicialização

Se `REBASE_SERVICE_KEY` não for informada em sua configuração, o Rebase gera automaticamente uma **chave interna por inicialização** aleatória.

Essa chave nunca é gravada em logs e nunca sai do processo. Ela é utilizada pelo singleton do `rebase` para se autenticar contra as próprias APIs do plano de controle do servidor (autenticação, armazenamento, etc.). Isso garante que tarefas administrativas (como enviar um e-mail de boas-vindas ou gerar uma URL de armazenamento) sempre funcionem de forma nativa em desenvolvimento e em produção, sem necessidade de gerenciamento manual de chaves.

### Proteção contra Timing-Attack e requisitos de chave

Para evitar ataques de temporização (timing attacks), o Rebase valida tanto a chave de serviço configurada pelo usuário quanto a chave interna usando comparação de strings em tempo constante (`safeCompare`). A chave de serviço configurada pelo usuário **deve ter pelo menos 32 caracteres**; se uma chave com menos de 32 caracteres for configurada, o Rebase lançará um erro de configuração na inicialização e interromperá a execução de forma segura (fail-closed).

## Próximos passos

- **[Autenticação](/docs/backend/authentication/)** — a configuração da qual essas rotas se originam
- **[Adaptadores de autenticação personalizados](/docs/backend/auth-adapters/)** — substituindo o provedor por trás delas
- **[Regras de segurança (RLS)](/docs/collections/security-rules/)** — o que uma política faz com `rebase.uid()`
- **[Autenticação no SDK tipado](/docs/sdk/authentication/)** — chamando essas rotas a partir do SDK
