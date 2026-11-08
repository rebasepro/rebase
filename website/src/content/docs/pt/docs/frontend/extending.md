---
sourceHash: ec086b9ec3b281fc
title: Estendendo o Rebase
sidebar_label: Estendendo o Rebase
description: Um guia de decisão para escolher o mecanismo de extensão correto — plugins, slots, substituições de componentes, visualizações de entidades, ações e mais.
---

## Visão Geral

O Rebase oferece cerca de uma dúzia de mecanismos de extensão — plugins, slots, substituições de componentes, visualizações de entidades, ações, campos personalizados e muito mais. Cada um visa um escopo diferente (em todo o app, por coleção, por entidade, por propriedade) e uma parte diferente da UI.

Este guia ajuda você a escolher o mecanismo certo para o seu caso de uso e, em seguida, traz links para a referência detalhada de cada um.

:::tip[Comece com o modelo, não com a lista]
Cada mecanismo abaixo é a mesma coisa por baixo dos panos: um componente React colocado em um local. [Personalizando o Admin](/docs/frontend/customizing) explica esse modelo em uma única página — blocos de construção, hooks, locais — com receitas testadas para um singleton de configurações, configurações por usuário, uma ação em massa, uma visualização de calendário, um painel e uma tela de login personalizada. Leia-o primeiro; volte aqui para escolher o local.
:::

Tudo aqui se refere ao **painel de administração**. Para o servidor — restringir uma leitura,
adicionar uma rota, incorporar o driver em seu próprio processo, `rebase eject` — consulte
[O Rebase não faz X](/docs/backend/extending), que traz uma tabela similar
para o backend.

## Tabela de Decisão

| Eu quero… | Mecanismo | Escopo | Referência |
|---|---|---|---|
| Substituir a barra do aplicativo | `components` (`Shell.AppBar`) | app | [Substituições de Componentes](/docs/frontend/component-overrides) |
| Substituir a página de login | `components` (`Auth.LoginView`) | app | [Substituições de Componentes](/docs/frontend/component-overrides) |
| Substituir a página inicial | `components` (`HomePage`) | app | [Substituições de Componentes](/docs/frontend/component-overrides) |
| Mudar completamente a aparência do formulário de uma coleção | `formView` | coleção | [abaixo](#formview) |
| Trocar um componente dentro de uma coleção | `admin.components` | coleção | [Substituições de Componentes](/docs/frontend/component-overrides) |
| Definir substituições de componentes padrão para todas as coleções | `components` (nomes com escopo de coleção) | app | [Substituições de Componentes](/docs/frontend/component-overrides) |
| Adicionar um botão à barra de ferramentas da coleção | `Actions` da coleção | coleção | [Ações de Entidade](/docs/frontend/entity-actions#collection-actions) |
| Injetar UI em um slot da barra de ferramentas da coleção | slot `collection.actions` | app/plugin | [Slots](/docs/frontend/slots) |
| Adicionar uma coluna computada a uma tabela | `additionalFields` | coleção | [Colunas Adicionais](/docs/frontend/additional-columns) |
| Adicionar um widget de campo personalizado para um tipo de propriedade | `propertyConfigs` | tipo de propriedade | [Campos Personalizados](/docs/frontend/custom-fields) |
| Adicionar uma aba de entidade | `entityViews` | entidade | [Visualizações de Entidade](/docs/frontend/entity-views) |
| Renderizar as linhas de uma coleção de uma forma diferente | `admin.customViews` | coleção | [abaixo](#modos-de-visualização-personalizados-custom-view-modes) |
| Adicionar uma ação de linha/contexto ou botão de entidade | `entityActions` | entidade | [Ações de Entidade](/docs/frontend/entity-actions) |
| Colocar um número/indicador no card de uma coleção na página inicial | slot `home.card.widget` | app/plugin | [Slots](/docs/frontend/slots) |
| Injetar UI em um local específico da interface | `slots` | app/plugin | [Slots](/docs/frontend/slots) |
| Distribuir várias extensões como uma única unidade instalável | `plugins` | app | [Plugins](/docs/plugins) |
| Estilizar o que acabei de construir | `@rebasepro/ui` + tokens do tema | qualquer | [Estilizando UI Personalizada](/docs/frontend/styling) |

:::tip[O que quer que você escolha, construa usando o kit]
Cada mecanismo abaixo fornece um componente React e não impõe nada sobre com o
que preenchê-lo. Use os componentes `@rebasepro/ui` e os tokens de cor do tema
em vez de CSS escrito manualmente — uma visualização personalizada ainda é uma visualização de administração,
e uma cor hardcoded fica invisível em um dos dois temas. Consulte
[Estilizando UI Personalizada](/docs/frontend/styling).
:::

## Mecanismos em Detalhes

### Plugins

**Escopo:** app.

Um plugin agrupa coleções injetadas ou modificadas, visualizações, contribuições de slots, invólucros de campos (field wrappers), providers, hooks e callbacks de ciclo de vida em uma única unidade instalável. Substituições de componentes, visualizações de entidade, ações de entidade e `propertyConfigs` não são campos de plugins: eles vão no `<Rebase>` ou na coleção.

→ [Referência de Plugins](/docs/plugins)

### Slots

**Escopo:** app (contribuído por slot).

Slots são pontos de extensão nomeados da interface espalhados pelo chrome do CMS. Você registra um componente React apontando para o nome de um slot, e ele é renderizado naquele local. Existem 27 slots cobrindo a página inicial, navegação, visualizações de coleção, formulários, linhas de entidade, campos de formulário e a barra do aplicativo — e cada um deles é renderizado.

→ [Referência de Slots](/docs/frontend/slots)

### Substituições de Componentes (Swizzling)

**Escopo:** padrões a nível de app ou por coleção.

Dois modos: **Eject** (substituição completa) ou **Wrap** (estender o original).

19 nomes de componentes substituíveis divididos em dois níveis:

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

**Precedência:** `components` no nível de coleção aplicam-se sobre os padrões no nível de app para o mesmo nome de componente: uma substituição de coleção substitui ambos, e uma substituição de coleção com `wrap: true` envolve a de nível de app. Nomes de componentes exclusivos do app (`Shell.*`, `HomePage`, `Auth.*`) só podem ser substituídos no nível de `<Rebase>`.

→ [Substituições de Componentes](/docs/frontend/component-overrides)

### Entity Views

**Escopo:** entidade (adiciona abas).

Visualizações personalizadas que aparecem como abas na página de detalhes da entidade. Definidas por coleção, ou registradas uma vez em `<Rebase entityViews>` (ou `<RebaseCMS entityViews>`) e referenciadas por `key` no `admin.entityViews` de uma coleção.

→ [Visualizações de Entidade](/docs/frontend/entity-views)

### Entity Actions

**Escopo:** entidade.

Botões de ação personalizados em entidades individuais (publicar, arquivar, clonar, etc.). Definidos por coleção, ou registrados uma vez em `<Rebase entityActions>` (ou `<RebaseCMS entityActions>`) e referenciados por `key` no `admin.entityActions` de uma coleção.

→ [Ações de Entidade](/docs/frontend/entity-actions)

### `Actions` de Coleção

**Escopo:** coleção.

Componentes React no nível da barra de ferramentas que recebem `CollectionActionsProps` (entidades selecionadas, controlador da tabela, contexto da coleção). Renderizados na barra de ferramentas da coleção junto com as ações integradas.

**Relação com o slot `collection.actions`:** Ambos são aditivos — os componentes `Actions` são renderizados primeiro na barra de ferramentas e, em seguida, as contribuições do slot `collection.actions`. Eles não se substituem.

→ [Ações de Entidade — Ações de Coleção](/docs/frontend/entity-actions#collection-actions)

### Modos de visualização personalizados {#custom-view-modes}
**Escopo:** coleção (adiciona um modo de visualização).

Um mapa, um calendário, uma galeria, uma linha do tempo — outra renderização das *mesmas linhas*,
disponibilizada no seletor de visualizações da coleção ao lado de Lista, Tabela, Cards e Quadro.

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

Ou registre o componente uma vez e faça referência a ele pela chave, o que também o torna
selecionável no editor de coleções:

```tsx
<RebaseCMS
    collections={collections}
    collectionViews={[{ key: "map", name: "Map", icon: "Map", Builder: MapView }]}
/>
```

```ts
admin: { customViews: ["map"] }
```

O `Builder` recebe o `tableController` ativo, de modo que a visualização herda os
filtros da coleção, a caixa de busca, a ordenação, a paginação, as verificações de permissão
e o painel lateral da entidade — esse é o motivo principal para declarar um em vez de
construir uma `AppView`:

```tsx
function MapView({ tableController, onRowClick }: CollectionCustomViewParams) {
    return <MapCanvas
        markers={tableController.rows.map(row => row.location)}
        onMarkerClick={i => onRowClick?.(tableController.rows[i])}
    />;
}
```

As linhas são as do servidor, no formato retornado por `useRows`: datas como strings ISO,
um belongsTo como sua coluna de chave estrangeira, e uma relação que a visualização carregou aninhada
sob seu nome. `highlightedIds` são os ids das linhas que a visualização desenha como
selecionadas, e o `selectionController` também opera com ids e linhas.

Escolher a visualização atualiza `?__view=`, sobrevive a um recarregamento e persiste por usuário.
Declarar uma já é suficiente para oferecê-la — `enabledViews` só precisa ser configurado quando você
quiser *remover as integradas*. Com apenas uma entrada, o seletor fica oculto.

**Esta não é uma forma de criar uma visualização que abranja várias coleções.** Um modo de visualização
é outra renderização da consulta de uma única coleção. Se o seu componente ignora
o `tableController` e busca quatro tabelas por conta própria, ele deveria ser uma
[`AppView`](/docs/frontend#custom-views) — a barra de ferramentas acima dele, com sua caixa de busca
e sua contagem de registros, estaria descrevendo uma consulta que ele não renderiza.

### `formView`
**Escopo:** coleção.

Substitui todo o formulário de entidade padrão por um componente personalizado. Definido na configuração de uma coleção:

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

O Builder é renderizado dentro do formulário do registro e recebe seu `formContext` ativo: grave com `formContext.setFieldValue`, e o Salvar da barra armazena o registro. Onde o registro não puder ser editado — a visualização de detalhes somente leitura, ou um usuário sem permissão de edição — `formContext.disabled` é `true` e as gravações lançam erros. Defina `includeActions: false` se o seu Builder salvar por conta própria por meio de `formContext.submit()`.

### `additionalFields`

**Escopo:** coleção.

Colunas computadas/virtuais exibidas na tabela da coleção. Elas não correspondem a propriedades armazenadas — são calculadas no momento da renderização.

→ [Colunas Adicionais](/docs/frontend/additional-columns)

### `propertyConfigs`

**Escopo:** tipo de propriedade.

Widgets de campo personalizados para tipos específicos de propriedades, fornecendo campos de formulário e componentes de pré-visualização personalizados.

→ [Campos Personalizados](/docs/frontend/custom-fields)

## Não é o Painel de Administração

Se o que você deseja alterar é o que o servidor faz, em vez do que o
painel mostra, esta é a página errada. O servidor possui sua própria hierarquia:

| Eu quero… | Degrau | Referência |
|---|---|---|
| Restringir quais linhas uma leitura retorna | callback `beforeQuery` | [Estendendo o servidor](/docs/backend/extending#2-collection-callbacks) |
| Ocultar um valor na saída | callback `afterRead` | [Callbacks](/docs/collections/callbacks) |
| Adicionar meu próprio endpoint | função personalizada | [Funções Personalizadas](/docs/backend/custom-functions) |
| Fazer com que a busca encontre substrings *e* ignore acentos | `search.mode: "hybrid"` | [Busca](/docs/backend/search) |
| Assumir o controle do processo do servidor | servidor customizado, depois `rebase eject` | [Estendendo o servidor](/docs/backend/extending) |

→ [O Rebase não faz X](/docs/backend/extending)

## Resumo de Precedência

- **O `admin.components` de uma coleção tem precedência sobre os `components` globais** dentro daquela coleção. Uma substituição na coleção substitui ambos; uma substituição na coleção com `wrap: true` envolve a substituição global quando ela existe (na versão 0.24 ela envolve o componente integrado, e a substituição global é ignorada). Consulte [Substituições de Componentes](/docs/frontend/component-overrides#when-both-scopes-override-a-component).
- **`Actions` de coleção e o slot `collection.actions` são aditivos** — `Actions` são renderizados primeiro, seguidos pelas contribuições do slot.
- **`entityActions` e `entityViews` no nível de app são um registro, não padrões:** uma coleção só exibe um deles quando seu próprio `admin.entityActions` / `admin.entityViews` especifica a sua `key`.
- **Os plugins são aplicados na ordem do array `plugins`**, não por `key`. As contribuições de slots são renderizadas conforme sua `order` (menor primeiro, 50 por padrão), e empates mantêm essa ordem. Field wrappers de múltiplos plugins são compostos nessa ordem, sendo o do primeiro plugin o mais interno; na versão 0.24, apenas o último wrapper era renderizado. Consulte [Plugins](/docs/plugins#field-wrappers-from-several-plugins).
