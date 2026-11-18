---
sourceHash: e0ed23817228dbd2
title: Servidor MCP
sidebar_label: Servidor MCP
description: Conecte o Claude Code, Cursor, Gemini CLI ou qualquer cliente MCP a um projeto Rebase — as 53 ferramentas que ele expõe, a credencial com a qual se autentica e a barreira de loopback que fica entre um agente e a produção.
---

`@rebasepro/mcp` é um servidor [Model Context Protocol](https://modelcontextprotocol.io)
que disponibiliza ferramentas reais para um assistente de IA em um projeto Rebase:
ler e gravar linhas, gerenciar usuários, executar migrações, invocar funções e controlar o
servidor de desenvolvimento.

Ele se comunica via MCP **apenas por stdio**. Não há porta nem ouvinte (listener) — o
processo tem exatamente a mesma confiança de quem o inicializou, e não há chamador
remoto para autenticar. Essa é a parte segura. As perguntas interessantes dizem
respeito ao que ele faz *depois* de estar em execução, e esta página as responde
antes de mostrar o bloco de configuração.

Um backend implantado também pode servir o MCP diretamente, via HTTP, para as pessoas que usam
sua aplicação. Isso é algo diferente, com um modelo de credenciais diferente:
consulte [The Remote MCP Endpoint](/docs/ai/remote-mcp/).

:::tip[Usando o Claude na web, desktop ou mobile?]
Adicione o [conector Rebase](/docs/ai/rebase-connector/) em vez disso:
`https://app.rebase.pro/mcp`, uma vez, para cada projeto executado no Rebase Cloud
ou em seus próprios servidores. Esta página trata do servidor local que um assistente de código
inicia dentro de um projeto.
:::

## Conectando um cliente

O servidor roda a partir do seu projeto: `@rebasepro/mcp` é uma devDependency fixada pela
CLI em todo scaffold do `rebase init`, e cada bloco abaixo — toda a integração — inicia
essa cópia (`pnpm exec rebase-mcp`, ou `npx --no rebase-mcp` em um projeto npm),
nunca uma mais recente do npm. Um projeto mais antigo pode adicioná-lo uma vez com
`rebase skills install --mcp` ou `pnpm add -D @rebasepro/mcp`.

O `rebase init` grava o bloco para cada agente selecionado quando
[configura seus agentes de programação com IA](/docs/ai/skills#set-up-by-rebase-init), mantendo
quaisquer outros servidores já presentes no arquivo. `rebase init --agent cursor,codex`
faz o mesmo sem perguntar.

**Claude Code** — `.mcp.json` na raiz do seu projeto. O `rebase init` grava este
arquivo para você:

```json title=".mcp.json"
{
  "mcpServers": {
    "rebase": {
      "command": "pnpm",
      "args": ["exec", "rebase-mcp"],
      "env": {
        "REBASE_PROJECT_DIR": "."
      }
    }
  }
}
```

**Cursor** — o mesmo formato, em `.cursor/mcp.json`. O Cursor expande
`${workspaceFolder}` para a raiz do projeto:

```json title=".cursor/mcp.json"
{
  "mcpServers": {
    "rebase": {
      "command": "pnpm",
      "args": ["exec", "rebase-mcp"],
      "env": {
        "REBASE_PROJECT_DIR": "${workspaceFolder}"
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
      "command": "pnpm",
      "args": ["exec", "rebase-mcp"],
      "env": {
        "REBASE_PROJECT_DIR": "."
      }
    }
  }
}
```

**Codex CLI** — TOML em vez de JSON, no arquivo `.codex/config.toml` do projeto.
O Codex só lê a configuração do projeto depois que você confiar nele:

```toml title=".codex/config.toml"
[mcp_servers.rebase]
command = "pnpm"
args = ["exec", "rebase-mcp"]

[mcp_servers.rebase.env]
REBASE_PROJECT_DIR = "."
```

**Kiro** — `.kiro/settings/mcp.json`:

```json title=".kiro/settings/mcp.json"
{
  "mcpServers": {
    "rebase": {
      "command": "pnpm",
      "args": ["exec", "rebase-mcp"],
      "env": {
        "REBASE_PROJECT_DIR": "."
      }
    }
  }
}
```

**GitHub Copilot no VS Code** — `.vscode/mcp.json`, sob `servers` e com
um transporte explícito:

```json title=".vscode/mcp.json"
{
  "servers": {
    "rebase": {
      "type": "stdio",
      "command": "pnpm",
      "args": ["exec", "rebase-mcp"],
      "env": {
        "REBASE_PROJECT_DIR": "${workspaceFolder}"
      }
    }
  }
}
```

O **Windsurf** lê servidores MCP apenas a partir de sua configuração no nível do usuário,
portanto não há arquivo de projeto para gravar. Adicione o servidor em suas configurações de MCP
como `"command": "pnpm"`, `"args": ["--dir", "/absolute/path/to/your/project", "exec", "rebase-mcp"]`,
com esse caminho como `REBASE_PROJECT_DIR`.

Qualquer cliente MCP capaz de iniciar um servidor stdio funciona; o formato é o mesmo.

### Em qual diretório ele atua

`REBASE_PROJECT_DIR` é o diretório que contém `rebase.json`. Há **uma**
ordem de precedência, e ela é a mesma em todos os clientes:

1. **O bloco de ambiente** — `REBASE_PROJECT_DIR`, `REBASE_BASE_URL`,
   `REBASE_API_TOKEN`. Se qualquer um deles for definido, o projeto `default` é reconstruído
   a partir deles a cada inicialização.
2. **O diretório de trabalho do servidor**, quando ele contém um `rebase.json`. O projeto
   em que você está tem precedência sobre qualquer coisa memorizada em `~/.rebase/projects.json`.
3. **O `default` persistido** em `~/.rebase/projects.json`, quando nenhum dos
   dois primeiros determinar nada.

A descoberta automática a partir de `.rebase/state.json` preenche lacunas em todos os três casos e nunca
substitui um valor fornecido por um deles.

Os blocos no nível do projeto indicam o projeto — `"."`, o diretório de trabalho do cliente
ou o `${workspaceFolder}` do editor — porque a regra 3 lê um arquivo compartilhado
por todos os projetos na máquina. Uma configuração no nível do usuário, como a do Windsurf,
indica um caminho absoluto em vez disso.

## O que o servidor pode acessar

Esta é a seção que você deve ler antes de apontar um assistente para um banco de dados
importante.

O servidor carrega **uma única credencial de ambiente para todo o processo**. Não há
identidade por ferramenta nem modo somente leitura; todas as ferramentas usam o mesmo token, e a
única opção no pacote serve para *ampliar* o alcance em vez de reduzi-lo.

Qual credencial é usada, em ordem de prioridade:

1. `REBASE_API_TOKEN` do ambiente. `REBASE_TOKEN` não é lido aqui:
   trata-se do token de plano de controle da CLI e nunca é enviado para o app (o
   servidor avisa isso uma vez no stderr quando ele é o único definido). As ferramentas de nuvem
   ainda o passam para a CLI que elas inicializam, que o envia para o plano de controle.
2. `REBASE_SERVICE_KEY` lida a partir do `.env` do projeto
3. A chave de serviço descoberta automaticamente de `.rebase/state.json` enquanto o `rebase dev`
   está em execução

Os itens 2 e 3 são a chave do backend de desenvolvimento desta máquina, usada apenas quando o destino está no loopback.
Quando `REBASE_BASE_URL` aponta para outro lugar — `rebase cloud init --claim`
grava o endereço do projeto na nuvem, e nenhum `REBASE_API_TOKEN` até que um deploy
tenha sucesso —, o servidor não envia nenhum token e avisa isso uma vez no stderr.

Um token registrado para um projeto **tem prioridade sobre a descoberta automática**. A descoberta
serve apenas para preencher lacunas.

:::danger[O caminho sem configuração (zero-config) é uma credencial de admin]
As opções 2 e 3 correspondem à **chave de serviço (service key)** — um segredo administrativo sem restrição de escopo. O backend
a resolve como `uid: "service"`, `roles: ["admin"]`, `isAdmin: true`. Essa
identidade possui todos os [escopos](/docs/backend/roles-and-scopes/) e atende às
políticas `_default_admin_read` / `_default_admin_write` que o Rebase injeta em
qualquer tabela que não tenha definido `defaultPolicies: false`.

Portanto, a resposta sincera para "o RLS ainda restringe isso?" é: o RLS *executa* — o
driver de fato faz o downgrade para a role `rebase_user` — e então uma política criada pelo
próprio Rebase concede tudo a essa identidade. Ler todas as linhas de todas as tabelas
é o **comportamento projetado da configuração padrão**, não uma falha ou
desvio (bypass).

Com a configuração zero-config, um agente com essas ferramentas pode ler e gravar em qualquer
linha de qualquer tabela, listar todos os usuários, redefinir qualquer senha, invocar qualquer
função do backend e executar DDL no `DATABASE_URL` resolvido pelo projeto.
:::

### Fornecendo uma credencial restrita em vez disso

Cadastre uma [chave de API (API key)](/docs/backend/api-keys) com escopos e o modelo de
duas barreiras é aplicado de verdade. Uma chave de serviço executa com as roles `["service"]`, que as
políticas de admin injetadas **não** mencionam — portanto, o RLS não concede nada a ela a menos que uma de
suas próprias políticas determine o contrário, e seus escopos a restringem ainda mais:

```bash
rebase api-keys create -n "claude-code" \
  --scopes data:read:articles \
  --expires-in 30
```

Em seguida, forneça a chave `rk_live_…` resultante para o servidor em vez de deixá-lo
descobrir uma chave de serviço:

```json title=".mcp.json"
{
  "mcpServers": {
    "rebase": {
      "command": "pnpm",
      "args": ["exec", "rebase-mcp"],
      "env": {
        "REBASE_PROJECT_DIR": "/absolute/path/to/your/project",
        "REBASE_API_TOKEN": "rk_live_..."
      }
    }
  }
}
```

Duas coisas que isso **não** faz, e que vale a pena saber antes de depender disso:

- **Não restringe as ferramentas da CLI.** `rebase_db_push`, `rebase_db_migrate`,
  `rebase_doctor` e as ferramentas de branches inicializam a CLI do Rebase, que se conecta com
  `DATABASE_URL` e nunca vê o seu token. A barreira de loopback abaixo é a
  única coisa que fica à frente delas.
- **Uma chave só acessa uma ferramenta de administração se tiver o escopo correspondente.** `list_users` e
  `list_roles` precisam de `users:read`; `create_user`, `update_user`, `delete_user` e
  `rebase_auth_reset_password` precisam de `users:write`; as ferramentas de storage e cron
  precisam do escopo `storage:*` ou `cron:*` correspondente; `invoke_function` precisa de
  `functions:invoke`. Sem ele, a chamada responde com `403 SCOPE_MISSING`. Mesmo com `users:write`, uma chave não pode
  alterar a conta de um admin: um admin possui `keys:read` e `keys:write`, o que nenhuma
  chave pode ter, e ninguém pode gerenciar uma conta com mais privilégios do que os seus próprios.

Uma chave criada com `--roles admin` é diferente: ela carrega as roles
`["service", "admin"]`, o que satisfaz as mesmas políticas de admin padrão que a chave de serviço
atende. Adicione `--full-access` também e seu alcance será o da chave de serviço,
exceto pelo gerenciamento de chaves. A vantagem é que ela é **revogável, expira e possui limitação de taxa (rate limit) por chave**,
nada do qual se aplica à chave de serviço — rotacionar esta última
requer editar o `.env` e reiniciar o servidor.

Consulte [Agentes e Servidores MCP](/docs/backend/api-keys#agents-and-mcp-servers) para obter
as orientações completas sobre escopos de chave.

### Tornando uma tabela totalmente inacessível

A razão pela qual uma credencial de admin lê tudo é a política básica que o Rebase
injeta em cada tabela, concedendo acesso ao contexto de servidor confiável e à
role `admin`. Uma tabela pode optar por não incluir essa política básica e assumir total
responsabilidade por seu próprio RLS:

```ts
import { defineTable, col } from "@rebasepro/server/schema";

export const medicalRecords = defineTable("medical_records", {
    columns: {
        id:        col.uuid().primaryKey().defaultRandom(),
        patientId: col.text(),
        notes:     col.text(),
    },
    // Remove the injected admin/server baseline — nothing is readable
    // except what the rules below allow.
    defaultPolicies: false,
    rls: [
        { operations: ["select", "update"], ownerField: "patientId" },
    ],
});
```

Agora, a única forma de acesso é corresponder ao `patientId`. O uid da chave de serviço é a
string literal `service`, logo uma regra de proprietário (owner rule) nunca a contemplará — leituras retornam zero
linhas e gravações são rejeitadas pelo Postgres. Este é o único controle que restringe
a credencial padrão do servidor MCP em vez de ignorar as restrições.

Lembre-se de que essa é uma alteração real de RLS, não apenas documental: ela só tem efeito
depois que `rebase schema generate` e uma migração tiverem aplicado as políticas. Consulte
[Segurança a nível de linha](/docs/collections/security-rules).

## A barreira de loopback

`rebase_project_add` aceita qualquer `baseUrl`, e as ferramentas de CLI se conectam com
qualquer `DATABASE_URL` declarada pelo projeto. A mesma lista de ferramentas que edita um
banco de dados de rascunho em seu laptop pode, portanto, excluir linhas de produção, sem nada
entre elas além do julgamento do assistente sobre qual projeto está ativo.

**Toda ferramenta que modifica o ambiente de destino é recusada a menos que esse destino esteja
na interface de loopback.** A barreira foi escrita como uma lista do que *não* é
bloqueado, para que qualquer ferramenta adicionada futuramente já venha protegida por padrão.

- **Não bloqueadas — leituras:** `rebase_schema_plan`, `rebase_doctor`,
  `rebase_db_branch_list`, `rebase_db_branch_info`, `rebase_db_branch_diff`, `query_table`,
  `get_row`, `list_users`, `list_roles`, `storage_list_objects`,
  `storage_get_download_url`, `cron_list_jobs`, `cron_get_job`, `cron_get_job_logs`,
  `rebase_dev_logs`, e as leituras do Rebase Cloud: `rebase_cloud_status`,
  `rebase_cloud_logs`, `rebase_cloud_env_list`, `rebase_cloud_deployments_list`.
- **Não bloqueadas — gravações do Rebase Cloud:** `rebase_cloud_provision`,
  `rebase_cloud_deploy`, `rebase_cloud_env_set`, `rebase_cloud_rollback`.
  O provisionamento cria um projeto; as demais alteram um projeto em produção. Nenhuma
  delas passa por `baseUrl` ou `DATABASE_URL`, que são tudo o que a barreira consegue
  verificar. Consulte [Rebase Cloud](#rebase-cloud) para saber o que fica à frente delas.
- **Não bloqueadas — apenas locais:** `rebase_schema_introspect`, `rebase_db_branch_switch`, `rebase_schema_generate`, `rebase_db_generate`,
  `rebase_generate_sdk`, as ferramentas do servidor de desenvolvimento e as ferramentas de registro de projetos.
  Elas gravam arquivos locais ou estado local e não possuem um destino remoto para verificar.
- **Bloqueadas com base na `DATABASE_URL`:** as ferramentas de CLI restantes — `rebase_db_push`,
  `rebase_db_migrate`, `rebase_db_branch_create`, `rebase_db_branch_delete`.
- **Bloqueadas com base na `baseUrl` do projeto:** as ferramentas de SDK restantes —
  `create_row`, `update_row`, `delete_row`, `create_user`,
  `update_user`, `delete_user`, `rebase_auth_reset_password`,
  `storage_delete_object`, `cron_trigger_job`, `cron_toggle_job`
  e `invoke_function`.

Os dois destinos não são intercambiáveis. As ferramentas da CLI nunca veem a `baseUrl`, portanto, um
backend em localhost configurado ao lado de uma `DATABASE_URL` de produção é verificado contra
o banco de dados, não contra o backend.

Uma recusa se parece com isto:

```text
Error: Refusing to run "delete_row": project "default" points at
https://api.example.com/, which is not local. Set REBASE_MCP_ALLOW_REMOTE_WRITES=true
to allow destructive tools against remote environments.
```

**Se nenhuma string de conexão puder ser resolvida, as ferramentas de banco de dados bloqueadas serão recusadas.**
Sem uma `DATABASE_URL`, a CLI usa o banco de dados gerenciado de desenvolvimento, que é
o padrão para um novo projeto, e a barreira recusa suas quatro ferramentas de banco de dados
nesse caso. A recusa explica o motivo e indica o que funciona como alternativa. Ela não sugere
a desativação da proteção:

```text
Error: Refusing to run "rebase_db_push": project "default" sets no DATABASE_URL, so the
CLI would use the managed development database (PGlite, started by `rebase dev`). You
most likely do not need this tool: the dev server applies the tables in backend/schema to
that database at boot, additively. After changing a table, restart it with
rebase_dev_stop and rebase_dev_start. …
```

A partir de um terminal,
`rebase db push` e `rebase db migrate` são executados normalmente nesse banco de dados; apenas as
ferramentas do MCP são recusadas.

Apenas o loopback é considerado local: `localhost`, `*.localhost`, `127.0.0.0/8`, `::1`
(e `0.0.0.0`).
Faixas privadas como `10.x` e `192.168.x` **não** são — elas têm tantas chances de ser
um cluster compartilhado de homologação quanto um laptop, e tratá-las como locais liberaria
exatamente o tipo de acidente que a barreira visa impedir.

Defina `REBASE_MCP_ALLOW_REMOTE_WRITES=true` para desativar essa restrição. Defini-la globalmente na
configuração do seu cliente MCP remove a barreira para todos os projetos que o servidor puder alcançar,
não apenas para aquele em que você estava pensando.

## Marcação de dados não confiáveis

Linhas, registros de usuários, listagens de armazenamento, tarefas cron, respostas de funções e saídas
de CLI retornam envolvidos em um envelope explícito:

```text
<<<UNTRUSTED_DATA source="query_table" id="9b2f4c1e-…">>>
[ … rows … ]
<<<END_UNTRUSTED_DATA id="9b2f4c1e-…">>>
```

Tudo o que está armazenado no seu banco de dados foi escrito por alguém e chega
no mesmo canal do contrato de ferramentas que o assistente está seguindo. O envelope instrui
o modelo a tratar isso como conteúdo inerte, e não como instruções.

O `id` é gerado de forma inédita para cada resposta, após a gravação dos dados, e
apenas o marcador final que contém esse mesmo id fecha o bloco. Textos dentro dos dados que
tenham formato similar ao marcador são quebrados com um espaço de largura zero, de forma que uma linha contendo
`<<<END_UNTRUSTED_DATA>>>` não consiga fechar o envelope prematuramente e deixar o que se segue
do lado de fora.

O [endpoint remoto](/docs/ai/remote-mcp/) delimita os resultados de suas ferramentas da mesma
maneira e informa isso ao cliente; seu `structuredContent` transporta o resultado simples.
`list_tables` e
`describe_table` são as exceções: apenas o modelo as lê, portanto são
enviadas uma única vez, no texto.

Trata-se de um marcador, não de uma sandbox. Um assistente que dispõe dessas ferramentas é tão seguro
quanto o conteúdo que você permite que ele leia.

## Múltiplos projetos

As configurações de projetos são armazenadas em `~/.rebase/projects.json`, e o servidor
pode manter várias ao mesmo tempo — útil para quem trabalha alternando entre ambientes
locais e remotos. Enquanto o `rebase dev` está em execução, o servidor lê a porta ativa e
a chave de serviço de `.rebase/state.json` no diretório do projeto, o que
viabiliza o funcionamento zero-config no cenário local.

:::note[O registro é a última palavra, não a primeira]
A precedência é a mesma citada anteriormente: bloco de ambiente, depois o diretório de trabalho
quando contém um `rebase.json`, e por fim o `default` persistido.

`REBASE_PROJECT_DIR`, `REBASE_BASE_URL` e `REBASE_API_TOKEN` reconstroem o
projeto `default` **a cada inicialização**, não apenas na primeira. A reconstrução substitui
a entrada por completo: um token registrado para o `projectDir` antigo é descartado em vez de
ser transportado para um diretório para o qual nunca foi emitido. Um `default` derivado
dessa forma — ou do diretório de trabalho — nunca é gravado de volta em
`~/.rebase/projects.json`, impedindo que a chave de serviço de desenvolvimento de um projeto se torne
a de outro.

`activeProject` é persistente, portanto, se uma sessão anterior chamou
`rebase_project_switch`, as ferramentas terão como alvo esse projeto e o servidor avisará isso no
stderr — a menos que esse projeto esteja registrado em um diretório *diferente*
daquele em que este servidor está rodando, caso em que ele volta para o `default` e avisa.
Se um assistente parecer estar lendo o banco de dados errado, chame
`rebase_project_current` primeiro.
:::

### Em qual projeto uma chamada atua

`activeProject` tem escopo em toda a máquina, e um mesmo servidor costuma ser instalado uma única vez para a máquina inteira. Por isso, toda ferramenta que atua sobre um projeto (com exceção das ferramentas de registro `rebase_project_*`, `rebase_cloud_projects_list`, `rebase_cloud_provision` e `rebase_dev_logs`) resolve seu projeto **por chamada**, e aceita um parâmetro opcional `project`: o nome de um projeto cadastrado ou um slug ou id do Rebase Cloud. A chamada é verificada em relação ao link do Cloud (`.rebase/cloud.json`) do diretório em que a sessão opera: a primeira [raiz](https://modelcontextprotocol.io/specification/latest/client/roots) do cliente, ou o diretório de trabalho do servidor.

| A chamada | O diretório da sessão | Resultado |
|---|---|---|
| informa um projeto | está vinculado ao mesmo projeto | executa nele |
| informa um projeto | está vinculado a outro projeto | **recusado**, nada é executado |
| não informa nenhum projeto | está vinculado a um projeto diferente do ativo | **recusado**, nada é executado |
| não informa nenhum projeto | está vinculado; o projeto ativo é um local em outro lugar | executa no projeto vinculado |
| não informa nenhum projeto | não está vinculado | executa no projeto ativo; uma *gravação* em um projeto Cloud selecionado por uma sessão anterior precisa que o projeto seja informado |

Uma recusa informa o nome de ambos os projetos. O `rebase_project_current` relata o diretório da sessão e o vínculo em `session`. `rebase_cloud_env_set` e `rebase_cloud_rollback` passam o projeto resolvido para a CLI com `--project`; o `rebase_cloud_deploy` envia o diretório no qual está sendo executado, portanto é recusado caso o vínculo desse diretório aponte para outro projeto.

Os tokens são armazenados nesse registro **em texto não criptografado (plaintext)**. Trata-se de um arquivo em seu
diretório de usuário contendo credenciais de administrador para cada projeto que você cadastrou; trate-o
com o devido cuidado.

## Rebase Cloud

Oito ferramentas levam um app deste diretório para um backend em produção no
[Rebase Cloud](/docs/deployment/cloud/) e o mantêm funcionando. Cada uma executa
`rebase cloud <command> --json` no diretório do projeto ativo: o mesmo
comando executado por uma pessoa, portanto não há uma segunda implementação que possa divergir.

| Ferramenta | Executa | Altera o projeto |
|---|---|---|
| `rebase_cloud_provision` | `rebase cloud init --claim` | Cria um, sem conta |
| `rebase_cloud_status` | `rebase cloud status` | Não |
| `rebase_cloud_deploy` | `rebase cloud deploy` | Sim |
| `rebase_cloud_logs` | `rebase cloud logs [--runtime]` | Não |
| `rebase_cloud_env_list` | `rebase cloud env list` | Não |
| `rebase_cloud_env_set` | `rebase cloud env set KEY --stdin` | Sim, a partir do próximo deploy |
| `rebase_cloud_deployments_list` | `rebase cloud deployments list` | Não |
| `rebase_cloud_rollback` | `rebase cloud rollback --yes` | Sim |
| `rebase_cloud_projects_list` | `rebase cloud projects list --all-orgs` | Não |

O fluxo comum de um agente é: `rebase_cloud_provision`, depois fornecer a URL de
reivindicação (claim) ao usuário; `rebase_cloud_status` para visualizar o projeto (enquanto não reivindicado,
`unclaimed` contém a URL de claim e a data de exclusão); `rebase_cloud_deploy`
após uma alteração; `rebase_cloud_logs` quando algo apresentar comportamento incorreto; e
`rebase_cloud_rollback` quando a produção apresentar problemas.

**Sobre o que atuam.** O projeto ao qual a chamada é resolvida, conforme descrito em
[Em qual projeto uma chamada atua](#em-qual-projeto-uma-chamada-atua): o argumento `project`,
verificado contra o vínculo do diretório da sessão, ou esse próprio vínculo, ou
o projeto ativo. Uma chamada que indique um projeto ao qual o diretório da sessão não
está vinculado é recusada antes que qualquer processo seja iniciado.

**Sob qual autoridade.** O que quer que a CLI resolva nesse diretório: `REBASE_TOKEN`
quando definido, depois o token que o `rebase cloud init --claim` armazenou para um
projeto não reivindicado e, por fim, a sessão do `rebase cloud login`. No diretório desse
projeto não reivindicado, um `REBASE_TOKEN` que não tenha escopo sobre o projeto é deixado
de lado em favor do próprio token do projeto. O plano de controle
verifica cada chamada da mesma forma que verifica as da CLI; assim, com um token criado por
`rebase cloud tokens create --can logs`, um assistente pode ler logs, e o
plano de controle recusa seus deploys, variáveis e rollbacks. A ausência de credenciais ou uma
credencial recusada retorna como um erro indicando o que o usuário deve fazer (`rebase cloud login` ou reivindicar o projeto).

**Por que a barreira de loopback não se aplica.** A barreira verifica a `baseUrl` da aplicação e
a `DATABASE_URL` da CLI; essas ferramentas não utilizam nenhuma delas. Após `rebase_cloud_provision`,
a `REBASE_BASE_URL` passa a apontar para o novo projeto na nuvem, de modo que bloqueá-la recusaria
justamente o deploy necessário ao fluxo. O provisionamento em si apenas cria: não altera
nenhuma aplicação ou banco de dados existente, e a CLI ainda assim o recusa em um diretório que
já esteja vinculado. Um deploy, uma variável e um rollback alteram, cada um,
a produção. O que atua como proteção antes deles é a credencial mencionada acima, a aprovação de ferramentas
do seu cliente MCP e `confirm: true`: `rebase_cloud_deploy` para
produção, `rebase_cloud_env_set` em produção, `rebase_cloud_rollback` e
`rebase_cloud_provision` respondem o que fariam e não executam nada até que uma chamada
repita os mesmos argumentos com `confirm: true`, o que o assistente envia somente
após a concordância do usuário. Um deploy de preview e uma variável de preview não exigem isso. Para impedir que um assistente altere um projeto
na nuvem, defina `REBASE_TOKEN` no ambiente do servidor com um token sem as
permissões (capabilities) `deploy` e `env`.

**Lendo qualquer um dos seus projetos.** As ferramentas acima atuam no projeto vinculado.
Para ler dados de outro — qualquer projeto em qualquer organização à qual a conta
autenticada pertença, vinculado aqui ou não —, `rebase_cloud_projects_list` os lista
e `rebase_project_use_cloud` (com um id, slug ou nome) aponta as ferramentas de dados e
administração para ele: `query_table`, `get_row`, `list_users`, `list_roles`,
`cron_list_jobs`, `storage_list_objects`. Essas chamadas passam pelo proxy do Studio no console,
utilizando a credencial da própria CLI (`rebase cloud access-token`, lida a cada chamada
e nunca armazenada); o plano de controle verifica o acesso da pessoa e
anexa a chave de serviço do projeto do lado dele, garantindo que nenhuma chave chegue à máquina.
Um projeto com o Studio desativado é recusado, e a mensagem informa isso. É um
destino remoto como qualquer outro, de forma que as ferramentas que alteram dados permanecem bloqueadas
nele a menos que `REBASE_MCP_ALLOW_REMOTE_WRITES` esteja definido; `rebase_project_switch` desfaz a seleção.

Cada ferramenta opera como um snapshot:

- `rebase_cloud_logs` nunca acompanha em tempo real (follow). Seu resultado traz `nextSinceTime`; passe-o
  de volta como `since` para ler o que veio depois. Retorna as últimas 200 linhas, a menos
  que `tail` especifique outro valor. `source: "build"` retorna o log de build mais recente.
- `rebase_cloud_deploy` acompanha o deployment até o fim e verifica se a nova
  versão responde. `wait: false` retorna assim que o deployment é disparado.
  Ela nunca ejeta um projeto do runtime gerenciado, faz deploy de uma versão anterior do framework
  ou pula verificações de build: essas são decisões do usuário, e qualquer recusa que exija uma delas
  informará o motivo.
- `rebase_cloud_rollback` passa `--yes` assim que a chamada incluir `confirm: true`
  (abaixo), já que não há terminal para solicitar confirmação.

`rebase_cloud_env_set` grava o valor na entrada padrão (stdin) da CLI, portanto ele
nunca aparece em uma linha de comando onde o `ps` pudesse exibi-lo, e o valor é removido de
qualquer resposta retornada pela ferramenta. Seu resultado informa o que foi armazenado (a chave, se
é secreta, se um novo deploy está pendente), mas nunca o valor. `rebase_cloud_env_list`
lista apenas as chaves. Uma versão da CLI anterior a `env set --stdin` é recusada com uma mensagem para
atualizá-la; o valor não é enviado de outra forma.

Os resultados retornam dentro do [envelope de dados não confiáveis](#marcação-de-dados-não-confiáveis),
precedidos por uma linha do servidor sobre o que fazer em seguida. Uma recusa é um erro da ferramenta
que traz o código da CLI, como `no_project`, `token_rejected`,
`managed_project` ou `deploy_failed`. Quando o servidor reconhece o código, ele
inclui a próxima etapa, seguida pela mensagem da própria CLI. Cada ferramenta valida seus argumentos
contra o schema que ela divulga antes de iniciar qualquer subprocesso, e recusa qualquer
argumento não declarado.

## Referência de ferramentas

53 ferramentas, em dez grupos: schema e banco de dados, planejamento de schema, documentos, usuários
e roles, storage, cron, funções, servidor de desenvolvimento, registro de projetos e
Rebase Cloud.
Cada uma, com os parâmetros necessários e indicando se a barreira a recusa contra um destino não local,
está na [Referência de ferramentas MCP](/docs/ai/mcp-tool-reference).

## Recursos

Além das ferramentas, o servidor expõe recursos MCP (resources) para que o cliente possa obter o
contexto do projeto sem gastar uma chamada de ferramenta:

| URI | Descrição |
|---|---|
| `rebase://tables/{name}` | Código-fonte em TypeScript da definição de uma tabela (`defineTable`) |
| `rebase://schema` | O schema Drizzle gerado (`schema.generated.ts`) |

Os arquivos de tabelas são os módulos do diretório de schema, exceto seu `index.ts`: a
chave `tables` do app de backend em `rebase.json`, `backend/schema` por padrão,
sob o diretório do projeto ativo ou seu `app/`.

`rebase://schema` é listado **somente se** o schema gerado existir.
`findBackendDir` procura por `backend/` e depois por `app/backend/` sob o diretório do projeto
ativo, e lê `src/schema.generated.ts` do que encontrar primeiro —
portanto, tanto a estrutura padrão do scaffold quanto a deste monorepo funcionam, e um projeto organizado de
uma terceira forma, ou que ainda não executou `rebase schema generate`, simplesmente não
verá o recurso ser oferecido.

## O endpoint remoto

Um backend implantado também pode disponibilizar o MCP diretamente, em `/mcp`, para as pessoas que usam
sua aplicação, conectando-se cada uma como si mesma sob sua própria segurança a nível de linha.
Isso tem sua própria página:
[The Remote MCP Endpoint](/docs/ai/remote-mcp/).

## Configuração recomendada

- Aponte o servidor para um projeto **local** e deixe `REBASE_MCP_ALLOW_REMOTE_WRITES`
  indefinido. A barreira é o recurso mais valioso do pacote.
- Para qualquer ambiente remoto, cadastre uma **chave de API `rk_` com escopo restrito** em vez de deixar
  a descoberta automática entregar uma chave de serviço.
- Verifique `rebase_project_current` quando a saída parecer incorreta. O projeto ativo é
  persistente e reside fora do seu repositório.
- Trate `~/.rebase/projects.json` como um arquivo de segredos.
