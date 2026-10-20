---
sourceHash: 5dd46da9d88b962e
title: Arquivos de Instruções de IA
sidebar_label: Arquivos de Instruções de IA
description: Todo projeto Rebase estruturado inclui o ai-instructions.md mais arquivos de ponteiro de três linhas para Claude, Cursor, Windsurf, Copilot e AGENTS.md — uma única fonte de verdade, muitos nomes de arquivo.
---

Cada assistente quer suas regras em um arquivo diferente. O Claude Code lê
`CLAUDE.md`, o Cursor lê `.cursorrules`, o Windsurf lê `.windsurfrules`,
o Copilot lê `.github/copilot-instructions.md`, e a convenção entre fornecedores
é `AGENTS.md`. Manter as mesmas orientações em cinco arquivos é a maneira como quatro deles
acabam desatualizados.

O `rebase init` grava todos os cinco — como **ponteiros para um único arquivo que você realmente
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

Cada arquivo de ponteiro tem três linhas:

```markdown title="CLAUDE.md"
# Rebase AI Rules
Please refer to and follow the instructions defined in [ai-instructions.md](./ai-instructions.md).
The Rebase skills for this assistant live in `.claude/skills/`. If they are not there yet, install them, with the Rebase MCP server: `rebase skills install --agent claude --mcp`.
```

Na versão 0.23, a terceira linha apenas diz ao assistente para executar
`rebase skills install --agent claude`, e o `.mcp.json` abaixo inicia o
servidor com `npx -y @rebasepro/mcp` a partir do registro.

Os outros diferem apenas no diretório de skills do agente e no seu valor `--agent` —
`--agent cursor`, `--agent windsurf`, `--agent codex`, `--agent copilot` — e no
caminho relativo, que é `../ai-instructions.md` em
`.github/copilot-instructions.md` e `ai-instructions.md` em `AGENTS.md`. A
terceira linha é condicional porque o `rebase init --agent` já pode ter
instalado as skills antes mesmo de o assistente lê-la.

Isso acontece em todo `rebase init`, para todo preset, incluindo `--headless`.
Não há flag e nem prompt.

O `rebase init` também cria o `.mcp.json`, que aponta o Claude Code, Cursor e
qualquer outro cliente MCP para o [servidor MCP do Rebase](/docs/ai/mcp) — a
cópia própria do projeto, uma devDependency fixada com a CLI (`npx --no rebase-mcp` em um
projeto npm):

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
não pode ser commitada. Ele está lá porque `~/.rebase/projects.json` é
de âmbito global da máquina — um projeto que não especifica um diretório próprio recorre
ao que quer que o último projeto nessa máquina tenha persistido. Consulte
[a precedência](/docs/ai/mcp#which-directory-it-acts-on).

## Por que um ponteiro em vez de uma cópia

Os arquivos de ponteiro são deliberadamente vazios de conteúdo. Os assistentes seguem links
relativos em Markdown, portanto, um arquivo de três linhas que aponta para o verdadeiro obtém o mesmo resultado
que uma cópia — e possui propriedades que uma cópia não tem:

- **Um arquivo para editar.** As regras não divergem entre os assistentes, porque há
  apenas um conjunto de regras.
- **Um diff para revisar.** Uma alteração nas convenções do projeto é uma alteração em um
  único arquivo, e não em cinco arquivos idênticos que um revisor precisa comparar.
- **Adicionar um assistente requer três linhas.** Uma nova ferramenta com um novo nome de arquivo recebe um
  ponteiro, e não uma sexta cópia das suas convenções.

Vale a pena manter esse padrão se você fizer um fork do scaffold, e vale a pena adotá-lo em
repositórios que nem sequer são projetos Rebase.

## Com o que o `ai-instructions.md` começa

O arquivo gerado é deliberadamente curto — ele aponta para
[`rebase skills install`](/docs/ai/skills) para mais detalhes e, em seguida, declara as regras que os
assistentes erram com frequência suficiente para valer a pena repeti-las no início de cada
sessão:

1. **Schema as code.** As collections são definidas em `config/collections/`. Nunca
   edite manualmente o schema Drizzle gerado ou as tabelas do Postgres — consulte
   [Schema as Code](/docs/architecture/schema-as-code).
2. **Aplicar uma alteração de collection** depende do banco de dados. Enquanto o `pnpm dev`
   estiver em execução, salvar o arquivo da collection é o único passo: a inicialização regenera o
   schema Drizzle e cria as tabelas e colunas ausentes. O `pnpm db:push` serve
   apenas para o que a inicialização deliberadamente não altera — uma coluna renomeada, um tipo
   restringido, um campo removido — tanto no banco de dados de desenvolvimento gerenciado quanto no seu
   próprio PostgreSQL. Produção é `pnpm db:generate` seguido de `pnpm db:migrate`.
   Na versão 0.24, o
   `pnpm db:push` precisa do seu próprio PostgreSQL, e o arquivo especifica isso.
3. **Use o SDK.** Utilize `rebase.dataAsAdmin.<slug>` para operações feitas como a
   identidade do serviço, ou `getDriver(c)` dentro de uma function quando a leitura deve ser executada
   como o chamador. O cliente do servidor não possui um acessador `data` simples. SQL puro e chamadas
   diretas do Drizzle ignoram validação, callbacks e RLS.
4. **Proteja toda rota customizada.** Rotas em `backend/functions/` são montadas
   *sem* autenticação. Use `requireAuth` / `requireAdmin` de
   `@rebasepro/server/functions` no slot de middleware da própria rota — ler
   `c.get("user")` não é uma proteção, e nem `app.use()` após a rota.

Essa última é fundamental. É a diferença entre um middleware que
executa e um que não executa, e um assistente que não foi instruído certamente
escreverá a versão que não executa — consulte
[Custom Functions](/docs/backend/custom-functions).

O `requireAdmin` aceita apenas o papel `admin`. Quando uma role mais restrita ou uma chave de API
deve poder chamar uma rota, a proteção a ser adicionada é `requireScope`, com um escopo
declarado pela aplicação — consulte [Roles and scopes](/docs/backend/roles-and-scopes/#app-scopes).

Após as regras vêm duas seções que se aplicam apenas em alguns projetos. O **Backend
runtime** lista o que o runtime gerenciado no Rebase Cloud permite: pacotes,
memória e estado em nível de módulo, limites de tempo (timeouts), portas de saída, configuração e
armazenamento para arquivos gerados. Ele inclui um link para
[Managed backend runtime](/docs/deployment/managed-runtime/), para que um assistente
planeje um recurso de backend considerando limites reais em vez de adivinhações. O **Admin UI**
contém as regras do `@rebasepro/ui`. Elas se aplicam a views dentro do painel de administração, e não
a um site público ou aplicativo estático servido pelo projeto.

## Tornando-o seu

O `ai-instructions.md` é o seu arquivo. Nada o regenera ou sobrescreve — ao contrário
das [skills instaladas](/docs/ai/skills), que são substituídas a cada
`rebase skills install`. Convenções específicas do projeto devem ficar aqui.

O que merece um lugar aqui é o que um assistente não consegue inferir a partir do código: quais
collections são legadas, qual serviço é proprietário de qual tabela, a convenção de nomenclatura
que não é aplicada em nenhum lugar, a migration que não deve ser executada novamente. Mantenha-o
curto — instruções carregadas em cada requisição competem pela atenção do assistente com
a tarefa real, e um arquivo longo é algo que um assistente apenas passa os olhos.

E tenha em mente os limites: este arquivo molda o que um assistente *escreve*. Ele
não tem influência sobre o que um agente conectado ao seu banco de dados pode *fazer* — isso
é decidido pela credencial que ele carrega, e nada no Markdown muda isso. Consulte
[o modelo de credenciais do servidor MCP](/docs/ai/mcp#what-the-server-can-reach).
