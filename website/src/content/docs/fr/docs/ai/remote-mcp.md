---
sourceHash: aa952b8682070ef6
title: Le point de terminaison MCP distant
sidebar_label: Point de terminaison MCP distant
description: Servez MCP depuis un backend déployé sur /mcp, afin que les utilisateurs de votre application puissent connecter Claude ou Cursor en leur propre nom — OAuth avec écran de consentement, douze outils sous trois portées, chaque appel soumis à leur propre sécurité au niveau des lignes.
---

:::tip[Connecter Claude à vos propres projets ?]
C'est le rôle du [connecteur Rebase](/docs/ai/rebase-connector/) : un seul connecteur pour
l'ensemble de vos projets, et un serveur auto-hébergé le rejoint avec `rebase cloud connect`. Cette
page est destinée aux personnes qui **utilisent** votre application.
:::

Le [serveur MCP](/docs/ai/mcp/) est un outil de développement : il s'exécute sur votre machine et détient une clé de service ou une clé d'API. Un backend déployé peut également servir MCP lui-même, sur `/mcp`, pour les personnes qui utilisent votre application. Un assistant connecté par l'une d'elles lit et écrit dans le projet **en tant que cette personne**, et chaque appel s'exécute sous sa propre sécurité au niveau des lignes (RLS).

Il est désactivé par défaut, et les deux variables sont requises :

```bash
REBASE_MCP_ENABLED=true
REBASE_PUBLIC_URL=https://app.example.com   # this deployment's real origin
```

Sans `REBASE_PUBLIC_URL`, secret JWT ou pilote de données capable de restreindre une requête à un utilisateur, le point de terminaison refuse de se monter et en explique la raison dans le journal de démarrage. Aucun `REBASE_ROLE` ne l'active.

- **OAuth, avec un écran de consentement.** Un client trouve le serveur d'autorisation
  via `/.well-known/oauth-protected-resource`, s'enregistre (l'enregistrement
  dynamique est activé par défaut ; `REBASE_MCP_OPEN_REGISTRATION=false` le limite
  aux clients que vous enregistrez) et redirige la personne vers un écran de
  consentement qui la connecte via votre `/auth/login` existant. Un compte avec
  un second facteur est ensuite invité à saisir son code d'authentification ou un
  code de récupération, via les routes `/auth/mfa/challenge` existantes. Lorsque le
  propre frontend de votre application conserve une session dans le même navigateur,
  l'écran propose ce compte, et « Autoriser » donne son consentement sans mot de passe ;
  c'est ainsi qu'une personne se connectant uniquement avec Google, GitHub ou un
  lien par e-mail se connecte. Sinon, elle se connecte avec un mot de passe, et une
  personne qui n'en a pas en définit d'abord un avec `/auth/forgot-password`
  (« Mot de passe oublié » de votre application) ; l'écran le lui indique. Il
  mentionne également l'hôte auquel le code d'autorisation est envoyé et précise
  que cet hôte n'est pas vérifié : n'importe qui peut enregistrer un client sous
  n'importe quel nom, l'hôte est donc l'élément qu'une personne peut vérifier.
- **Douze outils, trois portées.** <span class="since-badge" data-since="0.29">Depuis la version 0.29</span> Les mêmes [portées](/docs/backend/roles-and-scopes/)
  que chaque identifiant utilise. `data:read` propose `list_collections`, `describe_collection`,
  `query_collection`, `count_documents`, `aggregate_documents`, `get_document` et les trois vues,
  `show_collection`, `show_record` et `show_app` ; `data:write` ajoute `create_document` et
  `update_document` ; `data:delete` ajoute `delete_document`. Un client qui ne demande
  rien obtient `data:read`. Chacune peut être restreinte à une collection : `data:read:posts`
  liste, décrit et lit `posts` et rien d'autre. Une portée détermine les outils proposés
  et les collections auxquelles ils ont accès, pas les lignes : une liste vide peut
  simplement signifier que la RLS fonctionne, et `data:write` ne peut toujours pas
  écrire une ligne à laquelle la personne n'aurait pas accès.
- **Trois outils mettent votre panneau d'administration à disposition de l'utilisateur.** Dans
  un client qui prend en charge les MCP Apps, comme Claude, ils ouvrent les vues
  propres au panneau d'administration directement dans la conversation, générées
  à partir de vos collections : leurs champs, énumérations, règles de validation,
  relations, sections de formulaire et paramètres d'affichage.
  - `show_collection` prend les arguments de `query_collection`, plus `view`
    (`table`, `list`, `cards` ou `kanban`), et ouvre la vue de la collection : la
    personne peut rechercher, filtrer, trier et paginer, ouvrir le formulaire d'une
    ligne et ajouter des lignes.
  - `show_record` ouvre le formulaire d'une ligne (`id`), ou un formulaire pour une
    nouvelle ligne pré-remplie à partir des valeurs (`values`) renseignées par le
    modèle, pour que la personne puisse vérifier et enregistrer elle-même.
  - `show_app` exécute une application que le modèle écrit pour la tâche en cours :
    un composant React (`code`) et les `collections` qu'il lit. Il importe les
    propres paquets de Rebase, de sorte que le même code fonctionne dans votre projet :
    - `@rebasepro/app` : `useRows`, `useRow`, `useRowCount`, `useAggregate`
      et `useRowWrites` sur les lignes du projet ;
    - `@rebasepro/cms` : le `CollectionPanel` du panneau d'administration (avec
      `CollectionToolbar` et ses éléments, ainsi que `onRowClick`, qui transmet à
      l'application la ligne cliquée telle que lue par `useRows`), `EntityFormPanel` et `FormField`,
      `RecordDetail`, `FieldValue` et `useSidePanel`, chacun désignant sa
      collection par son chemin, avec vos champs personnalisés, vues et actions ;
    - `@rebasepro/ui`, l'ensemble du kit d'interface utilisateur, `SplitView` ainsi que
      les tuiles d'indicateurs clés (KPI) et graphiques inclus.

    Le serveur le compile d'abord : ainsi, une erreur de syntaxe, un module que
    la vue ne fournit pas ou un nom qu'elle n'expose pas depuis `@rebasepro/cms` ou
    `@rebasepro/app` constitue l'erreur de l'appel, avec son numéro de ligne. Une
    erreur lors de son exécution s'affiche à sa place et est signalée au modèle
    avec le prochain message de la personne. Une application ne peut utiliser que
    les collections qu'elle liste. Ses styles reposent sur les classes utilitaires
    standard de Tailwind, compilées avec la vue avant l'arrivée de toute application :
    une valeur arbitraire telle que `h-[560px]` n'a aucun effet ici, une taille
    exacte doit donc être passée via `style`.

  Chaque lecture et enregistrement dans la vue correspond à l'appel de l'un des
  outils de lecture et d'écriture, effectué en tant que l'utilisateur sous sa RLS,
  de sorte qu'un formulaire ne propose que ce qui a été accordé à sa connexion :
  sans `data:write`, il est en lecture seule, et un champ que ses rôles ne peuvent
  pas lire n'y figure pas. C'est également la limite dans laquelle le code d'une
  application opère : il s'exécute dans la vue, donc chaque appel qu'il effectue
  passe par l'un de ces outils, en tant que l'utilisateur, et il ne peut rien faire
  que le modèle ne pourrait pas faire avec ces mêmes outils. Sur le connecteur hébergé,
  chaque écriture est également planifiée et confirmée par le serveur. Dans ce cadre,
  `useRowWrites` demande confirmation à la personne avant d'écrire, afin qu'une
  application n'écrive rien sans son clic ; les contrôles propres à l'administration
  (le bouton d'enregistrement d'un formulaire, une suppression, une modification
  dans un tableau) se comportent comme sur un écran `show_collection`. Le modèle est
  informé de ce qui a été modifié. Il lit les lignes renvoyées par chaque outil, et non
  les configurations de collection utilisées par la vue pour le rendu. Un client sans
  prise en charge des MCP Apps, tel que Claude Code ou Cursor, n'affiche rien,
  et le modèle lit les mêmes lignes qu'il obtiendrait via `query_collection`.
- **Les autorisations accordées avant la version 0.24 conservent leur portée.** `mcp:read`
  est interprété comme `data:read`, et `mcp:write` comme `data:write data:delete`,
  tant sur les autorisations enregistrées que sur les jetons déjà émis.
- **Une clé d'API fonctionne également.** `/mcp` accepte aussi `Authorization: Bearer rk_…`,
  pour un client configuré avec un en-tête plutôt qu'un flux OAuth. La clé a accès
  aux outils couverts par ses portées `data:*`, selon l'identité au nom de laquelle
  elle agit : une [clé personnelle](/docs/backend/api-keys/#personal-keys) en tant que
  son propriétaire, une clé de service en tant que `api-key:<id>`.
- **Le vocabulaire du SDK, les réponses de REST.** Les outils acceptent ce que le
  SDK accepte — `where` (`{"status": ["==", "paid"]}`), `orderBy` (`["created_at", "desc"]` ou
  `"created_at:desc"`), `limit`, `offset`, `searchString`, et `data` pour une
  écriture — et lisent via le chemin `GET /api/data/<collection>`, de sorte qu'une
  ligne est renvoyée telle que REST la sert (dates ISO, une relation `belongsTo` sous
  forme de sa clé étrangère, par ex. `authorId`) et peut être renvoyée telle quelle
  lors d'une mise à jour. `query_collection` répond `{ data, meta }` avec `meta.total`
  et `meta.hasMore`, et `count_documents` `{ count }`. `aggregate_documents` correspond
  à `GET /api/data/<collection>/aggregate` : `select` est une liste suivant la grammaire
  de REST (`["count()", "sum(total)"]`), `groupBy` une liste de champs, et il répond
  `{ data }` avec une ligne par groupe, plus `meta.hasMore` lors d'un appel groupé,
  dont les groupes se paginent avec `limit` et `offset` et se trient avec `orderBy`.
  Sur une collection qu'un rappel (callback) `afterRead` réécrit, il sert `count()` seul,
  comme le fait REST. Comme avec REST, une valeur de `limit` supérieure à 1000, un
  argument non déclaré et une modification ou suppression d'une ligne mise à la corbeille
  (404) sont refusés ; définir le champ de suppression réversible sur `null` la restaure.
  `deleted: "only"` (ou `"include"`) sur `query_collection`, `count_documents` et
  `aggregate_documents` lit la corbeille, tout comme `?deleted=` de REST, de sorte qu'une
  ligne mise à la corbeille par `delete_document` peut être retrouvée pour être restaurée.
  Sa description indique au modèle que la suppression n'est définitive que lorsque la
  collection ne possède pas de champ de suppression réversible.
- **Le listing nomme les collections ; `describe_collection` fournit le schéma de l'une d'elles.**
  `list_collections` renvoie le `name`, `title` et `description` de chaque collection,
  et `describe_collection { collection }` les schémas OpenAPI `row` et `create` de
  cette collection, ainsi que `softDeleteField` lorsque les lignes sont envoyées vers une
  corbeille. Les descriptions d'outils indiquent au modèle de décrire une collection
  avant d'y écrire. Le listing d'un projet de 200 collections représente environ 5 000 jetons,
  et chaque description moins de 1 000 ; avec l'ensemble des schémas dans le listing, cela
  représentait environ 150 000 jetons.
- **Un jeton réservé à ce point de terminaison.** Un jeton d'accès MCP est refusé par
  `/api/data`, `/api/admin` et le WebSocket ; ainsi, connecter un assistant ne lui
  confère pas une session complète.

Chaque requête vers `/mcp` relit le compte de la personne. Un compte supprimé ou désactivé,
ou une action « se déconnecter de partout » ou un changement de mot de passe après l'émission
du jeton, interrompt immédiatement un client connecté avec une erreur 401. Une rétrogradation
de droits s'applique dès son prochain appel d'outil. Chaque rafraîchissement effectue les
mêmes vérifications et refuse définitivement une telle autorisation. Une session invité ne
peut en aucun cas donner son consentement.

Une limite. La déconnexion d'un client (`DELETE /api/oauth/grants/:clientId`, avec la
propre session de la personne) révoque immédiatement ses jetons de rafraîchissement, mais
un jeton d'accès déjà émis continue de fonctionner jusqu'à son expiration, dans un délai
maximal d'une heure.

Les routes se trouvent dans [Endpoints](/docs/backend/endpoints/#mcp-surface) et les
variables dans [Configuration](/docs/getting-started/configuration/#mcp-surface).
