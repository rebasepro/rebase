---
sourceHash: 63d8ba53bb0e0c67
title: Runtime backend managé
sidebar_label: Runtime managé
description: Ce qu'un backend avec le runtime « managed » peut et ne peut pas faire sur Rebase Cloud — paquets et binaires, mémoire et processeur, timeouts et tailles de requête, système de fichiers, état en mémoire, secrets, stockage des fichiers générés et réseau sortant.
---

Une application backend déclarée comme suit dans `rebase.json` s'exécute sur le **runtime managé** :

```json title="rebase.json"
{
    "apps": {
        "backend": { "type": "backend", "runtime": "managed" }
    }
}
```

« Managé » signifie que vous déployez un bundle, pas une image. `rebase cloud deploy` compile vos collections, `backend/functions/` et vos crons dans `dist-bundle`, le téléverse, et Rebase Cloud le démarre sur l'image publiée `rebasepro/server`. Vous n'avez jamais à écrire de Dockerfile et vous ne pouvez pas non plus modifier le contenu de l'image. Cette page détaille les fonctionnalités permises, afin que vous puissiez planifier une fonctionnalité avant de la développer.

Les chiffres présentés ici correspondent à l'état actuel du runtime et de la plateforme. Certains sont des paramètres modifiables, et cette page précise lesquels. Quelques points ne sont pas encore stabilisés ; ils sont signalés par la mention **Non stabilisé** et regroupés [à la fin](#pas-encore-fixé). Ne basez pas vos développements dessus sans vous renseigner au préalable.

## En un coup d'œil

| Question | Réponse |
|---|---|
| Version de Node | Node 22, sur Debian slim, `linux`/`x64` |
| Paquets npm | Oui, uniquement en pur JavaScript. Installés au démarrage de chaque instance |
| Modules natifs (`.node`, node-gyp) | Non. `rebase cloud deploy` refuse le bundle |
| WebAssembly | Ni vérifié ni bloqué. Prise en charge **non stabilisée** |
| Lancer un processus enfant | Non bloqué, mais il n'y a presque rien à exécuter. Voir [Binaires](#binaires-et-processus-enfants) |
| Mémoire et processeur | Définis par projet avec `rebase cloud compute`. Voir [Compute](#compute-et-instances) |
| Instances | 1 par défaut. Vous pouvez en fixer jusqu'à 5, ou laisser l'autoscaler monter jusqu'à 16 |
| Timeout de fonction | 30 secondes, puis `504 FUNCTION_TIMEOUT`. Configurable |
| Corps de requête | 10 Mio, puis `413`. Configurable, dans la limite des 64 Mio acceptés par l'edge |
| Système de fichiers accessible en écriture | Oui, mais il est temporaire et propre à une seule instance |
| État au niveau du module (cache `Map`) | Persiste entre les requêtes sur une même instance. Perdu à chaque déploiement et redémarrage, et non partagé entre instances |
| Variables d'environnement et secrets | `rebase cloud env set`, appliqués au prochain déploiement |
| Stockage de fichiers | Un bucket par projet, servi par votre backend sur `/api/storage/file/…` |
| HTTP sortant | Oui, sur les ports 80 et 443 (et 465, 587, 993 pour les e-mails). Les autres ports sont bloqués |

## Code et paquets

**Node et l'image.** L'image du runtime est construite sur `node:22-slim` (Debian), et votre bundle s'exécute sur `linux`/`x64` sous un utilisateur non-root. Votre `tsconfig` et la version de Node sur votre machine locale ne changent rien à cela.

**Dépendances.** Le bundle liste les dépendances déclarées par vos fichiers `package.json`. Le téléversement n'inclut pas `node_modules`. Chaque instance installe les dépendances depuis le registre public npm à son démarrage, via `npm ci` (ou `npm install` en l'absence de lockfile). Trois conséquences en découlent :

- **Les scripts d'installation ne s'exécutent jamais.** L'installation utilise `--ignore-scripts`. Un paquet qui télécharge un binaire ou compile des éléments lors du `postinstall` s'installera sans ces éléments.
- **Seules les versions du registre s'installent.** Une dépendance de type `file:`, `link:`, `git+…` ou `github:` fait échouer la compilation, car le runtime n'a aucun moyen de la résoudre.
- **Certains paquets proviennent de l'image, pas de vous.** `@rebasepro/*`, `hono`, `zod` et `typescript` sont retirés des dépendances du bundle et les copies propres à l'image sont utilisées ; votre propre version de ces paquets ne s'applique donc pas.

Le téléversement du bundle est limité à 100 Mo, compressé, hors dépendances.

**Les modules natifs sont refusés.** Un paquet fournissant un binaire compilé `.node` ne peut pas être chargé sur le runtime managé. `rebase build` émet un avertissement, et `rebase cloud deploy` s'arrête avant le téléversement :

```text no-verify
This bundle depends on native modules (sharp), which the managed runtime cannot run
```

La vérification recherche les paquets natifs bien connus (`sharp`, `canvas`, `bcrypt`, `argon2`, `sqlite3`, `better-sqlite3`, `re2`, `sodium-native`, `pg-native`, …), la présence de `binding.gyp` ou `gypfile`, les scripts d'installation appelant `node-gyp` ou `prebuild`, ainsi que les fichiers `.node`. Le [guide de déploiement](/docs/getting-started/deployment/#native-modules-on-the-managed-runtime) détaille les solutions de contournement habituelles. En résumé : effectuez le traitement au moment de la compilation, faites appel à un service externe, ou déployez avec `runtime: "custom"`.

**WebAssembly.** Rien dans la compilation ou dans le runtime n'analyse les fichiers `.wasm`. Un paquet en pur JavaScript qui charge un fichier `.wasm` n'est pas refusé, et Node 22 peut l'exécuter. Son bon fonctionnement n'a pas été testé sur le runtime managé : considérez donc ce point comme **non stabilisé**. Gardez à l'esprit la [limite de mémoire](#compute-et-instances) si le module est volumineux, comme un modèle de reconnaissance vocale ou de ML.

### Binaires et processus enfants

Rien ne bloque `child_process`, mais l'image ne contient presque rien à exécuter : `node`, `npm`, `sh`, `tar`, et les outils clients PostgreSQL (`pg_dump`, `pg_restore`). Il n'y a ni `ffmpeg`, ni ImageMagick, ni Python, ni compilateur. Vous ne pouvez pas ajouter de paquets système, car il n'y a pas de Dockerfile et le processus ne s'exécute pas en tant que root.

Un binaire embarqué directement dans l'archive tarball d'un paquet npm est installé avec celui-ci. La prise en charge de son exécution est **non stabilisée**. Un binaire qu'un paquet télécharge lors du `postinstall` n'arrivera jamais, car les scripts d'installation ne sont pas exécutés.

Si une fonctionnalité nécessite un binaire, passez par une API hébergée pour ce traitement, ou basculez le backend sur `runtime: "custom"`, où vous construisez votre propre image.

## Compute et instances

Chaque projet s'exécute dans ses propres pods. La mémoire et le processeur sont alloués par instance, et vous les configurez avec les [paramètres de compute](/docs/deployment/cloud/#compute-and-what-it-costs) :

```bash
rebase cloud compute                              # what the project reserves now
rebase cloud compute set --cpu 500m --memory 1Gi
```

Un projet pour lequel aucun paramètre n'a été défini s'exécute sous forme de pod burstable : il réserve une quantité minimale et peut temporairement dépasser cette limite (burst). Exécutez `rebase cloud compute` pour voir la réservation (request) et la limite réellement attribuées à votre projet. La réservation par défaut documentée est de `250m` CPU et `512Mi` de mémoire ; le code de la plateforme applique actuellement une valeur par défaut inférieure, avec une limite de burst à 2 CPU et 2 Gio, ce chiffre est donc **non stabilisé**.

Instances :

- **Une par défaut.** `--replicas` permet d'en fixer entre 1 et 5.
- **L'autoscaling est optionnel.** `--autoscale-max` définit un plafond allant jusqu'à 16, et `--autoscale-cpu-target` (70 par défaut) correspond au taux d'utilisation processeur ciblé par l'autoscaler.
- **Les déploiements sont progressifs (rolling).** Une nouvelle instance démarre et devient prête avant que l'ancienne ne s'arrête ; pendant un court instant, deux versions traitent donc le trafic en parallèle.

`--spot` et `--scale-to-zero` sont tous deux désactivés par défaut. Les instances Spot sont redémarrées sans préavis. L'application effective de `--scale-to-zero` à l'heure actuelle est **non stabilisée** ; prévoyez une instance fonctionnant en continu.

## Mémoire et état au niveau du module

Une valeur définie au niveau du module, telle que `const cache = new Map()` en tête d'un fichier de fonction, réside dans le processus Node. Elle persiste d'une requête à l'autre sur une même instance. Elle est perdue dès que ce processus se termine :

- à **chaque déploiement**, car chaque déploiement démarre de nouvelles instances ;
- lorsqu'une **variable d'environnement** est modifiée puis déployée ;
- lorsqu'une instance est redémarrée, replanifiée ou (avec `--spot`) récupérée.

En présence de plusieurs instances, chacune possède sa propre copie : deux requêtes peuvent donc accéder à des caches différents.

Utilisez un `Map` au niveau du module comme un cache que vous pouvez vous permettre de perdre : il accélère la requête suivante, mais ne doit pas être la seule copie d'une donnée. Tout ce dont la production est coûteuse, comme un fichier audio généré ou une réponse d'API onéreuse, doit être conservé en base de données ou dans le [stockage](#stockage-pour-les-fichiers-générés). Pour les clients initialisés une seule fois, comme le SDK d'une API, utilisez `lazyResource` afin qu'ils soient instanciés à la première utilisation à partir de l'environnement de la requête. Voir [Configuration et secrets](/docs/backend/custom-functions/#configuration-and-secrets).

La page [Exécuter plusieurs instances](/docs/deployment/multiple-instances/) détaille l'état que Rebase conserve lui-même par processus, comme les compteurs de rate-limiting et les canaux temps réel.

## Le système de fichiers

Le système de fichiers du conteneur est accessible en écriture, et `/tmp` fonctionne. Cependant, tout ce qui y est écrit :

- appartient à une seule instance, et les autres instances n'y ont pas accès ;
- est supprimé lorsque l'instance s'arrête, et donc au plus tard lors du déploiement suivant ;
- partage une limite de stockage éphémère de 6 Gio avec le bundle et ses `node_modules` installés. Une instance qui dépasse cette limite est expulsée (evicted).

Utilisez-le pour des fichiers temporaires au cours d'une même requête. Ne l'utilisez pas comme cache persistant entre les déploiements ni comme stockage pour les téléversements. C'est également pour cette raison que [`STORAGE_TYPE=local` est désactivé en production](/docs/backend/storage/#environment-variables).

## Requêtes

| Limite | Valeur par défaut | Modifiable avec |
|---|---|---|
| Timeout de fonction | 30 s, puis `504` avec le code `FUNCTION_TIMEOUT` | `REBASE_FUNCTIONS_TIMEOUT_MS` (`0` le désactive) |
| Corps de requête, toutes routes `/api/*` | 10 Mio, puis `413 PAYLOAD_TOO_LARGE` | `REBASE_MAX_BODY_SIZE`, en octets |
| Corps de requête au niveau de l'edge | 64 Mio | Fixe |
| Un fichier via `POST /api/storage/upload` | 50 Mo | `STORAGE_MAX_FILE_SIZE` |
| Appels anonymes vers `/api/functions/*` | 3 000 par IP par tranche de 15 minutes | `rateLimit.anonymousFunctions` |

Quelques précisions :

- **Le timeout libère l'appelant, pas le traitement.** Au bout de 30 secondes, l'appelant reçoit une erreur `504`, et `getSignal(c)` est annulé (aborted). Transmettez ce signal à `fetch` et à tout élément qui en accepte un, afin que le traitement s'interrompe également. Voir [Timeouts et limites de débit](/docs/backend/custom-functions/#timeouts-and-rate-limits).
- **L'edge dispose de son propre timeout.** Les requêtes atteignent vos instances via un ingress nginx qui ne définit aucun read timeout propre ; la valeur par défaut du contrôleur s'applique donc (60 secondes sous ingress-nginx). Dépasser cette valeur avec `REBASE_FUNCTIONS_TIMEOUT_MS` est **non stabilisé** : l'edge risque de fermer la connexion avant. Pour les traitements durant plusieurs minutes, répondez immédiatement et exécutez le traitement dans un [job](/docs/backend/jobs/) ou dans `waitUntil`.
- **Les téléversements supérieurs à 64 Mio** nécessitent le téléversement avec reprise (TUS), qui transmet le fichier par morceaux. `client.storage.putObject()` bascule automatiquement dessus au-delà de 8 Mio.
- **Taille de la réponse.** Ni le runtime ni l'edge n'imposent de limite sur la taille des réponses. Une réponse volumineuse reste néanmoins stockée en mémoire si votre gestionnaire la construit d'un seul bloc ; diffusez-la donc en streaming ou servez-la depuis le stockage.

## Variables d'environnement et secrets

Configurez-les via la CLI ou dans la console. Il n'existe aucun champ dédié dans `rebase.json`.

```bash
rebase cloud env set TTS_API_URL=https://api.example.com/v1/speech
rebase cloud env set TTS_API_KEY=sk-… --secret   # write-only: never shown again
rebase cloud env list                            # names only, never values
rebase cloud deploy                              # applies the change
```

- **Une modification s'applique au déploiement suivant.** Les instances en cours d'exécution conservent les valeurs avec lesquelles elles ont démarré. `set` et `unset` vous le rappellent (`Pending redeploy`).
- **Limites :** jusqu'à 100 variables par projet, 32 Kio par valeur et 256 Kio au total. Les noms respectent le format `[A-Za-z_][A-Za-z0-9_]*`.
- **Certains noms sont réservés.** La plateforme définit elle-même `DATABASE_URL`, `DATABASE_DIRECT_URL`, `DATABASE_READ_URL`, `JWT_SECRET`, `REBASE_SERVICE_KEY`, `PORT` et `NODE_ENV`, et verrouille l'environnement d'exécution du processus (`REBASE_ROLE`, `TRUSTED_PROXY_HOPS`, …). Définir l'une de ces variables est refusé, et le message d'erreur les liste toutes.
- **`CORS_ORIGINS` provient de vos domaines.** La plateforme lui assigne l'hôte du projet ainsi que ses [domaines personnalisés](/docs/deployment/cloud/#the-rest-of-the-surface) vérifiés, et cette valeur prévaut sur celle que vous pourriez définir. Ajoutez une origine avec `rebase cloud domains`, et non avec `env set`.
- **Les variables de stockage sont des valeurs par défaut.** La plateforme renseigne les variables `STORAGE_*` et `S3_*` pour son bucket, mais toute valeur que vous définissez prend le dessus.
- **Les noms réservés au build sont refusés.** Les variables préfixées par `VITE_`, `NEXT_PUBLIC_`, `PUBLIC_` et `REACT_APP_` sont destinées aux frontends lors du build ; le backend ne les reçoit jamais à temps. L'option `--force` permet néanmoins d'en enregistrer une.

Dans une fonction, lisez-les à l'intérieur du gestionnaire, jamais en tête de fichier :

```typescript
import { defineFunction, requireEnv } from "@rebasepro/server/functions";

export default defineFunction((app) => {
    app.get("/status", async (c) => {
        const endpoint = requireEnv(c, "TTS_API_URL");   // throws a clear error if unset
        return c.json({ configured: Boolean(endpoint) });
    });
});
```

Une lecture de `process.env` à la racine du module qui renverrait une valeur vide empêche le chargement de l'ensemble du fichier, et ses routes répondront par une erreur `404`. Voir [Configuration et secrets](/docs/backend/custom-functions/#configuration-and-secrets).

## Stockage pour les fichiers générés

Un projet Cloud dispose d'un stockage de fichiers dès lors que vous le créez :

```bash
rebase cloud storage create   # a managed bucket and its credentials
rebase cloud deploy           # the running backend gets the credentials at deploy
```

Vous pouvez aussi pointer le projet vers un bucket que vous possédez déjà avec `rebase cloud storage attach` (S3, R2, MinIO ou tout bucket compatible S3). Sans cela, les téléversements renvoient l'erreur `501 STORAGE_NOT_CONFIGURED`. D'autres buckets peuvent être déclarés dans `config/resources.ts` ; voir [Plusieurs buckets](/docs/backend/storage/#several-buckets).

Un déploiement avec stockage est refusé tant que le projet n'a pas défini qui est autorisé à lire et écrire des fichiers. Le fichier `config/storage.ts` du scaffold exporte un hook `storageAuthorize` prévu à cet effet. Voir [Autorisation par objet](/docs/backend/storage/#per-object-authorization).

**Comment les fichiers sont servis.** Votre backend sert chaque fichier sur `GET /api/storage/file/<key>`. Il lit l'objet depuis le bucket et le transmet en streaming, avec le `Content-Type`, la prise en charge des requêtes par intervalles (range requests) et les en-têtes de cache. Aucune URL directe vers le bucket n'est exposée.

- Une clé située sous **`public/`** est accessible à tous, sans jeton, à une URL immuable. Utilisez-la pour les fichiers que n'importe quel visiteur peut charger, comme un fichier audio généré pour un jeu public.
- Toute autre clé est privée. Un client doit solliciter `/api/storage/metadata/<key>` pour obtenir une URL de téléchargement contenant un jeton, valide par défaut pendant 300 secondes (`STORAGE_DOWNLOAD_TOKEN_TTL`, jusqu'à une semaine).

Depuis une fonction, écrivez avec `rebase.storage` (le bucket par défaut) ou `rebase.bucket(…)` (un bucket nommé). Votre hook `storageAuthorize` détermine toujours si l'écriture est autorisée.

Les transformations d'images (`?width=`, `?format=`) nécessitent `sharp`, qui est un module natif et n'est pas inclus dans l'image managée. Sur le runtime managé, une requête de transformation renvoie l'image d'origine.

### Exemple : mettre en cache un fichier audio généré

Une fonction qui convertit du texte en parole à l'aide d'une API hébergée, enregistre chaque résultat une seule fois et le sert depuis le stockage par la suite. Le `Map` sert uniquement à éviter une requête de recherche dans le stockage sur une instance chaude ; le bucket constitue le véritable cache, de sorte qu'un déploiement ne fait rien perdre.

```typescript
import { defineFunction, getSignal, requireEnv } from "@rebasepro/server/functions";

const known = new Map<string, true>(); // per instance, lost on deploy: that is fine

export default defineFunction((app, { rebase }) => {
    app.get("/voice/:id", async (c) => {
        const id = c.req.param("id").replace(/[^a-z0-9-]/gi, "");
        const key = `public/voices/${id}.mp3`;
        const url = `/api/storage/file/${key}`;

        if (known.has(key)) return c.redirect(url);
        const storage = rebase.storage;
        if (!storage) return c.json({ error: "Storage is not configured" }, 501);

        const listed = await storage.listObjects(key, { maxResults: 1 });
        if (listed.items.some(item => item.fullPath === key)) {
            known.set(key, true);
            return c.redirect(url);
        }

        const text = c.req.query("text") ?? "";
        const response = await fetch(requireEnv(c, "TTS_API_URL"), {
            method: "POST",
            headers: {
                authorization: `Bearer ${requireEnv(c, "TTS_API_KEY")}`,
                "content-type": "application/json"
            },
            body: JSON.stringify({ text }),
            signal: getSignal(c)
        });
        if (!response.ok) return c.json({ error: "Speech service failed" }, 502);

        const file = new File([await response.arrayBuffer()], `${id}.mp3`, { type: "audio/mpeg" });
        await storage.putObject({ file, key });
        known.set(key, true);
        return c.redirect(url);
    });
});
```

La route est publique, comme chaque route dans `backend/functions/` tant que vous ne la protégez pas. En production, il conviendrait de vérifier qui est autorisé à générer de nouveaux fichiers audio, afin d'éviter qu'un tiers n'épuise votre forfait d'API de synthèse vocale.

## Réseau sortant

Les fonctions peuvent faire appel à des services externes. Les connexions sortantes depuis vos instances sont autorisées vers n'importe quelle adresse Internet sur ces seuls ports TCP :

| Port | Usage |
|---|---|
| 80, 443 | HTTP et HTTPS |
| 465, 587 | Envoi d'e-mails via SMTP avec TLS ou STARTTLS |
| 993 | IMAP via TLS |

Tout le reste est bloqué. Cela inclut le port 25, le protocole IMAP non chiffré, ainsi que les bases de données ou caches sur leurs ports dédiés : un serveur PostgreSQL sur le port 5432, Redis sur le 6379 ou MongoDB sur le 27017 situés en dehors de Rebase Cloud sont inaccessibles. L'adresse de métadonnées du cloud (`169.254.169.254`) est également bloquée.

La plateforme n'ajoute aucun proxy ni aucune limite de débit sortant ; les services que vous appelez appliquent leurs propres règles. Transmettez `getSignal(c)` à `fetch` pour qu'un appel s'interrompe en cas d'expiration du timeout de la requête.

Votre trafic sort via une adresse partagée, et non par une adresse dédiée par projet. Le fait que cette adresse soit fixe et publiée, pour les services nécessitant une liste blanche (allowlist), est **non stabilisé**.

## Démarrage et arrêt

- **Démarrage à froid (cold start).** Une nouvelle instance télécharge le bundle et installe ses dépendances avant de pouvoir traiter le trafic. Cette installation représente l'essentiel du démarrage à froid, qui dure généralement entre 40 et 60 secondes. La plateforme attend jusqu'à 300 secondes qu'une instance soit opérationnelle. Un arbre de dépendances volumineux ralentit chaque déploiement et chaque montée en charge.
- **Sondes de santé (health).** La plateforme interroge `/livez` (le processus fonctionne) et `/health` (il peut joindre la base de données). Ces deux endpoints sont gérés par le runtime : vous n'avez pas à les implémenter.
- **Arrêt.** Lors d'un déploiement ou d'un redémarrage, l'instance cesse d'accepter de nouvelles requêtes, attend 5 secondes que le trafic bascule, puis reçoit un signal `SIGTERM`. Les requêtes en cours disposent de 15 secondes au maximum pour se terminer. Les promesses transmises à `waitUntil` peuvent consommer jusqu'à 5 secondes de ce délai. Une promesse non transmise à `waitUntil` est interrompue. Voir [Travail en arrière-plan](/docs/backend/custom-functions/#background-work).

## Quand le mode managé n'est pas adapté

Basculez le backend sur `"runtime": "custom"` lorsqu'il requiert :

- un module natif ou un binaire système, tel que `sharp`, `ffmpeg` ou un moteur vocal local ;
- des paquets système ou une image de base différente ;
- une connexion persistante vers un service en dehors des ports autorisés.

Un runtime personnalisé compile votre propre Dockerfile, et vous devenez responsable de la gestion de l'image. La commande `rebase cloud deploy --eject` permet d'effectuer cette transition. Voir [Rebase Cloud](/docs/deployment/cloud/#deploy).

## Pas encore fixé

Ces questions n'ont pas encore de réponse définitive dans le code de la plateforme. Renseignez-vous avant de faire dépendre vos applications de l'un de ces points.

- **WebAssembly.** Ce n'est pas bloqué, mais ce n'est ni testé ni officiellement garanti.
- **Exécution d'un binaire inclus dans un paquet npm.** Ce n'est pas bloqué, mais ce n'est pas pris en charge pour autant.
- **Processeur et mémoire par défaut.** La valeur par défaut documentée (`250m`, `512Mi`) et la valeur par défaut actuelle de la plateforme (réservation plus basse, burst jusqu'à 2 CPU et 2 Gio) ne coïncident pas. `rebase cloud compute` indique la configuration de votre projet.
- **Mise à l'échelle vers zéro (scale-to-zero).** L'option `--scale-to-zero` est acceptée. Son impact effectif actuel sur le fonctionnement du projet n'est pas confirmé.
- **Requêtes de plus de 60 secondes.** Le timeout de fonction peut être augmenté, mais l'edge situé en amont risque de clore la connexion selon sa propre limite par défaut.
- **Adresse IP sortante fixe** utilisable par la liste blanche d'un service tiers.
- **Origine de navigateur ne correspondant à aucun des domaines du projet**, comme un frontend hébergé ailleurs. La configuration `CORS_ORIGINS` de la plateforme prévaut sur la vôtre.
- **Registres npm privés.** L'installation des dépendances ne lit aucun fichier `.npmrc` ni aucun jeton ; les paquets privés semblent donc ne pas pouvoir s'installer.
- **Rétention des logs.** `rebase cloud logs --runtime` affiche la sortie récente ; la durée de conservation des logs n'est pas documentée.

## Pages connexes

- [Rebase Cloud](/docs/deployment/cloud/) : liaison, déploiement, options de compute et fonctionnalités non incluses dans la bêta
- [Fonctions personnalisées](/docs/backend/custom-functions/) : écriture des routes dans `backend/functions/`
- [Runtime et bundles](/docs/architecture/runtime-and-bundles/) : qu'est-ce qu'un bundle et comment le runtime l'exécute
- [Stockage](/docs/backend/storage/) : buckets, endpoints, limites de taille et règles d'accès
- [Exécuter plusieurs instances](/docs/deployment/multiple-instances/) : l'état que Rebase conserve par processus
