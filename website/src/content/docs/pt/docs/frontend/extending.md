---
sourceHash: a874bc209f13c746
title: Estendendo o Rebase
sidebar_label: Estendendo o Rebase
description: Um guia de decisão para escolher o mecanismo de extensão correto — plugins, slots, substituições de componentes, visualizações de entidade, ações e mais.
---

## Visão Geral

O Rebase oferece cerca de uma dúzia de mecanismos de extensão — plugins, slots, substituições de componentes, visualizações de entidade, ações, campos personalizados e muito mais. Cada um tem como alvo um escopo diferente (em toda a aplicação, por coleção, por entidade, por propriedade) e uma parte diferente da interface de usuário (UI).

Este guia ajuda você a escolher o mecanismo certo para o seu caso de uso e, em seguida, direciona para a referência detalhada de cada um.

:::tip[Comece com o modelo, não com a lista]
Cada mecanismo abaixo é a mesma coisa por baixo dos panos: um componente React colocado em um local. [Customizando o Admin](/docs/frontend/customizing) explica esse modelo em uma única página — blocos de construção, hooks, locais — com receitas testadas para um singleton de configurações, configurações por usuário, uma ação em massa, uma visualização em calendário, um painel de controle e uma tela de login personalizada. Leia-o primeiro; volte aqui para escolher o local.
:::

Tudo aqui se refere ao **painel administrativo**. Para o servidor — limitar uma leitura,
adicionar uma rota, incorporar o driver em seu próprio processo, `rebase eject` — veja
[O Rebase não faz X](/docs/backend/extending), que é o mesmo tipo de tabela
para o backend.

## Tabela de Decisão

| Eu quero… | Mecanismo | Escopo | Referência |
|---|---|---|---|
| Substituir a barra do aplicativo | `components` (`Shell.AppBar`) | aplicação | [Substituições de Componentes](/docs/frontend/component-overrides) |
| Substituir a página de login | `components` (`Auth.LoginView`) | aplicação | [Substituições de Componentes](/docs/frontend/component-overrides) |
| Substituir a página inicial | `components` (`HomePage`) | aplicação | [Substituições de Componentes](/docs/frontend/component-overrides) |
| Mudar completamente a aparência do formulário de uma coleção | `formView` | coleção | [abaixo](#formview) |
| Trocar um componente dentro de uma coleção | `collection.components` | coleção | [Substituições de Componentes](/docs/frontend/component-overrides) |
| Definir substituições padrão de componentes para todas as coleções | `components` (nomes com escopo de coleção) | aplicação | [Substituições de Componentes](/docs/frontend/component-overrides) |
| Adicionar um botão à barra de ferramentas da coleção | `Actions` da coleção | coleção | [Ações de Entidade](/docs/frontend/entity-actions#collection-actions) |
| Injetar UI em um slot da barra de ferramentas da coleção | slot `collection.actions` | aplicação/plugin | [Slots](/docs/frontend/slots) |
| Adicionar uma coluna calculada a uma tabela | `additionalFields` | coleção | [Colunas Adicionais](/docs/frontend/additional-columns) |
| Adicionar um widget de campo personalizado para um tipo de propriedade | `propertyConfigs` | tipo de propriedade | [Campos Personalizados](/docs/frontend/custom-fields) |
| Adicionar uma aba de entidade | `entityViews` | entidade | [Visualizações de Entidade](/docs/frontend/entity-views) |
| Renderizar as linhas de uma coleção de uma maneira diferente | `admin.customViews` | coleção | [abaixo](#modos-de-visualização-personalizados) |
| Adicionar uma ação de linha/contexto ou botão de entidade | `entityActions` | entidade | [Ações de Entidade](/docs/frontend/entity-actions) |
| Colocar um número/gráfico no card da coleção na página inicial | slot `home.card.widget` | aplicação/plugin | [Slots](/docs/frontend/slots) |
| Injetar UI em um local específico da estrutura da interface (chrome) | `slots` | aplicação/plugin | [Slots](/docs/frontend/slots) |
| Distribuir várias extensões como uma única unidade instalável | `plugins` | aplicação | [Plugins](/docs/plugins) |
| Estilizar o que acabei de construir | `@rebasepro/ui` + tokens de tema | qualquer | [Estilizando UI Personalizada](/docs/frontend/styling) |

:::tip[Qualquer que seja a sua escolha, construa a partir do kit]
Cada mecanismo abaixo entrega a você um componente React e não diz nada sobre como
preenchê-lo. Use componentes do `@rebasepro/ui` e os tokens de cor do tema em vez de
CSS escrito à mão — uma visualização personalizada ainda é uma visualização do admin, e uma
cor fixa (hardcoded) fica invisível em um dos dois temas. Veja
[Estilizando UI Personalizada](/docs/frontend/styling).
:::

## Mecanismos em Detalhes

### Plugins

**Escopo:** aplicação.

Um plugin agrupa coleções, visualizações, substituições de componentes, contribuições de slots, autenticação, fontes de dados, provedores, hooks e callbacks de ciclo de vida em uma única unidade instalável. Todos os outros mecanismos listados aqui podem ser fornecidos por meio da interface de um plugin.

→ [Referência de Plugins](/docs/plugins)

### Slots

**Escopo:** aplicação (contribuído por slot).

Slots são pontos de extensão de UI nomeados e distribuídos pela interface do CMS. Você registra um componente React direcionado ao nome de um slot e ele é renderizado naquele local. Existem 27 slots cobrindo a página inicial, navegação, visualizações de coleção, formulários, linhas de entidade, campos de formulário e a barra do aplicativo — e cada um deles é renderizado.

→ [Referência de Slots](/docs/frontend/slots)

### Substituições de Componentes (Swizzling)

**Escopo:** padrões a nível de aplicação ou por coleção.

Dois modos: **Eject** (substituição completa) ou **Wrap** (estender o original).

19 nomes de componentes substituíveis divididos em dois níveis:

**Exclusivos da aplicação (7):**
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

**Precedência:** Os `components` a nível de coleção substituem os padrões a nível de aplicação para o mesmo nome de componente (uma simples mesclagem de objetos via spread — os valores da coleção sobrescrevem os valores globais). Nomes de componentes exclusivos da aplicação (`Shell.*`, `HomePage`, `Auth.*`) só podem ser substituídos no nível de `<Rebase>`.

→ [Substituições de Componentes](/docs/frontend/component-overrides)

### Visualizações de Entidade

**Escopo:** entidade (adiciona abas).

Visualizações personalizadas que aparecem como abas na página de detalhes da entidade. Podem ser definidas globalmente no `<Rebase>` ou por coleção.

→ [Visualizações de Entidade](/docs/frontend/entity-views)

### Ações de Entidade

**Escopo:** entidade.

Botões de ação personalizados em entidades individuais (publicar, arquivar, clonar, etc.). Podem ser definidos globalmente ou por coleção.

→ [Ações de Entidade](/docs/frontend/entity-actions)

### `Actions` de Coleção

**Escopo:** coleção.

Componentes React no nível da barra de ferramentas que recebem `CollectionActionsProps` (entidades selecionadas, controlador de tabela, contexto da coleção). Renderizados na barra de ferramentas da coleção juntamente com as ações integradas.

**Relação com o slot `collection.actions`:** Ambos são aditivos — os componentes de `Actions` são renderizados primeiro na barra de ferramentas e, em seguida, as contribuições do slot `collection.actions`. Eles não se substituem mutuamente.

→ [Ações de Entidade — Ações de Coleção](/docs/frontend/entity-actions#collection-actions)

### Modos de visualização personalizados
**Escopo:** coleção (adiciona um modo de visualização).

Um mapa, um calendário, uma galeria, uma linha do tempo — outra renderização *das mesmas linhas*,
disponibilizada no seletor de visualizações da coleção ao lado de Lista, Tabela, Cards e Quadro (Board).

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
selecionável a partir do editor de coleção:

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
filtros da coleção, o campo de busca, ordenação, paginação, verificações de permissão
e o painel lateral da entidade — essa é a razão principal para declarar um em vez de
construir uma `AppView`:

```tsx
function MapView({ tableController, onEntityClick }: CollectionCustomViewParams) {
    return <MapCanvas
        markers={tableController.data.map(e => e.values.location)}
        onMarkerClick={i => onEntityClick?.(tableController.data[i])}
    />;
}
```

Escolher a visualização atualiza o parâmetro `?__view=`, sobrevive a um recarregamento da página e persiste por usuário.
Declarar uma é suficiente para disponibilizá-la — `enabledViews` só precisa ser configurado quando você
quiser *remover opções integradas*. Com apenas uma entrada, o seletor fica oculto.

**Esta não é uma maneira de construir uma visualização que abranja várias coleções.** Um modo de visualização
é outra renderização da consulta de uma única coleção. Se o seu componente ignora
o `tableController` e busca quatro tabelas por conta própria, ele deveria ser uma
[`AppView`](/docs/frontend#custom-views) — a barra de ferramentas acima dele, com seu campo
de busca e sua contagem de registros, estaria descrevendo uma consulta que ela não renderiza.

### `formView`
**Escopo:** coleção.

Substitui todo o formulário de entidade padrão por um componente personalizado. Definido em uma configuração de coleção:

```typescript
const collection = {
    slug: "products",
    admin: {
        formView: {
            Builder: MyCustomProductForm,
            includeActions: true  // Salvar e Descartar na barra (padrão: true)
        }
    }
};

```

Use quando precisar de um layout completamente personalizado para a experiência de edição de entidades de uma coleção. Para ajustes menores, prefira `collection.components` com a substituição de `Entity.Form`.

O Builder é renderizado dentro do formulário do registro e recebe seu `formContext` ativo: escreva com `formContext.setFieldValue`, e o botão Salvar da barra armazena o registro. Onde o registro não puder ser editado — a visualização de detalhes somente leitura, ou um usuário sem permissão de edição — `formContext.disabled` é `true` e tentativas de escrita disparam exceções. Defina `includeActions: false` se o seu Builder salvar por conta própria por meio de `formContext.submit()`.

### `additionalFields`

**Escopo:** coleção.

Colunas calculadas/virtuais exibidas na tabela da coleção. Elas não correspondem a propriedades armazenadas — são calculadas no momento da renderização.

→ [Colunas Adicionais](/docs/frontend/additional-columns)

### `propertyConfigs`

**Escopo:** tipo de propriedade.

Widgets de campo personalizados para tipos específicos de propriedade, fornecendo campos de formulário e componentes de pré-visualização personalizados.

→ [Campos Personalizados](/docs/frontend/custom-fields)

## Não é o painel administrativo

Se o que você quer mudar é o que o servidor faz, em vez do que o
painel exibe, esta é a página errada. O servidor possui seus próprios níveis de extensão:

| Eu quero… | Nível | Referência |
|---|---|---|
| Limitar quais linhas uma leitura retorna | Callback `beforeQuery` | [Estendendo o servidor](/docs/backend/extending#2-collection-callbacks) |
| Ocultar/modificar um valor na saída | Callback `afterRead` | [Callbacks](/docs/collections/callbacks) |
| Adicionar um endpoint próprio | Função personalizada | [Funções Personalizadas](/docs/backend/custom-functions) |
| Fazer a busca encontrar substrings *e* ignorar acentos | `search.mode: "hybrid"` | [Busca](/docs/backend/search) |
| Controlar o processo do servidor | Servidor personalizado, depois `rebase eject` | [Estendendo o servidor](/docs/backend/extending) |

→ [O Rebase não faz X](/docs/backend/extending)

## Resumo de Precedência

- **`collection.components` tem precedência sobre `components` globais** dentro daquela coleção. Uma substituição de coleção substitui ambos; uma substituição de coleção com `wrap: true` envolve a substituição global quando ela existe (na versão 0.24 ela envolve o componente integrado, e a substituição global é ignorada). Veja [Substituições de Componentes](/docs/frontend/component-overrides#when-both-scopes-override-a-component).
- **As `Actions` de coleção e o slot `collection.actions` são aditivos** — as `Actions` são renderizadas primeiro, seguidas pelas contribuições do slot.
- **`entityActions` e `entityViews` a nível de coleção estendem (não substituem) as globais.**
- **Os plugins são aplicados na ordem do array `plugins`**, não por `key`. As contribuições de slots são renderizadas pelo seu `order` (menor primeiro, 50 por padrão), e empates mantêm essa ordem. Wrappers de campo de vários plugins são compostos nessa ordem, sendo o do primeiro plugin o mais interno; na versão 0.24, apenas o último wrapper era renderizado. Veja [Plugins](/docs/plugins#field-wrappers-from-several-plugins).
