---
sourceHash: c4c752011dc403fc
title: Servidor MCP
sidebar_label: Servidor MCP
description: Conecte o Claude Code, Cursor, Gemini CLI ou qualquer cliente MCP a um projeto Rebase — as 53 ferramentas que ele expõe, a credencial com a qual ele se autentica e o gate de loopback que fica entre um agente e a produção.
---

`@rebasepro/mcp` é um servidor [Model Context Protocol](https://modelcontextprotocol.io)
que fornece a um assistente de IA ferramentas reais sobre um projeto Rebase: ler e
gravar linhas, gerenciar usuários, executar migrações, invocar funções, controlar o
servidor de desenvolvimento.

Ele se comunica via MCP **apenas por stdio**. Não há porta e nenhum listener — o
processo é exatamente tão confiável quanto o processo que o gerou, e não há
chamador remoto para autenticar. Essa é a parte segura. As perguntas interessantes dizem
respeito ao que ele faz *depois* de estar em execução, e esta página responde a elas antes
de mostrar o bloco de configuração.

Um backend implantado também pode servir o próprio MCP, via HTTP, para as pessoas que usam
sua aplicação. Isso é algo diferente com um modelo de credenciais diferente:
consulte [O Endpoint MCP Remoto](/docs/ai/remote-mcp/).

:::tip[Usando o Claude na web, desktop ou mobile?]
Adicione o [conector Rebase](/docs/ai/rebase-connector/) em vez disso:
`https://app.rebase.pro/mcp`, uma vez, para cada projeto que você executa no Rebase Cloud
ou em seus próprios servidores. Esta página aborda o servidor local que um assistente de programação inicia
dentro de um projeto.
:::

## Conectando um cliente

O servidor é executado a partir do seu projeto: `@rebasepro/mcp` é uma devDependency que todo
scaffold gerado por `rebase init` fixa com a CLI, e cada bloco abaixo — toda a
integração — inicia essa cópia (`pnpm exec rebase-mcp`, ou `npx --no rebase-mcp`
em um projeto npm), nunca uma mais recente do npm. Um projeto mais antigo adiciona-o uma única vez,
com `rebase skills install --mcp` ou `pnpm add -D @rebasepro/mcp`.

O `rebase init` grava o bloco para cada agente escolhido quando
[configura seus agentes de codificação por IA](/docs/ai/skills#set-up-by-rebase-init), mantendo
quaisquer outros servidores já existentes no arquivo. `rebase init --agent cursor,codex` faz
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
O Codex lê a configuração de um projeto somente após você ter confiado no projeto:

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

O **Windsurf** lê servidores MCP apenas de sua configuração em nível de usuário, portanto não há
arquivo de projeto para gravar. Adicione o servidor em suas configurações de MCP como `"command": "pnpm"`,
`"args": ["--dir", "/absolute/path/to/your/project", "exec", "rebase-mcp"]`, com esse caminho definido como `REBASE_PROJECT_DIR`.

Qualquer cliente MCP que possa gerar um processo de servidor via stdio funciona; o formato é o mesmo.

### Em qual diretório ele atua

`REBASE_PROJECT_DIR` é o diretório que contém o `rebase.json`. Há **uma**
ordem de precedência, e ela é a mesma em todos os clientes:

1. **O bloco de ambiente** — `REBASE_PROJECT_DIR`, `REBASE_BASE_URL`,
   `REBASE_API_TOKEN`. Se algum deles estiver definido, o projeto `default` é reconstruído
   a partir deles a cada inicialização.
2. **O diretório de trabalho do servidor**, quando contém um `rebase.json`. O projeto
   no qual você está atualmente tem precedência sobre qualquer coisa lembrada em `~/.rebase/projects.json`.
3. **O `default` persistido** em `~/.rebase/projects.json`, quando nenhum dos
   dois primeiros define algo.

A descoberta automática a partir de `.rebase/state.json` preenche lacunas em todos os três casos e nunca
substitui um valor fornecido por um deles.

Os blocos em nível de projeto nomeiam o projeto — `"."`, o diretório de trabalho
do cliente ou o `${workspaceFolder}` do editor — porque a regra 3 lê um arquivo
compartilhado por todos os projetos na máquina. Uma configuração em nível de usuário, como a do Windsurf,
define um caminho absoluto em seu lugar.

## O que o servidor pode alcançar

Esta é a seção a ser lida antes de apontar um assistente para um banco de dados com o qual você se importa.

O servidor carrega **uma credencial de ambiente para todo o processo**. Não há
identidade por ferramenta e não há modo somente leitura; cada ferramenta usa o mesmo token, e a
única opção no pacote serve para habilitar *mais* alcance, e não menos.

Qual credencial é essa, em ordem de prioridade:

1. `REBASE_API_TOKEN` das variáveis de ambiente. `REBASE_TOKEN` não é lido aqui:
   ele é o token do plano de controle da CLI e nunca é enviado para a aplicação (o
   servidor informa isso uma vez no stderr quando ele é o único definido). As ferramentas de nuvem
   ainda o passam para a CLI que geram, que por sua vez o envia ao plano de controle.
2. `REBASE_SERVICE_KEY` lido do `.env` do projeto.
3. A chave de serviço descoberta automaticamente a partir de `.rebase/state.json` enquanto `rebase dev`
   estiver em execução.

Os itens 2 e 3 correspondem à chave do backend de desenvolvimento desta máquina, usada somente quando o destino está em
loopback. Quando `REBASE_BASE_URL` aponta para outro lugar — `rebase cloud init --claim`
grava o endereço do projeto em nuvem, e nenhum `REBASE_API_TOKEN` até que uma implantação
seja bem-sucedida —, o servidor não envia nenhum token e informa isso uma vez no stderr.

Um token registrado por você para um projeto **tem prioridade sobre a descoberta automática**. A descoberta serve apenas
para preencher lacunas.

:::danger[O caminho sem configuração (zero-config) é uma credencial de administrador]
As opções 2 e 3 são a **chave de serviço** — um segredo de administração sem restrição de escopo. O backend
a resolve para `uid: "service"`, `roles: ["admin"]`, `isAdmin: true`. Essa
identidade possui todos os [escopos](/docs/backend/roles-and-scopes/), e satisfaz as
políticas `_default_admin_read` / `_default_admin_write` que o Rebase injeta em
cada tabela que não tenha definido `defaultPolicies: false`.

Portanto, a resposta honesta para "o RLS ainda impõe restrições a ele?" é: o RLS *é executado* — o
driver faz o downgrade para a role `rebase_user` — e, em seguida, uma política que o próprio Rebase
escreveu concede tudo a essa identidade. Ler cada linha de cada
tabela é o **comportamento planejado da configuração padrão**, não um
bypass.

Com a configuração zero-config, um agente de posse dessas ferramentas pode ler e gravar cada
linha de cada tabela, listar todos os usuários, redefinir qualquer senha, invocar qualquer função
de backend e executar DDL no `DATABASE_URL` que o projeto resolver.
:::

### Fornecendo uma credencial restrita em vez disso

Registre uma [chave de API](/docs/backend/api-keys) com escopos definidos e o modelo de dois gates
se aplicará de verdade. Uma chave de serviço executa com as roles `["service"]`, as quais as
políticas padrão de administração injetadas **não** mencionam — portanto, o RLS não concede nada a ela, a menos que uma de
suas próprias políticas diga o contrário, e seus escopos a restringem ainda mais:

```bash
rebase api-keys create -n "claude-code" \
  --scopes data:read:articles \
  --expires-in 30
```

Em seguida, passe a chave `rk_live_…` resultante para o servidor em vez de deixá-lo
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

Duas coisas que isso **não** faz, ambas úteis de saber antes de depender disso:

- **Não restringe as ferramentas de CLI.** `rebase_db_push`, `rebase_db_migrate`,
  `rebase_doctor` e as ferramentas de branch geram a CLI do Rebase, que se conecta com
  `DATABASE_URL` e nunca vê o seu token. O gate de loopback abaixo é a
  única proteção diante delas.
- **Uma chave acessa uma ferramenta de administração apenas se tiver o escopo dessa ferramenta.** `list_users` e
  `list_roles` precisam de `users:read`; `create_user`, `update_user`, `delete_user` e
  `rebase_auth_reset_password` precisam de `users:write`; as ferramentas de storage e cron
  precisam do escopo correspondente `storage:*` ou `cron:*`; `invoke_function` precisa de
  `functions:invoke`. Sem
  ele, a chamada responde com `403 SCOPE_MISSING`. Mesmo com `users:write`, uma chave não pode
  alterar a conta de um administrador: um administrador possui `keys:read` e `keys:write`, algo que nenhuma
  chave pode ter, e ninguém pode gerenciar uma conta que possui mais privilégios do que si próprio.

Uma chave criada com `--roles admin` é outro caso: ela carrega as roles
`["service", "admin"]`, o que atende às mesmas políticas padrão de admin que a chave de
serviço atende. Conceda a ela `--full-access` também e seu alcance será equivalente ao da chave de serviço,
exceto pelo gerenciamento de chaves. O que ela traz de vantagem é ser **revogável, expirável e
com limite de requisições por chave (rate-limited)**, nada do que se aplica à chave de serviço — rotacioná-la
exige editar o `.env` e reiniciar o servidor.

Consulte [Agentes e Servidores MCP](/docs/backend/api-keys#agents-and-mcp-servers) para obter as
orientações completas sobre escopos de chaves.

### Colocando uma tabela totalmente fora de alcance

A razão pela qual uma credencial de administrador lê tudo é a política básica que o Rebase
injeta em cada tabela, concedendo acesso ao contexto confiável do servidor e à
role `admin`. Uma tabela pode optar por não utilizar essa base e assumir total
responsabilidade por seu próprio RLS:

```ts
import { defineTable, col } from "@rebasepro/server/schema";

export const medicalRecords = defineTable("medical_records", {
    columns: {
        id:        col.uuid().primaryKey().defaultRandom(),
        patientId: col.text(),
        notes:     col.text(),
    },
    // Remove o baseline padrão de admin/server injetado — nada é legível
    // exceto o que as regras abaixo permitirem.
    defaultPolicies: false,
    rls: [
        { operations: ["select", "update"], ownerField: "patientId" },
    ],
});
```

Agora, a única maneira de acessar é correspondendo a `patientId`. O uid da chave de serviço é a
string literal `service`, de modo que uma regra de proprietário (owner) nunca corresponderá a ela — leituras retornam zero
linhas e gravações são rejeitadas pelo Postgres. Este é o único controle que restringe
a credencial padrão do servidor MCP em vez de ignorá-la.

Lembre-se de que esta é uma alteração real de RLS, não apenas de documentação: ela entra em vigor
somente após `rebase schema generate` e uma migração terem aplicado as políticas. Consulte
[Segurança a nível de linha (RLS)](/docs/collections/security-rules).

## O gate de loopback

`rebase_project_add` aceita qualquer `baseUrl`, e as ferramentas de CLI conectam-se com
qualquer `DATABASE_URL` que o projeto declare. A mesma lista de ferramentas que edita um
banco de dados temporário em seu computador pode, portanto, apagar linhas de produção, sem nada
no caminho além do discernimento do assistente sobre qual projeto está ativo.

**Toda ferramenta que altera o ambiente de destino é recusada, a menos que esse destino esteja
na interface de loopback.** O gate é construído com base em uma lista do que *não*
é bloqueado, para que qualquer ferramenta adicionada posteriormente chegue protegida por padrão.

- **Não bloqueadas — leituras:** `rebase_schema_plan`, `rebase_doctor`,
  `rebase_db_branch_list`, `rebase_db_branch_info`, `rebase_db_branch_diff`, `query_table`,
  `get_row`, `list_users`, `list_roles`, `storage_list_objects`,
  `storage_get_download_url`, `cron_list_jobs`, `cron_get_job`, `cron_get_job_logs`,
  `rebase_dev_logs`, e as leituras do Rebase Cloud `rebase_cloud_status`,
  `rebase_cloud_logs`, `rebase_cloud_env_list`, `rebase_cloud_deployments_list`.
- **Não bloqueadas — gravações do Rebase Cloud:** `rebase_cloud_provision`,
  `rebase_cloud_deploy`, `rebase_cloud_env_set`, `rebase_cloud_rollback`.
  O provisionamento cria um projeto; os outros alteram um projeto em produção. Nenhum
  deles passa por `baseUrl` ou `DATABASE_URL`, que são tudo o que o gate pode
  verificar. Consulte [Rebase Cloud](#rebase-cloud) para saber o que atua como proteção diante deles.
- **Não bloqueadas — apenas locais:** `rebase_schema_introspect`, `rebase_db_branch_switch`, `rebase_schema_generate`, `rebase_db_generate`,
  `rebase_generate_sdk`, as ferramentas do dev-server e as ferramentas de registro de projetos.
  Estas gravam arquivos locais ou estado local e não possuem destino remoto para validar.
- **Bloqueadas contra `DATABASE_URL`:** as ferramentas de CLI restantes — `rebase_db_push`,
  `rebase_db_migrate`, `rebase_db_branch_create`, `rebase_db_branch_delete`.
- **Bloqueadas contra o `baseUrl` do projeto:** as ferramentas de SDK restantes —
  `create_row`, `update_row`, `delete_row`, `create_user`,
  `update_user`, `delete_user`, `rebase_auth_reset_password`,
  `storage_delete_object`, `cron_trigger_job`, `cron_toggle_job`,
  e `invoke_function`.

Os dois destinos não são intercambiáveis. As ferramentas de CLI nunca veem o `baseUrl`, portanto, um
backend em localhost associado a uma `DATABASE_URL` de produção é verificado contra
o banco de dados, e não contra o backend.

Uma recusa se parece com isto:

```text
Error: Refusing to run "delete_row": project "default" points at
https://api.example.com/, which is not local. Set REBASE_MCP_ALLOW_REMOTE_WRITES=true
to allow destructive tools against remote environments.
```

**Se nenhuma string de conexão puder ser resolvida, as ferramentas bloqueadas de banco de dados serão recusadas.**
Sem nenhuma `DATABASE_URL`, a CLI usa o banco de desenvolvimento gerenciado, que é
o padrão para um novo projeto, e o gate recusa suas quatro ferramentas de banco de dados
nesse cenário. A recusa explica o motivo e indica o que funciona em substituição. Ela não sugere
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

Apenas loopback é considerado local: `localhost`, `*.localhost`, `127.0.0.0/8`, `::1`
(e `0.0.0.0`).
Faixas privadas como `10.x` e `192.168.x` **não** são consideradas locais — é tão provável que sejam
um cluster de staging compartilhado quanto um laptop, e tratá-las como locais liberaria
exatamente o tipo de acidente que o gate foi criado para impedir.

Defina `REBASE_MCP_ALLOW_REMOTE_WRITES=true` para desativar essa proteção. Defini-la globalmente na
configuração do seu cliente MCP remove o gate para todos os projetos que o servidor alcança, não
apenas para aquele em que você estava pensando.

## Marcação de dados não confiáveis (Untrusted-data marking)

Linhas, registros de usuários, listagens de storage, jobs de cron, respostas de funções e saídas
da CLI retornam encapsulados em um envelope explícito:

```text
<<<UNTRUSTED_DATA source="query_table" id="9b2f4c1e-…">>>
[ … rows … ]
<<<END_UNTRUSTED_DATA id="9b2f4c1e-…">>>
```

Qualquer informação armazenada em seu banco de dados foi gravada por alguém e chega
pelo mesmo canal que o contrato de ferramentas que o assistente está seguindo. O envelope orienta
o modelo a tratá-la como conteúdo inerte, e não como instruções.

O `id` é gerado novamente para cada resposta, após os dados terem sido gravados, e
somente o marcador final contendo esse ID encerra o bloco. Textos dentro dos dados com
formato idêntico ao de um marcador são quebrados com um espaço de largura zero (zero-width space), de modo que uma linha que imprima
`<<<END_UNTRUSTED_DATA>>>` não consiga encerrar o envelope prematuramente e expor o que vem a seguir.

O [endpoint remoto](/docs/ai/remote-mcp/) delimita seus resultados de ferramentas da mesma
forma e comunica isso ao cliente; seu `structuredContent` transporta o resultado puro.
`list_tables` e
`describe_table` são as exceções: apenas um modelo as lê, portanto são
enviadas uma vez, no próprio texto.

Trata-se de um marcador, não de um sandbox. Um assistente com acesso a essas ferramentas é tão seguro
quanto o conteúdo que você permite que ele leia.

## Múltiplos projetos

As configurações de projetos são armazenadas em `~/.rebase/projects.json`, e o servidor
pode manter várias ao mesmo tempo — útil quando você trabalha entre ambientes locais
e remotos. Enquanto o `rebase dev` estiver em execução, o servidor lê a porta ativa e a
chave de serviço de `.rebase/state.json` no diretório do projeto, o que torna
o caso local livre de configurações adicionais (zero-config).

:::note[O registro é a última palavra, não a primeira]
A precedência é a apresentada acima: bloco de variáveis de ambiente, depois o diretório de trabalho
quando contém um `rebase.json`, e por fim o `default` persistido.

`REBASE_PROJECT_DIR`, `REBASE_BASE_URL` e `REBASE_API_TOKEN` reconstroem o
projeto `default` **a cada inicialização**, não apenas na primeira. A reconstrução é
completa: um token registrado para o `projectDir` antigo é descartado em vez
de ser levado para um diretório para o qual nunca foi emitido. Um `default` derivado dessa
forma — ou a partir do diretório de trabalho — nunca é regravado em
`~/.rebase/projects.json`, para que a chave de serviço de desenvolvimento de um projeto não se torne
a de outro.

`activeProject` é persistente, portanto, se uma sessão anterior chamou
`rebase_project_switch`, as ferramentas terão como alvo esse projeto e o servidor avisará sobre
isso no stderr — a menos que esse projeto esteja registrado sob um diretório *diferente*
daquele em que este servidor é executado, caso em que ele volta para `default` e emite
um aviso. Se um assistente parecer estar lendo o banco de dados errado, chame
`rebase_project_current` primeiro.
:::

### Em qual projeto uma chamada atua

`activeProject` afeta a máquina inteira, e frequentemente um servidor é instalado apenas uma vez para toda a máquina. Portanto, cada ferramenta que atua sobre um projeto (todas, exceto as ferramentas de registro `rebase_project_*`, `rebase_cloud_projects_list`, `rebase_cloud_provision` e `rebase_dev_logs`) resolve seu projeto **a cada chamada**, e aceita um parâmetro opcional `project`: o nome de um projeto registrado, ou um slug ou ID do Rebase Cloud. A chamada é verificada contra o vínculo com o Cloud (`.rebase/cloud.json`) do diretório em que a sessão trabalha: o primeiro [root](https://modelcontextprotocol.io/specification/latest/client/roots) do cliente, ou o diretório de trabalho do servidor.

| A chamada | Diretório da sessão | Resultado |
|---|---|---|
| especifica um projeto | está vinculado ao mesmo projeto | executa nele |
| especifica um projeto | está vinculado a outro projeto | **recusada**, nada executa |
| não especifica projeto | está vinculado a um projeto diferente do ativo | **recusada**, nada executa |
| não especifica projeto | está vinculado; o projeto ativo é um local em outro lugar | executa no projeto vinculado |
| não especifica projeto | não está vinculado | executa no projeto ativo; uma *gravação* em um projeto Cloud selecionado por uma sessão anterior requer o projeto especificado |

Uma recusa informa ambos os projetos. `rebase_project_current` relata o diretório da sessão e o vínculo sob `session`. `rebase_cloud_env_set` e `rebase_cloud_rollback` passam o projeto resolvido para a CLI com `--project`; `rebase_cloud_deploy` envia o diretório no qual está em execução, portanto é recusado caso o vínculo desse diretório aponte para outro projeto.

Os tokens são armazenados nesse registro **em texto simples**. Trata-se de um arquivo em seu diretório
pessoal que contém credenciais de administrador para todos os projetos registrados; trate-o
com o devido cuidado.

## Rebase Cloud

Oito ferramentas levam uma aplicação deste diretório para um backend ativo no
[Rebase Cloud](/docs/deployment/cloud/) e a mantêm funcionando. Cada uma executa
`rebase cloud <command> --json` no diretório do projeto ativo: o mesmo
comando que uma pessoa executa, portanto não há uma segunda implementação sujeita a divergências.

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

O fluxo de trabalho típico de um agente é: `rebase_cloud_provision`, em seguida fornecer ao usuário a
URL de reivindicação (claim URL); `rebase_cloud_status` para visualizar o projeto (enquanto ele não for reivindicado,
`unclaimed` conterá a URL de reivindicação e o momento em que será excluído); `rebase_cloud_deploy`
após uma alteração; `rebase_cloud_logs` quando algo apresentar problemas; e
`rebase_cloud_rollback` quando a produção for corrompida.

**Em que atuam.** No projeto que a chamada resolve, conforme descrito em
[Em qual projeto uma chamada atua](#em-qual-projeto-uma-chamada-atua): o argumento
`project`, verificado contra o vínculo do diretório da sessão, ou esse vínculo, ou
o projeto ativo. Uma chamada que especifica um projeto ao qual o diretório da sessão não
está vinculado é recusada antes que qualquer processo seja iniciado.

**Sob qual autoridade.** Qualquer autoridade que a CLI resolver naquele diretório: `REBASE_TOKEN`
quando estiver definido, depois o token que `rebase cloud init --claim` armazenou para um
projeto não reivindicado, e por fim a sessão do `rebase cloud login`. No diretório de um
projeto não reivindicado, um `REBASE_TOKEN` sem escopo no projeto é deixado
de lado em favor do token próprio do projeto. O plano de controle
avalia cada chamada da mesma forma que avalia a CLI; portanto, com um token criado por
`rebase cloud tokens create --can logs`, um assistente pode ler logs, e o
plano de controle recusa seus deploys, variáveis e rollbacks. A ausência de credencial, ou uma credencial recusada, retorna como um erro que informa o que o
usuário deve fazer (`rebase cloud login`, ou reivindicar o projeto).

**Por que o gate de loopback não se aplica.** O gate verifica o `baseUrl` da aplicação e o
`DATABASE_URL` da CLI; essas ferramentas não utilizam nenhum dos dois. Após `rebase_cloud_provision`,
o `REBASE_BASE_URL` aponta para o novo projeto em nuvem, de modo que bloqueá-lo recusaria
o próprio deploy de que o fluxo precisa. O provisionamento em si apenas cria: não afeta
nenhuma aplicação ou banco de dados existente, e a CLI ainda o recusa em um diretório que
já esteja vinculado. Um deploy, uma variável e um rollback alteram,
cada um, o ambiente de produção. O que atua como barreira diante deles é a credencial mencionada acima, a
aprovação de ferramentas do seu cliente MCP e `confirm: true`: `rebase_cloud_deploy` para
produção, `rebase_cloud_env_set` em produção, `rebase_cloud_rollback` e
`rebase_cloud_provision` respondem o que fariam e não fazem nada até que uma chamada
repita os mesmos argumentos com `confirm: true`, o que o assistente envia somente
após a concordância do usuário. Um deploy de preview e uma variável de preview não exigem isso. Para impedir que um assistente modifique um projeto
na nuvem, defina `REBASE_TOKEN` no ambiente do servidor com um token sem as
permissões de `deploy` e `env`.

**Lendo qualquer um dos seus projetos.** As ferramentas acima atuam no projeto vinculado.
Para ler dados de outro projeto — qualquer projeto em qualquer organização à qual a
conta conectada pertença, vinculado aqui ou não —, `rebase_cloud_projects_list` lista-os
e `rebase_project_use_cloud` (com um ID, slug ou nome) aponta as ferramentas de dados e de
administração para ele: `query_table`, `get_row`, `list_users`, `list_roles`,
`cron_list_jobs`, `storage_list_objects`. Essas chamadas passam pelo proxy Studio do
console, transportando a credencial própria da CLI (`rebase cloud access-token`, lido
a cada chamada e nunca armazenado); o plano de controle valida o acesso da pessoa e
anexa a chave de serviço do projeto do seu lado, de forma que nenhuma chave chega à máquina.
Um projeto com o Studio desativado é recusado, e o switch avisa sobre isso. É um
destino remoto como qualquer outro, de modo que ferramentas que alteram dados permanecem recusadas
a menos que `REBASE_MCP_ALLOW_REMOTE_WRITES` esteja definido; `rebase_project_switch` desfaz a
seleção.

Cada ferramenta fornece uma visualização pontual (snapshot):

- `rebase_cloud_logs` nunca faz streaming contínuo (follow). Seu resultado contém `nextSinceTime`; passe-o
  de volta como `since` para ler o que ocorreu depois. Ele retorna as últimas 200 linhas, a menos que
  `tail` especifique o contrário. `source: "build"` retorna o log de build mais recente.
- `rebase_cloud_deploy` acompanha o deploy até o final e verifica se a nova
  versão responde. `wait: false` retorna assim que o deploy é acionado.
  Ele nunca remove um projeto do runtime gerenciado (eject), nunca implanta uma versão mais antiga
  do framework, nem pula as verificações de build: essas são decisões do usuário, e uma
  recusa que exija uma dessas ações explicará o motivo.
- `rebase_cloud_rollback` passa `--yes` assim que a chamada incluir `confirm: true`
  (abaixo), já que não há terminal para solicitar confirmação interativa.

`rebase_cloud_env_set` grava o valor na entrada padrão (stdin) da CLI, portanto ele nunca
fica exposto em uma linha de comando visível via `ps`, e o valor é removido de
qualquer retorno da ferramenta. Seu resultado informa o que foi armazenado (a chave, se
é secreta, se há um redeploy pendente), nunca o valor em si. `rebase_cloud_env_list`
lista apenas as chaves. Uma CLI mais antiga que não suporte `env set --stdin` é recusada com uma mensagem solicitando
sua atualização; o valor não é transmitido por outro meio.

Os resultados retornam no [envelope de dados não confiáveis](#marcação-de-dados-não-confiáveis-untrusted-data-marking),
abaixo de uma linha do servidor orientando sobre o que fazer em seguida. Uma recusa é um erro de ferramenta
que carrega o código da CLI, como `no_project`, `token_rejected`,
`managed_project` ou `deploy_failed`. Quando o servidor reconhece o código, ele
adiciona o próximo passo e, em seguida, a mensagem da própria CLI. Cada ferramenta verifica seus argumentos
contra o schema que anuncia antes que qualquer processo seja executado, e recusa qualquer
argumento que não tenha sido declarado.

## Referência de ferramentas

São 53 ferramentas, distribuídas em dez grupos: schema e banco de dados, planejamento de schema, documentos, usuários
e roles, storage, cron, funções, dev-server, registro de projetos e
Rebase Cloud.
Cada uma, com seus requisitos e a informação de se o gate a recusa contra um destino
não local, pode ser consultada na [Referência de ferramentas MCP](/docs/ai/mcp-tool-reference).

## Recursos (Resources)

Além de ferramentas, o servidor expõe recursos MCP para que um cliente possa extrair contexto
do projeto sem gastar uma chamada de ferramenta:

| URI | Descrição |
|---|---|
| `rebase://tables/{name}` | Código-fonte em TypeScript da definição de uma tabela (`defineTable`) |
| `rebase://schema` | O schema Drizzle gerado (`schema.generated.ts`) |

Arquivos de tabelas são os módulos do diretório de schema, exceto seu `index.ts`: a
chave `tables` da aplicação de backend em `rebase.json`, `backend/schema` por padrão,
sob o diretório do projeto ativo ou seu `app/`.

`rebase://schema` é listado **somente se** o schema gerado existir.
`findBackendDir` procura por `backend/` e depois por `app/backend/` sob o diretório do projeto
ativo, e lê `src/schema.generated.ts` daquele que encontrar —
dessa forma, tanto a estrutura padrão inicializada quanto a deste monorepo funcionam, e um projeto estruturado de
uma terceira forma, ou um que ainda não tenha executado `rebase schema generate`, simplesmente não
verá o recurso ser oferecido.

## Skills

O servidor também fornece as 24 [skills de agentes do Rebase](/docs/ai/skills/) por meio
da extensão de skills do MCP. Um cliente na revisão de protocolo 2026-07-28 ou superior
carrega uma skill quando precisa dela. No Claude Code, elas aparecem como `/rebase:rebase-tables` e
assim por diante. Sem o pacote `@rebasepro/agent-skills`, o servidor inicia sem elas e
informa isso no stderr.

## O endpoint remoto

Um backend implantado também pode servir o próprio MCP, em `/mcp`, para as pessoas que usam
sua aplicação, cada uma conectando-se como ela mesma sob sua respectiva segurança
a nível de linha (RLS). Esse tema tem sua própria página:
[O Endpoint MCP Remoto](/docs/ai/remote-mcp/).

## Configuração recomendada

- Aponte o servidor para um projeto **local** e deixe `REBASE_MCP_ALLOW_REMOTE_WRITES`
  indefinido. O gate é o recurso mais valioso do pacote.
- Para qualquer ambiente remoto, registre uma **chave de API `rk_` com escopos restritos** em vez de permitir
  que a descoberta forneça uma chave de serviço.
- Verifique `rebase_project_current` quando a saída parecer incorreta. O projeto ativo é
  persistente e reside fora do seu repositório.
- Trate o arquivo `~/.rebase/projects.json` como um arquivo de segredos.
