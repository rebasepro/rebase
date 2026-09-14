---
sourceHash: 24ecb93e6262aeca
title: Slots
sidebar_label: Slots
description: Referência para todos os slots de pontos de extensão de UI disponíveis no Rebase — locais nomeados onde você pode injetar componentes personalizados.
---

## Visão Geral

Slots são pontos de extensão de UI nomeados onde você pode injetar componentes React personalizados. Cada slot possui props tipadas específicas para sua localização na UI. O Rebase vem com 29 slots integrados cobrindo a página inicial, navegação, visualizações de coleções, formulários de entidades, dashboards e mais.

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
| `home.card.widget` | `HomeCardWidgetSlotProps` | Widget compacto dentro de um card de coleção na página inicial |
| `home.collection.actions` | `PluginHomePageActionsProps` | Ações nos cards de coleção da página inicial |

#### Navegação

| Slot | Tipo de Props | Descrição |
|------|-----------|-------------|
| `navigation.header` | `NavigationSlotProps` | Abaixo do logo no menu lateral (drawer) |
| `navigation.footer` | `NavigationSlotProps` | Acima do botão de recolher na parte inferior do menu lateral |

#### Visualização de Coleção

| Slot | Tipo de Props | Descrição |
|------|-----------|-------------|
| `collection.actions` | `CollectionActionsProps` | Ações da barra de ferramentas do lado final (após `Actions` da coleção) |
| `collection.actions.start` | `CollectionActionsProps` | Ações da barra de ferramentas do lado inicial (ao lado dos filtros) |
| `collection.header.action` | `CollectionHeaderActionProps` | Botões de ação do cabeçalho da coluna |
| `collection.add-column` | `CollectionAddColumnProps` | Área "Adicionar coluna" no cabeçalho da tabela |
| `collection.error` | `CollectionErrorProps` | Exibição do estado de erro para uma coleção |
| `collection.toolbar` | `CollectionToolbarProps` | Widgets extras dentro da linha da barra de ferramentas da coleção |
| `collection.empty-state` | `CollectionEmptyStateProps` | Estado vazio personalizado quando a coleção não tem dados |
| `collection.widgets` | `CollectionWidgetsSlotProps` | Widgets acima da tabela da coleção |
| `collection.filter-panel` | `CollectionFilterPanelProps` | Barra lateral de filtros personalizados ao lado da tabela. **Ainda não renderizado** — declarado, mas nada no admin o renderiza atualmente. |

#### Entidade / Formulário

| Slot | Tipo de Props | Descrição |
|------|-----------|-------------|
| `form.actions` | `PluginFormActionProps` | Ações na barra de ações do formulário de entidade |
| `form.actions.top` | `PluginFormActionProps` | Ações acima da barra de ações do formulário |
| `form.before` | `PluginFormActionProps` | Conteúdo antes do título do formulário/lista de campos |
| `form.after` | `PluginFormActionProps` | Conteúdo após a lista de campos do formulário |
| `entity.row.actions` | `EntityRowActionsProps` | Ações por linha em tabelas de entidades. **Ainda não renderizado** — declarado, mas nada no admin o renderiza atualmente. |
| `entity.field.before` | `EntityFieldSlotProps` | UI injetada antes de um campo individual do formulário. **Ainda não renderizado** — declarado, mas nada no admin a renderiza atualmente. |
| `entity.field.after` | `EntityFieldSlotProps` | UI injetada após um campo individual do formulário. **Ainda não renderizado** — declarado, mas nada no admin a renderiza atualmente. |

#### Dashboard

| Slot | Tipo de Props | Descrição |
|------|-----------|-------------|
| `dashboard.widget` | `DashboardWidgetProps` | Widgets no dashboard/página inicial. **Ainda não renderizado** — declarado, mas nada no admin o renderiza atualmente. |

#### Global

| Slot | Tipo de Props | Descrição |
|------|-----------|-------------|
| `global.search` | `GlobalSearchProps` | Componente de barra de pesquisa entre coleções. **Ainda não renderizado** — declarado, mas nada no admin o renderiza atualmente. |
| `shell.toolbar` | `ShellToolbarProps` | Ações de barra de ferramentas de nível superior na barra do aplicativo. **Ainda não renderizado** — declarado, mas nada no admin as renderiza atualmente. |

#### Kanban

| Slot | Tipo de Props | Descrição |
|------|-----------|-------------|
| `kanban.setup` | `KanbanSetupProps` | UI de configuração do quadro kanban |
| `kanban.add-column` | `KanbanAddColumnProps` | "Adicionar coluna" na visualização kanban |

## Referência de Props dos Slots

Todos os tipos de props de slot são exportados de `@rebasepro/types` e podem ser importados para componentes de slot com segurança de tipos:

```typescript
import type { CollectionActionsProps, NavigationSlotProps } from "@rebasepro/cms-types";
```

Cada tipo de props fornece acesso ao contexto relevante para a localização do slot — metadados da coleção, dados da entidade, estado de navegação e mais. Consulte as definições de tipo individuais para obter detalhes completos das propriedades.

## Relacionados

- [Substituições de Componentes (Swizzling)](/docs/frontend/component-overrides/) — quando um slot não é suficiente
- [Estendendo o Rebase](/docs/frontend/extending/) — o restante da superfície de extensão
- [Plugins](/docs/plugins/) — distribuindo conteúdo de slots como um plugin
