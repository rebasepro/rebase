---
sourceHash: 77d34fca08a6a305
title: Téléversements reprenables (TUS)
sidebar_label: Téléversements reprenables (TUS)
description: Le endpoint TUS v1.0.0 sous /api/storage/tus — comment un gros fichier monte un morceau à la fois, ce que répond chaque requête, comment le SDK et le panneau d'administration l'utilisent, et son comportement face aux redémarrages et aux instances multiples.
---

Pour téléverser de gros fichiers ou gérer des conditions réseau instables, Rebase implémente le protocole ouvert **TUS v1.0.0**, avec les extensions `Creation` et `Termination`.
Ses limites sont celles de la source, comme pour tout téléversement — voir
[Quelle taille de fichier est permise](/docs/backend/storage/#how-large-a-file-may-be).

## Pourquoi les gros fichiers passent par là

`POST /api/storage/upload` est un unique corps multipart, que le serveur analyse en entier
avant de le stocker : de trois à cinq fois le fichier en mémoire (environ 340 Mo
pour un fichier de 100 Mo). Un téléversement reprenable ne retient qu'un morceau à la fois — chaque `PATCH`
reste sous la limite globale de corps, 10 Mo par défaut — et est écrit dans le stockage
depuis le disque : environ 50 Mo pour ce fichier, et 80 Mo pour un fichier de 400 Mo. Dimensionnez donc la
limite de la source en fonction de la mémoire du serveur si des clients utilisent `POST /api/storage/upload`
pour de gros fichiers, et pas autrement.

<span class="since-badge" data-since="0.25">Depuis 0.25</span> `client.storage.putObject()` et le panneau d'administration envoient un fichier de plus de
8 Mio par le endpoint reprenable, en morceaux de 8 Mio, et reprennent un morceau
qui échoue en route à partir du décalage que détient le serveur. Le fichier atterrit comme le
stockerait `POST /api/storage/upload` — même clé, même bucket, même type, mêmes métadonnées
personnalisées, mêmes limites, même contrôle `storageAuthorize` et même déclencheur `finalize` — et l'appel
renvoie le même `{ key, bucket, storageUrl }`. Lorsque la route reprenable
ne peut pas le porter — un serveur sans ce endpoint, un morceau supérieur à la limite de corps
du serveur, ou une instance qui ne détient pas le téléversement (voir
[Exécuter plusieurs instances](/docs/deployment/multiple-instances/#files)) — le
fichier passe à la place par `POST /api/storage/upload`, et cette source envoie
aussi tous les fichiers suivants de cette façon.

```
Client                                                   Rebase Server
  │                                                           │
  │─── POST /api/storage/tus (Upload-Length: 50000000) ──────>│ (Generates session ID)
  │<── 201 Created (Location: /api/storage/tus/uuid-abc) ────│
  │                                                           │
  │─── PATCH /api/storage/tus/uuid-abc (Upload-Offset: 0) ───>│ (Appends chunk via open/write)
  │<── 204 No Content (Upload-Offset: 1500000) ───────────────│
  │                                                           │
  │─── PATCH /api/storage/tus/uuid-abc (Upload-Offset: 1.5M) ─>│ (Upload finishes)
  │<── 204 No Content (Upload-Offset: 50000000) ──────────────│ (Copies to storage, unlinks temp)
```

## Cycle de vie d'un téléversement

1. **Initialisation de la session (`POST`)** : le client envoie la taille totale du fichier dans l'en-tête `Upload-Length` et des métadonnées en base64 via `Upload-Metadata` : `key` (ou `filename`), `filetype`, `bucket`, `storageId`, `collection` et `property`, comme `POST /api/storage/upload` les accepte en champs de formulaire, et <span class="since-badge" data-since="0.25">Depuis 0.25</span> des entrées `metadata_<name>`, qui deviennent les métadonnées personnalisées de l'objet comme le font les champs `metadata_<name>`. Le serveur crée un fichier vide servant d'espace réservé dans un répertoire temporaire caché `.tus-uploads/`, <span class="since-badge" data-since="0.25">Depuis 0.25</span> avec à côté un enregistrement du téléversement (`<id>.json` : sa clé, son bucket, sa source, son type, sa taille et son propriétaire), et renvoie l'URL du téléversement. <span class="since-badge" data-since="0.25">Depuis 0.25</span> Il répond aussi `Rebase-Upload-Result: on-complete` : ce serveur indique ce qu'il a stocké lorsque le téléversement se termine. Le téléversement vit dans ce répertoire, non dans le processus : un serveur redémarré le reprend, et toute instance qui partage `STORAGE_PATH` le sert — voir [Exécuter plusieurs instances](/docs/deployment/multiple-instances/#files).
2. **Demandes de progression (`HEAD`)** : si un téléversement est interrompu, le client interroge l'URL du téléversement avec une requête `HEAD`. Le serveur renvoie la position actuelle en octets dans l'en-tête `Upload-Offset`.
3. **Ajout de données (`PATCH`)** : le client reprend l'envoi des données binaires à partir du décalage renvoyé avec `Content-Type: application/offset+octet-stream`. Le serveur écrit chaque morceau dans le fichier temporaire au décalage en octets que déclare la requête, qui doit être celui que détient le serveur (`409` sinon). Un seul morceau est reçu à la fois : un `PATCH` qui arrive alors qu'un autre pour le même téléversement est encore en cours de réception — typiquement un client qui renvoie un morceau bloqué — reçoit la réponse `423 UPLOAD_LOCKED`, et le client reprend au décalage que rapporte `HEAD`.
4. **Finalisation** : lorsque le `Upload-Offset` accumulé correspond au `Upload-Length` déclaré, Rebase lit le fichier temporaire complet, l'enveloppe dans un objet JavaScript `File` standard et l'enregistre dans le backend de stockage configuré (disque local ou S3). Le fichier temporaire est ensuite supprimé. <span class="since-badge" data-since="0.25">Depuis 0.25</span> Ce dernier `PATCH` répond `Rebase-Upload-Result` avec l'objet stocké — `{ key, bucket, storageUrl }`, ce que `POST /api/storage/upload` répond sous `data` — sous forme de JSON encodé en URI. Un frontend sur une autre origine peut le lire, ainsi que `Location` et `Upload-Offset`, uniquement si le serveur les expose dans `Access-Control-Expose-Headers` : le runtime Rebase et le backend éjecté le font ; un [serveur personnalisé](/docs/backend/custom-server/) doit le faire.
5. **Nettoyage périodique** : un nettoyeur en arrière-plan s'exécute toutes les **60 secondes** pour supprimer les téléversements temporaires incomplets commencés il y a plus de **24 heures** — y compris ceux qu'un autre processus a démarrés, lus depuis le répertoire.

## Qui peut accéder à un téléversement

Un téléversement démarré par un appelant connecté ne répond qu'à cet appelant et aux administrateurs ;
toute autre personne reçoit `404`, comme si l'id n'existait pas. Un téléversement démarré sans session n'a pas de
propriétaire, son id est donc une capacité : quiconque détient l'URL du téléversement peut lire sa progression, y ajouter
des données et l'annuler. Gardez cette URL secrète, comme un jeton de téléchargement. Seul un déploiement
qui exécute le stockage avec `requireAuth: false` peut en démarrer un : avec `requireAuth` activé, ce qui est
la valeur par défaut, un `POST` sans session est refusé avec `401`.

## Voir aussi

- [Configuration du stockage](/docs/backend/storage/) — sources, limites, endpoints et autorisation
- [Exécuter plusieurs instances](/docs/deployment/multiple-instances/#files) — où vit un téléversement en cours
- [SDK de stockage](/docs/sdk/storage/) — `putObject()`, qui utilise ce endpoint pour les fichiers de plus de 8 Mio
