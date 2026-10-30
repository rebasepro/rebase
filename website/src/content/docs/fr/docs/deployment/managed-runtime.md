---
sourceHash: 6bb68aec4ebcb624
title: Runtime backend managé
sidebar_label: Runtime managé
description: Ce qu'un backend avec le runtime "managed" peut et ne peut pas faire sur Rebase Cloud — paquets et binaires, mémoire et CPU, délais d'expiration et tailles de body, système de fichiers, état en mémoire, secrets, stockage pour les fichiers générés et réseau sortant.
---

Une application backend déclarée comme ceci dans `rebase.json` s'exécute sur le **runtime managé** (managed) :

```json title="rebase.json"
{
    "apps": {
        "backend": { "type": "backend", "runtime": "managed" }
    }
}
```

Managé signifie que vous livrez un bundle, pas une image. `rebase cloud deploy` compile vos
collections, `backend/functions/` et crons dans `dist-bundle`, le téléverse, et
Rebase Cloud le démarre sur l'image publiée `rebasepro/server`. Vous n'écrivez jamais
de Dockerfile, et vous ne pouvez pas non plus modifier le contenu de l'image. Cette page répertorie
ce qui est permis, afin que vous puissiez planifier une fonctionnalité avant de la développer.

Les chiffres présentés ici proviennent du runtime et de la plateforme tels qu'ils sont aujourd'hui. Certains
sont des paramètres ajustables, et cette page indique lesquels. Les rares éléments qui ne sont
pas encore garantis sont regroupés [à la fin](#pas-encore-garanti).

## En un coup d'œil

| Question | Réponse |
|---|---|
| Version de Node | Node 22, sur Debian slim, `linux`/`x64` |
| Paquets npm | Oui, depuis le registre public ou un registre privé. Installés dans le bundle lors du déploiement |
| Modules natifs (`.node`, node-gyp) | Non. `rebase cloud deploy` refuse le bundle |
| WebAssembly | Oui |
| Lancer un sous-processus | Oui, pour un binaire `linux`/`x64` fourni par un paquet npm. Voir [Binaires](#binaires-et-sous-processus) |
| Mémoire et CPU | Définis par projet avec `rebase cloud compute`. Voir [Compute](#compute-et-instances) |
| Instances | 1 par défaut, toujours active. Vous pouvez en fixer jusqu'à 5, ou laisser l'autoscaler monter jusqu'à 16 |
| Délai d'expiration des fonctions | 30 secondes, puis `504 FUNCTION_TIMEOUT`. Configurable jusqu'à 10 minutes |
| Corps de la requête (Request body) | 10 MiB, puis `413`. Configurable, jusqu'aux 64 MiB acceptés par l'edge |
| Système de fichiers accessible en écriture | Oui, mais il est temporaire et propre à une seule instance |
| État au niveau du module (un cache `Map`) | Persiste entre les requêtes sur une même instance. Perdu à chaque déploiement et redémarrage, et non partagé entre instances |
| Variables d'environnement et secrets | `rebase cloud env set`, appliqués au prochain déploiement |
| Stockage de fichiers | Un bucket par projet, servi par votre backend sur `/api/storage/file/…` |
| HTTP sortant | Oui, sur les ports 80 et 443 (et 465, 587, 993 pour les e-mails). Les autres ports sont bloqués. Pas d'adresse IP sortante fixe |

## Code et paquets

**Node et l'image.** L'image du runtime est basée sur `node:22-slim`
(Debian), et votre bundle s'exécute sur `linux`/`x64` en tant qu'utilisateur non-root. Votre
`tsconfig` et la version de Node sur votre machine n'y changent rien.

**Dépendances.** `rebase cloud deploy` installe dans le bundle les dépendances que vos
fichiers `package.json` déclarent, pour `linux`/`x64`, et les téléverse avec lui, de sorte
qu'une nouvelle instance n'a rien à installer. Un bundle qui dépasserait avec elles la limite
de téléversement de 1 Go est téléversé sans elles, et le déploiement le signale : chaque
instance les installe alors à son démarrage, avec `npm ci` (ou `npm install` en l'absence de
lockfile). Quatre conséquences découlent de leur mode d'installation :

- **Les scripts d'installation ne s'exécutent jamais.** L'installation utilise `--ignore-scripts`. Un paquet
  qui télécharge un binaire ou compile quelque chose lors du `postinstall` s'installera sans
  celui-ci.
- **Seules les versions issues de registres s'installent.** Une dépendance `file:`, `link:`, `git+…` ou `github:`
  fait échouer le build, car le runtime ne dispose d'aucun moyen pour la résoudre.
- **Certains paquets proviennent de l'image, pas de vous.** `@rebasepro/server`,
  `@rebasepro/types`, `@rebasepro/client`, `@rebasepro/common`,
  `@rebasepro/utils`, `hono`, `@hono/node-server` et `zod` sont retirés des
  dépendances du bundle et les copies propres à l'image sont liées, de sorte que votre
  version de ces paquets ne s'applique pas. Les autres paquets `@rebasepro/*`, comme le
  pilote de base de données, s'installent depuis votre `package.json` comme n'importe quelle dépendance.
  `typescript` et `tsx` sont également retirés ; ce sont des outils de build.
- **Les paquets privés nécessitent un `.npmrc`.** `rebase build` copie le fichier `.npmrc` du projet
  (et `backend/.npmrc`) dans le bundle, afin que l'installation utilise les mêmes
  paramètres de registre que votre machine. Chaque identifiant qu'il contient doit être une
  référence à une variable d'environnement, jamais le token lui-même ; un token en clair fait
  échouer le build, car le bundle est téléversé avec votre code :

  ```ini title=".npmrc"
  @acme:registry=https://npm.pkg.github.com
  //npm.pkg.github.com/:_authToken=${NPM_TOKEN}
  ```

  ```bash
  rebase cloud env set NPM_TOKEN=ghp_… --secret
  ```

Le téléversement du bundle est limité à 100 Mo, compressé, sans les dépendances.

**Les modules natifs sont refusés.** Un paquet qui fournit un binaire `.node` compilé
ne peut pas se charger sur le runtime managé. `rebase build` émet un avertissement, et
`rebase cloud deploy` s'arrête avant le téléversement :

```text no-verify
This bundle depends on native modules (sharp), which the managed runtime cannot run
```

La vérification recherche les paquets natifs connus (`sharp`, `canvas`, `bcrypt`,
`argon2`, `sqlite3`, `better-sqlite3`, `re2`, `sodium-native`, `pg-native`, …),
la présence de `binding.gyp` ou `gypfile`, les scripts d'installation qui appellent `node-gyp` ou
`prebuild`, ainsi que les fichiers `.node`. Le
[guide de déploiement](/docs/getting-started/deployment/#native-modules-on-the-managed-runtime)
liste les solutions habituelles de contournement. En résumé : effectuez le travail au moment du build,
faites appel à un service externe, ou déployez avec `runtime: "custom"`.

**WebAssembly fonctionne.** Un paquet qui fournit un fichier `.wasm` et le charge depuis
JavaScript n'est pas un module natif, et Node 22 peut l'exécuter. Vérifié dans
l'image de base du runtime avec les paramètres de sécurité du pod, à l'aide de `esbuild-wasm`.
Gardez à l'esprit la [limite de mémoire](#compute-et-instances) si le module est volumineux,
comme un modèle vocal ou de ML.

### Binaires et sous-processus

`child_process` fonctionne. L'image elle-même contient très peu d'exécutables : `node`, `npm`,
`sh`, `tar`, et les outils clients PostgreSQL (`pg_dump`, `pg_restore`). Il n'y a
pas de `ffmpeg`, pas d'ImageMagick, pas de Python ni de compilateur, et vous ne pouvez pas ajouter
de paquets système, car il n'y a pas de Dockerfile et le processus n'est pas root.

Un binaire qu'un paquet npm transporte **au sein de sa propre archive tarball** s'installe avec
le paquet et s'exécute. Il doit être compilé pour `linux`/`x64` avec la glibc
(Debian), et il s'exécute en tant qu'utilisateur non privilégié sans capacités Linux.
Vérifié avec `@esbuild/linux-x64` dans l'image de base du runtime. Un binaire qu'un
paquet *télécharge* lors du `postinstall` n'arrivera jamais, car les scripts d'installation ne
s'exécutent pas ; des paquets comme `ffmpeg-static` fonctionnent de cette manière.

Si une fonctionnalité nécessite un binaire, utilisez une API hébergée pour cette tâche, ou passez le
backend sur `runtime: "custom"`, où vous construisez votre propre image.

## Compute et instances

Chaque projet s'exécute dans ses propres pods. La mémoire et le CPU sont alloués par instance, et vous les
définissez avec les [réglages de compute](/docs/deployment/cloud/#compute-and-what-it-costs) :

```bash
rebase cloud compute                              # what the project reserves now
rebase cloud compute set --cpu 500m --memory 1Gi
```

Un projet n'ayant jamais défini de réglage s'exécute sous la forme d'un pod burstable : il réserve `100m` de CPU
et `384Mi` de mémoire, et peut monter ponctuellement (burst) jusqu'à 2 CPU et 2 GiB. Une requête configurée conserve
ce ratio entre la ressource demandée et la limite. Exécutez `rebase cloud compute` pour voir ce dont
dispose votre projet.

Instances :

- **Une par défaut, toujours active.** `--replicas` permet d'en fixer entre 1 et 5.
  Rien ne réduit un backend à zéro instance (scale to zero).
- **L'autoscaling est optionnel (opt-in).** `--autoscale-max` définit un plafond allant jusqu'à 16, et
  `--autoscale-cpu-target` (70 par défaut) l'utilisation du CPU visée par l'autoscaler.
- **Les déploiements sont progressifs (rolling deploys).** Une nouvelle instance démarre et devient prête avant que l'ancienne
  ne s'arrête, de sorte que pendant un court instant, deux versions traitent le trafic.

`--spot` est désactivé par défaut ; les instances spot sont moins chères et redémarrées sans
préavis.

## Mémoire et état au niveau du module

Une valeur définie au niveau du module, comme `const cache = new Map()` en tête d'un fichier
de fonction, réside dans le processus Node. Elle survit d'une requête à l'autre sur
la même instance. Elle est perdue dès que ce processus se termine :

- à **chaque déploiement**, car chaque déploiement démarre de nouvelles instances ;
- lorsqu'une **variable d'environnement** change et est déployée ;
- lorsqu'une instance est redémarrée, replanifiée ou (avec `--spot`) récupérée.

S'il y a plus d'une instance, chacune possède sa propre copie, donc deux requêtes peuvent voir
des caches différents.

Utilisez une `Map` au niveau du module comme un cache que vous pouvez vous permettre de perdre : un cache qui accélère
la requête suivante mais qui n'est l'unique copie de rien d'important. Conservez tout ce dont la production
a un coût, comme de l'audio généré ou une réponse d'API coûteuse, dans la
base de données ou dans le [stockage](#stockage-pour-les-fichiers-générés). Pour les clients instanciés
une seule fois, comme un SDK d'API, utilisez `lazyResource` afin que le client soit construit lors de la première
utilisation à partir de l'environnement de la requête. Voir
[Configuration et Secrets](/docs/backend/custom-functions/#configuration-and-secrets).

[Exécuter plusieurs instances](/docs/deployment/multiple-instances/) répertorie
l'état que Rebase lui-même conserve par processus, tel que les compteurs de rate-limit et
les canaux en temps réel.

## Le système de fichiers

Le système de fichiers du conteneur est accessible en écriture, et `/tmp` fonctionne. Mais tout
ce qui y est écrit :

- appartient à une seule instance, et les autres instances ne le voient pas ;
- est supprimé lorsque l'instance s'arrête, donc au plus tard lors du prochain déploiement ;
- partage une limite de stockage éphémère de 6 GiB avec le bundle et ses
  `node_modules` installés. Une instance qui dépasse cette limite est évincée.

Utilisez-le pour des fichiers temporaires au cours d'une même requête. Ne l'utilisez pas comme cache d'un
déploiement à l'autre ou comme stockage pour les téléversements. C'est également la raison pour laquelle
[`STORAGE_TYPE=local` est désactivé en production](/docs/backend/storage/#environment-variables).

## Requêtes

| Limite | Défaut | Modifier avec |
|---|---|---|
| Délai d'expiration de fonction | 30 s, puis `504` avec le code `FUNCTION_TIMEOUT` | `REBASE_FUNCTIONS_TIMEOUT_MS` (`0` le désactive) |
| Attente de votre instance, au niveau de l'edge | 10 minutes entre lectures ou écritures | Fixe |
| Corps de la requête, routes `/api/*` sans limite propre | 10 MiB, puis `413 PAYLOAD_TOO_LARGE` | `REBASE_MAX_BODY_SIZE`, en octets |
| Corps de la requête à l'edge | 64 MiB | Fixe |
| Un fichier via `POST /api/storage/upload` | 50 Mo | `STORAGE_MAX_FILE_SIZE` |
| Appels anonymes à `/api/functions/*` | 3000 par IP par 15 minutes | `rateLimit.anonymousFunctions` |

Quelques précisions :

- **Le délai d'expiration libère l'appelant, pas le traitement.** À 30 secondes, l'appelant reçoit
  une erreur `504`, et `getSignal(c)` est interrompu (aborted). Transmettez ce signal à `fetch` et
  à tout ce qui accepte un signal d'interruption, pour que le traitement s'arrête également. Voir
  [Délais d'expiration et limites de débit](/docs/backend/custom-functions/#timeouts-and-rate-limits).
- **L'edge attend plus longtemps que le runtime.** L'ingress devant vos
  instances attend jusqu'à 10 minutes ; la limite qu'une requête rencontre est donc celle du runtime,
  qui répond en JSON et annule le signal. Augmentez `REBASE_FUNCTIONS_TIMEOUT_MS`
  jusqu'à cette valeur si nécessaire. Pour les tâches plus longues, ou qui doivent survivre à un déploiement (une
  instance dispose de 15 secondes pour se vider/drainer), répondez immédiatement et effectuez le travail dans un
  [job](/docs/backend/jobs/).
- **Les téléversements supérieurs à 64 MiB** nécessitent le téléversement avec reprise (TUS), qui envoie
  le fichier par morceaux. `client.storage.putObject()` bascule dessus automatiquement
  au-delà de 8 MiB.
- **Taille de la réponse.** Ni le runtime ni l'edge ne fixent de limite sur la taille
  des réponses. Une réponse volumineuse est toutefois conservée en mémoire si votre gestionnaire la construit en
  un seul bloc ; diffusez-la donc en streaming ou servez-la depuis le stockage.

## Variables d'environnement et secrets

Définissez-les avec la CLI ou dans la console. Il n'y a pas de champ prévu pour elles dans
`rebase.json`.

```bash
rebase cloud env set TTS_API_URL=https://api.example.com/v1/speech
rebase cloud env set TTS_API_KEY=sk-… --secret   # write-only: never shown again
rebase cloud env list                            # names only, never values
rebase cloud deploy                              # applies the change
```

- **Une modification s'applique au prochain déploiement.** Les instances en cours d'exécution conservent les valeurs
  avec lesquelles elles ont démarré. `set` et `unset` vous le rappellent
  (`Pending redeploy`).
- **Limites :** jusqu'à 100 variables par projet, 32 KiB par valeur et 256 KiB au
  total. Les noms suivent le format `[A-Za-z_][A-Za-z0-9_]*`.
- **Certains noms sont réservés.** La plateforme définit `DATABASE_URL`,
  `DATABASE_DIRECT_URL`, `DATABASE_READ_URL`, `JWT_SECRET`,
  `REBASE_SERVICE_KEY`, `PORT` et `NODE_ENV` elle-même, et verrouille la manière dont le processus
  s'exécute (`REBASE_ROLE`, `TRUSTED_PROXY_HOPS`, …). Tenter de définir l'une d'elles est
  refusé, et le message d'erreur les liste toutes.
- **`CORS_ORIGINS` commence par vos domaines.** La plateforme lui assigne
  l'hôte du projet et ses [domaines personnalisés](/docs/deployment/cloud/#the-rest-of-the-surface) vérifiés.
  Une valeur `CORS_ORIGINS` que vous définissez s'ajoute à cette liste, pour un frontend hébergé
  ailleurs : `rebase cloud env set CORS_ORIGINS=https://app.example.org`.
- **Les variables de stockage sont des valeurs par défaut.** La plateforme écrit les variables
  `STORAGE_*` et `S3_*` pour son bucket, et toute valeur que vous définissez prévaut.
- **Les noms réservés au build sont refusés.** Les variables `VITE_`, `NEXT_PUBLIC_`, `PUBLIC_` et
  `REACT_APP_` sont destinées aux frontends au moment du build, et le backend
  ne les reçoit jamais à temps. L'option `--force` permet d'en enregistrer une malgré tout.

Dans une fonction, lisez-les à l'intérieur du gestionnaire (handler), jamais en haut du fichier :

```typescript
import { defineFunction, requireEnv } from "@rebasepro/server/functions";

export default defineFunction((app) => {
    app.get("/status", async (c) => {
        const endpoint = requireEnv(c, "TTS_API_URL");   // throws a clear error if unset
        return c.json({ configured: Boolean(endpoint) });
    });
});
```

Une lecture de `process.env` à la racine du module qui renvoie une valeur vide empêche le chargement
complet du fichier, et ses routes répondront par un `404`. Voir
[Configuration et Secrets](/docs/backend/custom-functions/#configuration-and-secrets).

## Stockage pour les fichiers générés

Un projet Cloud dispose d'un stockage de fichiers dès que vous le créez :

```bash
rebase cloud storage create   # a managed bucket and its credentials
rebase cloud deploy           # the running backend gets the credentials at deploy
```

Vous pouvez aussi lier le projet à un bucket que vous possédez déjà avec
`rebase cloud storage attach` (S3, R2, MinIO, tout bucket compatible S3).
Sans l'un ou l'autre, les téléversements renvoient `501 STORAGE_NOT_CONFIGURED`. D'autres buckets sont
déclarés dans `config/resources.ts` ; voir
[Plusieurs buckets](/docs/backend/storage/#several-buckets).

Un déploiement avec stockage est refusé tant que le projet n'a pas défini qui peut lire et écrire
les fichiers. Le fichier `config/storage.ts` du scaffold exporte un hook `storageAuthorize` prévu
à cet effet. Voir [Autorisation par objet](/docs/backend/storage-authorization/).

**Comment les fichiers sont servis.** Votre backend sert chaque fichier à l'adresse
`GET /api/storage/file/<key>`. Il lit l'objet depuis le bucket et le transmet en flux (stream),
avec le `Content-Type`, la gestion des requêtes par plages (range requests) et les en-têtes de cache. Il n'y a pas d'URL
directe vers le bucket à distribuer.

- Une clé située sous **`public/`** est accessible à tous, sans jeton, à une URL
  qui ne change jamais. Utilisez-la pour les fichiers que tout visiteur peut charger, comme de l'audio
  généré pour un jeu public.
- Toute autre clé est privée. Un client sollicite `/api/storage/metadata/<key>` pour obtenir une
  URL de téléchargement contenant un jeton, valide pendant 300 secondes par défaut
  (`STORAGE_DOWNLOAD_TOKEN_TTL`, jusqu'à une semaine).

Depuis une fonction, écrivez avec `rebase.storage` (le bucket par défaut) ou
`rebase.bucket(…)` (un bucket nommé). Votre hook `storageAuthorize` détermine toujours
si l'écriture est autorisée.

Les transformations d'images (`?width=`, `?format=`) nécessitent `sharp`, qui est un module natif
non présent dans l'image managée. Sur le runtime managé, une requête de transformation
renvoie l'image originale.

### Exemple : mettre en cache de l'audio généré

Une fonction qui convertit du texte en parole avec une API hébergée, stocke chaque résultat
une fois, et le sert ensuite depuis le stockage. La `Map` permet uniquement d'économiser
une recherche dans le stockage sur une instance chaude ; le bucket constitue le véritable cache, de sorte qu'un déploiement
ne perd rien.

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

La route est publique, comme chaque route dans `backend/functions/` tant que vous ne la
protégez pas. Une implémentation réelle vérifierait qui a le droit de générer de l'audio, afin qu'un inconnu
ne puisse pas consommer votre quota d'API vocale.

## Réseau sortant

Les fonctions peuvent appeler des services externes. Les connexions sortantes depuis vos instances
sont autorisées vers n'importe quelle adresse Internet sur ces ports TCP uniquement :

| Port | Usage |
|---|---|
| 80, 443 | HTTP et HTTPS |
| 465, 587 | Envoi d'e-mails via SMTP avec TLS ou STARTTLS |
| 993 | IMAP via TLS |

Tout le reste est bloqué. Cela inclut le port 25, l'IMAP non chiffré, ainsi que les bases de données ou
caches sur leurs ports habituels : Redis sur 6379 ou MongoDB sur 27017 en dehors de Rebase
Cloud ne peuvent pas être atteints. L'adresse des métadonnées cloud (`169.254.169.254`) est
également bloquée.

La seule exception est votre propre base de données. Si le projet apporte son propre
PostgreSQL (BYODB), chaque déploiement autorise aussi les connexions vers l'hôte de cette base
sur le port de sa chaîne de connexion, et vers rien d'autre sur ce port.
L'hôte est résolu en adresses IP au moment du déploiement : si votre fournisseur
déplace la base vers une autre adresse, déployez à nouveau. La base doit accepter
les connexions depuis internet : l'application se connecte directement à la chaîne
de connexion. Les paramètres du bastion SSH ne servent qu'au test de connexion, pas
à l'application déployée.

La plateforme n'ajoute aucun proxy ni aucune limite de débit sortant ; les services que vous appelez
disposent de leurs propres limites. Passez `getSignal(c)` à `fetch` pour qu'un appel s'arrête lorsque sa requête
expire.

Il n'y a **aucune adresse IP sortante fixe**. Le trafic sort par une adresse
partagée par tous les projets, attribuée par le fournisseur cloud et susceptible de changer ; ne l'ajoutez
donc pas à une liste d'autorisation (allowlist) tierce. Authentifiez-vous plutôt auprès d'un tel service
à l'aide d'une clé.

## Démarrage et arrêt

- **Démarrage à froid (Cold start).** Une nouvelle instance télécharge et décompresse le
  bundle avant de pouvoir traiter des requêtes : un arbre de dépendances volumineux ralentit
  donc chaque mise à l'échelle (scale-up). Un bundle téléversé sans ses dépendances les
  installe en plus, ce qui ajoute 40 à 60 secondes. La plateforme attend jusqu'à 300 secondes
  qu'une instance devienne opérationnelle.
- **Santé (Health check).** La plateforme vérifie `/livez` (le processus fonctionne) et
  `/health` (il peut joindre la base de données). Ces deux endpoints sont servis par le runtime, vous
  n'avez donc pas à les implémenter.
- **Arrêt (Shutdown).** Lors d'un déploiement ou d'un redémarrage, l'instance cesse d'accepter de nouvelles requêtes,
  attend 5 secondes que le trafic bascule, puis reçoit un signal `SIGTERM`. Les requêtes en cours
  disposent de 15 secondes maximum pour se terminer. Les promesses transmises à `waitUntil` bénéficient de
  5 secondes maximum sur ce délai. Toute promesse non confiée à `waitUntil` est abandonnée.
  Voir [Tâches de fond](/docs/backend/custom-functions/#background-work).

## Quand le mode managé n'est pas adapté

Passez le backend sur `"runtime": "custom"` lorsqu'il requiert :

- un module natif, ou un binaire système qu'aucun paquet npm ne fournit, tel que `sharp`,
  ImageMagick ou un moteur vocal local ;
- des paquets système ou une image de base différente ;
- une connexion persistante vers un service en dehors des ports autorisés.

Un runtime personnalisé compile votre propre Dockerfile, et vous devenez responsable de l'image
par la suite. La commande `rebase cloud deploy --eject` permet d'effectuer cette transition. Voir
[Rebase Cloud](/docs/deployment/cloud/#deploy).

## Pas encore garanti

- **Historique des logs.** `rebase cloud logs --runtime` lit les logs des instances en
  cours d'exécution, et `rebase cloud debug logs --previous` ceux de la dernière exécution d'une instance
  ayant redémarré. Les sorties d'une instance remplacée par un déploiement sont perdues. Écrivez
  tout ce que vous devez conserver dans la base de données ou vers votre propre service de logs.
- **Scale to zero** n'est pas proposé. Chaque backend exécute au moins une instance en
  permanence.

## Pages connexes

- [Rebase Cloud](/docs/deployment/cloud/) : liaison, déploiement, réglages de compute,
  et ce que la version bêta n'inclut pas
- [Fonctions personnalisées](/docs/backend/custom-functions/) : écriture des routes dans
  `backend/functions/`
- [Runtime et Bundles](/docs/architecture/runtime-and-bundles/) : structure d'un bundle
  et processus de démarrage par le runtime
- [Stockage](/docs/backend/storage/) : buckets, endpoints, limites de taille et règles
  d'accès
- [Exécuter plusieurs instances](/docs/deployment/multiple-instances/) : l'état
  conservé par Rebase pour chaque processus
