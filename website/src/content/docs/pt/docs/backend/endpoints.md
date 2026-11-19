---
sourceHash: eef9ab9f670101c8
title: Índice de endpoints
sidebar_label: Índice de endpoints
description: Todas as rotas HTTP que um backend Rebase disponibiliza — dados, autenticação, armazenamento, administração, meta — com a restrição de acesso em cada uma e a página que a explica.
---

Todas as rotas que o servidor disponibiliza, em uma única tabela, com o que é necessário para acessá-las.

Os caminhos assumem o `basePath` padrão de `/api`; `REBASE_BASE_PATH` move todos
eles juntos. `/health`, `/livez` e `/metrics` ficam fora dele propositalmente,
porque um orquestrador faz sondagens em `/health` e não deveria precisar saber o caminho
base. `/health` *também* é montado sob ele, de modo que `/api/health` responda da mesma
forma em vez de retornar 404 justamente no momento em que alguém está verificando se o servidor
está ativo.

Uma validação de acesso (gate) — `tooling/scripts/docs-verify/check-endpoint-index.mjs` — compara esta
tabela com as rotas que o código-fonte registra, garantindo que uma nova superfície não possa ser adicionada
sem constar aqui.

## Restrições de acesso (Gates)

| Gate | Significado |
|---|---|
| **none** | Não autenticado. Qualquer pessoa que consiga alcançar o host pode chamá-lo |
| **session** | Um chamador autenticado: um token de acesso ou uma chave de API com escopo para a operação |
| **`resource:action`** | Um chamador que possui esse [escopo](/docs/backend/roles-and-scopes/): um administrador, uma pessoa cujo papel o declare, uma chave de API criada com ele ou a chave de serviço |
| **RLS** | Autenticado e, em seguida, o banco de dados decide linha por linha — consulte [Regras de segurança](/docs/collections/security-rules/) |
| **dev** | Disponibilizado apenas fora de produção |

## Dados

Gerado por tabela, portanto os caminhos carregam seus slugs em vez de uma
lista fixa. `:slug` é o slug de uma tabela (seu nome, a menos que `defineTable` defina `slug`).

| Método | Caminho | Gate | Mais informações |
|---|---|---|---|
| `GET` | `/api/data/:slug` | RLS | [Consultas](/docs/backend/filtering/) |
| `POST` | `/api/data/:slug` | RLS | [API REST](/docs/backend/api/) |
| `POST` | `/api/data/:slug/query` | RLS | A listagem, com parâmetros de consulta no corpo — [Consultas longas demais para uma URL](/docs/backend/vector-search/#queries-too-long-for-a-url) |
| `GET` | `/api/data/:slug/count` | RLS | [Consultas](/docs/backend/filtering/) |
| `POST` | `/api/data/:slug/count` | RLS | A contagem, com parâmetros de consulta no corpo — [Consultas longas demais para uma URL](/docs/backend/vector-search/#queries-too-long-for-a-url) |
| `GET` | `/api/data/:slug/aggregate` | RLS | [API REST](/docs/backend/api/#rest-endpoints) |
| `POST` | `/api/data/:slug/refresh` | `view.roles` | Recalcula uma view materializada, nas views que são materializadas — [Views](/docs/collections/views/#materialized-views) |
| `GET` | `/api/data/:slug/:id` | RLS | [API REST](/docs/backend/api/) |
| `PATCH` | `/api/data/:slug/:id` | RLS | [API REST](/docs/backend/api/) |
| `PUT` | `/api/data/:slug/:id` | RLS | Alias obsoleto de `PATCH` — mesma gravação parcial, responde com `Deprecation: true` |
| `DELETE` | `/api/data/:slug/:id` | RLS | [API REST](/docs/backend/api/) |
| `POST` | `/api/data/:slug/bulk` | RLS | Insere várias linhas, opcionalmente fazendo upsert — [API REST](/docs/backend/api/) |
| `PATCH` | `/api/data/:slug/bulk` | RLS | Atualiza várias linhas por id — [API REST](/docs/backend/api/) |
| `POST` | `/api/data/:slug/bulk/delete` | RLS | Exclui várias linhas por id — [API REST](/docs/backend/api/) |
| `POST` | `/api/data/_batch` | RLS | Grava em várias tabelas em uma única transação — [Gravações via REST](/docs/backend/writes/#cross-table-batches) |
| `GET` | `/api/data/:slug/:id/history` | RLS | [Histórico de entidades](/docs/backend/history/) |
| `POST` | `/api/data/:slug/:id/history/:historyId/revert` | RLS | [Histórico de entidades](/docs/backend/history/) |

`:id` é a chave da linha. Em uma tabela com chave composta, ele é o valor de cada
coluna da chave, na ordem da chave, unidos por `:::` (cada parte codificada para URL):
uma tabela com chave em `(agency_id, id)` endereça uma linha como
`/api/data/proposals/<agency_id>:::<id>`. Um endereço com o número incorreto de
partes é recusado com `400 COMPOSITE_KEY_ADDRESS`, indicando as colunas da chave.

Contagem e agregação são rotas próprias, registradas antes de `/:id` para
que `aggregate` não seja interpretado como o ID de uma entidade. `?select=` e `?groupBy=` são
seus parâmetros, e `select` é obrigatório em `/aggregate`.

Busca textual, busca vetorial, inclusão de relações e seleção de campos *são* parâmetros
de consulta em `GET /api/data/:slug` em vez de rotas — `searchString`,
`vector_search`, `include`, `fields`. Consulte [API REST](/docs/backend/api/).

Um projeto que não declara tabelas e não faz introspecção de nenhuma responde neste prefixo
com um único `404 NO_TABLES`. Consulte [Apenas backend](/docs/getting-started/headless/).

## Autenticação (Auth)

| Método | Caminho | Gate | Mais informações |
|---|---|---|---|
| `GET` | `/api/auth/config` | none | O que a tela de login pode oferecer: cadastro, redefinição de senha, magic link, códigos por e-mail, login de convidado, provedores OAuth e se a configuração do primeiro administrador está pendente |
| `POST` | `/api/auth/register` | none | [Autenticação](/docs/backend/authentication/) |
| `POST` | `/api/auth/login` | none | [Endpoints de autenticação](/docs/backend/auth-endpoints/) |
| `POST` | `/api/auth/refresh` | none (um token de atualização) | [Endpoints de autenticação](/docs/backend/auth-endpoints/) |
| `POST` | `/api/auth/logout` | session | [Endpoints de autenticação](/docs/backend/auth-endpoints/) |
| `GET` | `/api/auth/me` | session | [Endpoints de autenticação](/docs/backend/auth-endpoints/) |
| `PATCH` | `/api/auth/me` | session | [Endpoints de autenticação](/docs/backend/auth-endpoints/) |
| `GET` | `/api/auth/sessions` | session | [Endpoints de autenticação](/docs/backend/auth-endpoints/) |
| `DELETE` | `/api/auth/sessions` | session | Revoga todas as outras sessões |
| `DELETE` | `/api/auth/sessions/:id` | session | Revoga uma sessão |
| `POST` | `/api/auth/forgot-password` | none | [Autenticação](/docs/backend/authentication/) |
| `POST` | `/api/auth/reset-password` | none (um token de redefinição) | [Autenticação](/docs/backend/authentication/) |
| `POST` | `/api/auth/change-password` | session | [Autenticação](/docs/backend/authentication/) |
| `POST` | `/api/auth/change-email` | session | Envia um link de confirmação para o novo endereço — [Alterando um endereço de e-mail](/docs/backend/auth-endpoints/#changing-an-email-address) |
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
| `POST` | `/api/auth/anonymous` | none | Sessões de convidado. Desativado a menos que `ALLOW_ANONYMOUS` |
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
| `POST` | `/api/auth/mfa/challenge/verify` | none (um ID de desafio) | [MFA](/docs/backend/auth-endpoints/#multi-factor-authentication-totp) |
| `GET` | `/api/auth/scopes` | session | Todos os escopos conhecidos por este backend e aqueles que o chamador possui — [Papéis e escopos](/docs/backend/roles-and-scopes/) |
| `GET` | `/api/auth/keys` | session (uma conta) | As [chaves pessoais](/docs/backend/api-keys/#personal-keys) do próprio chamador |
| `POST` | `/api/auth/keys` | session (uma conta) | A chave em texto simples é retornada uma única vez. `403 PERSONAL_KEYS_DISABLED` a menos que a tabela de autenticação defina `auth.personalKeys` |
| `DELETE` | `/api/auth/keys/:id` | session (uma conta) | Revoga uma das chaves do próprio chamador |
| `GET` | `/.well-known/jwks.json` | none | O JWKS público, quando a [assinatura assimétrica](/docs/backend/auth-endpoints/#asymmetric-tokens-and-jwks) está configurada |

## Administração (Admin)

Tudo sob `/api/admin` requer um escopo do plano de administração, e cada
superfície especifica o seu: `users:read` lista contas, `cron:write` dispara uma tarefa.
Um administrador possui todos eles, assim como a chave de serviço. Uma pessoa possui aqueles
declarados por seus papéis, e uma chave de API aqueles com os quais foi criada. Uma chave com escopo restrito
a uma tabela não acessa nada disso. Consulte [Papéis e escopos](/docs/backend/roles-and-scopes/).

| Método | Caminho | Gate | Mais informações |
|---|---|---|---|
| `POST` | `/api/admin/bootstrap` | none, e apenas enquanto não houver administrador | Recusado em produção — consulte [Inicialização do primeiro usuário](/docs/backend/authentication/#first-user-bootstrap) |
| `GET` | `/api/admin/users` | `users:read` | Gerenciamento de usuários |
| `POST` | `/api/admin/users` | `users:write` | Gerenciamento de usuários. Papéis além dos que o próprio chamador possui são recusados |
| `GET` | `/api/admin/users/pick` | `users:read`, ou acesso de escrita a uma tabela com coluna `.userId()` | A [leitura do seletor de usuários](/docs/backend/auth-endpoints/): apenas id, nome, e-mail e avatar. Uma tabela cujas regras de escrita sejam SQL puro não conta |
| `GET` | `/api/admin/users/:uid` | `users:read` | Gerenciamento de usuários |
| `PUT` | `/api/admin/users/:uid` | `users:write` | Recusado para contas que possuem mais permissões que o chamador |
| `DELETE` | `/api/admin/users/:uid` | `users:write` | Recusado para contas que possuem mais permissões que o chamador |
| `POST` | `/api/admin/users/:uid/reset-password` | `users:write` | Emite uma senha temporária |
| `DELETE` | `/api/admin/users/:uid/mfa` | `users:write` | Remove os segundos fatores e códigos de recuperação da conta, encerrando suas sessões |
| `GET` | `/api/admin/guests` | `users:read` | Convidados, ordenados pelos vistos por último há mais tempo. `?lastSeenBefore=` os filtra para o que a exclusão abaixo afetaria, e `total` os contabiliza |
| `DELETE` | `/api/admin/guests` | `users:write` | Exclui um lote dos convidados vistos por último antes de `?lastSeenBefore=`, que é obrigatório. Responde `{ deleted, skipped, remaining }`. Repita enquanto `remaining` for diferente de 0, com `?offset=` definido para quantos foram ignorados. Contas de usuários não podem ser afetadas |
| `DELETE` | `/api/admin/guests/:uid` | `users:write` | Exclui um convidado. Uma conta normal é recusada com `NOT_ANONYMOUS` |
| `GET` | `/api/admin/roles` | `users:read` | `admin` e os papéis declarados pelo projeto, com seus respectivos escopos |
| `GET` | `/api/admin/api-keys` | `keys:read` | [Chaves de API](/docs/backend/api-keys/). Nunca utilizável por uma chave de API |
| `POST` | `/api/admin/api-keys` | `keys:write` | A chave em texto simples é retornada uma única vez, na criação |
| `GET` | `/api/admin/api-keys/:id` | `keys:read` | [Chaves de API](/docs/backend/api-keys/) |
| `PUT` | `/api/admin/api-keys/:id` | `keys:write` | [Chaves de API](/docs/backend/api-keys/) |
| `DELETE` | `/api/admin/api-keys/:id` | `keys:write` | [Chaves de API](/docs/backend/api-keys/) |
| `GET` | `/api/admin/cron` | `cron:read` | [Tarefas Cron](/docs/backend/cron-jobs/) |
| `GET` | `/api/admin/cron/:id` | `cron:read` | [Tarefas Cron](/docs/backend/cron-jobs/) |
| `PUT` | `/api/admin/cron/:id` | `cron:write` | Ativa ou desativa uma tarefa |
| `GET` | `/api/admin/cron/:id/logs` | `cron:read` | [Tarefas Cron](/docs/backend/cron-jobs/) |
| `POST` | `/api/admin/cron/:id/trigger` | `cron:write` | Executa uma tarefa agora. `?async=1` responde com `202` assim que for iniciada — [API de tarefas Cron](/docs/backend/cron-jobs-api/#example-trigger-a-job-manually) |
| `GET` | `/api/admin/backups` | `backups:read` | Inventário de backups |
| `GET` | `/api/admin/backups/download` | `backups:read` | Faz o streaming de um backup. Com `?token=` obtido de um link de download, nenhum cabeçalho é necessário, exclusivamente para aquele backup |
| `POST` | `/api/admin/backups/download-url` | `backups:read` | Um link para um backup, `{ key }` → `{ url, token, expiresIn }`, válido por 60 segundos — [Backups](/docs/deployment/backups/#download-a-backup) |
| `POST` | `/api/admin/storage/orphans/scans` | `database:write` | Inicia uma varredura em segundo plano em busca de arquivos armazenados sem referência em nenhuma linha, `?storageId=&olderThanHours=`. Responde `202` com o registro da varredura: `id`, `status` (`queued`) e `runner` (`worker` quando for um job `storage.orphans` na fila de tarefas, `in-process` quando o próprio servidor executá-lo). O registro é gravado na fonte, sob o caminho reservado `_rebase/maintenance/` |
| `GET` | `/api/admin/storage/orphans/scans/:id` | `database:read` | O registro da varredura, `?storageId=`. Enquanto executa: `progress` (`filesScanned`, `rowsScanned`, `collectionsScanned` de `collectionsTotal`, `unscanned`). Ao ser `completed`: `result`, o relatório que o antigo `GET /orphans` retornava. Uma execução que parou de reportar por 10 minutos é respondida como `failed`. `404 STORAGE_SCAN_NOT_FOUND` quando a fonte não possui tal varredura |
| `DELETE` | `/api/admin/storage/orphans?scan=:id` | `database:write` | Exclui em segundo plano os órfãos de uma varredura concluída, `202`. Cada um é verificado novamente contra cada linha e entrada de histórico, sendo solicitado mais uma vez imediatamente antes de ser excluído. O resultado é o campo `deletion` do registro de varredura. `409` com `STORAGE_SCAN_NOT_COMPLETE`, `STORAGE_SCAN_INCOMPLETE`, `STORAGE_SCAN_EXPIRED` ou `STORAGE_SCAN_DELETION_STARTED` |
| `GET` | `/api/admin/storage/orphans` | `database:read` | Obsoleto: a varredura síncrona dentro da requisição, `?storageId=&olderThanHours=`. Responde com `Deprecation: true`. Utilize `POST /orphans/scans` |
| `DELETE` | `/api/admin/storage/orphans` | `database:write` | Obsoleto, sem `?scan=`: varre novamente e exclui dentro da requisição. `409 STORAGE_SCAN_INCOMPLETE` quando uma tabela não pôde ser lida |
| `POST` | `/api/admin/storage/move` | `database:write` | Copia uma pasta para outra fonte sob as mesmas chaves, uma página por chamada — o que o comando `rebase storage move` envia; `400 STORAGE_SAME_LOCATION` para `deleteSource` entre duas fontes que armazenam no mesmo local |
| `POST` | `/api/admin/storage/move/verify` | `database:write` | Lista a fonte novamente após uma migração, com o mesmo corpo, uma página por chamada: `{ checked, notMoved: [{ key, reason }], cursor? }` — cada arquivo ainda presente na fonte com `deleteSource`, ou cada arquivo que o destino não possui cópia sem ele. O comando `rebase storage move` chama esta rota quando a movimentação termina |
| `GET` | `/api/admin/logs` | `logs:read` | O buffer de logs recentes |
| `GET` | `/api/admin/logs/latest` | `logs:read` | As entradas mais recentes de log |
| `GET` | `/api/admin/logs/stream` | `logs:read` | Eventos enviados pelo servidor (Server-sent events) |
| `GET` | `/api/admin/rls-audit` | `schema:read` | O resultado mais recente da auditoria agendada |
| `GET` | `/api/admin/rls-simulator/options` | `schema:read` | Papéis, papéis de regras de usuários e chaves de serviço ativas que um administrador pode simular |
| `POST` | `/api/admin/rls-simulator/preview` | `schema:read` | Cada tabela conforme acessada por `{ role?, userId?, apiKeyId? }`: linhas visíveis em relação às do chamador, ocultas por escopo ou RLS, campos mascarados. Apenas para sessão de administrador |
| `POST` | `/api/admin/sql/csv` | `database:write` | Faz o streaming do resultado completo de uma consulta somente leitura como CSV — "Download full result as CSV" do [Studio](/docs/studio/) |
| `GET` | `/api/admin/branches/:name/diff` | `database:write` | O que uma [branch](/docs/backend/branching/#reviewing-and-merging-a-branch) alterou: esquema, políticas e linhas, `?sampleLimit=&schemas=&maxRowsPerTable=` |
| `POST` | `/api/admin/branches/:name/merge` | `database:write` | Grava as linhas da branch em sua ramificação pai, `{ expectedFingerprint, onConflict?, skipBlocked? }`; `409` quando algum dos lados tiver mudado desde o diff, ou se houver conflito de linhas |
| `GET` | `/api/admin/schema/status` | `schema:read` | [Edição de esquema em tempo real](/docs/backend/live-schema-editing/) |
| `POST` | `/api/admin/schema/plan` | `schema:read` | Planeja uma alteração; nunca aplica nenhuma |
| `POST` | `/api/admin/schema/apply` | `schema:write` | Exclusivo para pessoas, a menos que `REBASE_LIVE_SCHEMA_ALLOW_MACHINE_APPLY` |
| `POST` | `/api/admin/schema/reconcile/plan` | `schema:read` | Planeja flexibilizar `NOT NULL` e remover as colunas não declaradas informadas em `drop`, para [reconciliação de esquema](/docs/cli/schema/#rebase-schema-reconcile); nunca aplica nenhuma alteração |
| `POST` | `/api/admin/schema/reconcile/apply` | `schema:write` | Aplica um plano de reconciliação, apenas se o seu `digest` corresponder ao `confirm` enviado |
| `GET` | `/api/admin/schema-editor/status` | `schema:read` | Se o editor está disponível, e a razão caso não esteja |
| `GET` | `/api/admin/schema-editor/tables` | `schema:read` | Cada tabela exportada por `backend/schema/index.ts` conforme interpretada pelo editor, informando o que é editado em código (somente leitura) e o motivo — [Edição de esquema em tempo real](/docs/backend/live-schema-editing/#the-edits-tablepatch) |
| `POST` | `/api/admin/schema-editor/preview` | `schema:write` | `{ patches: TablePatch[] }`: os arquivos que a edição escreveria, compilados; não grava nada |
| `POST` | `/api/admin/schema-editor/apply` | `schema:write` | A mesma edição, gravada em `backend/schema`; o banco de dados não é tocado |
| `GET` | `/api/admin/schema-editor/unmapped-tables` | `schema:read` | Tabelas existentes no banco de dados que `backend/schema` não declara: `{ tables: [{ schema, table, rlsEnabled, policies, unimportable? }] }` |
| `GET` | `/api/admin/schema-editor/unmapped-tables/:schema/:table` | `schema:read` | Uma delas detalhada: `{ table: { …, descriptor, rlsRaised?, notes } }`, para "Importar uma tabela existente". `404` quando desconhecida ou já declarada, `400 SCHEMA_EDIT_REFUSED` sem uma chave primária |
| `GET` | `/api/admin/schema-editor/frontend/calls` | `schema:read` | As chamadas `defineFirestoreCollection` em `frontend/src/cms` que o editor pode reescrever (apenas desenvolvimento) |
| `POST` | `/api/admin/schema-editor/frontend/preview` | `schema:write` | Os arquivos que a edição de uma dessas chamadas escreveria; não grava nada |
| `POST` | `/api/admin/schema-editor/frontend/apply` | `schema:write` | A mesma edição, gravada diretamente no arquivo. `409 SCHEMA_EDIT_STALE_FILE` quando o arquivo foi modificado no disco |
| `GET` | `/api/admin/ui-config` | session | As preferências de interface do workspace por tabela, as do próprio chamador e se o chamador pode gravar as preferências do workspace — consulte [Studio](/docs/studio/#collection-editor) |
| `PUT` | `/api/admin/ui-config/workspace/:slug` | `schema:write` | Mescla um delta de `UiTablePreferences` nas preferências do workspace de uma tabela (`replace` substitui). Gravado em `frontend/src/cms/ui-config.json` onde o servidor tem permissão de escrita no código do projeto, caso contrário em `rebase.ui_preferences` |
| `DELETE` | `/api/admin/ui-config/workspace/:slug` | `schema:write` | Remove as preferências de workspace de uma tabela |
| `PUT` | `/api/admin/ui-config/user/:slug` | session (uma pessoa) | As preferências do próprio chamador para uma tabela. Uma chave de API não possui preferências: `403 UI_PREFERENCES_NEED_A_PERSON` |
| `DELETE` | `/api/admin/ui-config/user/:slug` | session (uma pessoa) | Remove as preferências do próprio chamador para uma tabela |
| `GET` | `/api/admin/dev/emails` | dev + `users:write` | Mensagens capturadas pelo transporte de desenvolvimento em vez de enviadas |
| `DELETE` | `/api/admin/dev/emails` | dev + `users:write` | Esvazia a caixa de mensagens capturadas |

`/api/admin/cron`, `/api/admin/logs` e `/api/admin/schema-editor` também são
disponibilizados em seus caminhos anteriores à versão 0.17 sem o segmento `/admin`. Esses aliases
existem para projetos que ainda não migraram; escreva código novo utilizando o caminho canônico.

## Esquema (Schema)

| Método | Caminho | Gate | Mais informações |
|---|---|---|---|
| `GET` | `/api/schema/tables` | session, ou uma credencial com `schema:read` ou um escopo `data:*` | Todas as tabelas disponibilizadas por este backend, como um array JSON de descritores redigidos para o chamador |
| `GET` | `/api/schema/tables/:slug` | conforme acima | Um único descritor. `404 TABLE_NOT_FOUND` quando o chamador não tem acesso a essa tabela |

Os descritores são aquilo a partir do qual o CMS renderiza seus padrões, o Studio
monta o visualizador de esquema e o editor de RLS, e os apps MCP
renderizam tabelas e formulários. Eles contêm colunas com seus tipos Postgres,
anulabilidade, regras de validação e armazenamento, relações por slug e a
postura de segurança em nível de linha (RLS). O código de hooks nunca sai do servidor: um descritor
apenas informa quais hooks uma tabela possui.

O que é retornado ao chamador depende de quem ele é:

| Chamador | Tabelas | Ocultado/Redigido |
|---|---|---|
| Um administrador, um detentor de `schema:read` ou a chave de serviço | todas as tabelas, incluindo views comuns | colunas `.private()`, para todos |
| Qualquer outra pessoa autenticada, incluindo convidados | apenas as tabelas alcançadas por uma regra permissiva para seus papéis (além da tabela de autenticação e views materializadas cujos `roles` ela possua) | colunas e relações para as quais seus papéis não passam em `access.read`; colunas `.private()`; apenas as regras aplicáveis aos seus papéis; relações para tabelas às quais não tem acesso; flags de hooks; SQL puro em regras, políticas compiladas, consultas de views e índices |
| Uma credencial (chave de API, token MCP ou de plataforma) | as tabelas indicadas pelos seus escopos `data:*`, ou todas com `schema:read` | conforme acima, avaliado com base nos escopos que possui |
| Ninguém autenticado | nenhuma — `401` — a menos que o backend defina `schemaTables: { public: true }` | nesse caso, as tabelas com uma regra `select` pública, redigidas para o chamador com menos privilégios: nenhuma coluna com lista `access.read`, sem SQL puro, sem políticas |

Uma pessoa mantém `metadata`, `softDelete`, `tenant`, `history` e `search` nas
tabelas que lhe são fornecidas. `schemaTables: { persons: "all" }` nas opções do
backend descreve todas as tabelas e regras a qualquer chamador autenticado; o
padrão é `"granted"`. Conexões MCP são avaliadas como uma
credencial, pelo mesmo serializador.

A identidade do chamador é definida pelo adaptador de autenticação do backend, o mesmo consultado
pelas rotas de dados, de modo que um backend com um [adaptador customizado](/docs/backend/auth-adapters/#the-adapter-decides-the-caller-everywhere)
é atendido aqui (e em `/api/docs` e em qualquer superfície administrativa) com os papéis que seu
adaptador retornar; uma credencial não reconhecida resulta em `401`.

Uma credencial que não possua `schema:read` nem um escopo `data:*` recebe
`403 SCOPE_MISSING`. Um backend sem autenticação configurada responde a
qualquer requisição com `404 SCHEMA_UNAVAILABLE`: não há chamador para quem redigir informações, e
`auth.requireAuth: false` não altera isso.

As respostas incluem `ETag: W/"<schema version>-<view>"`, `Cache-Control: private,
no-cache` e o cabeçalho `x-rebase-schema`; uma requisição cujo cabeçalho `If-None-Match`
informe a tag atual recebe `304`. A tag muda sempre que o esquema for alterado,
inclusive após uma edição de esquema em tempo real.

`schemaTables` é uma opção de `initializeRebaseBackend` sem variável de ambiente
correspondente: um projeto gerado por scaffolding a acessa por meio de ejeção (eject).

## Armazenamento (Storage)

| Método | Caminho | Gate | Mais informações |
|---|---|---|---|
| `POST` | `/api/storage/upload` | session + `storageAuthorize` | [Armazenamento](/docs/backend/storage/) |
| `GET` | `/api/storage/file/*` | session + `storageAuthorize` | [Armazenamento](/docs/backend/storage/) |
| `DELETE` | `/api/storage/file/*` | session + `storageAuthorize` | [Armazenamento](/docs/backend/storage/) |
| `GET` | `/api/storage/metadata/*` | session + `storageAuthorize` | [Armazenamento](/docs/backend/storage/) |
| `POST` | `/api/storage/metadata` | session + `storageAuthorize`, por chave | [Armazenamento](/docs/backend/storage/#storage-endpoints): metadados para até 100 objetos |
| `GET` | `/api/storage/list` | session + `storageAuthorize` | [Armazenamento](/docs/backend/storage/) |
| `POST` | `/api/storage/folder` | session + `storageAuthorize` | [Armazenamento](/docs/backend/storage/) |
| `GET` | `/api/storage/sources` | session | As fontes de armazenamento nomeadas que este backend atende |
| `OPTIONS` | `/api/storage/tus` | none | Uploads retomáveis: as versões do TUS e extensões suportadas por este servidor |
| `POST` | `/api/storage/tus` | session + `storageAuthorize` | Uploads retomáveis: criação |
| `GET` | `/api/storage/tus/:id` | proprietário do upload | Uploads retomáveis: offset |
| `PATCH` | `/api/storage/tus/:id` | proprietário do upload | Uploads retomáveis: acréscimo (append) |
| `DELETE` | `/api/storage/tus/:id` | proprietário do upload | Uploads retomáveis: cancelamento |

Uma implantação sem armazenamento configurado responde a este prefixo com um `501` indicando a
variável necessária, em vez de retornar 404 como se o recurso não existisse —
com exceção de `GET /api/storage/sources`, que responde `200` com uma lista vazia.

## Notificações Push

Disponibilizado apenas com `push: true` (`REBASE_PUSH=true`). Com push ativado, mas sem chaves configuradas,
todas as rotas respondem `503 PUSH_NOT_CONFIGURED`. Chaves de API e a chave de serviço são
recusadas: uma assinatura pertence ao navegador de uma pessoa.

| Método | Caminho | Gate | Mais informações |
|---|---|---|---|
| `GET` | `/api/push/key` | session | A chave pública VAPID — [Notificações push](/docs/backend/push-notifications/) |
| `POST` | `/api/push/subscriptions` | session | Registra que este navegador aceita notificações para o chamador — [Notificações push](/docs/backend/push-notifications/#routes) |
| `DELETE` | `/api/push/subscriptions` | session | Interrompe o envio de notificações no próprio navegador do chamador — [Notificações push](/docs/backend/push-notifications/#routes) |

## Funções (Functions)

| Método | Caminho | Gate | Mais informações |
|---|---|---|---|
| `GET` | `/api/functions` | session | Os nomes das funções disponibilizadas e quantos arquivos falharam ao carregar |
| qualquer | `/api/functions/<name>` | o que a função declarar. Uma chave de API também precisa de `functions:invoke` | [Funções customizadas](/docs/backend/custom-functions/) |

Uma rota por arquivo em `backend/functions/`, de forma que os caminhos são provenientes do seu
projeto. `GET /api/functions` lista essas funções apenas para chamadores autenticados — uma
sessão, uma chave de API ou a chave de serviço — e responde a qualquer outro com `401`: o
inventário de endpoints customizados de uma implantação não é público.

## Meta e operações

| Método | Caminho | Gate | Mais informações |
|---|---|---|---|
| `GET` | `/livez` | none | Apenas liveness: indica se este processo está rodando. Não toca o banco de dados, razão pela qual é o caminho de sonda (probe) que um contêiner deve usar — `RUNTIME_LIVENESS_PATH` |
| `GET` | `/health`, `/api/health` | none | Liveness e readiness. Reporta todas as fontes de dados configuradas, não apenas a padrão |
| `GET` | `/api/docs` | o público do endpoint de schema por padrão (401 anônimo a menos que `schemaTables.public`, 403 para credencial sem escopo de schema ou data); none quando `enableSwagger` for `true`; gate de admin quando `false` | O documento OpenAPI 3.0 das tabelas descritas por `GET /api/schema/tables` para o chamador (todas elas com `enableSwagger: true`). `404 DOCS_UNAVAILABLE` quando nenhuma autenticação estiver configurada |
| `GET` | `/api/swagger` | none | Swagger UI. Apenas quando `enableSwagger` for `true`, e nunca em produção |
| `GET` | `/api/meta/schema-version` | none | O hash de esquema a partir do qual este backend foi compilado e a versão do runtime, nada mais |
| `GET` | `/api/meta/contract` | `schema:read` | `{ schemaVersion, runtime: { version, contract }, tables }` — todas as tabelas conforme vistas por um administrador, a entrada para `rebase generate-sdk --from`. `404` quando nenhuma autenticação estiver configurada |
| `GET` | `/metrics` | `REBASE_METRICS_TOKEN` quando definido | Métricas Prometheus, quando `REBASE_METRICS=true` |
| `GET` | `/metrics/history` | `REBASE_METRICS_TOKEN` quando definido | A série gravada por trás dos gráficos do Studio. `501` em um runtime sem backend |
| `GET` | `/metrics/history/batch` | `REBASE_METRICS_TOKEN` quando definido | Até 16 séries gravadas de uma vez, `?series=<a>,<b>&minutes=<n>&bucket=<1\|5\|30\|180>`, agrupadas por intervalo. Inclui requisições e erros por minuto por superfície. `501` em um runtime sem backend |

Conexões WebSocket chegam como um upgrade HTTP no mesmo servidor, em vez de utilizarem
um caminho próprio — consulte [Tempo real (Realtime)](/docs/backend/realtime/).

## Superfície MCP

Disponibilizada apenas quando `REBASE_MCP_ENABLED=true`, o que também exige
`REBASE_PUBLIC_URL` — consulte
[Configuração](/docs/getting-started/configuration/#mcp-surface). Desativada por
padrão: nenhum `REBASE_ROLE` ativa esta opção, pois ela concede acesso ao projeto a
softwares de terceiros, sendo uma decisão que cabe a uma pessoa tomar.

Os documentos `.well-known` ficam na **origem**, não sob `basePath`: as RFCs 8414
e 9728 definem esses caminhos em relação à origem, e o cliente os busca
antes de possuir qualquer token.

| Método | Caminho | Gate | Mais informações |
|---|---|---|---|
| `GET` | `/.well-known/oauth-protected-resource` | none | Metadados da RFC 9728 informando este recurso e seu servidor de autorização. Também disponível no formato com sufixo de caminho |
| `GET` | `/.well-known/oauth-authorization-server` | none | Metadados da RFC 8414: os endpoints, tipos de concessão (grant types) e métodos PKCE suportados por esta implantação |
| `POST` | `/mcp` | Portador OAuth (bearer), ou chave de API | O endpoint do protocolo MCP. Atua **como o usuário autenticado** (ou como quem a chave representar), portanto toda leitura e escrita fica sujeita ao mesmo RLS. Os escopos `data:*` determinam quais ferramentas são oferecidas |
| `GET` | `/mcp` | Portador OAuth (bearer), ou chave de API | Responde `405` com `Allow: POST, DELETE`: este servidor não abre streams iniciados pelo servidor. O token é verificado primeiro, portanto um token ausente ou expirado recebe o desafio `401` em vez disso |
| `DELETE` | `/mcp` | none | Responde `204`. O endpoint não mantém sessão, portanto não há nada para encerrar |
| `POST` | `/api/oauth/register` | taxa limitada (rate-limited) | Registro dinâmico de clientes RFC 7591. Recusado quando `REBASE_MCP_OPEN_REGISTRATION=false` |
| `GET` | `/api/oauth/authorize` | session | A tela de consentimento para a qual o cliente é redirecionado |
| `POST` | `/api/oauth/authorize/decision` | session | A resposta da pessoa ao consentimento — aprovar ou recusar |
| `POST` | `/api/oauth/token` | credenciais de cliente + PKCE | Troca um código de autorização ou atualiza o token |
| `POST` | `/api/oauth/revoke` | credenciais de cliente | Revogação de tokens RFC 7009 |
| `GET` | `/api/oauth/grants` | session | Quais clientes este usuário aprovou |
| `DELETE` | `/api/oauth/grants/:clientId` | session | Revoga uma aprovação, permitindo que a pessoa desfaça um consentimento sem precisar de um administrador |

O endpoint MCP do próprio painel administrativo não faz parte desta superfície: ele utiliza a
sessão do painel administrativo, nunca um token OAuth, e é disponibilizado com as rotas de
administração independentemente de `REBASE_MCP_ENABLED` estar definido, sob um driver que aplica
RLS a cada chamada.

| Método | Caminho | Gate | Mais informações |
|---|---|---|---|
| `POST` | `/api/admin/apps/mcp` | session, nunca anônimo | **Experimental.** As mesmas ferramentas de `/mcp`, para a pessoa autenticada, com `data:read`, `data:write` e `data:delete`, sob seu RLS. A visualização `savedAppsView` do painel administrativo abre [aplicativos salvos](/docs/ai/remote-mcp/) através dele |

## Conteúdo relacionado

- [API REST](/docs/backend/api/) — as rotas de dados em detalhes: filtros, ordenação, paginação, erros
- [Endpoints de autenticação](/docs/backend/auth-endpoints/) — formatos de requisição e resposta para a tabela de autenticação acima
- [Ambiente e Configuração](/docs/getting-started/configuration/) — as variáveis que determinam quais dessas rotas são disponibilizadas
