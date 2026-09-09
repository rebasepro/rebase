---
sourceHash: a4b27cb5ae61a96e
title: Runtime et Bundles
sidebar_label: Runtime & Bundles
description: Comment un projet Rebase se divise en un bundle de projet et un runtime versionné, et pourquoi cette séparation rend possibles les mises à niveau, les applications multi-dépôts et l'hébergement géré.
---

## Les deux moitiés d'un déploiement

Un déploiement Rebase se compose de deux éléments, et non d'un seul :

- **Le bundle** — votre projet. Collections compilées, hooks, fonctions et tâches cron, accompagnés d'un manifeste généré décrivant leurs besoins.
- **Le runtime** — le moteur. `@rebasepro/server`, distribué sous la forme de l'image de conteneur publiée `rebasepro/server`.

Ils sont construits, versionnés et livrés séparément. C'est de cette unique décision que découle tout le reste de cette page : le moteur n'étant pas intégré à l'image de votre application, il peut être remplacé sous votre projet — pour un correctif de sécurité, une amélioration des performances ou une nouvelle fonctionnalité — sans avoir à recompiler quoi que ce soit de ce que vous avez écrit.

```
  your repository                 built artifact              running container
  ───────────────                 ──────────────              ─────────────────
  config/collections/*.ts   ──►   dist-bundle/config/     ──►  rebasepro/server
  backend/functions/*.ts          dist-bundle/backend/         + /bundle mounted
  rebase.json                     dist-bundle/manifest.json
```

Le runtime que vous auto-hébergez est le même runtime que celui exécuté par Rebase Cloud. Il n'y a pas de build « plateforme » distinct, et aucune fonctionnalité de l'offre managée n'est inaccessible à une personne exécutant `docker compose up`.

## Construire un bundle

```bash
rebase build
```

Cela régénère le schéma de base de données à partir de vos collections, vérifie les types et les compile, résout les spécificateurs d'importation pour que Node puisse charger directement la sortie, et génère `dist-bundle/` contenant :

| Chemin | Description |
| --- | --- |
| `manifest.json` | Généré. Le contrat que ce bundle affirme satisfaire. |
| `package.json` | Généré. Les dépendances d'exécution de votre projet. |
| `config/` | Collections compilées. |
| `backend/functions/` | Fonctions serveur compilées. |
| `backend/crons/` | Tâches cron compilées. |
| `backend/src/schema.generated.js` | Schéma de base de données compilé. |

Le manifeste mérite d'être compris, car c'est ce qu'un runtime valide avant d'accepter de démarrer :

```jsonc
{
  "bundleFormat": 2,
  "runtime": { "range": "^1", "builtAgainst": "0.19.1", "contract": 1 },
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

`kind` vaut soit `backend` — démarre le serveur, ainsi que toutes les applications statiques dans `entry.static` — soit `static`, qui sert ces assets et rien d'autre : pas de base de données, pas d'authentification. Le fait qu'un backend déclare ses collections dans le code ou les introspecte depuis la base de données active ne constitue pas un troisième type ; il s'agit simplement de savoir si `entry.config` est présent ou non.

## Exécuter un bundle

```bash
rebase start                       # locally
docker run -v ./dist-bundle:/bundle rebasepro/server   # anywhere
```

`rebase start` charge le bundle dans le même processus, de sorte que les signaux et les traces de la pile (stack traces) vous parviennent directement. En local, il lie vos dépendances déjà installées dans le bundle pour éviter une deuxième installation ; un déploiement installe quant à lui le `package.json` propre au bundle.

## Compatibilité

Deux numéros de version déterminent si un bundle et un runtime peuvent fonctionner ensemble, et il ne s'agit délibérément pas de la version du package.

**`bundleFormat`** correspond à la structure sur le disque. Un runtime accepte tout bundle dont le format est inférieur ou égal au sien, et refuse un format plus récent plutôt que de le charger partiellement. Un ancien bundle sur un runtime plus récent doit continuer à fonctionner — c'est tout l'intérêt de la séparation, un runtime lit donc chaque format qu'il a déjà pris en charge. Les bundles de Format 1, qui nommaient ce champ `mode` et comportaient un seul répertoire statique, démarrent toujours sans modification.

**`runtime.contract`** est l'interface entre un bundle et le moteur. Au sein d'une même version majeure de contrat, tout bundle valide continue d'être validé. Les correctifs (patches) et versions mineures s'intègrent sans modification (drop-in) ; ce n'est pas le cas d'une version majeure, et un runtime refusera un bundle issu d'une version majeure différente plutôt que de démarrer et de présenter des dysfonctionnements ultérieurs.

C'est pourquoi la mise à niveau de Rebase dans un déploiement auto-hébergé se résume à un changement de tag :

```yaml
image: rebasepro/server:0.19.1   # a newer tag — your bundle is untouched
```

## Le développement utilise le même chemin

`rebase dev` démarre le même runtime sur votre code source TypeScript plutôt que sur un bundle compilé. Le rechargement à chaud (hot reload) fonctionne toujours, et le développement reflète fidèlement la production, car tous deux empruntent un chemin d'initialisation unique au lieu de deux implémentations risquant de diverger.

Un projet nécessitant une fonctionnalité non prise en charge par le runtime standard peut toujours écrire son propre `backend/src/index.ts` et importer le serveur comme une bibliothèque. `rebase dev` le détecte et l'exécute. Consultez [Serveur personnalisé](/docs/backend/custom-server/) — vous perdez le runtime standard, mais pas la surface d'API.

## Ce que le runtime lit depuis l'environnement

Le runtime est entièrement configuré par des variables d'environnement, car c'est le standard commun à toutes les cibles de déploiement.

| Variable | Signification |
| --- | --- |
| `DATABASE_URL` | Chaîne de connexion pour la base de données par défaut. Obligatoire. |
| `JWT_SECRET` | Secret de signature, au moins 32 caractères. Obligatoire en production. |
| `CORS_ORIGINS` | Origines séparées par des virgules autorisées à appeler l'API. Obligatoire en production. |
| `PORT` | Port à écouter. Par défaut `3001` en local, `8080` dans l'image. |
| `REBASE_SERVICE_KEY` | Clé de serveur à serveur accordant un accès administrateur. |
| `REBASE_METRICS` | `true` pour exposer les métriques Prometheus sur `/metrics`. |
| `REBASE_MIGRATE_ON_BOOT` | `none` laisse le schéma inchangé ; toute autre valeur — y compris non définie — exécute la passe de provisionnement additif. Défini par défaut sur `ensure` partout, y compris en production. |
| `REBASE_SERVE_STATIC` | Sert les assets statiques du bundle depuis ce processus. Activé par défaut. |

Plusieurs bases de données et plusieurs buckets sont configurés en suffixant la variable par la clé de la source — voir [Bases de données et buckets multiples](/docs/backend/multiple-sources/).

## Points de terminaison toujours servis par le runtime

| Chemin | Rôle |
| --- | --- |
| `GET /health` | Disponibilité (readiness). Effectue un aller-retour avec la base de données. |
| `GET /livez` | Vivacité (liveness). Ne contacte délibérément *pas* la base de données, afin qu'un incident passager sur la base ne pousse pas un orchestrateur à tuer un processus sain. |
| `GET /api/meta/schema-version` | La version actuelle du schéma. Non authentifié — il s'agit d'un horodatage de version, pas d'un schéma. |
| `GET /api/meta/contract` | Le contrat complet des collections. Réservé aux administrateurs. |
| `GET /metrics` | Métriques Prometheus, lorsque `REBASE_METRICS=true`. |

---
