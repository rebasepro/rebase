---
sourceHash: 0dcbce5cfcf3e2de
title: Connecter Claude à Rebase
sidebar_label: Connecteur Rebase
description: Un seul connecteur MCP pour tous vos projets Rebase, sur Rebase Cloud ou auto-hébergés — ajoutez-le une fois dans Claude, connectez-vous avec votre compte Rebase, et lisez, déployez et modifiez vos projets avec les accès dont vous disposez dans la console, chaque modification étant préalablement confirmée.
---

Le connecteur Rebase est un serveur MCP unique pour tous les projets Rebase que vous exécutez : sur Rebase Cloud et sur vos propres serveurs. Vous l'ajoutez une fois dans Claude, vous vous connectez avec votre compte Rebase, et Claude peut voir vos projets, lire leurs logs, les déployer et effectuer des rollbacks, définir leurs variables d'environnement, ainsi que lire et modifier leurs données. Il fonctionne dans Claude sur le web, l'application de bureau et mobile.

Il agit en tant que **vous**, avec les accès dont dispose votre compte dans la console : les projets des organisations auxquelles vous appartenez, le rôle que vous y occupez, et l'accès aux données que vous confère le Studio de la console. Il ne détient aucune clé qui lui soit propre.

## L'ajouter

Dans Claude, ouvrez **Settings → Connectors → Add custom connector** et saisissez :

```text
https://app.rebase.pro/mcp
```

Claude ouvre l'écran de consentement de Rebase. Si vous êtes connecté à la console dans le même navigateur, il vous propose ce compte : cliquez sur **Allow**. Sinon, connectez-vous sur cette page. L'écran liste les autorisations que vous accordez ; vous pourrez vous reconnecter plus tard pour en accorder moins.

Vos projets Rebase Cloud sont déjà présents. La configuration s'arrête là pour eux.

## Ajouter vos instances auto-hébergées

Exécutez cette commande une fois pour chaque serveur que vous hébergez vous-même :

```bash
rebase cloud connect https://admin.example.com
```

Elle ajoute l'instance à votre compte Rebase et affiche deux variables. Définissez-les sur ce serveur et redémarrez-le ; la commande attend que le serveur réponde, puis indique qu'il est connecté. Dans le dossier du projet, elle propose de les écrire dans `.env` à votre place.

```bash
REBASE_PLATFORM_TOKEN_KEY=…
REBASE_PLATFORM_TOKEN_AUDIENCE=linked:…
```

Dès lors, Claude liste l'instance aux côtés de vos projets Cloud, et vous la désignez de la même façon : « montre-moi les commandes sur admin.example.com ». Sur une instance auto-hébergée, le connecteur lit et modifie les données, lit son schéma et exécute ses tâches cron. Les déploiements, les variables d'environnement et les logs restent sur votre propre serveur.

- **Le serveur nécessite Rebase 0.28.1 ou une version ultérieure**, accessible en HTTPS à une adresse publique. Rebase Cloud l'appelle, donc un serveur situé uniquement sur un réseau privé ne peut pas être connecté.
- **Les variables ne contiennent aucun secret.** La clé est la clé publique de Rebase Cloud ; l'audience désigne cette instance. Grâce à elles, le serveur accepte des jetons à courte durée de vie signés par Rebase Cloud pour cette instance uniquement, et ne leur accorde au maximum que ce que Studio autoriserait : les données, sous sa sécurité au niveau des lignes (row-level security), et les tâches cron.
- **Les appels transitent par Rebase Cloud.** Claude communique avec le connecteur, et le connecteur avec votre serveur. Un serveur que vous ne connectez jamais conserve son propre [point de terminaison MCP distant](/docs/ai/remote-mcp/), sans intermédiaire.
- **Pour en déconnecter une**, exécutez `rebase cloud connect --remove https://admin.example.com`, ou supprimez les deux variables du serveur.

L'ajout d'une instance nécessite le rôle de propriétaire (owner) ou d'administrateur (admin) de l'organisation, tout comme l'accès aux données d'un projet. `rebase cloud connect --list` affiche celles que vous avez ajoutées.

## Ce que Claude peut faire avec

Seize outils. Les douze premiers sont en lecture seule :

| Outil | Description |
|---|---|
| `projects` | Liste vos projets, leur statut et votre rôle dans chacun d'eux |
| `project_status` | Le statut d'un projet et son dernier déploiement ; facultativement ses déploiements récents, les **noms** de ses variables d'environnement, ses tâches cron |
| `logs` | La sortie de l'application en cours d'exécution, le log de build d'un déploiement, ou les exécutions d'une tâche cron |
| `schema` | Les tables d'un projet, ou les colonnes, relations et règles de sécurité d'une table |
| `query` | Lit des lignes : une par ID, une page filtrée ou un décompte |
| `storage_list` | Liste un dossier du stockage de fichiers d'un projet, page par page, et indique ses sources de stockage ainsi que le bucket associé à chacune |
| `storage_head` | Indique si un fichier est présent, ainsi que sa taille, son type et sa dernière modification. Prend en argument la clé ou la valeur `s3://bucket/key` stockée par une ligne |
| `storage_get` | Lit un fichier : son contenu s'il s'agit de texte (les 64 premiers Ko par défaut), ou sa taille et son type s'il s'agit d'un fichier binaire |
| `show_table` | Ouvre une table dans la vue propre à votre panneau d'administration, directement dans la conversation : un tableau, une liste, des cartes ou un tableau kanban que vous pouvez rechercher, filtrer et paginer, où chaque ligne ouvre son formulaire |
| `show_record` | Ouvre le formulaire d'une ligne, ou un formulaire pré-rempli par Claude pour une nouvelle ligne, afin que vous puissiez vérifier et enregistrer |
| `show_app` | Construit une petite application pour la tâche en cours, comme une file de tri ou un tableau de bord, et l'exécute sur vos données dans la conversation. Elle peut utiliser les vues et formulaires de votre panneau d'administration, et vous demande confirmation avant de modifier quoi que ce soit |
| `show_app_guide` | Comment rédiger le code de `show_app` : les hooks, composants et props qu'une application peut utiliser, avec un exemple. Claude le consulte avant de construire une application |

Les quatre autres modifient la production, et chacun demande d'abord confirmation :

| Outil | Description |
|---|---|
| `write` | Crée, met à jour ou supprime une ligne (utilisateurs inclus : ce sont des lignes de votre table d'utilisateurs) |
| `deploy` | Déploie une branche Git, effectue un rollback vers un déploiement antérieur, ou annule un déploiement en cours |
| `env` | Définit ou supprime des variables d'environnement ; une modification s'applique au prochain déploiement |
| `cron` | Exécute une tâche cron immédiatement, ou en active/désactive une |

Le déploiement de code depuis votre machine continue de s'effectuer avec le CLI (`rebase cloud deploy`) et le [serveur MCP local](/docs/ai/mcp/), qui couvre également le développement local, la génération de schéma et les branches de base de données.

## Skills

Le connecteur fournit également les 24 [compétences d'agent Rebase](/docs/ai/skills/), les mêmes que celles que `rebase skills install` copie dans un projet. Claude en charge une lorsque la tâche l'exige : comment définir une table, écrire un hook, configurer l'authentification, déployer. Rien n'a besoin d'être installé. Claude Code les répertorie sous la forme `<connector>:rebase-tables`, etc., sous le nom que vous avez donné au connecteur. Les compétences via MCP nécessitent un client basé sur la révision 2026-07-28 ou ultérieure du protocole, et sont en bêta publique dans Claude Code.

## Chaque modification est confirmée

Un outil qui apporte une modification nécessite deux appels. Le premier ne modifie rien : il renvoie un plan, tel que « Roll shop back to deployment d_81f2 », ainsi qu'un jeton de confirmation. Claude vous présente le plan et effectue un nouvel appel avec le jeton uniquement si vous donnez votre accord. Le jeton reste valable cinq minutes, pour un usage unique, et strictement pour les arguments pour lesquels il a été créé : si le moindre élément diffère, rien n'est exécuté.

Claude vous demande également votre permission avant d'appeler l'un de ces quatre outils, car ils sont signalés comme destructifs. Dans les vues, l'enregistrement d'un formulaire affiche le plan et attend que vous cliquiez sur **Save**.

Les valeurs des variables d'environnement ne sont jamais réaffichées : un plan indique leur longueur, et `project_status` ne liste que leurs noms. Une valeur que vous définissez transite en revanche par la conversation.

## Ce à quoi il peut accéder

- **Projets et opérations cloud** : ce que la console vous autorise. Un membre d'une organisation peut consulter les statuts et les logs et, tout comme dans la console, déployer et définir des variables.
- **Données, fichiers, schémas et tâches cron** : ce que le Studio dans la console vous autorise. Cela concerne un propriétaire (owner) ou administrateur (admin) de l'organisation, sur un projet dont l'accès Studio est activé, ou sur une instance auto-hébergée connectée par l'organisation. Les appels s'exécutent au sein du projet, sous sa sécurité au niveau des lignes (row-level security), avec le rôle administrateur dont dispose Studio. Les fichiers sont lus via les propres sources de stockage du projet (stockage Rebase ou le bucket configuré par ses variables `S3_*`) selon ses règles de stockage, et ne sont jamais écrits ni supprimés. Désactiver l'accès Studio pour un projet désactive également cette fonctionnalité.
- **Ce que vous avez accordé.** Vous pouvez accorder au connecteur moins d'autorisations que n'en possède votre compte : uniquement la lecture, ou un seul projet. Il ne demande jamais l'accès aux sauvegardes, aux restaurations, aux identifiants de base de données ni aux paramètres du projet.

Un projet accède à ses données via le connecteur dès lors qu'il utilise un runtime prenant en charge les appels du connecteur, et à ses fichiers dès que ce runtime dispose des outils de stockage. Jusqu'au prochain déploiement ou mise à jour de la plateforme, ces outils le signaleront.

## Déconnexion

Supprimez le connecteur dans les paramètres de Claude. Son jeton d'accès cessera de fonctionner dans l'heure. Supprimer votre compte Rebase ou vous déconnecter de toutes vos sessions le désactivera dès le prochain appel.

Le connecteur s'adresse aux personnes qui développent sur Rebase. Pour permettre aux personnes qui **utilisent** votre application de connecter Claude en leur propre nom, exposez le [point de terminaison MCP distant](/docs/ai/remote-mcp/) depuis votre propre backend.
