---
sourceHash: 362c7b70fede8ad5
title: Personnaliser l'administration
sidebar_label: Personnaliser l'administration
description: Comment personnaliser l'administration Rebase — blocs de construction, hooks et emplacements, avec des recettes testées pour les singletons, les paramètres par utilisateur, les actions groupées, les vues calendrier, les tableaux de bord et les écrans de connexion personnalisés.
---

<span class="since-badge" data-since="0.31">Depuis la version 0.31</span>

L'interface d'administration est construite à partir d'éléments que vous pouvez vous-même utiliser. Pour la personnaliser, vous écrivez un composant React classique et vous le placez à un endroit spécifique. C'est tout le modèle :

- Des **blocs de construction** à afficher — la table d'une collection, le formulaire d'un enregistrement, le kit d'interface utilisateur (UI kit).
- Des **hooks** pour les données, l'utilisateur connecté, les notifications toast et la navigation.
- Des **emplacements** où placer un composant — une page, un mode de vue, un bouton de barre d'outils, un onglet d'enregistrement, un champ, un slot à côté d'un élément intégré, ou une surcharge qui en remplace un.

Si un bloc de construction ne répond pas entièrement à vos besoins, copiez son code source dans votre projet et modifiez-le — voir [Copier un élément intégré](#copier-un-élément-intégré). Rien ici ne nécessite qu'une option de configuration existe au préalable. Les emplacements spécifiques à une table sont des options de [`customizeTable`](/docs/frontend/customize-table/).

## Recettes

Des exemples fonctionnels et testés sont intégrés dans `@rebasepro/cms`, de sorte que ceux situés dans `node_modules/@rebasepro/cms/recipes` correspondent toujours à votre version installée. Ils importent uniquement des paquets publics : copiez-en un dans votre projet tel quel.

| Recette | Ce qu'elle illustre |
|---|---|
| `site-settings.tsx` | Un singleton : un enregistrement de paramètres unique sur sa propre page, créé lors du premier enregistrement. |
| `my-preferences.tsx` | Paramètres par utilisateur : chaque utilisateur modifie l'enregistrement indexé par son uid. |
| `bulk-set-status.tsx` | Un bouton de barre d'outils qui met à jour toutes les lignes sélectionnées. |
| `calendar-view.tsx` | Un nouveau mode de vue : les lignes d'une collection affichées sur une grille mensuelle. |
| `orders-dashboard.tsx` | Une page qui lit les données, affiche un graphique et contient des liens vers l'administration. |
| `custom-login.tsx` | Le remplacement de l'écran de connexion. |

Le fichier `README.md` situé à côté constitue la référence complète des blocs de construction, hooks et emplacements.

## Exemple : un singleton

<span class="since-badge" data-since="0.31">Depuis la version 0.31</span>

Un singleton n'est pas un type de table spécial. C'est une table ordinaire dont la page ouvre toujours la même ligne. Lorsqu'on lui transmet un identifiant, `RecordForm` modifie cet enregistrement, et le crée avec cet identifiant la première fois, évitant ainsi tout besoin de pré-remplissage (seeding).

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

La même structure avec `id={user.uid}` (obtenu via `useAuthController()`) constitue une page de paramètres par utilisateur.

Pour n'afficher que certains champs, passez `fields={["siteName"]}`. Pour les organiser vous-même, passez `layout` avec des composants `<FormField name="…"/>` dans votre propre JSX. Dans les deux cas, le formulaire ne valide que ce qu'il affiche — voir [Panneaux dans votre propre page](/docs/frontend/panels).

## Emplacements

<span class="since-badge" data-since="0.31">Depuis la version 0.31</span>

| Pour ajouter… | Placez un composant dans |
|---|---|
| Une page | `<RebaseCMS views={[{ slug, name, icon, view }]}>` |
| Un mode de vue pour une table | `customViews` dans son `customizeTable`, ou `<RebaseCMS collectionViews>` et la clé — voir [Modes de vue personnalisés](/docs/frontend/extending#custom-view-modes) |
| Un bouton dans la barre d'outils d'une collection | `Actions: [Component]` dans `customizeTable` |
| Un bouton sur un enregistrement | `entityActions` dans `customizeTable` — voir [Actions d'entité](/docs/frontend/entity-actions) |
| Un onglet sur un enregistrement | `entityViews` dans `customizeTable` — voir [Vues d'entité](/docs/frontend/entity-views) |
| La façon dont un champ est modifié ou affiché | `Field` / `Preview` sur le champ dans `customizeTable` — voir [Champs personnalisés](/docs/frontend/custom-fields) |
| Quelque chose à côté d'un élément intégré | `<Rebase slots>` — voir [Slots](/docs/frontend/slots) |
| Un remplacement pour un élément intégré | `<Rebase components>` — voir [Surcharges de composants](/docs/frontend/component-overrides) |

## Ce que chaque emplacement fournit à votre composant

| Emplacement | Votre composant reçoit |
|---|---|
| Une page (`views`) | Rien : lisez ce dont vous avez besoin avec les hooks. Il s'affiche dans le routeur de l'administration, donc `useUrlController().navigate(…)` (ou `react-router`) fonctionne. |
| Un `Builder` de mode de vue | `CollectionCustomViewParams` : `collection`, `path`, `tableController` (ses `rows` sont les lignes sélectionnées par la recherche et les filtres de la barre d'outils, telles que le serveur les envoie ; `loading`, `error`, …), `onRowClick(row)` pour ouvrir une ligne de la même manière que la collection ouvre les lignes, `selectionController`, `highlightedIds` (identifiants sous forme de chaînes), `emptyComponent`. |
| `Actions` | `CollectionActionsProps` : `path`, `collection`, `selectionController` (`hasSelection`, `selection`, `isSelected(id)`, `clearSelection()`), `tableController` (`rows`, et leurs `ids`), `openNewDocument(defaults?)`, `context`. Convertissez `selection` en lignes et en leurs identifiants avec `const { rows, ids } = await resolveSelection({ selection, data: context.data, collection })` — cela peut représenter "toutes les lignes correspondant au filtre", et pas seulement celles qui sont cochées. |
| `Builder` de `entityViews` | `EntityCustomViewParams` : `collection`, l'enregistrement sauvegardé (`row`) et son identifiant (`id`), tous deux absents pendant sa création, ses valeurs non sauvegardées (`modifiedValues`) et le formulaire (`formContext`). |
| `"Auth.LoginView"` | `{ authController }`. Connectez-vous avec `authController.emailPasswordLogin?.(email, password)` (facultatif : présent lorsque la connexion par e-mail est activée) ; un échec lève une exception et est également accessible via `authController.authProviderError`. Une fois `authController.user` défini, l'administration remplace votre écran d'elle-même. |
| Toute autre surcharge | Les props de l'élément qu'elle remplace ; avec `wrap: true`, celles-ci ainsi que `OriginalComponent`. |

## Hooks

| Hook | Paquet | Vous fournit |
|---|---|---|
| `useRows` / `useRow` | `@rebasepro/app` | Une liste de lignes en direct / une seule ligne en direct, telle que le serveur les envoie. |
| `useRowWrites` | `@rebasepro/app` | `create / update / remove`, via le serveur, afin que les hooks de table et la sécurité au niveau des lignes (RLS) s'appliquent. |
| `useRebaseContext` | `@rebasepro/app` | `context.data.orders.find / findById / create / update / delete`, pour le code en dehors de l'état React ; les mêmes lignes, et des écritures qui exécutent les mêmes hooks. |
| `useAuthController` | `@rebasepro/app` | L'`user` connecté (uid, rôles), la connexion et la déconnexion. |
| `useSnackbarController` | `@rebasepro/app` | `open({ type, message })` pour une notification toast. |
| `useSidePanel` | `@rebasepro/cms` | Ouvre n'importe quel enregistrement dans le panneau latéral. |
| `useUrlController` | `@rebasepro/cms` | URL et navigation de l'administration. |
| `resolveSelection` | `@rebasepro/cms` | Une sélection de table — lignes cochées ou "toutes les correspondances" — sous forme de lignes et de leurs identifiants : `const { rows, ids } = await resolveSelection({ selection, data: context.data, collection })`. |

## Copier un élément intégré

Lorsqu'un élément intégré est proche de ce que vous souhaitez, copiez son code source depuis le dépôt `@rebasepro/cms` (ou `@rebasepro/app`) dans votre projet, faites pointer ses imports relatifs vers les paquets, modifiez-le, et enregistrez-le sous son nom dans `<Rebase components>`. Tout ce qu'un composant importe est un export public, donc la copie se compile — pour tous les éléments sauf trois, et cette exception est intentionnelle :

- **`Collection.View`** est la composition de chaque mode de vue — liste, table, cartes, tableau (board), vue fractionnée (split) — avec l'édition en ligne, l'éditeur de champ contextuel, la boîte de dialogue de suppression et l'état d'URL du mode de vue. Ce qu'il importe correspond aux détails internes de ces modes. Remplacez plutôt une de ses sous-parties (`Collection.Table`, `Collection.Card`, `Collection.Actions`, `Collection.EmptyState`, qui sont toutes copiables), ajoutez votre propre [mode de vue](/docs/frontend/view-modes), ou enveloppez-le avec `wrap: true`.
- **`DetailView`** est la composition de la vue d'enregistrement : barre d'identité, onglets, inspecteur et boutons de la liste fractionnée, autour d'identifiants d'onglets qui sont des valeurs d'URL. Personnalisez un enregistrement avec les [vues d'entité](/docs/frontend/entity-views), les [actions d'entité](/docs/frontend/entity-actions), les [slots](/docs/frontend/slots) `form.*`, ou les surcharges `Entity.Form` et `EditView.FormActions`, qui sont copiables.
- **`HomePage`** est copiable, à l'exception de sa logique de réorganisation par glisser-déposer des cartes et des groupes, qui ne dispose pas d'API propre à exporter. Une page d'accueil personnalisée compose `NavigationGroup`, `NavigationCardBinding` et `FavouritesView` par-dessus `useNavigationStateController().topLevelNavigation` ; pour ajouter des éléments à la page standard, utilisez le slot `home.cards`.
