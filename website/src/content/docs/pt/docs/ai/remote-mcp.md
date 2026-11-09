---
sourceHash: 9b3e33abff242ed3
title: O Endpoint MCP Remoto
sidebar_label: Endpoint MCP remoto
description: Sirva MCP a partir de um backend implantado em /mcp, para que as pessoas que usam seu app possam conectar o Claude ou o Cursor como elas mesmas — OAuth com uma tela de consentimento, treze ferramentas em três escopos, cada chamada sob sua própria row-level security.
---

:::tip[Conectando o Claude aos seus próprios projetos?]
Esse é o [conector Rebase](/docs/ai/rebase-connector/): um conector para
todos eles, e um servidor auto-hospedado conecta-se a ele com `rebase cloud connect`. Esta
página é para as pessoas que **usam** seu app.
:::

O [servidor MCP](/docs/ai/mcp/) é uma ferramenta de desenvolvedor: ele roda na sua máquina e mantém uma chave de
serviço ou uma chave de API. Um backend implantado também pode servir o próprio MCP, em `/mcp`, para
as pessoas que usam sua aplicação. Um assistente conectado por uma delas lê e
grava no projeto **como essa pessoa**, e cada chamada é executada sob sua própria
row-level security.

Ele fica desativado a menos que você o ative, e ambas as variáveis são obrigatórias:

```bash
REBASE_MCP_ENABLED=true
REBASE_PUBLIC_URL=https://app.example.com   # this deployment's real origin
```

Sem `REBASE_PUBLIC_URL`, um segredo JWT ou um driver de dados que possa delimitar uma consulta
a um usuário, o endpoint se recusa a montar e informa o motivo no log de inicialização. Nenhum
`REBASE_ROLE` o ativa.

- **OAuth, com uma tela de consentimento.** Um cliente localiza o servidor de autorização
  por meio de `/.well-known/oauth-protected-resource`, registra-se (o registro
  dinâmico está ativado por padrão; `REBASE_MCP_OPEN_REGISTRATION=false` o limita
  aos clientes que você registrar) e envia a pessoa para uma tela de consentimento que faz o
  login por meio do seu `/auth/login` existente. Uma conta com um segundo fator
  é então solicitada pelo seu código do autenticador ou um código de recuperação, por meio das
  rotas existentes `/auth/mfa/challenge`. Quando o próprio frontend do seu app
  mantém uma sessão no mesmo navegador, a tela oferece essa conta, e o
  botão Permitir consente como ela sem senha; é assim que alguém que faz login apenas
  com Google, GitHub ou link de e-mail se conecta. Caso contrário, faz login com uma
  senha, e quem não tiver uma define uma primeiro com `/auth/forgot-password`
  ("Esqueci minha senha" do seu app); a tela informa isso. Ela também indica o host para o qual o código de autorização é enviado
  e informa que esse host não é verificado: qualquer pessoa pode registrar um cliente com
  qualquer nome, portanto o host é a parte que uma pessoa pode verificar.
- **Treze ferramentas, três escopos.** Os mesmos [escopos](/docs/backend/roles-and-scopes/)
  que todas as credenciais usam. `data:read` oferece `list_collections`, `describe_collection`,
  `query_collection`, `count_documents`, `aggregate_documents`, `get_document`, as três visualizações,
  `show_collection`, `show_record` e `show_app`, e `show_app_guide`; `data:write` adiciona `create_document` e
  `update_document`; `data:delete` adiciona `delete_document`. Um cliente que não solicita
  nada recebe `data:read`. Cada um se restringe a uma coleção: `data:read:posts`
  lista, descreve e lê `posts` e nada mais. Um escopo decide quais ferramentas são
  oferecidas e quais coleções elas alcançam, não quais linhas: uma lista vazia pode ser o
  RLS funcionando, e `data:write` ainda assim não pode gravar uma linha que a pessoa não poderia.
- **Três ferramentas colocam seu painel de administração na frente da pessoa.** Em um cliente que
  renderiza MCP Apps, como o Claude, elas abrem as próprias visualizações do painel de administração na
  conversa, extraídas de suas coleções: seus campos, enums, validação,
  relações, seções de formulário e configurações de visualização.
  - `show_collection` recebe os argumentos de `query_collection`, mais `view`
    (`table`, `list`, `cards` ou `kanban`), e abre a visualização da coleção: a
    pessoa pode pesquisar, filtrar, ordenar e paginar, abrir o formulário de uma linha e adicionar linhas.
  - `show_record` abre o formulário de uma linha (`id`), ou um formulário para uma nova linha que
    começa a partir dos `values` que o modelo preencheu, para que a própria pessoa
    verifique e salve.
  - `show_app` executa um app que o modelo escreve para a tarefa em questão: um
    componente React (`code`) e as `collections` que ele lê. Ele importa os
    próprios pacotes do Rebase, portanto o mesmo código funciona no seu projeto:
    - `@rebasepro/app`: `useRows`, `useRow`, `useRowCount`, `useAggregate`
      e `useRowWrites` sobre as linhas do projeto;
    - `@rebasepro/cms`: o `CollectionPanel` do painel de administração (com
      `CollectionToolbar` e suas partes, e `onRowClick`, que entrega ao
      app a linha clicada conforme `useRows` a lê), `RecordForm` e `FormField`,
      `RecordDetail`, `FieldValue` e `useSidePanel`, cada um nomeando sua
      coleção por caminho, com seus campos, visualizações e ações customizados;
    - `@rebasepro/ui`, todo o kit de interface, `SplitView` e os blocos de KPI e
      gráficos incluídos.

    O servidor o compila primeiro, portanto um erro de sintaxe, um módulo que a visualização
    não fornece ou um nome que ela não fornece de `@rebasepro/cms` ou
    `@rebasepro/app` é o erro da chamada, com sua linha. Um erro durante a
    execução é exibido em seu lugar e informado ao modelo na próxima
    mensagem da pessoa. Um app pode usar apenas as coleções que listar. Seus estilos são
    os utilitários padrão do Tailwind, compilados com a visualização antes de qualquer app
    chegar: um valor arbitrário como `h-[560px]` não faz nada ali, portanto um
    tamanho exato é um `style`.

    A descrição de `show_app` traz apenas o essencial, porque um cliente pode
    cortar uma descrição de ferramenta longa demais (o claude.ai faz isso em
    cerca de 4.000 caracteres). Ela diz ao modelo para chamar `show_app_guide`
    primeiro, que devolve todos os hooks, componentes e props que um app pode
    usar, com um exemplo completo. `show_app_guide` é oferecida onde quer que
    `show_app` seja oferecida.

  Cada leitura e salvamento na visualização é uma chamada das ferramentas de leitura e gravação,
  feita como a pessoa sob sua RLS, portanto um formulário oferece apenas o que foi
  concedido à conexão dela: sem `data:write`, ele é somente leitura, e um campo
  que suas roles não podem ler não aparece nele. Esse é o limite dentro do qual o código de um app
  também opera: ele roda na visualização, portanto cada chamada feita é uma
  daquelas ferramentas, como a pessoa, e ele não pode fazer nada que o modelo não pudesse fazer
  com as mesmas ferramentas. No conector hospedado, cada gravação também é planejada
  e confirmada pelo servidor. Dentro disso, o `useRowWrites` pergunta à pessoa
  antes de gravar, para que um app não grave sem o clique dela; os
  próprios controles do admin (o Salvar de um formulário, uma exclusão, uma edição de tabela) se comportam como em
  uma tela de `show_collection`. O modelo é informado sobre o que mudou. Ele lê as linhas retornadas por cada ferramenta, não as configurações de coleção com as quais a
  visualização é renderizada. Um cliente sem MCP Apps, como o Claude Code ou Cursor, não mostra nada,
  e o modelo lê as mesmas linhas que leria com `query_collection`.
- **Concessões feitas antes da versão 0.24 mantêm seu alcance.** `mcp:read` é lido como
  `data:read`, e `mcp:write` como `data:write data:delete`, em concessões armazenadas e
  em tokens já emitidos.
- **Uma chave de API também funciona.** `/mcp` também aceita `Authorization: Bearer rk_…`, para
  um cliente configurado com um cabeçalho em vez de um fluxo OAuth. A chave acessa
  as ferramentas que seus escopos `data:*` cobrem, atuando como quem ela representa: uma
  [chave pessoal](/docs/backend/api-keys/#personal-keys) como seu proprietário, uma chave de serviço
  como `api-key:<id>`.
- **O vocabulário do SDK, as respostas do REST.** As ferramentas aceitam o que o SDK aceita —
  `where` (`{"status": ["==", "paid"]}`), `orderBy` (`["created_at", "desc"]` ou
  `"created_at:desc"`), `limit`, `offset`, `searchString` e `data` para uma
  gravação — e leem por meio do caminho de `GET /api/data/<collection>`, de modo que uma linha retorna
  como o REST a serve (datas em ISO, um `belongsTo` como sua chave estrangeira, ex.:
  `authorId`) e pode ser enviada de volta em uma atualização sem alterações. `query_collection`
  responde `{ data, meta }` com `meta.total` e `meta.hasMore`, e `count_documents`
  com `{ count }`. `aggregate_documents` é `GET /api/data/<collection>/aggregate`:
  `select` é uma lista na gramática do REST (`["count()", "sum(total)"]`), `groupBy`
  uma lista de campos, e responde `{ data }` com uma linha por grupo, mais
  `meta.hasMore` em uma chamada agrupada, cujos grupos paginam com `limit` e `offset`
  e ordenam com `orderBy`. Em uma coleção que um callback `afterRead` reescreve, ele
  serve apenas `count()`, assim como o REST faz. Como no REST, um `limit` acima de 1000, um argumento não declarado e uma
  edição ou exclusão de uma linha na lixeira (404) são recusados; definir o campo de soft-delete
  como `null` a restaura. `deleted: "only"` (ou `"include"`) em
  `query_collection`, `count_documents` e `aggregate_documents` lê a lixeira, assim como o
  `?deleted=` do REST faz, para que uma linha movida para a lixeira por `delete_document` possa ser encontrada novamente para
  restauração. Sua descrição informa ao modelo que a exclusão é permanente apenas onde
  a coleção não possui um campo de soft-delete.
- **A listagem nomeia as coleções; `describe_collection` fornece o schema de uma delas.**
  `list_collections` responde com o `name`, `title` e `description` de cada coleção,
  e `describe_collection { collection }` com os schemas OpenAPI de `row` e
  `create` dessa coleção, mais `softDeleteField` onde as linhas vão para uma lixeira. As descrições
  das ferramentas instruem o modelo a descrever uma coleção antes de gravar nela. A
  listagem de um projeto com 200 coleções tem cerca de 5k tokens, e cada descrição
  menos de 1k; com todos os schemas na listagem, eram cerca de 150k.
- **Um token apenas para este endpoint.** Um token de acesso MCP é recusado por
  `/api/data`, `/api/admin` e pelo WebSocket, portanto conectar um assistente não
  concede a ele uma sessão.

Toda requisição para `/mcp` relê a conta da pessoa. Uma conta excluída ou desativada,
ou um "encerrar sessão em todos os lugares" ou alteração de senha após a emissão
do token, interrompe imediatamente um cliente conectado com um 401. Um rebaixamento de permissões se aplica à
sua próxima chamada de ferramenta. Todo refresh faz as mesmas verificações e recusa definitivamente
tal concessão. Uma sessão de convidado não pode dar consentimento de forma alguma.

Um limite. Desconectar um cliente (`DELETE /api/oauth/grants/:clientId`, com a
própria sessão da pessoa) revoga seus refresh tokens imediatamente, mas um token de acesso
já emitido continua funcionando até expirar, dentro de uma hora.

As rotas estão em [Endpoints](/docs/backend/endpoints/#mcp-surface) e as
variáveis em [Configuração](/docs/getting-started/configuration/#mcp-surface).
