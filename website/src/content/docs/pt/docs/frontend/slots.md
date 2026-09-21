---
sourceHash: e229c0d2b62d6bee
title: Slots
sidebar_label: Slots
description: Referência para todos os slots de pontos de extensão de UI disponíveis no Rebase — locais nomeados onde você pode injetar componentes customizados.
---

## Visão Geral

Slots são pontos de extensão de UI nomeados onde você pode injetar componentes React customizados. Cada slot possui props tipadas específicas para sua localização na UI. O Rebase vem com 27 slots integrados cobrindo a página inicial, navegação, visualizações de coleções, formulários de entidades, a app bar e muito mais.

Cada slot na tabela abaixo é renderizado. Se você registrar um componente para um e não vir nada, o erro está no seu componente ou em suas props, não no slot — `UNRENDERED_SLOTS` em `@rebasepro/cms-types` está vazio, e um teste deriva essa lista escaneando por locais de renderização, de modo que um slot não pode ser declarado aqui sem um local correspondente.

## Uso

### Via prop `<Rebase>`

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
| `navigation.header` | `NavigationSlotProps` | Abaixo do logo na gaveta da barra lateral (sidebar drawer) |
| `navigation.footer` | `NavigationSlotProps` | Acima do botão de recolher na parte inferior da gaveta |

#### Visualização de Coleção

| Slot | Tipo de Props | Descrição |
|------|-----------|-------------|
| `collection.actions` | `CollectionActionsProps` | Ações da barra de ferramentas no lado final (após `Actions` da coleção) |
| `collection.actions.start` | `CollectionActionsProps` | Ações da barra de ferramentas no lado inicial (ao lado dos filtros) |
| `collection.header.action` | `CollectionHeaderActionProps` | Botões de ação no cabeçalho da coluna |
| `collection.add-column` | `CollectionAddColumnProps` | Área "Add column" no cabeçalho da tabela |
| `collection.error` | `CollectionErrorProps` | Exibição do estado de erro para uma coleção |
| `collection.toolbar` | `CollectionToolbarProps` | Widgets extras dentro da linha da barra de ferramentas da coleção |
| `collection.empty-state` | `CollectionEmptyStateProps` | Estado vazio (empty-state) customizado quando a coleção não tem dados |
| `collection.widgets` | `CollectionWidgetsSlotProps` | Widgets acima da tabela de coleção |

#### Entidade / Formulário

| Slot | Tipo de Props | Descrição |
|------|-----------|-------------|
| `form.actions` | `PluginFormActionProps` | Ações na barra de ações do formulário de entidade |
| `form.actions.top` | `PluginFormActionProps` | Ações acima da barra de ações do formulário |
| `form.before` | `PluginFormActionProps` | Conteúdo antes do título/lista de campos do formulário |
| `form.after` | `PluginFormActionProps` | Conteúdo após a lista de campos do formulário |
| `entity.row.actions` | `EntityRowActionsProps` | Ações por linha em tabelas de coleção, ao lado das ferramentas de linha integradas |
| `entity.field.before` | `EntityFieldSlotProps` | UI injetada antes de um campo de formulário individual |
| `entity.field.after` | `EntityFieldSlotProps` | UI injetada após um campo de formulário individual |

#### Global / Shell

| Slot | Tipo de Props | Descrição |
|------|-----------|-------------|
| `global.search` | `GlobalSearchProps` | Busca entre coleções, na app bar ao lado dos breadcrumbs |
| `shell.toolbar` | `ShellToolbarProps` | Ações de nível superior, no final da app bar |

:::note
Para um widget na página inicial, use `home.children.start`, `home.children.end`,
`home.cards` ou `home.card.widget` — essas são as quatro posições da página inicial.
Não existe `dashboard.widget`: ele recebia apenas o contexto, portanto não nomeava nenhuma
posição em uma página que já tinha quatro.

Para UI de filtros ao lado de uma tabela, use `collection.toolbar` ou
`collection.widgets`. Não existe `collection.filter-panel`: o admin não possui
uma barra lateral de filtros para que ele seja renderizado nela.
:::

#### Kanban

| Slot | Tipo de Props | Descrição |
|------|-----------|-------------|
| `kanban.setup` | `KanbanSetupProps` | UI de configuração do quadro Kanban |
| `kanban.add-column` | `KanbanAddColumnProps` | "Add column" na visualização kanban |

## Referência de Props dos Slots

Todos os tipos de props de slot são exportados de `@rebasepro/types` e podem ser importados para componentes de slot com tipagem segura:

```typescript
import type { CollectionActionsProps, NavigationSlotProps } from "@rebasepro/cms-types";
```

Cada tipo de props fornece acesso ao contexto relevante para a localização do slot — metadados da coleção, dados da entidade, estado de navegação e muito mais. Consulte as definições de tipo individuais para obter todos os detalhes das propriedades.

## Relacionado

- [Component Overrides (Swizzling)](/docs/frontend/component-overrides/) — quando um slot não é suficiente
- [Estendendo o Rebase](/docs/frontend/extending/) — o restante da superfície de extensão
- [Plugins](/docs/plugins/) — distribuindo conteúdo de slots como um plugin
