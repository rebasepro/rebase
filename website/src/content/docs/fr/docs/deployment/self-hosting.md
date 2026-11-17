---
sourceHash: 9b19d4a99031f19e
title: Auto-hébergement
sidebar_label: Auto-hébergement
description: Exécutez Rebase n'importe où avec l'image runtime officielle et le bundle de votre projet — Docker Compose, Fly, Railway ou un simple VPS.
---

## Vue d'ensemble

Auto-héberger Rebase implique d'exécuter deux choses : une base de données Postgres et l'image officielle `rebasepro/server` avec le bundle de votre projet monté à l'intérieur.

Il n'y a **aucune image applicative à construire**. Votre projet voyage sous forme de bundle, le runtime est publié, et la mise à niveau de Rebase consiste en un simple changement de tag plutôt qu'une reconstruction. Consultez [Runtime et bundles](/docs/architecture/runtime-and-bundles/) pour comprendre les raisons de cette séparation.

## Docker Compose

**Si votre projet provient de `rebase init`, utilisez son propre `docker-compose.yml`.**
Il se trouve dans votre dépôt, `init` y a renseigné ses secrets, son premier compte administrateur et sa version de runtime verrouillée, et c'est le fichier décrit par [Déploiement](/docs/getting-started/deployment/#docker-compose-recommended) :

```bash
rebase build
docker compose up -d
```

Le reste de cette page présente le même déploiement sans structure préexistante (scaffold) — le projet de quelqu'un d'autre, un bundle généré dans la CI, ou les deux éléments que le fichier généré omet délibérément : un pooler de connexions et les configurations en processus scindés. Ce fichier se trouve dans le dépôt, à l'adresse [`infra/docker/docker-compose.selfhost.yml`](https://github.com/rebasepro/rebase/blob/main/infra/docker/docker-compose.selfhost.yml). Utilisez-le plutôt que de copier un extrait de cette page : les deux fichiers sont démarrés par le portail de validation (acceptance gate) du projet à chaque push, aucun ne peut donc dériver de ce qui fonctionne réellement.

Les deux s'accordent sur chaque variable d'environnement à l'exception du mot de passe de la base de données, et ce parce que chacun est conçu pour son propre générateur : celui-ci lit `POSTGRES_PASSWORD`, généré par `quickstart.sh` ; le fichier généré lit `DATABASE_PASSWORD`, que `rebase init` intègre également dans l'`DATABASE_URL` qu'il écrit dans votre `.env`.

```bash
rebase build                    # produces ./dist-bundle
./infra/docker/quickstart.sh    # writes infra/docker/.env if absent, then brings it up
```

`quickstart.sh` est une commande unique effectuant deux actions évidentes et affichant les deux. La version détaillée, si vous préférez maîtriser chaque étape :

```bash
docker compose -f infra/docker/docker-compose.selfhost.yml \
  --env-file infra/docker/.env up
```

Vous n'avez pas besoin de démarrer la base de données séparément — `api` attend son healthcheck.

### Les six valeurs requises

`quickstart.sh` les génère pour vous. Pour écrire le fichier `.env` vous-même :

```bash
cat > infra/docker/.env <<EOF
POSTGRES_PASSWORD=$(openssl rand -hex 32)
JWT_SECRET=$(openssl rand -hex 32)
REBASE_SERVICE_KEY=$(openssl rand -hex 32)
CORS_ORIGINS=https://app.example.com
REBASE_ADMIN_EMAIL=you@example.com
REBASE_ADMIN_PASSWORD=$(openssl rand -hex 16)
EOF
```

Trois secrets, un fait, et le compte avec lequel vous vous connectez :

- **`POSTGRES_PASSWORD`** — le mot de passe de la base de données. Le modifier plus tard implique de le changer aussi dans le volume, choisissez-le donc une fois pour toutes.
- **`JWT_SECRET`** — signe chaque session. Le renouveler déconnecte tout le monde.
- **`REBASE_SERVICE_KEY`** — l'identifiant qui contourne la sécurité au niveau des lignes (row-level security / RLS) pour les appels de serveur à serveur. Traitez-le comme un mot de passe root : tout ce qui le détient peut lire chaque ligne.
- **`CORS_ORIGINS`** — les origines depuis lesquelles votre frontend est servi, séparées par des virgules. Pas un secret, et non optionnel : le runtime refuse de démarrer en production sans cette valeur plutôt que de deviner, car une API qui devine ses origines autorisées finit par autoriser la mauvaise.
- **`REBASE_ADMIN_EMAIL`** / **`REBASE_ADMIN_PASSWORD`** — le premier administrateur. Une base de données vierge n'a pas d'utilisateurs, et hors production, la politique d'inscription admet la première création de compte et la promeut administrateur — sinon, une base vide est une impasse, car amorcer un admin requiert un appelant déjà connecté. Dès que cette pile répond sur un nom d'hôte, cette commodité devient une course que l'opérateur peut perdre ; en production, cette fenêtre est donc fermée et le compte est désigné ici à la place. Le runtime le crée une seule fois, tant que la table des utilisateurs est vide, et ne fait rien à chaque démarrage ultérieur.

`JWT_SECRET` et `REBASE_SERVICE_KEY` doivent comporter au moins 32 caractères chacun, et le mot de passe administrateur au moins 12. Utilisez une adresse avec un point dans son domaine : `POST /auth/login` analyse son corps avec `z.string().email()`, le runtime refuse donc d'initialiser `admin@localhost` — un compte auquel personne ne pourrait se connecter — et consigne la raison dans les logs. Le fichier compose déclare les six variables avec `${VAR:?…}`, de sorte qu'une variable manquante interrompt la pile avec un message la désignant au lieu de démarrer un système à moitié configuré — et l'auto-inscription est désactivée par défaut (`DISABLE_SELF_REGISTRATION`, valeur par défaut `true`), évitant ainsi que quoi que ce soit ne reste ouvert à l'appropriation.

Connectez-vous avec ces identifiants et modifiez le mot de passe : ils sont stockés en clair dans un fichier sur l'hôte.

## Dépendances

`rebase build` **installe par défaut les dépendances de votre projet dans le bundle**, ainsi `dist-bundle` arrive avec un `node_modules` et un `package-lock.json` aux côtés de son `package.json`. Un bundle avec dépendances intégrées (vendored) démarre en cinq secondes environ.

Comme elles sont déjà présentes, vous pouvez monter le bundle en lecture seule — ce qui est vivement conseillé, car un hook compromis ne peut alors pas réécrire le code exécuté après le prochain redémarrage :

```yaml
    volumes:
      - ./dist-bundle:/bundle:ro
```

`rebase build --no-vendor` désactive ce comportement et produit un bundle qui installe ses dépendances au premier démarrage, ce qui prend 40 à 60 secondes par démarrage et nécessite que le montage soit accessible en écriture.

Pour un déploiement réel, préférez intégrer les deux dans une image, ce qui fige également avec précision ce qui s'exécute :

```dockerfile
FROM rebasepro/server:0.33.0
COPY dist-bundle /bundle
```

## Création du schéma

**Le runtime crée les tables manquantes au démarrage, y compris celles déclarées par `backend/schema`.**
`REBASE_MIGRATE_ON_BOOT` a pour valeur par défaut `ensure`, qui est additif sur l'ensemble du schéma : il crée les tables, colonnes et types enum manquants, et applique leur sécurité au niveau des lignes. Un premier démarrage sur une base de données vide se lance en servant vos tables, sans étape intermédiaire.

Ce que `ensure` ne fait délibérément jamais, c'est modifier ce qui existe déjà. Il ne modifie pas le type d'une colonne, ne supprime ni table ni colonne, et ne modifie pas les libellés d'un enum existant — car le redémarrage d'un conteneur ne doit pas pouvoir remodeler un schéma en tant qu'effet secondaire d'un déploiement.

Il reste donc utile d'exécuter `rebase db push` pour ce que le démarrage ignore — toute modification qui n'est pas purement additive : une colonne renommée, un type restreint, un champ supprimé.

```bash
rebase db push
```

Exécutez-le depuis une copie de travail locale ou un job CI, ciblant la base de données du déploiement. Il effectue d'abord une simulation à blanc (dry-run) des modifications, refuse les changements destructifs sans confirmation explicite, et peut créer une sauvegarde avant l'application. La base de données expose un port dans le fichier compose pour permettre cet accès depuis l'hôte ; supprimez ce mappage une fois le schéma en place si la base de données ne doit pas être accessible de l'extérieur.

`REBASE_MIGRATE_ON_BOOT` n'accepte que `ensure` et `none`, et rien d'autre — l'image **refuse de démarrer** avec `push`, pour la raison mentionnée ci-dessus.

## Lorsque seul votre processus de gestion des modifications peut modifier la base de données

`REBASE_MIGRATE_ON_BOOT=none` ne touche pas à vos tables. Il ne laisse pas pour autant la base de données intacte : les tables propres au framework (authentification, clés d'API, tâches, cron) sont toujours créées et maintenues à jour à chaque démarrage. Lorsque la base de données ne doit être modifiée qu'au moyen d'un processus de gestion des modifications validé, définissez `REBASE_PROVISION=false` sur chaque processus qui sert le trafic :

| Paramètre | Tables et politiques déclarées | Tables du framework |
|---|---|---|
| default (`REBASE_MIGRATE_ON_BOOT=ensure`) | créées et maintenues à jour au démarrage | créées et maintenues à jour |
| `REBASE_MIGRATE_ON_BOOT=none` | inchangées | créées et maintenues à jour |
| `REBASE_PROVISION=false` | inchangées | inchangées ; les éléments manquants sont listés dans les logs |

Lorsque le provisionnement est désactivé, le runtime ne crée ni ne modifie rien : aucune table, colonne, index, fonction, déclencheur, politique, rôle ou privilège (grant). Cela s'applique au démarrage comme par la suite, y compris pour les tables qu'un processus de service crée habituellement lors de la première utilisation (clés d'idempotence, revendications de tâches cron, compteurs de limitation de débit partagés). À la place, il lit ce qui est déjà présent :

- **Tables d'authentification manquantes, ou colonne requise par l'authentification manquante :** le démarrage est refusé et chacune d'entre elles est listée.
- **Le rôle de requête peut accéder à une table du framework** telle que `rebase.refresh_tokens` ou `rebase.api_keys` : le démarrage est refusé et affiche la commande `REVOKE` à exécuter. Un démarrage avec provisionnement révoque ces privilèges automatiquement. Lorsque le provisionnement est désactivé, rien ne le fait.
- **Une table optionnelle est manquante** (clés d'API, clés d'idempotence, revendications cron, compteurs de limitation de débit, présence, historique des métriques) : cette fonctionnalité est désactivée et le log indique quelle table est nécessaire.
- **Une table déclarée n'est pas protégée par la base de données** — sécurité au niveau des lignes désactivée, aucune des politiques déclarées n'est présente, ou une politique restrictive déclarée est manquante : cette table n'est pas servie (une politique permissive manquante est servie, avec un avertissement au démarrage qui la nomme). Une requête vers celle-ci renvoie `503 TABLE_WITHHELD`, et les logs de démarrage indiquent le SQL qui la protège (ou `rebase db push`). Les autres tables sont servies, et le démarrage continue. Une table de jonction plusieurs-à-plusieurs (many-to-many) est vérifiée de la même façon : si la base de données ne la protège pas, les tables dont les relations l'utilisent sont retenues, et `TABLE_WITHHELD` nomme la jonction. Une table dont la relation `via` passe par une table retenue est également retenue, et le message nomme la relation. Cela vaut également avec `REBASE_MIGRATE_ON_BOOT=none`, ainsi que lors d'un rafraîchissement de schéma à chaud. Une table dont l'accès est géré directement par l'application spécifie `rlsRequired: false` pour être tout de même servie ([instructions](/docs/deployment/existing-database/#another-tool-owns-the-schema-and-the-app-enforces-access)).

Les lignes continuent d'évoluer, comme sur n'importe quelle base de données : connexions, sessions, utilisation des clés d'API, clés d'idempotence, revendications cron. Le premier compte administrateur (`REBASE_ADMIN_EMAIL`) est initialisé par l'exécution de provisionnement, et non par les processus de service. [L'édition de schéma en direct](/docs/backend/live-schema-editing) peut toujours valider une modification dans le code source, mais refuse de l'appliquer à la base de données.

### L'exécution du provisionnement

Le schéma provient d'une exécution contrôlée par votre processus de gestion des modifications. Utilisez la même image et le même bundle que le serveur, avec `REBASE_PROVISION_ONLY=true`, connecté avec un rôle disposant des droits de création sur la base de données. `REBASE_PROVISION_SQL_OUT` conserve chaque modification de schéma effectuée lors de l'exécution, sous la forme d'un script SQL :

```bash
docker run --rm \
  -e DATABASE_URL="postgres://admin:…@scratch-db:5432/app" \
  -e JWT_SECRET="…" \
  -e CORS_ORIGINS="https://app.example.com" \
  -e REBASE_PROVISION_ONLY=true \
  -e REBASE_PROVISION_SQL_OUT=/out/rebase.sql \
  -v "$PWD/out:/out" \
  -v "$PWD/dist-bundle:/bundle" \
  "rebasepro/server:$REBASE_VERSION"
```

L'image s'exécute avec `NODE_ENV=production`, cette exécution est donc soumise aux mêmes vérifications d'environnement que le serveur, y compris `CORS_ORIGINS` ou `FRONTEND_URL`, bien qu'elle ne serve aucun trafic.

Le script est un enregistrement d'exécution, pas un plan : chaque instruction qu'il contient a été exécutée, dans l'ordre, et avec succès. Enregistré sur une base de données vide, il représente l'intégralité du schéma requis par la version. Enregistré sur une copie restaurée de la production, il constitue exactement la mise à niveau. Les lignes écrites lors de l'exécution n'y figurent pas. Examinez-le, puis appliquez-le à la base de données réelle :

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f out/rebase.sql
```

Répétez cette opération pour chaque mise à niveau de Rebase, avant le déploiement progressif des processus de service. Une version peut ajouter une table ou une colonne, et un processus qui n'a pas le droit d'en créer une la signalera comme manquante au lieu de la créer.

Un serveur que vous construisez vous-même suit la même règle : `initializeRebaseBackend` lit `REBASE_PROVISION`, et `createRebaseBackend` accepte [`provision: false`](/docs/backend/custom-server#what-creating-a-backend-may-change-provision).

## Stockage de fichiers

Le stockage est **désactivé** tant qu'aucun bucket n'est configuré, et c'est délibéré : l'autre option par défaut serait le système de fichiers du conteneur, qui perdrait silencieusement chaque fichier téléversé au redémarrage suivant. Les téléversements sont refusés avec `501 STORAGE_NOT_CONFIGURED` jusqu'à ce que vous en configuriez un.

Pour un bucket, définissez `STORAGE_TYPE=s3` (ou `gcs`) ainsi que son bucket et ses identifiants — le fichier compose liste ces variables sous forme de commentaires. `gcs` charge `@google-cloud/storage`, qui n'est pas fourni dans l'image officielle ; sur cette image, accédez donc plutôt à Google Cloud Storage via son point de terminaison compatible S3 (`STORAGE_TYPE=s3`, `S3_ENDPOINT=https://storage.googleapis.com`, clés HMAC).

Pour un disque local, ce qui n'est approprié que si le chemin correspond à un volume réel qui survit au conteneur :

```yaml
      STORAGE_TYPE: local
      # Each declared bucket gets a directory beside this one, bucket("media")
      # /storage/uploads__media, so the volume goes on their parent.
      STORAGE_PATH: /storage/uploads
      FORCE_LOCAL_STORAGE: "true"
    volumes:
      - storage:/storage
```

`FORCE_LOCAL_STORAGE` n'est pas optionnel dans ce cas : en production, un backend `local` est rejeté plutôt qu'enregistré, car l'alternative consisterait à accepter des téléversements dans un système de fichiers sur le point d'être détruit. Cette variable est votre façon d'indiquer que le montage est persistant.

Montez le volume **au-dessus** de `STORAGE_PATH`, et non directement dessus. `STORAGE_PATH` est le répertoire du bucket par défaut, et chaque bucket déclaré dans `backend/resources.ts` obtient le sien à côté, `<STORAGE_PATH>__<key>`. Un volume monté sur `STORAGE_PATH` lui-même ne conserve que le bucket par défaut. Tous les autres buckets écrivent dans le système de fichiers du conteneur et perdent leurs fichiers lors de la recréation du conteneur. `STORAGE_PATH__MEDIA` permet de déplacer un bucket ailleurs sur le volume. Il ne peut pas être déplacé à l'intérieur du répertoire d'un autre bucket, tel que `/storage/uploads/media`, car le bucket par défaut listerait, servirait et supprimerait alors ses fichiers.

L'image crée `/storage` pour l'utilisateur non privilégié `node` sous lequel elle s'exécute, c'est pourquoi le volume doit s'y trouver. Un volume monté à un endroit où l'image n'a pas de répertoire appartiendra à root, et chaque téléversement échouera avec `EACCES`. Le fichier compose écrit par `rebase init` le monte de cette manière.

### Le stockage requiert un modèle de contrôle d'accès

Dès qu'un bucket **est** configuré, le runtime **refuse de démarrer en production** tant que le déploiement n'a pas précisé comment les objets sont protégés. Le stockage n'est pas soumis à la sécurité au niveau des lignes et ses clés partagent un espace de noms plat ; sans règle, la seule chose qui sépare les fichiers de deux utilisateurs est l'impossibilité de deviner la clé — ce que `GET /storage/list?prefix=` rend caduc. L'une quelconque de ces options permet de satisfaire cette exigence :

- un **hook `storageAuthorize`** (ou `storagePolicies`) dans la configuration de votre projet, ce qui constitue la vraie solution et correspond à ce que fournit la structure initiale dans `backend/storage.ts` — aucune variable d'environnement ne peut exprimer « cet utilisateur a le droit de lire cette clé » ;
- **`STORAGE_PUBLIC_READ=true`**, pour un bucket qui sert réellement de CDN public en lecture seule ;
- **`STORAGE_ALLOW_ANY_AUTHENTICATED=true`**, pour une application mono-locataire (single-tenant) où chaque compte connecté a accès à l'ensemble des fichiers.

Hors production, cette même condition déclenche un avertissement explicite plutôt qu'un refus de démarrer ; c'est donc un échec au démarrage que vous rencontrerez lors du déploiement plutôt que sur votre machine de développement. C'est délibéré : le problème qu'il remplace est silencieux.

Définissez également `MFA_ENCRYPTION_KEY` si vous utilisez TOTP. Sans cela, les secrets d'authentification stockés sont chiffrés avec `JWT_SECRET` — ainsi, renouveler ce dernier déconnecterait tout le monde *et* rendrait impossible le déchiffrement de chaque appareil enregistré.

## Autres plateformes

Le runtime est un conteneur ordinaire écoutant sur `$PORT`, de sorte que tout environnement capable d'exécuter des conteneurs fonctionne. Deux points essentiels à respecter partout :

1. Le bundle doit être présent dans `/bundle` (ou là où pointe `REBASE_BUNDLE`), avec ses dépendances installées à ses côtés — voir [Dépendances](#dépendances).
2. Définissez `CORS_ORIGINS`, `JWT_SECRET` et `DATABASE_URL`. Le runtime refuse de démarrer en production sans ces variables plutôt que d'essayer de les deviner.

### Fly.io

```toml
[build]
  dockerfile = "Dockerfile"   # FROM rebasepro/server:0.33.0 + COPY dist-bundle /bundle

[http_service]
  internal_port = 8080

[[http_service.checks]]
  path = "/livez"
```

Utilisez le format d'image dérivée ci-dessus afin que le bundle soit livré avec l'application, puis lancez `fly deploy`.

### Railway / Render

Pointez le service vers l'image dérivée, définissez les variables d'environnement et configurez le chemin du health check sur `/livez`.

### Un simple VPS

```bash
npm install -g @rebasepro/server @rebasepro/server-postgres
rebase-server /srv/myapp/dist-bundle
```

`rebase-server --help` liste les variables qu'il lit. Sous systemd :

```ini title="/etc/systemd/system/rebase.service"
[Service]
ExecStart=/usr/bin/rebase-server /srv/myapp/dist-bundle
Restart=always
Environment=NODE_ENV=production
Environment=DATABASE_URL=postgresql://rebase:...@127.0.0.1:5432/rebase
Environment=ALLOW_LOCALHOST_IN_PRODUCTION=true
Environment=JWT_SECRET=...
Environment=REBASE_SERVICE_KEY=...
Environment=CORS_ORIGINS=https://app.example.com
Environment=DISABLE_SELF_REGISTRATION=true
Environment=REBASE_ADMIN_EMAIL=you@example.com
Environment=REBASE_ADMIN_PASSWORD=...
```

`NODE_ENV=production` n'est pas là pour faire joli. S'il n'est pas défini, le processus s'exécute en mode développement : il accepte les origines localhost, sert la spécification OpenAPI et **laisse la fenêtre du premier admin ouverte** — ainsi, le premier inconnu à trouver le formulaire d'inscription devient administrateur. Les deux lignes `REBASE_ADMIN_*` sont ce qui remplace cette fenêtre ; consultez [Votre premier administrateur](/docs/getting-started/deployment/#your-first-admin).

`ALLOW_LOCALHOST_IN_PRODUCTION=true` est présent car la base de données se trouve sur la même machine. En production, le runtime refuse toute variable pointant vers localhost — dans un conteneur, le loopback désigne le conteneur lui-même, cette adresse est donc systématiquement une erreur — et cette ligne lui indique que cette adresse est intentionnelle. Supprimez-la lorsque la base de données s'exécute ailleurs.

Privilégiez `EnvironmentFile=/etc/rebase.env` avec des permissions de fichier en mode 0600 plutôt que des lignes `Environment=` pour les secrets : un fichier d'unité (unit file) est lisible par tous, et `systemctl show` affiche chaque valeur `Environment=`.

## Pool de connexions

Le runtime maintient un petit pool de connexions à longue durée de vie et n'a pas besoin de pooler. En revanche, tout le reste communiquant avec la même base de données et incapable de maintenir une connexion en a besoin : une fonction serverless, un script planifié, un outil de BI, un worker de file d'attente qui monte à cinquante instances. Le paramètre `max_connections` de Postgres est une limite stricte se situant dans les bas centaines et chaque connexion est un *processus*, de sorte qu'une montée en charge de fonctions serverless l'épuise bien avant que la base de données ne soit saturée.

Le fichier compose inclut un service `pgbouncer` pour ce trafic, associé à un profil afin qu'un déploiement sans ces types d'appelants n'exécute pas un processus inutile :

```bash
docker compose --profile pooler up -d
```

```
postgres://rebase:$POSTGRES_PASSWORD@your-host:6432/rebase
```

```bash
PGBOUNCER_PORT=6432           # host port
PGBOUNCER_MAX_CLIENT_CONN=500 # client connections accepted
PGBOUNCER_POOL_SIZE=20        # server connections used to serve them
```

L'authentification client est générée à partir de `DATABASE_URL` au démarrage, de sorte que le mot de passe n'est pas renseigné deux fois. Le pooler s'authentifie auprès de Postgres avec `scram-sha-256`, pris en charge par Postgres 18 — la valeur par défaut `md5` de l'image fait échouer la connexion au *serveur* avec `FATAL: server login failed: wrong password type`, ce qui ressemble à un mauvais mot de passe alors qu'il n'en est rien.

Veillez à ce que la somme des `PGBOUNCER_POOL_SIZE` sur l'ensemble des poolers reste nettement inférieure au `max_connections` de la base de données — le runtime puise dans le même quota.

### Ce que change le pooling de transactions

Un client utilisant le pool conserve une connexion serveur pendant la durée d'une transaction puis la restitue, ce qui permet à 500 clients de partager 20 connexions. Trois éléments cessent de fonctionner via ce port, et chacun d'eux est utilisé par Rebase lui-même — c'est précisément pourquoi le runtime se connecte directement et que ce port est réservé aux autres appelants :

- **`LISTEN`/`NOTIFY`.** Le temps réel repose dessus, et un listener requiert une connexion qui survit à une transaction. `LISTEN` est *accepté* à travers le pooler — il renvoie `LISTEN`, puis aucune notification n'arrive jamais.
- **Session state** : `SET` (par opposition à `SET LOCAL`), verrous consultatifs (advisory locks) maintenus entre les instructions, curseurs `WITH HOLD`, tables temporaires. La transaction suivante peut atterrir sur une connexion serveur différente, qui ne verra rien de tout cela. Ces deux cas échouent de la même façon trompeuse : avec un seul client inactif, l'état persiste généralement, donc cela fonctionne pendant vos tests et cesse de fonctionner sous la concurrence pour laquelle vous avez introduit le pooler.
- **Protocol-level prepared statements.** On peut indiquer à la plupart des pilotes de ne pas les utiliser — node-postgres ne le fait pas par défaut ; asyncpg nécessite `statement_cache_size=0`.

`SET LOCAL` a une portée limitée à la transaction et fonctionne, or c'est ce qui est utilisé pour configurer la sécurité au niveau des lignes — RLS se comporte donc de manière identique à travers le port poolé.

Laissez le profil désactivé si rien en dehors du runtime ne se connecte à votre base de données. Un port inutilisé constitue une surface d'attaque supplémentaire.

## Vérifications de santé (Health checks)

| Chemin | Utilisation |
| --- | --- |
| `/livez` | Liveness. Répond « ce processus est-il vivant » sans interroger la base de données. |
| `/health` | Readiness. Effectue un aller-retour vers la base de données et rapporte la latence. |

Pointez les sondes de liveness vers `/livez`. Une sonde de liveness sur `/health` redémarrerait un processus parfaitement sain lors d'une brève saute d'humeur de la base de données, ce qui est l'opposé de son rôle.

## Métriques

```bash
REBASE_METRICS=true
REBASE_METRICS_TOKEN=<random string>
```

Expose les métriques Prometheus sur `/metrics` : nombre de requêtes et histogrammes de latence ventilés par surface d'API (données, auth, stockage, fonctions) et par table, ainsi que des jauges de processus. Sans jeton, le point de terminaison est accessible en lecture par toute personne pouvant joindre le port ; définissez-en donc un, à moins qu'il ne se trouve sur un réseau privé.

`rebase_db_pool_wait_ms` est un histogramme de la durée pendant laquelle chaque requête a attendu une connexion du pool de base de données, y compris l'ouverture d'une connexion, étiqueté par clé de source de données (`source="(default)"` dans un projet qui ne déclare aucune source de données). Un pool sain le maintient proche de zéro. Une traîne qui s'allonge avec le trafic signifie que les requêtes font la queue pour obtenir des connexions — le plus souvent retenues par des hooks d'écriture qui attendent une opération lente ; voir [Un hook retient une connexion](/docs/collections/context-data-api/#a-hook-holds-a-connection).

La base de données elle-même, par source de données :

| Métrique | Description |
|--------|--------------|
| `rebase_db_pool_connections`, `rebase_db_pool_idle`, `rebase_db_pool_waiting` | Les connexions de chaque pool, étiquetées `pool="primary"`, `"read"` (le réplica) ou `"session"` (le pool direct de la console SQL derrière un pooler). Un `waiting` supérieur à zéro de façon prolongée indique un pool sous-dimensionné pour sa charge. |
| `rebase_db_connection_errors_total` | Les requêtes ayant répondu 503 faute de connexion, par `code` : `53300` / `53400` (le serveur n'a plus de connexions), `pool_exhausted`, `connect_timeout`, `unreachable`. |
| `rebase_db_connections` | Connexions clientes sur le serveur, par `state`, par rapport à `rebase_db_max_connections`. |
| `rebase_db_size_bytes` | La taille de la base de données. |
| `rebase_db_replica_lag_seconds` | Le retard de `DATABASE_READ_URL` par rapport au nœud primaire. |

Les quatre dernières sont échantillonnées toutes les 30 secondes sur la propre connexion de l'instance, de sorte qu'un scrape ne se transforme jamais en requête.

`rebase_realtime_*` rapporte les sockets ouverts, les canaux de chaque instance et les trames envoyées au bus de canaux ou retenues : voir [Observer l'activité du bus](/docs/backend/realtime-transports/#seeing-what-the-bus-does).

## En-têtes de sécurité

Chaque réponse comporte `X-Frame-Options: SAMEORIGIN`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin` et `Strict-Transport-Security: max-age=15552000` (180 jours). L'en-tête HSTS omet `includeSubDomains` : cela demanderait aux navigateurs de refuser le HTTP standard sur tous les sous-domaines de votre domaine, y compris ceux avec lesquels ce serveur n'a aucun lien, et un navigateur conserve cette consigne aussi longtemps que l'indique l'en-tête.
Définissez `REBASE_HSTS_INCLUDE_SUBDOMAINS=true` lorsque l'ensemble des sous-domaines est exclusivement en HTTPS.

`strict-origin-when-cross-origin` est le comportement par défaut des navigateurs : une requête vers un autre site transmet votre origine et jamais le chemin ou la chaîne de requête (query) de la page. Ce n'est pas `no-referrer` car les vérifications d'origine ont besoin de cette origine — le bouton de connexion Google la compare avec les origines JavaScript autorisées du client OAuth, et sous `no-referrer`, il renvoyait « The given origin is not allowed for the given client ID » sur chaque application, quelle que soit la configuration du client. Une réponse qui définit sa propre politique la conserve (la page de consentement MCP envoie `no-referrer`) ; une page nécessitant une politique plus stricte peut l'indiquer avec `<meta name="referrer" content="no-referrer">`. `X-Frame-Options` fonctionne de la même manière : `SAMEORIGIN` sauf si la réponse définit la sienne, comme le fait la page de consentement MCP avec `DENY`.

Les applications statiques — l'administration du CMS et tout frontend servi par le bundle — comportent également `Content-Security-Policy: frame-ancestors 'self'; object-src 'none'; base-uri 'self'`. Cela définit qui peut intégrer l'application dans une frame, exclut les plugins et verrouille `<base>` sur votre origine, sans restreindre rien d'autre, de sorte que les scripts inline, les workers et les connexions tierces continuent de fonctionner. Une réponse qui définit sa propre politique la conserve. Pour toute restriction plus sévère, appliquez la politique sur le reverse proxy en amont.

### Autoriser une autre origine à intégrer une application dans une frame

`frame-ancestors 'self'` signifie que seule une page provenant de la propre origine de l'application peut l'intégrer dans une iframe. Un CMS sur `admin.example.com` prévisualisant le site sur `www.example.com` nécessite que le site l'autorise, à l'aide de `frameAncestors` sur l'application du site dans `rebase.json` :

```jsonc
"site": {
  "type": "static", "root": "site", "output": "site/dist", "path": "https://www.example.com",
  "frameAncestors": ["https://admin.example.com"]
}
```

Le site est alors servi avec `frame-ancestors 'self' https://admin.example.com`, tout comme n'importe quelle [route](/docs/architecture/apps-and-repositories/#serving-a-function-at-a-path-on-an-app) du site dont la fonction n'envoie pas sa propre politique. Les autres applications conservent `'self'`. `X-Frame-Options: SAMEORIGIN` est toujours envoyé en parallèle ; un navigateur prenant en charge `frame-ancestors` ignore `X-Frame-Options`, comme l'exige la spécification CSP.

Chaque entrée correspond à une origine, écrite exactement : `https://` avec un nom d'hôte et un port facultatif, ou `http://` pour `localhost`, `127.0.0.1` et `[::1]` pendant le développement. Il n'y a aucun caractère générique (wildcard), aucun chemin et aucun mot-clé — `'self'` fait toujours partie de la liste, et tout autre format est refusé par la CLI puis à nouveau par le runtime avant d'atteindre l'en-tête. Rien n'est autorisé à moins d'être explicitement nommé.

## Plusieurs instances

Un conteneur unique constitue la configuration par défaut et ne nécessite rien de plus. Avant qu'un second réplica ne reçoive du trafic — ou qu'un déploiement progressif (rolling deploy) n'en exécute deux côte à côte — consultez [Exécuter plusieurs instances](/docs/deployment/multiple-instances/) : la limitation de débit, les canaux de diffusion (broadcast channels), les fichiers locaux, les téléversements avec reprise et le cache d'images sont propres à chaque processus tant qu'un paramètre ne les mutualise pas.

## Connecter Claude

Une seule commande ajoute ce serveur au [connecteur Rebase](/docs/ai/rebase-connector/), le connecteur MCP unique qui accède à tous vos projets depuis Claude :

```bash
rebase cloud connect https://your-app.com
```

Définissez les deux variables qu'il affiche sur ce serveur et redémarrez-le. Le serveur doit exécuter Rebase 0.28.1 ou une version ultérieure et répondre en https sur une adresse publique. Rien d'autre ne change : il ne détient aucun secret, et il accorde au connecteur les mêmes accès que Studio.

## Exécuter des fonctions dans leur propre processus

Tout ce qui précède correspond à un conteneur unique servant l'intégralité du projet, ce qui est la configuration adaptée à presque tous les déploiements. Lorsqu'une fonction personnalisée ne doit plus entrer en concurrence avec l'API de données pour la boucle d'événements (event loop) — ou doit pouvoir évoluer à l'échelle (scaler), redémarrer et échouer de manière autonome —, la même image et le même bundle peuvent être démarrés sous forme de plusieurs processus coopératifs. Voir [Processus scindés](/docs/deployment/split-processes/).

## Mise à niveau

```yaml
image: rebasepro/server:0.33.0
```

Redémarrez. Votre bundle reste inchangé. Au sein d'une version majeure du contrat de runtime, un bundle qui a été validé continue de fonctionner — voir [Compatibilité](/docs/architecture/runtime-and-bundles/#compatibility).
