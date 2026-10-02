---
title: Referência de ferramentas do MCP
sidebar_label: Referência de ferramentas do MCP
description: Toda ferramenta que o servidor MCP do Rebase registra, por grupo — o que cada uma precisa e faz, e quais o gate de loopback recusa contra um projeto não local.
---

As ferramentas que o [`@rebasepro/mcp`](/docs/ai/mcp) oferece a um assistente. Como ele se conecta,
qual credencial ele possui e como o [gate de loopback](/docs/ai/mcp#the-loopback-gate)
decide o que ⚠ significa estão na página do [servidor MCP](/docs/ai/mcp).

42 ferramentas, divididas em nove grupos. As ferramentas marcadas com ⚠ são recusadas contra destinos não locais,
a menos que você desative essa proteção.

## Schema e banco de dados (12)

Executam a CLI do Rebase no diretório do projeto ativo.

| Ferramenta | Obrigatório | Descrição |
|---|---|---|
| `rebase_schema_generate` | — | Gera o schema Drizzle a partir das definições das coleções |
| `rebase_db_push` ⚠ | — | Aplica o schema diretamente ao banco de dados (atalho para dev) |
| `rebase_schema_introspect` | — | Faz introspecção do banco de dados ativo gerando definições de coleções |
| `rebase_db_generate` | — | Gera arquivos de migração SQL a partir das alterações de schema |
| `rebase_db_migrate` ⚠ | — | Executa todas as migrações SQL pendentes |
| `rebase_generate_sdk` | — | Gera o SDK TypeScript totalmente tipado |
| `rebase_doctor` | — | Detecta divergências entre definições, schema gerado e o banco de dados ativo |
| `rebase_db_branch_create` ⚠ | `name` | Cria uma branch de banco de dados (somente admins) |
| `rebase_db_branch_list` | — | Lista as branches de banco de dados (somente admins) |
| `rebase_db_branch_delete` ⚠ | `name` | Exclui uma branch de banco de dados (somente admins) |
| `rebase_db_branch_info` | `name` | Informações e status da branch (somente admins) |
| `rebase_db_branch_switch` | — | Aponta este checkout para uma branch ou de volta ao banco principal (somente admins) |

## Planejamento de schema (1)

Pergunta ao backend o que uma alteração faria, via `POST /api/admin/schema/plan`. Não usa
CLI e nada é gravado em disco — funciona no banco de desenvolvimento gerenciado,
o que os comandos baseados em Atlas não conseguem fazer.

| Ferramenta | Obrigatório | Descrição |
|---|---|---|
| `rebase_schema_plan` | `collectionId`, `collection` | O SQL que a alteração de uma coleção executaria e quais instruções destroem dados |

## Documentos (5)

| Ferramenta | Obrigatório | Descrição |
|---|---|---|
| `list_documents` | `collection` | Lista linhas, com `limit`, `offset`, `orderBy`, `where` opcionais |
| `get_document` | `collection`, `id` | Busca uma única linha por ID |
| `create_document` ⚠ | `collection`, `data` | Cria uma linha |
| `update_document` ⚠ | `collection`, `id`, `data` | Atualiza uma linha |
| `delete_document` ⚠ | `collection`, `id` | Exclui uma linha |

## Usuários e roles (6)

| Ferramenta | Obrigatório | Descrição |
|---|---|---|
| `list_users` | — | Lista todos os usuários, incluindo roles |
| `create_user` ⚠ | `email` | Cria um usuário (`displayName`, `password`, `roles` opcionais) |
| `update_user` ⚠ | `uid` | Atualiza email, nome de exibição ou roles |
| `delete_user` ⚠ | `uid` | Exclui um usuário |
| `list_roles` | — | Lista as roles definidas |
| `rebase_auth_reset_password` ⚠ | `email` | Redefine uma senha via API admin |

`create_user` e `update_user` aceitam `roles`, portanto qualquer um deles pode conceder
acesso de administrador. É por isso que são bloqueados em vez de serem tratados apenas como "aditivos".

## Storage (3)

| Ferramenta | Obrigatório | Descrição |
|---|---|---|
| `storage_list_objects` | — | Lista objetos armazenados |
| `storage_get_download_url` | `key` | Uma URL assinada temporária para download e sua expiração — não metadados do objeto |
| `storage_delete_object` ⚠ | `key` | Exclui um objeto |

`storage_get_download_url` é classificada como leitura porque não altera o
ambiente — mas a URL assinada que ela gera concede acesso (bearer capability) que persiste
após a chamada da ferramenta.

## Cron (5)

| Ferramenta | Obrigatório | Descrição |
|---|---|---|
| `cron_list_jobs` | — | Lista tarefas agendadas e seus status |
| `cron_get_job` | `jobId` | Detalhes da tarefa |
| `cron_get_job_logs` | `jobId` | Logs de execução |
| `cron_trigger_job` ⚠ | `jobId` | Executa uma tarefa imediatamente |
| `cron_toggle_job` ⚠ | `jobId`, `enabled` | Ativa ou desativa uma tarefa |

`cron_toggle_job` pode desativar silenciosamente um backup ou um job de faturamento — uma alteração
sem erro e sem saída até que algo faça falta mais tarde.

## Funções (1)

| Ferramenta | Obrigatório | Descrição |
|---|---|---|
| `invoke_function` ⚠ | `name` | Invoca uma [função customizada](/docs/backend/custom-functions) com qualquer método e payload |

Isso chama código que o servidor MCP nunca viu, com um método e corpo escolhidos
pelo modelo. Seu raio de impacto é tudo aquilo que suas funções puderem fazer.

## Servidor de desenvolvimento (3)

| Ferramenta | Obrigatório | Descrição |
|---|---|---|
| `rebase_dev_start` | — | Inicia o servidor de desenvolvimento; retorna imediatamente |
| `rebase_dev_logs` | — | Lê saídas recentes (padrão de 50 linhas, buffer de 500 linhas) |
| `rebase_dev_stop` | — | Para o servidor de desenvolvimento |

## Registro de projetos (6)

| Ferramenta | Obrigatório | Descrição |
|---|---|---|
| `rebase_project_list` | — | Lista projetos registrados e mostra o ativo |
| `rebase_project_switch` | `name` | Altera o projeto ativo |
| `rebase_project_add` | `name` | Registra um projeto (`baseUrl`, `projectDir` e `token` opcionais) |
| `rebase_project_remove` | `name` | Remove um projeto (o projeto default não pode ser removido) |
| `rebase_project_current` | — | Mostra o projeto ativo e seu status de autenticação |
| `rebase_project_status` | — | Verifica a integridade (health-check) do backend ativo |

`rebase_project_switch` não é bloqueado, pois redireciona todo o restante
em vez de agir diretamente em um alvo. Um assistente pode, portanto, alternar para um
projeto remoto sem disparar o gate — ele apenas não poderá executar uma ferramenta
destrutiva lá.
