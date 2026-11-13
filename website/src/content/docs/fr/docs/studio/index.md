---
sourceHash: 7f137cdb15196a3e
title: Outils Studio
sidebar_label: Studio
description: Rebase Studio fournit des outils de développement pour l'édition visuelle de schémas, les requêtes SQL, les scripts JavaScript, la gestion des politiques RLS et l'exploration du stockage.
---

## Vue d'ensemble

Studio est le pendant développeur du panneau d'administration. La même application que votre
équipe de contenu utilise pour éditer des lignes intègre également un éditeur de schéma, une console SQL,
un bloc-notes JavaScript, un explorateur de politiques RLS et un navigateur de stockage — et Studio
est le mode qui les déverrouille. Rien à installer et rien à déployer : il est
déjà présent dans le panneau, derrière le bouton à bascule dans le menu latéral (drawer).

![L'éditeur de collections, l'outil phare de Studio : un éditeur visuel de schéma qui réécrit votre TypeScript](/img/collection_editor.png)

Il existe parce que l'alternative nécessite un second jeu d'identifiants. Modifier une
table, vérifier ce qu'une politique autorise réellement ou exécuter une requête sur
la production implique sinon un client de base de données, une copie de la chaîne de connexion
et une piste d'audit qui se résume à « quelqu'un avec psql ». Studio fait tout cela sous
l'identité de l'administrateur connecté, via les mêmes autorisations que celles utilisées par l'API.

## Les deux modes

Le panneau dispose de deux modes — `"cms" | "studio"` :

- **CMS** (`"cms"`) — Pour les éditeurs de contenu et les équipes opérationnelles. Affiche les tables et la gestion des données. Il s'agit du mode par défaut.
- **Studio** (`"studio"`) — Pour les développeurs. Déverrouille les outils ci-dessous.

Basculez entre eux avec le contrôleur de mode administrateur ou la bascule du drawer. Le
mode sélectionné est conservé dans `localStorage` sous la clé `rebase-admin-mode` ; un navigateur
ayant utilisé le panneau avant la version 0.17.0 conserve l'ancienne valeur `"content"` et est
migré vers `"cms"` à la lecture.

## Outils Studio intégrés

### Éditeur de collections

<span class="since-badge" data-since="0.31">Depuis 0.31</span>

Un éditeur visuel pour une table et sa présentation dans le panneau. Un enregistrement se divise en deux parties :

- **Faits relatifs au schéma (Schema facts)** — le type d'une colonne, sa nullabilité, sa valeur par défaut, sa validation, ses
  valeurs d'énumération, son stockage, ses relations, ses règles, sa description, son historique — deviennent des modifications `TablePatch`
  que l'éditeur de schéma du serveur écrit dans `backend/schema/<table>.ts`
  à l'aide de [ts-morph](https://ts-morph.com/), en ne modifiant que le code désigné par une modification
  et en laissant le reste du fichier intact : imports, commentaires, formatage,
  hooks, colonnes partagées. Une modification qui intervient dans du code — une colonne générée par
  un helper, des règles stockées dans une variable — est refusée en indiquant l'emplacement où l'effectuer. Une
  règle laissée inchangée est renvoyée exactement telle qu'elle a été reçue, de sorte que le nom de sa politique
  ne change jamais. Consultez [Édition de schéma en direct](/docs/backend/live-schema-editing/#the-edits-tablepatch).
- **Présentation** — libellés, icône, modes d'affichage, ordre des colonnes, colonnes masquées,
  largeurs, libellés et couleurs d'énumération, kanban, valeurs par défaut des requêtes — relève d'une préférence d'interface utilisateur,
  jamais d'une modification de schéma. Celles d'un administrateur s'appliquent à l'espace de travail : là où le serveur peut
  écrire dans le code source du projet, elles sont enregistrées dans `frontend/src/cms/ui-config.json`, et
  sur un déploiement dans la table `rebase.ui_preferences`, via
  `/api/admin/ui-config`. Les redimensionnements et changements de vue effectués par un utilisateur lui sont propres.

Un changement de slug, de table SQL ou de base de données est refusé en tant que migration. Une table dont
les règles proviennent de `defaultRls` demande confirmation avant d'adopter ses propres règles. Un appelant
recevant des règles caviardées obtient un éditeur en lecture seule. Un enregistrement que le serveur ne parvient pas
à compiler liste chaque problème en face du champ concerné, et rien n'est écrit.
Un fichier modifié sur le disque depuis sa lecture par l'éditeur propose un rechargement au lieu
d'écraser la modification (`SCHEMA_EDIT_STALE_FILE`). Un champ dont la définition est construite dans le code — un helper,
une variable partagée — est affiché en lecture seule, avec la raison correspondante. L'ordre des colonnes ne concerne
que la présentation : les réordonner ne déplace jamais une colonne dans la table. Il s'agit de la
capture d'écran en haut de cette page.

**Importer une table existante.** Une table présente dans la base de données mais non déclarée
dans `backend/schema` est listée sous « Import an existing table » ; en sélectionner une écrit
son fichier `defineTable` exactement comme la base de données la décrit — colonnes, clés,
index, sécurité au niveau des lignes — via la modification `adoptTable`. L'adoption ne change
rien dans la base de données : elle ne planifie aucun DDL, et la première étape de politique recrée
une fois une politique identique pour y apposer son empreinte. La posture de sécurité au niveau des lignes n'est jamais
rabaissée : une table avec le RLS désactivé, ou sans politiques, est adoptée avec
`rls: "admin-only"`, et la boîte de dialogue le précise. Une table sans clé primaire ne peut
pas être adoptée. Les routes sont `GET /api/admin/schema-editor/unmapped-tables` et
`GET /api/admin/schema-editor/unmapped-tables/:schema/:table`.

**Collections Firestore.** En développement, l'éditeur de collections édite également
les collections Firestore : un enregistrement réécrit sur place l'appel
`defineFirestoreCollection({...})` de la collection dans `frontend/src/cms`, en ne modifiant
que ce que vous avez édité. Les fonctions, les composants personnalisés, les commentaires et les imports restent
tels qu'ils ont été écrits ; les champs définis dans le code apparaissent en lecture seule. En production, les collections
Firestore sont en lecture seule dans l'éditeur. En créer une ou modifier son slug
se fait dans le code ; pour en supprimer une, supprimez son fichier ainsi que son
entrée dans `externalCollections`.

L'éditeur est activé partout où Studio est monté — le composant `<RebaseStudio/>` d'un scaffold
suffit, et aucune prop n'est requise. `collectionEditor` sert à le paramétrer plutôt
qu'à l'activer :

```tsx
import { RebaseCMS } from "@rebasepro/cms";
import { RebaseStudio } from "@rebasepro/studio";

// Studio is mounted, so the Collection Editor is available. Nothing else
// is needed for it.
<Rebase>
    <RebaseCMS tableCustomizations={tableCustomizations}/>
    <RebaseStudio/>
</Rebase>

// `collectionEditor` is for fine-tuning — a read-only editor, a different
// token — not for opting in.
<RebaseCMS
    tableCustomizations={tableCustomizations}
    collectionEditor={{
        getAuthToken: authController.getAuthToken
    }}
/>
```

Le fait qu'un *enregistrement* aboutisse relève de la décision du serveur, pas du panneau : l'éditeur
réécrit `backend/schema`, il est donc désactivé avec `NODE_ENV=production` (sauf si
[l'édition de schéma en direct](/docs/backend/live-schema-editing/) spécifie un dépôt),
en mode `baas`, et sur un serveur sans `schemaDir`. Le panneau interroge
`GET /api/admin/schema-editor/status` et affiche la raison renvoyée à côté du
bouton désactivé.

### Outils intégrés

<span class="since-badge" data-since="0.31">Depuis 0.31</span>

Chaque outil qui connaît le schéma lit les tables renvoyées par le serveur, depuis
`GET /api/schema/tables`, que le CMS soit présent ou non sur la page — ainsi, Studio fonctionne
comme la console d'un backend sans panneau d'administration. Face à un runtime antérieur à la version
0.31, qui ne dispose pas de cette route, les outils prenant en compte le schéma indiquent que le runtime doit être
mis à niveau plutôt que de faire des suppositions ; face à un backend sans authentification, ou
lorsque la requête échoue, chacun en précise la cause. La console SQL, les logs, le stockage et
les autres outils qui ne lisent pas le schéma fonctionnent quoi qu'il en soit.

Ceux-ci sont fournis avec Studio et sont **chargés à la demande (lazy-loaded) par `RebaseStudio`** — chacun constitue un
chunk distinct, récupéré la première fois que vous l'ouvrez. Ils ne peuvent pas être importés individuellement :
`@rebasepro/studio` n'exporte délibérément que l'orchestrateur, afin qu'une console que vous n'ouvrez jamais
ne coûte rien en ressources.

| Onglet | Slug | Groupe | Ce qu'il fait |
|-----|------|-------|--------------|
| SQL Console | `sql` | Database | Exécutez du SQL brut sur votre base de données PostgreSQL et consultez les résultats dans un tableau. Le tableau affiche le résultat de la dernière instruction, jusqu'aux 10 000 premières lignes ou 32 Mo de valeurs ; un résultat plus long indique le nombre total de lignes, et la copie ainsi que l'exportation n'incluent que les lignes affichées. Un tel résultat propose également **Download full result as CSV** : le serveur diffuse l'intégralité du résultat via un curseur en lecture seule (`POST /api/admin/sql/csv`), une requête à la fois, sur votre propre serveur Postgres plutôt que sur la base de données de développement intégrée au processus. Les valeurs correspondent au texte brut de la base de données, tel que psql les présente, et **Export JSON** les enregistre sous cette forme ; **Export typed JSON** écrit chaque valeur selon le type de sa colonne — entiers et numériques représentables exactement par un nombre JSON, booléens, `json`/`jsonb` en JSON — et conserve toute autre valeur sous forme de texte. Dans chaque CSV (export, copie et téléchargement complet), une valeur qu'un tableur interpréterait comme une formule (commençant par `=`, `+`, `-`, `@`, une tabulation ou un retour chariot, hors nombre signé) est précédée d'un `'`, tout comme pour l'export de collections. Pendant qu'une exécution est en cours, **Cancel run** redonne immédiatement la main à la console ; un serveur prenant en charge la trame `CANCEL_SQL` du socket (qui mentionne `cancel_sql` dans la réponse `hello` envoyée au socket) interrompt également l'instruction avec `pg_cancel_backend`. La base de données de développement intégrée au processus ne peut pas être interrompue, et un serveur plus ancien est laissé libre de terminer l'instruction dans la limite de son `statement_timeout` |
| RLS Policies | `rls` | Database | Inspectez et gérez les politiques de sécurité au niveau des lignes (Row Level Security) pour vos tables. La partie déclarée correspond à ce que le serveur a compilé à partir du `rls` de chaque table (fourni aux appelants disposant de `schema:read`), comparé à `pg_policies` selon la méthode utilisée par `rebase doctor` pour évaluer les dérives : une politique est affichée telle qu'elle existe dans la base de données, signalée par un badge **Differs from code** si elle ne correspond pas à la déclaration du projet, et une règle déclarée manquante dans la base de données est répertoriée comme non appliquée. Une politique générée par Rebase ne peut pas être modifiée directement dans la base de données, et sur une table gérée par Rebase, une bannière indique que chaque démarrage du serveur et `rebase db push` réappliquent les politiques déclarées. Un appelant sans `schema:read` voit ce que contient la base de données et est informé de la raison pour laquelle la déclaration n'est pas affichée |
| Schema Visualizer | `schema-visualizer` | Database | Diagramme entité-relation de vos tables et de leurs relations, généré à partir des descripteurs fournis : noms SQL, types Postgres, nullabilité, clés, valeurs d'énumération, clés étrangères et tables de jonction correspondent à ce que déclarent les tables. Seuls les indicateurs RLS sont lus depuis la base de données. Le calcul de la disposition s'exécute dans un web worker, ce qui permet à la page de rester réactive pendant l'organisation d'un grand diagramme. Un schéma de plus de 300 tables est affiché par voisinage de table — les tables situées à une ou deux relations de distance — en commençant par la table la plus connectée ; choisissez une autre table dans la liste pour vous déplacer |
| Branches | `branches` | Database | Créez et gérez des [branches de base de données](/docs/backend/branching), et examinez-en une comme une pull request : les modifications de son schéma et de ses politiques RLS côte à côte, les lignes insérées, mises à jour et supprimées, ainsi qu'une fusion dans la base de données d'origine qui détermine les priorités — voir [Examiner et fusionner une branche](/docs/backend/branching/#reviewing-and-merging-a-branch) |
| Backups | `backups` | Database | Parcourez et téléchargez les sauvegardes de la base de données |
| Logs Explorer | `logs` | Database | Journal des requêtes en direct, ainsi que tout ce que le serveur signale en avertissement (warn) ou erreur (error) — voir ci-dessous |
| JS Console | `js` | Compute | Écrivez et exécutez du JavaScript via le SDK Rebase. Un script reçoit `context.tables`, les descripteurs fournis (auparavant `context.collections`), et accède à une table via `client.data.<slug>` ou `client.data.table("<slug>")` |
| Cron Jobs | `cron` | Compute | Inspectez et gérez les [tâches planifiées](/docs/backend/cron-jobs) |
| Storage | `storage` | Storage | Parcourez, téléversez et gérez des fichiers sur l'ensemble de vos backends de stockage |
| API Explorer | `api` | API | Documentation interactive de l'API, avec un exécuteur de requêtes |
| API Keys | `api-keys` | Access Control | Créez et gérez des clés d'API de service avec portées (scopes) ; les cibles d'une portée `data:*` sont les tables servies |

### Ce qu'affiche l'explorateur de logs

Deux flux réunis dans un tampon circulaire (ring buffer) en mémoire, conservé sur le processus serveur :

- **Chaque requête** — méthode, chemin, statut, durée, le `X-Request-ID`, la
  table concernée le cas échéant, et, en cas d'échec de la requête, le `code`
  d'erreur et le message reçus par le client. Une requête ayant échoué est consignée au
  niveau `warn` (4xx) ou `error` (5xx), afin que le filtre de niveau puisse la retrouver.
  Sa `source` découle du chemin : `/api/auth/*` et `/api/oauth/*` correspondent à
  `auth`, `/api/storage/*` correspond à `storage`, et tout le reste correspond à `api`, de sorte que le
  filtre Source identifie les connexions sous Auth et les téléversements sous Storage.
- **Tout ce que le serveur signale au niveau warn ou error** — un avertissement de schéma, un
  refus d'authentification, un diagnostic de pilote, un échec de démarrage. La `source` provient du
  préfixe même du message (`[API]`, `[Auth]`, `[storage]`, `[realtime]`), et
  tout élément non reconnu est classé sous `system`.

Le bruit de fond des messages `info` de routine est délibérément omis. Le tampon contient 10 000 entrées
et un flot continu de statuts `200` évincerait les informations que vous êtes venu chercher dans le panneau.

Une fonction personnalisée qui lève une exception affiche donc son propre message ici, associé à la
requête qui l'a appelée — la raison d'être exacte de cet outil.

Ce tampon est propre à chaque processus et à chaque démarrage : il n'est pas persistant, n'est pas partagé
entre les réplicas, et un redémarrage le vide. Pour tout ce que vous devez conserver, consultez
le stdout du processus, qui contient les mêmes lignes et bien plus.

L'explorateur l'indique clairement. Il affiche le journal de l'unique instance de serveur qui
le dessert et nomme cette instance : l'événement `snapshot` de
`GET /api/admin/logs/stream` transmet `instance`, le `HOSTNAME` du processus (le
nom du pod sur Kubernetes, l'identifiant du conteneur sous Docker) ou sinon `pid-<n>`. Il
n'existe pas de vue unifiée sur l'ensemble des réplicas, ni sur les processus `functions` et `worker` d'un
[déploiement scindé](/docs/deployment/split-processes/). Une reconnexion qui aboutit sur
une autre instance remplace la fenêtre au lieu de mélanger les deux journaux.

L'**Éditeur de collections** est également un outil Studio, mais il ne figure pas dans cette liste car
son enregistrement diffère : `RebaseStudio` ne le charge pas à la demande. Le panneau le monte
partout où Studio et le CMS sont enregistrés, car contrairement aux outils ci-dessus, il
modifie aussi bien la présentation affichée par le CMS que le schéma. Il s'agit d'une différence dans la manière dont il
est monté, et non dans sa nature — il modifie le schéma et a toute sa place aux côtés des éditeurs SQL et
RLS.

## Activer Studio

Un seul composant, placé n'importe où à l'intérieur de `<Rebase>`. Il n'effectue aucun rendu visuel direct — il enregistre
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

Les outils apparaissent dans le drawer lorsque le mode Studio est actif. Si vous omettez totalement
`<RebaseStudio>`, vous déployez un CMS dédié uniquement au contenu : aucun mode Studio,
aucune bascule, rien chargé de manière différée.

## Ajouter votre propre outil

`devViews` place vos propres vues aux côtés des vues intégrées. Il s'agit d'[`AppView`](/docs/frontend#custom-views)s
ordinaires — la seule chose qui fait d'une vue un
outil Studio plutôt qu'une vue CMS est le composant sur lequel elle est enregistrée :

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

| Enregistré sur | Apparaît dans | Pour |
|---|---|---|
| `<RebaseCMS views>` | mode contenu | ce que les personnes éditant le contenu utilisent |
| `<RebaseStudio devViews>` | mode Studio | ce que vous utilisez pour gérer le backend |

Une vue appartient exactement à l'un d'eux — le drawer effectue le tri en fonction du composant qui
l'a enregistrée, donc déclarer un même slug dans les deux masque la vue du mode contenu.

Comme pour `tools`, la liste est évaluée en fonction de son *contenu* : la déclarer inline est sûr, et
un nouveau rendu du composant hôte ne remonte pas l'outil actuellement affiché à l'écran. Renommer une
vue ou modifier son groupe la réenregistre en revanche.

### Choisir les outils à afficher

Omettez `tools` et tous les outils ci-dessus seront enregistrés. Renseignez-le pour enregistrer un sous-ensemble —
par exemple, une console hébergée disposant de son propre navigateur de stockage peut omettre ce dernier :

```tsx
<RebaseStudio tools={["sql", "rls", "schema-visualizer", "api"]} />
```

La vue Studio de l'éditeur de collections correspond à l'outil `"schema"`. Omettez `tools` et
elle sera présente ; passez une liste sans `"schema"`, comme ci-dessus, et elle sera exclue.

La liste est lue selon son *contenu*, et non son identité de référence ; la déclarer inline est donc sans danger : un
nouveau rendu de l'hôte ne démonte ni ne remonte l'outil actuellement à l'écran.

## Prochaines étapes

- **[Plugins](/docs/plugins)** — Étendre le framework avec des plugins
- **[Tables](/docs/schema/)** — Déclarer les tables que Studio lit
- **[Personnaliser une table](/docs/frontend/customize-table/)** — Comment le panneau les affiche
