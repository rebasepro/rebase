---
sourceHash: 94ae1d0452d97c4b
title: Índice de endpoints
sidebar_label: Índice de endpoints
description: Todas as rotas HTTP que um backend Rebase monta — dados, autenticação, armazenamento, admin, meta — com a restrição de acesso (gate) de cada uma e a página que a explica.
---

Todas as rotas que o servidor monta, em uma única tabela, com os requisitos necessários para acessá-las.

Os caminhos presumem o `basePath` padrão de `/api`; `REBASE_BASE_PATH` move todos
eles juntos. `/health`, `/livez` e `/metrics` ficam intencionalmente fora dele,
porque um orquestrador faz a sondagem de `/health` e não deve precisar conhecer o caminho
base. `/health` *também* é montado sob ele, de modo que `/api/health` responda da mesma
forma em vez de retornar 404 no exato momento em que alguém estiver verificando se o servidor
está ativo.

Um gate — `tooling/scripts/docs-verify/check-endpoint-index.mjs` — compara esta
tabela com as rotas registradas pelo código-fonte, garantindo que uma nova superfície não
possa ser adicionada sem constar aqui.

## Gates

| Gate | Significado |
|---|---|
| **none** | Não autenticado. Qualquer pessoa que consiga alcançar o host pode chamá-la |
| **session** | Um chamador autenticado: um token de acesso ou uma chave de API com escopo para a operação |
| **`resource:action`** | Um chamador que possui esse [escopo](/docs/backend/roles-and-scopes/): um administrador, uma pessoa cuja role o declara, uma chave de API criada com ele, ou a chave de serviço |
| **RLS** | Autenticado, e então o banco de dados decide linha por linha — consulte [Security Rules](/docs/collections/security-rules/) |
| **dev** | Montado apenas fora de produção |

## Data

Gerado por tabela, de modo que os caminhos contêm seus slugs em vez de uma lista
fixa. `:slug` é o slug de uma tabela (seu nome, a menos que `defineTable` defina `slug`).

| Método | Caminho | Gate | Mais |
|---|---|---|---|
| `GET` | `/api/data/:slug` | RLS | [Consultas](/docs/backend/filtering/) |
| `POST` | `/api/data/:slug` | RLS | [API REST](/docs/backend/api/) |
| `POST` | `/api/data/:slug/query` | RLS | A listagem, parâmetros de consulta no corpo — [Consultas longas demais para uma URL](/docs/backend/vector-search/#queries-too-long-for-a-url) |
| `GET` | `/api/data/:slug/count` | RLS | [Consultas](/docs/backend/filtering/) |
| `POST` | `/api/data/:slug/count` | RLS | A contagem, parâmetros de consulta no corpo — [Consultas longas demais para uma URL](/docs/backend/vector-search/#queries-too-long-for-a-url) |
| `GET` | `/api/data/:slug/aggregate` | RLS | [API REST](/docs/backend/api/#rest-endpoints) |
| `POST` | `/api/data/:slug/refresh` | `view.roles` | Recalcula uma view materializada, nas views que são materializadas — [Views](/docs/collections/views/#materialized-views) |
| `GET` | `/api/data/:slug/:id` | RLS | [API REST](/docs/backend/api/) |
| `PATCH` | `/api/data/:slug/:id` | RLS | [API REST](/docs/backend/api/) |
| `PUT` | `/api/data/:slug/:id` | RLS | Alias obsoleto de `PATCH` — mesma gravação parcial, responde `Deprecation: true` |
| `DELETE` | `/api/data/:slug/:id` | RLS | [API REST](/docs/backend/api/) |
| `POST` | `/api/data/:slug/bulk` | RLS | Insere várias linhas, opcionalmente realizando upsert — [API REST](/docs/backend/api/) |
| `PATCH` | `/api/data/:slug/bulk` | RLS | Atualiza várias linhas por id — [API REST](/docs/backend/api/) |
| `POST` | `/api/data/:slug/bulk/delete` | RLS | Exclui várias linhas por id — [API REST](/docs/backend/api/) |
| `POST` | `/api/data/_batch` | RLS | Grava em múltiplas tabelas em uma única transação — [Gravação via REST](/docs/backend/writes/#cross-table-batches) |
| `GET` | `/api/data/:slug/:id/history` | RLS | [Histórico da Entidade](/docs/backend/history/) |
| `POST` | `/api/data/:slug/:id/history/:historyId/revert` | RLS | [Histórico da Entidade](/docs/backend/history/) |

Contagem e agregação são rotas próprias, registradas antes de `/:id` para
que `aggregate` não seja interpretado como um ID de entidade. `?select=` e `?groupBy=` são
seus parâmetros, e `select` é obrigatório em `/aggregate`.

Busca textual, busca vetorial, inclusão de relações e seleção de campos *são* parâmetros
de consulta em `GET /api/data/:slug` em vez de rotas — `searchString`,
`vector_search`, `include`, `fields`. Consulte [API REST](/docs/backend/api/).

Um projeto que não declara nenhuma tabela e não faz introspecção de nenhuma serve este prefixo
como um único `404 NO_TABLES`. Consulte [Apenas backend](/docs/getting-started/headless/).

## Auth

| Método | Caminho | Gate | Mais |
|---|---|---|---|
| `GET` | `/api/auth/config` | none | O que a tela de login pode oferecer: cadastro, redefinição de senha, magic link, códigos por e-mail, login de convidado, provedores OAuth e se a configuração do primeiro administrador está pendente |
| `POST` | `/api/auth/register` | none | [Autenticação](/docs/backend/authentication/) |
| `POST` | `/api/auth/login` | none | [Endpoints de autenticação](/docs/backend/auth-endpoints/) |
| `POST` | `/api/auth/refresh` | none (um refresh token) | [Endpoints de autenticação](/docs/backend/auth-endpoints/) |
| `POST` | `/api/auth/logout` | session | [Endpoints de autenticação](/docs/backend/auth-endpoints/) |
| `GET` | `/api/auth/me` | session | [Endpoints de autenticação](/docs/backend/auth-endpoints/) |
| `PATCH` | `/api/auth/me` | session | [Endpoints de autenticação](/docs/backend/auth-endpoints/) |
| `GET` | `/api/auth/sessions` | session | [Endpoints de autenticação](/docs/backend/auth-endpoints/) |
| `DELETE` | `/api/auth/sessions` | session | Revoga todas as outras sessões |
| `DELETE` | `/api/auth/sessions/:id` | session | Revoga uma |
| `POST` | `/api/auth/forgot-password` | none | [Autenticação](/docs/backend/authentication/) |
| `POST` | `/api/auth/reset-password` | none (um token de redefinição) | [Autenticação](/docs/backend/authentication/) |
| `POST` | `/api/auth/change-password` | session | [Autenticação](/docs/backend/authentication/) |
| `POST` | `/api/auth/change-email` | session | Envia um link de confirmação para o novo endereço — [Alteração de endereço de e-mail](/docs/backend/auth-endpoints/#changing-an-email-address) |
| `POST` | `/api/auth/confirm-email-change` | none (um token de link) | Move a conta para o novo endereço — [Alteração de endereço de e-mail](/docs/backend/auth-endpoints/#changing-an-email-address) |
| `POST` | `/api/auth/send-verification` | session | [Autenticação](/docs/backend/authentication/) |
| `GET` | `/api/auth/verify-email` | none (um token de verificação) | [Autenticação](/docs/backend/authentication/) |
| `POST` | `/api/auth/verify-email` | none (um token de verificação e uma sessão ou a senha para mantê-la) | [Verificação de e-mail](/docs/backend/email-verification/) |
| `POST` | `/api/auth/magic-link` | none | [Autenticação](/docs/backend/authentication/) |
| `POST` | `/api/auth/magic-link/verify` | none (um token de link) | [Autenticação](/docs/backend/authentication/) |
| `POST` | `/api/auth/otp` | none | Códigos de uso único por e-mail |
| `POST` | `/api/auth/otp/verify` | none (um código) | Códigos de uso único por e-mail |
| `POST` | `/api/auth/device` | none | [Login por dispositivo](/docs/backend/device-sign-in/). Desativado a menos que o backend o habilite |
| `POST` | `/api/auth/device/token` | none (um código de dispositivo) | [Login por dispositivo](/docs/backend/device-sign-in/): polling do dispositivo |
| `GET` | `/api/auth/device/:userCode` | session | [Login por dispositivo](/docs/backend/device-sign-in/): o que a página de aprovação exibe |
| `POST` | `/api/auth/device/approve` | session (`aal2` com um segundo fator) | [Login por dispositivo](/docs/backend/device-sign-in/) |
| `POST` | `/api/auth/device/deny` | session | [Login por dispositivo](/docs/backend/device-sign-in/) |
| `POST` | `/api/auth/anonymous` | none | Sessões de convidado. Desativado a menos que `ALLOW_ANONYMOUS` |
| `POST` | `/api/auth/anonymous/link` | session (um convidado) | Converte um convidado em uma conta |
| `POST` | `/api/auth/find-user` | session | Desativado a menos que `AUTH_ALLOW_USER_LOOKUP` — trata-se de uma superfície de enumeração |
| `POST` | `/api/auth/:provider` | none | Um por provedor OAuth/OIDC configurado |
| `POST` | `/api/auth/link/:provider` | session | Vincula um provedor à conta autenticada |
| `POST` | `/api/auth/mfa/enroll` | session | [MFA](/docs/backend/auth-endpoints/#multi-factor-authentication-totp) |
| `POST` | `/api/auth/mfa/verify` | session | [MFA](/docs/backend/auth-endpoints/#multi-factor-authentication-totp) |
| `GET` | `/api/auth/mfa/factors` | session | [MFA](/docs/backend/auth-endpoints/#multi-factor-authentication-totp) |
| `DELETE` | `/api/auth/mfa/unenroll` | session | [MFA](/docs/backend/auth-endpoints/#multi-factor-authentication-totp) |
| `POST` | `/api/auth/mfa/recovery-codes` | session (`aal2`) | [MFA](/docs/backend/auth-endpoints/#multi-factor-authentication-totp) |
| `POST` | `/api/auth/mfa/challenge` | none (um login em andamento) | [MFA](/docs/backend/auth-endpoints/#multi-factor-authentication-totp) |
| `POST` | `/api/auth/mfa/challenge/verify` | none (um ID de desafio) | [MFA](/docs/backend/auth-endpoints/#multi-factor-authentication-totp) |
| `GET` | `/api/auth/scopes` | session | Todos os escopos que este backend conhece e aqueles que o chamador possui — [Roles e escopos](/docs/backend/roles-and-scopes/) |
| `GET` | `/api/auth/keys` | session (uma conta) | As [chaves pessoais](/docs/backend/api-keys/#personal-keys) do próprio chamador |
| `POST` | `/api/auth/keys` | session (uma conta) | A chave em texto puro é retornada apenas uma vez. `403 PERSONAL_KEYS_DISABLED` a menos que a tabela de autenticação defina `auth.personalKeys` |
| `DELETE` | `/api/auth/keys/:id` | session (uma conta) | Revoga uma das chaves do próprio chamador |
| `GET` | `/.well-known/jwks.json` | none | O JWKS público, quando a [assinatura assimétrica](/docs/backend/auth-endpoints/#asymmetric-tokens-and-jwks) está configurada |

## Admin

Tudo sob `/api/admin` requer um escopo do plano de administração, e cada
superfície nomeia o seu próprio: `users:read` lista contas, `cron:write` dispara um job.
Um administrador possui todos eles, assim como a chave de serviço. Uma pessoa possui aqueles
declarados por suas roles, e uma chave de API possui aqueles com os quais foi criada. Uma chave com escopo limitado a
uma tabela não acessa nada disso. Consulte [Roles e escopos](/docs/backend/roles-and-scopes/).

| Método | Caminho | Gate | Mais |
|---|---|---|---|
| `POST` | `/api/admin/bootstrap` | none, e apenas enquanto não existir nenhum administrador | Recusado em produção — consulte [Inicialização do Primeiro Usuário](/docs/backend/authentication/#first-user-bootstrap) |
| `GET` | `/api/admin/users` | `users:read` | Gerenciamento de usuários |
| `POST` | `/api/admin/users` | `users:write` | Gerenciamento de usuários. Roles além das do próprio chamador são recusadas |
| `GET` | `/api/admin/users/pick` | `users:read`, ou acesso de gravação a uma tabela com uma coluna `.userId()` | A [leitura do seletor de usuários](/docs/backend/auth-endpoints/): apenas id, nome, e-mail e avatar. Uma tabela cujas regras de gravação sejam SQL puro não se qualifica |
| `GET` | `/api/admin/users/:uid` | `users:read` | Gerenciamento de usuários |
| `PUT` | `/api/admin/users/:uid` | `users:write` | Recusado para uma conta que possui mais privilégios do que o chamador |
| `DELETE` | `/api/admin/users/:uid` | `users:write` | Recusado para uma conta que possui mais privilégios do que o chamador |
| `POST` | `/api/admin/users/:uid/reset-password` | `users:write` | Emite uma senha temporária |
| `DELETE` | `/api/admin/users/:uid/mfa` | `users:write` | Remove os segundos fatores e códigos de recuperação da conta, encerra suas sessões |
| `GET` | `/api/admin/guests` | `users:read` | Convidados, ordenados pelos vistos há mais tempo primeiro. `?lastSeenBefore=` os restringe ao que a exclusão abaixo receberia, e `total` faz a contagem |
| `DELETE` | `/api/admin/guests` | `users:write` | Exclui um lote dos convidados vistos pela última vez antes de `?lastSeenBefore=`, que é obrigatório. Responde `{ deleted, skipped, remaining }`. Repita enquanto `remaining` for diferente de 0, com `?offset=` definido para quantos foram ignorados. Contas normais não podem ser afetadas |
| `DELETE` | `/api/admin/guests/:uid` | `users:write` | Exclui um convidado. Uma conta normal é recusada com `NOT_ANONYMOUS` |
| `GET` | `/api/admin/roles` | `users:read` | `admin` e as roles declaradas pelo projeto, com seus escopos |
| `GET` | `/api/admin/api-keys` | `keys:read` | [Chaves de API](/docs/backend/api-keys/). Nunca uma chave de API |
| `POST` | `/api/admin/api-keys` | `keys:write` | A chave em texto puro é retornada apenas uma vez, na criação |
| `GET` | `/api/admin/api-keys/:id` | `keys:read` | [Chaves de API](/docs/backend/api-keys/) |
| `PUT` | `/api/admin/api-keys/:id` | `keys:write` | [Chaves de API](/docs/backend/api-keys/) |
| `DELETE` | `/api/admin/api-keys/:id` | `keys:write` | [Chaves de API](/docs/backend/api-keys/) |
| `GET` | `/api/admin/cron` | `cron:read` | [Cron Jobs](/docs/backend/cron-jobs/) |
| `GET` | `/api/admin/cron/:id` | `cron:read` | [Cron Jobs](/docs/backend/cron-jobs/) |
| `PUT` | `/api/admin/cron/:id` | `cron:write` | Habilita ou desabilita um job |
| `GET` | `/api/admin/cron/:id/logs` | `cron:read` | [Cron Jobs](/docs/backend/cron-jobs/) |
| `POST` | `/api/admin/cron/:id/trigger` | `cron:write` | Executa um job agora. `?async=1` responde `202` assim que for iniciado — [API de Cron Jobs](/docs/backend/cron-jobs-api/#example-trigger-a-job-manually) |
| `GET` | `/api/admin/backups` | `backups:read` | Inventário de backups |
| `GET` | `/api/admin/backups/download` | `backups:read` | Faz streaming de um backup. Com `?token=` obtido de um link de download, nenhum cabeçalho é necessário, apenas para esse backup |
| `POST` | `/api/admin/backups/download-url` | `backups:read` | Um link para um backup, `{ key }` → `{ url, token, expiresIn }`, válido por 60 segundos — [Backups](/docs/deployment/backups/#download-a-backup) |
| `POST` | `/api/admin/storage/orphans/scans` | `database:write` | Inicia uma verificação em segundo plano em busca de arquivos armazenados sem referência em linhas, `?storageId=&olderThanHours=`. Responde `202` com o registro da verificação: `id`, `status` (`queued`) e `runner` (`worker` quando for um job `storage.orphans` na fila de jobs, `in-process` quando o próprio servidor o executar). Seu registro é gravado no source, sob o caminho reservado `_rebase/maintenance/` |
| `GET` | `/api/admin/storage/orphans/scans/:id` | `database:read` | O registro da verificação, `?storageId=`. Enquanto em execução: `progress` (`filesScanned`, `rowsScanned`, `collectionsScanned` de `collectionsTotal`, `unscanned`). Quando `completed`: `result`, o relatório que o antigo `GET /orphans` respondia. Uma execução que parou de reportar por 10 minutos é respondida como `failed`. `404 STORAGE_SCAN_NOT_FOUND` quando a origem não possui tal verificação |
| `DELETE` | `/api/admin/storage/orphans?scan=:id` | `database:write` | Exclui os órfãos de uma verificação concluída em segundo plano, `202`. Cada um é verificado novamente contra todas as linhas e entradas de histórico, e requisitado novamente logo antes de ser excluído. O resultado é a propriedade `deletion` do registro de verificação. `409` com `STORAGE_SCAN_NOT_COMPLETE`, `STORAGE_SCAN_INCOMPLETE`, `STORAGE_SCAN_EXPIRED` ou `STORAGE_SCAN_DELETION_STARTED` |
| `GET` | `/api/admin/storage/orphans` | `database:read` | Obsoleto: a verificação dentro da requisição, `?storageId=&olderThanHours=`. Responde com `Deprecation: true`. Use `POST /orphans/scans` |
| `DELETE` | `/api/admin/storage/orphans` | `database:write` | Obsoleto, sem `?scan=`: verifica novamente e exclui dentro da requisição. `409 STORAGE_SCAN_INCOMPLETE` quando uma tabela não pôde ser lida |
| `POST` | `/api/admin/storage/move` | `database:write` | Copia uma pasta para outra origem sob as mesmas chaves, uma página por chamada — o que `rebase storage move` envia; `400 STORAGE_SAME_LOCATION` para `deleteSource` entre duas origens que armazenam no mesmo local |
| `POST` | `/api/admin/storage/move/verify` | `database:write` | Lista a origem novamente após uma movimentação, com o mesmo corpo, uma página por chamada: `{ checked, notMoved: [{ key, reason }], cursor? }` — cada arquivo que ainda está na origem com `deleteSource`, cada arquivo do qual o destino não possui cópia sem ele. `rebase storage move` consulta esta rota quando a movimentação é concluída |
| `GET` | `/api/admin/logs` | `logs:read` | O buffer de logs recentes |
| `GET` | `/api/admin/logs/latest` | `logs:read` | As entradas mais recentes |
| `GET` | `/api/admin/logs/stream` | `logs:read` | Server-sent events |
| `GET` | `/api/admin/rls-audit` | `schema:read` | O resultado mais recente da auditoria agendada |
| `GET` | `/api/admin/rls-simulator/options` | `schema:read` | Roles, roles de regras de usuários e chaves de serviço ativas que um administrador pode simular |
| `POST` | `/api/admin/rls-simulator/preview` | `schema:read` | Cada tabela conforme acessada por `{ role?, userId?, apiKeyId? }`: linhas visíveis em relação às do chamador, ocultas por escopo ou RLS, campos mascarados. Somente sessão de administrador |
| `POST` | `/api/admin/sql/csv` | `database:write` | Faz streaming de todo o resultado de uma consulta somente leitura como CSV — opção "Download full result as CSV" do [Studio](/docs/studio/) |
| `GET` | `/api/admin/branches/:name/diff` | `database:write` | O que uma [branch](/docs/backend/branching/#reviewing-and-merging-a-branch) alterou: schema, políticas e linhas, `?sampleLimit=&schemas=&maxRowsPerTable=` |
| `POST` | `/api/admin/branches/:name/merge` | `database:write` | Grava as linhas da branch em sua mãe, `{ expectedFingerprint, onConflict?, skipBlocked? }`; `409` quando qualquer um dos lados foi alterado desde o diff, ou quando linhas entram em conflito |
| `GET` | `/api/admin/schema/status` | `schema:read` | [Edição de schema em tempo real](/docs/backend/live-schema-editing/) |
| `POST` | `/api/admin/schema/plan` | `schema:read` | Planeja uma alteração; nunca a aplica |
| `POST` | `/api/admin/schema/apply` | `schema:write` | Apenas uma pessoa, a menos que `REBASE_LIVE_SCHEMA_ALLOW_MACHINE_APPLY` |
| `POST` | `/api/admin/schema/reconcile/plan` | `schema:read` | Planeja flexibilizar `NOT NULL` e descartar as colunas não declaradas nomeadas em `drop`, para [reconciliação de schema](/docs/cli/schema/#rebase-schema-reconcile); nunca aplica |
| `POST` | `/api/admin/schema/reconcile/apply` | `schema:write` | Aplica um plano de reconciliação, apenas se seu `digest` corresponder ao `confirm` enviado |
| `GET` | `/api/admin/schema-editor/status` | `schema:read` | Se o editor está disponível e o motivo caso não esteja |
| `GET` | `/api/admin/schema-editor/tables` | `schema:read` | Todas as tabelas que `backend/schema/index.ts` exporta conforme lidas pelo editor, com o que é editado no código (somente leitura) e o motivo — [Edição de schema em tempo real](/docs/backend/live-schema-editing/#the-edits-tablepatch) |
| `POST` | `/api/admin/schema-editor/preview` | `schema:write` | `{ patches: TablePatch[] }`: os arquivos que a edição gravaria, compilados; não grava nada |
| `POST` | `/api/admin/schema-editor/apply` | `schema:write` | A mesma edição, gravada em `backend/schema`; o banco de dados não é tocado |
| `GET` | `/api/admin/schema-editor/unmapped-tables` | `schema:read` | Tabelas que o banco de dados possui e `backend/schema` não declara: `{ tables: [{ schema, table, rlsEnabled, policies, unimportable? }] }` |
| `GET` | `/api/admin/schema-editor/unmapped-tables/:schema/:table` | `schema:read` | Uma delas descrita: `{ table: { …, descriptor, rlsRaised?, notes } }`, para "Import an existing table". `404` quando desconhecida ou já declarada, `400 SCHEMA_EDIT_REFUSED` sem uma chave primária |
| `GET` | `/api/admin/schema-editor/frontend/calls` | `schema:read` | As chamadas `defineFirestoreCollection` em `frontend/src/cms` que o editor pode reescrever (apenas desenvolvimento) |
| `POST` | `/api/admin/schema-editor/frontend/preview` | `schema:write` | Os arquivos que a edição de uma dessas chamadas gravaria; não grava nada |
| `POST` | `/api/admin/schema-editor/frontend/apply` | `schema:write` | A mesma edição, gravada no local. `409 SCHEMA_EDIT_STALE_FILE` quando o arquivo foi alterado no disco |
| `GET` | `/api/admin/ui-config` | session | As preferências de UI do workspace por tabela, as do próprio chamador e se o chamador pode gravar as do workspace — consulte [Studio](/docs/studio/#collection-editor) |
| `PUT` | `/api/admin/ui-config/workspace/:slug` | `schema:write` | Mescla um delta de `UiTablePreferences` nas preferências de workspace de uma tabela (`replace` substitui). Gravado em `frontend/src/cms/ui-config.json` onde o servidor pode gravar no código-fonte do projeto, caso contrário em `rebase.ui_preferences` |
| `DELETE` | `/api/admin/ui-config/workspace/:slug` | `schema:write` | Remove as preferências de workspace de uma tabela |
| `PUT` | `/api/admin/ui-config/user/:slug` | session (uma pessoa) | As preferências do próprio chamador para uma tabela. Uma chave de API não possui nenhuma: `403 UI_PREFERENCES_NEED_A_PERSON` |
| `DELETE` | `/api/admin/ui-config/user/:slug` | session (uma pessoa) | Remove as preferências do próprio chamador para uma tabela |
| `GET` | `/api/admin/dev/emails` | dev + `users:write` | E-mails que o transporte de desenvolvimento capturou em vez de enviar |
| `DELETE` | `/api/admin/dev/emails` | dev + `users:write` | Esvazia a caixa de correio capturada |

`/api/admin/cron`, `/api/admin/logs` e `/api/admin/schema-editor` também são
disponibilizados em seus caminhos anteriores à versão 0.17 sem o segmento `/admin`. Esses
aliases destinam-se a projetos que ainda não migraram; escreva código novo usando o caminho canônico.

## Schema

| Método | Caminho | Gate | Mais |
|---|---|---|---|
| `GET` | `/api/schema/tables` | session, ou uma credencial com `schema:read` ou um escopo `data:*` | Todas as tabelas que este backend serve, como um array JSON de descritores com dados filtrados para o chamador |
| `GET` | `/api/schema/tables/:slug` | igual ao anterior | Um descritor. `404 TABLE_NOT_FOUND` quando essa tabela não for servida para este chamador |

Os descritores são a base a partir da qual o CMS renderiza seus padrões, o Studio
desenha o visualizador de schema e o editor de RLS, e os apps MCP
renderizam tabelas e formulários. Eles contêm colunas com seus tipos Postgres,
nulabilidade, regras de validação e armazenamento, relações por slug e a
postura de segurança em nível de linha (RLS). O código de hooks nunca sai do servidor: um descritor
informa apenas quais hooks uma tabela possui.

O que é servido a um chamador depende de quem ele é:

| Chamador | Tabelas | Ocultado |
|---|---|---|
| Um administrador, portador de `schema:read` ou a chave de serviço | todas as tabelas, incluindo views simples | colunas `.private()`, para todos |
| Qualquer outra pessoa autenticada, convidados inclusos | apenas as tabelas que uma regra permissiva alcança para suas roles (além da tabela de autenticação e views materializadas cujas `roles` eles possuam) | colunas e relações para as quais suas roles falham em `access.read`; colunas `.private()`; apenas as regras aplicáveis às suas roles; relações com tabelas que não lhes são servidas; flags de hooks; SQL puro em regras, políticas compiladas, consultas de views e índices |
| Uma credencial (chave de API, token MCP ou de plataforma) | as tabelas especificadas pelos seus escopos `data:*`, ou todas com `schema:read` | como acima, avaliado com base nos escopos que possui |
| Ninguém autenticado | nenhuma — `401` — a menos que o backend defina `schemaTables: { public: true }` | nesse caso, as tabelas com uma regra `select` pública, filtradas como para o chamador de menor privilégio: nenhuma coluna com lista `access.read`, sem SQL puro, sem políticas |

Uma pessoa mantém `metadata`, `softDelete`, `tenant`, `history` e `search` nas
tabelas que lhe são servidas. `schemaTables: { persons: "all" }` nas opções do backend
descreve todas as tabelas e regras para qualquer chamador autenticado; o
padrão é `"granted"`. Conexões MCP são avaliadas como uma
credencial, pelo mesmo serializador.

A identidade do chamador é definida pelo adaptador de autenticação do backend, o mesmo consultado
pelas rotas de dados, de modo que um backend com um [adaptador customizado](/docs/backend/auth-adapters/#the-adapter-decides-the-caller-everywhere)
é atendido aqui (e em `/api/docs` e em todas as superfícies de administração) com as roles retornadas
pelo seu adaptador; uma credencial que ele não reconhece resulta em `401`.

Uma credencial que não possui nem `schema:read` nem um escopo `data:*` recebe
`403 SCOPE_MISSING`. Um backend sem autenticação configurada responde a
toda requisição com `404 SCHEMA_UNAVAILABLE`: não há chamador para quem filtrar as informações, e
`auth.requireAuth: false` não altera isso.

As respostas contêm `ETag: W/"<schema version>-<view>"`, `Cache-Control: private,
no-cache` e o cabeçalho `x-rebase-schema`; uma requisição cujo `If-None-Match`
indique a tag atual recebe `304`. A tag muda quando o schema muda,
inclusive após uma edição de schema em tempo real.

`schemaTables` é uma opção de `initializeRebaseBackend` sem variável de ambiente correspondente:
um projeto criado a partir de scaffold tem acesso a ela por meio de ejecting.

## Storage

| Método | Caminho | Gate | Mais |
|---|---|---|---|
| `POST` | `/api/storage/upload` | session + `storageAuthorize` | [Storage](/docs/backend/storage/) |
| `GET` | `/api/storage/file/*` | session + `storageAuthorize` | [Storage](/docs/backend/storage/) |
| `DELETE` | `/api/storage/file/*` | session + `storageAuthorize` | [Storage](/docs/backend/storage/) |
| `GET` | `/api/storage/metadata/*` | session + `storageAuthorize` | [Storage](/docs/backend/storage/) |
| `POST` | `/api/storage/metadata` | session + `storageAuthorize`, por chave | [Storage](/docs/backend/storage/#storage-endpoints): metadados para até 100 objetos |
| `GET` | `/api/storage/list` | session + `storageAuthorize` | [Storage](/docs/backend/storage/) |
| `POST` | `/api/storage/folder` | session + `storageAuthorize` | [Storage](/docs/backend/storage/) |
| `GET` | `/api/storage/sources` | session | As origens de armazenamento nomeadas que este backend atende |
| `OPTIONS` | `/api/storage/tus` | none | Uploads retomáveis: as versões do TUS e extensões suportadas por este servidor |
| `POST` | `/api/storage/tus` | session + `storageAuthorize` | Uploads retomáveis: criação |
| `GET` | `/api/storage/tus/:id` | o proprietário do upload | Uploads retomáveis: offset |
| `PATCH` | `/api/storage/tus/:id` | o proprietário do upload | Uploads retomáveis: append |
| `DELETE` | `/api/storage/tus/:id` | o proprietário do upload | Uploads retomáveis: cancelamento |

Uma implantação sem armazenamento configurado responde a este prefixo com um `501` informando a
variável necessária, em vez de retornar 404 como se o recurso não existisse —
exceto `GET /api/storage/sources`, que responde `200` com uma lista vazia.

## Push

Montado apenas com `push: true` (`REBASE_PUSH=true`). Com push ativado, mas sem chaves,
todas as rotas respondem `503 PUSH_NOT_CONFIGURED`. Chaves de API e a chave de serviço são
recusadas: uma assinatura pertence ao navegador de uma pessoa.

| Método | Caminho | Gate | Mais |
|---|---|---|---|
| `GET` | `/api/push/key` | session | A chave pública VAPID — [Notificações push](/docs/backend/push-notifications/) |
| `POST` | `/api/push/subscriptions` | session | Este navegador recebe notificações para o chamador — [Notificações push](/docs/backend/push-notifications/#routes) |
| `DELETE` | `/api/push/subscriptions` | session | Interrompe o envio, no próprio navegador do chamador — [Notificações push](/docs/backend/push-notifications/#routes) |

## Functions

| Método | Caminho | Gate | Mais |
|---|---|---|---|
| `GET` | `/api/functions` | session | Os nomes das funções servidas e quantos arquivos falharam ao carregar |
| qualquer | `/api/functions/<name>` | o que a função declarar. Uma chave de API também precisa de `functions:invoke` | [Custom Functions](/docs/backend/custom-functions/) |

Uma rota por arquivo sob `backend/functions/`, de forma que os caminhos vêm do seu
projeto. `GET /api/functions` lista as funções apenas para um chamador autenticado — uma
sessão, uma chave de API ou a chave de serviço — e responde a qualquer outro com `401`: o
inventário de endpoints personalizados de uma implantação não é público.

## Meta e operações

| Método | Caminho | Gate | Mais |
|---|---|---|---|
| `GET` | `/livez` | none | Apenas liveness: verifica se este processo está em execução. Não toca o banco de dados, razão pela qual é o caminho de sonda que um contêiner deve usar — `RUNTIME_LIVENESS_PATH` |
| `GET` | `/health`, `/api/health` | none | Liveness e readiness. Reporta todas as fontes de dados configuradas, não apenas a padrão |
| `GET` | `/api/docs` | o público do endpoint de schema por padrão (401 anônimo a menos que `schemaTables.public`, 403 para uma credencial sem escopo de schema ou dados); none quando `enableSwagger` for `true`; o gate de admin quando `false` | O documento OpenAPI 3.0 das tabelas que `GET /api/schema/tables` descreve para o chamador (todas elas com `enableSwagger: true`). `404 DOCS_UNAVAILABLE` quando nenhuma autenticação estiver configurada |
| `GET` | `/api/swagger` | none | Swagger UI. Apenas quando `enableSwagger` for `true`, e nunca em produção |
| `GET` | `/api/meta/schema-version` | none | O hash de schema a partir do qual este backend foi compilado e a versão do runtime, e nada mais |
| `GET` | `/api/meta/contract` | `schema:read` | `{ schemaVersion, runtime: { version, contract }, tables }` — todas as tabelas conforme um administrador as vê, a entrada de `rebase generate-sdk --from`. `404` quando nenhuma autenticação estiver configurada |
| `GET` | `/metrics` | `REBASE_METRICS_TOKEN` quando definido | Métricas Prometheus, quando `REBASE_METRICS=true` |
| `GET` | `/metrics/history` | `REBASE_METRICS_TOKEN` quando definido | A série gravada por trás dos gráficos do Studio. `501` em um runtime sem backend |
| `GET` | `/metrics/history/batch` | `REBASE_METRICS_TOKEN` quando definido | Até 16 séries gravadas de uma vez, `?series=<a>,<b>&minutes=<n>&bucket=<1\|5\|30\|180>`, agrupadas por intervalo. Inclui requisições e erros por minuto por superfície. `501` em um runtime sem backend |

Conexões WebSocket chegam como um HTTP upgrade no mesmo servidor em vez de em um
caminho próprio — consulte [Realtime](/docs/backend/realtime/).

## Superfície MCP

Montada apenas quando `REBASE_MCP_ENABLED=true`, o que também exige
`REBASE_PUBLIC_URL` — consulte
[Configuração](/docs/getting-started/configuration/#mcp-surface). Desativada por
padrão: nenhuma `REBASE_ROLE` ativa isso automaticamente, pois concede acesso ao projeto a
softwares de terceiros e essa é uma decisão que cabe a uma pessoa tomar.

Os documentos `.well-known` ficam na **origem**, não sob `basePath`: a RFC 8414
e a RFC 9728 definem esses caminhos em relação à origem, e o cliente os busca
antes de possuir qualquer token.

| Método | Caminho | Gate | Mais |
|---|---|---|---|
| `GET` | `/.well-known/oauth-protected-resource` | none | Metadados da RFC 9728 nomeando este recurso e seu servidor de autorização. Servido também no formato com sufixo de caminho |
| `GET` | `/.well-known/oauth-authorization-server` | none | Metadados da RFC 8414: os endpoints, tipos de concessão e métodos PKCE suportados por esta implantação |
| `POST` | `/mcp` | Bearer OAuth ou uma chave de API | O endpoint do protocolo MCP. Atua **como o usuário autenticado** (ou como quem a chave representa), de modo que toda leitura e gravação está sujeita ao mesmo RLS. Os escopos `data:*` determinam quais ferramentas são oferecidas |
| `GET` | `/mcp` | Bearer OAuth ou uma chave de API | Responde `405` com `Allow: POST, DELETE`: este servidor não abre stream iniciado pelo servidor. O token é verificado primeiro, de modo que um token ausente ou expirado recebe o desafio `401` em vez disso |
| `DELETE` | `/mcp` | none | Responde `204`. O endpoint não mantém sessão, portanto não há nada para encerrar |
| `POST` | `/api/oauth/register` | rate-limited | Registro dinâmico de cliente da RFC 7591. Recusado quando `REBASE_MCP_OPEN_REGISTRATION=false` |
| `GET` | `/api/oauth/authorize` | session | A tela de consentimento para a qual o cliente é redirecionado |
| `POST` | `/api/oauth/authorize/decision` | session | A resposta da pessoa a ela — aprovar ou negar |
| `POST` | `/api/oauth/token` | credenciais do cliente + PKCE | Troca um código de autorização ou realiza o refresh |
| `POST` | `/api/oauth/revoke` | credenciais do cliente | Revogação de token da RFC 7009 |
| `GET` | `/api/oauth/grants` | session | Quais clientes este usuário aprovou |
| `DELETE` | `/api/oauth/grants/:clientId` | session | Revoga um consentimento, permitindo que uma pessoa desfaça a autorização sem precisar de um administrador |

O endpoint MCP do próprio painel administrativo não faz parte desta superfície: ele utiliza a
sessão do painel de administração, nunca um token OAuth, e é montado junto às rotas
de admin independentemente de `REBASE_MCP_ENABLED` estar definido, sob um driver que aplica
RLS a cada chamada.

| Método | Caminho | Gate | Mais |
|---|---|---|---|
| `POST` | `/api/admin/apps/mcp` | session, nunca anônimo | **Experimental.** As mesmas ferramentas de `/mcp`, para a pessoa autenticada, com `data:read`, `data:write` e `data:delete`, sob seu RLS. A `savedAppsView` do painel de administração abre [apps salvos](/docs/ai/remote-mcp/) por meio dele |

## Conteúdo relacionado

- [API REST](/docs/backend/api/) — todas as rotas de dados: filtros, ordenação, paginação, erros
- [Endpoints de autenticação](/docs/backend/auth-endpoints/) — formatos de requisição e resposta para a tabela de auth acima
- [Ambiente e Configuração](/docs/getting-started/configuration/) — as variáveis que determinam quais dessas rotas são montadas
