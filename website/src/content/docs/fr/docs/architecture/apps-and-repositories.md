---
title: Applications et dépôts
sidebar_label: Applications & dépôts
description: Un projet se compose d'un backend et des applications qui interagissent avec lui, chacune pouvant résider dans son propre dépôt.
---

## Projets et applications

Un **projet** est le backend : la base de données, l'authentification, le stockage, le temps réel et les fonctions. Une **application** (ou **app**) est ce qui communique avec lui.

| Type | Description |
| --- | --- |
| `backend` | Les collections, hooks et fonctions qui définissent l'API. Exactement un seul par projet. |
| `static` | Un bundle client compilé — une SPA ou un site statique, servi sur son propre chemin. |

C'est tout. Le panneau d'administration est une application `static` comme une autre : il est construit dans votre dépôt, en fonction de vos collections, ce qui explique pourquoi les champs personnalisés et les vues personnalisées y fonctionnent dès le premier jour.

Le propriétaire du processus serveur est une propriété du backend, et non un type d'application distinct :

| `runtime` | Signification |
| --- | --- |
| `managed` | L'image d'exécution (runtime) de la plateforme exécute votre bundle. Vous fournissez les collections, les fonctions, les crons et le schéma. |
| `custom` | Vous fournissez le serveur : votre propre Dockerfile et point d'entrée. `rebase eject` configure cela. |

Cela est indépendant de l'endroit *où* il s'exécute. Les deux fonctionnent sur Rebase Cloud et les deux peuvent être auto-hébergés — la destination se trouve dans `.rebase/cloud.json`, et non dans le manifeste.

L'élément important est de savoir qui *possède* la liste. Un dépôt déclare uniquement les applications qu'il contient ; le projet possède l'ensemble des applications existantes. Deux dépôts n'ont jamais besoin de se connaître — ils ont seulement besoin de connaître le projet. C'est ce qui fait qu'un dépôt frontend séparé, ou une application mobile n'ayant aucune relation avec le dépôt, est une chose ordinaire plutôt qu'un cas particulier.

## `rebase.json`

Le manifeste déclare la topologie, et rien d'autre. Le schéma, les règles de sécurité, les hooks et les fonctions restent en TypeScript où un système de typage peut les vérifier.

```jsonc
{
  "rebase": "^1",
  "apps": {
    "backend": { "type": "backend", "runtime": "managed" },
    "site": {
      "type": "static",
      "root": "frontend",
      "build": "npm run build --workspace frontend",
      "output": "frontend/dist",
      "path": "/"
    },
    "admin": {
      "type": "static",
      "root": "admin",
      "build": "npm run build --workspace admin",
      "output": "admin/dist",
      "path": "/admin"
    }
  }
}
```

Un seul processus sert l'ensemble : l'API sur `/api`, le site sur `/`, l'admin sur `/admin`. C'est le principe de l'auto-hébergement, et un très bon petit niveau sur Rebase Cloud.

`path` est un paramètre d'entrée au moment de la **compilation (build-time)** ainsi que pour le service. Une application montée sur `/admin` doit être *compilée* pour `/admin`, sinon `index.html` se charge et chaque ressource (asset) renvoie une erreur 404 — une page blanche sans aucune erreur affichée. `rebase build` transmet la valeur sous la forme `REBASE_APP_BASE`, que votre bundler lit comme son chemin de base :

```ts
// vite.config.ts
export default defineConfig({
  base: process.env.REBASE_APP_BASE ?? "/",
  // …
});
```

et refuse de livrer un build qui l'a ignoré.

Un projet existant n'en a pas besoin. La CLI déduit la même disposition à partir de la structure de répertoires, et `rebase apps init` la génère lorsque vous souhaitez la rendre explicite :

```bash
rebase apps list      # what this repository contributes
rebase apps init      # write an inferred rebase.json
```

## Compilation et déploiement des applications

```bash
rebase build              # every app in this repository
rebase build backend      # just the bundle
rebase build admin        # just that app's static assets
```

Le backend est compilé en premier, car la compilation d'une application client peut consommer un SDK généré à partir de ses collections.

## Dépôts multiples

Le monorepo reste le choix par défaut : un dépôt avec un backend et un panneau d'administration est la chose la plus simple qui fonctionne, et `rebase init` en crée la structure initiale. La séparation est une étape ultérieure d'évolution, pas une obligation.

Dans un dépôt frontend séparé, vous avez besoin de deux choses — un manifeste déclarant ce à quoi ce dépôt contribue, et un lien vers le projet :

```jsonc
// rebase.json
{
  "rebase": "^1",
  "apps": {
    "marketing": {
      "type": "static",
      "root": ".",
      "build": "npm run build",
      "output": "dist"
    }
  }
}
```

```bash
rebase cloud link https://api.example.com   # a self-hosted project
rebase cloud link                           # or pick a Rebase Cloud project
```

Le lien est écrit dans `.rebase/cloud.json` et n'est **pas commité** — il est propre à chaque copie de travail (checkout), comme un remote git. Le manifeste est commité ; le lien ne l'est pas.

## Clients typés sans les collections

C'est le mécanisme qui permet au multi-dépôt de fonctionner. Un dépôt qui ne contient aucune collection génère son SDK typé à partir du projet lui-même :

```bash
rebase generate-sdk --from link
rebase generate-sdk --from https://api.example.com --token $REBASE_SERVICE_KEY
```

La CLI récupère `/api/meta/contract`, reconstruit les définitions de collections — y compris les cibles de relation, dont le générateur de types a besoin pour déterminer si une clé étrangère est une chaîne de caractères ou un nombre — et génère exactement la même sortie qu'elle aurait produite à partir du code source local.

L'endpoint contract est réservé aux administrateurs. Les définitions de collections décrivent chaque table, colonne et relation du projet, y compris celles qu'aucune règle de sécurité n'exposerait jamais ; il s'agit d'une carte de la base de données, pas d'une documentation d'API publique.

## Détection des dérives

La séparation des dépôts vous coûte une chose essentielle à noter : une modification de schéma et le frontend qui l'utilise n'atterrissent plus dans le même commit. Le backend peut déployer un changement qui bloque un client compilé selon l'ancienne structure.

Chaque SDK généré enregistre le schéma dont il provient :

```ts
// src/rebase/schema.meta.ts — generated
export const SCHEMA_VERSION = "v1:c5d97d0f96b7f87a";
```

Et chaque projet publie son schéma actuel, sans authentification, car un tampon de version ne révèle rien sur le schéma qu'il représente :

```bash
curl -s https://api.example.com/api/meta/schema-version
# {"schemaVersion":"v1:c5d97d0f96b7f87a"}
```

Comparer les deux dans le CI transforme une incohérence silencieuse en une vérification échouée. Le tampon change lorsque les types générés pourraient changer — une nouvelle propriété, une relation modifiée — et délibérément *pas* lorsqu'un hook, une règle de sécurité ou une icône change, évitant ainsi les fausses alertes.

## Configuration client

```bash
rebase apps config web
```

Affiche ce dont un client a besoin pour accéder au projet. Il n'affiche jamais de secret : l'URL de l'API et l'identité publiable d'une application sont destinées à être embarquées dans le bundle client, et tout ce qui n'y est pas sécurisé n'a rien à faire dans une sortie qui finira dans un fichier `.env` commité.

---
