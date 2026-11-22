---
sourceHash: 3f40bdbdc8b0c722
title: Runtime backend managé
sidebar_label: Runtime managé
description: Ce qu'un backend avec le runtime "managed" peut et ne peut pas faire sur Rebase Cloud — paquets et binaires, mémoire et CPU, timeouts et tailles de corps, système de fichiers, état en mémoire, secrets, stockage des fichiers générés et réseau sortant.
---

Une application backend déclarée comme suit dans `rebase.json` s'exécute sur le **runtime managé** :

```json title="rebase.json"
{
    "apps": {
        "backend": { "type": "backend", "runtime": "managed" }
    }
}
```

Managé signifie que vous livrez un bundle, pas une image. `rebase cloud deploy` compile vos tables, `backend/functions/` et crons dans `dist-bundle`, le téléverse, et Rebase Cloud le démarre sur l'image publiée `rebasepro/server`. Vous n'écrivez jamais de Dockerfile, et vous ne pouvez pas non plus modifier le contenu de l'image. Cette page liste ce que cela permet, afin que vous puissiez planifier une fonctionnalité avant de la développer.

Les chiffres présentés ici proviennent du runtime et de la plateforme tels qu'ils sont aujourd'hui. Certains sont des réglages modifiables, et la page précise lesquels. Les quelques éléments qui ne sont pas encore garantis sont regroupés [à la fin](#pas-encore-garanti).

## En un coup d'œil

| Question | Réponse |
|---|---|
| Version de Node | Node 22, sur Debian slim, `linux`/`x64` |
| Paquets npm | Oui, depuis le registre public ou un registre privé. Installés dans le bundle lors du déploiement |
| Modules natifs (`.node`, node-gyp) | Non. `rebase cloud deploy` refuse le bundle |
| WebAssembly | Oui |
| Lancer un processus enfant | Oui, pour un binaire `linux`/`x64` fourni par un paquet npm. Voir [Binaires](#binaires-et-processus-enfants) |
| Mémoire et CPU | Définis par projet avec `rebase cloud compute`. Voir [Calcul](#calcul-et-instances) |
| Instances | 1 par défaut, toujours active. Vous pouvez en fixer jusqu'à 5, ou laisser l'autoscaler monter jusqu'à 16 |
| Timeout de fonction | 30 secondes, puis `504 FUNCTION_TIMEOUT`. Configurable jusqu'à 10 minutes |
| Corps de la requête | 10 Mio, puis `413`. Configurable, jusqu'aux 64 Mio acceptés par l'edge |
| Système de fichiers accessible en écriture | Oui, mais il est temporaire et propre à une seule instance |
| État au niveau du module (un cache `Map`) | Persiste d'une requête à l'autre sur une même instance. Perdu à chaque déploiement et redémarrage, et non partagé entre les instances |
| Variables d'environnement et secrets | `rebase cloud env set`, appliqués au prochain déploiement |
| Stockage de fichiers | Un bucket par projet, servi par votre backend sur `/api/storage/file/…` |
| HTTP sortant | Oui, sur les ports 80 et 443 (et 465, 587, 993 pour le courrier électronique). Les autres ports sont bloqués. Une adresse IP sortante fixe : `207.175.138.15` |

## Code et paquets

**Node et l'image.** L'image du runtime est basée sur `node:22-slim` (Debian), et votre bundle s'exécute sur `linux`/`x64` en tant qu'utilisateur non root. Votre `tsconfig` et la version de Node sur votre machine ne changent rien à cela.

**Dépendances.** `rebase cloud deploy` installe dans le bundle les dépendances déclarées par vos fichiers `package.json`, pour `linux`/`x64`, et les téléverse avec lui, de sorte qu'une nouvelle instance n'ait rien à installer. Un bundle qui dépasserait la limite de téléversement de 1 Go avec celles-ci est téléversé sans elles, et le déploiement le signale : chaque instance les installe alors lors de son démarrage, avec `npm ci` (ou `npm install` sans fichier lockfile). Quatre conséquences découlent de leur mode d'installation :

- **Les scripts d'installation ne s'exécutent jamais.** L'installation utilise `--ignore-scripts`. Un paquet qui télécharge un binaire ou compile quelque chose lors du `postinstall` s'installe sans celui-ci.
- **Seules les versions issues d'un registre s'installent.** Une dépendance `file:`, `link:`, `git+…` ou `github:` fait échouer le build, car le runtime ne dispose d'aucun élément par rapport auquel la résoudre.
- **Certains paquets proviennent de l'image, pas de vous.** `@rebasepro/server`, `@rebasepro/types`, `@rebasepro/client`, `@rebasepro/common`, `@rebasepro/utils`, `hono`, `@hono/node-server` et `zod` sont supprimés des dépendances du bundle et les propres copies de l'image sont liées, de sorte que votre version de ces paquets ne s'applique pas. D'autres paquets `@rebasepro/*`, tels que le pilote de base de données, s'installent depuis votre `package.json` comme n'importe quelle dépendance. `typescript` et `tsx` sont également retirés ; ce sont des outils de build.
- **Les paquets privés nécessitent un `.npmrc`.** `rebase build` copie le fichier `.npmrc` du projet (et `backend/.npmrc`) dans le bundle, afin que l'installation utilise les mêmes paramètres de registre que votre machine. Chaque identifiant qu'il contient doit être une référence à une variable d'environnement, jamais le jeton lui-même ; un jeton en clair fait échouer le build, car le bundle est téléversé avec votre code :

  ```ini title=".npmrc"
  @acme:registry=https://npm.pkg.github.com
  //npm.pkg.github.com/:_authToken=${NPM_TOKEN}
  ```

  ```bash
  rebase cloud env set NPM_TOKEN=ghp_… --secret
  ```

Le téléversement du bundle est limité à 1 Go, compressé.

**Les modules natifs sont refusés.** Un paquet qui intègre un binaire compilé `.node` ne peut pas se charger sur le runtime managé. `rebase build` émet un avertissement à ce sujet, et `rebase cloud deploy` s'arrête avant le téléversement :

```text no-verify
This bundle depends on native modules (sharp), which the managed runtime cannot run
```

La vérification recherche les paquets natifs bien connus (`sharp`, `canvas`, `bcrypt`, `argon2`, `sqlite3`, `better-sqlite3`, `re2`, `sodium-native`, `pg-native`, …), la présence de `binding.gyp` ou `gypfile`, des scripts d'installation appelant `node-gyp` ou `prebuild`, ainsi que des fichiers `.node`. Le [guide de déploiement](/docs/getting-started/deployment/#native-modules-on-the-managed-runtime) répertorie les solutions de contournement habituelles. En résumé : effectuez le travail au moment du build, faites appel à un service externe, ou déployez avec `runtime: "custom"`.

**WebAssembly fonctionne.** Un paquet qui fournit un fichier `.wasm` et le charge depuis JavaScript n'est pas un module natif, et Node 22 l'exécute. Testé dans l'image de base du runtime avec les paramètres de sécurité du pod, à l'aide d'`esbuild-wasm`. Gardez à l'esprit la [limite de mémoire](#calcul-et-instances) si le module est volumineux, comme un modèle vocal ou de ML.

### Binaires et processus enfants

`child_process` fonctionne. L'image elle-même n'a que très peu d'exécutables : `node`, `npm`, `sh`, `tar`, et les outils clients PostgreSQL (`pg_dump`, `pg_restore`). Il n'y a pas de `ffmpeg`, pas d'ImageMagick, pas de Python et pas de compilateur, et vous ne pouvez pas ajouter de paquets système, car il n'y a pas de Dockerfile et le processus n'est pas root.

Un binaire qu'un paquet npm transporte **à l'intérieur de sa propre archive tarball** s'installe avec le paquet et s'exécute. Il doit être compilé pour `linux`/`x64` avec glibc (Debian), et il s'exécute en tant qu'utilisateur non privilégié sans capacités Linux (capabilities). Testé avec `@esbuild/linux-x64` dans l'image de base du runtime. Un binaire qu'un paquet *télécharge* dans `postinstall` n'arrive jamais, car les scripts d'installation ne s'exécutent pas ; des paquets comme `ffmpeg-static` fonctionnent ainsi.

Si une fonctionnalité nécessite un binaire, utilisez une API hébergée pour cette tâche, ou passez le backend à `runtime: "custom"`, où vous construisez votre propre image.

## Calcul et instances

Chaque projet s'exécute dans ses propres pods. La mémoire et le CPU sont définis par instance, et vous les configurez avec les [réglages de calcul](/docs/deployment/cloud/#compute-and-what-it-costs) :

```bash
rebase cloud compute                              # what the project reserves now
rebase cloud compute set --cpu 500m --memory 1Gi
```

Un projet qui n'a jamais configuré de réglage s'exécute en tant que pod « burstable » : il réserve `100m` de CPU et `384Mi` de mémoire, et peut monter temporairement jusqu'à 2 CPU et 2 Gio. Une requête ajustée conserve ce ratio entre requête et limite. Exécutez `rebase cloud compute` pour voir ce dont dispose votre projet.

Instances :

- **Une par défaut, toujours active.** `--replicas` fixe une valeur entre 1 et 5. Rien ne réduit un backend à zéro instance.
- **L'autoscaling est optionnel.** `--autoscale-max` définit un plafond allant jusqu'à 16, et `--autoscale-cpu-target` (70 par défaut) l'utilisation du CPU visée par l'autoscaler.
- **Les déploiements sont progressifs (rolling).** Une nouvelle instance démarre et devient prête avant que l'ancienne ne s'arrête, de sorte que pendant un court instant, deux versions traitent le trafic.

`--spot` est désactivé par défaut ; les instances spot sont moins chères et redémarrées sans préavis.

## Mémoire et état au niveau du module

Une valeur définie au niveau du module, comme `const cache = new Map()` en haut d'un fichier de fonction, réside dans le processus Node. Elle persiste d'une requête à l'autre sur la même instance. Elle est perdue dès que ce processus se termine :

- à **chaque déploiement**, car chaque déploiement démarre de nouvelles instances ;
- lorsqu'une **variable d'environnement** est modifiée et déployée ;
- lorsqu'une instance est redémarrée, replanifiée ou (avec `--spot`) récupérée.

Avec plus d'une instance, chacune possède sa propre copie, de sorte que deux requêtes peuvent voir des caches différents.

Utilisez une `Map` au niveau du module comme un cache que vous pouvez vous permettre de perdre : un cache qui accélère la requête suivante mais qui ne constitue l'unique copie de rien. Conservez tout ce dont la production est coûteuse, comme un fichier audio généré ou une réponse d'API onéreuse, dans la base de données ou dans le [stockage](#stockage-pour-les-fichiers-générés). Pour les clients que vous initialisez une seule fois, comme un SDK d'API, utilisez `lazyResource` afin que le client soit construit lors de sa première utilisation à partir de l'environnement de la requête. Voir [Configuration et secrets](/docs/backend/custom-functions/#configuration-and-secrets).

[Exécuter plusieurs instances](/docs/deployment/multiple-instances/) répertorie l'état que Rebase conserve lui-même par processus, comme les compteurs de limitation de débit (rate-limit) et les canaux temps réel.

## Le système de fichiers

Le système de fichiers du conteneur est accessible en écriture, et `/tmp` fonctionne. Mais tout ce qui y est écrit :

- appartient à une seule instance, et les autres instances ne le voient pas ;
- est supprimé lorsque l'instance s'arrête, donc au plus tard lors du prochain déploiement ;
- partage une limite de stockage éphémère de 6 Gio avec le bundle et ses `node_modules` installés. Une instance qui dépasse cette limite est évincée.

Utilisez-le pour des fichiers temporaires le temps d'une requête. Ne l'utilisez pas comme cache d'un déploiement à l'autre ni comme stockage pour les téléversements. C'est également pourquoi [`STORAGE_TYPE=local` est désactivé en production](/docs/backend/storage/#environment-variables).

## Requêtes

| Limite | Par défaut | Modifier avec |
|---|---|---|
| Timeout de fonction | 30 s, puis `504` avec le code `FUNCTION_TIMEOUT` | `REBASE_FUNCTIONS_TIMEOUT_MS` (`0` le désactive), ou via `defineFunction(…, { timeoutMs })` propre à une fonction |
| Timeout propre à une fonction, au maximum | 300 s | `REBASE_FUNCTIONS_MAX_TIMEOUT_MS` |
| Attente de votre instance, au niveau de l'edge | 10 minutes entre les lectures ou les écritures | Fixe |
| Corps de la requête, routes `/api/*` sans limite propre | 10 Mio, puis `413 PAYLOAD_TOO_LARGE` | `REBASE_MAX_BODY_SIZE`, en octets |
| Corps de la requête à l'edge | 64 Mio | Fixe |
| Un fichier via `POST /api/storage/upload` | 50 Mo | `STORAGE_MAX_FILE_SIZE` |
| Appels anonymes vers `/api/functions/*` | 3000 par IP par tranche de 15 minutes | `rateLimit.anonymousFunctions` |

Quelques détails :

- **Le timeout libère l'appelant, pas le travail en cours.** À 30 secondes, l'appelant reçoit une erreur `504`, et `getSignal(c)` est interrompu (aborted). Transmettez ce signal à `fetch` et à tout ce qui en accepte un, afin que le travail s'arrête également. Voir [Timeouts et limites de débit](/docs/backend/custom-functions/#timeouts-and-rate-limits).
- **L'edge attend plus longtemps que le runtime.** L'ingress devant vos instances attend jusqu'à 10 minutes ; la limite atteinte par une requête est donc celle du runtime, qui répond en JSON et interrompt le signal. Augmentez `REBASE_FUNCTIONS_TIMEOUT_MS` jusqu'à cette valeur, ou attribuez à la fonction qui en a besoin son propre [`timeoutMs`](/docs/backend/custom-functions/#timeouts-and-rate-limits). Pour les tâches plus longues, ou qui doivent survivre à un déploiement (une instance dispose de 15 secondes de vidage/drain), répondez immédiatement et effectuez le travail dans un [job](/docs/backend/jobs/).
- **Les téléversements supérieurs à 64 Mio** nécessitent le téléversement avec reprise (TUS), qui envoie le fichier par morceaux (chunks). `client.storage.putObject()` bascule automatiquement dessus au-delà de 8 Mio.
- **Taille de la réponse.** Ni le runtime ni l'edge ne fixent de limite sur la taille des réponses. Une réponse volumineuse reste néanmoins conservée en mémoire si votre gestionnaire la construit d'un seul bloc ; diffusez-la donc en streaming ou servez-la depuis le stockage.

## Variables d'environnement et secrets

Définissez-les avec la CLI ou dans la console. Il n'y a pas de champ prévu pour elles dans `rebase.json`.

```bash
rebase cloud env set TTS_API_URL=https://api.example.com/v1/speech
rebase cloud env set TTS_API_KEY=sk-… --secret   # write-only: never shown again
rebase cloud env list                            # names only, never values
rebase cloud deploy                              # applies the change
```

- **Une modification s'applique au prochain déploiement.** Les instances en cours d'exécution conservent les valeurs avec lesquelles elles ont démarré. `set` et `unset` vous le rappellent (`Pending redeploy`).
- **Limites :** jusqu'à 100 variables par projet, 32 Kio par valeur et 256 Kio au total. Les noms respectent le format `[A-Za-z_][A-Za-z0-9_]*`.
- **Certains noms sont réservés.** La plateforme définit elle-même `DATABASE_URL`, `DATABASE_DIRECT_URL`, `DATABASE_READ_URL`, `JWT_SECRET`, `REBASE_SERVICE_KEY`, `PORT` et `NODE_ENV`, et verrouille la façon dont le processus s'exécute (`REBASE_ROLE`, `TRUSTED_PROXY_HOPS`, …). Toute tentative de définition de l'une d'entre elles est refusée, et l'erreur les liste toutes.
- **`CORS_ORIGINS` commence à partir de vos domaines.** La plateforme lui attribue l'hôte du projet et ses [domaines personnalisés](/docs/deployment/cloud/#the-rest-of-the-surface) vérifiés. Toute valeur `CORS_ORIGINS` que vous définissez s'ajoute à cette liste, pour un frontend hébergé ailleurs : `rebase cloud env set CORS_ORIGINS=https://app.example.org`.
- **Les variables de stockage sont des valeurs par défaut.** La plateforme renseigne les variables `STORAGE_*` et `S3_*` pour son bucket, et toute valeur que vous définissez est prioritaire.
- **Les noms liés au build sont refusés.** Les variables `VITE_`, `NEXT_PUBLIC_`, `PUBLIC_` et `REACT_APP_` sont destinées aux frontends au moment du build, et le backend n'y a jamais accès à temps. L'option `--force` permet néanmoins d'en enregistrer une.

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

Une lecture de `process.env` au niveau du module qui renvoie une valeur vide empêche le chargement de l'ensemble du fichier, et ses routes répondent par un `404`. Voir [Configuration et secrets](/docs/backend/custom-functions/#configuration-and-secrets).

## Stockage pour les fichiers générés

Un projet Cloud bénéficie d'un stockage de fichiers dès que vous le créez :

```bash
rebase cloud storage create   # a managed bucket and its credentials
rebase cloud deploy           # the running backend gets the credentials at deploy
```

Ou associez le projet à un bucket que vous possédez déjà avec `rebase cloud storage attach` (S3, R2, MinIO ou tout autre bucket compatible S3). Sans l'un ni l'autre, les téléversements renvoient `501 STORAGE_NOT_CONFIGURED`. D'autres buckets sont déclarés dans `backend/resources.ts` ; voir [Plusieurs buckets](/docs/backend/storage/#several-buckets).

Un déploiement avec du stockage est refusé tant que le projet n'a pas défini qui peut lire et écrire des fichiers. Le fichier `backend/storage.ts` du scaffold exporte un hook `storageAuthorize` à cet effet. Voir [Autorisation par objet](/docs/backend/storage-authorization/).

**Comment les fichiers sont servis.** Votre backend sert chaque fichier sur `GET /api/storage/file/<key>`. Il lit l'objet depuis le bucket et le diffuse en streaming, avec `Content-Type`, requêtes de plage (range requests) et en-têtes de mise en cache. Il n'y a pas d'URL directe du bucket à distribuer.

- Une clé située sous **`public/`** est servie à tout le monde, sans jeton, à une URL qui ne change jamais. Utilisez-la pour les fichiers que n'importe quel visiteur peut charger, comme un enregistrement audio généré pour un jeu public.
- Toute autre clé est privée. Un client sollicite `/api/storage/metadata/<key>` pour obtenir une URL de téléchargement contenant un jeton, valide par défaut pendant 300 secondes (`STORAGE_DOWNLOAD_TOKEN_TTL`, jusqu'à une semaine).

Depuis une fonction, écrivez avec `rebase.storage` (le bucket par défaut) ou `rebase.bucket(…)` (un bucket nommé). Votre hook `storageAuthorize` détermine toujours si l'écriture est autorisée.

Les transformations d'images (`?width=`, `?format=`) nécessitent `sharp`, qui est un module natif et n'est pas présent dans l'image managée. Sur le runtime managé, une requête de transformation renvoie l'image d'origine.

### Exemple : mise en cache de l'audio généré

Une fonction qui convertit du texte en parole à l'aide d'une API hébergée, stocke chaque résultat une seule fois et le sert ensuite depuis le stockage. La `Map` permet seulement d'économiser une recherche dans le stockage sur une instance chaude (warm) ; le bucket constitue le véritable cache, si bien qu'un déploiement ne perd rien.

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

La route est publique, comme chaque route dans `backend/functions/` tant que vous ne la protégez pas. Une implémentation réelle vérifierait qui est autorisé à créer un nouvel enregistrement audio, afin qu'un inconnu ne puisse pas consommer votre quota de l'API vocale.

## Réseau sortant

Les fonctions peuvent appeler des services externes. Les connexions sortantes depuis vos instances sont autorisées vers n'importe quelle adresse Internet sur ces ports TCP uniquement :

| Port | Usage |
|---|---|
| 80, 443 | HTTP et HTTPS |
| 465, 587 | Envoi d'e-mails via SMTP avec TLS ou STARTTLS |
| 993 | IMAP sur TLS |

Tout le reste est bloqué. Cela inclut le port 25, l'IMAP non chiffré, ainsi que les bases de données ou caches sur leurs propres ports : Redis sur le 6379 ou MongoDB sur le 27017 en dehors de Rebase Cloud sont inaccessibles. L'adresse de métadonnées du cloud (`169.254.169.254`) est également bloquée.

La seule exception est votre propre base de données. Si le projet apporte son propre PostgreSQL (BYODB), chaque déploiement autorise également les connexions vers l'hôte de cette base de données sur le port spécifié dans sa chaîne de connexion, et vers rien d'autre sur ce port. L'hôte est résolu en adresses IP lors du déploiement ; si votre fournisseur déplace la base de données vers une autre adresse, redéployez. La base de données doit accepter les connexions depuis Internet : l'application se connecte directement à la chaîne de connexion. Les paramètres de bastion SSH ne sont utilisés que par le test de connexion, pas par l'application déployée.

La plateforme n'ajoute aucun proxy ni aucune limite de débit sortant ; les services que vous appelez ont leurs propres limites. Passez `getSignal(c)` à `fetch` pour qu'un appel s'arrête lorsque sa requête expire.

Tout le trafic sortant provient d'**une adresse IP fixe unique, `207.175.138.15`**. Ajoutez-la à la liste blanche (allowlist) tierce lorsqu'un service en requiert une. L'adresse est partagée par tous les projets sur Rebase Cloud ; une liste blanche prouve donc que l'appelant s'exécute sur Rebase Cloud, et non qu'il s'agit de votre projet : continuez à vous authentifier auprès du service avec une clé également.

## Démarrage et arrêt

- **Démarrage à froid (Cold start).** Une nouvelle instance télécharge et décompresse le bundle avant de servir les requêtes, si bien qu'un arbre de dépendances volumineux ralentit chaque mise à l'échelle. Un bundle téléversé sans ses dépendances les installe également, ce qui ajoute 40 à 60 secondes. La plateforme attend jusqu'à 300 secondes qu'une instance soit opérationnelle.
- **Santé (Health).** La plateforme vérifie `/livez` (le processus fonctionne) et `/health` (il peut joindre la base de données). Ces deux routes sont servies par le runtime, vous n'avez donc pas à les écrire.
- **Arrêt.** Lors d'un déploiement ou d'un redémarrage, l'instance cesse d'accepter de nouvelles requêtes, attend 5 secondes que le trafic bascule, puis reçoit un `SIGTERM`. Les requêtes en cours ont jusqu'à 15 secondes pour se terminer. Les promesses passées à `waitUntil` disposent de 5 secondes au maximum sur ce délai. Une promesse que vous n'avez pas transmise à `waitUntil` est abandonnée. Voir [Travail en arrière-plan](/docs/backend/custom-functions/#background-work).

## Quand le mode managé n'est pas adapté

Passez le backend à `"runtime": "custom"` lorsqu'il a besoin de :

- un module natif, ou un binaire système qu'aucun paquet npm ne fournit, tel que `sharp`, ImageMagick ou un moteur vocal local ;
- paquets système ou une image de base différente ;
- une connexion persistante à un service en dehors des ports autorisés.

Un runtime personnalisé construit votre propre Dockerfile, et vous devenez propriétaire de l'image dès lors. `rebase cloud deploy --eject` permet d'effectuer la transition. Voir [Rebase Cloud](/docs/deployment/cloud/#deploy).

## Pas encore garanti

- **Historique des journaux.** `rebase cloud logs --runtime` lit les journaux des instances en cours d'exécution, et `rebase cloud debug logs --previous` ceux de la dernière exécution d'une instance ayant redémarré. Les sorties d'une instance remplacée par un déploiement sont perdues. Écrivez tout ce que vous devez conserver dans la base de données ou vers votre propre service de journalisation.
- **La mise à l'échelle à zéro (scale to zero)** n'est pas proposée. Chaque backend exécute au moins une instance en permanence.

## Pages connexes

- [Rebase Cloud](/docs/deployment/cloud/) : liaison, déploiement, réglages de calcul et ce que la bêta n'inclut pas
- [Fonctions personnalisées](/docs/backend/custom-functions/) : écriture des routes dans `backend/functions/`
- [Runtime et bundles](/docs/architecture/runtime-and-bundles/) : qu'est-ce qu'un bundle et comment le runtime le démarre
- [Stockage](/docs/backend/storage/) : buckets, endpoints, limites de taille et règles d'accès
- [Exécuter plusieurs instances](/docs/deployment/multiple-instances/) : l'état que Rebase conserve par processus
