---
sourceHash: 35cdc0483d3f3fd4
title: Slots
sidebar_label: Slots
description: Referência para todos os slots de pontos de extensão de UI disponíveis no Rebase — locais nomeados onde você pode injetar componentes personalizados.
---

## Visão Geral

Slots são pontos de extensão de interface (UI) nomeados onde você pode injetar componentes React personalizados. Cada slot possui props tipadas específicas para sua localização na UI. O Rebase vem com 27 slots integrados que cobrem a página inicial, navegação, visualizações de coleções, formulários de entidades, a barra de aplicativos e muito mais.

Cada slot na tabela abaixo é renderizado. Se você registrar um componente para um slot e não visualizar nada, a falha está no seu componente ou em suas props, e não no slot — `UNRENDERED_SLOTS` em `@rebasepro/cms-types` está vazio, e um teste obtém essa lista escaneando os locais de renderização, de modo que um slot não pode ser declarado aqui sem que haja um correspondente.

## Uso

### Via prop do `<Rebase>`

```tsx no-verify
<Rebase
    client={client}
    slots={[
        {
            slot: "navigation.footer",
            Component: MyNavigationFooter,
            order: 10
        },
        {
            slot: "collection.actions",
            Component: BulkExportButton
        }
    ]}
>
```

### Via plugin

```typescript
const myPlugin: RebasePlugin = {
    key: "my-plugin",
    slots: [
        {
            slot: "home.cards",
            Component: AnalyticsCard,
            order: 20
        }
    ]
};
```

:::note
`order` controla a ordem de renderização — valores menores são renderizados primeiro. O padrão é `50`.
:::

## Slots Disponíveis

#### Página Inicial

| Slot | Tipo de Props | Descrição |
|------|-----------|-------------|
| `home.actions` | `PluginGenericProps` | Ações no cabeçalho da página inicial |
| `home.cards` | `PluginHomePageAdditionalCardsProps` | Cards adicionais na página inicial |
| `home.children.start` | `PluginGenericProps` | Conteúdo no início da página inicial |
| `home.children.end` | `PluginGenericProps` | Conteúdo no final da página inicial |
| `home.card.widget` | `HomeCardWidgetSlotProps` | Widget compacto dentro de um card de coleção da página inicial |
| `home.collection.actions` | `PluginHomePageActionsProps` | Ações nos cards de coleção da página inicial |

#### Navegação

| Slot | Tipo de Props | Descrição |
|------|-----------|-------------|
| `navigation.header` | `NavigationSlotProps` | Abaixo do logotipo no menu lateral (drawer) |
| `navigation.footer` | `NavigationSlotProps` | Acima do botão de recolher na parte inferior do menu lateral (drawer) |

#### Visualização de Coleção

| Slot | Tipo de Props | Descrição |
|------|-----------|-------------|
| `collection.actions` | `CollectionActionsProps` | Ações da barra de ferramentas no lado final (após `Actions` da coleção) |
| `collection.actions.start` | `CollectionActionsProps` | Ações da barra de ferramentas no lado inicial (ao lado dos filtros) |
| `collection.header.action` | `CollectionHeaderActionProps` | Botões de ação no cabeçalho da coluna |
| `collection.add-column` | `CollectionAddColumnProps` | Área "Adicionar coluna" no cabeçalho da tabela |
| `collection.error` | `CollectionErrorProps` | Exibição do estado de erro para uma coleção |
| `collection.toolbar` | `CollectionToolbarProps` | Widgets extras dentro da linha da barra de ferramentas da coleção |
| `collection.empty-state` | `CollectionEmptyStateProps` | Estado vazio (empty-state) personalizado quando a coleção não possui dados |
| `collection.widgets` | `CollectionWidgetsSlotProps` | Widgets acima da tabela da coleção |

Onde um slot de coleção recebe o `tableController` ou `selectionController` da visualização, eles manipulam as linhas conforme o servidor as envia: `tableController.rows` (com `loading`, `error` e o filtro, busca e ordenação da barra de ferramentas), e uma seleção por id — `selection` é `{ type: "rows", ids, rows }` ou `{ type: "query", query, excludedIds, count }`, e `isSelected(id)` consulta sobre uma única linha.

#### Entidade / Formulário

| Slot | Tipo de Props | Descrição |
|------|-----------|-------------|
| `form.actions` | `PluginFormActionProps` | Ações na barra de ações do formulário de entidade. Recebe o `id` do registro (ausente enquanto for novo), `path`, `status`, `collection` e `formContext` |
| `form.actions.top` | `PluginFormActionProps` | Ações acima da barra de ações do formulário |
| `form.before` | `PluginFormActionProps` | Conteúdo antes do título/lista de campos do formulário |
| `form.after` | `PluginFormActionProps` | Conteúdo após a lista de campos do formulário |
| `entity.row.actions` | `EntityRowActionsProps` | Ações por linha em tabelas de coleção, ao lado das ferramentas de linha integradas. Recebe a linha conforme enviada pelo servidor (`row`), seu `id`, `path`, `collection`, o `selectionController` da tabela e `context` |
| `entity.field.before` | `EntityFieldSlotProps` | UI injetada antes de um campo individual do formulário. Recebe o `propertyKey` e `property` do campo, e o `path` e `id` do registro (ausente enquanto for novo) |
| `entity.field.after` | `EntityFieldSlotProps` | UI injetada após um campo individual do formulário |

#### Global / Shell

| Slot | Tipo de Props | Descrição |
|------|-----------|-------------|
| `global.search` | `GlobalSearchProps` | Busca entre coleções, na barra de aplicativos ao lado dos breadcrumbs |
| `shell.toolbar` | `ShellToolbarProps` | Ações de nível superior, no final da barra de aplicativos |

:::note
Para um widget na página inicial, use `home.children.start`, `home.children.end`,
`home.cards` ou `home.card.widget` — essas são as quatro posições da página inicial.
Não há `dashboard.widget`: ele recebia apenas o contexto, portanto não nomeava nenhuma
posição em uma página que já possuía quatro.

Para a interface de filtro ao lado de uma tabela, use `collection.toolbar` ou
`collection.widgets`. Não há `collection.filter-panel`: o painel de administração não possui
uma barra lateral de filtros onde ele possa ser renderizado.
:::

#### Kanban

| Slot | Tipo de Props | Descrição |
|------|-----------|-------------|
| `kanban.setup` | `KanbanSetupProps` | UI de configuração do quadro kanban |
| `kanban.add-column` | `KanbanAddColumnProps` | "Adicionar coluna" na visualização kanban |

## Referência de Props dos Slots

Todos os tipos de props de slots são exportados de `@rebasepro/cms-types` e podem ser importados para componentes de slot com segurança de tipos (type-safe):

```typescript
import type { CollectionActionsProps, NavigationSlotProps } from "@rebasepro/cms-types";
```

Cada tipo de props fornece acesso ao contexto relevante para a localização do slot — metadados de coleção, dados de entidade, estado de navegação e muito mais. Consulte as definições de tipo individuais para obter todos os detalhes das propriedades.

## Relacionados

- [Substituições de Componentes (Swizzling)](/docs/frontend/component-overrides/) — quando um slot não é suficiente
- [Estendendo o Rebase](/docs/frontend/extending/) — o restante da superfície de extensão
- [Plugins](/docs/plugins/) — distribuindo conteúdo de slots como um plugin
