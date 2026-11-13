---
sourceHash: 43fd981d241b2237
title: Servidor MCP
sidebar_label: Servidor MCP
description: Conecte o Claude Code, Cursor, Gemini CLI ou qualquer cliente MCP a um projeto Rebase — as 53 ferramentas que ele expõe, a credencial com a qual ele se autentica e o gate de loopback que fica entre um agente e a produção.
---

`@rebasepro/mcp` é um servidor [Model Context Protocol](https://modelcontextprotocol.io)
que fornece a um assistente de IA ferramentas reais sobre um projeto Rebase: ler e
gravar linhas, gerenciar usuários, executar migrações, invocar funções, controlar o servidor
de desenvolvimento.

Ele se comunica via MCP **apenas por stdio**. Não há porta nem listener — o
processo é exatamente tão confiável quanto aquilo que o inicializou, e não há um chamador
remoto para autenticar. Essa é a parte segura. As perguntas interessantes são todas
sobre o que ele faz *depois* de estar em execução, e esta página responde a elas antes
de mostrar o bloco de configuração.

Um backend implantado também pode servir MCP diretamente, via HTTP, para as pessoas que usam
sua aplicação. Isso é algo diferente, com um modelo de credenciais diferente:
consulte [O Endpoint MCP Remoto](/docs/ai/remote-mcp/).

:::tip[Usando o Claude na web, desktop ou mobile?]
Em vez disso, adicione o [conector do Rebase](/docs/ai/rebase-connector/):
`https://app.rebase.pro/mcp`, uma vez, para cada projeto que você executa no Rebase Cloud
ou em seus próprios servidores. Esta página aborda o servidor local que um assistente de código inicia
dentro de um projeto.
:::

## Conectando um cliente

O servidor é executado a partir do seu projeto: `@rebasepro/mcp` é uma devDependency que todo
scaffold do `rebase init` fixa junto com a CLI, e cada bloco abaixo — toda a
integração — inicia essa cópia (`pnpm exec rebase-mcp`, ou `npx --no rebase-mcp`
em um projeto npm), nunca uma mais recente do npm. Um projeto mais antigo o adiciona uma vez,
com `rebase skills install --mcp` ou `pnpm add -D @rebasepro/mcp`.

O `rebase init` escreve o bloco para cada agente escolhido quando
[configura seus agentes de codificação com IA](/docs/ai/skills#set-up-by-rebase-init), mantendo
quaisquer outros servidores já presentes no arquivo. `rebase init --agent cursor,codex` faz
o mesmo sem perguntar.

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
O Codex lê a configuração do projeto apenas depois de você ter confiado no projeto:

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

O **Windsurf** lê servidores MCP apenas da sua configuração em nível de usuário, portanto não há
arquivo de projeto para gravar. Adicione o servidor em suas configurações de MCP como `"command": "pnpm"`,
`"args": ["--dir", "/absolute/path/to/your/project", "exec", "rebase-mcp"]`, com esse caminho definido como `REBASE_PROJECT_DIR`.

Qualquer cliente MCP capaz de inicializar um servidor stdio funciona; a estrutura é a mesma.

### Em qual diretório ele atua

`REBASE_PROJECT_DIR` é o diretório que contém `rebase.json`. Há **uma**
ordem de precedência, e ela é a mesma em todos os clientes:

1. **O bloco de ambiente** — `REBASE_PROJECT_DIR`, `REBASE_BASE_URL`,
   `REBASE_API_TOKEN`. Se algum deles estiver definido, o projeto `default` é reconstruído
   a partir deles a cada inicialização.
2. **O diretório de trabalho do servidor**, quando contiver um `rebase.json`. Um projeto
   no qual você está localizado tem prioridade sobre qualquer coisa salva em `~/.rebase/projects.json`.
3. **O `default` persistido** em `~/.rebase/projects.json`, quando nenhum dos
   dois primeiros definir nada.

A autodescoberta a partir de `.rebase/state.json` preenche lacunas em todos os três casos e nunca
sobrescreve um valor fornecido por um deles.

Os blocos no nível de projeto nomeiam o projeto — `"."`, o diretório de trabalho do cliente,
ou o `${workspaceFolder}` do editor — porque a regra 3 lê um arquivo compartilhado por
todos os projetos na máquina. Uma configuração em nível de usuário, como a do Windsurf,
define um caminho absoluto em vez disso.

## O que o servidor pode acessar

Esta é a seção para ler antes de apontar um assistente para um banco de dados importante
para você.

O servidor carrega **uma credencial de ambiente para todo o processo**. Não há
identidade por ferramenta e não há modo somente leitura; cada ferramenta usa o mesmo token, e a
única opção no pacote serve para habilitar (*opt-in*) mais alcance, e não menos.

Qual credencial é essa, em ordem de prioridade:

1. `REBASE_API_TOKEN` a partir do ambiente. `REBASE_TOKEN` não é lido aqui:
   ele é o token do control plane da CLI e nunca é enviado para a aplicação (o
   servidor informa isso uma vez no stderr quando ele é o único definido). As ferramentas de nuvem
   ainda o passam para a CLI que inicializam, que por sua vez o envia para o control plane.
2. `REBASE_SERVICE_KEY` lida a partir do `.env` do projeto
3. A service key descoberta automaticamente a partir de `.rebase/state.json` enquanto `rebase dev`
   estiver em execução

2 e 3 são a chave do backend de desenvolvimento desta máquina, usada apenas quando o destino estiver em
loopback. Quando `REBASE_BASE_URL` aponta para outro lugar — `rebase cloud init --claim`
grava o endereço do projeto em nuvem, e nenhum `REBASE_API_TOKEN` até que um deploy
tenha sucesso — o servidor não envia nenhum token e informa isso uma vez no stderr.

Um token que você registra para um projeto **tem precedência sobre a autodescoberta**. A descoberta apenas
preenche uma lacuna.

:::danger[O caminho sem configuração (zero-config) é uma credencial de admin]
As opções 2 e 3 são a **service key** — um segredo de admin sem restrição de escopo. O backend
o resolve para `uid: "service"`, `roles: ["admin"]`, `isAdmin: true`. Essa
identidade possui todos os [escopos](/docs/backend/roles-and-scopes/) e satisfaz as
políticas `_default_admin_read` / `_default_admin_write` que o Rebase injeta em
cada tabela que não definiu `defaultPolicies: false`.

Portanto, a resposta sincera para "o RLS ainda o restringe?" é: o RLS *é executado* — o
driver faz downgrade para a role `rebase_user` — e então uma política que o próprio Rebase
escreveu concede tudo a essa identidade. Ler todas as linhas de todas as
tabelas é o **comportamento projetado da configuração padrão**, não uma
falha de segurança.

Com a configuração zero-config, um agente de posse dessas ferramentas pode ler e gravar todas as
linhas de todas as tabelas, listar todos os usuários, redefinir qualquer senha, invocar qualquer função
de backend e executar DDL contra qualquer `DATABASE_URL` para a qual o projeto resolva.
:::

### Fornecendo uma credencial restrita em vez disso

Registre uma [chave de API](/docs/backend/api-keys) com escopo restrito e o modelo de dois gates
se aplicará de verdade. Uma service key roda com as roles `["service"]`, que as
políticas de admin injetadas **não** nomeiam — portanto, o RLS não concede nada a ela, a menos que uma
das suas próprias políticas diga o contrário, e seus escopos a restringem ainda mais:

```bash
rebase api-keys create -n "claude-code" \
  --scopes data:read:articles \
  --expires-in 30
```

Em seguida, passe a chave `rk_live_…` resultante para o servidor em vez de deixá-lo
descobrir uma service key:

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

Duas coisas que isso **não** faz, ambas importantes de saber antes de depender disso:

- **Não restringe as ferramentas de CLI.** `rebase_db_push`, `rebase_db_migrate`,
  `rebase_doctor` e as ferramentas de branch inicializam a CLI do Rebase, que se conecta com
  `DATABASE_URL` e nunca vê o seu token. O gate de loopback abaixo é a
  única proteção à frente delas.
- **Uma chave acessa uma ferramenta de admin apenas com o escopo correspondente.** `list_users` e
  `list_roles` precisam de `users:read`; `create_user`, `update_user`, `delete_user` e
  `rebase_auth_reset_password` precisam de `users:write`; as ferramentas de storage e cron
  precisam do escopo correspondente `storage:*` ou `cron:*`; `invoke_function` precisa de
  `functions:invoke`. Sem
  ele, a chamada responde `403 SCOPE_MISSING`. Mesmo com `users:write`, uma chave não pode
  alterar a conta de um admin: um admin possui `keys:read` e `keys:write`, privilégios que nenhuma
  chave pode ter, e ninguém pode gerenciar uma conta que possui mais permissões do que a sua própria.

Uma chave criada com `--roles admin` é diferente: ela carrega as roles
`["service", "admin"]`, o que atende às mesmas políticas padrão de admin que a service
key atende. Conceda a ela `--full-access` também e seu alcance será o mesmo da service key,
exceto pelo gerenciamento de chaves. A vantagem adicional é que ela é **revogável, expirável e
com rate limit por chave**, nada do que se aplica à service key — fazer a rotação dela
exige editar o `.env` e reiniciar o servidor.

Consulte [Agentes e Servidores MCP](/docs/backend/api-keys#agents-and-mcp-servers) para o
guia completo sobre definição de escopos de chaves.

### Tornando uma tabela totalmente inacessível

<span class="since-badge" data-since="0.31">Desde 0.31</span>

O motivo pelo qual uma credencial de admin lê tudo é a política de base que o Rebase
injeta em cada tabela, concedendo acesso ao contexto de servidor confiável e à
role `admin`. Uma tabela pode optar por sair dessa base e assumir total
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

Agora a única forma de acesso é correspondendo a `patientId`. O uid da service key é a
string literal `service`, portanto uma regra de proprietário (owner) nunca corresponderá a ele — as leituras retornam zero
linhas e as gravações são rejeitadas pelo Postgres. Esse é o único controle que restringe
a credencial padrão do servidor MCP em vez de ignorar as restrições.

Lembre-se de que essa é uma alteração real de RLS, não apenas documental: ela só tem efeito
após `rebase schema generate` e uma migração terem aplicado as políticas. Consulte
[Segurança a nível de linha (RLS)](/docs/collections/security-rules).

## O gate de loopback

<span class="since-badge" data-since="0.31">Desde 0.31</span>

`rebase_project_add` aceita qualquer `baseUrl`, e as ferramentas de CLI conectam-se com
qualquer `DATABASE_URL` que o projeto declarar. A mesma lista de ferramentas que edita um
banco de dados temporário no seu laptop pode, portanto, deletar linhas de produção, sem nada
no meio além do julgamento do assistente sobre qual projeto está ativo.

**Toda ferramenta que modifica o ambiente de destino é recusada, a menos que esse destino esteja
na interface de loopback.** O gate foi escrito como uma lista do que *não* é
bloqueado, portanto uma ferramenta adicionada posteriormente já chega protegida por padrão.

- **Sem gate — leituras:** `rebase_schema_plan`, `rebase_doctor`,
  `rebase_db_branch_list`, `rebase_db_branch_info`, `rebase_db_branch_diff`, `query_table`,
  `get_row`, `list_users`, `list_roles`, `storage_list_objects`,
  `storage_get_download_url`, `cron_list_jobs`, `cron_get_job`, `cron_get_job_logs`,
  `rebase_dev_logs` e as leituras do Rebase Cloud `rebase_cloud_status`,
  `rebase_cloud_logs`, `rebase_cloud_env_list`, `rebase_cloud_deployments_list`.
- **Sem gate — gravações do Rebase Cloud:** `rebase_cloud_provision`,
  `rebase_cloud_deploy`, `rebase_cloud_env_set`, `rebase_cloud_rollback`.
  O provisionamento cria um projeto; os outros alteram um projeto de produção. Nenhum
  deles passa por `baseUrl` ou `DATABASE_URL`, que são os únicos dados que o gate pode
  verificar. Consulte [Rebase Cloud](#rebase-cloud) para saber o que atua como proteção diante deles.
- **Sem gate — apenas locais:** `rebase_schema_introspect`, `rebase_db_branch_switch`, `rebase_schema_generate`, `rebase_db_generate`,
  `rebase_generate_sdk`, as ferramentas do dev-server e as ferramentas de registro de projetos.
  Elas gravam arquivos locais ou estado local e não têm um destino remoto para verificar.
- **Com gate contra `DATABASE_URL`:** as ferramentas de CLI restantes — `rebase_db_push`,
  `rebase_db_migrate`, `rebase_db_branch_create`, `rebase_db_branch_delete`.
- **Com gate contra o `baseUrl` do projeto:** as ferramentas de SDK restantes —
  `create_row`, `update_row`, `delete_row`, `create_user`,
  `update_user`, `delete_user`, `rebase_auth_reset_password`,
  `storage_delete_object`, `cron_trigger_job`, `cron_toggle_job`
  e `invoke_function`.

Os dois destinos não são intercambiáveis. As ferramentas de CLI nunca veem `baseUrl`, portanto um
backend em localhost situado ao lado de um `DATABASE_URL` de produção é verificado contra
o banco de dados, não contra o backend.

Uma recusa se parece com isto:

```text
Error: Refusing to run "delete_row": project "default" points at
https://api.example.com/, which is not local. Set REBASE_MCP_ALLOW_REMOTE_WRITES=true
to allow destructive tools against remote environments.
```

**Se nenhuma string de conexão puder ser resolvida, as ferramentas de banco de dados com gate serão recusadas.**
Sem `DATABASE_URL`, a CLI usa o banco de dados de desenvolvimento gerenciado, que é
o padrão para um novo projeto, e o gate recusa suas quatro ferramentas de banco de dados
ali. A recusa explica o motivo e indica o que funciona como alternativa. Ela não sugere
a desativação da proteção:

```text
Error: Refusing to run "rebase_db_push": project "default" sets no DATABASE_URL, so the
CLI would use the managed development database (PGlite, started by `rebase dev`). You
most likely do not need this tool: the dev server applies the tables in backend/schema to
that database at boot, additively. After changing a table, restart it with
rebase_dev_stop and rebase_dev_start. …
```

A partir de um terminal,
`rebase db push` e `rebase db migrate` são executados nesse banco de dados; apenas as
ferramentas MCP são recusadas.

Apenas loopback conta como local: `localhost`, `*.localhost`, `127.0.0.0/8`, `::1`
(e `0.0.0.0`).
Faixas privadas como `10.x` e `192.168.x` **não** contam — elas têm tantas chances de ser
um cluster de staging compartilhado quanto um laptop, e tratá-las como locais liberaria
exatamente o tipo de acidente que o gate existe para evitar.

Defina `REBASE_MCP_ALLOW_REMOTE_WRITES=true` para desativar essa proteção. Defini-lo globalmente na
configuração do seu cliente MCP remove o gate para todos os projetos que o servidor pode alcançar, não
apenas para aquele em que você estava pensando.

## Marcação de dados não confiáveis (untrusted-data)

Linhas, registros de usuários, listagens de storage, jobs cron, respostas de funções e saídas
da CLI retornam encapsulados em um envelope explícito:

```text
<<<UNTRUSTED_DATA source="query_table" id="9b2f4c1e-…">>>
[ … rows … ]
<<<END_UNTRUSTED_DATA id="9b2f4c1e-…">>>
```

Qualquer coisa armazenada no seu banco de dados foi gravada por alguém, e ela chega no
mesmo canal que o contrato de ferramentas seguido pelo assistente. O envelope instrui
o modelo a tratá-la como conteúdo inerte, em vez de instruções executáveis.

O `id` é gerado novamente para cada resposta, depois que os dados foram gravados, e
apenas o marcador final que o contém encerra o bloco. Textos dentro dos dados que
tenham formato semelhante ao do marcador são quebrados com um caractere de espaço de largura zero (zero-width space), garantindo que uma linha que imprima
`<<<END_UNTRUSTED_DATA>>>` não possa fechar o envelope precocemente e deixar o que vem em seguida
do lado de fora.

O [endpoint remoto](/docs/ai/remote-mcp/) isola os resultados de suas ferramentas da mesma
forma e informa isso ao cliente; seu `structuredContent` transporta o resultado simples.
`list_tables` e
`describe_table` são as exceções: apenas um modelo as lê, então elas são
enviadas uma única vez, no texto.

Trata-se de um marcador, não de uma sandbox. Um assistente com essas ferramentas é tão
seguro quanto o conteúdo que você permite que ele leia.

## Múltiplos projetos

As configurações de projetos são armazenadas em `~/.rebase/projects.json`, e o servidor
pode conter vários simultaneamente — útil quando você trabalha em ambientes
locais e remotos. Enquanto o `rebase dev` estiver em execução, o servidor lê a porta ativa e a
service key a partir de `.rebase/state.json` no diretório do projeto, que é o que
torna o caso local zero-config.

:::note[O registro é a última palavra, não a primeira]
A precedência é a apresentada acima: bloco de ambiente, depois o diretório de trabalho
quando este contiver um `rebase.json`, e por fim o `default` persistido.

`REBASE_PROJECT_DIR`, `REBASE_BASE_URL` e `REBASE_API_TOKEN` reconstroem o
projeto `default` **a cada inicialização**, não apenas na primeira. A reconstrução é
completa: um token registrado para o `projectDir` antigo é descartado em vez de
ser levado para um diretório para o qual nunca foi emitido. Um `default` derivado dessa
forma — ou a partir do diretório de trabalho — nunca é regravado em
`~/.rebase/projects.json`, impedindo que a dev service key de um projeto se torne
a de outro.

`activeProject` é persistente, portanto, se uma sessão anterior chamou
`rebase_project_switch`, as ferramentas terão como alvo aquele projeto e o servidor informará isso
no stderr — a menos que esse projeto esteja registrado em um diretório *diferente*
daquele em que este servidor está sendo executado; nesse caso, ele voltará para `default` e informará
isso. Se um assistente parecer estar lendo o banco de dados errado, chame
`rebase_project_current` primeiro.
:::

Os tokens são armazenados nesse registro **em texto simples (plaintext)**. Trata-se de um arquivo em seu diretório
home contendo credenciais de admin para todos os projetos que você registrou; trate-o
com o devido cuidado.

## Rebase Cloud

Oito ferramentas levam uma aplicação deste diretório para um backend em produção no
[Rebase Cloud](/docs/deployment/cloud/) e a mantêm funcionando. Cada uma executa
`rebase cloud <command> --json` no diretório do projeto ativo: o mesmo
comando executado por uma pessoa, garantindo que não haja uma segunda implementação sujeita a divergências.

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

O fluxo habitual do agente é: `rebase_cloud_provision`, em seguida fornecer ao usuário a
URL de reivindicação (claim URL); `rebase_cloud_status` para visualizar o projeto (enquanto não for reivindicado,
`unclaimed` carrega a claim URL e quando ele será excluído); `rebase_cloud_deploy`
após uma alteração; `rebase_cloud_logs` quando algo se comportar de forma inesperada; e
`rebase_cloud_rollback` quando a produção estiver com problemas.

**Em que atuam.** No projeto ao qual o diretório ativo está vinculado em
`.rebase/cloud.json`. Nenhuma delas aceita um id de projeto ou um diretório, portanto um
assistente não pode apontá-las para outro projeto além daquele ao qual o diretório está
vinculado. Mudar o projeto ativo com `rebase_project_switch` altera
o diretório em que elas são executadas.

**Sob qual autoridade.** Qualquer autoridade que a CLI resolver nesse diretório: `REBASE_TOKEN`
quando estiver definido, depois o token que `rebase cloud init --claim` armazenou para um
projeto não reivindicado, e em seguida a sessão de `rebase cloud login`. No diretório desse projeto
não reivindicado, um `REBASE_TOKEN` que não possui escopo no projeto é deixado de lado
em favor do token do próprio projeto. O control plane
verifica cada chamada assim como verifica as da CLI; assim, com um token criado por
`rebase cloud tokens create --can logs`, um assistente pode ler logs, e o
control plane recusará seus deploys, variáveis e rollbacks. A ausência de credenciais, ou uma credencial recusada, retorna como um erro explicando o que o
usuário precisa fazer (`rebase cloud login`, ou reivindicar o projeto).

**Por que o gate de loopback não se aplica.** O gate verifica o `baseUrl` da aplicação e o
`DATABASE_URL` da CLI; essas ferramentas não usam nenhum dos dois. Após o `rebase_cloud_provision`,
`REBASE_BASE_URL` aponta para o novo projeto em nuvem, portanto aplicar o gate sobre ele recusaria
o próprio deploy de que o fluxo precisa. O provisionamento em si apenas cria: não toca em
nenhuma aplicação ou banco de dados existente, e a CLI continua recusando-o em um diretório que
já esteja vinculado. Um deploy, uma variável e um rollback alteram, cada um,
a produção. O que atua como proteção diante deles é a credencial mencionada acima e
a aprovação de ferramentas do seu cliente MCP. Para evitar que um assistente altere um projeto
em nuvem, defina `REBASE_TOKEN` no ambiente do servidor com um token sem as
permissões `deploy` e `env`.

**Lendo qualquer um dos seus projetos.** As ferramentas acima atuam no projeto vinculado.
Para ler dados de outro projeto — qualquer projeto em qualquer organização à qual a
conta conectada pertença, vinculado aqui ou não —, `rebase_cloud_projects_list` lista-os
e `rebase_project_use_cloud` (com um id, slug ou nome) aponta as ferramentas de dados e
de administração para ele: `query_table`, `get_row`, `list_users`, `list_roles`,
`cron_list_jobs`, `storage_list_objects`. Essas chamadas passam pelo proxy do Studio
no console, portando a própria credencial da CLI (`rebase cloud access-token`, lida
a cada chamada e nunca armazenada); o control plane verifica o acesso do usuário e
anexa a service key do projeto do lado dele, de forma que nenhuma chave chegue à máquina.
Um projeto com o Studio desativado é recusado, e o seletor informa isso. É um
destino remoto como qualquer outro, de modo que ferramentas que alteram dados permanecem recusadas ali,
a menos que `REBASE_MCP_ALLOW_REMOTE_WRITES` esteja definido; `rebase_project_switch` desfaz a alteração.

Cada ferramenta funciona por snapshot:

- `rebase_cloud_logs` nunca faz streaming contínuo (follow). Seu resultado contém `nextSinceTime`; passe-o
  de volta como `since` para ler o que veio em seguida. Ela retorna as últimas 200 linhas, a menos que
  `tail` determine o contrário. `source: "build"` retorna o log da compilação mais recente.
- `rebase_cloud_deploy` acompanha o deploy até o final e verifica se a nova
  versão responde. `wait: false` retorna assim que a implantação é acionada.
  Ele nunca remove um projeto do runtime gerenciado, nunca faz deploy de uma versão anterior
  do framework nem pula as verificações de compilação: essas são decisões do usuário, e uma
  recusa que exija uma delas informará isso.
- `rebase_cloud_rollback` passa `--yes`. A chamada da ferramenta atua como a confirmação, já
  que não há terminal para solicitar confirmação interativa.

`rebase_cloud_env_set` grava o valor na entrada padrão (stdin) da CLI, portanto ele nunca
fica visível em uma linha de comando onde o comando `ps` o mostraria, e o valor é removido de
qualquer resposta que a ferramenta retorne. Seu resultado informa o que foi armazenado (a chave, se
é secreta, se um novo deploy está pendente), nunca o valor. `rebase_cloud_env_list`
lista apenas as chaves. Uma CLI mais antiga que não suporte `env set --stdin` é recusada com uma mensagem orientando
a sua atualização; o valor não é enviado de outra forma.

Os resultados retornam no [envelope de dados não confiáveis](#marcação-de-dados-não-confiáveis-untrusted-data),
precedidos por uma linha do servidor sobre o que fazer a seguir. Uma recusa é um erro de ferramenta
que carrega o código da CLI, como `no_project`, `token_rejected`,
`managed_project` ou `deploy_failed`. Quando o servidor reconhece o código, ele
adiciona o próximo passo, seguido da mensagem da própria CLI. Cada ferramenta valida seus argumentos
contra o schema anunciado antes de qualquer inicialização, recusando
qualquer argumento não declarado.

## Referência de ferramentas

53 ferramentas, divididas em dez grupos: schema e banco de dados, planejamento de schema, documentos, usuários
e roles, storage, cron, funções, servidor de desenvolvimento, registro de projetos e
Rebase Cloud.
Cada uma delas, acompanhada de seus requisitos e da indicação se o gate a recusa contra um
destino não local, está na [Referência de ferramentas MCP](/docs/ai/mcp-tool-reference).

## Recursos (Resources)

<span class="since-badge" data-since="0.31">Desde 0.31</span>

Além das ferramentas, o servidor expõe recursos MCP para que um cliente possa obter o
contexto do projeto sem precisar gastar uma chamada de ferramenta:

| URI | Descrição |
|---|---|
| `rebase://tables/{name}` | Código-fonte em TypeScript da definição da tabela (`defineTable`) |
| `rebase://schema` | O schema Drizzle gerado (`schema.generated.ts`) |

Arquivos de tabela são os módulos do diretório de schema, com exceção do seu `index.ts`: a
chave `tables` da aplicação de backend em `rebase.json`, `backend/schema` por padrão,
sob o diretório do projeto ativo ou seu `app/`.

`rebase://schema` é listado **apenas se** o schema gerado existir.
`findBackendDir` procura por `backend/` e depois por `app/backend/` sob o diretório do
projeto ativo, e lê `src/schema.generated.ts` daquele que encontrar —
de modo que tanto o layout padrão do scaffold quanto o deste monorepo funcionam, enquanto um projeto estruturado de
uma terceira forma, ou um que ainda não tenha executado `rebase schema generate`, simplesmente não
verá o recurso disponível.

## O endpoint remoto

Um backend implantado também pode servir MCP diretamente, em `/mcp`, para as pessoas que usam
sua aplicação, com cada uma conectando-se como ela mesma sob seu próprio row-level
security. Isso tem uma página dedicada:
[O Endpoint MCP Remoto](/docs/ai/remote-mcp/).

## Configuração recomendada

- Aponte o servidor para um projeto **local** e deixe `REBASE_MCP_ALLOW_REMOTE_WRITES`
  indefinido. O gate é o recurso mais valioso do pacote.
- Para qualquer coisa remota, registre uma **chave de API `rk_` com escopo restrito** em vez de deixar
  a descoberta fornecer uma service key.
- Verifique `rebase_project_current` quando a saída parecer incorreta. O projeto ativo é
  persistente e reside fora do seu repositório.
- Trate `~/.rebase/projects.json` como um arquivo de segredos.
