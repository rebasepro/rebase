---
sourceHash: c7ba0e6c6150d210
title: Referência de ferramentas MCP
sidebar_label: Referência de ferramentas MCP
description: Todas as ferramentas registradas pelo servidor MCP do Rebase, por grupo — o que cada uma precisa e faz, e quais delas o gate de loopback recusa contra um projeto não local.
---

As ferramentas que [`@rebasepro/mcp`](/docs/ai/mcp) oferece a um assistente. Como ele se conecta, qual credencial possui e como o [gate de loopback](/docs/ai/mcp#the-loopback-gate) decide o que ⚠ significa estão na página do [servidor MCP](/docs/ai/mcp).

53 ferramentas, em dez grupos. Ferramentas marcadas com ⚠ são recusadas contra alvos não locais, a menos que você desative essa restrição.

## Schema e banco de dados (13)

Executa a CLI do Rebase no diretório do projeto ativo.

| Ferramenta | Obrigatório | Descrição |
|---|---|---|
| `rebase_schema_generate` | — | Gerar schema do Drizzle a partir das definições de coleções |
| `rebase_db_push` ⚠ | — | Aplicar o schema diretamente ao banco de dados (atalho de desenvolvimento) |
| `rebase_schema_introspect` | — | Fazer a introspecção do banco de dados ativo em definições de coleções |
| `rebase_db_generate` | — | Gerar arquivos de migração SQL a partir de alterações de schema |
| `rebase_db_migrate` ⚠ | — | Executar todas as migrações SQL pendentes |
| `rebase_generate_sdk` | — | Gerar o SDK TypeScript totalmente tipado |
| `rebase_doctor` | — | Detectar desvios (drift) entre as definições, o schema gerado e o banco de dados ativo |
| `rebase_db_branch_create` ⚠ | `name` | Criar uma branch de banco de dados (apenas administradores) |
| `rebase_db_branch_list` | — | Listar branches de banco de dados (apenas administradores) |
| `rebase_db_branch_delete` ⚠ | `name` | Excluir uma branch de banco de dados (apenas administradores) |
| `rebase_db_branch_info` | `name` | Informações e status da branch (apenas administradores) |
| `rebase_db_branch_diff` | `name` | O que uma branch alterou em relação ao banco de dados do qual foi criada — schema, políticas e linhas, com conflitos; não altera nenhum dos dois (apenas administradores) |
| `rebase_db_branch_switch` | — | Apontar este checkout para uma branch ou de volta para o banco de dados principal (apenas administradores) |

## Planejamento de schema (1)

Pergunta ao backend o que uma alteração faria, via `POST /api/admin/schema/plan`. Sem CLI e nada gravado no disco — funciona no banco de dados de desenvolvimento gerenciado, o que os comandos baseados em Atlas não conseguem fazer.

| Ferramenta | Obrigatório | Descrição |
|---|---|---|
| `rebase_schema_plan` | `collectionId`, `collection` | O SQL que a alteração de uma coleção executaria e quais instruções destroem dados |

## Documentos (5)

| Ferramenta | Obrigatório | Descrição |
|---|---|---|
| `list_documents` | `collection` | Listar linhas, com `limit`, `offset`, `orderBy` e `where` opcionais |
| `get_document` | `collection`, `id` | Buscar uma única linha por ID |
| `create_document` ⚠ | `collection`, `data` | Criar uma linha |
| `update_document` ⚠ | `collection`, `id`, `data` | Atualizar uma linha |
| `delete_document` ⚠ | `collection`, `id` | Excluir uma linha |

## Usuários e funções (6)

| Ferramenta | Obrigatório | Descrição |
|---|---|---|
| `list_users` | — | Listar todos os usuários, incluindo funções |
| `create_user` ⚠ | `email` | Criar um usuário (`displayName`, `password`, `roles` opcionais) |
| `update_user` ⚠ | `uid` | Atualizar e-mail, nome de exibição ou funções |
| `delete_user` ⚠ | `uid` | Excluir um usuário |
| `list_roles` | — | Listar funções definidas |
| `rebase_auth_reset_password` ⚠ | `email` | Redefinir uma senha via API de administração |

Tanto `create_user` quanto `update_user` aceitam `roles`, portanto, qualquer um deles pode criar um administrador. É por isso que eles passam pelo gate em vez de serem tratados como meramente "aditivos".

## Armazenamento (3)

| Ferramenta | Obrigatório | Descrição |
|---|---|---|
| `storage_list_objects` | — | Listar objetos armazenados |
| `storage_get_download_url` | `key` | Uma URL de download assinada temporária e sua expiração — não metadados do objeto |
| `storage_delete_object` ⚠ | `key` | Excluir um objeto |

`storage_get_download_url` é classificado como leitura porque não altera o ambiente — mas a URL assinada que ele gera é uma credencial de acesso temporário que sobrevive à chamada da ferramenta.

## Cron (5)

| Ferramenta | Obrigatório | Descrição |
|---|---|---|
| `cron_list_jobs` | — | Listar tarefas agendadas e seus status |
| `cron_get_job` | `jobId` | Detalhes da tarefa |
| `cron_get_job_logs` | `jobId` | Logs de execução |
| `cron_trigger_job` ⚠ | `jobId` | Executar uma tarefa imediatamente |
| `cron_toggle_job` ⚠ | `jobId`, `enabled` | Ativar ou desativar uma tarefa |

`cron_toggle_job` pode desativar silenciosamente uma tarefa de backup ou de faturamento — uma alteração sem erros e sem saída até que algo faça falta mais tarde.

## Funções (1)

| Ferramenta | Obrigatório | Descrição |
|---|---|---|
| `invoke_function` ⚠ | `name` | Invocar uma [função personalizada](/docs/backend/custom-functions) com qualquer método e payload |

Isso chama código que o servidor MCP nunca viu, com um método e corpo escolhidos pelo modelo. O raio de impacto é tudo o que suas funções fazem.

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
| `rebase_project_status` | — | Verificar a integridade do backend ativo |
| `rebase_project_use_cloud` | `project` | Apontar para um projeto do Rebase Cloud da conta conectada por ID, slug ou nome, por meio do proxy do Studio no console |

`rebase_project_switch` não passa pelo gate, porque redireciona todo o restante em vez de agir diretamente em um alvo. Portanto, um assistente pode alternar para um projeto remoto sem acionar o gate — ele apenas não poderá executar uma ferramenta destrutiva lá. `rebase_project_use_cloud` é o mesmo tipo de chaveamento: ele aponta as ferramentas de dados e de administração para um projeto de produção, onde leituras funcionam e o gate recusa escritas.

## Rebase Cloud (9)

Executa `rebase cloud … --json` no diretório do projeto ativo, contra o projeto ao qual está vinculado, com a própria credencial da CLI. Consulte [Rebase Cloud](/docs/ai/mcp#rebase-cloud) para ver sobre o que elas atuam e por que nenhuma delas passa pelo gate.

| Ferramenta | Obrigatório | Descrição |
|---|---|---|
| `rebase_cloud_provision` | — | Um backend ativo sem conta (`rebase cloud init --claim`): a URL ativa, a URL de administração e uma URL de reivindicação (`name`, `deploy`) |
| `rebase_cloud_status` | — | URL do projeto vinculado, status, último deploy, runtime, banco de dados, armazenamento e sua URL de reivindicação enquanto não reivindicado |
| `rebase_cloud_deploy` | — | Fazer o deploy e acompanhá-lo até o final (`app`, `bundle`, `message`, `wait`, `timeoutSeconds`, `preview`, `previewName`) |
| `rebase_cloud_logs` | — | Um snapshot do log de runtime ou o log da build mais recente (`source`, `since`, `tail`, `grep`, `level`, `previous`, `preview`). Nunca acompanha continuamente |
| `rebase_cloud_env_list` | — | Chaves de variáveis, nunca valores (`preview`) |
| `rebase_cloud_env_set` | `key`, `value` | Definir uma variável; o valor é enviado via stdin e nunca é retornado (`secret`, `preview`) |
| `rebase_cloud_deployments_list` | — | Implantações recentes e para quais delas é possível fazer rollback (`limit`) |
| `rebase_cloud_projects_list` | — | Todos os projetos que a conta conectada pode acessar, em todas as suas organizações |
| `rebase_cloud_rollback` | — | Colocar um deploy bem-sucedido anterior de volta em serviço (`deploymentId`) |

`rebase_cloud_provision` cria um projeto e vincula este diretório. Ele nunca lê o `baseUrl` do projeto ativo, portanto o gate não o verifica; a CLI o recusa em um diretório que já esteja vinculado.
