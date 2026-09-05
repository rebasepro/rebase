---
title: Arquivos de Instruções de IA
sidebar_label: Arquivos de Instruções de IA
description: Todo projeto Rebase estruturado inclui ai-instructions.md mais arquivos de ponteiro de uma linha para Claude, Cursor, Windsurf, Copilot e AGENTS.md — uma única fonte de verdade, muitos nomes de arquivo.
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

Cada arquivo de ponteiro tem duas linhas:

```markdown title="CLAUDE.md"
# Rebase AI Rules
Please refer to and follow the instructions defined in [ai-instructions.md](./ai-instructions.md).
```

O `.github/copilot-instructions.md` é idêntico, exceto pelo caminho relativo
(`../ai-instructions.md`).

Isso acontece em todo `rebase init`, para todos os presets, incluindo `--headless`.
Não há nenhuma flag nem prompt.

## Por que um ponteiro em vez de uma cópia

Os arquivos de ponteiro são deliberadamente sem conteúdo próprio. Os assistentes seguem links
relativos em Markdown, portanto, um arquivo de duas linhas que aponta para o arquivo real obtém o mesmo resultado
que uma cópia — e possui propriedades que uma cópia não tem:

- **Um único arquivo para editar.** As regras não divergem entre os assistentes, porque há
  apenas um conjunto de regras.
- **Um único diff para revisar.** Uma alteração nas convenções do projeto é uma alteração em apenas um
  arquivo, e não em cinco arquivos idênticos que um revisor precisa comparar.
- **Adicionar um assistente leva duas linhas.** Uma nova ferramenta com um novo nome de arquivo recebe um
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
2. **Migrações são feitas em duas etapas.** `rebase schema generate`, depois `rebase db push`
   em desenvolvimento, ou `rebase db generate && rebase db migrate` para produção.
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

---
