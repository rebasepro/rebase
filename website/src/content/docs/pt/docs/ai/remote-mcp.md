---
sourceHash: b813cdc1b302b6c6
title: O Endpoint MCP Remoto
sidebar_label: Endpoint MCP remoto
description: Disponibilize o MCP a partir de um backend implantado em /mcp, para que as pessoas que usam seu aplicativo possam conectar o Claude ou Cursor como elas mesmas — OAuth com uma tela de consentimento, nove ferramentas sob três escopos, cada chamada sob sua própria segurança em nível de linha (RLS).
---

:::tip[Conectando o Claude aos seus próprios projetos?]
Esse é o [Rebase connector](/docs/ai/rebase-connector/): um conector para
todos eles, e um servidor auto-hospedado conecta-se a ele com `rebase cloud connect`. Esta
página é para as pessoas que **usam** seu aplicativo.
:::

O [servidor MCP](/docs/ai/mcp/) é uma ferramenta de desenvolvedor: ele roda na sua máquina e mantém uma chave
de serviço ou uma chave de API. Um backend implantado também pode servir o próprio MCP, em `/mcp`, para
as pessoas que usam seu aplicativo. Um assistente conectado por uma delas lê e
grava no projeto **como essa pessoa**, e cada chamada é executada sob sua própria
segurança em nível de linha (row-level security).

Ele fica desativado a menos que você o ative, e ambas as variáveis são obrigatórias:

```bash
REBASE_MCP_ENABLED=true
REBASE_PUBLIC_URL=https://app.example.com   # this deployment's real origin
```

Sem `REBASE_PUBLIC_URL`, um segredo JWT ou um driver de dados que possa restringir o escopo de uma consulta
a um usuário, o endpoint se recusa a inicializar e informa o motivo no log de inicialização. Nenhum
`REBASE_ROLE` o ativa.

- **OAuth, com uma tela de consentimento.** Um cliente encontra o servidor de autorização
  por meio de `/.well-known/oauth-protected-resource`, registra a si mesmo (o registro
  dinâmico está ativado por padrão; `REBASE_MCP_OPEN_REGISTRATION=false` o limita
  aos clientes que você registrar) e encaminha a pessoa para uma tela de consentimento que realiza o login
  através do seu `/auth/login` existente. Uma conta com um segundo fator
  é então solicitada a fornecer seu código autenticador ou um código de recuperação, por meio das
  rotas `/auth/mfa/challenge` existentes. Quando o próprio frontend do seu aplicativo
  mantém uma sessão no mesmo navegador, a tela oferece essa conta, e o
  Permitir consente como ela sem necessidade de senha; é assim que alguém que faz login apenas
  com Google, GitHub ou link por e-mail se conecta. Caso contrário, faz login com uma
  senha, e quem não tiver uma define primeiro em `/auth/forgot-password`
  ("Esqueci minha senha" do seu app); a tela informa isso. Ela também indica o host para o qual o código de autorização é enviado,
  e informa que esse host não é verificado: qualquer pessoa pode registrar um cliente com
  qualquer nome, portanto o host é a parte que a pessoa pode verificar.
- **Onze ferramentas, três escopos.** Os mesmos [escopos](/docs/backend/roles-and-scopes/)
  que qualquer credencial utiliza. `data:read` oferece `list_collections`, `describe_collection`,
  `query_collection`, `count_documents`, `get_document` e as três visualizações,
  `show_collection`, `show_record` e `show_app`; `data:write` adiciona `create_document` e
  `update_document`; `data:delete` adiciona `delete_document`. Um cliente que não solicita
  nada recebe `data:read`. Cada um se restringe a uma coleção: `data:read:posts`
  lista, descreve e lê `posts` e nada mais. Um escopo decide quais ferramentas são
  oferecidas e quais coleções elas alcançam, não quais linhas: uma lista vazia pode ser
  o RLS funcionando, e `data:write` ainda assim não pode gravar uma linha que a pessoa não poderia.
- **Três ferramentas colocam seu painel de administração diante da pessoa.** Em um cliente que
  renderiza MCP Apps, como o Claude, elas abrem as próprias visualizações do painel de administração na
  conversa, extraídas de suas coleções: seus campos, enums, validação,
  relações, seções de formulário e configurações de visualização.
  - `show_collection` recebe os argumentos de `query_collection`, além de `view`
    (`table`, `list`, `cards` ou `kanban`), e abre a visualização da coleção: a
    pessoa pode pesquisar, filtrar, ordenar e paginar, abrir o formulário de uma linha e adicionar linhas.
  - `show_record` abre o formulário de uma linha (`id`), ou um formulário para uma nova linha que
    inicia a partir dos `values` preenchidos pelo modelo, para que a própria pessoa verifique e
    salve.
  - `show_app` executa um aplicativo que o modelo escreve para a tarefa em questão: um
    componente React (`code`) e as `collections` que ele lê. Ele importa o kit de UI
    (`@rebasepro/ui`), os blocos de KPI e gráficos do `@rebasepro/plugin-insights`,
    e `@rebasepro/mcp-apps`: `useQuery`, `useRecord`, `useCount` e
    `useMutate` sobre as linhas do projeto, além do `CollectionView` e
    `RecordForm` do painel de administração para composição. O servidor o compila
    primeiro, portanto um erro de sintaxe ou uma importação que a visualização não possui torna-se o
    erro da chamada, acompanhado de sua linha; um erro durante a execução é exibido em seu lugar
    e informado ao modelo na próxima mensagem da pessoa.

  Cada leitura e gravação na visualização é uma chamada das ferramentas de leitura e escrita,
  feita como a pessoa sob seu RLS, de modo que um formulário oferece apenas o que foi
  concedido à sua conexão: sem `data:write` ele é somente leitura, e um campo que
  seus papéis não podem ler não aparece nele. Uma alteração feita pelo código de um aplicativo é mostrada
  à pessoa para confirmação antes de ser enviada. O modelo é informado sobre o que ela
  alterou. Ele lê as linhas retornadas por cada ferramenta, não as configurações de coleção com as quais a
  visualização é renderizada. Um cliente sem MCP Apps, como o Claude Code ou Cursor, não exibe nada,
  e o modelo lê as mesmas linhas que leria a partir de `query_collection`.
- **Permissões concedidas antes da versão 0.24 mantêm seu alcance.** `mcp:read` é interpretado como
  `data:read`, e `mcp:write` como `data:write data:delete`, nas concessões armazenadas e
  nos tokens já emitidos.
- **Uma chave de API também funciona.** `/mcp` também aceita `Authorization: Bearer rk_…`, para
  um cliente configurado com um cabeçalho em vez de um fluxo OAuth. A chave tem acesso
  às ferramentas cobertas por seus escopos `data:*`, atuando em nome de quem ela representa: uma
  [chave pessoal](/docs/backend/api-keys/#personal-keys) como seu proprietário, uma chave de serviço
  como `api-key:<id>`.
- **O vocabulário do SDK, as respostas do REST.** As ferramentas aceitam o que o SDK aceita —
  `where` (`{"status": ["==", "paid"]}`), `orderBy` (`["created_at", "desc"]` ou
  `"created_at:desc"`), `limit`, `offset`, `searchString` e `data` para uma
  gravação — e leem através do caminho de `GET /api/data/<collection>`, portanto uma linha retorna
  como a REST a entrega (datas ISO, um `belongsTo` como sua chave estrangeira, por exemplo,
  `authorId`) e pode ser enviada de volta em uma atualização inalterada. `query_collection`
  responde `{ data, meta }` com `meta.total` e `meta.hasMore`, e `count_documents`
  `{ count }`. Assim como no REST, um `limit` acima de 1000, um argumento não declarado e uma
  edição ou exclusão de uma linha na lixeira (404) são recusados; definir o campo de soft-delete
  para `null` a restaura. `deleted: "only"` (ou `"include"`) em
  `query_collection` e `count_documents` lê a lixeira, assim como o
  `?deleted=` do REST faz, para que uma linha enviada para a lixeira por `delete_document` possa ser encontrada novamente para
  restauração. Sua descrição informa ao modelo que a exclusão só é permanente quando
  a coleção não possui um campo de soft-delete.
- **A listagem nomeia as coleções; `describe_collection` fornece o schema de uma.**
  `list_collections` retorna `name`, `title` e `description` de cada coleção,
  e `describe_collection { collection }` retorna os schemas OpenAPI `row` e
  `create` dessa coleção, além de `softDeleteField` onde as linhas vão para a lixeira. As descrições
  das ferramentas orientam o modelo a descrever uma coleção antes de gravar nela. A
  listagem de um projeto com 200 coleções tem cerca de 5k tokens, e cada descrição
  menos de 1k; com todos os schemas na listagem eram cerca de 150k.
- **Um token apenas para este endpoint.** Um token de acesso MCP é recusado por
  `/api/data`, `/api/admin` e pelo WebSocket, garantindo que conectar um assistente não
  entregue a ele uma sessão.

Cada requisição para `/mcp` relê a conta da pessoa. Uma conta excluída ou desativada,
ou um "sair de todos os dispositivos" ou alteração de senha após a emissão do token,
interrompe imediatamente um cliente conectado com um 401. Um rebaixamento de permissões se aplica à
sua próxima chamada de ferramenta. Cada atualização (refresh) faz as mesmas verificações e recusa tal concessão
em definitivo. Uma sessão de convidado não pode fornecer consentimento de forma alguma.

Uma limitação. Desconectar um cliente (`DELETE /api/oauth/grants/:clientId`, com a
própria sessão da pessoa) revoga seus tokens de atualização (refresh tokens) imediatamente, mas um token de acesso
já emitido continuará funcionando até expirar, dentro de uma hora.

As rotas estão em [Endpoints](/docs/backend/endpoints/#mcp-surface) e as
variáveis em [Configuração](/docs/getting-started/configuration/#mcp-surface).
