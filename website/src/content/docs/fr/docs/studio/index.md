---
sourceHash: 042c679d9fdfa2aa
title: Outils Studio
sidebar_label: Studio
description: Rebase Studio fournit des outils de développement pour les requêtes SQL, les scripts JavaScript, la gestion des politiques RLS, un diagramme de schéma et la navigation dans le stockage.
---

## Vue d'ensemble

Studio est la partie pour développeurs du panneau d'administration. La même application que votre
équipe de contenu utilise pour modifier des lignes intègre également une console SQL, un
bloc-notes JavaScript, un éditeur de politiques RLS, un diagramme de schéma et un explorateur
de stockage — et Studio est le mode qui les déverrouille. Rien à installer et rien à déployer :
il est déjà présent dans le panneau, derrière le sélecteur du tiroir latéral.

Il existe parce que l'alternative consiste à gérer un second ensemble d'identifiants. Sans lui,
modifier une table, vérifier ce qu'une politique autorise réellement ou exécuter une seule
requête en production implique un client de base de données, une copie de la chaîne de connexion
et une piste d'audit qui s'arrête à « quelqu'un avec psql ». Studio effectue tout cela sous
l'identité de l'administrateur connecté, grâce à la même autorisation que celle utilisée par l'API.

## Les deux modes

Le panneau propose deux modes — `"cms" | "studio"` :

- **CMS** (`"cms"`) — Pour les éditeurs de contenu et les équipes opérationnelles. Affiche les tables et la gestion des données. C'est le mode par défaut.
- **Studio** (`"studio"`) — Pour les développeurs. Déverrouille les outils ci-dessous.

Basculez entre eux à l'aide du contrôleur de mode administrateur ou du bouton bascule du tiroir. Le
mode sélectionné est conservé dans `localStorage` sous `rebase-admin-mode` ; un navigateur
ayant utilisé le panneau avant la version 0.17.0 conserve l'ancienne valeur `"content"` et est
migré vers `"cms"` à la lecture.

## Outils Studio intégrés

Le schéma d'une table est du code : `defineTable` dans `backend/schema`, ou — pour un
projet qui n'en déclare aucun — ce que contient la base de données, modifié par SQL ou par une
migration. Studio ne dispose pas d'éditeur visuel de tables ; l'outil Collections qui en était un
a été supprimé, car les colonnes d'une table et sa présentation dans le panneau avaient
été découplées, et un formulaire modifiant les deux ne correspondait plus à aucun des deux. L'éditeur
RLS enregistre toujours les politiques dans `backend/schema` en développement, via la
même étape planifier → confirmer → appliquer que pour l'[édition de schéma en direct](/docs/backend/live-schema-editing/).

### Outils intégrés

Chaque outil qui connaît le schéma lit les tables fournies par le serveur depuis
`GET /api/schema/tables`, que le CMS soit présent sur la page ou non — ainsi, Studio fonctionne
comme la console d'un backend dépourvu de panneau d'administration. Face à un runtime antérieur à la
version 0.31, qui ne possède pas cette route, les outils prenant en compte le schéma indiquent que le
runtime doit être mis à niveau plutôt que de faire des suppositions ; face à un backend sans
authentification, ou lorsque la requête échoue, chacun en indique la cause précise. La console SQL, les
journaux, le stockage et les autres outils qui ne lisent pas le schéma fonctionnent dans tous les cas.

Ils sont intégrés à Studio et sont **chargés à la demande (lazy-loaded) par `RebaseStudio`** — chacun constitue un
chunk distinct, récupéré la première fois que vous l'ouvrez. Ils ne peuvent pas être importés
individuellement : `@rebasepro/studio` n'exporte délibérément que l'orchestrateur, afin qu'une console
que vous n'ouvrez jamais ne coûte rien.

| Onglet | Slug | Groupe | Ce qu'il fait |
|-----|------|-------|--------------|
| Tables | `tables` | Base de données | Créer et modifier des tables PostgreSQL, colonnes, index et métadonnées de table (`rebase.table_meta`), modifier directement des lignes, et exposer des tables via REST, Realtime, OpenAPI et MCP sans aucun code |
| SQL Console | `sql` | Base de données | Exécutez du SQL brut sur votre base de données PostgreSQL et lisez les résultats dans un tableau. Le tableau affiche le résultat de la dernière instruction, jusqu'à ses 10 000 premières lignes ou 32 Mo de valeurs ; un résultat plus long indique le nombre total de lignes, et la copie ainsi que l'export n'incluent que les lignes affichées. Un tel résultat propose également **Download full result as CSV** : le serveur diffuse l'intégralité du résultat via un curseur en lecture seule (`POST /api/admin/sql/csv`), une requête à la fois, sur votre propre serveur Postgres plutôt que sur la base de données de développement en mémoire. Les valeurs correspondent au texte brut de la base de données, tel que psql les affiche, et **Export JSON** les écrit telles quelles ; **Export typed JSON** écrit chaque valeur lue selon le type de sa colonne — les entiers et numériques qu'un nombre JSON supporte exactement, les booléens, `json`/`jsonb` sous forme JSON — et conserve toute autre valeur sous forme de texte. Dans chaque CSV (export, copie et téléchargement complet), une valeur qu'un tableur exécuterait comme une formule (commençant par `=`, `+`, `-`, `@`, une tabulation ou un retour chariot, autre qu'un nombre signé) est écrite avec un `'` en tête, comme le fait l'export de collection. Pendant qu'une exécution est en cours, **Cancel run** rend immédiatement la main à la console ; un serveur prenant en charge la trame `CANCEL_SQL` du socket (il liste `cancel_sql` dans le message `hello` avec lequel il répond au socket) interrompt également l'instruction avec `pg_cancel_backend`. La base de données de développement in-process ne peut pas être interrompue, et un serveur plus ancien est laissé libre de terminer l'instruction dans la limite de son `statement_timeout` |
| RLS Policies | `rls` | Base de données | Inspectez et gérez les politiques de sécurité au niveau des lignes (Row Level Security) de vos tables. La partie déclarée correspond à ce que le serveur a compilé à partir du `rls` de chaque table (fourni aux appelants détenant `schema:read`), comparé à `pg_policies` de la même manière que `rebase doctor` évalue les dérives : une politique est listée telle qu'elle existe dans la base de données, avec le badge **Differs from code** si elle ne correspond pas à ce que le projet déclare, et une règle déclarée manquante dans la base de données est listée comme non appliquée. Une politique générée par Rebase ne peut pas être modifiée directement dans la base de données, et sur une table gérée par Rebase, une bannière indique que chaque démarrage du serveur et chaque commande `rebase db push` réappliquent les politiques déclarées. Un appelant sans `schema:read` voit ce que la base de données contient et est informé de la raison pour laquelle la déclaration n'est pas affichée |
| Schema Visualizer | `schema-visualizer` | Base de données | Diagramme entité-relation de vos tables et de leurs relations, tracé à partir des descripteurs fournis : les noms SQL, les types Postgres, la possibilité de valeur nulle, les clés, les valeurs d'énumération, les clés étrangères et les tables de jonction sont tels que les tables les déclarent. Seuls les marqueurs RLS sont lus depuis la base de données. La mise en page s'exécute dans un web worker, afin que la page reste fluide pendant l'organisation d'un diagramme volumineux. Un schéma de plus de 300 tables est tracé voisinage par voisinage — les tables situées à une ou deux relations de distance — en commençant par la table la plus connectée ; choisissez une autre table dans la liste pour vous déplacer |
| Branches | `branches` | Base de données | Créez et gérez des [branches de base de données](/docs/backend/branching), et examinez-en une comme une pull request : les modifications de son schéma et de ses politiques RLS côte à côte, les lignes qu'elle a insérées, mises à jour et supprimées, ainsi qu'une fusion dans la base de données d'origine indiquant les priorités — voir [Examiner et fusionner une branche](/docs/backend/branching/#reviewing-and-merging-a-branch) |
| Backups | `backups` | Base de données | Parcourez et téléchargez les sauvegardes de la base de données |
| Logs Explorer | `logs` | Base de données | Journal des requêtes en direct, ainsi que tout ce que le serveur signale au niveau warn ou error — voir ci-dessous |
| JS Console | `js` | Calcul | Écrivez et exécutez du JavaScript via le SDK Rebase. Un script reçoit `context.tables`, les descripteurs fournis (auparavant `context.collections`), et accède à une table via `client.data.<slug>` ou `client.data.table("<slug>")` |
| Cron Jobs | `cron` | Calcul | Inspectez et gérez les [tâches planifiées](/docs/backend/cron-jobs), y compris les tâches cron SQL et HTTP sans code |
| Storage | `storage` | Stockage | Parcourez, téléversez et gérez des fichiers sur l'ensemble de vos backends de stockage, et configurez des politiques d'accès au stockage déclaratives |
| API Explorer | `api` | API | Documentation interactive de l'API, avec un exécuteur de requêtes |
| Webhooks | `webhooks` | API | Configurez et testez les webhooks de base de données déclenchés lors d'insertions, de mises à jour et de suppressions de lignes |
| Users & Roles | `users` | Contrôle d'accès | Gérez les comptes d'utilisateurs, les attributions de rôles et les périmètres de rôles RBAC sans code |
| API Keys | `api-keys` | Contrôle d'accès | Créez et gérez des clés d'API de service restreintes (scoped) ; les cibles d'un scope `data:*` sont les tables servies |

### Ce que montre l'explorateur de journaux

Deux flux combinés dans un tampon circulaire en mémoire, maintenu sur le processus serveur :

- **Chaque requête** — méthode, chemin, statut, durée, le `X-Request-ID`, la
  table concernée le cas échéant, et, en cas d'échec de la requête, le `code`
  d'erreur et le message reçus par le client. Une requête ayant échoué est consignée
  avec le niveau `warn` (4xx) ou `error` (5xx), de sorte que le filtre de niveau la
  retrouve. Sa `source` provient du chemin d'accès : `/api/auth/*` et `/api/oauth/*`
  correspondent à `auth`, `/api/storage/*` à `storage`, et tout le reste à `api`, de sorte
  que le filtre Source classe les connexions sous Auth et les téléversements sous Storage.
- **Tout ce que le serveur signale comme avertissement ou erreur** — un avertissement de schéma, un
  refus d'authentification, un diagnostic de pilote, un échec au démarrage. La `source` provient du
  préfixe même du message (`[API]`, `[Auth]`, `[storage]`, `[realtime]`), et
  tout ce qui n'est pas reconnu est classé sous `system`.

Le bavardage habituel de niveau `info` est délibérément exclu. Le tampon conserve 10 000 entrées
et un mur de statuts `200` risquerait d'évincer les informations que vous êtes venu chercher dans le panneau.

Une fonction personnalisée qui lève une exception affiche donc son propre message ici, associé à la
requête qui l'a appelée — le cas d'usage précis pour lequel cet outil existe.

Le tampon circulaire est propre à chaque processus et à chaque démarrage : il n'est pas persistant, il n'est pas
partagé entre répliques, et un redémarrage le vide. Pour tout ce que vous devez conserver, consultez
la sortie standard (stdout) du processus, qui contient les mêmes lignes et bien plus encore.

L'explorateur l'indique clairement. Il affiche le journal de la seule instance de serveur qui le
dessert et nomme cette instance : l'événement `snapshot` de
`GET /api/admin/logs/stream` contient `instance`, qui correspond au `HOSTNAME` du processus (le
nom du pod sur Kubernetes, l'identifiant du conteneur sous Docker) ou sinon à `pid-<n>`. Il n'y
a pas de vue agrégée entre les répliques, ni sur les processus `functions` et `worker` d'un
[déploiement scindé](/docs/deployment/split-processes/). Une reconnexion qui aboutit sur
une autre instance remplace la fenêtre au lieu de mélanger les deux journaux.

## Activer Studio

Un seul composant, n'importe où dans `<Rebase>`. Il ne rend rien visuellement — il enregistre
les outils, et `<RebaseShell>` les affiche :

```tsx
import { RebaseStudio } from "@rebasepro/studio";

export function App() {
    return (
        <Rebase client={client} authController={authController}>
            <RebaseCMS tableCustomizations={tableCustomizations}/>
            <RebaseStudio/>
            <RebaseShell title="My App"/>
        </Rebase>
    );
}
```

Les outils apparaissent dans le tiroir latéral lorsque le mode Studio est actif. Si vous
omettez complètement `<RebaseStudio>`, vous déployez un CMS exclusivement dédié au contenu : pas de mode Studio,
pas de sélecteur de mode, rien de chargé à la demande.

## Ajouter votre propre outil

`devViews` place vos propres vues aux côtés des vues intégrées. Il s'agit de simples
[`AppView`](/docs/frontend#custom-views) — la seule différence entre un outil Studio
et une vue CMS réside dans le composant sur lequel il est enregistré :

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

| Enregistré sur | Apparaît dans | Destiné à |
|---|---|---|
| `<RebaseCMS views>` | mode contenu | ce qu'utilisent les personnes qui éditent le contenu |
| `<RebaseStudio devViews>` | mode Studio | ce que vous utilisez pour administrer le backend |

Une vue doit appartenir à un seul d'entre eux — le tiroir latéral trie selon le composant qui l'a
enregistrée, donc lister un slug dans les deux la masque du mode contenu.

Tout comme pour `tools`, la liste est analysée d'après son *contenu* : la déclarer en ligne est
sans danger, et un nouveau rendu du composant hôte ne démonte pas l'outil affiché à l'écran. Renommer une
vue ou modifier son groupe la réenregistre.

### Choisir les outils à afficher

Omettez `tools` et tous les outils ci-dessus seront enregistrés. Spécifiez-le pour n'en enregistrer qu'un sous-ensemble —
une console hébergée disposant de son propre navigateur de stockage peut, par exemple, exclure celui-ci :

```tsx
<RebaseStudio tools={["sql", "rls", "schema-visualizer", "api"]} />
```

`"schema"`, l'outil Collections, n'est plus accepté : l'outil a été supprimé.

La liste est analysée d'après son *contenu*, et non son identité de référence ; la déclarer en ligne est donc sans danger : un
nouveau rendu du composant hôte ne détruit pas ni ne remonte l'outil actuellement affiché à l'écran.

## Étapes suivantes

- **[Plugins](/docs/plugins)** — Étendre le framework avec des plugins
- **[Tables](/docs/schema/)** — Déclarer les tables lues par Studio
- **[Personnaliser une table](/docs/frontend/customize-table/)** — Comment le panneau les affiche
