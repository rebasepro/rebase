---
sourceHash: f5fcf560853b0193
title: Connecter Claude à Rebase
sidebar_label: Connecteur Rebase
description: Un connecteur MCP unique pour tous vos projets Rebase, sur Rebase Cloud ou auto-hébergés — ajoutez-le une fois dans Claude, connectez-vous avec votre compte Rebase, puis lisez, déployez et modifiez vos projets selon vos accès dans la console, chaque modification étant confirmée au préalable.
---

Le connecteur Rebase est un serveur MCP unique pour chacun de vos projets Rebase : sur
Rebase Cloud et sur vos propres serveurs. Vous l'ajoutez une seule fois dans Claude,
vous vous connectez avec votre compte Rebase, et Claude peut voir vos projets, lire
leurs logs, les déployer et effectuer des retours en arrière, définir leurs variables
d'environnement, ainsi que lire et modifier leurs données. Il fonctionne dans Claude
sur le web, l'application de bureau et mobile.

Il agit en **votre nom**, avec les accès dont dispose votre compte dans la console : les
projets des organisations auxquelles vous appartenez, le rôle que vous y occupez, et l'accès
aux données que vous confère le Studio de la console. Il ne détient aucune clé propre.

## L'ajouter

Dans Claude, ouvrez **Settings → Connectors → Add custom connector** et saisissez :

```text
https://app.rebase.pro/mcp
```

Claude ouvre l'écran de consentement de Rebase. Si vous êtes connecté à la console dans
le même navigateur, il vous propose ce compte : cliquez sur **Allow**. Sinon, connectez-vous
sur place. L'écran liste les autorisations accordées ; vous pourrez vous reconnecter plus
tard pour en accorder moins.

Vos projets Rebase Cloud sont déjà présents. C'est tout ce qu'il y a à faire pour eux.

## Ajouter vos instances auto-hébergées

Exécutez ceci une fois pour chaque serveur que vous hébergez vous-même :

```bash
rebase cloud connect https://admin.example.com
```

Cette commande ajoute l'instance à votre compte Rebase et affiche deux variables. Définissez-les
sur ce serveur et redémarrez-le ; la commande attend que le serveur réponde, puis indique
qu'il est connecté. Dans le dossier du projet, elle propose de les écrire dans `.env`
à votre place.

```bash
REBASE_PLATFORM_TOKEN_KEY=…
REBASE_PLATFORM_TOKEN_AUDIENCE=linked:…
```

Dès lors, Claude liste l'instance aux côtés de vos projets Cloud, et vous la désignez
de la même manière : « montre-moi les commandes sur admin.example.com ». Sur une
instance auto-hébergée, le connecteur lit et modifie les données, lit son schéma et
exécute ses tâches cron. Les déploiements, les variables d'environnement et les logs
restent sur votre propre serveur.

- **Le serveur doit utiliser Rebase 0.28.1 ou une version ultérieure**, accessible via https
  à une adresse publique. Rebase Cloud l'appelle directement, un serveur accessible
  uniquement sur un réseau privé ne peut donc pas être connecté.
- **Les variables ne contiennent aucun secret.** La clé est la clé publique de Rebase Cloud ;
  l'audience désigne cette instance. Grâce à elles, le serveur accepte des jetons à courte
  durée de vie signés par Rebase Cloud pour cette instance uniquement, et ne leur accorde
  au maximum que ce que Studio permettrait : l'accès aux données, sous sa sécurité au niveau
  des lignes (row-level security), et les tâches cron.
- **Les appels transitent par Rebase Cloud.** Claude communique avec le connecteur, et le
  connecteur avec votre serveur. Un serveur que vous ne connectez jamais conserve son propre
  [remote MCP endpoint](/docs/ai/remote-mcp/), sans aucun intermédiaire.
- **Pour en déconnecter un**, exécutez `rebase cloud connect --remove https://admin.example.com`,
  ou supprimez les deux variables du serveur.

L'ajout d'une instance nécessite le rôle de propriétaire (owner) ou d'administrateur
de l'organisation, tout comme l'accès aux données d'un projet. `rebase cloud connect --list`
affiche celles que vous avez ajoutées.

## Ce que Claude peut faire avec

Dix outils. Les six premiers sont en lecture seule :

| Outil | Description |
|---|---|
| `projects` | Liste vos projets, leur statut et votre rôle dans chacun |
| `project_status` | Le statut et le dernier déploiement d'un projet ; facultativement ses déploiements récents, les **noms** de ses variables d'environnement, ses tâches cron |
| `logs` | La sortie de l'application en cours d'exécution, le journal de build d'un déploiement ou les exécutions d'une tâche cron |
| `schema` | Les collections d'un projet, ou les champs d'une collection |
| `query` | Lit des lignes : une par identifiant (id), une page filtrée ou un décompte |
| `show_collection` | Affiche les lignes sous forme de tableau dans la conversation, où vous pouvez feuilleter et modifier des cellules |

Les quatre autres modifient la production, et chacun demande confirmation au préalable :

| Outil | Description |
|---|---|
| `write` | Crée, met à jour ou supprime une ligne (utilisateurs inclus : ce sont des lignes de votre collection users) |
| `deploy` | Déploie une branche git, revient à un déploiement antérieur ou annule un déploiement en cours |
| `env` | Définit ou supprime des variables d'environnement ; une modification s'applique au prochain déploiement |
| `cron` | Exécute une tâche cron immédiatement, ou active/désactive une tâche |

Le déploiement de code depuis votre machine continue de s'effectuer avec le CLI (`rebase cloud deploy`)
et le [serveur MCP local](/docs/ai/mcp/), qui couvre également le développement local,
la génération de schémas et les branches de base de données.

## Chaque modification est confirmée

Un outil qui modifie quelque chose nécessite deux appels. Le premier ne modifie rien : il
renvoie un plan d'action, tel que « Roll shop back to deployment d_81f2 », et un jeton
de confirmation. Claude vous montre le plan et n'effectue le second appel avec le jeton
que si vous donnez votre accord. Le jeton fonctionne pendant cinq minutes, une seule fois,
et strictement pour les arguments pour lesquels il a été généré : si le moindre élément
diffère, rien n'est exécuté.

Claude vous demande également votre autorisation avant d'appeler l'un de ces quatre outils,
car ils sont marqués comme destructifs. Dans la vue en tableau, une cellule modifiée
affiche le plan et attend que vous cliquiez sur **Save**.

Les valeurs des variables d'environnement ne sont jamais réaffichées : un plan indique
leur longueur, et `project_status` ne liste que leurs noms. En revanche, une valeur que
vous définissez transite bien par la conversation.

## Ce à quoi il a accès

- **Projets et opérations cloud** : ce que la console vous autorise. Un membre d'une
  organisation peut consulter le statut et les logs et, comme dans la console, déployer et
  définir des variables.
- **Données, schémas et tâches cron** : ce que Studio dans la console vous autorise. Cela
  concerne un propriétaire ou un administrateur de l'organisation, sur un projet dont
  l'accès Studio est activé, ou sur une instance auto-hébergée connectée par l'organisation.
  Les appels s'exécutent au sein du projet, sous sa sécurité au niveau des lignes
  (row-level security), avec le rôle d'administrateur dont dispose Studio. La désactivation
  de l'accès Studio pour un projet désactive également cet accès.
- **Ce que vous avez accordé.** Vous pouvez accorder au connecteur moins d'autorisations
  que ce que votre compte détient : uniquement la lecture, ou un seul projet. Il ne demande
  jamais l'accès aux sauvegardes, aux restaurations, aux identifiants de base de données
  ni aux paramètres du projet.

Un projet accède à ses données via le connecteur dès lors qu'il utilise un runtime prenant
en charge les appels du connecteur. Jusqu'à son prochain déploiement ou mise à jour de la
plateforme, ces outils vous l'indiqueront.

## Déconnexion

Supprimez le connecteur dans les paramètres de Claude. Son jeton d'accès cesse de
fonctionner dans l'heure. Supprimer votre compte Rebase, ou vous déconnecter de partout,
le désactive dès l'appel suivant.

Le connecteur s'adresse aux personnes qui développent sur Rebase. Pour permettre
aux personnes qui **utilisent** votre application de connecter Claude à celle-ci sous
leur propre identité, servez le [remote MCP endpoint](/docs/ai/remote-mcp/) depuis
votre propre backend.
