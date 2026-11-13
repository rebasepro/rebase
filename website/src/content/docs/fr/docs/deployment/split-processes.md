---
sourceHash: f1296ae912e0725e
title: Découpage en plusieurs processus
sidebar_label: Processus séparés
description: Exécutez un bundle sous la forme de plusieurs processus coopérants — une API, un niveau de fonctions, un worker — à partir de la même image d'exécution publiée, afin qu'une fonction personnalisée lourde ne concurrence plus l'API de données.
---

## Vue d'ensemble

Un déploiement Rebase est normalement constitué d'un seul processus servant l'ensemble : l'API de données, l'authentification, le stockage, vos fonctions personnalisées, le cron et la file de tâches (job queue). C'est la configuration adaptée à presque tous les déploiements et elle reste celle par défaut.

Lorsque cette configuration ne convient plus — une fonction personnalisée qui bloque la boucle d'événements (event loop), un niveau de fonctions qui devrait être mis à l'échelle ou redémarré indépendamment de l'API — vous pouvez démarrer **la même image et le même bundle** plusieurs fois et faire en sorte que chaque processus serve une partie distincte du projet. Il n'y a rien de nouveau à compiler et rien que le client doive savoir : les URL ne changent pas.

Une seule variable d'environnement détermine le rôle d'un processus :

```bash
REBASE_ROLE=api        # data, auth, admin, storage, meta — everything but functions
REBASE_ROLE=functions  # custom functions only
REBASE_ROLE=worker     # no HTTP surface: cron and the job queue
REBASE_ROLE=all        # the default: everything, one process
```

## Ce que sert chaque rôle

| | `all` | `api` | `functions` | `worker` |
| --- | :---: | :---: | :---: | :---: |
| `/api/auth`, `/api/data`, `/api/storage`, `/api/meta` | ✅ | ✅ | — | — |
| `/api/admin` (dont les journaux et l'éditeur de schéma) | ✅ | ✅ | — | — |
| `/api/functions/*` | ✅ | redirige (voir ci-dessous) | ✅ | — |
| `/api/admin/cron` (la surface d'administration) | ✅ | ✅ | — | — |
| `/health`, `/livez`, `/metrics` | ✅ | ✅ | ✅ | ✅ |
| Sert les websockets, consomme les événements de changement | ✅ | ✅ | — | — |
| Crée le schéma au démarrage | ✅ | ✅ | — | — |
| Exécute le planificateur cron | ✅ | ✅ | — | ✅ |
| Exécute les workers de file de tâches | ✅ | ✅ | — | ✅ |

La santé (health) et les métriques sont présentes sur chaque rôle sans exception ; `/metrics` ne répond qu'avec `REBASE_METRICS=true`. Un processus qu'un orchestrateur ne peut pas sonder est un processus qu'il ne peut pas mettre à jour progressivement (roll).

`GET /api/auth/config`, que lit l'écran de connexion, suit le reste de `/api/auth` : seuls `api` et `all` le servent.

Le temps réel (Realtime) est sur la liste car il a un coût, que quelqu'un l'utilise ou non : un processus qui consomme des événements de changement maintient une connexion `LISTEN` hors du pool tant qu'il s'exécute, et installe les déclencheurs (triggers) de capture au démarrage. Seul un processus servant des websockets a des destinataires à qui livrer, les deux rôles qui n'en servent aucun ne font donc ni l'un ni l'autre. **Les écritures effectuées par ces processus restent perçues.** Lorsque la capture de modifications est activée, la capture s'effectue via des déclencheurs de base de données, de sorte qu'une modification est publiée par la base de données plutôt que par le processus qui l'a réalisée. Lorsque la capture est désactivée (`REALTIME_CDC=off`, ou basculement automatique de `auto` parce que le rôle de base de données ne peut pas créer de déclencheurs), un processus `worker` ou `functions` annonce plutôt chacune de ses propres écritures sur le canal inter-instances, sans maintenir de connexion `LISTEN`. Dans les deux cas, une fonction qui écrit une ligne réveille toujours chaque abonné sur l'`api`.

Attribuez le même `REALTIME_CDC` à chaque processus. Un processus propriétaire du schéma avec `REALTIME_CDC=off` supprime les déclencheurs de capture au démarrage, et une `api` toujours configurée sur `auto` écouterait alors des modifications que personne n'annonce.

## Docker Compose

Deux services à partir d'une image, un bundle et une base de données :

```yaml
services:
  api:
    image: rebasepro/server:latest
    environment:
      REBASE_ROLE: api
      REBASE_FUNCTIONS_UPSTREAM: http://functions:8080
      DATABASE_URL: postgres://rebase:${POSTGRES_PASSWORD}@db:5432/rebase
      JWT_SECRET: ${JWT_SECRET}
      REBASE_SERVICE_KEY: ${REBASE_SERVICE_KEY}
      CORS_ORIGINS: ${CORS_ORIGINS}
    volumes:
      - ./dist-bundle:/bundle
    ports:
      - "8080:8080"

  functions:
    image: rebasepro/server:latest
    environment:
      REBASE_ROLE: functions
      REBASE_MIGRATE_ON_BOOT: none
      TRUSTED_PROXY_HOPS: 1
      DATABASE_URL: postgres://rebase:${POSTGRES_PASSWORD}@db:5432/rebase
      JWT_SECRET: ${JWT_SECRET}
      REBASE_SERVICE_KEY: ${REBASE_SERVICE_KEY}
      CORS_ORIGINS: ${CORS_ORIGINS}
    volumes:
      - ./dist-bundle:/bundle
```

```bash
docker compose up --scale functions=3
```

Les deux processus ont besoin de la même `DATABASE_URL`, du même `JWT_SECRET` et de la même `REBASE_SERVICE_KEY` — ils constituent un seul déploiement, et un jeton généré par l'un doit être accepté par l'autre. Un processus avec `REBASE_FUNCTIONS_UPSTREAM` et sans `REBASE_SERVICE_KEY` refuse de démarrer : ses propres appels à `rebase.functions.invoke(...)`, provenant d'un hook ou d'une tâche cron, atteignent le processus de fonctions avec cette clé.

## Conserver les mêmes URL

`REBASE_FUNCTIONS_UPSTREAM` indique au processus `api` de transférer `/api/functions/*` vers le processus de fonctions plutôt que de le servir lui-même. Il doit s'agir d'une URL en `http://` ou `https://` ; toute autre valeur empêche le démarrage. Seuls `api` et `worker` la lisent (voir [Cron et tâches en arrière-plan](#cron-et-tâches-en-arrière-plan) pour le worker). Les clients, les SDK générés et les clés d'API voient exactement la même surface qu'avant la séparation ; aucun code applicatif ne change donc et vous n'avez pas besoin de mettre en place un reverse proxy pour l'essayer.

Un déploiement en production peut préférer router le chemin au niveau de son ingress ; dans ce cas, laissez `REBASE_FUNCTIONS_UPSTREAM` non défini — le processus `api` répond alors 404 pour ces chemins et le proxy situé en amont décide de leur destination.

### Sauts de proxy

Lorsque l'API transfère une requête, elle ajoute l'adresse de l'appelant à `X-Forwarded-For`. Cela place le processus de fonctions derrière **un saut de proxy supplémentaire** par rapport à l'API, et il doit en être informé :

```bash
# api behind one ingress            → TRUSTED_PROXY_HOPS=1
# functions behind that ingress AND the api → TRUSTED_PROXY_HOPS=2
```

`TRUSTED_PROXY_HOPS` correspond au nombre de reverse proxies que vous exécutez réellement devant un processus. Chacun ajoute l'adresse qu'il a vue à `X-Forwarded-For`, de sorte que le vrai client est la Nième entrée en partant de la droite ; tout ce qui se trouve plus à gauche est fourni par le client et ignoré, ce qui empêche un appelant d'usurper l'en-tête pour contourner les clés de limitation de débit (rate limiting). La valeur par défaut est `0` — aucun proxy de confiance.

Si vous vous trompez ici, rien ne semblera cassé visuellement : les limiteurs de débit sur le processus de fonctions associeront chaque requête à l'adresse du conteneur d'API, de sorte que tous vos appelants partageront le même quota (bucket), et l'IP enregistrée pour chaque événement d'authentification sera identique.

## Un seul processus possède le schéma

Exactement un seul processus dans un déploiement scindé crée les tables et applique les politiques RLS au démarrage, à savoir `api` (ou `all`). Tous les autres processus doivent définir :

```bash
REBASE_MIGRATE_ON_BOOT=none
```

C'est **obligatoire**, et non optionnel : un processus `functions` ou `worker` laissé avec la valeur par défaut refusera de démarrer, et l'indiquera explicitement. `CREATE … IF NOT EXISTS` lit le catalogue puis y écrit en deux étapes distinctes, de sorte que des processus démarrant ensemble entrent en conflit — et un déploiement où plusieurs d'entre eux entrent en concurrence pour provisionner le même schéma n'a jamais été prévu pour fonctionner ainsi.

Dans un [serveur personnalisé](/docs/backend/custom-server/), cette même décision correspond à l'option `provision` de `createRebaseBackend` : `true` pour le processus propriétaire du schéma, et `{ collections: false, realtime: false }` pour tous les autres, ce qui conserve tout de même les tables propres au framework. `REBASE_MIGRATE_ON_BOOT=none` y désactive également le schéma de tables. Les tâches d'arrière-plan sont déterminées de la même manière : un processus qui n'appelle jamais `start()` n'exécute aucun planificateur cron ni aucun worker de tâches, et un processus qui l'appelle exécute ceux que son option `ownership` lui attribue.

## Servir une fonction par processus

Un processus peut servir un sous-ensemble nommé, ce qui permet à une fonction gourmande d'avoir son propre nombre de réplicas sans que son code ne soit déplacé :

```bash
REBASE_FUNCTIONS_ONLY=send-invoice
REBASE_FUNCTIONS_EXCLUDE=debug-tools
```

Les noms correspondent aux noms de fichiers sans l'extension — le même nom sous lequel la fonction est montée. Un nom que le bundle ne contient pas **provoque l'échec du démarrage**, et l'erreur liste les noms qu'il contient. Un processus configuré pour une seule fonction existe pour cette fonction ; une faute de frappe qui ne servirait silencieusement rien serait donc le pire scénario possible.

## Cron et tâches en arrière-plan

Tous deux peuvent déjà s'exécuter en toute sécurité sur plusieurs processus : le planificateur cron réserve chaque paire `(job, slot)` dans la base de données, et la file de tâches réserve les lignes avec `FOR UPDATE SKIP LOCKED`. Ainsi, `api` continue d'exécuter les deux par défaut et une séparation en deux services est complète sans nécessiter de troisième conteneur.

Ajoutez un processus `worker` lorsque vous souhaitez retirer le travail planifié du chemin des requêtes, et désactivez-le sur l'API :

```yaml
  api:
    environment:
      REBASE_CRON_SCHEDULER: "false"
      REBASE_JOB_WORKERS: "false"

  worker:
    environment:
      REBASE_ROLE: worker
      REBASE_MIGRATE_ON_BOOT: none
      REBASE_SERVICE_KEY: ${REBASE_SERVICE_KEY}
      # Only if a job calls rebase.functions:
      REBASE_FUNCTIONS_UPSTREAM: http://functions:8080
```

Une tâche déplacée vers un worker conserve `rebase.dataAsAdmin`, `rebase.sql`, `rebase.storage` et `rebase.email`, qui communiquent directement avec la base de données, les buckets et le serveur de messagerie. Elle conserve également :

- **`rebase.admin`** (utilisateurs, rôles, réinitialisations de mot de passe) **et `rebase.cron`.** Un worker ne dessert aucune surface d'administration sur son port, mais intègre ces deux éléments dans son propre processus, pour ses propres tâches uniquement.
- **`rebase.functions`, avec `REBASE_FUNCTIONS_UPSTREAM`.** Un worker ne sert aucune fonction. Lorsque l'upstream est configuré, ses propres appels à `rebase.functions.invoke(...)` sont transférés vers le processus de fonctions, où la fonction perçoit l'appel comme émanant du service. Le worker ne répond toujours à rien sous `/api/functions` sur son port. Le worker a besoin de la `REBASE_SERVICE_KEY` du déploiement pour cela, tout comme l'`api`.

Il perd `rebase.auth` : il s'agit des flux de connexion des utilisateurs, et un worker n'en traite aucun. Pour les opérations liées aux comptes depuis une tâche, utilisez `rebase.admin`. Il perd également le reste de l'API d'administration (sauvegardes, journaux, éditeur de schéma, etc.), ainsi que `rebase.functions` lorsqu'aucun upstream n'est défini. Un appel à l'un de ces éléments renvoie `404 NOT_FOUND` en indiquant la surface désactivée et la démarche alternative à suivre.

Un processus `functions` n'exécute jamais l'un ou l'autre non plus. Il est mis à l'échelle en fonction de la charge de requêtes et remplacé à volonté ; lui confier des tâches planifiées donnerait à son nombre de réplicas une signification inappropriée.

Notez que la mise en file d'attente — `jobQueue.enqueue`, le `enqueue` d'une file déclarée, le `publish` d'un sujet — continue de fonctionner partout, y compris sur un processus qui n'exécute aucun worker : l'enfilage est une écriture, l'exécution est une boucle d'interrogation (poll loop), et seul le second aspect est désactivé par un rôle.

## Ce que le découpage n'apporte pas

**Des limites de débit partagées, sauf si vous le demandez.** Le stockage par défaut se fait par processus, de sorte que N processus multiplient le quota de chaque appelant par N, sans qu'aucun journal ne le signale. Définissez `REBASE_RATE_LIMIT_STORE=sql` sur chaque processus qui dessert du trafic HTTP — le décompte se fait dans Postgres, la limite reste donc la même quel que soit le nombre de réplicas. (Le chart Helm le configure pour vous et refuse de générer une topologie multi-processus qui le laisserait sur `memory`.)

**Canaux inter-instances.** La diffusion (broadcast) et la présence utilisent par défaut un bus en mémoire, qui ne traverse pas les processus. Il s'agit d'une question de *nombre de réplicas* plutôt que de découpage — cela vaut également pour un déploiement à rôle unique mis à l'échelle sur trois instances — définissez donc `REALTIME_CHANNEL_BUS=postgres` (ou `realtime.bus` dans la configuration) dès que plus d'un processus dessert des websockets.

**Mise à l'échelle à zéro (Scale to zero).** Rien ici ne réduit un processus à zéro ni n'en démarre un à la demande. C'est une fonctionnalité de la plateforme, pas du moteur d'exécution (runtime).

Tout ce qu'un processus garde par ailleurs pour lui-même est répertorié dans une liste : [Exécuter plusieurs instances](/docs/deployment/multiple-instances/).

## Déployer une unité de manière indépendante

Tout ce qui précède répartit *l'endroit où le travail s'exécute*. L'ensemble est toujours livré sous la forme d'un build unique : une image, un bundle, mis à jour ensemble. C'est le comportement par défaut recommandé, et la plupart des déploiements devraient s'y tenir.

Une unité peut également être maintenue sur un build qui lui est propre — par exemple un correctif de fonction qui ne redémarre pas l'API :

```yaml
# values.yaml
split: true
functions:
  enabled: true
  image:
    tag: "0.30.1"     # this unit only; the rest stay on the release-wide tag
```

Seul le tag vaut généralement la peine d'être figé : le dépôt est hérité, il s'agit donc d'un seul projet et d'une seule image avec une seule unité modifiée. `bundleUrl` remplit la même fonction lorsque `bundle.mode: url`.

### La règle

Deux unités sur des builds différents représentent deux ensembles de tables pour **une seule** base de données, et une seule unité la provisionne. Ainsi :

> **L'unité propriétaire du schéma est mise à jour en premier. Une unité peut être en retard ; elle ne doit jamais être en avance.**

Il s'agit du Job de migration, ou de l'`api` lorsque le Job est désactivé. Une unité s'exécutant *en avance* par rapport au schéma interroge des colonnes qui n'existent pas encore et s'appuie sur des politiques RLS que personne n'a appliquées — le premier cas provoque une erreur SQL sur une route, le second un résultat vide accompagné d'un code 200. Une unité s'exécutant *en retard* correspond à l'état normal de tout déploiement progressif en cours.

### Ce qui le vérifie

Le processus qui assure le provisionnement enregistre dans la base de données la version de schéma qu'il a appliquée. Chaque autre processus calcule la sienne à partir des tables qu'il a chargées et les compare. En cas de divergence, il le signale en nommant les deux :

```
⚠️ [schema] The database was last provisioned from a different set of collections
   than this process was built from (database v2:6f2a…, this process v2:91cd…).
```

Il émet un avertissement et continue de servir le trafic, car lors d'un déploiement cette divergence est *normale* — les unités qui n'ont pas encore été mises à jour sont censées être en retard. Définissez `REBASE_REQUIRE_SCHEMA_MATCH=true` (ou `sharedState.requireSchemaMatch` dans le chart) pour refuser le démarrage, sur un déploiement qui préfère ne rien servir du tout plutôt que de servir des données erronées.

Les deux côtés de cette comparaison sont **calculés**, jamais lus depuis un manifeste. La version qu'un build déclare pour lui-même ne prouve pas que la base de données concorde avec lui.

Rien ne vérifie la *direction* — une version de schéma est un hash, elle peut donc indiquer que les deux diffèrent, mais jamais lequel est en avance. C'est pourquoi l'ordre de déploiement est une règle que vous devez respecter plutôt qu'une règle que le runtime peut appliquer de force.

## Mise à niveau

Inchangé : chaque processus exécute la même image publiée, une mise à niveau consiste donc à changer le même tag sur chacun d'entre eux. Mettez d'abord à jour le processus qui possède le schéma — l'`api`, ou le Job de migration — afin que le schéma de la nouvelle version soit en place avant que les autres processus ne s'exécutent avec celui-ci : une unité peut être en retard, jamais en avance (voir [La règle](#la-règle)).

## Voir aussi

- [Guide de déploiement](/docs/getting-started/deployment/) — le déploiement mono-processus que ceci découpe
- [Environnement et configuration](/docs/getting-started/configuration/) — `REBASE_ROLE`, `REBASE_CRON_SCHEDULER` et `REBASE_MIGRATE_ON_BOOT`
- [Kubernetes](/docs/deployment/kubernetes/) — un déploiement par rôle
