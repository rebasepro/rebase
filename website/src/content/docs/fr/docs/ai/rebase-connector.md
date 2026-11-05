---
sourceHash: 97232ebc628a975c
title: Connecter Claude à Rebase Cloud
sidebar_label: Connecteur Rebase Cloud
description: Un seul connecteur MCP pour tous vos projets Rebase Cloud — ajoutez-le une fois dans Claude, connectez-vous avec votre compte Rebase, et lisez, déployez et modifiez vos projets avec l'accès que vous avez dans la console, chaque modification confirmée d'abord.
---

Le connecteur Rebase est un seul serveur MCP pour tout ce que vous faites
tourner sur Rebase Cloud. Vous l'ajoutez une fois dans Claude, vous vous
connectez avec votre compte Rebase, et Claude peut voir vos projets, lire leurs
logs, les déployer et revenir en arrière, définir leurs variables
d'environnement, et lire et modifier leurs données. Il fonctionne dans Claude
sur le web, dans l'application de bureau et sur mobile.

Il agit **en votre nom**, avec l'accès qu'a votre compte dans la console : les
projets des organisations dont vous êtes membre, le rôle que vous avez dans
chacune, et l'accès aux données que vous donne le Studio de la console. Il ne
détient aucune clé à lui.

## L'ajouter

Dans Claude, ouvrez **Paramètres → Connecteurs → Ajouter un connecteur
personnalisé** et saisissez :

```text
https://app.rebase.pro/mcp
```

Claude ouvre l'écran de consentement de Rebase. Si vous êtes connecté à la
console dans le même navigateur, il propose ce compte : appuyez sur
**Autoriser**. Sinon, connectez-vous à cet endroit. L'écran liste ce que vous
accordez ; vous pouvez vous reconnecter plus tard pour accorder moins.

## Ce que Claude peut en faire

Dix outils. Les six premiers ne font que lire :

| Outil | Ce qu'il fait |
|---|---|
| `projects` | Liste vos projets, leur état et votre rôle dans chacun |
| `project_status` | L'état et le dernier déploiement d'un projet ; en option ses déploiements récents, les **noms** de ses variables d'environnement, ses tâches cron |
| `logs` | La sortie de l'app en cours d'exécution, le log de build d'un déploiement, ou les exécutions d'une tâche cron |
| `schema` | Les collections d'un projet, ou les champs d'une collection |
| `query` | Lit des lignes : une par id, une page filtrée, ou un décompte |
| `show_collection` | Affiche des lignes sous forme de tableau dans la conversation, où vous pouvez paginer et modifier des cellules |

Les quatre autres modifient la production, et chacun demande d'abord :

| Outil | Ce qu'il fait |
|---|---|
| `write` | Crée, met à jour ou supprime une ligne (utilisateurs compris : ce sont des lignes de votre collection d'utilisateurs) |
| `deploy` | Déploie une branche git, revient à un déploiement antérieur, ou annule un déploiement en cours |
| `env` | Définit ou supprime des variables d'environnement ; un changement s'applique au prochain déploiement |
| `cron` | Lance une tâche cron maintenant, ou l'active ou la désactive |

Déployer du code depuis votre machine reste le rôle de la CLI
(`rebase cloud deploy`) et du [serveur MCP local](/docs/ai/mcp/), qui couvre
aussi le développement local, la génération du schéma et les branches de base
de données.

## Chaque modification est confirmée

Un outil qui modifie quelque chose demande deux appels. Le premier ne change
rien : il répond par un plan, comme « Revenir pour shop au déploiement
d_81f2 », et un jeton de confirmation. Claude vous montre le plan, et rappelle
avec le jeton seulement si vous êtes d'accord. Le jeton est valable cinq
minutes, une fois, pour exactement les arguments pour lesquels il a été créé :
si quoi que ce soit diffère, rien ne s'exécute.

Claude vous demande aussi la permission avant d'appeler l'un de ces quatre
outils, parce qu'ils sont marqués comme destructifs. Dans la vue en tableau,
une cellule modifiée affiche le plan et attend que vous appuyiez sur
**Enregistrer**.

Les valeurs des variables d'environnement ne sont jamais réaffichées : un plan
indique leur longueur, et `project_status` ne liste que les noms. Une valeur que
vous définissez passe toutefois par la conversation.

## Ce qu'il peut atteindre

- **Projets et opérations cloud** : ce que la console vous permet. Un membre
  d'une organisation peut lire l'état et les logs et, comme dans la console,
  déployer et définir des variables.
- **Données, schémas et tâches cron** : ce que Studio vous permet dans la
  console. C'est-à-dire un owner ou un admin de l'organisation, sur un projet
  dont l'accès Studio est activé. Les appels s'exécutent dans le projet, sous sa
  sécurité au niveau des lignes, avec le rôle admin qu'a Studio. Désactiver
  l'accès Studio pour un projet désactive aussi ceci.
- **Ce que vous avez accordé.** Vous pouvez accorder au connecteur moins que ce
  que détient votre compte : la lecture seule, ou un seul projet. Il ne demande
  jamais les sauvegardes, les restaurations, les identifiants de base de données
  ni les paramètres du projet.

Un projet donne accès à ses données via le connecteur dès qu'il exécute un
runtime qui accepte les appels du connecteur. Jusqu'à son prochain déploiement
ou au prochain déploiement de la plateforme, ces outils le signalent.

## Déconnecter

Retirez le connecteur dans les paramètres de Claude. Son jeton d'accès cesse de
fonctionner dans l'heure. Supprimer votre compte Rebase, ou vous déconnecter
partout, l'arrête à l'appel suivant.

Le connecteur s'adresse à ceux qui construisent sur Rebase Cloud. Pour que les
personnes qui **utilisent** votre app y connectent Claude en leur propre nom,
servez le [point de terminaison MCP distant](/docs/ai/remote-mcp/) depuis votre
propre backend.
