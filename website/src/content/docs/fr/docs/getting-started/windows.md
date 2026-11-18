---
sourceHash: 79e9278ca30f0078
title: Windows
sidebar_label: Windows
description: Installer un projet Rebase et utiliser ses commandes de base de données sous Windows.
---

**Rebase 0.34+**

Les projets Rebase fonctionnent sous Windows. Le modèle installe Ptah Compat,
y compris son exécutable Windows, avec le gestionnaire de paquets. Aucun
outil de migration supplémentaire n'est à télécharger.

## Créer un projet

Installez Node.js 22.22+ et pnpm, puis exécutez :

```bash
pnpm dlx @rebasepro/cli init my-app
cd my-app
pnpm dev
```

Les commandes de base de données utilisent le paquet Ptah Compat installé :

```bash
pnpm run db:push
pnpm run db:generate
pnpm run db:migrate
```

Le paquet fournit des exécutables natifs pour Windows x64 et Arm64. Si
[`rebase doctor`](/docs/cli/#rebase-doctor) signale un exécutable manquant,
réinstallez les dépendances du projet en activant les dépendances facultatives.

## Mettre à niveau un projet PostgreSQL vers Rebase 0.34

Exécutez la CLI de Rebase 0.34 à la racine du projet sous Linux, macOS ou Windows.
Elle remplace `@ariga/atlas` par `@stokaro/ptah-compat` dans le backend PostgreSQL.
Les fichiers de migration, `atlas.sum` et les révisions enregistrées sont
conservés.

```bash
pnpm dlx @rebasepro/cli@0.34.0 upgrade --to 0.34.0 # version-pin: ignore
```

## Rebase 0.33 et versions précédentes

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

### Si l’installation d’un ancien projet échoue

Si l’installation d’un ancien projet échoue avec `ELIFECYCLE`, déplacez
`@ariga/atlas` de `dependencies` vers `optionalDependencies` dans
`backend/package.json`. Exécutez `pnpm install` et installez `atlas.exe` en
suivant les étapes ci-dessus.

## WSL2

[WSL2](https://learn.microsoft.com/windows/wsl/install) est une alternative
si vous préférez développer sous Linux. Gardez le projet dans le système
de fichiers Linux (`~/code/my-app`) pour accélérer l'installation et la
surveillance des fichiers.

Poursuivez avec le [démarrage rapide](/docs/getting-started/quickstart/)
ou le [guide des commandes de base de données](/docs/cli/database/).
