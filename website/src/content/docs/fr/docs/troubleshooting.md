---
sourceHash: ff162864c3d1600b
slug: fr/docs/troubleshooting
title: Dépannage
description: Les erreurs qui empêchent un backend Rebase de démarrer ou de répondre — base de données inaccessible, mauvais identifiants, extension manquante, refus RLS, dérive de schéma, port occupé, fonction qui ne se charge pas — et à quoi ressemble chacune d'entre elles.
---

Les erreurs qui empêchent un backend Rebase de démarrer ou de répondre, à quoi
ressemble concrètement chacune d'entre elles à l'écran, et comment les résoudre.

Le démarrage échoue de manière flagrante et totale. Si la base de données est inaccessible,
si les identifiants sont incorrects, ou si le schéma ne peut être compilé ou appliqué,
`initializeRebaseBackend` lève une exception, rien n'est servi et le processus se termine avec le code `1`.
Il n'y a pas de mode dégradé : un serveur qui démarre en répondant aux connexions alors que chaque
route `/api/data/*` échoue est plus difficile à diagnostiquer qu'un serveur qui ne démarre jamais.

Le premier endroit où regarder est donc toujours la dernière ligne du journal avant la fermeture.

## Lire une erreur de démarrage

Chaque erreur de base de données que vous voyez est une enveloppe. Drizzle relance les échecs de requête sous
la forme `Failed query: …` avec une trace de pile traversant ses propres mécanismes internes, et la phrase
expliquant le problème se trouve en dessous, dans `.cause` — ou à l'intérieur d'une `AggregateError`
lorsqu'un hôte double pile (dual-stack) a essayé plusieurs adresses.

Le runtime la déballe pour vous. Un échec de démarrage journalise :

- un **diagnostic encadré** indiquant l'hôte, le port et la solution, et
- des lignes `caused by:` portant la chaîne d'erreurs, se terminant par la raison
  fournie par le système d'exploitation ou Postgres.

Si vous lisez des journaux JSON (`NODE_ENV=production`), la même chaîne se trouve sous
`error.cause`, avec `code`, `address` et `port` sur chaque maillon.

### `Failed query: [redacted]`

Il ne s'agit pas d'une ligne de journal tronquée. Drizzle construit chaque échec de requête sous
la forme `Failed query: <sql>` suivi des valeurs liées, de sorte que l'instruction et ses
paramètres — une adresse e-mail, un hash de mot de passe — accompagnent le message et
la pile de tout ce que le pilote renvoie. Le système de journalisation supprime cette portion de
chaque ligne qu'il écrit et affiche `[redacted]` à la place.

L'instruction SQL est d'ailleurs rarement la réponse : la raison se trouve dans les lignes `caused by:`
en dessous. Si vous en avez réellement besoin, définissez `REBASE_LOG_RAW_QUERIES=true` en
développement et le SQL sera affiché à la place. Cette option est ignorée en dehors du développement,
de sorte qu'une variable qui fuiterait dans un environnement de production ne puisse rien
démasquer.

## La base de données n'est pas lancée

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  ❌  Cannot connect to PostgreSQL at 127.0.0.1:5432
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  The driver said: connect ECONNREFUSED 127.0.0.1:5432 (ECONNREFUSED)
```

Rien n'écoute sur cette adresse. Démarrez la base de données :

```bash
docker compose up -d db       # the service a Rebase scaffold ships
brew services start postgresql@18
```

Ou lancez `rebase dev` sans aucun `DATABASE_URL`, ce qui démarrera pour vous une base de données PGlite
gérée ne nécessitant aucune installation.

Si l'hôte et le port dans l'encadré ne sont pas ceux attendus, la variable `DATABASE_URL` dans
`.env` n'est pas celle que le processus a lue — vérifiez la présence d'un second fichier `.env`, d'une
variable de shell déjà exportée, ou d'un conteneur démarré avant votre modification.

## Le mot de passe ou le nom de la base de données est incorrect

```
  ❌  Authentication failed for user "app" at db.internal:5432
  The driver said: password authentication failed for user "app" (28P01)
```

`28P01` correspond à un mot de passe incorrect, `28000` à un rôle qui ne peut pas se connecter depuis cet emplacement, et
`3D000` à une base de données inexistante. Tous trois sont des faits avérés concernant la
chaîne de connexion : réessayer produira la même réponse, le démarrage échoue donc immédiatement
plutôt que de signaler un pool qui « pourrait récupérer ».

Vérifiez les identifiants dans `DATABASE_URL`. Un mot de passe contenant `@`, `/`, `?` ou
`#` doit être encodé en pourcent (percent-encoded) — un caractère non encodé reformate silencieusement l'URL et
l'hôte auquel vous finirez par vous connecter ne sera pas celui que vous avez saisi.

## `SchemaDefinitionError` — le schéma ne compile pas

<span class="since-badge" data-since="0.31">Depuis 0.31</span>

Le démarrage, `rebase db generate`, `db push`, `generate-sdk` et `doctor` compilent les
tables exportées par `backend/schema/index.ts` avant toute chose, et s'arrêtent dès qu'une
table ne compile pas — absence de `rls`, `"inherit"` sans `defaultRls`, une relation vers une table que
l'index n'exporte pas, un `defineTable` dans un fichier frère omis par l'index — en nommant chaque
table, clé et problème d'un coup. Corrigez chacun d'eux ; `rebase verify` affiche la même liste
sans rien démarrer.

## `config/collections` est refusé

<span class="since-badge" data-since="0.31">Depuis 0.31</span>

Un projet antérieur à la version 0.31 conserve son modèle de données dans `config/collections`, que
plus rien ne lit : le runtime, chaque commande CLI et un bundle au format 2 sont
refusés avec `rebase migrate collections-to-tables` dans le message. Exécutez-la
sur un arbre git propre ; elle réécrit le projet sous `backend/schema` et
`frontend/src/cms`, vérifie que le SQL généré est inchangé et affiche les étapes
qu'il vous reste à effectuer. Voir [Mise à niveau de 0.30 vers 0.31](https://rebase.pro/docs/upgrading/0-30-to-0-31/).

## `type "vector" does not exist`

pgvector est une extension serveur, Rebase ne l'installe donc que là où un projet l'autorise
explicitement. Déclarez-la dans `backend/resources.ts` :

```ts
database({ extensions: ["vector"] })
```

La base de données a également besoin d'une image incluant la bibliothèque. L'image
`pgvector/pgvector:pg18` du scaffold le fait ; une image standard `postgres:18` ne le fait pas. Si l'installation
elle-même est refusée (`extension "vector" is not available`, ou une erreur de permission),
la configuration est déjà correcte et ce qui manque est la bibliothèque sur le serveur
ou un rôle autorisé à exécuter `CREATE EXTENSION vector;`.

## La base de données a refusé l'instruction

<span class="since-badge" data-since="0.31">Depuis 0.31</span>

```
DB_PERMISSION_DENIED — Permission denied by the database on "notes"
(row-level security). Check the RLS policies for this table.
```

SQLSTATE `42501`. Deux problèmes différents surviennent sous ce code, et le message
les distingue :

- **Une stratégie de sécurité au niveau des lignes (RLS) a refusé la ligne** — le message ci-dessus. Le
  système de contrôle d'accès fonctionne ; l'appelant a demandé quelque chose que ses
  politiques ne permettent pas. Vérifiez le `rls` de la table dans `backend/schema`, et exécutez
  `npx @rebasepro/rls-check` pour un audit en lecture seule de ce que la base de données
  appliquera réellement.
- **Le rôle manque d'un `GRANT`.** Le message nomme alors l'objet à la place :

  ```
  DB_PERMISSION_DENIED — Permission denied by the database: the role this request
  runs as has no privilege on schema "rebase". That is a missing GRANT to that
  role, not a row-level security policy.
  ```

  Rien dans la requête ne pourra aider — le rôle sous lequel s'exécutent les requêtes ne peut pas
  du tout toucher à cet objet. Le serveur accorde les droits à son rôle de requête sur les schémas
  qu'il provisionne, au démarrage ; un objet créé en dehors (par un autre rôle, ou dans un
  schéma qu'aucune table ne déclare) a besoin de son propre `GRANT`. Il s'agit d'un
  problème de déploiement.

Une lecture exclue par la RLS n'est pas une erreur : les lignes sont filtrées et vous obtenez
une page vide. Si une table apparaît vide pour un utilisateur connecté qui devrait voir
des lignes, c'est la politique qu'il faut examiner, pas la requête.

## `SCHEMA_DRIFT` — une table ou une colonne n'existe pas

```
SCHEMA_DRIFT — Schema drift: table "posts" does not exist.
```

Le code et la base de données ne concordent pas. En développement :

```bash
rebase db push        # apply the tables to the database
rebase doctor         # the full three-way drift report
```

Sur un tenant Cloud géré, `db push` ne peut pas joindre la base de données — le runtime
applique le schéma au démarrage à la place, redéployez donc plutôt que de pousser.

Si une table existe mais qu'une colonne manque, la cause habituelle est un fichier de table
qui a été modifié sans régénération : exécutez `rebase schema generate` et poussez
à nouveau.

## `Error: EOF` lors d'un `db push` sur la base de données gérée

```
Error: EOF
✗ atlas schema apply --to file://.rebase/sql/schema.sql --dry-run failed.
```

La base de données de développement gérée accepte un nombre limité de connexions simultanées, et
une instance en cours de `rebase dev` en monopolise certaines. Atlas, qui planifie le push, en ouvre deux
supplémentaires, et l'une d'elles a été fermée inopinément. Rien n'a été appliqué, la commande peut donc
être réexécutée en toute sécurité ; le serveur de développement ferme les connexions inactives après 30 secondes. Si
l'échec persiste, arrêtez `rebase dev` pendant que vous poussez.

Le push ferme ses
propres connexions avant le démarrage d'Atlas, ce qui laisse généralement de la place pour Atlas,
et l'erreur indique ce qui s'est passé.

## Le port est déjà utilisé

```
Port 3001 is in use — trying 3002.
```

L'environnement de développement se lie au prochain port libre et le signale. Ce message est important car tout
le reste — le `VITE_API_URL` de votre frontend, un favori, une commande `curl` — pointe toujours vers l'ancien.
La cause habituelle est une instance précédente de `rebase dev` occupant toujours
le socket.

Passez `--port` pour en fixer un, ou arrêtez l'autre processus. En production, il n'y a pas
de nouvelle tentative : le port configuré est le port utilisé, et `EADDRINUSE` est fatal.

## Le backend a planté et `rebase dev` a continué de tourner

<span class="since-badge" data-since="0.31">Depuis 0.31</span>

Un backend qui lève une exception au démarrage n'arrête pas le watcher — il affiche la trace de pile et
attend une modification de fichier. Lorsque le backend ne s'est pas annoncé dans le délai de
`REBASE_DEV_READY_TIMEOUT_MS` (30 secondes par défaut), `rebase dev` signale ceci :

```
  ✗ The backend has not started after 30s.
    Fix the error above; the watcher restarts it on the next change.
```

L'erreur affichée au-dessus est la véritable cause. Les origines les plus courantes sont une erreur de syntaxe dans
un fichier de `backend/schema`, un import non résolu ou une variable `DATABASE_URL` qui
pointe vers le vide.

## Une fonction personnalisée n'est pas servie

Les fonctions sont chargées depuis `backend/functions` au démarrage, et un fichier qui échoue
à se charger est **ignoré, non fatal** — le serveur démarre sans lui. Le symptôme est donc
une 404 sur une route que vous venez d'écrire, et l'explication se trouve deux lignes plus haut dans
le journal de démarrage :

```
❌ [functions] Failed to load orders.ts: Cannot find module './util'
⚠️ [functions] 1 function file(s) were skipped and will NOT be served:
  - orders.ts (threw: Cannot find module './util')
```

Les causes habituelles : une dépendance importée mais absente de `package.json`, un
import relatif auquel il manque son extension (`./util` au lieu de `./util.js` — le projet étant en
ESM, l'extension est obligatoire), et un fichier qui exporte autre chose qu'une
application Hono. Développez avec `defineFunction(...)` depuis `@rebasepro/server/functions`
pour obtenir plutôt une erreur de compilation dans ce dernier cas — via ce sous-chemin, et non la racine
du paquet, afin que la fonction reste portable.

Les sous-répertoires ne sont pas analysés. `functions/admin/users.ts` est signalé comme une
entrée ignorée plutôt que d'être servi.

Une fois le serveur opérationnel, une fonction qui lève une exception lors d'une requête renvoie l'enveloppe
d'erreur JSON et consigne la raison dans les journaux ; une fonction qui ne répond jamais est interrompue après
`REBASE_FUNCTIONS_TIMEOUT_MS` et répond `504 FUNCTION_TIMEOUT`.

## Est-il opérationnel ? `/livez` et `/health`

| Chemin | Touche à la base de données | Répond |
| --- | --- | --- |
| `/livez` | Non | `200 {"status":"ok"}` tant que le processus tourne. À utiliser pour une sonde de vivacité (liveness probe). |
| `/health` | Oui, chaque source de données | `200 {"status":"ok"}` lorsque chaque source de données configurée répond ; `503 {"status":"degraded"}` quand l'une d'elles ne répond pas. À utiliser pour une sonde d'état de préparation (readiness probe). |

Ne placez pas de sonde de vivacité sur `/health` : une brève instabilité de la base de données
pousserait l'orchestrateur à tuer un processus pourtant sain, transformant une courte panne en
boucle de redémarrages.

`/health` n'est pas authentifié, donc hors développement, il publie uniquement le verdict et
la source de données dégradée, et rien d'autre. Le texte d'erreur propre au pilote —
qui mentionne l'hôte, le port, le nom de la base de données et le rôle — est consigné dans les journaux.

## Erreurs après le démarrage

Chaque échec de l'API répond avec la même enveloppe et contient un `code`. La
[référence des codes d'erreur](/docs/backend/errors/) les répertorie tous avec leur statut
et la solution associée.

## Pour aller plus loin

- [Codes d'erreur](/docs/backend/errors/) — chaque `code` que l'API peut renvoyer, avec son statut et la solution associée.
- [Environnement et configuration](/docs/getting-started/configuration/) — chaque variable lue par le runtime, et celles sans lesquelles la production refuse de démarrer.
- [Vue d'ensemble du backend](/docs/backend/) — ce que fait le démarrage, dans l'ordre, et quelle sonde répond à quelle question.
