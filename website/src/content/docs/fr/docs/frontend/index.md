---
sourceHash: 03d03e9fa055a194
title: Vue d'ensemble du frontend
sidebar_label: Frontend
description: Créez et personnalisez le panneau d'administration Rebase avec React — contrôleurs, échafaudage, routage et vues.
---

## Vue d'ensemble

Le frontend Rebase est un **framework React** qui rend votre panneau d'administration. Il lit vos définitions de collections et génère automatiquement les tableaux, formulaires, la navigation et le routage.

Dans le scaffold par défaut, le panneau d'administration **est** le frontend : il est servi à la racine de votre URL déployée. Si vous construisez plutôt votre propre app produit, vous pouvez monter l'administration sous un préfixe comme `/admin` dans le même déploiement — voir [Changer l'URL de base](/docs/getting-started/deployment#changing-the-base-url).

Les composants clés qui constituent un frontend Rebase :

```tsx
<Rebase
    client={rebaseClient}
    collectionRegistryController={collectionRegistryController}
    urlController={urlController}
    navigationStateController={navigationStateController}
    authController={authController}
>
    {({ loading }) => (
        <Scaffold>
            <AppBar />
            <Drawer title="Mon application" />
            <Outlet />
            <SideDialogs />
        </Scaffold>
    )}
</Rebase>
```

## Le Fournisseur Rebase

`<Rebase>` est le fournisseur racine qui rend toutes les fonctionnalités de Rebase disponibles aux composants enfants via le contexte. Il accepte :

| Prop | Description |
|------|-------------|
| `client` | Instance de `RebaseClient` pour les données, l'authentification et le stockage |
| `collectionRegistryController` | Résout les chemins et configurations des collections |
| `urlController` | Construit les URL et gère le routage |
| `navigationStateController` | Gère l'état de la navigation, les vues et les plugins |
| `authController` | État et méthodes d'authentification |
| `storageSource` | Opérations de stockage de fichiers |
| `userConfigPersistence` | Préférences d'interface utilisateur locales (largeur des colonnes, etc.) |
| `entityViews` | Onglets de vue d'entité personnalisée globaux |
| `entityActions` | Actions d'entité globales |
| `plugins` | Instances de plugin (propriété héritée — préférer le passage via le contrôleur de navigation) |

## Contrôleurs

Les contrôleurs sont des hooks React qui configurent des aspects spécifiques du framework :

### `useBuildNavigationStateController`

Le contrôleur principal qui relie tout :

```typescript
const data = useData();

const navigationStateController = useBuildNavigationStateController({
    collections: () => [...collections],  // Définitions de collections
    views: customViews,                   // Vues de navigation personnalisées
    plugins,                              // Instances de plugin
    authController,
    data,
    collectionRegistryController,
    urlController,
    adminMode: adminModeController.mode
});
```

### `useBuildCollectionRegistryController`

Gère la résolution des collections à partir des chemins d'URL :

```typescript
const collectionRegistryController = useBuildCollectionRegistryController({
    userConfigPersistence
});
```

### `useBuildUrlController`

Configure la génération d'URL :

```typescript
const urlController = useBuildUrlController({
    basePath: "/",
    baseCollectionPath: "/c",
    collectionRegistryController
});
```

### `useBuildModeController`

Gère le thème clair/sombre :

```typescript
const modeController = useBuildModeController();
// Fournit : modeController.mode ("light" | "dark"), modeController.toggleMode()
```

### `useBuildAdminModeController`

Bascule entre les modes Studio et Contenu :

```typescript
const adminModeController = useBuildAdminModeController();
// Fournit : adminModeController.mode ("studio" | "content")
```

## Composants de l'échafaudage

| Component | Description |
|-----------|-------------|
| `<Scaffold>` | Conteneur de mise en page principal avec barre latérale réactive |
| `<AppBar>` | Barre de navigation supérieure avec recherche, bascule de mode, menu utilisateur |
| `<Drawer>` | Navigation latérale avec liste de collections et liens de vue |
| `<SideDialogs>` | Conteneur pour les éditeurs d'entités du panneau latéral |
| `<RebaseRoutes>` | Conteneur de routage qui s'intègre avec React Router |
| `<RebaseRoute>` | Gère les routes de collection (`/c/*`) |
| `<ContentHomePage>` | Page d'accueil par défaut affichant des cartes de collection |
| `<StudioHomePage>` | Page d'accueil du mode Studio avec outils de développement |

## Vues personnalisées

Ajoutez des vues de navigation de premier niveau pour les tableaux de bord, les outils ou les pages personnalisées :

```tsx
const views: AppView[] = [
    {
        slug: "dashboard",
        name: "Tableau de bord",
        view: <MyDashboard />
    },
    {
        slug: "settings",
        name: "Paramètres de l'application",
        view: <AppSettings />,
        nestedRoutes: true  // Prend en charge les sous-chemins,
        admin: {
            icon: "dashboard",
            group: "Analyse",
            icon: "settings"
        }
    }
];

```

## Style

Rebase utilise **Tailwind CSS v4** et prend en charge les modes clair/sombre. Personnalisez via :

- **Propriétés CSS personnalisées** — Remplacez les jetons de design
- **`ModeControllerProvider`** — Contrôlez le mode clair/sombre
- **Configuration Tailwind** — Personnalisation Tailwind standard

```css
/* Remplacement des jetons de design */
:root {
    --font-sans: "Inter", sans-serif;
    --font-mono: "JetBrains Mono", monospace;
}
```

## Prochaines étapes

- **[Champs personnalisés](/docs/frontend/custom-fields)** — Créez des champs de formulaire personnalisés
- **[Vues d'entité](/docs/frontend/entity-views)** — Ajoutez des onglets aux éditeurs d'entités
- **[Modes d'affichage](/docs/frontend/view-modes)** — Liste, Tableau, Cartes, Kanban
- **[Plugins](/docs/plugins)** — Étendez le framework
---
