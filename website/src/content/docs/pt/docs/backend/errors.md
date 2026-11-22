---
sourceHash: b0a8aee611208b26
title: Códigos de erro
sidebar_label: Códigos de erro
description: Todos os códigos de erro que um backend Rebase pode retornar, com seu status HTTP, o que significa e o que fazer a respeito — além do envelope de resposta, X-Request-ID e as regras de details.
---

Cada falha retornada por um backend Rebase usa um único envelope e carrega um
`code` estável. O code é o elemento sobre o qual fazer ramificações condicionais: a mensagem é escrita para uma pessoa
e pode ser reformulada, o status é compartilhado por uma dúzia de problemas diferentes, e o
code não é nenhum dos dois.

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

- **`message`** — legível por humanos. Para um `4xx`, é a mensagem do próprio servidor; para
  um `5xx`, é deliberadamente genérica, porque o texto subjacente pode citar um
  host, uma role ou o nome de uma coluna.
- **`code`** — um dos valores abaixo. Estável entre versões menores.
- **`details`** — opcional e nunca garantido. Consulte as regras abaixo.
- **`requestId`** — presente sempre que a requisição passou pelo middleware
  de request-ID, o que inclui todas as rotas sob `basePath`.

### `X-Request-ID`

Toda requisição sob `basePath` recebe um ID: o cabeçalho `X-Request-ID` do chamador
quando este for um UUID, caso contrário, um novo. Ele é retornado na
resposta como `X-Request-ID`, incluído no envelope de erro como `requestId` e
anexado à linha de log do servidor referente a essa requisição.

Essa é a chave de junção. Cite-a em um relatório de bug e um operador poderá encontrar a
linha de log exata que explica a falha, trazendo o motivo que nunca foi
exibido ao cliente.

Enviar o seu próprio é como um rastreamento sobrevive a um salto de rede: um gateway ou executor de tarefas que
repassa o cabeçalho obtém um único ID em todos os serviços que processaram a requisição.
Um valor inválido é ignorado em vez de rejeitado — não vale a pena falhar uma requisição por causa de um cabeçalho malformado de um
chamador —, portanto, não presuma que o ID enviado é
o ID recebido. Leia o cabeçalho de resposta.

### O que há em `details`

`details` tem caráter diagnóstico, não contratual. Três regras o regem:

1. **Qualquer coisa definida explicitamente por uma rota é sempre retornada.** Estes são os
   erros do próprio chamador descritos com precisão: qual campo de filtro era desconhecido,
   qual relação não permite escrita, qual valor não corresponde ao seu tipo.
2. **Os diagnósticos do banco de dados são simplificados em produção.** Quando a falha é originada
   no Postgres, `details.dbCode` — o SQLSTATE — está sempre presente: ele nomeia
   a classe do problema e não revela nada sobre os dados. `dbMessage`,
   `detail` e `hint` são adicionados apenas quando `NODE_ENV` não for `production`,
   porque o Postgres inclui o conteúdo das linhas neles. `23505` reporta
   `Key (email)=(a@b.c) already exists.`, o que responderia "esta pessoa
   está cadastrada?" para qualquer endereço que alguém tente testar.
3. **Nunca faça ramificações condicionais baseadas em `details`.** Baseie-se em `code`. O que está sob `details` é
   qualquer informação que foi útil para uma pessoa naquele ponto de chamada, e isso muda.

## Interpretando um status

| Status | O que indica sobre a requisição |
| --- | --- |
| `400` | Malformada ou solicitando algo que não existe no schema. Corrija a requisição. |
| `401` | Não autenticado ou a credencial expirou. Faça login ou renove o token. |
| `403` | Autenticado, mas não permitido. Tentar novamente com a mesma identidade não ajudará. |
| `404` | Rota, tabela ou linha inexistente — ou uma linha que o row-level security oculta. |
| `409` | Um conflito com o estado existente: uma duplicata ou uma gravação concorrente. |
| `413` `415` `422` | O corpo é muito grande, tipo de mídia incorreto ou semanticamente rejeitado. |
| `429` | Limite de taxa atingido (Rate limited). Aguarde; a mensagem diz por quanto tempo. |
| `500` | O servidor ou seu banco de dados está com erro, não o chamador. Verifique os logs. |
| `501` | A rota existe, mas esta implantação não pode atendê-la — um recurso desativado ou não configurado. |
| `502` `503` `504` | Uma dependência estava inacessível, não configurada ou demorou demais para responder. |

## Autenticação e contas

| Code | Status | Significado | O que fazer |
| --- | --- | --- | --- |
| `AAL2_REQUIRED` | 403 | A rota requer um segundo fator e a sessão possui apenas um. | Complete o desafio de MFA e tente novamente. |
| `ALREADY_VERIFIED` | 400 | O endereço ou fator já foi verificado. | Nada — o estado desejado já é verdadeiro. |
| `ACCOUNT_OUTRANKS_CALLER` | 403 | A conta que está sendo editada, redefinida ou excluída possui uma role ou escopo que o chamador não possui. `details.beyond` os nomeia. | Peça para alguém que os possua fazer a alteração. |
| `ANONYMOUS_AUTH_DISABLED` | 403 | O login anônimo está desativado neste servidor. | Ative-o ou faça login com uma identidade real. |
| `ANONYMOUS_NOT_ALLOWED` | 403 | Uma sessão de convidado tentou aprovar um login de dispositivo. Um convidado não tem conta para vincular a um dispositivo. | Faça login com uma conta e depois aprove-o. |
| `API_KEY_SELF_MANAGEMENT_FORBIDDEN` | 403 | Uma chave de API tentou listar, criar, alterar ou revogar chaves de API, sejam do seu próprio tipo ou pessoais. | Gerencie as chaves como uma pessoa que possui `keys:write` ou com a chave de serviço. |
| `AUTH_MIDDLEWARE_MISSING` | 500 | Uma rota protegida foi executada sem nenhum middleware de autenticação Rebase antes dela, portanto, a credencial do chamador nunca foi analisada. | Monte a aplicação por meio do roteador de functions em vez de diretamente no seu próprio servidor. |
| `BOOTSTRAP_ANONYMOUS` | 403 | A inicialização (bootstrap) do primeiro administrador foi tentada por um chamador anônimo. | Faça login primeiro. |
| `BOOTSTRAP_COMPLETED` | 403 | O primeiro administrador já existe. | Peça para um administrador existente conceder a role. |
| `BOOTSTRAP_NOT_FIRST_USER` | 403 | O bootstrap é apenas para o primeiríssimo usuário, e este não é ele. | Peça para um administrador existente conceder a role. |
| `CAPTCHA_FAILED` | 400 | O provedor rejeitou o token de CAPTCHA. | Resolva um novo desafio. |
| `CAPTCHA_REQUIRED` | 400 | A rota requer um token de CAPTCHA e nenhum foi enviado. | Inclua o token. |
| `CHALLENGE_EXHAUSTED` | 401 | Tentativas incorretas em excesso para um desafio de MFA. | Inicie um novo desafio. |
| `CONFIRMATION_REQUIRED` | 400 | Uma operação DDL destrutiva (`DELETE /api/admin/db/tables/:table` ou `DELETE …/columns/:column`) foi chamada sem `{ confirm: "<name>" }`. | Reenvie com o nome exato do alvo em `confirm`, ou passe `dryRun: true` para visualizar o SQL. |
| `DDL_REJECTED` | 400, ou 409 quando o objeto já existe | O PostgreSQL recusou uma instrução executada por `/api/admin/db/*` — um tipo, um padrão, uma condição de política, um nome já em uso. A mensagem é do próprio Postgres, e `details.dbCode` é o seu SQLSTATE. | Altere o que a mensagem indica e envie a requisição novamente; `dryRun: true` exibe o SQL primeiro. |
| `DEVICE_LOGIN_DECIDED` | 409 | O login de dispositivo já foi aprovado ou negado. Um login é decidido apenas uma vez. | Inicie um novo no dispositivo. |
| `DEVICE_LOGIN_EXPIRED` | 410 | O login de dispositivo excedeu o limite de dez minutos antes de ser decidido. | Inicie um novo no dispositivo. |
| `DEVICE_LOGIN_NOT_FOUND` | 404 | Nenhum login de dispositivo possui esse código de usuário. A própria sondagem (poll) do dispositivo responde aos códigos em minúsculas da RFC 8628: `authorization_pending`, `slow_down`, `access_denied`, `expired_token`, `invalid_grant`. | Verifique o código com o que o dispositivo exibe. |
| `EMAIL_EXISTS` | 409 | Uma conta com esse endereço já existe — no registro, na alteração de endereço ou ao acessar um link de alteração de endereço quando outra conta assumiu o endereço enquanto este aguardava. | Faça login ou inicie uma redefinição de senha; para alteração de endereço, escolha outro endereço. |
| `EMAIL_NOT_CONFIGURED` | 503 | Magic links ou OTP foram solicitados e o servidor não possui transporte de e-mail configurado. | Configure o SMTP ou use outro método de login. |
| `EMAIL_NOT_VERIFIED` | 403 | Um login OAuth encontrou uma conta com o mesmo endereço, mas o provedor não verificou esse endereço, portanto ele não foi vinculado. | Faça login com o método existente e execute `POST /auth/link/<provider>`. |
| `FACTOR_NOT_VERIFIED` | 400 | O fator MFA foi cadastrado, mas nunca confirmado. | Confirme o fator. |
| `ID_EXISTS` | 409 | Uma conta já possui o ID mantido por uma importação de contas (`POST /api/admin/users/import`). A importação o reporta como `skipped` e mantém a conta como está. | Nada, caso a conta já tenha sido importada anteriormente. Caso contrário, omita o `id` ou escolha outro. |
| `IDENTITY_ALREADY_LINKED` | 409 | Essa identidade OAuth pertence a outra conta. | Faça login com ela ou desvincule-a de lá primeiro. |
| `IMPERSONATION_FORBIDDEN` | 403 | Uma requisição enviou `x-rebase-impersonate` e o chamador não tem permissão para executar uma requisição como outro usuário. Apenas a sessão de um administrador autenticado pode fazer isso, nunca uma chave de API ou a chave de serviço. | Envie com a sessão de um administrador ou omita o cabeçalho. |
| `IMPERSONATION_INVALID` | 400 | `x-rebase-impersonate` foi enviado vazio. | Envie o UID do usuário que deseja personificar ou omita o cabeçalho. |
| `IMPERSONATION_TARGET_NOT_FOUND` | 404 | `x-rebase-impersonate` indica um usuário não ativo: nenhuma conta possui esse UID, ou ela está desativada. | Verifique o UID. |
| `IMPERSONATION_UNAVAILABLE` | 501 | A autenticação deste backend não pode executar uma requisição como outro usuário, pois seu `AuthAdapter` não possui `resolveUser`. | Implemente `resolveUser` no adaptador ou omita o cabeçalho. |
| `IMPERSONATION_UNSUPPORTED` | 400 | `x-rebase-impersonate` foi enviado para uma rota que não pode rodar como outro usuário. Apenas a API de dados e custom functions o aceitam, e o socket realtime aceita `impersonate` em `AUTHENTICATE`. | Envie a requisição sem o cabeçalho. |
| `SIMULATION_FORBIDDEN` | 403 | Uma requisição enviou um cabeçalho `x-rebase-simulate-*` (o simulador de RLS), ou consultou `/api/admin/rls-simulator`, e seu chamador não tem permissão para simular acesso. Apenas a sessão de um administrador autenticado pode fazê-lo, nunca uma chave de API ou a chave de serviço. | Envie com a sessão de um administrador ou omita os cabeçalhos. |
| `SIMULATION_INVALID` | 400 | A simulação estava malformada: um cabeçalho enviado vazio, `x-rebase-simulate-api-key-id` combinado com uma role ou ID de usuário, ou simulação combinada com `x-rebase-impersonate`. | Especifique uma role (opcionalmente com um UID), um ID de usuário ou um ID de chave de API. |
| `SIMULATION_READ_ONLY` | 403 | Uma gravação, exclusão, `_batch`, reversão de histórico ou uma custom function chamada por qualquer verbo diferente de `GET`/`HEAD`/`OPTIONS`, continha um cabeçalho `x-rebase-simulate-*`. O acesso simulado é somente leitura: a gravação seria executada como a identidade simulada, não como o administrador. Leituras, incluindo `POST …/query` e `…/count`, continuam funcionando. | Interrompa a simulação para fazer alterações. |
| `SIMULATION_TARGET_NOT_FOUND` | 404 | A simulação não indica um usuário ativo (um ID de usuário enviado sem role) ou nenhuma chave de API ativa. | Verifique o ID, ou envie uma role junto ao UID para simular um UID que não possui conta. |
| `SIMULATION_UNAVAILABLE` | 501 | Este backend não pode simular acesso: seu `AuthAdapter` não possui `resolveUser` para confirmar um administrador, ou uma chave foi especificada em um backend sem chaves de API. | Implemente `resolveUser` ou omita os cabeçalhos. |
| `SIMULATION_UNSUPPORTED` | 400 | Um cabeçalho `x-rebase-simulate-*` foi enviado para uma rota que não oferece suporte a acesso simulado. Apenas a API de dados e custom functions os aceitam. | Envie a requisição sem os cabeçalhos. |
| `GUEST_REFERENCED` | 409 | Um convidado não pôde ser excluído porque uma linha do próprio projeto depende dele, por meio de uma chave estrangeira com `ON DELETE RESTRICT` ou `NO ACTION`. `DELETE /api/admin/guests` reporta isso por convidado em `skipped` e continua. | Exclua a linha ou mantenha o convidado. |
| `INVALID_ACCOUNT` | 400 | A conta está em um estado no qual esta operação não pode atuar. | Consulte a mensagem. |
| `INVALID_CHALLENGE` | 400 | O desafio MFA é desconhecido ou expirou. | Inicie um novo. |
| `INVALID_CODE` | 400 / 401 | O código OTP ou MFA está incorreto: 400 no login com código por e-mail (`/auth/otp/verify`), 401 no cadastro ou desafio de MFA. | Tente novamente com o código atual. |
| `INVALID_CREDENTIALS` | 401 | E-mail ou senha incorretos — deliberadamente sem especificar qual. | Tente novamente ou redefina a senha. |
| `INVALID_PLATFORM_TOKEN` | 401 | Um token de plataforma `rpt_` foi recusado: assinatura inválida, público (audience) incorreto, expirado ou com tempo de vida superior ao limite máximo. A mensagem informa qual o motivo. | Solicite à plataforma a geração de um novo — no Rebase Cloud, execute o comando novamente. |
| `INVALID_SCOPES` | 400 | Foi solicitado para uma chave algo que não é um escopo: malformado, desconhecido ou com um destino incompatível com o escopo. `details.problems` diz o que e o porquê; `details.validScopes` lista os escopos que uma chave pode ter. Ele omite `keys:read` e `keys:write`, que nenhuma chave pode ter. | Use um nome da lista. Veja [Roles e escopos](/docs/backend/roles-and-scopes/). |
| `INVALID_TOKEN` | 400 / 401 | Um token de verificação, redefinição, magic-link ou alteração de endereço está malformado, desconhecido, esgotado ou expirado (400). Uma credencial de provedor OAuth ou um token de atualização (refresh token) que falha na verificação resulta em 401. | Solicite um novo link ou faça login novamente. |
| `INVALID_USER_CODE` | 400 | O código enviado como código de login de dispositivo não é válido: deve ter oito letras, como `BCDF-GHJK`. | Copie o código exibido pelo dispositivo. |
| `INVALID_ID` | 400 | O `id` de uma conta importada não é permitido para uma conta: vazio, mais de 128 caracteres, contém caracteres fora de letras, dígitos e `_ - . : \|`, é um ID reservado (`service`, `anonymous`), ou um valor incompatível com a coluna de ID da tabela de usuários (não é um UUID em uma coluna `uuid`). | Corrija o ID, ou omita-o e deixe a tabela gerar um. |
| `INVALID_ROLE` | 400 | O nome de uma role sendo gravada não é uma string, está vazio ou contém `,` `{` `}` `"` `\` ou caracteres de controle. Esses caracteres seriam interpretados como outras roles na leitura: uma role trafega em um `text[]` do Postgres e na lista separada por vírgulas dividida por políticas de RLS, portanto `"support,admin"` retornaria como `admin`. `details.problems` lista cada um. | Renomeie a role. Qualquer outro nome é aceito. |
| `KEY_MANAGEMENT_SCOPE` | 400 | Foi solicitado `keys:read` ou `keys:write` para uma chave. Nenhuma chave pode gerenciar chaves. `details.scopes` as nomeia. | Remova-as. |
| `KEY_OUTRANKS_CALLER` | 403 | O detentor de `keys:write` tentou alterar ou revogar uma chave de serviço que possui uma role ou escopo que ele não possui. Apenas um admin pode gerenciar qualquer chave. `details.roles` e `details.scopes` listam o que a chave possui além do chamador. | Peça a um administrador, ou a alguém que possua essas permissões, para alterar a chave. |
| `LAST_ADMIN` | 403 | A alteração deixaria o projeto sem nenhum administrador. | Promova outro usuário primeiro. |
| `MFA_REQUIRED` | 401 | A senha estava correta e a conta possui um segundo fator verificado, portanto o login está apenas concluído pela metade. `details` traz um token de curta duração restrito ao desafio de MFA — não é uma sessão. | Abra um desafio e responda a ele; a resposta ao desafio emite a sessão. |
| `NO_SESSION` | 401 | Nenhum cookie de sessão ou refresh token foi fornecido. Normal no primeiro carregamento de página. | Faça login. |
| `NOT_ANONYMOUS` | 400 | Uma rota de upgrade de usuário anônimo foi chamada por uma conta real, ou `DELETE /api/admin/guests/:uid` especificou uma. | Nada a atualizar. Para excluir uma conta, use `DELETE /api/admin/users/:uid`. |
| `OAUTH_ERROR` | 401 | O provedor OAuth recusou a autenticação ou retornou um erro. | Tente o fluxo novamente; a mensagem contém a justificativa do provedor. |
| `PERSONAL_KEYS_DISABLED` | 403 | Chaves de API pessoais estão desativadas neste backend. | Defina `personalKeys: true` nas opções de `auth` da tabela de autenticação (`defineAuthTable`). |
| `PERSONAL_KEY_NEEDS_ACCOUNT` | 403 | A chave de serviço ou uma sessão de convidado tentou usar as rotas de chaves pessoais. Nenhuma delas possui uma conta para a chave atuar em nome de. | Faça login em uma conta ou crie uma chave de serviço em `/api/admin/api-keys`. |
| `PLATFORM_TOKENS_OFF` | 401 | Um token de plataforma `rpt_` atingiu um servidor que não os aceita: `REBASE_PLATFORM_TOKEN_KEY` e `REBASE_PLATFORM_TOKEN_AUDIENCE` não estão definidos. | A plataforma que hospeda a aplicação define ambos no deploy; faça um novo deploy ou entre na aplicação por outro método. |
| `RATE_LIMITED` | 429 | Excesso de tentativas vindas deste chamador. | Aguarde; a mensagem diz por quanto tempo. |
| `REDIRECT_URI_NOT_ALLOWED` | 400 | O destino do redirecionamento não está na lista de permissões (allowlist). | Adicione-o à configuração do provedor. |
| `REGISTRATION_DISABLED` | 403 | O autocadastro (self-service) está desativado. | Peça a um administrador para criar a conta. |
| `ROLE_EXCEEDS_CALLER` | 403 | As roles concedidas possuem um escopo, ou `admin`, que o chamador não possui. `details.beyond` os nomeia. | Peça a alguém que os possua para conceder a role. |
| `ROLE_EXCEEDS_CREATOR` | 403 | Foi atribuída a uma chave de serviço uma role de RLS que seu criador não possui. Apenas um admin pode atribuir qualquer role. `details.roles` as nomeia. | Remova a role ou peça a um administrador para criar a chave. |
| `ROLE_EXISTS` | 409 | Esse nome de role já está em uso. | Escolha outro nome. |
| `ROLE_LOOKUP_FAILED` | 503 | Não foi possível ler as roles do chamador — em uma rota de admin ou em uma requisição de dados em um backend com `config.auth`. Falha em modo seguro (fails closed) em vez de confiar nas roles contidas no token. Um token cujo UID não aponta para nenhuma conta, incluindo um UID incompatível com a tabela de usuários, gera 401, não este erro. Um banco inacessível resulta em `DATABASE_UNAVAILABLE`, não este erro. | Tente novamente; verifique o banco de dados. |
| `SCOPE_EXCEEDS_CREATOR` | 403 | Foi solicitado para uma chave um escopo que seu criador não possui. Uma chave nunca possui mais privilégios que a conta que a cria. `details.scopes` os nomeia. | Remova-os ou peça a alguém que os possua para criar a chave. |
| `SCOPE_MISSING` | 403 | A credencial não possui o escopo necessário para esta rota, tabela, fonte de storage ou function. `details.requiredScope` o nomeia, incluindo o destino. | Para uma pessoa, uma role que declare o escopo. Para uma chave, uma chave que o possua. Veja [Roles e escopos](/docs/backend/roles-and-scopes/). |
| `SCOPE_NOT_DECLARED` | 500 | Uma rota protegida com `requireScope` especifica um escopo de app que este backend não declara, portanto ninguém o possui, nem mesmo um administrador. Um nome que não seja um escopo válido ou um escopo padrão com erro de digitação como `data:raed` nunca chega a este ponto: `requireScope` lança um erro no registro da rota. | Declare o escopo sob `auth.scopes` na tabela de autenticação ou corrija o nome. Veja [Roles e escopos](/docs/backend/roles-and-scopes/). |
| `SELF_DELETE` | 400 | Um administrador tentou excluir sua própria conta. | Peça a outro administrador para fazê-lo. |
| `SESSION_REVOKED` | 401 | A sessão foi encerrada em outro lugar, todas as sessões foram revogadas ou a conta foi excluída. Todos os acessos que exigem uma sessão respondem assim a esse token de acesso: a API de dados, storage, custom functions e as rotas de admin. O socket realtime recusa o `AUTHENTICATE` com um frame `AUTH_ERROR` trazendo o mesmo código. O SDK tenta a renovação, ela é recusada, e ele efetua o logout. | Faça login novamente. |
| `ACCOUNT_DISABLED` | 401/403 | Um administrador desativou a conta: o login (403), a renovação e todos os tokens que ela possui (401) são recusados em todos os acessos que exigem uma sessão. O socket realtime recusa o `AUTHENTICATE` com um frame `AUTH_ERROR` contendo o mesmo código. | Contate um administrador. |
| `EMAIL_NOT_CONFIRMED` | 403 | `requireEmailVerification` está ativado e o endereço ainda não foi verificado. Retornado apenas para senhas corretas; um novo link é enviado por e-mail. | Siga o link enviado por e-mail. |
| `PROOF_REQUIRED` | 409 | `POST /auth/verify-email`: a conta contém uma senha ou identidade que ninguém comprovou, e a requisição não comprova nenhuma das duas. O token não é consumido. | Envie `password` para mantê-la, ou `removeUnproven: true` para verificar sem ela. |
| `UNDELIVERABLE_ADDRESS` | 400 / 409 | Foi solicitado um e-mail de verificação para um endereço inacessível — de um convidado ou placeholder do X (400) — ou uma conta tentou mudar para tal endereço (409, `POST /auth/change-email`). | Defina um endereço real primeiro. |
| `EMAIL_UNCHANGED` | 400 | `POST /auth/change-email` informou o endereço atual da conta. | Nada a alterar. |
| `ANONYMOUS_USER` | 403 | Um convidado solicitou alteração de e-mail; convidados não possuem endereço de e-mail próprio. | Converta-o em conta primeiro (`POST /auth/anonymous/link`). |
| `MFA_NOT_ENROLLED` | 400 | Códigos de recuperação foram solicitados para uma conta sem nenhum segundo fator verificado. | Cadastre um fator primeiro. |
| `HOOK_REJECTED` | 400 | Um hook `beforeUserCreate`, `beforeLogin`, `beforeUserDelete` ou `beforeEmailChange` lançou um erro. A mensagem é a definida pelo hook; um hook que selecionou um status 4xx responde com ele. | Consulte a mensagem. |
| `INVALID_JSON` | 400 | O corpo da requisição não é um JSON válido. | Envie um corpo no formato JSON. |
| `SELF_DISABLE` | 400 | Um administrador tentou desativar sua própria conta. | Peça a outro administrador. |
| `NOT_SUPPORTED` | 501 | O repositório de autenticação deste backend não suporta a ação solicitada (desativar contas, alterar endereço). | Reinicie o servidor para que a coluna seja adicionada, ou utilize um repositório compatível. |
| `UNKNOWN_SCOPE_TARGET` | 400 | O destino de um escopo indica uma tabela, fonte de storage ou function que este backend não disponibiliza. `details` lista as disponíveis. | Corrija o destino. |
| `UNVERIFIED_IDENTITIES` | 409 | Um magic link, código por e-mail ou redefinição de senha comprovou o endereço de uma conta não verificada, e a conta possui uma identidade de login cujo provedor nunca verificou esse endereço. O repositório de autenticação não pode removê-la (não possui `unlinkUserIdentity`), portanto a comprovação é recusada para não manter essa brecha em uma conta verificada. | Implemente `unlinkUserIdentity` no repositório customizado de auth, ou peça para um administrador revisar a conta. |
| `SETUP_REQUIRED` | 403 | O projeto ainda não possui administrador, portanto esta rota não está disponível. | Conclua a configuração inicial do primeiro administrador. |
| `TOKEN_ALREADY_USED` | 401 | Um token de uso único foi reutilizado, ou um refresh token que foi rotacionado há mais de `refreshTokenReuseIntervalSeconds` atrás. | Solicite um novo ou faça login novamente. |
| `TOKEN_EXPIRED` | 401 | O token ultrapassou o seu tempo de vida. | Solicite um novo. |
| `TOO_MANY_USERS` | 400 | Uma chamada `POST /api/admin/users/import` continha mais de 100 contas. `details.max` indica o limite. | Envie-as em lotes de 100 requisições; `rebase users import` já faz isso automaticamente. |
| `USER_NOT_FOUND` | 404 | Nenhuma conta encontrada com esse ID. | Verifique o ID. |
| `WEAK_PASSWORD` | 400 | A senha não cumpre a [política de senhas](/docs/backend/auth-endpoints/#password-policy) (por padrão, 8+ caracteres contendo letra maiúscula, minúscula e dígito) — no cadastro, na redefinição ou alteração, e na senha definida por um administrador: `POST /api/admin/users`, criação na tabela de autenticação via API de dados, `PUT /api/admin/users/:id` ou `POST /api/admin/users/:id/reset-password`. | Escolha uma senha mais forte. Um administrador importando contas pode enviar `skipPasswordPolicy: true` na criação. |

## Dados, queries e gravações

| Code | Status | Significado | O que fazer |
| --- | --- | --- | --- |
| `AGGREGATE_MASKED_BY_AFTER_READ` | 400 | Um agregado diferente de `count()` sem `groupBy` em uma tabela que possui um hook `afterRead` ativo (global, na tabela ou o `.transform()` de uma coluna). Um agregado lê os valores salvos e nunca executa o hook; portanto, soma, mínimo, máximo, contagem de campos ou agrupamento leriam o que o hook oculta. | Use `count()` sem `groupBy`, ou leia as linhas, que passam pelo hook. |
| `AGGREGATE_NOT_SUPPORTED` | 501 | Este driver não consegue calcular o agregado solicitado. | Use um driver compatível ou calcule no cliente. |
| `BRANCHING_UNSUPPORTED` | — | Foi solicitado um branch do banco de dados pelo websocket do Studio no banco de dados gerenciado de desenvolvimento (PGlite), onde um branch *é* o próprio pai e nada ficaria isolado. A recusa é a mesma exibida por `rebase db branch`. | Aponte `DATABASE_URL` para uma instância própria do Postgres (`rebase dev --docker` inicia uma) e crie branches a partir dela. |
| `BATCH_TOO_LARGE` | 400 | `POST /api/data/_batch` contém mais operações do que o limite permitido por batch (1000 por padrão). Um batch é uma única transação e mantém seus locks por toda a sua duração. | Envie em partes menores; a mensagem informa o limite e a contagem enviada. |
| `BATCH_UNSUPPORTED` | 400 | O driver deste backend não oferece suporte a gravações atômicas entre tabelas, e um loop de gravações individuais não seria atômico nem executado em uma única ida e volta (round trip). | Envie as gravações como requisições separadas ou por meio de chamadas `/bulk` em cada tabela. |
| `BULK_TOO_LARGE` | 400 | O corpo da requisição bulk excede o limite de itens configurado. | Divida a requisição. |
| `BULK_UNSUPPORTED` | 400 | Esta tabela ou driver não oferece suporte a gravações em lote (bulk). | Grave as linhas individualmente. |
| `CALLBACK_REJECTED` | 400 / 403 | Um hook de tabela recusou a gravação. Um `throw` originado em `beforeSave`/`beforeDelete`/`after*` é um 400 com a mensagem definida pelo próprio autor; um `beforeDelete` que retorna `false` é um 403. `details.stage` informa qual hook falhou e `details.path` a tabela. | Leia a mensagem — ela foi escrita por este projeto, não pelo Rebase. |
| `CALLBACK_RECURSION` | 500 | Gravações iniciadas por hooks aninhados ultrapassaram 16 níveis de profundidade: a gravação via `context.data` de um hook executa novamente os hooks da tabela, e nada na cadeia interrompe o ciclo — geralmente um `afterSave` que atualiza a própria linha de forma incondicional. Toda a gravação foi revertida (rollback). A mensagem informa o hook e a tabela; `details.chain` lista cada etapa hook → gravação. | Torne a gravação do hook condicional: atue apenas em `status === "new"`, ou ignore quando `values` já contiverem o que seria gravado. |
| `COMPOSITE_KEY_ADDRESS` | 400 | A tabela possui chave composta e o endereço na URL possui um número diferente de partes em relação à chave. | Enderece a linha como `<part1>:::<part2>`, com cada parte codificada para URL (URL-encoded), na ordem da chave; `details.primaryKey` lista as colunas. |
| `TABLE_READ_ONLY` | 405 | Uma operação de escrita foi feita em uma view (`defineView`). Views são somente leitura. Antigo `COLLECTION_READ_ONLY`. | Escreva nas tabelas consultadas pela view. Veja [Views](/docs/collections/views/). |
| `TABLE_WITHHELD` | 503 | A tabela está declarada, mas o banco de dados não a protege: o row-level security está desativado, nenhuma das políticas declaradas está presente, ou uma política restritiva declarada está ausente. (Uma política permissiva ausente é atendida, com um aviso de boot indicando-a.) Isso ocorre quando o servidor não provisiona suas tabelas (`REBASE_PROVISION=false`, `provisionSchema: false`, `provision.tables: false`, `REBASE_MIGRATE_ON_BOOT=none`), e o servidor retém a tabela em vez de expor todas as linhas a todos os chamadores. Tabelas de junção muitos-para-muitos seguem a mesma regra: se falharem, as tabelas cujas relações dependem dela são retidas e a mensagem informa a junção; o mesmo vale para tabelas cujo `via` passe por uma tabela retida. Leituras de relações ou filtros que passem por tabelas retidas também retornam este código. As demais tabelas continuam sendo servidas. O log de inicialização informa os comandos necessários para protegê-la. | Aplique os comandos informados no log de boot (`rebase db push` faz isso) e reinicie. Ou, se a aplicação controla o acesso à tabela por conta própria, declare `rlsRequired: false` nela (ou `database({ rls: { required: false } })`) e reinicie. |
| `SQL_NOT_ALLOWED` | 400 | O SQL executado com a identidade do chamador (`getSql(c)`, `withAuth(user).sql`) não era uma única instrução `SELECT`, `WITH`, `VALUES`, `TABLE`, `INSERT`, `UPDATE`, `DELETE` ou `MERGE` simples, ou chamou `set_config`, ou referenciou `pg_settings`. Como a identidade do chamador fica nas configurações de sessão, instruções que possam alterá-las são recusadas. | Mantenha o texto da consulta próprio, em uma única instrução, com todos os valores em `params`. Veja [Custom functions](/docs/backend/custom-functions/#3-getsqlc--sql-as-the-caller). |
| `CURSOR_WITH_OFFSET` | 400 | `?after=` foi combinado com `?offset=` ou `?page=`. Como o cursor já determina onde a página começa, aplicar um offset sobre ele pula silenciosamente essa quantidade de linhas após o cursor — uma lacuna invisível para o chamador na resposta. | Use apenas um ou outro. |
| `DISTINCT_NOT_APPLICABLE` | 400 | `?distinct=true` foi combinado com busca textual ou busca vetorial. Ambas atribuem uma pontuação individual por linha, de forma que nenhuma linha é idêntica a outra e o `DISTINCT` não agruparia nada — pareceria ter funcionado sem mudar nada. | Remova um dos dois parâmetros. |
| `DISTINCT_ORDER_BY_NOT_SELECTED` | 400 | Uma leitura com `distinct` é ordenada por uma coluna que ela não retorna. Um `SELECT DISTINCT` só pode ser ordenado por colunas presentes na sua lista de seleção, caso contrário as linhas agrupadas não têm ordenação previsível. `details.fields` as lista. | Adicione esses campos a `?fields=` ou remova-os de `?orderBy=`. |
| `DATABASE_UNAVAILABLE` | 503 | O banco de dados não pôde ser acessado: conexão recusada ou perdida, falha de resolução de DNS do host, servidor iniciando ou desligando, ou banco fechado para novas conexões (`ALLOW_CONNECTIONS false`, deixado na fonte caso um `rebase db branch create --force` seja interrompido no meio; o log do servidor informa o banco, e `rebase db branch list` o reabre). Todas as portas de entrada retornam esse erro, incluindo login, rotas de admin e o socket realtime (em um frame `ERROR`). Enviado com o cabeçalho `Retry-After: 5`. | Tente novamente; o SDK tenta automaticamente. Verifique se o banco de dados está rodando e acessível pelo servidor. |
| `DB_CONNECTIONS_EXHAUSTED` | 503 | O servidor de banco de dados recusou uma nova conexão por ter atingido a capacidade máxima (`53300` excesso de clientes, `53400` limite de conexões por role ou banco atingido). Como todas as instâncias do servidor compartilham o `max_connections`, isso costuma ocorrer com múltiplas instâncias usando pools grandes sem um pooler intermediário. É um problema de carga, não um defeito; enviado com `Retry-After: 2`. O servidor registra a solução no log uma vez por minuto. | Tente novamente; o SDK tenta automaticamente. Diminua `DB_POOL_MAX` (ou limite com `REBASE_DB_POOL_MAX`) entre as instâncias, coloque um pooler na frente do banco (`DATABASE_POOLED`), ou aumente `max_connections`. |
| `DB_CONNECT_TIMEOUT` | 503 | O estabelecimento de uma nova conexão com o banco demorou mais que `DB_POOL_CONNECT_TIMEOUT`: o banco está demorando para aceitar conexões ou há alta latência de rede. Enviado com `Retry-After`. | Tente novamente; o SDK tenta automaticamente. Verifique a carga do banco e a conectividade de rede com ele. |
| `DB_PERMISSION_DENIED` | 500 | O Postgres recusou o comando (`42501`): violação de política de row-level security negando acesso à role, ou ausência de permissão `GRANT`. | Veja [Troubleshooting](/docs/troubleshooting/). |
| `DB_POOL_EXHAUSTED` | 503 | Todas as conexões do pool permaneceram ocupadas pelo período de `DB_POOL_CONNECT_TIMEOUT`, impedindo que a requisição chegasse ao banco. É um problema de carga, não um defeito; enviado com `Retry-After`. O servidor registra a solução no log uma vez por minuto. | Tente novamente; o SDK tenta automaticamente. Aumente `DB_POOL_MAX` ou investigue consultas lentas e transações longas que estejam prendendo conexões. |
| `FIELD_NOT_READABLE` | 400 | Um filtro, `orderBy`, `fields`, `select` de agregado ou `groupBy` referencia um campo que as roles do chamador não podem ler (`access.read`), ou um caminho aninhado/ordenação agregada referencia uma relation inacessível para leitura — ou uma operação de campo (`$inc`, `$push`, …) atinge um deles, onde a recusa de limites revelaria o valor armazenado. Um campo ausente na resposta não pode ser interrogado via consultas, sob risco de expor o valor predicado por predicado. Um filtro por relação (`author.salary`) e uma ordenação agregada por campo de relação (`max(staff.salary)`) são avaliados pelas regras do alvo. `details.violations` informa cada campo. O driver aplica a mesma regra para leituras feitas internamente em nome do chamador (`context.data` sob o escopo do chamador) e para buscas vetoriais, includes ou verificações de unicidade. Colunas `.private()` comportam-se como inexistentes: filtros, `orderBy`, `fields`, `include`, `select` de agregado, `groupBy` ou `vector_search` que as referenciem recebem exatamente a mesma resposta dada a nomes digitados incorretamente (`UNKNOWN_FILTER_FIELD`, `UNKNOWN_ORDER_BY_FIELD`, `UNKNOWN_FIELD`, `UNKNOWN_RELATION`, `UNKNOWN_AGGREGATE_FIELD` ou `UNKNOWN_VECTOR_PROPERTY`), e nenhuma resposta de campo desconhecido revela sua existência. | Remova o campo da consulta ou obtenha a role necessária. Veja [Acesso a campos](/docs/collections/field-access/). |
| `FIELD_NOT_WRITABLE` | 400 / 403 | O corpo define um campo no qual as roles do chamador não possuem permissão de escrita (`access.write`). A operação é recusada em vez de ignorar o campo: descartá-lo reportaria sucesso em uma edição que não foi aplicada. O mesmo código recusa gravações através de um pai que definam uma relação na qual o chamador não pode escrever, e updates que atribuam valor a um campo `softDelete` — apenas operações de exclusão o definem. O socket realtime responde 403 com este código para gravações em caminhos aninhados cuja tabela pai, relação ou tabela de destino não sejam atendidas ali, em vez de enviá-las ao driver sem avaliação. `details.violations` informa cada campo. | Remova o campo ou obtenha a role necessária. Um campo no qual ninguém tem permissão de escrita retorna `VALIDATION_EXCLUDED_FIELDS`. |
| `FILTERED_USER_WRITE` | 400 | Um update ou delete com filtros foi enviado para a tabela de autenticação via HTTP, cujas alterações exigem validação usuário por usuário antes de serem executadas. | Leia os usuários e execute `updateMany`/`deleteMany` filtrando por ID. |
| `FILTER_REQUIRED` | 400 | Uma gravação filtrada (update ou delete via `where`/`logical`, vinda do SDK ou de rotas bulk) não possui condições, o que afetaria todas as linhas. A operação é barrada antes de qualquer execução. | Adicione uma condição. Se a intenção for realmente alterar todas as linhas, defina uma condição que abranja todas elas explicitamente. |
| `HISTORY_UNAVAILABLE` | 503 | A gravação em uma tabela com `history: true` foi rejeitada porque o registro de histórico não pôde ser gravado: o banco não possui a tabela `rebase.entity_history` ou, no caso de `openRebase` e `rebase console`, a função `rebase.record_history`. Nenhum backend com suporte a histórico foi inicializado neste banco. Nada foi executado, inclusive hooks, e as leituras não são afetadas. Lançado por `openRebase` e retornado por backends iniciados com `provision: false`. | Inicialize o backend uma vez com o histórico ativado e `provision: true` (`rebase dev` faz isso) e tente novamente. |
| `HISTORY_UNSERVABLE` | 501 | O driver de dados da tabela não suporta a execução de regras de leitura e hooks `afterRead` sobre linhas armazenadas (`DataDriver.serveStoredRows`), e o histórico nunca é exposto sem mascaramento. O driver Postgres padrão suporta isso. | Implemente `serveStoredRows` no driver customizado. Veja [Histórico](/docs/backend/history/). |
| `IDEMPOTENCY_KEY_IN_PROGRESS` | 409 | Uma requisição anterior com a mesma `Idempotency-Key` ainda está em processamento. | Tente novamente assim que a anterior for concluída. |
| `IDEMPOTENCY_KEY_REUSED` | 422 | A mesma `Idempotency-Key` foi reenviada em uma requisição diferente: método, caminho, query string ou corpo divergentes. | Use uma nova chave ou repita a requisição original de forma idêntica. |
| `INVALID_AGGREGATE_FUNCTION` | 400 | `?select=` indicou uma função que não é de agregação (`count`, `sum`, `avg`, `min`, `max`, `countDistinct`, `mode`, `percentile`, `distinct`, `fingerprint`). | Utilize uma das opções suportadas listadas na mensagem. |
| `INVALID_AGGREGATE_GROUP` | 400 | Uma transformação de `groupBy` é desconhecida ou incompatível com a coluna: `year`/`month`/`day` em coluna que não é data, `unnest` em coluna que não é array. | Utilize `lower`, `upper`, `year`, `month`, `day` ou `unnest` em colunas do tipo apropriado. |
| `INVALID_AGGREGATE_SELECT` | 400 | Um item em `?select=` não segue o formato `fn(field)`; uma função diferente de `count()` ou `fingerprint()` foi chamada sem campo; `percentile` não recebeu uma fração entre 0 e 1; ou `fingerprint()` foi solicitado para uma view simples, que não armazena linhas. | Escreva no formato `sum(total)`, `count()`, `percentile(price,0.95)`. |
| `INVALID_AGGREGATE_WINDOW` | 400 | Uso de `offset`, `page` ou `orderBy` em agregação sem `groupBy`, ou uso de cursor em qualquer agregação. Agregações sem agrupamento retornam uma única linha, e um grupo não é uma linha sobre a qual um cursor possa avançar. | Adicione `groupBy` ou remova esses parâmetros; pagine grupos usando `offset` ou `page`. Veja [Agregações](/docs/sdk/aggregates-and-search/#aggregates). |
| `INVALID_BATCH_BODY` | 400 | Uma operação de `/_batch` está sem `op`, `table`, `values` ou `id`, referencia uma tabela não atendida por este backend, ou reutiliza um identificador `ref`. | Consulte a mensagem; ela indica a operação pelo índice. |
| `INVALID_BATCH_REF` | 400 | Um `{ "$ref": "<name>.<field>" }` referencia uma operação inexistente anterior, faz referência a uma operação futura ou solicita um campo ausente na linha referenciada. Apenas referências retroativas são resolvidas. | Defina a operação com `ref` *antes* de referenciá-la. |
| `INVALID_BULK_BODY` | 400 | O corpo da requisição bulk não segue o formato esperado. | Envie o array exigido pela rota: `{ "rows": [...] }` para `POST /bulk`, `{ "updates": [{ "id", "data" }] }` para `PATCH /bulk`, `{ "ids": [...] }` para `POST /bulk/delete`. |
| `INVALID_CONFLICT_RULE` | 400 | A regra de conflito de um upsert (manter duplicatas ou substituir apenas mediante `where`) foi enviada sem `upsert: true`, ou ambas as regras foram enviadas simultaneamente. | Envie `upsert: true` e selecione apenas uma das regras. |
| `INVALID_CONFLICT_TARGET` | 400 | O parâmetro `on_conflict` / `onConflict` de um upsert referencia colunas sem garantia de unicidade, é enviado sem `upsert: true`, ou é usado em uma criação aninhada (onde a linha correspondente passaria para o novo pai). Sem isso, o Postgres retornaria 42P10 no meio de uma transação com trabalho pendente. Ocorre também em upserts na tabela de autenticação, onde criação e atualização seguem fluxos distintos. | Declare `.unique()` na coluna ou um índice `unique`; a mensagem lista os destinos válidos existentes. Na tabela de usuários, envie `POST` para criar e `PATCH` para atualizar. |
| `INVALID_COUNT` | 400 | `?count=` não é `exact` nem `none`. A requisição é recusada em vez de aplicar o padrão: um erro de digitação como `?count=nnone` geraria o custo da contagem que se desejava evitar. | Envie `exact` (o padrão) ou `none`. Veja [Ignorando a contagem](/docs/backend/api/#skipping-the-count). |
| `INVALID_CURSOR` | 400 | O cursor `after` não pôde ser lido ou referencia um ID incompatível com as colunas-chave da tabela: foi truncado, recodificado ou construído manualmente. Um cursor válido enviado com um `orderBy` diferente do utilizado na sua emissão resulta em `CURSOR_ORDER_MISMATCH` (também 400). | Repasse o valor de `meta.nextCursor` da página anterior sem alterações, acompanhado do mesmo `orderBy` ou sem ordenação. Veja [Paginação](/docs/sdk/pagination/). |
| `INVALID_DELETED_PARAM` | 400 | `?deleted=` não é `include` nem `only`. É recusado em vez de ignorado: digitar `?deleted=true` acidentalmente ocultaria todas as linhas excluídas, dando a impressão de sucesso enquanto responde o oposto do esperado. | Envie `include` (ativas e excluídas) ou `only` (apenas excluídas). Omita para trazer apenas linhas ativas. |
| `INVALID_DISTINCT` | 400 | `?distinct=` não é `true` nem `false`. | Envie um desses valores; `1` e `0` também são aceitos. |
| `INVALID_FIELD_OPERATION` | 400 | Um operador `$inc` / `$push` / `$pull` / `$merge` foi aplicado a um tipo incompatível de coluna, com operando malformado, com dois operadores no mesmo campo, com erro de digitação ou durante uma criação — onde inexiste valor salvo anterior. | Veja [Gravando via REST](/docs/backend/writes/#field-operations); a mensagem informa o campo. |
| `INVALID_FILTERED_WRITE` | 400 | Uma gravação filtrada indicou um caminho por relação (`posts/1/comments`) ou não indicou nenhuma tabela. | Realize a gravação na tabela relacionada filtrando pela chave de relacionamento. |
| `INVALID_FILTER_FIELD` | 400 | O filtro referencia uma coluna inexistente nesta tabela. | Verifique a grafia em relação à estrutura da tabela. |
| `INVALID_FILTER_OPERATOR` | 400 | O operador não é compatível com o tipo desta coluna — como aplicar `like` em números ou datas. | Veja [Consultando dados](/docs/sdk/querying/). |
| `INVALID_FILTER_VALUE` | 400 | O valor do filtro não pode ser convertido para o tipo da coluna comparada: `?id=eq.abc` em chave numérica, valor ausente em enum, timestamp malformado, número fora do limite suportado. `details.dbCode` traz o SQLSTATE correspondente. | Envie um valor compatível com o tipo da coluna. |
| `INVALID_HARD_PARAM` | 400 | `?hard=` não é `true` nem `false`. Outros valores são recusados para evitar que sejam tratados como "falso" — um erro de digitação que executa soft-delete quando se pediu expurgo definitivo levaria o usuário a acreditar incorretamente que o dado foi apagado. | Envie `true` ou `false`. |
| `INVALID_INCLUDE` | 400 | `?include=` malformado: lista de caminhos inválida ou objeto de opções por relação fora do padrão. Caminhos aninhados com mais de três níveis retornam `INCLUDE_TOO_DEEP` (também 400). Tratado na entrada para evitar vazamento de erro 500 pelo driver. | Consulte a mensagem; ela indica o caminho incorreto. |
| `INVALID_INPUT` | 400 | O corpo da requisição falhou na validação. | Consulte a mensagem. |
| `INVALID_LIMIT` | 400 | `?limit=` não é um número inteiro de 1 até o valor máximo (1000 por padrão); valores superiores são rejeitados (não são limitados automaticamente). Subscrições realtime com limites fora dessa faixa recebem o mesmo código em um frame `ERROR` via WebSocket. | Reduza o limite e pagine os demais registros. |
| `INVALID_LOGICAL_GROUP` | 400 | Um grupo `?or=` / `?and=` / `?not=` está malformado ou aninhado além do nível de profundidade permitido. | Consulte a mensagem para entender a regra de achatamento de filtros. |
| `INVALID_OFFSET` | 400 | `?offset=` não é um número inteiro maior ou igual a 0. | Envie um inteiro não-negativo. |
| `INVALID_ORDER_BY` | 400 | `?orderBy=` não corresponde a `field`, `field:desc`, `field:desc:last`, ou a um array JSON no formato `{ field, direction, nulls }` — ou indica uma direção diferente de `asc`/`desc`, ou posição de nulos diferente de `first`/`last`. | Consulte a mensagem para ver as formas aceitas. |
| `INVALID_PAGE` | 400 | `?page=` não é um número inteiro maior ou igual a 1. A numeração de páginas começa em 1; `?page=0` é tratado como erro em vez de primeira página. | Envie `1` ou superior, ou utilize `?offset=`. |
| `INVALID_PARAM` | 400 | Parâmetro de busca malformado na URL. | Consulte a mensagem. |
| `INVALID_QUERY_BODY` | 400 | O corpo de `POST …/query` contém valores incompatíveis com os parâmetros de URL: listas para itens de valor único (`fields`, `limit`, …), objetos como filtros, ou duplicação simultânea de parâmetros na URL e no corpo — requisições `POST …/query` leem tudo a partir do corpo. | Formate os valores como na URL — string, ou lista para filtros repetidos; `where`, `include`, `orderBy` e `vector` aceitam JSON. Veja [Consultas longas demais para uma URL](/docs/backend/vector-search/#queries-too-long-for-a-url). |
| `INVALID_VECTOR` | 400 | `?vector=` não é um array JSON composto por números. | Envie no formato `[0.1,0.2,0.3]`. |
| `INVALID_VECTOR_DISTANCE` | 400 | `?vector_distance=` não corresponde a `cosine`, `l2` nem `inner_product`. | Use uma dessas três opções. |
| `INVALID_VECTOR_THRESHOLD` | 400 | `?vector_threshold=` não é um número. | Envie um número. |
| `INVALID_WHERE` | 400 | `?where=` não é um objeto JSON mapeando campos para condições. | Envie no formato `{"status":["==","active"]}`. |
| `KEY_IMMUTABLE` | 400 | Uma atualização atribui à chave da linha um valor diferente daquele pelo qual foi endereçada — seja no corpo ou via `beforeSave`. Uma linha não pode ter sua chave alterada: etapas posteriores (releitura, `afterSave`, histórico, realtime) referenciam o registro pela sua chave de origem. A operação é barrada antes dos hooks, sem nada gravado, em qualquer canal de acesso. `details.violations` informa o campo. | Crie a linha sob a nova chave e apague a atual. Enviar o valor que a chave já possui é permitido. |
| `MISSING_AGGREGATE_SELECT` | 400 | A rota de agregação foi acionada sem o parâmetro `?select=`. | Adicione o parâmetro, por exemplo: `?select=count()`. |
| `NOT_A_MATERIALIZED_VIEW` | 400 | `refresh()` foi chamado em uma tabela que não corresponde a uma view materializada. | Execute `refresh()` apenas em views configuradas com `defineView(…, { materialized: true })`. |
| `NO_TABLES` | 404 | O projeto não possui tabelas: nenhuma declarada em `backend/schema` e nenhuma introspectada do banco de dados. Caso existam tabelas sem row-level security ativo, a mensagem as lista com o SQL para ativação, e `details.unprotectedTables` as enumera. Antigo `NO_COLLECTIONS`. | Crie tabelas — via migrations, SQL ou arquivos `defineTable` associados a `rebase db push` — e reinicie. |
| `NOT_FOUND` | 404 | Nenhuma linha com este ID encontrada na tabela informada — ou a linha é ocultada do chamador pelas políticas de row-level security. | Verifique o ID e avalie as políticas de `rls` da tabela. |
| `UNKNOWN_RELATION` | 400 / 404 | `?include=` indica um relacionamento inexistente na tabela. O código retorna **404** caso o relacionamento venha indicado no *caminho da URL*, como em `/api/data/authors/1/posts` onde `authors` não declare relação — neste caso a URL aponta para algo inexistente, configurando item não encontrado em vez de requisição inválida. | Verifique o nome do relacionamento — a mensagem lista os disponíveis na tabela. Uma relação reversa precisa estar declarada no elemento pai para ser navegável. |
| `ORDER_BY_FIELD_NOT_SORTABLE` | 400 | A ordenação informada utiliza um campo que não suporta ordenação. | Ordene por uma coluna válida. |
| `PAGE_WITH_OFFSET` | 400 | `?page=` foi enviado junto com `?offset=` — ou uso simultâneo de `page` e `offset` em `find()`, algo rejeitado com o mesmo código pelo client SDK, pelo `rebase.data` local e pelo cliente offline antes da requisição. Como ambos determinam o intervalo de leitura, `page` anteriormente sobrepunha `offset` sem aviso, impedindo que o chamador visse o offset aplicado. | Envie apenas um deles. |
| `PAYLOAD_TOO_LARGE` | 413 | O corpo da requisição excede o limite máximo configurado. | Diminua o volume de dados enviado ou aumente o limite permitido. |
| `READ_ONLY_TRANSACTION` | 409 | Um hook `afterRead` tentou realizar operações de escrita. Leituras com escopo de requisição rodam em transações `READ ONLY`, o que impede gravações pelo hook ou por funções acionadas por ele. | Isole a gravação da leitura: envie para fila de background, ou use `rebase.dataAsAdmin` em cron jobs ou custom functions. |
| `REFRESH_NOT_SUPPORTED` | 501 | `POST /api/data/<slug>/refresh` foi direcionado a um driver de dados sem suporte a views materializadas. | Não há recursos de refresh neste backend. |
| `RELATION_HAS_NO_PIVOT` | 400 | A requisição continha dados de junção (payload), mas a navegação não alcança o destino por uma relação `manyToMany` declarando `pivot` — inexistindo linha intermediária para armazená-los. | Declare as colunas de `pivot` na relação ou remova os dados extras da operação de gravação. Veja [Relacionamentos](/docs/collections/relations/). |
| `RELATION_MISCONFIGURED` | 500 | Um relacionamento não pode ser resolvido com base no schema registrado. A operação é abortada em vez de ignorada: omiti-la daria falso status de sucesso a alterações não aplicadas, ou retornaria vazio para linhas existentes. | Execute `rebase schema generate` caso o schema gerado esteja desatualizado em relação ao banco de dados. |
| `RELATION_NOT_UNLINKABLE` | 400 | Este lado da relação não permite desvinculação direta. | Execute a desvinculação a partir do lado proprietário da relação. |
| `RELATION_NOT_WRITABLE` | 400 | O caminho aninhado não aponta para uma relação que permita gravação, ou uma criação/atualização referencia uma relação `via` com múltiplos saltos — somente relações `via` de salto único aceitam escrita. `details.fields` lista as chaves `via`. Nada foi gravado. | Grave diretamente nas tabelas unidas pela cadeia. Veja [Relacionamentos](/docs/collections/relations/#via--an-explicit-join-chain). |
| `RELATION_PIVOT_UNSUPPORTED` | 400 | O relacionamento declara colunas na tabela de junção, mas a fonte de dados atual não suporta gravação nelas. | O vínculo principal continua funcionando, mas os dados associados à junção não são gravados. Avalie os recursos do driver. |
| `RELATION_SOURCE_KEY_EMPTY` | 400 | A escrita do relacionamento não recebeu a chave de origem necessária para atrelar a ligação. | Salve a linha pai primeiro. |
| `RESULT_TOO_LARGE` | — | A instrução executada via comando `EXECUTE_SQL` no socket realtime — como chamadas `admin.executeSql` ou leituras do catálogo no painel administrativo — ultrapassou 128 MB em linhas retornadas, abortando o envio. Enviado como frame `ERROR` via WebSocket. Consultas rodadas diretamente no console SQL não são barradas desta forma: exibem apenas as primeiras linhas. | Insira um `LIMIT`, projete menos colunas e faça a leitura do resultado de forma fracionada. |
| `ROW_IN_TRASH` | 409 | A chave do upsert coincide com uma linha na lixeira (registros em soft-delete mantêm suas chaves). Nenhuma interface permite que o upsert grave sobre linhas excluídas: query REST `?on_conflict=`, upserts `/bulk` e `/_batch`, SDK e socket realtime. Nenhuma gravação foi realizada. | Restaure a linha antes (atualizando o campo de soft-delete para `null`), ou purgue o registro com `?hard=true` e repita o upsert. Veja [Soft delete](/docs/collections/soft-delete/). |
| `SCHEMA_DRIFT` | 500 | Uma tabela ou coluna aguardada pelo código não foi encontrada no banco de dados. | Use `rebase db push` em desenvolvimento; faça novo deploy em instâncias gerenciadas (managed tenants). |
| `SCORE_CURSOR_UNSUPPORTED` | 400 | `startAfter` foi combinado com `orderBy: "_score"`. A relevância é dinâmica por busca e não fica armazenada, impossibilitando seu uso como cursor. | Pagine os resultados por relevância usando `limit`/`offset`, ou ordene por uma coluna fixa. |
| `SQL_ERROR` | 400 | O banco recusou uma instrução SQL formulada pelo usuário. No socket realtime via `EXECUTE_SQL`, é devolvido um frame `ERROR` com o detalhe do erro do banco. `POST /api/admin/sql/csv` retorna este erro antes do streaming do arquivo: falhas de sintaxe, tentativas de gravação (o download roda apenas em modo leitura), envio de múltiplas instruções, ou tentativa de assumir roles não permitidas pela conexão. | Corrija o SQL. Downloads aceitam apenas uma instrução única do tipo `SELECT`, `WITH … SELECT`, `TABLE` ou `VALUES`. |
| `VIEW_NOT_READABLE` | 403 | Um chamador sem nenhuma das roles especificadas em `view.roles` tentou ler ou atualizar uma view materializada. Por não possuírem row-level security, views materializadas são servidas por completo e apenas para as roles autorizadas. | Consulte usando uma das roles autorizadas ou inclua a role do chamador na lista de `view.roles`. |
| `TENANT_IMMUTABLE` | 400 | A gravação transferiria uma linha entre tenants. Linhas não podem trocar de tenant. `details.violations` informa o campo. Uma trigger interna do banco de dados aplica a mesma restrição, fazendo com que comandos SQL rodados pelo chamador falhem com código de erro Postgres `42501` e mensagem iniciada por `TENANT_IMMUTABLE`. | Crie a linha no novo tenant e remova a anterior, ou grave utilizando uma role configurada em `tenant.bypassRoles`. |
| `TENANT_MISMATCH` | 400 | A gravação indica um tenant diferente do pertencente ao chamador; a operação também seria barrada pelo banco. | Grave no tenant ao qual o chamador pertence, ou autentique-se com credenciais vinculadas ao tenant correto. |
| `TENANT_REQUIRED` | 400 | A tabela exige escopo de tenant, mas não foi possível identificá-lo: a chamada não incluiu o tenant ou o chamador está vinculado a múltiplos tenants. | Envie o campo do tenant de forma explícita ou faça a autenticação utilizando uma entidade associada a um único tenant. |
| `TRANSACTION_ABORTED` | 500 | Uma instrução da transação falhou e a exceção foi capturada por um hook. Como o Postgres abortou a transação inteira, a gravação sofreu rollback e nada foi persistido. Apenas criações, atualizações ou exclusões via `context.data` barradas pelo banco são revertidas individualmente de forma segura para tratamento em bloco catch. | Deixe a exceção propagar ou faça validações prévias antes de submeter o comando. Veja [Semântica de transações](/docs/collections/context-data-api/#transaction-semantics). |
| `UNKNOWN_FIELD` | 400 | `?fields=` referencia um campo inexistente na tabela. | Verifique a grafia; a mensagem lista os campos válidos. |
| `UNKNOWN_AGGREGATE_FIELD` | 400 | Uma função de agregação ou `groupBy` referencia um campo inexistente na tabela. | Verifique a grafia; a mensagem lista os campos válidos. |
| `UNKNOWN_FILTER_FIELD` | 400 | O filtro referencia um campo inexistente nesta tabela (ou na tabela de destino da relation), ou uma coluna configurada como `.private()`. | Verifique a grafia; a mensagem lista os campos válidos. |
| `UNKNOWN_FILTER_OPERATOR` | 400 | O filtro referencia um operador não suportado. | A mensagem exibe a lista de todos os operadores permitidos. |
| `UNKNOWN_MESSAGE_TYPE` | 400 | Um frame de WebSocket no realtime possui um `type` desconhecido pelo servidor. Devolvido em um frame `ERROR` com o `requestId` da requisição, garantindo a conclusão da chamada em vez de estourar timeout. | Verifique o campo `type` do frame; a mensagem especifica o valor recebido. |
| `UNKNOWN_ORDER_BY_FIELD` | 400 | A ordenação referencia um campo inexistente nesta tabela. | Verifique a grafia; a mensagem lista os campos válidos. |
| `PRECONDITION_FAILED` | 412 | O cabeçalho `If-Match` informou uma versão da linha que já foi modificada: houve alteração concorrente entre a sua leitura e esta gravação. Nada foi alterado. | Leia a linha novamente, aplique as modificações necessárias e envie o novo `ETag`. |
| `UNKNOWN_RESPONSE_FIELD` | 400 | `?fields=` solicita um campo que não existe na tabela. | Verifique a grafia; a mensagem lista os campos conhecidos. |
| `UNKNOWN_VECTOR_PROPERTY` | 400 | Uma busca vetorial apontou para uma coluna que não está configurada como `col.vector()` nesta tabela. | A mensagem enumera as colunas vetoriais da tabela. |
| `UNSUPPORTED_MEDIA_TYPE` | 415 | O cabeçalho `Content-Type` não é suportado por esta rota. | Envie os dados no formato aceito conforme especificado na documentação da rota. |
| `UNSUPPORTED_OPTION` | — | Lançado como exceção interna, sem resposta HTTP: uma gravação feita através dos métodos locais (`context.data` em hooks, `rebase.data` em functions ou cron jobs) recebeu as opções `ifMatch` ou `idempotencyKey`. Como essa camada não implementa validação de pré-condições nem controle de idempotência, a opção é abortada antes de persistir alterações para evitar execuções inadvertidas. | Remova essas opções do acesso local ou faça a alteração através do cliente HTTP, onde ambas são devidamente suportadas. |
| `UNSUPPORTED_RELATION_FILTER` | 400 | O filtro tenta atravessar uma relation do tipo `via`, cuja amarração de join é configurada em sentido único, impossibilitando referenciar a subquery reversa. | Aplique o filtro a partir do lado detentor do vínculo. |
| `UNSUPPORTED_RELATION_FILTER_OPERATOR` | 400 | O operador não é aplicável a este tipo de campo: relações sem coluna na linha atual são filtradas exclusivamente por pertinência/associação, e checagens por padrão textual (`like`, `ilike` e suas variações negativas) exigem campos de texto. | Consulte a mensagem; ela detalha os operadores aceitos pelo campo. |
| `VALIDATION_CONSTRAINT` | 400 | Um valor violou restrições declaradas na coluna (`.validate()`, `.notNull()`, `.oneOf()`) — regras de comprimento, limites numéricos, formatos por padrão, preenchimento obrigatório ou itens fora do conjunto esperado. Cada entrada em `details.violations` contém um `code`: `required`, `min_length`, `max_length`, `length`, `min`, `max`, `less_than`, `more_than`, `positive`, `negative`, `integer`, `pattern`, `email`, `url`, `enum`, `min_items`, `max_items`, `unique_items` (itens repetidos em arrays, incluindo operações `$push`), `unique_by` (duplicidade no valor da propriedade informada em `uniqueBy` entre elementos de array JSON), `date_min`, `date_max`, `geopoint_range`. | Consulte a mensagem para identificar a tabela, coluna e detalhes de cada violação encontrada. |
| `VALIDATION_EXCLUDED_FIELDS` | 400 | O corpo tenta gravar em uma coluna declarada como `.private()` ou protegida por `.access({ write: [] })` — ambas com o mesmo efeito prático. Apenas o próprio servidor pode atualizá-las: exemplos incluem hashes de senha e tokens de validação. Diferente do erro `FIELD_NOT_WRITABLE`, essa regra restringe qualquer chamador, incluindo usuários `admin`. | Remova o campo da gravação. Veja [Acesso a campos](/docs/collections/field-access/). |
| `VALIDATION_INVALID_VALUE` | 400 | O valor informado não é compatível com o tipo de dado da coluna. | Consulte a mensagem; ela indica a coluna problemática. |
| `VALIDATION_UNKNOWN_FIELDS` | 400 | O corpo referencia campos que não pertencem à tabela — inclusive passar `id` em tabelas configuradas com outra chave primária. | Verifique a grafia; o retorno ("Table 'x' has no column 'f'. Known columns: …") lista os campos disponíveis. |
| `VECTOR_CURSOR_UNSUPPORTED` | 400 | O cursor (`after` / `startAfter`) foi usado simultaneamente com uma busca vetorial. Como as linhas são ordenadas por distâncias calculadas em tempo de execução, esses cálculos não servem como cursor, fazendo com que resultados vetoriais não incluam `nextCursor`. | Realize a paginação dos vizinhos mais próximos via `limit`/`offset`. |
| `WRITE_DENIED` | 403 | Uma diretriz de segurança ou política de row-level security negou a gravação solicitada. | Revise as definições de `rls` da tabela. |

## `PG_<SQLSTATE>` — restrição recusada pelo banco de dados

Gravações rejeitadas pelo Postgres por problemas relacionados *aos dados fornecidos pelo chamador*
retornam trazendo o SQLSTATE no próprio código: `PG_23505`, `PG_23503`, etc.
Trata-se de uma convenção de nomenclatura de grupo e não de uma listagem exaustiva — o Postgres define centenas de códigos SQLSTATE —, mas apenas duas
classes são repassadas nesse padrão, por refletirem inconsistências geradas exclusivamente pelo chamador:

- **classe 23**, violação de integridade referencial/restrições: duplicidades, chaves estrangeiras
  apontando para registros ausentes, campos NOT NULL enviados em branco;
- **classe 22**, exceção em nível de dados: valores incompatíveis com o tipo da coluna.

Todas as demais falhas — quedas de conexão, ausência de colunas, privilégios insuficientes —
são falhas de infraestrutura e retornam como `500`. Dessa forma, checar se `code.startsWith("PG_")` é uma maneira confiável
de verificar se "o registro enviado continha dados incorretos", sendo os quatro códigos a seguir os mais comuns
no dia a dia das aplicações. `details.dbCode` carrega o mesmo SQLSTATE em todos os casos,
e a mensagem descreve a restrição afetada.

| Code | Status | Significado | O que fazer |
| --- | --- | --- | --- |
| `PG_22P02` | 400 | Não foi possível converter o valor para o tipo da coluna — equivalente no lado de escrita ao erro `INVALID_FILTER_VALUE`. | Envie um dado condizente com o tipo da coluna. |
| `PG_23502` | 400 | Uma coluna configurada como `NOT NULL` foi enviada vazia ou sem valor. | Envie o campo com valor válido ou atribua um default à coluna. |
| `PG_23503` | 400 / 409 | Em gravações, a chave estrangeira faz referência a uma linha inexistente (400). Em exclusões, existem outras tabelas apontando para este registro (409; restrições do tipo `RESTRICT` disparam `PG_23001`, também 409). | Insira o registro pai com antecedência ou adeque o ID; em exclusões, remova ou desvincule as referências prévias. |
| `PG_23505` | 409 | Violação de restrição de unicidade (unique constraint). A mensagem informa qual restrição falhou. | Envie um valor diferente ou atualize a linha que já possui este valor. |

## Storage

| Code | Status | Significado | O que fazer |
| --- | --- | --- | --- |
| `INVALID_LIST_OPTIONS` | 400 | O parâmetro `maxResults` de uma listagem de storage não é um número inteiro igual ou superior a 1, ou seu `pageToken` não foi emitido pela fonte em questão. Tamanhos de página menores que 1 costumavam retornar uma página vazia com o mesmo token, travando loops `while (pageToken)` indefinidamente. | Envie um `maxResults` com valor positivo e repasse o `nextPageToken` exatamente como fornecido. |
| `INVALID_STORAGE_BUCKET` | 400 | O nome do bucket é inválido. | Verifique a nomenclatura do bucket. |
| `INVALID_STORAGE_KEY` | 400 | A chave do arquivo está malformada, tenta sair do seu diretório prefixado ou invade prefixos de uso reservado (`_rebase/renditions/`, `_rebase/maintenance/`). | Verifique a formatação da chave do arquivo. |
| `INVALID_TRANSFORM_OPTIONS` | 400 | Os parâmetros para transformação de imagem contêm valores fora dos limites ou mutuamente conflitantes. | Veja [Storage](/docs/backend/storage/). |
| `STORAGE_FILE_TOO_LARGE` | 413 | O tamanho do upload supera o valor de `maxBytes` definido na coluna `col.storage()` associada. Essa regra é aplicada pelo servidor e não só no navegador. `details` informa a coluna, o teto permitido e o tamanho do arquivo recebido. | Envie um arquivo menor ou aumente o limite de `maxBytes` na configuração da coluna. |
| `STORAGE_FILE_TYPE_REFUSED` | 400 | O tipo MIME do arquivo não está na lista de `accept` da coluna ou nas diretivas `allowedMimeTypes` da própria fonte de storage. `details` identifica a coluna (ou os limites da fonte), as extensões/tipos aceitos e o cabeçalho content-type recebido. | Envie arquivos no padrão aceito ou amplie as opções em `accept` / `allowedMimeTypes`. |
| `STORAGE_MISCONFIGURED` | 502 | O bucket S3 ou GCS associado a esta fonte não existe ou as credenciais desta implantação foram rejeitadas pelo provedor de nuvem. A mensagem traz o nome do bucket; `details.reason` reporta `NoSuchBucket` ou a negativa enviada pelo provedor. Anteriormente, buckets inexistentes eram reportados incorretamente como "arquivo não encontrado" para todas as operações. | Adeque o nome do bucket (`S3_BUCKET` / `GCS_BUCKET`, `__<KEY>` em fontes nomeadas) ou revise os privilégios das credenciais informadas. |
| `STORAGE_NOT_CONFIGURED` | 501 / 503 | Nenhum backend de storage foi configurado neste servidor, ou nenhuma fonte padrão foi definida e a chamada não especificou a fonte desejada; a resposta lista as fontes ativas (501). Retorna 503 se a fonte de um upload resumable foi desfeita antes do término do envio. | Configure os serviços S3, GCS ou armazenamento local, ou identifique a fonte via parâmetro `?storageId=`. |
| `STORAGE_SAME_LOCATION` | 400 | Chamada a `POST /api/admin/storage/move` com a opção `deleteSource` (`rebase storage move --delete-source`) operando entre fontes que compartilham o mesmo bucket ou diretório físico. Todos os arquivos pareceriam já existir no destino por serem idênticos, e deletar a cópia de origem apagaria o único arquivo existente. Nenhuma ação de movimentação ou deleção foi efetuada. | Altere a coluna para apontar diretamente para a outra fonte; seus arquivos já residem lá. |
| `STORAGE_SCAN_INCOMPLETE` | 409 | A execução de `DELETE /api/admin/storage/orphans` (`rebase storage orphans --delete`) falhou ao tentar ler todas as tabelas, o que poderia marcar falsamente um arquivo referenciado como não utilizado. Quando chamado com `?scan=`, aponta para a verificação que não conseguiu analisar todas as tabelas. Nada foi apagado; `details.unscanned` identifica cada tabela inacessível e a respectiva causa. | Corrija o acesso às tabelas que falharam e repita a operação. |
| `STORAGE_SCAN_NOT_FOUND` | 404 | O identificador informado em `GET /api/admin/storage/orphans/scans/:id` ou `DELETE /api/admin/storage/orphans?scan=:id` não consta na fonte indicada. O histórico de scans expira após 7 dias dentro da própria fonte onde foi gerado; usar um `storageId` diferente do scan original resultará neste erro. | Forneça o `storageId` correspondente ao scan ou realize um novo processo de verificação. |
| `STORAGE_SCAN_NOT_COMPLETE` | 409 | A rota `DELETE /api/admin/storage/orphans?scan=:id` foi chamada para um scan com status `queued`, `running` ou `failed`. Nenhuma deleção foi realizada; `details.status` traz o estado da verificação. | Aguarde a conclusão da varredura ou dispare uma nova verificação. |
| `STORAGE_SCAN_EXPIRED` | 409 | O scan indicado em `DELETE /api/admin/storage/orphans?scan=:id` foi concluído há mais de 15 minutos. Nenhuma deleção foi realizada. | Inicie um novo scan e processe a remoção a partir dele. |
| `STORAGE_SCAN_DELETION_STARTED` | 409 | O scan referenciado em `DELETE /api/admin/storage/orphans?scan=:id` já está com a remoção de arquivos órfãos em andamento. | Monitore o progresso do campo `deletion` consultando `GET /api/admin/storage/orphans/scans/:id`. |
| `STORAGE_SOURCE_NOT_CONFIGURED` | 501 | A fonte de storage foi declarada na estrutura, mas não possui credenciais associadas neste ambiente. | Configure as variáveis de ambiente necessárias para essa fonte de storage. |
| `STORAGE_WRITE_FAILED` | 502 | O serviço de storage remoto rejeitou a gravação ou interrompeu o envio dos dados. | Verifique as credenciais e inspecione os logs do provedor de storage. |
| `TRANSFORM_OVERLOADED` | 503 | Quantidade excessiva de transformações de imagem sendo processadas simultaneamente. | Tente mais tarde; é recomendável intercalar uma CDN para cachear as entregas. |
| `UNKNOWN_STORAGE_SOURCE` | 400 / 404 | A requisição informou uma fonte de storage (`?storageId=`) não cadastrada neste projeto. Solicitar um `bucket` não provido por esta implantação retorna este mesmo código com status **404** (em listagens, envios simples, diretórios ou uploads resumable no S3/GCS) — o storage em si está ausente, e `details` aponta quais buckets e fontes estão disponíveis. Ambos anteriormente retornavam a mensagem enganosa de "arquivo não encontrado", idêntica a buscar uma chave inexistente. | Adicione a declaração da fonte no arquivo `config/resources.ts` ou consulte `GET /api/storage/sources`. |
| `UPLOAD_LOCKED` | 423 | Uma requisição `PATCH` de upload resumable chegou enquanto outra fatia do mesmo upload ainda estava em trânsito — frequentemente causada por retentativas prematuras do cliente HTTP. O processamento é recusado em vez de colocado em fila, mantendo conformidade com o tusd. | Consulte a posição atual chamando `HEAD /api/storage/tus/:id` e retome o envio a partir dela; a biblioteca tus-js-client implementa esse recuo e retentativa de forma nativa. Veja [Uploads resumíveis (TUS)](/docs/backend/storage-resumable-uploads/). |

## Custom functions

| Code | Status | Significado | O que fazer |
| --- | --- | --- | --- |
| `FUNCTION_NOT_FOUND` | 404 | Não há function ativa com este nome — ou ela existe, mas as rotas internas dela não atendem ao subcaminho solicitado. Chamadores logados recebem uma lista com as rotas *disponíveis*; chamadores anônimos não, para evitar enumeração de endpoints do sistema. Se o arquivo da function falhou ao carregar, a mensagem traz essa informação explicitamente para usuários logados, indicando o arquivo problemático: facilitando diferenciar um simples erro de digitação de uma falha de implantação. Requisições anônimas recebem apenas o erro padrão de nome não encontrado. | Confira o identificador correto via `GET /api/functions` ou verifique se os logs de inicialização acusam falhas de carregamento em arquivos de function. |
| `FUNCTION_TIMEOUT` | 504 | A function excedeu o tempo máximo de execução tolerado. O processo continua em execução em background, não sendo possível forçar seu cancelamento por esta interface. O retorno e o campo `details` (`{ timeoutMs, source }`) especificam o limite aplicado e onde ele foi configurado. | Utilize `AbortSignal` em chamadas externas, defina um valor específico de `timeoutMs` na function (`defineFunction(…, { timeoutMs })`, respeitando o teto de `REBASE_FUNCTIONS_MAX_TIMEOUT_MS`), ou eleve `REBASE_FUNCTIONS_TIMEOUT_MS`. |
| `FUNCTIONS_UPSTREAM_UNREACHABLE` | 502 | A requisição foi encaminhada para um processo intermediário responsável pelas functions, mas ele não respondeu. | Certifique-se de que o executor de functions está rodando e acessível. |

## Funções SQL como RPC

<span class="since-badge" data-since="0.35">Desde 0.35</span>

`POST /api/rpc/<name>` — veja [Funções SQL como RPC](/docs/backend/rpc/). Erros de parâmetros retornam `VALIDATION_CONSTRAINT` (400), com `details.violations` especificando os campos inválidos, analogamente à API de dados; tokens sem `data:read` resultam em `SCOPE_MISSING` (403); chamadas a RPCs públicas estourando limites retornam `RATE_LIMITED` (429).

| Code | Status | Significado | O que fazer |
| --- | --- | --- | --- |
| `RPC_NOT_FOUND` | 404 | Nenhuma definição `defineRpc` com este nome foi exportada em `backend/schema/index.ts`. Somente funções declaradas podem ser invocadas via RPC, portanto funções existentes no banco mas não declaradas no schema retornam este mesmo erro. | Declare a função usando `defineRpc` ou confirme a nomenclatura correta. |
| `METHOD_NOT_ALLOWED` | 405 | A RPC existe, mas a chamada não utilizou o verbo `POST`. O cabeçalho de resposta envia `Allow: POST`. | Faça a requisição utilizando `POST` com os argumentos nomeados dentro de um objeto JSON. |
| `INVALID_RPC_BODY` | 400 | O corpo enviado é um JSON válido, mas não está estruturado como um objeto com argumentos nomeados (ex: enviou um array ou string solta). | Forneça os parâmetros no formato `{ "argument": value }`, ou deixe o corpo vazio para funções sem argumentos. |
| `RPC_ARGUMENTS_MISMATCH` | 400 | Nenhuma sobrecarga da função SQL aceita os argumentos passados: um parâmetro sem `DEFAULT` não foi informado, ou foi enviado um parâmetro não previsto na assinatura da função. A mensagem especifica a lista de argumentos esperada. | Envie exatamente o conjunto aceito pela função, e marque como `.required()` no bloco de `args` quando mandatório. |
| `RPC_INVALID_ARGUMENT` | 400 | O Postgres rejeitou o formato de dado passado para o tipo exigido pelo parâmetro da função (SQLSTATE classe 22): `"abc"` informado onde se exigia `uuid`, opções fora das permitidas por um enum, etc. | Envie os valores de acordo com o tipo do parâmetro da função. |
| `RPC_EXCEPTION` | 400, ou o status correspondente ao SQLSTATE `PTnnn` | A função SQL disparou uma exceção: cláusulas `RAISE EXCEPTION '…'` respondem 400 com a mensagem de erro emitida, e `details` traz `sqlState`, `detail` e `hint`; o uso de `RAISE SQLSTATE 'PT404'` retorna status 404, seguindo a convenção do PostgREST. | Analise a mensagem emitida diretamente pelo código da função. |
| `RPC_READ_ONLY` | 500 | A função realizou mutações em dados, mas RPCs são executadas por padrão dentro de transações de leitura, a não ser que declarem `write: true`. | Insira `write: true` nas opções de configuração do `defineRpc`. |
| `RPC_FUNCTION_MISSING` | 500 | A RPC está registrada no schema da aplicação, mas a função física não existe com esse nome e schema dentro do banco de dados. O Postgres salva nomes sem aspas sempre em letras minúsculas. | Crie a função no banco ou revise os atributos de nome e `schema` configurados no `defineRpc`. |
| `RPC_AMBIGUOUS` | 500 | Existem múltiplas sobrecargas da função no banco de dados que atendem aos argumentos informados. | Remova do banco as sobrecargas que a RPC não deve acessar, ou atribua nomes diferentes a elas. |

## Notificações Push

| Code | Status | Significado | O que fazer |
| --- | --- | --- | --- |
| `PUSH_ENDPOINT_REFUSED` | 400 | O endpoint da subscrição de push não pertence a um provedor confiável de navegadores (FCM, Mozilla, Apple, Windows) via `https`. O servidor despacha notificações HTTP diretamente para esse endereço, não aceitando alvos arbitrários. | Envie a saída de `PushSubscription.toJSON()` diretamente como gerada pelo navegador, ou cadastre serviços locais de teste em `push.allowedHosts`. Veja [Notificações Push](/docs/backend/push-notifications/#routes). |
| `PUSH_NEEDS_A_USER` | 403 | Uma rota de push foi acionada utilizando uma chave de API ou a chave de serviço. Registros de notificação pertencem obrigatoriamente à sessão de uma pessoa autenticada. | Faça a chamada autenticado com a sessão do respectivo usuário. |
| `PUSH_NOT_CONFIGURED` | 503 | O serviço de push está habilitado no projeto, mas não consegue realizar disparos: chaves VAPID ausentes em produção, ou a tabela de controle de push falhou ao ser inicializada. A mensagem detalha o motivo. | Configure as variáveis `REBASE_VAPID_PUBLIC_KEY`, `REBASE_VAPID_PRIVATE_KEY` e `REBASE_VAPID_SUBJECT`. Veja [Notificações Push](/docs/backend/push-notifications/#keys). |

## Cron jobs

| Code | Status | Significado | O que fazer |
| --- | --- | --- | --- |
| `CRON_JOB_ALREADY_EXECUTING` | 409 | Tentativa de acionamento manual de um cron job que já se encontra em execução — seja no processo que recebeu a requisição ou em outro nó mantendo o lock de execução, como um worker desacoplado atrás de um processo de `api`. A execução foi desconsiderada. O histórico da tarefa registra o pulo, e `details.log` exibe esse registro; os detalhes indicam qual processo está executando a tarefa no momento. | Aguarde a conclusão da execução atual e tente novamente. Veja [Cron Jobs](/docs/backend/cron-across-instances/#concurrency-guarding). |

## Painéis de administração e edição de schema

Esses códigos indicam que determinado recurso está desligado ou sem configuração no ambiente, e não
que a requisição em si estava incorreta. Cada situação dessas é reportada na respectiva rota de `/status` com código `200`,
permitindo que painéis visuais desabilitem os botões correspondentes em vez de disparar telas de erro.

| Code | Status | Significado | O que fazer |
| --- | --- | --- | --- |
| `ADMIN_SURFACE_UNAVAILABLE` | 501 | Foi acessada uma funcionalidade exclusiva para administradores em um servidor sem autenticação configurada, impossibilitando distinguir chamadas seguras de acessos públicos. | Configure a propriedade `auth.jwtSecret` ou informe um `AuthAdapter`. |
| `BRANCH_DIFF_STALE` | 409 | Foi enviado para `POST /api/admin/branches/:name/merge` o fingerprint de um diff que não corresponde mais ao estado atual: o branch ou a base sofreram alterações nesse intervalo. Nada foi alterado. | Recalcule o diff, revise as alterações e confirme o merge informando o novo `fingerprint`. |
| `BRANCH_DIFF_UNSUPPORTED` | 501 | A base de dados não implementa comparação entre branches: ausência de recursos SQL nativos ou impossibilidade de criar branches (falta de conexão de administração). | Utilize uma infraestrutura Postgres configurando o parâmetro `adminConnectionString`. |
| `BRANCH_MERGE_BLOCKED` | 409 | Uma das tabelas com alterações não permite merge automático — tabela criada ou excluída no branch, colunas ou chave primária divergentes, tabela sem chave primária definida, excesso de linhas para correspondência, ou reescrita total desde a criação do branch (`TABLE_REWRITTEN`). Tabelas com erro de contagem bloqueiam a mesclagem mesmo marcando 0: a contagem real é indeterminada e não nula. `details.tables` lista cada ocorrência com sua justificativa. Nada foi alterado. | Execute as migrações de schema na base de destino com antecedência, ou aplique o merge com `skipBlocked: true` para ignorar as tabelas problemáticas. |
| `BRANCH_MERGE_CONFLICT` | 409 | Foram modificadas as mesmas linhas tanto no branch quanto no banco de destino, estando o modo `onConflict` definido como `"abort"` (padrão); ou o banco principal rejeitou parte do merge — modificações concorrentes, triggers cancelando ações ou políticas de RLS ocultando dados. Nada foi alterado. | Defina a prioridade de resolução através de `onConflict: "branch"` ou `"target"`, ou inspecione o diff novamente. |
| `BRANCH_MERGE_FAILED` | 409 | O banco de dados de destino rejeitou a inserção das linhas do branch durante a execução do comando de merge — falha em restrições, valores de enum incompatíveis ou quebra de chave estrangeira causados por divergências de schema entre as pontas. `details` especifica `sqlState`, `table`, `constraint` e `detail`. Nada foi alterado. | Avalie as divergências de schema reportadas no diff, alinhe a base principal rodando suas migrações, ou saneie os registros no branch antes de tentar a mesclagem de novo. |
| `BRANCH_NOT_FOUND` | 404 | O nome de branch informado não existe no registro de branches. | Use `rebase db branch list` ou verifique na aba Branches do Studio as opções existentes. |
| `CONTRACT_UNAVAILABLE` | 404 | O contrato do projeto só pode ser consultado quando a camada de autenticação está configurada — ele expõe a estrutura de todas as tabelas e relacionamentos. | Configure o módulo de autenticação. A rota `/meta/schema-version` permanece sempre acessível. |
| `DEV_MAILBOX_UNAVAILABLE` | 501 | Nenhuma caixa postal de desenvolvimento está ativa no momento. Mensagens são capturadas localmente apenas se `SMTP_HOST` estiver vazio e `NODE_ENV` não for de produção. | Limpe a variável `SMTP_HOST` em ambiente de desenvolvimento, ou consulte a caixa de correio real configurada. |
| `DOCS_UNAVAILABLE` | 404 | O endpoint `GET /api/docs` é disponibilizado apenas para os mesmos chamadores que possuem acesso à listagem de tabelas em `GET /api/schema/tables`; como este servidor não possui autenticação ativada, a documentação não é renderizada. | Configure a autenticação, ou libere a documentação publicamente para todos através de `enableSwagger: true` (`REBASE_ENABLE_SWAGGER=true`). |
| `INVALID_CHANGE` | 400 | A proposta de alteração de schema submetida é inválida. | Consulte a mensagem. |
| `SCHEMA_CHANGE_FAILED` | 400 | A aplicação de uma mudança planejada no schema falhou por um motivo que não possui código de erro específico. | Consulte a mensagem; ela traz a descrição do erro original sem alterações. |
| `SCHEMA_CHANGE_UNAPPLICABLE` | 400 | A alteração solicitada tem sintaxe válida, mas não pode ser aplicada ao estado atual do schema. | Consulte a mensagem. |
| `SCHEMA_EDIT_DIRTY_TREE` | 409 | O repositório contém arquivos com alterações pendentes (uncommitted), impedindo que a modificação do schema ocorra em segurança. | Faça commit ou execute um stash nas suas alterações locais e tente novamente. |
| `SCHEMA_EDIT_REFUSED` | 400 | O editor de schema recusou a alteração: o trecho a ser modificado utiliza sintaxes TypeScript não gerenciadas pelo editor (spread operators, helpers externos, chaves computadas), ou é uma modificação não suportada de forma automatizada (renomear tabelas, remover a última regra). `details.problems` lista cada detalhe. Nada foi salvo. | Consulte a mensagem. Faça a alteração manualmente nos arquivos dentro de `backend/schema`. |
| `SCHEMA_EDIT_DOES_NOT_COMPILE` | 400 | A alteração é suportada, mas o resultado final quebraria a compilação do schema — relação referenciando uma tabela apagada, regra apontando para coluna removida. `details.problems` detalha os erros acusados pelo compilador com suas tabelas e colunas. Nada foi salvo. | Corrija as tabelas dependentes previamente ou edite o código em `backend/schema` diretamente. |
| `SCHEMA_EDIT_STALE_FILE` | 409 | Um dos arquivos a serem alterados foi modificado no disco após a preparação desta edição (salvamento na IDE, outro processo alterando arquivos). Nada foi salvo. | Atualize o arquivo e aplique a alteração tomando como base o conteúdo mais recente. |
| `SCHEMA_EDIT_REQUIRES_A_PERSON` | 403 | Foi tentada uma aplicação de mudança de schema utilizando uma chave de API ou credencial de máquina. | Efetue login como usuário comum ou ative `liveSchema.allowMachineApply`. |
| `SCHEMA_EDITING_NO_COLLECTIONS_DIR` | 501 | A edição de schema em tempo real exige apontar `schemaDir` (o diretório `backend/schema`) ou `liveSchema.repository`, e este servidor não definiu nenhum dos dois. O código preserva o nome original por retrocompatibilidade. | Defina um desses parâmetros. |
| `SCHEMA_EDITING_NO_REPOSITORY` | 503 | O planejamento da alteração funciona, mas não há um repositório git configurado para versionar o commit das mudanças — cenário comum em servidores rodando bundles já compilados ou quando `backend/schema` não está sob controle de versão (as aplicações exigem commit das alterações). | Execute `git init` na raiz do projeto e reinicie o servidor (o repositório é detectado no boot) ou configure a opção `liveSchema.repository`. |
| `SCHEMA_EDITING_PROVISIONING_OFF` | 409 | Esta implantação está configurada para não aplicar modificações estruturais no banco (`REBASE_PROVISION=false`), bloqueando alterações vindas do painel. | Faça o commit dessas alterações apenas no código-fonte e deixe que o pipeline responsável pelas migrações as execute no banco. |
| `SCHEMA_EDITING_UNSUPPORTED` | 503 | O driver de banco de dados em uso não suporta o planejamento automatizado de mudanças de schema. | A edição de schema ao vivo está disponível apenas sobre bancos Postgres. |
| `SCHEMA_EDITOR_BAAS_MODE` | 501 | As tabelas desta aplicação são introspectadas a partir do próprio banco de dados, inexistindo arquivos locais de schema para edição. | Execute as mudanças de schema através de migrações convencionais. |
| `SCHEMA_EDITOR_DISABLED` | 501 | O editor de schema está desabilitado neste servidor. Aplicações rodando a partir de bundles compilados retornam sempre esse código. | Habilite o editor através de `schemaEditor`. Para bundles, utilize `REBASE_LIVE_SCHEMA_REPOSITORY` para editar `backend/schema` por meio de integração com repositório git — veja [Edição de schema ao vivo](/docs/backend/live-schema-editing#from-a-built-bundle). |
| `SCHEMA_EDITOR_MISSING_DEPENDENCY` | 501 | O editor de schema depende da biblioteca `ts-morph`, que não se encontra instalada nas dependências do ambiente. | Instale-a no pacote que inicializa o backend e reinicie o processo: execute `pnpm --dir backend add -D ts-morph@28.0.0` a partir da raiz de projetos scaffolded, ou `pnpm add -D ts-morph@28.0.0` em projetos onde o backend reside na raiz. A mensagem de erro fornece a linha de comando exata para o seu caso. |
| `SCHEMA_EDITOR_NO_COLLECTIONS_DIR` | 501 | O servidor não possui o parâmetro `schemaDir` definido, impossibilitando o editor de encontrar os arquivos para alteração. O código de erro mantém o termo legado. | Defina o caminho em `schemaDir`. |
| `SCHEMA_EDITOR_PRODUCTION` | 501 | O editor permanece desativado sob `NODE_ENV=production`: em servidores de produção os arquivos são reconstruídos a partir do repositório a cada deploy, o que faria qualquer edição feita no painel ser descartada no próximo ciclo. | Edite os arquivos em `backend/schema` localmente em desenvolvimento e faça o deploy, ou configure `liveSchema.repository` para versionar as alterações via commits diretamente. |
| `SCHEMA_UNAVAILABLE` | 404 | Chamada a `GET /api/schema/tables` em um backend sem mecanismo de autenticação ativo: não há identidade de chamador para aplicar filtros de visibilidade sobre as tabelas, e utilizar `auth.requireAuth: false` não anula esse comportamento. | Configure um adaptador de auth ou a variável `auth.jwtSecret`. Veja [Endpoints](/docs/backend/endpoints/#schema). |
| `TABLE_NOT_FOUND` | 404 | O endpoint `GET /api/schema/tables/:slug` aponta para uma tabela não servida ao chamador — slug inexistente ou fora do alcance dos escopos da credencial atual. | Verifique o slug informado e analise se a credencial contém os escopos `data:*` apropriados. |
| `UI_PREFERENCES_NEED_A_PERSON` | 403 | Rota `/api/admin/ui-config` invocada via chave de API, token de plataforma ou chave de serviço. As preferências visuais de interface são exclusivas de usuários reais autenticados. | Faça a requisição utilizando a sessão de um usuário. |
| `UI_PREFERENCES_TOO_LARGE` | 413 | As preferências de interface de uma única tabela ultrapassaram o tamanho máximo de 64 KB. | Reduza o volume salvo: esse arquivo deve guardar metadados de apresentação e não conteúdo de dados. |
| `UI_PREFERENCES_UNSUPPORTED` | 501 | O driver deste backend não possui suporte à execução de SQL, impossibilitando a persistência de configurações de UI no banco; o painel guarda os dados localmente no navegador. | Nada a corrigir: os parâmetros continuam mantidos isoladamente por navegador. |
| `UI_CONFIG_FILE_INVALID` | 500 | O arquivo `frontend/src/cms/ui-config.json`, onde são gravadas as opções de layout em desenvolvimento, contém formatação JSON inválida. | Corrija os erros ou delete o arquivo; o painel cria um novo arquivo válido no próximo salvamento. |
| `SQL_EXPORT_UNSUPPORTED` | 501 | O endpoint `POST /api/admin/sql/csv` não pode fornecer streaming de dados neste contexto: o banco local de desenvolvimento (PGlite) opera com uma conexão única, e manter um cursor aberto para download bloquearia todas as outras operações; ou a fonte de dados não suporta cursores SQL. | Configure a variável `DATABASE_URL` para um servidor Postgres convencional (`rebase dev --docker` sobe um) ou limite com `LIMIT` e exporte a partir dos dados em tela. |

### Reconciliação de schema

O comando [`rebase schema reconcile`](/docs/cli/schema/#rebase-schema-reconcile) faz o planejamento
por `POST /api/admin/schema/reconcile/plan` e aplica via
`/reconcile/apply`. Uma recusa não altera o estado; apenas `SCHEMA_RECONCILE_FAILED`
deixa partes do plano aplicadas.

| Code | Status | Significado | O que fazer |
| --- | --- | --- | --- |
| `INVALID_RECONCILE` | 400 | O corpo da requisição não é um objeto JSON, ou `drop` não segue o formato de lista de strings `"<table>.<column>"`. | Envie no formato `{ "drop": ["voice_cache.wav"] }` ou omita a chave `drop`. |
| `SCHEMA_RECONCILE_FAILED` | 400 | A execução falhou no meio do processo. As instruções anteriores foram consolidadas e permanecem ativas; `details.applied` enumera as etapas concluídas. | Corrija o problema apontado na mensagem e recalcule o plano: o novo plano ignora automaticamente o que já foi aplicado. |
| `SCHEMA_RECONCILE_INVALID` | 400 | O plano não pode ser aplicado; a mensagem traz os impedimentos: item em `drop` sem a convenção `<table>.<column>`, nomes inexistentes de tabela/coluna, ou indicação de remoção para uma coluna que ainda se encontra declarada no schema. `details.plan` expõe o plano gerado. | Ajuste a listagem de `drop`. Para remover uma coluna existente no código, exclua-a do respectivo `defineTable`, faça deploy e proceda com o reconcile. |
| `SCHEMA_RECONCILE_STALE` | 409 | O banco de dados ou os arquivos de schema mudaram após o cálculo do plano confirmado. `details.plan` exibe a nova proposta calculada. | Valide a nova proposta de alteração e confirme submetendo o novo `digest`. |
| `SCHEMA_RECONCILE_UNCONFIRMED` | 400 | A rota `/reconcile/apply` foi chamada sem o valor de `confirm`. | Planeje antes e informe o `digest` obtido no campo `confirm`. A CLI automatiza essa etapa após a digitação de `yes`. |
| `SCHEMA_RECONCILE_UNSUPPORTED` | 503 | O driver do backend não possui suporte para planejar reconciliação ou não possui acesso a execução SQL direta. | A operação de reconciliação exige banco de dados Postgres. |

### Por que a tabela de um branch não pode sofrer merge

O erro `BRANCH_MERGE_BLOCKED` enumera no array `details.tables` cada tabela rejeitada, acompanhada de
um desses códigos. Esse mesmo código é anotado no objeto `blocked` no próprio diff,
permitindo ao Studio avisar sobre o bloqueio antes do clique em **Merge**. Nenhum desses itens constitui um código HTTP avulso.

| Code | Status | Significado | O que fazer |
| --- | --- | --- | --- |
| `COLUMNS_DIFFER` | — | A lista de colunas da tabela diverge entre o branch e a base de destino. A correspondência de linhas avalia exclusivamente colunas em comum. | Inclua na base de destino as colunas em falta executando suas migrações (`rebase db push`), e faça o merge em seguida. Alterações que reescrevem totalmente a tabela — como troca de tipos de dados — convertem esse estado em `TABLE_REWRITTEN`: execute o merge antes de aplicar mudanças desse tipo, ou crie o branch novamente depois de aplicá-las. |
| `NO_PRIMARY_KEY` | — | A tabela não tem chave primária, inviabilizando relacionar as linhas par a par; o diff apresenta exclusivamente as contagens totais. | Configure uma chave primária na tabela, ou migre os registros manualmente. |
| `PRIMARY_KEY_DIFFERS` | — | A chave primária é composta por colunas distintas ou tipos de dados divergentes entre as pontas. | Padronize o schema aplicando as devidas alterações estruturais na base de destino primeiro. |
| `TABLE_ADDED` | — | A tabela foi criada exclusivamente no branch. O processo de merge não cria tabelas. | Crie a tabela na base pai executando suas migrações e faça o merge das linhas em seguida. |
| `TABLE_DROPPED` | — | A tabela foi excluída no branch. O processo de merge não apaga tabelas. | Realize a exclusão da tabela na base de destino utilizando suas migrações. |
| `TABLE_REWRITTEN` | — | Uma das bases recriou fisicamente todas as linhas da tabela após o branch ter sido gerado — operações de alteração de tipo, `ADD COLUMN` com default volátil, `VACUUM FULL`, `CLUSTER` — fazendo todas as linhas parecerem ter sido modificadas e impedindo rastrear quem alterou o quê. | Faça o merge do branch antes de rodar migrações com esse impacto, ou recrie o branch a partir da base principal atualizada. |
| `TOO_LARGE` | — | A tabela possui mais linhas em uma das bases do que o limite permitido para comparação individual (100.000 por padrão, `maxRowsPerTable`). | Eleve o valor de `maxRowsPerTable` na visualização do diff e na rotina de merge, ou migre o volume de linhas por outra abordagem. |

## Códigos genéricos

Utilizados pelas rotas quando não há uma classificação de erro mais granular disponível.

| Code | Status | Significado | O que fazer |
| --- | --- | --- | --- |
| `BAD_REQUEST` | 400 | Requisição malformada, sem categorização mais específica. | Consulte a mensagem. |
| `UNAUTHORIZED` | 401 | Chamador não autenticado ou credencial inválida. | Faça login ou renove o token de acesso. |
| `FORBIDDEN` | 403 | Autenticado, mas sem privilégios suficientes para a ação. | Tentar novamente com as mesmas credenciais não surtirá efeito. |
| `CONFLICT` | 409 | Operação em conflito com o estado atual do recurso. | Consulte a mensagem. |
| `INTERNAL_ERROR` | 500 | Erro interno no servidor. A mensagem é deliberadamente genérica por segurança. | Localize o problema nos logs do servidor utilizando o valor de `requestId`. |
| `NOT_CONFIGURED` | 503 | Uma dependência exigida por esta rota não foi configurada neste servidor. | Consulte a mensagem. |
| `SERVICE_UNAVAILABLE` | 503 | Não foi possível alcançar um serviço do qual a requisição depende: bucket S3/MinIO fora do ar, ou falha de conexão/DNS em endpoints chamados via `fetch()` em uma function. O log do servidor expõe o host afetado; a resposta HTTP omite esse dado por segurança. Quedas no banco retornam `DATABASE_UNAVAILABLE`. Interrupções de conexão com esses serviços respondem com este código. | Tente novamente e inspecione os logs do servidor. |

## Garantindo a exatidão desta página

O script `pnpm verify:docs` falha caso algum código lançado pelo servidor esteja ausente destas
tabelas, caso uma tabela documente um código nunca lançado pelo código-fonte, se os códigos HTTP atribuídos a uma linha divergirem dos
efetivamente lançados, ou caso uma família como `PG_<SQLSTATE>` não contenha a linha descritiva
de um SQLSTATE comum aos chamadores. A validação é gerenciada pelo script
`tooling/scripts/docs-verify/check-error-codes.mjs`.

Ele valida o seu próprio algoritmo antes da análise. Como a varredura extrai os códigos diretamente dos fontes TypeScript
em vez de consultar uma instância do servidor em execução, erros de análise estática seriam silenciosos por natureza:
no passado, a validação não detectava códigos envolvidos em wrappers inline de uma linha ou declarados logo após
mensagens contendo parênteses `)`, o que gerava falso-positivos reportando "todos os códigos do servidor estão documentados"
em páginas onde faltavam dezessete definições. Por conta disso, o script executa um fixture simulando exatamente
essas peculiaridades de código antes de ler esta documentação, recusando-se a validar o arquivo caso não seja capaz
de identificá-las corretamente.
