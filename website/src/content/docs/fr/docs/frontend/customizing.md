---
sourceHash: fb65c481c6cbc87a
title: Personnaliser l'administration
sidebar_label: Personnaliser l'administration
description: Comment personnaliser l'administration Rebase — blocs de construction, hooks et emplacements, avec des recettes testées pour les singletons, paramètres par utilisateur, actions groupées, vues calendrier, tableaux de bord et écrans de connexion personnalisés.
---

L'interface d'administration est constituée d'éléments que vous pouvez utiliser vous-même. Pour la personnaliser, écrivez un composant React classique et placez-le à un endroit dédié. C'est tout le modèle :

- **Blocs de construction** à afficher — le tableau d'une collection, le formulaire d'un enregistrement, le kit d'interface utilisateur (UI kit).
- **Hooks** pour les données, l'utilisateur connecté, les notifications (toasts) et la navigation.
- **Emplacements** où placer un composant — une page, un mode de vue de collection, un bouton de barre d'outils, un onglet d'enregistrement, un champ, un slot à côté d'un élément intégré, ou une surcharge (override) qui en remplace un.

Si un bloc de construction ne répond pas à vos besoins, copiez son code source dans votre projet et modifiez-le. Rien ici ne nécessite l'existence préalable d'une option de configuration. Voir [Copier un élément intégré](#copier-un-élément-intégré).

## Recettes

Des exemples fonctionnels et testés sont inclus dans `@rebasepro/cms`, ainsi ceux présents dans `node_modules/@rebasepro/cms/recipes` correspondent toujours à la version installée. Ils n'importent que des packages publics : copiez-en un dans votre projet tel quel.

| Recette | Ce qu'elle illustre |
|---|---|
| `site-settings.tsx` | Un singleton : un enregistrement de paramètres unique sur sa propre page, créé au premier enregistrement. |
| `my-preferences.tsx` | Paramètres par utilisateur : chaque utilisateur modifie l'enregistrement indexé par son uid. |
| `bulk-set-status.tsx` | Un bouton de barre d'outils qui met à jour toutes les lignes sélectionnées. |
| `calendar-view.tsx` | Un nouveau mode de vue : les lignes d'une collection affichées sur une grille mensuelle. |
| `orders-dashboard.tsx` | Une page qui lit des données, affiche un graphique et renvoie vers l'administration. |
| `custom-login.tsx` | Remplacement de l'écran de connexion. |

Le fichier `README.md` situé à côté constitue la référence complète des blocs de construction, hooks et emplacements.

## Exemple : un singleton

Un singleton n'est pas un type de collection spécial. Il s'agit d'une table ordinaire dont la page ouvre toujours la même ligne. Lorsqu'on lui fournit un identifiant, `EntityFormPanel` modifie cet enregistrement et le crée avec cet identifiant la première fois, évitant ainsi tout besoin d'initialisation (seeding).

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

La même structure avec `entityId={user.uid}` (issu de `useAuthController()`) constitue une page de paramètres par utilisateur.

## Emplacements

| Pour ajouter… | Placez un composant dans |
|---|---|
| Une page | `<RebaseCMS views={[{ slug, name, icon, view }]}>` |
| Un mode de vue pour une collection | `collectionViews={[{ key, name, Builder }]}` et `admin.customViews: ["key"]` — voir [Modes de vue](/docs/frontend/view-modes) |
| Un bouton dans la barre d'outils d'une collection | `admin.Actions: [Component]` |
| Un bouton sur un enregistrement | `admin.entityActions` — voir [Actions d'entité](/docs/frontend/entity-actions) |
| Un onglet sur un enregistrement | `admin.entityViews` — voir [Vues d'entité](/docs/frontend/entity-views) |
| La façon dont un champ est modifié ou affiché | `admin.Field` / `admin.Preview` — voir [Champs personnalisés](/docs/frontend/custom-fields) |
| Un élément à côté d'une partie intégrée | `<Rebase slots>` — voir [Slots](/docs/frontend/slots) |
| Un remplacement pour une partie intégrée | `<Rebase components>` — voir [Surcharges de composants](/docs/frontend/component-overrides) |

## Ce que chaque emplacement transmet à votre composant

| Emplacement | Votre composant reçoit |
|---|---|
| Une page (`views`) | Rien : lisez ce dont vous avez besoin avec les hooks. Elle s'affiche dans le routeur de l'administration, donc `useUrlController().navigate(…)` (ou `react-router`) fonctionne. |
| Un `Builder` de mode de vue | `CollectionCustomViewParams` : `collection`, `path`, `tableController` (son `data` contient les lignes que sélectionnent la recherche et les filtres de la barre d'outils, `dataLoading`, …), `onEntityClick(entity)` pour ouvrir une ligne comme la collection ouvre ses lignes, `selectionController`, `emptyComponent`. |
| `admin.Actions` | `CollectionActionsProps` : `path`, `collection`, `selectionController` (`hasSelection`, `selection`, `clearSelection()`), `tableController`, `openNewDocument(defaults?)`. Transformez `selection` en lignes avec `resolveSelection({ selection, accessor: useData().collection(path) })` — elle peut désigner « toutes les lignes correspondant au filtre », pas seulement celles qui sont cochées. |
| `Builder` de `admin.entityViews` | `EntityCustomViewParams` : `collection`, l'enregistrement (`entity`, absent pendant sa création), ses valeurs non enregistrées (`modifiedValues`) et le formulaire (`formContext`). |
| `"Auth.LoginView"` | `{ authController }`. Connectez-vous avec `authController.emailPasswordLogin?.(email, password)` (facultatif : présent lorsque la connexion par e-mail est activée) ; un échec lève une exception et figure aussi dans `authController.authProviderError`. Dès que `authController.user` est défini, l'administration remplace votre écran d'elle-même. |
| Toute autre surcharge | Les props de l'élément qu'elle remplace ; avec `wrap: true`, celles-ci plus `OriginalComponent`. |

## Hooks

| Hook | Package | Fournit |
|---|---|---|
| `useData` | `@rebasepro/app` | `useData().collection("orders").find / findById / create / update / delete`, via le serveur, afin que les callbacks et règles de sécurité s'appliquent. |
| `useCollection` / `useFetch` | `@rebasepro/app` | Une liste de lignes en direct / un enregistrement en direct. |
| `useAuthController` | `@rebasepro/app` | L'`user` connecté (uid, rôles), la connexion et la déconnexion. |
| `useSnackbarController` | `@rebasepro/app` | `open({ type, message })` pour un toast. |
| `useSidePanel` | `@rebasepro/cms` | Ouvrir n'importe quel enregistrement dans le panneau latéral. |
| `useUrlController` | `@rebasepro/cms` | Les URL d'administration et la navigation. |
| `resolveSelection` | `@rebasepro/cms` | Une sélection de table — lignes cochées ou « tous les résultats correspondants » — sous forme de lignes. |

## Copier un élément intégré

Lorsqu'un élément intégré est proche de ce que vous voulez, copiez son code source depuis le dépôt de `@rebasepro/cms` (ou `@rebasepro/app`) dans votre projet, faites pointer ses imports relatifs vers les paquets, modifiez-le et enregistrez-le sous son nom dans `<Rebase components>`. Tout ce qu'un élément importe est un export public, donc la copie compile — pour tous les éléments sauf trois, et ces trois-là sont délibérés :

- **`Collection.View`** assemble tous les modes de vue — liste, tableau, cartes, tableau kanban, vue scindée — avec l'édition en ligne, l'éditeur de champ en popup, la boîte de dialogue de suppression et l'état du mode de vue dans l'URL. Ce qu'elle importe, ce sont les rouages internes de ces modes. Remplacez plutôt l'un de ses éléments (`Collection.Table`, `Collection.Card`, `Collection.Actions`, `Collection.EmptyState`, qui se copient tous), ajoutez votre propre [mode de vue](/docs/frontend/view-modes), ou enveloppez-la avec `wrap: true`.
- **`DetailView`** assemble la vue d'un enregistrement : barre d'identité, onglets, inspecteur et boutons de la liste scindée, autour d'identifiants d'onglet qui sont des valeurs d'URL. Personnalisez un enregistrement avec les [vues d'entité](/docs/frontend/entity-views), les [actions d'entité](/docs/frontend/entity-actions), les [slots](/docs/frontend/slots) `form.*`, ou les surcharges `Entity.Form` et `EditView.FormActions`, qui se copient.
- **`HomePage`** se copie, à l'exception du réordonnancement des cartes et des groupes par glisser-déposer, qui n'a pas d'API propre à exporter. Une page d'accueil de votre cru assemble `NavigationGroup`, `NavigationCardBinding` et `FavouritesView` à partir de `useNavigationStateController().topLevelNavigation` ; pour ajouter quelque chose à la page standard, utilisez le slot `home.cards`.
