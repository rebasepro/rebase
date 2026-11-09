---
sourceHash: f28407f4fb9eb7a2
title: Personnaliser l'administration
sidebar_label: Personnaliser l'administration
description: Comment personnaliser l'administration de Rebase — blocs de construction, hooks et emplacements, avec des recettes testées pour les singletons, les paramètres par utilisateur, les actions groupées, les vues calendrier, les tableaux de bord et les écrans de connexion personnalisés.
---

L'administration est conçue à partir d'éléments que vous pouvez utiliser vous-même. Pour la personnaliser, vous écrivez un composant React ordinaire et vous le placez à un endroit précis. C'est tout le modèle :

- **Des blocs de construction** que vous affichez — le tableau d'une collection, le formulaire d'un enregistrement, le kit d'interface utilisateur.
- **Des hooks** pour les données, l'utilisateur connecté, les toasts et la navigation.
- **Des emplacements** où placer un composant — une page, un mode de vue de collection, un bouton de barre d'outils, un onglet d'enregistrement, un champ, un slot à côté d'un élément natif, ou une surcharge qui en remplace un.

Si un bloc de construction ne correspond pas à vos besoins, copiez son code source dans votre projet et modifiez-le — voir [Copier un élément natif](#copier-un-élément-natif). Rien ici n'exige l'existence préalable d'une option de configuration.

## Recettes

Des exemples fonctionnels et testés sont inclus dans `@rebasepro/cms`, ainsi ceux situés dans `node_modules/@rebasepro/cms/recipes` correspondent toujours à votre version installée. Ils importent uniquement des packages publics : copiez-en un dans votre projet tel quel.

| Recette | Ce qu'elle illustre |
|---|---|
| `site-settings.tsx` | Un singleton : un enregistrement de paramètres sur sa propre page, créé au premier enregistrement. |
| `my-preferences.tsx` | Paramètres par utilisateur : chaque utilisateur modifie l'enregistrement associé à son uid. |
| `bulk-set-status.tsx` | Un bouton de barre d'outils qui met à jour chaque ligne sélectionnée. |
| `calendar-view.tsx` | Un nouveau mode de vue : les lignes d'une collection affichées sur une grille mensuelle. |
| `orders-dashboard.tsx` | Une page qui lit des données, affiche un graphique et contient des liens vers l'administration. |
| `custom-login.tsx` | Le remplacement de l'écran de connexion. |

Le fichier `README.md` situé à côté constitue la référence complète des blocs de construction, hooks et emplacements.

## Exemple : un singleton

Un singleton n'est pas un type de collection particulier. Il s'agit d'une table ordinaire dont la page ouvre toujours la même ligne. Lorsqu'on lui fournit un id, `RecordForm` modifie cet enregistrement et le crée avec cet id la première fois, de sorte qu'aucune initialisation (seeding) n'est nécessaire.

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

La même structure avec `id={user.uid}` (issu de `useAuthController()`) constitue une page de paramètres par utilisateur.

Pour afficher uniquement certains champs, passez `fields={["siteName"]}`. Pour les organiser vous-même, passez `layout` avec des `<FormField name="…"/>` dans votre propre JSX. Dans les deux cas, le formulaire ne valide que ce qu'il affiche — voir [Panneaux dans votre propre page](/docs/frontend/panels).

## Emplacements

| Pour ajouter… | Placez un composant dans |
|---|---|
| Une page | `<RebaseCMS views={[{ slug, name, icon, view }]}>` |
| Un mode de vue pour une collection | `collectionViews={[{ key, name, Builder }]}` et `admin.customViews: ["key"]` — voir [Modes de vue](/docs/frontend/view-modes) |
| Un bouton dans la barre d'outils d'une collection | `admin.Actions: [Component]` |
| Un bouton sur un enregistrement | `admin.entityActions` — voir [Actions d'entité](/docs/frontend/entity-actions) |
| Un onglet sur un enregistrement | `admin.entityViews` — voir [Vues d'entité](/docs/frontend/entity-views) |
| La manière dont un champ est modifié ou affiché | `admin.Field` / `admin.Preview` — voir [Champs personnalisés](/docs/frontend/custom-fields) |
| Quelque chose à côté d'un élément natif | `<Rebase slots>` — voir [Slots](/docs/frontend/slots) |
| Un remplacement pour un élément natif | `<Rebase components>` — voir [Surcharges de composants](/docs/frontend/component-overrides) |

## Ce que chaque emplacement transmet à votre composant

| Emplacement | Votre composant reçoit |
|---|---|
| Une page (`views`) | Rien : lisez ce dont vous avez besoin à l'aide des hooks. Elle est rendue dans le routeur de l'administration, donc `useUrlController().navigate(…)` (ou `react-router`) fonctionne. |
| Un `Builder` de mode de vue | `CollectionCustomViewParams` : `collection`, `path`, `tableController` (ses `rows` sont les lignes sélectionnées par la recherche et les filtres de la barre d'outils, telles que le serveur les envoie ; `loading`, `error`, …), `onRowClick(row)` pour ouvrir une ligne de la même manière que la collection ouvre les lignes, `selectionController`, `highlightedIds` (ids sous forme de chaînes), `emptyComponent`. |
| `admin.Actions` | `CollectionActionsProps` : `path`, `collection`, `selectionController` (`hasSelection`, `selection`, `isSelected(id)`, `clearSelection()`), `tableController` (`rows`, et leurs `ids`), `openNewDocument(defaults?)`, `context`. Convertissez `selection` en lignes et leurs identifiants avec `const { rows, ids } = await resolveSelection({ selection, data: context.data, collection })` — cela peut représenter « toutes les lignes correspondant au filtre », et pas seulement celles cochées. |
| Un `Builder` d'`admin.entityViews` | `EntityCustomViewParams` : `collection`, l'enregistrement sauvegardé (`row`) et son identifiant (`id`), tous deux absents pendant sa création, ses valeurs non enregistrées (`modifiedValues`) et le formulaire (`formContext`). |
| `"Auth.LoginView"` | `{ authController }`. Connectez-vous avec `authController.emailPasswordLogin?.(email, password)` (facultatif : présent lorsque la connexion par e-mail est activée) ; un échec lève une exception et se trouve également dans `authController.authProviderError`. Dès que `authController.user` est défini, l'administration remplace automatiquement votre écran. |
| Toute autre surcharge | Les props de l'élément qu'elle remplace ; avec `wrap: true`, celles-ci ainsi que `OriginalComponent`. |

## Hooks

| Hook | Package | Vous fournit |
|---|---|---|
| `useRows` / `useRow` | `@rebasepro/app` | Une liste en direct des lignes / une ligne en direct, telles que le serveur les envoie. |
| `useRowWrites` | `@rebasepro/app` | `create / update / remove`, via le serveur, afin que les callbacks et les règles de sécurité s'appliquent. |
| `useRebaseContext` | `@rebasepro/app` | `context.data.collection("orders").find / findById / create / update / delete`, pour le code en dehors de l'état React ; les mêmes lignes, et des écritures qui exécutent les mêmes callbacks. |
| `useAuthController` | `@rebasepro/app` | L'`user` connecté (uid, rôles), la connexion et la déconnexion. |
| `useSnackbarController` | `@rebasepro/app` | `open({ type, message })` pour un toast. |
| `useSidePanel` | `@rebasepro/cms` | Ouvre n'importe quel enregistrement dans le panneau latéral. |
| `useUrlController` | `@rebasepro/cms` | Les URL et la navigation de l'administration. |
| `resolveSelection` | `@rebasepro/cms` | Une sélection de tableau — lignes cochées ou « all matching » — sous forme de lignes et de leurs identifiants : `const { rows, ids } = await resolveSelection({ selection, data: context.data, collection })`. |

## Copier un élément natif

Lorsqu'un élément natif est proche de ce que vous souhaitez, copiez son code source depuis le dépôt `@rebasepro/cms` (ou `@rebasepro/app`) dans votre projet, faites pointer ses imports relatifs vers les packages, modifiez-le et enregistrez-le sous son nom dans `<Rebase components>`. Tout ce qu'un élément importe est un export public, donc la copie compile — pour chaque élément à l'exception de trois, et ces trois exceptions sont délibérées :

- **`Collection.View`** est la composition de chaque mode de vue — liste, tableau, cartes, board, vue scindée — avec l'édition inline, l'éditeur de champ contextuel, la boîte de dialogue de suppression et l'état d'URL du mode de vue. Ce qu'il importe correspond aux composants internes de ces modes. Remplacez plutôt l'une de ses parties (`Collection.Table`, `Collection.Card`, `Collection.Actions`, `Collection.EmptyState`, qui sont toutes copiables), ajoutez votre propre [mode de vue](/docs/frontend/view-modes), ou enveloppez-le avec `wrap: true`.
- **`DetailView`** est la composition de la vue d'enregistrement : barre d'identité, onglets, inspecteur et boutons de la liste scindée, articulés autour d'identifiants d'onglets qui sont des valeurs d'URL. Personnalisez un enregistrement avec des [vues d'entité](/docs/frontend/entity-views), des [actions d'entité](/docs/frontend/entity-actions), les [slots](/docs/frontend/slots) `form.*`, ou les surcharges `Entity.Form` et `EditView.FormActions`, qui peuvent être copiées.
- **`HomePage`** se copie, à l'exception de sa réorganisation par glisser-déposer des cartes et des groupes, qui ne dispose pas de sa propre API exportable. Une page d'accueil personnalisée compose `NavigationGroup`, `NavigationCardBinding` et `FavouritesView` par-dessus `useNavigationStateController().topLevelNavigation` ; pour ajouter du contenu à celle par défaut, utilisez le slot `home.cards`.
