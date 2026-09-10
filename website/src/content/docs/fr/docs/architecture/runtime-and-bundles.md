---
sourceHash: 236f1a01516e7d29
title: Runtime et bundles
sidebar_label: Runtime & Bundles
description: Comment un projet Rebase se divise en un bundle de projet et un runtime versionné, et pourquoi cette séparation rend possibles les mises à niveau, les applications multi-dépôts et l'hébergement géré.
---

## Les deux moitiés d'un déploiement

Un déploiement Rebase est composé de deux éléments, et non d'un seul :

- **Le bundle** — votre projet. Collections, hooks, fonctions et tâches cron
  compilés, ainsi qu'un manifeste généré décrivant leurs besoins.
- **Le runtime** — le moteur. `@rebasepro/server`, distribué sous la forme
  de l'image de conteneur publiée `rebasepro/server`.

Ils sont construits, versionnés et livrés séparément. C'est de cette décision
unique que découle tout le reste de cette page : parce que le moteur n'est pas
intégré dans l'image de votre application, il peut être remplacé sous votre
projet — pour un correctif de sécurité, une amélioration des performances ou
une nouvelle fonctionnalité — sans avoir à recompiler quoi que ce soit de ce
que vous avez écrit.

```
  your repository                 built artifact              running container
  ───────────────                 ──────────────              ─────────────────
  config/collections/*.ts   ──►   dist-bundle/config/     ──►  rebasepro/server
  backend/functions/*.ts          dist-bundle/backend/         + /bundle mounted
  rebase.json                     dist-bundle/manifest.json
```

Le runtime que vous auto-hébergez est le même runtime que celui exécuté par
Rebase Cloud. Il n'existe pas de version « plateforme » distincte, et rien de
l'offre gérée n'est inaccessible à quelqu'un qui exécute `docker compose up`.

## Construire un bundle

```bash
rebase build
```

Cela régénère le schéma de base de données à partir de vos collections, vérifie
les types et les compile, résout les spécificateurs d'importation pour que Node
puisse charger directement la sortie, et génère `dist-bundle/` contenant :

| Chemin | Description |
| --- | --- |
| `manifest.json` | Généré. Le contrat que ce bundle affirme respecter. |
| `package.json` | Généré. Les dépendances d'exécution de votre projet. |
| `config/` | Collections compilées. |
| `backend/functions/` | Fonctions serveur compilées. |
| `backend/crons/` | Tâches cron compilées. |
| `backend/src/schema.generated.js` | Schéma de base de données compilé. |

Il est utile de comprendre le manifeste, car c'est ce qu'un runtime valide avant
d'accepter de démarrer :

```jsonc
{
  "bundleFormat": 2,
  "runtime": { "range": "^1", "builtAgainst": "0.20.0", "contract": 1 },
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

`kind` vaut soit `backend` — démarrer le serveur, ainsi que toute application
statique dans `entry.static` — soit `static`, qui sert ces assets et rien
d'autre : pas de base de données, pas d'authentification. Le fait qu'un backend
déclare ses collections dans le code ou les introspecte depuis la base de
données active ne constitue pas un troisième type ; il s'agit simplement de
savoir si `entry.config` est présent ou non.

## Exécuter un bundle

```bash
rebase start                       # locally
docker run -v ./dist-bundle:/bundle rebasepro/server   # anywhere
```

`rebase start` charge le bundle dans le processus même, de sorte que les
signaux et les traces d'appels vous parviennent directement. En local, il lie
vos dépendances déjà installées au bundle afin d'éviter une seconde
installation ; un déploiement installe plutôt le propre `package.json` du
bundle.

## Compatibilité

Deux numéros de version régissent la compatibilité entre un bundle et un
runtime, et il ne s'agit délibérément pas de la version du package.

**`bundleFormat`** correspond à la disposition sur disque. Un runtime accepte
tout bundle dont le format est inférieur ou égal au sien, et refuse un format
plus récent plutôt que de le charger partiellement. Un bundle plus ancien sur un
runtime plus récent doit continuer à fonctionner — c'est tout l'intérêt de cette
séparation, ainsi un runtime lit tous les formats qu'il a jamais pris en charge.
Les bundles de format 1, qui nommaient ce champ `mode` et comportaient un
unique répertoire statique, démarrent toujours sans modification.

**`runtime.contract`** est l'interface entre un bundle et le moteur. Au sein
d'une même version majeure de contrat, tout bundle qui a été validé continue
d'être validé. Les versions mineures et les correctifs sont directement
interchangeables ; ce n'est pas le cas des versions majeures, et un runtime
refusera un bundle issu d'une version majeure différente plutôt que de démarrer
et de mal fonctionner par la suite.

C'est pourquoi la mise à niveau de Rebase dans un déploiement auto-hébergé se
résume à un changement de tag :

```yaml
image: rebasepro/server:0.20.0   # a newer tag — your bundle is untouched
```

## Le développement utilise le même chemin

`rebase dev` démarre le même runtime sur votre code source TypeScript au lieu
d'un bundle compilé. Le rechargement à chaud fonctionne toujours, et le
développement reflète fidèlement la production car tous deux passent par un
chemin d'initialisation unique plutôt que par deux implémentations qui
divergent.

Un projet nécessitant une fonctionnalité non couverte par le runtime standard
peut toujours écrire son propre fichier `backend/src/index.ts` et importer le
serveur en tant que bibliothèque. `rebase dev` le détecte et l'exécute.
Consultez [Serveur personnalisé](/docs/backend/custom-server/) — vous perdez le
runtime standard, mais pas la surface d'API.

## Ce que le runtime lit depuis l'environnement

Le runtime est entièrement configuré par des variables d'environnement, car c'est
le point d'accord de toutes les cibles de déploiement.

| Variable | Description |
| --- | --- |
| `DATABASE_URL` | Chaîne de connexion pour la base de données par défaut. Requis. |
| `JWT_SECRET` | Secret de signature, d'au moins 32 caractères. Requis en production. |
| `CORS_ORIGINS` | Origines séparées par des virgules autorisées à appeler l'API. Requis en production. |
| `PORT` | Port d'écoute. Par défaut `3001` en local, `8080` dans l'image. |
| `REBASE_SERVICE_KEY` | Clé serveur à serveur accordant un accès administrateur. |
| `REBASE_METRICS` | `true` pour exposer les métriques Prometheus sur `/metrics`. |
| `REBASE_MIGRATE_ON_BOOT` | `none` ne touche pas au schéma ; toute autre valeur — y compris non définie — exécute la passe de provisionnement additif. Vaut par défaut `ensure` partout, y compris en production. |
| `REBASE_SERVE_STATIC` | Servir les assets statiques du bundle depuis ce processus. Activé par défaut. |

La configuration de plusieurs bases de données et de plusieurs buckets se fait
en suffixant la variable par la clé de source — consultez [Bases de données et
buckets multiples](/docs/backend/multiple-sources/).

## Endpoints toujours servis par le runtime

| Chemin | Rôle |
| --- | --- |
| `GET /health` | Préparation (Readiness). Effectue un aller-retour avec la base de données. |
| `GET /livez` | Vivacité (Liveness). Ne sollicite délibérément *pas* la base de données, afin qu'un micro-incident de base de données n'amène pas un orchestrateur à tuer un processus sain. |
| `GET /api/meta/schema-version` | La version actuelle du schéma. Non authentifié — il s'agit d'une estampille de version, pas d'un schéma. |
| `GET /api/meta/contract` | Le contrat complet des collections. Administrateur uniquement. |
| `GET /metrics` | Métriques Prometheus, lorsque `REBASE_METRICS=true`. |

---
