---
sourceHash: c5827fa03f8801fd
title: Auto-hébergement
sidebar_label: Auto-hébergement
description: Exécutez Rebase n'importe où avec l'image runtime officielle et le bundle de votre projet — Docker Compose, Fly, Railway ou un simple VPS.
---

## Vue d'ensemble

Auto-héberger Rebase implique d'exécuter deux éléments : une base de données Postgres et l'image officielle `rebasepro/server` avec le bundle de votre projet monté à l'intérieur.

Il n'y a **aucune image applicative à construire**. Votre projet voyage sous forme de bundle, le runtime est publié, et la mise à niveau de Rebase s'effectue via un simple changement de tag plutôt qu'une recompilation. Consultez [Runtime et bundles](/docs/architecture/runtime-and-bundles/) pour comprendre pourquoi cette séparation existe.

## Docker Compose

**Si votre projet provient de `rebase init`, utilisez son propre `docker-compose.yml`.**
Il se trouve dans votre dépôt, `init` a renseigné ses secrets, son premier compte administrateur et sa version de runtime verrouillée, et c'est le fichier décrit par [Déploiement](/docs/getting-started/deployment/#docker-compose-recommended) :

```bash
rebase build
docker compose up -d
```

Le reste de cette page présente le même déploiement sans structure préexistante — le projet de quelqu'un d'autre, un bundle généré dans une CI, ou les deux aspects que le fichier généré omet délibérément : un pooler de connexions et les configurations en processus séparés. Ce fichier vit dans le dépôt, à l'emplacement [`infra/docker/docker-compose.selfhost.yml`](https://github.com/rebasepro/rebase/blob/main/infra/docker/docker-compose.selfhost.yml).
Utilisez-le plutôt que de copier un extrait de cette page : les deux fichiers sont démarrés par la porte d'acceptation du projet à chaque push, aucun ne peut donc diverger de ce qui fonctionne réellement.

Les deux s'accordent sur chaque variable d'environnement à l'exception du mot de passe de la base de données, car chacun est écrit pour son propre générateur : celui-ci lit `POSTGRES_PASSWORD`, généré par `quickstart.sh` ; le fichier généré lit `DATABASE_PASSWORD`, que `rebase init` intègre également dans la variable `DATABASE_URL` écrite dans votre `.env`.

```bash
rebase build                    # produces ./dist-bundle
./infra/docker/quickstart.sh    # writes infra/docker/.env if absent, then brings it up
```

`quickstart.sh` est une commande unique faisant deux choses évidentes et affichant les deux. La version détaillée, si vous préférez maîtriser chaque étape :

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

Trois secrets, une information, et le compte avec lequel vous vous connectez :

- **`POSTGRES_PASSWORD`** — le mot de passe de la base de données. Le modifier plus tard implique de le modifier également dans le volume, choisissez-le donc une bonne fois pour toutes.
- **`JWT_SECRET`** — signe chaque session. Le renouveler déconnecte tout le monde.
- **`REBASE_SERVICE_KEY`** — l'identifiant qui contourne la sécurité au niveau des lignes (RLS) pour les appels de serveur à serveur. Traitez-le comme un mot de passe root : tout ce qui le détient peut lire chaque ligne.
- **`CORS_ORIGINS`** — les origines depuis lesquelles votre frontend est servi, séparées par des virgules. Ce n'est pas un secret, et ce n'est pas facultatif : le runtime refuse de démarrer en production sans cela au lieu de deviner, car une API qui devine ses origines autorisées finit par autoriser la mauvaise.
- **`REBASE_ADMIN_EMAIL`** / **`REBASE_ADMIN_PASSWORD`** — le premier administrateur. Une base de données vierge ne comporte aucun utilisateur, et en dehors de la production, la politique d'inscription accepte la première inscription et la promeut administrateur — sinon une base de données vide est une impasse, car l'initialisation d'un administrateur nécessite un appelant déjà connecté. Dès lors que cette stack répond sur un nom d'hôte, cette facilité devient une course critique que l'opérateur peut perdre ; en production, la fenêtre est donc fermée et le compte est défini ici. Le runtime le crée une seule fois, pendant que la table des utilisateurs est vide, et ne fait plus rien à chaque démarrage ultérieur.

Chacun des trois secrets doit comporter au moins 32 caractères, et le mot de passe d'administration au moins 12. Utilisez une adresse avec un point dans son nom de domaine : `POST /auth/login` analyse son corps avec `z.string().email()`, donc `admin@localhost` initialiserait un compte puis rejetterait chaque tentative de connexion. Le fichier compose déclare les six avec `${VAR:?…}`, de sorte qu'une variable manquante arrête la stack avec un message la nommant explicitement au lieu de démarrer un système à moitié configuré — et l'auto-inscription est désactivée par défaut (`DISABLE_SELF_REGISTRATION`, valeur par défaut `true`), ne laissant ainsi rien d'inoccupé à revendiquer.

Connectez-vous avec ces identifiants et changez le mot de passe : ils sont stockés dans un fichier sur l'hôte.

## Dépendances

`rebase build` **installe par défaut les dépendances de votre projet dans le bundle**, de sorte que `dist-bundle` arrive avec un dossier `node_modules` et un fichier `package-lock.json` aux côtés de son `package.json`. Un bundle prêt à l'emploi démarre en environ cinq secondes.

Comme elles sont déjà présentes, vous pouvez monter le bundle en lecture seule — ce qui est recommandé, car un hook compromis ne pourra alors pas réécrire le code exécuté après le prochain redémarrage :

```yaml
    volumes:
      - ./dist-bundle:/bundle:ro
```

`rebase build --no-vendor` désactive ce comportement et produit un bundle qui installe ses dépendances au premier démarrage, ce qui prend 40 à 60 secondes par démarrage et nécessite que le point de montage soit accessible en écriture.

Pour un déploiement réel, préférez intégrer les deux éléments dans une image, ce qui permet également de figer exactement ce qui est exécuté :

```dockerfile
FROM rebasepro/server:0.22.0
COPY dist-bundle /bundle
```

## Création du schéma

**Le runtime crée les tables manquantes au démarrage, y compris celles de vos collections.**
`REBASE_MIGRATE_ON_BOOT` est défini par défaut sur `ensure`, ce qui est additif sur l'ensemble du schéma : il crée les tables, les colonnes et les types enum manquants, et applique leur sécurité au niveau des lignes (RLS). Un premier démarrage sur une base de données vide la rend opérationnelle pour servir vos collections, sans étape distincte.

Ce que `ensure` ne fait délibérément jamais, c'est modifier ce qui existe déjà. Il ne change pas le type d'une colonne, ne supprime aucune table ni colonne, et ne modifie pas les libellés d'un enum existant — car un redémarrage de conteneur ne doit pas pouvoir remodeler un schéma en tant qu'effet secondaire d'un déploiement.

Il reste donc pertinent d'exécuter `rebase db push` pour les deux aspects que le démarrage laisse de côté :

```bash
rebase db push
```

- **Le RLS des tables de jonction** pour les relations plusieurs-à-plusieurs.
- **Toute modification qui n'est pas purement additive** — une colonne renommée, un type restreint, un champ supprimé.

Exécutez cette commande depuis une copie locale ou un job de CI, pointé vers la base de données du déploiement. Elle effectue d'abord une simulation (dry-run) des modifications, refuse les changements destructifs sans confirmation explicite, et peut effectuer une sauvegarde avant application. La base de données expose un port dans le fichier compose afin que cette commande puisse l'atteindre depuis l'hôte ; supprimez ce mappage de port une fois le schéma en place si la base de données ne doit pas être accessible de l'extérieur.

`REBASE_MIGRATE_ON_BOOT` accepte `ensure` et `none`, et rien d'autre — l'image **refuse de démarrer** avec `push`, pour la raison expliquée ci-dessus.

## Stockage de fichiers

Le stockage est **désactivé** à moins qu'un bucket ne soit configuré, et c'est intentionnel : l'alternative par défaut serait le système de fichiers du conteneur, qui perdrait silencieusement chaque fichier téléversé au redémarrage suivant. Les téléversements sont rejetés avec `501 STORAGE_NOT_CONFIGURED` jusqu'à ce que vous en configuriez un.

Pour un bucket, définissez `STORAGE_TYPE=s3` (ou `gcs`) ainsi que son bucket et ses identifiants — le fichier compose liste ces variables, commentées.

Pour le disque local, ce qui ne convient que lorsque le chemin est un volume réel qui survit au conteneur :

```yaml
      STORAGE_TYPE: local
      STORAGE_PATH: /data/uploads
      FORCE_LOCAL_STORAGE: "true"
    volumes:
      - uploads:/data/uploads
```

`FORCE_LOCAL_STORAGE` n'est pas facultatif ici : en production, un backend `local` est rejeté plutôt qu'enregistré, car l'alternative conduirait à des téléversements réussis dans un système de fichiers sur le point d'être détruit. Cette variable sert à déclarer que le montage est persistant.

### Le stockage nécessite un modèle de contrôle d'accès

Une fois qu'un bucket **est** configuré, le runtime **refuse de démarrer en production** tant que le déploiement ne précise pas comment les objets sont protégés. Le stockage n'est pas régi par la sécurité au niveau des lignes et ses clés partagent un espace de noms unique, de sorte que sans règle, la seule chose séparant les fichiers de deux utilisateurs est l'impossibilité de deviner les clés — ce que `GET /storage/list?prefix=` met en échec. L'une des conditions suivantes suffit à satisfaire cette exigence :

- un **hook `storageAuthorize`** (ou `storagePolicies`) dans la configuration de votre projet, ce qui représente la véritable solution et ce que fournit le scaffold dans `config/storage.ts` — aucune variable d'environnement ne pouvant exprimer "cet utilisateur peut lire cette clé" ;
- **`STORAGE_PUBLIC_READ=true`**, pour un bucket qui fait réellement office de CDN public en lecture seule ;
- **`STORAGE_ALLOW_ANY_AUTHENTICATED=true`**, pour une application mono-tenant où chaque compte connecté dispose de l'accès à chaque fichier.

En dehors de la production, la même condition génère un avertissement visible plutôt qu'un refus de démarrage ; c'est donc un échec que vous rencontrerez lors du déploiement plutôt que sur votre machine de développement. C'est délibéré : le problème qu'il remplace survenait silencieusement.

Définissez également `MFA_ENCRYPTION_KEY` si vous utilisez TOTP. Sans cette variable, les secrets d'authentification stockés sont chiffrés avec `JWT_SECRET` — ainsi, renouveler ce dernier déconnecte tout le monde *et* rend impossible le déchiffrement de chaque appareil enregistré.

## Autres plateformes

Le runtime est un conteneur standard écoutant sur `$PORT`, donc tout environnement exécutant des conteneurs fonctionne. Deux points essentiels à respecter partout :

1. Le bundle doit être présent dans `/bundle` (ou là où pointe `REBASE_BUNDLE`), avec ses dépendances installées à ses côtés — voir [Dépendances](#dépendances).
2. Définissez `CORS_ORIGINS`, `JWT_SECRET` et `DATABASE_URL`. Le runtime refuse de démarrer en production sans eux plutôt que de faire des suppositions.

### Fly.io

```toml
[build]
  image = "rebasepro/server:0.22.0"

[http_service]
  internal_port = 8080

[[http_service.checks]]
  path = "/livez"
```

Utilisez la méthode d'image dérivée mentionnée plus haut pour que le bundle soit embarqué avec l'application, puis lancez `fly deploy`.

### Railway / Render

Pointez le service vers l'image dérivée, configurez les variables d'environnement, et définissez le chemin du health check sur `/livez`.

### Un simple VPS

```bash
npm install -g @rebasepro/server @rebasepro/server-postgres
rebase-server /srv/myapp/dist-bundle
```

`rebase-server --help` liste les variables qu'il lit. Sous systemd — les trois lignes d'administration sont récentes ; sur la version 0.17.3, le premier compte enregistré devient l'administrateur :

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

`NODE_ENV=production` n'est pas là pour faire joli. Sans cette variable, le processus tourne en mode développement : il reflète les origines localhost, sert la spécification OpenAPI, et **laisse la fenêtre du premier administrateur ouverte** — le premier inconnu à trouver le formulaire d'inscription deviendrait ainsi l'administrateur. Les deux lignes `REBASE_ADMIN_*` remplacent cette fenêtre ; voir [Votre premier administrateur](/docs/getting-started/deployment/#your-first-admin).

Préférez `EnvironmentFile=/etc/rebase.env` avec des permissions à 0600 sur le fichier plutôt que des lignes `Environment=` pour les secrets : un fichier d'unité systemd est lisible par tous, et `systemctl show` affiche chaque valeur `Environment=`.

## Pool de connexions

Le runtime conserve un pool restreint et persistant et n'a pas besoin d'un pooler. En revanche, tout le reste qui dialogue avec la même base de données sans pouvoir maintenir une connexion en a besoin : une fonction serverless, un script planifié, un outil de BI, un worker de file d'attente qui monte à cinquante instances. La directive `max_connections` de Postgres est une limite stricte se situant dans les quelques centaines et chaque connexion est un *processus*, si bien qu'une montée en charge de lambdas l'épuise bien avant que la base de données ne soit saturée.

Le fichier compose inclut un service `pgbouncer` pour ce trafic, placé derrière un profil afin qu'un déploiement sans ces besoins n'exécute pas un processus inutile :

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

L'authentification des clients est générée à partir de `DATABASE_URL` au démarrage, évitant d'écrire le mot de passe deux fois. Le pooler s'authentifie auprès de Postgres avec `scram-sha-256`, géré par Postgres 18 — la valeur par défaut `md5` de l'image fait échouer la connexion au *serveur* avec `FATAL: server login failed: wrong password type`, ce qui ressemble à un mauvais mot de passe alors qu'il n'en est rien.

Veillez à ce que la somme des `PGBOUNCER_POOL_SIZE` sur l'ensemble des poolers reste bien inférieure au `max_connections` de la base de données — le runtime puise dans le même quota.

### Ce que le pooling de transactions change

Un client mutualisé détient une connexion serveur pendant la durée d'une transaction puis la restitue, ce qui permet à 500 clients de partager 20 connexions. Trois fonctionnalités cessent de fonctionner à travers ce port, et chacune est utilisée par Rebase lui-même — c'est exactement pour cela que le runtime se connecte directement et que ce port est réservé aux autres appelants :

- **`LISTEN`/`NOTIFY`.** Le temps réel repose dessus, et un écouteur a besoin d'une connexion qui dépasse la durée d'une transaction. `LISTEN` est *accepté* par le pooler — il répond `LISTEN`, puis aucune notification n'arrive jamais.
- **L'état de session** : `SET` (contrairement à `SET LOCAL`), les verrous consultatifs (advisory locks) conservés entre les instructions, les curseurs `WITH HOLD`, les tables temporaires. La transaction suivante peut atterrir sur une connexion serveur différente, qui ne verra rien de tout cela. Ces deux cas échouent de la même manière trompeuse : avec un seul client inactif, l'état persiste généralement, de sorte que tout fonctionne pendant vos tests et s'effondre sous la charge pour laquelle vous avez installé le pooler.
- **Les requêtes préparées au niveau du protocole (prepared statements).** La plupart des pilotes peuvent être configurés pour ne pas les utiliser — node-postgres ne le fait pas par défaut ; asyncpg a besoin de `statement_cache_size=0`.

`SET LOCAL` est limité à la transaction et fonctionne, ce qui permet de définir la sécurité au niveau des lignes (RLS) — le RLS se comporte donc de manière identique via le port du pooler.

Laissez le profil désactivé si rien en dehors du runtime ne se connecte à votre base de données. Un port inutilisé représente une surface d'attaque superflue.

## Bilan de santé (Health checks)

| Chemin | Utilisation |
| --- | --- |
| `/livez` | Liveness. Répond "ce processus est-il vivant" sans interroger la base de données. |
| `/health` | Readiness. Effectue un aller-retour vers la base de données et rapporte la latence. |

Pointez les sondes de liveness vers `/livez`. Une sonde de liveness sur `/health` redémarrerait un processus parfaitement sain lors d'un léger hoquet de la base de données, ce qui est le contraire de sa fonction.

## Métriques

```bash
REBASE_METRICS=true
REBASE_METRICS_TOKEN=<random string>
```

Expose les métriques Prometheus sur `/metrics` : nombre de requêtes et histogrammes de latence ventilés par surface d'API (data, auth, storage, functions) et collection, ainsi que des jauges de processus. Sans token, le point de terminaison est accessible à toute personne pouvant joindre le port ; définissez-en donc un à moins qu'il ne soit sur un réseau privé.

## Exécuter des fonctions dans leur propre processus

Tout ce qui précède utilise un conteneur unique pour servir l'intégralité du projet, ce qui correspond à la configuration appropriée pour la quasi-totalité des déploiements. Lorsqu'une fonction personnalisée ne doit plus entrer en concurrence avec l'API de données pour la boucle d'événements — ou doit pouvoir évoluer, redémarrer et échouer de manière isolée — la même image et le même bundle peuvent être démarrés sous forme de plusieurs processus coopérants. Consultez [Processus séparés](/docs/deployment/split-processes/).

## Mise à niveau

```yaml
image: rebasepro/server:0.22.0
```

Redémarrez. Votre bundle reste inchangé. Au sein d'une même version majeure du contrat de runtime, un bundle validé continue de fonctionner — voir [Compatibilité](/docs/architecture/runtime-and-bundles/#compatibility).
