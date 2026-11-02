---
sourceHash: 59966953b83890cf
title: Servidor MCP
sidebar_label: MCP Server
description: Conecte o Claude Code, Cursor, Gemini CLI ou qualquer cliente MCP a um projeto Rebase — as 53 ferramentas que ele expõe, a credencial com a qual se autentica e a barreira de loopback que fica entre um agente e a produção.
---

`@rebasepro/mcp` é um servidor do [Model Context Protocol](https://modelcontextprotocol.io)
que fornece a um assistente de IA ferramentas reais sobre um projeto Rebase: ler e
gravar linhas, gerenciar usuários, executar migrações, invocar funções e controlar o
servidor de desenvolvimento.

Ele se comunica via MCP **apenas por stdio**. Não há porta nem ouvinte (listener) — o
processo é exatamente tão confiável quanto o que quer que o tenha gerado, e não há um
chamador remoto para autenticar. Essa é a parte segura. As perguntas interessantes dizem
respeito ao que ele faz *depois* de estar em execução, e esta página responde a elas antes
de mostrar o bloco de configuração.

Um backend implantado também pode servir o próprio MCP, via HTTP, para as pessoas que usam
sua aplicação. Isso é algo diferente com um modelo de credenciais diferente:
consulte [O Endpoint MCP Remoto](/docs/ai/remote-mcp/).

## Conectando um cliente

O servidor é executado a partir do seu projeto: `@rebasepro/mcp` é uma devDependency que todo
scaffold do `rebase init` fixa com a CLI, e cada bloco abaixo — a integração completa —
inicia essa cópia (`pnpm exec rebase-mcp`, ou `npx --no rebase-mcp` em um projeto npm),
nunca uma mais recente do npm. Um projeto mais antigo adiciona-o uma vez,
com `rebase skills install --mcp` ou `pnpm add -D @rebasepro/mcp`.

O `rebase init` grava o bloco para cada agente escolhido quando
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

**Codex CLI** — TOML em vez de JSON, no `.codex/config.toml` do projeto.
O Codex lê a configuração do projeto apenas depois que você confiar no projeto:

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

O **Windsurf** lê servidores MCP apenas de sua configuração de nível de usuário, portanto não há
arquivo de projeto para gravar. Adicione o servidor em suas configurações de MCP como `"command": "pnpm"`,
`"args": ["--dir", "/absolute/path/to/your/project", "exec", "rebase-mcp"]`, com esse caminho como `REBASE_PROJECT_DIR`.

Qualquer cliente MCP que possa gerar um servidor stdio funciona; o formato é o mesmo.

### Em qual diretório ele atua

`REBASE_PROJECT_DIR` é o diretório que contém `rebase.json`. Existe **uma**
precedência, e ela é a mesma em todos os clientes:

1. **O bloco de ambiente** — `REBASE_PROJECT_DIR`, `REBASE_BASE_URL`,
   `REBASE_API_TOKEN`. Se qualquer um deles estiver definido, o projeto `default` é reconstruído
   a partir deles a cada inicialização.
2. **O diretório de trabalho do servidor**, quando ele contém um `rebase.json`. Um projeto
   no qual você está posicionado tem precedência sobre qualquer coisa memorizada em `~/.rebase/projects.json`.
3. **O `default` persistido** em `~/.rebase/projects.json`, quando nenhum dos
   dois primeiros especifica nada.

A descoberta automática a partir de `.rebase/state.json` preenche lacunas em todos os três casos e nunca
substitui um valor fornecido por um deles.

Os blocos de nível de projeto nomeiam o projeto — `"."`, o diretório de trabalho do cliente
ou o `${workspaceFolder}` do editor — porque a regra 3 lê um arquivo
compartilhado por todos os projetos na máquina. Uma configuração de nível de usuário, como a do Windsurf,
especifica um caminho absoluto.

## O que o servidor pode alcançar

Esta é a seção a ser lida antes de apontar um assistente para um banco de dados com o qual você se
importa.

O servidor carrega **uma credencial de ambiente para todo o processo**. Não há
identidade por ferramenta e nenhum modo somente leitura; cada ferramenta usa o mesmo token, e a
única chave no pacote serve para *conceder* mais alcance em vez de menos.

Qual credencial é essa, por ordem de prioridade:

1. `REBASE_API_TOKEN` do ambiente. `REBASE_TOKEN` não é lido aqui:
   ele é o token de plano de controle da CLI e nunca é enviado para a aplicação (o
   servidor informa isso uma vez no stderr quando for o único definido). As ferramentas de nuvem
   ainda o passam para a CLI que elas geram, a qual o envia para o plano de controle.
2. `REBASE_SERVICE_KEY` lido do `.env` do projeto.
3. A chave de serviço descoberta automaticamente a partir de `.rebase/state.json` enquanto `rebase dev`
   estiver em execução.

2 e 3 são a chave do backend de desenvolvimento desta máquina, usada apenas quando o destino está em
loopback. Quando `REBASE_BASE_URL` aponta para outro lugar — `rebase cloud init --claim`
grava o endereço do projeto na nuvem, e nenhum `REBASE_API_TOKEN` até que um deploy
seja bem-sucedido — o servidor não envia nenhum token e informa isso uma vez no stderr.

Um token que você registra para um projeto **tem prioridade sobre a descoberta automática**. A descoberta apenas
preenche uma lacuna.

:::danger[O caminho de configuração zero é uma credencial de admin]
As opções 2 e 3 são a **chave de serviço** — um segredo de admin sem escopo. O backend
a resolve para `uid: "service"`, `roles: ["admin"]`, `isAdmin: true`. Essa
identidade detém todos os [escopos](/docs/backend/roles-and-scopes/) e satisfaz as
políticas `_default_admin_read` / `_default_admin_write` que o Rebase injeta em
cada coleção que não tenha definido `disableDefaultPolicies`.

Portanto, a resposta honesta para "o RLS ainda o restringe?" é: o RLS *é executado* — o
driver faz o downgrade para a role `rebase_user` — e então uma política que o próprio Rebase
escreveu concede tudo a essa identidade. A leitura de cada linha de cada
coleção é o **comportamento projetado da configuração padrão**, não um
bypass.

Com a configuração zero, um agente portando essas ferramentas pode ler e gravar todas as
linhas de cada coleção, listar todos os usuários, redefinir qualquer senha, invocar qualquer
função do backend e executar DDL contra qualquer `DATABASE_URL` que o projeto resolver.
:::

### Fornecendo uma credencial restrita em vez disso

Registre uma [chave de API](/docs/backend/api-keys) com escopo e o modelo de duas
barreiras é aplicado de verdade. Uma chave de serviço é executada com as roles `["service"]`, que as
políticas de admin injetadas **não** mencionam — portanto, o RLS não concede nada a ela a menos que uma de
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

Duas coisas que isso **não** faz, ambas úteis de saber antes de confiar nisso:

- **Não restringe as ferramentas da CLI.** `rebase_db_push`, `rebase_db_migrate`,
  `rebase_doctor` e as ferramentas de ramificação geram a CLI do Rebase, que se conecta com
  `DATABASE_URL` e nunca chega a ver o seu token. A barreira de loopback abaixo é a
  única coisa à frente delas.
- **Uma chave acessa uma ferramenta de administração somente com o escopo dessa ferramenta.** `list_users` e
  `list_roles` precisam de `users:read`; `create_user`, `update_user`, `delete_user` e
  `rebase_auth_reset_password` precisam de `users:write`; as ferramentas de armazenamento e cron
  precisam do escopo correspondente `storage:*` ou `cron:*`; `invoke_function` precisa de
  `functions:invoke`. Sem
  ele, a chamada responde `403 SCOPE_MISSING`. Mesmo com `users:write`, uma chave não pode
  alterar a conta de um administrador: um admin detém `keys:read` e `keys:write`, os quais nenhuma
  chave possui, e ninguém pode gerenciar uma conta que detém mais permissões do que si próprio.

Uma chave criada com `--roles admin` é outro caso: ela carrega as roles
`["service", "admin"]`, o que atende às mesmas políticas padrão de admin que a chave de serviço
atende. Conceda a ela `--full-access` também e seu alcance será o da chave de serviço,
exceto pelo gerenciamento de chaves. O que ela adiciona é que é **revogável, expirável e
sujeita a limite de taxa por chave**, nada do qual é verdade para a chave de serviço — rotacionar
isso significa editar o `.env` e reiniciar o servidor.

Consulte [Agentes e Servidores MCP](/docs/backend/api-keys#agents-and-mcp-servers) para obter
as orientações completas sobre escopo de chaves.

### Colocando uma coleção totalmente fora de alcance

A razão pela qual uma credencial de admin lê tudo é a política básica que o Rebase
injeta em cada coleção, concedendo acesso ao contexto de servidor confiável e à
role `admin`. Uma coleção pode recusar essa linha de base e assumir total
responsabilidade por seu próprio RLS:

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

Agora a única maneira de acessar é correspondendo ao `patient_id`. O uid da chave de serviço é a
string literal `service`, portanto uma regra de proprietário nunca corresponde a ela — as leituras retornam zero
linhas e as gravações são rejeitadas pelo Postgres. Esse é o único controle que restringe
a credencial padrão do servidor MCP em vez de ignorá-la.

Lembre-se de que essa é uma alteração real de RLS, não apenas de documentação: ela entra em vigor
somente após o `rebase schema generate` e uma migração terem aplicado as políticas. Consulte
[Regras de Segurança (RLS)](/docs/collections/security-rules).

## A barreira de loopback

`rebase_project_add` aceita qualquer `baseUrl`, e as ferramentas da CLI conectam-se com
qualquer `DATABASE_URL` que o projeto declarar. A mesma lista de ferramentas que edita um
banco de dados de rascunho em seu laptop pode, portanto, excluir linhas de produção, sem nada
no meio além do discernimento do assistente sobre qual projeto está ativo.

**Toda ferramenta que modifica o ambiente de destino é recusada, a menos que esse destino esteja
na interface de loopback.** A barreira é implementada como uma lista do que *não* está
restrito, de modo que uma ferramenta adicionada posteriormente chegue protegida por padrão.

- **Não restritas — leituras:** `rebase_schema_plan`, `rebase_doctor`,
  `rebase_db_branch_list`, `rebase_db_branch_info`, `rebase_db_branch_diff`, `list_documents`,
  `get_document`, `list_users`, `list_roles`, `storage_list_objects`,
  `storage_get_download_url`, `cron_list_jobs`, `cron_get_job`, `cron_get_job_logs`,
  `rebase_dev_logs` e as leituras do Rebase Cloud: `rebase_cloud_status`,
  `rebase_cloud_logs`, `rebase_cloud_env_list`, `rebase_cloud_deployments_list`.
- **Não restritas — gravações do Rebase Cloud:** `rebase_cloud_provision`,
  `rebase_cloud_deploy`, `rebase_cloud_env_set`, `rebase_cloud_rollback`.
  O provisionamento cria um projeto; os outros alteram um projeto de produção. Nenhum
  deles passa por `baseUrl` ou `DATABASE_URL`, que são tudo o que a barreira pode
  verificar. Consulte [Rebase Cloud](#rebase-cloud) para saber o que fica à frente deles.
- **Não restritas — apenas locais:** `rebase_schema_introspect`, `rebase_db_branch_switch`, `rebase_schema_generate`, `rebase_db_generate`,
  `rebase_generate_sdk`, as ferramentas do dev-server e as ferramentas de registro de projetos.
  Elas gravam arquivos locais ou estado local e não têm um destino remoto para verificar.
- **Restritas contra `DATABASE_URL`:** as ferramentas restantes da CLI — `rebase_db_push`,
  `rebase_db_migrate`, `rebase_db_branch_create`, `rebase_db_branch_delete`.
- **Restritas contra o `baseUrl` do projeto:** as ferramentas restantes do SDK —
  `create_document`, `update_document`, `delete_document`, `create_user`,
  `update_user`, `delete_user`, `rebase_auth_reset_password`,
  `storage_delete_object`, `cron_trigger_job`, `cron_toggle_job`
  e `invoke_function`.

Os dois destinos não são intercambiáveis. As ferramentas da CLI nunca veem o `baseUrl`, portanto um
backend em localhost junto a uma `DATABASE_URL` de produção é verificado contra
o banco de dados, não contra o backend.

Uma recusa se parece com isto:

```text
Error: Refusing to run "delete_document": project "default" points at
https://api.example.com/, which is not local. Set REBASE_MCP_ALLOW_REMOTE_WRITES=true
to allow destructive tools against remote environments.
```

**Se nenhuma string de conexão puder ser resolvida, as ferramentas de banco de dados restritas são recusadas.**
Sem `DATABASE_URL`, a CLI usa o banco de dados de desenvolvimento gerenciado, que é
o padrão para um novo projeto, e a barreira recusa suas quatro ferramentas de banco de dados
ali. A recusa informa o motivo e diz o que funciona em vez disso. Ela não sugere
a desativação da proteção:

```text
Error: Refusing to run "rebase_db_push": project "default" sets no DATABASE_URL, so the
CLI would use the managed development database (PGlite, started by `rebase dev`). You
most likely do not need this tool: the dev server applies the collections to that
database at boot, additively. After changing a collection, restart it with
rebase_dev_stop and rebase_dev_start. …
```

A partir de um terminal,
`rebase db push` e `rebase db migrate` são executados nesse banco de dados; apenas as
ferramentas MCP são recusadas. Na versão 0.24, a CLI também as recusa ali.

Apenas loopback conta como local: `localhost`, `*.localhost`, `127.0.0.0/8`, `::1`
(e `0.0.0.0`).
Intervalos privados como `10.x` e `192.168.x` **não** contam — estes têm tanta probabilidade de ser
um cluster de staging compartilhado quanto um laptop, e tratá-los como locais
permitiria exatamente o acidente que a barreira existe para impedir.

Defina `REBASE_MCP_ALLOW_REMOTE_WRITES=true` para desativar a restrição. Defini-lo globalmente na
configuração do seu cliente MCP remove a barreira para todos os projetos que o servidor pode alcançar,
não apenas para aquele em que você estava pensando.

## Marcação de dados não confiáveis

Linhas, registros de usuário, listagens de armazenamento, tarefas cron, respostas de função e saídas
da CLI retornam envolvidos em um envelope explícito:

```text
<<<UNTRUSTED_DATA source="list_documents" id="9b2f4c1e-…">>>
[ … rows … ]
<<<END_UNTRUSTED_DATA id="9b2f4c1e-…">>>
```

Qualquer coisa armazenada no seu banco de dados foi gravada por alguém, e ela chega pelo
mesmo canal que o contrato de ferramentas que o assistente está seguindo. O envelope instrui
o modelo a tratá-la como conteúdo inerte em vez de instruções.

O `id` é gerado novamente para cada resposta, depois que os dados foram gravados, e
somente o marcador final que o contém fecha o bloco. O texto dentro dos dados que se
assemelha a um marcador é quebrado com um espaço de largura zero, para que uma linha que imprima
`<<<END_UNTRUSTED_DATA>>>` não possa fechar o envelope antes da hora e deixar o que vem a seguir
exposto do lado de fora.

O [endpoint remoto](/docs/ai/remote-mcp/) delimita os resultados de suas ferramentas da mesma
maneira e informa isso ao cliente; seu `structuredContent` carrega o resultado simples.
`list_collections` e
`describe_collection` são as exceções: apenas um modelo os lê, portanto são
enviados uma única vez, no texto. Antes da versão 0.24, a listagem também carregava uma cópia em
`structuredContent`.

É um marcador, não uma sandbox. Um assistente com essas ferramentas é tão seguro
quanto o conteúdo que você permite que ele leia.

## Múltiplos projetos

As configurações de projeto são armazenadas em `~/.rebase/projects.json`, e o servidor
pode manter várias ao mesmo tempo — útil quando você trabalha em ambientes locais e
remotos. Enquanto o `rebase dev` estiver em execução, o servidor lê a porta ativa e a
chave de serviço de `.rebase/state.json` no diretório do projeto, o que
torna o caso local sem necessidade de configuração (zero-config).

:::note[O registro é a última palavra, não a primeira]
A precedência é a indicada acima: bloco de ambiente, depois o diretório de trabalho
quando contém um `rebase.json`, e em seguida o `default` persistido.

`REBASE_PROJECT_DIR`, `REBASE_BASE_URL` e `REBASE_API_TOKEN` reconstroem o
projeto `default` **a cada inicialização**, não apenas na primeira. A reconstrução é
da entrada completa: um token registrado para o `projectDir` antigo é descartado em vez de
ser transportado para um diretório para o qual nunca foi emitido. Um `default` derivado
dessa maneira — ou a partir do diretório de trabalho — nunca é regravado em
`~/.rebase/projects.json`, para que a chave de serviço de desenvolvimento de um projeto
não se torne a de outro.

`activeProject` é fixo, portanto se uma sessão anterior chamou
`rebase_project_switch`, as ferramentas terão como alvo esse projeto e o servidor informará isso
no stderr — a menos que esse projeto esteja registrado em um diretório *diferente* daquele
em que este servidor é executado, caso em que ele volta para o `default` e informa
isso. Se um assistente parecer estar lendo o banco de dados errado, chame
`rebase_project_current` primeiro.
:::

Os tokens são armazenados nesse registro **em texto simples**. É um arquivo no seu diretório home
que contém credenciais de administrador para todos os projetos registrados; trate-o
adequadamente.

## Rebase Cloud

Oito ferramentas levam um aplicativo deste diretório até um backend ativo no
[Rebase Cloud](/docs/deployment/cloud/) e o mantêm em funcionamento. Cada uma gera
`rebase cloud <command> --json` no diretório do projeto ativo: o mesmo
comando que uma pessoa executa, portanto não há uma segunda implementação para divergir dele.

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

A jornada comum de um agente é: `rebase_cloud_provision`, depois fornecer ao usuário a
URL de reivindicação; `rebase_cloud_status` para ver o projeto (enquanto não for reivindicado,
`unclaimed` carrega a URL de reivindicação e quando for excluído); `rebase_cloud_deploy`
após uma alteração; `rebase_cloud_logs` quando algo se comportar de forma incorreta; e
`rebase_cloud_rollback` quando a produção estiver com problemas.

**Em que atuam.** No projeto ao qual o diretório ativo está vinculado em
`.rebase/cloud.json`. Nenhuma delas aceita um id de projeto ou um diretório, portanto um
assistente não pode apontá-las para outro projeto além daquele ao qual o diretório está
vinculado. Alternar o projeto ativo com `rebase_project_switch` alterna
o diretório em que elas são executadas.

**Sob a autoridade de quem.** O que quer que a CLI resolva nesse diretório: `REBASE_TOKEN`
quando estiver definido, depois o token que `rebase cloud init --claim` armazenou para um
projeto não reivindicado, e então a sessão do `rebase cloud login`. No diretório desse
projeto não reivindicado, um `REBASE_TOKEN` que não detém escopo no projeto é deixado
de lado em favor do próprio token do projeto. O plano de controle
verifica cada chamada assim como verifica as da CLI; assim, com um token criado por
`rebase cloud tokens create --can logs`, um assistente pode ler logs, e o
plano de controle recusa seus deploys, variáveis e rollbacks. Sem credencial, ou com uma credencial recusada, o retorno é um erro que informa o que o usuário deve fazer (`rebase cloud login`, ou reivindicar o projeto).

**Por que a barreira de loopback não se aplica.** A barreira verifica a `baseUrl` da aplicação e
a `DATABASE_URL` da CLI; essas ferramentas não usam nenhuma das duas. Após `rebase_cloud_provision`,
`REBASE_BASE_URL` aponta para o novo projeto na nuvem, portanto aplicar a barreira sobre ela recusaria
o próprio deploy que a jornada necessita. O provisionamento em si apenas cria: não toca
em nenhuma aplicação ou banco de dados existente, e a CLI ainda o recusa em um diretório que
já esteja vinculado. Um deploy, uma variável e um rollback alteram a produção. O que fica à frente deles é a credencial mencionada acima e a aprovação de ferramentas do seu cliente MCP. Para impedir que um assistente altere um projeto na nuvem, defina `REBASE_TOKEN` no ambiente do servidor com um token sem as permissões de `deploy` e `env`.

**Lendo qualquer um dos seus projetos.** As ferramentas acima atuam no projeto vinculado.
Para ler dados de outro — qualquer projeto em qualquer organização à qual a
conta conectada pertença, vinculado aqui ou não — `rebase_cloud_projects_list` lista-os
e `rebase_project_use_cloud` (com um id, slug ou nome) aponta as ferramentas de dados e
de administração para ele: `list_documents`, `get_document`, `list_users`, `list_roles`,
`cron_list_jobs`, `storage_list_objects`. Essas chamadas passam pelo proxy Studio do console,
portando a credencial da própria CLI (`rebase cloud access-token`, lido
por chamada e nunca armazenado); o plano de controle verifica o acesso da pessoa e
anexa a chave de serviço do projeto do seu lado, de modo que nenhuma chave chega à máquina.
Um projeto com o Studio desativado é recusado, e a mensagem indica isso. Trata-se de um
destino remoto como qualquer outro, portanto as ferramentas que alteram dados permanecem recusadas ali,
a menos que `REBASE_MCP_ALLOW_REMOTE_WRITES` esteja definido; `rebase_project_switch` desfaz a
alteração.

Cada ferramenta fornece um snapshot:

- `rebase_cloud_logs` nunca faz acompanhamento contínuo. Seu resultado traz `nextSinceTime`; passe-o
  de volta como `since` para ler o que veio depois. Ela retorna as últimas 200 linhas, a menos
  que `tail` especifique o contrário. `source: "build"` retorna o log de build mais recente.
- `rebase_cloud_deploy` acompanha o deployment até o final e verifica se a nova
  versão responde. `wait: false` retorna assim que o deployment for acionado.
  Ela nunca ejeta um projeto do runtime gerenciado, não implanta uma versão mais antiga do
  framework nem ignora as verificações de build: essas são decisões do usuário, e uma
  recusa que necessite disso informará.
- `rebase_cloud_rollback` passa `--yes`. A chamada da ferramenta é a confirmação, já
  que não há terminal para solicitar confirmação.

`rebase_cloud_env_set` grava o valor na entrada padrão da CLI, portanto ele
nunca aparece em uma linha de comando onde o `ps` possa exibi-lo, e o valor é removido de
qualquer retorno da ferramenta. O resultado informa o que foi armazenado (a chave, se é
secreta, se um novo deploy está pendente), nunca o valor. `rebase_cloud_env_list`
lista apenas as chaves. Uma CLI mais antiga que `env set --stdin` é recusada com uma mensagem para
atualizá-la; o valor não é enviado de outra forma.

Os resultados retornam no [envelope de dados não confiáveis](#marcação-de-dados-não-confiáveis),
precedidos por uma linha do servidor sobre o que fazer a seguir. Uma recusa é um erro de ferramenta
que traz o código da CLI, como `no_project`, `token_rejected`,
`managed_project` ou `deploy_failed`. Quando o servidor reconhece o código, ele
adiciona a próxima etapa, seguida pela mensagem da própria CLI. Cada ferramenta verifica seus argumentos
contra o schema anunciado antes de qualquer processo ser iniciado, recusando
argumentos que não declare.

## Referência de ferramentas

53 ferramentas, em dez grupos: schema e banco de dados, planejamento de schema, documentos, usuários
e roles, armazenamento, cron, funções, o dev server, o registro de projetos e
Rebase Cloud.
Cada uma delas, com o que exige e se a barreira a recusa contra um destino não local,
está na [Referência de ferramentas MCP](/docs/ai/mcp-tool-reference).

## Recursos

Além de ferramentas, o servidor expõe recursos MCP para que um cliente possa obter o
contexto do projeto sem gastar uma chamada de ferramenta:

| URI | Descrição |
|---|---|
| `rebase://collections/{name}` | Código-fonte TypeScript de uma definição de coleção |
| `rebase://schema` | O schema gerado do Drizzle (`schema.generated.ts`) |

As coleções são descobertas a partir de `app/config/collections/`,
`config/collections/` ou `collections/` sob o diretório do projeto ativo —
o que existir.

`rebase://schema` é listado **apenas se** o schema gerado existir.
`findBackendDir` procura por `backend/` e depois por `app/backend/` sob o diretório do
projeto ativo e lê `src/schema.generated.ts` do que encontrar —
portanto, tanto o layout scaffolded quanto o deste monorepo funcionam, e um projeto estruturado de
uma terceira forma, ou um que ainda não tenha executado `rebase schema generate`, simplesmente não
verá o recurso oferecido.

## O endpoint remoto

Um backend implantado também pode servir o próprio MCP, em `/mcp`, para as pessoas que usam
sua aplicação, conectando-se cada uma como si mesma sob sua própria segurança
em nível de linha. Isso tem sua própria página:
[O Endpoint MCP Remoto](/docs/ai/remote-mcp/).

## Configuração recomendada

- Aponte o servidor para um projeto **local** e deixe `REBASE_MCP_ALLOW_REMOTE_WRITES`
  não definido. A barreira é a coisa mais valiosa do pacote.
- Para qualquer ambiente remoto, registre uma **chave de API `rk_` com escopo** em vez de deixar
  a descoberta automática entregar uma chave de serviço.
- Verifique `rebase_project_current` quando a saída parecer incorreta. O projeto ativo é
  fixo e reside fora do seu repositório.
- Trate `~/.rebase/projects.json` como um arquivo de segredos.
