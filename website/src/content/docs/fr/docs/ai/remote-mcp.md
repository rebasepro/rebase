---
sourceHash: da06ce7daeaa1c32
title: L'endpoint MCP distant
sidebar_label: Endpoint MCP distant
description: Servez MCP depuis un backend déployé sur /mcp, afin que les utilisateurs de votre application puissent connecter Claude ou Cursor en leur propre nom — OAuth avec écran de consentement, dix-sept outils sous trois scopes, chaque appel soumis à leur propre sécurité au niveau des lignes.
---

:::tip[Connecter Claude à vos propres projets ?]
Il s'agit du [connecteur Rebase](/docs/ai/rebase-connector/) : un seul connecteur pour
l'ensemble d'entre eux, et un serveur auto-hébergé le rejoint avec `rebase cloud connect`. Cette
page s'adresse aux personnes qui **utilisent** votre application.
:::

Le [serveur MCP](/docs/ai/mcp/) est un outil pour les développeurs : il s'exécute sur votre machine et détient une clé de service
ou une clé d'API. Un backend déployé peut également servir MCP lui-même, à l'adresse `/mcp`, pour
les personnes qui utilisent votre application. L'assistant connecté par l'une d'elles lit et
écrit dans le projet **en tant que cette personne**, et chaque appel s'exécute sous sa propre
sécurité au niveau des lignes (row-level security).

Il est désactivé sauf si vous l'activez, et les deux variables sont obligatoires :

```bash
REBASE_MCP_ENABLED=true
REBASE_PUBLIC_URL=https://app.example.com   # this deployment's real origin
```

Sans `REBASE_PUBLIC_URL`, sans secret JWT ou sans pilote de données capable de restreindre une requête
à un seul utilisateur, l'endpoint refuse de se monter et indique la raison dans les logs de démarrage. Aucun
`REBASE_ROLE` ne l'active.

- **OAuth, avec un écran de consentement.** Un client découvre le serveur d'autorisation
  via `/.well-known/oauth-protected-resource`, s'enregistre lui-même (l'enregistrement
  dynamique est activé par défaut ; `REBASE_MCP_OPEN_REGISTRATION=false` le restreint
  aux clients que vous enregistrez) et redirige l'utilisateur vers un écran de consentement qui
  l'authentifie via votre route existante `/auth/login`. Un compte disposant d'un second facteur
  doit ensuite renseigner son code d'authentification ou un code de récupération, via les
  routes existantes `/auth/mfa/challenge`. Lorsque le propre frontend de votre application
  conserve une session dans le même navigateur, l'écran propose ce compte, et
  Autoriser valide le consentement sous cette identité sans mot de passe ; c'est ainsi que se connectent
  les personnes qui s'identifient uniquement avec Google, GitHub ou un lien par e-mail. Sinon, la connexion
  s'effectue avec un mot de passe, et une personne qui n'en possède pas en définit un au préalable avec `/auth/forgot-password`
  (le « Mot de passe oublié » de votre application) ; l'écran le lui indique. Il mentionne également l'hôte auquel le code d'autorisation est envoyé,
  et précise que cet hôte n'est pas vérifié : n'importe qui pouvant enregistrer un client sous
  n'importe quel nom, l'hôte est l'élément que l'utilisateur peut vérifier.
- **Dix-sept outils, trois scopes.** Les mêmes [scopes](/docs/backend/roles-and-scopes/)
  que chaque identifiant utilise. `data:read` propose `list_tables`, `describe_table`,
  `query_table`, `count_rows`, `aggregate_rows`, `get_row`, les trois vues
  `show_table`, `show_record` et `show_app`, `show_app_guide`, ainsi que les commandes expérimentales
  `list_apps` et `open_app` ; `data:write` ajoute `create_row`, `update_row` et les commandes
  expérimentales `save_app` et `delete_app` ; `data:delete` ajoute `delete_row`. Un client qui ne demande
  rien obtient `data:read`. Chacun peut être restreint à une table : `data:read:posts`
  liste, décrit et lit `posts`, et rien d'autre. Un scope détermine quels outils sont
  proposés et quelles tables ils atteignent, non quelles lignes : une liste vide peut simplement être
  le résultat de la RLS, et `data:write` ne peut toujours pas écrire une ligne à laquelle la personne n'a pas accès.
- **Trois outils placent votre panneau d'administration sous les yeux de l'utilisateur.** Dans un client qui
  prend en charge les MCP Apps, comme Claude, ils ouvrent les vues propres au panneau d'administration dans la
  conversation, générées à partir des descripteurs de table que le backend fournit à cette
  personne — colonnes, énumérations, validation, relations — avec les préférences d'interface que
  le panneau assemble : le `ui-config.json` inclus dans le bundle, celui de l'espace de travail et
  les préférences propres à l'utilisateur (une clé d'API n'en a aucune), afin que les libellés, l'ordre des colonnes, les colonnes
  masquées et les libellés d'énumérations correspondent au panneau. Les personnalisations
  du panneau de votre propre projet s'affichent là où le backend sert sa vue MCP.
  - `show_table` prend les arguments de `query_table`, plus `view`
    (`table`, `list`, `cards` ou `kanban`), et ouvre la vue de la table : la
    personne peut rechercher, filtrer, trier et paginer, ouvrir le formulaire d'une ligne et ajouter des lignes.
  - `show_record` ouvre le formulaire d'une ligne (`id`), ou un formulaire pour une nouvelle ligne qui
    part des `values` renseignées par le modèle, afin que la personne puisse vérifier et
    enregistrer elle-même.
  - `show_app` exécute une application que le modèle écrit pour la tâche en cours : un
    composant React (`code`) et les `tables` qu'il lit. Il importe les packages propres à
    Rebase, de sorte que le même code fonctionne dans votre projet :
    - `@rebasepro/app` : `useRows`, `useRow`, `useRowCount`, `useAggregate`
      et `useRowWrites` sur les lignes du projet ;
    - `@rebasepro/cms` : le `CollectionPanel` du panneau d'administration (avec
      `CollectionToolbar` et ses éléments, et `onRowClick`, qui transmet à
      l'application la ligne cliquée telle que `useRows` la lit), `RecordForm` et `FormField`,
      `RecordDetail`, `FieldValue` et `useSidePanel`, chacun désignant sa
      table par son chemin, avec vos champs, vues et actions personnalisés ;
    - `@rebasepro/ui`, l'ensemble du kit d'interface utilisateur, `SplitView` ainsi que les tuiles de KPI et
      les graphiques inclus.

    Le serveur la compile d'abord : une erreur de syntaxe, un module que la vue
    ne fournit pas ou un nom qu'elle n'exporte pas depuis `@rebasepro/cms` ou
    `@rebasepro/app` constitue l'erreur de l'appel, avec son numéro de ligne. Une erreur pendant son
    exécution s'affiche à sa place et est signalée au modèle avec le prochain
    message de l'utilisateur. Une application ne peut utiliser que les tables qu'elle liste. Ses styles sont
    les utilitaires standard de Tailwind, compilés avec la vue avant l'arrivée de
    toute application : une valeur arbitraire telle que `h-[560px]` n'a aucun effet ici,
    une taille exacte doit donc être définie via un `style`.

    La description de `show_app` ne contient que l'essentiel, car un client
    peut tronquer une description d'outil trop longue (claude.ai le fait aux alentours de 4 000
    caractères). Elle indique au modèle d'appeler d'abord `show_app_guide`, qui
    renvoie chaque hook, composant et prop qu'une application peut utiliser, avec un
    exemple concret. `show_app_guide` est proposé partout où `show_app` l'est.

  Chaque lecture et chaque sauvegarde dans la vue correspond à l'appel de l'un des outils de lecture et d'écriture,
  effectué au nom de la personne et soumis à sa RLS, de sorte qu'un formulaire ne propose que ce qui a
  été accordé à sa connexion : sans `data:write`, il est en lecture seule, et un champ
  que ses rôles ne peuvent pas lire n'y figure pas. C'est également la limite dans laquelle fonctionne
  le code d'une application : s'exécutant dans la vue, chaque appel qu'il effectue correspond à l'un de
  ces outils, au nom de la personne, et il ne peut rien faire que le modèle ne pourrait faire
  avec ces mêmes outils. Sur le connecteur hébergé, chaque écriture est également planifiée
  et confirmée par le serveur. Dans ce cadre, `useRowWrites` demande confirmation à la personne
  avant d'écrire, afin qu'une application n'écrive rien sans son clic ; les
  contrôles natifs de l'administration (le bouton Enregistrer d'un formulaire, une suppression, une modification de table) se comportent comme ils
  le font sur un écran `show_table`. Le modèle est informé de ce qu'ils ont modifié. Il lit les lignes renvoyées par chaque outil, et non les descripteurs utilisés
  par la vue pour le rendu. Un client sans support des MCP Apps, tel que Claude Code ou Cursor, n'affiche rien,
  et le modèle lit les mêmes lignes qu'il lirait depuis `query_table`.
- **Expérimental : applications enregistrées dans le projet.** `save_app` conserve une application que le
  modèle a créée avec `show_app` afin qu'elle puisse être rouverte : elle compile le code comme
  le fait `show_app` et le stocke avec son `title`, ses `tables` et sa
  `visibility`, qui peut être `personal` (son propriétaire, par défaut), `roles` (toute personne
  détenant l'un de ses `roles`) ou `team` (toutes les personnes qui se connectent). L'enregistrement pour
  d'autres que soi nécessite le rôle d'administrateur, car une application partagée est du code écrit par une IA,
  qui s'exécute pour d'autres personnes. Seul son propriétaire ou un administrateur peut en remplacer
  (`id`) ou en supprimer une, et une personne peut en conserver au maximum 200. `list_apps` liste
  les applications que l'appelant peut ouvrir, `open_app` en ouvre une comme le ferait `show_app`, et
  `delete_app` en supprime une. Voir une application ne donne pas accès à ses données : une
  application ouverte lit et écrit via les outils ci-dessus, au nom de la personne qui l'ouvre, sous
  sa RLS. Les applications résident dans `rebase.saved_apps`, que le backend crée
  la première fois qu'un outil l'utilise et à laquelle aucun utilisateur final n'a accès direct.
  Le panneau d'administration ouvre les mêmes applications : ajoutez `savedAppsView` depuis
  `@rebasepro/cms` à vos `views`. Il exécute une application dans une iframe isolée (sandbox)
  sans `allow-same-origin` et sans accès réseau propre, et relaie ses
  appels d'outils vers `POST /api/admin/apps/mcp`, les mêmes outils pour la session du panneau
  d'administration, qui est montée avec les routes d'administration, que
  `REBASE_MCP_ENABLED` soit défini ou non. Les noms et les formes des outils peuvent encore changer.
- **Les autorisations accordées avant la version 0.24 conservent leur portée.** `mcp:read` est interprété comme
  `data:read`, et `mcp:write` comme `data:write data:delete`, sur les autorisations enregistrées et
  sur les jetons déjà émis.
- **Une clé d'API fonctionne également.** `/mcp` accepte aussi `Authorization: Bearer rk_…`, pour
  un client configuré avec un en-tête plutôt qu'avec un flux OAuth. La clé a accès
  aux outils couverts par ses scopes `data:*`, selon l'identité qu'elle représente : une
  [clé personnelle](/docs/backend/api-keys/#personal-keys) en tant que son propriétaire, une clé de service
  en tant que `api-key:<id>`.
- **Le vocabulaire du SDK, les réponses de REST.** Les outils acceptent ce que le SDK accepte —
  `where` (`{"status": ["==", "paid"]}`), `orderBy` (`["created_at", "desc"]` ou
  `"created_at:desc"`), `limit`, `offset`, `searchString`, et `data` pour une
  écriture — et lisent via le chemin de `GET /api/data/<table>`, de sorte qu'une ligne est
  renvoyée telle que REST la sert (dates ISO, un `belongsTo` sous forme de sa clé étrangère, par ex.
  `authorId`) et peut être renvoyée dans une mise à jour sans modification. `query_table`
  répond `{ data, meta }` avec `meta.total` et `meta.hasMore`, et `count_rows`
  `{ count }` ; `tools/list` fournit aux deux, à `aggregate_rows` et à `get_row`
  un `outputSchema`, souple là où une réponse varie. `aggregate_rows` correspond à `GET /api/data/<table>/aggregate` :
  `select` est une liste selon la grammaire de REST (`["count()", "sum(total)"]`), `groupBy`
  une liste de champs, et il répond `{ data }` avec une ligne par groupe, plus
  `meta.hasMore` lors d'un appel groupé, dont les groupes se paginent avec `limit` et `offset`
  et se trient avec `orderBy`. Sur une table qu'un hook `afterRead` réécrit, il
  ne sert que `count()`, comme le fait REST. Comme avec REST, une `limit` supérieure à 1000, un argument non déclaré et une
  modification ou suppression d'une ligne mise à la corbeille (404) sont refusés ; définir le champ
  de suppression réversible à `null` la restaure. `deleted: "only"` (ou `"include"`) sur
  `query_table`, `count_rows` et `aggregate_rows` lit la corbeille, tout comme `?deleted=`
  de REST, afin qu'une ligne mise à la corbeille par `delete_row` puisse être retrouvée pour
  être restaurée. Sa description indique au modèle que la suppression n'est définitive que lorsque
  la table n'a pas de champ de suppression réversible.
- **Le listing nomme les tables ; `describe_table` fournit le schéma de l'une d'elles.**
  `list_tables` répond `{ tables: [{ name, description, kind? }] }` — sans libellé —
  et `describe_table { table }` renvoie les schémas OpenAPI `row` (les colonnes servies à cet appelant)
  et `create` (celles accessibles en écriture) de cette table, sa `primaryKey`, les `relations` servies et la `rls` (SQL brut
  caviardé sans `schema:read`), ainsi que `softDeleteField` lorsque les lignes vont dans une
  corbeille, et la présentation que lui confèrent les préférences d'interface de l'appelant : `title`, et
  par colonne `label`, `valueLabels`, `hidden`, `hiddenInForm`, `readOnly`. Ce qu'une
  connexion peut apprendre sur le schéma est déterminé par le même sérialiseur que celui utilisé
  par `GET /api/schema/tables`. Les descriptions des outils indiquent au modèle de
  décrire une table avant d'y écrire. Le listing d'un projet de 200 tables représente
  environ 5 000 tokens, et chaque description
  moins de 1 000 ; avec l'ensemble des schémas dans le listing, cela représentait environ 150 000 tokens.
- **Un jeton réservé à cet endpoint.** Un jeton d'accès MCP est refusé par
  `/api/data`, `/api/admin` et le WebSocket ; connecter un assistant ne lui
  transmet donc pas de session.

Chaque requête vers `/mcp` relit le compte de la personne. Un compte supprimé ou désactivé,
ou une déconnexion globale (« se déconnecter de partout ») ou un changement de mot de passe après l'émission
du jeton, interrompt immédiatement un client connecté avec une erreur 401. Une rétrogradation de droits s'applique dès
son prochain appel d'outil. Chaque rafraîchissement effectue les mêmes vérifications et refuse définitivement
une telle autorisation. Une session invité ne peut pas consentir du tout.

Une limite. La déconnexion d'un client (`DELETE /api/oauth/grants/:clientId`, avec la propre
session de la personne) révoque immédiatement ses jetons de rafraîchissement, mais un jeton d'accès
déjà émis continue de fonctionner jusqu'à son expiration, dans la limite d'une heure.

## Skills

L'endpoint peut également servir des [Agent Skills](https://agentskills.io/specification)
via MCP : des instructions qu'un assistant charge lorsque la tâche le requiert, comme la
façon dont votre équipe enregistre une commande ou la signification d'un champ. Placez chaque skill dans son propre
dossier, avec un fichier `SKILL.md` dont le frontmatter comporte un `name` correspondant au dossier
et une `description`, ainsi que tous les fichiers vers lesquels il pointe. Indiquez ensuite le dossier parent
dans la configuration du backend :

```ts
// skills/order-intake/SKILL.md, skills/order-intake/references/fields.md, …
createRebaseBackend({
    ...options, // the rest of your backend config
    mcp: { skills: "./skills" }
});
```

Le chemin est relatif au répertoire de travail. Les outils de données restent tels qu'ils
sont, et `skills` prend place aux côtés de `tools` lorsqu'un backend apporte les siens.

- **Ce qu'un client voit.** Les clients sur la révision de protocole 2026-07-28 ou ultérieure
  (Claude Code, Claude) listent les skills et en chargent une lorsqu'elle est pertinente.
  Claude Code nomme chacune d'elles `<connector>:<skill>`. Elles sont servies via
  l'extension MCP skills (`io.modelcontextprotocol/skills`) : `skills/list`,
  `skills/get`, et `resources/read` de `skill://<name>/…`. Chaque skill est accompagnée
  d'un manifeste SHA-256 de ses fichiers. Le client vérifie chaque fichier par rapport à
  ce manifeste, et l'approbation de la personne y est liée.
- **Qui peut les lire.** Toute connexion authentifiée, quels que soient ses scopes.
  Ne mettez rien dans une skill qui ne soit pas destiné à toutes les personnes qui se connectent.
- **Quand elles changent.** Le dossier est lu lors de la première requête qui le requiert,
  de sorte qu'une modification prend effet au prochain déploiement ou redémarrage. Un fichier qui change sur le
  disque avant cela est refusé et non servi par rapport à un manifeste auquel il ne
  correspond plus.
- **Ce qui est exclu.** Une skill qui enfreint une règle est ignorée, et le log de démarrage
  en indique la raison. Les règles : absence de frontmatter, nom différent de celui de son dossier,
  lien symbolique à l'intérieur, ou plus de 512 fichiers ou 16 Mio. Les fichiers masqués tels que
  `.gitkeep` ne sont jamais servis. Une skill dépassant les propres limites de Claude Code (100 Ko
  par fichier, 400 Ko au total) est servie avec un avertissement, car Claude Code ne
  la chargera pas.

L'endpoint prend en charge les deux époques de protocole. Un client de l'époque 2025 s'ouvre avec
`initialize`, comme auparavant. Un client 2026-07-28 n'envoie pas de handshake. Chaque requête
transporte sa version de protocole et ses capacités dans `params._meta`, ainsi que les
en-têtes `MCP-Protocol-Version`, `Mcp-Method` et `Mcp-Name`, qui doivent concorder avec le corps. Ses capacités proviennent de `server/discover`. Les skills ne sont
déclarées qu'à cet endroit.

Les routes se trouvent dans [Endpoints](/docs/backend/endpoints/#mcp-surface) et les
variables dans [Configuration](/docs/getting-started/configuration/#mcp-surface).
