---
sourceHash: 5b80afdd275fa940
title: Códigos de erro
sidebar_label: Códigos de erro
description: Cada código de erro que um backend Rebase pode retornar, com seu status HTTP, o que significa e o que fazer a respeito — além do envelope de resposta, X-Request-ID e as regras de details.
---

Toda falha retornada por um backend Rebase usa um único envelope e contém um
`code` estável. O código é o elemento sobre o qual ramificar a lógica: a mensagem
é escrita para uma pessoa e pode ser reformulada, o status é compartilhado por
uma dúzia de problemas diferentes, e o código não é nenhum dos dois.

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

- **`message`** — legível para humanos. Para um `4xx`, é a mensagem do próprio
  servidor; para um `5xx`, é deliberadamente genérica, porque o texto subjacente
  pode citar um host, uma role ou o nome de uma coluna.
- **`code`** — um dos valores abaixo. Estável entre versões secundárias (minor versions).
- **`details`** — opcional e nunca garantido. Veja as regras abaixo.
- **`requestId`** — presente sempre que a requisição tiver passado pelo middleware
  de request-ID, o que inclui todas as rotas sob `basePath`.

### `X-Request-ID`

Toda requisição sob `basePath` recebe um ID: o cabeçalho `X-Request-ID` do
chamador quando for um UUID, caso contrário, um novo. Ele é retornado na
resposta como `X-Request-ID`, incluído no envelope de erro como `requestId` e
anexado à linha de log do servidor para essa requisição.

Essa é a chave de correlação (join key). Cite-a em um relatório de bug e um
operador poderá encontrar a linha de log exata que explica a falha, trazendo o
motivo que nunca foi exibido ao cliente.

Enviar o seu próprio ID é como um rastreamento sobrevive a um salto (hop): um
gateway ou executor de tarefas (job runner) que encaminha o cabeçalho obtém um
único ID em todos os serviços que processaram a requisição. Um valor inválido é
ignorado em vez de rejeitado — um cabeçalho malformado vindo de um chamador não
justifica falhar uma requisição —, portanto, não presuma que o ID enviado é o
ID recebido. Leia o cabeçalho da resposta.

### O que está em `details`

`details` é para diagnóstico, não contratual. Três regras o regem:

1. **Tudo o que uma rota define explicitamente é sempre retornado.** São os
   próprios erros do chamador descritos com precisão: qual campo de filtro era
   desconhecido, qual relação não é gravável, qual valor não coube no seu tipo.
2. **Diagnósticos do banco de dados são reduzidos em produção.** Quando a falha
   vem do Postgres, `details.dbCode` — o SQLSTATE — está sempre presente: ele
   nomeia a classe do problema e não revela nada sobre os dados. `dbMessage`,
   `detail` e `hint` são adicionados apenas quando `NODE_ENV` não for `production`,
   porque o Postgres coloca o conteúdo das linhas neles. O erro `23505` informa
   `Key (email)=(a@b.c) already exists.`, o que responde a "essa pessoa está
   cadastrada?" para qualquer endereço que alguém decida tentar.
3. **Nunca crie lógica condicional (branch) baseada em `details`.** Faça a
   verificação em `code`. O que está sob `details` é apenas o que foi útil para
   uma pessoa naquele ponto de chamada, e isso muda.

## Interpretando um status

| Status | O que diz sobre a requisição |
| --- | --- |
| `400` | Malformada ou solicitando algo que não existe no schema. Corrija a requisição. |
| `401` | Não autenticada ou a credencial expirou. Faça login ou renove o token. |
| `403` | Autenticada, mas não permitida. Tentar novamente com a mesma identidade não ajudará. |
| `404` | Rota, tabela ou linha inexistente — ou uma linha oculta pela segurança em nível de linha (RLS). |
| `409` | Um conflito com o estado existente: uma duplicata ou uma gravação concorrente. |
| `413` `415` `422` | O corpo é grande demais, o tipo de mídia está errado ou foi semanticamente rejeitado. |
| `429` | Limite de taxa atingido (rate limited). Aguarde; a mensagem informa por quanto tempo. |
| `500` | O servidor ou seu banco de dados está com erro, não o chamador. Verifique os logs. |
| `501` | A rota existe, mas esta implantação não pode atendê-la — um recurso desativado ou não configurado. |
| `502` `503` `504` | Uma dependência estava inacessível, não configurada ou muito lenta. |

## Autenticação e contas

| Código | Status | Significado | O que fazer |
| --- | --- | --- | --- |
| `AAL2_REQUIRED` | 403 | A rota precisa de um segundo fator e a sessão possui apenas um. | Conclua o desafio MFA e tente novamente. |
| `ALREADY_VERIFIED` | 400 | O endereço ou fator já foi verificado. | Nada — o estado desejado já é verdadeiro. |
| `ACCOUNT_OUTRANKS_CALLER` | 403 | A conta que está sendo editada, redefinida ou excluída possui uma role ou escopo que o chamador não possui. `details.beyond` lista quais são. | Peça a alguém que os possua para fazer a alteração. |
| `ANONYMOUS_AUTH_DISABLED` | 403 | O login anônimo está desativado neste servidor. | Ative-o ou faça login com uma identidade real. |
| `ANONYMOUS_NOT_ALLOWED` | 403 | Uma sessão de convidado tentou aprovar um login de dispositivo. Um convidado não tem conta para vincular a um dispositivo. | Faça login com uma conta e depois aprove-o. |
| `API_KEY_SELF_MANAGEMENT_FORBIDDEN` | 403 | Uma chave de API tentou listar, criar, alterar ou revogar chaves de API, sejam do seu próprio tipo ou pessoais. | Gerencie as chaves como uma pessoa que possui `keys:write` ou com a chave de serviço. |
| `AUTH_MIDDLEWARE_MISSING` | 500 | Uma rota protegida foi executada sem nenhum middleware de autenticação do Rebase antes dela, portanto, a credencial do chamador nunca foi verificada. | Monte a aplicação através do roteador de funções em vez de montá-la diretamente no seu próprio servidor. |
| `BOOTSTRAP_ANONYMOUS` | 403 | A inicialização do primeiro administrador foi tentada por um chamador anônimo. | Faça login primeiro. |
| `BOOTSTRAP_COMPLETED` | 403 | O primeiro administrador já existe. | Peça a um administrador existente para conceder a role. |
| `BOOTSTRAP_NOT_FIRST_USER` | 403 | A inicialização é apenas para o primeiríssimo usuário, e este não é ele. | Peça a um administrador existente para conceder a role. |
| `CAPTCHA_FAILED` | 400 | O provedor rejeitou o token de CAPTCHA. | Resolva um novo desafio. |
| `CAPTCHA_REQUIRED` | 400 | A rota requer um token de CAPTCHA e nenhum foi enviado. | Inclua o token. |
| `CHALLENGE_EXHAUSTED` | 401 | Tentativas incorretas em excesso para um mesmo desafio MFA. | Inicie um novo desafio. |
| `CONFIRMATION_REQUIRED` | 400 | Uma operação DDL destrutiva (`DELETE /api/admin/db/tables/:table` ou `DELETE …/columns/:column`) foi chamada sem `{ confirm: "<name>" }`. | Reenvie com o nome de destino exato em `confirm` ou passe `dryRun: true` para pré-visualizar o SQL. |
| `DDL_REJECTED` | 400 ou 409 quando o objeto já existe | O PostgreSQL recusou uma instrução executada por `/api/admin/db/*` — um tipo, um valor padrão, uma condição de política, um nome já em uso. A mensagem é do próprio Postgres, e `details.dbCode` é o seu SQLSTATE. | Altere o que a mensagem aponta e envie a requisição novamente; `dryRun: true` mostra o SQL primeiro. |
| `EXTENSION_NOT_FOUND` | 404 | Remoção de uma extensão que não está instalada (`DELETE /api/admin/db/catalog/extensions/:name`). | Liste as extensões instaladas com `GET /api/admin/db/catalog/extensions`. |
| `NOT_INSTALLED` | 400 | `POST /api/admin/db/insights/queries/reset` num banco de dados sem a extensão `pg_stat_statements`. | Instale-a em Extensões na view Banco de dados, ou com `CREATE EXTENSION pg_stat_statements`. |
| `NOT_PRELOADED` | 400 | `pg_stat_statements` está instalada, mas o servidor não a carregou, então suas estatísticas não podem ser reiniciadas. | Adicione-a a `shared_preload_libraries` e reinicie o Postgres. |
| `SESSION_NOT_FOUND` | 404 | Nenhuma sessão do banco de dados tem esse id de processo (`POST /api/admin/db/insights/activity/:pid/cancel` ou `/terminate`). Ela pode já ter terminado. | Leia `GET /api/admin/db/insights/activity` de novo. |
| `SOURCE_NOT_FOUND` | 404 | `?source=` numa rota de `/api/admin/db/insights` ou `/api/admin/db/catalog` não nomeia nenhum banco de dados SQL que este backend serve. | Escolha um de `GET /api/admin/db/insights/sources`. |
| `TYPE_NOT_FOUND` | 404 | Nenhum tipo enum tem esse esquema e nome (`POST /api/admin/db/catalog/types/:schema/:name/values`). | Liste os tipos com `GET /api/admin/db/catalog/types`. |
| `UNAVAILABLE` | 400 | Foram pedidas estatísticas de consultas ao banco de dados de desenvolvimento integrado, que não as coleta. | Execute contra um servidor Postgres próprio. |
| `DEVICE_LOGIN_DECIDED` | 409 | O login do dispositivo já foi aprovado ou negado. Um login é decidido apenas uma vez. | Inicie um novo no dispositivo. |
| `DEVICE_LOGIN_EXPIRED` | 410 | O login do dispositivo ultrapassou o limite de dez minutos antes de ser decidido. | Inicie um novo no dispositivo. |
| `DEVICE_LOGIN_NOT_FOUND` | 404 | Nenhum login de dispositivo possui esse código de usuário. A própria consulta (poll) do dispositivo responde aos códigos em minúsculas da RFC 8628: `authorization_pending`, `slow_down`, `access_denied`, `expired_token`, `invalid_grant`. | Verifique o código em relação ao que o dispositivo exibe. |
| `EMAIL_EXISTS` | 409 | Já existe uma conta com esse endereço — no cadastro, na alteração de endereço e ao acessar um link de alteração de endereço quando outra conta assumiu o endereço durante a espera. | Faça login ou inicie a redefinição de senha; para alteração de endereço, escolha outro endereço. |
| `EMAIL_NOT_CONFIGURED` | 503 | Magic links ou OTP foram solicitados e o servidor não possui transporte de e-mail configurado. | Configure o SMTP ou use outro método de login. |
| `EMAIL_NOT_VERIFIED` | 403 | Um login OAuth encontrou uma conta com o mesmo endereço, mas o provedor não verificou esse endereço, portanto ele não foi vinculado. | Faça login com o método existente e execute `POST /auth/link/<provider>`. |
| `CSRF_REFUSED` | 403 | A proteção contra CSRF está ativa (`csrf: { origin }`) e uma requisição sem cabeçalho `Authorization` veio de uma origem fora da lista permitida: um post de formulário autenticado por cookie de outro site ou uma requisição sem corpo e sem `Origin`. | Envie a partir de uma origem permitida, com um corpo JSON ou com um cabeçalho `Authorization`. |
| `FACTOR_NOT_VERIFIED` | 400 | O fator MFA foi cadastrado, mas nunca confirmado. | Confirme o fator. |
| `ID_EXISTS` | 409 | Uma conta já possui o id mantido por uma importação de contas (`POST /api/admin/users/import`). A importação a reporta como `skipped` e mantém a conta como está. | Nada, se a conta já foi importada antes. Caso contrário, omita o `id` ou escolha outro. |
| `IDENTITY_ALREADY_LINKED` | 409 | Essa identidade OAuth pertence a outra conta. | Faça login com ela ou desvincule-a de lá primeiro. |
| `IMPERSONATION_FORBIDDEN` | 403 | Uma requisição enviou `x-rebase-impersonate` e seu chamador não tem permissão para executar uma requisição como outro usuário. Apenas a sessão de um administrador autenticado pode fazer isso, nunca uma chave de API ou a chave de serviço. | Envie com a sessão de um administrador ou omita o cabeçalho. |
| `IMPERSONATION_INVALID` | 400 | `x-rebase-impersonate` foi enviado vazio. | Envie o uid do usuário a ser personificado ou omita o cabeçalho. |
| `IMPERSONATION_TARGET_NOT_FOUND` | 404 | `x-rebase-impersonate` não indica nenhum usuário ativo: nenhuma conta possui esse uid ou ela está desativada. | Verifique o uid. |
| `IMPERSONATION_UNAVAILABLE` | 501 | A autenticação deste backend não pode executar uma requisição como outro usuário porque seu `AuthAdapter` não possui `resolveUser`. | Implemente `resolveUser` no adapter ou omita o cabeçalho. |
| `IMPERSONATION_UNSUPPORTED` | 400 | `x-rebase-impersonate` foi enviado para uma rota que não suporta execução como outro usuário. Apenas a API de dados e funções customizadas aceitam isso, e o socket realtime aceita `impersonate` em `AUTHENTICATE`. | Envie a requisição sem o cabeçalho. |
| `SIMULATION_FORBIDDEN` | 403 | Uma requisição enviou um cabeçalho `x-rebase-simulate-*` (o simulador de RLS) ou chamou `/api/admin/rls-simulator`, e seu chamador não tem permissão para simular acesso. Apenas a sessão de um administrador autenticado pode fazer isso, nunca uma chave de API ou a chave de serviço. | Envie com a sessão de um administrador ou omita os cabeçalhos. |
| `SIMULATION_INVALID` | 400 | A simulação estava malformada: um cabeçalho enviado vazio, `x-rebase-simulate-api-key-id` combinado com uma role ou id de usuário, ou simulação combinada com `x-rebase-impersonate`. | Especifique uma role (opcionalmente com um uid), um id de usuário ou um id de chave de API. |
| `SIMULATION_READ_ONLY` | 403 | Uma gravação, exclusão, `_batch`, reversão de histórico ou uma função customizada chamada por qualquer verbo diferente de `GET`/`HEAD`/`OPTIONS` continha um cabeçalho `x-rebase-simulate-*`. O acesso simulado é somente leitura: a gravação seria executada como a identidade simulada, não como o administrador. Leituras, incluindo `POST …/query` e `…/count`, continuam sendo executadas. | Pare a simulação para fazer alterações. |
| `SIMULATION_TARGET_NOT_FOUND` | 404 | A simulação não indica nenhum usuário ativo (um id de usuário enviado sem role) ou nenhuma chave de API válida. | Verifique o id ou envie uma role com o uid para simular um uid que não possui conta. |
| `SIMULATION_UNAVAILABLE` | 501 | Este backend não pode simular acesso: seu `AuthAdapter` não possui `resolveUser` para confirmar um administrador, ou uma chave foi especificada em um backend sem chaves de API. | Implemente `resolveUser` ou omita os cabeçalhos. |
| `SIMULATION_UNSUPPORTED` | 400 | Um cabeçalho `x-rebase-simulate-*` foi enviado para uma rota que não oferece suporte a acesso simulado. Apenas a API de dados e funções customizadas os aceitam. | Envie a requisição sem os cabeçalhos. |
| `GUEST_REFERENCED` | 409 | Um convidado não pôde ser excluído porque uma linha do próprio projeto depende dele por meio de uma chave estrangeira com `ON DELETE RESTRICT` ou `NO ACTION`. `DELETE /api/admin/guests` reporta isso por convidado em `skipped` e continua. | Exclua a linha ou mantenha o convidado. |
| `INVALID_ACCOUNT` | 400 | A conta está em um estado no qual esta operação não pode atuar. | Veja a mensagem. |
| `INVALID_CHALLENGE` | 400 | O desafio MFA é desconhecido ou expirou. | Inicie um novo. |
| `INVALID_CODE` | 400 / 401 | O código OTP ou MFA está incorreto: 400 para login por código de e-mail (`/auth/otp/verify`), 401 para cadastro ou desafio MFA. | Tente novamente com o código atual. |
| `INVALID_CREDENTIALS` | 401 | E-mail ou senha incorretos — deliberadamente sem especificar qual. | Tente novamente ou redefina a senha. |
| `INVALID_PLATFORM_TOKEN` | 401 | Um token de plataforma `rpt_` foi recusado: assinatura inválida, audience incorreta, expirado ou com tempo de vida acima do limite máximo. A mensagem informa qual o motivo. | Solicite à plataforma a geração de um novo — no Rebase Cloud, execute o comando novamente. |
| `INVALID_SCOPES` | 400 | Uma chave solicitou algo que não é um escopo: malformado, desconhecido ou com um destino que o escopo não aceita. `details.problems` informa qual e o motivo; `details.validScopes` lista os escopos que uma chave pode possuir. Não inclui `keys:read` e `keys:write`, que nenhuma chave pode possuir. | Use um nome da lista. Veja [Roles and scopes](/docs/backend/roles-and-scopes/). |
| `INVALID_TOKEN` | 400 / 401 | Um token de verificação, redefinição, magic link ou alteração de endereço está malformado, é desconhecido, já foi utilizado ou expirou (400). Uma credencial de provedor OAuth ou um refresh token que falha na validação retorna 401. | Solicite um novo link ou faça login novamente. |
| `INVALID_USER_CODE` | 400 | O que foi enviado como código de login de dispositivo não é um código válido: oito letras, como `BCDF-GHJK`. | Copie o código exibido no dispositivo. |
| `INVALID_PASSWORD_HASH` | 400 | O `passwordHash` de uma conta importada não é um hash no formato nomeado por `passwordHashAlgorithm` da requisição: para `bcrypt`, `$2a$`, `$2b$` ou `$2y$`, um custo de 04 a 31 e depois 53 caracteres. Uma senha em texto simples nessa coluna costuma ser a causa comum. | Exporte a coluna na qual o outro sistema armazena o hash (Supabase: `auth.users.encrypted_password`) ou omita-a para que a conta faça login via magic link ou redefinição. |
| `INVALID_ID` | 400 | O `id` de uma conta importada não é permitido para uma conta: vazio, mais de 128 caracteres, caractere fora de letras, dígitos e `_ - . : \|`, um id reservado (`service`, `anonymous`), ou um valor que a coluna de id da tabela de usuários não suporta (não é um uuid em uma coluna `uuid`). | Corrija o id ou omita-o para deixar a tabela gerá-lo. |
| `INVALID_ROLE` | 400 | O nome da role a ser gravada não é uma string, está vazio ou contém `,` `{` `}` `"` `\` ou um caractere de controle. Esses caracteres seriam lidos de volta como outras roles: uma role trafega em um `text[]` do Postgres e na lista separada por vírgulas que as políticas RLS dividem, logo `"support,admin"` retornaria como `admin`. `details.problems` lista cada ocorrência. | Renomeie a role. Qualquer outro nome é aceito. |
| `KEY_MANAGEMENT_SCOPE` | 400 | Uma chave solicitou `keys:read` ou `keys:write`. Nenhuma chave pode gerenciar chaves. `details.scopes` lista quais são. | Omita-os. |
| `KEY_OUTRANKS_CALLER` | 403 | Um detentor de `keys:write` tentou alterar ou revogar uma chave de serviço que possui uma role ou escopo que ele não possui. Apenas um admin gerencia qualquer chave. `details.roles` e `details.scopes` listam o que a chave possui além do chamador. | Peça a um admin ou a alguém que os possua para alterar a chave. |
| `LAST_ADMIN` | 403 | A alteração deixaria o projeto sem nenhum administrador. | Promova outra pessoa primeiro. |
| `MFA_REQUIRED` | 401 | A senha estava correta e a conta possui um segundo fator verificado, portanto o login está apenas pela metade. `details` traz um token de curta duração com escopo para o desafio MFA — ele não é uma sessão. | Abra um desafio e responda a ele; a resposta do desafio emitirá a sessão. |
| `NO_SESSION` | 401 | Nenhum cookie de sessão ou refresh token foi apresentado. Normal no primeiro carregamento de página. | Faça login. |
| `NOT_ANONYMOUS` | 400 | Uma rota de upgrade a partir de anônimo foi chamada por uma conta real, ou `DELETE /api/admin/guests/:uid` informou uma conta real. | Nada para atualizar. Para excluir uma conta, use `DELETE /api/admin/users/:uid`. |
| `OAUTH_ERROR` | 401 | O provedor OAuth recusou ou retornou um erro. | Tente o fluxo novamente; a mensagem contém o motivo do provedor. |
| `PERSONAL_KEYS_DISABLED` | 403 | As chaves de API pessoais estão desativadas neste backend. | Defina `personalKeys: true` nas opções de `auth` da tabela de autenticação (`defineAuthTable`). |
| `PERSONAL_KEY_NEEDS_ACCOUNT` | 403 | A chave de serviço ou uma sessão de convidado tentou usar as rotas de chave pessoal. Nenhuma das duas possui uma conta para a chave representar. | Faça login em uma conta ou crie uma chave de serviço em `/api/admin/api-keys`. |
| `PLATFORM_TOKENS_OFF` | 401 | Um token de plataforma `rpt_` chegou a um servidor que não os aceita: `REBASE_PLATFORM_TOKEN_KEY` e `REBASE_PLATFORM_TOKEN_AUDIENCE` não estão definidos. | A plataforma que hospeda o aplicativo define ambos no deploy; faça um novo deploy ou faça login no app por outro meio. |
| `RATE_LIMITED` | 429 | Tentativas em excesso a partir deste chamador. | Aguarde; a mensagem informa por quanto tempo. |
| `REDIRECT_URI_NOT_ALLOWED` | 400 | O destino do redirecionamento não está na lista de permissões. | Adicione-o à configuração do provedor. |
| `REGISTRATION_DISABLED` | 403 | O autocadastro está desativado. | Peça a um admin para criar a conta. |
| `ROLE_EXCEEDS_CALLER` | 403 | As roles que estão sendo concedidas possuem um escopo, ou `admin`, que o chamador não possui. `details.beyond` lista quais são. | Peça a alguém que os possua para conceder a role. |
| `ROLE_EXCEEDS_CREATOR` | 403 | Uma chave de serviço recebeu uma role RLS que seu criador não possui. Apenas um admin pode conceder qualquer role. `details.roles` lista quais são. | Remova a role ou peça a um admin para criar a chave. |
| `ROLE_EXISTS` | 409 | Esse nome de role já está em uso. | Escolha outro nome. |
| `ROLE_LOOKUP_FAILED` | 503 | Não foi possível ler as roles do chamador — em uma rota de admin ou em uma requisição de dados em um backend com `config.auth`. Falha de forma segura (fail closed) em vez de confiar nas roles contidas no token. Um token cujo uid não corresponda a nenhuma conta, incluindo um uid incompatível com a tabela de usuários, retorna 401, não este erro. Um banco de dados inacessível retorna `DATABASE_UNAVAILABLE`, não este erro. | Tente novamente; verifique o banco de dados. |
| `SCOPE_EXCEEDS_CREATOR` | 403 | Uma chave solicitou um escopo que seu criador não possui. Uma chave nunca possui mais do que a conta que a cria. `details.scopes` lista quais são. | Remova-os ou peça a alguém que os possua para criar a chave. |
| `SCOPE_MISSING` | 403 | A credencial não possui o escopo necessário para esta rota, tabela, origem de storage ou função. `details.requiredScope` informa qual é, incluindo o destino. | Para uma pessoa, uma role que declare o escopo. Para uma chave, uma chave que o possua. Veja [Roles and scopes](/docs/backend/roles-and-scopes/). |
| `SCOPE_NOT_DECLARED` | 500 | Uma rota protegida com `requireScope` especifica um escopo de aplicação que este backend não declara, portanto ninguém o possui, nem mesmo um administrador. Um nome que não seja um escopo de forma alguma, ou um erro de digitação em um embutido como `data:raed`, nunca chega a este ponto: `requireScope` lança um erro onde a rota é registrada. | Declare o escopo sob `auth.scopes` na tabela de autenticação ou corrija o nome. Veja [Roles and scopes](/docs/backend/roles-and-scopes/). |
| `SELF_DELETE` | 400 | Um administrador tentou excluir sua própria conta. | Peça a outro administrador para fazê-lo. |
| `SESSION_REVOKED` | 401 | A sessão foi encerrada em outro lugar, todas as sessões foram revogadas ou a conta foi excluída. Todas as portas de entrada que aceitam uma sessão respondem a esse token de acesso desta forma: a API de dados, o storage, funções customizadas e as rotas de admin. O socket realtime recusa seu comando `AUTHENTICATE` com um frame `AUTH_ERROR` contendo o mesmo código. O SDK faz o refresh, o refresh é recusado e a sessão é deslogada. | Faça login novamente. |
| `ACCOUNT_DISABLED` | 401/403 | Um administrador desativou a conta: login (403), refresh e todos os tokens que ela possui (401) são recusados em todas as portas de entrada que aceitam uma sessão. O socket realtime recusa seu comando `AUTHENTICATE` com um frame `AUTH_ERROR` contendo o mesmo código. | Contate um administrador. |
| `EMAIL_NOT_CONFIRMED` | 403 | `requireEmailVerification` está ativo e o endereço ainda não foi verificado. Retornado apenas para senhas corretas; um novo link é enviado por e-mail. | Siga o link no e-mail. |
| `PROOF_REQUIRED` | 409 | `POST /auth/verify-email`: a conta possui uma senha ou identidade que ninguém comprovou, e a requisição não comprova nenhuma das duas. O token não é consumido. | Envie `password` para mantê-la ou `removeUnproven: true` para verificar sem ela. |
| `UNDELIVERABLE_ADDRESS` | 400 / 409 | Foi solicitado um e-mail de verificação para um endereço inacessível — de um convidado ou o marcador de posição do X (400) — ou uma conta tentou mudar para esse tipo de endereço (409, `POST /auth/change-email`). | Defina um endereço real primeiro. |
| `EMAIL_UNCHANGED` | 400 | `POST /auth/change-email` informou o endereço atual da conta. | Nada para alterar. |
| `ANONYMOUS_USER` | 403 | Um convidado solicitou alteração do seu endereço de e-mail; um convidado não possui nenhum e-mail próprio. | Converta-o em uma conta primeiro (`POST /auth/anonymous/link`). |
| `MFA_NOT_ENROLLED` | 400 | Códigos de recuperação foram solicitados para uma conta sem nenhum segundo fator verificado. | Cadastre um fator primeiro. |
| `HOOK_REJECTED` | 400 | Um hook `beforeUserCreate`, `beforeLogin`, `beforeUserDelete` ou `beforeEmailChange` lançou um erro. A mensagem é a do hook; um hook que escolheu um status 4xx responde com ele. | Veja a mensagem. |
| `INVALID_JSON` | 400 | O corpo da requisição não é um JSON válido. | Envie um corpo em formato JSON. |
| `SELF_DISABLE` | 400 | Um administrador tentou desativar a própria conta. | Peça a outro administrador. |
| `NOT_SUPPORTED` | 501 | O repositório de autenticação deste backend não suporta o que foi solicitado (desativar contas, alterar um endereço). | Reinicie o servidor para que a coluna seja adicionada ou use um repositório compatível. |
| `UNKNOWN_SCOPE_TARGET` | 400 | O destino de um escopo faz referência a uma tabela, origem de storage ou função que este backend não disponibiliza. `details` lista os destinos disponíveis. | Corrija o destino. |
| `UNVERIFIED_IDENTITIES` | 409 | Um magic link, código por e-mail ou redefinição de senha comprovou o endereço de uma conta não verificada, e a conta carrega uma identidade de login cujo provedor nunca verificou esse endereço. O repositório de autenticação não pode removê-la (ele não tem `unlinkUserIdentity`), portanto a comprovação é recusada em vez de deixar essa porta de entrada aberta em uma conta verificada. | Implemente `unlinkUserIdentity` no repositório de autenticação customizado ou peça a um admin para revisar a conta. |
| `SETUP_REQUIRED` | 403 | O projeto ainda não possui nenhum administrador, portanto esta rota não está disponível. | Conclua a configuração inicial do primeiro administrador. |
| `TOKEN_ALREADY_USED` | 401 | Um token de uso único foi reutilizado, ou um refresh token que foi rotacionado há mais tempo do que `refreshTokenReuseIntervalSeconds`. | Solicite um novo ou faça login novamente. |
| `TOKEN_EXPIRED` | 401 | O token ultrapassou seu tempo de vida útil. | Solicite um novo. |
| `TOO_MANY_USERS` | 400 | Uma requisição `POST /api/admin/users/import` continha mais de 100 contas. `details.max` indica o limite. | Envie em requisições de 100; o comando `rebase users import` já faz isso. |
| `USER_NOT_FOUND` | 404 | Nenhuma conta encontrada com esse id. | Verifique o id. |
| `WEAK_PASSWORD` | 400 | A senha não atende à [política de senhas](/docs/backend/auth-endpoints/#password-policy) (por padrão, mais de 8 caracteres contendo letra maiúscula, letra minúscula e dígito) — no cadastro, em uma redefinição ou alteração, ou na senha escolhida por um administrador: `POST /api/admin/users`, uma criação na tabela de autenticação pela API de dados, `PUT /api/admin/users/:id` ou `POST /api/admin/users/:id/reset-password`. | Escolha uma senha mais forte. Um administrador importando contas pode enviar `skipPasswordPolicy: true` na criação. |

## Dados, consultas e gravações

| Código | Status | Significado | O que fazer |
| --- | --- | --- | --- |
| `AGGREGATE_MASKED_BY_AFTER_READ` | 400 | Um agregador diferente de `count()` sem `groupBy` em uma tabela que um hook `afterRead` reescreve (global, da tabela ou pelo `.transform()` de uma coluna). Uma agregação lê os valores armazenados e nunca executa o hook; portanto, uma soma, mínimo, máximo, contagem de campo ou agrupamento leria o que o hook oculta. | Use `count()` sem `groupBy` ou leia as linhas, que passam pelo hook. |
| `AGGREGATE_NOT_SUPPORTED` | 501 | Este driver não consegue calcular a agregação solicitada. | Use um driver compatível ou calcule no cliente. |
| `BRANCHING_UNSUPPORTED` | — | Foi solicitado um branch do banco de dados pelo websocket do Studio no banco de dados gerenciado de desenvolvimento (PGlite), onde um branch *é* o próprio pai e nada ficaria isolado. A recusa é a mesma exibida por `rebase db branch`. | Aponte `DATABASE_URL` para uma instância própria do Postgres (`rebase dev --docker` inicia uma) e crie branches lá. |
| `BATCH_TOO_LARGE` | 400 | `POST /api/data/_batch` contém mais operações do que o limite por lote (1000 por padrão). Um lote equivale a uma transação e retém seus bloqueios (locks) durante toda a execução. | Envie em partes menores; a mensagem informa o limite e a sua contagem. |
| `BATCH_UNSUPPORTED` | 400 | O driver deste backend não suporta gravação atômica entre múltiplas tabelas, e um loop de gravações individuais não seria nem atômico nem uma única viagem de ida e volta (round trip). | Envie as gravações como requisições separadas ou como chamadas `/bulk` por tabela. |
| `BULK_TOO_LARGE` | 400 | O corpo da requisição em lote (bulk) excede o limite configurado de itens. | Divida a requisição. |
| `BULK_UNSUPPORTED` | 400 | Esta tabela ou driver não oferece suporte a gravações em lote. | Grave as linhas uma a uma. |
| `CALLBACK_REJECTED` | 400 / 403 | Um hook de tabela recusou a gravação. Um `throw` de `beforeSave`/`beforeDelete`/`after*` é um 400 trazendo a mensagem definida pelo autor; um `beforeDelete` que retorna `false` é um 403. `details.stage` informa qual hook, e `details.path` informa a tabela. | Leia a mensagem — ela foi escrita por este projeto, não pelo Rebase. |
| `CALLBACK_RECURSION` | 500 | Gravações iniciadas por hooks aninhados ultrapassaram a profundidade de 16 níveis: uma gravação `context.data` de um hook executa os hooks daquela tabela novamente, e nada na cadeia interrompe o ciclo — geralmente um `afterSave` que atualiza a própria linha incondicionalmente. Toda a gravação foi revertida (rollback). A mensagem informa o hook e a tabela; `details.chain` lista cada etapa hook → gravação. | Torne a gravação do hook condicional: atue apenas em `status === "new"`, ou ignore quando `values` já contiverem o que seria gravado. |
| `COMPOSITE_KEY_ADDRESS` | 400 | A tabela possui uma chave primária composta e o endereço na URL contém uma quantidade diferente de partes. | Especifique a linha como `<part1>:::<part2>`, com cada parte codificada na URL (URL-encoded), na ordem da chave; `details.primaryKey` lista as colunas. |
| `TABLE_READ_ONLY` | 405 | Uma gravação atingiu uma view (`defineView`). Uma view é somente leitura. Anteriormente `COLLECTION_READ_ONLY`. | Escreva nas tabelas que a view lê. Veja [Views](/docs/collections/views/). |
| `TABLE_WITHHELD` | 503 | A tabela está declarada, mas o banco de dados não a protege: a segurança em nível de linha (RLS) está desativada, nenhuma das políticas declaradas está presente ou uma política restritiva declarada está ausente. (Uma política permissiva ausente é atendida, com um aviso no boot informando o nome). Isso ocorre quando o servidor não provisiona suas tabelas (`REBASE_PROVISION=false`, `provisionSchema: false`, `provision.tables: false`, `REBASE_MIGRATE_ON_BOOT=none`), e o servidor retém a tabela em vez de expor todas as linhas a todos os chamadores. Uma junção many-to-many está sujeita à mesma regra: quando ela falha, as tabelas cujas relações a utilizam são retidas e a mensagem informa a tabela de junção; o mesmo ocorre com uma tabela cujo `via` passa por uma tabela retida, informando o `via`. Uma leitura de relação ou filtro que passe por uma tabela retida também responde com este código. As outras tabelas continuam sendo servidas normalmente. O log de inicialização informa os comandos que a protegem. | Aplique os comandos informados no log de inicialização (`rebase db push` faz isso) e reinicie. Ou, se a própria aplicação gerenciar o controle de acesso à tabela, declare `rlsRequired: false` nela (ou `database({ rls: { required: false } })`) e reinicie. |
| `SQL_NOT_ALLOWED` | 400 | O SQL executado como o chamador (`getSql(c)`, `withAuth(user).sql`) não era uma instrução simples `SELECT`, `WITH`, `VALUES`, `TABLE`, `INSERT`, `UPDATE`, `DELETE` ou `MERGE`, ou chamou `set_config` ou nomeou `pg_settings`. A identidade do chamador fica armazenada nas configurações de sessão; portanto, qualquer instrução que pudesse alterá-las é recusada. | Mantenha o texto da consulta próprio, em uma única instrução, com todos os valores em `params`. Veja [Custom functions](/docs/backend/custom-functions/#3-getsqlc--sql-as-the-caller). |
| `CURSOR_WITH_OFFSET` | 400 | `?after=` foi combinado com `?offset=` ou `?page=`. Um cursor já especifica onde a página começa; logo, um deslocamento aplicado sobre ele pula silenciosamente essa quantidade de linhas além do cursor — uma lacuna invisível na resposta para o chamador. | Use um ou outro. |
| `DISTINCT_NOT_APPLICABLE` | 400 | `?distinct=true` foi combinado com busca textual ou consulta vetorial. Ambas atribuem uma pontuação (score) por linha, de modo que duas linhas nunca são iguais e o `DISTINCT` não agruparia nada — pareceria ter funcionado sem mudar nada. | Remova um dos dois. |
| `DISTINCT_ORDER_BY_NOT_SELECTED` | 400 | Uma leitura com `distinct` é ordenada por uma coluna que ela não retorna. Um `SELECT DISTINCT` só pode ser ordenado por colunas presentes na sua lista de seleção, senão as linhas colapsadas não possuem uma ordem definida. `details.fields` lista quais são. | Adicione esses campos a `?fields=` ou remova-os de `?orderBy=`. |
| `DATABASE_UNAVAILABLE` | 503 | O banco de dados não pôde ser alcançado: a conexão foi recusada ou perdida, o host não resolveu, o servidor está iniciando ou desligando, ou o banco de dados está fechado para novas conexões (`ALLOW_CONNECTIONS false`, que um `rebase db branch create --force` interrompido no meio deixa na sua origem; o log do servidor indica o banco de dados, e `rebase db branch list` o reabre). Todas as portas de entrada retornam este erro, incluindo login, rotas de admin e o socket realtime (um frame `ERROR`). Enviado com `Retry-After: 5`. | Tente novamente; o SDK já faz isso. Verifique se o banco de dados está rodando e acessível pelo servidor. |
| `DB_CONNECTIONS_EXHAUSTED` | 503 | O servidor de banco de dados recusou uma nova conexão por ter esgotado o limite (`53300` clientes em excesso, `53400` limite de conexões de uma role ou do banco). Cada instância de servidor compartilha o `max_connections` do servidor; portanto, é com isso que várias instâncias com pools grandes e sem pooler se deparam. Trata-se de sobrecarga, não de falha interna; enviado com `Retry-After: 2`. O servidor registra a solução no log uma vez por minuto. | Tente novamente; o SDK já faz isso. Reduza `DB_POOL_MAX` (ou limite com `REBASE_DB_POOL_MAX`) entre as instâncias, coloque um pooler na frente do banco (`DATABASE_POOLED`) ou aumente o `max_connections`. |
| `DB_CONNECT_TIMEOUT` | 503 | Abrir uma nova conexão com o banco demorou mais que `DB_POOL_CONNECT_TIMEOUT`: o banco de dados está lento para aceitar conexões ou fisicamente distante. Enviado com `Retry-After`. | Tente novamente; o SDK já faz isso. Verifique a carga do banco de dados e a rede até ele. |
| `DB_PERMISSION_DENIED` | 500 | O Postgres recusou a instrução (`42501`): uma política de segurança em nível de linha negando acesso a esta role ou a ausência de um `GRANT`. | Veja [Troubleshooting](/docs/troubleshooting/). |
| `DB_POOL_EXHAUSTED` | 503 | Todas as conexões do pool permaneceram ocupadas por `DB_POOL_CONNECT_TIMEOUT`, logo esta requisição nunca alcançou o banco de dados. Trata-se de sobrecarga, não de falha interna; enviado com `Retry-After`. O servidor registra a solução no log uma vez por minuto. | Tente novamente; o SDK já faz isso. Aumente `DB_POOL_MAX` ou identifique as consultas lentas ou transações longas que estão retendo conexões. |
| `FIELD_NOT_READABLE` | 400 | Um filtro, `orderBy`, `fields`, agregação `select` ou `groupBy` referencia um campo que as roles deste chamador não podem ler (`access.read`), um caminho aninhado ou ordenação agregada referencia uma relação ilegível — ou uma operação de campo (`$inc`, `$push`, …) tem como alvo um campo restrito, onde um limite recusado revelaria o valor armazenado. Um campo que nenhuma resposta pode conter deve ser um campo que nenhuma consulta pode interrogar, senão o valor seria revelado predicado por predicado. Um filtro por meio de uma relação (`author.salary`) e uma ordenação agregada sobre o campo de uma relação (`max(staff.salary)`) são avaliados pela regra de destino. `details.violations` informa cada campo. O driver aplica a mesma regra a leituras feitas em processo em nome de um chamador (`context.data` sob o escopo do chamador) e a buscas vetoriais, includes ou verificações de unicidade. Uma coluna `.private()` responde como se não existisse: qualquer filtro, `orderBy`, `fields`, `include`, agregação `select`, `groupBy` ou `vector_search` que a mencione recebe a mesma resposta dada a um campo inexistente (`UNKNOWN_FILTER_FIELD`, `UNKNOWN_ORDER_BY_FIELD`, `UNKNOWN_FIELD`, `UNKNOWN_RELATION`, `UNKNOWN_AGGREGATE_FIELD` ou `UNKNOWN_VECTOR_PROPERTY`), e nenhuma resposta de campo desconhecido a lista. | Remova o campo da consulta ou obtenha a role necessária. Veja [Field access](/docs/collections/field-access/). |
| `FIELD_NOT_WRITABLE` | 400 / 403 | O corpo define um campo que as roles do chamador não podem escrever (`access.write`). A operação é recusada em vez de descartada: descartar o campo retornaria sucesso para uma edição que na realidade não ocorreu. O mesmo código recusa uma gravação feita através de um pai que define uma relação que o chamador não pode gravar, e uma atualização que define um valor em um campo `softDelete` — somente uma exclusão o atualiza. O socket realtime responde 403 com este código para uma gravação em um caminho aninhado cuja tabela-pai, relação ou tabela de destino não esteja disponível ali, em vez de repassá-la ao driver sem julgamento. `details.violations` informa cada campo. | Remova o campo ou obtenha a role necessária. Um campo que ninguém pode gravar retorna `VALIDATION_EXCLUDED_FIELDS`. |
| `FILTERED_USER_WRITE` | 400 | Uma atualização ou exclusão filtrada foi enviada para a tabela de autenticação via HTTP, cujas alterações são verificadas usuário por usuário antes de serem executadas. | Leia os usuários e, em seguida, faça `updateMany`/`deleteMany` por id. |
| `FILTER_REQUIRED` | 400 | Uma gravação filtrada (um update ou delete por `where`/`logical`, vindo do SDK ou de rotas bulk) não possui nenhuma condição, o que afetaria todas as linhas. A requisição é recusada antes de qualquer execução. | Adicione uma condição. Para alterar intencionalmente todas as linhas, passe uma condição que todas atendam. |
| `HISTORY_UNAVAILABLE` | 503 | Uma gravação em uma tabela com `history: true` foi recusada porque o registro de histórico não pôde ser gravado: o banco não possui a tabela `rebase.entity_history` ou, no caso de `openRebase` e `rebase console`, a função `rebase.record_history`. Nenhum backend com histórico ativado foi inicializado neste banco de dados. Nada foi executado, incluindo hooks, e as leituras continuam funcionando. Lançado por `openRebase` e retornado por backends criados com `provision: false`. | Inicialize o backend uma vez com o histórico ativado e `provision: true` (`rebase dev` faz isso) e tente novamente. |
| `HISTORY_UNSERVABLE` | 501 | O driver de dados da tabela não suporta executar as regras de leitura e hooks `afterRead` sobre as linhas armazenadas (`DataDriver.serveStoredRows`), e o histórico nunca é exposto sem máscara. O driver Postgres integrado oferece esse suporte. | Implemente `serveStoredRows` no driver customizado. Veja [History](/docs/backend/history/). |
| `IDEMPOTENCY_KEY_IN_PROGRESS` | 409 | Uma requisição anterior com a mesma `Idempotency-Key` ainda está em execução. | Tente novamente assim que ela terminar. |
| `IDEMPOTENCY_KEY_REUSED` | 422 | A mesma `Idempotency-Key` foi enviada em uma requisição diferente: outro método, caminho, query string ou corpo. | Use uma nova chave ou envie a requisição original. |
| `INVALID_AGGREGATE_FUNCTION` | 400 | `?select=` indicou uma função que não é de agregação (`count`, `sum`, `avg`, `min`, `max`, `countDistinct`, `mode`, `percentile`, `distinct`, `fingerprint`). | Use uma dessas funções; a mensagem traz a lista delas. |
| `INVALID_AGGREGATE_GROUP` | 400 | Uma transformação em `groupBy` é desconhecida ou incompatível com a coluna: `year`/`month`/`day` em coluna que não é data, `unnest` em coluna que não é array. | Use `lower`, `upper`, `year`, `month`, `day` ou `unnest` em uma coluna do tipo apropriado. |
| `INVALID_AGGREGATE_SELECT` | 400 | Uma entrada em `?select=` não segue o formato `fn(field)`; uma função diferente de `count()` ou `fingerprint()` não recebeu um campo; `percentile` não tem uma fração entre 0 e 1; ou `fingerprint()` foi chamada em uma view simples, que não armazena linhas. | Escreva `sum(total)`, `count()`, `percentile(price,0.95)`. |
| `INVALID_AGGREGATE_WINDOW` | 400 | Uso de `offset`, `page` ou `orderBy` em uma agregação sem `groupBy`, ou um cursor em qualquer agregação. Uma agregação não agrupada retorna uma única linha, e um grupo não é uma linha sobre a qual um cursor possa continuar. | Adicione `groupBy` ou remova esses parâmetros; pagine grupos usando `offset` ou `page`. Veja [Aggregates](/docs/sdk/aggregates-and-search/#aggregates). |
| `INVALID_BATCH_BODY` | 400 | Uma operação em `/_batch` não contém `op`, `table`, `values` ou `id`, referencia uma tabela não servida por este backend ou reutiliza um nome de `ref`. | Veja a mensagem; ela indica o índice da operação com problema. |
| `INVALID_BATCH_REF` | 400 | Um `{ "$ref": "<name>.<field>" }` referencia uma operação inexistente, aponta para a frente ou solicita um campo ausente na linha referenciada. Apenas referências para trás são resolvidas. | Defina a operação com `ref` *antes* de referenciá-la. |
| `INVALID_BULK_BODY` | 400 | O corpo da requisição bulk não segue o formato esperado. | Envie o array esperado pela rota: `{ "rows": [...] }` para `POST /bulk`, `{ "updates": [{ "id", "data" }] }` para `PATCH /bulk`, `{ "ids": [...] }` para `POST /bulk/delete`. |
| `INVALID_CONFLICT_RULE` | 400 | Uma regra de conflito de upsert (manter duplicatas ou substituir apenas em um `where`) foi enviada sem `upsert: true`, ou ambas as regras foram enviadas juntas. | Envie `upsert: true` e apenas uma das duas regras. |
| `INVALID_CONFLICT_TARGET` | 400 | O `on_conflict` / `onConflict` de um upsert aponta para colunas sem garantia de unicidade, é enviado sem `upsert: true` ou é enviado em uma criação aninhada, onde uma linha correspondente seria transferida para um novo pai. O Postgres responderia 42P10 dentro de uma transação que já realizou trabalho. Ocorre também em qualquer upsert na tabela de autenticação, onde criação e atualização seguem regras distintas. | Declare `.unique()` na coluna ou um índice `unique`; a mensagem lista os destinos válidos existentes. Na tabela de usuários, envie `POST` para criar e `PATCH` para atualizar. |
| `INVALID_COUNT` | 400 | `?count=` não é `exact` nem `none`. Rejeitado em vez de assumir o padrão: um erro de digitação `?count=nnone` pagaria pelo processamento da contagem que pretendia ignorar. | Envie `exact` (o padrão) ou `none`. Veja [Skipping the count](/docs/backend/api/#skipping-the-count). |
| `INVALID_CURSOR` | 400 | O cursor `after` não pôde ser lido ou contém um id de linha que não é compatível com as colunas de chave da tabela: foi truncado, recodificado ou montado manualmente. Um cursor válido enviado com um `orderBy` diferente daquele sob o qual foi emitido resulta em `CURSOR_ORDER_MISMATCH`, também um 400. | Repasse `meta.nextCursor` da página anterior sem alterações, com o mesmo `orderBy` ou nenhum. Veja [Pagination](/docs/sdk/pagination/). |
| `INVALID_DELETED_PARAM` | 400 | `?deleted=` não é `include` nem `only`. Rejeitado em vez de ignorado: um erro de digitação `?deleted=true` que ocultasse silenciosamente todas as linhas excluídas pareceria ter funcionado, mas responderia o oposto do pretendido. | Envie `include` (ativas e excluídas) ou `only` (apenas excluídas). Omita para obter apenas as linhas ativas. |
| `INVALID_DISTINCT` | 400 | `?distinct=` não é `true` nem `false`. | Envie um desses valores; `1` e `0` também são aceitos. |
| `INVALID_FIELD_OPERATION` | 400 | Um `$inc` / `$push` / `$pull` / `$merge` foi aplicado a um tipo de coluna incompatível, com operando no formato errado, com dois operadores no mesmo campo, com erro de digitação ou em uma operação de criação — onde não há valor armazenado anterior para operar. | Veja [Writing over REST](/docs/backend/writes/#field-operations); a mensagem indica o campo com problema. |
| `INVALID_FILTERED_WRITE` | 400 | Uma gravação filtrada indicou um caminho por relação (`posts/1/comments`) ou não indicou tabela alguma. | Escreva na tabela relacionada passando um filtro no seu vínculo. |
| `INVALID_FILTER_FIELD` | 400 | O filtro especifica uma coluna que esta tabela não possui. | Verifique a grafia em relação à tabela. |
| `INVALID_FILTER_OPERATOR` | 400 | O operador não é suportado por este tipo de coluna — por exemplo, `like` em números ou datas. | Veja [Querying data](/docs/sdk/querying/). |
| `INVALID_FILTER_VALUE` | 400 | O valor do filtro não pode ser convertido para o tipo da coluna comparada: `?id=eq.abc` em uma chave inteira, um rótulo fora do enum, timestamp malformado, número fora do intervalo suportado. `details.dbCode` traz o SQLSTATE correspondente. | Envie um valor compatível com o tipo da coluna. |
| `INVALID_HARD_PARAM` | 400 | `?hard=` não é `true` nem `false`. Qualquer outro valor é recusado em vez de interpretado como "não" — um erro que causasse soft-delete quando o chamador pretendia expurgar os dados o levaria a acreditar falsamente que os dados foram excluídos. | Envie `true` ou `false`. |
| `INVALID_INCLUDE` | 400 | `?include=` está malformado: não é uma lista de caminhos válida ou o objeto de opções da relação possui formato incorreto. Um caminho com mais de três saltos de profundidade retorna `INCLUDE_TOO_DEEP`, também um 400. Retornado na borda da requisição para evitar que escape do driver como 500. | Veja a mensagem; ela indica o caminho incorreto. |
| `INVALID_INPUT` | 400 | O corpo da requisição falhou na validação. | Veja a mensagem. |
| `INVALID_LIMIT` | 400 | `?limit=` não é um número inteiro de 1 até o máximo permitido (1000 por padrão); limites maiores são recusados, não limitados/ajustados. Uma assinatura realtime solicitando um limite fora desse intervalo recebe o mesmo código como um frame `ERROR` de WebSocket. | Reduza o limite e pagine o restante dos dados. |
| `INVALID_LOGICAL_GROUP` | 400 | Um agrupamento `?or=` / `?and=` / `?not=` está malformado ou excede a profundidade máxima permitida. | Veja a mensagem; ela mostra a regra de nivelamento (flattening). |
| `INVALID_OFFSET` | 400 | `?offset=` não é um número inteiro maior ou igual a 0. | Envie um número inteiro não negativo. |
| `INVALID_ORDER_BY` | 400 | `?orderBy=` não é `field`, `field:desc`, `field:desc:last` nem um array JSON de `{ field, direction, nulls }` — ou especifica uma direção diferente de `asc`/`desc` ou posicionamento de NULL diferente de `first`/`last`. | Veja a mensagem; ela detalha as formas aceitas. |
| `INVALID_PAGE` | 400 | `?page=` não é um número inteiro maior ou igual a 1. A paginação é baseada em 1; portanto, `?page=0` é considerado um erro em vez da primeira página. | Envie `1` ou superior, ou utilize `?offset=`. |
| `INVALID_PARAM` | 400 | Um parâmetro da consulta está malformado. | Veja a mensagem. |
| `INVALID_QUERY_BODY` | 400 | O corpo de `POST …/query` contém um valor incompatível com a URL: uma lista para um parâmetro lido apenas uma vez (`fields`, `limit`, …), um objeto para um filtro, ou parâmetros enviados tanto no corpo quanto na URL — `POST …/query` lê todos os parâmetros do corpo. | Formate cada valor conforme esperado na URL — string, ou lista para filtros repetidos; `where`, `include`, `orderBy` e `vector` aceitam JSON. Veja [Queries too long for a URL](/docs/backend/vector-search/#queries-too-long-for-a-url). |
| `INVALID_VECTOR` | 400 | `?vector=` não é um array JSON de números. | Envie `[0.1,0.2,0.3]`. |
| `INVALID_VECTOR_DISTANCE` | 400 | `?vector_distance=` não é `cosine`, `l2` nem `inner_product`. | Use uma dessas três opções. |
| `INVALID_VECTOR_THRESHOLD` | 400 | `?vector_threshold=` não é um número. | Envie um número. |
| `INVALID_WHERE` | 400 | `?where=` não é um objeto JSON mapeando campos para condições. | Envie `{"status":["==","active"]}`. |
| `KEY_IMMUTABLE` | 400 | Uma atualização altera a chave da linha para um valor diferente do endereço atual — no corpo da requisição ou alterado por um `beforeSave`. Uma linha não pode mudar de chave: todas as etapas posteriores à gravação (leitura de confirmação, `afterSave`, histórico, realtime) utilizam a chave original. Operação recusada antes de rodar qualquer hook, sem gravações, em todas as portas de entrada. `details.violations` indica o campo. | Crie a linha com a nova chave e exclua a antiga. Enviar a chave que a linha já possui é permitido. |
| `MISSING_AGGREGATE_SELECT` | 400 | A rota de agregação foi chamada sem o parâmetro `?select=`. | Adicione o parâmetro, por exemplo `?select=count()`. |
| `NOT_A_MATERIALIZED_VIEW` | 400 | `refresh()` foi chamado em uma tabela que não corresponde a uma view materializada. | Execute refresh somente em views definidas com `defineView(…, { materialized: true })`. |
| `NO_TABLES` | 404 | O projeto não expõe nenhuma tabela: nenhuma declarada em `backend/schema` e nenhuma identificada no banco para introspecção. Se existirem tabelas mas a segurança em nível de linha estiver desativada nelas, a mensagem indica quais são, inclui o SQL para ativá-la, e `details.unprotectedTables` as lista. Anteriormente `NO_COLLECTIONS`. | Crie tabelas — via migration, SQL ou um arquivo `defineTable` com `rebase db push` — e reinicie. |
| `NOT_FOUND` | 404 | Nenhuma linha encontrada com esse id nessa tabela — ou a segurança em nível de linha oculta a linha deste chamador. | Verifique o id e, em seguida, as regras de `rls` da tabela. |
| `UNKNOWN_RELATION` | 400 / 404 | `?include=` referencia algo que não é uma relação na tabela. O mesmo código responde **404** se o *caminho da URL* contiver a relação inexistente, por exemplo `/api/data/authors/1/posts` onde `authors` não a declara — nesse caso a URL não aponta para nada, sendo tratada como não encontrada em vez de malformada. | Verifique o nome da relação — a mensagem lista as disponíveis na tabela. Uma relação reversa precisa estar declarada no pai para permitir navegação. |
| `ORDER_BY_FIELD_NOT_SORTABLE` | 400 | A ordenação especifica um campo que não aceita ordenação. | Ordene por uma coluna válida. |
| `PAGE_WITH_OFFSET` | 400 | `?page=` foi combinado com `?offset=` — ou `page` com `offset` em um `find()`, o que o SDK do cliente, o `rebase.data` em processo e o cliente offline rejeitam com o mesmo código antes de qualquer requisição. Ambos definem a mesma janela, e anteriormente `page` prevalecia silenciosamente sobre um `offset` que nunca era aplicado. | Envie apenas um deles. |
| `PAYLOAD_TOO_LARGE` | 413 | O corpo da requisição excede o limite configurado. | Reduza o payload ou aumente o limite permitido. |
| `READ_ONLY_TRANSACTION` | 409 | Um hook `afterRead` tentou realizar gravações. Uma leitura com escopo de requisição executa dentro de uma transação `READ ONLY`; portanto, nem o hook nem o que for chamado por ele pode realizar gravações. | Mova a gravação para fora da leitura: use uma tarefa em segundo plano (background job) ou `rebase.dataAsAdmin` em um cron job ou função customizada. |
| `REFRESH_NOT_SUPPORTED` | 501 | `POST /api/data/<slug>/refresh` atingiu um driver de dados sem suporte a views materializadas. | Nada a atualizar neste backend. |
| `RELATION_HAS_NO_PIVOT` | 400 | A gravação continha dados de relacionamento (link payload), mas o caminho não alcança seu destino por meio de um `manyToMany` que declare uma tabela intermediária (`pivot`) — logo, não há linha de junção para armazenar esses dados. | Declare colunas de `pivot` na relação ou remova os dados extras da gravação. Veja [Relations](/docs/collections/relations/). |
| `RELATION_MISCONFIGURED` | 500 | Uma relação não resolve em relação ao schema registrado. A operação é recusada em vez de ignorada: ignorá-la indicaria sucesso em uma gravação que nunca ocorreu ou retornaria vazio para linhas existentes. | Execute `rebase schema generate` se o schema gerado estiver desatualizado em relação ao banco. |
| `RELATION_NOT_UNLINKABLE` | 400 | Esta relação não pode ser desvinculada a partir deste lado. | Execute a gravação a partir do lado proprietário da relação. |
| `RELATION_NOT_WRITABLE` | 400 | O caminho aninhado não é uma relação gravável, ou a criação/atualização referencia uma relação `via` com múltiplos saltos — apenas relações `via` de salto único são graváveis. `details.fields` lista as chaves `via`. Nada foi gravado. | Escreva diretamente nas tabelas unidas pela cadeia. Veja [Relations](/docs/collections/relations/#via--an-explicit-join-chain). |
| `RELATION_PIVOT_UNSUPPORTED` | 400 | A relação declara colunas de junção, mas esta fonte de dados não suporta gravar nelas. | O vínculo em si continua funcionando; apenas o payload anexado a ele não é gravado. Verifique as capacidades do driver. |
| `RELATION_SOURCE_KEY_EMPTY` | 400 | Uma gravação de relação não continha uma chave de origem para vincular a relação. | Salve a linha pai primeiro. |
| `RESULT_TOO_LARGE` | — | Uma instrução enviada via `EXECUTE_SQL` no socket realtime — `admin.executeSql` a partir de um cliente, leituras de catálogo no painel admin — retornou mais de 128 MB de linhas, de modo que nenhum dado foi transmitido. Retornado como um frame `ERROR` de WebSocket. As execuções no console SQL não são recusadas: elas mostram apenas as primeiras linhas. | Adicione um `LIMIT` ou selecione menos colunas para ler o resultado em partes. |
| `ROW_IN_TRASH` | 409 | A chave do upsert pertence a uma linha na lixeira (uma linha com exclusão lógica ainda retém sua chave). Um upsert não sobrescreve uma linha excluída, em nenhuma porta de entrada: REST `?on_conflict=`, upserts `/bulk` e `/_batch`, o SDK e o socket realtime. Nada foi gravado. | Restaure a linha primeiro (uma atualização definindo o campo de soft-delete como `null`) ou expurgue-a com `?hard=true` antes de tentar o upsert novamente. Veja [Soft delete](/docs/collections/soft-delete/). |
| `SCHEMA_DRIFT` | 500 | Uma tabela ou coluna esperada pelo código não existe no banco de dados. | Execute `rebase db push` em desenvolvimento; faça novo deploy em ambientes gerenciados. |
| `SCORE_CURSOR_UNSUPPORTED` | 400 | `startAfter` foi combinado com `orderBy: "_score"`. A relevância é calculada por consulta em vez de armazenada, portanto não pode servir de chave para um cursor. | Pagine a relevância com `limit`/`offset` ou ordene por uma coluna. |
| `SQL_ERROR` | 400 | O banco de dados recusou o SQL escrito manualmente. Pelo comando `EXECUTE_SQL` do socket realtime, isso retorna um frame `ERROR` com a mensagem do banco. `POST /api/admin/sql/csv` retorna este erro antes de iniciar o envio do arquivo: erro de sintaxe, tentativa de gravação (o download opera em modo somente leitura), múltiplas instruções ou uso de uma role não autorizada na conexão. | Corrija o SQL. O download aceita apenas uma instrução `SELECT`, `WITH … SELECT`, `TABLE` ou `VALUES`. |
| `VIEW_NOT_READABLE` | 403 | Um chamador sem nenhuma das roles `view.roles` da view materializada tentou lê-la ou atualizá-la. Views materializadas não possuem RLS, portanto são servidas integralmente e apenas para essas roles. | Leia com uma das roles autorizadas ou declare a role do chamador em `view.roles`. |
| `TENANT_IMMUTABLE` | 400 | Uma gravação moveria uma linha de um tenant para outro. Uma linha não pode mudar de tenant. `details.violations` indica o campo. Um gatilho impõe a mesma regra no banco de dados; portanto, SQL executado como o chamador falha com erro Postgres `42501` e mensagem iniciada por `TENANT_IMMUTABLE`. | Crie a linha no outro tenant e exclua a atual, ou grave utilizando uma role presente em `tenant.bypassRoles`. |
| `TENANT_MISMATCH` | 400 | A gravação referencia um tenant ao qual este chamador não pertence; o banco de dados também a recusaria. | Escreva em um tenant ao qual o chamador pertença ou autentique-se como usuário pertencente a ele. |
| `TENANT_REQUIRED` | 400 | A tabela opera com escopo de tenant e o tenant não pôde ser inferido: a requisição não contém nenhum ou o chamador pertence a múltiplos tenants. | Envie o campo de tenant explicitamente ou autentique-se como um usuário associado a exatamente um tenant. |
| `TRANSACTION_ABORTED` | 500 | Uma instrução na transação de gravação falhou e um hook capturou o erro. Como o Postgres já havia abortado a transação, a gravação sofreu rollback e nada foi persistido. Apenas criações, atualizações ou exclusões via `context.data` recusadas pelo banco são desfeitas individualmente e seguras de capturar. | Deixe a falha lançar o erro ou faça as validações antes de executar a instrução. Veja [Transaction Semantics](/docs/collections/context-data-api/#transaction-semantics). |
| `UNKNOWN_FIELD` | 400 | `?fields=` especifica um campo que a tabela não possui. | Verifique a grafia; a mensagem lista os campos válidos. |
| `UNKNOWN_AGGREGATE_FIELD` | 400 | Uma agregação ou `groupBy` referencia um campo inexistente na tabela. | Verifique a grafia; a mensagem lista os campos válidos. |
| `UNKNOWN_FILTER_FIELD` | 400 | O filtro especifica um campo inexistente nesta tabela (ou no destino de uma relação), ou uma coluna `.private()`. | Verifique a grafia; a mensagem lista os campos válidos. |
| `UNKNOWN_FILTER_OPERATOR` | 400 | O filtro especifica um operador que não existe. | A mensagem lista todos os operadores disponíveis. |
| `UNKNOWN_MESSAGE_TYPE` | 400 | Um frame de socket realtime contém um `type` que o servidor não processa. Retornado como um frame `ERROR` contendo o `requestId` da requisição, para que ela seja resolvida em vez de sofrer timeout. | Verifique o `type` do frame; a mensagem indica o tipo recebido. |
| `UNKNOWN_ORDER_BY_FIELD` | 400 | A ordenação referencia um campo inexistente na tabela. | Verifique a grafia; a mensagem lista os campos válidos. |
| `PRECONDITION_FAILED` | 412 | Um cabeçalho `If-Match` informou uma versão da linha que não é mais a atual: alguém alterou os dados entre a sua leitura e esta gravação. Nada foi alterado. | Leia a linha novamente, reaplique as modificações e envie o novo `ETag`. |
| `UNKNOWN_RESPONSE_FIELD` | 400 | `?fields=` solicita um campo inexistente na tabela. | Verifique a grafia; a mensagem lista os campos conhecidos. |
| `UNKNOWN_VECTOR_PROPERTY` | 400 | Uma busca vetorial referenciou uma coluna que não é um `col.vector()` nesta tabela. | A mensagem lista as colunas vetoriais da tabela. |
| `UNSUPPORTED_MEDIA_TYPE` | 415 | O cabeçalho `Content-Type` não é aceito por esta rota. | Envie o tipo documentado para a rota. |
| `UNSUPPORTED_OPTION` | — | Lançado internamente, não retornado como resposta: uma gravação através do acessor em processo (`context.data` em um hook, `rebase.data` em uma função ou cron) recebeu `ifMatch` ou `idempotencyKey`. Esse ponto de entrada não suporta verificação de pré-condições nem armazenamento de idempotência; portanto, a opção é rejeitada antes da gravação em vez de ser ignorada silenciosamente. | Remova a opção nesse ponto ou faça a gravação via cliente HTTP, que suporta ambas. |
| `UNSUPPORTED_RELATION_FILTER` | 400 | O filtro atravessa uma relação `via`, cujo caminho de junção é definido em apenas um sentido; logo, não há como correlacionar uma subconsulta reversa. | Filtre a partir do lado proprietário da relação. |
| `UNSUPPORTED_RELATION_FILTER_OPERATOR` | 400 | O operador não é compatível com esse campo: relações sem coluna direta na linha são filtradas por pertinência (membership), e busca por padrões (`like`, `ilike` e negações) aplica-se exclusivamente a textos. | Veja a mensagem; ela lista o que o campo aceita. |
| `VALIDATION_CONSTRAINT` | 400 | Um valor violou uma regra declarada na coluna (`.validate()`, `.notNull()`, `.oneOf()`) — tamanho, intervalo, padrão, campo obrigatório, valor fora da lista. Cada item em `details.violations` contém um `code`: `required`, `min_length`, `max_length`, `length`, `min`, `max`, `less_than`, `more_than`, `positive`, `negative`, `integer`, `pattern`, `email`, `url`, `enum`, `min_items`, `max_items`, `unique_items` (array com itens duplicados, incluindo `$push`), `unique_by` (dois itens de um array JSON compartilham o mesmo valor no campo indicado por `uniqueBy`), `date_min`, `date_max`, `geopoint_range`. | Veja a mensagem; ela indica a tabela, a coluna e cada violação. |
| `VALIDATION_EXCLUDED_FIELDS` | 400 | O corpo tenta gravar em uma coluna marcada como `.private()` ou `.access({ write: [] })` — a mesma regra com duas sintaxes distintas. Essas colunas são de controle exclusivo do servidor: hash de senha, token de verificação. Diferente de `FIELD_NOT_WRITABLE`, esta resposta é a mesma para qualquer chamador, incluindo `admin`. | Remova o campo. Veja [Field access](/docs/collections/field-access/). |
| `VALIDATION_INVALID_VALUE` | 400 | Um valor não é compatível com o tipo da coluna. | Veja a mensagem; ela indica a coluna. |
| `VALIDATION_UNKNOWN_FIELDS` | 400 | O corpo referencia um campo inexistente na tabela — incluindo um argumento `id` em tabelas cuja chave primária é outro campo. | Verifique a grafia; a mensagem ("Table 'x' has no column 'f'. Known columns: …") lista as colunas válidas. |
| `VECTOR_CURSOR_UNSUPPORTED` | 400 | Um cursor (`after` / `startAfter`) foi combinado com busca vetorial. As linhas são ordenadas por distância calculada dinamicamente por consulta, o que inviabiliza um cursor; portanto, listagens vetoriais não retornam `nextCursor`. | Pagine os resultados mais próximos usando `limit`/`offset`. |
| `WRITE_DENIED` | 403 | Uma regra de segurança ou política RLS negou a operação de gravação. | Verifique as configurações de `rls` da tabela. |

## `PG_<SQLSTATE>` — restrição recusada pelo banco de dados

Uma operação de gravação rejeitada pelo Postgres por um motivo referente aos
*dados enviados pelo chamador* responde com o SQLSTATE no próprio código:
`PG_23505`, `PG_23503`, e assim por diante. Trata-se de uma família de códigos,
não de uma lista estática — o Postgres define centenas de SQLSTATEs —, mas apenas
duas classes se aplicam aqui, pois somente elas decorrem de falhas do chamador:

- **classe 23**, violação de restrição de integridade: duplicata, chave
  estrangeira apontando para registro inexistente, coluna NOT NULL enviada vazia;
- **classe 22**, exceção de dados: valor incompatível com o tipo da coluna.

Qualquer outro erro — conexão perdida, coluna ausente, falha de privilégios — é
uma falha do servidor e permanece como `500`. Assim, `code.startsWith("PG_")` é
uma verificação segura para "a linha que enviei continha dados inválidos", sendo
os quatro abaixo os mais comuns encontrados por um cliente. `details.dbCode`
traz o mesmo SQLSTATE para todos eles, e a mensagem indica a restrição violada.

| Código | Status | Significado | O que fazer |
| --- | --- | --- | --- |
| `PG_22P02` | 400 | O valor não pôde ser interpretado como o tipo da coluna — o equivalente no momento de gravação para `INVALID_FILTER_VALUE`. | Envie um valor compatível com o tipo da coluna. |
| `PG_23502` | 400 | Uma coluna `NOT NULL` foi enviada vazia. | Envie o campo ou defina um valor padrão para a coluna. |
| `PG_23503` | 400 / 409 | Em um salvamento, uma chave estrangeira referencia uma linha inexistente (400). Em uma exclusão, outras linhas ainda referenciam esta (409; uma restrição `RESTRICT` lança `PG_23001`, também 409). | Crie a linha de destino primeiro ou corrija o id; para exclusões, remova ou atualize antes as linhas dependentes. |
| `PG_23505` | 409 | Violação de restrição de unicidade (unique constraint). A mensagem indica a restrição violada. | Use um valor diferente ou atualize a linha existente. |

## Storage

| Código | Status | Significado | O que fazer |
| --- | --- | --- | --- |
| `INVALID_LIST_OPTIONS` | 400 | O `maxResults` da listagem de storage não é um número inteiro de pelo menos 1, ou seu `pageToken` não foi emitido pela origem. Um tamanho de página menor que um anteriormente retornava uma página vazia com o mesmo token, travando loops `while (pageToken)`. | Envie um `maxResults` positivo e repasse `nextPageToken` sem modificações. |
| `INVALID_STORAGE_BUCKET` | 400 | O nome do bucket está malformado. | Verifique o nome. |
| `INVALID_STORAGE_KEY` | 400 | A chave do objeto está malformada, escapa do seu prefixo ou está sob um prefixo reservado (`_rebase/renditions/`, `_rebase/maintenance/`). | Verifique a chave. |
| `INVALID_TRANSFORM_OPTIONS` | 400 | Os parâmetros de transformação de imagem estão fora do intervalo permitido ou são contraditórios. | Veja [Storage](/docs/backend/storage/). |
| `STORAGE_BROKER_REFUSED` | 502 | O storage da plataforma (`STORAGE_TYPE=platform`) solicitou a assinatura de uma requisição ao intermediador de storage da plataforma, e este a recusou por um motivo desconhecido pelo servidor. A mensagem traz o código e a justificativa do broker. | Verifique o status da plataforma; se persistir, relate o código recebido. |
| `STORAGE_FILE_TOO_LARGE` | 413 | O upload excede o `maxBytes` declarado na coluna `col.storage()` de destino. Validado no servidor, não apenas no navegador. `details` informa a coluna, o limite e o tamanho real do arquivo. | Faça o upload de um arquivo menor ou aumente `maxBytes` na coluna. |
| `STORAGE_FILE_TYPE_REFUSED` | 400 | O tipo do upload não consta na lista `accept` da coluna, ou não consta em `allowedMimeTypes` da própria origem de storage. `details` contém a coluna (ou a lista da origem), a lista de formatos aceitos e o content-type enviado. | Envie um tipo aceito ou amplie `accept` / `allowedMimeTypes`. |
| `STORAGE_MISCONFIGURED` | 502 | O bucket S3 ou GCS configurado para esta origem não existe, ou o provedor rejeitou as credenciais desta implantação para acessá-lo. A mensagem indica o bucket; `details.reason` traz `NoSuchBucket` ou a recusa do provedor. Anteriormente, um bucket ausente era interpretado como "arquivo não encontrado" para todos os arquivos. | Corrija o nome do bucket (`S3_BUCKET` / `GCS_BUCKET`, `__<KEY>` para origens nomeadas) ou ajuste as permissões das credenciais. |
| `STORAGE_NOT_CONFIGURED` | 501 / 503 | Nenhum backend de storage está configurado neste servidor, ou nenhum é o padrão e a requisição não especifica uma origem; a mensagem lista as origens disponíveis (501). Um upload retomável (resumable) cuja origem desapareceu antes da conclusão retorna 503. | Configure S3, GCS ou storage local, ou informe uma origem via `?storageId=`. |
| `STORAGE_OBJECT_TOO_LARGE` | 413 | Um upload para o storage da plataforma requer mais partes do que o armazenamento de objetos suporta para um único arquivo. | Faça o upload de um arquivo menor. |
| `STORAGE_PROVIDER_ERROR` | 502 | O armazenamento de objetos recusou uma transferência de platform-storage previamente assinada pelo broker, ou respondeu sem os dados necessários para a transferência (um upload id, o ETag de uma parte). `details.status` traz o status HTTP retornado pelo storage. | Tente novamente; se persistir, verifique o status da plataforma. |
| `STORAGE_QUOTA_EXCEEDED` | 413 | O storage de plataforma do projeto atingiu o limite de cota; logo, o broker recusou a assinatura do upload. | Exclua arquivos ou aumente o limite de armazenamento do projeto. |
| `STORAGE_RATE_LIMITED` | 429 | O broker de storage da plataforma está aplicando limitação de taxa (throttling) às requisições deste projeto. | Aguarde e tente novamente. |
| `STORAGE_SAME_LOCATION` | 400 | `POST /api/admin/storage/move` com `deleteSource` (`rebase storage move --delete-source`) entre duas origens que utilizam o mesmo bucket ou diretório. Todo arquivo seria considerado já existente no destino (sendo o mesmo arquivo) e excluir a cópia de origem apagaria a única versão existente. Nenhuma ação de movimentação ou exclusão foi executada. | Aponte a coluna para a outra origem; os arquivos já estão presentes lá. |
| `STORAGE_SCAN_INCOMPLETE` | 409 | `DELETE /api/admin/storage/orphans` (`rebase storage orphans --delete`) não pôde ler todas as tabelas; assim, arquivos referenciados por elas poderiam ser erroneamente identificados como não utilizados. Com `?scan=`, a varredura indicada é a que falhou na leitura das tabelas. Nenhum arquivo foi excluído; `details.unscanned` indica cada tabela e o motivo da falha de leitura. | Resolva a causa que impede a leitura dessas tabelas e execute novamente. |
| `STORAGE_SCAN_NOT_FOUND` | 404 | `GET /api/admin/storage/orphans/scans/:id` ou `DELETE /api/admin/storage/orphans?scan=:id` especifica uma varredura inexistente na origem. Varreduras são mantidas por 7 dias na origem em que rodaram; portanto, um `storageId` diferente daquele da varredura também não encontrará nada. | Passe o `storageId` correspondente à varredura ou inicie uma nova. |
| `STORAGE_SCAN_NOT_COMPLETE` | 409 | `DELETE /api/admin/storage/orphans?scan=:id` especifica uma varredura que ainda está com status `queued` ou `running`, ou que falhou (`failed`). Nenhum arquivo foi excluído; `details.status` indica o status atual. | Aguarde a conclusão da varredura ou inicie uma nova. |
| `STORAGE_SCAN_EXPIRED` | 409 | `DELETE /api/admin/storage/orphans?scan=:id` especifica uma varredura concluída há mais de 15 minutos. Nenhum arquivo foi excluído. | Inicie uma nova varredura e faça a exclusão a partir dela. |
| `STORAGE_SCAN_DELETION_STARTED` | 409 | `DELETE /api/admin/storage/orphans?scan=:id` especifica uma varredura cujos arquivos órfãos já estão em processo de exclusão. | Verifique o andamento em `deletion` com `GET /api/admin/storage/orphans/scans/:id`. |
| `STORAGE_SOURCE_NOT_CONFIGURED` | 501 | A origem de storage foi declarada, mas não possui credenciais configuradas neste ambiente. | Configure as variáveis de ambiente necessárias para essa origem. |
| `STORAGE_UNAVAILABLE` | 503 | O broker de storage da plataforma está inacessível ou momentaneamente impossibilitado de contabilizar uploads na cota. Leituras de arquivos acessados na última hora continuam funcionando normalmente durante a indisponibilidade. | Tente novamente em instantes. |
| `STORAGE_WRITE_FAILED` | 502 | O backend de storage recusou ou encerrou a conexão durante a gravação. | Verifique os logs e as credenciais do backend de storage. |
| `TRANSFORM_OVERLOADED` | 503 | Quantidade excessiva de transformações de imagem em andamento simultaneamente. | Tente novamente; avalie a inclusão de uma CDN à frente do serviço. |
| `UNKNOWN_STORAGE_SOURCE` | 400 / 404 | A requisição informou uma origem de storage (`?storageId=`) que este projeto não declara. Um `bucket` não servido por esta implantação retorna este mesmo código com status **404** (em listagens, uploads, diretórios ou uploads retomáveis para S3 ou GCS) — o que está ausente é a fonte de armazenamento, e `details` lista os buckets e origens que existem. Ambos costumavam retornar "arquivo não encontrado", idêntico a uma chave simplesmente ausente. | Declare a origem em `config/resources.ts` ou consulte `GET /api/storage/sources`. |
| `UPLOAD_LOCKED` | 423 | O `PATCH` de um upload retomável chegou enquanto outro bloco (chunk) do mesmo upload ainda estava sendo recebido — quase sempre decorrente de um cliente tentando novamente o envio de um bloco em trânsito. A requisição é recusada em vez de enfileirada, seguindo o comportamento do tusd. | Consulte o offset atual com `HEAD /api/storage/tus/:id` e retome a partir dali; o tus-js-client já implementa recuo (backoff) e novas tentativas automaticamente. Veja [Resumable uploads (TUS)](/docs/backend/storage-resumable-uploads/). |

## Funções customizadas

| Código | Status | Significado | O que fazer |
| --- | --- | --- | --- |
| `FUNCTION_NOT_FOUND` | 404 | Nenhuma função com esse nome é servida — ou ela existe, mas suas rotas internas não cobrem o subcaminho informado. Um chamador autenticado é informado sobre o que *está* disponível; um chamador anônimo não, pois essa lista revelaria o inventário de todos os endpoints customizados. Se um arquivo correspondente falhar ao carregar, a mensagem informa isso a um chamador autenticado citando o arquivo: essa é a diferença entre um erro de digitação e um deploy quebrado. Um chamador anônimo recebe apenas a resposta padrão de nome desconhecido. | Verifique o nome em `GET /api/functions` ou consulte os logs de boot para identificar arquivos que falharam no carregamento. |
| `FUNCTION_TIMEOUT` | 504 | O manipulador (handler) excedeu seu tempo limite de execução. Ele continua rodando; não é possível cancelá-lo a partir daqui. A mensagem e `details` (`{ timeoutMs, source }`) informam qual limite foi aplicado e onde foi configurado. | Adicione um `AbortSignal` a chamadas externas, defina o `timeoutMs` da própria função (`defineFunction(…, { timeoutMs })`, no máximo `REBASE_FUNCTIONS_MAX_TIMEOUT_MS`) ou aumente `REBASE_FUNCTIONS_TIMEOUT_MS`. |
| `FUNCTIONS_UPSTREAM_UNREACHABLE` | 502 | Este processo encaminha chamadas de funções como proxy para outro processo, que não respondeu. | Verifique se a unidade de execução de funções está rodando. |

## Funções SQL como RPC

`POST /api/rpc/<name>` — veja [SQL functions as RPC](/docs/backend/rpc/). Um argumento inválido retorna `VALIDATION_CONSTRAINT` (400), com `details.violations` indicando cada campo, assim como na API de dados; uma credencial sem `data:read` retorna `SCOPE_MISSING` (403); uma RPC pública que excede seu limite retorna `RATE_LIMITED` (429).

| Código | Status | Significado | O que fazer |
| --- | --- | --- | --- |
| `RPC_NOT_FOUND` | 404 | Nenhum `defineRpc` com esse nome é exportado por `backend/schema/index.ts`. Apenas funções declaradas podem ser chamadas; portanto, uma função existente no banco mas não declarada também retorna este erro. | Declare-a com `defineRpc` ou verifique o nome. |
| `METHOD_NOT_ALLOWED` | 405 | A RPC existe, mas foi chamada com um método HTTP diferente de `POST`. A resposta contém `Allow: POST`. | Envie um `POST` com corpo JSON contendo os argumentos nomeados. |
| `INVALID_RPC_BODY` | 400 | O corpo é JSON, mas não é um objeto de argumentos nomeados (um array, uma string). | Envie `{ "argument": value }`, ou omita o corpo caso não haja argumentos. |
| `RPC_ARGUMENTS_MISMATCH` | 400 | Nenhuma sobrecarga (overload) da função SQL aceita os argumentos enviados: um parâmetro sem `DEFAULT` foi omitido ou foi informado um parâmetro que ela não possui. A mensagem lista os parâmetros aceitos. | Envie o que a função espera e marque-o como `.required()` em `args`. |
| `RPC_INVALID_ARGUMENT` | 400 | O Postgres recusou um valor incompatível com o tipo do parâmetro da função (SQLSTATE classe 22): `"abc"` para um `uuid`, um valor fora do enum. | Envie um valor compatível com o tipo do parâmetro. |
| `RPC_EXCEPTION` | 400 ou o status indicado por um SQLSTATE `PTnnn` | A função lançou uma exceção: `RAISE EXCEPTION '…'` responde 400 com sua mensagem, e `details` contém `sqlState`, `detail` e `hint`; `RAISE SQLSTATE 'PT404'` responde 404, assim como no PostgREST. | A mensagem é a definida pela própria função. |
| `RPC_READ_ONLY` | 500 | A função realizou gravações, mas RPCs são executadas em transações somente leitura, a menos que declaradas com `write: true`. | Adicione `write: true` na sua declaração `defineRpc`. |
| `RPC_FUNCTION_MISSING` | 500 | A RPC está declarada, mas o banco de dados não possui nenhuma função correspondente a esse schema e nome. O Postgres armazena nomes não cotados em letras minúsculas. | Crie a função ou ajuste o nome/`schema` em `defineRpc`. |
| `RPC_AMBIGUOUS` | 500 | Múltiplas sobrecargas da função aceitam os argumentos enviados. | Remova as sobrecargas que a RPC não deve acessar ou renomeie-as. |

## Notificações push

| Código | Status | Significado | O que fazer |
| --- | --- | --- | --- |
| `PUSH_ENDPOINT_REFUSED` | 400 | O endpoint da assinatura não pertence a um serviço push usado por navegadores (FCM, Mozilla, Apple, Windows) sobre `https`. O servidor envia requisições a esse endereço em cada envio, portanto não aceita nenhum outro. | Envie o `PushSubscription.toJSON()` exatamente como gerado pelo navegador ou inclua um serviço push de testes em `push.allowedHosts`. Veja [Push notifications](/docs/backend/push-notifications/#routes). |
| `PUSH_NEEDS_A_USER` | 403 | Uma chave de API ou a chave de serviço chamou uma rota push. Uma assinatura pertence ao navegador de uma pessoa autenticada. | Chame a rota utilizando a sessão dessa pessoa. |
| `PUSH_NOT_CONFIGURED` | 503 | O serviço de push está ativado, mas não consegue realizar envios: chaves VAPID ausentes em produção ou falha na preparação de sua tabela. A mensagem especifica a causa. | Defina `REBASE_VAPID_PUBLIC_KEY`, `REBASE_VAPID_PRIVATE_KEY` e `REBASE_VAPID_SUBJECT`. Veja [Push notifications](/docs/backend/push-notifications/#keys). |

## Tarefas agendadas (Cron jobs)

| Código | Status | Significado | O que fazer |
| --- | --- | --- | --- |
| `CRON_JOB_ALREADY_EXECUTING` | 409 | Disparo manual de um cron job que já está em execução — no processo que respondeu ou em outro que detenha a concessão de execução (lease) da tarefa, como o worker associado a um processo `api`. Nada foi executado. O cancelamento é registrado no histórico da tarefa, e `details.log` traz essa entrada; a linha indica o processo que está executando a tarefa. | Tente novamente quando a execução em andamento terminar. Veja [Cron Jobs](/docs/backend/cron-across-instances/#concurrency-guarding). |

## Interfaces administrativas e edição de schema

Estes códigos indicam que um recurso está desativado ou não configurado, e
não que a requisição em si estava incorreta. Cada um também é reportado na rota
`/status` correspondente com status `200`, permitindo que o painel desative o
recurso na interface em vez de exibir um erro.

| Código | Status | Significado | O que fazer |
| --- | --- | --- | --- |
| `ADMIN_SURFACE_UNAVAILABLE` | 501 | Uma interface exclusiva para administradores foi chamada em um servidor sem autenticação configurada; logo, não é possível distinguir um admin de qualquer outro chamador. | Configure `auth.jwtSecret` ou passe um `AuthAdapter`. |
| `BRANCH_DIFF_STALE` | 409 | `POST /api/admin/branches/:name/merge` recebeu a impressão digital (fingerprint) de um diff desatualizado: o branch ou seu pai sofreram alterações nesse intervalo. Nada foi gravado. | Obtenha o diff novamente, revise-o e faça o merge com o novo `fingerprint`. |
| `BRANCH_DIFF_UNSUPPORTED` | 501 | A fonte de dados não suporta comparação de branches: sem suporte a SQL ou sem suporte a branching (ausência de conexão administrativa). | Use um backend Postgres com `adminConnectionString` configurada. |
| `BRANCH_MERGE_BLOCKED` | 409 | Uma tabela divergente não pode ser mesclada — adicionada ou removida pelo branch, colunas ou chave primária incompatíveis, ausência de chave primária, excesso de linhas para correspondência, ou tabela reescrita desde a criação do branch (`TABLE_REWRITTEN`). Uma tabela cujas linhas não puderam ser comparadas bloqueia o merge mesmo que sua contagem aponte 0: trata-se de contagem indeterminada, não zero. `details.tables` lista cada tabela e a justificativa. Nada foi gravado. | Aplique o schema usando suas migrations primeiro, ou faça o merge com `skipBlocked: true` para ignorar essas tabelas. |
| `BRANCH_MERGE_CONFLICT` | 409 | Houve alteração de linhas tanto no branch quanto no seu pai, e `onConflict` estava como `"abort"` (o padrão); ou o pai recusou parte da mesclagem — uma linha alterada concorrentemente, um trigger que a ignorou, uma política de RLS que a ocultou. Nada foi gravado. | Defina qual lado prevalece com `onConflict: "branch"` ou `"target"`, ou gere o diff novamente. |
| `BRANCH_MERGE_FAILED` | 409 | O pai recusou as linhas do branch durante a instrução de merge — uma restrição, valor de enum ou chave estrangeira existente no pai que as linhas do branch violam, geralmente por inconsistência entre os dois schemas. `details` contém `sqlState`, `table`, `constraint` e `detail`. Nada foi gravado. | Analise as alterações de schema no diff, alinhe o schema do pai usando suas migrations ou corrija as linhas no branch e tente o merge novamente. |
| `BRANCH_NOT_FOUND` | 404 | Nenhum branch com esse nome foi encontrado no registro. | O comando `rebase db branch list` ou o painel Branches lista os branches existentes. |
| `CONTRACT_UNAVAILABLE` | 404 | O contrato do projeto é exposto apenas quando a autenticação está configurada — ele descreve todas as tabelas e relações. | Configure a autenticação. `/meta/schema-version` é sempre servido. |
| `DEV_MAILBOX_UNAVAILABLE` | 501 | Nenhuma caixa de e-mail de desenvolvimento está ativa. O envio de e-mails só é interceptado quando `SMTP_HOST` não está definido e `NODE_ENV` não é production. | Remova a definição de `SMTP_HOST` em desenvolvimento ou verifique a caixa de entrada real. |
| `DOCS_UNAVAILABLE` | 404 | `GET /api/docs` é disponibilizado para os mesmos chamadores autorizados a ver as tabelas em `GET /api/schema/tables`; sem autenticação configurada no servidor, não há para quem exibi-las. | Configure a autenticação ou torne a documentação pública para todos definindo `enableSwagger: true` (`REBASE_ENABLE_SWAGGER=true`). |
| `INVALID_CHANGE` | 400 | A proposta de alteração de schema não está bem formatada. | Veja a mensagem. |
| `SCHEMA_CHANGE_FAILED` | 400 | A aplicação de uma alteração planejada no schema falhou por um motivo não coberto por códigos mais específicos. | Veja a mensagem; ela traz a falha original de forma textual. |
| `SCHEMA_CHANGE_UNAPPLICABLE` | 400 | A alteração é válida, mas incompatível com o estado atual do schema. | Veja a mensagem. |
| `SCHEMA_EDIT_DIRTY_TREE` | 409 | O repositório contém alterações não commitadas, impedindo a aplicação segura da edição. | Faça commit ou stash das alterações e tente novamente. |
| `SCHEMA_EDIT_REFUSED` | 400 | O editor de schema recusou a alteração: o trecho a ser alterado está em um formato que ele não reescreve (um spread, um helper, uma chave computada) ou a alteração é uma ação não suportada (renomear tabela, excluir a última regra). `details.problems` lista cada item. Nada foi gravado. | Veja a mensagem. Faça a modificação manualmente em `backend/schema`. |
| `SCHEMA_EDIT_DOES_NOT_COMPILE` | 400 | A edição pode ser feita, mas resultaria em um schema que não compila — uma relação com uma tabela excluída, uma regra referenciando coluna removida. `details.problems` traz os apontamentos do compilador, com tabela e coluna correspondentes. Nada foi gravado. | Altere antes as tabelas dependentes ou faça a modificação manualmente em `backend/schema`. |
| `SCHEMA_EDIT_STALE_FILE` | 409 | Um arquivo a ser alterado foi modificado no disco desde que a edição foi preparada (salvamento no editor, outro processo). Nada foi gravado. | Recarregue e reaplique a edição com base no estado atual do arquivo. |
| `SCHEMA_EDIT_REQUIRES_A_PERSON` | 403 | Uma chave de API ou outra credencial de máquina tentou aplicar uma alteração de schema. | Faça login como usuário humano ou configure `liveSchema.allowMachineApply`. |
| `SCHEMA_EDITING_NO_COLLECTIONS_DIR` | 501 | A edição de schema em tempo real requer `schemaDir` (o diretório `backend/schema`) ou `liveSchema.repository`, e o servidor foi iniciado sem nenhum deles. O código mantém o nome legado. | Configure um deles. |
| `SCHEMA_EDITING_NO_REPOSITORY` | 503 | O planejamento funciona, mas não há repositório para commitar a alteração — um deploy rodando um bundle compilado ou um servidor cujo diretório `backend/schema` não está em um repositório git (aplicações são sempre commitadas). | Execute `git init` no projeto e reinicie o servidor (o repositório é detectado no boot), ou defina `liveSchema.repository`. |
| `SCHEMA_EDITING_PROVISIONING_OFF` | 409 | Esta implantação não faz alterações no seu banco de dados (`REBASE_PROVISION=false`); logo, alterações não podem ser aplicadas pelo painel. | Faça o commit apenas no código-fonte e deixe que o processo responsável por gerenciar o banco aplique a alteração. |
| `SCHEMA_EDITING_UNSUPPORTED` | 503 | Este driver não suporta planejamento de alterações de schema. | A edição em tempo real está disponível para Postgres. |
| `SCHEMA_EDITOR_BAAS_MODE` | 501 | As tabelas são obtidas por introspecção direta do banco de dados, não havendo arquivos de código-fonte locais para editar. | Altere o schema utilizando uma migration. |
| `SCHEMA_EDITOR_DISABLED` | 501 | O editor de schema está desativado neste servidor. Um bundle compilado sempre retorna este código. | Ative-o em `schemaEditor`. Em bundles compilados, defina `REBASE_LIVE_SCHEMA_REPOSITORY` para editar `backend/schema` por meio de um repositório — veja [Live schema editing](/docs/backend/live-schema-editing#from-a-built-bundle). |
| `SCHEMA_EDITOR_MISSING_DEPENDENCY` | 501 | O editor de schema necessita do pacote `ts-morph`, que não está instalado. | Instale-o no pacote que executa o backend e reinicie: execute `pnpm --dir backend add -D ts-morph@28.0.0` a partir da raiz de um projeto scaffolded, ou `pnpm add -D ts-morph@28.0.0` se o backend for o próprio projeto. A mensagem indica o comando exato para seu projeto. |
| `SCHEMA_EDITOR_NO_COLLECTIONS_DIR` | 501 | O servidor não possui `schemaDir` configurado; logo, o editor não tem onde gravar. O código mantém o nome legado. | Configure `schemaDir`. |
| `SCHEMA_EDITOR_PRODUCTION` | 501 | O editor fica desativado sob `NODE_ENV=production`: os arquivos de um servidor em produção são reconstruídos a partir do repositório a cada deploy, descartando edições feitas diretamente aqui. | Edite `backend/schema` em desenvolvimento e faça deploy, ou configure `liveSchema.repository` para versionar os commits diretamente lá. |
| `SCHEMA_UNAVAILABLE` | 404 | `GET /api/schema/tables` chamado em um backend sem autenticação configurada: não há chamador para calcular as permissões de exibição das tabelas, e `auth.requireAuth: false` não altera esse comportamento. | Configure um adapter de autenticação ou `auth.jwtSecret`. Veja [Endpoints](/docs/backend/endpoints/#schema). |
| `TABLE_NOT_FOUND` | 404 | `GET /api/schema/tables/:slug` indica uma tabela não servida para este chamador — inexistente com esse slug ou fora do alcance dos escopos de sua credencial. | Verifique o slug e os escopos `data:*` da credencial. |
| `UI_PREFERENCES_NEED_A_PERSON` | 403 | `/api/admin/ui-config` foi chamado com uma chave de API, token de plataforma ou chave de serviço. Preferências de interface pertencem a uma pessoa autenticada. | Faça login como usuário. |
| `UI_PREFERENCES_TOO_LARGE` | 413 | As preferências de interface de uma tabela excedem 64 KB. | Salve menos dados: preferências guardam apresentação, não dados de negócio. |
| `UI_PREFERENCES_UNSUPPORTED` | 501 | O driver deste backend não suporta execução de SQL; portanto, não armazena preferências de UI; o painel as mantém localmente no navegador. | Nada a corrigir: as preferências permanecem salvas por navegador. |
| `UI_CONFIG_FILE_INVALID` | 500 | `frontend/src/cms/ui-config.json`, onde as preferências de UI do workspace são salvas em desenvolvimento, não é um JSON válido. | Corrija ou apague o arquivo; o painel o recriará no próximo salvamento. |
| `SQL_EXPORT_UNSUPPORTED` | 501 | `POST /api/admin/sql/csv` não pode transmitir resultados aqui: o banco de desenvolvimento em processo (PGlite) possui apenas uma conexão, e reter um cursor durante um download bloquearia qualquer outra consulta; ou a fonte de dados não suporta cursores SQL. | Aponte `DATABASE_URL` para uma instância Postgres própria (`rebase dev --docker` inicia uma) ou adicione um `LIMIT` e exporte as linhas visíveis na tela. |
| `SQL_SNIPPETS_NEED_A_USER` | 403 | `/api/admin/sql/snippets` foi chamado com uma credencial que não identifica nenhuma pessoa (a chave de serviço). Os snippets SQL guardados pertencem a uma pessoa com sessão iniciada. | Inicie sessão como utilizador. |
| `SQL_SNIPPETS_UNSUPPORTED` | 501 | A fonte de dados não executa SQL, por isso não tem onde guardar snippets; a consola SQL mantém-nos no navegador. | Nada a corrigir: os snippets ficam em cada navegador. |

### Reconciliação de schema

[`rebase schema reconcile`](/docs/cli/schema/#rebase-schema-reconcile) planeja
a reconciliação via `POST /api/admin/schema/reconcile/plan` e aplica via
`/reconcile/apply`. Uma recusa não altera nada; apenas `SCHEMA_RECONCILE_FAILED`
pode deixar partes de um plano aplicadas.

| Código | Status | Significado | O que fazer |
| --- | --- | --- | --- |
| `INVALID_RECONCILE` | 400 | O corpo da requisição não é um objeto JSON ou `drop` não é uma lista de strings no formato `"<table>.<column>"`. | Envie `{ "drop": ["voice_cache.wav"] }`, ou omita `drop`. |
| `SCHEMA_RECONCILE_FAILED` | 400 | Uma instrução falhou no meio da execução. As instruções anteriores foram executadas e permanecem aplicadas; `details.applied` lista quais foram. | Corrija o que a mensagem aponta e gere o plano novamente: o novo plano omitirá o que já foi aplicado. |
| `SCHEMA_RECONCILE_INVALID` | 400 | O plano não pode ser aplicado, e a mensagem explica o motivo: um `drop` que não segue o padrão `<table>.<column>`, faz referência a tabela/coluna inexistente, ou indica uma coluna ainda declarada na tabela. `details.plan` contém o plano. | Corrija a lista em `drop`. Para remover uma coluna declarada, remova-a do `defineTable`, faça deploy e execute a reconciliação. |
| `SCHEMA_RECONCILE_STALE` | 409 | O banco de dados ou as tabelas foram modificados após a confirmação do plano. `details.plan` traz o novo plano gerado. | Revise o novo plano e confirme utilizando o seu `digest`. |
| `SCHEMA_RECONCILE_UNCONFIRMED` | 400 | `/reconcile/apply` foi chamado sem o parâmetro `confirm`. | Gere o plano primeiro e envie o `digest` do plano no campo `confirm`. A CLI faz isso automaticamente ao digitar `yes`. |
| `SCHEMA_RECONCILE_UNSUPPORTED` | 503 | O driver deste backend não suporta planejamento de reconciliação ou não executa SQL. | A reconciliação funciona em Postgres. |

### Por que uma tabela de branch não pode ser mesclada

`BRANCH_MERGE_BLOCKED` lista cada tabela recusada em `details.tables`, acompanhada
de um destes códigos. O mesmo código aparece no campo `blocked` da tabela no
próprio diff, permitindo que o Studio informe o impedimento antes que o usuário
clique em **Merge**. Nenhum deles é uma resposta HTTP por si só.

| Código | Status | Significado | O que fazer |
| --- | --- | --- | --- |
| `COLUMNS_DIFFER` | — | As colunas da tabela diferem entre o branch e o seu pai. A comparação de linhas é feita sobre as colunas que ambos compartilham. | Adicione as colunas faltantes ao pai usando suas migrations (`rebase db push`) e faça o merge. Uma migration que reescreve a tabela (como mudança de tipo de coluna) a converte em `TABLE_REWRITTEN`: faça o merge antes dessa alteração ou recrie o branch depois dela. |
| `NO_PRIMARY_KEY` | — | A tabela não possui chave primária; portanto, as linhas não podem ser comparadas uma a uma; o diff informa apenas a contagem total de linhas. | Adicione uma chave primária à tabela ou mova suas linhas manualmente. |
| `PRIMARY_KEY_DIFFERS` | — | As colunas da chave primária, ou os seus tipos, diferem entre os dois lados. | Aplique o schema ao pai primeiro. |
| `TABLE_ADDED` | — | O branch criou a tabela. Uma mesclagem nunca cria tabelas. | Crie-a no pai usando suas migrations e mescle suas linhas em seguida. |
| `TABLE_DROPPED` | — | O branch removeu a tabela. Uma mesclagem nunca remove tabelas. | Remova-a no pai usando suas migrations. |
| `TABLE_REWRITTEN` | — | Um dos lados reescreveu todas as linhas da tabela após a criação do branch — mudança de tipo de coluna, `ADD COLUMN` com default volátil, `VACUUM FULL`, `CLUSTER` — fazendo com que todas as linhas pareçam modificadas desde então, tornando impossível determinar qual lado alterou qual linha. | Mescle o branch antes dessa migration ou recrie o branch a partir do pai depois dela. |
| `TOO_LARGE` | — | A tabela possui mais linhas em um dos lados do que a quantidade máxima comparada linha a linha pelo diff (100.000 por padrão, `maxRowsPerTable`). | Aumente `maxRowsPerTable` tanto no diff quanto no merge, ou sincronize as linhas por outro método. |

## Códigos genéricos

Uma rota utiliza um destes códigos quando nenhum outro mais específico for aplicável.

| Código | Status | Significado | O que fazer |
| --- | --- | --- | --- |
| `BAD_REQUEST` | 400 | Requisição malformada, sem código mais específico aplicável. | Veja a mensagem. |
| `UNAUTHORIZED` | 401 | Não autenticado ou a credencial foi rejeitada. | Faça login ou renove o token. |
| `FORBIDDEN` | 403 | Autenticado, mas sem permissão de acesso. | Tentar novamente com a mesma identidade não ajudará. |
| `CONFLICT` | 409 | Conflito com o estado atual do recurso. | Veja a mensagem. |
| `INTERNAL_ERROR` | 500 | Falha interna no servidor. A mensagem é intencionalmente genérica. | Cite o `requestId`; o detalhamento do erro está nos logs. |
| `NOT_CONFIGURED` | 503 | Uma dependência necessária para esta rota não está configurada neste servidor. | Veja a mensagem. |
| `SERVICE_UNAVAILABLE` | 503 | Um serviço do qual a requisição depende não pôde ser alcançado: um bucket S3 ou MinIO, ou um host chamado via `fetch()` por uma função que recusou a conexão ou não resolveu DNS. O log do servidor identifica o host; a resposta HTTP não. Um banco de dados inacessível retorna `DATABASE_UNAVAILABLE`. Conexões com serviços dependentes que falharem retornam este código. | Tente novamente; verifique os logs. |

## Mantendo esta página atualizada

O comando `pnpm verify:docs` falha se algum código que o servidor pode lançar
estiver ausente destas tabelas, se uma tabela listar um código que nada dispara,
se os status de uma linha não corresponderem exatamente àqueles com os quais o
código é lançado na fonte, ou se uma família de códigos como `PG_<SQLSTATE>` não
possuir linha para um SQLSTATE comum encontrado pelos chamadores. Essa validação
reside em `tooling/scripts/docs-verify/check-error-codes.mjs`.

O script faz uma autoavaliação primeiro. A varredura extrai códigos a partir do
TypeScript em vez de consultar um servidor em execução; logo, seus pontos cegos
são silenciosos por natureza: anteriormente, o script não identificava um código
passado por um wrapper de uma linha, ou posicionado após uma mensagem contendo
um `)`, reportando "todos os códigos lançados pelo servidor estão documentados"
em uma página que omitia dezessete deles. Por isso, a verificação executa um
arquivo de teste contendo exatamente esses padrões antes de ler esta página,
recusando-se a validar qualquer item caso não consiga identificá-los.
