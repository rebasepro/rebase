---
sourceHash: 166fe94f399384db
title: O Endpoint MCP Remoto
sidebar_label: Endpoint MCP remoto
description: Disponibilize o MCP a partir de um backend implantado em /mcp, para que as pessoas que usam seu app possam conectar o Claude ou o Cursor como elas mesmas — OAuth com tela de consentimento, nove ferramentas sob três escopos, cada chamada sob sua própria segurança em nível de linha (RLS).
---

:::tip[Conectando o Claude aos seus próprios projetos?]
Esse é o [conector Rebase](/docs/ai/rebase-connector/): um conector para
todos eles, e um servidor auto-hospedado conecta-se a ele com `rebase cloud connect`. Esta
página é para as pessoas que **usam** seu app.
:::

O [servidor MCP](/docs/ai/mcp/) é uma ferramenta de desenvolvedor: ele roda na sua máquina e contém uma chave
de serviço ou uma chave de API. Um backend implantado também pode disponibilizar o próprio MCP, em `/mcp`, para
as pessoas que usam sua aplicação. Um assistente conectado por uma delas lê e
escreve no projeto **como essa pessoa**, e cada chamada roda sob sua própria
segurança em nível de linha (row-level security).

Ele fica desativado a menos que você o ative, e ambas as variáveis são obrigatórias:

```bash
REBASE_MCP_ENABLED=true
REBASE_PUBLIC_URL=https://app.example.com   # this deployment's real origin
```

Sem `REBASE_PUBLIC_URL`, um segredo JWT ou um driver de dados capaz de limitar uma consulta
a um único usuário, o endpoint se recusa a inicializar e informa o motivo no log de boot. Nenhum
`REBASE_ROLE` o ativa.

- **OAuth, com uma tela de consentimento.** Um cliente encontra o servidor de autorização
  por meio de `/.well-known/oauth-protected-resource`, registra a si mesmo (o registro
  dinâmico está ativado por padrão; `REBASE_MCP_OPEN_REGISTRATION=false` o limita
  aos clientes que você registrar) e encaminha a pessoa para uma tela de consentimento que faz
  o login por meio do seu `/auth/login` existente. Uma conta com segundo fator de autenticação
  é então solicitada a fornecer seu código de autenticador ou um código de recuperação, por meio
  das rotas `/auth/mfa/challenge` existentes. Quando o próprio frontend do seu app
  mantém uma sessão no mesmo navegador, a tela oferece essa conta, e
  Permitir concede o consentimento como ela sem senha; é assim que alguém que faz login apenas
  com Google, GitHub ou link de e-mail se conecta. Caso contrário, faz login com uma
  senha, e quem não tiver uma define-a primeiro com `/auth/forgot-password`
  (o "Esqueci minha senha" do seu app); a tela informa isso. Ela também indica o host para o qual o código de autorização é enviado
  e informa que esse host não é verificado: qualquer pessoa pode registrar um cliente com
  qualquer nome, portanto o host é a parte que uma pessoa pode verificar.
- **Doze ferramentas, três escopos.** Os mesmos [escopos](/docs/backend/roles-and-scopes/)
  que qualquer credencial usa. `data:read` oferece `list_collections`, `describe_collection`,
  `query_collection`, `count_documents`, `aggregate_documents`, `get_document` e as três visualizações,
  `show_collection`, `show_record` e `show_app`; `data:write` adiciona `create_document` e
  `update_document`; `data:delete` adiciona `delete_document`. Um cliente que não pede
  nada recebe `data:read`. Cada um se restringe a uma coleção: `data:read:posts`
  lista, descreve e lê `posts` e nada mais. Um escopo decide quais ferramentas são
  oferecidas e quais coleções elas alcançam, não quais linhas: uma lista vazia pode ser
  o RLS funcionando, e `data:write` ainda assim não pode gravar uma linha que a pessoa não poderia.
- **Três ferramentas colocam o seu painel administrativo diante da pessoa.** Em um cliente que
  renderiza MCP Apps, como o Claude, elas abrem as próprias visualizações do painel administrativo na
  conversa, construídas a partir das suas coleções: seus campos, enums, validações,
  relações, seções de formulário e configurações de visualização.
  - `show_collection` aceita os argumentos de `query_collection`, mais `view`
    (`table`, `list`, `cards` ou `kanban`), e abre a visualização da coleção: a
    pessoa pode pesquisar, filtrar, ordenar e paginar, abrir o formulário de uma linha e adicionar linhas.
  - `show_record` abre o formulário de uma linha (`id`), ou um formulário para uma nova linha que
    começa a partir dos `values` que o modelo preencheu, para a própria pessoa verificar e
    salvar.
  - `show_app` executa um aplicativo que o modelo escreve para a tarefa em questão: um
    componente React (`code`) e as coleções (`collections`) que ele lê. Ele importa os próprios
    pacotes do Rebase, para que o mesmo código funcione no seu projeto:
    - `@rebasepro/app`: `useRows`, `useRow`, `useRowCount`, `useAggregate`
      e `useRowWrites` sobre as linhas do projeto;
    - `@rebasepro/cms`: o `CollectionPanel` do painel administrativo (com
      `CollectionToolbar` e seus componentes, e `onRowClick`, que repassa ao
      aplicativo a linha clicada conforme o `useRows` a lê), `EntityFormPanel` e `FormField`,
      `EntityViewPanel`, `FieldValue`, `useSidePanel` e
      `useCollectionRegistryController`, com seus campos, visualizações e
      ações customizados;
    - `@rebasepro/ui`, o UI kit completo, incluindo `SplitView` e os blocos de KPI e
      gráficos.

    O servidor compila o código primeiro, de modo que um erro de sintaxe, um módulo que a visualização
    não fornece ou um nome que ela não exporta de `@rebasepro/cms` ou
    `@rebasepro/app` torna-se o erro da chamada, indicando a linha. Um erro durante
    a execução é exibido em seu lugar e comunicado ao modelo com a próxima
    mensagem da pessoa. Um app pode usar apenas as coleções que listar. Seus estilos são
    os utilitários padrão do Tailwind, compilados com a visualização antes de qualquer app
    chegar: um valor arbitrário como `h-[560px]` não faz efeito ali, portanto um
    tamanho exato deve ser definido via `style`.

  Cada leitura e salvamento na visualização é uma chamada das ferramentas de leitura e escrita,
  feita como a pessoa sob o seu RLS, de forma que um formulário oferece apenas o que foi
  concedido à conexão dela: sem `data:write`, ele é somente leitura, e um campo
  que suas funções (roles) não podem ler não aparece nele. Na tela de um app, uma alteração
  que o código faz por meio de `useRowWrites` é exibida para a pessoa confirmar antes de ser
  enviada, já que o código pode gravar sem um clique; uma alteração que ela faz com os
  próprios controles do admin (o Salvar de um formulário, uma exclusão, uma edição na tabela) é dela e
  não é solicitada novamente. O modelo é informado sobre o que ela alterou. Ele lê as linhas retornadas por cada ferramenta, não as configurações de coleção com as quais a visualização é renderizada. Um cliente sem suporte a MCP Apps, como Claude Code ou Cursor, não exibe nada,
  e o modelo lê as mesmas linhas que leria com `query_collection`.
- **Permissões (grants) concedidas antes da 0.24 mantêm seu alcance.** `mcp:read` é interpretado como
  `data:read`, e `mcp:write` como `data:write data:delete`, tanto em permissões armazenadas quanto
  em tokens já emitidos.
- **Uma chave de API também funciona.** `/mcp` também aceita `Authorization: Bearer rk_…`, para
  um cliente configurado com um header em vez de um fluxo OAuth. A chave tem acesso
  às ferramentas cobertas pelos seus escopos `data:*`, agindo como quem ela representa: uma
  [chave pessoal](/docs/backend/api-keys/#personal-keys) como seu proprietário, uma chave de serviço
  como `api-key:<id>`.
- **O vocabulário do SDK, as respostas do REST.** As ferramentas aceitam o que o SDK aceita —
  `where` (`{"status": ["==", "paid"]}`), `orderBy` (`["created_at", "desc"]` ou
  `"created_at:desc"`), `limit`, `offset`, `searchString` e `data` para
  escrita — e realizam a leitura pelo caminho de `GET /api/data/<collection>`, de modo que uma linha retorna
  exatamente como o REST a serve (datas ISO, um `belongsTo` como sua chave estrangeira, ex.:
  `authorId`) e pode ser reenviada em uma atualização sem alterações. `query_collection`
  responde com `{ data, meta }`, incluindo `meta.total` e `meta.hasMore`, e `count_documents`
  com `{ count }`. `aggregate_documents` corresponde a `GET /api/data/<collection>/aggregate`:
  `select` é uma lista na gramática do REST (`["count()", "sum(total)"]`), `groupBy`
  é uma lista de campos, e responde com `{ data }` contendo uma linha por grupo, além de
  `meta.hasMore` em chamadas agrupadas, cujos grupos paginam com `limit` e `offset`
  e ordenam com `orderBy`. Em uma coleção onde um callback `afterRead` reescreve os dados,
  ela fornece apenas `count()`, assim como o REST faz. Como no REST, um `limit` acima de 1000, um argumento não declarado e
  a edição ou exclusão de uma linha que está na lixeira (404) são recusados; definir o campo de
  exclusão lógica (soft-delete) como `null` a restaura. `deleted: "only"` (ou `"include"`) em
  `query_collection`, `count_documents` e `aggregate_documents` lê a lixeira, assim como o
  `?deleted=` do REST faz, permitindo encontrar novamente para restaurar uma linha enviada para a lixeira por `delete_document`.
  A descrição informa ao modelo que a exclusão só é permanente quando
  a coleção não possui um campo de soft-delete.
- **A listagem informa os nomes das coleções; `describe_collection` fornece o schema de uma.**
  `list_collections` retorna o `name`, `title` e `description` de cada coleção,
  e `describe_collection { collection }` retorna os schemas OpenAPI de `row` e
  `create` daquela coleção, além de `softDeleteField` quando as linhas vão para uma lixeira. As descrições
  das ferramentas instruem o modelo a descrever uma coleção antes de gravar nela. A
  listagem de um projeto com 200 coleções tem cerca de 5 mil tokens, e cada descrição
  fica abaixo de 1 mil; com todos os schemas na listagem, ficaria em torno de 150 mil.
- **Um token apenas para este endpoint.** Um token de acesso MCP é recusado por
  `/api/data`, `/api/admin` e pelo WebSocket, garantindo que conectar um assistente não
  lhe entregue uma sessão.

Cada requisição para `/mcp` relê a conta da pessoa. Uma conta excluída ou desativada,
ou uma ação de "sair de todos os dispositivos" ou alteração de senha após a emissão do token,
interrompe imediatamente o cliente conectado com um 401. Um rebaixamento de permissões se aplica à
sua próxima chamada de ferramenta. Cada renovação (refresh) realiza as mesmas verificações e recusa definitivamente
tal permissão. Uma sessão de convidado (guest) não pode dar consentimento de forma alguma.

Um limite. Desconectar um cliente (`DELETE /api/oauth/grants/:clientId`, com a
própria sessão da pessoa) revoga seus tokens de refresh imediatamente, mas um token de acesso
já emitido continuará funcionando até expirar, o que ocorre dentro de uma hora.

As rotas estão em [Endpoints](/docs/backend/endpoints/#mcp-surface) e as
variáveis em [Configuração](/docs/getting-started/configuration/#mcp-surface).
