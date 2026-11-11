---
sourceHash: 7410dc424b969f2a
title: Índice de endpoints
sidebar_label: Índice de endpoints
description: Todas as rotas HTTP que um backend Rebase monta — dados, autenticação, armazenamento, administração, meta — com o controle de acesso de cada uma e a página que a explica.
---

Todas as rotas que o servidor monta, em uma única tabela, com o que é necessário para alcançá-las.

Os caminhos assumem o `basePath` padrão de `/api`; `REBASE_BASE_PATH` move todos
eles juntos. `/health`, `/livez` e `/metrics` ficam fora dele de propósito,
porque um orquestrador faz sondagens em `/health` e não deve precisar conhecer o
caminho base. `/health` *também* é montado sob ele, portanto `/api/health` responde
da mesma forma em vez de retornar 404 justamente no momento em que alguém está
verificando se o servidor está ativo.

Um gate — `tooling/scripts/docs-verify/check-endpoint-index.mjs` — compara esta
tabela com as rotas registradas pelo código-fonte, garantindo que uma nova
superfície não possa ser adicionada sem constar aqui.

## Gates

| Gate | Significado |
|---|---|
| **none** | Não autenticado. Qualquer pessoa que consiga alcançar o host pode chamá-lo |
| **session** | Um chamador autenticado: um token de acesso ou uma chave de API com escopo para a operação |
| **`resource:action`** | Um chamador que possui esse [escopo](/docs/backend/roles-and-scopes/): um admin, uma pessoa cujo papel (role) o declare, uma chave de API criada com ele ou a chave de serviço |
| **RLS** | Autenticado, e então o banco de dados decide linha por linha — consulte [Regras de Segurança](/docs/collections/security-rules/) |
| **dev** | Montado apenas fora de produção |

## Dados

Gerado por coleção, portanto os caminhos contêm seus slugs em vez de uma lista
fixa. `:slug` é o `slug` de uma coleção.

| Método | Caminho | Gate | Mais informações |
|---|---|---|---|
| `GET` | `/api/data/:slug` | RLS | [Consultas](/docs/backend/filtering/) |
| `POST` | `/api/data/:slug` | RLS | [API REST](/docs/backend/api/) |
| `POST` | `/api/data/:slug/query` | RLS | A listagem, parâmetros de consulta no corpo — [Consultas longas demais para uma URL](/docs/backend/vector-search/#queries-too-long-for-a-url) |
| `GET` | `/api/data/:slug/count` | RLS | [Consultas](/docs/backend/filtering/) |
| `POST` | `/api/data/:slug/count` | RLS | A contagem, parâmetros de consulta no corpo — [Consultas longas demais para uma URL](/docs/backend/vector-search/#queries-too-long-for-a-url) |
| `GET` | `/api/data/:slug/aggregate` | RLS | [API REST](/docs/backend/api/#rest-endpoints) |
| `POST` | `/api/data/:slug/refresh` | `view.roles` | Recalcula uma coleção de visualização materializada, nas coleções que fornecem uma — [Visualizações](/docs/collections/views/#materialized-views) |
| `GET` | `/api/data/:slug/:id` | RLS | [API REST](/docs/backend/api/) |
| `PATCH` | `/api/data/:slug/:id` | RLS | [API REST](/docs/backend/api/) |
| `PUT` | `/api/data/:slug/:id` | RLS | Alias obsoleto (deprecated) de `PATCH` — mesma escrita parcial, responde com `Deprecation: true` |
| `DELETE` | `/api/data/:slug/:id` | RLS | [API REST](/docs/backend/api/) |
| `POST` | `/api/data/:slug/bulk` | RLS | Insere várias linhas, opcionalmente realizando upsert — [API REST](/docs/backend/api/) |
| `PATCH` | `/api/data/:slug/bulk` | RLS | Atualiza várias linhas por id — [API REST](/docs/backend/api/) |
| `POST` | `/api/data/:slug/bulk/delete` | RLS | Exclui várias linhas por id — [API REST](/docs/backend/api/) |
| `POST` | `/api/data/_batch` | RLS | Escreve em múltiplas coleções em uma única transação — [Escrita via REST](/docs/backend/writes/#cross-collection-batches) |
| `GET` | `/api/data/:slug/:id/history` | RLS | [Histórico de Entidades](/docs/backend/history/) |
| `POST` | `/api/data/:slug/:id/history/:historyId/revert` | RLS | [Histórico de Entidades](/docs/backend/history/) |

Contagem e agregação são rotas próprias, registradas antes de `/:id` para que
`aggregate` não seja lido como um id de entidade. `?select=` e `?groupBy=` são
seus parâmetros, e `select` é obrigatório em `/aggregate`.

Busca de texto, busca vetorial, inclusão de relações e seleção de campos *são*
parâmetros de consulta em `GET /api/data/:slug` em vez de rotas — `searchString`,
`vector_search`, `include`, `fields`. Consulte [API REST](/docs/backend/api/).

Um projeto que não declara coleções e não faz introspecção de nenhuma serve esse
prefixo como um único `404 NO_COLLECTIONS`. Consulte [Apenas backend](/docs/getting-started/headless/).

## Autenticação

| Método | Caminho | Gate | Mais informações |
|---|---|---|---|
| `GET` | `/api/auth/config` | none | O que a tela de login pode oferecer: cadastro, redefinição de senha, magic link, códigos por e-mail, login de convidado, provedores OAuth e se a configuração do primeiro admin está pendente |
| `POST` | `/api/auth/register` | none | [Autenticação](/docs/backend/authentication/) |
| `POST` | `/api/auth/login` | none | [Endpoints de autenticação](/docs/backend/auth-endpoints/) |
| `POST` | `/api/auth/refresh` | none (um token de atualização) | [Endpoints de autenticação](/docs/backend/auth-endpoints/) |
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
| `POST` | `/api/auth/confirm-email-change` | none (um token de link) | Transfere a conta para o novo endereço — [Alterando um endereço de e-mail](/docs/backend/auth-endpoints/#changing-an-email-address) |
| `POST` | `/api/auth/send-verification` | session | [Autenticação](/docs/backend/authentication/) |
| `GET` | `/api/auth/verify-email` | none (um token de verificação) | [Autenticação](/docs/backend/authentication/) |
| `POST` | `/api/auth/verify-email` | none (um token de verificação e uma sessão ou a senha para mantê-la) | [Verificação de e-mail](/docs/backend/email-verification/) |
| `POST` | `/api/auth/magic-link` | none | [Autenticação](/docs/backend/authentication/) |
| `POST` | `/api/auth/magic-link/verify` | none (um token de link) | [Autenticação](/docs/backend/authentication/) |
| `POST` | `/api/auth/otp` | none | Códigos de uso único por e-mail |
| `POST` | `/api/auth/otp/verify` | none (um código) | Códigos de uso único por e-mail |
| `POST` | `/api/auth/device` | none | <span class="since-badge" data-since="0.31">Desde 0.31</span> [Login por dispositivo](/docs/backend/device-sign-in/). Desativado a menos que o backend o habilite |
| `POST` | `/api/auth/device/token` | none (um código de dispositivo) | [Login por dispositivo](/docs/backend/device-sign-in/): o polling do dispositivo |
| `GET` | `/api/auth/device/:userCode` | session | [Login por dispositivo](/docs/backend/device-sign-in/): o que a página de aprovação exibe |
| `POST` | `/api/auth/device/approve` | session (`aal2` com um segundo fator) | [Login por dispositivo](/docs/backend/device-sign-in/) |
| `POST` | `/api/auth/device/deny` | session | [Login por dispositivo](/docs/backend/device-sign-in/) |
| `POST` | `/api/auth/anonymous` | none | Sessões de convidados. Desativado a menos que `ALLOW_ANONYMOUS` |
| `POST` | `/api/auth/anonymous/link` | session (um convidado) | Transforma um convidado em uma conta |
| `POST` | `/api/auth/find-user` | session | Desativado a menos que `AUTH_ALLOW_USER_LOOKUP` — é uma superfície de enumeração |
| `POST` | `/api/auth/:provider` | none | Um por provedor OAuth/OIDC configurado |
| `POST` | `/api/auth/link/:provider` | session | Vincula um provedor à conta conectada |
| `POST` | `/api/auth/mfa/enroll` | session | [MFA](/docs/backend/auth-endpoints/#multi-factor-authentication-totp) |
| `POST` | `/api/auth/mfa/verify` | session | [MFA](/docs/backend/auth-endpoints/#multi-factor-authentication-totp) |
| `GET` | `/api/auth/mfa/factors` | session | [MFA](/docs/backend/auth-endpoints/#multi-factor-authentication-totp) |
| `DELETE` | `/api/auth/mfa/unenroll` | session | [MFA](/docs/backend/auth-endpoints/#multi-factor-authentication-totp) |
| `POST` | `/api/auth/mfa/recovery-codes` | session (`aal2`) | [MFA](/docs/backend/auth-endpoints/#multi-factor-authentication-totp) |
| `POST` | `/api/auth/mfa/challenge` | none (um login em andamento) | [MFA](/docs/backend/auth-endpoints/#multi-factor-authentication-totp) |
| `POST` | `/api/auth/mfa/challenge/verify` | none (um id de desafio) | [MFA](/docs/backend/auth-endpoints/#multi-factor-authentication-totp) |
| `GET` | `/api/auth/scopes` | session | Todos os escopos que este backend conhece e os que o chamador possui — [Papéis e escopos](/docs/backend/roles-and-scopes/) |
| `GET` | `/api/auth/keys` | session (uma conta) | As próprias [chaves pessoais](/docs/backend/api-keys/#personal-keys) do chamador |
| `POST` | `/api/auth/keys` | session (uma conta) | A chave em texto simples é retornada uma única vez. `403 PERSONAL_KEYS_DISABLED` a menos que a coleção de usuários defina `auth.personalKeys` |
| `DELETE` | `/api/auth/keys/:id` | session (uma conta) | Revoga uma das chaves do próprio chamador |
| `GET` | `/.well-known/jwks.json` | none | O JWKS público, quando a [assinatura assimétrica](/docs/backend/auth-endpoints/#asymmetric-tokens-and-jwks) estiver configurada |

## Administração

Tudo sob `/api/admin` requer um escopo do plano de administração, e cada
superfície especifica o seu: `users:read` lista contas, `cron:write` dispara um job.
Um admin detém todos eles, assim como a chave de serviço. Uma pessoa possui aqueles
declarados por seus papéis, e uma chave de API aqueles com os quais foi criada. Uma
chave com escopo limitado a uma coleção não acessa nada disso. Consulte [Papéis e escopos](/docs/backend/roles-and-scopes/).

| Método | Caminho | Gate | Mais informações |
|---|---|---|---|
| `POST` | `/api/admin/bootstrap` | none, e apenas enquanto nenhum admin existir | Recusado em produção — consulte [Inicialização do Primeiro Usuário](/docs/backend/authentication/#first-user-bootstrap) |
| `GET` | `/api/admin/users` | `users:read` | Gerenciamento de usuários |
| `POST` | `/api/admin/users` | `users:write` | Gerenciamento de usuários. Papéis além dos do próprio chamador são recusados |
| `GET` | `/api/admin/users/pick` | `users:read`, ou acesso de escrita a uma coleção com um campo `userSelect` | A [leitura do seletor de usuários](/docs/backend/auth-endpoints/): id, nome, e-mail e avatar apenas. Uma coleção cujas regras de escrita são SQL puro não conta |
| `GET` | `/api/admin/users/:uid` | `users:read` | Gerenciamento de usuários |
| `PUT` | `/api/admin/users/:uid` | `users:write` | Recusado para uma conta que possui mais privilégios que o chamador |
| `DELETE` | `/api/admin/users/:uid` | `users:write` | Recusado para uma conta que possui mais privilégios que o chamador |
| `POST` | `/api/admin/users/:uid/reset-password` | `users:write` | Emite uma senha temporária |
| `DELETE` | `/api/admin/users/:uid/mfa` | `users:write` | Remove os segundos fatores e códigos de recuperação da conta, encerra suas sessões |
| `GET` | `/api/admin/guests` | `users:read` | Convidados, ordenados pelos vistos há mais tempo primeiro. `?lastSeenBefore=` filtra para o que a exclusão abaixo afetaria, e `total` conta-os |
| `DELETE` | `/api/admin/guests` | `users:write` | Exclui um lote de convidados vistos pela última vez antes de `?lastSeenBefore=`, que é obrigatório. Responde com `{ deleted, skipped, remaining }`. Repita enquanto `remaining` não for 0, com `?offset=` definido para quantos foram ignorados. Contas não podem ser afetadas |
| `DELETE` | `/api/admin/guests/:uid` | `users:write` | Exclui um convidado. Uma conta é recusada com `NOT_ANONYMOUS` |
| `GET` | `/api/admin/roles` | `users:read` | `admin` e os papéis declarados pelo projeto, com seus escopos |
| `GET` | `/api/admin/api-keys` | `keys:read` | [Chaves de API](/docs/backend/api-keys/). Nunca uma chave de API |
| `POST` | `/api/admin/api-keys` | `keys:write` | A chave em texto simples é retornada uma única vez, na criação |
| `GET` | `/api/admin/api-keys/:id` | `keys:read` | [Chaves de API](/docs/backend/api-keys/) |
| `PUT` | `/api/admin/api-keys/:id` | `keys:write` | [Chaves de API](/docs/backend/api-keys/) |
| `DELETE` | `/api/admin/api-keys/:id` | `keys:write` | [Chaves de API](/docs/backend/api-keys/) |
| `GET` | `/api/admin/cron` | `cron:read` | [Tarefas Cron](/docs/backend/cron-jobs/) |
| `GET` | `/api/admin/cron/:id` | `cron:read` | [Tarefas Cron](/docs/backend/cron-jobs/) |
| `PUT` | `/api/admin/cron/:id` | `cron:write` | Ativa ou desativa um job |
| `GET` | `/api/admin/cron/:id/logs` | `cron:read` | [Tarefas Cron](/docs/backend/cron-jobs/) |
| `POST` | `/api/admin/cron/:id/trigger` | `cron:write` | Executa um job agora. `?async=1` responde com `202` assim que iniciado — [API de Tarefas Cron](/docs/backend/cron-jobs-api/#example-trigger-a-job-manually) |
| `GET` | `/api/admin/backups` | `backups:read` | Inventário de backups |
| `GET` | `/api/admin/backups/download` | `backups:read` | Transmite um backup via stream. Com `?token=` de um link de download, nenhum cabeçalho é necessário, apenas para esse backup |
| `POST` | `/api/admin/backups/download-url` | `backups:read` | Um link para um backup, `{ key }` → `{ url, token, expiresIn }`, válido por 60 segundos — [Backups](/docs/deployment/backups/#download-a-backup) |
| `POST` | `/api/admin/storage/orphans/scans` | `database:write` | Inicia uma varredura para os arquivos armazenados sem referência em linhas, `?storageId=&olderThanHours=`, em segundo plano. Responde com `202` contendo o registro da varredura: `id`, `status` (`queued`) e `runner` (`worker` quando for um job `storage.orphans` na fila de jobs, `in-process` quando o próprio servidor o executar). Seu registro é gravado na origem, sob o caminho reservado `_rebase/maintenance/` |
| `GET` | `/api/admin/storage/orphans/scans/:id` | `database:read` | O registro da varredura, `?storageId=`. Enquanto estiver em execução: `progress` (`filesScanned`, `rowsScanned`, `collectionsScanned` de `collectionsTotal`, `unscanned`). Uma vez `completed`: `result`, o relatório que o antigo `GET /orphans` respondia. Uma execução que parou de reportar por 10 minutos é respondida como `failed`. `404 STORAGE_SCAN_NOT_FOUND` quando a origem não possui essa varredura |
| `DELETE` | `/api/admin/storage/orphans?scan=:id` | `database:write` | Exclui os órfãos de uma varredura concluída em segundo plano, `202`. Cada um é verificado novamente em relação a cada linha e entrada de histórico, e consultado novamente logo antes de ser excluído. O resultado é a `deletion` do registro da varredura. `409` com `STORAGE_SCAN_NOT_COMPLETE`, `STORAGE_SCAN_INCOMPLETE`, `STORAGE_SCAN_EXPIRED` ou `STORAGE_SCAN_DELETION_STARTED` |
| `GET` | `/api/admin/storage/orphans` | `database:read` | Obsoleto: a varredura dentro da requisição, `?storageId=&olderThanHours=`. Responde com `Deprecation: true`. Use `POST /orphans/scans` |
| `DELETE` | `/api/admin/storage/orphans` | `database:write` | Obsoleto, sem `?scan=`: varre novamente e exclui dentro da requisição. `409 STORAGE_SCAN_INCOMPLETE` quando uma coleção não pôde ser lida |
| `POST` | `/api/admin/storage/move` | `database:write` | Copia uma pasta para outra origem sob as mesmas chaves, uma página por chamada — o que `rebase storage move` envia; `400 STORAGE_SAME_LOCATION` para `deleteSource` entre duas origens que armazenam no mesmo local |
| `POST` | `/api/admin/storage/move/verify` | `database:write` | Lista a origem novamente após uma movimentação, com o mesmo corpo, uma página por chamada: `{ checked, notMoved: [{ key, reason }], cursor? }` — cada arquivo ainda na origem com `deleteSource`, cada arquivo do qual o destino não tem cópia sem ele. `rebase storage move` consulta isso quando a movimentação é concluída |
| `GET` | `/api/admin/logs` | `logs:read` | O buffer de logs recentes |
| `GET` | `/api/admin/logs/latest` | `logs:read` | As entradas mais recentes |
| `GET` | `/api/admin/logs/stream` | `logs:read` | Eventos enviados pelo servidor (Server-sent events) |
| `GET` | `/api/admin/rls-audit` | `schema:read` | O resultado mais recente da auditoria agendada |
| `GET` | `/api/admin/rls-simulator/options` | `schema:read` | Papéis, rule roles de usuários e chaves de serviço ativas que um administrador pode simular |
| `POST` | `/api/admin/rls-simulator/preview` | `schema:read` | Cada coleção conforme `{ role?, userId?, apiKeyId? }` a acessa: linhas visíveis em comparação com as do chamador, ocultas por escopo ou RLS, campos mascarados. Apenas sessão de administrador |
| `POST` | `/api/admin/sql/csv` | `database:write` | Transmite o resultado completo de uma consulta somente leitura como CSV via stream — opção "Download full result as CSV" do [Studio](/docs/studio/) |
| `GET` | `/api/admin/branches/:name/diff` | `database:write` | O que uma [branch](/docs/backend/branching/#reviewing-and-merging-a-branch) alterou: esquema, políticas e linhas, `?sampleLimit=&schemas=&maxRowsPerTable=` |
| `POST` | `/api/admin/branches/:name/merge` | `database:write` | Grava as linhas da branch em sua mãe (parent), `{ expectedFingerprint, onConflict?, skipBlocked? }`; `409` quando qualquer um dos lados foi alterado desde o diff, ou se houver conflito de linhas |
| `GET` | `/api/admin/schema/status` | `schema:read` | [Edição de esquema em tempo real](/docs/backend/live-schema-editing/) |
| `POST` | `/api/admin/schema/plan` | `schema:read` | Planeja uma alteração; nunca a aplica |
| `POST` | `/api/admin/schema/apply` | `schema:write` | Apenas uma pessoa, a menos que `REBASE_LIVE_SCHEMA_ALLOW_MACHINE_APPLY` |
| `POST` | `/api/admin/schema/reconcile/plan` | `schema:read` | Planeja flexibilizar `NOT NULL` e descartar as colunas não declaradas nomeadas em `drop`, para [reconciliação de esquema](/docs/cli/schema/#rebase-schema-reconcile); nunca aplica |
| `POST` | `/api/admin/schema/reconcile/apply` | `schema:write` | Aplica um plano de reconciliação, apenas se seu `digest` for o `confirm` enviado |
| `GET` | `/api/admin/schema-editor/status` | `schema:read` | Se o editor está disponível e o motivo quando não estiver |
| `POST` | `/api/admin/schema-editor/collection/save` | `schema:write` | [Studio](/docs/studio/) — reescreve o código-fonte da coleção |
| `POST` | `/api/admin/schema-editor/collection/delete` | `schema:write` | [Studio](/docs/studio/) |
| `POST` | `/api/admin/schema-editor/property/save` | `schema:write` | [Studio](/docs/studio/) |
| `POST` | `/api/admin/schema-editor/property/delete` | `schema:write` | [Studio](/docs/studio/) |
| `GET` | `/api/admin/dev/emails` | dev + `users:write` | E-mails que o transporte de desenvolvimento capturou em vez de enviar |
| `DELETE` | `/api/admin/dev/emails` | dev + `users:write` | Esvazia a caixa de correio capturada |

`/api/admin/cron`, `/api/admin/logs` e `/api/admin/schema-editor` também são
disponibilizados em seus caminhos anteriores à versão 0.17 sem o segmento `/admin`.
Esses aliases existem para projetos que ainda não migraram; escreva código novo
usando o caminho canônico.

## Armazenamento

| Método | Caminho | Gate | Mais informações |
|---|---|---|---|
| `POST` | `/api/storage/upload` | session + `storageAuthorize` | [Armazenamento](/docs/backend/storage/) |
| `GET` | `/api/storage/file/*` | session + `storageAuthorize` | [Armazenamento](/docs/backend/storage/) |
| `DELETE` | `/api/storage/file/*` | session + `storageAuthorize` | [Armazenamento](/docs/backend/storage/) |
| `GET` | `/api/storage/metadata/*` | session + `storageAuthorize` | [Armazenamento](/docs/backend/storage/) |
| `POST` | `/api/storage/metadata` | session + `storageAuthorize`, por chave | [Armazenamento](/docs/backend/storage/#storage-endpoints): metadados para até 100 objetos |
| `GET` | `/api/storage/list` | session + `storageAuthorize` | [Armazenamento](/docs/backend/storage/) |
| `POST` | `/api/storage/folder` | session + `storageAuthorize` | [Armazenamento](/docs/backend/storage/) |
| `GET` | `/api/storage/sources` | session | As fontes de armazenamento nomeadas que este backend disponibiliza |
| `OPTIONS` | `/api/storage/tus` | none | Uploads retomáveis: as versões e extensões do TUS suportadas por este servidor |
| `POST` | `/api/storage/tus` | session + `storageAuthorize` | Uploads retomáveis: criação |
| `GET` | `/api/storage/tus/:id` | o proprietário do upload | Uploads retomáveis: offset |
| `PATCH` | `/api/storage/tus/:id` | o proprietário do upload | Uploads retomáveis: anexação (append) |
| `DELETE` | `/api/storage/tus/:id` | o proprietário do upload | Uploads retomáveis: cancelamento |

Uma implantação sem armazenamento configurado responde a esse prefixo com um `501`
indicando o nome da variável necessária, em vez de retornar 404 como se o recurso
não existisse — exceto `GET /api/storage/sources`, que responde com `200` com uma
lista vazia.

## Funções

| Método | Caminho | Gate | Mais informações |
|---|---|---|---|
| `GET` | `/api/functions` | session | Os nomes das funções disponibilizadas e quantos arquivos falharam ao carregar |
| any | `/api/functions/<name>` | o que a função declarar. Uma chave de API também precisa de `functions:invoke` | [Funções Personalizadas](/docs/backend/custom-functions/) |

Uma rota por arquivo sob `backend/functions/`, de modo que os caminhos vêm do seu
projeto. `GET /api/functions` os lista apenas para um chamador autenticado — uma
sessão, uma chave de API ou a chave de serviço — e responde a qualquer outro com
`401`: o inventário dos endpoints personalizados de uma implantação não é público.

## Meta e operações

| Método | Caminho | Gate | Mais informações |
|---|---|---|---|
| `GET` | `/livez` | none | Apenas vivacidade (liveness): se este processo está em execução. Não acessa o banco de dados, razão pela qual é o caminho de sondagem que um contêiner deve usar — `RUNTIME_LIVENESS_PATH` |
| `GET` | `/health`, `/api/health` | none | Vivacidade e prontidão (liveness e readiness). Reporta todas as fontes de dados configuradas, não apenas a padrão |
| `GET` | `/api/docs` | none (`schema:read` quando `enableSwagger` for `false`, o padrão do runtime em produção) | O documento OpenAPI 3.0 |
| `GET` | `/api/swagger` | none | Swagger UI. Apenas fora de produção; `REBASE_ENABLE_SWAGGER` não pode ativá-lo em produção. Não é disponibilizado quando `enableSwagger` for `false`, inclusive em desenvolvimento |
| `GET` | `/api/meta/schema-version` | none | O hash do esquema a partir do qual este backend foi compilado e a versão do runtime, e nada mais |
| `GET` | `/api/meta/contract` | `schema:read` | O contrato completo da coleção, para `rebase generate-sdk --from`. `404` quando nenhuma autenticação estiver configurada |
| `GET` | `/metrics` | `REBASE_METRICS_TOKEN` quando definido | Métricas do Prometheus, quando `REBASE_METRICS=true` |
| `GET` | `/metrics/history` | `REBASE_METRICS_TOKEN` quando definido | As séries gravadas por trás dos gráficos do Studio. `501` em um runtime sem backend |

Conexões WebSocket chegam como um upgrade HTTP no mesmo servidor, em vez de em um
caminho próprio — consulte [Tempo Real](/docs/backend/realtime/).

## Superfície MCP

Montado apenas quando `REBASE_MCP_ENABLED=true`, o que também exige
`REBASE_PUBLIC_URL` — consulte
[Configuração](/docs/getting-started/configuration/#mcp-surface). Desativado por
padrão: nenhuma `REBASE_ROLE` ativa isso, porque concede acesso ao projeto a
softwares de terceiros e essa é uma decisão que deve ser tomada por uma pessoa.

Os documentos `.well-known` ficam na **origem**, não sob `basePath`: a RFC 8414
e a RFC 9728 definem esses caminhos em relação à origem, e o cliente os busca
antes de possuir qualquer token.

| Método | Caminho | Gate | Mais informações |
|---|---|---|---|
| `GET` | `/.well-known/oauth-protected-resource` | none | Metadados da RFC 9728 nomeando este recurso e seu servidor de autorização. Também disponibilizado no formato com sufixo de caminho |
| `GET` | `/.well-known/oauth-authorization-server` | none | Metadados da RFC 8414: os endpoints, tipos de concessão e métodos PKCE suportados por esta implantação |
| `POST` | `/mcp` | Bearer OAuth ou uma chave de API | O endpoint do protocolo MCP. Atua **como o usuário autenticado** (ou como quem a chave representa), de modo que toda leitura e escrita está sujeita ao mesmo RLS. Os escopos `data:*` decidem quais ferramentas são oferecidas |
| `GET` | `/mcp` | Bearer OAuth ou uma chave de API | Responde `405` com `Allow: POST, DELETE`: este servidor não abre nenhum stream iniciado pelo servidor. O token é verificado primeiro, portanto um token ausente ou expirado recebe o desafio `401` em vez disso |
| `DELETE` | `/mcp` | none | Responde `204`. O endpoint não mantém sessão, portanto não há nada para encerrar |
| `POST` | `/api/oauth/register` | limitado por taxa | Registro dinâmico de cliente da RFC 7591. Recusado quando `REBASE_MCP_OPEN_REGISTRATION=false` |
| `GET` | `/api/oauth/authorize` | session | A tela de consentimento para a qual o cliente é redirecionado |
| `POST` | `/api/oauth/authorize/decision` | session | A resposta da pessoa a ela — aprovar ou recusar |
| `POST` | `/api/oauth/token` | credenciais de cliente + PKCE | Troca um código de autorização ou atualiza o token |
| `POST` | `/api/oauth/revoke` | credenciais de cliente | Revogação de token da RFC 7009 |
| `GET` | `/api/oauth/grants` | session | Quais clientes este usuário aprovou |
| `DELETE` | `/api/oauth/grants/:clientId` | session | Revoga um, permitindo que a pessoa desfaça um consentimento sem a intervenção de um admin |

O endpoint MCP do próprio painel administrativo não faz parte dessa superfície:
ele utiliza a sessão do painel administrativo, nunca um token OAuth, e é montado
com as rotas de admin independentemente de `REBASE_MCP_ENABLED` estar definido ou
não, em um driver que aplica o escopo do RLS a cada chamada.

| Método | Caminho | Gate | Mais informações |
|---|---|---|---|
| `POST` | `/api/admin/apps/mcp` | session, nunca anônimo | **Experimental.** As mesmas ferramentas de `/mcp`, para a pessoa conectada, com `data:read`, `data:write` e `data:delete`, sob seu RLS. A `savedAppsView` do painel de administração abre [aplicativos salvos](/docs/ai/remote-mcp/) por meio dele |

## Relacionados

- [API REST](/docs/backend/api/) — as rotas de dados completas: filtros, ordenação, paginação, erros
- [Endpoints de autenticação](/docs/backend/auth-endpoints/) — formatos de requisição e resposta para a tabela de autenticação acima
- [Ambiente e Configuração](/docs/getting-started/configuration/) — as variáveis que determinam quais dessas rotas são montadas
