---
sourceHash: 373a79f1c328f730
title: Servidor MCP
sidebar_label: Servidor MCP
description: Conecte o Claude Code, Cursor, Gemini CLI ou qualquer cliente MCP a um projeto Rebase — as 42 ferramentas que ele expõe, a credencial com a qual se autentica e o gate de loopback que fica entre um agente e a produção.
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
consulte [O endpoint remoto](#o-endpoint-remoto).

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

1. `REBASE_API_TOKEN` / `REBASE_TOKEN` do ambiente
2. `REBASE_SERVICE_KEY` lida do `.env` do projeto
3. A chave de serviço descoberta automaticamente de `.rebase/state.json` enquanto `rebase dev`
   está em execução

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
  `rebase_db_branch_list`, `rebase_db_branch_info`, `list_documents`,
  `get_document`, `list_users`, `list_roles`, `storage_list_objects`,
  `storage_get_download_url`, `cron_list_jobs`, `cron_get_job`, `cron_get_job_logs`,
  `rebase_dev_logs`.
- **Não bloqueadas — apenas locais:** `rebase_schema_introspect`, `rebase_schema_generate`, `rebase_db_generate`,
  `rebase_generate_sdk`, as ferramentas do servidor de desenvolvimento e as ferramentas de registro de projetos.
  Elas gravam arquivos locais ou estado local e não têm alvo remoto para verificar.
- **Bloqueadas com base na `DATABASE_URL`:** as ferramentas de CLI restantes — `rebase_db_push`,
  `rebase_db_migrate`, `rebase_db_branch_create`, `rebase_db_branch_delete`.
- **Bloqueadas com base na `baseUrl` do projeto:** as ferramentas de SDK restantes —
  `create_document`, `update_document`, `delete_document`, `create_user`,
  `update_user`, `delete_user`, `rebase_auth_reset_password`,
  `storage_delete_object`, `cron_trigger_job`, `cron_toggle_job`,
  `invoke_function`.

Os dois alvos não são intercambiáveis. As ferramentas de CLI nunca veem a `baseUrl`, portanto um
backend em localhost associado a uma `DATABASE_URL` de produção é verificado contra
o banco de dados, não contra o backend.

Uma recusa se parece com isto:

```text
Error: Refusing to run "delete_document": project "default" points at
https://api.example.com/, which is not local. Set REBASE_MCP_ALLOW_REMOTE_WRITES=true
to allow destructive tools against remote environments.
```

**Se nenhuma string de conexão puder ser resolvida, as ferramentas de DB são recusadas** —
um alvo não verificável não é considerado seguro:

```text
Error: Refusing to run "rebase_db_push": no DATABASE_URL could be resolved for
project "default", so the database it would connect to cannot be verified as local.
```

Apenas o loopback é considerado local: `localhost`, `*.localhost`, `127.0.0.0/8`, `::1`.
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

O [endpoint remoto](#o-endpoint-remoto) cerca os resultados das suas ferramentas da mesma
forma e avisa o cliente disso; seu `structuredContent` carrega o resultado puro.

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

## Referência de ferramentas

42 ferramentas, divididas em nove grupos: schema e banco de dados, planejamento de schema,
documentos, usuários e roles, storage, cron, funções, servidor de desenvolvimento e registro
de projetos. Cada uma, com o que precisa e se o gate a recusa contra um destino não
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

Tudo o que foi citado acima é uma ferramenta de desenvolvedor: roda na sua máquina e utiliza uma
service key ou uma API key. Um backend implantado também pode servir o próprio MCP, em `/mcp`, para
as pessoas que usam sua aplicação. Um assistente conectado por uma delas lê e
grava no projeto **como aquela pessoa**, e cada chamada é executada sob as suas próprias
regras de row-level security (RLS).

Ele fica desativado a menos que você o ative, e ambas as variáveis são obrigatórias:

```bash
REBASE_MCP_ENABLED=true
REBASE_PUBLIC_URL=https://app.example.com   # this deployment's real origin
```

Sem `REBASE_PUBLIC_URL`, um segredo JWT ou um driver de dados capaz de restringir uma consulta
a um usuário, o endpoint se recusa a inicializar e informa o motivo no log de boot. Nenhuma
`REBASE_ROLE` o ativa.

- **OAuth, com uma tela de consentimento.** O cliente localiza o servidor de autorização
  por meio de `/.well-known/oauth-protected-resource`, registra-se (o registro dinâmico
  vem ativado por padrão; `REBASE_MCP_OPEN_REGISTRATION=false` limita-o
  aos clientes que você registrar) e envia a pessoa para uma tela de consentimento que faz
  o login através do seu `/auth/login` existente.
- **Sete ferramentas, três escopos.** Os mesmos [escopos](/docs/backend/roles-and-scopes/)
  que toda credencial usa. `data:read` oferece `list_collections`,
  `query_collection`, `count_documents` e `get_document`; `data:write` adiciona `create_document` e
  `update_document`; `data:delete` adiciona `delete_document`. Um cliente que não pede
  nada recebe `data:read`. Cada um pode ser restringido a uma coleção: `data:read:posts`
  lista e lê `posts` e nada mais. Um escopo decide quais ferramentas são
  oferecidas e quais coleções elas alcançam, não quais linhas: uma lista vazia pode ser
  o RLS atuando, e `data:write` ainda assim não poderá gravar uma linha que a pessoa não pudesse gravar.
- **Concessões feitas antes da 0.24 mantêm seu alcance.** `mcp:read` é lido como
  `data:read`, e `mcp:write` como `data:write data:delete`, nas concessões armazenadas e
  nos tokens já emitidos.
- **Uma chave de API também funciona.** `/mcp` também aceita `Authorization: Bearer rk_…`, para
  um cliente configurado com um header em vez de um fluxo OAuth. A chave alcança
  as ferramentas que seus escopos `data:*` cobrem, como quem quer que ela represente: uma
  [chave pessoal](/docs/backend/api-keys/#personal-keys) como seu proprietário, uma chave de serviço
  como `api-key:<id>`.
- **O vocabulário do SDK, as respostas do REST.** As ferramentas recebem o que o SDK recebe —
  `where` (`{"status": ["==", "paid"]}`), `orderBy` (`["created_at", "desc"]` ou
  `"created_at:desc"`), `limit`, `offset`, `searchString`, e `data` para uma
  escrita — e leem através do caminho de `GET /api/data/<collection>`, então uma linha
  volta como o REST a serve (datas ISO, um `belongsTo` como sua chave estrangeira, por exemplo
  `authorId`) e pode ser enviada de volta em uma atualização sem alterações. `query_collection`
  responde `{ data, meta }` com `meta.total` e `meta.hasMore`, `count_documents`
  `{ count }`, e `list_collections` os esquemas OpenAPI `row` e `create` de cada coleção,
  além de `softDeleteField` onde linhas vão para a lixeira. Como no REST,
  um `limit` acima de 1000, um argumento não declarado e uma edição ou exclusão de uma linha na
  lixeira (404) são recusados; definir o campo de soft-delete como `null` a restaura.
- **Um token apenas para este endpoint.** Um token de acesso MCP é recusado por
  `/api/data`, `/api/admin` e pelo WebSocket, logo conectar um assistente não
  entrega uma sessão a ele.

Uma limitação: desconectar um cliente (`DELETE /api/oauth/grants/:clientId`, com a
sessão da própria pessoa) revoga seus refresh tokens imediatamente, mas um token de acesso
já emitido continua funcionando até expirar, dentro do prazo de uma hora. Essa mesma hora
limita todo o restante: cada refresh relê as roles da pessoa e recusa
uma conta que foi excluída ou uma concessão mais antiga que o último "sair de todos os dispositivos"
ou alteração de senha. Portanto, um rebaixamento de permissão ou logout atinge um cliente conectado
dentro da vida útil de um token de acesso. Uma sessão de visitante (guest) não pode dar consentimento.

As rotas estão em [Endpoints](/docs/backend/endpoints/#mcp-surface) e as
variáveis em [Configuração](/docs/getting-started/configuration/#mcp-surface).

## Configuração recomendada

- Aponte o servidor para um projeto **local** e mantenha `REBASE_MCP_ALLOW_REMOTE_WRITES`
  indefinido. O gate é o recurso mais valioso do pacote.
- Para qualquer ambiente remoto, registre uma **API key `rk_` com escopo restrito** em vez de permitir
  que a descoberta automática utilize uma service key.
- Verifique `rebase_project_current` quando a saída parecer estranha. O projeto ativo é
  persistente (sticky) e fica fora do seu repositório.
- Trate o arquivo `~/.rebase/projects.json` como um arquivo de segredos.
