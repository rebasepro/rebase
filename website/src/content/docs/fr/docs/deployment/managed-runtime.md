---
sourceHash: 9e1445cbb512338c
title: Runtime backend managé
sidebar_label: Runtime managé
description: Ce qu'un backend avec le runtime « managed » peut et ne peut pas faire sur Rebase Cloud — paquets et binaires, mémoire et processeur, timeouts et tailles de payload, système de fichiers, état en mémoire, secrets, stockage des fichiers générés et réseau sortant.
---

Une application backend déclarée comme ceci dans `rebase.json` s'exécute sur le **runtime managé** :

```json title="rebase.json"
{
    "apps": {
        "backend": { "type": "backend", "runtime": "managed" }
    }
}
```

« Managé » signifie que vous livrez un bundle, et non une image. `rebase cloud deploy` compile vos tables, `backend/functions/` et crons dans `dist-bundle`, le téléverse, et Rebase Cloud le démarre sur l'image publiée `rebasepro/server`. Vous n'avez jamais à écrire de Dockerfile, et vous ne pouvez pas non plus modifier ce qui se trouve dans l'image. Cette page répertorie ce qui est autorisé, afin que vous puissiez planifier une fonctionnalité avant de la concevoir.

Les chiffres indiqués ici correspondent au runtime et à la plateforme tels qu'ils sont aujourd'hui. Certains sont des réglages que vous pouvez modifier, et la page précise lesquels. Les quelques éléments qui ne sont pas encore garantis sont regroupés [à la fin](#pas-encore-garanti).

## En un coup d'œil

| Question | Réponse |
|---|---|
| Version de Node | Node 22, sur Debian slim, `linux`/`x64` |
| Paquets npm | Oui, depuis le registre public ou un registre privé. Installés dans le bundle lors du déploiement |
| Modules natifs (`.node`, node-gyp) | Non. `rebase cloud deploy` refuse le bundle |
| WebAssembly | Oui |
| Lancer un processus enfant | Oui, pour un binaire `linux`/`x64` fourni par un paquet npm. Voir [Binaires](#binaires-et-processus-enfants) |
| Mémoire et processeur | Définis par projet avec `rebase cloud compute`. Voir [Calcul](#calcul-et-instances) |
| Instances | 1 par défaut, toujours active. Vous pouvez en fixer jusqu'à 5, ou laisser l'autoscaler monter jusqu'à 16 |
| Timeout des fonctions | 30 secondes, puis `504 FUNCTION_TIMEOUT`. Configurable jusqu'à 10 minutes |
| Corps de requête | 10 MiB, puis `413`. Configurable, jusqu'aux 64 MiB acceptés par l'edge |
| Système de fichiers accessible en écriture | Oui, mais il est temporaire et propre à chaque instance |
| État au niveau du module (cache `Map`) | Persiste entre les requêtes sur une même instance. Perdu à chaque déploiement et redémarrage, et non partagé entre les instances |
| Variables d'environnement et secrets | `rebase cloud env set`, appliqués au prochain déploiement |
| Stockage de fichiers | Un bucket par projet, servi par votre backend sur `/api/storage/file/…` |
| HTTP sortant | Oui, sur les ports 80 et 443 (et 465, 587, 993 pour les e-mails). Les autres ports sont bloqués. Une adresse IP sortante fixe : `207.175.138.15` |

## Code et paquets

**Node et l'image.** L'image du runtime est basée sur `node:22-slim` (Debian), et votre bundle s'exécute sur `linux`/`x64` en tant qu'utilisateur non-root. Votre `tsconfig` et la version de Node sur votre machine ne changent rien à cela.

**Dépendances.** `rebase cloud deploy` installe dans le bundle les dépendances déclarées dans vos fichiers `package.json`, pour `linux`/`x64`, et les téléverse avec celui-ci, afin qu'une nouvelle instance n'ait rien à installer. Un bundle qui dépasserait la limite de téléversement de 1 Go avec les dépendances est téléversé sans elles, et le déploiement le signale : chaque instance les installe alors à son démarrage, avec `npm ci` (ou `npm install` en l'absence de lockfile). Quatre conséquences découlent de ce mode d'installation :

- **Les scripts d'installation ne s'exécutent jamais.** L'installation utilise `--ignore-scripts`. Un paquet qui télécharge un binaire ou compile un élément dans `postinstall` s'installera sans cela.
- **Seules les versions issues d'un registre sont installées.** Une dépendance `file:`, `link:`, `git+…` ou `github:` fait échouer le build, car le runtime n'a aucun moyen de la résoudre.
- **Certains paquets proviennent de l'image, pas de vous.** `@rebasepro/server`, `@rebasepro/types`, `@rebasepro/client`, `@rebasepro/common`, `@rebasepro/utils`, `hono`, `@hono/node-server` et `zod` sont retirés des dépendances du bundle et les copies propres à l'image y sont liées, de sorte que votre propre version de ces paquets ne s'applique pas. Les autres paquets `@rebasepro/*`, comme le pilote de base de données, s'installent depuis votre `package.json` comme n'importe quelle dépendance. `typescript` et `tsx` sont également retirés ; ce sont des outils de build.
- **Les paquets privés nécessitent un `.npmrc`.** `rebase build` copie le `.npmrc` du projet (et `backend/.npmrc`) dans le bundle, de sorte que l'installation utilise les mêmes paramètres de registre que votre machine. Chaque identifiant doit être une référence à une variable d'environnement, et jamais le jeton lui-même ; un jeton écrit en dur fait échouer le build, car le bundle est téléversé avec votre code :

  ```ini title=".npmrc"
  @acme:registry=https://npm.pkg.github.com
  //npm.pkg.github.com/:_authToken=${NPM_TOKEN}
  ```

  ```bash
  rebase cloud env set NPM_TOKEN=ghp_… --secret
  ```

Le téléversement du bundle est limité à 1 Go, compressé.

**Les modules natifs sont refusés.** Un paquet qui intègre un binaire `.node` compilé ne peut pas être chargé sur le runtime managé. `rebase build` émet un avertissement, et `rebase cloud deploy` s'arrête avant le téléversement :

```text no-verify
This bundle depends on native modules (sharp), which the managed runtime cannot run
```

La vérification recherche des paquets natifs connus (`sharp`, `canvas`, `bcrypt`, `argon2`, `sqlite3`, `better-sqlite3`, `re2`, `sodium-native`, `pg-native`, …), la présence de `binding.gyp` ou `gypfile`, des scripts d'installation qui appellent `node-gyp` ou `prebuild`, et des fichiers `.node`. Le [guide de déploiement](/docs/getting-started/deployment/#native-modules-on-the-managed-runtime) détaille les solutions habituelles pour contourner cela. En résumé : effectuez le travail au moment du build, faites appel à un service tiers, ou déployez avec `runtime: "custom"`.

**WebAssembly fonctionne.** Un paquet qui intègre un fichier `.wasm` et le charge depuis JavaScript n'est pas un module natif, et Node 22 l'exécute. Cela a été vérifié dans l'image de base du runtime avec les paramètres de sécurité du pod, à l'aide de `esbuild-wasm`. Gardez à l'esprit la [limite de mémoire](#calcul-et-instances) si le module est volumineux, comme un modèle vocal ou de ML.

### Binaires et processus enfants

`child_process` fonctionne. L'image elle-même contient très peu d'exécutables : `node`, `npm`, `sh`, `tar` et les outils clients de PostgreSQL (`pg_dump`, `pg_restore`). Il n'y a pas de `ffmpeg`, pas d'ImageMagick, pas de Python ni de compilateur, et vous ne pouvez pas ajouter de paquets système, car il n'y a pas de Dockerfile et le processus n'est pas root.

Un binaire qu'un paquet npm inclut **dans sa propre archive tarball** s'installe avec le paquet et s'exécute. Il doit être compilé pour `linux`/`x64` avec glibc (Debian), et s'exécute en tant qu'utilisateur non privilégié sans capacités Linux spécifiques. Cela a été vérifié avec `@esbuild/linux-x64` dans l'image de base du runtime. Un binaire qu'un paquet *télécharge* lors de `postinstall` n'arrivera jamais, car les scripts d'installation ne s'exécutent pas ; des paquets comme `ffmpeg-static` fonctionnent de cette manière.

Si une fonctionnalité nécessite un binaire, utilisez une API hébergée pour ce travail, ou basculez le backend sur `runtime: "custom"`, où vous construirez votre propre image.

## Calcul et instances

Chaque projet s'exécute dans ses propres pods. La mémoire et le processeur sont définis par instance, et vous les configurez avec les [paramètres de calcul](/docs/deployment/cloud/#compute-and-what-it-costs) :

```bash
rebase cloud compute                              # what the project reserves now
rebase cloud compute set --cpu 500m --memory 1Gi
```

Un projet qui n'a jamais configuré de réglage s'exécute comme un pod « burstable » : il réserve `100m` de CPU et `384Mi` de mémoire, et peut monter ponctuellement jusqu'à 2 CPU et 2 GiB. Une allocation configurée conserve ce ratio entre requête et limite. Exécutez `rebase cloud compute` pour voir les ressources attribuées à votre projet.

Instances :

- **Une par défaut, toujours active.** `--replicas` permet de fixer entre 1 et 5 instances. Aucun mécanisme ne réduit un backend à zéro instance.
- **L'autoscaling est optionnel.** `--autoscale-max` définit un plafond allant jusqu'à 16, et `--autoscale-cpu-target` (par défaut 70) définit l'utilisation du processeur ciblée par l'autoscaler.
- **Les déploiements sont progressifs.** Une nouvelle instance démarre et devient prête avant que l'ancienne ne s'arrête, de sorte que pendant un court instant, deux versions traitent le trafic.

`--spot` est désactivé par défaut ; les instances spot sont moins chères et peuvent être redémarrées sans préavis.

## Mémoire et état au niveau du module

Une valeur définie au niveau du module, comme `const cache = new Map()` en haut d'un fichier de fonction, réside dans le processus Node. Elle persiste d'une requête à l'autre sur la même instance. Elle est perdue dès que ce processus prend fin :

- à **chaque déploiement**, car chaque déploiement démarre de nouvelles instances ;
- lorsqu'une **variable d'environnement** change et est déployée ;
- lorsqu'une instance est redémarrée, replanifiée ou (avec `--spot`) récupérée.

S'il y a plusieurs instances, chacune possède sa propre copie, de sorte que deux requêtes peuvent accéder à des caches différents.

Utilisez une `Map` au niveau du module comme un cache que vous pouvez vous permettre de perdre : un cache qui accélère la requête suivante mais qui ne constitue l'unique copie d'aucune donnée. Conservez tout ce qui a un coût de génération, comme un fichier audio généré ou une réponse d'API coûteuse, dans la base de données ou dans le [stockage](#stockage-des-fichiers-générés). Pour les clients initialisés une seule fois, comme un SDK d'API, utilisez `lazyResource` pour que le client soit instancié lors de la première utilisation à partir de l'environnement de la requête. Voir [Configuration et secrets](/docs/backend/custom-functions/#configuration-and-secrets).

[Exécuter plusieurs instances](/docs/deployment/multiple-instances/) répertorie l'état que Rebase lui-même conserve par processus, comme les compteurs de limitation de débit et les canaux temps réel.

## Le système de fichiers

Le système de fichiers du conteneur est accessible en écriture, et `/tmp` fonctionne. Mais tout ce qui y est écrit :

- appartient à une seule instance, et les autres instances ne peuvent pas le voir ;
- est supprimé lorsque l'instance s'arrête, c'est-à-dire au plus tard lors du prochain déploiement ;
- partage une limite de stockage éphémère de 6 GiB avec le bundle et ses `node_modules` installés. Une instance qui dépasse cette limite est expulsée.

Utilisez-le pour des fichiers temporaires le temps d'une requête. Ne l'utilisez pas comme un cache persistant entre les déploiements ou pour stocker des fichiers téléversés. C'est également pour cette raison que [`STORAGE_TYPE=local` est désactivé en production](/docs/backend/storage/#environment-variables).

## Requêtes

| Limite | Par défaut | Modifier avec |
|---|---|---|
| Timeout des fonctions | 30 s, puis `504` avec le code `FUNCTION_TIMEOUT` | `REBASE_FUNCTIONS_TIMEOUT_MS` (`0` le désactive) |
| Attente au niveau de l'edge pour votre instance | 10 minutes entre les lectures ou écritures | Fixe |
| Corps de requête, routes `/api/*` sans limite propre | 10 MiB, puis `413 PAYLOAD_TOO_LARGE` | `REBASE_MAX_BODY_SIZE`, en octets |
| Corps de requête au niveau de l'edge | 64 MiB | Fixe |
| Un fichier via `POST /api/storage/upload` | 50 MB | `STORAGE_MAX_FILE_SIZE` |
| Appels anonymes à `/api/functions/*` | 3000 par IP par tranche de 15 minutes | `rateLimit.anonymousFunctions` |

Quelques précisions :

- **Le timeout libère l'appelant, pas le traitement en cours.** Au bout de 30 secondes, l'appelant reçoit une erreur `504`, et `getSignal(c)` est interrompu. Transmettez ce signal à `fetch` et à tout ce qui accepte un signal d'annulation, afin que le traitement s'arrête également. Voir [Timeouts et limites de débit](/docs/backend/custom-functions/#timeouts-and-rate-limits).
- **L'edge attend plus longtemps que le runtime.** L'ingress situé devant vos instances attend jusqu'à 10 minutes ; la limite atteinte par une requête est donc celle du runtime, qui répond en JSON et interrompt le signal. Vous pouvez augmenter `REBASE_FUNCTIONS_TIMEOUT_MS` jusqu'à cette valeur. Pour les tâches qui durent plus longtemps, ou qui doivent survivre à un déploiement (une instance dispose de 15 secondes pour terminer ses requêtes en cours), répondez immédiatement et effectuez le travail dans un [job](/docs/backend/jobs/).
- **Les téléversements supérieurs à 64 MiB** nécessitent le téléversement avec reprise (TUS), qui envoie le fichier par morceaux. `client.storage.putObject()` bascule automatiquement dessus au-delà de 8 MiB.
- **Taille des réponses.** Ni le runtime ni l'edge ne fixent de limite sur la taille des réponses. Une réponse volumineuse reste néanmoins conservée en mémoire si votre gestionnaire la construit d'un seul bloc ; diffusez-la donc en streaming ou servez-la depuis le stockage.

## Variables d'environnement et secrets

Configurez-les avec la CLI ou dans la console. Il n'y a pas de champ prévu pour elles dans `rebase.json`.

```bash
rebase cloud env set TTS_API_URL=https://api.example.com/v1/speech
rebase cloud env set TTS_API_KEY=sk-… --secret   # write-only: never shown again
rebase cloud env list                            # names only, never values
rebase cloud deploy                              # applies the change
```

- **Une modification s'applique au prochain déploiement.** Les instances en cours d'exécution conservent les valeurs avec lesquelles elles ont démarré. `set` et `unset` vous le rappellent (`Pending redeploy`).
- **Limites :** jusqu'à 100 variables par projet, 32 KiB par valeur et 256 KiB au total. Les noms respectent le format `[A-Za-z_][A-Za-z0-9_]*`.
- **Certains noms sont réservés.** La plateforme définit elle-même `DATABASE_URL`, `DATABASE_DIRECT_URL`, `DATABASE_READ_URL`, `JWT_SECRET`, `REBASE_SERVICE_KEY`, `PORT` et `NODE_ENV`, et verrouille la façon dont le processus s'exécute (`REBASE_ROLE`, `TRUSTED_PROXY_HOPS`, …). Toute tentative de définir l'une d'entre elles est refusée, et le message d'erreur les liste toutes.
- **`CORS_ORIGINS` prend par défaut la valeur de vos domaines.** La plateforme le configure avec l'hôte du projet et ses [domaines personnalisés](/docs/deployment/cloud/#the-rest-of-the-surface) vérifiés. Toute valeur de `CORS_ORIGINS` que vous définissez s'ajoute à cette liste, pour un frontend hébergé ailleurs : `rebase cloud env set CORS_ORIGINS=https://app.example.org`.
- **Les variables de stockage sont des valeurs par défaut.** La plateforme renseigne les variables `STORAGE_*` et `S3_*` pour son bucket, et toute valeur que vous définissez prend le dessus.
- **Les noms réservés au build sont refusés.** Les variables `VITE_`, `NEXT_PUBLIC_`, `PUBLIC_` et `REACT_APP_` sont destinées aux frontends lors du build, et le backend ne les reçoit jamais à temps. L'option `--force` permet néanmoins d'en enregistrer une.

Dans une fonction, lisez-les à l'intérieur du gestionnaire, jamais au sommet du fichier :

```typescript
import { defineFunction, requireEnv } from "@rebasepro/server/functions";

export default defineFunction((app) => {
    app.get("/status", async (c) => {
        const endpoint = requireEnv(c, "TTS_API_URL");   // throws a clear error if unset
        return c.json({ configured: Boolean(endpoint) });
    });
});
```

Une lecture de `process.env` au niveau du module qui retourne une valeur vide fait échouer le chargement complet du fichier, et ses routes renvoient une erreur `404`. Voir [Configuration et secrets](/docs/backend/custom-functions/#configuration-and-secrets).

## Stockage des fichiers générés

Un projet Cloud bénéficie d'un stockage de fichiers dès que vous le créez :

```bash
rebase cloud storage create   # a managed bucket and its credentials
rebase cloud deploy           # the running backend gets the credentials at deploy
```

Vous pouvez également faire pointer le projet vers un bucket que vous possédez déjà avec `rebase cloud storage attach` (S3, R2, MinIO, ou tout bucket compatible S3). Sans l'un ou l'autre, les téléversements renvoient `501 STORAGE_NOT_CONFIGURED`. D'autres buckets peuvent être déclarés dans `backend/resources.ts` ; voir [Plusieurs buckets](/docs/backend/storage/#several-buckets).

Un déploiement avec stockage est refusé tant que le projet n'a pas défini qui peut lire et écrire des fichiers. Le fichier `backend/storage.ts` du modèle de départ exporte un hook `storageAuthorize` à cet effet. Voir [Autorisation par objet](/docs/backend/storage-authorization/).

**Comment les fichiers sont servis.** Votre backend sert chaque fichier sur `GET /api/storage/file/<key>`. Il lit l'objet depuis le bucket et le diffuse en streaming, avec `Content-Type`, requêtes de plage (range requests) et en-têtes de mise en cache. Il n'y a pas d'URL directe vers le bucket à communiquer.

- Une clé sous **`public/`** est servie à tout le monde, sans jeton, à une URL qui ne change jamais. Utilisez-la pour les fichiers que tout visiteur peut charger, comme un enregistrement audio généré pour un jeu public.
- Toute autre clé est privée. Un client demande à `/api/storage/metadata/<key>` une URL de téléchargement contenant un jeton, valide pendant 300 secondes par défaut (`STORAGE_DOWNLOAD_TOKEN_TTL`, jusqu'à une semaine).

Depuis une fonction, écrivez avec `rebase.storage` (le bucket par défaut) ou `rebase.bucket(…)` (un bucket nommé). Votre hook `storageAuthorize` décide toujours si l'écriture est autorisée.

Les transformations d'images (`?width=`, `?format=`) nécessitent `sharp`, qui est un module natif et n'est pas présent dans l'image managée. Sur le runtime managé, une requête de transformation renvoie l'image d'origine.

### Exemple : mettre en cache de l'audio généré

Une fonction qui convertit du texte en parole avec une API hébergée, stocke chaque résultat une seule fois, puis le sert depuis le stockage par la suite. La `Map` permet seulement d'économiser une recherche dans le stockage sur une instance chaude ; le bucket constitue le véritable cache, de sorte qu'un déploiement ne fait rien perdre.

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

La route est publique, comme chaque route dans `backend/functions/` tant que vous ne la protégez pas. Une implémentation réelle vérifierait qui est autorisé à générer du nouvel audio, afin qu'un inconnu ne puisse pas consommer votre quota de l'API de synthèse vocale.

## Réseau sortant

Les fonctions peuvent appeler des services externes. Les connexions sortantes depuis vos instances sont autorisées vers n'importe quelle adresse Internet sur ces ports TCP uniquement :

| Port | Usage |
|---|---|
| 80, 443 | HTTP et HTTPS |
| 465, 587 | Envoi d'e-mails via SMTP avec TLS ou STARTTLS |
| 993 | IMAP sur TLS |

Tout le reste est bloqué. Cela inclut le port 25, l'IMAP non chiffré, ainsi que les bases de données ou caches sur leurs propres ports : Redis sur 6379 ou MongoDB sur 27017 en dehors de Rebase Cloud ne peuvent pas être atteints. L'adresse de métadonnées du cloud (`169.254.169.254`) est également bloquée.

La seule exception est votre propre base de données. Si le projet apporte sa propre base de données PostgreSQL (BYODB), chaque déploiement autorise également les connexions vers l'hôte de cette base sur le port spécifié dans sa chaîne de connexion, et à rien d'autre sur ce port. L'hôte est résolu en ses adresses IP lors du déploiement ; si votre fournisseur déplace la base de données vers une autre adresse, redéployez l'application. La base de données doit accepter les connexions depuis Internet : l'application se connecte directement à la chaîne de connexion. Les paramètres de bastion SSH ne sont utilisés que pour le test de connexion, et non par l'application déployée.

La plateforme n'ajoute aucun proxy ni aucune limitation de débit sortant ; les services que vous appelez possèdent les leurs. Transmettez `getSignal(c)` à `fetch` afin qu'un appel s'interrompe si sa requête expire.

Tout le trafic sortant provient d'**une adresse IP fixe unique, `207.175.138.15`**. Ajoutez-la à une liste autorisée (allowlist) tierce lorsqu'un service en exige une. Cette adresse est partagée par tous les projets sur Rebase Cloud ; une liste autorisée prouve donc que l'appelant s'exécute sur Rebase Cloud, mais pas qu'il s'agit de votre projet : continuez donc à vous authentifier auprès du service avec une clé.

## Démarrage et arrêt

- **Démarrage à froid (cold start).** Une nouvelle instance télécharge et décompresse le bundle avant de traiter les requêtes ; un arbre de dépendances volumineux ralentit donc chaque mise à l'échelle. Un bundle téléversé sans ses dépendances doit également les installer, ce qui ajoute 40 à 60 secondes. La plateforme attend jusqu'à 300 secondes qu'une instance soit opérationnelle.
- **Santé (health checks).** La plateforme vérifie `/livez` (le processus fonctionne) et `/health` (il peut joindre la base de données). Ces deux routes sont gérées par le runtime, vous n'avez donc pas à les écrire.
- **Arrêt.** Lors d'un déploiement ou d'un redémarrage, l'instance cesse d'accepter de nouvelles requêtes, attend 5 secondes que le trafic bascule, puis reçoit un signal `SIGTERM`. Les requêtes en cours ont jusqu'à 15 secondes pour se terminer. Les promesses passées à `waitUntil` disposent d'un maximum de 5 secondes sur ce délai. Une promesse non transmise à `waitUntil` est abandonnée. Voir [Travail en arrière-plan](/docs/backend/custom-functions/#background-work).

## Quand le mode managé n'est pas adapté

Basculez le backend sur `"runtime": "custom"` lorsqu'il nécessite :

- un module natif, ou un binaire système qu'aucun paquet npm ne fournit, tel que `sharp`, ImageMagick ou un moteur vocal local ;
- des paquets système ou une image de base différente ;
- une connexion de longue durée vers un service situé en dehors des ports autorisés.

Un runtime personnalisé construit votre propre Dockerfile, et vous gérez l'image à partir de ce moment. `rebase cloud deploy --eject` permet d'effectuer la transition. Voir [Rebase Cloud](/docs/deployment/cloud/#deploy).

## Pas encore garanti

- **Historique des logs.** `rebase cloud logs --runtime` lit les logs des instances en cours d'exécution, et `rebase cloud debug logs --previous` ceux de la dernière exécution d'une instance ayant redémarré. Les sorties d'une instance remplacée par un déploiement sont perdues. Écrivez tout ce que vous devez conserver dans la base de données ou vers votre propre service de logs.
- **La réduction à zéro (scale to zero)** n'est pas proposée. Chaque backend exécute au moins une instance en permanence.

## Pages connexes

- [Rebase Cloud](/docs/deployment/cloud/) : liaison, déploiement, paramètres de calcul et éléments non inclus dans la bêta
- [Fonctions personnalisées](/docs/backend/custom-functions/) : écriture des routes dans `backend/functions/`
- [Runtime et bundles](/docs/architecture/runtime-and-bundles/) : ce qu'est un bundle et comment le runtime le démarre
- [Stockage](/docs/backend/storage/) : buckets, endpoints, limites de taille et règles d'accès
- [Exécuter plusieurs instances](/docs/deployment/multiple-instances/) : l'état que Rebase conserve par processus
