---
title: Runtime et Bundles
sidebar_label: Runtime & Bundles
description: Comment un projet Rebase se divise en un bundle de projet et un runtime versionné, et pourquoi cette séparation rend possibles les mises à niveau, les applications multi-dépôts et l'hébergement géré.
---

## Les deux moitiés d'un déploiement

Un déploiement Rebase se compose de deux éléments, et non d'un seul :

- **Le bundle** — votre projet. Collections compilées, hooks, fonctions et tâches cron, plus un manifeste généré décrivant ce dont ils ont besoin.
- **Le runtime** — le moteur. `@rebasepro/server`, livré sous forme d'image de conteneur publiée `rebasepro/server`.

Ils sont construits, versionnés et livrés séparément. C'est cette décision unique qui régit tout le reste de cette page : le moteur n'étant pas intégré directement dans l'image de votre application, il peut être remplacé sous votre projet — pour un correctif de sécurité, une amélioration de performances ou une nouvelle fonctionnalité — sans avoir à recompiler quoi que ce soit de ce que vous avez écrit.

```
  your repository                 built artifact              running container
  ───────────────                 ──────────────              ─────────────────
  config/collections/*.ts   ──►   dist-bundle/config/     ──►  rebasepro/server
  backend/functions/*.ts          dist-bundle/backend/         + /bundle mounted
  rebase.json                     dist-bundle/manifest.json
```

Le runtime que vous hébergez vous-même est exactement le même que celui exécuté par Rebase Cloud. Il n'y a pas de build « plateforme » séparé, et aucune fonctionnalité de l'offre gérée n'est indisponible pour quelqu'un qui exécute `docker compose up`.

## Construire un bundle

```bash
rebase build
```

Cela régénère le schéma de la base de données à partir de vos collections, vérifie les types et les compile, résout les spécificateurs d'importation pour que Node puisse charger directement le résultat, et crée le répertoire `dist-bundle/` contenant :

| Chemin | Description |
| --- | --- |
| `manifest.json` | Généré. Le contrat que ce bundle prétend satisfaire. |
| `package.json` | Généré. Les dépendances d'exécution (runtime) de votre projet. |
| `config/` | Collections compilées. |
| `backend/functions/` | Fonctions serveur compilées. |
| `backend/crons/` | Tâches cron compilées. |
| `backend/src/schema.generated.js` | Schéma de base de données compilé. |

Il est important de comprendre le rôle du manifeste, car c'est ce qu'un runtime valide avant d'accepter de démarrer :

```jsonc
{
  "bundleFormat": 2,
  "runtime": { "range": "^1", "builtAgainst": "0.17.3", "contract": 1 },
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

`kind` vaut soit `backend` — démarre le serveur, ainsi que toutes les applications statiques dans `entry.static` — soit `static`, qui sert ces fichiers statiques et rien d'autre : pas de base de données, pas d'authentification. Le fait qu'un backend déclare ses collections dans le code ou les introspecte à partir de la base de données en direct ne constitue pas un troisième type ; il s'agit simplement de savoir si `entry.config` est présent.

## Exécuter un bundle

```bash
rebase start                       # locally
docker run -v ./dist-bundle:/bundle rebasepro/server   # anywhere
```

`rebase start` charge le bundle au sein du même processus, de sorte que les signaux et les traces d'exécution (stack traces) vous parviennent directement. En local, il lie vos dépendances déjà installées au bundle pour éviter une seconde installation ; un déploiement installe quant à lui le `package.json` propre au bundle.

## Compatibilité

Deux numéros de version déterminent si un bundle et un runtime peuvent fonctionner ensemble, et ils ne correspondent volontairement pas à la version du package.

**`bundleFormat`** représente la structure sur disque. Un runtime accepte tout bundle dont le format est inférieur ou égal au sien, et refuse un bundle plus récent plutôt que de le charger partiellement. Un bundle plus ancien sur un runtime plus récent doit continuer à fonctionner — c'est tout l'intérêt de cette séparation, donc un runtime lit tous les formats qu'il a publiés jusqu'ici. Les bundles de format 1, qui nommaient ce champ `mode` et contenaient un seul répertoire statique, démarrent toujours sans modification.

**`runtime.contract`** est l'interface entre un bundle et le moteur. Au sein d'une même version majeure du contrat, tout bundle qui a été validé continue d'être validé. Les versions patchs et mineures sont interchangeables ; ce n'est pas le cas d'une version majeure, et un runtime refusera un bundle issu d'un contrat majeur différent plutôt que de démarrer et de dysfonctionner plus tard.

C'est pourquoi la mise à niveau de Rebase dans un déploiement auto-hébergé se résume à un changement de tag :

```yaml
image: rebasepro/server:0.17.3   # a newer tag — your bundle is untouched
```

## Le développement utilise le même chemin

`rebase dev` démarre le même runtime directement sur votre code source TypeScript au lieu d'un bundle compilé. Le rechargement à chaud (hot reload) fonctionne toujours, et le développement reflète fidèlement la production car tous deux empruntent le même chemin de démarrage au lieu de deux implémentations risquant de diverger.

Un projet nécessitant une fonctionnalité non couverte par le runtime standard peut toujours écrire son propre `backend/src/index.ts` et importer le serveur en tant que bibliothèque. `rebase dev` le détectera et l'exécutera. Voir [Serveur personnalisé](/docs/backend/custom-server/) — vous perdez le runtime standard, mais pas la surface d'API.

## Ce que le runtime lit dans l'environnement

Le runtime est entièrement configuré par des variables d'environnement, car c'est le standard accepté par toutes les cibles de déploiement.

| Variable | Signification |
| --- | --- |
| `DATABASE_URL` | Chaîne de connexion pour la base de données par défaut. Requis. |
| `JWT_SECRET` | Secret de signature, d'au moins 32 caractères. Requis en production. |
| `CORS_ORIGINS` | Origines séparées par des virgules autorisées à appeler l'API. Requis en production. |
| `PORT` | Port d'écoute. Par défaut `3001` en local, `8080` dans l'image. |
| `REBASE_SERVICE_KEY` | Clé serveur à serveur accordant l'accès administrateur. |
| `REBASE_METRICS` | `true` pour exposer les métriques Prometheus sur `/metrics`. |
| `REBASE_MIGRATE_ON_BOOT` | `ensure` (la valeur par défaut, y compris en production) exécute la passe **additive** : créer les tables, colonnes et types enum manquants, sans jamais en supprimer ni en réécrire. `none` ne touche à rien. L'image publiée n'accepte que ces deux valeurs et **refuse de démarrer sur `push`**. |
| `REBASE_SERVE_STATIC` | Sert les ressources statiques du bundle depuis ce processus. Activé par défaut. |

Plusieurs bases de données et plusieurs buckets sont configurés en ajoutant la clé de la source en suffixe de la variable — voir [Bases de données et buckets multiples](/docs/backend/multiple-sources/).

## Endpoints toujours servis par le runtime

| Chemin | Objectif |
| --- | --- |
| `GET /health` | Disponibilité (Readiness). Effectue un aller-retour avec la base de données. |
| `GET /livez` | État de santé (Liveness). N'interroge volontairement *pas* la base de données, afin qu'une micro-coupure de la base ne pousse pas l'orchestrateur à tuer un processus sain. |
| `GET /api/meta/schema-version` | La version actuelle du schéma. Non authentifié — il s'agit d'un identifiant de version, pas d'un schéma. |
| `GET /api/meta/contract` | Le contrat de collection complet. Réservé aux administrateurs. |
| `GET /metrics` | Métriques Prometheus, lorsque `REBASE_METRICS=true`. |
