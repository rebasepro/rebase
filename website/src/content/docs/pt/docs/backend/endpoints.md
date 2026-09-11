---
sourceHash: c7cd1dd8eea181bf
title: Índice de endpoints
sidebar_label: Índice de endpoints
description: Todas as rotas HTTP que um backend Rebase monta — data, auth, storage, admin, meta — com o controle de acesso em cada uma e a página que a explica.
---

Todas as rotas que o servidor monta, em uma única tabela, com os requisitos necessários para acessá-las.

Os caminhos assumem o `basePath` padrão de `/api`; `REBASE_BASE_PATH` move todos
eles em conjunto. `/health`, `/livez` e `/metrics` ficam fora dele propositalmente,
porque um orquestrador faz a sondagem de `/health` e não deve precisar conhecer o
caminho base. `/health` *também* é montado sob ele, de modo que `/api/health` responde
da mesma forma em vez de retornar 404 no momento em que alguém está verificando se o
servidor está ativo.

Um gate — `tooling/scripts/docs-verify/check-endpoint-index.mjs` — compara esta
tabela com as rotas que o código-fonte registra, garantindo que nenhuma nova superfície
possa ser adicionada sem aparecer aqui.

## Gates

| Gate | Significado |
|---|---|
| **none** | Não autenticado. Qualquer pessoa que consiga alcançar o host pode chamá-lo |
| **session** | Um chamador autenticado: um token de acesso ou uma chave de API com escopo para a operação |
| **admin** | Uma sessão de administrador, uma chave de serviço ou uma chave de API com escopo de administrador |
| **RLS** | Autenticado, e então o banco de dados decide linha por linha — consulte [Security Rules](/docs/collections/security-rules/) |
| **dev** | Montado apenas fora de produção |

## Data

Gerado por collection, portanto os caminhos contêm os seus slugs em vez de uma
lista fixa. `:slug` é o `slug` de uma collection.

| Método | Caminho | Gate | Mais |
|---|---|---|---|
| `GET` | `/api/data/collections` | session | [REST API](/docs/backend/api/) |
| `GET` | `/api/data/:slug` | RLS | [Querying](/docs/backend/api/#filtering) |
| `POST` | `/api/data/:slug` | RLS | [REST API](/docs/backend/api/) |
| `GET` | `/api/data/:slug/count` | RLS | [Querying](/docs/backend/api/#filtering) |
| `GET` | `/api/data/:slug/aggregate` | RLS | [REST API](/docs/backend/api/#rest-endpoints) |
| `GET` | `/api/data/:slug/:id` | RLS | [REST API](/docs/backend/api/) |
| `PATCH` | `/api/data/:slug/:id` | RLS | [REST API](/docs/backend/api/) |
| `PUT` | `/api/data/:slug/:id` | RLS | Alias descontinuado de `PATCH` — mesma escrita parcial, responde `Deprecation: true` |
| `DELETE` | `/api/data/:slug/:id` | RLS | [REST API](/docs/backend/api/) |
| `POST` | `/api/data/:slug/bulk` | RLS | Insere várias linhas, opcionalmente realizando upsert — [REST API](/docs/backend/api/) |
| `PATCH` | `/api/data/:slug/bulk` | RLS | Atualiza várias linhas por id — [REST API](/docs/backend/api/) |
| `POST` | `/api/data/:slug/bulk/delete` | RLS | Exclui várias linhas por id — [REST API](/docs/backend/api/) |
| `POST` | `/api/data/_batch` | RLS | Escreve entre collections em uma única transação — [Writing over REST](/docs/backend/writes/#cross-collection-batches) |
| `GET` | `/api/data/:slug/:id/history` | RLS | [Entity History](/docs/backend/history/) |
| `POST` | `/api/data/:slug/:id/history/:historyId/revert` | RLS | [Entity History](/docs/backend/history/) |

Contagem e agregação são rotas próprias, registradas antes de `/:id` para
que `aggregate` não seja lido como o id de uma entidade. `?select=` e `?groupBy=`
são seus parâmetros, e `select` é obrigatório em `/aggregate`.

Busca textual, busca vetorial, inclusão de relações e seleção de campos *são* parâmetros
de consulta em `GET /api/data/:slug` em vez de rotas — `search`,
`vector_search`, `include`, `fields`. Consulte a [REST API](/docs/backend/api/).

Um projeto que não declara collections e não faz introspecção de nenhuma serve este prefixo
como um único `404 NO_COLLECTIONS`. Consulte [Backend only](/docs/getting-started/headless/).

## Auth

| Método | Caminho | Gate | Mais |
|---|---|---|---|
| `POST` | `/api/auth/register` | none | [Authentication](/docs/backend/authentication/) |
| `POST` | `/api/auth/login` | none | [Auth endpoints](/docs/backend/auth-endpoints/) |
| `POST` | `/api/auth/refresh` | none (um refresh token) | [Auth endpoints](/docs/backend/auth-endpoints/) |
| `POST` | `/api/auth/logout` | session | [Auth endpoints](/docs/backend/auth-endpoints/) |
| `GET` | `/api/auth/me` | session | [Auth endpoints](/docs/backend/auth-endpoints/) |
| `PATCH` | `/api/auth/me` | session | [Auth endpoints](/docs/backend/auth-endpoints/) |
| `GET` | `/api/auth/sessions` | session | [Auth endpoints](/docs/backend/auth-endpoints/) |
| `DELETE` | `/api/auth/sessions` | session | Revoga todas as outras sessões |
| `DELETE` | `/api/auth/sessions/:id` | session | Revoga uma |
| `POST` | `/api/auth/forgot-password` | none | [Authentication](/docs/backend/authentication/) |
| `POST` | `/api/auth/reset-password` | none (um token de redefinição) | [Authentication](/docs/backend/authentication/) |
| `POST` | `/api/auth/change-password` | session | [Authentication](/docs/backend/authentication/) |
| `POST` | `/api/auth/send-verification` | session | [Authentication](/docs/backend/authentication/) |
| `GET` | `/api/auth/verify-email` | none (um token de verificação) | [Authentication](/docs/backend/authentication/) |
| `POST` | `/api/auth/magic-link` | none | [Authentication](/docs/backend/authentication/) |
| `POST` | `/api/auth/magic-link/verify` | none (um token de link) | [Authentication](/docs/backend/authentication/) |
| `POST` | `/api/auth/otp` | none | Códigos de uso único por e-mail |
| `POST` | `/api/auth/otp/verify` | none (um código) | Códigos de uso único por e-mail |
| `POST` | `/api/auth/anonymous` | none | Sessões de convidados. Desativado, a menos que `ALLOW_ANONYMOUS` |
| `POST` | `/api/auth/anonymous/link` | session (um convidado) | Transforma um convidado em uma conta |
| `POST` | `/api/auth/find-user` | session | Desativado, a menos que `AUTH_ALLOW_USER_LOOKUP` — é uma superfície de enumeração |
| `POST` | `/api/auth/:provider` | none | Um por provedor OAuth/OIDC configurado |
| `POST` | `/api/auth/link/:provider` | session | Vincula um provedor à conta conectada |
| `POST` | `/api/auth/mfa/enroll` | session | [MFA](/docs/backend/auth-endpoints/#multi-factor-authentication-totp) |
| `POST` | `/api/auth/mfa/verify` | session | [MFA](/docs/backend/auth-endpoints/#multi-factor-authentication-totp) |
| `GET` | `/api/auth/mfa/factors` | session | [MFA](/docs/backend/auth-endpoints/#multi-factor-authentication-totp) |
| `DELETE` | `/api/auth/mfa/unenroll` | session | [MFA](/docs/backend/auth-endpoints/#multi-factor-authentication-totp) |
| `POST` | `/api/auth/mfa/challenge` | none (um login em andamento) | [MFA](/docs/backend/auth-endpoints/#multi-factor-authentication-totp) |
| `POST` | `/api/auth/mfa/challenge/verify` | none (um id de desafio) | [MFA](/docs/backend/auth-endpoints/#multi-factor-authentication-totp) |
| `GET` | `/.well-known/jwks.json` | none | O JWKS público, quando a [assinatura assimétrica](/docs/backend/auth-endpoints/#asymmetric-tokens-and-jwks) estiver configurada |

## Admin

Tudo sob `/api/admin` requer uma sessão de administrador, uma chave de serviço ou uma
chave de API com escopo de administrador. Sem exceção: uma chave com escopo restrito a uma collection
não acessa nada disso.

| Método | Caminho | Gate | Mais |
|---|---|---|---|
| `POST` | `/api/admin/bootstrap` | none, e apenas enquanto não existir nenhum administrador | Recusado em produção — consulte [First User Bootstrap](/docs/backend/authentication/#first-user-bootstrap) |
| `GET` | `/api/admin/users` | admin | Gerenciamento de usuários |
| `POST` | `/api/admin/users` | admin | Gerenciamento de usuários |
| `GET` | `/api/admin/users/:uid` | admin | Gerenciamento de usuários |
| `PUT` | `/api/admin/users/:uid` | admin | Gerenciamento de usuários |
| `DELETE` | `/api/admin/users/:uid` | admin | Gerenciamento de usuários |
| `POST` | `/api/admin/users/:uid/reset-password` | admin | Emite uma senha temporária |
| `GET` | `/api/admin/roles` | admin | As roles declaradas pelo projeto |
| `GET` | `/api/admin/api-keys` | admin | [API keys](/docs/backend/api-keys/) |
| `POST` | `/api/admin/api-keys` | admin | A chave em texto simples é retornada uma única vez, na criação |
| `GET` | `/api/admin/api-keys/:id` | admin | [API keys](/docs/backend/api-keys/) |
| `PUT` | `/api/admin/api-keys/:id` | admin | [API keys](/docs/backend/api-keys/) |
| `DELETE` | `/api/admin/api-keys/:id` | admin | [API keys](/docs/backend/api-keys/) |
| `GET` | `/api/admin/cron` | admin | [Cron Jobs](/docs/backend/cron-jobs/) |
| `GET` | `/api/admin/cron/:id` | admin | [Cron Jobs](/docs/backend/cron-jobs/) |
| `PUT` | `/api/admin/cron/:id` | admin | Habilita ou desabilita um job |
| `GET` | `/api/admin/cron/:id/logs` | admin | [Cron Jobs](/docs/backend/cron-jobs/) |
| `POST` | `/api/admin/cron/:id/trigger` | admin | Executa um job agora |
| `GET` | `/api/admin/backups` | admin | Inventário de backups |
| `GET` | `/api/admin/backups/download` | admin | Transmite um backup via streaming |
| `GET` | `/api/admin/logs` | admin | O buffer de logs recentes |
| `GET` | `/api/admin/logs/latest` | admin | As entradas mais recentes |
| `GET` | `/api/admin/logs/stream` | admin | Server-sent events |
| `GET` | `/api/admin/rls-audit` | admin | O resultado mais recente da auditoria agendada |
| `GET` | `/api/admin/schema/status` | admin | [Live schema editing](/docs/backend/live-schema-editing/) |
| `POST` | `/api/admin/schema/plan` | admin | Planeja uma alteração; nunca aplica uma |
| `POST` | `/api/admin/schema/apply` | admin | Desativado, a menos que `REBASE_LIVE_SCHEMA_ALLOW_MACHINE_APPLY` |
| `GET` | `/api/admin/schema-editor/status` | admin | Se o editor está disponível e o motivo quando não estiver |
| `POST` | `/api/admin/schema-editor/collection/save` | admin | [Studio](/docs/studio/) — reescreve o código-fonte da collection |
| `POST` | `/api/admin/schema-editor/collection/delete` | admin | [Studio](/docs/studio/) |
| `POST` | `/api/admin/schema-editor/property/save` | admin | [Studio](/docs/studio/) |
| `POST` | `/api/admin/schema-editor/property/delete` | admin | [Studio](/docs/studio/) |
| `GET` | `/api/admin/dev/emails` | dev | E-mails que o transporte de desenvolvimento capturou em vez de enviar |

`/api/admin/cron`, `/api/admin/logs` e `/api/admin/schema-editor` também são
servidos em seus caminhos anteriores à versão 0.17 sem o segmento `/admin`. Esses aliases
existem para projetos que ainda não migraram; escreva código novo utilizando o caminho canônico.

## Storage

| Método | Caminho | Gate | Mais |
|---|---|---|---|
| `POST` | `/api/storage/upload` | session + `storageAuthorize` | [Storage](/docs/backend/storage/) |
| `GET` | `/api/storage/file/*` | session + `storageAuthorize` | [Storage](/docs/backend/storage/) |
| `DELETE` | `/api/storage/file/*` | session + `storageAuthorize` | [Storage](/docs/backend/storage/) |
| `GET` | `/api/storage/metadata/*` | session + `storageAuthorize` | [Storage](/docs/backend/storage/) |
| `GET` | `/api/storage/list` | session + `storageAuthorize` | [Storage](/docs/backend/storage/) |
| `POST` | `/api/storage/folder` | session + `storageAuthorize` | [Storage](/docs/backend/storage/) |
| `GET` | `/api/storage/sources` | session | As fontes de armazenamento nomeadas que este backend serve |
| `POST` | `/api/storage/tus` | session + `storageAuthorize` | Uploads retomáveis: criação |
| `GET` | `/api/storage/tus/:id` | o proprietário do upload | Uploads retomáveis: offset |
| `PATCH` | `/api/storage/tus/:id` | o proprietário do upload | Uploads retomáveis: append |
| `DELETE` | `/api/storage/tus/:id` | o proprietário do upload | Uploads retomáveis: cancelamento |

Um deployment sem armazenamento configurado serve este prefixo como um `501`, informando o
nome da variável necessária, em vez de retornar 404 como se o recurso não existisse.

## Functions

| Método | Caminho | Gate | Mais |
|---|---|---|---|
| qualquer | `/api/functions/<name>` | o que a função declarar | [Custom Functions](/docs/backend/custom-functions/) |

Uma rota por arquivo em `backend/functions/`, portanto os caminhos vêm do seu
projeto. `GET /api/functions` **não** os lista: o inventário de endpoints
personalizados de um deployment não é público.

## Meta and operations

| Método | Caminho | Gate | Mais |
|---|---|---|---|
| `GET` | `/livez` | none | Apenas vivacidade (liveness): verifica se o processo está em execução. Não toca no banco de dados, e por isso é o caminho de sonda que um contêiner deve usar — `RUNTIME_LIVENESS_PATH` |
| `GET` | `/health`, `/api/health` | none | Vivacidade e prontidão. Relata todas as fontes de dados configuradas, não apenas a padrão |
| `GET` | `/api/docs` | none (admin em produção) | O documento OpenAPI 3.0 |
| `GET` | `/api/swagger` | none | Swagger UI. Apenas em desenvolvimento, a menos que `REBASE_ENABLE_SWAGGER` |
| `GET` | `/api/meta/schema-version` | none | O hash do schema a partir do qual este backend foi compilado, e nada mais |
| `GET` | `/api/meta/contract` | admin | O contrato completo de collections, para `rebase generate-sdk --from`. `404` quando nenhuma autenticação estiver configurada |
| `GET` | `/metrics` | `REBASE_METRICS_TOKEN` quando definido | Métricas do Prometheus, quando `REBASE_METRICS=true` |
| `GET` | `/metrics/history` | `REBASE_METRICS_TOKEN` quando definido | A série registrada por trás dos gráficos do Studio. `501` em um runtime sem backend |

Conexões WebSocket chegam como um HTTP upgrade no mesmo servidor, em vez de terem
um caminho próprio — consulte [Realtime](/docs/backend/realtime/).

## MCP surface

Montado apenas quando `REBASE_MCP_ENABLED=true`, o que também requer
`REBASE_PUBLIC_URL` — consulte
[Configuration](/docs/getting-started/configuration/#mcp-surface). Desativado por
padrão: nenhuma `REBASE_ROLE` ativa isso, pois concede acesso ao projeto a
softwares de terceiros e essa é uma decisão que cabe a uma pessoa tomar.

Os documentos `.well-known` ficam na **origem**, não sob `basePath`: a RFC 8414
e a RFC 9728 definem esses caminhos em relação à origem, e um cliente os busca
antes de possuir qualquer token.

| Método | Caminho | Gate | Mais |
|---|---|---|---|
| `GET` | `/.well-known/oauth-protected-resource` | none | Metadados da RFC 9728 identificando este recurso e seu servidor de autorização. Também servido no formato com sufixo de caminho |
| `GET` | `/.well-known/oauth-authorization-server` | none | Metadados da RFC 8414: os endpoints, tipos de concessão (grant types) e métodos PKCE suportados por este deployment |
| `POST` | `/mcp` | OAuth bearer | O endpoint do protocolo MCP. Atua **como o usuário conectado**, portanto cada leitura e escrita está sujeita ao mesmo RLS |
| `GET` | `/mcp` | OAuth bearer | O stream de server-sent-events para uma sessão |
| `DELETE` | `/mcp` | OAuth bearer | Encerra uma sessão |
| `POST` | `/api/oauth/register` | rate-limited | Registro dinâmico de clientes da RFC 7591. Recusado quando `REBASE_MCP_OPEN_REGISTRATION=false` |
| `GET` | `/api/oauth/authorize` | session | A tela de consentimento para a qual o cliente é redirecionado |
| `POST` | `/api/oauth/authorize/decision` | session | A resposta da pessoa a ela — aprovar ou negar |
| `POST` | `/api/oauth/token` | client credentials + PKCE | Troca um código de autorização ou realiza refresh |
| `POST` | `/api/oauth/revoke` | client credentials | Revogação de token da RFC 7009 |
| `GET` | `/api/oauth/grants` | session | Quais clientes este usuário aprovou |
| `DELETE` | `/api/oauth/grants/:clientId` | session | Revoga um, permitindo que uma pessoa desfaça um consentimento sem a necessidade de um administrador |

## Relacionados

- [REST API](/docs/backend/api/) — as rotas de dados completas: filtros, ordenação, paginação, erros
- [Auth endpoints](/docs/backend/auth-endpoints/) — formatos de requisição e resposta para a tabela de autenticação acima
- [Environment & Configuration](/docs/getting-started/configuration/) — as variáveis que definem quais destes endpoints são montados

---
