---
sourceHash: aa153f3ab4c80526
title: Auto-hébergement
sidebar_label: Auto-hébergement
description: Exécutez Rebase n'importe où avec l'image runtime officielle et le bundle de votre projet — Docker Compose, Fly, Railway ou un simple VPS.
---

## Aperçu

L'auto-hébergement de Rebase implique l'exécution de deux éléments : une base de données Postgres, et l'image officielle `rebasepro/server` avec le bundle de votre projet monté à l'intérieur.

Il n'y a **aucune image applicative à construire**. Votre projet voyage sous forme de bundle, le runtime est publié, et la mise à niveau de Rebase est un changement de tag plutôt qu'une reconstruction. Consultez [Runtime et bundles](/docs/architecture/runtime-and-bundles/) pour comprendre les raisons de cette séparation.

## Docker Compose

**Si votre projet provient de `rebase init`, utilisez son propre fichier `docker-compose.yml`.**
Il se trouve dans votre dépôt, `init` a renseigné ses secrets, son premier compte administrateur et sa version de runtime verrouillée, et c'est le fichier décrit dans [Déploiement](/docs/getting-started/deployment/#docker-compose-recommended) :

```bash
rebase build
docker compose up -d
```

Le reste de cette page présente le même déploiement sans structure préconfigurée — le projet de quelqu'un d'autre, un bundle construit en CI, ou les deux éléments que le fichier généré omet délibérément : un pooler de connexions et les configurations en processus séparés. Celui-ci se trouve dans le dépôt, à l'emplacement [`infra/docker/docker-compose.selfhost.yml`](https://github.com/rebasepro/rebase/blob/main/infra/docker/docker-compose.selfhost.yml). Utilisez-le plutôt que de copier un extrait de cette page : les deux fichiers sont démarrés par la porte d'acceptation du projet à chaque push, aucun des deux ne peut donc diverger de ce qui fonctionne réellement.

Les deux s'accordent sur chaque variable d'environnement à l'exception du mot de passe de la base de données, et cela s'explique par le fait que chacun est conçu pour son propre créateur : celui-ci lit `POSTGRES_PASSWORD`, généré par `quickstart.sh` ; celui qui est généré lit `DATABASE_PASSWORD`, que `rebase init` intègre également dans la `DATABASE_URL` qu'il écrit dans votre `.env`.

```bash
rebase build                    # produces ./dist-bundle
./infra/docker/quickstart.sh    # writes infra/docker/.env if absent, then brings it up
```

`quickstart.sh` est une commande unique effectuant deux actions évidentes et affichant les deux. La version longue, si vous préférez contrôler chaque étape :

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

Trois secrets, un fait, et le compte avec lequel vous vous connectez :

- **`POSTGRES_PASSWORD`** — le mot de passe de la base de données. Le modifier ultérieurement implique également de le modifier dans le volume, choisissez-le donc une bonne fois pour toutes.
- **`JWT_SECRET`** — signe chaque session. Sa rotation déconnecte tout le monde.
- **`REBASE_SERVICE_KEY`** — l'identifiant qui contourne la sécurité au niveau des lignes (RLS) pour les appels de serveur à serveur. Traitez-le comme un mot de passe root : tout ce qui le détient peut lire chaque ligne.
- **`CORS_ORIGINS`** — les origines depuis lesquelles votre frontend est servi, séparées par des virgules. Ce n'est pas un secret, et ce n'est pas optionnel : le runtime refuse de démarrer en production sans cette variable plutôt que de deviner, car une API qui devine ses origines autorisées finit par autoriser la mauvaise.
- **`REBASE_ADMIN_EMAIL`** / **`REBASE_ADMIN_PASSWORD`** — le premier administrateur. Une base de données vierge ne contient aucun utilisateur, et en dehors de la production, la politique d'inscription accepte la première inscription et la promeut administrateur — sinon une base de données vide est une impasse, car initialiser un administrateur nécessite un appelant déjà connecté. Dès l'instant où cette stack répond sur un nom d'hôte, cette facilité devient une course que l'opérateur peut perdre ; en production, cette fenêtre est donc fermée et le compte est désigné ici à la place. Le runtime le crée une seule fois, pendant que la table des utilisateurs est vide, et ne fait rien à chaque démarrage ultérieur.

Chacun des trois secrets doit comporter au moins 32 caractères, et le mot de passe administrateur au moins 12 caractères. Utilisez une adresse avec un point dans son domaine : `POST /auth/login` valide son corps avec `z.string().email()`, ainsi `admin@localhost` initialiserait un compte puis refuserait toute tentative d'utilisation. Le fichier compose déclare les six variables avec `${VAR:?…}`, de sorte qu'une variable manquante interrompt la stack avec un message la nommant plutôt que de lancer quelque chose de partiellement configuré — et l'auto-inscription est désactivée par défaut (`DISABLE_SELF_REGISTRATION`, valeur par défaut `true`), évitant ainsi que quoi que ce soit reste à revendiquer.

Connectez-vous avec ces identifiants et changez le mot de passe : ils sont stockés dans un fichier sur l'hôte.

## Dépendances

Par défaut, `rebase build` **installe les dépendances de votre projet dans le bundle**, de sorte que `dist-bundle` est fourni avec un `node_modules` et un `package-lock.json` à côté de son `package.json`. Un bundle prêt à l'emploi démarre en environ cinq secondes.

Puisqu'elles sont déjà présentes, vous pouvez monter le bundle en lecture seule — ce qui est recommandé, car un hook compromis ne pourra alors pas réécrire le code qui s'exécutera après le prochain redémarrage :

```yaml
    volumes:
      - ./dist-bundle:/bundle:ro
```

`rebase build --no-vendor` désactive ce comportement et produit un bundle qui installe plutôt ses dépendances au premier démarrage, ce qui prend 40 à 60 secondes par démarrage et nécessite que le montage soit accessible en écriture.

Pour un véritable déploiement, préférez intégrer les deux dans une image, ce qui fige également exactement ce qui s'exécute :

```dockerfile
FROM rebasepro/server:0.20.0
COPY dist-bundle /bundle
```

## Création du schéma

**Le runtime crée les tables manquantes au démarrage, y compris celles de vos collections.**
`REBASE_MIGRATE_ON_BOOT` est défini par défaut sur `ensure`, ce qui est additif sur l'ensemble du schéma : il crée les tables, les colonnes et les types enum manquants, et applique leur sécurité au niveau des lignes (RLS). Un premier démarrage sur une base de données vide commence à servir vos collections, sans étape supplémentaire.

Ce que `ensure` ne fait délibérément jamais, c'est modifier quoi que ce soit qui existe déjà. Il ne modifie pas le type d'une colonne, ne supprime ni table ni colonne, et ne modifie pas les libellés d'un enum existant — car un redémarrage de conteneur ne doit pas pouvoir remodeler un schéma comme effet de bord d'un déploiement.

Il reste donc pertinent d'exécuter `rebase db push` pour les deux éléments que le démarrage laisse de côté :

```bash
rebase db push
```

- **Le RLS des tables de jonction** pour les relations plusieurs-à-plusieurs.
- **Toute modification qui n'est pas purement additive** — une colonne renommée, un type restreint, un champ supprimé.

Exécutez-le depuis une copie locale du code ou un job CI, pointé vers la base de données du déploiement. Il teste d'abord les modifications à blanc (dry-run), refuse les modifications destructives sans confirmation explicite, et peut effectuer une sauvegarde avant application. La base de données expose un port dans le fichier compose afin que cette commande puisse l'atteindre depuis l'hôte ; supprimez ce mappage une fois le schéma en place si la base de données ne doit pas être accessible depuis l'extérieur.

`REBASE_MIGRATE_ON_BOOT` accepte `ensure` et `none`, et rien d'autre — l'image **refuse de démarrer** sur `push`, pour la raison mentionnée ci-dessus.

## Stockage de fichiers

Le stockage est **désactivé** tant qu'aucun bucket n'est configuré, et c'est délibéré : l'autre option par défaut est le système de fichiers du conteneur, qui perd silencieusement chaque fichier téléversé au redémarrage suivant. Les téléversements sont refusés avec l'erreur `501 STORAGE_NOT_CONFIGURED` jusqu'à ce que vous en configuriez un.

Pour un bucket, définissez `STORAGE_TYPE=s3` (ou `gcs`) ainsi que son bucket et ses identifiants — le fichier compose liste les variables en commentaires.

Pour le disque local, ce qui n'est approprié que lorsque le chemin est un vrai volume qui survit au conteneur :

```yaml
      STORAGE_TYPE: local
      STORAGE_PATH: /data/uploads
      FORCE_LOCAL_STORAGE: "true"
    volumes:
      - uploads:/data/uploads
```

`FORCE_LOCAL_STORAGE` n'est pas optionnel dans ce cas : en production, un backend `local` est rejeté plutôt qu'enregistré, car l'alternative consisterait à accepter des téléversements dans un système de fichiers sur le point d'être détruit. Cette variable est votre façon de confirmer que le montage est persistant.

### Le stockage nécessite un modèle de contrôle d'accès

Dès lors qu'un bucket **est** configuré, le runtime **refuse de démarrer en production** tant que le déploiement n'a pas défini la manière dont les objets sont protégés. Le stockage n'est pas soumis à la sécurité au niveau des lignes (RLS) et ses clés partagent un espace de noms plat unique. Sans règle, la seule chose séparant les fichiers de deux utilisateurs est donc le caractère imprévisible de la clé — ce que `GET /storage/list?prefix=` contourne. N'importe lequel de ces éléments permet de satisfaire cette exigence :

- un **hook `storageAuthorize`** (ou `storagePolicies`) dans la configuration de votre projet, ce qui constitue la vraie réponse et ce que le scaffold fournit dans `config/storage.ts` — aucune variable d'environnement ne peut exprimer « cet utilisateur peut lire cette clé » ;
- **`STORAGE_PUBLIC_READ=true`**, pour un bucket qui fait réellement office de CDN public en lecture seule ;
- **`STORAGE_ALLOW_ANY_AUTHENTICATED=true`**, pour une application mono-tenant où chaque compte connecté est autorisé à accéder à chaque fichier.

Hors production, cette même condition déclenche un avertissement explicite plutôt qu'un refus ; il s'agit donc d'une erreur de démarrage que vous rencontrerez lors du déploiement plutôt que sur votre machine locale. C'est délibéré : la défaillance qu'elle remplace est silencieuse.

Définissez également `MFA_ENCRYPTION_KEY` si vous utilisez TOTP. Sans cette variable, les secrets d'authentification stockés sont chiffrés avec `JWT_SECRET` — leur rotation déconnecte donc tout le monde *et* rend chaque appareil enregistré indéchiffrable.

## Autres plateformes

Le runtime est un conteneur standard qui écoute sur `$PORT`, de sorte que tout système exécutant des conteneurs fonctionne. Deux points à respecter partout :

1. Le bundle doit être présent dans `/bundle` (ou là où pointe `REBASE_BUNDLE`), avec ses dépendances installées à ses côtés — voir [Dépendances](#dépendances).
2. Définissez `CORS_ORIGINS`, `JWT_SECRET` et `DATABASE_URL`. Le runtime refuse de démarrer en production sans eux plutôt que de deviner.

### Fly.io

```toml
[build]
  image = "rebasepro/server:0.20.0"

[http_service]
  internal_port = 8080

[[http_service.checks]]
  path = "/livez"
```

Utilisez la forme d'image dérivée ci-dessus afin que le bundle soit livré avec l'application, puis lancez `fly deploy`.

### Railway / Render

Pointez le service vers l'image dérivée, configurez les variables d'environnement et définissez le chemin du health check sur `/livez`.

### Un simple VPS

```bash
npm install -g @rebasepro/server @rebasepro/server-postgres
rebase-server /srv/myapp/dist-bundle
```

`rebase-server --help` liste les variables qu'il lit. Sous systemd — les trois lignes d'administration sont nouvelles, et sur la version 0.17.3, le premier compte à s'inscrire devient administrateur à la place :

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

`NODE_ENV=production` n'est pas là pour faire joli. Sans cette variable, le processus s'exécute en mode développement : il reflète les origines localhost, sert la spécification OpenAPI et **laisse ouverte la fenêtre du premier administrateur** — ainsi, le premier inconnu à trouver le formulaire d'inscription devient administrateur. Les deux lignes `REBASE_ADMIN_*` remplacent cette fenêtre ; voir [Votre premier administrateur](/docs/getting-started/deployment/#your-first-admin).

Préférez `EnvironmentFile=/etc/rebase.env` avec le fichier en mode 0600 plutôt que des lignes `Environment=` pour les secrets : un fichier unit est lisible par tous, et `systemctl show` affiche chaque valeur `Environment=`.

## Pool de connexions

Le runtime conserve un petit pool persistant et n'a pas besoin de pooler. En revanche, tout ce qui communique avec la même base de données et ne peut pas maintenir une connexion en a besoin : une fonction serverless, un script planifié, un outil de BI, un worker de file d'attente montant à cinquante instances. Le `max_connections` de Postgres est une limite stricte située dans les quelques centaines et chaque connexion est un *processus*, si bien qu'une dispersion (fan-out) de fonctions lambda l'épuise bien avant que la base de données ne soit saturée.

Le fichier compose inclut un service `pgbouncer` pour ce trafic, derrière un profil afin qu'un déploiement sans ces appelants n'exécute pas un processus inutile :

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

L'authentification client est générée à partir de `DATABASE_URL` au démarrage, évitant ainsi d'écrire le mot de passe deux fois. Le pooler s'authentifie auprès de Postgres avec `scram-sha-256`, que Postgres 18 stocke — la valeur par défaut `md5` de l'image fait échouer la connexion au *serveur* avec `FATAL: server login failed: wrong password type`, ce qui ressemble à un mauvais mot de passe alors qu'il n'en est rien.

Maintenez la somme des `PGBOUNCER_POOL_SIZE` sur l'ensemble des poolers largement en dessous du `max_connections` de la base de données — le runtime puise dans le même quota.

### Ce que change le pooling de transactions

Un client poolé conserve une connexion au serveur pendant la durée d'une transaction puis la restitue, ce qui permet à 500 clients de partager 20 connexions. Trois éléments cessent de fonctionner via ce port, et chacun d'eux est utilisé par Rebase lui-même — c'est exactement pourquoi le runtime se connecte directement et que ce port est réservé aux autres appelants :

- **`LISTEN`/`NOTIFY`.** Le temps réel repose dessus, et un écouteur a besoin d'une connexion qui survit à une transaction. `LISTEN` est *accepté* par le pooler — il répond `LISTEN`, puis aucune notification n'arrive jamais.
- **L'état de session** : `SET` (contrairement à `SET LOCAL`), les verrous consultatifs maintenus entre les instructions, les curseurs `WITH HOLD`, les tables temporaires. La transaction suivante peut atterrir sur une connexion serveur différente, qui ne verra rien de tout cela. Ces deux aspects échouent de la même manière trompeuse : avec un seul client inactif, l'état est généralement encore présent, cela fonctionne donc pendant vos tests et cesse de fonctionner sous la concurrence pour laquelle vous avez introduit le pooler.
- **Les requêtes préparées au niveau du protocole.** La plupart des pilotes peuvent être configurés pour ne pas les utiliser — node-postgres ne le fait pas par défaut ; asyncpg a besoin de `statement_cache_size=0`.

`SET LOCAL` a une portée limitée à la transaction et fonctionne, ce qui permet de définir la sécurité au niveau des lignes — RLS se comporte donc de manière identique à travers le port poolé.

Laissez le profil désactivé si rien en dehors du runtime ne se connecte à votre base de données. Un port inutilisé est une surface d'attaque.

## Vérifications de santé

| Chemin | Utilisation |
| --- | --- |
| `/livez` | Liveness. Répond à « ce processus est-il vivant » sans toucher à la base de données. |
| `/health` | Readiness. Effectue un aller-retour avec la base de données et rapporte la latence. |

Pointez les sondes de liveness vers `/livez`. Une sonde de liveness sur `/health` redémarre un processus parfaitement sain lors d'un bref hoquet de la base de données, ce qui est l'exact opposé de son rôle.

## Métriques

```bash
REBASE_METRICS=true
REBASE_METRICS_TOKEN=<random string>
```

Expose les métriques Prometheus sur `/metrics` : nombres de requêtes et histogrammes de latence ventilés par surface d'API (data, auth, storage, functions) et par collection, ainsi que des jauges de processus. Sans token, le point de terminaison est lisible par quiconque peut atteindre le port ; configurez-en un à moins qu'il ne soit sur un réseau privé.

## Exécuter des fonctions dans leur propre processus

Tout ce qui précède correspond à un conteneur unique desservant l'ensemble du projet, ce qui est la configuration adaptée à presque tous les déploiements. Lorsqu'une fonction personnalisée doit cesser de concurrencer l'API de données pour la boucle d'événements — ou doit monter en charge, redémarrer et échouer de manière autonome — la même image et le même bundle peuvent être démarrés sous la forme de plusieurs processus coopérants. Consultez [Processus séparés](/docs/deployment/split-processes/).

## Mise à niveau

```yaml
image: rebasepro/server:0.20.0
```

Redémarrez. Votre bundle reste inchangé. Au sein d'une même version majeure du contrat de runtime, un bundle qui a été validé continue de fonctionner — voir [Compatibilité](/docs/architecture/runtime-and-bundles/#compatibility).

---
