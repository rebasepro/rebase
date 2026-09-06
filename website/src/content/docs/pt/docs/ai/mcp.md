---
sourceHash: dcb903c511617dd5
title: Servidor MCP
sidebar_label: Servidor MCP
description: Conecte o Claude Code, Cursor, Gemini CLI ou qualquer cliente MCP a um projeto Rebase — as 42 ferramentas que ele expõe, a credencial com a qual ele se autentica e a proteção de loopback que fica entre um agente e a produção.
---

`@rebasepro/mcp` é um servidor do [Model Context Protocol](https://modelcontextprotocol.io)
que fornece a um assistente de IA ferramentas reais sobre um projeto Rebase: ler e
escrever linhas, gerenciar usuários, executar migrações, invocar funções, controlar o
servidor de desenvolvimento.

Ele se comunica via MCP **apenas por stdio**. Não há porta nem ouvinte (*listener*) — o
processo é tão confiável quanto o processo que o gerou, e não há chamador remoto
para autenticar. Essa é a parte segura. As perguntas interessantes são todas sobre
o que ele faz *depois* que está em execução, e esta página as responde antes de
mostrar o bloco de configuração.

## Conectando um cliente

O servidor é publicado no npm e não precisa de instalação; o `npx` o busca.
Cada bloco abaixo é a integração inteira.

**Claude Code** — `.mcp.json` na raiz do seu projeto. O `rebase init` escreve esse arquivo para você:

```json title=".mcp.json"
{
  "mcpServers": {
    "rebase": {
      "command": "npx",
      "args": ["-y", "@rebasepro/mcp"],
      "env": {
        "REBASE_PROJECT_DIR": "."
      }
    }
  }
}
```

**Cursor** — o mesmo formato, em `.cursor/mcp.json`:

```json title=".cursor/mcp.json"
{
  "mcpServers": {
    "rebase": {
      "command": "npx",
      "args": ["-y", "@rebasepro/mcp"],
      "env": {
        "REBASE_PROJECT_DIR": "."
      }
    }
  }
}
```

**Gemini CLI** — `.gemini/settings.json`, sob a mesma chave:

```json title=".gemini/settings.json"
{
  "mcpServers": {
    "rebase": {
      "command": "npx",
      "args": ["-y", "@rebasepro/mcp"],
      "env": {
        "REBASE_PROJECT_DIR": "."
      }
    }
  }
}
```

**Codex CLI** — TOML em vez de JSON, em `~/.codex/config.toml`. É por usuário, não por projeto, então informe aqui o diretório do projeto:

```toml title="~/.codex/config.toml"
[mcp_servers.rebase]
command = "npx"
args = ["-y", "@rebasepro/mcp"]
env = { REBASE_PROJECT_DIR = "/absolute/path/to/your/project" }
```

**Kiro** — `.kiro/settings/mcp.json`:

```json title=".kiro/settings/mcp.json"
{
  "mcpServers": {
    "rebase": {
      "command": "npx",
      "args": ["-y", "@rebasepro/mcp"],
      "env": {
        "REBASE_PROJECT_DIR": "."
      }
    }
  }
}
```

Qualquer cliente MCP capaz de iniciar um servidor stdio funciona; o formato é o mesmo.

### Em qual diretório ele age

`REBASE_PROJECT_DIR` é o diretório que contém `rebase.json`. Há **uma** ordem de
precedência, e ela é a mesma em todos os clientes:

1. **O bloco de ambiente** — `REBASE_PROJECT_DIR`, `REBASE_BASE_URL`,
   `REBASE_API_TOKEN`. Se alguma delas estiver definida, o projeto `default` é
   reconstruído a partir delas a cada inicialização.
2. **O diretório de trabalho do servidor**, quando contém um `rebase.json`. Um
   projeto em que você está prevalece sobre qualquer coisa lembrada em
   `~/.rebase/projects.json`.
3. **O `default` persistido** em `~/.rebase/projects.json`, quando nenhum dos
   dois primeiros diz nada.

A detecção automática a partir de `.rebase/state.json` preenche lacunas nos três
casos e nunca sobrepõe um valor fornecido por um deles.

Os blocos de nível de projeto definem `REBASE_PROJECT_DIR` como `"."` — o
diretório de trabalho do cliente é o projeto — porque a regra 3 lê um arquivo
compartilhado por todos os projetos da máquina. O bloco do Codex é por usuário em
vez de por projeto, então nomeia um caminho absoluto.

## O que o servidor pode acessar

Esta é a seção para ler antes de apontar um assistente para um banco de dados
importante para você.

O servidor carrega **uma credencial de ambiente para todo o processo**. Não há
identidade por ferramenta e nenhum modo somente leitura; cada ferramenta usa o mesmo token, e a
única opção no pacote habilita (*opts in*) mais alcance em vez de menos.

Qual credencial é essa, em ordem de prioridade:

1. `REBASE_API_TOKEN` / `REBASE_TOKEN` do ambiente
2. `REBASE_SERVICE_KEY` lida do `.env` do projeto
3. A service key descoberta automaticamente a partir de `.rebase/state.json` enquanto `rebase dev`
   está em execução

Um token registrado para um projeto **tem precedência sobre a descoberta automática**. A descoberta
serve apenas para preencher uma lacuna.

:::danger[O caminho sem configuração (zero-config) é uma credencial de administrador]
As opções 2 e 3 são a **service key** — um segredo de administrador sem escopo restrito. O backend
a resolve para `uid: "service"`, `roles: ["admin"]`, `isAdmin: true`. Essa
identidade ignora a lista de permissões da chave de API completamente e satisfaz as
políticas `_default_admin_read` / `_default_admin_write` que o Rebase injeta em
cada coleção que não tenha configurado `disableDefaultPolicies`.

Portanto, a resposta honesta para "o RLS ainda o restringe?" é: o RLS *é executado* — o
driver faz o downgrade para a role `rebase_user` — e então uma política que o próprio Rebase
escreveu concede tudo a essa identidade. Ler todas as linhas de todas as
coleções é o **comportamento projetado da configuração padrão**, não uma falha
de segurança (*bypass*).

Com a configuração zero-config, um agente com essas ferramentas pode ler e escrever em todas as
linhas de todas as coleções, listar todos os usuários, redefinir qualquer senha, invocar qualquer
função de backend e executar DDL contra qualquer `DATABASE_URL` que o projeto resolver.
:::

### Fornecendo uma credencial restrita em vez disso

Registre uma [chave de API](/docs/backend/api#api-keys) com escopo e o modelo de duas
proteções se aplicará de verdade. Uma chave que não seja de administrador é executada com as roles `["service"]`, que
as políticas de administração injetadas **não** nomeiam — portanto, o RLS não concede nada a ela, a menos que uma de
suas próprias políticas determine o contrário, e a lista de permissões a restringe ainda mais:

```bash
rebase api-keys create -n "claude-code" \
  --permissions '[{"collection":"articles","operations":["read"]}]' \
  --expires 30d
```

Então, passe a chave `rk_live_…` resultante para o servidor em vez de deixá-lo
descobrir uma service key:

```json title=".mcp.json"
{
  "mcpServers": {
    "rebase": {
      "command": "npx",
      "args": ["-y", "@rebasepro/mcp"],
      "env": {
        "REBASE_PROJECT_DIR": "/absolute/path/to/your/project",
        "REBASE_API_TOKEN": "rk_live_..."
      }
    }
  }
}
```

Duas coisas que isso **não** faz, ambas importantes de saber antes de depender disso:

- **Isso não restringe as ferramentas de CLI.** `rebase_db_push`, `rebase_db_migrate`,
  `rebase_doctor` e as ferramentas de branch executam a CLI do Rebase, que se conecta com a
  `DATABASE_URL` e nunca vê seu token. A proteção de loopback abaixo é a
  única coisa que protege essas ferramentas.
- **Uma chave não-admin não pode usar as ferramentas de administração.** `list_users`, `create_user`,
  `update_user`, `delete_user`, `list_roles` e `rebase_auth_reset_password`
  estão protegidas por `requireAdmin` e falharão com uma chave com escopo. Esse é o
  funcionamento esperado do sistema, mas significa que você deve escolher entre amplitude de alcance ou restrição, em vez
  de ter ambos.

Uma chave de API com `admin: true` é diferente: ela carrega as roles
`["admin", "service"]`, o que atende às mesmas políticas de admin padrão que a service
key atende. No plano de dados, seu alcance é o mesmo da service key. O que ela adiciona é que
ela é **revogável, expirável e possui limitação de taxa (*rate-limited*) por chave**, nada
disso sendo verdade para a service key — rotacionar a service key significa editar o `.env` e reiniciar o servidor.

Consulte [Agentes e Servidores MCP](/docs/backend/api#agents-and-mcp-servers) para
obter o guia completo de escopo de chaves.

### Colocando uma coleção totalmente fora de alcance

O motivo pelo qual uma credencial de administrador lê tudo é a política básica (*baseline*) que o Rebase
injeta em cada coleção, concedendo acesso ao contexto de servidor confiável e à
role `admin`. Uma coleção pode desativar essa política básica e assumir total
responsabilidade pelo seu próprio RLS:

```typescript
import { defineCollection } from "@rebasepro/cms-types";

export const medicalRecordsCollection = defineCollection({
    slug: "medical_records",
    name: "Medical records",
    table: "medical_records",
    properties: {
        patient_id: { name: "Patient", type: "string" },
        notes: { name: "Notes", type: "string" }
    },
    // Remove the injected admin/server baseline — nothing is readable
    // except what the rules below allow.
    disableDefaultPolicies: true,
    securityRules: [
        { operations: ["select", "update"], ownerField: "patient_id" }
    ]
});
```

Agora, a única maneira de acessar é correspondendo ao `patient_id`. O uid da service key é a
string literal `service`, portanto, uma regra de proprietário (*owner*) nunca corresponderá a ele — as leituras retornarão zero
linhas e as gravações serão rejeitadas pelo Postgres. Este é o único controle que restringe
a credencial padrão do servidor MCP em vez de ignorar as restrições.

Lembre-se de que esta é uma alteração real de RLS, não apenas documental: ela só entra em vigor
após o `rebase schema generate` e uma migração terem aplicado as políticas. Consulte
[Regras de Segurança (RLS)](/docs/collections/security-rules).

## A proteção de loopback

O `rebase_project_add` aceita qualquer `baseUrl`, e as ferramentas de CLI se conectam com
qualquer `DATABASE_URL` declarada pelo projeto. A mesma lista de ferramentas que edita um
banco de dados de rascunho no seu notebook pode, portanto, excluir linhas de produção, sem nada
no meio além do julgamento do assistente sobre qual projeto está ativo.

**Toda ferramenta que altera o ambiente de destino é recusada, a menos que esse destino esteja
na interface de loopback.** A proteção é escrita como uma lista do que *não* é
protegido, portanto, uma ferramenta adicionada posteriormente já chega protegida por padrão.

- **Não protegidas — leituras:** `rebase_schema_plan`, `rebase_doctor`,
  `rebase_db_branch_list`, `rebase_db_branch_info`, `list_documents`,
  `get_document`, `list_users`, `list_roles`, `storage_list_objects`,
  `storage_get_download_url`, `cron_list_jobs`, `cron_get_job`, `cron_get_job_logs`,
  `rebase_dev_logs`.
- **Não protegidas — somente locais:** `rebase_schema_generate`, `rebase_db_generate`,
  `rebase_generate_sdk`, as ferramentas do servidor de desenvolvimento e as ferramentas de registro de projeto.
  Estas gravam arquivos locais ou estado local e não possuem destino remoto para verificar.
- **Protegidas contra `DATABASE_URL`:** as ferramentas de CLI restantes — `rebase_db_push`,
  `rebase_db_migrate`, `rebase_db_branch_create`, `rebase_db_branch_delete`.
- **Protegidas contra a `baseUrl` do projeto:** as ferramentas de SDK restantes —
  `create_document`, `update_document`, `delete_document`, `create_user`,
  `update_user`, `delete_user`, `rebase_auth_reset_password`,
  `storage_delete_object`, `cron_trigger_job`, `cron_toggle_job`,
  `invoke_function`.

Os dois destinos não são intercambiáveis. As ferramentas de CLI nunca veem a `baseUrl`, portanto, um
backend em localhost conectado a uma `DATABASE_URL` de produção é verificado contra
o banco de dados, e não contra o backend.

Uma recusa se parece com isso:

```text
Error: Refusing to run "delete_document": project "default" points at
https://api.example.com/, which is not local. Set REBASE_MCP_ALLOW_REMOTE_WRITES=true
to allow destructive tools against remote environments.
```

**Se nenhuma string de conexão puder ser resolvida, as ferramentas de banco de dados serão recusadas** —
um destino não verificável não é seguro:

```text
Error: Refusing to run "rebase_db_push": no DATABASE_URL could be resolved for
project "default", so the database it would connect to cannot be verified as local.
```

Apenas loopback conta como local: `localhost`, `*.localhost`, `127.0.0.0/8`, `::1`.
Intervalos privados como `10.x` e `192.168.x` **não** contam — estes têm tanta probabilidade de ser
um cluster de staging compartilhado quanto um notebook, e tratá-los como locais permitiria
exatamente o acidente que a proteção existe para evitar.

Defina `REBASE_MCP_ALLOW_REMOTE_WRITES=true` para desativar essa proteção. Definir isso globalmente na
configuração do seu cliente MCP remove a proteção para todos os projetos que o servidor pode acessar,
e não apenas para aquele em que você estava pensando.

## Marcação de dados não confiáveis

Linhas, registros de usuários, listagens de armazenamento, tarefas cron, respostas de funções e saídas
de CLI retornam encapsulados em um envelope explícito:

```text
<<<UNTRUSTED_DATA source="list_documents">>>
[ … rows … ]
<<<END_UNTRUSTED_DATA>>>
```

Qualquer coisa armazenada em seu banco de dados foi gravada por alguém, e chega pelo
mesmo canal que o contrato de ferramentas que o assistente está seguindo. O envelope instrui
o modelo a tratá-lo como conteúdo inerte em vez de instruções.

É um marcador, não uma sandbox. Um assistente que possui essas ferramentas é apenas tão seguro
quanto o conteúdo que você permite que ele leia.

## Múltiplos projetos

As configurações do projeto são armazenadas em `~/.rebase/projects.json`, e o servidor
pode manter vários projetos ao mesmo tempo — útil quando você trabalha entre ambientes locais e
remotos. Enquanto o `rebase dev` está em execução, o servidor lê a porta ativa e a
service key de `.rebase/state.json` no diretório do projeto, que é o que torna o
caso local sem necessidade de configuração (*zero-config*).

:::note[O registo é a última palavra, não a primeira]
Vale a precedência acima: bloco de ambiente, depois o diretório de trabalho
quando contém um `rebase.json`, depois o `default` persistido.

`REBASE_PROJECT_DIR`, `REBASE_BASE_URL` e `REBASE_API_TOKEN` reconstroem o
projeto `default` **em cada arranque**, não apenas no primeiro. A reconstrução
abrange a entrada inteira: um token registado para o `projectDir` anterior é
descartado em vez de ser transportado para um diretório para o qual nunca foi
emitido. Um `default` derivado assim — ou do diretório de trabalho — nunca é
reescrito em `~/.rebase/projects.json`, para que a chave de serviço de
desenvolvimento de um projeto não passe a ser a de outro.

O `activeProject` continua persistente: se uma sessão anterior chamou
`rebase_project_switch`, as ferramentas apontam para esse projeto e o servidor
avisa no stderr — a não ser que esse projeto esteja registado sob um diretório
*diferente* daquele em que este servidor corre, caso em que volta ao `default` e
o diz. Se um assistente parecer estar a ler a base de dados errada, execute
primeiro `rebase_project_current`.
:::

Os tokens são armazenados nesse registro **em texto simples (*plaintext*)**. É um arquivo no seu
diretório pessoal que contém credenciais de administrador para todos os projetos que você registrou; trate-o
com o devido cuidado.

## Referência de ferramentas

42 ferramentas, em nove grupos. As ferramentas marcadas com ⚠ são recusadas contra destinos
não locais, a menos que você desative a proteção.

### Schema e banco de dados (12)

Executam a CLI do Rebase no diretório do projeto ativo.

| Ferramenta | Obrigatório | Descrição |
|---|---|---|
| `rebase_schema_generate` | — | Gerar schema do Drizzle a partir das definições de coleções |
| `rebase_db_push` ⚠ | — | Aplicar o schema diretamente ao banco de dados (atalho de desenvolvimento) |
| `rebase_schema_introspect` | — | Fazer a introspecção do banco de dados ativo para definições de coleções |
| `rebase_db_generate` | — | Gerar arquivos de migração SQL a partir de alterações no schema |
| `rebase_db_migrate` ⚠ | — | Executar todas as migrações SQL pendentes |
| `rebase_generate_sdk` | — | Gerar o SDK TypeScript totalmente tipado |
| `rebase_doctor` | — | Detectar divergências entre definições, schema gerado e o banco de dados ativo |
| `rebase_db_branch_create` ⚠ | `name` | Criar um branch de banco de dados (apenas administradores) |
| `rebase_db_branch_list` | — | Listar branches de banco de dados (apenas administradores) |
| `rebase_db_branch_delete` ⚠ | `name` | Excluir um branch de banco de dados (apenas administradores) |
| `rebase_db_branch_info` | `name` | Informações e status do branch (apenas administradores) |
| `rebase_db_branch_switch` | — | Aponta este checkout para um branch, ou de volta para a base de dados principal (apenas administradores) |

### Planeamento de schema (1)

Pergunta ao backend o que uma alteração faria, via `POST /api/admin/schema/plan`.
Sem CLI e sem nada escrito em disco — funciona na base de dados de desenvolvimento
gerida, onde os comandos apoiados no Atlas não conseguem.

| Ferramenta | Obrigatório | Descrição |
|---|---|---|
| `rebase_schema_plan` | `collectionId`, `collection` | O SQL que a alteração de uma coleção executaria, e que instruções destroem dados |

### Documentos (5)

| Ferramenta | Obrigatório | Descrição |
|---|---|---|
| `list_documents` | `collection` | Listar linhas, com `limit`, `offset`, `orderBy`, `where` opcionais |
| `get_document` | `collection`, `id` | Obter uma única linha por ID |
| `create_document` ⚠ | `collection`, `data` | Criar uma linha |
| `update_document` ⚠ | `collection`, `id`, `data` | Atualizar uma linha |
| `delete_document` ⚠ | `collection`, `id` | Excluir uma linha |

### Usuários e roles (6)

| Ferramenta | Obrigatório | Descrição |
|---|---|---|
| `list_users` | — | Listar todos os usuários, incluindo roles |
| `create_user` ⚠ | `email` | Criar um usuário (`displayName`, `password`, `roles` opcionais) |
| `update_user` ⚠ | `uid` | Atualizar email, nome de exibição ou roles |
| `delete_user` ⚠ | `uid` | Excluir um usuário |
| `list_roles` | — | Listar roles definidas |
| `rebase_auth_reset_password` ⚠ | `email` | Redefinir uma senha via API de administração |

`create_user` e `update_user` aceitam `roles`, portanto qualquer um deles pode conceder privilégios
de administrador. É por isso que eles são protegidos pela barreira em vez de serem tratados apenas como "aditivos".

### Armazenamento (3)

| Ferramenta | Obrigatório | Descrição |
|---|---|---|
| `storage_list_objects` | — | Listar objetos armazenados |
| `storage_get_download_url` | `key` | Uma URL de download assinada temporária e sua expiração — não metadados do objeto |
| `storage_delete_object` ⚠ | `key` | Excluir um objeto |

`storage_get_download_url` é classificado como leitura porque não altera o
ambiente — mas a URL assinada que ele gera é uma capacidade de portador (*bearer capability*) que sobrevive
além da chamada da ferramenta.

### Cron (5)

| Ferramenta | Obrigatório | Descrição |
|---|---|---|
| `cron_list_jobs` | — | Listar tarefas agendadas e seus status |
| `cron_get_job` | `jobId` | Detalhes da tarefa |
| `cron_get_job_logs` | `jobId` | Logs de execução |
| `cron_trigger_job` ⚠ | `jobId` | Executar uma tarefa imediatamente |
| `cron_toggle_job` ⚠ | `jobId`, `enabled` | Habilitar ou desabilitar uma tarefa |

`cron_toggle_job` pode desabilitar silenciosamente uma tarefa de backup ou de faturamento — uma
alteração sem erros e sem saída até que algo faça falta mais tarde.

### Funções (1)

| Ferramenta | Obrigatório | Descrição |
|---|---|---|
| `invoke_function` ⚠ | `name` | Invocar uma [função personalizada](/docs/backend/custom-functions) com qualquer método e payload |

Isso chama um código que o servidor MCP nunca viu, com um método e corpo
escolhidos pelo modelo. Seu raio de impacto (*blast radius*) é o que quer que suas funções façam.

### Servidor de desenvolvimento (3)

| Ferramenta | Obrigatório | Descrição |
|---|---|---|
| `rebase_dev_start` | — | Iniciar o servidor de desenvolvimento; retorna imediatamente |
| `rebase_dev_logs` | — | Ler saídas recentes (padrão de 50 linhas, buffer de 500 linhas) |
| `rebase_dev_stop` | — | Parar o servidor de desenvolvimento |

### Registro de projetos (6)

| Ferramenta | Obrigatório | Descrição |
|---|---|---|
| `rebase_project_list` | — | Listar projetos registrados e mostrar o ativo |
| `rebase_project_switch` | `name` | Alterar o projeto ativo |
| `rebase_project_add` | `name` | Registrar um projeto (`baseUrl`, `projectDir` e `token` opcionais) |
| `rebase_project_remove` | `name` | Remover um projeto (o projeto padrão não pode ser removido) |
| `rebase_project_current` | — | Mostrar o projeto ativo e seu status de autenticação |
| `rebase_project_status` | — | Verificar a integridade (*health-check*) do backend ativo |

`rebase_project_switch` não é protegido, porque ele apenas redireciona todo o
resto em vez de agir diretamente sobre um destino. Portanto, um assistente pode alternar para um
projeto remoto sem acionar a proteção — ele só não poderá executar uma ferramenta destrutiva lá.

## Recursos

Além das ferramentas, o servidor expõe recursos MCP para que um cliente possa obter o
contexto do projeto sem gastar uma chamada de ferramenta:

| URI | Descrição |
|---|---|
| `rebase://collections/{name}` | Código-fonte TypeScript de uma definição de coleção |
| `rebase://schema` | O schema gerado do Drizzle (`schema.generated.ts`) |

As coleções são descobertas a partir de `app/config/collections/`,
`config/collections/` ou `collections/` no diretório do projeto ativo —
o que existir.

`rebase://schema` é listado **apenas se** o schema gerado existir.
O `findBackendDir` procura `backend/` e depois `app/backend/` sob o diretório do
projeto ativo e lê `src/schema.generated.ts` daquele que encontrar — então tanto
o layout do scaffold quanto o deste monorepo funcionam. Um projeto organizado de
uma terceira maneira, ou que ainda não rodou `rebase schema generate`,
simplesmente não verá o recurso oferecido.

## Configuração recomendada

- Aponte o servidor para um projeto **local** e deixe `REBASE_MCP_ALLOW_REMOTE_WRITES`
  não definido. A proteção é o recurso mais valioso do pacote.
- Para qualquer coisa remota, registre uma **chave de API `rk_` com escopo** em vez de deixar
  a descoberta automática fornecer uma service key.
- Verifique `rebase_project_current` quando a saída parecer incorreta. O projeto ativo é
  persistente (*sticky*) e reside fora do seu repositório.
- Trate `~/.rebase/projects.json` como um arquivo de segredos.

---
