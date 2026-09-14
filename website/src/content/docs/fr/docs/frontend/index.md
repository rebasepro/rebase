---
sourceHash: 6c59cbcf5c1ee91f
title: Vue d'ensemble du Frontend
sidebar_label: Frontend
description: "Créez et personnalisez le panneau d'administration — Rebase CMS et Rebase Studio — avec React : contrôleurs, structure (scaffold), routage et vues."
---

## Vue d'ensemble

Le frontend de Rebase est un **framework React** qui affiche votre panneau d'administration. Il lit les définitions de vos collections et génère automatiquement les tables, les formulaires, la navigation et le routage.

Dans la structure par défaut, le panneau d'administration **est** le frontend : il est servi à la racine de votre URL déployée. Si vous créez plutôt votre propre application produit, vous pouvez monter l'administration sous un préfixe tel que `/admin` dans le même déploiement — voir [Modifier l'URL de base](/docs/getting-started/deployment#changing-the-base-url).

Voici `frontend/src/App.tsx` tel que `rebase init` l'écrit — l'ensemble du panneau
d'administration, quatre déclarations au sein d'un seul provider :

```tsx
import React from "react";
import { Rebase, RebaseAuth, useRebaseAuthController } from "@rebasepro/app";
import { RebaseCMS, RebaseShell } from "@rebasepro/cms";
import { RebaseStudio } from "@rebasepro/studio";
import { createRebaseClient } from "@rebasepro/client";
import { collections } from "virtual:rebase-collections";

const client = createRebaseClient({
    baseUrl: import.meta.env.VITE_API_URL,
    auth: { authFlowMode: "cookie" }
});

export function App() {
    const authController = useRebaseAuthController({ client });

    return (
        <Rebase client={client} authController={authController}>
            {/* Sign-in screen. Pass `loginView` to replace it. */}
            <RebaseAuth/>
            <RebaseCMS collections={collections}/>
            <RebaseStudio/>
            <RebaseShell title="My App"/>
        </Rebase>
    );
}
```

Les trois premiers ne font aucun rendu : ils *enregistrent* la configuration dans le
provider. C'est `<RebaseShell>` qui dessine l'interface — il lit ce registre et construit la
navigation, les routes et la mise en page à partir de celui-ci. L'ordre dans lequel ils apparaissent n'a
donc pas d'importance, et ajouter une fonctionnalité revient à ajouter un composant, sans avoir à restructurer l'arborescence.

| Composant | Package | Enregistre |
|---|---|---|
| `<RebaseAuth>` | `@rebasepro/app` | l'écran de connexion (`loginView`) |
| `<RebaseCMS>` | `@rebasepro/cms` | les collections, les vues personnalisées, la page d'accueil, l'éditeur de collection |
| `<RebaseStudio>` | `@rebasepro/studio` | les outils de développement (SQL, RLS, journaux, sauvegardes…) |
| `<RebaseShell>` | `@rebasepro/cms` | rien — il affiche l'administration à partir de tout ce qui précède |

Supprimez `<RebaseStudio>` et vous obtenez un CMS dédié uniquement au contenu ; supprimez `<RebaseCMS>` et
vous n'avez que les outils de développement. Pour agencer le shell manuellement, consultez
[Avancé : mise en page manuelle](#avancé--mise-en-page-manuelle).

## Le Provider Rebase

`<Rebase>` est le provider racine qui rend toutes les fonctionnalités de Rebase disponibles pour les composants enfants via le contexte. Il accepte :

L'intégralité des vingt-deux propriétés — le tableau n'en listait auparavant que dix, dont deux
n'étaient même jamais lues par le composant :

<!-- rebase-props:start -->
| Prop | Description |
|------|-------------|
| `children` | Les composants racines de l'administration — `<RebaseCMS>`, `<RebaseStudio>`, `<RebaseShell>`. Une fonction de rendu sert d'échappatoire pour une mise en page manuelle. |
| `apiUrl` | URL de base de l'API backend, mise à disposition de chaque hook via `useApiConfig()` |
| `dateTimeFormat` | Format d'affichage des dates. Valeur par défaut : `MMMM dd, yyyy, HH:mm:ss` |
| `locale` | Langue initiale de l'administration, et locale dans laquelle les dates sont formatées — voir [Traductions](/docs/frontend/i18n) |
| `client` | Instance de `RebaseClient` : la source par défaut pour les données, l'authentification et le stockage |
| `dataSources` | Sources de données supplémentaires, pour les collections qui en désignent une — voir [Sources multiples](/docs/backend/multiple-sources) |
| `authController` | État et méthodes d'authentification. Remplace purement et simplement la souscription à `client.auth` |
| `storageSource` | Source de stockage par défaut, remplaçant `client.storage` |
| `storageSources` | Sources de stockage nommées au-delà de la source par défaut |
| `databaseAdmin` | Opérations administratives sur la base de données (SQL, découverte de schéma). Seul Studio en a besoin |
| `userConfigPersistence` | Préférences locales de l'interface — largeurs de colonnes, groupes repliés |
| `onAnalyticsEvent` | Appelé pour chaque événement d'analytics émis par l'administration |
| `entityLinkBuilder` | Retourne une URL pour le bouton « ouvrir dans votre application » sur un formulaire d'entité |
| `plugins` | Instances de plugins — voir [Plugins](/docs/plugins) |
| `slots` | Contributions de slots déclarées directement, sans plugin |
| `propertyConfigs` | Widgets de champs personnalisés, indexés par le nom spécifié par une propriété dans `propertyConfig` |
| `entityViews` | Onglets de vue d'entité personnalisés globaux |
| `collectionViews` | Modes de vue de collection personnalisés, accessibles à toute collection par `key` |
| `entityActions` | Actions globales d'entité |
| `effectiveRoleController` | Simuler un rôle différent lorsque le mode dev est activé |
| `translations` | Remplacer ou étendre n'importe quelle chaîne de l'interface, indexée par locale — voir [Traductions](/docs/frontend/i18n) |
| `components` | Remplacer les composants intégrés — voir [Remplacements de composants](/docs/frontend/component-overrides) |
<!-- rebase-props:end -->

Les contrôleurs de navigation, d'URL et de registre de collections ne sont **pas** des
props de `<Rebase>` — ils sont construits par les hooks ci-dessous et consommés dans l'arbre d'administration
(`<RebaseShell>` les connecte pour vous dans la structure par défaut).

Le préfixe d'URL non plus. Lorsque l'administration est montée sous un chemin spécifique, cela se configure
sur `<RebaseCMS basePath="/admin">`, qui est l'élément qui résout les URL en collections —
et uniquement lorsque le routeur n'a pas son propre `basename`. Voir
[Modifier l'URL de base](/docs/getting-started/deployment#changing-the-base-url).

## Deux structures de données

Il existe deux couches de données, et elles ne sont **pas** interchangeables. Passer l'une
là où l'autre est attendue provoque une erreur de type ; il est donc utile de le savoir avant de
connecter manuellement un contrôleur.

| | Structure | Où l'obtenir | À quoi ressemble une ligne |
|---|---|---|---|
| **SDK** | `RebaseSdkData` — lignes plates | `client.data`, et `context.data` dans les callbacks backend | `row.title` |
| **Admin** | `RebaseData` — modèle de vue (view-model) `Entity` | `useData()`, à l'intérieur de l'arbre `<Rebase>` | `entity.values.title` |

La couche SDK est la surface publique et symétrique : identique sur le client frontend
et dans les callbacks backend. La couche `Entity` est le view-model de l'administration — elle ajoute
l'enveloppe `id` / `path` / `values` sur laquelle reposent le rendu des vues de collections et les formulaires.
`CollectionAccessor` et `FindResponse` lui appartiennent et sont marqués
`@internal` pour cette raison.

`<Rebase>` constitue la frontière entre les deux : il prend votre `client.data` plat et
l'enveloppe avec `wrapAsEntityData()` avant de le fournir en tant que `RebaseData` pour l'administration.
Vous ne l'appelez jamais vous-même — vous récupérez simplement la structure dont vous avez besoin
au bon endroit :

```tsx
// Flat rows — anywhere, including outside React.
const { data: posts } = await client.data.posts.find();
posts[0].title;

// Entity view-model — inside the <Rebase> tree only.
// `data.posts` also works at runtime; `collection()` is the typed accessor.
const data = useData();
const { data: entities } = await data.collection("posts").find();
entities[0].values.title;
```

## Avancé : mise en page manuelle

Tout ce qui suit remplace `<RebaseShell>`. Vous n'en avez besoin que si la mise en page
par défaut ne convient pas — un habillage différent autour de l'administration, votre propre
arborescence de routes, ou une application où l'administration n'est qu'une page parmi d'autres. Si vous ne
remplacez pas la mise en page, vous pouvez passer directement à [Vues personnalisées](#vues-personnalisées).

`<RebaseShell>` est un sucre syntaxique pour quatre couches, que vous pouvez utiliser une à une :

```tsx
<Rebase client={client} authController={authController}>
    <RebaseCMS collections={collections}/>
    <RebaseStudio/>

    {/* login screen until there is a user */}
    <RebaseAuthGate>
        {/* builds the navigation, URL and collection-registry controllers */}
        <RebaseNavigation>
            {/* the admin's routes, drawn inside the layout you pass */}
            <RebaseRouteDefs layout={<RebaseLayout title="My App"/>}/>
        </RebaseNavigation>
    </RebaseAuthGate>
</Rebase>
```

L'ordre est fixe : `RebaseAuthGate → RebaseNavigation → RebaseRouteDefs → RebaseLayout`.
`RebaseAuthGate` affiche la vue de connexion tant qu'aucun utilisateur n'est connecté, de sorte que
rien en dessous ne s'affiche pour un visiteur non authentifié ; `RebaseNavigation` construit
les contrôleurs de navigation, d'URL et de registre de collections lus par `RebaseRouteDefs`
et chaque vue de collection, de sorte qu'utiliser `RebaseRouteDefs` en dehors lèvera une exception.

Chaque couche est utilisable séparément. `<RebaseAuthGate>` seul protège votre propre application
derrière l'authentification de Rebase. Remplacez `<RebaseLayout>` par votre propre composant pour conserver le
routage tout en changeant l'habillage ; supprimez également `<RebaseRouteDefs>` et vous construirez
vous-même les routes à partir des composants décrits dans
[Composants de structure (Scaffold)](#composants-de-structure-scaffold).

En dessous de ce niveau, `<Rebase>` accepte également une **render prop** au lieu d'enfants,
ce qui vous transmet le contexte ainsi que l'indicateur de chargement et vous laisse le contrôle total de l'arbre :

```tsx
<Rebase client={rebaseClient} authController={authController}>
    {({ context, loading }) => (
        <Scaffold>
            <AppBar/>
            <Drawer title="My App"/>
            <Outlet/>
            <SideDialogs/>
        </Scaffold>
    )}
</Rebase>
```

À ce stade, rien n'est connecté pour vous : vous construisez manuellement les contrôleurs
ci-dessous et assurez vous-même le rendu des routes.

### Contrôleurs

Les contrôleurs sont des hooks React qui configurent des aspects spécifiques du framework.
`<RebaseNavigation>` les appelle tous pour vous — ne recourez à ceux-ci qu'au sein d'une
render prop.

#### `useBuildNavigationStateController`

Le contrôleur principal qui relie l'ensemble :

Son paramètre `data` correspond au `RebaseData` au **format Entity**, il provient donc de `useData()`
— et non de `rebaseClient.data`, qui correspond à la couche SDK en lignes plates. `<Rebase>`
convertit l'un en l'autre pour vous (voir [Deux structures de données](#deux-structures-de-données)
ci-dessous), ce hook doit donc être appelé à l'intérieur de l'arbre `<Rebase>`.

```typescript
const data = useData();

const navigationStateController = useBuildNavigationStateController({
    collections: () => [...collections],  // Collection definitions
    views: customViews,                   // Custom navigation views
    plugins,                              // Plugin instances
    authController,
    data,
    collectionRegistryController,
    urlController,
    adminMode: adminModeController.mode
});
```

#### `useBuildCollectionRegistryController`

Gère la façon dont les collections sont résolues à partir des chemins d'URL :

```typescript
const collectionRegistryController = useBuildCollectionRegistryController({
    userConfigPersistence
});
```

#### `useBuildUrlController`

Configure la génération d'URL :

```typescript
const urlController = useBuildUrlController({
    basePath: "/",
    baseCollectionPath: "/c",
    collectionRegistryController
});
```

#### `useBuildModeController`

Gère le thème clair/sombre :

```typescript
const modeController = useBuildModeController();
// Provides: modeController.mode ("light" | "dark"), modeController.toggleMode()
```

#### `useBuildAdminModeController`

Bascule entre les modes Studio et Contenu :

```typescript
const adminModeController = useBuildAdminModeController();
// Provides: adminModeController.mode ("cms" | "studio")
```

### Composants de structure (Scaffold)

| Composant | Description |
|-----------|-------------|
| `<Scaffold>` | Conteneur de mise en page principal avec barre latérale responsive |
| `<AppBar>` | Barre de navigation supérieure avec recherche, bascule de mode, menu utilisateur |
| `<Drawer>` | Navigation latérale avec liste des collections et liens vers les vues |
| `<SideDialogs>` | Conteneur pour les éditeurs d'entités en panneau latéral |
| `<RebaseRoutes>` | Conteneur de routes s'intégrant avec React Router |
| `<RebaseRoute>` | Gère les routes des collections (`/c/*`) |
| `<ContentHomePage>` | Page d'accueil par défaut affichant les cartes des collections |
| `<StudioHomePage>` | Page d'accueil du mode Studio avec les outils de développement |

## Vues personnalisées

Ajoutez des vues de navigation de premier niveau pour des tableaux de bord, des outils ou des pages personnalisées. Un
`AppView` est un objet plat — tout ce qui suit se trouve au niveau racine, il n'y a pas de
bloc `admin` imbriqué :

```tsx
import type { AppView } from "@rebasepro/cms-types";

const views: AppView[] = [
    {
        slug: "dashboard",
        name: "Dashboard",
        icon: "LayoutDashboard",
        view: <MyDashboard/>
    },
    {
        slug: "settings",
        name: "App Settings",
        icon: "Settings",
        group: "Admin",
        // Register `settings/*` too, so the view can route inside itself.
        nestedRoutes: true,
        // Reachable by URL, but not listed in the drawer.
        hideFromNavigation: true,
        view: <AppSettings/>
    }
];
```

Transmettez-les à `<RebaseCMS>`, aux côtés de vos collections — c'est le composant
qui enregistre la navigation :

```tsx
<RebaseCMS collections={collections} views={views}/>
```

| Champ | |
|---|---|
| `slug` | le chemin auquel elle est accessible, sous la racine de l'administration |
| `name` | le libellé dans le panneau latéral (drawer) et sur la page d'accueil |
| `view` | l'élément à afficher, ou un `ComponentType` pour un chargement différé |
| `icon` | un nom d'icône [Lucide](https://lucide.dev/icons/), ex. `"ShoppingCart"` — ou n'importe quel nœud |
| `group` | regroupe les vues dans le panneau latéral ; `"Admin"` et `"Settings"` sont relégués en bas |
| `pinToBottom` | place le groupe tout en bas quel que soit son nom — à privilégier par rapport aux deux chaînes magiques |
| `nestedRoutes` | enregistre également `slug/*`, pour une vue ayant ses propres routes internes |
| `hideFromNavigation` | conserve la route, mais masque l'entrée dans le menu de navigation |
| `roles` | seuls les utilisateurs possédant l'un de ces rôles voient la vue ou peuvent y accéder |
| `description` | Markdown, affiché sur la carte de la page d'accueil |

Pour placer une vue dans le **Studio** plutôt que dans le CMS, passez-la à
[`<RebaseStudio devViews>`](/docs/studio#adding-your-own-tool).

## Styles

Rebase utilise **Tailwind CSS v4** et prend en charge les modes clair et sombre. Personnalisez via :

- **Propriétés personnalisées CSS (variables)** — Remplacer les design tokens
- **`ModeControllerProvider`** — Contrôler le mode clair/sombre
- **Configuration Tailwind** — Personnalisation Tailwind standard

```css
/* Override design tokens */
:root {
    --font-sans: "Instrument Sans", sans-serif;
    --font-headers: "Instrument Sans", sans-serif;
    --font-mono: "JetBrains Mono", monospace;
}
```

## Prochaines étapes

- **[Champs personnalisés](/docs/frontend/custom-fields)** — Créer des champs de formulaire personnalisés
- **[Vues d'entités](/docs/frontend/entity-views)** — Ajouter des onglets aux éditeurs d'entités
- **[Modes de vue](/docs/frontend/view-modes)** — Liste, Tableau, Cartes, Kanban
- **[Traductions](/docs/frontend/i18n)** — Modifier n'importe quelle chaîne ou ajouter une langue
- **[Plugins](/docs/plugins)** — Étendre le framework
