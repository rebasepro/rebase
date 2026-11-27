---
sourceHash: 2def12479d23f2a9
title: Outils Studio
sidebar_label: Studio
description: Rebase Studio fournit des outils de développement pour les requêtes SQL, les scripts JavaScript, la gestion des politiques RLS, un diagramme de schéma et l'exploration du stockage.
---

## Vue d'ensemble

Studio est le volet développeur du panneau d'administration. La même application que
votre équipe de contenu utilise pour modifier des lignes contient également une console SQL,
un bac à sable JavaScript, un éditeur de politiques RLS, un diagramme de schéma et
un explorateur de stockage — et Studio est le mode qui les déverrouille. Rien à installer
ni à déployer : tout est déjà dans le panneau, derrière le bouton à bascule dans le tiroir latéral (drawer).

Il existe parce que l'alternative consiste à gérer un second ensemble d'identifiants. Modifier une
table, vérifier ce qu'une politique autorise réellement ou exécuter une seule requête en
production implique autrement un client de base de données, une copie de la chaîne de connexion
et une piste d'audit qui se résume à « quelqu'un avec psql ». Studio fait tout cela sous
l'identité de l'administrateur connecté, via les mêmes autorisations que celles utilisées par l'API.

## Les deux modes

Le panneau dispose de deux modes — `"cms" | "studio"` :

- **CMS** (`"cms"`) — Pour les éditeurs de contenu et les équipes opérationnelles. Affiche les tables et la gestion des données. Il s'agit du mode par défaut.
- **Studio** (`"studio"`) — Pour les développeurs. Déverrouille les outils ci-dessous.

Basculez entre eux à l'aide du contrôleur de mode administrateur ou du bouton d'activation dans le tiroir. Le
mode choisi est persisté dans `localStorage` sous la clé `rebase-admin-mode` ; un navigateur
qui utilisait le panneau avant la version 0.17.0 conserve l'ancienne valeur `"content"` et est
migré vers `"cms"` lors de la lecture.

## Outils Studio intégrés

Le schéma d'une table est du code : `defineTable` dans `backend/schema`, ou — pour un
projet qui n'en déclare aucun — ce que contient la base de données, modifié via SQL ou
une migration. Studio ne dispose pas d'éditeur visuel de tables ; l'outil Collections qui en
était un a été supprimé, car les colonnes d'une table et sa présentation dans le panneau avaient
été découplées, et un formulaire unique modifiant les deux ne correspondait plus à aucun des deux. L'éditeur
RLS enregistre toujours les politiques dans `backend/schema` en développement, via
la même étape plan → confirm → apply que la
[modification de schéma en direct](/docs/backend/live-schema-editing/).

### Outils intégrés

Chaque outil qui connaît le schéma lit les tables servies par le serveur, depuis
`GET /api/schema/tables`, avec ou sans le CMS sur la page — ainsi, Studio fonctionne
comme la console d'un backend sans panneau d'administration. Face à un runtime antérieur à la
version 0.31, qui ne possède pas cette route, les outils prenant en compte le schéma indiquent que le runtime
doit être mis à niveau plutôt que de faire des suppositions ; face à un backend sans authentification,
ou lorsque la requête échoue, chacun précise le problème rencontré. La console SQL, les journaux (logs), le stockage et
les autres outils qui ne lisent pas le schéma fonctionnent dans tous les cas.

Ceux-ci sont fournis avec Studio et sont **chargés à la demande (lazy-loaded) par `RebaseStudio`** — chacun constitue un
chunk distinct, récupéré la première fois que vous l'ouvrez. Ils ne peuvent pas être importés individuellement :
`@rebasepro/studio` n'exporte délibérément que l'orchestrateur, de sorte qu'une console que vous
n'ouvrez jamais ne coûte rien.

| Onglet | Slug | Groupe | Description |
|-----|------|-------|--------------|
| Tables | `tables` | Base de données | Chaque table et vue du schéma. Pour celle sélectionnée : **Données** lit ses lignes en tant que propriétaire de la base de données via `/api/admin/db` (tables non servies et vues comprises) avec pagination, tri et filtres côté serveur, des cellules de clé étrangère qui ouvrent la ligne visée, un visualiseur de valeurs, des modifications en ligne et groupées, l'import et l'export CSV, et **Lire en tant que** un utilisateur de l'API montre les lignes que sa sécurité au niveau des lignes renvoie ; **Structure** modifie les colonnes (nom, type, nullabilité, valeur par défaut), les index (avec taille et parcours), les contraintes (clé étrangère, unique, vérification) et les triggers ; **Policies** est l'éditeur de l'outil Policies pour cette table, avec ses droits ; **Relations** liste les clés étrangères dans les deux sens et dessine le voisinage de la table ; **Statistiques** affiche les tailles, l'estimation du nombre de lignes, les parcours, les lignes mortes et les derniers vacuum et analyze, avec **Analyser** et **Vacuum** ; **Paramètres** contient les métadonnées de la table (`rebase.table_meta`), le renommage et la suppression. **Voir le SQL** montre la définition de la table en un seul script. Un sélecteur au-dessus de la liste dessine tout le schéma en **Diagramme**. Chaque modification du schéma montre d'abord le SQL qu'elle exécutera. La sélection vit dans l'URL (`?table=schema.name&tableTab=…`), si bien que d'autres vues pointent directement vers une table Sur la table d'authentification, chaque ligne réinitialise aussi le mot de passe ou la validation en deux étapes du compte et désactive ou réactive le compte, comme le fait la collection des utilisateurs dans le panneau d'administration. |
| Éditeur SQL | `sql` | Base de données | Exécutez du SQL brut sur votre base de données PostgreSQL et lisez les résultats dans un tableau. Chaque instruction d'une exécution a son propre onglet de résultat, avec sa commande et son nombre de lignes, et les instructions partagent un budget de 10 000 lignes ou 32 Mo de valeurs ; un résultat plus long indique le nombre total de lignes, et la copie ainsi que l'exportation n'incluent que les lignes affichées. Un tel résultat propose également l'option **Download full result as CSV** : le serveur diffuse l'intégralité de celui-ci via un curseur en lecture seule (`POST /api/admin/sql/csv`), une requête à la fois, sur votre propre serveur Postgres plutôt que sur la base de données de développement intégrée au processus. Les valeurs correspondent au texte brut de la base de données, tel que psql les affiche, et **Export JSON** les écrit ainsi ; **Export typed JSON** écrit chaque valeur lue selon le type de sa colonne — les entiers et numériques qu'un nombre JSON gère exactement, les booléens, `json`/`jsonb` sous forme de JSON — et conserve toute autre valeur sous forme de texte. Dans chaque fichier CSV (exportation, copie et téléchargement complet), toute valeur qu'un tableur interpréterait comme une formule (commençant par `=`, `+`, `-`, `@`, une tabulation ou un retour chariot, en dehors d'un nombre signé) est précédée d'un `'`, comme l'écrit l'exportation de collection. Pendant qu'une exécution est en cours, **Cancel run** rend la main immédiatement à la console ; un serveur acceptant la trame `CANCEL_SQL` du socket (il indique `cancel_sql` dans le `hello` qu'il renvoie au socket) interrompt également l'instruction avec `pg_cancel_backend`. La base de données de développement intégrée au processus ne peut pas être interrompue, et un serveur plus ancien est laissé libre de terminer l'instruction dans la limite de son `statement_timeout`. **Explain analyze** exécute une instruction dans une transaction qu'il annule et affiche pour chaque étape le temps réel, les lignes, les boucles et les buffers. Un paramètre `:name` reçoit un champ au-dessus de l'éditeur. Les extraits sont enregistrés dans le projet, partagés ou personnels, et un résultat peut être dessiné en graphique à barres ou en courbe. |
| Politiques | `rls` | Base de données | Inspectez et gérez les politiques de sécurité au niveau des lignes (Row Level Security - RLS) pour vos tables. La partie déclarée correspond à ce que le serveur a compilé à partir du `rls` de chaque table (servi aux appelants disposant de `schema:read`), comparé à `pg_policies` de la manière dont `rebase doctor` évalue la dérive (drift) : une politique est listée telle que la base de données la détient, marquée du badge **Differs from code** lorsqu'elle ne correspond pas à ce que le projet déclare, et une règle déclarée absente de la base de données est listée comme non appliquée. Une politique générée par Rebase ne peut pas être modifiée directement dans la base de données, et sur une table gérée par Rebase, une bannière indique que chaque démarrage du serveur et chaque `rebase db push` réappliquent les politiques déclarées. Un appelant sans `schema:read` voit ce que contient la base de données et est informé de la raison pour laquelle la déclaration n'est pas affichée |
| Schéma | `schema-visualizer` | Base de données | Diagramme entité-association de vos tables et de leurs relations : les descripteurs servis (noms SQL, types Postgres, clés, valeurs d'énumération, clés étrangères, tables de jonction) et, sur un backend qui sert `/api/admin/db`, le catalogue de la base de données — les tables que le serveur ne sert pas, dessinées comme non servies, et les clés étrangères que le code ne déclare pas. Là où l'outil Tables est enregistré, le diagramme est son mode **Diagramme**, et cet outil reste hors de la navigation tandis que sa route continue de fonctionner. La mise en page tourne dans un web worker, la page reste donc réactive pendant qu'un grand diagramme est disposé. Un schéma de plus de 300 tables est dessiné un voisinage à la fois — les tables à une ou deux relations — en partant de la table la plus connectée |
| Branches | `branches` | Base de données | Créez et gérez des [branches de base de données](/docs/backend/branching), et examinez-en une comme une pull request : les modifications de schéma et de politiques RLS côte à côte, les lignes insérées, mises à jour et supprimées, ainsi qu'une fusion dans la base de données d'origine indiquant les priorités — voir [Examiner et fusionner une branche](/docs/backend/branching/#reviewing-and-merging-a-branch) |
| Sauvegardes | `backups` | Base de données | Parcourir et télécharger les sauvegardes de base de données |
| Base de données | `database` | Base de données | La base de données dans son ensemble. **Advisors** liste les constats de sécurité de [`rls-check`](/docs/rls-check) et de performance — index inutilisés et en double, clés étrangères sans index, tables sans clé primaire, grandes tables lues par parcours complet, tables chargées de lignes mortes et recherches qui lisent toute une grande table —, chacun avec le SQL qui le corrige, à ouvrir dans l'éditeur SQL. **Query performance** affiche les principales requêtes de `pg_stat_statements` par temps total, temps moyen ou appels, et installe l'extension là où le serveur la fournit. **Activity** liste les sessions de cette base qui font quelque chose, rafraîchies toutes les cinq secondes tant qu'elle est ouverte, avec ce que chacune attend et la session qui la bloque ; une requête peut être annulée et une session terminée. **Functions**, **Triggers**, **Types** et **Extensions** listent ces objets, suppriment une fonction, ajoutent une valeur à un enum, et installent ou suppriment une extension, chacun prévisualisant d'abord son SQL. Quand le backend sert plus d'une base (celle par défaut et chacune déclarée avec `database("…")`), un sélecteur dans l'en-tête choisit celle que chaque section lit et modifie. La base de développement intégrée ne collecte pas de statistiques de requêtes et n'a pas d'autres sessions |
| Console JS | `js` | Calcul | Écrivez et exécutez du code JavaScript via le SDK Rebase. Un script reçoit `context.tables`, les descripteurs servis (auparavant `context.collections`), et accède à une table via `client.data.<slug>` ou `client.data.table("<slug>")` |
| Tâches planifiées | `cron` | Calcul | Inspectez et gérez les [tâches planifiées](/docs/backend/cron-jobs), y compris les tâches cron SQL et HTTP sans code |
| Stockage | `storage` | Stockage | Parcourez, téléversez et gérez des fichiers sur vos backends de stockage, et configurez des politiques d'accès au stockage déclaratives |
| API | `api` | API | Documentation interactive de l'API, avec un exécuteur de requêtes |
| Webhooks | `webhooks` | API | Configurer et tester les webhooks de base de données déclenchés lors des insertions, modifications et suppressions de lignes |
| Journaux | `logs` | API | Journal des requêtes en direct, ainsi que tout ce que le serveur signale en avertissement ou erreur — voir ci-dessous |
| Rôles | `roles` | Contrôle d'accès | Les rôles des utilisateurs et les scopes que chacun accorde : ceux déclarés dans le code, en lecture seule, et ceux créés à l'exécution, qu'il crée, modifie et supprime. Quel utilisateur détient quel rôle se modifie dans la collection des utilisateurs. `users`, son ancien nom de quand il listait aussi les comptes, fonctionne toujours |
| Clés d'API | `api-keys` | Contrôle d'accès | Créer et gérer des clés d'API de service délimitées ; les cibles d'une portée `data:*` sont les tables servies |

### Ce qu'affiche la vue Journaux

Deux flux réunis dans un tampon circulaire (ring buffer) en mémoire, conservé sur le processus serveur :

- **Chaque requête** — méthode, chemin, statut, durée, le `X-Request-ID`, la
  table concernée le cas échéant et, en cas d'échec de la requête, le `code`
  d'erreur et le message reçus par le client. Une requête ayant échoué est enregistrée au
  niveau `warn` (4xx) ou `error` (5xx), ce qui permet au filtre de niveau de la trouver.
  Sa `source` provient du chemin : `/api/auth/*` et `/api/oauth/*` correspondent à
  `auth`, `/api/storage/*` à `storage`, et tout le reste à `api`, de sorte que le
  filtre Source trouve les connexions sous Auth et les téléversements sous Storage.
- **Tout ce que le serveur signale en avertissement (warn) ou erreur (error)** — un avertissement de schéma, un
  refus d'authentification, un diagnostic de pilote, un échec de démarrage. La `source` provient du
  préfixe même du message (`[API]`, `[Auth]`, `[storage]`, `[realtime]`), et
  tout élément non reconnu est classé en `system`.

Le bavardage habituel des événements `info` est délibérément exclu. Le tampon conserve 10 000 entrées,
et un flot ininterrompu de statuts `200` évincerait les informations que vous êtes venu chercher dans le panneau.

Une fonction personnalisée qui lève une exception affiche donc son propre message ici, associé à la
requête qui l'a appelée — c'est précisément la raison d'être de cette vue.

Le tampon est propre à chaque processus et à chaque démarrage : il n'est pas persistant, n'est pas partagé
entre les réplicas, et un redémarrage le vide. Pour tout ce que vous devez conserver, consultez
la sortie standard (stdout) du processus, qui contient les mêmes lignes et bien plus.

L'explorateur l'indique clairement. Il affiche le journal de l'instance de serveur unique qui
le sert et nomme cette instance : l'événement `snapshot` de
`GET /api/admin/logs/stream` transporte `instance`, qui correspond au `HOSTNAME` du processus (le
nom du pod sur Kubernetes, l'identifiant du conteneur sous Docker) ou bien à `pid-<n>`. Il
n'y a pas de vue agrégée entre réplicas, ni sur les processus `functions` et `worker` d'un
[déploiement scindé](/docs/deployment/split-processes/). Une reconnexion qui aboutit sur
une autre instance remplace la fenêtre au lieu de mélanger les deux journaux.

## Activer Studio

Un seul composant, n'importe où à l'intérieur de `<Rebase>`. Il ne génère aucun rendu visuel direct — il enregistre
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

Les outils apparaissent dans le tiroir lorsque le mode Studio est actif. Omettez
complètement `<RebaseStudio>` et vous livrez un CMS réservé au contenu : pas de mode Studio,
pas de bouton à bascule, aucun chargement différé.

## Ajouter votre propre outil

`devViews` place vos propres vues aux côtés des vues intégrées. Ce sont des
[`AppView`](/docs/frontend#custom-views) ordinaires — la seule chose qui différencie
un outil Studio d'une vue CMS est le composant sur lequel il est enregistré :

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
| `<RebaseCMS views>` | mode contenu | ce qu'utilisent les personnes chargées d'éditer le contenu |
| `<RebaseStudio devViews>` | mode Studio | ce que vous utilisez pour faire fonctionner le backend |

Une vue doit être ajoutée dans un seul d'entre eux — le tiroir effectue le tri en fonction du composant qui
l'a enregistrée ; ainsi, répertorier un slug dans les deux le masque du mode contenu.

Tout comme `tools`, la liste est lue selon son *contenu* : la définir inline est sûr, et
un nouveau rendu du composant hôte ne remonte pas l'outil actuellement affiché à l'écran. Renommer une
vue ou modifier son groupe la réenregistre en revanche.

### Choisir les outils à afficher

Omettez `tools` et chaque outil mentionné ci-dessus sera enregistré. Transmettez-le pour en enregistrer un sous-ensemble —
une console hébergée disposant de son propre explorateur de stockage peut, par exemple, exclure celui-ci :

```tsx
<RebaseStudio tools={["sql", "rls", "schema-visualizer", "api"]} />
```

`"schema"`, l'outil Collections, n'est plus accepté : l'outil a été supprimé.

La liste est lue par son *contenu*, et non par son identité de référence, il est donc sûr de la définir inline : un
nouveau rendu du composant hôte ne détruit ni ne remonte l'outil actuellement affiché à l'écran.

## Étapes suivantes

- **[Plugins](/docs/plugins)** — Étendre le framework avec des plugins
- **[Tables](/docs/schema/)** — Déclarer les tables lues par Studio
- **[Personnaliser une table](/docs/frontend/customize-table/)** — Comment le panneau les affiche
