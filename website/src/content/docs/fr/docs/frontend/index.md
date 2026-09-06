---
sourceHash: 8e814603c912d2a1
title: Aperçu du Frontend
sidebar_label: Frontend
description: Créez et personnalisez le panneau d'administration Rebase avec React — contrôleurs, scaffold, routage et vues.
---

## Aperçu

Le frontend Rebase est un **framework React** qui rend votre panneau d'administration. Il lit vos définitions de collections et génère automatiquement les tableaux, les formulaires, la navigation et le routage.

Dans le scaffold par défaut, le panneau d'administration **est** le frontend : il est servi à la racine de votre URL déployée. Si vous construisez plutôt votre propre application produit, vous pouvez monter l'admin sous un préfixe comme `/admin` dans le même déploiement — voir [Changer l'URL de base](/docs/getting-started/deployment#changing-the-base-url).

Voici `frontend/src/App.tsx` tel que `rebase init` l'écrit — tout le panneau
d'administration, quatre déclarations à l'intérieur d'un seul provider :

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

Les trois premiers ne rendent rien : ils *enregistrent* de la configuration dans
le provider. C'est `<RebaseShell>` qui dessine — il lit ce registre et en
construit la navigation, les routes et la mise en page. L'ordre dans lequel ils
apparaissent n'a donc aucune importance, et ajouter une fonctionnalité revient à
ajouter un composant, pas à recâbler un arbre.

| Composant | Paquet | Enregistre |
|---|---|---|
| `<RebaseAuth>` | `@rebasepro/app` | l'écran de connexion (`loginView`) |
| `<RebaseCMS>` | `@rebasepro/cms` | les collections, les vues personnalisées, la page d'accueil, l'éditeur de collections |
| `<RebaseStudio>` | `@rebasepro/studio` | les outils de développement (SQL, RLS, logs, sauvegardes…) |
| `<RebaseShell>` | `@rebasepro/cms` | rien — il rend l'admin à partir de tout ce qui précède |

Retirez `<RebaseStudio>` et vous avez un CMS de contenu seul ; retirez
`<RebaseCMS>` et vous avez les seuls outils de développement. Pour disposer la
shell à la main, voir [Avancé : mise en page manuelle](#avancé--mise-en-page-manuelle).

## Le provider Rebase

`<Rebase>` est le provider racine qui rend toutes les fonctionnalités de Rebase disponibles aux composants enfants via le contexte. Il accepte :

Les vingt-deux, au complet — le tableau en listait dix, et deux d'entre elles
étaient des props que le composant n'a jamais lues :

<!-- rebase-props:start -->
| Prop | Description |
|------|-------------|
| `children` | Les composants racine de l'admin — `<RebaseCMS>`, `<RebaseStudio>`, `<RebaseShell>`. Une fonction de rendu est l'échappatoire pour la mise en page manuelle. |
| `apiUrl` | URL de base de l'API backend, mise à disposition de chaque hook via `useApiConfig()` |
| `dateTimeFormat` | Comment les dates sont affichées. Par défaut `MMMM dd, yyyy, HH:mm:ss` |
| `locale` | Langue initiale de l'admin, et locale dans laquelle les dates sont formatées — voir [Traductions](/docs/frontend/i18n) |
| `client` | Instance de `RebaseClient` : la source par défaut pour les données, l'authentification et le stockage |
| `dataSources` | Sources de données supplémentaires, pour les collections qui en nomment une — voir [Sources multiples](/docs/backend/multiple-sources) |
| `authController` | État et méthodes d'authentification. Remplace purement et simplement l'abonnement `client.auth` |
| `storageSource` | La source de stockage par défaut, qui l'emporte sur `client.storage` |
| `storageSources` | Sources de stockage nommées, au-delà de celle par défaut |
| `databaseAdmin` | Opérations administratives sur la base (SQL, découverte de schéma). Seul Studio en a besoin |
| `userConfigPersistence` | Préférences d'interface locales — largeurs de colonnes, groupes repliés |
| `onAnalyticsEvent` | Appelé pour chaque événement analytique émis par l'admin |
| `entityLinkBuilder` | Renvoie une URL pour le bouton « ouvrir dans votre application » d'un formulaire d'entité |
| `plugins` | Instances de plugins — voir [Plugins](/docs/plugins) |
| `slots` | Contributions de slots déclarées directement, sans plugin |
| `propertyConfigs` | Widgets de champ personnalisés, indexés par le nom qu'une propriété indique dans `propertyConfig` |
| `entityViews` | Onglets de vues d'entité personnalisées globaux |
| `collectionViews` | Modes de vue de collection personnalisés, disponibles pour toute collection par `key` |
| `entityActions` | Actions d'entité globales |
| `effectiveRoleController` | Simuler un autre rôle tant que le mode développement est actif |
| `translations` | Remplacer ou étendre n'importe quelle chaîne d'interface, indexée par locale — voir [Traductions](/docs/frontend/i18n) |
| `components` | Remplacer les composants intégrés — voir [Surcharges de composants](/docs/frontend/component-overrides) |
<!-- rebase-props:end -->

Les contrôleurs de navigation, d'URL et de registre de collections ne sont
**pas** des props de `<Rebase>` — ils sont construits par les hooks ci-dessous et
consommés à l'intérieur de l'arbre de l'admin (`<RebaseShell>` les câble pour
vous dans le scaffold par défaut).

Le préfixe d'URL non plus. Lorsque l'admin est monté sous un chemin, cela
appartient à `<RebaseCMS basePath="/admin">`, qui est ce qui résout les URL vers
les collections — et seulement lorsque le routeur n'a pas de `basename` à lui.
Voir [Changer l'URL de base](/docs/getting-started/deployment#changing-the-base-url).

## Deux formes de données

Il y a deux couches de données, et elles ne sont **pas** interchangeables. Passer
l'une là où l'autre est attendue est une erreur de type : cela vaut donc la peine
de le savoir avant de câbler un contrôleur à la main.

| | Forme | Où vous l'obtenez | À quoi ressemble une ligne |
|---|---|---|---|
| **SDK** | `RebaseSdkData` — lignes plates | `client.data`, et `context.data` dans les callbacks backend | `row.title` |
| **Admin** | `RebaseData` — modèle de vue `Entity` | `useData()`, dans l'arbre `<Rebase>` | `entity.values.title` |

La couche SDK est la surface publique et symétrique : identique sur le client
frontend et dans les callbacks backend. La couche `Entity` est le modèle de vue
de l'admin — elle ajoute l'enveloppe `id` / `path` / `values` contre laquelle les
vues de collection et les formulaires effectuent leur rendu.
`CollectionAccessor` et `FindResponse` lui appartiennent et sont marqués
`@internal` pour cette raison.

`<Rebase>` est la frontière entre les deux : il prend votre `client.data` plat et
l'enveloppe avec `wrapAsEntityData()` avant de le fournir comme le `RebaseData`
de l'admin. Vous n'appelez jamais cela vous-même — vous prenez simplement la
forme dont vous avez besoin au bon endroit :

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

Tout ce qui suit remplace `<RebaseShell>`. Vous n'en avez besoin que lorsque la
mise en page standard gêne — un autre habillage autour de l'admin, un arbre de
routes à vous, une application où l'admin n'est qu'une page parmi d'autres. Si
vous ne remplacez pas la mise en page, arrêtez-vous à
[Vues personnalisées](#vues-personnalisées).

`<RebaseShell>` est du sucre syntaxique pour quatre couches, et vous pouvez les
reprendre une par une :

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

L'ordre est figé : `RebaseAuthGate → RebaseNavigation → RebaseRouteDefs →
RebaseLayout`. `RebaseAuthGate` affiche la vue de connexion tant qu'il n'y a pas
d'utilisateur, si bien que rien en dessous ne se rend pour un visiteur non
connecté ; `RebaseNavigation` construit les contrôleurs de navigation, d'URL et
de registre de collections que lisent `RebaseRouteDefs` et chaque vue de
collection, de sorte qu'un `RebaseRouteDefs` placé en dehors lève une exception.

Chaque couche est utilisable seule. `<RebaseAuthGate>` seul place votre propre
application derrière la connexion Rebase. Remplacez `<RebaseLayout>` par votre
propre composant pour garder le routage et perdre l'habillage ; retirez aussi
`<RebaseRouteDefs>` et vous construisez les routes vous-même à partir des
composants listés dans [Composants du scaffold](#composants-du-scaffold).

Sous ce plancher, `<Rebase>` accepte aussi une **render prop** au lieu d'enfants,
qui vous remet le contexte et l'indicateur de chargement et vous laisse l'arbre
entier :

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

À ce stade, rien n'est câblé pour vous : vous construisez les contrôleurs
ci-dessous à la main et rendez les routes vous-même.

### Contrôleurs

Les contrôleurs sont des hooks React qui configurent des aspects précis du
framework. `<RebaseNavigation>` les appelle tous pour vous — n'y recourez qu'à
l'intérieur d'une render prop.

#### `useBuildNavigationStateController`

Le contrôleur principal qui relie tout :

Son `data` est le `RebaseData` **de forme Entity**, il vient donc de `useData()`
— et non de `rebaseClient.data`, qui est la couche SDK à lignes plates.
`<Rebase>` convertit l'un en l'autre pour vous (voir
[Deux formes de données](#deux-formes-de-données) plus haut), ce hook doit donc
être appelé à l'intérieur de l'arbre `<Rebase>`.

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

### Composants du scaffold

| Composant | Description |
|-----------|-------------|
| `<Scaffold>` | Conteneur de mise en page principal avec barre latérale responsive |
| `<AppBar>` | Barre de navigation supérieure avec recherche, bascule de mode, menu utilisateur |
| `<Drawer>` | Navigation latérale avec la liste des collections et les liens de vues |
| `<SideDialogs>` | Conteneur pour les éditeurs d'entités en panneau latéral |
| `<RebaseRoutes>` | Conteneur de routes intégré à React Router |
| `<RebaseRoute>` | Gère les routes de collection (`/c/*`) |
| `<ContentHomePage>` | Page d'accueil par défaut affichant les cartes de collections |
| `<StudioHomePage>` | Page d'accueil du mode Studio avec les outils de développement |

## Vues personnalisées

Ajoutez des vues de navigation de premier niveau pour des tableaux de bord, des
outils ou des pages personnalisées. Un `AppView` est un objet plat — tout ce qui
suit se trouve au niveau supérieur, il n'y a pas de bloc `admin` imbriqué :

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

Confiez-les à `<RebaseCMS>`, à côté de vos collections — c'est le composant qui
enregistre la navigation :

```tsx
<RebaseCMS collections={collections} views={views}/>
```

| Champ | |
|---|---|
| `slug` | le chemin auquel elle est atteinte, sous la racine de l'admin |
| `name` | le libellé dans le tiroir et sur la page d'accueil |
| `view` | l'élément à rendre, ou un `ComponentType` pour le rendre à la demande |
| `icon` | un nom d'icône [Lucide](https://lucide.dev/icons/), par ex. `"ShoppingCart"` — ou n'importe quel nœud |
| `group` | regroupe les vues dans le tiroir ; `"Admin"` et `"Settings"` descendent en bas |
| `pinToBottom` | fait descendre le groupe en bas quel que soit son nom — à préférer aux deux chaînes magiques |
| `nestedRoutes` | enregistre aussi `slug/*`, pour une vue ayant ses propres routes |
| `hideFromNavigation` | garde la route, supprime l'entrée de navigation |
| `roles` | seuls les utilisateurs possédant l'un de ces rôles voient la vue, ou peuvent l'atteindre |
| `description` | Markdown, affiché sur la carte de la page d'accueil |

Pour placer une vue sous **Studio** plutôt que dans le CMS, passez-la à
[`<RebaseStudio devViews>`](/docs/studio#adding-your-own-tool).

## Styling

Rebase utilise **Tailwind CSS v4** et prend en charge les modes clair/sombre. Personnalisez via :

- **Propriétés personnalisées CSS** — Surchargez les tokens de design
- **`ModeControllerProvider`** — Contrôlez le mode clair/sombre
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

- **[Champs personnalisés](/docs/frontend/custom-fields)** — Créez des champs de formulaire personnalisés
- **[Vues d'entité](/docs/frontend/entity-views)** — Ajoutez des onglets aux éditeurs d'entités
- **[Modes d'affichage](/docs/frontend/view-modes)** — Liste, Tableau, Cartes, Kanban
- **[Traductions](/docs/frontend/i18n)** — Changez n'importe quelle chaîne, ou ajoutez une langue
- **[Plugins](/docs/plugins)** — Étendez le framework
