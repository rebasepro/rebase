---
sourceHash: 6517ed25b1776f7e
title: Estendendo o Rebase
sidebar_label: Estendendo o Rebase
description: Um guia de decisão para escolher o mecanismo de extensão correto — plugins, slots, substituições de componentes, visualizações de entidade, ações e muito mais.
---

## Visão Geral

O Rebase oferece cerca de uma dúzia de mecanismos de extensão — plugins, slots, substituições de componentes, visualizações de entidade, ações, campos personalizados e muito mais. Cada um tem como alvo um escopo diferente (em toda a aplicação, por coleção, por entidade, por propriedade) e uma parte diferente da UI.

Este guia ajuda você a escolher o mecanismo certo para o seu caso de uso e, em seguida, traz links para a referência detalhada de cada um.

:::tip[Comece pelo modelo, não pela lista]
Cada mecanismo abaixo é essencialmente a mesma coisa nos bastidores: um componente React colocado em um local. [Customizing the Admin](/docs/frontend/customizing) explica esse modelo em uma única página — blocos de construção, hooks, locais — com receitas testadas para um singleton de configurações, configurações por usuário, uma ação em lote, uma visualização em calendário, um dashboard e uma tela de login personalizada. Leia-o primeiro; depois volte aqui para escolher o local.
:::

Tudo aqui diz respeito ao **painel administrativo**. Para o servidor — restringir uma leitura,
adicionar uma rota, embutir o driver no seu próprio processo, `rebase eject` — consulte
[Rebase doesn't do X](/docs/backend/extending), que é o mesmo tipo de tabela
para o backend.

## Tabela de Decisão

| Eu quero… | Mecanismo | Escopo | Referência |
|---|---|---|---|
| Substituir a barra de aplicativos (app bar) | `components` (`Shell.AppBar`) | app | [Component Overrides](/docs/frontend/component-overrides) |
| Substituir a página de login | `components` (`Auth.LoginView`) | app | [Component Overrides](/docs/frontend/component-overrides) |
| Substituir a página inicial | `components` (`HomePage`) | app | [Component Overrides](/docs/frontend/component-overrides) |
| Mudar totalmente a aparência do formulário de uma coleção | `formView` | collection | [abaixo](#formview) |
| Trocar um componente dentro de uma coleção | `admin.components` | collection | [Component Overrides](/docs/frontend/component-overrides) |
| Definir substituições de componentes padrão para todas as coleções | `components` (nomes com escopo de coleção) | app | [Component Overrides](/docs/frontend/component-overrides) |
| Adicionar um botão à barra de ferramentas da coleção | `Actions` da coleção | collection | [Entity Actions](/docs/frontend/entity-actions#collection-actions) |
| Injetar UI em um slot da barra de ferramentas da coleção | slot `collection.actions` | app/plugin | [Slots](/docs/frontend/slots) |
| Adicionar uma coluna calculada a uma tabela | `additionalFields` | collection | [Additional Columns](/docs/frontend/additional-columns) |
| Adicionar um widget de campo personalizado para um tipo de propriedade | `propertyConfigs` | property type | [Custom Fields](/docs/frontend/custom-fields) |
| Adicionar uma aba de entidade | `entityViews` | entity | [Entity Views](/docs/frontend/entity-views) |
| Renderizar as linhas de uma coleção de uma forma diferente | `admin.customViews` | collection | [abaixo](#custom-view-modes) |
| Adicionar uma ação de linha/contexto ou botão de entidade | `entityActions` | entity | [Entity Actions](/docs/frontend/entity-actions) |
| Colocar um indicador no card da página inicial de uma coleção | slot `home.card.widget` | app/plugin | [Slots](/docs/frontend/slots) |
| Injetar UI em um local específico do chrome | `slots` | app/plugin | [Slots](/docs/frontend/slots) |
| Distribuir várias extensões como uma única unidade instalável | `plugins` | app | [Plugins](/docs/plugins) |
| Estilizar o que acabei de criar | `@rebasepro/ui` + tokens de tema | any | [Styling Custom UI](/docs/frontend/styling) |

:::tip[Não importa o que escolher, construa a partir do kit]
Cada mecanismo abaixo entrega a você um componente React e não impõe nada sobre como
preenchê-lo. Use componentes `@rebasepro/ui` e os tokens de cores do tema em vez
de CSS manual — uma visualização personalizada ainda é uma visualização do admin, e uma
cor fixa (hardcoded) fica invisível em um dos dois temas. Consulte
[Styling Custom UI](/docs/frontend/styling).
:::

## Mecanismos em Detalhes

### Plugins

**Escopo:** app.

Um plugin agrupa coleções injetadas ou modificadas, visualizações, contribuições de slots, wrappers de campo, providers, hooks e callbacks de ciclo de vida em uma única unidade instalável. Substituições de componentes, visualizações de entidade, ações de entidade e `propertyConfigs` não são campos de plugins: eles vão no `<Rebase>` ou na coleção.

→ [Referência de Plugins](/docs/plugins)

### Slots

**Escopo:** app (contribuído por slot).

Slots são pontos de extensão nomeados da UI espalhados pelo chrome do CMS. Você registra um componente React apontando para o nome de um slot, e ele é renderizado naquele local. Existem 27 slots cobrindo a página inicial, navegação, visualizações de coleção, formulários, linhas de entidades, campos de formulário e a barra do aplicativo — e cada um deles é renderizado.

→ [Referência de Slots](/docs/frontend/slots)

### Component Overrides (Swizzling)

**Escopo:** padrões a nível de app ou por coleção.

Dois modos: **Eject** (substituição completa) ou **Wrap** (estender o original).

19 nomes de componentes substituíveis em dois níveis:

**Apenas a nível de app (7):**
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

**Precedência:** `components` a nível de coleção se aplicam sobre os padrões a nível de app para o mesmo nome de componente: uma substituição de coleção substitui ambos, e uma substituição com `wrap: true` na coleção envolve a de nível de app. Nomes de componentes exclusivos de app (`Shell.*`, `HomePage`, `Auth.*`) só podem ser substituídos no nível de `<Rebase>`.

→ [Component Overrides](/docs/frontend/component-overrides)

### Entity Views

**Escopo:** entity (adiciona abas).

Visualizações personalizadas que aparecem como abas na página de detalhes da entidade. Definidas por coleção, ou registradas uma única vez em `<Rebase entityViews>` (ou `<RebaseCMS entityViews>`) e referenciadas por `key` no `admin.entityViews` de uma coleção.

→ [Entity Views](/docs/frontend/entity-views)

### Entity Actions

**Escopo:** entity.

Botões de ação personalizados em entidades individuais (publicar, arquivar, clonar, etc.). Definidos por coleção, ou registrados uma vez em `<Rebase entityActions>` (ou `<RebaseCMS entityActions>`) e referenciados por `key` no `admin.entityActions` de uma coleção.

→ [Entity Actions](/docs/frontend/entity-actions)

### Collection `Actions`

**Escopo:** collection.

Componentes React a nível de barra de ferramentas que recebem `CollectionActionsProps` (entidades selecionadas, controlador da tabela, contexto da coleção). Renderizados na barra de ferramentas da coleção junto com as ações nativas.

**Relação com o slot `collection.actions`:** Ambos são cumulativos — os componentes `Actions` são renderizados primeiro na barra de ferramentas, seguidos pelas contribuições de slot de `collection.actions`. Eles não se substituem mutuamente.

→ [Entity Actions — Collection Actions](/docs/frontend/entity-actions#collection-actions)

### Custom view modes
**Escopo:** collection (adiciona um modo de visualização).

Um mapa, um calendário, uma galeria, uma linha do tempo — outra renderização das *mesmas linhas*,
oferecida no seletor de visualizações da coleção ao lado de Lista, Tabela, Cards e Quadro (Board).

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

Or register the component once and name it by key, which is also what makes it
selectable from the collection editor:

```tsx
<RebaseCMS
    collections={collections}
    collectionViews={[{ key: "map", name: "Map", icon: "Map", Builder: MapView }]}
/>
```

```ts
admin: { customViews: ["map"] }
```

`Builder` recebe o `tableController` ativo, portanto a visualização herda os
filtros da coleção, a caixa de busca, ordenação, paginação, checagens de permissão
e o painel lateral da entidade — esse é o principal motivo para declarar uma em vez de
criar uma `AppView`:

```tsx
function MapView({ tableController, onRowClick }: CollectionCustomViewParams) {
    return <MapCanvas
        markers={tableController.rows.map(row => row.location)}
        onMarkerClick={i => onRowClick?.(tableController.rows[i])}
    />;
}
```

As linhas são as do servidor, no formato que `useRows` retorna: datas como strings ISO,
um belongsTo como sua coluna de chave estrangeira, e uma relação que a visualização carregou aninhada
sob seu nome. Uma linha possui uma coluna `id` apenas onde sua tabela possui; seu id está
ao lado dela, `tableController.ids[i]` para `tableController.rows[i]`.
`highlightedIds` são os ids das linhas que a visualização desenha como selecionadas, e
o `selectionController` também opera com ids e linhas:

```tsx
import type { CollectionCustomViewParams } from "@rebasepro/cms-types";
import { Card, Typography } from "@rebasepro/ui";

function CardsView({ tableController, highlightedIds, onRowClick }: CollectionCustomViewParams) {
    return <div className="grid grid-cols-3 gap-4 p-4">
        {tableController.rows.map((row, i) => {
            const id = tableController.ids[i];
            return <Card key={id}
                className={highlightedIds?.includes(id) ? "p-4 ring-2 ring-primary" : "p-4"}
                onClick={() => onRowClick?.(row)}>
                <Typography variant="subtitle2">{String(row.title ?? id)}</Typography>
            </Card>;
        })}
    </div>;
}
```

Escolher a visualização atualiza `?__view=`, persiste após o recarregamento e é mantida por usuário.
Basta declarar uma para disponibilizá-la — `enabledViews` só precisa ser configurado quando você
quiser *remover as nativas*. Com apenas uma entrada, o seletor fica oculto.

**Esta não é uma forma de criar uma visualização que abranja várias coleções.** Um modo de visualização
é outra renderização da consulta de uma única coleção. Se o seu componente ignora o
`tableController` e faz buscas próprias em quatro tabelas, ele deve ser uma
[`AppView`](/docs/frontend#custom-views) — a barra de ferramentas acima dele, com sua caixa de busca
e sua contagem de registros, estaria descrevendo uma consulta que ele não renderiza.

### `formView`
**Escopo:** collection.

Substitui todo o formulário padrão de entidade por um componente personalizado. Definido na configuração da coleção:

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

Use quando precisar de um layout totalmente personalizado para a experiência de edição de entidades de uma coleção. Para ajustes menores, prefira usar `admin.components` com a substituição de `Entity.Form`.

O Builder é renderizado dentro do formulário do registro e recebe o seu `formContext` ativo: grave com `formContext.setFieldValue`, e o Salvar da barra armazenará o registro. Onde o registro não puder ser editado — a visualização de detalhes somente leitura, ou um usuário sem permissão de edição — `formContext.disabled` é `true` e tentativas de gravação lançarão erros. Defina `includeActions: false` se o seu Builder salvar por conta própria através de `formContext.submit()`.

### `additionalFields`

**Escopo:** collection.

Colunas computadas/virtuais exibidas na tabela da coleção. Elas não correspondem a propriedades armazenadas — são calculadas no momento da renderização.

→ [Additional Columns](/docs/frontend/additional-columns)

### `propertyConfigs`

**Escopo:** property type.

Widgets de campos personalizados para tipos de propriedade específicos, fornecendo campos de formulário e componentes de pré-visualização personalizados.

→ [Custom Fields](/docs/frontend/custom-fields)

## Fora do painel administrativo

Se o que você quer alterar é o que o servidor faz em vez do que o
painel exibe, esta não é a página certa. O servidor possui sua própria escala:

| Eu quero… | Degrau | Referência |
|---|---|---|
| Restringir quais linhas uma leitura retorna | callback `beforeQuery` | [Extending the server](/docs/backend/extending#2-collection-callbacks) |
| Ocultar um valor na saída | callback `afterRead` | [Callbacks](/docs/collections/callbacks) |
| Adicionar um endpoint próprio | função personalizada | [Custom Functions](/docs/backend/custom-functions) |
| Fazer a busca encontrar substrings *e* ignorar acentos | `search.mode: "hybrid"` | [Search](/docs/backend/search) |
| Assumir o controle do processo do servidor | servidor customizado, depois `rebase eject` | [Extending the server](/docs/backend/extending) |

→ [Rebase doesn't do X](/docs/backend/extending)

## Resumo de Precedência

- **O `admin.components` de uma coleção tem precedência sobre `components` globais** dentro daquela coleção. Uma substituição na coleção substitui ambos; uma substituição com `wrap: true` na coleção envolve a substituição global quando ela existe. Consulte [Component Overrides](/docs/frontend/component-overrides#when-both-scopes-override-a-component).
- **`Actions` de coleção e o slot `collection.actions` são cumulativos** — os componentes `Actions` são renderizados primeiro, seguidos pelas contribuições de slot.
- **`entityActions` e `entityViews` a nível de aplicação são um registro, não padrões:** uma coleção só exibe um item quando seu próprio `admin.entityActions` / `admin.entityViews` referencia sua `key`.
- **Os plugins se aplicam na ordem do array `plugins`**, não por `key`. As contribuições de slots são renderizadas por sua propriedade `order` (valores menores primeiro, 50 por padrão), mantendo a ordem original em caso de empate. Wrappers de campos de múltiplos plugins se compõem nessa ordem, sendo o do primeiro plugin o mais interno. Consulte [Plugins](/docs/plugins#field-wrappers-from-several-plugins).
