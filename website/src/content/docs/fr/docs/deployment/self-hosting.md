---
sourceHash: dd7f515c841c860b
title: Auto-hébergement
sidebar_label: Auto-hébergement
description: Exécutez Rebase n'importe où avec l'image de runtime officielle et le bundle de votre projet — Docker Compose, Fly, Railway ou un simple VPS.
---

## Vue d'ensemble

Auto-héberger Rebase implique d'exécuter deux choses : une base de données Postgres, et l'image officielle `rebasepro/server` avec le bundle de votre projet monté dedans.

Il n'y a **aucune image applicative à construire**. Votre projet voyage sous forme de bundle, le runtime est publié, et la mise à niveau de Rebase est un simple changement de tag plutôt qu'une reconstruction. Consultez [Runtime and bundles](/docs/architecture/runtime-and-bundles/) pour savoir pourquoi cette séparation existe.

## Docker Compose

**Si votre projet provient de `rebase init`, utilisez son propre `docker-compose.yml`.**
Il se trouve dans votre dépôt, `init` y a renseigné ses secrets, son premier compte administrateur et sa version de runtime verrouillée, et c'est le fichier décrit dans [Deployment](/docs/getting-started/deployment/#docker-compose-recommended) :

```bash
rebase build
docker compose up -d
```

Le reste de cette page présente le même déploiement sans scaffold sous-jacent — le projet de quelqu'un d'autre, un bundle généré dans un CI, ou les deux éléments que le fichier généré omet délibérément : un pooler de connexions et les configurations en processus séparés. Celui-ci réside dans le dépôt, à l'adresse [`infra/docker/docker-compose.selfhost.yml`](https://github.com/rebasepro/rebase/blob/main/infra/docker/docker-compose.selfhost.yml). Utilisez-le plutôt que de copier un extrait de cette page : les deux fichiers sont démarrés par la porte d'acceptation du projet à chaque push, de sorte qu'aucun ne peut diverger de ce qui fonctionne réellement.

Les deux s'accordent sur toutes les variables d'environnement à l'exception du mot de passe de la base de données, et ce parce que chacun est pensé pour son propre générateur : celui-ci lit `POSTGRES_PASSWORD`, généré par `quickstart.sh` ; le fichier généré lit `DATABASE_PASSWORD`, que `rebase init` intègre également dans l'URL `DATABASE_URL` qu'il écrit dans votre `.env`.

```bash
rebase build                    # produces ./dist-bundle
./infra/docker/quickstart.sh    # writes infra/docker/.env if absent, then brings it up
```

`quickstart.sh` est une commande unique effectuant deux actions évidentes et les affichant toutes deux. La version détaillée, si vous préférez maîtriser chaque étape :

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

Trois secrets, une information concrète, et le compte avec lequel vous vous connectez :

- **`POSTGRES_PASSWORD`** — le mot de passe de la base de données. Le modifier plus tard implique de le changer également dans le volume, choisissez-le donc dès le départ.
- **`JWT_SECRET`** — signe chaque session. Le renouveler déconnecte tout le monde.
- **`REBASE_SERVICE_KEY`** — l'identifiant qui contourne la sécurité au niveau des lignes (RLS) pour les appels de serveur à serveur. Traitez-le comme un mot de passe root : tout ce qui le possède peut lire chaque ligne.
- **`CORS_ORIGINS`** — les origines depuis lesquelles votre frontend est servi, séparées par des virgules. Ce n'est pas un secret, et ce n'est pas optionnel : le runtime refuse de démarrer en production sans cette valeur plutôt que de deviner, car une API qui devine ses origines autorisées finit par autoriser la mauvaise.
- **`REBASE_ADMIN_EMAIL`** / **`REBASE_ADMIN_PASSWORD`** — le premier administrateur. Une nouvelle base de données n'a pas d'utilisateurs, et hors production la politique d'inscription accepte la première inscription et la promeut administrateur — sinon une base de données vide est une impasse, car amorcer un administrateur nécessite un appelant déjà connecté. Dès lors que cette stack répond sur un nom d'hôte, cette commodité devient une course que l'opérateur peut perdre ; en production, cette fenêtre est donc fermée et le compte est spécifié ici à la place. Le runtime le crée une seule fois, lorsque la table des utilisateurs est vide, et ne fait rien à chaque démarrage ultérieur.

`JWT_SECRET` et `REBASE_SERVICE_KEY` doivent comporter chacun au moins 32 caractères, et le mot de passe administrateur au moins 12 caractères. Utilisez une adresse contenant un point dans son domaine : `POST /auth/login` valide son corps avec `z.string().email()`, de sorte que le runtime refuse d'initialiser `admin@localhost` — un compte auquel personne ne pourrait se connecter — et consigne la raison dans les logs. Le fichier compose déclare les six variables avec `${VAR:?…}`, ainsi une variable manquante interrompt la stack avec un message la désignant plutôt que de démarrer un système à moitié configuré — et l'auto-inscription est désactivée par défaut (`DISABLE_SELF_REGISTRATION`, valeur par défaut `true`), pour que rien ne puisse être accaparé.

Connectez-vous avec ces identifiants et changez le mot de passe : ils sont stockés en clair dans un fichier sur l'hôte.

## Dépendances

`rebase build` **installe les dépendances de votre projet dans le bundle** par défaut, ainsi `dist-bundle` arrive avec un `node_modules` et un `package-lock.json` aux côtés de son `package.json`. Un bundle avec dépendances intégrées (vendored) démarre en cinq secondes environ.

Comme elles sont déjà présentes, vous pouvez monter le bundle en lecture seule — ce qui est recommandé, car un hook compromis ne pourra alors pas réécrire le code exécuté après le prochain redémarrage :

```yaml
    volumes:
      - ./dist-bundle:/bundle:ro
```

`rebase build --no-vendor` désactive ce comportement et produit un bundle qui installe ses dépendances au premier démarrage à la place, ce qui prend 40 à 60 secondes par démarrage et nécessite que le point de montage soit accessible en écriture.

Pour un déploiement réel, préférez intégrer les deux dans une image, ce qui fige également avec exactitude ce qui s'exécute :

```dockerfile
FROM rebasepro/server:0.28.2
COPY dist-bundle /bundle
```

## Création du schéma

**Le runtime crée les tables manquantes au démarrage, y compris celles de vos collections.**
`REBASE_MIGRATE_ON_BOOT` a pour valeur par défaut `ensure`, ce qui est additif sur l'ensemble du schéma : il crée les tables, colonnes et types enum manquants, et applique leur sécurité au niveau des lignes (RLS). Un premier démarrage sur une base de données vide commence à servir vos collections, sans aucune étape supplémentaire.

Ce que `ensure` ne fait délibérément jamais, c'est modifier ce qui existe déjà. Il ne modifie pas le type d'une colonne, ne supprime ni table ni colonne, et n'édite pas les valeurs d'un enum existant — car un redémarrage de conteneur ne doit pas pouvoir remodeler un schéma comme effet secondaire d'un déploiement.

`rebase db push` reste donc utile pour tout ce que le démarrage ignore — tout changement qui n'est pas purement additif : une colonne renommée, un type restreint, un champ supprimé.

```bash
rebase db push
```

Exécutez-la depuis un clone local ou un job CI, en pointant vers la base de données du déploiement. Elle effectue d'abord une simulation (dry-run), refuse les modifications destructives sans confirmation explicite, et peut effectuer une sauvegarde avant application. La base de données publie un port dans le fichier compose pour permettre cet accès depuis l'hôte ; supprimez ce mappage une fois le schéma en place si la base de données ne doit pas être accessible depuis l'extérieur.

`REBASE_MIGRATE_ON_BOOT` accepte `ensure` et `none`, et rien d'autre — l'image **refuse de démarrer** avec la valeur `push`, pour la raison mentionnée ci-dessus.

## Lorsque seul votre processus de gestion des changements peut modifier la base de données

`REBASE_MIGRATE_ON_BOOT=none` ne touche pas à vos collections. Cela ne laisse pas la base de données intouchée pour autant : les tables propres au framework (auth, clés d'API, jobs, cron) sont toujours créées et maintenues à jour à chaque démarrage. Lorsque la base de données ne doit être modifiée que par un processus de gestion des changements revu et validé, définissez `REBASE_PROVISION=false` sur chaque processus qui sert du trafic :

| Paramètre | Tables de collections et politiques | Tables du framework |
|---|---|---|
| par défaut (`REBASE_MIGRATE_ON_BOOT=ensure`) | créées et maintenues à jour au démarrage | créées et maintenues à jour |
| `REBASE_MIGRATE_ON_BOOT=none` | intouchées | créées et maintenues à jour |
| `REBASE_PROVISION=false` | intouchées | intouchées ; tout élément manquant est listé dans les logs |

Lorsque le provisionnement est désactivé, le runtime ne crée ni ne modifie rien : aucune table, colonne, index, fonction, déclencheur (trigger), politique, rôle ou privilège (grant). Cela vaut au démarrage et par la suite, y compris pour les tables qu'un processus de service crée normalement lors de la première utilisation (clés d'idempotence, revendications cron, compteurs de limitation de débit partagés). Au lieu de cela, il lit ce qui est présent :

- **Tables d'authentification, ou une colonne lue par l'authentification, manquante :** le démarrage refuse de s'exécuter et liste chaque élément manquant.
- **Le rôle effectuant les requêtes peut accéder à une table du framework** telle que `rebase.refresh_tokens` ou `rebase.api_keys` : le démarrage refuse et affiche le `REVOKE` à exécuter. Un démarrage avec provisionnement révoque ces privilèges de lui-même. Avec le provisionnement désactivé, rien ne le fait.
- **Une table optionnelle manquante** (clés d'API, clés d'idempotence, revendications cron, compteurs de limitation de débit, présence, historique des métriques) : cette fonctionnalité est désactivée, et les logs indiquent quelle table est requise.

Les lignes continuent d'évoluer, comme sur n'importe quelle base de données : connexions, sessions, utilisation des clés d'API, clés d'idempotence, revendications cron. Le premier compte administrateur (`REBASE_ADMIN_EMAIL`) est initialisé par l'exécution de provisionnement, pas par les processus de service. La [modification de schéma en direct](/docs/backend/live-schema-editing) peut toujours valider une modification dans le code source, mais refuse de l'appliquer à la base de données.

### L'exécution de provisionnement

Le schéma provient d'une exécution contrôlée par votre processus de gestion des changements. Utilisez la même image et le même bundle que le serveur, avec `REBASE_PROVISION_ONLY=true`, connecté en tant que rôle ayant les droits de création dans la base de données. `REBASE_PROVISION_SQL_OUT` enregistre chaque modification de schéma effectuée lors de l'exécution, sous forme de script SQL :

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

L'image s'exécute avec `NODE_ENV=production`, cette exécution est donc soumise aux mêmes vérifications d'environnement que le serveur, y compris `CORS_ORIGINS` ou `FRONTEND_URL`, même si elle ne sert aucun trafic.

Le script est un enregistrement de ce qui a eu lieu, pas un plan théorique : chaque instruction qu'il contient a été exécutée, dans l'ordre, et avec succès. Enregistré sur une base de données vide, il représente l'intégralité du schéma requis par la version. Enregistré sur une copie restaurée de la production, il constitue exactement la mise à niveau. Les lignes écrites par l'exécution n'y figurent pas. Examinez-le, puis appliquez-le à la véritable base de données :

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f out/rebase.sql
```

Répétez cette opération à chaque mise à niveau de Rebase, avant le déploiement progressif des processus de service. Une version peut ajouter une table ou une colonne, et un processus qui n'a pas le droit d'en créer une la signalera comme manquante au lieu de la créer.

Un serveur que vous construisez vous-même suit la même règle : `initializeRebaseBackend` lit `REBASE_PROVISION`, et `createRebaseBackend` prend en charge [`provision: false`](/docs/backend/custom-server#what-creating-a-backend-may-change-provision).

## Stockage de fichiers

Le stockage est **désactivé** tant qu'aucun bucket n'est configuré, et c'est délibéré : l'autre option par défaut serait le système de fichiers du conteneur, qui perdrait silencieusement chaque fichier téléversé au prochain redémarrage. Les téléversements sont refusés avec l'erreur `501 STORAGE_NOT_CONFIGURED` jusqu'à ce que vous en configuriez un.

Pour un bucket, définissez `STORAGE_TYPE=s3` (ou `gcs`) ainsi que son nom de bucket et ses identifiants — le fichier compose liste les variables, en commentaire. `gcs` charge `@google-cloud/storage`, qui n'est pas fourni dans l'image officielle ; sur cette image, accédez donc plutôt à Google Cloud Storage via son endpoint compatible S3 (`STORAGE_TYPE=s3`, `S3_ENDPOINT=https://storage.googleapis.com`, clés HMAC).

Pour le disque local, ce qui ne convient que lorsque le chemin est un véritable volume qui survit au conteneur :

```yaml
      STORAGE_TYPE: local
      # Each declared bucket gets a directory beside this one, bucket("media")
      # /storage/uploads__media, so the volume goes on their parent.
      STORAGE_PATH: /storage/uploads
      FORCE_LOCAL_STORAGE: "true"
    volumes:
      - storage:/storage
```

`FORCE_LOCAL_STORAGE` n'est pas optionnel ici : en production, un backend `local` est ignoré plutôt qu'enregistré, car l'alternative consisterait en des téléversements réussissant dans un système de fichiers sur le point d'être détruit. Cette variable permet d'attester que le montage est persistant.

Montez le volume **au-dessus** de `STORAGE_PATH`, et non pas directement dessus. `STORAGE_PATH` est le répertoire du bucket par défaut, et chaque bucket déclaré dans `config/resources.ts` obtient le sien à côté, `<STORAGE_PATH>__<key>`. Un volume monté sur `STORAGE_PATH` lui-même ne contiendra que le bucket par défaut. Tout autre bucket écrira dans le système de fichiers du conteneur et perdra ses fichiers lors de la recréation du conteneur. `STORAGE_PATH__MEDIA` permet de déplacer un bucket ailleurs sur le volume. Il ne peut pas le déplacer à l'intérieur du répertoire d'un autre bucket, comme `/storage/uploads/media`, car le bucket par défaut pourrait alors lister, servir et supprimer ses fichiers.

L'image crée `/storage` pour l'utilisateur non privilégié `node` sous lequel elle s'exécute, c'est pourquoi le volume se place à cet endroit. Un volume monté là où l'image n'a pas de répertoire appartiendra à root, et chaque téléversement échouera avec `EACCES`. Le fichier compose généré par `rebase init` le monte de cette manière.

### Le stockage nécessite un modèle de contrôle d'accès

Une fois qu'un bucket **est** configuré, le runtime **refuse de démarrer en production** tant que le déploiement ne précise pas comment les objets sont protégés. Le stockage n'est pas soumis à la sécurité au niveau des lignes (RLS) et ses clés partagent un espace de noms plat unique ; sans règle, la seule chose séparant les fichiers de deux utilisateurs est le caractère imprévisible des clés — ce que `GET /storage/list?prefix=` anéantit. L'une quelconque de ces solutions satisfait cette exigence :

- un **hook `storageAuthorize`** (ou `storagePolicies`) dans la configuration de votre projet, ce qui constitue la vraie solution et ce que le scaffold fournit dans `config/storage.ts` — aucune variable d'environnement ne peut exprimer « cet utilisateur peut lire cette clé » ;
- **`STORAGE_PUBLIC_READ=true`**, pour un bucket qui fait véritablement office de CDN public en lecture seule ;
- **`STORAGE_ALLOW_ANY_AUTHENTICATED=true`**, pour une application mono-tenant où chaque compte connecté est autorisé à accéder à tous les fichiers.

Hors production, cette même condition déclenche un avertissement explicite plutôt qu'un refus, il s'agit donc d'une erreur de démarrage que vous rencontrerez lors du déploiement plutôt que sur votre machine locale. C'est délibéré : la défaillance qu'elle remplace est silencieuse.

Définissez également `MFA_ENCRYPTION_KEY` si vous utilisez TOTP. Sans cela, les secrets d'authentification stockés sont chiffrés avec `JWT_SECRET` — ainsi, renouveler ce secret déconnecte tout le monde *et* rend chaque appareil enregistré indéchiffrable.

## Autres plateformes

Le runtime est un conteneur standard qui écoute sur `$PORT`, donc tout système capable d'exécuter des conteneurs fonctionne. Deux points essentiels à respecter partout :

1. Le bundle doit être présent dans `/bundle` (ou à l'endroit désigné par `REBASE_BUNDLE`), avec ses dépendances installées à côté — voir [Dépendances](#dépendances).
2. Définissez `CORS_ORIGINS`, `JWT_SECRET` et `DATABASE_URL`. Le runtime refuse de démarrer en production sans ces variables plutôt que de deviner.

### Fly.io

```toml
[build]
  dockerfile = "Dockerfile"   # FROM rebasepro/server:0.28.2 + COPY dist-bundle /bundle

[http_service]
  internal_port = 8080

[[http_service.checks]]
  path = "/livez"
```

Utilisez la méthode de l'image dérivée ci-dessus afin que le bundle soit livré avec l'application, puis exécutez `fly deploy`.

### Railway / Render

Pointez le service vers l'image dérivée, configurez les variables d'environnement, et définissez le chemin du health check sur `/livez`.

### Un simple VPS

```bash
npm install -g @rebasepro/server @rebasepro/server-postgres
rebase-server /srv/myapp/dist-bundle
```

`rebase-server --help` liste les variables qu'il lit. Sous systemd — les deux lignes `REBASE_ADMIN_*` nécessitent la version 0.18 ou ultérieure ; en 0.17.3, le premier compte à s'inscrire devient administrateur à la place :

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

`NODE_ENV=production` n'est pas décoratif. Sans cette variable, le processus s'exécute en mode développement : il autorise les origines localhost, sert la spécification OpenAPI et **laisse la fenêtre du premier administrateur ouverte** — ainsi, le premier inconnu à trouver le formulaire d'inscription devient administrateur. Les deux lignes `REBASE_ADMIN_*` remplacent cette fenêtre ; voir [Your first admin](/docs/getting-started/deployment/#your-first-admin).

`ALLOW_LOCALHOST_IN_PRODUCTION=true` est présent parce que la base de données se trouve sur la même machine. En production, le runtime refuse toute variable pointant vers localhost — dans un conteneur, le loopback désigne le conteneur lui-même, cette adresse est donc toujours une erreur — et cette ligne lui indique que cette adresse est intentionnelle. Supprimez-la lorsque la base de données s'exécute ailleurs.

Préférez `EnvironmentFile=/etc/rebase.env` avec le fichier en mode 0600 plutôt que des lignes `Environment=` pour les secrets : un fichier de service systemd (unit file) est lisible par tous, et `systemctl show` affiche toutes les valeurs de `Environment=`.

## Pool de connexions

Le runtime conserve un pool restreint et persistant et n'a pas besoin de pooler. En revanche, tout le reste qui communique avec la même base de données et ne peut maintenir une connexion en a besoin : une fonction serverless, un script planifié, un outil de BI, un worker de file d'attente qui monte à cinquante instances. Le paramètre `max_connections` de Postgres est une limite stricte se situant dans les bas centaines et chaque connexion est un *processus*, de sorte qu'une montée en charge (fan-out) de fonctions lambda l'épuise bien avant que la base de données ne soit saturée.

Le fichier compose fournit un service `pgbouncer` pour ce trafic, associé à un profil pour qu'un déploiement n'ayant pas de tels appelants ne fasse pas tourner un processus inutile :

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

L'authentification client est générée à partir de `DATABASE_URL` au démarrage, de sorte que le mot de passe n'est pas saisi deux fois. Le pooler s'authentifie auprès de Postgres avec `scram-sha-256`, que Postgres 18 conserve — la valeur par défaut `md5` de l'image fait échouer la connexion au *serveur* avec `FATAL: server login failed: wrong password type`, ce qui ressemble à un mauvais mot de passe alors que ce n'en est pas un.

Veillez à ce que la somme des `PGBOUNCER_POOL_SIZE` de tous les poolers reste nettement inférieure au `max_connections` de la base de données — le runtime puise dans le même quota.

### Ce que change le pooling de transactions

Un client mutualisé détient une connexion au serveur pendant la durée d'une transaction puis la libère, ce qui permet à 500 clients de partager 20 connexions. Trois mécanismes cessent de fonctionner via ce port, et Rebase utilise chacun d'entre eux — c'est précisément pourquoi le runtime se connecte directement et que ce port est réservé aux autres appelants :

- **`LISTEN`/`NOTIFY`.** Le temps réel (Realtime) repose dessus, et un écouteur nécessite une connexion qui survit à une transaction. `LISTEN` est *accepté* par le pooler — il répond à `LISTEN`, puis aucune notification n'arrive jamais.
- **L'état de session :** `SET` (contrairement à `SET LOCAL`), les verrous applicatifs (advisory locks) maintenus entre les instructions, les curseurs `WITH HOLD`, les tables temporaires. La transaction suivante peut atterrir sur une connexion serveur différente, qui ne verra rien de tout cela. Ces deux cas échouent de la même façon trompeuse : avec un seul client inactif, l'état persiste généralement, cela fonctionne donc pendant vos tests et cesse de fonctionner sous la charge concurrente pour laquelle vous avez justement introduit le pooler.
- **Les requêtes préparées au niveau du protocole (prepared statements).** La plupart des pilotes peuvent être configurés pour ne pas les utiliser — node-postgres ne les utilise pas par défaut ; asyncpg requiert `statement_cache_size=0`.

`SET LOCAL` est limité à la transaction et fonctionne, ce qui sert à définir la sécurité au niveau des lignes — la RLS se comporte donc de manière identique via le port mutualisé.

Laissez le profil désactivé si rien en dehors du runtime ne se connecte à votre base de données. Un port inutilisé représente une surface d'attaque.

## Vérifications d'état (Health checks)

| Chemin | Usage |
| --- | --- |
| `/livez` | Liveness. Répond à « ce processus est-il vivant » sans interroger la base de données. |
| `/health` | Readiness. Effectue un aller-retour avec la base de données et indique la latence. |

Pointez les sondes de vivacité (liveness probes) vers `/livez`. Une sonde de vivacité sur `/health` redémarrerait un processus en parfaite santé lors d'une brève saute d'humeur de la base de données, ce qui est l'exact inverse de son objectif.

## Métriques

```bash
REBASE_METRICS=true
REBASE_METRICS_TOKEN=<random string>
```

Expose les métriques Prometheus sur `/metrics` : nombres de requêtes et histogrammes de latence ventilés par composant d'API (data, auth, storage, functions) et par collection, ainsi que des jauges relatives au processus. Sans token, le point de terminaison est accessible à toute personne pouvant joindre le port ; définissez-en donc un à moins qu'il ne se trouve sur un réseau privé.

`rebase_db_pool_wait_ms` est un histogramme du temps pendant lequel chaque requête a attendu une connexion du pool de base de données, ouverture d'une connexion comprise, étiqueté par clé de source de données (`source="(default)"` dans un projet sans sources de données déclarées). Un pool sain maintient cette valeur proche de zéro. Une traîne qui augmente avec le trafic indique que les requêtes font la queue pour obtenir des connexions — le plus souvent retenues par des callbacks d'écriture attendant une opération lente ; voir [A callback holds a connection](/docs/collections/context-data-api/#a-callback-holds-a-connection).

La base de données elle-même, par source de données :

| Métrique | Ce qu'elle dit |
|----------|----------------|
| `rebase_db_pool_total`, `_idle`, `_waiting` | Les connexions de chaque pool, étiquetées `pool="primary"`, `"read"` (la réplique) ou `"session"` (le pool direct de la console SQL derrière un pooler). `waiting` au-dessus de zéro longtemps signifie un pool trop petit pour sa charge. |
| `rebase_db_connection_errors_total` | Requêtes répondues 503 faute de connexion, par `code` : `53300` / `53400` (le serveur n'a plus de connexions), `pool_exhausted`, `connect_timeout`, `unreachable`. |
| `rebase_db_connections` | Connexions clientes sur le serveur, par `state`, face à `rebase_db_max_connections`. |
| `rebase_db_size_bytes` | La taille de la base. |
| `rebase_db_replica_lag_seconds` | Le retard de `DATABASE_READ_URL` sur la primaire. |

Les quatre dernières sont échantillonnées toutes les 30 secondes sur la propre connexion de l'instance, si bien qu'un scrape ne devient jamais une requête.

`rebase_realtime_*` indique pour chaque instance les sockets ouverts, les canaux et les trames envoyées au bus de canaux ou retenues : voir [Seeing what the bus does](/docs/backend/realtime-transports/#seeing-what-the-bus-does).

## En-têtes de sécurité

Chaque réponse contient `X-Frame-Options: SAMEORIGIN`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin` et `Strict-Transport-Security: max-age=15552000` (180 jours). L'en-tête HSTS omet `includeSubDomains` : cela indiquerait aux navigateurs de refuser le HTTP standard sur tous les sous-domaines de votre domaine, y compris ceux avec lesquels ce serveur n'a rien à voir, et un navigateur conserve cette consigne pendant toute la durée spécifiée par l'en-tête.
Définissez `REBASE_HSTS_INCLUDE_SUBDOMAINS=true` lorsque chaque sous-domaine fonctionne exclusivement en HTTPS ; jusqu'à la version 0.23 incluse, l'en-tête incluait systématiquement `includeSubDomains`.

`strict-origin-when-cross-origin` est le comportement par défaut des navigateurs : une requête vers un autre site transmet votre origine et jamais le chemin ou les paramètres de requête de la page. Ce n'est pas `no-referrer` car les vérifications d'origine ont besoin de l'origine — le bouton de connexion Google la compare aux origines JavaScript autorisées du client OAuth, et avec `no-referrer` il répondait « The given origin is not allowed for the given client ID » sur toutes les applications, peu importe ce que le client autorisait. Une réponse qui définit sa propre politique la conserve (la page de consentement MCP envoie `no-referrer`) ; une page nécessitant une politique plus stricte peut l'indiquer avec `<meta name="referrer" content="no-referrer">`. `X-Frame-Options` fonctionne de la même manière : `SAMEORIGIN` à moins que la réponse ne définisse la sienne, comme le fait la page de consentement MCP avec `DENY`.

Les applications statiques — l'administration du CMS et tout frontend servi par le bundle — portent également l'en-tête `Content-Security-Policy: frame-ancestors 'self'; object-src 'none'; base-uri 'self'`. Cela détermine qui peut intégrer l'application dans une iframe, exclut les plugins et verrouille `<base>` sur votre origine, sans rien restreindre d'autre, de sorte que les scripts inline, les workers et la connexion tierce continuent de fonctionner. Une réponse qui définit sa propre politique la conserve. Pour une configuration plus stricte, appliquez la politique sur le reverse proxy en amont.

## Plusieurs instances

Un seul conteneur constitue la configuration par défaut et ne nécessite rien de plus. Avant qu'un second réplica ne reçoive du trafic — ou qu'un déploiement progressif n'en exécute deux côte à côte —, consultez [Running more than one instance](/docs/deployment/multiple-instances/) : les limites de débit, les canaux de diffusion (broadcast), les fichiers locaux, les téléversements avec reprise et le cache d'images fonctionnent par processus jusqu'à ce qu'un paramètre les partage.

## Connexion de Claude

Une seule commande ajoute ce serveur au [Rebase connector](/docs/ai/rebase-connector/), le connecteur MCP unique qui accède à tous vos projets depuis Claude :

```bash
rebase cloud connect https://your-app.com
```

Définissez les deux variables qu'elle affiche sur ce serveur et redémarrez-le. Le serveur doit exécuter Rebase 0.28.1 ou une version ultérieure et répondre en https sur une adresse publique. Rien d'autre ne change : il ne détient aucun secret, et il accorde au connecteur les mêmes droits que Studio.

## Exécuter des fonctions dans leur propre processus

Tout ce qui précède décrit un conteneur unique servant l'intégralité du projet, ce qui est la structure idéale pour la quasi-totalité des déploiements. Lorsqu'une fonction personnalisée ne doit plus concurrencer l'API de données sur la boucle d'événements (event loop) — ou doit pouvoir évoluer à l'échelle (scale), redémarrer et échouer de manière autonome —, la même image et le même bundle peuvent être démarrés sous forme de plusieurs processus coopératifs. Voir [Split processes](/docs/deployment/split-processes/).

## Mise à niveau

```yaml
image: rebasepro/server:0.28.2
```

Redémarrez. Votre bundle reste inchangé. Au sein d'une même version majeure du contrat de runtime, un bundle validé continue de fonctionner — voir [Compatibility](/docs/architecture/runtime-and-bundles/#compatibility).
