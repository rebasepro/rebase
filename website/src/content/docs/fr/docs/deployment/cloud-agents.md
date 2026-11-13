---
sourceHash: b4a48b328135ef8c
title: CI, agents et backends revendiquables
sidebar_label: CI et agents
description: Déployez sur Rebase Cloud depuis une CI ou un agent avec un jeton restreint plutôt qu'un mot de passe, et laissez un agent provisionner un backend actif sans compte qu'une personne pourra revendiquer plus tard.
---

Un projet [Rebase Cloud](/docs/deployment/cloud/) n'a pas besoin d'une personne devant un
terminal pour être déployé. Un job de CI ou un agent peut agir avec un jeton restreint à quelques
actions sur un seul projet, et un agent peut créer un projet avant même que quiconque ne possède un
compte, puis transmettre un lien pour le revendiquer.


## CI et agents

Un job de CI ou un agent ne devrait pas transporter votre mot de passe. Donnez-lui
plutôt un jeton : une clé qui agit au nom de votre compte, restreinte à quelques actions sur un
projet précis. Créez-le depuis un terminal connecté :

```bash
rebase cloud tokens create --project shop --can deploy,logs --expires-in 90
```

Le jeton n'est affiché qu'une seule fois, sous la forme d'une ligne `export REBASE_TOKEN=rk_live_…`. Lorsque
`REBASE_TOKEN` est défini, chaque commande `rebase cloud` s'authentifie avec celui-ci au lieu de
votre identifiant de connexion, et ne lit ni n'écrit jamais dans la session enregistrée. Dans GitHub Actions,
stockez-le en tant que secret de dépôt et exposez-le sous ce nom :

```yaml title=".github/workflows/deploy.yml"
name: Deploy
on:
  push:
    branches: [main]
jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with:
          version: 11
      - uses: actions/setup-node@v4
        with:
          node-version: 22.x
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm exec rebase cloud deploy --project shop
        env:
          REBASE_TOKEN: ${{ secrets.REBASE_TOKEN }}
```

`--can` prend une ou plusieurs capacités, séparées par des virgules ou répétées :

| Capacité | Ce que le jeton peut faire |
|---|---|
| `deploy` | Déployer le projet et suivre ses builds : `deploy` (`--preview` inclus), `deployments`, `previews` |
| `logs` | Lire les logs de build et d'exécution, l'historique des tâches cron, les métriques en direct et l'utilisation : `logs`, `cron`, `metrics`, `usage` |
| `env` | Lire et modifier les variables d'environnement, secrets inclus, ainsi que celles des previews (`--preview`) |
| `database` | `db list`, `db info` et `db connect`, ce qui inclut le mot de passe de la base de données |
| `backups` | Lister, créer, inspecter et télécharger des sauvegardes, et lire la fenêtre de récupération à un point dans le temps |

Trois capacités supplémentaires agissent sur une organisation plutôt que sur un projet. Un jeton
n'en détient une que si `--can` la nomme explicitement, sur l'organisation désignée par `--org` (ou,
sans `--org`, l'organisation du projet, puis celle sélectionnée avec
`rebase cloud use`). Un jeton peut détenir ces capacités sans posséder aucune capacité de projet :

```bash
rebase cloud tokens create --can billing --org <organization-id> --name invoices
```

| Capacité | Ce que le jeton peut faire |
|---|---|
| `billing` | Consulter la carte enregistrée, les factures et la prochaine facture, et modifier l'adresse e-mail de facturation : `billing`, `billing invoices`, `billing upcoming`. Propriétaires et administrateurs uniquement |
| `audit` | Consulter le journal d'activité de l'organisation : `activity`. Propriétaires et administrateurs uniquement |
| `notifications` | Modifier les préférences e-mail de son propre propriétaire ainsi que les webhooks de notification des projets de l'organisation : `notifications`. L'ajout, la modification et la suppression d'un webhook requièrent toujours le rôle de propriétaire ou d'administrateur |

Un jeton créé avant
l'existence de `billing` continue de pouvoir lire la facturation pendant une version. Chacune de ces réponses
comporte un en-tête `Deprecation: true` et une phrase indiquant le scope manquant au
jeton, et la CLI l'affiche une fois sur stderr sous forme d'avertissement. Remplacez ce
jeton par un autre créé avec `--can billing` avant la prochaine version, date à laquelle la facturation commencera à
le refuser.

Sous le capot, un jeton est une [clé d'API personnelle](/docs/backend/api-keys/#personal-keys)
sur le plan de contrôle. Chaque capacité correspond à quelques
[scopes](/docs/backend/roles-and-scopes/) : `deploy` sur `shop` comprend
`project:deploy:<id>`, avec l'identifiant du projet, ainsi que les scopes de données et de fonctions que
les commandes de déploiement appellent. Une capacité d'organisation comprend `org:billing:<id>`,
`org:audit:<id>` ou `org:notifications:<id>`, avec l'identifiant de l'organisation. Le jeton ne détient jamais plus de droits que votre propre compte au moment
de son utilisation ; il perd donc tout ce que votre compte perd.

Deux opérations restent réservées à une personne connectée :

- **Gestion des jetons.** `rebase cloud tokens list`, `create` et `revoke <id>` nécessitent
  votre session `rebase cloud login`. Un jeton ne peut pas lister, créer ou révoquer
  d'autres jetons, car un jeton capable d'émettre des jetons pourrait générer son propre successeur.
- **Restauration.** Aucune capacité n'autorise la restauration d'une sauvegarde ni un
  `restore` et `cutover` à un point dans le temps. Écraser une base de données en production avec des données
  anciennes reste réservé à un propriétaire ou un administrateur connecté.

`rebase cloud whoami`, lorsqu'un jeton est défini, indique ce qu'il peut faire et sur quel
projet ou quelle organisation. L'écran **Access tokens** de la console propose les mêmes
capacités, celles liées à l'organisation se trouvant sous **Organization access**. `rebase cloud tokens revoke <id> --yes` le révoque immédiatement.

## Un backend sans compte

Un agent qui a conçu une application peut lui fournir un backend actif avant même que quiconque
ne se soit inscrit, et transmettre à la personne pour qui il travaille un lien pour le conserver :

```bash
rebase cloud init --claim
```

Cela provisionne un projet sur Rebase Cloud, définit `REBASE_BASE_URL` dans `.env` avec
son adresse en direct, associe le répertoire et déploie les tables locales avec
`rebase cloud deploy --bundle`. La commande affiche l'URL de production, l'URL du panneau d'administration et une
**URL de revendication**. Toute personne qui ouvre l'URL de revendication et se connecte peut déplacer le projet dans
l'une de ses organisations. Le lien ne fonctionne qu'une seule fois. Un projet que personne ne revendique sous
72 heures est supprimé, base de données comprise. `rebase cloud claim` affiche
de nouveau l'URL de revendication avec le temps restant, et `--open` l'ouvre directement. L'outil
`rebase_cloud_provision` du serveur MCP exécute la même commande et renvoie les mêmes URLs ;
ses autres outils cloud permettent ensuite de vérifier, déployer, lire les logs, définir des variables et restaurer
le projet sans avoir besoin d'être connecté (voir [MCP server](/docs/ai/mcp#rebase-cloud)).

`REBASE_BASE_URL` dans `.env` est également l'adresse à laquelle `rebase api-keys`, `rebase storage`
et `rebase auth reset-password` envoient la clé de service locale ; après `init
--claim`, ces commandes ciblent donc le projet cloud, qui n'accepte pas cette clé. Elles
l'indiquent le cas échéant ; définissez `REBASE_BASE_URL` dans votre shell pour cibler plutôt
un backend local.

Tant que le projet n'est pas revendiqué, il n'appartient à aucun compte. Son jeton est restreint à
ce seul projet : il permet de déployer, de lire les logs et les métriques, de définir des variables d'environnement
et d'exécuter `db info`. Il ne peut rien lire de secret en retour : ni la valeur d'une variable (clé de
service incluse), ni le mot de passe de la base de données, et il ne peut pas ouvrir
`db connect` ni une preview. Il est conservé dans
`~/.rebase/credentials.json`, jamais dans le dépôt, et les commandes `rebase cloud`
exécutées dans le répertoire associé l'utilisent automatiquement. `REBASE_TOKEN`, lorsqu'il est défini,
reste prioritaire s'il détient un scope sur ce projet, et ces commandes avertissent de son utilisation ;
s'il n'en détient aucun (comme un jeton de CI créé pour d'autres projets), le jeton propre au projet
est utilisé et la première commande le signale. Une commande recevant `--project` pour
un autre projet conserve `REBASE_TOKEN`, et le déploiement exécuté par `init --claim` utilise
systématiquement le jeton propre au projet. Il expire en même temps que le projet. `rebase cloud whoami` dans ce répertoire affiche le projet, ce que le
jeton peut faire, l'URL de revendication et la date d'expiration du projet. Une commande nécessitant la
session d'un utilisateur est rejetée avec `session_required` et conserve le jeton ; il
n'est oublié que lorsque le plan de contrôle le refuse partout, après une revendication ou
à son expiration, et l'URL de revendication est affichée au moment de son retrait. `rebase cloud status` affiche également
l'URL de revendication et l'expiration (`unclaimed` en format `--json`). `rebase cloud unlink`
ne supprime pas un projet non revendiqué : la commande signale que le projet continue de fonctionner
jusqu'à son expiration et affiche l'URL de revendication, et `init --claim` dans un répertoire
déjà associé à un projet renvoie vers son URL de revendication au lieu d'en provisionner un
second. Jusqu'à la revendication, l'application n'accède à Internet que sur les ports 80 et 443 ;
les ports de messagerie dont disposent tous les autres projets (465, 587 et 993) s'ouvrent dès que le projet
est revendiqué.

Une fois que le déploiement a construit l'application, la commande définit également `REBASE_API_TOKEN` dans
`.env` : une clé générée sur l'application elle-même, correspondant à ce que le serveur MCP et le SDK
lui envoient. Si un `REBASE_API_TOKEN` est déjà présent dans `.env`, il est conservé et aucune clé n'est générée,
et un fichier `.env` créé par la commande n'est lisible que par vous seul. Cette clé lit et écrit des données (`data:read`, `data:write`) via
la sécurité au niveau des lignes (row-level security) de l'application, en tant qu'appelant qui n'est ni un utilisateur individuel ni un administrateur. Elle
ne détient aucun accès au plan d'administration, et elle expire à la fin de la fenêtre de revendication, sauf si le
projet est revendiqué avant. Avec `--no-deploy`, ou si ce premier déploiement échoue,
aucune clé n'existe encore : le prochain `rebase cloud deploy` qui réussit dans le
répertoire en demande une, tant que le projet n'est pas revendiqué et qu'aucun
`REBASE_API_TOKEN` n'est déjà défini dans `.env`. `init`, `deploy`, `status` et `whoami` affichent
sa date d'expiration.

La revendication transmet la clé : la revendication supprime son expiration, de sorte que le `.env` de
l'application continue de fonctionner. L'agent en conservant toujours une copie, la personne qui a revendiqué
le projet peut la remplacer. `rebase cloud app-key rotate`, ou **Rotate app key** dans
les paramètres (Settings) du projet, génère une nouvelle clé et révoque immédiatement toutes les anciennes clés d'agent.
Elle inscrit la nouvelle clé dans un `.env` contenant déjà `REBASE_API_TOKEN`,
ou l'affiche une seule fois. Les propriétaires et administrateurs connectés peuvent la faire pivoter. Une clé qui n'a pas
pu être transmise conserve sa date d'expiration, ce qui se produit si l'application n'a pas été déployée ou
ne répondait pas au moment de la revendication. La rotation la remplace par une clé sans date d'expiration.

La revendication remplace également le `REBASE_SERVICE_KEY` du projet, qui dispose des droits
d'administration sur l'API de l'application et que le code déployé par l'agent a pu lire. L'application
redémarre une fois avec la nouvelle clé, et tout ce que l'agent a pu conserver cesse de fonctionner
une fois ce redémarrage terminé. Si un déploiement est en cours au moment de la revendication,
le déploiement suivant intégrera la nouvelle clé.

La revendication nécessite une session de navigateur connectée, et non un jeton, ainsi qu'un moyen de paiement sur
l'organisation vers laquelle le projet est transféré. À partir de la revendication, le projet est
facturé comme n'importe quel autre. La revendication révoque également le jeton de l'agent : connectez-vous avec
`rebase cloud login`, ou générez un nouveau jeton avec `rebase cloud tokens create`.

Le provisionnement sans compte est limité par adresse, par réseau (un /24 IPv4)
et globalement, et un plan de contrôle qui n'a pas activé cette option refuse la requête avec
un message explicatif. La consommation précédant la revendication n'est pas facturée à la personne
qui revendique le projet.
