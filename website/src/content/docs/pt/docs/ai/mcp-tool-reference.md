---
sourceHash: 50d3082d86c52ae2
title: Referência das ferramentas MCP
sidebar_label: Referência das ferramentas MCP
description: Todas as ferramentas que o servidor MCP do Rebase registra, por grupo — o que cada uma precisa e faz, e quais o loopback gate recusa em projetos não locais.
---

As ferramentas que o [`@rebasepro/mcp`](/docs/ai/mcp) oferece a um assistente. Como ele se conecta,
qual credencial ele possui e como o [loopback gate](/docs/ai/mcp#the-loopback-gate)
decide o que ⚠ significa estão na página do [servidor MCP](/docs/ai/mcp).

53 ferramentas, em dez grupos. Ferramentas marcadas com ⚠ são recusadas em alvos
não locais, a menos que você desative essa restrição.

## Schema e banco de dados (13)

<span class="since-badge" data-since="0.31">Desde 0.31</span>

Executa a CLI do Rebase no diretório do projeto ativo.

| Ferramenta | Obrigatório | Descrição |
|---|---|---|
| `rebase_schema_generate` | — | Gera o schema do Drizzle a partir das tabelas em `backend/schema` |
| `rebase_db_push` ⚠ | — | Aplica o schema diretamente ao banco de dados (atalho de desenvolvimento) |
| `rebase_schema_introspect` | — | Grava um `defineTable` em `backend/schema` para cada tabela existente no banco de dados ativo |
| `rebase_db_generate` | — | Gera arquivos de migração SQL a partir das alterações de schema |
| `rebase_db_migrate` ⚠ | — | Executa todas as migrações SQL pendentes |
| `rebase_generate_sdk` | — | Gera o SDK TypeScript totalmente tipado |
| `rebase_doctor` | — | Detecta divergências entre as tabelas em `backend/schema`, o schema gerado e o banco de dados ativo |
| `rebase_db_branch_create` ⚠ | `name` | Cria uma branch do banco de dados (apenas administradores) |
| `rebase_db_branch_list` | — | Lista as branches do banco de dados (apenas administradores) |
| `rebase_db_branch_delete` ⚠ | `name` | Exclui uma branch do banco de dados (apenas administradores) |
| `rebase_db_branch_info` | `name` | Informações e status da branch (apenas administradores) |
| `rebase_db_branch_diff` | `name` | O que uma branch alterou em relação ao banco de dados a partir do qual foi criada — schema, políticas e linhas, com conflitos; não altera nenhum dos dois (apenas administradores) |
| `rebase_db_branch_switch` | — | Aponta este checkout para uma branch, ou de volta para o banco de dados principal (apenas administradores) |

## Planejamento de schema (1)

<span class="since-badge" data-since="0.31">Desde 0.31</span>

Pergunta ao backend o que uma alteração faria, via `POST /api/admin/schema/plan`. Sem
CLI e sem nada gravado em disco — funciona no banco de dados de desenvolvimento gerenciado,
o que os comandos baseados em Atlas não conseguem fazer.

| Ferramenta | Obrigatório | Descrição |
|---|---|---|
| `rebase_schema_plan` | `patches` | O SQL que uma lista de edições `TablePatch` executaria, e quais instruções destroem dados — consulte [Edição de schema ao vivo](/docs/backend/live-schema-editing/#the-edits-tablepatch) |

## Linhas (5)

<span class="since-badge" data-since="0.31">Desde 0.31</span> Os mesmos nomes que o `/mcp` remoto usa; antes eram `list_documents`, `get_document`, `create_document`, `update_document` e `delete_document`, com um argumento `collection`.

| Ferramenta | Obrigatório | Descrição |
|---|---|---|
| `query_table` | `table` | Lê linhas, com `limit`, `offset`, `orderBy`, `where` opcionais, assim como faz `data.table(name).find()` |
| `get_row` | `table`, `id` | Busca uma única linha por ID |
| `create_row` ⚠ | `table`, `data` | Cria uma linha |
| `update_row` ⚠ | `table`, `id`, `data` | Atualiza uma linha; apenas as colunas informadas são modificadas |
| `delete_row` ⚠ | `table`, `id` | Exclui uma linha |

## Usuários e papéis (6)

| Ferramenta | Obrigatório | Descrição |
|---|---|---|
| `list_users` | — | Lista todos os usuários, incluindo papéis |
| `create_user` ⚠ | `email` | Cria um usuário (`displayName`, `password`, `roles` opcionais) |
| `update_user` ⚠ | `uid` | Atualiza e-mail, nome de exibição ou papéis |
| `delete_user` ⚠ | `uid` | Exclui um usuário |
| `list_roles` | — | Lista os papéis definidos |
| `rebase_auth_reset_password` ⚠ | `email` | Redefine uma senha via API de administração |

Tanto `create_user` quanto `update_user` aceitam `roles`, portanto qualquer um deles pode conceder
acesso de administrador. É por isso que eles passam pelo gate em vez de serem tratados apenas como "aditivos".

## Armazenamento (3)

| Ferramenta | Obrigatório | Descrição |
|---|---|---|
| `storage_list_objects` | — | Lista objetos armazenados |
| `storage_get_download_url` | `key` | Uma URL de download assinada temporária e sua expiração — não os metadados do objeto |
| `storage_delete_object` ⚠ | `key` | Exclui um objeto |

`storage_get_download_url` é classificado como leitura porque não altera o
ambiente — mas a URL assinada que ele gera é uma capacidade do tipo bearer que sobrevive
à chamada da ferramenta.

## Cron (5)

| Ferramenta | Obrigatório | Descrição |
|---|---|---|
| `cron_list_jobs` | — | Lista tarefas agendadas e seus status |
| `cron_get_job` | `jobId` | Detalhes da tarefa |
| `cron_get_job_logs` | `jobId` | Logs de execução |
| `cron_trigger_job` ⚠ | `jobId` | Executa uma tarefa imediatamente |
| `cron_toggle_job` ⚠ | `jobId`, `enabled` | Ativa ou desativa uma tarefa |

`cron_toggle_job` pode desativar silenciosamente uma tarefa de backup ou de cobrança — uma alteração
sem erros e sem saída até que algo faça falta mais tarde.

## Funções (1)

| Ferramenta | Obrigatório | Descrição |
|---|---|---|
| `invoke_function` ⚠ | `name` | Invoca uma [função personalizada](/docs/backend/custom-functions) com qualquer método e payload |

Isso chama código que o servidor MCP nunca viu, com um método e corpo escolhidos
pelo modelo. Seu raio de impacto é tudo o que as suas funções realizam.

## Servidor de desenvolvimento (3)

| Ferramenta | Obrigatório | Descrição |
|---|---|---|
| `rebase_dev_start` | — | Inicia o servidor de desenvolvimento; retorna imediatamente |
| `rebase_dev_logs` | — | Lê a saída recente (padrão de 50 linhas, buffer de 500 linhas) |
| `rebase_dev_stop` | — | Interrompe o servidor de desenvolvimento |

## Registro de projetos (7)

| Ferramenta | Obrigatório | Descrição |
|---|---|---|
| `rebase_project_list` | — | Lista projetos registrados e exibe o que está ativo |
| `rebase_project_switch` | `name` | Altera o projeto ativo |
| `rebase_project_add` | `name` | Registra um projeto (`projectDir`, `baseUrl`, `token` opcionais) |
| `rebase_project_remove` | `name` | Remove um projeto (o projeto padrão não pode ser removido) |
| `rebase_project_current` | — | Exibe o projeto ativo e seu status de autenticação |
| `rebase_project_status` | — | Executa uma verificação de integridade no backend ativo |
| `rebase_project_use_cloud` | `project` | Aponta para um projeto do Rebase Cloud da conta conectada por id, slug ou nome, por meio do proxy do Studio no console |

`rebase_project_switch` não possui gate, pois redireciona todo o restante
em vez de agir diretamente em um alvo. Um assistente pode, portanto, alternar para um
projeto remoto sem acionar o gate — ele apenas não poderá executar uma ferramenta
destrutiva lá. `rebase_project_use_cloud` é o mesmo tipo de alternância: ele aponta as
ferramentas de dados e de administração para um projeto de produção, onde leituras funcionam e o
gate recusa escritas.

## Rebase Cloud (9)

Executa `rebase cloud … --json` no diretório do projeto ativo, contra o
projeto ao qual está vinculado, com a própria credencial da CLI. Consulte
[Rebase Cloud](/docs/ai/mcp#rebase-cloud) para entender sobre o que atuam e por que
nenhuma delas possui gate.

| Ferramenta | Obrigatório | Descrição |
|---|---|---|
| `rebase_cloud_provision` | — | Um backend ativo sem conta (`rebase cloud init --claim`): a URL ativa, a URL de administração e uma URL de reivindicação (`name`, `deploy`) |
| `rebase_cloud_status` | — | A URL do projeto vinculado, status, último deploy, runtime, banco de dados, armazenamento e sua URL de reivindicação enquanto não reivindicado |
| `rebase_cloud_deploy` | — | Faz deploy e acompanha até o final (`app`, `bundle`, `message`, `wait`, `timeoutSeconds`, `preview`, `previewName`) |
| `rebase_cloud_logs` | — | Um snapshot do log de runtime ou o log da build mais recente (`source`, `since`, `tail`, `grep`, `level`, `previous`, `preview`). Nunca acompanha continuamente |
| `rebase_cloud_env_list` | — | Chaves de variáveis, nunca os valores (`preview`) |
| `rebase_cloud_env_set` | `key`, `value` | Define uma variável; o valor é passado via stdin e nunca é retornado (`secret`, `preview`) |
| `rebase_cloud_deployments_list` | — | Deploys recentes e para quais é possível fazer rollback (`limit`) |
| `rebase_cloud_projects_list` | — | Todos os projetos que a conta conectada pode acessar, em todas as suas organizações |
| `rebase_cloud_rollback` | — | Coloca um deploy anterior bem-sucedido de volta em operação (`deploymentId`) |

`rebase_cloud_provision` cria um projeto e vincula este diretório. Ele nunca
lê o `baseUrl` do projeto ativo, portanto o gate não o verifica; a CLI
o recusa em um diretório que já esteja vinculado.
