---
sourceHash: c0c8ce9c6155d171
title: IA e Agentes
sidebar_label: Visão Geral
description: O que o Rebase oferece para assistentes de programação com IA e agentes autônomos — um servidor MCP, skills de agentes locais do projeto, arquivos de instruções gerados e o modelo de credenciais que decide o que um agente pode realmente acessar.
---

**Para usar o Claude com seus projetos Rebase, adicione o [conector do Rebase](/docs/ai/rebase-connector/).**
No Claude, abra **Settings → Connectors → Add custom connector**, insira
`https://app.rebase.pro/mcp` e faça login com sua conta do Rebase. Seus projetos
do Rebase Cloud aparecerão imediatamente; adicione cada servidor self-hosted uma única vez com
`rebase cloud connect https://your-app.com`. Um único conector acessa todos eles.

Além disso, o Rebase disponibiliza cinco recursos distintos para assistentes de IA, e eles resolvem
problemas diferentes. Vale a pena saber qual deles você está buscando:

| | O que é | Quem consome |
|---|---|---|
| [**Conector do Rebase**](/docs/ai/rebase-connector) | Um conector MCP hospedado em `app.rebase.pro/mcp` para cada projeto que você executa, no Rebase Cloud ou self-hosted: dados, schema, cron e, em deploys no Cloud, variáveis de ambiente (env) e logs | Claude na web, desktop e mobile, atuando como você |
| [**Servidor MCP**](/docs/ai/mcp) | Um servidor Model Context Protocol via stdio com 53 ferramentas sobre seu schema, dados, usuários, storage, cron, servidor de desenvolvimento e projeto do Rebase Cloud | Um assistente, em tempo de execução |
| [**Skills de agentes**](/docs/ai/skills) | 24 arquivos de skill em Markdown gravados no seu repositório por `rebase skills install` | Um assistente, como material de referência |
| [**Arquivos de instrução**](/docs/ai/instruction-files) | `ai-instructions.md` mais arquivos de apontamento por assistente, criados pelo `rebase init` | Um assistente, como regras sempre ativas |
| [**Chaves de API**](/docs/backend/api-keys) | Credenciais de máquina contendo [escopos](/docs/backend/roles-and-scopes), por coleção e por operação | Qualquer chamada à API HTTP |

Os quatro primeiros têm a ver com dar *conhecimento* e *ferramentas* a um assistente. O
quinto é o único que decide o que ele pode realmente fazer.

## A parte que importa: o que um agente pode acessar

Um agente com ferramentas sobre o seu banco de dados é um consumidor de API comum que
simplesmente decide sua própria próxima requisição. O Rebase não tenta limitá-lo com
instruções — um prompt não é um mecanismo de controle de acesso, e um agente que
lê suas linhas está lendo texto que outra pessoa pode ter escrito. A
restrição precisa existir abaixo do agente, na credencial que ele carrega.

O Rebase fornece a essa credencial dois pontos de controle independentes:

1. **Os escopos da chave.** Declarados por operação *e*, quando você quiser, por
   coleção: `data:read:articles`, `data:write:articles`. `data:delete` é
   separado de `data:write`, que geralmente é o que você deseja reter
   de um agente que, de outra forma, teria permissão para editar.
2. **Row-Level Security (RLS).** Chaves de API não ignoram o RLS. Uma chave se conecta como a
   role do Postgres `rebase_user` assim como qualquer outro chamador, portanto suas políticas ainda
   decidem quais linhas são retornadas.

Ambos precisam autorizar uma requisição. Nenhum substitui o outro, e o segundo
é a razão pela qual uma chave com `data:read` em todas as coleções ainda pode retornar
um conjunto de resultados vazio.

Um ponto que costuma gerar dúvidas: o `access: "public"` de uma coleção amplia **quais
linhas um chamador pode ver**, não **quem pode chamar**. Trata-se de uma declaração sobre
visibilidade de linhas, não sobre autenticação. Concedê-lo não dá um escopo a uma chave,
e restringi-lo não impede um.

A mecânica — criação de chaves, escolha de escopos, rotação, expiração, limites
de taxa (rate limits) — é abordada em [Chaves de API](/docs/backend/api-keys).
Não deixe de conferir [Regras de Segurança (RLS)](/docs/collections/security-rules);
o segundo ponto de controle é tão bom quanto as políticas que você escreveu.

:::caution[O servidor MCP não utiliza por padrão uma chave com escopo]
O modelo de dois pontos de controle descrito acima representa o que uma chave de API faz. **Não** é o que
o `@rebasepro/mcp` usa, a menos que você o configure para isso. Por padrão, o servidor MCP
se autentica com a **service key** do seu servidor de desenvolvimento — uma credencial de administração
sem restrição de escopo que atende às políticas de administração padrão em todas as coleções. Veja
[O que o servidor MCP pode acessar](/docs/ai/mcp#what-the-server-can-reach)
antes de apontar um assistente para qualquer coisa importante.
:::

## Busca vetorial

O Rebase possui um tipo de propriedade nativo `vector` no Postgres e um
método de consulta `.vectorSearch()` com distância `cosine`, `l2` e `inner_product`.
Isso já está documentado, em dois lugares:

- [Consultando Dados → Busca Vetorial](/docs/sdk/aggregates-and-search#vector-search) — o método
  do SDK, o campo `_distance` que ele adiciona a cada linha e as ressalvas
- [API REST → Busca Vetorial](/docs/backend/api#vector-search) — os parâmetros
  de consulta `vector_search`, `vector`, `vector_distance` e `vector_threshold`

Três coisas a saber antes de planejar sua arquitetura em torno disso: **O Rebase armazena e busca
embeddings; ele não os calcula** — não há nenhum provedor de embeddings, configuração de
modelo ou chave de API dentro do Rebase, portanto gerar os vetores é tarefa sua.
**O pgvector é um pré-requisito e sua instalação é opcional.**
`database({ extensions: ["vector"] })` em `config/resources.ts` permite que o `rebase db
push` e a validação do schema na inicialização executem `CREATE EXTENSION IF NOT EXISTS vector` para
você; sem isso, eles criam a coluna e deixam a extensão por sua conta. De qualquer
forma, o servidor precisa de uma imagem contendo a biblioteca e uma role com permissão para instalá-la.
E **toda coluna vetorial recebe um índice HNSW para
distância de cosseno**, pois cosseno é o que o `vectorSearch` utiliza para medir, a menos
que você informe `distance` — um índice atende a exatamente um operador. Ajuste-o, ou desative-o,
na propriedade: veja [O índice](/docs/sdk/aggregates-and-search#the-index).

Consultas vetoriais também não aceitam subscriptions em tempo real; `.vectorSearch(...).listen()` é
recusado com `VECTOR_SEARCH_NOT_LIVE`.

Para busca léxica — full-text ranqueada sobre os campos que você especificar, incluindo conteúdo
JSONB e arrays — veja [Busca](/docs/backend/search). É um mecanismo
diferente e os dois não interagem.

## Para onde ir agora

- [Conector do Rebase](/docs/ai/rebase-connector) — Claude, conectado a todos os projetos que você executa
- [Servidor MCP](/docs/ai/mcp) — conecte o Claude Code, Cursor ou qualquer cliente MCP
- [Skills de agentes](/docs/ai/skills) — `rebase skills install` e as 24 skills
- [Arquivos de instrução de IA](/docs/ai/instruction-files) — o padrão de regras geradas
