---
sourceHash: 94bd49dce72c5651
title: Connecter Claude à Rebase
sidebar_label: Connecteur Rebase
description: Un connecteur MCP unique pour tous vos projets Rebase, sur Rebase Cloud ou auto-hébergés — ajoutez-le une fois dans Claude, connectez-vous avec votre compte Rebase, et consultez, déployez et modifiez vos projets avec les accès dont vous disposez dans la console, chaque modification étant confirmée au préalable.
---

Le connecteur Rebase est un serveur MCP unique pour tous les projets Rebase que vous exécutez : sur Rebase Cloud et sur vos propres serveurs. Vous l'ajoutez une fois dans Claude, vous vous connectez avec votre compte Rebase, et Claude peut voir vos projets, lire leurs journaux, les déployer et effectuer des retours en arrière, définir leurs variables d'environnement, ainsi que lire et modifier leurs données. Il fonctionne dans Claude sur le web, l'application de bureau et mobile.

Il agit en tant que **vous**, avec les accès dont dispose votre compte dans la console : les projets des organisations auxquelles vous appartenez, le rôle que vous occupez dans chacune, et l'accès aux données que vous confère le Studio de la console. Il ne détient aucune clé qui lui soit propre.

## L'ajouter

Dans Claude, ouvrez **Settings → Connectors → Add custom connector** et saisissez :

```text
https://app.rebase.pro/mcp
```

Claude ouvre l'écran de consentement de Rebase. Si vous êtes connecté à la console dans le même navigateur, il vous propose ce compte : cliquez sur **Allow**. Sinon, connectez-vous à cet endroit. L'écran liste les autorisations que vous accordez ; vous pourrez vous reconnecter plus tard pour en accorder moins.

Vos projets Rebase Cloud y figurent déjà. C'est tout ce qu'il y a à configurer pour eux.

## Ajouter vos instances auto-hébergées

Exécutez cette commande une fois pour chaque serveur que vous hébergez vous-même :

```bash
rebase cloud connect https://admin.example.com
```

Cela ajoute l'instance à votre compte Rebase et affiche deux variables. Définissez-les sur ce serveur et redémarrez-le ; la commande attend que le serveur réponde, puis indique qu'il est connecté. Dans le dossier du projet, elle vous propose de les écrire dans `.env` pour vous.

```bash
REBASE_PLATFORM_TOKEN_KEY=…
REBASE_PLATFORM_TOKEN_AUDIENCE=linked:…
```

Dès lors, Claude liste l'instance aux côtés de vos projets Cloud, et vous pouvez la désigner de la même manière : « montre-moi les commandes sur admin.example.com ». Sur une instance auto-hébergée, le connecteur lit et modifie les données, lit son schéma et exécute ses tâches cron. Les déploiements, les variables d'environnement et les journaux restent sur votre propre serveur.

- **Le serveur nécessite Rebase 0.28.1 ou une version ultérieure**, accessible via https à une adresse publique. Rebase Cloud l'appelle directement, un serveur situé uniquement sur un réseau privé ne peut donc pas être connecté.
- **Les variables ne contiennent aucun secret.** La clé est la clé publique de Rebase Cloud ; l'audience désigne cette instance. Grâce à elles, le serveur accepte des jetons à courte durée de vie que Rebase Cloud signe uniquement pour cette instance, et ne leur accorde au maximum que ce que le Studio accorderait : les données, sous sa sécurité au niveau des lignes, et le cron.
- **Les appels passent par Rebase Cloud.** Claude communique avec le connecteur, et le connecteur avec votre serveur. Un serveur que vous ne connectez jamais conserve son propre [point de terminaison MCP distant](/docs/ai/remote-mcp/), sans aucun intermédiaire.
- **Pour en déconnecter un**, exécutez `rebase cloud connect --remove https://admin.example.com`, ou supprimez les deux variables du serveur.

L'ajout d'une instance nécessite le rôle de propriétaire ou d'administrateur de l'organisation, tout comme l'accès aux données d'un projet. `rebase cloud connect --list` affiche celles que vous avez ajoutées.

## Ce que Claude peut faire avec

Treize outils. Les neuf premiers sont en lecture seule :

| Outil | Ce qu'il fait |
|---|---|
| `projects` | Liste vos projets, leur statut et votre rôle dans chacun |
| `project_status` | Le statut d'un projet et son dernier déploiement ; facultativement ses déploiements récents, les **noms** de ses variables d'environnement, ses tâches cron |
| `logs` | La sortie de l'application en cours d'exécution, le journal de build d'un déploiement ou les exécutions d'une tâche cron |
| `schema` | Les tables d'un projet, ou les colonnes, relations et règles de sécurité d'une table |
| `query` | Lit les lignes : une par identifiant, une page filtrée ou un décompte |
| `show_table` | Ouvre une table dans la vue propre à votre panneau d'administration, au sein de la conversation : un tableau, une liste, des cartes ou un tableau kanban que vous pouvez rechercher, filtrer et paginer, où chaque ligne ouvre son formulaire |
| `show_record` | Ouvre le formulaire d'une ligne, ou un formulaire prérempli par Claude pour une nouvelle ligne, afin que vous puissiez le vérifier et l'enregistrer |
| `show_app` | Crée une petite application pour la tâche en cours, comme une file de triage ou un tableau de bord, et l'exécute sur vos données dans la conversation. Elle peut utiliser les vues et formulaires de votre panneau d'administration, et vous demande confirmation avant de modifier quoi que ce soit |
| `show_app_guide` | Comment écrire le code de `show_app` : les hooks, composants et props qu'une application peut utiliser, avec un exemple. Claude le consulte avant de créer une application |

Les quatre autres modifient la production, et chacun demande confirmation au préalable :

| Outil | Ce qu'il fait |
|---|---|
| `write` | Crée, met à jour ou supprime une ligne (utilisateurs inclus : ce sont des lignes de votre table des utilisateurs) |
| `deploy` | Déploie une branche git, effectue un retour arrière vers un déploiement antérieur ou annule un déploiement en cours |
| `env` | Définit ou supprime des variables d'environnement ; une modification s'applique au prochain déploiement |
| `cron` | Exécute une tâche cron immédiatement, ou en active/désactive une |

Le déploiement de code depuis votre machine continue de s'effectuer avec la CLI (`rebase cloud deploy`) et le [serveur MCP local](/docs/ai/mcp/), qui couvre également le développement local, la génération de schémas et les branches de base de données.

## Skills

Le connecteur fournit également les 24 [compétences d'agent Rebase](/docs/ai/skills/), les mêmes que celles que `rebase skills install` copie dans un projet. Claude en charge une lorsque la tâche l'exige : comment définir une table, écrire un hook, configurer l'authentification, déployer. Rien n'a besoin d'être installé. Claude Code les répertorie sous la forme `<connector>:rebase-tables`, etc., sous le nom que vous avez donné au connecteur. Les compétences via MCP nécessitent un client basé sur la révision 2026-07-28 ou ultérieure du protocole, et sont en bêta publique dans Claude Code.

## Chaque modification est confirmée

Un outil qui apporte une modification nécessite deux appels. Le premier ne modifie rien : il renvoie un plan d'action, tel que « Revenir pour shop au déploiement d_81f2 », ainsi qu'un jeton de confirmation. Claude vous présente le plan et ne relance l'appel avec le jeton que si vous donnez votre accord. Le jeton est valable cinq minutes, une seule fois, et exclusivement pour les arguments précis pour lesquels il a été généré : si le moindre élément diffère, rien ne s'exécute.

Claude vous demande également votre autorisation avant d'appeler l'un de ces quatre outils, car ils sont signalés comme destructifs. Dans les vues, l'enregistrement d'un formulaire affiche le plan et attend que vous cliquiez sur **Save**.

La valeur des variables d'environnement n'est jamais réaffichée : un plan indique uniquement leur longueur, et `project_status` ne liste que leurs noms. Une valeur que vous définissez transite en revanche par la conversation.

## Ce à quoi il a accès

- **Projets et opérations cloud** : ce que la console vous autorise. Un membre d'une organisation peut consulter le statut et les journaux et, comme dans la console, déployer et définir des variables.
- **Données, schémas et tâches cron** : ce que le Studio dans la console vous autorise. C'est-à-dire un rôle de propriétaire ou d'administrateur de l'organisation, sur un projet dont l'accès Studio est activé, ou sur une instance auto-hébergée que l'organisation a connectée. Les appels s'exécutent au sein du projet, sous sa sécurité au niveau des lignes, avec le rôle d'administrateur dont dispose Studio. La désactivation de l'accès Studio pour un projet désactive également cette possibilité.
- **Ce que vous avez accordé.** Vous pouvez accorder au connecteur moins de droits que n'en possède votre compte : uniquement la lecture, ou un seul projet. Il ne demande jamais d'accès aux sauvegardes, aux restaurations, aux identifiants de base de données ou aux paramètres du projet.

Un projet accède à ses données par le connecteur dès lors qu'il exécute un runtime prenant en charge les appels du connecteur. Jusqu'à son prochain déploiement ou mise à jour de la plateforme, ces outils vous l'indiqueront.

## Déconnexion

Supprimez le connecteur dans les paramètres de Claude. Son jeton d'accès cesse de fonctionner dans l'heure qui suit. La suppression de votre compte Rebase, ou une déconnexion globale, l'interrompt dès le prochain appel.

Le connecteur est destiné aux personnes qui développent sur Rebase. Pour permettre aux personnes qui **utilisent** votre application de connecter Claude à celle-ci en leur propre nom, mettez à disposition le [point de terminaison MCP distant](/docs/ai/remote-mcp/) depuis votre propre backend.
