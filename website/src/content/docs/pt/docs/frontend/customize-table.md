---
sourceHash: 43be070662fffefd
title: customizeTable
sidebar_label: customizeTable
description: "O customizeTable define como a coleção de uma tabela difere daquilo que o CMS deriva: rótulos, ícone, visualizações, kanban, slots de exibição, layout de formulário, ações e opções por campo com componentes React importados por valor. Todas as opções, com seu tipo e efeito."
---

Se você usa o CMS, cada tabela servida pelo backend já possui uma coleção no
painel, derivada da própria tabela (consulte
[como tabelas se tornam coleções](/docs/collections/)). O `customizeTable` define
o que deve ser diferente, e nada mais. Ele fica no frontend, junto ao restante
do seu código React, de modo que um campo personalizado é um componente que você
importa como qualquer outro.

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
Estas são as opções de apresentação do antigo bloco `admin`, no nível raiz e
sob alguns novos nomes (`fieldOrder`, `listFields`, `previewFields`,
`fields`, `kanban.columnField`, `kanban.orderField`). Usar um nome antigo gera
um erro indicando o novo.
:::

## Onde os arquivos ficam

```text
frontend/src/cms/
├── index.ts        # export const tableCustomizations = [postsCms, …]
├── posts.tsx       # customizeTable("posts", …)
└── events.ts       # defineFirestoreCollection(…), for Firestore
```

Os nomes são uma convenção. O que importa é que os resultados cheguem a
`<RebaseCMS tableCustomizations>`. Uma tabela sem arquivo é exibida como derivada.

O frontend importa apenas o **tipo** da tabela: `import type { posts }`. Uma
importação de tipo é apagada quando o bundle é construído, portanto hooks e
código do servidor em `backend/schema` nunca chegam ao navegador. Uma
importação por valor de `backend/` no código do frontend é a única coisa que não
se deve escrever. O backend nunca importa nada do frontend.

## O slug e o tipo

O primeiro argumento é o slug da tabela: o nome sob o qual ela foi definida, ou o
`slug` fornecido a ela. Com a tabela como o argumento de tipo, o slug, cada chave
que nomeia um campo e cada valor de enum é verificado em relação à tabela:

| Verificado em relação a `typeof posts` | Um erro é |
|---|---|
| o primeiro argumento | um erro de tipo, a menos que seja o slug da tabela |
| chaves de `fields` | uma chave de coluna ou um nome de relação |
| entradas de `fieldOrder`, `listFields`, `form` | um campo, um caminho pontilhado para um (`"seo.title"`), `subcollection:<relation>` ou a chave de um campo adicional |
| `display`, `sort`, `fixedFilter`, `defaultFilter`, `filterPresets` | um campo ou um caminho para um |
| `kanban.columnField` | uma coluna contendo um conjunto fechado de strings (`col.enum([...])` ou `.oneOf([...])`) |
| `kanban.orderField` | uma coluna de texto |
| `enumLabels`, `enumOrder` | valores que a coluna pode conter; uma coluna sem conjunto fechado não aceita nenhum dos dois |
| opções de campo | aquelas do tipo da coluna: `multiline` em uma coluna de texto, `format` em um número |
| `entityActions[].onClick` e afins | `row` é o `InferRow` da tabela |

`defineTable("blog_posts", { slug: "posts", … })` é customizado como
`customizeTable<typeof posts>("posts", …)`: ainda um único argumento de tipo. Sem o
argumento de tipo, `customizeTable("posts", { … })` aceita as mesmas opções,
fracamente tipadas.

## O que é recusado e o que é ignorado

O `customizeTable` verifica o que o compilador não consegue ver quando o módulo é
carregado e lança um erro indicando o que escrever em vez disso:

- uma opção desconhecida, indicando a mais próxima conhecida ou o novo nome de uma
  opção antiga do `admin`;
- um componente fornecido como caminho de string, um thunk lazy `() => import(…)`
  ou qualquer coisa que não seja um componente React;
- uma ação de entidade sem `name` ou `onClick`, uma visualização customizada sem
  `Builder`, um `kanban` sem `columnField`, um `referenceTo` que não seja um slug;
- `fields` dentro de `overrides` de uma relação: personalize a tabela de destino
  com seu próprio `customizeTable`.

```text
customizeTable("posts"): unknown options:
  - `propertiesOrder` — it is `fieldOrder` now
  - `iconn` — did you mean `icon`?
```

O resultado é congelado (frozen). Passar duas customizações para o mesmo slug para
o `<RebaseCMS>` gera um erro: qual delas prevaleceria dependeria da ordem de importação.

O que o servidor fornece pode diferir daquilo para o qual você escreveu o código.
Uma coluna pode ser retida para quem fez a chamada (consulte
[acesso a campos](/docs/collections/field-access/)), ou a tabela pode ter mudado
desde então. Isso não é um erro em tempo de execução. Em desenvolvimento, o painel
exibe um aviso por inconsistência e a ignora:

- uma customização cujo slug não corresponde a nenhuma tabela servida é ignorada;
- um campo, entrada de coluna, slot de exibição, entrada de formulário ou campo de
  kanban que a tabela não serve é descartado;
- uma opção que não se aplica ao tipo do campo (`format` em uma coluna de texto,
  `enumLabels` em um campo sem conjunto fechado) é ignorada.

O restante da customização continua sendo aplicado.

## Opções da tabela

Cada chave é opcional. Uma chave omitida mantém o que o painel derivou.

### Identidade e navegação

| Opção | Tipo | Efeito |
|---|---|---|
| `name` | `string` | O rótulo no plural: menu lateral (drawer), cabeçalho da página. Caso contrário, derivado do nome da tabela. |
| `singularName` | `string` | O rótulo de um registro individual. |
| `description` | `string` | Exibido sob o cabeçalho e no card da página inicial. |
| `metadata` | `Record<string, unknown>` | Seus próprios dados, mesclados sobre o `metadata` da tabela. |
| `icon` | `string \| ReactNode` | Um nome de ícone Lucide (`"FileText"`) ou um elemento. |
| `group` | `string` | O grupo de navegação. |
| `hideFromNavigation` | `boolean` | Oculto no menu lateral (drawer). Ainda acessível por URL e como destino de referência. |
| `hideFromEntityViews` | `boolean` | Não oferecido como aba nos registros de tabelas que se relacionam com ela. |

### Visualizações

| Opção | Tipo | Efeito |
|---|---|---|
| `defaultViewMode` | `ViewMode` | A visualização em que o visitante aterrissa: `"list"`, `"table"`, `"cards"`, `"kanban"` ou a chave de uma visualização personalizada. Caso contrário, `"list"`. |
| `enabledViews` | `ViewMode[]` | As visualizações oferecidas no seletor. |
| `kanban` | `{ columnField, orderField? }` | O quadro: a coluna pela qual ele agrupa e a coluna de texto na qual armazena as chaves de ordenação. Consulte [Modos de visualização](/docs/frontend/view-modes/#kanban). |
| `customViews` | `(string \| TableCustomView)[]` | Mais maneiras de renderizar as linhas: `{ key, name, Builder }`, ou a chave de uma registrada em `<RebaseCMS collectionViews>`. |
| `defaultSize` | `"xs" \| "s" \| "m" \| "l" \| "xl"` | A altura padrão da linha. |

`kanban` aceita duas chaves:

| Chave | Tipo | Efeito |
|---|---|---|
| `columnField` | chave de coluna | A coluna de onde vêm as colunas do quadro: um `col.enum([...])` ou `.oneOf([...])` de strings. |
| `orderField` | chave de coluna de texto | Onde a posição de um card dentro de sua coluna é armazenada, como uma chave de ordenação fracionária. Sem ela, a ordem é redefinida a cada leitura. |

### Colunas e slots

| Opção | Tipo | Efeito |
|---|---|---|
| `fieldOrder` | `TableColumnId[]` | A ordem em que os campos são renderizados. Os campos omitidos vêm em seguida, para que nada desapareça. |
| `listFields` | `TableColumnId[]` | As colunas da tabela e da visualização em lista: os campos que elas renderizam, e nenhum outro. A tabela os ordena por `fieldOrder` (ou pela ordem para a qual o visitante os arrastar) quando houver um, ou por `listFields` caso contrário. Os campos omitidos continuam no registro. |
| `previewFields` | `TableFieldKey[]` | Os campos exibidos quando um registro desta tabela é referenciado a partir de outra. |
| `display` | `TableDisplay` | O que preenche `title`, `subtitle`, `image`, `status`, `date` e `tags` de um registro: um caminho de campo ou um resolvedor. Consulte [slots de exibição](/docs/frontend/view-modes/#display-slots). |
| `additionalFields` | `TableAdditionalField[]` | Colunas computadas da tabela. Não ficam no registro, a menos que `form.sections` ou `form.sidebar` nomeie uma. Consulte [Colunas adicionais](/docs/frontend/additional-columns/). |
| `hideIdFromCollection` | `boolean` | Oculta a coluna de id. |

Uma coluna computada aceita:

| Chave | Tipo | Efeito |
|---|---|---|
| `key` | `string` | Identifica a coluna. Nomeie-a em `fieldOrder` como `"total" as AdditionalFieldKey`. |
| `name` | `string` | O cabeçalho. |
| `width` | `number` | A largura, em pixels. |
| `Builder` | `(props) => ReactNode` | Renderiza a célula a partir de `{ row, id, context }`. |
| `dependencies` | caminho ou caminhos de campos | Os campos cuja alteração renderiza a célula novamente. |
| `value` | `(props) => string \| number` | O valor da célula, para exportação. Pode ser assíncrono. |

### Padrões de consulta

| Opção | Tipo | Efeito |
|---|---|---|
| `sort` | `OrderBySpec` | A ordenação padrão: `["publishDate", "desc"]`, ou várias chaves em sequência. |
| `fixedFilter` | `FilterValues` | Um filtro que o visitante não pode alterar. |
| `defaultFilter` | `FilterValues` | O filtro a partir do qual o visitante começa. |
| `filterPresets` | `FilterPreset[]` | Filtros de um clique na barra de ferramentas: `{ label?, filterValues, sort? }`. |
| `pagination` | `boolean \| number` | Carregar em páginas (`true`, ou o tamanho da página), ou tudo de uma vez (`false`). |

Consulte [Filtros e ordenação](/docs/frontend/view-modes/#filters-presets-and-sort).

### Comportamento

| Opção | Tipo | Efeito |
|---|---|---|
| `inlineEditing` | `boolean` | Editar células diretamente na tabela. |
| `selectionEnabled` | `boolean` | As linhas podem ser selecionadas. |
| `selectionController` | `SelectionController` | Uma seleção mantida fora da visualização (`useSelectionController`). |
| `exportable` | `boolean \| ExportConfig` | Se a barra de ferramentas oferece Exportação, e colunas extras para ela. Consulte [Importação e exportação](/docs/frontend/data-import-export/). |
| `openEntityMode` | `"side_panel" \| "full_screen" \| "split" \| "dialog"` | Como um registro é aberto. |
| `defaultEntityAction` | `"view" \| "edit"` | Se clicar em um registro o abre para visualização ou para edição. |
| `sideDialogWidth` | `number \| string` | A largura do painel lateral em que o registro é aberto. |
| `defaultSelectedView` | `string \| DefaultSelectedViewBuilder` | A aba na qual o registro é aberto. |

### Formulário

| Opção | Tipo | Efeito |
|---|---|---|
| `form` | `{ sidebar?, sections?, showRecordMeta? }` | Seções e a barra lateral ao lado do formulário. Consulte [Layout de formulário](/docs/frontend/form-layout/). |
| `formView` | `{ Builder, includeActions? }` | Um componente que substitui o formulário gerado. `includeActions` mantém Salvar e Descartar na barra do registro. |
| `formAutoSave` | `boolean` | Salva conforme o visitante digita. |
| `alwaysApplyDefaultValues` | `boolean` | Preenche os padrões declarados nos campos vazios de um registro armazenado ao ser aberto. |
| `includeJsonView` | `boolean` | Adiciona uma aba com o registro em JSON. |
| `localChangesBackup` | `"manual_apply" \| "auto_apply" \| false` | Mantém alterações não salvas no armazenamento local (localStorage). |
| `hideIdFromForm` | `boolean` | Oculta o id do formulário. |

`form` aceita:

| Chave | Tipo | Efeito |
|---|---|---|
| `sidebar` | ids de campos | Os campos destacados na barra lateral ao lado do formulário. |
| `sections` | seções | As seções da coluna principal, descritas abaixo. |
| `showRecordMeta` | `boolean` | Exibe o id e os timestamps do registro na barra lateral. |

Cada seção aceita:

| Chave | Tipo | Efeito |
|---|---|---|
| `key` | `string` | Identifica a seção; também o `id` da sua âncora. |
| `title` | `string` | O título. Nenhum quando omitido. |
| `fields` | ids de campos | Os campos na seção, em ordem. |
| `collapsed` | `boolean` | Começa recolhida. |
| `collapsible` | `boolean` | Pode ser recolhida. |
| `readVariant` | `"grid" \| "summary"` | Como a seção é lida quando o registro é exibido em vez de editado. |

### Ações, visualizações e substituições

| Opção | Tipo | Efeito |
|---|---|---|
| `entityActions` | `(string \| TableEntityAction)[]` | Ações em um registro. Um objeto ou a chave de uma registrada em `<RebaseCMS entityActions>`. Consulte [Ações de entidade](/docs/frontend/entity-actions/). |
| `disableDefaultActions` | `("edit" \| "copy" \| "delete")[]` | Ações nativas que esta tabela não oferece. |
| `resetPasswordAction` | `false \| TableEntityAction` | Apenas na tabela de autenticação (`defineAuthTable`): `false` remove a ação nativa de redefinição de senha, uma ação a substitui (oferecida independentemente do que o adaptador de autenticação suporta: o backend é seu). Ignorada, com um aviso, em qualquer outra tabela. |
| `entityViews` | `(string \| TableEntityView)[]` | Abas extras em um registro. Consulte [Visualizações de entidade](/docs/frontend/entity-views/). |
| `Actions` | `Component[]` | Componentes renderizados na barra de ferramentas da coleção. |
| `components` | `TableComponentOverrides` | Substituições de componentes com escopo de coleção, cada uma como `{ Component, wrap? }`. Consulte [Substituições de componentes](/docs/frontend/component-overrides/#collection-level-component-overrides). |
| `browserCallbacks` | `CollectionCallbacks` | Callbacks executados no painel após os hooks do servidor. Apenas apresentação: eles são enviados a todos os visitantes e não garantem segurança. Consulte [React hooks](/docs/hooks/). |
| `fields` | `TableFields` | Opções por campo, indexadas por coluna ou relação. Abaixo. |

## Opções de campo

`fields.<key>` aceita as opções que todos os campos aceitam, mais as do seu tipo
de coluna. [Campos](/docs/collections/properties/) mostra cada uma com o widget
que ela altera.

### Todos os campos

| Opção | Tipo | Efeito |
|---|---|---|
| `name` | `string` | O rótulo. Caso contrário, derivado da chave (`publishDate` → "Publish Date"). |
| `description` | `string` | Texto de ajuda abaixo do campo. |
| `hidden` | `boolean` | Mantido fora das visualizações de tabela, lista e cards, e fora do registro: de seu formulário e de sua visualização de leitura. Ainda é lido e escrito pela API. |
| `hiddenInForm` | `boolean` | Mantido fora do registro (de seu formulário e de sua visualização de leitura). Ainda presente nas visualizações. |
| `disabled` | `boolean \| { disabledMessage?, clearOnDisabled? }` | O controle fica esmaecido. `disabledMessage` explica o motivo ao lado; `clearOnDisabled` limpa o valor quando ele se torna desabilitado. |
| `readOnly` | `boolean` | O valor é renderizado como texto, sem controle de edição. |
| `Field` | `Component` | Substitui o controle do formulário. O componente em si. Consulte [Campos personalizados](/docs/frontend/custom-fields/). |
| `Preview` | `Component` | Substitui como o valor é renderizado fora do formulário. |
| `Filter` | `Component` | Substitui o controle de filtro para este campo. |
| `columnWidth` | `number` | A largura da coluna na tabela, em pixels. |
| `filledByServer` | `boolean` | Um hook do servidor o preenche na criação: o formulário permite que um registro seja criado sem ele. |
| `span` | `1 \| 2 \| 3 \| 4` | Quantas das quatro colunas da grade do formulário ele ocupa. |
| `customProps` | `unknown` | Passado intacto para o seu `Field` e `Preview`. |
| `filterOperators` | `WhereFilterOp[]` | Restringe os operadores de filtro oferecidos. `[]` desativa a filtragem para ele. |
| `propertyConfig` | `string` | A chave de um tipo de campo registrado em `<Rebase propertyConfigs>`. |
| `conditions` | `PropertyConditions` | Regras JSON-logic que ocultam, desabilitam ou tornam o campo obrigatório com base nos valores do registro. Apenas no formulário. Consulte [condições](/docs/collections/validation-and-conditions/#conditional-fields). |
| `dynamicProps` | `(props) => options \| undefined` | Retorna as opções de campo aplicáveis no momento, a partir do registro sendo editado. Apenas no formulário. |
| `metadata` | `Record<string, unknown>` | Seus próprios dados. |

### Colunas de texto e uuid

| Opção | Tipo | Efeito |
|---|---|---|
| `multiline` | `boolean` | Uma entrada multilinha que se expande com o conteúdo. |
| `markdown` | `boolean` | Um editor markdown com visualização prévia (preview). |
| `previewAsTag` | `boolean` | Renderizado como chip (tag) em vez de texto simples. |
| `clearable` | `boolean` | Adiciona um controle que redefine o valor para `null`. |
| `urlPreview` | `PreviewType \| boolean` | Como uma URL no valor é pré-visualizada: `"image"`, `"video"`, `"audio"`, `"file"`, ou `true` para um link. |
| `referenceTo` | `string` | A coluna armazena a chave de um registro em outra coleção, em qualquer fonte de dados: ela é renderizada e selecionada como uma referência ao slug dessa coleção. Consulte [Firestore](/docs/frontend/firebase/#from-a-table-to-firestore). |

### Colunas com um conjunto fechado de valores

Um `col.enum([...])`, um `.oneOf([...])` ou um array de qualquer um dos dois:

| Opção | Tipo | Efeito |
|---|---|---|
| `enumLabels` | `{ [value]?: string \| EnumLabel }` | Rótulos para alguns dos valores. Valores omitidos mantêm seu rótulo e cor derivados. |
| `enumOrder` | `value[]` | A ordem em que os valores são oferecidos e as colunas do kanban são exibidas. Caso contrário, a própria ordem da coluna. |
| `previewAsTag` | `boolean` | Em um `col.enum()`: renderizado como um chip. |
| `clearable` | `boolean` | Em um `col.enum()`: adiciona um controle que redefine o valor para `null`. |

Um `EnumLabel` aceita:

| Chave | Tipo | Efeito |
|---|---|---|
| `label` | `string` | O texto no chip e no select. |
| `color` | `ColorKey \| ColorScheme` | Uma chave de cor de chip (`"green"`, `"orangeDark"`) ou um esquema `{ color, text }`. Um valor sem cor definida mantém a cor gerada inicialmente. |
| `disabled` | `boolean` | Exibido, mas não oferecido para seleção. |

### Colunas numéricas

| Opção | Tipo | Efeito |
|---|---|---|
| `clearable` | `boolean` | Adiciona um controle que redefine o valor para `null`. |
| `format` | `NumberFormatOptions` | Formata o número como moeda, porcentagem ou com casas decimais fixas. |

`format` aceita `style` (`"decimal"`, `"currency"`, `"percent"`), `currency` (um
código ISO, obrigatório com `"currency"`), `locale` (caso contrário, o do
usuário), `minimumFractionDigits`, `maximumFractionDigits` e `notation`
(`"standard"` ou `"compact"`, que formata `12000` como `12K`). Ele altera o que é
renderizado, nunca o que é armazenado.

### Colunas de data, timestamp e hora

| Opção | Tipo | Efeito |
|---|---|---|
| `clearable` | `boolean` | Adiciona um controle que redefine o valor para `null`. |
| `mode` | `"date" \| "date_time"` | Selecionar e exibir apenas o dia, ou o dia e a hora. Caso contrário, derivado do tipo da coluna. |
| `timezone` | `string` | O fuso horário IANA em que o valor é exibido e selecionado (`"Europe/Madrid"`). Caso contrário, o do usuário. |

### Colunas de vetor

| Opção | Tipo | Efeito |
|---|---|---|
| `clearable` | `boolean` | Adiciona um controle que redefine o valor para `null`. |

### Colunas de storage

| Opção | Tipo | Efeito |
|---|---|---|
| `storage` | `StorageCustomization` | As funções de upload executadas no navegador. |
| `clearable` | `boolean` | Adiciona um controle que redefine o valor para `null`. |
| `urlPreview` | `PreviewType \| boolean` | Como a URL armazenada é pré-visualizada. |

`storage` aceita apenas funções; as opções serializáveis permanecem em
`col.storage({ … })` (consulte [Uploads de arquivos](/docs/collections/file-uploads/)):

| Chave | Assinatura | Efeito |
|---|---|---|
| `path` | `(context) => string` | A pasta para a qual o arquivo é enviado, substituindo o template `path` da coluna. |
| `fileName` | `(context) => string \| Promise<string>` | O nome do arquivo armazenado, substituindo o template `fileName` da coluna. |
| `processFile` | `(file) => Promise<File>` | Transforma o arquivo antes de enviá-lo. |
| `postProcess` | `(pathOrUrl) => Promise<string>` | Transforma o caminho ou URL armazenado antes de ser gravado na coluna. |
| `previewUrl` | `(fileName) => string` | A URL na qual o arquivo armazenado pode ser pré-visualizado. |

### Colunas de array

| Opção | Tipo | Efeito |
|---|---|---|
| `expanded` | `boolean` | Todos os itens abertos ao carregar. |
| `minimalistView` | `boolean` | Itens sem sua moldura e cabeçalho. |
| `sortable` | `boolean` | Os itens podem ser reordenados arrastando. |
| `canAddElements` | `boolean` | Novos itens podem ser adicionados. |
| `of` | opções de campo | As opções de cada item. |
| `storage` | `StorageCustomization` | As funções de upload, para `col.storage().multiple()`. |

`enumLabels` e `enumOrder` definidos em um array se aplicam aos seus itens.

### Colunas JSON

| Opção | Tipo | Efeito |
|---|---|---|
| `expanded` | `boolean` | Os campos do documento abertos ao carregar. |
| `minimalistView` | `boolean` | Os campos do documento sem sua moldura. |
| `spreadChildren` | `boolean` | Os campos do documento distribuídos como se fossem do próprio registro. |
| `keyValue` | `boolean` | Editado como pares chave/valor livres. |
| `previewFields` | `string[]` | As chaves do documento listadas em seu resumo de linha única, nesta ordem. |
| `fields` | `{ [key]: opções de campo }` | As opções de cada chave do documento. |
| `fieldOrder` | `string[]` | A ordem em que as chaves do documento são exibidas. |
| `of` | opções de campo | As opções de cada item, para um documento que seja uma lista. |
| `oneOf` | `{ [variant]: opções de campo }` | As opções de cada variante de um bloco tipado (`json.oneOf`). |

Com `col.jsonb().$type<T>()` ou um formato `json.object({…})`, `fields` e `fieldOrder`
são tipados pelas chaves do documento. Consulte [Arrays e JSON](/docs/collections/arrays-and-maps/).

Em uma célula de tabela, linha de lista ou card, um documento JSON é exibido em
uma única linha: suas primeiras quatro chaves de nível superior (ou seus
`previewFields`), rotuladas com seu `name`, cada uma com seu valor quando este
for um texto curto, um número ou um sim/não, `3 items` para uma lista e `4 fields`
para um objeto aninhado, que não é expandido. Uma lista de documentos é exibida
como sua contagem. O documento completo permanece no registro e no editor de
expansão da célula. Para uma linha melhor, especifique as chaves relevantes em
`previewFields` ou forneça um componente `Preview` para o campo.

### Relações

| Opção | Tipo | Efeito |
|---|---|---|
| `previewFields` | `string[]` | Os campos do destino exibidos no chip para uma linha relacionada. Cabem no máximo três. |
| `defaultValue` | `EntityRelation \| EntityRelation[]` | A(s) linha(s) relacionada(s) com a(s) qual(is) o formulário de um novo registro começa: `new EntityRelation(id, "<target slug>")` (`EntityRelation` de `@rebasepro/cms-types`), ou uma lista para uma relação to-many. Gravado apenas quando o formulário é salvo. O padrão da própria coluna é `.default()` na coluna. |
| `widget` | `"select" \| "dialog"` | Como uma linha relacionada é selecionada. |
| `fixedFilter` | `FilterValues` | Oferece apenas linhas que passem por este filtro. |
| `includeId` | `boolean` | Exibe o id da linha relacionada nas pré-visualizações. |
| `includeEntityLink` | `boolean` | Exibe um link que abre a linha relacionada. |
| `renderInForm` | `boolean` | Também renderiza uma relação to-many como um seletor no formulário, ao lado de sua aba. |
| `overrides` | opções de tabela sem `fields` | Como o destino é apresentado na aba desta relação. |

Consulte [Relações no painel](/docs/collections/relations-in-the-admin-panel/).

## Customizações, `ui-config.json` e preferências

O que o painel exibe para uma tabela é composto em uma ordem fixa, cada camada
sobre a anterior:

1. **A coleção derivada**: o que o painel lê da tabela fornecida pelo servidor.
2. **Código**: os resultados de `customizeTable` que você passa como `tableCustomizations`.
3. **`frontend/src/cms/ui-config.json`**: a apresentação do workspace, passada
   como `uiConfig`. É um arquivo no frontend, editado manualmente (ou pelo seu
   agente), de forma que é revisado e publicado junto com ele.
4. **Preferências do workspace**: o que um administrador salva em uma implantação,
   na tabela `rebase.ui_preferences` por meio de
   [`/api/admin/ui-config`](/docs/backend/endpoints/). Gravá-las requer
   `schema:write`.
5. **Preferências do usuário**: larguras de coluna personalizadas, seleções de
   visualização e colunas ocultas de uma pessoa específica. Mantidas no navegador
   enquanto desconectada.

Um `App.tsx` gerado por scaffolding já conecta o arquivo:

```tsx
import { RebaseCMS } from "@rebasepro/cms";
import { tableCustomizations } from "./cms";
import uiConfig from "./cms/ui-config.json";

export const Admin = () => <RebaseCMS tableCustomizations={tableCustomizations} uiConfig={uiConfig} />;
```

As preferências contêm apenas apresentação: rótulos, ícone, modos de visualização,
ordem das colunas, colunas ocultas, rótulos e cores de enum, kanban e padrões de
consulta. Uma definição de schema nunca vai para lá; essas ficam em `backend/schema`.

O `rebase build` inclui `frontend/src/cms/ui-config.json` no bundle
(`entry.uiConfig`), para que um backend implantado também o conheça: o
`GET /api/admin/ui-config` o serve como `shipped` ao lado das camadas de workspace
e de usuário, e as visualizações MCP e `describe_table` combinam as mesmas três
camadas — o arquivo, o workspace e a própria do chamador (nenhuma para uma chave
de API) — para que um agente veja os rótulos, ordem, colunas ocultas e rótulos
de enum que uma pessoa vê no painel.

O `rebase verify` lê cada chamada de `customizeTable` em `frontend/src/cms` em
relação às tabelas, sem executá-la: ele detecta uma customização para uma tabela
ou campo inexistente, uma coluna obrigatória que o formulário oculta, uma tabela
customizada duas vezes, um `ui-config.json` que não é passado para nenhum `<RebaseCMS>`
e uma configuração do Vite sem `rebaseBackendGuard()`. Consulte [`rebase verify`](/docs/cli/#rebase-verify).

## Próximos passos

- [Como tabelas se tornam coleções](/docs/collections/): o que o painel deriva antes de tudo isso
- [Campos](/docs/collections/properties/): o widget e as opções de cada tipo de coluna
- [Modos de visualização](/docs/frontend/view-modes/): tabela, cards, kanban, slots de exibição, filtros
- [Ações de entidade](/docs/frontend/entity-actions/): `entityActions` e `updateRecord`
- [Firestore ao lado do Postgres](/docs/frontend/firebase/): `externalCollections` e referências entre diferentes bancos
