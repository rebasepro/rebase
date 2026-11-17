---
sourceHash: a730e31a86f730a7
title: Códigos de erro
sidebar_label: Códigos de erro
description: Cada código de erro que um backend Rebase pode retornar, com seu status HTTP, o que significa e o que fazer a respeito — além do envelope de resposta, X-Request-ID e as regras de details.
---

Cada falha retornada por um backend Rebase utiliza um único envelope e contém um
`code` estável. O código é o elemento a ser usado em condicionais: a mensagem é escrita para uma pessoa
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
  um `5xx`, é deliberadamente genérica, pois o texto subjacente pode citar um
  host, uma role ou o nome de uma coluna.
- **`code`** — um dos valores abaixo. Estável entre versões secundárias (minor versions).
- **`details`** — opcional e nunca garantido. Veja as regras abaixo.
- **`requestId`** — presente sempre que a requisição passou pelo middleware de
  request-ID, que abrange todas as rotas sob `basePath`.

### `X-Request-ID`

Toda requisição sob `basePath` recebe um ID: o cabeçalho `X-Request-ID` do chamador
quando for um UUID, ou um novo caso contrário. Ele é retornado na
resposta como `X-Request-ID`, incluído no envelope de erro como `requestId` e
anexado à linha de log do servidor referente a essa requisição.

Essa é a chave de junção. Cite-a em um relatório de bug e um operador poderá encontrar a
linha de log exata que explica a falha, contendo o motivo que nunca foi exibido
ao cliente.

Enviar o seu próprio ID é a maneira como um trace sobrevive a um salto (hop): um gateway ou um executor de jobs que
encaminha o cabeçalho obtém um único ID em todos os serviços que processaram a requisição.
Um valor inválido é ignorado em vez de rejeitado — não vale a pena falhar uma requisição por causa de um cabeçalho
malformado enviado por um chamador —, portanto, não presuma que o ID enviado é
o ID recebido. Leia o cabeçalho de resposta.

### O que há em `details`

`details` tem finalidade diagnóstica, não contratual. Três regras o regem:

1. **Qualquer coisa que uma rota defina explicitamente é sempre retornada.** Esses são os
   próprios erros do chamador descritos com precisão: qual campo de filtro era desconhecido,
   qual relação não permite escrita, qual valor não correspondeu ao seu tipo.
2. **Os diagnósticos de banco de dados são omitidos em produção.** Quando a falha se origina
   do Postgres, `details.dbCode` — o SQLSTATE — está sempre presente: ele nomeia
   a classe do problema e não revela nada sobre os dados. `dbMessage`,
   `detail` e `hint` são adicionados apenas quando `NODE_ENV` não for `production`,
   pois o Postgres inclui o conteúdo das linhas neles. O código `23505` reporta
   `Key (email)=(a@b.c) already exists.`, o que responde "esta pessoa
   está cadastrada?" para qualquer endereço que alguém decida tentar.
3. **Nunca crie condicionais baseadas em `details`.** Crie condicionais baseadas em `code`. O conteúdo sob `details` é
   qualquer coisa que tenha sido útil para uma pessoa naquele ponto de chamada, e isso muda.

## Interpretando um status

| Status | O que indica sobre a requisição |
| --- | --- |
| `400` | Malformada ou solicitando algo que não existe no esquema. Corrija a requisição. |
| `401` | Não autenticado ou a credencial expirou. Faça login ou renove a sessão. |
| `403` | Autenticado, mas não permitido. Tentar novamente com a mesma identidade não resolverá. |
| `404` | Rota, tabela ou linha inexistente — ou uma linha ocultada pela segurança em nível de linha (RLS). |
| `409` | Um conflito com o estado existente: uma duplicata ou uma escrita concorrente. |
| `413` `415` `422` | O corpo é muito grande, o tipo de mídia está incorreto ou foi semanticamente rejeitado. |
| `429` | Limite de taxa atingido (rate limited). Aguarde; a mensagem informa por quanto tempo. |
| `500` | O servidor ou seu banco de dados está com erro, não o chamador. Verifique os logs. |
| `501` | A rota existe, mas esta implantação não pode atendê-la — um recurso desativado ou não configurado. |
| `502` `503` `504` | Uma dependência estava inacessível, não configurada ou demorou demais para responder. |

## Autenticação e contas

| Código | Status | Significado | O que fazer |
| --- | --- | --- | --- |
| `AAL2_REQUIRED` | 403 | A rota requer um segundo fator e a sessão possui apenas um. | Complete o desafio de MFA e tente novamente. |
| `ALREADY_VERIFIED` | 400 | O endereço ou fator já foi verificado. | Nada — o estado desejado já é verdadeiro. |
| `ACCOUNT_OUTRANKS_CALLER` | 403 | A conta que está sendo editada, redefinida ou excluída possui uma role ou escopo que o chamador não possui. `details.beyond` lista quais são. | Peça a alguém que os possua para realizar a alteração. |
| `ANONYMOUS_AUTH_DISABLED` | 403 | O login anônimo está desativado neste servidor. | Habilite-o ou faça login com uma identidade real. |
| `ANONYMOUS_NOT_ALLOWED` | 403 | Uma sessão de convidado tentou aprovar um login de dispositivo. Um convidado não tem conta para vincular a um dispositivo. | Faça login com uma conta e aprove em seguida. |
| `API_KEY_SELF_MANAGEMENT_FORBIDDEN` | 403 | Uma chave de API tentou listar, criar, alterar ou revogar chaves de API, sejam do seu próprio tipo ou pessoais. | Gerencie chaves como um usuário com `keys:write` ou utilizando a chave de serviço. |
| `AUTH_MIDDLEWARE_MISSING` | 500 | Uma rota protegida foi executada sem nenhum middleware de autenticação Rebase antes dela, de modo que a credencial do chamador nunca foi inspecionada. | Monte a aplicação através do roteador de funções em vez de montá-la diretamente no seu próprio servidor. |
| `BOOTSTRAP_ANONYMOUS` | 403 | O bootstrap do primeiro administrador foi tentado por um chamador anônimo. | Faça login primeiro. |
| `BOOTSTRAP_COMPLETED` | 403 | O primeiro administrador já existe. | Peça a um administrador existente para conceder a role. |
| `BOOTSTRAP_NOT_FIRST_USER` | 403 | O bootstrap destina-se apenas ao primeiro usuário, e este não é ele. | Peça a um administrador existente para conceder a role. |
| `CAPTCHA_FAILED` | 400 | O provedor rejeitou o token de CAPTCHA. | Resolva um novo desafio. |
| `CAPTCHA_REQUIRED` | 400 | A rota requer um token de CAPTCHA e nenhum foi enviado. | Inclua o token. |
| `CHALLENGE_EXHAUSTED` | 401 | Muitas tentativas incorretas de código para o mesmo desafio de MFA. | Inicie um novo desafio. |
| `DEVICE_LOGIN_DECIDED` | 409 | O login do dispositivo já foi aprovado ou negado. Um login é decidido apenas uma vez. | Inicie um novo login no dispositivo. |
| `DEVICE_LOGIN_EXPIRED` | 410 | O login do dispositivo ultrapassou o limite de dez minutos antes de ser decidido. | Inicie um novo login no dispositivo. |
| `DEVICE_LOGIN_NOT_FOUND` | 404 | Nenhum login de dispositivo possui esse código de usuário. A própria sondagem (polling) do dispositivo responde com os códigos em minúsculas da RFC 8628: `authorization_pending`, `slow_down`, `access_denied`, `expired_token`, `invalid_grant`. | Verifique o código comparando-o com o exibido no dispositivo. |
| `EMAIL_EXISTS` | 409 | Já existe uma conta com esse endereço — no cadastro, na alteração de endereço ou ao acessar um link de alteração de endereço quando outra conta assumiu o endereço enquanto ele aguardava. | Faça login ou inicie a redefinição de senha; para uma alteração de endereço, escolha outro endereço. |
| `EMAIL_NOT_CONFIGURED` | 503 | Magic links ou OTP foram solicitados, mas o servidor não possui transporte de e-mail configurado. | Configure o SMTP ou use outro método de login. |
| `EMAIL_NOT_VERIFIED` | 403 | Um login via OAuth encontrou uma conta com o mesmo endereço, mas o provedor não verificou esse endereço, de modo que ele não foi vinculado. | Faça login com o método existente e, em seguida, execute `POST /auth/link/<provider>`. |
| `FACTOR_NOT_VERIFIED` | 400 | O fator MFA foi cadastrado, mas nunca confirmado. | Confirme o fator. |
| `IDENTITY_ALREADY_LINKED` | 409 | Essa identidade OAuth pertence a outra conta. | Faça login com ela ou desvincule-a da outra conta primeiro. |
| `IMPERSONATION_FORBIDDEN` | 403 | Uma requisição enviou `x-rebase-impersonate` e o seu chamador não tem permissão para executar uma requisição como outro usuário. Apenas a sessão de um administrador autenticado pode fazer isso, nunca uma chave de API ou a chave de serviço. | Envie a requisição com a sessão de um administrador ou remova o cabeçalho. |
| `IMPERSONATION_INVALID` | 400 | `x-rebase-impersonate` foi enviado vazio. | Envie o uid do usuário a ser personificado ou remova o cabeçalho. |
| `IMPERSONATION_TARGET_NOT_FOUND` | 404 | `x-rebase-impersonate` não indica nenhum usuário ativo: nenhuma conta possui esse uid ou ela está desativada. | Verifique o uid. |
| `IMPERSONATION_UNAVAILABLE` | 501 | A autenticação deste backend não pode executar uma requisição como outro usuário porque seu `AuthAdapter` não possui `resolveUser`. | Implemente `resolveUser` no adaptador ou remova o cabeçalho. |
| `IMPERSONATION_UNSUPPORTED` | 400 | `x-rebase-impersonate` foi enviado para uma rota que não pode ser executada como outro usuário. Apenas a API de dados e funções customizadas aceitam essa opção, e o socket em tempo real aceita `impersonate` em `AUTHENTICATE`. | Envie a requisição sem o cabeçalho. |
| `SIMULATION_FORBIDDEN` | 403 | Uma requisição enviou um cabeçalho `x-rebase-simulate-*` (o simulador de RLS) ou solicitou `/api/admin/rls-simulator`, e seu chamador não tem permissão para simular acesso. Apenas a sessão de um administrador autenticado pode fazer isso, nunca uma chave de API ou a chave de serviço. | Envie com a sessão de um administrador ou remova os cabeçalhos. |
| `SIMULATION_INVALID` | 400 | A simulação estava malformada: um cabeçalho foi enviado vazio, `x-rebase-simulate-api-key-id` foi combinado com uma role ou id de usuário, ou a simulação foi combinada com `x-rebase-impersonate`. | Especifique uma única role (opcionalmente com um uid), um único id de usuário ou um único id de chave de API. |
| `SIMULATION_READ_ONLY` | 403 | Uma escrita, exclusão, `_batch`, reversão de histórico ou uma função customizada chamada por qualquer verbo diferente de `GET`/`HEAD`/`OPTIONS` continha um cabeçalho `x-rebase-simulate-*`. O acesso simulado é somente leitura: a escrita seria executada como a identidade simulada, não como o administrador. Leituras, incluindo `POST …/query` e `…/count`, continuam sendo executadas. | Interrompa a simulação para realizar alterações. |
| `SIMULATION_TARGET_NOT_FOUND` | 404 | A simulação não indica nenhum usuário ativo (um id de usuário enviado sem role) ou nenhuma chave de API válida. | Verifique o id ou envie uma role junto com o uid para simular um uid que não possui conta. |
| `SIMULATION_UNAVAILABLE` | 501 | Este backend não pode simular acesso: seu `AuthAdapter` não possui `resolveUser` para confirmar um administrador, ou uma chave foi informada em um backend sem chaves de API. | Implemente `resolveUser` ou remova os cabeçalhos. |
| `SIMULATION_UNSUPPORTED` | 400 | Um cabeçalho `x-rebase-simulate-*` foi enviado para uma rota que não pode ser executada com acesso simulado. Apenas a API de dados e funções customizadas os aceitam. | Envie a requisição sem os cabeçalhos. |
| `GUEST_REFERENCED` | 409 | Um convidado não pôde ser excluído porque uma linha do próprio projeto depende dele, por meio de uma chave estrangeira com `ON DELETE RESTRICT` ou `NO ACTION`. `DELETE /api/admin/guests` reporta isso por convidado em `skipped` e continua a execução. | Exclua a linha ou mantenha o convidado. |
| `INVALID_ACCOUNT` | 400 | A conta está em um estado no qual esta operação não pode atuar. | Veja a mensagem. |
| `INVALID_CHALLENGE` | 400 | O desafio de MFA é desconhecido ou expirou. | Inicie um novo desafio. |
| `INVALID_CODE` | 400 / 401 | O código OTP ou MFA está incorreto: 400 no login por código de e-mail (`/auth/otp/verify`), 401 no cadastro ou desafio de MFA. | Tente novamente com o código atual. |
| `INVALID_CREDENTIALS` | 401 | E-mail ou senha incorretos — deliberadamente sem especificar qual deles. | Tente novamente ou redefina a senha. |
| `INVALID_PLATFORM_TOKEN` | 401 | Um token de plataforma `rpt_` foi recusado: assinatura inválida, audience incorreta, expirado ou tempo de vida acima do limite máximo. A mensagem informa o motivo. | Solicite à plataforma a geração de um novo token — no Rebase Cloud, execute o comando novamente. |
| `INVALID_SCOPES` | 400 | Uma chave foi solicitada com algo que não é um escopo: malformado, desconhecido ou com um destino que o escopo não aceita. `details.problems` informa quais e o porquê; `details.validScopes` lista os escopos que uma chave pode possuir. Não inclui `keys:read` e `keys:write`, que nenhuma chave pode possuir. | Use um nome da lista. Veja [Roles e escopos](/docs/backend/roles-and-scopes/). |
| `INVALID_TOKEN` | 400 / 401 | Um token de verificação, redefinição, magic link ou alteração de endereço está malformado, é desconhecido, já foi utilizado ou expirou (400). Uma credencial de provedor OAuth ou um token de atualização que não valida resulta em 401. | Solicite um novo link ou faça login novamente. |
| `INVALID_USER_CODE` | 400 | O valor enviado como código de login de dispositivo não é válido: deve ter oito letras, como `BCDF-GHJK`. | Copie o código exibido no dispositivo. |
| `INVALID_ROLE` | 400 | O nome da role sendo gravado não é uma string, está vazio ou contém `,` `{` `}` `"` `\` ou um caractere de controle. Esses caracteres seriam lidos de volta como outras roles: uma role trafega em um `text[]` do Postgres e na lista separada por vírgulas dividida pelas políticas de RLS, portanto `"support,admin"` retornaria como `admin`. `details.problems` identifica cada um. | Renomeie a role. Qualquer outro nome é aceito. |
| `KEY_MANAGEMENT_SCOPE` | 400 | Uma chave solicitou `keys:read` ou `keys:write`. Nenhuma chave pode gerenciar chaves. `details.scopes` lista quais foram solicitados. | Remova-os da solicitação. |
| `KEY_OUTRANKS_CALLER` | 403 | Um detentor de `keys:write` tentou alterar ou revogar uma chave de serviço que possui uma role ou escopo que ele não possui. Apenas um admin gerencia qualquer chave. `details.roles` e `details.scopes` informam o que a chave possui além do chamador. | Peça a um administrador ou a alguém que possua essas permissões para alterar a chave. |
| `LAST_ADMIN` | 403 | A alteração deixaria o projeto sem nenhum administrador. | Promova outro usuário primeiro. |
| `MFA_REQUIRED` | 401 | A senha estava correta e a conta possui um segundo fator verificado, portanto o login está apenas concluído pela metade. `details` contém um token de curta duração restrito ao desafio de MFA — não é uma sessão. | Abra um desafio e responda-o; a resposta ao desafio emitirá a sessão. |
| `NO_SESSION` | 401 | Nenhum cookie de sessão ou refresh token foi apresentado. Comum no carregamento inicial da página. | Faça login. |
| `NOT_ANONYMOUS` | 400 | Uma rota de upgrade de anônimo foi chamada por uma conta real, ou `DELETE /api/admin/guests/:uid` indicou uma conta real. | Nada a atualizar. Para excluir uma conta, use `DELETE /api/admin/users/:uid`. |
| `OAUTH_ERROR` | 401 | O provedor OAuth recusou ou retornou um erro. | Tente o fluxo novamente; a mensagem contém o motivo informado pelo provedor. |
| `PERSONAL_KEYS_DISABLED` | 403 | Chaves de API pessoais estão desativadas neste backend. | Defina `personalKeys: true` nas opções de `auth` da tabela de autenticação (`defineAuthTable`). |
| `PERSONAL_KEY_NEEDS_ACCOUNT` | 403 | A chave de serviço ou uma sessão de convidado tentou usar as rotas de chaves pessoais. Nenhuma delas possui uma conta para a qual uma chave possa atuar. | Faça login em uma conta ou crie uma chave de serviço em `/api/admin/api-keys`. |
| `PLATFORM_TOKENS_OFF` | 401 | Um token de plataforma `rpt_` alcançou um servidor que não os aceita: `REBASE_PLATFORM_TOKEN_KEY` e `REBASE_PLATFORM_TOKEN_AUDIENCE` não estão definidos. | A plataforma que hospeda o app define ambos no momento do deploy; faça um novo deploy ou faça login no app por outro método. |
| `RATE_LIMITED` | 429 | Muitas tentativas vindas deste chamador. | Aguarde; a mensagem informa por quanto tempo. |
| `REDIRECT_URI_NOT_ALLOWED` | 400 | O destino de redirecionamento não está na lista de permissões (allow-list). | Adicione-o à configuração do provedor. |
| `REGISTRATION_DISABLED` | 403 | O autocadastro está desativado. | Peça a um administrador para criar a conta. |
| `ROLE_EXCEEDS_CALLER` | 403 | As roles concedidas possuem um escopo, ou `admin`, que o chamador não possui. `details.beyond` lista quais são. | Peça a alguém que os possua para conceder a role. |
| `ROLE_EXCEEDS_CREATOR` | 403 | Uma chave de serviço recebeu uma role de RLS que seu criador não possui. Apenas um admin pode conceder qualquer role. `details.roles` lista quais são. | Remova a role ou peça a um administrador para criar a chave. |
| `ROLE_EXISTS` | 409 | Esse nome de role já está em uso. | Escolha outro nome. |
| `ROLE_LOOKUP_FAILED` | 503 | Não foi possível consultar as roles do chamador — em uma rota de admin ou em uma requisição de dados em um backend com `config.auth`. Falha fechando o acesso em vez de confiar nas roles contidas no token. Um token cujo uid não referencia nenhuma conta, incluindo um uid que a tabela de usuários não pode conter, resulta em 401, não neste código. Um banco de dados inacessível resulta em `DATABASE_UNAVAILABLE`, não neste código. | Tente novamente; verifique o banco de dados. |
| `SCOPE_EXCEEDS_CREATOR` | 403 | Uma chave solicitou um escopo que seu criador não possui. Uma chave nunca possui mais privilégios do que a conta que a cria. `details.scopes` lista quais são. | Remova-os ou peça a alguém que os possua para criar a chave. |
| `SCOPE_MISSING` | 403 | A credencial não possui o escopo necessário para esta rota, tabela, fonte de armazenamento ou função. `details.requiredScope` informa o escopo, incluindo o destino. | Para uma pessoa, obtenha uma role que declare o escopo. Para uma chave, utilize uma chave que o possua. Veja [Roles e escopos](/docs/backend/roles-and-scopes/). |
| `SCOPE_NOT_DECLARED` | 500 | Uma rota protegida com `requireScope` especifica um escopo de aplicativo que este backend não declara, portanto ninguém o possui, nem mesmo um administrador. Um nome que não seja um escopo de forma alguma, ou um escopo embutido escrito incorretamente, como `data:raed`, nunca chega a este ponto: `requireScope` lança um erro no momento do registro da rota. | Declare o escopo em `auth.scopes` na tabela de autenticação ou corrija o nome. Veja [Roles e escopos](/docs/backend/roles-and-scopes/). |
| `SELF_DELETE` | 400 | Um administrador tentou excluir a própria conta. | Peça a outro administrador para fazê-lo. |
| `SESSION_REVOKED` | 401 | A sessão foi encerrada em outro lugar, todas as sessões foram revogadas ou a conta foi excluída. Todas as portas de entrada que aceitam uma sessão retornam este erro para tal token de acesso: a API de dados, armazenamento, funções customizadas e as rotas administrativas. O socket em tempo real recusa o seu comando `AUTHENTICATE` com um frame `AUTH_ERROR` contendo o mesmo código. O SDK tenta renovar, a renovação é recusada e ele faz logout. | Faça login novamente. |
| `ACCOUNT_DISABLED` | 401/403 | Um administrador desativou a conta: o login (403), a renovação e todos os tokens associados (401) são recusados em todas as portas de entrada que aceitam uma sessão. O socket em tempo real recusa o comando `AUTHENTICATE` com um frame `AUTH_ERROR` contendo o mesmo código. | Entre em contato com um administrador. |
| `EMAIL_NOT_CONFIRMED` | 403 | `requireEmailVerification` está ativado e o endereço ainda não foi verificado. Retornado apenas para senhas corretas; um novo link é enviado por e-mail. | Acesse o link enviado por e-mail. |
| `PROOF_REQUIRED` | 409 | `POST /auth/verify-email`: a conta possui uma senha ou identidade que ninguém comprovou, e a requisição não comprova nenhuma das duas. O token não é consumido. | Envie `password` para mantê-la ou `removeUnproven: true` para verificar sem ela. |
| `UNDELIVERABLE_ADDRESS` | 400 / 409 | Foi solicitada a confirmação por e-mail para um endereço inalcançável — de um convidado ou um placeholder do X (400) — ou uma conta solicitou a alteração para tal endereço (409, `POST /auth/change-email`). | Defina um endereço real primeiro. |
| `EMAIL_UNCHANGED` | 400 | `POST /auth/change-email` informou o endereço atual da conta. | Nada a alterar. |
| `ANONYMOUS_USER` | 403 | Um convidado solicitou a alteração de seu endereço de e-mail; um convidado não possui endereço próprio. | Converta-o em uma conta primeiro (`POST /auth/anonymous/link`). |
| `MFA_NOT_ENROLLED` | 400 | Códigos de recuperação foram solicitados para uma conta sem nenhum segundo fator verificado. | Cadastre um fator primeiro. |
| `HOOK_REJECTED` | 400 | Um hook `beforeUserCreate`, `beforeLogin`, `beforeUserDelete` ou `beforeEmailChange` lançou um erro. A mensagem é a do próprio hook; um hook que selecionou um status 4xx responderá com ele. | Veja a mensagem. |
| `INVALID_JSON` | 400 | O corpo da requisição não é um JSON válido. | Envie um corpo no formato JSON. |
| `SELF_DISABLE` | 400 | Um administrador tentou desativar a própria conta. | Peça a outro administrador. |
| `NOT_SUPPORTED` | 501 | O repositório de autenticação deste backend não suporta a operação solicitada (desativar contas, alterar endereço). | Reinicie o servidor para que a coluna seja adicionada ou use um repositório compatível. |
| `UNKNOWN_SCOPE_TARGET` | 400 | O destino de um escopo nomeia uma tabela, fonte de armazenamento ou função que este backend não fornece. `details` lista os destinos disponíveis. | Corrija o destino. |
| `UNVERIFIED_IDENTITIES` | 409 | Um magic link, código por e-mail ou redefinição de senha comprovou o endereço de uma conta não verificada, e a conta possui uma identidade de login cujo provedor nunca verificou esse endereço. O repositório de autenticação não pode removê-la (não possui `unlinkUserIdentity`), portanto a comprovação é recusada para evitar deixar essa brecha em uma conta verificada. | Implemente `unlinkUserIdentity` no repositório de autenticação customizado ou peça a um administrador para revisar a conta. |
| `SETUP_REQUIRED` | 403 | O projeto ainda não possui um administrador, portanto esta rota não está disponível. | Conclua a configuração do primeiro administrador. |
| `TOKEN_ALREADY_USED` | 401 | Um token de uso único foi reutilizado, ou um refresh token que foi rotacionado há mais tempo do que `refreshTokenReuseIntervalSeconds`. | Solicite um novo token ou faça login novamente. |
| `TOKEN_EXPIRED` | 401 | O token ultrapassou o seu tempo de vida. | Solicite um novo token. |
| `USER_NOT_FOUND` | 404 | Nenhuma conta encontrada com esse id. | Verifique o id. |
| `WEAK_PASSWORD` | 400 | A senha não cumpre a [política de senhas](/docs/backend/auth-endpoints/#password-policy) (por padrão, 8+ caracteres contendo letra maiúscula, letra minúscula e dígito) — no cadastro, na redefinição ou alteração, ou na senha escolhida por um administrador: `POST /api/admin/users`, criação na tabela de autenticação via API de dados, `PUT /api/admin/users/:id` ou `POST /api/admin/users/:id/reset-password`. | Escolha uma senha mais forte. Um administrador importando contas pode enviar `skipPasswordPolicy: true` na criação. |

## Dados, consultas e escritas

| Código | Status | Significado | O que fazer |
| --- | --- | --- | --- |
| `AGGREGATE_MASKED_BY_AFTER_READ` | 400 | Um agregador diferente de `count()` sem `groupBy` em uma tabela reescrita por um hook `afterRead` (global, tabela ou `.transform()` de uma coluna). Um agregador lê os valores armazenados e nunca executa o hook; portanto, uma soma, mínimo, máximo, contagem de campos ou agrupamento leria o que o hook oculta. | Use `count()` sem `groupBy`, ou leia as linhas, que passam pelo hook. |
| `AGGREGATE_NOT_SUPPORTED` | 501 | Este driver não suporta o cálculo do agregador solicitado. | Use um driver compatível ou calcule no cliente. |
| `BRANCHING_UNSUPPORTED` | — | Uma branch de banco de dados foi solicitada via websocket do Studio no banco de dados de desenvolvimento gerenciado (PGlite), onde uma branch *é* o próprio pai e nada seria isolado. A recusa é a mesma exibida por `rebase db branch`. | Aponte `DATABASE_URL` para uma instância própria do Postgres (`rebase dev --docker` inicia uma) e crie branches lá. |
| `BATCH_TOO_LARGE` | 400 | `POST /api/data/_batch` contém mais operações do que o limite por lote (1000 por padrão). Um lote corresponde a uma transação e retém seus bloqueios (locks) durante toda a sua extensão. | Envie em partes menores; a mensagem informa o limite e a sua contagem. |
| `BATCH_UNSUPPORTED` | 400 | O driver deste backend não suporta escritas atômicas entre tabelas, e um loop de escritas individuais não seria atômico nem executado em uma única viagem de ida e volta (round trip). | Envie as escritas como requisições separadas ou como chamadas `/bulk` por tabela. |
| `BULK_TOO_LARGE` | 400 | O corpo da operação em massa (bulk) excede o limite configurado de itens. | Divida a requisição. |
| `BULK_UNSUPPORTED` | 400 | Esta tabela ou driver não suporta escritas em lote (bulk). | Escreva as linhas uma por vez. |
| `CALLBACK_REJECTED` | 400 / 403 | Um hook de tabela recusou a escrita. Um `throw` em `beforeSave`/`beforeDelete`/`after*` resulta em um 400 contendo a mensagem do próprio autor; um `beforeDelete` que retorna `false` resulta em 403. `details.stage` informa qual hook, `details.path` a tabela. | Leia a mensagem — ela foi escrita por este projeto, não pelo Rebase. |
| `CALLBACK_RECURSION` | 500 | Escritas iniciadas por hooks aninhados ultrapassaram 16 níveis de profundidade: a escrita de um hook via `context.data` dispara novamente os hooks daquela tabela, e nada na cadeia interrompe o ciclo — geralmente um `afterSave` que atualiza a própria linha incondicionalmente. Toda a escrita foi revertida. A mensagem identifica o hook e a tabela; `details.chain` lista cada etapa hook → escrita. | Torne a escrita do hook condicional: atue apenas em `status === "new"`, ou ignore quando `values` já contiverem o que seria gravado. |
| `TABLE_READ_ONLY` | 405 | Uma escrita atingiu uma view (`defineView`). Uma view é somente leitura. Anteriormente era `COLLECTION_READ_ONLY`. | Escreva nas tabelas que a view lê. Veja [Views](/docs/collections/views/). |
| `TABLE_WITHHELD` | 503 | A tabela está declarada, mas o banco de dados não a protege: a segurança em nível de linha (RLS) está desativada, nenhuma das políticas declaradas está presente, ou uma política restritiva declarada está ausente. (Uma política permissiva ausente é atendida, com um aviso de boot indicando-a.) Isso acontece quando o servidor não provisiona suas tabelas (`REBASE_PROVISION=false`, `provisionSchema: false`, `provision.tables: false`, `REBASE_MIGRATE_ON_BOOT=none`), e o servidor retém a tabela em vez de expor todas as linhas a todos os chamadores. Uma junção many-to-many está sujeita à mesma regra: quando ela falha, as tabelas cujas relações a utilizam são retidas e a mensagem identifica a junção; o mesmo ocorre com uma tabela cujo `via` passa por uma tabela retida, indicando o `via`. Uma leitura de relação ou filtro que passe por uma tabela retida também retorna este código. As demais tabelas continuam sendo atendidas. O log de inicialização informa os comandos necessários para protegê-la. | Execute os comandos indicados no log de inicialização (`rebase db push` faz isso) e reinicie. Ou, se a própria aplicação gerenciar o acesso a essa tabela, declare `rlsRequired: false` nela (ou `database({ rls: { required: false } })`) e reinicie. |
| `SQL_NOT_ALLOWED` | 400 | O SQL executado como o chamador (`getSql(c)`, `withAuth(user).sql`) não era uma única instrução pura `SELECT`, `WITH`, `VALUES`, `TABLE`, `INSERT`, `UPDATE`, `DELETE` ou `MERGE`, ou chamou `set_config` ou mencionou `pg_settings`. A identidade do chamador reside nas configurações da sessão; portanto, qualquer instrução que possa alterá-las é recusada. | Mantenha o texto da consulta próprio, em uma única instrução, passando todos os valores em `params`. Veja [Funções customizadas](/docs/backend/custom-functions/#3-getsqlc--sql-as-the-caller). |
| `CURSOR_WITH_OFFSET` | 400 | `?after=` foi combinado com `?offset=` ou `?page=`. Um cursor já especifica onde a página começa; portanto, um deslocamento aplicado sobre ele pula silenciosamente essa quantidade de linhas após o cursor — uma lacuna que o chamador não consegue identificar na resposta. | Use um ou outro. |
| `DISTINCT_NOT_APPLICABLE` | 400 | `?distinct=true` foi combinado com uma busca textual ou consulta vetorial. Ambas anexam uma pontuação por linha; portanto, nenhuma linha é idêntica a outra e `DISTINCT` não agruparia nada — pareceria funcionar, mas não alteraria nada. | Remova um dos dois parâmetros. |
| `DISTINCT_ORDER_BY_NOT_SELECTED` | 400 | Uma leitura com `distinct` é ordenada por uma coluna que ela não retorna. Um `SELECT DISTINCT` só pode ser ordenado por colunas presentes na sua lista de seleção, caso contrário as linhas agrupadas não têm uma ordem definida. `details.fields` lista quais são. | Adicione esses campos a `?fields=` ou remova-os de `?orderBy=`. |
| `DATABASE_UNAVAILABLE` | 503 | O banco de dados não pôde ser alcançado: a conexão foi recusada ou perdida, o host não foi resolvido, o servidor está iniciando ou desligando, ou o banco de dados está fechado para novas conexões (`ALLOW_CONNECTIONS false`, deixado na origem quando um `rebase db branch create --force` é interrompido no meio; o log do servidor informa o banco de dados e `rebase db branch list` o reabre). Todas as portas de entrada retornam este código, incluindo login, rotas administrativas e o socket em tempo real (em um frame `ERROR`). Enviado com `Retry-After: 5`. | Tente novamente; o SDK faz isso automaticamente. Verifique se o banco de dados está rodando e acessível a partir do servidor. |
| `DB_CONNECTIONS_EXHAUSTED` | 503 | O servidor de banco de dados recusou uma nova conexão porque não possui mais conexões disponíveis (`53300` excesso de clientes, `53400` limite de conexões de uma role ou banco de dados excedido). Cada instância do servidor compartilha o `max_connections` global; isso ocorre quando várias instâncias usam pools grandes sem um pooler. É uma questão de carga, não uma falha; enviado com `Retry-After: 2`. O servidor registra a solução no log uma vez por minuto. | Tente novamente; o SDK faz isso automaticamente. Reduza `DB_POOL_MAX` (ou limite com `REBASE_DB_POOL_MAX`) nas instâncias, use um pooler à frente do banco (`DATABASE_POOLED`) ou aumente `max_connections`. |
| `DB_CONNECT_TIMEOUT` | 503 | Abrir uma nova conexão com o banco de dados demorou mais que `DB_POOL_CONNECT_TIMEOUT`: o banco de dados está lento para aceitar conexões ou está distante na rede. Enviado com `Retry-After`. | Tente novamente; o SDK faz isso automaticamente. Verifique a carga do banco de dados e a rede até ele. |
| `DB_PERMISSION_DENIED` | 500 | O Postgres recusou a instrução (`42501`): ou uma política de segurança em nível de linha negando esta role, ou a ausência de um `GRANT`. | Veja [Solução de problemas](/docs/troubleshooting/). |
| `DB_POOL_EXHAUSTED` | 503 | Todas as conexões do pool de banco de dados permaneceram ocupadas durante `DB_POOL_CONNECT_TIMEOUT`, portanto esta requisição nunca alcançou o banco. Trata-se de carga, não de falha; enviado com `Retry-After`. O servidor registra a solução no log uma vez por minuto. | Tente novamente; o SDK faz isso automaticamente. Aumente `DB_POOL_MAX` ou localize as consultas lentas e transações longas que estão retendo conexões. |
| `FIELD_NOT_READABLE` | 400 | Um filtro, `orderBy`, `fields`, agregação `select` ou `groupBy` referencia um campo que as roles deste chamador não podem ler (`access.read`), um caminho aninhado ou uma ordenação agregada referencia uma relação que não podem ler — ou uma operação de campo (`$inc`, `$push`, …) tem como alvo um desses campos, onde um limite recusado revelaria o valor armazenado. Um campo que nenhuma resposta pode conter não pode ser interrogado por nenhuma consulta, caso contrário o valor seria legível predicado por predicado. Um filtro por meio de relação (`author.salary`) e uma ordenação agregada sobre o campo de uma relação (`max(staff.salary)`) são avaliados pela regra do destino. `details.violations` informa cada campo. O driver aplica a mesma regra a leituras realizadas internamente no processo em nome do chamador (`context.data` no escopo do chamador) e a buscas vetoriais, includes ou checagens de unicidade. Uma coluna com `.private()` responde como se não existisse: qualquer filtro, `orderBy`, `fields`, `include`, agregação `select` ou `groupBy`, ou `vector_search` que a mencione recebe exatamente a resposta dada a um nome incorreto (`UNKNOWN_FILTER_FIELD`, `UNKNOWN_ORDER_BY_FIELD`, `UNKNOWN_FIELD`, `UNKNOWN_RELATION`, `UNKNOWN_AGGREGATE_FIELD` ou `UNKNOWN_VECTOR_PROPERTY`), e nenhuma resposta de campo desconhecido a lista. | Remova o campo da consulta ou obtenha a role necessária. Veja [Acesso a campos](/docs/collections/field-access/). |
| `FIELD_NOT_WRITABLE` | 400 / 403 | O corpo define um campo que as roles deste chamador não têm permissão para escrever (`access.write`). A operação é recusada em vez de descartar o campo silenciosamente: uma escrita que descarta um campo reportaria sucesso para uma edição que não ocorreu. O mesmo código recusa uma escrita através de um elemento pai que defina uma relação que o chamador não pode escrever, bem como uma atualização que atribua um valor a um campo `softDelete` — somente uma exclusão pode alterá-lo. O socket em tempo real responde 403 com este código para escritas em caminhos aninhados cuja tabela pai, relação ou tabela de destino não seja atendida por ele, evitando passá-la sem validação para o driver. `details.violations` informa cada campo. | Remova o campo ou obtenha a role necessária. Um campo que ninguém pode escrever responde com `VALIDATION_EXCLUDED_FIELDS`. |
| `FILTERED_USER_WRITE` | 400 | Uma atualização ou exclusão com filtro foi enviada para a tabela de autenticação via HTTP, cujas escritas são validadas usuário por usuário antes de serem executadas. | Leia os usuários e execute `updateMany`/`deleteMany` por id. |
| `FILTER_REQUIRED` | 400 | Uma escrita filtrada (atualização ou exclusão via `where`/`logical`, vinda do SDK ou de rotas bulk) não possui nenhuma condição, o que afetaria todas as linhas. A operação é recusada antes de ser executada. | Adicione uma condição. Para alterar intencionalmente todas as linhas, defina uma condição que todas as linhas atendam. |
| `HISTORY_UNAVAILABLE` | 503 | Uma escrita em uma tabela com `history: true` foi recusada porque o registro de histórico não pôde ser gravado: o banco de dados não possui a tabela `rebase.entity_history` ou, para `openRebase` e `rebase console`, a função `rebase.record_history`. Nenhum backend com histórico foi inicializado neste banco de dados. Nada foi executado, incluindo hooks, e as leituras não são afetadas. Lançado por `openRebase` e retornado por um backend criado com `provision: false`. | Inicialize o backend uma vez com o histórico ativado e `provision: true` (`rebase dev` faz isso) e tente novamente. |
| `HISTORY_UNSERVABLE` | 501 | O driver de dados da tabela não suporta a execução de regras de leitura e hooks `afterRead` sobre linhas armazenadas (`DataDriver.serveStoredRows`), e o histórico nunca é servido sem aplicação dessas máscaras. O driver Postgres integrado suporta essa funcionalidade. | Implemente `serveStoredRows` no driver customizado. Veja [Histórico](/docs/backend/history/). |
| `IDEMPOTENCY_KEY_IN_PROGRESS` | 409 | Uma requisição anterior com a mesma `Idempotency-Key` ainda está em execução. | Tente novamente assim que ela terminar. |
| `IDEMPOTENCY_KEY_REUSED` | 422 | A mesma `Idempotency-Key` foi enviada em uma requisição diferente: outro método, caminho, query string ou corpo. | Use uma nova chave ou reenvie a requisição original. |
| `INVALID_AGGREGATE_FUNCTION` | 400 | `?select=` indicou uma função que não é um agregador (`count`, `sum`, `avg`, `min`, `max`, `countDistinct`, `mode`, `percentile`, `distinct`, `fingerprint`). | Utilize uma dessas; a mensagem lista as disponíveis. |
| `INVALID_AGGREGATE_GROUP` | 400 | Uma transformação em `groupBy` é desconhecida ou não se aplica à coluna: `year`/`month`/`day` em uma coluna que não é data, ou `unnest` em uma que não é array. | Use `lower`, `upper`, `year`, `month`, `day` ou `unnest` em uma coluna com o tipo compatível. |
| `INVALID_AGGREGATE_SELECT` | 400 | Uma entrada em `?select=` não segue o formato `fn(field)`; uma função diferente de `count()` ou `fingerprint()` foi chamada sem campo; `percentile` não contém uma fração de 0 a 1; ou `fingerprint()` foi solicitado em uma view comum, que não armazena linhas. | Escreva `sum(total)`, `count()`, `percentile(price,0.95)`. |
| `INVALID_AGGREGATE_WINDOW` | 400 | Uso de `offset`, `page` ou `orderBy` em uma agregação sem `groupBy`, ou cursor em qualquer agregação. Uma agregação sem agrupamento retorna uma única linha, e um grupo não é uma linha sobre a qual um cursor possa continuar. | Adicione `groupBy` ou remova esses parâmetros; pagine grupos com `offset` ou `page`. Veja [Agregações](/docs/sdk/aggregates-and-search/#aggregates). |
| `INVALID_BATCH_BODY` | 400 | Uma operação em `/_batch` não possui `op`, `table`, `values` ou `id`, referencia uma tabela que este backend não atende ou reutiliza um nome de `ref`. | Veja a mensagem; ela indica a operação pelo índice. |
| `INVALID_BATCH_REF` | 400 | Um `{ "$ref": "<name>.<field>" }` não corresponde a nenhuma operação anterior, aponta para frente ou solicita um campo inexistente na linha referenciada. Apenas referências para trás são resolvidas. | Atribua um nome à operação com `ref` *antes* de referenciá-la. |
| `INVALID_BULK_BODY` | 400 | O corpo da operação em massa não está no formato esperado. | Envie o array esperado pela rota: `{ "rows": [...] }` para `POST /bulk`, `{ "updates": [{ "id", "data" }] }` para `PATCH /bulk`, `{ "ids": [...] }` para `POST /bulk/delete`. |
| `INVALID_CONFLICT_RULE` | 400 | A regra de conflito de um upsert (manter duplicatas ou substituir apenas com base em um `where`) foi enviada sem `upsert: true`, ou ambas as regras foram enviadas juntas. | Envie `upsert: true` e apenas uma das duas regras. |
| `INVALID_CONFLICT_TARGET` | 400 | O `on_conflict` / `onConflict` de um upsert referencia colunas sem garantia de unicidade, é enviado sem `upsert: true`, ou é enviado em uma criação aninhada (onde uma linha correspondente seria movida para o novo pai). Caso contrário, o Postgres retornaria 42P10 de dentro de uma transação que já realizou operações. Aplica-se também a qualquer upsert na tabela de autenticação, onde criação e atualização seguem regras distintas. | Declare `.unique()` na coluna ou um índice `unique`; a mensagem lista os destinos existentes. Na tabela de usuários, envie `POST` para criar e `PATCH` para atualizar. |
| `INVALID_COUNT` | 400 | `?count=` não é `exact` nem `none`. Recusado em vez de assumir o padrão: um erro de digitação como `?count=nnone` cobraria o custo computacional da contagem que pretendia ignorar. | Envie `exact` (o padrão) ou `none`. Veja [Ignorando a contagem](/docs/backend/api/#skipping-the-count). |
| `INVALID_CURSOR` | 400 | O cursor `after` não pôde ser lido ou contém um id de linha incompatível com as colunas chave da tabela: foi truncado, recodificado ou montado manualmente. Um cursor legível enviado com um `orderBy` diferente daquele sob o qual foi emitido resulta em `CURSOR_ORDER_MISMATCH`, também um 400. | Reenvie o `meta.nextCursor` da página anterior sem alterações, com o mesmo `orderBy` ou nenhum. Veja [Paginação](/docs/sdk/pagination/). |
| `INVALID_DELETED_PARAM` | 400 | `?deleted=` não é `include` nem `only`. Recusado em vez de ignorado: um erro de digitação como `?deleted=true` que ocultasse silenciosamente as linhas excluídas pareceria funcionar e responderia ao oposto do pretendido. | Envie `include` (ativas e excluídas) ou `only` (apenas excluídas). Omita para obter apenas linhas ativas. |
| `INVALID_DISTINCT` | 400 | `?distinct=` não é `true` nem `false`. | Envie um desses valores; `1` e `0` também são aceitos. |
| `INVALID_FIELD_OPERATION` | 400 | Um operador `$inc` / `$push` / `$pull` / `$merge` foi usado em um tipo de coluna no qual não está definido, com um operando no formato incorreto, com dois operadores no mesmo campo, com erro de digitação ou em uma criação — onde não há valor armazenado para a operação. | Veja [Escrita via REST](/docs/backend/writes/#field-operations); a mensagem indica o campo. |
| `INVALID_FILTERED_WRITE` | 400 | Uma escrita filtrada foi direcionada a um caminho através de uma relação (`posts/1/comments`) ou a nenhuma tabela. | Escreva diretamente na tabela relacionada com um filtro no seu vínculo. |
| `INVALID_FILTER_FIELD` | 400 | O filtro menciona uma coluna inexistente nesta tabela. | Verifique a grafia em comparação com a tabela. |
| `INVALID_FILTER_OPERATOR` | 400 | O operador não é suportado por este tipo de coluna — por exemplo, `like` em um número ou data. | Veja [Consultando dados](/docs/sdk/querying/). |
| `INVALID_FILTER_VALUE` | 400 | O valor do filtro não pôde ser interpretado como o tipo da coluna com a qual foi comparado: `?id=eq.abc` em uma chave inteira, um rótulo fora do enum, um timestamp inválido ou um número fora do intervalo do tipo. `details.dbCode` traz o SQLSTATE. | Envie um valor compatível com o tipo da coluna. |
| `INVALID_HARD_PARAM` | 400 | `?hard=` não é `true` nem `false`. Qualquer outro valor é recusado em vez de interpretado como "não" — um erro de digitação que execute soft delete quando o chamador pretendia expurgar os dados o levaria a acreditar que foram removidos definitivamente. | Envie `true` ou `false`. |
| `INVALID_INCLUDE` | 400 | `?include=` está malformado: não é uma lista válida de caminhos ou é um objeto de opções por relação no formato incorreto. Um caminho aninhado além de três saltos resulta em `INCLUDE_TOO_DEEP`, também um 400. Rejeitado na borda da aplicação para evitar escapar do driver como 500. | Veja a mensagem; ela indica o caminho problemático. |
| `INVALID_INPUT` | 400 | O corpo da requisição falhou na validação. | Veja a mensagem. |
| `INVALID_LIMIT` | 400 | `?limit=` não é um número inteiro de 1 até o máximo (1000 por padrão); valores maiores são recusados, não limitados automaticamente. Uma assinatura em tempo real solicitando um limite fora desse intervalo recebe o mesmo código em um frame `ERROR` do WebSocket. | Reduza o limite e pagine os registros restantes. |
| `INVALID_LOGICAL_GROUP` | 400 | Um grupo `?or=` / `?and=` / `?not=` está malformado ou aninhado além da profundidade permitida. | Veja a mensagem; ela demonstra a regra de achatamento (flattening). |
| `INVALID_OFFSET` | 400 | `?offset=` não é um número inteiro maior ou igual a 0. | Envie um número inteiro não negativo. |
| `INVALID_ORDER_BY` | 400 | `?orderBy=` não é `field`, `field:desc`, `field:desc:last` ou um array JSON de `{ field, direction, nulls }` — ou especifica uma direção diferente de `asc`/`desc`, ou posicionamento de NULL diferente de `first`/`last`. | Veja a mensagem; ela demonstra todas as formas aceitas. |
| `INVALID_PAGE` | 400 | `?page=` não é um número inteiro maior ou igual a 1. As páginas são indexadas a partir de 1, logo `?page=0` é considerado um erro e não a primeira página. | Envie `1` ou superior, ou utilize `?offset=`. |
| `INVALID_PARAM` | 400 | Um parâmetro de consulta está malformado. | Veja a mensagem. |
| `INVALID_QUERY_BODY` | 400 | O corpo de um `POST …/query` contém um valor que a URL não comportaria: uma lista para um parâmetro que a URL lê uma única vez (`fields`, `limit`, …), um objeto para um filtro, ou qualquer parâmetro presente simultaneamente na URL — um `POST …/query` lê todos os parâmetros a partir do corpo. | Escreva cada valor exatamente como na URL — uma string, ou uma lista para um filtro repetido; `where`, `include`, `orderBy` e `vector` aceitam JSON. Veja [Consultas longas demais para uma URL](/docs/backend/vector-search/#queries-too-long-for-a-url). |
| `INVALID_VECTOR` | 400 | `?vector=` não é um array JSON de números. | Envie `[0.1,0.2,0.3]`. |
| `INVALID_VECTOR_DISTANCE` | 400 | `?vector_distance=` não é `cosine`, `l2` nem `inner_product`. | Use uma dessas três opções. |
| `INVALID_VECTOR_THRESHOLD` | 400 | `?vector_threshold=` não é um número. | Envie um número. |
| `INVALID_WHERE` | 400 | `?where=` não é um objeto JSON mapeando campos a condições. | Envie `{"status":["==","active"]}`. |
| `KEY_IMMUTABLE` | 400 | Uma atualização atribui à chave da linha um valor diferente daquele pelo qual ela é endereçada — no corpo da requisição ou por meio de um `beforeSave`. Uma linha não pode ser movida para outra chave: tudo após a escrita (a releitura, `afterSave`, histórico, tempo real) a referencia pela chave original. Recusado antes da execução de qualquer hook, sem nada gravado, em todas as portas de entrada. `details.violations` informa o campo. | Crie a linha sob a nova chave e exclua a atual. Enviar a chave que a linha já possui é permitido. |
| `MISSING_AGGREGATE_SELECT` | 400 | A rota de agregação foi chamada sem o parâmetro `?select=`. | Adicione o parâmetro, por exemplo: `?select=count()`. |
| `NOT_A_MATERIALIZED_VIEW` | 400 | `refresh()` foi chamado em uma tabela que não corresponde a uma view materializada. | Execute refresh apenas em views definidas com `defineView(…, { materialized: true })`. |
| `NO_TABLES` | 404 | O projeto não disponibiliza tabelas: nenhuma declarada em `backend/schema` e nenhuma presente no banco de dados para introspecção. Quando existem tabelas, mas a segurança em nível de linha está desativada nelas, a mensagem as lista com o SQL necessário para ativá-la, e `details.unprotectedTables` as enumera. Anteriormente era `NO_COLLECTIONS`. | Crie tabelas — via migration, SQL ou um arquivo `defineTable` seguido de `rebase db push` — e reinicie. |
| `NOT_FOUND` | 404 | Nenhuma linha com esse id nessa tabela — ou a linha está oculta para este chamador pelas regras de RLS. | Verifique o id e, em seguida, as regras de `rls` da tabela. |
| `UNKNOWN_RELATION` | 400 / 404 | `?include=` indica algo que não é uma relação na tabela. O mesmo código resulta em **404** quando um *caminho de URL* aninhado referencia uma relação inexistente, por exemplo, `/api/data/authors/1/posts` onde `authors` não declara nenhuma — nesse caso a URL não aponta para nada, configurando um recurso não encontrado em vez de requisição malformada. | Verifique o nome da relação — a mensagem lista as relações existentes na tabela. Uma referência reversa precisa ser declarada no pai para ser percorrível. |
| `ORDER_BY_FIELD_NOT_SORTABLE` | 400 | A ordenação referencia um campo que não permite ordenação. | Ordene por uma coluna válida. |
| `PAGE_WITH_OFFSET` | 400 | `?page=` foi combinado com `?offset=` — ou `page` com `offset` em um `find()`, o que o SDK cliente, o `rebase.data` em processo e o cliente offline recusam com o mesmo código antes do envio da requisição. Ambos descrevem a mesma janela, e anteriormente `page` prevalecia silenciosamente sobre um `offset` que o chamador nunca via ser aplicado. | Envie apenas um deles. |
| `PAYLOAD_TOO_LARGE` | 413 | O corpo excede o limite configurado. | Envie menos dados ou aumente o limite. |
| `READ_ONLY_TRANSACTION` | 409 | Um hook `afterRead` tentou realizar uma escrita. Uma leitura com escopo de requisição roda em uma transação `READ ONLY`, portanto nem o hook nem nada chamado por ele pode realizar escritas. | Mova a escrita para fora da leitura: um job em background ou `rebase.dataAsAdmin` a partir de um cron job ou função customizada. |
| `REFRESH_NOT_SUPPORTED` | 501 | `POST /api/data/<slug>/refresh` atingiu um driver de dados sem suporte a views materializadas. | Nada a atualizar neste backend. |
| `RELATION_HAS_NO_PIVOT` | 400 | A escrita continha dados de vinculação (link payload), mas o caminho não alcança seu destino através de um `manyToMany` que declare um `pivot` — não havendo linha de junção para armazená-los. | Declare colunas de `pivot` na relação ou remova os dados da escrita. Veja [Relações](/docs/collections/relations/). |
| `RELATION_MISCONFIGURED` | 500 | Uma relação não resolve contra o esquema registrado. A operação é recusada em vez de ignorada: descartá-la reportaria sucesso para uma escrita que não aconteceu, ou indicaria ausência de linhas que existem. | Execute `rebase schema generate` se o esquema gerado for mais antigo que o banco de dados. |
| `RELATION_NOT_UNLINKABLE` | 400 | A relação não pode ser desvinculada a partir deste lado. | Execute a escrita a partir do lado proprietário (owning side). |
| `RELATION_NOT_WRITABLE` | 400 | O caminho aninhado não é uma relação que aceita escrita, ou uma criação/atualização referencia uma relação `via` de múltiplos saltos — somente relações `via` de salto único aceitam escrita. `details.fields` lista as chaves `via`. Nada foi gravado. | Escreva diretamente nas linhas que a cadeia une. Veja [Relações](/docs/collections/relations/#via--an-explicit-join-chain). |
| `RELATION_PIVOT_UNSUPPORTED` | 400 | A relação declara colunas de junção, mas esta fonte de dados não suporta a gravação nelas. | O vínculo em si continua funcionando; apenas os dados adicionais sobre ele não são gravados. Verifique as capacidades do driver. |
| `RELATION_SOURCE_KEY_EMPTY` | 400 | Uma escrita em relação não possuía chave de origem para fixar o vínculo. | Salve a linha pai primeiro. |
| `RESULT_TOO_LARGE` | — | Uma instrução enviada pelo comando `EXECUTE_SQL` do socket em tempo real — `admin.executeSql` a partir de um cliente, leituras de catálogo do painel admin — retornou mais de 128 MB em linhas, portanto nada foi retornado. Entregue como um frame `ERROR` via WebSocket. As execuções no próprio console SQL não são recusadas: elas exibem as primeiras linhas. | Adicione um `LIMIT` ou selecione menos colunas, lendo o resultado em partes. |
| `ROW_IN_TRASH` | 409 | A chave de um upsert pertence a uma linha na lixeira (uma linha excluída via soft delete continua retendo sua chave). Um upsert não sobrescreve uma linha excluída, em nenhuma porta de entrada: REST `?on_conflict=`, upserts via `/bulk` e `/_batch`, SDK e socket em tempo real. Nada foi gravado. | Restaure a linha primeiro (uma atualização definindo o campo de soft delete como `null`) ou expurgue-a com `?hard=true` e execute o upsert novamente. Veja [Soft delete](/docs/collections/soft-delete/). |
| `SCHEMA_DRIFT` | 500 | Uma tabela ou coluna esperada pelo código não existe no banco de dados. | Execute `rebase db push` em desenvolvimento; faça novo deploy em um ambiente gerenciado. |
| `SCORE_CURSOR_UNSUPPORTED` | 400 | `startAfter` foi combinado com `orderBy: "_score"`. A relevância é calculada por consulta e não fica armazenada, portanto não pode servir de chave para um cursor. | Pagine a relevância com `limit`/`offset` ou ordene por uma coluna. |
| `SQL_ERROR` | 400 | O banco de dados recusou o SQL escrito por um usuário. No `EXECUTE_SQL` do socket em tempo real, trata-se de um frame `ERROR` contendo a mensagem do banco. `POST /api/admin/sql/csv` retorna esse erro antes do envio do arquivo: erro de sintaxe, tentativa de escrita (o download roda como read-only), mais de uma instrução ou uma role que a conexão não pode assumir. | Corrija o SQL. Um download aceita um único `SELECT`, `WITH … SELECT`, `TABLE` ou `VALUES`. |
| `VIEW_NOT_READABLE` | 403 | Um chamador que não possui nenhuma das roles em `view.roles` de uma view materializada tentou lê-la ou solicitou sua atualização. Uma view materializada não possui RLS, sendo servida integralmente e apenas para essas roles. | Leia com uma das roles permitidas ou declare a role do chamador em `view.roles`. |
| `TENANT_IMMUTABLE` | 400 | Uma escrita moveria uma linha de um tenant para outro. Uma linha não pode mudar de tenant. `details.violations` indica o campo. Uma trigger impõe a mesma regra no banco de dados; portanto, SQL executado como o chamador falha com erro Postgres `42501` e mensagem iniciando com `TENANT_IMMUTABLE`. | Crie a linha no outro tenant e exclua a atual, ou escreva com uma role presente em `tenant.bypassRoles`. |
| `TENANT_MISMATCH` | 400 | A escrita informa um tenant ao qual este chamador não pertence; o banco de dados também a recusaria. | Escreva em um tenant ao qual o chamador pertença ou autentique-se como um membro dele. |
| `TENANT_REQUIRED` | 400 | A tabela possui escopo de tenant e o tenant não pôde ser inferido: a requisição não contém nenhum ou o chamador pertence a múltiplos tenants. | Envie o campo do tenant explicitamente ou autentique-se como um chamador que pertença a exatamente um. |
| `TRANSACTION_ABORTED` | 500 | Uma instrução na transação da escrita falhou e um hook capturou o erro. O Postgres já havia abortado a transação; logo, a escrita foi revertida e nada foi persistido. Apenas criações, atualizações ou exclusões via `context.data` recusadas pelo banco são desfeitas individualmente e seguras de capturar. | Deixe a falha lançar o erro ou valide antes de executar a instrução. Veja [Semântica de Transações](/docs/collections/context-data-api/#transaction-semantics). |
| `UNKNOWN_FIELD` | 400 | `?fields=` indica um campo que a tabela não possui. | Verifique a grafia; a mensagem lista os campos válidos. |
| `UNKNOWN_AGGREGATE_FIELD` | 400 | Uma agregação ou `groupBy` indica um campo que a tabela não possui. | Verifique a grafia; a mensagem lista os campos válidos. |
| `UNKNOWN_FILTER_FIELD` | 400 | O filtro indica um campo que esta tabela — ou o destino de uma relação — não possui, ou uma coluna com `.private()`. | Verifique a grafia; a mensagem lista os campos válidos. |
| `UNKNOWN_FILTER_OPERATOR` | 400 | O filtro especifica um operador inexistente. | A mensagem lista todos os operadores disponíveis. |
| `UNKNOWN_MESSAGE_TYPE` | 400 | Um frame do socket em tempo real contém um `type` que o servidor não processa. Retornado como um frame `ERROR` contendo o `requestId` da requisição para que ela seja finalizada em vez de expirar por timeout. | Verifique o `type` do frame; a mensagem indica o nome recebido. |
| `UNKNOWN_ORDER_BY_FIELD` | 400 | A ordenação especifica um campo inexistente na tabela. | Verifique a grafia; a mensagem lista os campos válidos. |
| `PRECONDITION_FAILED` | 412 | Um cabeçalho `If-Match` informou uma versão da linha que não é mais a atual: alguém a modificou entre a leitura e esta escrita. Nada foi gravado. | Releia a linha, reaplique a alteração e envie o novo `ETag`. |
| `UNKNOWN_RESPONSE_FIELD` | 400 | `?fields=` solicita um campo inexistente na tabela. | Verifique a grafia; a mensagem lista os campos conhecidos. |
| `UNKNOWN_VECTOR_PROPERTY` | 400 | Uma busca vetorial indicou uma coluna que não é um `col.vector()` nesta tabela. | A mensagem lista as colunas vetoriais da tabela. |
| `UNSUPPORTED_MEDIA_TYPE` | 415 | O `Content-Type` não é aceito por esta rota. | Envie o tipo documentado para a rota. |
| `UNSUPPORTED_OPTION` | — | Lançado como erro interno, não retornado como resposta: uma escrita por meio do acessador em processo (`context.data` em um hook, `rebase.data` em uma função ou cron) recebeu `ifMatch` ou `idempotencyKey`. Esse ponto de acesso não possui checagem de pré-condição ou armazenamento de idempotência; portanto, a opção é recusada antes de qualquer gravação, em vez de ser ignorada. | Remova a opção nesse ponto ou realize a escrita pelo cliente HTTP, que suporta ambas. |
| `UNSUPPORTED_RELATION_FILTER` | 400 | O filtro atravessa uma relação `via`, cujo caminho de junção é definido em apenas um sentido, não havendo como correlacionar uma subconsulta reversa. | Filtre a partir do lado proprietário. |
| `UNSUPPORTED_RELATION_FILTER_OPERATOR` | 400 | O operador não está definido para esse campo: uma relação sem coluna física nesta linha é filtrada por pertinência, e correspondência de padrões (`like`, `ilike` e suas negações) aplica-se somente a texto. | Veja a mensagem; ela lista o que o campo aceita. |
| `VALIDATION_CONSTRAINT` | 400 | Um valor violou uma regra declarada na coluna (`.validate()`, `.notNull()`, `.oneOf()`) — tamanho, intervalo, padrão, campo obrigatório, valor fora da lista. Cada entrada de `details.violations` traz um `code`: `required`, `min_length`, `max_length`, `length`, `min`, `max`, `less_than`, `more_than`, `positive`, `negative`, `integer`, `pattern`, `email`, `url`, `enum`, `min_items`, `max_items`, `unique_items` (um array contém o mesmo item duas vezes, incluindo via `$push`), `unique_by` (dois itens de um array JSON compartilham o mesmo valor no campo indicado por `uniqueBy`), `date_min`, `date_max`, `geopoint_range`. | Veja a mensagem; ela indica a tabela, a coluna e cada violação. |
| `VALIDATION_EXCLUDED_FIELDS` | 400 | O corpo tenta gravar em uma coluna marcada com `.private()` ou `.access({ write: [] })` — a mesma regra sob duas formas de escrita. O preenchimento dessas colunas cabe exclusivamente ao servidor: hash de senha, token de verificação. Diferente de `FIELD_NOT_WRITABLE`, essa resposta é idêntica para qualquer chamador, incluindo `admin`. | Remova o campo. Veja [Acesso a campos](/docs/collections/field-access/). |
| `VALIDATION_INVALID_VALUE` | 400 | Um valor não é compatível com o tipo da coluna. | Veja a mensagem; ela indica a coluna. |
| `VALIDATION_UNKNOWN_FIELDS` | 400 | O corpo referencia um campo inexistente na tabela — incluindo um argumento `id` em uma tabela cuja chave primária seja outro campo. | Verifique a grafia; a mensagem ("Table 'x' has no column 'f'. Known columns: …") lista as colunas existentes. |
| `VECTOR_CURSOR_UNSUPPORTED` | 400 | Um cursor (`after` / `startAfter`) foi combinado com busca vetorial. As linhas são ordenadas por uma distância calculada a cada consulta, a qual não pode servir de chave de cursor; portanto, listagens vetoriais não retornam `nextCursor`. | Pagine os resultados mais próximos usando `limit`/`offset`. |
| `WRITE_DENIED` | 403 | Uma regra de segurança ou política de RLS recusou a escrita. | Verifique a configuração de `rls` da tabela. |

## `PG_<SQLSTATE>` — uma constraint recusada pelo banco de dados

Uma escrita rejeitada pelo Postgres por um motivo relacionado aos *dados enviados pelo chamador*
responde com o SQLSTATE embutido no código: `PG_23505`, `PG_23503`, e assim por diante. Trata-se de
uma família de erros, não de uma lista fixa — o Postgres define centenas de SQLSTATEs —, mas apenas duas
classes chegam a esse formato, pois somente essas decorrem de erro do chamador:

- **classe 23**, violação de constraint de integridade: duplicata, chave estrangeira
  apontando para registro inexistente, coluna NOT NULL deixada em branco;
- **classe 22**, exceção de dados: um valor incompatível com o tipo suportado pela coluna.

Todas as outras falhas — conexão perdida, coluna inexistente, erro de privilégios —
são de responsabilidade do servidor e permanecem como `500`. Portanto, `code.startsWith("PG_")` é uma validação
segura para identificar "o registro enviado continha dados incorretos", sendo as quatro abaixo aquelas com as quais
o cliente efetivamente se depara. `details.dbCode` traz o mesmo SQLSTATE para todas elas, e
a mensagem identifica a constraint.

| Código | Status | Significado | O que fazer |
| --- | --- | --- | --- |
| `PG_22P02` | 400 | Um valor não pôde ser interpretado como o tipo da coluna — o equivalente na escrita para `INVALID_FILTER_VALUE`. | Envie um valor compatível com o tipo da coluna. |
| `PG_23502` | 400 | Uma coluna `NOT NULL` foi deixada em branco. | Envie o campo ou defina um valor padrão para a coluna. |
| `PG_23503` | 400 / 409 | Na inserção/atualização, uma chave estrangeira aponta para uma linha inexistente (400). Na exclusão, outras linhas ainda referenciam esta (409; uma chave com `RESTRICT` gera `PG_23001`, também 409). | Crie a linha de destino primeiro ou corrija o id; para exclusão, remova ou reaponte as linhas dependentes antes. |
| `PG_23505` | 409 | Uma constraint de unicidade (unique constraint) foi violada. A mensagem informa o nome da constraint. | Use um valor diferente ou atualize a linha existente. |

## Armazenamento

| Código | Status | Significado | O que fazer |
| --- | --- | --- | --- |
| `INVALID_LIST_OPTIONS` | 400 | O parâmetro `maxResults` de uma listagem de armazenamento não é um número inteiro de no mínimo 1, ou seu `pageToken` não foi emitido pela fonte. Um tamanho de página inferior a 1 costumava retornar uma página vazia com o mesmo token, fazendo com que um loop `while (pageToken)` nunca terminasse. | Envie um `maxResults` positivo e repasse o `nextPageToken` sem alterações. |
| `INVALID_STORAGE_BUCKET` | 400 | O nome do bucket está malformado. | Verifique o nome. |
| `INVALID_STORAGE_KEY` | 400 | A chave do objeto está malformada, escapa de seu prefixo ou está sob um prefixo reservado (`_rebase/renditions/`, `_rebase/maintenance/`). | Verifique a chave. |
| `INVALID_TRANSFORM_OPTIONS` | 400 | Os parâmetros de transformação de imagem estão fora do intervalo ou são contraditórios. | Veja [Armazenamento](/docs/backend/storage/). |
| `STORAGE_FILE_TOO_LARGE` | 413 | O upload excede o `maxBytes` declarado na coluna de destino `col.storage()`. Validado no servidor, não apenas no navegador. `details` contém a coluna, o limite e o tamanho real. | Faça upload de um arquivo menor ou aumente `maxBytes` na coluna. |
| `STORAGE_FILE_TYPE_REFUSED` | 400 | O tipo do arquivo enviado não está na lista `accept` da coluna, ou não está no `allowedMimeTypes` da própria fonte de armazenamento. `details` contém a coluna (ou a lista da fonte), a lista aceita e o tipo de conteúdo enviado. | Envie um tipo aceito ou amplie `accept` / `allowedMimeTypes`. |
| `STORAGE_MISCONFIGURED` | 502 | O bucket S3 ou GCS configurado para esta fonte não existe, ou o provedor recusou as credenciais desta implantação para ele. A mensagem informa o nome do bucket; `details.reason` é `NoSuchBucket` ou o erro de recusa do provedor. A ausência de um bucket costumava ser interpretada como "arquivo não encontrado" para todos os arquivos. | Corrija o nome do bucket (`S3_BUCKET` / `GCS_BUCKET`, `__<KEY>` para fontes nomeadas) ou as permissões das credenciais. |
| `STORAGE_NOT_CONFIGURED` | 501 / 503 | Nenhum backend de armazenamento está configurado neste servidor, ou nenhum é o padrão e a requisição não indica uma fonte de armazenamento; a mensagem lista as fontes disponíveis (501). Um upload retomável cuja fonte deixou de existir antes do término resulta em 503. | Configure S3, GCS ou armazenamento local, ou informe uma fonte com `?storageId=`. |
| `STORAGE_SAME_LOCATION` | 400 | `POST /api/admin/storage/move` com `deleteSource` (`rebase storage move --delete-source`) entre duas fontes configuradas no mesmo bucket ou diretório. Todo arquivo seria considerado já presente no destino por ser o mesmo arquivo, e excluir a cópia da origem apagaria a única existente. Nada foi movido ou excluído. | Aponte a coluna para a outra fonte; seus arquivos já estão lá. |
| `STORAGE_SCAN_INCOMPLETE` | 409 | `DELETE /api/admin/storage/orphans` (`rebase storage orphans --delete`) não pôde ler todas as tabelas, de modo que um arquivo referenciado por uma delas pareceria não utilizado. Com `?scan=`, a varredura indicada foi a que não conseguiu ler todas as tabelas. Nada foi excluído; `details.unscanned` indica cada tabela e a razão pela qual não pôde ser lida. | Corrija o problema que impede a leitura dessas tabelas e execute novamente. |
| `STORAGE_SCAN_NOT_FOUND` | 404 | `GET /api/admin/storage/orphans/scans/:id` ou `DELETE /api/admin/storage/orphans?scan=:id` indica uma varredura que a fonte não contém. As varreduras são mantidas por 7 dias na fonte examinada; portanto, um `storageId` diferente daquele da varredura também não encontrará nada. | Envie o `storageId` da varredura ou inicie uma nova varredura. |
| `STORAGE_SCAN_NOT_COMPLETE` | 409 | `DELETE /api/admin/storage/orphans?scan=:id` indica uma varredura que ainda está com status `queued` ou `running`, ou que falhou (`failed`). Nada foi excluído; `details.status` informa o estado atual. | Aguarde a conclusão da varredura ou inicie outra. |
| `STORAGE_SCAN_EXPIRED` | 409 | `DELETE /api/admin/storage/orphans?scan=:id` indica uma varredura concluída há mais de 15 minutos. Nada foi excluído. | Inicie uma nova varredura e execute a exclusão a partir dela. |
| `STORAGE_SCAN_DELETION_STARTED` | 409 | `DELETE /api/admin/storage/orphans?scan=:id` indica uma varredura cujos arquivos órfãos já estão sendo excluídos. | Consulte o status de `deletion` da varredura com `GET /api/admin/storage/orphans/scans/:id`. |
| `STORAGE_SOURCE_NOT_CONFIGURED` | 501 | A fonte de armazenamento está declarada, mas não possui credenciais configuradas neste ambiente. | Defina as variáveis de ambiente dessa fonte. |
| `STORAGE_WRITE_FAILED` | 502 | O backend de armazenamento recusou ou interrompeu a escrita. | Verifique seus próprios logs e credenciais. |
| `TRANSFORM_OVERLOADED` | 503 | Há muitas transformações de imagem em andamento simultaneamente. | Tente novamente; considere utilizar uma CDN à frente do serviço. |
| `UNKNOWN_STORAGE_SOURCE` | 400 / 404 | A requisição informou uma fonte de armazenamento (`?storageId=`) que este projeto não declara. Um `bucket` não atendido por esta implantação retorna o mesmo código com status **404** (em listagem, upload, pasta ou upload retomável no S3 ou GCS) — o armazenamento é o recurso ausente, e `details` lista os buckets e fontes existentes. Ambos costumavam retornar "arquivo não encontrado", idêntico a uma chave simplesmente inexistente. | Declare a fonte em `config/resources.ts` ou consulte `GET /api/storage/sources`. |
| `UPLOAD_LOCKED` | 423 | O `PATCH` de um upload retomável chegou enquanto outro fragmento (chunk) do mesmo upload ainda estava sendo recebido — quase sempre decorrente de um cliente reenviando o fragmento em andamento. A operação é recusada em vez de enfileirada, seguindo o comportamento do tusd. | Solicite o offset atual com `HEAD /api/storage/tus/:id` e retome a partir dali; o tus-js-client aplica backoff e tenta novamente de forma automática. Veja [Uploads retomáveis (TUS)](/docs/backend/storage-resumable-uploads/). |

## Funções customizadas

| Código | Status | Significado | O que fazer |
| --- | --- | --- | --- |
| `FUNCTION_NOT_FOUND` | 404 | Nenhuma função com esse nome está disponível — ou ela existe, mas suas próprias rotas não cobrem o caminho posterior. Um chamador autenticado também é informado sobre quais funções *estão* disponíveis; um chamador anônimo não recebe essa informação, pois essa lista é um inventário de todos os endpoints customizados. Quando um arquivo com esse nome falha ao carregar, a mensagem avisa ao chamador autenticado indicando o nome do arquivo: essa é a diferença entre um erro de digitação e um deploy quebrado. Um chamador anônimo recebe a resposta padrão de nome desconhecido, idêntica à de um nome inexistente. | Verifique o nome consultando `GET /api/functions` ou o log de inicialização para identificar arquivos que não carregaram. |
| `FUNCTION_TIMEOUT` | 504 | O handler excedeu seu tempo limite (timeout). Ele continua em execução; não é possível cancelá-lo a partir daqui. | Forneça um `AbortSignal` às chamadas externas ou aumente `REBASE_FUNCTIONS_TIMEOUT_MS`. |
| `FUNCTIONS_UPSTREAM_UNREACHABLE` | 502 | Este processo atua como proxy de funções para outro processo, que não respondeu. | Verifique se a unidade responsável pelas funções está em execução. |

## Notificações push

| Código | Status | Significado | O que fazer |
| --- | --- | --- | --- |
| `PUSH_ENDPOINT_REFUSED` | 400 | O endpoint da assinatura não pertence a um serviço push utilizado por navegadores (FCM, Mozilla, Apple, Windows) sobre `https`. O servidor faz postagens para esse endereço a cada envio, portanto não aceita nenhum outro. | Envie `PushSubscription.toJSON()` exatamente como gerado pelo navegador, ou adicione um serviço de teste em `push.allowedHosts`. Veja [Notificações push](/docs/backend/push-notifications/#routes). |
| `PUSH_NEEDS_A_USER` | 403 | Uma chave de API ou a chave de serviço chamou uma rota de push. Uma assinatura pertence ao navegador de uma pessoa autenticada. | Faça a chamada utilizando a sessão dessa pessoa. |
| `PUSH_NOT_CONFIGURED` | 503 | O serviço de push está ativado, mas não pode enviar notificações: chaves VAPID ausentes em produção ou sua tabela não pôde ser preparada. A mensagem informa o motivo. | Configure `REBASE_VAPID_PUBLIC_KEY`, `REBASE_VAPID_PRIVATE_KEY` e `REBASE_VAPID_SUBJECT`. Veja [Notificações push](/docs/backend/push-notifications/#keys). |

## Cron jobs

| Código | Status | Significado | O que fazer |
| --- | --- | --- | --- |
| `CRON_JOB_ALREADY_EXECUTING` | 409 | Disparo manual de um cron job que já está em execução — no processo que respondeu ou em outro retendo o lease de execução do job, como o worker associado a um processo `api`. Nada foi executado. A desistência é registrada no histórico do job, e `details.log` traz essa entrada; a linha indica o processo que está executando o job. | Tente novamente quando essa execução terminar. Veja [Cron Jobs](/docs/backend/cron-across-instances/#concurrency-guarding). |

## Superfícies administrativas e edição de esquema

Estes códigos indicam que um recurso está desativado ou não configurado, e não que a
requisição estava incorreta. Cada um também é reportado na respectiva rota `/status` com código `200`,
permitindo que um painel desabilite visualmente o recurso em vez de exibir um erro.

| Código | Status | Significado | O que fazer |
| --- | --- | --- | --- |
| `ADMIN_SURFACE_UNAVAILABLE` | 501 | Uma interface exclusiva para administradores foi chamada em um servidor sem autenticação configurada; logo, não há como distinguir um admin de um usuário anônimo. | Defina `auth.jwtSecret` ou informe um `AuthAdapter`. |
| `BRANCH_DIFF_STALE` | 409 | `POST /api/admin/branches/:name/merge` recebeu o fingerprint de um diff que não é mais válido: a branch ou seu pai sofreram alterações nesse intervalo. Nada foi gravado. | Obtenha o diff novamente, revise-o e execute o merge com o novo `fingerprint`. |
| `BRANCH_DIFF_UNSUPPORTED` | 501 | A fonte de dados não suporta comparação de branches: não possui suporte a SQL ou não possui suporte a branches (sem conexão administrativa). | Use um backend Postgres com `adminConnectionString` definido. |
| `BRANCH_MERGE_BLOCKED` | 409 | Uma tabela divergente não pode sofrer merge — adicionada ou removida pela branch, colunas ou chave primária diferentes, ausência de chave primária, quantidade excessiva de linhas para correspondência ou reescrita desde a criação da branch (`TABLE_REWRITTEN`). Uma tabela cujas linhas não puderam ser comparadas bloqueia o merge mesmo que sua contagem indique 0: o número é desconhecido, não zero. `details.tables` lista cada tabela com o respectivo motivo. Nada foi gravado. | Aplique o esquema com suas migrations primeiro, ou execute o merge com `skipBlocked: true` para ignorar essas tabelas. |
| `BRANCH_MERGE_CONFLICT` | 409 | Linhas foram modificadas tanto na branch quanto no pai, e `onConflict` estava configurado como `"abort"` (o padrão); ou o pai recusou parte do merge — uma linha mudou no intervalo, uma trigger a ignorou, uma política a ocultou. Nada foi gravado. | Escolha qual lado prevalece usando `onConflict: "branch"` ou `"target"`, ou obtenha o diff novamente. |
| `BRANCH_MERGE_FAILED` | 409 | O pai recusou as linhas da branch dentro da instrução de merge — uma constraint, rótulo de enum ou chave estrangeira existente que as linhas da branch violam, geralmente porque os dois esquemas diferem. `details` traz `sqlState`, `table`, `constraint` e `detail`. Nada foi gravado. | Analise as alterações de esquema no diff, alinhe o esquema do pai com suas migrations ou corrija as linhas da branch e repita o merge. |
| `BRANCH_NOT_FOUND` | 404 | Nenhuma branch com esse nome foi encontrada no registro. | O comando `rebase db branch list` ou o painel de Branches lista as existentes. |
| `CONTRACT_UNAVAILABLE` | 404 | O contrato do projeto é servido apenas quando a autenticação está configurada — ele descreve todas as tabelas e relações. | Configure a autenticação. A rota `/meta/schema-version` é sempre servida. |
| `DEV_MAILBOX_UNAVAILABLE` | 501 | Nenhuma caixa de e-mail de desenvolvimento está ativa. As mensagens só são capturadas quando `SMTP_HOST` não estiver definido e `NODE_ENV` não for production. | Remova a definição de `SMTP_HOST` em desenvolvimento ou consulte a caixa de entrada real. |
| `DOCS_UNAVAILABLE` | 404 | `GET /api/docs` é servido aos mesmos chamadores para os quais `GET /api/schema/tables` descreve tabelas, e este servidor não possui autenticação configurada; logo, não há para quem descrevê-las. | Configure a autenticação ou publique o documento completo para todos com `enableSwagger: true` (`REBASE_ENABLE_SWAGGER=true`). |
| `INVALID_CHANGE` | 400 | A alteração de esquema proposta não está bem formatada. | Veja a mensagem. |
| `SCHEMA_CHANGE_FAILED` | 400 | A aplicação de uma alteração de esquema planejada falhou por um motivo não coberto por códigos mais específicos. | Veja a mensagem; trata-se da falha subjacente na íntegra. |
| `SCHEMA_CHANGE_UNAPPLICABLE` | 400 | A alteração é válida, mas não pode ser aplicada ao esquema no seu estado atual. | Veja a mensagem. |
| `SCHEMA_EDIT_DIRTY_TREE` | 409 | O repositório possui alterações não commitadas; logo, a edição não pôde ser aplicada com segurança. | Faça commit ou stash e tente novamente. |
| `SCHEMA_EDIT_REFUSED` | 400 | O editor de esquema recusou a alteração: o trecho modificado está escrito em código que ele não reescreve (um spread, um helper, uma chave computada), ou a alteração é uma ação que ele nunca realiza (renomear tabela, remover a última regra). `details.problems` lista cada item. Nada foi gravado. | Veja a mensagem. Faça a alteração em `backend/schema` manualmente. |
| `SCHEMA_EDIT_DOES_NOT_COMPILE` | 400 | A edição pode ser feita, mas o esquema resultante não compilaria — uma relação apontando para uma tabela removida, uma regra referenciando coluna excluída. `details.problems` contém os apontamentos do compilador, cada um com sua tabela e coluna. Nada foi gravado. | Altere as tabelas dependentes primeiro ou faça a alteração em `backend/schema` manualmente. |
| `SCHEMA_EDIT_STALE_FILE` | 409 | Um arquivo modificado pela edição foi alterado em disco desde que a edição foi preparada (salvamento no editor, outro processo). Nada foi gravado. | Recarregue e refaça a edição com base no arquivo em seu estado atual. |
| `SCHEMA_EDIT_REQUIRES_A_PERSON` | 403 | Uma chave de API ou outra entidade não humana tentou aplicar uma alteração de esquema. | Autentique-se como usuário ou habilite `liveSchema.allowMachineApply`. |
| `SCHEMA_EDITING_NO_COLLECTIONS_DIR` | 501 | A edição de esquema em tempo real precisa de `schemaDir` (o diretório `backend/schema`) ou `liveSchema.repository`, e este servidor foi iniciado sem nenhum deles. O código mantém seu nome antigo. | Configure um deles. |
| `SCHEMA_EDITING_NO_REPOSITORY` | 503 | O planejamento funciona, mas não há repositório para commitar a alteração — uma implantação executando um bundle compilado ou um servidor cujo `backend/schema` não está em nenhum repositório git (uma aplicação é sempre commitada). | Execute `git init` no projeto e reinicie o servidor (o repositório é detectado na inicialização) ou defina `liveSchema.repository`. |
| `SCHEMA_EDITING_PROVISIONING_OFF` | 409 | Esta implantação não altera nada em seu banco de dados (`REBASE_PROVISION=false`); portanto, uma alteração não pode ser aplicada pelo painel. | Faça o commit apenas no código-fonte e deixe que o processo responsável pela atualização do banco a aplique. |
| `SCHEMA_EDITING_UNSUPPORTED` | 503 | Este driver não suporta o planejamento de alterações de esquema. | A edição em tempo real está disponível no Postgres. |
| `SCHEMA_EDITOR_BAAS_MODE` | 501 | As tabelas são obtidas por introspecção direta do banco de dados aqui; logo, não há arquivos de código para editar. | Altere o esquema por meio de uma migration. |
| `SCHEMA_EDITOR_DISABLED` | 501 | O editor de esquema está desativado neste servidor. Um bundle compilado sempre retorna esta resposta. | Ative-o com `schemaEditor`. Em um bundle, defina `REBASE_LIVE_SCHEMA_REPOSITORY` para editar `backend/schema` através de um repositório — veja [Edição de esquema em tempo real](/docs/backend/live-schema-editing#from-a-built-bundle). |
| `SCHEMA_EDITOR_MISSING_DEPENDENCY` | 501 | O editor de esquema precisa de `ts-morph`, que não está instalado. | Instale-o no pacote que executa o backend e reinicie: `pnpm --dir backend add -D ts-morph@28.0.0` a partir da raiz de um projeto gerado, ou `pnpm add -D ts-morph@28.0.0` onde o backend for a própria raiz do projeto. A mensagem indica o comando para o seu projeto. |
| `SCHEMA_EDITOR_NO_COLLECTIONS_DIR` | 501 | O servidor não possui `schemaDir`, de modo que o editor não tem onde gravar. O código mantém seu nome antigo. | Defina `schemaDir`. |
| `SCHEMA_EDITOR_PRODUCTION` | 501 | O editor está desativado sob `NODE_ENV=production`: os arquivos de um servidor em produção são reconstruídos a partir do seu repositório a cada deploy; portanto, qualquer edição feita aqui seria descartada. | Edite `backend/schema` em desenvolvimento e faça o deploy, ou configure `liveSchema.repository` para commitar as alterações lá. |
| `SCHEMA_UNAVAILABLE` | 404 | `GET /api/schema/tables` em um backend sem autenticação configurada: não há chamador para quem redigir a visibilidade das tabelas, e `auth.requireAuth: false` não altera isso. | Configure um adaptador de autenticação ou `auth.jwtSecret`. Veja [Endpoints](/docs/backend/endpoints/#schema). |
| `TABLE_NOT_FOUND` | 404 | `GET /api/schema/tables/:slug` indica uma tabela que não é servida a este chamador — nenhuma com esse slug, ou uma que os escopos de sua credencial não alcançam. | Verifique o slug e os escopos `data:*` da credencial. |
| `UI_PREFERENCES_NEED_A_PERSON` | 403 | `/api/admin/ui-config` foi chamado com uma chave de API, token de plataforma ou chave de serviço. Preferências de interface pertencem a uma pessoa autenticada. | Faça login como usuário. |
| `UI_PREFERENCES_TOO_LARGE` | 413 | As preferências de interface de uma única tabela ultrapassam 64 KB. | Salve menos dados: preferências armazenam apresentação, não dados de negócio. |
| `UI_PREFERENCES_UNSUPPORTED` | 501 | O driver deste backend não suporta execução de SQL; portanto, ele não armazena preferências de interface; o painel as mantém no navegador. | Nada a corrigir: as preferências permanecem salvas por navegador. |
| `UI_CONFIG_FILE_INVALID` | 500 | `frontend/src/cms/ui-config.json`, onde as preferências de interface do workspace são gravadas em desenvolvimento, não é um JSON válido. | Corrija-o ou exclua-o; o painel o reescreverá na próxima gravação. |
| `SQL_EXPORT_UNSUPPORTED` | 501 | `POST /api/admin/sql/csv` não pode realizar o streaming de resultados aqui: o banco de desenvolvimento em processo (PGlite) possui uma única conexão, e manter um cursor aberto durante o download travaria todas as outras consultas; ou a fonte de dados não suporta cursor SQL. | Aponte `DATABASE_URL` para uma instância própria de Postgres (`rebase dev --docker` inicia uma) ou adicione um `LIMIT` e exporte as linhas visíveis na tela. |

### Reconciliação de esquema (Schema reconcile)

[`rebase schema reconcile`](/docs/cli/schema/#rebase-schema-reconcile) planeja
via `POST /api/admin/schema/reconcile/plan` e aplica via
`/reconcile/apply`. Uma recusa não altera nada; somente `SCHEMA_RECONCILE_FAILED`
deixa parte de um plano aplicado.

| Código | Status | Significado | O que fazer |
| --- | --- | --- | --- |
| `INVALID_RECONCILE` | 400 | O corpo não é um objeto JSON, ou `drop` não é uma lista de strings no formato `"<table>.<column>"`. | Envie `{ "drop": ["voice_cache.wav"] }` ou omita `drop`. |
| `SCHEMA_RECONCILE_FAILED` | 400 | Uma instrução falhou no meio do processo. As instruções anteriores foram executadas e permanecem aplicadas; `details.applied` as lista. | Corrija o problema indicado na mensagem e planeje novamente: o novo plano omitirá o que já foi executado. |
| `SCHEMA_RECONCILE_INVALID` | 400 | O plano não pode ser aplicado e a mensagem detalha o motivo: um `drop` que não segue o formato `<table>.<column>`, indica tabela ou coluna inexistente, ou indica uma coluna que a tabela ainda declara. `details.plan` contém o plano. | Corrija a lista de `drop`. Uma coluna declarada deve ser removida de seu `defineTable`, feito o deploy e depois reconciliada. |
| `SCHEMA_RECONCILE_STALE` | 409 | O banco de dados ou as tabelas mudaram desde o plano que você confirmou. `details.plan` traz o novo plano. | Revise o novo plano e confirme o seu `digest`. |
| `SCHEMA_RECONCILE_UNCONFIRMED` | 400 | `/reconcile/apply` foi chamado sem o campo `confirm`. | Planeje primeiro e envie o `digest` do plano no campo `confirm`. A CLI faz isso automaticamente quando você digita `yes`. |
| `SCHEMA_RECONCILE_UNSUPPORTED` | 503 | O driver deste backend não suporta o planejamento de reconciliação ou não executa SQL. | A reconciliação funciona no Postgres. |

### Por que a tabela de uma branch não pode sofrer merge

`BRANCH_MERGE_BLOCKED` identifica cada tabela recusada em `details.tables`, acompanhada por um
destes códigos. O mesmo código aparece no campo `blocked` da tabela no próprio diff,
permitindo que o Studio avise sobre o impedimento antes que alguém clique em **Merge**. Nenhum deles é uma resposta
independente por si só.

| Código | Status | Significado | O que fazer |
| --- | --- | --- | --- |
| `COLUMNS_DIFFER` | — | As colunas da tabela diferem entre a branch e o pai. As linhas são comparadas com base nas colunas compartilhadas. | Adicione as colunas faltantes ao pai através de suas migrations (`rebase db push`) e execute o merge. Uma migration que reescreva a tabela — como alteração de tipo de coluna — a transforma em `TABLE_REWRITTEN`: faça o merge antes dessa alteração, ou recrie a branch após ela. |
| `NO_PRIMARY_KEY` | — | A tabela não possui chave primária; portanto, as linhas não podem ser comparadas uma a uma; o diff informa apenas a contagem de linhas. | Adicione uma chave primária à tabela ou migre as linhas manualmente. |
| `PRIMARY_KEY_DIFFERS` | — | As colunas da chave primária, ou seus tipos, diferem entre os dois lados. | Aplique o esquema no pai primeiro. |
| `TABLE_ADDED` | — | A branch criou a tabela. Um merge nunca cria tabelas. | Crie-a no pai com suas migrations e depois faça o merge de suas linhas. |
| `TABLE_DROPPED` | — | A branch removeu a tabela. Um merge nunca remove tabelas. | Remova-a por meio de suas migrations. |
| `TABLE_REWRITTEN` | — | Um dos lados regravou todas as linhas da tabela após a criação da branch — alteração de tipo de coluna, um `ADD COLUMN` com valor padrão volátil, `VACUUM FULL`, `CLUSTER` — de modo que todas as linhas constam como alteradas desde então, tornando impossível determinar qual lado modificou qual linha. | Faça o merge da branch antes dessa migration, ou recrie a branch a partir do pai após a conclusão dela. |
| `TOO_LARGE` | — | A tabela contém em um dos lados mais linhas do que um diff consegue comparar individualmente (100.000 por padrão, `maxRowsPerTable`). | Aumente `maxRowsPerTable` tanto no diff quanto no merge, ou transfira as linhas por outro método. |

## Códigos genéricos

Uma rota utiliza um destes códigos quando nenhum outro mais específico for aplicável.

| Código | Status | Significado | O que fazer |
| --- | --- | --- | --- |
| `BAD_REQUEST` | 400 | Malformada, e nenhum código mais específico se aplica. | Veja a mensagem. |
| `UNAUTHORIZED` | 401 | Não autenticado ou a credencial foi rejeitada. | Faça login ou renove a sessão. |
| `FORBIDDEN` | 403 | Autenticado, mas não permitido. | Tentar novamente com a mesma identidade não resolverá. |
| `CONFLICT` | 409 | Um conflito com o estado existente. | Veja a mensagem. |
| `INTERNAL_ERROR` | 500 | Ocorreu uma falha interna no servidor. A mensagem é intencionalmente genérica. | Informe o `requestId`; o motivo detalhado está nos logs. |
| `NOT_CONFIGURED` | 503 | Uma dependência necessária para esta rota não está configurada neste servidor. | Veja a mensagem. |
| `SERVICE_UNAVAILABLE` | 503 | Um serviço do qual a requisição depende não pôde ser alcançado: um bucket S3 ou MinIO, ou um host chamado via `fetch()` por uma função que recusou a conexão ou não foi resolvido. O log do servidor informa o host; a resposta não. Um banco de dados inacessível resulta em `DATABASE_UNAVAILABLE`. Uma conexão com tal serviço que venha a falhar retorna este código. | Tente novamente; verifique os logs. |

## Mantendo esta página atualizada

O comando `pnpm verify:docs` falha se algum código que o servidor pode emitir estiver ausente destas
tabelas, se uma tabela listar um código que nada é capaz de gerar, se os status de uma linha não corresponderem
exatamente àqueles com os quais o código-fonte emite o erro, ou se uma família de códigos como `PG_<SQLSTATE>` não contiver uma linha
para um SQLSTATE com o qual os chamadores possam se deparar. A etapa responsável é
`tooling/scripts/docs-verify/check-error-codes.mjs`.

Ela valida a si mesma primeiro. A verificação analisa os códigos a partir do TypeScript em vez de inspecionar
um servidor em execução; portanto, seus pontos cegos são silenciosos por concepção: certa vez ela não
conseguiu identificar um código passado por um wrapper de uma linha, ou outro declarado após uma mensagem
contendo `)`, e reportou que "todos os códigos geráveis pelo servidor estão documentados"
em uma página que omitia dezessete deles. Por isso, a etapa executa uma fixture contendo exatamente
essas estruturas antes de ler esta página, recusando-se a validar qualquer item caso não consiga identificá-las.
