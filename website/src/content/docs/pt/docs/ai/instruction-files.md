---
sourceHash: 80e40ea5912a48c8
title: Arquivos de Instruções de IA
sidebar_label: Arquivos de Instruções de IA
description: Todo projeto Rebase gerado vem com o ai-instructions.md mais arquivos de ponteiro para Claude, Cursor, Windsurf, Copilot e AGENTS.md que carregam as cinco regras que os assistentes mais quebram — uma única fonte da verdade, muitos nomes de arquivo.
---

<span class="since-badge" data-since="0.31">Desde 0.31</span>

Cada assistente quer suas regras em um arquivo diferente. O Claude Code lê
`CLAUDE.md`, o Cursor lê `.cursorrules`, o Windsurf lê `.windsurfrules`,
o Copilot lê `.github/copilot-instructions.md`, e a convenção entre múltiplos
fornecedores é o `AGENTS.md`. Manter as mesmas orientações em cinco arquivos é a
forma como quatro deles acabam desatualizados.

O comando `rebase init` cria todos os cinco — como **ponteiros para um único arquivo que você realmente
edita**:

```text
your-project/
├── ai-instructions.md            ← the real content
├── CLAUDE.md                     ← pointer
├── AGENTS.md                     ← pointer
├── .cursorrules                  ← pointer
├── .windsurfrules                ← pointer
└── .github/
    └── copilot-instructions.md   ← pointer
```

Cada arquivo ponteiro aponta para o real, indica onde as skills ficam e carrega as cinco regras que um assistente não deve quebrar, mesmo que nunca abra mais nada:

```markdown title="CLAUDE.md"
# Rebase AI Rules
Please refer to and follow the instructions defined in [ai-instructions.md](./ai-instructions.md).
The Rebase skills for this assistant live in `.claude/skills/`. If they are not there yet, install them, with the Rebase MCP server: `rebase skills install --agent claude --mcp`.

## Before you write any code

These hold before you have opened ai-instructions.md, and in every session:

- **A table is a file in `backend/schema/`.** Declare it with `defineTable` from `@rebasepro/server/schema` — columns, relations and a required `rls` — export it from `backend/schema/index.ts`, and `pnpm dev` creates it. How it looks in the admin panel is a separate, optional file: `frontend/src/cms/<table>.tsx` with `customizeTable`, which imports the table as a type only. Never `CREATE TABLE`, `ALTER TABLE` or `CREATE INDEX` in code, and never SQL as the database owner against an application table: `rebase.sql()` skips row-level security, validation and hooks, so keep it for server work that needs every row and for reading a column marked `.private()`. When the SDK cannot express a query, run it as the caller with `getSql(c)` — the same row-level security as the SDK, read-only unless `{ write: true }`, every value in `params`. A table that already exists gets its file from `pnpm schema:introspect`. With no `backend/schema/` (a headless project) the database is the schema instead: ai-instructions.md says how to serve a table.
- **Data goes through the SDK:** `rebase.dataAsAdmin.<table>` in functions and crons, `getDriver(c)` to act as the caller.
- **A route in `backend/functions/` is public until you guard it** with `requireAuth` or `requireAdmin` from `@rebasepro/server/functions`.
- **Never deploy, never edit `.env`, never edit generated files** (`backend/src/schema.generated.ts`, `rebase.resources.json`).
- **When Rebase cannot do what the task needs, tell the human** what is missing instead of working around it.
```

Os outros diferem apenas no diretório de skills do agente e no seu valor de `--agent` —
`--agent cursor`, `--agent windsurf`, `--agent codex`, `--agent copilot` — e no
caminho relativo, que é `../ai-instructions.md` em
`.github/copilot-instructions.md` e `ai-instructions.md` em `AGENTS.md`. A
terceira linha é condicional porque o `rebase init --agent` já pode ter
instalado as skills antes mesmo de o assistente ler o arquivo.

Isso acontece em todo `rebase init`, para cada preset, incluindo `--headless`.
Não há flag e nem prompt.

O `rebase init` também cria o `.mcp.json`, que aponta o Claude Code, o Cursor e
qualquer outro cliente MCP para o [servidor MCP do Rebase](/docs/ai/mcp) — a
cópia do próprio projeto, uma devDependency fixada com a CLI (`npx --no rebase-mcp`
em um projeto npm):

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

`REBASE_PROJECT_DIR` é `"."`, não um caminho absoluto: o cliente inicializa o servidor
na raiz do projeto, e um caminho absoluto é a única linha desse arquivo que
não pode ser commitada. Isso existe porque `~/.rebase/projects.json` é de
escopo de toda a máquina — um projeto que não especifica seu próprio diretório
recorre ao que quer que tenha sido persistido pelo último projeto nessa máquina. Consulte
[a precedência](/docs/ai/mcp#which-directory-it-acts-on).

## Por que um ponteiro em vez de uma cópia

<span class="since-badge" data-since="0.31">Desde 0.31</span>

Os arquivos ponteiro quase não contêm nada. Um arquivo que referencia o arquivo real
mantém as convenções em um só lugar e tem propriedades que uma cópia não tem:

- **Um único arquivo para editar.** As regras não divergem entre os assistentes, porque há
  apenas um conjunto de regras.
- **Um único diff para revisar.** Uma alteração nas convenções do projeto é uma alteração em um
  único arquivo, e não em cinco arquivos idênticos que um revisor precisaria comparar.
- **Adicionar um assistente requer apenas um arquivo pequeno.** Uma nova ferramenta com um novo
  nome de arquivo recebe um ponteiro, e não uma sexta cópia das suas convenções.

A única exceção é o bloco **Before you write any code**. Um assistente nem
sempre segue um link de forma confiável: um que esteja ocupado com uma tarefa escreve
o código primeiro, e um iniciado na raiz de um repositório cujo projeto Rebase fica em uma
subpasta nunca chega a carregar esses arquivos. Portanto, as cinco regras cuja violação
causa o maior dano (uma tabela criada em SQL em vez de `backend/schema`, dados lidos e
gravados ignorando o SDK, uma rota desprotegida, um deploy, um arquivo gerado editado)
são gravadas em cada ponteiro, identicamente. Uma verificação no CI mantém as cinco
cópias iguais.

Vale a pena manter esse padrão se você fizer um fork do scaffold, e vale a pena
adotá-lo mesmo em repositórios que não sejam projetos Rebase.

## Com o que o `ai-instructions.md` começa

<span class="since-badge" data-since="0.31">Desde 0.31</span>

O arquivo gerado é deliberadamente curto — ele aponta para
[`rebase skills install`](/docs/ai/skills) para mais detalhes e, em seguida, estabelece
as regras que os assistentes erram com frequência suficiente para que valha a pena repeti-las
no início de cada sessão:

1. **Schema as code.** Uma tabela é um `defineTable` em `backend/schema/<table>.ts`,
   exportada de `backend/schema/index.ts` — apenas o que o index exporta é
   servido — com um `rls` obrigatório. Nunca edite manualmente o schema gerado do Drizzle
   ou as tabelas do Postgres — consulte [Schema as Code](/docs/architecture/schema-as-code).
2. **Aplicar uma alteração de schema** depende do banco de dados. Enquanto o `pnpm dev`
   estiver em execução, salvar um arquivo em `backend/schema/` é a única etapa necessária:
   ele regenera o schema do Drizzle e os tipos do SDK, e a inicialização cria as
   tabelas e colunas ausentes. O `pnpm db:push` serve apenas para o que a inicialização deliberadamente
   não mexe — uma coluna renomeada, um tipo restringido, uma coluna removida — tanto no
   banco de dados de desenvolvimento gerenciado quanto no seu próprio PostgreSQL. Em produção, usa-se
   `pnpm db:generate` e depois `pnpm db:migrate`.
3. **Use o SDK.** Utilize `rebase.dataAsAdmin.<table>` para ações realizadas como
   identidade de serviço, ou `getDriver(c)` dentro de uma função quando a leitura deve ser
   executada como o chamador. O cliente de servidor não possui um acessador `data` simples.
   SQL puro e chamadas diretas do Drizzle ignoram validações, hooks e RLS.
4. **Proteja todas as rotas customizadas.** Rotas em `backend/functions/` são montadas
   *sem* autenticação. Use `requireAuth` / `requireAdmin` de
   `@rebasepro/server/functions` no próprio slot de middleware da rota — ler
   `c.get("user")` não é uma proteção, assim como `app.use()` depois da rota também não é.

Essa última regra é fundamental manter. É a diferença entre um middleware que
é executado e um que não é, e um assistente que não foi avisado invariavelmente
escreverá a versão que não executa — consulte
[Custom Functions](/docs/backend/custom-functions).

`requireAdmin` aceita apenas a role `admin`. Quando uma role mais restrita ou uma chave de API
deve ser capaz de chamar uma rota, a proteção a ser adicionada é `requireScope`,
com um escopo que o aplicativo declara — consulte [Roles and scopes](/docs/backend/roles-and-scopes/#app-scopes).

Após as regras, há duas seções que se aplicam apenas a alguns projetos. **Backend
runtime** lista o que o runtime gerenciado no Rebase Cloud permite: pacotes,
memória e estado em nível de módulo, timeouts, portas de saída, configuração e
armazenamento para arquivos gerados. Ela faz um link para
[Managed backend runtime](/docs/deployment/managed-runtime/), para que um assistente
planeje uma funcionalidade de backend com base em limites reais, em vez de adivinhações. **Admin UI**
contém as regras de `@rebasepro/ui`. Elas se aplicam a visualizações dentro do painel administrativo,
não a um site público ou aplicativo estático servido pelo projeto.

## Tornando-o seu

O `ai-instructions.md` é o seu arquivo. Nada o regenera ou sobrescreve — diferentemente
das [skills instaladas](/docs/ai/skills), que são substituídas a cada
`rebase skills install`. As convenções específicas do projeto devem ficar aqui.

O que realmente merece um espaço aqui é o que um assistente não consegue deduzir a partir do código:
quais tabelas são legadas, qual serviço é dono de qual tabela, a convenção de nomenclatura
que não é aplicada em nenhum outro lugar, a migration que não deve ser executada novamente. Mantenha-o
curto — instruções carregadas em cada requisição disputam a atenção com a tarefa real,
e um arquivo muito longo é lido superficialmente pelo assistente.

E tenha em mente os limites: este arquivo molda o que um assistente *escreve*. Ele
não tem influência sobre o que um agente conectado ao seu banco de dados pode *fazer* —
isso é determinado pela credencial que ele possui, e nada no Markdown muda isso. Consulte
[o modelo de credenciais do servidor MCP](/docs/ai/mcp#what-the-server-can-reach).
