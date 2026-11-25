---
sourceHash: 5490764f32356e9d
title: Auto-hébergement
sidebar_label: Auto-hébergement
description: Exécutez Rebase n'importe où avec l'image runtime officielle et le bundle de votre projet — Docker Compose, Fly, Railway ou un simple VPS.
---

## Vue d'ensemble

L'auto-hébergement de Rebase implique d'exécuter deux composants : une base de données Postgres et l'image officielle `rebasepro/server` dans laquelle le bundle de votre projet est monté.

Il n'y a **aucune image applicative à construire**. Votre projet voyage sous forme de bundle, le runtime est publié, et mettre à niveau Rebase consiste à changer un tag plutôt qu'à recompiler. Consultez [Runtime et bundles](/docs/architecture/runtime-and-bundles/) pour comprendre les raisons de cette séparation.

## Docker Compose

**Si votre projet provient de `rebase init`, utilisez son propre `docker-compose.yml`.**
Il se trouve dans votre dépôt, `init` a renseigné ses secrets, son premier compte administrateur et sa version de runtime épinglée, et c'est le fichier décrit par [Déploiement](/docs/getting-started/deployment/#docker-compose-recommended) :

```bash
rebase build
docker compose up -d
```

Le reste de cette page présente le même déploiement sans structure préexistante — le projet de quelqu'un d'autre, un bundle compilé en CI, ou les deux éléments que le fichier généré omet délibérément : un pooler de connexions et les configurations en processus séparés.
Celui-ci se trouve dans le dépôt, à l'adresse [`infra/docker/docker-compose.selfhost.yml`](https://github.com/rebasepro/rebase/blob/main/infra/docker/docker-compose.selfhost.yml).
Utilisez-le plutôt que de copier un extrait de cette page : les deux fichiers sont démarrés par les tests d'acceptation du projet à chaque push, aucun ne peut donc dériver de ce qui fonctionne réellement.

Les deux concordent sur chaque variable d'environnement à l'exception du mot de passe de la base de données, et cela s'explique par le fait que chacun est conçu pour son propre générateur : celui-ci lit `POSTGRES_PASSWORD`, généré par `quickstart.sh` ; celui généré lit `DATABASE_PASSWORD`, que `rebase init` intègre également dans le `DATABASE_URL` qu'il écrit dans votre `.env`.

```bash
rebase build                    # produces ./dist-bundle
./infra/docker/quickstart.sh    # writes infra/docker/.env if absent, then brings it up
```

`quickstart.sh` est une commande unique effectuant deux actions simples et affichant les deux. La version détaillée, si vous préférez maîtriser chaque étape :

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

Trois secrets, une information technique, et le compte avec lequel vous vous connectez :

- **`POSTGRES_PASSWORD`** — le mot de passe de la base de données. Le modifier plus tard implique de le changer également dans le volume, choisissez-le donc une bonne fois pour toutes.
- **`JWT_SECRET`** — signe chaque session. Sa rotation déconnecte tout le monde.
- **`REBASE_SERVICE_KEY`** — l'identifiant qui contourne la sécurité au niveau des lignes (row-level security / RLS) pour les appels de serveur à serveur. Traitez-le comme un mot de passe root : quiconque le possède peut lire chaque ligne.
- **`CORS_ORIGINS`** — les origines depuis lesquelles votre frontend est servi, séparées par des virgules. Ce n'est pas un secret, et ce n'est pas optionnel : le runtime refuse de démarrer en production sans lui plutôt que de deviner, car une API qui devine ses origines autorisées finit toujours par autoriser la mauvaise.
- **`REBASE_ADMIN_EMAIL`** / **`REBASE_ADMIN_PASSWORD`** — le premier administrateur. Une base de données vierge ne contient aucun utilisateur, et hors production, la politique d'inscription accepte la première inscription et la promeut administrateur — sinon, une base de données vide est une impasse, car initialiser un administrateur nécessite un appelant déjà connecté. Dès que cette stack répond sur un nom d'hôte, cette commodité devient une course que l'opérateur peut perdre ; en production, cette fenêtre est donc fermée et le compte est défini ici. Le runtime le crée une seule fois, tant que la table des utilisateurs est vide, et ne fait plus rien aux démarrages suivants.

`JWT_SECRET` et `REBASE_SERVICE_KEY` doivent comporter chacun au moins 32 caractères, et le mot de passe administrateur au moins 12. Utilisez une adresse avec un point dans son domaine : `POST /auth/login` analyse son corps avec `z.string().email()`, le runtime refuse donc d'initialiser `admin@localhost` — un compte auquel personne ne pourrait se connecter — et consigne la raison dans les logs. Le fichier compose déclare les six avec `${VAR:?…}`, de sorte qu'une variable manquante arrête la stack avec un message la nommant plutôt que de démarrer une configuration incomplète — et l'auto-inscription est désactivée par défaut (`DISABLE_SELF_REGISTRATION`, valeur par défaut `true`), évitant ainsi toute prise de contrôle non désirée.

Connectez-vous avec ces identifiants et changez le mot de passe : ils résident en clair dans un fichier sur l'hôte.

## Dépendances

`rebase build` **installe par défaut les dépendances de votre projet dans le bundle**, de sorte que `dist-bundle` est fourni avec un dossier `node_modules` et un `package-lock.json` aux côtés de son `package.json`. Un bundle embarquant ses dépendances (vendored) démarre en cinq secondes environ.

Puisqu'elles sont déjà présentes, vous pouvez monter le bundle en lecture seule — une bonne pratique, car un hook compromis ne pourra alors pas réécrire le code exécuté au redémarrage suivant :

```yaml
    volumes:
      - ./dist-bundle:/bundle:ro
```

`rebase build --no-vendor` désactive ce comportement et produit un bundle qui installe plutôt ses dépendances au premier démarrage, ce qui prend 40 à 60 secondes par démarrage et nécessite un montage accessible en écriture.

Pour un véritable déploiement, préférez intégrer les deux dans une image, ce qui fige également exactement ce qui s'exécute :

```dockerfile
FROM rebasepro/server:0.38.0
COPY dist-bundle /bundle
```

## Création du schéma

**Le runtime crée les tables manquantes au démarrage, y compris celles déclarées par `backend/schema`.**
`REBASE_MIGRATE_ON_BOOT` a pour valeur par défaut `ensure`, qui est purement additif sur l'ensemble du schéma : il crée les tables, colonnes et types enum manquants, et applique leur sécurité au niveau des lignes (RLS). Un premier démarrage sur une base vide se met en place et sert vos tables sans étape distincte.

Ce que `ensure` ne fait délibérément jamais, c'est modifier ce qui existe déjà. Il ne modifie pas le type d'une colonne, ne supprime ni table ni colonne, et n'édite pas les valeurs d'un enum existant — car un redémarrage de conteneur ne doit pas pouvoir remodeler un schéma en tant qu'effet secondaire d'un déploiement.

L'exécution de `rebase db push` reste donc utile pour ce que le démarrage laisse intact — tout changement qui n'est pas purement additif : une colonne renommée, un type plus restrictif, un champ supprimé.

```bash
rebase db push
```

Exécutez-le depuis un checkout local ou un job CI, pointé vers la base de données de déploiement. Il teste d'abord les modifications à blanc (dry-run), refuse les modifications destructives sans confirmation explicite et peut effectuer une sauvegarde avant application. La base de données expose un port dans le fichier compose afin de pouvoir être atteinte depuis l'hôte ; supprimez ce mappage une fois le schéma en place si la base de données ne doit pas être accessible depuis l'extérieur.

`REBASE_MIGRATE_ON_BOOT` accepte uniquement `ensure` et `none` — l'image **refuse de démarrer** avec `push`, pour la raison mentionnée ci-dessus.

## Quand seul votre processus de gestion des changements peut modifier la base de données

`REBASE_MIGRATE_ON_BOOT=none` ne touche pas à vos tables. Il ne laisse pas la base de données intacte pour autant : les tables propres au framework (authentification, clés d'API, tâches/jobs, cron) sont toujours créées et maintenues à jour à chaque démarrage. Lorsque la base de données ne doit être modifiée qu'au travers d'un processus de revue des changements, définissez `REBASE_PROVISION=false` sur chaque processus qui sert du trafic :

| Paramètre | Tables et stratégies déclarées | Tables du framework |
|---|---|---|
| défaut (`REBASE_MIGRATE_ON_BOOT=ensure`) | créées et maintenues à jour au démarrage | créées et maintenues à jour |
| `REBASE_MIGRATE_ON_BOOT=none` | inchangées | créées et maintenues à jour |
| `REBASE_PROVISION=false` | inchangées | inchangées ; les éléments manquants sont listés dans les logs |

Lorsque le provisionnement est désactivé, le runtime ne crée et ne modifie rien : aucune table, colonne, index, fonction, déclencheur (trigger), stratégie (policy), rôle ou privilège (grant). Cela vaut au démarrage et par la suite, y compris pour les tables qu'un processus servant du trafic crée normalement lors de leur première utilisation (clés d'idempotence, revendications de cron, compteurs de limitation de débit partagés). Il se contente de lire ce qui est présent :

- **Tables d'authentification, ou colonne lue par l'authentification, manquantes :** le démarrage est refusé et chacune est listée.
- **Le rôle de requête peut accéder à une table du framework** telle que `rebase.refresh_tokens` ou `rebase.api_keys` : le démarrage est refusé et affiche la commande `REVOKE` à exécuter. Un démarrage avec provisionnement révoque ces privilèges de lui-même. Avec le provisionnement désactivé, rien ne le fait.
- **Table optionnelle manquante** (clés d'API, clés d'idempotence, revendications cron, compteurs de rate-limit, présence, historique des métriques) : cette fonctionnalité est désactivée et les logs indiquent la table requise.
- **Table déclarée non protégée par la base de données** — sécurité au niveau des lignes (RLS) désactivée, aucune des stratégies déclarées n'est présente, ou stratégie restrictive déclarée manquante : cette table n'est pas servie (si une stratégie permissive manque, la table est servie avec un avertissement au démarrage la mentionnant). Une requête la ciblant répond `503 TABLE_WITHHELD`, et les logs de démarrage indiquent le SQL qui la protège (ou suggèrent `rebase db push`). Les autres tables sont servies et le démarrage continue. Une table de jonction many-to-many est vérifiée de la même manière : si la base de données ne la protège pas, les tables dont les relations l'utilisent sont retenues, et `TABLE_WITHHELD` nomme la jonction. Une table dont la relation `via` transite par une table retenue est également retenue, et le message indique la relation. Cela s'applique également avec `REBASE_MIGRATE_ON_BOOT=none`, ainsi que lors d'un rafraîchissement de schéma à chaud. Une table dont l'accès est géré directement par l'application spécifie `rlsRequired: false` pour être servie malgré tout ([comment faire](/docs/deployment/existing-database/#another-tool-owns-the-schema-and-the-app-enforces-access)).

Les lignes continuent d'évoluer, comme sur n'importe quelle base de données : connexions, sessions, utilisation des clés d'API, clés d'idempotence, revendications cron. Le premier compte administrateur (`REBASE_ADMIN_EMAIL`) est initialisé par l'exécution de provisionnement, et non par les processus servants. L'[édition de schéma en direct](/docs/backend/live-schema-editing) peut toujours valider une modification dans le code source, mais refusera de l'appliquer à la base de données.

### L'exécution du provisionnement

Le schéma provient d'une exécution contrôlée par votre processus de gestion des changements. Utilisez la même image et le même bundle que le serveur, avec `REBASE_PROVISION_ONLY=true`, connecté avec un rôle disposant des droits de création sur la base de données. `REBASE_PROVISION_SQL_OUT` enregistre chaque modification de schéma effectuée sous la forme d'un script SQL :

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

L'image s'exécute avec `NODE_ENV=production`, de sorte que cette exécution est soumise aux mêmes vérifications d'environnement que le serveur, y compris `CORS_ORIGINS` ou `FRONTEND_URL`, bien qu'elle ne serve aucun trafic.

Le script est un enregistrement, pas un plan : chaque instruction qu'il contient a été exécutée, dans l'ordre, avec succès. Enregistré sur une base de données vide, il constitue l'intégralité du schéma requis par la version. Enregistré sur une copie restaurée de la production, il représente exactement la mise à niveau. Les lignes écrites lors de l'exécution n'y figurent pas. Examinez-le, puis appliquez-le à la véritable base de données :

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f out/rebase.sql
```

Répétez cette opération pour chaque mise à niveau de Rebase, avant le déploiement progressif des processus servants. Une version peut ajouter une table ou une colonne, et un processus qui n'a pas le droit d'en créer une signalera son absence au lieu de la créer.

Un serveur que vous construisez vous-même suit la même règle : `initializeRebaseBackend` lit `REBASE_PROVISION`, et `createRebaseBackend` accepte [`provision: false`](/docs/backend/custom-server#what-creating-a-backend-may-change-provision).

## Stockage de fichiers

Le stockage est **désactivé** tant qu'aucun bucket n'est configuré, et ce par conception : l'alternative par défaut consisterait à utiliser le système de fichiers du conteneur, ce qui entraînerait la perte silencieuse de chaque fichier téléversé au redémarrage suivant. Les téléversements sont refusés avec l'erreur `501 STORAGE_NOT_CONFIGURED` jusqu'à ce que vous en configuriez un.

Pour un bucket, définissez `STORAGE_TYPE=s3` (ou `gcs`) ainsi que son bucket et ses identifiants — le fichier compose liste les variables commentées. `gcs` charge `@google-cloud/storage`, qui n'est pas fourni dans l'image officielle ; sur cette image, accédez plutôt à Google Cloud Storage via son endpoint compatible S3 (`STORAGE_TYPE=s3`, `S3_ENDPOINT=https://storage.googleapis.com`, clés HMAC).

Pour le disque local, ce qui ne convient que lorsque le chemin est un véritable volume persistant au-delà du cycle de vie du conteneur :

```yaml
      STORAGE_TYPE: local
      # Each declared bucket gets a directory beside this one, bucket("media")
      # /storage/uploads__media, so the volume goes on their parent.
      STORAGE_PATH: /storage/uploads
      FORCE_LOCAL_STORAGE: "true"
    volumes:
      - storage:/storage
```

`FORCE_LOCAL_STORAGE` n'est pas optionnel dans ce cas : en production, un backend `local` est ignoré plutôt qu'enregistré, car l'alternative serait des téléversements réussissant dans un système de fichiers sur le point d'être détruit. Cette variable permet d'attester que le point de montage est durable.

Montez le volume **au-dessus** de `STORAGE_PATH`, pas directement dessus. `STORAGE_PATH` est le répertoire du bucket par défaut, et chaque bucket déclaré dans `backend/resources.ts` obtient son propre répertoire à ses côtés, `<STORAGE_PATH>__<key>`. Un volume monté sur `STORAGE_PATH` lui-même ne contiendra que le bucket par défaut. Tous les autres buckets écriront dans le système de fichiers du conteneur et perdront leurs fichiers lors de la recréation du conteneur. `STORAGE_PATH__MEDIA` permet de déplacer un bucket ailleurs sur le volume. Il ne peut pas être déplacé à l'intérieur du répertoire d'un autre bucket, tel que `/storage/uploads/media`, car le bucket par défaut listerait, servirait et supprimerait alors ses fichiers.

L'image crée `/storage` pour l'utilisateur non privilégié `node` sous lequel elle s'exécute, c'est pourquoi le volume doit y être monté. Un volume monté là où l'image n'a pas de répertoire appartiendra à root, et chaque téléversement échouera avec `EACCES`. Le fichier compose généré par `rebase init` le monte de cette façon.

### Le stockage nécessite un modèle de contrôle d'accès

Dès qu'un bucket **est** configuré, le runtime **refuse de démarrer en production** tant que le déploiement ne précise pas comment les objets sont protégés. Le stockage n'est pas soumis au RLS (sécurité au niveau des lignes) et ses clés partagent un espace de noms plat unique ; sans règle, la seule barrière entre les fichiers de deux utilisateurs repose sur l'imprévisibilité des clés — ce que `GET /storage/list?prefix=` rend caduc. N'importe laquelle de ces options satisfait cette exigence :

- un **hook `storageAuthorize`** (ou `storagePolicies`) dans la configuration de votre projet, ce que fournit le scaffold dans `backend/storage.ts` ;
- **`STORAGE_POLICIES`**, les mêmes règles sous forme de JSON — "owner" pour un dossier par utilisateur, rôles pour les administrateurs (voir [Autorisation de stockage](/docs/backend/storage-authorization/#as-data-storage_policies)) ;
- **`STORAGE_PUBLIC_READ=true`**, pour un bucket servant véritablement de CDN public en lecture seule ;
- **`STORAGE_ALLOW_ANY_AUTHENTICATED=true`**, pour une application mono-tenant où chaque compte connecté a accès à l'ensemble des fichiers.

Hors production, cette même condition déclenche un avertissement explicite plutôt qu'un refus de démarrage ; c'est donc une erreur de démarrage que vous rencontrerez lors du déploiement plutôt que sur votre machine locale. C'est délibéré : l'erreur qu'elle remplace était silencieuse.

Définissez également `MFA_ENCRYPTION_KEY` si vous utilisez le TOTP. S'il n'est pas défini, les secrets d'authentification stockés sont chiffrés avec `JWT_SECRET` — par conséquent, renouveler ce dernier déconnecte tout le monde *et* rend impossible le déchiffrement de chaque appareil enregistré.

## Autres plateformes

Le runtime est un conteneur standard qui écoute sur `$PORT`, donc tout système capable d'exécuter des conteneurs fonctionne. Deux points essentiels partout :

1. Le bundle doit être présent à l'emplacement `/bundle` (ou là où pointe `REBASE_BUNDLE`), avec ses dépendances installées à ses côtés — voir [Dépendances](#dépendances).
2. Définissez `CORS_ORIGINS`, `JWT_SECRET` et `DATABASE_URL`. Le runtime refuse de démarrer en production sans eux plutôt que de faire des suppositions.

### Fly.io

```toml
[build]
  dockerfile = "Dockerfile"   # FROM rebasepro/server:0.38.0 + COPY dist-bundle /bundle

[http_service]
  internal_port = 8080

[[http_service.checks]]
  path = "/livez"
```

Utilisez la forme d'image dérivée ci-dessus afin que le bundle soit intégré à l'application, puis lancez `fly deploy`.

### Railway / Render

Pointez le service vers l'image dérivée, définissez les variables d'environnement et configurez le chemin du healthcheck sur `/livez`.

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

`NODE_ENV=production` n'est pas décoratif. S'il n'est pas défini, le processus s'exécute en mode développement : il reflète les origines localhost, sert la spécification OpenAPI et **laisse la fenêtre du premier administrateur ouverte** — ainsi, le premier inconnu tombant sur le formulaire d'inscription devient administrateur. Les deux lignes `REBASE_ADMIN_*` remplacent cette fenêtre ; voir [Votre premier administrateur](/docs/getting-started/deployment/#your-first-admin).

`ALLOW_LOCALHOST_IN_PRODUCTION=true` est présent car la base de données se trouve sur la même machine. En production, le runtime refuse toute variable pointant vers localhost — dans un conteneur, le loopback correspond au conteneur lui-même, cette adresse est donc toujours une erreur — et cette ligne indique que l'adresse est intentionnelle. Supprimez-la lorsque la base de données s'exécute ailleurs.

Préférez `EnvironmentFile=/etc/rebase.env` avec les permissions du fichier à 0600 plutôt que des lignes `Environment=` pour les secrets : un fichier de service systemd (unit file) est lisible par tous, et `systemctl show` affiche chaque valeur `Environment=`.

## Pool de connexions

Le runtime maintient son propre petit pool et ne requiert aucun pooler externe. Pour tout autre composant qui communique avec la même base de données et ne peut pas maintenir de connexion persistante — fonctions serverless, scripts planifiés, worker mis à l'échelle — le fichier compose fournit un service `pgbouncer` sous le profil `pooler`. Voir [Pool de connexions](/docs/deployment/connection-pooling/).

## Health checks

| Chemin | Utilisation |
| --- | --- |
| `/livez` | Liveness. Répond à « ce processus est-il vivant » sans toucher à la base de données. |
| `/health` | Readiness. Effectue un aller-retour avec la base de données et rapporte la latence. |

Pointez les sondes de liveness vers `/livez`. Une sonde de liveness sur `/health` redémarrerait un processus parfaitement sain lors d'un bref incident sur la base de données, ce qui va à l'encontre de son objectif.

## Métriques

```bash
REBASE_METRICS=true
REBASE_METRICS_TOKEN=<random string>
```

Expose des métriques Prometheus sur `/metrics` : nombre de requêtes et histogrammes de latence ventilés par surface d'API (data, auth, storage, functions) et par table, ainsi que des jauges de processus. Sans token, l'endpoint est accessible à quiconque peut joindre le port ; définissez-en donc un à moins qu'il ne se trouve sur un réseau privé.

`rebase_db_pool_wait_ms` est un histogramme de la durée pendant laquelle chaque requête a attendu une connexion du pool de base de données, ouverture d'une connexion incluse, étiqueté par clé de source de données (`source="(default)"` dans un projet qui ne déclare aucune source de données). Un pool sain maintient cette valeur proche de zéro. Une traîne qui augmente avec le trafic indique que les requêtes font la queue pour obtenir des connexions — le plus souvent retenues par des hooks d'écriture qui attendent une opération lente ; voir [Un hook retient une connexion](/docs/collections/context-data-api/#a-hook-holds-a-connection).

La base de données elle-même, par source de données :

| Métrique | Signification |
|--------|--------------|
| `rebase_db_pool_connections`, `rebase_db_pool_idle`, `rebase_db_pool_waiting` | Connexions de chaque pool, étiquetées `pool="primary"`, `"read"` (le réplica) ou `"session"` (le pool direct de la console SQL derrière un pooler). Une valeur `waiting` supérieure à zéro de manière prolongée indique un pool trop petit pour sa charge. |
| `rebase_db_connection_errors_total` | Requêtes ayant répondu 503 faute de connexion, par `code` : `53300` / `53400` (le serveur n'a plus de connexions), `pool_exhausted`, `connect_timeout`, `unreachable`. |
| `rebase_db_connections` | Connexions clientes sur le serveur, par `state`, par rapport à `rebase_db_max_connections`. |
| `rebase_db_size_bytes` | Taille de la base de données. |
| `rebase_db_replica_lag_seconds` | Retard de `DATABASE_READ_URL` par rapport au primaire. |

Les quatre dernières sont échantillonnées toutes les 30 secondes via la propre connexion de l'instance, de sorte qu'un scrape ne génère jamais de requête directe.

`rebase_realtime_*` rapporte les sockets ouverts, les canaux de chaque instance et les trames envoyées au bus de canaux ou retenues : voir [Observer l'activité du bus](/docs/backend/realtime-transports/#seeing-what-the-bus-does).

## En-têtes de sécurité

Chaque réponse inclut `X-Frame-Options: SAMEORIGIN`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin` et `Strict-Transport-Security: max-age=15552000` (180 jours). L'en-tête HSTS omet `includeSubDomains` : cela indiquerait aux navigateurs de refuser le HTTP simple sur chaque sous-domaine de votre domaine, y compris ceux avec lesquels ce serveur n'a aucun rapport, et un navigateur conserve cette consigne pendant toute la durée spécifiée par l'en-tête.
Définissez `REBASE_HSTS_INCLUDE_SUBDOMAINS=true` lorsque tous les sous-domaines sont exclusivement en HTTPS.

`strict-origin-when-cross-origin` est la valeur par défaut des navigateurs : une requête vers un autre site transmet votre origine, mais jamais le chemin ni les paramètres de requête de la page. Ce n'est pas `no-referrer` car les vérifications d'origine ont besoin de l'origine — le bouton de connexion Google la compare aux origines JavaScript autorisées du client OAuth, et sous `no-referrer`, il répondait « The given origin is not allowed for the given client ID » sur chaque application, quelles que soient les autorisations du client. Une réponse qui définit sa propre politique la conserve (la page de consentement MCP envoie `no-referrer`) ; une page souhaitant une politique plus stricte peut le spécifier avec `<meta name="referrer" content="no-referrer">`.
`X-Frame-Options` fonctionne de la même manière : `SAMEORIGIN`, sauf si la réponse définit la sienne, comme le fait la page de consentement MCP avec `DENY`.

Les applications statiques — l'administration du CMS et tout frontend servi par le bundle — incluent également `Content-Security-Policy: frame-ancestors 'self'; object-src 'none'; base-uri 'self'`. Cela définit qui peut intégrer l'application dans une frame, exclut les plugins et verrouille `<base>` sur votre origine, sans rien restreindre d'autre, afin que les scripts inline, les workers et la connexion via des tiers continuent de fonctionner. Une réponse qui définit sa propre politique la conserve. Pour toute restriction plus sévère, appliquez la politique sur le reverse proxy placé en amont.

### Autoriser une autre origine à intégrer une application dans une frame

`frame-ancestors 'self'` signifie que seule une page de la même origine que l'application peut l'intégrer dans une iframe. Un CMS sur `admin.example.com` qui prévisualise le site sur `www.example.com` a besoin que le site l'y autorise, via `frameAncestors` sur l'application du site dans `rebase.json` :

```jsonc
"site": {
  "type": "static", "root": "site", "output": "site/dist", "path": "https://www.example.com",
  "frameAncestors": ["https://admin.example.com"]
}
```

Le site est ensuite servi avec `frame-ancestors 'self' https://admin.example.com`, tout comme n'importe quelle [route](/docs/architecture/apps-and-repositories/#serving-a-function-at-a-path-on-an-app) du site dont la fonction n'envoie pas sa propre politique. Les autres applications conservent `'self'`. `X-Frame-Options: SAMEORIGIN` est toujours envoyé en parallèle ; un navigateur qui lit `frame-ancestors` ignore `X-Frame-Options`, comme l'exige la spécification CSP.

Chaque entrée correspond à une origine, écrite exactement : `https://` avec un nom d'hôte et un port optionnel, ou `http://` pour `localhost`, `127.0.0.1` et `[::1]` pendant le développement. Il n'y a ni caractère générique (wildcard), ni chemin, ni mot-clé — `'self'` figure toujours dans la liste, et tout le reste est rejeté par la CLI puis par le runtime avant d'atteindre l'en-tête. Rien n'est autorisé à moins de le nommer explicitement.

## Plusieurs instances

Un conteneur unique constitue la configuration par défaut et ne nécessite rien de plus. Avant qu'un second réplica ne reçoive du trafic — ou qu'un déploiement progressif (rolling deploy) n'en exécute deux côte à côte — consultez [Exécuter plusieurs instances](/docs/deployment/multiple-instances/) : les limites de débit, les canaux de diffusion (broadcast), les fichiers locaux, les téléversements reprenables et le cache d'images sont gérés par processus tant qu'un paramètre ne les mutualise pas.

## Connecter Claude

Une seule commande ajoute ce serveur au [connecteur Rebase](/docs/ai/rebase-connector/), l'unique connecteur MCP qui permet d'accéder à tous vos projets depuis Claude :

```bash
rebase cloud connect https://your-app.com
```

Définissez sur ce serveur les deux variables affichées et redémarrez-le. Le serveur doit exécuter Rebase 0.28.1 ou une version ultérieure et répondre en HTTPS sur une adresse publique. Rien d'autre ne change : il ne détient aucun secret et accorde au connecteur les mêmes accès que Studio.

## Exécuter des fonctions dans leur propre processus

Tout ce qui précède décrit un conteneur unique servant l'intégralité du projet, ce qui correspond à l'architecture idéale pour la quasi-totalité des déploiements. Lorsqu'une fonction personnalisée ne doit plus entrer en concurrence avec l'API de données pour la boucle d'événements (event loop) — ou doit pouvoir évoluer à l'échelle, redémarrer et échouer indépendamment —, la même image et le même bundle peuvent être démarrés sous forme de plusieurs processus coopératifs. Voir [Processus séparés](/docs/deployment/split-processes/).

## Mise à niveau

```yaml
image: rebasepro/server:0.38.0
```

Redémarrez. Votre bundle reste inchangé. Au sein d'une même version majeure du contrat de runtime, un bundle validé continue de fonctionner — voir [Compatibilité](/docs/architecture/runtime-and-bundles/#compatibility).
