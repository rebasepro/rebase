---
sourceHash: 4abdf92eab306b1d
title: Le point de terminaison MCP distant
sidebar_label: Point de terminaison MCP distant
description: Servez MCP depuis un backend déployé sur /mcp, afin que les utilisateurs de votre application puissent connecter Claude ou Cursor en leur propre nom — OAuth avec un écran de consentement, douze outils sous trois portées, chaque appel soumis à leur propre sécurité au niveau des lignes.
---

:::tip[Vous connectez Claude à vos propres projets ?]
Il s'agit du [connecteur Rebase](/docs/ai/rebase-connector/) : un seul connecteur pour
l'ensemble de vos projets, et un serveur auto-hébergé le rejoint avec `rebase cloud connect`. Cette
page est destinée aux personnes qui **utilisent** votre application.
:::

Le [serveur MCP](/docs/ai/mcp/) est un outil de développement : il s'exécute sur votre machine et détient une clé
de service ou une clé d'API. Un backend déployé peut également servir MCP lui-même, sur `/mcp`, pour
les personnes qui utilisent votre application. Lorsqu'un utilisateur y connecte un assistant, celui-ci lit et
écrit dans le projet **en son nom**, et chaque appel s'exécute sous sa propre
sécurité au niveau des lignes (row-level security).

Il est désactivé par défaut, et les deux variables sont obligatoires :

```bash
REBASE_MCP_ENABLED=true
REBASE_PUBLIC_URL=https://app.example.com   # this deployment's real origin
```

Sans `REBASE_PUBLIC_URL`, sans secret JWT ou sans pilote de données capable de restreindre une requête
à un seul utilisateur, le point de terminaison refuse de se monter et en précise la raison dans le journal de démarrage. Aucun
`REBASE_ROLE` ne permet de l'activer.

- **OAuth, avec un écran de consentement.** Un client découvre le serveur d'autorisation
  via `/.well-known/oauth-protected-resource`, s'enregistre (l'enregistrement dynamique
  est activé par défaut ; `REBASE_MCP_OPEN_REGISTRATION=false` le limite
  aux clients que vous enregistrez), puis redirige la personne vers un écran de consentement qui l'authentifie
  via votre route `/auth/login` existante. Un compte protégé par un second facteur
  est ensuite invité à renseigner son code d'authentification ou un code de récupération, via les
  routes existantes `/auth/mfa/challenge`. Lorsque le frontend de votre application
  maintient une session active dans le même navigateur, l'écran propose directement ce compte, et le bouton
  Autoriser valide le consentement sans demander de mot de passe ; c'est ainsi que se connectent les utilisateurs qui s'authentifient
  uniquement avec Google, GitHub ou un lien par e-mail. Sinon, la connexion s'effectue par
  mot de passe ; une personne n'en possédant pas en définit un au préalable via `/auth/forgot-password`
  (la page « Mot de passe oublié » de votre application), ce que l'écran lui indique. Il mentionne également l'hôte auquel le code d'autorisation est envoyé,
  en précisant que cet hôte n'est pas vérifié : n'importe qui pouvant enregistrer un client sous
  le nom de son choix, l'hôte est l'information concrète que la personne peut contrôler.
- **Douze outils, trois portées.** <span class="since-badge" data-since="0.29">Depuis 0.29</span> Les mêmes [portées](/docs/backend/roles-and-scopes/)
  que chaque identifiant utilise. `data:read` donne accès à `list_collections`, `describe_collection`,
  `query_collection`, `count_documents`, `aggregate_documents`, `get_document` ainsi qu'aux trois vues,
  `show_collection`, `show_record` et `show_app` ; `data:write` ajoute `create_document` et
  `update_document` ; `data:delete` ajoute `delete_document`. Un client qui ne demande
  aucune portée reçoit `data:read`. Chacune peut être restreinte à une collection donnée : `data:read:posts`
  liste, décrit et lit `posts`, et rien d'autre. Une portée détermine quels outils sont
  mis à disposition et quelles collections ils peuvent atteindre, mais pas quelles lignes : une liste vide peut simplement résulter
  de l'application du RLS, et `data:write` ne permettra jamais d'écrire une ligne à laquelle la personne n'a pas accès.
- **Trois outils mettent votre panneau d'administration à la disposition de l'utilisateur.** Dans un client prenant
  en charge le rendu des MCP Apps, tel que Claude, ils ouvrent les vues propres au panneau d'administration au sein
  de la conversation, générées à partir de vos collections : leurs champs, énumérations, règles de validation,
  relations, sections de formulaire et configurations d'affichage.
  - `show_collection` prend les arguments de `query_collection`, ainsi que `view`
    (`table`, `list`, `cards` ou `kanban`), et ouvre la vue de la collection : l'utilisateur
    peut rechercher, filtrer, trier, paginer, ouvrir le formulaire d'une ligne et en ajouter de nouvelles.
  - `show_record` ouvre le formulaire d'une ligne existante (`id`), ou un formulaire pour une nouvelle ligne
    pré-remplie à partir des `values` définies par le modèle, permettant à la personne de vérifier
    et d'enregistrer elle-même les données.
  - `show_app` exécute une application générée par le modèle pour la tâche en cours : un composant React
    unique (`code`) et les `collections` qu'il consulte. Il importe les paquets natifs de
    Rebase, de sorte que le même code fonctionne directement dans votre projet :
    - `@rebasepro/app` : `useRows`, `useRow`, `useRowCount`, `useAggregate`
      et `useRowWrites` sur les lignes du projet ;
    - `@rebasepro/cms` : le composant `CollectionPanel` du panneau d'administration (avec
      `CollectionToolbar` et ses sous-éléments, ainsi que `onRowClick`, qui transmet à
      l'application la ligne cliquée telle que `useRows` la lit), `EntityFormPanel` et `FormField`,
      `EntityViewPanel`, `FieldValue`, `useSidePanel` et
      `useCollectionRegistryController`, avec vos champs personnalisés, vues et
      actions ;
    - `@rebasepro/ui`, l'intégralité du kit d'interface utilisateur, incluant `SplitView` ainsi que les tuiles KPI et
      les graphiques.

    Le serveur compile l'application au préalable : toute erreur de syntaxe, tout module non
    exposé par la vue ou tout identifiant absent de `@rebasepro/cms` ou
    `@rebasepro/app` provoque l'échec immédiat de l'appel, avec indication de la ligne concernée. Une erreur survenant lors de
    l'exécution est affichée à l'écran et signalée au modèle avec le prochain
    message de l'utilisateur. Une application ne peut accéder qu'aux collections qu'elle déclare. Ses styles reposent
    sur les classes utilitaires standard de Tailwind, intégrées à la vue avant l'arrivée de toute
    application : une valeur arbitraire comme `h-[560px]` n'y produira aucun effet, une dimension
    exacte doit donc être définie via un attribut `style`.

  Chaque opération de lecture et d'enregistrement dans la vue correspond à l'un des appels aux outils de lecture et d'écriture,
  effectué sous l'identité de l'utilisateur et selon son RLS ; un formulaire ne propose donc que ce qui a été
  accordé à sa connexion : sans `data:write`, il s'affiche en lecture seule, et un champ inaccessible
  à ses rôles en est masqué. Le code d'une application est soumis exactement au même périmètre :
  s'exécutant dans la vue, chaque requête qu'il émet passe par l'un de ces outils, au nom
  de la personne, et ne peut rien faire de plus que ce que le modèle lui-même pourrait accomplir
  avec ces outils. Sur le connecteur hébergé, toute écriture fait en outre l'objet d'une planification
  et d'une confirmation par le serveur. Dans ce contexte, `useRowWrites` sollicite l'accord de la personne
  avant d'écrire, empêchant l'application de modifier des données sans son intervention explicite ; les
  commandes natives de l'interface (bouton Enregistrer d'un formulaire, suppression, modification dans une table) se comportent exactement
  comme sur un écran `show_collection`. Le modèle est tenu informé des modifications apportées. Il lit les lignes renvoyées par chaque outil, et non les configurations de collection exploitées
  par la vue. Un client dépourvu du support des MCP Apps, comme Claude Code ou Cursor, n'affiche rien,
  et le modèle lit les mêmes lignes que celles qu'il obtiendrait via `query_collection`.
- **Les autorisations créées avant la version 0.24 conservent leur portée.** `mcp:read` est interprété comme
  `data:read`, et `mcp:write` comme `data:write data:delete`, tant sur les autorisations stockées
  que sur les jetons déjà délivrés.
- **Une clé d'API fonctionne également.** `/mcp` prend aussi en charge l'en-tête `Authorization: Bearer rk_…`, pour
  les clients configurés via un en-tête HTTP plutôt que par un flux OAuth. La clé accède
  aux outils couverts par ses portées `data:*`, selon l'identité qu'elle représente : une
  [clé personnelle](/docs/backend/api-keys/#personal-keys) agit comme son propriétaire, une clé de service
  agit sous l'identité `api-key:<id>`.
- **Le vocabulaire du SDK, les réponses de l'API REST.** Les outils acceptent les mêmes arguments que le SDK —
  `where` (`{"status": ["==", "paid"]}`), `orderBy` (`["created_at", "desc"]` ou
  `"created_at:desc"`), `limit`, `offset`, `searchString`, et `data` pour une
  écriture — et effectuent leurs lectures via le chemin `GET /api/data/<collection>`, de sorte qu'une ligne est
  retournée telle que l'API REST la sert (dates au format ISO, relation `belongsTo` représentée par sa clé étrangère, par ex.
  `authorId`) et peut être réémise à l'identique lors d'une mise à jour. `query_collection`
  retourne `{ data, meta }` avec `meta.total` et `meta.hasMore`, tandis que `count_documents`
  retourne `{ count }`. `aggregate_documents` correspond à `GET /api/data/<collection>/aggregate` :
  `select` est une liste rédigée selon la syntaxe REST (`["count()", "sum(total)"]`), `groupBy`
  est une liste de champs, et l'outil renvoie `{ data }` avec une ligne par groupe, complétée par
  `meta.hasMore` lors d'un appel groupé, dont les groupes peuvent être paginés avec `limit` et `offset`
  et triés avec `orderBy`. Sur une collection qu'un hook `afterRead` réécrit, il
  ne renvoie que `count()`, exactement comme l'API REST. De la même façon qu'avec REST, une valeur de `limit` supérieure à 1000, un argument non reconnu ou la
  modification ou suppression d'une ligne placée dans la corbeille (404) sont rejetés ; assigner la
  valeur `null` au champ de suppression réversible restaure l'enregistrement. L'argument `deleted: "only"` (ou `"include"`) sur
  `query_collection`, `count_documents` et `aggregate_documents` permet de lire la corbeille, à l'image du paramètre
  `?deleted=` de REST, rendant accessible une ligne supprimée par `delete_document` en vue de sa
  restauration. Sa description signale au modèle que la suppression n'est définitive que
  si la collection ne possède aucun champ de suppression réversible.
- **La liste énumère les collections ; `describe_collection` en fournit le schéma.**
  `list_collections` renvoie pour chaque collection ses attributs `name`, `title` et `description`,
  tandis que `describe_collection { collection }` fournit les schémas OpenAPI `row` et
  `create` de cette collection, ainsi que le champ `softDeleteField` lorsque les lignes sont dirigées vers une corbeille. Les
  descriptions des outils recommandent au modèle de décrire une collection avant toute tentative d'écriture. La
  liste d'un projet de 200 collections consomme environ 5 000 jetons, et chaque description
  moins de 1 000 jetons ; inclure l'ensemble des schémas directement dans la liste représentait près de 150 000 jetons.
- **Un jeton restreint à ce point de terminaison.** Un jeton d'accès MCP est rejeté par
  `/api/data`, `/api/admin` et le WebSocket, garantissant que connecter un assistant ne
  revient pas à lui transmettre une session globale.

Chaque requête adressée à `/mcp` réévalue le compte de l'utilisateur. Un compte
supprimé ou désactivé, une déconnexion globale (« se déconnecter de partout ») ou un changement de mot de passe postérieur
à l'émission du jeton interrompt immédiatement le client connecté avec une erreur 401. Une rétrogradation de permissions prend effet
dès le prochain appel d'outil. Chaque renouvellement applique les mêmes vérifications et invalide définitivement
l'autorisation correspondante. Une session invité ne peut en aucun cas accorder de consentement.

Une limite toutefois : déconnecter un client (`DELETE /api/oauth/grants/:clientId`, avec la
propre session de l'utilisateur) révoque instantanément ses jetons de rafraîchissement, mais un jeton d'accès
déjà émis reste fonctionnel jusqu'à son expiration normale, dans un délai maximal d'une heure.

Les routes sont documentées dans [Endpoints](/docs/backend/endpoints/#mcp-surface) et les
variables dans [Configuration](/docs/getting-started/configuration/#mcp-surface).
