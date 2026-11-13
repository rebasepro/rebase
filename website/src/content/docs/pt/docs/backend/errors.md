---
sourceHash: e4de48ccefd98d19
title: Códigos de erro
sidebar_label: Códigos de erro
description: Todos os códigos de erro que um backend Rebase pode retornar, com seu status HTTP, o que significa e o que fazer a respeito — além do envelope de resposta, X-Request-ID e as regras de details.
---

Toda falha retornada por um backend Rebase utiliza um único envelope e contém um
`code` estável. O código é o elemento usado para ramificar sua lógica: a mensagem é escrita para uma pessoa
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
- **`requestId`** — presente sempre que a requisição passar pelo middleware de ID de requisição,
  o que abrange todas as rotas sob `basePath`.

### `X-Request-ID`

Toda requisição sob `basePath` recebe um ID: o cabeçalho `X-Request-ID` do chamador
quando for um UUID, ou um novo caso contrário. Ele é retornado na
resposta como `X-Request-ID`, incluído no envelope de erro como `requestId` e
anexado à linha de log do servidor para aquela requisição.

Essa é a chave de junção. Cite-a em um relatório de bug e um operador poderá encontrar a
linha de log exata que explica a falha, trazendo o motivo que nunca foi
exibido ao cliente.

Enviar o seu próprio é a forma como um rastreamento sobrevive a um salto (hop): um gateway ou um executor de tarefas que
repassa o cabeçalho obtém um único ID em todos os serviços que processaram a requisição.
Um valor inválido é ignorado em vez de rejeitado — não vale a pena falhar uma requisição por causa de um cabeçalho malformado
de um chamador —, portanto, não presuma que o ID enviado é o
ID recebido. Leia o cabeçalho de resposta.

### O que há em `details`

`details` tem finalidade diagnóstica, não contratual. Três regras o regem:

1. **Tudo o que uma rota define explicitamente é sempre retornado.** Esses são os
   próprios erros do chamador descritos com precisão: qual campo de filtro era desconhecido,
   qual relação não é gravável, qual valor não correspondeu ao seu tipo.
2. **Diagnósticos do banco de dados são omitidos em produção.** Quando a falha vem
   do Postgres, `details.dbCode` — o SQLSTATE — está sempre presente: ele nomeia
   a classe do problema e não revela nada sobre os dados. `dbMessage`,
   `detail` e `hint` são adicionados apenas quando `NODE_ENV` não for `production`,
   pois o Postgres inclui o conteúdo das linhas neles. `23505` relata
   `Key (email)=(a@b.c) already exists.`, o que responde "esta pessoa está
   cadastrada?" para qualquer endereço que alguém tente consultar.
3. **Nunca ramifique sua lógica com base em `details`.** Ramifique com base em `code`. O que está em `details` é
   qualquer informação que tenha sido útil para uma pessoa naquele ponto de chamada, e isso muda.

## Lendo um status

| Status | O que indica sobre a requisição |
| --- | --- |
| `400` | Malformada ou solicitando algo que não existe no schema. Corrija a requisição. |
| `401` | Não autenticado ou a credencial expirou. Faça login ou renove a sessão. |
| `403` | Autenticado, mas não permitido. Tentar novamente com a mesma identidade não ajudará. |
| `404` | Rota, tabela ou linha inexistente — ou uma linha ocultada pela segurança em nível de linha (RLS). |
| `409` | Um conflito com o estado existente: duplicata ou gravação concorrente. |
| `413` `415` `422` | O corpo é grande demais, o tipo de mídia está errado ou foi rejeitado semanticamente. |
| `429` | Limite de taxa excedido (rate limited). Aguarde; a mensagem diz por quanto tempo. |
| `500` | O erro está no servidor ou no banco de dados, não no chamador. Verifique os logs. |
| `501` | A rota existe, mas esta implantação não pode atendê-la — um recurso desativado ou não configurado. |
| `502` `503` `504` | Uma dependência estava inacessível, não configurada ou muito lenta. |

## Autenticação e contas

<span class="since-badge" data-since="0.31">Desde 0.31</span>

| Código | Status | Significado | O que fazer |
| --- | --- | --- | --- |
| `AAL2_REQUIRED` | 403 | A rota precisa de um segundo fator e a sessão possui apenas um. | Conclua o desafio de MFA e tente novamente. |
| `ALREADY_VERIFIED` | 400 | O endereço ou fator já foi verificado. | Nada — o estado desejado já é verdadeiro. |
| `ACCOUNT_OUTRANKS_CALLER` | 403 | A conta sendo editada, redefinida ou excluída possui uma role ou escopo que o chamador não tem. `details.beyond` lista-os. | Peça para alguém que os possua fazer a alteração. |
| `ANONYMOUS_AUTH_DISABLED` | 403 | O login anônimo está desativado neste servidor. | Ative-o ou entre com uma identidade real. |
| `ANONYMOUS_NOT_ALLOWED` | 403 | Uma sessão de convidado tentou aprovar o login de um dispositivo. Um convidado não tem uma conta para vincular a um dispositivo. | Entre com uma conta e depois aprove-o. |
| `API_KEY_SELF_MANAGEMENT_FORBIDDEN` | 403 | Uma chave de API tentou listar, criar, alterar ou revogar chaves de API, do seu próprio tipo ou pessoais. | Gerencie chaves como um usuário portador de `keys:write` ou com a chave de serviço. |
| `AUTH_MIDDLEWARE_MISSING` | 500 | Uma rota protegida foi executada sem nenhum middleware de autenticação do Rebase antes dela, portanto a credencial do chamador nunca foi inspecionada. | Monte a aplicação através do roteador de funções em vez de montá-la diretamente no seu próprio servidor. |
| `BOOTSTRAP_ANONYMOUS` | 403 | O bootstrap do primeiro administrador foi tentado por um chamador anônimo. | Faça login primeiro. |
| `BOOTSTRAP_COMPLETED` | 403 | O primeiro administrador já existe. | Peça a um administrador existente para conceder a role. |
| `BOOTSTRAP_NOT_FIRST_USER` | 403 | O bootstrap destina-se apenas ao primeiríssimo usuário, e este não é ele. | Peça a um administrador existente para conceder a role. |
| `CAPTCHA_FAILED` | 400 | O provedor rejeitou o token do CAPTCHA. | Resolva um novo desafio. |
| `CAPTCHA_REQUIRED` | 400 | A rota requer um token de CAPTCHA e nenhum foi enviado. | Inclua o token. |
| `CHALLENGE_EXHAUSTED` | 401 | Muitas tentativas erradas de código para um único desafio de MFA. | Inicie um novo desafio. |
| `DEVICE_LOGIN_DECIDED` | 409 | O login do dispositivo já foi aprovado ou negado. Um login é decidido apenas uma vez. | Inicie um novo processo no dispositivo. |
| `DEVICE_LOGIN_EXPIRED` | 410 | O login do dispositivo ultrapassou seus dez minutos antes de ser decidido. | Inicie um novo processo no dispositivo. |
| `DEVICE_LOGIN_NOT_FOUND` | 404 | Nenhum login de dispositivo possui esse código de usuário. A própria consulta (poll) do dispositivo responde aos códigos em minúsculas da RFC 8628: `authorization_pending`, `slow_down`, `access_denied`, `expired_token`, `invalid_grant`. | Verifique o código comparando com o exibido no dispositivo. |
| `EMAIL_EXISTS` | 409 | Já existe uma conta com esse endereço — no cadastro, em uma alteração de endereço ou ao acessar um link de alteração quando outra conta assumiu o endereço enquanto ele aguardava. | Faça login ou inicie a redefinição de senha; para alteração de endereço, escolha outro endereço. |
| `EMAIL_NOT_CONFIGURED` | 503 | Links mágicos ou OTP foram solicitados, mas o servidor não tem transporte de e-mail. | Configure o SMTP ou use outro método de login. |
| `EMAIL_NOT_VERIFIED` | 403 | Um login OAuth encontrou uma conta com o mesmo endereço e o provedor não verificou esse endereço, portanto ele não está vinculado. | Entre com o método existente e execute `POST /auth/link/<provider>`. |
| `FACTOR_NOT_VERIFIED` | 400 | O fator de MFA foi cadastrado, mas nunca confirmado. | Confirme o fator. |
| `IDENTITY_ALREADY_LINKED` | 409 | Essa identidade OAuth pertence a outra conta. | Faça login com ela ou desvincule-a de lá primeiro. |
| `IMPERSONATION_FORBIDDEN` | 403 | Uma requisição enviou `x-rebase-impersonate` e seu chamador não pode executar uma requisição como outro usuário. Apenas a própria sessão de um administrador autenticado pode, nunca uma chave de API ou a chave de serviço. | Envie com a sessão de um administrador ou omita o cabeçalho. |
| `IMPERSONATION_INVALID` | 400 | `x-rebase-impersonate` foi enviado vazio. | Envie o uid do usuário para atuar como ele, ou omita o cabeçalho. |
| `IMPERSONATION_TARGET_NOT_FOUND` | 404 | `x-rebase-impersonate` não indica nenhum usuário ativo: nenhuma conta tem esse uid ou ela está desativada. | Verifique o uid. |
| `IMPERSONATION_UNAVAILABLE` | 501 | A autenticação deste backend não pode executar uma requisição como outro usuário porque seu `AuthAdapter` não possui `resolveUser`. | Implemente `resolveUser` no adapter ou omita o cabeçalho. |
| `IMPERSONATION_UNSUPPORTED` | 400 | `x-rebase-impersonate` foi enviado para uma rota que não pode ser executada como outro usuário. Apenas a API de dados e funções personalizadas o aceitam, e o socket em tempo real aceita `impersonate` em `AUTHENTICATE`. | Envie a requisição sem o cabeçalho. |
| `SIMULATION_FORBIDDEN` | 403 | Uma requisição enviou um cabeçalho `x-rebase-simulate-*` (o simulador de RLS) ou chamou `/api/admin/rls-simulator`, e seu chamador não pode simular acesso. Apenas a própria sessão de um administrador autenticado pode, nunca uma chave de API ou a chave de serviço. | Envie com a sessão de um administrador ou omita os cabeçalhos. |
| `SIMULATION_INVALID` | 400 | A simulação estava malformada: um cabeçalho foi enviado vazio, `x-rebase-simulate-api-key-id` foi combinado com uma role ou id de usuário, ou a simulação foi combinada com `x-rebase-impersonate`. | Especifique uma role (opcionalmente com um uid), um id de usuário ou um id de chave de API. |
| `SIMULATION_READ_ONLY` | 403 | Uma gravação, exclusão, `_batch`, reversão de histórico ou uma função personalizada chamada por qualquer verbo exceto `GET`/`HEAD`/`OPTIONS` continha um cabeçalho `x-rebase-simulate-*`. O acesso simulado é somente leitura: a gravação seria executada como a identidade simulada, não como o administrador. Leituras, incluindo `POST …/query` e `…/count`, continuam sendo executadas. | Interrompa a simulação para fazer alterações. |
| `SIMULATION_TARGET_NOT_FOUND` | 404 | A simulação não indica nenhum usuário ativo (um id de usuário enviado sem role) ou nenhuma chave de API ativa. | Verifique o id ou envie uma role junto com o uid para simular um uid que não possui conta. |
| `SIMULATION_UNAVAILABLE` | 501 | Este backend não pode simular acesso: seu `AuthAdapter` não possui `resolveUser` para confirmar um administrador, ou uma chave foi especificada em um backend sem chaves de API. | Implemente `resolveUser` ou omita os cabeçalhos. |
| `SIMULATION_UNSUPPORTED` | 400 | Um cabeçalho `x-rebase-simulate-*` foi enviado para uma rota que não pode ser executada com acesso simulado. Apenas a API de dados e funções personalizadas os aceitam. | Envie a requisição sem os cabeçalhos. |
| `GUEST_REFERENCED` | 409 | Um convidado não pôde ser excluído porque uma linha do próprio projeto o exige, por meio de uma chave estrangeira com `ON DELETE RESTRICT` ou `NO ACTION`. `DELETE /api/admin/guests` relata isso por convidado em `skipped` e continua. | Exclua a linha ou mantenha o convidado. |
| `INVALID_ACCOUNT` | 400 | A conta está em um estado sobre o qual esta operação não pode atuar. | Veja a mensagem. |
| `INVALID_CHALLENGE` | 400 | O desafio de MFA é desconhecido ou expirou. | Inicie um novo. |
| `INVALID_CODE` | 400 / 401 | O código OTP ou MFA está incorreto: 400 no login por código de e-mail (`/auth/otp/verify`), 401 no cadastro ou desafio de MFA. | Tente novamente com o código atual. |
| `INVALID_CREDENTIALS` | 401 | E-mail ou senha incorretos — deliberadamente sem especificar qual. | Tente novamente ou redefina a senha. |
| `INVALID_PLATFORM_TOKEN` | 401 | Um token de plataforma `rpt_` foi recusado: assinatura inválida, público incorreto, expirado ou tempo de vida além do limite. A mensagem especifica o motivo. | Peça à plataforma para gerar um novo — no Rebase Cloud, execute o comando novamente. |
| `INVALID_SCOPES` | 400 | Uma chave foi solicitada para algo que não é um escopo: malformado, desconhecido ou com um destino que o escopo não aceita. `details.problems` diz qual e o motivo; `details.validScopes` lista os escopos que uma chave pode ter. Ele omite `keys:read` e `keys:write`, que nenhuma chave pode possuir. | Use um nome da lista. Veja [Roles e escopos](/docs/backend/roles-and-scopes/). |
| `INVALID_TOKEN` | 400 / 401 | Um token de verificação, redefinição, link mágico ou alteração de endereço está malformado, desconhecido, já utilizado ou expirado (400). Uma credencial de provedor OAuth ou um token de atualização que não valida é um 401. | Solicite um novo link ou entre novamente. |
| `INVALID_USER_CODE` | 400 | O que foi enviado como código de login do dispositivo não é um código válido: oito letras, como `BCDF-GHJK`. | Copie o código exibido no dispositivo. |
| `INVALID_ROLE` | 400 | O nome da role sendo gravada não é uma string, está vazio ou contém `,` `{` `}` `"` `\` ou um caractere de controle. Esses caracteres seriam lidos de volta como outras roles: uma role trafega em um `text[]` do Postgres e na lista separada por vírgulas dividida pelas políticas de RLS, portanto `"support,admin"` voltaria como `admin`. `details.problems` nomeia cada um. | Renomeie a role. Qualquer outro nome é aceito. |
| `KEY_MANAGEMENT_SCOPE` | 400 | Uma chave foi solicitada para `keys:read` ou `keys:write`. Nenhuma chave pode gerenciar chaves. `details.scopes` lista-os. | Omita-os. |
| `KEY_OUTRANKS_CALLER` | 403 | Um detentor de `keys:write` tentou alterar ou revogar uma chave de serviço que possui uma role ou escopo que ele não possui. Apenas um admin gerencia qualquer chave. `details.roles` e `details.scopes` listam o que a chave possui além do chamador. | Peça a um admin, ou a alguém que os possua, para alterar a chave. |
| `LAST_ADMIN` | 403 | A alteração deixaria o projeto sem nenhum administrador. | Promova outra pessoa primeiro. |
| `MFA_REQUIRED` | 401 | A senha estava correta e a conta tem um segundo fator verificado, portanto o login está apenas pela metade. `details` traz um token de curta duração com escopo para o desafio de MFA — não é uma sessão. | Abra um desafio e responda a ele; a resposta ao desafio emite a sessão. |
| `NO_SESSION` | 401 | Nenhum cookie de sessão ou token de atualização foi apresentado. Normal em um primeiro carregamento de página. | Faça login. |
| `NOT_ANONYMOUS` | 400 | Uma rota de upgrade a partir de anônimo foi chamada por uma conta real, ou `DELETE /api/admin/guests/:uid` nomeou uma. | Nada a atualizar. Para excluir uma conta, use `DELETE /api/admin/users/:uid`. |
| `OAUTH_ERROR` | 401 | O provedor OAuth recusou ou retornou um erro. | Tente novamente o fluxo; a mensagem traz o motivo do provedor. |
| `PERSONAL_KEYS_DISABLED` | 403 | Chaves de API pessoais estão desativadas neste backend. | Defina `personalKeys: true` nas opções de `auth` da tabela de autenticação (`defineAuthTable`). |
| `PERSONAL_KEY_NEEDS_ACCOUNT` | 403 | A chave de serviço ou uma sessão de convidado tentou usar as rotas de chave pessoal. Nenhuma das duas tem uma conta para atuar como tal. | Entre em uma conta ou crie uma chave de serviço em `/api/admin/api-keys`. |
| `PLATFORM_TOKENS_OFF` | 401 | Um token de plataforma `rpt_` chegou a um servidor que não os aceita: `REBASE_PLATFORM_TOKEN_KEY` e `REBASE_PLATFORM_TOKEN_AUDIENCE` não estão definidos. | A plataforma que hospeda o app define ambos ao implantar; reimplante ou acesse o app por outro método. |
| `RATE_LIMITED` | 429 | Muitas tentativas vindas deste chamador. | Aguarde; a mensagem diz por quanto tempo. |
| `REDIRECT_URI_NOT_ALLOWED` | 400 | O destino do redirecionamento não está na lista de permissões. | Adicione-o à configuração do provedor. |
| `REGISTRATION_DISABLED` | 403 | O cadastro autônomo está desativado. | Peça a um admin para criar a conta. |
| `ROLE_EXCEEDS_CALLER` | 403 | As roles concedidas contêm um escopo, ou `admin`, que o chamador não possui. `details.beyond` lista-os. | Peça a alguém que os possua para conceder a role. |
| `ROLE_EXCEEDS_CREATOR` | 403 | Uma chave de serviço recebeu uma role de RLS que seu criador não possui. Apenas um admin pode conceder qualquer role. `details.roles` lista-as. | Remova a role ou peça a um admin para criar a chave. |
| `ROLE_EXISTS` | 409 | Esse nome de role já está em uso. | Escolha outro nome. |
| `ROLE_LOOKUP_FAILED` | 503 | As roles do chamador não puderam ser lidas — em uma rota de admin ou em uma requisição de dados em um backend com `config.auth`. Bloqueia o acesso por precaução (fails closed) em vez de confiar nas roles contidas no token. Um token cujo uid não referencia nenhuma conta, incluindo um uid incompatível com a tabela de usuários, retorna 401, não este erro. Um banco de dados que não pode ser alcançado retorna `DATABASE_UNAVAILABLE`, não este erro. | Tente novamente; verifique o banco de dados. |
| `SCOPE_EXCEEDS_CREATOR` | 403 | Uma chave foi solicitada para um escopo que seu criador não possui. Uma chave nunca possui mais privilégios do que a conta que a cria. `details.scopes` lista-os. | Remova-os ou peça a alguém que os possua para criar a chave. |
| `SCOPE_MISSING` | 403 | A credencial não possui o escopo de que esta rota, tabela, fonte de storage ou função precisa. `details.requiredScope` informa qual, destino incluído. | Para uma pessoa, uma role que declare o escopo. Para uma chave, uma chave que o possua. Veja [Roles e escopos](/docs/backend/roles-and-scopes/). |
| `SCOPE_NOT_DECLARED` | 500 | Uma rota protegida com `requireScope` nomeia um escopo de app que este backend não declara, de modo que ninguém o possui, nem mesmo um administrador. Um nome que não é um escopo, ou um integrado escrito incorretamente como `data:raed`, nunca chega a este ponto: `requireScope` lança erro onde a rota é registrada. | Declare o escopo sob `auth.scopes` na tabela de autenticação ou corrija o nome. Veja [Roles e escopos](/docs/backend/roles-and-scopes/). |
| `SELF_DELETE` | 400 | Um administrador tentou excluir sua própria conta. | Peça a outro administrador para fazê-lo. |
| `SESSION_REVOKED` | 401 | A sessão foi encerrada em outro lugar, todas as sessões foram revogadas ou a conta foi excluída. Todas as portas que recebem uma sessão respondem com este código para tal token de acesso: a API de dados, storage, funções personalizadas e as rotas de admin. O socket em tempo real recusa seu `AUTHENTICATE` com um frame `AUTH_ERROR` contendo o mesmo código. O SDK tenta renovar, a renovação é recusada e ele desloga. | Faça login novamente. |
| `ACCOUNT_DISABLED` | 401/403 | Um administrador desativou a conta: login (403), renovação de token e qualquer token emitido por ela (401) são recusados em todas as portas que recebem uma sessão. O socket em tempo real recusa seu `AUTHENTICATE` com um frame `AUTH_ERROR` contendo o mesmo código. | Contate um administrador. |
| `EMAIL_NOT_CONFIRMED` | 403 | `requireEmailVerification` está ativado e o endereço ainda não foi verificado. Retornado apenas para senhas corretas; um novo link é enviado por e-mail. | Acesse o link no e-mail. |
| `PROOF_REQUIRED` | 409 | `POST /auth/verify-email`: a conta contém uma senha ou identidade que ninguém comprovou, e a requisição não comprova nenhuma das duas. O token não é consumido. | Envie `password` para mantê-la ou `removeUnproven: true` para verificar sem ela. |
| `UNDELIVERABLE_ADDRESS` | 400 / 409 | Foi solicitado um e-mail de verificação para um endereço inacessível — de um convidado ou o placeholder do X (400) — ou uma conta solicitou mudança para tal endereço (409, `POST /auth/change-email`). | Defina um endereço real primeiro. |
| `EMAIL_UNCHANGED` | 400 | `POST /auth/change-email` especificou o endereço atual da conta. | Nada a alterar. |
| `ANONYMOUS_USER` | 403 | Um convidado tentou alterar seu endereço de e-mail; um convidado não possui um e-mail próprio. | Converta-o em uma conta primeiro (`POST /auth/anonymous/link`). |
| `MFA_NOT_ENROLLED` | 400 | Códigos de recuperação foram solicitados para uma conta sem nenhum segundo fator verificado. | Cadastre um fator primeiro. |
| `HOOK_REJECTED` | 400 | Um hook `beforeUserCreate`, `beforeLogin`, `beforeUserDelete` ou `beforeEmailChange` disparou um erro. A mensagem é a do próprio hook; um hook que definiu um status 4xx responde com ele. | Veja a mensagem. |
| `INVALID_JSON` | 400 | O corpo da requisição não é JSON. | Envie um corpo JSON. |
| `SELF_DISABLE` | 400 | Um administrador tentou desativar sua própria conta. | Peça a outro administrador. |
| `NOT_SUPPORTED` | 501 | O repositório de autenticação deste backend não consegue realizar a ação solicitada (desativar contas, alterar endereço). | Reinicie o servidor para que a coluna seja adicionada, ou use um repositório compatível. |
| `UNKNOWN_SCOPE_TARGET` | 400 | O destino de um escopo nomeia uma tabela, fonte de storage ou função que este backend não disponibiliza. `details` lista as que ele disponibiliza. | Corrija o destino. |
| `UNVERIFIED_IDENTITIES` | 409 | Um link mágico, código de e-mail ou redefinição de senha comprovou o endereço de uma conta não verificada, e a conta carrega uma identidade de login cujo provedor nunca verificou esse endereço. O repositório de autenticação não consegue removê-la (não possui `unlinkUserIdentity`), portanto a comprovação é recusada em vez de deixar essa brecha em uma conta verificada. | Implemente `unlinkUserIdentity` no repositório de autenticação personalizado ou peça a um administrador para revisar a conta. |
| `SETUP_REQUIRED` | 403 | O projeto ainda não tem um administrador, portanto esta rota não está disponível. | Conclua a configuração do primeiro administrador. |
| `TOKEN_ALREADY_USED` | 401 | Um token de uso único foi reutilizado, ou um token de atualização que foi rotacionado há mais de `refreshTokenReuseIntervalSeconds`. | Solicite um novo ou faça login novamente. |
| `TOKEN_EXPIRED` | 401 | O token ultrapassou seu tempo de vida. | Solicite um novo. |
| `USER_NOT_FOUND` | 404 | Nenhuma conta com esse id. | Verifique o id. |
| `WEAK_PASSWORD` | 400 | A senha não atende à [política de senhas](/docs/backend/auth-endpoints/#password-policy) (por padrão, 8+ caracteres com uma letra maiúscula, uma minúscula e um dígito) — no cadastro, em uma redefinição ou alteração, ou em uma senha escolhida por um administrador: `POST /api/admin/users`, uma criação na tabela de autenticação via API de dados, `PUT /api/admin/users/:id` ou `POST /api/admin/users/:id/reset-password`. | Escolha uma mais forte. Um administrador importando contas pode enviar `skipPasswordPolicy: true` na criação. |

## Dados, consultas e gravações

| Código | Status | Significado | O que fazer |
| --- | --- | --- | --- |
| `AGGREGATE_MASKED_BY_AFTER_READ` | 400 | Um agregado diferente de `count()` sem `groupBy` em uma tabela reescrita por um hook `afterRead` (global, de tabela ou o `.transform()` de uma coluna). Um agregado lê os valores armazenados e nunca executa o hook, portanto uma soma, mínimo, máximo, contagem de campo ou agrupamento leria o que o hook oculta. | Use `count()` sem `groupBy` ou leia as linhas, que passam pelo hook. |
| `AGGREGATE_NOT_SUPPORTED` | 501 | Este driver não consegue calcular o agregado solicitado. | Use um driver compatível ou calcule no cliente. |
| `BRANCHING_UNSUPPORTED` | — | Uma branch de banco de dados foi solicitada via WebSocket do Studio no banco de dados de desenvolvimento gerenciado (PGlite), onde uma branch *é* o próprio pai e nada seria isolado. A recusa é a mesma exibida por `rebase db branch`. | Aponte `DATABASE_URL` para uma instância própria do Postgres (`rebase dev --docker` inicia uma) e crie branches nela. |
| `BATCH_TOO_LARGE` | 400 | `POST /api/data/_batch` contém mais operações do que o limite por lote (1000 por padrão). Um lote é uma transação e retém seus bloqueios durante toda a execução. | Envie em partes menores; a mensagem informa o limite e a sua contagem. |
| `BATCH_UNSUPPORTED` | 400 | O driver deste backend não consegue gravar entre tabelas atomicamente, e um loop de gravações individuais não seria atômico nem executado em uma única ida e volta. | Envie as gravações como requisições separadas ou como chamadas `/bulk` por tabela. |
| `BULK_TOO_LARGE` | 400 | O corpo em massa (bulk) excede o limite configurado de itens. | Divida a requisição. |
| `BULK_UNSUPPORTED` | 400 | Esta tabela ou driver não oferece suporte a gravações em massa. | Grave as linhas uma por vez. |
| `CALLBACK_REJECTED` | 400 / 403 | Um hook de tabela recusou a gravação. Um `throw` de `beforeSave`/`beforeDelete`/`after*` é um 400 trazendo a mensagem definida pelo autor; um `beforeDelete` que retorna `false` é um 403. `details.stage` informa qual hook, `details.path` a tabela. | Leia a mensagem — ela foi escrita por este projeto, não pelo Rebase. |
| `CALLBACK_RECURSION` | 500 | Gravações iniciadas por hooks aninhados com mais de 16 níveis de profundidade: a gravação de um hook via `context.data` dispara os hooks daquela tabela novamente, e nada na cadeia interrompe o ciclo — geralmente um `afterSave` que atualiza sua própria linha incondicionalmente. Toda a gravação foi revertida. A mensagem cita o hook e a tabela; `details.chain` lista cada etapa de hook → gravação. | Torne a gravação do hook condicional: atue apenas em `status === "new"`, ou ignore quando `values` já contiver o que seria gravado. |
| `TABLE_READ_ONLY` | 405 | <span class="since-badge" data-since="0.31">Desde 0.31</span> Uma gravação atingiu uma view (`defineView`). Uma view é somente leitura. Anteriormente `COLLECTION_READ_ONLY`. | Grave nas tabelas que a view lê. Veja [Views](/docs/collections/views/). |
| `TABLE_WITHHELD` | 503 | <span class="since-badge" data-since="0.31">Desde 0.31</span> A tabela está declarada, mas o banco de dados não a protege: a segurança em nível de linha (RLS) está desativada, nenhuma das políticas que ela declara está presente ou uma política restritiva declarada está ausente. (Uma política permissiva ausente é atendida, com um aviso de boot indicando-a.) Isso ocorre quando o servidor não provisiona suas tabelas (`REBASE_PROVISION=false`, `provisionSchema: false`, `provision.tables: false`, `REBASE_MIGRATE_ON_BOOT=none`), e o servidor retém a tabela em vez de disponibilizar todas as linhas para qualquer chamador. Uma junção muitos-para-muitos segue a mesma regra: quando falha, as tabelas cujas relações a utilizam são retidas e a mensagem cita a junção; o mesmo vale para uma tabela cujo `via` passa por uma tabela retida, indicando o `via`. Uma leitura ou filtro de relação que passe por uma tabela retida também responde com este código. As demais tabelas continuam sendo servidas. O log de inicialização cita as instruções que a protegem. | Aplique as instruções que o log de boot indica (como faz `rebase db push`) e reinicie. |
| `SQL_NOT_ALLOWED` | 400 | O SQL executado como o chamador (`getSql(c)`, `withAuth(user).sql`) não era uma única instrução pura de `SELECT`, `WITH`, `VALUES`, `TABLE`, `INSERT`, `UPDATE`, `DELETE` ou `MERGE`, ou chamou `set_config` ou nomeou `pg_settings`. A identidade do chamador fica nas configurações de sessão, portanto qualquer instrução que possa alterá-las é recusada. | Mantenha o texto da consulta próprio, em uma única instrução, com todos os valores em `params`. Veja [Funções personalizadas](/docs/backend/custom-functions/#3-getsqlc--sql-as-the-caller). |
| `CURSOR_WITH_OFFSET` | 400 | `?after=` foi combinado com `?offset=` ou `?page=`. Um cursor já define onde a página começa, portanto um offset aplicado sobre ele pula silenciosamente essa quantidade de linhas após o cursor — uma lacuna invisível para o chamador na resposta. | Use um ou outro. |
| `DISTINCT_NOT_APPLICABLE` | 400 | `?distinct=true` foi combinado com uma busca textual ou consulta vetorial. Ambas atribuem uma pontuação (score) por linha, de modo que duas linhas nunca são iguais e `DISTINCT` não agruparia nada — pareceria que funcionou, mas não mudaria nada. | Remova um dos dois. |
| `DISTINCT_ORDER_BY_NOT_SELECTED` | 400 | Uma leitura com `distinct` está ordenada por uma coluna que ela não retorna. Um `SELECT DISTINCT` só pode ser ordenado por colunas presentes na sua lista de seleção, senão as linhas agrupadas não têm ordem definida. `details.fields` lista-as. | Adicione esses campos a `?fields=` ou remova-os de `?orderBy=`. |
| `DATABASE_UNAVAILABLE` | 503 | O banco de dados não pôde ser alcançado: a conexão foi recusada ou caiu, o host não resolveu, o servidor está iniciando/desligando ou o banco está fechado para novas conexões (`ALLOW_CONNECTIONS false`, deixado em sua origem por um `rebase db branch create --force` interrompido no meio; o log do servidor informa o banco, e `rebase db branch list` o reabre). Todas as portas respondem com ele, incluindo login, rotas de admin e o socket em tempo real (em um frame `ERROR`). Enviado com `Retry-After: 5`. | Tente novamente; o SDK faz isso automaticamente. Verifique se o banco está em execução e acessível a partir do servidor. |
| `DB_CONNECTIONS_EXHAUSTED` | 503 | O servidor de banco de dados recusou uma nova conexão por não ter mais conexões disponíveis (`53300` excesso de clientes, `53400` limite de conexões de uma role ou banco). Todas as instâncias do servidor compartilham o `max_connections` do banco, portanto isso ocorre com várias instâncias com pools grandes sem um pooler. Trata-se de sobrecarga, não de falha; enviado com `Retry-After: 2`. O servidor registra a solução no log uma vez por minuto. | Tente novamente; o SDK faz isso automaticamente. Reduza `DB_POOL_MAX` (ou limite com `REBASE_DB_POOL_MAX`) entre as instâncias, coloque um pooler na frente do banco (`DATABASE_POOLED`) ou aumente `max_connections`. |
| `DB_CONNECT_TIMEOUT` | 503 | Abrir uma nova conexão com o banco de dados demorou mais do que `DB_POOL_CONNECT_TIMEOUT`: o banco está lento para aceitar conexões ou muito distante. Enviado com `Retry-After`. | Tente novamente; o SDK faz isso automaticamente. Verifique a carga do banco de dados e a rede até ele. |
| `DB_PERMISSION_DENIED` | 500 | O Postgres recusou a instrução (`42501`): seja por uma política de segurança em nível de linha negando esta role ou por falta de um `GRANT`. | Veja [Solução de problemas](/docs/troubleshooting/). |
| `DB_POOL_EXHAUSTED` | 503 | Todas as conexões do pool permaneceram ocupadas por `DB_POOL_CONNECT_TIMEOUT`, portanto esta requisição nunca alcançou o banco de dados. Trata-se de sobrecarga, não de falha; enviado com `Retry-After`. O servidor registra a solução no log uma vez por minuto. | Tente novamente; o SDK faz isso automaticamente. Aumente `DB_POOL_MAX` ou localize as consultas lentas e transações longas que estão prendendo conexões. |
| `FIELD_NOT_READABLE` | 400 | Um filtro, `orderBy`, `fields`, `select` de agregado ou `groupBy` nomeia um campo que as roles deste chamador não podem ler (`access.read`), um caminho aninhado ou ordenação por agregado nomeia uma relação que ele não pode ler — ou uma operação de campo (`$inc`, `$push`, …) tem como alvo um campo inacessível, onde um limite recusado revelaria o valor armazenado. Um campo que nenhuma resposta pode retornar não pode ser interrogado por nenhuma consulta, senão o valor seria legível predicado por predicado. Um filtro por meio de relação (`author.salary`) e uma ordenação por agregado sobre o campo de uma relação (`max(staff.salary)`) são avaliados pela regra do destino. `details.violations` informa cada campo. O driver aplica a mesma regra a uma leitura feita em processo em nome de um chamador (`context.data` sob o escopo do chamador) e a uma busca vetorial, include ou teste de unicidade. Uma coluna marcada como `.private()` responde como se não existisse: qualquer filtro, `orderBy`, `fields`, `include`, `select` de agregado, `groupBy` ou `vector_search` que a nomeie recebe exatamente a resposta de um nome incorreto (`UNKNOWN_FILTER_FIELD`, `UNKNOWN_ORDER_BY_FIELD`, `UNKNOWN_FIELD`, `UNKNOWN_RELATION`, `UNKNOWN_AGGREGATE_FIELD` ou `UNKNOWN_VECTOR_PROPERTY`), e nenhuma lista de campos desconhecidos a revelará. | Remova o campo da consulta ou obtenha a role necessária. Veja [Acesso a campos](/docs/collections/field-access/). |
| `FIELD_NOT_WRITABLE` | 400 / 403 | O corpo define um campo que as roles deste chamador não podem gravar (`access.write`). Recusado em vez de ignorado silenciosamente: uma gravação que descarta um campo reportaria sucesso para uma edição que não ocorreu. O mesmo código recusa uma gravação através de um pai que define uma relação que o chamador não pode gravar, e uma atualização que define um campo de `softDelete` com um valor — apenas uma exclusão o preenche. O socket em tempo real responde 403 com este código para uma gravação através de um caminho aninhado cuja tabela pai, relação ou tabela de destino não esteja disponível ali, em vez de repassá-la ao driver sem validação. `details.violations` cita cada campo. | Remova o campo ou obtenha a role. Um campo que ninguém pode gravar responde com `VALIDATION_EXCLUDED_FIELDS`. |
| `FILTERED_USER_WRITE` | 400 | Uma atualização ou exclusão filtrada foi enviada para a tabela de autenticação via HTTP, cujas gravações são verificadas usuário por usuário antes de serem executadas. | Leia os usuários e use `updateMany`/`deleteMany` neles por id. |
| `FILTER_REQUIRED` | 400 | Uma gravação filtrada (uma atualização ou exclusão por `where`/`logical`, vinda do SDK ou de rotas em massa) não contém condições, de modo que afetaria todas as linhas. Recusada antes de qualquer execução. | Adicione uma condição. Para alterar todas as linhas intencionalmente, defina uma condição que todas as linhas atendam. |
| `HISTORY_UNAVAILABLE` | 503 | Uma gravação em uma tabela com `history: true` foi recusada porque o registro de histórico não pôde ser gravado: o banco não possui a tabela `rebase.entity_history` ou, no caso de `openRebase` e `rebase console`, a função `rebase.record_history`. Nenhum backend com histórico foi inicializado neste banco de dados. Nada foi executado, hooks incluídos, e leituras não são afetadas. Lançado por `openRebase` e retornado por um backend criado com `provision: false`. | Inicialize o backend uma vez com o histórico ativado e `provision: true` (como faz `rebase dev`) e tente novamente. |
| `HISTORY_UNSERVABLE` | 501 | <span class="since-badge" data-since="0.31">Desde 0.31</span> O driver de dados da tabela não consegue aplicar as regras de leitura e hooks `afterRead` sobre as linhas armazenadas (`DataDriver.serveStoredRows`), e o histórico nunca é servido sem máscara. O driver Postgres integrado tem esse suporte. | Implemente `serveStoredRows` no driver personalizado. Veja [Histórico](/docs/backend/history/). |
| `IDEMPOTENCY_KEY_IN_PROGRESS` | 409 | Uma requisição anterior com a mesma `Idempotency-Key` ainda está em execução. | Tente novamente assim que ela terminar. |
| `IDEMPOTENCY_KEY_REUSED` | 422 | A mesma `Idempotency-Key` foi enviada em uma requisição diferente: outro método, caminho, query string ou corpo. | Use uma nova chave ou reenvie a requisição original. |
| `INVALID_AGGREGATE_FUNCTION` | 400 | `?select=` nomeou uma função que não é de agregação (`count`, `sum`, `avg`, `min`, `max`, `countDistinct`, `mode`, `percentile`, `distinct`, `fingerprint`). | Use uma dessas opções; a mensagem lista todas elas. |
| `INVALID_AGGREGATE_GROUP` | 400 | Uma transformação de `groupBy` é desconhecida ou não se aplica à coluna: `year`/`month`/`day` em coluna que não é data, `unnest` em coluna que não é array. | Use `lower`, `upper`, `year`, `month`, `day` ou `unnest` em uma coluna do tipo correto. |
| `INVALID_AGGREGATE_SELECT` | 400 | Uma entrada em `?select=` não está no formato `fn(field)`; uma função diferente de `count()` ou `fingerprint()` não recebeu nenhum campo; `percentile` não contém uma fração entre 0 e 1; ou `fingerprint()` foi solicitado para uma view simples, que não armazena linhas. | Escreva `sum(total)`, `count()`, `percentile(price,0.95)`. |
| `INVALID_AGGREGATE_WINDOW` | 400 | `offset`, `page` ou `orderBy` em um agregado sem `groupBy`, ou um cursor em qualquer agregado. Um agregado sem agrupamento é apenas uma linha, e um grupo não é uma linha após a qual um cursor possa continuar. | Adicione `groupBy` ou remova esses parâmetros; pagine grupos com `offset` ou `page`. Veja [Agregados](/docs/sdk/aggregates-and-search/#aggregates). |
| `INVALID_BATCH_BODY` | 400 | Uma operação de `/_batch` está sem `op`, `table`, `values` ou `id`, especifica uma tabela não atendida por este backend ou reutiliza um nome de `ref`. | Veja a mensagem; ela indica a operação pelo índice. |
| `INVALID_BATCH_REF` | 400 | Um `{ "$ref": "<name>.<field>" }` não aponta para nenhuma operação anterior, aponta para frente ou solicita um campo inexistente na linha referenciada. Apenas referências para trás são resolvidas. | Defina a operação com `ref` *antes* de referenciá-la. |
| `INVALID_BULK_BODY` | 400 | O corpo da operação em massa não está no formato esperado. | Envie o array esperado pela rota: `{ "rows": [...] }` para `POST /bulk`, `{ "updates": [{ "id", "data" }] }` para `PATCH /bulk`, `{ "ids": [...] }` para `POST /bulk/delete`. |
| `INVALID_CONFLICT_RULE` | 400 | A regra de conflito de um upsert (manter duplicatas ou substituir apenas em um `where`) foi enviada sem `upsert: true`, ou ambas as regras foram enviadas juntas. | Envie `upsert: true` e apenas uma das duas regras. |
| `INVALID_CONFLICT_TARGET` | 400 | O `on_conflict` / `onConflict` de um upsert especifica colunas sem garantia de unicidade, é enviado sem `upsert: true` ou é enviado em uma criação aninhada, onde uma linha correspondente mudaria para o novo pai. Caso contrário, o Postgres retornaria 42P10 dentro de uma transação que já realizou operações. O mesmo vale para qualquer upsert na tabela de autenticação, onde criação e atualização seguem regras distintas. | Declare `.unique()` na coluna ou um índice `unique`; a mensagem lista os alvos válidos. Na tabela de usuários, use `POST` para criar e `PATCH` para atualizar. |
| `INVALID_COUNT` | 400 | `?count=` não é `exact` nem `none`. Recusado em vez de assumir o padrão: um erro de digitação como `?count=nnone` cobraria o custo computacional da contagem que pretendia ignorar. | Envie `exact` (o padrão) ou `none`. Veja [Ignorando a contagem](/docs/backend/api/#skipping-the-count). |
| `INVALID_CURSOR` | 400 | O cursor `after` não pôde ser lido ou especifica um id de linha incompatível com as colunas-chave da tabela: foi truncado, recodificado ou criado manualmente. Um cursor legível enviado com um `orderBy` diferente daquele em que foi emitido resulta em `CURSOR_ORDER_MISMATCH`, também um 400. | Repasse `meta.nextCursor` da página anterior sem alterações, com o mesmo `orderBy` ou nenhum. Veja [Paginação](/docs/sdk/pagination/). |
| `INVALID_DELETED_PARAM` | 400 | `?deleted=` não é `include` nem `only`. Recusado em vez de ignorado: um erro de digitação `?deleted=true` que ocultasse silenciosamente linhas excluídas pareceria ter funcionado, mas responderia à pergunta oposta. | Envie `include` (ativas e excluídas) ou `only` (apenas excluídas). Omita para obter apenas linhas ativas. |
| `INVALID_DISTINCT` | 400 | `?distinct=` não é `true` nem `false`. | Envie um desses valores; `1` e `0` também são aceitos. |
| `INVALID_FIELD_OPERATION` | 400 | Um `$inc` / `$push` / `$pull` / `$merge` foi usado em um tipo de coluna no qual não está definido, com um operando no formato errado, com dois operadores no mesmo campo, com erro de digitação ou em uma criação — onde não há valor armazenado para operar. | Veja [Gravando via REST](/docs/backend/writes/#field-operations); a mensagem cita o campo. |
| `INVALID_FILTERED_WRITE` | 400 | Uma gravação filtrada teve como destino um caminho através de relação (`posts/1/comments`) ou nenhuma tabela. | Grave na tabela relacionada com um filtro no vínculo dela. |
| `INVALID_FILTER_FIELD` | 400 | O filtro especifica uma coluna inexistente nesta tabela. | Verifique a escrita do nome em relação à tabela. |
| `INVALID_FILTER_OPERATOR` | 400 | O operador não é aceito por este tipo de coluna — por exemplo, `like` em número ou data. | Veja [Consultando dados](/docs/sdk/querying/). |
| `INVALID_FILTER_VALUE` | 400 | Um valor de filtro não pôde ser convertido para o tipo da coluna com a qual foi comparado: `?id=eq.abc` em chave inteira, um valor fora do enum, timestamp inválido ou número fora do intervalo do tipo. `details.dbCode` traz o SQLSTATE. | Envie um valor compatível com o tipo da coluna. |
| `INVALID_HARD_PARAM` | 400 | `?hard=` não é `true` nem `false`. Qualquer outro valor é recusado em vez de interpretado como "não" — um erro de digitação que faça exclusão lógica quando o chamador pediu exclusão permanente dá a falsa impressão de que os dados foram apagados. | Envie `true` ou `false`. |
| `INVALID_INCLUDE` | 400 | `?include=` está malformado: lista de caminhos inválida ou objeto de opções por relação no formato incorreto. Um caminho aninhado além de três saltos resulta em `INCLUDE_TOO_DEEP`, também um 400. Validado na borda em vez de escapar do driver como 500. | Veja a mensagem; ela cita o caminho problemático. |
| `INVALID_INPUT` | 400 | O corpo da requisição falhou na validação. | Veja a mensagem. |
| `INVALID_LIMIT` | 400 | `?limit=` não é um número inteiro de 1 até o máximo (1000 por padrão); valores maiores são recusados, não limitados. Uma assinatura em tempo real solicitando um limite fora desse intervalo recebe o mesmo código em um frame `ERROR` do WebSocket. | Reduza o limite e pagine o restante. |
| `INVALID_LOGICAL_GROUP` | 400 | Um grupo `?or=` / `?and=` / `?not=` está malformado ou aninhado além da profundidade permitida. | Veja a mensagem; ela explica a regra de nivelamento (flattening). |
| `INVALID_OFFSET` | 400 | `?offset=` não é um número inteiro maior ou igual a 0. | Envie um inteiro não negativo. |
| `INVALID_ORDER_BY` | 400 | `?orderBy=` não é `field`, `field:desc`, `field:desc:last` nem um array JSON de `{ field, direction, nulls }` — ou especifica uma direção diferente de `asc`/`desc`, ou posicionamento de NULL diferente de `first`/`last`. | Veja a mensagem; ela lista todas as formas aceitas. |
| `INVALID_PAGE` | 400 | `?page=` não é um número inteiro maior ou igual a 1. Páginas são indexadas em 1, portanto `?page=0` é um erro, não a primeira página. | Envie `1` ou superior, ou use `?offset=`. |
| `INVALID_PARAM` | 400 | Um parâmetro de consulta está malformado. | Veja a mensagem. |
| `INVALID_QUERY_BODY` | 400 | O corpo de um `POST …/query` contém um valor que a URL não comportaria: uma lista para um parâmetro que a URL lê uma única vez (`fields`, `limit`, …), um objeto para um filtro, ou qualquer parâmetro presente na URL também — um `POST …/query` lê todos os parâmetros a partir do corpo. | Escreva cada valor da mesma forma que na URL — uma string, ou uma lista para filtros repetidos; `where`, `include`, `orderBy` e `vector` aceitam JSON. Veja [Consultas longas demais para uma URL](/docs/backend/vector-search/#queries-too-long-for-a-url). |
| `INVALID_VECTOR` | 400 | `?vector=` não é um array JSON de números. | Envie `[0.1,0.2,0.3]`. |
| `INVALID_VECTOR_DISTANCE` | 400 | `?vector_distance=` não é `cosine`, `l2` nem `inner_product`. | Use uma dessas três opções. |
| `INVALID_VECTOR_THRESHOLD` | 400 | `?vector_threshold=` não é um número. | Envie um número. |
| `INVALID_WHERE` | 400 | `?where=` não é um objeto JSON mapeando campos a condições. | Envie `{"status":["==","active"]}`. |
| `KEY_IMMUTABLE` | 400 | Uma atualização atribui à chave da linha um valor diferente daquele pelo qual ela é identificada — seja no corpo ou alterada por um `beforeSave`. Uma linha não pode mudar de chave: tudo após a gravação (a releitura, `afterSave`, histórico, tempo real) a referencia pela chave original. Recusado antes da execução de qualquer hook, sem nada gravado, em qualquer porta. `details.violations` cita o campo. | Crie a linha com a nova chave e exclua a atual. Enviar a chave que a linha já possui é permitido. |
| `MISSING_AGGREGATE_SELECT` | 400 | A rota de agregação foi chamada sem `?select=`. | Adicione o parâmetro, ex: `?select=count()`. |
| `NOT_A_MATERIALIZED_VIEW` | 400 | `refresh()` foi chamado em uma tabela que não corresponde a uma view materializada. | Atualize apenas views definidas com `defineView(…, { materialized: true })`. |
| `NO_TABLES` | 404 | <span class="since-badge" data-since="0.31">Desde 0.31</span> O projeto não disponibiliza tabelas: nenhuma declarada em `backend/schema` e nenhuma encontrada no banco de dados. Quando existem tabelas mas a segurança em nível de linha está desativada nelas, a mensagem indica quais são, trazendo o SQL para ativá-la, e `details.unprotectedTables` lista-as. Anteriormente `NO_COLLECTIONS`. | Crie tabelas — via migração, SQL ou um arquivo `defineTable` seguido de `rebase db push` — e reinicie. |
| `NOT_FOUND` | 404 | Nenhuma linha com esse id na tabela — ou linha oculta para este chamador pelas políticas de RLS. | Verifique o id e, em seguida, as regras de `rls` da tabela. |
| `UNKNOWN_RELATION` | 400 / 404 | `?include=` nomeia algo que não é uma relação na tabela. O mesmo código responde **404** quando um *caminho de URL* aninhado traz essa referência, ex: `/api/data/authors/1/posts` onde `authors` não declara essa relação — nesse caso a URL não aponta para nada, configurando "não encontrado" em vez de requisição malformada. | Verifique o nome da relação — a mensagem lista as disponíveis na tabela. Uma referência reversa precisa estar declarada no pai para ser percorrida. |
| `ORDER_BY_FIELD_NOT_SORTABLE` | 400 | A ordenação especifica um campo que não permite ordenação. | Ordene por uma coluna válida. |
| `PAGE_WITH_OFFSET` | 400 | `?page=` foi combinado com `?offset=` — ou `page` com `offset` em um `find()`, o que o SDK do cliente, o `rebase.data` em processo e o cliente offline recusam com o mesmo código antes de qualquer envio. Eles definem o mesmo intervalo, e anteriormente `page` prevalecia silenciosamente sobre um `offset` que o chamador nunca via aplicado. | Envie apenas um deles. |
| `PAYLOAD_TOO_LARGE` | 413 | O corpo excede o limite configurado. | Envie menos dados ou aumente o limite. |
| `READ_ONLY_TRANSACTION` | 409 | Um hook `afterRead` tentou realizar uma gravação. Uma leitura de requisição executa em uma transação `READ ONLY`, portanto nem o hook nem nada chamado por ele pode gravar. | Mova a gravação para fora da leitura: use uma tarefa em segundo plano ou `rebase.dataAsAdmin` a partir de um cron job ou função personalizada. |
| `REFRESH_NOT_SUPPORTED` | 501 | `POST /api/data/<slug>/refresh` atingiu um driver de dados sem suporte a views materializadas. | Nada a atualizar neste backend. |
| `RELATION_HAS_NO_PIVOT` | 400 | A gravação continha dados de relacionamento (link payload), mas o caminho não atinge o destino através de um `manyToMany` que declare um `pivot` — portanto, não há linha de junção para armazená-los. | Declare colunas de `pivot` na relação ou remova os dados extras da gravação. Veja [Relações](/docs/collections/relations/). |
| `RELATION_MISCONFIGURED` | 500 | Uma relação não pode ser resolvida no schema registrado. A operação é recusada em vez de ignorada: descartá-la reportaria sucesso para uma gravação que nunca ocorreu, ou traria resultado vazio para linhas existentes. | Execute `rebase schema generate` se o schema gerado estiver desatualizado em relação ao banco de dados. |
| `RELATION_NOT_UNLINKABLE` | 400 | A relação não pode ser desvinculada a partir deste lado. | Faça a operação a partir do lado proprietário da relação. |
| `RELATION_NOT_WRITABLE` | 400 | O caminho aninhado não é uma relação gravável, ou uma criação/atualização especifica uma relação `via` com múltiplos saltos — apenas relações `via` de salto único são graváveis. `details.fields` lista as chaves `via`. Nada foi gravado. | Grave diretamente nas tabelas unidas pela cadeia. Veja [Relações](/docs/collections/relations/#via--an-explicit-join-chain). |
| `RELATION_PIVOT_UNSUPPORTED` | 400 | A relação declara colunas na tabela de junção, mas esta fonte de dados não tem suporte para gravá-las. | O vínculo em si funciona; apenas os dados adicionais nele não são suportados. Verifique os recursos do driver. |
| `RELATION_SOURCE_KEY_EMPTY` | 400 | Uma gravação de relação não possuía uma chave de origem para vincular a relação. | Salve a linha pai primeiro. |
| `RESULT_TOO_LARGE` | — | Uma instrução enviada via `EXECUTE_SQL` no socket em tempo real — `admin.executeSql` de um cliente, leituras de catálogo no painel administrativo — retornou mais de 128 MB de linhas, portanto nenhum dado foi enviado. Entregue como um frame `ERROR` de WebSocket. As execuções no console SQL comum não são recusadas: elas exibem apenas as primeiras linhas. | Adicione um `LIMIT`, selecione menos colunas ou leia o resultado em partes. |
| `ROW_IN_TRASH` | 409 | A chave de um upsert pertence a uma linha na lixeira (uma linha com exclusão lógica ainda retém sua chave). Um upsert não grava em uma linha excluída, em nenhuma porta: REST `?on_conflict=`, upserts em `/bulk` e `/_batch`, no SDK e no socket em tempo real. Nada foi gravado. | Restaure a linha primeiro (uma atualização definindo o campo de exclusão lógica como `null`) ou purgue-a com `?hard=true` e faça o upsert novamente. Veja [Exclusão lógica](/docs/collections/soft-delete/). |
| `SCHEMA_DRIFT` | 500 | Uma tabela ou coluna esperada pelo código não existe no banco de dados. | Execute `rebase db push` em desenvolvimento; reimplante em um ambiente gerenciado. |
| `SCORE_CURSOR_UNSUPPORTED` | 400 | `startAfter` foi combinado com `orderBy: "_score"`. A relevância é calculada por consulta em vez de armazenada, portanto não pode servir de chave para um cursor. | Pagine os resultados por relevância com `limit`/`offset` ou ordene por uma coluna fixa. |
| `SQL_ERROR` | 400 | O banco de dados recusou o SQL escrito pelo usuário. No `EXECUTE_SQL` do socket em tempo real, trata-se de um frame `ERROR` com a mensagem do banco. `POST /api/admin/sql/csv` retorna este erro antes do envio de qualquer parte do arquivo: erro de sintaxe, tentativa de gravação (o download executa somente leitura), múltiplas instruções ou uso de role não permitida para a conexão. | Corrija o SQL. O download aceita apenas um `SELECT`, `WITH … SELECT`, `TABLE` ou `VALUES`. |
| `VIEW_NOT_READABLE` | 403 | Um chamador sem nenhuma das roles definidas em `view.roles` de uma view materializada tentou lê-la ou atualizá-la. Views materializadas não possuem segurança em nível de linha, sendo disponibilizadas integralmente apenas para essas roles. | Leia com uma das roles permitidas ou declare a role do chamador em `view.roles`. |
| `TENANT_IMMUTABLE` | 400 | A gravação moveria uma linha de um tenant para outro. Uma linha não pode mudar de tenant. `details.violations` cita o campo. Uma trigger aplica a mesma regra no banco de dados, portanto comandos SQL executados como o chamador falham com o erro `42501` do Postgres e mensagem iniciada por `TENANT_IMMUTABLE`. | Crie a linha no outro tenant e exclua a atual, ou grave utilizando uma role presente em `tenant.bypassRoles`. |
| `TENANT_MISMATCH` | 400 | A gravação especifica um tenant ao qual este chamador não pertence; o banco de dados também a recusaria. | Grave em um tenant pertencente ao chamador ou autentique-se como um membro dele. |
| `TENANT_REQUIRED` | 400 | A tabela possui escopo de tenant e o tenant não pôde ser inferido: a requisição não contém nenhum ou o chamador pertence a múltiplos tenants. | Envie o campo do tenant explicitamente ou autentique-se como um chamador vinculado a exatamente um tenant. |
| `TRANSACTION_ABORTED` | 500 | Uma instrução na transação de gravação falhou e um hook capturou o erro. O Postgres já havia abortado a transação, portanto a gravação foi revertida e nada foi persistido. Apenas criações, atualizações ou exclusões via `context.data` recusadas pelo banco são revertidas individualmente e seguras de capturar. | Deixe a falha lançar o erro ou faça verificações antes de executar a instrução. Veja [Semântica de transações](/docs/collections/context-data-api/#transaction-semantics). |
| `UNKNOWN_FIELD` | 400 | `?fields=` especifica um campo que a tabela não possui. | Verifique a ortografia; a mensagem lista os campos válidos. |
| `UNKNOWN_AGGREGATE_FIELD` | 400 | Um agregado ou `groupBy` especifica um campo que a tabela não possui. | Verifique a ortografia; a mensagem lista os campos válidos. |
| `UNKNOWN_FILTER_FIELD` | 400 | O filtro especifica um campo que esta tabela — ou o destino de uma relação — não possui, ou uma coluna `.private()`. | Verifique a ortografia; a mensagem lista os campos válidos. |
| `UNKNOWN_FILTER_OPERATOR` | 400 | O filtro especifica um operador inexistente. | A mensagem lista todos os operadores aceitos. |
| `UNKNOWN_MESSAGE_TYPE` | 400 | Um frame do socket em tempo real possui um `type` que o servidor não processa. Retornado como um frame `ERROR` contendo o `requestId` da requisição, para que ela finalize em vez de expirar por timeout. | Verifique o `type` do frame; a mensagem indica qual é. |
| `UNKNOWN_ORDER_BY_FIELD` | 400 | A ordenação especifica um campo que a tabela não possui. | Verifique a ortografia; a mensagem lista os campos válidos. |
| `PRECONDITION_FAILED` | 412 | O cabeçalho `If-Match` especificou uma versão da linha que não é mais a atual: alguém alterou o registro entre a leitura e esta gravação. Nada foi gravado. | Leia a linha novamente, reaplique a alteração e envie o novo `ETag`. |
| `UNKNOWN_RESPONSE_FIELD` | 400 | `?fields=` solicita um campo inexistente na tabela. | Verifique a ortografia; a mensagem lista os campos conhecidos. |
| `UNKNOWN_VECTOR_PROPERTY` | 400 | Uma busca vetorial indicou uma coluna que não é definida como `col.vector()` nesta tabela. | A mensagem lista as colunas vetoriais da tabela. |
| `UNSUPPORTED_MEDIA_TYPE` | 415 | O cabeçalho `Content-Type` não é aceito por esta rota. | Envie o tipo documentado para a rota. |
| `UNSUPPORTED_OPTION` | — | Lançado como exceção, não retornado como resposta: uma gravação através do acessador em processo (`context.data` em um hook, `rebase.data` em uma função ou cron) recebeu `ifMatch` ou `idempotencyKey`. Esse mecanismo não possui verificação de pré-condição ou controle de idempotência, portanto a opção é recusada antes de qualquer gravação em vez de ser ignorada. | Remova a opção nesse ponto ou faça a gravação através do cliente HTTP, que suporta ambas. |
| `UNSUPPORTED_RELATION_FILTER` | 400 | O filtro atravessa uma relação `via`, cujo caminho de junção é estruturado em apenas uma direção, não havendo como correlacionar uma subconsulta reversa. | Aplique o filtro a partir do lado proprietário. |
| `UNSUPPORTED_RELATION_FILTER_OPERATOR` | 400 | O operador não é suportado para esse campo: uma relação sem coluna física nesta linha é filtrada por pertinência, e correspondência de padrões (`like`, `ilike` e negações) aplica-se somente a texto. | Veja a mensagem; ela lista os tipos aceitos pelo campo. |
| `VALIDATION_CONSTRAINT` | 400 | Um valor violou uma regra declarada na coluna (`.validate()`, `.notNull()`, `.oneOf()`) — tamanho, intervalo, padrão, campo obrigatório ou valor fora da lista permitida. Cada item de `details.violations` traz um `code`: `required`, `min_length`, `max_length`, `length`, `min`, `max`, `less_than`, `more_than`, `positive`, `negative`, `integer`, `pattern`, `email`, `url`, `enum`, `min_items`, `max_items`, `unique_items` (array contém o mesmo item duas vezes, inclusive com `$push`), `unique_by` (dois itens de um array JSON compartilham o mesmo valor no campo indicado por `uniqueBy`), `date_min`, `date_max`, `geopoint_range`. | Veja a mensagem; ela cita a tabela, a coluna e cada violação. |
| `VALIDATION_EXCLUDED_FIELDS` | 400 | O corpo tenta gravar em uma coluna marcada como `.private()` ou `.access({ write: [] })` — a mesma regra, duas declarações possíveis. Esses campos são de controle exclusivo do servidor: hash de senha, token de verificação. Diferente de `FIELD_NOT_WRITABLE`, esta resposta é idêntica para qualquer chamador, incluindo `admin`. | Remova o campo. Veja [Acesso a campos](/docs/collections/field-access/). |
| `VALIDATION_INVALID_VALUE` | 400 | O valor não corresponde ao tipo da coluna. | Veja a mensagem; ela cita a coluna. |
| `VALIDATION_UNKNOWN_FIELDS` | 400 | O corpo nomeia um campo que a tabela não possui — incluindo o argumento `id` em uma tabela cuja chave primária é outro campo. | Verifique a ortografia; a mensagem ("Table 'x' has no column 'f'. Known columns: …") lista as colunas existentes. |
| `VECTOR_CURSOR_UNSUPPORTED` | 400 | Um cursor (`after` / `startAfter`) foi combinado com uma busca vetorial. As linhas são ordenadas por uma distância calculada a cada consulta, o que não pode servir de base para um cursor, logo uma listagem vetorial não retorna `nextCursor`. | Pagine os registros mais próximos utilizando `limit`/`offset`. |
| `WRITE_DENIED` | 403 | Uma regra de segurança ou política de segurança em nível de linha (RLS) recusou a gravação. | Verifique a configuração de `rls` da tabela. |

## `PG_<SQLSTATE>` — uma constraint que o banco de dados recusou

Uma gravação rejeitada pelo Postgres por um motivo referente aos *dados do chamador*
responde com o SQLSTATE no código: `PG_23505`, `PG_23503`, e assim por diante. Trata-se de
uma família, não de uma lista — o Postgres define centenas de SQLSTATEs —, mas apenas duas
classes chegam a esse formato, pois apenas essas duas são causadas pelo chamador:

- **classe 23**, violação de restrição de integridade: duplicatas, chave estrangeira
  apontando para registro inexistente, coluna NOT NULL deixada vazia;
- **classe 22**, exceção de dados: valor incompatível com o tipo suportado pela coluna.

Qualquer outro cenário — conexão perdida, coluna inexistente, problema de permissões —
é responsabilidade do servidor e retorna `500`. Assim, `code.startsWith("PG_")` é uma checagem segura
para "a linha enviada continha dados inválidos", e os quatro códigos abaixo são os que os clientes
de fato encontram. `details.dbCode` traz o mesmo SQLSTATE em todos os casos, e
a mensagem informa o nome da constraint.

| Código | Status | Significado | O que fazer |
| --- | --- | --- | --- |
| `PG_22P02` | 400 | Um valor não pôde ser interpretado no tipo da coluna — o equivalente de gravação para `INVALID_FILTER_VALUE`. | Envie um valor correspondente ao tipo da coluna. |
| `PG_23502` | 400 | Uma coluna `NOT NULL` foi deixada vazia. | Envie o campo ou defina um valor padrão para a coluna. |
| `PG_23503` | 400 / 409 | Na inserção/atualização, uma chave estrangeira aponta para uma linha inexistente (400). Na exclusão, outras linhas ainda referenciam este registro (409; chave com `RESTRICT` gera `PG_23001`, também 409). | Crie a linha referenciada primeiro ou corrija o id; para exclusão, remova ou aponte as linhas dependentes para outro registro primeiro. |
| `PG_23505` | 409 | Uma restrição de unicidade (unique constraint) foi violada. A mensagem informa o nome da restrição. | Use um valor diferente ou atualize a linha existente. |

## Storage

| Código | Status | Significado | O que fazer |
| --- | --- | --- | --- |
| `INVALID_LIST_OPTIONS` | 400 | O parâmetro `maxResults` de uma listagem de storage não é um inteiro maior ou igual a 1, ou seu `pageToken` não foi emitido pela fonte. Limites menores que 1 costumavam retornar uma página vazia com o mesmo token, gerando um loop infinito em chamadas `while (pageToken)`. | Envie um `maxResults` positivo e repasse `nextPageToken` sem alterações. |
| `INVALID_STORAGE_BUCKET` | 400 | O nome do bucket está malformado. | Verifique o nome. |
| `INVALID_STORAGE_KEY` | 400 | A chave do objeto está malformada, escapa do seu prefixo ou está sob um prefixo reservado (`_rebase/renditions/`, `_rebase/maintenance/`). | Verifique a chave. |
| `INVALID_TRANSFORM_OPTIONS` | 400 | Os parâmetros de transformação de imagem estão fora do intervalo ou são contraditórios. | Veja [Storage](/docs/backend/storage/). |
| `STORAGE_FILE_TOO_LARGE` | 413 | O upload excede o `maxBytes` declarado na coluna de destino `col.storage()`. Validado no servidor, não apenas no navegador. `details` traz a coluna, o limite e o tamanho real recebido. | Envie um arquivo menor ou aumente o `maxBytes` na coluna. |
| `STORAGE_FILE_TYPE_REFUSED` | 400 | O tipo do arquivo não consta na lista `accept` da coluna ou no `allowedMimeTypes` da própria fonte de storage. `details` traz a coluna (ou lista da fonte), os tipos aceitos e o content type enviado. | Envie um tipo permitido ou amplie `accept` / `allowedMimeTypes`. |
| `STORAGE_MISCONFIGURED` | 502 | O bucket S3 ou GCS configurado nesta fonte não existe, ou o provedor recusou as credenciais desta implantação. A mensagem informa o bucket; `details.reason` traz `NoSuchBucket` ou a recusa do provedor. Um bucket ausente costumava ser retornado genericamente como "arquivo não encontrado" para qualquer arquivo. | Corrija o nome do bucket (`S3_BUCKET` / `GCS_BUCKET`, `__<KEY>` para fontes nomeadas) ou as permissões das credenciais. |
| `STORAGE_NOT_CONFIGURED` | 501 / 503 | Nenhum backend de storage está configurado neste servidor, ou nenhum é o padrão e a requisição não especifica uma fonte; a mensagem lista as fontes atendidas (501). Um upload retomável cuja fonte foi removida antes da conclusão resulta em 503. | Configure S3, GCS ou storage local, ou indique a fonte com `?storageId=`. |
| `STORAGE_SAME_LOCATION` | 400 | `POST /api/admin/storage/move` com `deleteSource` (`rebase storage move --delete-source`) entre duas fontes que apontam para o mesmo bucket ou diretório. Todo arquivo seria considerado já presente no destino por ser o mesmo local físico, e deletar a cópia de origem apagaria a única existente. Nada foi movido ou excluído. | Aponte a coluna para a outra fonte; os arquivos já estão lá. |
| `STORAGE_SCAN_INCOMPLETE` | 409 | `DELETE /api/admin/storage/orphans` (`rebase storage orphans --delete`) não pôde ler todas as tabelas, portanto um arquivo referenciado por elas poderia parecer não utilizado. Com `?scan=`, a varredura indicada foi a que falhou na leitura completa. Nada foi excluído; `details.unscanned` cita cada tabela e a razão da falha. | Corrija o que impede a leitura dessas tabelas e execute novamente. |
| `STORAGE_SCAN_NOT_FOUND` | 404 | `GET /api/admin/storage/orphans/scans/:id` ou `DELETE /api/admin/storage/orphans?scan=:id` especifica uma varredura inexistente na fonte. Varreduras são mantidas por 7 dias na fonte examinada, logo um `storageId` diferente do utilizado na varredura também não encontrará registros. | Passe o `storageId` da varredura ou inicie uma nova. |
| `STORAGE_SCAN_NOT_COMPLETE` | 409 | `DELETE /api/admin/storage/orphans?scan=:id` especifica uma varredura que ainda está com status `queued`, `running` ou que resultou em `failed`. Nada foi excluído; `details.status` informa o estado atual. | Aguarde a conclusão da varredura ou inicie uma nova. |
| `STORAGE_SCAN_EXPIRED` | 409 | `DELETE /api/admin/storage/orphans?scan=:id` especifica uma varredura concluída há mais de 15 minutos. Nada foi excluído. | Inicie uma nova varredura e exclua a partir dela. |
| `STORAGE_SCAN_DELETION_STARTED` | 409 | `DELETE /api/admin/storage/orphans?scan=:id` especifica uma varredura cujos arquivos órfãos já estão em processo de exclusão. | Consulte o status de `deletion` da varredura via `GET /api/admin/storage/orphans/scans/:id`. |
| `STORAGE_SOURCE_NOT_CONFIGURED` | 501 | A fonte de storage está declarada, mas não possui credenciais configuradas neste ambiente. | Defina as variáveis de ambiente necessárias para essa fonte. |
| `STORAGE_WRITE_FAILED` | 502 | O backend de storage recusou ou interrompeu a gravação. | Verifique os logs e credenciais do próprio serviço de storage. |
| `TRANSFORM_OVERLOADED` | 503 | Há muitas transformações de imagem sendo processadas simultaneamente. | Tente novamente; avalie colocar uma CDN à frente. |
| `UNKNOWN_STORAGE_SOURCE` | 400 / 404 | A requisição especificou uma fonte de storage (`?storageId=`) não declarada neste projeto. Um `bucket` não atendido por esta implantação retorna o mesmo código com status **404** (em listagens, uploads normais, pastas ou uploads retomáveis para S3 ou GCS) — o storage em si é o que está ausente, e `details` informa os buckets e fontes existentes. Ambos costumavam retornar "arquivo não encontrado", idêntico a uma chave simplesmente inexistente. | Declare a fonte em `config/resources.ts` ou consulte `GET /api/storage/sources`. |
| `UPLOAD_LOCKED` | 423 | O `PATCH` de um upload retomável chegou enquanto outro bloco do mesmo upload ainda estava sendo processado — quase sempre causado por um cliente tentando reenviar o bloco em andamento. A requisição é recusada em vez de enfileirada, seguindo o padrão do tusd. | Consulte o offset com `HEAD /api/storage/tus/:id` e retome a partir dali; a biblioteca tus-js-client lida com recuo e novas tentativas automaticamente. Veja [Uploads retomáveis (TUS)](/docs/backend/storage-resumable-uploads/). |

## Funções personalizadas

| Código | Status | Significado | O que fazer |
| --- | --- | --- | --- |
| `FUNCTION_NOT_FOUND` | 404 | Nenhuma função com esse nome está disponível — ou ela existe, mas suas rotas internas não contemplam o caminho subsequente. Um chamador autenticado é informado sobre quais rotas *estão* disponíveis; um anônimo não recebe essa lista, pois ela expõe o inventário dos endpoints personalizados. Se um arquivo correspondente falhou ao carregar, o log informa isso ao chamador autenticado citando o arquivo: essa é a diferença entre erro de digitação e falha de deploy. Um chamador anônimo recebe apenas a resposta simples de função inexistente. | Verifique o nome com `GET /api/functions` ou consulte o log de boot para identificar arquivos que falharam ao carregar. |
| `FUNCTION_TIMEOUT` | 504 | O manipulador (handler) excedeu o tempo limite. Ele continua em execução em segundo plano; não pode ser cancelado a partir deste ponto. | Configure um `AbortSignal` em chamadas externas ou aumente `REBASE_FUNCTIONS_TIMEOUT_MS`. |
| `FUNCTIONS_UPSTREAM_UNREACHABLE` | 502 | Este processo atua como proxy de funções para outro processo, que não respondeu. | Verifique se a unidade responsável pelas funções está em execução. |

## Cron jobs

| Código | Status | Significado | O que fazer |
| --- | --- | --- | --- |
| `CRON_JOB_ALREADY_EXECUTING` | 409 | Disparo manual de um cron job que já está em execução — no processo que respondeu ou em outro detentor da concessão de execução (lease), como um worker executando atrás de um processo de `api`. Nada foi executado. O cancelamento é registrado no histórico da tarefa, e `details.log` traz essa entrada, indicando o processo em execução. | Tente novamente quando a execução atual for finalizada. Veja [Cron Jobs](/docs/backend/cron-across-instances/#concurrency-guarding). |

## Telas administrativas e edição de schema

Estes códigos indicam que um recurso está desativado ou não configurado, e não que a requisição
estava errada. Cada um também é reportado na rota `/status` correspondente com status `200`,
permitindo que painéis desabilitem visualmente a funcionalidade em vez de exibir um erro.

| Código | Status | Significado | O que fazer |
| --- | --- | --- | --- |
| `ADMIN_SURFACE_UNAVAILABLE` | 501 | Uma interface exclusiva de administração foi acessada em um servidor sem autenticação configurada, tornando impossível distinguir um administrador de qualquer outro usuário. | Configure `auth.jwtSecret` ou informe um `AuthAdapter`. |
| `BRANCH_DIFF_STALE` | 409 | `POST /api/admin/branches/:name/merge` recebeu a impressão digital (fingerprint) de um diff desatualizado: a branch ou a branch principal mudaram nesse intervalo. Nada foi gravado. | Obtenha o diff novamente, revise as alterações e faça o merge usando o novo `fingerprint`. |
| `BRANCH_DIFF_UNSUPPORTED` | 501 | A fonte de dados não tem capacidade de comparar branches: não possui SQL ou suporte a branches (sem conexão administrativa). | Utilize um backend Postgres com `adminConnectionString` configurada. |
| `BRANCH_MERGE_BLOCKED` | 409 | Uma tabela divergente não pode ser mesclada — adicionada ou removida na branch, colunas ou chave primária diferentes, ausência de chave primária, volume de linhas excessivo para conferência individual ou reescrita após a criação da branch (`TABLE_REWRITTEN`). Uma tabela cujas linhas não puderam ser comparadas bloqueia o processo mesmo que a contagem aponte 0: trata-se de contagem desconhecida, não zero. `details.tables` lista cada tabela e a razão. Nada foi gravado. | Aplique o schema utilizando suas migrações primeiro, ou execute o merge com `skipBlocked: true` para ignorar essas tabelas. |
| `BRANCH_MERGE_CONFLICT` | 409 | As mesmas linhas foram alteradas tanto na branch quanto na branch principal, com `onConflict` definido como `"abort"` (padrão); ou a branch principal rejeitou parte do merge — linha alterada concorrentemente, bloqueio por trigger, política ocultando dados. Nada foi gravado. | Escolha o lado prioritário com `onConflict: "branch"` ou `"target"`, ou gere o diff novamente. |
| `BRANCH_MERGE_FAILED` | 409 | A branch principal recusou as linhas da branch durante a execução do merge — violação de restrição, valor de enum inválido ou quebra de chave estrangeira existente no destino, geralmente decorrente de schemas incompatíveis. `details` traz `sqlState`, `table`, `constraint` e `detail`. Nada foi gravado. | Verifique as alterações de schema no diff, alinhe o schema da branch principal com suas migrações ou corrija os dados da branch antes de tentar novamente. |
| `BRANCH_NOT_FOUND` | 404 | Nenhuma branch com esse nome foi encontrada no registro. | Consulte as branches existentes via `rebase db branch list` ou no painel de Branches. |
| `CONTRACT_UNAVAILABLE` | 404 | O contrato do projeto só é disponibilizado quando a autenticação está configurada — ele descreve detalhadamente tabelas e relações. | Configure a autenticação. `/meta/schema-version` é sempre disponibilizado. |
| `DEV_MAILBOX_UNAVAILABLE` | 501 | Nenhuma caixa de e-mails de desenvolvimento está ativa. E-mails só são capturados localmente se `SMTP_HOST` não estiver definido e `NODE_ENV` for diferente de production. | Remova a definição de `SMTP_HOST` em desenvolvimento ou consulte a caixa de entrada real configurada. |
| `DOCS_UNAVAILABLE` | 404 | <span class="since-badge" data-since="0.31">Desde 0.31</span> `GET /api/docs` é disponibilizado apenas para quem tem acesso às tabelas via `GET /api/schema/tables`, e este servidor não tem autenticação configurada, logo não há destinatários autorizados. | Configure autenticação ou publique a documentação completa para todos com `enableSwagger: true` (`REBASE_ENABLE_SWAGGER=true`). |
| `INVALID_CHANGE` | 400 | A alteração de schema proposta está malformada. | Veja a mensagem. |
| `SCHEMA_CHANGE_FAILED` | 400 | A aplicação de uma mudança planejada no schema falhou por um motivo não coberto por códigos mais específicos. | Veja a mensagem; ela traz o erro original na íntegra. |
| `SCHEMA_CHANGE_UNAPPLICABLE` | 400 | A alteração é válida, mas incompatível com o estado atual do schema. | Veja a mensagem. |
| `SCHEMA_EDIT_DIRTY_TREE` | 409 | O repositório contém alterações locais não commitadas, impedindo a aplicação segura da edição. | Faça commit ou guarde no stash antes de tentar novamente. |
| `SCHEMA_EDIT_REFUSED` | 400 | O editor de schema recusou a alteração: o trecho modificado usa construções de código não manipuladas por ele (spreads, funções auxiliares, chaves computadas) ou a operação não é permitida pelo editor (renomear tabelas, remover a última regra). `details.problems` cita cada caso. Nada foi gravado. | Veja a mensagem. Realize a alteração manualmente em `backend/schema`. |
| `SCHEMA_EDIT_DOES_NOT_COMPILE` | 400 | <span class="since-badge" data-since="0.31">Desde 0.31</span> A alteração pode ser feita, mas o schema resultante falharia na compilação — uma relação apontando para tabela excluída, uma regra citando coluna removida. `details.problems` traz os diagnósticos do compilador, identificando tabela e coluna. Nada foi gravado. | Altere as tabelas dependentes primeiro ou faça o ajuste manualmente em `backend/schema`. |
| `SCHEMA_EDIT_STALE_FILE` | 409 | Um arquivo a ser alterado foi modificado no disco após a preparação da edição (salvo por uma IDE, outro processo). Nada foi gravado. | Recarregue os arquivos e refaça a edição com base no conteúdo atualizado. |
| `SCHEMA_EDIT_REQUIRES_A_PERSON` | 403 | Uma chave de API ou outro processo automatizado tentou aplicar alterações no schema. | Autentique-se como usuário humano ou configure `liveSchema.allowMachineApply`. |
| `SCHEMA_EDITING_NO_COLLECTIONS_DIR` | 501 | A edição em tempo real de schema exige `schemaDir` (o diretório `backend/schema`) ou `liveSchema.repository`, e o servidor não foi iniciado com nenhum dos dois. O código preserva o nome original por retrocompatibilidade. | Configure ao menos uma dessas opções. |
| `SCHEMA_EDITING_NO_REPOSITORY` | 503 | O planejamento funciona, mas não há repositório para commitar a alteração — como implantações rodando bundles gerados ou servidores onde `backend/schema` não está sob controle git (toda aplicação exige commit). | Execute `git init` no projeto e reinicie o servidor (o repositório é detectado no boot), ou defina `liveSchema.repository`. |
| `SCHEMA_EDITING_PROVISIONING_OFF` | 409 | Esta implantação não aplica alterações estruturais no banco (`REBASE_PROVISION=false`), impossibilitando a aplicação a partir do painel. | Faça o commit apenas no código-fonte e delegue a atualização do banco ao processo responsável. |
| `SCHEMA_EDITING_UNSUPPORTED` | 503 | Este driver não tem capacidade de planejar alterações de schema. | A edição de schema em tempo real está disponível para Postgres. |
| `SCHEMA_EDITOR_BAAS_MODE` | 501 | As tabelas são inspecionadas diretamente do banco neste ambiente, portanto não há arquivos-fonte para edição. | Altere o schema através de migrações. |
| `SCHEMA_EDITOR_DISABLED` | 501 | O editor de schema está desativado neste servidor. Bundles pré-compilados sempre respondem com este código. | Ative-o configurando `schemaEditor`. Em bundles, configure `REBASE_LIVE_SCHEMA_REPOSITORY` para editar `backend/schema` através de repositório — veja [Edição dinâmica de schema](/docs/backend/live-schema-editing#from-a-built-bundle). |
| `SCHEMA_EDITOR_MISSING_DEPENDENCY` | 501 | O editor de schema precisa da biblioteca `ts-morph`, que não está instalada. | Instale-a no pacote que executa o backend e reinicie: `pnpm --dir backend add -D ts-morph@28.0.0` da raiz do projeto, ou `pnpm add -D ts-morph@28.0.0` caso o backend seja a raiz. A mensagem especifica o comando exato para o seu ambiente. |
| `SCHEMA_EDITOR_NO_COLLECTIONS_DIR` | 501 | O servidor não possui `schemaDir` definido, deixando o editor sem destino para gravação. O código preserva o nome original. | Defina `schemaDir`. |
| `SCHEMA_EDITOR_PRODUCTION` | 501 | O editor permanece desativado sob `NODE_ENV=production`: arquivos em produção são reconstruídos a partir do repositório a cada deploy, portanto edições locais seriam descartadas. | Edite `backend/schema` em ambiente de desenvolvimento e implante, ou configure `liveSchema.repository` para commitar diretamente no repositório. |
| `SCHEMA_UNAVAILABLE` | 404 | <span class="since-badge" data-since="0.31">Desde 0.31</span> `GET /api/schema/tables` em backend sem autenticação configurada: não há identidade de chamador para aplicar filtros de visibilidade nas tabelas, e `auth.requireAuth: false` não altera esse comportamento. | Configure um adapter de autenticação ou `auth.jwtSecret`. Veja [Endpoints](/docs/backend/endpoints/#schema). |
| `TABLE_NOT_FOUND` | 404 | <span class="since-badge" data-since="0.31">Desde 0.31</span> `GET /api/schema/tables/:slug` indica uma tabela inacessível para este chamador — inexistente com esse slug ou fora do alcance dos escopos de sua credencial. | Verifique o slug e os escopos `data:*` da credencial. |
| `UI_PREFERENCES_NEED_A_PERSON` | 403 | <span class="since-badge" data-since="0.31">Desde 0.31</span> `/api/admin/ui-config` foi chamado com chave de API, token de plataforma ou chave de serviço. Preferências de interface pertencem a uma pessoa autenticada. | Faça login como usuário. |
| `UI_PREFERENCES_TOO_LARGE` | 413 | <span class="since-badge" data-since="0.31">Desde 0.31</span> As preferências de interface de uma tabela excederam 64 KB. | Reduza o tamanho salvo: preferências devem conter apenas definições visuais, não dados. |
| `UI_PREFERENCES_UNSUPPORTED` | 501 | <span class="since-badge" data-since="0.31">Desde 0.31</span> O driver deste backend não suporta execução SQL, logo não armazena preferências de interface; o painel as mantém localmente no navegador. | Nada a corrigir: configurações permanecem salvas por navegador. |
| `UI_CONFIG_FILE_INVALID` | 500 | <span class="since-badge" data-since="0.31">Desde 0.31</span> O arquivo `frontend/src/cms/ui-config.json`, que armazena as preferências de interface do workspace em desenvolvimento, não é um JSON válido. | Corrija ou exclua o arquivo; o painel o recriará na próxima operação de salvamento. |
| `SQL_EXPORT_UNSUPPORTED` | 501 | `POST /api/admin/sql/csv` não pode transmitir resultados via streaming neste ambiente: o banco embutido de desenvolvimento (PGlite) aceita apenas uma conexão, e reter um cursor durante um download bloquearia todas as outras requisições; ou a fonte de dados não suporta cursores SQL. | Aponte `DATABASE_URL` para uma instância dedicada do Postgres (`rebase dev --docker` inicia uma) ou limite os dados com `LIMIT` exportando o conteúdo em tela. |

### Reconciliação de schema

<span class="since-badge" data-since="0.31">Desde 0.31</span>

[`rebase schema reconcile`](/docs/cli/schema/#rebase-schema-reconcile) gera o plano
via `POST /api/admin/schema/reconcile/plan` e aplica via
`/reconcile/apply`. Uma recusa não altera o estado do sistema; apenas `SCHEMA_RECONCILE_FAILED`
deixa partes do plano aplicadas.

| Código | Status | Significado | O que fazer |
| --- | --- | --- | --- |
| `INVALID_RECONCILE` | 400 | O corpo não é um objeto JSON ou `drop` não é uma lista de strings no formato `"<table>.<column>"`. | Envie `{ "drop": ["voice_cache.wav"] }` ou omita o campo `drop`. |
| `SCHEMA_RECONCILE_FAILED` | 400 | Uma instrução falhou durante o processo. As instruções anteriores foram concluídas e permanecem ativas; `details.applied` lista-as. | Corrija o problema apontado na mensagem e gere um novo plano: ele omitirá o que já foi aplicado. |
| `SCHEMA_RECONCILE_INVALID` | 400 | O plano não pode ser aplicado; a mensagem detalha o motivo: um `drop` fora do padrão `<table>.<column>`, apontando para tabela/coluna inexistente ou indicando coluna ainda declarada no código. `details.plan` contém o plano. | Ajuste a lista em `drop`. Para remover uma coluna declarada, remova-a de `defineTable`, faça o deploy e depois execute a reconciliação. |
| `SCHEMA_RECONCILE_STALE` | 409 | O banco de dados ou as tabelas foram modificados após a geração do plano confirmado. `details.plan` traz a nova versão. | Revise o novo plano e confirme utilizando seu `digest`. |
| `SCHEMA_RECONCILE_UNCONFIRMED` | 400 | `/reconcile/apply` foi chamado sem o campo `confirm`. | Crie o plano primeiro e envie o `digest` do plano no parâmetro `confirm`. O CLI faz isso automaticamente ao digitar `yes`. |
| `SCHEMA_RECONCILE_UNSUPPORTED` | 503 | O driver deste backend não oferece suporte a planejamento de reconciliação ou não suporta SQL. | A reconciliação funciona em ambientes Postgres. |

### Por que a tabela de uma branch não pode sofrer merge

`BRANCH_MERGE_BLOCKED` cita cada tabela recusada em `details.tables`, acompanhada de um
destes códigos. O mesmo código é adicionado ao campo `blocked` da tabela no próprio diff,
permitindo que o Studio avise o usuário antes do clique em **Merge**. Nenhum deles é retornado como resposta isolada.

| Código | Status | Significado | O que fazer |
| --- | --- | --- | --- |
| `COLUMNS_DIFFER` | — | As colunas da tabela diferem entre a branch e a branch principal. Linhas só são comparadas com base nas colunas compartilhadas. | Adicione as colunas faltantes na branch principal via migrações (`rebase db push`) e faça o merge. Migrações estruturais profundas — como mudança de tipo de coluna — transformam a condição em `TABLE_REWRITTEN`: faça o merge antes dessas alterações, ou recrie a branch após aplicá-las. |
| `NO_PRIMARY_KEY` | — | A tabela não tem chave primária, impedindo a comparação linha a linha; o diff exibe apenas o total de linhas. | Crie uma chave primária na tabela ou transfira os registros manualmente. |
| `PRIMARY_KEY_DIFFERS` | — | As colunas que compõem a chave primária ou seus tipos diferem entre os ambientes. | Aplique o schema na branch principal primeiro. |
| `TABLE_ADDED` | — | A tabela foi criada exclusivamente na branch. Merges nunca criam tabelas novas. | Crie a tabela na branch principal através de migrações e depois faça o merge dos dados. |
| `TABLE_DROPPED` | — | A tabela foi excluída na branch. Merges nunca removem tabelas existentes. | Remova a tabela utilizando migrações. |
| `TABLE_REWRITTEN` | — | Um dos lados reescreveu todas as linhas da tabela após a criação da branch — alteração de tipo de coluna, `ADD COLUMN` com default volátil, `VACUUM FULL`, `CLUSTER` —, fazendo com que todos os registros pareçam modificados e impossibilitando determinar a autoria de cada alteração. | Faça o merge da branch antes dessa migração, ou recrie a branch a partir da principal depois dela. |
| `TOO_LARGE` | — | A tabela contém mais linhas em um dos lados do que o limite permitido para comparação individual no diff (100.000 por padrão, `maxRowsPerTable`). | Aumente `maxRowsPerTable` tanto no diff quanto no merge, ou migre os registros por outro meio. |

## Códigos genéricos

Uma rota utiliza um destes códigos quando nenhuma condição mais específica for atendida.

| Código | Status | Significado | O que fazer |
| --- | --- | --- | --- |
| `BAD_REQUEST` | 400 | Requisição malformada, sem código específico aplicável. | Veja a mensagem. |
| `UNAUTHORIZED` | 401 | Não autenticado ou a credencial foi rejeitada. | Faça login ou renove as credenciais. |
| `FORBIDDEN` | 403 | Autenticado, mas sem permissão de acesso. | Tentar novamente com a mesma identidade não resolverá. |
| `CONFLICT` | 409 | Conflito com o estado atual do recurso. | Veja a mensagem. |
| `INTERNAL_ERROR` | 500 | Falha interna no servidor. A mensagem é intencionalmente genérica. | Forneça o `requestId` ao suporte; a causa detalhada estará nos logs. |
| `NOT_CONFIGURED` | 503 | Uma dependência necessária para esta rota não está configurada neste servidor. | Veja a mensagem. |
| `SERVICE_UNAVAILABLE` | 503 | Um serviço externo necessário não pôde ser alcançado: bucket S3 ou MinIO, ou host chamado via `fetch()` em uma função que recusou a conexão ou falhou no DNS. O log do servidor especifica o host; a resposta HTTP não. Banco de dados inacessível retorna `DATABASE_UNAVAILABLE`. Falhas de conexão com esses serviços respondem com este código. | Tente novamente; verifique os logs do servidor. |

## Mantendo esta página atualizada

O comando `pnpm verify:docs` falha se algum código emitido pelo servidor estiver ausente nestas
tabelas, se uma tabela listar um código que nunca é emitido, se os status de uma linha não
corresponderem exatamente aos que o código-fonte emite, ou se uma família de códigos como `PG_<SQLSTATE>` não tiver uma linha
para um SQLSTATE que os clientes possam encontrar. A verificação é realizada por
`tooling/scripts/docs-verify/check-error-codes.mjs`.

O script faz uma auto-verificação inicial. A análise extrai códigos diretamente do código TypeScript em vez de
consultar um servidor em execução, logo pontos cegos seriam silenciosos por definição: anteriormente o script
não detectava códigos retornados através de wrappers de uma linha, ou definidos após mensagens contendo `)`,
e atestava erroneamente que "todos os códigos do servidor estão documentados" em uma página que omitia dezessete deles.
Por essa razão, o verificador executa uma fixture contendo exatamente essas variações antes de analisar esta página,
recusando-se a validar caso não consiga identificá-las corretamente.
