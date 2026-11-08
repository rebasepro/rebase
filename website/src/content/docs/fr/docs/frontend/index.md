---
sourceHash: f04fd00564e10891
title: Aperçu du Frontend
sidebar_label: Frontend
description: "Construisez et personnalisez le panneau d'administration — Rebase CMS et Rebase Studio — avec React : contrôleurs, scaffold, routage et vues."
---

## Vue d'ensemble

Le frontend de Rebase est un **framework React** qui effectue le rendu de votre panneau d'administration. Il lit les définitions de vos collections et génère automatiquement les tables, les formulaires, la navigation et le routage.

Dans le scaffold par défaut, le panneau d'administration **est** le frontend : il est servi à la racine de votre URL déployée. Si vous développez plutôt votre propre application produit, vous pouvez monter l'administration sous un préfixe tel que `/admin` au sein du même déploiement — voir [Modifier l'URL de base](/docs/getting-started/deployment#changing-the-base-url).

Voici `frontend/src/App.tsx` tel que généré par `rebase init`, sans ses imports de polices, son error boundary et son ID client Google — l'intégralité du panneau d'administration, quatre déclarations au sein d'un seul provider :

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

Les trois premiers composants n'affichent rien : ils *enregistrent* la configuration dans le provider. C'est `<RebaseShell>` qui se charge de l'affichage — il lit ce registre et construit la navigation, les routes et la mise en page à partir de celui-ci. L'ordre dans lequel ils apparaissent n'a donc pas d'importance, et ajouter une fonctionnalité revient à ajouter un composant, sans avoir à restructurer tout un arbre.

| Composant | Paquet | Enregistre |
|---|---|---|
| `<RebaseAuth>` | `@rebasepro/app` | l'écran de connexion (`loginView`) |
| `<RebaseCMS>` | `@rebasepro/cms` | les collections, les vues personnalisées, la page d'accueil, l'éditeur de collections |
| `<RebaseStudio>` | `@rebasepro/studio` | les outils de développement (SQL, RLS, logs, sauvegardes…) |
| `<RebaseShell>` | `@rebasepro/cms` | rien — il effectue le rendu de l'administration à partir de tout ce qui précède |

Retirez `<RebaseStudio>` et vous obtenez un CMS dédié uniquement au contenu ; retirez `<RebaseCMS>` et vous conservez uniquement les outils pour développeurs. Pour concevoir la structure du shell manuellement, voir [Avancé : mise en page manuelle](#advanced-manual-layout).

## Le provider Rebase

`<Rebase>` est le provider racine qui met l'ensemble des fonctionnalités de Rebase à la disposition des composants enfants via le contexte. Il accepte :

L'intégralité des vingt-trois propriétés — le tableau n'en listait auparavant que dix, et deux d'entre elles étaient des props que le composant ne lisait même jamais :

<!-- rebase-props:start -->
| Prop | Description |
|------|-------------|
| `children` | Les composants racines de l'administration — `<RebaseCMS>`, `<RebaseStudio>`, `<RebaseShell>`. Une fonction de rendu sert d'échappatoire pour une mise en page manuelle. |
| `apiUrl` | URL de base de l'API backend, accessible à chaque hook via `useApiConfig()` |
| `dateTimeFormat` | Format d'affichage des dates. Par défaut : `MMMM dd, yyyy, HH:mm:ss` |
| `locale` | Langue initiale de l'administration et locale utilisée pour le formatage des dates — voir [Traductions](/docs/frontend/i18n) |
| `client` | Instance de `RebaseClient` : la source par défaut pour les données, l'authentification et le stockage |
| `dataSources` | Sources de données supplémentaires, pour les collections qui en spécifient une — voir [Sources multiples](/docs/backend/multiple-sources) |
| `authController` | État et méthodes d'authentification. Remplace purement et simplement la souscription `client.auth` |
| `storageSource` | La source de stockage par défaut, surchargeant `client.storage` |
| `storageSources` | Sources de stockage nommées en plus de la source par défaut |
| `databaseAdmin` | Opérations administratives sur la base de données (SQL, découverte de schéma). Requis uniquement par Studio |
| `userConfigPersistence` | Préférences locales de l'interface — largeurs de colonnes, groupes réduits |
| `onAnalyticsEvent` | Appelé pour chaque événement d'analyse émis par l'administration |
| `entityLinkBuilder` | Retourne une URL pour le bouton « ouvrir dans votre application » sur un formulaire d'entité |
| `plugins` | Instances de plugins — voir [Plugins](/docs/plugins) |
| `slots` | Contributions de slots déclarées directement, sans plugin |
| `propertyConfigs` | Widgets de champs personnalisés, indexés par le nom qu'une propriété spécifie dans `propertyConfig` |
| `entityViews` | Onglets de vue d'entité personnalisés, disponibles pour toute collection spécifiant leur `key` dans `admin.entityViews` |
| `collectionViews` | Modes de vue de collection personnalisés, disponibles pour toute collection par leur `key` |
| `entityActions` | Actions d'entité, disponibles pour toute collection spécifiant leur `key` dans `admin.entityActions` |
| `effectiveRoleController` | Simule un rôle différent lorsque le mode dev est activé |
| `modeController` | Transmet le mode clair/sombre de l'application hôte à Rebase ; Rebase ne touche alors jamais à `<html>`, `prefers-color-scheme` ou localStorage — voir [Styles](#styling) |
| `translations` | Surcharge ou étend n'importe quelle chaîne de l'interface, indexée par locale — voir [Traductions](/docs/frontend/i18n) |
| `components` | Remplace des composants intégrés — voir [Surcharges de composants](/docs/frontend/component-overrides) |
<!-- rebase-props:end -->

Les contrôleurs de navigation, d'URL et de registre de collections ne sont **pas** des props de `<Rebase>` — ils sont créés par les hooks ci-dessous et consommés au sein de l'arborescence d'administration (`<RebaseShell>` les connecte pour vous dans le scaffold par défaut).

Le préfixe d'URL non plus. Lorsque l'administration est montée sous un chemin, celui-ci doit être configuré sur `<RebaseCMS basePath="/admin">`, qui se charge de résoudre les URL vers les collections — et uniquement si le routeur ne dispose pas de son propre `basename`. Voir [Modifier l'URL de base](/docs/getting-started/deployment#changing-the-base-url).

## Deux formats de données

Il existe deux couches de données, et elles ne sont **pas** interchangeables. Passer l'une là où l'autre est attendue provoque une erreur de type ; il est donc utile de le savoir avant de connecter un contrôleur à la main.

| | Format | Où l'obtenir | À quoi ressemble une ligne |
|---|---|---|---|
| **SDK** | `RebaseSdkData` — lignes plates | `client.data`, et `context.data` dans les callbacks backend | `row.title` |
| **Admin** | `RebaseData` — view-model `Entity` | `useData()`, dans l'arbre `<Rebase>` | `entity.values.title` |

La couche SDK est la surface publique et symétrique : identique sur le client frontend et dans les callbacks backend. La couche `Entity` est le view-model de l'administration — elle ajoute l'enveloppe `id` / `path` / `values` sur laquelle reposent les formulaires et les vues de collection. `CollectionAccessor` et `FindResponse` en font partie et sont marqués comme `@internal` pour cette raison.

`<Rebase>` constitue la frontière entre les deux : il prend vos données plates `client.data` et les enveloppe avec `wrapAsEntityData()` avant de les fournir sous forme de `RebaseData` à l'administration. Vous n'avez jamais à appeler cette fonction vous-même — il vous suffit de récupérer le format dont vous avez besoin au bon endroit :

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

## Une collection ou un enregistrement dans votre propre page

Vous n'avez pas besoin de l'ensemble de l'administration pour afficher une seule table. `<CollectionPanel>`, `<EntityFormPanel>`, `<EntityViewPanel>` et `<FieldValue>` fonctionnent n'importe où sous `<Rebase>` et un routeur React Router, sans `<RebaseCMS>`, `<RebaseNavigation>` ou `<RebaseShell>` : une collection avec les colonnes et la barre d'outils de votre choix, le formulaire d'un enregistrement avec seulement certains champs ou votre propre mise en page, un enregistrement en lecture seule, ou une valeur affichée telle que l'administration la présente. Voir [Panneaux dans votre propre page](/docs/frontend/panels).

## Avancé : mise en page manuelle

Tout ce qui suit remplace `<RebaseShell>`. Vous n'en avez besoin que si la mise en page par défaut est contraignante — un habillage différent autour de l'administration, votre propre arborescence de routes, ou une application où l'administration n'est qu'une page parmi d'autres. Si vous ne remplacez pas la mise en page, passez directement à [Vues personnalisées](#custom-views).

`<RebaseShell>` est un sucre syntaxique pour quatre couches, et vous pouvez les adopter une par une :

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

L'ordre est fixe : `RebaseAuthGate → RebaseNavigation → RebaseRouteDefs → RebaseLayout`. `RebaseAuthGate` affiche la vue de connexion tant qu'aucun utilisateur n'est connecté, afin que rien en dessous ne s'affiche pour un visiteur non authentifié ; `RebaseNavigation` construit les contrôleurs de navigation, d'URL et de registre de collections que lisent `RebaseRouteDefs` et chaque vue de collection, de sorte qu'un appel à `RebaseRouteDefs` en dehors de celui-ci lèvera une erreur. Pour intégrer une vue de collection ou un formulaire d'enregistrement dans votre propre page, sans les routes de l'administration, le composant plus léger `CollectionsProvider` construit ces contrôleurs à la place — voir [Panneaux dans votre propre page](/docs/frontend/panels).

Chaque couche peut être utilisée indépendamment. `<RebaseAuthGate>` à lui seul protège votre propre application derrière l'authentification de Rebase. Remplacez `<RebaseLayout>` par votre propre composant pour conserver le routage tout en vous affranchissant de l'habillage ; retirez également `<RebaseRouteDefs>` et vous construisez vous-même les routes à l'aide des composants présentés dans [Composants de scaffold](#scaffold-components).

À un niveau encore plus bas, `<Rebase>` accepte également une **render prop** au lieu d'enfants, ce qui vous fournit le contexte et l'indicateur de chargement tout en vous laissant l'entière responsabilité de l'arborescence :

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

À ce stade, rien n'est connecté pour vous : vous devez instancier les contrôleurs ci-dessous à la main et effectuer vous-même le rendu des routes.

### Contrôleurs

Les contrôleurs sont des hooks React qui configurent des aspects spécifiques du framework. `<RebaseNavigation>` les appelle tous pour vous — n'y faites appel que dans le cadre d'une render prop.

#### `useBuildNavigationStateController`

Le contrôleur principal qui connecte tous les éléments entre eux :

Sa propriété `data` correspond à `RebaseData` au **format Entity**, elle provient donc de `useData()` — et non de `rebaseClient.data`, qui est la couche SDK aux lignes plates. `<Rebase>` convertit l'une en l'autre pour vous (voir [Deux formats de données](#two-data-shapes) ci-dessous), ce hook doit donc être appelé à l'intérieur de l'arbre `<Rebase>`.

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

Configure la génération des URL :

```typescript
const urlController = useBuildUrlController({
    basePath: "/",
    baseCollectionPath: "/c",
    collectionRegistryController
});
```

#### `useBuildModeController`

Gère le thème clair/sombre. Lorsqu'il est activé, il prend le contrôle du thème de la page : il applique la classe `dark` sur `<html>`, suit `prefers-color-scheme` jusqu'à ce que l'utilisateur choisisse un mode, et mémorise ce choix dans le localStorage.

```typescript
const modeController = useBuildModeController();

modeController.mode;             // "light" | "dark"
modeController.setMode("dark");  // "light" | "dark" | "system" — "system" follows the OS again
```

`<Rebase>` en instancie un lui-même.

Lorsque le composant qui l'utilise est démonté, il supprime la classe `dark` qu'il avait ajoutée ; une classe `dark` déjà présente sur la page est conservée. Ne créez le vôtre en amont de `<Rebase>` que si des composants extérieurs ont également besoin du mode, et transmettez-le via la [prop `modeController`](#styling), afin de n'avoir qu'un seul contrôleur au lieu de deux. `useBuildModeController({ enabled: false })` crée un contrôleur inerte : il conserve `mode` dans l'état React sans toucher aux classes, aux media queries ou au localStorage. Lorsque votre application gère déjà son propre thème, vous n'avez pas du tout besoin de ce hook : passez simplement votre propre contrôleur en tant que `modeController`.

#### `useBuildAdminModeController`

Bascule entre les modes Studio et Contenu :

```typescript
const adminModeController = useBuildAdminModeController();
// Provides: adminModeController.mode ("cms" | "studio")
```

### Composants de scaffold

| Composant | Description |
|-----------|-------------|
| `<Scaffold>` | Conteneur principal de mise en page avec barre latérale responsive |
| `<AppBar>` | Barre de navigation supérieure avec recherche, bascule de mode, menu utilisateur |
| `<Drawer>` | Navigation latérale avec liste des collections et liens de vues |
| `<SideDialogs>` | Conteneur pour les éditeurs d'entités sous forme de panneaux latéraux |
| `<RebaseRoutes>` | Conteneur de routes s'intégrant à React Router |
| `<RebaseRoute>` | Gère les routes de collections (`/c/*`) |
| `<ContentHomePage>` | Page d'accueil par défaut affichant les cartes de collections |
| `<StudioHomePage>` | Page d'accueil du mode Studio avec les outils pour développeurs |

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

Transmettez-les à `<RebaseCMS>`, aux côtés de vos collections — c'est ce composant qui enregistre la navigation :

```tsx
<RebaseCMS collections={collections} views={views}/>
```

| Champ | |
|---|---|
| `slug` | le chemin d'accès sous la racine de l'administration |
| `name` | le libellé dans le tiroir de navigation et sur la page d'accueil |
| `view` | l'élément à afficher, ou un `ComponentType` pour un chargement différé |
| `icon` | un nom d'icône [Lucide](https://lucide.dev/icons/), ex. `"ShoppingCart"` — ou n'importe quel nœud React |
| `group` | regroupe les vues dans le tiroir de navigation ; `"Admin"` et `"Settings"` sont automatiquement placés en bas |
| `pinToBottom` | place le groupe tout en bas quel que soit son nom — à privilégier par rapport aux deux chaînes magiques |
| `nestedRoutes` | enregistre également `slug/*`, pour une vue disposant de ses propres routes |
| `hideFromNavigation` | conserve la route, mais masque l'entrée dans la navigation |
| `roles` | seuls les utilisateurs possédant l'un de ces rôles peuvent voir la vue ou y accéder |
| `description` | Markdown, affiché sur la carte de la page d'accueil |

Pour placer une vue sous **Studio** plutôt que sous le CMS, transmettez-la à [`<RebaseStudio devViews>`](/docs/studio#adding-your-own-tool).

## Styles

Rebase utilise **Tailwind CSS v4** et prend en charge les modes clair/sombre. Personnalisez via :

- **Propriétés personnalisées CSS** — Surchargez les design tokens
- **`<Rebase modeController>`** — Transmettez le mode clair/sombre de votre application à Rebase
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

Par défaut, `<Rebase>` gère le thème de la page : il applique la classe `dark` sur `<html>`, suit `prefers-color-scheme` jusqu'à ce que l'utilisateur sélectionne un mode dans l'administration, et mémorise ce choix dans le localStorage.

Lorsque `<Rebase>` est démonté, il supprime la classe `dark` qu'il avait ajoutée ; une classe que la page possédait déjà est conservée. En version 0.24, la classe reste en place.

Lorsque votre application dispose déjà d'un thème, transmettez-le via `modeController`. Rebase y lit la valeur `mode`, appelle sa fonction `setMode` depuis son propre sélecteur de thème, et ne modifie jamais `<html>`, `prefers-color-scheme` ou localStorage :

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

Le CSS du scaffold applique les styles du mode sombre sous tout élément portant la classe `dark` (`@custom-variant dark (&:where(.dark, .dark *))`). Les panneaux latéraux, boîtes de dialogue et menus s'affichent via un portail sur `<body>`, veillez donc à appliquer la classe sur `<html>` ou `<body>` plutôt que sur un conteneur enveloppant `<Rebase>`.

Envelopper `<Rebase>` dans un `ModeControllerProvider` ne produit pas cet effet : `<Rebase>` fournit son propre contrôleur en interne. En version 0.24, la prop n'existe pas et il n'y a aucun moyen de transmettre le mode de votre application à `<Rebase>`.

## Prochaines étapes

- **[Champs personnalisés](/docs/frontend/custom-fields)** — Créez des champs de formulaire personnalisés
- **[Vues d'entité](/docs/frontend/entity-views)** — Ajoutez des onglets aux éditeurs d'entités
- **[Modes de vue](/docs/frontend/view-modes)** — Liste, Tableau, Cartes, Kanban
- **[Traductions](/docs/frontend/i18n)** — Modifiez n'importe quel texte ou ajoutez une langue
- **[Plugins](/docs/plugins)** — Étendez le framework
