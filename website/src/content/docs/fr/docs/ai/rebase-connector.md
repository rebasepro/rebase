---
sourceHash: 52757f5185d7d81b
title: Connecter Claude à Rebase
sidebar_label: Connecteur Rebase
description: Un connecteur MCP unique pour tous vos projets Rebase, sur Rebase Cloud ou auto-hébergés — ajoutez-le une fois dans Claude, connectez-vous avec votre compte Rebase, et consultez, déployez et modifiez vos projets avec les accès dont vous disposez dans la console, chaque modification étant confirmée au préalable.
---

Le connecteur Rebase est un serveur MCP unique pour chaque projet Rebase que vous exécutez : sur Rebase Cloud et sur vos propres serveurs. Vous l'ajoutez une fois dans Claude, vous vous connectez avec votre compte Rebase, et Claude peut voir vos projets, lire leurs journaux, les déployer et effectuer des retours en arrière (rollbacks), définir leurs variables d'environnement, ainsi que lire et modifier leurs données. Il fonctionne dans Claude sur le web, l'application de bureau et mobile.

Il agit en **votre** nom, avec les accès dont dispose votre compte dans la console : les projets des organisations auxquelles vous appartenez, le rôle que vous occupez dans chacune d'elles, et l'accès aux données que vous confère le Studio de la console. Il ne détient aucune clé qui lui soit propre.

## L'ajouter

Dans Claude, ouvrez **Settings → Connectors → Add custom connector** (Paramètres → Connecteurs → Ajouter un connecteur personnalisé) et entrez :

```text
https://app.rebase.pro/mcp
```

Claude ouvre l'écran de consentement de Rebase. Si vous êtes connecté à la console dans le même navigateur, il vous propose ce compte : cliquez sur **Allow**. Sinon, connectez-vous. L'écran liste ce que vous accordez ; vous pourrez vous reconnecter plus tard pour restreindre ces accès.

Vos projets Rebase Cloud y figurent déjà. C'est toute la configuration nécessaire pour eux.

## Ajouter vos instances auto-hébergées

Exécutez cette commande une fois pour chaque serveur que vous hébergez vous-même :

```bash
rebase cloud connect https://admin.example.com
```

Elle ajoute l'instance à votre compte Rebase et affiche deux variables. Définissez-les sur ce serveur et redémarrez-le ; la commande attend que le serveur réponde, puis indique qu'il est connecté. Si vous vous trouvez dans le dossier du projet, elle vous propose de les écrire dans votre fichier `.env`.

```bash
REBASE_PLATFORM_TOKEN_KEY=…
REBASE_PLATFORM_TOKEN_AUDIENCE=linked:…
```

Dès lors, Claude liste l'instance aux côtés de vos projets Cloud, et vous la désignez de la même manière : « montre-moi les commandes sur admin.example.com ». Sur une instance auto-hébergée, le connecteur lit et modifie les données, consulte son schéma et exécute ses tâches cron. Les déploiements, les variables d'environnement et les journaux restent sur votre propre serveur.

- **Le serveur nécessite Rebase 0.28.1 ou une version ultérieure**, accessible en HTTPS à une adresse publique. Rebase Cloud l'appelant directement, un serveur accessible uniquement sur un réseau privé ne peut pas être connecté.
- **Les variables ne contiennent aucun secret.** La clé est la clé publique de Rebase Cloud ; l'audience désigne cette instance. Grâce à elles, le serveur accepte des jetons à courte durée de vie signés par Rebase Cloud pour cette instance uniquement, et ne leur accorde au maximum que ce que Studio autoriserait : les données, selon sa sécurité au niveau des lignes (row-level security), et les tâches cron.
- **Les appels transitent par Rebase Cloud.** Claude communique avec le connecteur, et le connecteur avec votre serveur. Un serveur que vous ne connectez jamais conserve son propre [point de terminaison MCP distant](/docs/ai/remote-mcp/), sans aucun intermédiaire.
- **Pour en déconnecter un**, exécutez `rebase cloud connect --remove https://admin.example.com`, ou supprimez les deux variables du serveur.

L'ajout d'une instance nécessite le rôle de propriétaire (owner) ou d'administrateur (admin) de l'organisation, tout comme l'accès aux données d'un projet. `rebase cloud connect --list` affiche celles que vous avez ajoutées.

## Ce que Claude peut faire avec

Douze outils. Les huit premiers sont en lecture seule :

| Outil | Ce qu'il fait |
|---|---|
| `projects` | Liste vos projets, leur statut et votre rôle dans chacun d'eux |
| `project_status` | Le statut d'un projet et son dernier déploiement ; facultativement ses déploiements récents, les **noms** de ses variables d'environnement, ses tâches cron |
| `logs` | La sortie de l'application en cours d'exécution, le journal de build d'un déploiement ou les exécutions d'une tâche cron |
| `schema` | Les collections d'un projet, ou les champs d'une collection |
| `query` | Lit des lignes : une par identifiant, une page filtrée ou un décompte |
| `show_collection` | Ouvre une collection dans la vue propre à votre panneau d'administration, au sein de la conversation : un tableau, une liste, des cartes ou un tableau kanban où vous pouvez chercher, filtrer et paginer, et où une ligne ouvre son formulaire |
| `show_record` | Ouvre le formulaire d'une ligne, ou un formulaire prérempli par Claude pour une nouvelle ligne, afin que vous puissiez vérifier et enregistrer |
| `show_app` | Ouvre un écran adapté à la tâche en cours : vues de collections, formulaires et décomptes, où un élément peut suivre la ligne sélectionnée dans un autre |

Les quatre autres modifient la production, et chacun demande confirmation au préalable :

| Outil | Ce qu'il fait |
|---|---|
| `write` | Crée, met à jour ou supprime une ligne (utilisateurs inclus : ce sont des lignes de votre collection d'utilisateurs) |
| `deploy` | Déploie une branche Git, effectue un retour arrière vers un déploiement antérieur, ou annule un déploiement en cours |
| `env` | Définit ou supprime des variables d'environnement ; une modification s'applique au déploiement suivant |
| `cron` | Exécute une tâche cron immédiatement, ou en active/désactive une |

Le déploiement de code depuis votre machine continue de s'effectuer via le CLI (`rebase cloud deploy`) et le [serveur MCP local](/docs/ai/mcp/), qui couvre également le développement local, la génération de schéma et les branches de base de données.

## Chaque modification est confirmée

Un outil qui modifie quelque chose nécessite deux appels. Le premier ne change rien : il renvoie un plan, tel que « Roll shop back to deployment d_81f2 », et un jeton de confirmation. Claude vous présente le plan et n'appelle à nouveau avec le jeton que si vous acceptez. Le jeton est valable cinq minutes, une seule fois, pour les arguments exacts pour lesquels il a été généré : si quoi que ce soit diffère, rien n'est exécuté.

Claude demande également votre autorisation avant d'appeler l'un de ces quatre outils, car ils sont signalés comme destructifs. Dans les vues, l'enregistrement d'un formulaire affiche le plan et attend que vous cliquiez sur **Save**.

Les valeurs des variables d'environnement ne sont jamais réaffichées : un plan n'indique que leur longueur, et `project_status` ne liste que les noms. Une valeur que vous définissez transite en revanche par la conversation.

## Ce à quoi il peut accéder

- **Projets et opérations cloud** : ce que la console vous autorise. Un membre d'une organisation peut consulter le statut et les journaux et, comme dans la console, déployer et définir des variables.
- **Données, schémas et tâches cron** : ce que Studio vous autorise dans la console. C'est-à-dire un propriétaire ou administrateur de l'organisation, sur un projet dont l'accès à Studio est activé, ou sur une instance auto-hébergée que l'organisation a connectée. Les appels s'exécutent au sein du projet, sous sa sécurité au niveau des lignes (row-level security), avec le rôle d'administrateur dont dispose Studio. Désactiver l'accès à Studio pour un projet le désactive également ici.
- **Ce que vous avez accordé.** Vous pouvez accorder au connecteur moins d'accès que n'en détient votre compte : uniquement la lecture, ou un seul projet. Il ne demande jamais d'accès aux sauvegardes, aux restaurations, aux identifiants de base de données ni aux paramètres de projet.

Un projet accède à ses données par l'intermédiaire du connecteur dès lors qu'il exécute un runtime acceptant les appels du connecteur. D'ici son prochain déploiement ou la prochaine mise à jour de la plateforme, ces outils le signaleront.

## Déconnexion

Supprimez le connecteur dans les paramètres de Claude. Son jeton d'accès cesse de fonctionner dans l'heure qui suit. La suppression de votre compte Rebase, ou la déconnexion de l'ensemble de vos sessions, l'interrompt dès l'appel suivant.

Le connecteur est destiné aux personnes qui développent sur Rebase. Pour permettre aux personnes qui **utilisent** votre application de connecter Claude à celle-ci sous leur propre identité, exposez le [point de terminaison MCP distant](/docs/ai/remote-mcp/) depuis votre propre backend.
