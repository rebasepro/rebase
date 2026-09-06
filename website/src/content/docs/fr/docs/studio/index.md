---
sourceHash: c9634d9fe5d4bd79
title: Outils du Studio
sidebar_label: Studio
description: Rebase Studio fournit des outils de développement pour l'édition visuelle de schémas, les requêtes SQL, le scripting JavaScript, la gestion des politiques RLS et la navigation dans le stockage.
---

## Aperçu

Studio est la moitié développeur du panneau d'administration. L'application même
dont votre équipe de contenu se sert pour éditer des lignes embarque aussi un
éditeur de schéma, une console SQL, un bloc-notes JavaScript, un navigateur de
politiques RLS et un navigateur de stockage — et Studio est le mode qui les
déverrouille. Rien à installer et rien à déployer : c'est déjà dans le panneau,
derrière le bouton du tiroir.

![L'éditeur de collections, l'outil phare de Studio : un éditeur de schéma visuel qui réécrit votre TypeScript](/img/collection_editor.png)

Il existe parce que l'alternative est un second jeu d'identifiants. Modifier une
collection, vérifier ce qu'une politique autorise réellement ou lancer une seule
requête sur la production suppose sinon un client de base de données, une copie
de la chaîne de connexion et une piste d'audit qui s'arrête à « quelqu'un avec
psql ». Studio fait tout cela en tant qu'administrateur connecté, via la même
autorisation que celle qu'utilise l'API.

## Les deux modes

Le panneau a deux modes — `"cms" | "studio"` :

- **CMS** (`"cms"`) — Pour les éditeurs de contenu et les équipes opérationnelles. Affiche les collections et la gestion des données. C'est la valeur par défaut.
- **Studio** (`"studio"`) — Pour les développeurs. Déverrouille les outils ci-dessous.

Basculez entre les deux avec le contrôleur de mode administrateur ou le bouton du
tiroir. Le mode choisi est conservé dans `localStorage` sous `rebase-admin-mode` ;
un navigateur qui a utilisé le panneau avant 0.17.0 détient l'ancienne valeur
`"content"` et est migré vers `"cms"` à la lecture.

## Outils Studio intégrés

### Éditeur de collection

Un éditeur de schéma visuel qui vous permet de créer et de modifier des collections via une interface utilisateur glisser-déposer. Lorsque vous enregistrez les modifications, il utilise [ts-morph](https://ts-morph.com/) pour mettre à jour vos fichiers sources TypeScript via la manipulation d'AST — en préservant tout le code existant et la logique personnalisée. C'est la capture d'écran en haut de cette page.

L'éditeur est actif partout où Studio est monté — le `<RebaseStudio/>` d'un scaffold suffit, et il n'y a aucune prop à ajouter. `collectionEditor` le règle, il ne l'active pas :

```tsx
import { RebaseCMS } from "@rebasepro/cms";
import { RebaseStudio } from "@rebasepro/studio";

// Studio est monté, donc l'éditeur de collections est disponible.
// Rien d'autre n'est nécessaire.
<Rebase>
    <RebaseCMS collections={collections}/>
    <RebaseStudio/>
</Rebase>

// `collectionEditor` sert au réglage — un éditeur en lecture seule,
// un autre jeton — pas à l'activation.
<RebaseCMS
    collections={collections}
    collectionEditor={{
        getAuthToken: authController.getAuthToken
    }}
/>
```

C'est le serveur, et non le panneau, qui décide si un *enregistrement* aboutit : l'éditeur réécrit les fichiers source des collections, il est donc désactivé sous `NODE_ENV=production`, en mode `baas` et sur un serveur sans `collectionsDir`. Le panneau interroge `GET /api/schema-editor/status` et affiche la raison reçue à côté du bouton désactivé.

### Outils intégrés

Ils sont fournis avec Studio et **chargés à la demande par `RebaseStudio`** — chacun forme un chunk distinct, récupéré à la première ouverture. Ils ne sont pas importables séparément : `@rebasepro/studio` n'exporte délibérément que l'orchestrateur, si bien qu'une console jamais ouverte ne coûte rien.

| Onglet | Slug | Groupe | Rôle |
|--------|------|--------|------|
| Console SQL | `sql` | Base de données | Exécuter du SQL brut sur votre base PostgreSQL et lire les résultats dans un tableau |
| Politiques RLS | `rls` | Base de données | Inspecter et gérer les politiques Row Level Security de vos tables |
| Visualiseur de schéma | `schema-visualizer` | Base de données | ERD interactif des tables et des relations |
| Branches | `branches` | Base de données | Créer et gérer des [branches de base de données](/docs/backend/branching) |
| Sauvegardes | `backups` | Base de données | Parcourir et télécharger les sauvegardes de la base |
| Explorateur de logs | `logs` | Base de données | Journal des requêtes en direct, plus tout ce que le serveur signale en warn ou error — voir ci-dessous |
| Console JS | `js` | Compute | Écrire et exécuter du JavaScript via le SDK Rebase |
| Tâches cron | `cron` | Compute | Inspecter et gérer les [tâches planifiées](/docs/backend/cron-jobs) |
| Stockage | `storage` | Storage | Parcourir, téléverser et gérer les fichiers de vos backends de stockage |
| Explorateur d'API | `api` | API | Documentation d'API interactive, avec un lanceur de requêtes |
| Clés d'API | `api-keys` | Contrôle d'accès | Créer et gérer des clés d'API de service à portée limitée |

### Ce que montre l'explorateur de logs

Deux flux dans un seul anneau en mémoire, tenu par le processus serveur :

- **Chaque requête** — méthode, chemin, statut, durée, le `X-Request-ID`, la
  collection lorsque la requête en concernait une, et, en cas d'échec, le `code`
  d'erreur et le message reçus par le client. Une requête en échec est
  enregistrée en `warn` (4xx) ou `error` (5xx), de sorte que le filtre de niveau
  la retrouve.
- **Tout ce que le serveur signale en warn ou error** — un avertissement de
  schéma, un refus d'authentification, un diagnostic de driver, un échec de
  démarrage. `source` provient du préfixe du message lui-même (`[API]`, `[Auth]`,
  `[storage]`, `[realtime]`), et tout ce qui n'est pas reconnu devient `system`.

Le bavardage `info` de routine est délibérément écarté. L'anneau contient 10 000
entrées et un mur de `200` évince précisément ce que vous étiez venu chercher.

Une fonction personnalisée qui lève une exception affiche donc son propre message
ici, en regard de la requête qui l'a appelée — le cas pour lequel tout ceci
existe.

L'anneau est par processus et par démarrage : il n'est pas durable, il n'est pas
partagé entre les réplicas, et un redémarrage le vide. Pour tout ce que vous
devez conserver, lisez la sortie standard du processus, qui porte les mêmes
lignes et davantage.

L'**éditeur de collection** est lui aussi un outil Studio, mais il ne figure pas
dans cette liste parce qu'il est enregistré autrement : `RebaseStudio` ne le
charge pas à la demande. Le panneau le monte partout où Studio est enregistré,
car contrairement aux outils ci-dessus il a besoin du code source des collections
du projet sous la main pour y réécrire. C'est une différence dans la manière dont
il est monté, pas dans ce qu'il est — il édite du schéma, et sa place est à côté
des éditeurs SQL et RLS.

## Activer Studio

Un composant, n'importe où à l'intérieur de `<Rebase>`. Il ne rend rien — il
enregistre les outils, et `<RebaseShell>` les dessine :

```tsx
import { RebaseStudio } from "@rebasepro/studio";

export function App() {
    return (
        <Rebase client={client} authController={authController}>
            <RebaseCMS collections={collections}/>
            <RebaseStudio/>
            <RebaseShell title="My App"/>
        </Rebase>
    );
}
```

Les outils apparaissent dans le tiroir tant que le mode Studio est actif. Omettez
entièrement `<RebaseStudio>` et vous livrez un CMS de contenu seul : pas de mode
Studio, pas de bouton, rien de chargé à la demande.

## Ajouter votre propre outil

`devViews` place vos propres vues à côté des vues intégrées. Ce sont des
[`AppView`](/docs/frontend#custom-views) ordinaires — la seule chose qui fait
d'une vue un outil Studio plutôt qu'une vue du CMS est le composant sur lequel
elle est enregistrée :

```tsx
import type { AppView } from "@rebasepro/cms-types";

const queues: AppView = {
    slug: "queues",
    name: "Queues",
    group: "Compute",
    icon: "ListOrdered",
    description: "Depth and failures, per queue",
    view: <QueuesView/>
};

<RebaseStudio devViews={[queues]}/>
```

| Enregistrée sur | Apparaît en | Pour |
|---|---|---|
| `<RebaseCMS views>` | mode contenu | ce dont se servent les personnes qui éditent le contenu |
| `<RebaseStudio devViews>` | mode Studio | ce dont vous vous servez pour exploiter le backend |

Une vue va dans exactement l'un des deux — le tiroir trie selon qui l'a
enregistrée, si bien que déclarer un slug dans les deux le fait disparaître du
mode contenu.

Comme `tools`, la liste est lue par son *contenu* : l'écrire en ligne est sans
risque, et un nouveau rendu de l'hôte ne remonte pas l'outil affiché. Renommer
une vue ou changer son groupe, en revanche, la réenregistre.

### Choisir les outils affichés

Omettez `tools` et tous les outils ci-dessus sont enregistrés. Passez-le pour
n'en enregistrer qu'un sous-ensemble — une console hébergée qui possède déjà son
propre navigateur de stockage peut par exemple laisser celui-ci de côté :

```tsx
<RebaseStudio tools={["sql", "rls", "schema-visualizer", "api"]} />
```

La liste est lue par son *contenu*, non par son identité, si bien que l'écrire en
ligne est sans risque : un nouveau rendu de l'hôte ne démonte ni ne remonte
l'outil affiché.

## Prochaines étapes

- **[Plugins](/docs/plugins)** — Étendez le framework avec des plugins
- **[Collections](/docs/collections)** — Configuration des collections
