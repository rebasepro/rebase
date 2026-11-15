---
sourceHash: d156ac95aebe2dab
title: Exécuter plusieurs instances
sidebar_label: Plusieurs instances
description: Chaque élément d'état qu'un processus Rebase conserve pour lui-même et le paramètre qui le partage — ce qu'il faut configurer avant qu'un second réplica, un déploiement progressif ou un déploiement fractionné ne reçoive du trafic.
---

## Vue d'ensemble

La majeure partie d'un déploiement Rebase réside déjà dans la base de données : lignes, utilisateurs et sessions, clés d'API, file d'attente des tâches, réservations cron, clés d'idempotence, historique des enregistrements, jetons du serveur OAuth MCP. Un second processus pointant vers la même base de données a accès à l'ensemble de ces éléments.

Quelques éléments font exception. Chacun d'eux est propre à chaque processus par défaut, car un processus unique constitue le déploiement par défaut et le partage a un coût — une table, une écriture dans un bucket, une connexion à la base de données. Exécuter deux processus derrière un équilibreur de charge, dépasser une instance avec l'autoscaling, ou effectuer un déploiement progressif qui fait tourner temporairement l'ancienne et la nouvelle version côte à côte vous amènent tous sur cette page. Il en va de même pour un [déploiement fractionné](/docs/deployment/split-processes/), qui implique par définition plusieurs processus.

Passez en revue la liste ci-dessous avant que le second ne reçoive du trafic. Aucun élément n'échoue de manière évidente : chaque problème se manifeste par une limite appliquée trois fois de suite, un événement que certains clients ne voient jamais, ou une page affichant des logs différents à chaque actualisation.

## La liste de contrôle

| Quoi | Par processus par défaut | Ce qui le partage |
| --- | --- | --- |
| Secrets de signature | Générés par processus en développement | `JWT_SECRET` et `REBASE_SERVICE_KEY`, définis explicitement et **identiques** partout |
| Compteurs de limitation de débit | En mémoire | `REBASE_RATE_LIMIT_STORE=sql` |
| Adresse client derrière un proxy | `TRUSTED_PROXY_HOPS=0` | Le nombre de proxys en amont, identique partout |
| Abonnements aux tables | Partagés via la base de données lorsque le CDC est activé | `REALTIME_CDC=auto` (valeur par défaut) |
| Canaux de diffusion et présence | En mémoire | `REALTIME_CHANNEL_BUS=postgres` |
| Fichiers téléversés, `STORAGE_TYPE=local` | Le propre disque de l'instance | S3 ou GCS, ou un volume partagé sur le parent de `STORAGE_PATH` |
| Téléversements reprenables (TUS) en cours | Le disque de l'instance, sous `STORAGE_PATH/.tus-uploads` | Un volume partagé sur `STORAGE_PATH`, ou des sessions persistantes |
| Transformations d'images | Un cache dans le processus | `STORAGE_RENDITION_CACHE=true` |
| Explorateur de journaux (Logs Explorer) | Un tampon circulaire des 10 000 dernières lignes | Rien — envoyez stdout vers un agrégateur de logs |
| Minuteurs cron | Chaque processus qui exécute le planificateur | Réservés dans la base de données : une exécution par créneau. `REBASE_CRON_SCHEDULER` choisit où résident les minuteurs |
| Audit RLS planifié | Chaque processus qui en a la charge | `REBASE_RLS_AUDIT=false` sur tous sauf un |
| Le `index.html` d'une application statique | Lu une fois par processus | Redémarrer chaque instance lorsque le build change |
| `/metrics` | Chaque processus compte les siennes | Scraper chaque instance |

Les sections ci-dessous expliquent le comportement de chaque élément lorsqu'il reste configuré par processus.

## Secrets de signature

`JWT_SECRET` signe chaque session et `REBASE_SERVICE_KEY` authentifie les appels de serveur à serveur. En développement, chaque processus génère les siens lorsqu'ils ne sont pas définis ; ainsi, un jeton émis par un processus est refusé par le suivant. En production, le démarrage est déjà refusé sans `JWT_SECRET` (sans `REBASE_SERVICE_KEY`, l'application démarre sans aucune clé de service) ; ce qui compte avec plusieurs processus, c'est que chacun reçoive les **mêmes** valeurs — à partir d'un secret unique, et non d'un par réplica.

## Limites de débit et adresse client

Les limiteurs de débit — le quota par appelant sur les API de données, de stockage et de fonctions, ainsi que les limiteurs d'authentification pour la connexion, la réinitialisation de mot de passe, les codes à usage unique et les tentatives MFA — comptent en mémoire par défaut. Un processus ne peut pas savoir combien de pairs il possède ; ainsi, trois réplicas avec la configuration par défaut appliquent trois fois chaque limite. Définissez `REBASE_RATE_LIMIT_STORE=sql` et les compteurs résideront alors dans la base de données.

Derrière un équilibreur de charge, le limiteur a également besoin de la véritable adresse client, qui est transmise dans `X-Forwarded-For`. `TRUSTED_PROXY_HOPS` indique combien de proxys ignorer ; avec la valeur par défaut `0`, chaque requête semble provenir de l'équilibreur de charge et tous les clients partagent le même quota. Voir [Configuration](/docs/getting-started/configuration/#runtime-behaviour).

## Realtime

Les **abonnements aux tables** fonctionnent entre les instances lorsque la capture des modifications au niveau de la base de données est activée, ce qui est le cas par défaut (`REALTIME_CDC=auto`) : le journal de réécriture / WAL (lorsque la base de données autorise le décodage logique) ou un déclencheur annonce chaque écriture validée, et l'écouteur de chaque instance récupère les données pour ses propres abonnés. Les instances utilisant la capture WAL laissent les déclencheurs en place tant qu'une instance les écoute encore, de sorte qu'un réplica ayant basculé sur les déclencheurs ne soit jamais laissé sans notifications. Si le CDC est désactivé, ou si `auto` n'a pas pu le provisionner (le journal de démarrage l'indique), un abonnement ne verra que les écritures effectuées via l'instance à laquelle son socket est connecté. Voir [Realtime](/docs/backend/realtime-cdc/).

Les **canaux de diffusion et la présence** sont gérés en mémoire dans le processus sauf si un bus les transporte : deux clients connectés à des instances différentes dans le même canal ne s'entendront pas, et chaque instance répondra à la question « qui est là ? » avec sa propre moitié des utilisateurs. Définissez `REALTIME_CHANNEL_BUS=postgres`. Le bus écoute la base de données, ce qui nécessite une connexion directe plutôt qu'un pooler de transactions — définissez `DATABASE_DIRECT_URL` lorsque `DATABASE_URL` passe par pgBouncer. Voir [Channels and presence across instances](/docs/backend/realtime-transports/#channels-and-presence-across-instances).

## Fichiers

Avec `STORAGE_TYPE=local`, les téléversements sont des fichiers stockés sur le disque de l'instance qui les a reçus, et une autre instance renverra une erreur 404 pour ceux-ci. Utilisez S3 ou GCS, ou montez un volume unique sur chaque instance, sur le répertoire parent de `STORAGE_PATH` afin qu'il contienne également le répertoire `<STORAGE_PATH>__<key>` de chaque bucket local nommé. Voir [Self-hosting: file storage](/docs/deployment/self-hosting/#file-storage).

Les **téléversements reprenables** (le point de terminaison TUS) conservent le fichier partiel de chaque téléversement, ainsi qu'un enregistrement du téléversement à côté, sur le disque de l'instance qui l'a créé, sous `STORAGE_PATH/.tus-uploads` — même lorsque les fichiers terminés sont dirigés vers S3 ou GCS. Montez un volume partagé sur `STORAGE_PATH` sur chaque instance et n'importe quelle instance pourra gérer n'importe quel téléversement ; un redémarrage ou un déploiement progressif reprendra alors un téléversement là où il s'est arrêté. Sans volume partagé, un fragment qui arrive sur une autre instance recevra une réponse 404 : acheminez les requêtes de téléversement d'un client vers une seule instance (sessions persistantes sur l'équilibreur de charge). Le SDK et le panneau d'administration, qui utilisent ce point de terminaison pour les fichiers de plus de 8 Mio, envoient ensuite le fichier via `POST /upload` à la place, et continuent de le faire pour le reste de la session. Les téléversements ordinaires via `POST /upload` ne comportent qu'une seule requête et ne sont pas affectés.

Les **transformations d'images** (`?width=400&format=webp`) sont mises en cache en mémoire ; chaque instance calcule donc chaque variante une fois, et une nouvelle instance démarre à froid. Définissez `STORAGE_RENDITION_CACHE=true` pour réécrire chaque rendu dans le bucket d'origine, où chaque instance pourra le trouver. Cela fait en sorte qu'un `GET` écrive dans votre bucket, c'est pourquoi cette option est désactivée par défaut. Voir [Storage](/docs/backend/storage/).

## Logs Explorer

L'explorateur de journaux de Studio lit un tampon circulaire des 10 000 dernières lignes de log conservées par le processus qui traite la requête. Derrière un équilibreur de charge, chaque actualisation peut afficher les lignes d'une instance différente, et aucune d'entre elles ne montre l'ensemble du déploiement. L'explorateur indique le nom de l'instance qu'il affiche. Aucun paramètre ne permet de partager ce tampon circulaire : le runtime écrit une ligne JSON par événement sur stdout en production, et c'est ce qu'il convient de collecter — via le service de logs de votre plateforme, Loki ou tout outil lisant la sortie des conteneurs.

## Cron et la file d'attente des tâches

Chaque processus qui exécute le planificateur cron arme ses propres minuteurs, et l'exécution est d'abord réservée dans la base de données ; un créneau ne s'exécute donc qu'**une seule fois**, quel que soit le nombre de processus qui se déclenchent pour lui. La mise en pause d'une tâche et le verrou qui empêche un déclenchement manuel sur une tâche en cours d'exécution sont partagés de la même manière. Aucun paramètre n'est à configurer, tant que la base de données est Postgres. `REBASE_CRON_SCHEDULER` et `REBASE_JOB_WORKERS` déterminent quels processus exécutent les minuteurs et les workers — voir [Split processes](/docs/deployment/split-processes/).

L'audit RLS planifié fait exception : il n'est pas réservé, donc chaque processus qui en est responsable effectue une analyse selon son propre minuteur. C'est redondant plutôt que dangereux ; définissez `REBASE_RLS_AUDIT=false` partout sauf sur une instance.

## Applications statiques

Un processus qui sert le frontend ou le CMS (`REBASE_SERVE_STATIC`, activé par défaut) lit le fichier `index.html` de chaque application une fois et le conserve en mémoire. Remplacer le build sur un volume partagé n'affecte pas un processus en cours d'exécution : il continue de servir l'ancien document, qui fait référence à des fragments pouvant ne plus exister. Déployez un nouveau build en redémarrant ou en renouvelant progressivement chaque instance — ce qu'une nouvelle image ou un nouveau bundle fait de toute façon. Avec un CDN en amont et `REBASE_SERVE_STATIC=false`, cela ne s'applique pas.

## Métriques

Le point de terminaison `/metrics` rapporte les informations du processus qui y répond. Scrapez chaque instance — via un job de découverte de services Prometheus par pod, et non une cible unique derrière l'équilibreur de charge — et effectuez la somme dans votre requête.

## Provisionnement au démarrage

Chaque instance exécute la passe additive de schéma au démarrage (`REBASE_MIGRATE_ON_BOOT=ensure`). Les instances ayant le même rôle peuvent l'exécuter en même temps : elle est conçue pour tolérer qu'un pair crée la même table un instant auparavant. Dans un déploiement fractionné, exactement un rôle assure le provisionnement et tous les autres définissent `none` — voir [Split processes](/docs/deployment/split-processes/).
