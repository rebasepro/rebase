---
sourceHash: ec6f07e74d4a291d
title: Environnement & Configuration
sidebar_label: Configuration
description: Toutes les variables d'environnement et options de configuration pour les projets Rebase.
---

## Variables d'environnement

Toute la configuration s'effectue via des variables d'environnement dans votre fichier `.env` situé à la racine du projet.

> **Important** : Rebase valide les variables d'environnement avec **Zod** au démarrage. Si
> un élément requis est manquant ou mal formé (une URL qui n'en est pas une, un port qui
> n'est pas un nombre), le serveur refuse de démarrer et indique le nom de la variable.
>
> L'emplacement du schéma dépend de la manière dont vous exécutez le backend. Un projet démarré par
> le runtime — `rebase dev`, `rebase start`, l'image publiée — utilise le
> schéma géré par le runtime (`loadBootEnv` dans `@rebasepro/server`), qui est l'union
> de tous les tableaux ci-dessous. Un projet ayant exécuté [`rebase eject`](/docs/cli)
> dispose d'un fichier `backend/src/env.ts` appelant `loadEnv({ extend })`, et peut y ajouter
> ses propres variables typées.

### Requises

| Variable | Description | Exemple |
|----------|-------------|---------|
| `DATABASE_URL` | Chaîne de connexion PostgreSQL. **Optionnelle en développement** — non définie, `rebase dev` exécute un PostgreSQL géré pour le projet, avec ses données sous `.rebase/`. Requise partout ailleurs. | `postgresql://user:pass@localhost:5432/mydb` |
| `JWT_SECRET` | Clé secrète pour signer les jetons JWT. Utilisez une chaîne aléatoire robuste (min. 32 caractères). **Requise en production** (auto-générée en développement). | `a1b2c3d4e5...` |

> **`sslmode=no-verify` est une syntaxe propre à node-postgres, pas à libpq.**
>
> Rebase et le pilote Node l'acceptent — chiffrer, mais sans vérifier le
> certificat. `psql`, `pg_dump`, `pg_restore` et Atlas ne l'acceptent pas et
> ne se dégradent pas gracieusement : ils refusent de démarrer avec `invalid sslmode value: "no-verify"`.
>
> Les commandes propres à Rebase (`rebase db push`, `rebase db backup`, `rebase db restore`)
> la réécrivent en son équivalent `sslmode=require` avant d'appeler le shell,
> de sorte qu'elles fonctionnent avec l'URL telle que configurée. Utiliser `psql` manuellement
> ne fonctionne pas ainsi — remplacez-y par `sslmode=require`, qui chiffre sans vérifier
> exactement de la même manière.

### Frontend

| Variable | Description | Valeur par défaut |
|----------|-------------|-------------------|
| `VITE_API_URL` | URL de l'API backend pour le SDK typé. **À définir uniquement en développement** — voir ci-dessous. | origine de la page |
| `VITE_GOOGLE_CLIENT_ID` | Identifiant client Google OAuth. Active « Se connecter avec Google ». | — |


> **Laissez `VITE_API_URL` non définie dans les builds de production.**
>
> En développement, le frontend et le backend ont des origines distinctes, le serveur
> de dev injecte donc cette variable. En production, le backend Rebase sert la SPA, de sorte
> que l'API correspond à l'origine même de la page et le client la résout de cette façon par lui-même.
>
> Intégrer en dur une URL absolue dans un bundle de production fonctionne jusqu'à ce qu'un second
> nom d'hôte pointe vers la même application : un domaine personnalisé charge alors la page depuis
> `example.com` et appelle l'API sur `example.rebase.website`, ce qui est cross-origin,
> entraînant l'échec de chaque requête preflight. Autoriser l'origine dans CORS ne résout **pas**
> le problème non plus — le cookie de rafraîchissement est en `SameSite=Lax` et n'est pas
> envoyé en cross-site, vous supprimeriez donc les erreurs de console tout en conservant une
> authentification défaillante. Lorsqu'elle n'est pas définie, chaque domaine pointant vers l'application fonctionne sans
> aucune configuration CORS.

### Backend

| Variable | Description | Valeur par défaut |
|----------|-------------|-------------------|
| `PORT` | Port pour le serveur HTTP backend. Lu par `rebase start`. `rebase dev` le lit **uniquement depuis l'environnement shell** — un `PORT` dans `.env` n'y est pas lu, car le port est résolu avant le chargement de ce fichier — et lie sinon un port dérivé du chemin du projet, afin que plusieurs projets puissent tourner en même temps. `rebase dev --port` prévaut sur les deux, et la bannière de démarrage indique le niveau utilisé. | `3001` |
| `LOG_LEVEL` | Niveau de verbosité des logs : `error`, `warn`, `info`, `debug` | `info` |
| `REBASE_LOG_RAW_QUERIES` | Affiche le SQL derrière une ligne `Failed query: [redacted]`. Chaque instruction en échec est masquée par défaut, car une requête échouée contient ses paramètres liés — un e-mail, un hash de mot de passe. Définissez-la sur `true` lors du diagnostic d'une panne de DDL, de RLS ou de capture de modifications. Ignorée lorsque `NODE_ENV=production`. | `false` |
| `NODE_ENV` | Environnement : `development`, `production`, ou `test` | `development` |
| `CORS_ORIGINS` | Liste d'origines autorisées séparées par des virgules. **Requise en production** sauf si `FRONTEND_URL` est défini : un démarrage en production avec ni l'un ni l'autre refuse de se lancer. En développement, elle est *ajoutée à* localhost — voir ci-dessous. | — |
| `FRONTEND_URL` | URL de l'application frontend. Utilisée comme alternative à CORS_ORIGINS, dans les deux environnements. | — |
| `ADMIN_CONNECTION_STRING` | Chaîne de connexion à la base de données au niveau admin (utilisée pour l'introspection du schéma et les opérations d'administration). La base de données qu'elle désigne n'est ni celle que la console SQL considère comme actuelle, ni celle qu'une nouvelle branche copie par défaut : les deux correspondent à la base sur laquelle repose la connexion de l'application (voir `REBASE_BRANCH_PARENT_DATABASE` pour un serveur sur une branche). | `DATABASE_URL` |
| `DISABLE_DB_ROLE_SWITCHING` | Désactive le changement de rôle PostgreSQL dans l'éditeur SQL (utile pour l'authentification personnalisée où les rôles DB ne sont pas mappés). La console SQL de Studio indique alors que les lignes ont été lues en tant que propriétaire de la connexion, le nomme, et grise son sélecteur de rôle. | `false` |
| `REBASE_BRANCH_PARENT_DATABASE` | La base de données depuis laquelle la branche sur laquelle ce serveur s'exécute a été copiée. `rebase dev` la définit sur un checkout [basculé sur une branche](/docs/backend/branching/#cli-integration). Un serveur disposant de cette variable conserve le registre des branches sur cette base et copie les nouvelles branches depuis celle-ci par défaut, afin que le volet Branches de Studio affiche les branches de la base principale. | — |

#### CORS en développement

Le développement autorise **localhost, plus tout ce qui est désigné par `CORS_ORIGINS` (ou `FRONTEND_URL`)** —
la même liste que celle utilisée en production, avec localhost ajouté plutôt que
substitué. Ainsi, la variable fonctionne de la même manière dans les deux environnements, et les
cas nécessitant son utilisation en développement sont les cas habituels :

```bash
# A phone on the LAN, a colleague's machine, an ngrok tunnel,
# a forwarded Codespaces port — all non-localhost origins.
CORS_ORIGINS=http://192.168.1.5:5173
```

Une origine qui n'est ni localhost ni listée est refusée, et le refus est
journalisé **une fois par origine** avec la ligne exacte qui permettrait de l'autoriser. Le refus n'est
pas une simple précaution gratuite : l'API transmettant des identifiants (credentials), renvoyer une
`Origin` arbitraire permettrait à n'importe quel site visité par le développeur d'effectuer des
requêtes authentifiées contre le serveur de dev avec sa session et d'en lire les
réponses.

### Authentification

| Variable | Description | Valeur par défaut |
|----------|-------------|-------------------|
| `JWT_SECRET` | Secret pour la signature JWT (requis en production, auto-généré en développement) | — |
| `JWT_PRIVATE_KEY` | Clé privée PEM pour signer les jetons d'accès de manière asymétrique (RS256), afin que toute entité détenant le JWKS puisse vérifier une session sans pouvoir en forger une. Accepte un PEM avec de vrais sauts de ligne, un PEM avec des échappements `\n`, ou le PEM entier en base64. Sans cela, les jetons restent en HS256. | — |
| `JWT_KEY_ID` | Nomme `JWT_PRIVATE_KEY` dans l'en-tête du jeton et dans le JWKS. Modifiez-le dès que la clé change — la rotation dépend de la capacité à distinguer l'ancienne clé de la nouvelle. | `default` |
| `JWT_ACCESS_EXPIRES_IN` | Durée de validité du jeton d'accès | `1h` |
| `JWT_REFRESH_EXPIRES_IN` | Durée de validité du jeton de rafraîchissement. Glissante — chaque rotation la renouvelle, cela régit donc la durée de survie d'une session en cas **d'inactivité**. Définissez `400d` pour les sessions devant résister à une longue absence ; les navigateurs plafonnent le cookie de rafraîchissement à cette valeur. | `30d` |
| `ALLOW_REGISTRATION` | Autoriser les nouveaux utilisateurs à s'inscrire (`true`/`false`). Hors production, le **premier** utilisateur peut toujours s'inscrire, quoi qu'en dise cette variable — une table d'utilisateurs vide doit bien accepter quelqu'un, et ce quelqu'un devient administrateur. En production (`NODE_ENV=production`), cette fenêtre est fermée : une table vide refuse l'inscription d'amorçage avec `SETUP_REQUIRED`, un premier compte créé via l'inscription ouverte est un compte ordinaire, et l'administrateur est désigné via `REBASE_ADMIN_EMAIL` ci-dessous ou assigné avec la clé de service. Le fichier `.env.example` du scaffold le définit sur `true` ; la valeur par défaut du framework est désactivée. | `false` |
| `DISABLE_SELF_REGISTRATION` | Coupe-circuit. Ferme la fenêtre d'amorçage du premier utilisateur que `ALLOW_REGISTRATION=false` laisse délibérément ouverte hors production, de sorte que l'inscription soit fermée même face à une base vide. À combiner avec `REBASE_ADMIN_EMAIL` ci-dessous, sinon le déploiement n'aura aucun moyen de créer son premier intervenant connecté. Chaque artefact de déploiement livré le définit. | — |
| `REBASE_ADMIN_EMAIL` | E-mail du premier compte administrateur, créé au démarrage **tant que la table des utilisateurs est encore vide** et jamais après. C'est ainsi qu'un déploiement de production obtient son admin : l'opérateur désigne le premier compte au lieu de faire la course avec Internet. Le démarrage avertit si la table est vide en production et que cette variable n'est pas définie. | — |
| `REBASE_ADMIN_PASSWORD` | Mot de passe de ce compte. Au moins 12 caractères, sous peine de refus et de non-création du compte. Modifiez-le après la première connexion. | — |
| `MFA_ENCRYPTION_KEY` | Chiffre chaque secret TOTP stocké. Si non défini, les secrets sont chiffrés avec `JWT_SECRET` à la place et le démarrage émet un avertissement — ainsi, effectuer une rotation de `JWT_SECRET` déconnecte tout le monde *et* rend indéchiffrable chaque authentificateur enregistré. Définissez une clé dédiée (32+ caractères aléatoires) avant toute inscription MFA. | — |
| `MFA_ENCRYPTION_KEY_PREVIOUS` | L'ancienne clé que l'on remplace lors d'une rotation. Définissez les deux lors d'une rotation : les nouveaux secrets sont écrits avec `MFA_ENCRYPTION_KEY` et les existants restent lisibles, afin que personne ne soit exclu de son propre compte en cours de rotation. Supprimez-la une fois que chaque secret a été rechiffré. | — |
| `ALLOW_ANONYMOUS` | Active la connexion anonyme (`POST /api/auth/anonymous`). Optionnelle (opt-in), et délibérément non conditionnée par `ALLOW_REGISTRATION`. | `false` |
| `AUTH_REQUIRE` | Exiger l'authentification pour l'API de données. Définissez sur `false` pour une surface de lecture entièrement publique — la RLS s'applique toujours. | `true` |
| `AUTH_DEFAULT_ROLE` | Rôle attribué à un utilisateur nouvellement inscrit si aucun n'est fourni. | — |
| `AUTH_ALLOW_USER_LOOKUP` | Monte `POST /api/auth/find-user`, qui résout un e-mail en un profil public minimal (`uid`, `displayName`, `photoURL`) pour les flux d'invitation par e-mail. Intervenants authentifiés uniquement, et cela ne renvoie jamais l'e-mail, les rôles ou les métadonnées de l'utilisateur trouvé. Désactivé par défaut : il s'agit d'une surface d'énumération. | `false` |
| `AUTH_COOKIE_SAME_SITE` | `SameSite` sur le cookie de rafraîchissement : `Strict`, `Lax` ou `None`. `None` nécessite HTTPS et est réservé à un frontend véritablement cross-site. | `Lax` |
| `AUTH_COOKIE_SECURE` | `Secure` sur le cookie de rafraîchissement. Sécurisé par défaut ; `AUTH_COOKIE_SECURE=false` pour le http simple — un déploiement sur une adresse LAN où le navigateur rejetterait sinon le cookie et où la session expirerait en fin de validité du jeton d'accès sans erreur. Un avertissement est émis au démarrage. `http://localhost` n'en a pas besoin. | `true` |
| `GOOGLE_CLIENT_ID` | Identifiant client Google OAuth (validation backend) | — |
| `GOOGLE_CLIENT_SECRET` | Secret client Google OAuth | — |
| `GITHUB_CLIENT_ID` | Identifiant client GitHub OAuth | — |
| `GITHUB_CLIENT_SECRET` | Secret client GitHub OAuth | — |
| `MICROSOFT_CLIENT_ID` | Identifiant client Microsoft OAuth | — |
| `MICROSOFT_CLIENT_SECRET` | Secret client Microsoft OAuth | — |
| `LINKEDIN_CLIENT_ID` | Identifiant client LinkedIn OAuth | — |
| `LINKEDIN_CLIENT_SECRET` | Secret client LinkedIn OAuth | — |
| `FACEBOOK_CLIENT_ID` | Identifiant client Facebook OAuth | — |
| `FACEBOOK_CLIENT_SECRET` | Secret client Facebook OAuth | — |
| `TWITTER_CLIENT_ID` | Identifiant client X/Twitter OAuth | — |
| `TWITTER_CLIENT_SECRET` | Secret client X/Twitter OAuth | — |
| `DISCORD_CLIENT_ID` | Identifiant client Discord OAuth | — |
| `DISCORD_CLIENT_SECRET` | Secret client Discord OAuth | — |
| `GITLAB_CLIENT_ID` | Identifiant client GitLab OAuth. La `baseUrl` d'une instance auto-hébergée n'a pas d'équivalent en variable d'environnement — configurez GitLab dans le bloc `auth` pour cela. | — |
| `GITLAB_CLIENT_SECRET` | Secret client GitLab OAuth | — |
| `BITBUCKET_CLIENT_ID` | Identifiant client Bitbucket OAuth | — |
| `BITBUCKET_CLIENT_SECRET` | Secret client Bitbucket OAuth | — |
| `SLACK_CLIENT_ID` | Identifiant client Slack OAuth | — |
| `SLACK_CLIENT_SECRET` | Secret client Slack OAuth | — |
| `SPOTIFY_CLIENT_ID` | Identifiant client Spotify OAuth | — |
| `SPOTIFY_CLIENT_SECRET` | Secret client Spotify OAuth | — |
| `APPLE_CLIENT_ID` | Apple Services ID. Apple n'a pas de secret client statique — Rebase signe un JWT ES256 à courte durée de vie par échange de jeton — elle nécessite donc les quatre valeurs `APPLE_*`, et ne configure rien sans elles. | — |
| `APPLE_TEAM_ID` | Apple Developer Team ID, l'émetteur du JWT. | — |
| `APPLE_KEY_ID` | Identifiant de clé de la clé privée enregistrée auprès d'Apple. | — |
| `APPLE_PRIVATE_KEY` | Contenu du fichier de clé privée `.p8`, sauts de ligne inclus (les séquences d'échappement `\n` sont acceptées). | — |
| `REBASE_SERVICE_KEY` | Clé d'API admin statique. Contourne l'authentification JWT normale pour les appels de serveur à serveur lorsqu'elle est transmise sous la forme `Authorization: Bearer <key>`. (Auto-générée en développement). | — |
| `REBASE_PLATFORM_TOKEN_KEY` | Clé publique de la plateforme d'hébergement (PEM, EC P-256) permettant de vérifier les jetons de plateforme `rpt_` ; plusieurs blocs PEM lors d'une rotation de clé. La plateforme la définit lors du déploiement, et elle ne contient aucun secret. Conjointement avec `REBASE_PLATFORM_TOKEN_AUDIENCE`, elle permet au portail d'administration d'accepter un jeton de plateforme pour `cron:read`, et pour rien d'autre. | — |
| `REBASE_PLATFORM_TOKEN_AUDIENCE` | L'identifiant de projet auquel l'`aud` d'un jeton de plateforme doit correspondre, de sorte qu'un jeton émis pour un autre projet soit refusé. Si une seule des deux variables est définie, le serveur démarre, consigne un avertissement et répond à chaque jeton `rpt_` par un `401 PLATFORM_TOKENS_OFF`. | — |
| `REBASE_RATE_LIMIT_STORE` | Emplacement de stockage des compteurs de limitation de débit (rate-limit) d'authentification : `memory` (par processus) ou `sql` (partagé entre les répliques). Un processus ne pouvant pas connaître le nombre de ses répliques, un déploiement avec des pairs doit le spécifier — trois répliques avec la valeur par défaut appliquent trois fois la limite. Toute autre valeur **refuse de démarrer** plutôt que d'effectuer un repli, `postgres` inclus. | `memory` |
| `AUTH_MAGIC_LINK` | Monte le flux de lien de connexion sans mot de passe. Nécessite un service d'e-mail configuré, sinon le lien n'a nulle part où aller. | `false` |
| `AUTH_EMAIL_OTP` | Monte la connexion sans mot de passe avec un code à six chiffres envoyé par e-mail. Même exigence d'e-mail que ci-dessus. | `false` |
| `AUTH_MAGIC_LINK_CREATES_USERS` | Inscription sans mot de passe : une demande de lien magique ou de code par e-mail pour une adresse inconnue crée le compte, tant que les inscriptions sont ouvertes. | `false` |
| `AUTH_REFRESH_TOKEN_REUSE` | Action lorsqu'un jeton de rafraîchissement est rejoué après sa fenêtre de réutilisation : `reject` (le refuser, conserver la session) ou `revoke-session` (mettre fin à la session). Toute autre valeur fait échouer le démarrage. | `reject` |
| `AUTH_REQUIRE_EMAIL_VERIFICATION` | Inscription avec confirmation préalable : aucune connexion par mot de passe tant que l'adresse n'est pas vérifiée. Nécessite un service d'e-mail ; le démarrage le refuse sans cela. | `false` |
| `CAPTCHA_PROVIDER` | Active la vérification par captcha sur les routes d'authentification : `turnstile` ou `hcaptcha`. Non défini signifie aucun captcha. | — |
| `CAPTCHA_SECRET` | Secret du fournisseur, utilisé côté serveur pour vérifier le jeton envoyé par le navigateur. Requis dès lors que `CAPTCHA_PROVIDER` est défini. | — |
| `CAPTCHA_ROUTES` | Routes d'authentification à protéger séparées par des virgules (par exemple `register,login`). Non défini protège l'ensemble par défaut du fournisseur. | — |

### Stockage (Storage)

:::caution[Le stockage n'a pas de sécurité au niveau des lignes (RLS), il nécessite donc un modèle d'accès]
Les collections sont protégées par la RLS Postgres. Le stockage d'objets n'a pas d'équivalent —
les clés partagent un espace de noms plat unique — ainsi, avec un bucket configuré et aucun modèle d'accès,
le serveur **refuse de démarrer en production**. Répondez à cette exigence avec exactement l'un des éléments suivants :
un hook `storageAuthorize` exporté depuis `config/index.ts` (ce que fournit le scaffold),
`STORAGE_PUBLIC_READ`, ou `STORAGE_ALLOW_ANY_AUTHENTICATED`.
:::

| Variable | Description | Valeur par défaut |
|----------|-------------|-------------------|
| `STORAGE_TYPE` | Backend de stockage : `local`, `s3` ou `gcs`. En production, `local` désactive le stockage à moins que `FORCE_LOCAL_STORAGE=true` | `local` |
| `STORAGE_PATH` | Chemin de base pour le stockage local. Un chemin relatif est lu depuis le répertoire où tourne le serveur : la racine du projet sous `rebase dev`, `backend/` dans un serveur généré par `rebase eject` | `<project>/uploads` |
| `FORCE_LOCAL_STORAGE` | Autoriser le stockage local en production — uniquement avec un volume durable contenant `STORAGE_PATH` et les répertoires `<STORAGE_PATH>__<key>` des buckets locaux nommés à côté | `false` |
| `STORAGE_DOWNLOAD_TOKEN_TTL` | Durée en secondes pendant laquelle l'URL de téléchargement d'un fichier privé est valide — le jeton que `getSignedUrl()` y insère. Au maximum `604800` (une semaine) | `300` |
| `STORAGE_MAX_FILE_SIZE` | Taille maximale de fichier acceptée par la source, en octets, sur chaque chemin d'upload — `__<KEY>` pour une source nommée. Une valeur qui n'est pas un nombre entier d'octets refuse le démarrage | `52428800` (50 Mo) |
| `S3_BUCKET` | Nom du bucket S3 (lorsque `STORAGE_TYPE=s3`) | — |
| `S3_REGION` | Région AWS | — |
| `S3_ACCESS_KEY_ID` | Clé d'accès AWS | — |
| `S3_SECRET_ACCESS_KEY` | Clé secrète AWS | — |
| `S3_ENDPOINT` | Point de terminaison S3 personnalisé (pour MinIO, Cloudflare R2, etc.) | — |
| `S3_FORCE_PATH_STYLE` | Forcer les URL de style chemin pour le bucket S3 (`true`/`false`) | `false` |
| `GCS_BUCKET` | Nom du bucket GCS (lorsque `STORAGE_TYPE=gcs`) | — |
| `GCS_PROJECT_ID` | Projet GCP. Généralement déduit des identifiants. | — |
| `GCS_KEY_FILENAME` | Chemin vers un fichier de clé de compte de service. À omettre sur GCP, où Workload Identity fournit les identifiants. | — |
| `STORAGE_PUBLIC_READ` | Servir chaque objet à tout le monde, sans jeton. Uniquement pour un bucket qui fait réellement office de CDN public. L'un des trois moyens de satisfaire la vérification au démarrage ci-dessous. | `false` |
| `STORAGE_ALLOW_ANY_AUTHENTICATED` | Permettre à tout intervenant connecté de lire, écrire, lister et supprimer chaque objet. Nommé `INSECURE` dans l'objet de configuration pour une bonne raison : ce n'est défendable que dans une application mono-tenant où chaque compte est digne de confiance pour chaque fichier. | `false` |
| `STORAGE_RENDITION_CACHE` | Mettre en cache les rendus d'images générés (redimensionnements, conversions de format) au lieu de les produire à chaque requête. | `false` |

### E-mail (Optionnel)

| Variable | Description |
|----------|-------------|
| `SMTP_HOST` | Hôte du serveur SMTP |
| `SMTP_PORT` | Port du serveur SMTP |
| `SMTP_SECURE` | Activer la connexion sécurisée (`true`/`false`) |
| `SMTP_USER` | Nom d'utilisateur SMTP |
| `SMTP_PASS` | Mot de passe SMTP |
| `SMTP_FROM` | Adresse d'expédition pour les e-mails système |
| `SMTP_NAME` | Nom affiché sur l'adresse d'expédition |
| `APP_NAME` | Nom du produit utilisé dans les objets et corps d'e-mails (par défaut : `Rebase`) |
| `EMAIL_LOGO_URL` | Logo affiché en tête des modèles d'e-mails par défaut. PNG ou JPG absolu en `http(s)` — les clients de messagerie suppriment les SVG et bloquent les URI `data:`. Si non défini, une application toujours nommée `Rebase` reçoit le logo Rebase et une application renommée n'en reçoit aucun |

### Pool de connexions à la base de données

| Variable | Description | Valeur par défaut |
|----------|-------------|-------------------|
| `DB_POOL_MAX` | Nombre maximal de connexions dans le pool | `20` |
| `DB_POOL_IDLE_TIMEOUT` | Millisecondes pendant lesquelles une connexion inactive est conservée | `30000` |
| `DB_POOL_CONNECT_TIMEOUT` | Millisecondes à attendre pour obtenir une connexion | `10000` |
| `DATABASE_DIRECT_URL` | Connexion directe (hors pool). Le [Temps Réel](/docs/backend/realtime) en a besoin : `LISTEN`/`NOTIFY` ne survit pas à un pooler de transactions tel que PgBouncer, et sans cela les notifications de modification sont désactivées avec un avertissement plutôt qu'ignorées silencieusement. Le [worker de tâches](/docs/backend/jobs) maintient également son `LISTEN` de réveil dessus. Remplit la variable `directConnectionString` de l'adaptateur Postgres lorsque celle-ci n'est pas définie. | — |
| `DATABASE_READ_URL` | Réplique de lecture. Les lectures y sont dirigées lorsqu'elle est définie et diffère de `DATABASE_URL` ; si la connexion échoue, tout bascule sur l'instance primaire avec un avertissement. Remplit la variable `readConnectionString` de l'adaptateur Postgres lorsque celle-ci n'est pas définie ; sur la version 0.24, cette option est ignorée. | — |
| `REBASE_DB_POOL_MAX` | Un plafond imposé à chaque pool du processus, quelle que soit la demande formulée par chacun. Chiffres bruts uniquement : une valeur malformée est ignorée au lieu de sérialiser silencieusement le serveur. | — |

### Comportement du runtime

Lu par le runtime — `rebase dev`, `rebase start` et l'image de serveur publiée.
Un projet ayant été éjecté gère ces décisions dans son propre code à la place.

| Variable | Description | Valeur par défaut |
|----------|-------------|-------------------|
| `REBASE_RLS_AUDIT` | `true` exécute l'[audit planifié de sécurité au niveau des lignes](/docs/rls-check#running-it-on-a-schedule), qui signale les tables exposées sans politiques. Le projet doit déclarer `@rebasepro/rls-check` parmi ses dépendances : le runtime n'en fournit aucune copie, et sans le package, le démarrage est refusé en indiquant son nom. `false` désactive le scan sur ce processus. | — |
| `REBASE_BASE_PATH` | Chemin de base pour chaque route d'API. Le client doit être informé de la même configuration — voir [Modifier `basePath`](#modifier-basepath). | `/api` |
| `REBASE_SERVE_STATIC` | Servir les ressources statiques/admin du bundle depuis ce processus. Désactivez cette option lorsqu'un CDN est placé en frontal. | `true` |
| `REBASE_HISTORY` | Enregistrer l'[historique des modifications d'entités](/docs/backend/history). | `true` |
| `REBASE_COMPRESSION` | Compresser les réponses en gzip/brotli. | `true` |
| `REBASE_MAX_BODY_SIZE` | Taille maximale du corps de requête, **en octets** (`10485760`, et non `10MB` — une valeur qui n'est pas un nombre refuse de démarrer au lieu de supprimer silencieusement la limite). `0` désactive la limite. | `10485760` (10 Mio) |
| `REBASE_ENABLE_SWAGGER` | L'interface OpenAPI. Trois états : non défini signifie activé en développement, désactivé en production ; `false` désactive les deux partout. Notez que `true` en production sert la **spécification** sur `/api/docs` mais pas l'**interface UI** Swagger sur `/api/swagger` — l'interface UI dépend de `NODE_ENV` séparément. | — |
| `REBASE_METRICS` | Exposer les métriques Prometheus sur `/metrics`. | `false` |
| `REBASE_HSTS_INCLUDE_SUBDOMAINS` | Ajoute `includeSubDomains` à l'en-tête `Strict-Transport-Security`, de sorte que les navigateurs refusent le HTTP simple sur chaque sous-domaine de l'hôte pendant six mois — y compris les hôtes que ce processus ne sert pas. Ne l'activez que si chaque sous-domaine du domaine est exclusivement en HTTPS. Toute valeur autre que `true`/`false` refuse de démarrer. Voir [En-têtes de sécurité](/docs/deployment/self-hosting/#security-headers). | `false` |
| `REBASE_METRICS_TOKEN` | Jeton Bearer protégeant `/metrics`. S'il n'est pas défini, le point de terminaison reste ouvert à tout ce qui peut atteindre le port — acceptable sur un réseau privé, pas sur un réseau public, et les logs de démarrage le signalent. | — |
| `REBASE_MIGRATE_ON_BOOT` | Ce que le runtime est autorisé à faire sur le schéma au démarrage. `ensure` (la valeur par défaut, partout — y compris en production) exécute la passe **additive** : créer les tables, colonnes et types enum manquants, sans jamais en supprimer ni en réécrire un. `none` laisse le schéma des collections intact, mais les tables propres au framework (auth, clés d'API, jobs, cron) sont toujours créées et tenues à jour ; `REBASE_PROVISION=false` désactive aussi celles-ci. L'image publiée n'accepte que ces deux-là et **refuse de démarrer sur `push`**. Dans un [déploiement scindé](/docs/deployment/split-processes), exactement un processus peut provisionner, tous les autres rôles doivent donc définir `none` sous peine de refuser de démarrer. | `ensure` |
| `REBASE_PROVISION` | `false` fait que le runtime ne change rien dans sa base de données : aucune table, colonne, index, fonction, trigger, politique, rôle ni privilège, ni au démarrage ni ensuite, y compris les tables propres au framework. Il signale à la place, nommément, ce qui manque. Pour une base de données que seul votre processus de changement peut modifier. Voir [Quand seul votre processus de changement peut modifier la base de données](/docs/deployment/self-hosting/#when-only-your-change-process-may-change-the-database). Seuls `true` et `false` sont acceptés. | `true` |
| `REBASE_REQUIRE_SCHEMA_MATCH` | Refuse de démarrer lorsque la base de données a été provisionnée pour la dernière fois à partir d'un ensemble de collections différent de celui pour lequel ce processus a été compilé. Si non défini (ou pour toute valeur autre que `true`/`1`), un avertissement est émis à la place. | warn |
| `REBASE_REQUIRE_FILES_LOADED` | Refuse de démarrer lorsqu'un fichier de fonction ou de cron lève une erreur ou ne se parse pas à l'import, en nommant chaque fichier et la raison, de sorte qu'un déploiement progressif laisse l'ancienne version en service. Un redémarrage y est soumis aussi. Si non défini (ou pour toute valeur autre que `true`), le fichier est ignoré et le reste est servi. Un fichier qui s'importe sans erreur et n'exporte aucune fonction ni tâche est toujours ignoré, jamais refusé. | skip |
| `REALTIME_CDC` | Capture des données modifiées (CDC) au niveau de la base : `auto` (activé si la connexion le permet, repli silencieux sinon), `trigger` (le forcer, avertir si impossible), `wal` (se dégrade en `trigger` aujourd'hui), `off`. Voir [Temps Réel](/docs/backend/realtime-cdc/). Prévaut sur `realtime.cdc`. | `auto` |
| `REALTIME_CHANNEL_BUS` | Transport inter-instances pour les canaux de diffusion (broadcast) et la présence : `memory` ou `postgres`. Ignoré lorsque `realtime.bus` a reçu un transport construit. | `memory` |
| `REALTIME_MAX_SUBSCRIPTIONS_PER_SOCKET` | Nombre maximal d'abonnements qu'une socket temps réel peut maintenir ; le suivant est refusé avec `TOO_MANY_SUBSCRIPTIONS`. Un entier positif — toute autre valeur bloque le serveur au démarrage. Prévaut sur `realtime.maxSubscriptionsPerSocket`. Voir [Temps Réel](/docs/backend/realtime#what-a-write-costs-and-the-limits). | `1000` |
| `REALTIME_MAX_SOCKETS_PER_USER` | Nombre maximal de sockets temps réel qu'un utilisateur, ou une clé d'API, peut maintenir ouvertes sur une même instance de serveur. Les sockets d'usurpation d'un administrateur comptent pour l'administrateur. La connexion de la suivante est refusée avec `TOO_MANY_SOCKETS` et la socket est fermée (4002) ; le SDK réessaie en continu, de sorte qu'il se connecte lorsqu'une autre se ferme. Un entier positif — toute autre valeur bloque le serveur au démarrage. Prévaut sur `realtime.maxSocketsPerUser`. | Sans plafond |
| `REALTIME_REFETCH_MAX_WAIT_MS` | Temps maximal pendant lequel une modification attend la réévaluation (refetch) qui la transmet aux abonnés en direct, en ms. Une réévaluation attend 300 ms sans modification, et au maximum cette durée sous un flux continu d'écritures. Un entier positif — toute autre valeur bloque le serveur au démarrage. Prévaut sur `realtime.refetchMaxWaitMs`. | `1000` |
| `REALTIME_RECOUNT_INTERVAL_MS` | Durée pendant laquelle le total d'un abonnement à une grande liste peut être réutilisé avant d'être recompté, en ms ; les trames qui le réutilisent portent `meta.totalAsOf`. Si non défini, chaque trame déclenche un décompte. Prévaut sur `realtime.recountIntervalMs`. | Non défini |
| `REALTIME_RECOUNT_MIN_ROWS` | Le plus petit dernier total auquel `REALTIME_RECOUNT_INTERVAL_MS` s'applique ; les listes plus petites sont comptées à chaque trame. Prévaut sur `realtime.recountMinRows`. | `100000` |
| `ALLOW_LOCALHOST_IN_PRODUCTION` | Autorise les valeurs `localhost`/loopback sous `NODE_ENV=production`. Désactivé par défaut, afin qu'un démarrage en production échoue explicitement au lieu de tenter de se connecter à une base de données inexistante. | `false` |
| `REBASE_STRICT_COLLECTION_CONFIG` | Ce que le démarrage fait d'une clé dans vos collections que cette version ne lit pas : `warn`, `error` (refuse de démarrer — utile à activer en CI), ou `off`. Ne régit que les clés qu'il ne *reconnaît* pas, qui sont généralement une faute de frappe et parfois des métadonnées délibérées ; une clé qu'il sait avoir été déplacée est toujours fatale, car la fonctionnalité qu'elle configurait serait sinon absente silencieusement. | `warn` |
| `REBASE_PROVISION_ONLY` | `1`/`true` exécute la passe de schéma et se termine sans ouvrir de socket — le format adapté à un Job de migration, à partir de la même image et du même bundle que le serveur qui le suit. Une valeur vide est considérée comme *non définie*, de sorte qu'un `${SOMETHING}` non substitué dans un fichier compose ne puisse pas transformer un déploiement ordinaire en un déploiement qui migre et refuse de servir. Elle crée aussi les tables qu'un processus de service créerait à la première utilisation, et ne démarre ni le cron ni la file de jobs. Refusée avec `REBASE_PROVISION=false`. | — |
| `REBASE_PROVISION_SQL_OUT` | Un chemin de fichier. Une exécution de provisionnement (`REBASE_PROVISION_ONLY=true`) y écrit chaque changement de schéma qu'elle a effectué, dans l'ordre, sous forme de script SQL à relire et à appliquer avec `psql`. Les lignes qu'elle a écrites n'y figurent pas. Refusé sur un processus qui sert. | — |
| `REBASE_LIVE_SCHEMA_ALLOW_MACHINE_APPLY` | `true` permet à une machine — un agent, un job CI — d'*appliquer* un changement de schéma via `/api/admin/schema`, et pas seulement d'en planifier un. Désactivé sauf si demandé : l'identifiant qui permettrait un tel changement est celui le plus susceptible de se trouver dans une variable de CI. | `false` |
| `REBASE_FUNCTIONS_TIMEOUT_MS` | Durée maximale pendant laquelle une fonction personnalisée peut s'exécuter avant que sa requête ne soit interrompue. Même paramètre que l'option `functionsTimeoutMs`. `0` le désactive. | `30000` |
| `REBASE_EXIT_ON_UNHANDLED_REJECTION` | `true` fait en sorte qu'un rejet de promesse non géré termine le processus au lieu de simplement le consigner. À activer sous un orchestrateur qui vous redémarrera ; à désactiver lorsqu'un redémarrage est pire qu'une fuite. | `false` |
| `REBASE_CRON_ALWAYS_ON` | Maintient le planificateur cron actif sur une plateforme que le runtime détecte sinon comme réduisant à zéro (scale-to-zero), où un minuteur qui se déclenche dans une instance inactive ne se déclenche dans aucune instance. | — |
| `TRUSTED_PROXY_HOPS` | Nombre de proxys situés devant ce serveur, pour que le limiteur de débit puisse lire la véritable adresse client dans `X-Forwarded-For`. Valeur par défaut sécurisée à `0` : sans proxy, faire confiance à l'en-tête permettrait à n'importe quel appelant d'usurper une identité. | `0` |

:::note[Le provisionnement au démarrage est additif, ce n'est pas un outil de migration]
La passe de démarrage s'exécute sans surveillance et sans personne pour relire un diff, elle ne supprimera donc jamais
de colonne, ne réduira pas un type et ne réécrira pas une table. C'est également pour cela que l'image refuse
`REBASE_MIGRATE_ON_BOOT=push` : un push complet calcule un diff et effectuera volontiers un
`DROP COLUMN`, or un redémarrage de conteneur ne doit jamais pouvoir détruire une
colonne de production suite à un réordonnancement de conteneurs.

Les modifications destructives ou structurelles restent là où elles peuvent être vérifiées : `rebase db
generate` + `rebase db migrate`, ou `rebase db push` depuis un checkout ou une CI,
ce qui simule la modification, refuse les opérations destructives sans confirmation, et
peut effectuer une sauvegarde au préalable.
:::

### Déploiements scindés (Split deployments)

Une même image et un même bundle peuvent être démarrés plusieurs fois, chacun servant une
partie différente du projet. Une ligne pour chacun ici, car cette page a pour vocation
de recenser chaque variable ; ce que chaque combinaison *monte et prend en charge* — et quelles
combinaisons refusent de démarrer — est décrit sur la page
**[Processus scindés (Split Processes)](/docs/deployment/split-processes)**.

| Variable | Description | Valeur par défaut |
|----------|-------------|-------------------|
| `REBASE_ROLE` | Quelle partie ce processus sert : `all`, `api`, `functions` ou `worker`. | `all` |
| `REBASE_CRON_SCHEDULER` | Remplacer le fait que *ce* processus exécute ou non les minuteurs cron. Si non défini, suit le rôle. | — |
| `REBASE_JOB_WORKERS` | Remplacer le fait que ce processus exécute ou non les workers de file d'attente de tâches. Si non défini, suit le rôle. | — |
| `REBASE_FUNCTIONS_ONLY` | Ne servir que les fonctions personnalisées désignées dans ce processus. | — |
| `REBASE_FUNCTIONS_EXCLUDE` | Servir toutes les fonctions personnalisées sauf celles désignées. | — |
| `REBASE_FUNCTIONS_UPSTREAM` | Vers où le processus API redirige une requête de fonction qu'il ne sert pas lui-même. Sur un `worker`, vers où vont ses propres appels `rebase.functions`. Une URL `http(s)`. | — |

### Surface MCP

Un point de terminaison Model Context Protocol optionnel sur `/mcp`, afin qu'un client IA puisse lire
et écrire dans ce projet **en tant qu'utilisateur connecté**. Désactivé par défaut, et — contrairement
aux autres surfaces — aucun `REBASE_ROLE` ne l'active : les autres décrivent une
forme de processus, tandis que celui-ci relève d'une décision de transmettre des identifiants à un logiciel
tiers, et cette décision doit être prise par un humain plutôt qu'héritée du rôle
assigné à un conteneur.

| Variable | Description | Valeur par défaut |
|----------|-------------|-------------------|
| `REBASE_MCP_ENABLED` | Monte la surface MCP. Nécessite `REBASE_PUBLIC_URL` ; sans elle, la surface refuse de se monter et l'indique dans le log de démarrage. | `false` |
| `REBASE_PUBLIC_URL` | L'origine accessible depuis l'extérieur pour ce déploiement, par ex. `https://app.example.com`. La surface MCP ne peut pas la déduire — extraire l'origine de l'en-tête `Host` ferait de l'identité de l'émetteur, et du public cible vis-à-vis duquel ses propres jetons sont vérifiés, une valeur fournie par l'appelant. | — |
| `REBASE_MCP_OPEN_REGISTRATION` | Autorise l'enregistrement dynamique de clients OAuth (RFC 7591), afin qu'un client puisse s'enregistrer lui-même. Définissez sur `false` pour exiger que les clients soient enregistrés au préalable. | `true` |

### Édition directe de schéma depuis un bundle (Live schema editing)

Désactivé sauf si `REBASE_LIVE_SCHEMA_REPOSITORY` est défini. Un bundle compilé n'a pas
de source de collections à éditer, ainsi avec ces variables définies, l'éditeur de collections de l'administrateur lit
la source depuis le dépôt, commite chaque modification en retour, et exécute son DDL sur
cette base de données. Réservé à l'administrateur, et appliqué par un humain sauf si
`REBASE_LIVE_SCHEMA_ALLOW_MACHINE_APPLY` en dispose autrement. Un dépôt désigné sans
identifiant utilisable refuse de démarrer. Voir
[Édition directe de schéma](/docs/backend/live-schema-editing#from-a-built-bundle).

| Variable | Description | Valeur par défaut |
|----------|-------------|-------------------|
| `REBASE_LIVE_SCHEMA_REPOSITORY` | Le dépôt GitHub sur lequel commiter les changements de schéma, au format `owner/name`. C'est sa définition qui active la fonctionnalité. | — |
| `REBASE_LIVE_SCHEMA_BRANCH` | La branche sur laquelle le commit est appliqué. | `main` |
| `REBASE_LIVE_SCHEMA_COLLECTIONS_PATH` | Emplacement du code source des collections dans ce dépôt, relatif à la racine du dépôt. | `config/collections` |
| `REBASE_LIVE_SCHEMA_GITHUB_TOKEN` | Un token à granularité fine avec accès en lecture et écriture au contenu du dépôt. Définissez soit celui-ci, soit les trois variables `_GITHUB_APP_*`, mais pas les deux. | — |
| `REBASE_LIVE_SCHEMA_GITHUB_APP_ID` | Identifiant d'une application GitHub, pour commiter en tant qu'application plutôt qu'avec un token. | — |
| `REBASE_LIVE_SCHEMA_GITHUB_APP_INSTALLATION_ID` | L'installation de l'application sur le dépôt. | — |
| `REBASE_LIVE_SCHEMA_GITHUB_APP_PRIVATE_KEY` | La clé privée de l'application : PEM, PEM avec retours à la ligne échappés, ou base64. | — |

### Sauvegardes (Backups)

| Variable | Description | Valeur par défaut |
|----------|-------------|-------------------|
| `BACKUP_SCHEDULE` | Expression cron pour les sauvegardes planifiées. Non défini signifie que les sauvegardes planifiées sont désactivées. | — |
| `BACKUP_DESTINATION` | Chemin local, ou une URL `s3://bucket/prefix` / `gs://bucket/prefix`. | `./backups` |
| `BACKUP_RETENTION_DAYS` | Supprimer les sauvegardes datant de plus de N jours. Non défini ou `0` conserve tout. | — |
| `BACKUP_KEEP_MINIMUM` | Toujours conserver au moins N sauvegardes les plus récentes, quelle que soit la règle de rétention. | — |
| `PG_DUMP_PATH` | Remplacer le binaire `pg_dump` — il doit correspondre à la version majeure du serveur ou être plus récent. | — |
| `PG_RESTORE_PATH` | Remplacer le binaire `pg_restore`. | — |
| `PSQL_PATH` | Remplacer le binaire `psql` que `rebase db restore --clean` exécute pour faire de la restauration une transaction unique. | — |
| `PG_DUMPALL_PATH` | Emplacement de `pg_dumpall`, lorsqu'il n'est pas dans le `PATH`. Sans cela — et sans les outils clients PostgreSQL installés — une sauvegarde des éléments globaux échoue avec une erreur mentionnant cette variable. | — |

L'image d'exécution officielle (`rebasepro/server`) intègre les outils clients
PostgreSQL 18, de sorte qu'une sauvegarde planifiée y fonctionne contre n'importe quel serveur jusqu'à Postgres 18.
En dehors de l'image, installez-les vous-même (`apt-get install postgresql-client-18`,
`brew install libpq`).

Les sauvegardes contiennent des secrets et des données personnelles (PII). Utilisez une destination privée avec
chiffrement au repos.

### Distribution de bundles

Un déploiement managé n'embarque pas son code dans l'image : le runtime récupère un
bundle au démarrage. Ces variables déterminent lequel et comment.

| Variable | Description | Valeur par défaut |
|----------|-------------|-------------------|
| `REBASE_BUNDLE` | Chemin vers un répertoire de bundle déjà extrait. Ce que `rebase start` définit localement. | — |
| `REBASE_BUNDLE_URL` | Emplacement depuis lequel récupérer l'archive du bundle, lorsqu'il n'y en a pas localement. | — |
| `REBASE_BUNDLE_TOKEN` | L'identifiant Bearer pour cette récupération. Traitez-le comme un secret : c'est ce qui autorise un tenant à télécharger son propre code. | — |
| `REBASE_BUNDLE_FETCH_DIR` | Répertoire où un bundle récupéré est extrait. Doit être accessible en écriture et persister entre la récupération et le démarrage. | — |
| `REBASE_RUNTIME_MODULES` | Modules supplémentaires que l'image runtime fournit au bundle, au-delà de ceux qu'elle déclare elle-même. | — |

### Liaisons de ressources (Resource bindings)

Chaque base de données, bucket et topic déclaré par un projet dans `config/resources.ts` est
lié par des variables d'environnement nommées d'après lui. Les noms de base sont listés ci-dessous ; une
ressource autre que celle par défaut ajoute `__` et sa clé en majuscules, ainsi un bucket appelé
`media` lit `S3_BUCKET__MEDIA`. `rebase status`
affiche, par ressource,
la variable exacte qu'il lit et si elle est définie.

| Variable | Description | Valeur par défaut |
|----------|-------------|-------------------|
| `REBASE_DRIVER` | Le package npm implémentant le pilote d'une source de données, lorsqu'il ne s'agit pas de celui par défaut pour Postgres. Suffixé par source : `REBASE_DRIVER__ANALYTICS`. | — |
| `REBASE_TOPIC_URL` | La chaîne de connexion pour un topic déclaré. Suffixé par topic. | — |

### L'environnement propre au CLI

Lu par `rebase`, pas par le serveur. Rien ici n'affecte un déploiement.

| Variable | Description | Valeur par défaut |
|----------|-------------|-------------------|
| `REBASE_BASE_URL` | Emplacement où `rebase api-keys`, `rebase storage` et `rebase auth reset-password` envoient la clé de service, dans le shell ou dans `.env`. Définissez-le lorsque le serveur s'exécute autrement que par `rebase dev` dans ce projet : `rebase start`, un conteneur, un autre hôte. Si non défini, ils utilisent le serveur que `rebase dev` a enregistré pendant qu'il tourne, et n'envoient rien s'il ne tourne pas. | — |
| `REBASE_SERVICE_KEY` | La clé de service avec laquelle ces commandes s'authentifient, lue depuis `.env` : la même variable que celle lue par le serveur (voir plus haut). | — |
| `SERVICE_KEY` | Un ancien nom pour cette clé. Lorsque `.env` le définit, `rebase api-keys` et `rebase storage` le lisent à la place de `REBASE_SERVICE_KEY`. | — |
| `REBASE_ENV_FILE_PATH` | Le fichier `.env` que le CLI lit et écrit, lorsqu'il ne s'agit pas de celui du projet. | — |
| `REBASE_CLOUD_URL` | Le plan de contrôle auquel `rebase cloud` s'adresse. | — |
| `REBASE_CLOUD_EMAIL` | Le compte sous lequel `rebase cloud login` se connecte, au lieu d'afficher une invite. | — |
| `REBASE_CLOUD_PASSWORD` | Son mot de passe, pour qu'un gestionnaire de secrets puisse le transmettre sans qu'il n'atteigne l'historique du shell. | — |
| `REBASE_TOKEN` | Un jeton issu de `rebase cloud tokens create`. S'il est défini, chaque commande `rebase cloud` s'authentifie avec lui au lieu de la session `rebase cloud login`, et ne lit ni n'écrit jamais la session stockée. Dans un répertoire que `rebase cloud init --claim` a lié, il est mis de côté au profit du jeton propre à ce projet lorsqu'il ne détient aucune portée sur le projet. La méthode recommandée pour exécuter `rebase cloud` en CI — voir [CI et agents](/docs/deployment/cloud/#ci-and-agents). Le [serveur MCP](/docs/ai/mcp/) le transmet à la CLI que lancent ses outils cloud, et ne l'envoie jamais à l'application : définissez `REBASE_API_TOKEN` pour cela. | — |
| `REBASE_DEBUG` | `1` affiche l'erreur sous-jacente et les détails de la requête au lieu du message court. Le premier réflexe à adopter lorsqu'une commande `rebase cloud` échoue sans explication claire. | — |
| `REBASE_ATLAS_DEV_URL` | La base de données vide sur laquelle `rebase db push`, `db generate` et `db migrate` planifient leurs modifications, au lieu de la base `<db>_dev_diff` qu'ils créent à côté de `DATABASE_URL`. Rebase ne crée ni ne supprime aucune base de données nommée ici, et refuse une valeur identique à `DATABASE_URL`. Sur la base de développement managée, le CLI la définit sur une instance PGlite éphémère en mémoire qui lui est propre. Définissez-la là où le privilège `CREATE DATABASE` n'est pas accordé. | `<db>_dev_diff` |
| `REBASE_DEV_NO_DB` | `rebase dev` ne démarre aucune base de données et ne provisionne rien — vous devez fournir la vôtre. Identique à `--no-db`. | — |
| `REBASE_FRONTEND_PORT` | Fixe le port du serveur de développement frontend, que `rebase dev` déduit sinon du chemin du projet. | — |
| `REBASE_DEV_READY_TIMEOUT_MS` | Temps pendant lequel `rebase dev` attend que le backend signale son initialisation avant d'indiquer qu'il n'a pas démarré. `0` désactive ce signalement. | `30000` |
| `DATABASE_PASSWORD` | Le mot de passe que `rebase dev --docker` injecte dans la chaîne de connexion déduite de `docker-compose.yml`. | — |
| `DO_NOT_TRACK` | La convention standard entre outils. Définie sur toute valeur autre que `0`, le CLI n'envoie aucune télémétrie. | — |
| `REBASE_TELEMETRY_DISABLED` | La même chose, spécifiquement pour Rebase. Ne requiert aucun fichier, c'est pourquoi elle est idéale pour la CI et dans une image. | — |
| `REBASE_TELEMETRY_ENDPOINT` | Destination d'envoi de la télémétrie, pour un collecteur auto-hébergé. | — |

## Les secrets en développement

`JWT_SECRET` est requis en production. Lui et `REBASE_SERVICE_KEY` sont
générés pour vous hors de celle-ci, afin que vous puissiez démarrer sans rien avoir à configurer.

Ces valeurs générées sont mises en cache dans `.rebase-dev-secrets.json`, aux côtés de
`.rebase-dev-port` et `.rebase-dev-url` et ignorées par git avec ces derniers. Auparavant, elles
étaient régénérées à chaque démarrage — ainsi, redémarrer le serveur de dev vous déconnectait
de votre propre application et invalidait toute clé d'API que vous veniez de créer.

- Définissez l'une ou l'autre de ces variables explicitement et la vôtre sera utilisée ; rien n'est mis en cache ni lu.
- Pointez le cache vers un autre emplacement avec `REBASE_DEV_SECRETS_FILE` — un chemin, et la
  seule variable de cette section que vous auriez un intérêt à définir délibérément.
- Supprimez le fichier pour renouveler les deux secrets. Le démarrage suivant en générera un nouveau.
- Si le fichier ne peut pas être écrit — par exemple dans un conteneur en lecture seule —, le serveur démarre
  quand même avec un secret éphémère, exactement comme auparavant.

Rien n'est mis en cache en production, ni sous un exécuteur de tests. En production, rien n'est
généré non plus : un démarrage sans `JWT_SECRET` échoue, en indiquant le nom de la variable, et ce comportement
reste inchangé :

```
The environment is not valid:
  JWT_SECRET: is required
```

## Objet de configuration Backend

Le `RebaseBackendConfig` passé à `initializeRebaseBackend()` offre un contrôle programmatique :

```typescript
import { initializeRebaseBackend } from "@rebasepro/server";
import { createPostgresAdapter } from "@rebasepro/server-postgres";
import { env } from "./env";

await initializeRebaseBackend({
    app,
    server,
    collectionsDir: "./config/collections",
    basePath: "/api",        // Base path for all API routes (default: "/api")

    database: createPostgresAdapter({
        connection: db,
        schema: { tables, enums, relations }
    }),

    auth: {                  // Authentication config
        jwtSecret: env.JWT_SECRET,
        accessExpiresIn: env.JWT_ACCESS_EXPIRES_IN,
        refreshExpiresIn: env.JWT_REFRESH_EXPIRES_IN,
        requireAuth: true,    // Require auth for data API (default: true)
        allowRegistration: env.ALLOW_REGISTRATION,
        google: env.GOOGLE_CLIENT_ID
            ? {
                clientId: env.GOOGLE_CLIENT_ID,
                clientSecret: env.GOOGLE_CLIENT_SECRET
            }
            : undefined,
        serviceKey: env.REBASE_SERVICE_KEY
    },

    // No bucket configured in production means storage is off, not local:
    // uploads answer 501 rather than landing on a filesystem that is erased
    // on the next redeploy.
    storage: env.STORAGE_TYPE === "s3"
        ? {
            type: "s3",
            bucket: env.S3_BUCKET!,
            region: env.S3_REGION,
            accessKeyId: env.S3_ACCESS_KEY_ID,
            secretAccessKey: env.S3_SECRET_ACCESS_KEY,
            endpoint: env.S3_ENDPOINT
        }
        : env.STORAGE_TYPE === "gcs"
            ? {
                type: "gcs",
                bucket: env.GCS_BUCKET!,
                projectId: env.GCS_PROJECT_ID,
                keyFilename: env.GCS_KEY_FILENAME
            }
            : isProduction && !env.FORCE_LOCAL_STORAGE
                ? undefined
                : {
                    type: "local",
                    basePath: env.STORAGE_PATH || "./uploads"
                },

    history: true,           // Enable entity change history

    enableSwagger: true,     // Enable OpenAPI docs at /api/docs

    logging: {
        level: "info"
    }
});
```

Les mêmes options,
sans `app`, `server` et `basePath` et avec un `provision` obligatoire, permettent de construire un
backend qui ne sert rien tant que vous ne le montez pas : `createRebaseBackend`. Voir
[Intégration d'un serveur personnalisé](/docs/backend/custom-server/).

### Modifier `basePath`

`basePath` déplace chaque route d'API, le client doit donc recevoir la même instruction —
autrement, il continuera d'interroger `/api/...` et obtiendra des erreurs 404 sur tout :

```typescript
import { createRebaseClient } from "@rebasepro/client";

export const rebase = createRebaseClient({
    baseUrl: "https://api.example.com",
    apiPath: "/v1"          // must match the backend's basePath
});
```

Le panneau d'administration récupère cela automatiquement à partir du client qui lui est fourni ; rien d'autre n'a besoin
d'être configuré. Si vous construisez une URL de requête manuellement, concaténez-la depuis le client au
lieu d'écrire `/api` vous-même :

```typescript
import { useApiBase } from "@rebasepro/app";

function Widget() {
    const apiBase = useApiBase();   // e.g. "https://api.example.com/v1"
    // fetch(`${apiBase}/data/products`)
}
```

## Dépannage

### Permission refusée dans l'éditeur SQL (`permission denied for table <name>`)

* **Symptômes :** Les requêtes personnalisées exécutées dans l'éditeur SQL de Rebase Studio échouent avec l'erreur `cause: error: permission denied for table <name>`, bien que la vue tableur du CMS charge les données correctement.
* **Cause :** Par défaut, Rebase tente d'exécuter les requêtes de l'éditeur SQL en basculant temporairement les rôles de base de données afin de correspondre au rôle applicatif de l'utilisateur actif (par ex., `SET LOCAL ROLE "admin"`). Si vous utilisez une authentification personnalisée où les rôles n'existent que dans des tables de base de données plutôt que sous forme de véritables rôles PostgreSQL, le changement de rôle échoue ou les privilèges de base de données manquent. La vue tableur du CMS s'exécute sous l'utilisateur propriétaire de la connexion par défaut et contourne ce mécanisme.
* **Solution :** Ajoutez `DISABLE_DB_ROLE_SWITCHING=true` à la configuration `.env` de votre backend. Cela force Rebase à exécuter les requêtes de l'éditeur SQL en utilisant les privilèges du propriétaire de la connexion (généralement un superuser/owner). L'éditeur SQL indique alors, au-dessus des résultats, que ceux-ci ont été lus en tant que propriétaire de la connexion, et grise son sélecteur de rôle.

### Échec de récupération du schéma dans l'éditeur SQL (`Cross-database execution requires adminConnectionString`)

* **Symptômes :** Studio ne parvient pas à charger l'arborescence du schéma, ou l'éditeur SQL renvoie `Failed to fetch schema: Cross-database execution requires adminConnectionString to be configured in the backend.`
* **Cause :** Rebase nécessite des privilèges d'administration pour interroger les catalogues système de la base de données et exécuter des commandes d'administration. Si `adminConnectionString` n'est pas fourni au bootstrapper, ou si `getAdmin()` est surchargé pour renvoyer `undefined`, ces opérations échouent.
* **Solution :** Assurez-vous que `adminConnectionString` est configuré lors de l'initialisation du bootstrapper backend :
  ```typescript
  createPostgresBootstrapper({
      connection: db,
      schema: { tables, enums, relations },
      adminConnectionString: process.env.ADMIN_CONNECTION_STRING || process.env.DATABASE_URL
  })
  ```

## Étapes suivantes

- **[Déploiement](/docs/getting-started/deployment)** — Guide de déploiement en production
- **[Aperçu du Backend](/docs/backend)** — Référence complète de configuration backend
