---
sourceHash: 5a197121af0d5219
title: Servidor MCP
sidebar_label: Servidor MCP
description: Conecte o Claude Code, Cursor, Gemini CLI ou qualquer cliente MCP a um projeto Rebase — as 42 ferramentas expostas, a credencial com a qual ele se autentica e o gate de loopback que fica entre um agente e a produção.
---

O `@rebasepro/mcp` é um servidor do [Model Context Protocol](https://modelcontextprotocol.io)
que fornece a um assistente de IA ferramentas reais sobre um projeto Rebase: ler e
gravar linhas, gerenciar usuários, executar migrações, invocar funções, controlar
o servidor de desenvolvimento.

Ele se comunica via MCP **apenas por stdio**. Não há porta nem listener — o
processo é tão confiável quanto aquilo que o iniciou, e não há chamador remoto
para autenticar. Essa é a parte segura. As perguntas interessantes são todas
sobre o que ele faz *depois* de estar em execução, e esta página as responde
antes de mostrar o bloco de configuração.

Um backend implantado também pode servir MCP diretamente, via HTTP, para as
pessoas que usam sua aplicação. Isso é algo diferente com um modelo de credenciais
diferente: consulte [O endpoint remoto](#o-endpoint-remoto).

## Conectando um cliente

O servidor é publicado no npm e não precisa de etapa de instalação; o `npx` o busca
automaticamente. Cada bloco abaixo representa a integração completa.

**Claude Code** — `.mcp.json` na raiz do seu projeto. O `rebase init` grava esse
arquivo para você:

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

**Cursor** — a mesma estrutura, em `.cursor/mcp.json`:

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

**Codex CLI** — TOML em vez de JSON, em `~/.codex/config.toml`. É em nível de usuário,
não por projeto, portanto especifique o diretório do projeto aqui:

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

Qualquer cliente MCP capaz de iniciar um servidor via stdio funciona; a estrutura
é a mesma.

### Em qual diretório ele atua

`REBASE_PROJECT_DIR` é o diretório que contém o `rebase.json`. Existe **uma**
ordem de precedência, e ela é a mesma em todos os clientes:

1. **O bloco de ambiente** — `REBASE_PROJECT_DIR`, `REBASE_BASE_URL`,
   `REBASE_API_TOKEN`. Se algum deles estiver definido, o projeto `default` é reconstruído
   a partir deles a cada inicialização.
2. **O diretório de trabalho do servidor**, quando ele contém um `rebase.json`. Um projeto
   no qual você está atualmente tem prioridade sobre qualquer coisa memorizada em `~/.rebase/projects.json`.
3. **O `default` persistido** em `~/.rebase/projects.json`, quando nenhum dos
   dois primeiros define nada.

A autodescoberta a partir de `.rebase/state.json` preenche lacunas em todos os três
casos e nunca substitui um valor fornecido por um deles.

Os blocos em nível de projeto definem `REBASE_PROJECT_DIR` como `"."` — o diretório
de trabalho do cliente é o projeto — porque a regra 3 lê um arquivo compartilhado por
todos os projetos na máquina. O bloco do Codex é em nível de usuário em vez de por
projeto, portanto, ele especifica um caminho absoluto.

## O que o servidor pode alcançar

Esta é a seção para ler antes de apontar um assistente para um banco de dados
importante para você.

O servidor carrega **uma única credencial de ambiente para todo o processo**. Não
há identidade por ferramenta e nenhum modo somente leitura; cada ferramenta usa o
mesmo token, e a única opção no pacote habilita (*opts in*) mais alcance em vez de
menos.

Qual credencial é essa, em ordem de prioridade:

1. `REBASE_API_TOKEN` / `REBASE_TOKEN` do ambiente
2. `REBASE_SERVICE_KEY` lida a partir do `.env` do projeto
3. A service key autodescoberta de `.rebase/state.json` enquanto `rebase dev`
   estiver em execução

Um token registrado para um projeto **tem precedência sobre a autodescoberta**.
A descoberta apenas preenche uma lacuna.

:::danger[O caminho sem configuração (zero-config) é uma credencial de administrador]
As opções 2 e 3 são a **service key** — um segredo de administrador sem restrição
de escopo. O backend a resolve como `uid: "service"`, `roles: ["admin"]`,
`isAdmin: true`. Essa identidade ignora completamente a lista de permissões da
chave de API e satisfaz as políticas `_default_admin_read` / `_default_admin_write`
que o Rebase injeta em cada coleção que não tenha configurado `disableDefaultPolicies`.

Então a resposta honesta para "o RLS ainda o restringe?" é: o RLS *é executado* — o
driver faz o downgrade para a role `rebase_user` — e então uma política que o próprio
Rebase escreveu concede tudo a essa identidade. Ler cada linha de cada coleção é o
**comportamento projetado da configuração padrão**, não uma falha ou bypass.

Com a configuração zero-config, um agente de posse dessas ferramentas pode ler e
gravar cada linha de cada coleção, listar todos os usuários, redefinir qualquer senha,
invocar qualquer função de backend e executar DDL em qualquer `DATABASE_URL` para
a qual o projeto apontar.
:::

### Fornecendo uma credencial restrita

Registre uma [chave de API](/docs/backend/api-keys) com escopo restrito e o modelo
de duas barreiras será aplicado de verdade. Uma chave que não seja de administrador
é executada com as roles `["service"]`, que as políticas de administrador injetadas
**não** mencionam — portanto, o RLS não concede nada a ela a menos que uma de suas
próprias políticas determine o contrário, e a lista de permissões a restringe ainda mais:

```bash
rebase api-keys create -n "claude-code" \
  --permissions '[{"collection":"articles","operations":["read"]}]' \
  --expires 30d
```

Em seguida, forneça a chave `rk_live_…` resultante ao servidor em vez de deixá-lo
descobrir uma chave de serviço:

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

Duas coisas que isso **não** faz, ambas importantes de saber antes de confiar nisso:

- **Isso não restringe as ferramentas de CLI.** `rebase_db_push`, `rebase_db_migrate`,
  `rebase_doctor` e as ferramentas de branch executam a CLI do Rebase, que se conecta
  com a `DATABASE_URL` e nunca vê o seu token. O gate de loopback abaixo é a única
  barreira diante delas.
- **Uma chave que não seja de administrador não pode usar as ferramentas de administração.**
  `list_users`, `create_user`, `update_user`, `delete_user`, `list_roles` e
  `rebase_auth_reset_password` ficam protegidas por `requireAdmin` e falharão com uma
  chave de escopo restrito. Esse é o sistema funcionando como esperado, mas significa
  escolher entre amplitude de acesso e restrição em vez de obter ambos.

Uma chave de API com `admin: true` é uma questão diferente: ela carrega as roles
`["admin", "service"]`, o que atende às mesmas políticas padrão de administrador que a
service key atende. No plano de dados, o seu alcance é o mesmo da service key. O que ela
adiciona é que ela é **revogável, expirável e possui limitação de taxa (rate-limited) por chave**,
nada do que se aplica à service key — rotacionar esta última significa editar o `.env` e
reiniciar o servidor.

Consulte [Agentes e Servidores MCP](/docs/backend/api-keys#agents-and-mcp-servers) para
obter o guia completo de escopo de chaves.

### Deixando uma coleção completamente inacessível

A razão pela qual uma credencial de administrador lê tudo é a política básica que o Rebase
injeta em cada coleção, concedendo acesso ao contexto confiável do servidor e à
role `admin`. Uma coleção pode optar por não usar essa política padrão e assumir
total responsabilidade por seu próprio RLS:

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

Agora, a única maneira de ter acesso é correspondendo ao `patient_id`. O uid da service key
é a string literal `service`, de modo que uma regra de proprietário (owner) nunca
corresponde a ela — as leituras retornam zero linhas e as gravações são rejeitadas pelo
Postgres. Este é o único controle que restringe a credencial padrão do servidor MCP em
vez de ignorar as restrições.

Lembre-se de que essa é uma alteração real de RLS, não documental: ela entra em vigor
apenas após `rebase schema generate` e uma migração terem aplicado as políticas. Consulte
[Regras de Segurança (RLS)](/docs/collections/security-rules).

## O gate de loopback

`rebase_project_add` aceita qualquer `baseUrl`, e as ferramentas de CLI se conectam a
qualquer `DATABASE_URL` declarada pelo projeto. Portanto, a mesma lista de ferramentas que
edita um banco de dados de rascunho no seu notebook pode remover linhas de produção, sem
nada entre eles além do julgamento do assistente sobre qual projeto está ativo.

**Qualquer ferramenta que altere o ambiente de destino é recusada, a menos que esse destino
esteja na interface de loopback.** O gate é construído como uma lista do que *não* é
bloqueado, de modo que uma ferramenta adicionada posteriormente chegue protegida por padrão.

- **Não bloqueadas — leituras:** `rebase_schema_plan`, `rebase_doctor`,
  `rebase_db_branch_list`, `rebase_db_branch_info`, `list_documents`,
  `get_document`, `list_users`, `list_roles`, `storage_list_objects`,
  `storage_get_download_url`, `cron_list_jobs`, `cron_get_job`, `cron_get_job_logs`,
  `rebase_dev_logs`.
- **Não bloqueadas — apenas locais:** `rebase_schema_introspect`, `rebase_schema_generate`, `rebase_db_generate`,
  `rebase_generate_sdk`, as ferramentas do servidor de desenvolvimento e as ferramentas de registro de projeto.
  Elas gravam arquivos locais ou estado local e não possuem um destino remoto para verificar.
- **Bloqueadas contra `DATABASE_URL`:** as ferramentas de CLI restantes — `rebase_db_push`,
  `rebase_db_migrate`, `rebase_db_branch_create`, `rebase_db_branch_delete`.
- **Bloqueadas contra a `baseUrl` do projeto:** as ferramentas de SDK restantes —
  `create_document`, `update_document`, `delete_document`, `create_user`,
  `update_user`, `delete_user`, `rebase_auth_reset_password`,
  `storage_delete_object`, `cron_trigger_job`, `cron_toggle_job`,
  `invoke_function`.

Os dois destinos não são intercambiáveis. As ferramentas de CLI nunca veem `baseUrl`,
portanto, um backend em localhost configurado ao lado de uma `DATABASE_URL` de produção
é verificado em relação ao banco de dados, e não ao backend.

Uma recusa se parece com isto:

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
Faixas privadas como `10.x` e `192.168.x` **não** contam — há tantas chances de serem
um cluster de staging compartilhado quanto um notebook, e tratá-las como locais
permitiria exatamente o acidente que o gate existe para evitar.

Defina `REBASE_MCP_ALLOW_REMOTE_WRITES=true` para desativar essa proteção. Defini-la
globalmente na configuração do seu cliente MCP remove o gate para todos os projetos
que o servidor pode alcançar, não apenas aquele em que você estava pensando.

## Marcação de dados não confiáveis

Linhas, registros de usuários, listagens de armazenamento, tarefas cron, respostas
de funções e saídas de CLI retornam encapsulados em um envelope explícito:

```text
<<<UNTRUSTED_DATA source="list_documents">>>
[ … rows … ]
<<<END_UNTRUSTED_DATA>>>
```

Qualquer coisa armazenada em seu banco de dados foi escrita por alguém, e chega
pelo mesmo canal que o contrato de ferramentas que o assistente está seguindo.
O envelope instrui o modelo a tratar isso como conteúdo inerte em vez de instruções.

É um marcador, não uma sandbox. Um assistente de posse dessas ferramentas é tão seguro
quanto o conteúdo que você permite que ele leia.

## Múltiplos projetos

As configurações de projeto são armazenadas em `~/.rebase/projects.json`, e o
servidor pode manter várias ao mesmo tempo — útil ao trabalhar entre ambientes locais
e remotos. Enquanto o `rebase dev` está em execução, o servidor lê a porta ativa e a
service key de `.rebase/state.json` no diretório do projeto, que é o que torna o
caso local zero-config.

:::note[O registro é a última palavra, não a primeira]
A precedência é a descrita acima: bloco de ambiente, depois o diretório de trabalho
quando contém um `rebase.json`, e então o `default` persistido.

`REBASE_PROJECT_DIR`, `REBASE_BASE_URL` e `REBASE_API_TOKEN` reconstroem o projeto
`default` **a cada inicialização**, não apenas na primeira. A reconstrução é da
entrada inteira: um token registrado para o `projectDir` antigo é descartado em vez
de ser transferido para um diretório para o qual nunca foi emitido. Um `default`
derivado dessa forma — ou a partir do diretório de trabalho — nunca é regravado em
`~/.rebase/projects.json`, para que a service key de desenvolvimento de um projeto não
se torne a de outro.

O `activeProject` é persistente (sticky), portanto, se uma sessão anterior chamou
`rebase_project_switch`, as ferramentas terão como alvo esse projeto e o servidor
informará isso no stderr — a menos que esse projeto esteja registrado em um diretório
*diferente* daquele em que este servidor é executado, caso em que ele volta para o
`default` e informa isso. Se um assistente parecer estar lendo o banco de dados errado,
chame `rebase_project_current` primeiro.
:::

Os tokens são armazenados nesse registro **em texto simples (plaintext)**. Trata-se
de um arquivo em seu diretório home contendo credenciais de administrador para todos
os projetos registrados; trate-o com o devido cuidado.

## Referência de ferramentas

42 ferramentas, em nove grupos. Ferramentas marcadas com ⚠ são recusadas contra
destinos não locais, a menos que você desative essa restrição.

### Schema e banco de dados (12)

Executam a CLI do Rebase no diretório do projeto ativo.

| Ferramenta | Obrigatório | Descrição |
|---|---|---|
| `rebase_schema_generate` | — | Gera o schema Drizzle a partir das definições de coleção |
| `rebase_db_push` ⚠ | — | Aplica o schema diretamente ao banco de dados (atalho de desenvolvimento) |
| `rebase_schema_introspect` | — | Faz introspecção do banco de dados ativo em definições de coleção |
| `rebase_db_generate` | — | Gera arquivos de migração SQL a partir das alterações de schema |
| `rebase_db_migrate` ⚠ | — | Executa todas as migrações SQL pendentes |
| `rebase_generate_sdk` | — | Gera o SDK TypeScript totalmente tipado |
| `rebase_doctor` | — | Detecta discrepâncias (drift) entre as definições, o schema gerado e o banco de dados ativo |
| `rebase_db_branch_create` ⚠ | `name` | Cria um branch de banco de dados (somente administradores) |
| `rebase_db_branch_list` | — | Lista branches de banco de dados (somente administradores) |
| `rebase_db_branch_delete` ⚠ | `name` | Exclui um branch de banco de dados (somente administradores) |
| `rebase_db_branch_info` | `name` | Informações e status do branch (somente administradores) |
| `rebase_db_branch_switch` | — | Aponta este checkout para um branch, ou de volta para o banco de dados principal (somente administradores) |

### Planejamento de schema (1)

Pergunta ao backend o que uma alteração faria, via `POST /api/admin/schema/plan`.
Sem CLI e nada gravado no disco — funciona no banco de dados de desenvolvimento
gerenciado, o que os comandos suportados pelo Atlas não conseguem.

| Ferramenta | Obrigatório | Descrição |
|---|---|---|
| `rebase_schema_plan` | `collectionId`, `collection` | O SQL que a alteração de uma coleção executaria e quais instruções destroem dados |

### Documentos (5)

| Ferramenta | Obrigatório | Descrição |
|---|---|---|
| `list_documents` | `collection` | Lista linhas, com `limit`, `offset`, `orderBy`, `where` opcionais |
| `get_document` | `collection`, `id` | Busca uma única linha por ID |
| `create_document` ⚠ | `collection`, `data` | Cria uma linha |
| `update_document` ⚠ | `collection`, `id`, `data` | Atualiza uma linha |
| `delete_document` ⚠ | `collection`, `id` | Exclui uma linha |

### Usuários e roles (6)

| Ferramenta | Obrigatório | Descrição |
|---|---|---|
| `list_users` | — | Lista todos os usuários, incluindo roles |
| `create_user` ⚠ | `email` | Cria um usuário (`displayName`, `password`, `roles` opcionais) |
| `update_user` ⚠ | `uid` | Atualiza e-mail, nome de exibição ou roles |
| `delete_user` ⚠ | `uid` | Exclui um usuário |
| `list_roles` | — | Lista as roles definidas |
| `rebase_auth_reset_password` ⚠ | `email` | Redefine uma senha via API de administração |

`create_user` e `update_user` aceitam `roles`, portanto, qualquer um deles pode
conceder privilégios de administrador. É por isso que são bloqueados em vez de
serem tratados como meramente "aditivos".

### Armazenamento (Storage) (3)

| Ferramenta | Obrigatório | Descrição |
|---|---|---|
| `storage_list_objects` | — | Lista objetos armazenados |
| `storage_get_download_url` | `key` | Uma URL assinada temporária para download e sua expiração — não os metadados do objeto |
| `storage_delete_object` ⚠ | `key` | Exclui um objeto |

`storage_get_download_url` é classificada como uma leitura porque não altera o
ambiente — mas a URL assinada gerada concede permissão direta de acesso (bearer
capability) que sobrevive à chamada da ferramenta.

### Cron (5)

| Ferramenta | Obrigatório | Descrição |
|---|---|---|
| `cron_list_jobs` | — | Lista tarefas agendadas e seus status |
| `cron_get_job` | `jobId` | Detalhes da tarefa |
| `cron_get_job_logs` | `jobId` | Logs de execução |
| `cron_trigger_job` ⚠ | `jobId` | Executa uma tarefa imediatamente |
| `cron_toggle_job` ⚠ | `jobId`, `enabled` | Habilita ou desabilita uma tarefa |

O `cron_toggle_job` pode desabilitar silenciosamente um backup ou uma tarefa de
faturamento — uma alteração sem erro e sem saída até que algo esteja faltando mais tarde.

### Funções (1)

| Ferramenta | Obrigatório | Descrição |
|---|---|---|
| `invoke_function` ⚠ | `name` | Invoca uma [função customizada](/docs/backend/custom-functions) com qualquer método e payload |

Isso chama código que o servidor MCP nunca viu, com um método e corpo escolhidos
pelo modelo. Seu raio de impacto (*blast radius*) corresponde a qualquer coisa que
suas funções façam.

### Servidor de desenvolvimento (3)

| Ferramenta | Obrigatório | Descrição |
|---|---|---|
| `rebase_dev_start` | — | Inicia o servidor de desenvolvimento; retorna imediatamente |
| `rebase_dev_logs` | — | Lê a saída recente (padrão de 50 linhas, buffer de 500 linhas) |
| `rebase_dev_stop` | — | Para o servidor de desenvolvimento |

### Registro de projetos (6)

| Ferramenta | Obrigatório | Descrição |
|---|---|---|
| `rebase_project_list` | — | Lista os projetos registrados e mostra o projeto ativo |
| `rebase_project_switch` | `name` | Altera o projeto ativo |
| `rebase_project_add` | `name` | Registra um projeto (`baseUrl`, `projectDir` e `token` opcionais) |
| `rebase_project_remove` | `name` | Remove um projeto (o projeto padrão não pode ser removido) |
| `rebase_project_current` | — | Mostra o projeto ativo e seu status de autenticação |
| `rebase_project_status` | — | Executa health check no backend ativo |

`rebase_project_switch` não é bloqueada, porque ela redireciona todo o restante
em vez de agir diretamente em um destino. Um assistente pode, portanto, alternar
para um projeto remoto sem acionar o gate — ele apenas não poderá executar uma
ferramenta destrutiva lá.

## Recursos (Resources)

Além das ferramentas, o servidor expõe recursos (resources) do MCP para que um
cliente possa extrair o contexto do projeto sem gastar uma chamada de ferramenta:

| URI | Descrição |
|---|---|
| `rebase://collections/{name}` | Código-fonte TypeScript da definição de uma coleção |
| `rebase://schema` | O schema Drizzle gerado (`schema.generated.ts`) |

As coleções são descobertas a partir de `app/config/collections/`,
`config/collections/` ou `collections/` no diretório do projeto ativo — o que existir.

`rebase://schema` é listado **apenas se** o schema gerado existir.
`findBackendDir` procura por `backend/` e depois por `app/backend/` no diretório
do projeto ativo, e lê `src/schema.generated.ts` do que encontrar — portanto, tanto
a estrutura padrão quanto a deste monorepo funcionam, e um projeto estruturado
de uma terceira forma, ou que ainda não executou `rebase schema generate`,
simplesmente não verá o recurso disponibilizado.

## O endpoint remoto

Tudo acima é uma ferramenta de desenvolvedor: ela é executada em sua máquina e
possui uma service key ou uma chave de API. Um backend implantado também pode
servir o próprio MCP, em `/mcp`, para as pessoas que usam sua aplicação. Um
assistente conectado por uma delas lê e grava no projeto **como essa pessoa**,
e cada chamada é executada sob sua própria segurança em nível de linha (row-level security / RLS).

Ele fica desativado a menos que você o ative, e ambas as variáveis são obrigatórias:

```bash
REBASE_MCP_ENABLED=true
REBASE_PUBLIC_URL=https://app.example.com   # this deployment's real origin
```

Sem `REBASE_PUBLIC_URL`, um segredo JWT ou um driver de dados capaz de restringir uma
consulta a um único usuário, o endpoint recusa a montagem e informa o motivo no log
de inicialização. Nenhuma `REBASE_ROLE` o ativa.

- **OAuth, com uma tela de consentimento.** O cliente localiza o servidor de autorização
  por meio de `/.well-known/oauth-protected-resource`, registra a si mesmo (o registro
  dinâmico está ativado por padrão; `REBASE_MCP_OPEN_REGISTRATION=false` limita aos
  clientes que você registrar) e envia o usuário para uma tela de consentimento que
  realiza o login através do seu `/auth/login` existente.
- **Seis ferramentas, dois escopos.** `mcp:read` oferece `list_collections`,
  `query_collection` e `get_document`; `mcp:write` adiciona `create_document`,
  `update_document` e `delete_document`. O escopo define quais ferramentas são
  disponibilizadas, não quais linhas: uma lista vazia pode ser o RLS em funcionamento,
  e `mcp:write` ainda não poderá gravar uma linha que a própria pessoa não pudesse.
- **Um token exclusivo para este endpoint.** Um token de acesso MCP é recusado por
  `/api/data`, `/api/admin` e pelo WebSocket, portanto, conectar um assistente não
  concede a ele uma sessão geral.

Uma limitação. Desconectar um cliente (`DELETE /api/oauth/grants/:clientId`, com a
própria sessão da pessoa) revoga seus tokens de atualização (refresh tokens)
imediatamente, mas um token de acesso já emitido continua funcionando até expirar,
dentro de uma hora. Essa mesma hora limita todo o resto: cada atualização relê as
roles da pessoa e recusa uma conta que foi excluída ou uma concessão anterior ao seu
último "sair de todos os lugares" ou troca de senha. Assim, um rebaixamento ou uma
saída chega a um cliente conectado dentro da vida útil de um token de acesso. Uma
sessão de convidado não pode dar consentimento.

As rotas estão em [Endpoints](/docs/backend/endpoints/#mcp-surface) e as variáveis
em [Configuração](/docs/getting-started/configuration/#mcp-surface).

## Configuração recomendada

- Aponte o servidor para um projeto **local** e deixe `REBASE_MCP_ALLOW_REMOTE_WRITES`
  indefinida. O gate é o recurso mais valioso do pacote.
- Para qualquer coisa remota, registre uma **chave de API `rk_` com escopo restrito**
  em vez de permitir que a autodescoberta entregue uma service key.
- Verifique `rebase_project_current` quando a saída parecer incorreta. O projeto ativo
  é persistente (sticky) e reside fora do seu repositório.
- Trate `~/.rebase/projects.json` como um arquivo de segredos.
