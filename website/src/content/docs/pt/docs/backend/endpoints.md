---
sourceHash: e08fbf11c0138bb1
title: Índice de endpoints
sidebar_label: Índice de endpoints
description: Todas as rotas HTTP que um backend Rebase disponibiliza — dados, autenticação, armazenamento, administração, meta — com a restrição de acesso de cada uma e a página que a explica.
---

Todas as rotas que o servidor monta, em uma única tabela, com os requisitos para acessá-las.

Os caminhos assumem o `basePath` padrão de `/api`; `REBASE_BASE_PATH` move todos
eles em conjunto. `/health`, `/livez` e `/metrics` ficam de fora intencionalmente,
pois um orquestrador sonda `/health` e não precisa conhecer o caminho base.
`/health` *também* é montado sob ele, para que `/api/health` responda da mesma
forma em vez de retornar 404 no exato momento em que alguém estiver verificando
se o servidor está ativo.

Um gate — `tooling/scripts/docs-verify/check-endpoint-index.mjs` — compara esta
tabela com as rotas registradas pelo código-fonte, garantindo que uma nova
superfície não possa ser adicionada sem constar aqui.

## Gates

| Gate | Significado |
|---|---|
| **none** | Não autenticado. Qualquer pessoa que alcance o host pode chamá-lo |
| **session** | Um chamador autenticado: um token de acesso ou uma chave de API com escopo para a operação |
| **admin** | Uma sessão de administrador, uma chave de serviço ou uma chave de API com escopo de administrador |
| **RLS** | Autenticado, e então o banco de dados decide linha por linha — consulte [Security Rules](/docs/collections/security-rules/) |
| **dev** | Montado apenas fora de produção |

## Data

Gerado por coleção, portanto os caminhos utilizam seus slugs em vez de uma lista
fixa. `:slug` é o `slug` de uma coleção.

| Método | Caminho | Gate | Mais |
|---|---|---|---|
| `GET` | `/api/data/collections` | session | [REST API](/docs/backend/api/) |
| `GET` | `/api/data/:slug` | RLS | [Querying](/docs/backend/api/#filtering) |
| `POST` | `/api/data/:slug` | RLS | [REST API](/docs/backend/api/) |
| `GET` | `/api/data/:slug/count` | RLS | [Querying](/docs/backend/api/#filtering) |
| `GET` | `/api/data/:slug/aggregate` | RLS | [REST API](/docs/backend/api/#rest-endpoints) |
| `GET` | `/api/data/:slug/:id` | RLS | [REST API](/docs/backend/api/) |
| `PATCH` | `/api/data/:slug/:id` | RLS | [REST API](/docs/backend/api/) |
| `PUT` | `/api/data/:slug/:id` | RLS | Alias depreciado de `PATCH` — mesma escrita parcial, responde `Deprecation: true` |
| `DELETE` | `/api/data/:slug/:id` | RLS | [REST API](/docs/backend/api/) |
| `POST` | `/api/data/:slug/bulk` | RLS | Insere várias linhas, opcionalmente com upsert — [REST API](/docs/backend/api/) |
| `PATCH` | `/api/data/:slug/bulk` | RLS | Atualiza várias linhas por id — [REST API](/docs/backend/api/) |
| `POST` | `/api/data/:slug/bulk/delete` | RLS | Exclui várias linhas por id — [REST API](/docs/backend/api/) |
| `POST` | `/api/data/_batch` | RLS | Escreve entre coleções em uma única transação — [Writing over REST](/docs/backend/writes/#cross-collection-batches) |
| `GET` | `/api/data/:slug/:id/history` | RLS | [Entity History](/docs/backend/history/) |
| `POST` | `/api/data/:slug/:id/history/:historyId/revert` | RLS | [Entity History](/docs/backend/history/) |

Contagem e agregação são rotas próprias, registradas antes de `/:id` para que
`aggregate` não seja interpretado como um id de entidade. `?select=` e `?groupBy=`
são seus parâmetros, e `select` é obrigatório em `/aggregate`.

Busca textual, busca vetorial, inclusão de relações e seleção de campos *são*
parâmetros de consulta em `GET /api/data/:slug` em vez de rotas — `search`,
`vector_search`, `include`, `fields`. Consulte [REST API](/docs/backend/api/).

Um projeto que não declara coleções e não faz introspecção de nenhuma responde a este
prefixo com um único `404 NO_COLLECTIONS`. Consulte [Backend only](/docs/getting-started/headless/).

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
| `POST` | `/api/auth/anonymous` | none | Sessões de convidado. Desativado a menos que `ALLOW_ANONYMOUS` |
| `POST` | `/api/auth/anonymous/link` | session (um convidado) | Converte um convidado em uma conta |
| `POST` | `/api/auth/find-user` | session | Desativado a menos que `AUTH_ALLOW_USER_LOOKUP` — é uma superfície de enumeração |
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

Tudo sob `/api/admin` requer uma sessão de administrador, uma chave de serviço ou
uma chave de API com escopo de administrador. Sem privilégios parciais: uma chave com
escopo restrito a uma coleção não acessa nada disso.

| Método | Caminho | Gate | Mais |
|---|---|---|---|
| `POST` | `/api/admin/bootstrap` | none, e somente enquanto nenhum admin existir | Recusado em produção — consulte [First User Bootstrap](/docs/backend/authentication/#first-user-bootstrap) |
| `GET` | `/api/admin/users` | admin | Gerenciamento de usuários |
| `POST` | `/api/admin/users` | admin | Gerenciamento de usuários |
| `GET` | `/api/admin/users/:uid` | admin | Gerenciamento de usuários |
| `PUT` | `/api/admin/users/:uid` | admin | Gerenciamento de usuários |
| `DELETE` | `/api/admin/users/:uid` | admin | Gerenciamento de usuários |
| `POST` | `/api/admin/users/:uid/reset-password` | admin | Emite uma senha temporária |
| `GET` | `/api/admin/roles` | admin | As funções (roles) declaradas pelo projeto |
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
| `GET` | `/api/admin/backups/download` | admin | Transmite um backup |
| `GET` | `/api/admin/logs` | admin | O buffer de logs recentes |
| `GET` | `/api/admin/logs/latest` | admin | As entradas mais recentes |
| `GET` | `/api/admin/logs/stream` | admin | Server-sent events |
| `GET` | `/api/admin/rls-audit` | admin | O resultado mais recente da auditoria agendada |
| `GET` | `/api/admin/schema/status` | admin | [Live schema editing](/docs/backend/live-schema-editing/) |
| `POST` | `/api/admin/schema/plan` | admin | Planeja uma alteração; nunca a aplica |
| `POST` | `/api/admin/schema/apply` | admin | Desativado a menos que `REBASE_LIVE_SCHEMA_ALLOW_MACHINE_APPLY` |
| `GET` | `/api/admin/schema-editor/status` | admin | Se o editor está disponível, e o motivo quando não estiver |
| `POST` | `/api/admin/schema-editor/collection/save` | admin | [Studio](/docs/studio/) — reescreve o código-fonte da coleção |
| `POST` | `/api/admin/schema-editor/collection/delete` | admin | [Studio](/docs/studio/) |
| `POST` | `/api/admin/schema-editor/property/save` | admin | [Studio](/docs/studio/) |
| `POST` | `/api/admin/schema-editor/property/delete` | admin | [Studio](/docs/studio/) |
| `GET` | `/api/admin/dev/emails` | dev | E-mails capturados pelo transporte de desenvolvimento em vez de enviados |

`/api/admin/cron`, `/api/admin/logs` e `/api/admin/schema-editor` também são
disponibilizados em seus caminhos anteriores à versão 0.17 sem o segmento `/admin`.
Esses aliases existem para projetos que ainda não migraram; escreva novos códigos
utilizando o caminho canônico.

## Storage

| Método | Caminho | Gate | Mais |
|---|---|---|---|
| `POST` | `/api/storage/upload` | session + `storageAuthorize` | [Storage](/docs/backend/storage/) |
| `GET` | `/api/storage/file/*` | session + `storageAuthorize` | [Storage](/docs/backend/storage/) |
| `DELETE` | `/api/storage/file/*` | session + `storageAuthorize` | [Storage](/docs/backend/storage/) |
| `GET` | `/api/storage/metadata/*` | session + `storageAuthorize` | [Storage](/docs/backend/storage/) |
| `GET` | `/api/storage/list` | session + `storageAuthorize` | [Storage](/docs/backend/storage/) |
| `POST` | `/api/storage/folder` | session + `storageAuthorize` | [Storage](/docs/backend/storage/) |
| `GET` | `/api/storage/sources` | session | As fontes de armazenamento nomeadas que este backend disponibiliza |
| `POST` | `/api/storage/tus` | session + `storageAuthorize` | Uploads retomáveis: criação |
| `GET` | `/api/storage/tus/:id` | o proprietário do upload | Uploads retomáveis: offset |
| `PATCH` | `/api/storage/tus/:id` | o proprietário do upload | Uploads retomáveis: append |
| `DELETE` | `/api/storage/tus/:id` | o proprietário do upload | Uploads retomáveis: cancelamento |

Uma implantação sem armazenamento configurado responde a este prefixo com um
`501` indicando a variável necessária, em vez de retornar 404 como se o recurso
não existisse.

## Functions

| Método | Caminho | Gate | Mais |
|---|---|---|---|
| qualquer | `/api/functions/<name>` | o que a função declarar | [Custom Functions](/docs/backend/custom-functions/) |

Uma rota por arquivo em `backend/functions/`, de modo que os caminhos vêm do seu
projeto. `GET /api/functions` **não** os lista: o inventário dos endpoints
personalizados de uma implantação não é público.

## Meta and operations

| Método | Caminho | Gate | Mais |
|---|---|---|---|
| `GET` | `/livez` | none | Apenas liveness: se este processo está em execução. Não toca no banco de dados, razão pela qual é o caminho de verificação que um contêiner deve usar — `RUNTIME_LIVENESS_PATH` |
| `GET` | `/health`, `/api/health` | none | Liveness e readiness. Relata todas as fontes de dados configuradas, não apenas a padrão |
| `GET` | `/api/docs` | none (admin em produção) | O documento OpenAPI 3.0 |
| `GET` | `/api/swagger` | none | Swagger UI. Apenas em desenvolvimento, a menos que `REBASE_ENABLE_SWAGGER` |
| `GET` | `/api/meta/schema-version` | none | O hash de esquema a partir do qual este backend foi compilado, e nada mais |
| `GET` | `/api/meta/contract` | admin | O contrato completo da coleção, para `rebase generate-sdk --from`. `404` quando nenhuma autenticação estiver configurada |
| `GET` | `/metrics` | `REBASE_METRICS_TOKEN` quando definido | Métricas do Prometheus, quando `REBASE_METRICS=true` |
| `GET` | `/metrics/history` | `REBASE_METRICS_TOKEN` quando definido | As séries gravadas por trás dos gráficos do Studio. `501` em um runtime sem backend |

Conexões WebSocket chegam como um upgrade HTTP no mesmo servidor em vez de em
um caminho próprio — consulte [Realtime](/docs/backend/realtime/).

## Relacionados

- [REST API](/docs/backend/api/) — as rotas de dados completas: filtros, ordenação, paginação, erros
- [Auth endpoints](/docs/backend/auth-endpoints/) — formatos de requisição e resposta para a tabela de autenticação acima
- [Environment & Configuration](/docs/getting-started/configuration/) — as variáveis que definem quais destes são montados

---
