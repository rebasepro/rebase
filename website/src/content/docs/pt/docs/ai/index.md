---
sourceHash: ec9977f5b00dc133
title: IA & Agentes
sidebar_label: Visão Geral
description: O que o Rebase oferece para assistentes de programação com IA e agentes autônomos — um servidor MCP, skills de agente locais no projeto, arquivos de instrução estruturados e o modelo de credenciais que decide o que um agente pode realmente acessar.
---

O Rebase oferece quatro recursos distintos para assistentes de IA, e eles resolvem
problemas diferentes. Vale a pena saber qual deles você está buscando:

| | O que é | Quem consome |
|---|---|---|
| [**Servidor MCP**](/docs/ai/mcp) | Um servidor Model Context Protocol via stdio com 42 ferramentas para seu schema, dados, usuários, storage, cron e servidor de desenvolvimento | Um assistente, em tempo de execução |
| [**Agent skills**](/docs/ai/skills) | 21 arquivos de skill em Markdown gravados no seu repositório por `rebase skills install` | Um assistente, como material de referência |
| [**Arquivos de instrução**](/docs/ai/instruction-files) | `ai-instructions.md` mais arquivos de apontamento por assistente, gravados por `rebase init` | Um assistente, como regras ativas contínuas |
| [**Chaves de API**](/docs/backend/api-keys) | Credenciais de máquina com escopo delimitado, por collection e por operação | Qualquer chamada para a API HTTP |

Os três primeiros servem para fornecer ao assistente *conhecimento* e *ferramentas*. O
quarto é o único que decide o que ele pode de fato fazer.

## A parte que importa: o que um agente pode manipular

Um agente com ferramentas sobre o seu banco de dados é um chamador de API comum que
por acaso decide sua própria próxima requisição. O Rebase não tenta limitá-lo com
instruções — um prompt não é um mecanismo de controle de acesso, e um agente que
lê suas linhas está lendo texto que qualquer outra pessoa pode ter escrito. A
restrição precisa existir abaixo do agente, na credencial que ele carrega.

O Rebase aplica a essa credencial duas barreiras independentes:

1. **A lista de permissões da chave de API.** Declarada por collection *e* por operação,
   onde `delete` é separável de `write` — que geralmente é a permissão que você deseja
   reter de um agente que, de outra forma, teria permissão para editar.
2. **Row-Level Security (RLS).** As chaves de API não ignoram o RLS. Uma chave se conecta como a
   role Postgres `rebase_user` como qualquer outro chamador, de modo que suas políticas ainda
   decidem quais linhas retornam.

Ambas precisam permitir a requisição. Nenhuma substitui a outra, e a segunda
é a razão pela qual uma chave com permissões `"*"` ainda pode retornar um conjunto
de resultados vazio.

Um detalhe que confunde muitos: o parâmetro `access: "public"` de uma collection expande **quais
linhas um chamador pode ver**, não **quem pode chamar**. Trata-se de uma declaração sobre
visibilidade de linhas, não sobre autenticação. Concedê-lo não adiciona um chamador à
lista de permissões, e retê-lo não bloqueia um chamador.

O funcionamento prático — criação de chaves, o JSON de permissões, rotação, expiração,
rate limits — é abordado em [REST API → Chaves de API](/docs/backend/api-keys).
Não deixe de consultar [Regras de Segurança (RLS)](/docs/collections/security-rules);
a segunda barreira só é tão eficaz quanto as políticas que você escreveu.

:::caution[O servidor MCP não usa uma chave delimitada por padrão]
O modelo de duas barreiras acima descreve o comportamento de uma chave de API. Ele **não** é o que
o `@rebasepro/mcp` usa, a menos que você o configure para isso. Por padrão, o servidor MCP
se autentica com a **service key** do seu servidor de desenvolvimento — uma credencial de admin
sem restrição de escopo que satisfaz as políticas padrão de admin em todas as collections. Veja
[O que o servidor MCP pode acessar](/docs/ai/mcp#what-the-server-can-reach)
antes de apontar um assistente para qualquer dado importante.
:::

## Busca vetorial (Vector search)

O Rebase possui um tipo de propriedade `vector` nativo no Postgres e um
método de consulta `.vectorSearch()` com distâncias `cosine`, `l2` e `inner_product`.
Isso já está documentado em dois locais:

- [Consultando Dados → Busca Vetorial](/docs/sdk/aggregates-and-search#vector-search) — o método
  do SDK, o campo `_distance` adicionado a cada linha e as ressalvas
- [REST API → Busca Vetorial](/docs/backend/api#vector-search) — os parâmetros de
  consulta `vector_search`, `vector`, `vector_distance` e `vector_threshold`

Três pontos a saber antes de planejar sua arquitetura: **O Rebase armazena e busca
embeddings; ele não os calcula** — não há provedor de embeddings, configuração
de modelo ou chave de API dentro do Rebase, portanto a geração dos vetores é sua responsabilidade.
**O pgvector é um pré-requisito, e a instalação é opcional (opt-in).**
`database({ extensions: ["vector"] })` em `config/resources.ts` permite que o `rebase db
push` e a validação de schema na inicialização executem `CREATE EXTENSION IF NOT EXISTS vector` para
você; sem isso, eles criam a coluna e deixam a extensão sob sua responsabilidade. De qualquer
forma, o servidor precisa de uma imagem contendo a biblioteca e uma role com permissão para instalá-la.
E **toda coluna vetorial recebe um índice HNSW para
distância de cosseno**, pois cosseno é o que o `vectorSearch` utiliza a menos
que você informe `distance` — um índice atende a exatamente um operador. Ajuste-o, ou
desative-o, na propriedade: veja [O índice](/docs/sdk/aggregates-and-search#the-index).

Consultas vetoriais também não suportam subscrições em tempo real; `.vectorSearch(...).listen()`
é recusado com `VECTOR_SEARCH_NOT_LIVE`.

Para busca lexical — busca full-text ranqueada nos campos informados, incluindo JSONB
e conteúdo de arrays — consulte [Busca](/docs/backend/search). Trata-se de um mecanismo
diferente e os dois não interagem.

## Próximos passos

- [Servidor MCP](/docs/ai/mcp) — conecte o Claude Code, Cursor ou qualquer cliente MCP
- [Agent Skills](/docs/ai/skills) — `rebase skills install` e as 21 skills
- [Arquivos de Instrução de IA](/docs/ai/instruction-files) — o padrão estruturado de regras
