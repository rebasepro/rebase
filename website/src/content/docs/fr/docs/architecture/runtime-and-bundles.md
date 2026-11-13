---
sourceHash: 47f5760918cfd724
title: Runtime et bundles
sidebar_label: Runtime & Bundles
description: Comment un projet Rebase se divise en un bundle de projet et un runtime versionné, et pourquoi cette séparation est ce qui rend possibles les mises à niveau, les applications multi-dépôts et l'hébergement infogéré.
---

## Les deux moitiés d'un déploiement

<span class="since-badge" data-since="0.31">Depuis 0.31</span>

Un déploiement Rebase est composé de deux éléments, et non d'un seul :

- **Le bundle** — votre projet. Les tables compilées, hooks, fonctions et tâches
  cron, accompagnés d'un manifeste généré décrivant leurs besoins.
- **Le runtime** — le moteur. `@rebasepro/server`, distribué sous la forme de
  l'image de conteneur publiée `rebasepro/server`.

Ils sont construits, versionnés et livrés séparément. C'est de cette unique décision
que découle tout le reste de cette page : le moteur n'étant pas intégré directement
dans l'image de votre application, il peut être remplacé sous votre projet — pour un
correctif de sécurité, une amélioration des performances ou une nouvelle fonctionnalité —
sans avoir à recompiler quoi que ce soit de ce que vous avez écrit.

```
  your repository                 built artifact              running container
  ───────────────                 ──────────────              ─────────────────
  backend/schema/*.ts       ──►   dist-bundle/backend/schema/  ──►  rebasepro/server
  backend/functions/*.ts          dist-bundle/backend/             + /bundle mounted
  rebase.json                     dist-bundle/manifest.json
```

Le runtime que vous auto-hébergez est le même que celui exécuté par Rebase Cloud.
Il n'existe pas de build « plateforme » distinct, et rien de l'offre infogérée n'est
inaccessible à une personne exécutant `docker compose up`.

## Construire un bundle

```bash
rebase build
```

Cela régénère le schéma de base de données à partir de vos tables, vérifie les types
et les compile, résout les spécificateurs d'importation pour que Node puisse charger
directement le résultat, et écrit `dist-bundle/` contenant :

| Chemin | Ce que c'est |
| --- | --- |
| `manifest.json` | Généré. Le contrat que ce bundle prétend satisfaire. |
| `package.json` | Généré. Les dépendances de runtime de votre projet. |
| `backend/schema/` | Tables compilées : le fichier `index` qui les exporte, et un module par table. |
| `backend/resources.js`, `backend/storage.js`, `backend/hooks.js` | Les modules compilés que le runtime lit aux côtés des tables, lorsque le projet en dispose. |
| `backend/functions/` | Fonctions serveur compilées. |
| `backend/crons/` | Tâches cron compilées. |
| `backend/src/schema.generated.js` | Schéma de base de données compilé. |

Il est utile de comprendre le manifeste, car c'est ce qu'un runtime valide avant
d'accepter de démarrer :

```jsonc
{
  "bundleFormat": 3,
  "runtime": { "range": "^1", "builtAgainst": "0.30.1", "contract": 2 },
  "schemaVersion": "v2:3f0c9a1e7d2b5c48",
  "kind": "backend",
  "entry": {
    "tables": "backend/schema",
    "resources": "backend/resources.js",
    "storage": "backend/storage.js",
    "functions": "backend/functions",
    "static": [{ "path": "/", "dir": "static/admin", "spa": true }]
  },
  "tables": ["authors", "posts", "tags", "users"],
  "hooks": { "native": false },
  "storage": { "authorize": true },
  "deps": { "declared": { "zod": "^4.4.3" } }
}
```

<span class="since-badge" data-since="0.31">Depuis 0.31</span> `bundleFormat`
3 et contrat de runtime 2 : le schéma correspond à `entry.tables`, le répertoire
compilé `backend/schema`, aux côtés de `entry.resources`, `entry.storage` et
`entry.hooks`. `schemaVersion` commence par `v2:` — il est calculé à partir des
tables compilées.

`kind` vaut soit `backend` — démarrer le serveur, ainsi que toute application
statique dans `entry.static` — soit `static`, qui sert ces ressources et rien
d'autre : pas de base de données, pas d'authentification. Le fait qu'un backend
déclare ses tables dans le code ou les introspecte depuis la base de données en
direct ne constitue pas un troisième type ; il s'agit simplement de la présence
ou non de `entry.tables`.

## Exécuter un bundle

```bash
rebase start                       # locally
docker run -v ./dist-bundle:/bundle rebasepro/server   # anywhere
```

`rebase start` charge le bundle in-process, de sorte que les signaux et les
traces de la pile d'exécution (stack traces) vous parviennent directement. En
local, il lie vos dépendances déjà installées au bundle pour éviter une seconde
installation ; un déploiement installe quant à lui le propre `package.json`
du bundle.

## Compatibilité

<span class="since-badge" data-since="0.31">Depuis 0.31</span>

Deux numéros de version déterminent si un bundle et un runtime peuvent fonctionner
ensemble, et ils ne correspondent délibérément pas à la version du package.

**`bundleFormat`** correspond à la structure sur le disque. Un runtime refuse un format
plus récent plutôt que de le charger partiellement. Un bundle plus ancien sur un
runtime plus récent continue de fonctionner là où la structure le permet — c'est tout
l'intérêt de la séparation — à une exception près : **un bundle de format 1 ou de format 2
est refusé** par un runtime 0.31. Ces bundles contiennent `config/collections` — des
objets `defineCollection` — et un runtime qui ne lit que `backend/schema` n'a rien pour
les lire ; en démarrer un introspecterait la base de données au lieu de servir les tables
déclarées. Le refus indique la solution : exécutez
[`rebase migrate collections-to-tables`](/docs/cli/schema/#rebase-migrate) sur le
code source du projet, puis recompilez le bundle.

**`runtime.contract`** est l'interface entre un bundle et le moteur ; 0.31
l'a fait passer à `2`. Au sein d'une même version majeure de contrat, tout
bundle qui était valide continue de l'être. Les correctifs (patches) et versions
mineures sont interchangeables sans modification (drop-in) ; ce n'est pas le cas
d'une version majeure, et un runtime refusera un bundle issu d'une version majeure
différente plutôt que de démarrer et d'avoir un comportement anormal plus tard.

C'est pourquoi la mise à niveau de Rebase dans un déploiement auto-hébergé se résume
à un simple changement de tag :

```yaml
image: rebasepro/server:0.30.1   # a newer tag — your bundle is untouched
```

## Le développement utilise le même chemin

`rebase dev` démarre le même runtime sur votre code source TypeScript au lieu d'un
bundle compilé. Le rechargement à chaud fonctionne toujours, et le développement
reflète fidèlement la production car tous deux empruntent un unique chemin de démarrage
au lieu de deux implémentations qui dérivent.

Un projet qui a besoin d'un comportement que le runtime standard ne fournit pas
peut toujours écrire son propre `backend/src/index.ts` et importer le serveur sous
forme de bibliothèque. `rebase dev` le détecte et l'exécute. Consultez
[Serveur personnalisé](/docs/backend/custom-server/) — vous perdez le runtime standard,
pas l'ensemble de l'API.

## Ce que le runtime lit depuis l'environnement

Le runtime est entièrement configuré par des variables d'environnement, car c'est
sur ce point que toutes les cibles de déploiement s'accordent.

| Variable | Signification |
| --- | --- |
| `DATABASE_URL` | Chaîne de connexion pour la base de données par défaut. Obligatoire. |
| `JWT_SECRET` | Secret de signature, d'au moins 32 caractères. Obligatoire en production. |
| `CORS_ORIGINS` | Origines séparées par des virgules autorisées à appeler l'API. Obligatoire en production. |
| `PORT` | Port d'écoute. Par défaut `3001` en local, `8080` dans l'image. |
| `REBASE_SERVICE_KEY` | Clé de serveur à serveur accordant un accès administrateur. |
| `REBASE_METRICS` | `true` pour exposer les métriques Prometheus sur `/metrics`. |
| `REBASE_MIGRATE_ON_BOOT` | `ensure` — la valeur par défaut partout, y compris en production — exécute la passe de provisionnement additif ; `none` ne modifie pas le schéma. Toute autre valeur refuse de démarrer, et l'image du runtime refuse également `push`. |
| `REBASE_SERVE_STATIC` | Sert les ressources statiques du bundle depuis ce processus. Activé par défaut. |

Plusieurs bases de données et plusieurs buckets sont configurés en suffixant la variable
par la clé de source — consultez [Bases de données et buckets multiples](/docs/backend/multiple-sources/).

## Points de terminaison toujours servis par le runtime

| Chemin | Objectif |
| --- | --- |
| `GET /health` | Préparation (readiness). Effectue un aller-retour avec la base de données. |
| `GET /livez` | Vivacité (liveness). Ne contacte délibérément *pas* la base de données, afin qu'un incident temporaire sur celle-ci ne pousse pas un orchestrateur à tuer un processus sain. |
| `GET /api/meta/schema-version` | La version actuelle du schéma. Sans authentification — il s'agit d'une estampille de version, pas d'un schéma. |
| `GET /api/schema/tables` | Les tables, telles que chaque appelant peut les voir — ce à partir de quoi le panneau d'administration effectue le rendu. Consultez [Endpoints](/docs/backend/endpoints/#schema). |
| `GET /api/meta/contract` | La version du schéma, le runtime, et chaque table telle qu'un administrateur la voit. Nécessite `schema:read`. |
| `GET /metrics` | Métriques Prometheus, lorsque `REBASE_METRICS=true`. |
