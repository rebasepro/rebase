---
sourceHash: ff7df07f90f558a9
title: Arquivos de Instruções de IA
sidebar_label: Arquivos de Instruções de IA
description: Todo projeto Rebase estruturado inclui ai-instructions.md mais arquivos de ponteiro de três linhas para Claude, Cursor, Windsurf, Copilot e AGENTS.md — uma única fonte de verdade, muitos nomes de arquivo.
---

Cada assistente busca suas regras em um arquivo diferente. O Claude Code lê
`CLAUDE.md`, o Cursor lê `.cursorrules`, o Windsurf lê `.windsurfrules`,
o Copilot lê `.github/copilot-instructions.md`, e a convenção multiplataforma
é `AGENTS.md`. Manter as mesmas orientações em cinco arquivos é o motivo pelo qual quatro deles
acabam desatualizados.

O `rebase init` cria todos os cinco — como **ponteiros para um único arquivo que você realmente
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

<span class="since-badge" data-since="0.24">Since 0.24</span> para esta terceira linha e o `.mcp.json` abaixo: na 0.23
a terceira linha apenas diz ao assistente para executar `rebase skills install --agent claude`,
e o `.mcp.json` inicia o servidor com `npx -y @rebasepro/mcp` a partir do registro.

Os demais diferem apenas no diretório de skills do agente e no seu valor de
`--agent` — `--agent cursor`, `--agent windsurf`, `--agent codex`,
`--agent copilot` — e no caminho relativo, que é `../ai-instructions.md` em
`.github/copilot-instructions.md` e `ai-instructions.md` em `AGENTS.md`. A
terceira linha é condicional porque o `rebase init --agent` já pode ter
instalado as skills antes que o assistente chegue a lê-la.

Isso acontece em todo `rebase init`, para todos os presets, incluindo `--headless`.
Não há nenhuma flag nem prompt.

O `rebase init` também escreve `.mcp.json`, que aponta o Claude Code, o Cursor
e qualquer outro cliente MCP para o [servidor MCP do Rebase](/pt/docs/ai/mcp) —
a própria cópia do projeto, uma devDependency fixada junto com a CLI
(`npx --no rebase-mcp` em um projeto npm):

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

`REBASE_PROJECT_DIR` é `"."`, não um caminho absoluto: o cliente inicia o
servidor na raiz do projeto, e um caminho absoluto é a única linha desse arquivo
que não pode ser commitada. Ele está ali porque `~/.rebase/projects.json` vale
para a máquina inteira — um projeto que não nomeia um diretório próprio acaba
usando o que o último projeto daquela máquina gravou. Veja
[a precedência](/pt/docs/ai/mcp#em-qual-diretório-ele-atua).

## Por que um ponteiro em vez de uma cópia

Os arquivos de ponteiro são deliberadamente sem conteúdo próprio. Os assistentes seguem links
relativos em Markdown, portanto, um arquivo de três linhas que aponta para o arquivo real obtém o mesmo resultado
que uma cópia — e possui propriedades que uma cópia não tem:

- **Um único arquivo para editar.** As regras não divergem entre os assistentes, porque há
  apenas um conjunto de regras.
- **Um único diff para revisar.** Uma alteração nas convenções do projeto é uma alteração em apenas um
  arquivo, e não em cinco arquivos idênticos que um revisor precisa comparar.
- **Adicionar um assistente leva três linhas.** Uma nova ferramenta com um novo nome de arquivo recebe um
  ponteiro, e não uma sexta cópia das suas convenções.

Vale a pena manter esse padrão se você fizer um fork da estrutura básica (scaffold), e vale a pena adotá-lo
mesmo em repositórios que não sejam projetos Rebase.

## Com o que o `ai-instructions.md` começa

O arquivo gerado é deliberadamente curto — ele aponta para
[`rebase skills install`](/docs/ai/skills) para mais detalhes e, em seguida, define as regras que
os assistentes erram com frequência suficiente para valer a pena repeti-las no início de cada
sessão:

1. **Schema as code.** As coleções são definidas em `config/collections/`. Nunca
   edite manualmente o schema gerado do Drizzle ou as tabelas do Postgres — consulte
   [Schema as Code](/docs/architecture/schema-as-code).
2. **Como uma mudança de coleção é aplicada depende do banco de dados.**
   Enquanto `pnpm dev` está rodando, salvar o arquivo da coleção é o passo
   inteiro: o boot regenera o schema do Drizzle e cria as tabelas e colunas que
   faltam. `pnpm db:push` serve apenas para o que o boot deliberadamente deixa em
   paz — uma coluna renomeada, um tipo mais estreito, um campo removido — e exige
   o seu próprio PostgreSQL, não o banco de dados de desenvolvimento gerenciado.
   Em produção o par é
   `pnpm db:generate` e depois `pnpm db:migrate`.
3. **Use o SDK.** Acesse via `rebase.dataAsAdmin.<slug>` para trabalho feito com a
   identidade do serviço, ou `getDriver(c)` dentro de uma função quando a leitura
   deve rodar como o chamador. No servidor o cliente não expõe um acessor `data` simples. SQL puro e chamadas diretas do Drizzle
   ignoram validações, callbacks e RLS.
4. **Proteja todas as rotas customizadas.** As rotas em `backend/functions/` são montadas
   *sem* autenticação. Use `requireAuth` / `requireAdmin` do
   `@rebasepro/server/functions` no próprio slot de middleware da rota — ler
   `c.get("user")` não é uma proteção, e `app.use()` após a rota também não.

Essa última regra é fundamental. Ela faz a diferença entre um middleware que
é executado e um que não é, e um assistente que não foi avisado invariavelmente
escreverá a versão que não executa — consulte
[Custom Functions](/docs/backend/custom-functions).

`requireAdmin` admite apenas o papel `admin`. Quando um papel mais restrito ou uma chave de API
deve poder chamar uma rota, a proteção a adicionar é `requireScope`, com um escopo
que o app declara — consulte [Papéis e escopos](/docs/backend/roles-and-scopes/#app-scopes).

## Tornando-o seu

O `ai-instructions.md` é o seu arquivo. Nada o regenera ou sobrescreve — ao contrário
das [skills instaladas](/docs/ai/skills), que são substituídas a cada
`rebase skills install`. Convenções específicas do projeto devem ficar aqui.

O que merece um lugar aqui é aquilo que um assistente não consegue inferir a partir do código: quais
coleções são legadas, qual serviço é dono de qual tabela, a convenção de nomenclatura
que não é aplicada em nenhum outro lugar, a migração que não deve ser executada novamente. Mantenha-o
curto — instruções carregadas em cada requisição competem pela atenção com a tarefa real,
e um arquivo longo é algo que o assistente lê superficialmente.

E tenha em mente os limites: este arquivo molda o que um assistente *escreve*. Ele
não tem qualquer impacto sobre o que um agente conectado ao seu banco de dados pode *fazer* — isso
é determinado pelas credenciais que ele possui, e nada no Markdown muda isso. Consulte
[o modelo de credenciais do servidor MCP](/docs/ai/mcp#what-the-server-can-reach).
