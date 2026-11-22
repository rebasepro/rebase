---
sourceHash: 4a5c6ecfb9f66fd3
title: Arquivos de Instruções de IA
sidebar_label: Arquivos de Instruções de IA
description: Todo projeto Rebase estruturado inclui o ai-instructions.md mais arquivos de ponteiro para Claude, Cursor, Windsurf, Copilot e AGENTS.md que contêm as cinco regras que os assistentes mais quebram — uma única fonte da verdade, muitos nomes de arquivo.
---

Cada assistente espera suas regras em um arquivo diferente. O Claude Code lê
`CLAUDE.md`, o Cursor lê `.cursorrules`, o Windsurf lê `.windsurfrules`,
o Copilot lê `.github/copilot-instructions.md`, e a convenção entre diferentes provedores
é `AGENTS.md`. Manter as mesmas orientações em cinco arquivos é a maneira perfeita de quatro deles
ficarem desatualizados.

`rebase init` grava todos os cinco — como **ponteiros para um único arquivo que você realmente
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

Cada arquivo de ponteiro indica o arquivo real, informa onde as skills residem e traz as cinco regras que um assistente não pode quebrar, mesmo que nunca abra mais nada:

```markdown title="CLAUDE.md"
# Rebase AI Rules
Please refer to and follow the instructions defined in [ai-instructions.md](./ai-instructions.md).
The Rebase skills for this assistant live in `.claude/skills/`. If they are not there yet, install them, with the Rebase MCP server: `rebase skills install --agent claude --mcp`.

## Before you write any code

These hold before you have opened ai-instructions.md, and in every session:

- **A table is a file in `backend/schema/`.** Declare it with `defineTable` from `@rebasepro/server/schema` — columns, relations and a required `rls` — export it from `backend/schema/index.ts`, and `pnpm dev` creates it. How it looks in the admin panel is a separate, optional file: `frontend/src/cms/<table>.tsx` with `customizeTable`, which imports the table as a type only. Never `CREATE TABLE`, `ALTER TABLE` or `CREATE INDEX` in code, and never SQL as the database owner against an application table: `rebase.sql()` skips row-level security, validation and hooks, so keep it for server work that needs every row and for reading a column marked `.private()`. When the SDK cannot express a query, run it as the caller with `getSql(c)` — the same row-level security as the SDK, read-only unless `{ write: true }`, every value in `params`. A table that already exists gets its file from `pnpm schema:introspect`. With no `backend/schema/` (a headless project) the database is the schema instead: ai-instructions.md says how to serve a table.
- **Data goes through the SDK:** `rebase.dataAsAdmin.<table>` in functions and crons, `getDriver(c)` to act as the caller.
- **A route in `backend/functions/` is public until you guard it** with `requireAuth` or `requireAdmin` from `@rebasepro/server/functions`.
- **Never deploy, never edit generated files** (`backend/src/schema.generated.ts`, `rebase.resources.json`). In `.env`, change only a local setting the task needs (`AUTH_MAGIC_LINK`, `FRONTEND_URL`, `REBASE_FUNCTIONS_TIMEOUT_MS` and the like), one line at a time, and say which; never rewrite, print or rotate its secrets (`DATABASE_URL`, `JWT_SECRET`, `REBASE_SERVICE_KEY`).
- **An admin, back-office or internal tool is built in the Rebase admin, never as a new app.** A dashboard, a review queue, a staff screen or a settings page is a custom view, the home page, a record tab or an action in `frontend/` (ai-instructions.md, "Admin UI", says how). A separate app is only for what the project's own users see. The admin derived from the tables is a draft: before calling an admin done, give every table it shows a `customizeTable` pass (a title, its columns, ids and raw JSON hidden, labels; ai-instructions.md, "Admin UI", has the checklist).
- **When Rebase cannot do what the task needs, tell the human** what is missing instead of working around it.
```

Os outros diferem apenas no diretório de skills do agente e no valor de seu `--agent` —
`--agent cursor`, `--agent windsurf`, `--agent codex`, `--agent copilot` — e no
caminho relativo, que é `../ai-instructions.md` em
`.github/copilot-instructions.md` e `ai-instructions.md` em `AGENTS.md`. A
terceira linha é condicional porque `rebase init --agent` já pode ter
instalado as skills antes mesmo de o assistente lê-lo.

Isso acontece em todo `rebase init`, para todos os presets, incluindo `--headless`.
Não há flag nem prompt.

`rebase init` também cria o `.mcp.json`, que aponta o Claude Code, o Cursor e
qualquer outro cliente MCP para o [servidor MCP do Rebase](/docs/ai/mcp) — a cópia
do próprio projeto, uma devDependency fixada com a CLI (`npx --no rebase-mcp` em um projeto npm):

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

`REBASE_PROJECT_DIR` é `"."`, não um caminho absoluto: o cliente inicia o servidor
na raiz do projeto, e um caminho absoluto é a única linha desse arquivo que
não pode ser commitada. Ele está lá porque `~/.rebase/projects.json` tem escopo em nível de máquina — um projeto que não especifica seu próprio diretório recorre a
qualquer que tenha sido o último projeto persistido nessa máquina. Consulte
[a ordem de precedência](/docs/ai/mcp#which-directory-it-acts-on).

## Por que um ponteiro em vez de uma cópia

Os arquivos de ponteiro praticamente não contêm nada. Um arquivo que referencia o arquivo real mantém as
convenções em um só lugar e possui propriedades que uma cópia não tem:

- **Apenas um arquivo para editar.** As regras não divergem entre assistentes, porque há
  apenas um conjunto de regras.
- **Apenas um diff para revisar.** Uma alteração nas convenções do projeto é uma alteração em um
  único arquivo, e não em cinco arquivos idênticos que um revisor precisa comparar.
- **Adicionar um assistente é apenas um arquivo pequeno.** Uma nova ferramenta com um novo nome de arquivo recebe
  um ponteiro, e não uma sexta cópia de suas convenções.

A única exceção é o bloco **Before you write any code**. Um assistente nem
sempre segue um link de forma confiável: um assistente ocupado com uma tarefa escreve o código primeiro,
e um assistente iniciado na raiz de um repositório cujo projeto Rebase fica em uma
subpasta nunca chega a carregar esses arquivos. Portanto, as cinco regras cuja violação causa
o maior estrago (uma tabela criada em SQL em vez de em `backend/schema`, dados lidos e
gravados contornando o SDK, uma rota desprotegida, um deploy, um arquivo gerado editado)
são incluídas em cada ponteiro, de forma idêntica. Uma verificação no CI mantém as cinco
cópias iguais.

Vale a pena manter esse padrão se você fizer um fork da estrutura inicial (scaffold), e vale a pena adotá-lo em
repositórios que nem sequer são projetos Rebase.

## O que o `ai-instructions.md` contém inicialmente

O arquivo gerado na estrutura inicial é deliberadamente curto — ele aponta para
[`rebase skills install`](/docs/ai/skills) para mais detalhes e, em seguida, declara as regras que
os assistentes erram com frequência suficiente para valer a pena repeti-las no início de cada
sessão:

1. **Schema as code.** Uma tabela é um `defineTable` em `backend/schema/<table>.ts`,
   exportada de `backend/schema/index.ts` — somente o que o index exporta é
   servido — com um `rls` obrigatório. Nunca edite manualmente o schema gerado do Drizzle
   ou as tabelas do Postgres — consulte [Schema as Code](/docs/architecture/schema-as-code).
2. **Aplicar uma alteração de schema** depende do banco de dados. Enquanto o `pnpm dev`
   estiver em execução, salvar um arquivo em `backend/schema/` é a única etapa necessária: isso
   regenera o schema do Drizzle e os tipos do SDK, e a inicialização cria as
   tabelas e colunas ausentes. `pnpm db:push` serve apenas para o que a inicialização deliberadamente
   não altera — uma coluna renomeada, um tipo mais restrito, uma coluna removida — tanto no
   banco de dados de desenvolvimento gerenciado quanto no seu próprio PostgreSQL. Produção é
   `pnpm db:generate` e depois `pnpm db:migrate`.
3. **Use o SDK.** Acesse via `rebase.dataAsAdmin.<table>` para ações realizadas como
   a identidade de serviço, ou `getDriver(c)` dentro de uma function quando a leitura deve ser executada
   como o chamador. O cliente do servidor não tem um acessador `data` simples. SQL puro e chamadas
   diretas ao Drizzle ignoram validação, hooks e RLS.
4. **Proteja todas as rotas customizadas.** As rotas em `backend/functions/` são montadas
   *sem* autenticação. Use `requireAuth` / `requireAdmin` de
   `@rebasepro/server/functions` no próprio slot de middleware da rota — ler
   `c.get("user")` não é uma proteção, e nem `app.use()` após a rota.

Essa última é a mais importante. É a diferença entre um middleware que
executa e um que não executa, e um assistente que não foi avisado invariavelmente
escreverá a versão que não executa — consulte
[Custom Functions](/docs/backend/custom-functions).

`requireAdmin` aceita apenas a role `admin`. Quando uma role mais restrita ou uma chave de API
precisar chamar uma rota, a proteção a ser adicionada é `requireScope`, com um escopo
que a aplicação declara — consulte [Roles and scopes](/docs/backend/roles-and-scopes/#app-scopes).

Após as regras vêm duas seções que se aplicam apenas em alguns projetos. **Backend
runtime** lista o que o runtime gerenciado no Rebase Cloud permite: pacotes,
memória e estado no nível de módulo, timeouts, portas de saída, configuração e
armazenamento para arquivos gerados. Ele inclui um link para
[Managed backend runtime](/docs/deployment/managed-runtime/), para que um assistente
planeje um recurso de backend considerando limites reais em vez de adivinhar. **Admin UI**
contém as regras do `@rebasepro/ui` e o checklist para a etapa de `customizeTable` que
toda tabela precisa antes de o admin ser considerado concluído: um título, as colunas listadas, ids,
chaves estrangeiras e JSON bruto ocultos, rótulos, um resumo para colunas JSON e uma verificação
no admin em execução. As regras se aplicam a views dentro do painel de administração, e não a um
site público ou aplicação estática que o projeto serve.

## Personalizando para o seu projeto

`ai-instructions.md` é o seu arquivo. Nada o regenera ou sobrescreve — ao contrário das
[skills instaladas](/docs/ai/skills), que são substituídas a cada
`rebase skills install`. As convenções específicas do projeto devem ficar aqui.

Uma exceção, para um arquivo que ninguém tocou: o `ai-instructions.md` de um projeto
headless diz que o banco de dados é o schema e que não há
`backend/schema/`, e o comando `rebase schema introspect` cria exatamente esse
diretório. Quando o arquivo ainda for byte a byte aquele que a estrutura inicial criou,
a introspecção o substitui pelas regras de schema-as-code exclusivas do backend; assim que você
o editar, ele é mantido como está e o comando informa quais de suas regras deixaram
de ser válidas.

O que merece um lugar aqui é o que um assistente não consegue deduzir a partir do código: quais
tabelas são legadas, qual serviço é proprietário de qual tabela, a convenção de nomenclatura
que não é aplicada em nenhum lugar, a migration que não deve ser executada novamente. Mantenha-o
curto — instruções carregadas em cada requisição competem pela atenção com a tarefa real,
e um arquivo longo acaba sendo lido apenas superficialmente pelo assistente.

E lembre-se do limite de escopo: este arquivo molda o que um assistente *escreve*. Ele
não tem qualquer impacto sobre o que um agente conectado ao seu banco de dados pode *fazer* — isso é
determinado pelas credenciais que ele carrega, e nada no Markdown altera isso. Consulte
[o modelo de credenciais do servidor MCP](/docs/ai/mcp#what-the-server-can-reach).
