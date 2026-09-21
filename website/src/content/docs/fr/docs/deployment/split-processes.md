---
sourceHash: 4497d118312ff8ce
title: Séparation en plusieurs processus
sidebar_label: Processus séparés
description: Exécutez un seul bundle sous forme de plusieurs processus coopérants — une API, un niveau de fonctions, un worker — à partir de la même image d'exécution publiée, afin qu'une fonction personnalisée lourde ne vienne plus concurrencer l'API de données.
---

## Vue d'ensemble

Un déploiement Rebase est normalement constitué d'un seul processus desservant l'ensemble des fonctionnalités : l'API de données,
l'authentification, le stockage, vos fonctions personnalisées, le cron et la file d'attente de tâches (job queue). C'est la configuration
adaptée à la quasi-totalité des déploiements et elle reste l'option par défaut.

Lorsque cette configuration ne convient plus — une fonction personnalisée qui sature la boucle d'événements (event loop),
un niveau de fonctions qui devrait être mis à l'échelle ou redémarré indépendamment de l'API — vous pouvez
démarrer **la même image et le même bundle** plusieurs fois et faire en sorte que chaque
processus prenne en charge une partie différente du projet. Il n'y a rien de nouveau à compiler ni
aucun changement visible pour le client : les URL ne changent pas.

Une variable d'environnement détermine le rôle d'un processus :

```bash
REBASE_ROLE=api        # data, auth, admin, storage, meta — everything but functions
REBASE_ROLE=functions  # custom functions only
REBASE_ROLE=worker     # no HTTP surface: cron and the job queue
REBASE_ROLE=all        # the default: everything, one process
```

## Ce que chaque rôle prend en charge

| | `all` | `api` | `functions` | `worker` |
| --- | :---: | :---: | :---: | :---: |
| `/api/auth`, `/api/data`, `/api/storage`, `/api/meta` | ✅ | ✅ | — | — |
| `/api/admin`, `/api/logs`, l'éditeur de schéma | ✅ | ✅ | — | — |
| `/api/functions/*` | ✅ | redirige (voir ci-dessous) | ✅ | — |
| `/api/cron` (la surface d'administration) | ✅ | ✅ | — | — |
| `/health`, `/livez`, `/metrics` | ✅ | ✅ | ✅ | ✅ |
| Gère les websockets, consomme les événements de changement | ✅ | ✅ | — | — |
| Crée le schéma au démarrage | ✅ | ✅ | — | — |
| Exécute le planificateur cron | ✅ | ✅ | — | ✅ |
| Exécute les workers de la file d'attente de tâches | ✅ | ✅ | — | ✅ |

Les endpoints de santé (health) et de métriques sont présents sur chaque rôle sans exception. Un processus qu'un
orchestrateur ne peut pas sonder est un processus qu'il ne peut pas mettre à jour de manière progressive (rolling update).

Le temps réel figure sur cette liste car il a un coût, que quelqu'un l'utilise
ou non : un processus qui consomme des événements de changement conserve une connexion `LISTEN` en dehors
du pool tant qu'il est en cours d'exécution, et installe les déclencheurs (triggers) de capture au démarrage. Seul
un processus desservant des websockets a des destinataires à qui livrer des événements, les deux rôles qui n'en
gèrent aucun ne font donc ni l'un ni l'autre. **Les écritures effectuées par ces processus sont toujours détectées** — la
capture repose sur des déclencheurs de base de données, un changement est donc publié par la base de données plutôt
que par le processus qui l'a effectué. Une fonction qui écrit une ligne réveille tout de même
chaque abonné sur l'`api`.

## Docker Compose

Deux services à partir d'une seule image, d'un seul bundle et d'une seule base de données :

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

Les deux processus ont besoin du même `DATABASE_URL`, du même `JWT_SECRET` et de la même
clé `REBASE_SERVICE_KEY` — ils constituent un seul déploiement, et un jeton généré par l'un doit
être accepté par l'autre.

## Conserver des URL identiques

`REBASE_FUNCTIONS_UPSTREAM` indique au processus `api` de transférer `/api/functions/*`
au processus de fonctions plutôt que de le traiter lui-même. Les clients, les SDK générés et les clés
d'API voient exactement la même interface qu'avant la séparation ; aucun code applicatif ne
change donc et vous n'avez pas besoin de mettre en place un reverse proxy pour l'essayer.

Un déploiement en production peut préférer router ce chemin directement au niveau de son ingress, auquel
cas laissez `REBASE_FUNCTIONS_UPSTREAM` non défini — le processus `api` répond
alors 404 pour ces chemins et le proxy placé devant détermine leur destination.

### Sauts de proxy (Proxy hops)

Lorsque l'API transfère une requête, elle ajoute l'adresse de l'appelant à `X-Forwarded-For`. Par
conséquent, le processus de fonctions se trouve derrière **un saut de proxy supplémentaire** par rapport à l'API,
et cela doit lui être indiqué :

```bash
# api behind one ingress            → TRUSTED_PROXY_HOPS=1
# functions behind that ingress AND the api → TRUSTED_PROXY_HOPS=2
```

`TRUSTED_PROXY_HOPS` correspond au nombre de reverse proxies que vous exécutez réellement devant
un processus. Chacun ajoute l'adresse qu'il a vue à `X-Forwarded-For`, le
véritable client correspond donc à la N-ième entrée en partant de la droite ; tout ce qui se trouve plus à gauche a été
fourni par le client et est ignoré, ce qui empêche un appelant d'usurper l'en-tête pour
contourner les clés de limitation de débit (rate limit). La valeur par défaut est `0` — aucun proxy n'est approuvé.

Si vous configurez mal ce paramètre, rien ne casse de manière évidente : les limiteurs de débit sur le processus de fonctions
attribuent chaque requête à l'adresse du conteneur de l'API, tous vos appelants partagent donc
un unique quota, et l'IP enregistrée pour chaque événement d'authentification est toujours la même.

## Un seul processus gère le schéma

Un seul processus dans un déploiement scindé crée les tables et applique les
politiques RLS au démarrage, à savoir le processus `api` (ou `all`). Tout autre processus doit
définir :

```bash
REBASE_MIGRATE_ON_BOOT=none
```

Ceci est **obligatoire** et non indicatif : un processus `functions` ou `worker` laissé avec la
valeur par défaut refusera de démarrer, avec un message explicite. L'instruction `CREATE … IF NOT EXISTS` lit le catalogue
puis y écrit en deux étapes distinctes, de sorte que des processus démarrant simultanément
entrent en collision — et un déploiement où plusieurs d'entre eux entrent en concurrence pour provisionner le même
schéma n'est souhaitable pour personne.

## Desservir une seule fonction par processus

Un processus peut ne desservir qu'un sous-ensemble spécifique, ce qui permet d'attribuer à une fonction
particulièrement lourde son propre nombre de réplicas sans avoir à déplacer son code :

```bash
REBASE_FUNCTIONS_ONLY=send-invoice
REBASE_FUNCTIONS_EXCLUDE=debug-tools
```

Les noms correspondent aux noms de fichiers sans l'extension — le même nom sous lequel la fonction
est montée. Un nom absent du bundle **provoque l'échec du démarrage**, et l'erreur liste
les noms réellement présents. Un processus configuré pour une fonction donnée n'existe que pour cette
fonction ; une faute de frappe qui n'exposerait silencieusement rien serait donc le pire scénario
possible.

## Cron et tâches d'arrière-plan

Ces deux fonctionnalités peuvent déjà être exécutées en toute sécurité sur plusieurs processus : le planificateur cron réserve
chaque paire `(job, slot)` dans la base de données, et la file d'attente de tâches réserve les lignes avec
`FOR UPDATE SKIP LOCKED`. L'`api` continue donc d'exécuter les deux par défaut et une séparation
en deux services est complète sans nécessiter de troisième conteneur.

Ajoutez un processus `worker` lorsque vous souhaitez décharger le chemin des requêtes du travail planifié, et
désactivez-le sur l'API :

```yaml
  api:
    environment:
      REBASE_CRON_SCHEDULER: "false"
      REBASE_JOB_WORKERS: "false"

  worker:
    environment:
      REBASE_ROLE: worker
      REBASE_MIGRATE_ON_BOOT: none
```

Un processus `functions` n'exécute jamais aucun des deux. Il est mis à l'échelle en fonction de la charge des requêtes et
remplacé à volonté ; lui attribuer du travail planifié fausserait la signification
de son nombre de réplicas.

Notez que `rebase.jobs.enqueue` continue de fonctionner partout, y compris sur un processus
qui n'exécute aucun worker — l'enfilement est une écriture, l'exécution est une boucle d'interrogation (poll loop), et seul
ce second aspect est désactivé par un rôle.

## Ce que la séparation ne vous apporte pas

**La limitation de débit partagée, sauf si vous la demandez.** Le stockage par défaut est propre à chaque processus, donc N
processus multiplient le quota de chaque appelant par N sans qu'aucun log ne l'indique.
Définissez `REBASE_RATE_LIMIT_STORE=sql` sur chaque processus qui dessert du HTTP — le décompte
s'effectue dans Postgres, de sorte que la limite s'applique quel que soit le nombre de réplicas.
(Le chart Helm le configure pour vous et refuse de générer une topologie multi-processus
qui le laisserait sur `memory`.)

**Des canaux inter-instances.** La diffusion (broadcast) et la présence utilisent par défaut un bus en mémoire,
qui ne traverse pas les processus. Il s'agit d'une problématique liée au *nombre de réplicas*
plutôt qu'à la séparation — cela s'applique tout autant à un déploiement à rôle unique
porté à trois instances — définissez donc `REALTIME_CHANNEL_BUS=postgres` (ou `realtime.bus` dans
la configuration) dès que plus d'un processus dessert des websockets.

**Le scale to zero (mise à l'échelle vers zéro).** Rien ici ne permet de réduire un processus à zéro ou d'en instancier un
à la demande. C'est une capacité de la plateforme, pas du runtime.

## Déployer une unité de manière autonome

Tout ce qui a été décrit ci-dessus sépare *l'endroit où s'exécute le travail*. L'ensemble est toujours livré sous
la forme d'un build unique : une image, un bundle, mis à jour ensemble. C'est l'approche par défaut appropriée, et
la plupart des déploiements devraient s'y tenir.

Une unité peut également être maintenue sur sa propre version de build — un correctif de fonction qui ne
redémarre pas l'API :

```yaml
# values.yaml
split: true
functions:
  enabled: true
  image:
    tag: "0.22.0"     # this unit only; the rest stay on the release-wide tag
```

Seul le tag vaut généralement la peine d'être fixé : le dépôt est hérité, il s'agit donc
d'un seul projet et d'une seule image avec une unité déplacée. `bundleUrl` remplit le même rôle
lorsque `bundle.mode: url`.

### La règle

Deux unités sur des builds différents correspondent à deux ensembles de collections interagissant avec **une seule**
base de données, et une seule unité se charge de la provisionner. Par conséquent :

> **L'unité qui détient le schéma est mise à jour en premier. Une unité peut avoir un train de retard ; elle ne doit jamais
> avoir un temps d'avance.**

Il s'agit du Job de migration, ou de l'`api` lorsque le Job est désactivé. Une unité fonctionnant
*en avance* par rapport au schéma interrogera des colonnes qui n'existent pas encore et s'appuiera sur des politiques RLS
que personne n'a appliquées — le premier cas provoque une erreur SQL sur une route, le second renvoie un
résultat vide avec un code 200. Une unité fonctionnant *en retard* correspond à l'état normal de tout
déploiement progressif en cours.

### Ce qui le contrôle

Le processus assurant le provisionnement enregistre la version du schéma qu'il a appliquée dans la
base de données. Chaque autre processus calcule la sienne à partir des collections qu'il a chargées et
les compare. En cas de divergence, il le signale en indiquant les deux :

```
⚠️ [schema] The database was last provisioned from a different set of collections
   than this process was built from (database v1:6f2a…, this process v1:91cd…).
```

Il émet un avertissement et continue de servir les requêtes, car pendant un déploiement cette divergence est *normale* —
les unités qui n'ont pas encore été mises à jour sont censées être en retard. Définissez
`REBASE_REQUIRE_SCHEMA_MATCH=true` (ou `sharedState.requireSchemaMatch` dans le
chart) pour refuser le démarrage, sur un déploiement qui préfère ne rien
servir du tout plutôt que de servir des données erronées.

Les deux côtés de cette comparaison sont **calculés**, jamais lus depuis un manifeste. Une
version qu'un build déclare sur lui-même n'est pas une preuve que la base de données concorde
avec lui.

Rien ne contrôle le *sens* — une version de schéma est un hash, elle peut donc indiquer que les
deux divergent mais jamais lequel est en avance. C'est pourquoi l'ordre de déploiement est une
règle que vous devez respecter plutôt qu'une contrainte imposée par le runtime.

## Mise à niveau

Ce point est inchangé : chaque processus exécute la même image publiée, une mise à niveau correspond donc au même
changement de tag sur chacun d'eux. Déployez l'`api` en dernier si vous souhaitez que le
provisionnement du schéma s'effectue d'abord avec la nouvelle version — bien qu'en pratique
l'ordre n'ait pas d'importance, car l'étape de mise à jour du schéma est cumulative et idempotente.

## Liens associés

- [Guide de déploiement](/docs/getting-started/deployment/) — le déploiement sur processus unique que cette approche scinde
- [Environnement & Configuration](/docs/getting-started/configuration/) — `REBASE_ROLE`, `REBASE_CRON_SCHEDULER` et `REBASE_MIGRATE_ON_BOOT`
- [Kubernetes](/docs/deployment/kubernetes/) — un déploiement par rôle
