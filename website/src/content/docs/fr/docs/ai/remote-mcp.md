---
sourceHash: 66f2808f3fe34b6b
title: Le point de terminaison MCP distant
sidebar_label: Point de terminaison MCP distant
description: Servez MCP depuis un backend déployé sur /mcp, afin que les personnes qui utilisent votre app puissent connecter Claude ou Cursor en leur nom propre — OAuth avec écran de consentement, neuf outils sous trois portées, chaque appel exécuté sous leur propre sécurité au niveau des lignes.
---

Le [serveur MCP](/docs/ai/mcp/) est un outil de développement : il s'exécute sur votre
machine et détient une clé de service ou une clé d'API. Un backend déployé peut aussi
servir lui-même du MCP, sur `/mcp`, aux personnes qui utilisent votre application. Un
assistant que l'une d'elles connecte lit et écrit le projet **en son nom**, et chaque
appel s'exécute sous sa propre sécurité au niveau des lignes.

Il est désactivé tant que vous ne l'activez pas, et les deux variables sont obligatoires :

```bash
REBASE_MCP_ENABLED=true
REBASE_PUBLIC_URL=https://app.example.com   # this deployment's real origin
```

Sans `REBASE_PUBLIC_URL`, sans secret JWT, ou sans driver de données capable de restreindre
une requête à un seul utilisateur, le point de terminaison refuse de se monter et en donne
la raison dans le log de démarrage. Aucun `REBASE_ROLE` ne l'active.

- **OAuth, avec un écran de consentement.** Un client trouve le serveur d'autorisation
  via `/.well-known/oauth-protected-resource`, s'enregistre lui-même (l'enregistrement
  dynamique est activé par défaut ; `REBASE_MCP_OPEN_REGISTRATION=false` le limite
  aux clients que vous enregistrez), et envoie la personne vers un écran de consentement
  qui la connecte via votre `/auth/login` existant. Un compte doté d'un second facteur
  doit ensuite saisir le code de son application d'authentification ou un code de
  récupération, via les routes `/auth/mfa/challenge` existantes. Quand le frontend de votre app
  garde une session dans le même navigateur, l'écran propose ce compte, et Autoriser
  consent avec lui sans mot de passe ; c'est ainsi que se connecte quelqu'un qui ne se
  connecte qu'avec Google, GitHub ou un lien par e-mail. Sinon, il se connecte par mot
  de passe, et quelqu'un qui n'en a pas en définit d'abord un avec
  `/auth/forgot-password` (le « Mot de passe oublié » de votre app) ; l'écran le lui
  indique. Il nomme aussi l'hôte vers lequel le code
  d'autorisation est envoyé, et précise que cet hôte n'est pas vérifié : n'importe qui
  peut enregistrer un client sous n'importe quel nom, l'hôte est donc la partie qu'une
  personne peut vérifier.
- **Neuf outils, trois portées.** Les mêmes [portées](/docs/backend/roles-and-scopes/)
  que celles de chaque identifiant. `data:read` propose `list_collections`, `describe_collection`,
  `query_collection`, `show_collection`, `count_documents` et `get_document` ; `data:write` ajoute `create_document` et
  `update_document` ; `data:delete` ajoute `delete_document`. Un client qui ne demande
  rien obtient `data:read`. Chacune peut se restreindre à une collection : `data:read:posts`
  liste, décrit et lit `posts` et rien d'autre. Une portée décide quels outils sont proposés et
  quelles collections ils atteignent, pas quelles lignes : une liste vide peut être le RLS
  qui fait son travail, et `data:write` ne peut toujours pas écrire une ligne que la personne
  ne pourrait pas écrire elle-même.
- **`show_collection` met les lignes sous les yeux de la personne.** Il prend les arguments
  de `query_collection` et répond la même page, avec les colonnes qu'affiche le panneau
  d'administration. Un client qui affiche les MCP Apps, comme Claude, l'ouvre sous forme de
  tableau dans la conversation : la personne peut charger plus de lignes et, là où la
  connexion détient `data:write`, modifier une cellule sur place. Chaque enregistrement est
  un appel à `update_document` fait en son nom, sous son RLS, et le modèle apprend ce
  qu'elle a changé. Un client sans MCP Apps, comme Claude Code ou Cursor, n'affiche aucun
  tableau, et le modèle lit la page comme il la lirait avec `query_collection`.
- **Les autorisations accordées avant la 0.24 gardent leur étendue.** `mcp:read` est lu comme
  `data:read`, et `mcp:write` comme `data:write data:delete`, sur les autorisations
  enregistrées et sur les jetons déjà émis.
- **Une clé d'API fonctionne aussi.** `/mcp` accepte également `Authorization: Bearer rk_…`, pour
  un client configuré avec un en-tête plutôt qu'avec un flux OAuth. La clé atteint
  les outils que ses portées `data:*` couvrent, en tant que l'identité pour laquelle elle agit : une
  [clé personnelle](/docs/backend/api-keys/#personal-keys) en tant que son propriétaire, une clé de service
  en tant que `api-key:<id>`.
- **Le vocabulaire du SDK, les réponses de REST.** Les outils prennent ce que prend le SDK —
  `where` (`{"status": ["==", "paid"]}`), `orderBy` (`["created_at", "desc"]` ou
  `"created_at:desc"`), `limit`, `offset`, `searchString`, et `data` pour une
  écriture — et lisent par le chemin de `GET /api/data/<collection>`, de sorte qu'une ligne revient
  telle que REST la sert (dates ISO, une `belongsTo` sous la forme de sa clé étrangère, p. ex.
  `authorId`) et peut être renvoyée telle quelle dans une mise à jour. `query_collection`
  répond `{ data, meta }` avec `meta.total` et `meta.hasMore`, et `count_documents`
  `{ count }`. Comme sur REST, un `limit` supérieur à 1000, un argument non déclaré et la
  modification ou la suppression d'une ligne placée dans la corbeille (404) sont refusés ; mettre le champ de
  soft delete à `null` la restaure. `deleted: "only"` (ou `"include"`) sur
  `query_collection` et `count_documents` lit la corbeille, comme le `?deleted=` de REST,
  de sorte qu'une ligne que `delete_document` a mise à la corbeille peut être retrouvée pour
  être restaurée. Sa description indique au modèle que la suppression n'est définitive que là où
  la collection n'a pas de champ de soft delete.
- **La liste nomme les collections ; `describe_collection` donne le schéma de l'une d'elles.**
  `list_collections` répond, pour chaque collection, son `name`, son `title` et sa `description`,
  et `describe_collection { collection }` les schémas OpenAPI `row` et
  `create` de cette collection, plus `softDeleteField` là où les lignes vont à la corbeille. Les descriptions
  des outils indiquent au modèle de décrire une collection avant d'y écrire. La liste d'un
  projet de 200 collections pèse environ 5k tokens, et chaque description moins de 1k ; avec tous
  les schémas dans la liste, cela faisait environ 150k.
- **Un jeton valable pour ce seul point de terminaison.** Un jeton d'accès MCP est refusé par
  `/api/data`, `/api/admin` et le WebSocket : connecter un assistant ne lui
  remet donc pas une session.

Chaque requête vers `/mcp` relit le compte de la personne. Un compte supprimé ou désactivé,
ou une « déconnexion partout » ou un changement de mot de passe survenu après l'émission du jeton,
arrête aussitôt un client connecté avec un 401. Une rétrogradation s'applique à son
prochain appel d'outil. Chaque rafraîchissement effectue les mêmes vérifications et refuse définitivement
une telle autorisation. Une session invité ne peut pas du tout donner son consentement.

Une limite. Déconnecter un client (`DELETE /api/oauth/grants/:clientId`, avec la
propre session de la personne) révoque aussitôt ses jetons de rafraîchissement, mais un jeton d'accès
déjà émis continue de fonctionner jusqu'à son expiration, dans l'heure.

Les routes figurent dans l'[index des points de terminaison](/docs/backend/endpoints/#mcp-surface) et les
variables dans [Configuration](/docs/getting-started/configuration/#mcp-surface).
