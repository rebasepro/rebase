---
sourceHash: f7689301748e2ce5
title: Tabelas no CMS
sidebar_label: Tabelas no CMS
description: "Como o CMS exibe todas as tabelas do Postgres sem nenhuma configuração de frontend: rótulos, o widget atribuído a cada tipo de coluna, campos obrigatórios e somente leitura, relações, slots de exibição e controles de Criação, Edição e Exclusão que respeitam a segurança em nível de linha (RLS) da tabela."
---

<span class="since-badge" data-since="0.31">Desde 0.31</span>

Se você usa o CMS, não precisa descrever suas tabelas para ele. Quando alguém faz
login, o painel solicita ao backend as tabelas que essa pessoa pode ver e exibe
cada uma delas como uma **coleção**: uma página na navegação com uma visualização
em tabela, um formulário, filtros e as linhas relacionadas do registro. Uma tabela
é o objeto de backend que você declara em [`backend/schema`](/docs/schema/); uma
coleção é a forma como o painel a exibe.

```tsx
// frontend/src/App.tsx: nothing about posts, users or tags here.
<Rebase client={rebaseClient} authController={authController}>
    <RebaseAuth/>
    <RebaseCMS/>
    <RebaseShell title="Acme"/>
</Rebase>
```

Tudo abaixo é derivado do descritor da tabela: suas colunas com seus tipos
Postgres, nulabilidade, valores padrão (defaults), regras de validação e
armazenamento, suas relações e sua postura de segurança em nível de linha
(row-level security). Para alterar qualquer um desses pontos, adicione um arquivo
[`customizeTable`](/docs/frontend/customize-table/); ele define apenas o que for
diferente.

:::note[Migrando de coleções?]
O painel costumava ler `config/collections` por meio de um plugin do Vite. Agora,
ele lê as tabelas fornecidas pelo backend, e a apresentação fica em
`frontend/src/cms/*.tsx`.
:::

## De onde vêm as tabelas

<span class="since-badge" data-since="0.31">Desde 0.31</span>

O `<RebaseCMS>` chama `client.schema.tables()`, que lê
`GET /api/schema/tables`. A resposta é a lista de descritores de tabelas,
filtrada para o solicitante: uma tabela que ele não pode ler fica ausente, assim
como uma coluna que suas roles (funções) não podem ler (consulte
[Acesso a campos](/docs/collections/field-access/)). O código dos hooks nunca sai
do servidor; o descritor apenas informa quais hooks existem.

- O painel faz a solicitação assim que alguém faz login e solicita novamente
  quando o usuário conectado ou suas roles mudam. Um visitante desconectado não
  recebe nenhuma tabela.
- O servidor marca a resposta com um `ETag`. O cliente mantém a última resposta e
  envia a tag de volta, de modo que um esquema inalterado custa apenas um `304`.
- Atualizar a navegação faz uma nova solicitação. O editor de esquema faz isso
  depois de alterar uma tabela.

Os mesmos descritores alimentam o Studio e os apps MCP, garantindo que os três
estejam em sincronia sobre o que é uma tabela.

## Rótulos

<span class="since-badge" data-since="0.31">Desde 0.31</span>

Cada rótulo é derivado de um identificador, de modo que uma tabela seja lida da
mesma forma para qualquer solicitante e em cada carregamento:

| Identificador | Rótulo |
|---|---|
| coluna `first_name`, `firstName` ou `FirstName` | First Name |
| coluna `author_id`, `photoUrl`, `apiKey` | Author ID, Photo URL, API Key |
| coluna `__order` | Order |
| tabela `order_items` | Order Items, um registro: Order Item |
| tabela `addresses`, `status_updates` | Addresses / Address, Status Updates / Status Update |
| valor de enum `needs_review` | Needs Review |

Os rótulos da tabela vêm do nome sob o qual ela foi definida, não do seu slug ou
nome SQL. `ID`, `IDs`, `URL`, `URLs`, `UUID`, `API` e `IP` mantêm suas letras
maiúsculas. O singular altera apenas a última palavra e não modifica palavras que
apenas terminam em `s` (`Status`, `Analysis`, `Address`).

## O campo atribuído a cada coluna

<span class="since-badge" data-since="0.31">Desde 0.31</span>

| Coluna | Campo no formulário | Observações |
|---|---|---|
| `col.text()`, `col.varchar({ length })`, `col.char({ length })`, `col.uuid()` | campo de texto | `varchar` e `char` limitam o comprimento |
| uma coluna de texto com `.validate({ email: true })` | campo de e-mail | validado como e-mail |
| uma coluna de texto com `.validate({ url: true })` | campo de URL, com pré-visualização de link | validado como URL |
| uma coluna de texto com `{ enum: [...] }`, uma coluna numérica com `.oneOf([...])` | select | uma opção por valor |
| uma coluna de texto ou uuid com `.userId()` | seletor de usuário | o valor é o id do usuário |
| `col.enum([...])`, uma coluna `pgEnum` | select, renderizado como um chip colorido | uma cor por valor, gerada a partir do próprio valor |
| `col.smallint()` … `col.bigserial({ mode: "number" })` | campo numérico | apenas números inteiros |
| `col.real()`, `col.doublePrecision()`, `col.numeric({ precision, scale })` | campo numérico | |
| `col.boolean()` | switch | |
| `col.timestamp({ withTimezone: true })` | seletor de data e hora | |
| `col.date()` | seletor de data | |
| `col.time()` | hora do dia | |
| `col.storage(…)` | campo de upload com pré-visualização | `.multiple()` é um campo de múltiplos arquivos |
| `<item>.array()` | lista repetível do campo do item | um array de texto `{ enum: [...] }` é um select múltiplo |
| `col.jsonb().$type<T>()`, `col.json().$type<T>()` | editor de chave/valor | o tipo `T` é apagado em tempo de execução |
| `col.jsonb(json.object({…}))` | um grupo de campos tipados | listas, blocos tipados e arquivos internos, a partir do formato |
| `col.geopoint()` | latitude e longitude | |
| `col.vector({ dimensions })` | campo de vetor | |
| `col.bytea()` | campo binário | base64 na transmissão |

Um valor de enum mantém sua cor onde quer que apareça: no select, no chip da
tabela e como uma coluna do kanban. A cor depende exclusivamente do valor,
portanto, adicionar um valor nunca altera as cores dos outros. O `customizeTable`
pode especificar os rótulos e as cores desejados com `enumLabels`; um valor não
especificado mantém o seu valor derivado.

Uma coluna `jsonb` declarada com um [formato `json.*`](/docs/schema/json/) ganha
um formulário real: um objeto se torna um grupo de campos, um array repete seu
item, um array de `json.oneOf` vira um editor de blocos e `json.storage()` é um
campo de upload dentro dele. Sem um formato definido, o painel não tem como
conhecer a estrutura do documento e oferece uma edição livre de chave/valor.

Cada tipo de coluna, seu widget correspondente e as opções que o modificam estão
em [Campos](/docs/collections/properties/).

## Campos obrigatórios, padrões e somente leitura

<span class="since-badge" data-since="0.31">Desde 0.31</span>

| A coluna | No formulário |
|---|---|
| `.notNull()` | obrigatório, com a `requiredMessage` de `.validate()` quando houver |
| `.default(literal)` | um novo registro abre com esse valor; continua obrigatório na edição |
| `` .default(sql`…`) ``, `.defaultNow()`, `.dbDefault()` | pode ser deixado em branco na criação, para o banco de dados preencher |
| `.unique()` | o formulário verifica se o valor não está em uso antes de salvar |
| uma chave primária gerada (`.defaultRandom()`, `.generatedByDefaultAsIdentity()`, um serial) | não editável; uma chave sem valor padrão é digitada na criação |
| `.onCreateNow()`, `.onUpdateNow()` | somente leitura e omitido das colunas padrão da tabela |
| `.onCreateUser()`, `.onUpdateUser()` | somente leitura |
| `.readOnly()`, `.generatedAlwaysAs(…)` | somente leitura |
| o campo `tenant` da tabela | preenchido pelo servidor na criação e omitido das colunas padrão da tabela; ainda assim editável para um solicitante que tenha permissão de escrita |
| `.private()` | nunca enviado pelo servidor, portanto nunca exibido |

As regras de `.validate()` de uma coluna são verificadas pelo formulário antes de
salvar, assim como o servidor as valida ao recebê-las. Consulte
[Validação e condições](/docs/collections/validation-and-conditions/).

O id do registro e seus registros de data e hora `.onCreateNow()` e
`.onUpdateNow()` são exibidos no bloco somente leitura no rodapé da barra lateral
do formulário.

## Relações

<span class="since-badge" data-since="0.31">Desde 0.31</span>

- Um `belongsTo` é um seletor da linha relacionada no lugar da sua coluna de
  chave estrangeira: o formulário exibe **Author**, e não **Author ID**. Ele é
  obrigatório quando a chave estrangeira é `NOT NULL` sem valor padrão. Uma
  chave estrangeira que faz parte da chave primária permanece como um campo
  próprio, ao lado do seletor.
- Um `hasOne` é um seletor para a única linha relacionada.
- Um `hasMany`, um `manyToMany` e um `via` do tipo para-muitos são **abas** do
  registro, listando as linhas relacionadas. O seletor ao lado da aba é ocultado.
- Um `via` é somente leitura, a menos que seja configurado como gravável.
- Uma relação com uma tabela que não foi fornecida ao solicitante é omitida: o
  painel não pode abrir uma tabela que não possui. Nesse caso, um `belongsTo`
  mantém sua chave estrangeira como um campo simples, para que o valor continue
  visível.

Consulte [Relações no painel](/docs/collections/relations-in-the-admin-panel/).

## Slots de exibição

<span class="since-badge" data-since="0.31">Desde 0.31</span>

Toda superfície que renderiza um registro utiliza alguns de seis slots: title,
subtitle, image, status, date e tags (consulte
[slots de exibição](/docs/frontend/view-modes/#display-slots)). Um slot é
preenchido a partir de uma coluna apenas quando a coluna claramente pertence a
ele; a primeira coluna correspondente, na ordem de declaração, tem precedência:

| Slot | Coluna |
|---|---|
| title | uma coluna de texto sem conjunto fechado de valores e sem arquivo, cuja chave seja `title`, `name`, `label`, `displayName`, `fullName`, `heading`, `subject` ou `username` (maiúsculas/minúsculas e separadores ignorados) |
| image | uma única coluna `col.storage()` cujo `accept` especifique um tipo de imagem |
| status | uma coluna chamada `status` com um conjunto fechado de valores |
| date | uma coluna de data ou timestamp que não seja preenchida automaticamente pelo servidor (`publishDate`); na ausência desta, o registro de data de atualização e, em seguida, o registro de criação |

Um slot que nenhuma coluna preenche fica a critério da própria interpretação do
painel sobre o registro (para o title: o primeiro campo de texto curto). O
`display` em `customizeTable` define qualquer slot explicitamente.

## Quem visualiza quais controles

<span class="since-badge" data-since="0.31">Desde 0.31</span>

O painel oculta **Create**, **Edit** e **Delete** quando o usuário conectado não
tem permissão para executá-los. Ele decide isso avaliando a segurança em nível de
linha (RLS) da tabela no navegador, com o mesmo modelo de políticas compilado
para o Postgres:

- as regras declaradas por você em `rls`, mais as políticas que o Rebase adiciona
  junto a elas: a linha de base de administrador (a menos que `defaultPolicies: false`),
  a leitura própria e o controle de escrita de administrador da tabela de
  usuários, e a regra de multilocação (tenancy) (consulte
  [políticas que uma tabela recebe](/docs/collections/security-rules/#policies-a-table-gets-without-writing-them));
- `rls: "admin-only"`: apenas administradores visualizam os controles;
- uma regra escrita em SQL puro não pode ser avaliada no navegador, assim como
  uma cláusula que o servidor ocultou deste solicitante: o controle é exibido e
  o banco de dados decide no momento em que a gravação chega;
- uma view SQL é somente leitura. Uma view simples é listada e as tabelas que
  ela lê decidem quais linhas retornam; uma view materializada é listada para as
  roles que ela especifica (`["admin"]` quando nenhuma é especificada).

Isso decide apenas o que é renderizado. Cada gravação é verificada novamente pelo
Postgres; portanto, um controle que não deveria ter sido exibido resulta em uma
gravação recusada, nunca em uma gravação indevida.

## Ordem e padrões

<span class="since-badge" data-since="0.31">Desde 0.31</span>

As tabelas aparecem na navegação na ordem em que o backend as fornece, que é a
ordem em que são exportadas de `backend/schema/index.ts`. Cada uma abre na
visualização em tabela. `customizeTable` define `group`, `icon`,
`defaultViewMode` e o restante; `<RebaseCMS navigationGroupMappings>` organiza
os grupos entre as tabelas.

## Carregamento e erros

<span class="since-badge" data-since="0.31">Desde 0.31</span>

- **Enquanto as tabelas carregam**, a rota para uma coleção exibe o estado de
  carregamento, e não "coleção não encontrada", e um link direto (deep link) abre
  assim que a coleção passar a existir.
- **Se as tabelas não puderem ser carregadas**, a página inicial e a rota da
  coleção informam o que falhou e oferecem a opção de tentar novamente. Quando o
  servidor não aceita mais a sessão, a mensagem solicita que o login seja feito
  novamente.
- **Um backend que não fornece nenhuma tabela** (um sem autenticação configurada
  ou mais antigo que a rota) não é um erro: o painel exibe as
  [coleções externas](/docs/frontend/firebase/) e nada mais.

Personalizações que fazem referência a uma tabela não fornecida ao solicitante
são ignoradas, com um aviso em ambiente de desenvolvimento. Consulte
[o que é recusado e o que é ignorado](/docs/frontend/customize-table/#what-is-refused-and-what-is-skipped).

## Grande volume de tabelas

<span class="since-badge" data-since="0.31">Desde 0.31</span>

Não há limite para o número de tabelas. O painel precisa de todas as coleções
para renderizar a navegação, portanto, os descritores são buscados após o login,
e o que for necessário para abrir uma coleção (a tabela, as visualizações do
registro, o formulário) é carregado apenas nesse momento. Um esquema grande torna
o `rebase db push` mais lento do que o painel: com 400 ou mais tabelas, um push
leva dezenas de segundos; consulte
[quanto tempo um push leva](/docs/cli/schema#rebase-db-push).

## Próximos passos

<span class="since-badge" data-since="0.31">Desde 0.31</span>

- [customizeTable](/docs/frontend/customize-table/): altere qualquer um dos itens acima, por tabela
- [Campos](/docs/collections/properties/): o widget e as opções de cada tipo de coluna
- [Modos de visualização](/docs/frontend/view-modes/): tabela, cards, kanban, slots de exibição e filtros
- [Relações no painel](/docs/collections/relations-in-the-admin-panel/): abas, seletores e tabelas intermediárias (pivots)
- [Firestore junto com o Postgres](/docs/frontend/firebase/): coleções de outra fonte de dados
