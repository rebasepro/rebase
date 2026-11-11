---
sourceHash: f3bc0de4cbc7297e
title: Códigos de erro
sidebar_label: Códigos de erro
description: Todos os códigos de erro que um backend Rebase pode retornar, com seu status HTTP, o que significa e o que fazer a respeito — além do envelope de resposta, X-Request-ID e as regras de details.
---

Cada falha retornada por um backend Rebase usa um único envelope e carrega um
`code` estável. O código é o elemento sobre o qual fazer ramificações (branching):
a mensagem é escrita para uma pessoa e pode ser reformulada, o status é
compartilhado por dezenas de problemas diferentes, e o código não é nenhum dos dois.

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

- **`message`** — legível por humanos. Para um `4xx`, é a mensagem do próprio
  servidor; para um `5xx`, é deliberadamente genérica, pois o texto subjacente
  pode citar um host, uma role ou o nome de uma coluna.
- **`code`** — um dos valores abaixo. Estável entre versões menores (minor versions).
- **`details`** — opcional e nunca garantido. Veja as regras abaixo.
- **`requestId`** — presente sempre que a requisição passou pelo middleware de
  request-ID, o que abrange todas as rotas sob `basePath`.

### `X-Request-ID`

Toda requisição sob `basePath` recebe um ID: o cabeçalho `X-Request-ID` do
chamador quando for um UUID, caso contrário, um novo. Ele é retornado na resposta
como `X-Request-ID`, incluído no envelope de erro como `requestId` e anexado à
linha de log do servidor para aquela requisição.

Essa é a chave de junção. Cite-a em um relatório de bug e um operador poderá
encontrar a linha exata de log que explica a falha, contendo o motivo que nunca
foi exibido ao cliente.

Enviar o seu próprio identificador é como um rastreamento (trace) sobrevive a um
salto (hop): um gateway ou executor de tarefas (job runner) que encaminha o
cabeçalho obtém um único ID em todos os serviços que processaram a requisição.
Um valor inválido é ignorado em vez de rejeitado — não vale a pena falhar uma
requisição por causa de um cabeçalho malformado enviado pelo chamador —, portanto,
não presuma que o ID enviado é o ID recebido. Leia o cabeçalho da resposta.

### O que está em `details`

`details` tem finalidade diagnóstica, não contratual. Três regras o regem:

1. **Qualquer coisa definida explicitamente por uma rota é sempre retornada.**
   Estes são os próprios erros do chamador descritos com precisão: qual campo de
   filtro era desconhecido, qual relação não é gravável, qual valor não se ajustou
   ao seu tipo.
2. **Diagnósticos do banco de dados são omitidos em produção.** Quando a falha
   vem do Postgres, `details.dbCode` — o SQLSTATE — está sempre presente: ele
   indica a classe do problema e não revela nada sobre os dados. `dbMessage`,
   `detail` e `hint` são adicionados apenas quando `NODE_ENV` não é `production`,
   pois o Postgres inclui o conteúdo das linhas neles. `23505` relata
   `Key (email)=(a@b.c) already exists.`, o que responde "esta pessoa está
   registrada?" para qualquer endereço que alguém tente consultar.
3. **Nunca faça ramificações (branching) com base em `details`.** Ramifique com
   base em `code`. O conteúdo de `details` é apenas o que foi útil para uma pessoa
   naquele local da chamada, e isso muda.

## Interpretando um status

| Status | O que indica sobre a requisição |
| --- | --- |
| `400` | Malformada ou solicitando algo que não existe no esquema. Corrija a requisição. |
| `401` | Não autenticado ou a credencial expirou. Faça login ou renove o token. |
| `403` | Autenticado, mas não permitido. Tentar novamente com a mesma identidade não ajudará. |
| `404` | Rota, coleção ou linha inexistente — ou uma linha ocultada pela segurança em nível de linha (RLS). |
| `409` | Um conflito com o estado existente: uma duplicata ou uma gravação concorrente. |
| `413` `415` `422` | O corpo é muito grande, o media type está incorreto ou foi rejeitado semanticamente. |
| `429` | Limite de taxa excedido (Rate limited). Aguarde; a mensagem informa por quanto tempo. |
| `500` | O erro está no servidor ou em seu banco de dados, não no chamador. Verifique os logs. |
| `501` | A rota existe, mas esta implantação não pode atendê-la — um recurso desativado ou não configurado. |
| `502` `503` `504` | Uma dependência estava inacessível, não configurada ou muito lenta. |

## Autenticação e contas

| Código | Status | Significado | O que fazer |
| --- | --- | --- | --- |
| `AAL2_REQUIRED` | 403 | A rota requer um segundo fator e a sessão possui apenas um. | Conclua o desafio de MFA e tente novamente. |
| `ALREADY_VERIFIED` | 400 | O endereço ou fator já foi verificado. | Nada — o estado desejado já é verdadeiro. |
| `ACCOUNT_OUTRANKS_CALLER` | 403 | A conta sendo editada, redefinida ou excluída possui uma role ou escopo que o chamador não possui. `details.beyond` lista quais são. | Peça para alguém que os possua fazer a alteração. |
| `ANONYMOUS_AUTH_DISABLED` | 403 | O login anônimo está desativado neste servidor. | Ative-o ou faça login com uma identidade real. |
| `ANONYMOUS_NOT_ALLOWED` | 403 | Uma sessão de convidado tentou aprovar o login de um dispositivo. Um convidado não tem conta para vincular a um dispositivo. | Faça login com uma conta e aprove a solicitação. |
| `API_KEY_SELF_MANAGEMENT_FORBIDDEN` | 403 | Uma chave de API tentou listar, criar, alterar ou revogar chaves de API, sejam do seu próprio tipo ou pessoais. | Gerencie as chaves como uma pessoa com a permissão `keys:write` ou com a chave de serviço. |
| `AUTH_MIDDLEWARE_MISSING` | 500 | Uma rota protegida foi executada sem o middleware de autenticação do Rebase antes dela, portanto a credencial do chamador nunca foi analisada. | Monte a aplicação por meio do roteador de funções em vez de montá-la diretamente no seu próprio servidor. |
| `BOOTSTRAP_ANONYMOUS` | 403 | A inicialização (bootstrap) do primeiro administrador foi tentada por um chamador anônimo. | Faça login primeiro. |
| `BOOTSTRAP_COMPLETED` | 403 | O primeiro administrador já existe. | Peça a um administrador existente para conceder a role. |
| `BOOTSTRAP_NOT_FIRST_USER` | 403 | O bootstrap é apenas para o primeiro usuário, e este não é ele. | Peça a um administrador existente para conceder a role. |
| `CAPTCHA_FAILED` | 400 | O provedor rejeitou o token de CAPTCHA. | Resolva um novo desafio. |
| `CAPTCHA_REQUIRED` | 400 | A rota requer um token de CAPTCHA e nenhum foi enviado. | Inclua o token. |
| `CHALLENGE_EXHAUSTED` | 401 | Muitas tentativas erradas de código para um único desafio de MFA. | Inicie um novo desafio. |
| `DEVICE_LOGIN_DECIDED` | 409 | O login do dispositivo já foi aprovado ou negado. Um login é decidido apenas uma vez. | Inicie um novo processo no dispositivo. |
| `DEVICE_LOGIN_EXPIRED` | 410 | O login do dispositivo ultrapassou o limite de dez minutos antes de ser decidido. | Inicie um novo processo no dispositivo. |
| `DEVICE_LOGIN_NOT_FOUND` | 404 | Nenhum login de dispositivo possui esse código de usuário. A própria sondagem (poll) do dispositivo responde com os códigos em minúsculas da RFC 8628: `authorization_pending`, `slow_down`, `access_denied`, `expired_token`, `invalid_grant`. | Compare o código com o exibido no dispositivo. |
| `EMAIL_EXISTS` | 409 | Já existe uma conta com esse endereço — no cadastro, na alteração de endereço e ao seguir um link de alteração de endereço quando outra conta assumiu o endereço enquanto ele aguardava. | Faça login ou inicie a redefinição de senha; para alteração de endereço, escolha outro. |
| `EMAIL_NOT_CONFIGURED` | 503 | Magic links ou OTP foram solicitados e o servidor não possui transporte de e-mail. | Configure o SMTP ou use outro método de login. |
| `EMAIL_NOT_VERIFIED` | 403 | Um login OAuth encontrou uma conta com o mesmo endereço, mas o provedor não verificou esse endereço, então ele não foi vinculado. | Faça login com o método existente e, em seguida, execute `POST /auth/link/<provider>`. |
| `FACTOR_NOT_VERIFIED` | 400 | O fator MFA foi cadastrado, mas nunca confirmado. | Confirme o fator. |
| `IDENTITY_ALREADY_LINKED` | 409 | Essa identidade OAuth pertence a outra conta. | Faça login com ela ou desvincule-a daquela conta primeiro. |
| `IMPERSONATION_FORBIDDEN` | 403 | Uma requisição enviou `x-rebase-impersonate`, mas seu chamador não pode executar requisições como outro usuário. Apenas a própria sessão de um administrador autenticado pode fazer isso, nunca uma chave de API ou a chave de serviço. | Envie com a sessão de um administrador ou omita o cabeçalho. |
| `IMPERSONATION_INVALID` | 400 | `x-rebase-impersonate` foi enviado vazio. | Envie o uid do usuário a ser representado ou omita o cabeçalho. |
| `IMPERSONATION_TARGET_NOT_FOUND` | 404 | `x-rebase-impersonate` não indica nenhum usuário ativo: nenhuma conta possui esse uid ou ela está desativada. | Verifique o uid. |
| `IMPERSONATION_UNAVAILABLE` | 501 | A autenticação deste backend não pode executar requisições como outro usuário porque seu `AuthAdapter` não possui `resolveUser`. | Implemente `resolveUser` no adaptador ou omita o cabeçalho. |
| `IMPERSONATION_UNSUPPORTED` | 400 | `x-rebase-impersonate` foi enviado para uma rota que não oferece suporte à representação de usuário. Apenas a API de dados e funções personalizadas a aceitam, e o socket em tempo real aceita `impersonate` em `AUTHENTICATE`. | Envie a requisição sem o cabeçalho. |
| `SIMULATION_FORBIDDEN` | 403 | Uma requisição enviou um cabeçalho `x-rebase-simulate-*` (o simulador de RLS) ou chamou `/api/admin/rls-simulator`, mas seu chamador não tem permissão para simular acesso. Apenas a sessão de um administrador autenticado pode, nunca uma chave de API ou a chave de serviço. | Envie com a sessão de um administrador ou omita os cabeçalhos. |
| `SIMULATION_INVALID` | 400 | A simulação estava malformada: um cabeçalho enviado vazio, `x-rebase-simulate-api-key-id` combinado com uma role ou id de usuário, ou simulação combinada com `x-rebase-impersonate`. | Especifique uma role (opcionalmente com um uid), um id de usuário ou um id de chave de API. |
| `SIMULATION_READ_ONLY` | 403 | Uma operação de gravação, exclusão, `_batch`, reversão de histórico ou uma função personalizada chamada por qualquer verbo que não seja `GET`/`HEAD`/`OPTIONS` continha um cabeçalho `x-rebase-simulate-*`. O acesso simulado é somente leitura: a gravação seria executada como a identidade simulada, não como o administrador. Leituras, incluindo `POST …/query` e `…/count`, ainda são executadas. | Pare de simular para fazer alterações. |
| `SIMULATION_TARGET_NOT_FOUND` | 404 | A simulação não identifica nenhum usuário ativo (um id de usuário enviado sem role) ou nenhuma chave de API válida. | Verifique o id ou envie uma role junto ao uid para simular um uid que não possui conta. |
| `SIMULATION_UNAVAILABLE` | 501 | Este backend não pode simular acesso: seu `AuthAdapter` não possui `resolveUser` para confirmar um administrador, ou uma chave foi especificada em um backend sem chaves de API. | Implemente `resolveUser` ou omita os cabeçalhos. |
| `SIMULATION_UNSUPPORTED` | 400 | Um cabeçalho `x-rebase-simulate-*` foi enviado para uma rota que não aceita acesso simulado. Apenas a API de dados e funções personalizadas os aceitam. | Envie a requisição sem os cabeçalhos. |
| `GUEST_REFERENCED` | 409 | Um convidado não pôde ser excluído porque uma linha do próprio projeto o exige, por meio de uma chave estrangeira com `ON DELETE RESTRICT` ou `NO ACTION`. `DELETE /api/admin/guests` relata isso por convidado em `skipped` e continua a execução. | Exclua a linha ou mantenha o convidado. |
| `INVALID_ACCOUNT` | 400 | A conta está em um estado no qual esta operação não pode atuar. | Veja a mensagem. |
| `INVALID_CHALLENGE` | 400 | O desafio de MFA é desconhecido ou expirou. | Inicie um novo. |
| `INVALID_CODE` | 400 / 401 | O código OTP ou MFA está incorreto: 400 no login por código de e-mail (`/auth/otp/verify`), 401 no cadastro ou desafio de MFA. | Tente novamente com o código atual. |
| `INVALID_CREDENTIALS` | 401 | E-mail ou senha incorretos — deliberadamente sem informar qual deles. | Tente novamente ou redefina a senha. |
| `INVALID_PLATFORM_TOKEN` | 401 | Um token de plataforma `rpt_` foi recusado: assinatura inválida, audiência errada, expirado ou validade além do limite permitido. A mensagem informa o motivo. | Solicite à plataforma a geração de um novo — no Rebase Cloud, execute o comando novamente. |
| `INVALID_SCOPES` | 400 | Uma chave foi solicitada para algo que não é um escopo: malformado, desconhecido ou com um alvo que o escopo não aceita. `details.problems` informa quais e por quê; `details.validScopes` lista os escopos que uma chave pode ter. Ele omite `keys:read` e `keys:write`, que nenhuma chave pode conter. | Use um nome da lista. Veja [Roles e escopos](/docs/backend/roles-and-scopes/). |
| `INVALID_TOKEN` | 400 / 401 | Um token de verificação, redefinição, magic link ou alteração de endereço está malformado, desconhecido, já utilizado ou expirado (400). Uma credencial de provedor OAuth ou token de atualização que não seja verificado retorna 401. | Solicite um novo link ou faça login novamente. |
| `INVALID_USER_CODE` | 400 | O código enviado para login de dispositivo não é válido: deve ter oito letras, como `BCDF-GHJK`. | Copie o código exibido no dispositivo. |
| `INVALID_ROLE` | 400 | O nome de uma role sendo gravada não é uma string, está vazio ou contém `,` `{` `}` `"` `\` ou caracteres de controle. Esses caracteres seriam lidos como outras roles: uma role trafega em um `text[]` do Postgres e na lista separada por vírgulas que as políticas de RLS dividem, logo `"support,admin"` retornaria como `admin`. `details.problems` lista cada um. | Renomeie a role. Qualquer outro nome é aceito. |
| `KEY_MANAGEMENT_SCOPE` | 400 | Foi solicitado `keys:read` ou `keys:write` para uma chave. Nenhuma chave pode gerenciar chaves. `details.scopes` lista quais foram. | Remova-os da solicitação. |
| `KEY_OUTRANKS_CALLER` | 403 | Um detentor de `keys:write` tentou alterar ou revogar uma chave de serviço que possui uma role ou escopo que ele não possui. Apenas um admin gerencia qualquer chave. `details.roles` e `details.scopes` listam o que a chave possui além do chamador. | Peça a um admin ou a alguém que os possua para alterar a chave. |
| `LAST_ADMIN` | 403 | A alteração deixaria o projeto sem nenhum administrador. | Promova outro usuário primeiro. |
| `MFA_REQUIRED` | 401 | A senha estava correta e a conta possui um segundo fator verificado, portanto o login está apenas concluído pela metade. `details` traz um token de curta duração restrito ao desafio de MFA — não é uma sessão. | Abra um desafio e responda a ele; a resposta do desafio emite a sessão. |
| `NO_SESSION` | 401 | Nenhum cookie de sessão ou refresh token foi apresentado. Normal no primeiro carregamento de página. | Faça login. |
| `NOT_ANONYMOUS` | 400 | Uma rota de upgrade de anônimo foi chamada por uma conta real, ou `DELETE /api/admin/guests/:uid` especificou uma. | Nada a atualizar. Para excluir uma conta, use `DELETE /api/admin/users/:uid`. |
| `OAUTH_ERROR` | 401 | O provedor OAuth recusou ou retornou um erro. | Tente o fluxo novamente; a mensagem contém o motivo do provedor. |
| `PERSONAL_KEYS_DISABLED` | 403 | As chaves de API pessoais estão desativadas neste backend. | Defina `personalKeys: true` no bloco `auth` da coleção de usuários. |
| `PERSONAL_KEY_NEEDS_ACCOUNT` | 403 | A chave de serviço ou uma sessão de convidado tentou usar as rotas de chave pessoal. Nenhuma delas possui uma conta para a chave representar. | Faça login em uma conta ou crie uma chave de serviço em `/api/admin/api-keys`. |
| `PLATFORM_TOKENS_OFF` | 401 | Um token de plataforma `rpt_` atingiu um servidor que não os aceita: `REBASE_PLATFORM_TOKEN_KEY` e `REBASE_PLATFORM_TOKEN_AUDIENCE` não estão definidos. | A plataforma que hospeda a aplicação define ambos ao implantar; reimplante ou faça login na aplicação por outro meio. |
| `RATE_LIMITED` | 429 | Muitas tentativas feitas por este chamador. | Aguarde; a mensagem informa por quanto tempo. |
| `REDIRECT_URI_NOT_ALLOWED` | 400 | O destino do redirecionamento não está na lista de permissões. | Adicione-o à configuração do provedor. |
| `REGISTRATION_DISABLED` | 403 | O autocadastro está desativado. | Peça a um administrador para criar a conta. |
| `ROLE_EXCEEDS_CALLER` | 403 | As roles concedidas possuem um escopo, ou `admin`, que o chamador não possui. `details.beyond` lista quais são. | Peça a alguém que os possua para conceder a role. |
| `ROLE_EXCEEDS_CREATOR` | 403 | Uma chave de serviço recebeu uma role de RLS que seu criador não possui. Apenas um admin pode conceder qualquer role. `details.roles` lista quais são. | Remova a role ou peça a um admin para criar a chave. |
| `ROLE_EXISTS` | 409 | Esse nome de role já está em uso. | Escolha outro nome. |
| `ROLE_LOOKUP_FAILED` | 503 | As roles do chamador não puderam ser lidas — em uma rota de admin ou em uma requisição de dados em um backend com `config.auth`. Falha fechando o acesso (fails closed) em vez de confiar nas roles contidas no token. Um token cujo uid não aponta para nenhuma conta, incluindo um uid que a tabela de usuários não pode conter, é um 401, não este erro. Um banco de dados inacessível é `DATABASE_UNAVAILABLE`, não este erro. | Tente novamente; verifique o banco de dados. |
| `SCOPE_EXCEEDS_CREATOR` | 403 | Uma chave foi solicitada com um escopo que seu criador não possui. Uma chave nunca possui mais do que a conta que a cria. `details.scopes` lista quais são. | Remova-os ou peça a alguém que os possua para criar a chave. |
| `SCOPE_MISSING` | 403 | A credencial não possui o escopo exigido por esta rota, coleção, fonte de armazenamento ou função. `details.requiredScope` informa qual é, incluindo o destino. | Para uma pessoa, uma role que declare o escopo. Para uma chave, uma chave que o contenha. Veja [Roles e escopos](/docs/backend/roles-and-scopes/). |
| `SCOPE_NOT_DECLARED` | 500 | Uma rota protegida com `requireScope` especifica um escopo de aplicação que este backend não declara, logo ninguém o possui, nem mesmo um administrador. Um nome que não seja um escopo ou um escopo integrado digitado incorretamente, como `data:raed`, nunca chega a este ponto: `requireScope` lança erro no registro da rota. | Declare o escopo sob `auth.scopes` na coleção de usuários ou corrija o nome. Veja [Roles e escopos](/docs/backend/roles-and-scopes/). |
| `SELF_DELETE` | 400 | Um administrador tentou excluir a própria conta. | Peça para outro administrador realizar a exclusão. |
| `SESSION_REVOKED` | 401 | A sessão foi encerrada em outro lugar, todas as sessões foram revogadas ou a conta foi excluída. Todos os pontos de entrada que aceitam uma sessão respondem isso a tal token de acesso: a API de dados, armazenamento, funções personalizadas e as rotas administrativas. O socket em tempo real recusa seu `AUTHENTICATE` com um frame `AUTH_ERROR` contendo o mesmo código. O SDK tenta renovar, a renovação é recusada e ele faz logout. | Faça login novamente. |
| `ACCOUNT_DISABLED` | 401/403 | Um administrador desativou a conta: login (403), renovação e todos os tokens que ela possui (401) são recusados em todos os pontos que aceitam sessão. O socket em tempo real recusa seu `AUTHENTICATE` com um frame `AUTH_ERROR` contendo o mesmo código. | Contate um administrador. |
| `EMAIL_NOT_CONFIRMED` | 403 | `requireEmailVerification` está ativado e o endereço ainda não foi verificado. Retornado apenas para senhas corretas; um novo link é enviado por e-mail. | Acesse o link enviado por e-mail. |
| `PROOF_REQUIRED` | 409 | `POST /auth/verify-email`: a conta possui uma senha ou identidade que ninguém comprovou, e a requisição não comprova nenhuma das duas. O token não é consumido. | Envie `password` para mantê-la ou `removeUnproven: true` para verificar sem ela. |
| `UNDELIVERABLE_ADDRESS` | 400 / 409 | Foi solicitada a verificação por e-mail para um endereço inalcançável — de convidado ou placeholder do X (400) — ou uma conta solicitou alteração para tal endereço (409, `POST /auth/change-email`). | Defina um endereço real primeiro. |
| `EMAIL_UNCHANGED` | 400 | `POST /auth/change-email` especificou o endereço atual da conta. | Nada a alterar. |
| `ANONYMOUS_USER` | 403 | Um convidado solicitou alteração de endereço de e-mail; convidados não possuem endereço próprio. | Converta-o em uma conta primeiro (`POST /auth/anonymous/link`). |
| `MFA_NOT_ENROLLED` | 400 | Códigos de recuperação foram solicitados para uma conta sem nenhum segundo fator verificado. | Cadastre um fator primeiro. |
| `HOOK_REJECTED` | 400 | Um hook `beforeUserCreate`, `beforeLogin`, `beforeUserDelete` ou `beforeEmailChange` disparou um erro. A mensagem é a do próprio hook; um hook que selecionou um status 4xx responde com ele. | Veja a mensagem. |
| `INVALID_JSON` | 400 | O corpo da requisição não é um JSON. | Envie um corpo JSON válido. |
| `SELF_DISABLE` | 400 | Um administrador tentou desativar a própria conta. | Peça a outro administrador. |
| `NOT_SUPPORTED` | 501 | O repositório de autenticação deste backend não suporta a ação solicitada (desativar contas, alterar endereço). | Reinicie o servidor para que a coluna seja adicionada ou use um repositório compatível. |
| `UNKNOWN_SCOPE_TARGET` | 400 | O destino do escopo especifica uma coleção, fonte de armazenamento ou função não atendida por este backend. `details` lista as atendidas. | Corrija o destino. |
| `UNVERIFIED_IDENTITIES` | 409 | Um magic link, código por e-mail ou redefinição de senha comprovou o endereço de uma conta não verificada, e a conta possui uma identidade de login cujo provedor nunca verificou esse endereço. O repositório de autenticação não pode removê-la (não possui `unlinkUserIdentity`), logo a prova é recusada em vez de permitir essa porta de entrada em uma conta verificada. | Implemente `unlinkUserIdentity` no repositório de autenticação customizado ou peça a um administrador para revisar a conta. |
| `SETUP_REQUIRED` | 403 | O projeto ainda não possui administrador, portanto esta rota não está disponível. | Conclua a configuração inicial do primeiro administrador. |
| `TOKEN_ALREADY_USED` | 401 | Um token de uso único foi reutilizado, ou um refresh token que foi rotacionado há mais de `refreshTokenReuseIntervalSeconds` atrás. | Solicite um novo ou faça login novamente. |
| `TOKEN_EXPIRED` | 401 | O token ultrapassou seu tempo de vida útil. | Solicite um novo. |
| `USER_NOT_FOUND` | 404 | Nenhuma conta encontrada com esse id. | Verifique o id. |
| `WEAK_PASSWORD` | 400 | A senha não atende à [política de senhas](/docs/backend/auth-endpoints/#password-policy) (por padrão, 8+ caracteres com letra maiúscula, letra minúscula e dígito) — no cadastro, redefinição, alteração e na senha escolhida por um administrador: `POST /api/admin/users`, criação na coleção de usuários via API de dados, `PUT /api/admin/users/:id` ou `POST /api/admin/users/:id/reset-password`. | Escolha uma senha mais forte. Um administrador importando contas pode enviar `skipPasswordPolicy: true` na criação. |

## Dados, consultas e escritas

| Código | Status | Significado | O que fazer |
| --- | --- | --- | --- |
| `AGGREGATE_MASKED_BY_AFTER_READ` | 400 | Uma agregação diferente de `count()` sem `groupBy` em uma coleção que um callback `afterRead` reescreve (global, coleção ou propriedade). Uma agregação lê os valores armazenados e nunca executa o callback, portanto uma soma, mínimo, máximo, contagem de campo ou grupo leria o que o callback oculta. | Use `count()` sem `groupBy`, ou leia as linhas, que passam pelo callback. |
| `AGGREGATE_NOT_SUPPORTED` | 501 | Este driver não pode computar a agregação solicitada. | Use um driver compatível ou calcule no cliente. |
| `BRANCHING_UNSUPPORTED` | — | Uma ramificação (branch) de banco de dados foi solicitada via websocket do Studio no banco de dados de desenvolvimento gerenciado (PGlite), onde a branch *é* o pai e nada seria isolado. A recusa é a mesma emitida por `rebase db branch`. | Aponte `DATABASE_URL` para um Postgres próprio (`rebase dev --docker` inicia um) e faça a ramificação lá. |
| `BATCH_TOO_LARGE` | 400 | `POST /api/data/_batch` contém mais operações do que o limite por lote (1000 por padrão). Um lote é uma única transação e mantém seus bloqueios durante toda a execução. | Envie em partes; a mensagem informa o limite e a sua contagem. |
| `BATCH_UNSUPPORTED` | 400 | O driver deste backend não pode gravar entre coleções de forma atômica, e um loop de gravações individuais não seria atômico nem executado em uma única viagem de ida e volta (round trip). | Envie as gravações como requisições separadas ou como chamadas `/bulk` por coleção. |
| `BULK_TOO_LARGE` | 400 | O corpo da requisição em lote (bulk) excede o limite de itens configurado. | Divida a requisição. |
| `BULK_UNSUPPORTED` | 400 | Esta coleção ou driver não oferece suporte a gravações em lote (bulk). | Grave as linhas uma por vez. |
| `CALLBACK_REJECTED` | 400 / 403 | Um callback de coleção recusou a gravação. Um `throw` de `beforeSave`/`beforeDelete`/`after*` resulta em um 400 contendo a mensagem do próprio autor; um `beforeDelete` que retorna `false` resulta em 403. `details.stage` informa qual callback, `details.path` a coleção. | Leia a mensagem — ela foi escrita por este projeto, não pelo Rebase. |
| `CALLBACK_RECURSION` | 500 | Gravações iniciadas por hooks aninhados em mais de 16 níveis: uma gravação `context.data` de um hook executa os hooks daquela coleção novamente, e nada na cadeia a interrompe — geralmente um `afterSave` que atualiza a própria linha incondicionalmente. Toda a gravação foi revertida. A mensagem informa o hook e a coleção; `details.chain` lista cada etapa de hook → gravação. | Torne a gravação do hook condicional: atue apenas em `status === "new"`, ou ignore quando `values` já contiverem o que seria gravado. |
| `COLLECTION_READ_ONLY` | 405 | Uma gravação atingiu uma coleção que atende a uma view SQL (`view`). Uma view é somente leitura. | Grave nas tabelas lidas pela view. Veja [Views](/docs/collections/views/). |
| `SQL_NOT_ALLOWED` | 400 | O SQL executado como o chamador (`getSql(c)`, `withAuth(user).sql`) não era uma única instrução pura `SELECT`, `WITH`, `VALUES`, `TABLE`, `INSERT`, `UPDATE`, `DELETE` ou `MERGE`, ou chamou `set_config` ou mencionou `pg_settings`. A identidade do chamador reside nas configurações de sessão, logo qualquer instrução capaz de alterá-las é recusada. | Mantenha o texto da consulta próprio, em uma única instrução, com todos os valores em `params`. Veja [Funções personalizadas](/docs/backend/custom-functions/#3-getsqlc--sql-as-the-caller). |
| `CURSOR_WITH_OFFSET` | 400 | `?after=` foi combinado com `?offset=` ou `?page=`. Um cursor já define onde a página começa, portanto um deslocamento (offset) sobre ele pula silenciosamente essa quantidade de linhas além do cursor — uma lacuna que o chamador não consegue ver na resposta. | Use um ou outro. |
| `DISTINCT_NOT_APPLICABLE` | 400 | `?distinct=true` foi combinado com uma busca textual ou consulta vetorial. Ambas atribuem uma pontuação (score) por linha, logo duas linhas nunca são iguais e `DISTINCT` não agruparia nada — pareceria ter funcionado sem mudar nada. | Remova um dos dois. |
| `DISTINCT_ORDER_BY_NOT_SELECTED` | 400 | Uma leitura com `distinct` é ordenada por uma coluna que ela não retorna. Um `SELECT DISTINCT` só pode ser ordenado por colunas presentes em sua lista de seleção, caso contrário as linhas agrupadas não têm ordem definida. `details.fields` lista quais são. | Adicione esses campos a `?fields=` ou remova-os de `?orderBy=`. |
| `DATABASE_UNAVAILABLE` | 503 | O banco de dados não pôde ser alcançado: a conexão foi recusada ou perdida, o host não foi resolvido, o servidor está desligando ou iniciando, ou o banco está fechado para novas conexões (`ALLOW_CONNECTIONS false`, deixado em sua origem por um `rebase db branch create --force` interrompido no meio do caminho; o log do servidor informa o banco de dados e `rebase db branch list` o reabre). Todos os pontos de entrada respondem isso, incluindo login, rotas de admin e o socket em tempo real (um frame `ERROR`). Enviado com `Retry-After: 5`. | Tente novamente; o SDK faz isso automaticamente. Verifique se o banco de dados está em execução e acessível pelo servidor. |
| `DB_CONNECTIONS_EXHAUSTED` | 503 | O servidor de banco de dados recusou uma nova conexão por não ter mais disponíveis (`53300` muitos clientes, `53400` limite de conexões de uma role ou banco). Todas as instâncias do servidor compartilham o `max_connections` do servidor de banco, portanto é com isso que várias instâncias com pools grandes e sem pooler se deparam. Trata-se de sobrecarga, não de falha; enviado com `Retry-After: 2`. O servidor registra a solução no log uma vez por minuto. | Tente novamente; o SDK faz isso automaticamente. Reduza `DB_POOL_MAX` (ou limite com `REBASE_DB_POOL_MAX`) entre as instâncias, coloque um pooler à frente do banco (`DATABASE_POOLED`) ou aumente `max_connections`. |
| `DB_CONNECT_TIMEOUT` | 503 | A abertura de uma nova conexão com o banco demorou mais que `DB_POOL_CONNECT_TIMEOUT`: o banco está demorando para aceitar conexões ou está distante na rede. Enviado com `Retry-After`. | Tente novamente; o SDK faz isso automaticamente. Verifique a carga do banco de dados e a rede até ele. |
| `DB_PERMISSION_DENIED` | 500 | O Postgres recusou a instrução (`42501`): uma política de segurança em nível de linha (RLS) negando esta role ou a ausência de um `GRANT`. | Veja [Solução de problemas](/docs/troubleshooting/). |
| `DB_POOL_EXHAUSTED` | 503 | Todas as conexões do pool permaneceram ocupadas por `DB_POOL_CONNECT_TIMEOUT`, logo esta requisição nunca alcançou o banco. Sobrecarga, não falha; enviado com `Retry-After`. O servidor registra a solução no log uma vez por minuto. | Tente novamente; o SDK faz isso automaticamente. Aumente `DB_POOL_MAX` ou localize as consultas lentas e transações longas que estão retendo as conexões. |
| `FIELD_NOT_READABLE` | 400 | Um filtro, `orderBy`, `fields`, agregação `select` ou `groupBy` indica um campo que as roles deste chamador não podem ler (`access.read`), um caminho aninhado ou ordenação de agregação especifica uma relação que não podem ler — ou uma operação de campo (`$inc`, `$push`, …) tem como alvo um campo inacessível, onde uma restrição recusada revelaria o valor armazenado. Um campo que nenhuma resposta pode conter não pode ser interrogado por nenhuma consulta, caso contrário o valor seria legível predicado por predicado. Um filtro por meio de relação (`author.salary`) e uma ordenação agregada sobre o campo de uma relação (`max(staff.salary)`) são julgados pela regra do destino. `details.violations` informa cada campo. Um campo oculto com `excludeFromApi` responde como se não existisse: filtro, `orderBy`, `fields`, `include`, agregação `select` ou `groupBy`, ou `vector_search` que o mencione recebe exatamente a mesma resposta dada a um nome digitado incorretamente (`UNKNOWN_FILTER_FIELD`, `UNKNOWN_ORDER_BY_FIELD`, `UNKNOWN_FIELD`, `UNKNOWN_RELATION`, `UNKNOWN_AGGREGATE_FIELD` ou `UNKNOWN_VECTOR_PROPERTY`), e nenhuma resposta de campo desconhecido o lista. | Remova o campo da consulta ou obtenha a role necessária. Veja [Acesso a campos](/docs/collections/field-access/). |
| `FIELD_NOT_WRITABLE` | 400 | O corpo define um campo que as roles deste chamador não podem gravar (`access.write`). Recusado em vez de descartado silenciosamente: uma gravação que descarta um campo reportaria sucesso para uma edição que não ocorreu. O mesmo código recusa uma gravação através de um pai que define uma relação que o chamador não pode gravar, e uma atualização que define um campo `softDelete` com um valor — apenas a exclusão o preenche. `details.violations` informa cada campo. | Remova o campo ou obtenha a role necessária. Um campo que ninguém pode gravar responde com `VALIDATION_EXCLUDED_FIELDS`. |
| `FILTERED_USER_WRITE` | 400 | Uma atualização ou exclusão filtrada foi enviada para a coleção de usuários via HTTP, cujas gravações são validadas usuário por usuário antes de serem executadas. | Leia os usuários e, em seguida, execute `updateMany`/`deleteMany` neles por id. |
| `FILTER_REQUIRED` | 400 | Uma gravação filtrada (atualização ou exclusão por `where`/`logical`, do SDK ou rotas bulk) não possui condição, o que afetaria todas as linhas. Recusada antes de qualquer execução. | Adicione uma condição. Para alterar todas as linhas de propósito, defina uma condição que todas as linhas atendam. |
| `HISTORY_UNAVAILABLE` | 503 | Uma gravação em uma coleção com `history: true` foi recusada porque sua entrada de histórico não pôde ser gravada: o banco não possui a tabela `rebase.entity_history` ou, para `openRebase` e `rebase console`, a função `rebase.record_history`. Nenhum backend com histórico foi inicializado neste banco. Nada foi executado, callbacks incluídos, e as leituras não são afetadas. Lançado por `openRebase` e retornado por um backend criado com `provision: false`. | Inicialize o backend uma vez com o histórico ativado e `provision: true` (`rebase dev` faz isso) e tente novamente. |
| `IDEMPOTENCY_KEY_IN_PROGRESS` | 409 | Uma requisição anterior com a mesma `Idempotency-Key` ainda está em execução. | Tente novamente assim que ela terminar. |
| `IDEMPOTENCY_KEY_REUSED` | 422 | A mesma `Idempotency-Key` foi enviada em uma requisição diferente: outro método, caminho, query string ou corpo. | Use uma nova chave ou envie a requisição original. |
| `INVALID_AGGREGATE_FUNCTION` | 400 | `?select=` especificou uma função que não é de agregação (`count`, `sum`, `avg`, `min`, `max`, `countDistinct`, `mode`, `percentile`, `distinct`, `fingerprint`). | Use uma dessas opções; a mensagem as lista. |
| `INVALID_AGGREGATE_GROUP` | 400 | Uma transformação `groupBy` é desconhecida ou não se aplica à sua coluna: `year`/`month`/`day` em coluna que não é data, `unnest` em uma que não é array. | Use `lower`, `upper`, `year`, `month`, `day` ou `unnest` em uma coluna do tipo correto. |
| `INVALID_AGGREGATE_SELECT` | 400 | Uma entrada em `?select=` não está no formato `fn(field)`; uma função diferente de `count()` ou `fingerprint()` foi enviada sem campo; `percentile` não contém uma fração de 0 a 1; ou `fingerprint()` foi solicitado em uma view comum, que não armazena linhas. | Escreva `sum(total)`, `count()`, `percentile(price,0.95)`. |
| `INVALID_AGGREGATE_WINDOW` | 400 | `offset`, `page` ou `orderBy` em uma agregação sem `groupBy`, ou um cursor em qualquer agregação. Uma agregação sem agrupamento retorna uma única linha, e um grupo não é uma linha que um cursor possa continuar após. | Adicione `groupBy` ou remova-os; pagine grupos com `offset` ou `page`. Veja [Agregações](/docs/sdk/aggregates-and-search/#aggregates). |
| `INVALID_BATCH_BODY` | 400 | Uma operação de `/_batch` está sem `op`, `collection`, `values` ou `id`, especifica uma coleção não atendida por este backend ou reutiliza um nome de `ref`. | Veja a mensagem; ela indica a operação pelo índice. |
| `INVALID_BATCH_REF` | 400 | Um `{ "$ref": "<name>.<field>" }` não aponta para uma operação anterior, aponta para a frente ou solicita um campo que a linha referenciada não possui. Apenas referências para trás são resolvidas. | Defina a operação com `ref` *antes* de referenciá-la. |
| `INVALID_BULK_BODY` | 400 | O corpo da requisição bulk não possui o formato esperado. | Envie o array que a rota espera: `{ "rows": [...] }` para `POST /bulk`, `{ "updates": [{ "id", "data" }] }` para `PATCH /bulk`, `{ "ids": [...] }` para `POST /bulk/delete`. |
| `INVALID_CONFLICT_RULE` | 400 | A regra de conflito de um upsert (manter duplicatas ou substituir apenas em um `where`) foi enviada sem `upsert: true`, ou ambas as regras foram enviadas juntas. | Envie `upsert: true` e apenas uma das duas regras. |
| `INVALID_CONFLICT_TARGET` | 400 | O `on_conflict` / `onConflict` de um upsert referencia colunas sem garantia de unicidade, as referencia sem `upsert: true`, ou foi enviado em uma criação aninhada, onde uma linha correspondente mudaria para o novo pai. Caso contrário, o Postgres responderia 42P10 de dentro de uma transação que já realizou trabalho. Ocorre também em qualquer upsert na coleção de usuários (auth), onde criação e atualização seguem regras distintas. | Declare `validation: { unique: true }` ou um índice `unique`; a mensagem lista os alvos existentes. Na coleção de usuários, envie `POST` para criar e `PATCH` para atualizar. |
| `INVALID_COUNT` | 400 | `?count=` não é `exact` nem `none`. Recusado em vez de assumir o padrão: um erro de digitação como `?count=nnone` pagaria pelo custo da contagem que pretendia ignorar. | Envie `exact` (o padrão) ou `none`. Veja [Ignorando a contagem](/docs/backend/api/#skipping-the-count). |
| `INVALID_CURSOR` | 400 | O cursor `after` não pode ser lido ou especifica um id de linha incompatível com as colunas-chave da coleção: foi truncado, recodificado ou montado manualmente. Um cursor legível enviado com um `orderBy` diferente daquele sob o qual foi emitido resulta em `CURSOR_ORDER_MISMATCH`, também um 400. | Repasse `meta.nextCursor` da página anterior sem alterações, com o mesmo `orderBy` ou nenhum. Veja [Paginação](/docs/sdk/pagination/). |
| `INVALID_DELETED_PARAM` | 400 | `?deleted=` não é `include` nem `only`. Recusado em vez de ignorado: um erro de digitação como `?deleted=true` que ocultasse silenciosamente todas as linhas excluídas pareceria ter funcionado respondendo à pergunta oposta. | Envie `include` (ativas e excluídas) ou `only` (apenas excluídas). Omita o parâmetro para apenas linhas ativas. |
| `INVALID_DISTINCT` | 400 | `?distinct=` não é `true` nem `false`. | Envie um desses valores; `1` e `0` também são aceitos. |
| `INVALID_FIELD_OPERATION` | 400 | Um `$inc` / `$push` / `$pull` / `$merge` foi usado em um tipo de propriedade para o qual não está definido, com um operando de formato incorreto, com dois operadores no mesmo campo, com erro de digitação ou em uma operação de criação — onde não há valor armazenado para operar. | Veja [Gravando via REST](/docs/backend/writes/#field-operations); a mensagem informa o campo. |
| `INVALID_FILTERED_WRITE` | 400 | Uma gravação filtrada foi direcionada a um caminho através de uma relação (`posts/1/comments`) ou a nenhuma coleção. | Grave na coleção relacionada aplicando um filtro em seu link. |
| `INVALID_FILTER_FIELD` | 400 | O filtro especifica uma propriedade que esta coleção não possui. | Verifique a grafia em comparação com a coleção. |
| `INVALID_FILTER_OPERATOR` | 400 | O operador não é compatível com o tipo desta propriedade — por exemplo, `like` em um número ou data. | Veja [Consultando dados](/docs/sdk/querying/). |
| `INVALID_FILTER_VALUE` | 400 | O valor do filtro não pode ser lido como o tipo da coluna com a qual foi comparado: `?id=eq.abc` em uma chave inteira, um rótulo fora do enum, um timestamp inválido, um número fora do intervalo do tipo. `details.dbCode` traz o SQLSTATE. | Envie um valor correspondente ao tipo da coluna. |
| `INVALID_HARD_PARAM` | 400 | `?hard=` não é `true` nem `false`. Qualquer outro valor é recusado em vez de interpretado como "não" — um erro de digitação que faça soft-delete quando o chamador solicitou exclusão definitiva faz parecer que os dados foram expurgados. | Envie `true` ou `false`. |
| `INVALID_INCLUDE` | 400 | `?include=` está malformado: não é uma lista de caminhos válida ou é um objeto de opções por relação com formato incorreto. Um caminho aninhado com mais de três saltos retorna `INCLUDE_TOO_DEEP`, também um 400. Respondido na camada de borda antes de escapar do driver como 500. | Veja a mensagem; ela informa o caminho problemático. |
| `INVALID_INPUT` | 400 | O corpo da requisição falhou na validação. | Veja a mensagem. |
| `INVALID_LIMIT` | 400 | `?limit=` não é um número inteiro de 1 até o máximo (1000 por padrão); valores maiores são recusados, não ajustados. Uma assinatura em tempo real solicitando um limite fora desse intervalo recebe o mesmo código em um frame `ERROR` de WebSocket. | Reduza o limite e pagine o restante dos registros. |
| `INVALID_LOGICAL_GROUP` | 400 | Um grupo `?or=` / `?and=` / `?not=` está malformado ou aninhado além da profundidade permitida. | Veja a mensagem; ela demonstra a regra de nivelamento. |
| `INVALID_OFFSET` | 400 | `?offset=` não é um número inteiro maior ou igual a 0. | Envie um número inteiro não negativo. |
| `INVALID_ORDER_BY` | 400 | `?orderBy=` não é `field`, `field:desc`, `field:desc:last`, ou um array JSON de `{ field, direction, nulls }` — ou especifica uma direção diferente de `asc`/`desc`, ou posicionamento de NULL diferente de `first`/`last`. | Veja a mensagem; ela mostra todas as opções aceitas. |
| `INVALID_PAGE` | 400 | `?page=` não é um número inteiro maior ou igual a 1. Páginas são indexadas em 1, logo `?page=0` é um erro, não a primeira página. | Envie `1` ou mais, ou use `?offset=`. |
| `INVALID_PARAM` | 400 | Um parâmetro de consulta está malformado. | Veja a mensagem. |
| `INVALID_QUERY_BODY` | 400 | O corpo de um `POST …/query` contém um valor incompatível com a URL: uma lista para um parâmetro que a URL lê uma única vez (`fields`, `limit`, …), um objeto para um filtro, ou qualquer parâmetro presente também na URL — um `POST …/query` lê todos os parâmetros do corpo. | Formate cada valor como na URL — uma string, ou uma lista para filtros repetidos; `where`, `include`, `orderBy` e `vector` aceitam JSON. Veja [Consultas longas demais para uma URL](/docs/backend/vector-search/#queries-too-long-for-a-url). |
| `INVALID_VECTOR` | 400 | `?vector=` não é um array JSON de números. | Envie `[0.1,0.2,0.3]`. |
| `INVALID_VECTOR_DISTANCE` | 400 | `?vector_distance=` não é `cosine`, `l2` nem `inner_product`. | Use uma dessas três opções. |
| `INVALID_VECTOR_THRESHOLD` | 400 | `?vector_threshold=` não é um número. | Envie um número. |
| `INVALID_WHERE` | 400 | `?where=` não é um objeto JSON mapeando campos para condições. | Envie `{"status":["==","active"]}`. |
| `KEY_IMMUTABLE` | 400 | Uma atualização atribui à chave da linha um valor diferente daquele pelo qual ela é referenciada — no corpo ou definido por um `beforeSave`. Uma linha não pode mudar de chave: todas as etapas após a gravação (releitura, `afterSave`, histórico, tempo real) a referenciam pela chave original. Recusada antes de qualquer hook rodar, sem nada gravado, em todos os pontos de entrada. `details.violations` informa o campo. | Crie a linha sob a nova chave e exclua a atual. Enviar a chave que a linha já possui é permitido. |
| `MISSING_AGGREGATE_SELECT` | 400 | A rota de agregação foi chamada sem `?select=`. | Adicione o parâmetro, por exemplo `?select=count()`. |
| `NOT_A_MATERIALIZED_VIEW` | 400 | `refresh()` foi chamado em uma coleção que não atende a uma view materializada. | Atualize apenas coleções com `view: { materialized: true }`. |
| `NO_COLLECTIONS` | 404 | O projeto não disponibiliza coleções: nenhuma declarada no código e nenhuma tabela de onde derivá-las. Se houver tabelas com RLS desativado, a mensagem as cita com o SQL para ativá-lo, e `details.unprotectedTables` as lista. | Crie tabelas — via migração, SQL ou arquivo de coleção com `rebase db push` — e reinicie. |
| `NOT_FOUND` | 404 | Nenhuma linha encontrada com esse id nessa coleção — ou trata-se de uma linha oculta pelo RLS para este chamador. | Verifique o id e, em seguida, as `securityRules` da coleção. |
| `UNKNOWN_RELATION` | 400 / 404 | `?include=` aponta para algo que não é uma relação na coleção. O mesmo código responde **404** quando um *caminho de URL* aninhado a indica, ex.: `/api/data/authors/1/posts` onde `authors` não declara nenhuma relação — neste caso a URL não aponta para nada, sendo um recurso não encontrado em vez de requisição inválida. | Verifique o nome da relação — a mensagem lista as existentes na coleção. Uma retro-referência precisa ser declarada no pai para ser navegável. |
| `ORDER_BY_FIELD_NOT_SORTABLE` | 400 | A ordenação especifica uma propriedade que não permite ordenação. | Ordene por uma propriedade mapeada para uma coluna. |
| `PAGE_WITH_OFFSET` | 400 | `?page=` foi combinado com `?offset=` — ou `page` com `offset` em um `find()`, o que o SDK do cliente, o `rebase.data` em processo e o cliente offline recusam com o mesmo código antes de qualquer requisição. Ambos descrevem a mesma janela, e anteriormente `page` prevalecia silenciosamente sobre um `offset` que nunca era aplicado. | Envie apenas um deles. |
| `PAYLOAD_TOO_LARGE` | 413 | O corpo excede o limite configurado. | Envie menos dados ou aumente o limite. |
| `READ_ONLY_TRANSACTION` | 409 | Um callback `afterRead` tentou gravar dados. Uma leitura no escopo da requisição roda em uma transação `READ ONLY`, portanto nem o callback nem nada chamado por ele pode realizar escritas. | Mova a gravação para fora da leitura: uma tarefa em segundo plano, ou `rebase.dataAsAdmin` a partir de um cron job ou função personalizada. |
| `REFRESH_NOT_SUPPORTED` | 501 | `POST /api/data/<slug>/refresh` atingiu um driver de dados sem suporte a views materializadas. | Nada a atualizar neste backend. |
| `RELATION_HAS_NO_PIVOT` | 400 | A gravação continha um payload de vínculo, mas o caminho não alcança seu destino por meio de um `manyToMany` que declare `through.properties` — logo não há linha de junção (junction row) para armazená-lo. | Declare `through.properties` na relação ou remova o payload da gravação. Veja [Relações](/docs/collections/relations/). |
| `RELATION_MISCONFIGURED` | 500 | Uma relação não pode ser resolvida com o esquema registrado. A operação é recusada em vez de ignorada: ignorá-la informaria sucesso para uma gravação que nunca ocorreu, ou traria vazio para linhas existentes. | Execute `rebase schema generate` se o esquema gerado for mais antigo que o banco de dados. |
| `RELATION_NOT_UNLINKABLE` | 400 | A relação não pode ser desvinculada por este lado. | Execute a gravação pelo lado proprietário da relação. |
| `RELATION_NOT_WRITABLE` | 400 | O caminho aninhado não é uma relação gravável, ou uma criação/atualização especifica uma relação `via` de múltiplos saltos — apenas relações `via` de salto único são graváveis. `details.fields` lista as chaves `via`. Nada foi gravado. | Grave diretamente nas linhas unidas pela cadeia. Veja [Relações](/docs/collections/relations/#via--an-explicit-join-chain). |
| `RELATION_PIVOT_UNSUPPORTED` | 400 | A relação declara colunas de junção, mas esta fonte de dados não suporta gravá-las. | O vínculo em si continua funcionando; apenas o payload anexado a ele não. Verifique os recursos do driver. |
| `RELATION_SOURCE_KEY_EMPTY` | 400 | Uma gravação de relação não possuía uma chave de origem para vincular a relação. | Salve a linha pai primeiro. |
| `RESULT_TOO_LARGE` | — | Uma instrução enviada via `EXECUTE_SQL` do socket em tempo real — `admin.executeSql` de um cliente, leituras de catálogo do painel de administração — retornou mais de 128 MB de linhas, portanto nenhum dado foi enviado. Entregue como um frame `ERROR` de WebSocket. Consultas feitas pelo próprio console SQL não são recusadas: elas exibem as primeiras linhas. | Adicione um `LIMIT` ou selecione menos colunas, e leia o resultado em partes. |
| `ROW_IN_TRASH` | 409 | A chave do upsert pertence a uma linha na lixeira (uma linha excluída via soft-delete ainda retém sua chave). Um upsert não grava sobre uma linha excluída, em nenhum ponto de entrada: REST `?on_conflict=`, upserts em `/bulk` e `/_batch`, o SDK e o socket em tempo real. Nada foi gravado. | Restaure a linha primeiro (uma atualização definindo o campo de soft-delete como `null`) ou expurgue-a com `?hard=true` e execute o upsert novamente. Veja [Soft delete](/docs/collections/soft-delete/). |
| `SCHEMA_DRIFT` | 500 | Uma tabela ou coluna esperada pelo código não existe no banco de dados. | Execute `rebase db push` em desenvolvimento; reimplante em um tenant gerenciado. |
| `SCORE_CURSOR_UNSUPPORTED` | 400 | `startAfter` foi combinado com `orderBy: "_score"`. A relevância é calculada por consulta em vez de armazenada, logo não pode servir de chave para um cursor. | Pagine a relevância com `limit`/`offset` ou ordene por uma coluna. |
| `SQL_ERROR` | 400 | O banco de dados recusou o SQL escrito por uma pessoa. No `EXECUTE_SQL` do socket em tempo real, trata-se de um frame `ERROR` contendo a mensagem do banco. `POST /api/admin/sql/csv` responde isso antes de enviar qualquer parte do arquivo: erro de sintaxe, tentativa de gravação (o download é somente leitura), mais de uma instrução ou uma role que a conexão não pode assumir. | Corrija o SQL. Um download aceita uma única instrução `SELECT`, `WITH … SELECT`, `TABLE` ou `VALUES`. |
| `VIEW_NOT_READABLE` | 403 | Um chamador que não possui nenhuma das `view.roles` de uma view materializada tentou lê-la ou atualizá-la. Uma view materializada não possui RLS, sendo servida integralmente e apenas a essas roles. | Leia com uma das roles permitidas ou declare a role do chamador em `view.roles`. |
| `TENANT_IMMUTABLE` | 400 | Uma gravação moveria uma linha de um tenant para outro. Uma linha não pode mudar de tenant. `details.violations` informa o campo. Uma trigger aplica a mesma regra no banco de dados, então o SQL executado como o chamador falha com erro Postgres `42501` e uma mensagem iniciando com `TENANT_IMMUTABLE`. | Crie a linha no outro tenant e exclua a atual, ou grave usando uma role presente em `tenant.bypassRoles`. |
| `TENANT_MISMATCH` | 400 | A gravação especifica um tenant ao qual este chamador não pertence; o banco de dados também a recusaria. | Grave em um tenant ao qual o chamador pertença ou autentique-se como um membro dele. |
| `TENANT_REQUIRED` | 400 | A coleção tem escopo por tenant e o tenant não pode ser inferido: a requisição não traz nenhum, ou o chamador pertence a vários. | Envie o campo do tenant explicitamente ou autentique-se como um chamador que pertença a exatamente um. |
| `TRANSACTION_ABORTED` | 500 | Uma instrução na transação de gravação falhou e um callback capturou o erro. O Postgres já havia abortado a transação, então a gravação foi revertida e nada foi salvo. Apenas uma criação, atualização ou exclusão via `context.data` recusada pelo banco é desfeita individualmente e segura de capturar. | Deixe a falha lançar o erro ou faça a verificação antes de executar a instrução. Veja [Semântica de Transações](/docs/collections/context-data-api/#transaction-semantics). |
| `UNKNOWN_FIELD` | 400 | `?fields=` especifica um campo que a coleção não possui. | Verifique a grafia; a mensagem lista os campos válidos. |
| `UNKNOWN_AGGREGATE_FIELD` | 400 | Uma agregação ou `groupBy` referencia um campo que a coleção não possui. | Verifique a grafia; a mensagem lista os campos válidos. |
| `UNKNOWN_FILTER_FIELD` | 400 | O filtro especifica um campo que esta coleção — ou o destino de uma relação — não possui, ou um campo ocultado por `excludeFromApi`. | Verifique a grafia; a mensagem lista os campos válidos. |
| `UNKNOWN_FILTER_OPERATOR` | 400 | O filtro especifica um operador inexistente. | A mensagem lista todos os operadores disponíveis. |
| `UNKNOWN_MESSAGE_TYPE` | 400 | Um frame de socket em tempo real contém um `type` não tratado pelo servidor. Respondido como um frame `ERROR` com o `requestId` da requisição para que ela seja finalizada em vez de expirar por timeout. | Verifique o `type` do frame; a mensagem informa qual foi. |
| `UNKNOWN_ORDER_BY_FIELD` | 400 | A ordenação especifica um campo que esta coleção não possui. | Verifique a grafia; a mensagem lista os campos válidos. |
| `PRECONDITION_FAILED` | 412 | Um `If-Match` informou uma versão da linha que não é mais a atual: alguém a alterou entre a leitura e esta gravação. Nada foi gravado. | Leia a linha novamente, reaplique as alterações e envie o novo `ETag`. |
| `UNKNOWN_RESPONSE_FIELD` | 400 | `?fields=` solicita um campo que a coleção não possui. | Verifique a grafia; a mensagem lista os campos conhecidos. |
| `UNKNOWN_VECTOR_PROPERTY` | 400 | Uma busca vetorial especificou uma propriedade que não é do tipo `vector` nesta coleção. | A mensagem lista as propriedades vetoriais da coleção. |
| `UNSUPPORTED_MEDIA_TYPE` | 415 | O `Content-Type` não é aceito por esta rota. | Envie o tipo documentado na rota. |
| `UNSUPPORTED_OPTION` | — | Lançado como exceção, não respondido: uma gravação por meio do acessador em processo (`context.data` em um callback, `rebase.data` em uma função ou cron) recebeu `ifMatch` ou `idempotencyKey`. Esse ponto de entrada não possui verificação de pré-condição nem armazenamento de idempotência, portanto a opção é recusada antes de qualquer gravação em vez de ser ignorada. | Remova a opção ou realize a gravação usando o cliente HTTP, que respeita ambas. |
| `UNSUPPORTED_RELATION_FILTER` | 400 | O filtro cruza uma relação `via`, cujo caminho de junção é definido em sentido único, logo não há como correlacionar uma subconsulta de volta. | Filtre a partir do lado proprietário. |
| `UNSUPPORTED_RELATION_FILTER_OPERATOR` | 400 | O operador não está definido para esse campo: uma relação sem coluna nesta linha é filtrada por pertinência, e correspondência de padrões (`like`, `ilike` e suas negações) aplica-se apenas a texto. | Veja a mensagem; ela lista o que o campo aceita. |
| `VALIDATION_CONSTRAINT` | 400 | Um valor violou uma regra de `validation` declarada pela propriedade — tamanho, intervalo, padrão, campo obrigatório. | Veja a mensagem; ela informa cada violação. |
| `VALIDATION_EXCLUDED_FIELDS` | 400 | O corpo grava em uma coluna marcada como `excludeFromApi`, ou `access: { write: [] }` — a mesma regra com duas sintaxes diferentes. Esses campos são de controle exclusivo do servidor: hash de senha, token de verificação. Diferente de `FIELD_NOT_WRITABLE`, esta resposta é idêntica para qualquer chamador, incluindo `admin`. | Remova o campo. Veja [Acesso a campos](/docs/collections/field-access/). |
| `VALIDATION_INVALID_VALUE` | 400 | O valor não é compatível com o tipo da propriedade. | Veja a mensagem; ela informa a propriedade. |
| `VALIDATION_UNKNOWN_FIELDS` | 400 | O corpo menciona um campo que a coleção não possui — incluindo o argumento `id` em uma coleção cuja chave primária é outro campo. | Verifique a grafia; a mensagem lista os campos conhecidos. |
| `VECTOR_CURSOR_UNSUPPORTED` | 400 | Um cursor (`after` / `startAfter`) foi combinado com uma busca vetorial. As linhas são ordenadas por uma distância calculada a cada consulta, a qual não serve de chave para cursor, de modo que uma listagem vetorial não retorna `nextCursor`. | Pagine as linhas mais próximas usando `limit`/`offset`. |
| `WRITE_DENIED` | 403 | Uma regra de segurança ou política de RLS recusou a gravação. | Verifique as `securityRules` da coleção. |

## `PG_<SQLSTATE>` — uma restrição recusada pelo banco de dados

Uma gravação que o Postgres rejeita por um motivo relacionado aos *dados do chamador*
responde com o SQLSTATE no código: `PG_23505`, `PG_23503`, e assim por diante. Trata-se
de uma família de erros, não de uma lista fixa — o Postgres define centenas de
SQLSTATEs —, mas apenas duas classes chegam até aqui, pois apenas estas duas são
falhas atribuíveis ao chamador:

- **classe 23**, violação de restrição de integridade: duplicidade, chave estrangeira
  apontando para nada, coluna NOT NULL deixada em branco;
- **classe 22**, exceção de dados: um valor incompatível com o tipo da coluna.

Tudo o mais — conexão perdida, coluna ausente, falha de privilégios — pertence ao
servidor e permanece como `500`. Assim, `code.startsWith("PG_")` é uma verificação
segura para "a linha que enviei continha dados incorretos", sendo os quatro abaixo
os encontrados na prática por um cliente. `details.dbCode` traz o mesmo SQLSTATE
para todos eles, e a mensagem informa o nome da restrição.

| Código | Status | Significado | O que fazer |
| --- | --- | --- | --- |
| `PG_22P02` | 400 | O valor não pôde ser lido como o tipo da coluna — o equivalente na gravação ao erro `INVALID_FILTER_VALUE`. | Envie um valor compatível com o tipo da coluna. |
| `PG_23502` | 400 | Uma coluna `NOT NULL` foi deixada vazia. | Envie o campo ou defina um valor padrão para a coluna. |
| `PG_23503` | 400 / 409 | Ao salvar, uma chave estrangeira aponta para uma linha inexistente (400). Ao excluir, outras linhas ainda referenciam esta (409; uma chave com `RESTRICT` dispara `PG_23001`, também 409). | Crie a linha de destino primeiro ou corrija o id; para exclusão, remova ou aponte as linhas dependentes para outro lugar antes. |
| `PG_23505` | 409 | Uma restrição de unicidade (unique constraint) foi violada. A mensagem informa o nome da restrição. | Use um valor diferente ou atualize a linha existente. |

## Armazenamento (Storage)

| Código | Status | Significado | O que fazer |
| --- | --- | --- | --- |
| `INVALID_LIST_OPTIONS` | 400 | O `maxResults` da listagem de armazenamento não é um número inteiro maior ou igual a 1, ou seu `pageToken` não foi emitido pela fonte. Um tamanho de página menor que um costumava retornar uma página vazia com o mesmo token, fazendo um loop `while (pageToken)` rodar infinitamente. | Envie um `maxResults` positivo e repasse `nextPageToken` sem alterações. |
| `INVALID_STORAGE_BUCKET` | 400 | O nome do bucket está malformado. | Verifique o nome. |
| `INVALID_STORAGE_KEY` | 400 | A chave do objeto está malformada, escapa do seu prefixo ou está sob um prefixo reservado (`_rebase/renditions/`, `_rebase/maintenance/`). | Verifique a chave. |
| `INVALID_TRANSFORM_OPTIONS` | 400 | Os parâmetros de transformação de imagem estão fora do intervalo ou são contraditórios. | Veja [Armazenamento](/docs/backend/storage/). |
| `STORAGE_FILE_TOO_LARGE` | 413 | O upload excede o `maxSize` declarado na propriedade de destino. Validado no servidor, não apenas no navegador. `details` informa a propriedade, o limite e o tamanho real. | Envie um arquivo menor ou aumente o `maxSize` na propriedade. |
| `STORAGE_FILE_TYPE_REFUSED` | 400 | O tipo do arquivo enviado não está no `acceptedFiles` da propriedade, ou não está no `allowedMimeTypes` da própria fonte de armazenamento. `details` traz a propriedade (ou a lista da fonte), a lista aceita e o tipo de conteúdo enviado. | Envie um tipo aceito ou expanda `acceptedFiles` / `allowedMimeTypes`. |
| `STORAGE_MISCONFIGURED` | 502 | O bucket S3 ou GCS com o qual esta fonte está configurada não existe, ou o provedor rejeitou as credenciais desta implantação para acessá-lo. A mensagem informa o bucket; `details.reason` é `NoSuchBucket` ou a recusa do provedor. Um bucket ausente costumava ser interpretado como "arquivo não encontrado" para todos os arquivos. | Corrija o nome do bucket (`S3_BUCKET` / `GCS_BUCKET`, `__<KEY>` para fontes nomeadas) ou as permissões das credenciais. |
| `STORAGE_NOT_CONFIGURED` | 501 / 503 | Nenhum backend de armazenamento está configurado neste servidor, ou nenhum é o padrão e a requisição não indica a fonte de armazenamento; a mensagem lista as fontes atendidas (501). Um upload retomável cuja fonte desapareceu antes da conclusão retorna 503. | Configure S3, GCS ou armazenamento local, ou informe uma fonte com `?storageId=`. |
| `STORAGE_SAME_LOCATION` | 400 | `POST /api/admin/storage/move` com `deleteSource` (`rebase storage move --delete-source`) entre duas fontes que armazenam no mesmo bucket ou diretório. Todo arquivo contaria como já existente no destino por ser o mesmo arquivo, e excluir a cópia da fonte apagaria a única cópia existente. Nada foi movido ou excluído. | Aponte a propriedade para a outra fonte; seus arquivos já estão lá. |
| `STORAGE_SCAN_INCOMPLETE` | 409 | `DELETE /api/admin/storage/orphans` (`rebase storage orphans --delete`) não pôde ler todas as coleções, portanto um arquivo referenciado por uma delas pareceria órfão. Com `?scan=`, a varredura indicada foi a que não conseguiu ler todas as coleções. Nada foi excluído; `details.unscanned` cita cada coleção e o motivo pelo qual não pôde ser lida. | Corrija o problema que impede a leitura dessas coleções e execute novamente. |
| `STORAGE_SCAN_NOT_FOUND` | 404 | `GET /api/admin/storage/orphans/scans/:id` ou `DELETE /api/admin/storage/orphans?scan=:id` especifica uma varredura que a fonte não possui. Varreduras são mantidas por 7 dias na fonte examinada, logo um `storageId` diferente do da varredura também não encontrará nada. | Passe o `storageId` da varredura ou inicie uma nova varredura. |
| `STORAGE_SCAN_NOT_COMPLETE` | 409 | `DELETE /api/admin/storage/orphans?scan=:id` indica uma varredura que ainda está em estado `queued` ou `running`, ou que falhou (`failed`). Nada foi excluído; `details.status` informa o estado. | Aguarde a conclusão da varredura ou inicie outra. |
| `STORAGE_SCAN_EXPIRED` | 409 | `DELETE /api/admin/storage/orphans?scan=:id` especifica uma varredura concluída há mais de 15 minutos. Nada foi excluído. | Inicie outra varredura e faça a exclusão a partir dela. |
| `STORAGE_SCAN_DELETION_STARTED` | 409 | `DELETE /api/admin/storage/orphans?scan=:id` indica uma varredura cujos arquivos órfãos já estão sendo excluídos. | Consulte o status de `deletion` da varredura com `GET /api/admin/storage/orphans/scans/:id`. |
| `STORAGE_SOURCE_NOT_CONFIGURED` | 501 | A fonte de armazenamento está declarada, mas não possui credenciais aqui. | Defina as variáveis de ambiente dessa fonte. |
| `STORAGE_WRITE_FAILED` | 502 | O backend de armazenamento recusou ou encerrou inesperadamente a gravação. | Verifique os logs e credenciais do próprio serviço de armazenamento. |
| `TRANSFORM_OVERLOADED` | 503 | Há muitas transformações de imagem sendo processadas simultaneamente. | Tente novamente; considere colocar uma CDN à frente. |
| `UNKNOWN_STORAGE_SOURCE` | 400 / 404 | A requisição especificou uma fonte de armazenamento (`?storageId=`) não declarada neste projeto. Um `bucket` não atendido por esta implantação retorna o mesmo código com **404** (em listagem, upload comum, pasta ou upload retomável para S3 ou GCS) — o armazenamento é o que está ausente, e `details` lista os buckets e fontes existentes. Ambos costumavam retornar "arquivo não encontrado", idêntico a uma chave simplesmente ausente. | Declare a fonte em `config/resources.ts` ou consulte `GET /api/storage/sources`. |
| `UPLOAD_LOCKED` | 423 | O `PATCH` de um upload retomável chegou enquanto outro bloco (chunk) do mesmo upload ainda estava sendo recebido — quase sempre decorrente de um cliente tentando reenviar o bloco em trânsito. É recusado em vez de colocado em fila, assim como faz o tusd. | Consulte o deslocamento atual com `HEAD /api/storage/tus/:id` e continue a partir dali; o tus-js-client recua e tenta novamente automaticamente. Veja [Uploads retomáveis (TUS)](/docs/backend/storage-resumable-uploads/). |

## Funções personalizadas

| Código | Status | Significado | O que fazer |
| --- | --- | --- | --- |
| `FUNCTION_NOT_FOUND` | 404 | Nenhuma função com esse nome está disponível — ou ela existe, mas suas rotas internas não cobrem o subcaminho solicitado. Um chamador autenticado também é informado sobre quais rotas *estão* disponíveis; chamadores anônimos não recebem isso, pois essa lista é um inventário de todos os endpoints personalizados. Quando um arquivo com esse nome falha ao carregar, a mensagem avisa ao chamador autenticado informando o arquivo: essa é a diferença entre um erro de digitação e uma implantação quebrada. O chamador anônimo recebe a resposta simples de nome desconhecido. | Verifique o nome consultando `GET /api/functions` ou cheque o log de inicialização em busca de arquivos com falha de carregamento. |
| `FUNCTION_TIMEOUT` | 504 | O manipulador (handler) excedeu seu tempo limite. Ele continua em execução; não é possível cancelá-lo a partir daqui. | Passe um `AbortSignal` nas chamadas externas ou aumente `REBASE_FUNCTIONS_TIMEOUT_MS`. |
| `FUNCTIONS_UPSTREAM_UNREACHABLE` | 502 | Este processo atua como proxy de funções para outro processo que não respondeu. | Verifique se a unidade de funções está em execução. |

## Tarefas cron

| Código | Status | Significado | O que fazer |
| --- | --- | --- | --- |
| `CRON_JOB_ALREADY_EXECUTING` | 409 | Disparo manual de uma tarefa cron que já está em execução — no processo que respondeu ou em outro detentor da concessão de execução (lease), como o worker por trás de um processo `api`. Nada foi executado. O salto é registrado no histórico da tarefa, e `details.log` é essa entrada; a linha indica o processo em execução. | Tente novamente quando a execução atual terminar. Veja [Tarefas Cron](/docs/backend/cron-across-instances/#concurrency-guarding). |

## Superfícies administrativas e edição de esquema

Estes códigos indicam que um recurso está desativado ou não configurado, e não
que a requisição estava incorreta. Cada um também é reportado na rota `/status`
correspondente com um status `200`, permitindo que um painel desative a interface
do recurso em vez de exibir um erro.

| Código | Status | Significado | O que fazer |
| --- | --- | --- | --- |
| `ADMIN_SURFACE_UNAVAILABLE` | 501 | Uma interface restrita a administradores foi chamada em um servidor sem autenticação configurada, logo não há como distinguir um administrador de qualquer outra pessoa. | Defina `auth.jwtSecret` ou passe um `AuthAdapter`. |
| `BRANCH_DIFF_STALE` | 409 | `POST /api/admin/branches/:name/merge` recebeu a impressão digital (fingerprint) de um diff desatualizado: a branch ou o pai mudou nesse meio-tempo. Nada foi gravado. | Leia o diff novamente, revise-o e faça a mesclagem com o novo `fingerprint`. |
| `BRANCH_DIFF_UNSUPPORTED` | 501 | A fonte de dados não pode comparar branches: não possui SQL ou suporte a branches (sem conexão administrativa). | Use um backend Postgres com `adminConnectionString` configurado. |
| `BRANCH_MERGE_BLOCKED` | 409 | Uma tabela divergente não pode ser mesclada — adicionada ou removida pela branch, colunas ou chave primária incompatíveis, ausência de chave primária, linhas em excesso para correspondência ou reescrita desde a criação da branch (`TABLE_REWRITTEN`). Uma tabela cujas linhas não puderam ser comparadas bloqueia o processo mesmo que sua contagem aponte 0: as contagens são desconhecidas, não zero. `details.tables` lista cada uma com o motivo. Nada foi gravado. | Aplique o esquema com suas migrações primeiro, ou mescle com `skipBlocked: true` para ignorar essas tabelas. |
| `BRANCH_MERGE_CONFLICT` | 409 | Linhas foram alteradas tanto na branch quanto no pai e `onConflict` estava como `"abort"` (o padrão); ou o pai recusou parte da mesclagem — uma linha mudou no processo, uma trigger a ignorou, uma política a ocultou. Nada foi gravado. | Escolha o lado vencedor com `onConflict: "branch"` ou `"target"`, ou leia o diff novamente. |
| `BRANCH_MERGE_FAILED` | 409 | O pai recusou as linhas da branch dentro da instrução de merge — uma restrição, rótulo de enum ou chave estrangeira que ele possui e que as linhas da branch violam, geralmente devido a divergência entre os dois esquemas. `details` informa `sqlState`, `table`, `constraint` e `detail`. Nada foi gravado. | Analise as mudanças de esquema no diff, alinhe o esquema pai com suas migrações ou corrija as linhas da branch antes de mesclar novamente. |
| `BRANCH_NOT_FOUND` | 404 | Nenhuma branch com esse nome foi encontrada no registro. | `rebase db branch list`, ou o painel de Branches, lista as branches existentes. |
| `CONTRACT_UNAVAILABLE` | 404 | O contrato do projeto só é servido quando a autenticação está configurada — ele descreve todas as tabelas e relações. | Configure a autenticação. `/meta/schema-version` é sempre servido. |
| `DEV_MAILBOX_UNAVAILABLE` | 501 | Nenhuma caixa de correio de desenvolvimento ativa. Mensagens só são capturadas quando `SMTP_HOST` não está definido e `NODE_ENV` não é production. | Remova `SMTP_HOST` em desenvolvimento ou consulte a caixa de entrada real. |
| `INVALID_CHANGE` | 400 | A alteração de esquema proposta está malformada. | Veja a mensagem. |
| `SCHEMA_CHANGE_FAILED` | 400 | A aplicação da alteração de esquema planejada falhou por um motivo não coberto por códigos mais específicos. | Veja a mensagem; ela traz a falha subjacente na íntegra. |
| `SCHEMA_CHANGE_UNAPPLICABLE` | 400 | A alteração é válida, mas não pode ser aplicada ao esquema no seu estado atual. | Veja a mensagem. |
| `SCHEMA_EDIT_DIRTY_TREE` | 409 | O repositório possui alterações não commitadas, portanto a edição não pôde ser aplicada com segurança. | Faça commit ou stash e tente novamente. |
| `SCHEMA_EDIT_REFUSED` | 400 | O editor de esquema recusou a edição. | Veja a mensagem; trata-se da própria recusa do editor. |
| `SCHEMA_EDIT_REQUIRES_A_PERSON` | 403 | Uma chave de API ou outro agente automatizado tentou aplicar uma alteração de esquema. | Faça login como usuário humano ou configure `liveSchema.allowMachineApply`. |
| `SCHEMA_EDITING_NO_COLLECTIONS_DIR` | 501 | A edição de esquema em tempo real precisa de `collectionsDir` ou `liveSchema.repository`, e este servidor foi iniciado sem nenhum deles. | Configure um deles. |
| `SCHEMA_EDITING_NO_REPOSITORY` | 503 | O planejamento funciona; não há repositório para commitar a alteração. | Configure `liveSchema.repository`. |
| `SCHEMA_EDITING_PROVISIONING_OFF` | 409 | Esta implantação não altera nada no banco de dados (`REBASE_PROVISION=false`), logo uma alteração não pode ser aplicada pelo painel. | Faça o commit apenas no código-fonte e deixe o processo encarregado das mudanças no banco aplicá-la. |
| `SCHEMA_EDITING_UNSUPPORTED` | 503 | Este driver não pode planejar alterações de esquema. | A edição em tempo real está disponível no Postgres. |
| `SCHEMA_EDITOR_BAAS_MODE` | 501 | As coleções são inspecionadas diretamente do banco de dados aqui, logo não existem arquivos de origem para editar. | Altere o esquema por meio de uma migração. |
| `SCHEMA_EDITOR_DISABLED` | 501 | O editor de esquema está desativado para este servidor. Um bundle compilado sempre retorna isto. | Ative com `schemaEditor`. Em um bundle, defina `REBASE_LIVE_SCHEMA_REPOSITORY` para editar coleções por meio de um repositório — veja [Edição de esquema em tempo real](/docs/backend/live-schema-editing#from-a-built-bundle). |
| `SCHEMA_EDITOR_MISSING_DEPENDENCY` | 501 | O editor de esquema precisa de `ts-morph`, que não está instalado. | Instale-o no pacote que executa o backend e reinicie: `pnpm --dir backend add -D ts-morph@28.0.0` da raiz de um projeto gerado, ou `pnpm add -D ts-morph@28.0.0` caso o backend seja o próprio projeto. A mensagem informa o comando para o seu projeto. |
| `SCHEMA_EDITOR_NO_COLLECTIONS_DIR` | 501 | O servidor não possui `collectionsDir`, logo o editor não tem onde gravar. | Defina `collectionsDir`. |
| `SCHEMA_EDITOR_PRODUCTION` | 501 | O editor fica desativado sob `NODE_ENV=production`: os arquivos de um servidor implantado são reconstruídos a partir do repositório a cada deploy, então uma edição feita aqui seria descartada. | Edite coleções em desenvolvimento e faça deploy, ou configure `liveSchema.repository` para commitá-las diretamente. |
| `SQL_EXPORT_UNSUPPORTED` | 501 | `POST /api/admin/sql/csv` não pode transmitir um resultado via streaming aqui: o banco de desenvolvimento em processo (PGlite) possui apenas uma conexão, e manter um cursor durante o download travaria todas as outras consultas; ou a fonte de dados não possui cursor SQL. | Aponte `DATABASE_URL` para um Postgres próprio (`rebase dev --docker` inicia um) ou adicione `LIMIT` e exporte as linhas visíveis na tela. |

### Reconciliação de esquema

[`rebase schema reconcile`](/docs/cli/schema/#rebase-schema-reconcile) faz o
planejamento via `POST /api/admin/schema/reconcile/plan` e aplica via
`/reconcile/apply`. Uma recusa não altera nada; apenas `SCHEMA_RECONCILE_FAILED`
deixa parte de um plano aplicada.

| Código | Status | Significado | O que fazer |
| --- | --- | --- | --- |
| `INVALID_RECONCILE` | 400 | O corpo não é um objeto JSON, ou `drop` não é uma lista de strings no formato `"<collection>.<column>"`. | Envie `{ "drop": ["voice_cache.wav"] }` ou omita `drop`. |
| `SCHEMA_RECONCILE_FAILED` | 400 | Uma instrução falhou no meio do processo. As instruções anteriores foram executadas e continuam aplicadas; `details.applied` as lista. | Corrija o que for apontado na mensagem e refaça o plano: o novo plano excluirá o que já foi aplicado. |
| `SCHEMA_RECONCILE_INVALID` | 400 | O plano não pode ser aplicado e a mensagem lista o motivo: um `drop` fora do formato `<collection>.<column>`, sem coleção ou sem coluna, ou indicando uma coluna que a coleção ainda declara. `details.plan` contém o plano. | Corrija a lista de `drop`. Uma coluna declarada é descartada removendo sua propriedade, implantando e executando a reconciliação. |
| `SCHEMA_RECONCILE_STALE` | 409 | O banco de dados ou as coleções mudaram desde o plano confirmado. `details.plan` contém o novo plano. | Revise o novo plano e confirme seu `digest`. |
| `SCHEMA_RECONCILE_UNCONFIRMED` | 400 | `/reconcile/apply` foi chamado sem o campo `confirm`. | Planeje primeiro e envie o `digest` do plano como `confirm`. A CLI faz isso quando você digita `yes`. |
| `SCHEMA_RECONCILE_UNSUPPORTED` | 503 | O driver deste backend não pode planejar uma reconciliação ou não pode executar SQL. | A reconciliação funciona no Postgres. |

### Por que uma tabela de uma branch não pode ser mesclada

`BRANCH_MERGE_BLOCKED` cita cada tabela recusada em `details.tables`, usando um
destes códigos. O mesmo código consta no campo `blocked` da tabela no próprio
diff, permitindo que o Studio alerte antes que alguém clique em **Merge**. Nenhum
deles é uma resposta de erro independente.

| Código | Status | Significado | O que fazer |
| --- | --- | --- | --- |
| `COLUMNS_DIFFER` | — | As colunas da tabela diferem entre a branch e seu pai. As linhas são comparadas apenas com base nas colunas compartilhadas. | Adicione as colunas ausentes no pai através de suas migrações (`rebase db push`) e mescle. Uma migração que reescreve a tabela — mudança de tipo de coluna — a converte em `TABLE_REWRITTEN`: mescle antes dessa alteração ou recrie a branch após ela. |
| `NO_PRIMARY_KEY` | — | A tabela não possui chave primária, impossibilitando a correspondência linha por linha; o diff fornece apenas as contagens de linhas. | Adicione uma chave primária à tabela ou transfira suas linhas manualmente. |
| `PRIMARY_KEY_DIFFERS` | — | As colunas da chave primária ou seus tipos diferem entre as duas tabelas. | Aplique o esquema ao pai primeiro. |
| `TABLE_ADDED` | — | A branch criou a tabela. Uma mesclagem nunca cria tabelas. | Crie-a no pai com suas migrações e depois mescle suas linhas. |
| `TABLE_DROPPED` | — | A branch removeu a tabela. Uma mesclagem nunca remove tabelas. | Remova-a utilizando suas migrações. |
| `TABLE_REWRITTEN` | — | Um dos lados reescreveu todas as linhas da tabela após a criação da branch — alteração no tipo de coluna, `ADD COLUMN` com default volátil, `VACUUM FULL`, `CLUSTER` — de modo que todas as linhas aparecem como modificadas posteriormente, tornando impossível distinguir qual lado alterou qual linha. | Mescle a branch antes de tal migração ou recrie a branch a partir do pai após ela. |
| `TOO_LARGE` | — | A tabela possui mais linhas em um dos lados do que a quantidade que um diff compara individualmente (100.000 por padrão, `maxRowsPerTable`). | Aumente `maxRowsPerTable` tanto no diff quanto no merge, ou transfira as linhas por outro método. |

## Códigos genéricos

Uma rota utiliza um destes códigos quando nenhum outro mais específico se aplica.

| Código | Status | Significado | O que fazer |
| --- | --- | --- | --- |
| `BAD_REQUEST` | 400 | Requisição malformada, sem código mais específico aplicável. | Veja a mensagem. |
| `UNAUTHORIZED` | 401 | Não autenticado ou a credencial foi rejeitada. | Faça login ou renove as credenciais. |
| `FORBIDDEN` | 403 | Autenticado, mas não permitido. | Tentar novamente com a mesma identidade não ajudará. |
| `CONFLICT` | 409 | Conflito com o estado existente. | Veja a mensagem. |
| `INTERNAL_ERROR` | 500 | Algo falhou no servidor. A mensagem é intencionalmente genérica. | Cite o `requestId`; o motivo detalhado está nos logs. |
| `NOT_CONFIGURED` | 503 | Uma dependência necessária para esta rota não está configurada neste servidor. | Veja a mensagem. |
| `SERVICE_UNAVAILABLE` | 503 | Um serviço do qual a requisição depende não pôde ser alcançado: um bucket S3 ou MinIO, ou um host chamado via `fetch()` por uma função que recusou a conexão ou não resolveu DNS. O log do servidor informa o host; a resposta HTTP não. Um banco inacessível gera `DATABASE_UNAVAILABLE`. Qualquer conexão com falha para esses serviços resulta nesta resposta. | Tente novamente; verifique os logs. |

## Mantendo esta página precisa

`pnpm verify:docs` falha se um código que o servidor pode lançar estiver ausente
destas tabelas, se uma tabela listar um código que nada pode lançar, se os status
de uma linha não forem exatamente aqueles com os quais o código-fonte lança o erro,
ou se uma família de códigos como `PG_<SQLSTATE>` não contiver uma linha para um
SQLSTATE com o qual os clientes de fato se deparam. A etapa de verificação é
`tooling/scripts/docs-verify/check-error-codes.mjs`.

O script faz uma checagem preliminar em si mesmo. A varredura lê os códigos a
partir do TypeScript em vez de inspecionar um servidor em execução, logo seus
pontos cegos são silenciosos por concepção: anteriormente, ele não conseguia ver
códigos passados por um wrapper de linha única ou códigos escritos após uma
mensagem contendo um `)`, reportando erroneamente que "todos os códigos do servidor
estão documentados" em uma página que deixava de fora dezessete deles. Por isso,
o processo executa um teste contendo exatamente esses padrões antes de ler esta
página, e recusa-se a validar qualquer coisa caso não consiga identificá-los.
