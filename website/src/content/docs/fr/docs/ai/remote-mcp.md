---
sourceHash: 929d8e7ae10aab87
title: Le point de terminaison MCP distant
sidebar_label: Point de terminaison MCP distant
description: Exposez MCP depuis un backend déployé sur /mcp, afin que les utilisateurs de votre application puissent connecter Claude ou Cursor en leur propre nom — OAuth avec écran de consentement, neuf outils sous trois portées, chaque appel soumis à leur propre sécurité au niveau des lignes.
---

:::tip[Connecter Claude à vos propres projets ?]
Il s'agit du [connecteur Rebase](/docs/ai/rebase-connector/) : un seul connecteur pour
chacun d'eux, et un serveur auto-hébergé le rejoint avec `rebase cloud connect`. Cette
page est destinée aux personnes qui **utilisent** votre application.
:::

Le [serveur MCP](/docs/ai/mcp/) est un outil de développement : il s'exécute sur votre machine et détient une clé de service
ou une clé API. Un backend déployé peut également servir MCP lui-même, sur `/mcp`, pour
les personnes qui utilisent votre application. L'assistant que l'un d'eux connecte lit et
écrit dans le projet **en tant que cette personne**, et chaque appel s'exécute selon sa propre
sécurité au niveau des lignes (RLS).

Il est désactivé à moins que vous ne l'activiez, et les deux variables sont obligatoires :

```bash
REBASE_MCP_ENABLED=true
REBASE_PUBLIC_URL=https://app.example.com   # this deployment's real origin
```

Sans `REBASE_PUBLIC_URL`, un secret JWT ou un pilote de données capable de restreindre une requête
à un seul utilisateur, le point de terminaison refuse de se monter et en indique la raison dans les logs de démarrage. Aucun
`REBASE_ROLE` ne l'active.

- **OAuth, avec un écran de consentement.** Un client trouve le serveur d'autorisation
  via `/.well-known/oauth-protected-resource`, s'enregistre (l'enregistrement dynamique
  est activé par défaut ; `REBASE_MCP_OPEN_REGISTRATION=false` le limite
  aux clients que vous enregistrez), et redirige la personne vers un écran de consentement qui la connecte
  via votre `/auth/login` existant. Un compte doté d'un second facteur
  est ensuite invité à saisir son code d'authentification ou un code de récupération, via les
  routes `/auth/mfa/challenge` existantes. Lorsque le frontend de votre application
  conserve une session dans le même navigateur, l'écran propose ce compte, et
  « Autoriser » accorde le consentement sous cette identité sans mot de passe ; c'est ainsi qu'une personne qui se connecte uniquement
  avec Google, GitHub ou un lien par e-mail se connecte. Sinon, elle se connecte avec un
  mot de passe, et une personne qui n'en a pas en définit d'abord un avec `/auth/forgot-password`
  (le « Mot de passe oublié » de votre application) ; l'écran le lui indique. Il mentionne également l'hôte auquel le code d'autorisation est envoyé,
  et précise que cet hôte n'est pas vérifié : n'importe qui pouvant enregistrer un client sous
  n'importe quel nom, l'hôte est la seule partie que la personne peut vérifier.
- **Neuf outils, trois portées.** Les mêmes [portées](/docs/backend/roles-and-scopes/)
  que chaque identifiant utilise. `data:read` propose `list_collections`, `describe_collection`,
  `query_collection`, `show_collection`, `count_documents` et `get_document` ; `data:write` ajoute `create_document` et
  `update_document` ; `data:delete` ajoute `delete_document`. Un client qui ne demande
  rien obtient `data:read`. Chacune se restreint à une collection : `data:read:posts`
  liste, décrit et lit `posts` et rien d'autre. Une portée détermine les outils qui sont
  proposés et les collections auxquelles ils ont accès, et non les lignes : une liste vide peut simplement résulter du
  fonctionnement du RLS, et `data:write` ne peut toujours pas écrire une ligne que la personne ne pourrait pas écrire.
- **`show_collection` place les lignes sous les yeux de la personne.** Il prend les
  arguments de `query_collection` et renvoie la même page, en plus des colonnes affichées par le
  panneau d'administration. Un client prenant en charge le rendu des MCP Apps, tel que Claude, l'affiche sous forme de
  tableau dans la conversation : la personne peut charger davantage de lignes et, lorsque la
  connexion dispose de `data:write`, modifier une cellule sur place. Chaque enregistrement est un
  appel à `update_document` effectué sous son identité, soumis à son RLS, et le modèle est informé de ce
  qu'elle a modifié. Un client sans prise en charge des MCP Apps, tel que Claude Code ou Cursor, n'affiche aucun
  tableau, et le modèle lit la page comme il le ferait depuis `query_collection`.
- **Les autorisations accordées avant la 0.24 conservent leur portée.** `mcp:read` est interprété comme
  `data:read`, et `mcp:write` comme `data:write data:delete`, sur les autorisations stockées et
  sur les jetons déjà émis.
- **Une clé API fonctionne également.** `/mcp` accepte aussi `Authorization: Bearer rk_…`, pour
  un client configuré avec un en-tête plutôt qu'un flux OAuth. La clé a accès
  aux outils couverts par ses portées `data:*`, selon l'identité qu'elle incarne : une
  [clé personnelle](/docs/backend/api-keys/#personal-keys) agit en tant que son propriétaire, une clé de service
  en tant que `api-key:<id>`.
- **Le vocabulaire du SDK, les réponses de REST.** Les outils acceptent ce que le SDK accepte —
  `where` (`{"status": ["==", "paid"]}`), `orderBy` (`["created_at", "desc"]` ou
  `"created_at:desc"`), `limit`, `offset`, `searchString`, et `data` pour une
  écriture — et effectuent leurs lectures via le chemin de `GET /api/data/<collection>`, de sorte qu'une ligne est renvoyée
  telle que REST la sert (dates ISO, un `belongsTo` sous forme de sa clé étrangère, par ex.
  `authorId`) et peut être renvoyée telle quelle dans une mise à jour. `query_collection`
  répond `{ data, meta }` avec `meta.total` et `meta.hasMore`, et `count_documents`
  `{ count }`. Comme sur REST, une `limit` supérieure à 1000, un argument non déclaré ainsi que la
  modification ou la suppression d'une ligne mise à la corbeille (404) sont refusés ; définir le champ
  de suppression réversible (soft-delete) sur `null` la restaure. `deleted: "only"` (ou `"include"`) sur
  `query_collection` et `count_documents` lit la corbeille, tout comme le fait `?deleted=` de REST,
  afin qu'une ligne mise à la corbeille par `delete_document` puisse être retrouvée pour être
  restaurée. Sa description indique au modèle que la suppression est définitive uniquement lorsque
  la collection n'a pas de champ de suppression réversible.
- **Le listing nomme les collections ; `describe_collection` fournit le schéma de l'une d'elles.**
  `list_collections` renvoie le `name`, le `title` et la `description` de chaque collection,
  et `describe_collection { collection }` les schémas OpenAPI `row` et
  `create` de cette collection, ainsi que `softDeleteField` lorsque les lignes vont dans une corbeille. Les descriptions
  d'outils indiquent au modèle de décrire une collection avant d'y écrire. Le listing
  d'un projet de 200 collections représente environ 5k tokens, et chaque description
  moins de 1k ; avec tous les schémas dans le listing, cela représentait environ 150k tokens.
- **Un jeton pour ce point de terminaison uniquement.** Un jeton d'accès MCP est refusé par
  `/api/data`, `/api/admin` et le WebSocket, de sorte que connecter un assistant ne lui
  transmet pas de session.

Chaque requête vers `/mcp` relit le compte de la personne. Un compte
supprimé ou désactivé, ou un « se déconnecter de partout » ou un changement de mot de passe après l'émission
du jeton, interrompt immédiatement un client connecté avec un 401. Une rétrogradation de rôle s'applique à son
prochain appel d'outil. Chaque rafraîchissement effectue les mêmes vérifications et refuse définitivement
une telle autorisation. Une session invité ne peut pas consentir du tout.

Une limite. La déconnexion d'un client (`DELETE /api/oauth/grants/:clientId`, avec la
propre session de la personne) révoque immédiatement ses jetons de rafraîchissement, mais un jeton d'accès
déjà émis continue de fonctionner jusqu'à son expiration, dans la limite d'une heure.

Les routes se trouvent dans [Endpoints](/docs/backend/endpoints/#mcp-surface) et les
variables dans [Configuration](/docs/getting-started/configuration/#mcp-surface).
