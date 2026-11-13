---
sourceHash: 362c7b70fede8ad5
title: Personalizando o Admin
sidebar_label: Personalizando o Admin
description: Como personalizar o admin do Rebase — blocos de construção, hooks e locais, com receitas testadas para singletons, configurações por usuário, ações em massa, visualizações em calendário, dashboards e telas de login personalizadas.
---

<span class="since-badge" data-since="0.31">Desde 0.31</span>

O admin é construído a partir de partes que você mesmo pode usar. Para personalizá-lo, você escreve
um componente React comum e o coloca em um local. Esse é todo o modelo:

- **Blocos de construção** que você renderiza — a tabela de uma coleção, o formulário de um registro, o kit de UI.
- **Hooks** para dados, o usuário autenticado, toasts e navegação.
- **Locais** para colocar um componente — uma página, um modo de visualização, um botão da barra de ferramentas, uma aba de registro, um campo, um slot ao lado de uma parte integrada ou um override que substitui uma.

Se um bloco de construção não fizer o que você precisa, copie seu código-fonte para o seu projeto
e altere-o — consulte [Copiando uma parte integrada](#copiando-uma-parte-integrada). Nada
aqui precisa que uma opção de configuração exista previamente. Os locais por tabela são
opções de [`customizeTable`](/docs/frontend/customize-table/).

## Receitas

Exemplos funcionais e testados são fornecidos dentro do `@rebasepro/cms`, de modo que aqueles em
`node_modules/@rebasepro/cms/recipes` sempre correspondem à sua versão instalada. Eles
importam apenas pacotes públicos: copie um para o seu projeto no estado em que se encontra.

| Receita | O que mostra |
|---|---|
| `site-settings.tsx` | Um singleton: um registro de configurações em sua própria página, criado no primeiro salvamento. |
| `my-preferences.tsx` | Configurações por usuário: cada usuário edita o registro identificado pelo seu uid. |
| `bulk-set-status.tsx` | Um botão da barra de ferramentas que atualiza todas as linhas selecionadas. |
| `calendar-view.tsx` | Um novo modo de visualização: as linhas de uma coleção em uma grade mensal. |
| `orders-dashboard.tsx` | Uma página que lê dados, desenha um gráfico e cria links para o admin. |
| `custom-login.tsx` | Substituindo a tela de login. |

O `README.md` ao lado deles é a referência completa de blocos de construção, hooks e locais.

## Exemplo: um singleton

<span class="since-badge" data-since="0.31">Desde 0.31</span>

Um singleton não é um tipo especial de tabela. É uma tabela comum cuja página
sempre abre a mesma linha. Ao receber um id, o `RecordForm` edita esse registro e
o cria sob esse id na primeira vez, portanto, não é necessário fazer seeding de dados.

```ts
// backend/schema/site_settings.ts: `rebase db push` creates the table.
import { defineTable, col } from "@rebasepro/server/schema";

export const siteSettings = defineTable("site_settings", {
    columns: {
        id:              col.text().primaryKey(),
        siteName:        col.text().notNull(),
        maintenanceMode: col.boolean().notNull().default(false),
    },
    rls: "admin-only",
});
```

```tsx
// frontend/src/cms/site_settings.tsx
import React from "react";
import { customizeTable, RecordForm } from "@rebasepro/cms";
import type { AppView } from "@rebasepro/cms-types";
import { Container, Typography } from "@rebasepro/ui";
import type { siteSettings } from "../../../backend/schema/site_settings";

// Reachable only through the page below, not from the drawer.
export const siteSettingsCms = customizeTable<typeof siteSettings>("site_settings", {
    name: "Site settings",
    hideFromNavigation: true,
    hideIdFromForm: true,
});

// Add to <RebaseCMS views={[siteSettingsView]}>.
export const siteSettingsView: AppView = {
    slug: "settings/site",
    name: "Site settings",
    icon: "Settings",
    view: (
        <Container maxWidth={"3xl"} className={"py-8"}>
            <Typography variant={"h4"} gutterBottom>Site settings</Typography>
            <RecordForm collection={"site_settings"} id={"site"}/>
        </Container>
    )
};
```

A mesma estrutura com `id={user.uid}` (de `useAuthController()`) é uma
página de configurações por usuário.

Para exibir apenas alguns
dos campos, passe `fields={["siteName"]}`. Para organizá-los você mesmo, passe
`layout` com `<FormField name="…"/>`s em seu próprio JSX. De qualquer forma, o formulário
valida apenas o que exibe — consulte
[Painéis em uma página própria](/docs/frontend/panels).

## Locais

<span class="since-badge" data-since="0.31">Desde 0.31</span>

| Para adicionar… | Coloque um componente em |
|---|---|
| Uma página | `<RebaseCMS views={[{ slug, name, icon, view }]}>` |
| Um modo de visualização para uma tabela | `customViews` em seu `customizeTable`, ou `<RebaseCMS collectionViews>` e a chave — consulte [Modos de visualização personalizados](/docs/frontend/extending#custom-view-modes) |
| Um botão na barra de ferramentas de uma coleção | `Actions: [Component]` em `customizeTable` |
| Um botão em um registro | `entityActions` em `customizeTable` — consulte [Ações de Entidade](/docs/frontend/entity-actions) |
| Uma aba em um registro | `entityViews` em `customizeTable` — consulte [Visualizações de Entidade](/docs/frontend/entity-views) |
| Como um campo é editado ou exibido | `Field` / `Preview` no campo em `customizeTable` — consulte [Campos Personalizados](/docs/frontend/custom-fields) |
| Algo ao lado de uma parte integrada | `<Rebase slots>` — consulte [Slots](/docs/frontend/slots) |
| Uma substituição para uma parte integrada | `<Rebase components>` — consulte [Substituições de Componentes](/docs/frontend/component-overrides) |

## O que cada local entrega ao seu componente

| Local | Seu componente recebe |
|---|---|
| Uma página (`views`) | Nada: leia o que você precisa com os hooks. Ela renderiza dentro do roteador do admin, então `useUrlController().navigate(…)` (ou `react-router`) funciona. |
| Um `Builder` de modo de visualização | `CollectionCustomViewParams`: `collection`, `path`, `tableController` (suas `rows` são as linhas que a busca e os filtros da barra de ferramentas selecionam, conforme o servidor as envia; `loading`, `error`, …), `onRowClick(row)` para abrir uma linha da mesma forma que a coleção abre linhas, `selectionController`, `highlightedIds` (ids como strings), `emptyComponent`. |
| `Actions` | `CollectionActionsProps`: `path`, `collection`, `selectionController` (`hasSelection`, `selection`, `isSelected(id)`, `clearSelection()`), `tableController` (`rows`, e seus `ids`), `openNewDocument(defaults?)`, `context`. Transforme `selection` em linhas e seus ids com `const { rows, ids } = await resolveSelection({ selection, data: context.data, collection })` — ela pode representar "todas as linhas que correspondem ao filtro", não apenas as marcadas. |
| `Builder` de `entityViews` | `EntityCustomViewParams`: `collection`, o registro salvo (`row`) e seu id (`id`), ambos ausentes enquanto ele estiver sendo criado, seus valores não salvos (`modifiedValues`) e o formulário (`formContext`). |
| `"Auth.LoginView"` | `{ authController }`. Faça login com `authController.emailPasswordLogin?.(email, password)` (opcional: presente quando o login por e-mail está habilitado); uma falha lança um erro e também fica disponível em `authController.authProviderError`. Assim que `authController.user` for definido, o admin substitui sua tela automaticamente. |
| Qualquer outro override | As props da parte que ele substitui; com `wrap: true`, essas props mais `OriginalComponent`. |

## Hooks

| Hook | Pacote | Fornece a você |
|---|---|---|
| `useRows` / `useRow` | `@rebasepro/app` | Uma lista de linhas em tempo real / uma única linha em tempo real, conforme o servidor as envia. |
| `useRowWrites` | `@rebasepro/app` | `create / update / remove`, através do servidor, de modo que os hooks de tabela e a row-level security se apliquem. |
| `useRebaseContext` | `@rebasepro/app` | `context.data.orders.find / findById / create / update / delete`, para código fora do estado do React; as mesmas linhas e gravações que executam os mesmos hooks. |
| `useAuthController` | `@rebasepro/app` | O `user` autenticado (uid, roles), login e logout. |
| `useSnackbarController` | `@rebasepro/app` | `open({ type, message })` para um toast. |
| `useSidePanel` | `@rebasepro/cms` | Abre qualquer registro no painel lateral. |
| `useUrlController` | `@rebasepro/cms` | URLs e navegação do admin. |
| `resolveSelection` | `@rebasepro/cms` | Uma seleção de tabela — linhas marcadas ou "todas correspondentes" — como linhas e seus ids: `const { rows, ids } = await resolveSelection({ selection, data: context.data, collection })`. |

## Copiando uma parte integrada

Quando uma parte integrada for próxima do que você deseja, copie seu código-fonte do
repositório `@rebasepro/cms` (ou `@rebasepro/app`) para o seu projeto, aponte seus
imports relativos para os pacotes, altere-a e registre-a sob o seu nome em
`<Rebase components>`. Tudo o que uma parte importa é uma exportação pública, portanto a cópia
compila — para todas as partes, exceto três, e as três exceções são intencionais:

- **`Collection.View`** é a composição de todos os modos de visualização — list, table,
  cards, board, split — com edição inline, o editor de campos em popup, a caixa de diálogo
  de exclusão e o estado de URL do modo de visualização. O que ele importa são os elementos
  internos desses modos. Em vez disso, substitua uma parte dele (`Collection.Table`,
  `Collection.Card`, `Collection.Actions`, `Collection.EmptyState`, que podem ser
  copiados normalmente), adicione um [modo de visualização](/docs/frontend/view-modes)
  próprio ou envolva-o com `wrap: true`.
- **`DetailView`** é a composição da visualização de registro: barra de identidade, abas,
  inspetor e os botões da lista dividida (split list), em torno de ids de abas que são valores de URL.
  Personalize um registro com [visualizações de entidade](/docs/frontend/entity-views),
  [ações de entidade](/docs/frontend/entity-actions), os [slots](/docs/frontend/slots) de `form.*`,
  ou os overrides de `Entity.Form` e `EditView.FormActions`, que podem ser copiados.
- **`HomePage`** pode ser copiado, exceto por sua reordenação por arrastar e soltar (drag-and-drop) de cards e
  grupos, que não possui uma API própria para exportar. Uma página inicial própria
  compõe `NavigationGroup`, `NavigationCardBinding` e `FavouritesView` sobre
  `useNavigationStateController().topLevelNavigation`; para estender a página padrão,
  use o slot `home.cards`.
