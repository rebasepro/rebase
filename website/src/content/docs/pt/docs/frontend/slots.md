---
sourceHash: 02aa0ee46111d905
title: Slots
sidebar_label: Slots
description: Referência para todos os slots de pontos de extensão de UI disponíveis no Rebase — locais nomeados onde você pode injetar componentes personalizados.
---

## Visão Geral

Slots são pontos de extensão de UI nomeados onde você pode injetar componentes React personalizados. Cada slot possui props tipadas específicas para sua localização na UI. O Rebase vem com 27 slots integrados que abrangem a página inicial, navegação, visualizações de coleção, formulários de entidade, a barra de aplicativos (app bar) e muito mais.

Todos os slots na tabela abaixo são renderizados. Se você registrar um componente para um slot e não vir nada, a falha está no seu componente ou em suas props, não no slot — `UNRENDERED_SLOTS` em `@rebasepro/cms-types` está vazio, e um teste obtém essa lista verificando os locais de renderização, de modo que um slot não pode ser declarado aqui sem um local de renderização.

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
`order` controla a ordem de renderização — valores menores renderizam primeiro. O padrão é `50`.
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
| `navigation.header` | `NavigationSlotProps` | Abaixo do logotipo na barra lateral (drawer) |
| `navigation.footer` | `NavigationSlotProps` | Acima do botão de recolher na parte inferior da barra lateral |

#### Visualização de Coleção

| Slot | Tipo de Props | Descrição |
|------|-----------|-------------|
| `collection.actions` | `CollectionActionsProps` | Ações da barra de ferramentas no lado final (após as `Actions` da coleção) |
| `collection.actions.start` | `CollectionActionsProps` | Ações da barra de ferramentas no lado inicial (ao lado dos filtros) |
| `collection.header.action` | `CollectionHeaderActionProps` | Botões de ação no cabeçalho da coluna |
| `collection.add-column` | `CollectionAddColumnProps` | Área "Adicionar coluna" no cabeçalho da tabela |
| `collection.error` | `CollectionErrorProps` | Exibição do estado de erro para uma coleção |
| `collection.toolbar` | `CollectionToolbarProps` | Widgets extras dentro da linha da barra de ferramentas da coleção |
| `collection.empty-state` | `CollectionEmptyStateProps` | Estado vazio personalizado quando a coleção não possui dados |
| `collection.widgets` | `CollectionWidgetsSlotProps` | Widgets acima da tabela da coleção |

Onde um slot de coleção recebe o `tableController` ou `selectionController` da
visualização, eles lidam com as linhas conforme o servidor as envia:
`tableController.rows` (com seus ids nas mesmas posições em
`tableController.ids`, `loading`, `error` e o filtro, busca e ordenação da
barra de ferramentas), e uma seleção por id — `selection` é
`{ type: "rows", ids, rows }` ou `{ type: "query", query, excludedIds, count }`,
e `isSelected(id)` consulta uma linha específica.

#### Entidade / Formulário

| Slot | Tipo de Props | Descrição |
|------|-----------|-------------|
| `form.actions` | `PluginFormActionProps` | Ações na barra de ações do formulário de entidade. Recebe o `id` do registro (ausente enquanto for novo), `path`, `status`, `collection` e `formContext` |
| `form.actions.top` | `PluginFormActionProps` | Ações acima da barra de ações do formulário |
| `form.before` | `PluginFormActionProps` | Conteúdo antes do título/lista de campos do formulário |
| `form.after` | `PluginFormActionProps` | Conteúdo após a lista de campos do formulário |
| `entity.row.actions` | `EntityRowActionsProps` | Ações por linha em tabelas de coleção, ao lado das ferramentas de linha integradas. Recebe a linha como o servidor a envia (`row`), seu `id`, `path`, `collection`, o `selectionController` da tabela e o `context` |
| `entity.field.before` | `EntityFieldSlotProps` | UI injetada antes de um campo de formulário individual. Recebe o `propertyKey` e o `property` do campo, e o `path` e o `id` do registro (ausente enquanto for novo) |
| `entity.field.after` | `EntityFieldSlotProps` | UI injetada após um campo de formulário individual |

#### Global / Shell

| Slot | Tipo de Props | Descrição |
|------|-----------|-------------|
| `global.search` | `GlobalSearchProps` | Busca entre coleções (cross-collection), na barra de aplicativos ao lado das breadcrumbs |
| `shell.toolbar` | `ShellToolbarProps` | Ações de nível superior, no final da barra de aplicativos |

:::note
Para um widget na página inicial, use `home.children.start`, `home.children.end`,
`home.cards` ou `home.card.widget` — essas são as quatro posições da página inicial.
Não existe `dashboard.widget`: ele recebia apenas o contexto, portanto, não nomeava
nenhuma posição em uma página que já tinha quatro.

Para uma UI de filtro ao lado de uma tabela, use `collection.toolbar` ou
`collection.widgets`. Não existe `collection.filter-panel`: o painel de administração não possui
uma barra lateral de filtros onde ele possa ser renderizado.
:::

#### Kanban

| Slot | Tipo de Props | Descrição |
|------|-----------|-------------|
| `kanban.setup` | `KanbanSetupProps` | UI de configuração do quadro kanban |
| `kanban.add-column` | `KanbanAddColumnProps` | "Adicionar coluna" na visualização kanban |

## Referência de Props dos Slots

Todos os tipos de props dos slots são exportados de `@rebasepro/cms-types` e podem ser importados para componentes de slot type-safe:

```typescript
import type { CollectionActionsProps, NavigationSlotProps } from "@rebasepro/cms-types";
```

Cada tipo de props fornece acesso ao contexto relevante para a localização do slot — metadados da coleção, dados da entidade, estado de navegação e muito mais. Consulte as definições de tipo individuais para obter detalhes completos das propriedades.

## Relacionados

- [Component Overrides (Swizzling)](/docs/frontend/component-overrides/) — quando um slot não é suficiente
- [Extending Rebase](/docs/frontend/extending/) — o restante da superfície de extensão
- [Plugins](/docs/plugins/) — distribuindo conteúdo de slot como um plugin
