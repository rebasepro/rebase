---
sourceHash: 88050e5f44c6457a
title: Exécuter plusieurs instances
sidebar_label: Plusieurs instances
description: Chaque élément d'état qu'un processus Rebase conserve pour lui-même, et le paramètre pour le partager — ce qu'il faut configurer avant qu'un second réplica, un déploiement progressif ou un déploiement scindé ne reçoive du trafic.
---

## Vue d'ensemble

La majeure partie d'un déploiement Rebase réside déjà dans la base de données : les lignes, les utilisateurs et
les sessions, les clés d'API, la file d'attente des tâches, les réservations cron, les clés d'idempotence, l'historique
des enregistrements, les jetons du serveur OAuth MCP. Un second processus pointant vers la même
base de données a accès à l'ensemble de ces données.

Quelques éléments font exception. Chacun est propre au processus par défaut, car un processus unique constitue
le déploiement par défaut et le partage a un coût — une table, une écriture dans un bucket, une
connexion à la base de données. Exécuter deux processus derrière un répartiteur de charge, passer à l'échelle au-delà
d'une instance, ou effectuer un déploiement progressif (rolling deploy) qui exécute brièvement l'ancienne et la nouvelle version côte à côte
vous amène sur cette page. Il en va de même pour un [déploiement scindé](/docs/deployment/split-processes/),
qui comprend plusieurs processus par définition.

Parcourez la liste ci-dessous avant que la deuxième instance ne reçoive du trafic. Aucun élément de cette liste
n'échoue de manière évidente : chaque élément se manifeste par une limite appliquée trois fois de suite, un événement
que certains clients ne reçoivent jamais, ou une page affichant des journaux différents à chaque actualisation.

## La liste de contrôle

| Quoi | Par processus par défaut | Ce qui le partage |
| --- | --- | --- |
| Secrets de signature | Générés par processus en développement | `JWT_SECRET` et `REBASE_SERVICE_KEY`, définis explicitement et **identiques** partout |
| Compteurs de limitation de débit (rate limit) | En mémoire | `REBASE_RATE_LIMIT_STORE=sql` |
| Adresse client derrière un proxy | `TRUSTED_PROXY_HOPS=0` | Le nombre de proxys en amont, identique partout |
| Abonnements aux collections | Partagés via la base de données lorsque le CDC est actif | `REALTIME_CDC=auto` (par défaut) |
| Canaux de diffusion (broadcast) et présence | En mémoire | `REALTIME_CHANNEL_BUS=postgres` |
| Fichiers téléversés, `STORAGE_TYPE=local` | Le disque propre à l'instance | S3 ou GCS, ou un volume partagé sur le parent de `STORAGE_PATH` |
| Téléversements avec reprise (TUS) en cours | Le disque de l'instance, à l'emplacement `STORAGE_PATH/.tus-uploads` | Un volume partagé sur `STORAGE_PATH`, ou des sessions persistantes (sticky sessions) |
| Transformations d'images | Un cache interne au processus | `STORAGE_RENDITION_CACHE=true` |
| Explorateur de journaux (Logs Explorer) | Un tampon circulaire des 10 000 dernières lignes | Rien — envoyez stdout vers un agrégateur de journaux |
| Minuteurs cron | Chaque processus qui exécute le planificateur | Réservés dans la base de données : une exécution par créneau. `REBASE_CRON_SCHEDULER` choisit où résident les minuteurs |
| Audit RLS planifié | Chaque processus qui en a la charge | `REBASE_RLS_AUDIT=false` sur toutes les instances sauf une |
| Le fichier `index.html` d'une application statique | Lu une fois par processus | Redémarrer chaque instance lorsque le build change |
| `/metrics` | Chaque processus compte pour lui-même | Scraper chaque instance |

Les sections ci-dessous expliquent le comportement de chaque élément lorsqu'il reste configuré par processus.

## Secrets de signature

`JWT_SECRET` signe chaque session et `REBASE_SERVICE_KEY` authentifie
les appels de serveur à serveur. En développement, chaque processus génère le sien lorsqu'ils
ne sont pas définis, de sorte qu'un jeton émis par un processus est refusé par le suivant. En production,
le démarrage est refusé sans `JWT_SECRET` (sans `REBASE_SERVICE_KEY`, il démarre
sans aucune clé de service) ; ce qui importe avec plusieurs processus,
c'est que chacun reçoive les **mêmes** valeurs — issues d'un unique secret, et non d'un secret par réplica.

## Limites de débit et adresse client

Les limiteurs de débit — le quota par appelant sur les API de données, de stockage et de fonctions,
ainsi que les limiteurs d'authentification sur la connexion, la réinitialisation de mot de passe, les codes à usage unique et les tentatives MFA —
comptabilisent les requêtes en mémoire par défaut. Un processus ne peut pas voir combien de pairs il
possède, donc trois réplicas avec la configuration par défaut appliqueront chaque limite trois fois. Définissez
`REBASE_RATE_LIMIT_STORE=sql` pour que les compteurs résident plutôt dans la base de données.

Derrière un répartiteur de charge, le limiteur a également besoin de la véritable adresse client, qui
arrive dans l'en-tête `X-Forwarded-For`. `TRUSTED_PROXY_HOPS` indique combien de proxys doivent être
traversés ; avec la valeur par défaut `0`, chaque requête semble provenir du répartiteur de charge
et tous les clients partagent le même quota. Voir
[Configuration](/docs/getting-started/configuration/#runtime-behaviour).

## Temps réel (Realtime)

Les **abonnements aux collections** fonctionnent d'une instance à l'autre lorsque la capture des modifications au niveau
de la base de données (CDC) est activée, ce qui est le cas par défaut (`REALTIME_CDC=auto`) : un déclencheur annonce
chaque écriture validée (commit), et le listener de chaque instance effectue une nouvelle récupération pour ses propres
abonnés. Si le CDC est désactivé, ou si le mode `auto` n'a pas pu le provisionner (le journal de démarrage indique
la situation), un abonnement ne verra que les écritures effectuées via l'instance à laquelle
son socket est connecté. Voir
[Realtime](/docs/backend/realtime-cdc/).

Les **canaux de diffusion et la présence** sont internes au processus à moins qu'un bus ne les véhicule :
deux clients sur des instances différentes dans le même canal ne s'entendent pas,
et chaque instance répond à la question « qui est présent ? » avec sa propre portion. Définissez
`REALTIME_CHANNEL_BUS=postgres`. Le bus écoute la base de données, ce qui nécessite une
connexion directe plutôt qu'un pooler de transactions — définissez `DATABASE_DIRECT_URL`
lorsque `DATABASE_URL` passe par pgBouncer. Voir
[Canaux et présence entre plusieurs instances](/docs/backend/realtime-transports/#channels-and-presence-across-instances).

## Fichiers

Avec `STORAGE_TYPE=local`, les téléversements sont des fichiers stockés sur le disque de l'instance qui
les a reçus, et une autre instance renverra une erreur 404 pour ceux-ci. Utilisez S3 ou GCS, ou
montez un volume partagé sur chaque instance, au niveau du répertoire parent de `STORAGE_PATH` afin qu'il
contienne également le répertoire `<STORAGE_PATH>__<key>` de chaque bucket local nommé. Voir
[Auto-hébergement : stockage de fichiers](/docs/deployment/self-hosting/#file-storage).

Les **téléversements avec reprise** (le point de terminaison TUS) conservent le fichier partiel de chaque téléversement, et
un enregistrement du téléversement à ses côtés, sur le disque de l'instance qui
l'a créé, sous `STORAGE_PATH/.tus-uploads` — même lorsque les fichiers finalisés vont vers
S3 ou GCS. Montez un volume partagé sur `STORAGE_PATH` sur chaque instance et n'importe quelle instance
pourra servir n'importe quel téléversement ; un redémarrage ou un déploiement progressif reprendra alors le téléversement là où il
s'est arrêté. Sans volume partagé, un fragment (chunk) qui arrive sur une autre instance
reçoit une réponse 404 : acheminez les requêtes de téléversement d'un client vers une seule instance (sessions persistantes
sur le répartiteur de charge). Le SDK et le panneau d'administration, qui utilisent ce point de terminaison pour
les fichiers de plus de 8 Mio, envoient alors le fichier via `POST /upload` à la place, et continuent
de le faire pour le reste de la session. Les téléversements ordinaires via `POST /upload` ne comportent qu'une seule requête
et ne sont pas affectés. En version 0.23, l'état du téléversement était en mémoire dans le processus,
un volume partagé n'était donc d'aucune aide et un redémarrage réinitialisait le téléversement à l'octet 0.

Les **transformations d'images** (`?width=400&format=webp`) sont mises en cache en mémoire, ainsi chaque
instance calcule chaque variante une fois, et une nouvelle instance démarre à froid. Définissez
`STORAGE_RENDITION_CACHE=true` pour réécrire chaque rendu dans le bucket dont
il provient, où chaque instance pourra le trouver. Cela implique qu'une requête `GET` effectue une écriture sur votre
bucket, c'est pourquoi cette option est désactivée par défaut. Voir
[Storage](/docs/backend/storage/).

## Explorateur de journaux (Logs Explorer)

L'explorateur de journaux de Studio lit un tampon circulaire des 10 000 dernières lignes de journal conservées par le
processus qui répond à la requête. Derrière un répartiteur de charge, chaque actualisation peut afficher
les lignes d'une instance différente, et aucune d'entre elles n'affiche le déploiement complet.
L'explorateur indique le nom de l'instance qu'il affiche.
Aucun paramètre ne permet de partager ce tampon circulaire : le runtime écrit une ligne JSON par événement sur
stdout en production, et c'est ce flux qu'il convient de collecter — via le service de journaux de votre plateforme,
Loki, ou tout outil lisant la sortie des conteneurs.

## Cron et la file d'attente des tâches

Chaque processus qui exécute le planificateur cron arme ses propres minuteurs, et l'exécution est
d'abord réservée dans la base de données, de sorte qu'un créneau ne s'exécute **qu'une seule fois**, quel que soit le nombre de processus
qui le déclenchent. La mise en pause d'une tâche, ainsi que le verrou (lease) empêchant un déclenchement manuel sur une tâche
en cours, sont partagés de la même manière. Il n'y a rien à configurer, tant que la base de données
est Postgres. `REBASE_CRON_SCHEDULER` et `REBASE_JOB_WORKERS` déterminent quels
processus exécutent les minuteurs et les workers — voir
[Processus scindés](/docs/deployment/split-processes/).

L'audit RLS planifié fait exception : il ne fait pas l'objet d'une réservation, donc chaque processus
qui en a la charge effectue une analyse selon son propre minuteur. C'est redondant mais sans danger ; définissez
`REBASE_RLS_AUDIT=false` sur toutes les instances sauf une.

## Applications statiques

Un processus qui sert le frontend ou le CMS (`REBASE_SERVE_STATIC`, activé par
défaut) lit le fichier `index.html` de chaque application une seule fois et le conserve en mémoire. Remplacer le build
sur un volume partagé n'affecte pas un processus en cours d'exécution : il continue de servir l'ancien
document, qui référence des fragments (chunks) qui peuvent ne plus exister. Déployez un nouveau build en
redémarrant ou en faisant un roulement de chaque instance — ce qu'un nouveau conteneur ou bundle fait de toute façon.
Avec un CDN en amont et `REBASE_SERVE_STATIC=false`, cela ne s'applique pas.

## Métriques

Le point de terminaison `/metrics` rend compte du processus qui répond à la requête. Scrapez chaque instance — une
tâche de découverte de services Prometheus par pod, et non une cible unique derrière le répartiteur de
charge — et effectuez la somme dans la requête.

## Provisionnement au démarrage

Chaque instance exécute la passe additive du schéma au démarrage
(`REBASE_MIGRATE_ON_BOOT=ensure`). Les instances ayant le même rôle peuvent l'exécuter en
même temps : elle est conçue pour tolérer qu'un pair crée la même table un instant
plus tôt. Dans un déploiement scindé, exactement un rôle assure le provisionnement et tous les autres sont définis sur
`none` — voir [Processus scindés](/docs/deployment/split-processes/).
