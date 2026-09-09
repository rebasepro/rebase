---
sourceHash: ce7486bb141920aa
title: Fractionnement en plusieurs processus
sidebar_label: Processus séparés
description: Exécutez un bundle sous la forme de plusieurs processus coopératifs — une API, une couche de fonctions, un worker — à partir de la même image d'exécution publiée, afin qu'une fonction personnalisée lourde ne concurrence plus l'API de données.
---

## Vue d'ensemble

Un déploiement Rebase est normalement constitué d'un seul processus servant l'ensemble des composants : l'API de données, l'authentification, le stockage, vos fonctions personnalisées, cron et la file d'attente de tâches. C'est la configuration idéale pour presque tous les déploiements, et elle reste celle par défaut.

Lorsqu'elle ne convient plus — une fonction personnalisée qui sature la boucle d'événements, un niveau de fonctions qui devrait évoluer ou redémarrer indépendamment de l'API — vous pouvez démarrer **la même image et le même bundle** plusieurs fois et faire en sorte que chaque processus prenne en charge une partie différente du projet. Il n'y a rien de nouveau à construire et rien que le client doive savoir : les URL ne changent pas.

Une variable d'environnement détermine la nature d'un processus :

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
| Sert les websockets, consomme les événements de changement | ✅ | ✅ | — | — |
| Crée le schéma au démarrage | ✅ | ✅ | — | — |
| Exécute le planificateur cron | ✅ | ✅ | — | ✅ |
| Exécute les workers de la file de tâches | ✅ | ✅ | — | ✅ |

L'état de santé et les métriques sont présents sur chaque rôle sans exception. Un processus qu'un orchestrateur ne peut pas sonder est un processus qu'il ne peut pas mettre à jour sans interruption.

Le temps réel figure sur la liste car il a un coût, que quelqu'un l'utilise ou non : un processus qui consomme des événements de changement maintient une connexion `LISTEN` hors du pool tant qu'il fonctionne, et installe les déclencheurs de capture au démarrage. Seul un processus servant des websockets a des destinataires à qui livrer, donc les deux rôles qui n'en servent aucun ne font ni l'un ni l'autre. **Les écritures effectuées par ces processus sont toujours captées** — la capture s'effectue via des déclencheurs de base de données, ainsi une modification est publiée par la base de données plutôt que par le processus qui l'a effectuée. Une fonction qui écrit une ligne réveille tout de même chaque abonné sur l'`api`.

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

Les deux processus ont besoin des mêmes `DATABASE_URL`, `JWT_SECRET` et `REBASE_SERVICE_KEY` — ils forment un seul déploiement, et un jeton généré par l'un doit être accepté par l'autre.

## Conserver les mêmes URL

`REBASE_FUNCTIONS_UPSTREAM` indique au processus `api` de transférer `/api/functions/*` vers le processus functions au lieu de le servir lui-même. Les clients, les SDK générés et les clés API voient exactement la même surface qu'avant la séparation ; aucun code applicatif ne change donc et vous n'avez pas besoin de mettre en place un reverse proxy pour essayer cette configuration.

Un déploiement en production peut préférer router le chemin au niveau de son ingress ; dans ce cas, laissez `REBASE_FUNCTIONS_UPSTREAM` non défini — le processus `api` répondra alors 404 pour ces chemins et le proxy situé en amont décidera de leur destination.

### Sauts de proxy

Lorsque l'API transfère une requête, elle ajoute l'adresse de l'appelant à `X-Forwarded-For`. Cela place le processus functions derrière **un saut de proxy supplémentaire** par rapport à l'API, et il doit en être informé :

```bash
# api behind one ingress            → TRUSTED_PROXY_HOPS=1
# functions behind that ingress AND the api → TRUSTED_PROXY_HOPS=2
```

`TRUSTED_PROXY_HOPS` est le nombre de reverse proxies que vous exécutez réellement devant un processus. Chacun ajoute l'adresse qu'il a vue à `X-Forwarded-For`, de sorte que le véritable client correspond à la N-ième entrée depuis la droite ; tout ce qui se trouve plus à gauche est fourni par le client et ignoré, ce qui empêche un appelant d'usurper l'en-tête pour contourner les clés de limitation de débit. La valeur par défaut est `0` — aucun proxy n'est approuvé.

Si cette configuration est incorrecte, rien ne plantera visiblement : les limiteurs de débit sur le processus functions associeront chaque requête à l'adresse du conteneur API, faisant en sorte que tous vos appelants partagent le même quota, et l'IP enregistrée pour chaque événement d'authentification sera la même.

## Un seul processus possède le schéma

Dans un déploiement fractionné, exactement un seul processus crée les tables et applique les politiques RLS au démarrage : c'est le processus `api` (ou `all`). Tous les autres processus doivent définir :

```bash
REBASE_MIGRATE_ON_BOOT=none
```

C'est **obligatoire** et non optionnel : un processus `functions` ou `worker` laissé avec la valeur par défaut refusera de démarrer et l'indiquera explicitement. `CREATE … IF NOT EXISTS` lit le catalogue puis y écrit en deux étapes distinctes, de sorte que les processus démarrant en même temps entrent en collision — et un déploiement où plusieurs d'entre eux entrent en concurrence pour provisionner le même schéma n'est pas une situation souhaitable.

## Servir une seule fonction par processus

Un processus peut servir un sous-ensemble nommé, ce qui permet à une fonction coûteuse en ressources d'avoir son propre nombre de réplicas sans que son code ne soit déplacé :

```bash
REBASE_FUNCTIONS_ONLY=send-invoice
REBASE_FUNCTIONS_EXCLUDE=debug-tools
```

Les noms correspondent aux noms de fichiers sans l'extension — le même nom sous lequel la fonction est montée. Un nom que le bundle ne contient pas **fait échouer le démarrage**, et l'erreur liste les noms qu'il contient. Un processus configuré pour une seule fonction existe pour cette fonction ; une faute de frappe qui ne servirait silencieusement rien serait donc le pire résultat possible.

## Cron et tâches en arrière-plan

Les deux peuvent déjà être exécutés en toute sécurité sur plusieurs processus : le planificateur cron réserve chaque paire `(job, slot)` dans la base de données, et la file de tâches réserve les lignes avec `FOR UPDATE SKIP LOCKED`. Ainsi, `api` continue d'exécuter les deux par défaut et une séparation en deux services est complète sans nécessiter un troisième conteneur.

Ajoutez un processus `worker` lorsque vous souhaitez isoler le travail planifié du flux de requêtes HTTP, et désactivez-le sur l'API :

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

Un processus `functions` n'exécute jamais l'un ou l'autre. Il s'adapte à la charge des requêtes et est remplacé à volonté ; lui confier des tâches planifiées fausserait la signification de son nombre de réplicas.

Notez que `rebase.jobs.enqueue` continue de fonctionner partout, y compris sur un processus qui n'exécute aucun worker — la mise en file d'attente est une écriture, l'exécution est une boucle de scrutation, et seul ce second aspect est désactivé par un rôle.

## Ce que le fractionnement ne vous apporte pas

**Des limites de débit partagées, sauf si vous le demandez.** Le stockage par défaut est par processus, de sorte que N processus multiplient le quota de chaque appelant par N sans qu'aucun journal ne l'indique. Définissez `REBASE_RATE_LIMIT_STORE=sql` sur chaque processus qui sert du HTTP — le décompte se fait dans Postgres, la limite reste donc la même quel que soit le nombre de réplicas. (Le chart Helm le configure pour vous et refuse de générer une topologie multi-processus qui le laisserait sur `memory`.)

**Des canaux multi-instances.** La diffusion et la présence utilisent par défaut un bus en mémoire, qui ne traverse pas les processus. C'est une question de *nombre de réplicas* plutôt que de fractionnement — c'est tout aussi vrai pour un déploiement à rôle unique mis à l'échelle sur trois instances — définissez donc `REALTIME_CHANNEL_BUS=postgres` (ou `realtime.bus` dans la configuration) dès que plusieurs processus gèrent des websockets.

**Le passage à zéro (Scale to zero).** Rien ici ne réduit un processus à zéro instance ou n'en démarre un à la demande. Il s'agit d'une capacité de la plateforme, pas du moteur d'exécution.

## Déployer une unité de manière indépendante

Tout ce qui précède sépare *l'endroit où le travail s'exécute*. L'ensemble est toujours distribué sous la forme d'un build unique : une image, un bundle, mis à jour ensemble. C'est le comportement par défaut approprié, et la plupart des déploiements devraient s'y tenir.

Une unité peut également être maintenue sur son propre build — une correction de fonction qui ne redémarre pas l'API :

```yaml
# values.yaml
split: true
functions:
  enabled: true
  image:
    tag: "0.19.1"     # this unit only; the rest stay on the release-wide tag
```

Seul le tag vaut généralement la peine d'être figé : le dépôt est hérité, il s'agit donc d'un seul projet et d'une seule image dont une seule unité a été modifiée. `bundleUrl` remplit la même fonction lorsque `bundle.mode: url`.

### La règle

Deux unités sur des builds différents sont deux ensembles de collections sur **une seule** base de données, et une seule unité la provisionne. Ainsi :

> **L'unité qui possède le schéma est mise à jour en premier. Une unité peut avoir du retard ; elle ne doit jamais avoir d'avance.**

Il s'agit du Job de migration, ou de l'`api` lorsque le Job est désactivé. Une unité fonctionnant *en avance* par rapport au schéma interroge des colonnes qui n'existent pas encore et s'appuie sur des politiques RLS que personne n'a appliquées — le premier cas entraîne une erreur SQL sur une route, le second renvoie un résultat vide avec un code 200. Une unité fonctionnant *en retard* correspond à l'état normal de tout déploiement progressif en cours.

### Ce qui le vérifie

Le processus qui provisionne enregistre dans la base de données la version de schéma qu'il a appliquée. Tous les autres processus calculent la leur à partir des collections qu'ils ont chargées et la comparent. En cas de divergence, il le signale en mentionnant les deux versions :

```
⚠️ [schema] The database was last provisioned from a different set of collections
   than this process was built from (database v1:6f2a…, this process v1:91cd…).
```

Il émet un avertissement et continue de servir, car lors d'un déploiement cette divergence est *normale* — les unités qui n'ont pas encore été mises à jour sont censées être en retard. Définissez `REBASE_REQUIRE_SCHEMA_MATCH=true` (ou `sharedState.requireSchemaMatch` dans le chart) pour refuser plutôt le démarrage, sur un déploiement qui préfère ne rien servir du tout plutôt que de servir des données incorrectes.

Les deux côtés de cette comparaison sont **calculés**, jamais lus depuis un manifeste. La version qu'un build déclare pour lui-même n'est pas une preuve que la base de données est en accord avec celle-ci.

Rien ne vérifie la *direction* — une version de schéma est un hachage, elle peut donc indiquer un désaccord, mais jamais qui est en avance. C'est pourquoi l'ordre de déploiement est une règle que vous devez suivre plutôt qu'une contrainte imposée par le runtime.

## Mise à niveau

Inchangé : chaque processus exécute la même image publiée, une mise à niveau correspond donc au même changement de tag sur chacun d'entre eux. Mettez à jour l'`api` en dernier si vous souhaitez que le provisionnement du schéma s'effectue d'abord avec la nouvelle version — bien qu'en pratique l'ordre importe peu, car l'étape de schéma est additive et idempotente.

## Voir aussi

- [Guide de déploiement](/docs/getting-started/deployment/) — le déploiement sur un seul processus que cette approche fractionne
- [Environnement et configuration](/docs/getting-started/configuration/) — `REBASE_ROLE`, `REBASE_CRON_SCHEDULER` et `REBASE_MIGRATE_ON_BOOT`
- [Kubernetes](/docs/deployment/kubernetes/) — un déploiement par rôle

---
