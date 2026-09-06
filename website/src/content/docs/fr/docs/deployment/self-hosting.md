---
sourceHash: 27ad5b75346e802f
title: Auto-hébergement
sidebar_label: Auto-hébergement
description: Exécutez Rebase n'importe où avec l'image d'exécution officielle et le bundle de votre projet — Docker Compose, Fly, Railway ou un simple VPS.
---

## Présentation

Auto-héberger Rebase signifie exécuter deux éléments : une base de données Postgres et l'image officielle `rebasepro/server` dans laquelle le bundle de votre projet est monté.

Il n'y a **aucune image d'application à construire**. Votre projet voyage sous forme de bundle, le runtime est publié, et mettre à jour Rebase est un simple changement de tag plutôt qu'une nouvelle construction. Consultez [Runtime et bundles](/docs/architecture/runtime-and-bundles/) pour comprendre les raisons de cette séparation.

## Docker Compose

Le fichier compose vit dans le dépôt, à
[`infra/docker/docker-compose.selfhost.yml`](https://github.com/rebasepro/rebase/blob/main/infra/docker/docker-compose.selfhost.yml).
Utilisez celui-là plutôt que de copier un extrait de cette page : c'est le
fichier que la vérification d'acceptation du projet démarre à chaque push, il ne
peut donc pas diverger de ce qui fonctionne réellement.

```bash
rebase build                    # produit ./dist-bundle
./infra/docker/quickstart.sh    # écrit infra/docker/.env s'il manque, puis démarre
```

`quickstart.sh` est une commande qui fait deux choses évidentes et affiche les
deux. La forme longue, si vous préférez maîtriser chaque étape :

```bash
docker compose -f infra/docker/docker-compose.selfhost.yml \
  --env-file infra/docker/.env up
```

Inutile de démarrer la base séparément : `api` attend son healthcheck.

### Les quatre valeurs nécessaires

`quickstart.sh` les génère pour vous. Pour écrire le `.env` vous-même :

```bash
cat > infra/docker/.env <<EOF
POSTGRES_PASSWORD=$(openssl rand -hex 32)
JWT_SECRET=$(openssl rand -hex 32)
REBASE_SERVICE_KEY=$(openssl rand -hex 32)
CORS_ORIGINS=https://app.example.com
EOF
```

Trois secrets et un fait :

- **`POSTGRES_PASSWORD`** — le mot de passe de la base. Le changer plus tard
  implique de le changer aussi dans le volume ; choisissez-le une fois.
- **`JWT_SECRET`** — signe chaque session. Une rotation déconnecte tout le monde.
- **`REBASE_SERVICE_KEY`** — l'identifiant qui contourne la sécurité au niveau
  des lignes pour les appels de serveur à serveur. Traitez-le comme un mot de
  passe root : quiconque le détient peut lire toutes les lignes.
- **`CORS_ORIGINS`** — les origines depuis lesquelles votre frontend est servi,
  séparées par des virgules. Ce n'est pas un secret, et ce n'est pas optionnel
  non plus : en production le runtime refuse de démarrer plutôt que de deviner,
  parce qu'une API qui devine ses origines autorisées finit par autoriser la
  mauvaise.

Chacun des trois secrets doit faire au moins 32 caractères. Le fichier compose
les déclare avec `${VAR:?…}`, de sorte qu'une valeur manquante arrête la pile
avec un message qui la nomme, au lieu de démarrer quelque chose à moitié
configuré.

## Dépendances

`rebase build` **installe les dépendances de votre projet dans le bundle** par
défaut : `dist-bundle` arrive donc avec un `node_modules` et un
`package-lock.json` à côté de son `package.json`. Un tel bundle démarre en cinq
secondes environ.

Comme elles sont déjà là, vous pouvez monter le bundle en lecture seule — cela
vaut la peine, car un hook compromis ne peut alors pas réécrire le code qui
s'exécutera après le prochain redémarrage :

```yaml
    volumes:
      - ./dist-bundle:/bundle:ro
```

`rebase build --no-vendor` y renonce et produit un bundle qui installe ses
dépendances au premier démarrage, ce qui prend 40 à 60 secondes par démarrage et
exige un montage accessible en écriture.

Pour un déploiement réel, mieux vaut intégrer les deux dans une image, ce qui
fixe aussi exactement ce qui s'exécute :

```dockerfile
FROM rebasepro/server:0.17.3
COPY dist-bundle /bundle
```

## Création du schéma

**Le runtime crée les tables manquantes au démarrage, y compris celles de vos
collections.** `REBASE_MIGRATE_ON_BOOT` vaut `ensure` par défaut, ce qui est
additif sur tout le schéma : les tables, colonnes et types enum manquants sont
créés, et leur sécurité au niveau des lignes appliquée. Un premier démarrage sur
une base vide sert vos collections, sans étape séparée.

Ce que `ensure` ne fait délibérément jamais, c'est modifier l'existant. Il ne
change pas le type d'une colonne, ne supprime ni table ni colonne, et ne modifie
pas les libellés d'un enum existant — parce que le redémarrage d'un conteneur ne
doit pas pouvoir remodeler un schéma comme effet de bord d'un déploiement.

`rebase db push` reste donc utile, pour les deux choses que le démarrage laisse
de côté :

```bash
rebase db push
```

- **La RLS des tables de jointure** des relations plusieurs-à-plusieurs.
- **Tout changement qui n'est pas purement additif** : une colonne renommée, un
  type restreint, un champ supprimé.

Lancez-le depuis un checkout ou un job de CI, pointé sur la base du déploiement.
Il simule d'abord le changement, refuse les changements destructeurs sans
confirmation explicite, et peut prendre une sauvegarde avant d'appliquer. Dans le
fichier compose la base publie un port pour que cela puisse l'atteindre depuis
l'hôte ; retirez ce mappage une fois le schéma en place si la base ne doit pas
être joignable de l'extérieur.

`REBASE_MIGRATE_ON_BOOT` accepte `ensure` et `none`, et rien d'autre : l'image
**refuse de démarrer** sur `push`, pour la raison ci-dessus.

## Stockage de fichiers

Le stockage est **désactivé** tant qu'aucun bucket n'est configuré, et c'est
délibéré : l'autre valeur par défaut serait le système de fichiers du conteneur,
qui perd silencieusement chaque fichier téléversé au redémarrage suivant. Les
téléversements sont refusés avec `501 STORAGE_NOT_CONFIGURED` jusqu'à ce que vous
en configuriez un.

Pour un bucket, définissez `STORAGE_TYPE=s3` (ou `gcs`) ainsi que son bucket et
ses identifiants — le fichier compose liste les variables, commentées.

Pour un disque local, ce qui n'est approprié que si le chemin est un vrai volume
qui survit au conteneur :

```yaml
      STORAGE_TYPE: local
      STORAGE_PATH: /data/uploads
    volumes:
      - uploads:/data/uploads
```

## Autres plateformes

Le runtime est un conteneur ordinaire à l'écoute sur `$PORT`, de sorte que tout système exécutant des conteneurs fonctionne. Deux points à bien configurer partout :

1. Le bundle doit être présent dans `/bundle` (ou là où pointe `REBASE_BUNDLE`), avec ses dépendances installées à côté — voir [Dépendances](#dépendances).
2. Définissez `CORS_ORIGINS`, `JWT_SECRET` et `DATABASE_URL`. Le runtime refusera de démarrer en production sans ces variables plutôt que de tenter de les deviner.

### Fly.io

```toml
[build]
  image = "rebasepro/server:0.17.3"

[http_service]
  internal_port = 8080

[[http_service.checks]]
  path = "/livez"
```

Utilisez la forme d'image dérivée ci-dessus afin que le bundle soit livré avec l'application, puis lancez `fly deploy`.

### Railway / Render

Pointez le service vers l'image dérivée, définissez les variables d'environnement et configurez le chemin du contrôle de santé sur `/livez`.

### Un simple VPS

```bash
npm install -g @rebasepro/server @rebasepro/server-postgres
rebase-server /srv/myapp/dist-bundle
```

Exécutez-le sous systemd, avec des lignes `Environment=` pour les variables ci-dessus.

## Contrôles de santé

| Chemin | Utilisation |
| --- | --- |
| `/livez` | État de vie (Liveness). Répond à « ce processus est-il actif ? » sans toucher à la base de données. |
| `/health` | État de disponibilité (Readiness). Effectue un aller-retour avec la base de données et indique la latence. |

Pointez les sondes de liveness vers `/livez`. Une sonde de liveness sur `/health` redémarrerait un processus parfaitement sain lors d'une brève interruption de la base de données, ce qui est l'inverse de son objectif.

## Métriques

```bash
REBASE_METRICS=true
REBASE_METRICS_TOKEN=<random string>
```

Expose les métriques Prometheus sur `/metrics` : nombre de requêtes et histogrammes de latence ventilés par surface d'API (data, auth, storage, functions) et par collection, ainsi que des jauges de processus. Sans jeton, le point de terminaison est accessible en lecture par quiconque peut atteindre le port ; vous devez donc en définir un à moins d'être sur un réseau privé.

## Exécuter les fonctions dans leur propre processus

Tout ce qui précède est un seul conteneur servant l'ensemble du projet, ce qui
est la bonne forme pour presque tous les déploiements. Lorsqu'une fonction
personnalisée doit cesser de concurrencer l'API de données sur la boucle
d'événements — ou monter en charge, redémarrer et échouer de son côté — la même
image et le même bundle peuvent être démarrés comme plusieurs processus
coopérants. Voir [Processus séparés](/docs/deployment/split-processes/).

## Mise à niveau

```yaml
image: rebasepro/server:0.17.3
```

Redémarrez. Votre bundle reste inchangé. Au sein d'une même version majeure du contrat de runtime, un bundle validé continue de fonctionner — voir [Compatibilité](/docs/architecture/runtime-and-bundles/#compatibility).
