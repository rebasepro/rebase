---
sourceHash: a81f3289674f6e53
title: Servidor MCP
sidebar_label: Servidor MCP
description: Conecte o Claude Code, Cursor, Gemini CLI ou qualquer cliente MCP a um projeto Rebase — as 53 ferramentas que ele expõe, a credencial com a qual ele se autentica e a barreira de loopback que fica entre um agente e a produção.
---

O `@rebasepro/mcp` é um servidor do [Model Context Protocol](https://modelcontextprotocol.io)
que fornece a um assistente de IA ferramentas reais sobre um projeto Rebase: ler e
gravar linhas, gerenciar usuários, executar migrações, invocar funções e controlar o
servidor de desenvolvimento.

Ele se comunica via MCP **apenas por stdio**. Não há porta nem listener — o
processo é exatamente tão confiável quanto o que quer que o tenha gerado, e não há
chamador remoto para autenticar. Essa é a parte segura. As questões interessantes
dizem respeito ao que ele faz *depois* de estar em execução, e esta página responde a
elas antes de mostrar o bloco de configuração.

Um backend implantado também pode servir o MCP por si só, via HTTP, para as pessoas que usam
sua aplicação. Isso é algo diferente com um modelo de credenciais diferente:
consulte [O Endpoint MCP Remoto](/docs/ai/remote-mcp/).

:::tip[Usando o Claude na web, desktop ou celular?]
Adicione o [conector Rebase](/docs/ai/rebase-connector/):
`https://app.rebase.pro/mcp`, uma única vez, para cada projeto que você executa no Rebase Cloud
ou em seus próprios servidores. Esta página aborda o servidor local que um assistente de programação inicia
dentro de um projeto.
:::

## Conectando um cliente

O servidor roda a partir do seu projeto: `@rebasepro/mcp` é uma devDependency que todo
scaffold do `rebase init` fixa junto com a CLI, e cada bloco abaixo — toda a
integração — inicia essa cópia (`pnpm exec rebase-mcp`, ou `npx --no rebase-mcp`
em um projeto npm), nunca uma mais recente do npm. Um projeto mais antigo adiciona-o uma vez,
com `rebase skills install --mcp` ou `pnpm add -D @rebasepro/mcp`.

O `rebase init` grava o bloco para cada agente escolhido quando
[configura seus agentes de programação de IA](/docs/ai/skills#set-up-by-rebase-init), mantendo
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

**Codex CLI** — TOML em vez de JSON, no `.codex/config.toml` do projeto.
O Codex lê uma configuração de projeto somente depois que você confia no projeto:

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
`"args": ["--dir", "/absolute/path/to/your/project", "exec", "rebase-mcp"]`, com esse caminho como `REBASE_PROJECT_DIR`.

Qualquer cliente MCP capaz de iniciar um servidor stdio funciona; o formato é o mesmo.

### Em qual diretório ele atua

`REBASE_PROJECT_DIR` é o diretório que contém `rebase.json`. Há **uma**
ordem de precedência, e ela é a mesma em todos os clientes:

1. **O bloco de ambiente** — `REBASE_PROJECT_DIR`, `REBASE_BASE_URL`,
   `REBASE_API_TOKEN`. Se qualquer um deles estiver definido, o projeto `default` será
   reconstruído a partir deles a cada inicialização.
2. **O diretório de trabalho do servidor**, quando contiver um `rebase.json`. Um projeto
   no qual você se encontra sobrepõe qualquer coisa registrada em `~/.rebase/projects.json`.
3. **O `default` persistido** em `~/.rebase/projects.json`, quando nenhum dos
   dois primeiros declarar nada.

A descoberta automática a partir de `.rebase/state.json` preenche lacunas em todos os três casos e nunca
substitui um valor fornecido por um deles.

Os blocos em nível de projeto especificam o projeto — `"."`, o diretório de trabalho do cliente
ou o `${workspaceFolder}` do editor — porque a regra 3 lê um arquivo compartilhado por todos os
projetos na máquina. Uma configuração em nível de usuário, como a do Windsurf,
define um caminho absoluto em vez disso.

## O que o servidor pode acessar

Esta é a seção a ser lida antes de apontar um assistente para um banco de dados
importante.

O servidor mantém **uma credencial de ambiente para todo o processo**. Não há
identidade por ferramenta nem modo somente leitura; cada ferramenta usa o mesmo token, e a
única chave de configuração no pacote serve para conceder *mais* acesso em vez de menos.

Qual credencial é essa, em ordem de prioridade:

1. `REBASE_API_TOKEN` do ambiente. `REBASE_TOKEN` não é lido aqui:
   ele é o token do plano de controle da CLI e nunca é enviado para a aplicação (o
   servidor avisa isso uma vez no stderr quando ele é o único definido). As ferramentas de nuvem
   ainda o passam para a CLI que elas executam, que o envia para o plano de controle.
2. `REBASE_SERVICE_KEY` lida a partir do `.env` do projeto
3. A chave de serviço descoberta automaticamente a partir de `.rebase/state.json` enquanto `rebase dev`
   está em execução

2 e 3 são a chave do backend de desenvolvimento desta máquina, usada apenas quando o destino está em
loopback. Quando `REBASE_BASE_URL` aponta para outro lugar — `rebase cloud init --claim`
grava o endereço do projeto em nuvem e nenhum `REBASE_API_TOKEN` até que um deploy
seja bem-sucedido — o servidor não envia nenhum token e avisa isso uma vez no stderr.

Um token que você registra para um projeto **tem prioridade sobre a descoberta automática**. A descoberta apenas
preenche lacunas.

:::danger[O caminho sem configuração usa uma credencial de administrador]
As opções 2 e 3 são a **service key** (chave de serviço) — um segredo de administrador sem escopo restrito. O backend
a resolve como `uid: "service"`, `roles: ["admin"]`, `isAdmin: true`. Essa
identidade detém todos os [escopos](/docs/backend/roles-and-scopes/) e atende às
políticas `_default_admin_read` / `_default_admin_write` que o Rebase injeta em
cada tabela que não definiu `defaultPolicies: false`.

Portanto, a resposta sincera para "o RLS ainda impõe restrições?" é: o RLS *é executado* — o
driver rebaixa para o papel `rebase_user` — e então uma política criada pelo próprio
Rebase concede tudo a essa identidade. Ler todas as linhas de todas as tabelas é o
**comportamento projetado da configuração padrão**, não um bypass.

Com a configuração padrão (zero-config), um agente de posse dessas ferramentas pode ler e gravar todas as
linhas de todas as tabelas, listar todos os usuários, redefinir qualquer senha, invocar qualquer função
de backend e executar comandos DDL contra qualquer `DATABASE_URL` que o projeto resolver.
:::

### Fornecendo uma credencial restrita em vez disso

Registre uma [chave de API](/docs/backend/api-keys) com escopo e o modelo de duas
barreiras é aplicado de fato. Uma chave de serviço roda com os papéis `["service"]`, os quais as
políticas de admin injetadas **não** mencionam — portanto, o RLS não concede nada a ela a menos que uma de
suas próprias políticas determine o contrário, e seus escopos a restringem ainda mais:

```bash
rebase api-keys create -n "claude-code" \
  --scopes data:read:articles \
  --expires-in 30
```

Em seguida, forneça a chave `rk_live_…` resultante ao servidor em vez de deixá-lo
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

Duas coisas que isso **não** faz, ambas importantes de saber antes de depender disso:

- **Não restringe as ferramentas de CLI.** `rebase_db_push`, `rebase_db_migrate`,
  `rebase_doctor` e as ferramentas de branches executam a CLI do Rebase, que se conecta via
  `DATABASE_URL` e nunca vê o seu token. A barreira de loopback abaixo é a
  única proteção diante delas.
- **Uma chave só acessa uma ferramenta de administração com o escopo correspondente.** `list_users` e
  `list_roles` precisam de `users:read`; `create_user`, `update_user`, `delete_user` e
  `rebase_auth_reset_password` precisam de `users:write`; as ferramentas de storage e cron
  precisam do escopo correspondente `storage:*` ou `cron:*`; `invoke_function` precisa de
  `functions:invoke`. Sem ele,
  a chamada responde `403 SCOPE_MISSING`. Mesmo com `users:write`, uma chave não pode
  alterar a conta de um administrador: um admin possui `keys:read` e `keys:write`, algo que nenhuma
  chave pode ter, e ninguém pode gerenciar uma conta com mais privilégios do que os seus próprios.

Uma chave criada com `--roles admin` é diferente: ela carrega os papéis
`["service", "admin"]`, o que atende às mesmas políticas padrão de admin que a chave de serviço
atende. Conceda também `--full-access` e o alcance dela será o da chave de serviço,
exceto o gerenciamento de chaves. A vantagem é que ela é **revogável, expirável e possui limitação
de taxa (rate limit) por chave**, nada do qual se aplica à chave de serviço — rotacioná-la
exige editar o `.env` e reiniciar o servidor.

Consulte [Agentes e Servidores MCP](/docs/backend/api-keys#agents-and-mcp-servers) para obter o
guia completo sobre escopo de chaves.

### Colocando uma tabela totalmente fora de alcance

O motivo pelo qual uma credencial de administrador lê tudo é a política de base que o Rebase
injeta em cada tabela, concedendo acesso ao contexto confiável do servidor e ao
papel `admin`. Uma tabela pode cancelar essa política de base e assumir
total responsabilidade pelo seu próprio RLS:

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

Agora a única forma de acesso é corresponder ao `patientId`. O uid da service key é a
string literal `service`, portanto uma regra de proprietário (owner rule) nunca corresponderá a ele — leituras retornam zero
linhas e gravações são rejeitadas pelo Postgres. Este é o único controle que restringe
a credencial padrão do servidor MCP em vez de ignorá-la.

Lembre-se de que essa é uma alteração real de RLS, não apenas de documentação: ela entra em vigor
somente após `rebase schema generate` e uma migração aplicarem as políticas. Consulte
[Segurança em nível de linha (RLS)](/docs/collections/security-rules).

## A barreira de loopback

`rebase_project_add` aceita qualquer `baseUrl`, e as ferramentas de CLI conectam-se a
qualquer `DATABASE_URL` declarada pelo projeto. A mesma lista de ferramentas que edita um
banco de dados de rascunho em seu notebook pode, portanto, excluir linhas de produção, sem nada
intermediário além do discernimento do assistente sobre qual projeto está ativo.

**Toda ferramenta que altera o ambiente de destino é recusada a menos que esse destino esteja
na interface de loopback.** A barreira é estruturada como uma lista do que *não*
é bloqueado, de modo que qualquer ferramenta adicionada posteriormente já venha protegida por padrão.

- **Sem bloqueio — leituras:** `rebase_schema_plan`, `rebase_doctor`,
  `rebase_db_branch_list`, `rebase_db_branch_info`, `rebase_db_branch_diff`, `query_table`,
  `get_row`, `list_users`, `list_roles`, `storage_list_objects`,
  `storage_get_download_url`, `cron_list_jobs`, `cron_get_job`, `cron_get_job_logs`,
  `rebase_dev_logs`, e as leituras do Rebase Cloud `rebase_cloud_status`,
  `rebase_cloud_logs`, `rebase_cloud_env_list`, `rebase_cloud_deployments_list`.
- **Sem bloqueio — gravações no Rebase Cloud:** `rebase_cloud_provision`,
  `rebase_cloud_deploy`, `rebase_cloud_env_set`, `rebase_cloud_rollback`.
  O provisionamento cria um projeto; as demais alteram um projeto em produção. Nenhuma
  delas passa por `baseUrl` ou `DATABASE_URL`, que é tudo o que a barreira pode
  verificar. Consulte [Rebase Cloud](#rebase-cloud) para saber quais proteções estão diante delas.
- **Sem bloqueio — somente locais:** `rebase_schema_introspect`, `rebase_db_branch_switch`, `rebase_schema_generate`, `rebase_db_generate`,
  `rebase_generate_sdk`, as ferramentas do servidor de desenvolvimento e as ferramentas de registro de projeto.
  Elas gravam arquivos locais ou estado local e não têm um destino remoto a verificar.
- **Bloqueadas com base na `DATABASE_URL`:** as ferramentas de CLI restantes — `rebase_db_push`,
  `rebase_db_migrate`, `rebase_db_branch_create`, `rebase_db_branch_delete`.
- **Bloqueadas com base na `baseUrl` do projeto:** as ferramentas de SDK restantes —
  `create_row`, `update_row`, `delete_row`, `create_user`,
  `update_user`, `delete_user`, `rebase_auth_reset_password`,
  `storage_delete_object`, `cron_trigger_job`, `cron_toggle_job`
  e `invoke_function`.

Os dois destinos não são intercambiáveis. As ferramentas de CLI nunca veem a `baseUrl`, portanto, um
backend em localhost configurado ao lado de uma `DATABASE_URL` de produção é verificado contra
o banco de dados, não contra o backend.

Uma recusa se parece com isto:

```text
Error: Refusing to run "delete_row": project "default" points at
https://api.example.com/, which is not local. Set REBASE_MCP_ALLOW_REMOTE_WRITES=true
to allow destructive tools against remote environments.
```

**Se nenhuma string de conexão puder ser resolvida, as ferramentas de banco de dados protegidas serão recusadas.**
Sem uma `DATABASE_URL`, a CLI usa o banco de dados de desenvolvimento gerenciado, que é
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
`rebase db push` e `rebase db migrate` de fato rodam nesse banco de dados; apenas as
ferramentas MCP são recusadas.

Apenas o loopback conta como local: `localhost`, `*.localhost`, `127.0.0.0/8`, `::1`
(e `0.0.0.0`).
Faixas privadas como `10.x` e `192.168.x` **não** contam — elas têm a mesma probabilidade de ser
um cluster compartilhado de homologação ou um notebook, e tratá-las como locais autorizaria
exatamente o acidente que a barreira foi feita para evitar.

Defina `REBASE_MCP_ALLOW_REMOTE_WRITES=true` para desativar essa proteção. Defini-la globalmente na
configuração do seu cliente MCP remove a barreira para todos os projetos que o servidor puder alcançar,
não apenas aquele em que você estava pensando.

## Marcação de dados não confiáveis

Linhas, registros de usuários, listagens de storage, jobs de cron, respostas de funções e saídas
de CLI retornam encapsulados em um envelope explícito:

```text
<<<UNTRUSTED_DATA source="query_table" id="9b2f4c1e-…">>>
[ … rows … ]
<<<END_UNTRUSTED_DATA id="9b2f4c1e-…">>>
```

Qualquer coisa armazenada no seu banco de dados foi gravada por alguém e chega
pelo mesmo canal que o contrato de ferramentas que o assistente está seguindo. O envelope orienta
o modelo a tratá-lo como conteúdo inerte, em vez de instruções.

O `id` é gerado novamente para cada resposta, após a gravação dos dados, e
somente o marcador final que o contém fecha o bloco. O texto dentro dos dados que
tiver o formato de um marcador é quebrado com um espaço de largura zero (zero-width space), de modo que uma linha que
contenha `<<<END_UNTRUSTED_DATA>>>` não consiga fechar o envelope prematuramente e expor o que
vem a seguir.

O [endpoint remoto](/docs/ai/remote-mcp/) delimita os resultados de suas ferramentas da mesma
maneira e informa isso ao cliente; seu `structuredContent` carrega o resultado simples.
`list_tables` e
`describe_table` são as exceções: apenas um modelo os lê, portanto são
enviados uma única vez, no texto.

É uma marcação, não um sandbox. Um assistente em posse dessas ferramentas é tão seguro
quanto o conteúdo que você permite que ele leia.

## Múltiplos projetos

As configurações dos projetos são armazenadas em `~/.rebase/projects.json`, e o servidor
pode manter várias simultaneamente — útil ao trabalhar entre ambientes locais e remotos.
Enquanto o `rebase dev` está em execução, o servidor lê a porta ativa e a
chave de serviço de `.rebase/state.json` no diretório do projeto, o que
torna o uso local livre de configurações adicionais (zero-config).

:::note[O registro é a última palavra, não a primeira]
A precedência é a apresentada acima: bloco de variáveis de ambiente, depois o diretório de trabalho
quando contiver um `rebase.json`, e então o `default` persistido.

`REBASE_PROJECT_DIR`, `REBASE_BASE_URL` e `REBASE_API_TOKEN` reconstroem o
projeto `default` **a cada inicialização**, não apenas na primeira. A reconstrução é
completa: um token registrado para o `projectDir` antigo é descartado em vez de ser levado
para um diretório para o qual nunca foi emitido. Um `default` derivado dessa
forma — ou do diretório de trabalho — nunca é gravado de volta em
`~/.rebase/projects.json`, evitando que a service key de desenvolvimento de um projeto se torne a
de outro.

O `activeProject` é persistente (sticky), portanto, se uma sessão anterior chamou
`rebase_project_switch`, as ferramentas terão como alvo esse projeto e o servidor avisará isso no
stderr — a menos que esse projeto esteja registrado sob um diretório *diferente*
daquele em que este servidor está rodando, caso em que ele volta para o `default` e
emite um aviso. Se um assistente parecer estar lendo o banco de dados errado, chame
`rebase_project_current` primeiro.
:::

Os tokens são armazenados nesse registro **em texto não criptografado (plaintext)**. É um arquivo no diretório home
do seu usuário contendo credenciais de administrador para cada projeto que você registrou; trate-o
com o devido cuidado.

## Rebase Cloud

Oito ferramentas levam uma aplicação deste diretório a um backend ativo no
[Rebase Cloud](/docs/deployment/cloud/) e o mantêm funcionando. Cada uma executa
`rebase cloud <command> --json` no diretório do projeto ativo: o mesmo
comando que uma pessoa executa, garantindo que não haja uma segunda implementação divergente.

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

O fluxo habitual do agente é: `rebase_cloud_provision`, em seguida fornecer a URL de
reivindicação (claim URL) ao usuário; `rebase_cloud_status` para visualizar o projeto (enquanto não reivindicado,
`unclaimed` contém a URL de reivindicação e quando ele será excluído); `rebase_cloud_deploy`
após uma alteração; `rebase_cloud_logs` quando algo se comportar de forma inesperada; e
`rebase_cloud_rollback` quando a produção apresentar problemas.

**Sobre o que elas atuam.** O projeto ao qual o diretório ativo está vinculado em
`.rebase/cloud.json`. Nenhuma delas recebe um ID de projeto ou um diretório, portanto um
assistente não pode apontá-las para outro projeto além daquele ao qual o diretório está
vinculado. Alternar o projeto ativo com `rebase_project_switch` altera o
diretório no qual elas são executadas.

**Sob qual autoridade.** Qualquer credencial que a CLI resolver naquele diretório: `REBASE_TOKEN`
quando estiver definido, depois o token que `rebase cloud init --claim` armazenou para um
projeto não reivindicado, e por fim a sessão do `rebase cloud login`. No diretório desse
projeto não reivindicado, um `REBASE_TOKEN` que não tenha escopo sobre o projeto é deixado
de lado em favor do próprio token do projeto. O plano de controle
verifica cada chamada da mesma forma que verifica as da CLI, portanto, com um token criado por
`rebase cloud tokens create --can logs`, um assistente pode ler logs, e o
plano de controle recusará seus deploys, variáveis e rollbacks. A ausência de credencial, ou uma credencial recusada, retorna como um erro indicando o que o
usuário precisa fazer (`rebase cloud login` ou reivindicar o projeto).

**Por que a barreira de loopback não se aplica.** A barreira verifica a `baseUrl` da aplicação e
a `DATABASE_URL` da CLI; essas ferramentas não usam nenhuma delas. Após `rebase_cloud_provision`,
o `REBASE_BASE_URL` aponta para o novo projeto em nuvem, de modo que bloqueá-lo recusaria
o próprio deploy necessário ao fluxo. O provisionamento em si apenas cria: não toca
em nenhuma aplicação ou banco de dados existente, e a CLI ainda o recusa em um diretório que
já esteja vinculado. Um deploy, uma variável e um rollback alteram
a produção. O que está diante deles é a credencial mencionada acima, a aprovação de ferramentas
do seu cliente MCP e `confirm: true`: `rebase_cloud_deploy` para produção, `rebase_cloud_env_set`
em produção, `rebase_cloud_rollback` e `rebase_cloud_provision` respondem o que fariam e
não executam nada até que uma chamada repita os mesmos argumentos com `confirm: true`, o qual o assistente
envia somente após o consentimento do usuário. Um deploy de preview e uma variável de preview não precisam disso. Para impedir que um assistente altere um projeto
na nuvem, defina `REBASE_TOKEN` no ambiente do servidor com um token sem as
permissões `deploy` e `env`.

**Lendo qualquer um dos seus projetos.** As ferramentas acima atuam no projeto vinculado.
Para ler os dados de outro — qualquer projeto em qualquer organização à qual a
conta conectada pertença, vinculado aqui ou não —, `rebase_cloud_projects_list` lista-os
e `rebase_project_use_cloud` (com um id, slug ou nome) aponta as ferramentas de dados e
administração para ele: `query_table`, `get_row`, `list_users`, `list_roles`,
`cron_list_jobs`, `storage_list_objects`. Essas chamadas passam pelo proxy Studio do console,
utilizando a própria credencial da CLI (`rebase cloud access-token`, lida
a cada chamada e nunca armazenada); o plano de controle verifica o acesso da pessoa e
anexa a chave de serviço do projeto do seu lado, de modo que nenhuma chave chega à máquina.
Um projeto com o Studio desativado é recusado, e a mensagem indica isso. É um
destino remoto como qualquer outro, portanto as ferramentas que alteram dados permanecem recusadas lá,
a menos que `REBASE_MCP_ALLOW_REMOTE_WRITES` esteja definido; `rebase_project_switch` retorna ao anterior.

Cada ferramenta funciona como um snapshot:

- `rebase_cloud_logs` nunca faz streaming contínuo (follow). Seu resultado traz `nextSinceTime`; passe-o
  de volta como `since` para ler o que veio depois. Ele retorna as últimas 200 linhas, a menos que
  `tail` especifique outro valor. `source: "build"` retorna o log de build mais recente.
- `rebase_cloud_deploy` acompanha o deployment até o final e verifica se a nova
  versão responde. `wait: false` retorna assim que o deployment é acionado.
  Ele nunca ejeta um projeto do runtime gerenciado, faz deploy de uma versão anterior do framework
  nem pula as verificações de build: essas são decisões do usuário, e uma
  recusa informará caso uma delas seja necessária.
- `rebase_cloud_rollback` passa `--yes` assim que a chamada incluir `confirm: true`
  (abaixo), já que não há terminal para solicitar confirmação.

`rebase_cloud_env_set` grava o valor na entrada padrão (stdin) da CLI, portanto ele
nunca aparece em uma linha de comando onde `ps` o mostraria, e o valor é omitido de
qualquer retorno da ferramenta. Seu resultado informa o que foi armazenado (a chave, se é
secreta, se há um redeploy pendente), nunca o valor. `rebase_cloud_env_list`
lista apenas chaves. Uma CLI anterior a `env set --stdin` é recusada com uma mensagem solicitando
a atualização; o valor não é enviado por outro método.

Os resultados retornam no [envelope de dados não confiáveis](#marcação-de-dados-não-confiáveis),
precedidos por uma linha do servidor sobre o que fazer a seguir. Uma recusa é um erro de ferramenta
que traz o código da CLI, como `no_project`, `token_rejected`,
`managed_project` ou `deploy_failed`. Quando o servidor reconhece o código, ele
adiciona o próximo passo, seguido pela mensagem da própria CLI. Cada ferramenta valida seus argumentos
contra o schema que divulga antes de iniciar qualquer processo e recusa
argumentos que não tenham sido declarados.

## Referência de ferramentas

53 ferramentas, em dez grupos: schema e banco de dados, planejamento de schema, documentos, usuários
e papéis, storage, cron, funções, servidor de desenvolvimento, registro de projetos e
Rebase Cloud.
Cada uma, com o que precisa e se a barreira a recusa contra um destino não local,
está na [referência de ferramentas MCP](/docs/ai/mcp-tool-reference).

## Recursos

Além das ferramentas, o servidor expõe recursos MCP para que o cliente possa puxar
o contexto do projeto sem gastar uma chamada de ferramenta:

| URI | Descrição |
|---|---|
| `rebase://tables/{name}` | Código-fonte TypeScript da definição de uma tabela (`defineTable`) |
| `rebase://schema` | O schema do Drizzle gerado (`schema.generated.ts`) |

Os arquivos de tabela são os módulos do diretório de schema, exceto pelo seu `index.ts`: a
chave `tables` da aplicação backend em `rebase.json`, `backend/schema` por padrão,
sob o diretório do projeto ativo ou seu `app/`.

`rebase://schema` é listado **somente se** o schema gerado existir.
`findBackendDir` procura por `backend/` e depois `app/backend/` sob o diretório do
projeto ativo, e lê `src/schema.generated.ts` do que encontrar primeiro —
assim, tanto o layout inicial quanto o deste monorepo funcionam, e um projeto estruturado de
uma terceira forma, ou um que ainda não executou `rebase schema generate`, simplesmente não
verá o recurso disponível.

## O endpoint remoto

Um backend implantado também pode servir o próprio MCP, em `/mcp`, para as pessoas que utilizam
sua aplicação, conectando-se individualmente sob suas próprias políticas de segurança
em nível de linha (RLS). Isso tem sua própria página:
[O Endpoint MCP Remoto](/docs/ai/remote-mcp/).

## Configuração recomendada

- Aponte o servidor para um projeto **local** e deixe `REBASE_MCP_ALLOW_REMOTE_WRITES`
  indefinido. A barreira é o recurso mais valioso do pacote.
- Para qualquer ambiente remoto, registre uma **chave de API `rk_` com escopo restrito** em vez de deixar
  a descoberta automática entregar uma chave de serviço.
- Verifique `rebase_project_current` quando a saída parecer incorreta. O projeto ativo é
  persistente (sticky) e reside fora do seu repositório.
- Trate `~/.rebase/projects.json` como um arquivo de segredos.
