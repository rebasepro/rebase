---
sourceHash: fc4e87a4b7e7a310
title: O Endpoint MCP Remoto
sidebar_label: Endpoint MCP remoto
description: Sirva o MCP a partir de um backend implantado em /mcp, para que as pessoas que usam seu app possam conectar o Claude ou o Cursor como elas mesmas — OAuth com tela de consentimento, doze ferramentas sob três escopos, cada chamada sob sua própria segurança em nível de linha.
---

:::tip[Conectando o Claude aos seus próprios projetos?]
Esse é o [Rebase connector](/docs/ai/rebase-connector/): um conector para
todos eles, e um servidor auto-hospedado conecta-se a ele com `rebase cloud connect`. Esta
página é para as pessoas que **usam** seu app.
:::

O [MCP server](/docs/ai/mcp/) é uma ferramenta de desenvolvedor: ele roda na sua máquina e armazena uma chave
de serviço ou chave de API. Um backend implantado também pode servir o próprio MCP, em `/mcp`, para
as pessoas que usam sua aplicação. Um assistente conectado por uma delas lê e
grava no projeto **como essa pessoa**, e cada chamada é executada sob sua própria
segurança em nível de linha (row-level security).

Ele fica desativado a menos que você o ative, e ambas as variáveis são obrigatórias:

```bash
REBASE_MCP_ENABLED=true
REBASE_PUBLIC_URL=https://app.example.com   # this deployment's real origin
```

Sem a `REBASE_PUBLIC_URL`, um segredo JWT ou um driver de dados capaz de limitar o escopo de uma consulta
a um único usuário, o endpoint se recusa a inicializar e informa o motivo no log de inicialização. Nenhum
`REBASE_ROLE` o ativa.

- **OAuth, com tela de consentimento.** Um cliente encontra o servidor de autorização
  por meio de `/.well-known/oauth-protected-resource`, registra a si mesmo (o registro
  dinâmico é ativado por padrão; `REBASE_MCP_OPEN_REGISTRATION=false` o limita
  aos clientes que você registrar) e encaminha a pessoa para uma tela de consentimento que
  realiza o login por meio do seu `/auth/login` existente. Uma conta com segundo fator de
  autenticação é então solicitada a fornecer seu código autenticador ou um código de recuperação,
  por meio das rotas existentes de `/auth/mfa/challenge`. Quando o frontend do seu próprio
  app mantém uma sessão no mesmo navegador, a tela oferece essa conta, e
  o botão "Allow" consente com ela sem senha; é assim que alguém que faz login apenas
  com Google, GitHub ou link de e-mail se conecta. Caso contrário, faz login com uma
  senha, e quem não tiver uma define primeiro com `/auth/forgot-password`
  ("Esqueci minha senha" do seu app); a tela informa isso. Ela também indica o host para o qual o código de autorização é enviado
  e informa que esse host não é verificado: qualquer pessoa pode registrar um cliente sob
  qualquer nome, portanto o host é a parte que a pessoa pode verificar.
- **Doze ferramentas, três escopos.** <span class="since-badge" data-since="0.29">Desde 0.29</span> Os mesmos [escopos](/docs/backend/roles-and-scopes/)
  que toda credencial usa. `data:read` oferece `list_collections`, `describe_collection`,
  `query_collection`, `count_documents`, `aggregate_documents`, `get_document` e as três visualizações,
  `show_collection`, `show_record` e `show_app`; `data:write` adiciona `create_document` e
  `update_document`; `data:delete` adiciona `delete_document`. Um cliente que não solicita
  nada recebe `data:read`. Cada um restringe a uma coleção: `data:read:posts`
  lista, descreve e lê `posts` e nada mais. Um escopo decide quais ferramentas são
  oferecidas e quais coleções elas alcançam, não quais linhas: uma lista vazia pode ser
  o RLS em funcionamento, e `data:write` ainda assim não pode gravar uma linha que a pessoa não poderia.
- **Três ferramentas colocam seu painel de administração diante da pessoa.** Em um cliente que
  renderiza MCP Apps, como o Claude, elas abrem as próprias visualizações do painel de administração na
  conversa, extraídas de suas coleções: seus campos, enums, validação,
  relações, seções de formulário e configurações de visualização.
  - `show_collection` recebe os argumentos de `query_collection`, mais `view`
    (`table`, `list`, `cards` ou `kanban`), e abre a visualização da coleção: a
    pessoa pode pesquisar, filtrar, ordenar e paginar, abrir o formulário de uma linha e adicionar linhas.
  - `show_record` abre o formulário de uma linha (`id`), ou um formulário para uma nova linha que
    começa a partir dos `values` preenchidos pelo modelo, para que a própria pessoa revise e
    salve.
  - `show_app` executa um aplicativo que o modelo escreve para a tarefa em questão: um
    componente React (`code`) e as `collections` que ele lê. Ele importa os próprios
    pacotes do Rebase, para que o mesmo código funcione no seu projeto:
    - `@rebasepro/app`: `useRows`, `useRow`, `useRowCount`, `useAggregate`
      e `useRowWrites` sobre as linhas do projeto;
    - `@rebasepro/cms`: o `CollectionPanel` do painel de administração (com
      `CollectionToolbar` e suas partes, e `onRowClick`, que repassa ao
      app a linha clicada conforme `useRows` a lê), `EntityFormPanel` e `FormField`,
      `EntityViewPanel`, `FieldValue` e `useSidePanel`, cada um identificando sua
      coleção pelo caminho, com seus campos personalizados, visualizações e ações;
    - `@rebasepro/ui`, todo o kit de interface, `SplitView` e os blocos de KPI e
      gráficos incluídos.

    O servidor o compila primeiro, de modo que um erro de sintaxe, um módulo que a visualização
    não fornece ou um nome não fornecido a partir de `@rebasepro/cms` ou
    `@rebasepro/app` torna-se o erro da chamada, indicando a linha. Um erro durante a
    execução é exibido em seu lugar e comunicado ao modelo na próxima
    mensagem da pessoa. Um app pode usar apenas as coleções que listar. Seus estilos são
    utilitários padrão do Tailwind, compilados com a visualização antes da chegada de qualquer app:
    um valor arbitrário como `h-[560px]` não tem efeito ali, portanto um
    tamanho exato deve ser um `style`.

  Cada leitura e salvamento na visualização é uma chamada das ferramentas de leitura e escrita,
  feita como a própria pessoa sob seu RLS, de modo que um formulário oferece apenas o que foi
  concedido à conexão: sem `data:write` ele é somente leitura, e um campo
  que suas roles não podem ler não aparece nele. Esse é o mesmo limite em que o código de um app
  opera: ele roda na visualização, portanto cada chamada que faz é uma
  dessas ferramentas, como a pessoa, e ele não pode fazer nada que o modelo não pudesse fazer
  com as mesmas ferramentas. No conector hospedado, cada gravação também é planejada
  e confirmada pelo servidor. Dentro disso, `useRowWrites` solicita a confirmação da pessoa
  antes de gravar, para que um app não grave sem o clique dela; os
  próprios controles do painel de administração (o Salvar de um formulário, uma exclusão, uma edição em tabela) comportam-se como fariam
  em uma tela `show_collection`. O modelo é informado sobre o que mudou. Ele lê as linhas retornadas por cada ferramenta, não as configurações de coleção com as quais a
  visualização é construída. Um cliente sem suporte a MCP Apps, como Claude Code ou Cursor, não exibe nada,
  e o modelo lê as mesmas linhas que leria com `query_collection`.
- **Permissões concedidas antes da versão 0.24 mantêm seu alcance.** `mcp:read` é interpretado como
  `data:read`, e `mcp:write` como `data:write data:delete`, em permissões armazenadas e
  em tokens já emitidos.
- **Uma chave de API também funciona.** `/mcp` também aceita `Authorization: Bearer rk_…`, para
  um cliente configurado com um cabeçalho em vez de um fluxo OAuth. A chave alcança
  as ferramentas cobertas por seus escopos `data:*`, atuando como quem ela representa: uma
  [chave pessoal](/docs/backend/api-keys/#personal-keys) como seu proprietário, uma chave de serviço
  como `api-key:<id>`.
- **O vocabulário do SDK, as respostas do REST.** As ferramentas aceitam o que o SDK aceita —
  `where` (`{"status": ["==", "paid"]}`), `orderBy` (`["created_at", "desc"]` ou
  `"created_at:desc"`), `limit`, `offset`, `searchString`, e `data` para uma
  gravação — e leem através do caminho de `GET /api/data/<collection>`, portanto uma linha retorna
  como o REST a serve (datas ISO, um `belongsTo` como sua chave estrangeira, ex.:
  `authorId`) e pode ser enviada de volta em uma atualização sem alterações. `query_collection`
  responde `{ data, meta }` com `meta.total` e `meta.hasMore`, e `count_documents`
  responde `{ count }`. `aggregate_documents` é `GET /api/data/<collection>/aggregate`:
  `select` é uma lista na gramática do REST (`["count()", "sum(total)"]`), `groupBy`
  é uma lista de campos, e ele responde `{ data }` com uma linha por grupo, além de
  `meta.hasMore` em uma chamada agrupada, cujos grupos paginam com `limit` e `offset`
  e ordenam com `orderBy`. Em uma coleção que um callback `afterRead` reescreve,
  ele serve apenas `count()`, assim como o REST faz. Como no REST, um `limit` acima de 1000, um argumento não declarado e uma
  edição ou exclusão de uma linha na lixeira (404) são recusados; definir o campo de soft-delete
  como `null` a restaura. `deleted: "only"` (ou `"include"`) em
  `query_collection`, `count_documents` e `aggregate_documents` lê a lixeira, como o `?deleted=` do REST
  faz, para que uma linha movida para a lixeira por `delete_document` possa ser encontrada novamente para
  restauração. Sua descrição informa ao modelo que a exclusão só é permanente onde
  a coleção não possui um campo de soft-delete.
- **A listagem nomeia as coleções; `describe_collection` fornece o schema de uma.**
  `list_collections` responde o `name`, `title` e `description` de cada coleção,
  e `describe_collection { collection }` os schemas OpenAPI `row` e
  `create` dessa coleção, além de `softDeleteField` onde as linhas vão para a lixeira. As descrições
  das ferramentas instruem o modelo a descrever uma coleção antes de gravar nela. A
  listagem de um projeto com 200 coleções consome cerca de 5k tokens, e cada descrição
  menos de 1k; se incluísse todos os schemas na listagem, seriam cerca de 150k.
- **Um token apenas para este endpoint.** Um token de acesso MCP é recusado por
  `/api/data`, `/api/admin` e pelo WebSocket, de modo que conectar um assistente não
  entrega a ele uma sessão.

Cada requisição para `/mcp` relê a conta da pessoa. Uma conta excluída ou desativada,
ou uma ação de "desconectar de todos os dispositivos" ou alteração de senha após a emissão do
token, interrompe imediatamente um cliente conectado com um 401. Um rebaixamento de privilégios é aplicado
na sua próxima chamada de ferramenta. Cada refresh realiza as mesmas verificações e recusa tal concessão
em definitivo. Uma sessão de convidado não pode fornecer consentimento de forma alguma.

Uma limitação. Desconectar um cliente (`DELETE /api/oauth/grants/:clientId`, com a
própria sessão da pessoa) revoga seus tokens de refresh imediatamente, mas um token de acesso
já emitido continuará funcionando até expirar, dentro de uma hora.

As rotas estão em [Endpoints](/docs/backend/endpoints/#mcp-surface) e as
variáveis em [Configuration](/docs/getting-started/configuration/#mcp-surface).
