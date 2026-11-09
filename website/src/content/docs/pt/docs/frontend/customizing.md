---
sourceHash: f28407f4fb9eb7a2
title: Personalizando o Admin
sidebar_label: Personalizando o Admin
description: Como personalizar o admin do Rebase — blocos de construção, hooks e locais, com receitas testadas para singletons, configurações por usuário, ações em massa, visualizações de calendário, dashboards e telas de login personalizadas.
---

O admin é construído a partir de partes que você mesmo pode usar. Para personalizá-lo, você escreve um componente React comum e o coloca em um local. Esse é todo o modelo:

- **Blocos de construção** que você renderiza — a tabela de uma coleção, o formulário de um registro, o kit de UI.
- **Hooks** para dados, o usuário autenticado, toasts e navegação.
- **Locais** para colocar um componente — uma página, um modo de visualização de coleção, um botão da barra de ferramentas, uma aba de registro, um campo, um slot ao lado de uma parte integrada ou um override que substitui uma parte existente.

Se um bloco de construção não fizer o que você precisa, copie seu código-fonte para o seu projeto e altere-o — consulte [Copiando uma parte integrada](#copiando-uma-parte-integrada). Nada aqui precisa que uma opção de configuração exista previamente.

## Receitas

Exemplos funcionais e testados são fornecidos dentro de `@rebasepro/cms`, de modo que aqueles em `node_modules/@rebasepro/cms/recipes` sempre correspondem à sua versão instalada. Eles importam apenas pacotes públicos: copie um para o seu projeto como está.

| Receita | O que demonstra |
|---|---|
| `site-settings.tsx` | Um singleton: um único registro de configurações em sua própria página, criado no primeiro salvamento. |
| `my-preferences.tsx` | Configurações por usuário: cada usuário edita o registro identificado pelo seu uid. |
| `bulk-set-status.tsx` | Um botão da barra de ferramentas que atualiza todas as linhas selecionadas. |
| `calendar-view.tsx` | Um novo modo de visualização: as linhas de uma coleção em uma grade mensal. |
| `orders-dashboard.tsx` | Uma página que lê dados, desenha um gráfico e cria links para o admin. |
| `custom-login.tsx` | Substituição da tela de login. |

O `README.md` ao lado deles é a referência completa de blocos de construção, hooks e locais.

## Exemplo: um singleton

Um singleton não é um tipo especial de coleção. É uma tabela comum cuja página sempre abre a mesma linha. Ao receber um id, o `RecordForm` edita esse registro e o cria sob esse id na primeira vez, portanto nada precisa de seed.

```tsx
import React from "react";
import { defineCollection } from "@rebasepro/cms-types";
import type { AppView } from "@rebasepro/cms-types";
import { RecordForm } from "@rebasepro/cms";
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
            <RecordForm collection={siteSettingsCollection} id={"site"}/>
        </Container>
    )
};
```

A mesma estrutura com `id={user.uid}` (de `useAuthController()`) é uma página de configurações por usuário.

Para exibir apenas alguns dos campos, passe `fields={["siteName"]}`. Para organizá-los você mesmo, passe `layout` com `<FormField name="…"/>` no seu próprio JSX. De qualquer forma, o formulário valida apenas o que exibe — consulte [Painéis em uma página própria](/docs/frontend/panels).

## Locais

| Para adicionar… | Coloque um componente em |
|---|---|
| Uma página | `<RebaseCMS views={[{ slug, name, icon, view }]}>` |
| Um modo de visualização para uma coleção | `collectionViews={[{ key, name, Builder }]}` e `admin.customViews: ["key"]` — consulte [Modos de Visualização](/docs/frontend/view-modes) |
| Um botão na barra de ferramentas de uma coleção | `admin.Actions: [Component]` |
| Um botão em um registro | `admin.entityActions` — consulte [Entity Actions](/docs/frontend/entity-actions) |
| Uma aba em um registro | `admin.entityViews` — consulte [Entity Views](/docs/frontend/entity-views) |
| A forma como um campo é editado ou exibido | `admin.Field` / `admin.Preview` — consulte [Campos Personalizados](/docs/frontend/custom-fields) |
| Algo ao lado de uma parte integrada | `<Rebase slots>` — consulte [Slots](/docs/frontend/slots) |
| Uma substituição para uma parte integrada | `<Rebase components>` — consulte [Component Overrides](/docs/frontend/component-overrides) |

## O que cada local entrega ao seu componente

| Local | O que seu componente recebe |
|---|---|
| Uma página (`views`) | Nada: leia o que precisar com os hooks. Ela é renderizada dentro do roteador do admin, portanto `useUrlController().navigate(…)` (ou `react-router`) funciona. |
| O `Builder` de um modo de visualização | `CollectionCustomViewParams`: `collection`, `path`, `tableController` (suas `rows` são as linhas que a busca e os filtros da barra de ferramentas selecionam, conforme o servidor as envia; `loading`, `error`, …), `onRowClick(row)` para abrir uma linha da mesma forma que a coleção abre linhas, `selectionController`, `highlightedIds` (ids como strings), `emptyComponent`. |
| `admin.Actions` | `CollectionActionsProps`: `path`, `collection`, `selectionController` (`hasSelection`, `selection`, `isSelected(id)`, `clearSelection()`), `tableController` (`rows`, e seus `ids`), `openNewDocument(defaults?)`, `context`. Transforme `selection` em linhas e seus ids com `const { rows, ids } = await resolveSelection({ selection, data: context.data, collection })` — isso pode representar "todas as linhas correspondentes ao filtro", não apenas as marcadas. |
| O `Builder` de `admin.entityViews` | `EntityCustomViewParams`: `collection`, o registro salvo (`row`) e seu id (`id`), ambos ausentes enquanto ele estiver sendo criado, seus valores não salvos (`modifiedValues`) e o formulário (`formContext`). |
| `"Auth.LoginView"` | `{ authController }`. Faça login com `authController.emailPasswordLogin?.(email, password)` (opcional: presente quando o login por e-mail está habilitado); em caso de falha, um erro é lançado e também fica disponível em `authController.authProviderError`. Assim que `authController.user` for definido, o admin substitui sua tela automaticamente. |
| Qualquer outro override | As props da parte que ele substitui; com `wrap: true`, essas props mais `OriginalComponent`. |

## Hooks

| Hook | Pacote | O que fornece |
|---|---|---|
| `useRows` / `useRow` | `@rebasepro/app` | Uma lista em tempo real de linhas / uma linha em tempo real, conforme o servidor as envia. |
| `useRowWrites` | `@rebasepro/app` | `create / update / remove`, através do servidor, de modo que callbacks e regras de segurança sejam aplicados. |
| `useRebaseContext` | `@rebasepro/app` | `context.data.collection("orders").find / findById / create / update / delete`, para código fora do estado do React; as mesmas linhas e operações de escrita que executam os mesmos callbacks. |
| `useAuthController` | `@rebasepro/app` | O `user` autenticado (uid, roles), login e logout. |
| `useSnackbarController` | `@rebasepro/app` | `open({ type, message })` para um toast. |
| `useSidePanel` | `@rebasepro/cms` | Abre qualquer registro no painel lateral. |
| `useUrlController` | `@rebasepro/cms` | URLs e navegação do admin. |
| `resolveSelection` | `@rebasepro/cms` | Uma seleção de tabela — linhas marcadas ou "todas correspondentes" — como linhas e seus ids: `const { rows, ids } = await resolveSelection({ selection, data: context.data, collection })`. |

## Copiando uma parte integrada

Quando uma parte integrada for próxima do que você deseja, copie seu código-fonte do repositório `@rebasepro/cms` (ou `@rebasepro/app`) para o seu projeto, aponte seus imports relativos para os pacotes, faça as alterações necessárias e registre-a com seu respectivo nome em `<Rebase components>`. Tudo o que uma parte importa é um export público, portanto a cópia compila — para todas as partes, com exceção de três, e essas três são deliberadas:

- **`Collection.View`** é a composição de todos os modos de visualização — list, table, cards, board, split — com edição inline, o editor de campos em popup, a caixa de diálogo de exclusão e o estado de URL do modo de visualização. O que ele importa são os elementos internos desses modos. Em vez disso, substitua uma parte dele (`Collection.Table`, `Collection.Card`, `Collection.Actions`, `Collection.EmptyState`, os quais podem ser copiados), adicione um [modo de visualização](/docs/frontend/view-modes) próprio ou envolva-o com `wrap: true`.
- **`DetailView`** é a composição da visualização de registro: barra de identidade, abas, inspetor e os botões da lista dividida, em torno de ids de abas que são valores de URL. Personalize um registro com [entity views](/docs/frontend/entity-views), [entity actions](/docs/frontend/entity-actions), os [slots](/docs/frontend/slots) `form.*` ou os overrides `Entity.Form` e `EditView.FormActions`, que podem ser copiados.
- **`HomePage`** pode ser copiada, exceto pela reordenação drag-and-drop de cards e grupos, que não possui uma API própria para exportar. Uma página inicial própria compõe `NavigationGroup`, `NavigationCardBinding` e `FavouritesView` sobre `useNavigationStateController().topLevelNavigation`; para estender a página padrão, use o slot `home.cards`.
