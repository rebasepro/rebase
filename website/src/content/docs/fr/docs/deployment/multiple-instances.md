---
sourceHash: d2e9fbce6bf304f5
title: Exécuter plusieurs instances
sidebar_label: Plusieurs instances
description: Chaque élément d'état qu'un processus Rebase conserve pour lui-même, et le paramètre qui le partage — ce qu'il faut configurer avant qu'un second réplica, un déploiement progressif ou un déploiement partitionné ne reçoive du trafic.
---

## Vue d'ensemble

La majeure partie d'un déploiement Rebase réside déjà dans la base de données : lignes, utilisateurs et sessions, clés d'API, file d'attente de tâches, réservations de cron, clés d'idempotence, historique des enregistrements, jetons du serveur OAuth MCP. Un second processus pointant vers la même base de données a accès à l'ensemble de ces éléments.

Quelques éléments font exception. Chacun est propre à chaque processus par défaut, car un processus unique constitue le déploiement par défaut et le partage a un coût — une table, une écriture dans un bucket, une connexion à la base de données. Exécuter deux processus derrière un équilibreur de charge, dépasser une instance via l'autoscaling, ou effectuer un déploiement progressif (rolling deploy) exécutant brièvement l'ancienne et la nouvelle version côte à côte vous amènent tous sur cette page. C'est également le cas d'un [déploiement partitionné](/docs/deployment/split-processes/), qui implique par définition plusieurs processus.

Parcourez la liste ci-dessous avant que la deuxième instance ne reçoive du trafic. Aucun de ces points n'échoue de manière évidente : chaque élément se manifeste par une limite appliquée trois fois plus que prévu, un événement que certains clients ne voient jamais, ou une page affichant des journaux différents à chaque actualisation.

## La liste de contrôle

| Élément | Par processus par défaut | Comment le partager |
| --- | --- | --- |
| Secrets de signature | Générés par processus en développement | `JWT_SECRET` et `REBASE_SERVICE_KEY`, définis explicitement et **identiques** partout |
| Compteurs de limitation de débit | En mémoire | `REBASE_RATE_LIMIT_STORE=sql` |
| Adresse client derrière un proxy | `TRUSTED_PROXY_HOPS=0` | Le nombre de proxys en amont, identique partout |
| Abonnements aux tables | Partagés via la base de données lorsque le CDC est activé | `REALTIME_CDC=auto` (par défaut) |
| Canaux de diffusion et présence | En mémoire | `REALTIME_CHANNEL_BUS=postgres` |
| Fichiers téléversés, `STORAGE_TYPE=local` | Le propre disque de l'instance | S3 ou GCS, ou un volume partagé sur le parent de `STORAGE_PATH` |
| Téléversements reprenables (TUS) en cours | Disque de l'instance, sous `STORAGE_PATH/.tus-uploads` | Un volume partagé sur `STORAGE_PATH`, ou sessions persistantes |
| Transformations d'images | Cache interne au processus | `STORAGE_RENDITION_CACHE=true` |
| Explorateur de journaux | Un tampon circulaire des 10 000 dernières lignes | Rien — envoyez stdout vers un agrégateur de journaux |
| Minuteurs cron | Chaque processus exécutant le planificateur | Réservés dans la base de données : une seule exécution par créneau. `REBASE_CRON_SCHEDULER` choisit où résident les minuteurs |
| Audit RLS planifié | Chaque processus qui le possède | `REBASE_RLS_AUDIT=false` sur tous sauf un |
| `index.html` d'une application statique | Lu une fois par processus | Redémarrer chaque instance lorsque le build change |
| `/metrics` | Chaque processus compte les siennes | Scraper chaque instance |

Les sections ci-dessous expliquent le comportement de chaque élément lorsqu'il reste configuré par processus.

## Secrets de signature

`JWT_SECRET` signe chaque session et `REBASE_SERVICE_KEY` authentifie les appels de serveur à serveur. En développement, chaque processus génère les siens lorsqu'ils ne sont pas définis, de sorte qu'un jeton émis par un processus est refusé par le suivant. La production refuse déjà de démarrer sans `JWT_SECRET` (sans `REBASE_SERVICE_KEY`, elle démarre sans aucune clé de service) ; ce qui importe avec plusieurs processus, c'est que chacun reçoive les **mêmes** valeurs — issues d'un unique secret, et non d'un secret différent par réplica.

## Limites de débit et adresse client

Les limiteurs de débit — le quota par appelant sur les API de données, de stockage et de fonctions, ainsi que les limiteurs d'authentification pour la connexion, la réinitialisation de mot de passe, les codes à usage unique et les tentatives MFA — effectuent leur décompte en mémoire par défaut. Un processus ne peut pas savoir combien de pairs il possède ; ainsi, trois réplicas avec la configuration par défaut appliquent trois fois chaque limite. Définissez `REBASE_RATE_LIMIT_STORE=sql` pour que les compteurs soient plutôt stockés dans la base de données.

Derrière un équilibreur de charge, le limiteur a également besoin de l'adresse client réelle, transmise dans `X-Forwarded-For`. `TRUSTED_PROXY_HOPS` indique le nombre de proxys à ignorer ; avec la valeur par défaut `0`, chaque requête semble provenir de l'équilibreur de charge et tous les clients partagent le même quota. Consultez [Configuration](/docs/getting-started/configuration/#runtime-behaviour).

## Realtime

Les **abonnements aux tables** fonctionnent sur plusieurs instances lorsque la capture de données modifiées (CDC) au niveau de la base de données est activée, ce qui est le cas par défaut (`REALTIME_CDC=auto`) : un déclencheur annonce chaque écriture validée, et l'écouteur de chaque instance récupère à nouveau les données pour ses propres abonnés. Si le CDC est désactivé, ou si `auto` n'a pas pu le provisionner (le journal de démarrage indique le cas échéant), un abonnement ne voit que les écritures effectuées via l'instance à laquelle son socket est connecté. Consultez [Realtime](/docs/backend/realtime-cdc/).

Les **canaux de diffusion et la présence** restent internes au processus à moins qu'un bus ne les véhicule : deux clients sur des instances différentes dans le même canal ne peuvent pas communiquer, et chaque instance répond à la question « qui est là ? » avec sa propre moitié d'utilisateurs. Définissez `REALTIME_CHANNEL_BUS=postgres`. Le bus écoute sur la base de données, ce qui nécessite une connexion directe plutôt qu'un pooler de transactions — définissez `DATABASE_DIRECT_URL` lorsque `DATABASE_URL` passe par pgBouncer. Consultez [Canaux et présence entre plusieurs instances](/docs/backend/realtime-transports/#channels-and-presence-across-instances).

## Fichiers

Avec `STORAGE_TYPE=local`, les téléversements sont des fichiers stockés sur le disque de l'instance qui les a reçus, et une autre instance répondra par une erreur 404 pour ces fichiers. Utilisez S3 ou GCS, ou montez un volume sur chaque instance, sur le répertoire parent de `STORAGE_PATH` afin qu'il contienne également le répertoire `<STORAGE_PATH>__<key>` de chaque bucket local nommé. Consultez [Auto-hébergement : stockage de fichiers](/docs/deployment/self-hosting/#file-storage).

Les **téléversements reprenables** (le point de terminaison TUS) conservent le fichier partiel de chaque téléversement, ainsi qu'un enregistrement du téléversement à côté, sur le disque de l'instance qui l'a créé, sous `STORAGE_PATH/.tus-uploads` — même lorsque les fichiers terminés sont envoyés vers S3 ou GCS. Montez un volume sur `STORAGE_PATH` sur chaque instance et n'importe quelle instance pourra gérer n'importe quel téléversement ; un redémarrage ou un déploiement progressif reprendra alors le téléversement là où il s'était arrêté. Sans volume partagé, un segment qui arrive sur une autre instance renvoie une erreur 404 : routez les requêtes de téléversement d'un client vers une seule instance (sessions persistantes sur l'équilibreur de charge). Le SDK et le panneau d'administration, qui utilisent ce point de terminaison pour les fichiers de plus de 8 Mio, envoient alors le fichier via `POST /upload` à la place, et continuent de le faire pour le reste de la session. Les téléversements ordinaires via `POST /upload` s'effectuent en une seule requête et ne sont pas affectés.

Les **transformations d'images** (`?width=400&format=webp`) sont mises en cache en mémoire ; chaque instance calcule donc chaque variante une fois, et une nouvelle instance démarre à froid. Définissez `STORAGE_RENDITION_CACHE=true` pour réécrire chaque rendu dans le bucket d'origine, où chaque instance pourra le retrouver. Cela implique qu'une requête `GET` effectue une écriture dans votre bucket, c'est pourquoi cette option est désactivée par défaut. Consultez [Stockage](/docs/backend/storage/).

## Explorateur de journaux

L'explorateur de journaux de Studio (Logs Explorer) lit un tampon circulaire des 10 000 dernières lignes de journaux conservées par le processus qui traite la requête. Derrière un équilibreur de charge, chaque actualisation peut afficher les lignes d'une instance différente, et aucune d'entre elles ne montre l'ensemble du déploiement. L'explorateur indique le nom de l'instance qu'il affiche. Aucun paramètre ne permet de partager ce tampon circulaire : le runtime écrit une ligne JSON par événement sur stdout en production, et c'est ce qu'il convient de collecter — via le service de journaux de votre plateforme, Loki ou tout outil lisant la sortie des conteneurs.

## Cron et file d'attente de tâches

Chaque processus exécutant le planificateur cron arme ses propres minuteurs, et l'exécution est d'abord revendiquée dans la base de données, de sorte qu'un créneau ne s'exécute qu'**une seule fois**, quel que soit le nombre de processus qui le déclenchent. La mise en pause d'une tâche et le verrou empêchant un déclenchement manuel lors d'une exécution en cours sont partagés de la même manière. Il n'y a rien à configurer, tant que la base de données est Postgres. `REBASE_CRON_SCHEDULER` et `REBASE_JOB_WORKERS` déterminent quels processus exécutent les minuteurs et les workers — consultez [Processus partitionnés](/docs/deployment/split-processes/).

L'audit RLS planifié fait exception : il n'est pas revendiqué en base, donc chaque processus qui le possède effectue une analyse selon son propre minuteur. C'est redondant plutôt que dangereux ; définissez `REBASE_RLS_AUDIT=false` sur toutes les instances sauf une.

## Applications statiques

Un processus qui dessert le frontend ou le CMS (`REBASE_SERVE_STATIC`, activé par défaut) lit l'`index.html` de chaque application une seule fois et le conserve en mémoire. Remplacer le build sur un volume partagé n'affecte pas un processus en cours d'exécution : il continue de servir l'ancien document, qui fait référence à des fragments (chunks) pouvant ne plus exister. Déployez un nouveau build en redémarrant ou en mettant à jour progressivement chaque instance — ce qu'une nouvelle image ou un nouveau bundle fait de toute façon. Avec un CDN en amont et `REBASE_SERVE_STATIC=false`, cela ne s'applique pas.

## Métriques

`/metrics` renvoie les métriques du processus qui répond à la requête. Scrapez chaque instance — via une tâche de découverte de services Prometheus par pod, plutôt qu'une cible unique derrière l'équilibreur de charge — et effectuez la somme dans votre requête.

## Provisionnement au démarrage

Chaque instance exécute la passe additive de schéma au démarrage (`REBASE_MIGRATE_ON_BOOT=ensure`). Les instances ayant le même rôle peuvent l'exécuter simultanément : le code est conçu pour tolérer qu'un pair ait créé la même table un instant plus tôt. Dans un déploiement partitionné, exactement un rôle assure le provisionnement et tous les autres sont configurés sur `none` — consultez [Processus partitionnés](/docs/deployment/split-processes/).
