---
sourceHash: f0b5790a3df6501a
title: IA e Agentes
sidebar_label: Visão geral
description: O que o Rebase oferece para assistentes de programação de IA e agentes autônomos — um servidor MCP, skills de agentes locais do projeto, arquivos de instruções gerados e o modelo de credenciais que decide o que um agente pode realmente acessar.
---

O Rebase fornece quatro coisas distintas para assistentes de IA, e elas resolvem
problemas diferentes. Vale a pena saber qual delas você está buscando:

| | O que é | Quem consome |
|---|---|---|
| [**Servidor MCP**](/docs/ai/mcp) | Um servidor Model Context Protocol via stdio com 53 ferramentas cobrindo seu schema, dados, usuários, storage, cron, servidor de desenvolvimento e projeto no Rebase Cloud | Um assistente, em tempo de execução |
| [**Agent skills**](/docs/ai/skills) | 23 arquivos de skill em Markdown gravados no seu repositório por `rebase skills install` | Um assistente, como material de referência |
| [**Arquivos de instrução**](/docs/ai/instruction-files) | `ai-instructions.md` mais arquivos apontadores por assistente, criados por `rebase init` | Um assistente, como regras sempre ativas |
| [**Chaves de API**](/docs/backend/api-keys) | Credenciais de máquina contendo [escopos](/docs/backend/roles-and-scopes), por coleção e por operação | Qualquer coisa que faça chamadas para a API HTTP |

As três primeiras servem para dar ao assistente *conhecimento* e *ferramentas*. A
quarta é a única que decide o que ele pode realmente fazer.

## A parte que importa: o que um agente pode acessar

Um agente com ferramentas sobre o seu banco de dados é um chamador de API comum que
simplesmente decide sua própria próxima requisição. O Rebase não tenta restringi-lo com
instruções — um prompt não é um mecanismo de controle de acesso, e um agente que
lê suas linhas está lendo um texto que outra pessoa pode ter escrito. A
restrição deve residir abaixo do agente, na credencial que ele carrega.

O Rebase fornece a essa credencial dois controles independentes:

1. **Os escopos da chave.** Declarados por operação *e*, quando você quiser, por
   coleção: `data:read:articles`, `data:write:articles`. `data:delete` é
   separado de `data:write`, que geralmente é aquele que você deseja reter
   de um agente que, de outra forma, tem permissão para editar.
2. **Row-Level Security (Segurança a Nível de Linha).** Chaves de API não ignoram o RLS. Uma chave se conecta como a
   role do Postgres `rebase_user` como qualquer outro chamador, portanto suas políticas ainda
   decidem quais linhas retornam.

Ambos devem permitir uma requisição. Nenhum substitui o outro, e o segundo
é o motivo pelo qual uma chave contendo `data:read` em todas as coleções ainda pode retornar
um conjunto de resultados vazio.

Um ponto que confunde as pessoas: o `access: "public"` de uma coleção amplia **quais
linhas um chamador pode ver**, não **quem pode chamar**. É uma instrução sobre a
visibilidade das linhas, não sobre autenticação. Concedê-lo não dá um escopo a uma chave,
e retirá-lo não bloqueia um.

A mecânica — criação de chaves, escolha de escopos, rotação, expiração, limites
de taxa (rate limits) — é abordada em [Chaves de API](/docs/backend/api-keys).
Não deixe de consultar [Regras de Segurança (RLS)](/docs/collections/security-rules) no
caminho; o segundo controle é tão bom quanto as políticas que você escreveu.

:::caution[O servidor MCP não usa como padrão uma chave com escopo]
O modelo de dois controles acima descreve o que uma chave de API faz. **Não** é o que
o `@rebasepro/mcp` usa, a menos que você o configure para isso. Por padrão, o servidor MCP
autentica-se com a **service key** do seu servidor de desenvolvimento — uma credencial de administrador
sem escopo restrito que atende às políticas de administração padrão em todas as coleções. Consulte
[O que o servidor MCP pode acessar](/docs/ai/mcp#what-the-server-can-reach)
antes de apontar um assistente para qualquer coisa importante.
:::

## Busca vetorial

O Rebase tem um tipo de propriedade `vector` nativo no Postgres e um método
de consulta `.vectorSearch()` com distância `cosine`, `l2` e `inner_product`.
Ele já está documentado, em dois lugares em vez de apenas um:

- [Consultando dados → Busca vetorial](/docs/sdk/aggregates-and-search#vector-search) — o método
  do SDK, o campo `_distance` que ele adiciona a cada linha e as ressalvas
- [API REST → Busca vetorial](/docs/backend/api#vector-search) — os
  parâmetros de consulta `vector_search`, `vector`, `vector_distance` e `vector_threshold`

Três coisas a saber antes de projetar em torno disso. **O Rebase armazena e busca
embeddings; ele não os calcula** — não há provedor de embeddings, configuração de
modelo ou chave de API em nenhum lugar no Rebase, portanto, produzir os vetores é tarefa sua.
**O pgvector é um pré-requisito e sua instalação é opcional.**
`database({ extensions: ["vector"] })` em `config/resources.ts` permite que o `rebase db
push` e a verificação de schema na inicialização executem `CREATE EXTENSION IF NOT EXISTS vector` para
você; sem isso, eles criam a coluna e deixam a extensão por sua conta. De qualquer
forma, o servidor precisa de uma imagem contendo a biblioteca e de uma role com permissão para instalá-la.
E **toda coluna vetorial recebe um índice HNSW para distância
de cosseno**, pois cosseno é o que o `vectorSearch` utiliza para medir, a menos
que você passe `distance` — um índice atende exatamente a um operador. Ajuste-o, ou desative-o,
na propriedade: consulte [O índice](/docs/sdk/aggregates-and-search#the-index).

Consultas vetoriais também não aceitam assinaturas (subscriptions); `.vectorSearch(...).listen()` é
recusado com `VECTOR_SEARCH_NOT_LIVE`.

Para busca lexical — full-text ranqueado sobre os campos que você especificar, incluindo
conteúdo JSONB e arrays — consulte [Busca](/docs/backend/search). É um mecanismo
diferente e os dois não interagem.

## Próximos passos

- [Servidor MCP](/docs/ai/mcp) — conecte o Claude Code, Cursor ou qualquer cliente MCP
- [Agent Skills](/docs/ai/skills) — `rebase skills install` e as 23 skills
- [Arquivos de instrução de IA](/docs/ai/instruction-files) — o padrão de regras geradas (scaffolded)
