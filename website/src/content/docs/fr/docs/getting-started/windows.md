---
sourceHash: 3f66e135e36c529b
title: Windows
sidebar_label: Windows
description: Installer et exécuter un projet Rebase sous Windows — ce qui fonctionne nativement, le seul outil (Atlas) nécessitant son propre binaire Windows pour db push, db generate et db migrate, et quand utiliser WSL2 à la place.
---

Un projet Rebase s'installe et s'exécute sous Windows. Un outil nécessite une étape supplémentaire :
[Atlas](https://atlasgo.io/), le moteur qui planifie les migrations de schéma. Son
paquet npm, `@ariga/atlas`, ne fournit que des builds pour Linux et macOS ; sous Windows,
vous devez donc installer le binaire Windows propre à Atlas.

Seules trois commandes utilisent Atlas : [`rebase db push`, `rebase db generate` et
`rebase db migrate`](/docs/cli/database/#commands). L'exécution de l'application ne l'utilise pas. `rebase dev` crée les
tables et colonnes manquantes au démarrage sans celui-ci, vous pouvez donc commencer à développer avant
de l'installer.

La CI de Rebase s'exécute sous Linux et macOS. Si vous souhaitez que votre machine corresponde
exactement à un serveur Linux, utilisez plutôt [WSL2](#alternative--wsl2).

## 1. Prérequis

- **Node.js** 22.22+ et **pnpm**, comme indiqué dans le [Démarrage rapide](/docs/getting-started/quickstart/#prerequisites)
- PowerShell, pour l'étape Atlas ci-dessous

## 2. Créer le projet

```bash
pnpm dlx @rebasepro/cli init my-app
```

L'installation affiche un échec de `preinstall` pour `@ariga/atlas`, avec
`Unsupported platform`, puis se termine. C'est normal. Le scaffold
déclare `@ariga/atlas` en tant que dépendance optionnelle, donc sur une plateforme
où il ne peut pas s'installer, il est ignoré et l'installation se poursuit.

```bash
cd my-app
pnpm dev
```

Rien de plus n'est nécessaire. L'application, le panneau d'administration et la
base de données de développement gérée fonctionnent tous sans Atlas.

## 3. Installer Atlas pour les commandes de schéma

Téléchargez le binaire Windows d'Atlas, enregistrez-le sous le nom `atlas.exe` et ajoutez son dossier
à votre variable d'environnement `PATH` utilisateur. Dans PowerShell :

```powershell
$dir = "$env:LOCALAPPDATA\Programs\atlas"
New-Item -ItemType Directory -Force $dir | Out-Null
Invoke-WebRequest https://release.ariga.io/atlas/atlas-windows-amd64-v1.2.3.exe -OutFile "$dir\atlas.exe"
[Environment]::SetEnvironmentVariable("Path", [Environment]::GetEnvironmentVariable("Path", "User") + ";$dir", "User")
```

Ouvrez un nouveau terminal pour qu'il prenne en compte le nouveau `PATH`, puis vérifiez-le :

```powershell
atlas version
```

La version 1.2.3 est la version la plus ancienne acceptée par le scaffold (`"@ariga/atlas": "^1.2.3"`).
Sous Linux et macOS, l'installation prend la version 1.x la plus récente, donc toute version 1.x ultérieure
fonctionne également ici : modifiez simplement la version dans l'URL. Seule une version x64 est publiée ;
Windows on Arm l'exécute via l'émulation.

La CLI cherche d'abord dans `node_modules/.bin` puis interroge Windows (`where atlas`).
Ainsi, une fois `atlas.exe` dans le `PATH`, les trois commandes le trouvent :

```bash
pnpm run db:push
```

[`rebase doctor`](/docs/cli/#rebase-doctor) le vérifie également. Tant que `atlas.exe` n'est pas dans le `PATH`,
il émet un avertissement et renvoie vers cette page.

## Un projet créé auparavant

Un projet généré avec une version plus ancienne de `@rebasepro/cli` déclare `@ariga/atlas` sous
`dependencies`, et son installation échoue sous Windows avec
`ELIFECYCLE Command failed with exit code 1`. Déplacez-le dans `optionalDependencies`
dans `backend/package.json` :

```json
{
    "optionalDependencies": {
        "@ariga/atlas": "^1.2.3"
    }
}
```

Supprimez-le de `dependencies`, exécutez `pnpm install`, puis suivez
l'[étape 3](#3-installer-atlas-pour-les-commandes-de-schéma). Sous Linux et macOS, rien
ne change, car une dépendance optionnelle pouvant être installée est installée. Cela
inclut la CI et l'image de déploiement.

## Alternative : WSL2

[WSL2](https://learn.microsoft.com/windows/wsl/install) exécute une véritable
distribution Linux, de sorte que le paquet npm s'installe normalement et qu'aucune
des étapes ci-dessus ne s'applique. C'est également ce sur quoi s'exécute Docker Desktop.

Conservez le projet dans le système de fichiers Linux (`~/code/my-app`), et non sous
`/mnt/c/`. La lecture de fichiers à travers cette frontière ralentit les installations et le surveillant
de fichiers. Ouvrez le projet depuis Windows à l'aide de
l'[extension VS Code WSL](https://code.visualstudio.com/docs/remote/wsl), ou
via `\\wsl$\`.

## Pour aller plus loin

- [Démarrage rapide](/docs/getting-started/quickstart/) : la suite d'une première exécution, identique sur chaque plateforme
- [Commandes de base de données](/docs/cli/database/) : ce que font respectivement `db push`, `db generate` et `db migrate`
- [Dépannage](/docs/troubleshooting/) : les pannes qui empêchent un backend de démarrer, et à quoi chacune ressemble
