---
sourceHash: 6ad8431f3a96e286
title: Personalizando o Admin
sidebar_label: Personalizando o Admin
description: Como personalizar o admin do Rebase — blocos de construção, hooks e locais, com receitas testadas para singletons, configurações por usuário, ações em massa, visualizações em calendário, painéis e telas de login personalizadas.
---

O admin é construído a partir de partes que você mesmo pode usar. Para personalizá-lo, você escreve
um componente React comum e o coloca em um local. Esse é todo o modelo:

- **Blocos de construção** que você renderiza — a tabela de uma coleção, o formulário de um registro, o kit de UI.
- **Hooks** para dados, o usuário autenticado, notificações (toasts) e navegação.
- **Locais** para colocar um componente — uma página, um modo de visualização de coleção, um botão de barra de ferramentas, uma aba de registro, um campo, um slot ao lado de uma parte nativa ou uma substituição (override) que substitui uma existente.

Se um bloco de construção não fizer o que você precisa, copie seu código-fonte para o seu projeto
e altere-o — consulte [Copiando uma parte nativa](#copiando-uma-parte-nativa). Nada
aqui precisa que uma opção de configuração exista previamente.

## Receitas

Exemplos funcionais e testados são distribuídos dentro de `@rebasepro/cms`, portanto, os que estão em
`node_modules/@rebasepro/cms/recipes` sempre correspondem à sua versão instalada. Eles
importam apenas pacotes públicos: copie um para o seu projeto como está.

| Receita | O que demonstra |
|---|---|
| `site-settings.tsx` | Um singleton: um único registro de configurações em sua própria página, criado no primeiro salvamento. |
| `my-preferences.tsx` | Configurações por usuário: cada usuário edita o registro identificado pelo seu uid. |
| `bulk-set-status.tsx` | Um botão na barra de ferramentas que atualiza todas as linhas selecionadas. |
| `calendar-view.tsx` | Um novo modo de visualização: as linhas de uma coleção em uma grade mensal. |
| `orders-dashboard.tsx` | Uma página que lê dados, renderiza um gráfico e inclui links para o admin. |
| `custom-login.tsx` | Substituição da tela de login. |

O `README.md` ao lado deles é a referência completa de blocos de construção, hooks e locais.

## Exemplo: um singleton

Um singleton não é um tipo especial de coleção. É uma tabela comum cuja página
sempre abre a mesma linha. O `EntityFormPanel`, ao receber um id, edita esse registro e
o cria sob esse id na primeira vez, de modo que nada precisa de seeding.

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
            <EntityFormPanel collection={siteSettingsCollection} id={"site"}/>
        </Container>
    )
};
```

A mesma estrutura com `id={user.uid}` (vindo de `useAuthController()`) é uma
página de configurações por usuário.

<span class="since-badge" data-since="0.29">Desde 0.29</span> Para exibir apenas alguns dos
campos, passe `fields={["siteName"]}`. Para organizá-los você mesmo, passe
`layout` com `<FormField name="…"/>` em seu próprio JSX. De qualquer forma, o formulário
valida apenas o que ele exibe — consulte
[Painéis em uma página própria](/docs/frontend/panels).

## Locais

| Para adicionar… | Coloque um componente em |
|---|---|
| Uma página | `<RebaseCMS views={[{ slug, name, icon, view }]}>` |
| Um modo de visualização para uma coleção | `collectionViews={[{ key, name, Builder }]}` e `admin.customViews: ["key"]` — consulte [Modos de Visualização](/docs/frontend/view-modes) |
| Um botão na barra de ferramentas de uma coleção | `admin.Actions: [Component]` |
| Um botão em um registro | `admin.entityActions` — consulte [Ações de Entidade](/docs/frontend/entity-actions) |
| Uma aba em um registro | `admin.entityViews` — consulte [Visualizações de Entidade](/docs/frontend/entity-views) |
| A forma como um campo é editado ou exibido | `admin.Field` / `admin.Preview` — consulte [Campos Personalizados](/docs/frontend/custom-fields) |
| Algo ao lado de uma parte nativa | `<Rebase slots>` — consulte [Slots](/docs/frontend/slots) |
| Uma substituição para uma parte nativa | `<Rebase components>` — consulte [Substituições de Componentes](/docs/frontend/component-overrides) |

## O que cada local passa para o seu componente

| Local | Seu componente recebe |
|---|---|
| Uma página (`views`) | Nada: leia o que precisar com os hooks. Ela é renderizada dentro do roteador do admin, então `useUrlController().navigate(…)` (ou `react-router`) funciona. |
| Um `Builder` de modo de visualização | `CollectionCustomViewParams`: `collection`, `path`, `tableController` (suas `rows` são as linhas que a busca e os filtros da barra de ferramentas selecionam, conforme o servidor as envia; `loading`, `error`, …), `onRowClick(row)` para abrir uma linha da mesma forma que a coleção abre linhas, `selectionController`, `highlightedIds` (ids como strings), `emptyComponent`. |
| `admin.Actions` | `CollectionActionsProps`: `path`, `collection`, `selectionController` (`hasSelection`, `selection`, `isSelected(id)`, `clearSelection()`), `tableController` (`rows`, e seus `ids`), `openNewDocument(defaults?)`, `context`. Transforme a `selection` em linhas e seus ids com `const { rows, ids } = await resolveSelection({ selection, data: context.data, collection })` — ela pode representar "todas as linhas correspondentes ao filtro", e não apenas as marcadas. |
| `Builder` de `admin.entityViews` | `EntityCustomViewParams`: `collection`, o registro salvo (`row`) e seu id (`id`), ambos ausentes enquanto ele está sendo criado, seus valores não salvos (`modifiedValues`) e o formulário (`formContext`). |
| `"Auth.LoginView"` | `{ authController }`. Faça login com `authController.emailPasswordLogin?.(email, password)` (opcional: presente quando o login por e-mail está habilitado); uma falha lança um erro e também fica disponível em `authController.authProviderError`. Assim que `authController.user` for definido, o admin substitui sua tela por conta própria. |
| Qualquer outro override | As props da parte que ele substitui; com `wrap: true`, essas props mais `OriginalComponent`. |

## Hooks

| Hook | Pacote | O que fornece |
|---|---|---|
| `useRows` / `useRow` | `@rebasepro/app` | Uma lista de linhas em tempo real / uma linha individual em tempo real, conforme enviadas pelo servidor. |
| `useRowWrites` | `@rebasepro/app` | `create / update / remove`, através do servidor, para que callbacks e regras de segurança sejam aplicados. |
| `useRebaseContext` | `@rebasepro/app` | `context.data.collection("orders").find / findById / create / update / delete`, para código fora do estado do React; as mesmas linhas e gravações que executam os mesmos callbacks. |
| `useAuthController` | `@rebasepro/app` | O `user` autenticado (uid, roles), login e logout. |
| `useSnackbarController` | `@rebasepro/app` | `open({ type, message })` para um toast. |
| `useSidePanel` | `@rebasepro/cms` | Abre qualquer registro no painel lateral. |
| `useUrlController` | `@rebasepro/cms` | URLs do admin e navegação. |
| `resolveSelection` | `@rebasepro/cms` | Uma seleção da tabela — linhas marcadas ou "todas correspondentes" — como linhas e seus ids: `const { rows, ids } = await resolveSelection({ selection, data: context.data, collection })`. |

## Copiando uma parte nativa

Quando uma parte nativa for parecida com o que você deseja, copie seu código-fonte do
repositório `@rebasepro/cms` (ou `@rebasepro/app`) para o seu projeto, aponte suas
importações relativas para os pacotes, faça as alterações necessárias e registre-a sob o seu nome em
`<Rebase components>`. Tudo o que uma parte importa é um export público, portanto a cópia
compila — para todas as partes, exceto três, e essas três são intencionais:

- **`Collection.View`** é a composição de todos os modos de visualização — list, table,
  cards, board, split — com edição inline, o editor de campo popup, o diálogo
  de exclusão e o estado de URL do modo de visualização. O que ela importa são os
  elementos internos desses modos. Em vez disso, substitua uma parte dela (`Collection.Table`,
  `Collection.Card`, `Collection.Actions`, `Collection.EmptyState`, que podem
  todas ser copiadas), adicione um [modo de visualização](/docs/frontend/view-modes) próprio, ou envolva-a
  com `wrap: true`.
- **`DetailView`** é a composição da visualização de registro: barra de identidade, abas,
  inspetor e os botões da lista dividida (split list), em torno de ids de abas que são valores de URL.
  Personalize um registro com [visualizações de entidade](/docs/frontend/entity-views),
  [ações de entidade](/docs/frontend/entity-actions), os [slots](/docs/frontend/slots) `form.*`,
  ou as substituições `Entity.Form` e `EditView.FormActions`, que podem ser copiadas.
- **`HomePage`** pode ser copiada, exceto por sua reordenação por arrastar e soltar (drag-and-drop) de cards e
  grupos, que não possui uma API própria para exportar. Uma página inicial própria
  compõe `NavigationGroup`, `NavigationCardBinding` e `FavouritesView` sobre
  `useNavigationStateController().topLevelNavigation`; para adicionar elementos à nativa,
  use o slot `home.cards`.
