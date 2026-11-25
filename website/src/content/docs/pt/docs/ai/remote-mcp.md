---
sourceHash: da06ce7daeaa1c32
title: O Endpoint MCP Remoto
sidebar_label: Endpoint MCP remoto
description: Disponibilize o MCP a partir de um backend implantado em /mcp, para que as pessoas que usam o seu aplicativo possam conectar o Claude ou o Cursor como elas mesmas — OAuth com uma tela de consentimento, dezessete ferramentas em três escopos, cada chamada sob sua própria segurança a nível de linha (row-level security).
---

:::tip[Conectando o Claude aos seus próprios projetos?]
Esse é o [conector Rebase](/docs/ai/rebase-connector/): um conector para
todos eles, e um servidor auto-hospedado conecta-se a ele com `rebase cloud connect`. Esta
página é para as pessoas que **usam** o seu aplicativo.
:::

O [servidor MCP](/docs/ai/mcp/) é uma ferramenta de desenvolvedor: ele roda na sua máquina e mantém uma chave
de serviço ou uma chave de API. Um backend implantado também pode servir o próprio MCP, em `/mcp`, para
as pessoas que usam a sua aplicação. Um assistente conectado por uma delas lê e
grava no projeto **como essa pessoa**, e cada chamada é executada sob sua própria
segurança a nível de linha (row-level security).

Ele fica desativado a menos que você o ative, e ambas as variáveis são obrigatórias:

```bash
REBASE_MCP_ENABLED=true
REBASE_PUBLIC_URL=https://app.example.com   # this deployment's real origin
```

Sem o `REBASE_PUBLIC_URL`, um segredo JWT ou um driver de dados capaz de delimitar uma consulta
a um único usuário, o endpoint se recusa a inicializar e informa o motivo no log de inicialização. Nenhum
`REBASE_ROLE` o ativa.

- **OAuth, com uma tela de consentimento.** Um cliente encontra o servidor de autorização
  por meio de `/.well-known/oauth-protected-resource`, registra a si mesmo (o registro
  dinâmico fica ativado por padrão; `REBASE_MCP_OPEN_REGISTRATION=false` o limita
  aos clientes que você registrar) e encaminha a pessoa para uma tela de consentimento que realiza
  o login através do seu `/auth/login` existente. Uma conta com um segundo fator
  de autenticação é então solicitada a fornecer o código do autenticador ou um código de recuperação, por meio das
  rotas existentes de `/auth/mfa/challenge`. Quando o próprio frontend do seu aplicativo
  mantém uma sessão no mesmo navegador, a tela oferece essa conta, e
  Permitir consente como ela sem necessidade de senha; é assim que alguém que faz login apenas
  com Google, GitHub ou link de e-mail se conecta. Caso contrário, faz login com uma
  senha, e quem não tiver uma deve defini-la primeiro com `/auth/forgot-password`
  ("Esqueci minha senha" do seu app); a tela informa isso. Ela também indica o host para o qual o código de autorização é enviado
  e informa que esse host não é verificado: qualquer pessoa pode registrar um cliente sob
  qualquer nome, portanto o host é a parte que o usuário pode verificar.
- **Dezessete ferramentas, três escopos.** Os mesmos [escopos](/docs/backend/roles-and-scopes/)
  que qualquer credencial usa. `data:read` oferece `list_tables`, `describe_table`,
  `query_table`, `count_rows`, `aggregate_rows`, `get_row`, as três visualizações,
  `show_table`, `show_record` e `show_app`, `show_app_guide`, além dos experimentais
  `list_apps` e `open_app`; `data:write` adiciona `create_row`, `update_row` e os
  experimentais `save_app` e `delete_app`; `data:delete` adiciona `delete_row`. Um cliente que não solicita
  nada recebe `data:read`. Cada um deles restringe-se a uma tabela: `data:read:posts`
  lista, descreve e lê `posts` e nada mais. Um escopo decide quais ferramentas são
  oferecidas e quais tabelas elas acessam, não quais linhas: uma lista vazia pode ser
  o RLS funcionando, e `data:write` ainda assim não consegue gravar uma linha que a pessoa não poderia.
- **Três ferramentas colocam o seu painel de administração diante da pessoa.** Em um cliente que
  renderiza MCP Apps, como o Claude, elas abrem as próprias visualizações do painel de administração
  na conversa, extraídas dos descritores de tabela que o backend serve para essa
  pessoa — colunas, enums, validações, relações — com as preferências de UI que o
  painel compõe: o `ui-config.json` fornecido no bundle, o do workspace e o da
  própria pessoa (uma chave de API não possui nenhum), para que rótulos, ordem das colunas, colunas
  ocultas e rótulos de enum correspondam ao painel. As próprias personalizações do painel
  do seu projeto são exibidas onde o backend serve a sua visualização MCP.
  - `show_table` recebe os argumentos de `query_table`, mais `view`
    (`table`, `list`, `cards` ou `kanban`), e abre a visualização da tabela: a
    pessoa pode pesquisar, filtrar, ordenar e paginar, abrir o formulário de uma linha e adicionar linhas.
  - `show_record` abre o formulário de uma linha (`id`) ou um formulário para uma nova linha a
    partir dos `values` preenchidos pelo modelo, para que a própria pessoa revise e
    salve.
  - `show_app` executa um app que o modelo escreve para a tarefa em questão: um
    componente React (`code`) e as `tables` que ele lê. Ele importa os próprios
    pacotes do Rebase, de modo que o mesmo código funcione no seu projeto:
    - `@rebasepro/app`: `useRows`, `useRow`, `useRowCount`, `useAggregate`
      e `useRowWrites` sobre as linhas do projeto;
    - `@rebasepro/cms`: o `CollectionPanel` do painel de administração (com o
      `CollectionToolbar` e suas partes, e `onRowClick`, que entrega ao
      app a linha clicada conforme o `useRows` a lê), `RecordForm` e `FormField`,
      `RecordDetail`, `FieldValue` e `useSidePanel`, cada um nomeando sua
      tabela por caminho, com seus campos, visualizações e ações customizados;
    - `@rebasepro/ui`: todo o kit de UI, `SplitView` e os blocos e gráficos
      de KPI incluídos.

    O servidor o compila primeiro, de modo que um erro de sintaxe, um módulo que a visualização
    não serve ou um nome que ela não disponibiliza de `@rebasepro/cms` ou
    `@rebasepro/app` torna-se o erro da chamada, indicando sua linha. Um erro durante
    a execução é exibido em seu lugar e informado ao modelo na mensagem seguinte da pessoa.
    Um app pode usar apenas as tabelas que listar. Seus estilos
    utilizam os utilitários padrão do Tailwind, compilados com a visualização antes da chegada de
    qualquer app: um valor arbitrário como `h-[560px]` não terá efeito, portanto
    um tamanho exato deve ser definido via `style`.

    A descrição de `show_app` contém apenas o essencial, pois um cliente
    pode truncar descrições de ferramentas muito longas (o claude.ai faz isso por volta de 4.000
    caracteres). Ela instrui o modelo a chamar primeiro `show_app_guide`, que
    retorna cada hook, componente e prop que um app pode usar, com um exemplo
    prático. `show_app_guide` é disponibilizado onde quer que `show_app` esteja.

  Cada leitura e salvamento na visualização é uma chamada das ferramentas de leitura e escrita,
  feita como a pessoa e sob seu RLS, de modo que um formulário oferece apenas o que foi
  concedido à conexão: sem `data:write` ele é somente leitura, e um campo
  que seus papéis não podem ler não é exibido. Esse é o limite no qual o código de um
  app também opera: ele roda na visualização, portanto cada chamada feita é uma
  dessas ferramentas, como a pessoa, e ele não pode fazer nada além do que o modelo poderia fazer
  com as mesmas ferramentas. No conector hospedado, cada gravação também é planejada
  e confirmada pelo servidor. Além disso, o `useRowWrites` pergunta à pessoa
  antes de gravar, para que um app não realize gravações sem o clique do usuário; os
  próprios controles do painel de administração (o Salvar de um formulário, uma exclusão, uma edição de tabela) comportam-se como
  fariam em uma tela do `show_table`. O modelo é notificado sobre o que foi alterado. Ele lê as linhas retornadas por cada ferramenta, não os descritores com os quais a
  visualização desenha. Um cliente sem suporte a MCP Apps, como o Claude Code ou Cursor, não exibe nada,
  e o modelo lê as mesmas linhas que leria de `query_table`.
- **Experimental: apps salvos no projeto.** `save_app` mantém um app construído
  pelo modelo com `show_app` para que ele possa ser aberto novamente: compila o código assim
  como `show_app` faz e o armazena com seu `title`, `tables` e
  `visibility`, que pode ser `personal` (seu proprietário, o padrão), `roles` (qualquer pessoa
  que possua uma de suas `roles`) ou `team` (todos que fizerem login). Salvar para
  mais do que apenas você exige a role de administrador, já que um app compartilhado é um código escrito por
  IA sendo executado para outras pessoas. Apenas seu proprietário ou um administrador pode substituir
  (`id`) ou excluir um app, e cada pessoa pode manter no máximo 200. `list_apps` lista
  os apps que quem chama tem permissão para abrir, `open_app` abre um como `show_app` faria e
  `delete_app` remove um. Ver um app não significa ter acesso aos seus dados: um app
  aberto lê e grava por meio das ferramentas acima, agindo como quem o abriu, sob
  o RLS dessa pessoa. Os apps ficam em `rebase.saved_apps`, tabela que o backend cria
  na primeira vez em que uma ferramenta a utiliza e não concede permissão a nenhum usuário final.
  O painel de administração abre os mesmos apps: adicione `savedAppsView` de
  `@rebasepro/cms` às suas `views`. Ele executa o app em um iframe em sandbox
  sem `allow-same-origin` e sem rede própria, e repassa suas chamadas de
  ferramentas para `POST /api/admin/apps/mcp`, as mesmas ferramentas para a sessão do
  painel de administração, que é montada com as rotas de administração independentemente de
  `REBASE_MCP_ENABLED` estar definido ou não. Os nomes e formatos das ferramentas ainda podem mudar.
- **Permissões (grants) concedidas antes da versão 0.24 mantêm seu alcance.** `mcp:read` é interpretado como
  `data:read`, e `mcp:write` como `data:write data:delete`, tanto em permissões armazenadas quanto
  em tokens já emitidos.
- **Uma chave de API também funciona.** `/mcp` também aceita `Authorization: Bearer rk_…`, para
  um cliente configurado com um cabeçalho em vez de um fluxo OAuth. A chave tem acesso
  às ferramentas que seus escopos `data:*` cobrem, agindo como quem ela representa: uma
  [chave pessoal](/docs/backend/api-keys/#personal-keys) como seu proprietário, uma chave de serviço
  como `api-key:<id>`.
- **O vocabulário do SDK, as respostas do REST.** As ferramentas aceitam o que o SDK aceita —
  `where` (`{"status": ["==", "paid"]}`), `orderBy` (`["created_at", "desc"]` ou
  `"created_at:desc"`), `limit`, `offset`, `searchString`, e `data` para uma
  gravação — e leem através do caminho de `GET /api/data/<table>`, de modo que uma linha retorne
  como o REST a entrega (datas em formato ISO, um `belongsTo` como sua chave estrangeira, por exemplo,
  `authorId`) e possa ser enviada de volta em uma atualização sem alterações. `query_table`
  responde `{ data, meta }` com `meta.total` e `meta.hasMore`, e `count_rows`
  responde `{ count }`; `tools/list` fornece para ambos, além de `aggregate_rows` e `get_row`,
  um `outputSchema`, flexível onde a resposta puder variar. `aggregate_rows` corresponde a `GET /api/data/<table>/aggregate`:
  `select` é uma lista na sintaxe do REST (`["count()", "sum(total)"]`), `groupBy`
  é uma lista de campos, e responde `{ data }` com uma linha por grupo, além de
  `meta.hasMore` em uma chamada agrupada, cujos grupos paginam com `limit` e `offset`
  e são ordenados com `orderBy`. Em uma tabela que um hook `afterRead` reescreve,
  serve apenas `count()`, assim como o REST faz. Como no REST, um `limit` acima de 1000, um argumento não declarado e uma
  edição ou exclusão de uma linha na lixeira (404) são recusados; definir o campo de
  exclusão lógica (soft-delete) como `null` a restaura. `deleted: "only"` (ou `"include"`) em
  `query_table`, `count_rows` e `aggregate_rows` lê a lixeira, assim como o
  `?deleted=` do REST faz, permitindo que uma linha enviada para a lixeira por `delete_row` possa ser encontrada novamente para
  restauração. Sua descrição informa ao modelo que a exclusão só é permanente quando
  a tabela não possui um campo de soft-delete.
- **A listagem indica as tabelas; `describe_table` fornece o schema de uma delas.**
  `list_tables` responde `{ tables: [{ name, description, kind? }] }` — sem rótulo —
  e `describe_table { table }` responde com os schemas OpenAPI de `row` (as colunas servidas a quem chama) e `create` (as graváveis)
  dessa tabela, sua `primaryKey`, `relations` servidas e `rls` (SQL bruto
  omitido sem `schema:read`), além de `softDeleteField` onde as linhas vão para a
  lixeira, e a apresentação determinada pelas preferências de UI de quem chama: `title`, e
  por coluna `label`, `valueLabels`, `hidden`, `hiddenInForm`, `readOnly`. O que uma
  conexão pode saber sobre o schema é definido pelo mesmo serializador que
  `GET /api/schema/tables` utiliza. As descrições das ferramentas instruem o modelo a
  descrever uma tabela antes de gravar nela. A listagem de um projeto com 200 tabelas tem
  cerca de 5 mil tokens, e cada descrição
  tem menos de 1 mil; com todos os schemas na listagem, ficava em torno de 150 mil.
- **Um token exclusivo para este endpoint.** Um token de acesso MCP é recusado por
  `/api/data`, `/api/admin` e pelo WebSocket, de modo que conectar um assistente não
  concede a ele uma sessão.

Toda requisição para `/mcp` relê a conta da pessoa. Uma conta excluída ou desativada,
ou uma ação de "desconectar de todos os lugares" ou alteração de senha após a emissão do token,
interrompe imediatamente um cliente conectado com um 401. Um rebaixamento de permissões se aplica à sua
próxima chamada de ferramenta. Cada atualização (refresh) faz as mesmas verificações e recusa definitivamente
tal concessão. Uma sessão de convidado não pode dar consentimento de forma alguma.

Uma limitação. Desconectar um cliente (`DELETE /api/oauth/grants/:clientId`, com a
própria sessão da pessoa) revoga imediatamente seus tokens de atualização (refresh tokens), mas um token de acesso
já emitido continuará funcionando até expirar, o que ocorre dentro de uma hora.

## Skills

O endpoint também pode servir [Agent Skills](https://agentskills.io/specification)
sobre MCP: instruções que um assistente carrega quando a tarefa necessita delas, como
a forma pela qual sua equipe registra um pedido ou o que determinado campo significa. Coloque cada skill em sua própria
pasta, contendo um arquivo `SKILL.md` cujo frontmatter tenha um `name` correspondente ao nome da pasta
e uma `description`, além de quaisquer arquivos aos quais ele faça link. Em seguida, especifique a pasta pai
na configuração do backend:

```ts
// skills/order-intake/SKILL.md, skills/order-intake/references/fields.md, …
createRebaseBackend({
    ...options, // the rest of your backend config
    mcp: { skills: "./skills" }
});
```

O caminho é relativo ao diretório de trabalho. As ferramentas de dados permanecem
inalteradas, e `skills` fica ao lado de `tools` quando um backend fornece as suas próprias.

- **O que um cliente visualiza.** Clientes na revisão do protocolo 2026-07-28 ou posterior
  (Claude Code, Claude) listam as skills e carregam uma quando ela for relevante.
  O Claude Code nomeia cada uma como `<connector>:<skill>`. Elas são servidas por meio
  da extensão de skills do MCP (`io.modelcontextprotocol/skills`): `skills/list`,
  `skills/get` e `resources/read` de `skill://<name>/…`. Cada skill vem
  com um manifesto SHA-256 de seus arquivos. O cliente verifica cada arquivo em relação a
  esse manifesto, e a aprovação do usuário fica vinculada a ele.
- **Quem pode lê-las.** Qualquer conexão autenticada, independentemente de seus escopos.
  Não coloque nada em uma skill que não seja destinado a todos que se conectarem.
- **Quando elas mudam.** A pasta é lida na primeira requisição que necessitar dela,
  portanto uma edição entra em vigor no próximo deploy ou reinicialização. Um arquivo alterado em
  disco antes disso é recusado, não sendo servido contra um manifesto com o qual já não
  coincide mais.
- **O que é ignorado.** Uma skill que viola uma regra é ignorada, e o log de inicialização
  informa o motivo. As regras: ausência de frontmatter, um nome diferente da sua pasta,
  um symlink interno, ou mais de 512 arquivos ou 16 MiB. Arquivos ocultos como
  `.gitkeep` nunca são servidos. Uma skill acima dos limites do próprio Claude Code (100 KB
  por arquivo, 400 KB no total) é servida com um aviso, pois o Claude Code não
  a carregará.

O endpoint atende a ambas as eras do protocolo. Um cliente da era 2025 inicia com
`initialize`, como antes. Um cliente da versão 2026-07-28 não envia handshake. Cada requisição
carrega sua versão do protocolo e recursos em `params._meta`, além dos cabeçalhos
`MCP-Protocol-Version`, `Mcp-Method` e `Mcp-Name`, que devem corresponder
ao corpo da requisição. Seus recursos vêm de `server/discover`. As skills são
declaradas apenas lá.

As rotas estão em [Endpoints](/docs/backend/endpoints/#mcp-surface) e as
variáveis em [Configuração](/docs/getting-started/configuration/#mcp-surface).
