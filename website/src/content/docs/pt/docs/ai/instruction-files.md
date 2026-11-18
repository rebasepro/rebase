---
sourceHash: 4f52b1da35febe8d
title: Arquivos de Instrução para IA
sidebar_label: Arquivos de Instrução para IA
description: Todo projeto Rebase estruturado inclui ai-instructions.md mais arquivos de ponteiro para Claude, Cursor, Windsurf, Copilot e AGENTS.md que contêm as cinco regras que os assistentes mais quebram — uma única fonte de verdade, muitos nomes de arquivo.
---

Cada assistente quer suas regras em um arquivo diferente. O Claude Code lê
`CLAUDE.md`, o Cursor lê `.cursorrules`, o Windsurf lê `.windsurfrules`,
o Copilot lê `.github/copilot-instructions.md`, e a convenção entre diferentes fornecedores
é o `AGENTS.md`. Manter as mesmas orientações em cinco arquivos é a receita para que quatro deles
fiquem desatualizados.

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

Cada arquivo de ponteiro indica o arquivo real, informa onde as skills residem e traz as cinco regras que um assistente não deve quebrar, mesmo que nunca abra mais nada:

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
- **An admin, back-office or internal tool is built in the Rebase admin, never as a new app.** A dashboard, a review queue, a staff screen or a settings page is a custom view, the home page, a record tab or an action in `frontend/` (ai-instructions.md, "Admin UI", says how). A separate app is only for what the project's own users see.
- **When Rebase cannot do what the task needs, tell the human** what is missing instead of working around it.
```

Os outros diferem apenas no diretório de skills do agente e em seu valor `--agent` —
`--agent cursor`, `--agent windsurf`, `--agent codex`, `--agent copilot` — e no
caminho relativo, que é `../ai-instructions.md` em
`.github/copilot-instructions.md` e `ai-instructions.md` em `AGENTS.md`. A
terceira linha é condicional porque `rebase init --agent` pode já ter
instalado as skills antes mesmo de o assistente lê-las.

Isso acontece em cada `rebase init`, para todos os presets, incluindo `--headless`.
Não há flag nem prompt de confirmação.

O `rebase init` também grava o `.mcp.json`, que aponta o Claude Code, o Cursor e
qualquer outro cliente MCP para o [servidor MCP do Rebase](/docs/ai/mcp) — a cópia
do próprio projeto, uma devDependency fixada com a CLI (`npx --no rebase-mcp` em um projeto
npm):

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
não pode ser commitada. Ele está lá porque `~/.rebase/projects.json` tem escopo
em toda a máquina — um projeto que não especifica seu próprio diretório recorre a
qualquer coisa que o último projeto nessa máquina tenha persistido. Veja
[a precedência](/docs/ai/mcp#which-directory-it-acts-on).

## Por que um ponteiro em vez de uma cópia

Os arquivos de ponteiro quase não contêm nada. Um arquivo que referencia o arquivo real mantém as
convenções em um único lugar e possui propriedades que uma cópia não tem:

- **Um único arquivo para editar.** As regras não divergem entre os assistentes, pois existe
  apenas um conjunto de regras.
- **Um único diff para revisar.** Uma alteração nas convenções do projeto é uma alteração em um
  arquivo, não em cinco idênticos que um revisor precisa comparar.
- **Adicionar um assistente é apenas um arquivo pequeno.** Uma nova ferramenta com um novo nome de arquivo recebe
  um ponteiro, e não uma sexta cópia das suas convenções.

A única exceção é o bloco **Before you write any code**. Um assistente nem
sempre segue links de maneira confiável: um assistente ocupado com uma tarefa escreve o código primeiro,
e um assistente iniciado na raiz de um repositório cujo projeto Rebase fica em uma
subpasta nunca carrega esses arquivos. Portanto, as cinco regras cuja quebra causa
o maior estrago (uma tabela criada em SQL em vez de em `backend/schema`, dados lidos e
gravados contornando o SDK, uma rota desprotegida, um deploy, um arquivo gerado editado)
são gravadas em cada ponteiro, de forma idêntica. Uma verificação no CI mantém as cinco
cópias iguais.

Vale a pena manter esse padrão se você fizer um fork do scaffold, e vale a pena adotá-lo em
repositórios que nem sequer são projetos Rebase.

## O que vem inicialmente no `ai-instructions.md`

O arquivo gerado pelo scaffold é deliberadamente curto — ele aponta para
[`rebase skills install`](/docs/ai/skills) para mais detalhes e, em seguida, declara as regras que os
assistentes erram com frequência suficiente para que valha a pena repeti-las no início de cada
sessão:

1. **Schema como código.** Uma tabela é um `defineTable` em `backend/schema/<table>.ts`,
   exportada de `backend/schema/index.ts` — somente o que o index exporta é
   disponibilizado — com um `rls` obrigatório. Nunca edite manualmente o schema Drizzle gerado
   nem as tabelas do Postgres — veja [Schema como Código](/docs/architecture/schema-as-code).
2. **Aplicar uma alteração de schema** depende do banco de dados. Enquanto o `pnpm dev`
   estiver em execução, salvar um arquivo em `backend/schema/` é tudo o que você precisa fazer: isso
   regenera o schema do Drizzle e os tipos do SDK, e a inicialização cria as
   tabelas e colunas ausentes. `pnpm db:push` serve apenas para o que a inicialização deliberadamente
   não altera — uma coluna renomeada, um tipo restringido, uma coluna removida — tanto no
   banco de dados de desenvolvimento gerenciado quanto no seu próprio PostgreSQL. Em produção,
   usa-se `pnpm db:generate` seguido de `pnpm db:migrate`.
3. **Use o SDK.** Acesse via `rebase.dataAsAdmin.<table>` para operações realizadas como a
   identidade do serviço, ou `getDriver(c)` dentro de uma função quando a leitura deve ser executada
   como o chamador. O cliente do servidor não tem um acessor `data` simples. SQL puro e chamadas
   diretas ao Drizzle contornam validações, hooks e RLS.
4. **Proteja todas as rotas personalizadas.** As rotas em `backend/functions/` são montadas
   *sem* autenticação. Use `requireAuth` / `requireAdmin` de
   `@rebasepro/server/functions` no slot de middleware da própria rota — ler
   `c.get("user")` não é uma proteção, e `app.use()` após a rota também não é.

Essa última é fundamental. É a diferença entre um middleware que
é executado e um que não é, e um assistente que não foi avisado invariavelmente
escreverá a versão que não funciona — veja
[Funções Personalizadas](/docs/backend/custom-functions).

`requireAdmin` permite apenas o papel `admin`. Quando um papel mais restrito ou uma chave de API
precisar chamar uma rota, a proteção a ser adicionada é `requireScope`, com um escopo
declarado pela aplicação — veja [Papéis e escopos](/docs/backend/roles-and-scopes/#app-scopes).

Após as regras, há duas seções que se aplicam apenas a alguns projetos. **Backend
runtime** lista o que o runtime gerenciado no Rebase Cloud permite: pacotes,
memória e estado em nível de módulo, tempos limites (timeouts), portas de saída, configuração e
armazenamento para arquivos gerados. Há um link para
[Runtime de backend gerenciado](/docs/deployment/managed-runtime/), para que o assistente
planeje um recurso de backend considerando limites reais em vez de adivinhações. **Admin UI**
contém as regras do `@rebasepro/ui`. Elas se aplicam a views dentro do painel administrativo, e não
a um site público ou aplicação estática servida pelo projeto.

## Tornando-o seu

O `ai-instructions.md` é o seu arquivo. Nada o regenera ou o sobrescreve — diferentemente das
[skills instaladas](/docs/ai/skills), que são substituídas a cada
`rebase skills install`. As convenções específicas do projeto devem ficar aqui.

O que merece um lugar aqui é o que um assistente não consegue inferir a partir do código: quais
tabelas são legadas, qual serviço é responsável por qual tabela, convenções de nomenclatura
que não são impostas em lugar nenhum, a migration que não deve ser executada novamente. Mantenha-o
curto — instruções carregadas em cada requisição competem pela atenção do modelo com a tarefa real,
e um arquivo longo é algo que o assistente apenas lê por cima.

E lembre-se do limite: este arquivo molda o que um assistente *escreve*. Ele
não tem nenhuma influência sobre o que um agente conectado ao seu banco de dados pode *fazer* — isso
é definido pelas credenciais que ele possui, e nada no Markdown pode mudar isso. Veja
[o modelo de credenciais do servidor MCP](/docs/ai/mcp#what-the-server-can-reach).
