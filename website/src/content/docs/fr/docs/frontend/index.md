---
sourceHash: 3d9958fb7e16f02e
title: Vue d'ensemble du Frontend
sidebar_label: Frontend
description: "Construisez et personnalisez le panneau d'administration — Rebase CMS et Rebase Studio — avec React : contrôleurs, scaffold, routage et vues."
---

## Vue d'ensemble

Le frontend de Rebase est un **framework React** qui affiche votre panneau d'administration. Il
lit les tables servies par le backend et génère à partir de celles-ci la navigation, les tables,
les formulaires et les routes, sans aucune configuration (voir
[Tables in the CMS](/docs/collections/)). Ce que vous ajoutez correspond à ce qui diffère.

Dans le scaffold par défaut, le panneau d'administration **est** le frontend : il est servi à la racine de votre URL de déploiement. Si vous créez plutôt votre propre application produit, vous pouvez monter l'administration sous un préfixe tel que `/admin` au sein du même déploiement — voir [Changing the Base URL](/docs/getting-started/deployment#changing-the-base-url).

Voici un fichier `frontend/src/App.tsx` sans ses imports de polices, son error boundary et son
identifiant client Google — l'ensemble du panneau d'administration, quatre déclarations au sein d'un
seul provider :

```tsx
import React from "react";
import { Rebase, RebaseAuth, useRebaseAuthController } from "@rebasepro/app";
import { RebaseCMS, RebaseShell } from "@rebasepro/cms";
import { RebaseStudio } from "@rebasepro/studio";
import { createRebaseClient } from "@rebasepro/client";
import { tableCustomizations } from "./cms";

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
            {/* Every table the backend serves, plus your customizations. */}
            <RebaseCMS tableCustomizations={tableCustomizations}/>
            <RebaseStudio/>
            <RebaseShell title="My App"/>
        </Rebase>
    );
}
```

Les trois premiers ne font aucun rendu : ils *enregistrent* la configuration dans le
provider. `<RebaseShell>` est celui qui effectue le rendu — il lit ce registre et construit la
navigation, les routes et la mise en page à partir de celui-ci. L'ordre dans lequel ils apparaissent n'a donc pas
d'importance, et ajouter une fonctionnalité revient à ajouter un composant, sans avoir à restructurer tout l'arbre.

| Composant | Package | Enregistre |
|---|---|---|
| `<RebaseAuth>` | `@rebasepro/app` | l'écran de connexion (`loginView`) |
| `<RebaseCMS>` | `@rebasepro/cms` | les tables servies avec leurs personnalisations, les collections externes, les vues personnalisées, la page d'accueil |
| `<RebaseStudio>` | `@rebasepro/studio` | les outils de développement (SQL, RLS, logs, sauvegardes…) |
| `<RebaseShell>` | `@rebasepro/cms` | rien — effectue le rendu de l'administration à partir de tout ce qui précède |

Supprimez `<RebaseStudio>` et vous obtenez un CMS dédié uniquement au contenu ; supprimez `<RebaseCMS>` et
vous n'avez que les outils de développement. Pour agencer le shell manuellement, consultez
[Avancé : disposition manuelle](#avancé--disposition-manuelle).

## Où se trouvent les fichiers du CMS

```text
frontend/src/
├── App.tsx
└── cms/
    ├── index.ts      # export const tableCustomizations = [postsCms, …]
    ├── posts.tsx     # customizeTable("posts", { … })
    └── events.ts     # defineFirestoreCollection({ … })
```

`frontend/src/cms/` contient ce que le panneau ne peut pas déduire : un
[`customizeTable`](/docs/frontend/customize-table/) par table que vous souhaitez
présenter différemment, et les [collections Firestore](/docs/frontend/firebase/)
que le navigateur lit directement. Ces fichiers s'exécutent uniquement dans le navigateur, un
champ personnalisé est donc un composant que vous importez par valeur.

Le frontend importe le **type** d'une table depuis `backend/schema`, jamais une valeur :
`import type { posts } from "../../../backend/schema/posts"`. Un import de type est
effacé du bundle, de sorte que les hooks et le code serveur du backend n'atteignent jamais le
navigateur. Le backend n'importe rien depuis le frontend.

## Props de RebaseCMS

<!-- rebase-cms-props:start -->
| Prop | Description |
|------|-------------|
| `tableCustomizations` | Résultats de `customizeTable(...)`, au plus un par table. Deux pour la même table lèvent une erreur ; un pour une table non servie à l'appelant est ignoré, avec un avertissement en développement |
| `externalCollections` | Collections dont les lignes résident sur une autre source de données, comme les résultats de `defineFirestoreCollection`, affichées aux côtés des tables dans la même navigation, recherche et sélecteurs de références |
| `uiConfig` | Les préférences d'interface de l'espace de travail telles qu'écrites en développement : `import uiConfig from "./cms/ui-config.json"`. Appliquées par-dessus `tableCustomizations`, sous les propres préférences de chaque utilisateur |
| `tables` | Pour l'intégration et les tests : les tables à restituer à la place de celles servies par le serveur (`compileTables([...])`). Si spécifié, le serveur n'est pas sollicité |
| `views` | Pages de premier niveau dans la navigation, ou un constructeur de celles-ci — voir [Vues personnalisées](#vues-personnalisées) |
| `homePage` | Remplace la page d'accueil du contenu |
| `entityViews` | Onglets d'enregistrement que n'importe quelle table peut référencer par leur `key` dans ses `entityViews` |
| `collectionViews` | Modes de vue que n'importe quelle table peut référencer par leur `key` dans ses `customViews` |
| `entityActions` | Actions d'enregistrement que n'importe quelle table peut référencer par leur `key` dans ses `entityActions` |
| `collectionEditor` | Options pour le contrôleur de schéma à travers lequel l'éditeur RLS de Studio enregistre (`readOnly`, `getAuthToken`) |
| `navigationGroupMappings` | Groupes nommés et collections et vues associées à chacun, dans l'ordre |
| `basePath` | Le préfixe d'URL sous lequel l'administration est montée, lorsque le routeur n'a pas de `basename` |
<!-- rebase-cms-props:end -->

Les collections du panneau sont composées dans cet ordre, qui est également celui de la
navigation : chaque table servie (avec sa personnalisation, puis les préférences d'interface
de l'espace de travail et de l'utilisateur appliquées), puis les `externalCollections`. Un slug
ne désigne qu'une seule collection :

| Collision | Conséquence |
|---|---|
| deux résultats `customizeTable` pour un même slug | lève une exception : fusionnez-les en un seul |
| une collection externe et une table servie, ou une autre collection externe | le panneau affiche une erreur de chargement nommant les deux ; attribuez un autre slug à l'une d'elles |

La manière dont le panneau attend les tables et ce qu'il affiche lorsqu'elles ne peuvent pas
être chargées est détaillée dans [Tables in the CMS](/docs/collections/#loading-and-errors).

## Le provider Rebase

`<Rebase>` est le provider racine qui rend toutes les fonctionnalités de Rebase disponibles pour les composants enfants via le contexte. Il accepte :

L'ensemble des vingt-trois props au complet — le tableau n'en listait auparavant que dix, et deux d'entre
elles n'étaient même jamais lues par le composant :

<!-- rebase-props:start -->
| Prop | Description |
|------|-------------|
| `children` | Les composants racines de l'administration — `<RebaseCMS>`, `<RebaseStudio>`, `<RebaseShell>`. Une fonction de rendu sert d'échappatoire pour une mise en page manuelle. |
| `apiUrl` | URL de base de l'API backend, rendue disponible pour chaque hook via `useApiConfig()` |
| `dateTimeFormat` | Comment les dates sont affichées. Par défaut `MMMM dd, yyyy, HH:mm:ss` |
| `locale` | Langue initiale de l'administration et locale dans laquelle les dates sont formatées — voir [Traductions](/docs/frontend/i18n) |
| `client` | Instance de `RebaseClient` : la source par défaut pour les données, l'authentification et le stockage |
| `dataSources` | Sources de données supplémentaires, pour les collections qui en désignent une — voir [Sources multiples](/docs/backend/multiple-sources) |
| `authController` | État et méthodes d'authentification. Remplace directement la souscription à `client.auth` |
| `storageSource` | La source de stockage par défaut, surchargeant `client.storage` |
| `storageSources` | Sources de stockage nommées au-delà de celle par défaut |
| `databaseAdmin` | Opérations administratives sur la base de données (SQL, découverte de schéma). Seul Studio en a besoin |
| `userConfigPersistence` | Préférences d'interface locales — largeurs de colonnes, groupes réduits |
| `onAnalyticsEvent` | Appelé pour chaque événement d'analyse émis par l'administration |
| `entityLinkBuilder` | `({ row, id, path }) => string`: l'URL du bouton "ouvrir dans votre application" sur un enregistrement, à partir de l'enregistrement tel que le serveur envoie la ligne |
| `plugins` | Instances de plugins — voir [Plugins](/docs/plugins) |
| `slots` | Contributions de slots déclarées directement, sans plugin |
| `propertyConfigs` | Widgets de champs personnalisés, indexés par le nom qu'un champ spécifie dans `propertyConfig` |
| `entityViews` | Onglets de vue d'entité personnalisés, disponibles pour toute table mentionnant leur `key` dans ses `entityViews` |
| `collectionViews` | Modes de vue de collection personnalisés, disponibles pour toute collection par `key` |
| `entityActions` | Actions d'entité, disponibles pour toute table mentionnant leur `key` dans ses `entityActions` |
| `effectiveRoleController` | Simuler un rôle différent lorsque le mode dev est actif |
| `simulateAccess` | Afficher « Simuler l'accès », le contrôle d'administrateur qui exécute chaque vue de données en tant que rôle, utilisateur ou clé de service, en lecture seule, par rapport aux politiques réelles de sécurité au niveau des lignes (RLS). Désactivé sauf si `true` |
| `modeController` | Confier à Rebase le mode clair/sombre de l'application hôte ; Rebase ne touche alors jamais à `<html>`, `prefers-color-scheme` ou localStorage — voir [Styles](#styles) |
| `translations` | Surcharger ou étendre n'importe quelle chaîne de l'interface, indexée par locale — voir [Traductions](/docs/frontend/i18n) |
| `components` | Remplacer les composants intégrés — voir [Surcharges de composants](/docs/frontend/component-overrides) |
<!-- rebase-props:end -->

Les contrôleurs de navigation, d'URL et de registre de collections ne sont **pas** des props
de `<Rebase>` — ils sont construits par les hooks ci-dessous et consommés à l'intérieur de l'arbre d'administration
(`<RebaseShell>` les connecte pour vous dans le scaffold par défaut).

Le préfixe d'URL non plus. Lorsque l'administration est montée sous un chemin, cela se configure
sur `<RebaseCMS basePath="/admin">`, qui résout les URL vers les collections —
et uniquement lorsque le routeur n'a pas son propre `basename`. Voir
[Changing the Base URL](/docs/getting-started/deployment#changing-the-base-url).

## Une structure de données unique

Votre code reçoit les lignes telles que le serveur les envoie, où qu'il les demande : `client.data`,
`context.data` (aussi bien dans un callback backend que dans le navigateur), `useRows`,
`useRow` et `useRowWrites`, le `data` des constructeurs de collections et de vues, ainsi que ce qui
est transmis aux `browserCallbacks` d'une table. Une ligne est un objet plat : `row.title`,
une date sous forme de chaîne ISO, une relation belongsTo sous forme de colonne de clé étrangère.

```tsx
// Anywhere, including outside React.
const { data: posts } = await client.data.posts.find();
posts[0].title;

// Inside the <Rebase> tree: the same rows, kept current after every write.
const { rows } = useRows("posts");
rows[0].title;
```

L'administration elle-même effectue le rendu d'un view model `Entity` — le wrapper `id` / `path` / `values`
à partir duquel ses vues de collections et ses formulaires effectuent leur affichage, avec les dates sous forme d'objets `Date` et une
relation sous forme d'`EntityRelation` (les classes de valeurs `EntityRelation`, `EntityReference`,
`GeoPoint` et `Vector` proviennent de `@rebasepro/cms-types`). Avant chaque écriture et
chaque filtre, l'administration le convertit en valeurs réseau dans le navigateur — les relations sous forme de
clés, les vecteurs sous forme de listes de nombres, les points sous forme de `{ latitude, longitude }`, les dates sous forme de texte ISO — afin que le serveur voie ce que n'importe quel autre client envoie. Cette couche est propre à l'administration et ne fait pas partie de
la surface publique : une action d'entité, un résolveur d'affichage, le `tableController.rows` d'un
`Builder` de mode de vue, la sélection d'une action de collection et un slot
reçoivent tous des lignes, avec l'identifiant de chaque enregistrement à côté de sa ligne. Vous ne rencontrez `Entity` que dans une copie de l'une des
parties propres à l'administration (`Collection.Table`, une carte), à laquelle l'enregistrement est transmis tel que l'administration
l'affiche. Les valeurs d'un formulaire sont celles de l'éditeur : des objets `Date` et des relations, tels qu'un champ
les édite.

## Une collection ou un enregistrement dans votre propre page

Vous n'avez pas besoin de toute l'administration pour afficher une seule table. `<CollectionPanel>`,
`<RecordForm>`, `<RecordDetail>` et `<FieldValue>` fonctionnent n'importe où sous
`<Rebase>` et un routeur React Router, sans aucun `<RebaseCMS>`,
`<RebaseNavigation>` ou `<RebaseShell>` : une collection avec les colonnes et la
barre d'outils de votre choix, le formulaire d'un enregistrement avec seulement certains champs ou votre propre
disposition, un enregistrement en lecture seule, ou une valeur affichée telle que l'administration l'affiche. Voir
[Panels in a page of your own](/docs/frontend/panels).

## Avancé : disposition manuelle

Tout ce qui suit remplace `<RebaseShell>`. Vous n'en avez besoin que lorsque la mise en
page par défaut est gênante — un habillage différent autour de l'administration, votre propre arbre de
routes, une application où l'administration n'est qu'une page parmi d'autres. Si vous ne
remplacez pas la disposition, arrêtez-vous à [Vues personnalisées](#vues-personnalisées).

`<RebaseShell>` est un sucre syntaxique pour quatre couches, et vous pouvez les adopter une par une :

```tsx
<Rebase client={client} authController={authController}>
    <RebaseCMS tableCustomizations={tableCustomizations}/>
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
RebaseLayout`. `RebaseAuthGate` affiche la vue de connexion jusqu'à ce qu'un utilisateur soit présent, de
sorte que rien en dessous ne s'affiche pour un visiteur déconnecté ; `RebaseNavigation` construit
les contrôleurs de navigation, d'URL et de registre de collections que lisent `RebaseRouteDefs`
et chaque vue de collection, donc `RebaseRouteDefs` placé en dehors lève une erreur.
Pour intégrer une
vue de collection ou un formulaire d'enregistrement dans votre propre page, sans les
routes de l'administration, le composant plus léger `CollectionsProvider` construit ces contrôleurs
à la place — voir
[Panels in a page of your own](/docs/frontend/panels).

Chaque couche est utilisable séparément. `<RebaseAuthGate>` seul protège votre propre application
derrière l'authentification de Rebase. Remplacez `<RebaseLayout>` par votre propre composant pour conserver le
routage tout en retirant l'habillage ; supprimez également `<RebaseRouteDefs>` et vous construisez
vous-même les routes à partir des composants de la section
[Composants de scaffold](#composants-de-scaffold).

En deçà de ce niveau, `<Rebase>` accepte également une **render prop** au lieu d'enfants,
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

À ce stade, rien n'est connecté automatiquement : vous construisez manuellement les contrôleurs ci-dessous
et effectuez vous-même le rendu des routes.

### Contrôleurs

Les contrôleurs sont des hooks React qui configurent des aspects spécifiques du framework.
`<RebaseNavigation>` les appelle tous pour vous — ne recourez à ceux-ci qu'au sein d'une
render prop.

#### `useBuildNavigationStateController`

Le contrôleur principal qui relie tout l'ensemble :

Son `data` correspond à ce qui est transmis aux constructeurs de collections et de vues : l'objet plat
`context.data` du `<Rebase>` englobant (voir [Une structure de données unique](#une-structure-de-données-unique)),
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

Configure la génération d'URL :

```typescript
const urlController = useBuildUrlController({
    basePath: "/",
    baseCollectionPath: "/c",
    collectionRegistryController
});
```

#### `useBuildModeController`

Gère le thème clair/sombre. Lorsqu'il est activé, il gère le thème de la page : il ajoute
la classe `dark` sur `<html>`, suit `prefers-color-scheme` jusqu'à ce que l'utilisateur
choisisse un mode, et mémorise ce choix dans le localStorage.

```typescript
const modeController = useBuildModeController();

modeController.mode;             // "light" | "dark"
modeController.setMode("dark");  // "light" | "dark" | "system" — "system" follows the OS again
```

`<Rebase>` en construit un lui-même.

Lorsque le
composant qui l'utilise est démonté, il supprime la classe `dark` qu'il a ajoutée ; une classe
`dark` déjà présente sur la page est conservée. Ne construisez le vôtre
au-dessus de `<Rebase>` que si des composants en dehors ont également besoin du mode, et transmettez-le
avec la [prop `modeController`](#styles), afin d'avoir un seul contrôleur
et non deux. `useBuildModeController({ enabled: false })` construit un contrôleur inerte :
il conserve `mode` dans l'état React sans toucher à aucune classe, media query
ou localStorage. Lorsque votre application gère déjà le thème, vous n'avez pas du tout besoin de ce
hook : passez votre propre contrôleur en tant que `modeController`.

#### `useBuildAdminModeController`

Bascule entre les modes Studio et Content :

```typescript
const adminModeController = useBuildAdminModeController();
// Provides: adminModeController.mode ("cms" | "studio")
```

### Composants de scaffold

| Composant | Description |
|-----------|-------------|
| `<Scaffold>` | Conteneur de mise en page principal avec barre latérale responsive |
| `<AppBar>` | Barre de navigation supérieure avec recherche, bascule de mode, menu utilisateur |
| `<Drawer>` | Navigation latérale avec liste des collections et liens de vues |
| `<SideDialogs>` | Conteneur pour les éditeurs d'entités en panneau latéral |
| `<RebaseRoutes>` | Conteneur de routes s'intégrant avec React Router |
| `<RebaseRoute>` | Gère les routes de collections (`/c/*`) |
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

Transmettez-les à `<RebaseCMS>`, aux côtés de vos personnalisations — c'est le
composant qui enregistre la navigation :

```tsx
<RebaseCMS tableCustomizations={tableCustomizations} views={views}/>
```

| Champ | |
|---|---|
| `slug` | le chemin auquel elle est accessible, sous la racine de l'administration |
| `name` | le libellé dans le drawer et sur la page d'accueil |
| `view` | l'élément à afficher, ou un `ComponentType` pour un rendu différé (lazy) |
| `icon` | un nom d'icône [Lucide](https://lucide.dev/icons/), par ex. `"ShoppingCart"` — ou n'importe quel nœud |
| `group` | regroupe les vues dans le drawer ; `"Admin"` et `"Settings"` sont relégués en bas |
| `pinToBottom` | relègue le groupe en bas quel que soit son nom — à préférer aux deux chaînes magiques |
| `nestedRoutes` | enregistre également `slug/*`, pour une vue disposant de ses propres routes |
| `hideFromNavigation` | conserve la route, mais supprime l'entrée dans la navigation |
| `roles` | seuls les utilisateurs possédant l'un de ces rôles voient la vue ou peuvent y accéder |
| `description` | Markdown, affiché sur la carte de la page d'accueil |

Pour placer une vue sous **Studio** plutôt que sous le CMS, transmettez-la à
[`<RebaseStudio devViews>`](/docs/studio#adding-your-own-tool).

## Styles

Rebase utilise **Tailwind CSS v4** et prend en charge les modes clair/sombre. Personnalisez via :

- **Propriétés personnalisées CSS (custom properties)** — Surchargez les jetons de design (tokens)
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

Par défaut, `<Rebase>` prend en charge le thème de la page : il applique la classe `dark` sur
`<html>`, suit `prefers-color-scheme` jusqu'à ce que l'utilisateur choisisse un mode dans
l'administration, et mémorise ce choix dans le localStorage.

Lorsque `<Rebase>`
est démonté, il supprime la classe `dark` qu'il a ajoutée ; une classe déjà présente sur la page
est conservée.

Lorsque votre application
possède déjà un thème, transmettez-le via `modeController`. Rebase y lit la valeur de `mode`,
appelle sa fonction `setMode` depuis son propre sélecteur de thème, et ne touche jamais à `<html>`,
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

Le CSS du scaffold applique les styles du mode sombre sous tout élément portant la classe `dark`
(`@custom-variant dark (&:where(.dark, .dark *))`). Les panneaux latéraux, boîtes de dialogue et
menus s'affichent dans un portail sur `<body>`, placez donc la classe sur `<html>` ou `<body>`
plutôt que sur un conteneur autour de `<Rebase>`.

Envelopper `<Rebase>` dans un `ModeControllerProvider` ne produit pas cet effet :
`<Rebase>` fournit son propre contrôleur en interne.

## Prochaines étapes

- **[customizeTable](/docs/frontend/customize-table)** — Toutes les options d'une collection de table
- **[Champs personnalisés](/docs/frontend/custom-fields)** — Créez des champs de formulaire personnalisés
- **[Vues d'entités](/docs/frontend/entity-views)** — Ajoutez des onglets aux éditeurs d'entités
- **[Modes de vue](/docs/frontend/view-modes)** — Liste, Table, Cartes, Kanban
- **[Traductions](/docs/frontend/i18n)** — Modifiez n'importe quelle chaîne ou ajoutez une langue
- **[Plugins](/docs/plugins)** — Étendez le framework
