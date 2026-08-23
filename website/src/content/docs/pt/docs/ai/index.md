---
title: IA & Agentes
sidebar_label: Visão Geral
description: O que o Rebase oferece para assistentes de código com IA e agentes autônomos — um servidor MCP, agent skills locais no projeto, arquivos de instruções gerados e o modelo de credenciais que decide o que um agente pode realmente acessar.
---

O Rebase disponibiliza quatro coisas distintas para assistentes de IA, e elas resolvem
problemas diferentes. Vale a pena saber qual delas você está buscando:

| | O que é | Quem consome |
|---|---|---|
| [**Servidor MCP**](/docs/ai/mcp) | Um servidor Model Context Protocol via stdio com 40 ferramentas sobre seu schema, dados, usuários, storage, cron e servidor de desenvolvimento | Um assistente, em tempo de execução |
| [**Agent skills**](/docs/ai/skills) | 20 arquivos de skill em Markdown gravados no seu repositório por `rebase skills install` | Um assistente, como material de referência |
| [**Arquivos de instrução**](/docs/ai/instruction-files) | `ai-instructions.md` mais arquivos de apontamento específicos por assistente, gravados por `rebase init` | Um assistente, como regras sempre ativas |
| [**Chaves de API**](/docs/backend/api#api-keys) | Credenciais de máquina com escopo delimitado, por coleção e por operação | Qualquer cliente que chame a API HTTP |

Os três primeiros têm a ver com dar *conhecimento* e *ferramentas* a um assistente. O
quarto é o único que decide o que ele pode realmente fazer.

## A parte que importa: o que um agente pode acessar

Um agente com ferramentas sobre o seu banco de dados é um chamador de API comum que
simplesmente decide sua própria próxima requisição. O Rebase não tenta restringi-lo com
instruções — um prompt não é um mecanismo de controle de acesso, e um agente que
lê suas linhas está lendo texto que outra pessoa pode ter escrito. A
restrição precisa existir abaixo do agente, na credencial que ele carrega.

O Rebase fornece a essa credencial duas barreiras independentes:

1. **A lista de permissões da chave de API.** Declarada por coleção *e* por operação,
   onde `delete` pode ser separado de `write` — o que normalmente é o que você deseja
   reter de um agente que, de outra forma, tem permissão para editar.
2. **Row-Level Security (RLS).** Chaves de API não ignoram o RLS. Uma chave se conecta
   como a role `rebase_user` do Postgres como qualquer outro chamador, de modo que suas
   políticas ainda decidem quais linhas retornam.

Ambas devem permitir uma requisição. Nenhuma substitui a outra, e a segunda
é a razão pela qual uma chave com permissões `"*"` ainda pode retornar um conjunto
de resultados vazio.

Um ponto que costuma gerar confusão: o `access: "public"` de uma coleção expande **quais
linhas um chamador pode ver**, não **quem pode chamar**. É uma declaração sobre
visibilidade de linhas, não sobre autenticação. Concedê-lo não adiciona um chamador à
lista de permissões, e retê-lo não bloqueia um chamador.

A mecânica — criação de chaves, o JSON de permissões, rotação, expiração, limites
de taxa — é abordada em [API REST → Chaves de API](/docs/backend/api#api-keys).
Não deixe de conferir [Regras de Segurança (RLS)](/docs/collections/security-rules);
a segunda barreira é tão boa quanto as políticas que você escreveu.

:::caution[O servidor MCP não usa uma chave com escopo por padrão]
O modelo de duas barreiras acima descreve o que uma chave de API faz. **Não** é o que
o `@rebasepro/mcp` usa, a menos que você o configure para isso. Por padrão, o servidor MCP
se autentica com a **service key** do seu servidor de desenvolvimento — uma credencial de
administrador sem escopo restrito que satisfaz as políticas de admin padrão em todas as coleções.
Consulte [O que o servidor MCP pode acessar](/docs/ai/mcp#what-the-server-can-reach)
antes de apontar um assistente para qualquer coisa importante.
:::

## Busca vetorial

O Rebase possui um tipo de propriedade `vector` nativo no Postgres e um
método de consulta `.vectorSearch()` com suporte a distâncias `cosine`, `l2` e `inner_product`.
Isso já está documentado, em dois lugares em vez de um:

- [Consultando Dados → Busca Vetorial](/docs/sdk/querying#vector-search) — o método
  do SDK, o campo `_distance` que ele adiciona a cada linha e as ressalvas
- [API REST → Busca Vetorial](/docs/backend/api#vector-search) — os parâmetros de
  consulta `vector_search`, `vector`, `vector_distance` e `vector_threshold`

Três coisas para saber antes de projetar sua solução em torno disso. **O Rebase armazena
e busca embeddings; ele não os calcula** — não há provedor de embeddings, configuração
de modelo ou chave de API em nenhum lugar no Rebase, portanto, produzir os vetores é
tarefa sua. **O pgvector é um pré-requisito que o Rebase não instala para você.** E
**nenhum índice ANN é criado para uma coluna de vetor**, portanto `vectorSearch` é uma
varredura exata — excelente para milhares de linhas, não para milhões.

Consultas vetoriais também não aceitam subscrição em tempo real; `.vectorSearch(...).listen()`
é recusado com `VECTOR_SEARCH_NOT_LIVE`.

Para busca lexical — busca textual ranqueada (full-text) sobre os campos que você especificar,
incluindo conteúdo de JSONB e arrays — consulte [Busca](/docs/backend/search). É um mecanismo
diferente e os dois não interagem.

## Próximos passos

- [Servidor MCP](/docs/ai/mcp) — conecte o Claude Code, Cursor ou qualquer cliente MCP
- [Agent Skills](/docs/ai/skills) — `rebase skills install` e as 20 skills
- [Arquivos de Instrução de IA](/docs/ai/instruction-files) — o padrão de regras geradas por scaffolding

---
