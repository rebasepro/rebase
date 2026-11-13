---
sourceHash: 4c9e8266acfba86f
title: Le point de terminaison MCP distant
sidebar_label: Point de terminaison MCP distant
description: Servez MCP depuis un backend déployé sur /mcp, afin que les utilisateurs de votre application puissent connecter Claude ou Cursor en leur propre nom — OAuth avec un écran de consentement, dix-sept outils sous trois portées, chaque appel soumis à leur propre sécurité au niveau des lignes.
---

:::tip[Connecter Claude à vos propres projets ?]
Il s'agit du [connecteur Rebase](/docs/ai/rebase-connector/) : un seul connecteur pour
l'ensemble d'entre eux, et un serveur auto-hébergé le rejoint avec `rebase cloud connect`. Cette
page s'adresse aux personnes qui **utilisent** votre application.
:::

Le [serveur MCP](/docs/ai/mcp/) est un outil de développement : il s'exécute sur votre machine et détient une clé
de service ou une clé d'API. Un backend déployé peut également servir MCP lui-même, sur `/mcp`, pour
les personnes qui utilisent votre application. Un assistant connecté par l'une d'elles lit et
écrit dans le projet **en tant que cette personne**, et chaque appel s'exécute sous sa propre
sécurité au niveau des lignes (RLS).

Il est désactivé par défaut, et les deux variables sont obligatoires :

```bash
REBASE_MCP_ENABLED=true
REBASE_PUBLIC_URL=https://app.example.com   # this deployment's real origin
```

Sans `REBASE_PUBLIC_URL`, un secret JWT ou un pilote de données capable de restreindre une requête
à un utilisateur, le point de terminaison refuse de se monter et en indique la raison dans le journal de démarrage. Aucun
`REBASE_ROLE` ne l'active.

- **OAuth, avec un écran de consentement.** Un client trouve le serveur d'autorisation
  via `/.well-known/oauth-protected-resource`, s'enregistre (l'enregistrement
  dynamique est activé par défaut ; `REBASE_MCP_OPEN_REGISTRATION=false` le restreint
  aux clients que vous enregistrez) et redirige la personne vers un écran de consentement qui
  la connecte via votre `/auth/login` existant. Un compte avec un second facteur
  est ensuite invité à saisir son code d'authentification ou un code de récupération, via les
  routes `/auth/mfa/challenge` existantes. Lorsque le propre frontend de votre application
  conserve une session dans le même navigateur, l'écran propose ce compte, et
  « Autoriser » donne le consentement sous cette identité sans mot de passe ; c'est ainsi que se connecte une personne
  qui s'authentifie uniquement avec Google, GitHub ou un lien par e-mail. Sinon, elle se connecte avec un
  mot de passe, et si elle n'en a pas, elle en définit d'abord un avec `/auth/forgot-password`
  (le « Mot de passe oublié » de votre application) ; l'écran le lui signale. Il mentionne également l'hôte auquel le code d'autorisation est envoyé,
  et précise que cet hôte n'est pas vérifié : n'importe qui pouvant enregistrer un client sous
  n'importe quel nom, l'hôte est la partie qu'une personne peut vérifier.
- **Dix-sept outils, trois portées.** <span class="since-badge" data-since="0.31">Depuis 0.31</span> Les mêmes [portées](/docs/backend/roles-and-scopes/)
  que chaque identifiant utilise. `data:read` propose `list_tables`, `describe_table`,
  `query_table`, `count_rows`, `aggregate_rows`, `get_row`, les trois vues,
  `show_table`, `show_record` et `show_app`, `show_app_guide`, ainsi que les commandes expérimentales
  `list_apps` et `open_app` ; `data:write` ajoute `create_row`, `update_row` et les commandes
  expérimentales `save_app` et `delete_app` ; `data:delete` ajoute `delete_row`. Un client qui ne demande
  rien obtient `data:read`. Chacune se restreint à une table : `data:read:posts`
  liste, décrit et lit `posts` et rien d'autre. Une portée décide quels outils sont
  proposés et quelles tables ils atteignent, pas quelles lignes : une liste vide peut simplement être
  l'effet de la RLS, et `data:write` ne peut toujours pas écrire une ligne que la personne ne pourrait pas écrire.
- **Trois outils placent votre panneau d'administration devant l'utilisateur.** Dans un client qui
  affiche les applications MCP, tel que Claude, ils ouvrent les vues propres au panneau d'administration dans la
  conversation, générées à partir des descripteurs de table que le backend sert à cette
  personne — colonnes, énumérations, validations, relations — avec les préférences d'interface que le
  panneau compose : le `ui-config.json` fourni avec le bundle, celui de l'espace de travail et
  celui propre à la personne (une clé d'API n'en a aucun), de sorte que les libellés, l'ordre des colonnes, les colonnes
  masquées et les libellés d'énumérations correspondent au panneau. Les personnalisations du panneau
  de votre propre projet apparaissent là où le backend sert sa vue MCP.
  - `show_table` prend les arguments de `query_table`, plus `view`
    (`table`, `list`, `cards` ou `kanban`), et ouvre la vue de la table : la
    personne peut rechercher, filtrer, trier et paginer, ouvrir le formulaire d'une ligne et ajouter des lignes.
  - `show_record` ouvre le formulaire d'une ligne (`id`), ou un formulaire pour une nouvelle ligne qui
    part des `values` renseignées par le modèle, afin que la personne puisse vérifier et
    enregistrer elle-même.
  - `show_app` exécute une application que le modèle écrit pour la tâche demandée : un composant React
    unique (`code`) et les `tables` qu'il lit. Il importe les propres
    packages de Rebase, de sorte que le même code fonctionne dans votre projet :
    - `@rebasepro/app` : `useRows`, `useRow`, `useRowCount`, `useAggregate`
      et `useRowWrites` sur les lignes du projet ;
    - `@rebasepro/cms` : le composant `CollectionPanel` du panneau d'administration (avec
      `CollectionToolbar` et ses éléments, ainsi que `onRowClick`, qui transmet à
      l'application la ligne cliquée telle que `useRows` la lit), `RecordForm` et `FormField`,
      `RecordDetail`, `FieldValue` et `useSidePanel`, chacun désignant sa
      table par son chemin, avec vos champs, vues et actions personnalisés ;
    - `@rebasepro/ui`, l'ensemble du kit d'interface utilisateur, `SplitView` ainsi que les tuiles de KPI et
      les graphiques inclus.

    Le serveur le compile d'abord, de sorte qu'une erreur de syntaxe, un module que la vue ne
    sert pas, ou un nom qu'elle ne sert pas depuis `@rebasepro/cms` ou
    `@rebasepro/app` constitue l'erreur de l'appel, avec son numéro de ligne. Une erreur pendant son
    exécution est affichée à sa place et signalée au modèle avec le message suivant
    de la personne. Une application ne peut utiliser que les tables qu'elle énumère. Ses styles sont
    les utilitaires standard de Tailwind, compilés avec la vue avant que la moindre application
    n'arrive : une valeur arbitraire telle que `h-[560px]` n'y produit rien, une
    taille exacte passe donc par un `style`.

    La description de `show_app` ne contient que l'essentiel, car un client
    peut tronquer une description d'outil trop longue (claude.ai le fait à environ 4 000
    caractères). Elle indique au modèle d'appeler d'abord `show_app_guide`, qui
    renvoie chaque hook, composant et prop qu'une application peut utiliser, avec un exemple
    pratique. `show_app_guide` est proposé partout où `show_app` l'est.

  Chaque lecture et enregistrement dans la vue est un appel aux outils de lecture et d'écriture,
  effectué en tant que la personne sous sa propre RLS, de sorte qu'un formulaire ne propose que ce qui a été
  accordé à sa connexion : sans `data:write`, il est en lecture seule, et un champ que
  ses rôles ne peuvent pas lire n'y figure pas. C'est également la limite dans laquelle fonctionne
  le code d'une application : il s'exécute dans la vue, donc chaque appel qu'il effectue est l'un de
  ces outils, en tant que la personne, et il ne peut rien faire que le modèle ne pourrait faire
  avec ces mêmes outils. Sur le connecteur hébergé, chaque écriture est également planifiée
  et confirmée par le serveur. Dans ce cadre, `useRowWrites` demande confirmation à la personne
  avant d'écrire, afin qu'une application n'écrive pas sans son clic ; les
  propres commandes de l'administrateur (le bouton Enregistrer d'un formulaire, une suppression, une modification de table) se comportent comme
  sur un écran `show_table`. Le modèle est informé de ce qu'elles ont modifié. Il lit les lignes renvoyées par chaque outil, et non les descripteurs utilisés
  par la vue pour le rendu. Un client sans applications MCP, comme Claude Code ou Cursor, n'affiche rien,
  et le modèle lit les mêmes lignes qu'il lirait depuis `query_table`.
- **Expérimental : applications enregistrées dans le projet.** `save_app` conserve une application que le
  modèle a construite avec `show_app` pour qu'elle s'ouvre à nouveau : elle compile le code comme
  le fait `show_app` et le stocke avec son `title`, ses `tables` et sa
  `visibility`, qui peut être `personal` (son propriétaire, par défaut), `roles` (toute personne
  détenant l'un de ses `roles`) ou `team` (toutes les personnes qui se connectent). Enregistrer pour
  d'autres que soi nécessite le rôle d'administrateur, puisqu'une application partagée est du code rédigé par une IA,
  qui s'exécute pour d'autres personnes. Seul son propriétaire ou un administrateur peut en remplacer
  (`id`) ou en supprimer une, et une personne en conserve au maximum 200. `list_apps` liste
  les applications que l'appelant peut ouvrir, `open_app` en ouvre une comme le ferait `show_app`, et
  `delete_app` en supprime une. Pouvoir voir une application ne signifie pas avoir accès à ses données : une
  application ouverte lit et écrit via les outils ci-dessus, sous l'identité de quiconque l'ouvre, sous
  sa propre RLS. Les applications résident dans `rebase.saved_apps`, que le backend crée
  la première fois qu'un outil l'utilise et qu'il n'accorde à aucun utilisateur final.
  Le panneau d'administration ouvre les mêmes applications : ajoutez `savedAppsView` depuis
  `@rebasepro/cms` à vos `views`. Il exécute une application dans une iframe isolée (sandboxed)
  sans `allow-same-origin` et sans accès réseau propre, et relaie ses
  appels d'outils vers `POST /api/admin/apps/mcp`, les mêmes outils pour la session du panneau
  d'administration, qui est montée avec les routes d'administration, que
  `REBASE_MCP_ENABLED` soit défini ou non. Les noms et formats des outils peuvent encore changer.
- **Les autorisations accordées avant la 0.24 conservent leur portée.** `mcp:read` est interprété comme
  `data:read`, et `mcp:write` comme `data:write data:delete`, sur les autorisations stockées et
  sur les jetons déjà émis.
- **Une clé d'API fonctionne également.** `/mcp` accepte aussi `Authorization: Bearer rk_…`, pour
  un client configuré avec un en-tête plutôt qu'avec un flux OAuth. La clé a accès
  aux outils couverts par ses portées `data:*`, selon l'identité au nom de laquelle elle agit : une
  [clé personnelle](/docs/backend/api-keys/#personal-keys) en tant que son propriétaire, une clé de service
  en tant que `api-key:<id>`.
- **Le vocabulaire du SDK, les réponses de REST.** Les outils acceptent ce que le SDK accepte —
  `where` (`{"status": ["==", "paid"]}`), `orderBy` (`["created_at", "desc"]` ou
  `"created_at:desc"`), `limit`, `offset`, `searchString`, et `data` pour une
  écriture — et lisent via le chemin de `GET /api/data/<table>`, de sorte qu'une ligne revient
  telle que REST la sert (dates ISO, un `belongsTo` sous forme de sa clé étrangère, par ex.
  `authorId`) et peut être renvoyée telle quelle lors d'une mise à jour. `query_table`
  renvoie `{ data, meta }` avec `meta.total` et `meta.hasMore`, et `count_rows`
  `{ count }` ; `tools/list` fournit à la fois pour `aggregate_rows` et `get_row`
  un `outputSchema`, souple là où une réponse varie. `aggregate_rows` correspond à `GET /api/data/<table>/aggregate` :
  `select` est une liste selon la grammaire de REST (`["count()", "sum(total)"]`), `groupBy`
  une liste de champs, et il renvoie `{ data }` avec une ligne par groupe, plus
  `meta.hasMore` lors d'un appel groupé, dont les groupes sont paginés avec `limit` et `offset`
  et triés avec `orderBy`. Sur une table qu'un hook `afterRead` réécrit, il
  ne sert que `count()`, tout comme REST. Comme sur REST, une `limit` supérieure à 1000, un argument non déclaré et une
  modification ou suppression d'une ligne mise à la corbeille (404) sont refusés ; définir le champ de
  suppression douce (soft-delete) à `null` la restaure. `deleted: "only"` (ou `"include"`) sur
  `query_table`, `count_rows` et `aggregate_rows` lit la corbeille, tout comme le fait `?deleted=`
  dans REST, permettant ainsi de retrouver une ligne supprimée par `delete_row` pour la
  restaurer. Sa description indique au modèle que la suppression n'est définitive que là où
  la table n'a pas de champ de suppression douce.
- **La liste nomme les tables ; `describe_table` fournit le schéma de l'une d'entre elles.**
  `list_tables` renvoie `{ tables: [{ name, description, kind? }] }` — sans libellé —
  et `describe_table { table }` renvoie les schémas OpenAPI `row` (les colonnes servies à cet appelant)
  et `create` (celles accessibles en écriture) de cette table, sa `primaryKey`, les `relations` servies et la `rls` (SQL
  brut masqué sans `schema:read`), ainsi que `softDeleteField` lorsque les lignes vont dans une
  corbeille, et la présentation que les préférences d'interface de l'appelant lui confèrent : `title`, et
  par colonne `label`, `valueLabels`, `hidden`, `hiddenInForm`, `readOnly`. Ce qu'une
  connexion peut apprendre sur le schéma est déterminé par le même sérialiseur que
  celui utilisé par `GET /api/schema/tables`. Les descriptions des outils indiquent au modèle de
  décrire une table avant d'y écrire. La liste d'un projet de 200 tables représente
  environ 5k jetons, et chaque description
  moins de 1k ; avec chaque schéma inclus dans la liste, cela représentait environ 150k jetons.
- **Un jeton réservé à ce point de terminaison.** Un jeton d'accès MCP est refusé par
  `/api/data`, `/api/admin` et le WebSocket, de sorte que connecter un assistant ne lui
  transmet pas de session.

Chaque requête vers `/mcp` relit le compte de la personne. Un compte supprimé ou désactivé,
ou une « déconnexion globale » ou un changement de mot de passe après l'émission
du jeton, bloque immédiatement un client connecté avec une erreur 401. Une rétrogradation s'applique dès son
prochain appel d'outil. Chaque rafraîchissement effectue les mêmes vérifications et refuse définitivement
une telle autorisation. Une session invité ne peut en aucun cas donner son consentement.

Une limite. La déconnexion d'un client (`DELETE /api/oauth/grants/:clientId`, avec la
propre session de la personne) révoque immédiatement ses jetons de rafraîchissement, mais un jeton d'accès
déjà émis continue de fonctionner jusqu'à son expiration, dans la limite d'une heure.

Les routes sont décrites dans [Points de terminaison](/docs/backend/endpoints/#mcp-surface) et les
variables dans [Configuration](/docs/getting-started/configuration/#mcp-surface).
