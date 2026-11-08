---
sourceHash: 0b034023f28eb28f
title: Vue d'ensemble du Frontend
sidebar_label: Frontend
description: "Créez et personnalisez le panneau — Rebase CMS et Rebase Studio — avec React : contrôleurs, scaffold, routage et vues."
---

## Vue d'ensemble

Le frontend Rebase est un **framework React** qui génère le rendu de votre panneau d'administration. Il lit les définitions de vos collections et génère automatiquement les tables, les formulaires, la navigation et le routage.

Dans le scaffold par défaut, le panneau d'administration **est** le frontend : il est servi à la racine de votre URL de déploiement. Si vous créez plutôt votre propre application produit, vous pouvez monter l'administration sous un préfixe tel que `/admin` dans le même déploiement — voir [Modifier l'URL de base](/docs/getting-started/deployment#changing-the-base-url).

Voici `frontend/src/App.tsx` tel que généré par `rebase init`, sans ses imports
de polices, son error boundary et son identifiant client Google — l'ensemble du panneau
d'administration, quatre déclarations dans un seul provider :

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

Les trois premiers composants n'affichent rien : ils *enregistrent* une configuration
dans le provider. C'est `<RebaseShell>` qui effectue le rendu — il lit ce registre et
construit la navigation, les routes et la mise en page à partir de celui-ci. L'ordre dans
lequel ils apparaissent n'a donc pas d'importance, et ajouter une fonctionnalité revient à
ajouter un composant, sans avoir à restructurer tout l'arbre de composants.

| Composant | Paquet | Enregistre |
|---|---|---|
| `<RebaseAuth>` | `@rebasepro/app` | l'écran de connexion (`loginView`) |
| `<RebaseCMS>` | `@rebasepro/cms` | les collections, les vues personnalisées, la page d'accueil, l'éditeur de collection |
| `<RebaseStudio>` | `@rebasepro/studio` | les outils de développement (SQL, RLS, journaux, sauvegardes…) |
| `<RebaseShell>` | `@rebasepro/cms` | rien — effectue le rendu de l'administration à partir de tout ce qui précède |

Retirez `<RebaseStudio>` et vous obtenez un CMS dédié uniquement au contenu ; retirez `<RebaseCMS>`
et vous ne conservez que les outils de développement. Pour concevoir la mise en page du shell à la main,
consultez la section [Avancé : mise en page manuelle](#avancé--mise-en-page-manuelle).

## Le Provider Rebase

`<Rebase>` est le provider racine qui met l'ensemble des fonctionnalités de Rebase à la disposition des composants enfants via le contexte. Il accepte :

La totalité des vingt-trois propriétés — le tableau n'en listait auparavant que dix, dont deux
n'étaient jamais lues par le composant :

<!-- rebase-props:start -->
| Propriété | Description |
|-----------|-------------|
| `children` | Les composants racines de l'administration — `<RebaseCMS>`, `<RebaseStudio>`, `<RebaseShell>`. Une fonction de rendu (render prop) sert d'échappatoire pour une mise en page manuelle. |
| `apiUrl` | URL de base de l'API backend, accessible à chaque hook via `useApiConfig()` |
| `dateTimeFormat` | Format d'affichage des dates. Par défaut : `MMMM dd, yyyy, HH:mm:ss` |
| `locale` | Langue initiale de l'administration et locale utilisée pour formater les dates — voir [Traductions](/docs/frontend/i18n) |
| `client` | Instance de `RebaseClient` : la source par défaut pour les données, l'authentification et le stockage |
| `dataSources` | Sources de données supplémentaires, pour les collections qui en spécifient une — voir [Sources multiples](/docs/backend/multiple-sources) |
| `authController` | État et méthodes d'authentification. Remplace directement la souscription à `client.auth` |
| `storageSource` | La source de stockage par défaut, surchargeant `client.storage` |
| `storageSources` | Sources de stockage nommées en plus de celle par défaut |
| `databaseAdmin` | Opérations d'administration de base de données (SQL, détection de schéma). Requis uniquement par Studio |
| `userConfigPersistence` | Préférences d'interface utilisateur locales — largeurs de colonnes, groupes réduits |
| `onAnalyticsEvent` | Fonction appelée pour chaque événement analytique émis par l'administration |
| `entityLinkBuilder` | `({ row, id, path }) => string` : l'URL pour le bouton "ouvrir dans votre application" sur un enregistrement, à partir de la ligne telle qu'envoyée par le serveur |
| `plugins` | Instances de plugins — voir [Plugins](/docs/plugins) |
| `slots` | Contributions de slots déclarées directement, sans plugin |
| `propertyConfigs` | Widgets de champ personnalisés, indexés par le nom spécifié pour une propriété dans `propertyConfig` |
| `entityViews` | Onglets de vue d'entité personnalisés, disponibles pour toute collection qui mentionne leur `key` dans `admin.entityViews` |
| `collectionViews` | Modes de vue de collection personnalisés, disponibles pour toute collection par `key` |
| `entityActions` | Actions d'entité, disponibles pour toute collection qui mentionne leur `key` dans `admin.entityActions` |
| `effectiveRoleController` | Permet de simuler un rôle différent lorsque le mode développeur est activé |
| `modeController` | Transmet à Rebase le mode clair/sombre de l'application hôte ; Rebase ne touche alors jamais à `<html>`, `prefers-color-scheme` ou au localStorage — voir [Styles](#styles) |
| `translations` | Surcharge ou étend n'importe quelle chaîne de l'interface, indexée par locale — voir [Traductions](/docs/frontend/i18n) |
| `components` | Remplace les composants intégrés — voir [Surcharges de composants](/docs/frontend/component-overrides) |
<!-- rebase-props:end -->

Les contrôleurs de navigation, d'URL et de registre de collections ne sont **pas**
des props de `<Rebase>` — ils sont construits par les hooks ci-dessous et consommés
à l'intérieur de l'arbre d'administration (`<RebaseShell>` les connecte pour vous dans
le scaffold par défaut).

Le préfixe d'URL n'en est pas un non plus. Lorsque l'administration est montée sous un
chemin spécifique, cette configuration appartient à `<RebaseCMS basePath="/admin">`, qui
se charge de résoudre les URL vers les collections — et uniquement lorsque le routeur n'a
pas de `basename` propre. Voir [Modifier l'URL de base](/docs/getting-started/deployment#changing-the-base-url).

## Une structure de données unique

<span class="since-badge" data-since="0.29">Depuis la version 0.29</span>
Votre code reçoit les lignes telles que le serveur les transmet, quel que soit l'endroit
où il les demande : `client.data`, `context.data` (aussi bien dans un callback backend que
dans le navigateur), `useRows`, `useRow` et `useRowWrites`, le `data` des builders de
collections et de vues, ainsi que ce qui est passé aux `browserCallbacks` d'une collection.
Une ligne est un objet plat : `row.title`, une date sous forme de chaîne ISO, une relation
belongsTo sous forme de colonne de clé étrangère.

```tsx
// N'importe où, y compris en dehors de React.
const { data: posts } = await client.data.posts.find();
posts[0].title;

// Dans l'arbre <Rebase> : les mêmes lignes, maintenues à jour après chaque écriture.
const { rows } = useRows("posts");
rows[0].title;
```

L'administration elle-même effectue le rendu d'un view model `Entity` — l'enveloppe
`id` / `path` / `values` dont s'inspirent ses formulaires et ses vues de collection,
avec les dates sous forme d'instances `Date` et les relations sous forme d'objets `EntityRelation`.
Cette couche est propre à l'administration et ne fait pas partie de la surface publique : une action
d'entité, un résolveur d'affichage, le `tableController.rows` d'un `Builder` de mode de vue, la
sélection d'une action de collection et un slot reçoivent tous des lignes, avec l'id de chaque
enregistrement à côté de sa ligne. Vous ne rencontrez `Entity` que dans une copie d'un des éléments
propres à l'administration (`Collection.Table`, une carte), à laquelle est transmis l'enregistrement
tel que l'administration l'affiche. Les valeurs d'un formulaire sont celles de l'éditeur : des `Date`s
et des relations, telles qu'un champ les modifie.

## Une collection ou un enregistrement dans votre propre page

Vous n'avez pas besoin de toute l'administration pour afficher une seule table. `<CollectionPanel>`,
`<EntityFormPanel>`, `<EntityViewPanel>` et `<FieldValue>` fonctionnent n'importe où sous
`<Rebase>` et un routeur React Router, sans nécessiter `<RebaseCMS>`, `<RebaseNavigation>` ou
`<RebaseShell>` : une collection avec les colonnes et la barre d'outils de votre choix, le formulaire
d'un enregistrement avec seulement certains champs ou votre propre mise en page, un enregistrement en
lecture seule, ou une valeur affichée telle que l'administration la dessine. Voir
[Panneaux dans votre propre page](/docs/frontend/panels).

## Avancé : mise en page manuelle

Tout ce qui suit remplace `<RebaseShell>`. Vous n'en avez besoin que lorsque la mise en
page par défaut est contraignante — un habillage différent autour de l'administration,
votre propre arbre de routes, ou une application dans laquelle l'administration n'est
qu'une page parmi d'autres. Si vous ne remplacez pas la mise en page, vous pouvez vous
arrêter à [Vues personnalisées](#vues-personnalisées).

`<RebaseShell>` est un raccourci syntaxique pour quatre couches, que vous pouvez utiliser
séparément :

```tsx
<Rebase client={client} authController={authController}>
    <RebaseCMS collections={collections}/>
    <RebaseStudio/>

    {/* écran de connexion jusqu'à ce qu'un utilisateur soit connecté */}
    <RebaseAuthGate>
        {/* construit les contrôleurs de navigation, d'URL et de registre de collections */}
        <RebaseNavigation>
            {/* les routes de l'administration, affichées dans la mise en page que vous passez */}
            <RebaseRouteDefs layout={<RebaseLayout title="My App"/>}/>
        </RebaseNavigation>
    </RebaseAuthGate>
</Rebase>
```

L'ordre est fixe : `RebaseAuthGate → RebaseNavigation → RebaseRouteDefs → RebaseLayout`.
`RebaseAuthGate` affiche la vue de connexion jusqu'à ce qu'un utilisateur soit présent,
donc rien en dessous ne s'affiche pour un visiteur déconnecté ; `RebaseNavigation` construit
les contrôleurs de navigation, d'URL et de registre de collections que lisent `RebaseRouteDefs`
et chaque vue de collection — `RebaseRouteDefs` lèvera donc une erreur s'il est utilisé en dehors.
Pour intégrer une vue de collection ou un formulaire d'enregistrement dans votre propre page, sans
les routes de l'administration, le composant plus léger `CollectionsProvider` construit ces
contrôleurs à la place — voir [Panneaux dans votre propre page](/docs/frontend/panels).

Chaque couche peut être utilisée indépendamment. `<RebaseAuthGate>` seul protège votre propre
application derrière la connexion Rebase. Remplacez `<RebaseLayout>` par votre propre composant
pour conserver le routage tout en retirant l'interface par défaut ; supprimez également
`<RebaseRouteDefs>` et vous construisez vous-même les routes à l'aide des composants présentés
dans [Composants de Scaffold](#composants-de-scaffold).

En dessous de ce niveau, `<Rebase>` accepte également une **render prop** au lieu d'enfants,
ce qui vous donne accès au contexte et à l'indicateur de chargement tout en vous laissant la gestion
complète de l'arborescence :

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

À ce stade, rien n'est connecté automatiquement : vous devez construire les contrôleurs
ci-dessous à la main et gérer vous-même le rendu des routes.

### Contrôleurs

Les contrôleurs sont des hooks React qui configurent des aspects spécifiques du framework.
`<RebaseNavigation>` les appelle tous pour vous — ne recourez à ceux-ci que dans le cadre
d'une render prop.

#### `useBuildNavigationStateController`

Le contrôleur principal qui relie l'ensemble des éléments :

Sa propriété `data` correspond à ce qui est transmis aux builders de collections et de vues :
le `context.data` plat de l'élément `<Rebase>` parent (voir [Une structure de données unique](#une-structure-de-données-unique)),
ce hook doit donc impérativement être appelé à l'intérieur de l'arbre `<Rebase>`.

```typescript
const { data } = useRebaseContext();

const navigationStateController = useBuildNavigationStateController({
    collections: () => [...collections],  // Définitions de collection
    views: customViews,                   // Vues de navigation personnalisées
    plugins,                              // Instances de plugins
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

Gère le thème clair/sombre. Lorsqu'il est activé, il prend le contrôle du thème de la page :
il applique la classe `dark` sur `<html>`, suit `prefers-color-scheme` jusqu'à ce que l'utilisateur
sélectionne un mode, et enregistre ce choix dans le localStorage.

```typescript
const modeController = useBuildModeController();

modeController.mode;             // "light" | "dark"
modeController.setMode("dark");  // "light" | "dark" | "system" — "system" suit de nouveau le système d'exploitation
```

`<Rebase>` en initialise un automatiquement.

Lorsque le composant qui l'utilise est démonté, il supprime la classe `dark` qu'il avait ajoutée ;
une classe `dark` que la page possédait déjà est conservée. Ne créez le vôtre au-dessus de `<Rebase>`
que si des composants extérieurs ont également besoin d'accéder au mode, et transmettez-le via
la [prop `modeController`](#styles), afin qu'il n'y ait qu'un seul contrôleur et non deux.
`useBuildModeController({ enabled: false })` crée un contrôleur inerte : il conserve `mode` dans
l'état React et ne touche à aucune classe, requête média ou localStorage. Lorsque votre application
gère déjà le thème, vous n'avez pas du tout besoin de ce hook : passez votre propre contrôleur
en tant que `modeController`.

#### `useBuildAdminModeController`

Bascule entre les modes Studio et Contenu :

```typescript
const adminModeController = useBuildAdminModeController();
// Fournit : adminModeController.mode ("cms" | "studio")
```

### Composants de Scaffold

| Composant | Description |
|-----------|-------------|
| `<Scaffold>` | Conteneur de mise en page principal avec barre latérale responsive |
| `<AppBar>` | Barre de navigation supérieure avec recherche, bascule de mode, menu utilisateur |
| `<Drawer>` | Navigation latérale avec liste des collections et liens vers les vues |
| `<SideDialogs>` | Conteneur pour les éditeurs d'entités en panneau latéral |
| `<RebaseRoutes>` | Conteneur de routes s'intégrant avec React Router |
| `<RebaseRoute>` | Gère les routes de collection (`/c/*`) |
| `<ContentHomePage>` | Page d'accueil par défaut affichant les cartes de collection |
| `<StudioHomePage>` | Page d'accueil du mode Studio avec les outils de développement |

## Vues personnalisées

Ajoutez des vues de navigation de premier niveau pour des tableaux de bord, des outils ou des
pages personnalisées. Un objet `AppView` est un objet plat — tout ce qui suit se situe au premier
niveau, il n'y a pas de bloc `admin` imbriqué :

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
| `view` | l'élément à afficher, ou un `ComponentType` pour un chargement différé (lazy) |
| `icon` | un nom d'icône [Lucide](https://lucide.dev/icons/), par ex. `"ShoppingCart"` — ou n'importe quel nœud React |
| `group` | regroupe les vues dans le panneau latéral ; `"Admin"` et `"Settings"` sont relégués en bas |
| `pinToBottom` | relègue le groupe tout en bas sous n'importe quel nom — à privilégier par rapport aux deux chaînes magiques |
| `nestedRoutes` | enregistre également `slug/*`, pour une vue disposant de ses propres routes |
| `hideFromNavigation` | conserve la route, mais masque l'entrée dans la navigation |
| `roles` | seuls les utilisateurs ayant l'un de ces rôles voient la vue ou peuvent y accéder |
| `description` | Markdown, affiché sur la carte de la page d'accueil |

Pour placer une vue sous **Studio** plutôt que sous le CMS, passez-la à
[`<RebaseStudio devViews>`](/docs/studio#adding-your-own-tool).

## Styles

Rebase utilise **Tailwind CSS v4** et prend en charge les modes clair/sombre. Personnalisez via :

- **Propriétés personnalisées CSS** — Surchargez les design tokens
- **`<Rebase modeController>`** — Transmettez à Rebase le mode clair/sombre de votre application
- **Configuration Tailwind** — Personnalisation Tailwind standard

```css
/* Surcharge des design tokens */
:root {
    --font-sans: "Instrument Sans", sans-serif;
    --font-headers: "Instrument Sans", sans-serif;
    --font-mono: "JetBrains Mono", monospace;
}
```

### Modes clair et sombre

Par défaut, `<Rebase>` gère le thème de la page : il applique la classe `dark` sur
`<html>`, suit `prefers-color-scheme` jusqu'à ce que l'utilisateur choisisse un mode
dans l'administration, et mémorise ce choix dans le localStorage.

Lorsque `<Rebase>`
est démonté, il supprime la classe `dark` qu'il a ajoutée ; une classe que la page
possédait déjà reste en place. Sur la version 0.24, la classe reste présente.

Lorsque votre application
dispose déjà d'un thème, passez-le en tant que `modeController`. Rebase y lira le `mode`,
appellera sa fonction `setMode` depuis son propre bouton de bascule de thème, et ne
touchera jamais à `<html>`, `prefers-color-scheme` ou au localStorage :

```tsx
import { useEffect, useMemo, useState } from "react";
import { Rebase, type ModeController } from "@rebasepro/app";

export function App() {
    const [mode, setMode] = useState<"light" | "dark">("light");
    const modeController = useMemo<ModeController>(() => ({
        mode,
        setMode: (next) => setMode(next === "dark" ? "dark" : "light")
    }), [mode]);

    // Votre application applique le mode, comme elle le fait pour le reste de la page.
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

Le CSS du scaffold applique les styles du mode sombre sous tout élément portant la classe `dark`
(`@custom-variant dark (&:where(.dark, .dark *))`). Les panneaux latéraux, les boîtes de dialogue
et les menus sont rendus dans un portail sur `<body>` ; appliquez donc la classe sur `<html>` ou `<body>`
plutôt que sur un conteneur enveloppant `<Rebase>`.

Envelopper `<Rebase>` dans un `ModeControllerProvider` ne produit pas cet effet :
`<Rebase>` fournit son propre contrôleur en interne. Sur la version 0.24, cette prop
n'existe pas et il n'y a aucun moyen de transmettre le mode de votre application à `<Rebase>`.

## Prochaines étapes

- **[Champs personnalisés](/docs/frontend/custom-fields)** — Créez des champs de formulaire sur mesure
- **[Vues d'entité](/docs/frontend/entity-views)** — Ajoutez des onglets aux éditeurs d'entités
- **[Modes de vue](/docs/frontend/view-modes)** — Liste, Table, Cartes, Kanban
- **[Traductions](/docs/frontend/i18n)** — Modifiez n'importe quel texte ou ajoutez une langue
- **[Plugins](/docs/plugins)** — Étendez le framework
