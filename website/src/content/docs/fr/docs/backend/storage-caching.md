---
sourceHash: bad3ea0d4f6e00f8
title: Mise en cache du stockage et CDN
sidebar_label: Mise en cache du stockage et CDN
description: Comment Rebase distribue les fichiers stockés pour que les navigateurs et les CDN puissent les mettre en cache — ETags et 304, Cache-Control selon qui peut lire un objet, plages d'octets pour le déplacement dans l'audio et la vidéo, et ce qu'il faut configurer sur un CDN en amont.
---

Chaque objet transite via le serveur au lieu d'être redirigé vers une URL
signée — une URL signée dysfonctionne en cas de contenu mixte (une page HTTPS, un MinIO en HTTP) et sur
des points de terminaison accessibles uniquement depuis le cluster. Ce sont donc les en-têtes de réponse qui permettent
le bon fonctionnement de la mise en cache.

Chaque réponse comporte un `ETag` faible et un en-tête `Last-Modified`, calculés à partir de la taille
de l'objet et de sa date de modification. Un client possédant déjà l'objet envoie
`If-None-Match` et reçoit un **304 sans corps**, un rechargement ne coûte donc qu'un
aller-retour réseau au lieu d'un transfert complet.

`Cache-Control` dépend de qui est autorisé à lire l'objet :

| Objet | En-tête |
|---|---|
| Sous le préfixe `public/`, ou `publicRead: true` | `public, max-age=60, stale-while-revalidate=86400, must-revalidate` |
| Tout autre cas | `private, max-age=60, must-revalidate` |
| Transformations d'images | identique, avec `max-age=3600` |

`private` est un choix délibéré : un objet nécessitant des identifiants pour être récupéré ne doit pas être
stocké par un cache partagé, sous peine qu'un CDN ne livre le fichier d'un utilisateur au demandeur suivant.
`Vary: Authorization` est envoyé pour cette même raison.

Rien n'est jamais marqué comme `immutable`. Une clé de stockage peut être écrasée — écrire
sur une clé existante étant une opération courante — s'engager à ne jamais revalider
rendrait un fichier remplacé invisible jusqu'à l'expiration de la période.

## Déplacement (seeking) dans l'audio et la vidéo

Chaque réponse d'objet porte `Accept-Ranges: bytes`, et une requête avec `Range` reçoit
une réponse `206 Partial Content` avec un en-tête `Content-Range`. Sans cela, un navigateur
ne proposera pas de curseur de lecture dans un élément multimédia distribué depuis ce point — et Safari refuse
de lire une balise `<video>` dont la première réponse n'est pas un code `206` — pour les médias, c'est donc
la différence entre un lecteur fonctionnel et un lecteur en panne.

- Un seul intervalle par requête : `bytes=0-499`, `bytes=500-`, `bytes=-500`. C'est ce que
  les navigateurs envoient pour la lecture.
- Plusieurs plages dans un seul en-tête reçoivent la totalité de l'objet avec un code `200`,
  ce qui est toujours valide. Aucun client pertinent n'en envoie.
- Un intervalle débutant après la fin du fichier renvoie un code `416` avec `Content-Range: bytes */<size>`,
  et non une réponse silencieuse renvoyant l'intégralité du fichier.
- La revalidation prévaut sur un intervalle : une requête transmettant à la fois `If-None-Match` et
  `Range` reçoit le code `304`.

Sur le stockage local, seul le segment demandé est lu depuis le disque. Sur S3 et GCS,
l'objet est toujours récupéré en entier — un `StorageController` ne disposant pas de lecture partielle — le
gain se fait donc sur la réponse, pas en amont.

## Placer un CDN en amont

Comme les objets publics sont marqués `public` avec une fenêtre `stale-while-revalidate` et un
validateur, n'importe quel proxy inverse ordinaire ou CDN peut les mettre en cache sans configuration
supplémentaire. Pointez-le vers l'origine de l'API et laissez-le respecter les en-têtes.

Deux éléments à configurer sur le CDN lui-même :

- **Respecter `Vary: Authorization`**, ou ne pas mettre en cache les routes authentifiées du tout.
  Un CDN qui ignore `Vary` et met en cache des réponses `private` constitue précisément l'erreur que cet
  en-tête vise à empêcher.
- **S'attendre à la revalidation.** La courte valeur de `max-age` implique que le CDN redemandera
  régulièrement validation ; ces requêtes sont des 304 très légers, et c'est ce qui évite
  qu'un objet écrasé ne soit distribué dans une version obsolète.

## Liens associés

- [Configuration du stockage](/docs/backend/storage/) — les backends depuis lesquels ces en-têtes sont servis, et le préfixe `public/` ainsi que `publicRead` qui rendent un objet `public`.
- [Autorisation par objet](/docs/backend/storage/#per-object-authorization) — qui peut lire un objet, ce qui détermine le choix entre `public` et `private`.
- [Champs de téléversement de fichiers](/docs/collections/file-uploads/) — les propriétés de collection qui stockent des fichiers.
