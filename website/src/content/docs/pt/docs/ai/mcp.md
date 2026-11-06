---
sourceHash: 6454e7e328fb09e6
title: Servidor MCP
sidebar_label: Servidor MCP
description: Conecte o Claude Code, Cursor, Gemini CLI ou qualquer cliente MCP a um projeto Rebase — as 53 ferramentas que ele expõe, a credencial com a qual ele se autentica e o loopback gate que fica entre um agente e a produção.
---

O `@rebasepro/mcp` é um servidor do [Model Context Protocol](https://modelcontextprotocol.io)
que entrega a um assistente de IA ferramentas reais sobre um projeto Rebase: ler e
escrever linhas, gerenciar usuários, executar migrações, invocar funções, controlar o
servidor de desenvolvimento.

Ele se comunica via MCP **apenas por stdio**. Não há porta nem listener — o
processo é exatamente tão confiável quanto o que o inicializou, e não há um
chamador remoto para autenticar. Essa é a parte segura. As perguntas interessantes dizem
respeito ao que ele faz *depois* de estar em execução, e esta página responde a elas antes
de mostrar o bloco de configuração.

Um backend implantado também pode servir o MCP por conta própria, via HTTP, para as pessoas que usam
sua aplicação. Isso é algo diferente com um modelo de credenciais diferente:
consulte [O Endpoint MCP Remoto](/docs/ai/remote-mcp/).

:::tip[Usando o Claude na web, desktop ou mobile?]
Em vez disso, adicione o [conector Rebase](/docs/ai/rebase-connector/):
`https://app.rebase.pro/mcp`, uma vez, para cada projeto executado no Rebase Cloud
ou nos seus próprios servidores. Esta página aborda o servidor local que um assistente de código inicia
dentro de um projeto.
:::

## Conectando um cliente

O servidor é executado a partir do seu projeto: `@rebasepro/mcp` é uma devDependency que todo
scaffold do `rebase init` fixa com a CLI, e cada bloco abaixo — toda a
integração — inicia essa cópia (`pnpm exec rebase-mcp`, ou `npx --no rebase-mcp`
em um projeto npm), nunca uma versão mais nova do npm. Um projeto mais antigo adiciona-o uma vez,
com `rebase skills install --mcp` ou `pnpm add -D @rebasepro/mcp`.

O `rebase init` escreve o bloco para cada agente que você escolher quando ele
[configura seus agentes de código de IA](/docs/ai/skills#set-up-by-rebase-init), mantendo
quaisquer outros servidores já presentes no arquivo. `rebase init --agent cursor,codex` faz
o mesmo sem perguntar.

**Claude Code** — `.mcp.json` na raiz do seu projeto. O `rebase init` cria este
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

**Cursor** — a mesma estrutura, em `.cursor/mcp.json`. O Cursor expande
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
O Codex lê a configuração de um projeto somente após você confiar no projeto:

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

O **Windsurf** lê servidores MCP apenas a partir de sua configuração em nível de usuário, portanto não há
arquivo de projeto a ser escrito. Adicione o servidor nas configurações do MCP como `"command": "pnpm"`,
`"args": ["--dir", "/caminho/absoluto/para/seu/projeto", "exec", "rebase-mcp"]`, com esse caminho como `REBASE_PROJECT_DIR`.

Qualquer cliente MCP capaz de iniciar um servidor stdio funciona; a estrutura é a mesma.

### Em qual diretório ele atua

`REBASE_PROJECT_DIR` é o diretório que contém `rebase.json`. Existe **uma**
precedência, e ela é a mesma em todos os clientes:

1. **O bloco de variáveis de ambiente** — `REBASE_PROJECT_DIR`, `REBASE_BASE_URL`,
   `REBASE_API_TOKEN`. Se algum deles estiver definido, o projeto `default` é reconstruído
   a partir deles a cada inicialização.
2. **O diretório de trabalho do servidor**, quando ele contém um `rebase.json`. Um projeto
   no qual você está localizado tem precedência sobre qualquer item lembrado em `~/.rebase/projects.json`.
3. **O `default` persistido** em `~/.rebase/projects.json`, quando nenhum dos
   dois primeiros especifica algo.

A descoberta automática a partir de `.rebase/state.json` preenche lacunas nos três casos e nunca
sobrescreve um valor fornecido por um deles.

Os blocos no nível do projeto apontam para o projeto — `"."`, o diretório de trabalho do cliente
ou o `${workspaceFolder}` do editor — porque a regra 3 lê um arquivo
compartilhado por todos os projetos na máquina. Uma configuração no nível de usuário, como a do Windsurf,
especifica um caminho absoluto em seu lugar.

## O que o servidor pode alcançar

Esta é a seção a ser lida antes de apontar um assistente para um banco de dados com o qual você se preocupa.

O servidor carrega **uma credencial de ambiente para todo o processo**. Não há
identidade por ferramenta nem modo somente leitura; todas as ferramentas usam o mesmo token, e a
única opção no pacote serve para *incluir* mais alcance, e não menos.

Qual credencial é essa, em ordem de prioridade:

1. `REBASE_API_TOKEN` do ambiente. `REBASE_TOKEN` não é lido aqui:
   ele é o token do plano de controle da CLI e nunca é enviado para a aplicação (o
   servidor avisa isso uma vez no stderr quando ele é o único definido). As ferramentas de nuvem
   ainda o repassam para a CLI que elas inicializam, que o envia para o plano de controle.
2. `REBASE_SERVICE_KEY` lido do arquivo `.env` do projeto
3. A service key descoberta automaticamente a partir de `.rebase/state.json` enquanto o `rebase dev`
   estiver em execução

2 e 3 correspondem à chave do backend de desenvolvimento desta máquina, usada apenas quando o destino está em
loopback. Quando `REBASE_BASE_URL` aponta para outro lugar — `rebase cloud init --claim`
grava o endereço do projeto em nuvem e nenhum `REBASE_API_TOKEN` até que um deploy
seja bem-sucedido — o servidor não envia nenhum token e avisa isso uma vez no stderr.

Um token registrado por você para um projeto **tem precedência sobre a descoberta automática**. A descoberta
apenas preenche uma lacuna.

:::danger[O caminho zero-config é uma credencial de administrador]
As opções 2 e 3 representam a **service key** — um segredo de administrador sem escopo restrito. O backend
a resolve para `uid: "service"`, `roles: ["admin"]`, `isAdmin: true`. Essa
identidade possui todos os [escopos](/docs/backend/roles-and-scopes/), e atende às
políticas `_default_admin_read` / `_default_admin_write` que o Rebase injeta em
cada coleção que não definiu `disableDefaultPolicies`.

Portanto, a resposta sincera para "o RLS ainda impõe restrições?" é: o RLS *é executado* — o
driver faz downgrade para a role `rebase_user` — e então uma política escrita pelo próprio
Rebase concede tudo a essa identidade. Ler todas as linhas de cada
coleção é o **comportamento projetado da configuração padrão**, não uma
falha de segurança.

Com a configuração zero-config, um agente de posse dessas ferramentas pode ler e escrever em todas as
linhas de todas as coleções, listar todos os usuários, redefinir qualquer senha, invocar qualquer função
do backend e executar DDL contra qualquer `DATABASE_URL` que o projeto resolva.
:::

### Fornecendo uma credencial restrita em vez disso

Registre uma [chave de API](/docs/backend/api-keys) com escopo definido e o modelo de duas barreiras
se aplicará de verdade. Uma chave de serviço é executada com as roles `["service"]`, as quais as
políticas padrão de admin injetadas **não** mencionam — portanto, o RLS não concede nada a ela, a menos que uma
das suas próprias políticas declare o contrário, e seus escopos a restringem ainda mais:

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

Duas coisas que isso **não** faz, ambas importantes de saber antes de você confiar nisso:

- **Não restringe as ferramentas da CLI.** `rebase_db_push`, `rebase_db_migrate`,
  `rebase_doctor` e as ferramentas de branches inicializam a CLI do Rebase, que se conecta com
  `DATABASE_URL` e nunca chega a ver o seu token. O loopback gate abaixo é a
  única proteção à frente delas.
- **Uma chave acessa uma ferramenta de administração somente com o escopo correspondente.** `list_users` e
  `list_roles` precisam de `users:read`; `create_user`, `update_user`, `delete_user` e
  `rebase_auth_reset_password` precisam de `users:write`; as ferramentas de storage e cron
  precisam do escopo correspondente `storage:*` ou `cron:*`; `invoke_function` precisa de
  `functions:invoke`. Sem
  ele, a chamada responde `403 SCOPE_MISSING`. Mesmo com `users:write`, uma chave não pode
  alterar a conta de um administrador: um admin possui `keys:read` e `keys:write`, o que nenhuma
  chave pode ter, e ninguém pode gerenciar uma conta que possui mais privilégios do que si próprio.

Uma chave criada com `--roles admin` é outro caso: ela carrega as roles
`["service", "admin"]`, o que satisfaz as mesmas políticas padrão de admin atendidas pela chave
de serviço. Conceda a ela também `--full-access` e seu alcance será o da chave de serviço,
exceto pelo gerenciamento de chaves. O benefício adicional é que ela é **revogável, expira e
tem rate limit por chave**, nada disso sendo verdadeiro para a service key — rotacionar
esta última significa editar o `.env` e reiniciar o servidor.

Consulte [Agentes e Servidores MCP](/docs/backend/api-keys#agents-and-mcp-servers) para obter as
orientações completas sobre escopos de chaves.

### Colocando uma coleção totalmente fora de alcance

A razão pela qual uma credencial de admin lê tudo é a política de base que o Rebase
injeta em cada coleção, concedendo acesso ao contexto do servidor confiável e à
role `admin`. Uma coleção pode desativar essa base e assumir total
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
string literal `service`, portanto uma regra de proprietário (owner) nunca corresponderá a ele — as leituras retornam zero
linhas e as gravações são rejeitadas pelo Postgres. Este é o único controle que restringe
a credencial padrão do servidor MCP em vez de ignorá-la.

Lembre-se de que esta é uma alteração real de RLS, não documental: ela entra em vigor
apenas depois que o `rebase schema generate` e uma migração aplicarem as políticas. Consulte
[Regras de Segurança (RLS)](/docs/collections/security-rules).

## O loopback gate

`rebase_project_add` aceita qualquer `baseUrl`, e as ferramentas da CLI se conectam com
qualquer `DATABASE_URL` que o projeto declarar. A mesma lista de ferramentas que edita um
banco de dados temporário no seu laptop pode, portanto, apagar linhas de produção, sem nada
no meio a não ser o julgamento do assistente sobre qual projeto está ativo.

**Toda ferramenta que altera o ambiente de destino é recusada, a menos que esse destino esteja
na interface de loopback.** O gate foi escrito como uma lista do que *não*
é bloqueado, de modo que uma ferramenta adicionada posteriormente chegue protegida por padrão.

- **Não bloqueadas — leituras:** `rebase_schema_plan`, `rebase_doctor`,
  `rebase_db_branch_list`, `rebase_db_branch_info`, `rebase_db_branch_diff`, `list_documents`,
  `get_document`, `list_users`, `list_roles`, `storage_list_objects`,
  `storage_get_download_url`, `cron_list_jobs`, `cron_get_job`, `cron_get_job_logs`,
  `rebase_dev_logs`, e as leituras do Rebase Cloud `rebase_cloud_status`,
  `rebase_cloud_logs`, `rebase_cloud_env_list`, `rebase_cloud_deployments_list`.
- **Não bloqueadas — escritas do Rebase Cloud:** `rebase_cloud_provision`,
  `rebase_cloud_deploy`, `rebase_cloud_env_set`, `rebase_cloud_rollback`.
  O provisionamento cria um projeto; os outros alteram um projeto em produção. Nenhum
  deles passa por `baseUrl` ou `DATABASE_URL`, que são os únicos dados que o gate consegue
  verificar. Consulte [Rebase Cloud](#rebase-cloud) para ver o que fica à frente deles.
- **Não bloqueadas — apenas locais:** `rebase_schema_introspect`, `rebase_db_branch_switch`, `rebase_schema_generate`, `rebase_db_generate`,
  `rebase_generate_sdk`, as ferramentas do dev-server e as ferramentas de registro de projetos.
  Estas gravam arquivos locais ou estado local e não possuem alvo remoto para verificar.
- **Bloqueadas contra `DATABASE_URL`:** as ferramentas restantes da CLI — `rebase_db_push`,
  `rebase_db_migrate`, `rebase_db_branch_create`, `rebase_db_branch_delete`.
- **Bloqueadas contra a `baseUrl` do projeto:** as ferramentas restantes do SDK —
  `create_document`, `update_document`, `delete_document`, `create_user`,
  `update_user`, `delete_user`, `rebase_auth_reset_password`,
  `storage_delete_object`, `cron_trigger_job`, `cron_toggle_job`,
  e `invoke_function`.

Os dois destinos não são intercambiáveis. As ferramentas da CLI nunca veem o `baseUrl`, portanto um
backend em localhost ao lado de uma `DATABASE_URL` de produção é verificado contra
o banco de dados, não contra o backend.

Uma recusa se parece com isto:

```text
Error: Refusing to run "delete_document": project "default" points at
https://api.example.com/, which is not local. Set REBASE_MCP_ALLOW_REMOTE_WRITES=true
to allow destructive tools against remote environments.
```

**Se nenhuma string de conexão puder ser resolvida, as ferramentas de banco de dados bloqueadas são recusadas.**
Sem `DATABASE_URL`, a CLI usa o banco de dados de desenvolvimento gerenciado, que é
o padrão para um novo projeto, e o gate recusa suas quatro ferramentas de banco de dados
lá. A recusa informa o motivo e cita o que funciona como alternativa. Ela não sugere
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
ferramentas MCP são recusadas. Na versão 0.24, a CLI as recusa lá também.

Apenas loopback conta como local: `localhost`, `*.localhost`, `127.0.0.0/8`, `::1`
(e `0.0.0.0`).
Faixas privadas como `10.x` e `192.168.x` **não** contam — elas têm a mesma probabilidade de ser
um cluster de staging compartilhado ou um laptop, e tratá-las como locais liberaria
exatamente o tipo de acidente que o gate foi criado para impedir.

Defina `REBASE_MCP_ALLOW_REMOTE_WRITES=true` para desativar essa proteção. Defini-la globalmente na sua
configuração de cliente MCP remove o gate para todos os projetos que o servidor pode alcançar, não
apenas aquele em que você estava pensando.

## Marcação de dados não confiáveis

Linhas, registros de usuários, listagens de storage, jobs de cron, respostas de funções e saídas
da CLI retornam envolvidos em um envelope explícito:

```text
<<<UNTRUSTED_DATA source="list_documents" id="9b2f4c1e-…">>>
[ … rows … ]
<<<END_UNTRUSTED_DATA id="9b2f4c1e-…">>>
```

Qualquer coisa armazenada no seu banco de dados foi escrita por alguém e chega
pelo mesmo canal do contrato de ferramentas que o assistente está seguindo. O envelope orienta
o modelo a tratá-la como conteúdo inerte, em vez de instruções.

O `id` é gerado novamente para cada resposta, após os dados terem sido escritos, e
apenas o marcador final que contém esse id encerra o bloco. Textos dentro dos dados que
tenham formato semelhante a um marcador são intercalados com um espaço de largura zero (zero-width space), de modo que uma linha que
imprima `<<<END_UNTRUSTED_DATA>>>` não possa fechar o envelope precocemente e deixar o que vem em seguida
de fora.

O [endpoint remoto](/docs/ai/remote-mcp/) isola os resultados de suas ferramentas da mesma
forma e informa isso ao cliente; seu `structuredContent` carrega o resultado simples.
`list_collections` e
`describe_collection` são as exceções: apenas um modelo as lê, então elas são
enviadas uma vez, no texto. Antes da versão 0.24, a listagem carregava uma cópia em
`structuredContent` também.

Trata-se de um marcador, não de um sandbox. Um assistente que tem acesso a essas ferramentas é tão seguro
quanto o conteúdo que você permite que ele leia.

## Múltiplos projetos

As configurações dos projetos são armazenadas em `~/.rebase/projects.json`, e o servidor
pode conter vários de uma só vez — útil quando você trabalha em ambientes
locais e remotos. Enquanto o `rebase dev` estiver em execução, o servidor lê a porta ativa e
a service key de `.rebase/state.json` no diretório do projeto, o que
torna o caso local zero-config.

:::note[O registro é a última palavra, não a primeira]
A precedência é a citada acima: bloco de variáveis de ambiente, depois o diretório de trabalho
quando contém um `rebase.json`, depois o `default` persistido.

`REBASE_PROJECT_DIR`, `REBASE_BASE_URL` e `REBASE_API_TOKEN` reconstroem o
projeto `default` **a cada inicialização**, e não apenas na primeira. A reconstrução é
de entrada completa: um token registrado para o antigo `projectDir` é descartado em vez
de ser levado para um diretório para o qual nunca foi emitido. Um `default` derivado dessa
forma — ou do diretório de trabalho — nunca é gravado de volta em
`~/.rebase/projects.json`, garantindo que a service key de desenvolvimento de um projeto não se torne
a de outro.

O `activeProject` é persistente (sticky), então se uma sessão anterior chamou
`rebase_project_switch`, as ferramentas terão como alvo esse projeto e o servidor avisará isso no
stderr — a menos que esse projeto esteja registrado em um diretório *diferente*
daquele em que este servidor está sendo executado, caso em que ele volta para o `default` e avisa
sobre isso. Se um assistente parecer estar lendo o banco de dados errado, chame
`rebase_project_current` primeiro.
:::

Os tokens são armazenados nesse registro **em texto simples (plaintext)**. É um arquivo no seu diretório
pessoal (home) que contém credenciais de administrador para todos os projetos que você registrou; trate-o
de acordo.

## Rebase Cloud

Oito ferramentas levam uma aplicação deste diretório para um backend em produção no
[Rebase Cloud](/docs/deployment/cloud/) e o mantêm em funcionamento. Cada uma inicializa
`rebase cloud <command> --json` no diretório do projeto ativo: o mesmo
comando executado por uma pessoa, de modo que não há uma segunda implementação sujeita a divergências.

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

A jornada habitual de um agente é: `rebase_cloud_provision`, em seguida fornecer ao usuário a
URL de reivindicação (claim URL); `rebase_cloud_status` para visualizar o projeto (enquanto não reivindicado,
`unclaimed` traz a URL de reivindicação e a data de exclusão); `rebase_cloud_deploy`
após uma alteração; `rebase_cloud_logs` quando algo se comportar de forma incorreta; e
`rebase_cloud_rollback` quando a produção estiver com problemas.

**Onde elas atuam.** No projeto ao qual o diretório ativo está vinculado em
`.rebase/cloud.json`. Nenhuma delas aceita um id de projeto ou um diretório, portanto um
assistente não pode apontá-las para outro projeto além daquele ao qual o diretório está
vinculado. Alternar o projeto ativo com `rebase_project_switch` alterna
o diretório no qual elas são executadas.

**Sob qual autoridade.** Qualquer que seja a autoridade que a CLI resolver naquele diretório: `REBASE_TOKEN`
quando estiver definido, depois o token que o `rebase cloud init --claim` armazenou para um
projeto não reivindicado, depois a sessão de `rebase cloud login`. No diretório desse projeto
não reivindicado, um `REBASE_TOKEN` que não possui escopo no projeto é deixado de lado
em favor do token do próprio projeto. O plano de controle
verifica cada chamada assim como verifica as da CLI; portanto, com um token criado por
`rebase cloud tokens create --can logs`, um assistente pode ler logs, e o
plano de controle recusa seus deploys, variáveis e rollbacks. A ausência de credencial, ou uma credencial recusada, retorna como um erro que explica o que o
usuário deve fazer (`rebase cloud login`, ou reivindicar o projeto).

**Por que o loopback gate não se aplica.** O gate verifica a `baseUrl` da aplicação e a
`DATABASE_URL` da CLI; essas ferramentas não usam nenhuma das duas. Após `rebase_cloud_provision`,
`REBASE_BASE_URL` aponta para o novo projeto em nuvem, então bloqueá-lo recusaria
o próprio deploy de que a jornada necessita. O provisionamento em si apenas cria: ele não altera
nenhuma aplicação ou banco de dados existente, e a CLI ainda o recusa em um diretório que
já esteja vinculado. Um deploy, uma variável e um rollback alteram,
cada um, o ambiente de produção. O que atua como barreira diante deles é a credencial mencionada acima e
a aprovação de ferramentas do seu cliente MCP. Para impedir que um assistente altere um projeto
na nuvem, defina `REBASE_TOKEN` no ambiente do servidor com um token sem as
capacidades de `deploy` e `env`.

**Lendo qualquer um dos seus projetos.** As ferramentas acima atuam no projeto vinculado.
Para ler dados de outro — qualquer projeto em qualquer organização à qual a conta conectada
pertença, vinculado aqui ou não —, `rebase_cloud_projects_list` lista-os
e `rebase_project_use_cloud` (com um id, slug ou nome) aponta as ferramentas de dados e
administração para ele: `list_documents`, `get_document`, `list_users`, `list_roles`,
`cron_list_jobs`, `storage_list_objects`. Essas chamadas passam pelo proxy do Studio
no console, portando a própria credencial da CLI (`rebase cloud access-token`, lido
a cada chamada e nunca armazenado); o plano de controle valida o acesso do usuário e
anexa a service key do projeto do seu lado, de forma que nenhuma chave chegue à máquina.
Um projeto com o Studio desativado é recusado, e a mensagem informa isso. Trata-se de um
destino remoto como qualquer outro, de modo que ferramentas que alteram dados continuam recusadas nele,
a menos que `REBASE_MCP_ALLOW_REMOTE_WRITES` esteja definido; `rebase_project_switch` retorna
ao anterior.

Cada ferramenta funciona como um snapshot:

- `rebase_cloud_logs` nunca faz streaming contínuo (follow). Seu resultado traz `nextSinceTime`; passe-o
  de volta como `since` para ler o que veio depois. Ele retorna as últimas 200 linhas, a menos que
  `tail` determine o contrário. `source: "build"` retorna o log da compilação mais recente.
- `rebase_cloud_deploy` acompanha o deploy até o fim e verifica se a nova
  versão responde. `wait: false` retorna assim que o deploy é disparado.
  Ele nunca ejeta um projeto do runtime gerenciado, não implanta uma versão mais antiga do framework
  nem pula as verificações de compilação: essas são decisões do usuário, e uma
  recusa que demande uma decisão avisa sobre isso.
- `rebase_cloud_rollback` passa `--yes`. A chamada da ferramenta serve como confirmação, já
  que não há um terminal para solicitar confirmação.

`rebase_cloud_env_set` grava o valor na entrada padrão (stdin) da CLI, de forma que nunca
fique exposto em uma linha de comando visível pelo comando `ps`, e o valor é ocultado de
qualquer retorno da ferramenta. Seu resultado informa o que foi armazenado (a chave, se
é secreta, se um novo deploy está pendente), nunca o valor. `rebase_cloud_env_list`
lista apenas as chaves. Uma CLI anterior a `env set --stdin` é recusada com uma mensagem para
atualizá-la; o valor não é enviado por outra via.

Os resultados retornam no [envelope de dados não confiáveis](#marcação-de-dados-não-confiáveis),
após uma linha do servidor explicando o que fazer a seguir. Uma recusa é um erro de ferramenta
que carrega o código da CLI, como `no_project`, `token_rejected`,
`managed_project` ou `deploy_failed`. Quando o servidor reconhece o código, ele
adiciona a próxima etapa, seguida pela mensagem da própria CLI. Cada ferramenta valida seus argumentos
contra o schema que anuncia antes que qualquer processo seja criado, e recusa qualquer
argumento que ela não declare.

## Referência de ferramentas

São 53 ferramentas, divididas em dez grupos: schema e banco de dados, planejamento de schema, documentos, usuários
e roles, storage, cron, funções, servidor de desenvolvimento, registro de projetos e
Rebase Cloud.
Cada uma delas, acompanhada do que necessita e se o gate a recusa contra um alvo
não local, está na [Referência de ferramentas MCP](/docs/ai/mcp-tool-reference).

## Recursos

Além de ferramentas, o servidor expõe recursos MCP para que o cliente possa carregar o contexto
do projeto sem gastar uma chamada de ferramenta:

| URI | Descrição |
|---|---|
| `rebase://collections/{name}` | Código-fonte em TypeScript da definição de uma collection |
| `rebase://schema` | O schema Drizzle gerado (`schema.generated.ts`) |

As collections são descobertas a partir de `app/config/collections/`,
`config/collections/` ou `collections/` sob o diretório do projeto ativo —
o que existir.

`rebase://schema` é listado **somente se** o schema gerado existir.
`findBackendDir` procura por `backend/` e depois por `app/backend/` sob o diretório
do projeto ativo, e lê `src/schema.generated.ts` do que encontrar —
de modo que tanto o layout padrão quanto o deste monorepo funcionam, enquanto um projeto estruturado de
uma terceira forma, ou um que ainda não executou `rebase schema generate`, simplesmente não
verá o recurso disponível.

## O endpoint remoto

Um backend implantado também pode servir o próprio MCP, em `/mcp`, para as pessoas que utilizam
sua aplicação, cada qual se conectando com sua própria identidade sob seu respectivo Row-Level
Security. Isso tem uma página dedicada:
[O Endpoint MCP Remoto](/docs/ai/remote-mcp/).

## Configuração recomendada

- Aponte o servidor para um projeto **local** e deixe `REBASE_MCP_ALLOW_REMOTE_WRITES`
  indefinido. O gate é o recurso mais valioso deste pacote.
- Para qualquer ambiente remoto, registre uma **chave de API `rk_` com escopo definido** em vez de deixar
  a descoberta atribuir uma service key.
- Verifique `rebase_project_current` quando a saída parecer estranha. O projeto ativo é
  persistente e reside fora do seu repositório.
- Trate o `~/.rebase/projects.json` como um arquivo de segredos.
