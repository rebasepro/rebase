---
sourceHash: db22b88374775aed
title: Personnaliser l'administration
sidebar_label: Personnaliser l'administration
description: Comment personnaliser l'administration Rebase — blocs de construction, hooks et emplacements, avec des recettes testées pour les singletons, les paramètres par utilisateur, les actions groupées, les vues calendrier, les tableaux de bord et les écrans de connexion personnalisés.
---

L'administration est construite à partir d'éléments que vous pouvez utiliser vous-même. Pour la personnaliser, vous écrivez un composant React ordinaire et vous le positionnez dans un emplacement dédié. C'est tout le modèle :

- **Blocs de construction** que vous affichez — le tableau d'une collection, le formulaire d'un enregistrement, le kit UI.
- **Hooks** pour les données, l'utilisateur connecté, les toasts et la navigation.
- **Emplacements** où placer un composant — une page, un mode de vue de collection, un bouton de barre d'outils, un onglet d'enregistrement, un champ, un slot à côté d'un élément natif, ou une surcharge qui en remplace un.

Si un bloc de construction ne répond pas à vos besoins, copiez son code source dans votre projet et modifiez-le — voir [Copier un élément natif](#copier-un-composant-natif). Rien ici ne nécessite qu'une option de configuration existe au préalable.

## Recettes

Des exemples fonctionnels et testés sont inclus dans `@rebasepro/cms`, ainsi ceux situés dans `node_modules/@rebasepro/cms/recipes` correspondent toujours à votre version installée. Ils n'importent que des paquets publics : copiez-en un tel quel dans votre projet.

| Recette | Ce que cela montre |
|---|---|
| `site-settings.tsx` | Un singleton : un enregistrement de paramètres sur sa propre page, créé lors de la première sauvegarde. |
| `my-preferences.tsx` | Paramètres par utilisateur : chaque utilisateur modifie l'enregistrement associé à son uid. |
| `bulk-set-status.tsx` | Un bouton de barre d'outils qui met à jour chaque ligne sélectionnée. |
| `calendar-view.tsx` | Un nouveau mode de vue : les lignes d'une collection sur une grille mensuelle. |
| `orders-dashboard.tsx` | Une page qui lit des données, affiche un graphique et contient des liens vers l'administration. |
| `custom-login.tsx` | Remplacer l'écran de connexion. |

Le fichier `README.md` situé à côté constitue la référence complète des blocs de construction, des hooks et des emplacements.

## Exemple : un singleton

Un singleton n'est pas un type de collection particulier. Il s'agit d'une table ordinaire dont la page ouvre toujours la même ligne. Lorsqu'on lui transmet un identifiant, `EntityFormPanel` modifie cet enregistrement et le crée sous cet identifiant la première fois, de sorte qu'aucun seeding n'est nécessaire.

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

La même structure avec `id={user.uid}` (obtenu via `useAuthController()`) constitue une page de paramètres par utilisateur.

<span class="since-badge" data-since="0.29">Depuis 0.29</span> Pour n'afficher que certains champs, passez `fields={["siteName"]}`. Pour les organiser vous-même, passez `layout` avec des composants `<FormField name="…"/>` dans votre propre JSX. Dans les deux cas, le formulaire ne valide que ce qu'il affiche — voir [Panneaux dans votre propre page](/docs/frontend/panels).

## Emplacements

| Pour ajouter… | Placez un composant dans |
|---|---|
| Une page | `<RebaseCMS views={[{ slug, name, icon, view }]}>` |
| Un mode de vue pour une collection | `collectionViews={[{ key, name, Builder }]}` et `admin.customViews: ["key"]` — voir [Modes de vue](/docs/frontend/view-modes) |
| Un bouton dans la barre d'outils d'une collection | `admin.Actions: [Component]` |
| Un bouton sur un enregistrement | `admin.entityActions` — voir [Actions d'entité](/docs/frontend/entity-actions) |
| Un onglet sur un enregistrement | `admin.entityViews` — voir [Vues d'entité](/docs/frontend/entity-views) |
| La façon dont un champ est modifié ou affiché | `admin.Field` / `admin.Preview` — voir [Champs personnalisés](/docs/frontend/custom-fields) |
| Un élément à côté d'un composant natif | `<Rebase slots>` — voir [Slots](/docs/frontend/slots) |
| Un remplacement pour un composant natif | `<Rebase components>` — voir [Surcharges de composants](/docs/frontend/component-overrides) |

## Ce que chaque emplacement transmet à votre composant

| Emplacement | Votre composant reçoit |
|---|---|
| Une page (`views`) | Rien : lisez ce dont vous avez besoin avec les hooks. Elle est rendue à l'intérieur du routeur de l'administration, donc `useUrlController().navigate(…)` (ou `react-router`) fonctionne. |
| Un `Builder` de mode de vue | `CollectionCustomViewParams` : `collection`, `path`, `tableController` (ses `rows` sont les lignes sélectionnées par la recherche et les filtres de la barre d'outils, telles que le serveur les renvoie ; `loading`, `error`, …), `onRowClick(row)` pour ouvrir une ligne de la même manière que la collection ouvre les lignes, `selectionController`, `highlightedIds`, `emptyComponent`. |
| `admin.Actions` | `CollectionActionsProps` : `path`, `collection`, `selectionController` (`hasSelection`, `selection`, `isSelected(id)`, `clearSelection()`), `tableController` (`rows`), `openNewDocument(defaults?)`, `context`. Transformez `selection` en lignes avec `resolveSelection({ selection, data: context.data, collection })` — cela peut représenter « toutes les lignes correspondant au filtre », et pas seulement celles qui sont cochées. |
| Un `Builder` d'`admin.entityViews` | `EntityCustomViewParams` : `collection`, l'enregistrement (`entity`, absent pendant sa création), ses valeurs non enregistrées (`modifiedValues`) et le formulaire (`formContext`). |
| `"Auth.LoginView"` | `{ authController }`. Connectez-vous avec `authController.emailPasswordLogin?.(email, password)` (facultatif : présent lorsque la connexion par e-mail est activée) ; un échec lève une exception et est également accessible via `authController.authProviderError`. Dès que `authController.user` est défini, l'administration remplace automatiquement votre écran. |
| Toute autre surcharge | Les props de l'élément qu'elle remplace ; avec `wrap: true`, celles-ci ainsi que `OriginalComponent`. |

## Hooks

| Hook | Paquet | Vous fournit |
|---|---|---|
| `useRows` / `useRow` | `@rebasepro/app` | Une liste de lignes en direct / une ligne en direct, telles qu'envoyées par le serveur. |
| `useRowWrites` | `@rebasepro/app` | `create / update / remove`, via le serveur, pour que les callbacks et les règles de sécurité s'appliquent. |
| `useRebaseContext` | `@rebasepro/app` | `context.data.collection("orders").find / findById / create / update / delete`, pour le code en dehors de l'état React ; les mêmes lignes, et des écritures qui exécutent les mêmes callbacks. |
| `useAuthController` | `@rebasepro/app` | L'`user` connecté (uid, rôles), la connexion et la déconnexion. |
| `useSnackbarController` | `@rebasepro/app` | `open({ type, message })` pour une notification toast. |
| `useSidePanel` | `@rebasepro/cms` | Ouvre n'importe quel enregistrement dans le panneau latéral. |
| `useUrlController` | `@rebasepro/cms` | Les URLs et la navigation de l'administration. |
| `resolveSelection` | `@rebasepro/cms` | Une sélection de tableau — lignes cochées ou « toutes les correspondances » — sous forme de lignes : `resolveSelection({ selection, data: context.data, collection })`. |

## Copier un composant natif

Lorsqu'un élément natif est proche de ce que vous souhaitez, copiez son code source depuis le dépôt `@rebasepro/cms` (ou `@rebasepro/app`) dans votre projet, faites pointer ses imports relatifs vers les paquets, modifiez-le et enregistrez-le sous son nom dans `<Rebase components>`. Tout ce qu'un composant importe est un export public, la copie compile donc sans problème — pour chaque composant à l'exception de trois, et ces trois exceptions sont délibérées :

- **`Collection.View`** est la composition de chaque mode de vue — liste, tableau, cartes, board, split — avec l'édition inline, l'éditeur de champ en popup, la boîte de dialogue de suppression et l'état de l'URL du mode de vue. Ce qu'il importe correspond aux mécanismes internes de ces modes. Remplacez plutôt l'une de ses parties (`Collection.Table`, `Collection.Card`, `Collection.Actions`, `Collection.EmptyState`, qui peuvent toutes être copiées), ajoutez votre propre [mode de vue](/docs/frontend/view-modes), ou enveloppez-le avec `wrap: true`.
- **`DetailView`** est la composition de la vue d'enregistrement : barre d'identité, onglets, inspecteur et boutons de la liste partagée, autour des identifiants d'onglets qui sont des valeurs d'URL. Personnalisez un enregistrement avec les [vues d'entité](/docs/frontend/entity-views), les [actions d'entité](/docs/frontend/entity-actions), les [slots](/docs/frontend/slots) `form.*`, ou les surcharges `Entity.Form` et `EditView.FormActions`, qui peuvent être copiées.
- **`HomePage`** peut être copié à l'exception de sa réorganisation par glisser-déposer des cartes et des groupes, qui ne dispose pas d'API propre à exporter. Une page d'accueil personnalisée compose `NavigationGroup`, `NavigationCardBinding` et `FavouritesView` par-dessus `useNavigationStateController().topLevelNavigation` ; pour ajouter du contenu à celle par défaut, utilisez le slot `home.cards`.
