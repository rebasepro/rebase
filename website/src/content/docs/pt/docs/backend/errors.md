---
sourceHash: 816748d7e340be51
title: Códigos de erro
sidebar_label: Códigos de erro
description: Todos os códigos de erro que um backend Rebase pode retornar, com seu status HTTP, o que significam e o que fazer a respeito — além do envelope de resposta, X-Request-ID e as regras de details.
---

Toda falha retornada por um backend Rebase usa um único envelope e contém um
`code` estável. O código é o elemento a ser usado em condicionais: a mensagem é escrita para
uma pessoa e pode ser reformulada, o status é compartilhado por dezenas de problemas diferentes,
e o código não é nenhum dos dois.

## O envelope

```json
{
  "error": {
    "message": "Schema drift: table \"posts\" does not exist.",
    "code": "SCHEMA_DRIFT",
    "details": { "dbCode": "42P01" },
    "requestId": "6f1b2f3e-8a0c-4d1b-9c3e-2a5b7c9d1e0f"
  }
}
```

- **`message`** — legível por humanos. Para um `4xx`, é a própria mensagem do servidor; para
  um `5xx`, é deliberadamente genérica, pois o texto subjacente pode citar um
  host, uma role ou o nome de uma coluna.
- **`code`** — um dos valores abaixo. Estável entre versões menores.
- **`details`** — opcional e nunca garantido. Veja as regras abaixo.
- **`requestId`** — presente sempre que a requisição passou pelo middleware de
  request-ID, que abrange todas as rotas sob `basePath`.

### `X-Request-ID`

Toda requisição sob `basePath` recebe um ID: o cabeçalho `X-Request-ID` do chamador
quando este for um UUID; caso contrário, um novo é gerado. Ele é retornado na
resposta como `X-Request-ID`, incluído no envelope de erro como `requestId` e
anexado à linha de log do servidor para aquela requisição.

Essa é a chave de junção. Cite-a em um relatório de bug e um operador poderá encontrar a
linha de log exata que explica a falha, contendo o motivo que nunca foi exibido
ao cliente.

Enviar o seu próprio é como um rastreamento (trace) sobrevive a um salto (hop): um gateway ou um executor de jobs que
encaminha o cabeçalho obtém um único ID em todos os serviços que processaram a requisição.
Um valor inválido é ignorado em vez de rejeitado — não vale a pena falhar uma requisição por conta de
um cabeçalho malformado enviado por um chamador —, portanto, não presuma que o ID enviado é
o mesmo ID recebido. Leia o cabeçalho da resposta.

### O que está em `details`

`details` é diagnóstico, não contratual. Três regras o regem:

1. **Tudo o que uma rota define explicitamente é sempre retornado.** São os próprios
   erros do chamador descritos com precisão: qual campo de filtro era desconhecido,
   qual relação não permite escrita, qual valor não correspondeu ao seu tipo.
2. **Diagnósticos do banco de dados são omitidos em produção.** Quando a falha tem origem
   no Postgres, `details.dbCode` — o SQLSTATE — está sempre presente: ele nomeia
   a classe do problema e não revela nada sobre os dados. `dbMessage`,
   `detail` e `hint` são adicionados apenas quando `NODE_ENV` não for `production`,
   pois o Postgres insere o conteúdo das linhas neles. `23505` relata
   `Key (email)=(a@b.c) already exists.`, o que responderia "esta pessoa
   está cadastrada?" para qualquer endereço que alguém tentasse verificar.
3. **Nunca crie condicionais baseadas em `details`.** Crie condicionais baseadas em `code`. O que está sob
   `details` é apenas o que foi útil para uma pessoa naquele ponto de chamada, e isso muda.

## Lendo um status

| Status | O que diz sobre a requisição |
| --- | --- |
| `400` | Malformada ou solicitando algo que não existe no esquema. Corrija a requisição. |
| `401` | Não autenticado ou a credencial expirou. Faça login ou renove a sessão. |
| `403` | Autenticado, mas não permitido. Tentar novamente com a mesma identidade não ajudará. |
| `404` | Rota, tabela ou linha inexistente — ou uma linha oculta por segurança em nível de linha (RLS). |
| `409` | Um conflito com o estado existente: uma duplicata ou uma escrita concorrente. |
| `413` `415` `422` | O corpo é grande demais, o tipo de mídia está errado ou foi rejeitado semanticamente. |
| `429` | Limite de taxa atingido (rate limited). Aguarde; a mensagem informa por quanto tempo. |
| `500` | O erro está no servidor ou em seu banco de dados, não no chamador. Verifique os logs. |
| `501` | A rota existe, mas esta implantação não pode atendê-la — um recurso desativado ou não configurado. |
| `502` `503` `504` | Uma dependência estava inacessível, não configurada ou muito lenta. |

## Autenticação e contas

| Código | Status | Significado | O que fazer |
| --- | --- | --- | --- |
| `AAL2_REQUIRED` | 403 | A rota requer um segundo fator e a sessão possui apenas um. | Complete o desafio de MFA e tente novamente. |
| `ALREADY_VERIFIED` | 400 | O endereço ou fator já foi verificado. | Nada — o estado desejado já é verdadeiro. |
| `ACCOUNT_OUTRANKS_CALLER` | 403 | A conta que está sendo editada, redefinida ou excluída possui uma role ou escopo que o chamador não possui. `details.beyond` lista quais são. | Peça para alguém que os possua fazer a alteração. |
| `ANONYMOUS_AUTH_DISABLED` | 403 | O login anônimo está desativado neste servidor. | Ative-o ou faça login com uma identidade real. |
| `ANONYMOUS_NOT_ALLOWED` | 403 | Uma sessão de convidado tentou aprovar um login de dispositivo. Um convidado não tem uma conta para vincular a um dispositivo. | Faça login com uma conta e depois aprove-o. |
| `API_KEY_SELF_MANAGEMENT_FORBIDDEN` | 403 | Uma chave de API tentou listar, criar, alterar ou revogar chaves de API, sejam do seu próprio tipo ou pessoais. | Gerencie chaves como uma pessoa com a permissão `keys:write` ou usando a chave de serviço. |
| `AUTH_MIDDLEWARE_MISSING` | 500 | Uma rota protegida foi executada sem nenhum middleware de autenticação Rebase antes dela, portanto a credencial do chamador nunca foi inspecionada. | Monte a aplicação através do roteador de funções em vez de diretamente no seu próprio servidor. |
| `BOOTSTRAP_ANONYMOUS` | 403 | A inicialização (bootstrap) do primeiro administrador foi tentada por um chamador anônimo. | Faça login primeiro. |
| `BOOTSTRAP_COMPLETED` | 403 | O primeiro administrador já existe. | Peça para um administrador existente conceder a role. |
| `BOOTSTRAP_NOT_FIRST_USER` | 403 | O bootstrap é reservado exclusivamente para o primeiro usuário, e este não é o caso. | Peça para um administrador existente conceder a role. |
| `CAPTCHA_FAILED` | 400 | O provedor rejeitou o token de CAPTCHA. | Resolva um novo desafio. |
| `CAPTCHA_REQUIRED` | 400 | A rota requer um token de CAPTCHA e nenhum foi enviado. | Inclua o token. |
| `CHALLENGE_EXHAUSTED` | 401 | Número excessivo de códigos incorretos em um único desafio de MFA. | Inicie um novo desafio. |
| `DEVICE_LOGIN_DECIDED` | 409 | O login de dispositivo já foi aprovado ou negado. Um login só pode ser decidido uma vez. | Inicie um novo login no dispositivo. |
| `DEVICE_LOGIN_EXPIRED` | 410 | O login de dispositivo ultrapassou o limite de dez minutos antes de ser decidido. | Inicie um novo login no dispositivo. |
| `DEVICE_LOGIN_NOT_FOUND` | 404 | Nenhum login de dispositivo possui esse código de usuário. A própria sondagem (polling) do dispositivo responde com os códigos em minúsculas da RFC 8628: `authorization_pending`, `slow_down`, `access_denied`, `expired_token`, `invalid_grant`. | Compare o código com o exibido no dispositivo. |
| `EMAIL_EXISTS` | 409 | Já existe uma conta com esse endereço — no cadastro, na alteração de endereço e ao acessar um link de troca de endereço quando outra conta assumiu o endereço durante a espera. | Faça login ou inicie a redefinição de senha; para troca de endereço, escolha outro endereço. |
| `EMAIL_NOT_CONFIGURED` | 503 | Magic links ou OTP foram solicitados, mas o servidor não possui transporte de e-mail configurado. | Configure o SMTP ou use outro método de login. |
| `EMAIL_NOT_VERIFIED` | 403 | Um login OAuth encontrou uma conta com o mesmo endereço, mas o provedor não verificou esse endereço, portanto ela não foi vinculada. | Faça login usando o método existente e execute `POST /auth/link/<provider>`. |
| `FACTOR_NOT_VERIFIED` | 400 | O fator de MFA foi cadastrado, mas nunca confirmado. | Confirme o fator. |
| `IDENTITY_ALREADY_LINKED` | 409 | Essa identidade OAuth pertence a outra conta. | Faça login com ela ou desvincule-a da outra conta primeiro. |
| `IMPERSONATION_FORBIDDEN` | 403 | Uma requisição enviou `x-rebase-impersonate` e o chamador não tem permissão para executar requisições como outro usuário. Apenas a sessão própria de um administrador conectado pode fazer isso, nunca uma chave de API ou a chave de serviço. | Envie a requisição com a sessão de um administrador ou remova o cabeçalho. |
| `IMPERSONATION_INVALID` | 400 | `x-rebase-impersonate` foi enviado vazio. | Envie o uid do usuário a ser personificado ou remova o cabeçalho. |
| `IMPERSONATION_TARGET_NOT_FOUND` | 404 | `x-rebase-impersonate` não indica nenhum usuário ativo: nenhuma conta possui esse uid ou ela está desativada. | Verifique o uid. |
| `IMPERSONATION_UNAVAILABLE` | 501 | A autenticação deste backend não suporta executar requisições como outro usuário porque seu `AuthAdapter` não possui `resolveUser`. | Implemente `resolveUser` no adaptador ou remova o cabeçalho. |
| `IMPERSONATION_UNSUPPORTED` | 400 | `x-rebase-impersonate` foi enviado para uma rota que não oferece suporte a personificação. Apenas a API de dados e funções customizadas aceitam isso, e o socket realtime aceita `impersonate` em `AUTHENTICATE`. | Envie a requisição sem o cabeçalho. |
| `SIMULATION_FORBIDDEN` | 403 | Uma requisição enviou um cabeçalho `x-rebase-simulate-*` (o simulador de RLS) ou chamou `/api/admin/rls-simulator`, e o chamador não pode simular acesso. Apenas a sessão própria de um administrador conectado pode fazer isso, nunca uma chave de API ou a chave de serviço. | Envie a requisição com a sessão de um administrador ou remova os cabeçalhos. |
| `SIMULATION_INVALID` | 400 | A simulação estava malformada: um cabeçalho enviado vazio, `x-rebase-simulate-api-key-id` combinado com uma role ou user id, ou simulação combinada com `x-rebase-impersonate`. | Especifique uma role (opcionalmente com um uid), um user id ou um id de chave de API. |
| `SIMULATION_READ_ONLY` | 403 | Uma escrita, exclusão, `_batch`, reversão de histórico ou uma função customizada chamada por qualquer verbo diferente de `GET`/`HEAD`/`OPTIONS` continha um cabeçalho `x-rebase-simulate-*`. O acesso simulado é somente leitura: a escrita seria executada como a identidade simulada, não como o administrador. Leituras, incluindo `POST …/query` e `…/count`, continuam funcionando. | Encerre a simulação para fazer alterações. |
| `SIMULATION_TARGET_NOT_FOUND` | 404 | A simulação não indica nenhum usuário ativo (um user id enviado sem role) ou nenhuma chave de API válida. | Verifique o id ou envie uma role junto com o uid para simular um uid sem conta associada. |
| `SIMULATION_UNAVAILABLE` | 501 | Este backend não pode simular acesso: seu `AuthAdapter` não possui `resolveUser` para validar um administrador, ou uma chave foi especificada em um backend sem chaves de API. | Implemente `resolveUser` ou remova os cabeçalhos. |
| `SIMULATION_UNSUPPORTED` | 400 | Um cabeçalho `x-rebase-simulate-*` foi enviado para uma rota que não oferece suporte a acesso simulado. Apenas a API de dados e funções customizadas aceitam esses cabeçalhos. | Envie a requisição sem os cabeçalhos. |
| `GUEST_REFERENCED` | 409 | Um convidado não pôde ser excluído porque uma linha do próprio projeto depende dele, por meio de uma chave estrangeira com `ON DELETE RESTRICT` ou `NO ACTION`. `DELETE /api/admin/guests` relata isso por convidado em `skipped` e continua o processo. | Exclua a linha ou mantenha o convidado. |
| `INVALID_ACCOUNT` | 400 | A conta está em um estado sobre o qual esta operação não pode atuar. | Consulte a mensagem. |
| `INVALID_CHALLENGE` | 400 | O desafio de MFA é desconhecido ou expirou. | Inicie um novo. |
| `INVALID_CODE` | 400 / 401 | O código OTP ou de MFA está incorreto: 400 para login por código de e-mail (`/auth/otp/verify`), 401 para cadastro ou desafio de MFA. | Tente novamente com o código atual. |
| `INVALID_CREDENTIALS` | 401 | E-mail ou senha incorretos — deliberadamente sem especificar qual deles. | Tente novamente ou redefina a senha. |
| `INVALID_PLATFORM_TOKEN` | 401 | Um token de plataforma `rpt_` foi recusado: assinatura inválida, audiência incorreta, expirado ou tempo de vida acima do limite máximo. A mensagem informa o motivo. | Solicite à plataforma a geração de um novo — no Rebase Cloud, execute o comando novamente. |
| `INVALID_SCOPES` | 400 | Uma chave solicitou algo que não é um escopo: malformado, desconhecido ou com um alvo não aceito pelo escopo. `details.problems` diz qual e por quê; `details.validScopes` lista os escopos que uma chave pode possuir. Não inclui `keys:read` e `keys:write`, que nenhuma chave pode ter. | Use um nome da lista. Veja [Roles and scopes](/docs/backend/roles-and-scopes/). |
| `INVALID_TOKEN` | 400 / 401 | Um token de verificação, redefinição, magic-link ou alteração de endereço está malformado, desconhecido, já utilizado ou expirado (400). Uma credencial de provedor OAuth ou token de atualização que falha na validação resulta em 401. | Solicite um novo link ou faça login novamente. |
| `INVALID_USER_CODE` | 400 | O valor enviado como código de login de dispositivo não é válido: deve ter oito letras, como `BCDF-GHJK`. | Copie o código exibido no dispositivo. |
| `INVALID_ROLE` | 400 | O nome de uma role informado não é uma string, está vazio ou contém `,` `{` `}` `"` `\` ou caracteres de controle. Esses caracteres seriam lidos de volta como outras roles: uma role trafega em um `text[]` do Postgres e na lista separada por vírgulas dividida pelas políticas de RLS, portanto `"support,admin"` retornaria como `admin`. `details.problems` detalha cada caso. | Renomeie a role. Qualquer outro nome é aceito. |
| `KEY_MANAGEMENT_SCOPE` | 400 | Foi solicitado `keys:read` ou `keys:write` para uma chave. Nenhuma chave pode gerenciar chaves. `details.scopes` lista quais foram informados. | Remova esses escopos. |
| `KEY_OUTRANKS_CALLER` | 403 | Um detentor de `keys:write` tentou alterar ou revogar uma chave de serviço que possui uma role ou escopo que ele não possui. Apenas um admin pode gerenciar qualquer chave. `details.roles` e `details.scopes` informam o que a chave possui além do chamador. | Peça a um administrador ou a alguém que possua essas permissões para alterar a chave. |
| `LAST_ADMIN` | 403 | A alteração deixaria o projeto sem administradores. | Promova outro usuário primeiro. |
| `MFA_REQUIRED` | 401 | A senha estava correta e a conta possui um segundo fator verificado, portanto o login está apenas pela metade. `details` contém um token de curta duração restrito ao desafio de MFA — não é uma sessão. | Abra um desafio e responda a ele; a resposta do desafio emitirá a sessão. |
| `NO_SESSION` | 401 | Nenhum cookie de sessão ou refresh token foi apresentado. Normal no primeiro carregamento de página. | Faça login. |
| `NOT_ANONYMOUS` | 400 | Uma rota de upgrade de conta anônima foi chamada por uma conta real, ou `DELETE /api/admin/guests/:uid` informou uma conta real. | Nada para atualizar. Para excluir uma conta, use `DELETE /api/admin/users/:uid`. |
| `OAUTH_ERROR` | 401 | O provedor OAuth recusou o pedido ou retornou um erro. | Tente o fluxo novamente; a mensagem contém o motivo informado pelo provedor. |
| `PERSONAL_KEYS_DISABLED` | 403 | Chaves de API pessoais estão desativadas neste backend. | Defina `personalKeys: true` nas opções de `auth` da tabela de autenticação (`defineAuthTable`). |
| `PERSONAL_KEY_NEEDS_ACCOUNT` | 403 | A chave de serviço ou uma sessão de convidado tentou acessar as rotas de chaves pessoais. Nenhuma delas possui uma conta para a qual a chave possa atuar. | Faça login em uma conta ou crie uma chave de serviço em `/api/admin/api-keys`. |
| `PLATFORM_TOKENS_OFF` | 401 | Um token de plataforma `rpt_` chegou a um servidor que não os aceita: `REBASE_PLATFORM_TOKEN_KEY` e `REBASE_PLATFORM_TOKEN_AUDIENCE` não estão definidos. | A plataforma que hospeda o aplicativo define ambos ao implantar; realize uma nova implantação ou faça login de outra forma. |
| `RATE_LIMITED` | 429 | Número excessivo de tentativas vindas deste chamador. | Aguarde; a mensagem informa por quanto tempo. |
| `REDIRECT_URI_NOT_ALLOWED` | 400 | O destino do redirecionamento não está na lista de permissões (allowlist). | Adicione-o à configuração do provedor. |
| `REGISTRATION_DISABLED` | 403 | O autocadastro está desativado. | Peça para um administrador criar a conta. |
| `ROLE_EXCEEDS_CALLER` | 403 | As roles que estão sendo concedidas contêm um escopo, ou `admin`, que o chamador não possui. `details.beyond` lista quais são. | Peça a alguém que os possua para conceder a role. |
| `ROLE_EXCEEDS_CREATOR` | 403 | Uma chave de serviço recebeu uma role de RLS que seu criador não possui. Apenas um admin pode conceder qualquer role. `details.roles` informa quais são. | Remova a role ou peça para um administrador criar a chave. |
| `ROLE_EXISTS` | 409 | Esse nome de role já está em uso. | Escolha outro nome. |
| `ROLE_LOOKUP_FAILED` | 503 | Não foi possível consultar as roles do chamador — em uma rota de admin ou em uma requisição de dados em um backend com `config.auth`. O sistema bloqueia preventivamente em vez de confiar nas roles contidas no token. Um token cujo uid não referencia nenhuma conta (incluindo um uid não suportado pela tabela de usuários) gera 401, não este erro. Um banco de dados inacessível resulta em `DATABASE_UNAVAILABLE`. | Tente novamente; verifique o banco de dados. |
| `SCOPE_EXCEEDS_CREATOR` | 403 | Uma chave solicitou um escopo que seu criador não possui. Uma chave nunca possui mais privilégios do que a conta que a gerou. `details.scopes` lista quais são. | Remova-os ou solicite a criação da chave a alguém que os possua. |
| `SCOPE_MISSING` | 403 | A credencial não possui o escopo exigido por esta rota, tabela, fonte de storage ou função. `details.requiredScope` informa o escopo necessário, incluindo o alvo. | Para usuários, utilize uma role que declare o escopo. Para chaves, utilize uma chave que o contenha. Veja [Roles and scopes](/docs/backend/roles-and-scopes/). |
| `SCOPE_NOT_DECLARED` | 500 | Uma rota protegida por `requireScope` especifica um escopo de aplicativo que este backend não declara, portanto ninguém o possui, nem mesmo administradores. Nomes inválidos ou com erros de digitação em escopos integrados (como `data:raed`) nunca chegam a este estágio: `requireScope` gera erro no momento em que a rota é registrada. | Declare o escopo sob `auth.scopes` na tabela de autenticação ou corrija o nome. Veja [Roles and scopes](/docs/backend/roles-and-scopes/). |
| `SELF_DELETE` | 400 | Um administrador tentou excluir a própria conta. | Peça para outro administrador realizar a exclusão. |
| `SESSION_REVOKED` | 401 | A sessão foi encerrada em outro lugar, todas as sessões foram revogadas ou a conta foi excluída. Todas as portas de entrada que exigem sessão respondem com este código para esse token de acesso: a API de dados, storage, funções customizadas e as rotas de administração. O socket realtime rejeita seu `AUTHENTICATE` com um frame `AUTH_ERROR` contendo o mesmo código. O SDK tenta renovar, a renovação é recusada e ele encerra a sessão. | Faça login novamente. |
| `ACCOUNT_DISABLED` | 401/403 | Um administrador desativou a conta: login (403), renovação de token e qualquer token emitido para ela (401) são recusados em todas as entradas que requerem sessão. O socket realtime rejeita seu `AUTHENTICATE` com um frame `AUTH_ERROR` contendo o mesmo código. | Contate um administrador. |
| `EMAIL_NOT_CONFIRMED` | 403 | `requireEmailVerification` está ativado e o endereço ainda não foi verificado. Retornado apenas mediante o fornecimento da senha correta; um novo link é enviado por e-mail. | Acesse o link enviado por e-mail. |
| `PROOF_REQUIRED` | 409 | `POST /auth/verify-email`: a conta possui uma senha ou identidade que ninguém comprovou, e a requisição não comprova nenhuma das duas. O token não é invalidado. | Envie `password` para mantê-la ou `removeUnproven: true` para verificar sem ela. |
| `UNDELIVERABLE_ADDRESS` | 400 / 409 | Foi solicitado um e-mail de verificação para um endereço inacessível — endereço de convidado ou o placeholder do X (400) — ou uma conta solicitou alteração para tal endereço (409, `POST /auth/change-email`). | Defina um endereço real primeiro. |
| `EMAIL_UNCHANGED` | 400 | `POST /auth/change-email` informou o endereço atual da conta. | Nada a alterar. |
| `ANONYMOUS_USER` | 403 | Um convidado solicitou alteração de e-mail; convidados não possuem endereço de e-mail próprio. | Converta-o em uma conta real primeiro (`POST /auth/anonymous/link`). |
| `MFA_NOT_ENROLLED` | 400 | Códigos de recuperação foram solicitados para uma conta sem um segundo fator verificado. | Cadastre um fator primeiro. |
| `HOOK_REJECTED` | 400 | Um hook `beforeUserCreate`, `beforeLogin`, `beforeUserDelete` ou `beforeEmailChange` lançou um erro. A mensagem é a do próprio hook; um hook que selecionou um status 4xx responde com ele. | Consulte a mensagem. |
| `INVALID_JSON` | 400 | O corpo da requisição não é um JSON válido. | Envie um corpo no formato JSON. |
| `SELF_DISABLE` | 400 | Um administrador tentou desativar a própria conta. | Peça a outro administrador para desativá-la. |
| `NOT_SUPPORTED` | 501 | O repositório de autenticação deste backend não suporta a operação solicitada (desativar contas, alterar endereço). | Reinicie o servidor para que a coluna seja adicionada ou utilize um repositório compatível. |
| `UNKNOWN_SCOPE_TARGET` | 400 | O alvo de um escopo especifica uma tabela, fonte de storage ou função que este backend não atende. `details` lista os alvos disponíveis. | Corrija o alvo. |
| `UNVERIFIED_IDENTITIES` | 409 | Um magic link, código por e-mail ou redefinição de senha comprovou o endereço de uma conta não verificada, mas a conta possui uma identidade de login cujo provedor nunca validou esse endereço. Como o repositório de autenticação não pode removê-la (não possui `unlinkUserIdentity`), a validação é recusada para evitar deixar essa brecha em uma conta verificada. | Implemente `unlinkUserIdentity` no repositório de autenticação customizado ou solicite a revisão da conta por um admin. |
| `SETUP_REQUIRED` | 403 | O projeto ainda não possui administradores, portanto esta rota não está disponível. | Conclua a configuração do primeiro administrador. |
| `TOKEN_ALREADY_USED` | 401 | Um token de uso único foi reutilizado, ou um refresh token rotacionado há mais de `refreshTokenReuseIntervalSeconds` foi apresentado. | Solicite um novo ou faça login novamente. |
| `TOKEN_EXPIRED` | 401 | O tempo de vida do token expirou. | Solicite um novo. |
| `USER_NOT_FOUND` | 404 | Nenhuma conta encontrada com esse id. | Verifique o id. |
| `WEAK_PASSWORD` | 400 | A senha não atende à [política de senhas](/docs/backend/auth-endpoints/#password-policy) (por padrão, 8+ caracteres contendo letra maiúscula, letra minúscula e número) — no cadastro, redefinição, alteração ou definição manual por um admin: `POST /api/admin/users`, criação na tabela de autenticação via API de dados, `PUT /api/admin/users/:id` ou `POST /api/admin/users/:id/reset-password`. | Escolha uma senha mais forte. Um administrador importando contas pode enviar `skipPasswordPolicy: true` na criação. |

## Dados, consultas e escritas

| Código | Status | Significado | O que fazer |
| --- | --- | --- | --- |
| `AGGREGATE_MASKED_BY_AFTER_READ` | 400 | Uma agregação diferente de `count()` sem `groupBy` em uma tabela reescrita por um hook `afterRead` (global, de tabela ou `.transform()` de coluna). Agregações leem valores brutos armazenados e nunca executam o hook, portanto soma, mínimo, máximo, contagem de campo ou agrupamento leriam o que o hook mascara. | Use `count()` sem `groupBy` ou leia as linhas diretamente, que passam pelo hook. |
| `AGGREGATE_NOT_SUPPORTED` | 501 | Este driver não consegue calcular a agregação solicitada. | Use um driver compatível ou calcule-a no cliente. |
| `BRANCHING_UNSUPPORTED` | — | Foi solicitada a criação de um branch de banco de dados via websocket do Studio no banco de desenvolvimento gerenciado (PGlite), onde um branch *é* o pai e nada seria isolado. A recusa é a mesma impressa por `rebase db branch`. | Aponte `DATABASE_URL` para uma instância própria do Postgres (`rebase dev --docker` inicia uma) e crie branches nela. |
| `BATCH_TOO_LARGE` | 400 | `POST /api/data/_batch` contém mais operações do que o limite por lote (1000 por padrão). Um lote forma uma única transação e mantém seus bloqueios (locks) durante toda a execução. | Envie em partes menores; a mensagem especifica o limite e a quantidade enviada. |
| `BATCH_UNSUPPORTED` | 400 | O driver deste backend não oferece suporte a escritas atômicas entre tabelas, e um loop de escritas individuais não seria atômico nem executado em um único round-trip. | Envie as escritas como requisições separadas ou através de chamadas `/bulk` por tabela. |
| `BULK_TOO_LARGE` | 400 | O corpo da requisição bulk excede o limite configurado de itens. | Divida a requisição. |
| `BULK_UNSUPPORTED` | 400 | Esta tabela ou driver não oferece suporte a escritas em lote (bulk). | Escreva as linhas uma por vez. |
| `CALLBACK_REJECTED` | 400 / 403 | Um hook de tabela recusou a escrita. Um `throw` em `beforeSave`/`beforeDelete`/`after*` resulta em 400 com a mensagem definida pelo autor; um `beforeDelete` que retorna `false` resulta em 403. `details.stage` identifica o hook, `details.path` indica a tabela. | Leia a mensagem — ela foi escrita por este projeto, não pelo Rebase. |
| `CALLBACK_RECURSION` | 500 | Escritas iniciadas por hooks atingiram profundidade maior que 16: a escrita `context.data` de um hook aciona os hooks daquela tabela novamente, e nada na cadeia interrompe o ciclo — geralmente um `afterSave` atualizando incondicionalmente sua própria linha. A escrita inteira foi revertida (rollback). A mensagem indica o hook e a tabela; `details.chain` lista cada etapa hook → escrita. | Torne a escrita do hook condicional: atue apenas em `status === "new"` ou ignore quando `values` já contiverem o que seria gravado. |
| `TABLE_READ_ONLY` | 405 | Uma escrita foi direcionada a uma view (`defineView`). Uma view é somente leitura. Anteriormente `COLLECTION_READ_ONLY`. | Escreva nas tabelas lidas pela view. Veja [Views](/docs/collections/views/). |
| `TABLE_WITHHELD` | 503 | A tabela está declarada, mas o banco de dados não a protege: RLS está desativado, nenhuma das políticas declaradas está presente ou falta uma política restritiva declarada. (Políticas permissivas ausentes ainda são atendidas, emitindo um aviso na inicialização). Ocorre quando o servidor não provisiona suas tabelas (`REBASE_PROVISION=false`, `provisionSchema: false`, `provision.tables: false`, `REBASE_MIGRATE_ON_BOOT=none`), retendo a tabela para não expor todas as linhas a todos os chamadores. Junções many-to-many seguem a mesma regra: se falharem, tabelas cujas relações dependem dela são retidas com menção à junção na mensagem; o mesmo vale para tabelas cujo `via` atravesse uma tabela retida. Leituras de relação ou filtros que passem por tabelas retidas também recebem este código. As demais tabelas continuam funcionando. O log de inicialização informa os comandos para protegê-la. | Execute os comandos indicados no log de inicialização (como faz `rebase db push`) e reinicie. |
| `SQL_NOT_ALLOWED` | 400 | O SQL executado como o chamador (`getSql(c)`, `withAuth(user).sql`) não consistia em uma única instrução `SELECT`, `WITH`, `VALUES`, `TABLE`, `INSERT`, `UPDATE`, `DELETE` ou `MERGE`, ou chamou `set_config` ou mencionou `pg_settings`. A identidade do chamador reside nas configurações da sessão, portanto comandos que possam alterá-las são recusados. | Mantenha a consulta simples, em uma única instrução, passando todos os valores via `params`. Veja [Custom functions](/docs/backend/custom-functions/#3-getsqlc--sql-as-the-caller). |
| `CURSOR_WITH_OFFSET` | 400 | `?after=` foi combinado com `?offset=` ou `?page=`. Um cursor já especifica onde a página começa, de modo que aplicar offset sobre ele pula silenciosamente linhas além do cursor — uma lacuna invisível na resposta. | Use apenas um ou outro. |
| `DISTINCT_NOT_APPLICABLE` | 400 | `?distinct=true` foi combinado com busca textual ou vetorial. Ambas atribuem uma pontuação (score) por linha, o que faz com que nenhuma linha seja estritamente igual e o `DISTINCT` não consiga agrupar nada — pareceria ter funcionado sem mudar nada. | Remova um dos parâmetros. |
| `DISTINCT_ORDER_BY_NOT_SELECTED` | 400 | Uma leitura com `distinct` está ordenada por uma coluna que não é retornada. Um `SELECT DISTINCT` só pode ser ordenado por colunas presentes na lista de seleção; caso contrário, as linhas agregadas não teriam ordem definida. `details.fields` indica quais são. | Adicione esses campos a `?fields=` ou remova-os de `?orderBy=`. |
| `DATABASE_UNAVAILABLE` | 503 | Não foi possível conectar ao banco de dados: conexão recusada ou perdida, falha na resolução do host, servidor iniciando/desligando ou banco fechado para novas conexões (`ALLOW_CONNECTIONS false`, deixado no banco de origem quando um `rebase db branch create --force` é interrompido no meio; o log do servidor indica o banco, e `rebase db branch list` o reabre). Retornado em todos os pontos de entrada: login, rotas de admin e socket realtime (frame `ERROR`). Acompanhado de `Retry-After: 5`. | Tente novamente; o SDK faz isso automaticamente. Verifique se o banco está em execução e acessível a partir do servidor. |
| `DB_CONNECTIONS_EXHAUSTED` | 503 | O servidor de banco de dados recusou uma nova conexão por ter atingido o limite (`53300` muitos clientes, `53400` limite de conexão da role ou do banco). Como todas as instâncias compartilham o `max_connections` do servidor, isso ocorre em ambientes com várias instâncias, pools grandes e sem pooler. É sobrecarga, não falha técnica; enviado com `Retry-After: 2`. O servidor registra a solução no log uma vez por minuto. | Tente novamente; o SDK faz isso automaticamente. Reduza `DB_POOL_MAX` (ou limite via `REBASE_DB_POOL_MAX`) entre as instâncias, coloque um pooler na frente do banco (`DATABASE_POOLED`) ou aumente `max_connections`. |
| `DB_CONNECT_TIMEOUT` | 503 | A abertura de uma nova conexão levou mais tempo do que `DB_POOL_CONNECT_TIMEOUT`: o banco está lento para aceitar conexões ou distante fisicamente. Enviado com `Retry-After`. | Tente novamente; o SDK faz isso automaticamente. Verifique a carga do banco e a qualidade da rede. |
| `DB_PERMISSION_DENIED` | 500 | O Postgres recusou a instrução (`42501`): violação de política de RLS para esta role ou ausência de `GRANT`. | Veja [Troubleshooting](/docs/troubleshooting/). |
| `DB_POOL_EXHAUSTED` | 503 | Todas as conexões do pool permaneceram ocupadas por `DB_POOL_CONNECT_TIMEOUT`, impedindo que esta requisição chegasse ao banco. Sobrecarga, não falha técnica; enviado com `Retry-After`. O servidor registra a solução no log uma vez por minuto. | Tente novamente; o SDK faz isso automaticamente. Aumente `DB_POOL_MAX` ou localize consultas lentas e transações longas que estejam prendendo conexões. |
| `FIELD_NOT_READABLE` | 400 | Um filtro, `orderBy`, `fields`, `select` de agregação ou `groupBy` referencia um campo que as roles deste chamador não podem ler (`access.read`), um caminho aninhado ou ordenação agregada referencia uma relação sem permissão de leitura — ou uma operação de campo (`$inc`, `$push`, …) tem como alvo tal campo, onde uma recusa de limite revelaria o valor armazenado. Nenhum campo ausente na resposta pode ser interrogado por consulta, evitando que seu valor seja inferido predicado por predicado. Filtros por relação (`author.salary`) e ordenação agregada sobre campos de relação (`max(staff.salary)`) são avaliados pela regra do destino. `details.violations` indica cada campo. O driver aplica a mesma regra a leituras feitas em processo em nome de um chamador (`context.data` sob o escopo do chamador), além de buscas vetoriais, includes ou testes de unicidade. Colunas `.private()` comportam-se como inexistentes: qualquer menção em filtros, ordenação ou agregação retorna o mesmo erro de campo incorreto (`UNKNOWN_FILTER_FIELD`, etc.). | Remova o campo da consulta ou obtenha a role necessária. Veja [Field access](/docs/collections/field-access/). |
| `FIELD_NOT_WRITABLE` | 400 / 403 | O corpo define um campo que as roles deste chamador não podem escrever (`access.write`). A requisição é recusada em vez de ignorar o campo: descartá-lo reportaria sucesso para uma edição que não foi feita. O mesmo código recusa escritas via entidade pai definindo uma relação na qual o chamador não pode escrever, bem como updates atribuindo valor a campos com `softDelete` — apenas exclusões podem preenchê-los. O socket realtime retorna 403 com este código para escritas em caminhos aninhados cuja tabela pai, relação ou tabela de destino não sejam atendidas ali, em vez de repassar diretamente ao driver. `details.violations` lista os campos. | Remova o campo ou obtenha a role necessária. Campos nos quais ninguém tem permissão de escrita retornam `VALIDATION_EXCLUDED_FIELDS`. |
| `FILTERED_USER_WRITE` | 400 | Um update ou delete com filtro foi enviado para a tabela de autenticação via HTTP, cujas escritas são validadas usuário por usuário antes de serem executadas. | Leia os usuários e aplique `updateMany`/`deleteMany` por id. |
| `FILTER_REQUIRED` | 400 | Uma escrita com filtro (update ou delete por `where`/`logical`, do SDK ou de rotas bulk) não possui condições, afetando todas as linhas da tabela. A operação é barrada antes da execução. | Adicione uma condição. Se a intenção for realmente alterar todas as linhas, utilize uma condição universalmente verdadeira. |
| `HISTORY_UNAVAILABLE` | 503 | Uma escrita em tabela com `history: true` foi recusada porque o histórico não pôde ser gravado: a tabela `rebase.entity_history` não existe ou, para `openRebase` e `rebase console`, a função `rebase.record_history` está ausente. Nenhum backend com histórico foi iniciado neste banco. Nada foi executado (inclusive hooks), mas leituras continuam funcionando. Lançado por `openRebase` e retornado por backends criados com `provision: false`. | Inicie o backend ao menos uma vez com histórico ativado e `provision: true` (como faz `rebase dev`) e tente novamente. |
| `HISTORY_UNSERVABLE` | 501 | O driver de dados da tabela não suporta a execução de regras de leitura e hooks `afterRead` sobre linhas armazenadas (`DataDriver.serveStoredRows`), e o histórico nunca é fornecido sem máscaras. O driver Postgres integrado oferece esse suporte. | Implemente `serveStoredRows` no driver customizado. Veja [History](/docs/backend/history/). |
| `IDEMPOTENCY_KEY_IN_PROGRESS` | 409 | Uma requisição anterior com a mesma chave `Idempotency-Key` ainda está em execução. | Aguarde a conclusão e tente novamente. |
| `IDEMPOTENCY_KEY_REUSED` | 422 | A mesma `Idempotency-Key` foi reutilizada em uma requisição diferente: outro método, rota, query string ou corpo. | Use uma nova chave ou repita a requisição original de forma idêntica. |
| `INVALID_AGGREGATE_FUNCTION` | 400 | `?select=` especificou uma função que não é de agregação (`count`, `sum`, `avg`, `min`, `max`, `countDistinct`, `mode`, `percentile`, `distinct`, `fingerprint`). | Use uma dessas opções; a mensagem lista as disponíveis. |
| `INVALID_AGGREGATE_GROUP` | 400 | Uma transformação `groupBy` é desconhecida ou incompatível com a coluna: `year`/`month`/`day` em coluna que não é data, ou `unnest` em coluna que não é array. | Use `lower`, `upper`, `year`, `month`, `day` ou `unnest` em colunas do tipo adequado. |
| `INVALID_AGGREGATE_SELECT` | 400 | O formato de `?select=` não é `fn(campo)`; uma função diferente de `count()` ou `fingerprint()` não recebeu nenhum campo; `percentile` não possui uma fração entre 0 e 1; ou `fingerprint()` foi solicitado em uma view comum, que não armazena linhas. | Escreva no formato `sum(total)`, `count()`, `percentile(price,0.95)`. |
| `INVALID_AGGREGATE_WINDOW` | 400 | Uso de `offset`, `page` ou `orderBy` em agregação sem `groupBy`, ou cursor em qualquer tipo de agregação. Uma agregação sem agrupamento resulta em uma única linha, e um grupo não é uma linha que permita continuação via cursor. | Adicione `groupBy` ou remova esses parâmetros; pagine grupos com `offset` ou `page`. Veja [Aggregates](/docs/sdk/aggregates-and-search/#aggregates). |
| `INVALID_BATCH_BODY` | 400 | Uma operação em `/_batch` não possui `op`, `table`, `values` ou `id`, referencia uma tabela não atendida ou reutiliza um identificador `ref`. | Consulte a mensagem; ela indica a operação pelo índice. |
| `INVALID_BATCH_REF` | 400 | Um `{ "$ref": "<name>.<field>" }` referencia uma operação inexistente, aponta para a frente ou solicita um campo que a linha referenciada não contém. Apenas referências retroativas são permitidas. | Defina a operação com `ref` *antes* de referenciá-la. |
| `INVALID_BULK_BODY` | 400 | O corpo da requisição bulk não segue o formato esperado. | Envie o array exigido pela rota: `{ "rows": [...] }` para `POST /bulk`, `{ "updates": [{ "id", "data" }] }` para `PATCH /bulk`, `{ "ids": [...] }` para `POST /bulk/delete`. |
| `INVALID_CONFLICT_RULE` | 400 | A regra de conflito de um upsert (manter duplicatas ou substituir apenas com `where`) foi enviada sem `upsert: true`, ou ambas as regras foram enviadas simultaneamente. | Envie `upsert: true` e apenas uma das duas regras. |
| `INVALID_CONFLICT_TARGET` | 400 | O parâmetro `on_conflict` / `onConflict` de um upsert aponta para colunas sem garantia de unicidade, é enviado sem `upsert: true`, ou é usado em uma criação aninhada (onde a linha correspondente seria movida para o novo pai). O Postgres geraria o erro 42P10 durante uma transação já iniciada. Também se aplica a qualquer upsert na tabela de autenticação, onde criação e edição seguem regras distintas. | Declare `.unique()` na coluna ou crie um índice `unique`; a mensagem lista os alvos válidos. Na tabela de usuários, envie `POST` para criar e `PATCH` para atualizar. |
| `INVALID_COUNT` | 400 | `?count=` não é `exact` nem `none`. Rejeitado em vez de assumir o padrão: um erro de digitação como `?count=nnone` pagaria pelo custo de contagem que pretendia ignorar. | Envie `exact` (padrão) ou `none`. Veja [Skipping the count](/docs/backend/api/#skipping-the-count). |
| `INVALID_CURSOR` | 400 | O cursor `after` não pôde ser decodificado ou contém um id incompatível com as colunas-chave da tabela: foi truncado, alterado ou gerado manualmente. Um cursor válido enviado com um `orderBy` diferente daquele sob o qual foi emitido resulta em `CURSOR_ORDER_MISMATCH` (também 400). | Repasse o valor `meta.nextCursor` da página anterior sem alterações, mantendo o mesmo `orderBy` ou nenhum. Veja [Pagination](/docs/sdk/pagination/). |
| `INVALID_DELETED_PARAM` | 400 | `?deleted=` não é `include` nem `only`. Rejeitado para evitar erros: `?deleted=true` digitado por engano ocultaria linhas ativas de forma silenciosa, parecendo funcionar mas respondendo o oposto do pretendido. | Envie `include` (ativas e excluídas) ou `only` (apenas excluídas). Omita para obter apenas linhas ativas. |
| `INVALID_DISTINCT` | 400 | `?distinct=` não é `true` nem `false`. | Envie um desses valores; `1` e `0` também são aceitos. |
| `INVALID_FIELD_OPERATION` | 400 | Um operador `$inc` / `$push` / `$pull` / `$merge` foi usado em tipo de coluna incompatível, com operando malformado, múltiplos operadores no mesmo campo, nome com erro de digitação ou em operação de criação (onde não há valor anterior). | Veja [Writing over REST](/docs/backend/writes/#field-operations); a mensagem indica o campo. |
| `INVALID_FILTERED_WRITE` | 400 | Uma escrita com filtro foi direcionada a um caminho de relação (`posts/1/comments`) ou a nenhuma tabela. | Escreva diretamente na tabela relacionada usando um filtro em sua chave de ligação. |
| `INVALID_FILTER_FIELD` | 400 | O filtro especifica uma coluna inexistente nesta tabela. | Verifique a ortografia do nome em relação à tabela. |
| `INVALID_FILTER_OPERATOR` | 400 | O operador não é suportado pelo tipo de coluna — por exemplo, usar `like` em números ou datas. | Veja [Querying data](/docs/sdk/querying/). |
| `INVALID_FILTER_VALUE` | 400 | O valor do filtro não pode ser convertido para o tipo da coluna comparada: `?id=eq.abc` em chave inteira, valor fora do enum, timestamp inválido ou número fora do intervalo. `details.dbCode` contém o SQLSTATE correspondente. | Envie um valor compatível com o tipo da coluna. |
| `INVALID_HARD_PARAM` | 400 | `?hard=` não é `true` nem `false`. Qualquer outro valor é recusado em vez de interpretado como falso — um erro de digitação que fizesse soft-delete quando o chamador pediu purge faria acreditar que os dados foram apagados permanentemente. | Envie `true` ou `false`. |
| `INVALID_INCLUDE` | 400 | `?include=` malformado: lista de caminhos inválida ou objeto de opções por relação fora do formato esperado. Caminhos com mais de três saltos retornam `INCLUDE_TOO_DEEP` (também 400). Tratado na borda para não vazar erro 500 do driver. | Consulte a mensagem; ela especifica o caminho com problema. |
| `INVALID_INPUT` | 400 | O corpo da requisição falhou na validação. | Consulte a mensagem. |
| `INVALID_LIMIT` | 400 | `?limit=` não é um número inteiro de 1 até o máximo permitido (1000 por padrão); valores maiores são recusados, não limitados silenciosamente. Assinaturas realtime solicitando limites fora do intervalo recebem o mesmo código via frame `ERROR` do WebSocket. | Reduza o limite e faça paginação dos resultados. |
| `INVALID_LOGICAL_GROUP` | 400 | Um agrupamento `?or=` / `?and=` / `?not=` está malformado ou excede o nível máximo de aninhamento permitido. | Consulte a mensagem; ela explica a regra de nivelamento (flattening). |
| `INVALID_OFFSET` | 400 | `?offset=` não é um número inteiro maior ou igual a 0. | Envie um número inteiro não negativo. |
| `INVALID_ORDER_BY` | 400 | `?orderBy=` diferente de `field`, `field:desc`, `field:desc:last` ou array JSON de `{ field, direction, nulls }` — ou especifica direção diferente de `asc`/`desc` ou posição de nulos diferente de `first`/`last`. | Consulte a mensagem; ela lista as variações aceitas. |
| `INVALID_PAGE` | 400 | `?page=` não é um número inteiro maior ou igual a 1. A paginação tem base 1, portanto `?page=0` é considerado erro e não a primeira página. | Envie `1` ou superior, ou utilize `?offset=`. |
| `INVALID_PARAM` | 400 | Um parâmetro de consulta está malformado. | Consulte a mensagem. |
| `INVALID_QUERY_BODY` | 400 | O corpo de `POST …/query` contém um formato não suportado na URL: lista para parâmetro de leitura única (`fields`, `limit`, …), objeto para filtro, ou parâmetros duplicados na URL — um `POST …/query` lê todos os parâmetros a partir do corpo. | Especifique os valores como na URL — string, ou lista para filtros repetidos; `where`, `include`, `orderBy` e `vector` aceitam JSON. Veja [Queries too long for a URL](/docs/backend/vector-search/#queries-too-long-for-a-url). |
| `INVALID_VECTOR` | 400 | `?vector=` não é um array JSON de números. | Envie no formato `[0.1,0.2,0.3]`. |
| `INVALID_VECTOR_DISTANCE` | 400 | `?vector_distance=` diferente de `cosine`, `l2` ou `inner_product`. | Use uma dessas três métricas. |
| `INVALID_VECTOR_THRESHOLD` | 400 | `?vector_threshold=` não é um número válido. | Envie um valor numérico. |
| `INVALID_WHERE` | 400 | `?where=` não é um objeto JSON mapeando campos para condições. | Envie no formato `{"status":["==","active"]}`. |
| `KEY_IMMUTABLE` | 400 | Um update informa a chave da linha com um valor diferente daquele pelo qual foi endereçada — no corpo ou definido por `beforeSave`. Uma linha não pode mudar de chave: processos subsequentes (releitura, `afterSave`, histórico, realtime) referenciam-na pela chave anterior. Recusado antes da execução de hooks, sem nenhuma alteração no banco. `details.violations` cita o campo. | Crie a linha com a nova chave e exclua a anterior. Manter a chave atual da linha é permitido. |
| `MISSING_AGGREGATE_SELECT` | 400 | A rota de agregação foi acionada sem o parâmetro `?select=`. | Adicione a cláusula, ex.: `?select=count()`. |
| `NOT_A_MATERIALIZED_VIEW` | 400 | `refresh()` foi executado em uma tabela que não corresponde a uma view materializada. | Execute refresh somente em views declaradas com `defineView(…, { materialized: true })`. |
| `NO_TABLES` | 404 | O projeto não possui tabelas: nenhuma declarada em `backend/schema` e nenhuma identificada no banco via introspecção. Quando há tabelas mas o RLS está desativado, a mensagem indica quais são acompanhadas do SQL para ativá-lo, e `details.unprotectedTables` lista-as. Anteriormente `NO_COLLECTIONS`. | Crie as tabelas — por migration, SQL ou arquivo `defineTable` acompanhado de `rebase db push` — e reinicie o servidor. |
| `NOT_FOUND` | 404 | Linha com esse id não encontrada na tabela — ou linha oculta por regras de RLS para este chamador. | Verifique o id e, em seguida, o `rls` da tabela. |
| `UNKNOWN_RELATION` | 400 / 404 | `?include=` indica algo que não é uma relação da tabela. O mesmo código responde com **404** quando informado diretamente no *caminho da URL*, ex.: `/api/data/authors/1/posts` onde `authors` não declara essa relação — nesse caso a URL não encontra recurso correspondente. | Verifique o nome da relação — a mensagem lista as disponíveis na tabela. Relações inversas precisam ser declaradas na entidade pai para permitir navegação. |
| `ORDER_BY_FIELD_NOT_SORTABLE` | 400 | A ordenação especifica um campo que não permite ordenação. | Ordene por uma coluna válida. |
| `PAGE_WITH_OFFSET` | 400 | `?page=` foi combinado com `?offset=` — ou `page` com `offset` em `find()`, combinação rejeitada antecipadamente pelo SDK cliente, `rebase.data` e cliente offline. Ambos definem o mesmo deslocamento, e anteriormente `page` sobrepunha silenciosamente o `offset`. | Envie apenas um dos parâmetros. |
| `PAYLOAD_TOO_LARGE` | 413 | O corpo da requisição ultrapassa o limite configurado. | Envie menos dados ou eleve o limite configurado. |
| `READ_ONLY_TRANSACTION` | 409 | Um hook `afterRead` tentou realizar uma escrita. Leituras com escopo de requisição operam em transações `READ ONLY`, impedindo escritas pelo hook ou qualquer chamada feita por ele. | Remova a escrita do fluxo de leitura: use background jobs ou `rebase.dataAsAdmin` em cron jobs ou funções customizadas. |
| `REFRESH_NOT_SUPPORTED` | 501 | `POST /api/data/<slug>/refresh` acionou um driver sem suporte a views materializadas. | Não há suporte a refresh neste backend. |
| `RELATION_HAS_NO_PIVOT` | 400 | A escrita incluiu payload de vinculação, mas o caminho não alcança o destino via `manyToMany` com `pivot` declarado — impedindo a gravação na linha de junção. | Declare colunas de `pivot` na relação ou remova o payload da escrita. Veja [Relations](/docs/collections/relations/). |
| `RELATION_MISCONFIGURED` | 500 | Uma relação falha na resolução contra o esquema registrado. A operação é recusada: ignorá-la confirmaria falsamente escritas não realizadas ou ocultaria linhas existentes. | Execute `rebase schema generate` se o esquema gerado estiver defasado em relação ao banco de dados. |
| `RELATION_NOT_UNLINKABLE` | 400 | A relação não permite desvinculação a partir deste lado. | Realize a alteração a partir da entidade proprietária da relação. |
| `RELATION_NOT_WRITABLE` | 400 | O caminho aninhado não é uma relação que aceite escrita, ou uma criação/atualização especifica uma relação `via` com múltiplos saltos — somente relações `via` de salto único permitem escrita. `details.fields` lista as chaves `via`. Nada foi gravado. | Escreva diretamente nas tabelas unidas pela cadeia de junção. Veja [Relations](/docs/collections/relations/#via--an-explicit-join-chain). |
| `RELATION_PIVOT_UNSUPPORTED` | 400 | A relação define colunas de junção, mas esta fonte de dados não suporta escrita nelas. | O vínculo em si é criado normalmente; apenas o payload adicional na junção falha. Verifique as capacidades do driver. |
| `RELATION_SOURCE_KEY_EMPTY` | 400 | Escrita de relação sem chave de origem para vincular a referência. | Salve a linha pai primeiro. |
| `RESULT_TOO_LARGE` | — | Uma instrução executada via `EXECUTE_SQL` no socket realtime — como `admin.executeSql` ou leituras de catálogo no painel — retornou mais de 128 MB de linhas, impedindo o envio do resultado. Retornado como frame `ERROR` do WebSocket. Execuções no console SQL do painel não são barradas: exibem as primeiras linhas. | Adicione um `LIMIT` ou selecione menos colunas para ler em partes menores. |
| `ROW_IN_TRASH` | 409 | A chave do upsert coincide com uma linha na lixeira (uma linha sob soft-delete continua ocupando sua chave). Operações de upsert não sobrescrevem linhas excluídas em nenhuma porta de entrada: REST `?on_conflict=`, rotas `/bulk` e `/_batch`, SDK e socket realtime. Nada foi gravado. | Restaure a linha antes (atualizando o campo de soft-delete para `null`) ou purgue-a com `?hard=true` antes do upsert. Veja [Soft delete](/docs/collections/soft-delete/). |
| `SCHEMA_DRIFT` | 500 | Uma tabela ou coluna esperada pelo código não existe no banco de dados. | Execute `rebase db push` em desenvolvimento; faça nova implantação em ambientes gerenciados. |
| `SCORE_CURSOR_UNSUPPORTED` | 400 | `startAfter` foi combinado com `orderBy: "_score"`. A relevância é computada em tempo de consulta e não fica armazenada, não podendo servir de chave para um cursor. | Pagine os resultados por relevância usando `limit`/`offset` ou ordene por uma coluna real. |
| `SQL_ERROR` | 400 | O banco recusou uma instrução SQL enviada. No socket realtime com `EXECUTE_SQL`, resulta em um frame `ERROR` trazendo a mensagem do banco. Em `POST /api/admin/sql/csv`, é emitido antes do início do envio do arquivo: erro de sintaxe, tentativa de escrita (o download é somente leitura), múltiplas instruções ou role não autorizada para a conexão. | Corrija o SQL. Downloads exigem um único comando `SELECT`, `WITH … SELECT`, `TABLE` ou `VALUES`. |
| `VIEW_NOT_READABLE` | 403 | Um chamador sem nenhuma das roles especificadas em `view.roles` tentou ler ou atualizar uma view materializada. Views materializadas não usam RLS, sendo servidas integralmente e apenas para essas roles. | Realize a leitura com uma das roles autorizadas ou declare a role do chamador em `view.roles`. |
| `TENANT_IMMUTABLE` | 400 | A escrita moveria a linha para outro tenant. Uma linha não pode trocar de tenant. `details.violations` cita o campo. Uma trigger reforça essa regra no banco, de modo que execuções diretas de SQL falham com erro Postgres `42501` e mensagem iniciando por `TENANT_IMMUTABLE`. | Crie a linha no outro tenant e apague a original, ou execute com uma role presente em `tenant.bypassRoles`. |
| `TENANT_MISMATCH` | 400 | A escrita indica um tenant ao qual o chamador não pertence; a operação também seria recusada pelo banco. | Escreva em um tenant ao qual pertença ou autentique-se com credenciais vinculadas a ele. |
| `TENANT_REQUIRED` | 400 | A tabela tem isolamento por tenant e o tenant não pôde ser inferido: a requisição não informa nenhum ou o chamador pertence a múltiplos tenants. | Envie o campo do tenant explicitamente ou autentique-se como pertencente a apenas um tenant. |
| `TRANSACTION_ABORTED` | 500 | Uma instrução na transação de escrita falhou e um hook capturou o erro. Como o Postgres já havia abortado a transação, todas as alterações foram revertidas e nada foi persistido. Apenas criações, atualizações ou exclusões via `context.data` rejeitadas pelo banco são revertidas isoladamente e seguras para tratamento em try/catch. | Permita que o erro seja propagado ou valide as condições antes de rodar o comando. Veja [Transaction Semantics](/docs/collections/context-data-api/#transaction-semantics). |
| `UNKNOWN_FIELD` | 400 | `?fields=` referencia um campo inexistente na tabela. | Verifique a grafia; a mensagem lista os campos disponíveis. |
| `UNKNOWN_AGGREGATE_FIELD` | 400 | Uma agregação ou `groupBy` referencia um campo inexistente na tabela. | Verifique a grafia; a mensagem lista os campos disponíveis. |
| `UNKNOWN_FILTER_FIELD` | 400 | O filtro referencia um campo que esta tabela — ou o destino de uma relação — não possui, ou uma coluna `.private()`. | Verifique a grafia; a mensagem lista os campos disponíveis. |
| `UNKNOWN_FILTER_OPERATOR` | 400 | O filtro utiliza um operador inexistente. | A mensagem lista todos os operadores aceitos. |
| `UNKNOWN_MESSAGE_TYPE` | 400 | Um frame do socket realtime contém um `type` não suportado pelo servidor. Retornado como frame `ERROR` contendo o `requestId` da requisição para evitar travamento por timeout. | Verifique o `type` do frame; a mensagem indica o valor recebido. |
| `UNKNOWN_ORDER_BY_FIELD` | 400 | A ordenação referencia um campo inexistente na tabela. | Verifique a grafia; a mensagem lista os campos disponíveis. |
| `PRECONDITION_FAILED` | 412 | O cabeçalho `If-Match` informou uma versão da linha desatualizada: o registro foi modificado entre a leitura e esta tentativa de escrita. Nada foi gravado. | Releia a linha, reaplique as modificações e envie o novo `ETag`. |
| `UNKNOWN_RESPONSE_FIELD` | 400 | `?fields=` solicita um campo inexistente na tabela. | Verifique a grafia; a mensagem lista os campos reconhecidos. |
| `UNKNOWN_VECTOR_PROPERTY` | 400 | A busca vetorial indicou uma coluna que não é do tipo `col.vector()` nesta tabela. | A mensagem lista as colunas vetoriais da tabela. |
| `UNSUPPORTED_MEDIA_TYPE` | 415 | O cabeçalho `Content-Type` não é aceito por esta rota. | Envie o formato indicado na documentação da rota. |
| `UNSUPPORTED_OPTION` | — | Lançado internamente como exceção (não via HTTP): uma escrita via acessor em processo (`context.data` em hooks, `rebase.data` em funções ou crons) recebeu `ifMatch` ou `idempotencyKey`. Esse mecanismo não dispõe de checagem de pré-condições nem repositório de idempotência, recusando a opção antes de executar qualquer escrita. | Remova a opção nesse ponto ou faça a escrita via cliente HTTP, que suporta ambas. |
| `UNSUPPORTED_RELATION_FILTER` | 400 | O filtro atravessa uma relação `via`, cujo caminho de junção é unidirecional, impedindo a correlação de uma subconsulta de volta à linha original. | Filtre a partir do lado proprietário da relação. |
| `UNSUPPORTED_RELATION_FILTER_OPERATOR` | 400 | Operador não suportado para o campo: relações sem coluna direta na linha são filtradas por pertencimento, enquanto comparações de padrão (`like`, `ilike` e negações) aplicam-se apenas a textos. | Consulte a mensagem; ela lista o que o campo aceita. |
| `VALIDATION_CONSTRAINT` | 400 | Um valor violou uma restrição declarada na coluna (`.validate()`, `.notNull()`, `.oneOf()`) — tamanho, intervalo, padrão, obrigatoriedade ou item fora da lista permitida. Cada entrada em `details.violations` possui um `code`: `required`, `min_length`, `max_length`, `length`, `min`, `max`, `less_than`, `more_than`, `positive`, `negative`, `integer`, `pattern`, `email`, `url`, `enum`, `min_items`, `max_items`, `unique_items` (arrays com valores duplicados, inclusive via `$push`), `unique_by` (itens de array JSON compartilhando valores em campo de `uniqueBy`), `date_min`, `date_max`, `geopoint_range`. | Consulte a mensagem; ela indica a tabela, a coluna e as infrações encontradas. |
| `VALIDATION_EXCLUDED_FIELDS` | 400 | O corpo tenta gravar em coluna marcada como `.private()` ou `.access({ write: [] })` — a mesma regra sob grafias diferentes. Essas colunas são de uso exclusivo do servidor: hash de senhas, tokens de verificação. Diferente de `FIELD_NOT_WRITABLE`, aplica-se igualmente a todos os usuários, inclusive `admin`. | Remova o campo. Veja [Field access](/docs/collections/field-access/). |
| `VALIDATION_INVALID_VALUE` | 400 | O valor informado é incompatível com o tipo de dado da coluna. | Consulte a mensagem; ela indica a coluna em questão. |
| `VALIDATION_UNKNOWN_FIELDS` | 400 | O corpo referencia um campo inexistente na tabela — incluindo o envio de `id` em tabelas cuja chave primária é outro campo. | Verifique a grafia; a mensagem ("Table 'x' has no column 'f'. Known columns: …") lista os campos válidos. |
| `VECTOR_CURSOR_UNSUPPORTED` | 400 | Um cursor (`after` / `startAfter`) foi associado a uma busca vetorial. As linhas são ordenadas por distância calculada dinamicamente, valor que não serve de chave para cursor, de modo que listagens vetoriais não retornam `nextCursor`. | Pagine os resultados mais próximos utilizando `limit`/`offset`. |
| `WRITE_DENIED` | 403 | Uma regra de segurança ou política de RLS impediu a operação de escrita. | Verifique a configuração de `rls` da tabela. |

## `PG_<SQLSTATE>` — uma restrição recusada pelo banco de dados

Uma escrita recusada pelo Postgres por motivos relacionados aos *dados enviados pelo chamador*
responde com o SQLSTATE contido no código: `PG_23505`, `PG_23503`, e assim por diante. Trata-se de uma
família de erros, não de uma lista estática — o Postgres define centenas de SQLSTATEs —, mas apenas duas
classes chegam a esse formato, pois somente essas decorrem de ações diretas do chamador:

- **classe 23**, violação de restrição de integridade: duplicidade, chave estrangeira
  apontando para registro inexistente, coluna NOT NULL deixada em branco;
- **classe 22**, exceção de dados: valor incompatível com o tipo da coluna.

Todas as demais falhas — conexão perdida, coluna inexistente, permissão insuficiente —
são de responsabilidade do servidor e resultam em `500`. Portanto, `code.startsWith("PG_")` é um teste seguro
para "os dados enviados no registro continham erros", sendo os quatro códigos abaixo os mais
comumente encontrados. `details.dbCode` traz o mesmo SQLSTATE para todos eles, e
a mensagem identifica a restrição específica violada.

| Código | Status | Significado | O que fazer |
| --- | --- | --- | --- |
| `PG_22P02` | 400 | O valor não pôde ser interpretado no tipo de dado da coluna — equivalente no lado da escrita a `INVALID_FILTER_VALUE`. | Envie um valor compatível com o tipo da coluna. |
| `PG_23502` | 400 | Uma coluna `NOT NULL` foi enviada sem valor. | Envie o campo ou atribua um valor padrão (default) à coluna. |
| `PG_23503` | 400 / 409 | Na criação/edição, uma chave estrangeira referencia uma linha inexistente (400). Na exclusão, outras linhas mantêm referências a este registro (409; chave com regra `RESTRICT` gera `PG_23001`, também 409). | Crie a linha referenciada antes ou corrija o id; para exclusão, remova ou aponte as linhas dependentes para outro registro primeiro. |
| `PG_23505` | 409 | Violação de restrição de unicidade (unique constraint). A mensagem identifica a restrição. | Use outro valor ou atualize a linha existente. |

## Armazenamento (Storage)

| Código | Status | Significado | O que fazer |
| --- | --- | --- | --- |
| `INVALID_LIST_OPTIONS` | 400 | O parâmetro `maxResults` da listagem de arquivos não é um inteiro maior ou igual a 1, ou seu `pageToken` não foi emitido pela fonte. Anteriormente, limites inferiores a 1 retornavam páginas vazias com o mesmo token, travando loops `while (pageToken)`. | Envie um `maxResults` positivo e repasse `nextPageToken` sem modificações. |
| `INVALID_STORAGE_BUCKET` | 400 | O nome do bucket é inválido. | Verifique o nome do bucket. |
| `INVALID_STORAGE_KEY` | 400 | A chave do objeto é inválida, sai fora de seu prefixo ou usa prefixos reservados (`_rebase/renditions/`, `_rebase/maintenance/`). | Verifique a chave do objeto. |
| `INVALID_TRANSFORM_OPTIONS` | 400 | Parâmetros de transformação de imagem fora do intervalo ou conflitantes entre si. | Veja [Storage](/docs/backend/storage/). |
| `STORAGE_FILE_TOO_LARGE` | 413 | O arquivo enviado ultrapassa o `maxBytes` declarado na coluna de destino `col.storage()`. Validado no servidor, não apenas no navegador. `details` informa a coluna, o limite e o tamanho real recebido. | Envie um arquivo menor ou aumente o valor de `maxBytes` na coluna. |
| `STORAGE_FILE_TYPE_REFUSED` | 400 | O tipo MIME do arquivo não consta na lista `accept` da coluna ou em `allowedMimeTypes` da fonte de armazenamento. `details` traz a coluna (ou lista da fonte), os tipos aceitos e o formato recebido. | Envie um formato aceito ou amplie a lista em `accept` / `allowedMimeTypes`. |
| `STORAGE_MISCONFIGURED` | 502 | O bucket S3 ou GCS configurado para a fonte não existe, ou o provedor recusou as credenciais desta implantação. A mensagem informa o bucket; `details.reason` contém `NoSuchBucket` ou a recusa do provedor. Anteriormente, baldes inexistentes eram interpretados como "arquivo não encontrado" para todos os itens. | Corrija o nome do bucket (`S3_BUCKET` / `GCS_BUCKET`, `__<KEY>` para fontes nomeadas) ou as permissões das credenciais. |
| `STORAGE_NOT_CONFIGURED` | 501 / 503 | Nenhuma fonte de armazenamento está configurada no servidor, ou nenhuma está marcada como padrão e a requisição não indica a fonte; a mensagem lista as fontes disponíveis (501). Uploads retomáveis cuja fonte tenha sido removida durante o envio resultam em 503. | Configure S3, GCS ou armazenamento local, ou indique a fonte com `?storageId=`. |
| `STORAGE_SAME_LOCATION` | 400 | `POST /api/admin/storage/move` com `deleteSource` (`rebase storage move --delete-source`) entre duas fontes que apontam para o mesmo bucket ou diretório. Os arquivos seriam considerados já presentes no destino por serem idênticos, e excluir a cópia da fonte apagaria o arquivo único existente. Nenhuma alteração foi realizada. | Altere a coluna para apontar diretamente para a outra fonte; os arquivos já estão nela. |
| `STORAGE_SCAN_INCOMPLETE` | 409 | `DELETE /api/admin/storage/orphans` (`rebase storage orphans --delete`) não conseguiu ler todas as tabelas, podendo marcar falsamente como órfão um arquivo em uso. Com `?scan=`, refere-se à varredura informada que falhou na leitura total. Nada foi excluído; `details.unscanned` indica as tabelas não lidas e os motivos. | Resolva os problemas de leitura dessas tabelas e repita a operação. |
| `STORAGE_SCAN_NOT_FOUND` | 404 | `GET /api/admin/storage/orphans/scans/:id` ou `DELETE /api/admin/storage/orphans?scan=:id` especifica uma varredura inexistente na fonte. Varreduras são mantidas por 7 dias na fonte analisada, de modo que informar um `storageId` diferente também resulta em não localização. | Passe o `storageId` correspondente à varredura ou realize uma nova varredura. |
| `STORAGE_SCAN_NOT_COMPLETE` | 409 | `DELETE /api/admin/storage/orphans?scan=:id` especifica uma varredura ainda em estado `queued` ou `running`, ou com status `failed`. Nada foi excluído; `details.status` traz o estado atual. | Aguarde a conclusão da varredura ou inicie uma nova. |
| `STORAGE_SCAN_EXPIRED` | 409 | `DELETE /api/admin/storage/orphans?scan=:id` referencia varredura finalizada há mais de 15 minutos. Nada foi excluído. | Execute uma nova varredura e proceda à exclusão a partir dela. |
| `STORAGE_SCAN_DELETION_STARTED` | 409 | `DELETE /api/admin/storage/orphans?scan=:id` referencia varredura cujos itens órfãos já estão em processo de exclusão. | Verifique o progresso da remoção com `GET /api/admin/storage/orphans/scans/:id` inspecionando o campo `deletion`. |
| `STORAGE_SOURCE_NOT_CONFIGURED` | 501 | A fonte de armazenamento está declarada, mas não possui credenciais associadas nesta instância. | Defina as variáveis de ambiente necessárias para essa fonte. |
| `STORAGE_WRITE_FAILED` | 502 | O provedor de armazenamento externo rejeitou ou encerrou a escrita de dados. | Inspecione os logs e a validade das credenciais no provedor. |
| `TRANSFORM_OVERLOADED` | 503 | Volume de transformações de imagem simultâneas acima da capacidade. | Tente novamente; avalie incluir uma CDN à frente do serviço. |
| `UNKNOWN_STORAGE_SOURCE` | 400 / 404 | A requisição informou uma fonte (`?storageId=`) não declarada no projeto. A referência a um `bucket` não atendido pela implantação retorna este código acompanhado de **404** (em listagens, envios simples, operações de pasta ou uploads retomáveis em S3/GCS) — indicando ausência do repositório; `details` lista os baldes e fontes válidos. Anteriormente ambos retornavam erro genérico de "arquivo não encontrado". | Declare a fonte em `config/resources.ts` ou consulte `GET /api/storage/sources`. |
| `UPLOAD_LOCKED` | 423 | Uma requisição `PATCH` de upload retomável chegou enquanto outro bloco do mesmo upload ainda estava em trânsito — cenário comum de retry de bloco pelo cliente. Recusado imediatamente em vez de enfileirado, similar ao comportamento do tusd. | Consulte o offset atual com `HEAD /api/storage/tus/:id` e retome a partir dali; o cliente tus-js-client gerencia backoff e retentativas automaticamente. Veja [Resumable uploads (TUS)](/docs/backend/storage-resumable-uploads/). |

## Funções customizadas

| Código | Status | Significado | O que fazer |
| --- | --- | --- | --- |
| `FUNCTION_NOT_FOUND` | 404 | Nenhuma função atende por esse nome — ou a função existe, mas suas rotas internas não contemplam o caminho requisitado. Usuários logados recebem a lista do que *está* disponível; chamadores anônimos não recebem a listagem para proteger a enumeração de endpoints do sistema. Se o arquivo da função falhou ao carregar, o log para usuários autenticados informa o nome do arquivo, permitindo distinguir erros de digitação de falhas de deploy. Chamadores anônimos recebem resposta idêntica a recursos inexistentes. | Verifique o nome contra `GET /api/functions` ou consulte os logs de boot para identificar eventuais falhas de carregamento de arquivos. |
| `FUNCTION_TIMEOUT` | 504 | O handler da função ultrapassou o tempo limite de execução. A execução interna segue ativa e não pode ser cancelada externamente a partir deste ponto. | Atribua um `AbortSignal` a chamadas externas ou aumente `REBASE_FUNCTIONS_TIMEOUT_MS`. |
| `FUNCTIONS_UPSTREAM_UNREACHABLE` | 502 | Este processo atua como proxy de funções para outra instância, mas não obteve resposta dela. | Verifique se a unidade responsável pela execução das funções está em operação. |

## Notificações push

| Código | Status | Significado | O que fazer |
| --- | --- | --- | --- |
| `PUSH_ENDPOINT_REFUSED` | 400 | O endpoint da assinatura não pertence a um serviço push convencional de navegadores (FCM, Mozilla, Apple, Windows) sob conexão `https`. Como o servidor realiza requisições para esse endereço a cada disparo, outros hosts são rejeitados. | Envie o retorno de `PushSubscription.toJSON()` emitido pelo navegador ou cadastre o host de testes em `push.allowedHosts`. Veja [Push notifications](/docs/backend/push-notifications/#routes). |
| `PUSH_NEEDS_A_USER` | 403 | Uma chave de API ou a chave de serviço tentou acessar uma rota de push. Assinaturas push pertencem ao navegador de um usuário conectado. | Execute a requisição utilizando a sessão desse usuário. |
| `PUSH_NOT_CONFIGURED` | 503 | Notificações push estão ativadas, mas inaptas para envio: falta de chaves VAPID em produção ou incapacidade de inicializar sua tabela. A mensagem especifica a causa. | Configure `REBASE_VAPID_PUBLIC_KEY`, `REBASE_VAPID_PRIVATE_KEY` e `REBASE_VAPID_SUBJECT`. Veja [Push notifications](/docs/backend/push-notifications/#keys). |

## Tarefas cron (Cron jobs)

| Código | Status | Significado | O que fazer |
| --- | --- | --- | --- |
| `CRON_JOB_ALREADY_EXECUTING` | 409 | Acionamento manual de uma tarefa cron que já se encontra em execução — nesta instância ou em outra que detenha o lease da tarefa, como o worker associado a uma API. Nenhuma execução foi iniciada. O salto fica registrado no histórico da tarefa, com detalhes em `details.log`; a linha identifica o processo responsável pela execução em curso. | Tente novamente quando a execução atual terminar. Veja [Cron Jobs](/docs/backend/cron-across-instances/#concurrency-guarding). |

## Superfícies administrativas e edição de esquema

Estes códigos indicam recursos desativados ou pendentes de configuração, em vez de erros
na requisição enviada. Cada um deles é igualmente retornado com status `200` na respectiva
rota `/status`, permitindo que painéis desabilitem visualmente o recurso em vez de disparar telas de erro.

| Código | Status | Significado | O que fazer |
| --- | --- | --- | --- |
| `ADMIN_SURFACE_UNAVAILABLE` | 501 | Interface administrativa acionada em servidor sem autenticação configurada, impossibilitando distinguir chamadas de administradores de requisições públicas. | Configure `auth.jwtSecret` ou forneça um `AuthAdapter`. |
| `BRANCH_DIFF_STALE` | 409 | `POST /api/admin/branches/:name/merge` recebeu a identificação (fingerprint) de um diff defasado: o branch ou o branch pai sofreram modificações posteriores. Nenhuma alteração foi realizada. | Releia o diff, revise as diferenças e execute a mesclagem com a nova `fingerprint`. |
| `BRANCH_DIFF_UNSUPPORTED` | 501 | A fonte de dados não suporta comparação entre branches: ausência de motor SQL ou falta de suporte a branches (sem conexão admin configurada). | Utilize um backend Postgres com `adminConnectionString` devidamente configurado. |
| `BRANCH_MERGE_BLOCKED` | 409 | Tabela divergente não pôde ser mesclada — adicionada ou removida no branch, divergência de colunas ou chaves primárias, ausência de chave primária, excesso de registros para reconciliação ou tabela reconstruída após a criação do branch (`TABLE_REWRITTEN`). Tabelas cujos registros não puderam ser correlacionados impedem a mesclagem mesmo exibindo 0 linhas (contagem indeterminada). `details.tables` lista cada caso e justificativa. Nenhuma alteração foi gravada. | Aplique o esquema com suas migrations primeiro ou execute o merge com `skipBlocked: true` para ignorar essas tabelas. |
| `BRANCH_MERGE_CONFLICT` | 409 | Linhas modificadas simultaneamente no branch e no pai tendo `onConflict` definido como `"abort"` (padrão); ou o pai rejeitou trecho da mesclagem — alteração concorrente de linha, bloqueio por trigger ou ocultação por política de RLS. Nada foi alterado. | Defina a preferência de resolução com `onConflict: "branch"` ou `"target"`, ou inspecione o diff novamente. |
| `BRANCH_MERGE_FAILED` | 409 | O banco pai recusou as linhas do branch durante a execução do comando de merge — falha de constraint, valor de enum incompatível ou violação de chave estrangeira quebrada pelas linhas do branch, tipicamente por assimetria de esquema entre os ambientes. `details` especifica `sqlState`, `table`, `constraint` e `detail`. Nada foi alterado. | Inspecione as discrepâncias no diff, alinhe o esquema pai usando suas migrations ou acerte os dados do branch antes de tentar novo merge. |
| `BRANCH_NOT_FOUND` | 404 | O nome de branch informado não existe no registro. | Consulte os branches existentes com `rebase db branch list` ou no painel de Branches. |
| `CONTRACT_UNAVAILABLE` | 404 | O contrato do projeto só é exposto sob autenticação ativa — descreve integralmente tabelas e relações. | Configure autenticação. A rota `/meta/schema-version` permanece sempre acessível. |
| `DEV_MAILBOX_UNAVAILABLE` | 501 | Caixa de e-mail de desenvolvimento desativada. Disparos só são interceptados quando `SMTP_HOST` está indefinido e `NODE_ENV` difere de production. | Remova `SMTP_HOST` em desenvolvimento ou consulte a caixa postal configurada. |
| `DOCS_UNAVAILABLE` | 404 | `GET /api/docs` é restrito aos mesmos chamadores aos quais `GET /api/schema/tables` descreve tabelas; sem autenticação configurada no servidor, não há perfis para atender. | Configure autenticação ou libere a documentação publicamente definindo `enableSwagger: true` (`REBASE_ENABLE_SWAGGER=true`). |
| `INVALID_CHANGE` | 400 | A proposta de alteração de esquema está malformada. | Consulte a mensagem. |
| `SCHEMA_CHANGE_FAILED` | 400 | A aplicação da alteração de esquema planejada falhou por motivo não contemplado em códigos específicos. | Consulte a mensagem; traz a falha original de forma literal. |
| `SCHEMA_CHANGE_UNAPPLICABLE` | 400 | A alteração é válida em si, mas inaplicável ao estado atual do esquema. | Consulte a mensagem. |
| `SCHEMA_EDIT_DIRTY_TREE` | 409 | O repositório contém alterações locais não commitadas, inviabilizando a edição de forma segura. | Faça commit ou stash das mudanças antes de tentar novamente. |
| `SCHEMA_EDIT_REFUSED` | 400 | O editor de esquemas recusou a modificação: as seções afetadas envolvem código não suportado para reescrita automática (spreads, funções auxiliares, chaves computadas) ou a operação é proibida por design (renomear tabelas, apagar última regra). `details.problems` lista cada impedimento. Nada foi alterado. | Consulte a mensagem. Realize a alteração diretamente nos arquivos em `backend/schema`. |
| `SCHEMA_EDIT_DOES_NOT_COMPILE` | 400 | A modificação em si é viável, mas deixaria o esquema em estado sem compilação — referências a tabelas excluídas ou regras apontando para colunas removidas. `details.problems` expõe os erros do compilador indicando tabela e coluna afetadas. Nada foi alterado. | Atualize primeiro as tabelas dependentes ou efetue a alteração manualmente em `backend/schema`. |
| `SCHEMA_EDIT_STALE_FILE` | 409 | Um dos arquivos alvos da alteração foi modificado no disco após a preparação da edição (salvamento na IDE, outro processo). Nada foi alterado. | Recarregue os arquivos e reaplique as alterações sobre o conteúdo mais recente. |
| `SCHEMA_EDIT_REQUIRES_A_PERSON` | 403 | Uma chave de API ou outro agente automatizado tentou aplicar alterações no esquema. | Faça login com um usuário humano ou ative `liveSchema.allowMachineApply`. |
| `SCHEMA_EDITING_NO_COLLECTIONS_DIR` | 501 | A edição de esquema em tempo de execução exige a definição de `schemaDir` (o diretório `backend/schema`) ou `liveSchema.repository`, ausentes na inicialização deste servidor. O código mantém o nome legado. | Configure um dos parâmetros. |
| `SCHEMA_EDITING_NO_REPOSITORY` | 503 | O planejamento de esquema opera normalmente, mas não há repositório git configurado para commit das alterações — ambientes rodando bundles pré-compilados ou sem rastreamento git em `backend/schema` (modificações exigem commit). | Inicialize com `git init` na raiz e reinicie o servidor (o repositório é detectado no boot) ou aponte `liveSchema.repository`. |
| `SCHEMA_EDITING_PROVISIONING_OFF` | 409 | Esta implantação não altera o banco de dados diretamente (`REBASE_PROVISION=false`), impossibilitando aplicar mudanças via painel administrativo. | Realize o commit apenas no código-fonte e delegue a atualização do banco ao processo responsável. |
| `SCHEMA_EDITING_UNSUPPORTED` | 503 | Este driver não possui recursos para planejar modificações de esquema. | O live editing requer banco Postgres. |
| `SCHEMA_EDITOR_BAAS_MODE` | 501 | As tabelas são derivadas de introspecção do banco de dados, sem arquivos-fonte para edição direta. | Realize alterações de esquema utilizando migrations. |
| `SCHEMA_EDITOR_DISABLED` | 501 | O editor de esquema está desligado para este servidor. Aplicações empacotadas em bundle sempre retornam este estado. | Habilite-o em `schemaEditor`. Para bundles, configure `REBASE_LIVE_SCHEMA_REPOSITORY` para editar `backend/schema` via repositório — veja [Live schema editing](/docs/backend/live-schema-editing#from-a-built-bundle). |
| `SCHEMA_EDITOR_MISSING_DEPENDENCY` | 501 | O editor de esquemas requer o pacote `ts-morph`, não encontrado na instalação. | Instale o pacote na aplicação que executa o backend e reinicie: execute `pnpm --dir backend add -D ts-morph@28.0.0` da raiz em projetos scaffolded, ou `pnpm add -D ts-morph@28.0.0` caso o backend seja a raiz. A mensagem indica o comando exato para seu ambiente. |
| `SCHEMA_EDITOR_NO_COLLECTIONS_DIR` | 501 | O servidor não possui `schemaDir` configurado, impedindo a escrita pelo editor. Mantém o identificador histórico. | Configure `schemaDir`. |
| `SCHEMA_EDITOR_PRODUCTION` | 501 | Editor bloqueado sob `NODE_ENV=production`: instâncias publicadas reconstroem arquivos a partir do repositório a cada deploy, descartando edições feitas em disco. | Edite `backend/schema` em ambiente de desenvolvimento e realize o deploy, ou configure `liveSchema.repository` para persistir diretamente no repositório. |
| `SCHEMA_UNAVAILABLE` | 404 | `GET /api/schema/tables` chamado em backend sem autenticação: não há chamador para calcular as permissões de visibilidade das tabelas, comportamento inalterado por `auth.requireAuth: false`. | Configure um adaptador de autenticação ou `auth.jwtSecret`. Veja [Endpoints](/docs/backend/endpoints/#schema). |
| `TABLE_NOT_FOUND` | 404 | `GET /api/schema/tables/:slug` indica uma tabela não acessível ao chamador — inexistente pelo slug informado ou fora do alcance dos escopos da credencial. | Inspecione o slug e os escopos `data:*` da credencial. |
| `UI_PREFERENCES_NEED_A_PERSON` | 403 | `/api/admin/ui-config` foi acionado via chave de API, token de plataforma ou chave de serviço. Preferências de UI pertencem exclusivamente a usuários humanos conectados. | Conecte-se com um usuário real. |
| `UI_PREFERENCES_TOO_LARGE` | 413 | As preferências de interface de uma única tabela ultrapassam 64 KB. | Reduza o volume salvo: preferências guardam dados de apresentação visual, não registros de dados. |
| `UI_PREFERENCES_UNSUPPORTED` | 501 | O driver deste backend não possui motor SQL para persistência de preferências de interface; o painel as mantém localmente no navegador. | Nenhuma ação requerida: as configurações permanecem no escopo de cada navegador. |
| `UI_CONFIG_FILE_INVALID` | 500 | O arquivo `frontend/src/cms/ui-config.json`, onde são mantidas preferências de interface em desenvolvimento, contém JSON inválido. | Corrija a sintaxe ou delete o arquivo; o painel gera um novo no próximo salvamento. |
| `SQL_EXPORT_UNSUPPORTED` | 501 | `POST /api/admin/sql/csv` não consegue realizar streaming de saída aqui: o banco embarcado de desenvolvimento (PGlite) opera com conexão única, e manter um cursor aberto durante o download congelaria as outras consultas; ou a fonte de dados não suporta cursores SQL. | Aponte `DATABASE_URL` para uma instância dedicada do Postgres (`rebase dev --docker` provê uma), ou adicione `LIMIT` e exporte diretamente pela tela. |

### Reconciliação de esquema (Schema reconcile)

[`rebase schema reconcile`](/docs/cli/schema/#rebase-schema-reconcile) planeja
via `POST /api/admin/schema/reconcile/plan` e aplica via
`/reconcile/apply`. Recusas preservam o estado original; apenas `SCHEMA_RECONCILE_FAILED`
deixa trechos parciais de plano executados.

| Código | Status | Significado | O que fazer |
| --- | --- | --- | --- |
| `INVALID_RECONCILE` | 400 | O corpo não é um objeto JSON válido ou `drop` não corresponde a uma lista de strings `"<table>.<column>"`. | Envie `{ "drop": ["voice_cache.wav"] }` ou omita o atributo `drop`. |
| `SCHEMA_RECONCILE_FAILED` | 400 | Interrupção por falha no meio da execução de comandos. Os comandos executados anteriormente permanecem aplicados; `details.applied` enumera quais foram. | Corrija o ponto apontado na mensagem e refaça o planejamento: o novo plano contemplará apenas o que ainda não foi executado. |
| `SCHEMA_RECONCILE_INVALID` | 400 | O plano não pode ser executado, com os motivos detalhados na mensagem: formato de `drop` diferente de `<table>.<column>`, referência a tabelas/colunas inexistentes ou tentativa de remoção de coluna ainda declarada no esquema da tabela. `details.plan` expõe o plano. | Ajuste a listagem em `drop`. Para remover uma coluna ativa, delete-a do arquivo `defineTable`, realize o deploy e então reconcilie. |
| `SCHEMA_RECONCILE_STALE` | 409 | O banco de dados ou as tabelas foram alterados após a aprovação do plano inicial. `details.plan` reflete a versão atualizada. | Revise a nova proposta de plano e confirme o novo `digest`. |
| `SCHEMA_RECONCILE_UNCONFIRMED` | 400 | Chamada a `/reconcile/apply` sem fornecimento de confirmação (`confirm`). | Crie o plano primeiro e envie o `digest` resultante no parâmetro `confirm`. A CLI executa esse processo automaticamente ao digitar `yes`. |
| `SCHEMA_RECONCILE_UNSUPPORTED` | 503 | O driver em uso não suporta planejamento de reconciliação ou carece de capacidade para rodar comandos SQL. | O recurso de reconcile requer banco Postgres. |

### Por que a tabela de um branch não pode ser mesclada

O erro `BRANCH_MERGE_BLOCKED` identifica cada tabela recusada em `details.tables`, associando-a
a um destes códigos. O mesmo identificador é exposto na propriedade `blocked` da tabela durante o diff,
permitindo que o Studio avise os bloqueios antes de alguém clicar em **Merge**. Nenhum deles constitui uma resposta HTTP autônoma.

| Código | Status | Significado | O que fazer |
| --- | --- | --- | --- |
| `COLUMNS_DIFFER` | — | Divergência de colunas entre o branch e a tabela pai. A comparação de linhas restringe-se exclusivamente às colunas compartilhadas. | Adicione as colunas faltantes no pai utilizando suas migrations (`rebase db push`) antes de mesclar. Migrations que alteram tipos de dados recriam a estrutura e transformam a tabela em `TABLE_REWRITTEN`: execute o merge antes dessa migração ou recrie o branch depois dela. |
| `NO_PRIMARY_KEY` | — | A tabela não possui chave primária, inviabilizando a conciliação linha por linha; o diff restringe-se à comparação das contagens totais. | Defina uma chave primária na tabela ou realize a movimentação de registros manualmente. |
| `PRIMARY_KEY_DIFFERS` | — | As colunas da chave primária, ou seus tipos de dados, divergem entre o branch e a tabela pai. | Alinhe o esquema aplicando a migração no pai primeiro. |
| `TABLE_ADDED` | — | A tabela foi criada exclusivamente no branch. O processo de merge não cria tabelas. | Crie a tabela na base pai via migrations e então mescle os registros. |
| `TABLE_DROPPED` | — | A tabela foi removida no branch. O processo de merge não remove tabelas. | Remova a tabela utilizando suas migrations. |
| `TABLE_REWRITTEN` | — | Uma das pontas reescreveu fisicamente todos os registros da tabela após a criação do branch — migração alterando tipo de coluna, comando `ADD COLUMN` com default volátil, `VACUUM FULL`, `CLUSTER` —, fazendo com que todas as linhas pareçam editadas e impossibilitando distinguir a autoria das mudanças. | Mescle o branch antes dessa migração estrutural ou recrie o branch a partir da base pai atualizada. |
| `TOO_LARGE` | — | A contagem de linhas na tabela em uma das pontas ultrapassa o limite suportado para conciliação granular do diff (100.000 por padrão, `maxRowsPerTable`). | Eleve o valor de `maxRowsPerTable` na geração do diff e no merge, ou efetue o transporte dos dados por outro método. |

## Códigos genéricos

Uma rota adota um destes códigos sempre que não houver um erro mais específico aplicável.

| Código | Status | Significado | O que fazer |
| --- | --- | --- | --- |
| `BAD_REQUEST` | 400 | Requisição malformada, sem erro mais específico correspondente. | Consulte a mensagem. |
| `UNAUTHORIZED` | 401 | Chamador não autenticado ou credencial inválida/rejeitada. | Faça login ou renove as credenciais. |
| `FORBIDDEN` | 403 | Autenticado, mas sem permissão de acesso ao recurso. | Tentar novamente com o mesmo usuário não surtirá efeito. |
| `CONFLICT` | 409 | Conflito identificado com o estado atual dos recursos. | Consulte a mensagem. |
| `INTERNAL_ERROR` | 500 | Erro interno no servidor. Mensagem mantida propositalmente genérica. | Forneça o `requestId` ao suporte; o detalhamento técnico consta nos logs. |
| `NOT_CONFIGURED` | 503 | Uma dependência exigida por esta rota não está configurada no servidor. | Consulte a mensagem. |
| `SERVICE_UNAVAILABLE` | 503 | Um serviço essencial para a requisição está inacessível: bucket S3/MinIO fora do ar, ou falha de conexão/resolução de DNS em chamada `fetch()` efetuada por função. O log do servidor expõe o host; a resposta HTTP oculta essa informação. Bancos de dados fora do ar usam `DATABASE_UNAVAILABLE`. Qualquer falha de rede contra esses serviços retorna este código. | Tente novamente e confira os logs do servidor. |

## Mantendo esta página precisa

O comando `pnpm verify:docs` falha se qualquer código emitido pelo servidor estiver ausente destas
tabelas, se uma tabela listar um código que o servidor não dispara, se os status HTTP atribuídos divergirem
do código-fonte, ou se uma família como `PG_<SQLSTATE>` não cobrir
um SQLSTATE que usuários possam enfrentar. Essa validação é executada por
`tooling/scripts/docs-verify/check-error-codes.mjs`.

O script valida seus próprios métodos antes da checagem. A extração dos códigos é feita diretamente da AST do TypeScript em vez de
consultar um servidor em execução, tornando pontos cegos silenciosos por definição: anteriormente o script não
detectava códigos retornados através de funções wrapper de linha única ou definidos logo após mensagens
contendo `)`, reportando falsamente "todos os códigos do servidor estão documentados"
em uma página que omitia dezessete deles. Por conta disso, o processo roda fixtures contendo essas exatas
variações estruturais antes de ler este documento, recusando-se a validar o conteúdo caso não consiga identificá-las.
