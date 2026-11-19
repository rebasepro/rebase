---
sourceHash: 42fbd65cd7d89699
title: Referência de ferramentas MCP
sidebar_label: Referência de ferramentas MCP
description: Todas as ferramentas que o servidor MCP do Rebase registra, por grupo — o que cada uma precisa e faz, e quais o loopback gate recusa contra um projeto não local.
---

As ferramentas que o [`@rebasepro/mcp`](/docs/ai/mcp) oferece a um assistente. Como ele se conecta,
qual credencial possui e como o [loopback gate](/docs/ai/mcp#the-loopback-gate)
decide o que ⚠ significa estão na página do [servidor MCP](/docs/ai/mcp).

53 ferramentas, em dez grupos. As ferramentas marcadas com ⚠ são recusadas contra alvos não locais,
a menos que você desative essa restrição.

Todas as ferramentas fora do grupo de registro de projetos, `rebase_cloud_projects_list`,
`rebase_cloud_provision` e `rebase_dev_logs` também aceitam um `project` opcional
(um nome registrado, ou um slug ou id do Cloud), verificado em relação ao vínculo
do Cloud do diretório da sessão antes de serem executadas. Consulte
[Em qual projeto uma chamada atua](/docs/ai/mcp#which-project-a-call-acts-on).

## Schema e banco de dados (13)

Executa a Rebase CLI no diretório do projeto ativo.

| Ferramenta | Obrigatório | Descrição |
|---|---|---|
| `rebase_schema_generate` | — | Gerar o schema Drizzle a partir das tabelas em `backend/schema` |
| `rebase_db_push` ⚠ | — | Aplicar o schema diretamente ao banco de dados (atalho de dev) |
| `rebase_schema_introspect` | — | Escrever um `defineTable` em `backend/schema` para cada tabela que o banco de dados ativo contém |
| `rebase_db_generate` | — | Gerar arquivos de migração SQL a partir de alterações no schema |
| `rebase_db_migrate` ⚠ | — | Executar todas as migrações SQL pendentes |
| `rebase_generate_sdk` | — | Gerar o SDK TypeScript totalmente tipado |
| `rebase_doctor` | — | Detectar divergências (drift) entre as tabelas em `backend/schema`, o schema gerado e o banco de dados ativo |
| `rebase_db_branch_create` ⚠ | `name` | Criar uma branch de banco de dados (apenas admins) |
| `rebase_db_branch_list` | — | Listar branches de banco de dados (apenas admins) |
| `rebase_db_branch_delete` ⚠ | `name` | Excluir uma branch de banco de dados (apenas admins) |
| `rebase_db_branch_info` | `name` | Informações e status da branch (apenas admins) |
| `rebase_db_branch_diff` | `name` | O que uma branch alterou em relação ao banco de dados do qual foi criada — schema, políticas e linhas, com conflitos; não altera nenhum dos dois (apenas admins) |
| `rebase_db_branch_switch` | — | Apontar este checkout para uma branch, ou de volta para o banco de dados principal (apenas admins) |

## Planejamento de schema (1)

Pergunta ao backend o que uma alteração faria via
`POST /api/admin/schema/plan`. Não requer um processo CLI nem grava nada em
disco. Também funciona no banco de dados de desenvolvimento gerenciado.

| Ferramenta | Obrigatório | Descrição |
|---|---|---|
| `rebase_schema_plan` | `patches` | O SQL que uma lista de edições `TablePatch` executaria e quais instruções destroem dados — consulte [Edição de schema ao vivo](/docs/backend/live-schema-editing/#the-edits-tablepatch) |

## Linhas (5)

Os mesmos nomes que o `/mcp` remoto usa; eram `list_documents`, `get_document`, `create_document`, `update_document` e `delete_document`, com um argumento `collection`.

| Ferramenta | Obrigatório | Descrição |
|---|---|---|
| `query_table` | `table` | Ler linhas, com `limit`, `offset`, `orderBy`, `where` opcionais, assim como faz `data.table(name).find()` |
| `get_row` | `table`, `id` | Buscar uma única linha por ID |
| `create_row` ⚠ | `table`, `data` | Criar uma linha |
| `update_row` ⚠ | `table`, `id`, `data` | Atualizar uma linha; apenas as colunas informadas são modificadas |
| `delete_row` ⚠ | `table`, `id` | Excluir uma linha |

## Usuários e roles (6)

| Ferramenta | Obrigatório | Descrição |
|---|---|---|
| `list_users` | — | Listar todos os usuários, incluindo roles |
| `create_user` ⚠ | `email` | Criar um usuário (`displayName`, `password`, `roles` opcionais) |
| `update_user` ⚠ | `uid` | Atualizar e-mail, nome de exibição ou roles |
| `delete_user` ⚠ | `uid` | Excluir um usuário |
| `list_roles` | — | Listar roles definidas |
| `rebase_auth_reset_password` ⚠ | `email` | Redefinir uma senha via API de administração |

Tanto `create_user` quanto `update_user` aceitam `roles`, portanto qualquer um deles pode criar
um admin. É por isso que eles passam pelo gate em vez de serem tratados como meramente "aditivos".

## Storage (3)

| Ferramenta | Obrigatório | Descrição |
|---|---|---|
| `storage_list_objects` | — | Listar objetos armazenados |
| `storage_get_download_url` | `key` | Uma URL temporária de download assinada e sua expiração — não os metadados do objeto |
| `storage_delete_object` ⚠ | `key` | Excluir um objeto |

`storage_get_download_url` é classificado como leitura porque não altera o
ambiente — mas a URL assinada que ele gera é uma credencial ao portador que sobrevive
à chamada da ferramenta.

## Cron (5)

| Ferramenta | Obrigatório | Descrição |
|---|---|---|
| `cron_list_jobs` | — | Listar tarefas agendadas e seus status |
| `cron_get_job` | `jobId` | Detalhes da tarefa |
| `cron_get_job_logs` | `jobId` | Logs de execução |
| `cron_trigger_job` ⚠ | `jobId` | Executar uma tarefa imediatamente |
| `cron_toggle_job` ⚠ | `jobId`, `enabled` | Habilitar ou desabilitar uma tarefa |

`cron_toggle_job` pode desabilitar silenciosamente uma tarefa de backup ou de faturamento — uma
alteração sem erros e sem saída até que algo faça falta mais tarde.

## Funções (1)

| Ferramenta | Obrigatório | Descrição |
|---|---|---|
| `invoke_function` ⚠ | `name` | Invocar uma [função customizada](/docs/backend/custom-functions) com qualquer método e payload |

Isso chama código que o servidor MCP nunca viu, com um método e corpo escolhidos
pelo modelo. Seu raio de impacto é tudo o que suas funções fazem.

## Servidor de desenvolvimento (3)

| Ferramenta | Obrigatório | Descrição |
|---|---|---|
| `rebase_dev_start` | — | Iniciar o servidor de desenvolvimento; retorna imediatamente |
| `rebase_dev_logs` | — | Ler a saída recente (padrão de 50 linhas, buffer de 500 linhas) |
| `rebase_dev_stop` | — | Parar o servidor de desenvolvimento |

## Registro de projetos (7)

| Ferramenta | Obrigatório | Descrição |
|---|---|---|
| `rebase_project_list` | — | Listar projetos registrados e mostrar o ativo |
| `rebase_project_switch` | `name` | Alterar o projeto ativo |
| `rebase_project_add` | `name` | Registrar um projeto (`projectDir`, `baseUrl`, `token` opcionais) |
| `rebase_project_remove` | `name` | Remover um projeto (o projeto padrão não pode ser removido) |
| `rebase_project_current` | — | Mostrar o projeto ativo e seu status de autenticação |
| `rebase_project_status` | — | Verificar a integridade (health-check) do backend ativo |
| `rebase_project_use_cloud` | `project` | Apontar para um projeto do Rebase Cloud da conta conectada por id, slug ou nome, por meio do proxy do Studio no console |

`rebase_project_switch` não passa pelo gate, porque ele redireciona todo o restante
em vez de atuar diretamente sobre um alvo. Portanto, um assistente pode alternar para um
projeto remoto sem acionar o gate — ele apenas não poderá executar uma ferramenta
destrutiva lá. `rebase_project_use_cloud` é o mesmo tipo de alternância: ele aponta as
ferramentas de dados e administração para um projeto de produção, onde as leituras funcionam
e o gate recusa as gravações.

## Rebase Cloud (9)

Executa `rebase cloud … --json` no diretório do projeto ativo, contra o
projeto ao qual está vinculado, com a própria credencial da CLI. Consulte
[Rebase Cloud](/docs/ai/mcp#rebase-cloud) para ver sobre o que atuam e por que nenhuma
delas passa pelo gate.

| Ferramenta | Obrigatório | Descrição |
|---|---|---|
| `rebase_cloud_provision` | — | Um backend ativo sem conta (`rebase cloud init --claim`): a URL ativa, a URL de administração e uma URL de reivindicação (`name`, `deploy`, `confirm`). Sem `confirm: true`, informa apenas o que faria |
| `rebase_cloud_status` | — | A URL do projeto vinculado, status, último deploy, runtime, banco de dados, storage e sua URL de reivindicação enquanto não for reivindicado |
| `rebase_cloud_deploy` | — | Fazer o deploy e acompanhá-lo até o final (`app`, `bundle`, `message`, `wait`, `timeoutSeconds`, `preview`, `previewName`, `confirm`). Um deploy de produção sem `confirm: true` informa apenas o que faria |
| `rebase_cloud_logs` | — | Um snapshot do log de runtime ou o log de build mais recente (`source`, `since`, `tail`, `grep`, `level`, `previous`, `preview`). Nunca acompanha em tempo real |
| `rebase_cloud_env_list` | — | Chaves de variáveis, nunca os valores (`preview`) |
| `rebase_cloud_env_set` | `key`, `value` | Definir uma variável; o valor é passado via stdin e nunca é retornado (`secret`, `preview`, `confirm`). Em produção, sem `confirm: true` informa apenas o que faria |
| `rebase_cloud_deployments_list` | — | Deploys recentes e para quais é possível fazer rollback (`limit`) |
| `rebase_cloud_projects_list` | — | Todos os projetos que a conta conectada pode acessar, em todas as suas organizações |
| `rebase_cloud_rollback` | — | Colocar um deploy bem-sucedido anterior de volta em operação (`deploymentId`, `confirm`). Sem `confirm: true`, informa apenas o que faria |

`rebase_cloud_provision` cria um projeto e vincula este diretório. Ele nunca
lê o `baseUrl` do projeto ativo, portanto o gate não o verifica; a CLI o
recusa em um diretório que já esteja vinculado.
