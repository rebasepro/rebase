---
sourceHash: aa952b8682070ef6
title: O Endpoint MCP Remoto
sidebar_label: Endpoint MCP remoto
description: Disponibilize o MCP a partir de um backend implantado em /mcp, para que as pessoas que usam o seu aplicativo possam conectar o Claude ou o Cursor como elas mesmas — OAuth com tela de consentimento, doze ferramentas sob três escopos, cada chamada sob sua própria segurança em nível de linha (RLS).
---

:::tip[Conectando o Claude aos seus próprios projetos?]
Esse é o [conector Rebase](/docs/ai/rebase-connector/): um único conector para
todos eles, e um servidor auto-hospedado conecta-se a ele com `rebase cloud connect`. Esta
página é para as pessoas que **usam** o seu aplicativo.
:::

O [servidor MCP](/docs/ai/mcp/) é uma ferramenta de desenvolvedor: ele roda na sua máquina e armazena uma chave
de serviço ou uma chave de API. Um backend implantado também pode disponibilizar o MCP diretamente, em `/mcp`, para
as pessoas que usam a sua aplicação. Um assistente conectado por uma delas lê e
escreve no projeto **como essa pessoa**, e cada chamada é executada sob a sua própria
segurança em nível de linha (row-level security - RLS).

Ele vem desativado por padrão, e ambas as variáveis são obrigatórias:

```bash
REBASE_MCP_ENABLED=true
REBASE_PUBLIC_URL=https://app.example.com   # this deployment's real origin
```

Sem `REBASE_PUBLIC_URL`, um segredo JWT ou um driver de dados capaz de limitar o escopo de uma consulta
a um único usuário, o endpoint se recusa a inicializar e informa o motivo no log de boot. Nenhum
`REBASE_ROLE` o ativa.

- **OAuth, com tela de consentimento.** O cliente localiza o servidor de autorização
  por meio de `/.well-known/oauth-protected-resource`, registra a si mesmo (o registro
  dinâmico fica ativado por padrão; `REBASE_MCP_OPEN_REGISTRATION=false` limita-o
  aos clientes que você registrar) e redireciona a pessoa para uma tela de consentimento que realiza o
  login por meio da sua rota existente `/auth/login`. Uma conta com segundo fator de autenticação
  é então solicitada a fornecer seu código de autenticador ou um código de recuperação, por meio das
  rotas existentes `/auth/mfa/challenge`. Quando o frontend da sua própria aplicação
  mantém uma sessão no mesmo navegador, a tela sugere essa conta, e
  o botão Permitir dá o consentimento como ela sem necessidade de senha; é assim que alguém que faz login apenas
  com Google, GitHub ou link por e-mail se conecta. Caso contrário, faz login com
  senha, e quem não tiver uma deve defini-la primeiro via `/auth/forgot-password`
  ("Esqueci minha senha" da sua aplicação); a tela exibe essa orientação. Ela também informa o host para o qual o código de autorização é enviado
  e avisa que o host não é verificado: qualquer pessoa pode registrar um cliente sob
  qualquer nome, portanto o host é a informação que o usuário pode checar.
- **Doze ferramentas, três escopos.** <span class="since-badge" data-since="0.29">Desde 0.29</span> Os mesmos [escopos](/docs/backend/roles-and-scopes/)
  que todas as credenciais usam. `data:read` oferece `list_collections`, `describe_collection`,
  `query_collection`, `count_documents`, `aggregate_documents`, `get_document` e as três visualizações,
  `show_collection`, `show_record` e `show_app`; `data:write` adiciona `create_document` e
  `update_document`; `data:delete` adiciona `delete_document`. Um cliente que não solicitar
  nada recebe `data:read`. Cada um pode ser restrito a uma coleção: `data:read:posts`
  lista, descreve e lê `posts` e nada mais. O escopo decide quais ferramentas são
  oferecidas e quais coleções elas alcançam, não quais linhas: uma lista vazia pode ser o
  RLS funcionando, e o `data:write` continua incapaz de gravar uma linha que a pessoa não poderia.
- **Três ferramentas colocam o seu painel administrativo diante do usuário.** Em um cliente que
  renderiza MCP Apps, como o Claude, elas abrem as próprias visualizações do painel administrativo na
  conversa, geradas a partir de suas coleções: seus campos, enums, validações,
  relações, seções de formulário e configurações de visualização.
  - `show_collection` recebe os argumentos de `query_collection`, além de `view`
    (`table`, `list`, `cards` ou `kanban`), e abre a visualização da coleção: a
    pessoa pode pesquisar, filtrar, ordenar e paginar, abrir o formulário de uma linha e adicionar linhas.
  - `show_record` abre o formulário de uma linha (`id`), ou um formulário para uma nova linha que
    começa a partir dos valores (`values`) preenchidos pelo modelo, para que a própria pessoa revise e
    salve.
  - `show_app` executa uma aplicação que o modelo escreve para a tarefa em questão: um
    componente React (`code`) e as coleções (`collections`) que ele lê. Ele importa os próprios
    pacotes do Rebase, para que o mesmo código funcione no seu projeto:
    - `@rebasepro/app`: `useRows`, `useRow`, `useRowCount`, `useAggregate`
      e `useRowWrites` sobre as linhas do projeto;
    - `@rebasepro/cms`: o `CollectionPanel` do painel administrativo (com
      `CollectionToolbar` e suas partes, e `onRowClick`, que passa para o
      app a linha clicada conforme lida por `useRows`), `EntityFormPanel` e `FormField`,
      `RecordDetail`, `FieldValue` e `useSidePanel`, cada um identificando sua
      coleção pelo caminho, com seus campos personalizados, visualizações e ações;
    - `@rebasepro/ui`, o kit de interface completo, incluindo `SplitView`, cards de KPI e
      gráficos.

    O servidor faz a compilação primeiro; portanto, um erro de sintaxe, um módulo que a visualização
    não disponibiliza ou um identificador não exportado por `@rebasepro/cms` ou
    `@rebasepro/app` resulta em erro na chamada, com a respectiva linha indicada. Um erro durante
    a execução é exibido em seu lugar e informado ao modelo na próxima
    mensagem do usuário. Uma aplicação só pode usar as coleções que listar. Seus estilos são
    os utilitários padrão do Tailwind, compilados com a visualização antes de qualquer app
    chegar: um valor arbitrário como `h-[560px]` não tem efeito nesse contexto, portanto
    dimensões exatas devem ser definidas via `style`.

  Cada leitura e salvamento na visualização é uma chamada das ferramentas de leitura e escrita,
  feita como o usuário sob seu RLS, de modo que um formulário oferece apenas o que foi
  concedido à sua conexão: sem `data:write` ele é somente leitura, e um campo
  que suas roles não podem ler não aparece nele. Esse é o mesmo limite no qual o código de uma aplicação
  opera: ela roda dentro da visualização, portanto cada chamada efetuada utiliza
  essas ferramentas, agindo como a pessoa, sem poder fazer nada além do que o modelo poderia fazer
  com as mesmas ferramentas. No conector hospedado, toda escrita também é planejada
  e confirmada pelo servidor. Dentro desse fluxo, o `useRowWrites` solicita confirmação ao usuário
  antes de gravar, evitando que uma aplicação faça alterações sem o seu clique; os
  próprios controles do admin (o Salvar de um formulário, uma exclusão, uma edição na tabela) comportam-se como
  na tela de `show_collection`. O modelo é informado sobre o que foi alterado. Ele lê as linhas retornadas por cada ferramenta, não as configurações de coleção com as quais a
  visualização é renderizada. Um cliente sem suporte a MCP Apps, como o Claude Code ou Cursor, não exibe nada,
  e o modelo lê as mesmas linhas que leria com `query_collection`.
- **Concessões feitas antes da versão 0.24 mantêm seu alcance.** `mcp:read` é interpretado como
  `data:read`, e `mcp:write` como `data:write data:delete`, tanto em permissões armazenadas quanto
  em tokens já emitidos.
- **Uma chave de API também funciona.** `/mcp` também aceita `Authorization: Bearer rk_…`, para
  um cliente configurado com um cabeçalho em vez de um fluxo OAuth. A chave tem acesso
  às ferramentas abrangidas por seus escopos `data:*`, atuando em nome de quem ela representa: uma
  [chave pessoal](/docs/backend/api-keys/#personal-keys) atua como seu proprietário, uma chave de serviço
  atua como `api-key:<id>`.
- **O vocabulário do SDK, as respostas do REST.** As ferramentas aceitam os mesmos parâmetros do SDK —
  `where` (`{"status": ["==", "paid"]}`), `orderBy` (`["created_at", "desc"]` ou
  `"created_at:desc"`), `limit`, `offset`, `searchString` e `data` para
  escrita — e leem através do caminho de `GET /api/data/<collection>`, de modo que uma linha retorna
  da mesma forma que o REST a disponibiliza (datas em ISO, um `belongsTo` como sua chave estrangeira, por ex.
  `authorId`) e pode ser enviada de volta em uma atualização sem alterações. `query_collection`
  retorna `{ data, meta }` com `meta.total` e `meta.hasMore`, e `count_documents`
  retorna `{ count }`. `aggregate_documents` equivale a `GET /api/data/<collection>/aggregate`:
  `select` é uma lista na sintaxe do REST (`["count()", "sum(total)"]`), `groupBy`
  é uma lista de campos, e o retorno é `{ data }` com uma linha por grupo, além de
  `meta.hasMore` em chamadas agrupadas, cujos grupos são paginados com `limit` e `offset`
  e ordenados com `orderBy`. Em uma coleção onde um callback `afterRead` reescreve dados, ela
  retorna apenas `count()`, assim como faz o REST. Da mesma forma que no REST, um `limit` acima de 1000, um argumento não declarado e a
  edição ou exclusão de um registro na lixeira (404) são recusados; definir o campo
  de soft-delete como `null` faz a restauração. `deleted: "only"` (ou `"include"`) em
  `query_collection`, `count_documents` e `aggregate_documents` faz a leitura da lixeira, assim como o `?deleted=`
  do REST, permitindo que uma linha excluída via `delete_document` seja reencontrada para
  restauração. Sua descrição informa ao modelo que a exclusão é permanente apenas nos casos em que
  a coleção não possui um campo de soft-delete.
- **A listagem informa as coleções; `describe_collection` fornece o schema de uma.**
  `list_collections` retorna o `name`, `title` e `description` de cada coleção,
  e `describe_collection { collection }` retorna os schemas OpenAPI `row` e
  `create` daquela coleção, além de `softDeleteField` caso as linhas utilizem lixeira. As descrições
  das ferramentas instruem o modelo a descrever uma coleção antes de gravar nela. A
  listagem de um projeto com 200 coleções consome cerca de 5k tokens, e cada descrição
  menos de 1k; se todos os schemas viessem na listagem, seriam cerca de 150k tokens.
- **Um token exclusivo para este endpoint.** Um token de acesso MCP é recusado por
  `/api/data`, `/api/admin` e pelo WebSocket, garantindo que a conexão de um assistente não
  conceda a ele uma sessão completa.

Cada requisição para `/mcp` relê a conta do usuário. Uma conta excluída
ou desativada, ou uma ação de "encerrar sessão em todos os dispositivos" ou troca de senha após a emissão do
token, interrompe imediatamente o cliente conectado com um erro 401. A perda de privilégios se aplica na
próxima chamada de ferramenta. Toda renovação de token executa as mesmas verificações e invalida
definitivamente essas concessões. Uma sessão de convidado não pode dar consentimento sob hipótese alguma.

Uma limitação: desconectar um cliente (`DELETE /api/oauth/grants/:clientId`, utilizando a
própria sessão do usuário) revoga imediatamente seus refresh tokens, mas um token de acesso
já emitido continuará funcionando até que expire, o que ocorre no prazo de uma hora.

As rotas podem ser consultadas em [Endpoints](/docs/backend/endpoints/#mcp-surface) e as
variáveis em [Configuração](/docs/getting-started/configuration/#mcp-surface).
