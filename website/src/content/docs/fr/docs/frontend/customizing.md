---
sourceHash: 31ccfe9d60f8eafe
title: Personnaliser l'administration
sidebar_label: Personnaliser l'administration
description: Comment personnaliser l'administration Rebase — blocs de construction, hooks et emplacements, avec des recettes testées pour les singletons, les paramètres par utilisateur, les actions groupées, les vues calendrier, les tableaux de bord et les écrans de connexion personnalisés.
---

L'interface d'administration est composée d'éléments que vous pouvez utiliser vous-même. Pour la personnaliser, écrivez simplement un composant React ordinaire et placez-le à un endroit dédié. C'est l'ensemble du modèle :

- **Blocs de construction** à afficher — la table d'une collection, le formulaire d'un enregistrement, le kit d'interface utilisateur.
- **Hooks** pour les données, l'utilisateur connecté, les notifications (toasts) et la navigation.
- **Emplacements** pour positionner un composant — une page, un mode de vue d'une collection, un bouton de barre d'outils, un onglet d'enregistrement, un champ, un slot à côté d'un élément intégré ou un remplacement (override) qui se substitue à l'un d'eux.

Si un bloc de construction ne répond pas à vos besoins, copiez son code source dans votre projet et modifiez-le — voir [Copier un élément intégré](#copying-a-built-in-part). Rien ici ne nécessite qu'une option de configuration existe au préalable.

## Recettes

Des exemples fonctionnels et testés sont fournis directement dans `@rebasepro/cms`, de sorte que ceux situés dans `node_modules/@rebasepro/cms/recipes` correspondent toujours à votre version installée. Ils n'importent que des packages publics : copiez-en un dans votre projet tel quel.

| Recette | Ce qu'elle illustre |
|---|---|
| `site-settings.tsx` | Un singleton : un enregistrement de paramètres unique sur sa propre page, créé lors du premier enregistrement. |
| `my-preferences.tsx` | Paramètres par utilisateur : chaque utilisateur modifie l'enregistrement indexé par son uid. |
| `bulk-set-status.tsx` | Un bouton de barre d'outils qui met à jour chaque ligne sélectionnée. |
| `calendar-view.tsx` | Un nouveau mode de vue : les lignes d'une collection sur une grille mensuelle. |
| `orders-dashboard.tsx` | Une page qui lit des données, trace un graphique et propose des liens vers l'administration. |
| `custom-login.tsx` | Le remplacement de l'écran de connexion. |

Le fichier `README.md` situé à côté constitue la référence complète des blocs de construction, des hooks et des emplacements.

## Exemple : un singleton

Un singleton n'est pas un type de collection spécial. Il s'agit d'une table ordinaire dont la page ouvre toujours la même ligne. `EntityFormPanel`, lorsqu'un id lui est fourni, modifie cet enregistrement et le crée sous cet id la première fois, sans nécessiter d'initialisation préalable.

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

La même structure avec `entityId={user.uid}` (provenant de `useAuthController()`) constitue une page de paramètres par utilisateur.

<span class="since-badge" data-since="0.29">Since 0.29</span> Pour afficher uniquement certains champs, transmettez `fields={["siteName"]}`. Pour les organiser vous-même, transmettez `layout` avec des balises `<FormField name="…"/>` dans votre propre JSX. Dans les deux cas, le formulaire ne valide que ce qu'il affiche — voir [Panels in a page of your own](/docs/frontend/panels).

## Emplacements

| Pour ajouter… | Placez un composant dans |
|---|---|
| Une page | `<RebaseCMS views={[{ slug, name, icon, view }]}>` |
| Un mode de vue pour une collection | `collectionViews={[{ key, name, Builder }]}` et `admin.customViews: ["key"]` — voir [View Modes](/docs/frontend/view-modes) |
| Un bouton dans la barre d'outils d'une collection | `admin.Actions: [Component]` |
| Un bouton sur un enregistrement | `admin.entityActions` — voir [Entity Actions](/docs/frontend/entity-actions) |
| Un onglet sur un enregistrement | `admin.entityViews` — voir [Entity Views](/docs/frontend/entity-views) |
| La manière dont un champ est modifié ou affiché | `admin.Field` / `admin.Preview` — voir [Custom Fields](/docs/frontend/custom-fields) |
| Quelque chose à côté d'un élément intégré | `<Rebase slots>` — voir [Slots](/docs/frontend/slots) |
| Un remplacement pour un élément intégré | `<Rebase components>` — voir [Component Overrides](/docs/frontend/component-overrides) |

## Ce que chaque emplacement fournit à votre composant

| Emplacement | Votre composant reçoit |
|---|---|
| Une page (`views`) | Rien : lisez ce dont vous avez besoin avec les hooks. Elle est rendue au sein du routeur de l'administration, donc `useUrlController().navigate(…)` (ou `react-router`) fonctionne. |
| Un `Builder` de mode de vue | `CollectionCustomViewParams` : `collection`, `path`, `tableController` (ses données `data` correspondent aux lignes sélectionnées par la recherche et les filtres de la barre d'outils, `dataLoading`, …), `onEntityClick(entity)` pour ouvrir une ligne comme la collection ouvre les lignes, `selectionController`, `emptyComponent`. |
| `admin.Actions` | `CollectionActionsProps` : `path`, `collection`, `selectionController` (`hasSelection`, `selection`, `clearSelection()`), `tableController`, `openNewDocument(defaults?)`. Convertissez `selection` en lignes avec `resolveSelection({ selection, accessor: useData().collection(path) })` — cela peut représenter « toutes les lignes correspondant au filtre », et pas seulement celles qui sont cochées. |
| Un `Builder` `admin.entityViews` | `EntityCustomViewParams` : `collection`, l'enregistrement (`entity`, absent pendant sa création), ses valeurs non enregistrées (`modifiedValues`) et le formulaire (`formContext`). |
| `"Auth.LoginView"` | `{ authController }`. Connectez-vous avec `authController.emailPasswordLogin?.(email, password)` (optionnel : présent lorsque la connexion par e-mail est activée) ; un échec lève une exception et se trouve également sur `authController.authProviderError`. Dès que `authController.user` est défini, l'administration remplace automatiquement votre écran. |
| Tout autre remplacement | Les props de l'élément qu'il remplace ; avec `wrap: true`, celles-ci plus `OriginalComponent`. |

## Hooks

| Hook | Package | Fournit |
|---|---|---|
| `useData` | `@rebasepro/app` | `useData().collection("orders").find / findById / create / update / delete`, via le serveur, afin que les callbacks et les règles de sécurité s'appliquent. |
| `useCollection` / `useFetch` | `@rebasepro/app` | Une liste de lignes en temps réel / un enregistrement en direct. |
| `useAuthController` | `@rebasepro/app` | L'`user` connecté (uid, rôles), la connexion et la déconnexion. |
| `useSnackbarController` | `@rebasepro/app` | `open({ type, message })` pour une notification (toast). |
| `useSidePanel` | `@rebasepro/cms` | Ouvrir n'importe quel enregistrement dans le panneau latéral. |
| `useUrlController` | `@rebasepro/cms` | Les URL et la navigation de l'administration. |
| `resolveSelection` | `@rebasepro/cms` | Une sélection de table — lignes cochées ou « toutes les correspondances » — sous forme de lignes. |

## Copier un élément intégré

Lorsqu'un élément intégré est proche de ce que vous souhaitez, copiez son code source depuis le dépôt `@rebasepro/cms` (ou `@rebasepro/app`) dans votre projet, faites pointer ses imports relatifs vers les packages, modifiez-le et enregistrez-le sous son nom dans `<Rebase components>`. Tout ce qu'un élément importe est un export public, de sorte que la copie compile — pour chaque élément à l'exception de trois, et ces trois exceptions sont délibérées :

- **`Collection.View`** est la composition de chaque mode de vue — liste, table, cartes, tableau (board), fractionné (split) — avec l'édition inline, l'éditeur de champ en popup, la boîte de dialogue de suppression et l'état de l'URL du mode de vue. Ce qu'il importe correspond aux composants internes de ces modes. Remplacez plutôt une partie de celui-ci (`Collection.Table`, `Collection.Card`, `Collection.Actions`, `Collection.EmptyState`, qui sont tous copiables), ajoutez votre propre [mode de vue](/docs/frontend/view-modes), ou enveloppez-le avec `wrap: true`.
- **`DetailView`** est la composition de la vue d'enregistrement : barre d'identité, onglets, inspecteur et boutons de la liste fractionnée, autour d'identifiants d'onglets qui sont des valeurs d'URL. Personnalisez un enregistrement à l'aide de [vues d'entité](/docs/frontend/entity-views), d'[actions d'entité](/docs/frontend/entity-actions), des [slots](/docs/frontend/slots) `form.*`, ou des remplacements `Entity.Form` et `EditView.FormActions`, qui sont copiables.
- **`HomePage`** se copie facilement, à l'exception de sa réorganisation par glisser-déposer de cartes et de groupes, qui ne possède pas d'API propre à exporter. Une page d'accueil personnalisée compose `NavigationGroup`, `NavigationCardBinding` et `FavouritesView` par-dessus `useNavigationStateController().topLevelNavigation` ; pour enrichir celle par défaut, utilisez le slot `home.cards`.
