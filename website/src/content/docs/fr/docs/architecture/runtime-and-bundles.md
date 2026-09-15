---
sourceHash: 67566dbd11f6e659
title: Runtime et bundles
sidebar_label: Runtime & Bundles
description: Comment un projet Rebase se divise en un bundle de projet et un runtime versionné, et pourquoi cette séparation rend possibles les mises à niveau, les applications multi-dépôts et l'hébergement géré.
---

## Les deux moitiés d'un déploiement

Un déploiement Rebase se compose de deux éléments, et non d'un seul :

- **Le bundle** — votre projet. Les collections compilées, les hooks, les fonctions et les
  tâches cron, ainsi qu'un manifeste généré décrivant leurs besoins.
- **Le runtime** — le moteur. `@rebasepro/server`, distribué sous la forme de l'image de conteneur
  publiée `rebasepro/server`.

Ils sont construits, versionnés et livrés séparément. C'est de cette unique décision
que découle tout le reste de cette page : le moteur n'étant pas intégré à l'image de
votre application, il peut être remplacé sous votre projet — pour un correctif de
sécurité, une amélioration des performances ou une nouvelle fonctionnalité — sans avoir
à recompiler quoi que ce soit de ce que vous avez écrit.

```
  your repository                 built artifact              running container
  ───────────────                 ──────────────              ─────────────────
  config/collections/*.ts   ──►   dist-bundle/config/     ──►  rebasepro/server
  backend/functions/*.ts          dist-bundle/backend/         + /bundle mounted
  rebase.json                     dist-bundle/manifest.json
```

Le runtime que vous auto-hébergez est le même que celui exécuté par Rebase Cloud. Il n'existe pas
de build « plateforme » distinct, et aucune fonctionnalité de l'offre managée n'est
inaccessible à une personne exécutant `docker compose up`.

## Construire un bundle

```bash
rebase build
```

Cette commande régénère le schéma de base de données à partir de vos collections, vérifie les types
et les compile, résout les spécificateurs d'importation pour que Node puisse charger la sortie directement,
et écrit `dist-bundle/` contenant :

| Chemin | Description |
| --- | --- |
| `manifest.json` | Généré. Le contrat que ce bundle prétend satisfaire. |
| `package.json` | Généré. Les dépendances d'exécution de votre projet. |
| `config/` | Collections compilées. |
| `backend/functions/` | Fonctions serveur compilées. |
| `backend/crons/` | Tâches cron compilées. |
| `backend/src/schema.generated.js` | Schéma de base de données compilé. |

Le manifeste mérite d'être compris, car c'est ce qu'un runtime valide
avant d'accepter de démarrer :

```jsonc
{
  "bundleFormat": 2,
  "runtime": { "range": "^1", "builtAgainst": "0.21.1", "contract": 1 },
  "schemaVersion": "v1:c5d97d0f96b7f87a",
  "kind": "backend",
  "entry": {
    "config": "config",
    "functions": "backend/functions",
    "static": [{ "path": "/", "dir": "static/admin", "spa": true }]
  },
  "hooks": { "native": false },
  "deps": { "declared": { "zod": "^4.4.3" } }
}
```

`kind` est soit `backend` — démarrer le serveur, ainsi que toutes les applications statiques
dans `entry.static` — soit `static`, qui sert ces ressources et rien d'autre : pas de
base de données, pas d'authentification. Qu'un backend déclare ses collections dans le code ou
les introspecte depuis la base de données active ne constitue pas un troisième type ; il s'agit
simplement de savoir si `entry.config` est présent ou non.

## Exécuter un bundle

```bash
rebase start                       # locally
docker run -v ./dist-bundle:/bundle rebasepro/server   # anywhere
```

`rebase start` charge le bundle dans le même processus, de sorte que les signaux et les traces
d'appels vous parviennent directement. En local, il lie vos dépendances déjà installées
dans le bundle afin d'éviter une seconde installation ; un déploiement installe à la place
le propre `package.json` du bundle.

## Compatibilité

Deux numéros de version déterminent si un bundle et un runtime peuvent fonctionner ensemble,
et ils sont délibérément distincts de la version du package.

**`bundleFormat`** est la disposition sur le disque. Un runtime accepte tout bundle dont le
format est inférieur ou égal au sien, et refuse un format plus récent plutôt que de le
charger à moitié. Un ancien bundle sur un runtime plus récent doit continuer de fonctionner — c'est
tout l'intérêt de cette séparation, ainsi un runtime sait lire chaque format qu'il a
un jour distribué. Les bundles au format 1, qui nommaient ce champ `mode` et comportaient un
seul répertoire statique, démarrent toujours sans modification.

**`runtime.contract`** est l'interface entre un bundle et le moteur. Au sein d'une même
version majeure de contrat, tout bundle qui a été validé continue d'être valide. Les correctifs
et versions mineures s'intègrent sans modification ; ce n'est pas le cas d'une version majeure,
et un runtime refusera un bundle issu d'une version différente plutôt que de démarrer et de
mal fonctionner plus tard.

C'est pourquoi mettre à niveau Rebase dans un déploiement auto-hébergé se résume à un changement de tag :

```yaml
image: rebasepro/server:0.21.1   # a newer tag — your bundle is untouched
```

## Le développement emprunte le même chemin

`rebase dev` démarre le même runtime directement sur votre code source TypeScript au lieu d'un
bundle compilé. Le rechargement à chaud fonctionne toujours, et le développement préfigure
la production car les deux passent par un seul et même chemin de démarrage plutôt que par
deux implémentations qui dérivent l'une de l'autre.

Un projet qui nécessite quelque chose que le runtime standard ne gère pas peut toujours écrire son
propre `backend/src/index.ts` et importer le serveur en tant que bibliothèque. `rebase dev`
le détecte et l'exécute. Voir [Serveur personnalisé](/docs/backend/custom-server/) — vous
perdez le runtime standard, mais pas la surface de l'API.

## Ce que le runtime lit depuis l'environnement

Le runtime est entièrement configuré par des variables d'environnement, car c'est le point
sur lequel toutes les cibles de déploiement s'accordent.

| Variable | Signification |
| --- | --- |
| `DATABASE_URL` | Chaîne de connexion pour la base de données par défaut. Requis. |
| `JWT_SECRET` | Secret de signature, d'au moins 32 caractères. Requis en production. |
| `CORS_ORIGINS` | Origines séparées par des virgules autorisées à appeler l'API. Requis en production. |
| `PORT` | Port d'écoute. Par défaut `3001` en local, `8080` dans l'image. |
| `REBASE_SERVICE_KEY` | Clé de serveur à serveur accordant un accès administrateur. |
| `REBASE_METRICS` | `true` pour exposer les métriques Prometheus sur `/metrics`. |
| `REBASE_MIGRATE_ON_BOOT` | `none` laisse le schéma intact ; toute autre valeur — y compris non définie — exécute la passe de provisionnement additive. Défini par défaut sur `ensure` partout, production comprise. |
| `REBASE_SERVE_STATIC` | Sert les ressources statiques du bundle depuis ce processus. Activé par défaut. |

La configuration de plusieurs bases de données et de plusieurs buckets s'effectue en suffixant la variable
avec la clé de la source — voir [Bases de données et buckets multiples](/docs/backend/multiple-sources/).

## Points de terminaison toujours servis par le runtime

| Chemin | Rôle |
| --- | --- |
| `GET /health` | État de préparation (Readiness). Effectue un aller-retour avec la base de données. |
| `GET /livez` | État de vivacité (Liveness). Ne touche délibérément *pas* à la base de données, afin qu'un dysfonctionnement temporaire de la base ne pousse pas un orchestrateur à tuer un processus sain. |
| `GET /api/meta/schema-version` | La version actuelle du schéma. Sans authentification — il s'agit d'une empreinte de version, pas d'un schéma. |
| `GET /api/meta/contract` | Le contrat complet de la collection. Réservé aux administrateurs. |
| `GET /metrics` | Métriques Prometheus, lorsque `REBASE_METRICS=true`. |
