---
sourceHash: caa4e79614f7401e
title: Auto-hébergement
sidebar_label: Auto-hébergement
description: Exécutez Rebase n'importe où avec l'image runtime officielle et le bundle de votre projet — Docker Compose, Fly, Railway ou un simple VPS.
---

## Vue d'ensemble

Auto-héberger Rebase implique d'exécuter deux choses : une base de données Postgres, et l'image officielle `rebasepro/server` avec le bundle de votre projet monté à l'intérieur.

Il n'y a **aucune image applicative à construire**. Votre projet voyage sous forme de bundle, le runtime est publié, et la mise à niveau de Rebase consiste en un simple changement de tag plutôt qu'une reconstruction. Consultez [Runtime and bundles](/docs/architecture/runtime-and-bundles/) pour comprendre les raisons de cette séparation.

## Docker Compose

**Si votre projet provient de `rebase init`, utilisez son propre `docker-compose.yml`.**
Il se trouve dans votre dépôt, `init` a renseigné ses secrets, son premier compte administrateur et sa version de runtime verrouillée, et c'est le fichier décrit dans [Deployment](/docs/getting-started/deployment/#docker-compose-recommended) :

```bash
rebase build
docker compose up -d
```

Le reste de cette page traite du même déploiement sans structure initiale (scaffold) — le projet de quelqu'un d'autre, un bundle généré dans une CI, ou les deux éléments que le fichier généré omet délibérément : un pooler de connexions et les configurations en processus scindés (split-process).
Celui-ci se trouve dans le dépôt, à l'adresse [`infra/docker/docker-compose.selfhost.yml`](https://github.com/rebasepro/rebase/blob/main/infra/docker/docker-compose.selfhost.yml).
Utilisez-le plutôt que de copier un extrait de cette page : les deux fichiers sont démarrés par la propre validation d'acceptation du projet à chaque push, de sorte qu'aucun ne peut diverger de ce qui fonctionne réellement.

Les deux s'accordent sur chaque variable d'environnement à l'exception du mot de passe de la base de données, et cela s'explique par le fait que chacun est conçu pour son propre générateur : celui-ci lit `POSTGRES_PASSWORD`, généré par `quickstart.sh` ; le fichier généré lit `DATABASE_PASSWORD`, que `rebase init` intègre également dans la `DATABASE_URL` qu'il écrit dans votre `.env`.

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

`quickstart.sh` les génère pour vous. Pour rédiger le `.env` vous-même :

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

- **`POSTGRES_PASSWORD`** — le mot de passe de la base de données. Le changer plus tard implique de le modifier également dans le volume, alors choisissez-le une bonne fois pour toutes.
- **`JWT_SECRET`** — signe chaque session. Sa rotation déconnecte tout le monde.
- **`REBASE_SERVICE_KEY`** — l'identifiant qui contourne la sécurité au niveau des lignes (row-level security / RLS) pour les appels de serveur à serveur. Traitez-le comme un mot de passe root : tout ce qui le possède peut lire chaque ligne.
- **`CORS_ORIGINS`** — les origines depuis lesquelles votre frontend est servi, séparées par des virgules. Ce n'est pas un secret, et ce n'est pas optionnel : le runtime refuse de démarrer en production sans cela plutôt que de deviner, car une API qui devine ses origines autorisées finit par autoriser la mauvaise.
- **`REBASE_ADMIN_EMAIL`** / **`REBASE_ADMIN_PASSWORD`** — le premier administrateur. Une base de données vierge n'a pas d'utilisateurs, et hors production, la politique d'inscription accepte la première inscription et la promeut administrateur — sinon une base de données vide est une impasse, car initialiser un administrateur nécessite un appelant déjà connecté. Dès lors que cette stack répond sur un nom d'hôte, cette commodité devient une course que l'opérateur peut perdre ; en production, cette fenêtre est donc fermée et le compte est défini ici à la place. Le runtime le crée une seule fois, lorsque la table des utilisateurs est vide, et ne fait rien à chaque démarrage ultérieur.

`JWT_SECRET` et `REBASE_SERVICE_KEY` doivent chacun comporter au moins 32 caractères, et le mot de passe administrateur au moins 12. Utilisez une adresse comportant un point dans son domaine : `POST /auth/login` analyse son corps avec `z.string().email()`, le runtime refuse donc d'initialiser `admin@localhost` — un compte auquel personne ne pourrait se connecter — et consigne la raison dans les logs. Le fichier compose déclare ces six variables avec `${VAR:?…}`, de sorte qu'une variable manquante arrête la stack avec un message la nommant plutôt que de démarrer un système à moitié configuré — et l'auto-inscription est désactivée par défaut (`DISABLE_SELF_REGISTRATION`, valeur par défaut `true`), évitant ainsi toute prise de contrôle non désirée.

Connectez-vous avec ces identifiants et changez le mot de passe : ils résident dans un fichier sur l'hôte.

## Dépendances

`rebase build` **installe par défaut les dépendances de votre projet dans le bundle**, ainsi `dist-bundle` est fourni avec un `node_modules` et un `package-lock.json` aux côtés de son `package.json`. Un bundle « vendored » démarre en environ cinq secondes.

Puisqu'elles sont déjà présentes, vous pouvez monter le bundle en lecture seule — une bonne pratique, car un hook compromis ne pourra alors pas réécrire le code qui s'exécutera après le prochain redémarrage :

```yaml
    volumes:
      - ./dist-bundle:/bundle:ro
```

`rebase build --no-vendor` désactive ce comportement et produit un bundle qui installe ses dépendances au premier démarrage, ce qui prend 40 à 60 secondes par démarrage et nécessite que le montage soit accessible en écriture.

Pour un vrai déploiement, préférez intégrer les deux directement dans une image, ce qui verrouille également avec exactitude ce qui s'exécute :

```dockerfile
FROM rebasepro/server:0.26.0
COPY dist-bundle /bundle
```

## Création du schéma

**Le runtime crée les tables manquantes au démarrage, y compris celles de vos collections.**
`REBASE_MIGRATE_ON_BOOT` a pour valeur par défaut `ensure`, qui est additif sur l'ensemble du schéma : il crée les tables, colonnes et types enum manquants, et applique leur sécurité au niveau des lignes (RLS). Un premier démarrage sur une base de données vide rend vos collections immédiatement disponibles, sans étape distincte.

Ce que `ensure` ne fait délibérément jamais, c'est modifier ce qui existe déjà. Il ne modifie pas le type d'une colonne, ne supprime ni table ni colonne, et ne modifie pas les libellés d'un enum existant — car le redémarrage d'un conteneur ne doit pas pouvoir remodeler un schéma en tant qu'effet secondaire d'un déploiement.

Il reste donc pertinent d'exécuter `rebase db push` pour tout ce que le démarrage ignore — toute modification qui n'est pas purement additive : une colonne renommée, un type restreint, un champ supprimé.

```bash
rebase db push
```

Exécutez-le depuis une copie de travail ou un job de CI, pointant vers la base de données du déploiement. Il effectue d'abord une simulation (dry-run), refuse les modifications destructives sans confirmation explicite, et peut effectuer une sauvegarde avant application. La base de données expose un port dans le fichier compose afin que cette commande puisse l'atteindre depuis l'hôte ; supprimez ce mappage une fois le schéma en place si la base de données ne doit pas être accessible depuis l'extérieur.

`REBASE_MIGRATE_ON_BOOT` accepte `ensure` et `none`, et rien d'autre — l'image **refuse de démarrer** avec `push`, pour la raison mentionnée ci-dessus.

## Quand seul votre processus de gestion des changements peut modifier la base de données

`REBASE_MIGRATE_ON_BOOT=none` ne touche pas à vos collections. Cela ne laisse pas pour autant la base de données intacte : les tables propres au framework (authentification, clés d'API, tâches, cron) sont toujours créées et maintenues à jour à chaque démarrage. Lorsque la base de données ne doit être modifiée qu'au moyen d'un processus de changement revu et validé, définissez `REBASE_PROVISION=false` sur chaque processus qui dessert le trafic :

| Paramètre | Tables et stratégies de collections | Tables du framework |
|---|---|---|
| par défaut (`REBASE_MIGRATE_ON_BOOT=ensure`) | créées et maintenues à jour au démarrage | créées et maintenues à jour |
| `REBASE_MIGRATE_ON_BOOT=none` | inchangées | créées et maintenues à jour |
| `REBASE_PROVISION=false` | inchangées | inchangées ; les éléments manquants sont listés dans les logs |

Lorsque le provisionnement est désactivé, le runtime ne crée ni ne modifie rien : aucune table, colonne, index, fonction, trigger, stratégie (policy), rôle ou privilège (grant). Cela s'applique au démarrage comme par la suite, y compris pour les tables qu'un processus en service crée habituellement lors de la première utilisation (clés d'idempotence, réservations cron, compteurs partagés de limitation de débit). Il lit ce qui est présent à la place :

- **Tables d'authentification, ou une colonne lue par l'auth, manquantes :** le démarrage est refusé et chacune d'entre elles est listée.
- **Le rôle de requête peut accéder à une table du framework** telle que `rebase.refresh_tokens` ou `rebase.api_keys` : le démarrage est refusé et affiche la commande `REVOKE` à exécuter. Un démarrage avec provisionnement retire ces privilèges de lui-même. Avec le provisionnement désactivé, rien ne le fait.
- **Une table facultative est manquante** (clés d'API, clés d'idempotence, réservations cron, compteurs de limitation de débit, présence, historique des métriques) : cette fonctionnalité est désactivée, et le log indique la table requise.

Les lignes continuent d'évoluer, comme sur n'importe quelle base de données : connexions, sessions, utilisation des clés d'API, clés d'idempotence, réservations cron. Le premier compte administrateur (`REBASE_ADMIN_EMAIL`) est initialisé lors de l'exécution du provisionnement, et non par les processus de service. [Live schema editing](/docs/backend/live-schema-editing) peut toujours valider une modification dans le code source, mais refuse de l'appliquer à la base de données.

### L'exécution du provisionnement

Le schéma provient d'une exécution contrôlée par votre processus de gestion des changements. Utilisez la même image et le même bundle que le serveur, avec `REBASE_PROVISION_ONLY=true`, connecté avec un rôle disposant des droits de création dans la base de données. `REBASE_PROVISION_SQL_OUT` conserve chaque modification de schéma effectuée par l'exécution sous la forme d'un script SQL :

```bash
docker run --rm \
  -e DATABASE_URL="postgres://admin:…@scratch-db:5432/app" \
  -e JWT_SECRET="…" \
  -e REBASE_PROVISION_ONLY=true \
  -e REBASE_PROVISION_SQL_OUT=/out/rebase.sql \
  -v "$PWD/out:/out" \
  -v "$PWD/dist-bundle:/bundle" \
  "rebasepro/server:$REBASE_VERSION"
```

Le script est un enregistrement, pas un plan : chaque instruction qu'il contient a été exécutée, dans l'ordre, et avec succès. Enregistré sur une base de données vide, il représente l'intégralité du schéma requis par la version. Enregistré sur une copie restaurée de la production, il correspond exactement à la mise à niveau. Les lignes écrites lors de l'exécution n'y figurent pas. Examinez-le, puis appliquez-le à la véritable base de données :

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f out/rebase.sql
```

Répétez cette opération pour chaque mise à niveau de Rebase, avant le déploiement progressif des processus de service. Une version peut ajouter une table ou une colonne, et un processus qui n'a pas le droit d'en créer une la signalera comme manquante plutôt que de la créer.

Un serveur que vous construisez vous-même suit la même règle : `initializeRebaseBackend` lit `REBASE_PROVISION`, et `createRebaseBackend` accepte [`provision: false`](/docs/backend/custom-server#what-creating-a-backend-may-change-provision).

## Stockage de fichiers

Le stockage est **désactivé** sauf si un bucket est configuré, et c'est intentionnel : l'alternative par défaut serait le système de fichiers du conteneur, qui perdrait silencieusement chaque fichier téléversé au prochain redémarrage. Les téléversements sont refusés avec l'erreur `501 STORAGE_NOT_CONFIGURED` jusqu'à ce que vous en configuriez un.

Pour un bucket, définissez `STORAGE_TYPE=s3` (ou `gcs`) ainsi que son bucket et ses identifiants — le fichier compose liste les variables en commentaire. `gcs` charge `@google-cloud/storage`, qui n'est pas fourni dans l'image officielle ; sur cette image, accédez donc plutôt à Google Cloud Storage via son point de terminaison compatible S3 (`STORAGE_TYPE=s3`, `S3_ENDPOINT=https://storage.googleapis.com`, clés HMAC).

Pour le disque local, ce qui ne convient que si le chemin est un véritable volume persistant au-delà du conteneur :

```yaml
      STORAGE_TYPE: local
      # Each declared bucket gets a directory beside this one, bucket("media")
      # /storage/uploads__media, so the volume goes on their parent.
      STORAGE_PATH: /storage/uploads
      FORCE_LOCAL_STORAGE: "true"
    volumes:
      - storage:/storage
```

`FORCE_LOCAL_STORAGE` n'est pas facultatif ici : en production, un backend `local` est rejeté plutôt qu'enregistré, car l'alternative consisterait à accepter des téléversements dans un système de fichiers sur le point d'être détruit. Cette variable est votre moyen de confirmer que le montage est durable.

Montez le volume **au-dessus** de `STORAGE_PATH`, et non directement dessus. `STORAGE_PATH` est le répertoire du bucket par défaut, et chaque bucket déclaré dans `config/resources.ts` a droit au sien à côté, `<STORAGE_PATH>__<key>`. Un volume monté sur `STORAGE_PATH` lui-même ne contient que le bucket par défaut. Tous les autres buckets écriront dans le système de fichiers du conteneur et perdront leurs fichiers lors de la recréation du conteneur. `STORAGE_PATH__MEDIA` permet de déplacer un bucket ailleurs sur le volume. Il ne peut pas être déplacé dans le répertoire d'un autre bucket, comme `/storage/uploads/media`, car le bucket par défaut listerait, servirait et supprimerait alors ses fichiers.

L'image crée `/storage` pour l'utilisateur non privilégié `node` sous lequel elle s'exécute, c'est pourquoi le volume se place à cet endroit. Un volume monté là où l'image n'a pas de répertoire appartiendra à root, et chaque téléversement échouera avec `EACCES`. Le fichier compose généré par `rebase init` le monte de cette manière.

### Le stockage nécessite un modèle de contrôle d'accès

Dès lors qu'un bucket **est** configuré, le runtime **refuse de démarrer en production** tant que le déploiement ne précise pas comment les objets sont protégés. Le stockage n'est pas soumis au RLS et ses clés partagent un espace de noms plat ; en l'absence de règle, la seule barrière entre les fichiers de deux utilisateurs repose donc sur l'imprédictibilité des clés — ce que `GET /storage/list?prefix=` anéantit. L'une quelconque des options suivantes permet de satisfaire cette exigence :

- un **hook `storageAuthorize`** (ou `storagePolicies`) dans la configuration de votre projet, ce qui constitue la vraie solution et ce que le modèle initial inclut dans `config/storage.ts` — aucune variable d'environnement ne pouvant exprimer « cet utilisateur a le droit de lire cette clé » ;
- **`STORAGE_PUBLIC_READ=true`**, pour un bucket qui fait véritablement office de CDN public en lecture seule ;
- **`STORAGE_ALLOW_ANY_AUTHENTICATED=true`**, pour une application mono-tenant où chaque compte connecté dispose d'un accès de confiance à chaque fichier.

En dehors de la production, cette même condition déclenche un avertissement explicite plutôt qu'un refus, c'est donc un échec de démarrage que vous rencontrerez lors du déploiement plutôt que sur votre machine de développement. C'est délibéré : la faille qu'il remplace est silencieuse.

Définissez également `MFA_ENCRYPTION_KEY` si vous utilisez TOTP. Sans cela, les secrets d'authentification stockés sont chiffrés avec `JWT_SECRET` — une rotation de celui-ci déconnecterait alors tout le monde *et* rendrait impossible le déchiffrement de chaque appareil enregistré.

## Autres plateformes

Le runtime est un conteneur standard écoutant sur `$PORT`, donc tout environnement capable d'exécuter des conteneurs fonctionnera. Deux points à respecter scrupuleusement partout :

1. Le bundle doit être présent à `/bundle` (ou à l'emplacement indiqué par `REBASE_BUNDLE`), avec ses dépendances installées à ses côtés — voir [Dépendances](#dépendances).
2. Définissez `CORS_ORIGINS`, `JWT_SECRET` et `DATABASE_URL`. Le runtime refuse de démarrer en production sans eux plutôt que de faire des suppositions.

### Fly.io

```toml
[build]
  dockerfile = "Dockerfile"   # FROM rebasepro/server:0.26.0 + COPY dist-bundle /bundle

[http_service]
  internal_port = 8080

[[http_service.checks]]
  path = "/livez"
```

Utilisez la forme d'image dérivée ci-dessus afin que le bundle soit livré avec l'application, puis exécutez `fly deploy`.

### Railway / Render

Pointez le service vers l'image dérivée, configurez les variables d'environnement, et définissez le chemin du health check sur `/livez`.

### Un simple VPS

```bash
npm install -g @rebasepro/server @rebasepro/server-postgres
rebase-server /srv/myapp/dist-bundle
```

`rebase-server --help` liste les variables qu'il lit. Sous systemd — les deux lignes `REBASE_ADMIN_*` nécessitent la version 0.18 ou ultérieure, et sur la 0.17.3, le premier compte qui s'inscrit devient l'administrateur à la place :

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

`NODE_ENV=production` n'est pas décoratif. S'il n'est pas défini, le processus s'exécute en mode développement : il reflète les origines localhost, sert la spécification OpenAPI, et **laisse ouverte la fenêtre du premier administrateur** — ainsi, le premier inconnu à trouver le formulaire d'inscription devient l'administrateur. Les deux lignes `REBASE_ADMIN_*` sont ce qui remplace cette fenêtre ; consultez [Your first admin](/docs/getting-started/deployment/#your-first-admin).

`ALLOW_LOCALHOST_IN_PRODUCTION=true` est présent car la base de données se trouve sur la même machine. En production, le runtime refuse toute variable pointant vers localhost — dans un conteneur, le loopback correspond au conteneur lui-même, cette adresse est donc toujours une erreur — et cette ligne lui indique que cette adresse est intentionnelle. Supprimez-la lorsque la base de données s'exécute ailleurs.

Préférez `EnvironmentFile=/etc/rebase.env` avec le fichier en mode 0600 plutôt que des lignes `Environment=` pour les secrets : un fichier de service unit est lisible par tous, et `systemctl show` affiche chaque valeur `Environment=`.

## Pool de connexions (Connection pooling)

Le runtime maintient un pool restreint et persistant et n'a pas besoin de pooler. En revanche, tout le reste qui communique avec la même base de données et ne peut pas maintenir de connexion en a besoin : une fonction serverless, un script planifié, un outil de BI, un worker de file d'attente qui monte à cinquante instances. Le paramètre `max_connections` de Postgres est une limite stricte de quelques centaines et chaque connexion est un *processus*, de sorte qu'une montée en charge (fan-out) de fonctions lambda l'épuise bien avant que la base de données ne soit saturée.

Le fichier compose intègre un service `pgbouncer` pour ce trafic, configuré avec un profil afin qu'un déploiement n'ayant pas de tels clients n'exécute pas un processus inutile :

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

L'authentification client est générée à partir de `DATABASE_URL` au démarrage, évitant ainsi d'écrire le mot de passe deux fois. Le pooler s'authentifie auprès de Postgres avec `scram-sha-256`, que Postgres 18 stocke — la valeur par défaut `md5` de l'image fait échouer la connexion du *serveur* avec `FATAL: server login failed: wrong password type`, ce qui ressemble à un mauvais mot de passe sans en être un.

Gardez la somme de `PGBOUNCER_POOL_SIZE` sur l'ensemble des poolers largement en dessous du `max_connections` de la base de données — le runtime puise dans le même quota.

### Ce que change le pooling de transactions

Un client connecté via le pool conserve une connexion serveur pendant la durée d'une transaction puis la libère, ce qui permet à 500 clients de partager 20 connexions. Trois éléments cessent de fonctionner via ce port, et chacun d'eux est utilisé par Rebase lui-même — c'est précisément pourquoi le runtime se connecte directement et que ce port est réservé aux autres appelants :

- **`LISTEN`/`NOTIFY`.** Le temps réel (Realtime) repose dessus, et un écouteur a besoin d'une connexion qui persiste au-delà d'une transaction. `LISTEN` est *accepté* à travers le pooler — il répond `LISTEN`, puis aucune notification n'arrive jamais.
- **État de session** : `SET` (contrairement à `SET LOCAL`), verrous consultatifs (advisory locks) maintenus entre les requêtes, curseurs `WITH HOLD`, tables temporaires. La transaction suivante peut atterrir sur une connexion serveur différente, qui ne verra rien de tout cela. Ces deux cas échouent de la même manière déroutante : avec un seul client inactif, l'état est généralement toujours là, cela fonctionne donc pendant vos tests et cesse de fonctionner avec la concurrence pour laquelle vous avez justement introduit le pooler.
- **Instructions préparées (prepared statements) au niveau du protocole.** On peut indiquer à la plupart des pilotes de ne pas les utiliser — node-postgres ne le fait pas par défaut ; asyncpg nécessite `statement_cache_size=0`.

`SET LOCAL` est limité à la transaction et fonctionne, or c'est ce qui sert à définir la sécurité au niveau des lignes — la RLS se comporte donc de manière identique à travers le port mutualisé.

Laissez le profil désactivé si rien en dehors du runtime ne se connecte à votre base de données. Un port inutilisé constitue une surface d'attaque supplémentaire.

## Contrôles de santé (Health checks)

| Chemin | Utilisation |
| --- | --- |
| `/livez` | Liveness (Activité). Répond « ce processus est-il vivant » sans toucher à la base de données. |
| `/health` | Readiness (Disponibilité). Effectue un aller-retour avec la base de données et rapporte la latence. |

Pointez les sondes de liveness vers `/livez`. Une sonde de liveness sur `/health` redémarrerait un processus parfaitement sain lors d'un bref hoquet de la base de données, ce qui est l'exact opposé de son rôle.

## Métriques

```bash
REBASE_METRICS=true
REBASE_METRICS_TOKEN=<random string>
```

Expose les métriques Prometheus sur `/metrics` : nombre de requêtes et histogrammes de latence ventilés par surface d'API (data, auth, storage, functions) et par collection, ainsi que des jauges de processus. Sans jeton, le point de terminaison est lisible par quiconque peut atteindre le port ; définissez-en donc un, à moins qu'il ne se trouve sur un réseau privé.

`rebase_db_pool_wait_ms` est un histogramme de la durée d'attente de chaque requête pour obtenir une connexion depuis le pool de base de données, ouverture d'une connexion comprise, étiqueté par clé de source de données (`source="(default)"` dans un projet qui ne déclare aucune source de données). Un pool sain maintient cette valeur proche de zéro. Une queue de distribution qui s'allonge avec le trafic signifie que les requêtes font la queue pour obtenir des connexions — le plus souvent retenues par des callbacks d'écriture qui attendent une opération lente ; voir [A callback holds a connection](/docs/collections/context-data-api/#a-callback-holds-a-connection).

`rebase_realtime_*` rapporte les sockets ouverts de chaque instance, les canaux et les trames envoyées au bus de canaux ou retenues : voir [Seeing what the bus does](/docs/backend/realtime-transports/#seeing-what-the-bus-does).

## En-têtes de sécurité

Chaque réponse transporte `X-Frame-Options: SAMEORIGIN`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin` et `Strict-Transport-Security: max-age=15552000` (180 jours). L'en-tête HSTS omet `includeSubDomains` : cela indiquerait aux navigateurs de refuser le HTTP standard sur chaque sous-domaine de votre domaine, y compris ceux avec lesquels ce serveur n'a aucun rapport, et un navigateur conserve cette consigne pendant toute la durée indiquée par l'en-tête.
Définissez `REBASE_HSTS_INCLUDE_SUBDOMAINS=true` lorsque chaque sous-domaine est exclusivement en HTTPS ; jusqu'à la version 0.23 incluse, l'en-tête incluait systématiquement `includeSubDomains`.

`strict-origin-when-cross-origin` est le comportement par défaut des navigateurs : une requête vers un autre site transmet votre origine et jamais le chemin ou les paramètres de requête de la page. Ce n'est pas `no-referrer` car les vérifications d'origine nécessitent l'origine — le bouton de connexion Google la compare aux origines JavaScript autorisées du client OAuth, et avec `no-referrer`, il renvoyait « The given origin is not allowed for the given client ID » sur chaque application, quelles que soient les autorisations du client. Une réponse définissant sa propre politique la conserve (la page de consentement MCP envoie `no-referrer`) ; une page souhaitant une politique plus stricte peut l'indiquer avec `<meta name="referrer" content="no-referrer">`.
`X-Frame-Options` fonctionne de la même manière : `SAMEORIGIN`, sauf si la réponse définit la sienne, comme le fait la page de consentement MCP avec `DENY`.

Les applications statiques — l'administration du CMS et tout frontend servi par le bundle — comportent également `Content-Security-Policy: frame-ancestors 'self'; object-src 'none'; base-uri 'self'`. Cela détermine qui peut intégrer l'application dans une iframe, exclut les plugins et verrouille `<base>` sur votre origine, sans rien restreindre d'autre, de sorte que les scripts inline, les workers et la connexion tierce continuent de fonctionner. Une réponse définissant sa propre politique la conserve. Pour toute restriction supplémentaire, appliquez la politique sur le reverse proxy en amont.

## Plusieurs instances

Un seul conteneur constitue la configuration par défaut et ne requiert rien de plus. Avant qu'un second réplica ne reçoive du trafic — ou qu'un déploiement progressif n'en exécute deux côte à côte —, parcourez [Running more than one instance](/docs/deployment/multiple-instances/) : les limites de débit, les canaux de diffusion (broadcast channels), les fichiers locaux, les téléversements reprenables et le cache d'images sont gérés par processus jusqu'à ce qu'un paramètre les mutualise.

## Exécuter des fonctions dans leur propre processus

Tout ce qui précède correspond à un conteneur unique desservant l'ensemble du projet, ce qui est la structure idéale pour la quasi-totalité des déploiements. Lorsqu'une fonction personnalisée ne doit plus entrer en concurrence avec l'API de données pour l'event loop — ou doit monter en charge, redémarrer et échouer de manière isolée —, la même image et le même bundle peuvent être démarrés sous forme de plusieurs processus coopérant entre eux. Consultez [Split processes](/docs/deployment/split-processes/).

## Mise à niveau

```yaml
image: rebasepro/server:0.26.0
```

Redémarrez. Votre bundle reste inchangé. Au sein d'une version majeure du contrat de runtime, un bundle validé continue de fonctionner — voir [Compatibility](/docs/architecture/runtime-and-bundles/#compatibility).
