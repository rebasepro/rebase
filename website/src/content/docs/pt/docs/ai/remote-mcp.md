---
sourceHash: 3e29eee7079b7ef3
title: O Endpoint MCP Remoto
sidebar_label: Endpoint MCP remoto
description: Sirva MCP a partir de um backend implantado em /mcp, para que as pessoas que usam seu app possam conectar o Claude ou o Cursor como elas mesmas — OAuth com uma tela de consentimento, dezessete ferramentas sob três escopos, cada chamada sob sua própria segurança em nível de linha.
---

:::tip[Conectando o Claude aos seus próprios projetos?]
Esse é o [conector Rebase](/docs/ai/rebase-connector/): um conector para
todos eles, e um servidor auto-hospedado conecta-se a ele com `rebase cloud connect`. Esta
página é para as pessoas que **usam** seu app.
:::

O [servidor MCP](/docs/ai/mcp/) é uma ferramenta de desenvolvedor: ele roda na sua máquina e mantém uma chave
de serviço ou uma chave de API. Um backend implantado também pode servir o MCP por si só, em `/mcp`, para
as pessoas que usam seu aplicativo. Um assistente que uma delas conectar lê e
escreve no projeto **como essa pessoa**, e cada chamada é executada sob a sua própria
segurança em nível de linha.

Ele fica desativado a menos que você o ative, e ambas as variáveis são obrigatórias:

```bash
REBASE_MCP_ENABLED=true
REBASE_PUBLIC_URL=https://app.example.com   # this deployment's real origin
```

Sem `REBASE_PUBLIC_URL`, um segredo JWT ou um driver de dados capaz de definir o escopo de uma consulta
para um único usuário, o endpoint recusa a inicialização e informa o motivo no log de boot. Nenhuma
`REBASE_ROLE` o ativa.

O `rebase dev` é a única exceção: ele ativa o `/mcp` para o servidor que
inicia, e esse servidor define seu próprio endereço, `http://localhost:<port>`, como
a URL pública, então não há nada para configurar. Uma linha `REBASE_MCP_ENABLED`
no terminal ou no `.env` ainda tem precedência, incluindo `false`. O banner de dev
exibe o endpoint em uma linha `MCP:` assim que ele for montado.

## Conectando um cliente

```bash
rebase mcp connect            # pick the clients to connect, from a list
rebase mcp connect --client claude-code,cursor
rebase mcp connect --print    # the URL, the command and the install links; changes nothing
rebase mcp url                # the URL alone
```

O `rebase mcp connect` pergunta ao servidor onde o `/mcp` está, lendo o documento que
ele publica em `/.well-known/oauth-protected-resource/mcp`, garantindo que a URL esteja correta
atrás de um proxy, sob `REBASE_PUBLIC_URL` e em uma porta de dev alterada. Em seguida, ele
conecta cada cliente que você selecionar:

| Cliente | `--client` | O que acontece |
|---|---|---|
| Claude Code | `claude-code` | Executa `claude mcp add --transport http <name> <url>` |
| Cursor | `cursor` | Abre o link de instalação do Cursor |
| VS Code | `vscode` | Abre o link de instalação do VS Code |
| Claude (claude.ai, desktop, mobile) | `claude` | Exibe os passos para Configurações → Conectores, com a URL para colar |
| ChatGPT | `chatgpt` | Exibe os passos para as configurações de conector dele |

Os clientes encontrados instalados já vêm marcados. O Claude e o ChatGPT se conectam
a partir de seus próprios servidores, que não conseguem alcançar o `localhost`; portanto, em relação a um servidor de dev,
eles são listados como necessitando de um projeto implantado. `--client all` seleciona todos.
Sem um terminal ou sob `--json`, e sem `--client`, o comando exibe o que
`--print` exibe e não conecta nada.

O servidor consultado é o do próprio projeto: `REBASE_BASE_URL`, caso contrário, o
`rebase dev` em execução. `--cloud` consulta o projeto do Rebase Cloud ao qual o
diretório está vinculado, e `--url <server>` qualquer backend. Um servidor com o `/mcp` desativado
não responde nada ali, e o comando informa como ativá-lo.

O servidor é registrado com o nome do projeto, com `-local` para uma instância nesta
máquina, de modo que um projeto local e um implantado possam ambos estar conectados; `--name`
altera isso. Ele nunca é chamado de `rebase`, o nome do [servidor MCP de desenvolvedor](/docs/ai/mcp/)
no `.mcp.json` de um projeto, o qual um segundo servidor com o mesmo nome ocultaria.

O painel de administração oferece os mesmos passos. Seu drawer possui um botão **Connect AI**
que mostra a URL publicada pelo servidor, o comando `claude mcp add`, os
links de instalação do Cursor e do VS Code e, em um projeto implantado, os passos do
conector para Claude e ChatGPT. Abaixo deles, ele lista os agentes que a pessoa conectada
associou, cada um com uma opção para desconectá-lo. Todos os usuários autenticados
veem o botão enquanto o `/mcp` estiver ativado. Enquanto estiver desativado, apenas um administrador
o vê, juntamente com instruções sobre como ativá-lo.

## O que uma conexão obtém

- **OAuth, com uma tela de consentimento.** Um cliente localiza o servidor de autorização
  por meio de `/.well-known/oauth-protected-resource`, registra a si mesmo (o registro
  dinâmico é ativado por padrão; `REBASE_MCP_OPEN_REGISTRATION=false` limita-o
  aos clientes que você registrar) e direciona a pessoa a uma tela de consentimento que realiza o login
  através do seu `/auth/login` existente. Uma conta com um segundo fator
  é então solicitada a fornecer seu código de autenticador ou um código de recuperação, por meio das
  rotas `/auth/mfa/challenge` existentes. Quando o próprio frontend do seu app
  mantém uma sessão no mesmo navegador, a tela oferece essa conta, e
  Permitir consente com ela sem senha; é assim que alguém que faz login apenas
  com Google, GitHub ou link por e-mail se conecta. Caso contrário, o login é feito com
  senha, e quem não tiver uma define uma primeiro com `/auth/forgot-password`
  ("Esqueci minha senha" do seu app); a tela avisa sobre isso. Ela também informa o host para o qual o código de autorização é enviado
  e indica que esse host não é verificado: qualquer pessoa pode registrar um cliente sob
  qualquer nome, portanto o host é a parte que o usuário pode verificar.
- **Dezessete ferramentas, três escopos.** Os mesmos [escopos](/docs/backend/roles-and-scopes/)
  que qualquer credencial usa. `data:read` oferece `list_tables`, `describe_table`,
  `query_table`, `count_rows`, `aggregate_rows`, `get_row`, as três visualizações,
  `show_table`, `show_record` e `show_app`, `show_app_guide`, e os experimentais
  `list_apps` e `open_app`; `data:write` adiciona `create_row`, `update_row` e os
  experimentais `save_app` e `delete_app`; `data:delete` adiciona `delete_row`. Um cliente que não pede
  nada recebe `data:read`. Cada um pode ser restrito a uma tabela: `data:read:posts`
  lista, descreve e lê `posts` e nada mais. Um escopo decide quais ferramentas são
  oferecidas e quais tabelas elas alcançam, não quais linhas: uma lista vazia pode ser o
  RLS funcionando, e `data:write` ainda assim não pode gravar uma linha que a pessoa não poderia.
- **Três ferramentas colocam seu painel de administração diante do usuário.** Em um cliente que
  renderiza MCP Apps, como o Claude, elas abrem as próprias visualizações do painel de administração na
  conversa, desenhadas a partir dos descritores de tabela que o backend serve para essa
  pessoa — colunas, enums, validação, relações — com as preferências de interface que o
  painel compõe: o `ui-config.json` incluído no pacote, as do workspace e
  as da própria pessoa (uma chave de API não possui nenhuma), para que rótulos, ordem das colunas, colunas
  ocultas e rótulos de enum correspondam ao painel. As personalizações de painel do seu próprio
  projeto são exibidas onde o backend serve sua visualização MCP.
  - `show_table` aceita os argumentos de `query_table`, mais `view`
    (`table`, `list`, `cards` ou `kanban`), e abre a visualização da tabela: a
    pessoa pode pesquisar, filtrar, ordenar e paginar, abrir o formulário de uma linha e adicionar linhas.
  - `show_record` abre o formulário de uma única linha (`id`), ou um formulário para uma nova linha que
    inicia a partir dos `values` preenchidos pelo modelo, para que a própria pessoa verifique
    e salve.
  - `show_app` executa um aplicativo escrito pelo modelo para a tarefa em questão: um
    componente React (`code`) e as `tables` que ele lê. Ele importa os próprios
    pacotes do Rebase, para que o mesmo código funcione no seu projeto:
    - `@rebasepro/app`: `useRows`, `useRow`, `useRowCount`, `useAggregate`
      e `useRowWrites` sobre as linhas do projeto;
    - `@rebasepro/cms`: o `CollectionPanel` do painel de administração (com
      `CollectionToolbar` e seus componentes, e `onRowClick`, que repassa ao
      app a linha clicada conforme lida por `useRows`), `RecordForm` e `FormField`,
      `RecordDetail`, `FieldValue` e `useSidePanel`, cada um nomeando sua
      tabela por caminho, com seus campos, visualizações e ações customizados;
    - `@rebasepro/ui`, todo o kit de interface, incluindo `SplitView` e os blocos e
      gráficos de KPI.

    O servidor o compila primeiro; assim, um erro de sintaxe, um módulo que a visualização não
    fornece ou um nome não exportado por `@rebasepro/cms` ou
    `@rebasepro/app` resulta no erro da chamada, indicando sua linha. Um erro durante a
    execução é exibido em seu lugar e informado ao modelo na próxima mensagem
    da pessoa. Um app só pode usar as tabelas que listar. Seus estilos usam
    os utilitários padrão do Tailwind, construídos com a visualização antes da chegada de qualquer aplicativo: um
    valor arbitrário como `h-[560px]` não tem efeito ali, portanto, um
    tamanho exato deve ser definido via `style`.

    A descrição de `show_app` contém apenas o essencial, pois um cliente
    pode truncar descrições longas de ferramentas (o claude.ai faz isso por volta de 4.000
    caracteres). Ela instrui o modelo a chamar primeiro `show_app_guide`, que
    retorna todos os hooks, componentes e props que um app pode usar, com um
    exemplo prático. O `show_app_guide` é disponibilizado onde quer que o `show_app` esteja.

  Cada leitura e salvamento na visualização é uma chamada das ferramentas de leitura e escrita,
  feita como o usuário sob seu RLS, de modo que um formulário oferece apenas o que sua
  conexão foi concedida: sem `data:write` ele é somente leitura, e um campo que
  seus papéis não possam ler não é exibido nele. Esse é também o limite dentro do qual o código de um
  aplicativo opera: ele roda na visualização, portanto cada chamada realizada é uma
  dessas ferramentas, como a própria pessoa, e não pode fazer nada além do que o modelo poderia fazer
  com essas mesmas ferramentas. No conector hospedado, cada gravação também é planejada
  e confirmada pelo servidor. Dentro disso, o `useRowWrites` pergunta ao usuário
  antes de gravar, para que um app não faça gravações sem o seu clique; os
  próprios controles do admin (o botão Salvar de um formulário, uma exclusão, uma edição na tabela) comportam-se como
  fariam em uma tela do `show_table`. O modelo é informado sobre o que eles alteraram. Ele lê as linhas que cada ferramenta responde, e não os descritores com os quais a
  visualização desenha a interface. Um cliente sem suporte a MCP Apps, como Claude Code ou Cursor, não exibe nada,
  e o modelo lê as mesmas linhas que leria a partir de `query_table`.
- **Experimental: aplicativos salvos no projeto.** `save_app` mantém um app que o
  modelo construiu com `show_app` para que possa ser aberto novamente: ele compila o código assim
  como `show_app` e o armazena com seu `title`, `tables` e
  `visibility`, que pode ser `personal` (seu proprietário, o padrão), `roles` (qualquer pessoa
  que possua uma de suas `roles`) ou `team` (todos os que fazem login). Salvar para
  outras pessoas além de si mesmo exige a role de admin, já que um app compartilhado é um código escrito por IA
  sendo executado para outras pessoas. Apenas seu proprietário ou um admin pode substituir
  (`id`) ou excluir um app, e cada pessoa pode manter no máximo 200. `list_apps` lista
  os apps que o chamador pode abrir, `open_app` abre um como o `show_app` faria e
  `delete_app` remove um app. Ter acesso visual a um app não significa acessar seus dados: um
  app aberto lê e grava por meio das ferramentas acima, como o usuário que o abriu, sob
  seu RLS. Os aplicativos ficam em `rebase.saved_apps`, que o backend cria
  na primeira vez em que uma ferramenta o utiliza e não concede permissão a nenhum usuário final.
  O painel de administração abre os mesmos aplicativos: adicione `savedAppsView` de
  `@rebasepro/cms` às suas `views`. Ele executa um app em um iframe em sandbox
  sem `allow-same-origin` e sem rede própria, e encaminha suas chamadas
  de ferramenta para `POST /api/admin/apps/mcp`, as mesmas ferramentas para a sessão do
  painel de administração, que é montada com as rotas de admin independentemente de
  `REBASE_MCP_ENABLED` estar definido ou não. Os nomes e formatos das ferramentas ainda podem mudar.
- **Concessões feitas antes da versão 0.24 mantêm seu alcance.** `mcp:read` é interpretado como
  `data:read`, e `mcp:write` como `data:write data:delete`, em concessões armazenadas e
  em tokens já emitidos.
- **Uma chave de API também funciona.** `/mcp` também aceita `Authorization: Bearer rk_…`, para
  um cliente configurado com um cabeçalho em vez de um fluxo OAuth. A chave tem acesso
  às ferramentas cobertas pelos seus escopos `data:*`, atuando em nome de sua respectiva identidade: uma
  [chave pessoal](/docs/backend/api-keys/#personal-keys) atua como seu proprietário, uma chave de serviço
  atua como `api-key:<id>`.
- **O vocabulário do SDK, as respostas da REST.** As ferramentas recebem os mesmos parâmetros que o SDK recebe —
  `where` (`{"status": ["==", "paid"]}`), `orderBy` (`["created_at", "desc"]` ou
  `"created_at:desc"`), `limit`, `offset`, `searchString` e `data` para uma
  gravação — e realizam a leitura pelo caminho de `GET /api/data/<table>`, portanto uma linha retorna
  no formato servido pela REST (datas em ISO, um `belongsTo` como sua chave estrangeira, ex.:
  `authorId`) e pode ser enviada de volta em uma atualização sem alterações. `query_table`
  responde `{ data, meta }` com `meta.total` e `meta.hasMore`, e `count_rows`
  `{ count }`; `tools/list` fornece a ambos, `aggregate_rows` e `get_row`
  um `outputSchema`, flexível onde a resposta puder variar. `aggregate_rows` corresponde a `GET /api/data/<table>/aggregate`:
  `select` é uma lista na gramática da REST (`["count()", "sum(total)"]`), `groupBy`
  uma lista de campos, respondendo `{ data }` com uma linha por grupo, além de
  `meta.hasMore` em chamadas agrupadas, cujos grupos paginam com `limit` e `offset`
  e ordenam com `orderBy`. Em uma tabela reescrita por um hook `afterRead`, ele
  serve apenas `count()`, assim como a REST faz. Como na REST, um `limit` acima de 1000, um argumento não declarado e a
  edição ou exclusão de uma linha na lixeira (404) são recusados; definir o campo de soft-delete
  para `null` a restaura. `deleted: "only"` (ou `"include"`) em
  `query_table`, `count_rows` e `aggregate_rows` faz a leitura da lixeira, assim como o
  `?deleted=` da REST, para que uma linha enviada para a lixeira por `delete_row` possa ser encontrada novamente para
  restauração. Sua descrição informa ao modelo que a exclusão só é permanente onde
  a tabela não possui campo de soft-delete.
- **A listagem nomeia as tabelas; `describe_table` fornece o esquema de uma.**
  `list_tables` responde com `{ tables: [{ name, description, kind? }] }` — sem rótulo —
  e `describe_table { table }` fornece os esquemas OpenAPI `row` (as colunas servidas a este chamador) e `create` (as graváveis)
  dessa tabela, sua `primaryKey`, `relations` servidas e `rls` (SQL bruto
  redigido sem `schema:read`), além de `softDeleteField` quando as linhas vão para a
  lixeira, e a apresentação configurada pelas preferências de UI do chamador: `title`, e
  por coluna `label`, `valueLabels`, `hidden`, `hiddenInForm`, `readOnly`. O que uma
  conexão pode saber sobre o esquema é definido pelo mesmo serializador que o
  `GET /api/schema/tables` utiliza. As descrições das ferramentas instruem o modelo a
  descrever uma tabela antes de gravar nela. A listagem de um projeto com 200 tabelas ocupa
  cerca de 5k tokens, e cada descrição
  menos de 1k; com todos os esquemas na listagem, chegava a cerca de 150k.
- **Um token exclusivo para este endpoint.** Um token de acesso MCP é recusado por
  `/api/data`, `/api/admin` e pelo WebSocket; portanto, conectar um assistente não
  entrega a ele uma sessão.

Cada requisição para `/mcp` lê novamente a conta da pessoa. Uma conta excluída ou desativada,
ou uma ação de "desconectar de todos os dispositivos" ou alteração de senha após a emissão do token
interrompe imediatamente o cliente conectado com um 401. Um rebaixamento de permissões se aplica à sua
próxima chamada de ferramenta. Cada refresh realiza as mesmas verificações e recusa tal concessão
em definitivo. Uma sessão de convidado não tem permissão para consentir.

Uma limitação: desconectar um cliente (`DELETE /api/oauth/grants/:clientId`, com a
própria sessão do usuário) revoga seus tokens de refresh imediatamente, mas um token de acesso
já emitido continua funcionando até expirar, dentro do prazo de uma hora.

## Skills

O endpoint também pode servir [Agent Skills](https://agentskills.io/specification)
via MCP: instruções que um assistente carrega quando a tarefa exige, como a forma com que
sua equipe registra um pedido ou o que um determinado campo significa. Coloque cada skill em sua própria
pasta, com um arquivo `SKILL.md` cujo frontmatter contenha um `name` correspondente à pasta
e uma `description`, além de quaisquer arquivos vinculados a ela. Em seguida, informe a pasta pai
na configuração do backend:

```ts
// skills/order-intake/SKILL.md, skills/order-intake/references/fields.md, …
createRebaseBackend({
    ...options, // the rest of your backend config
    mcp: { skills: "./skills" }
});
```

O caminho é relativo ao diretório de trabalho. As ferramentas de dados permanecem inalteradas,
e `skills` fica ao lado de `tools` quando o backend fornece as suas próprias.

- **O que o cliente vê.** Clientes na revisão de protocolo 2026-07-28 ou posterior
  (Claude Code, Claude) listam as skills e carregam uma quando relevante.
  O Claude Code nomeia cada uma como `<connector>:<skill>`. Elas são servidas por meio
  da extensão de skills do MCP (`io.modelcontextprotocol/skills`): `skills/list`,
  `skills/get` e `resources/read` de `skill://<name>/…`. Cada skill vem acompanhada
  de um manifesto SHA-256 de seus arquivos. O cliente valida cada arquivo em relação a
  esse manifesto, e a aprovação do usuário fica vinculada a ele.
- **Quem pode lê-las.** Qualquer conexão autenticada, independentemente de seus escopos.
  Não coloque nada em uma skill que não seja destinado a todos os usuários que se conectam.
- **Quando elas mudam.** A pasta é lida na primeira requisição que necessita dela,
  portanto uma edição surte efeito no próximo deploy ou reinicialização. Um arquivo alterado em
  disco antes disso é recusado, e não servido com base em um manifesto com o qual já não
  coincide mais.
- **O que fica de fora.** Uma skill que violar uma regra é ignorada, e o log de boot
  indica o motivo. As regras: ausência de frontmatter, um nome diferente do de sua pasta,
  um symlink interno ou mais de 512 arquivos ou 16 MiB. Arquivos ocultos como
  `.gitkeep` nunca são servidos. Uma skill que exceda os limites do próprio Claude Code (100 KB
  por arquivo, 400 KB no total) é servida com um aviso, pois o Claude Code não a
  carregará.

O endpoint responde a ambas as eras do protocolo. Um cliente da era 2025 inicia com
`initialize`, como anteriormente. Um cliente 2026-07-28 não envia handshake. Cada requisição
carrega sua versão de protocolo e capacidades em `params._meta`, além dos
cabeçalhos `MCP-Protocol-Version`, `Mcp-Method` e `Mcp-Name`, que devem corresponder
ao corpo da requisição. Suas capacidades vêm de `server/discover`. As skills são
declaradas apenas lá.

As rotas estão em [Endpoints](/docs/backend/endpoints/#mcp-surface) e as
variáveis em [Configuration](/docs/getting-started/configuration/#mcp-surface).
