---
sourceHash: 219c4aa5108f13df
title: Le point de terminaison MCP distant
sidebar_label: Point de terminaison MCP distant
description: Servez MCP depuis un backend déployé sur /mcp, afin que les personnes qui utilisent votre application puissent connecter Claude ou Cursor en leur propre nom — OAuth avec un écran de consentement, neuf outils sous trois scopes, chaque appel sous leur propre sécurité au niveau des lignes.
---

:::tip[Connecter Claude à vos propres projets ?]
Il s'agit du [connecteur Rebase](/docs/ai/rebase-connector/) : un seul connecteur pour
tous vos projets, et un serveur auto-hébergé le rejoint avec `rebase cloud connect`. Cette
page est destinée aux personnes qui **utilisent** votre application.
:::

Le [serveur MCP](/docs/ai/mcp/) est un outil de développement : il s'exécute sur votre machine et détient une clé
de service ou une clé d'API. Un backend déployé peut également servir MCP lui-même, à `/mcp`, pour
les personnes qui utilisent votre application. Un assistant connecté par l'une d'elles lit et
écrit dans le projet **en tant que cette personne**, et chaque appel s'exécute sous sa propre
sécurité au niveau des lignes (row-level security).

Il est désactivé par défaut, et les deux variables sont requises :

```bash
REBASE_MCP_ENABLED=true
REBASE_PUBLIC_URL=https://app.example.com   # this deployment's real origin
```

Sans `REBASE_PUBLIC_URL`, un secret JWT ou un pilote de données capable de restreindre une requête
à un utilisateur, le point de terminaison refuse de se monter et en indique la raison dans le journal de démarrage. Aucun
`REBASE_ROLE` ne l'active.

- **OAuth, avec un écran de consentement.** Un client trouve le serveur d'autorisation
  via `/.well-known/oauth-protected-resource`, s'enregistre (l'enregistrement dynamique
  est activé par défaut ; `REBASE_MCP_OPEN_REGISTRATION=false` le limite
  aux clients que vous enregistrez), et redirige la personne vers un écran de consentement qui la connecte
  via votre `/auth/login` existant. Un compte avec un second facteur
  est ensuite invité à saisir son code d'authentification ou un code de récupération, via les
  routes existantes `/auth/mfa/challenge`. Lorsque le propre frontend de votre application
  conserve une session dans le même navigateur, l'écran propose ce compte, et
  « Autoriser » donne son consentement sous cette identité sans mot de passe ; c'est ainsi que se connecte une personne qui s'authentifie uniquement
  avec Google, GitHub ou un lien par e-mail. Sinon, elle se connecte avec un
  mot de passe, et une personne qui n'en a pas en définit d'abord un avec `/auth/forgot-password`
  (le « Mot de passe oublié » de votre application) ; l'écran le lui indique. Il mentionne également l'hôte auquel le code d'autorisation est envoyé,
  et précise que cet hôte n'est pas vérifié : n'importe qui peut enregistrer un client sous
  n'importe quel nom, l'hôte est donc l'élément qu'une personne peut vérifier.
- **Onze outils, trois scopes.** Les mêmes [scopes](/docs/backend/roles-and-scopes/)
  que chaque identifiant utilise. `data:read` propose `list_collections`, `describe_collection`,
  `query_collection`, `count_documents`, `get_document` et les trois vues,
  `show_collection`, `show_record` et `show_app` ; `data:write` ajoute `create_document` et
  `update_document` ; `data:delete` ajoute `delete_document`. Un client qui ne demande
  rien obtient `data:read`. Chacun peut être restreint à une collection : `data:read:posts`
  liste, décrit et lit `posts` et rien d'autre. Un scope détermine les outils proposés
  et les collections auxquelles ils ont accès, pas les lignes : une liste vide peut résulter
  du fonctionnement de RLS, et `data:write` ne peut toujours pas écrire une ligne à laquelle la personne n'a pas accès.
- **Trois outils mettent votre panneau d'administration à la disposition de l'utilisateur.** Dans un client
  prenant en charge le rendu des MCP Apps, comme Claude, ils ouvrent les vues propres au panneau d'administration dans la
  conversation, générées à partir de vos collections : leurs champs, énumérations, règles de validation,
  relations, sections de formulaire et paramètres d'affichage.
  - `show_collection` prend les arguments de `query_collection`, plus `view`
    (`table`, `list`, `cards` ou `kanban`), et ouvre la vue de la collection : la
    personne peut rechercher, filtrer, trier et paginer, ouvrir le formulaire d'une ligne et ajouter des lignes.
  - `show_record` ouvre le formulaire d'une ligne (`id`), ou un formulaire pour une nouvelle ligne qui
    commence à partir des `values` pré-remplies par le modèle, pour que la personne puisse les vérifier et
    les enregistrer elle-même.
  - `show_app` ouvre un petit écran pouvant comporter jusqu'à huit `blocks` : des vues de collections,
    des formulaires d'enregistrements et des métriques qui comptent les lignes correspondant à un `where`. Un bloc
    peut suivre la ligne sélectionnée dans un bloc de collection précédent : un formulaire l'ouvrant
    (`"follows": {"block": "orders"}`), ou une deuxième collection affichant
    les lignes qui pointent vers elle (`"follows": {"block": "orders", "on": "orderId"}`).

  Chaque bloc est vérifié comme le feraient les outils de lecture et d'écriture avant
  l'ouverture de l'écran. Chaque lecture et enregistrement dans la vue est un appel à l'un de ces outils,
  effectué en tant que la personne sous son RLS, de sorte que le formulaire n'offre que ce qui a été
  accordé à sa connexion : sans `data:write`, il est en lecture seule, et un champ
  que ses rôles ne peuvent pas lire n'y figure pas. Le modèle est informé de ce qu'elle a modifié. Il
  lit les lignes renvoyées par chaque outil, et non les configurations de collection utilisées pour afficher la vue.
  Un client dépourvu de MCP Apps, comme Claude Code ou Cursor, n'affiche rien,
  et le modèle lit les mêmes lignes qu'il obtiendrait via `query_collection`.
- **Les autorisations accordées avant la version 0.24 conservent leur portée.** `mcp:read` est interprété comme
  `data:read`, et `mcp:write` comme `data:write data:delete`, sur les autorisations stockées et
  sur les jetons déjà émis.
- **Une clé d'API fonctionne également.** `/mcp` accepte également `Authorization: Bearer rk_…`, pour
  un client configuré avec un en-tête plutôt qu'un flux OAuth. La clé a accès
  aux outils couverts par ses scopes `data:*`, selon l'entité qu'elle représente : une
  [clé personnelle](/docs/backend/api-keys/#personal-keys) en tant que son propriétaire, une clé de service
  en tant que `api-key:<id>`.
- **Le vocabulaire du SDK, les réponses de REST.** Les outils acceptent ce que le SDK accepte —
  `where` (`{"status": ["==", "paid"]}`), `orderBy` (`["created_at", "desc"]` ou
  `"created_at:desc"`), `limit`, `offset`, `searchString`, et `data` pour une
  écriture — et lisent via le chemin `GET /api/data/<collection>`, de sorte qu'une ligne est
  renvoyée telle que REST la sert (dates ISO, un `belongsTo` comme clé étrangère, par ex.
  `authorId`) et peut être renvoyée inchangée dans une mise à jour. `query_collection`
  répond `{ data, meta }` avec `meta.total` et `meta.hasMore`, et `count_documents`
  `{ count }`. Comme avec REST, une `limit` supérieure à 1000, un argument non déclaré et une
  modification ou suppression d'une ligne mise à la corbeille (404) sont refusés ; définir le champ de suppression
  réversible à `null` la restaure. `deleted: "only"` (ou `"include"`) sur
  `query_collection` et `count_documents` lit la corbeille, tout comme le `?deleted=` de REST,
  afin qu'une ligne mise à la corbeille par `delete_document` puisse être retrouvée pour
  être restaurée. Sa description indique au modèle que la suppression n'est définitive que si
  la collection n'a pas de champ de suppression réversible.
- **Le listing nomme les collections ; `describe_collection` fournit le schéma de l'une d'entre elles.**
  `list_collections` renvoie le `name`, `title` et `description` de chaque collection,
  et `describe_collection { collection }` les schémas OpenAPI `row` et
  `create` de cette collection, plus `softDeleteField` lorsque les lignes vont dans une corbeille. Les descriptions
  des outils indiquent au modèle de décrire une collection avant d'y écrire. Le
  listing d'un projet de 200 collections représente environ 5k tokens, et chaque description
  moins de 1k ; avec tous les schémas dans le listing, cela représentait environ 150k.
- **Un jeton réservé à ce point de terminaison.** Un jeton d'accès MCP est refusé par
  `/api/data`, `/api/admin` et le WebSocket, de sorte que connecter un assistant ne lui
  confère pas une session.

Chaque requête envoyée à `/mcp` relit le compte de la personne. Un compte supprimé ou désactivé,
ou une action « déconnecter de partout » ou un changement de mot de passe après l'émission
du jeton, bloque immédiatement un client connecté avec une erreur 401. Une rétrogradation de rôle s'applique dès
son prochain appel d'outil. Chaque rafraîchissement effectue les mêmes vérifications et refuse définitivement
une telle autorisation. Une session invité ne peut pas donner son consentement du tout.

Une limite. La déconnexion d'un client (`DELETE /api/oauth/grants/:clientId`, avec la
propre session de la personne) révoque immédiatement ses jetons de rafraîchissement, mais un jeton d'accès
déjà émis continue de fonctionner jusqu'à son expiration, dans l'heure qui suit.

Les routes se trouvent dans [Points de terminaison](/docs/backend/endpoints/#mcp-surface) et les
variables dans [Configuration](/docs/getting-started/configuration/#mcp-surface).
