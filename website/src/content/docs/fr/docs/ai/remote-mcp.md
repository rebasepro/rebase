---
sourceHash: b813cdc1b302b6c6
title: Le point de terminaison MCP distant
sidebar_label: Point de terminaison MCP distant
description: Exposez MCP depuis un backend déployé sur /mcp, afin que les utilisateurs de votre application puissent connecter Claude ou Cursor en leur propre nom — OAuth avec écran de consentement, neuf outils sous trois portées, chaque appel soumis à leur propre sécurité au niveau des lignes.
---

:::tip[Vous souhaitez connecter Claude à vos propres projets ?]
Il s'agit du [connecteur Rebase](/docs/ai/rebase-connector/) : un seul connecteur pour
tous vos projets, et un serveur auto-hébergé le rejoint avec `rebase cloud connect`. Cette
page s'adresse aux personnes qui **utilisent** votre application.
:::

Le [serveur MCP](/docs/ai/mcp/) est un outil de développement : il s'exécute sur votre machine et détient une clé
de service ou une clé API. Un backend déployé peut également exposer MCP lui-même, sur `/mcp`, pour
les personnes qui utilisent votre application. Lorsqu'un utilisateur y connecte un assistant, celui-ci lit et
écrit dans le projet **en tant que cette personne**, et chaque appel s'exécute selon sa propre
sécurité au niveau des lignes (RLS).

Il est désactivé par défaut, et les deux variables sont requises :

```bash
REBASE_MCP_ENABLED=true
REBASE_PUBLIC_URL=https://app.example.com   # this deployment's real origin
```

Sans `REBASE_PUBLIC_URL`, un secret JWT ou un pilote de données capable de restreindre une requête
à un seul utilisateur, le point de terminaison refuse de se monter et en indique la raison dans les logs de démarrage. Aucun
`REBASE_ROLE` ne l'active.

- **OAuth, avec un écran de consentement.** Un client découvre le serveur d'autorisation
  via `/.well-known/oauth-protected-resource`, s'enregistre (l'enregistrement dynamique
  est activé par défaut ; `REBASE_MCP_OPEN_REGISTRATION=false` le limite
  aux clients que vous enregistrez), et redirige la personne vers un écran de consentement qui la
  connecte via votre route `/auth/login` existante. Un compte avec un second facteur
  est ensuite invité à saisir son code d'authentification ou un code de récupération, via les
  routes `/auth/mfa/challenge` existantes. Lorsque le propre frontend de votre application
  conserve une session dans le même navigateur, l'écran propose ce compte, et
  le bouton Autoriser donne son accord en son nom sans mot de passe ; c'est ainsi qu'une personne se connectant uniquement
  avec Google, GitHub ou un lien par e-mail se connecte. Sinon, elle se connecte avec un
  mot de passe, et une personne qui n'en a pas en définit un au préalable avec `/auth/forgot-password`
  (la page « Mot de passe oublié » de votre application) ; l'écran l'en informe. Il indique également le nom de l'hôte auquel le code d'autorisation est envoyé,
  et précise que cet hôte n'est pas vérifié : n'importe qui pouvant enregistrer un client sous
  n'importe quel nom, l'hôte est la partie que l'utilisateur peut vérifier.
- **Onze outils, trois portées.** Les mêmes [portées](/docs/backend/roles-and-scopes/)
  que chaque identifiant utilise. `data:read` propose `list_collections`, `describe_collection`,
  `query_collection`, `count_documents`, `get_document` et les trois vues,
  `show_collection`, `show_record` et `show_app` ; `data:write` ajoute `create_document` et
  `update_document` ; `data:delete` ajoute `delete_document`. Un client qui ne demande
  rien obtient `data:read`. Chacune peut être restreinte à une collection : `data:read:posts`
  liste, décrit et lit `posts` et rien d'autre. Une portée détermine les outils qui sont
  proposés et les collections auxquelles ils ont accès, et non les lignes : une liste vide peut être
  le résultat du bon fonctionnement de la RLS, et `data:write` ne peut toujours pas écrire une ligne à laquelle la personne n'a pas accès.
- **Trois outils mettent votre panneau d'administration sous les yeux de l'utilisateur.** Dans un client qui
  prend en charge les MCP Apps, comme Claude, ils ouvrent les vues propres au panneau d'administration au sein de la
  conversation, générées à partir de vos collections : leurs champs, énumérations, validations,
  relations, sections de formulaire et paramètres d'affichage.
  - `show_collection` prend les arguments de `query_collection`, plus `view`
    (`table`, `list`, `cards` ou `kanban`), et ouvre la vue de la collection : la
    personne peut rechercher, filtrer, trier et paginer, ouvrir le formulaire d'une ligne et ajouter des lignes.
  - `show_record` ouvre le formulaire d'une ligne (`id`), ou un formulaire pour une nouvelle ligne qui
    part des valeurs (`values`) pré-remplies par le modèle, pour que l'utilisateur puisse vérifier et
    enregistrer lui-même.
  - `show_app` exécute une application que le modèle écrit pour la tâche en cours : un
    composant React (`code`) et les collections (`collections`) qu'il lit. Il importe le kit d'interface utilisateur
    (`@rebasepro/ui`), les vignettes de KPI et les graphiques de `@rebasepro/plugin-insights`,
    et `@rebasepro/mcp-apps` : `useQuery`, `useRecord`, `useCount` et
    `useMutate` sur les lignes du projet, ainsi que les composants
    `CollectionView` et `RecordForm` du panneau d'administration à composer. Le serveur le compile
    au préalable, de sorte qu'une erreur de syntaxe ou un import manquant dans la vue devient
    l'erreur de l'appel, avec sa ligne ; une erreur survenant pendant l'exécution s'affiche à sa place
    et est signalée au modèle avec le prochain message de l'utilisateur.

  Chaque lecture et enregistrement dans la vue correspond à l'appel de l'un des outils de lecture et d'écriture,
  effectué en tant que la personne sous sa propre RLS, de sorte qu'un formulaire ne propose que ce que sa
  connexion autorise : sans `data:write`, il est en lecture seule, et un champ
  que ses rôles ne peuvent pas lire n'y apparaît pas. Une modification apportée par le code d'une application est présentée
  à l'utilisateur pour confirmation avant d'être envoyée. Le modèle est informé de ce qu'il a
  modifié. Il lit les lignes renvoyées par chaque outil, et non les configurations de collection avec lesquelles
  la vue est dessinée. Un client ne prenant pas en charge les MCP Apps, tel que Claude Code ou Cursor, n'affiche rien,
  et le modèle lit les mêmes lignes qu'il obtiendrait de `query_collection`.
- **Les autorisations accordées avant la version 0.24 conservent leur portée.** `mcp:read` est interprété comme
  `data:read`, et `mcp:write` comme `data:write data:delete`, pour les autorisations stockées et
  les jetons déjà émis.
- **Une clé API fonctionne également.** `/mcp` accepte aussi `Authorization: Bearer rk_…`, pour
  un client configuré avec un en-tête plutôt qu'avec un flux OAuth. La clé a accès
  aux outils couverts par ses portées `data:*`, selon l'identité qu'elle représente : une
  [clé personnelle](/docs/backend/api-keys/#personal-keys) en tant que son propriétaire, une clé de service
  en tant que `api-key:<id>`.
- **Le vocabulaire du SDK, les réponses de REST.** Les outils acceptent les mêmes paramètres que le SDK —
  `where` (`{"status": ["==", "paid"]}`), `orderBy` (`["created_at", "desc"]` ou
  `"created_at:desc"`), `limit`, `offset`, `searchString`, et `data` pour une
  écriture — et lisent via le chemin `GET /api/data/<collection>`, de sorte qu'une ligne est
  renvoyée telle que REST la sert (dates ISO, un `belongsTo` sous forme de clé étrangère, ex.
  `authorId`) et peut être renvoyée telle quelle lors d'une mise à jour. `query_collection`
  répond `{ data, meta }` avec `meta.total` et `meta.hasMore`, et `count_documents`
  répond `{ count }`. Comme sur REST, une `limit` supérieure à 1000, un argument non déclaré et une
  modification ou suppression d'une ligne mise à la corbeille (404) sont refusés ; définir le champ de
  suppression réversible (soft-delete) à `null` la restaure. `deleted: "only"` (ou `"include"`) sur
  `query_collection` et `count_documents` lit la corbeille, tout comme le fait
  `?deleted=` de REST, afin qu'une ligne mise à la corbeille par `delete_document` puisse être retrouvée pour
  être restaurée. Sa description informe le modèle que la suppression est définitive uniquement lorsque
  la collection n'a pas de champ de suppression réversible.
- **La liste nomme les collections ; `describe_collection` fournit le schéma de l'une d'entre elles.**
  `list_collections` renvoie le `name`, le `title` et la `description` de chaque collection,
  et `describe_collection { collection }` les schémas OpenAPI `row` et
  `create` de cette collection, plus `softDeleteField` lorsque les lignes vont dans une corbeille. Les descriptions
  des outils indiquent au modèle de décrire une collection avant d'y écrire. La liste d'un
  projet de 200 collections représente environ 5k tokens, et chaque description
  moins de 1k ; inclure chaque schéma dans la liste représentait environ 150k tokens.
- **Un jeton réservé à ce point de terminaison uniquement.** Un jeton d'accès MCP est refusé par
  `/api/data`, `/api/admin` et le WebSocket, de sorte que connecter un assistant ne lui
  donne pas accès à une session complète.

Chaque requête vers `/mcp` réévalue le compte de la personne. Un compte
supprimé ou désactivé, ou une action « se déconnecter de tous les appareils » ou un changement de mot de passe après
l'émission du jeton, bloque immédiatement un client connecté avec une erreur 401. Une rétrogradation s'applique à son
prochain appel d'outil. Chaque rafraîchissement effectue les mêmes vérifications et refuse définitivement
une telle autorisation. Une session invité ne peut pas donner son consentement du tout.

Une limite. Déconnecter un client (`DELETE /api/oauth/grants/:clientId`, avec la
propre session de la personne) révoque immédiatement ses jetons de rafraîchissement, mais un jeton d'accès
déjà émis continue de fonctionner jusqu'à son expiration, dans la limite d'une heure.

Les routes se trouvent dans [Points de terminaison](/docs/backend/endpoints/#mcp-surface) et les
variables dans [Configuration](/docs/getting-started/configuration/#mcp-surface).
