---
sourceHash: 5711b13e11b0b4c4
title: Mise en cache du stockage et CDN
sidebar_label: Mise en cache du stockage et CDN
description: Comment Rebase sert les fichiers stockés pour que les navigateurs et les CDN puissent les mettre en cache — ETags et 304, Cache-Control selon qui peut lire un objet, plages d'octets pour la navigation audio/vidéo, et configuration d'un CDN en amont.
---

Chaque objet transite par un proxy via le serveur plutôt que d'être redirigé vers une URL signée — une URL signée échoue en cas de contenu mixte (une page HTTPS, un MinIO en HTTP) et sur les points de terminaison accessibles uniquement par le cluster. Ce sont donc les en-têtes de réponse qui permettent à la mise en cache de fonctionner.

Chaque réponse comporte un `ETag` faible et un en-tête `Last-Modified`, construits à partir de la taille de l'objet et de sa date de modification. Un client qui possède déjà l'objet envoie `If-None-Match` et reçoit une réponse **304 sans corps**, de sorte qu'un chargement répété ne coûte qu'un aller-retour au lieu d'un transfert complet.

`Cache-Control` dépend de qui est autorisé à lire l'objet :

| Objet | En-tête |
|---|---|
| Sous le préfixe `public/`, ou `publicRead: true` | `public, max-age=60, stale-while-revalidate=86400, must-revalidate` |
| Tout le reste | `private, max-age=60, must-revalidate` |
| Transformations d'image | identique, avec `max-age=3600` |

`private` est délibéré : un objet nécessitant des identifiants d'accès ne doit pas être stocké par un cache partagé, faute de quoi un CDN pourrait transmettre le fichier d'un utilisateur au visiteur suivant. `Vary: Authorization` est envoyé pour la même raison.

Rien n'est jamais marqué comme `immutable`. Une clé de stockage peut être écrasée — écrire sur une clé existante est une opération courante — ainsi, la promesse de ne jamais revalider rendrait un fichier remplacé invisible jusqu'à l'expiration du délai.

## Navigation dans l'audio et la vidéo

Chaque réponse d'objet contient l'en-tête `Accept-Ranges: bytes`, et une requête `Range` reçoit en réponse un code `206 Partial Content` accompagné d'un `Content-Range`. Sans cela, un navigateur ne permettra pas de naviguer dans la lecture (seek) d'un élément multimédia servi d'ici — et Safari refuse de lire une `<video>` dont la première réponse n'est pas un code `206` — pour les médias, c'est donc ce qui fait la différence entre un lecteur fonctionnel et un lecteur en panne.

- Une plage par requête : `bytes=0-499`, `bytes=500-`, `bytes=-500`. C'est ce que les navigateurs envoient pour la lecture.
- Les plages multiples dans un seul en-tête reçoivent en réponse l'objet entier avec un code `200`, ce qui est toujours valide selon les spécifications. Aucun client important n'en envoie.
- Une plage commençant au-delà de la fin renvoie une erreur `416` avec `Content-Range: bytes */<size>`, et non une réponse silencieuse renvoyant tout le fichier.
- La revalidation prime sur une plage : une requête comportant à la fois `If-None-Match` et `Range` reçoit un `304`.

Seuls les octets demandés sont lus — depuis le disque sur le stockage local, et via une lecture par plage (ranged read) pour S3 et GCS — et chaque objet est transmis en continu (streamed) au client au fur et à mesure de sa lecture plutôt que d'être d'abord chargé en mémoire. Ainsi, servir une vidéo volumineuse coûte au serveur la même quantité de mémoire que servir une vignette. Une revalidation aboutissant à un `304`, une requête `HEAD`, un `416` et un rendu d'image mis en cache reçoivent une réponse basée uniquement sur les métadonnées de l'objet, sans lire ses octets.

Un `StorageController` personnalisé bénéficie du même comportement en implémentant les méthodes optionnelles `statObject` et `getObjectStream`. Sans elles, les requêtes sont traitées via `getObject`, qui lit la totalité de l'objet pour chaque requête, y compris celles avec plages.

## Placer un CDN en amont

Puisque les objets publics sont marqués comme `public` avec une fenêtre `stale-while-revalidate` et un validateur, n'importe quel proxy inverse ou CDN ordinaire peut les mettre en cache sans configuration supplémentaire. Pointez-le vers l'origine de l'API et laissez-le respecter les en-têtes.

Deux éléments à configurer sur le CDN lui-même :

- **Respecter `Vary: Authorization`**, ou ne pas mettre en cache du tout les routes authentifiées. Un CDN qui ignore `Vary` et met en cache des réponses `private` constitue précisément le problème que cet en-tête vise à empêcher.
- **S'attendre à des revalidations.** La faible valeur de `max-age` signifie que le CDN redemandera régulièrement la ressource ; ces requêtes sont des 304 peu coûteux, et c'est ce qui évite de servir une version obsolète d'un objet ayant été écrasé.

## Voir aussi

- [Configuration du stockage](/docs/backend/storage/) — les backends depuis lesquels ces en-têtes sont servis, ainsi que le préfixe `public/` et `publicRead` qui rendent un objet `public`.
- [Autorisation par objet](/docs/backend/storage-authorization/) — qui est autorisé à lire un objet, ce qui détermine le choix entre `public` et `private`.
- [Téléversements de fichiers](/docs/collections/file-uploads/) — les colonnes de stockage qui contiennent les fichiers, et la manière dont le panneau les téléverse.
