---
sourceHash: 940a1c3ace06a8c3
title: Connecter Claude à Rebase
sidebar_label: Connecteur Rebase
description: Un seul connecteur MCP pour tous vos projets Rebase, sur Rebase Cloud ou auto-hébergés — ajoutez-le une fois dans Claude, connectez-vous avec votre compte Rebase, puis lisez, déployez et modifiez vos projets avec les accès dont vous disposez dans la console, chaque modification étant préalablement confirmée.
---

Le connecteur Rebase est un serveur MCP unique pour chaque projet Rebase que vous exécutez : sur Rebase Cloud et sur vos propres serveurs. Vous l'ajoutez une seule fois dans Claude, vous vous connectez avec votre compte Rebase, et Claude peut voir vos projets, lire leurs logs, les déployer et effectuer des retours arrière, définir leurs variables d'environnement, ainsi que lire et modifier leurs données. Il fonctionne dans Claude sur le web, l'application de bureau et mobile.

Il agit en votre nom (**vous**), avec les accès dont dispose votre compte dans la console : les projets des organisations auxquelles vous appartenez, le rôle que vous détenez dans chacune d'elles et l'accès aux données que vous confère le Studio de la console. Il ne détient aucune clé qui lui soit propre.

## L'ajouter

Dans Claude, ouvrez **Settings → Connectors → Add custom connector** et saisissez :

```text
https://app.rebase.pro/mcp
```

Claude ouvre l'écran de consentement de Rebase. Si vous êtes connecté à la console dans le même navigateur, il vous propose ce compte : cliquez sur **Allow**. Sinon, connectez-vous. L'écran liste les autorisations accordées ; vous pourrez vous reconnecter plus tard pour en accorder moins.

Vos projets Rebase Cloud y figurent déjà. C'est tout ce qu'il y a à configurer pour eux.

## Ajouter vos instances auto-hébergées

Exécutez ceci une fois pour chaque serveur que vous hébergez vous-même :

```bash
rebase cloud connect https://admin.example.com
```

Cela ajoute l'instance à votre compte Rebase et affiche deux variables. Définissez-les sur ce serveur et redémarrez-le ; la commande attend la réponse du serveur, puis confirme qu'il est connecté. À l'intérieur du dossier du projet, elle propose de les écrire dans le fichier `.env` pour vous.

```bash
REBASE_PLATFORM_TOKEN_KEY=…
REBASE_PLATFORM_TOKEN_AUDIENCE=linked:…
```

Dès lors, Claude liste l'instance aux côtés de vos projets Cloud, et vous la désignez de la même manière : « montre-moi les commandes sur admin.example.com ». Sur une instance auto-hébergée, le connecteur lit et modifie les données, lit son schéma et exécute ses tâches cron. Les déploiements, variables d'environnement et logs restent sur votre propre serveur.

- **Le serveur doit être sous Rebase 0.28.1 ou version ultérieure**, accessible en HTTPS via une adresse publique. Rebase Cloud l'appelle directement, un serveur accessible uniquement sur un réseau privé ne peut donc pas être connecté.
- **Les variables ne contiennent aucun secret.** La clé est la clé publique de Rebase Cloud ; l'audience désigne cette instance. Grâce à elles, le serveur accepte des jetons à courte durée de vie signés par Rebase Cloud uniquement pour cette instance, et leur accorde au maximum ce que Studio permettrait : les données, selon sa sécurité au niveau des lignes (row-level security), et les tâches cron.
- **Les appels transitent par Rebase Cloud.** Claude communique avec le connecteur, et le connecteur avec votre serveur. Un serveur que vous ne connectez jamais conserve son propre [point de terminaison MCP distant](/docs/ai/remote-mcp/), sans intermédiaire.
- **Pour en déconnecter une**, exécutez `rebase cloud connect --remove https://admin.example.com`, ou supprimez les deux variables du serveur.

L'ajout d'une instance nécessite le rôle de propriétaire ou d'administrateur de l'organisation, tout comme l'accès aux données d'un projet. `rebase cloud connect --list` affiche celles que vous avez ajoutées.

## Ce que Claude peut faire avec

Treize outils. Les neuf premiers sont en lecture seule :

| Outil | Ce qu'il fait |
|---|---|
| `projects` | Liste vos projets, leur statut et votre rôle dans chacun d'eux |
| `project_status` | Le statut et le dernier déploiement d'un projet ; facultativement ses déploiements récents, les **noms** de ses variables d'environnement, ses tâches cron |
| `logs` | La sortie de l'application en cours d'exécution, le journal de build d'un déploiement ou les exécutions d'une tâche cron |
| `schema` | Les tables d'un projet, ou les colonnes, relations et règles de sécurité d'une table |
| `query` | Lit des lignes : une par identifiant, une page filtrée ou un décompte |
| `show_table` | Ouvre une table dans la vue propre à votre panneau d'administration, directement dans la conversation : un tableau, une liste, des cartes ou un tableau kanban que vous pouvez rechercher, filtrer et paginer, où chaque ligne ouvre son formulaire |
| `show_record` | Ouvre le formulaire d'une ligne, ou un formulaire prérempli par Claude pour une nouvelle ligne, afin que vous puissiez le vérifier et l'enregistrer |
| `show_app` | Construit une petite application pour la tâche en cours, comme une file de tri ou un tableau de bord, et l'exécute sur vos données dans la conversation. Elle peut utiliser les vues et formulaires de votre panneau d'administration, et vous demande confirmation avant toute modification |
| `show_app_guide` | Comment écrire le code pour `show_app` : les hooks, composants et props qu'une application peut utiliser, avec un exemple. Claude le consulte avant de construire une application |

Les quatre autres modifient la production, et chacun demande d'abord une confirmation :

| Outil | Ce qu'il fait |
|---|---|
| `write` | Crée, met à jour ou supprime une ligne (utilisateurs inclus : ce sont des lignes de votre table d'utilisateurs) |
| `deploy` | Déploie une branche git, effectue un retour arrière vers un déploiement antérieur ou annule un déploiement en cours |
| `env` | Définit ou supprime des variables d'environnement ; une modification s'applique au déploiement suivant |
| `cron` | Exécute une tâche cron immédiatement, ou en active/désactive une |

Le déploiement de code depuis votre machine continue de s'effectuer via le CLI (`rebase cloud deploy`) et le [serveur MCP local](/docs/ai/mcp/), qui prend également en charge le développement local, la génération de schéma et les branches de base de données.

## Chaque modification est confirmée

Un outil qui effectue une modification nécessite deux appels. Le premier ne modifie rien : il renvoie un plan d'action, tel que « Roll shop back to deployment d_81f2 », accompagné d'un jeton de confirmation. Claude vous présente le plan et n'effectue le second appel avec le jeton que si vous donnez votre accord. Le jeton est valable cinq minutes, pour un usage unique, et strictement pour les arguments pour lesquels il a été généré : si le moindre élément diffère, rien n'est exécuté.

Claude vous demande également votre autorisation avant d'appeler l'un de ces quatre outils, car ils sont signalés comme destructeurs. Dans les vues, l'enregistrement d'un formulaire affiche le plan et attend que vous cliquiez sur **Save**.

Les valeurs des variables d'environnement ne sont jamais réaffichées : un plan indique uniquement leur longueur, et `project_status` ne liste que les noms. Une valeur que vous définissez transite en revanche par la conversation.

## Ce à quoi il peut accéder

- **Projets et opérations cloud** : ce que la console vous autorise à faire. Un membre d'une organisation peut consulter le statut et les logs et, tout comme dans la console, déployer et définir des variables.
- **Données, schémas et tâches cron** : ce que Studio dans la console vous autorise à faire. Cela concerne un propriétaire ou un administrateur de l'organisation, sur un projet pour lequel l'accès à Studio est activé, ou sur une instance auto-hébergée connectée par l'organisation. Les appels s'exécutent au sein du projet, selon sa sécurité au niveau des lignes (row-level security), avec le rôle d'administrateur dont dispose Studio. Désactiver l'accès à Studio pour un projet désactive également cet accès.
- **Ce que vous avez accordé.** Vous pouvez accorder au connecteur moins de droits que n'en possède votre compte : uniquement la lecture, ou un seul projet. Il ne demande jamais d'accès aux sauvegardes, aux restaurations, aux identifiants de base de données ni aux paramètres du projet.

Un projet accède à ses données via le connecteur dès lors qu'il utilise un runtime prenant en charge les appels du connecteur. Jusqu'à son prochain déploiement ou mise à jour de la plateforme, ces outils le signaleront.

## Déconnexion

Supprimez le connecteur dans les paramètres de Claude. Son jeton d'accès cesse de fonctionner dans l'heure qui suit. La suppression de votre compte Rebase, ou une déconnexion générale de toutes les sessions, l'interrompt dès l'appel suivant.

Le connecteur est destiné aux personnes qui développent sur Rebase. Pour permettre aux personnes qui **utilisent** votre application de connecter Claude en leur propre nom, exposez le [point de terminaison MCP distant](/docs/ai/remote-mcp/) depuis votre propre backend.
