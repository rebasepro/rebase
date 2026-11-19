---
sourceHash: 6f63c3908efa23c5
title: Códigos de erro
sidebar_label: Códigos de erro
description: Todos os códigos de erro que um backend Rebase pode retornar, com seu status HTTP, o que significa e o que fazer a respeito — além do envelope de resposta, X-Request-ID e as regras de details.
---

Todas as falhas retornadas por um backend Rebase usam um único envelope e carregam um
`code` estável. O código é o elemento usado para criar ramificações lógicas (branching): a mensagem é escrita para uma pessoa
e pode ser reformulada, o status é compartilhado por dezenas de problemas diferentes, e o
código não é nenhum dos dois.

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
- **`code`** — um dos valores abaixo. Estável entre versões secundárias (minor versions).
- **`details`** — opcional e nunca garantido. Veja as regras abaixo.
- **`requestId`** — presente sempre que a requisição tiver passado pelo middleware
  de request-ID, o que inclui todas as rotas sob `basePath`.

### `X-Request-ID`

Toda requisição sob `basePath` recebe um ID: o cabeçalho `X-Request-ID` do chamador
quando for um UUID, caso contrário, um novo. Ele é retornado na
resposta como `X-Request-ID`, incluído no envelope de erro como `requestId` e
anexado à linha de log do servidor para aquela requisição.

Essa é a chave de junção. Cite-a em um relatório de bug e um operador poderá encontrar a
única linha de log que explica a falha, trazendo o motivo que nunca foi exibido
ao cliente.

Enviar o seu próprio é a forma como um rastreamento sobrevive a um salto (hop): um gateway ou um job runner que
encaminha o cabeçalho obtém um único ID em todos os serviços que processaram a requisição.
Um valor inválido é ignorado em vez de rejeitado — um cabeçalho malformado vindo de um
chamador não justifica falhar uma requisição — portanto, não presuma que o ID enviado é
o ID recebido. Leia o cabeçalho de resposta.

### O que há em `details`

`details` tem caráter de diagnóstico, não contratual. Três regras o regem:

1. **Qualquer coisa definida explicitamente por uma rota é sempre retornada.** São os
   erros do próprio chamador descritos com precisão: qual campo de filtro era desconhecido,
   qual relação não permite escrita, qual valor não correspondeu ao seu tipo.
2. **Os diagnósticos de banco de dados são reduzidos em produção.** Quando a falha se originou
   no Postgres, `details.dbCode` — o SQLSTATE — está sempre presente: ele nomeia
   a classe do problema e não revela nada sobre os dados. `dbMessage`,
   `detail` e `hint` são adicionados apenas quando `NODE_ENV` não for `production`,
   pois o Postgres inclui o conteúdo das linhas neles. O código `23505` relata
   `Key (email)=(a@b.c) already exists.`, o que responde "esta pessoa
   está cadastrada?" para qualquer endereço que qualquer pessoa decida testar.
3. **Nunca crie lógica condicional (branch) em cima de `details`.** Crie a lógica em cima de `code`. O conteúdo sob `details` é
   qualquer coisa que tenha sido útil para uma pessoa naquele ponto de chamada, e ele muda.

## Lendo um status

| Status | O que diz sobre a requisição |
| --- | --- |
| `400` | Malformada, ou solicitando algo que não existe no esquema. Corrija a requisição. |
| `401` | Não autenticado, ou a credencial expirou. Faça login ou renove o token. |
| `403` | Autenticado, mas sem permissão. Tentar novamente com a mesma identidade não ajudará. |
| `404` | Rota, tabela ou linha inexistente — ou uma linha ocultada pela segurança em nível de linha (RLS). |
| `409` | Um conflito com o estado existente: duplicata ou uma gravação concorrente. |
| `413` `415` `422` | O corpo é muito grande, tipo de mídia incorreto ou semanticamente rejeitado. |
| `429` | Limite de taxa atingido (rate limited). Aguarde; a mensagem informa por quanto tempo. |
| `500` | O servidor ou seu banco de dados está com erro, não o chamador. Verifique os logs. |
| `501` | A rota existe, mas esta implantação não pode atendê-la — um recurso desativado ou não configurado. |
| `502` `503` `504` | Uma dependência estava inacessível, não configurada ou muito lenta. |

## Autenticação e contas

| Código | Status | Significado | O que fazer |
| --- | --- | --- | --- |
| `AAL2_REQUIRED` | 403 | A rota precisa de um segundo fator e a sessão possui apenas um. | Complete o desafio de MFA e tente novamente. |
| `ALREADY_VERIFIED` | 400 | O endereço ou fator já foi verificado. | Nada — o estado desejado já é verdadeiro. |
| `ACCOUNT_OUTRANKS_CALLER` | 403 | A conta sendo editada, redefinida ou excluída possui uma role ou escopo que o chamador não possui. `details.beyond` lista quais são. | Peça para alguém que os possua fazer a alteração. |
| `ANONYMOUS_AUTH_DISABLED` | 403 | O login anônimo está desativado neste servidor. | Ative-o ou faça login com uma identidade real. |
| `ANONYMOUS_NOT_ALLOWED` | 403 | Uma sessão de convidado tentou aprovar o login de um dispositivo. Um convidado não tem conta para vincular a um dispositivo. | Faça login com uma conta e depois aprove-o. |
| `API_KEY_SELF_MANAGEMENT_FORBIDDEN` | 403 | Uma chave de API tentou listar, criar, alterar ou revogar chaves de API, do mesmo tipo ou pessoais. | Gerencie chaves como uma pessoa com a permissão `keys:write` ou usando a service key. |
| `AUTH_MIDDLEWARE_MISSING` | 500 | Uma rota protegida foi executada sem nenhum middleware de autenticação Rebase antes dela, logo a credencial do chamador nunca foi verificada. | Monte a aplicação por meio do roteador de funções em vez de montá-la diretamente no seu próprio servidor. |
| `BOOTSTRAP_ANONYMOUS` | 403 | A inicialização do primeiro admin (bootstrap) foi tentada por um chamador anônimo. | Faça login primeiro. |
| `BOOTSTRAP_COMPLETED` | 403 | O primeiro administrador já existe. | Peça a um administrador existente para conceder a role. |
| `BOOTSTRAP_NOT_FIRST_USER` | 403 | O bootstrap é exclusivo para o primeiríssimo usuário, e este não é ele. | Peça a um administrador existente para conceder a role. |
| `CAPTCHA_FAILED` | 400 | O provedor rejeitou o token de CAPTCHA. | Resolva um novo desafio. |
| `CAPTCHA_REQUIRED` | 400 | A rota exige um token de CAPTCHA e nenhum foi enviado. | Inclua o token. |
| `CHALLENGE_EXHAUSTED` | 401 | Tentativas incorretas em excesso para um mesmo desafio de MFA. | Inicie um novo desafio. |
| `DEVICE_LOGIN_DECIDED` | 409 | O login do dispositivo já foi aprovado ou negado. Um login só é decidido uma vez. | Inicie um novo no dispositivo. |
| `DEVICE_LOGIN_EXPIRED` | 410 | O login do dispositivo ultrapassou os dez minutos antes de ser decidido. | Inicie um novo no dispositivo. |
| `DEVICE_LOGIN_NOT_FOUND` | 404 | Nenhum login de dispositivo possui esse código de usuário. A própria sondagem (polling) do dispositivo responde com os códigos em minúsculas da RFC 8628: `authorization_pending`, `slow_down`, `access_denied`, `expired_token`, `invalid_grant`. | Compare o código com o exibido no dispositivo. |
| `EMAIL_EXISTS` | 409 | Uma conta com esse endereço já existe — no cadastro, na alteração de endereço ou ao acessar um link de alteração de endereço quando outra conta assumiu o endereço enquanto aguardava. | Faça login ou inicie a redefinição de senha; para alteração de endereço, escolha outro. |
| `EMAIL_NOT_CONFIGURED` | 503 | Magic links ou OTP foram solicitados, mas o servidor não possui transporte de e-mail. | Configure o SMTP ou use outro método de login. |
| `EMAIL_NOT_VERIFIED` | 403 | Um login OAuth encontrou uma conta com o mesmo endereço, mas o provedor não verificou esse endereço, portanto ela não foi vinculada. | Faça login com o método existente e execute `POST /auth/link/<provider>`. |
| `FACTOR_NOT_VERIFIED` | 400 | O fator MFA foi registrado, mas nunca confirmado. | Confirme o fator. |
| `IDENTITY_ALREADY_LINKED` | 409 | Essa identidade OAuth pertence a outra conta. | Faça login com ela ou desvincule-a de lá primeiro. |
| `IMPERSONATION_FORBIDDEN` | 403 | Uma requisição enviou `x-rebase-impersonate`, mas o chamador não tem permissão para executar uma requisição como outro usuário. Apenas a própria sessão de um administrador autenticado pode, nunca uma chave de API ou a service key. | Envie com a sessão de um administrador ou omita o cabeçalho. |
| `IMPERSONATION_INVALID` | 400 | `x-rebase-impersonate` foi enviado vazio. | Envie o uid do usuário a ser personificado ou omita o cabeçalho. |
| `IMPERSONATION_TARGET_NOT_FOUND` | 404 | `x-rebase-impersonate` aponta para nenhum usuário ativo: nenhuma conta possui esse uid ou ela está desativada. | Verifique o uid. |
| `IMPERSONATION_UNAVAILABLE` | 501 | A autenticação deste backend não pode executar uma requisição como outro usuário, pois seu `AuthAdapter` não possui `resolveUser`. | Implemente `resolveUser` no adaptador ou omita o cabeçalho. |
| `IMPERSONATION_UNSUPPORTED` | 400 | `x-rebase-impersonate` foi enviado para uma rota que não pode rodar como outro usuário. Apenas a API de dados e funções personalizadas aceitam esse cabeçalho, e o socket realtime aceita `impersonate` em `AUTHENTICATE`. | Envie a requisição sem o cabeçalho. |
| `SIMULATION_FORBIDDEN` | 403 | Uma requisição enviou um cabeçalho `x-rebase-simulate-*` (o simulador de RLS) ou chamou `/api/admin/rls-simulator`, e o chamador não tem permissão para simular acesso. Apenas a sessão de um administrador autenticado pode, nunca uma chave de API ou a service key. | Envie com a sessão de um administrador ou omita os cabeçalhos. |
| `SIMULATION_INVALID` | 400 | A simulação estava malformada: um cabeçalho enviado vazio, `x-rebase-simulate-api-key-id` combinado com uma role ou user id, ou simulação combinada com `x-rebase-impersonate`. | Especifique uma role (opcionalmente com um uid), um user id ou um id de chave de API. |
| `SIMULATION_READ_ONLY` | 403 | Uma gravação, exclusão, `_batch`, reversão de histórico ou uma função personalizada chamada por qualquer verbo que não seja `GET`/`HEAD`/`OPTIONS` continha um cabeçalho `x-rebase-simulate-*`. O acesso simulado é somente leitura: a gravação seria executada como a identidade simulada, não como o administrador. Leituras, incluindo `POST …/query` e `…/count`, continuam funcionando. | Encerre a simulação para fazer alterações. |
| `SIMULATION_TARGET_NOT_FOUND` | 404 | A simulação aponta para nenhum usuário ativo (um user id enviado sem role) ou nenhuma chave de API válida. | Verifique o id ou envie uma role com o uid para simular um uid sem conta associada. |
| `SIMULATION_UNAVAILABLE` | 501 | Este backend não pode simular acesso: seu `AuthAdapter` não tem `resolveUser` para confirmar um administrador, ou uma chave foi informada em um backend sem chaves de API. | Implemente `resolveUser` ou omita os cabeçalhos. |
| `SIMULATION_UNSUPPORTED` | 400 | Um cabeçalho `x-rebase-simulate-*` foi enviado para uma rota que não aceita execução com acesso simulado. Apenas a API de dados e funções personalizadas os aceitam. | Envie a requisição sem os cabeçalhos. |
| `GUEST_REFERENCED` | 409 | Um convidado não pôde ser excluído porque uma linha do próprio projeto depende dele, por meio de uma chave estrangeira com `ON DELETE RESTRICT` ou `NO ACTION`. `DELETE /api/admin/guests` reporta isso por convidado em `skipped` e continua. | Exclua a linha ou mantenha o convidado. |
| `INVALID_ACCOUNT` | 400 | A conta está em um estado sobre o qual esta operação não pode atuar. | Veja a mensagem. |
| `INVALID_CHALLENGE` | 400 | O desafio de MFA é desconhecido ou expirou. | Inicie um novo. |
| `INVALID_CODE` | 400 / 401 | O código OTP ou MFA está incorreto: 400 no login por código de e-mail (`/auth/otp/verify`), 401 no registro ou desafio de MFA. | Tente novamente com o código atual. |
| `INVALID_CREDENTIALS` | 401 | E-mail ou senha incorretos — deliberadamente sem especificar qual. | Tente novamente ou redefina a senha. |
| `INVALID_PLATFORM_TOKEN` | 401 | Um token de plataforma `rpt_` foi recusado: assinatura inválida, audiência errada, expirado ou validade acima do teto permitido. A mensagem informa o motivo. | Solicite à plataforma a geração de um novo — no Rebase Cloud, execute o comando novamente. |
| `INVALID_SCOPES` | 400 | Foi solicitado a uma chave algo que não é um escopo: malformado, desconhecido ou com um destino que o escopo não aceita. `details.problems` diz qual e o motivo; `details.validScopes` lista os escopos que uma chave pode possuir. Não inclui `keys:read` e `keys:write`, que nenhuma chave pode ter. | Use um nome da lista. Veja [Roles and scopes](/docs/backend/roles-and-scopes/). |
| `INVALID_TOKEN` | 400 / 401 | Um token de verificação, redefinição, magic link ou alteração de endereço está malformado, desconhecido, já utilizado ou expirado (400). Uma credencial de provedor OAuth ou um refresh token que falha na validação retorna 401. | Solicite um novo link ou faça login novamente. |
| `INVALID_USER_CODE` | 400 | O que foi enviado como código de login do dispositivo não é válido: deve ter oito letras, como `BCDF-GHJK`. | Copie o código exibido no dispositivo. |
| `INVALID_ROLE` | 400 | O nome de uma role sendo gravada não é uma string, está vazio ou contém `,` `{` `}` `"` `\` ou caracteres de controle. Esses caracteres seriam interpretados como outras roles: uma role trafega em um `text[]` do Postgres e na lista separada por vírgulas dividida pelas políticas de RLS, então `"support,admin"` retornaria como `admin`. `details.problems` indica cada uma. | Renomeie a role. Qualquer outro nome é aceito. |
| `KEY_MANAGEMENT_SCOPE` | 400 | Foi solicitado a uma chave o escopo `keys:read` ou `keys:write`. Nenhuma chave pode gerenciar chaves. `details.scopes` lista quais foram. | Remova-os da solicitação. |
| `KEY_OUTRANKS_CALLER` | 403 | Um detentor de `keys:write` tentou alterar ou revogar uma service key que possui uma role ou escopo que ele não possui. Apenas um admin pode gerenciar qualquer chave. `details.roles` e `details.scopes` indicam o que a chave possui além do chamador. | Peça a um admin, ou a alguém que possua tais permissões, para alterar a chave. |
| `LAST_ADMIN` | 403 | A alteração deixaria o projeto sem nenhum administrador. | Promova outra pessoa primeiro. |
| `MFA_REQUIRED` | 401 | A senha estava correta e a conta possui um segundo fator verificado, portanto o login está apenas pela metade. `details` traz um token de curta duração com escopo restrito ao desafio de MFA — não é uma sessão. | Abra um desafio e responda-o; a resposta do desafio emitirá a sessão. |
| `NO_SESSION` | 401 | Nenhum cookie de sessão ou refresh token foi apresentado. Normal no carregamento inicial da página. | Faça login. |
| `NOT_ANONYMOUS` | 400 | Uma rota de upgrade a partir de anônimo foi chamada por uma conta real, ou `DELETE /api/admin/guests/:uid` apontou para uma. | Nada a atualizar. Para excluir uma conta, use `DELETE /api/admin/users/:uid`. |
| `OAUTH_ERROR` | 401 | O provedor OAuth recusou a autenticação ou retornou um erro. | Tente o fluxo novamente; a mensagem contém a justificativa do provedor. |
| `PERSONAL_KEYS_DISABLED` | 403 | Chaves de API pessoais estão desativadas neste backend. | Defina `personalKeys: true` nas opções de `auth` da tabela de autenticação (`defineAuthTable`). |
| `PERSONAL_KEY_NEEDS_ACCOUNT` | 403 | A service key ou uma sessão de convidado tentou usar as rotas de chave pessoal. Nenhuma das duas possui uma conta para a chave representar. | Faça login em uma conta ou crie uma service key sob `/api/admin/api-keys`. |
| `PLATFORM_TOKENS_OFF` | 401 | Um token de plataforma `rpt_` chegou a um servidor que não os aceita: `REBASE_PLATFORM_TOKEN_KEY` e `REBASE_PLATFORM_TOKEN_AUDIENCE` não estão definidos. | A plataforma que hospeda o app define ambos no deploy; faça um novo deploy ou entre no aplicativo por outro método. |
| `RATE_LIMITED` | 429 | Tentativas em excesso por parte deste chamador. | Aguarde; a mensagem informa por quanto tempo. |
| `REDIRECT_URI_NOT_ALLOWED` | 400 | O destino de redirecionamento não está na lista de permissões (allow-list). | Adicione-o à configuração do provedor. |
| `REGISTRATION_DISABLED` | 403 | O autocadastro está desativado. | Peça a um administrador para criar a conta. |
| `ROLE_EXCEEDS_CALLER` | 403 | As roles sendo concedidas possuem um escopo, ou `admin`, que o chamador não possui. `details.beyond` as lista. | Peça a alguém que as possua para conceder a role. |
| `ROLE_EXCEEDS_CREATOR` | 403 | Uma service key recebeu uma role de RLS que seu criador não possui. Apenas um admin pode conceder qualquer role. `details.roles` as lista. | Remova a role ou peça para um admin criar a chave. |
| `ROLE_EXISTS` | 409 | Esse nome de role já está em uso. | Escolha outro nome. |
| `ROLE_LOOKUP_FAILED` | 503 | Não foi possível consultar as roles do chamador — em uma rota de admin ou em uma requisição de dados em um backend com `config.auth`. Fecha o acesso (fail-closed) em vez de confiar nas roles contidas no token. Um token cujo uid não aponta para nenhuma conta, incluindo um uid incompatível com a tabela de usuários, retorna 401, não este erro. Um banco de dados inacessível resulta em `DATABASE_UNAVAILABLE`, não neste erro. | Tente novamente; verifique o banco de dados. |
| `SCOPE_EXCEEDS_CREATOR` | 403 | Foi solicitado a uma chave um escopo que seu criador não possui. Uma chave nunca possui mais privilégios que a conta que a gerou. `details.scopes` os lista. | Remova-os ou solicite a criação da chave a alguém que os possua. |
| `SCOPE_MISSING` | 403 | A credencial não possui o escopo necessário para esta rota, tabela, fonte de storage ou função. `details.requiredScope` informa qual é, incluindo o destino. | Para uma pessoa, obtenha uma role que declare o escopo. Para uma chave, use uma chave que o possua. Veja [Roles and scopes](/docs/backend/roles-and-scopes/). |
| `SCOPE_NOT_DECLARED` | 500 | Uma rota protegida com `requireScope` especifica um escopo de app que este backend não declara, de forma que ninguém o possui, nem mesmo um administrador. Um nome que nem sequer é um escopo, ou um nativo com erro de digitação como `data:raed`, nunca chega a este ponto: `requireScope` lança um erro no registro da rota. | Declare o escopo sob `auth.scopes` na tabela de autenticação ou corrija o nome. Veja [Roles and scopes](/docs/backend/roles-and-scopes/). |
| `SELF_DELETE` | 400 | Um administrador tentou excluir a própria conta. | Peça para outro administrador fazê-lo. |
| `SESSION_REVOKED` | 401 | A sessão foi encerrada em outro lugar, todas as sessões foram revogadas ou a conta foi excluída. Todas as portas de entrada que aceitam sessão respondem com este código para tal token de acesso: a API de dados, storage, funções personalizadas e as rotas de admin. O socket realtime recusa o comando `AUTHENTICATE` com um frame `AUTH_ERROR` carregando o mesmo código. O SDK tenta renovar (refresh), a renovação é recusada e o logout ocorre. | Faça login novamente. |
| `ACCOUNT_DISABLED` | 401/403 | Um administrador desativou a conta: login (403), refresh e todos os tokens que ela possui (401) são recusados em todas as portas de entrada que aceitam sessão. O socket realtime recusa seu `AUTHENTICATE` com um frame `AUTH_ERROR` contendo o mesmo código. | Contate um administrador. |
| `EMAIL_NOT_CONFIRMED` | 403 | `requireEmailVerification` está ativado e o endereço ainda não foi verificado. Retornado apenas para senha correta; um novo link é enviado por e-mail. | Acesse o link enviado no e-mail. |
| `PROOF_REQUIRED` | 409 | `POST /auth/verify-email`: a conta possui uma senha ou identidade que ninguém comprovou, e a requisição não comprova nenhuma das duas. O token não é consumido. | Envie `password` para mantê-la ou `removeUnproven: true` para verificar sem ela. |
| `UNDELIVERABLE_ADDRESS` | 400 / 409 | Foi solicitado e-mail de verificação para um endereço que não recebe mensagens — o de um convidado ou o placeholder do X (400) — ou uma conta solicitou mudança para tal endereço (409, `POST /auth/change-email`). | Defina um endereço real primeiro. |
| `EMAIL_UNCHANGED` | 400 | `POST /auth/change-email` informou o endereço atual da conta. | Nada a alterar. |
| `ANONYMOUS_USER` | 403 | Um convidado solicitou a alteração de seu endereço de e-mail; convidados não possuem e-mail próprio. | Converta-o em uma conta primeiro (`POST /auth/anonymous/link`). |
| `MFA_NOT_ENROLLED` | 400 | Códigos de recuperação foram solicitados para uma conta sem nenhum segundo fator verificado. | Registre um fator primeiro. |
| `HOOK_REJECTED` | 400 | Um hook `beforeUserCreate`, `beforeLogin`, `beforeUserDelete` ou `beforeEmailChange` disparou um erro. A mensagem é a do próprio hook; um hook que selecionou um status 4xx responde com ele. | Veja a mensagem. |
| `INVALID_JSON` | 400 | O corpo da requisição não é um JSON válido. | Envie um corpo no formato JSON. |
| `SELF_DISABLE` | 400 | Um administrador tentou desativar a própria conta. | Peça a outro administrador. |
| `NOT_SUPPORTED` | 501 | O repositório de autenticação deste backend não consegue realizar o que foi solicitado (desativar contas, alterar um endereço). | Reinicie o servidor para que a coluna seja adicionada ou use um repositório compatível. |
| `UNKNOWN_SCOPE_TARGET` | 400 | O destino de um escopo faz referência a uma tabela, fonte de storage ou função que este backend não atende. `details` lista os destinos válidos. | Corrija o destino. |
| `UNVERIFIED_IDENTITIES` | 409 | Um magic link, código de e-mail ou redefinição de senha comprovou o endereço de uma conta não verificada, e a conta possui uma identidade de login cujo provedor nunca verificou esse endereço. O repositório de autenticação não consegue removê-la (não possui `unlinkUserIdentity`), portanto a prova é recusada para não deixar essa porta de entrada aberta em uma conta verificada. | Implemente `unlinkUserIdentity` no repositório de autenticação customizado ou peça para um admin revisar a conta. |
| `SETUP_REQUIRED` | 403 | O projeto ainda não possui um admin configurado, portanto esta rota não está disponível. | Complete a configuração inicial do primeiro administrador. |
| `TOKEN_ALREADY_USED` | 401 | Um token de uso único foi reutilizado, ou um refresh token que foi rotacionado há mais de `refreshTokenReuseIntervalSeconds` atrás. | Solicite um novo ou faça login novamente. |
| `TOKEN_EXPIRED` | 401 | O token ultrapassou o seu tempo de vida útil. | Solicite um novo. |
| `USER_NOT_FOUND` | 404 | Nenhuma conta encontrada com esse id. | Verifique o id. |
| `WEAK_PASSWORD` | 400 | A senha não atende à [política de senhas](/docs/backend/auth-endpoints/#password-policy) (por padrão, 8+ caracteres com letra maiúscula, minúscula e dígito) — no cadastro, redefinição, alteração ou senha escolhida por administrador: `POST /api/admin/users`, criação na tabela de autenticação via API de dados, `PUT /api/admin/users/:id` ou `POST /api/admin/users/:id/reset-password`. | Escolha uma senha mais forte. Um administrador importando contas pode enviar `skipPasswordPolicy: true` na criação. |

## Dados, consultas e gravações

| Código | Status | Significado | O que fazer |
| --- | --- | --- | --- |
| `AGGREGATE_MASKED_BY_AFTER_READ` | 400 | Um agregado diferente de `count()` sem `groupBy` em uma tabela reescrita por um hook `afterRead` (global, de tabela ou `.transform()` de coluna). Um agregado lê os valores armazenados e nunca executa o hook; portanto, soma, mínimo, máximo, contagem de campos ou agrupamento leriam o que o hook oculta. | Use `count()` sem `groupBy` ou leia as linhas, que passam pelo hook. |
| `AGGREGATE_NOT_SUPPORTED` | 501 | Este driver não consegue calcular o agregado solicitado. | Use um driver compatível ou calcule no cliente. |
| `BRANCHING_UNSUPPORTED` | — | Uma ramificação (branch) de banco de dados foi solicitada via websocket do Studio no banco de dados de desenvolvimento gerenciado (PGlite), onde um branch *é* o próprio pai e nada ficaria isolado. A recusa é a mesma exibida por `rebase db branch`. | Aponte `DATABASE_URL` para uma instância própria do Postgres (`rebase dev --docker` inicia uma) e crie branches nela. |
| `BATCH_TOO_LARGE` | 400 | `POST /api/data/_batch` contém mais operações do que o limite por lote (1000 por padrão). Um lote equivale a uma única transação e mantém seus bloqueios durante toda a execução. | Envie em partes menores; a mensagem informa o limite e a sua contagem. |
| `BATCH_UNSUPPORTED` | 400 | O driver deste backend não consegue gravar em múltiplas tabelas atomicamente, e um loop de gravações individuais não seria atômico nem executado em uma única viagem de rede (round trip). | Envie as gravações como requisições separadas ou como chamadas `/bulk` por tabela. |
| `BULK_TOO_LARGE` | 400 | O corpo da requisição bulk excede o limite de itens configurado. | Divida a requisição. |
| `BULK_UNSUPPORTED` | 400 | Esta tabela ou driver não oferece suporte a gravações em massa (bulk). | Grave as linhas uma a uma. |
| `CALLBACK_REJECTED` | 400 / 403 | Um hook de tabela recusou a gravação. Um `throw` lançado em `beforeSave`/`beforeDelete`/`after*` resulta em 400 trazendo a mensagem do próprio autor; um `beforeDelete` que retorna `false` resulta em 403. `details.stage` indica qual hook e `details.path` a tabela. | Leia a mensagem — ela foi escrita por este projeto, não pelo Rebase. |
| `CALLBACK_RECURSION` | 500 | Gravações iniciadas por hooks aninharam-se a uma profundidade superior a 16 níveis: a gravação de um hook via `context.data` dispara os hooks daquela tabela novamente, e nada na cadeia interrompe o ciclo — geralmente um `afterSave` que atualiza a própria linha incondicionalmente. Toda a gravação sofreu rollback. A mensagem indica o hook e a tabela; `details.chain` lista cada etapa hook → gravação. | Torne a gravação do hook condicional: atue apenas em `status === "new"`, ou ignore quando `values` já contiverem o que seria gravado. |
| `COMPOSITE_KEY_ADDRESS` | 400 | A tabela possui uma chave composta e o endereço na URL indica um número diferente de partes que a compõem. | Enderece a linha como `<parte1>:::<parte2>`, cada parte codificada para URL (URL-encoded), na ordem da chave; `details.primaryKey` lista as colunas. |
| `TABLE_READ_ONLY` | 405 | Uma tentativa de gravação atingiu uma view (`defineView`). Views são somente leitura. Anteriormente `COLLECTION_READ_ONLY`. | Realize a gravação nas tabelas lidas pela view. Veja [Views](/docs/collections/views/). |
| `TABLE_WITHHELD` | 503 | A tabela foi declarada, mas o banco de dados não a protege: o RLS está desativado, nenhuma das políticas declaradas está presente ou falta uma política restritiva declarada. (Uma política permissiva ausente ainda é atendida, com um aviso de boot indicando-a.) Isso ocorre quando o servidor não provisiona suas tabelas (`REBASE_PROVISION=false`, `provisionSchema: false`, `provision.tables: false`, `REBASE_MIGRATE_ON_BOOT=none`), e o servidor retém a tabela em vez de expor todas as linhas a todos os chamadores. Uma junção many-to-many segue a mesma regra: se falhar, as tabelas cujas relações dependem dela são retidas e a mensagem identifica a junção; o mesmo vale para uma tabela cujo `via` passe por uma tabela retida. Uma leitura ou filtro de relação que passe por uma tabela retida também retorna este código. As demais tabelas continuam sendo servidas. O log de inicialização informa os comandos necessários para protegê-la. | Execute os comandos informados no log de boot (`rebase db push` faz isso) e reinicie. Ou, se a aplicação gerenciar o acesso a essa tabela por conta própria, declare `rlsRequired: false` nela (ou `database({ rls: { required: false } })`) e reinicie. |
| `SQL_NOT_ALLOWED` | 400 | O SQL executado como o chamador (`getSql(c)`, `withAuth(user).sql`) não era uma única instrução pura `SELECT`, `WITH`, `VALUES`, `TABLE`, `INSERT`, `UPDATE`, `DELETE` ou `MERGE`, ou chamou `set_config` ou fez referência a `pg_settings`. A identidade do chamador reside nas configurações da sessão, portanto qualquer comando capaz de alterá-las é recusado. | Mantenha o texto da consulta próprio, em uma única instrução, com todos os valores em `params`. Veja [Custom functions](/docs/backend/custom-functions/#3-getsqlc--sql-as-the-caller). |
| `CURSOR_WITH_OFFSET` | 400 | `?after=` foi combinado com `?offset=` ou `?page=`. O cursor já especifica onde a página inicia, portanto aplicar um deslocamento adicional pula silenciosamente essa quantidade de linhas após o cursor — criando uma lacuna invisível na resposta para o chamador. | Use um ou outro. |
| `DISTINCT_NOT_APPLICABLE` | 400 | `?distinct=true` foi combinado com busca textual ou consulta vetorial. Ambas atribuem uma pontuação (score) por linha, logo duas linhas nunca são estritamente iguais e o `DISTINCT` não agruparia nada — pareceria funcionar sem alterar nenhum dado. | Remova uma das duas opções. |
| `DISTINCT_ORDER_BY_NOT_SELECTED` | 400 | Uma leitura `distinct` é ordenada por uma coluna que ela não retorna. Um `SELECT DISTINCT` só pode ser ordenado por colunas presentes na sua lista de seleção, caso contrário as linhas agrupadas não têm ordem definida. `details.fields` as identifica. | Adicione esses campos em `?fields=` ou remova-os de `?orderBy=`. |
| `DATABASE_UNAVAILABLE` | 503 | Não foi possível conectar ao banco de dados: conexão recusada ou perdida, o host não pôde ser resolvido, o servidor está iniciando/encerrando ou o banco está fechado para novas conexões (`ALLOW_CONNECTIONS false`, deixado na fonte caso um comando `rebase db branch create --force` seja interrompido no meio; o log do servidor indica o banco, e `rebase db branch list` o reabre). Todas as portas de entrada retornam este erro, incluindo login, rotas de admin e o socket realtime (frame `ERROR`). Enviado com o cabeçalho `Retry-After: 5`. | Tente novamente; o SDK faz isso automaticamente. Verifique se o banco de dados está rodando e acessível pelo servidor. |
| `DB_CONNECTIONS_EXHAUSTED` | 503 | O servidor de banco de dados recusou uma nova conexão por esgotamento de conexões disponíveis (`53300` clientes demais, `53400` limite de conexões de uma role ou do banco). Todas as instâncias compartilham o `max_connections` do servidor; este é o problema típico ao rodar várias instâncias com pools grandes sem um pooler. Trata-se de sobrecarga, não de falha interna; enviado com `Retry-After: 2`. O servidor registra a solução no log uma vez por minuto. | Tente novamente; o SDK faz isso. Reduza `DB_POOL_MAX` (ou limite com `REBASE_DB_POOL_MAX`) entre as instâncias, coloque um pooler na frente do banco (`DATABASE_POOLED`) ou aumente `max_connections`. |
| `DB_CONNECT_TIMEOUT` | 503 | A abertura de uma nova conexão com o banco de dados demorou mais que `DB_POOL_CONNECT_TIMEOUT`: o banco está demorando para aceitar conexões ou está distante na rede. Enviado com `Retry-After`. | Tente novamente; o SDK faz isso. Verifique a carga do banco de dados e a latência de rede até ele. |
| `DB_PERMISSION_DENIED` | 500 | O Postgres recusou a instrução (`42501`): uma política de segurança em nível de linha (RLS) bloqueando esta role ou falta de permissão via `GRANT`. | Veja [Troubleshooting](/docs/troubleshooting/). |
| `DB_POOL_EXHAUSTED` | 503 | Todas as conexões do pool permaneceram ocupadas por mais tempo que `DB_POOL_CONNECT_TIMEOUT`, logo esta requisição nunca alcançou o banco. Sobrecarga, não falha; enviado com `Retry-After`. O servidor registra a solução no log uma vez por minuto. | Tente novamente; o SDK faz isso. Aumente `DB_POOL_MAX` ou localize as consultas lentas e transações longas que estão retendo as conexões. |
| `FIELD_NOT_READABLE` | 400 | Um filtro, `orderBy`, `fields`, agregação `select` ou `groupBy` referencia um campo que as roles do chamador não podem ler (`access.read`), um caminho aninhado ou ordenação agregada referencia uma relação sem permissão de leitura — ou uma operação de campo (`$inc`, `$push`, …) tem como alvo um campo onde uma restrição recusada revelaria o valor armazenado. Um campo que não pode constar na resposta não pode ser interrogado por nenhuma consulta, caso contrário o valor seria descoberto predicado por predicado. Filtros por relação (`author.salary`) e ordenações agregadas sobre campo de relação (`max(staff.salary)`) são julgados pelas regras do destino. `details.violations` indica cada campo. O driver aplica a mesma regra a leituras no mesmo processo em nome do chamador (`context.data` no escopo do chamador) e a buscas vetoriais, includes ou checagens de unicidade. Uma coluna com `.private()` responde como se não existisse: qualquer filtro, `orderBy`, `fields`, `include`, agregação `select` ou `groupBy`, ou `vector_search` que a mencione recebe a mesma resposta dada a um nome incorreto (`UNKNOWN_FILTER_FIELD`, `UNKNOWN_ORDER_BY_FIELD`, `UNKNOWN_FIELD`, `UNKNOWN_RELATION`, `UNKNOWN_AGGREGATE_FIELD` ou `UNKNOWN_VECTOR_PROPERTY`), e nenhuma resposta de campo desconhecido a incluirá na lista. | Remova o campo da consulta ou obtenha a role necessária. Veja [Field access](/docs/collections/field-access/). |
| `FIELD_NOT_WRITABLE` | 400 / 403 | O corpo define um campo que as roles deste chamador não podem gravar (`access.write`). Recusado em vez de descartado: uma gravação que ignorasse um campo reportaria sucesso para uma edição que não aconteceu. O mesmo código recusa gravações através de um elemento pai que defina uma relação que o chamador não pode gravar, e atualizações que tentem definir um valor para o campo de `softDelete` — apenas a exclusão pode marcá-lo. O socket realtime retorna 403 com este código para gravações através de caminhos aninhados cuja tabela pai, relação ou tabela de destino não sejam atendidas ali, em vez de repassá-la sem validação ao driver. `details.violations` indica cada campo. | Remova o campo ou obtenha a role necessária. Um campo que ninguém pode gravar retorna `VALIDATION_EXCLUDED_FIELDS`. |
| `FILTERED_USER_WRITE` | 400 | Uma atualização ou exclusão com filtro foi enviada para a tabela de autenticação via HTTP, cujas alterações exigem validação individual usuário por usuário antes da execução. | Consulte os usuários e use `updateMany`/`deleteMany` filtrando por id. |
| `FILTER_REQUIRED` | 400 | Uma gravação filtrada (atualização ou exclusão por `where`/`logical`, vinda do SDK ou rotas bulk) não possui condições, o que afetaria todas as linhas. Recusada antes de qualquer execução. | Adicione uma condição. Se o objetivo for realmente alterar todas as linhas, defina uma condição que todas as linhas atendam. |
| `HISTORY_UNAVAILABLE` | 503 | Uma gravação em tabela com `history: true` foi recusada porque sua entrada de histórico não pôde ser gravada: o banco de dados não possui a tabela `rebase.entity_history` ou, no caso de `openRebase` e `rebase console`, a função `rebase.record_history`. Nenhum backend com histórico foi inicializado neste banco. Nada foi executado, hooks inclusos, e leituras não são afetadas. Lançado por `openRebase` e retornado por backends criados com `provision: false`. | Inicialize o backend uma vez com histórico ativado e `provision: true` (`rebase dev` faz isso) e tente novamente. |
| `HISTORY_UNSERVABLE` | 501 | O driver de dados da tabela não consegue executar as regras de leitura e hooks `afterRead` sobre as linhas armazenadas (`DataDriver.serveStoredRows`), e o histórico nunca é exposto sem máscara. O driver empacotado do Postgres oferece suporte. | Implemente `serveStoredRows` no driver customizado. Veja [History](/docs/backend/history/). |
| `IDEMPOTENCY_KEY_IN_PROGRESS` | 409 | Uma requisição anterior com a mesma `Idempotency-Key` ainda está em processamento. | Tente novamente assim que ela terminar. |
| `IDEMPOTENCY_KEY_REUSED` | 422 | A mesma `Idempotency-Key` foi enviada em uma requisição diferente: outro método, caminho, query string ou corpo. | Use uma nova chave ou envie a requisição original. |
| `INVALID_AGGREGATE_FUNCTION` | 400 | `?select=` indicou uma função que não é de agregação (`count`, `sum`, `avg`, `min`, `max`, `countDistinct`, `mode`, `percentile`, `distinct`, `fingerprint`). | Use uma destas; a mensagem traz a lista completa. |
| `INVALID_AGGREGATE_GROUP` | 400 | Uma transformação de `groupBy` é desconhecida ou não se aplica à coluna: `year`/`month`/`day` em coluna que não é data, `unnest` em coluna que não é array. | Use `lower`, `upper`, `year`, `month`, `day` ou `unnest` em uma coluna do tipo correto. |
| `INVALID_AGGREGATE_SELECT` | 400 | Um item de `?select=` não segue o formato `fn(field)`; uma função diferente de `count()` ou `fingerprint()` não recebeu campo; `percentile` não tem fração entre 0 e 1; ou `fingerprint()` foi solicitado para uma view simples, que não armazena linhas. | Escreva `sum(total)`, `count()`, `percentile(price,0.95)`. |
| `INVALID_AGGREGATE_WINDOW` | 400 | `offset`, `page` ou `orderBy` aplicados a uma agregação sem `groupBy`, ou cursor em qualquer agregação. Uma agregação sem agrupamento retorna uma única linha, e um grupo não é uma linha sobre a qual um cursor possa avançar. | Adicione `groupBy` ou remova esses parâmetros; pagine grupos com `offset` ou `page`. Veja [Aggregates](/docs/sdk/aggregates-and-search/#aggregates). |
| `INVALID_BATCH_BODY` | 400 | Uma operação em `/_batch` não possui `op`, `table`, `values` ou `id`, referencia uma tabela não atendida por este backend ou reutiliza um nome em `ref`. | Veja a mensagem; ela indica o índice da operação com erro. |
| `INVALID_BATCH_REF` | 400 | Um `{ "$ref": "<name>.<field>" }` aponta para uma operação inexistente, faz referência futura ou pede um campo inexistente na linha referenciada. Apenas referências retroativas são resolvidas. | Defina a operação com `ref` *antes* de fazer referência a ela. |
| `INVALID_BULK_BODY` | 400 | O corpo da requisição bulk não possui a estrutura esperada. | Envie o array esperado pela rota: `{ "rows": [...] }` para `POST /bulk`, `{ "updates": [{ "id", "data" }] }` para `PATCH /bulk`, `{ "ids": [...] }` para `POST /bulk/delete`. |
| `INVALID_CONFLICT_RULE` | 400 | A regra de conflito de um upsert (manter duplicatas ou substituir somente sob um `where`) foi enviada sem `upsert: true`, ou ambas as regras foram enviadas juntas. | Envie `upsert: true` e apenas uma das duas opções. |
| `INVALID_CONFLICT_TARGET` | 400 | O `on_conflict` / `onConflict` de um upsert referencia colunas sem garantia de unicidade, faz referência sem `upsert: true`, ou foi enviado em uma criação aninhada, onde uma linha correspondente passaria para o novo pai. Caso contrário, o Postgres responderia com 42P10 no meio de uma transação que já realizou trabalho. Ocorre também em qualquer upsert na tabela de autenticação, onde criação e atualização seguem regras distintas. | Declare `.unique()` na coluna ou crie um índice `unique`; a mensagem lista os destinos válidos existentes. Na tabela de usuários, envie `POST` para criar e `PATCH` para atualizar. |
| `INVALID_COUNT` | 400 | `?count=` não é `exact` nem `none`. Recusado em vez de assumir o padrão: um erro de digitação como `?count=nnone` pagaria pelo custo de contagem que se pretendia evitar. | Envie `exact` (padrão) ou `none`. Veja [Skipping the count](/docs/backend/api/#skipping-the-count). |
| `INVALID_CURSOR` | 400 | O cursor `after` não pôde ser lido ou faz referência a um id incompatível com as colunas-chave da tabela: foi truncado, recodificado ou criado manualmente. Um cursor válido enviado com ordenação diferente da qual foi gerado resulta em `CURSOR_ORDER_MISMATCH`, também um 400. | Repasse o valor `meta.nextCursor` da página anterior sem alterações, acompanhado do mesmo `orderBy` ou nenhum. Veja [Pagination](/docs/sdk/pagination/). |
| `INVALID_DELETED_PARAM` | 400 | `?deleted=` não é `include` nem `only`. Recusado em vez de ignorado: um erro como `?deleted=true` que ocultasse silenciosamente todas as linhas excluídas pareceria funcionar, mas responderia à pergunta oposta. | Envie `include` (ativas e excluídas) ou `only` (somente excluídas). Omita o parâmetro para ver apenas linhas ativas. |
| `INVALID_DISTINCT` | 400 | `?distinct=` não é `true` nem `false`. | Envie um desses valores; `1` e `0` também são aceitos. |
| `INVALID_FIELD_OPERATION` | 400 | `$inc` / `$push` / `$pull` / `$merge` foi aplicado a um tipo de coluna incompatível, com operando no formato incorreto, múltiplos operadores no mesmo campo, erro de grafia, ou na criação — onde não há valor armazenado anterior para operar. | Veja [Writing over REST](/docs/backend/writes/#field-operations); a mensagem indica o campo. |
| `INVALID_FILTERED_WRITE` | 400 | Uma gravação filtrada indicou um caminho por meio de relação (`posts/1/comments`) ou nenhuma tabela. | Grave diretamente na tabela relacionada filtrando pela ligação correspondente. |
| `INVALID_FILTER_FIELD` | 400 | O filtro referencia uma coluna inexistente nesta tabela. | Verifique a grafia em relação à estrutura da tabela. |
| `INVALID_FILTER_OPERATOR` | 400 | O operador não é compatível com o tipo desta coluna — por exemplo, `like` em número ou data. | Veja [Querying data](/docs/sdk/querying/). |
| `INVALID_FILTER_VALUE` | 400 | O valor do filtro não pode ser interpretado como o tipo da coluna comparada: `?id=eq.abc` em chave inteira, valor fora do enum, timestamp inválido ou número fora dos limites do tipo. `details.dbCode` traz o SQLSTATE correspondente. | Envie um valor compatível com o tipo da coluna. |
| `INVALID_HARD_PARAM` | 400 | `?hard=` não é `true` nem `false`. Qualquer outro valor é recusado em vez de interpretado como "não" — um erro que resulte em soft-delete quando se desejava purgar definitivamente faz o chamador crer que o dado foi apagado. | Envie `true` ou `false`. |
| `INVALID_INCLUDE` | 400 | `?include=` está malformado: não é uma lista de caminhos válida ou o objeto de opções da relação possui formato incorreto. Caminhos aninhados além de três saltos retornam `INCLUDE_TOO_DEEP`, também um 400. Rejeitado na borda da aplicação em vez de estourar como 500 no driver. | Veja a mensagem; ela indica o caminho incorreto. |
| `INVALID_INPUT` | 400 | O corpo da requisição falhou na validação. | Veja a mensagem. |
| `INVALID_LIMIT` | 400 | `?limit=` não é um número inteiro entre 1 e o máximo permitido (1000 por padrão); valores maiores são recusados, não ajustados automaticamente. Assinaturas realtime solicitando limites fora da faixa recebem o mesmo código em um frame `ERROR` do WebSocket. | Reduza o limite e pagine o restante dos dados. |
| `INVALID_LOGICAL_GROUP` | 400 | Um agrupamento `?or=` / `?and=` / `?not=` está malformado ou aninhado além do limite permitido. | Veja a mensagem; ela exibe a regra de simplificação (flattening). |
| `INVALID_OFFSET` | 400 | `?offset=` não é um número inteiro maior ou igual a 0. | Envie um inteiro não negativo. |
| `INVALID_ORDER_BY` | 400 | `?orderBy=` não corresponde a `field`, `field:desc`, `field:desc:last` ou um array JSON de `{ field, direction, nulls }` — ou indica direção diferente de `asc`/`desc`, ou posicionamento de nulos diferente de `first`/`last`. | Veja a mensagem; ela lista todas as grafias aceitas. |
| `INVALID_PAGE` | 400 | `?page=` não é um número inteiro maior ou igual a 1. Páginas são baseadas em 1, logo `?page=0` é considerado erro e não a primeira página. | Envie `1` ou superior, ou utilize `?offset=`. |
| `INVALID_PARAM` | 400 | Um parâmetro da consulta está malformado. | Veja a mensagem. |
| `INVALID_QUERY_BODY` | 400 | O corpo de `POST …/query` contém um valor inválido para a URL: uma lista para parâmetro lido uma única vez (`fields`, `limit`, …), um objeto para filtro, ou qualquer parâmetro duplicado na própria URL — `POST …/query` lê todos os parâmetros do corpo. | Formate cada valor como na URL — string, ou lista para filtro repetido; `where`, `include`, `orderBy` e `vector` aceitam JSON. Veja [Queries too long for a URL](/docs/backend/vector-search/#queries-too-long-for-a-url). |
| `INVALID_VECTOR` | 400 | `?vector=` não é um array JSON de números. | Envie no formato `[0.1,0.2,0.3]`. |
| `INVALID_VECTOR_DISTANCE` | 400 | `?vector_distance=` não é `cosine`, `l2` nem `inner_product`. | Use uma dessas três opções. |
| `INVALID_VECTOR_THRESHOLD` | 400 | `?vector_threshold=` não é um número. | Envie um número. |
| `INVALID_WHERE` | 400 | `?where=` não é um objeto JSON mapeando campos para condições. | Envie no formato `{"status":["==","active"]}`. |
| `KEY_IMMUTABLE` | 400 | Uma atualização altera a chave da linha para um valor diferente do endereço original — no corpo ou por meio de um `beforeSave`. Uma linha não pode mudar de chave: todas as etapas posteriores à gravação (releitura, `afterSave`, histórico, realtime) referenciam-na pela chave anterior. Recusado antes da execução de qualquer hook, sem gravar nada, em todos os pontos de entrada. `details.violations` indica o campo. | Crie a linha com a nova chave e exclua a anterior. Manter a mesma chave atual é perfeitamente válido. |
| `MISSING_AGGREGATE_SELECT` | 400 | A rota de agregação foi chamada sem o parâmetro `?select=`. | Adicione o parâmetro, por exemplo `?select=count()`. |
| `NOT_A_MATERIALIZED_VIEW` | 400 | `refresh()` foi chamado em uma tabela que não corresponde a uma view materializada. | Execute refresh apenas em views criadas com `defineView(…, { materialized: true })`. |
| `NO_TABLES` | 404 | O projeto não possui tabelas servidas: nenhuma declarada em `backend/schema` e nenhuma identificada no banco por introspecção. Se existirem tabelas com RLS desativado, a mensagem as lista com o SQL necessário para ativá-lo, e `details.unprotectedTables` as enumera. Anteriormente `NO_COLLECTIONS`. | Crie tabelas — via migration, SQL ou arquivo `defineTable` acompanhado de `rebase db push` — e reinicie. |
| `NOT_FOUND` | 404 | Nenhuma linha com esse id encontrada nessa tabela — ou a linha é ocultada do chamador pelo RLS. | Verifique o id e, em seguida, as regras de `rls` da tabela. |
| `UNKNOWN_RELATION` | 400 / 404 | `?include=` referencia algo que não é uma relação da tabela. O mesmo código responde com **404** quando um *caminho da URL* aninhado referencia uma relação inexistente, por exemplo `/api/data/authors/1/posts` onde `authors` não a declara — nesse caso a URL não aponta para nada, sendo tratada como recurso não encontrado em vez de requisição malformada. | Verifique o nome da relação — a mensagem lista as disponíveis na tabela. Relações reversas precisam ser declaradas na tabela pai para navegação. |
| `ORDER_BY_FIELD_NOT_SORTABLE` | 400 | A ordenação referencia um campo que não aceita ordenação. | Ordene por uma coluna válida. |
| `PAGE_WITH_OFFSET` | 400 | `?page=` foi combinado com `?offset=` — ou `page` com `offset` dentro de `find()`, rejeitado com o mesmo código pelo client SDK, pelo `rebase.data` em processo e pelo cliente offline antes do envio. Ambos definem a mesma janela, e antigamente `page` prevalecia silenciosamente sobre um `offset` que nunca era aplicado. | Envie apenas um deles. |
| `PAYLOAD_TOO_LARGE` | 413 | O corpo excede o limite configurado. | Envie menos dados ou aumente o limite. |
| `READ_ONLY_TRANSACTION` | 409 | Um hook `afterRead` tentou realizar gravação. Leituras no escopo da requisição rodam em transação `READ ONLY`, portanto nem o hook nem nada chamado por ele pode efetuar gravações. | Mova a gravação para fora da leitura: use um background job ou chame `rebase.dataAsAdmin` em uma tarefa cron ou função customizada. |
| `REFRESH_NOT_SUPPORTED` | 501 | `POST /api/data/<slug>/refresh` foi enviado para um driver sem suporte a views materializadas. | Não há o que atualizar neste backend. |
| `RELATION_HAS_NO_PIVOT` | 400 | A gravação continha dados de junção (payload de link), mas o caminho não alcança o destino por meio de um `manyToMany` com `pivot` declarado — logo, não há tabela/linha intermediária para recebê-los. | Declare colunas de `pivot` na relação ou remova o payload da gravação. Veja [Relations](/docs/collections/relations/). |
| `RELATION_MISCONFIGURED` | 500 | A relação não resolve contra o esquema registrado. A operação é recusada em vez de ignorada: descartá-la reportaria sucesso para uma gravação que nunca ocorreu ou lista vazia para linhas existentes. | Execute `rebase schema generate` se o esquema gerado for mais antigo que o banco de dados. |
| `RELATION_NOT_UNLINKABLE` | 400 | A relação não pode ser desvinculada a partir deste lado. | Execute a gravação a partir do lado proprietário (owning side). |
| `RELATION_NOT_WRITABLE` | 400 | O caminho aninhado não é uma relação gravável, ou a criação/atualização especifica uma relação `via` de múltiplos saltos — somente relações `via` de salto único permitem escrita. `details.fields` lista as chaves `via`. Nada foi gravado. | Grave diretamente nas linhas ligadas pela cadeia. Veja [Relations](/docs/collections/relations/#via--an-explicit-join-chain). |
| `RELATION_PIVOT_UNSUPPORTED` | 400 | A relação declara colunas de junção, mas esta fonte de dados não suporta gravação nelas. | O vínculo em si funciona; apenas os dados adicionais associados falham. Verifique os recursos suportados pelo driver. |
| `RELATION_SOURCE_KEY_EMPTY` | 400 | Uma gravação de relação não possuía chave de origem para fixar a ligação. | Salve a linha pai primeiro. |
| `RESULT_TOO_LARGE` | — | Uma instrução executada via `EXECUTE_SQL` no socket realtime — `admin.executeSql` a partir do cliente ou leituras de catálogo no painel admin — retornou mais de 128 MB de linhas, portanto o resultado foi descartado. Enviado como frame `ERROR` do WebSocket. As consultas manuais no console SQL não são bloqueadas: exibem apenas as primeiras linhas. | Adicione `LIMIT` ou selecione menos colunas, lendo os resultados em partes. |
| `ROW_IN_TRASH` | 409 | A chave do upsert pertence a uma linha na lixeira (uma linha com soft-delete ainda ocupa sua chave). O upsert não altera linhas excluídas, em nenhum ponto de entrada: `?on_conflict=` REST, upserts `/bulk` e `/_batch`, SDK e socket realtime. Nada foi gravado. | Restaure a linha antes (atualizando o campo de soft-delete para `null`) ou elimine-a com `?hard=true` antes de tentar o upsert novamente. Veja [Soft delete](/docs/collections/soft-delete/). |
| `SCHEMA_DRIFT` | 500 | Uma tabela ou coluna esperada pelo código não existe no banco de dados. | Execute `rebase db push` em desenvolvimento; faça novo deploy em instâncias gerenciadas. |
| `SCORE_CURSOR_UNSUPPORTED` | 400 | `startAfter` foi usado em conjunto com `orderBy: "_score"`. A relevância é calculada por consulta e não armazenada, não podendo servir de chave para cursor. | Pagine os resultados por relevância usando `limit`/`offset` ou ordene por uma coluna. |
| `SQL_ERROR` | 400 | O banco recusou o SQL fornecido. No comando `EXECUTE_SQL` do socket realtime, resulta em um frame `ERROR` com a mensagem do banco. `POST /api/admin/sql/csv` retorna este erro antes do envio do arquivo: erro de sintaxe, tentativa de gravação (download opera em read-only), mais de uma instrução ou uso de role não permitida para a conexão. | Corrija o SQL. O download aceita uma única instrução `SELECT`, `WITH … SELECT`, `TABLE` ou `VALUES`. |
| `VIEW_NOT_READABLE` | 403 | Um chamador que não possui nenhuma das `view.roles` da view materializada tentou lê-la ou atualizá-la. Views materializadas não contam com RLS, sendo disponibilizadas integralmente e apenas para essas roles. | Leia com uma das roles autorizadas ou declare a role do chamador em `view.roles`. |
| `TENANT_IMMUTABLE` | 400 | Uma gravação moveria uma linha de um tenant para outro. Linhas não podem trocar de tenant. `details.violations` indica o campo. Uma trigger impõe a mesma restrição no banco, logo SQL rodado como chamador falha com erro Postgres `42501` e mensagem iniciada por `TENANT_IMMUTABLE`. | Crie a linha no outro tenant e exclua esta, ou execute a gravação com uma role presente em `tenant.bypassRoles`. |
| `TENANT_MISMATCH` | 400 | A gravação referencia um tenant ao qual este chamador não pertence; o banco também recusaria a operação. | Grave em um tenant pertencente ao chamador ou autentique-se com credenciais vinculadas a ele. |
| `TENANT_REQUIRED` | 400 | A tabela pertence a escopo de tenant e o tenant não pôde ser inferido: a requisição não informa nenhum ou o chamador pertence a vários. | Informe o campo de tenant explicitamente ou autentique-se como chamador associado a um único tenant. |
| `TRANSACTION_ABORTED` | 500 | Uma instrução na transação de gravação falhou e um hook capturou o erro. Como o Postgres já havia abortado a transação, a gravação sofreu rollback e nada foi persistido. Apenas criações, atualizações ou exclusões via `context.data` que o banco recuse são revertidas de forma isolada e podem ser capturadas com segurança. | Deixe a falha lançar o erro ou valide antes de rodar o comando. Veja [Transaction Semantics](/docs/collections/context-data-api/#transaction-semantics). |
| `UNKNOWN_FIELD` | 400 | `?fields=` referencia um campo inexistente na tabela. | Verifique a grafia; a mensagem lista os campos válidos. |
| `UNKNOWN_AGGREGATE_FIELD` | 400 | Uma agregação ou `groupBy` referencia um campo inexistente na tabela. | Verifique a grafia; a mensagem lista os campos válidos. |
| `UNKNOWN_FILTER_FIELD` | 400 | O filtro referencia um campo inexistente na tabela — ou no destino de uma relação —, ou uma coluna marcada como `.private()`. | Verifique a grafia; a mensagem lista os campos válidos. |
| `UNKNOWN_FILTER_OPERATOR` | 400 | O filtro referencia um operador inexistente. | A mensagem lista todos os operadores disponíveis. |
| `UNKNOWN_MESSAGE_TYPE` | 400 | Um frame do socket realtime traz um `type` não processado pelo servidor. Respondido como frame `ERROR` contendo o `requestId` da requisição, permitindo seu encerramento em vez de estourar timeout. | Verifique o `type` do frame; a mensagem indica qual foi recebido. |
| `UNKNOWN_ORDER_BY_FIELD` | 400 | A ordenação referencia um campo inexistente nesta tabela. | Verifique a grafia; a mensagem lista os campos válidos. |
| `PRECONDITION_FAILED` | 412 | O cabeçalho `If-Match` informou uma versão da linha desatualizada: outra gravação ocorreu entre a leitura e esta tentativa. Nada foi gravado. | Leia a linha novamente, reaplique as modificações e envie o novo `ETag`. |
| `UNKNOWN_RESPONSE_FIELD` | 400 | `?fields=` solicita um campo inexistente na tabela. | Verifique a grafia; a mensagem lista os campos conhecidos. |
| `UNKNOWN_VECTOR_PROPERTY` | 400 | A busca vetorial indicou uma coluna que não é do tipo `col.vector()` nesta tabela. | A mensagem lista as colunas vetoriais da tabela. |
| `UNSUPPORTED_MEDIA_TYPE` | 415 | O `Content-Type` não é aceito por esta rota. | Envie o formato especificado na documentação da rota. |
| `UNSUPPORTED_OPTION` | — | Lançado como exceção, não retornado como resposta HTTP: uma gravação através do acessor interno em processo (`context.data` em hook, `rebase.data` em função ou cron) recebeu `ifMatch` ou `idempotencyKey`. Esse meio de acesso não possui checagem de pré-condições nem armazenamento de idempotência, logo a opção é recusada antes da escrita em vez de ignorada. | Remova a opção na chamada interna ou faça a gravação via cliente HTTP, que suporta ambas. |
| `UNSUPPORTED_RELATION_FILTER` | 400 | O filtro atravessa uma relação `via`, cujo caminho de join é definido em sentido único, impossibilitando correlacionar a subconsulta de volta. | Filtre a partir do lado proprietário. |
| `UNSUPPORTED_RELATION_FILTER_OPERATOR` | 400 | O operador não é compatível com esse campo: relações sem coluna direta nesta linha são filtradas por pertinência, e correspondência de padrões (`like`, `ilike` e negações) aplica-se somente a texto. | Veja a mensagem; ela lista o que o campo aceita. |
| `VALIDATION_CONSTRAINT` | 400 | Um valor violou uma regra declarada na coluna (`.validate()`, `.notNull()`, `.oneOf()`) — tamanho, intervalo, padrão, campo obrigatório ou valor fora da lista. Cada item em `details.violations` possui um `code`: `required`, `min_length`, `max_length`, `length`, `min`, `max`, `less_than`, `more_than`, `positive`, `negative`, `integer`, `pattern`, `email`, `url`, `enum`, `min_items`, `max_items`, `unique_items` (array com o mesmo item repetido, `$push` incluso), `unique_by` (dois itens de array JSON com mesmo valor no campo indicado por `uniqueBy`), `date_min`, `date_max`, `geopoint_range`. | Veja a mensagem; ela indica a tabela, a coluna e cada violação. |
| `VALIDATION_EXCLUDED_FIELDS` | 400 | O corpo tenta gravar em coluna marcada como `.private()` ou `.access({ write: [] })` — a mesma regra com duas sintaxes. O preenchimento cabe exclusivamente ao servidor: hash de senha, token de verificação. Diferente de `FIELD_NOT_WRITABLE`, esta resposta é idêntica para qualquer chamador, incluindo `admin`. | Remova o campo. Veja [Field access](/docs/collections/field-access/). |
| `VALIDATION_INVALID_VALUE` | 400 | O valor é incompatível com o tipo da coluna. | Veja a mensagem; ela indica a coluna. |
| `VALIDATION_UNKNOWN_FIELDS` | 400 | O corpo lista um campo inexistente na tabela — incluindo argumento `id` em tabela cuja chave primária utiliza outro nome. | Verifique a grafia; a mensagem ("Table 'x' has no column 'f'. Known columns: …") lista as colunas existentes. |
| `VECTOR_CURSOR_UNSUPPORTED` | 400 | Um cursor (`after` / `startAfter`) foi combinado com busca vetorial. As linhas são ordenadas por distância calculada na própria consulta, o que não pode servir de chave de cursor; portanto, listagens vetoriais não retornam `nextCursor`. | Pagine os resultados mais próximos utilizando `limit`/`offset`. |
| `WRITE_DENIED` | 403 | Uma regra de segurança ou política de RLS recusou a gravação. | Verifique as regras de `rls` da tabela. |

## `PG_<SQLSTATE>` — restrição recusada pelo banco de dados

Uma gravação rejeitada pelo Postgres por motivos ligados aos *dados enviados pelo chamador*
responde trazendo o SQLSTATE no próprio código: `PG_23505`, `PG_23503`, etc. Trata-se de
uma família e não de uma enumeração fechada — o Postgres define centenas de SQLSTATEs —, mas apenas duas
classes chegam a ser convertidas dessa forma, pois apenas essas duas decorrem de erro do chamador:

- **classe 23**, violação de restrição de integridade: duplicata, chave estrangeira apontando
  para registro inexistente, coluna NOT NULL deixada em branco;
- **classe 22**, exceção de dados: valor incompatível com o tipo da coluna.

Todas as outras causas — conexão perdida, coluna ausente, erro de privilégios —
são falhas do servidor e permanecem como `500`. Assim, `code.startsWith("PG_")` é um teste seguro
para verificar se "a linha enviada estava errada", sendo as quatro abaixo aquelas com as quais um cliente
realmente se depara. `details.dbCode` traz o mesmo SQLSTATE para todas elas, e
a mensagem identifica a restrição violada.

| Código | Status | Significado | O que fazer |
| --- | --- | --- | --- |
| `PG_22P02` | 400 | Não foi possível interpretar o valor como o tipo da coluna — equivalente de escrita para `INVALID_FILTER_VALUE`. | Envie um valor compatível com o tipo da coluna. |
| `PG_23502` | 400 | Uma coluna `NOT NULL` foi deixada vazia. | Envie o campo ou atribua um valor padrão à coluna. |
| `PG_23503` | 400 / 409 | Na inserção/atualização, uma chave estrangeira referencia linha inexistente (400). Na exclusão, outras linhas ainda referenciam esta (409; chave com `RESTRICT` lança `PG_23001`, também 409). | Crie a linha de destino primeiro ou corrija o id; na exclusão, remova ou aponte as linhas dependentes para outro registro antes. |
| `PG_23505` | 409 | Violação de restrição de unicidade (unique constraint). A mensagem identifica a restrição. | Use outro valor ou atualize a linha existente. |

## Storage

| Código | Status | Significado | O que fazer |
| --- | --- | --- | --- |
| `INVALID_LIST_OPTIONS` | 400 | O `maxResults` da listagem de storage não é inteiro maior ou igual a 1, ou seu `pageToken` não foi emitido pela fonte. Limites menores que um costumavam retornar página vazia com o mesmo token, travando loops `while (pageToken)`. | Envie um `maxResults` positivo e repasse `nextPageToken` sem modificações. |
| `INVALID_STORAGE_BUCKET` | 400 | Nome de bucket malformado. | Verifique o nome. |
| `INVALID_STORAGE_KEY` | 400 | A chave do objeto está malformada, escapa do prefixo designado ou está sob prefixo reservado (`_rebase/renditions/`, `_rebase/maintenance/`). | Verifique a chave. |
| `INVALID_TRANSFORM_OPTIONS` | 400 | Os parâmetros de transformação de imagem estão fora dos limites ou são conflitantes. | Veja [Storage](/docs/backend/storage/). |
| `STORAGE_FILE_TOO_LARGE` | 413 | O upload ultrapassa o `maxBytes` declarado na coluna de destino `col.storage()`. Aplicado no servidor, não apenas no navegador. `details` informa a coluna, o limite e o tamanho real. | Envie um arquivo menor ou eleve `maxBytes` na coluna. |
| `STORAGE_FILE_TYPE_REFUSED` | 400 | O tipo do arquivo não consta na lista `accept` da coluna ou nos `allowedMimeTypes` da fonte de storage. `details` informa a coluna (ou lista da fonte), a relação aceita e o tipo enviado. | Envie um tipo permitido ou amplie `accept` / `allowedMimeTypes`. |
| `STORAGE_MISCONFIGURED` | 502 | O bucket S3 ou GCS configurado não existe, ou o provedor recusou as credenciais desta implantação. A mensagem identifica o bucket; `details.reason` indica `NoSuchBucket` ou a recusa do provedor. Antigamente, bucket inexistente retornava "arquivo não encontrado" para qualquer arquivo. | Corrija o nome do bucket (`S3_BUCKET` / `GCS_BUCKET`, `__<KEY>` para fontes nomeadas) ou as permissões das credenciais. |
| `STORAGE_NOT_CONFIGURED` | 501 / 503 | Nenhum backend de storage foi configurado neste servidor, ou nenhum é padrão e a requisição não indica a fonte; a mensagem lista as fontes atendidas (501). Upload retomável cuja fonte desapareceu antes da conclusão retorna 503. | Configure S3, GCS ou armazenamento local, ou selecione a fonte com `?storageId=`. |
| `STORAGE_SAME_LOCATION` | 400 | Chamada a `POST /api/admin/storage/move` com `deleteSource` (`rebase storage move --delete-source`) entre duas fontes que utilizam o mesmo bucket ou diretório. Todos os arquivos pareceriam já existir no destino por serem idênticos, e apagar a cópia de origem destruiria o único arquivo real existente. Nenhuma alteração foi feita. | Aponte a coluna para a outra fonte; os arquivos já residem nela. |
| `STORAGE_SCAN_INCOMPLETE` | 409 | `DELETE /api/admin/storage/orphans` (`rebase storage orphans --delete`) não conseguiu ler todas as tabelas, podendo fazer arquivos válidos parecerem órfãos. Com `?scan=`, a varredura indicada foi a que falhou na leitura. Nada foi excluído; `details.unscanned` lista cada tabela e a razão da falha. | Solucione o impedimento de leitura nessas tabelas e tente novamente. |
| `STORAGE_SCAN_NOT_FOUND` | 404 | `GET /api/admin/storage/orphans/scans/:id` ou `DELETE /api/admin/storage/orphans?scan=:id` referencia varredura inexistente na fonte. Varreduras são mantidas por 7 dias na fonte examinada, logo um `storageId` diferente do utilizado também não a encontrará. | Passe o `storageId` da varredura ou execute uma nova. |
| `STORAGE_SCAN_NOT_COMPLETE` | 409 | `DELETE /api/admin/storage/orphans?scan=:id` faz referência a uma varredura com status `queued`, `running` ou `failed`. Nada foi excluído; `details.status` traz o estado atual. | Aguarde a conclusão da varredura ou inicialize outra. |
| `STORAGE_SCAN_EXPIRED` | 409 | `DELETE /api/admin/storage/orphans?scan=:id` referencia varredura concluída há mais de 15 minutos. Nada foi excluído. | Inicie nova varredura e exclua a partir dela. |
| `STORAGE_SCAN_DELETION_STARTED` | 409 | `DELETE /api/admin/storage/orphans?scan=:id` referencia varredura cujos arquivos órfãos já estão em processo de exclusão. | Verifique o progresso em `deletion` via `GET /api/admin/storage/orphans/scans/:id`. |
| `STORAGE_SOURCE_NOT_CONFIGURED` | 501 | A fonte de storage foi declarada, mas não possui credenciais configuradas neste ambiente. | Configure as variáveis de ambiente dessa fonte. |
| `STORAGE_WRITE_FAILED` | 502 | O backend de storage recusou ou interrompeu a gravação. | Verifique os logs e credenciais do serviço de storage. |
| `TRANSFORM_OVERLOADED` | 503 | Quantidade excessiva de transformações de imagem em andamento simultaneamente. | Tente novamente; avalie incluir uma CDN à frente. |
| `UNKNOWN_STORAGE_SOURCE` | 400 / 404 | A requisição informou uma fonte de storage (`?storageId=`) não declarada no projeto. Um `bucket` não atendido por esta implantação retorna o mesmo código em **404** (em listagem, upload comum, pasta ou upload retomável para S3/GCS) — o que falta é o repositório, e `details` lista os buckets e fontes existentes. Anteriormente ambos retornavam "arquivo não encontrado", confundindo-se com objeto inexistente. | Declare a fonte em `config/resources.ts` ou consulte `GET /api/storage/sources`. |
| `UPLOAD_LOCKED` | 423 | Um `PATCH` de upload retomável chegou enquanto outro pedaço (chunk) do mesmo upload ainda estava em trânsito — quase sempre decorrente de retry do cliente para pacote em andamento. Recusado em vez de enfileirado, a exemplo do tusd. | Consulte o offset atual com `HEAD /api/storage/tus/:id` e retome dali; a biblioteca tus-js-client aplica retry com backoff automaticamente. Veja [Resumable uploads (TUS)](/docs/backend/storage-resumable-uploads/). |

## Funções personalizadas

| Código | Status | Significado | O que fazer |
| --- | --- | --- | --- |
| `FUNCTION_NOT_FOUND` | 404 | Nenhuma função com esse nome está registrada — ou ela existe, mas suas rotas internas não contemplam o caminho solicitado. Um chamador autenticado recebe a lista das funções disponíveis; um anônimo não, pois essa lista revelaria todos os endpoints personalizados. Se o arquivo correspondente falhou ao carregar, o erro exibe o nome do arquivo para chamadores autenticados: isso diferencia erro de digitação de problemas no deploy. Chamadores anônimos recebem resposta padrão de nome inexistente. | Compare o nome com `GET /api/functions` ou consulte o log de inicialização em busca de arquivos com erro de carregamento. |
| `FUNCTION_TIMEOUT` | 504 | O manipulador ultrapassou o tempo limite de execução. Ele continua rodando; não é possível cancelá-lo a partir daqui. | Defina um `AbortSignal` em chamadas externas ou aumente `REBASE_FUNCTIONS_TIMEOUT_MS`. |
| `FUNCTIONS_UPSTREAM_UNREACHABLE` | 502 | Este processo atua como proxy de funções para outro que não respondeu. | Verifique se a unidade responsável pelas funções está ativa. |

## Notificações push

| Código | Status | Significado | O que fazer |
| --- | --- | --- | --- |
| `PUSH_ENDPOINT_REFUSED` | 400 | O endpoint da assinatura não pertence a um serviço push aceito por navegadores (FCM, Mozilla, Apple, Windows) via `https`. O servidor conecta-se a esse endereço a cada envio, portanto não aceita outros. | Envie `PushSubscription.toJSON()` exatamente como gerado pelo navegador ou registre serviços de teste em `push.allowedHosts`. Veja [Push notifications](/docs/backend/push-notifications/#routes). |
| `PUSH_NEEDS_A_USER` | 403 | Uma chave de API ou a service key chamou rota de notificações push. Uma assinatura está ligada ao navegador de um usuário real autenticado. | Execute a chamada usando a sessão desse usuário. |
| `PUSH_NOT_CONFIGURED` | 503 | Notificações push estão ativadas, mas não podem ser enviadas: falta de chaves VAPID em produção ou incapacidade de preparar sua tabela. A mensagem especifica o caso. | Configure `REBASE_VAPID_PUBLIC_KEY`, `REBASE_VAPID_PRIVATE_KEY` e `REBASE_VAPID_SUBJECT`. Veja [Push notifications](/docs/backend/push-notifications/#keys). |

## Tarefas agendadas (Cron jobs)

| Código | Status | Significado | O que fazer |
| --- | --- | --- | --- |
| `CRON_JOB_ALREADY_EXECUTING` | 409 | Disparo manual de tarefa cron que já está em execução — no processo atual ou em outro retendo o lease da execução, como o worker associado ao processo `api`. Nada foi disparado. A tentativa pulada fica registrada no histórico do job em `details.log`; o registro aponta o processo que está rodando a tarefa. | Aguarde a conclusão da execução atual antes de tentar novamente. Veja [Cron Jobs](/docs/backend/cron-across-instances/#concurrency-guarding). |

## Interfaces administrativas e edição de esquema

Estes códigos indicam que um recurso está desativado ou não configurado, e não
que a requisição em si estava incorreta. Cada um também é retornado na rota correspondente
`/status` com código `200`, permitindo ao painel desabilitar o recurso visualmente em vez
de exibir um erro.

| Código | Status | Significado | O que fazer |
| --- | --- | --- | --- |
| `ADMIN_SURFACE_UNAVAILABLE` | 501 | Uma interface de uso exclusivo de admin foi acionada em servidor sem autenticação configurada, tornando impossível distinguir administradores de outros usuários. | Configure `auth.jwtSecret` ou forneça um `AuthAdapter`. |
| `BRANCH_DIFF_STALE` | 409 | `POST /api/admin/branches/:name/merge` recebeu a identificação (fingerprint) de um diff que mudou: o branch ou o elemento pai foi alterado nesse intervalo. Nada foi gravado. | Obtenha o diff novamente, revise as modificações e execute o merge informando o novo `fingerprint`. |
| `BRANCH_DIFF_UNSUPPORTED` | 501 | A fonte de dados não tem capacidade de comparar branches: não aceita SQL ou não oferece suporte a branching (sem conexão administrativa). | Utilize um backend Postgres com `adminConnectionString` configurada. |
| `BRANCH_MERGE_BLOCKED` | 409 | Uma tabela divergente não pôde ser unificada (merge) — adicionada ou removida no branch, alteração em colunas ou chave primária, inexistência de chave primária, excesso de linhas para comparação, ou reescrita após o branch ser criado (`TABLE_REWRITTEN`). Uma tabela com contagem desconhecida de linhas bloqueia a operação mesmo que o total mostre 0 (significa valor incerto, não zero). `details.tables` lista cada tabela e a causa. Nada foi gravado. | Aplique o esquema com suas migrations primeiro ou execute o merge com `skipBlocked: true` para ignorar essas tabelas. |
| `BRANCH_MERGE_CONFLICT` | 409 | Linhas foram modificadas simultaneamente no branch e no pai, e `onConflict` estava definido como `"abort"` (padrão); ou o pai rejeitou trecho do merge — alteração concorrente, trigger que a ignorou ou política de segurança que a ocultou. Nada foi gravado. | Defina a precedência das alterações com `onConflict: "branch"` ou `"target"`, ou gere o diff novamente. |
| `BRANCH_MERGE_FAILED` | 409 | O elemento pai rejeitou as linhas do branch durante a instrução de merge — restrição violada, valor fora de enum ou chave estrangeira incompatível, em geral decorrente de diferenças de esquema. `details` informa `sqlState`, `table`, `constraint` e `detail`. Nada foi gravado. | Analise as diferenças estruturais no diff, sincronize o esquema do pai via migrations ou corrija as linhas no branch antes de tentar novamente. |
| `BRANCH_NOT_FOUND` | 404 | Nenhum branch com esse nome foi encontrado no registro. | Consulte os disponíveis com `rebase db branch list` ou no painel Branches. |
| `CONTRACT_UNAVAILABLE` | 404 | O contrato do projeto é disponibilizado apenas quando a autenticação está configurada — ele lista todas as tabelas e relações existentes. | Configure a autenticação. `/meta/schema-version` é sempre servido. |
| `DEV_MAILBOX_UNAVAILABLE` | 501 | Nenhuma caixa de correio de desenvolvimento ativa. Mensagens são capturadas apenas com `SMTP_HOST` vazio e `NODE_ENV` diferente de production. | Limpe a variável `SMTP_HOST` em desenvolvimento ou consulte a caixa de entrada real. |
| `DOCS_UNAVAILABLE` | 404 | `GET /api/docs` é oferecido para os mesmos chamadores autorizados a ver `GET /api/schema/tables`; como este servidor não possui autenticação, não há perfil para quem exibir. | Configure a autenticação ou torne o documento público para todos com `enableSwagger: true` (`REBASE_ENABLE_SWAGGER=true`). |
| `INVALID_CHANGE` | 400 | A alteração de esquema proposta não está bem formatada. | Veja a mensagem. |
| `SCHEMA_CHANGE_FAILED` | 400 | A aplicação de uma mudança planejada no esquema falhou por um motivo não coberto por códigos mais específicos. | Veja a mensagem; ela traz a falha original literal. |
| `SCHEMA_CHANGE_UNAPPLICABLE` | 400 | A mudança é válida, mas não pode ser aplicada ao esquema no seu estado atual. | Veja a mensagem. |
| `SCHEMA_EDIT_DIRTY_TREE` | 409 | O repositório contém alterações não commitadas, impedindo a aplicação segura da edição. | Faça commit ou stash e tente novamente. |
| `SCHEMA_EDIT_REFUSED` | 400 | O editor de esquema recusou a edição: a alteração pretendida envolve código que ele não reescreve (spread, helper, chave computada), ou é uma alteração que ele nunca realiza (renomear tabela, remover última regra). `details.problems` lista cada item. Nada foi gravado. | Veja a mensagem. Realize a modificação manualmente em `backend/schema`. |
| `SCHEMA_EDIT_DOES_NOT_COMPILE` | 400 | A alteração pode ser feita, mas o esquema resultante não compilaria — como relação para tabela removida ou regra apontando para coluna excluída. `details.problems` traz os apontamentos do compilador com tabela e coluna correspondentes. Nada foi gravado. | Modifique as tabelas dependentes primeiro ou faça a alteração manual em `backend/schema`. |
| `SCHEMA_EDIT_STALE_FILE` | 409 | Um arquivo a ser alterado foi modificado no disco desde que a edição foi preparada (salvamento na IDE, outro processo). Nada foi gravado. | Recarregue e reaplique a edição com base no estado atual do arquivo. |
| `SCHEMA_EDIT_REQUIRES_A_PERSON` | 403 | Uma chave de API ou outro processo automatizado tentou aplicar alterações no esquema. | Faça login como usuário real ou ative `liveSchema.allowMachineApply`. |
| `SCHEMA_EDITING_NO_COLLECTIONS_DIR` | 501 | A edição de esquema em tempo real requer `schemaDir` (o diretório `backend/schema`) ou `liveSchema.repository`, e o servidor iniciou sem nenhum dos dois. O código preserva o nome original. | Configure um deles. |
| `SCHEMA_EDITING_NO_REPOSITORY` | 503 | O planejamento funciona, mas não há repositório para commitar as alterações — comum em implantações executando bundles pré-compilados ou servidores cujo `backend/schema` não está sob controle git (toda aplicação exige commit). | Execute `git init` no projeto e reinicie o servidor (o repositório é detectado na inicialização), ou configure `liveSchema.repository`. |
| `SCHEMA_EDITING_PROVISIONING_OFF` | 409 | Esta implantação não aplica alterações estruturais no banco (`REBASE_PROVISION=false`), impedindo modificações pelo painel. | Faça o commit apenas como código-fonte e delegue a aplicação ao processo responsável pelas alterações no banco. |
| `SCHEMA_EDITING_UNSUPPORTED` | 503 | Este driver não possui suporte a planejamento de alterações de esquema. | A edição em tempo real está disponível para Postgres. |
| `SCHEMA_EDITOR_BAAS_MODE` | 501 | As tabelas são inspecionadas diretamente do banco de dados neste ambiente, logo não existem arquivos de origem locais para edição. | Altere o esquema por meio de migrations. |
| `SCHEMA_EDITOR_DISABLED` | 501 | O editor de esquema está desativado para este servidor. Bundles pré-compilados sempre respondem com este código. | Ative-o configurando `schemaEditor`. Em bundles, defina `REBASE_LIVE_SCHEMA_REPOSITORY` para editar `backend/schema` via repositório — veja [Live schema editing](/docs/backend/live-schema-editing#from-a-built-bundle). |
| `SCHEMA_EDITOR_MISSING_DEPENDENCY` | 501 | O editor de esquema depende do pacote `ts-morph`, que não está instalado. | Instale-o no pacote que executa o backend e reinicie: `pnpm --dir backend add -D ts-morph@28.0.0` na raiz de projetos com scaffold padrão, ou `pnpm add -D ts-morph@28.0.0` caso o backend seja a raiz. A mensagem traz o comando adequado para o seu ambiente. |
| `SCHEMA_EDITOR_NO_COLLECTIONS_DIR` | 501 | O servidor não possui `schemaDir` definido, logo o editor não tem onde gravar os arquivos. O código preserva o nome original. | Configure `schemaDir`. |
| `SCHEMA_EDITOR_PRODUCTION` | 501 | O editor fica inativo sob `NODE_ENV=production`: os arquivos de servidores em produção são reconstruídos a partir do repositório a cada deploy, descartando edições diretas feitas aqui. | Edite `backend/schema` em desenvolvimento e faça o deploy, ou defina `liveSchema.repository` para commitar as alterações diretamente nele. |
| `SCHEMA_UNAVAILABLE` | 404 | Chamada a `GET /api/schema/tables` em backend sem autenticação configurada: não há chamador para calcular a redução (redact) das tabelas, e definir `auth.requireAuth: false` não muda esse comportamento. | Configure um adaptador de autenticação ou `auth.jwtSecret`. Veja [Endpoints](/docs/backend/endpoints/#schema). |
| `TABLE_NOT_FOUND` | 404 | `GET /api/schema/tables/:slug` indica uma tabela não disponibilizada a este chamador — inexistente por esse slug ou fora do alcance dos escopos da sua credencial. | Verifique o slug e os escopos `data:*` da credencial. |
| `UI_PREFERENCES_NEED_A_PERSON` | 403 | `/api/admin/ui-config` foi acionado com chave de API, platform token ou service key. Preferências de interface pertencem a um usuário autenticado. | Faça login como usuário real. |
| `UI_PREFERENCES_TOO_LARGE` | 413 | As preferências de interface de uma tabela ultrapassaram 64 KB. | Reduza o volume salvo: preferências devem conter apenas definições visuais, não dados. |
| `UI_PREFERENCES_UNSUPPORTED` | 501 | O driver deste backend não suporta SQL, logo não persiste preferências de UI; o painel as armazena no navegador. | Nada a corrigir: configurações ficam salvas por navegador. |
| `UI_CONFIG_FILE_INVALID` | 500 | `frontend/src/cms/ui-config.json`, onde as preferências de UI da workspace são salvas em desenvolvimento, não é um JSON válido. | Corrija-o ou apague-o; o painel o recria no próximo salvamento. |
| `SQL_EXPORT_UNSUPPORTED` | 501 | `POST /api/admin/sql/csv` não pode transmitir o resultado aqui: o banco de desenvolvimento no mesmo processo (PGlite) possui conexão única, e manter um cursor durante o download travaria todas as outras consultas; ou a fonte de dados não suporta cursor SQL. | Aponte `DATABASE_URL` para uma instância externa do Postgres (`rebase dev --docker` inicia uma) ou adicione `LIMIT` para exportar apenas as linhas visíveis. |

### Reconciliação de esquema (Schema reconcile)

[`rebase schema reconcile`](/docs/cli/schema/#rebase-schema-reconcile) planeja
via `POST /api/admin/schema/reconcile/plan` e aplica via
`/reconcile/apply`. Uma recusa não altera nada; apenas `SCHEMA_RECONCILE_FAILED`
deixa partes do plano aplicadas.

| Código | Status | Significado | O que fazer |
| --- | --- | --- | --- |
| `INVALID_RECONCILE` | 400 | O corpo não é um objeto JSON ou `drop` não é uma lista de strings no formato `"<table>.<column>"`. | Envie `{ "drop": ["voice_cache.wav"] }` ou omita o campo `drop`. |
| `SCHEMA_RECONCILE_FAILED` | 400 | Uma instrução falhou no meio do processo. As instruções anteriores foram executadas e permanecem aplicadas; `details.applied` as lista. | Corrija o ponto indicado na mensagem e planeje novamente: o novo plano ignorará o que já foi executado. |
| `SCHEMA_RECONCILE_INVALID` | 400 | O plano não pode ser aplicado; a mensagem detalha o motivo: um `drop` fora do formato `<table>.<column>`, apontando para tabela/coluna inexistente, ou referenciando coluna ainda declarada pela tabela. `details.plan` contém o plano. | Corrija a lista de `drop`. Para remover uma coluna declarada, exclua-a do `defineTable`, faça deploy e depois reconcilie. |
| `SCHEMA_RECONCILE_STALE` | 409 | O banco de dados ou as tabelas foram alterados após o plano que você confirmou. `details.plan` traz o novo plano atualizado. | Revise o novo plano e confirme utilizando seu `digest`. |
| `SCHEMA_RECONCILE_UNCONFIRMED` | 400 | `/reconcile/apply` foi chamado sem o campo `confirm`. | Gere o plano antes e envie o `digest` do plano como `confirm`. A CLI faz isso automaticamente quando você digita `yes`. |
| `SCHEMA_RECONCILE_UNSUPPORTED` | 503 | O driver deste backend não suporta planejar reconciliação ou não executa SQL. | A reconciliação requer Postgres. |

### Por que uma tabela de branch não pode receber merge

`BRANCH_MERGE_BLOCKED` detalha em `details.tables` cada tabela rejeitada, acompanhada de
um destes códigos. O mesmo código consta no campo `blocked` da tabela no próprio diff,
permitindo ao Studio sinalizar a situação antes de alguém clicar em **Merge**. Nenhum deles constitui uma resposta HTTP independente.

| Código | Status | Significado | O que fazer |
| --- | --- | --- | --- |
| `COLUMNS_DIFFER` | — | As colunas da tabela diferem entre o branch e o pai. Linhas são comparadas considerando apenas as colunas em comum. | Adicione as colunas faltantes no pai via migrations (`rebase db push`) e execute o merge. Migrations que reescrevem tabelas — alteração de tipo de coluna — transformam o caso em `TABLE_REWRITTEN`: execute o merge antes de alterações desse tipo ou recrie o branch depois. |
| `NO_PRIMARY_KEY` | — | A tabela não tem chave primária, impedindo a comparação linha a linha; o diff traz apenas o total de linhas. | Crie uma chave primária na tabela ou migre as linhas manualmente. |
| `PRIMARY_KEY_DIFFERS` | — | As colunas da chave primária, ou seus tipos, divergem entre os ambientes. | Aplique as mudanças estruturais no elemento pai primeiro. |
| `TABLE_ADDED` | — | O branch criou a tabela. Uma operação de merge nunca cria tabelas. | Crie-a no pai com suas migrations e depois faça o merge de suas linhas. |
| `TABLE_DROPPED` | — | O branch removeu a tabela. Uma operação de merge nunca remove tabelas. | Remova-a por meio das suas migrations. |
| `TABLE_REWRITTEN` | — | Um dos lados reescreveu todas as linhas da tabela após a criação do branch — mudança de tipo de coluna, `ADD COLUMN` com default volátil, `VACUUM FULL`, `CLUSTER` —, fazendo todas as linhas parecerem novas e impossibilitando distinguir quem alterou qual linha. | Faça o merge do branch antes de migrations estruturais desse tipo ou recrie o branch a partir do pai depois delas. |
| `TOO_LARGE` | — | A tabela contém, em um dos lados, mais linhas do que o limite aceito para comparação unitária do diff (100.000 por padrão, `maxRowsPerTable`). | Aumente `maxRowsPerTable` tanto no diff quanto no merge, ou transfira as linhas por outro método. |

## Códigos genéricos

Uma rota utiliza um destes códigos quando não houver outro mais específico aplicável.

| Código | Status | Significado | O que fazer |
| --- | --- | --- | --- |
| `BAD_REQUEST` | 400 | Malformada, e nenhum erro mais específico se aplica. | Veja a mensagem. |
| `UNAUTHORIZED` | 401 | Não autenticado ou credencial rejeitada. | Faça login ou renove o token. |
| `FORBIDDEN` | 403 | Autenticado, mas sem permissão. | Tentar novamente com a mesma identidade não resolverá. |
| `CONFLICT` | 409 | Conflito com o estado atual. | Veja a mensagem. |
| `INTERNAL_ERROR` | 500 | Ocorreu uma falha interna no servidor. A mensagem é deliberadamente genérica. | Informe o `requestId`; o motivo detalhado está nos logs. |
| `NOT_CONFIGURED` | 503 | Uma dependência necessária para esta rota não está configurada neste servidor. | Veja a mensagem. |
| `SERVICE_UNAVAILABLE` | 503 | Um serviço externo do qual a requisição depende ficou inacessível: bucket S3 ou MinIO, ou host chamado via `fetch()` por uma função que recusou conexão ou não resolveu DNS. O log do servidor identifica o host; a resposta não. Banco de dados inacessível retorna `DATABASE_UNAVAILABLE`. Qualquer falha de conexão com serviços desse tipo responde com este código. | Tente novamente; consulte os logs. |

## Mantendo esta página exata

`pnpm verify:docs` falha quando algum código disparável pelo servidor estiver ausente destas
tabelas, quando uma tabela listar código que nada dispara, quando os status de uma linha não coincidirem
exatamente com os emitidos no código-fonte ou quando uma família como `PG_<SQLSTATE>` não contiver a linha
de um SQLSTATE encontrado por chamadores. O script responsável é
`tooling/scripts/docs-verify/check-error-codes.mjs`.

Ele valida a si próprio primeiro. A varredura extrai códigos diretamente do TypeScript e não de
um servidor em execução, logo pontos cegos seriam silenciosos por definição: no passado, não
reconhecia códigos repassados por wrappers de linha única ou definidos logo após mensagem
contendo `)`, reportando "todos os códigos do servidor estão documentados"
em uma página com dezessete omissões. Por isso, a verificação roda uma fixture contendo exatamente
essas variações antes de ler esta página, recusando-se a validar qualquer coisa se não
conseguir detectá-las.
