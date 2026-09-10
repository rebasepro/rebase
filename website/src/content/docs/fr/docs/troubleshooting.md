---
sourceHash: 1030bf24935489a6
slug: fr/docs/troubleshooting
title: Dépannage
description: Les pannes qui empêchent un backend Rebase de démarrer ou de répondre — base de données inaccessible, identifiants incorrects, extension manquante, refus RLS, dérive de schéma, port occupé, fonction qui ne se charge pas — et à quoi ressemble chacune d'entre elles.
---

Les erreurs qui empêchent un backend Rebase de démarrer ou de répondre, à quoi
ressemble concrètement chacune d'elles à l'écran, et comment y remédier.

Le démarrage échoue de manière explicite et totale. Si la base de données est
inaccessible, que les identifiants sont incorrects ou que le schéma de collection
ne peut pas être appliqué, `initializeRebaseBackend` lève une exception, rien n'est
servi et le processus se termine avec le code `1`. Il n'y a pas de mode dégradé :
un serveur qui démarre en répondant à la connexion alors que chaque route
`/api/data/*` échoue est plus difficile à diagnostiquer qu'un serveur qui ne démarre
jamais.

Le premier endroit où regarder est donc toujours la dernière ligne du journal
avant l'arrêt.

## Lire une erreur de démarrage

Chaque erreur de base de données que vous voyez est une enveloppe. Drizzle relaie
les échecs de requête sous la forme `Failed query: …` avec une trace de pile
(stack trace) traversant ses propres mécanismes internes, et la phrase expliquant
le problème se trouve en dessous, dans `.cause` — ou dans une `AggregateError`
lorsqu'un hôte double pile (dual-stack) a tenté plusieurs adresses.

Le runtime la déballe pour vous. Un échec de démarrage consigne dans les journaux :

- un **diagnostic encadré** indiquant l'hôte, le port et le correctif, et
- des lignes `caused by:` portant la chaîne d'erreurs, se terminant par la raison
  fournie par le système d'exploitation ou Postgres.

Si vous lisez des journaux au format JSON (`NODE_ENV=production`), la même chaîne
se trouve sous `error.cause`, avec `code`, `address` et `port` sur chaque maillon.

### `Failed query: [redacted]`

Il ne s'agit pas d'une ligne de journal tronquée. Drizzle construit chaque échec de
requête sous la forme `Failed query: <sql>` suivi des valeurs liées, de sorte que
l'instruction et ses paramètres — une adresse e-mail, un hash de mot de passe —
accompagnent le message et la pile de tout ce que le pilote relaie. Le logger
supprime cette portion de chaque ligne qu'il écrit et affiche `[redacted]` à sa
place.

L'instruction SQL est de toute façon rarement la réponse : la cause se trouve
dans les lignes `caused by:` en dessous. Si vous en avez réellement besoin,
définissez `REBASE_LOG_RAW_QUERIES=true` en développement et le SQL sera affiché
à la place. Cette variable est ignorée en dehors de l'environnement de développement,
de sorte qu'une variable qui fuiterait en production ne pourra rien dé-masquer.

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

Ou exécutez `rebase dev` sans aucun `DATABASE_URL`, ce qui démarrera automatiquement
une base de données PGlite gérée, sans nécessiter d'installation préalable.

Si l'hôte et le port affichés dans l'encadré ne sont pas ceux attendus, le
`DATABASE_URL` présent dans `.env` n'est pas celui lu par le processus — vérifiez
la présence d'un second fichier `.env`, d'une variable d'environnement déjà
exportée dans votre shell, ou d'un conteneur démarré avant vos modifications.

## Le mot de passe ou le nom de la base de données est incorrect

```
  ❌  Authentication failed for user "app" at db.internal:5432
  The driver said: password authentication failed for user "app" (28P01)
```

`28P01` correspond à un mot de passe incorrect, `28000` à un rôle non autorisé
à se connecter depuis cet emplacement, et `3D000` à une base de données inexistante.
Ces trois cas sont des faits établis concernant la chaîne de connexion : réessayer
produira le même résultat, c'est pourquoi le démarrage échoue immédiatement au
lieu de signaler un pool susceptible de « récupérer ».

Vérifiez les identifiants dans `DATABASE_URL`. Un mot de passe contenant `@`, `/`,
`?` ou `#` doit être encodé en pourcent (percent-encoded) — un caractère non encodé
altère silencieusement l'URL et l'hôte auquel vous finissez par vous connecter
ne correspondra pas à celui que vous avez spécifié.

## `type "vector" does not exist`

pgvector est une extension serveur, Rebase ne l'installe donc que si le projet
l'y autorise explicitement. Déclarez-la dans `config/resources.ts` :

```ts
database({ extensions: ["vector"] })
```

La base de données doit également utiliser une image incluant la bibliothèque.
C'est le cas de `pgvector/pgvector:pg18` fournie dans le scaffold ; une image
standard `postgres:18` ne l'inclut pas. Si l'installation elle-même est refusée
(`extension "vector" is not available` ou une erreur de permissions), la configuration
est correcte et ce qui manque est soit la bibliothèque sur le serveur, soit un
rôle autorisé à exécuter `CREATE EXTENSION vector;`.

## La base de données a refusé l'instruction

```
DB_PERMISSION_DENIED — Permission denied by the database on "notes"
(row-level security). Check the RLS policies for this table.
```

SQLSTATE `42501`. Deux problèmes distincts peuvent survenir sous ce code, et le
message les différencie :

- **Une stratégie de sécurité au niveau des lignes (RLS) a refusé la ligne.**
  Le système de contrôle d'accès fonctionne ; l'appelant a demandé une action que
  ses règles n'autorisent pas. Vérifiez les `securityRules` de la collection, et
  exécutez `npx @rebasepro/rls-check` pour effectuer un audit en lecture seule
  de ce que la base de données appliquera réellement.
- **Le rôle ne dispose pas des privilèges nécessaires (`GRANT`).** Rien dans la
  requête ne pourra corriger cela — le rôle de connexion ne peut pas du tout
  accéder à la table. Il s'agit d'un problème de déploiement.

Une lecture exclue par RLS n'est pas considérée comme une erreur : les lignes
sont filtrées et vous obtenez une page vide. Si une collection apparaît vide pour
un utilisateur connecté qui devrait voir des lignes, c'est la stratégie RLS qu'il
faut examiner, et non la requête.

## `SCHEMA_DRIFT` — une table ou une colonne n'existe pas

```
SCHEMA_DRIFT — Schema drift: table "posts" does not exist.
```

Le code et la base de données ne concordent pas. En développement :

```bash
rebase db push        # apply the collections to the database
rebase doctor         # the full three-way drift report
```

Sur un environnement Cloud managé, `db push` ne peut pas joindre la base de
données — le runtime applique le schéma au démarrage à la place, effectuez donc
un redéploiement plutôt qu'un push.

Si une table existe mais qu'une colonne manque, la cause habituelle est un
fichier de collection modifié sans regénération : exécutez `rebase schema generate`
puis poussez à nouveau.

## Le port est déjà utilisé

```
Port 3001 is in use — trying 3002.
```

Le mode dev se lie au prochain port disponible et vous en informe. Ce message a
son importance car tout le reste — le `VITE_API_URL` de votre frontend, un favori,
un appel `curl` — pointe toujours vers l'ancien port. La cause la plus fréquente
est une instance précédente de `rebase dev` qui occupe toujours le socket.

Passez `--port` pour en fixer un, ou arrêtez l'autre processus. En production,
il n'y a pas de nouvelle tentative : le port configuré est le port imposé, et
`EADDRINUSE` est fatal.

## Le backend a planté et `rebase dev` a continué de tourner

Un backend qui lève une erreur au démarrage n'arrête pas le watcher — il affiche
la pile d'exécution et attend une modification de fichier. `rebase dev` indique ceci :

```
  ✗ The backend crashed on startup.
    Fix the error above; the watcher restarts it on the next change.
```

L'erreur située au-dessus est la véritable cause. Les origines les plus courantes
sont une erreur de syntaxe dans un fichier de collection, un import introuvable
ou un `DATABASE_URL` qui ne pointe vers rien.

## Une fonction personnalisée n'est pas servie

Les fonctions sont chargées depuis `backend/functions` au démarrage, et un fichier
dont le chargement échoue est **ignoré sans être fatal** — le serveur démarre sans
lui. Le symptôme est donc une erreur 404 sur une route que vous venez d'écrire,
et l'explication se trouve deux lignes plus haut dans les journaux de démarrage :

```
❌ [functions] Failed to load orders.ts: Cannot find module './util'
⚠️ [functions] 1 function file(s) were skipped and will NOT be served:
  - orders.ts (threw: Cannot find module './util')
```

Les causes habituelles : une dépendance importée mais absente de `package.json`,
un import relatif auquel il manque l'extension (`./util` au lieu de `./util.js` —
le projet étant en ESM, l'extension est obligatoire), et un fichier qui exporte
autre chose qu'une application Hono. Utilisez `defineFunction(...)` depuis
`@rebasepro/server/functions` pour détecter ce dernier cas sous la forme d'une
erreur de compilation — utilisez ce sous-chemin et non la racine du paquet, afin
que la fonction reste portable.

Les sous-répertoires ne sont pas analysés. `functions/admin/users.ts` est signalé
comme une entrée ignorée au lieu d'être servi.

Une fois le serveur opérationnel, une fonction qui lève une exception lors d'une
requête renvoie l'enveloppe d'erreur JSON et consigne la raison dans les journaux ;
une fonction qui ne répond jamais est interrompue à `REBASE_FUNCTIONS_TIMEOUT_MS`
et renvoie `504 FUNCTION_TIMEOUT`.

## Est-il opérationnel ? `/livez` et `/health`

| Chemin | Interroge la base de données | Réponse |
| --- | --- | --- |
| `/livez` | Non | `200 {"status":"ok"}` tant que le processus est en cours d'exécution. À utiliser pour une sonde de vivacité (liveness probe). |
| `/health` | Oui, chaque source de données | `200 {"status":"ok"}` lorsque chaque source de données configurée répond ; `503 {"status":"degraded"}` si l'une d'elles échoue. À utiliser pour une sonde de préparation (readiness probe). |

Ne placez pas de sonde de vivacité sur `/health` : un micro-incident de base de
données pousserait l'orchestrateur à tuer un processus pourtant sain, transformant
une brève indisponibilité en une boucle de redémarrage (restart loop).

`/health` ne nécessite pas d'authentification ; en dehors de l'environnement de
développement, il publie donc uniquement le verdict et la source de données
dégradée, rien d'autre. Le texte d'erreur propre au pilote — qui mentionne l'hôte,
le port, le nom de la base de données et le rôle — est envoyé dans les journaux.

## Erreurs après le démarrage

Chaque échec de l'API renvoie la même enveloppe et comporte un `code`. La
[référence des codes d'erreur](/docs/backend/errors/) les répertorie tous, avec
le statut associé et la solution.

## Pour aller plus loin

- [Codes d'erreur](/docs/backend/errors/) — chaque `code` que l'API peut renvoyer, avec le statut et la solution.
- [Environnement et configuration](/docs/getting-started/configuration/) — toutes les variables lues par le runtime, et celles sans lesquelles la production refuse de démarrer.
- [Vue d'ensemble du backend](/docs/backend/) — ce que fait le démarrage, dans l'ordre, et quelle sonde répond à quelle question.

---
