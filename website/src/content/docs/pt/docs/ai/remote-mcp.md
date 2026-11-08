---
sourceHash: 4abdf92eab306b1d
title: O Endpoint MCP Remoto
sidebar_label: Endpoint MCP remoto
description: Disponibilize o MCP a partir de um backend implantado em /mcp, para que as pessoas que usam seu app possam conectar o Claude ou Cursor como elas mesmas — OAuth com tela de consentimento, doze ferramentas sob três escopos, cada chamada sob sua própria segurança em nível de linha.
---

:::tip[Conectando o Claude aos seus próprios projetos?]
Esse é o [conector Rebase](/docs/ai/rebase-connector/): um conector para
todos eles, e um servidor auto-hospedado conecta-se a ele com `rebase cloud connect`. Esta
página é para as pessoas que **usam** o seu app.
:::

O [servidor MCP](/docs/ai/mcp/) é uma ferramenta de desenvolvedor: ele roda na sua máquina e mantém uma
chave de serviço ou chave de API. Um backend implantado também pode disponibilizar o próprio MCP, em `/mcp`, para
as pessoas que usam seu aplicativo. Um assistente conectado por uma delas lê e
grava no projeto **como essa pessoa**, e cada chamada é executada sob sua própria
segurança em nível de linha (row-level security).

Ele fica desativado a menos que você o ative, e ambas as variáveis são obrigatórias:

```bash
REBASE_MCP_ENABLED=true
REBASE_PUBLIC_URL=https://app.example.com   # this deployment's real origin
```

Sem `REBASE_PUBLIC_URL`, um segredo JWT ou um driver de dados capaz de restringir o escopo de uma consulta
a um usuário, o endpoint recusa a montagem e informa o motivo no log de inicialização. Nenhum
`REBASE_ROLE` o ativa.

- **OAuth, com tela de consentimento.** Um cliente encontra o servidor de autorização
  por meio de `/.well-known/oauth-protected-resource`, registra a si mesmo (o registro
  dinâmico fica ativado por padrão; `REBASE_MCP_OPEN_REGISTRATION=false` limita-o
  aos clientes que você registrar) e direciona a pessoa para uma tela de consentimento que faz o
  login usando o seu `/auth/login` existente. Uma conta com segundo fator
  é então solicitada pelo seu código do autenticador ou código de recuperação, por meio das
  rotas existentes de `/auth/mfa/challenge`. Quando o próprio frontend do seu app
  mantém uma sessão no mesmo navegador, a tela oferece essa conta, e o botão
  Permitir consente como ela sem senha; é assim que alguém que faz login apenas
  com Google, GitHub ou link por e-mail se conecta. Caso contrário, faz login com uma
  senha, e quem não tiver uma define-a primeiro em `/auth/forgot-password`
  ("Esqueci minha senha" do seu app); a tela informa isso. Ela também indica o host para o qual o código de autorização é enviado
  e informa que esse host não é verificado: qualquer pessoa pode registrar um cliente sob
  qualquer nome, portanto o host é a parte que uma pessoa pode verificar.
- **Doze ferramentas, três escopos.** <span class="since-badge" data-since="0.29">Desde 0.29</span> Os mesmos [escopos](/docs/backend/roles-and-scopes/)
  que qualquer credencial usa. `data:read` oferece `list_collections`, `describe_collection`,
  `query_collection`, `count_documents`, `aggregate_documents`, `get_document` e as três visualizações,
  `show_collection`, `show_record` e `show_app`; `data:write` adiciona `create_document` e
  `update_document`; `data:delete` adiciona `delete_document`. Um cliente que não solicita
  nada recebe `data:read`. Cada um se restringe a uma coleção: `data:read:posts`
  lista, descreve e lê `posts` e nada mais. Um escopo decide quais ferramentas são
  oferecidas e quais coleções elas alcançam, não quais linhas: uma lista vazia pode ser
  o RLS funcionando, e `data:write` ainda assim não pode gravar uma linha que a pessoa não poderia.
- **Três ferramentas colocam seu painel de administração diante da pessoa.** Em um cliente que
  renderiza MCP Apps, como o Claude, elas abrem as próprias visualizações do painel de administração na
  conversa, extraídas de suas coleções: seus campos, enums, validações,
  relações, seções de formulário e configurações de visualização.
  - `show_collection` recebe os argumentos de `query_collection`, além de `view`
    (`table`, `list`, `cards` ou `kanban`), e abre a visualização da coleção: a
    pessoa pode pesquisar, filtrar, ordenar e paginar, abrir o formulário de uma linha e adicionar linhas.
  - `show_record` abre o formulário de uma linha (`id`), ou um formulário para uma nova linha que
    começa a partir dos `values` que o modelo preencheu, para a pessoa verificar e
    salvar por si mesma.
  - `show_app` executa um aplicativo que o modelo escreve para a tarefa em questão: um
    componente React (`code`) e as `collections` que ele lê. Ele importa os
    próprios pacotes do Rebase, portanto o mesmo código funciona no seu projeto:
    - `@rebasepro/app`: `useRows`, `useRow`, `useRowCount`, `useAggregate`
      e `useRowWrites` sobre as linhas do projeto;
    - `@rebasepro/cms`: o `CollectionPanel` do painel de administração (com
      `CollectionToolbar` e seus componentes, e `onRowClick`, que passa ao
      app a linha clicada conforme o `useRows` a lê), `EntityFormPanel` e `FormField`,
      `EntityViewPanel`, `FieldValue`, `useSidePanel` e
      `useCollectionRegistryController`, com seus campos, visualizações e
      ações customizados;
    - `@rebasepro/ui`, todo o kit de interface, incluindo `SplitView` e os blocos e
      gráficos de KPI.

    O servidor o compila primeiro, de modo que um erro de sintaxe, um módulo que a visualização
    não disponibiliza, ou um nome que ela não disponibiliza de `@rebasepro/cms` ou
    `@rebasepro/app` é o erro da chamada, com sua linha. Um erro durante a
    execução é exibido em seu lugar e informado ao modelo com a próxima
    mensagem da pessoa. Um app pode usar apenas as coleções que ele lista. Seus estilos são
    os utilitários padrão do Tailwind, construídos com a visualização antes de qualquer app
    chegar: um valor arbitrário como `h-[560px]` não faz nada ali, portanto um
    tamanho exato é um `style`.

  Cada leitura e salvamento na visualização é uma chamada das ferramentas de leitura e gravação,
  feita como a pessoa sob seu RLS, de modo que um formulário oferece apenas o que sua
  conexão foi autorizada a acessar: sem `data:write` ele é somente leitura, e um campo
  que suas roles não podem ler não está nele. Esse é o limite dentro do qual o código de um app
  também opera: ele é executado na visualização, portanto cada chamada que faz é uma
  dessas ferramentas, como a pessoa, e não pode fazer nada que o modelo não pudesse fazer
  com as mesmas ferramentas. No conector hospedado, cada gravação também é planejada
  e confirmada pelo servidor. Dentro disso, o `useRowWrites` solicita confirmação à pessoa
  antes de gravar, para que um app não grave sem o clique dela; os
  próprios controles do administrador (o Salvar de um formulário, uma exclusão, uma edição de tabela) se comportam como
  em uma tela de `show_collection`. O modelo é informado sobre o que mudou. Ele lê as linhas que cada ferramenta responde, não as configurações de coleção com as quais a visualização desenha. Um cliente sem MCP Apps, como Claude Code ou Cursor, não mostra nada,
  e o modelo lê as mesmas linhas que leria de `query_collection`.
- **Concessões feitas antes da versão 0.24 mantêm seu alcance.** `mcp:read` é lido como
  `data:read`, e `mcp:write` como `data:write data:delete`, em concessões armazenadas e
  em tokens já emitidos.
- **Uma chave de API também funciona.** `/mcp` também aceita `Authorization: Bearer rk_…`, para
  um cliente configurado com um cabeçalho em vez de um fluxo OAuth. A chave alcança
  as ferramentas cobertas por seus escopos `data:*`, atuando como quem ela representa: uma
  [chave pessoal](/docs/backend/api-keys/#personal-keys) como seu proprietário, uma chave de serviço
  como `api-key:<id>`.
- **O vocabulário do SDK, as respostas do REST.** As ferramentas aceitam o que o SDK aceita —
  `where` (`{"status": ["==", "paid"]}`), `orderBy` (`["created_at", "desc"]` ou
  `"created_at:desc"`), `limit`, `offset`, `searchString` e `data` para
  gravação — e leem através do caminho de `GET /api/data/<collection>`, portanto uma linha retorna
  como o REST a disponibiliza (datas ISO, um `belongsTo` como sua chave estrangeira, por exemplo,
  `authorId`) e pode ser enviada de volta em uma atualização sem alterações. `query_collection`
  responde `{ data, meta }` com `meta.total` e `meta.hasMore`, e `count_documents`
  `{ count }`. `aggregate_documents` corresponde a `GET /api/data/<collection>/aggregate`:
  `select` é uma lista na gramática do REST (`["count()", "sum(total)"]`), `groupBy`
  uma lista de campos, e responde `{ data }` com uma linha por grupo, além de
  `meta.hasMore` em uma chamada agrupada, cujos grupos paginam com `limit` e `offset`
  e ordenam com `orderBy`. Em uma coleção que um callback `afterRead` reescreve,
  ele disponibiliza `count()` isoladamente, assim como o REST faz. Como no REST, um `limit` acima de 1000, um argumento não declarado e a
  edição ou exclusão de uma linha na lixeira (404) são recusados; definir o campo de soft-delete
  para `null` a restaura. `deleted: "only"` (ou `"include"`) em
  `query_collection`, `count_documents` e `aggregate_documents` lê a lixeira, assim como o
  `?deleted=` do REST faz, para que uma linha excluída por `delete_document` possa ser encontrada novamente para
  restauração. Sua descrição informa ao modelo que a exclusão é permanente apenas onde
  a coleção não possui um campo de soft-delete.
- **A listagem nomeia as coleções; `describe_collection` fornece o schema de uma.**
  `list_collections` responde o `name`, `title` e `description` de cada coleção,
  e `describe_collection { collection }` os schemas OpenAPI `row` e
  `create` dessa coleção, além de `softDeleteField` onde as linhas vão para a lixeira. As
  descrições das ferramentas instruem o modelo a descrever uma coleção antes de gravar nela. A listagem
  de um projeto com 200 coleções tem cerca de 5k tokens, e cada descrição
  tem menos de 1k; com todos os schemas na listagem, eram cerca de 150k.
- **Um token apenas para este endpoint.** Um token de acesso MCP é recusado por
  `/api/data`, `/api/admin` e pelo WebSocket, de modo que conectar um assistente não
  fornece uma sessão a ele.

Cada requisição para `/mcp` relê a conta da pessoa. Uma conta excluída ou desativada,
ou um "desconectar de todos os lugares" ou alteração de senha após a emissão do
token, interrompe imediatamente um cliente conectado com um 401. Um rebaixamento de permissões se aplica à
sua próxima chamada de ferramenta. Cada renovação (refresh) realiza as mesmas verificações e recusa definitivamente
tal concessão. Uma sessão de convidado não pode conceder autorização de forma alguma.

Um limite. Desconectar um cliente (`DELETE /api/oauth/grants/:clientId`, com a
própria sessão da pessoa) revoga seus tokens de atualização imediatamente, mas um token de acesso
já emitido continua funcionando até expirar, dentro de uma hora.

As rotas estão em [Endpoints](/docs/backend/endpoints/#mcp-surface) e as
variáveis em [Configuration](/docs/getting-started/configuration/#mcp-surface).
