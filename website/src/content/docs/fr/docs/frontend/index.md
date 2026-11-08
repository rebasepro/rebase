---
sourceHash: 758100d13ca5c533
title: Vue d'ensemble du frontend
sidebar_label: Frontend
description: "Créez et personnalisez le panneau d'administration — Rebase CMS et Rebase Studio — avec React : contrôleurs, scaffold, routage et vues."
---

## Vue d'ensemble

Le frontend Rebase est un **framework React** qui affiche votre panneau d'administration. Il lit les définitions de vos collections et génère automatiquement les tables, formulaires, la navigation et le routage.

Dans le scaffold par défaut, le panneau d'administration **est** le frontend : il est servi à la racine de votre URL de déploiement. Si vous développez plutôt votre propre application produit, vous pouvez monter l'administration sous un préfixe tel que `/admin` au sein du même déploiement — voir [Modifier l'URL de base](/docs/getting-started/deployment#changing-the-base-url).

Voici `frontend/src/App.tsx` tel que généré par `rebase init`, sans ses imports de polices, son error boundary et son identifiant client Google — l'intégralité du panneau d'administration, quatre déclarations au sein d'un seul provider :

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

Les trois premiers composants n'affichent rien : ils *enregistrent* la configuration dans le provider. C'est `<RebaseShell>` qui effectue le rendu — il lit ce registre et construit la navigation, les routes et la mise en page à partir de celui-ci. L'ordre dans lequel ils apparaissent n'a donc pas d'importance, et ajouter une fonctionnalité revient à ajouter un composant, sans avoir à restructurer un arbre entier.

| Composant | Paquet | Enregistre |
|---|---|---|
| `<RebaseAuth>` | `@rebasepro/app` | l'écran de connexion (`loginView`) |
| `<RebaseCMS>` | `@rebasepro/cms` | les collections, les vues personnalisées, la page d'accueil, l'éditeur de collection |
| `<RebaseStudio>` | `@rebasepro/studio` | les outils pour développeurs (SQL, RLS, journaux, sauvegardes…) |
| `<RebaseShell>` | `@rebasepro/cms` | rien — il effectue le rendu de l'administration à partir de tout ce qui précède |

Supprimez `<RebaseStudio>` et vous obtenez un CMS dédié uniquement au contenu ; supprimez `<RebaseCMS>` et vous n'avez plus que les outils de développement. Pour concevoir la structure manuellement à la place, voir [Avancé : mise en page manuelle](#avancé--mise-en-page-manuelle).

## Le Provider Rebase

`<Rebase>` est le provider racine qui met toutes les fonctionnalités de Rebase à disposition des composants enfants via le contexte. Il accepte :

L'ensemble des vingt-trois props, dans leur intégralité — le tableau n'en listait auparavant que dix, dont deux n'étaient jamais lues par le composant :

<!-- rebase-props:start -->
| Prop | Description |
|------|-------------|
| `children` | Les composants racines de l'administration — `<RebaseCMS>`, `<RebaseStudio>`, `<RebaseShell>`. Une fonction de rendu sert d'échappatoire pour une mise en page manuelle. |
| `apiUrl` | URL de base de l'API backend, accessible à chaque hook via `useApiConfig()` |
| `dateTimeFormat` | Format d'affichage des dates. Valeur par défaut : `MMMM dd, yyyy, HH:mm:ss` |
| `locale` | Langue initiale de l'administration et locale utilisée pour formater les dates — voir [Traductions](/docs/frontend/i18n) |
| `client` | Instance de `RebaseClient` : la source par défaut pour les données, l'authentification et le stockage |
| `dataSources` | Sources de données supplémentaires, pour les collections qui en désignent une — voir [Sources multiples](/docs/backend/multiple-sources) |
| `authController` | État et méthodes d'authentification. Remplace directement la souscription `client.auth` |
| `storageSource` | La source de stockage par défaut, surchargeant `client.storage` |
| `storageSources` | Sources de stockage nommées en plus de celle par défaut |
| `databaseAdmin` | Opérations d'administration de la base de données (SQL, détection de schéma). Seul Studio en a besoin |
| `userConfigPersistence` | Préférences d'interface locales — largeurs de colonnes, groupes réduits |
| `onAnalyticsEvent` | Appelé pour chaque événement d'analytique émis par l'administration |
| `entityLinkBuilder` | `({ row, id, path }) => string` : l'URL pour le bouton "ouvrir dans votre application" sur un enregistrement, à partir de l'enregistrement tel que le serveur renvoie la ligne |
| `plugins` | Instances de plugins — voir [Plugins](/docs/plugins) |
| `slots` | Contributions d'emplacements (slots) déclarées directement, sans plugin |
| `propertyConfigs` | Widgets de champs personnalisés, indexés par le nom défini par une propriété dans `propertyConfig` |
| `entityViews` | Onglets de vue d'entité personnalisés, accessibles à toute collection mentionnant leur `key` dans `admin.entityViews` |
| `collectionViews` | Modes de vue de collection personnalisés, accessibles à toute collection par `key` |
| `entityActions` | Actions d'entité, accessibles à toute collection mentionnant leur `key` dans `admin.entityActions` |
| `effectiveRoleController` | Simuler un rôle différent lorsque le mode dev est activé |
| `modeController` | Transmettez à Rebase le mode clair/sombre de l'application hôte ; Rebase ne touche alors jamais à `<html>`, `prefers-color-scheme` ou au localStorage — voir [Style](#style) |
| `translations` | Remplacer ou étendre n'importe quelle chaîne de l'interface, indexée par locale — voir [Traductions](/docs/frontend/i18n) |
| `components` | Remplacer les composants intégrés — voir [Surcharges de composants](/docs/frontend/component-overrides) |
<!-- rebase-props:end -->

Les contrôleurs de navigation, d'URL et de registre de collections ne sont **pas** des props de `<Rebase>` — ils sont construits par les hooks ci-dessous et consommés à l'intérieur de l'arbre d'administration (`<RebaseShell>` les configure pour vous dans le scaffold par défaut).

Le préfixe d'URL ne l'est pas non plus. Lorsque l'administration est montée sous un chemin, cela se définit sur `<RebaseCMS basePath="/admin">`, qui se charge de faire correspondre les URL aux collections — et uniquement lorsque le routeur n'a pas de `basename` propre. Voir [Modifier l'URL de base](/docs/getting-started/deployment#changing-the-base-url).

## Un format de données unique

Votre code reçoit les lignes telles que le serveur les renvoie, quel que soit l'endroit où vous les demandez : `client.data`, `context.data` (dans un callback backend comme dans le navigateur), `useRows`, `useRow` et `useRowWrites`, le `data` des générateurs de collections et de vues, et ce qui est transmis aux `browserCallbacks` d'une collection. Une ligne est un objet plat : `row.title`, une date sous forme de chaîne ISO, une relation belongsTo sous forme de colonne de clé étrangère.

```tsx
// N'importe où, y compris en dehors de React.
const { data: posts } = await client.data.posts.find();
posts[0].title;

// Au sein de l'arbre <Rebase> : les mêmes lignes, maintenues à jour après chaque écriture.
const { rows } = useRows("posts");
rows[0].title;
```

L'administration elle-même effectue le rendu d'un modèle de vue `Entity` — le wrapper `id` / `path` / `values` dont s'inspirent ses vues de collection et ses formulaires, avec les dates sous forme d'instances `Date` et les relations sous forme d'une `EntityRelation`. Cette couche est propre à l'administration et ne fait pas partie de l'interface publique : une action d'entité, un résolveur d'affichage, le `tableController.rows` d'un `Builder` de mode de vue, la sélection d'une action de collection et un slot reçoivent tous des lignes brutes. Vous ne rencontrez `Entity` que dans une copie de l'une des parties intégrées de l'administration (`Collection.Table`, une carte), à laquelle est transmis l'enregistrement tel que l'administration l'affiche. Les valeurs d'un formulaire sont celles de l'éditeur : des `Date`s et des relations, telles qu'un champ les édite.

## Une collection ou un enregistrement dans votre propre page

Vous n'avez pas besoin de l'ensemble de l'administration pour afficher une simple table. `<CollectionPanel>`, `<EntityFormPanel>`, `<EntityViewPanel>` et `<FieldValue>` fonctionnent n'importe où sous `<Rebase>` et un routeur React Router, sans nécessiter `<RebaseCMS>`, `<RebaseNavigation>` ou `<RebaseShell>` : une collection avec les colonnes et la barre d'outils de votre choix, le formulaire d'un enregistrement avec seulement certains champs ou votre propre disposition, un enregistrement en lecture seule, ou une valeur affichée telle que l'administration la dessine. Voir [Panneaux dans votre propre page](/docs/frontend/panels).

## Avancé : mise en page manuelle

Tout ce qui suit remplace `<RebaseShell>`. Vous n'en avez besoin que lorsque la mise en page par défaut est gênante — un habillage différent autour de l'administration, votre propre arbre de routes, ou une application où l'administration n'est qu'une page parmi d'autres. Si vous ne remplacez pas la mise en page, passez directement à [Vues personnalisées](#vues-personnalisées).

`<RebaseShell>` n'est que du sucre syntaxique pour quatre couches, et vous pouvez les utiliser individuellement :

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

L'ordre est fixe : `RebaseAuthGate → RebaseNavigation → RebaseRouteDefs → RebaseLayout`. `RebaseAuthGate` affiche la vue de connexion tant qu'aucun utilisateur n'est connecté, de sorte que rien en dessous ne s'affiche pour un visiteur non authentifié ; `RebaseNavigation` construit les contrôleurs de navigation, d'URL et de registre de collections que lisent `RebaseRouteDefs` et chaque vue de collection. Utiliser `RebaseRouteDefs` en dehors provoquera donc une erreur.
Pour intégrer une vue de collection ou un formulaire d'enregistrement dans votre propre page sans les routes de l'administration, le composant plus léger `CollectionsProvider` construit ces contrôleurs à la place — voir [Panneaux dans votre propre page](/docs/frontend/panels).

Chaque couche est utilisable séparément. `<RebaseAuthGate>` seul protège votre propre application derrière l'authentification de Rebase. Remplacez `<RebaseLayout>` par votre propre composant pour conserver le routage tout en vous affranchissant de l'habillage ; supprimez également `<RebaseRouteDefs>` et vous construirez les routes vous-même à l'aide des composants listés dans [Composants de structure (Scaffold)](#composants-de-structure-scaffold).

À un niveau encore inférieur, `<Rebase>` accepte également une **render prop** à la place des enfants, ce qui vous donne accès au contexte ainsi qu'à l'indicateur de chargement, vous laissant le contrôle total de l'arbre :

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

À ce stade, rien n'est configuré automatiquement : vous devez instancier les contrôleurs ci-dessous manuellement et gérer vous-même le rendu des routes.

### Contrôleurs

Les contrôleurs sont des hooks React qui configurent des aspects spécifiques du framework. `<RebaseNavigation>` les appelle tous pour vous — n'y faites appel directement qu'au sein d'une render prop.

#### `useBuildNavigationStateController`

Le contrôleur principal qui orchestre l'ensemble :

Son paramètre `data` correspond à ce qui est transmis aux générateurs de collections et de vues : le `context.data` plat du `<Rebase>` parent (voir [Un format de données unique](#un-format-de-données-unique)), ce hook doit donc obligatoirement être appelé à l'intérieur de l'arbre `<Rebase>`.

```typescript
const { data } = useRebaseContext();

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

Gère le thème clair/sombre. Lorsqu'il est activé, il gère entièrement le thème de la page : il applique la classe `dark` sur `<html>`, suit `prefers-color-scheme` jusqu'à ce que l'utilisateur choisisse un mode, et mémorise ce choix dans le localStorage.

```typescript
const modeController = useBuildModeController();

modeController.mode;             // "light" | "dark"
modeController.setMode("dark");  // "light" | "dark" | "system" — "system" follows the OS again
```

`<Rebase>` en initialise un automatiquement.

Lorsque le composant qui l'utilise est démonté, il retire la classe `dark` qu'il avait ajoutée ; une classe `dark` déjà présente sur la page est quant à elle conservée. Ne créez votre propre contrôleur au-dessus de `<Rebase>` que si des composants extérieurs ont également besoin de connaître le mode, et transmettez-le via la [prop `modeController`](#style), afin de n'avoir qu'un seul contrôleur au lieu de deux. `useBuildModeController({ enabled: false })` crée un contrôleur inerte : il conserve `mode` dans l'état React sans toucher aux classes, aux media queries ou au localStorage. Lorsque votre application gère déjà son propre thème, vous n'avez pas du tout besoin de ce hook : transmettez simplement votre propre contrôleur comme `modeController`.

#### `useBuildAdminModeController`

Bascule entre les modes Studio et Contenu :

```typescript
const adminModeController = useBuildAdminModeController();
// Provides: adminModeController.mode ("cms" | "studio")
```

### Composants de structure (Scaffold)

| Composant | Description |
|-----------|-------------|
| `<Scaffold>` | Conteneur de mise en page principal avec barre latérale réactive |
| `<AppBar>` | Barre de navigation supérieure avec recherche, bascule de mode et menu utilisateur |
| `<Drawer>` | Navigation latérale contenant la liste des collections et les liens de vues |
| `<SideDialogs>` | Conteneur pour les éditeurs d'entités en panneaux latéraux |
| `<RebaseRoutes>` | Conteneur de routes s'intégrant avec React Router |
| `<RebaseRoute>` | Gère les routes des collections (`/c/*`) |
| `<ContentHomePage>` | Page d'accueil par défaut affichant les cartes de collections |
| `<StudioHomePage>` | Page d'accueil du mode Studio avec les outils de développement |

## Vues personnalisées

Ajoutez des vues de navigation de premier niveau pour des tableaux de bord, des outils ou des pages personnalisées. Un `AppView` est un objet plat — tout ce qui suit se trouve au premier niveau, sans bloc `admin` imbriqué :

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

Transmettez-les à `<RebaseCMS>`, aux côtés de vos collections — c'est le composant qui enregistre la navigation :

```tsx
<RebaseCMS collections={collections} views={views}/>
```

| Champ | |
|---|---|
| `slug` | le chemin où la vue est accessible, sous la racine de l'administration |
| `name` | le libellé dans le tiroir de navigation (drawer) et sur la page d'accueil |
| `view` | l'élément à afficher, ou un `ComponentType` pour un rendu différé (lazy) |
| `icon` | un nom d'icône [Lucide](https://lucide.dev/icons/), ex. `"ShoppingCart"` — ou tout nœud React |
| `group` | regroupe les vues dans le tiroir de navigation ; `"Admin"` et `"Settings"` sont relégués en bas |
| `pinToBottom` | relègue le groupe tout en bas quel que soit son nom — option à privilégier par rapport aux deux chaînes magiques |
| `nestedRoutes` | enregistre également `slug/*`, pour une vue possédant ses propres routes |
| `hideFromNavigation` | conserve la route, mais retire l'entrée de la navigation |
| `roles` | seuls les utilisateurs ayant l'un de ces rôles voient la vue ou peuvent y accéder |
| `description` | Markdown, affiché sur la carte de la page d'accueil |

Pour placer une vue sous **Studio** plutôt que dans le CMS, transmettez-la à [`<RebaseStudio devViews>`](/docs/studio#adding-your-own-tool).

## Style

Rebase utilise **Tailwind CSS v4** et prend en charge les modes clair et sombre. Personnalisez l'apparence via :

- **Propriétés personnalisées CSS** — Surchargez les design tokens
- **`<Rebase modeController>`** — Transmettez à Rebase le mode clair/sombre de votre application
- **Configuration Tailwind** — Personnalisation Tailwind standard

```css
/* Override design tokens */
:root {
    --font-sans: "Instrument Sans", sans-serif;
    --font-headers: "Instrument Sans", sans-serif;
    --font-mono: "JetBrains Mono", monospace;
}
```

### Mode clair et sombre

Par défaut, `<Rebase>` prend en charge le thème de la page : il applique la classe `dark` sur `<html>`, suit `prefers-color-scheme` jusqu'à ce que l'utilisateur sélectionne un mode dans l'administration, et conserve ce choix dans le localStorage.

Lorsque `<Rebase>` est démonté, il retire la classe `dark` qu'il a ajoutée ; une classe déjà présente sur la page reste inchangée. Sur la version 0.24, la classe reste en place.

Si votre application dispose déjà d'un thème, transmettez-le via `modeController`. Rebase y lira la propriété `mode`, appellera sa méthode `setMode` depuis son propre sélecteur de thème, et ne modifiera jamais `<html>`, `prefers-color-scheme` ou le localStorage :

```tsx
import { useEffect, useMemo, useState } from "react";
import { Rebase, type ModeController } from "@rebasepro/app";

export function App() {
    const [mode, setMode] = useState<"light" | "dark">("light");
    const modeController = useMemo<ModeController>(() => ({
        mode,
        setMode: (next) => setMode(next === "dark" ? "dark" : "light")
    }), [mode]);

    // Your app applies the mode, as it does for the rest of the page.
    useEffect(() => {
        document.documentElement.classList.toggle("dark", mode === "dark");
    }, [mode]);

    return (
        <Rebase client={client} modeController={modeController}>
            <MyAdmin/>
        </Rebase>
    );
}
```

Le CSS du scaffold applique les styles du mode sombre sous tout élément portant la classe `dark` (`@custom-variant dark (&:where(.dark, .dark *))`). Les panneaux latéraux, boîtes de dialogue et menus sont rendus dans un portail sur `<body>`, veillez donc à appliquer la classe sur `<html>` ou `<body>` plutôt que sur un conteneur entourant `<Rebase>`.

Encapsuler `<Rebase>` dans un `ModeControllerProvider` ne fonctionne pas : `<Rebase>` fournit son propre contrôleur en interne. Sur la version 0.24, cette prop n'existe pas et il n'y a aucun moyen de transmettre le mode de votre application à `<Rebase>`.

## Étapes suivantes

- **[Champs personnalisés](/docs/frontend/custom-fields)** — Créer des champs de formulaire sur mesure
- **[Vues d'entité](/docs/frontend/entity-views)** — Ajouter des onglets aux éditeurs d'entités
- **[Modes de vue](/docs/frontend/view-modes)** — Liste, Table, Cartes, Kanban
- **[Traductions](/docs/frontend/i18n)** — Modifier une chaîne ou ajouter une langue
- **[Plugins](/docs/plugins)** — Étendre le framework
