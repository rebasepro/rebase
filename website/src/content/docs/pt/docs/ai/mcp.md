---
sourceHash: b20067fcabaf42ec
title: Servidor MCP
sidebar_label: Servidor MCP
description: Conecte o Claude Code, Cursor, Gemini CLI ou qualquer cliente MCP a um projeto Rebase — as 51 ferramentas que ele expõe, a credencial com a qual se autentica e o gate de loopback que fica entre um agente e a produção.
---

O `@rebasepro/mcp` é um servidor [Model Context Protocol](https://modelcontextprotocol.io)
que fornece a um assistente de IA ferramentas reais sobre um projeto Rebase: ler e
gravar linhas, gerenciar usuários, executar migrações, invocar funções, controlar o servidor
de desenvolvimento.

Ele se comunica via MCP **apenas por stdio**. Não há porta e nenhum listener — o
processo é exatamente tão confiável quanto aquilo que o iniciou, e não há chamador
remoto para autenticar. Essa é a parte segura. As perguntas interessantes dizem respeito
ao que ele faz *depois* de estar em execução, e esta página as responde antes de
mostrar o bloco de configuração.

Um backend implantado também pode servir o próprio MCP, via HTTP, para as pessoas que usam
sua aplicação. Isso é algo diferente com um modelo de credenciais distinto:
consulte [O endpoint MCP remoto](/docs/ai/remote-mcp/).

## Conectando um cliente

O servidor é executado a partir do seu projeto: `@rebasepro/mcp` é uma devDependency que todo
scaffold do `rebase init` fixa junto com a CLI, e cada bloco abaixo — a integração
completa — inicia essa cópia (`pnpm exec rebase-mcp`, ou `npx --no rebase-mcp`
em um projeto npm), nunca uma mais recente do npm. Um projeto mais antigo a adiciona uma vez,
com `rebase skills install --mcp` ou `pnpm add -D @rebasepro/mcp`.

O `rebase init` grava o bloco para cada agente escolhido quando ele
[configura seus agentes de codificação por IA](/docs/ai/skills#set-up-by-rebase-init), mantendo
quaisquer outros servidores já presentes no arquivo. O comando `rebase init --agent cursor,codex` faz
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
O Codex lê a configuração do projeto somente após você confiar no projeto:

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

O **Windsurf** lê os servidores MCP apenas da sua configuração no nível do usuário, portanto não há
arquivo de projeto para gravar. Adicione o servidor nas configurações de MCP dele como `"command": "pnpm"`,
`"args": ["--dir", "/absolute/path/to/your/project", "exec", "rebase-mcp"]`, com esse caminho como `REBASE_PROJECT_DIR`.

Qualquer cliente MCP capaz de iniciar um servidor stdio funciona; o formato é o mesmo.

### Em qual diretório ele atua

`REBASE_PROJECT_DIR` é o diretório que contém `rebase.json`. Existe **uma**
precedência, e ela é a mesma em todos os clientes:

1. **O bloco de ambiente** — `REBASE_PROJECT_DIR`, `REBASE_BASE_URL`,
   `REBASE_API_TOKEN`. Se algum deles estiver definido, o projeto `default` é reconstruído
   a partir deles a cada inicialização.
2. **O diretório de trabalho do servidor**, quando contém um `rebase.json`. Um projeto
   em que você está situado tem precedência sobre qualquer item lembrado em `~/.rebase/projects.json`.
3. **O `default` persistido** em `~/.rebase/projects.json`, quando nenhum dos
   dois primeiros define nada.

A descoberta automática a partir de `.rebase/state.json` preenche lacunas em todos os três casos e nunca
substitui um valor fornecido por um deles.

Os blocos no nível do projeto apontam o projeto — `"."`, o diretório de trabalho do cliente
ou o `${workspaceFolder}` do editor — porque a regra 3 lê um arquivo compartilhado
por todos os projetos na máquina. Uma configuração no nível do usuário, como a do Windsurf,
informa um caminho absoluto.

## O que o servidor pode alcançar

Esta é a seção a ser lida antes de apontar um assistente para um banco de dados importante
para você.

O servidor carrega **uma credencial de ambiente para todo o processo**. Não há
identidade por ferramenta nem modo somente leitura; todas as ferramentas usam o mesmo token, e a
única chave no pacote serve para *ampliar* o alcance em vez de reduzi-lo.

Qual credencial é usada, em ordem de prioridade:

1. `REBASE_API_TOKEN` do ambiente. `REBASE_TOKEN` não é lido aqui:
   ele é o token do plano de controle da CLI e nunca é enviado ao app (o
   servidor avisa uma vez no stderr quando ele é o único definido). As ferramentas de cloud
   ainda o repassam à CLI que iniciam, e ela o envia ao plano de controle.
2. `REBASE_SERVICE_KEY` lida do `.env` do projeto
3. A chave de serviço descoberta automaticamente de `.rebase/state.json` enquanto `rebase dev`
   está em execução

2 e 3 são a chave do backend de dev desta máquina, usadas apenas quando o destino está
em loopback. Quando `REBASE_BASE_URL` aponta para outro lugar — `rebase cloud init --claim`
grava o endereço do projeto cloud, e nenhum `REBASE_API_TOKEN` até que um deploy
tenha sucesso — o servidor não envia token algum e avisa uma vez no stderr.

Um token que você registra para um projeto **tem precedência sobre a descoberta automática**. A descoberta
apenas preenche uma lacuna.

:::danger[O caminho sem configuração usa uma credencial de administrador]
As opções 2 e 3 são a **service key** — um segredo de administrador irrestrito. O backend
a resolve para `uid: "service"`, `roles: ["admin"]`, `isAdmin: true`. Essa
identidade tem todos os [escopos](/docs/backend/roles-and-scopes/) e satisfaz as
políticas `_default_admin_read` / `_default_admin_write` que o Rebase injeta em
cada coleção que não tenha configurado `disableDefaultPolicies`.

Portanto, a resposta sincera para "o RLS ainda o restringe?" é: o RLS *é executado* — o
driver faz o downgrade para a role `rebase_user` — e então uma política criada pelo próprio
Rebase concede tudo a essa identidade. Ler todas as linhas de todas as coleções
é o **comportamento projetado da configuração padrão**, não uma falha de segurança.

Com a configuração padrão (zero-config), um agente com essas ferramentas pode ler e gravar todas as
linhas de todas as coleções, listar todos os usuários, redefinir qualquer senha, invocar qualquer função
do backend e executar DDL contra qualquer `DATABASE_URL` resolvida pelo projeto.
:::

### Fornecendo uma credencial restrita em vez disso

Registre uma [API key](/docs/backend/api-keys) com escopo e o modelo de duas etapas
se aplicará de fato. Uma chave de serviço é executada com as roles `["service"]`, as quais
as políticas de administrador injetadas **não** contemplam — portanto, o RLS não concede nada a ela a menos que uma
das suas próprias políticas declare o contrário, e os escopos dela a restringem ainda mais:

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

Duas coisas que isso **não** faz, ambas importantes antes de você confiar nisso:

- **Não restringe as ferramentas de CLI.** `rebase_db_push`, `rebase_db_migrate`,
  `rebase_doctor` e as ferramentas de branch executam a CLI do Rebase, que se conecta com
  `DATABASE_URL` e nunca enxerga seu token. O gate de loopback abaixo é a
  única proteção diante delas.
- **Uma chave só alcança uma ferramenta de administração com o escopo dessa ferramenta.** `list_users` e
  `list_roles` precisam de `users:read`; `create_user`, `update_user`, `delete_user` e
  `rebase_auth_reset_password` precisam de `users:write`; as ferramentas de storage e de cron
  precisam do escopo `storage:*` ou `cron:*` correspondente; `invoke_function` precisa de
  `functions:invoke`. Sem
  ele, a chamada responde `403 SCOPE_MISSING`. Mesmo com `users:write`, uma chave não pode
  alterar a conta de um administrador: um administrador tem `keys:read` e `keys:write`, que nenhuma
  chave pode ter, e ninguém pode gerenciar uma conta que tenha mais do que ele próprio.

Uma chave criada com `--roles admin` é diferente: ela carrega as roles
`["service", "admin"]`, o que atende às mesmas políticas padrão de admin que a service
key atende. Dê a ela também `--full-access` e seu alcance passa a ser o da service key,
exceto o gerenciamento de chaves. A diferença é que ela é **revogável, expirável e possui
rate limit por chave**, nada do qual é verdadeiro para a service key — rotacioná-la
exige editar o `.env` e reiniciar o servidor.

Consulte [Agentes e Servidores MCP](/docs/backend/api-keys#agents-and-mcp-servers) para obter as
orientações completas sobre escopo de chaves.

### Colocando uma coleção totalmente fora de alcance

A razão pela qual uma credencial de admin lê tudo é a política básica que o Rebase
injeta em cada coleção, concedendo acesso ao contexto confiável do servidor e à
role `admin`. Uma coleção pode desativar essa base e assumir a
responsabilidade total pelo seu próprio RLS:

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

Agora, a única forma de acesso é correspondendo ao `patient_id`. O uid da service key é a
string literal `service`, portanto uma regra de proprietário (owner) nunca corresponderá a ele — as leituras retornam zero
linhas e as gravações são rejeitadas pelo Postgres. Esse é o único controle que restringe
a credencial padrão do servidor MCP em vez de ignorar as restrições.

Lembre-se de que essa é uma alteração real de RLS, não documental: ela entra em vigor
apenas depois que `rebase schema generate` e uma migração tiverem aplicado as políticas. Consulte
[Regras de Segurança (RLS)](/docs/collections/security-rules).

## O gate de loopback

O comando `rebase_project_add` aceita qualquer `baseUrl`, e as ferramentas de CLI se conectam com
qualquer `DATABASE_URL` que o projeto declarar. A mesma lista de ferramentas que edita um
banco de dados de teste no seu laptop pode, portanto, apagar linhas de produção, sem nada
no caminho além do julgamento do assistente sobre qual projeto está ativo.

**Toda ferramenta que modifica o ambiente de destino é recusada, a menos que esse destino esteja
na interface de loopback.** O gate foi escrito como uma lista do que *não* é
bloqueado, de modo que uma ferramenta adicionada posteriormente já nasce protegida por padrão.

- **Não bloqueadas — leituras:** `rebase_schema_plan`, `rebase_doctor`,
  `rebase_db_branch_list`, `rebase_db_branch_info`, `rebase_db_branch_diff`, `list_documents`,
  `get_document`, `list_users`, `list_roles`, `storage_list_objects`,
  `storage_get_download_url`, `cron_list_jobs`, `cron_get_job`, `cron_get_job_logs`,
  `rebase_dev_logs`, e as leituras do Rebase Cloud `rebase_cloud_status`,
  `rebase_cloud_logs`, `rebase_cloud_env_list`, `rebase_cloud_deployments_list`.
- **Não bloqueadas — escritas do Rebase Cloud:** `rebase_cloud_provision`,
  `rebase_cloud_deploy`, `rebase_cloud_env_set`, `rebase_cloud_rollback`.
  Provisionar cria um projeto; as outras alteram um projeto de produção. Nenhuma
  delas passa por `baseUrl` ou `DATABASE_URL`, que são tudo o que o gate pode
  verificar. Veja [Rebase Cloud](#rebase-cloud) para saber o que existe diante delas.
- **Não bloqueadas — apenas locais:** `rebase_schema_introspect`, `rebase_db_branch_switch`, `rebase_schema_generate`, `rebase_db_generate`,
  `rebase_generate_sdk`, as ferramentas do servidor de desenvolvimento e as ferramentas de registro de projetos.
  Elas gravam arquivos locais ou estado local e não têm alvo remoto para verificar.
- **Bloqueadas com base na `DATABASE_URL`:** as ferramentas de CLI restantes — `rebase_db_push`,
  `rebase_db_migrate`, `rebase_db_branch_create`, `rebase_db_branch_delete`.
- **Bloqueadas com base na `baseUrl` do projeto:** as ferramentas de SDK restantes —
  `create_document`, `update_document`, `delete_document`, `create_user`,
  `update_user`, `delete_user`, `rebase_auth_reset_password`,
  `storage_delete_object`, `cron_trigger_job`, `cron_toggle_job`,
  e `invoke_function`.

Os dois alvos não são intercambiáveis. As ferramentas de CLI nunca veem a `baseUrl`, portanto um
backend em localhost associado a uma `DATABASE_URL` de produção é verificado contra
o banco de dados, não contra o backend.

Uma recusa se parece com isto:

```text
Error: Refusing to run "delete_document": project "default" points at
https://api.example.com/, which is not local. Set REBASE_MCP_ALLOW_REMOTE_WRITES=true
to allow destructive tools against remote environments.
```

**Se nenhuma string de conexão puder ser resolvida, as ferramentas de DB protegidas são recusadas.**
Sem `DATABASE_URL`, o CLI usa o banco de dados de desenvolvimento gerenciado, que é
o padrão de um projeto novo, e o gate recusa ali as suas quatro ferramentas de
banco de dados. A recusa diz por quê e indica o que funciona no lugar. Ela
não sugere a opção de desativar a proteção:

```text
Error: Refusing to run "rebase_db_push": project "default" sets no DATABASE_URL, so the
CLI would use the managed development database (PGlite, started by `rebase dev`). You
most likely do not need this tool: the dev server applies the collections to that
database at boot, additively. After changing a collection, restart it with
rebase_dev_stop and rebase_dev_start. …
```

A partir de um
terminal, `rebase db push` e `rebase db migrate` rodam nesse banco de dados;
apenas as ferramentas do MCP são recusadas. Na 0.24 o CLI também as recusa ali.

Apenas o loopback é considerado local: `localhost`, `*.localhost`, `127.0.0.0/8`, `::1`
(e `0.0.0.0`).
Faixas privadas como `10.x` e `192.168.x` **não** são — essas têm tanta probabilidade de ser
um cluster de homologação compartilhado quanto um laptop, e tratá-las como locais liberaria
exatamente o tipo de acidente que o gate foi criado para impedir.

Defina `REBASE_MCP_ALLOW_REMOTE_WRITES=true` para desativar essa proteção. Definir isso globalmente na sua
configuração de cliente MCP remove o gate para todos os projetos que o servidor pode alcançar, não
apenas aquele no qual você estava pensando.

## Marcação de dados não confiáveis

Linhas, registros de usuário, listagens de storage, jobs cron, respostas de funções e saídas
de CLI retornam envolvidos em um envelope explícito:

```text
<<<UNTRUSTED_DATA source="list_documents" id="9b2f4c1e-…">>>
[ … rows … ]
<<<END_UNTRUSTED_DATA id="9b2f4c1e-…">>>
```

Qualquer coisa armazenada no seu banco de dados foi gravada por alguém, e chega
pelo mesmo canal que o contrato de ferramentas seguido pelo assistente. O envelope instrui
o modelo a tratar isso como conteúdo inerte, e não como instruções.

O `id` é gerado do zero para cada resposta, após os dados terem sido gravados, e
apenas o marcador final que o contém fecha o bloco. Textos dentro dos dados que tenham
formato semelhante ao marcador são quebrados com um espaço de largura zero (zero-width space), para que uma linha contendo
`<<<END_UNTRUSTED_DATA>>>` não encerre o envelope prematuramente deixando o que vem a seguir
do lado de fora.

O [endpoint remoto](/docs/ai/remote-mcp/) cerca os resultados das suas ferramentas da mesma
forma e avisa o cliente disso; seu `structuredContent` carrega o resultado puro.
`list_collections` e
`describe_collection` são as exceções: só um modelo as lê, por isso são
enviadas uma única vez, no texto. Antes da 0.24 a listagem também carregava uma
cópia em `structuredContent`.

Trata-se de um marcador, não de uma sandbox. Um assistente que possui essas ferramentas é apenas tão seguro
quanto o conteúdo que você permite que ele leia.

## Múltiplos projetos

As configurações de projetos são armazenadas em `~/.rebase/projects.json`, e o servidor
pode manter vários ao mesmo tempo — útil quando você trabalha alternando entre ambientes
locais e remotos. Enquanto o `rebase dev` estiver em execução, o servidor lê a porta ativa e
a service key de `.rebase/state.json` no diretório do projeto, o que
torna o caso local sem necessidade de configuração (zero-config).

:::note[O registro é a última palavra, não a primeira]
A precedência é a indicada acima: bloco de ambiente, depois o diretório de trabalho
quando contém um `rebase.json`, e em seguida o `default` persistido.

`REBASE_PROJECT_DIR`, `REBASE_BASE_URL` e `REBASE_API_TOKEN` reconstroem o
projeto `default` **a cada inicialização**, não apenas na primeira. A reconstrução é
feita em toda a entrada: um token registrado contra o `projectDir` antigo é descartado em vez
de ser levado para um diretório para o qual nunca foi emitido. Um `default` derivado dessa
maneira — ou a partir do diretório de trabalho — nunca é gravado de volta em
`~/.rebase/projects.json`, portanto a service key de dev de um projeto não pode se tornar
a de outro.

O `activeProject` é fixo (sticky), portanto, se uma sessão anterior chamou
`rebase_project_switch`, as ferramentas focarão esse projeto e o servidor informará isso
no stderr — a menos que esse projeto esteja registrado sob um diretório *diferente* daquele
em que este servidor está em execução; nesse caso, ele voltará para `default` e informará
isso. Se um assistente parecer estar lendo o banco de dados errado, chame
`rebase_project_current` primeiro.
:::

Os tokens são armazenados nesse registro **em texto simples**. É um arquivo no seu diretório
pessoal contendo credenciais de administrador para cada projeto que você registrou; trate-o
com o devido cuidado.

## Rebase Cloud

Oito ferramentas levam um app deste diretório até um backend no ar no
[Rebase Cloud](/docs/deployment/cloud/) e o mantêm em execução. Cada uma executa
`rebase cloud <command> --json` no diretório do projeto ativo: o mesmo
comando que uma pessoa executa, então não há uma segunda implementação para divergir dele.

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

A jornada habitual de um agente é: `rebase_cloud_provision`, e então entregar ao usuário a
URL de reivindicação; `rebase_cloud_status` para ver o projeto (enquanto não é reivindicado,
`unclaimed` traz a URL de reivindicação e quando ele será excluído); `rebase_cloud_deploy`
após uma mudança; `rebase_cloud_logs` quando algo se comporta mal; e
`rebase_cloud_rollback` quando a produção está quebrada.

**Sobre o que elas atuam.** O projeto ao qual o diretório ativo está vinculado em
`.rebase/cloud.json`. Nenhuma delas recebe um id de projeto ou um diretório, então um
assistente não pode apontá-las para outro projeto que não o diretório
vinculado. Trocar o projeto ativo com `rebase_project_switch` troca
o diretório em que elas executam.

**Com a autoridade de quem.** O que a CLI resolver nesse diretório: `REBASE_TOKEN`
quando está definido, depois o token que `rebase cloud init --claim` guardou para um
projeto não reivindicado, depois a sessão de `rebase cloud login`. No diretório desse
projeto não reivindicado, um `REBASE_TOKEN` que não tem nenhum escopo no projeto é deixado
de lado em favor do token do próprio projeto. O plano de controle
verifica cada chamada como verifica as da CLI, então com um token criado por
`rebase cloud tokens create --can logs` um assistente pode ler logs, e o
plano de controle recusa seus deploys, variáveis e rollbacks. Nenhuma credencial, ou uma recusada, volta como um erro que diz o que o
usuário precisa fazer (`rebase cloud login`, ou reivindicar o projeto).

**Por que o gate de loopback não se aplica.** O gate verifica a `baseUrl` do app e
a `DATABASE_URL` da CLI; essas ferramentas não usam nenhuma das duas. Depois de `rebase_cloud_provision`,
`REBASE_BASE_URL` aponta para o novo projeto cloud, então bloquear com base nela recusaria
o próprio deploy de que a jornada precisa. O provisionamento em si apenas cria: ele não toca
em nenhum app ou banco de dados existente, e a CLI ainda o recusa em um diretório
que já está vinculado. Um deploy, uma variável e um rollback alteram cada um
a produção. O que existe diante deles é a credencial acima e
a aprovação de ferramentas do seu cliente MCP. Para impedir que um assistente altere um projeto
cloud, defina `REBASE_TOKEN` no ambiente do servidor com um token sem as
permissões `deploy` e `env`.

Cada ferramenta é um instantâneo:

- `rebase_cloud_logs` nunca acompanha. Seu resultado traz `nextSinceTime`; passe-o
  de volta como `since` para ler o que veio depois. Ele retorna as últimas 200 linhas, a menos que
  `tail` diga outra coisa. `source: "build"` retorna o log de build mais recente.
- `rebase_cloud_deploy` acompanha o deploy até o fim e verifica se a nova
  versão responde. `wait: false` retorna assim que o deploy é disparado.
  Ele nunca ejeta um projeto do runtime gerenciado, faz deploy de uma versão mais antiga do framework,
  nem pula as verificações de build: essas são decisões do usuário, e uma
  recusa que precise de uma diz isso.
- `rebase_cloud_rollback` passa `--yes`. A chamada da ferramenta é a confirmação, já que
  não há terminal para perguntar.

`rebase_cloud_env_set` grava o valor na entrada padrão da CLI, de modo que ele
nunca fica em uma linha de comando onde o `ps` o mostraria, e o valor é removido de
tudo o que a ferramenta retorna. Seu resultado diz o que foi armazenado (a chave, se
é secreta, se um redeploy está pendente), nunca o valor. `rebase_cloud_env_list`
lista apenas chaves. Uma CLI mais antiga que `env set --stdin` é recusada com uma mensagem para
atualizá-la; o valor não é enviado de outra forma.

Os resultados voltam no [envelope de dados não confiáveis](#marcação-de-dados-não-confiáveis),
atrás de uma linha do servidor sobre o que fazer em seguida. Uma recusa é um erro de ferramenta
que carrega o código da CLI, como `no_project`, `token_rejected`,
`managed_project` ou `deploy_failed`. Quando o servidor reconhece o código, ele
acrescenta o próximo passo, e depois a própria mensagem da CLI. Toda ferramenta verifica seus argumentos
contra o schema que anuncia antes de qualquer coisa ser iniciada, e recusa um
argumento que não declara.

## Referência de ferramentas

51 ferramentas, divididas em dez grupos: schema e banco de dados, planejamento de schema,
documentos, usuários e roles, storage, cron, funções, servidor de desenvolvimento, registro
de projetos e Rebase Cloud. Cada uma, com o que precisa e se o gate a recusa contra um destino não
local, está na [referência de ferramentas do MCP](/docs/ai/mcp-tool-reference).

## Recursos

Além das ferramentas, o servidor expõe recursos MCP para que o cliente possa obter
contexto do projeto sem gastar uma chamada de ferramenta:

| URI | Descrição |
|---|---|
| `rebase://collections/{name}` | Código TypeScript da definição da coleção |
| `rebase://schema` | O schema Drizzle gerado (`schema.generated.ts`) |

As coleções são descobertas em `app/config/collections/`,
`config/collections/` ou `collections/` sob o diretório do projeto ativo —
qualquer que existir.

`rebase://schema` é listado **apenas se** o schema gerado existir.
O `findBackendDir` procura por `backend/` e depois por `app/backend/` sob o diretório
do projeto ativo, e lê `src/schema.generated.ts` daquele que encontrar —
de modo que tanto o layout padrão quanto o deste monorepo funcionam, e um projeto estruturado
de uma terceira forma, ou um que ainda não executou `rebase schema generate`, simplesmente não
verá o recurso ser disponibilizado.

## O endpoint remoto

Um backend implantado também pode servir o próprio MCP, em `/mcp`, para as pessoas que usam
sua aplicação, cada uma conectando-se como ela mesma sob a sua própria row-level
security. Isso tem uma página própria:
[O endpoint MCP remoto](/docs/ai/remote-mcp/).

## Configuração recomendada

- Aponte o servidor para um projeto **local** e mantenha `REBASE_MCP_ALLOW_REMOTE_WRITES`
  indefinido. O gate é o recurso mais valioso do pacote.
- Para qualquer ambiente remoto, registre uma **API key `rk_` com escopo restrito** em vez de permitir
  que a descoberta automática utilize uma service key.
- Verifique `rebase_project_current` quando a saída parecer estranha. O projeto ativo é
  persistente (sticky) e fica fora do seu repositório.
- Trate o arquivo `~/.rebase/projects.json` como um arquivo de segredos.
