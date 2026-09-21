---
sourceHash: 026e97ba1b999743
title: Estendendo o Rebase
sidebar_label: Estendendo o Rebase
description: Um guia de decisão para escolher o mecanismo de extensão correto — plugins, slots, substituições de componentes, visualizações de entidade, ações e muito mais.
---

## Visão Geral

O Rebase oferece cerca de uma dúzia de mecanismos de extensão — plugins, slots, substituições de componentes, visualizações de entidade, ações, campos personalizados e muito mais. Cada um visa um escopo diferente (em nível de app, por coleção, por entidade, por propriedade) e uma parte diferente da interface do usuário.

Este guia ajuda você a escolher o mecanismo certo para o seu caso de uso e, em seguida, direciona para a referência detalhada de cada um.

Tudo aqui se refere ao **painel administrativo**. Para o servidor — limitar uma leitura,
adicionar uma rota, incorporar o driver em seu próprio processo, `rebase eject` — consulte
[O Rebase não faz X](/docs/backend/extending), que traz uma tabela semelhante
para o backend.

## Tabela de Decisão

| Eu quero… | Mecanismo | Escopo | Referência |
|---|---|---|---|
| Substituir a barra do app | `components` (`Shell.AppBar`) | app | [Substituições de Componentes](/docs/frontend/component-overrides) |
| Substituir a página de login | `components` (`Auth.LoginView`) | app | [Substituições de Componentes](/docs/frontend/component-overrides) |
| Substituir a página inicial | `components` (`HomePage`) | app | [Substituições de Componentes](/docs/frontend/component-overrides) |
| Mudar completamente a aparência do formulário de uma coleção | `formView` | coleção | [abaixo](#formview) |
| Trocar um componente dentro de uma coleção | `collection.components` | coleção | [Substituições de Componentes](/docs/frontend/component-overrides) |
| Definir substituições de componentes padrão para todas as coleções | `components` (nomes com escopo de coleção) | app | [Substituições de Componentes](/docs/frontend/component-overrides) |
| Adicionar um botão à barra de ferramentas da coleção | `Actions` da coleção | coleção | [Ações de Entidade](/docs/frontend/entity-actions#collection-actions) |
| Injetar interface em um slot da barra de ferramentas da coleção | slot `collection.actions` | app/plugin | [Slots](/docs/frontend/slots) |
| Adicionar uma coluna computada a uma tabela | `additionalFields` | coleção | [Colunas Adicionais](/docs/frontend/additional-columns) |
| Adicionar um widget de campo personalizado para um tipo de propriedade | `propertyConfigs` | tipo de propriedade | [Campos Personalizados](/docs/frontend/custom-fields) |
| Adicionar uma aba à entidade | `entityViews` | entidade | [Visualizações de Entidade](/docs/frontend/entity-views) |
| Renderizar as linhas de uma coleção de uma maneira diferente | `admin.customViews` | coleção | [abaixo](#customviews) |
| Adicionar uma ação de linha/contexto ou botão de entidade | `entityActions` | entidade | [Ações de Entidade](/docs/frontend/entity-actions) |
| Inserir um número/indicador no card da página inicial de uma coleção | slot `home.card.widget` | app/plugin | [Slots](/docs/frontend/slots) |
| Injetar interface em um local específico do chrome | `slots` | app/plugin | [Slots](/docs/frontend/slots) |
| Distribuir várias extensões como uma única unidade instalável | `plugins` | app | [Plugins](/docs/plugins) |
| Estilizar o que acabei de construir | `@rebasepro/ui` + tokens do tema | qualquer | [Estilizando UI Personalizada](/docs/frontend/styling) |

:::tip[Independentemente do que escolher, construa a partir do kit]
Cada mecanismo abaixo fornece um componente React e não impõe como
preenchê-lo. Use os componentes `@rebasepro/ui` e os tokens de cor do tema em vez
de CSS manual — uma visualização personalizada ainda é uma visualização do admin, e uma
cor fixa no código fica invisível em um dos dois temas. Consulte
[Estilizando UI Personalizada](/docs/frontend/styling).
:::

## Mecanismos em Detalhes

### Plugins

**Escopo:** app.

Um plugin agrupa coleções, visualizações, substituições de componentes, contribuições de slots, autenticação, fontes de dados, providers, hooks e callbacks de ciclo de vida em uma única unidade instalável. Todos os outros mecanismos listados aqui podem ser fornecidos por meio da interface de um plugin.

→ [Referência de Plugins](/docs/plugins)

### Slots

**Escopo:** app (fornecido por slot).

Slots são pontos de extensão nomeados da interface de usuário distribuídos pelo chrome do CMS. Você registra um componente React direcionado a um nome de slot, e ele é renderizado naquele local. Existem 27 slots cobrindo a página inicial, navegação, visualizações de coleção, formulários, linhas de entidade, campos de formulário e a barra do app — e cada um deles é renderizado.

→ [Referência de Slots](/docs/frontend/slots)

### Substituições de Componentes (Swizzling)

**Escopo:** padrões em nível de aplicativo ou por coleção.

Dois modos: **Eject** (substituição completa) ou **Wrap** (estender o original).

19 nomes de componentes substituíveis divididos em dois níveis:

**Exclusivos do App (7):**
- `Shell.AppBar`
- `Shell.Drawer`
- `Shell.DrawerNavigationItem`
- `Shell.DrawerNavigationGroup`
- `HomePage`
- `HomePage.CollectionCard`
- `Auth.LoginView`

**Com escopo de Coleção (12):**
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

**Precedência:** `components` em nível de coleção substituem os padrões em nível de app para o mesmo nome de componente (spread simples de objeto — os valores da coleção sobrescrevem os valores globais). Nomes de componentes exclusivos do app (`Shell.*`, `HomePage`, `Auth.*`) só podem ser substituídos no nível de `<Rebase>`.

→ [Substituições de Componentes](/docs/frontend/component-overrides)

### Visualizações de Entidade

**Escopo:** entidade (adiciona abas).

Visualizações personalizadas que aparecem como abas na página de detalhes da entidade. Podem ser definidas globalmente em `<Rebase>` ou por coleção.

→ [Visualizações de Entidade](/docs/frontend/entity-views)

### Ações de Entidade

**Escopo:** entidade.

Botões de ação personalizados em entidades individuais (publicar, arquivar, clonar, etc.). Podem ser definidos globalmente ou por coleção.

→ [Ações de Entidade](/docs/frontend/entity-actions)

### `Actions` de Coleção

**Escopo:** coleção.

Componentes React em nível de barra de ferramentas que recebem `CollectionActionsProps` (entidades selecionadas, controlador de tabela, contexto da coleção). Renderizados na barra de ferramentas da coleção juntamente com as ações integradas.

**Relação com o slot `collection.actions`:** Ambos são cumulativos — os componentes de `Actions` são renderizados primeiro na barra de ferramentas, seguidos pelas contribuições de slots de `collection.actions`. Eles não substituem um ao outro.

→ [Ações de Entidade — Ações de Coleção](/docs/frontend/entity-actions#collection-actions)

### Modos de visualização personalizados {#customviews}

**Escopo:** coleção (adiciona um modo de visualização).

Um mapa, um calendário, uma galeria, uma linha do tempo — outra renderização das *mesmas linhas*,
oferecida no seletor de visualizações da coleção ao lado de Lista, Tabela, Cards e Quadro.

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

Ou registre o componente uma vez e o identifique pela chave, o que também o torna
selecionável a partir do editor de coleções:

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
filtros da coleção, a caixa de busca, a ordenação, a paginação, as verificações de permissão
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

Selecionar a visualização atualiza `?__view=`, sobrevive a um recarregamento e persiste por usuário.
Declarar uma já é suficiente para oferecê-la — `enabledViews` só precisa ser configurado quando você
deseja *remover as opções integradas*. Com apenas uma entrada, o seletor fica oculto.

**Esta não é uma maneira de construir uma visualização que abranja várias coleções.** Um modo de visualização
é outra renderização da consulta de uma única coleção. Se o seu componente ignora
o `tableController` e busca dados de quatro tabelas próprias, ele deveria ser uma
[`AppView`](/docs/frontend#custom-views) — a barra de ferramentas acima dele, com sua caixa de busca
e contagem de registros, estaria descrevendo uma consulta que ele não renderiza.

### `formView` {#formview}

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

Use quando precisar de um layout totalmente personalizado para a experiência de edição de entidades de uma coleção. Para ajustes menores, prefira `collection.components` com a substituição de `Entity.Form`.

O Builder é renderizado dentro do formulário do registro e recebe seu `formContext` ativo: grave com `formContext.setFieldValue`, e o botão Salvar da barra armazenará o registro. Onde o registro não puder ser editado — na visualização de detalhes somente leitura, ou para um usuário sem permissão de edição —, `formContext.disabled` será `true` e as tentativas de escrita lançarão erro. Defina `includeActions: false` se o seu Builder salvar por conta própria através de `formContext.submit()`.

### `additionalFields`

**Escopo:** coleção.

Colunas computadas/virtuais exibidas na tabela da coleção. Elas não correspondem a propriedades armazenadas — são calculadas no momento da renderização.

→ [Colunas Adicionais](/docs/frontend/additional-columns)

### `propertyConfigs`

**Escopo:** tipo de propriedade.

Widgets de campos personalizados para tipos de propriedade específicos, fornecendo campos de formulário e componentes de pré-visualização personalizados.

→ [Campos Personalizados](/docs/frontend/custom-fields)

## Fora do painel administrativo

Se o que você deseja alterar é o comportamento do servidor, em vez do que o
painel exibe, esta não é a página correta. O servidor tem sua própria estrutura em camadas:

| Eu quero… | Degrau | Referência |
|---|---|---|
| Limitar quais linhas uma leitura retorna | callback `beforeQuery` <span class="since-badge" data-since="0.22">Desde 0.22</span> | [Estendendo o servidor](/docs/backend/extending#2-collection-callbacks) |
| Ocultar/redigir um valor na saída | callback `afterRead` | [Callbacks](/docs/collections/callbacks) |
| Adicionar um endpoint próprio | função personalizada | [Funções Personalizadas](/docs/backend/custom-functions) |
| Fazer a busca encontrar substrings *e* ignorar acentos | `search.mode: "hybrid"` <span class="since-badge" data-since="0.22">Desde 0.22</span> | [Busca](/docs/backend/search) |
| Assumir o controle do processo do servidor | servidor personalizado, depois `rebase eject` | [Estendendo o servidor](/docs/backend/extending) |

→ [O Rebase não faz X](/docs/backend/extending)

## Resumo de Precedência

- **`collection.components` tem precedência sobre os `components` globais** dentro dessa coleção (mesclagem simples via spread em `DataCollectionView`).
- **`Actions` de coleção e o slot `collection.actions` são cumulativos** — `Actions` são renderizados primeiro, seguidos pelas contribuições de slots.
- **`entityActions` e `entityViews` em nível de coleção estendem (não substituem) os globais.**
- **As contribuições de plugins são mescladas na ordem de suas chaves (`key`).**
