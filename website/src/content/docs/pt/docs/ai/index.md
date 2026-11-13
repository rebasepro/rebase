---
sourceHash: 4040537e5cc9b4d3
title: IA & Agentes
sidebar_label: Visão Geral
description: O que o Rebase oferece para assistentes de codificação de IA e agentes autônomos — um servidor MCP, agent skills locais do projeto, arquivos de instrução estruturados e o modelo de credenciais que decide o que um agente pode realmente acessar.
---

**Para usar o Claude com seus projetos Rebase, adicione o [conector Rebase](/docs/ai/rebase-connector/).**
No Claude, abra **Settings → Connectors → Add custom connector**, insira
`https://app.rebase.pro/mcp` e faça login com sua conta do Rebase. Seus projetos do
Rebase Cloud estarão disponíveis imediatamente; adicione cada servidor self-hosted uma vez com
`rebase cloud connect https://your-app.com`. Um único conector acessa todos eles.

Além disso, o Rebase oferece cinco recursos distintos para assistentes de IA, e eles resolvem
problemas diferentes. Vale a pena entender qual deles você precisa usar:

| | O que é | Quem consome |
|---|---|---|
| [**Rebase connector**](/docs/ai/rebase-connector) | Um conector MCP hospedado em `app.rebase.pro/mcp` para cada projeto que você executa, no Rebase Cloud ou self-hosted: dados, esquema, cron e, em deploys no Cloud, variáveis de ambiente (env) e logs | Claude na web, desktop e mobile, atuando como você |
| [**Servidor MCP**](/docs/ai/mcp) | Um servidor Model Context Protocol via stdio com 53 ferramentas sobre seu esquema, dados, usuários, armazenamento, cron, servidor de desenvolvimento e projeto do Rebase Cloud | Um assistente, em tempo de execução |
| [**Agent skills**](/docs/ai/skills) | 24 arquivos Markdown de skills gravados em seu repositório por `rebase skills install` | Um assistente, como material de referência |
| [**Arquivos de instrução**](/docs/ai/instruction-files) | `ai-instructions.md` mais arquivos de apontamento por assistente, gravados por `rebase init` | Um assistente, como regras sempre ativas |
| [**Chaves de API**](/docs/backend/api-keys) | Credenciais de máquina contendo [escopos](/docs/backend/roles-and-scopes), por tabela e por operação | Qualquer coisa que chame a API HTTP |

Os quatro primeiros têm a ver com dar *conhecimento* e *ferramentas* a um assistente. O
quinto é o único que decide o que ele pode realmente fazer.

## A parte que importa: o que um agente pode acessar

Um agente com ferramentas sobre o seu banco de dados é um chamador de API comum que
por acaso decide sua própria próxima requisição. O Rebase não tenta restringi-lo com
instruções — um prompt não é um mecanismo de controle de acesso, e um agente que
lê suas linhas está lendo texto que outra pessoa pode ter escrito. A
restrição deve residir abaixo do agente, na credencial que ele carrega.

O Rebase fornece a essa credencial duas barreiras independentes:

1. **Os escopos da chave.** Declarados por operação *e*, quando você desejar, por
   tabela: `data:read:articles`, `data:write:articles`. `data:delete` é
   separado de `data:write`, que geralmente é o escopo que você deseja reter
   de um agente que, de outra forma, teria permissão para editar.
2. **Row-Level Security (RLS).** Chaves de API não ignoram o RLS. Uma chave se conecta como a
   role `rebase_user` do Postgres como qualquer outro chamador, de modo que suas políticas ainda
   decidem quais linhas retornam.

Ambos devem permitir a requisição. Nenhum substitui o outro, e o segundo
é a razão pela qual uma chave que possui `data:read` em todas as tabelas ainda pode retornar
um conjunto de resultados vazio.

Um ponto que costuma confundir as pessoas: o `access: "public"` de uma tabela amplia **quais
linhas um chamador pode ver**, não **quem pode chamar**. É uma declaração sobre a visibilidade
de linhas, não sobre autenticação. Concedê-lo não dá um escopo a uma chave,
e retê-lo não bloqueia uma chave que o tenha.

O funcionamento prático — criação de chaves, escolha de escopos, rotação, expiração,
limites de taxa (rate limits) — é abordado em [Chaves de API](/docs/backend/api-keys).
Não deixe de conferir [Regras de Segurança (RLS)](/docs/collections/security-rules);
a segunda barreira é tão eficaz quanto as políticas que você escreveu.

:::caution[O servidor MCP não usa por padrão uma chave com escopo]
O modelo de duas barreiras acima descreve o que uma chave de API faz. **Não** é o que o
`@rebasepro/mcp` usa, a menos que você o configure para isso. Por padrão, o servidor MCP
autentica-se com a **chave de serviço** do seu servidor de desenvolvimento — uma credencial de administrador
sem escopos restritos que satisfaz as políticas padrão de admin em todas as tabelas. Consulte
[O que o servidor MCP pode acessar](/docs/ai/mcp#what-the-server-can-reach)
antes de apontar um assistente para qualquer coisa importante.
:::

## Busca vetorial

O Rebase possui um tipo de propriedade nativo `vector` no Postgres e um
método de consulta `.vectorSearch()` com distância `cosine`, `l2` e `inner_product`.
Isso já está documentado, em dois lugares:

- [Consultando Dados → Busca Vetorial](/docs/sdk/aggregates-and-search#vector-search) — o método
  do SDK, o campo `_distance` adicionado a cada linha e as ressalvas
- [API REST → Busca Vetorial](/docs/backend/api#vector-search) — os
  parâmetros de consulta `vector_search`, `vector`, `vector_distance` e `vector_threshold`

Três coisas a saber antes de projetar em torno disso. **O Rebase armazena e busca
embeddings; ele não os calcula** — não há nenhum provedor de embeddings, configuração
de modelo ou chave de API no Rebase, portanto, gerar os vetores é sua responsabilidade.
**O pgvector é um pré-requisito e sua instalação é opcional.**
`database({ extensions: ["vector"] })` em `backend/resources.ts` permite que o `rebase db push`
e a verificação de esquema de inicialização executem `CREATE EXTENSION IF NOT EXISTS vector` para
você; sem isso, eles criam a coluna e deixam a extensão por sua conta. De qualquer
forma, o servidor precisa de uma imagem contendo a biblioteca e de uma role com permissão para instalá-la.
E **toda coluna de vetor recebe um índice HNSW para
distância de cosseno**, pois cosseno é o que o `vectorSearch` mede, a menos
que você passe `distance` — um índice atende exatamente a um operador. Ajuste-o ou desative-o
na propriedade: consulte [O índice](/docs/sdk/aggregates-and-search#the-index).

Consultas vetoriais também não podem ser assinadas; `.vectorSearch(...).listen()`
é recusado com `VECTOR_SEARCH_NOT_LIVE`.

Para busca lexical — busca textual ranqueada (full-text) sobre os campos especificados, incluindo
conteúdo JSONB e arrays — consulte [Busca](/docs/backend/search). É um
mecanismo diferente e os dois não interagem.

## Próximos passos

- [Rebase connector](/docs/ai/rebase-connector) — Claude conectado a todos os projetos que você executa
- [Servidor MCP](/docs/ai/mcp) — conecte o Claude Code, Cursor ou qualquer cliente MCP
- [Agent Skills](/docs/ai/skills) — `rebase skills install` e as 24 skills
- [Arquivos de Instrução de IA](/docs/ai/instruction-files) — o padrão de regras estruturadas
