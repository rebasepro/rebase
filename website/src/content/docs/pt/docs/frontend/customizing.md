---
sourceHash: cfdbc982479ba3b1
title: Personalizando o Admin
sidebar_label: Personalizando o Admin
description: Como personalizar o admin do Rebase — blocos de construção, hooks e locais, com receitas testadas para singletons, configurações por usuário, ações em massa, visualizações de calendário, painéis e telas de login personalizadas.
---

O admin é construído a partir de partes que você mesmo pode usar. Para personalizá-lo,
você escreve um componente React comum e o coloca em um local. Esse é o modelo completo:

- **Blocos de construção** que você renderiza — a tabela de uma coleção, o formulário de um registro, o kit de UI.
- **Hooks** para dados, o usuário autenticado, toasts e navegação.
- **Locais** para colocar um componente — uma página, um modo de visualização de coleção, um botão de barra de ferramentas, uma aba de registro, um campo, um slot ao lado de uma parte nativa, ou um override que substitui uma.

Se um bloco de construção não fizer o que você precisa, copie seu código-fonte para o seu projeto
e altere-o. Nada aqui precisa que uma opção de configuração exista previamente.

## Receitas

Exemplos funcionais e testados acompanham o `@rebasepro/cms`, portanto, os exemplos em
`node_modules/@rebasepro/cms/recipes` sempre correspondem à sua versão instalada. Eles
importam apenas pacotes públicos: copie um para o seu projeto como está.

| Receita | O que demonstra |
|---|---|
| `site-settings.tsx` | Um singleton: um único registro de configurações em sua própria página, criado no primeiro salvamento. |
| `my-preferences.tsx` | Configurações por usuário: cada usuário edita o registro indexado pelo seu uid. |
| `bulk-set-status.tsx` | Um botão de barra de ferramentas que atualiza todas as linhas selecionadas. |
| `calendar-view.tsx` | Um novo modo de visualização: as linhas de uma coleção em uma grade mensal. |
| `orders-dashboard.tsx` | Uma página que lê dados, desenha um gráfico e vincula ao admin. |
| `custom-login.tsx` | Substituição da tela de login. |

O `README.md` ao lado deles é a referência completa de blocos de construção, hooks e locais.

## Exemplo: um singleton

Um singleton não é um tipo especial de coleção. É uma tabela comum cuja página
sempre abre a mesma linha. Ao receber um id, o `EntityFormPanel` edita esse registro
e o cria sob esse id na primeira vez, de modo que nenhum seeding é necessário.

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

A mesma estrutura com `entityId={user.uid}` (vindo de `useAuthController()`) é uma
página de configurações por usuário.

## Locais

| Para adicionar… | Coloque um componente em |
|---|---|
| Uma página | `<RebaseCMS views={[{ slug, name, icon, view }]}>` |
| Um modo de visualização para uma coleção | `collectionViews={[{ key, name, Builder }]}` e `admin.customViews: ["key"]` — consulte [Modos de Visualização](/docs/frontend/view-modes) |
| Um botão na barra de ferramentas de uma coleção | `admin.Actions: [Component]` |
| Um botão em um registro | `admin.entityActions` — consulte [Ações de Entidade](/docs/frontend/entity-actions) |
| Uma aba em um registro | `admin.entityViews` — consulte [Visualizações de Entidade](/docs/frontend/entity-views) |
| Como um campo é editado ou exibido | `admin.Field` / `admin.Preview` — consulte [Campos Personalizados](/docs/frontend/custom-fields) |
| Algo ao lado de uma parte nativa | `<Rebase slots>` — consulte [Slots](/docs/frontend/slots) |
| Uma substituição para uma parte nativa | `<Rebase components>` — consulte [Substituições de Componentes](/docs/frontend/component-overrides) |

## Hooks

| Hook | Pacote | Fornece |
|---|---|---|
| `useData` | `@rebasepro/app` | `useData().collection("orders").find / findById / create / update / delete`, por meio do servidor, para que callbacks e regras de segurança se apliquem. |
| `useCollection` / `useFetch` | `@rebasepro/app` | Uma lista de linhas em tempo real / um registro em tempo real. |
| `useAuthController` | `@rebasepro/app` | O `user` autenticado (uid, roles), login e logout. |
| `useSnackbarController` | `@rebasepro/app` | `open({ type, message })` para um toast. |
| `useSidePanel` | `@rebasepro/cms` | Abre qualquer registro no painel lateral. |
| `useUrlController` | `@rebasepro/cms` | URLs e navegação do admin. |
| `resolveSelection` | `@rebasepro/cms` | Uma seleção da tabela — linhas marcadas ou "todas correspondentes" — como linhas. |
