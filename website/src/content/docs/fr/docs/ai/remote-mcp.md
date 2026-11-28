---
sourceHash: 3e29eee7079b7ef3
title: Le point de terminaison MCP distant
sidebar_label: Point de terminaison MCP distant
description: Servez MCP depuis un backend déployé sur /mcp, afin que les personnes utilisant votre application puissent connecter Claude ou Cursor en leur propre nom — OAuth avec écran de consentement, dix-sept outils sous trois scopes, chaque appel sous leur propre sécurité au niveau des lignes (RLS).
---

:::tip[Connecter Claude à vos propres projets ?]
C'est le rôle du [connecteur Rebase](/docs/ai/rebase-connector/) : un seul connecteur pour
tous vos projets, et un serveur auto-hébergé le rejoint avec `rebase cloud connect`. Cette
page s'adresse aux personnes qui **utilisent** votre application.
:::

Le [serveur MCP](/docs/ai/mcp/) est un outil de développement : il s'exécute sur votre machine et détient une clé de
service ou une clé d'API. Un backend déployé peut également servir MCP lui-même, sur `/mcp`, pour
les personnes qui utilisent votre application. Lorsqu'un utilisateur connecte un assistant, celui-ci lit et
écrit dans le projet **en tant que cette personne**, et chaque appel s'exécute sous sa propre
sécurité au niveau des lignes (row-level security - RLS).

Il est désactivé par défaut, et les deux variables sont requises :

```bash
REBASE_MCP_ENABLED=true
REBASE_PUBLIC_URL=https://app.example.com   # this deployment's real origin
```

Sans `REBASE_PUBLIC_URL`, un secret JWT ou un pilote de données capable de restreindre une requête
à un seul utilisateur, le point de terminaison refuse de se monter et en explique la raison dans le journal de démarrage. Aucun
`REBASE_ROLE` ne l'active.

`rebase dev` est la seule exception : il active `/mcp` pour le serveur qu'il
démarre, et ce serveur définit sa propre adresse, `http://localhost:<port>`, comme
URL publique, il n'y a donc rien à configurer. Une ligne `REBASE_MCP_ENABLED`
dans le shell ou dans `.env` reste prioritaire, y compris avec la valeur `false`. La bannière de dev
affiche le point de terminaison sur une ligne `MCP:` une fois qu'il est monté.

## Connecter un client

```bash
rebase mcp connect            # pick the clients to connect, from a list
rebase mcp connect --client claude-code,cursor
rebase mcp connect --print    # the URL, the command and the install links; changes nothing
rebase mcp url                # the URL alone
```

`rebase mcp connect` demande au serveur où se trouve `/mcp` en lisant le document qu'il
publie sur `/.well-known/oauth-protected-resource/mcp`, de sorte que l'URL soit correcte
derrière un proxy, sous `REBASE_PUBLIC_URL` et sur un port de dev qui aurait changé. Ensuite, il
connecte chaque client que vous choisissez :

| Client | `--client` | Ce qui se passe |
|---|---|---|
| Claude Code | `claude-code` | Exécute `claude mcp add --transport http <name> <url>` |
| Cursor | `cursor` | Ouvre le lien d'installation de Cursor |
| VS Code | `vscode` | Ouvre le lien d'installation de VS Code |
| Claude (claude.ai, desktop, mobile) | `claude` | Affiche les étapes pour Paramètres → Connecteurs, avec l'URL à coller |
| ChatGPT | `chatgpt` | Affiche les étapes pour les paramètres de son connecteur |

Les clients détectés comme déjà installés sont cochés par défaut. Claude et ChatGPT se connectent
depuis leurs propres serveurs, qui ne peuvent pas atteindre `localhost` ; ainsi, face à un serveur de dev,
ils sont indiqués comme nécessitant un projet déployé. `--client all` les sélectionne tous.
Sans terminal, ou avec `--json`, et sans `--client`, la commande affiche ce que
fait `--print` et ne connecte rien.

Le serveur interrogé est celui du projet : `REBASE_BASE_URL`, ou sinon l'instance de
`rebase dev` en cours d'exécution. `--cloud` interroge le projet Rebase Cloud auquel le répertoire est
lié, et `--url <server>` n'importe quel backend. Un serveur dont le `/mcp` est désactivé ne répond rien
à cet endroit, et la commande indique comment l'activer.

Le serveur est enregistré sous le nom du projet, avec `-local` pour une instance sur cette
machine, afin qu'un projet local et un projet déployé puissent tous deux être connectés ; `--name`
permet de le modifier. Il ne s'appelle jamais `rebase`, qui est le nom du [serveur MCP
pour développeurs](/docs/ai/mcp/) dans le fichier `.mcp.json` d'un projet, qu'un second serveur du
même nom masquerait.

Le panneau d'administration propose les mêmes étapes. Son volet latéral comporte un bouton **Connect AI**
qui affiche l'URL publiée par le serveur, la commande `claude mcp add`, les
liens d'installation de Cursor et VS Code et, sur un projet déployé, les étapes de configuration
du connecteur pour Claude et ChatGPT. En dessous, il liste les agents que la personne
connectée a associés, chacun avec un moyen de le déconnecter. Tout utilisateur
connecté voit le bouton tant que `/mcp` est actif. Lorsqu'il est désactivé, seul un administrateur
le voit, accompagné des instructions pour l'activer.

## Ce qu'obtient une connexion

- **OAuth, avec un écran de consentement.** Un client découvre le serveur d'autorisation
  via `/.well-known/oauth-protected-resource`, s'enregistre lui-même (l'enregistrement
  dynamique est activé par défaut ; `REBASE_MCP_OPEN_REGISTRATION=false` le restreint
  aux clients que vous enregistrez), et redirige l'utilisateur vers un écran de consentement qui l'authentifie
  via votre route existante `/auth/login`. Un compte doté d'une authentification à deux facteurs
  est alors invité à saisir son code d'application d'authentification ou un code de récupération, via les
  routes existantes `/auth/mfa/challenge`. Lorsque le frontend de votre application
  conserve une session dans le même navigateur, l'écran propose ce compte, et
  cliquer sur Autoriser donne son consentement sous cette identité sans mot de passe ; c'est ainsi qu'une personne se connectant uniquement
  via Google, GitHub ou un lien par e-mail se connecte. Sinon, elle s'authentifie avec un
  mot de passe, et quiconque n'en a pas en définit un au préalable via `/auth/forgot-password`
  (le « Mot de passe oublié » de votre application) ; l'écran le lui indique. Il mentionne également l'hôte auquel le code d'autorisation est envoyé,
  et précise que cet hôte n'est pas vérifié : n'importe qui pouvant enregistrer un client sous
  n'importe quel nom, l'hôte est l'élément que l'utilisateur peut vérifier.
- **Dix-sept outils, trois scopes.** Les mêmes [scopes](/docs/backend/roles-and-scopes/)
  que ceux utilisés par chaque identifiant. `data:read` propose `list_tables`, `describe_table`,
  `query_table`, `count_rows`, `aggregate_rows`, `get_row`, les trois vues,
  `show_table`, `show_record` et `show_app`, `show_app_guide`, ainsi que les fonctions expérimentales
  `list_apps` et `open_app` ; `data:write` ajoute `create_row`, `update_row` et les
  fonctions expérimentales `save_app` et `delete_app` ; `data:delete` ajoute `delete_row`. Un client qui ne demande
  rien reçoit `data:read`. Chaque scope peut être restreint à une table : `data:read:posts`
  liste, décrit et lit `posts`, et rien d'autre. Un scope détermine quels outils sont
  proposés et quelles tables ils peuvent atteindre, mais pas quelles lignes : une liste vide peut simplement signifier
  que la RLS fonctionne, et `data:write` ne peut toujours pas écrire une ligne à laquelle la personne n'a pas accès.
- **Trois outils mettent votre panneau d'administration sous les yeux de l'utilisateur.** Dans un client qui
  prend en charge les MCP Apps, comme Claude, ils ouvrent les propres vues du panneau d'administration au sein de la
  conversation, générées à partir des descripteurs de table que le backend sert à cette
  personne — colonnes, énumérations, validation, relations — avec les préférences d'interface que
  le panneau compose : le `ui-config.json` fourni avec le bundle, celui de l'espace de travail, et
  celui propre à la personne (une clé d'API n'en a pas), de sorte que les libellés, l'ordre des colonnes, les
  colonnes masquées et les libellés d'énumérations correspondent au panneau. Les personnalisations
  apportées au panneau de votre projet s'affichent là où le backend sert sa vue MCP.
  - `show_table` prend les arguments de `query_table`, plus `view`
    (`table`, `list`, `cards` ou `kanban`), et ouvre la vue de la table :
    l'utilisateur peut rechercher, filtrer, trier et paginer, ouvrir le formulaire d'une ligne et ajouter des lignes.
  - `show_record` ouvre le formulaire d'une ligne (`id`), ou un formulaire pour une nouvelle ligne qui
    part des `values` renseignées par le modèle, pour que la personne puisse vérifier et
    enregistrer elle-même.
  - `show_app` exécute une application que le modèle écrit pour la tâche en cours : un
    composant React (`code`) et les `tables` qu'il lit. Il importe les propres
    packages de Rebase, de sorte que le même code fonctionne dans votre projet :
    - `@rebasepro/app` : `useRows`, `useRow`, `useRowCount`, `useAggregate`
      et `useRowWrites` sur les lignes du projet ;
    - `@rebasepro/cms` : le `CollectionPanel` du panneau d'administration (avec
      `CollectionToolbar` et ses composants, et `onRowClick`, qui transmet à
      l'application la ligne cliquée telle que lue par `useRows`), `RecordForm` et `FormField`,
      `RecordDetail`, `FieldValue` et `useSidePanel`, chacun ciblant sa
      table par son chemin, avec vos champs, vues et actions personnalisés ;
    - `@rebasepro/ui`, l'ensemble du kit UI, y compris `SplitView` ainsi que les tuiles et
      graphiques KPI.

    Le serveur le compile au préalable : ainsi, une erreur de syntaxe, un module que la vue
    ne fournit pas ou un nom qu'elle ne sert pas depuis `@rebasepro/cms` ou
    `@rebasepro/app` devient l'erreur de l'appel, avec son numéro de ligne. Une erreur survenant pendant
    son exécution est affichée à son emplacement et transmise au modèle avec le prochain
    message de l'utilisateur. Une application ne peut utiliser que les tables qu'elle liste. Ses styles reposent
    sur les classes utilitaires standard de Tailwind, compilées avec la vue avant l'arrivée
    de toute application : une valeur arbitraire telle que `h-[560px]` n'a aucun effet ici,
    une taille exacte doit donc être définie via un `style`.

    La description de `show_app` ne contient que l'essentiel, car un client
    peut tronquer une description d'outil trop longue (claude.ai le fait à environ 4 000
    caractères). Elle invite le modèle à appeler d'abord `show_app_guide`, qui
    renvoie chaque hook, composant et prop qu'une application peut utiliser, avec un exemple
    concret. `show_app_guide` est proposé partout où `show_app` l'est.

  Chaque lecture et sauvegarde dans la vue correspond à l'un des appels aux outils de lecture et d'écriture,
  effectué en tant que l'utilisateur et sous sa RLS. Ainsi, un formulaire ne propose que ce qui a été
  accordé à sa connexion : sans `data:write`, il est en lecture seule, et un champ
  que ses rôles ne peuvent pas lire n'y apparaît pas. C'est également la limite dans laquelle s'exécute le
  code d'une application : elle tourne dans la vue, donc chaque appel qu'elle effectue passe par l'un de
  ces outils, au nom de l'utilisateur, et elle ne peut rien faire que le modèle ne pourrait faire
  avec ces mêmes outils. Sur le connecteur hébergé, chaque écriture est également planifiée
  et confirmée par le serveur. Dans ce cadre, `useRowWrites` demande confirmation à l'utilisateur
  avant d'écrire, afin qu'une application n'écrive rien sans son clic ; les
  contrôles natifs de l'administration (le bouton Enregistrer d'un formulaire, une suppression, l'édition d'une table) se comportent comme ils
  le font sur un écran `show_table`. Le modèle est informé de leurs modifications. Il lit les lignes renvoyées par chaque outil, et non les descripteurs utilisés
  pour dessiner la vue. Un client dépourvu de support pour les MCP Apps, tel que Claude Code ou Cursor, n'affiche rien,
  et le modèle lit les mêmes lignes qu'il lirait depuis `query_table`.
- **Expérimental : applications enregistrées dans le projet.** `save_app` conserve une application que le
  modèle a construite avec `show_app` afin qu'elle puisse être rouverte : elle compile le code comme
  le fait `show_app` et le stocke avec son `title`, ses `tables` et sa
  `visibility`, qui est `personal` (son propriétaire, par défaut), `roles` (toute personne
  disposant d'un de ses `roles`) ou `team` (toute personne connectée). Sauvegarder pour
  d'autres que soi-même requiert le rôle d'administrateur, puisqu'une application partagée est du code généré par une IA
  s'exécutant pour d'autres personnes. Seuls son propriétaire ou un administrateur peuvent en remplacer
  (`id`) ou en supprimer une, et une personne peut en conserver au maximum 200. `list_apps` liste
  les applications que l'appelant peut ouvrir, `open_app` en ouvre une comme le ferait `show_app`, et
  `delete_app` en supprime une. Voir une application ne donne pas accès à ses données : une application ouverte
  lit et écrit via les outils ci-dessus, sous l'identité de quiconque l'ouvre, sous
  sa propre RLS. Les applications résident dans `rebase.saved_apps`, que le backend crée
  la première fois qu'un outil l'utilise et qu'il n'accorde à aucun utilisateur final.
  Le panneau d'administration ouvre les mêmes applications : ajoutez `savedAppsView` depuis
  `@rebasepro/cms` à vos `views`. Il exécute une application dans une iframe isolée
  sans `allow-same-origin` et sans accès réseau propre, et relaie ses
  appels d'outils vers `POST /api/admin/apps/mcp`, les mêmes outils pour la session du
  panneau d'administration, qui est montée avec les routes d'administration que
  `REBASE_MCP_ENABLED` soit défini ou non. Les noms et formats des outils sont encore susceptibles de changer.
- **Les autorisations accordées avant la version 0.24 conservent leur portée.** `mcp:read` est interprété comme
  `data:read`, et `mcp:write` comme `data:write data:delete`, sur les autorisations stockées et
  sur les jetons déjà émis.
- **Une clé d'API fonctionne également.** `/mcp` accepte aussi `Authorization: Bearer rk_…`, pour
  un client configuré avec un en-tête plutôt qu'un flux OAuth. La clé accède
  aux outils couverts par ses scopes `data:*`, selon l'identité au nom de laquelle elle agit : une
  [clé personnelle](/docs/backend/api-keys/#personal-keys) en tant que son propriétaire, une clé de service
  en tant que `api-key:<id>`.
- **Le vocabulaire du SDK, les réponses de REST.** Les outils acceptent les mêmes paramètres que le SDK —
  `where` (`{"status": ["==", "paid"]}`), `orderBy` (`["created_at", "desc"]` ou
  `"created_at:desc"`), `limit`, `offset`, `searchString`, et `data` pour une
  écriture — et lisent via le chemin de `GET /api/data/<table>`, de sorte qu'une ligne soit renvoyée
  telle que REST la sert (dates ISO, un `belongsTo` sous forme de sa clé étrangère, par ex.
  `authorId`) et puisse être renvoyée telle quelle lors d'une mise à jour. `query_table`
  répond `{ data, meta }` avec `meta.total` et `meta.hasMore`, et `count_rows`
  répond `{ count }` ; `tools/list` fournit les deux, `aggregate_rows` et `get_row`
  un `outputSchema`, plus souple là où la réponse varie. `aggregate_rows` correspond à `GET /api/data/<table>/aggregate` :
  `select` est une liste selon la grammaire de REST (`["count()", "sum(total)"]`), `groupBy`
  une liste de champs, et il renvoie `{ data }` avec une ligne par groupe, plus
  `meta.hasMore` lors d'un appel groupé, dont les groupes se paginent avec `limit` et `offset`
  et se trient avec `orderBy`. Sur une table qu'un hook `afterRead` réécrit, il
  sert uniquement `count()`, tout comme REST. Comme avec REST, une `limit` supérieure à 1000, un argument non déclaré ainsi qu'une
  modification ou suppression d'une ligne mise à la corbeille (404) sont refusés ; redéfinir le champ de
  suppression réversible (soft-delete) à `null` la restaure. `deleted: "only"` (ou `"include"`) sur
  `query_table`, `count_rows` et `aggregate_rows` lit la corbeille, tout comme le
  `?deleted=` de REST, afin qu'une ligne mise à la corbeille par `delete_row` puisse être retrouvée pour
  être restaurée. Sa description indique au modèle que la suppression n'est définitive que si
  la table ne possède pas de champ de soft-delete.
- **La liste nomme les tables ; `describe_table` fournit le schéma de l'une d'elles.**
  `list_tables` répond `{ tables: [{ name, description, kind? }] }` — sans libellé —
  et `describe_table { table }` fournit les schémas
  OpenAPI `row` (les colonnes servies à cet appelant) et `create` (celles accessibles en écriture)
  de cette table, sa `primaryKey`, les `relations` servies et la `rls` (le SQL brut étant
  masqué sans `schema:read`), plus `softDeleteField` lorsque les lignes vont dans une
  corbeille, ainsi que la présentation définie par les préférences UI de l'appelant : `title`, et
  par colonne `label`, `valueLabels`, `hidden`, `hiddenInForm`, `readOnly`. Ce qu'une
  connexion peut apprendre sur le schéma est déterminé par le même sérialiseur qu'utilise
  `GET /api/schema/tables`. Les descriptions des outils indiquent au modèle de
  décrire une table avant d'y écrire. La liste d'un projet de 200 tables représente
  environ 5 000 tokens, et chaque description
  moins de 1 000 ; avec l'intégralité des schémas dans la liste, cela représentait environ 150 000 tokens.
- **Un jeton réservé à ce point de terminaison.** Un jeton d'accès MCP est refusé par
  `/api/data`, `/api/admin` et le WebSocket, de sorte que connecter un assistant ne
  lui confère pas une session complète.

Chaque requête vers `/mcp` relit le compte de l'utilisateur. Un compte supprimé ou désactivé,
ou une action de « déconnexion de tous les appareils » ou un changement de mot de passe postérieur à
l'émission du jeton, interrompt immédiatement un client connecté avec une erreur 401. Une rétrogradation de rôle s'applique dès son
prochain appel d'outil. Chaque rafraîchissement effectue les mêmes vérifications et révoque définitivement
une telle autorisation. Une session invité ne peut en aucun cas donner son consentement.

Une seule limite : déconnecter un client (`DELETE /api/oauth/grants/:clientId`, avec la
propre session de l'utilisateur) révoque immédiatement ses jetons de rafraîchissement, mais un jeton d'accès
déjà émis continue de fonctionner jusqu'à son expiration, dans la limite d'une heure.

## Skills

Le point de terminaison peut également servir des [Agent Skills](https://agentskills.io/specification)
via MCP : des instructions qu'un assistant charge lorsque la tâche l'exige, comme la façon dont
votre équipe enregistre une commande ou la signification d'un champ. Placez chaque skill dans son propre
dossier, avec un fichier `SKILL.md` dont le frontmatter contient un `name` correspondant au dossier
et une `description`, ainsi que tous les fichiers auxquels il est lié. Indiquez ensuite le dossier parent
dans la configuration du backend :

```ts
// skills/order-intake/SKILL.md, skills/order-intake/references/fields.md, …
createRebaseBackend({
    ...options, // the rest of your backend config
    mcp: { skills: "./skills" }
});
```

Le chemin est relatif au répertoire de travail. Les outils de données restent inchangés,
et `skills` prend place aux côtés de `tools` lorsqu'un backend apporte les siens.

- **Ce que voit un client.** Les clients utilisant la révision 2026-07-28 ou ultérieure du protocole
  (Claude Code, Claude) listent les skills et en chargent une lorsqu'elle est pertinente.
  Claude Code nomme chacune d'elles `<connector>:<skill>`. Elles sont servies via
  l'extension de skills de MCP (`io.modelcontextprotocol/skills`) : `skills/list`,
  `skills/get`, et `resources/read` de `skill://<name>/…`. Chaque skill est accompagnée
  d'un manifeste SHA-256 de ses fichiers. Le client vérifie chaque fichier par rapport à
  ce manifeste, et l'approbation de l'utilisateur y est liée.
- **Qui peut les lire.** Toute connexion authentifiée, quels que soient ses scopes.
  Ne mettez rien dans une skill qui ne soit pas destiné à toutes les personnes qui s'y connectent.
- **Quand elles changent.** Le dossier est lu lors de la première requête qui le nécessite,
  de sorte qu'une modification prenne effet au prochain déploiement ou redémarrage. Un fichier modifié sur
  le disque avant cette échéance est refusé et n'est pas servi par rapport à un manifeste auquel il ne
  correspond plus.
- **Ce qui est ignoré.** Une skill qui enfreint une règle est ignorée, et le journal de démarrage
  en explique la raison. Les règles : absence de frontmatter, un nom différent de celui de son dossier,
  un lien symbolique à l'intérieur, ou plus de 512 fichiers ou 16 Mio. Les fichiers masqués tels
  que `.gitkeep` ne sont jamais servis. Une skill dépassant les limites propres à Claude Code (100 Ko
  par fichier, 400 Ko au total) est servie avec un avertissement, car Claude Code ne la
  chargera pas.

Le point de terminaison prend en charge les deux époques du protocole. Un client de l'ère 2025 commence par
`initialize`, comme auparavant. Un client 2026-07-28 n'envoie aucun handshake. Chaque requête
transmet sa version de protocole et ses capacités dans `params._meta`, ainsi que les
en-têtes `MCP-Protocol-Version`, `Mcp-Method` et `Mcp-Name`, qui doivent concorder
avec le corps de la requête. Ses capacités proviennent de `server/discover`. Les skills sont
déclarées uniquement à cet endroit.

Les routes se trouvent dans [Points de terminaison](/docs/backend/endpoints/#mcp-surface) et les
variables dans [Configuration](/docs/getting-started/configuration/#mcp-surface).
