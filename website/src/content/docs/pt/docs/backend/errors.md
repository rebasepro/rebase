---
sourceHash: 983cce6efed81a1a
title: Códigos de erro
sidebar_label: Códigos de erro
description: Todos os códigos de erro que um backend Rebase pode retornar, com seu status HTTP, o que significa e o que fazer a respeito — além do envelope de resposta, X-Request-ID e as regras de details.
---

Cada falha retornada por um backend Rebase usa um único envelope e contém um
`code` estável. O código é o elemento a ser verificado em condicionais: a mensagem
é escrita para pessoas e pode ser reformulada, o status é compartilhado por dezenas
de problemas diferentes, e o código não é nenhum dos dois.

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
  para um `5xx`, é deliberadamente genérica, pois o texto subjacente pode citar um host,
  uma role ou o nome de uma coluna.
- **`code`** — um dos valores abaixo. Estável entre versões menores (minor versions).
- **`details`** — opcional e nunca garantido. Veja as regras abaixo.
- **`requestId`** — presente sempre que a requisição passou pelo middleware de request-ID,
  o que abrange todas as rotas sob `basePath`.

### `X-Request-ID`

Toda requisição sob `basePath` recebe um ID: o cabeçalho `X-Request-ID` do chamador
quando este for um UUID; caso contrário, um novo é gerado. Ele é retornado na
resposta como `X-Request-ID`, incluído no envelope de erro como `requestId` e
anexado à linha de log do servidor referente àquela requisição.

Essa é a chave de correlação (join key). Cite-a em um relatório de bug e um operador poderá
encontrar a linha exata do log que explica a falha, trazendo o motivo que nunca foi
exibido ao cliente.

Enviar o seu próprio identificador é como um rastreamento (trace) sobrevive a um salto (hop):
um gateway ou executor de jobs que repassa o cabeçalho obtém um único ID em todos os
serviços que processaram a requisição. Um valor inválido é ignorado em vez de rejeitado —
não vale a pena falhar uma requisição por causa de um cabeçalho malformado enviado pelo
chamador —, portanto, não assuma que o ID enviado é o ID recebido. Leia o cabeçalho da resposta.

### O que há em `details`

`details` tem finalidade diagnóstica, não contratual. Três regras o regem:

1. **Tudo o que uma rota define explicitamente é sempre retornado.** São os próprios
   erros do chamador descritos com precisão: qual campo de filtro era desconhecido,
   qual relação não permite escrita, qual valor não corresponde ao seu tipo.
2. **Diagnósticos do banco de dados são omitidos em produção.** Quando a falha tem origem
   no Postgres, `details.dbCode` — o SQLSTATE — está sempre presente: ele identifica a
   classe do problema sem revelar nada sobre os dados. `dbMessage`, `detail` e `hint`
   são adicionados apenas quando `NODE_ENV` não for `production`, pois o Postgres inclui
   o conteúdo das linhas neles. O erro `23505` informa `Key (email)=(a@b.c) already exists.`,
   o que responderia "esta pessoa está cadastrada?" para qualquer endereço que alguém tentasse testar.
3. **Nunca crie condicionais com base em `details`.** Use o `code`. O conteúdo sob
   `details` é apenas o que foi útil para uma pessoa naquele ponto de chamada, e ele muda.

## Lendo um status

| Status | O que diz sobre a requisição |
| --- | --- |
| `400` | Malformada ou solicitando algo que não existe no schema. Corrija a requisição. |
| `401` | Não autenticado ou a credencial expirou. Faça login ou renove o token. |
| `403` | Autenticado, mas sem permissão. Tentar novamente com a mesma identidade não ajudará. |
| `404` | Rota, coleção ou linha inexistente — ou uma linha oculta por segurança em nível de linha (RLS). |
| `409` | Um conflito com o estado existente: duplicata ou escrita concorrente. |
| `413` `415` `422` | O corpo é grande demais, o tipo de mídia está errado ou foi rejeitado semanticamente. |
| `429` | Limite de taxa atingido (rate limited). Aguarde; a mensagem informa por quanto tempo. |
| `500` | O erro está no servidor ou em seu banco de dados, não no chamador. Verifique os logs. |
| `501` | A rota existe, mas esta implantação não pode atendê-la — um recurso desativado ou não configurado. |
| `502` `503` `504` | Uma dependência estava inacessível, não configurada ou muito lenta. |

## Autenticação e contas

| Código | Status | Significado | O que fazer |
| --- | --- | --- | --- |
| `AAL2_REQUIRED` | 403 | A rota requer um segundo fator e a sessão possui apenas um. | Conclua o desafio de MFA e tente novamente. |
| `ALREADY_VERIFIED` | 400 | O endereço ou fator já foi verificado. | Nada — o estado desejado já é verdadeiro. |
| `ACCOUNT_OUTRANKS_CALLER` | 403 | A conta sendo editada, redefinida ou excluída possui uma role ou escopo que o chamador não possui. `details.beyond` lista quais são. | Peça para alguém que possua esses privilégios realizar a alteração. |
| `ANONYMOUS_AUTH_DISABLED` | 403 | O login anônimo está desativado neste servidor. | Ative-o ou autentique-se com uma identidade real. |
| `API_KEY_SELF_MANAGEMENT_FORBIDDEN` | 403 | Uma chave de API tentou listar, criar, alterar ou revogar chaves de API, sejam do seu próprio tipo ou pessoais. | Gerencie chaves como uma pessoa com a permissão `keys:write` ou usando a chave de serviço. |
| `AUTH_MIDDLEWARE_MISSING` | 500 | Uma rota protegida foi executada sem nenhum middleware de autenticação do Rebase antes dela, portanto a credencial do chamador nunca foi inspecionada. | Monte a aplicação através do roteador de funções em vez de diretamente no seu próprio servidor. |
| `BOOTSTRAP_ANONYMOUS` | 403 | A inicialização (bootstrap) do primeiro administrador foi tentada por um chamador anônimo. | Faça login primeiro. |
| `BOOTSTRAP_COMPLETED` | 403 | O primeiro administrador já existe. | Peça a um administrador existente para conceder a role. |
| `BOOTSTRAP_NOT_FIRST_USER` | 403 | O bootstrap é exclusivo para o primeiríssimo usuário, e este não é o caso. | Peça a um administrador existente para conceder a role. |
| `CAPTCHA_FAILED` | 400 | O provedor rejeitou o token de CAPTCHA. | Resolva um novo desafio. |
| `CAPTCHA_REQUIRED` | 400 | A rota exige um token de CAPTCHA e nenhum foi enviado. | Inclua o token. |
| `CHALLENGE_EXHAUSTED` | 401 | Tentativas incorretas em excesso para um mesmo desafio de MFA. | Inicie um novo desafio. |
| `EMAIL_EXISTS` | 409 | Já existe uma conta com esse endereço — no cadastro, na alteração de endereço ou ao acessar um link de alteração de endereço quando outra conta assumiu o endereço durante a espera. | Faça login ou inicie a redefinição de senha; para alteração de endereço, escolha outro e-mail. |
| `EMAIL_NOT_CONFIGURED` | 503 | Magic links ou OTP foram solicitados, mas o servidor não tem transporte de e-mail configurado. | Configure o SMTP ou use outro método de autenticação. |
| `EMAIL_NOT_VERIFIED` | 403 | O login via OAuth encontrou uma conta com o mesmo endereço, mas o provedor não verificou esse endereço, portanto ela não foi vinculada. | Faça login usando o método existente e execute `POST /auth/link/<provider>`. |
| `FACTOR_NOT_VERIFIED` | 400 | O fator de MFA foi registrado, mas nunca confirmado. | Confirme o fator. |
| `IDENTITY_ALREADY_LINKED` | 409 | Essa identidade OAuth pertence a outra conta. | Faça login com ela ou desvincule-a da outra conta primeiro. |
| `IMPERSONATION_FORBIDDEN` | 403 | Uma requisição enviou `x-rebase-impersonate` e seu chamador não tem permissão para atuar como outro usuário. Apenas a sessão de um administrador autenticado pode fazer isso, nunca uma chave de API ou a chave de serviço. | Envie a requisição com a sessão de um administrador ou remova o cabeçalho. |
| `IMPERSONATION_INVALID` | 400 | `x-rebase-impersonate` foi enviado vazio. | Envie o uid do usuário que deseja personificar ou remova o cabeçalho. |
| `IMPERSONATION_TARGET_NOT_FOUND` | 404 | `x-rebase-impersonate` especifica nenhum usuário ativo: nenhuma conta tem esse uid ou ela está desativada. | Verifique o uid. |
| `IMPERSONATION_UNAVAILABLE` | 501 | A autenticação deste backend não suporta personificação de usuário porque seu `AuthAdapter` não implementa `resolveUser`. | Implemente `resolveUser` no adaptador ou remova o cabeçalho. |
| `IMPERSONATION_UNSUPPORTED` | 400 | `x-rebase-impersonate` foi enviado para uma rota que não oferece suporte a personificação. Apenas a API de dados e funções customizadas aceitam esse cabeçalho, e o socket de tempo real aceita `impersonate` em `AUTHENTICATE`. | Envie a requisição sem o cabeçalho. |
| `SIMULATION_FORBIDDEN` | 403 | Uma requisição enviou um cabeçalho `x-rebase-simulate-*` (simulador de RLS) ou chamou `/api/admin/rls-simulator`, e o chamador não pode simular acessos. Apenas a sessão de um administrador autenticado pode, nunca uma chave de API ou a chave de serviço. | Envie a requisição com a sessão de um administrador ou remova os cabeçalhos. |
| `SIMULATION_INVALID` | 400 | A simulação estava malformada: um cabeçalho enviado vazio, `x-rebase-simulate-api-key-id` combinado com uma role ou user id, ou simulação combinada com `x-rebase-impersonate`. | Especifique uma role (opcionalmente com um uid), um user id ou um id de chave de API. |
| `SIMULATION_READ_ONLY` | 403 | Uma operação de escrita, exclusão, `_batch`, reversão de histórico ou função customizada chamada por qualquer verbo diferente de `GET`/`HEAD`/`OPTIONS` continha um cabeçalho `x-rebase-simulate-*`. O acesso simulado é somente leitura: a escrita seria executada como a identidade simulada, não como o administrador. Leituras, incluindo `POST …/query` e `…/count`, ainda funcionam. Na versão 0.25, a escrita era executada como a identidade simulada. | Interrompa a simulação para realizar alterações. |
| `SIMULATION_TARGET_NOT_FOUND` | 404 | A simulação indica nenhum usuário ativo (um user id enviado sem role) ou nenhuma chave de API ativa. | Verifique o id ou envie uma role junto com o uid para simular um uid que não possui conta. |
| `SIMULATION_UNAVAILABLE` | 501 | Este backend não pode simular acessos: seu `AuthAdapter` não possui `resolveUser` para confirmar um administrador, ou uma chave foi informada em um backend sem chaves de API. | Implemente `resolveUser` ou remova os cabeçalhos. |
| `SIMULATION_UNSUPPORTED` | 400 | Um cabeçalho `x-rebase-simulate-*` foi enviado para uma rota que não suporta acesso simulado. Apenas a API de dados e funções customizadas oferecem suporte. | Envie a requisição sem os cabeçalhos. |
| `GUEST_REFERENCED` | 409 | Um convidado (guest) não pôde ser excluído porque uma linha do próprio projeto o referencia através de uma chave estrangeira com `ON DELETE RESTRICT` ou `NO ACTION`. `DELETE /api/admin/guests` reporta isso por convidado em `skipped` e continua a execução. | Exclua a linha ou mantenha o convidado. |
| `INVALID_ACCOUNT` | 400 | A conta está em um estado no qual esta operação não pode atuar. | Veja a mensagem. |
| `INVALID_CHALLENGE` | 400 | O desafio de MFA é desconhecido ou expirou. | Inicie um novo. |
| `INVALID_CODE` | 400 / 401 | O código OTP ou MFA está incorreto: 400 no login por código de e-mail (`/auth/otp/verify`), 401 no registro ou desafio de MFA. | Tente novamente com o código atual. |
| `INVALID_CREDENTIALS` | 401 | E-mail ou senha incorretos — deliberadamente sem especificar qual deles. | Tente novamente ou redefina a senha. |
| `INVALID_PLATFORM_TOKEN` | 401 | Um token de plataforma `rpt_` foi recusado: assinatura inválida, audience incorreto, expirado ou tempo de vida acima do limite máximo. A mensagem informa o motivo. | Solicite à plataforma a emissão de um novo — no Rebase Cloud, execute o comando novamente. |
| `INVALID_SCOPES` | 400 | Foi solicitado para uma chave algo que não é um escopo: malformado, desconhecido ou com um destino não aceito pelo escopo. `details.problems` informa quais e por quê; `details.validScopes` lista os escopos permitidos para chaves. Escopos como `keys:read` e `keys:write` são omitidos, pois nenhuma chave pode contê-los; na versão 0.24, eles eram listados. | Use um nome da lista. Veja [Roles e escopos](/docs/backend/roles-and-scopes/). |
| `INVALID_TOKEN` | 400 / 401 | Um token de verificação, redefinição, magic link ou alteração de e-mail é inválido, desconhecido, já utilizado ou expirado (400). Uma credencial de provedor OAuth ou refresh token não verificado resulta em 401. | Solicite um novo link ou faça login novamente. |
| `INVALID_ROLE` | 400 | O nome de role sendo gravado não é uma string, está vazio ou contém `,` `{` `}` `"` `\` ou caracteres de controle. Esses caracteres seriam lidos de volta como outras roles: uma role trafega em um `text[]` do Postgres e na lista separada por vírgulas dividida pelas políticas de RLS; assim, `"support,admin"` seria interpretado como `admin`. Na versão 0.25, esse tipo de nome era aceito. `details.problems` lista cada ocorrência. | Renomeie a role. Qualquer outro nome é aceito. |
| `KEY_MANAGEMENT_SCOPE` | 400 | Foi solicitada a permissão `keys:read` ou `keys:write` para uma chave. Nenhuma chave pode gerenciar chaves. `details.scopes` lista os escopos problemáticos. | Remova-os da solicitação. |
| `KEY_OUTRANKS_CALLER` | 403 | Um detentor de `keys:write` tentou alterar ou revogar uma chave de serviço que possui uma role ou escopo que ele não possui. Apenas administradores gerenciam qualquer chave. `details.roles` e `details.scopes` listam o que a chave possui além do chamador. Na versão 0.25, a alteração era permitida. | Peça a um administrador ou a alguém com os privilégios necessários para alterar a chave. |
| `LAST_ADMIN` | 403 | A alteração deixaria o projeto sem nenhum administrador. | Promova outro usuário primeiro. |
| `MFA_REQUIRED` | 401 | A senha estava correta e a conta possui um segundo fator verificado; logo, o login foi realizado apenas parcialmente. `details` traz um token de curta duração restrito ao desafio de MFA — não é uma sessão. | Abra um desafio e responda a ele; a resposta do desafio emitirá a sessão. |
| `NO_SESSION` | 401 | Nenhum cookie de sessão ou refresh token foi apresentado. Comum no primeiro carregamento de página. | Faça login. |
| `NOT_ANONYMOUS` | 400 | Uma rota de upgrade a partir de anônimo foi chamada por uma conta real, ou `DELETE /api/admin/guests/:uid` especificou uma conta real. | Nada para atualizar. Para excluir uma conta, use `DELETE /api/admin/users/:uid`. |
| `OAUTH_ERROR` | 401 | O provedor OAuth recusou a solicitação ou retornou um erro. | Tente o fluxo novamente; a mensagem contém o motivo informado pelo provedor. |
| `PERSONAL_KEYS_DISABLED` | 403 | Chaves de API pessoais estão desativadas neste backend. | Defina `personalKeys: true` no bloco `auth` da coleção de usuários. |
| `PERSONAL_KEY_NEEDS_ACCOUNT` | 403 | A chave de serviço ou uma sessão de convidado tentou acessar rotas de chaves pessoais. Nenhuma delas possui uma conta para a chave atuar em nome. | Faça login em uma conta ou crie uma chave de serviço em `/api/admin/api-keys`. |
| `PLATFORM_TOKENS_OFF` | 401 | Um token de plataforma `rpt_` chegou a um servidor que não os aceita: `REBASE_PLATFORM_TOKEN_KEY` e `REBASE_PLATFORM_TOKEN_AUDIENCE` não estão definidos. | A plataforma que hospeda o aplicativo define ambos no deploy; faça um novo deploy ou entre na aplicação de outra forma. |
| `RATE_LIMITED` | 429 | Excesso de tentativas vindas deste chamador. | Aguarde; a mensagem diz por quanto tempo. |
| `REDIRECT_URI_NOT_ALLOWED` | 400 | O destino do redirecionamento não está na lista de permissões (allow-list). | Adicione-o à configuração do provedor. |
| `REGISTRATION_DISABLED` | 403 | O autocadastro está desativado. | Solicite a um administrador para criar a conta. |
| `ROLE_EXCEEDS_CALLER` | 403 | As roles sendo concedidas possuem um escopo, ou `admin`, que o chamador não possui. `details.beyond` especifica quais. | Peça a alguém que possua esses privilégios para conceder a role. |
| `ROLE_EXCEEDS_CREATOR` | 403 | Uma chave de serviço recebeu uma role de RLS que seu criador não possui. Apenas um admin pode conceder qualquer role. `details.roles` especifica quais. | Remova a role ou peça a um admin para criar a chave. |
| `ROLE_EXISTS` | 409 | Esse nome de role já está em uso. | Escolha outro nome. |
| `ROLE_LOOKUP_FAILED` | 503 | Não foi possível consultar as roles do chamador — em uma rota de admin ou em uma requisição de dados em um backend com `config.auth`. Falha de forma segura (fails closed) em vez de confiar nas roles contidas no token. Um token cujo uid não corresponda a nenhuma conta (inclusive um uid que a tabela de usuários não suporte) retorna 401, não este erro (na versão 0.24, um uid não suportado gerava este 503). Um banco inacessível resulta em `DATABASE_UNAVAILABLE`, não este erro (na 0.24, resultava neste 503). | Tente novamente; verifique o banco de dados. |
| `SCOPE_EXCEEDS_CREATOR` | 403 | Foi solicitado para uma chave um escopo que seu criador não possui. Uma chave nunca pode ter mais privilégios do que a conta que a cria. `details.scopes` lista os escopos. | Remova-os ou peça a alguém com essas permissões para criar a chave. |
| `SCOPE_MISSING` | 403 | A credencial não possui o escopo necessário para esta rota, coleção, fonte de armazenamento ou função. `details.requiredScope` informa qual é, incluindo o alvo. | Para usuários, obtenha uma role que declare o escopo. Para chaves, utilize uma chave que o contenha. Veja [Roles e escopos](/docs/backend/roles-and-scopes/). |
| `SCOPE_NOT_DECLARED` | 500 | Uma rota protegida com `requireScope` especifica um escopo de aplicação não declarado neste backend; portanto, ninguém o possui, nem mesmo um administrador. Nomes que não representem um escopo ou erros de digitação em escopos internos como `data:raed` não chegam a este ponto: `requireScope` lança um erro no momento do registro da rota. Na versão 0.24, ambos retornavam `403 SCOPE_MISSING`. | Declare o escopo sob `auth.scopes` na coleção de usuários ou corrija o nome. Veja [Roles e escopos](/docs/backend/roles-and-scopes/). |
| `SELF_DELETE` | 400 | Um administrador tentou excluir a própria conta. | Peça a outro administrador para fazê-lo. |
| `SESSION_REVOKED` | 401 | A sessão foi encerrada em outro lugar, todas as sessões foram revogadas ou a conta foi excluída. Todos os pontos de entrada que aceitam sessão retornam isso para esse token de acesso: API de dados, storage, funções customizadas e rotas de administração (na 0.24, os três primeiros respondiam `UNAUTHORIZED` "Invalid or expired token"). O socket em tempo real rejeita o `AUTHENTICATE` com um frame `AUTH_ERROR` contendo o mesmo código. O SDK tenta renovar, a renovação é recusada e o logout ocorre. | Faça login novamente. |
| `ACCOUNT_DISABLED` | 401/403 | Um administrador desativou a conta: login (403), renovação e todos os tokens associados (401) são recusados em todos os pontos que aceitam sessão (na 0.24, API de dados, storage e funções respondiam `UNAUTHORIZED`). O socket de tempo real rejeita o `AUTHENTICATE` com um frame `AUTH_ERROR` trazendo o mesmo código. | Contate um administrador. |
| `EMAIL_NOT_CONFIRMED` | 403 | `requireEmailVerification` está ativado e o endereço ainda não foi verificado. Retornado apenas mediante envio da senha correta; um novo link é enviado por e-mail. | Acesse o link enviado no e-mail. |
| `PROOF_REQUIRED` | 409 | `POST /auth/verify-email`: a conta contém uma senha ou identidade que ninguém confirmou, e a requisição não comprova nenhuma das duas. O token não é invalidado. | Envie `password` para mantê-la ou `removeUnproven: true` para verificar sem ela. |
| `UNDELIVERABLE_ADDRESS` | 400 / 409 | Foi solicitado um e-mail de verificação para um endereço inacessível — endereço de convidado ou placeholder do X (400) — ou uma conta solicitou alteração para esse tipo de endereço (409, `POST /auth/change-email`). | Defina um endereço real primeiro. |
| `EMAIL_UNCHANGED` | 400 | `POST /auth/change-email` especificou o endereço de e-mail atual da conta. | Nada para alterar. |
| `ANONYMOUS_USER` | 403 | Um convidado tentou alterar o endereço de e-mail; convidados não possuem endereço próprio. | Converta-o em uma conta antes (`POST /auth/anonymous/link`). |
| `MFA_NOT_ENROLLED` | 400 | Códigos de recuperação foram solicitados para uma conta sem um segundo fator verificado. | Registre um fator primeiro. |
| `HOOK_REJECTED` | 400 | Um hook `beforeUserCreate`, `beforeLogin`, `beforeUserDelete` ou `beforeEmailChange` disparou um erro. A mensagem é a do próprio hook; um hook que definiu um status 4xx responde com ele. | Veja a mensagem. |
| `INVALID_JSON` | 400 | O corpo da requisição não é um JSON válido. | Envie um corpo no formato JSON. |
| `SELF_DISABLE` | 400 | Um administrador tentou desativar a própria conta. | Peça a outro administrador. |
| `NOT_SUPPORTED` | 501 | O repositório de autenticação deste backend não suporta a ação solicitada (desativar contas, alterar e-mail). | Reinicie o servidor para que a coluna seja adicionada ou use um repositório compatível. |
| `UNKNOWN_SCOPE_TARGET` | 400 | O alvo de um escopo define uma coleção, fonte de armazenamento ou função não atendida por este backend. `details` lista as opções disponíveis. | Corrija o alvo do escopo. |
| `UNVERIFIED_IDENTITIES` | 409 | Um magic link, código por e-mail ou redefinição de senha confirmou o endereço de uma conta não verificada, mas a conta possui uma identidade cujo provedor nunca validou esse endereço. O repositório de autenticação não consegue removê-la (falta `unlinkUserIdentity`), então a confirmação é recusada para evitar manter essa vulnerabilidade em uma conta verificada. | Implemente `unlinkUserIdentity` no repositório de autenticação personalizado ou solicite a revisão da conta por um admin. |
| `SETUP_REQUIRED` | 403 | O projeto ainda não possui um administrador, portanto esta rota não está disponível. | Conclua a configuração do primeiro administrador. |
| `TOKEN_ALREADY_USED` | 401 | Um token de uso único foi reutilizado, ou um refresh token rotacionado há mais de `refreshTokenReuseIntervalSeconds` foi apresentado. | Solicite um novo ou faça login novamente. |
| `TOKEN_EXPIRED` | 401 | O tempo de vida útil do token expirou. | Solicite um novo token. |
| `USER_NOT_FOUND` | 404 | Nenhuma conta encontrada com este id. | Verifique o id. |
| `WEAK_PASSWORD` | 400 | A senha não atende à [política de senhas](/docs/backend/auth-endpoints/#password-policy) (por padrão, 8+ caracteres com letras maiúsculas, minúsculas e dígitos) — no cadastro, redefinição, alteração e ao definir senhas via admin: `POST /api/admin/users`, criação na coleção de usuários via API de dados, `PUT /api/admin/users/:id` ou `POST /api/admin/users/:id/reset-password`. | Escolha uma senha mais forte. Administradores importando contas podem enviar `skipPasswordPolicy: true` na criação. |

## Dados, consultas e escritas

| Código | Status | Significado | O que fazer |
| --- | --- | --- | --- |
| `AGGREGATE_NOT_SUPPORTED` | 501 | O driver atual não suporta o cálculo da agregação solicitada. | Use um driver compatível ou calcule no cliente. |
| `BRANCHING_UNSUPPORTED` | — | Foi solicitada uma branch de banco de dados via WebSocket do Studio no banco de desenvolvimento gerenciado (PGlite), onde a branch *é* o próprio pai e nada seria isolado. A recusa é a mesma exibida por `rebase db branch`. | Aponte `DATABASE_URL` para uma instância própria do Postgres (`rebase dev --docker` inicia uma) e crie branches nela. |
| `BATCH_TOO_LARGE` | 400 | `POST /api/data/_batch` contém mais operações que o limite por lote (padrão de 1000). Um batch opera em uma única transação e mantém seus locks durante toda a execução. | Envie em partes menores; a mensagem informa o limite e a quantidade enviada. |
| `BATCH_UNSUPPORTED` | 400 | O driver deste backend não oferece suporte a escritas atômicas entre coleções diferentes, e iterar escritas individuais não seria atômico nem executado em uma única ida e volta. | Envie as alterações em requisições separadas ou use chamadas `/bulk` específicas por coleção. |
| `BULK_TOO_LARGE` | 400 | O corpo da operação em massa excede o limite configurado de itens. | Divida a requisição. |
| `BULK_UNSUPPORTED` | 400 | Esta coleção ou driver não oferece suporte a escritas em massa (bulk). | Grave as linhas individualmente. |
| `CALLBACK_REJECTED` | 400 / 403 | Um callback de coleção rejeitou a escrita. Um `throw` originado em `beforeSave`/`beforeDelete`/`after*` resulta em 400 contendo a mensagem do desenvolvedor; um `beforeDelete` que retorna `false` resulta em 403. `details.stage` informa qual callback e `details.path` indica a coleção. | Leia a mensagem — ela foi definida pelo próprio projeto, não pelo Rebase. |
| `CALLBACK_RECURSION` | 500 | Escritas iniciadas por hooks atingiram uma profundidade maior que 16 níveis: uma escrita via `context.data` dentro de um hook dispara novamente os hooks daquela coleção sem condição de parada — geralmente um `afterSave` atualizando incondicionalmente a própria linha. Toda a escrita foi revertida (rollback). A mensagem indica o hook e a coleção; `details.chain` lista cada etapa hook → escrita. | Torne a escrita do hook condicional: atue apenas em `status === "new"` ou ignore caso `values` já contenha os dados que seriam gravados. |
| `CURSOR_WITH_OFFSET` | 400 | `?after=` foi combinado com `?offset=` ou `?page=`. Um cursor já especifica onde a página inicia; usar um deslocamento sobre ele ignora silenciosamente linhas após o cursor — gerando uma lacuna invisível na resposta. | Utilize apenas um ou outro. |
| `DISTINCT_NOT_APPLICABLE` | 400 | `?distinct=true` foi combinado com uma busca textual ou vetorial. Ambas atribuem uma pontuação (score) por linha, de modo que duas linhas nunca serão iguais e o `DISTINCT` não agrupará nada — pareceria ter funcionado sem alterar nada. | Remova um dos dois parâmetros. |
| `DISTINCT_ORDER_BY_NOT_SELECTED` | 400 | Uma leitura com `distinct` está ordenada por uma coluna não retornada. Um `SELECT DISTINCT` só pode ser ordenado por colunas contidas em sua lista de seleção; caso contrário, as linhas agregadas não possuem ordem definida. `details.fields` lista quais são. | Adicione esses campos a `?fields=` ou remova-os de `?orderBy=`. |
| `DATABASE_UNAVAILABLE` | 503 | Não foi possível conectar ao banco de dados: conexão recusada ou perdida, falha na resolução de DNS do host, servidor iniciando/desligando, ou banco bloqueado para novas conexões (`ALLOW_CONNECTIONS false`, deixado ativo em uma fonte após interrupção de `rebase db branch create --force`; o log informa o banco e `rebase db branch list` o reabre). Retornado por todos os acessos, incluindo login, rotas de admin e socket em tempo real (frame `ERROR`). Enviado com `Retry-After: 5`. Na 0.24, essa indisponibilidade retornava `ROLE_LOOKUP_FAILED`, `INTERNAL_ERROR` ou 500 com código `ECONNREFUSED`. | Tente novamente; o SDK gerencia isso. Verifique se o banco está em execução e acessível. |
| `DB_CONNECT_TIMEOUT` | 503 | O estabelecimento de uma nova conexão levou mais tempo que `DB_POOL_CONNECT_TIMEOUT`: banco sobrecarregado ou distante geograficamente. Enviado com `Retry-After`. | Tente novamente; o SDK gerencia isso. Avalie a carga e a rede até o banco. |
| `DB_PERMISSION_DENIED` | 500 | O Postgres recusou o comando (`42501`): violação de política de RLS ou ausência de `GRANT`. | Consulte a seção de [Solução de problemas](/docs/troubleshooting/). |
| `DB_POOL_EXHAUSTED` | 503 | Todas as conexões do pool permaneceram ocupadas por mais de `DB_POOL_CONNECT_TIMEOUT`; a requisição não alcançou o banco. Trata-se de sobrecarga, não de falha interna; enviado com `Retry-After`. O servidor loga a recomendação uma vez por minuto. | Tente novamente; o SDK gerencia isso. Aumente `DB_POOL_MAX` ou investigue consultas lentas e transações longas que estejam retendo conexões. |
| `FIELD_NOT_READABLE` | 400 | Um filtro, `orderBy`, `fields`, `select` de agregação ou `groupBy` referencia um campo que as roles do chamador não podem ler (`access.read`), ou um caminho aninhado/ordenação agregada cita uma relação inacessível — ou ainda uma operação de campo (`$inc`, `$push`, …) tem como alvo um campo inacessível, onde a recusa revelaria o valor armazenado. Qualquer campo oculto na resposta deve ser inacessível para consultas, sob pena de vazar valores através de predicados sucessivos. Filtros por relação (`author.salary`) e ordenações agregadas (`max(staff.salary)`) seguem as permissões do alvo. `details.violations` cita cada campo. Campos ocultos com `excludeFromApi` agem como inexistentes: ao serem referenciados, retornam a mesma resposta que nomes com erros de digitação (`UNKNOWN_FILTER_FIELD`, etc.). | Remova o campo da consulta ou obtenha a role apropriada. Veja [Acesso a campos](/docs/collections/field-access/). |
| `FIELD_NOT_WRITABLE` | 400 | O corpo tenta definir um campo que as roles do chamador não podem gravar (`access.write`). Ocorre recusa em vez de descarte silencioso: ignorar o campo confirmaria erroneamente uma alteração não efetuada. Também ocorre ao tentar gravar via registro pai uma relação inacessível, ou tentar atualizar um campo de `softDelete` — este só pode ser alterado por exclusão. `details.violations` lista os campos. | Remova o campo ou obtenha a role requerida. Campos com escrita proibida para todos retornam `VALIDATION_EXCLUDED_FIELDS`. |
| `HISTORY_UNAVAILABLE` | 503 | Uma escrita em coleção com `history: true` foi rejeitada porque o histórico não pôde ser gravado: a tabela `rebase.entity_history` não existe ou, no caso de `openRebase` e `rebase console`, falta a função `rebase.record_history`. Ocorre quando nenhum backend com histórico ativo foi inicializado neste banco. Nenhuma alteração foi realizada (incluindo callbacks); leituras continuam funcionando. Lançado por `openRebase` e retornado em instâncias com `provision: false`. | Inicialize o backend ao menos uma vez com histórico ativado e `provision: true` (feito pelo `rebase dev`) e tente novamente. |
| `IDEMPOTENCY_KEY_IN_PROGRESS` | 409 | Uma requisição anterior com o mesmo `Idempotency-Key` ainda está em execução. | Aguarde a conclusão da requisição original e tente novamente. |
| `IDEMPOTENCY_KEY_REUSED` | 422 | O mesmo `Idempotency-Key` foi reenviado com parâmetros diferentes: método, caminho, query string ou corpo distintos. | Gere uma nova chave ou repita a requisição original de forma idêntica. |
| `INVALID_AGGREGATE_FUNCTION` | 400 | O parâmetro `?select=` utilizou uma função diferente de `count`, `sum`, `avg`, `min` ou `max`. | Utilize uma das opções suportadas listadas na mensagem de erro. |
| `INVALID_AGGREGATE_SELECT` | 400 | Um item em `?select=` não segue o formato `fn(field)` ou uma função que não seja `count()` foi chamada sem indicar o campo. | Utilize o formato correto, ex.: `sum(total)`, `count()`, `avg(score)`. |
| `INVALID_AGGREGATE_WINDOW` | 400 | Uso de `offset`, `page` ou `orderBy` em agregações sem `groupBy`, ou uso de cursores em qualquer agregação. Agregações sem agrupamento retornam uma única linha, e um grupo não se comporta como uma linha contínua para cursores. | Inclua `groupBy` ou remova os parâmetros; pagine grupos via `offset` ou `page`. Veja [Agregações](/docs/sdk/aggregates-and-search/#aggregates). |
| `INVALID_BATCH_BODY` | 400 | Uma operação em `/_batch` não possui `op`, `collection`, `values` ou `id`, referencia uma coleção inexistente neste backend, ou reutiliza um identificador `ref`. | Consulte a mensagem; ela indica o índice da operação inválida. |
| `INVALID_BATCH_REF` | 400 | Um item `{ "$ref": "<name>.<field>" }` aponta para uma operação futura, inexistente ou solicita um campo ausente na linha de referência. Referências devem ser estritamente retrospectivas. | Defina a operação com `ref` *antes* de referenciá-la. |
| `INVALID_BULK_BODY` | 400 | O corpo da requisição em massa não corresponde ao formato esperado. | Envie a estrutura esperada pela rota: `{ "rows": [...] }` para `POST /bulk`, `{ "updates": [{ "id", "data" }] }` para `PATCH /bulk`, `{ "ids": [...] }` para `POST /bulk/delete`. |
| `INVALID_CONFLICT_TARGET` | 400 | Os campos em `on_conflict` / `onConflict` de um upsert não possuem garantia de unicidade, não foram enviados com `upsert: true`, ou foram enviados em uma criação aninhada. O Postgres retornaria 42P10 no meio de uma transação em andamento. Aplica-se também a upserts na coleção de usuários (auth), onde criação e atualização seguem fluxos distintos. | Declare `validation: { unique: true }` ou crie um índice `unique`. Na coleção de usuários, envie `POST` para criar e `PATCH` para atualizar. |
| `INVALID_COUNT` | 400 | O parâmetro `?count=` recebeu valor diferente de `exact` ou `none`. Rejeitado para evitar custos acidentais de contagem decorrentes de erros de digitação (ex.: `?count=nnone`). | Envie `exact` (padrão) ou `none`. Veja [Ignorando a contagem](/docs/backend/api/#skipping-the-count). |
| `INVALID_CURSOR` | 400 | O cursor `after` é inválido ou contém um id incompatível com as colunas chave da coleção: foi truncado, alterado ou criado manualmente. Enviar um cursor com `orderBy` diferente do original retorna `CURSOR_ORDER_MISMATCH` (também 400). | Repasse o valor exato de `meta.nextCursor` obtido na página anterior, com a mesma ordenação. Veja [Paginação](/docs/sdk/pagination/). |
| `INVALID_DELETED_PARAM` | 400 | `?deleted=` contém valor diferente de `include` ou `only`. É rejeitado em vez de ignorado para evitar que erros de digitação como `?deleted=true` mascarem dados. | Envie `include` (ativos e excluídos) ou `only` (apenas excluídos). Omita o parâmetro para buscar apenas registros ativos. |
| `INVALID_DISTINCT` | 400 | `?distinct=` contém valor diferente de `true` ou `false`. | Envie um valor booleano válido (`1` e `0` também são aceitos). |
| `INVALID_FIELD_OPERATION` | 400 | Um operador como `$inc`, `$push`, `$pull` ou `$merge` foi aplicado a um tipo incompatível, com operando malformado, múltiplos operadores no mesmo campo, nome incorreto ou em uma operação de criação (onde não há valor prévio). | Veja [Escrita via REST](/docs/backend/writes/#field-operations); a mensagem indica o campo problemático. |
| `INVALID_FILTER_FIELD` | 400 | O filtro referencia uma propriedade inexistente na coleção. | Verifique a grafia do campo de acordo com o schema da coleção. |
| `INVALID_FILTER_OPERATOR` | 400 | O operador não é compatível com o tipo da propriedade — por exemplo, aplicar `like` a números ou datas. | Veja [Consultando dados](/docs/sdk/querying/). |
| `INVALID_FILTER_VALUE` | 400 | O valor do filtro é incompatível com o tipo da coluna correspondente: ex. `?id=eq.abc` em chave numérica, valor fora do enum, data malformada. `details.dbCode` traz o SQLSTATE. | Envie um valor correspondente ao tipo da coluna. |
| `INVALID_HARD_PARAM` | 400 | `?hard=` recebeu valor diferente de `true` ou `false`. Qualquer outro valor é rejeitado para evitar que um erro de digitação resulte em soft-delete acidental quando o objetivo era purgar. | Envie `true` ou `false`. |
| `INVALID_INCLUDE` | 400 | `?include=` está malformado: lista de caminhos inválida ou objeto de opções incorreto. Relações com mais de três níveis de profundidade geram `INCLUDE_TOO_DEEP` (400). Rejeitado na borda da aplicação para prevenir erro 500 no driver. | Verifique a mensagem; ela indica o caminho incorreto. |
| `INVALID_INPUT` | 400 | O corpo da requisição falhou na validação de schema. | Veja a mensagem de erro detalhada. |
| `INVALID_LIMIT` | 400 | `?limit=` não é um número inteiro entre 1 e o máximo configurado (padrão de 1000); valores maiores são rejeitados (não são truncados). Subscrições em tempo real fora dessa faixa recebem o mesmo código via frame `ERROR`. | Reduza o limite e utilize paginação para os registros restantes. |
| `INVALID_LOGICAL_GROUP` | 400 | Um agrupamento lógico `?or=`, `?and=` ou `?not=` está malformado ou excede a profundidade máxima permitida. | Consulte a mensagem para entender as regras de simplificação de grupos. |
| `INVALID_OFFSET` | 400 | `?offset=` não é um inteiro maior ou igual a 0. | Envie um número inteiro não negativo. |
| `INVALID_ORDER_BY` | 400 | `?orderBy=` não corresponde a `field`, `field:desc`, `field:desc:last`, ou a um array JSON no formato `{ field, direction, nulls }` — ou especifica direção/posicionamento nulo inválidos. | Consulte a mensagem; ela lista as sintaxes suportadas. |
| `INVALID_PAGE` | 400 | `?page=` não é um inteiro maior ou igual a 1 (paginação baseada em índice 1; `?page=0` é considerado erro). | Envie `1` ou superior, ou utilize `?offset=`. |
| `INVALID_PARAM` | 400 | Um parâmetro da query string está malformado. | Veja a mensagem de erro. |
| `INVALID_QUERY_BODY` | 400 | O corpo de `POST …/query` contém valores incompatíveis com os equivalentes da URL: array em parâmetros univalorados (`fields`, `limit`), objeto em filtros, ou redundância entre URL e corpo (o endpoint lê tudo do corpo). | Estruture os valores conforme a URL — string ou lista para repetições; `where`, `include`, `orderBy` e `vector` aceitam JSON. Veja [Consultas longas via corpo](/docs/backend/vector-search/#queries-too-long-for-a-url). |
| `INVALID_VECTOR` | 400 | `?vector=` não é um array JSON de números. | Envie no formato `[0.1,0.2,0.3]`. |
| `INVALID_VECTOR_DISTANCE` | 400 | `?vector_distance=` recebeu valor diferente de `cosine`, `l2` ou `inner_product`. | Utilize uma dessas três opções métricas. |
| `INVALID_VECTOR_THRESHOLD` | 400 | `?vector_threshold=` não é numérico. | Envie um número válido. |
| `INVALID_WHERE` | 400 | `?where=` não é um objeto JSON mapeando campos a condições. | Envie no formato `{"status":["==","active"]}`. |
| `KEY_IMMUTABLE` | 400 | Uma atualização tentou alterar a chave primária da linha para um valor diferente do atual — seja no corpo ou via `beforeSave`. Linhas não podem mudar de identificador primário. Rejeitado antes da execução de hooks, sem gravar nada. `details.violations` cita o campo. | Crie um novo registro com a nova chave e exclua o antigo. Enviar a mesma chave já existente é permitido. |
| `MISSING_AGGREGATE_SELECT` | 400 | Rota de agregação executada sem o parâmetro obrigatório `?select=`. | Adicione a seleção, ex.: `?select=count()`. |
| `NO_COLLECTIONS` | 404 | O projeto não expõe nenhuma coleção: nenhuma declarada no código e nenhuma tabela correspondente no banco. Se tabelas existirem sem RLS habilitado, a mensagem indica o SQL necessário e `details.unprotectedTables` as lista (na 0.24, informava ausência de tabelas). | Crie as tabelas — via migration, SQL ou arquivo de coleção com `rebase db push` — e reinicie o servidor. |
| `NOT_FOUND` | 404 | Nenhum registro encontrado com esse id nesta coleção — ou registro oculto por regras de RLS para este usuário. | Verifique o id informado e as regras de `securityRules` da coleção. |
| `UNKNOWN_RELATION` | 400 / 404 | `?include=` referencia algo que não é uma relação na coleção. Retorna **404** caso ocorra diretamente no *caminho da URL* (ex.: `/api/data/authors/1/posts` se `authors` não declarar essa relação), pois a rota deixa de existir. | Verifique a relação declarada na coleção. Relações inversas precisam ser explicitamente configuradas no pai para navegação. |
| `ORDER_BY_FIELD_NOT_SORTABLE` | 400 | A propriedade indicada para ordenação não permite ordenação. | Ordene por uma propriedade vinculada a uma coluna física. |
| `PAGE_WITH_OFFSET` | 400 | `?page=` foi usado com `?offset=` — ou combinação de `page` e `offset` em `find()`. Como ambos definem a janela de busca, o cliente SDK rejeita previamente para evitar sobreposições invisíveis. | Utilize apenas um dos dois parâmetros. |
| `PAYLOAD_TOO_LARGE` | 413 | O corpo da requisição excede o limite configurado. | Reduza o volume de dados enviados ou eleve o limite no servidor. |
| `READ_ONLY_TRANSACTION` | 409 | Um callback `afterRead` tentou realizar escrita. Consultas de leitura rodam em transações `READ ONLY`, bloqueando escritas no callback ou em chamadas aninhadas. | Mova a escrita para fora da leitura: use jobs assíncronos em segundo plano ou `rebase.dataAsAdmin` em cron jobs ou funções customizadas. |
| `RELATION_HAS_NO_PIVOT` | 400 | A escrita continha dados adicionais para a ligação, mas o caminho não passa por um `manyToMany` com `through.properties` configurado — logo, não há tabela intermediária para armazená-los. | Declare `through.properties` na relação ou remova os dados da junção na escrita. Veja [Relações](/docs/collections/relations/). |
| `RELATION_MISCONFIGURED` | 500 | Uma relação não pôde ser resolvida no schema registrado. A operação é rejeitada para evitar falsos sucessos em gravações ou retornos vazios para dados existentes. | Execute `rebase schema generate` se o schema gerado estiver defasado em relação ao banco. |
| `RELATION_NOT_UNLINKABLE` | 400 | Esta relação não permite desvinculação a partir desta ponta. | Execute a desvinculação a partir do lado proprietário da relação. |
| `RELATION_NOT_WRITABLE` | 400 | O caminho aninhado não é uma relação gravável, ou a escrita tenta passar por relações `via` com múltiplos saltos (apenas saltos únicos são graváveis). `details.fields` traz as chaves `via`. Nada foi salvo. | Escreva diretamente nas coleções que compõem a cadeia. Veja [Relações](/docs/collections/relations/#via--an-explicit-join-chain). |
| `RELATION_PIVOT_UNSUPPORTED` | 400 | A relação possui colunas na tabela de junção, mas a fonte de dados atual não suporta gravação nelas. | O vínculo em si é criado, mas os dados complementares são ignorados. Valide os recursos do driver. |
| `RELATION_SOURCE_KEY_EMPTY` | 400 | A escrita da relação não possuía chave de origem para vincular a associação. | Salve o registro pai antes de criar a associação. |
| `RESULT_TOO_LARGE` | — | Um comando enviado via `EXECUTE_SQL` do socket em tempo real (`admin.executeSql`, catálogos do painel) gerou mais de 128 MB de dados e foi cancelado. Retornado via frame `ERROR` do WebSocket. Execuções do console SQL não sofrem essa recusa e exibem os primeiros resultados. | Inclua um `LIMIT`, reduza as colunas selecionadas e pagine o resultado. |
| `ROW_IN_TRASH` | 409 | A chave do upsert pertence a um registro na lixeira (soft-deleted). Upserts não sobrescrevem registros logicamente excluídos em nenhum ponto de entrada (REST `?on_conflict=`, `/bulk`, `/_batch`, SDK ou socket). Nada foi modificado. | Restaure o registro previamente (definindo o campo de exclusão para `null`) ou purgue-o usando `?hard=true` antes do upsert. Veja [Soft delete](/docs/collections/soft-delete/). |
| `SCHEMA_DRIFT` | 500 | Uma tabela ou coluna esperada pelo código não existe no banco de dados físico. | Execute `rebase db push` em desenvolvimento; faça novo deploy em tenants gerenciados. |
| `SCORE_CURSOR_UNSUPPORTED` | 400 | `startAfter` foi utilizado com `orderBy: "_score"`. Relevância é calculada sob demanda e varia a cada busca, não servindo como chave fixa de cursor. | Pagine os resultados usando `limit`/`offset` ou ordene por colunas físicas. |
| `SQL_ERROR` | 400 | O banco recusou uma instrução SQL personalizada. No socket de tempo real via `EXECUTE_SQL`, emite um frame `ERROR` com a resposta do banco. Em `POST /api/admin/sql/csv`, o erro é retornado antes do envio do arquivo: erro de sintaxe, tentativa de escrita (o download é estritamente de leitura), múltiplos comandos ou roles não autorizadas. | Corrija o SQL. Exportações aceitam um único `SELECT`, `WITH … SELECT`, `TABLE` ou `VALUES`. |
| `TENANT_IMMUTABLE` | 400 | A escrita transferiria um registro para outro tenant. Registros não podem mudar de tenant. `details.violations` cita o campo. | Crie um novo registro no tenant de destino e remova o original, ou execute com uma role presente em `tenant.bypassRoles`. |
| `TENANT_MISMATCH` | 400 | A escrita referencia um tenant ao qual o chamador não pertence; a operação também seria barrada pelo banco. | Escreva em um tenant ao qual você possui acesso ou autentique-se com credenciais pertencentes a ele. |
| `TENANT_REQUIRED` | 400 | A coleção é particionada por tenant e não foi possível deduzir o tenant: a requisição não informa nenhum ou o chamador pertence a vários. | Informe o campo de tenant explicitamente ou autentique-se sob o escopo de um único tenant. |
| `TRANSACTION_ABORTED` | 500 | Uma instrução da transação falhou e o erro foi capturado por um callback. O Postgres já havia abortado a transação, ocasionando rollback de toda a operação. Apenas erros de criação, edição ou exclusão disparados via `context.data` que o banco rejeitou são desfeitos de forma isolada e seguros para captura em try/catch. | Permita que o erro seja lançado ou valide os dados antes de rodar o comando. Veja [Semântica de transações](/docs/collections/context-data-api/#transaction-semantics). |
| `UNKNOWN_FIELD` | 400 | `?fields=` solicita um campo inexistente na coleção. | Verifique a grafia; a mensagem lista os campos aceitos. |
| `UNKNOWN_AGGREGATE_FIELD` | 400 | A agregação ou `groupBy` indica um campo inexistente na coleção. | Verifique a grafia; a mensagem lista os campos aceitos. |
| `UNKNOWN_FILTER_FIELD` | 400 | O filtro faz referência a um campo inexistente na coleção (ou no alvo da relação), ou a um campo protegido com `excludeFromApi`. | Verifique a grafia; a mensagem lista os campos válidos. |
| `UNKNOWN_FILTER_OPERATOR` | 400 | O operador de filtro informado não existe. | A mensagem lista todos os operadores disponíveis. |
| `UNKNOWN_MESSAGE_TYPE` | 400 | Um frame de WebSocket contém um `type` desconhecido pelo servidor. Respondido com frame `ERROR` contendo o `requestId` para evitar timeouts no cliente. | Valide o campo `type` do frame; a mensagem traz o tipo recebido. |
| `UNKNOWN_ORDER_BY_FIELD` | 400 | A ordenação selecionou um campo inexistente na coleção. | Verifique a grafia; a mensagem lista os campos aceitos. |
| `PRECONDITION_FAILED` | 412 | O cabeçalho `If-Match` informou uma versão desatualizada da linha: alterações concorrentes ocorreram entre a leitura e a escrita atual. Nenhuma alteração foi realizada. | Leia a linha novamente, aplique as modificações necessárias e reenvie com o novo `ETag`. |
| `UNKNOWN_RESPONSE_FIELD` | 400 | `?fields=` pede um campo que a coleção não possui. | Verifique a grafia; a mensagem lista os campos conhecidos. |
| `UNKNOWN_VECTOR_PROPERTY` | 400 | A busca vetorial indicou uma propriedade que não é do tipo `vector` na coleção. | A mensagem traz a lista de propriedades vetoriais válidas na coleção. |
| `UNSUPPORTED_MEDIA_TYPE` | 415 | O cabeçalho `Content-Type` não é aceito por esta rota. | Envie os dados no formato documentado pela rota. |
| `UNSUPPORTED_OPTION` | — | Lançado internamente (não retornado via HTTP): chamadas diretas no processo (`context.data` em hooks, `rebase.data` em funções/cron) receberam `ifMatch` ou `idempotencyKey`. O acesso direto não possui validação de pré-condições nem controle de idempotência; por isso, a chamada é recusada imediatamente em vez de ignorar as opções silenciosamente. | Remova essas opções no acesso em memória ou faça a escrita via cliente HTTP, que suporta ambas. |
| `UNSUPPORTED_RELATION_FILTER` | 400 | O filtro tenta cruzar uma relação `via`, cuja junção é configurada em sentido único, impedindo a correlação reversa na subconsulta. | Aplique o filtro partindo da ponta proprietária da relação. |
| `UNSUPPORTED_RELATION_FILTER_OPERATOR` | 400 | O operador é incompatível com o campo: relações sem coluna direta na linha filtram por pertencimento, e operadores de texto (`like`, `ilike`) exigem strings. | Consulte a mensagem; ela traz os formatos aceitos pelo campo. |
| `VALIDATION_CONSTRAINT` | 400 | Um valor violou uma regra de `validation` da propriedade — comprimento, faixa numérica, regex ou campo obrigatório. | Consulte a mensagem; ela detalha cada violação encontrada. |
| `VALIDATION_EXCLUDED_FIELDS` | 400 | A escrita tentou alterar uma coluna com `excludeFromApi` ou `access: { write: [] }`. Essas propriedades são de controle exclusivo do servidor (ex.: hash de senha, token de validação). Ao contrário de `FIELD_NOT_WRITABLE`, essa regra se aplica a todos os chamadores, inclusive `admin`. | Remova o campo da requisição. Veja [Acesso a campos](/docs/collections/field-access/). |
| `VALIDATION_INVALID_VALUE` | 400 | O valor informado é incompatível com a definição de tipo da propriedade. | Veja a mensagem; ela especifica a propriedade afetada. |
| `VALIDATION_UNKNOWN_FIELDS` | 400 | O corpo da escrita lista campos não mapeados na coleção — inclusive o envio de `id` em coleções que utilizam outra chave primária. | Verifique a grafia; a mensagem lista os campos registrados. |
| `VECTOR_CURSOR_UNSUPPORTED` | 400 | Um cursor (`after` / `startAfter`) foi associado a uma busca vetorial. A ordenação é feita pela distância calculada em tempo real para cada busca, inviabilizando cursores estáticos; buscas vetoriais não retornam `nextCursor`. | Pagine os resultados mais próximos através de `limit`/`offset`. |
| `WRITE_DENIED` | 403 | Uma regra de segurança ou política de RLS bloqueou a operação de escrita. | Revise as definições de `securityRules` da coleção. |

## `PG_<SQLSTATE>` — uma constraint recusada pelo banco de dados

Uma escrita recusada pelo Postgres devido aos *dados enviados pelo chamador*
retorna com o SQLSTATE embutido no código: `PG_23505`, `PG_23503`, e assim por diante.
Trata-se de uma família dinâmica, não de uma lista estática — o Postgres possui
centenas de SQLSTATEs —, mas apenas duas classes são expostas dessa forma, pois
somente elas decorrem de ações diretas do chamador:

- **classe 23**, violação de restrição de integridade: duplicatas, chave estrangeira
  apontando para registro inexistente, coluna `NOT NULL` vazia;
- **classe 22**, exceção de dados: valor incompatível com os limites do tipo da coluna.

Todas as demais — conexões caídas, colunas inexistentes, falhas de permissão — são
erros do servidor e mantêm o status `500`. Dessa forma, `code.startsWith("PG_")` é
uma verificação segura para "os dados enviados estavam incorretos", sendo os quatro
casos abaixo os mais frequentes no cliente. `details.dbCode` contém o SQLSTATE
correspondente em todos eles, e a mensagem indica a constraint violada.

| Código | Status | Significado | O que fazer |
| --- | --- | --- | --- |
| `PG_22P02` | 400 | Um valor não pôde ser interpretado pelo tipo da coluna — equivalente de escrita para `INVALID_FILTER_VALUE`. | Envie um valor compatível com o tipo da coluna. |
| `PG_23502` | 400 | Uma coluna com restrição `NOT NULL` ficou vazia. | Forneça o campo ou configure um valor padrão (default) na coluna. |
| `PG_23503` | 400 / 409 | Na escrita: chave estrangeira referencia linha inexistente (400). Na exclusão: outras linhas referenciam este registro (409; chaves com `RESTRICT` disparam `PG_23001`, também 409). | Crie a linha de destino antes ou corrija o id; na exclusão, remova ou desvincule antes as linhas dependentes. |
| `PG_23505` | 409 | Violação de constraint de unicidade (unique constraint). A mensagem identifica a restrição. | Utilize um valor diferente ou atualize o registro já existente. |

## Storage

| Código | Status | Significado | O que fazer |
| --- | --- | --- | --- |
| `INVALID_LIST_OPTIONS` | 400 | O parâmetro `maxResults` de listagem não é um inteiro maior ou igual a 1, ou `pageToken` é inválido para esta fonte. Anteriormente, limites menores que 1 retornavam páginas vazias com o mesmo token, travando loops `while (pageToken)`. | Defina um `maxResults` positivo e repasse `nextPageToken` inalterado. |
| `INVALID_STORAGE_BUCKET` | 400 | O nome do bucket é inválido. | Verifique o nome do bucket. |
| `INVALID_STORAGE_KEY` | 400 | A chave do arquivo está malformada, ultrapassa seu prefixo ou usa prefixos reservados (`_rebase/renditions/`, `_rebase/maintenance/`). | Verifique a chave do arquivo. |
| `INVALID_TRANSFORM_OPTIONS` | 400 | Os parâmetros de transformação de imagem estão fora dos limites aceitos ou são conflitantes. | Veja [Storage](/docs/backend/storage/). |
| `STORAGE_FILE_TOO_LARGE` | 413 | O arquivo enviado ultrapassa o `maxSize` estabelecido na propriedade de destino. Validado no servidor, não apenas no navegador. `details` traz a propriedade, o limite e o tamanho real recebido. | Envie um arquivo menor ou aumente o `maxSize` na propriedade. |
| `STORAGE_FILE_TYPE_REFUSED` | 400 | O tipo MIME do arquivo não consta no `acceptedFiles` da propriedade ou viola os `allowedMimeTypes` da fonte de armazenamento. `details` cita a propriedade/fonte, a lista permitida e o Content-Type enviado. | Envie um tipo permitido ou amplie a lista em `acceptedFiles` / `allowedMimeTypes`. |
| `STORAGE_MISCONFIGURED` | 502 | O bucket S3 ou GCS configurado não existe, ou as credenciais desta implantação foram recusadas pelo provedor. A mensagem cita o bucket; `details.reason` reporta `NoSuchBucket` ou a resposta do provedor. Buckets inexistentes eram mascarados anteriormente como "file not found". | Corrija o nome do bucket (`S3_BUCKET` / `GCS_BUCKET`, `__<KEY>` em fontes nomeadas) ou ajuste as permissões das credenciais. |
| `STORAGE_NOT_CONFIGURED` | 501 / 503 | Nenhum backend de storage foi configurado no servidor, ou nenhum é padrão e a chamada não especificou a fonte; a mensagem lista as fontes ativas (501). Se a fonte desaparecer durante um upload retomável (resumable), retorna 503. | Configure S3, GCS ou armazenamento local, ou identifique a fonte via `?storageId=`. |
| `STORAGE_SAME_LOCATION` | 400 | Chamada a `POST /api/admin/storage/move` com `deleteSource` (`rebase storage move --delete-source`) entre fontes que usam o mesmo bucket ou diretório. Os arquivos seriam detectados como já existentes e a exclusão da fonte apagaria a única cópia. Nenhuma ação foi realizada. | Aponte a propriedade para a outra fonte diretamente; os arquivos já residem no local. |
| `STORAGE_SCAN_INCOMPLETE` | 409 | `DELETE /api/admin/storage/orphans` (`rebase storage orphans --delete`) falhou na leitura de certas coleções, o que poderia marcar como órfãos arquivos legítimos. Usando `?scan=`, indica que a verificação informada não cobriu todas as coleções. Nada foi excluído; `details.unscanned` cita cada coleção e o motivo da falha. | Solucione o erro de acesso às coleções e execute a varredura novamente. |
| `STORAGE_SCAN_NOT_FOUND` | 404 | `GET /api/admin/storage/orphans/scans/:id` ou `DELETE /api/admin/storage/orphans?scan=:id` especifica uma varredura inexistente na fonte. Varreduras são mantidas por 7 dias na fonte em que foram geradas; usar um `storageId` diferente impede a localização. | Forneça o `storageId` correspondente ao scan ou inicialize uma nova varredura. |
| `STORAGE_SCAN_NOT_COMPLETE` | 409 | `DELETE /api/admin/storage/orphans?scan=:id` referencia um scan ainda nos estados `queued` ou `running`, ou com falha (`failed`). Nada foi excluído; `details.status` traz o estado atual. | Aguarde o término da varredura ou dispare uma nova. |
| `STORAGE_SCAN_EXPIRED` | 409 | `DELETE /api/admin/storage/orphans?scan=:id` cita uma varredura finalizada há mais de 15 minutos. Nada foi excluído. | Execute uma nova varredura e proceda à limpeza a partir dela. |
| `STORAGE_SCAN_DELETION_STARTED` | 409 | `DELETE /api/admin/storage/orphans?scan=:id` referencia um scan cujos órfãos já estão em processo de remoção. | Acompanhe a remoção (`deletion`) com `GET /api/admin/storage/orphans/scans/:id`. |
| `STORAGE_SOURCE_NOT_CONFIGURED` | 501 | A fonte de armazenamento está declarada no código, mas não possui credenciais configuradas neste ambiente. | Configure as variáveis de ambiente referentes a essa fonte. |
| `STORAGE_WRITE_FAILED` | 502 | O serviço de armazenamento recusou ou interrompeu a gravação. | Verifique as credenciais e os logs do provedor de storage. |
| `TRANSFORM_OVERLOADED` | 503 | Limite de transformações simultâneas de imagem atingido. | Tente novamente em instantes; recomenda-se a adoção de um CDN à frente. |
| `UNKNOWN_STORAGE_SOURCE` | 400 / 404 | A requisição informou uma fonte (`?storageId=`) não declarada no projeto. Um `bucket` não atendido retorna este código com status **404** (em listagens, uploads normais, diretórios ou uploads retomáveis para S3/GCS) — o storage em si está ausente; `details` lista os buckets e fontes existentes. Anteriormente, retornavam "file not found", parecendo ausência do arquivo. | Declare a fonte em `config/resources.ts` ou consulte `GET /api/storage/sources`. |
| `UPLOAD_LOCKED` | 423 | O `PATCH` de um upload retomável chegou enquanto o fragmento anterior ainda estava em processamento — frequentemente causado por retentativas prematuras do cliente. Ocorre recusa em vez de enfileiramento, similar ao comportamento do tusd. | Consulte o offset atual com `HEAD /api/storage/tus/:id` e continue desse ponto; o tus-js-client lida com isso automaticamente via backoff. Veja [Uploads retomáveis (TUS)](/docs/backend/storage-resumable-uploads/). |

## Funções personalizadas

| Código | Status | Significado | O que fazer |
| --- | --- | --- | --- |
| `FUNCTION_NOT_FOUND` | 404 | Nenhuma função atende por esse nome — ou a função existe, mas não possui rotas para o caminho solicitado. Usuários autenticados recebem a lista do que *está* disponível; chamadores anônimos não, preservando o inventário dos endpoints. Se o arquivo da função falhou ao carregar, a mensagem alerta o usuário autenticado citando o arquivo, distinguindo erro de digitação de falha no deploy. Chamadores anônimos recebem resposta padrão de rota desconhecida. | Compare o nome com `GET /api/functions` ou consulte os logs de boot para identificar eventuais falhas de carregamento. |
| `FUNCTION_TIMEOUT` | 504 | A execução da função excedeu o tempo limite máximo configurado. Ela continua em processamento no runtime; não pode ser cancelada daqui. | Defina um `AbortSignal` em requisições de saída ou aumente `REBASE_FUNCTIONS_TIMEOUT_MS`. |
| `FUNCTIONS_UPSTREAM_UNREACHABLE` | 502 | Este processo atua como proxy de funções para outra instância, mas não obteve resposta dela. | Verifique se a instância dedicada de funções está ativa e saudável. |

## Tarefas cron

| Código | Status | Significado | O que fazer |
| --- | --- | --- | --- |
| `CRON_JOB_ALREADY_EXECUTING` | 409 | Disparo manual de uma tarefa cron que já se encontra em execução — neste mesmo processo ou em outro que detenha o lease de execução (como um worker vinculado a um processo `api`). Nenhuma nova execução foi iniciada. O cancelamento fica registrado no histórico; `details.log` traz essa entrada, citando o processo responsável pela execução em curso. | Aguarde a conclusão da execução atual. Veja [Tarefas cron](/docs/backend/cron-across-instances/#concurrency-guarding). |

## Interfaces administrativas e edição de schema

Esses códigos indicam recursos desativados ou pendentes de configuração, não
erros na requisição. Todos são reportados na respectiva rota `/status` com código `200`,
permitindo que painéis desabilitem visualmente as opções em vez de exibir erros.

| Código | Status | Significado | O que fazer |
| --- | --- | --- | --- |
| `ADMIN_SURFACE_UNAVAILABLE` | 501 | Painel ou rota administrativa acessada em servidor sem autenticação configurada; não há como diferenciar administradores de anônimos. | Configure `auth.jwtSecret` ou forneça um `AuthAdapter`. |
| `BRANCH_DIFF_STALE` | 409 | `POST /api/admin/branches/:name/merge` recebeu a assinatura (fingerprint) de um diff desatualizado: a branch ou a base sofreram alterações posteriores. Nada foi mesclado. | Gere o diff novamente, revise as diferenças e proceda ao merge usando o novo `fingerprint`. |
| `BRANCH_DIFF_UNSUPPORTED` | 501 | A fonte de dados atual não suporta comparação de branches: sem suporte a SQL ou sem conexão administrativa para branching. | Utilize um backend Postgres configurando `adminConnectionString`. |
| `BRANCH_MERGE_BLOCKED` | 409 | Uma tabela divergente não pode ser mesclada — tabela criada ou removida na branch, colunas ou primary keys divergentes, ausência de primary key, volume de dados acima da capacidade de correspondência ou tabela reescrita desde a criação da branch (`TABLE_REWRITTEN`). Tabelas sem correspondência de linhas bloqueiam o processo mesmo que as contagens marquem 0: trata-se de valor desconhecido, não zero. `details.tables` lista cada tabela e a justificativa. Nada foi modificado. | Atualize o schema na base via migrations previamente, ou realize o merge com `skipBlocked: true` para ignorar tais tabelas. |
| `BRANCH_MERGE_CONFLICT` | 409 | Linhas foram modificadas simultaneamente na branch e na base, com `onConflict` definido como `"abort"` (padrão); ou a base rejeitou parte do merge — linha alterada durante o processo, ação bloqueada por trigger ou linha oculta por RLS. Nada foi modificado. | Defina a precedência de resolução via `onConflict: "branch"` ou `"target"`, ou inspecione o diff novamente. |
| `BRANCH_MERGE_FAILED` | 409 | A base recusou as linhas da branch durante a instrução de merge — quebra de constraint, valor inválido de enum ou chave estrangeira não satisfeita, frequentemente por divergência entre schemas. `details` inclui `sqlState`, `table`, `constraint` e `detail`. Nada foi salvo. | Avalie as mudanças de schema no diff, alinhe o banco principal com suas migrations ou corrija os dados na branch antes de mesclar novamente. |
| `BRANCH_NOT_FOUND` | 404 | Nenhuma branch encontrada com esse nome no registro. | Consulte as branches existentes via `rebase db branch list` ou na aba Branches. |
| `CONTRACT_UNAVAILABLE` | 404 | O contrato do projeto só é servido quando a autenticação está ativa — ele descreve integralmente tabelas e relações. | Ative a autenticação. A rota `/meta/schema-version` é sempre pública. |
| `DEV_MAILBOX_UNAVAILABLE` | 501 | Caixa postal de desenvolvimento inativa. Captura de e-mails em memória só opera se `SMTP_HOST` não estiver definido e `NODE_ENV` for diferente de production. | Desative `SMTP_HOST` no ambiente de desenvolvimento ou consulte a caixa postal real configurada. |
| `INVALID_CHANGE` | 400 | A alteração de schema solicitada não está bem-formada. | Veja a mensagem de erro. |
| `SCHEMA_CHANGE_FAILED` | 400 | A aplicação da modificação de schema falhou por um motivo não coberto por códigos específicos. | Veja a mensagem; ela traz o erro original na íntegra. |
| `SCHEMA_CHANGE_UNAPPLICABLE` | 400 | A mudança é válida, mas incompatível com o estado atual do schema. | Veja a mensagem de erro. |
| `SCHEMA_EDIT_DIRTY_TREE` | 409 | O repositório contém alterações locais não commitadas, impedindo a modificação segura dos schemas. | Faça commit ou stash das alterações e tente novamente. |
| `SCHEMA_EDIT_REFUSED` | 400 | O editor de schema recusou a operação solicitada. | Veja a mensagem; trata-se da resposta emitida pelo próprio editor. |
| `SCHEMA_EDIT_REQUIRES_A_PERSON` | 403 | Uma chave de API ou agente automatizado tentou aplicar alterações no schema. | Autentique-se como usuário humano ou habilite `liveSchema.allowMachineApply`. |
| `SCHEMA_EDITING_NO_COLLECTIONS_DIR` | 501 | A edição de schema em tempo real exige `collectionsDir` ou `liveSchema.repository`, e o servidor iniciou sem ambos. | Configure ao menos uma dessas opções. |
| `SCHEMA_EDITING_NO_REPOSITORY` | 503 | O planejamento de schema funciona, mas não há repositório configurado para commitar a alteração. | Configure `liveSchema.repository`. |
| `SCHEMA_EDITING_PROVISIONING_OFF` | 409 | Este ambiente não aplica mudanças estruturais no banco (`REBASE_PROVISION=false`), bloqueando a execução direta pelo painel. | Salve as alterações apenas como código e deixe a aplicação do banco a cargo do processo responsável pelo provisionamento. |
| `SCHEMA_EDITING_UNSUPPORTED` | 503 | O driver em uso não tem capacidade de planejar alterações de schema. | A edição dinâmica de schema requer backend Postgres. |
| `SCHEMA_EDITOR_BAAS_MODE` | 501 | As coleções são introspectadas diretamente do banco de dados neste modo; não há arquivos físicos para editar. | Altere o schema através de migrations. |
| `SCHEMA_EDITOR_DISABLED` | 501 | O editor de schema está desativado para este servidor. Aplicações empacotadas (bundles) sempre retornam isso. | Habilite através de `schemaEditor`. Em bundles, defina `REBASE_LIVE_SCHEMA_REPOSITORY` para editar coleções via repositório — veja [Edição de schema em produção](/docs/backend/live-schema-editing#from-a-built-bundle). |
| `SCHEMA_EDITOR_MISSING_DEPENDENCY` | 501 | O editor de schema depende do pacote `ts-morph`, que não está instalado. | Adicione a dependência no pacote que executa o backend e reinicie: execute `pnpm --dir backend add -D ts-morph@28.0.0` da raiz do projeto, ou `pnpm add -D ts-morph@28.0.0` caso o backend seja o projeto principal. A mensagem traz o comando exato. |
| `SCHEMA_EDITOR_NO_COLLECTIONS_DIR` | 501 | O servidor não possui `collectionsDir` definido, impossibilitando a escrita das coleções pelo editor. | Defina a variável/propriedade `collectionsDir`. |
| `SCHEMA_EDITOR_PRODUCTION` | 501 | O editor permanece inativo com `NODE_ENV=production`: arquivos em produção são reconstruídos a partir do repositório a cada deploy, descartando edições feitas em disco. | Edite coleções no ambiente de desenvolvimento e faça deploy, ou configure `liveSchema.repository` para versionar diretamente por lá. |
| `SQL_EXPORT_UNSUPPORTED` | 501 | `POST /api/admin/sql/csv` não consegue transmitir dados em streaming neste ambiente: o banco em memória (PGlite) possui conexão única, e manter um cursor durante o download bloquearia todas as outras consultas; ou a fonte de dados não suporta cursores SQL. | Configure `DATABASE_URL` apontando para seu Postgres (`rebase dev --docker` inicia um) ou use `LIMIT` e exporte visualmente pela interface. |

### Por que a tabela de uma branch não pode ser mesclada

O erro `BRANCH_MERGE_BLOCKED` detalha em `details.tables` cada tabela rejeitada
utilizando um dos códigos abaixo. O mesmo código é apontado no campo `blocked`
da tabela no próprio diff, permitindo ao Studio avisar com antecedência antes
do clique em **Merge**. Nenhum desses códigos é emitido isoladamente como resposta HTTP.

| Código | Status | Significado | O que fazer |
| --- | --- | --- | --- |
| `COLUMNS_DIFFER` | — | As colunas da tabela diferem entre a branch e a base. Linhas só podem ser comparadas com base nas colunas compartilhadas. | Adicione as colunas faltantes na base usando migrations (`rebase db push`) e repita o merge. Migrations que reescrevem a tabela (mudança de tipo) convertem o estado para `TABLE_REWRITTEN`: faça o merge antes dessas alterações ou recrie a branch após a migração. |
| `NO_PRIMARY_KEY` | — | A tabela não tem chave primária, impedindo a correlação de registros linha a linha; o diff computa apenas a contagem bruta. | Defina uma chave primária na tabela ou faça a transferência dos dados manualmente. |
| `PRIMARY_KEY_DIFFERS` | — | As colunas da chave primária, ou os tipos delas, diferem entre as branches. | Sincronize o schema na base primeiro. |
| `TABLE_ADDED` | — | A tabela foi criada exclusivamente na branch. O merge não cria tabelas novas. | Crie a tabela na base via migrations e depois mescle seus dados. |
| `TABLE_DROPPED` | — | A tabela foi apagada na branch. O merge nunca exclui tabelas da base. | Remova-a na base através de migrations. |
| `TABLE_REWRITTEN` | — | Uma das branches reescreveu todas as linhas da tabela após a bifurcação — alteração de tipo de coluna, `ADD COLUMN` com default volátil, `VACUUM FULL`, `CLUSTER` — fazendo com que todas as linhas pareçam novas e impossibilitando determinar a autoria das alterações. | Faça o merge da branch antes de migrations desse tipo, ou crie uma nova branch a partir da base após a migração. |
| `TOO_LARGE` | — | A tabela contém mais linhas em uma das pontas do que o limite de comparação linha a linha (padrão de 100.000, `maxRowsPerTable`). | Aumente `maxRowsPerTable` no diff e no merge, ou sincronize essas tabelas por outros meios. |

## Códigos genéricos

Uma rota recorre a um destes códigos quando nenhuma outra falha mais específica se aplica.

| Código | Status | Significado | O que fazer |
| --- | --- | --- | --- |
| `BAD_REQUEST` | 400 | Requisição malformada, sem erro mais específico disponível. | Consulte a mensagem de erro. |
| `UNAUTHORIZED` | 401 | Chamador não autenticado ou credencial inválida. | Faça login ou renove suas credenciais. |
| `FORBIDDEN` | 403 | Autenticado, porém sem autorização para este recurso. | Repetir a requisição com o mesmo usuário não surtirá efeito. |
| `CONFLICT` | 409 | Conflito com o estado atual do recurso. | Consulte a mensagem de erro. |
| `INTERNAL_ERROR` | 500 | Falha interna no servidor. A mensagem é intencionalmente genérica. | Use o `requestId` informado para checar o erro nos logs do servidor. |
| `NOT_CONFIGURED` | 503 | Uma dependência essencial para esta rota não foi configurada no servidor. | Consulte a mensagem de erro. |
| `SERVICE_UNAVAILABLE` | 503 | Um serviço externo do qual a rota depende está inacessível: bucket S3/MinIO fora do ar, ou host externo chamado via `fetch()` em funções que recusa conexão ou não resolve DNS. O log do servidor identifica o host; a resposta HTTP oculta essa informação. Bancos inacessíveis geram `DATABASE_UNAVAILABLE`. Quedas de conexão com esses serviços geram este código; na 0.24, retornavam `500` com erro de socket (`ECONNREFUSED`) ou `INTERNAL_ERROR`. | Tente novamente; analise os logs. |

## Mantendo esta página precisa

O comando `pnpm verify:docs` falha se qualquer código emitido pelo servidor estiver
ausente nestas tabelas, se uma tabela listar um código que o servidor não dispara,
se os status HTTP de uma linha divergirem dos emitidos no código-fonte, ou se uma
família como `PG_<SQLSTATE>` não cobrir um SQLSTATE real enfrentado pelos clientes.
O script responsável é `tooling/scripts/docs-verify/check-error-codes.mjs`.

O validador se testa antes de validar a documentação. A varredura extrai códigos
diretamente do TypeScript em vez de inspecionar um servidor em execução, de modo que
pontos cegos seriam silenciosos por natureza: anteriormente, o analisador ignorava
códigos passados por wrappers de uma única linha ou escritos após mensagens que
continham um `)`, informando falsamente que "todos os códigos do servidor estão
documentados" em uma página que deixava de listar dezessete deles. Por isso, a
etapa executa um teste com exatamente essas estruturas sintáticas antes de ler esta
página, recusando-se a validar se não conseguir detectá-las corretamente.
