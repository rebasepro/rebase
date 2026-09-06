---
sourceHash: 5de2aebf9af99221
title: Estendendo a Rebase
sidebar_label: Estendendo a Rebase
description: Um guia de decisão para escolher o mecanismo de extensão certo — plugins, slots, substituições de componentes, visões de entidade, ações e mais.
---

## Visão Geral

A Rebase oferece cerca de uma dúzia de mecanismos de extensão — plugins, slots, substituições de componentes, visões de entidade, ações, campos personalizados e mais. Cada um mira um escopo diferente (em toda a app, por coleção, por entidade, por propriedade) e uma parte diferente da UI.

Este guia ajuda você a escolher o mecanismo certo para o seu caso de uso e, em seguida, direciona para a referência detalhada de cada um.

## Tabela de Decisão

| Eu quero… | Mecanismo | Escopo | Referência |
|---|---|---|---|
| Substituir a barra do app | `components` (`Shell.AppBar`) | app | [Substituição de Componentes](/docs/frontend/component-overrides) |
| Substituir a página de login | `components` (`Auth.LoginView`) | app | [Substituição de Componentes](/docs/frontend/component-overrides) |
| Substituir a página inicial | `components` (`HomePage`) | app | [Substituição de Componentes](/docs/frontend/component-overrides) |
| Mudar completamente a aparência do formulário de uma coleção | `formView` | coleção | [abaixo](#formview) |
| Trocar um componente dentro de uma coleção | `collection.components` | coleção | [Substituição de Componentes](/docs/frontend/component-overrides) |
| Definir substituições de componentes padrão para todas as coleções | `components` (nomes com escopo de coleção) | app | [Substituição de Componentes](/docs/frontend/component-overrides) |
| Adicionar um botão à barra de ferramentas da coleção | `Actions` de coleção | coleção | [Ações de Entidade](/docs/frontend/entity-actions#collection-actions) |
| Injetar UI em um slot da barra de ferramentas da coleção | slot `collection.actions` | app/plugin | [Slots](/docs/frontend/slots) |
| Adicionar uma coluna computada a uma tabela | `additionalFields` | coleção | [Colunas Adicionais](/docs/frontend/additional-columns) |
| Adicionar um widget de campo personalizado para um tipo de propriedade | `propertyConfigs` | tipo de propriedade | [Campos Personalizados](/docs/frontend/custom-fields) |
| Adicionar uma aba de entidade | `entityViews` | entidade | [Visões de Entidade](/docs/frontend/entity-views) |
| Adicionar uma ação de linha/contexto ou um botão de entidade | `entityActions` | entidade | [Ações de Entidade](/docs/frontend/entity-actions) |
| Injetar UI em um local específico do chrome | `slots` | app/plugin | [Slots](/docs/frontend/slots) |
| Entregar várias extensões como uma única unidade instalável | `plugins` | app | [Plugins](/docs/plugins) |

## Mecanismos em Detalhe

### Plugins

**Escopo:** app.

Um plugin agrupa coleções, visões, substituições de componentes, contribuições de slots, autenticação, fontes de dados, provedores, hooks e callbacks de ciclo de vida em uma única unidade instalável. Todos os outros mecanismos listados aqui podem ser contribuídos através da interface de um plugin.

→ [Referência de Plugins](/docs/plugins)

### Slots

**Escopo:** app (contribuído por slot).

Slots são pontos de extensão de UI nomeados espalhados por todo o chrome do CMS. Você registra um componente React apontando para o nome de um slot, e ele é renderizado naquele local. Há 29 slots cobrindo a página inicial, a navegação, as visões de coleção, os formulários, as linhas de entidade, os dashboards e mais.

→ [Referência de Slots](/docs/frontend/slots)

### Substituição de Componentes (Swizzling)

**Escopo:** padrões no nível do app ou por coleção.

Dois modos: **Eject** (substituição completa) ou **Wrap** (aumentar o original).

19 nomes de componentes substituíveis em dois níveis:

**Somente app (7):**
- `Shell.AppBar`
- `Shell.Drawer`
- `Shell.DrawerNavigationItem`
- `Shell.DrawerNavigationGroup`
- `HomePage`
- `HomePage.CollectionCard`
- `Auth.LoginView`

**Escopo de coleção (12):**
- `Collection.View`
- `Collection.Table`
- `Collection.Card`
- `Collection.EmptyState`
- `Collection.Actions`
- `Collection.FilterField`
- `Entity.Form`
- `EditView.FormActions`
- `DetailView`
- `Entity.SidePanel`
- `EntityPreview`
- `Entity.MissingReference`

**Precedência:** Os `components` no nível da coleção substituem os padrões no nível do app para o mesmo nome de componente (spread de objeto simples — os valores da coleção sobrescrevem os valores globais). Os nomes de componentes somente-app (`Shell.*`, `HomePage`, `Auth.*`) só podem ser substituídos no nível de `<Rebase>`.

→ [Substituição de Componentes](/docs/frontend/component-overrides)

### Visões de Entidade

**Escopo:** entidade (adiciona abas).

Visões personalizadas que aparecem como abas na página de detalhe da entidade. Podem ser definidas globalmente em `<Rebase>` ou por coleção.

→ [Visões de Entidade](/docs/frontend/entity-views)

### Ações de Entidade

**Escopo:** entidade.

Botões de ação personalizados em entidades individuais (publicar, arquivar, clonar, etc.). Podem ser definidos globalmente ou por coleção.

→ [Ações de Entidade](/docs/frontend/entity-actions)

### `Actions` de Coleção

**Escopo:** coleção.

Componentes React no nível da barra de ferramentas que recebem `CollectionActionsProps` (entidades selecionadas, controlador da tabela, contexto da coleção). Renderizados na barra de ferramentas da coleção junto às ações integradas.

**Relação com o slot `collection.actions`:** Ambos são aditivos — os componentes `Actions` são renderizados primeiro na barra de ferramentas, depois as contribuições de slot de `collection.actions`. Eles não se substituem.

→ [Ações de Entidade — Ações de Coleção](/docs/frontend/entity-actions#collection-actions)

### `formView` {#formview}

**Escopo:** coleção.

Substitui todo o formulário de entidade padrão por um componente personalizado. Definido em uma definição de coleção:

```typescript
const collection = {
    slug: "products",
    admin: {
        formView: {
            Builder: MyCustomProductForm,
            includeActions: true  // show save/delete bar (default: true)
        }
    }
};

```

Use quando você precisar de um layout completamente personalizado para a experiência de edição de entidades de uma coleção. Para ajustes menores, prefira `collection.components` com a substituição `Entity.Form`.

### `additionalFields`

**Escopo:** coleção.

Colunas computadas/virtuais exibidas na tabela da coleção. Elas não correspondem a propriedades armazenadas — são calculadas no momento da renderização.

→ [Colunas Adicionais](/docs/frontend/additional-columns)

### `propertyConfigs`

**Escopo:** tipo de propriedade.

Widgets de campo personalizados para tipos de propriedade específicos, fornecendo campos de formulário e componentes de pré-visualização personalizados.

→ [Campos Personalizados](/docs/frontend/custom-fields)

## Resumo de Precedência

- **`collection.components` vence os `components` globais** dentro daquela coleção (mesclagem por spread simples em `DataCollectionView`).
- **As `Actions` de coleção e o slot `collection.actions` são aditivos** — as `Actions` são renderizadas primeiro, depois as contribuições de slot.
- **Os `entityActions` e `entityViews` no nível da coleção estendem (não substituem) os globais.**
- **As contribuições de plugin são mescladas na ordem de `key`.**
