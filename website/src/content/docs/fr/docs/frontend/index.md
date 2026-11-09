---
sourceHash: b42c1d93bc690ca0
title: Vue d'ensemble du frontend
sidebar_label: Frontend
description: "Construisez et personnalisez le panneau — Rebase CMS et Rebase Studio — avec React : contrôleurs, scaffold, routage et vues."
---

## Vue d'ensemble

Le frontend de Rebase est un **framework React** qui affiche votre panneau d'administration. Il lit les définitions de vos collections et génère automatiquement les tables, les formulaires, la navigation et le routage.

Dans le scaffold par défaut, le panneau d'administration **est** le frontend : il est servi à la racine de votre URL déployée. Si vous créez plutôt votre propre application produit, vous pouvez monter l'administration sous un préfixe comme `/admin` dans le même déploiement — voir [Changer l'URL de base](/docs/getting-started/deployment#changing-the-base-url).

Voici `frontend/src/App.tsx` tel que `rebase init` le génère, sans ses imports de polices, son error boundary et son identifiant client Google — l'ensemble du panneau d'administration, quatre déclarations au sein d'un seul provider :

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

Les trois premiers ne font aucun rendu : ils *enregistrent* de la configuration dans le provider. `<RebaseShell>` est celui qui dessine l'interface — il lit ce registre et construit la navigation, les routes et la mise en page à partir de celui-ci. L'ordre dans lequel ils apparaissent n'a donc pas d'importance, et ajouter une fonctionnalité revient à ajouter un composant, sans avoir à restructurer un arbre.

| Composant | Package | Enregistre |
|---|---|---|
| `<RebaseAuth>` | `@rebasepro/app` | l'écran de connexion (`loginView`) |
| `<RebaseCMS>` | `@rebasepro/cms` | les collections, les vues personnalisées, la page d'accueil, l'éditeur de collection |
| `<RebaseStudio>` | `@rebasepro/studio` | les outils de développement (SQL, RLS, logs, sauvegardes…) |
| `<RebaseShell>` | `@rebasepro/cms` | rien — il effectue le rendu de l'administration à partir de tout ce qui précède |

Supprimez `<RebaseStudio>` et vous obtenez un CMS dédié uniquement au contenu ; supprimez `<RebaseCMS>` et vous n'avez que les outils de développement. Pour agencer le shell manuellement, voir [Avancé : mise en page manuelle](#avancé--mise-en-page-manuelle).

## Le provider Rebase

`<Rebase>` est le provider racine qui met toutes les fonctionnalités de Rebase à la disposition des composants enfants via le contexte. Il accepte :

L'ensemble des vingt-trois props, au complet — le tableau n'en listait auparavant que dix, et deux d'entre elles n'étaient même jamais lues par le composant :

<!-- rebase-props:start -->
| Prop | Description |
|------|-------------|
| `children` | Les composants racines de l'administration — `<RebaseCMS>`, `<RebaseStudio>`, `<RebaseShell>`. Une fonction de rendu sert d'échappatoire pour une mise en page manuelle. |
| `apiUrl` | URL de base de l'API backend, accessible à chaque hook via `useApiConfig()` |
| `dateTimeFormat` | Format d'affichage des dates. Par défaut `MMMM dd, yyyy, HH:mm:ss` |
| `locale` | Langue initiale de l'administration et locale utilisée pour formater les dates — voir [Traductions](/docs/frontend/i18n) |
| `client` | Instance de `RebaseClient` : la source par défaut pour les données, l'authentification et le stockage |
| `dataSources` | Sources de données supplémentaires, pour les collections qui en spécifient une — voir [Sources multiples](/docs/backend/multiple-sources) |
| `authController` | État et méthodes d'authentification. Remplace directement l'abonnement à `client.auth` |
| `storageSource` | La source de stockage par défaut, surchargeant `client.storage` |
| `storageSources` | Sources de stockage nommées au-delà de celle par défaut |
| `databaseAdmin` | Opérations administratives sur la base de données (SQL, découverte de schéma). Seul Studio en a besoin |
| `userConfigPersistence` | Préférences d'interface locales — largeurs de colonnes, groupes repliés |
| `onAnalyticsEvent` | Appelé pour chaque événement d'analyse émis par l'administration |
| `entityLinkBuilder` | `({ row, id, path }) => string` : l'URL pour le bouton « ouvrir dans votre application » sur un enregistrement, à partir de l'enregistrement tel que le serveur renvoie la ligne |
| `plugins` | Instances de plugins — voir [Plugins](/docs/plugins) |
| `slots` | Contributions de slots déclarées directement, sans plugin |
| `propertyConfigs` | Widgets de champs personnalisés, indexés par le nom spécifié par une propriété dans `propertyConfig` |
| `entityViews` | Onglets de vue d'entité personnalisés, disponibles pour toute collection qui spécifie leur `key` dans `admin.entityViews` |
| `collectionViews` | Modes de vue de collection personnalisés, disponibles pour toute collection via `key` |
| `entityActions` | Actions d'entité, disponibles pour toute collection qui spécifie leur `key` dans `admin.entityActions` |
| `effectiveRoleController` | Simule un rôle différent lorsque le mode dev est activé |
| `modeController` | Transmet à Rebase le mode clair/sombre de l'application hôte ; Rebase ne touche alors jamais à `<html>`, `prefers-color-scheme` ou localStorage — voir [Styles](#styles) |
| `translations` | Remplace ou étend n'importe quelle chaîne de l'interface, indexée par locale — voir [Traductions](/docs/frontend/i18n) |
| `components` | Remplace des composants intégrés — voir [Surcharges de composants](/docs/frontend/component-overrides) |
<!-- rebase-props:end -->

Les contrôleurs de navigation, d'URL et de registre de collections ne sont **pas** des props de `<Rebase>` — ils sont créés par les hooks ci-dessous et consommés à l'intérieur de l'arbre d'administration (`<RebaseShell>` les câble pour vous dans le scaffold par défaut).

Le préfixe d'URL non plus. Lorsque l'administration est montée sous un chemin, cela se configure sur `<RebaseCMS basePath="/admin">`, qui résout les URL vers les collections — et uniquement lorsque le routeur ne dispose pas de son propre `basename`. Voir [Changer l'URL de base](/docs/getting-started/deployment#changing-the-base-url).

## Un format de données unique

Votre code reçoit les lignes telles que le serveur les envoie, d'où qu'il les demande : `client.data`, `context.data` (aussi bien dans un callback backend que dans le navigateur), `useRows`, `useRow` et `useRowWrites`, le `data` des builders de collections et de vues, ainsi que ce qui est transmis aux `browserCallbacks` d'une collection. Une ligne est un objet plat : `row.title`, une date sous forme de chaîne ISO, un belongsTo sous forme de sa colonne de clé étrangère.

```tsx
// Anywhere, including outside React.
const { data: posts } = await client.data.posts.find();
posts[0].title;

// Inside the <Rebase> tree: the same rows, kept current after every write.
const { rows } = useRows("posts");
rows[0].title;
```

L'administration elle-même effectue le rendu d'un modèle de vue `Entity` — l'enveloppe `id` / `path` / `values` dont s'inspirent ses vues de collection et ses formulaires, avec les dates sous forme de `Date` et une relation sous forme d'`EntityRelation`. Cette couche est propre à l'administration et ne fait pas partie de l'interface publique : une action d'entité, un résolveur d'affichage, le `tableController.rows` d'un `Builder` de mode de vue, la sélection d'une action de collection et un slot reçoivent tous des lignes, accompagnées de l'identifiant de chaque enregistrement aux côtés de sa ligne. Vous ne rencontrez `Entity` que dans une copie d'un des éléments internes de l'administration (`Collection.Table`, une carte), qui reçoit l'enregistrement tel que l'administration l'affiche. Les valeurs d'un formulaire sont celles de l'éditeur : des objets `Date` et des relations, tels qu'un champ les édite.

## Une collection ou un enregistrement dans votre propre page

Vous n'avez pas besoin de toute l'administration pour afficher une seule table. `<CollectionPanel>`, `<RecordForm>`, `<RecordDetail>` et `<FieldValue>` fonctionnent n'importe où sous `<Rebase>` et un routeur React Router, sans aucun `<RebaseCMS>`, `<RebaseNavigation>` ou `<RebaseShell>` : une collection avec les colonnes et la barre d'outils de votre choix, le formulaire d'un enregistrement avec seulement certains champs ou votre propre disposition, un enregistrement en lecture seule, ou une valeur affichée telle que l'administration l'affiche. Voir [Panneaux dans votre propre page](/docs/frontend/panels).

## Avancé : mise en page manuelle

Tout ce qui suit remplace `<RebaseShell>`. Vous n'en avez besoin que lorsque la mise en page d'origine est gênante — un habillage différent autour de l'administration, votre propre arbre de routes, ou une application où l'administration est une page parmi d'autres. Si vous ne remplacez pas la mise en page, arrêtez-vous à [Vues personnalisées](#vues-personnalisées).

`<RebaseShell>` est un raccourci syntaxique pour quatre couches, que vous pouvez utiliser une par une :

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

L'ordre est fixe : `RebaseAuthGate → RebaseNavigation → RebaseRouteDefs → RebaseLayout`. `RebaseAuthGate` affiche la vue de connexion jusqu'à ce qu'il y ait un utilisateur connecté, de sorte que rien en dessous n'est rendu pour un visiteur anonyme ; `RebaseNavigation` construit les contrôleurs de navigation, d'URL et de registre de collections que lisent `RebaseRouteDefs` et chaque vue de collection, si bien que `RebaseRouteDefs` en dehors de celui-ci lève une erreur.
Pour intégrer une vue de collection ou un formulaire d'enregistrement dans votre propre page, sans les routes de l'administration, le composant plus léger `CollectionsProvider` construit ces contrôleurs à la place — voir [Panneaux dans votre propre page](/docs/frontend/panels).

Chaque couche est utilisable séparément. `<RebaseAuthGate>` seul protège votre propre application derrière l'authentification de Rebase. Remplacez `<RebaseLayout>` par votre propre composant pour conserver le routage tout en supprimant l'habillage ; retirez également `<RebaseRouteDefs>` et vous construisez vous-même les routes à partir des composants de [Composants de structure (Scaffold)](#composants-de-structure-scaffold).

En dessous de ce niveau, `<Rebase>` accepte également une **render prop** au lieu d'enfants, qui vous fournit le contexte et l'indicateur de chargement et vous laisse l'arbre entier à gérer :

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

À ce stade, rien n'est câblé pour vous : vous construisez manuellement les contrôleurs ci-dessous et effectuez vous-même le rendu des routes.

### Contrôleurs

Les contrôleurs sont des hooks React qui configurent des aspects spécifiques du framework. `<RebaseNavigation>` les appelle tous pour vous — ne recourez à ceux-ci qu'au sein d'une render prop.

#### `useBuildNavigationStateController`

Le contrôleur principal qui connecte l'ensemble :

Son `data` correspond à ce qui est transmis aux builders de collections et de vues : le `context.data` plat du `<Rebase>` englobant (voir [Un format de données unique](#un-format-de-données-unique)), ce hook doit donc être appelé à l'intérieur de l'arbre `<Rebase>`.

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

Gère le thème clair/sombre. Lorsqu'il est activé, il prend le contrôle du thème de la page : il ajoute la classe `dark` sur `<html>`, suit `prefers-color-scheme` jusqu'à ce que l'utilisateur choisisse un mode, et mémorise ce choix dans localStorage.

```typescript
const modeController = useBuildModeController();

modeController.mode;             // "light" | "dark"
modeController.setMode("dark");  // "light" | "dark" | "system" — "system" follows the OS again
```

`<Rebase>` en construit un lui-même.

Lorsque le composant qui l'utilise est démonté, il retire la classe `dark` qu'il avait ajoutée ; une classe `dark` que la page possédait déjà est conservée. Ne créez le vôtre au-dessus de `<Rebase>` que si des composants en dehors de celui-ci ont également besoin de connaître le mode, et transmettez-le avec la [prop `modeController`](#styles), afin d'avoir un seul contrôleur au lieu de deux. `useBuildModeController({ enabled: false })` construit un contrôleur inerte : il garde `mode` dans l'état React et ne touche à aucune classe, media query ou localStorage. Lorsque votre application gère déjà le thème, vous n'avez pas du tout besoin de ce hook : transmettez votre propre contrôleur en tant que `modeController`.

#### `useBuildAdminModeController`

Bascule entre les modes Studio et Contenu :

```typescript
const adminModeController = useBuildAdminModeController();
// Provides: adminModeController.mode ("cms" | "studio")
```

### Composants de structure (Scaffold)

| Composant | Description |
|-----------|-------------|
| `<Scaffold>` | Conteneur principal de mise en page avec barre latérale responsive |
| `<AppBar>` | Barre de navigation supérieure avec recherche, bascule de mode, menu utilisateur |
| `<Drawer>` | Navigation latérale avec liste des collections et liens de vues |
| `<SideDialogs>` | Conteneur pour les éditeurs d'entités en panneau latéral |
| `<RebaseRoutes>` | Conteneur de routes qui s'intègre avec React Router |
| `<RebaseRoute>` | Gère les routes des collections (`/c/*`) |
| `<ContentHomePage>` | Page d'accueil par défaut affichant les cartes des collections |
| `<StudioHomePage>` | Page d'accueil du mode Studio avec les outils de développement |

## Vues personnalisées

Ajoutez des vues de navigation de premier niveau pour des tableaux de bord, des outils ou des pages personnalisées. Une `AppView` est un objet plat — tous les éléments ci-dessous se trouvent au premier niveau, il n'y a pas de bloc `admin` imbriqué :

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
| `slug` | le chemin auquel elle est accessible, sous la racine de l'administration |
| `name` | le libellé dans le drawer et sur la page d'accueil |
| `view` | l'élément à afficher, ou un `ComponentType` pour un affichage lazy |
| `icon` | un nom d'icône [Lucide](https://lucide.dev/icons/), par ex. `"ShoppingCart"` — ou n'importe quel nœud |
| `group` | regroupe les vues dans le drawer ; `"Admin"` et `"Settings"` sont relégués tout en bas |
| `pinToBottom` | relègue le groupe tout en bas quel que soit son nom — à préférer aux deux chaînes magiques |
| `nestedRoutes` | enregistre également `slug/*`, pour une vue possédant ses propres routes |
| `hideFromNavigation` | conserve la route, mais retire l'entrée de la navigation |
| `roles` | seuls les utilisateurs ayant l'un de ces rôles voient la vue ou peuvent y accéder |
| `description` | Markdown, affiché sur la carte de la page d'accueil |

Pour placer une vue sous **Studio** plutôt que dans le CMS, transmettez-la à [`<RebaseStudio devViews>`](/docs/studio#adding-your-own-tool).

## Styles

Rebase utilise **Tailwind CSS v4** et prend en charge les modes clair/sombre. Personnalisez via :

- **Propriétés personnalisées CSS** — Surchargez les tokens de design
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

Par défaut, `<Rebase>` gère le thème de la page : il applique la classe `dark` sur `<html>`, suit `prefers-color-scheme` jusqu'à ce que l'utilisateur choisisse un mode dans l'administration, et mémorise ce choix dans localStorage.

Lorsque `<Rebase>` est démonté, il retire la classe `dark` qu'il avait ajoutée ; une classe que la page possédait déjà est conservée. Sur la version 0.24, la classe reste présente.

Lorsque votre application possède déjà un thème, transmettez-le en tant que `modeController`. Rebase y lit le `mode`, appelle sa fonction `setMode` depuis son propre sélecteur de thème, et ne touche jamais à `<html>`, `prefers-color-scheme` ou localStorage :

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

Le CSS du scaffold applique le style du mode sombre sous tout élément portant la classe `dark` (`@custom-variant dark (&:where(.dark, .dark *))`). Les panneaux latéraux, boîtes de dialogue et menus s'affichent dans un portail sur `<body>`, appliquez donc la classe sur `<html>` ou `<body>` plutôt que sur un conteneur englobant `<Rebase>`.

Envelopper `<Rebase>` dans un `ModeControllerProvider` ne fonctionne pas : `<Rebase>` fournit son propre contrôleur en interne. Sur la version 0.24, cette prop n'existe pas et il n'y a aucun moyen de transmettre le mode de votre application à `<Rebase>`.

## Prochaines étapes

- **[Champs personnalisés](/docs/frontend/custom-fields)** — Créez des champs de formulaire sur mesure
- **[Vues d'entité](/docs/frontend/entity-views)** — Ajoutez des onglets aux éditeurs d'entités
- **[Modes de vue](/docs/frontend/view-modes)** — Liste, Table, Cartes, Kanban
- **[Traductions](/docs/frontend/i18n)** — Modifiez n'importe quelle chaîne ou ajoutez une langue
- **[Plugins](/docs/plugins)** — Étendez le framework
