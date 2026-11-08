---
sourceHash: 648bcb814d96b084
title: Vue d'ensemble du Frontend
sidebar_label: Frontend
description: "Construisez et personnalisez le panneau d'administration — Rebase CMS et Rebase Studio — avec React : contrôleurs, scaffold, routage et vues."
---

## Vue d'ensemble

Le frontend de Rebase est un **framework React** qui effectue le rendu de votre panneau d'administration. Il lit les définitions de vos collections et génère automatiquement les tableaux, formulaires, la navigation et le routage.

Dans le scaffold par défaut, le panneau d'administration **est** le frontend : il est servi à la racine de votre URL de déploiement. Si vous créez plutôt votre propre application produit, vous pouvez monter l'administration sous un préfixe comme `/admin` au sein du même déploiement — voir [Modifier l'URL de base](/docs/getting-started/deployment#changing-the-base-url).

Voici `frontend/src/App.tsx` tel que `rebase init` le génère, sans ses imports
de polices, son error boundary et son ID client Google — l'ensemble du panneau d'administration, quatre
déclarations au sein d'un seul provider :

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
provider. `<RebaseShell>` est celui qui réalise l'affichage — il lit ce registre et construit
la navigation, les routes et la mise en page à partir de celui-ci. L'ordre dans lequel ils apparaissent n'a donc pas
d'importance, et ajouter une fonctionnalité revient à ajouter un composant, pas à reconnecter un arbre.

| Composant | Package | Enregistre |
|---|---|---|
| `<RebaseAuth>` | `@rebasepro/app` | l'écran de connexion (`loginView`) |
| `<RebaseCMS>` | `@rebasepro/cms` | les collections, les vues personnalisées, la page d'accueil, l'éditeur de collection |
| `<RebaseStudio>` | `@rebasepro/studio` | les outils de développement (SQL, RLS, logs, sauvegardes…) |
| `<RebaseShell>` | `@rebasepro/cms` | rien — il effectue le rendu de l'administration à partir de tout ce qui précède |

Supprimez `<RebaseStudio>` et vous obtenez un CMS dédié uniquement au contenu ; supprimez `<RebaseCMS>` et
vous n'avez que les outils pour développeurs. Pour agencer le shell manuellement, consultez
[Avancé : mise en page manuelle](#avancé--mise-en-page-manuelle).

## Le Provider Rebase

`<Rebase>` est le provider racine qui met toutes les fonctionnalités de Rebase à disposition des composants enfants via le contexte. Il accepte :

Les vingt-trois au total — le tableau n'en listait auparavant que dix, dont deux
qui correspondaient à des props que le composant ne lisait jamais :

<!-- rebase-props:start -->
| Prop | Description |
|------|-------------|
| `children` | Les composants racine de l'admin — `<RebaseCMS>`, `<RebaseStudio>`, `<RebaseShell>`. Une fonction de rendu sert d'échappatoire pour une mise en page manuelle. |
| `apiUrl` | URL de base de l'API backend, mise à disposition de chaque hook via `useApiConfig()` |
| `dateTimeFormat` | Format d'affichage des dates. Par défaut `MMMM dd, yyyy, HH:mm:ss` |
| `locale` | Langue initiale de l'admin et locale utilisée pour formater les dates — voir [Traductions](/docs/frontend/i18n) |
| `client` | Instance de `RebaseClient` : la source par défaut pour les données, l'authentification et le stockage |
| `dataSources` | Sources de données supplémentaires, pour les collections qui en spécifient une — voir [Sources multiples](/docs/backend/multiple-sources) |
| `authController` | État et méthodes d'authentification. Remplace directement la souscription à `client.auth` |
| `storageSource` | La source de stockage par défaut, surchargeant `client.storage` |
| `storageSources` | Sources de stockage nommées en plus de la source par défaut |
| `databaseAdmin` | Opérations administratives sur la base de données (SQL, découverte de schéma). Seul Studio en a besoin |
| `userConfigPersistence` | Préférences locales de l'interface utilisateur — largeurs de colonnes, groupes réduits |
| `onAnalyticsEvent` | Appelé pour chaque événement analytique émis par l'admin |
| `entityLinkBuilder` | `({ row, id, path }) => string` : l'URL pour le bouton « ouvrir dans votre application » sur un enregistrement, à partir de l'enregistrement tel que le serveur renvoie la ligne |
| `plugins` | Instances de plugins — voir [Plugins](/docs/plugins) |
| `slots` | Contributions de slots déclarées directement, sans plugin |
| `propertyConfigs` | Widgets de champs personnalisés, indexés par le nom spécifié par une propriété dans `propertyConfig` |
| `entityViews` | Onglets de vue d'entité personnalisés, disponibles pour toute collection qui spécifie leur `key` dans `admin.entityViews` |
| `collectionViews` | Modes de vue de collection personnalisés, disponibles pour toute collection par `key` |
| `entityActions` | Actions d'entité, disponibles pour toute collection qui spécifie leur `key` dans `admin.entityActions` |
| `effectiveRoleController` | Simuler un rôle différent lorsque le mode dev est activé |
| `modeController` | Transmettre à Rebase le mode clair/sombre de l'application hôte ; Rebase ne touche alors jamais à `<html>`, `prefers-color-scheme` ou localStorage — voir [Styles](#styles) |
| `translations` | Surcharger ou étendre n'importe quelle chaîne de l'interface utilisateur, indexée par locale — voir [Traductions](/docs/frontend/i18n) |
| `components` | Remplacer les composants intégrés — voir [Surcharges de composants](/docs/frontend/component-overrides) |
<!-- rebase-props:end -->

Les contrôleurs de navigation, d'URL et du registre de collections ne sont **pas** des
props de `<Rebase>` — ils sont construits par les hooks ci-dessous et consommés à l'intérieur de l'arbre d'administration
(`<RebaseShell>` les connecte pour vous dans le scaffold par défaut).

Le préfixe d'URL non plus. Lorsque l'administration est montée sous un chemin, cela appartient
à `<RebaseCMS basePath="/admin">`, qui résout les URL vers les collections —
et seulement lorsque le routeur n'a pas de `basename` propre. Voir
[Modifier l'URL de base](/docs/getting-started/deployment#changing-the-base-url).

## Une structure de données unique

<span class="since-badge" data-since="0.29">Depuis 0.29</span>
Votre code reçoit les lignes telles que le serveur les renvoie, quel que soit l'endroit où il les demande : `client.data`,
`context.data` (aussi bien dans un callback backend que dans le navigateur), `useRows`,
`useRow` et `useRowWrites`, le `data` des builders de collections et de vues, et ce qui
est transmis aux `browserCallbacks` d'une collection. Une ligne est un objet plat : `row.title`,
une date sous forme de chaîne ISO, un belongsTo sous la forme de sa colonne de clé étrangère.

```tsx
// Anywhere, including outside React.
const { data: posts } = await client.data.posts.find();
posts[0].title;

// Inside the <Rebase> tree: the same rows, kept current after every write.
const { rows } = useRows("posts");
rows[0].title;
```

L'administration effectue elle-même le rendu d'un view model `Entity` — l'enveloppe
`id` / `path` / `values` à partir de laquelle ses vues de collections et ses formulaires s'affichent, avec les dates sous forme d'objets `Date` et une
relation sous forme d'une `EntityRelation`. Cette couche est propre à l'administration et ne fait pas partie
de la surface publique : une action d'entité, un résolveur d'affichage, le `tableController.rows` d'un
`Builder` de mode de vue, la sélection d'une action de collection et un slot
reçoivent tous des lignes, l'id de chaque enregistrement figurant aux côtés de sa ligne. Vous ne rencontrez `Entity` que dans une copie de l'une des propres parties
de l'administration (`Collection.Table`, une carte), à laquelle l'enregistrement est transmis tel que l'administration
l'affiche. Les valeurs d'un formulaire sont celles de l'éditeur : des `Date`s et des relations, telles qu'un champ
les modifie.

## Une collection ou un enregistrement dans votre propre page

Vous n'avez pas besoin de toute l'administration pour afficher un seul tableau. `<CollectionPanel>`,
`<EntityFormPanel>`, `<RecordDetail>` et `<FieldValue>` fonctionnent n'importe où sous
`<Rebase>` et un routeur React Router, sans aucun `<RebaseCMS>`,
`<RebaseNavigation>` ou `<RebaseShell>` : une collection avec les colonnes et
la barre d'outils de votre choix, le formulaire d'un seul enregistrement avec seulement certains champs ou votre propre
mise en page, un enregistrement en lecture seule, ou une valeur affichée telle que l'administration l'affiche. Voir
[Panneaux dans votre propre page](/docs/frontend/panels).

## Avancé : mise en page manuelle

Tout ce qui suit remplace `<RebaseShell>`. Vous n'en avez besoin que lorsque la mise en page
par défaut ne convient pas — un habillage différent autour de l'admin, un arbre de routes
personnalisé, une application où l'admin n'est qu'une page parmi d'autres. Si vous ne
remplacez pas la mise en page, arrêtez-vous à [Vues personnalisées](#vues-personnalisées).

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

L'ordre est fixe : `RebaseAuthGate → RebaseNavigation → RebaseRouteDefs →
RebaseLayout`. `RebaseAuthGate` affiche la vue de connexion tant qu'il n'y a pas d'utilisateur, afin que
rien en dessous ne soit rendu pour un visiteur déconnecté ; `RebaseNavigation` construit
les contrôleurs de navigation, d'URL et de registre de collections que lisent `RebaseRouteDefs`
et chaque vue de collection, de sorte que `RebaseRouteDefs` en dehors de celui-ci lève une erreur.
Pour intégrer une
vue de collection ou un formulaire d'enregistrement dans votre propre page, sans les
routes de l'administration, le composant plus léger `CollectionsProvider` construit ces contrôleurs
à la place — voir
[Panneaux dans votre propre page](/docs/frontend/panels).

Chaque couche est utilisable séparément. `<RebaseAuthGate>` protège à lui seul votre propre application
derrière la connexion de Rebase. Remplacez `<RebaseLayout>` par votre propre composant pour conserver le
routage sans l'habillage ; supprimez également `<RebaseRouteDefs>` et vous construisez
vous-même les routes à partir des composants décrits dans
[Composants du Scaffold](#composants-du-scaffold).

Encore plus bas, `<Rebase>` accepte également une **render prop** à la place de children,
ce qui vous transmet le contexte ainsi que l'indicateur de chargement et vous laisse la gestion totale de l'arbre :

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

À ce stade, rien n'est connecté pour vous : vous construisez les contrôleurs ci-dessous à
la main et effectuez vous-même le rendu des routes.

### Contrôleurs

Les contrôleurs sont des hooks React qui configurent des aspects spécifiques du framework.
`<RebaseNavigation>` les appelle tous pour vous — ne recourez à ceux-ci qu'au sein d'une
render prop.

#### `useBuildNavigationStateController`

Le contrôleur principal qui connecte le tout :

Son `data` correspond à ce qui est transmis aux builders de collections et de vues : le
`context.data` plat du `<Rebase>` parent (voir [Une structure de données unique](#une-structure-de-données-unique)),
ce hook doit donc être appelé à l'intérieur de l'arbre `<Rebase>`.

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

Gère la manière dont les collections sont résolues à partir des chemins d'URL :

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

Gère le thème clair/sombre. Lorsqu'il est activé, il gère entièrement le thème de la page : il ajoute
la classe `dark` sur `<html>`, suit `prefers-color-scheme` jusqu'à ce que l'utilisateur
choisisse un mode, et mémorise ce choix dans le localStorage.

```typescript
const modeController = useBuildModeController();

modeController.mode;             // "light" | "dark"
modeController.setMode("dark");  // "light" | "dark" | "system" — "system" follows the OS again
```

`<Rebase>` en construit un lui-même.

Lorsque le
composant qui l'utilise se démonte, il supprime la classe `dark` qu'il a ajoutée ; une classe
`dark` que la page possédait déjà est conservée. Ne construisez le vôtre
au-dessus de `<Rebase>` que si des composants situés en dehors ont également besoin du mode, et transmettez-le
via la [prop `modeController`](#styles), afin qu'il n'y ait qu'un seul contrôleur
et non deux. `useBuildModeController({ enabled: false })` construit un contrôleur
inerte : il conserve `mode` dans le state React et ne touche à aucune classe, media query
ou localStorage. Si votre application gère déjà le thème, vous n'avez pas du tout besoin de ce
hook : passez votre propre contrôleur en tant que `modeController`.

#### `useBuildAdminModeController`

Bascule entre les modes Studio et Contenu :

```typescript
const adminModeController = useBuildAdminModeController();
// Provides: adminModeController.mode ("cms" | "studio")
```

### Composants du Scaffold

| Composant | Description |
|-----------|-------------|
| `<Scaffold>` | Conteneur de mise en page principal avec barre latérale responsive |
| `<AppBar>` | Barre de navigation supérieure avec recherche, bascule de mode, menu utilisateur |
| `<Drawer>` | Navigation latérale avec liste des collections et liens vers les vues |
| `<SideDialogs>` | Conteneur pour les éditeurs d'entités en panneau latéral |
| `<RebaseRoutes>` | Conteneur de routes qui s'intègre avec React Router |
| `<RebaseRoute>` | Gère les routes de collection (`/c/*`) |
| `<ContentHomePage>` | Page d'accueil par défaut affichant les cartes de collections |
| `<StudioHomePage>` | Page d'accueil du mode Studio avec les outils de développement |

## Vues personnalisées

Ajoutez des vues de navigation de premier niveau pour des tableaux de bord, des outils ou des pages personnalisées. Un
`AppView` est un objet plat — tout ce qui suit se situe au niveau supérieur, il n'y a pas de
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

Passez-les à `<RebaseCMS>`, aux côtés de vos collections — c'est le composant
qui enregistre la navigation :

```tsx
<RebaseCMS collections={collections} views={views}/>
```

| Champ | |
|---|---|
| `slug` | le chemin auquel elle est accessible, sous la racine de l'admin |
| `name` | le libellé dans le drawer et sur la page d'accueil |
| `view` | l'élément à afficher, ou un `ComponentType` pour un chargement différé (lazy) |
| `icon` | un nom d'icône [Lucide](https://lucide.dev/icons/), ex. `"ShoppingCart"` — ou tout nœud React |
| `group` | regroupe les vues dans le drawer ; `"Admin"` et `"Settings"` sont relégués en bas |
| `pinToBottom` | relègue le groupe tout en bas quel que soit son nom — à préférer aux deux chaînes magiques |
| `nestedRoutes` | enregistre également `slug/*`, pour une vue disposant de ses propres routes |
| `hideFromNavigation` | conserve la route, mais supprime l'entrée dans la navigation |
| `roles` | seuls les utilisateurs possédant l'un de ces rôles voient la vue ou peuvent y accéder |
| `description` | Markdown, affiché sur la carte de la page d'accueil |

Pour placer une vue sous **Studio** au lieu du CMS, transmettez-la à
[`<RebaseStudio devViews>`](/docs/studio#adding-your-own-tool).

## Styles

Rebase utilise **Tailwind CSS v4** et prend en charge les modes clair/sombre. Personnalisez via :

- **Propriétés personnalisées CSS** — Surchargez les design tokens
- **`<Rebase modeController>`** — Transmettez à Rebase le mode clair/sombre de votre application
- **Configuration Tailwind** — Personnalisation standard de Tailwind

```css
/* Override design tokens */
:root {
    --font-sans: "Instrument Sans", sans-serif;
    --font-headers: "Instrument Sans", sans-serif;
    --font-mono: "JetBrains Mono", monospace;
}
```

### Mode clair et sombre

Par défaut, `<Rebase>` gère le thème de la page : il place la classe `dark` sur
`<html>`, suit `prefers-color-scheme` jusqu'à ce que l'utilisateur choisisse un mode dans
l'admin, et mémorise ce choix dans le localStorage.

Lorsque `<Rebase>`
se démonte, il supprime la classe `dark` qu'il a ajoutée ; une classe que la page possédait déjà
est conservée. En version 0.24, la classe subsistait.

Lorsque votre application
a déjà un thème, transmettez-le en tant que `modeController`. Rebase y lit `mode`,
appelle son `setMode` depuis sa propre commande de bascule de thème, et ne touche jamais à `<html>`,
`prefers-color-scheme` ou au localStorage :

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

Le CSS du scaffold applique les styles du mode sombre sous n'importe quel élément portant la classe `dark`
(`@custom-variant dark (&:where(.dark, .dark *))`). Les panneaux latéraux, les boîtes de dialogue et
les menus sont rendus dans un portail sur `<body>`, veillez donc à appliquer la classe sur `<html>` ou `<body>`
plutôt que sur un conteneur autour de `<Rebase>`.

Envelopper `<Rebase>` dans un `ModeControllerProvider` ne fonctionne pas :
`<Rebase>` fournit son propre contrôleur en interne. En version 0.24, cette prop
n'existe pas et il n'y a aucun moyen de transmettre à `<Rebase>` le mode de votre application.

## Prochaines étapes

- **[Champs personnalisés](/docs/frontend/custom-fields)** — Créez des champs de formulaire personnalisés
- **[Vues d'entités](/docs/frontend/entity-views)** — Ajoutez des onglets aux éditeurs d'entités
- **[Modes de vue](/docs/frontend/view-modes)** — Liste, Tableau, Cartes, Kanban
- **[Traductions](/docs/frontend/i18n)** — Modifiez n'importe quelle chaîne ou ajoutez une langue
- **[Plugins](/docs/plugins)** — Étendez le framework
