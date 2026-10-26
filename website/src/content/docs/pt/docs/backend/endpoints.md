---
sourceHash: 63a92d4d1f06a612
title: Índice de endpoints
sidebar_label: Índice de endpoints
description: Cada rota HTTP montada por um backend Rebase — dados, autenticação, armazenamento, administração, meta — com a restrição de acesso (gate) de cada uma e a página que a explica.
---

Cada rota que o servidor monta, em uma única tabela, com o que é necessário para acessá-la.

Os caminhos presumem o `basePath` padrão de `/api`; `REBASE_BASE_PATH` move todos
eles juntos. `/health`, `/livez` e `/metrics` ficam fora dele de propósito,
porque um orquestrador faz a sondagem de `/health` e não deve precisar conhecer o caminho
base. `/health` *também* é montado sob ele, de modo que `/api/health` responda da mesma
forma em vez de retornar 404 justamente no momento em que alguém está verificando se o servidor
está ativo.

Um gate — `tooling/scripts/docs-verify/check-endpoint-index.mjs` — compara esta
tabela com as rotas registradas pelo código-fonte, garantindo que uma nova superfície não possa ser adicionada
sem constar aqui.

## Gates (Restrições de acesso)

| Gate | Significado |
|---|---|
| **none** | Não autenticado. Qualquer pessoa que alcance o host pode chamar |
| **session** | Uma chamada autenticada: um token de acesso ou uma chave de API com escopo para a operação |
| **`resource:action`** | Um chamador que tem esse [escopo](/docs/backend/roles-and-scopes/): um administrador, uma pessoa cuja role o declara, uma chave de API criada com ele, ou a chave de serviço |
| **RLS** | Autenticado, e então o banco de dados decide linha por linha — consulte [Security Rules](/docs/collections/security-rules/) |
| **dev** | Montado apenas fora de produção |

## Dados

Gerado por coleção, de modo que os caminhos contêm seus slugs em vez de uma lista
fixa. `:slug` é o `slug` de uma coleção.

| Método | Caminho | Gate | Mais |
|---|---|---|---|
| `GET` | `/api/data/:slug` | RLS | [Querying](/docs/backend/filtering/) |
| `POST` | `/api/data/:slug` | RLS | [REST API](/docs/backend/api/) |
| `POST` | `/api/data/:slug/query` | RLS | A listagem, com os parâmetros de consulta no corpo — [Consultas longas demais para uma URL](/docs/backend/vector-search/#queries-too-long-for-a-url) |
| `GET` | `/api/data/:slug/count` | RLS | [Querying](/docs/backend/filtering/) |
| `POST` | `/api/data/:slug/count` | RLS | A contagem, com os parâmetros de consulta no corpo — [Consultas longas demais para uma URL](/docs/backend/vector-search/#queries-too-long-for-a-url) |
| `GET` | `/api/data/:slug/aggregate` | RLS | [REST API](/docs/backend/api/#rest-endpoints) |
| `GET` | `/api/data/:slug/:id` | RLS | [REST API](/docs/backend/api/) |
| `PATCH` | `/api/data/:slug/:id` | RLS | [REST API](/docs/backend/api/) |
| `PUT` | `/api/data/:slug/:id` | RLS | Alias depreciado de `PATCH` — mesma escrita parcial, responde `Deprecation: true` |
| `DELETE` | `/api/data/:slug/:id` | RLS | [REST API](/docs/backend/api/) |
| `POST` | `/api/data/:slug/bulk` | RLS | Insere várias linhas, opcionalmente fazendo upsert — [REST API](/docs/backend/api/) |
| `PATCH` | `/api/data/:slug/bulk` | RLS | Atualiza várias linhas por id — [REST API](/docs/backend/api/) |
| `POST` | `/api/data/:slug/bulk/delete` | RLS | Exclui várias linhas por id — [REST API](/docs/backend/api/) |
| `POST` | `/api/data/_batch` | RLS | Escreve através de coleções em uma única transação — [Writing over REST](/docs/backend/writes/#cross-collection-batches) |
| `GET` | `/api/data/:slug/:id/history` | RLS | [Entity History](/docs/backend/history/) |
| `POST` | `/api/data/:slug/:id/history/:historyId/revert` | RLS | [Entity History](/docs/backend/history/) |

Contagem e agregação são rotas próprias, registradas antes de `/:id` para
que `aggregate` não seja interpretado como o id de uma entidade. `?select=` e `?groupBy=` são
seus parâmetros, e `select` é obrigatório em `/aggregate`.

Busca textual, busca vetorial, inclusão de relações e seleção de campos *são* parâmetros
de consulta em `GET /api/data/:slug` em vez de rotas — `searchString`,
`vector_search`, `include`, `fields`. Consulte [REST API](/docs/backend/api/).

Um projeto que não declara coleções e não faz introspecção de nenhuma atende a este prefixo
como um único `404 NO_COLLECTIONS`. Consulte [Backend only](/docs/getting-started/headless/).

## Autenticação

| Método | Caminho | Gate | Mais |
|---|---|---|---|
| `GET` | `/api/auth/config` | none | O que a tela de login pode oferecer: cadastro, redefinição de senha, magic link, códigos por e-mail, login de convidado, provedores OAuth e se a configuração do primeiro administrador está pendente |
| `POST` | `/api/auth/register` | none | [Authentication](/docs/backend/authentication/) |
| `POST` | `/api/auth/login` | none | [Auth endpoints](/docs/backend/auth-endpoints/) |
| `POST` | `/api/auth/refresh` | none (um token de atualização) | [Auth endpoints](/docs/backend/auth-endpoints/) |
| `POST` | `/api/auth/logout` | session | [Auth endpoints](/docs/backend/auth-endpoints/) |
| `GET` | `/api/auth/me` | session | [Auth endpoints](/docs/backend/auth-endpoints/) |
| `PATCH` | `/api/auth/me` | session | [Auth endpoints](/docs/backend/auth-endpoints/) |
| `GET` | `/api/auth/sessions` | session | [Auth endpoints](/docs/backend/auth-endpoints/) |
| `DELETE` | `/api/auth/sessions` | session | Revoga todas as outras sessões |
| `DELETE` | `/api/auth/sessions/:id` | session | Revoga uma sessão |
| `POST` | `/api/auth/forgot-password` | none | [Authentication](/docs/backend/authentication/) |
| `POST` | `/api/auth/reset-password` | none (um token de redefinição) | [Authentication](/docs/backend/authentication/) |
| `POST` | `/api/auth/change-password` | session | [Authentication](/docs/backend/authentication/) |
| `POST` | `/api/auth/change-email` | session | Envia por e-mail um link de confirmação para o novo endereço — [Alterando um endereço de e-mail](/docs/backend/auth-endpoints/#changing-an-email-address) |
| `POST` | `/api/auth/confirm-email-change` | none (um token de link) | Move a conta para o novo endereço — [Alterando um endereço de e-mail](/docs/backend/auth-endpoints/#changing-an-email-address) |
| `POST` | `/api/auth/send-verification` | session | [Authentication](/docs/backend/authentication/) |
| `GET` | `/api/auth/verify-email` | none (um token de verificação) | [Authentication](/docs/backend/authentication/) |
| `POST` | `/api/auth/verify-email` | none (um token de verificação, e uma sessão ou a senha para mantê-la) | [Verificação de e-mail](/docs/backend/email-verification/) |
| `POST` | `/api/auth/magic-link` | none | [Authentication](/docs/backend/authentication/) |
| `POST` | `/api/auth/magic-link/verify` | none (um token de link) | [Authentication](/docs/backend/authentication/) |
| `POST` | `/api/auth/otp` | none | Códigos de uso único por e-mail |
| `POST` | `/api/auth/otp/verify` | none (um código) | Códigos de uso único por e-mail |
| `POST` | `/api/auth/anonymous` | none | Sessões de convidado. Desativado a menos que `ALLOW_ANONYMOUS` |
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
| `GET` | `/api/auth/scopes` | session | Todos os escopos que este backend conhece, e os que o chamador tem — [Papéis e escopos](/docs/backend/roles-and-scopes/) |
| `GET` | `/api/auth/keys` | session (uma conta) | As próprias [chaves pessoais](/docs/backend/api-keys/#personal-keys) do chamador |
| `POST` | `/api/auth/keys` | session (uma conta) | A chave em texto simples é retornada uma vez. `403 PERSONAL_KEYS_DISABLED` a menos que a coleção de usuários defina `auth.personalKeys` |
| `DELETE` | `/api/auth/keys/:id` | session (uma conta) | Revoga uma das chaves do próprio chamador |
| `GET` | `/.well-known/jwks.json` | none | O JWKS público, quando a [assinatura assimétrica](/docs/backend/auth-endpoints/#asymmetric-tokens-and-jwks) está configurada |

## Administração

Tudo sob `/api/admin` precisa de um escopo do plano administrativo, e cada
superfície nomeia o seu: `users:read` lista contas, `cron:write` dispara um job.
Um administrador tem todos eles, assim como a chave de serviço. Uma pessoa tem os que
suas roles declaram, e uma chave de API, os que recebeu ao ser criada. Uma chave com escopo para
uma coleção não acessa nada disso. Consulte [Papéis e escopos](/docs/backend/roles-and-scopes/).

| Método | Caminho | Gate | Mais |
|---|---|---|---|
| `POST` | `/api/admin/bootstrap` | none, e apenas enquanto nenhum administrador existir | Recusado em produção — consulte [First User Bootstrap](/docs/backend/authentication/#first-user-bootstrap) |
| `GET` | `/api/admin/users` | `users:read` | Gerenciamento de usuários |
| `POST` | `/api/admin/users` | `users:write` | Gerenciamento de usuários. Roles além das do próprio chamador são recusadas |
| `GET` | `/api/admin/users/pick` | `users:read`, ou acesso de escrita a uma coleção com um campo `userSelect` | A [leitura do seletor de usuários](/docs/backend/auth-endpoints/): apenas id, nome, e-mail e avatar. Uma coleção cujas regras de escrita são SQL bruto não conta |
| `GET` | `/api/admin/users/:uid` | `users:read` | Gerenciamento de usuários |
| `PUT` | `/api/admin/users/:uid` | `users:write` | Recusado para uma conta que tem mais do que o chamador |
| `DELETE` | `/api/admin/users/:uid` | `users:write` | Recusado para uma conta que tem mais do que o chamador |
| `POST` | `/api/admin/users/:uid/reset-password` | `users:write` | Emite uma senha temporária |
| `DELETE` | `/api/admin/users/:uid/mfa` | `users:write` | Remove os segundos fatores e os códigos de recuperação da conta, encerra suas sessões |
| `GET` | `/api/admin/roles` | `users:read` | `admin` e as roles que o projeto declara, com seus escopos |
| `GET` | `/api/admin/api-keys` | `keys:read` | [API keys](/docs/backend/api-keys/). Nunca uma chave de API |
| `POST` | `/api/admin/api-keys` | `keys:write` | A chave em texto simples é retornada uma vez, na criação |
| `GET` | `/api/admin/api-keys/:id` | `keys:read` | [API keys](/docs/backend/api-keys/) |
| `PUT` | `/api/admin/api-keys/:id` | `keys:write` | [API keys](/docs/backend/api-keys/) |
| `DELETE` | `/api/admin/api-keys/:id` | `keys:write` | [API keys](/docs/backend/api-keys/) |
| `GET` | `/api/admin/cron` | `cron:read` | [Cron Jobs](/docs/backend/cron-jobs/) |
| `GET` | `/api/admin/cron/:id` | `cron:read` | [Cron Jobs](/docs/backend/cron-jobs/) |
| `PUT` | `/api/admin/cron/:id` | `cron:write` | Habilita ou desabilita um job |
| `GET` | `/api/admin/cron/:id/logs` | `cron:read` | [Cron Jobs](/docs/backend/cron-jobs/) |
| `POST` | `/api/admin/cron/:id/trigger` | `cron:write` | Executa um job agora. `?async=1` responde `202` assim que ele começa — [Cron Jobs API](/docs/backend/cron-jobs-api/#example-trigger-a-job-manually) |
| `GET` | `/api/admin/backups` | `backups:read` | Inventário de backups |
| `GET` | `/api/admin/backups/download` | `backups:read` | Transmite um backup via stream. Com `?token=` de um link de download, nenhum cabeçalho é necessário, apenas para esse backup |
| `POST` | `/api/admin/backups/download-url` | `backups:read` | Um link para um backup, `{ key }` → `{ url, token, expiresIn }`, válido por 60 segundos — [Backups](/docs/deployment/backups/#download-a-backup) |
| `POST` | `/api/admin/storage/orphans/scans` | `database:write` | Inicia em segundo plano uma varredura dos arquivos armazenados que nenhuma linha nomeia, `?storageId=&olderThanHours=`. Responde `202` com o registro da varredura: `id`, `status` (`queued`) e `runner` (`worker` quando é um job `storage.orphans` na fila de jobs, `in-process` quando o próprio servidor o executa). O registro é gravado na fonte, sob o `_rebase/maintenance/` reservado |
| `GET` | `/api/admin/storage/orphans/scans/:id` | `database:read` | O registro da varredura, `?storageId=`. Enquanto ela roda: `progress` (`filesScanned`, `rowsScanned`, `collectionsScanned` de `collectionsTotal`, `unscanned`). Depois de `completed`: `result`, o relatório que o antigo `GET /orphans` respondia. Uma execução que parou de reportar por 10 minutos é respondida como `failed`. `404 STORAGE_SCAN_NOT_FOUND` quando a fonte não tem essa varredura |
| `DELETE` | `/api/admin/storage/orphans?scan=:id` | `database:write` | Exclui em segundo plano os órfãos de uma varredura concluída, `202`. Cada um é conferido de novo contra todas as linhas e entradas de histórico, e consultado outra vez logo antes de ser excluído. O resultado é o `deletion` do registro da varredura. `409` com `STORAGE_SCAN_NOT_COMPLETE`, `STORAGE_SCAN_INCOMPLETE`, `STORAGE_SCAN_EXPIRED` ou `STORAGE_SCAN_DELETION_STARTED` |
| `GET` | `/api/admin/storage/orphans` | `database:read` | Obsoleto: a varredura dentro da requisição, `?storageId=&olderThanHours=`. Responde com `Deprecation: true`. Use `POST /orphans/scans` |
| `DELETE` | `/api/admin/storage/orphans` | `database:write` | Obsoleto, sem `?scan=`: varre de novo e exclui dentro da requisição. `409 STORAGE_SCAN_INCOMPLETE` quando uma collection não pôde ser lida |
| `POST` | `/api/admin/storage/move` | `database:write` | Copia uma pasta para outra fonte sob as mesmas chaves, uma página por chamada — o que `rebase storage move` envia; `400 STORAGE_SAME_LOCATION` para `deleteSource` entre duas fontes que armazenam no mesmo lugar |
| `POST` | `/api/admin/storage/move/verify` | `database:write` | Lista a fonte de novo depois de uma movimentação, com o mesmo corpo, uma página por chamada: `{ checked, notMoved: [{ key, reason }], cursor? }` — cada arquivo que ainda está na fonte com `deleteSource`, cada arquivo de que o destino não tem cópia sem ele. O `rebase storage move` o consulta quando a movimentação termina |
| `GET` | `/api/admin/logs` | `logs:read` | O buffer de logs recentes |
| `GET` | `/api/admin/logs/latest` | `logs:read` | As entradas mais recentes |
| `GET` | `/api/admin/logs/stream` | `logs:read` | Server-sent events |
| `GET` | `/api/admin/rls-audit` | `schema:read` | O resultado mais recente da auditoria agendada |
| `GET` | `/api/admin/rls-simulator/options` | `schema:read` | As funções, as que as regras nomeiam e as chaves de serviço válidas que um administrador pode simular |
| `POST` | `/api/admin/rls-simulator/preview` | `schema:read` | Cada coleção tal como `{ role?, userId?, apiKeyId? }` a alcança: linhas visíveis face às de quem chama, ocultas pelo âmbito ou pela RLS, campos mascarados. Só a sessão de um administrador |
| `POST` | `/api/admin/sql/csv` | `database:write` | Transmite via stream o resultado completo de uma consulta somente leitura como CSV — "Baixar resultado completo como CSV" do [Studio](/docs/studio/) |
| `GET` | `/api/admin/branches/:name/diff` | `database:write` | O que um [branch](/docs/backend/branching/#reviewing-and-merging-a-branch) mudou: esquema, políticas e linhas, `?sampleLimit=&schemas=&maxRowsPerTable=` |
| `POST` | `/api/admin/branches/:name/merge` | `database:write` | Grava as linhas do branch no pai, `{ expectedFingerprint, onConflict?, skipBlocked? }`; `409` se algum lado mudou desde o diff, ou se há linhas em conflito |
| `GET` | `/api/admin/schema/status` | `schema:read` | [Live schema editing](/docs/backend/live-schema-editing/) |
| `POST` | `/api/admin/schema/plan` | `schema:read` | Planeja uma alteração; nunca aplica |
| `POST` | `/api/admin/schema/apply` | `schema:write` | Apenas uma pessoa, a menos que `REBASE_LIVE_SCHEMA_ALLOW_MACHINE_APPLY` |
| `GET` | `/api/admin/schema-editor/status` | `schema:read` | Se o editor está disponível, e a razão quando não está |
| `POST` | `/api/admin/schema-editor/collection/save` | `schema:write` | [Studio](/docs/studio/) — reescreve o código-fonte da coleção |
| `POST` | `/api/admin/schema-editor/collection/delete` | `schema:write` | [Studio](/docs/studio/) |
| `POST` | `/api/admin/schema-editor/property/save` | `schema:write` | [Studio](/docs/studio/) |
| `POST` | `/api/admin/schema-editor/property/delete` | `schema:write` | [Studio](/docs/studio/) |
| `GET` | `/api/admin/dev/emails` | dev + `users:write` | E-mails que o transporte de desenvolvimento capturou em vez de enviar |
| `DELETE` | `/api/admin/dev/emails` | dev + `users:write` | Esvazia a caixa de correio capturada |

`/api/admin/cron`, `/api/admin/logs` e `/api/admin/schema-editor` também são
disponibilizados em seus caminhos anteriores à versão 0.17 sem o segmento `/admin`. Esses aliases
existem para projetos que ainda não migraram; escreva código novo usando o caminho canônico.

## Armazenamento (Storage)

| Método | Caminho | Gate | Mais |
|---|---|---|---|
| `POST` | `/api/storage/upload` | session + `storageAuthorize` | [Storage](/docs/backend/storage/) |
| `GET` | `/api/storage/file/*` | session + `storageAuthorize` | [Storage](/docs/backend/storage/) |
| `DELETE` | `/api/storage/file/*` | session + `storageAuthorize` | [Storage](/docs/backend/storage/) |
| `GET` | `/api/storage/metadata/*` | session + `storageAuthorize` | [Storage](/docs/backend/storage/) |
| `POST` | `/api/storage/metadata` | session + `storageAuthorize`, por chave | [Storage](/docs/backend/storage/#storage-endpoints): metadados de até 100 objetos |
| `GET` | `/api/storage/list` | session + `storageAuthorize` | [Storage](/docs/backend/storage/) |
| `POST` | `/api/storage/folder` | session + `storageAuthorize` | [Storage](/docs/backend/storage/) |
| `GET` | `/api/storage/sources` | session | As fontes de armazenamento nomeadas atendidas por este backend |
| `OPTIONS` | `/api/storage/tus` | none | Uploads retomáveis: as versões e extensões TUS que este servidor suporta |
| `POST` | `/api/storage/tus` | session + `storageAuthorize` | Uploads retomáveis: criação |
| `GET` | `/api/storage/tus/:id` | o proprietário do upload | Uploads retomáveis: offset |
| `PATCH` | `/api/storage/tus/:id` | o proprietário do upload | Uploads retomáveis: append |
| `DELETE` | `/api/storage/tus/:id` | o proprietário do upload | Uploads retomáveis: cancelamento |

Uma implantação sem armazenamento configurado responde a este prefixo com um `501` informando a
variável necessária, em vez de responder com 404 como se o recurso não existisse —
exceto `GET /api/storage/sources`, que responde `200` com uma lista vazia.

## Funções (Functions)

| Método | Caminho | Gate | Mais |
|---|---|---|---|
| `GET` | `/api/functions` | session | Os nomes das funções atendidas e quantos arquivos falharam ao carregar |
| any | `/api/functions/<name>` | o que a função declarar. Uma chave de API também precisa de `functions:invoke` | [Custom Functions](/docs/backend/custom-functions/) |

Uma rota por arquivo em `backend/functions/`, logo os caminhos vêm do seu
projeto. `GET /api/functions` os lista apenas para um chamador autenticado — uma
sessão, uma chave de API ou a chave de serviço — e responde `401` a qualquer outro: o
inventário de endpoints personalizados de uma implantação não é público.

## Metadados e operações

| Método | Caminho | Gate | Mais |
|---|---|---|---|
| `GET` | `/livez` | none | Apenas verificação de atividade (liveness): este processo está rodando. Não toca no banco de dados, razão pela qual é o caminho de verificação que um contêiner deve usar — `RUNTIME_LIVENESS_PATH` |
| `GET` | `/health`, `/api/health` | none | Atividade (liveness) e prontidão (readiness). Informa todas as fontes de dados configuradas, não apenas a padrão |
| `GET` | `/api/docs` | none (`schema:read` quando `enableSwagger` é `false`, o padrão do runtime em produção) | O documento OpenAPI 3.0 |
| `GET` | `/api/swagger` | none | Swagger UI. Apenas fora de produção; `REBASE_ENABLE_SWAGGER` não consegue ativá-lo em produção |
| `GET` | `/api/meta/schema-version` | none | O hash de esquema a partir do qual este backend foi construído e a versão do runtime, e nada mais |
| `GET` | `/api/meta/contract` | `schema:read` | O contrato completo de coleções, para `rebase generate-sdk --from`. `404` quando nenhuma autenticação está configurada |
| `GET` | `/metrics` | `REBASE_METRICS_TOKEN` quando definido | Métricas Prometheus, quando `REBASE_METRICS=true` |
| `GET` | `/metrics/history` | `REBASE_METRICS_TOKEN` quando definido | As séries gravadas por trás dos gráficos do Studio. `501` em um runtime sem backend |

Conexões WebSocket chegam como um upgrade de HTTP no mesmo servidor, em vez de
terem um caminho próprio — consulte [Realtime](/docs/backend/realtime/).

## Superfície MCP

Montada apenas quando `REBASE_MCP_ENABLED=true`, o que também exige
`REBASE_PUBLIC_URL` — consulte
[Configuration](/docs/getting-started/configuration/#mcp-surface). Desativada por
padrão: nenhuma `REBASE_ROLE` ativa isso, porque concede acesso ao projeto para
softwares de terceiros e essa é uma decisão que cabe a uma pessoa tomar.

Os documentos `.well-known` ficam na **origem**, não sob `basePath`: RFC 8414
e RFC 9728 definem esses caminhos em relação à origem, e um cliente os busca
antes de possuir qualquer token.

| Método | Caminho | Gate | Mais |
|---|---|---|---|
| `GET` | `/.well-known/oauth-protected-resource` | none | Metadados da RFC 9728 nomeando este recurso e seu servidor de autorização. Também disponível no formato com sufixo de caminho |
| `GET` | `/.well-known/oauth-authorization-server` | none | Metadados da RFC 8414: os endpoints, tipos de concessão (grant types) e métodos PKCE suportados por esta implantação |
| `POST` | `/mcp` | OAuth bearer, ou uma chave de API | O endpoint do protocolo MCP. Atua **como o usuário conectado** (ou como quem quer que a chave represente), portanto cada leitura e escrita está sujeita ao mesmo RLS. Os escopos `data:*` decidem quais ferramentas são oferecidas |
| `GET` | `/mcp` | OAuth bearer, ou uma chave de API | Responde `405` com `Allow: POST, DELETE`: este servidor não abre stream iniciado pelo servidor. O token é verificado primeiro, então um token ausente ou expirado recebe o desafio `401` |
| `DELETE` | `/mcp` | none | Responde `204`. O endpoint não mantém sessão, portanto não há nada para encerrar |
| `POST` | `/api/oauth/register` | taxa limitada (rate-limited) | Registro dinâmico de clientes RFC 7591. Recusado quando `REBASE_MCP_OPEN_REGISTRATION=false` |
| `GET` | `/api/oauth/authorize` | session | A tela de consentimento para a qual o cliente é redirecionado |
| `POST` | `/api/oauth/authorize/decision` | session | A resposta da pessoa a ela — aprovar ou negar |
| `POST` | `/api/oauth/token` | credenciais de cliente + PKCE | Troca um código de autorização, ou atualiza o token |
| `POST` | `/api/oauth/revoke` | credenciais de cliente | Revogação de token RFC 7009 |
| `GET` | `/api/oauth/grants` | session | Quais clientes este usuário aprovou |
| `DELETE` | `/api/oauth/grants/:clientId` | session | Revoga um consentimento, permitindo que uma pessoa desfaça a aprovação sem intervenção de administrador |

## Relacionado

- [REST API](/docs/backend/api/) — as rotas de dados em detalhes: filtros, ordenação, paginação, erros
- [Auth endpoints](/docs/backend/auth-endpoints/) — formatos de requisição e resposta para a tabela de autenticação acima
- [Environment & Configuration](/docs/getting-started/configuration/) — as variáveis que definem quais destas rotas são montadas
