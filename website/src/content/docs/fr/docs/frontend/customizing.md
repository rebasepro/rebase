---
sourceHash: cfdbc982479ba3b1
title: Personnaliser l'administration
sidebar_label: Personnaliser l'administration
description: Comment personnaliser l'administration Rebase — blocs de construction, hooks et emplacements, avec des recettes testées pour les singletons, paramètres par utilisateur, actions groupées, vues calendrier, tableaux de bord et écrans de connexion personnalisés.
---

L'interface d'administration est constituée d'éléments que vous pouvez utiliser vous-même. Pour la personnaliser, écrivez un composant React classique et placez-le à un endroit dédié. C'est tout le modèle :

- **Blocs de construction** à afficher — le tableau d'une collection, le formulaire d'un enregistrement, le kit d'interface utilisateur (UI kit).
- **Hooks** pour les données, l'utilisateur connecté, les notifications (toasts) et la navigation.
- **Emplacements** où placer un composant — une page, un mode de vue de collection, un bouton de barre d'outils, un onglet d'enregistrement, un champ, un slot à côté d'un élément intégré, ou une surcharge (override) qui en remplace un.

Si un bloc de construction ne répond pas à vos besoins, copiez son code source dans votre projet et modifiez-le. Rien ici ne nécessite l'existence préalable d'une option de configuration.

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
