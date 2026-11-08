---
sourceHash: 73b578b3dd3a2d81
title: Auto-hébergement
sidebar_label: Auto-hébergement
description: Exécutez Rebase n'importe où avec l'image runtime officielle et le bundle de votre projet — Docker Compose, Fly, Railway ou un simple VPS.
---

## Vue d'ensemble

L'auto-hébergement de Rebase implique d'exécuter deux éléments : une base de données Postgres, et l'image officielle `rebasepro/server` dans laquelle le bundle de votre projet est monté.

Il n'y a **aucune image applicative à construire**. Votre projet voyage sous forme de bundle, le runtime est publié, et la mise à niveau de Rebase est un simple changement de tag plutôt qu'une reconstruction. Consultez [Runtime and bundles](/docs/architecture/runtime-and-bundles/) pour comprendre pourquoi cette séparation existe.

## Docker Compose

**Si votre projet est issu de `rebase init`, utilisez son propre fichier `docker-compose.yml`.** Il se trouve dans votre dépôt, `init` a renseigné ses secrets, son premier compte administrateur et sa version de runtime épinglée, et c'est le fichier décrit dans [Deployment](/docs/getting-started/deployment/#docker-compose-recommended) :

```bash
rebase build
docker compose up -d
```

Le reste de cette page concerne le même déploiement sans scaffold sous-jacent — le projet de quelqu'un d'autre, un bundle généré dans une CI, ou les deux éléments que le fichier généré laisse délibérément de côté : un pooler de connexions et les configurations en processus scindés. Ce fichier se trouve dans le dépôt, à l'emplacement [`infra/docker/docker-compose.selfhost.yml`](https://github.com/rebasepro/rebase/blob/main/infra/docker/docker-compose.selfhost.yml). Utilisez-le plutôt que de copier un extrait de cette page : les deux fichiers sont démarrés par la porte d'acceptation du projet à chaque push, de sorte qu'aucun ne peut diverger de ce qui fonctionne réellement.

Les deux s'accordent sur chaque variable d'environnement sauf le mot de passe de la base de données, et cela s'explique par le fait que chacun est conçu pour son propre générateur : celui-ci lit `POSTGRES_PASSWORD`, généré par `quickstart.sh` ; le fichier généré lit `DATABASE_PASSWORD`, que `rebase init` intègre également dans l'URL `DATABASE_URL` qu'il écrit dans votre fichier `.env`.

```bash
rebase build                    # produces ./dist-bundle
./infra/docker/quickstart.sh    # writes infra/docker/.env if absent, then brings it up
```

`quickstart.sh` est une commande unique effectuant deux actions évidentes et les affichant toutes deux. La version détaillée, si vous préférez contrôler chaque étape :

```bash
docker compose -f infra/docker/docker-compose.selfhost.yml \
  --env-file infra/docker/.env up
```

Vous n'avez pas besoin de démarrer la base de données séparément — `api` attend son healthcheck.

### Les six valeurs nécessaires

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

- **`POSTGRES_PASSWORD`** — le mot de passe de la base de données. Le modifier plus tard implique de le changer également dans le volume, choisissez-le donc une fois pour toutes.
- **`JWT_SECRET`** — signe chaque session. Sa rotation déconnecte tout le monde.
- **`REBASE_SERVICE_KEY`** — l'identifiant qui contourne la sécurité au niveau des lignes pour les appels de serveur à serveur. Traitez-le comme un mot de passe root : quiconque le détient peut lire chaque ligne.
- **`CORS_ORIGINS`** — les origines depuis lesquelles votre frontend est servi, séparées par des virgules. Ce n'est pas un secret, et ce n'est pas optionnel : le runtime refuse de démarrer en production sans cette valeur plutôt que de deviner, car une API qui devine ses origines autorisées finit par autoriser la mauvaise.
- **`REBASE_ADMIN_EMAIL`** / **`REBASE_ADMIN_PASSWORD`** — le premier administrateur. Une base de données vierge n'a pas d'utilisateurs, et hors production, la politique d'inscription admet la première inscription et la promeut administrateur — sinon une base de données vide est une impasse, car initialiser un administrateur nécessite un appelant déjà connecté. Dès que cette stack répond sur un nom d'hôte, cette commodité devient une situation de concurrence que l'opérateur peut perdre ; en production, cette fenêtre est donc fermée et le compte est désigné ici à la place. Le runtime le crée une seule fois, lorsque la table des utilisateurs est vide, et ne fait rien à chaque démarrage ultérieur.

`JWT_SECRET` et `REBASE_SERVICE_KEY` doivent comporter chacun au moins 32 caractères, et le mot de passe administrateur au moins 12. Utilisez une adresse avec un point dans son domaine : `POST /auth/login` analyse son corps avec `z.string().email()`, le runtime refuse donc d'initialiser `admin@localhost` — un compte auquel personne ne pourrait se connecter — et consigne la raison dans les logs. Le fichier compose déclare les six avec `${VAR:?…}`, de sorte qu'une variable manquante arrête la stack avec un message la nommant plutôt que de démarrer quelque chose de semi-configuré — et l'auto-inscription est désactivée par défaut (`DISABLE_SELF_REGISTRATION`, valeur par défaut `true`), évitant ainsi que quoi que ce soit reste revendicable.

Connectez-vous avec ces identifiants et modifiez le mot de passe : ils figurent en clair dans un fichier sur l'hôte.

## Dépendances

`rebase build` **installe par défaut les dépendances de votre projet dans le bundle**, de sorte que `dist-bundle` arrive avec un dossier `node_modules` et un `package-lock.json` aux côtés de son `package.json`. Un bundle avec dépendances embarquées démarre en environ cinq secondes.

Comme elles sont déjà présentes, vous pouvez monter le bundle en lecture seule — ce qui est recommandé, car un hook compromis ne pourra alors pas réécrire le code exécuté après le prochain redémarrage :

```yaml
    volumes:
      - ./dist-bundle:/bundle:ro
```

`rebase build --no-vendor` désactive cette option et produit un bundle qui installe plutôt ses dépendances au premier démarrage, ce qui prend 40 à 60 secondes par démarrage et nécessite que le point de montage soit accessible en écriture.

Pour un déploiement réel, préférez intégrer les deux directement dans une image, ce qui fige également avec exactitude ce qui s'exécute :

```dockerfile
FROM rebasepro/server:0.28.2
COPY dist-bundle /bundle
```

## Création du schéma

**Le runtime crée les tables manquantes au démarrage, y compris celles de vos collections.** `REBASE_MIGRATE_ON_BOOT` a pour valeur par défaut `ensure`, qui est additif sur l'ensemble du schéma : il crée les tables, colonnes et types enum manquants, et applique leur sécurité au niveau des lignes. Un premier démarrage sur une base de données vide se lance en servant directement vos collections, sans étape distincte.

Ce que `ensure` ne fait délibérément jamais, c'est modifier ce qui existe déjà. Il ne modifie pas le type d'une colonne, ne supprime aucune table ni colonne, et ne modifie pas les libellés d'un enum existant — car le redémarrage d'un conteneur ne doit pas pouvoir remodeler un schéma en tant qu'effet secondaire d'un déploiement.

L'exécution de `rebase db push` reste donc utile pour ce que le démarrage ignore — toute modification qui n'est pas purement additive : une colonne renommée, un type restreint, un champ supprimé.

```bash
rebase db push
```

Exécutez-la depuis un checkout ou un job CI, pointant vers la base de données du déploiement. Elle effectue d'abord un test à blanc des modifications, refuse les changements destructifs sans confirmation explicite, et peut effectuer une sauvegarde avant d'appliquer. La base de données publie un port dans le fichier compose afin que cette commande puisse l'atteindre depuis l'hôte ; supprimez ce mappage une fois le schéma en place si la base de données ne doit pas être accessible de l'extérieur.

`REBASE_MIGRATE_ON_BOOT` n'accepte que `ensure` et `none`, et rien d'autre — l'image **refuse de démarrer** avec `push`, pour la raison mentionnée ci-dessus.

## Quand seul votre processus de gestion des changements peut modifier la base de données

`REBASE_MIGRATE_ON_BOOT=none` ne touche pas à vos collections. Cela ne laisse pas pour autant la base de données intacte : les tables propres au framework (authentification, clés d'API, tâches, cron) sont toujours créées et maintenues à jour à chaque démarrage. Lorsque la base de données ne doit changer que par le biais d'un processus de modification revu, définissez `REBASE_PROVISION=false` sur chaque processus qui sert le trafic :

| Paramètre | Tables et politiques de collections | Tables du framework |
|---|---|---|
| par défaut (`REBASE_MIGRATE_ON_BOOT=ensure`) | créées et maintenues à jour au démarrage | créées et maintenues à jour |
| `REBASE_MIGRATE_ON_BOOT=none` | laissées intactes | créées et maintenues à jour |
| `REBASE_PROVISION=false` | laissées intactes | laissées intactes ; les éléments manquants sont signalés dans les logs |

Avec le provisionnement désactivé, le runtime ne crée ni ne modifie rien : aucune table, colonne, index, fonction, déclencheur, politique, rôle ou privilège. Cela vaut au démarrage et par la suite, y compris pour les tables qu'un processus de service crée habituellement lors de la première utilisation (clés d'idempotence, revendications cron, compteurs de limitation de débit partagés). À la place, il lit ce qui est présent :

- **Tables d'authentification, ou colonne lue par l'authentification, manquantes :** le démarrage est refusé et chacune d'elles est listée.
- **Le rôle de requête peut accéder à une table du framework** telle que `rebase.refresh_tokens` ou `rebase.api_keys` : le démarrage est refusé et affiche la commande `REVOKE` à exécuter. Un démarrage avec provisionnement retire ces privilèges de lui-même. Lorsque le provisionnement est désactivé, rien ne le fait.
- **Une table facultative est manquante** (clés d'API, clés d'idempotence, revendications cron, compteurs de limitation de débit, présence, historique des métriques) : cette fonctionnalité est désactivée, et le log indique quelle table est requise.

Les lignes continuent d'évoluer, comme dans n'importe quelle base de données : connexions, sessions, utilisation des clés d'API, clés d'idempotence, revendications cron. Le premier compte administrateur (`REBASE_ADMIN_EMAIL`) est initialisé par l'exécution de provisionnement, et non par les processus de service. La [modification de schéma en direct](/docs/backend/live-schema-editing) peut toujours committer une modification dans le code source, mais refuse de l'appliquer à la base de données.

### L'exécution du provisionnement

Le schéma provient d'une exécution contrôlée par votre processus de gestion des changements. Utilisez la même image et le même bundle que le serveur, avec `REBASE_PROVISION_ONLY=true`, connecté avec un rôle disposant des droits de création dans la base de données. `REBASE_PROVISION_SQL_OUT` conserve chaque modification de schéma effectuée lors de l'exécution sous la forme d'un script SQL :

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

Le script est un enregistrement, pas un plan : chaque instruction qu'il contient a été exécutée, dans l'ordre, avec succès. Enregistré sur une base de données vide, il représente l'intégralité du schéma requis par la version. Enregistré sur une copie restaurée de la production, il constitue exactement la mise à niveau. Les lignes écrites lors de l'exécution n'y figurent pas. Examinez-le, puis appliquez-le à la véritable base de données :

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f out/rebase.sql
```

Répétez cette opération pour chaque mise à niveau de Rebase, avant le déploiement progressif des processus de service. Une version peut ajouter une table ou une colonne, et un processus qui n'a pas le droit d'en créer une la signalera comme manquante au lieu de la créer.

Un serveur que vous construisez vous-même suit la même règle : `initializeRebaseBackend` lit `REBASE_PROVISION`, et `createRebaseBackend` accepte [`provision: false`](/docs/backend/custom-server#what-creating-a-backend-may-change-provision).

## Stockage de fichiers

Le stockage est **désactivé** à moins qu'un bucket ne soit configuré, et c'est délibéré : l'autre option par défaut serait le système de fichiers du conteneur, qui perdrait silencieusement chaque fichier téléversé au redémarrage suivant. Les téléversements sont refusés avec l'erreur `501 STORAGE_NOT_CONFIGURED` jusqu'à ce que vous en configuriez un.

Pour un bucket, définissez `STORAGE_TYPE=s3` (ou `gcs`) ainsi que son bucket et ses identifiants — le fichier compose liste les variables en commentaire. `gcs` charge `@google-cloud/storage`, qui n'est pas fourni dans l'image officielle ; sur cette image, accédez donc plutôt à Google Cloud Storage via son endpoint compatible S3 (`STORAGE_TYPE=s3`, `S3_ENDPOINT=https://storage.googleapis.com`, clés HMAC).

Pour le disque local, qui ne convient que lorsque le chemin est un véritable volume persistant au-delà du conteneur :

```yaml
      STORAGE_TYPE: local
      # Each declared bucket gets a directory beside this one, bucket("media")
      # /storage/uploads__media, so the volume goes on their parent.
      STORAGE_PATH: /storage/uploads
      FORCE_LOCAL_STORAGE: "true"
    volumes:
      - storage:/storage
```

`FORCE_LOCAL_STORAGE` n'est pas facultatif ici : en production, un backend `local` est ignoré plutôt qu'enregistré, car l'alternative consisterait en des téléversements réussissant dans un système de fichiers sur le point d'être détruit. Cette variable permet d'affirmer que le montage est durable.

Montez le volume **au-dessus** de `STORAGE_PATH`, et non à son emplacement direct. `STORAGE_PATH` est le répertoire du bucket par défaut, et chaque bucket déclaré dans `config/resources.ts` obtient son propre répertoire à côté, `<STORAGE_PATH>__<key>`. Un volume monté sur `STORAGE_PATH` lui-même ne contient que le bucket par défaut. Tous les autres buckets écrivent sur le système de fichiers du conteneur et perdent leurs fichiers lors de la recréation du conteneur. `STORAGE_PATH__MEDIA` peut déplacer un bucket ailleurs sur le volume. Il ne peut pas le déplacer dans le répertoire d'un autre bucket, comme `/storage/uploads/media`, car le bucket par défaut listerait, servirait et supprimerait alors ses fichiers.

L'image crée `/storage` pour l'utilisateur non privilégié `node` sous lequel elle s'exécute, c'est pourquoi le volume s'y place. Un volume monté là où l'image n'a pas de répertoire appartient à root, et chaque téléversement échoue avec `EACCES`. Le fichier compose généré par `rebase init` le monte de cette manière.

### Le stockage nécessite un modèle de contrôle d'accès

Dès lors qu'un bucket **est** configuré, le runtime **refuse de démarrer en production** tant que le déploiement ne précise pas comment les objets sont protégés. Le stockage n'est pas soumis à la sécurité au niveau des lignes et ses clés partagent un espace de noms plat unique ; sans règle, la seule chose séparant les fichiers de deux utilisateurs est le caractère imprévisible des clés — ce que `GET /storage/list?prefix=` contourne facilement. L'une quelconque des options suivantes satisfait cette exigence :

- un **hook `storageAuthorize`** (ou `storagePolicies`) dans la configuration de votre projet, ce qui constitue la vraie réponse et ce que le scaffold fournit dans `config/storage.ts` — aucune variable d'environnement ne peut exprimer « cet utilisateur peut lire cette clé » ;
- **`STORAGE_PUBLIC_READ=true`**, pour un bucket qui est véritablement un CDN public en lecture seule ;
- **`STORAGE_ALLOW_ANY_AUTHENTICATED=true`**, pour une application mono-tenant où chaque compte connecté a accès à l'ensemble des fichiers en toute confiance.

Hors production, cette même condition déclenche un avertissement explicite plutôt qu'un refus, il s'agit donc d'un échec de démarrage rencontré lors du déploiement plutôt que sur votre machine locale. C'est délibéré : l'échec qu'il remplace est silencieux.

Définissez également `MFA_ENCRYPTION_KEY` si vous utilisez TOTP. Sans cela, les secrets d'authentification stockés sont chiffrés avec `JWT_SECRET` — une rotation de celui-ci déconnecte donc tout le monde *et* rend impossible le déchiffrement de chaque appareil enregistré.

## Autres plateformes

Le runtime est un conteneur ordinaire écoutant sur `$PORT`, de sorte que tout ce qui exécute des conteneurs fonctionne. Deux points à respecter partout :

1. Le bundle doit être présent à l'emplacement `/bundle` (ou là où pointe `REBASE_BUNDLE`), avec ses dépendances installées à ses côtés — voir [Dépendances](#dépendances).
2. Définissez `CORS_ORIGINS`, `JWT_SECRET` et `DATABASE_URL`. Le runtime refuse de démarrer en production sans ces variables plutôt que de tenter de deviner.

### Fly.io

```toml
[build]
  dockerfile = "Dockerfile"   # FROM rebasepro/server:0.28.2 + COPY dist-bundle /bundle

[http_service]
  internal_port = 8080

[[http_service.checks]]
  path = "/livez"
```

Utilisez la forme d'image dérivée ci-dessus afin que le bundle soit livré avec l'application, puis lancez `fly deploy`.

### Railway / Render

Pointez le service vers l'image dérivée, définissez les variables d'environnement et configurez le chemin du healthcheck sur `/livez`.

### Un simple VPS

```bash
npm install -g @rebasepro/server @rebasepro/server-postgres
rebase-server /srv/myapp/dist-bundle
```

`rebase-server --help` liste les variables qu'il lit. Sous systemd — les deux lignes `REBASE_ADMIN_*` nécessitent la version 0.18 ou ultérieure, et sur la 0.17.3, le premier compte à s'inscrire devient l'administrateur à la place :

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

`NODE_ENV=production` n'est pas là pour faire joli. Sans cette définition, le processus s'exécute en mode développement : il reflète les origines localhost, sert la spécification OpenAPI et **laisse ouverte la fenêtre du premier administrateur** — ainsi, le premier inconnu à trouver le formulaire d'inscription devient administrateur. Les deux lignes `REBASE_ADMIN_*` remplacent cette fenêtre ; voir [Votre premier administrateur](/docs/getting-started/deployment/#your-first-admin).

`ALLOW_LOCALHOST_IN_PRODUCTION=true` est présent car la base de données se trouve sur la même machine. En production, le runtime refuse toute variable pointant vers localhost — dans un conteneur, le loopback est le conteneur lui-même, cette adresse est donc toujours une erreur — et cette ligne lui indique que cette adresse est délibérée. Supprimez-la lorsque la base de données s'exécute ailleurs.

Préférez `EnvironmentFile=/etc/rebase.env` avec les permissions du fichier définies à 0600 plutôt que des lignes `Environment=` pour les secrets : un fichier de service unit est lisible par tous, et `systemctl show` affiche chaque valeur de `Environment=`.

## Pool de connexions

Le runtime maintient un petit pool persistant et n'a pas besoin de pooler. En revanche, tout ce qui communique avec la même base de données et ne peut pas maintenir une connexion en a besoin : une fonction serverless, un script planifié, un outil de BI, un worker de file d'attente qui monte à cinquante instances. Le paramètre `max_connections` de Postgres est une limite stricte de quelques centaines et chaque connexion est un *processus*, si bien qu'un fan-out de lambdas l'épuise bien avant que la base de données ne soit saturée.

Le fichier compose inclut un service `pgbouncer` pour ce trafic, derrière un profil pour qu'un déploiement sans de tels appelants n'exécute pas un processus inutile :

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

L'authentification client est générée à partir de `DATABASE_URL` au démarrage, évitant ainsi d'écrire le mot de passe deux fois. Le pooler s'authentifie auprès de Postgres avec `scram-sha-256`, pris en charge par Postgres 18 — la valeur par défaut `md5` de l'image fait échouer la connexion au *serveur* avec `FATAL: server login failed: wrong password type`, ce qui ressemble à un mauvais mot de passe alors que ce n'en est pas un.

Maintenez la somme de `PGBOUNCER_POOL_SIZE` sur l'ensemble des poolers largement en dessous du `max_connections` de la base de données — le runtime puise dans le même quota.

### Ce que change le pooling de transactions

Un client mutualisé détient une connexion serveur pendant la durée d'une transaction puis la libère, ce qui permet à 500 clients de partager 20 connexions. Trois fonctionnalités cessent de fonctionner via ce port, et chacune d'elles est utilisée par Rebase lui-même — c'est précisément pourquoi le runtime se connecte directement et que ce port est réservé aux autres appelants :

- **`LISTEN`/`NOTIFY`.** Le temps réel repose dessus, et un écouteur a besoin d'une connexion qui persiste au-delà d'une transaction. `LISTEN` est *accepté* par le pooler — il répond `LISTEN`, puis aucune notification n'arrive jamais.
- **État de session** : `SET` (contrairement à `SET LOCAL`), verrous consultatifs conservés entre plusieurs instructions, curseurs `WITH HOLD`, tables temporaires. La transaction suivante peut atterrir sur une connexion serveur différente, qui ne verra rien de tout cela. Ces deux cas échouent de la même manière déroutante : avec un seul client inactif, l'état persiste généralement, cela fonctionne donc pendant vos tests et cesse de fonctionner sous la concurrence pour laquelle vous avez justement introduit le pooler.
- **Requêtes préparées au niveau du protocole.** La plupart des pilotes peuvent être configurés pour ne pas les utiliser — node-postgres ne le fait pas par défaut ; asyncpg nécessite `statement_cache_size=0`.

`SET LOCAL` a une portée limitée à la transaction et fonctionne, et c'est avec cela que la sécurité au niveau des lignes est définie — RLS se comporte donc de manière identique à travers le port mutualisé.

Laissez le profil désactivé si rien en dehors du runtime ne se connecte à votre base de données. Un port inutilisé représente une surface d'attaque.

## Health checks

| Chemin | Utilisation |
| --- | --- |
| `/livez` | Liveness. Répond à « ce processus est-il vivant » sans toucher à la base de données. |
| `/health` | Readiness. Effectue un aller-retour avec la base de données et indique la latence. |

Pointez les sondes de vivacité vers `/livez`. Une sonde de vivacité sur `/health` redémarre un processus parfaitement sain lors d'un bref hoquet de la base de données, ce qui est le contraire de sa fonction.

## Métriques

```bash
REBASE_METRICS=true
REBASE_METRICS_TOKEN=<random string>
```

Expose les métriques Prometheus sur `/metrics` : nombres de requêtes et histogrammes de latence ventilés par surface d'API (data, auth, storage, functions) et par collection, ainsi que des jauges de processus. Sans token, le point de terminaison est lisible par quiconque peut atteindre le port ; définissez-en donc un, à moins qu'il ne soit sur un réseau privé.

`rebase_db_pool_wait_ms` est un histogramme du temps d'attente de chaque requête pour obtenir une connexion depuis le pool de base de données, ouverture de connexion comprise, étiqueté par clé de source de données (`source="(default)"` dans un projet qui ne déclare aucune source de données). Un pool sain le maintient proche de zéro. Une queue de distribution qui s'allonge avec le trafic signifie que les requêtes font la queue pour obtenir des connexions — le plus souvent retenues par des callbacks d'écriture qui attendent une opération lente ; voir [A callback holds a connection](/docs/collections/context-data-api/#a-callback-holds-a-connection).

La base de données elle-même, par source de données :

| Métrique | Ce qu'elle indique |
|--------|--------------|
| `rebase_db_pool_connections`, `rebase_db_pool_idle`, `rebase_db_pool_waiting` | Les connexions de chaque pool, étiquetées `pool="primary"`, `"read"` (le réplica) ou `"session"` (le pool direct de la console SQL derrière un pooler). Un `waiting` supérieur à zéro de façon prolongée indique un pool trop petit pour sa charge. |
| `rebase_db_connection_errors_total` | Requêtes ayant répondu 503 faute de connexion, par `code` : `53300` / `53400` (le serveur n'a plus de connexions), `pool_exhausted`, `connect_timeout`, `unreachable`. |
| `rebase_db_connections` | Connexions clientes sur le serveur, par `state`, par rapport à `rebase_db_max_connections`. |
| `rebase_db_size_bytes` | La taille de la base de données. |
| `rebase_db_replica_lag_seconds` | Le retard de `DATABASE_READ_URL` par rapport au primaire. |

Les quatre dernières sont échantillonnées toutes les 30 secondes sur la propre connexion de l'instance, de sorte qu'un scrape ne se transforme jamais en requête.

`rebase_realtime_*` rapporte les sockets ouverts, les canaux de chaque instance et les trames envoyées au bus de canaux ou retenues : voir [Seeing what the bus does](/docs/backend/realtime-transports/#seeing-what-the-bus-does).

## En-têtes de sécurité

Chaque réponse comporte `X-Frame-Options: SAMEORIGIN`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin` et `Strict-Transport-Security: max-age=15552000` (180 jours). L'en-tête HSTS exclut `includeSubDomains` : cela indiquerait aux navigateurs de refuser le HTTP simple sur tous les sous-domaines de votre domaine, y compris ceux avec lesquels ce serveur n'a aucun rapport, et un navigateur conserve cette consigne pendant toute la durée spécifiée par l'en-tête.
Définissez `REBASE_HSTS_INCLUDE_SUBDOMAINS=true` lorsque chaque sous-domaine est exclusivement en HTTPS ; jusqu'à la version 0.23 incluse, l'en-tête comportait systématiquement `includeSubDomains`.

`strict-origin-when-cross-origin` est le comportement par défaut des navigateurs : une requête vers un autre site transmet votre origine et jamais le chemin ou les paramètres de requête de la page. Ce n'est pas `no-referrer` car les vérifications d'origine ont besoin de connaître l'origine — le bouton de connexion Google la compare aux origines JavaScript autorisées du client OAuth, et sous `no-referrer`, il répondait « The given origin is not allowed for the given client ID » sur chaque application, peu importe ce que le client autorisait. Une réponse qui définit sa propre politique la conserve (la page de consentement MCP envoie `no-referrer`) ; une page qui souhaite une politique plus stricte peut l'indiquer avec `<meta name="referrer" content="no-referrer">`. `X-Frame-Options` fonctionne de la même manière : `SAMEORIGIN` sauf si la réponse définit la sienne, comme le fait la page de consentement MCP avec `DENY`.

Les applications statiques — l'administration du CMS et tout frontend servi par le bundle — comportent également `Content-Security-Policy: frame-ancestors 'self'; object-src 'none'; base-uri 'self'`. Cette directive détermine qui peut intégrer l'application dans une iframe, exclut les plugins et fixe `<base>` à votre origine, sans rien restreindre d'autre, de sorte que les scripts inline, les workers et l'authentification tierce continuent de fonctionner. Une réponse qui définit sa propre politique la conserve. Pour toute politique plus stricte, configurez-la sur le reverse proxy en amont.

## Plusieurs instances

Un seul conteneur constitue la configuration par défaut et ne requiert rien de plus. Avant qu'un second réplica ne reçoive du trafic — ou qu'un déploiement progressif n'en exécute deux côte à côte —, consultez [Running more than one instance](/docs/deployment/multiple-instances/) : les limitations de débit, les canaux de diffusion, les fichiers locaux, les téléversements avec reprise et le cache d'images s'appliquent par processus tant qu'un paramètre ne les partage pas.

## Connecter Claude

Une seule commande ajoute ce serveur au [connecteur Rebase](/docs/ai/rebase-connector/), le connecteur MCP unique qui accède à tous vos projets depuis Claude :

```bash
rebase cloud connect https://your-app.com
```

Définissez les deux variables qu'elle affiche sur ce serveur et redémarrez-le. Le serveur doit exécuter Rebase 0.28.1 ou une version ultérieure et répondre en HTTPS sur une adresse publique. Rien d'autre ne change : il ne détient aucun secret, et accorde au connecteur les mêmes droits que Studio.

## Exécuter des fonctions dans leur propre processus

Tout ce qui précède concerne un conteneur unique servant l'intégralité du projet, ce qui convient à la quasi-totalité des déploiements. Lorsqu'une fonction personnalisée ne doit plus entrer en concurrence avec l'API de données pour la boucle d'événements — ou lorsqu'elle doit pouvoir monter en charge, redémarrer et échouer de façon autonome —, la même image et le même bundle peuvent être démarrés sous forme de plusieurs processus coopérants. Voir [Split processes](/docs/deployment/split-processes/).

## Mise à niveau

```yaml
image: rebasepro/server:0.28.2
```

Redémarrez. Votre bundle reste inchangé. Au sein d'une même version majeure du contrat d'exécution, un bundle validé continue de fonctionner — voir [Compatibility](/docs/architecture/runtime-and-bundles/#compatibility).
