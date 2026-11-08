---
sourceHash: 31ccfe9d60f8eafe
title: Personalizando o Admin
sidebar_label: Personalizando o Admin
description: Como personalizar o admin do Rebase — blocos de construção, hooks e locais, com receitas testadas para singletons, configurações por usuário, ações em massa, visualizações em calendário, dashboards e telas de login personalizadas.
---

O admin é construído a partir de partes que você mesmo pode usar. Para personalizá-lo,
você escreve um componente React comum e o coloca em um local. Esse é todo o modelo:

- **Blocos de construção** que você renderiza — a tabela de uma coleção, o formulário de um registro, o kit de UI.
- **Hooks** para dados, o usuário autenticado, toasts e navegação.
- **Locais** para colocar um componente — uma página, um modo de visualização de coleção, um botão da barra de ferramentas, uma aba de registro, um campo, um slot ao lado de uma parte nativa ou uma substituição que substitui uma existente.

Se um bloco de construção não fizer o que você precisa, copie seu código-fonte para o seu projeto
e altere-o — consulte [Copiando uma parte nativa](#copying-a-built-in-part). Nada
aqui precisa que uma opção de configuração exista previamente.

## Receitas

Exemplos funcionais e testados vêm integrados ao `@rebasepro/cms`, portanto, os que
estão em `node_modules/@rebasepro/cms/recipes` sempre correspondem à sua versão instalada. Eles
importam apenas pacotes públicos: copie um para o seu projeto como está.

| Receita | O que demonstra |
|---|---|
| `site-settings.tsx` | Um singleton: um registro de configurações em sua própria página, criado no primeiro salvamento. |
| `my-preferences.tsx` | Configurações por usuário: cada usuário edita o registro indexado pelo seu uid. |
| `bulk-set-status.tsx` | Um botão da barra de ferramentas que atualiza todas as linhas selecionadas. |
| `calendar-view.tsx` | Um novo modo de visualização: as linhas de uma coleção em uma grade mensal. |
| `orders-dashboard.tsx` | Uma página que lê dados, desenha um gráfico e inclui links para o admin. |
| `custom-login.tsx` | Substituição da tela de login. |

O `README.md` ao lado deles é a referência completa de blocos de construção, hooks e locais.

## Exemplo: um singleton

Um singleton não é um tipo especial de coleção. É uma tabela comum cuja página
sempre abre a mesma linha. Ao receber um ID, o `EntityFormPanel` edita esse registro e
o cria sob esse ID na primeira vez, de modo que nada precisa de seed.

```tsx
import React from "react";
import { defineCollection } from "@rebasepro/cms-types";
import type { AppView } from "@rebasepro/cms-types";
import { EntityFormPanel } from "@rebasepro/cms";
import { Container, Typography } from "@rebasepro/ui";

// config/collections/site_settings.ts — `rebase db push` creates the table.
export const siteSettingsCollection = defineCollection({
    name: "Site settings",
    slug: "site_settings",
    table: "site_settings",
    properties: {
        id: { name: "ID", type: "string", isId: true },
        siteName: { name: "Site name", type: "string", validation: { required: true } },
        maintenanceMode: { name: "Maintenance mode", type: "boolean" }
    },
    admin: { hideFromNavigation: true, hideIdFromForm: true }
});

// Add to <RebaseCMS views={[siteSettingsView]}>.
export const siteSettingsView: AppView = {
    slug: "settings/site",
    name: "Site settings",
    icon: "Settings",
    view: (
        <Container maxWidth={"3xl"} className={"py-8"}>
            <Typography variant={"h4"} gutterBottom>Site settings</Typography>
            <EntityFormPanel collection={siteSettingsCollection} entityId={"site"}/>
        </Container>
    )
};
```

A mesma estrutura com `entityId={user.uid}` (do `useAuthController()`) é uma
página de configurações por usuário.

<span class="since-badge" data-since="0.29">Since 0.29</span> Para exibir apenas alguns dos
campos, passe `fields={["siteName"]}`. Para organizá-los você mesmo, passe
`layout` com `<FormField name="…"/>`s em seu próprio JSX. De qualquer forma, o formulário
valida apenas o que ele exibe — consulte
[Painéis em sua própria página](/docs/frontend/panels).

## Locais

| Para adicionar… | Coloque um componente em |
|---|---|
| Uma página | `<RebaseCMS views={[{ slug, name, icon, view }]}>` |
| Um modo de visualização para uma coleção | `collectionViews={[{ key, name, Builder }]}` e `admin.customViews: ["key"]` — consulte [Modos de visualização](/docs/frontend/view-modes) |
| Um botão na barra de ferramentas de uma coleção | `admin.Actions: [Component]` |
| Um botão em um registro | `admin.entityActions` — consulte [Ações de entidade](/docs/frontend/entity-actions) |
| Uma aba em um registro | `admin.entityViews` — consulte [Visualizações de entidade](/docs/frontend/entity-views) |
| Como um campo é editado ou exibido | `admin.Field` / `admin.Preview` — consulte [Campos customizados](/docs/frontend/custom-fields) |
| Algo ao lado de uma parte nativa | `<Rebase slots>` — consulte [Slots](/docs/frontend/slots) |
| Um substituto para uma parte nativa | `<Rebase components>` — consulte [Substituições de componentes](/docs/frontend/component-overrides) |

## O que cada local fornece ao seu componente

| Local | O que seu componente recebe |
|---|---|
| Uma página (`views`) | Nada: leia o que precisar com os hooks. Ela é renderizada dentro do roteador do admin, portanto `useUrlController().navigate(…)` (ou `react-router`) funciona. |
| Um `Builder` de modo de visualização | `CollectionCustomViewParams`: `collection`, `path`, `tableController` (seu `data` são as linhas que a busca e os filtros da barra de ferramentas selecionam, `dataLoading`, …), `onEntityClick(entity)` para abrir uma linha da mesma forma que a coleção abre linhas, `selectionController`, `emptyComponent`. |
| `admin.Actions` | `CollectionActionsProps`: `path`, `collection`, `selectionController` (`hasSelection`, `selection`, `clearSelection()`), `tableController`, `openNewDocument(defaults?)`. Transforme a `selection` em linhas com `resolveSelection({ selection, accessor: useData().collection(path) })` — ela pode representar "todas as linhas correspondentes ao filtro", não apenas as marcadas. |
| `Builder` de `admin.entityViews` | `EntityCustomViewParams`: `collection`, o registro (`entity`, ausente enquanto estiver sendo criado), seus valores não salvos (`modifiedValues`) e o formulário (`formContext`). |
| `"Auth.LoginView"` | `{ authController }`. Faça login com `authController.emailPasswordLogin?.(email, password)` (opcional: presente quando o login por e-mail está habilitado); uma falha lança um erro e também é disponibilizada em `authController.authProviderError`. Assim que `authController.user` for definido, o admin substitui sua tela automaticamente. |
| Qualquer outra substituição | As props da parte que ela substitui; com `wrap: true`, essas props mais o `OriginalComponent`. |

## Hooks

| Hook | Pacote | O que fornece |
|---|---|---|
| `useData` | `@rebasepro/app` | `useData().collection("orders").find / findById / create / update / delete`, através do servidor, portanto callbacks e regras de segurança são aplicados. |
| `useCollection` / `useFetch` | `@rebasepro/app` | Uma lista de linhas em tempo real / um registro em tempo real. |
| `useAuthController` | `@rebasepro/app` | O `user` autenticado (uid, roles), login e logout. |
| `useSnackbarController` | `@rebasepro/app` | `open({ type, message })` para um toast. |
| `useSidePanel` | `@rebasepro/cms` | Abre qualquer registro no painel lateral. |
| `useUrlController` | `@rebasepro/cms` | URLs do admin e navegação. |
| `resolveSelection` | `@rebasepro/cms` | Uma seleção de tabela — linhas marcadas ou "todas as correspondentes" — como linhas. |

## Copiando uma parte nativa

Quando uma parte nativa estiver próxima do que você deseja, copie o código-fonte dela do
repositório `@rebasepro/cms` (ou `@rebasepro/app`) para o seu projeto, aponte seus
imports relativos para os pacotes, modifique-a e registre-a sob o seu nome em
`<Rebase components>`. Tudo o que uma parte importa é uma exportação pública, portanto a cópia
compila — para todas as partes, exceto três, e essas três são deliberadas:

- **`Collection.View`** é a composição de todos os modos de visualização — lista, tabela,
  cartões, quadro (board), divisão (split) — com edição inline, o editor de campo popup, a
  caixa de diálogo de exclusão e o estado de URL do modo de visualização. O que ele importa são
  os elementos internos desses modos. Em vez disso, substitua uma parte dele (`Collection.Table`,
  `Collection.Card`, `Collection.Actions`, `Collection.EmptyState`, que podem ser copiados normalmente),
  adicione um [modo de visualização](/docs/frontend/view-modes) próprio ou envolva-o com
  `wrap: true`.
- **`DetailView`** é a composição da visualização de registro: barra de identidade, abas,
  inspetor e os botões da lista dividida, em torno de IDs de abas que são valores de URL.
  Personalize um registro com [visualizações de entidade](/docs/frontend/entity-views),
  [ações de entidade](/docs/frontend/entity-actions), os [slots](/docs/frontend/slots) `form.*`
  ou as substituições de `Entity.Form` e `EditView.FormActions`, que podem ser copiadas.
- **`HomePage`** pode ser copiado, exceto por sua reordenação de cartões e
  grupos via arrastar e soltar (drag-and-drop), que não possui uma API própria para exportar. Uma página inicial
  própria compõe `NavigationGroup`, `NavigationCardBinding` e `FavouritesView` sobre
  `useNavigationStateController().topLevelNavigation`; para adicionar elementos à padrão,
  use o slot `home.cards`.
