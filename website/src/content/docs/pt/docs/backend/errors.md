---
sourceHash: 3d3d35353574f0e5
title: Códigos de erro
sidebar_label: Códigos de erro
description: Todos os códigos de erro que um backend Rebase pode retornar, com seu status HTTP, o que significam e o que fazer a respeito — além do envelope de resposta, X-Request-ID e as regras de details.
---

Cada falha retornada por um backend Rebase usa um único envelope e contém um
`code` estável. O código é o elemento a ser avaliado em verificações condicionais: a mensagem é escrita para
pessoas e pode ser reformulada, o status é compartilhado por dezenas de problemas
diferentes, mas o código não varia.

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

- **`message`** — legível por humanos. Para um `4xx`, é a mensagem do próprio servidor;
  para um `5xx`, é deliberadamente genérica, pois o texto subjacente pode citar
  um host, uma role ou o nome de uma coluna.
- **`code`** — um dos valores abaixo. Estável entre versões menores.
- **`details`** — opcional e nunca garantido. Veja as regras abaixo.
- **`requestId`** — presente sempre que a requisição passar pelo middleware de request-ID,
  o que abrange todas as rotas sob `basePath`.

### `X-Request-ID`

Toda requisição sob `basePath` recebe um ID: o cabeçalho `X-Request-ID` do chamador
quando for um UUID, ou um valor novo caso contrário. Ele é retornado na
resposta como `X-Request-ID`, incluído no envelope de erro como `requestId` e
anexado à linha de log do servidor para essa requisição.

Essa é a chave de cruzamento. Cite-a em um relatório de bug e um operador poderá encontrar
a linha exata de log que explica a falha, trazendo a razão que nunca
foi exibida ao cliente.

Enviar o seu próprio cabeçalho é a forma de um rastreamento sobreviver a múltiplos saltos: um gateway ou executor de tarefas
que repassa o cabeçalho obtém um único ID em todos os serviços que processaram a requisição.
Um valor inválido é ignorado em vez de rejeitado — um cabeçalho malformado enviado por um
chamador não justifica falhar a requisição —, portanto, não presuma que o ID enviado é
o ID retornado. Leia o cabeçalho da resposta.

### O que há em `details`

`details` serve para diagnósticos, não é contratual. Três regras o regem:

1. **Tudo o que uma rota define explicitamente é sempre retornado.** Tratam-se dos
   próprios erros do chamador descritos com precisão: qual campo de filtro era desconhecido,
   qual relação não permite escrita, qual valor não correspondeu ao seu tipo.
2. **Diagnósticos do banco de dados são omitidos em produção.** Quando a falha se originar
   no Postgres, `details.dbCode` — o SQLSTATE — estará sempre presente: ele nomeia
   a classe do problema e não revela nada sobre os dados. `dbMessage`,
   `detail` e `hint` são adicionados apenas quando `NODE_ENV` não for `production`,
   pois o Postgres inclui o conteúdo das linhas neles. `23505` relata
   `Key (email)=(a@b.c) already exists.`, o que responderia "esta pessoa está
   cadastrada?" para qualquer endereço que alguém tentasse verificar.
3. **Nunca crie lógica condicional baseada em `details`.** Baseie-se em `code`. O que está em
   `details` é apenas o que foi útil para uma pessoa naquele ponto de chamada, e isso pode mudar.

## Interpretando um status

| Status | O que diz sobre a requisição |
| --- | --- |
| `400` | Malformada ou solicitando algo que não existe no esquema. Corrija a requisição. |
| `401` | Não autenticada ou a credencial expirou. Faça login ou renove o token. |
| `403` | Autenticada, mas sem permissão. Tentar novamente com a mesma identidade não ajudará. |
| `404` | Rota, coleção ou linha inexistente — ou uma linha que a segurança em nível de linha (RLS) oculta. |
| `409` | Conflito com o estado existente: uma duplicata ou uma gravação concorrente. |
| `413` `415` `422` | O corpo é grande demais, o tipo de mídia está incorreto ou foi rejeitado semanticamente. |
| `429` | Limite de requisições excedido (rate limited). Aguarde; a mensagem diz por quanto tempo. |
| `500` | O erro está no servidor ou em seu banco de dados, não no chamador. Verifique os logs. |
| `501` | A rota existe, mas esta implantação não pode atendê-la — um recurso desativado ou não configurado. |
| `502` `503` `504` | Uma dependência estava inacessível, não configurada ou lenta demais. |

## Autenticação e contas

| Código | Status | Significado | O que fazer |
| --- | --- | --- | --- |
| `AAL2_REQUIRED` | 403 | A rota requer um segundo fator e a sessão possui apenas um. | Conclua o desafio de MFA e tente novamente. |
| `ALREADY_VERIFIED` | 400 | O endereço ou fator já foi verificado. | Nada — o estado desejado já é verdadeiro. |
| `ACCOUNT_OUTRANKS_CALLER` | 403 | A conta sendo editada, redefinida ou excluída possui uma role ou escopo que o chamador não tem. `details.beyond` os lista. | Peça a alguém que possua essas permissões para fazer a alteração. |
| `ANONYMOUS_AUTH_DISABLED` | 403 | O login anônimo está desativado neste servidor. | Ative-o ou faça login com uma identidade real. |
| `API_KEY_SELF_MANAGEMENT_FORBIDDEN` | 403 | Uma chave de API tentou listar, criar, alterar ou revogar chaves de API, sejam do seu próprio tipo ou pessoais. | Gerencie chaves como um usuário portador de `keys:write` ou com a chave de serviço. |
| `AUTH_MIDDLEWARE_MISSING` | 500 | Uma rota protegida foi executada sem nenhum middleware de autenticação Rebase antes dela, portanto a credencial do chamador nunca foi validada. | Monte a aplicação através do roteador de funções em vez de montá-la diretamente no seu próprio servidor. |
| `BOOTSTRAP_ANONYMOUS` | 403 | O bootstrap do primeiro administrador foi tentado por um chamador anônimo. | Faça login primeiro. |
| `BOOTSTRAP_COMPLETED` | 403 | O primeiro administrador já existe. | Peça a um administrador existente para conceder a role. |
| `BOOTSTRAP_NOT_FIRST_USER` | 403 | O bootstrap é apenas para o primeiro usuário de todos, e este não é ele. | Peça a um administrador existente para conceder a role. |
| `CAPTCHA_FAILED` | 400 | O provedor rejeitou o token do CAPTCHA. | Resolva um novo desafio. |
| `CAPTCHA_REQUIRED` | 400 | A rota requer um token de CAPTCHA e nenhum foi enviado. | Inclua o token. |
| `CHALLENGE_EXHAUSTED` | 401 | Tentativas incorretas em excesso para o mesmo desafio de MFA. | Inicie um novo desafio. |
| `EMAIL_EXISTS` | 409 | Já existe uma conta com esse endereço — no cadastro, na alteração de endereço ou ao acessar um link de alteração de endereço quando outra conta assumiu o endereço enquanto ele aguardava. | Faça login ou inicie uma redefinição de senha; para alteração de endereço, escolha outro endereço. |
| `EMAIL_NOT_CONFIGURED` | 503 | Magic links ou OTP foram solicitados, mas o servidor não tem transporte de e-mail configurado. | Configure o SMTP ou use outro método de login. |
| `EMAIL_NOT_VERIFIED` | 403 | Um login OAuth encontrou uma conta com o mesmo endereço, mas o provedor não verificou esse endereço, portanto ela não foi vinculada. | Faça login com o método existente e execute `POST /auth/link/<provider>`. |
| `FACTOR_NOT_VERIFIED` | 400 | O fator de MFA foi cadastrado, mas nunca confirmado. | Confirme o fator. |
| `IDENTITY_ALREADY_LINKED` | 409 | Essa identidade OAuth pertence a outra conta. | Faça login com ela ou desvincule-a da outra conta primeiro. |
| `IMPERSONATION_FORBIDDEN` | 403 | Uma requisição enviou `x-rebase-impersonate`, mas o chamador não pode executar requisições como outro usuário. Apenas a própria sessão de um administrador autenticado pode fazer isso, nunca uma chave de API ou a chave de serviço. | Envie a requisição com a sessão de um administrador ou omita o cabeçalho. |
| `IMPERSONATION_INVALID` | 400 | `x-rebase-impersonate` foi enviado vazio. | Envie o uid do usuário a ser personificado ou omita o cabeçalho. |
| `IMPERSONATION_TARGET_NOT_FOUND` | 404 | `x-rebase-impersonate` especifica um usuário inexistente ou inativo: nenhuma conta tem esse uid ou ela está desativada. | Verifique o uid. |
| `IMPERSONATION_UNAVAILABLE` | 501 | A autenticação deste backend não pode executar requisições como outro usuário porque seu `AuthAdapter` não possui `resolveUser`. | Implemente `resolveUser` no adapter ou omita o cabeçalho. |
| `IMPERSONATION_UNSUPPORTED` | 400 | `x-rebase-impersonate` foi enviado para uma rota que não oferece suporte à personificação. Apenas a API de dados e funções customizadas oferecem suporte, e o socket realtime aceita `impersonate` em `AUTHENTICATE`. | Envie a requisição sem o cabeçalho. |
| `SIMULATION_FORBIDDEN` | 403 | Uma requisição enviou um cabeçalho `x-rebase-simulate-*` (o simulador de RLS) ou consultou `/api/admin/rls-simulator`, mas seu chamador não tem permissão para simular acesso. Apenas a própria sessão de um administrador autenticado pode simular acesso, nunca uma chave de API ou a chave de serviço. | Envie com a sessão de um administrador ou omita os cabeçalhos. |
| `SIMULATION_INVALID` | 400 | A simulação estava malformada: um cabeçalho foi enviado vazio, `x-rebase-simulate-api-key-id` foi combinado com uma role ou id de usuário, ou a simulação foi combinada com `x-rebase-impersonate`. | Especifique uma role (opcionalmente com um uid), um id de usuário ou um id de chave de API. |
| `SIMULATION_READ_ONLY` | 403 | Uma gravação, exclusão, `_batch`, reversão de histórico ou uma função customizada chamada por qualquer verbo diferente de `GET`/`HEAD`/`OPTIONS` continha um cabeçalho `x-rebase-simulate-*`. O acesso simulado é somente leitura: a gravação seria executada como a identidade simulada, não como o administrador. Leituras, incluindo `POST …/query` e `…/count`, continuam funcionando. | Interrompa a simulação para fazer alterações. |
| `SIMULATION_TARGET_NOT_FOUND` | 404 | A simulação especifica um usuário inexistente ou inativo (um id de usuário enviado sem role) ou nenhuma chave de API ativa. | Verifique o id ou envie uma role junto com o uid para simular um uid que não possui conta. |
| `SIMULATION_UNAVAILABLE` | 501 | Este backend não pode simular acesso: seu `AuthAdapter` não possui `resolveUser` para confirmar um administrador, ou uma chave foi informada em um backend sem chaves de API. | Implemente `resolveUser` ou omita os cabeçalhos. |
| `SIMULATION_UNSUPPORTED` | 400 | Um cabeçalho `x-rebase-simulate-*` foi enviado para uma rota que não aceita acesso simulado. Apenas a API de dados e funções customizadas oferecem suporte. | Envie a requisição sem os cabeçalhos. |
| `GUEST_REFERENCED` | 409 | Um convidado não pôde ser excluído porque uma linha do próprio projeto depende dele, por meio de uma chave estrangeira com `ON DELETE RESTRICT` ou `NO ACTION`. `DELETE /api/admin/guests` relata isso por convidado em `skipped` e continua. | Exclua a linha ou mantenha o convidado. |
| `INVALID_ACCOUNT` | 400 | A conta está em um estado sobre o qual esta operação não pode atuar. | Veja a mensagem. |
| `INVALID_CHALLENGE` | 400 | O desafio de MFA é desconhecido ou expirou. | Inicie um novo desafio. |
| `INVALID_CODE` | 400 / 401 | O código de OTP ou MFA está incorreto: 400 no login por código de e-mail (`/auth/otp/verify`), 401 no cadastro ou desafio de MFA. | Tente novamente com o código atual. |
| `INVALID_CREDENTIALS` | 401 | E-mail ou senha incorretos — omitindo deliberadamente qual deles está errado. | Tente novamente ou redefina a senha. |
| `INVALID_PLATFORM_TOKEN` | 401 | Um token de plataforma `rpt_` foi recusado: assinatura inválida, audience incorreto, expirado ou com tempo de vida superior ao limite máximo. A mensagem informa o motivo. | Solicite à plataforma a geração de um novo token — no Rebase Cloud, execute o comando novamente. |
| `INVALID_SCOPES` | 400 | Foi solicitado para a chave algo que não é um escopo: malformado, desconhecido ou com um alvo que o escopo não aceita. `details.problems` informa quais e por quê; `details.validScopes` lista os escopos que uma chave pode ter. Ele omite `keys:read` e `keys:write`, que nenhuma chave pode possuir. | Use um nome da lista. Veja [Roles e escopos](/docs/backend/roles-and-scopes/). |
| `INVALID_TOKEN` | 400 / 401 | Um token de verificação, redefinição, magic link ou alteração de endereço está malformado, é desconhecido, já foi utilizado ou expirou (400). Uma credencial de provedor OAuth ou refresh token que falha na validação retorna 401. | Solicite um novo link ou faça login novamente. |
| `INVALID_ROLE` | 400 | O nome de role sendo gravado não é uma string, está vazio ou contém `,` `{` `}` `"` `\` ou caracteres de controle. Esses caracteres seriam interpretados como outras roles na leitura: uma role trafega em um `text[]` do Postgres e na lista separada por vírgulas processada pelas políticas de RLS, logo `"support,admin"` seria lido como `admin`. `details.problems` lista cada ocorrência. | Renomeie a role. Qualquer outro nome é aceito. |
| `KEY_MANAGEMENT_SCOPE` | 400 | Foi solicitado `keys:read` ou `keys:write` para uma chave. Nenhuma chave pode gerenciar chaves. `details.scopes` lista esses escopos. | Remova-os da solicitação. |
| `KEY_OUTRANKS_CALLER` | 403 | Um usuário com `keys:write` tentou alterar ou revogar uma chave de serviço que possui uma role ou escopo que ele não possui. Apenas um admin gerencia qualquer chave. `details.roles` e `details.scopes` informam o que a chave possui além das permissões do chamador. | Peça a um admin ou a alguém com essas permissões para alterar a chave. |
| `LAST_ADMIN` | 403 | A alteração deixaria o projeto sem nenhum administrador. | Promova outro usuário primeiro. |
| `MFA_REQUIRED` | 401 | A senha estava correta e a conta possui um segundo fator verificado, portanto o login está apenas na metade. `details` traz um token de curta duração restrito ao desafio de MFA — não é uma sessão. | Abra um desafio e responda a ele; a resposta ao desafio emite a sessão. |
| `NO_SESSION` | 401 | Nenhum cookie de sessão ou refresh token foi fornecido. Comportamento comum no primeiro carregamento de página. | Faça login. |
| `NOT_ANONYMOUS` | 400 | Uma rota de upgrade de conta anônima foi chamada por uma conta real, ou `DELETE /api/admin/guests/:uid` especificou uma conta real. | Não há o que atualizar. Para excluir uma conta, use `DELETE /api/admin/users/:uid`. |
| `OAUTH_ERROR` | 401 | O provedor de OAuth recusou a autenticação ou retornou um erro. | Tente o fluxo novamente; a mensagem contém a razão informada pelo provedor. |
| `PERSONAL_KEYS_DISABLED` | 403 | As chaves de API pessoais estão desativadas neste backend. | Defina `personalKeys: true` no bloco `auth` da coleção de usuários. |
| `PERSONAL_KEY_NEEDS_ACCOUNT` | 403 | A chave de serviço ou uma sessão de convidado tentou usar as rotas de chave pessoal. Nenhuma das duas possui uma conta para a chave representar. | Faça login em uma conta ou crie uma chave de serviço em `/api/admin/api-keys`. |
| `PLATFORM_TOKENS_OFF` | 401 | Um token de plataforma `rpt_` chegou a um servidor que não os aceita: `REBASE_PLATFORM_TOKEN_KEY` e `REBASE_PLATFORM_TOKEN_AUDIENCE` não estão configurados. | A plataforma que hospeda a aplicação define ambos no deploy; faça um novo deploy ou entre na aplicação de outra forma. |
| `RATE_LIMITED` | 429 | Tentativas em excesso vindas deste chamador. | Aguarde; a mensagem informa por quanto tempo. |
| `REDIRECT_URI_NOT_ALLOWED` | 400 | O destino do redirecionamento não está na lista de permissões (allowlist). | Adicione-o à configuração do provedor. |
| `REGISTRATION_DISABLED` | 403 | O autocadastro está desativado. | Peça a um administrador para criar a conta. |
| `ROLE_EXCEEDS_CALLER` | 403 | As roles concedidas possuem um escopo, ou `admin`, que o chamador não tem. `details.beyond` os lista. | Peça a alguém que tenha essas permissões para conceder a role. |
| `ROLE_EXCEEDS_CREATOR` | 403 | Uma chave de serviço recebeu uma role de RLS que seu criador não possui. Apenas um admin pode conceder qualquer role. `details.roles` as lista. | Remova a role ou peça para um admin criar a chave. |
| `ROLE_EXISTS` | 409 | Esse nome de role já está em uso. | Escolha outro nome. |
| `ROLE_LOOKUP_FAILED` | 503 | Não foi possível ler as roles do chamador — em uma rota de admin ou em uma requisição de dados em um backend com `config.auth`. Falha em modo restritivo (fail-closed) em vez de confiar nas roles contidas no token. Um token cujo uid não aponta para nenhuma conta, incluindo um uid que a tabela de usuários não suporta, retorna 401, e não este erro. Um banco de dados inacessível resulta em `DATABASE_UNAVAILABLE`, e não neste erro. | Tente novamente; verifique o banco de dados. |
| `SCOPE_EXCEEDS_CREATOR` | 403 | Foi solicitado para uma chave um escopo que seu criador não possui. Uma chave nunca possui mais permissões do que a conta que a gerou. `details.scopes` os lista. | Remova-os ou peça a alguém que possua esses escopos para criar a chave. |
| `SCOPE_MISSING` | 403 | A credencial não possui o escopo necessário para esta rota, coleção, fonte de armazenamento ou função. `details.requiredScope` informa qual é, incluindo o alvo. | Para usuários, atribua uma role com o escopo. Para chaves, utilize uma chave que o possua. Veja [Roles e escopos](/docs/backend/roles-and-scopes/). |
| `SCOPE_NOT_DECLARED` | 500 | Uma rota protegida com `requireScope` especifica um escopo de app não declarado por este backend, portanto ninguém o possui, nem mesmo administradores. Nomes que não são escopos válidos ou erros de digitação em escopos integrados (como `data:raed`) não chegam a esse ponto: `requireScope` lança um erro no registro da rota. | Declare o escopo em `auth.scopes` na coleção de usuários ou corrija o nome. Veja [Roles e escopos](/docs/backend/roles-and-scopes/). |
| `SELF_DELETE` | 400 | Um administrador tentou excluir a própria conta. | Peça a outro administrador para fazê-lo. |
| `SESSION_REVOKED` | 401 | A sessão foi encerrada em outro lugar, todas as sessões foram revogadas ou a conta foi excluída. Todos os pontos de entrada que aceitam sessão respondem desta forma a tal access token: API de dados, storage, funções customizadas e rotas de administração. O socket realtime rejeita seu `AUTHENTICATE` com um frame `AUTH_ERROR` contendo o mesmo código. O SDK tenta renovar, a renovação é recusada e a sessão é encerrada. | Faça login novamente. |
| `ACCOUNT_DISABLED` | 401/403 | Um administrador desativou a conta: o login (403), a renovação e todos os tokens que ela possui (401) são recusados em todos os pontos que aceitam sessão. O socket realtime rejeita seu `AUTHENTICATE` com um frame `AUTH_ERROR` contendo o mesmo código. | Contate um administrador. |
| `EMAIL_NOT_CONFIRMED` | 403 | `requireEmailVerification` está ativo e o endereço ainda não foi verificado. Retornado apenas para senhas corretas; um novo link é enviado por e-mail. | Acesse o link enviado por e-mail. |
| `PROOF_REQUIRED` | 409 | `POST /auth/verify-email`: a conta possui uma senha ou identidade que ninguém comprovou, e a requisição não comprova nenhuma das duas. O token não é consumido. | Envie `password` para mantê-la ou `removeUnproven: true` para verificar sem ela. |
| `UNDELIVERABLE_ADDRESS` | 400 / 409 | Foi solicitado um e-mail de verificação para um endereço inacessível — endereço de convidado ou placeholder do X (400) — ou uma conta tentou mudar para tal endereço (409, `POST /auth/change-email`). | Defina um endereço real primeiro. |
| `EMAIL_UNCHANGED` | 400 | `POST /auth/change-email` informou o mesmo endereço atual da conta. | Nada a alterar. |
| `ANONYMOUS_USER` | 403 | Um convidado tentou alterar seu endereço de e-mail; convidados não possuem e-mail próprio. | Converta-o em uma conta antes (`POST /auth/anonymous/link`). |
| `MFA_NOT_ENROLLED` | 400 | Códigos de recuperação foram solicitados para uma conta sem um segundo fator verificado. | Cadastre um fator primeiro. |
| `HOOK_REJECTED` | 400 | Um hook `beforeUserCreate`, `beforeLogin`, `beforeUserDelete` ou `beforeEmailChange` lançou um erro. A mensagem exibida é a do hook; um hook que selecionou um status 4xx responderá com ele. | Veja a mensagem. |
| `INVALID_JSON` | 400 | O corpo da requisição não é um JSON válido. | Envie um corpo no formato JSON. |
| `SELF_DISABLE` | 400 | Um administrador tentou desativar a própria conta. | Peça a outro administrador. |
| `NOT_SUPPORTED` | 501 | O repositório de autenticação deste backend não oferece suporte à ação solicitada (desativar contas, alterar endereço). | Reinicie o servidor para que a coluna seja adicionada ou utilize um repositório compatível. |
| `UNKNOWN_SCOPE_TARGET` | 400 | O alvo do escopo especifica uma coleção, fonte de armazenamento ou função não atendida por este backend. `details` lista as opções disponíveis. | Corrija o alvo. |
| `UNVERIFIED_IDENTITIES` | 409 | Um magic link, código por e-mail ou redefinição de senha confirmou o endereço de uma conta não verificada, mas a conta contém uma identidade de login cujo provedor nunca validou esse endereço. Como o repositório de autenticação não consegue removê-la (falta `unlinkUserIdentity`), a confirmação é recusada para não manter essa brecha em uma conta verificada. | Implemente `unlinkUserIdentity` no repositório customizado de autenticação ou solicite a um admin que revise a conta. |
| `SETUP_REQUIRED` | 403 | O projeto ainda não possui administradores, portanto esta rota não está disponível. | Conclua a configuração do primeiro administrador. |
| `TOKEN_ALREADY_USED` | 401 | Um token de uso único foi reutilizado, ou um refresh token que sofreu rotação há mais tempo do que `refreshTokenReuseIntervalSeconds` foi apresentado. | Solicite um novo ou faça login novamente. |
| `TOKEN_EXPIRED` | 401 | O tempo de vida do token expirou. | Solicite um novo token. |
| `USER_NOT_FOUND` | 404 | Nenhuma conta encontrada com este id. | Verifique o id. |
| `WEAK_PASSWORD` | 400 | A senha não atende à [política de senhas](/docs/backend/auth-endpoints/#password-policy) (por padrão, mais de 8 caracteres contendo maiúsculas, minúsculas e dígitos) — no cadastro, redefinição, alteração ou definição por administrador: `POST /api/admin/users`, criação na coleção de usuários via API de dados, `PUT /api/admin/users/:id` ou `POST /api/admin/users/:id/reset-password`. | Escolha uma senha mais forte. Um administrador importando contas pode enviar `skipPasswordPolicy: true` na criação. |

## Dados, consultas e gravações

| Código | Status | Significado | O que fazer |
| --- | --- | --- | --- |
| `AGGREGATE_MASKED_BY_AFTER_READ` | 400 | Um agregador diferente de `count()` sem `groupBy` em uma coleção que um callback `afterRead` reescreve (global, coleção ou propriedade). Uma agregação lê os valores armazenados e nunca executa o callback, portanto uma soma, mínimo, máximo, contagem de campo ou agrupamento leria o que o callback oculta. | Use `count()` sem `groupBy` ou leia as linhas, que passam pelo callback. |
| `AGGREGATE_NOT_SUPPORTED` | 501 | Este driver não é capaz de calcular o agregado solicitado. | Use um driver compatível ou calcule no cliente. |
| `BRANCHING_UNSUPPORTED` | — | Foi solicitada uma branch de banco de dados via WebSocket do Studio no banco de desenvolvimento gerenciado (PGlite), onde a branch *é* o próprio pai e nada ficaria isolado. A recusa é a mesma exibida por `rebase db branch`. | Aponte `DATABASE_URL` para uma instância própria do Postgres (`rebase dev --docker` inicia uma) e crie as branches nela. |
| `BATCH_TOO_LARGE` | 400 | `POST /api/data/_batch` contém mais operações do que o limite por lote (por padrão, 1000). Um lote é uma única transação e mantém seus bloqueios durante toda a execução. | Envie em partes; a mensagem informa o limite e a sua contagem. |
| `BATCH_UNSUPPORTED` | 400 | O driver deste backend não suporta gravações atômicas entre coleções diferentes, e um loop de gravações isoladas não seria nem atômico nem uma única viagem de rede. | Envie as gravações como requisições separadas ou por meio de chamadas `/bulk` individuais por coleção. |
| `BULK_TOO_LARGE` | 400 | O corpo da operação em massa excede o limite configurado de itens. | Divida a requisição. |
| `BULK_UNSUPPORTED` | 400 | Esta coleção ou driver não suporta gravações em massa. | Grave as linhas individualmente. |
| `CALLBACK_REJECTED` | 400 / 403 | Um callback de coleção rejeitou a gravação. Um `throw` em `beforeSave`/`beforeDelete`/`after*` resulta em um 400 contendo a mensagem definida pelo autor; um `beforeDelete` que retorna `false` resulta em 403. `details.stage` identifica o callback e `details.path` a coleção. | Leia a mensagem — ela foi escrita neste projeto, não pelo Rebase. |
| `CALLBACK_RECURSION` | 500 | Gravações iniciadas por hooks aninharam-se em mais de 16 níveis de profundidade: uma gravação `context.data` de um hook executa novamente os hooks dessa coleção e nada na cadeia a interrompe — normalmente um `afterSave` atualizando sua própria linha incondicionalmente. Toda a gravação foi revertida. A mensagem informa o hook e a coleção; `details.chain` lista cada etapa de hook → gravação. | Torne a gravação do hook condicional: atue apenas em `status === "new"` ou ignore-a quando `values` já contiverem o que seria gravado. |
| `COLLECTION_READ_ONLY` | 405 | Uma gravação chegou a uma coleção que serve uma view SQL (`view`). Uma view é somente leitura. | Grave nas tabelas que a view lê. Veja [Views](/docs/collections/views/). |
| `SQL_NOT_ALLOWED` | 400 | O SQL executado como o chamador (`getSql(c)`, `withAuth(user).sql`) não era uma única instrução simples `SELECT`, `WITH`, `VALUES`, `TABLE`, `INSERT`, `UPDATE`, `DELETE` ou `MERGE`, ou chamava `set_config` ou citava `pg_settings`. A identidade do chamador fica em configurações de sessão, então uma instrução capaz de alterá-las é recusada. | Mantenha o texto da consulta sob seu controle, uma única instrução, com todo valor em `params`. Veja [Funções personalizadas](/docs/backend/custom-functions/#3-getsqlc--sql-as-the-caller). |
| `CURSOR_WITH_OFFSET` | 400 | `?after=` foi combinado com `?offset=` ou `?page=`. Como o cursor já indica onde a página começa, aplicar um offset sobre ele pula silenciosamente essa quantidade de linhas após o cursor — uma lacuna invisível para o chamador na resposta. | Use apenas um ou outro. |
| `DISTINCT_NOT_APPLICABLE` | 400 | `?distinct=true` foi combinado com busca textual ou vetorial. Ambas atribuem uma pontuação (score) por linha, o que torna cada linha única e impede o `DISTINCT` de colapsar qualquer coisa — pareceria ter funcionado sem alterar nada. | Remova uma das opções. |
| `DISTINCT_ORDER_BY_NOT_SELECTED` | 400 | Uma leitura com `distinct` está ordenada por uma coluna que não está presente no retorno. Um `SELECT DISTINCT` só pode ser ordenado por colunas contidas em sua lista de seleção, caso contrário as linhas agregadas não terão uma ordenação definida. `details.fields` as lista. | Adicione esses campos a `?fields=` ou remova-os de `?orderBy=`. |
| `DATABASE_UNAVAILABLE` | 503 | Não foi possível conectar ao banco de dados: conexão recusada ou perdida, falha na resolução do host, servidor iniciando/desligando ou o banco está fechado para novas conexões (`ALLOW_CONNECTIONS false`, deixado na origem quando um `rebase db branch create --force` é interrompido no meio; o log do servidor informa o banco e `rebase db branch list` o reabre). Retornado em todos os acessos, incluindo login, rotas de admin e socket realtime (frame `ERROR`). Enviado com `Retry-After: 5`. | Tente novamente; o SDK faz isso automaticamente. Verifique se o banco está ativo e acessível a partir do servidor. |
| `DB_CONNECTIONS_EXHAUSTED` | 503 | O servidor de banco de dados recusou uma nova conexão porque atingiu o limite (`53300` clientes em excesso, `53400` limite de conexões da role ou do banco). Todas as instâncias do servidor compartilham o `max_connections`, logo isso ocorre com frequência quando várias instâncias possuem pools grandes sem um pooler intermediário. Trata-se de sobrecarga, não de falha interna; enviado com `Retry-After: 2`. O servidor registra a solução no log uma vez por minuto. | Tente novamente; o SDK faz isso automaticamente. Reduza `DB_POOL_MAX` (ou limite-o com `REBASE_DB_POOL_MAX`) entre as instâncias, coloque um pooler à frente do banco (`DATABASE_POOLED`) ou aumente `max_connections`. |
| `DB_CONNECT_TIMEOUT` | 503 | A abertura de uma nova conexão com o banco demorou mais que `DB_POOL_CONNECT_TIMEOUT`: o banco está demorando para aceitar conexões ou está distante na rede. Enviado com `Retry-After`. | Tente novamente; o SDK faz isso automaticamente. Avalie a carga do banco e a latência de rede. |
| `DB_PERMISSION_DENIED` | 500 | O Postgres recusou o comando (`42501`): devido a uma política de segurança a nível de linha negando a role ou a um `GRANT` faltante. | Veja a seção de [Solução de problemas](/docs/troubleshooting/). |
| `DB_POOL_EXHAUSTED` | 503 | Todas as conexões do pool de banco permaneceram ocupadas durante `DB_POOL_CONNECT_TIMEOUT`, impedindo esta requisição de chegar ao banco. Sobrecarga, não falha interna; enviado com `Retry-After`. O servidor registra a solução no log uma vez por minuto. | Tente novamente; o SDK faz isso automaticamente. Aumente `DB_POOL_MAX` ou identifique as consultas lentas e transações longas que estão retendo conexões. |
| `FIELD_NOT_READABLE` | 400 | Um filtro, `orderBy`, `fields`, `select` de agregação ou `groupBy` referencia um campo que as roles do chamador não podem ler (`access.read`), ou um caminho aninhado/ordenação agregada referencia uma relação sem permissão de leitura — ou uma operação de campo (`$inc`, `$push`, …) tem como alvo um desses campos, onde uma recusa de limite revelaria o valor armazenado. Qualquer campo que não pode figurar na resposta também não pode ser consultado, caso contrário o valor poderia ser inferido predicado por predicado. Filtros por relação (`author.salary`) e ordenações agregadas no campo de uma relação (`max(staff.salary)`) são avaliados pela regra do alvo. `details.violations` cita cada campo. Campos ocultados por `excludeFromApi` agem como se não existissem: referenciá-los em filtros, `orderBy`, `fields`, `include`, agregação ou `vector_search` gera exatamente a mesma resposta dada a nomes inexistentes (`UNKNOWN_FILTER_FIELD`, `UNKNOWN_ORDER_BY_FIELD`, `UNKNOWN_FIELD`, `UNKNOWN_RELATION`, `UNKNOWN_AGGREGATE_FIELD` ou `UNKNOWN_VECTOR_PROPERTY`), e nenhuma lista de campos desconhecidos os revelará. | Remova o campo da consulta ou obtenha a role necessária. Veja [Acesso a campos](/docs/collections/field-access/). |
| `FIELD_NOT_WRITABLE` | 400 | O corpo define um campo no qual as roles do chamador não possuem permissão de escrita (`access.write`). A requisição é recusada em vez de descartar o campo silenciosamente: descartar reportaria sucesso para uma edição inexistente. Esse mesmo código recusa escritas via registro-pai que definem relações não graváveis pelo chamador, além de updates que atribuem valores a campos de `softDelete` — somente deleções marcam esse campo. `details.violations` lista cada campo. | Remova o campo ou obtenha a role necessária. Campos que ninguém pode gravar respondem com `VALIDATION_EXCLUDED_FIELDS`. |
| `FILTERED_USER_WRITE` | 400 | Uma atualização ou exclusão com filtro foi enviada via HTTP para a coleção de usuários, cujas escritas são verificadas usuário por usuário antes de serem executadas. | Leia os usuários e depois use `updateMany`/`deleteMany` por id. |
| `FILTER_REQUIRED` | 400 | Uma escrita com filtro (uma atualização ou exclusão por `where`/`logical`, pelo SDK ou pelas rotas em massa) não traz nenhuma condição e, portanto, atingiria todas as linhas. Recusada antes de executar qualquer coisa. | Adicione uma condição. Para alterar todas as linhas de propósito, declare isso com uma condição que todas as linhas satisfaçam. |
| `HISTORY_UNAVAILABLE` | 503 | Uma escrita em uma coleção com `history: true` foi recusada porque o registro de histórico não pôde ser gravado: o banco não possui a tabela `rebase.entity_history` ou, para `openRebase` e `rebase console`, não possui a função `rebase.record_history`. Nenhum backend com histórico ativo foi inicializado neste banco de dados. Nada foi executado (inclusive callbacks), e as leituras não foram afetadas. Lançado por `openRebase` e retornado por backends criados com `provision: false`. | Inicialize o backend uma vez com histórico ativado e `provision: true` (`rebase dev` faz isso) e tente novamente. |
| `IDEMPOTENCY_KEY_IN_PROGRESS` | 409 | Uma requisição anterior com o mesmo `Idempotency-Key` ainda está em execução. | Tente novamente assim que ela terminar. |
| `IDEMPOTENCY_KEY_REUSED` | 422 | O mesmo `Idempotency-Key` foi enviado em uma requisição diferente: método, caminho, query string ou corpo divergentes. | Use uma nova chave ou reenvie a requisição original. |
| `INVALID_AGGREGATE_FUNCTION` | 400 | `?select=` especificou uma função que não é de agregação (`count`, `sum`, `avg`, `min`, `max`, `countDistinct`, `mode`, `percentile`, `distinct`, `fingerprint`). | Use uma dessas opções; a mensagem lista as disponíveis. |
| `INVALID_AGGREGATE_GROUP` | 400 | Uma transformação de `groupBy` é desconhecida ou não se aplica à sua coluna: `year`/`month`/`day` em uma coluna que não é data, `unnest` em uma que não é array. | Use `lower`, `upper`, `year`, `month`, `day` ou `unnest`, em uma coluna do tipo correto. |
| `INVALID_AGGREGATE_SELECT` | 400 | Um item de `?select=` não está no formato `fn(field)`; uma função diferente de `count()` ou `fingerprint()` foi chamada sem informar um campo; `percentile` não tem uma fração de 0 a 1; ou `fingerprint()` foi pedido a uma view simples, que não armazena linhas. | Escreva `sum(total)`, `count()`, `percentile(price,0.95)`. |
| `INVALID_AGGREGATE_WINDOW` | 400 | Uso de `offset`, `page` ou `orderBy` em uma agregação sem `groupBy`, ou uso de cursor em qualquer agregação. Agregações sem agrupamento retornam apenas uma linha, e um grupo não é uma linha que permita continuação via cursor. | Adicione `groupBy` ou remova esses parâmetros; pagine grupos com `offset` ou `page`. Veja [Agregações](/docs/sdk/aggregates-and-search/#aggregates). |
| `INVALID_BATCH_BODY` | 400 | Uma operação em `/_batch` não possui `op`, `collection`, `values` ou `id`, referencia uma coleção não atendida por este backend ou reutiliza um nome de `ref`. | Veja a mensagem; ela informa o índice da operação. |
| `INVALID_BATCH_REF` | 400 | Um `{ "$ref": "<name>.<field>" }` referencia uma operação inexistente, aponta para a frente no lote ou solicita um campo que a linha referenciada não tem. Apenas referências anteriores são resolvidas. | Atribua o `ref` à operação *antes* de referenciá-la. |
| `INVALID_BULK_BODY` | 400 | O corpo da requisição em massa não possui o formato esperado. | Envie o array esperado pela rota: `{ "rows": [...] }` para `POST /bulk`, `{ "updates": [{ "id", "data" }] }` para `PATCH /bulk`, `{ "ids": [...] }` para `POST /bulk/delete`. |
| `INVALID_CONFLICT_RULE` | 400 | Uma regra de conflito de upsert (manter duplicados, ou substituir só conforme um `where`) foi enviada sem `upsert: true`, ou as duas regras juntas. | Envie `upsert: true` e um dos dois. |
| `INVALID_CONFLICT_TARGET` | 400 | O parâmetro `on_conflict` / `onConflict` de um upsert define colunas sem garantia de unicidade, é enviado sem `upsert: true` ou está presente em uma criação aninhada (onde a linha correspondente seria movida para sob o novo pai). Caso contrário, o Postgres retornaria 42P10 dentro de uma transação com operações já realizadas. Aplica-se também a qualquer upsert na coleção de usuários (auth), onde criação e atualização seguem regras distintas. | Declare `validation: { unique: true }` ou crie um índice `unique`; a mensagem lista os alvos existentes. Na coleção de usuários, envie `POST` para criar e `PATCH` para atualizar. |
| `INVALID_COUNT` | 400 | `?count=` possui valor diferente de `exact` ou `none`. A requisição é recusada em vez de usar o padrão: um erro de digitação como `?count=nnone` pagaria pelo custo de contagem que tentava evitar. | Envie `exact` (o padrão) ou `none`. Veja [Ignorando a contagem](/docs/backend/api/#skipping-the-count). |
| `INVALID_CURSOR` | 400 | O cursor `after` não pôde ser lido ou especifica um id de linha incompatível com as colunas de chave da coleção: foi truncado, recodificado ou construído manualmente. Um cursor válido enviado com um `orderBy` diferente daquele com o qual foi gerado resulta em `CURSOR_ORDER_MISMATCH`, também um erro 400. | Repasse o `meta.nextCursor` da página anterior sem alterações, mantendo o mesmo `orderBy` ou nenhum. Veja [Paginação](/docs/sdk/pagination/). |
| `INVALID_DELETED_PARAM` | 400 | `?deleted=` não é `include` nem `only`. O valor é recusado em vez de ignorado: digitar incorretamente `?deleted=true` ocultaria silenciosamente todas as linhas excluídas, parecendo funcionar mas respondendo à pergunta oposta. | Envie `include` (ativas e excluídas) ou `only` (apenas excluídas). Omita o parâmetro para buscar somente linhas ativas. |
| `INVALID_DISTINCT` | 400 | `?distinct=` não é `true` nem `false`. | Envie um desses valores; `1` e `0` também são aceitos. |
| `INVALID_FIELD_OPERATION` | 400 | Um `$inc` / `$push` / `$pull` / `$merge` foi aplicado a um tipo de propriedade incompatível, com operando no formato incorreto, com múltiplos operadores no mesmo campo, com erro de digitação ou em uma criação — onde não há valor anterior armazenado. | Veja [Gravando via REST](/docs/backend/writes/#field-operations); a mensagem cita o campo. |
| `INVALID_FILTERED_WRITE` | 400 | Uma escrita com filtro apontou para um caminho através de uma relação (`posts/1/comments`) ou para nenhuma coleção. | Escreva na coleção relacionada com um filtro sobre o seu vínculo. |
| `INVALID_FILTER_FIELD` | 400 | O filtro referencia uma propriedade inexistente nesta coleção. | Verifique o nome da propriedade na coleção. |
| `INVALID_FILTER_OPERATOR` | 400 | O operador não é aceito por este tipo de propriedade — por exemplo, usar `like` em um número ou data. | Veja [Consultando dados](/docs/sdk/querying/). |
| `INVALID_FILTER_VALUE` | 400 | O valor do filtro não pode ser convertido para o tipo da coluna comparada: `?id=eq.abc` em uma chave inteira, um valor fora do enum, timestamp inválido ou número fora do intervalo do tipo. `details.dbCode` traz o SQLSTATE correspondente. | Envie um valor compatível com o tipo da coluna. |
| `INVALID_HARD_PARAM` | 400 | `?hard=` não é `true` nem `false`. Qualquer outro valor é recusado em vez de interpretado como "falso" — um erro de digitação que faz soft-delete quando o chamador solicitou exclusão definitiva faria o usuário acreditar que os dados foram apagados. | Envie `true` ou `false`. |
| `INVALID_INCLUDE` | 400 | `?include=` está malformado: não é uma lista de caminhos válida ou o objeto de opções da relação possui formato incorreto. Caminhos com aninhamento superior a três níveis retornam `INCLUDE_TOO_DEEP`, também um erro 400. Validado na borda para evitar que o driver lance um 500. | Veja a mensagem; ela cita o caminho problemático. |
| `INVALID_INPUT` | 400 | O corpo da requisição falhou na validação. | Veja a mensagem. |
| `INVALID_LIMIT` | 400 | `?limit=` não é um número inteiro de 1 até o máximo permitido (1000 por padrão); valores maiores são recusados, não ajustados. Uma assinatura realtime solicitando um limite fora desse intervalo recebe o mesmo código em um frame `ERROR` do WebSocket. | Reduza o limite e pagine o restante dos dados. |
| `INVALID_LOGICAL_GROUP` | 400 | Um agrupamento `?or=` / `?and=` / `?not=` está malformado ou aninhado além do nível de profundidade permitido. | Veja a mensagem; ela explica a regra de nivelamento (flattening). |
| `INVALID_OFFSET` | 400 | `?offset=` não é um número inteiro igual ou superior a 0. | Envie um inteiro não negativo. |
| `INVALID_ORDER_BY` | 400 | `?orderBy=` não corresponde a `field`, `field:desc`, `field:desc:last`, ou a um array JSON de `{ field, direction, nulls }` — ou especifica uma direção diferente de `asc`/`desc`, ou posicionamento de nulos diferente de `first`/`last`. | Veja a mensagem; ela apresenta os formatos aceitos. |
| `INVALID_PAGE` | 400 | `?page=` não é um número inteiro igual ou superior a 1. A numeração de páginas começa em 1, logo `?page=0` é tratado como erro e não como primeira página. | Envie `1` ou mais, ou use `?offset=`. |
| `INVALID_PARAM` | 400 | Um parâmetro de consulta está malformado. | Veja a mensagem. |
| `INVALID_QUERY_BODY` | 400 | O corpo de `POST …/query` contém um valor inválido para a URL correspondente: uma lista para um parâmetro que a URL lê uma única vez (`fields`, `limit`, …), um objeto para um filtro, ou a duplicação de parâmetros na URL — `POST …/query` lê todos os parâmetros a partir do corpo. | Formate cada valor conforme esperado na URL — string, ou lista no caso de filtros repetidos; `where`, `include`, `orderBy` e `vector` aceitam JSON. Veja [Consultas longas demais para uma URL](/docs/backend/vector-search/#queries-too-long-for-a-url). |
| `INVALID_VECTOR` | 400 | `?vector=` não é um array JSON de números. | Envie `[0.1,0.2,0.3]`. |
| `INVALID_VECTOR_DISTANCE` | 400 | `?vector_distance=` é diferente de `cosine`, `l2` ou `inner_product`. | Use uma dessas três opções. |
| `INVALID_VECTOR_THRESHOLD` | 400 | `?vector_threshold=` não é um número. | Envie um número. |
| `INVALID_WHERE` | 400 | `?where=` não é um objeto JSON mapeando campos a condições. | Envie `{"status":["==","active"]}`. |
| `KEY_IMMUTABLE` | 400 | Uma atualização especifica a chave da linha com um valor diferente daquele pelo qual ela foi acessada — no corpo da requisição ou gravado por um `beforeSave`. Uma linha não pode mudar de chave primária: todas as etapas posteriores à gravação (releitura, `afterSave`, histórico, realtime) utilizam a chave original. O erro é retornado antes de qualquer hook rodar, sem nada ser gravado, em todos os endpoints. `details.violations` cita o campo. | Crie a linha com a nova chave e exclua a anterior. Manter a mesma chave que a linha já possui é permitido. |
| `MISSING_AGGREGATE_SELECT` | 400 | A rota de agregação foi chamada sem o parâmetro `?select=`. | Adicione o parâmetro, ex: `?select=count()`. |
| `NOT_A_MATERIALIZED_VIEW` | 400 | `refresh()` foi chamado em uma coleção que não serve uma view materializada. | Atualize apenas uma coleção com `view: { materialized: true }`. |
| `NO_COLLECTIONS` | 404 | O projeto não possui coleções ativas: nenhuma declarada no código e nenhuma tabela para derivá-las. Quando existem tabelas mas a segurança a nível de linha está desligada nelas, a mensagem indica quais são, exibindo o SQL para ativá-la, e `details.unprotectedTables` as lista. | Crie tabelas — via migration, SQL ou arquivo de coleção com `rebase db push` — e reinicie. |
| `NOT_FOUND` | 404 | Nenhuma linha com esse id na coleção informada — ou a linha está oculta para este chamador pelas regras de RLS. | Verifique o id e, em seguida, as `securityRules` da coleção. |
| `UNKNOWN_RELATION` | 400 / 404 | `?include=` referencia algo que não é uma relação na coleção. O mesmo código resulta em **404** quando um *caminho de URL* aninhado referencia uma relação inválida, como `/api/data/authors/1/posts` onde `authors` não possui essa declaração — nesse caso a URL aponta para algo inexistente, sendo um recurso não encontrado em vez de requisição malformada. | Verifique o nome da relação — a mensagem lista as opções válidas da coleção. Uma referência reversa precisa estar declarada no pai para poder ser percorrida. |
| `ORDER_BY_FIELD_NOT_SORTABLE` | 400 | A ordenação referencia uma propriedade que não permite ordenação. | Ordene por uma propriedade vinculada a uma coluna real. |
| `PAGE_WITH_OFFSET` | 400 | `?page=` foi combinado com `?offset=` — ou `page` com `offset` em um `find()`, combinação rejeitada com o mesmo código antes do envio pelo SDK do cliente, pelo `rebase.data` interno e pelo cliente offline. Ambos definem a mesma janela, e anteriormente `page` sobrescrevia `offset` sem aviso prévio. | Envie apenas um deles. |
| `PAYLOAD_TOO_LARGE` | 413 | O corpo da requisição excede o limite configurado. | Reduza o tamanho do corpo ou aumente o limite permitido. |
| `READ_ONLY_TRANSACTION` | 409 | Um callback `afterRead` tentou realizar uma gravação. Leituras no escopo de uma requisição rodam em transações `READ ONLY`, portanto nem o callback nem nada chamado por ele pode realizar escritas. | Mova a escrita para fora do ciclo de leitura: use um background job, ou execute `rebase.dataAsAdmin` a partir de um cron job ou função customizada. |
| `REFRESH_NOT_SUPPORTED` | 501 | `POST /api/data/<slug>/refresh` chegou a um driver de dados sem views materializadas. | Não há nada para atualizar neste backend. |
| `RELATION_HAS_NO_PIVOT` | 400 | A gravação continha dados de junção (link payload), mas o caminho não alcança seu destino através de um `manyToMany` que declare `through.properties` — logo, não há tabela intermediária para armazená-los. | Declare `through.properties` na relação ou remova o payload da gravação. Veja [Relações](/docs/collections/relations/). |
| `RELATION_MISCONFIGURED` | 500 | Uma relação não pôde ser resolvida com base no esquema registrado. A operação é recusada em vez de ignorada: ignorá-la reportaria sucesso para uma gravação que nunca ocorreu, ou traria resultados vazios para registros existentes. | Execute `rebase schema generate` se o esquema gerado for mais antigo que o banco de dados. |
| `RELATION_NOT_UNLINKABLE` | 400 | O vínculo da relação não pode ser desfeito a partir deste lado. | Execute a alteração a partir do lado proprietário da relação. |
| `RELATION_NOT_WRITABLE` | 400 | O caminho aninhado não é uma relação gravável, ou uma operação de criação/atualização referencia uma relação `via` com múltiplos saltos — apenas relações `via` de salto único permitem escrita. `details.fields` lista as chaves `via`. Nada foi gravado. | Grave diretamente nas tabelas intermediárias unidas pela cadeia. Veja [Relações](/docs/collections/relations/#via--an-explicit-join-chain). |
| `RELATION_PIVOT_UNSUPPORTED` | 400 | A relação declara colunas de junção, mas esta fonte de dados não suporta escrita nelas. | O vínculo em si é criado normalmente; apenas os dados adicionais não são gravados. Verifique as capacidades do driver. |
| `RELATION_SOURCE_KEY_EMPTY` | 400 | A gravação de uma relação não possuía a chave de origem necessária para vincular os registros. | Salve a linha pai primeiro. |
| `RESULT_TOO_LARGE` | — | Uma instrução executada via `EXECUTE_SQL` no socket realtime — `admin.executeSql` pelo cliente ou leituras de catálogo no painel de administração — retornou mais de 128 MB de linhas, impedindo o envio do resultado. Retornado como frame `ERROR` do WebSocket. Execuções no próprio console SQL não sofrem essa recusa: elas exibem apenas as primeiras linhas. | Adicione um `LIMIT`, selecione menos colunas e leia o resultado em partes. |
| `ROW_IN_TRASH` | 409 | A chave informada em um upsert pertence a uma linha que está na lixeira (uma linha com soft-delete ainda retém sua chave). Um upsert não sobrescreve linhas excluídas, em nenhum endpoint: `?on_conflict=` no REST, `/bulk`, upserts em `/_batch`, SDK e socket realtime. Nada foi gravado. | Restaure a linha primeiro (atualizando o campo de soft-delete para `null`) ou purgue-a definitivamente com `?hard=true` antes de tentar o upsert novamente. Veja [Soft delete](/docs/collections/soft-delete/). |
| `SCHEMA_DRIFT` | 500 | Uma tabela ou coluna esperada pelo código não existe no banco de dados. | Execute `rebase db push` em desenvolvimento; faça um novo deploy em instâncias gerenciadas. |
| `SCORE_CURSOR_UNSUPPORTED` | 400 | `startAfter` foi combinado com `orderBy: "_score"`. A relevância é calculada dinamicamente a cada consulta e não fica armazenada, não podendo servir de chave para um cursor. | Pagine os resultados por relevância usando `limit`/`offset` ou ordene por uma coluna real. |
| `SQL_ERROR` | 400 | O banco recusou um SQL inserido manualmente. No `EXECUTE_SQL` do socket realtime, isso retorna um frame `ERROR` trazendo a mensagem do banco. `POST /api/admin/sql/csv` retorna o erro antes de qualquer envio de arquivo: erro de sintaxe, tentativa de escrita (o download é estritamente somente leitura), múltiplos comandos ou uma role não autorizada para a conexão. | Corrija o SQL. Downloads aceitam apenas um único comando `SELECT`, `WITH … SELECT`, `TABLE` ou `VALUES`. |
| `VIEW_NOT_READABLE` | 403 | Um chamador sem nenhuma das `view.roles` de uma view materializada tentou lê-la ou atualizá-la. Uma view materializada não tem row-level security, então é servida inteira e apenas a essas roles. | Leia-a com uma das roles, ou declare a role do chamador em `view.roles`. |
| `TENANT_IMMUTABLE` | 400 | A gravação moveria a linha para outro tenant. Uma linha não pode mudar de tenant. `details.violations` cita o campo. Um trigger aplica a mesma regra no banco de dados, então o SQL executado como o chamador falha com o erro Postgres `42501` e uma mensagem que começa com `TENANT_IMMUTABLE`. | Crie a linha no novo tenant e exclua a antiga, ou grave usando uma role inclusa em `tenant.bypassRoles`. |
| `TENANT_MISMATCH` | 400 | A gravação especifica um tenant ao qual este chamador não pertence; a operação também seria rejeitada pelo próprio banco de dados. | Grave em um tenant ao qual o chamador pertença ou autentique-se com credenciais vinculadas a ele. |
| `TENANT_REQUIRED` | 400 | A coleção é restrita a tenants e o tenant atual não pôde ser inferido: a requisição não informa nenhum ou o chamador pertence a múltiplos tenants. | Envie o campo do tenant explicitamente ou autentique-se com um usuário que pertença a apenas um tenant. |
| `TRANSACTION_ABORTED` | 500 | Uma instrução falhou na transação de escrita e um callback capturou o erro. Como o Postgres já havia abortado a transação, a gravação foi revertida por completo e nada foi salvo. Apenas criações, atualizações ou exclusões via `context.data` rejeitadas pelo banco são revertidas individualmente e podem ser capturadas com segurança. | Deixe o erro subir na pilha ou valide os dados antes de rodar o comando. Veja [Semântica de transações](/docs/collections/context-data-api/#transaction-semantics). |
| `UNKNOWN_FIELD` | 400 | `?fields=` solicita um campo inexistente na coleção. | Verifique a grafia; a mensagem lista os campos válidos. |
| `UNKNOWN_AGGREGATE_FIELD` | 400 | Uma agregação ou `groupBy` referencia um campo inexistente na coleção. | Verifique a grafia; a mensagem lista os campos válidos. |
| `UNKNOWN_FILTER_FIELD` | 400 | O filtro referencia um campo inexistente na coleção (ou no destino de uma relação), ou um campo oculto por `excludeFromApi`. | Verifique a grafia; a mensagem lista os campos válidos. |
| `UNKNOWN_FILTER_OPERATOR` | 400 | O filtro contém um operador inexistente. | A mensagem exibe a lista completa de operadores aceitos. |
| `UNKNOWN_MESSAGE_TYPE` | 400 | Um frame do socket realtime contém um `type` não processado pelo servidor. Retornado como um frame `ERROR` com o `requestId` correspondente para que a requisição finalize em vez de estourar timeout. | Verifique o `type` do frame; a mensagem cita o valor recebido. |
| `UNKNOWN_ORDER_BY_FIELD` | 400 | A ordenação referencia um campo inexistente na coleção. | Verifique a grafia; a mensagem lista os campos válidos. |
| `PRECONDITION_FAILED` | 412 | O cabeçalho `If-Match` informou uma versão da linha que não é mais a atual: alguém alterou o registro entre a sua leitura e esta gravação. Nada foi alterado. | Leia a linha novamente, reaplique as modificações e envie com o novo `ETag`. |
| `UNKNOWN_RESPONSE_FIELD` | 400 | `?fields=` solicita um campo que a coleção não possui. | Verifique a grafia; a mensagem lista os campos conhecidos. |
| `UNKNOWN_VECTOR_PROPERTY` | 400 | A busca vetorial referenciou uma propriedade que não é do tipo `vector` nesta coleção. | A mensagem lista as propriedades vetoriais da coleção. |
| `UNSUPPORTED_MEDIA_TYPE` | 415 | O cabeçalho `Content-Type` não é aceito por esta rota. | Envie a requisição com o tipo especificado na documentação da rota. |
| `UNSUPPORTED_OPTION` | — | Lançado como exceção no código, não via HTTP: uma gravação através do acessor local (`context.data` em callbacks, `rebase.data` em funções ou cron) recebeu `ifMatch` ou `idempotencyKey`. Esse ponto de entrada não possui validação de pré-condições nem armazenamento de idempotência, portanto a opção é rejeitada antes da gravação em vez de ser ignorada. | Remova a opção na chamada interna ou faça a gravação através do cliente HTTP, que suporta ambas. |
| `UNSUPPORTED_RELATION_FILTER` | 400 | O filtro atravessa uma relação `via`, cujo caminho de junção é configurado em sentido único, não havendo como correlacionar uma subconsulta reversa. | Aplique o filtro a partir do lado proprietário da relação. |
| `UNSUPPORTED_RELATION_FILTER_OPERATOR` | 400 | O operador não é compatível com esse campo: relações sem coluna dedicada na linha atual são filtradas por associação, e buscas por padrão (`like`, `ilike` e negações) aplicam-se exclusivamente a campos de texto. | Veja a mensagem; ela lista o que o campo aceita. |
| `VALIDATION_CONSTRAINT` | 400 | Um valor violou uma regra de `validation` declarada na propriedade — tamanho, intervalo, regex ou obrigatoriedade. | Veja a mensagem; ela detalha cada violação encontrada. |
| `VALIDATION_EXCLUDED_FIELDS` | 400 | O corpo tenta gravar em uma coluna com `excludeFromApi` ou `access: { write: [] }` — regras equivalentes sob grafias diferentes. Essas colunas são de controle exclusivo do servidor: hashes de senha, tokens de validação. Diferente de `FIELD_NOT_WRITABLE`, essa resposta é idêntica para qualquer chamador, incluindo administradores (`admin`). | Remova o campo do corpo da requisição. Veja [Acesso a campos](/docs/collections/field-access/). |
| `VALIDATION_INVALID_VALUE` | 400 | Um valor é incompatível com o tipo definido para a propriedade. | Veja a mensagem; ela indica qual propriedade falhou. |
| `VALIDATION_UNKNOWN_FIELDS` | 400 | O corpo referencia campos que a coleção não possui — inclusive passar `id` em coleções que utilizam outra chave primária. | Verifique a grafia; a mensagem lista os campos existentes. |
| `VECTOR_CURSOR_UNSUPPORTED` | 400 | Um cursor (`after` / `startAfter`) foi associado a uma busca vetorial. Os registros são ordenados por uma distância dinâmica calculada na hora da consulta, o que impede seu uso como cursor, de modo que listagens vetoriais não geram `nextCursor`. | Pagine os registros mais próximos usando `limit`/`offset`. |
| `WRITE_DENIED` | 403 | Uma regra de segurança ou política de RLS barrou a operação de gravação. | Revise as `securityRules` da coleção. |

## `PG_<SQLSTATE>` — restrição recusada pelo banco de dados

Uma gravação rejeitada pelo Postgres por um motivo referente aos *dados do chamador*
retorna com o SQLSTATE correspondente no código: `PG_23505`, `PG_23503`, e assim por diante. Trata-se de
uma família de códigos, não de uma lista fixa — o Postgres define centenas de SQLSTATEs —, mas apenas duas
classes chegam a esse formato, pois somente estas decorrem de ações do chamador:

- **classe 23**, violação de restrição de integridade: duplicatas, chaves estrangeiras apontando
  para registros inexistentes, colunas NOT NULL sem preenchimento;
- **classe 22**, exceção nos dados: valores incompatíveis com os limites do tipo da coluna.

Todas as demais falhas — conexões encerradas, ausência de colunas, problemas de permissão —
são falhas do servidor e retornam status `500`. Portanto, checar se `code.startsWith("PG_")` é um teste seguro
para saber se "os dados da linha enviada estavam errados". Os quatro códigos abaixo são os que os clientes
encontram na prática. `details.dbCode` traz o mesmo SQLSTATE em todos eles, e a
mensagem identifica a restrição violada.

| Código | Status | Significado | O que fazer |
| --- | --- | --- | --- |
| `PG_22P02` | 400 | Um valor não pôde ser interpretado no tipo esperado pela coluna — o equivalente de gravação para `INVALID_FILTER_VALUE`. | Envie um valor compatível com o tipo da coluna. |
| `PG_23502` | 400 | Uma coluna marcada como `NOT NULL` ficou vazia. | Envie o campo ou configure um valor padrão (default) para a coluna. |
| `PG_23503` | 400 / 409 | Na inserção, uma chave estrangeira referencia uma linha inexistente (400). Na exclusão, outros registros ainda dependem desta linha (409; restrições `RESTRICT` disparam `PG_23001`, também 409). | Crie a linha de destino antes ou corrija o id; na exclusão, remova ou aponte os registros dependentes para outro lugar antes. |
| `PG_23505` | 409 | Violação de restrição de unicidade (unique constraint). A mensagem identifica a restrição. | Use um valor diferente ou atualize a linha existente. |

## Armazenamento (Storage)

| Código | Status | Significado | O que fazer |
| --- | --- | --- | --- |
| `INVALID_LIST_OPTIONS` | 400 | O parâmetro `maxResults` de uma listagem no storage não é um inteiro igual ou superior a 1, ou seu `pageToken` não foi emitido por esta fonte. Anteriormente, limites menores que 1 retornavam uma lista vazia mantendo o mesmo token, travando loops `while (pageToken)`. | Forneça um `maxResults` positivo e reenvie o `nextPageToken` sem modificações. |
| `INVALID_STORAGE_BUCKET` | 400 | O nome do bucket está malformado. | Verifique o nome informado. |
| `INVALID_STORAGE_KEY` | 400 | A chave do objeto está malformada, tenta escapar do prefixo ou está sob um caminho reservado (`_rebase/renditions/`, `_rebase/maintenance/`). | Verifique a chave informada. |
| `INVALID_TRANSFORM_OPTIONS` | 400 | Os parâmetros de transformação de imagem estão fora do intervalo aceitável ou são contraditórios. | Veja [Armazenamento](/docs/backend/storage/). |
| `STORAGE_FILE_TOO_LARGE` | 413 | O upload ultrapassa o `maxSize` estabelecido para a propriedade de destino. Validado no próprio servidor, não apenas no navegador. `details` informa a propriedade, o limite e o tamanho real enviado. | Envie um arquivo menor ou aumente o `maxSize` da propriedade. |
| `STORAGE_FILE_TYPE_REFUSED` | 400 | O tipo do arquivo enviado não consta no `acceptedFiles` da propriedade ou no `allowedMimeTypes` da fonte de armazenamento. `details` exibe a propriedade (ou a lista da fonte), a lista de formatos aceitos e o mime-type recebido. | Envie um formato aceito ou expanda as configurações de `acceptedFiles` / `allowedMimeTypes`. |
| `STORAGE_MISCONFIGURED` | 502 | O bucket S3 ou GCS configurado não existe, ou o provedor rejeitou as credenciais desta implantação. A mensagem identifica o bucket; `details.reason` traz `NoSuchBucket` ou a recusa do provedor. Anteriormente, baldes inexistentes eram interpretados como "arquivo não encontrado" para qualquer arquivo. | Ajuste o nome do bucket (`S3_BUCKET` / `GCS_BUCKET`, `__<KEY>` para fontes nomeadas) ou as permissões das credenciais. |
| `STORAGE_NOT_CONFIGURED` | 501 / 503 | Não há backend de armazenamento configurado no servidor, ou nenhum foi definido como padrão e a requisição omitiu a fonte; a mensagem indica as fontes ativas (501). Uploads resumíveis cuja fonte sumiu antes da finalização retornam 503. | Configure S3, GCS ou armazenamento local, ou explicite a fonte usando `?storageId=`. |
| `STORAGE_SAME_LOCATION` | 400 | Execução de `POST /api/admin/storage/move` com `deleteSource` (`rebase storage move --delete-source`) entre duas fontes apontando para o mesmo bucket ou diretório. Cada arquivo seria considerado já presente no destino por ser exatamente o mesmo, e apagar a cópia de origem excluiria a única via existente. Nenhuma movimentação ou deleção foi realizada. | Altere o apontamento da propriedade diretamente para a outra fonte; seus arquivos já estão lá. |
| `STORAGE_SCAN_INCOMPLETE` | 409 | `DELETE /api/admin/storage/orphans` (`rebase storage orphans --delete`) não conseguiu ler todas as coleções, de modo que arquivos vinculados poderiam parecer órfãos. Usando `?scan=`, aponta para a varredura que falhou nessa leitura. Nada foi excluído; `details.unscanned` lista as coleções não lidas e a razão da falha. | Resolva a causa do bloqueio de leitura dessas coleções e repita a operação. |
| `STORAGE_SCAN_NOT_FOUND` | 404 | `GET /api/admin/storage/orphans/scans/:id` ou `DELETE /api/admin/storage/orphans?scan=:id` especifica uma varredura inexistente na fonte informada. Varreduras ficam salvas por 7 dias na fonte correspondente, logo um `storageId` diferente daquele onde foi gerada também não a encontrará. | Informe o `storageId` da varredura correta ou execute uma nova. |
| `STORAGE_SCAN_NOT_COMPLETE` | 409 | `DELETE /api/admin/storage/orphans?scan=:id` especifica uma varredura que permanece com status `queued` ou `running`, ou que terminou em `failed`. Nada foi excluído; `details.status` indica o estado atual. | Aguarde a conclusão da varredura ou dispare outra. |
| `STORAGE_SCAN_EXPIRED` | 409 | `DELETE /api/admin/storage/orphans?scan=:id` referencia uma varredura finalizada há mais de 15 minutos. Nada foi excluído. | Realize uma nova varredura e exclua a partir dela. |
| `STORAGE_SCAN_DELETION_STARTED` | 409 | `DELETE /api/admin/storage/orphans?scan=:id` aponta para uma varredura cujos itens órfãos já estão em processo de deleção. | Acompanhe a exclusão via `GET /api/admin/storage/orphans/scans/:id` consultando o campo `deletion`. |
| `STORAGE_SOURCE_NOT_CONFIGURED` | 501 | A fonte de armazenamento está declarada no projeto, mas não possui credenciais configuradas neste ambiente. | Configure as variáveis de ambiente necessárias para essa fonte. |
| `STORAGE_WRITE_FAILED` | 502 | O provedor de armazenamento recusou ou interrompeu a operação de escrita. | Inspecione as credenciais e os logs do provedor. |
| `TRANSFORM_OVERLOADED` | 503 | Quantidade excessiva de transformações de imagens em processamento simultâneo. | Tente novamente em breve; considere colocar uma CDN à frente. |
| `UNKNOWN_STORAGE_SOURCE` | 400 / 404 | A requisição informou uma fonte (`?storageId=`) não declarada no projeto. Acessar um `bucket` não atendido por esta implantação retorna o mesmo código sob o status **404** (em listagens, uploads simples, manipulações de pastas ou uploads resumíveis no S3/GCS) — o armazenamento em si é o que está ausente, e `details` lista os buckets e fontes existentes. Ambos costumavam retornar "arquivo não encontrado", idêntico a chaves que simplesmente não existiam. | Declare a fonte em `config/resources.ts` ou consulte as opções via `GET /api/storage/sources`. |
| `UPLOAD_LOCKED` | 423 | O `PATCH` de um upload resumível chegou enquanto outra parte desse mesmo upload ainda estava sendo processada — quase sempre um cliente reenviando uma parte pendente. A requisição é recusada em vez de enfileirada, seguindo o padrão do tusd. | Consulte o offset atual com `HEAD /api/storage/tus/:id` e retome a partir dele; clientes como o tus-js-client realizam essa espera e retentativa automaticamente. Veja [Uploads resumíveis (TUS)](/docs/backend/storage-resumable-uploads/). |

## Funções customizadas

| Código | Status | Significado | O que fazer |
| --- | --- | --- | --- |
| `FUNCTION_NOT_FOUND` | 404 | Nenhuma função atende por este nome — ou ela existe, mas suas rotas internas não contemplam o caminho requisitado. Chamadores autenticados recebem a lista do que *está* disponível; requisições anônimas não recebem, pois essa lista revelaria todos os endpoints customizados. Caso o arquivo da função tenha falhado ao carregar, a mensagem relata o erro ao chamador autenticado, citando o arquivo: essa é a diferença prática entre erro de digitação e falha no deploy. Requisições anônimas recebem apenas a resposta padrão de nome desconhecido. | Valide o nome consultando `GET /api/functions` ou cheque os logs de inicialização em busca de arquivos com falha de carregamento. |
| `FUNCTION_TIMEOUT` | 504 | O manipulador ultrapassou seu tempo limite (timeout) de execução. Ele continua rodando em segundo plano, pois não pode ser cancelado a partir deste ponto. | Adicione um `AbortSignal` às chamadas externas ou aumente o valor de `REBASE_FUNCTIONS_TIMEOUT_MS`. |
| `FUNCTIONS_UPSTREAM_UNREACHABLE` | 502 | Este processo atua como proxy de funções para outro processo, que não respondeu. | Certifique-se de que a instância dedicada de funções está ativa. |

## Tarefas agendadas (Cron jobs)

| Código | Status | Significado | O que fazer |
| --- | --- | --- | --- |
| `CRON_JOB_ALREADY_EXECUTING` | 409 | Acionamento manual de um cron job que já está em execução — seja no processo que recebeu a chamada ou em outro que detenha a concessão de execução (run lease), como um worker associado ao processo `api`. Nenhuma nova execução ocorreu. A tentativa ignorada é registrada no histórico da tarefa e `details.log` traz essa entrada, citando o processo que está com a tarefa ativa. | Aguarde a conclusão da execução atual para tentar novamente. Veja [Cron Jobs](/docs/backend/cron-across-instances/#concurrency-guarding). |

## Painel de administração e edição de esquema

Estes códigos informam que um recurso está desligado ou sem configuração, e não
que a requisição continha dados inválidos. Cada um desses estados também é retornado
na respectiva rota `/status` com código `200`, permitindo que o painel exiba
o recurso desabilitado em vez de disparar erros.

| Código | Status | Significado | O que fazer |
| --- | --- | --- | --- |
| `ADMIN_SURFACE_UNAVAILABLE` | 501 | Acesso a uma interface exclusiva de administração em um servidor sem autenticação configurada, tornando impossível distinguir um admin de um visitante anônimo. | Defina `auth.jwtSecret` ou forneça um `AuthAdapter`. |
| `BRANCH_DIFF_STALE` | 409 | `POST /api/admin/branches/:name/merge` recebeu o fingerprint de uma comparação (diff) defasada: a branch ou seu pai sofreram alterações no intervalo. Nenhuma alteração foi gravada. | Calcule o diff novamente, faça a revisão e realize o merge enviando o novo `fingerprint`. |
| `BRANCH_DIFF_UNSUPPORTED` | 501 | A fonte de dados não suporta a comparação entre branches: não possui SQL ou suporte a branches (sem conexão administrativa). | Utilize um backend Postgres com `adminConnectionString` configurada. |
| `BRANCH_MERGE_BLOCKED` | 409 | Uma tabela divergente não pode ser mesclada — criada ou apagada pela branch, diferenças em colunas ou chave primária, inexistência de chave primária, linhas em excesso para correspondência ou reescrita após a criação da branch (`TABLE_REWRITTEN`). Tabelas cujas linhas não puderam ser correlacionadas causam bloqueio mesmo que indiquem 0 linhas: a contagem é desconhecida, não nula. `details.tables` lista cada tabela e a causa. Nada foi gravado. | Sincronize o esquema com suas migrations primeiro ou execute o merge com `skipBlocked: true` para ignorar essas tabelas. |
| `BRANCH_MERGE_CONFLICT` | 409 | Linhas sofreram alterações concorrentes na branch e no pai, e `onConflict` foi mantido como `"abort"` (o padrão); ou o pai barrou parte do merge — uma linha mudou paralelamente, uma trigger a ignorou ou uma política de RLS a ocultou. Nada foi gravado. | Defina a preferência de resolução com `onConflict: "branch"` ou `"target"`, ou releia o diff. |
| `BRANCH_MERGE_FAILED` | 409 | O pai recusou os registros da branch durante a execução do comando de merge — violação de constraint, valor de enum inválido ou integridade referencial rompida, normalmente devido a diferenças estruturais de esquema. `details` traz `sqlState`, `table`, `constraint` e `detail`. Nada foi gravado. | Inspecione as alterações de esquema no diff, compatibilize a estrutura do pai via migrations ou ajuste os dados na branch antes de mesclar novamente. |
| `BRANCH_NOT_FOUND` | 404 | Nenhuma branch encontrada com esse nome no registro. | Consulte as branches ativas via `rebase db branch list` ou na aba Branches do painel. |
| `CONTRACT_UNAVAILABLE` | 404 | O contrato do projeto é servido unicamente quando há autenticação ativa — ele detalha todas as tabelas e relações. | Ative a autenticação. A rota `/meta/schema-version` permanece sempre disponível. |
| `DEV_MAILBOX_UNAVAILABLE` | 501 | Nenhuma caixa de entrada para desenvolvimento está ativa. As mensagens só são capturadas se `SMTP_HOST` estiver vazio e `NODE_ENV` não for de produção. | Remova a definição de `SMTP_HOST` em desenvolvimento ou consulte a caixa postal real. |
| `INVALID_CHANGE` | 400 | A proposta de modificação no esquema não é válida. | Veja a mensagem. |
| `SCHEMA_CHANGE_FAILED` | 400 | A aplicação da modificação de esquema planejada falhou por motivos não contemplados em códigos específicos. | Veja a mensagem; ela reproduz o erro original integralmente. |
| `SCHEMA_CHANGE_UNAPPLICABLE` | 400 | A alteração é semanticamente válida, mas não pode ser aplicada ao estado atual do esquema. | Veja a mensagem. |
| `SCHEMA_EDIT_DIRTY_TREE` | 409 | O repositório contém alterações locais não commitadas, impedindo a aplicação segura da edição. | Faça commit ou guarde no stash antes de tentar novamente. |
| `SCHEMA_EDIT_REFUSED` | 400 | O editor de esquema rejeitou a modificação solicitada. | Veja a mensagem; trata-se da recusa gerada pelo próprio editor. |
| `SCHEMA_EDIT_REQUIRES_A_PERSON` | 403 | Uma chave de API ou credencial automatizada tentou alterar o esquema. | Faça login com um usuário real ou defina `liveSchema.allowMachineApply`. |
| `SCHEMA_EDITING_NO_COLLECTIONS_DIR` | 501 | A edição de esquema ao vivo depende de `collectionsDir` ou `liveSchema.repository`, e o servidor não possui nenhum dos dois configurado. | Configure uma dessas opções. |
| `SCHEMA_EDITING_NO_REPOSITORY` | 503 | O planejamento da alteração funciona, mas não há repositório configurado para commitar a mudança. | Configure `liveSchema.repository`. |
| `SCHEMA_EDITING_PROVISIONING_OFF` | 409 | Esta implantação não faz alterações diretas no banco de dados (`REBASE_PROVISION=false`), impossibilitando aplicar mudanças pelo painel. | Faça o commit apenas como código-fonte e delegue a execução ao processo responsável pela infraestrutura do banco. |
| `SCHEMA_EDITING_UNSUPPORTED` | 503 | Este driver não tem capacidade de planejar modificações de esquema. | A edição de esquema ao vivo está disponível no Postgres. |
| `SCHEMA_EDITOR_BAAS_MODE` | 501 | As coleções são derivadas diretamente do banco de dados neste ambiente, de modo que não existem arquivos de origem locais para alterar. | Modifique a estrutura através de migrations. |
| `SCHEMA_EDITOR_DISABLED` | 501 | O editor de esquema está inativo neste servidor. Builds empacotados sempre respondem com este código. | Ative-o configurando `schemaEditor`. Em pacotes compilados, defina `REBASE_LIVE_SCHEMA_REPOSITORY` para editar coleções via repositório — veja [Edição de esquema ao vivo](/docs/backend/live-schema-editing#from-a-built-bundle). |
| `SCHEMA_EDITOR_MISSING_DEPENDENCY` | 501 | O editor de esquema depende do pacote `ts-morph`, que não foi encontrado. | Instale-o no projeto responsável pelo backend e reinicie: `pnpm --dir backend add -D ts-morph@28.0.0` a partir da raiz de um projeto scaffolded, ou `pnpm add -D ts-morph@28.0.0` se o backend for a raiz. A mensagem indica o comando exato para a sua estrutura. |
| `SCHEMA_EDITOR_NO_COLLECTIONS_DIR` | 501 | O servidor não possui `collectionsDir` definido, deixando o editor sem destino de escrita. | Configure `collectionsDir`. |
| `SCHEMA_EDITOR_PRODUCTION` | 501 | O editor permanece desativado sob `NODE_ENV=production`: arquivos de um servidor em produção são reconstruídos a cada deploy a partir do repositório, descartando qualquer alteração feita nele. | Edite suas coleções em desenvolvimento e faça o deploy, ou configure `liveSchema.repository` para versionar as alterações diretamente lá. |
| `SQL_EXPORT_UNSUPPORTED` | 501 | `POST /api/admin/sql/csv` não consegue transmitir fluxos de dados neste ambiente: o banco de desenvolvimento interno (PGlite) possui apenas uma conexão única, de modo que reter um cursor durante um download travaria todas as outras consultas; ou a fonte não suporta cursores SQL. | Aponte `DATABASE_URL` para uma instância real do Postgres (`rebase dev --docker` inicia uma) ou limite com `LIMIT` e exporte as linhas visíveis na interface. |

### Reconciliação de esquema (Schema reconcile)

O comando [`rebase schema reconcile`](/docs/cli/schema/#rebase-schema-reconcile) planeja
via `POST /api/admin/schema/reconcile/plan` e aplica عبر
`/reconcile/apply`. Uma recusa não altera o banco; apenas `SCHEMA_RECONCILE_FAILED`
pode deixar uma parte do plano aplicada.

| Código | Status | Significado | O que fazer |
| --- | --- | --- | --- |
| `INVALID_RECONCILE` | 400 | O corpo não é um objeto JSON, ou `drop` não é uma lista de strings no formato `"<collection>.<column>"`. | Envie `{ "drop": ["voice_cache.wav"] }` ou omita o atributo `drop`. |
| `SCHEMA_RECONCILE_FAILED` | 400 | Uma instrução falhou durante o processo. As instruções anteriores foram concluídas e permanecem ativas no banco; `details.applied` traz essa lista. | Corrija a pendência indicada na mensagem e repita o planejamento: o novo plano contemplará apenas o que ainda não rodou. |
| `SCHEMA_RECONCILE_INVALID` | 400 | O plano não pode ser aplicado. A mensagem detalha as razões: um `drop` fora do formato `<collection>.<column>`, referenciando coleções ou colunas inexistentes, ou listando colunas que a coleção ainda mantém declaradas. `details.plan` contém o plano gerado. | Ajuste a listagem de `drop`. Para excluir uma coluna declarada, remova a propriedade no código, faça o deploy e só então rode o reconcile. |
| `SCHEMA_RECONCILE_STALE` | 409 | O banco de dados ou as coleções sofreram modificações após o plano que você confirmou. `details.plan` traz a nova versão atualizada. | Revise o plano recalculado e confirme através de seu novo `digest`. |
| `SCHEMA_RECONCILE_UNCONFIRMED` | 400 | `/reconcile/apply` foi chamado sem o campo `confirm`. | Crie o plano primeiro e envie o `digest` gerado dentro do parâmetro `confirm`. A CLI automatiza isso após você digitar `yes`. |
| `SCHEMA_RECONCILE_UNSUPPORTED` | 503 | O driver do backend não tem capacidade de planejar a reconciliação ou não executa SQL. | A reconciliação opera em bancos Postgres. |

### Motivos para tabelas não poderem ser mescladas em uma branch

O erro `BRANCH_MERGE_BLOCKED` cita cada tabela recusada no campo `details.tables`, usando
um destes códigos. O mesmo identificador aparece no atributo `blocked` da tabela durante o diff,
permitindo ao Studio sinalizar o problema antes mesmo de alguém clicar em **Merge**. Nenhum deles constitui
uma resposta HTTP independente.

| Código | Status | Significado | O que fazer |
| --- | --- | --- | --- |
| `COLUMNS_DIFFER` | — | A tabela possui divergência de colunas entre a branch e seu pai. As linhas só podem ser comparadas usando colunas compartilhadas por ambos. | Adicione as colunas faltantes ao pai usando migrations (`rebase db push`) e faça o merge em seguida. Se a migration reescrever a tabela (como em mudanças de tipo de coluna), o status passará a ser `TABLE_REWRITTEN`: mescle antes dessa alteração ou recrie a branch após aplicá-la. |
| `NO_PRIMARY_KEY` | — | A tabela não tem chave primária, inviabilizando a comparação linha por linha; o diff aponta apenas a contagem de registros. | Adicione uma chave primária à tabela ou migre seus dados manualmente. |
| `PRIMARY_KEY_DIFFERS` | — | As colunas que compõem a chave primária ou seus tipos divergem entre os dois lados. | Sincronize a estrutura do esquema no pai antes de mesclar. |
| `TABLE_ADDED` | — | A tabela foi criada exclusivamente na branch. O processo de merge nunca cria tabelas novas. | Crie a estrutura no pai via migrations e mescle apenas os dados depois. |
| `TABLE_DROPPED` | — | A tabela foi apagada na branch. O processo de merge nunca apaga tabelas. | Remova a tabela no pai usando migrations. |
| `TABLE_REWRITTEN` | — | Um dos lados reescreveu todas as linhas da tabela após a criação da branch — alteração no tipo de uma coluna, `ADD COLUMN` com default volátil, `VACUUM FULL`, `CLUSTER` —, fazendo com que toda linha pareça modificada e impedindo discernir qual lado alterou qual registro. | Mescle a branch antes de rodar esse tipo de migration ou recrie a branch a partir do pai logo após a alteração. |
| `TOO_LARGE` | — | A tabela tem mais linhas em um dos lados do que o diff compara registro por registro (por padrão 100.000, via `maxRowsPerTable`). | Aumente `maxRowsPerTable` na geração do diff e no merge, ou transfira as linhas por outro meio. |

## Códigos genéricos

Uma rota recorre a estes códigos quando não houver outro mais específico aplicável ao caso.

| Código | Status | Significado | O que fazer |
| --- | --- | --- | --- |
| `BAD_REQUEST` | 400 | Requisição malformada, sem código específico para o caso. | Veja a mensagem. |
| `UNAUTHORIZED` | 401 | Não autenticado ou a credencial enviada foi rejeitada. | Faça login ou renove o token. |
| `FORBIDDEN` | 403 | Autenticado, mas sem permissão de acesso. | Tentar novamente com as mesmas credenciais não resolverá o problema. |
| `CONFLICT` | 409 | Conflito com o estado atual dos recursos. | Veja a mensagem. |
| `INTERNAL_ERROR` | 500 | Ocorreu uma falha interna no servidor. A mensagem é intencionalmente genérica. | Guarde o `requestId`; o detalhe da falha está registrado nos logs. |
| `NOT_CONFIGURED` | 503 | Uma dependência essencial para esta rota não está configurada neste servidor. | Veja a mensagem. |
| `SERVICE_UNAVAILABLE` | 503 | Um serviço externo necessário para atender à requisição não pôde ser alcançado: um bucket S3/MinIO, ou um host externo chamado via `fetch()` por uma função que recusou a conexão ou não foi resolvido por DNS. O log do servidor informa o host; a resposta HTTP oculta essa informação. Se for o banco de dados principal, o erro retornado é `DATABASE_UNAVAILABLE`. Falhas de conexão a esses serviços retornam este código. | Tente novamente mais tarde; verifique os logs do servidor. |

## Mantendo esta documentação precisa

O comando `pnpm verify:docs` falhará caso algum código passível de ser gerado pelo servidor esteja
ausente destas tabelas, quando uma tabela listar códigos inexistentes, quando os status HTTP de uma linha
não corresponderem exatamente aos disparados no código-fonte, ou quando famílias como `PG_<SQLSTATE>` não cobrirem
um SQLSTATE de fato retornado aos chamadores. O script responsável é
`tooling/scripts/docs-verify/check-error-codes.mjs`.

Ele faz uma autoverificação preliminar. O analisador varre o código TypeScript diretamente em vez de inspecionar
um servidor em execução, de modo que eventuais pontos cegos são silenciosos por projeto: em versões anteriores,
ele não detectava códigos repassados por wrappers de uma linha ou códigos declarados após mensagens
que continham `)`, o que fez relatar que "todos os códigos do servidor estavam documentados"
quando faltavam dezessete nesta página. Por isso, a verificação roda uma bateria de testes com essas mesmas
estruturas sintáticas antes de ler esta documentação, recusando-se a validar o arquivo se
não conseguir detectá-las.
