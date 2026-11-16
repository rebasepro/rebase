---
sourceHash: ce9b9cd9e35c5c3d
title: Windows
sidebar_label: Windows
description: Installer un projet Rebase et utiliser ses commandes de base de données sous Windows.
---

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

## Mettre à jour un ancien projet

Les projets créés avant l'intégration de Ptah peuvent encore dépendre de
`@ariga/atlas`. Lors du passage à une version de Rebase utilisant Ptah Compat,
exécutez `rebase upgrade`. La mise à jour remplace cette dépendance par
`@stokaro/ptah-compat`. Exécutez ensuite `pnpm install`.

## WSL2

[WSL2](https://learn.microsoft.com/windows/wsl/install) est une alternative
si vous préférez développer sous Linux. Gardez le projet dans le système
de fichiers Linux (`~/code/my-app`) pour accélérer l'installation et la
surveillance des fichiers.

Poursuivez avec le [démarrage rapide](/docs/getting-started/quickstart/)
ou le [guide des commandes de base de données](/docs/cli/database/).
