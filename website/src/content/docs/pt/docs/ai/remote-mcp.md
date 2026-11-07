---
sourceHash: 219c4aa5108f13df
title: O Endpoint MCP Remoto
sidebar_label: Endpoint MCP remoto
description: Disponibilize o MCP a partir de um backend implantado em /mcp, para que as pessoas que usam o seu aplicativo possam conectar o Claude ou Cursor como elas mesmas — OAuth com uma tela de consentimento, nove ferramentas sob três escopos, cada chamada sob sua própria segurança em nível de linha.
---

:::tip[Conectando o Claude aos seus próprios projetos?]
Esse é o [Rebase connector](/docs/ai/rebase-connector/): um conector para
todos eles, e um servidor auto-hospedado conecta-se a ele com `rebase cloud connect`. Esta
página é para as pessoas que **usam** o seu aplicativo.
:::

O [servidor MCP](/docs/ai/mcp/) é uma ferramenta de desenvolvedor: ele roda na sua máquina e mantém uma chave de
serviço ou uma chave de API. Um backend implantado também pode disponibilizar o próprio MCP, em `/mcp`, para
as pessoas que usam seu aplicativo. Um assistente conectado por uma delas lê e
grava no projeto **como essa pessoa**, e cada chamada é executada sob sua própria
segurança em nível de linha (row-level security).

Ele fica desativado a menos que você o ative, e ambas as variáveis são obrigatórias:

```bash
REBASE_MCP_ENABLED=true
REBASE_PUBLIC_URL=https://app.example.com   # this deployment's real origin
```

Sem `REBASE_PUBLIC_URL`, um segredo JWT ou um driver de dados capaz de delimitar o escopo de uma consulta
a um único usuário, o endpoint recusa a inicialização e informa o motivo no log de boot. Nenhuma
`REBASE_ROLE` o ativa.

- **OAuth, com uma tela de consentimento.** Um cliente localiza o servidor de autorização
  por meio de `/.well-known/oauth-protected-resource`, registra a si mesmo (o registro
  dinâmico está ativado por padrão; `REBASE_MCP_OPEN_REGISTRATION=false` o limita
  a clientes que você registrar) e encaminha a pessoa para uma tela de consentimento que realiza o login
  através do seu `/auth/login` existente. Uma conta com segundo fator de autenticação
  é então solicitada a fornecer seu código autenticador ou um código de recuperação, por meio das
  rotas `/auth/mfa/challenge` existentes. Quando o próprio frontend do seu app
  mantém uma sessão no mesmo navegador, a tela oferece essa conta, e
  Permitir (Allow) concede o consentimento como esse usuário sem senha; é assim que alguém que se autentica apenas
  com Google, GitHub ou link por e-mail se conecta. Caso contrário, o login é feito com
  senha, e quem não tiver uma define-a primeiro em `/auth/forgot-password`
  ("Esqueci minha senha" do seu app); a tela informa isso. Ela também exibe o host para o qual o código de autorização é enviado
  e indica que esse host não é verificado: qualquer pessoa pode registrar um cliente sob
  qualquer nome, portanto o host é a parte que a pessoa pode verificar.
- **Onze ferramentas, três escopos.** Os mesmos [escopos](/docs/backend/roles-and-scopes/)
  que cada credencial utiliza. `data:read` oferece `list_collections`, `describe_collection`,
  `query_collection`, `count_documents`, `get_document` e as três visualizações,
  `show_collection`, `show_record` e `show_app`; `data:write` adiciona `create_document` e
  `update_document`; `data:delete` adiciona `delete_document`. Um cliente que não solicita
  nada recebe `data:read`. Cada um deles restringe-se a uma coleção: `data:read:posts`
  lista, descreve e lê `posts` e nada mais. Um escopo decide quais ferramentas são
  oferecidas e quais coleções elas alcançam, não quais linhas: uma lista vazia pode ser o
  RLS em funcionamento, e `data:write` ainda assim não pode gravar uma linha que a pessoa não poderia gravar.
- **Três ferramentas colocam o seu painel de administração na frente da pessoa.** Em um cliente que
  renderiza MCP Apps, como o Claude, elas abrem as próprias visualizações do painel de administração na
  conversa, extraídas de suas coleções: seus campos, enums, validações,
  relações, seções de formulário e configurações de visualização.
  - `show_collection` aceita os argumentos de `query_collection`, além de `view`
    (`table`, `list`, `cards` ou `kanban`), e abre a visualização da coleção: a
    pessoa pode pesquisar, filtrar, ordenar e paginar, abrir o formulário de uma linha e adicionar linhas.
  - `show_record` abre o formulário de uma linha (`id`), ou um formulário para uma nova linha que
    começa a partir dos `values` que o modelo preencheu, para a própria pessoa verificar e
    salvar.
  - `show_app` abre uma pequena tela de até oito `blocks`: visualizações de coleção,
    formulários de registro e métricas que contam as linhas correspondentes a um `where`. Um bloco
    pode seguir a linha selecionada em um bloco de coleção anterior: um formulário abrindo-a
    (`"follows": {"block": "orders"}`), ou uma segunda coleção mostrando as
    linhas que apontam para ela (`"follows": {"block": "orders", "on": "orderId"}`).

  Cada bloco é verificado da mesma forma que as ferramentas de leitura e escrita o verificariam antes de
  a tela ser aberta. Toda leitura e salvamento na visualização é uma chamada dessas ferramentas,
  realizada como a pessoa sob seu RLS, de modo que o formulário oferece apenas o que foi concedido à sua
  conexão: sem `data:write` ele é somente leitura, e um campo que
  suas roles não podem ler não aparece nele. O modelo é informado sobre o que ela alterou. Ele
  lê as linhas que cada ferramenta responde, não as configurações de coleção com as quais a visualização é renderizada. Um
  cliente sem MCP Apps, como Claude Code ou Cursor, não exibe nada,
  e o modelo lê as mesmas linhas que leria de `query_collection`.
- **Permissões (grants) concedidas antes da versão 0.24 mantêm seu alcance.** `mcp:read` é interpretado como
  `data:read`, e `mcp:write` como `data:write data:delete`, em concessões armazenadas e
  em tokens já emitidos.
- **Uma chave de API também funciona.** `/mcp` também aceita `Authorization: Bearer rk_…`, para
  um cliente configurado com um cabeçalho em vez de um fluxo OAuth. A chave tem acesso
  às ferramentas cobertas pelos seus escopos `data:*`, atuando em nome de quem ela representa: uma
  [chave pessoal](/docs/backend/api-keys/#personal-keys) como seu proprietário, uma chave de serviço
  como `api-key:<id>`.
- **O vocabulário do SDK, as respostas do REST.** As ferramentas recebem o que o SDK recebe —
  `where` (`{"status": ["==", "paid"]}`), `orderBy` (`["created_at", "desc"]` ou
  `"created_at:desc"`), `limit`, `offset`, `searchString`, e `data` para uma
  gravação — e leem através do caminho de `GET /api/data/<collection>`, portanto uma linha retorna
  como a REST a entrega (datas ISO, um `belongsTo` como sua chave estrangeira, ex.:
  `authorId`) e pode ser enviada de volta em uma atualização sem alterações. `query_collection`
  responde `{ data, meta }` com `meta.total` e `meta.hasMore`, e `count_documents`
  `{ count }`. Como no REST, um `limit` acima de 1000, um argumento não declarado e uma
  edição ou exclusão de uma linha enviada para a lixeira (404) são recusados; definir o campo de soft-delete
  como `null` a restaura. `deleted: "only"` (ou `"include"`) em
  `query_collection` e `count_documents` lê a lixeira, assim como faz o
  `?deleted=` do REST, permitindo que uma linha enviada para a lixeira por `delete_document` possa ser encontrada novamente para
  ser restaurada. Sua descrição informa ao modelo que a exclusão é permanente apenas onde
  a coleção não possui um campo de soft-delete.
- **A listagem nomeia as coleções; `describe_collection` fornece o schema de uma.**
  `list_collections` responde o `name`, `title` e `description` de cada coleção,
  e `describe_collection { collection }` os schemas OpenAPI `row` e
  `create` dessa coleção, além de `softDeleteField` quando linhas vão para a lixeira. As descrições
  das ferramentas orientam o modelo a descrever uma coleção antes de gravar nela. A
  listagem de um projeto com 200 coleções tem cerca de 5k tokens, e cada descrição
  menos de 1k; se todos os schemas estivessem na listagem, seriam cerca de 150k.
- **Um token apenas para este endpoint.** Um token de acesso MCP é recusado por
  `/api/data`, `/api/admin` e pelo WebSocket, logo conectar um assistente não
  concede uma sessão a ele.

Cada requisição para `/mcp` lê novamente a conta da pessoa. Uma conta excluída ou desativada,
ou uma ação de "desconectar de todos os lugares" ou alteração de senha após o token ter sido
emitido, interrompe imediatamente um cliente conectado com um erro 401. Um rebaixamento de permissões (demotion) aplica-se à
sua próxima chamada de ferramenta. Cada refresh realiza as mesmas verificações e recusa tal concessão
em definitivo. Uma sessão de convidado não pode dar consentimento de forma alguma.

Uma limitação. Desconectar um cliente (`DELETE /api/oauth/grants/:clientId`, com a
própria sessão da pessoa) revoga seus refresh tokens imediatamente, mas um token de acesso
já emitido continua funcionando até expirar, dentro de uma hora.

As rotas estão em [Endpoints](/docs/backend/endpoints/#mcp-surface) e as
variáveis em [Configuração](/docs/getting-started/configuration/#mcp-surface).
