---
sourceHash: 2728510dde81de28
title: Auto-hébergement
sidebar_label: Auto-hébergement
description: Exécutez Rebase n'importe où avec l'image runtime officielle et le bundle de votre projet — Docker Compose, Fly, Railway ou un simple VPS.
---

## Vue d'ensemble

Auto-héberger Rebase implique d'exécuter deux éléments : une base de données Postgres, et l'image officielle `rebasepro/server` avec le bundle de votre projet monté à l'intérieur.

Il n'y a **aucune image applicative à construire**. Votre projet voyage sous forme de bundle, le runtime est publié, et la mise à niveau de Rebase consiste en un simple changement de tag plutôt qu'une recompilation. Consultez [Runtime et bundles](/docs/architecture/runtime-and-bundles/) pour comprendre les raisons de cette séparation.

## Docker Compose

**Si votre projet provient de `rebase init`, utilisez son propre `docker-compose.yml`.**
Il se trouve dans votre dépôt, `init` y a renseigné ses secrets, son premier compte administrateur et sa version de runtime verrouillée, et c'est le fichier décrit par
[Déploiement](/docs/getting-started/deployment/#docker-compose-recommended) :

```bash
rebase build
docker compose up -d
```

Le reste de cette page présente le même déploiement sans projet généré au préalable — le projet de quelqu'un d'autre, un bundle construit en CI, ou les deux éléments que le fichier généré omet délibérément : un pooler de connexions et les configurations en processus séparés. Ce fichier-là se trouve dans le dépôt, à l'adresse
[`infra/docker/docker-compose.selfhost.yml`](https://github.com/rebasepro/rebase/blob/main/infra/docker/docker-compose.selfhost.yml).
Utilisez-le plutôt que de copier un extrait de cette page : les deux fichiers sont démarrés par le portail d'acceptation du projet à chaque push, aucun ne peut donc diverger de ce qui fonctionne réellement.

Les deux s'accordent sur chaque variable d'environnement, sauf le mot de passe de la base de données, et cela parce que chacun est écrit pour son propre générateur : celui-ci lit `POSTGRES_PASSWORD`, généré par `quickstart.sh` ; celui généré lit `DATABASE_PASSWORD`, que `rebase init` intègre également dans le `DATABASE_URL` qu'il écrit dans votre `.env`.

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

Trois secrets, une information de configuration, et le compte avec lequel vous vous connectez :

- **`POSTGRES_PASSWORD`** — le mot de passe de la base de données. Le modifier plus tard implique de le modifier aussi dans le volume, choisissez-le donc dès le départ.
- **`JWT_SECRET`** — signe chaque session. Le renouveler déconnecte tout le monde.
- **`REBASE_SERVICE_KEY`** — l'identifiant qui contourne la sécurité au niveau des lignes (RLS) pour les appels de serveur à serveur. Traitez-le comme un mot de passe root : tout ce qui le détient peut lire chaque ligne.
- **`CORS_ORIGINS`** — les origines depuis lesquelles votre frontend est servi, séparées par des virgules. Pas un secret, et non facultatif : le runtime refuse de démarrer en production sans cette valeur au lieu de deviner, car une API qui devine ses origines autorisées finit par autoriser la mauvaise.
- **`REBASE_ADMIN_EMAIL`** / **`REBASE_ADMIN_PASSWORD`** — le premier administrateur. Une base de données fraîche ne comporte aucun utilisateur, et en dehors de la production, la politique d'inscription accepte la première inscription et la promeut administrateur — sinon une base de données vide est une impasse, car initialiser un administrateur nécessite un appelant déjà connecté. Dès lors que cette stack répond sur un nom d'hôte, cette commodité devient une course que l'opérateur peut perdre ; en production, cette fenêtre est donc fermée et le compte est nommé ici. Le runtime le crée une seule fois, tant que la table des utilisateurs est vide, et ne fait plus rien à chaque démarrage ultérieur.

Chacun des trois secrets doit comporter au moins 32 caractères, et le mot de passe administrateur au moins 12. Utilisez une adresse avec un point dans son domaine : `POST /auth/login` valide son corps avec `z.string().email()`, ainsi `admin@localhost` initialiserait un compte puis rejetterait chaque tentative d'utilisation. Le fichier compose déclare les six avec `${VAR:?…}`, de sorte qu'une variable manquante arrête la stack avec un message la nommant plutôt que de lancer une configuration incomplète — et l'auto-inscription est désactivée par défaut (`DISABLE_SELF_REGISTRATION`, valeur par défaut `true`), évitant ainsi toute prise de contrôle non autorisée.

Connectez-vous avec ces identifiants et changez le mot de passe : ils se trouvent en clair dans un fichier sur l'hôte.

## Dépendances

Par défaut, `rebase build` **installe les dépendances de votre projet dans le bundle**, de sorte que `dist-bundle` arrive avec un `node_modules` et un `package-lock.json` aux côtés de son `package.json`. Un bundle prêt à l'emploi (vendored) démarre en cinq secondes environ.

Puisqu'elles sont déjà présentes, vous pouvez monter le bundle en lecture seule — ce qui est recommandé, car un hook compromis ne pourra alors pas réécrire le code exécuté après le redémarrage suivant :

```yaml
    volumes:
      - ./dist-bundle:/bundle:ro
```

`rebase build --no-vendor` désactive cette option et produit un bundle qui installe ses dépendances au premier démarrage, ce qui prend 40 à 60 secondes par démarrage et nécessite que le montage soit accessible en écriture.

Pour un véritable déploiement, préférez intégrer les deux dans une image, ce qui fige également avec exactitude ce qui s'exécute :

```dockerfile
FROM rebasepro/server:0.20.0
COPY dist-bundle /bundle
```

## Création du schéma

**Le runtime crée les tables manquantes au démarrage, y compris celles de vos collections.**
`REBASE_MIGRATE_ON_BOOT` est défini par défaut sur `ensure`, ce qui est additif sur l'ensemble du schéma : il crée les tables, colonnes et types enum manquants, et applique leur sécurité au niveau des lignes (RLS). Un premier démarrage sur une base de données vide commence à servir vos collections, sans étape distincte.

Ce que `ensure` ne fait délibérément jamais, c'est modifier ce qui existe déjà. Il ne modifie pas le type d'une colonne, ne supprime pas de table ni de colonne, et ne modifie pas les libellés d'un enum existant — car le redémarrage d'un conteneur ne doit pas pouvoir remodeler un schéma comme effet secondaire d'un déploiement.

L'exécution de `rebase db push` reste donc utile pour les deux éléments que le démarrage laisse intacts :

```bash
rebase db push
```

- **Le RLS des tables de jointure** pour les relations plusieurs-à-plusieurs.
- **Toute modification qui n'est pas purement additive** — une colonne renommée, un type restreint, un champ supprimé.

Exécutez-le depuis une copie locale ou un job de CI, pointé vers la base de données du déploiement. Il teste d'abord les modifications à blanc (dry-run), refuse les changements destructeurs sans confirmation explicite, et peut effectuer une sauvegarde avant application. La base de données expose un port dans le fichier compose afin que cette commande puisse l'atteindre depuis l'hôte ; supprimez ce mappage une fois le schéma en place si la base de données ne doit pas être accessible de l'extérieur.

`REBASE_MIGRATE_ON_BOOT` accepte `ensure` et `none`, et rien d'autre — l'image **refuse de démarrer** avec `push`, pour la raison mentionnée ci-dessus.

## Stockage de fichiers

Le stockage est **désactivé** tant qu'aucun bucket n'est configuré, et c'est délibéré : l'alternative par défaut étant le système de fichiers du conteneur, qui perdrait silencieusement chaque fichier téléversé au redémarrage suivant. Les téléversements sont refusés avec `501 STORAGE_NOT_CONFIGURED` jusqu'à ce que vous en configuriez un.

Pour un bucket, définissez `STORAGE_TYPE=s3` (ou `gcs`) ainsi que son bucket et ses identifiants — le fichier compose liste les variables, commentées.

Pour le disque local, ce qui n'est approprié que lorsque le chemin est un volume réel qui survit au conteneur :

```yaml
      STORAGE_TYPE: local
      STORAGE_PATH: /data/uploads
      FORCE_LOCAL_STORAGE: "true"
    volumes:
      - uploads:/data/uploads
```

`FORCE_LOCAL_STORAGE` n'est pas facultatif ici : en production, un backend `local` est rejeté plutôt qu'enregistré, car l'alternative consisterait à accepter des téléversements dans un système de fichiers sur le point d'être détruit. Cette variable permet d'affirmer que le montage est durable.

### Le stockage nécessite un modèle de contrôle d'accès

Une fois qu'un bucket **est** configuré, le runtime **refuse de démarrer en production** tant que le déploiement ne précise pas comment les objets sont protégés. Le stockage n'est pas soumis à la sécurité au niveau des lignes et ses clés partagent un espace de noms plat ; sans règle, la seule barrière séparant les fichiers de deux utilisateurs réside dans le fait de ne pas pouvoir deviner les clés — ce que `GET /storage/list?prefix=` rend caduc. L'un de ces éléments permet d'y satisfaire :

- un **hook `storageAuthorize`** (ou `storagePolicies`) dans la configuration de votre projet, ce qui représente la vraie solution et ce que fournit le modèle dans `config/storage.ts` — aucune variable d'environnement ne peut exprimer "cet utilisateur peut lire cette clé" ;
- **`STORAGE_PUBLIC_READ=true`**, pour un bucket qui fait réellement office de CDN public en lecture seule ;
- **`STORAGE_ALLOW_ANY_AUTHENTICATED=true`**, pour une application mono-tenant où chaque compte connecté a accès à l'ensemble des fichiers.

En dehors de la production, cette même condition déclenche un avertissement explicite plutôt qu'un refus de démarrage ; c'est donc un échec de lancement que vous rencontrerez lors du déploiement plutôt que sur votre machine de développement. C'est délibéré : la défaillance qu'il remplace surviendrait sinon silencieusement.

Définissez également `MFA_ENCRYPTION_KEY` si vous utilisez TOTP. Sans cela, les secrets d'authentification enregistrés sont chiffrés avec `JWT_SECRET` — ainsi, le renouvellement de cette variable déconnecterait tout le monde *et* rendrait chaque appareil enregistré indéchiffrable.

## Autres plateformes

Le runtime est un conteneur ordinaire qui écoute sur `$PORT` ; tout ce qui exécute des conteneurs convient donc. Deux éléments à vérifier partout :

1. Le bundle doit être présent à l'emplacement `/bundle` (ou là où pointe `REBASE_BUNDLE`), avec ses dépendances installées à ses côtés — voir [Dépendances](#dépendances).
2. Définissez `CORS_ORIGINS`, `JWT_SECRET` et `DATABASE_URL`. Le runtime refuse de démarrer en production sans eux plutôt que d'essayer de deviner.

### Fly.io

```toml
[build]
  image = "rebasepro/server:0.20.0"

[http_service]
  internal_port = 8080

[[http_service.checks]]
  path = "/livez"
```

Utilisez le format d'image dérivée ci-dessus afin que le bundle soit distribué avec l'application, puis faites `fly deploy`.

### Railway / Render

Pointez le service vers l'image dérivée, configurez les variables d'environnement et définissez le chemin du contrôle de santé (health check) sur `/livez`.

### Un simple VPS

```bash
npm install -g @rebasepro/server @rebasepro/server-postgres
rebase-server /srv/myapp/dist-bundle
```

`rebase-server --help` liste les variables qu'il lit. Sous systemd — les trois lignes d'administration sont récentes, et sur la version 0.17.3, le premier compte à s'inscrire devenait administrateur à la place :

```ini title="/etc/systemd/system/rebase.service"
[Service]
ExecStart=/usr/bin/rebase-server /srv/myapp/dist-bundle
Restart=always
Environment=NODE_ENV=production
Environment=DATABASE_URL=postgresql://rebase:...@127.0.0.1:5432/rebase
Environment=JWT_SECRET=...
Environment=REBASE_SERVICE_KEY=...
Environment=CORS_ORIGINS=https://app.example.com
Environment=DISABLE_SELF_REGISTRATION=true
Environment=REBASE_ADMIN_EMAIL=you@example.com
Environment=REBASE_ADMIN_PASSWORD=...
```

`NODE_ENV=production` n'est pas décoratif. Sans lui, le processus s'exécute en mode développement : il reflète les origines localhost, sert la spécification OpenAPI, et **laisse la fenêtre du premier administrateur ouverte** — permettant au premier inconnu trouvant le formulaire d'inscription de devenir administrateur. Les deux lignes `REBASE_ADMIN_*` remplacent cette fenêtre ; voir [Votre premier administrateur](/docs/getting-started/deployment/#your-first-admin).

Préférez `EnvironmentFile=/etc/rebase.env` avec le fichier en mode 0600 plutôt que des lignes `Environment=` pour les secrets : un fichier d'unité est lisible par tous, et `systemctl show` affiche chaque valeur de `Environment=`.

## Pool de connexions

Le runtime maintient un pool de connexions réduit et persistant, et ne nécessite pas de pooler. Ce qui en a besoin, en revanche, c'est tout ce qui communique avec la même base de données sans pouvoir maintenir une connexion ouverte : une fonction serverless, un script planifié, un outil de BI, un worker de file d'attente qui passe à cinquante instances. Le paramètre `max_connections` de Postgres est une limite stricte se situant dans les quelques centaines, et chaque connexion est un *processus* ; une vague d'exécutions serverless (lambda fan-out) l'épuise donc bien avant que la base de données ne soit surchargée.

Le fichier compose fournit un service `pgbouncer` pour ce trafic, associé à un profil pour qu'un déploiement n'ayant pas de tels besoins n'exécute pas un processus inutile :

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

L'authentification client est générée à partir de `DATABASE_URL` au démarrage, afin que le mot de passe ne soit pas écrit deux fois. Le pooler s'authentifie auprès de Postgres avec `scram-sha-256`, ce que Postgres 18 stocke — la valeur par défaut `md5` de l'image fait échouer la connexion au *serveur* avec `FATAL: server login failed: wrong password type`, ce qui ressemble à une erreur de mot de passe mais n'en est pas une.

Conservez la somme de `PGBOUNCER_POOL_SIZE` de tous vos poolers bien en deçà du `max_connections` de la base de données — le runtime puise dans le même quota.

### Ce que change le pooling de transactions

Un client mutualisé détient une connexion serveur pendant la durée d'une transaction, puis la libère, ce qui permet à 500 clients de partager 20 connexions. Trois fonctionnalités cessent de fonctionner à travers ce port, et chacune est utilisée par Rebase lui-même — c'est exactement pour cela que le runtime se connecte directement et que ce port est réservé aux autres appelants :

- **`LISTEN`/`NOTIFY`.** Le temps réel repose dessus, et un écouteur a besoin d'une connexion qui survit à une transaction. `LISTEN` est *accepté* par le pooler — il répond `LISTEN`, puis aucune notification n'arrive jamais.
- **L'état de session** : `SET` (contrairement à `SET LOCAL`), les verrous consultatifs (advisory locks) maintenus entre plusieurs instructions, les curseurs `WITH HOLD`, les tables temporaires. La transaction suivante peut atterrir sur une connexion serveur différente, qui ne verra rien de tout cela. Ces deux cas échouent de la même manière trompeuse : avec un seul client inactif, l'état persiste généralement, cela fonctionne donc pendant vos tests et s'arrête de fonctionner sous la charge concurrente pour laquelle vous avez introduit le pooler.
- **Les requêtes préparées au niveau du protocole.** La plupart des pilotes peuvent être configurés pour ne pas les utiliser — node-postgres ne le fait pas par défaut ; asyncpg a besoin de `statement_cache_size=0`.

`SET LOCAL` a une portée limitée à la transaction et fonctionne correctement, or c'est avec lui que la sécurité au niveau des lignes est configurée — ainsi, le RLS se comporte de manière identique via le port du pooler.

Laissez le profil désactivé si rien en dehors du runtime ne se connecte à votre base de données. Un port inutilisé représente une surface d'attaque inutile.

## Contrôles de santé (Health checks)

| Chemin | Utilisation |
| --- | --- |
| `/livez` | Liveness. Répond à "ce processus est-il vivant" sans solliciter la base de données. |
| `/health` | Readiness. Effectue un aller-retour avec la base de données et rapporte la latence. |

Pointez les sondes de vivacité (liveness probes) vers `/livez`. Une sonde de vivacité sur `/health` redémarrerait un processus parfaitement sain lors d'une brève saute d'humeur de la base de données, ce qui est le contraire de son rôle.

## Métriques

```bash
REBASE_METRICS=true
REBASE_METRICS_TOKEN=<random string>
```

Expose les métriques Prometheus sur `/metrics` : nombre de requêtes et histogrammes de latence ventilés par surface d'API (données, auth, stockage, fonctions) et collection, ainsi que des jauges de processus. Sans jeton, le point de terminaison est lisible par quiconque peut atteindre le port, définissez-en donc un à moins d'être sur un réseau privé.

## Exécuter des fonctions dans leur propre processus

Tout ce qui précède utilise un conteneur unique pour servir l'ensemble du projet, ce qui représente la configuration adaptée à presque tous les déploiements. Lorsqu'une fonction personnalisée ne doit plus entrer en concurrence avec l'API de données pour la boucle d'événements — ou doit pouvoir évoluer, redémarrer et échouer de manière isolée — la même image et le même bundle peuvent être lancés sous la forme de plusieurs processus coopérants. Voir [Processus séparés](/docs/deployment/split-processes/).

## Mise à niveau

```yaml
image: rebasepro/server:0.20.0
```

Redémarrez. Votre bundle reste inchangé. Au sein d'une même version majeure du contrat de runtime, un bundle qui a été validé continue de fonctionner — voir [Compatibilité](/docs/architecture/runtime-and-bundles/#compatibility).

---
