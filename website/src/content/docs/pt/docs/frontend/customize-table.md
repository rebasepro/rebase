---
sourceHash: 749d3a5f47923f4d
title: customizeTable
sidebar_label: customizeTable
description: "customizeTable define como a collection de uma tabela difere daquilo que o CMS deriva: rótulos, ícone, visualizações, kanban, slots de exibição, layout de formulário, ações e opções por campo com componentes React importados por valor. Cada opção, com seu tipo e efeito."
---

<span class="since-badge" data-since="0.31">Desde 0.31</span>

Se você usa o CMS, cada tabela servida pelo backend já possui uma collection no
painel, derivada da própria tabela (consulte
[como tabelas se tornam collections](/docs/collections/)). O `customizeTable` define
o que deve ser diferente, e nada mais. Ele reside no frontend, junto ao restante
do seu código React, portanto um campo personalizado é um componente que você importa como qualquer outro.

```tsx
// frontend/src/cms/posts.tsx
import { customizeTable, updateRecord } from "@rebasepro/cms";
import type { posts } from "../../../backend/schema/posts";
import { CustomMarkdownEditor } from "../../../../../components/CustomMarkdownEditor";

export const postsCms = customizeTable<typeof posts>("posts", {
    name: "Blog Posts",
    singularName: "Blog Post",
    icon: "FileText",
    group: "Content",

    defaultViewMode: "cards",
    enabledViews: ["table", "cards", "kanban"],
    kanban: { columnField: "status", orderField: "__order" },

    display: {
        title: "title",
        image: "heroImage",
        status: "status",
        date: "publishDate",
    },

    fields: {
        status: {
            enumLabels: {
                draft:        { label: "Draft", color: "gray" },
                needs_review: { label: "Needs Review", color: "orange" },
                published:    { label: "Published", color: "green" },
                archived:     { label: "Archived", color: "red" },
            },
        },
        title:   { multiline: true },
        content: { Field: CustomMarkdownEditor },
        orgId:   { hidden: true },
        __order: { hidden: true, disabled: true },
    },

    entityActions: [
        {
            key: "publish",
            name: "Publish",
            icon: "Send",
            collapsed: false,
            isEnabled: ({ row }) => row?.status !== "published",
            onClick: ({ id, context }) =>
                updateRecord(context, "posts", id, { status: "published", publishDate: new Date().toISOString() }, "Published"),
        },
    ],
});
```

Passe o resultado para `<RebaseCMS tableCustomizations={[postsCms]}/>`; consulte
[a visão geral do frontend](/docs/frontend/#rebasecms-props).

:::note[Vindo de collections?]
Estas são as opções de apresentação do antigo bloco `admin`, no nível superior
e sob alguns novos nomes (`fieldOrder`, `listFields`, `previewFields`,
`fields`, `kanban.columnField`, `kanban.orderField`). O uso de um nome antigo lança um erro
indicando o novo.
:::

## Onde os arquivos ficam

<span class="since-badge" data-since="0.31">Desde 0.31</span>

```text
frontend/src/cms/
├── index.ts        # export const tableCustomizations = [postsCms, …]
├── posts.tsx       # customizeTable("posts", …)
└── events.ts       # defineFirestoreCollection(…), for Firestore
```

Os nomes são uma convenção. O que importa é que os resultados cheguem a
`<RebaseCMS tableCustomizations>`. Uma tabela sem arquivo é exibida como derivada.

O frontend importa apenas o **tipo** da tabela: `import type { posts }`. Uma importação
de tipo é apagada quando o bundle é compilado, de modo que hooks e código de servidor em
`backend/schema` nunca chegam ao navegador. Uma importação por valor de `backend/` no
código do frontend é a única coisa que você não deve escrever. O backend nunca importa nada
do frontend.

## O slug e o tipo

<span class="since-badge" data-since="0.31">Desde 0.31</span>

O primeiro argumento é o slug da tabela: o nome sob o qual ela foi definida, ou o
`slug` atribuído a ela. Com a tabela como argumento de tipo, o slug, cada chave
que nomeia um campo e cada valor de enum é verificado contra a tabela:

| Verificado contra `typeof posts` | Um erro é |
|---|---|
| o primeiro argumento | um erro de tipo, a menos que seja o slug da tabela |
| chaves de `fields` | uma chave de coluna ou um nome de relação |
| entradas de `fieldOrder`, `listFields`, `form` | um campo, um caminho pontilhado para um (`"seo.title"`), `subcollection:<relation>` ou a chave de um campo adicional |
| `display`, `sort`, `fixedFilter`, `defaultFilter`, `filterPresets` | um campo ou um caminho para um |
| `kanban.columnField` | uma coluna contendo um conjunto fechado de strings (`col.enum([...])` ou `.oneOf([...])`) |
| `kanban.orderField` | uma coluna de texto |
| `enumLabels`, `enumOrder` | valores que a coluna pode conter; uma coluna sem conjunto fechado não aceita nenhum dos dois |
| opções de campo | aquelas do tipo da coluna: `multiline` em uma coluna de texto, `format` em um número |
| `entityActions[].onClick` e similares | `row` é o `InferRow` da tabela |

`defineTable("blog_posts", { slug: "posts", … })` é customizado como
`customizeTable<typeof posts>("posts", …)`: ainda um único argumento de tipo. Sem o
argumento de tipo, `customizeTable("posts", { … })` aceita as mesmas opções,
com tipagem fraca.

## O que é recusado e o que é ignorado

<span class="since-badge" data-since="0.31">Desde 0.31</span>

O `customizeTable` verifica o que o compilador não consegue ver quando o módulo é carregado e
lança um erro indicando o que escrever em vez disso:

- uma opção desconhecida, sugerindo a mais próxima conhecida ou o novo nome de uma opção
  antiga do bloco `admin`;
- um componente fornecido como caminho em string, um thunk lazy `() => import(…)` ou qualquer
  coisa que não seja um componente React;
- uma ação de entidade sem `name` ou `onClick`, uma visualização personalizada sem
  `Builder`, um `kanban` sem `columnField`, um `referenceTo` que não seja um slug;
- `fields` dentro de `overrides` de uma relação: estilize a tabela de destino com seu
  próprio `customizeTable`.

```text
customizeTable("posts"): unknown options:
  - `propertiesOrder` — it is `fieldOrder` now
  - `iconn` — did you mean `icon`?
```

O resultado é congelado (frozen). Passar duas customizações para o mesmo slug para
o `<RebaseCMS>` lança um erro: qual delas prevaleceria dependeria da ordem de importação.

O que o servidor entrega pode ser diferente do que você usou como base ao escrever. Uma coluna pode ser
ocultada deste chamador (consulte [acesso a campos](/docs/collections/field-access/)),
ou a tabela pode ter mudado desde então. Isso não é um erro em tempo de execução. Em
desenvolvimento, o painel exibe um aviso por discrepância e a ignora:

- uma customização cujo slug não corresponde a nenhuma tabela servida é ignorada;
- um campo, entrada de coluna, slot de exibição, entrada de formulário ou campo de kanban que a tabela
  não serve é descartado;
- uma opção que não se aplica ao tipo do campo (`format` em uma coluna de texto,
  `enumLabels` em um campo sem conjunto fechado) é ignorada.

O restante da customização continua sendo aplicado.

## Opções de tabela

<span class="since-badge" data-since="0.31">Desde 0.31</span>

Cada chave é opcional. Uma chave omitida mantém o que o painel derivou.

### Identidade e navegação

| Opção | Tipo | Efeito |
|---|---|---|
| `name` | `string` | O rótulo no plural: menu lateral (drawer), cabeçalho da página. Caso contrário, derivado do nome da tabela. |
| `singularName` | `string` | O rótulo de um único registro. |
| `description` | `string` | Exibido sob o cabeçalho e no card da página inicial. |
| `metadata` | `Record<string, unknown>` | Seus próprios dados, mesclados sobre o `metadata` da tabela. |
| `icon` | `string \| ReactNode` | Um nome de ícone do Lucide (`"FileText"`) ou um elemento. |
| `group` | `string` | O grupo de navegação. |
| `hideFromNavigation` | `boolean` | Fora do drawer. Ainda acessível por URL e como alvo de referência. |
| `hideFromEntityViews` | `boolean` | Não oferecido como aba nos registros de tabelas que se relacionam com ela. |

### Visualizações

| Opção | Tipo | Efeito |
|---|---|---|
| `defaultViewMode` | `ViewMode` | A visualização inicial do visitante: `"list"`, `"table"`, `"cards"`, `"kanban"` ou a chave de uma visualização personalizada. `"list"` caso contrário. |
| `enabledViews` | `ViewMode[]` | As visualizações oferecidas no seletor. |
| `kanban` | `{ columnField, orderField? }` | O quadro: a coluna pela qual ele agrupa e a coluna de texto na qual armazena as chaves de ordenação. Consulte [Modos de visualização](/docs/frontend/view-modes/#kanban). |
| `customViews` | `(string \| TableCustomView)[]` | Mais maneiras de renderizar as linhas: `{ key, name, Builder }`, ou a chave de uma registrada em `<RebaseCMS collectionViews>`. |
| `defaultSize` | `"xs" \| "s" \| "m" \| "l" \| "xl"` | A altura padrão da linha. |

`kanban` aceita duas chaves:

| Chave | Tipo | Efeito |
|---|---|---|
| `columnField` | chave de coluna | A coluna da qual vêm as colunas do quadro: um `col.enum([...])` ou `.oneOf([...])` de strings. |
| `orderField` | chave de coluna de texto | Onde a posição de um card dentro de sua coluna é armazenada, como uma chave de ordenação fracionária. Sem ela, a ordem é redefinida a cada leitura. |

### Colunas e slots

| Opção | Tipo | Efeito |
|---|---|---|
| `fieldOrder` | `TableColumnId[]` | A ordem em que os campos são renderizados. Os campos omitidos vêm em seguida, para que nada desapareça. |
| `listFields` | `TableColumnId[]` | As colunas da visualização em lista. |
| `previewFields` | `TableFieldKey[]` | Os campos exibidos quando um registro desta tabela é referenciado a partir de outra. |
| `display` | `TableDisplay` | O que preenche `title`, `subtitle`, `image`, `status`, `date` e `tags` de um registro: um caminho de campo ou um resolver. Consulte [slots de exibição](/docs/frontend/view-modes/#display-slots). |
| `additionalFields` | `TableAdditionalField[]` | Colunas computadas. Consulte [Colunas adicionais](/docs/frontend/additional-columns/). |
| `hideIdFromCollection` | `boolean` | Oculta a coluna de id. |

Uma coluna computada aceita:

| Chave | Tipo | Efeito |
|---|---|---|
| `key` | `string` | Identifica a coluna. Nomeie-a em `fieldOrder` como `"total" as AdditionalFieldKey`. |
| `name` | `string` | O cabeçalho. |
| `width` | `number` | A largura, em pixels. |
| `Builder` | `(props) => ReactNode` | Renderiza a célula a partir de `{ row, id, context }`. |
| `dependencies` | caminho ou caminhos de campo | Os campos cuja alteração renderiza a célula novamente. |
| `value` | `(props) => string \| number` | O valor da célula, para exportação. Pode ser assíncrono. |

### Padrões de consulta

| Opção | Tipo | Efeito |
|---|---|---|
| `sort` | `OrderBySpec` | A ordenação padrão: `["publishDate", "desc"]`, ou várias chaves em ordem. |
| `fixedFilter` | `FilterValues` | Um filtro que o visitante não pode alterar. |
| `defaultFilter` | `FilterValues` | O filtro inicial do visitante. |
| `filterPresets` | `FilterPreset[]` | Filtros de um clique na barra de ferramentas: `{ label?, filterValues, sort? }`. |
| `pagination` | `boolean \| number` | Carrega em páginas (`true`, ou o tamanho da página), ou tudo de uma vez (`false`). |

Consulte [Filtros e ordenação](/docs/frontend/view-modes/#filters-presets-and-sort).

### Comportamento

| Opção | Tipo | Efeito |
|---|---|---|
| `inlineEditing` | `boolean` | Edita células diretamente na tabela. |
| `selectionEnabled` | `boolean` | Linhas podem ser selecionadas. |
| `selectionController` | `SelectionController` | Uma seleção que você gerencia fora da visualização (`useSelectionController`). |
| `exportable` | `boolean \| ExportConfig` | Se a barra de ferramentas oferece Exportar e colunas extras para isso. Consulte [Importação e exportação](/docs/frontend/data-import-export/). |
| `openEntityMode` | `"side_panel" \| "full_screen" \| "split" \| "dialog"` | Como um registro é aberto. |
| `defaultEntityAction` | `"view" \| "edit"` | Se clicar em um registro o abre para leitura ou para edição. |
| `sideDialogWidth` | `number \| string` | A largura do painel lateral em que o registro se abre. |
| `defaultSelectedView` | `string \| DefaultSelectedViewBuilder` | A aba em que o registro se abre. |

### Formulário

| Opção | Tipo | Efeito |
|---|---|---|
| `form` | `{ sidebar?, sections?, showRecordMeta? }` | Seções e a barra lateral (rail) ao lado do formulário. Consulte [Layout de formulário](/docs/frontend/form-layout/). |
| `formView` | `{ Builder, includeActions? }` | Um componente que substitui o formulário gerado. `includeActions` mantém Salvar e Descartar na barra do registro. |
| `formAutoSave` | `boolean` | Salva conforme o visitante digita. |
| `alwaysApplyDefaultValues` | `boolean` | Preenche valores padrão declarados nos campos vazios de um registro salvo quando ele é aberto. |
| `includeJsonView` | `boolean` | Adiciona uma aba com o registro como JSON. |
| `localChangesBackup` | `"manual_apply" \| "auto_apply" \| false` | Mantém edições não salvas no armazenamento local. |
| `hideIdFromForm` | `boolean` | Oculta o id do formulário. |

`form` aceita:

| Chave | Tipo | Efeito |
|---|---|---|
| `sidebar` | ids de campo | Os campos destacados na barra lateral ao lado do formulário. |
| `sections` | seções | As seções da coluna principal, abaixo. |
| `showRecordMeta` | `boolean` | Exibe o id e os timestamps do registro na barra lateral. |

Cada seção aceita:

| Chave | Tipo | Efeito |
|---|---|---|
| `key` | `string` | Identifica a seção; também o `id` da sua âncora. |
| `title` | `string` | O título. Nenhum quando omitido. |
| `fields` | ids de campo | Os campos na seção, em ordem. |
| `collapsed` | `boolean` | Inicia recolhida. |
| `collapsible` | `boolean` | Pode ser recolhida. |
| `readVariant` | `"grid" \| "summary"` | Como a seção é lida quando o registro é exibido em vez de editado. |

### Ações, visualizações e substituições (overrides)

| Opção | Tipo | Efeito |
|---|---|---|
| `entityActions` | `(string \| TableEntityAction)[]` | Ações em um registro. Um objeto ou a chave de um registrado em `<RebaseCMS entityActions>`. Consulte [Ações de entidade](/docs/frontend/entity-actions/). |
| `disableDefaultActions` | `("edit" \| "copy" \| "delete")[]` | Ações nativas que esta tabela não oferece. |
| `resetPasswordAction` | `false \| TableEntityAction` | <span class="since-badge" data-since="0.31">Desde 0.31</span> Apenas para a tabela de autenticação (`defineAuthTable`): `false` remove a ação nativa de redefinição de senha, uma ação a substitui (oferecida independentemente do suporte do adaptador de autenticação: o backend é seu). Ignorado, com um aviso, em qualquer outra tabela. |
| `entityViews` | `(string \| TableEntityView)[]` | Abas extras em um registro. Consulte [Visualizações de entidade](/docs/frontend/entity-views/). |
| `Actions` | `Component[]` | Componentes renderizados na barra de ferramentas da collection. |
| `components` | `TableComponentOverrides` | Substituições de componentes com escopo de collection, cada uma no formato `{ Component, wrap? }`. Consulte [Substituições de componentes](/docs/frontend/component-overrides/#collection-level-component-overrides). |
| `browserCallbacks` | `CollectionCallbacks` | Callbacks que são executados no painel após os hooks do servidor. Apenas para apresentação: eles são enviados a todos os visitantes e não garantem segurança. Consulte [Hooks do React](/docs/hooks/). |
| `fields` | `TableFields` | Opções por campo, indexadas por coluna ou relação. Abaixo. |

## Opções de campo

<span class="since-badge" data-since="0.31">Desde 0.31</span>

`fields.<key>` aceita as opções que qualquer campo aceita, mais aquelas do seu
tipo de coluna. [Campos](/docs/collections/properties/) mostra cada um com o componente (widget) que
ele modifica.

### Todos os campos

| Opção | Tipo | Efeito |
|---|---|---|
| `name` | `string` | O rótulo. Caso contrário, derivado da chave (`publishDate` → "Publish Date"). |
| `description` | `string` | Texto de ajuda sob o campo. |
| `hidden` | `boolean` | Mantido fora das visualizações em tabela e em cards. Ainda presente no formulário, e ainda lido e gravado pela API. |
| `hiddenInForm` | `boolean` | Mantido fora do formulário. Ainda presente nas visualizações. |
| `disabled` | `boolean \| { disabledMessage?, clearOnDisabled? }` | O controle fica desativado (esmaecido). `disabledMessage` informa o motivo, ao lado dele; `clearOnDisabled` limpa o valor quando ele se torna desativado. |
| `readOnly` | `boolean` | O valor é renderizado como texto, sem controle interativo. |
| `Field` | `Component` | Substitui o controle do formulário. O próprio componente. Consulte [Campos personalizados](/docs/frontend/custom-fields/). |
| `Preview` | `Component` | Substitui a forma como o valor é renderizado fora do formulário. |
| `Filter` | `Component` | Substitui o controle de filtro para este campo. |
| `columnWidth` | `number` | A largura da coluna na tabela, em pixels. |
| `filledByServer` | `boolean` | Um hook de servidor o preenche na criação: o formulário permite que um registro seja criado sem ele. |
| `span` | `1 \| 2 \| 3 \| 4` | Quantas das quatro colunas do grid do formulário ele ocupa. |
| `customProps` | `unknown` | Repassado sem alterações para seu `Field` e `Preview`. |
| `filterOperators` | `WhereFilterOp[]` | Restringe os operadores de filtro oferecidos. `[]` desativa a filtragem para ele. |
| `propertyConfig` | `string` | A chave de um tipo de campo registrado em `<Rebase propertyConfigs>`. |
| `conditions` | `PropertyConditions` | Regras JSON-logic que ocultam, desativam ou tornam o campo obrigatório a partir dos valores do registro. Apenas no formulário. Consulte [condições](/docs/collections/validation-and-conditions/#conditional-fields). |
| `dynamicProps` | `(props) => options \| undefined` | Retorna as opções de campo aplicáveis no momento, a partir do registro sendo editado. Apenas no formulário. |
| `metadata` | `Record<string, unknown>` | Seus próprios dados. |

### Colunas de texto e uuid

| Opção | Tipo | Efeito |
|---|---|---|
| `multiline` | `boolean` | Um campo de entrada de várias linhas, crescendo conforme seu conteúdo. |
| `markdown` | `boolean` | Um editor de markdown com pré-visualização. |
| `previewAsTag` | `boolean` | Renderizado como uma tag/chip em vez de texto. |
| `clearable` | `boolean` | Adiciona um controle que redefine o valor para `null`. |
| `urlPreview` | `PreviewType \| boolean` | Como uma URL no valor é pré-visualizada: `"image"`, `"video"`, `"audio"`, `"file"`, ou `true` para um link. |
| `referenceTo` | `string` | A coluna armazena a chave de um registro em outra collection, em qualquer fonte de dados: ela é renderizada e selecionada como uma referência ao slug dessa collection. Consulte [Firestore](/docs/frontend/firebase/#from-a-table-to-firestore). |

### Colunas com um conjunto fechado de valores

Um `col.enum([...])`, um `.oneOf([...])`, ou um array de qualquer um dos dois:

| Opção | Tipo | Efeito |
|---|---|---|
| `enumLabels` | `{ [value]?: string \| EnumLabel }` | Rótulos para alguns dos valores. Valores omitidos mantêm seu rótulo e cor derivados. |
| `enumOrder` | `value[]` | A ordem em que os valores são oferecidos e as colunas do kanban são renderizadas. Caso contrário, a própria ordem da coluna. |
| `previewAsTag` | `boolean` | Em um `col.enum()`: renderizado como um chip. |
| `clearable` | `boolean` | Em um `col.enum()`: adiciona um controle que redefine o valor para `null`. |

Um `EnumLabel` aceita:

| Chave | Tipo | Efeito |
|---|---|---|
| `label` | `string` | O texto no chip e no campo de seleção (select). |
| `color` | `ColorKey \| ColorScheme` | Uma chave de cor do chip (`"green"`, `"orangeDark"`) ou um esquema `{ color, text }`. Um valor sem cor definida mantém sua cor padrão inicial. |
| `disabled` | `boolean` | Exibido, mas não oferecido para seleção. |

### Colunas numéricas

| Opção | Tipo | Efeito |
|---|---|---|
| `clearable` | `boolean` | Adiciona um controle que redefine o valor para `null`. |
| `format` | `NumberFormatOptions` | Exibe o número formatado como moeda, porcentagem ou com casas decimais fixas. |

`format` aceita `style` (`"decimal"`, `"currency"`, `"percent"`), `currency` (um
código ISO, obrigatório com `"currency"`), `locale` (caso contrário, o do usuário),
`minimumFractionDigits`, `maximumFractionDigits` e `notation`
(`"standard"` ou `"compact"`, que exibe `12000` como `12K`). Ele altera o que é
renderizado, nunca o que é armazenado.

### Colunas de data, timestamp e hora

| Opção | Tipo | Efeito |
|---|---|---|
| `clearable` | `boolean` | Adiciona um controle que redefine o valor para `null`. |
| `mode` | `"date" \| "date_time"` | Seleciona e exibe apenas uma data, ou uma data e uma hora. Caso contrário, derivado do tipo da coluna. |
| `timezone` | `string` | O fuso horário IANA no qual o valor é exibido e selecionado (`"Europe/Madrid"`). Caso contrário, o do usuário. |

### Colunas vetoriais

| Opção | Tipo | Efeito |
|---|---|---|
| `clearable` | `boolean` | Adiciona um controle que redefine o valor para `null`. |

### Colunas de armazenamento (storage)

| Opção | Tipo | Efeito |
|---|---|---|
| `storage` | `StorageCustomization` | As funções de upload executadas no navegador. |
| `clearable` | `boolean` | Adiciona um controle que redefine o valor para `null`. |
| `urlPreview` | `PreviewType \| boolean` | Como a URL armazenada é pré-visualizada. |

`storage` aceita apenas funções; as opções serializáveis permanecem em
`col.storage({ … })` (consulte [Uploads de arquivos](/docs/collections/file-uploads/)):

| Chave | Assinatura | Efeito |
|---|---|---|
| `path` | `(context) => string` | A pasta para onde o arquivo é enviado, substituindo o template `path` da coluna. |
| `fileName` | `(context) => string \| Promise<string>` | O nome do arquivo armazenado, substituindo o template `fileName` da coluna. |
| `processFile` | `(file) => Promise<File>` | Transforma um arquivo antes de ser enviado. |
| `postProcess` | `(pathOrUrl) => Promise<string>` | Transforma o caminho ou URL armazenado antes de ser gravado na coluna. |
| `previewUrl` | `(fileName) => string` | A URL para pré-visualizar um arquivo armazenado. |

### Colunas de array

| Opção | Tipo | Efeito |
|---|---|---|
| `expanded` | `boolean` | Todos os itens abertos ao carregar. |
| `minimalistView` | `boolean` | Itens sem moldura e cabeçalho. |
| `sortable` | `boolean` | Itens podem ser reordenados por arrastar e soltar. |
| `canAddElements` | `boolean` | Itens podem ser adicionados. |
| `of` | opções de campo | As opções de cada item. |
| `storage` | `StorageCustomization` | As funções de upload, para `col.storage().multiple()`. |

`enumLabels` e `enumOrder` definidos em um array aplicam-se aos seus itens.

### Colunas JSON

| Opção | Tipo | Efeito |
|---|---|---|
| `expanded` | `boolean` | Os campos do documento abertos ao carregar. |
| `minimalistView` | `boolean` | Os campos do documento sem sua moldura. |
| `spreadChildren` | `boolean` | Os campos do documento distribuídos como se fossem do próprio registro. |
| `keyValue` | `boolean` | Editado como pares de chave/valor livres. |
| `previewFields` | `string[]` | As chaves do documento exibidas em sua pré-visualização. |
| `fields` | `{ [key]: field options }` | As opções de cada chave do documento. |
| `fieldOrder` | `string[]` | A ordem em que as chaves do documento são exibidas. |
| `of` | opções de campo | As opções de cada item, para um documento que é uma lista. |
| `oneOf` | `{ [variant]: field options }` | As opções de cada variante de um bloco tipado (`json.oneOf`). |

Com `col.jsonb().$type<T>()` ou um formato `json.object({…})`, `fields` e `fieldOrder`
são tipados pelas chaves do documento. Consulte [Arrays e JSON](/docs/collections/arrays-and-maps/).

### Relações

| Opção | Tipo | Efeito |
|---|---|---|
| `previewFields` | `string[]` | Os campos do destino exibidos no chip para uma linha relacionada. Cabem no máximo três. |
| `defaultValue` | `EntityRelation \| EntityRelation[]` | A(s) linha(s) relacionada(s) com as quais o formulário de um novo registro se inicia: `new EntityRelation(id, "<target slug>")` (`EntityRelation` de `@rebasepro/cms-types`), ou uma lista para uma relação to-many (muitos). Gravado apenas quando o formulário é salvo. O padrão da própria coluna é `.default()` na coluna. |
| `widget` | `"select" \| "dialog"` | Como uma linha relacionada é selecionada. |
| `fixedFilter` | `FilterValues` | Oferece apenas linhas que passam neste filtro. |
| `includeId` | `boolean` | Exibe o id da linha relacionada nas pré-visualizações. |
| `includeEntityLink` | `boolean` | Exibe um link que abre a linha relacionada. |
| `renderInForm` | `boolean` | Também renderiza uma relação to-many como um seletor no formulário, ao lado de sua aba. |
| `overrides` | opções de tabela sem `fields` | Como o destino é apresentado na aba desta relação. |

Consulte [Relações no painel](/docs/collections/relations-in-the-admin-panel/).

## Customizações, `ui-config.json` e preferências

<span class="since-badge" data-since="0.31">Desde 0.31</span>

O que o painel exibe para uma tabela é composto em uma ordem fixa, cada camada sobrepondo
a anterior:

1. **A collection derivada**: o que o painel lê da tabela servida pelo servidor.
2. **Código**: os resultados de `customizeTable` que você passa como `tableCustomizations`.
3. **`frontend/src/cms/ui-config.json`**: a apresentação do workspace conforme o
   editor de collections a salvou em desenvolvimento, passada como `uiConfig`. É um
   arquivo no frontend, portanto é revisado e publicado junto com ele.
4. **Preferências do workspace**: o que um administrador salva em um ambiente de produção (deployment), na
   tabela `rebase.ui_preferences` por meio de
   [`/api/admin/ui-config`](/docs/backend/endpoints/). Gravá-las requer
   `schema:write`.
5. **Preferências do usuário**: larguras de colunas individuais, alternâncias de visualização e
   colunas ocultas de uma pessoa. Mantidas no navegador mesmo desconectado.

Um `App.tsx` gerado por scaffolding já conecta o arquivo:

```tsx
import { RebaseCMS } from "@rebasepro/cms";
import { tableCustomizations } from "./cms";
import uiConfig from "./cms/ui-config.json";

export const Admin = () => <RebaseCMS tableCustomizations={tableCustomizations} uiConfig={uiConfig} />;
```

As preferências guardam apenas a apresentação: rótulos, ícone, modos de visualização, ordem de colunas,
colunas ocultas, rótulos e cores de enum, kanban e padrões de consulta. Uma definição
de schema nunca vai para lá; o [editor de collections](/docs/studio/) grava esses dados em
`backend/schema`.

O comando `rebase build` transporta o `frontend/src/cms/ui-config.json` para o bundle
(`entry.uiConfig`), para que um backend publicado também o conheça: `GET /api/admin/ui-config`
o disponibiliza como `shipped` ao lado das camadas de workspace e de usuário, e as visualizações MCP
e `describe_table` combinam as mesmas três camadas — o arquivo, o workspace e
as preferências do próprio chamador (nenhuma para uma chave de API) — de modo que um agente veja os rótulos, a ordem,
as colunas ocultas e os rótulos de enum que uma pessoa vê no painel.

O comando `rebase verify` analisa cada chamada a `customizeTable` em `frontend/src/cms` em relação
às tabelas, sem executá-la: ele detecta customizações para tabelas ou
campos inexistentes, colunas obrigatórias que o formulário oculta, tabelas
customizadas em duplicidade, um `ui-config.json` que não foi passado para nenhum `<RebaseCMS>` e configurações do Vite
sem `rebaseBackendGuard()`. Consulte [`rebase verify`](/docs/cli/#rebase-verify).

## Próximos passos

<span class="since-badge" data-since="0.31">Desde 0.31</span>

- [Como tabelas se tornam collections](/docs/collections/): o que o painel deriva antes de tudo isso
- [Campos](/docs/collections/properties/): o widget e as opções de cada tipo de coluna
- [Modos de visualização](/docs/frontend/view-modes/): tabela, cards, kanban, slots de exibição, filtros
- [Ações de entidade](/docs/frontend/entity-actions/): `entityActions` e `updateRecord`
- [Firestore ao lado do Postgres](/docs/frontend/firebase/): `externalCollections` e referências entre mecanismos de banco de dados
