---
sourceHash: 387b83637f6dc883
title: Estendendo o Rebase
sidebar_label: Estendendo o Rebase
description: Um guia de decisão para escolher o mecanismo de extensão correto — plugins, slots, substituições de componentes, visualizações de entidades, ações e muito mais.
---

## Visão Geral

O Rebase oferece cerca de uma dúzia de mecanismos de extensão — plugins, slots, substituições de componentes, visualizações de entidades, ações, campos personalizados e muito mais. Cada um visa um escopo diferente (em toda a aplicação, por coleção, por entidade, por propriedade) e uma parte diferente da UI.

Este guia ajuda você a escolher o mecanismo certo para o seu caso de uso e, em seguida, direciona para a referência detalhada de cada um.

## Tabela de Decisão

| Eu quero… | Mecanismo | Escopo | Referência |
|---|---|---|---|
| Substituir a barra do aplicativo (app bar) | `components` (`Shell.AppBar`) | app | [Substituições de Componentes](/docs/frontend/component-overrides) |
| Substituir a página de login | `components` (`Auth.LoginView`) | app | [Substituições de Componentes](/docs/frontend/component-overrides) |
| Substituir a página inicial | `components` (`HomePage`) | app | [Substituições de Componentes](/docs/frontend/component-overrides) |
| Alterar totalmente a aparência do formulário de uma coleção | `formView` | collection | [abaixo](#formview) |
| Trocar um componente dentro de uma coleção | `collection.components` | collection | [Substituições de Componentes](/docs/frontend/component-overrides) |
| Definir substituições de componentes padrão para todas as coleções | `components` (nomes com escopo de coleção) | app | [Substituições de Componentes](/docs/frontend/component-overrides) |
| Adicionar um botão à barra de ferramentas da coleção | `Actions` da coleção | collection | [Ações de Entidade](/docs/frontend/entity-actions#collection-actions) |
| Injetar UI em um slot da barra de ferramentas da coleção | slot `collection.actions` | app/plugin | [Slots](/docs/frontend/slots) |
| Adicionar uma coluna computada a uma tabela | `additionalFields` | collection | [Colunas Adicionais](/docs/frontend/additional-columns) |
| Adicionar um widget de campo personalizado para um tipo de propriedade | `propertyConfigs` | tipo de propriedade | [Campos Personalizados](/docs/frontend/custom-fields) |
| Adicionar uma aba de entidade | `entityViews` | entity | [Visualizações de Entidade](/docs/frontend/entity-views) |
| Renderizar as linhas de uma coleção de uma maneira diferente | `admin.customViews` | collection | [abaixo](#customviews) |
| Adicionar uma ação de linha/contexto ou botão de entidade | `entityActions` | entity | [Ações de Entidade](/docs/frontend/entity-actions) |
| Colocar um número/gráfico no card da página inicial de uma coleção | slot `home.card.widget` | app/plugin | [Slots](/docs/frontend/slots) |
| Injetar UI em um local específico da interface (chrome) | `slots` | app/plugin | [Slots](/docs/frontend/slots) |
| Distribuir várias extensões como uma única unidade instalável | `plugins` | app | [Plugins](/docs/plugins) |
| Estilizar o que acabei de construir | `@rebasepro/ui` + tokens do tema | qualquer | [Estilizando UI Personalizada](/docs/frontend/styling) |

:::tip[O que quer que você escolha, construa com o kit]
Cada mecanismo abaixo fornece a você um componente React e não impõe restrições
sobre como preenchê-lo. Use os componentes `@rebasepro/ui` e os tokens de cor do
tema em vez de CSS escrito à mão — uma visualização personalizada ainda é uma
visualização de administração, e uma cor fixa no código fica invisível em um
dos dois temas. Veja [Estilizando UI Personalizada](/docs/frontend/styling).
:::

## Mecanismos em Detalhes

### Plugins

**Escopo:** app.

Um plugin agrupa coleções, visualizações, substituições de componentes, contribuições de slots, autenticação, fontes de dados, provedores, hooks e callbacks de ciclo de vida em uma única unidade instalável. Todos os outros mecanismos listados aqui podem ser fornecidos por meio da interface de um plugin.

→ [Referência de Plugins](/docs/plugins)

### Slots

**Escopo:** app (contribuído por slot).

Slots são pontos de extensão de UI nomeados e distribuídos por toda a interface (chrome) do CMS. Você registra um componente React direcionado ao nome de um slot e ele é renderizado naquele local. Existem 29 slots cobrindo a página inicial, navegação, visualizações de coleção, formulários, linhas de entidade, dashboards e muito mais.

→ [Referência de Slots](/docs/frontend/slots)

### Substituições de Componentes (Component Overrides / Swizzling)

**Escopo:** padrões no nível de app ou por coleção.

Dois modos: **Eject** (substituição completa) ou **Wrap** (estender o original).

19 nomes de componentes substituíveis em dois níveis:

**Apenas para o app (7):**
- `Shell.AppBar`
- `Shell.Drawer`
- `Shell.DrawerNavigationItem`
- `Shell.DrawerNavigationGroup`
- `HomePage`
- `HomePage.CollectionCard`
- `Auth.LoginView`

**Com escopo de coleção (12):**
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

**Precedência:** `components` no nível de coleção substituem os padrões no nível de app para o mesmo nome de componente (simples object spread — os valores da coleção sobrescrevem os valores globais). Nomes de componentes exclusivos do app (`Shell.*`, `HomePage`, `Auth.*`) só podem ser substituídos no nível de `<Rebase>`.

→ [Substituições de Componentes](/docs/frontend/component-overrides)

### Visualizações de Entidade (Entity Views)

**Escopo:** entidade (adiciona abas).

Visualizações personalizadas que aparecem como abas na página de detalhes da entidade. Podem ser definidas globalmente em `<Rebase>` ou por coleção.

→ [Visualizações de Entidade](/docs/frontend/entity-views)

### Ações de Entidade (Entity Actions)

**Escopo:** entidade.

Botões de ação personalizados em entidades individuais (publicar, arquivar, clonar, etc.). Podem ser definidos globalmente ou por coleção.

→ [Ações de Entidade](/docs/frontend/entity-actions)

### `Actions` de Coleção

**Escopo:** coleção.

Componentes React no nível da barra de ferramentas que recebem `CollectionActionsProps` (entidades selecionadas, controlador de tabela, contexto da coleção). Renderizados na barra de ferramentas da coleção junto com as ações nativas.

**Relação com o slot `collection.actions`:** Ambos são cumulativos — os componentes de `Actions` são renderizados primeiro na barra de ferramentas, seguidos pelas contribuições de slot de `collection.actions`. Eles não substituem um ao outro.

→ [Ações de Entidade — Ações de Coleção](/docs/frontend/entity-actions#collection-actions)

### Modos de visualização personalizados {#customviews}

**Escopo:** coleção (adiciona um modo de visualização).

Um mapa, um calendário, uma galeria, uma linha do tempo — outra renderização das *mesmas linhas*,
oferecida no alternador de visualizações da coleção ao lado de Lista, Tabela, Cards e Quadro (Board).

```ts
// collection config
admin: {
    customViews: [
        { key: "map", name: "Map", icon: "Map", Builder: MapView }
    ],
    enabledViews: ["table", "map"],
    defaultViewMode: "map"
}
```

Ou registre o componente uma vez e dê um nome a ele por chave, o que também o torna
selecionável no editor de coleção:

```tsx
<RebaseCMS
    collections={collections}
    collectionViews={[{ key: "map", name: "Map", icon: "Map", Builder: MapView }]}
/>
```

```ts
admin: { customViews: ["map"] }
```

O `Builder` recebe o `tableController` ativo, portanto a visualização herda os
filtros da coleção, a caixa de busca, ordenação, paginação, verificações de
permissão e o painel lateral da entidade — esse é o motivo principal para declarar
um em vez de construir uma `AppView`:

```tsx
function MapView({ tableController, onEntityClick }: CollectionCustomViewParams) {
    return <MapCanvas
        markers={tableController.data.map(e => e.values.location)}
        onMarkerClick={i => onEntityClick?.(tableController.data[i])}
    />;
}
```

Escolher a visualização atualiza `?__view=`, sobrevive a um recarregamento e persiste por usuário.
Apenas declará-la é suficiente para disponibilizá-la — `enabledViews` só precisa ser configurado
quando você deseja *remover as opções nativas*. Com apenas uma entrada, o alternador fica oculto.

**Esta não é uma maneira de criar uma visualização que abranja várias coleções.** Um modo de visualização
é outra renderização da consulta de uma única coleção. Se o seu componente ignora o
`tableController` e busca quatro tabelas por conta própria, ele deveria ser uma
[`AppView`](/docs/frontend#custom-views) — a barra de ferramentas acima dele, com sua caixa de busca
e contagem de registros, estaria descrevendo uma consulta que ele não renderiza.

### `formView` {#formview}

**Escopo:** coleção.

Substitui todo o formulário padrão da entidade por um componente personalizado. Definido em uma definição de coleção:

```typescript
const collection = {
    slug: "products",
    admin: {
        formView: {
            Builder: MyCustomProductForm,
            includeActions: true  // Save and Discard in the bar (default: true)
        }
    }
};

```

Use quando precisar de um layout totalmente personalizado para a experiência de edição de entidades de uma coleção. Para ajustes menores, prefira utilizar `collection.components` com a substituição de `Entity.Form`.

O Builder é renderizado dentro do formulário do registro e recebe seu `formContext` ativo: escreva com `formContext.setFieldValue`, e o botão Salvar da barra armazena o registro. Onde o registro não pode ser editado — na visualização de detalhes somente leitura ou para um usuário sem permissão de edição —, `formContext.disabled` é `true` e tentativas de gravação geram erro (throw). Defina `includeActions: false` se o seu Builder salvar por conta própria por meio de `formContext.submit()`.

### `additionalFields`

**Escopo:** coleção.

Colunas computadas/virtuais exibidas na tabela da coleção. Elas não correspondem a propriedades armazenadas — são calculadas no momento da renderização.

→ [Colunas Adicionais](/docs/frontend/additional-columns)

### `propertyConfigs`

**Escopo:** tipo de propriedade.

Widgets de campo personalizados para tipos de propriedades específicos, fornecendo campos de formulário e componentes de pré-visualização personalizados.

→ [Campos Personalizados](/docs/frontend/custom-fields)

## Resumo de Precedência

- **`collection.components` tem precedência sobre `components` globais** dentro daquela coleção (merge simples via spread em `DataCollectionView`).
- **`Actions` de coleção e o slot `collection.actions` são cumulativos** — `Actions` renderizam primeiro, seguidos pelas contribuições de slot.
- **`entityActions` e `entityViews` no nível de coleção estendem (não substituem) os globais.**
- **Contribuições de plugins são mescladas na ordem da `key`.**
