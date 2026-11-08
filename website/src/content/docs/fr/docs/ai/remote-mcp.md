---
sourceHash: 166fe94f399384db
title: L'endpoint MCP distant
sidebar_label: Endpoint MCP distant
description: Servez MCP depuis un backend déployé sur /mcp, afin que les utilisateurs de votre application puissent connecter Claude ou Cursor en leur propre nom — OAuth avec écran de consentement, neuf outils sous trois portées, chaque appel soumis à leur propre sécurité au niveau des lignes.
---

:::tip[Vous connectez Claude à vos propres projets ?]
C'est le rôle du [connecteur Rebase](/docs/ai/rebase-connector/) : un seul connecteur pour
l'ensemble d'entre eux, qu'un serveur auto-hébergé rejoint avec `rebase cloud connect`. Cette
page s'adresse aux personnes qui **utilisent** votre application.
:::

Le [serveur MCP](/docs/ai/mcp/) est un outil de développement : il s'exécute sur votre machine et détient une clé
de service ou une clé API. Un backend déployé peut également servir MCP lui-même, sur `/mcp`, pour
les personnes qui utilisent votre application. Un assistant connecté par l'une d'elles lit et
écrit dans le projet **en tant que cette personne**, et chaque appel s'exécute sous sa propre
sécurité au niveau des lignes (RLS).

Il est désactivé par défaut, et les deux variables sont requises :

```bash
REBASE_MCP_ENABLED=true
REBASE_PUBLIC_URL=https://app.example.com   # this deployment's real origin
```

Sans `REBASE_PUBLIC_URL`, sans secret JWT ou sans pilote de données capable de restreindre une requête
à un seul utilisateur, l'endpoint refuse de se monter et en précise la raison dans le journal de démarrage. Aucun
`REBASE_ROLE` ne permet de l'activer.

- **OAuth, avec un écran de consentement.** Un client découvre le serveur d'autorisation
  via `/.well-known/oauth-protected-resource`, s'enregistre lui-même (l'enregistrement dynamique
  est activé par défaut ; `REBASE_MCP_OPEN_REGISTRATION=false` le limite aux clients que vous
  enregistrez), et redirige la personne vers un écran de consentement qui la connecte
  via votre route `/auth/login` existante. Un compte doté d'une authentification à deux facteurs
  est ensuite invité à renseigner son code d'authentification ou un code de récupération, via les
  routes `/auth/mfa/challenge` existantes. Lorsque le propre frontend de votre application
  conserve une session dans le même navigateur, l'écran propose ce compte, et
  « Autoriser » donne son accord sous cette identité sans mot de passe ; c'est ainsi que se connecte
  une personne s'authentifiant uniquement avec Google, GitHub ou un lien par e-mail. Dans le cas contraire,
  elle se connecte avec un mot de passe, et une personne n'en possédant pas en configure d'abord un avec
  `/auth/forgot-password` (« Mot de passe oublié » de votre application) ; l'écran le lui signale.
  Il mentionne également l'hôte auquel le code d'autorisation est transmis, et précise que cet
  hôte n'est pas vérifié : n'importe qui pouvant enregistrer un client sous n'importe quel nom,
  l'hôte est l'élément que la personne peut vérifier.
- **Douze outils, trois portées.** Les mêmes [portées](/docs/backend/roles-and-scopes/)
  que chaque identifiant utilise. `data:read` propose `list_collections`, `describe_collection`,
  `query_collection`, `count_documents`, `aggregate_documents`, `get_document` ainsi que les trois vues,
  `show_collection`, `show_record` et `show_app` ; `data:write` ajoute `create_document` et
  `update_document` ; `data:delete` ajoute `delete_document`. Un client qui ne demande rien
  reçoit `data:read`. Chacune d'entre elles peut être restreinte à une collection : `data:read:posts`
  liste, décrit et lit `posts` et rien d'autre. Une portée détermine quels outils sont proposés
  et quelles collections ils peuvent atteindre, pas quelles lignes : une liste vide peut simplement
  être le résultat du RLS en action, et `data:write` ne peut toujours pas écrire une ligne que la
  personne n'aurait pas le droit d'écrire.
- **Trois outils mettent votre panneau d'administration à la disposition directe de l'utilisateur.** Dans un client prenant
  en charge les MCP Apps, tel que Claude, ils ouvrent les vues propres au panneau d'administration au sein même de la
  conversation, générées à partir de vos collections : leurs champs, énumérations, règles de validation,
  relations, sections de formulaire et paramètres d'affichage.
  - `show_collection` prend les arguments de `query_collection`, plus `view`
    (`table`, `list`, `cards` ou `kanban`), et ouvre la vue de la collection : la
    personne peut rechercher, filtrer, trier et paginer, ouvrir le formulaire d'une ligne et ajouter des lignes.
  - `show_record` ouvre le formulaire d'une ligne (`id`), ou un formulaire pour une nouvelle ligne qui
    part des `values` préremplies par le modèle, afin que la personne puisse vérifier et
    enregistrer elle-même.
  - `show_app` exécute une application générée par le modèle pour la tâche en cours : un
    composant React (`code`) et les `collections` qu'il lit. Il importe les packages
    propres à Rebase, de sorte que le même code fonctionne dans votre projet :
    - `@rebasepro/app` : `useRows`, `useRow`, `useRowCount`, `useAggregate`
      et `useRowWrites` sur les lignes du projet ;
    - `@rebasepro/cms` : le `CollectionPanel` du panneau d'administration (avec
      `CollectionToolbar` et ses éléments, ainsi que `onRowClick`, qui transmet à
      l'application la ligne cliquée telle que `useRows` la lit), `EntityFormPanel` et `FormField`,
      `EntityViewPanel`, `FieldValue`, `useSidePanel` et
      `useCollectionRegistryController`, avec vos champs, vues et
      actions personnalisés ;
    - `@rebasepro/ui`, l'ensemble du kit UI, incluant `SplitView` ainsi que les tuiles de KPI et
      les graphiques.

    Le serveur le compile au préalable, de sorte qu'une erreur de syntaxe, un module non
    pris en charge par la vue, ou un nom non exposé par `@rebasepro/cms` ou
    `@rebasepro/app` constitue l'erreur de l'appel, avec son numéro de ligne. Une erreur survenant pendant
    l'exécution est affichée à son emplacement et signalée au modèle lors du message suivant de
    l'utilisateur. Une application ne peut utiliser que les collections qu'elle liste. Ses styles reposent
    sur les utilitaires standard de Tailwind, compilés avec la vue avant l'arrivée de la
    moindre application : une valeur arbitraire telle que `h-[560px]` n'y a aucun effet,
    une taille exacte doit donc être passée via un `style`.

  Chaque lecture et enregistrement dans la vue correspond à l'appel de l'un des outils de lecture et d'écriture,
  effectué sous l'identité de l'utilisateur et son RLS ; un formulaire ne propose ainsi que ce qui a été
  accordé à sa connexion : sans `data:write`, il est en lecture seule, et un champ que ses
  rôles ne permettent pas de lire n'y figure pas. Sur l'écran d'une application, une modification apportée
  par son code via `useRowWrites` est soumise à la confirmation de la personne avant d'être envoyée,
  car du code peut écrire sans nécessiter de clic ; une modification effectuée avec les propres contrôles
  de l'administration (le bouton Enregistrer d'un formulaire, une suppression, une édition dans un tableau) émane
  directement d'elle et n'est pas demandée à nouveau. Le modèle est informé de ce qui a été modifié. Il lit les lignes renvoyées par chaque outil, et non les configurations de collection servant au rendu de la vue. Un client dépourvu de support pour les MCP Apps, tel que Claude Code ou Cursor, n'affiche rien,
  et le modèle lit les mêmes lignes qu'il obtiendrait via `query_collection`.
- **Les autorisations accordées avant la version 0.24 conservent leur portée.** `mcp:read` est interprété comme
  `data:read`, et `mcp:write` comme `data:write data:delete`, pour les autorisations stockées et
  les jetons déjà émis.
- **Une clé API fonctionne également.** `/mcp` accepte aussi `Authorization: Bearer rk_…`, pour
  un client configuré avec un en-tête plutôt qu'avec un flux OAuth. La clé a accès
  aux outils couverts par ses portées `data:*`, selon l'identité qu'elle représente : une
  [clé personnelle](/docs/backend/api-keys/#personal-keys) agit en tant que son propriétaire, une clé de service
  en tant que `api-key:<id>`.
- **Le vocabulaire du SDK, les réponses de REST.** Les outils acceptent les mêmes paramètres que le SDK —
  `where` (`{"status": ["==", "paid"]}`), `orderBy` (`["created_at", "desc"]` ou
  `"created_at:desc"`), `limit`, `offset`, `searchString`, et `data` pour une
  écriture — et lisent via le chemin de `GET /api/data/<collection>`, de sorte qu'une ligne est
  renvoyée telle que REST la sert (dates ISO, une relation `belongsTo` sous forme de clé étrangère, par ex.
  `authorId`) et peut être renvoyée telle quelle lors d'une mise à jour. `query_collection`
  renvoie `{ data, meta }` avec `meta.total` et `meta.hasMore`, et `count_documents`
  `{ count }`. `aggregate_documents` correspond à `GET /api/data/<collection>/aggregate` :
  `select` est une liste suivant la grammaire de REST (`["count()", "sum(total)"]`), `groupBy`
  une liste de champs, et l'outil renvoie `{ data }` avec une ligne par groupe, plus
  `meta.hasMore` sur un appel groupé, dont les groupes se paginent avec `limit` et `offset`
  et se trient avec `orderBy`. Sur une collection qu'un callback `afterRead` réécrit, il sert
  uniquement `count()`, tout comme REST. Comme sur REST, une valeur de `limit` supérieure à 1000, un argument non déclaré ainsi que la
  modification ou la suppression d'une ligne mise à la corbeille (404) sont refusés ; définir le champ de
  suppression réversible à `null` la restaure. `deleted: "only"` (ou `"include"`) sur
  `query_collection`, `count_documents` et `aggregate_documents` permet de lire la corbeille, tout comme le paramètre
  `?deleted=` de REST, afin qu'une ligne envoyée à la corbeille par `delete_document` puisse être retrouvée pour être
  restaurée. Sa description indique au modèle que la suppression n'est définitive que si
  la collection ne possède pas de champ de suppression réversible.
- **Le listing nomme les collections ; `describe_collection` fournit le schéma de l'une d'elles.**
  `list_collections` renvoie pour chaque collection ses propriétés `name`, `title` et `description`,
  et `describe_collection { collection }` les schémas OpenAPI `row` et
  `create` de cette collection, ainsi que `softDeleteField` lorsque les lignes sont envoyées à la corbeille. Les descriptions
  des outils indiquent au modèle de décrire une collection avant d'y écrire. Le listing
  d'un projet de 200 collections représente environ 5k tokens, et chaque description
  moins de 1k ; inclure l'ensemble des schémas directement dans le listing représentait environ 150k tokens.
- **Un jeton réservé exclusivement à cet endpoint.** Un jeton d'accès MCP est refusé par
  `/api/data`, `/api/admin` et le WebSocket ; ainsi, connecter un assistant ne revient pas
  à lui confier une session.

Chaque requête vers `/mcp` relit le compte de l'utilisateur. Un compte supprimé ou désactivé,
ou bien une déconnexion globale (« se déconnecter de partout ») ou un changement de mot de passe intervenu après l'émission
du jeton, interrompt immédiatement un client connecté par une erreur 401. Une rétrogradation s'applique dès son
prochain appel d'outil. Chaque rafraîchissement effectue les mêmes vérifications et révoque
définitivement une telle autorisation. Une session invité ne peut en aucun cas donner son consentement.

Une limite. Déconnecter un client (`DELETE /api/oauth/grants/:clientId`, avec la propre
session de la personne) révoque immédiatement ses jetons de rafraîchissement, mais un jeton d'accès
déjà émis continue de fonctionner jusqu'à son expiration, dans la limite d'une heure.

Les routes sont détaillées dans [Endpoints](/docs/backend/endpoints/#mcp-surface) et les
variables dans [Configuration](/docs/getting-started/configuration/#mcp-surface).
