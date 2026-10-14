---
sourceHash: 1e15534f9a5fc19a
title: Environnement & Configuration
sidebar_label: Configuration
description: Toutes les variables d'environnement et options de configuration pour les projets Rebase.
---

## Variables d'environnement

Toute la configuration s'effectue via des variables d'environnement dans votre fichier `.env` à la racine du projet.

> **Important** : Rebase valide les variables d'environnement avec **Zod** au démarrage. Si
> un élément requis est manquant ou mal formé (une URL qui n'est pas une URL, un port qui
> n'est pas un nombre), le serveur refuse de démarrer et indique le nom de la variable.
>
> L'emplacement du schéma dépend de la façon dont vous exécutez le backend. Un projet démarré par
> le runtime — `rebase dev`, `rebase start`, l'image publiée — utilise le
> schéma détenu par le runtime (`loadBootEnv` dans `@rebasepro/server`), qui est
> l'union de chaque tableau ci-dessous. Un projet ayant exécuté [`rebase eject`](/docs/cli)
> possède un fichier `backend/src/env.ts` appelant `loadEnv({ extend })`, et peut y ajouter ses propres
> variables typées.

### Requises

| Variable | Description | Exemple |
|----------|-------------|---------|
| `DATABASE_URL` | Chaîne de connexion PostgreSQL. **Optionnelle en développement** — non définie, `rebase dev` exécute un PostgreSQL géré pour le projet, avec ses données sous `.rebase/`. Requise partout ailleurs. | `postgresql://user:pass@localhost:5432/mydb` |
| `JWT_SECRET` | Clé secrète pour signer les jetons JWT. Utilisez une chaîne aléatoire robuste (min 32 caractères). **Requise en production** (auto-générée en développement). | `a1b2c3d4e5...` |

> **`sslmode=no-verify` est une syntaxe propre à node-postgres, pas à libpq.**
>
> Rebase et le pilote Node l'acceptent — chiffrer, mais ne pas vérifier le
> certificat. `psql`, `pg_dump`, `pg_restore` et Atlas ne l'acceptent pas, et ils ne se
> dégradent pas gracieusement : ils refusent de démarrer avec `invalid sslmode value: "no-verify"`.
>
> Les commandes propres à Rebase (`rebase db push`, `rebase db backup`, `rebase db
> restore`) la réécrivent en l'équivalent `sslmode=require` avant d'exécuter la commande shell,
> de sorte qu'elles fonctionnent avec l'URL telle que configurée. Utiliser `psql` manuellement ne le
> fait pas — remplacez-la par `sslmode=require` à cet endroit, ce qui chiffre sans vérifier exactement
> de la même manière.

### Frontend

| Variable | Description | Par défaut |
|----------|-------------|------------|
| `VITE_API_URL` | URL de l'API backend pour le SDK typé. **À définir uniquement en développement** — voir ci-dessous. | origine de la page |
| `VITE_GOOGLE_CLIENT_ID` | Identifiant client Google OAuth. Active « Se connecter avec Google ». | — |


> **Laissez `VITE_API_URL` non définie dans les builds de production.**
>
> En développement, le frontend et le backend ont des origines distinctes, donc le serveur
> de dev injecte cette valeur. En production, le backend Rebase sert la SPA, l'API a
> donc la même origine que la page et le client la résout ainsi de lui-même.
>
> Figer une URL absolue dans un bundle de production fonctionne jusqu'au moment où un second
> nom d'hôte pointe vers la même application : un domaine personnalisé charge alors la page depuis
> `example.com` et appelle l'API sur `example.rebase.website`, ce qui est
> cross-origin, et chaque requête échoue lors du preflight. Autoriser l'origine dans CORS
> ne résout **pas** non plus le problème — le cookie de rafraîchissement est `SameSite=Lax` et n'est
> pas envoyé cross-site ; vous élimineriez donc les erreurs de console tout en conservant une
> authentification cassée. Lorsqu'elle n'est pas définie, chaque domaine pointant vers l'application fonctionne sans aucune
> configuration CORS.

### Backend

| Variable | Description | Par défaut |
|----------|-------------|------------|
| `PORT` | Port pour le serveur HTTP backend. Lu par `rebase start`. `rebase dev` le lit **uniquement depuis l'environnement du shell** — un `PORT` dans `.env` n'est pas lu à cet endroit, car le port est résolu avant le chargement de ce fichier — et lie sinon un port dérivé du chemin du projet, permettant à plusieurs projets de tourner simultanément. `rebase dev --port` a la priorité sur les deux, et la bannière de démarrage indique le niveau utilisé. | `3001` |
| `LOG_LEVEL` | Niveau de verbosité des logs : `error`, `warn`, `info`, `debug` | `info` |
| `REBASE_LOG_RAW_QUERIES` | Affiche le SQL derrière une ligne `Failed query: [redacted]`. Chaque instruction en échec est masquée par défaut, car une requête échouée contient ses paramètres liés — un e-mail, un hash de mot de passe. Définissez-la à `true` lors du diagnostic d'une défaillance DDL, RLS ou de capture de modifications. Ignorée lorsque `NODE_ENV=production`. | `false` |
| `NODE_ENV` | Environnement : `development`, `production`, ou `test` | `development` |
| `CORS_ORIGINS` | Liste séparée par des virgules des origines autorisées. **Requise en production** si différente du domaine backend. En développement, elle est *ajoutée à* localhost — voir ci-dessous. | — |
| `FRONTEND_URL` | URL de l'application frontend. Utilisée comme alternative à CORS_ORIGINS, dans les deux environnements. | — |
| `ADMIN_CONNECTION_STRING` | Chaîne de connexion à la base de données de niveau administrateur (utilisée pour l'introspection de schéma et les opérations d'administration). La base de données qu'elle nomme n'est pas celle que la console SQL considère comme actuelle, ni celle qu'une nouvelle branche copie par défaut : les deux correspondent à la base sur laquelle se trouve la connexion propre à l'application (voir `REBASE_BRANCH_PARENT_DATABASE` pour un serveur sur une branche). | `DATABASE_URL` |
| `DISABLE_DB_ROLE_SWITCHING` | Désactive le changement de rôle PostgreSQL dans l'éditeur SQL (utile pour l'authentification personnalisée où les rôles de base de données ne sont pas mappés). La console SQL de Studio indique alors que les lignes ont été lues en tant que propriétaire de la connexion, le nomme, et grise son sélecteur de rôle. | `false` |
| `REBASE_BRANCH_PARENT_DATABASE` | La base de données depuis laquelle la branche sur laquelle ce serveur tourne a été copiée. `rebase dev` la définit sur un checkout [basculé sur une branche](/docs/backend/branching/#cli-integration). Un serveur disposant de cette variable conserve le registre des branches sur cette base de données et copie les nouvelles branches depuis celle-ci par défaut, de sorte que le volet Branches de Studio affiche les branches de la base principale. | — |

#### CORS en développement

Le développement autorise **localhost, plus tout ce que `CORS_ORIGINS` (ou `FRONTEND_URL`)
mentionne** — la même liste que celle utilisée en production, avec localhost ajouté plutôt que
substitué. Ainsi, la variable fonctionne de la même manière dans les deux environnements, et les
cas nécessitant son utilisation en développement sont classiques :

```bash
# A phone on the LAN, a colleague's machine, an ngrok tunnel,
# a forwarded Codespaces port — all non-localhost origins.
CORS_ORIGINS=http://192.168.1.5:5173
```

Une origine qui n'est ni localhost ni répertoriée est refusée, et le refus est
journalisé **une seule fois par origine** avec la ligne exacte qui permettrait de l'autoriser. Le refus n'est
pas une simple précaution gratuite : l'API transmet des identifiants, refléter une
`Origin` arbitraire permettrait donc à n'importe quel site visité par le développeur d'effectuer
des requêtes authentifiées contre le serveur de dev avec sa session et d'en lire
les réponses.

### Authentification

| Variable | Description | Par défaut |
|----------|-------------|------------|
| `JWT_SECRET` | Secret pour la signature JWT (requis en production, auto-généré en développement) | — |
| `JWT_PRIVATE_KEY` | Clé privée PEM pour signer les jetons d'accès de manière asymétrique (RS256), afin que toute entité détenant le JWKS puisse vérifier une session sans pouvoir en forger une. Accepte un PEM avec de vrais sauts de ligne, un PEM avec des échappements `\n`, ou l'encodage base64 de l'ensemble du PEM. Sans elle, les jetons restent en HS256. | — |
| `JWT_KEY_ID` | Identifie la `JWT_PRIVATE_KEY` dans l'en-tête du jeton et dans le JWKS. Modifiez-la à chaque changement de clé — la rotation repose sur la distinction entre l'ancienne et la nouvelle clé. | `default` |
| `JWT_ACCESS_EXPIRES_IN` | Durée de vie du jeton d'accès | `1h` |
| `JWT_REFRESH_EXPIRES_IN` | Durée de vie du jeton de rafraîchissement. Glissante — chaque rotation la renouvelle, cela régit donc le temps de survie d'une session en cas **d'inactivité**. Définissez `400d` pour les sessions persistant après une longue absence ; les navigateurs plafonnent le cookie de rafraîchissement à cette valeur. | `30d` |
| `ALLOW_REGISTRATION` | Autorise l'inscription de nouveaux utilisateurs (`true`/`false`). Hors production, le **premier** utilisateur peut toujours s'inscrire, quelle que soit cette valeur — une table d'utilisateurs vide doit accepter quelqu'un, et cette personne devient administrateur. En production (`NODE_ENV=production`), cette fenêtre est fermée : une table vide refuse l'inscription d'amorçage avec `SETUP_REQUIRED`, un premier compte créé via inscription ouverte est un compte ordinaire, et l'administrateur est défini avec `REBASE_ADMIN_EMAIL` ci-dessous ou attribué avec la clé de service. Le fichier `.env.example` de base le définit à `true` ; la valeur par défaut du framework est désactivée. | `false` |
| `DISABLE_SELF_REGISTRATION` | Coupe-circuit. Ferme la fenêtre d'amorçage du premier utilisateur que `ALLOW_REGISTRATION=false` laisse délibérément ouverte hors production, de sorte que l'inscription est fermée même face à une base de données vide. À associer avec `REBASE_ADMIN_EMAIL` ci-dessous, sinon le déploiement n'a aucun moyen de produire son premier appelant authentifié. Chaque artefact de déploiement livré la définit. | — |
| `REBASE_ADMIN_EMAIL` | Adresse e-mail du premier compte administrateur, créé au démarrage **tant que la table des utilisateurs est encore vide** et jamais après. C'est ainsi qu'un déploiement de production obtient son administrateur : l'opérateur désigne le premier compte au lieu de faire la course avec Internet. Le démarrage émet un avertissement lorsque la table est vide en production et que cette variable n'est pas définie. | — |
| `REBASE_ADMIN_PASSWORD` | Mot de passe de ce compte. Au moins 12 caractères, sinon il est refusé et le compte n'est pas créé. Modifiez-le après la première connexion. | — |
| `MFA_ENCRYPTION_KEY` | Chiffre chaque secret TOTP stocké. Non définie, les secrets sont chiffrés avec `JWT_SECRET` à la place et le démarrage émet un avertissement unique — faire tourner `JWT_SECRET` déconnecte alors tout le monde *et* rend chaque authentificateur enregistré indéchiffrable. Définissez une clé dédiée (32+ caractères aléatoires) avant toute inscription. | — |
| `MFA_ENCRYPTION_KEY_PREVIOUS` | La clé *précédente* lors d'une rotation. Définissez les deux lors d'une rotation : les nouveaux secrets sont écrits avec `MFA_ENCRYPTION_KEY` et les existants restent lisibles, évitant ainsi de bloquer l'accès aux comptes pendant la transition. Supprimez-la une fois que chaque secret a été rechiffré. | — |
| `ALLOW_ANONYMOUS` | Active la connexion anonyme (`POST /api/auth/anonymous`). Optionnelle, et délibérément non conditionnée par `ALLOW_REGISTRATION`. | `false` |
| `AUTH_REQUIRE` | Exige l'authentification pour l'API de données. Définissez à `false` pour une surface de lecture entièrement publique — la RLS s'applique toujours. | `true` |
| `AUTH_DEFAULT_ROLE` | Rôle attribué à un utilisateur nouvellement inscrit lorsqu'aucun n'est spécifié. | — |
| `AUTH_ALLOW_USER_LOOKUP` | Monte `POST /api/auth/find-user`, qui résout un e-mail en un profil public minimal (`uid`, `displayName`, `photoURL`) pour les flux d'invitation par e-mail. Appelants authentifiés uniquement, et ne renvoie jamais l'e-mail, les rôles ou les métadonnées de l'utilisateur trouvé. Désactivé par défaut : il s'agit d'une surface d'énumération. | `false` |
| `AUTH_COOKIE_SAME_SITE` | `SameSite` sur le cookie de rafraîchissement : `Strict`, `Lax` ou `None`. `None` requiert HTTPS et est réservé à un frontend véritablement cross-site. | `Lax` |
| `AUTH_COOKIE_SECURE` | `Secure` sur le cookie de rafraîchissement. Sécurisé par défaut ; `AUTH_COOKIE_SECURE=false` pour le http simple — un déploiement sur une adresse de réseau local où le navigateur rejetterait autrement le cookie et où la session s'arrêterait à l'expiration du jeton d'accès sans erreur. Émet un avertissement au démarrage. `http://localhost` n'en a pas besoin. | `true` |
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
| `GITLAB_CLIENT_ID` | Identifiant client GitLab OAuth. La `baseUrl` d'une instance auto-hébergée n'a pas de variable d'environnement dédiée — configurez GitLab dans le bloc `auth` pour cela. | — |
| `GITLAB_CLIENT_SECRET` | Secret client GitLab OAuth | — |
| `BITBUCKET_CLIENT_ID` | Identifiant client Bitbucket OAuth | — |
| `BITBUCKET_CLIENT_SECRET` | Secret client Bitbucket OAuth | — |
| `SLACK_CLIENT_ID` | Identifiant client Slack OAuth | — |
| `SLACK_CLIENT_SECRET` | Secret client Slack OAuth | — |
| `SPOTIFY_CLIENT_ID` | Identifiant client Spotify OAuth | — |
| `SPOTIFY_CLIENT_SECRET` | Secret client Spotify OAuth | — |
| `APPLE_CLIENT_ID` | Identifiant Apple Services. Apple n'a pas de secret client statique — Rebase signe un JWT ES256 à courte durée de vie par échange de jeton — elle nécessite donc les quatre valeurs `APPLE_*`, et ne configure rien sans elles. | — |
| `APPLE_TEAM_ID` | Identifiant de l'équipe Apple Developer, l'émetteur du JWT. | — |
| `APPLE_KEY_ID` | Identifiant de la clé privée enregistrée auprès d'Apple. | — |
| `APPLE_PRIVATE_KEY` | Contenu du fichier de clé privée `.p8`, sauts de ligne inclus (les échappements `\n` sont acceptés). | — |
| `REBASE_SERVICE_KEY` | Clé d'API d'administration statique. Contourne l'authentification JWT normale pour les appels de serveur à serveur lorsqu'elle est transmise sous forme de `Authorization: Bearer <key>`. (Auto-générée en développement). | — |
| `REBASE_PLATFORM_TOKEN_KEY` | La clé publique de la plateforme d'hébergement (PEM, EC P-256) utilisée pour vérifier les jetons de plateforme `rpt_` ; plusieurs blocs PEM lors d'une rotation de clés. La plateforme la définit au déploiement, et elle ne contient aucun secret. Associée à `REBASE_PLATFORM_TOKEN_AUDIENCE`, elle permet au portail d'administration d'accepter un jeton de plateforme pour `cron:read`, et pour rien d'autre. | — |
| `REBASE_PLATFORM_TOKEN_AUDIENCE` | L'identifiant de projet auquel le champ `aud` d'un jeton de plateforme doit correspondre, de sorte qu'un jeton généré pour un autre projet soit refusé. Si une seule des deux variables est définie, le serveur démarre, consigne un avertissement et répond à chaque jeton `rpt_` par un `401 PLATFORM_TOKENS_OFF`. | — |
| `REBASE_RATE_LIMIT_STORE` | Emplacement des compteurs de limitation de débit d'authentification : `memory` (par processus) ou `sql` (partagé entre les réplicas). Un processus ne pouvant pas voir le nombre de ses propres réplicas, un déploiement avec plusieurs pairs doit le spécifier — trois réplicas avec la configuration par défaut appliquent trois fois la limite. Toute autre valeur **refuse de démarrer** plutôt que de se rabattre sur une alternative, y compris `postgres`. | `memory` |
| `AUTH_MAGIC_LINK` | Monte le flux de lien de connexion sans mot de passe. Nécessite la configuration d'un service d'e-mail, sinon le lien ne peut être envoyé nulle part. | `false` |
| `AUTH_EMAIL_OTP` | Monte la connexion sans mot de passe avec un code à six chiffres envoyé par e-mail. Même exigence d'e-mail que ci-dessus. | `false` |
| `AUTH_MAGIC_LINK_CREATES_USERS` | Inscription sans mot de passe : une demande de lien magique ou de code par e-mail pour une adresse inconnue crée le compte, tant que l'inscription est ouverte. | `false` |
| `AUTH_REFRESH_TOKEN_REUSE` | Comportement lors du rejeu d'un jeton de rafraîchissement après sa fenêtre de réutilisation : `reject` (le refuser, conserver la session) ou `revoke-session` (mettre fin à la connexion). Toute autre valeur fait échouer le démarrage. | `reject` |
| `AUTH_REQUIRE_EMAIL_VERIFICATION` | Inscription avec confirmation préalable : aucune connexion par mot de passe tant que l'adresse n'est pas vérifiée. Nécessite l'e-mail ; le démarrage est refusé sans lui. | `false` |
| `CAPTCHA_PROVIDER` | Active la vérification par captcha sur les routes d'authentification : `turnstile` ou `hcaptcha`. Non défini signifie pas de captcha. | — |
| `CAPTCHA_SECRET` | Le secret du fournisseur, utilisé côté serveur pour vérifier le jeton envoyé par le navigateur. Requis dès que `CAPTCHA_PROVIDER` est défini. | — |
| `CAPTCHA_ROUTES` | Routes d'authentification à protéger séparées par des virgules (par exemple `register,login`). Non défini protège l'ensemble par défaut du fournisseur. | — |

### Stockage

:::caution[Le stockage ne dispose pas de sécurité au niveau des lignes, il nécessite donc un modèle d'accès]
Les collections sont protégées par la RLS de Postgres. Le stockage d'objets n'a pas d'équivalent —
les clés partagent un espace de noms plat unique — donc avec un bucket configuré et aucun modèle d'accès,
le serveur **refuse de démarrer en production**. Répondez à cette exigence avec exactement l'un des éléments suivants :
un hook `storageAuthorize` exporté depuis `config/index.ts` (ce que fournit le scaffold),
`STORAGE_PUBLIC_READ`, ou `STORAGE_ALLOW_ANY_AUTHENTICATED`.
:::

| Variable | Description | Par défaut |
|----------|-------------|------------|
| `STORAGE_TYPE` | Backend de stockage : `local`, `s3` ou `gcs`. En production, `local` désactive le stockage à moins que `FORCE_LOCAL_STORAGE=true` | `local` |
| `STORAGE_PATH` | Chemin de base pour le stockage local. Un chemin relatif est lu depuis le répertoire où tourne le serveur : la racine du projet sous `rebase dev`, `backend/` dans un serveur écrit par `rebase eject` | `<project>/uploads` |
| `FORCE_LOCAL_STORAGE` | Autorise le stockage local en production — uniquement avec un volume persistant contenant `STORAGE_PATH` et les répertoires `<STORAGE_PATH>__<key>` des buckets locaux nommés à côté | `false` |
| `STORAGE_DOWNLOAD_TOKEN_TTL` | Durée de validité en secondes de l'URL de téléchargement d'un fichier privé — le jeton que `getSignedUrl()` y insère. Au maximum `604800` (une semaine) | `300` |
| `STORAGE_MAX_FILE_SIZE` | Taille maximale de fichier acceptée par la source, en octets, sur chaque chemin d'upload — `__<KEY>` pour une source nommée. Une valeur qui n'est pas un nombre entier d'octets refuse le démarrage | `52428800` (50 Mo) |
| `S3_BUCKET` | Nom du bucket S3 (lorsque `STORAGE_TYPE=s3`) | — |
| `S3_REGION` | Région AWS | — |
| `S3_ACCESS_KEY_ID` | Clé d'accès AWS | — |
| `S3_SECRET_ACCESS_KEY` | Clé secrète AWS | — |
| `S3_ENDPOINT` | Point de terminaison S3 personnalisé (pour MinIO, Cloudflare R2, etc.) | — |
| `S3_FORCE_PATH_STYLE` | Force les URL de style chemin pour le bucket S3 (`true`/`false`) | `false` |
| `GCS_BUCKET` | Nom du bucket GCS (lorsque `STORAGE_TYPE=gcs`) | — |
| `GCS_PROJECT_ID` | Projet GCP. Généralement déduit des identifiants. | — |
| `GCS_KEY_FILENAME` | Chemin vers un fichier de clé de compte de service. À omettre sur GCP, où Workload Identity fournit les identifiants. | — |
| `STORAGE_PUBLIC_READ` | Sert chaque objet à tout le monde, sans jeton. Uniquement pour un bucket qui est véritablement un CDN public. L'une des trois manières de satisfaire la protection de démarrage ci-dessous. | `false` |
| `STORAGE_ALLOW_ANY_AUTHENTICATED` | Permet à tout appelant connecté de lire, écrire, lister et supprimer chaque objet. Nommé `INSECURE` dans l'objet de configuration pour une bonne raison : cela n'est défendable que dans une application mono-tenant où chaque compte a accès à chaque fichier en toute confiance. | `false` |
| `STORAGE_RENDITION_CACHE` | Met en cache les rendus d'images générés (redimensionnements, conversions de format) au lieu de les produire à chaque requête. | `false` |

### E-mail (Optionnel)

| Variable | Description |
|----------|-------------|
| `SMTP_HOST` | Hôte du serveur SMTP |
| `SMTP_PORT` | Port du serveur SMTP |
| `SMTP_SECURE` | Active la connexion sécurisée (`true`/`false`) |
| `SMTP_USER` | Nom d'utilisateur SMTP |
| `SMTP_PASS` | Mot de passe SMTP |
| `SMTP_FROM` | Adresse d'expéditeur pour les e-mails système |
| `SMTP_NAME` | Nom d'affichage sur l'adresse d'expéditeur |
| `APP_NAME` | Nom du produit utilisé dans les objets et corps d'e-mails (par défaut : `Rebase`) |
| `EMAIL_LOGO_URL` | Logo affiché en haut des modèles d'e-mails par défaut. PNG ou JPG absolu en `http(s)` — les clients suppriment le SVG et bloquent les URI `data:`. Non défini, une application toujours nommée `Rebase` reçoit le logo Rebase et une application renommée n'en reçoit aucun |

### Pool de connexions à la base de données

| Variable | Description | Par défaut |
|----------|-------------|------------|
| `DB_POOL_MAX` | Nombre maximal de connexions mutualisées | `20` |
| `DB_POOL_IDLE_TIMEOUT` | Millisecondes pendant lesquelles une connexion inactive est conservée | `30000` |
| `DB_POOL_CONNECT_TIMEOUT` | Millisecondes à attendre pour obtenir une connexion | `10000` |
| `DATABASE_DIRECT_URL` | Connexion directe (non mutualisée). Le [Temps réel](/docs/backend/realtime) en a besoin : `LISTEN`/`NOTIFY` ne survit pas à un pooler de transactions tel que PgBouncer, et sans elle, les notifications de changement sont désactivées avec un avertissement plutôt que perdues silencieusement. Le [worker de tâches](/docs/backend/jobs) maintient également son `LISTEN` de réveil dessus. <span class="since-badge" data-since="0.25">Depuis 0.25</span> Renseigne le `directConnectionString` de l'adaptateur Postgres lorsque celui-ci n'est pas défini. | — |
| `DATABASE_READ_URL` | Réplica de lecture. Les lectures y sont dirigées lorsqu'elle est définie et diffère de `DATABASE_URL` ; si la connexion échoue, tout bascule sur l'instance principale avec un avertissement. <span class="since-badge" data-since="0.25">Depuis 0.25</span> Renseigne le `readConnectionString` de l'adaptateur Postgres lorsque celui-ci n'est pas défini ; sur 0.24, cette option est ignorée. | — |
| `REBASE_DB_POOL_MAX` | Un plafond sur chaque pool du processus, appliqué indépendamment de la demande de chacun. Chiffres bruts uniquement : une valeur mal formée est ignorée plutôt que de sérialiser silencieusement le serveur. | — |

### Comportement du runtime

Lu par le runtime — `rebase dev`, `rebase start` et l'image de serveur
publiée. Un projet éjecté prend lui-même ces décisions dans son propre code.

| Variable | Description | Par défaut |
|----------|-------------|------------|
| `REBASE_RLS_AUDIT` | `true` exécute l'[audit de sécurité au niveau des lignes](/docs/rls-check#running-it-on-a-schedule) planifié, qui signale les tables servies sans politiques. Le projet doit déclarer `@rebasepro/rls-check` parmi ses dépendances : le runtime n'en fournit aucune copie, et sans le paquet, le démarrage refuse de s'exécuter en le nommant. `false` désactive l'analyse pour ce processus. | — |
| `REBASE_BASE_PATH` | Chemin de base pour chaque route d'API. Le client doit être informé de la même valeur — voir [Modification de `basePath`](#modification-de-basepath). | `/api` |
| `REBASE_SERVE_STATIC` | Sert les ressources statiques/admin du bundle depuis ce processus. Désactivez-le lorsqu'un CDN est placé devant. | `true` |
| `REBASE_HISTORY` | Enregistre l'[historique des modifications d'entités](/docs/backend/history). | `true` |
| `REBASE_COMPRESSION` | Réponses compressées en gzip/brotli. | `true` |
| `REBASE_MAX_BODY_SIZE` | Taille maximale du corps de la requête, **en octets** (`10485760`, pas `10MB` — une valeur qui n'est pas un nombre refuse de démarrer plutôt que de supprimer silencieusement la limite). | — |
| `REBASE_ENABLE_SWAGGER` | La surface OpenAPI. Trois états : non défini signifie activé en développement, désactivé en production ; `false` désactive les deux partout. Notez que `true` en production sert la **spécification** sur `/api/docs` mais pas l'**interface UI** Swagger sur `/api/swagger` — l'UI est conditionnée séparément par `NODE_ENV`. | — |
| `REBASE_METRICS` | Expose les métriques Prometheus sur `/metrics`. | `false` |
| `REBASE_HSTS_INCLUDE_SUBDOMAINS` | Ajoute `includeSubDomains` à l'en-tête `Strict-Transport-Security`, de sorte que les navigateurs refusent le HTTP simple sur chaque sous-domaine de l'hôte pendant six mois — y compris les hôtes que ce processus ne sert pas. Ne l'activez que si chaque sous-domaine du domaine est exclusivement en HTTPS. Toute valeur autre que `true`/`false` refuse de démarrer. Voir [En-têtes de sécurité](/docs/deployment/self-hosting/#security-headers). | `false` |
| `REBASE_METRICS_TOKEN` | Jeton Bearer protégeant `/metrics`. Non défini laisse le point de terminaison ouvert à tout ce qui peut atteindre le port — sans problème sur un réseau privé, mais pas sur un réseau public, et les logs de démarrage le signalent. | — |
| `REBASE_MIGRATE_ON_BOOT` | Ce que le runtime est autorisé à faire sur le schéma au démarrage. `ensure` (la valeur par défaut, partout — y compris en production) exécute la passe **additive** : créer les tables, colonnes et types enum manquants, sans jamais en supprimer ni en réécrire aucun. `none` ne touche à rien. L'image publiée n'accepte que ces deux valeurs et **refuse de démarrer avec `push`**. Dans un [déploiement scindé](/docs/deployment/split-processes), un seul processus peut provisionner, donc chaque autre rôle doit être configuré sur `none` sous peine de refuser de démarrer. | `ensure` |
| `REBASE_REQUIRE_SCHEMA_MATCH` | Refuse de démarrer lorsque la base de données a été provisionnée pour la dernière fois à partir d'un ensemble de collections différent de celui avec lequel ce processus a été compilé. Non défini (ou toute valeur autre que `true`/`1`) émet un simple avertissement. | warn |
| `REALTIME_CDC` | Capture de données modifiées (CDC) au niveau de la base de données : `auto` (activer là où la connexion le permet, se rabattre silencieusement sinon), `trigger` (forcer, avertir si impossible), `wal` (se dégrade en `trigger` actuellement), `off`. Voir [Temps réel](/docs/backend/realtime-cdc/). <span class="since-badge" data-since="0.25">Depuis 0.25</span> Prédomine sur `realtime.cdc`. | `auto` |
| `REALTIME_CHANNEL_BUS` | Transport inter-instances pour les canaux de diffusion et la présence : `memory` ou `postgres`. Ignoré lorsque `realtime.bus` a reçu un transport instancié. | `memory` |
| `REALTIME_MAX_SUBSCRIPTIONS_PER_SOCKET` | Nombre maximal d'abonnements qu'un socket temps réel peut détenir ; le suivant est refusé avec `TOO_MANY_SUBSCRIPTIONS`. Un nombre entier positif — toute autre valeur interrompt le serveur au démarrage. Prédomine sur `realtime.maxSubscriptionsPerSocket`. Voir [Temps réel](/docs/backend/realtime#what-a-write-costs-and-the-limits). | `1000` |
| `REALTIME_MAX_SOCKETS_PER_USER` | <span class="since-badge" data-since="0.25">Depuis 0.25</span> Nombre de sockets temps réel qu'un utilisateur peut maintenir ouverts sur une instance de serveur. La connexion du suivant est refusée avec `TOO_MANY_SOCKETS` et le socket est fermé (4002) ; le SDK continue d'essayer, il s'y connectera donc dès qu'un autre se fermera. Un nombre entier positif — toute autre valeur interrompt le serveur au démarrage. Prédomine sur `realtime.maxSocketsPerUser`. | Sans plafond |
| `REALTIME_REFETCH_MAX_WAIT_MS` | <span class="since-badge" data-since="0.25">Depuis 0.25</span> Le temps d'attente maximal d'une modification avant la ré-interrogation (refetch) qui la délivre aux abonnés en direct, en ms. Une ré-interrogation attend 300 ms sans changement, et au plus cette durée en cas de flux constant d'écritures. Un nombre entier positif — toute autre valeur interrompt le serveur au démarrage. Prédomine sur `realtime.refetchMaxWaitMs`. | `1000` |
| `REALTIME_RECOUNT_INTERVAL_MS` | <span class="since-badge" data-since="0.25">Depuis 0.25</span> Durée pendant laquelle le total d'un abonnement à une grande liste peut être réutilisé avant d'être recompté, en ms ; les frames qui le réutilisent portent `meta.totalAsOf`. Non défini, chaque frame est comptée. Prédomine sur `realtime.recountIntervalMs`. | Non défini |
| `REALTIME_RECOUNT_MIN_ROWS` | <span class="since-badge" data-since="0.25">Depuis 0.25</span> Le dernier total minimal auquel s'applique `REALTIME_RECOUNT_INTERVAL_MS` ; les listes plus petites sont comptées à chaque frame. Prédomine sur `realtime.recountMinRows`. | `100000` |
| `ALLOW_LOCALHOST_IN_PRODUCTION` | Autorise les valeurs `localhost`/loopback sous `NODE_ENV=production`. Désactivé, afin qu'un démarrage en production échoue explicitement plutôt que de se connecter à une base de données inexistante. | `false` |
| `REBASE_STRICT_COLLECTION_CONFIG` | Comportement au démarrage face à une clé de vos collections que cette version ne lit pas : `warn`, `error` (refuser de démarrer — utile à activer en CI), ou `off`. Ne régit que les clés qu'il ne *reconnaît* pas, qui sont généralement une faute de frappe et occasionnellement des métadonnées délibérées ; une clé qu'il sait avoir été déplacée est toujours fatale, car la fonctionnalité configurée serait autrement silencieusement absente. | `warn` |
| `REBASE_PROVISION_ONLY` | `1`/`true` exécute la passe de schéma et quitte sans ouvrir de socket — la configuration attendue pour un Job de migration, à partir de la même image et du même bundle que le serveur qui le suit. Une valeur vide équivaut à *non défini*, de sorte qu'un `${SOMETHING}` non substitué dans un fichier compose ne puisse pas transformer un déploiement ordinaire en un déploiement qui migre et refuse de servir les requêtes. | — |
| `REBASE_LIVE_SCHEMA_ALLOW_MACHINE_APPLY` | `true` permet à une machine — un agent, un job CI — d'*appliquer* une modification de schéma via `/api/admin/schema`, et pas seulement d'en planifier une. Désactivé sauf demande expresse : l'identifiant qui effectuerait une telle modification est le plus susceptible de se trouver dans une variable CI. | `false` |
| `REBASE_FUNCTIONS_TIMEOUT_MS` | Durée maximale d'exécution d'une fonction personnalisée avant que sa requête ne soit interrompue. Même paramètre que l'option `functionsTimeoutMs`. | — |
| `REBASE_EXIT_ON_UNHANDLED_REJECTION` | `true` fait en sorte qu'un rejet de promesse non géré termine le processus au lieu de simplement le journaliser. Activé sous un orchestrateur qui se chargera de redémarrer l'instance ; désactivé là où un redémarrage est pire qu'une fuite. | `false` |
| `REBASE_CRON_ALWAYS_ON` | Maintient le planificateur cron actif sur une plateforme que le runtime détecte autrement comme étant à dimensionnement à zéro (scale-to-zero), où un minuteur qui se déclenche dans une instance inactive ne s'exécute dans aucune instance. | — |
| `TRUSTED_PROXY_HOPS` | Nombre de proxys placés devant ce serveur, afin que le limiteur de débit puisse extraire l'adresse réelle du client depuis `X-Forwarded-For`. Valeur par défaut sécurisée `0` : sans proxy, faire confiance à cet en-tête permettrait à n'importe quel appelant d'usurper une identité. | `0` |

:::note[Le provisionnement au démarrage est additif et n'est pas un outil de migration]
La passe de démarrage s'exécute sans surveillance humaine pour analyser un diff, elle ne supprimera
donc jamais une colonne, ne réduira jamais un type et ne réécrira jamais une table. C'est également pourquoi l'image refuse
`REBASE_MIGRATE_ON_BOOT=push` : un push complet calcule un diff et exécutera volontiers
`DROP COLUMN`, or le redémarrage d'un conteneur ne doit jamais détruire une
colonne de production comme effet secondaire d'un réordonnancement.

Les modifications destructives ou structurelles restent là où elles peuvent être vérifiées : `rebase db
generate` + `rebase db migrate`, ou `rebase db push` depuis un checkout ou la CI,
qui effectue une simulation de la modification (dry-run), refuse les opérations destructives sans confirmation, et
peut effectuer une sauvegarde au préalable.
:::

### Déploiements scindés

Une image et un bundle uniques peuvent être démarrés plusieurs fois, chacun servant une
partie différente du projet. Une ligne chacun ici, car cette page a pour vocation de
lister chaque variable ; ce que chaque combinaison *monte et possède* — et quelles
combinaisons refusent de démarrer — est décrit sur la page
**[Processus scindés](/docs/deployment/split-processes)**.

| Variable | Description | Par défaut |
|----------|-------------|------------|
| `REBASE_ROLE` | Quelle partie ce processus dessert : `all`, `api`, `functions` ou `worker`. | `all` |
| `REBASE_CRON_SCHEDULER` | Force l'exécution des minuteurs cron sur *ce* processus ou non. Non défini suit le rôle. | — |
| `REBASE_JOB_WORKERS` | Force l'exécution des workers de files d'attente de tâches sur ce processus ou non. Non défini suit le rôle. | — |
| `REBASE_FUNCTIONS_ONLY` | Sert uniquement les fonctions personnalisées nommées dans ce processus. | — |
| `REBASE_FUNCTIONS_EXCLUDE` | Sert toutes les fonctions personnalisées sauf celles nommées. | — |
| `REBASE_FUNCTIONS_UPSTREAM` | Emplacement vers lequel le processus API redirige une requête de fonction qu'il ne sert pas lui-même. | — |

### Surface MCP

Un point de terminaison Model Context Protocol optionnel sur `/mcp`, afin qu'un client IA puisse lire
et écrire dans ce projet **en tant qu'utilisateur connecté**. Désactivé sauf configuration explicite, et — contrairement
à toutes les autres surfaces — aucun `REBASE_ROLE` ne l'active : les autres décrivent une
forme de processus, tandis que celle-ci est une décision de transmettre des identifiants à un logiciel
tiers, qui doit être prise par un être humain plutôt qu'héritée du rôle d'un
conteneur.

| Variable | Description | Par défaut |
|----------|-------------|------------|
| `REBASE_MCP_ENABLED` | Monte la surface MCP. Requiert `REBASE_PUBLIC_URL` ; sans elle, la surface refuse de se monter et le signale dans le log de démarrage. | `false` |
| `REBASE_PUBLIC_URL` | L'origine externe accessible de ce déploiement, par ex. `https://app.example.com`. La surface MCP ne peut pas la déduire — récupérer l'origine depuis l'en-tête `Host` ferait de l'identité de l'émetteur, et de l'audience par rapport à laquelle ses propres jetons sont vérifiés, une valeur fournie par l'appelant. | — |
| `REBASE_MCP_OPEN_REGISTRATION` | Autorise l'enregistrement dynamique de clients OAuth (RFC 7591), afin qu'un client puisse s'enregistrer de lui-même. Définissez à `false` pour exiger que les clients soient enregistrés à l'avance. | `true` |

### Édition de schéma en direct depuis un bundle

Désactivée sauf si `REBASE_LIVE_SCHEMA_REPOSITORY` est défini. Un bundle compilé n'a pas de
source de collections à modifier ; une fois ces variables configurées, l'éditeur de collections de l'administrateur lit
la source depuis le dépôt, commite chaque modification en retour et exécute son DDL sur
cette base de données. Réservé aux administrateurs, et appliqué manuellement par une personne sauf si
`REBASE_LIVE_SCHEMA_ALLOW_MACHINE_APPLY` en dispose autrement. Un dépôt spécifié sans
identifiant exploitable refuse de démarrer. Voir
[Édition de schéma en direct](/docs/backend/live-schema-editing#from-a-built-bundle).

| Variable | Description | Par défaut |
|----------|-------------|------------|
| `REBASE_LIVE_SCHEMA_REPOSITORY` | Le dépôt GitHub sur lequel commiter les modifications de schéma, au format `owner/name`. Le définir active la fonctionnalité. | — |
| `REBASE_LIVE_SCHEMA_BRANCH` | La branche sur laquelle le commit est appliqué. | `main` |
| `REBASE_LIVE_SCHEMA_COLLECTIONS_PATH` | Emplacement de la source des collections dans ce dépôt, relatif au dépôt. | `config/collections` |
| `REBASE_LIVE_SCHEMA_GITHUB_TOKEN` | Un jeton à granularité fine avec accès en lecture et écriture au contenu du dépôt. Définissez soit ceci, soit les trois variables `_GITHUB_APP_*`, mais pas les deux. | — |
| `REBASE_LIVE_SCHEMA_GITHUB_APP_ID` | L'identifiant d'une GitHub App, pour commiter en tant qu'application plutôt qu'avec un jeton. | — |
| `REBASE_LIVE_SCHEMA_GITHUB_APP_INSTALLATION_ID` | L'installation de l'application sur le dépôt. | — |
| `REBASE_LIVE_SCHEMA_GITHUB_APP_PRIVATE_KEY` | La clé privée de l'application : PEM, PEM avec sauts de ligne échappés, ou base64. | — |

### Sauvegardes

| Variable | Description | Par défaut |
|----------|-------------|------------|
| `BACKUP_SCHEDULE` | Expression cron pour les sauvegardes planifiées. Non défini signifie que les sauvegardes planifiées sont désactivées. | — |
| `BACKUP_DESTINATION` | Chemin local, ou une URL `s3://bucket/prefix` / `gs://bucket/prefix`. | `./backups` |
| `BACKUP_RETENTION_DAYS` | Supprime les sauvegardes antérieures à N jours. Non défini ou `0` conserve tout. | — |
| `BACKUP_KEEP_MINIMUM` | Conserve toujours au moins N sauvegardes parmi les plus récentes, indépendamment de la règle de rétention. | — |
| `PG_DUMP_PATH` | Remplace le binaire `pg_dump` — il doit correspondre à la version majeure du serveur ou à une version plus récente. | — |
| `PG_RESTORE_PATH` | Remplace le binaire `pg_restore`. | — |
| `PSQL_PATH` | Remplace le binaire `psql` que `rebase db restore --clean` exécute pour faire de la restauration une seule transaction. | — |
| `PG_DUMPALL_PATH` | Emplacement de `pg_dumpall`, lorsqu'il n'est pas dans le `PATH`. Sans lui — et sans les outils clients PostgreSQL installés — une sauvegarde globale échoue avec une erreur mentionnant cette variable. | — |

L'image de runtime officielle (`rebasepro/server`) intègre les outils clients
de PostgreSQL 18, de sorte qu'une sauvegarde planifiée y fonctionne sur n'importe quel serveur jusqu'à Postgres 18.
En dehors de cette image, installez-les vous-même (`apt-get install postgresql-client-18`,
`brew install libpq`).

Les sauvegardes contiennent des secrets et des DCP (données à caractère personnel). Utilisez une destination privée avec
chiffrement au repos.

### Distribution du bundle

Un déploiement géré n'embarque pas son code dans l'image : le runtime récupère un
bundle au démarrage. Ces variables déterminent lequel et comment.

| Variable | Description | Par défaut |
|----------|-------------|------------|
| `REBASE_BUNDLE` | Chemin vers un répertoire de bundle déjà extrait. Ce que `rebase start` définit localement. | — |
| `REBASE_BUNDLE_URL` | Emplacement d'où récupérer l'archive du bundle, lorsqu'il n'y en a pas en local. | — |
| `REBASE_BUNDLE_TOKEN` | L'identifiant Bearer pour cette récupération. Traitez-le comme un secret : c'est ce qui autorise un tenant à télécharger son propre code. | — |
| `REBASE_BUNDLE_FETCH_DIR` | Emplacement où le bundle récupéré est extrait. Doit être accessible en écriture et persister entre la récupération et le démarrage. | — |
| `REBASE_RUNTIME_MODULES` | Modules supplémentaires fournis au bundle par l'image de runtime, au-delà de ceux qu'il déclare lui-même. | — |

### Liaisons de ressources (Resource bindings)

Chaque base de données, bucket et topic déclaré par un projet dans `config/resources.ts` est
lié par des variables d'environnement nommées d'après lui. Les noms de base sont listés ci-dessous ; une
ressource non définie par défaut ajoute `__` et sa clé en majuscules, ainsi un bucket appelé
`media` lit `S3_BUCKET__MEDIA`. `rebase status`
 affiche, par ressource,
la variable exacte qu'il lit et si elle est définie ou non.

| Variable | Description | Par défaut |
|----------|-------------|------------|
| `REBASE_DRIVER` | Le paquet npm implémentant le pilote d'une source de données, lorsqu'il ne s'agit pas de celui par défaut pour Postgres. Suffixé par source : `REBASE_DRIVER__ANALYTICS`. | — |
| `REBASE_TOPIC_URL` | La chaîne de connexion pour un topic déclaré. Suffixée par topic. | — |

### L'environnement propre au CLI

Lu par `rebase`, et non par le serveur. Rien ici n'affecte un déploiement.

| Variable | Description | Par défaut |
|----------|-------------|------------|
| `REBASE_BASE_URL` | L'adresse à laquelle `rebase api-keys`, `rebase storage` et `rebase auth reset-password` envoient la clé de service, définie dans le shell ou dans `.env`. Définissez-la lorsque le serveur tourne autrement que par `rebase dev` dans ce projet : `rebase start`, un conteneur, un autre hôte. Sans elle, ces commandes utilisent le serveur que `rebase dev` a enregistré tant que ce serveur tourne, et n'envoient rien quand il ne tourne pas. | — |
| `REBASE_SERVICE_KEY` | La clé de service avec laquelle ces commandes s'authentifient, lue dans `.env` : la même variable que lit le serveur (voir ci-dessus). | — |
| `SERVICE_KEY` | Un ancien nom de cette clé. Lorsque `.env` la définit, `rebase api-keys` et `rebase storage` la lisent à la place de `REBASE_SERVICE_KEY`. | — |
| `REBASE_ENV_FILE_PATH` | Le fichier `.env` que le CLI lit et écrit, lorsqu'il ne s'agit pas de celui du projet. | — |
| `REBASE_CLOUD_URL` | Le plan de contrôle avec lequel `rebase cloud` communique. | — |
| `REBASE_CLOUD_EMAIL` | Le compte sous lequel `rebase cloud login` se connecte, au lieu de demander une invite. | — |
| `REBASE_CLOUD_PASSWORD` | Son mot de passe, afin qu'un gestionnaire de secrets puisse le transmettre sans qu'il ne se retrouve dans l'historique du shell. | — |
| `REBASE_TOKEN` | Un jeton issu de `rebase cloud tokens create`. S'il est défini, chaque commande `rebase cloud` s'authentifie avec lui au lieu de la session `rebase cloud login`, et ne lit ni n'écrit jamais la session stockée. La méthode recommandée pour exécuter `rebase cloud` en CI — voir [CI et agents](/docs/deployment/cloud/#ci-and-agents). Le [serveur MCP](/docs/ai/mcp/) lit le même nom en tant qu'alias de `REBASE_API_TOKEN`. | — |
| `REBASE_DEBUG` | `1` affiche l'erreur sous-jacente et les détails de la requête au lieu du message succinct. La première chose à définir lorsqu'une commande `rebase cloud` échoue sans fournir d'aide utile. | — |
| `REBASE_ATLAS_DEV_URL` | <span class="since-badge" data-since="0.25">Depuis 0.25</span> La base de données vide par rapport à laquelle `rebase db push`, `db generate` et `db migrate` effectuent leur planification, au lieu du `<db>_dev_diff` qu'elles créent à côté de `DATABASE_URL`. Rebase ne crée ni ne supprime aucune base de données nommée ici, et refuse une base égale à `DATABASE_URL`. Sur la base de données de développement gérée, le CLI la définit sur une instance PGlite temporaire en mémoire de son cru. À définir là où `CREATE DATABASE` n'est pas accordé. | `<db>_dev_diff` |
| `REBASE_DEV_NO_DB` | `rebase dev` ne démarre aucune base de données et ne provisionne rien — vous devez fournir la vôtre. Identique à `--no-db`. | — |
| `REBASE_FRONTEND_PORT` | Fixe le port du serveur de dev frontend, que `rebase dev` déduit autrement du chemin du projet. | — |
| `REBASE_DEV_READY_TIMEOUT_MS` | Temps d'attente de `rebase dev` pour que le backend s'annonce avant d'indiquer qu'il n'a pas démarré. `0` désactive ce signalement. | `30000` |
| `DATABASE_PASSWORD` | Le mot de passe que `rebase dev --docker` injecte dans la chaîne de connexion qu'il déduit de `docker-compose.yml`. | — |
| `DO_NOT_TRACK` | La convention standard entre outils. Définie sur toute valeur autre que `0`, le CLI n'envoie aucune télémétrie. | — |
| `REBASE_TELEMETRY_DISABLED` | Idem, spécifiquement pour Rebase. Ne requiert aucun fichier, c'est pourquoi c'est la variable à privilégier en CI et dans une image. | — |
| `REBASE_TELEMETRY_ENDPOINT` | Emplacement vers lequel la télémétrie est transmise, pour un collecteur auto-hébergé. | — |

## Secrets en développement

`JWT_SECRET` et `REBASE_SERVICE_KEY` sont requis en production et générés
pour vous en dehors de celle-ci, afin que vous puissiez démarrer sans rien configurer.

Ces valeurs générées sont mises en cache dans `.rebase-dev-secrets.json`, aux côtés de
`.rebase-dev-port` et `.rebase-dev-url` et ignorées par git avec eux. Auparavant, elles
étaient régénérées à chaque démarrage — redémarrer le serveur de développement vous déconnectait
donc de votre propre application et invalidait toute clé d'API venant d'être créée.

- Définissez l'une ou l'autre de ces variables explicitement et la vôtre sera utilisée ; rien n'est mis en cache ni lu.
- Pointez le cache vers un autre emplacement avec `REBASE_DEV_SECRETS_FILE` — un chemin, et la
  seule variable de cette section que vous devriez configurer délibérément.
- Supprimez le fichier pour renouveler les deux secrets. Le démarrage suivant en écrira un nouveau.
- Si le fichier ne peut pas être écrit — par exemple dans un conteneur en lecture seule —, le serveur démarre
  quand même avec un secret éphémère, exactement comme auparavant.

Rien n'est mis en cache en production, ni sous un exécuteur de tests. En production, un démarrage
qui devrait générer l'un de ces secrets échoue toujours en nommant la variable, et ce
comportement reste inchangé :

```
JWT_SECRET must be explicitly set in production.
Do not rely on auto-generated secrets outside development.
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

<span class="since-badge" data-since="0.25">Depuis 0.25</span> Les mêmes options,
sans `app`, `server` et `basePath` et avec un `provision` obligatoire, créent un
backend qui ne sert rien tant que vous ne le montez pas : `createRebaseBackend`. Voir
[Intégration d'un serveur personnalisé](/docs/backend/custom-server/).

### Modification de `basePath`

`basePath` déplace chaque route d'API, le client doit donc être configuré à l'identique —
autrement, il continuera d'appeler `/api/...` et recevra une 404 sur chaque requête :

```typescript
import { createRebaseClient } from "@rebasepro/client";

export const rebase = createRebaseClient({
    baseUrl: "https://api.example.com",
    apiPath: "/v1"          // must match the backend's basePath
});
```

Le panneau d'administration récupère cela depuis le client qui lui est fourni ; rien d'autre n'a besoin
d'être configuré. Si vous construisez une URL de requête manuellement, concaténez-la depuis le client
plutôt que d'écrire `/api` en dur :

```typescript
import { useApiBase } from "@rebasepro/app";

function Widget() {
    const apiBase = useApiBase();   // e.g. "https://api.example.com/v1"
    // fetch(`${apiBase}/data/products`)
}
```

## Dépannage

### Permission refusée dans l'éditeur SQL (`permission denied for table <name>`)

* **Symptômes :** Les requêtes personnalisées exécutées dans l'éditeur SQL de Rebase Studio échouent avec `cause: error: permission denied for table <name>`, alors que la vue CMS en feuille de calcul charge les données correctement.
* **Cause :** Par défaut, Rebase tente d'exécuter les requêtes de l'éditeur SQL en basculant temporairement les rôles de base de données pour correspondre au rôle applicatif de l'utilisateur actif (par exemple, `SET LOCAL ROLE "admin"`). Si vous utilisez une authentification personnalisée où les rôles n'existent que dans les tables de la base de données et non comme véritables rôles PostgreSQL, le changement de rôle échoue ou les privilèges de base de données sont manquants. La vue en feuille de calcul du CMS s'exécute sous l'utilisateur propriétaire de la connexion par défaut et contourne ce mécanisme.
* **Solution :** Ajoutez `DISABLE_DB_ROLE_SWITCHING=true` à la configuration `.env` de votre backend. Cela force Rebase à exécuter les requêtes de l'éditeur SQL avec les privilèges du propriétaire de la connexion (généralement un superuser/owner). L'éditeur SQL affiche alors, au-dessus des résultats, qu'ils ont été lus en tant que propriétaire de la connexion, et grise son sélecteur de rôle.

### Échec de récupération du schéma dans l'éditeur SQL (`Cross-database execution requires adminConnectionString`)

* **Symptômes :** Studio ne parvient pas à charger l'arborescence des schémas, ou l'éditeur SQL renvoie `Failed to fetch schema: Cross-database execution requires adminConnectionString to be configured in the backend.`
* **Cause :** Rebase requiert des privilèges d'administrateur pour interroger les catalogues système de la base de données et exécuter des commandes d'administration. Si `adminConnectionString` n'est pas fourni au bootstrapper, ou si `getAdmin()` est surchargé pour renvoyer `undefined`, ces opérations échouent.
* **Solution :** Assurez-vous que `adminConnectionString` est configuré lors de l'initialisation du bootstrapper du backend :
  ```typescript
  createPostgresBootstrapper({
      connection: db,
      schema: { tables, enums, relations },
      adminConnectionString: process.env.ADMIN_CONNECTION_STRING || process.env.DATABASE_URL
  })
  ```

## Étapes suivantes

- **[Déploiement](/docs/getting-started/deployment)** — Guide de déploiement en production
- **[Aperçu du backend](/docs/backend)** — Référence complète de configuration du backend
