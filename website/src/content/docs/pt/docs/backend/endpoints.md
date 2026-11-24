---
sourceHash: 724a8d58e7df46ee
title: Índice de endpoints
sidebar_label: Índice de endpoints
description: Todas as rotas HTTP que um backend Rebase monta — dados, autenticação, armazenamento, administração, meta — com a restrição de cada uma e a página que a explica.
---

Todas as rotas que o servidor monta, em uma única tabela, com o que é necessário para alcançá-las.

Os caminhos assumem o `basePath` padrão de `/api`; `REBASE_BASE_PATH` move todos
eles juntos. `/health`, `/livez` e `/metrics` ficam fora dele de propósito,
porque um orquestrador faz a sondagem em `/health` e não deve precisar conhecer o caminho
base. `/health` *também* é montado sob ele, de modo que `/api/health` responde da mesma
forma em vez de retornar 404 justamente no momento em que alguém está verificando se o servidor
está ativo.

Um gate — `tooling/scripts/docs-verify/check-endpoint-index.mjs` — compara esta
tabela com as rotas registradas pelo código-fonte, garantindo que uma nova superfície não possa ser adicionada
sem constar aqui.

## Gates

| Gate | Significado |
|---|---|
| **none** | Não autenticado. Qualquer pessoa que consiga alcançar o host pode chamá-lo |
| **session** | Um chamador autenticado: um token de acesso ou uma chave de API com escopo para a operação |
| **`resource:action`** | Um chamador que possui esse [escopo](/docs/backend/roles-and-scopes/): um administrador, uma pessoa cujo papel o declara, uma chave de API criada com ele ou a chave de serviço |
| **RLS** | Autenticado, e então o banco de dados decide linha por linha — consulte [Regras de Segurança](/docs/collections/security-rules/) |
| **dev** | Montado apenas fora de produção |

## Dados

Gerado por tabela, de modo que os caminhos carregam seus slugs em vez de uma lista
fixa. `:slug` é o slug de uma tabela (seu nome, a menos que `defineTable` defina `slug`).

| Método | Caminho | Gate | Mais |
|---|---|---|---|
| `GET` | `/api/data/:slug` | RLS | [Consultas](/docs/backend/filtering/) |
| `POST` | `/api/data/:slug` | RLS | [REST API](/docs/backend/api/) |
| `POST` | `/api/data/:slug/query` | RLS | A listagem, parâmetros de consulta no corpo — [Consultas longas demais para uma URL](/docs/backend/vector-search/#queries-too-long-for-a-url) |
| `GET` | `/api/data/:slug/count` | RLS | [Consultas](/docs/backend/filtering/) |
| `POST` | `/api/data/:slug/count` | RLS | A contagem, parâmetros de consulta no corpo — [Consultas longas demais para uma URL](/docs/backend/vector-search/#queries-too-long-for-a-url) |
| `GET` | `/api/data/:slug/aggregate` | RLS | [REST API](/docs/backend/api/#rest-endpoints) |
| `POST` | `/api/data/:slug/refresh` | `view.roles` | Recomputa uma view materializada, nas views que são materializadas — [Views](/docs/collections/views/#materialized-views) |
| `GET` | `/api/data/:slug/:id` | RLS | [REST API](/docs/backend/api/) |
| `PATCH` | `/api/data/:slug/:id` | RLS | [REST API](/docs/backend/api/) |
| `PUT` | `/api/data/:slug/:id` | RLS | Alias descontinuado de `PATCH` — mesma escrita parcial, responde `Deprecation: true` |
| `DELETE` | `/api/data/:slug/:id` | RLS | [REST API](/docs/backend/api/) |
| `POST` | `/api/data/:slug/bulk` | RLS | Insere várias linhas, opcionalmente com upsert — [REST API](/docs/backend/api/) |
| `PATCH` | `/api/data/:slug/bulk` | RLS | Atualiza várias linhas por id — [REST API](/docs/backend/api/) |
| `POST` | `/api/data/:slug/bulk/delete` | RLS | Exclui várias linhas por id — [REST API](/docs/backend/api/) |
| `POST` | `/api/data/_batch` | RLS | Escreve entre várias tabelas em uma única transação — [Escrita via REST](/docs/backend/writes/#cross-table-batches) |
| `GET` | `/api/data/:slug/:id/history` | RLS | [Histórico de Entidades](/docs/backend/history/) |
| `POST` | `/api/data/:slug/:id/history/:historyId/revert` | RLS | [Histórico de Entidades](/docs/backend/history/) |

`:id` é a chave da linha. Em uma tabela com chave composta, é o valor de cada
coluna da chave, na ordem da chave, unidos por `:::` (cada parte codificada para URL):
uma tabela com chave em `(agency_id, id)` endereça uma linha como
`/api/data/proposals/<agency_id>:::<id>`. Um endereço com o número incorreto de
partes é recusado com `400 COMPOSITE_KEY_ADDRESS`, nomeando as colunas da chave.

Contagem e agregação são rotas próprias, registradas antes de `/:id` para
que `aggregate` não seja lido como um id de entidade. `?select=` e `?groupBy=` são
seus parâmetros, e `select` é obrigatório em `/aggregate`.

Busca textual, busca vetorial, inclusão de relações e seleção de campos *são* parâmetros
de consulta em `GET /api/data/:slug` em vez de rotas — `searchString`,
`vector_search`, `include`, `fields`. Consulte [REST API](/docs/backend/api/).

Um projeto que não declara nenhuma tabela e não faz introspecção de nenhuma serve este prefixo
como um único `404 NO_TABLES`. Consulte [Apenas backend](/docs/getting-started/headless/).

## Autenticação

| Método | Caminho | Gate | Mais |
|---|---|---|---|
| `GET` | `/api/auth/config` | none | O que a tela de login pode oferecer: registro, redefinição de senha, magic link, códigos por e-mail, login de convidado, provedores OAuth e se a configuração do primeiro administrador está pendente |
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
| `POST` | `/api/auth/change-email` | session | Envia por e-mail um link de confirmação para o novo endereço — [Alterando um endereço de e-mail](/docs/backend/auth-endpoints/#changing-an-email-address) |
| `POST` | `/api/auth/confirm-email-change` | none (um token de link) | Move a conta para o novo endereço — [Alterando um endereço de e-mail](/docs/backend/auth-endpoints/#changing-an-email-address) |
| `POST` | `/api/auth/send-verification` | session | [Autenticação](/docs/backend/authentication/) |
| `GET` | `/api/auth/verify-email` | none (um token de verificação) | [Autenticação](/docs/backend/authentication/) |
| `POST` | `/api/auth/verify-email` | none (um token de verificação e uma sessão ou a senha para mantê-la) | [Verificação de e-mail](/docs/backend/email-verification/) |
| `POST` | `/api/auth/magic-link` | none | [Autenticação](/docs/backend/authentication/) |
| `POST` | `/api/auth/magic-link/verify` | none (um token de link) | [Autenticação](/docs/backend/authentication/) |
| `POST` | `/api/auth/otp` | none | Códigos de uso único por e-mail |
| `POST` | `/api/auth/otp/verify` | none (um código) | Códigos de uso único por e-mail |
| `POST` | `/api/auth/device` | none | [Login por dispositivo](/docs/backend/device-sign-in/). Desativado a menos que o backend o habilite |
| `POST` | `/api/auth/device/token` | none (um código de dispositivo) | [Login por dispositivo](/docs/backend/device-sign-in/): o polling do dispositivo |
| `GET` | `/api/auth/device/:userCode` | session | [Login por dispositivo](/docs/backend/device-sign-in/): o que a página de aprovação exibe |
| `POST` | `/api/auth/device/approve` | session (`aal2` com um segundo fator) | [Login por dispositivo](/docs/backend/device-sign-in/) |
| `POST` | `/api/auth/device/deny` | session | [Login por dispositivo](/docs/backend/device-sign-in/) |
| `POST` | `/api/auth/anonymous` | none | Sessões de convidados. Desativado a menos que `ALLOW_ANONYMOUS` |
| `POST` | `/api/auth/anonymous/link` | session (um convidado) | Converte um convidado em uma conta |
| `POST` | `/api/auth/find-user` | session | Desativado a menos que `AUTH_ALLOW_USER_LOOKUP` — é uma superfície de enumeração |
| `POST` | `/api/auth/:provider` | none | Um por provedor OAuth/OIDC configurado |
| `POST` | `/api/auth/link/:provider` | session | Vincula um provedor à conta autenticada |
| `POST` | `/api/auth/mfa/enroll` | session | [MFA](/docs/backend/auth-endpoints/#multi-factor-authentication-totp) |
| `POST` | `/api/auth/mfa/verify` | session | [MFA](/docs/backend/auth-endpoints/#multi-factor-authentication-totp) |
| `GET` | `/api/auth/mfa/factors` | session | [MFA](/docs/backend/auth-endpoints/#multi-factor-authentication-totp) |
| `DELETE` | `/api/auth/mfa/unenroll` | session | [MFA](/docs/backend/auth-endpoints/#multi-factor-authentication-totp) |
| `POST` | `/api/auth/mfa/recovery-codes` | session (`aal2`) | [MFA](/docs/backend/auth-endpoints/#multi-factor-authentication-totp) |
| `POST` | `/api/auth/mfa/challenge` | none (um login em andamento) | [MFA](/docs/backend/auth-endpoints/#multi-factor-authentication-totp) |
| `POST` | `/api/auth/mfa/challenge/verify` | none (um id de desafio) | [MFA](/docs/backend/auth-endpoints/#multi-factor-authentication-totp) |
| `GET` | `/api/auth/scopes` | session | Todos os escopos que este backend conhece e aqueles que o chamador possui — [Papéis e escopos](/docs/backend/roles-and-scopes/) |
| `GET` | `/api/auth/keys` | session (uma conta) | As próprias [chaves pessoais](/docs/backend/api-keys/#personal-keys) do chamador |
| `POST` | `/api/auth/keys` | session (uma conta) | A chave em texto puro é retornada uma única vez. `403 PERSONAL_KEYS_DISABLED` a menos que a tabela de autenticação defina `auth.personalKeys` |
| `DELETE` | `/api/auth/keys/:id` | session (uma conta) | Revoga uma das chaves do próprio chamador |
| `GET` | `/.well-known/jwks.json` | none | O JWKS público, quando a [assinatura assimétrica](/docs/backend/auth-endpoints/#asymmetric-tokens-and-jwks) está configurada |

## Administração

Tudo sob `/api/admin` precisa de um escopo do plano administrativo, e cada
superfície nomeia o seu: `users:read` lista contas, `cron:write` dispara uma tarefa.
Um administrador possui todos eles, assim como a chave de serviço. Uma pessoa possui aqueles
declarados por seus papéis, e uma chave de API aqueles com os quais foi criada. Uma chave com escopo restrito a
uma tabela não acessa nada disso. Consulte [Papéis e escopos](/docs/backend/roles-and-scopes/).

| Método | Caminho | Gate | Mais |
|---|---|---|---|
| `POST` | `/api/admin/bootstrap` | none, e apenas enquanto nenhum administrador existir | Recusado em produção — consulte [Bootstrap do Primeiro Usuário](/docs/backend/authentication/#first-user-bootstrap) |
| `GET` | `/api/admin/users` | `users:read` | Gerenciamento de usuários |
| `POST` | `/api/admin/users` | `users:write` | Gerenciamento de usuários. Papéis além dos do próprio chamador são recusados |
| `POST` | `/api/admin/users/import` | `users:write` | [Importa contas](/docs/backend/auth-endpoints/#importing-accounts) mantendo seus IDs: sem e-mail, sem senha a menos que seu hash bcrypt seja fornecido, ID ou e-mail já ocupado é ignorado. No máximo 100 por requisição. Papéis além dos do próprio chamador são recusados |
| `GET` | `/api/admin/users/pick` | `users:read`, ou acesso de escrita a uma tabela com uma coluna `.userId()` | A [leitura do seletor de usuários](/docs/backend/auth-endpoints/): apenas id, nome, e-mail e avatar. Uma tabela cujas regras de escrita são SQL bruto não conta |
| `GET` | `/api/admin/users/:uid` | `users:read` | Gerenciamento de usuários |
| `PUT` | `/api/admin/users/:uid` | `users:write` | Recusado para uma conta que possui mais privilégios que o chamador |
| `DELETE` | `/api/admin/users/:uid` | `users:write` | Recusado para uma conta que possui mais privilégios que o chamador |
| `POST` | `/api/admin/users/:uid/reset-password` | `users:write` | Emite uma senha temporária |
| `DELETE` | `/api/admin/users/:uid/mfa` | `users:write` | Remove os segundos fatores e códigos de recuperação da conta, encerra suas sessões |
| `GET` | `/api/admin/guests` | `users:read` | Convidados, ordenados pelos vistos há mais tempo primeiro. `?lastSeenBefore=` os restringe ao que a exclusão abaixo afetaria, e `total` os contabiliza |
| `DELETE` | `/api/admin/guests` | `users:write` | Exclui um lote dos convidados vistos pela última vez antes de `?lastSeenBefore=`, que é obrigatório. Responde `{ deleted, skipped, remaining }`. Repita enquanto `remaining` não for 0, com `?offset=` definido para quantos foram ignorados. Contas não podem ser afetadas |
| `DELETE` | `/api/admin/guests/:uid` | `users:write` | Exclui um convidado. Uma conta é recusada com `NOT_ANONYMOUS` |
| `GET` | `/api/admin/roles` | `users:read` | `admin` e os papéis que o projeto declara, com seus escopos |
| `GET` | `/api/admin/api-keys` | `keys:read` | [Chaves de API](/docs/backend/api-keys/). Nunca uma chave de API |
| `POST` | `/api/admin/api-keys` | `keys:write` | A chave em texto puro é retornada uma única vez, na criação |
| `GET` | `/api/admin/api-keys/:id` | `keys:read` | [Chaves de API](/docs/backend/api-keys/) |
| `PUT` | `/api/admin/api-keys/:id` | `keys:write` | [Chaves de API](/docs/backend/api-keys/) |
| `DELETE` | `/api/admin/api-keys/:id` | `keys:write` | [Chaves de API](/docs/backend/api-keys/) |
| `GET` | `/api/admin/cron` | `cron:read` | [Tarefas Cron](/docs/backend/cron-jobs/) |
| `GET` | `/api/admin/cron/:id` | `cron:read` | [Tarefas Cron](/docs/backend/cron-jobs/) |
| `PUT` | `/api/admin/cron/:id` | `cron:write` | Habilita ou desabilita uma tarefa |
| `GET` | `/api/admin/cron/:id/logs` | `cron:read` | [Tarefas Cron](/docs/backend/cron-jobs/) |
| `POST` | `/api/admin/cron/:id/trigger` | `cron:write` | Executa uma tarefa agora. `?async=1` responde `202` assim que for iniciada — [API de Tarefas Cron](/docs/backend/cron-jobs-api/#example-trigger-a-job-manually) |
| `GET` | `/api/admin/backups` | `backups:read` | Inventário de backups |
| `GET` | `/api/admin/backups/download` | `backups:read` | Faz streaming de um backup. Com `?token=` a partir de um link de download, nenhum cabeçalho é necessário, apenas para esse backup |
| `POST` | `/api/admin/backups/download-url` | `backups:read` | Um link para um backup, `{ key }` → `{ url, token, expiresIn }`, válido por 60 segundos — [Backups](/docs/deployment/backups/#download-a-backup) |
| `POST` | `/api/admin/storage/orphans/scans` | `database:write` | Inicia uma verificação em segundo plano para arquivos armazenados sem referência em linhas, `?storageId=&olderThanHours=`. Responde `202` com o registro da verificação: `id`, `status` (`queued`) e `runner` (`worker` quando for uma tarefa `storage.orphans` na fila de tarefas, `in-process` quando o próprio servidor a executa). Seu registro é gravado na origem, sob o prefixo reservado `_rebase/maintenance/` |
| `GET` | `/api/admin/storage/orphans/scans/:id` | `database:read` | O registro da verificação, `?storageId=`. Enquanto executa: `progress` (`filesScanned`, `rowsScanned`, `collectionsScanned` de `collectionsTotal`, `unscanned`). Uma vez `completed`: `result`, o relatório que o antigo `GET /orphans` respondia. Uma execução que parou de reportar por 10 minutos é respondida como `failed`. `404 STORAGE_SCAN_NOT_FOUND` quando a fonte não contiver tal verificação |
| `DELETE` | `/api/admin/storage/orphans?scan=:id` | `database:write` | Exclui em segundo plano os órfãos de uma verificação concluída, `202`. Cada um é verificado novamente contra cada linha e entrada de histórico, e consultado novamente logo antes de ser excluído. O resultado é a `deletion` do registro de verificação. `409` com `STORAGE_SCAN_NOT_COMPLETE`, `STORAGE_SCAN_INCOMPLETE`, `STORAGE_SCAN_EXPIRED` ou `STORAGE_SCAN_DELETION_STARTED` |
| `GET` | `/api/admin/storage/orphans` | `database:read` | Descontinuado: a verificação dentro da requisição, `?storageId=&olderThanHours=`. Responde com `Deprecation: true`. Use `POST /orphans/scans` |
| `DELETE` | `/api/admin/storage/orphans` | `database:write` | Descontinuado, sem `?scan=`: verifica novamente e exclui dentro da requisição. `409 STORAGE_SCAN_INCOMPLETE` quando uma tabela não pôde ser lida |
| `POST` | `/api/admin/storage/move` | `database:write` | Copia uma pasta para outra origem sob as mesmas chaves, uma página por chamada — o que `rebase storage move` envia; `400 STORAGE_SAME_LOCATION` para `deleteSource` entre duas origens que armazenam no mesmo local |
| `POST` | `/api/admin/storage/move/verify` | `database:write` | Lista a origem novamente após uma movimentação, com o mesmo corpo, uma página por chamada: `{ checked, notMoved: [{ key, reason }], cursor? }` — cada arquivo ainda presente na origem com `deleteSource`, cada arquivo do qual o destino não possui cópia sem ele. O comando `rebase storage move` consulta esta rota quando a movimentação é concluída |
| `GET` | `/api/admin/logs` | `logs:read` | O buffer de logs recentes |
| `GET` | `/api/admin/logs/latest` | `logs:read` | As entradas mais recentes |
| `GET` | `/api/admin/logs/stream` | `logs:read` | Server-sent events |
| `GET` | `/api/admin/rls-audit` | `schema:read` | O resultado mais recente da auditoria agendada |
| `GET` | `/api/admin/rls-simulator/options` | `schema:read` | Papéis, papéis de regras de usuários e chaves de serviço ativas que um administrador pode simular |
| `POST` | `/api/admin/rls-simulator/preview` | `schema:read` | Cada tabela conforme `{ role?, userId?, apiKeyId? }` a acessa: linhas visíveis em relação às do chamador, ocultadas por escopo ou RLS, campos mascarados. Somente sessão de administrador |
| `POST` | `/api/admin/sql/csv` | `database:write` | Faz streaming de todo o resultado de uma consulta somente leitura como CSV — "Download full result as CSV" do [Studio](/docs/studio/) |
| `GET` | `/api/admin/branches/:name/diff` | `database:write` | O que uma [branch](/docs/backend/branching/#reviewing-and-merging-a-branch) alterou: schema, políticas e linhas, `?sampleLimit=&schemas=&maxRowsPerTable=` |
| `POST` | `/api/admin/branches/:name/merge` | `database:write` | Escreve as linhas da branch na sua branch pai, `{ expectedFingerprint, onConflict?, skipBlocked? }`; `409` quando qualquer um dos lados foi alterado desde o diff, ou quando houver conflito de linhas |
| `GET` | `/api/admin/schema/status` | `schema:read` | [Edição de schema ao vivo](/docs/backend/live-schema-editing/) |
| `POST` | `/api/admin/schema/plan` | `schema:read` | Planeja uma alteração; nunca aplica uma |
| `POST` | `/api/admin/schema/apply` | `schema:write` | Somente uma pessoa, a menos que `REBASE_LIVE_SCHEMA_ALLOW_MACHINE_APPLY` |
| `POST` | `/api/admin/schema/reconcile/plan` | `schema:read` | Planeja flexibilizar `NOT NULL` e remover as colunas não declaradas nomeadas em `drop`, para [reconciliação de schema](/docs/cli/schema/#rebase-schema-reconcile); nunca aplica |
| `POST` | `/api/admin/schema/reconcile/apply` | `schema:write` | Aplica um plano de reconciliação, somente se seu `digest` for o `confirm` enviado |
| `POST` | `/api/admin/schema/reload` | `schema:write` | Faz uma nova introspecção do PostgreSQL e recarrega REST, Realtime, OpenAPI, políticas de armazenamento, webhooks, papéis e tarefas agendadas em tempo de execução sem reiniciar |
| `GET` | `/api/admin/db/tables` | `database:read` | Lista tabelas de usuário do PostgreSQL com colunas, índices, políticas RLS e sobreposições `rebase.table_meta` |
| `POST` | `/api/admin/db/tables` | `database:write` | Cria uma tabela PostgreSQL com políticas RLS iniciais opcionais e metadados (`dryRun: true` pré-visualiza o SQL), depois recarrega ao vivo |
| `PATCH` | `/api/admin/db/tables/:table` | `database:write` | Renomeia uma tabela, alterna o Row Level Security (`rlsEnabled`) ou atualiza as configurações de sobreposição de API de `rebase.table_meta` (`meta`), depois recarrega ao vivo |
| `DELETE` | `/api/admin/db/tables/:table` | `database:write` | Remove uma tabela PostgreSQL (requer `{ confirm: "<table>" }`, a menos que `dryRun: true`) |
| `POST` | `/api/admin/db/tables/:table/columns` | `database:write` | Adiciona uma coluna a uma tabela PostgreSQL e recarrega ao vivo |
| `PATCH` | `/api/admin/db/tables/:table/columns/:column` | `database:write` | Altera uma coluna (renomear, tipo, nulabilidade, padrão) e recarrega ao vivo |
| `DELETE` | `/api/admin/db/tables/:table/columns/:column` | `database:write` | Remove uma coluna (requer `{ confirm: "<column>" }`, a menos que `dryRun: true`) |
| `POST` | `/api/admin/db/tables/:table/indexes` | `database:write` | Cria um índice em uma tabela PostgreSQL |
| `DELETE` | `/api/admin/db/tables/:table/indexes/:index` | `database:write` | Remove um índice de uma tabela PostgreSQL |
| `POST` | `/api/admin/db/tables/:table/policies` | `database:write` | Cria uma política RLS PostgreSQL em uma tabela e recarrega ao vivo |
| `DELETE` | `/api/admin/db/tables/:table/policies/:policy` | `database:write` | Remove uma política RLS PostgreSQL de uma tabela e recarrega ao vivo |
| `GET` | `/api/admin/storage/policies` | `database:read` | Lista políticas de armazenamento declarativas zero-code de `rebase.storage_policies` |
| `POST` | `/api/admin/storage/policies` | `database:write` | Cria uma política declarativa de acesso ao armazenamento |
| `PATCH` | `/api/admin/storage/policies/:id` | `database:write` | Atualiza uma política declarativa de acesso ao armazenamento |
| `DELETE` | `/api/admin/storage/policies/:id` | `database:write` | Exclui uma política declarativa de acesso ao armazenamento |
| `GET` | `/api/admin/webhooks` | `database:read` | Lista webhooks de banco de dados zero-code de `rebase.webhooks` |
| `POST` | `/api/admin/webhooks` | `database:write` | Cria um webhook de banco de dados |
| `PATCH` | `/api/admin/webhooks/:id` | `database:write` | Atualiza um webhook de banco de dados |
| `DELETE` | `/api/admin/webhooks/:id` | `database:write` | Exclui um webhook de banco de dados |
| `POST` | `/api/admin/webhooks/:id/test` | `database:write` | Envia um disparo de teste real para um endpoint de webhook configurado |
| `GET` | `/api/admin/roles` | `users:read` | Lista papéis e escopos RBAC zero-code de `rebase.roles` |
| `POST` | `/api/admin/roles` | `users:write` | Cria ou atualiza um papel RBAC zero-code |
| `PUT` | `/api/admin/roles/:name` | `users:write` | Atualiza um papel RBAC zero-code |
| `DELETE` | `/api/admin/roles/:name` | `users:write` | Exclui um papel RBAC zero-code |
| `GET` | `/api/admin/cron/jobs` | `cron:read` | Lista tarefas agendadas SQL/HTTP zero-code de `rebase.cron_jobs` |
| `POST` | `/api/admin/cron/jobs` | `cron:write` | Cria uma tarefa cron agendada SQL ou HTTP zero-code. Uma tarefa SQL executa sua instrução usando a própria conexão do servidor, portanto também requer `database:write` |
| `PATCH` | `/api/admin/cron/jobs/:id` | `cron:write` | Atualiza uma tarefa cron agendada zero-code; uma tarefa SQL, ou uma prestes a se tornar uma, também requer `database:write` |
| `DELETE` | `/api/admin/cron/jobs/:id` | `cron:write` | Exclui uma tarefa cron agendada zero-code |
| `GET` | `/api/admin/schema-editor/status` | `schema:read` | Se o editor está disponível, e o motivo quando não estiver |
| `GET` | `/api/admin/schema-editor/tables` | `schema:read` | Cada tabela exportada por `backend/schema/index.ts` conforme o editor a lê, com o que é editado no código (somente leitura) e o motivo — [Edição de schema ao vivo](/docs/backend/live-schema-editing/#the-edits-tablepatch) |
| `POST` | `/api/admin/schema-editor/preview` | `schema:write` | `{ patches: TablePatch[] }`: os arquivos que a edição escreveria, compilados; não escreve nada |
| `POST` | `/api/admin/schema-editor/apply` | `schema:write` | A mesma edição, gravada em `backend/schema`; o banco de dados não é tocado |
| `GET` | `/api/admin/schema-editor/unmapped-tables` | `schema:read` | Tabelas que o banco de dados possui e `backend/schema` não declara: `{ tables: [{ schema, table, rlsEnabled, policies, unimportable? }] }` |
| `GET` | `/api/admin/schema-editor/unmapped-tables/:schema/:table` | `schema:read` | Uma delas descrita: `{ table: { …, descriptor, rlsRaised?, notes } }`, para "Import an existing table". `404` quando desconhecida ou já declarada, `400 SCHEMA_EDIT_REFUSED` se não houver chave primária |
| `GET` | `/api/admin/ui-config` | session | As preferências de UI do workspace por tabela, as do próprio chamador, e se o chamador pode gravar as do workspace — consulte [Personalizando uma tabela](/docs/frontend/customize-table/#customizations-ui-configjson-and-preferences) |
| `PUT` | `/api/admin/ui-config/workspace/:slug` | `schema:write` | Faz o merge de um delta de `UiTablePreferences` nas preferências de workspace de uma tabela (`replace` substitui). Gravado em `frontend/src/cms/ui-config.json` onde o servidor tiver permissão para gravar no código-fonte do projeto; caso contrário, em `rebase.ui_preferences` |
| `DELETE` | `/api/admin/ui-config/workspace/:slug` | `schema:write` | Remove as preferências de workspace de uma tabela |
| `PUT` | `/api/admin/ui-config/user/:slug` | session (uma pessoa) | As preferências do próprio chamador para uma tabela. Uma chave de API não tem nenhuma: `403 UI_PREFERENCES_NEED_A_PERSON` |
| `DELETE` | `/api/admin/ui-config/user/:slug` | session (uma pessoa) | Remove as preferências do próprio chamador para uma tabela |
| `GET` | `/api/admin/dev/emails` | dev + `users:write` | E-mails que o transporte de desenvolvimento capturou em vez de enviar |
| `DELETE` | `/api/admin/dev/emails` | dev + `users:write` | Esvazia a caixa de correio capturada |

`/api/admin/cron`, `/api/admin/logs` e `/api/admin/schema-editor` também são
servidos em seus caminhos anteriores à versão 0.17, sem o segmento `/admin`. Esses aliases
existem para projetos que ainda não migraram; escreva código novo utilizando o caminho canônico.

## Schema

| Método | Caminho | Gate | Mais |
|---|---|---|---|
| `GET` | `/api/schema/tables` | session, ou uma credencial com `schema:read` ou um escopo `data:*` | Todas as tabelas que este backend serve, como um array JSON de descritores redigidos para o chamador |
| `GET` | `/api/schema/tables/:slug` | como acima | Um descritor. `404 TABLE_NOT_FOUND` quando essa tabela não é servida para este chamador |

Os descritores são a base a partir da qual o CMS renderiza seus padrões, o Studio
desenha o visualizador de schema e o editor de RLS, e os aplicativos MCP
renderizam tabelas e formulários. Eles contêm colunas com seus tipos Postgres,
nulabilidade, regras de validação e de armazenamento, relações por slug e a
postura de segurança em nível de linha (row-level security). O código dos hooks nunca sai do servidor: um descritor
apenas informa quais hooks uma tabela possui.

O que é servido a um chamador depende de quem ele é:

| Chamador | Tabelas | Redigido |
|---|---|---|
| Um administrador, portador de `schema:read` ou a chave de serviço | todas as tabelas, incluindo views simples | colunas `.private()`, para todos |
| Qualquer outra pessoa autenticada, convidados incluídos | apenas as tabelas que uma regra permissiva alcança para seus papéis (além da tabela de autenticação e das views materializadas cujos `roles` eles possuam) | colunas e relações para as quais seus papéis não passam em `access.read`; colunas `.private()`; apenas as regras que podem se aplicar aos seus papéis; relações para tabelas que não lhes são servidas; flags de hooks; SQL bruto em regras, políticas compiladas, consultas de views e índices |
| Uma credencial (chave de API, token MCP ou de plataforma) | as tabelas nomeadas por seus escopos `data:*`, ou todas elas com `schema:read` | como acima, avaliado com base nos escopos que possui |
| Ninguém autenticado | nenhuma — `401` — a menos que o backend defina `schemaTables: { public: true }` | nesse caso, as tabelas com uma regra `select` pública, redigidas como para o chamador de menor privilégio: nenhuma coluna com lista `access.read`, nenhum SQL bruto, nenhuma política |

Uma pessoa mantém `metadata`, `softDelete`, `tenant`, `history` e `search` nas
tabelas que lhe são servidas. `schemaTables: { persons: "all" }` nas opções do backend
descreve todas as tabelas e regras para todos os chamadores autenticados; o
padrão é `"granted"`. Conexões MCP são avaliadas como uma
credencial, pelo mesmo serializador.

A identidade do chamador provém do adaptador de autenticação do backend, o mesmo consultado pelas
rotas de dados, de modo que um backend com um [adaptador personalizado](/docs/backend/auth-adapters/#the-adapter-decides-the-caller-everywhere)
é atendido aqui (e em `/api/docs` e em cada superfície de administração) com os papéis que seu
adaptador retorna; uma credencial que ele não reconhece resulta em `401`.

Uma credencial que não possua `schema:read` nem um escopo `data:*` recebe
`403 SCOPE_MISSING`. Um backend sem autenticação configurada responde a
todas as requisições com `404 SCHEMA_UNAVAILABLE`: não há chamador para o qual redigir, e
`auth.requireAuth: false` não altera isso.

As respostas incluem `ETag: W/"<schema version>-<view>"`, `Cache-Control: private,
no-cache` e o cabeçalho `x-rebase-schema`; uma requisição cujo `If-None-Match`
aponte para a tag atual recebe `304`. A tag muda quando o schema muda,
inclusive após uma edição de schema ao vivo.

`schemaTables` é uma opção de `initializeRebaseBackend` sem variável de ambiente
correspondente: um projeto gerado por scaffolding a acessa ejetando a configuração.

## Armazenamento

| Método | Caminho | Gate | Mais |
|---|---|---|---|
| `POST` | `/api/storage/upload` | session + `storageAuthorize` | [Armazenamento](/docs/backend/storage/) |
| `GET` | `/api/storage/file/*` | session + `storageAuthorize` | [Armazenamento](/docs/backend/storage/) |
| `DELETE` | `/api/storage/file/*` | session + `storageAuthorize` | [Armazenamento](/docs/backend/storage/) |
| `GET` | `/api/storage/metadata/*` | session + `storageAuthorize` | [Armazenamento](/docs/backend/storage/) |
| `POST` | `/api/storage/metadata` | session + `storageAuthorize`, por chave | [Armazenamento](/docs/backend/storage/#storage-endpoints): metadados para até 100 objetos |
| `GET` | `/api/storage/list` | session + `storageAuthorize` | [Armazenamento](/docs/backend/storage/) |
| `POST` | `/api/storage/folder` | session + `storageAuthorize` | [Armazenamento](/docs/backend/storage/) |
| `GET` | `/api/storage/sources` | session | As fontes de armazenamento nomeadas que este backend atende |
| `OPTIONS` | `/api/storage/tus` | none | Uploads retomáveis: as versões e extensões TUS suportadas por este servidor |
| `POST` | `/api/storage/tus` | session + `storageAuthorize` | Uploads retomáveis: criação |
| `GET` | `/api/storage/tus/:id` | o proprietário do upload | Uploads retomáveis: offset |
| `PATCH` | `/api/storage/tus/:id` | o proprietário do upload | Uploads retomáveis: append |
| `DELETE` | `/api/storage/tus/:id` | o proprietário do upload | Uploads retomáveis: cancelamento |

Um deployment sem armazenamento configurado responde a este prefixo com `501` indicando a
variável necessária, em vez de retornar 404 como se o recurso não existisse —
com exceção de `GET /api/storage/sources`, que responde `200` com uma lista vazia.

## Push

Montado apenas com `push: true` (`REBASE_PUSH=true`). Com o push ativado mas sem chaves configuradas,
todas as rotas respondem `503 PUSH_NOT_CONFIGURED`. Chaves de API e a chave de serviço são
recusadas: uma assinatura pertence ao navegador de uma pessoa.

| Método | Caminho | Gate | Mais |
|---|---|---|---|
| `GET` | `/api/push/key` | session | A chave pública VAPID — [Notificações push](/docs/backend/push-notifications/) |
| `POST` | `/api/push/subscriptions` | session | Este navegador recebe notificações para o chamador — [Notificações push](/docs/backend/push-notifications/#routes) |
| `DELETE` | `/api/push/subscriptions` | session | Interrompe-as, no próprio navegador do chamador — [Notificações push](/docs/backend/push-notifications/#routes) |

## Funções

| Método | Caminho | Gate | Mais |
|---|---|---|---|
| `GET` | `/api/functions` | session | Os nomes das funções servidas e quantos arquivos falharam ao carregar |
| qualquer | `/api/functions/<name>` | o que a função declarar. Uma chave de API também precisa de `functions:invoke` | [Funções personalizadas](/docs/backend/custom-functions/) |

Uma rota por arquivo em `backend/functions/`, portanto os caminhos vêm do seu
projeto. `GET /api/functions` lista-os apenas para um chamador autenticado — uma
sessão, uma chave de API ou a chave de serviço — e responde a qualquer outro com `401`: o
inventário de endpoints personalizados de uma implantação não é público.

## RPC

| Método | Caminho | Gate | Mais |
|---|---|---|---|
| `POST` | `/api/rpc/<name>` | o `access` do RPC: none para `"public"` (com rate limit), session para `"authenticated"`; depois RLS dentro da função. Uma chave de API também precisa de `data:read` (`data:write` para um RPC com `write: true`) | [Funções SQL como RPC](/docs/backend/rpc/) |

Uma rota por `defineRpc` exportado de `backend/schema/index.ts`, portanto os
caminhos vêm do seu projeto. Um nome que ninguém declarou responde `404
RPC_NOT_FOUND`, mesmo quando o banco de dados possui uma função com esse nome.

## Meta e operações

| Método | Caminho | Gate | Mais |
|---|---|---|---|
| `GET` | `/livez` | none | Apenas vivacidade (liveness): este processo está em execução. Não acessa o banco de dados, motivo pelo qual é o caminho de sondagem que um contêiner deve usar — `RUNTIME_LIVENESS_PATH` |
| `GET` | `/health`, `/api/health` | none | Vivacidade e prontidão (liveness e readiness). Reporta todas as fontes de dados configuradas, não apenas a padrão |
| `GET` | `/api/docs` | por padrão, o mesmo público do endpoint de schema (401 anônimo a menos que `schemaTables.public`, 403 para uma credencial sem escopo de schema ou dados); none quando `enableSwagger` for `true`; o gate de admin quando `false` | O documento OpenAPI 3.0 das tabelas que `GET /api/schema/tables` descreve para o chamador (todas elas com `enableSwagger: true`). `404 DOCS_UNAVAILABLE` quando nenhuma autenticação estiver configurada |
| `GET` | `/api/swagger` | none | Swagger UI. Somente quando `enableSwagger` for `true`, e nunca em produção |
| `GET` | `/api/meta/schema-version` | none | O hash do schema a partir do qual este backend foi compilado e a versão do runtime, e nada mais |
| `GET` | `/api/meta/contract` | `schema:read` | `{ schemaVersion, runtime: { version, contract }, tables }` — todas as tabelas conforme um administrador as vê, a entrada de `rebase generate-sdk --from`. `404` quando nenhuma autenticação estiver configurada |
| `GET` | `/metrics` | `REBASE_METRICS_TOKEN` quando definido | Métricas Prometheus, quando `REBASE_METRICS=true` |
| `GET` | `/metrics/history` | `REBASE_METRICS_TOKEN` quando definido | As séries gravadas por trás dos gráficos do Studio. `501` em um runtime sem backend |
| `GET` | `/metrics/history/batch` | `REBASE_METRICS_TOKEN` quando definido | Até 16 séries gravadas por vez, `?series=<a>,<b>&minutes=<n>&bucket=<1\|5\|30\|180>`, agrupadas em buckets. Inclui requisições por minuto e erros por superfície. `501` em um runtime sem backend |

As conexões WebSocket chegam como um upgrade HTTP no mesmo servidor, em vez de em
um caminho próprio — consulte [Realtime](/docs/backend/realtime/).

## Superfície MCP

Montado apenas quando `REBASE_MCP_ENABLED=true`, o que também requer
`REBASE_PUBLIC_URL` — consulte
[Configuração](/docs/getting-started/configuration/#mcp-surface). Desativado por
padrão: nenhum `REBASE_ROLE` ativa isso, pois concede acesso ao projeto a
softwares de terceiros e essa é uma decisão que deve ser tomada por uma pessoa.

Os documentos `.well-known` ficam na **origem**, não sob `basePath`: a RFC 8414
e a RFC 9728 definem esses caminhos relativos à origem, e o cliente os busca
antes de possuir qualquer token.

| Método | Caminho | Gate | Mais |
|---|---|---|---|
| `GET` | `/.well-known/oauth-protected-resource` | none | Metadados da RFC 9728 identificando este recurso e seu servidor de autorização. Também servido no formato com sufixo de caminho |
| `GET` | `/.well-known/oauth-authorization-server` | none | Metadados da RFC 8414: os endpoints, grant types e métodos PKCE suportados por este deployment |
| `POST` | `/mcp` | OAuth bearer, ou uma chave de API | O endpoint do protocolo MCP. Atua **como o usuário conectado** (ou como quem a chave representa), portanto cada leitura e escrita está sujeita ao mesmo RLS. Os escopos `data:*` decidem quais ferramentas são oferecidas |
| `GET` | `/mcp` | OAuth bearer, ou uma chave de API | Responde `405` com `Allow: POST, DELETE`: este servidor não abre stream iniciado pelo servidor. O token é verificado primeiro, portanto um token ausente ou expirado recebe o desafio `401` |
| `DELETE` | `/mcp` | none | Responde `204`. O endpoint não mantém sessão, portanto não há nada para encerrar |
| `POST` | `/api/oauth/register` | rate-limited | Registro dinâmico de clientes da RFC 7591. Recusado quando `REBASE_MCP_OPEN_REGISTRATION=false` |
| `GET` | `/api/oauth/authorize` | session | A tela de consentimento para a qual o cliente é redirecionado |
| `POST` | `/api/oauth/authorize/decision` | session | A resposta da pessoa para ela — aprovar ou recusar |
| `POST` | `/api/oauth/token` | client credentials + PKCE | Troca um código de autorização ou faz refresh |
| `POST` | `/api/oauth/revoke` | client credentials | Revogação de token da RFC 7009 |
| `GET` | `/api/oauth/grants` | session | Quais clientes este usuário aprovou |
| `DELETE` | `/api/oauth/grants/:clientId` | session | Revoga um deles, para que a pessoa possa desfazer um consentimento sem a intervenção de um administrador |

O endpoint MCP do próprio painel de administração não faz parte desta superfície: ele utiliza
a sessão do painel de administração, nunca um token OAuth, e é montado junto com as rotas
de admin quer `REBASE_MCP_ENABLED` esteja definido ou não, em um driver que aplica o RLS
a cada chamada.

| Método | Caminho | Gate | Mais |
|---|---|---|---|
| `POST` | `/api/admin/apps/mcp` | session, nunca anônimo | **Experimental.** As mesmas ferramentas que `/mcp`, para a pessoa autenticada, com `data:read`, `data:write` e `data:delete`, sob seu RLS. O `savedAppsView` do painel de administração abre [aplicativos salvos](/docs/ai/remote-mcp/) por meio dele |

## Relacionados

- [REST API](/docs/backend/api/) — as rotas de dados em detalhes: filtros, ordenação, paginação, erros
- [Endpoints de autenticação](/docs/backend/auth-endpoints/) — formatos de requisição e resposta para a tabela de autenticação acima
- [Ambiente e Configuração](/docs/getting-started/configuration/) — as variáveis que decidem quais rotas são montadas
