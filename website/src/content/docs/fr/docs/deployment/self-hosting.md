---
sourceHash: cfc9a95285da2353
title: Auto-hébergement
sidebar_label: Auto-hébergement
description: Exécutez Rebase n'importe où avec l'image runtime officielle et le bundle de votre projet — Docker Compose, Fly, Railway ou un simple VPS.
---

## Aperçu

Auto-héberger Rebase implique d'exécuter deux choses : une base de données Postgres et l'image officielle `rebasepro/server` avec le bundle de votre projet monté à l'intérieur.

Il n'y a **aucune image applicative à construire**. Votre projet voyage sous forme de bundle, le runtime est publié, et la mise à niveau de Rebase consiste en un simple changement de tag plutôt qu'une reconstruction. Consultez [Runtime and bundles](/docs/architecture/runtime-and-bundles/) pour comprendre pourquoi il est découpé ainsi.

## Docker Compose

**Si votre projet a été créé à partir de `rebase init`, utilisez son propre `docker-compose.yml`.**
Il se trouve dans votre dépôt, `init` a renseigné ses secrets, son premier compte administrateur et sa version de runtime épinglée, et c'est le fichier décrit dans [Deployment](/docs/getting-started/deployment/#docker-compose-recommended) :

```bash
rebase build
docker compose up -d
```

Le reste de cette page présente le même déploiement sans projet généré (scaffold) derrière — le projet de quelqu'un d'autre, un bundle compilé en CI, ou les deux éléments que le fichier généré omet délibérément : un pooler de connexions et les configurations en processus scindés (split-process). Celui-ci se trouve dans le dépôt, sous [`infra/docker/docker-compose.selfhost.yml`](https://github.com/rebasepro/rebase/blob/main/infra/docker/docker-compose.selfhost.yml). Utilisez-le plutôt que de copier un extrait de cette page : les deux fichiers sont démarrés par la porte d'acceptation du projet à chaque push, de sorte qu'aucun ne peut dévier de ce qui fonctionne réellement.

Les deux concordent sur chaque variable d'environnement à l'exception du mot de passe de la base de données, et c'est parce que chacun est écrit pour son propre générateur : celui-ci lit `POSTGRES_PASSWORD`, que `quickstart.sh` génère ; celui généré lit `DATABASE_PASSWORD`, que `rebase init` intègre également dans la `DATABASE_URL` qu'il écrit dans votre `.env`.

```bash
rebase build                    # produces ./dist-bundle
./infra/docker/quickstart.sh    # writes infra/docker/.env if absent, then brings it up
```

`quickstart.sh` est une commande unique effectuant deux opérations évidentes et affichant les deux. La version détaillée, si vous préférez maîtriser chaque étape :

```bash
docker compose -f infra/docker/docker-compose.selfhost.yml \
  --env-file infra/docker/.env up
```

Vous n'avez pas besoin de démarrer la base de données séparément — `api` attend son healthcheck.

### Les six valeurs nécessaires

`quickstart.sh` les génère pour vous. Pour écrire le `.env` vous-même :

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

Trois secrets, une information factuelle et le compte avec lequel vous vous connectez :

- **`POSTGRES_PASSWORD`** — le mot de passe de la base de données. Le modifier plus tard implique également de le changer dans le volume, alors choisissez-le une bonne fois pour toutes.
- **`JWT_SECRET`** — signe chaque session. Le faire pivoter déconnecte tout le monde.
- **`REBASE_SERVICE_KEY`** — l'identifiant qui contourne la sécurité au niveau des lignes (row-level security / RLS) pour les appels de serveur à serveur. Traitez-le comme un mot de passe root : quiconque le détient peut lire chaque ligne.
- **`CORS_ORIGINS`** — les origines depuis lesquelles votre frontend est servi, séparées par des virgules. Ce n'est pas un secret, et ce n'est pas facultatif : le runtime refuse de démarrer en production sans cela au lieu de deviner, car une API qui devine ses origines autorisées finit par autoriser la mauvaise.
- **`REBASE_ADMIN_EMAIL`** / **`REBASE_ADMIN_PASSWORD`** — le premier administrateur. Une base de données vierge n'a pas d'utilisateurs, et hors production la politique d'inscription accepte la première inscription et la promeut administrateur — sinon une base vide est une impasse, car amorcer un administrateur nécessite un appelant déjà connecté. Dès lors que cette stack répond sur un nom d'hôte, cette commodité devient une course que l'opérateur peut perdre ; en production, cette fenêtre est donc fermée et le compte est désigné ici à la place. Le runtime le crée une seule fois, tant que la table des utilisateurs est vide, et ne fait rien à chaque démarrage ultérieur.

`JWT_SECRET` et `REBASE_SERVICE_KEY` doivent comporter chacun au moins 32 caractères, et le mot de passe administrateur au moins 12. Utilisez une adresse comportant un point dans son domaine : `POST /auth/login` analyse son corps avec `z.string().email()`, le runtime refuse donc d'initialiser `admin@localhost` — un compte auquel personne ne pourrait se connecter — et consigne la raison dans les logs. Le fichier compose déclare les six variables avec `${VAR:?…}`, de sorte qu'une variable manquante arrête la stack avec un message la nommant plutôt que de démarrer un système à moitié configuré — et l'auto-inscription est désactivée par défaut (`DISABLE_SELF_REGISTRATION`, valeur par défaut `true`), évitant ainsi que quoi que ce soit ne puisse être revendiqué.

Connectez-vous avec ces identifiants et modifiez le mot de passe : ils figurent en clair dans un fichier sur l'hôte.

## Dépendances

`rebase build` **installe par défaut les dépendances de votre projet dans le bundle**, de sorte que `dist-bundle` est généré avec un répertoire `node_modules` et un `package-lock.json` aux côtés de son `package.json`. Un bundle avec dépendances intégrées (vendored) démarre en environ cinq secondes.

Comme elles sont déjà présentes, vous pouvez monter le bundle en lecture seule — ce qui est vivement recommandé, car un hook compromis ne pourra alors pas réécrire le code exécuté après le prochain redémarrage :

```yaml
    volumes:
      - ./dist-bundle:/bundle:ro
```

`rebase build --no-vendor` désactive ce comportement et produit un bundle qui installe plutôt ses dépendances au premier démarrage, ce qui prend 40 à 60 secondes par démarrage et nécessite un montage accessible en écriture.

Pour un déploiement réel, préférez intégrer les deux directement dans une image, ce qui fige également avec exactitude ce qui est exécuté :

```dockerfile
FROM rebasepro/server:0.30.1
COPY dist-bundle /bundle
```

## Création du schéma

<span class="since-badge" data-since="0.31">Depuis 0.31</span>

**Le runtime crée les tables manquantes au démarrage, y compris celles déclarées par `backend/schema`.**
`REBASE_MIGRATE_ON_BOOT` est défini par défaut sur `ensure`, ce qui est purement additif sur l'ensemble du schéma : il crée les tables, colonnes et types enum manquants, et applique leur sécurité au niveau des lignes (RLS). Un premier démarrage sur une base de données vide se termine en servant vos tables, sans étape distincte.

Ce que `ensure` ne fait délibérément jamais, c'est modifier ce qui existe déjà. Il ne modifie pas le type d'une colonne, ne supprime ni table ni colonne, et ne modifie pas les libellés d'un enum existant — car le redémarrage d'un conteneur ne doit pas pouvoir remodeler un schéma en tant qu'effet secondaire d'un déploiement.

Il reste donc utile d'exécuter `rebase db push` pour ce que le démarrage ignore — toute modification qui n'est pas purement additive : une colonne renommée, un type restreint, un champ supprimé.

```bash
rebase db push
```

Exécutez-le depuis une copie locale du code ou un job de CI, pointé vers la base de données du déploiement. Il effectue d'abord une simulation (dry-run) des modifications, refuse les opérations destructives sans confirmation explicite, et peut réaliser une sauvegarde avant d'appliquer. La base de données expose un port dans le fichier compose afin que cette commande puisse l'atteindre depuis l'hôte ; supprimez ce mappage une fois le schéma en place si la base de données ne doit pas être accessible de l'extérieur.

`REBASE_MIGRATE_ON_BOOT` accepte `ensure` et `none`, et rien d'autre — l'image **refuse de démarrer** avec `push`, pour la raison mentionnée ci-dessus.

## Quand seul votre processus de gestion des changements peut modifier la base de données

`REBASE_MIGRATE_ON_BOOT=none` ne touche pas à vos tables. Il ne laisse pas la base de données intacte pour autant : les tables propres au framework (authentification, clés d'API, jobs, cron) sont toujours créées et maintenues à jour à chaque démarrage. Lorsque la base de données ne doit être modifiée que via un processus de changement revu et validé, définissez `REBASE_PROVISION=false` sur chaque processus qui sert du trafic :

| Paramètre | Tables et politiques déclarées | Tables du framework |
|---|---|---|
| par défaut (`REBASE_MIGRATE_ON_BOOT=ensure`) | créées et maintenues à jour au démarrage | créées et maintenues à jour |
| `REBASE_MIGRATE_ON_BOOT=none` | laissées intactes | créées et maintenues à jour |
| `REBASE_PROVISION=false` | laissées intactes | laissées intactes ; tout élément manquant est indiqué dans les logs |

Lorsque le provisioning est désactivé, le runtime ne crée et ne modifie rien : aucune table, colonne, index, fonction, trigger, politique, rôle ou privilège (grant). Cela vaut au démarrage et par la suite, y compris pour les tables qu'un processus traitant les requêtes crée normalement à la première utilisation (clés d'idempotence, réservations de cron, compteurs partagés de limitation de débit). À la place, il lit ce qui est présent :

- **Tables d'authentification manquantes, ou colonne lue par l'authentification manquante :** le démarrage est refusé et chacune d'elles est listée.
- **Le rôle des requêtes peut accéder à une table du framework** telle que `rebase.refresh_tokens` ou `rebase.api_keys` : le démarrage est refusé et affiche la commande `REVOKE` à exécuter. Un démarrage avec provisioning retire ces privilèges de lui-même. Lorsque le provisioning est désactivé, rien ne le fait.
- **Une table optionnelle est manquante** (clés d'API, clés d'idempotence, réservations de cron, compteurs de limitation de débit, présence, historique des métriques) : cette fonctionnalité est désactivée, et les logs indiquent quelle table est requise.
- <span class="since-badge" data-since="0.31">Depuis 0.31</span> **Une table déclarée que la base de données ne protège pas** — sécurité au niveau des lignes (RLS) désactivée, aucune des politiques déclarées n'est présente, ou une politique restrictive déclarée est manquante : cette table n'est pas servie (une politique permissive manquante est servie, avec un avertissement au démarrage qui la nomme). Une requête la ciblant répond `503 TABLE_WITHHELD`, et les logs de démarrage indiquent le SQL qui la protège (ou suggèrent `rebase db push`). Les autres tables sont servies et le démarrage continue. Une table de jonction many-to-many est vérifiée de la même manière : une jonction non protégée par la base de données bloque la mise à disposition des tables dont les relations l'utilisent, et `TABLE_WITHHELD` nomme la jonction. Une table dont la relation `via` transite par une table retenue est également retenue, et le message mentionne la relation. Cela s'applique également avec `REBASE_MIGRATE_ON_BOOT=none` ainsi que lors d'un rafraîchissement à chaud du schéma.

Les lignes continuent d'évoluer, comme sur n'importe quelle base de données : connexions, sessions, utilisation des clés d'API, clés d'idempotence, réservations de cron. Le premier compte administrateur (`REBASE_ADMIN_EMAIL`) est initialisé par l'exécution du provisioning, non par les processus servant le trafic. L'[édition de schéma en direct](/docs/backend/live-schema-editing) peut toujours valider (commit) une modification dans le code source, mais refuse de l'appliquer à la base de données.

### L'exécution du provisioning

Le schéma provient d'une exécution contrôlée par votre processus de gestion des changements. Utilisez la même image et le même bundle que le serveur, avec `REBASE_PROVISION_ONLY=true`, connecté avec un rôle disposant des droits de création dans la base de données. `REBASE_PROVISION_SQL_OUT` conserve chaque modification de schéma effectuée lors de cette exécution sous la forme d'un script SQL :

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

L'image s'exécute avec `NODE_ENV=production`, de sorte que cette exécution est soumise aux mêmes vérifications d'environnement que le serveur, `CORS_ORIGINS` ou `FRONTEND_URL` inclus, même si elle ne dessert aucun trafic.

Le script est un enregistrement de ce qui a eu lieu, pas un plan prévisionnel : chaque instruction qu'il contient a été exécutée, dans l'ordre, et avec succès. Enregistré sur une base de données vide, il constitue l'intégralité du schéma requis par la version. Enregistré sur une copie restaurée de la production, il représente exactement la mise à niveau. Les lignes écrites lors de l'exécution n'y figurent pas. Examinez-le, puis appliquez-le à la véritable base de données :

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f out/rebase.sql
```

Répétez l'opération à chaque mise à niveau de Rebase, avant le déploiement progressif (rolling deploy) des processus servant le trafic. Une nouvelle version peut ajouter une table ou une colonne, et un processus qui n'a pas l'autorisation d'en créer une la signalera comme manquante au lieu de la créer.

Un serveur que vous construisez vous-même suit la même règle : `initializeRebaseBackend` lit `REBASE_PROVISION`, et `createRebaseBackend` accepte [`provision: false`](/docs/backend/custom-server#what-creating-a-backend-may-change-provision).

## Stockage de fichiers

Le stockage est **désactivé** tant qu'aucun bucket n'est configuré, et c'est délibéré : l'autre valeur par défaut serait le système de fichiers du conteneur, qui perdrait silencieusement chaque fichier téléversé au redémarrage suivant. Les téléversements sont refusés avec `501 STORAGE_NOT_CONFIGURED` tant que vous n'en avez pas configuré un.

Pour un bucket, définissez `STORAGE_TYPE=s3` (ou `gcs`) ainsi que son bucket et ses identifiants — le fichier compose liste les variables en commentaires. `gcs` charge `@google-cloud/storage`, qui n'est pas fourni dans l'image officielle ; sur cette image, accédez donc plutôt à Google Cloud Storage via son endpoint compatible S3 (`STORAGE_TYPE=s3`, `S3_ENDPOINT=https://storage.googleapis.com`, clés HMAC).

Pour un disque local, ce qui ne convient que si le chemin correspond à un vrai volume persistant au-delà de la durée de vie du conteneur :

```yaml
      STORAGE_TYPE: local
      # Each declared bucket gets a directory beside this one, bucket("media")
      # /storage/uploads__media, so the volume goes on their parent.
      STORAGE_PATH: /storage/uploads
      FORCE_LOCAL_STORAGE: "true"
    volumes:
      - storage:/storage
```

`FORCE_LOCAL_STORAGE` n'est pas facultatif ici : en production, un backend `local` est rejeté plutôt qu'enregistré, car l'alternative consisterait à réussir des téléversements dans un système de fichiers sur le point d'être détruit. Cette variable permet de confirmer que le montage est bien persistant.

Montez le volume **au-dessus** de `STORAGE_PATH`, et non à son niveau direct. `STORAGE_PATH` est le répertoire du bucket par défaut, et chaque bucket déclaré dans `backend/resources.ts` dispose du sien à côté, `<STORAGE_PATH>__<key>`. Un volume monté directement sur `STORAGE_PATH` ne contient que le bucket par défaut. Tous les autres buckets écriront dans le système de fichiers du conteneur et perdront leurs fichiers lors de la recréation du conteneur. `STORAGE_PATH__MEDIA` peut déplacer un bucket ailleurs sur le volume. Il ne peut pas le déplacer dans le répertoire d'un autre bucket, tel que `/storage/uploads/media`, car le bucket par défaut listerait, servirait et supprimerait alors ses fichiers.

L'image crée `/storage` pour l'utilisateur non privilégié `node` sous lequel elle s'exécute, c'est pourquoi le volume se place à cet endroit. Un volume monté là où l'image n'a pas de répertoire appartient à root, et chaque téléversement échoue avec `EACCES`. Le fichier compose généré par `rebase init` le monte de cette manière.

### Le stockage nécessite un modèle de contrôle d'accès

Une fois qu'un bucket **est** configuré, le runtime **refuse de démarrer en production** tant que le déploiement ne précise pas comment les objets sont protégés. Le stockage n'est pas soumis à la sécurité au niveau des lignes (RLS) et ses clés partagent un espace de noms plat unique ; sans règle, la seule chose séparant les fichiers de deux utilisateurs est l'impossibilité de deviner les clés — ce que `GET /storage/list?prefix=` rend caduc. N'importe lequel de ces éléments satisfait cette exigence :

- un **hook `storageAuthorize`** (ou `storagePolicies`) dans la configuration de votre projet, ce qui constitue la vraie réponse et ce que le modèle initial fournit dans `backend/storage.ts` — aucune variable d'environnement ne peut exprimer « cet utilisateur peut lire cette clé » ;
- **`STORAGE_PUBLIC_READ=true`**, pour un bucket qui est véritablement un CDN public en lecture seule ;
- **`STORAGE_ALLOW_ANY_AUTHENTICATED=true`**, pour une application mono-tenant où chaque compte connecté a accès à tous les fichiers en toute confiance.

Hors production, la même condition déclenche un avertissement explicite plutôt qu'un refus, c'est donc un échec de démarrage que vous rencontrez lors du déploiement plutôt que sur votre machine locale. C'est délibéré : l'erreur qu'il remplace est silencieuse.

Définissez également `MFA_ENCRYPTION_KEY` si vous utilisez TOTP. Sans cela, les secrets d'authentification stockés sont chiffrés avec `JWT_SECRET` — ainsi, faire pivoter cette clé déconnecte tout le monde *et* rend impossible le déchiffrement de tous les appareils enregistrés.

## Autres plateformes

Le runtime est un conteneur standard écoutant sur `$PORT`, de sorte que tout ce qui exécute des conteneurs fonctionne. Deux points essentiels à respecter partout :

1. Le bundle doit être présent à l'emplacement `/bundle` (ou là où pointe `REBASE_BUNDLE`), avec ses dépendances installées à ses côtés — voir [Dependencies](#dépendances).
2. Définissez `CORS_ORIGINS`, `JWT_SECRET` et `DATABASE_URL`. Le runtime refuse de démarrer en production sans eux plutôt que de faire des suppositions.

### Fly.io

```toml
[build]
  dockerfile = "Dockerfile"   # FROM rebasepro/server:0.30.1 + COPY dist-bundle /bundle

[http_service]
  internal_port = 8080

[[http_service.checks]]
  path = "/livez"
```

Utilisez la méthode de l'image dérivée ci-dessus afin que le bundle soit livré avec l'application, puis exécutez `fly deploy`.

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

`NODE_ENV=production` n'est pas décoratif. S'il n'est pas défini, le processus s'exécute en mode développement : il renvoie les origines localhost, sert la spécification OpenAPI et **laisse la fenêtre du premier administrateur ouverte** — ainsi, le premier inconnu tombant sur le formulaire d'inscription devient administrateur. Les deux lignes `REBASE_ADMIN_*` remplacent cette fenêtre ; voir [Your first admin](/docs/getting-started/deployment/#your-first-admin).

`ALLOW_LOCALHOST_IN_PRODUCTION=true` est présent car la base de données se trouve sur la même machine. En production, le runtime refuse toute variable pointant vers localhost — dans un conteneur, le bouclage local (loopback) correspond au conteneur lui-même, cette adresse est donc systématiquement une erreur — et cette ligne lui indique que cette adresse est intentionnelle. Supprimez-la lorsque la base de données tourne ailleurs.

Préférez `EnvironmentFile=/etc/rebase.env` avec le fichier en mode 0600 plutôt que des lignes `Environment=` pour les secrets : un fichier d'unité est lisible par tous, et `systemctl show` affiche chaque valeur `Environment=`.

## Pooling de connexions

Le runtime gère un petit pool de connexions à longue durée de vie et n'a pas besoin de pooler. En revanche, tout le reste qui communique avec la même base de données et ne peut pas maintenir une connexion en a besoin : une fonction serverless, un script planifié, un outil de BI, un worker de file d'attente qui monte à cinquante instances. Le `max_connections` de Postgres est une limite stricte située dans les quelques centaines et chaque connexion est un *processus*, de sorte qu'un déploiement en éventail de lambdas (lambda fan-out) l'épuise bien avant que la base de données ne soit saturée.

Le fichier compose intègre un service `pgbouncer` pour ce trafic, derrière un profil afin qu'un déploiement sans de tels appelants n'exécute pas un processus inutile :

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

L'authentification client est générée à partir de `DATABASE_URL` au démarrage, de sorte que le mot de passe n'est pas saisi en double. Le pooler s'authentifie auprès de Postgres avec `scram-sha-256`, que Postgres 18 stocke — la valeur par défaut `md5` de l'image fait échouer la connexion du *serveur* avec `FATAL: server login failed: wrong password type`, ce qui ressemble à un mauvais mot de passe alors que ce n'est pas le cas.

Veillez à ce que la somme des `PGBOUNCER_POOL_SIZE` de tous les poolers reste nettement inférieure au `max_connections` de la base de données — le runtime puise dans le même quota.

### Ce que change le pooling de transactions

Un client passant par le pool conserve une connexion au serveur pendant la durée d'une transaction, puis la libère, ce qui permet à 500 clients de partager 20 connexions. Trois fonctionnalités cessent de fonctionner via ce port, et chacune d'entre elles est utilisée par Rebase lui-même — c'est précisément pourquoi le runtime se connecte directement et que ce port est réservé aux autres appelants :

- **`LISTEN`/`NOTIFY`.** Le temps réel (Realtime) repose dessus, et un écouteur a besoin d'une connexion qui persiste au-delà d'une transaction. `LISTEN` est *accepté* par le pooler — il répond `LISTEN`, puis aucune notification n'arrive jamais.
- **État de session** : `SET` (contrairement à `SET LOCAL`), les verrous consultatifs (advisory locks) conservés entre plusieurs requêtes, les curseurs `WITH HOLD`, les tables temporaires. La transaction suivante peut atterrir sur une connexion serveur différente, qui ne verra rien de tout cela. Ces deux cas échouent de la même façon trompeuse : avec un seul client inactif, l'état persiste généralement, cela fonctionne donc pendant vos tests et cesse de fonctionner sous la concurrence pour laquelle vous avez justement introduit le pooler.
- **Requêtes préparées au niveau du protocole (prepared statements).** La plupart des pilotes peuvent être configurés pour ne pas les utiliser — node-postgres ne le fait pas par défaut ; asyncpg requiert `statement_cache_size=0`.

`SET LOCAL` est limité à la transaction et fonctionne, or c'est ce qui est utilisé pour configurer la sécurité au niveau des lignes — RLS se comporte donc de manière identique à travers le port poolé.

Laissez le profil désactivé si rien en dehors du runtime ne se connecte à votre base de données. Un port inutilisé représente une surface d'attaque.

## Contrôles de santé (Health checks)

| Chemin | Utilisation |
| --- | --- |
| `/livez` | Liveness. Répond « ce processus est-il vivant » sans toucher à la base de données. |
| `/health` | Readiness. Effectue un aller-retour avec la base de données et rapporte la latence. |

Pointez les sondes de liveness vers `/livez`. Une sonde de liveness sur `/health` redémarre un processus parfaitement sain lors d'un bref hoquet de la base de données, ce qui est l'exact opposé de son rôle.

## Métriques

```bash
REBASE_METRICS=true
REBASE_METRICS_TOKEN=<random string>
```

Expose les métriques Prometheus sur `/metrics` : nombres de requêtes et histogrammes de latence ventilés par surface d'API (data, auth, storage, functions) et par table, ainsi que des jauges de processus. Sans jeton (token), le point de terminaison est accessible en lecture par toute personne pouvant joindre le port ; définissez-en donc un, sauf s'il se trouve sur un réseau privé.

`rebase_db_pool_wait_ms` est un histogramme du temps d'attente de chaque requête pour obtenir une connexion du pool de la base de données, ouverture d'une connexion incluse, étiqueté par clé de source de données (`source="(default)"` dans un projet qui ne déclare aucune source de données). Un pool sain le maintient proche de zéro. Une traîne qui s'allonge avec le trafic signifie que les requêtes font la queue pour obtenir des connexions — le plus souvent retenues par des hooks d'écriture qui attendent une opération lente ; voir [A hook holds a connection](/docs/collections/context-data-api/#a-hook-holds-a-connection).

La base de données elle-même, par source de données :

| Métrique | Ce qu'elle indique |
|--------|--------------|
| `rebase_db_pool_connections`, `rebase_db_pool_idle`, `rebase_db_pool_waiting` | Les connexions de chaque pool, étiquetées `pool="primary"`, `"read"` (le réplica) ou `"session"` (le pool direct de la console SQL derrière un pooler). Un `waiting` supérieur à zéro de manière prolongée indique un pool trop petit pour sa charge. |
| `rebase_db_connection_errors_total` | Les requêtes ayant répondu 503 faute de connexion, par `code` : `53300` / `53400` (le serveur n'a plus de connexions), `pool_exhausted`, `connect_timeout`, `unreachable`. |
| `rebase_db_connections` | Connexions client sur le serveur, par `state`, par rapport à `rebase_db_max_connections`. |
| `rebase_db_size_bytes` | La taille de la base de données. |
| `rebase_db_replica_lag_seconds` | Le retard de `DATABASE_READ_URL` par rapport au primaire. |

Les quatre dernières sont échantillonnées toutes les 30 secondes sur la propre connexion de l'instance, de sorte qu'un scrape ne déclenche jamais de requête.

`rebase_realtime_*` rapporte les sockets ouverts, les canaux et les trames envoyées au bus de canaux ou retenues pour chaque instance : voir [Seeing what the bus does](/docs/backend/realtime-transports/#seeing-what-the-bus-does).

## En-têtes de sécurité

Chaque réponse inclut `X-Frame-Options: SAMEORIGIN`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin` et `Strict-Transport-Security: max-age=15552000` (180 jours). L'en-tête HSTS omet `includeSubDomains` : cela indiquerait aux navigateurs de refuser le HTTP standard sur chaque sous-domaine de votre domaine, y compris ceux avec lesquels ce serveur n'a aucun lien, et un navigateur conserve cette consigne pendant toute la durée spécifiée par l'en-tête.
Définissez `REBASE_HSTS_INCLUDE_SUBDOMAINS=true` lorsque tous les sous-domaines sont exclusivement en HTTPS.

`strict-origin-when-cross-origin` est le comportement par défaut des navigateurs : une requête vers un autre site transmet votre origine et jamais le chemin ou les paramètres de requête de la page. Ce n'est pas `no-referrer` car les vérifications d'origine nécessitent l'origine — le bouton de connexion Google la compare aux origines JavaScript autorisées du client OAuth, et avec `no-referrer`, il répondait « The given origin is not allowed for the given client ID » sur chaque application, peu importe ce que le client autorisait. Une réponse qui définit sa propre politique la conserve (la page de consentement MCP envoie `no-referrer`) ; une page qui en souhaite une plus stricte peut le spécifier avec `<meta name="referrer" content="no-referrer">`. `X-Frame-Options` fonctionne de la même manière : `SAMEORIGIN`, sauf si la réponse définit la sienne, comme le fait la page de consentement MCP avec `DENY`.

Les applications statiques — l'administration du CMS et tout frontend servi par le bundle — comportent également `Content-Security-Policy: frame-ancestors 'self'; object-src 'none'; base-uri 'self'`. Cette directive détermine qui peut intégrer l'application dans une frame, exclut les plugins et verrouille `<base>` sur votre origine, sans restreindre quoi que ce soit d'autre, de sorte que les scripts inline, les workers et la connexion tierce continuent de fonctionner. Une réponse qui définit sa propre politique la conserve. Pour des règles plus strictes, appliquez la politique sur le reverse proxy placé en amont.

## Plusieurs instances

Un seul conteneur est la configuration par défaut et ne nécessite rien de plus. Avant qu'un deuxième réplica ne reçoive du trafic — ou qu'un déploiement progressif n'en exécute deux côte à côte —, consultez [Running more than one instance](/docs/deployment/multiple-instances/) : les limites de débit, les canaux de diffusion (broadcast), les fichiers locaux, les téléversements avec reprise et le cache d'images sont propres à chaque processus tant qu'un paramètre ne les partage pas.

## Connecter Claude

Une seule commande permet d'ajouter ce serveur au [connecteur Rebase](/docs/ai/rebase-connector/), le connecteur MCP unique qui accède à tous vos projets depuis Claude :

```bash
rebase cloud connect https://your-app.com
```

Définissez les deux variables qu'elle affiche sur ce serveur et redémarrez-le. Le serveur doit exécuter Rebase 0.28.1 ou une version ultérieure et répondre en HTTPS sur une adresse publique. Rien d'autre ne change : il ne détient aucun secret et accorde au connecteur les mêmes accès que Studio.

## Exécuter des fonctions dans leur propre processus

Tout ce qui précède utilise un conteneur unique servant l'intégralité du projet, ce qui est la structure idéale pour la quasi-totalité des déploiements. Lorsqu'une fonction personnalisée ne doit plus rivaliser avec l'API de données pour la boucle d'événements (event loop) — ou doit pouvoir évoluer à l'échelle (scale), redémarrer et échouer indépendamment —, la même image et le même bundle peuvent être démarrés sous forme de plusieurs processus coopérants. Voir [Split processes](/docs/deployment/split-processes/).

## Mise à niveau

```yaml
image: rebasepro/server:0.30.1
```

Redémarrez. Votre bundle reste inchangé. Au sein d'une même version majeure du contrat de runtime, un bundle validé continue de fonctionner — voir [Compatibility](/docs/architecture/runtime-and-bundles/#compatibility).
