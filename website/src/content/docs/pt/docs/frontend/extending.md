---
sourceHash: 3317ba94279d0cb8
title: Estendendo o Rebase
sidebar_label: Estendendo o Rebase
description: Um guia de decisão para escolher o mecanismo de extensão correto — plugins, slots, substituições de componentes, visualizações de entidade, ações e muito mais.
---

## Visão Geral

O Rebase oferece cerca de uma dúzia de mecanismos de extensão — plugins, slots, substituições de componentes, visualizações de entidade, ações, campos personalizados e muito mais. Cada um visa um escopo diferente (em toda a aplicação, por coleção, por entidade, por propriedade) e uma parte diferente da UI.

Este guia ajuda você a escolher o mecanismo certo para o seu caso de uso e, em seguida, direciona para a referência detalhada de cada um.

:::tip[Comece pelo modelo, não pela lista]
Por baixo dos panos, todo mecanismo abaixo é a mesma coisa: um componente React colocado em um lugar. [Personalizando o Admin](/docs/frontend/customizing) explica esse modelo em uma página — blocos de construção, hooks, locais — com receitas testadas para um singleton de configurações, configurações por usuário, uma ação em massa, uma visualização em calendário, um painel e uma tela de login personalizada. Leia-o primeiro; volte aqui para escolher o local.
:::

Tudo aqui diz respeito ao **painel administrativo**. Para o servidor — restringir uma leitura,
adicionar uma rota, incorporar o driver em seu próprio processo, `rebase eject` — consulte
[O Rebase não faz X](/docs/backend/extending), que é o mesmo tipo de tabela
para o backend.

## Tabela de Decisão

<span class="since-badge" data-since="0.31">Desde 0.31</span>

| Eu quero… | Mecanismo | Escopo | Referência |
|---|---|---|---|
| Substituir a barra de aplicativo | `components` (`Shell.AppBar`) | app | [Substituições de Componentes](/docs/frontend/component-overrides) |
| Substituir a página de login | `components` (`Auth.LoginView`) | app | [Substituições de Componentes](/docs/frontend/component-overrides) |
| Substituir a página inicial | `components` (`HomePage`) | app | [Substituições de Componentes](/docs/frontend/component-overrides) |
| Mudar completamente a aparência do formulário de uma tabela | `formView` em `customizeTable` | table | [abaixo](#formview) |
| Trocar um componente dentro da coleção de uma tabela | `components` em `customizeTable` | table | [Substituições de Componentes](/docs/frontend/component-overrides#collection-level-component-overrides) |
| Definir substituições de componentes padrão para todas as coleções | `components` (nomes no escopo da coleção) | app | [Substituições de Componentes](/docs/frontend/component-overrides) |
| Adicionar um botão à barra de ferramentas da coleção | `Actions` em `customizeTable` | table | [Ações de Entidade](/docs/frontend/entity-actions#collection-actions) |
| Injetar UI em um slot da barra de ferramentas da coleção | slot `collection.actions` | app/plugin | [Slots](/docs/frontend/slots) |
| Adicionar uma coluna computada a uma tabela | `additionalFields` em `customizeTable` | table | [Colunas Adicionais](/docs/frontend/additional-columns) |
| Substituir o controle de um campo | `Field` em `customizeTable` | field | [Campos Personalizados](/docs/frontend/custom-fields) |
| Registrar um tipo de campo reutilizável | `propertyConfigs` | app | [Campos Personalizados](/docs/frontend/custom-fields#a-reusable-field-type) |
| Adicionar uma aba de entidade | `entityViews` em `customizeTable` | entity | [Visualizações de Entidade](/docs/frontend/entity-views) |
| Renderizar as linhas de uma tabela de forma diferente | `customViews` em `customizeTable` | table | [abaixo](#modos-de-visualização-personalizados) |
| Adicionar uma ação de linha/contexto ou botão de entidade | `entityActions` em `customizeTable` | entity | [Ações de Entidade](/docs/frontend/entity-actions) |
| Colocar uma métrica no card da página inicial de uma coleção | slot `home.card.widget` | app/plugin | [Slots](/docs/frontend/slots) |
| Injetar UI em um local específico da moldura (chrome) | `slots` | app/plugin | [Slots](/docs/frontend/slots) |
| Distribuir várias extensões como uma única unidade instalável | `plugins` | app | [Plugins](/docs/plugins) |
| Estilizar o que acabei de construir | `@rebasepro/ui` + tokens de tema | qualquer | [Estilizando UI Personalizada](/docs/frontend/styling) |

:::tip[O que quer que escolha, construa com o kit]
Cada mecanismo abaixo fornece um componente React e não impõe nada sobre como
preenchê-lo. Use os componentes `@rebasepro/ui` e os tokens de cor do tema em
vez de CSS escrito à mão — uma visualização personalizada ainda é uma visualização de admin, e uma
cor hardcoded fica invisível em um dos dois temas. Consulte
[Estilizando UI Personalizada](/docs/frontend/styling).
:::

## Mecanismos em Detalhes

### Plugins

<span class="since-badge" data-since="0.31">Desde 0.31</span>

**Escopo:** app.

Um plugin agrupa coleções injetadas ou modificadas, visualizações, contribuições de slot, wrappers de campo, provedores, hooks e callbacks de ciclo de vida em uma única unidade instalável. Substituições de componentes, visualizações de entidade, ações de entidade e `propertyConfigs` não são campos de plugin: eles ficam no `<Rebase>` ou no `customizeTable` de uma tabela.

→ [Referência de Plugins](/docs/plugins)

### Slots

**Escopo:** app (contribuído por slot).

Slots são pontos de extensão nomeados da UI espalhados pela moldura (chrome) do CMS. Você registra um componente React visando o nome de um slot, e ele é renderizado naquele local. Existem 27 slots cobrindo a página inicial, navegação, visualizações de coleção, formulários, linhas de entidade, campos de formulário e a barra de aplicativo — e cada um deles é renderizado.

→ [Referência de Slots](/docs/frontend/slots)

### Substituições de Componentes (Swizzling)

**Escopo:** padrões a nível de app ou por coleção.

Dois modos: **Eject** (substituição completa) ou **Wrap** (incrementar o original).

19 nomes de componentes substituíveis em dois níveis:

**Apenas no nível de app (7):**
- `Shell.AppBar`
- `Shell.Drawer`
- `Shell.DrawerNavigationItem`
- `Shell.DrawerNavigationGroup`
- `HomePage`
- `HomePage.CollectionCard`
- `Auth.LoginView`

**No escopo de coleção (12):**
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

**Precedência:** O `components` de uma tabela é aplicado sobre os padrões no nível de app para o mesmo nome de componente: uma substituição de coleção substitui ambos, e uma substituição com `wrap: true` de coleção envolve a do nível de app. Nomes de componentes exclusivos de app (`Shell.*`, `HomePage`, `Auth.*`) só podem ser substituídos no nível de `<Rebase>`.

→ [Substituições de Componentes](/docs/frontend/component-overrides)

### Visualizações de Entidade

<span class="since-badge" data-since="0.31">Desde 0.31</span>

**Escopo:** entidade (adiciona abas).

Visualizações personalizadas que aparecem como abas na página de detalhes da entidade. Definidas por tabela em `customizeTable`, ou registradas uma vez em `<Rebase entityViews>` (ou `<RebaseCMS entityViews>`) e referenciadas por `key` nas `entityViews` de uma tabela.

→ [Visualizações de Entidade](/docs/frontend/entity-views)

### Ações de Entidade

<span class="since-badge" data-since="0.31">Desde 0.31</span>

**Escopo:** entidade.

Botões de ação personalizados em entidades individuais (publicar, arquivar, clonar, etc.). Definidos por tabela em `customizeTable`, ou registrados uma vez em `<Rebase entityActions>` (ou `<RebaseCMS entityActions>`) e referenciados por `key` nas `entityActions` de uma tabela.

→ [Ações de Entidade](/docs/frontend/entity-actions)

### `Actions` de Coleção

**Escopo:** coleção.

Componentes React no nível da barra de ferramentas que recebem `CollectionActionsProps` (entidades selecionadas, controlador da tabela, contexto da coleção). Renderizados na barra de ferramentas da coleção junto às ações integradas.

**Relação com o slot `collection.actions`:** Ambos são aditivos — os componentes `Actions` são renderizados primeiro na barra de ferramentas, seguidos pelas contribuições de slot de `collection.actions`. Eles não se substituem.

→ [Ações de Entidade — Ações de Coleção](/docs/frontend/entity-actions#collection-actions)

### Modos de visualização personalizados

<span class="since-badge" data-since="0.31">Desde 0.31</span>
**Escopo:** coleção (adiciona um modo de visualização).

Um mapa, um calendário, uma galeria, uma linha do tempo — outra renderização das *mesmas linhas*,
disponibilizada no seletor de visualizações da coleção ao lado de Lista, Tabela, Cards e Quadro.

```tsx
// frontend/src/cms/tasks.tsx
import { customizeTable } from "@rebasepro/cms";
import type { tasks } from "../../../backend/schema/tasks";
import { MapView } from "../../../../../components/MapView";

export const tasksCms = customizeTable<typeof tasks>("tasks", {
    customViews: [
        { key: "map", name: "Map", icon: "Map", Builder: MapView },
    ],
    enabledViews: ["table", "map"],
    defaultViewMode: "map",
});
```

Ou registre o componente uma vez e refira-o por chave, o que também o torna
selecionável a partir do editor de coleções:

```tsx
<RebaseCMS
    tableCustomizations={tableCustomizations}
    collectionViews={[{ key: "map", name: "Map", icon: "Map", Builder: MapView }]}
/>
```

```tsx
import { customizeTable } from "@rebasepro/cms";
import type { tasks } from "../../../backend/schema/tasks";

export const tasksCms = customizeTable<typeof tasks>("tasks", {
    customViews: ["map"],
});
```

`Builder` recebe o `tableController` ativo, portanto a visualização herda os
filtros da coleção, a caixa de busca, ordenação, paginação, checagens de permissão
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

As linhas vêm do servidor, no mesmo formato retornado por `useRows`: datas como strings ISO,
um belongsTo como sua coluna de chave estrangeira, e uma relação que a visualização carregou aninhada
sob seu nome. Uma linha tem uma coluna `id` apenas onde sua tabela tem; seu id está
ao lado, `tableController.ids[i]` para `tableController.rows[i]`.
`highlightedIds` são os ids das linhas que a visualização renderiza como selecionadas, e o
`selectionController` também opera com ids e linhas:

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

A seleção da visualização atualiza `?__view=`, sobrevive a um recarregamento e persiste por usuário.
Declarar uma é suficiente para disponibilizá-la — `enabledViews` só precisa ser configurado quando você
desejar *remover visualizações integradas*. Com apenas uma entrada, o seletor fica oculto.

**Esta não é uma maneira de construir uma visualização que abranja várias coleções.** Um modo de visualização
é outra renderização da consulta de uma única coleção. Se o seu componente ignora
`tableController` e faz requisições por conta própria para quatro tabelas, ele deve ser uma
[`AppView`](/docs/frontend#custom-views) — a barra de ferramentas acima dele, com sua caixa de busca
e contagem de registros, estaria descrevendo uma consulta que ele não renderiza.

### `formView`

<span class="since-badge" data-since="0.31">Desde 0.31</span>
**Escopo:** coleção.

Substitui todo o formulário padrão de entidade por um componente personalizado, definido com
`formView: { Builder, includeActions }` em `customizeTable`; consulte
[Substituindo o formulário](/docs/frontend/form-layout/#replacing-the-form).
`includeActions` (padrão `true`) mantém Salvar e Descartar na barra.

Use quando precisar de um layout completamente personalizado para a edição de registros de uma tabela.
Para ajustes menores, prefira a substituição de `Entity.Form` em `components`.

O Builder é renderizado dentro do formulário do registro e recebe seu `formContext` ativo: escreva com `formContext.setFieldValue`, e o botão Salvar da barra armazenará o registro. Onde o registro não puder ser editado — na visualização de detalhes somente leitura, ou para um usuário sem permissão de edição —, `formContext.disabled` será `true` e tentativas de escrita lançarão exceções. Defina `includeActions: false` se o seu Builder realizar o salvamento por conta própria através de `formContext.submit()`.

### `additionalFields`

**Escopo:** coleção.

Colunas computadas exibidas na tabela da coleção. Elas não correspondem a colunas armazenadas: são calculadas no momento da renderização.

→ [Colunas Adicionais](/docs/frontend/additional-columns)

### `propertyConfigs`

**Escopo:** tipo de propriedade.

Tipos de campo reutilizáveis, registrados uma vez em `<Rebase propertyConfigs>` e referenciados pelo `propertyConfig` de um campo.

→ [Campos Personalizados](/docs/frontend/custom-fields)

## Não é o painel administrativo

Se o que você deseja alterar é o que o servidor faz e não o que o
painel mostra, esta é a página errada. O servidor possui seus próprios níveis:

| Eu quero… | Nível | Referência |
|---|---|---|
| Restringir quais linhas uma leitura retorna | hook `beforeQuery` | [Estendendo o servidor](/docs/backend/extending#2-table-hooks) |
| Ocultar/sanitizar um valor na saída | hook `afterRead` | [Hooks de tabela](/docs/collections/callbacks) |
| Adicionar um endpoint próprio | função personalizada | [Funções Personalizadas](/docs/backend/custom-functions) |
| Fazer a busca encontrar substrings *e* ignorar acentos | `search.mode: "hybrid"` | [Busca](/docs/backend/search) |
| Ter controle total do processo do servidor | servidor customizado e depois `rebase eject` | [Estendendo o servidor](/docs/backend/extending) |

→ [O Rebase não faz X](/docs/backend/extending)

## Resumo de Precedência

<span class="since-badge" data-since="0.31">Desde 0.31</span>

- **O `components` de uma tabela tem precedência sobre o `components` global** dentro de sua coleção. Uma substituição de coleção substitui ambos; uma substituição com `wrap: true` de coleção envolve a substituição global quando ela existe. Consulte [Substituições de Componentes](/docs/frontend/component-overrides#when-both-scopes-override-a-component).
- **O `Actions` de coleção e o slot `collection.actions` são aditivos** — `Actions` são renderizados primeiro, seguidos pelas contribuições de slot.
- **`entityActions` e `entityViews` a nível de app são um registro, não padrões:** uma tabela só exibe um quando seu próprio `entityActions` / `entityViews` em `customizeTable` especifica sua `key`.
- **Os plugins são aplicados na ordem do array `plugins`**, não por `key`. Contribuições de slot são renderizadas por sua propriedade `order` (menor primeiro, padrão 50), e empates mantêm essa ordem. Wrappers de campo de múltiplos plugins se compõem nessa ordem, sendo o do primeiro plugin o mais interno. Consulte [Plugins](/docs/plugins#field-wrappers-from-several-plugins).
