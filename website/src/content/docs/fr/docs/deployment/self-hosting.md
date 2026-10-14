---
sourceHash: e66387578eabf2dd
title: Auto-hébergement
sidebar_label: Auto-hébergement
description: Exécutez Rebase n'importe où avec l'image runtime officielle et le bundle de votre projet — Docker Compose, Fly, Railway ou un simple VPS.
---

## Aperçu

Auto-héberger Rebase implique d'exécuter deux choses : une base de données Postgres et l'image officielle `rebasepro/server` dans laquelle le bundle de votre projet est monté.

Il n'y a **aucune image applicative à construire**. Votre projet se déplace sous la forme d'un bundle, le runtime est publié, et mettre à jour Rebase revient à changer un tag plutôt qu'à reconstruire une image. Consultez [Runtime et bundles](/docs/architecture/runtime-and-bundles/) pour comprendre les raisons de cette séparation.

## Docker Compose

**Si votre projet a été créé à partir de `rebase init`, utilisez son propre `docker-compose.yml`.**
Il se trouve dans votre dépôt, `init` y a renseigné ses secrets, son premier compte administrateur ainsi que sa version de runtime épinglée, et il s'agit du fichier décrit dans [Déploiement](/docs/getting-started/deployment/#docker-compose-recommended) :

```bash
rebase build
docker compose up -d
```

Le reste de cette page traite du même déploiement sans structure préexistante derrière — le projet de quelqu'un d'autre, un bundle généré dans une CI, ou les deux éléments que le fichier généré omet délibérément : un pooler de connexions et les configurations en processus scindés.
Celui-ci se trouve dans le dépôt, à l'adresse
[`infra/docker/docker-compose.selfhost.yml`](https://github.com/rebasepro/rebase/blob/main/infra/docker/docker-compose.selfhost.yml).
Utilisez-le plutôt que de copier un extrait de cette page : les deux fichiers sont démarrés par les tests d'acceptation du projet à chaque push, aucun ne peut donc dériver de ce qui fonctionne réellement.

Les deux concordent sur chaque variable d'environnement à l'exception du mot de passe de la base de données, et cela parce que chacun est conçu pour son propre générateur : celui-ci lit `POSTGRES_PASSWORD`, généré par `quickstart.sh` ; le fichier généré lit `DATABASE_PASSWORD`, que `rebase init` intègre également dans la variable `DATABASE_URL` qu'il écrit dans votre `.env`.

```bash
rebase build                    # produces ./dist-bundle
./infra/docker/quickstart.sh    # writes infra/docker/.env if absent, then brings it up
```

`quickstart.sh` est une commande unique effectuant deux actions évidentes et affichant les deux. La forme détaillée, si vous préférez maîtriser chaque étape :

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

Trois secrets, une information concrète et le compte avec lequel vous vous connectez :

- **`POSTGRES_PASSWORD`** — le mot de passe de la base de données. Le modifier plus tard implique de le changer également dans le volume, choisissez-le donc une bonne fois pour toutes.
- **`JWT_SECRET`** — signe chaque session. Sa rotation déconnecte tout le monde.
- **`REBASE_SERVICE_KEY`** — l'identifiant qui contourne la sécurité au niveau des lignes pour les appels de serveur à serveur. Traitez-le comme un mot de passe root : toute entité le détenant peut lire l'intégralité des lignes.
- **`CORS_ORIGINS`** — les origines depuis lesquelles votre frontend est servi, séparées par des virgules. Ce n'est pas un secret, et ce n'est pas optionnel : le runtime refuse de démarrer en production sans cette variable plutôt que de deviner, car une API qui devine ses origines autorisées finit par autoriser la mauvaise.
- **`REBASE_ADMIN_EMAIL`** / **`REBASE_ADMIN_PASSWORD`** — le premier administrateur. Une nouvelle base de données n'a aucun utilisateur, et en dehors de la production, la politique d'inscription accepte la première inscription et la promeut administrateur — sinon, une base de données vide est une impasse, car l'initialisation d'un administrateur nécessite un appelant déjà connecté. Dès lors que cette stack répond sur un nom d'hôte, cette commodité devient une situation de concurrence que l'opérateur peut perdre ; en production, cette fenêtre est donc fermée et le compte est défini ici à la place. Le runtime le crée une seule fois, pendant que la table des utilisateurs est vide, et n'effectue aucune action lors des démarrages suivants.

Chacun des trois secrets doit comporter au moins 32 caractères, et le mot de passe administrateur au moins 12. Utilisez une adresse dont le domaine contient un point : `POST /auth/login` analyse son corps avec `z.string().email()`, donc `admin@localhost` créerait un compte pour ensuite rejeter chaque tentative d'utilisation. Le fichier compose déclare ces six variables avec `${VAR:?…}`, de sorte qu'une variable manquante arrête la stack avec un message indiquant son nom plutôt que de démarrer une configuration incomplète — et l'auto-inscription est désactivée par défaut (`DISABLE_SELF_REGISTRATION`, valeur par défaut `true`), évitant ainsi toute prise de contrôle non désirée.

Connectez-vous avec ces identifiants et modifiez le mot de passe : ils sont stockés en clair dans un fichier sur l'hôte.

## Dépendances

`rebase build` **installe par défaut les dépendances de votre projet dans le bundle**, de sorte que `dist-bundle` arrive avec un dossier `node_modules` et un fichier `package-lock.json` aux côtés de son `package.json`. Un bundle intégrant ses dépendances démarre en cinq secondes environ.

Comme elles sont déjà présentes, vous pouvez monter le bundle en lecture seule — une bonne pratique, car un hook compromis ne pourra alors pas réécrire le code qui s'exécutera après le prochain redémarrage :

```yaml
    volumes:
      - ./dist-bundle:/bundle:ro
```

`rebase build --no-vendor` permet de désactiver cela et produit un bundle qui installe ses dépendances au premier démarrage, ce qui prend 40 à 60 secondes par démarrage et nécessite que le point de montage soit accessible en écriture.

Pour un déploiement réel, préférez intégrer les deux dans une image, ce qui fige également avec précision ce qui s'exécute :

```dockerfile
FROM rebasepro/server:0.25.0
COPY dist-bundle /bundle
```

## Création du schéma

**Le runtime crée les tables manquantes au démarrage, y compris celles de vos collections.**
`REBASE_MIGRATE_ON_BOOT` a pour valeur par défaut `ensure`, qui est additif sur l'ensemble du schéma : il crée les tables, colonnes et types enum manquants, et applique leur sécurité au niveau des lignes. Un premier démarrage sur une base de données vide commence à servir vos collections, sans étape distincte requise.

Ce que `ensure` ne fait délibérément jamais, c'est modifier ce qui existe déjà. Il ne modifie pas le type d'une colonne, ne supprime ni table ni colonne, et ne modifie pas les libellés d'un enum existant — car le redémarrage d'un conteneur ne doit pas pouvoir remodeler un schéma en tant qu'effet secondaire d'un déploiement.

Il reste donc utile d'exécuter `rebase db push` pour ce que le démarrage laisse de côté — toute modification qui n'est pas purement additive : une colonne renommée, un type restreint, un champ supprimé.

```bash
rebase db push
```

Exécutez-le depuis une copie locale du code ou une tâche de CI, pointant vers la base de données du déploiement. Il effectue d'abord un test à blanc (dry run) de la modification, refuse les changements destructifs sans confirmation explicite, et peut effectuer une sauvegarde avant d'appliquer. La base de données expose un port dans le fichier compose afin que cette commande puisse l'atteindre depuis l'hôte ; supprimez ce mappage une fois le schéma en place si la base de données ne doit pas être accessible de l'extérieur.

`REBASE_MIGRATE_ON_BOOT` accepte `ensure` et `none`, et rien d'autre — l'image **refuse de démarrer** avec `push`, pour la raison mentionnée ci-dessus.

## Stockage de fichiers

Le stockage est **désactivé** tant qu'aucun bucket n'est configuré, et c'est intentionnel : l'alternative par défaut serait le système de fichiers du conteneur, qui perdrait silencieusement chaque fichier téléversé au prochain redémarrage. Les téléversements sont rejetés avec l'erreur `501 STORAGE_NOT_CONFIGURED` jusqu'à ce que vous en configuriez un.

Pour un bucket, définissez `STORAGE_TYPE=s3` (ou `gcs`) ainsi que son bucket et ses identifiants — le fichier compose liste les variables, en commentaire.

Pour un disque local, ce qui n'est approprié que lorsque le chemin correspond à un vrai volume persistant au-delà du conteneur :

```yaml
      STORAGE_TYPE: local
      # Each declared bucket gets a directory beside this one, bucket("media")
      # /storage/uploads__media, so the volume goes on their parent.
      STORAGE_PATH: /storage/uploads
      FORCE_LOCAL_STORAGE: "true"
    volumes:
      - storage:/storage
```

`FORCE_LOCAL_STORAGE` n'est pas optionnel dans ce cas : en production, un backend `local` est ignoré plutôt qu'enregistré, car l'alternative consisterait à accepter des téléversements dans un système de fichiers sur le point d'être détruit. Cette variable permet d'affirmer que le point de montage est durable.

Montez le volume **au-dessus** de `STORAGE_PATH`, et non directement dessus. `STORAGE_PATH` est le répertoire du bucket par défaut, et chaque bucket déclaré dans `config/resources.ts` obtient le sien à côté, `<STORAGE_PATH>__<key>`. Un volume monté directement sur `STORAGE_PATH` ne contient que le bucket par défaut. Tous les autres buckets écriront sur le système de fichiers du conteneur et perdront leurs fichiers lors de la recréation du conteneur. `STORAGE_PATH__MEDIA` permet de déplacer un bucket ailleurs sur le volume. Il ne peut pas le déplacer à l'intérieur du répertoire d'un autre bucket, comme `/storage/uploads/media`, car le bucket par défaut listerait, servirait et supprimerait alors ses fichiers.

L'image crée
`/storage` pour l'utilisateur non privilégié `node` sous lequel elle s'exécute, c'est pourquoi le volume y est placé. Un volume monté à un endroit où l'image n'a pas de répertoire appartient à root, et chaque téléversement échoue avec `EACCES`. Le fichier compose généré par `rebase init` le monte de cette manière.

### Le stockage nécessite un modèle de contrôle d'accès

Dès lors qu'un bucket **est** configuré, le runtime **refuse de démarrer en production** tant que le déploiement n'indique pas comment les objets sont protégés. Le stockage n'est pas soumis à la sécurité au niveau des lignes et ses clés partagent un espace de noms plat et unique ; ainsi, en l'absence de règle, la seule chose qui sépare les fichiers de deux utilisateurs est l'impossibilité de deviner les clés — ce que `GET /storage/list?prefix=` rend caduc. L'une quelconque de ces solutions permet de satisfaire cette exigence :

- un **hook `storageAuthorize`** (ou `storagePolicies`) dans la configuration de votre projet, ce qui constitue la vraie réponse et ce que le modèle généré fournit dans `config/storage.ts` — aucune variable d'environnement ne peut exprimer « cet utilisateur peut lire cette clé » ;
- **`STORAGE_PUBLIC_READ=true`**, pour un bucket qui fait véritablement office de CDN public en lecture seule ;
- **`STORAGE_ALLOW_ANY_AUTHENTICATED=true`**, pour une application mono-tenant où chaque compte connecté a accès à l'ensemble des fichiers en toute confiance.

Hors production, cette même condition se traduit par un avertissement explicite plutôt qu'un refus ; il s'agit donc d'une erreur au démarrage que vous rencontrerez lors du déploiement plutôt que sur votre machine locale. C'est délibéré : le problème qu'elle remplace est silencieux.

Définissez également `MFA_ENCRYPTION_KEY` si vous utilisez TOTP. Sans cette variable, les secrets d'authentification stockés sont chiffrés avec `JWT_SECRET` — une rotation de celui-ci déconnecterait alors tout le monde *et* rendrait impossible le déchiffrement de chaque appareil enregistré.

## Autres plateformes

Le runtime est un conteneur ordinaire écoutant sur `$PORT`, de sorte que tout ce qui exécute des conteneurs fonctionne. Deux points cruciaux à respecter partout :

1. Le bundle doit être présent dans `/bundle` (ou là où pointe `REBASE_BUNDLE`), avec ses dépendances installées à ses côtés — voir [Dépendances](#dépendances).
2. Définissez `CORS_ORIGINS`, `JWT_SECRET` et `DATABASE_URL`. Le runtime refuse de démarrer en production sans eux plutôt que de deviner.

### Fly.io

```toml
[build]
  image = "rebasepro/server:0.25.0"

[http_service]
  internal_port = 8080

[[http_service.checks]]
  path = "/livez"
```

Utilisez la forme d'image dérivée présentée ci-dessus afin que le bundle soit livré avec l'application, puis exécutez `fly deploy`.

### Railway / Render

Pointez le service vers l'image dérivée, définissez les variables d'environnement, et configurez le chemin du health check sur `/livez`.

### Un simple VPS

```bash
npm install -g @rebasepro/server @rebasepro/server-postgres
rebase-server /srv/myapp/dist-bundle
```

`rebase-server --help` liste les variables qu'il lit. Sous systemd — les trois lignes relatives à l'administrateur sont récentes, et sur la 0.17.3 le premier compte à s'inscrire devient administrateur à la place :

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

`NODE_ENV=production` n'est pas là pour faire joli. Si elle n'est pas définie, le processus s'exécute en mode développement : il reflète les origines localhost, sert la spécification OpenAPI, et **laisse la fenêtre du premier administrateur ouverte** — ainsi, le premier inconnu à trouver le formulaire d'inscription devient administrateur. Les deux lignes `REBASE_ADMIN_*` remplacent cette fenêtre ; voir [Votre premier administrateur](/docs/getting-started/deployment/#your-first-admin).

`ALLOW_LOCALHOST_IN_PRODUCTION=true` est présent car la base de données se trouve sur la même machine. En production, le runtime refuse toute variable pointant vers localhost — dans un conteneur, le loopback désigne le conteneur lui-même, cette adresse est donc toujours une erreur — et cette ligne lui indique que cette adresse est délibérée. Supprimez-la lorsque la base de données s'exécute ailleurs.

Préférez `EnvironmentFile=/etc/rebase.env` avec les permissions du fichier à 0600 plutôt que des lignes `Environment=` pour les secrets : un fichier unit est lisible par tous, et `systemctl show` affiche chaque valeur `Environment=`.

## Pool de connexions

Le runtime maintient un pool restreint et persistant et n'a pas besoin de pooler. Ce qui en a besoin, en revanche, c'est tout le reste qui communique avec la même base de données et ne peut pas maintenir une connexion : une fonction serverless, un script planifié, un outil de BI, un worker de file d'attente qui monte en charge jusqu'à cinquante instances. Le paramètre `max_connections` de Postgres est une limite stricte se situant dans les bas centaines et chaque connexion est un *processus*, de sorte qu'une montée en charge de lambdas l'épuise bien avant que la base de données ne soit saturée.

Le fichier compose inclut un service `pgbouncer` pour ce trafic, associé à un profil afin qu'un déploiement sans de tels appelants n'exécute pas un processus inutile :

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

L'authentification client est générée à partir de `DATABASE_URL` au démarrage, évitant ainsi d'écrire le mot de passe deux fois. Le pooler s'authentifie auprès de Postgres avec `scram-sha-256`, que Postgres 18 stocke — la valeur par défaut `md5` de l'image fait échouer la connexion au *serveur* avec `FATAL: server login failed: wrong password type`, ce qui ressemble à un mauvais mot de passe sans en être un.

Veillez à ce que la somme des `PGBOUNCER_POOL_SIZE` de tous les poolers reste nettement inférieure au `max_connections` de la base de données — le runtime puise dans le même quota.

### Ce que le pooling de transactions change

Un client mis en pool conserve une connexion au serveur pendant la durée d'une transaction puis la libère, ce qui permet à 500 clients de partager 20 connexions. Trois fonctionnalités cessent de fonctionner via ce port, et chacune d'elles est utilisée par Rebase lui-même — c'est précisément la raison pour laquelle le runtime s'y connecte directement et que ce port est réservé aux autres appelants :

- **`LISTEN`/`NOTIFY`.** Le temps réel repose dessus, et un listener a besoin d'une connexion qui survit à une transaction. `LISTEN` est *accepté* par le pooler — il répond `LISTEN`, puis aucune notification n'arrive jamais.
- **État de session** : `SET` (par opposition à `SET LOCAL`), verrous consultatifs (advisory locks) maintenus entre les instructions, curseurs `WITH HOLD`, tables temporaires. La transaction suivante peut atterrir sur une connexion serveur différente, qui ne verra rien de tout cela. Ces deux cas échouent de la même manière déroutante : avec un seul client inactif, l'état est généralement encore là, cela fonctionne donc pendant vos tests et cesse de fonctionner sous la concurrence même pour laquelle vous avez introduit le pooler.
- **Requêtes préparées au niveau du protocole.** La plupart des pilotes peuvent être configurés pour ne pas les utiliser — node-postgres ne le fait pas par défaut ; asyncpg nécessite `statement_cache_size=0`.

`SET LOCAL` est limité à la transaction et fonctionne, ce qui sert à définir la sécurité au niveau des lignes — RLS se comporte donc de manière identique à travers le port mutualisé.

Laissez le profil désactivé si rien en dehors du runtime ne se connecte à votre base de données. Un port inutilisé est une surface d'attaque.

## Health checks

| Path | Utilisation |
| --- | --- |
| `/livez` | Liveness. Répond à la question « ce processus est-il en vie » sans toucher à la base de données. |
| `/health` | Readiness. Effectue un aller-retour avec la base de données et indique la latence. |

Pointez les sondes de liveness vers `/livez`. Une sonde de liveness sur `/health` redémarre un processus parfaitement sain lors d'un bref hoquet de la base de données, ce qui est l'inverse de son objectif.

## Métriques

```bash
REBASE_METRICS=true
REBASE_METRICS_TOKEN=<random string>
```

Expose les métriques Prometheus sur `/metrics` : nombre de requêtes et histogrammes de latence ventilés par surface d'API (data, auth, storage, functions) et par collection, ainsi que des jauges de processus. Sans token, le point de terminaison est accessible en lecture par toute personne pouvant joindre le port ; définissez-en donc un à moins qu'il ne se trouve sur un réseau privé.

`rebase_db_pool_wait_ms` est un histogramme du temps d'attente de chaque requête pour obtenir une connexion du pool de base de données, ouverture de connexion comprise, étiqueté par clé de source de données (`source="(default)"` dans un projet qui ne déclare aucune source de données). Un pool sain maintient cette valeur proche de zéro. Une queue de distribution qui s'allonge avec le trafic signifie que les requêtes font la queue pour obtenir des connexions — le plus souvent retenues par des callbacks d'écriture qui attendent une opération lente ; voir [Un callback retient une connexion](/docs/collections/context-data-api/#a-callback-holds-a-connection).

## En-têtes de sécurité

Chaque réponse inclut `X-Frame-Options: SAMEORIGIN`, `X-Content-Type-Options: nosniff`, une `Referrer-Policy` et `Strict-Transport-Security: max-age=15552000` (180 jours). L'en-tête HSTS omet `includeSubDomains` : cela indiquerait aux navigateurs de refuser le HTTP standard sur tous les sous-domaines de votre domaine, y compris ceux avec lesquels ce serveur n'a aucun lien, et un navigateur conserve cette directive pendant toute la durée spécifiée par l'en-tête.
Définissez `REBASE_HSTS_INCLUDE_SUBDOMAINS=true` lorsque chaque sous-domaine est exclusivement en HTTPS ; jusqu'à la version 0.23 incluse, l'en-tête incluait systématiquement `includeSubDomains`.

Les applications statiques — l'administration du CMS et tout frontend servi par le bundle — comportent également `Content-Security-Policy: frame-ancestors 'self'; object-src 'none'; base-uri 'self'`. Cette directive détermine qui peut intégrer l'application dans une frame, exclut les plugins et verrouille `<base>` sur votre origine, sans rien restreindre d'autre, de sorte que les scripts inline, les workers et l'authentification tierce continuent de fonctionner. Une réponse définissant sa propre politique la conserve. Pour toute restriction supplémentaire, appliquez la politique sur le reverse proxy situé en amont.

## Plusieurs instances

Un seul conteneur constitue la configuration par défaut et ne requiert rien de plus. Avant qu'un second réplica ne reçoive du trafic — ou qu'un déploiement progressif n'en exécute deux côte à côte — consultez [Exécuter plusieurs instances](/docs/deployment/multiple-instances/) : les limitations de débit, les canaux de diffusion, les fichiers locaux, les téléversements reprenables et le cache d'images s'appliquent par processus tant qu'un paramètre ne les mutualise pas.

## Exécuter des fonctions dans leur propre processus

Tout ce qui précède correspond à un conteneur unique servant l'intégralité du projet, ce qui représente la configuration adaptée à la quasi-totalité des déploiements. Lorsqu'une fonction personnalisée ne doit plus rivaliser avec l'API de données pour la boucle d'événements — ou doit pouvoir évoluer à l'échelle, redémarrer et échouer de manière autonome —, la même image et le même bundle peuvent être lancés sous la forme de plusieurs processus coopérants. Voir [Processus scindés](/docs/deployment/split-processes/).

## Mise à jour

```yaml
image: rebasepro/server:0.25.0
```

Redémarrez. Votre bundle reste inchangé. Au sein d'une version majeure du contrat de runtime, un bundle validé continue de fonctionner — voir [Compatibilité](/docs/architecture/runtime-and-bundles/#compatibility).
