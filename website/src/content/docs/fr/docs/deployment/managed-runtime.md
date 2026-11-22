---
sourceHash: a657ab288833ddd3
title: Runtime backend managé
sidebar_label: Runtime managé
description: Ce qu'un backend avec le runtime "managed" peut et ne peut pas faire sur Rebase Cloud — paquets et binaires, mémoire et CPU, timeouts et tailles de corps, système de fichiers, état en mémoire, secrets, stockage pour les fichiers générés et réseau sortant.
---

Une application backend déclarée ainsi dans `rebase.json` s'exécute sur le **runtime
managé** :

```json title="rebase.json"
{
    "apps": {
        "backend": { "type": "backend", "runtime": "managed" }
    }
}
```

Managé signifie que vous livrez un bundle, pas une image. `rebase cloud deploy` compile vos
tables, `backend/functions/` et crons dans `dist-bundle`, le téléverse, et
Rebase Cloud le démarre sur l'image publiée `rebasepro/server`. Vous n'écrivez jamais
de Dockerfile, et vous ne pouvez pas non plus modifier ce qui se trouve dans l'image. Cette page liste
ce que cela permet, afin que vous puissiez planifier une fonctionnalité avant de la développer.

Les chiffres présentés ici proviennent du runtime et de la plateforme tels qu'ils sont aujourd'hui. Certains
sont des paramètres ajustables, et la page indique lesquels. Les rares éléments qui ne sont
pas encore garantis sont regroupés [à la fin](#pas-encore-garanti).

## En un coup d'œil

| Question | Réponse |
|---|---|
| Version de Node | Node 22, sur Debian slim, `linux`/`x64` |
| Paquets npm | Oui, depuis le registre public ou un registre privé. Installés dans le bundle lors du déploiement |
| Modules natifs (`.node`, node-gyp) | Non. `rebase cloud deploy` refuse le bundle |
| WebAssembly | Oui |
| Lancer un processus enfant (spawn) | Oui, pour un binaire `linux`/`x64` fourni par un paquet npm. Voir [Binaires](#binaires-et-processus-enfants) |
| Mémoire et CPU | Définis par projet avec `rebase cloud compute`. Voir [Ressources de calcul](#ressources-de-calcul-et-instances) |
| Instances | 1 par défaut, toujours active. Vous pouvez en fixer jusqu'à 5, ou laisser l'autoscaler monter jusqu'à 16 |
| Timeout de fonction | 30 secondes, puis `504 FUNCTION_TIMEOUT`. Configurable jusqu'à 10 minutes |
| Corps de la requête | 10 Mio, puis `413`. Configurable, jusqu'aux 64 Mio acceptés par l'edge |
| Système de fichiers accessible en écriture | Oui, mais il est temporaire et propre à une seule instance |
| État au niveau du module (cache `Map`) | Persiste entre les requêtes sur une même instance. Perdu à chaque déploiement et redémarrage, et non partagé entre instances |
| Variables d'environnement et secrets | `rebase cloud env set`, appliqués au prochain déploiement |
| Stockage de fichiers | Un bucket par projet, servi par votre backend sur `/api/storage/file/…` |
| HTTP sortant | Oui, sur les ports 80 et 443 (et 465, 587, 993 pour les e-mails). Les autres ports sont bloqués. Une adresse IP sortante fixe unique : `207.175.138.15` |

## Code et paquets

**Node et l'image.** L'image du runtime est basée sur `node:22-slim`
(Debian), et votre bundle s'exécute sur `linux`/`x64` en tant qu'utilisateur non-root. Votre
`tsconfig` et la version de Node sur votre machine n'y changent rien.

**Dépendances.** `rebase cloud deploy` installe les dépendances déclarées dans vos
fichiers `package.json` dans le bundle, pour `linux`/`x64`, et les téléverse
avec lui, de sorte qu'une nouvelle instance n'a rien à installer. Un bundle qui dépasserait
la limite de téléversement de 1 Go avec celles-ci est téléversé sans elles, et le déploiement
le signale : chaque instance les installe alors à son démarrage, avec `npm ci` (ou
`npm install` sans fichier lockfile). Quatre conséquences découlent de leur mode d'installation :

- **Les scripts d'installation ne s'exécutent jamais.** L'installation utilise `--ignore-scripts`. Un paquet
  qui télécharge un binaire ou compile quelque chose lors du `postinstall` s'installe sans
  celui-ci.
- **Seules les versions du registre s'installent.** Une dépendance `file:`, `link:`, `git+…` ou `github:`
  fait échouer le build, car le runtime n'a aucun moyen de la résoudre.
- **Certains paquets proviennent de l'image, pas de vous.** `@rebasepro/server`,
  `@rebasepro/types`, `@rebasepro/client`, `@rebasepro/common`,
  `@rebasepro/utils`, `hono`, `@hono/node-server` et `zod` sont retirés des
  dépendances du bundle et les propres copies de l'image sont liées, ainsi votre
  version de ces paquets ne s'applique pas. D'autres paquets `@rebasepro/*`, comme le
  driver de base de données, s'installent depuis votre `package.json` comme n'importe quelle dépendance.
  `typescript` et `tsx` sont également retirés ; ce sont des outils de build.
- **Les paquets privés nécessitent un `.npmrc`.** `rebase build` copie le `.npmrc` du projet
  (et `backend/.npmrc`) dans le bundle, afin que l'installation utilise les mêmes
  paramètres de registre que votre machine. Chaque identifiant à l'intérieur doit être une
  référence à une variable d'environnement, jamais le jeton lui-même ; un jeton écrit en clair fait
  échouer le build, car le bundle est téléversé avec votre code :

  ```ini title=".npmrc"
  @acme:registry=https://npm.pkg.github.com
  //npm.pkg.github.com/:_authToken=${NPM_TOKEN}
  ```

  ```bash
  rebase cloud env set NPM_TOKEN=ghp_… --secret
  ```

Le téléversement du bundle est limité à 1 Go, compressé.

**Les modules natifs sont refusés.** Un paquet qui fournit un binaire compilé `.node`
ne peut pas se charger sur le runtime managé. `rebase build` émet un avertissement à ce sujet, et
`rebase cloud deploy` s'arrête avant le téléversement :

```text no-verify
This bundle depends on native modules (sharp), which the managed runtime cannot run
```

La vérification recherche les paquets natifs bien connus (`sharp`, `canvas`, `bcrypt`,
`argon2`, `sqlite3`, `better-sqlite3`, `re2`, `sodium-native`, `pg-native`, …),
la présence de `binding.gyp` ou `gypfile`, les scripts d'installation qui appellent `node-gyp` ou
`prebuild`, et les fichiers `.node`. Le
[guide de déploiement](/docs/getting-started/deployment/#native-modules-on-the-managed-runtime)
liste les solutions habituelles pour contourner cela. En résumé : effectuez le traitement au moment du build,
faites appel à un service tiers, ou déployez avec `runtime: "custom"`.

**WebAssembly fonctionne.** Un paquet qui fournit un fichier `.wasm` et le charge depuis
JavaScript n'est pas un module natif, et Node 22 l'exécute. Testé dans
l'image de base du runtime avec les paramètres de sécurité du pod, à l'aide de `esbuild-wasm`.
Gardez à l'esprit la [limite de mémoire](#ressources-de-calcul-et-instances) si le module est volumineux,
comme un modèle vocal ou de ML.

### Binaires et processus enfants

`child_process` fonctionne. L'image elle-même contient très peu d'exécutables : `node`, `npm`,
`sh`, `tar`, et les outils clients PostgreSQL (`pg_dump`, `pg_restore`). Il n'y a pas
de `ffmpeg`, pas d'ImageMagick, pas de Python et pas de compilateur, et vous ne pouvez pas ajouter
de paquets système, car il n'y a pas de Dockerfile et le processus n'est pas root.

Un binaire qu'un paquet npm transporte **à l'intérieur de sa propre archive tarball** s'installe avec
le paquet et s'exécute. Il doit être compilé pour `linux`/`x64` avec glibc
(Debian), et il s'exécute en tant qu'utilisateur non privilégié sans capacités Linux.
Testé avec `@esbuild/linux-x64` dans l'image de base du runtime. Un binaire qu'un
paquet *télécharge* lors du `postinstall` n'arrive jamais, car les scripts d'installation ne
s'exécutent pas ; des paquets comme `ffmpeg-static` fonctionnent de cette manière.

Si une fonctionnalité nécessite un binaire, utilisez une API hébergée pour cette tâche, ou passez le
backend sur `runtime: "custom"`, où vous construisez votre propre image.

## Ressources de calcul et instances

Chaque projet s'exécute dans ses propres pods. La mémoire et le CPU sont définis par instance, et vous les
configurez avec les [paramètres de calcul](/docs/deployment/cloud/#compute-and-what-it-costs) :

```bash
rebase cloud compute                              # ce que le projet réserve actuellement
rebase cloud compute set --cpu 500m --memory 1Gi
```

Un projet qui n'a jamais configuré de paramètre s'exécute comme un pod burstable. En Belgique
(europe-west1), la configuration par défaut réserve 100m CPU et 384Mi et peut monter en burst jusqu'à 2 CPU
et 2 Gio ; à Falkenstein et Helsinki, la mémoire peut s'étendre jusqu'à 1,4× la demande
et le CPU jusqu'à 10× (au maximum 1,7 vCPU). `rebase cloud compute` affiche les
chiffres de votre projet.

Instances :

- **Une par défaut, toujours active.** `--replicas` permet de fixer entre 1 et 5 instances.
  Rien ne réduit un backend à zéro.
- **L'autoscaling est optionnel.** `--autoscale-max` définit un plafond allant jusqu'à 16, et
  `--autoscale-cpu-target` (par défaut 70) correspond à l'utilisation CPU ciblée par l'autoscaler.
- **Les déploiements sont progressifs (rolling).** Une nouvelle instance démarre et devient prête avant que l'ancienne ne
  s'arrête, ainsi pendant un court instant, deux versions traitent le trafic.

`--spot` est désactivé par défaut ; les instances spot sont moins chères et redémarrées sans
préavis.

## Mémoire et état au niveau du module

Une valeur définie au niveau du module, comme `const cache = new Map()` au début d'un fichier
de fonction, réside dans le processus Node. Elle persiste d'une requête à l'autre sur
la même instance. Elle est perdue dès que ce processus prend fin :

- à **chaque déploiement**, car chaque déploiement démarre de nouvelles instances ;
- lorsqu'une **variable d'environnement** change et est déployée ;
- lorsqu'une instance est redémarrée, replanifiée ou (avec `--spot`) récupérée.

Avec plusieurs instances, chacune possède sa propre copie, de sorte que deux requêtes peuvent voir
des caches différents.

Utilisez une `Map` au niveau du module comme un cache que vous pouvez vous permettre de perdre : un cache qui rend la
requête suivante plus rapide, mais qui n'est la copie unique de rien. Conservez tout ce qui a un coût
de production, comme un fichier audio généré ou une réponse d'API coûteuse, dans la
base de données ou dans le [stockage](#stockage-pour-les-fichiers-générés). Pour les clients que vous construisez
une seule fois, comme le SDK d'une API, utilisez `lazyResource` afin que le client soit construit à la première
utilisation à partir de l'environnement de la requête. Voir
[Configuration et Secrets](/docs/backend/custom-functions/#configuration-and-secrets).

[Exécuter plusieurs instances](/docs/deployment/multiple-instances/) liste
l'état que Rebase conserve lui-même par processus, comme les compteurs de rate-limit et
les canaux en temps réel.

## Le système de fichiers

Le système de fichiers du conteneur est accessible en écriture, et `/tmp` fonctionne. Mais tout
ce qui y est écrit :

- appartient à une seule instance, et les autres instances ne le voient pas ;
- est supprimé lorsque l'instance s'arrête, donc au plus tard lors du prochain déploiement ;
- partage une limite de stockage éphémère de 6 Gio avec le bundle et ses
  `node_modules` installés. Une instance qui dépasse cette limite est expulsée (evicted).

Utilisez-le pour des fichiers temporaires durant une seule requête. Ne l'utilisez pas comme un cache entre
les déploiements ni comme stockage pour les téléversements. C'est également la raison pour laquelle
[`STORAGE_TYPE=local` est désactivé en production](/docs/backend/storage/#environment-variables).

## Requêtes

| Limite | Valeur par défaut | Modifiable avec |
|---|---|---|
| Timeout de fonction | 30 s, puis `504` avec le code `FUNCTION_TIMEOUT` | `REBASE_FUNCTIONS_TIMEOUT_MS` (`0` le désactive), ou le paramètre propre à une fonction `defineFunction(…, { timeoutMs })` |
| Timeout propre d'une fonction, au maximum | 300 s | `REBASE_FUNCTIONS_MAX_TIMEOUT_MS` |
| Attente sur votre instance, au niveau de l'edge | 10 minutes entre les lectures ou écritures | Fixe |
| Corps de la requête, routes `/api/*` sans limite propre | 10 Mio, puis `413 PAYLOAD_TOO_LARGE` | `REBASE_MAX_BODY_SIZE`, en octets |
| Corps de la requête au niveau de l'edge | 64 Mio | Fixe |
| Un fichier via `POST /api/storage/upload` | 50 Mo | `STORAGE_MAX_FILE_SIZE` |
| Appels anonymes vers `/api/functions/*` | 3000 par IP par 15 minutes | `rateLimit.anonymousFunctions` |

Quelques précisions :

- **Le timeout libère l'appelant, pas le travail en cours.** Au bout de 30 secondes, l'appelant reçoit
  une erreur `504`, et `getSignal(c)` est interrompu (aborted). Transmettez ce signal à `fetch` et à
  tout ce qui en accepte un, afin que le travail s'arrête également. Voir
  [Timeouts et limites de débit](/docs/backend/custom-functions/#timeouts-and-rate-limits).
- **L'edge attend plus longtemps que le runtime.** L'ingress devant vos
  instances attend jusqu'à 10 minutes, la limite qu'une requête rencontre est donc celle du runtime,
  qui répond en JSON et interrompt le signal. Augmentez `REBASE_FUNCTIONS_TIMEOUT_MS`
  jusqu'à cette valeur, ou donnez à la fonction spécifique qui en a besoin son propre
  [`timeoutMs`](/docs/backend/custom-functions/#timeouts-and-rate-limits). Pour les tâches qui prennent plus de temps, ou qui doivent survivre à un déploiement (une
  instance draine les connexions pendant 15 secondes), répondez immédiatement et exécutez le travail dans un
  [job](/docs/backend/jobs/).
- **Les téléversements de plus de 64 Mio** nécessitent le téléversement avec reprise (TUS), qui envoie
  le fichier par morceaux. `client.storage.putObject()` bascule dessus automatiquement
  au-delà de 8 Mio.
- **Taille de la réponse.** Ni le runtime ni l'edge n'imposent de limite sur la taille
  de la réponse. Une réponse volumineuse est tout de même conservée en mémoire si votre gestionnaire la construit en
  un seul bloc, privilégiez donc le streaming ou servez-la depuis le stockage.

### Moniteurs et tâches planifiées dans `/metrics`
<span class="since-badge" data-since="0.35">Depuis 0.35</span>

Une requête provenant d'un moniteur de disponibilité (uptime) connu (identifié d'après son `User-Agent`), ou portant un en-tête `x-rebase-probe` avec n'importe quelle valeur, est servie mais comptabilisée dans `rebase_probe_requests_total` au lieu de `rebase_requests_total`, afin qu'un moniteur ne soit pas interprété comme du trafic. `rebase_scheduled_jobs` correspond au nombre de tâches cron activées et enregistrées dans l'application et `rebase_background_workers` vaut 1 tant que ce processus exécute un worker de file d'attente de jobs ; tous deux s'arrêtent lorsqu'un déploiement est mis à l'échelle à zéro, raison pour laquelle une plateforme mettant en veille les projets inactifs les lit.

## Variables d'environnement et secrets

Définissez-les avec la CLI ou dans la console. Il n'y a pas de champ pour elles dans
`rebase.json`.

```bash
rebase cloud env set TTS_API_URL=https://api.example.com/v1/speech
rebase cloud env set TTS_API_KEY=sk-… --secret   # écriture seule : jamais réaffiché
rebase cloud env list                            # noms uniquement, jamais les valeurs
rebase cloud deploy                              # applique la modification
```

- **Une modification s'applique au prochain déploiement.** Les instances en cours d'exécution conservent les valeurs
  avec lesquelles elles ont démarré. `set` et `unset` vous le rappellent
  (`Pending redeploy`).
- **Limites :** jusqu'à 100 variables par projet, 32 Kio par valeur et 256 Kio au
  total. Les noms suivent le format `[A-Za-z_][A-Za-z0-9_]*`.
- **Certains noms sont réservés.** La plateforme définit elle-même `DATABASE_URL`,
  `DATABASE_DIRECT_URL`, `DATABASE_READ_URL`, `JWT_SECRET`,
  `REBASE_SERVICE_KEY`, `PORT` et `NODE_ENV`, et verrouille la manière dont le processus
  s'exécute (`REBASE_ROLE`, `TRUSTED_PROXY_HOPS`, …). Tenter d'en définir une est
  refusé, et l'erreur les liste toutes.
- **`CORS_ORIGINS` commence à partir de vos domaines.** La plateforme l'initialise avec l'hôte du
  projet et ses [domaines personnalisés](/docs/deployment/cloud/#the-rest-of-the-surface) vérifiés.
  Une valeur `CORS_ORIGINS` que vous définissez est ajoutée à cette liste, pour un frontend hébergé
  ailleurs : `rebase cloud env set CORS_ORIGINS=https://app.example.org`.
- **Les variables de stockage sont des valeurs par défaut.** La plateforme écrit les variables `STORAGE_*`
  et `S3_*` pour son bucket, et une valeur que vous définissez prend le dessus.
- **Les noms liés au moment du build sont refusés.** Les variables `VITE_`, `NEXT_PUBLIC_`, `PUBLIC_` et
  `REACT_APP_` sont destinées aux frontends lors du build, et le backend
  ne les reçoit jamais à temps. `--force` permet d'en enregistrer une malgré tout.

Dans une fonction, lisez-les à l'intérieur du gestionnaire, jamais au début du fichier :

```typescript
import { defineFunction, requireEnv } from "@rebasepro/server/functions";

export default defineFunction((app) => {
    app.get("/status", async (c) => {
        const endpoint = requireEnv(c, "TTS_API_URL");   // lève une erreur explicite si non défini
        return c.json({ configured: Boolean(endpoint) });
    });
});
```

Une lecture de `process.env` à la portée du module qui renvoie une valeur vide empêche le fichier complet
de se charger, et ses routes répondent par un `404`. Voir
[Configuration et Secrets](/docs/backend/custom-functions/#configuration-and-secrets).

## Stockage pour les fichiers générés

Un projet Cloud obtient un stockage de fichiers dès que vous le créez :

```bash
rebase cloud storage create   # un bucket managé et ses identifiants
rebase cloud deploy           # le backend en cours d'exécution reçoit les identifiants au déploiement
```

Ou pointez le projet vers un bucket que vous possédez déjà avec
`rebase cloud storage attach` (S3, R2, MinIO, tout bucket compatible S3).
Sans l'un ou l'autre, les téléversements renvoient `501 STORAGE_NOT_CONFIGURED`. D'autres buckets sont
déclarés dans `backend/resources.ts` ; voir
[Plusieurs buckets](/docs/backend/storage/#several-buckets).

Un déploiement avec stockage est refusé tant que le projet n'a pas défini qui peut lire et écrire
des fichiers. Le fichier d'échafaudage `backend/storage.ts` exporte un hook `storageAuthorize` à
cet effet. Voir [Autorisation par objet](/docs/backend/storage-authorization/).

**Comment les fichiers sont servis.** Votre backend sert chaque fichier à l'adresse
`GET /api/storage/file/<key>`. Il lit l'objet depuis le bucket et le transmet en streaming,
avec le `Content-Type`, les requêtes par plage (range requests) et les en-têtes de mise en cache. Il n'y a pas d'URL directe
vers le bucket à distribuer.

- Une clé sous **`public/`** est servie à tout le monde, sans jeton, à une URL
  qui ne change jamais. Utilisez-la pour les fichiers que tout visiteur peut charger, comme un enregistrement
  audio généré pour un jeu public.
- Toute autre clé est privée. Un client sollicite `/api/storage/metadata/<key>` pour obtenir une
  URL de téléchargement contenant un jeton, valide pendant 300 secondes par défaut
  (`STORAGE_DOWNLOAD_TOKEN_TTL`, jusqu'à une semaine).

Depuis une fonction, écrivez avec `rebase.storage` (le bucket par défaut) ou
`rebase.bucket(…)` (un bucket nommé). Votre hook `storageAuthorize` décide toujours
si l'écriture est autorisée.

Les transformations d'images (`?width=`, `?format=`) nécessitent `sharp`, qui est un module natif
et n'est pas présent dans l'image managée. Sur le runtime managé, une requête de transformation
renvoie l'image originale.

### Exemple : mettre en cache un fichier audio généré

Une fonction qui convertit du texte en parole avec une API hébergée, stocke chaque résultat
une seule fois, et le sert ensuite depuis le stockage. La `Map` permet uniquement d'économiser une
recherche dans le stockage sur une instance chaude (warm) ; le bucket est le véritable cache, ainsi un déploiement ne perd
rien.

```typescript
import { defineFunction, getSignal, requireEnv } from "@rebasepro/server/functions";

const known = new Map<string, true>(); // par instance, perdu lors du déploiement : ce n'est pas grave

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
protégez pas. Une implémentation réelle vérifierait qui peut générer un nouvel enregistrement audio, afin qu'un inconnu ne puisse pas
consommer votre quota d'API vocale.

## Réseau sortant

Les fonctions peuvent appeler des services externes. Les connexions sortantes depuis vos instances
sont autorisées vers n'importe quelle adresse Internet uniquement sur ces ports TCP :

| Port | Utilisation |
|---|---|
| 80, 443 | HTTP et HTTPS |
| 465, 587 | Envoi d'e-mails via SMTP avec TLS ou STARTTLS |
| 993 | IMAP avec TLS |

Tout le reste est bloqué. Cela inclut le port 25, l'IMAP non chiffré, ainsi que les bases de données ou
caches sur leurs propres ports : Redis sur 6379 ou MongoDB sur 27017 en dehors de Rebase
Cloud ne peuvent pas être joints. L'adresse de métadonnées cloud (`169.254.169.254`) est
également bloquée.

La seule exception est votre propre base de données. Si le projet apporte sa propre base
PostgreSQL (BYODB), chaque déploiement autorise également les connexions vers l'hôte de cette base
de données sur le port spécifié dans sa chaîne de connexion, et vers rien d'autre sur ce port.
L'hôte est résolu en ses adresses IP lors du déploiement, donc si votre fournisseur
déplace la base de données vers une autre adresse, redéployez. La base de données doit accepter
les connexions depuis Internet : l'application se connecte directement à la chaîne de connexion.
Les paramètres de bastion SSH sont utilisés uniquement par le test de connexion, pas
par l'application déployée.

La plateforme n'ajoute aucun proxy ni aucune limite de débit sortant ; les services que vous appelez
ont leurs propres limites. Transmettez `getSignal(c)` à `fetch` pour qu'un appel s'interrompe lorsque sa requête
expire.

Tout le trafic sortant provient d'**une adresse IP fixe unique, `207.175.138.15`**.
Ajoutez-la à la liste d'autorisation (allowlist) d'un tiers lorsqu'un service en requiert une. L'adresse est
partagée par tous les projets sur Rebase Cloud, donc une liste d'autorisation prouve uniquement que l'appelant s'exécute
sur Rebase Cloud, et non qu'il s'agit de votre projet : continuez à vous authentifier auprès du
service avec une clé également.

## Démarrage et arrêt

- **Démarrage à froid (Cold start).** Une nouvelle instance télécharge et décompresse le bundle avant de
  servir du trafic, un arbre de dépendances volumineux ralentit donc chaque mise à l'échelle (scale-up). Un bundle
  téléversé sans ses dépendances doit également les installer, ce qui ajoute 40 à 60
  secondes. La plateforme attend jusqu'à 300 secondes qu'une instance devienne opérationnelle.
- **Santé (Health).** La plateforme vérifie `/livez` (le processus est en cours d'exécution) et
  `/health` (il peut joindre la base de données). Tous deux sont servis par le runtime, vous n'avez donc
  pas à les écrire.
- **Arrêt.** Lors d'un déploiement ou d'un redémarrage, l'instance cesse d'accepter de nouvelles requêtes,
  attend 5 secondes que le trafic bascule, puis reçoit `SIGTERM`. Les requêtes en cours
  de traitement disposent de 15 secondes maximum pour se terminer. Les promesses passées à `waitUntil` obtiennent jusqu'à
  5 secondes de ce délai. Une promesse que vous n'avez pas transmise à `waitUntil` est abandonnée.
  Voir [Tâches en arrière-plan](/docs/backend/custom-functions/#background-work).

## Quand le mode managé n'est pas adapté

Basculez le backend sur `"runtime": "custom"` lorsqu'il nécessite :

- un module natif, ou un binaire système qu'aucun paquet npm ne fournit, tel que `sharp`,
  ImageMagick ou un moteur vocal local ;
- des paquets système ou une image de base différente ;
- une connexion persistante vers un service en dehors des ports autorisés.

Un runtime personnalisé compile votre propre Dockerfile, et vous gérez l'image à partir de
ce moment. `rebase cloud deploy --eject` permet d'effectuer la transition. Voir
[Rebase Cloud](/docs/deployment/cloud/#deploy).

## Pas encore garanti

- **Historique des logs.** `rebase cloud logs --runtime` lit depuis les instances en cours
  d'exécution, et `rebase cloud debug logs --previous` depuis la dernière exécution d'une
  instance qui a redémarré. Les sorties d'une instance remplacée par un déploiement sont perdues. Écrivez
  tout ce que vous devez conserver dans la base de données ou vers votre propre service de logs.
- **La mise à l'échelle à zéro (Scale to zero)** n'est pas proposée. Chaque backend exécute au moins une instance en
  permanence.

## Pages associées

- [Rebase Cloud](/docs/deployment/cloud/) : liaison, déploiement, paramètres de calcul
  et ce que la bêta n'inclut pas
- [Fonctions personnalisées](/docs/backend/custom-functions/) : écriture des routes dans
  `backend/functions/`
- [Runtime et Bundles](/docs/architecture/runtime-and-bundles/) : qu'est-ce qu'un bundle
  et comment le runtime le démarre
- [Stockage](/docs/backend/storage/) : buckets, points de terminaison, limites de taille et règles
  d'accès
- [Exécuter plusieurs instances](/docs/deployment/multiple-instances/) : l'état
  conservé par Rebase par processus
