---
sourceHash: ccf1ed328b50de1a
title: Códigos de erro
sidebar_label: Códigos de erro
description: Todos os códigos de erro que um backend Rebase pode retornar, com seu status HTTP, o que significam e o que fazer a respeito — além do envelope de resposta, X-Request-ID e as regras de detalhes.
---

Toda falha retornada por um backend Rebase usa um envelope e carrega um
`code` estável. O código é a base para o tratamento condicional: a mensagem é escrita para
uma pessoa e pode ser reformulada, o status é compartilhado por uma
dúzia de problemas diferentes, e o código não é nenhum dos dois.

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
- **`code`** — um dos valores abaixo. Estável entre versões secundárias (minor).
- **`details`** — opcional e nunca garantido. Veja as regras abaixo.
- **`requestId`** — presente sempre que a requisição passou pelo middleware de ID de requisição,
  o que abrange todas as rotas sob `basePath`.

### `X-Request-ID`

Toda requisição sob `basePath` recebe um ID: o cabeçalho `X-Request-ID` do chamador
quando este for um UUID, caso contrário, um novo. Ele é retornado na
resposta como `X-Request-ID`, incluído no envelope de erro como `requestId` e
anexado à linha de log do servidor para aquela requisição.

Essa é a chave de correlação. Cite-o em um relatório de bug e um operador poderá encontrar a
linha de log exata que explica a falha, trazendo o motivo que nunca foi
exibido ao cliente.

Enviar o seu próprio é a forma como um rastreamento sobrevive a um salto (hop): um gateway ou executor de jobs que
encaminha o cabeçalho obtém um único ID em todos os serviços que processaram a requisição.
Um valor inválido é ignorado em vez de rejeitado — não vale a pena
falhar uma requisição por causa de um cabeçalho malformado enviado pelo chamador —, portanto, não presuma que o ID enviado é
o ID recebido. Leia o cabeçalho da resposta.

### O que há em `details`

`details` é diagnóstico, não contratual. Três regras o regem:

1. **Tudo o que uma rota define explicitamente é sempre retornado.** Esses são os
   próprios erros do chamador descritos com precisão: qual campo de filtro era desconhecido,
   qual relação não permite escrita, qual valor não coube no seu tipo.
2. **Diagnósticos do banco de dados são omitidos em produção.** Quando a falha tiver origem
   no Postgres, `details.dbCode` — o SQLSTATE — estará sempre presente: ele nomeia
   a classe do problema e não revela nada sobre os dados. `dbMessage`,
   `detail` e `hint` são adicionados apenas quando `NODE_ENV` não for `production`,
   pois o Postgres inclui o conteúdo das linhas neles. `23505` relata
   `Key (email)=(a@b.c) already exists.`, o que responde "esta pessoa está
   cadastrada?" para qualquer endereço que alguém tente testar.
3. **Nunca crie lógica condicional baseada em `details`.** Baseie-se no `code`. O que está em `details` é
   o que foi considerado útil para uma pessoa naquele ponto de chamada, e isso muda.

## Interpretando um status

| Status | O que diz sobre a requisição |
| --- | --- |
| `400` | Malformada ou solicitando algo que não existe no schema. Corrija a requisição. |
| `401` | Não autenticado ou a credencial expirou. Faça login ou renove. |
| `403` | Autenticado, mas não permitido. Tentar novamente com a mesma identidade não ajudará. |
| `404` | Rota, tabela ou linha inexistente — ou uma linha que a segurança em nível de linha (RLS) oculta. |
| `409` | Um conflito com o estado existente: uma duplicata ou uma escrita concorrente. |
| `413` `415` `422` | O corpo é muito grande, o tipo de mídia está errado ou foi rejeitado semanticamente. |
| `429` | Limite de taxa atingido (rate limited). Aguarde; a mensagem informa por quanto tempo. |
| `500` | O servidor ou o banco de dados está com problemas, não o chamador. Verifique os logs. |
| `501` | A rota existe, mas esta implantação não pode atendê-la — um recurso desativado ou não configurado. |
| `502` `503` `504` | Uma dependência estava inacessível, não configurada ou muito lenta. |

## Autenticação e contas

<span class="since-badge" data-since="0.31">Desde 0.31</span>

| Código | Status | Significado | O que fazer |
| --- | --- | --- | --- |
| `AAL2_REQUIRED` | 403 | A rota requer um segundo fator e a sessão possui apenas um. | Complete o desafio de MFA e tente novamente. |
| `ALREADY_VERIFIED` | 400 | O endereço ou fator já foi verificado. | Nada — o estado desejado já é verdadeiro. |
| `ACCOUNT_OUTRANKS_CALLER` | 403 | A conta que está sendo editada, redefinida ou excluída possui uma role ou escopo que o chamador não tem. `details.beyond` lista-os. | Peça a alguém que os possua para fazer a alteração. |
| `ANONYMOUS_AUTH_DISABLED` | 403 | O login anônimo está desativado neste servidor. | Ative-o ou faça login com uma identidade real. |
| `ANONYMOUS_NOT_ALLOWED` | 403 | Uma sessão de convidado tentou aprovar um login de dispositivo. Um convidado não tem uma conta para associar a um dispositivo. | Faça login com uma conta e depois aprove-o. |
| `API_KEY_SELF_MANAGEMENT_FORBIDDEN` | 403 | Uma chave de API tentou listar, criar, alterar ou revogar chaves de API, sejam do seu próprio tipo ou pessoais. | Gerencie chaves como uma pessoa com permissão `keys:write` ou com a chave de serviço. |
| `AUTH_MIDDLEWARE_MISSING` | 500 | Uma rota protegida foi executada sem nenhum middleware de autenticação Rebase antes dela, portanto, a credencial do chamador nunca foi verificada. | Monte a aplicação através do roteador de funções em vez de montá-la diretamente no seu próprio servidor. |
| `BOOTSTRAP_ANONYMOUS` | 403 | O bootstrap do primeiro administrador foi tentado por um chamador anônimo. | Faça login primeiro. |
| `BOOTSTRAP_COMPLETED` | 403 | O primeiro administrador já existe. | Peça a um administrador existente para conceder a role. |
| `BOOTSTRAP_NOT_FIRST_USER` | 403 | O bootstrap é apenas para o primeiro usuário absoluto, e este não é ele. | Peça a um administrador existente para conceder a role. |
| `CAPTCHA_FAILED` | 400 | O provedor rejeitou o token do CAPTCHA. | Resolva um novo desafio. |
| `CAPTCHA_REQUIRED` | 400 | A rota requer um token CAPTCHA e nenhum foi enviado. | Inclua o token. |
| `CHALLENGE_EXHAUSTED` | 401 | Tentativas incorretas em excesso para um mesmo desafio de MFA. | Inicie um novo desafio. |
| `DEVICE_LOGIN_DECIDED` | 409 | O login do dispositivo já foi aprovado ou negado. Um login é decidido apenas uma vez. | Inicie um novo login no dispositivo. |
| `DEVICE_LOGIN_EXPIRED` | 410 | O login do dispositivo ultrapassou os seus dez minutos antes de ser decidido. | Inicie um novo login no dispositivo. |
| `DEVICE_LOGIN_NOT_FOUND` | 404 | Nenhum login de dispositivo possui esse código de usuário. A própria sondagem (poll) do dispositivo responde aos códigos em minúsculas da RFC 8628: `authorization_pending`, `slow_down`, `access_denied`, `expired_token`, `invalid_grant`. | Verifique o código comparando com o exibido no dispositivo. |
| `EMAIL_EXISTS` | 409 | Já existe uma conta com esse endereço — no cadastro, na alteração de endereço ou ao seguir um link de alteração de endereço quando outra conta utilizou o endereço enquanto este aguardava. | Faça login ou inicie uma redefinição de senha; para uma alteração de endereço, escolha outro endereço. |
| `EMAIL_NOT_CONFIGURED` | 503 | Magic links ou OTP foram solicitados e o servidor não possui transporte de e-mail. | Configure o SMTP ou use outro método de login. |
| `EMAIL_NOT_VERIFIED` | 403 | Um login OAuth encontrou uma conta com o mesmo endereço, mas o provedor não verificou esse endereço, então ele não foi vinculado. | Faça login com o método existente e execute `POST /auth/link/<provider>`. |
| `FACTOR_NOT_VERIFIED` | 400 | O fator MFA foi cadastrado, mas nunca confirmado. | Confirme o fator. |
| `IDENTITY_ALREADY_LINKED` | 409 | Essa identidade OAuth pertence a outra conta. | Faça login com ela ou desvincule-a de lá primeiro. |
| `IMPERSONATION_FORBIDDEN` | 403 | Uma requisição enviou `x-rebase-impersonate` e o chamador não tem permissão para executar uma requisição como outro usuário. Apenas a sessão de um administrador autenticado pode fazer isso, nunca uma chave de API ou a chave de serviço. | Envie a requisição com uma sessão de administrador ou remova o cabeçalho. |
| `IMPERSONATION_INVALID` | 400 | O cabeçalho `x-rebase-impersonate` foi enviado vazio. | Envie o uid do usuário a ser personificado ou remova o cabeçalho. |
| `IMPERSONATION_TARGET_NOT_FOUND` | 404 | O cabeçalho `x-rebase-impersonate` não indica nenhum usuário ativo: nenhuma conta tem esse uid ou ela está desativada. | Verifique o uid. |
| `IMPERSONATION_UNAVAILABLE` | 501 | A autenticação deste backend não pode executar uma requisição como outro usuário porque seu `AuthAdapter` não possui `resolveUser`. | Implemente `resolveUser` no adapter ou remova o cabeçalho. |
| `IMPERSONATION_UNSUPPORTED` | 400 | O cabeçalho `x-rebase-impersonate` foi enviado para uma rota que não oferece suporte a personificação. Apenas a API de dados e funções customizadas aceitam isso, e o socket em tempo real aceita `impersonate` em `AUTHENTICATE`. | Envie a requisição sem o cabeçalho. |
| `SIMULATION_FORBIDDEN` | 403 | Uma requisição enviou um cabeçalho `x-rebase-simulate-*` (o simulador de RLS) ou chamou `/api/admin/rls-simulator`, e o chamador não pode simular acesso. Apenas a sessão de um administrador autenticado pode fazer isso, nunca uma chave de API ou a chave de serviço. | Envie a requisição com a sessão de um administrador ou remova os cabeçalhos. |
| `SIMULATION_INVALID` | 400 | A simulação foi malformada: um cabeçalho enviado vazio, `x-rebase-simulate-api-key-id` combinado com uma role ou id de usuário, ou simulação combinada com `x-rebase-impersonate`. | Especifique uma role (opcionalmente com um uid), um id de usuário ou um id de chave de API. |
| `SIMULATION_READ_ONLY` | 403 | Uma operação de escrita, exclusão, `_batch`, reversão de histórico ou uma função customizada chamada por qualquer verbo diferente de `GET`/`HEAD`/`OPTIONS` continha um cabeçalho `x-rebase-simulate-*`. O acesso simulado é somente leitura: a escrita seria executada como a identidade simulada, não como o administrador. Leituras, incluindo `POST …/query` e `…/count`, continuam funcionando. | Interrompa a simulação para fazer alterações. |
| `SIMULATION_TARGET_NOT_FOUND` | 404 | A simulação não indica nenhum usuário ativo (um id de usuário enviado sem role) ou nenhuma chave de API ativa. | Verifique o id ou envie uma role junto com o uid para simular um uid que não possui conta. |
| `SIMULATION_UNAVAILABLE` | 501 | Este backend não pode simular acesso: seu `AuthAdapter` não possui `resolveUser` para confirmar um administrador, ou uma chave foi informada em um backend sem chaves de API. | Implemente `resolveUser` ou remova os cabeçalhos. |
| `SIMULATION_UNSUPPORTED` | 400 | Um cabeçalho `x-rebase-simulate-*` foi enviado para uma rota que não suporta acesso simulado. Apenas a API de dados e funções customizadas aceitam esses cabeçalhos. | Envie a requisição sem os cabeçalhos. |
| `GUEST_REFERENCED` | 409 | Um convidado não pôde ser excluído porque uma linha do próprio projeto depende dele, por meio de uma chave estrangeira com `ON DELETE RESTRICT` ou `NO ACTION`. O endpoint `DELETE /api/admin/guests` relata isso por convidado em `skipped` e continua. | Exclua a linha ou mantenha o convidado. |
| `INVALID_ACCOUNT` | 400 | A conta está em um estado no qual esta operação não pode atuar. | Veja a mensagem. |
| `INVALID_CHALLENGE` | 400 | O desafio de MFA é desconhecido ou expirou. | Inicie um novo desafio. |
| `INVALID_CODE` | 400 / 401 | O código OTP ou MFA está incorreto: 400 no login com código por e-mail (`/auth/otp/verify`), 401 no cadastro ou desafio de MFA. | Tente novamente com o código atual. |
| `INVALID_CREDENTIALS` | 401 | E-mail ou senha incorretos — deliberadamente sem especificar qual deles. | Tente novamente ou redefina a senha. |
| `INVALID_PLATFORM_TOKEN` | 401 | Um token de plataforma `rpt_` foi recusado: assinatura inválida, audience incorreta, expirado ou vida útil acima do limite. A mensagem especifica o motivo. | Solicite à plataforma a emissão de um novo token — no Rebase Cloud, execute o comando novamente. |
| `INVALID_SCOPES` | 400 | Uma chave solicitou algo que não é um escopo: malformado, desconhecido ou com um alvo que o escopo não aceita. `details.problems` especifica qual e por quê; `details.validScopes` lista os escopos que uma chave pode possuir. Não inclui `keys:read` e `keys:write`, que nenhuma chave pode possuir. | Use um nome da lista. Veja [Roles e escopos](/docs/backend/roles-and-scopes/). |
| `INVALID_TOKEN` | 400 / 401 | Um token de verificação, redefinição, magic link ou alteração de endereço está malformado, desconhecido, já utilizado ou expirado (400). Uma credencial de provedor OAuth ou um token de atualização que não seja verificado retorna 401. | Solicite um novo link ou faça login novamente. |
| `INVALID_USER_CODE` | 400 | O que foi enviado como código de login do dispositivo não é válido: deve ter oito letras, como `BCDF-GHJK`. | Copie o código exibido no dispositivo. |
| `INVALID_ROLE` | 400 | Um nome de role gravado não é uma string, está vazio ou contém `,` `{` `}` `"` `\` ou um caractere de controle. Esses caracteres seriam lidos de volta como outras roles: uma role trafega em um `text[]` do Postgres e na lista separada por vírgulas dividida pelas políticas de RLS, logo `"support,admin"` seria lido como `admin`. `details.problems` nomeia cada uma. | Renomeie a role. Qualquer outro nome é aceito. |
| `KEY_MANAGEMENT_SCOPE` | 400 | Uma chave solicitou `keys:read` ou `keys:write`. Nenhuma chave pode gerenciar chaves. `details.scopes` lista-as. | Remova-as. |
| `KEY_OUTRANKS_CALLER` | 403 | Um detentor de `keys:write` tentou alterar ou revogar uma chave de serviço que possui uma role ou escopo que ele não possui. Apenas um admin gerencia qualquer chave. `details.roles` e `details.scopes` indicam o que a chave possui além do chamador. | Peça a um admin, ou a alguém que os possua, para alterar a chave. |
| `LAST_ADMIN` | 403 | A alteração deixaria o projeto sem nenhum administrador. | Promova outra pessoa primeiro. |
| `MFA_REQUIRED` | 401 | A senha estava correta e a conta possui um segundo fator verificado, portanto o login foi concluído apenas pela metade. `details` traz um token de curta duração com escopo restrito ao desafio de MFA — não é uma sessão. | Abra um desafio e responda a ele; a resposta ao desafio emite a sessão. |
| `NO_SESSION` | 401 | Nenhum cookie de sessão ou refresh token foi apresentado. Normal no primeiro carregamento de página. | Faça login. |
| `NOT_ANONYMOUS` | 400 | Uma rota de upgrade de anônimo foi chamada por uma conta real, ou `DELETE /api/admin/guests/:uid` indicou uma conta real. | Nada para atualizar. Para excluir uma conta, use `DELETE /api/admin/users/:uid`. |
| `OAUTH_ERROR` | 401 | O provedor OAuth recusou ou retornou um erro. | Tente o fluxo novamente; a mensagem contém o motivo informado pelo provedor. |
| `PERSONAL_KEYS_DISABLED` | 403 | Chaves de API pessoais estão desativadas neste backend. | Defina `personalKeys: true` nas opções de `auth` da tabela de autenticação (`defineAuthTable`). |
| `PERSONAL_KEY_NEEDS_ACCOUNT` | 403 | A chave de serviço ou uma sessão de convidado tentou usar as rotas de chave pessoal. Nenhuma delas possui uma conta para a qual a chave possa atuar. | Faça login em uma conta ou crie uma chave de serviço em `/api/admin/api-keys`. |
| `PLATFORM_TOKENS_OFF` | 401 | Um token de plataforma `rpt_` alcançou um servidor que não os aceita: `REBASE_PLATFORM_TOKEN_KEY` e `REBASE_PLATFORM_TOKEN_AUDIENCE` não estão definidos. | A plataforma que hospeda a aplicação define ambos no deploy; faça um novo deploy ou entre na aplicação de outra forma. |
| `RATE_LIMITED` | 429 | Tentativas excessivas a partir deste chamador. | Aguarde; a mensagem diz por quanto tempo. |
| `REDIRECT_URI_NOT_ALLOWED` | 400 | O destino do redirecionamento não está na lista de permissões. | Adicione-o à configuração do provedor. |
| `REGISTRATION_DISABLED` | 403 | O autocadastro está desativado. | Peça a um administrador para criar a conta. |
| `ROLE_EXCEEDS_CALLER` | 403 | As roles concedidas contêm um escopo, ou `admin`, que o chamador não possui. `details.beyond` lista-os. | Peça a alguém que os possua para conceder a role. |
| `ROLE_EXCEEDS_CREATOR` | 403 | Uma chave de serviço recebeu uma role de RLS que seu criador não possui. Apenas um admin pode conceder qualquer role. `details.roles` lista-as. | Remova a role ou peça a um admin para criar a chave. |
| `ROLE_EXISTS` | 409 | Esse nome de role já está em uso. | Escolha outro nome. |
| `ROLE_LOOKUP_FAILED` | 503 | Não foi possível ler as roles do chamador — em uma rota de admin ou em uma requisição de dados em um backend com `config.auth`. Fecha o acesso por segurança (fails closed) em vez de confiar nas roles contidas no token. Um token cujo uid não indica nenhuma conta, incluindo um uid que a tabela de usuários não suporta, retorna 401, e não este código. Um banco de dados inacessível resulta em `DATABASE_UNAVAILABLE`, e não neste código. | Tente novamente; verifique o banco de dados. |
| `SCOPE_EXCEEDS_CREATOR` | 403 | Uma chave solicitou um escopo que seu criador não possui. Uma chave nunca tem mais permissões que a conta que a cria. `details.scopes` lista-os. | Remova-os ou peça a alguém que os possua para criar a chave. |
| `SCOPE_MISSING` | 403 | A credencial não possui o escopo necessário para esta rota, tabela, fonte de armazenamento ou função. `details.requiredScope` especifica o escopo, incluindo o alvo. | Para uma pessoa, requer uma role que declare o escopo. Para uma chave, uma chave que o possua. Veja [Roles e escopos](/docs/backend/roles-and-scopes/). |
| `SCOPE_NOT_DECLARED` | 500 | Uma rota protegida com `requireScope` especifica um escopo de aplicação que este backend não declara, portanto ninguém o possui, nem mesmo um administrador. Um nome que não seja um escopo ou um escopo embutido digitado errado, como `data:raed`, nunca chega até aqui: `requireScope` lança um erro no registro da rota. | Declare o escopo sob `auth.scopes` na tabela de autenticação ou corrija o nome. Veja [Roles e escopos](/docs/backend/roles-and-scopes/). |
| `SELF_DELETE` | 400 | Um admin tentou excluir sua própria conta. | Peça a outro admin para fazer isso. |
| `SESSION_REVOKED` | 401 | A sessão foi encerrada em outro lugar, todas as sessões foram revogadas ou a conta foi excluída. Todas as portas de entrada que aceitam uma sessão retornam este erro para tal token de acesso: a API de dados, armazenamento, funções customizadas e as rotas de admin. O socket em tempo real recusa o `AUTHENTICATE` com um frame `AUTH_ERROR` contendo este mesmo código. O SDK tenta renovar, a renovação é recusada e ele faz logout. | Faça login novamente. |
| `ACCOUNT_DISABLED` | 401/403 | Um administrador desativou a conta: o login (403), a renovação e todos os tokens que ela possui (401) são recusados em todas as portas que aceitam uma sessão. O socket em tempo real recusa o `AUTHENTICATE` com um frame `AUTH_ERROR` com o mesmo código. | Contate um administrador. |
| `EMAIL_NOT_CONFIRMED` | 403 | `requireEmailVerification` está ativado e o endereço ainda não foi verificado. Retornado apenas para senhas corretas; um novo link é enviado por e-mail. | Siga o link enviado no e-mail. |
| `PROOF_REQUIRED` | 409 | `POST /auth/verify-email`: a conta possui uma senha ou identidade que ninguém comprovou, e a requisição não comprova nenhuma das duas. O token não é consumido. | Envie `password` para mantê-la ou `removeUnproven: true` para verificar sem ela. |
| `UNDELIVERABLE_ADDRESS` | 400 / 409 | Foi solicitado um e-mail de verificação para um endereço inacessível — de um convidado ou o placeholder do X (400) — ou uma conta solicitou mudar para tal endereço (409, `POST /auth/change-email`). | Defina um endereço real primeiro. |
| `EMAIL_UNCHANGED` | 400 | `POST /auth/change-email` informou o endereço atual da conta. | Nada a alterar. |
| `ANONYMOUS_USER` | 403 | Um convidado solicitou a alteração de seu endereço de e-mail; um convidado não possui e-mail próprio. | Converta-o em uma conta primeiro (`POST /auth/anonymous/link`). |
| `MFA_NOT_ENROLLED` | 400 | Códigos de recuperação foram solicitados para uma conta sem nenhum segundo fator verificado. | Cadastre um fator primeiro. |
| `HOOK_REJECTED` | 400 | Um hook `beforeUserCreate`, `beforeLogin`, `beforeUserDelete` ou `beforeEmailChange` lançou um erro. A mensagem é a do hook; um hook que selecionou um status 4xx responde com ele. | Veja a mensagem. |
| `INVALID_JSON` | 400 | O corpo da requisição não é um JSON válido. | Envie um corpo em JSON. |
| `SELF_DISABLE` | 400 | Um administrador tentou desativar sua própria conta. | Peça a outro administrador. |
| `NOT_SUPPORTED` | 501 | O repositório de autenticação deste backend não suporta a operação solicitada (desativar contas, alterar endereço). | Reinicie o servidor para que a coluna seja adicionada ou use um repositório compatível. |
| `UNKNOWN_SCOPE_TARGET` | 400 | O alvo de um escopo indica uma tabela, fonte de armazenamento ou função que este backend não atende. `details` lista as que estão disponíveis. | Corrija o alvo. |
| `UNVERIFIED_IDENTITIES` | 409 | Um magic link, código por e-mail ou redefinição de senha comprovou o endereço de uma conta não verificada, e a conta carrega uma identidade de login cujo provedor nunca verificou esse endereço. O repositório de autenticação não pode removê-la (não possui `unlinkUserIdentity`), então a comprovação é recusada para não deixar essa brecha em uma conta verificada. | Implemente `unlinkUserIdentity` no repositório customizado de auth ou peça a um admin para revisar a conta. |
| `SETUP_REQUIRED` | 403 | O projeto ainda não tem nenhum administrador, portanto esta rota não está disponível. | Conclua a configuração do primeiro administrador. |
| `TOKEN_ALREADY_USED` | 401 | Um token de uso único foi reutilizado, ou um token de atualização foi reutilizado após ser rotacionado há mais tempo que `refreshTokenReuseIntervalSeconds`. | Solicite um novo ou faça login novamente. |
| `TOKEN_EXPIRED` | 401 | O token ultrapassou seu tempo de validade. | Solicite um novo. |
| `USER_NOT_FOUND` | 404 | Nenhuma conta encontrada com esse id. | Verifique o id. |
| `WEAK_PASSWORD` | 400 | A senha não atende à [política de senhas](/docs/backend/auth-endpoints/#password-policy) (por padrão, mais de 8 caracteres com uma letra maiúscula, uma minúscula e um dígito) — no cadastro, na redefinição ou alteração, ou na definição de senha por um administrador: `POST /api/admin/users`, criação na tabela de auth via API de dados, `PUT /api/admin/users/:id` ou `POST /api/admin/users/:id/reset-password`. | Escolha uma senha mais forte. Um administrador importando contas pode enviar `skipPasswordPolicy: true` na criação. |

## Dados, consultas e escritas

| Código | Status | Significado | O que fazer |
| --- | --- | --- | --- |
| `AGGREGATE_MASKED_BY_AFTER_READ` | 400 | Uma agregação diferente de `count()` sem `groupBy` em uma tabela que um hook `afterRead` reescreve (global, na tabela ou no `.transform()` de uma coluna). Uma agregação lê os valores armazenados e nunca executa o hook, portanto uma soma, mínimo, máximo, contagem de campo ou agrupamento leria o que o hook oculta. | Use `count()` sem `groupBy` ou leia as linhas, que passam pelo hook. |
| `AGGREGATE_NOT_SUPPORTED` | 501 | Este driver não consegue calcular a agregação solicitada. | Use um driver compatível ou calcule no cliente. |
| `BRANCHING_UNSUPPORTED` | — | Uma branch de banco de dados foi solicitada via WebSocket do Studio no banco de dados de desenvolvimento gerenciado (PGlite), onde uma branch *é* o próprio pai e nada seria isolado. A recusa é a mesma que `rebase db branch` imprime. | Aponte `DATABASE_URL` para o seu próprio Postgres (`rebase dev --docker` inicia um) e crie branches lá. |
| `BATCH_TOO_LARGE` | 400 | `POST /api/data/_batch` contém mais operações do que o limite por lote (1000 por padrão). Um lote é uma única transação e mantém seus bloqueios durante toda a sua duração. | Envie em partes; a mensagem informa o limite e a sua quantidade. |
| `BATCH_UNSUPPORTED` | 400 | O driver deste backend não consegue realizar escritas atômicas entre tabelas, e um loop de escritas individuais não seria atômico nem uma única viagem de ida e volta (round trip). | Envie as escritas como requisições separadas ou como chamadas `/bulk` por tabela. |
| `BULK_TOO_LARGE` | 400 | O corpo da requisição em massa excede o limite configurado de itens. | Divida a requisição. |
| `BULK_UNSUPPORTED` | 400 | Esta tabela ou driver não oferece suporte a escritas em massa. | Grave as linhas uma por vez. |
| `CALLBACK_REJECTED` | 400 / 403 | Um hook de tabela recusou a escrita. Um `throw` em `beforeSave`/`beforeDelete`/`after*` é um 400 trazendo a mensagem definida pelo autor; um `beforeDelete` que retorna `false` é um 403. `details.stage` indica qual hook, `details.path` a tabela. | Leia a mensagem — ela foi escrita por este projeto, não pelo Rebase. |
| `CALLBACK_RECURSION` | 500 | As escritas iniciadas por hooks aninharam-se com mais de 16 níveis de profundidade: a escrita via `context.data` de um hook executa os hooks daquela tabela novamente, e nada na cadeia interrompe o ciclo — geralmente um `afterSave` que atualiza incondicionalmente sua própria linha. Toda a escrita foi revertida (rollback). A mensagem indica o hook e a tabela; `details.chain` lista cada etapa hook → escrita. | Torne a escrita do hook condicional: atue apenas em `status === "new"`, ou ignore quando `values` já contiver o que seria escrito. |
| `TABLE_READ_ONLY` | 405 | <span class="since-badge" data-since="0.31">Desde 0.31</span> Uma escrita atingiu uma view (`defineView`). Uma view é somente leitura. Anteriormente `COLLECTION_READ_ONLY`. | Escreva nas tabelas que a view lê. Veja [Views](/docs/collections/views/). |
| `TABLE_WITHHELD` | 503 | <span class="since-badge" data-since="0.31">Desde 0.31</span> A tabela está declarada, mas o banco de dados não a protege: o RLS está desativado, nenhuma das políticas declaradas está presente ou uma política restritiva declarada está ausente. (Uma política permissiva ausente é atendida, com um aviso de inicialização citando-a.) Isso acontece quando o servidor não provisiona suas tabelas (`REBASE_PROVISION=false`, `provisionSchema: false`, `provision.tables: false`, `REBASE_MIGRATE_ON_BOOT=none`), e o servidor retém a tabela em vez de servir todas as linhas para qualquer chamador. Uma junção muitos-para-muitos segue a mesma regra: quando falha, as tabelas cujas relações a utilizam são retidas e a mensagem indica a junção. As outras tabelas continuam sendo servidas. O log de inicialização informa os comandos que a protegem. | Aplique os comandos informados no log de inicialização (`rebase db push` faz isso) e reinicie. |
| `SQL_NOT_ALLOWED` | 400 | O comando SQL executado como o chamador (`getSql(c)`, `withAuth(user).sql`) não era uma única instrução `SELECT`, `WITH`, `VALUES`, `TABLE`, `INSERT`, `UPDATE`, `DELETE` ou `MERGE`, ou chamou `set_config` ou citou `pg_settings`. A identidade do chamador fica nas configurações de sessão, portanto qualquer instrução que possa alterá-las é recusada. | Mantenha o texto da consulta próprio, uma única instrução, com todos os valores em `params`. Veja [Funções customizadas](/docs/backend/custom-functions/#3-getsqlc--sql-as-the-caller). |
| `CURSOR_WITH_OFFSET` | 400 | `?after=` foi combinado com `?offset=` ou `?page=`. Um cursor já especifica onde a página começa, portanto, aplicar um offset sobre ele pula silenciosamente essa quantidade de linhas além do cursor — uma lacuna que o chamador não consegue ver na resposta. | Use um ou outro. |
| `DISTINCT_NOT_APPLICABLE` | 400 | `?distinct=true` foi combinado com uma busca textual ou consulta vetorial. Ambas atribuem uma pontuação (score) por linha, logo duas linhas nunca são iguais e o `DISTINCT` não agruparia nada — pareceria ter funcionado, mas sem alterar nada. | Remova um dos dois. |
| `DISTINCT_ORDER_BY_NOT_SELECTED` | 400 | Uma leitura com `distinct` está ordenada por uma coluna que ela não retorna. Um `SELECT DISTINCT` só pode ser ordenado por colunas presentes em sua lista de seleção, senão as linhas colapsadas não possuem ordem definida. `details.fields` lista-as. | Adicione esses campos a `?fields=` ou remova-os de `?orderBy=`. |
| `DATABASE_UNAVAILABLE` | 503 | O banco de dados não pôde ser alcançado: a conexão foi recusada ou perdida, o host não resolveu, o servidor está iniciando ou desligando, ou o banco de dados está fechado para novas conexões (`ALLOW_CONNECTIONS false`, deixado na origem quando um `rebase db branch create --force` é interrompido no meio; o log do servidor indica o banco de dados, e `rebase db branch list` o abre novamente). Todas as portas retornam este erro, incluindo login, rotas de admin e o socket em tempo real (um frame `ERROR`). Enviado com `Retry-After: 5`. | Tente novamente; o SDK faz isso automaticamente. Verifique se o banco de dados está rodando e acessível a partir do servidor. |
| `DB_CONNECTIONS_EXHAUSTED` | 503 | O servidor de banco de dados recusou uma nova conexão por esgotamento de conexões disponíveis (`53300` clientes em excesso, `53400` limite de conexão de uma role ou do banco de dados). Cada instância do servidor compartilha o `max_connections` do servidor, portanto isso ocorre quando várias instâncias usam pools grandes sem um pooler. Trata-se de carga, não de falha; enviado com `Retry-After: 2`. O servidor registra o remédio nos logs uma vez por minuto. | Tente novamente; o SDK faz isso. Reduza `DB_POOL_MAX` (ou limite com `REBASE_DB_POOL_MAX`) entre as instâncias, coloque um pooler na frente do banco (`DATABASE_POOLED`) ou aumente `max_connections`. |
| `DB_CONNECT_TIMEOUT` | 503 | Abrir uma nova conexão com o banco de dados demorou mais que `DB_POOL_CONNECT_TIMEOUT`: o banco está lento para aceitar conexões ou muito distante. Enviado com `Retry-After`. | Tente novamente; o SDK faz isso. Verifique a carga do banco de dados e a rede até ele. |
| `DB_PERMISSION_DENIED` | 500 | O Postgres recusou a instrução (`42501`): seja por uma política de RLS negando a role ou por falta de `GRANT`. | Veja [Solução de problemas](/docs/troubleshooting/). |
| `DB_POOL_EXHAUSTED` | 503 | Todas as conexões do pool permaneceram ocupadas durante `DB_POOL_CONNECT_TIMEOUT`, logo esta requisição nunca alcançou o banco de dados. Trata-se de carga, não falha; enviado com `Retry-After`. O servidor registra o remédio nos logs uma vez por minuto. | Tente novamente; o SDK faz isso. Aumente `DB_POOL_MAX` ou encontre as consultas lentas ou transações longas que estão retendo as conexões. |
| `FIELD_NOT_READABLE` | 400 | Um filtro, `orderBy`, `fields`, `select` agregado ou `groupBy` especifica um campo que as roles deste chamador não podem ler (`access.read`), um caminho aninhado ou ordenação agregada cita uma relação que ele não pode ler — ou uma operação de campo (`$inc`, `$push`, …) atinge um deles, onde um limite recusado revelaria o valor armazenado. Um campo que nenhuma resposta pode trazer deve ser um que nenhuma consulta consiga interrogar, senão o valor seria legível predicado por predicado. Um filtro através de uma relação (`author.salary`) e uma ordenação agregada sobre o campo de uma relação (`max(staff.salary)`) são avaliados pela regra do alvo. `details.violations` cita cada campo. O driver aplica a mesma regra a uma leitura feita em processo em nome do chamador (`context.data` sob o escopo do chamador) e a uma busca vetorial, inclusão ou verificação de unicidade. Uma coluna `.private()` responde como se não existisse: um filtro, `orderBy`, `fields`, `include`, `select` agregado, `groupBy` ou `vector_search` apontando para ela recebe exatamente a mesma resposta dada a um nome incorreto (`UNKNOWN_FILTER_FIELD`, `UNKNOWN_ORDER_BY_FIELD`, `UNKNOWN_FIELD`, `UNKNOWN_RELATION`, `UNKNOWN_AGGREGATE_FIELD` ou `UNKNOWN_VECTOR_PROPERTY`), e nenhuma resposta de campo desconhecido a listará. | Remova o campo da consulta ou obtenha a role necessária. Veja [Acesso a campos](/docs/collections/field-access/). |
| `FIELD_NOT_WRITABLE` | 400 / 403 | O corpo define um campo que as roles deste chamador não podem escrever (`access.write`). Recusado em vez de descartado: uma escrita que descarta um campo reportaria sucesso para uma edição que não ocorreu. O mesmo código recusa uma escrita através de um pai que define uma relação que o chamador não pode escrever, e uma atualização que define um campo `softDelete` para um valor — somente a exclusão o define. O socket em tempo real responde 403 com este código para uma escrita através de um caminho aninhado cuja tabela pai, relação ou tabela de destino não seja atendida lá, em vez de repassá-la ao driver sem julgamento. `details.violations` cita cada campo. | Remova o campo ou obtenha a role. Um campo que ninguém pode escrever responde `VALIDATION_EXCLUDED_FIELDS`. |
| `FILTERED_USER_WRITE` | 400 | Uma atualização ou exclusão filtrada foi enviada para a tabela de autenticação via HTTP, cujas escritas são verificadas usuário por usuário antes de serem executadas. | Leia os usuários e execute `updateMany`/`deleteMany` neles por id. |
| `FILTER_REQUIRED` | 400 | Uma escrita filtrada (uma atualização ou exclusão por `where`/`logical`, vinda do SDK ou das rotas bulk) não possui condição, o que afetaria todas as linhas. Recusada antes de qualquer execução. | Adicione uma condição. Para alterar todas as linhas de propósito, defina uma condição que todas as linhas atendam. |
| `HISTORY_UNAVAILABLE` | 503 | Uma escrita em uma tabela com `history: true` foi recusada porque o registro de histórico não pôde ser gravado: o banco não possui a tabela `rebase.entity_history` ou, para `openRebase` e `rebase console`, a função `rebase.record_history`. Nenhum backend com histórico foi iniciado neste banco de dados. Nada foi executado, hooks inclusos, e leituras não são afetadas. Lançado por `openRebase` e retornado por um backend criado com `provision: false`. | Inicie o backend uma vez com o histórico ativado e `provision: true` (`rebase dev` faz isso) e tente novamente. |
| `HISTORY_UNSERVABLE` | 501 | <span class="since-badge" data-since="0.31">Desde 0.31</span> O driver de dados da tabela não consegue executar as regras de leitura e hooks `afterRead` sobre as linhas armazenadas (`DataDriver.serveStoredRows`), e o histórico nunca é servido sem máscara. O driver Postgres integrado consegue. | Implemente `serveStoredRows` no driver customizado. Veja [Histórico](/docs/backend/history/). |
| `IDEMPOTENCY_KEY_IN_PROGRESS` | 409 | Uma requisição anterior com a mesma `Idempotency-Key` ainda está em execução. | Tente novamente quando ela terminar. |
| `IDEMPOTENCY_KEY_REUSED` | 422 | A mesma `Idempotency-Key` chegou em uma requisição diferente: outro método, caminho, query string ou corpo. | Use uma nova chave ou envie a requisição original. |
| `INVALID_AGGREGATE_FUNCTION` | 400 | `?select=` indicou uma função que não é de agregação (`count`, `sum`, `avg`, `min`, `max`, `countDistinct`, `mode`, `percentile`, `distinct`, `fingerprint`). | Use uma dessas opções; a mensagem lista todas elas. |
| `INVALID_AGGREGATE_GROUP` | 400 | Uma transformação `groupBy` é desconhecida ou não se aplica à coluna: `year`/`month`/`day` em uma coluna que não é data, `unnest` em uma que não é array. | Use `lower`, `upper`, `year`, `month`, `day` ou `unnest` em uma coluna do tipo apropriado. |
| `INVALID_AGGREGATE_SELECT` | 400 | Uma entrada em `?select=` não está no formato `fn(field)`; uma função diferente de `count()` ou `fingerprint()` foi chamada sem campo; `percentile` não possui uma fração de 0 a 1; ou `fingerprint()` foi chamada em uma view simples, que não armazena linhas. | Escreva `sum(total)`, `count()`, `percentile(price,0.95)`. |
| `INVALID_AGGREGATE_WINDOW` | 400 | Uso de `offset`, `page` ou `orderBy` em uma agregação sem `groupBy`, ou um cursor em qualquer agregação. Uma agregação sem agrupamento retorna uma única linha, e um grupo não é uma linha sobre a qual um cursor possa continuar. | Adicione `groupBy` ou remova-os; pagine grupos com `offset` ou `page`. Veja [Agregações](/docs/sdk/aggregates-and-search/#aggregates). |
| `INVALID_BATCH_BODY` | 400 | Uma operação em `/_batch` não contém `op`, `table`, `values` ou `id`, indica uma tabela que este backend não atende ou reutiliza um nome de `ref`. | Veja a mensagem; ela indica a operação pelo índice. |
| `INVALID_BATCH_REF` | 400 | Um `{ "$ref": "<name>.<field>" }` não indica uma operação anterior, aponta para a frente ou solicita um campo que a linha referenciada não tem. Apenas referências para trás são resolvidas. | Dê um nome à operação com `ref` *antes* de referenciá-la. |
| `INVALID_BULK_BODY` | 400 | O corpo da requisição bulk não está no formato esperado. | Envie o array que a rota espera: `{ "rows": [...] }` para `POST /bulk`, `{ "updates": [{ "id", "data" }] }` para `PATCH /bulk`, `{ "ids": [...] }` para `POST /bulk/delete`. |
| `INVALID_CONFLICT_RULE` | 400 | A regra de conflito de um upsert (manter duplicatas ou substituir apenas com base em um `where`) foi enviada sem `upsert: true`, ou ambas as regras foram enviadas juntas. | Envie `upsert: true` e apenas uma das duas. |
| `INVALID_CONFLICT_TARGET` | 400 | O `on_conflict` / `onConflict` de um upsert indica colunas que não garantem unicidade, indica-as sem `upsert: true`, ou é enviado em uma criação aninhada, onde uma linha correspondente seria movida para o novo pai. Caso contrário, o Postgres responderia 42P10 de dentro de uma transação que já realizou trabalho. Também ocorre em qualquer upsert na tabela de autenticação, onde a criação e a atualização seguem regras distintas. | Declare `.unique()` na coluna ou um índice `unique`; a mensagem lista os alvos existentes. Na tabela de usuários, envie `POST` para criar e `PATCH` para atualizar. |
| `INVALID_COUNT` | 400 | `?count=` não é `exact` nem `none`. Recusado em vez de assumir o padrão: um `?count=nnone` digitado errado executaria a contagem que foi escrito para evitar. | Envie `exact` (o padrão) ou `none`. Veja [Ignorando a contagem](/docs/backend/api/#skipping-the-count). |
| `INVALID_CURSOR` | 400 | O cursor `after` não pode ser lido ou indica um id de linha incompatível com as colunas-chave da tabela: foi truncado, recodificado ou construído manualmente. Um cursor legível enviado com um `orderBy` diferente daquele sob o qual foi emitido resulta em `CURSOR_ORDER_MISMATCH`, também um 400. | Repasse o `meta.nextCursor` da página anterior sem alterações, com o mesmo `orderBy` ou nenhum. Veja [Paginação](/docs/sdk/pagination/). |
| `INVALID_DELETED_PARAM` | 400 | `?deleted=` não é `include` nem `only`. Recusado em vez de ignorado: um `?deleted=true` digitado errado que ocultasse silenciosamente todas as linhas excluídas pareceria ter funcionado e responderia o oposto do pretendido. | Envie `include` (ativas e excluídas) ou `only` (apenas excluídas). Omita para ver apenas linhas ativas. |
| `INVALID_DISTINCT` | 400 | `?distinct=` não é `true` nem `false`. | Envie um desses valores; `1` e `0` também são aceitos. |
| `INVALID_FIELD_OPERATION` | 400 | Um `$inc` / `$push` / `$pull` / `$merge` foi usado em um tipo de coluna no qual não está definido, com um operando de formato incorreto, com dois operadores no mesmo campo, com erro de digitação ou em uma operação de criação — onde não há valor armazenado para operar. | Veja [Gravando via REST](/docs/backend/writes/#field-operations); a mensagem indica o campo. |
| `INVALID_FILTERED_WRITE` | 400 | Uma escrita filtrada foi direcionada a um caminho através de uma relação (`posts/1/comments`) ou a nenhuma tabela. | Escreva na tabela relacionada com um filtro no seu vínculo. |
| `INVALID_FILTER_FIELD` | 400 | O filtro especifica uma coluna que esta tabela não possui. | Verifique a grafia em comparação com a tabela. |
| `INVALID_FILTER_OPERATOR` | 400 | O operador não é suportado por este tipo de coluna — por exemplo, `like` em um número ou data. | Veja [Consultando dados](/docs/sdk/querying/). |
| `INVALID_FILTER_VALUE` | 400 | O valor do filtro não pode ser lido no tipo da coluna com a qual foi comparado: `?id=eq.abc` em uma chave inteira, um rótulo fora do enum, um timestamp inválido, um número fora do intervalo do tipo. `details.dbCode` traz o SQLSTATE. | Envie um valor compatível com o tipo da coluna. |
| `INVALID_HARD_PARAM` | 400 | `?hard=` não é `true` nem `false`. Qualquer outro valor é recusado em vez de interpretado como "não" — um erro de digitação que faz soft-delete quando o chamador pediu para purgar faz com que acredite que os dados sumiram. | Envie `true` ou `false`. |
| `INVALID_INCLUDE` | 400 | `?include=` está malformado: não é uma lista válida de caminhos ou é um objeto de opções por relação no formato incorreto. Um caminho aninhado com mais de três saltos retorna `INCLUDE_TOO_DEEP`, também um 400. Respondido no limite em vez de vazar do driver como um 500. | Veja a mensagem; ela indica o caminho problemático. |
| `INVALID_INPUT` | 400 | O corpo falhou na validação. | Veja a mensagem. |
| `INVALID_LIMIT` | 400 | `?limit=` não é um número inteiro de 1 até o máximo (1000 por padrão); um valor maior é recusado, não truncado. Uma assinatura em tempo real solicitando um limite fora desse intervalo recebe o mesmo código em um frame `ERROR` do WebSocket. | Reduza o limite e pagine o restante. |
| `INVALID_LOGICAL_GROUP` | 400 | Um grupo `?or=` / `?and=` / `?not=` está malformado ou aninhado além da profundidade permitida. | Veja a mensagem; ela ilustra a regra de nivelamento. |
| `INVALID_OFFSET` | 400 | `?offset=` não é um número inteiro igual ou superior a 0. | Envie um número inteiro não negativo. |
| `INVALID_ORDER_BY` | 400 | `?orderBy=` não é `field`, `field:desc`, `field:desc:last` ou um array JSON de `{ field, direction, nulls }` — ou especifica uma direção diferente de `asc`/`desc` ou posicionamento de nulos diferente de `first`/`last`. | Veja a mensagem; ela mostra todas as variações válidas. |
| `INVALID_PAGE` | 400 | `?page=` não é um número inteiro igual ou superior a 1. Páginas são baseadas em 1, portanto `?page=0` é considerado um erro e não a primeira página. | Envie `1` ou mais, ou use `?offset=`. |
| `INVALID_PARAM` | 400 | Um parâmetro de consulta está malformado. | Veja a mensagem. |
| `INVALID_QUERY_BODY` | 400 | O corpo de um `POST …/query` contém um valor que a URL não comportaria: uma lista para um parâmetro que a URL lê uma única vez (`fields`, `limit`, …), um objeto para um filtro, ou qualquer parâmetro presente na URL também — um `POST …/query` lê todos os parâmetros do corpo. | Formate cada valor como na URL — uma string, ou uma lista para um filtro repetido; `where`, `include`, `orderBy` e `vector` aceitam JSON. Veja [Consultas longas demais para uma URL](/docs/backend/vector-search/#queries-too-long-for-a-url). |
| `INVALID_VECTOR` | 400 | `?vector=` não é um array JSON de números. | Envie `[0.1,0.2,0.3]`. |
| `INVALID_VECTOR_DISTANCE` | 400 | `?vector_distance=` não é `cosine`, `l2` nem `inner_product`. | Use uma dessas três opções. |
| `INVALID_VECTOR_THRESHOLD` | 400 | `?vector_threshold=` não é um número. | Envie um número. |
| `INVALID_WHERE` | 400 | `?where=` não é um objeto JSON mapeando campos para condições. | Envie `{"status":["==","active"]}`. |
| `KEY_IMMUTABLE` | 400 | Uma atualização especifica a chave da linha com um valor diferente daquele pelo qual ela é referenciada — no corpo ou escrito por um `beforeSave`. Uma linha não pode migrar para outra chave: tudo após a escrita (a releitura, `afterSave`, histórico, tempo real) a referencia pela chave que já tinha. Recusado antes de qualquer hook ser executado, sem nada gravado, em todas as portas. `details.violations` indica o campo. | Crie a linha com a nova chave e exclua a atual. Enviar a mesma chave que a linha já possui é permitido. |
| `MISSING_AGGREGATE_SELECT` | 400 | A rota de agregação foi chamada sem `?select=`. | Adicione um parâmetro, ex.: `?select=count()`. |
| `NOT_A_MATERIALIZED_VIEW` | 400 | `refresh()` foi chamado em uma tabela que não corresponde a uma view materializada. | Atualize apenas uma view definida com `defineView(…, { materialized: true })`. |
| `NO_TABLES` | 404 | <span class="since-badge" data-since="0.31">Desde 0.31</span> O projeto não disponibiliza tabelas: nenhuma declarada em `backend/schema` e nenhuma no banco de dados para introspecção. Quando tabelas existem, mas o RLS está desativado nelas, a mensagem indica quais são, trazendo o SQL para ativá-lo, e `details.unprotectedTables` lista-as. Anteriormente `NO_COLLECTIONS`. | Crie tabelas — uma migração, SQL ou um arquivo `defineTable` junto com `rebase db push` — e reinicie. |
| `NOT_FOUND` | 404 | Nenhuma linha com esse id nessa tabela — ou uma linha que o RLS oculta deste chamador. | Verifique o id e, em seguida, o `rls` da tabela. |
| `UNKNOWN_RELATION` | 400 / 404 | `?include=` indica algo que não é uma relação na tabela. O mesmo código responde **404** quando um *caminho de URL* aninhado a indica, por exemplo `/api/data/authors/1/posts` onde `authors` não declara nenhuma relação — nesse caso a URL não aponta para nada, sendo um recurso não encontrado em vez de requisição malformada. | Verifique o nome da relação — a mensagem lista as existentes na tabela. Uma referência reversa precisa estar declarada no pai para ser percorrível. |
| `ORDER_BY_FIELD_NOT_SORTABLE` | 400 | A ordenação indica um campo que não pode ser ordenado. | Ordene por uma coluna válida. |
| `PAGE_WITH_OFFSET` | 400 | `?page=` foi combinado com `?offset=` — ou `page` com `offset` em um `find()`, o que o SDK do cliente, o `rebase.data` em processo e o cliente offline recusam com o mesmo código antes de qualquer requisição. Ambos descrevem a mesma janela, e anteriormente `page` prevalecia silenciosamente sobre um `offset` que o chamador nunca via aplicado. | Envie apenas um deles. |
| `PAYLOAD_TOO_LARGE` | 413 | O corpo excede o limite configurado. | Envie menos dados ou aumente o limite. |
| `READ_ONLY_TRANSACTION` | 409 | Um hook `afterRead` tentou realizar uma escrita. Uma leitura com escopo de requisição roda em uma transação `READ ONLY`, portanto nem o hook nem nada chamado por ele pode escrever. | Mova a escrita para fora da leitura: um job em segundo plano ou `rebase.dataAsAdmin` a partir de um cron job ou função customizada. |
| `REFRESH_NOT_SUPPORTED` | 501 | `POST /api/data/<slug>/refresh` atingiu um driver de dados sem views materializadas. | Nada para atualizar neste backend. |
| `RELATION_HAS_NO_PIVOT` | 400 | A escrita continha um payload de vínculo, mas o caminho não alcança seu destino por meio de um `manyToMany` que declare um `pivot` — portanto, não há linha de junção para recebê-lo. | Declare colunas de `pivot` na relação ou remova o payload da escrita. Veja [Relações](/docs/collections/relations/). |
| `RELATION_MISCONFIGURED` | 500 | Uma relação não pode ser resolvida no schema registrado. A operação é recusada em vez de ignorada: descartá-la reportaria sucesso para uma escrita que nunca ocorreu, ou vazio para linhas que existem. | Execute `rebase schema generate` se o schema gerado for mais antigo que o banco de dados. |
| `RELATION_NOT_UNLINKABLE` | 400 | A relação não pode ser desvinculada a partir deste lado. | Realize a escrita a partir do lado proprietário. |
| `RELATION_NOT_WRITABLE` | 400 | O caminho aninhado não é uma relação com permissão de escrita, ou uma criação/atualização especifica uma relação `via` com múltiplos saltos — somente relações `via` de um único salto permitem escrita. `details.fields` lista as chaves `via`. Nada foi gravado. | Escreva diretamente nas linhas que a cadeia une. Veja [Relações](/docs/collections/relations/#via--an-explicit-join-chain). |
| `RELATION_PIVOT_UNSUPPORTED` | 400 | A relação declara colunas de junção, mas esta fonte de dados não suporta a escrita nelas. | O vínculo em si continua funcionando; apenas o payload anexado a ele não funciona. Verifique as capacidades do driver. |
| `RELATION_SOURCE_KEY_EMPTY` | 400 | Uma escrita de relação não possuía chave de origem para vincular a relação. | Salve a linha pai primeiro. |
| `RESULT_TOO_LARGE` | — | Uma instrução enviada via `EXECUTE_SQL` do socket em tempo real — `admin.executeSql` a partir de um cliente, leituras de catálogo do painel admin — retornou mais de 128 MB de linhas, de modo que nada foi enviado. Entregue como um frame `ERROR` do WebSocket. As execuções do console SQL não são recusadas: elas exibem as primeiras linhas. | Adicione um `LIMIT` ou selecione menos colunas, e leia o resultado em partes. |
| `ROW_IN_TRASH` | 409 | A chave de um upsert pertence a uma linha na lixeira (uma linha com soft-delete ainda retém sua chave). Um upsert não escreve em uma linha excluída, em nenhuma porta: REST `?on_conflict=`, upserts via `/bulk` e `/_batch`, SDK e socket em tempo real. Nada foi gravado. | Restaure a linha primeiro (uma atualização definindo o campo de soft-delete para `null`) ou purgue-a com `?hard=true` e execute o upsert novamente. Veja [Soft delete](/docs/collections/soft-delete/). |
| `SCHEMA_DRIFT` | 500 | Uma tabela ou coluna que o código espera não existe no banco de dados. | Execute `rebase db push` em desenvolvimento; faça um novo deploy em ambientes gerenciados. |
| `SCORE_CURSOR_UNSUPPORTED` | 400 | `startAfter` foi combinado com `orderBy: "_score"`. A relevância é calculada por consulta em vez de armazenada, portanto não pode servir de chave para um cursor. | Pagine a relevância com `limit`/`offset` ou ordene por uma coluna. |
| `SQL_ERROR` | 400 | O banco de dados recusou o SQL escrito por uma pessoa. No socket em tempo real via `EXECUTE_SQL`, é um frame `ERROR` trazendo a mensagem do banco. O endpoint `POST /api/admin/sql/csv` responde com este erro antes de enviar qualquer parte do arquivo: erro de sintaxe, tentativa de escrita (o download roda em modo somente leitura), mais de uma instrução ou uma role que a conexão não pode assumir. | Corrija o SQL. Um download aceita uma única instrução `SELECT`, `WITH … SELECT`, `TABLE` ou `VALUES`. |
| `VIEW_NOT_READABLE` | 403 | Um chamador que não possui nenhuma das `view.roles` de uma view materializada tentou lê-la ou atualizá-la. Uma view materializada não possui RLS, sendo servida integralmente e apenas para essas roles. | Leia com uma das roles permitidas ou declare a role do chamador em `view.roles`. |
| `TENANT_IMMUTABLE` | 400 | Uma escrita moveria uma linha de um tenant para outro. Uma linha não pode mudar de tenant. `details.violations` indica o campo. Uma trigger aplica a mesma regra no banco de dados, então o SQL executado como o chamador falha com o erro Postgres `42501` e uma mensagem iniciando com `TENANT_IMMUTABLE`. | Crie a linha no outro tenant e exclua a atual, ou escreva com uma role presente em `tenant.bypassRoles`. |
| `TENANT_MISMATCH` | 400 | A escrita indica um tenant ao qual este chamador não pertence; o banco de dados também a recusaria. | Escreva em um tenant ao qual o chamador pertença ou autentique-se como um usuário desse tenant. |
| `TENANT_REQUIRED` | 400 | A tabela tem escopo de tenant e o tenant não pode ser inferido: a requisição não informa nenhum ou o chamador pertence a vários. | Envie o campo do tenant explicitamente ou autentique-se como um chamador que pertença a exatamente um. |
| `TRANSACTION_ABORTED` | 500 | Uma instrução na transação da escrita falhou e um hook capturou o erro. O Postgres já havia abortado a transação, de modo que a escrita foi revertida e nada foi armazenado. Apenas criações, atualizações ou exclusões via `context.data` recusadas pelo banco são desfeitas individualmente e são seguras para captura. | Deixe a falha lançar o erro ou faça a verificação antes de executar a instrução. Veja [Semântica de transações](/docs/collections/context-data-api/#transaction-semantics). |
| `UNKNOWN_FIELD` | 400 | `?fields=` indica um campo que a tabela não possui. | Verifique a grafia; a mensagem lista os campos válidos. |
| `UNKNOWN_AGGREGATE_FIELD` | 400 | Uma agregação ou `groupBy` indica um campo que a tabela não possui. | Verifique a grafia; a mensagem lista os campos válidos. |
| `UNKNOWN_FILTER_FIELD` | 400 | O filtro indica um campo que esta tabela — ou o destino de uma relação — não possui, ou uma coluna `.private()`. | Verifique a grafia; a mensagem lista os campos válidos. |
| `UNKNOWN_FILTER_OPERATOR` | 400 | O filtro indica um operador inexistente. | A mensagem lista todos os operadores válidos. |
| `UNKNOWN_MESSAGE_TYPE` | 400 | Um frame do socket em tempo real tem um `type` que o servidor não processa. Respondido como um frame `ERROR` trazendo o `requestId` da requisição, para que a requisição seja concluída em vez de expirar por timeout. | Verifique o `type` do frame; a mensagem indica o valor recebido. |
| `UNKNOWN_ORDER_BY_FIELD` | 400 | A ordenação indica um campo que esta tabela não possui. | Verifique a grafia; a mensagem lista os campos válidos. |
| `PRECONDITION_FAILED` | 412 | Um `If-Match` informou uma versão da linha que não é mais a atual: alguém escreveu nela entre a leitura e esta escrita. Nada foi gravado. | Releia a linha, reaplique a alteração e envie a nova `ETag`. |
| `UNKNOWN_RESPONSE_FIELD` | 400 | `?fields=` solicita um campo que a tabela não possui. | Verifique a grafia; a mensagem lista os campos conhecidos. |
| `UNKNOWN_VECTOR_PROPERTY` | 400 | Uma busca vetorial indicou uma coluna que não é `col.vector()` nesta tabela. | A mensagem lista as colunas vetoriais da tabela. |
| `UNSUPPORTED_MEDIA_TYPE` | 415 | O `Content-Type` não é aceito por esta rota. | Envie o tipo documentado para a rota. |
| `UNSUPPORTED_OPTION` | — | Lançado como exceção, não respondido via HTTP: uma escrita através do acessor em processo (`context.data` em um hook, `rebase.data` em uma função ou cron) recebeu `ifMatch` ou `idempotencyKey`. Essa via não possui verificação de pré-condição ou armazenamento de idempotência, portanto a opção é recusada antes que qualquer dado seja escrito, em vez de ser ignorada. | Remova a opção ali ou faça a escrita via cliente HTTP, que respeita ambas. |
| `UNSUPPORTED_RELATION_FILTER` | 400 | O filtro cruza uma relação `via`, cujo caminho de join é definido em apenas uma direção, não havendo como correlacionar uma subconsulta de volta. | Filtre a partir do lado proprietário. |
| `UNSUPPORTED_RELATION_FILTER_OPERATOR` | 400 | O operador não está definido para esse campo: uma relação sem coluna nesta linha é filtrada por pertinência, e correspondência de padrões (`like`, `ilike` e suas negações) aplica-se apenas a texto. | Veja a mensagem; ela lista o que o campo aceita. |
| `VALIDATION_CONSTRAINT` | 400 | Um valor violou uma regra declarada na coluna (`.validate()`, `.notNull()`, `.oneOf()`) — tamanho, intervalo, padrão, campo obrigatório, valor fora da lista. Cada entrada de `details.violations` possui um `code`: `required`, `min_length`, `max_length`, `length`, `min`, `max`, `less_than`, `more_than`, `positive`, `negative`, `integer`, `pattern`, `email`, `url`, `enum`, `min_items`, `max_items`, `unique_items` (um array contém o mesmo item duas vezes, incluindo via `$push`), `unique_by` (dois itens de um array JSON compartilham o valor de um campo indicado por `uniqueBy`), `date_min`, `date_max`, `geopoint_range`. | Veja a mensagem; ela indica a tabela, a coluna e cada violação. |
| `VALIDATION_EXCLUDED_FIELDS` | 400 | O corpo tenta escrever em uma coluna marcada como `.private()` ou `.access({ write: [] })` — a mesma regra, duas sintaxes diferentes. Esses campos cabem apenas ao servidor definir: hash de senha, token de verificação. Diferente de `FIELD_NOT_WRITABLE`, essa é a mesma resposta para qualquer chamador, incluindo `admin`. | Remova o campo. Veja [Acesso a campos](/docs/collections/field-access/). |
| `VALIDATION_INVALID_VALUE` | 400 | Um valor não é compatível com o tipo da coluna. | Veja a mensagem; ela indica a coluna. |
| `VALIDATION_UNKNOWN_FIELDS` | 400 | O corpo indica um campo que a tabela não possui — incluindo um argumento `id` em uma tabela cuja chave primária é outra coluna. | Verifique a grafia; a mensagem ("Table 'x' has no column 'f'. Known columns: …") lista as colunas existentes. |
| `VECTOR_CURSOR_UNSUPPORTED` | 400 | Um cursor (`after` / `startAfter`) foi combinado com uma busca vetorial. As linhas são ordenadas por uma distância calculada a cada consulta, a qual não pode servir de cursor, portanto uma listagem vetorial não retorna `nextCursor`. | Pagine as linhas mais próximas com `limit`/`offset`. |
| `WRITE_DENIED` | 403 | Uma regra de segurança ou política de RLS recusou a escrita. | Verifique o `rls` da tabela. |

## `PG_<SQLSTATE>` — uma restrição recusada pelo banco de dados

Uma escrita que o Postgres rejeita por um motivo ligado aos *dados do chamador*
responde com o SQLSTATE no código: `PG_23505`, `PG_23503`, e assim por diante. Isso é uma
família, não uma lista fixa — o Postgres define centenas de SQLSTATEs —, mas apenas duas
classes chegam a esse ponto, porque somente essas duas são culpa do chamador:

- **classe 23**, violação de restrição de integridade: duplicata, chave estrangeira que
  aponta para nada, coluna NOT NULL deixada vazia;
- **classe 22**, exceção de dados: um valor que o tipo da coluna não suporta.

Qualquer outra coisa — conexão perdida, coluna ausente, problema de privilégios —
é problema do servidor e permanece como `500`. Assim, `code.startsWith("PG_")` é um teste
seguro para "a linha que enviei estava com dados incorretos", sendo as quatro abaixo aquelas que um cliente
realmente encontra. `details.dbCode` traz o mesmo SQLSTATE para todas elas, e
a mensagem informa o nome da restrição.

| Código | Status | Significado | O que fazer |
| --- | --- | --- | --- |
| `PG_22P02` | 400 | Um valor não pôde ser interpretado no tipo da coluna — o equivalente no lado da escrita a `INVALID_FILTER_VALUE`. | Envie um valor compatível com o tipo da coluna. |
| `PG_23502` | 400 | Uma coluna `NOT NULL` foi deixada vazia. | Envie o campo ou defina um valor padrão para a coluna. |
| `PG_23503` | 400 / 409 | Na gravação, uma chave estrangeira aponta para uma linha inexistente (400). Na exclusão, outras linhas ainda referenciam esta (409; uma chave `RESTRICT` gera `PG_23001`, também 409). | Crie a linha de destino primeiro ou corrija o id; para exclusão, remova ou aponte as linhas dependentes para outro lugar antes. |
| `PG_23505` | 409 | Uma restrição de unicidade (unique constraint) foi violada. A mensagem informa o nome da restrição. | Use um valor diferente ou atualize a linha existente. |

## Armazenamento

| Código | Status | Significado | O que fazer |
| --- | --- | --- | --- |
| `INVALID_LIST_OPTIONS` | 400 | O `maxResults` de uma listagem de armazenamento não é um número inteiro igual ou superior a 1, ou seu `pageToken` não foi emitido pela fonte. Um tamanho de página inferior a 1 costumava retornar uma página vazia com o mesmo token, fazendo com que loops `while (pageToken)` nunca terminassem. | Envie um `maxResults` positivo e repasse o `nextPageToken` sem alterações. |
| `INVALID_STORAGE_BUCKET` | 400 | O nome do bucket está malformado. | Verifique o nome. |
| `INVALID_STORAGE_KEY` | 400 | A chave do objeto está malformada, escapa de seu prefixo ou está sob um prefixo reservado (`_rebase/renditions/`, `_rebase/maintenance/`). | Verifique a chave. |
| `INVALID_TRANSFORM_OPTIONS` | 400 | Os parâmetros de transformação de imagem estão fora do intervalo ou são contraditórios. | Veja [Armazenamento](/docs/backend/storage/). |
| `STORAGE_FILE_TOO_LARGE` | 413 | O upload excede o `maxBytes` declarado na coluna de destino `col.storage()`. Aplicado no servidor, não apenas no navegador. `details` informa a coluna, o limite e o tamanho real. | Envie um arquivo menor ou aumente o `maxBytes` na coluna. |
| `STORAGE_FILE_TYPE_REFUSED` | 400 | O tipo do arquivo não está na lista `accept` da coluna ou não consta no `allowedMimeTypes` da própria fonte de armazenamento. `details` informa a coluna (ou a lista da fonte), a lista de aceitos e o Content-Type enviado. | Envie um tipo aceito ou amplie o `accept` / `allowedMimeTypes`. |
| `STORAGE_MISCONFIGURED` | 502 | O bucket S3 ou GCS com o qual esta fonte está configurada não existe, ou o provedor recusou as credenciais desta implantação para ele. A mensagem indica o bucket; `details.reason` é `NoSuchBucket` ou a recusa do provedor. Um bucket inexistente costumava ser interpretado como "arquivo não encontrado" para todos os arquivos. | Corrija o nome do bucket (`S3_BUCKET` / `GCS_BUCKET`, `__<KEY>` para uma fonte nomeada) ou as permissões das credenciais. |
| `STORAGE_NOT_CONFIGURED` | 501 / 503 | Nenhum backend de armazenamento está configurado neste servidor, ou nenhum é o padrão e a requisição não indica uma fonte de armazenamento; a mensagem lista as fontes atendidas (501). Um upload resumível cuja fonte desapareceu antes de ser concluído retorna 503. | Configure o S3, GCS ou armazenamento local, ou indique uma fonte com `?storageId=`. |
| `STORAGE_SAME_LOCATION` | 400 | `POST /api/admin/storage/move` com `deleteSource` (`rebase storage move --delete-source`) entre duas fontes que armazenam no mesmo bucket ou diretório. Todo arquivo contaria como já presente no destino por ser o mesmo arquivo, e excluir a cópia da fonte deletaria a única cópia existente. Nada foi movido ou excluído. | Aponte a coluna para a outra fonte; os arquivos já estão lá. |
| `STORAGE_SCAN_INCOMPLETE` | 409 | `DELETE /api/admin/storage/orphans` (`rebase storage orphans --delete`) não pôde ler todas as tabelas, logo um arquivo citado por uma delas pareceria não utilizado. Com `?scan=`, o scan especificado é aquele que não conseguiu ler todas as tabelas. Nada foi excluído; `details.unscanned` cita cada tabela e o motivo pelo qual não pôde ser lida. | Corrija o que impede a leitura dessas tabelas e execute novamente. |
| `STORAGE_SCAN_NOT_FOUND` | 404 | `GET /api/admin/storage/orphans/scans/:id` ou `DELETE /api/admin/storage/orphans?scan=:id` especifica uma varredura (scan) que a fonte não possui. Os scans são mantidos por 7 dias na fonte em que foram executados, portanto um `storageId` diferente do scan também resultará em não encontrado. | Passe o `storageId` do scan ou inicie outra varredura. |
| `STORAGE_SCAN_NOT_COMPLETE` | 409 | `DELETE /api/admin/storage/orphans?scan=:id` indica um scan que ainda está em estado `queued` ou `running`, ou que falhou (`failed`). Nada foi excluído; `details.status` especifica o estado. | Aguarde a conclusão do scan ou inicie outro. |
| `STORAGE_SCAN_EXPIRED` | 409 | `DELETE /api/admin/storage/orphans?scan=:id` indica um scan concluído há mais de 15 minutos. Nada foi excluído. | Inicie outro scan e execute a exclusão a partir dele. |
| `STORAGE_SCAN_DELETION_STARTED` | 409 | `DELETE /api/admin/storage/orphans?scan=:id` indica um scan cujos órfãos já estão sendo excluídos. | Consulte o status de `deletion` do scan com `GET /api/admin/storage/orphans/scans/:id`. |
| `STORAGE_SOURCE_NOT_CONFIGURED` | 501 | A fonte de armazenamento está declarada, mas não possui credenciais configuradas aqui. | Defina as variáveis de ambiente dessa fonte. |
| `STORAGE_WRITE_FAILED` | 502 | O backend de armazenamento recusou ou interrompeu a gravação. | Verifique seus próprios logs e credenciais. |
| `TRANSFORM_OVERLOADED` | 503 | Transformações de imagem em excesso em andamento. | Tente novamente; considere usar uma CDN à frente. |
| `UNKNOWN_STORAGE_SOURCE` | 400 / 404 | A requisição indicou uma fonte de armazenamento (`?storageId=`) que este projeto não declara. Um `bucket` que esta implantação não atende retorna o mesmo código com status **404** (em listagem, upload, pasta ou upload resumível para S3 ou GCS) — o que está ausente é o bucket/repositório, e `details` lista os buckets e fontes que existem. Ambos costumavam retornar "arquivo não encontrado", idêntico a uma chave simplesmente ausente. | Declare a fonte em `config/resources.ts` ou consulte `GET /api/storage/sources`. |
| `UPLOAD_LOCKED` | 423 | O `PATCH` de um upload resumível chegou enquanto outro bloco do mesmo upload ainda estava sendo recebido — quase sempre um cliente reenviando o bloco em trânsito. É recusado em vez de colocado em fila, assim como o tusd faz. | Solicite o offset com `HEAD /api/storage/tus/:id` e retome a partir dali; o tus-js-client recua e tenta novamente por conta própria. Veja [Uploads resumíveis (TUS)](/docs/backend/storage-resumable-uploads/). |

## Funções customizadas

| Código | Status | Significado | O que fazer |
| --- | --- | --- | --- |
| `FUNCTION_NOT_FOUND` | 404 | Nenhuma função com esse nome é atendida — ou uma existe, mas suas rotas não cobrem o caminho posterior. Um chamador autenticado também é informado sobre o que *é* atendido; um anônimo não recebe essa informação, pois a lista representa um inventário de todos os endpoints customizados. Se um arquivo com esse nome falhou ao carregar, a mensagem informa o chamador autenticado, citando o arquivo: essa é a diferença entre um erro de digitação e um deploy quebrado. Um chamador anônimo recebe a resposta genérica de nome desconhecido, idêntica a um nome inexistente. | Verifique o nome em `GET /api/functions` ou consulte o log de inicialização para verificar arquivos que falharam no carregamento. |
| `FUNCTION_TIMEOUT` | 504 | O handler excedeu seu tempo limite. Ele continua rodando; não pode ser cancelado a partir daqui. | Defina um `AbortSignal` em chamadas externas ou aumente `REBASE_FUNCTIONS_TIMEOUT_MS`. |
| `FUNCTIONS_UPSTREAM_UNREACHABLE` | 502 | Este processo atua como proxy de funções para outro, o qual não respondeu. | Verifique se a unidade de funções está em execução. |

## Tarefas cron

| Código | Status | Significado | O que fazer |
| --- | --- | --- | --- |
| `CRON_JOB_ALREADY_EXECUTING` | 409 | Disparo manual de um cron job que já está em execução — no processo que respondeu ou em outro detentor do lease de execução do job, como o worker por trás de um processo `api`. Nada foi executado. O salto é registrado no histórico do job, e `details.log` traz essa entrada; sua linha indica o processo que executa o job. | Tente novamente quando a execução terminar. Veja [Tarefas Cron](/docs/backend/cron-across-instances/#concurrency-guarding). |

## Superfícies administrativas e edição de schema

Esses erros indicam que um recurso está desativado ou não configurado, e não
que a requisição foi incorreta. Cada um também é reportado na rota `/status`
correspondente com status `200`, para que o painel possa desabilitar o recurso visualmente em vez de exibir um erro.

| Código | Status | Significado | O que fazer |
| --- | --- | --- | --- |
| `ADMIN_SURFACE_UNAVAILABLE` | 501 | Uma interface exclusiva para admins foi chamada em um servidor sem autenticação configurada, portanto nada consegue distinguir um admin de um visitante anônimo. | Defina `auth.jwtSecret` ou forneça um `AuthAdapter`. |
| `BRANCH_DIFF_STALE` | 409 | `POST /api/admin/branches/:name/merge` recebeu a fingerprint de um diff que não corresponde mais à realidade: a branch ou o pai sofreu alterações desde então. Nada foi gravado. | Obtenha o diff novamente, revise-o e faça o merge com sua nova `fingerprint`. |
| `BRANCH_DIFF_UNSUPPORTED` | 501 | A fonte de dados não consegue comparar branches: não possui SQL ou suporte a branching (sem conexão de admin). | Use um backend Postgres com `adminConnectionString` configurada. |
| `BRANCH_MERGE_BLOCKED` | 409 | Uma tabela divergente não pode ser mesclada — adicionada ou excluída pela branch, divergência de colunas ou de chave primária, ausência de chave primária, linhas em excesso para correspondência ou reescrita desde a criação da branch (`TABLE_REWRITTEN`). Uma tabela cujas linhas não puderam ser comparadas bloqueia o merge mesmo que suas contagens retornem 0: elas são desconhecidas, não zero. `details.tables` lista cada uma com o motivo. Nada foi gravado. | Aplique o schema com suas migrações primeiro, ou faça o merge com `skipBlocked: true` para ignorar essas tabelas. |
| `BRANCH_MERGE_CONFLICT` | 409 | Linhas foram alteradas tanto na branch quanto no pai, e `onConflict` foi definido como `"abort"` (o padrão); ou o pai recusou parte do merge — uma linha mudou no intervalo, uma trigger a ignorou, uma política a ocultou. Nada foi gravado. | Escolha qual lado prevalece com `onConflict: "branch"` ou `"target"`, ou obtenha o diff novamente. |
| `BRANCH_MERGE_FAILED` | 409 | O pai recusou as linhas da branch dentro da instrução de merge — uma restrição, valor de enum ou chave estrangeira existente foi violada pelas linhas da branch, normalmente porque os dois schemas diferem. `details` traz `sqlState`, `table`, `constraint` e `detail`. Nada foi gravado. | Analise as alterações de schema do diff, alinhe o schema pai com suas migrações ou corrija as linhas da branch e repita o merge. |
| `BRANCH_NOT_FOUND` | 404 | Nenhuma branch com esse nome no registro. | O comando `rebase db branch list`, ou o painel de Branches, lista as branches existentes. |
| `CONTRACT_UNAVAILABLE` | 404 | O contrato do projeto é servido apenas quando a autenticação está configurada — ele descreve todas as tabelas e relações. | Configure a autenticação. `/meta/schema-version` é sempre servido. |
| `DEV_MAILBOX_UNAVAILABLE` | 501 | Nenhuma caixa de correio de desenvolvimento está ativa. E-mails são interceptados apenas quando `SMTP_HOST` não está definido e `NODE_ENV` não é production. | Remova `SMTP_HOST` em desenvolvimento ou consulte a caixa de entrada real. |
| `DOCS_UNAVAILABLE` | 404 | <span class="since-badge" data-since="0.31">Desde 0.31</span> `GET /api/docs` é disponibilizado para os chamadores aos quais `GET /api/schema/tables` descreve tabelas, e este servidor não tem autenticação configurada, não havendo a quem descrevê-las. | Configure a autenticação ou publique a documentação completa para todos com `enableSwagger: true` (`REBASE_ENABLE_SWAGGER=true`). |
| `INVALID_CHANGE` | 400 | A proposta de alteração de schema não está bem formatada. | Veja a mensagem. |
| `SCHEMA_CHANGE_FAILED` | 400 | A aplicação de uma alteração de schema planejada falhou por um motivo não coberto por códigos mais específicos. | Veja a mensagem; ela traz a falha original na íntegra. |
| `SCHEMA_CHANGE_UNAPPLICABLE` | 400 | A alteração é válida, mas não pode ser aplicada ao schema no estado atual. | Veja a mensagem. |
| `SCHEMA_EDIT_DIRTY_TREE` | 409 | O repositório possui alterações não commitadas, portanto a edição não pôde ser aplicada com segurança. | Faça commit ou stash e tente novamente. |
| `SCHEMA_EDIT_REFUSED` | 400 | O editor de schema recusou a edição: a alteração pretendida está em código que ele não reescreve (um spread, um helper, uma chave computada) ou a edição é uma ação que ele nunca realiza (renomear uma tabela, remover a última regra). `details.problems` lista cada item. Nada foi gravado. | Veja a mensagem. Faça a alteração em `backend/schema` manualmente. |
| `SCHEMA_EDIT_DOES_NOT_COMPILE` | 400 | <span class="since-badge" data-since="0.31">Desde 0.31</span> A edição pode ser feita, mas o schema resultante não compilaria — uma relação apontando para uma tabela excluída por ela, uma regra referenciando uma coluna removida. `details.problems` traz os diagnósticos do compilador, cada um com sua tabela e coluna. Nada foi gravado. | Altere as tabelas dependentes primeiro ou faça a alteração em `backend/schema` manualmente. |
| `SCHEMA_EDIT_STALE_FILE` | 409 | Um arquivo que a edição reescreveria foi alterado no disco desde a preparação da edição (salvamento na IDE, outro processo). Nada foi gravado. | Recarregue e faça a edição novamente com base no arquivo atual. |
| `SCHEMA_EDIT_REQUIRES_A_PERSON` | 403 | Uma chave de API ou outro principal de máquina tentou aplicar uma alteração de schema. | Faça login como um usuário ou defina `liveSchema.allowMachineApply`. |
| `SCHEMA_EDITING_NO_COLLECTIONS_DIR` | 501 | A edição de schema em tempo real precisa de `schemaDir` (o diretório `backend/schema`) ou `liveSchema.repository`, e este servidor não foi iniciado com nenhum dos dois. O código mantém seu nome antigo. | Configure um deles. |
| `SCHEMA_EDITING_NO_REPOSITORY` | 503 | O planejamento funciona; não há repositório para commitar a alteração — uma implantação rodando um bundle compilado ou um servidor cujo diretório `backend/schema` não está em um repositório git (uma aplicação é sempre commitada). | Execute `git init` no projeto e reinicie o servidor (o repositório é detectado na inicialização) ou configure `liveSchema.repository`. |
| `SCHEMA_EDITING_PROVISIONING_OFF` | 409 | Esta implantação não altera nada em seu banco de dados (`REBASE_PROVISION=false`), portanto uma alteração não pode ser aplicada pelo painel. | Faça o commit apenas como código-fonte e permita que o processo que gerencia o banco de dados a aplique. |
| `SCHEMA_EDITING_UNSUPPORTED` | 503 | Este driver não consegue planejar alterações de schema. | A edição em tempo real está disponível no Postgres. |
| `SCHEMA_EDITOR_BAAS_MODE` | 501 | As tabelas são obtidas por introspecção do banco de dados aqui, portanto não há arquivos-fonte para editar. | Altere o schema através de uma migração. |
| `SCHEMA_EDITOR_DISABLED` | 501 | O editor de schema está desativado para este servidor. Um bundle compilado sempre retorna esta resposta. | Ative-o com `schemaEditor`. Em um bundle compilado, defina `REBASE_LIVE_SCHEMA_REPOSITORY` para editar `backend/schema` por meio de um repositório — veja [Edição de schema em tempo real](/docs/backend/live-schema-editing#from-a-built-bundle). |
| `SCHEMA_EDITOR_MISSING_DEPENDENCY` | 501 | O editor de schema necessita do pacote `ts-morph`, que não está instalado. | Instale-o no pacote que executa o backend e reinicie: `pnpm --dir backend add -D ts-morph@28.0.0` da raiz de um projeto scaffolded, ou `pnpm add -D ts-morph@28.0.0` onde o backend for o projeto. A mensagem traz o comando exato para seu projeto. |
| `SCHEMA_EDITOR_NO_COLLECTIONS_DIR` | 501 | O servidor não possui `schemaDir`, de forma que o editor não tem onde gravar. O código mantém o nome antigo. | Defina `schemaDir`. |
| `SCHEMA_EDITOR_PRODUCTION` | 501 | O editor é desativado sob `NODE_ENV=production`: os arquivos de um servidor em produção são reconstruídos a partir do seu repositório a cada deploy, então uma edição feita aqui seria descartada. | Edite `backend/schema` em desenvolvimento e faça deploy, ou configure `liveSchema.repository` para commitar as alterações lá. |
| `SCHEMA_UNAVAILABLE` | 404 | <span class="since-badge" data-since="0.31">Desde 0.31</span> `GET /api/schema/tables` em um backend sem autenticação configurada: não há chamador para quem filtrar as tabelas, e `auth.requireAuth: false` não muda isso. | Configure um adapter de autenticação ou `auth.jwtSecret`. Veja [Endpoints](/docs/backend/endpoints/#schema). |
| `TABLE_NOT_FOUND` | 404 | <span class="since-badge" data-since="0.31">Desde 0.31</span> `GET /api/schema/tables/:slug` indica uma tabela não servida a este chamador — nenhuma com esse slug, ou uma que os escopos da credencial não alcancem. | Verifique o slug e os escopos `data:*` da credencial. |
| `UI_PREFERENCES_NEED_A_PERSON` | 403 | <span class="since-badge" data-since="0.31">Desde 0.31</span> `/api/admin/ui-config` foi chamado com uma chave de API, um token de plataforma ou a chave de serviço. As preferências de UI pertencem a um usuário autenticado. | Faça login como usuário. |
| `UI_PREFERENCES_TOO_LARGE` | 413 | <span class="since-badge" data-since="0.31">Desde 0.31</span> As preferências de UI de uma tabela são maiores que 64 KB. | Salve menos dados: preferências guardam apresentação, não dados. |
| `UI_PREFERENCES_UNSUPPORTED` | 501 | <span class="since-badge" data-since="0.31">Desde 0.31</span> O driver deste backend não suporta SQL, portanto não armazena preferências de UI; o painel as mantém no navegador. | Nada a corrigir: as preferências ficam restritas por navegador. |
| `UI_CONFIG_FILE_INVALID` | 500 | <span class="since-badge" data-since="0.31">Desde 0.31</span> O arquivo `frontend/src/cms/ui-config.json`, onde as preferências de UI do workspace são salvas em desenvolvimento, não é um JSON válido. | Corrija-o ou exclua-o; o painel o reescreverá no próximo salvamento. |
| `SQL_EXPORT_UNSUPPORTED` | 501 | `POST /api/admin/sql/csv` não pode transmitir um resultado aqui: o banco de dados de desenvolvimento em processo (PGlite) possui uma única conexão, e um cursor mantido durante um download travaria todas as outras consultas; ou a fonte de dados não possui cursor SQL. | Aponte `DATABASE_URL` para seu próprio Postgres (`rebase dev --docker` inicia um), ou adicione um `LIMIT` e exporte as linhas visíveis na tela. |

### Reconciliação de schema

<span class="since-badge" data-since="0.31">Desde 0.31</span>

[`rebase schema reconcile`](/docs/cli/schema/#rebase-schema-reconcile) realiza o planejamento
através de `POST /api/admin/schema/reconcile/plan` e aplica via
`/reconcile/apply`. Uma recusa não altera nada; apenas `SCHEMA_RECONCILE_FAILED`
deixa parte de um plano aplicada.

| Código | Status | Significado | O que fazer |
| --- | --- | --- | --- |
| `INVALID_RECONCILE` | 400 | O corpo não é um objeto JSON ou `drop` não é uma lista de strings `"<table>.<column>"`. | Envie `{ "drop": ["voice_cache.wav"] }` ou omita o campo `drop`. |
| `SCHEMA_RECONCILE_FAILED` | 400 | Uma instrução falhou no meio do processo. As instruções anteriores foram executadas e continuam aplicadas; `details.applied` lista-as. | Corrija o que a mensagem indica e planeje novamente: o novo plano omitirá o que já foi executado. |
| `SCHEMA_RECONCILE_INVALID` | 400 | O plano não pode ser aplicado, e a mensagem detalha os motivos: um `drop` que não está no formato `<table>.<column>`, indica tabela ou coluna inexistente, ou indica uma coluna que a tabela ainda declara. `details.plan` traz o plano. | Corrija a lista de `drop`. Uma coluna declarada é removida excluindo-a do seu `defineTable`, realizando o deploy e em seguida reconciliando. |
| `SCHEMA_RECONCILE_STALE` | 409 | O banco de dados ou as tabelas mudaram desde o plano confirmado. `details.plan` traz o novo plano. | Revise o novo plano e confirme seu `digest`. |
| `SCHEMA_RECONCILE_UNCONFIRMED` | 400 | `/reconcile/apply` não recebeu o campo `confirm`. | Planeje primeiro e envie o `digest` do plano como `confirm`. A CLI faz isso automaticamente quando você digita `yes`. |
| `SCHEMA_RECONCILE_UNSUPPORTED` | 503 | O driver deste backend não consegue planejar uma reconciliação ou não consegue executar SQL. | A reconciliação funciona no Postgres. |

### Por que a tabela de uma branch não pode ser mesclada

`BRANCH_MERGE_BLOCKED` cita cada tabela recusada em `details.tables`, acompanhada por um
destes códigos. O mesmo código aparece no campo `blocked` da tabela no próprio diff,
permitindo que o Studio informe o motivo antes que alguém clique em **Merge**. Nenhum deles é uma resposta independente.

| Código | Status | Significado | O que fazer |
| --- | --- | --- | --- |
| `COLUMNS_DIFFER` | — | As colunas da tabela diferem entre a branch e o pai. As linhas são comparadas com base nas colunas compartilhadas. | Adicione as colunas faltantes ao pai através de migrações (`rebase db push`) e faça o merge. Uma migração que reescreve a tabela — mudança no tipo da coluna — transforma-a em `TABLE_REWRITTEN`: faça o merge antes de uma alteração dessas ou recrie a branch após a mudança. |
| `NO_PRIMARY_KEY` | — | A tabela não possui chave primária, portanto as linhas não podem ser comparadas individualmente; o diff informa apenas as contagens de linhas. | Adicione uma chave primária à tabela ou transfira suas linhas manualmente. |
| `PRIMARY_KEY_DIFFERS` | — | As colunas da chave primária, ou seus tipos, diferem entre os dois lados. | Aplique o schema ao pai primeiro. |
| `TABLE_ADDED` | — | A branch criou a tabela. Um merge nunca cria tabelas. | Crie-a no pai com suas migrações e mescle suas linhas depois. |
| `TABLE_DROPPED` | — | A branch removeu a tabela. Um merge nunca remove tabelas. | Remova-a por meio de migrações. |
| `TABLE_REWRITTEN` | — | Um dos lados reescreveu todas as linhas da tabela após a criação da branch — alteração no tipo de coluna, um `ADD COLUMN` com valor padrão volátil, `VACUUM FULL`, `CLUSTER` — de modo que todas as linhas constam como regravadas e não é possível identificar qual lado alterou qual linha. | Faça o merge da branch antes dessa migração ou recrie a branch a partir do pai depois dela. |
| `TOO_LARGE` | — | A tabela contém mais linhas em um dos lados do que a quantidade que um diff compara individualmente (100.000 por padrão, `maxRowsPerTable`). | Aumente `maxRowsPerTable` tanto no diff quanto no merge, ou transfira as linhas por outro método. |

## Códigos genéricos

Uma rota utiliza um destes códigos quando nenhum mais específico se aplica.

| Código | Status | Significado | O que fazer |
| --- | --- | --- | --- |
| `BAD_REQUEST` | 400 | Malformada, e nenhum código mais específico se aplica. | Veja a mensagem. |
| `UNAUTHORIZED` | 401 | Não autenticado ou a credencial foi rejeitada. | Faça login ou renove a sessão. |
| `FORBIDDEN` | 403 | Autenticado, mas sem permissão. | Repetir com a mesma identidade não resolverá o problema. |
| `CONFLICT` | 409 | Um conflito com o estado existente. | Veja a mensagem. |
| `INTERNAL_ERROR` | 500 | Algo falhou no servidor. A mensagem é propositalmente genérica. | Forneça o `requestId`; o motivo detalhado está nos logs. |
| `NOT_CONFIGURED` | 503 | Uma dependência que esta rota requer não está configurada neste servidor. | Veja a mensagem. |
| `SERVICE_UNAVAILABLE` | 503 | Um serviço do qual a requisição depende não pôde ser alcançado: um bucket S3 ou MinIO, ou um host chamado via `fetch()` por uma função que recusou a conexão ou não foi resolvido. O log do servidor informa o host; a resposta não. Um banco de dados inacessível resulta em `DATABASE_UNAVAILABLE`. Falhas de conexão com esses serviços respondem com este código. | Tente novamente; verifique os logs. |

## Mantendo esta página precisa

O comando `pnpm verify:docs` falha se um código que o servidor pode lançar estiver ausente destas
tabelas, se uma tabela listar um código que nada pode lançar, se os status de uma linha não forem
exatamente aqueles com os quais o código-fonte lança o erro, ou se uma família de códigos como `PG_<SQLSTATE>` não possuir uma linha
para um SQLSTATE com o qual os chamadores se deparam. A rotina responsável é
`tooling/scripts/docs-verify/check-error-codes.mjs`.

Ela verifica a si mesma primeiro. A varredura extrai códigos do TypeScript em vez de inspecionar
um servidor em execução, logo seus pontos cegos são silenciosos por concepção: certa vez ela não
conseguiu identificar um código passado através de um wrapper de uma linha, ou outro escrito após uma mensagem
contendo um `)`, reportando que "todos os códigos que o servidor pode lançar estão documentados"
em uma página na qual faltavam dezessete deles. Por isso, a rotina roda uma fixture contendo exatamente
essas estruturas antes de ler esta página, e recusa-se a validar qualquer coisa se não conseguir identificá-las.
