---
title: Slots
sidebar_label: Slots
description: Referência de todos os slots de pontos de extensão de UI disponíveis na Rebase — locais nomeados onde você pode injetar componentes personalizados.
---

## Visão Geral

Slots são pontos de extensão de UI nomeados onde você pode injetar componentes React personalizados. Cada slot tem props tipadas específicas para o seu local na UI. A Rebase vem com 29 slots integrados cobrindo a página inicial, a navegação, as visões de coleção, os formulários de entidade, os dashboards e mais.

## Uso

### Via prop `<Rebase>`

```tsx
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
`order` controla a ordem de renderização — valores mais baixos são renderizados primeiro. O padrão é `50`.
:::

## Slots Disponíveis

#### Página Inicial

| Slot | Tipo de Props | Descrição |
|------|-----------|-------------|
| `home.actions` | `PluginGenericProps` | Ações no cabeçalho da página inicial |
| `home.cards` | `PluginHomePageAdditionalCardsProps` | Cards adicionais na página inicial |
| `home.children.start` | `PluginGenericProps` | Conteúdo no início da página inicial |
| `home.children.end` | `PluginGenericProps` | Conteúdo no fim da página inicial |
| `home.card.widget` | `HomeCardWidgetSlotProps` | Widget compacto dentro de um card de coleção da página inicial |
| `home.collection.actions` | `PluginHomePageActionsProps` | Ações nos cards de coleção da página inicial |

#### Navegação

| Slot | Tipo de Props | Descrição |
|------|-----------|-------------|
| `navigation.header` | `NavigationSlotProps` | Abaixo do logo no drawer da barra lateral |
| `navigation.footer` | `NavigationSlotProps` | Acima do botão de recolher na parte inferior do drawer |

#### Visão de Coleção

| Slot | Tipo de Props | Descrição |
|------|-----------|-------------|
| `collection.actions` | `CollectionActionsProps` | Ações da barra de ferramentas do lado final (após as `Actions` de coleção) |
| `collection.actions.start` | `CollectionActionsProps` | Ações da barra de ferramentas do lado inicial (junto aos filtros) |
| `collection.header.action` | `CollectionHeaderActionProps` | Botões de ação dos cabeçalhos de coluna |
| `collection.add-column` | `CollectionAddColumnProps` | Área "Adicionar coluna" no cabeçalho da tabela |
| `collection.error` | `CollectionErrorProps` | Exibição do estado de erro de uma coleção |
| `collection.toolbar` | `CollectionToolbarProps` | Widgets extras dentro da linha da barra de ferramentas da coleção |
| `collection.empty-state` | `CollectionEmptyStateProps` | Estado vazio personalizado quando a coleção não tem dados |
| `collection.widgets` | `CollectionWidgetsSlotProps` | Widgets acima da tabela da coleção |
| `collection.filter-panel` | `CollectionFilterPanelProps` | Barra lateral de filtros personalizada junto à tabela. **Ainda não renderizado** — declarado, mas hoje nada no painel o renderiza. |

#### Entidade / Formulário

| Slot | Tipo de Props | Descrição |
|------|-----------|-------------|
| `form.actions` | `PluginFormActionProps` | Ações na barra de ações do formulário de entidade |
| `form.actions.top` | `PluginFormActionProps` | Ações acima da barra de ações do formulário |
| `form.before` | `PluginFormActionProps` | Conteúdo antes do título/lista de campos do formulário |
| `form.after` | `PluginFormActionProps` | Conteúdo após a lista de campos do formulário |
| `entity.row.actions` | `EntityRowActionsProps` | Ações por linha nas tabelas de entidade. **Ainda não renderizado** — declarado, mas hoje nada no painel o renderiza. |
| `entity.field.before` | `EntityFieldSlotProps` | UI injetada antes de um campo de formulário individual. **Ainda não renderizado** — declarado, mas hoje nada no painel o renderiza. |
| `entity.field.after` | `EntityFieldSlotProps` | UI injetada após um campo de formulário individual. **Ainda não renderizado** — declarado, mas hoje nada no painel o renderiza. |

#### Dashboard

| Slot | Tipo de Props | Descrição |
|------|-----------|-------------|
| `dashboard.widget` | `DashboardWidgetProps` | Widgets no dashboard/página inicial. **Ainda não renderizado** — declarado, mas hoje nada no painel o renderiza. |

#### Global

| Slot | Tipo de Props | Descrição |
|------|-----------|-------------|
| `global.search` | `GlobalSearchProps` | Componente de barra de busca entre coleções. **Ainda não renderizado** — declarado, mas hoje nada no painel o renderiza. |
| `shell.toolbar` | `ShellToolbarProps` | Ações da barra de ferramentas de nível superior na barra do app. **Ainda não renderizado** — declarado, mas hoje nada no painel o renderiza. |

#### Kanban

| Slot | Tipo de Props | Descrição |
|------|-----------|-------------|
| `kanban.setup` | `KanbanSetupProps` | UI de configuração do quadro Kanban |
| `kanban.add-column` | `KanbanAddColumnProps` | "Adicionar coluna" na visão kanban |

## Referência de Props dos Slots

Todos os tipos de props dos slots são exportados de `@rebasepro/types` e podem ser importados para componentes de slot com segurança de tipos:

```typescript
import type { CollectionActionsProps, NavigationSlotProps } from "@rebasepro/cms-types";
```

Cada tipo de props fornece acesso ao contexto relevante para o local do slot — metadados de coleção, dados de entidade, estado de navegação e mais. Consulte as definições de tipo individuais para todos os detalhes das propriedades.
