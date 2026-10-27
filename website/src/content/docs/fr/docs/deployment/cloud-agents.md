---
sourceHash: 582293a88fb2d626
title: CI, agents et backends réclamables
sidebar_label: CI et agents
description: Déployez sur Rebase Cloud depuis la CI ou un agent avec un jeton restreint plutôt qu'un mot de passe, et laissez un agent provisionner un backend en ligne sans compte, qu'une personne réclamera plus tard.
---

Un projet [Rebase Cloud](/docs/deployment/cloud/) n'a pas besoin d'une personne devant
un terminal pour se déployer. Un job de CI ou un agent agit avec un jeton restreint à quelques
actions sur un seul projet, et un agent peut créer un projet avant que quiconque ait
un compte, puis remettre un lien pour le réclamer.


## CI et agents

Un job de CI ou un agent ne devrait pas détenir votre mot de passe. Donnez-lui plutôt un jeton :
une clé qui agit en tant que votre compte, restreinte à quelques actions sur un seul
projet. Créez-le depuis un terminal connecté :

```bash
rebase cloud tokens create --project shop --can deploy,logs --expires-in 90
```

Le jeton n'est affiché qu'une fois, sous la forme d'une ligne `export REBASE_TOKEN=rk_live_…`. Avec
`REBASE_TOKEN` défini, chaque commande `rebase cloud` s'authentifie avec lui à la place de
votre connexion, et ne lit ni n'écrit jamais la session stockée. Dans GitHub Actions,
stockez-le comme secret du dépôt et exposez-le sous ce nom :

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

`--can` accepte une ou plusieurs capacités, séparées par des virgules ou répétées :

| Capacité | Ce que le jeton peut faire |
|---|---|
| `deploy` | Déployer le projet et suivre ses builds : `deploy` (`--preview` compris), `deployments`, `previews` |
| `logs` | Lire les logs de build et d'exécution, l'historique cron, les métriques en direct et l'usage : `logs`, `cron`, `metrics`, `usage` |
| `env` | Lire et modifier les variables d'environnement, secrets compris, ainsi que celles des aperçus (`--preview`) |
| `database` | `db list`, `db info` et `db connect`, ce qui inclut le mot de passe de la base de données |
| `backups` | Lister, créer, inspecter et télécharger les sauvegardes, et lire la fenêtre de restauration à un instant précis |

<span class="since-badge" data-since="0.26">Depuis 0.26</span> Trois capacités de plus agissent sur une organisation plutôt que sur un projet. Un jeton
n'en détient une que si `--can` la nomme, sur l'organisation que nomme `--org` (ou,
sans `--org`, l'organisation du projet, puis celle sélectionnée avec
`rebase cloud use`). Un jeton peut en détenir sans aucune capacité de projet :

```bash
rebase cloud tokens create --can billing --org <organization-id> --name invoices
```

| Capacité | Ce que le jeton peut faire |
|---|---|
| `billing` | Lire la carte enregistrée, les factures et la prochaine facture, et changer l'e-mail de facturation : `billing`, `billing invoices`, `billing upcoming`. Propriétaires et administrateurs uniquement |
| `audit` | Lire le journal d'activité de l'organisation : `activity`. Propriétaires et administrateurs uniquement |
| `notifications` | Modifier les choix d'e-mail propres à son propriétaire, et les webhooks de notification des projets de l'organisation : `notifications`. Ajouter, modifier et supprimer un webhook exige toujours le rôle de propriétaire ou d'administrateur |

Un jeton créé avant que
`billing` n'existe lit encore la facturation pendant une version. Chacune de ces réponses
porte un en-tête `Deprecation: true` et une phrase nommant la portée qui manque au jeton, et la CLI l'affiche
une fois, sur stderr, sous forme d'avertissement. Remplacez un tel jeton
par un jeton créé avec `--can billing` avant la prochaine version, lorsque la facturation commencera à
le refuser.

En coulisses, un jeton est une [clé d'API personnelle](/docs/backend/api-keys/#personal-keys)
sur le plan de contrôle. Chaque capacité devient quelques
[portées](/docs/backend/roles-and-scopes/) : `deploy` sur `shop` détient
`project:deploy:<id>`, avec l'identifiant du projet, plus les portées de données et de fonctions
qu'appellent les commandes de déploiement. Une capacité d'organisation détient `org:billing:<id>`,
`org:audit:<id>` ou `org:notifications:<id>`, avec l'identifiant de l'organisation. Le jeton ne détient jamais plus que votre compte au moment
où il est utilisé : il perd donc tout ce que perd votre compte.

Deux choses restent réservées à une personne connectée :

- **Gérer les jetons.** `rebase cloud tokens list`, `create` et `revoke <id>` utilisent
  votre session `rebase cloud login`. Un jeton ne peut ni lister, ni créer, ni révoquer des
  jetons, car un jeton capable d'en créer pourrait créer son propre successeur.
- **Restaurer.** Aucune capacité n'accorde une restauration de sauvegarde ni un `restore` et
  `cutover` à un instant précis. Remettre d'anciennes données par-dessus une base en production
  reste réservé à un propriétaire ou administrateur connecté.

`rebase cloud whoami` avec un jeton défini montre ce qu'il peut faire, et sur quel
projet ou quelle organisation. L'écran **Access tokens** de la console propose les mêmes
capacités, celles de l'organisation sous **Organization access**. `rebase cloud tokens revoke <id> --yes` l'arrête aussitôt.

## Un backend sans compte

<span class="since-badge" data-since="0.26">Depuis 0.26</span>

Un agent qui a construit une app peut lui donner un backend en ligne avant que quiconque se soit
inscrit, et remettre à la personne pour qui il travaille un lien pour le garder :

```bash
rebase cloud init --claim
```

Cela provisionne un projet sur Rebase Cloud, définit `REBASE_BASE_URL` dans `.env` sur
son adresse en ligne, lie le répertoire, et déploie les collections locales avec
`rebase cloud deploy --bundle`. Il affiche l'URL en ligne, l'URL du panneau d'administration et une
**URL de réclamation**. Quiconque ouvre l'URL de réclamation et se connecte peut déplacer le projet dans
l'une de ses organisations. Le lien ne fonctionne qu'une fois. Un projet que personne ne réclame dans
les 72 heures est supprimé, base de données comprise. `rebase cloud claim` affiche de nouveau l'URL de
réclamation avec le temps restant, et `--open` l'ouvre. L'outil `rebase_cloud_provision` du serveur
MCP exécute la même commande et renvoie les mêmes URLs ;
ses autres outils cloud vérifient alors le projet, le déploient, lisent ses logs, définissent des variables et font un rollback
sans connexion (voir [Serveur MCP](/docs/ai/mcp#rebase-cloud)).

`REBASE_BASE_URL` dans `.env` est aussi l'adresse à laquelle `rebase api-keys`, `rebase storage`
et `rebase auth reset-password` envoient la clé de service locale, si bien qu'après `init
--claim` ils s'adressent au projet cloud, qui n'accepte pas cette clé. Ils le disent
lorsque cela se produit ; définissez `REBASE_BASE_URL` dans le shell pour atteindre un backend local
à la place.

Tant que le projet n'est pas réclamé, il n'appartient à aucun compte. Son jeton est restreint à
ce seul projet : il déploie, lit les logs et les métriques, définit des variables d'environnement
et exécute `db info`. Il ne relit rien de secret : ni la valeur d'une variable (clé de service
comprise), ni le mot de passe de la base de données, et il ne peut ouvrir ni
`db connect` ni un aperçu. Il est conservé dans
`~/.rebase/credentials.json`, jamais dans le dépôt, et les commandes `rebase cloud`
du répertoire lié l'utilisent d'elles-mêmes. `REBASE_TOKEN`, lorsqu'il est défini,
l'emporte quand même s'il détient une portée sur ce projet, et ces commandes avertissent qu'il l'a
fait ; lorsqu'il n'en détient aucune (un jeton de CI créé pour d'autres projets), le jeton propre au projet
est utilisé et la première commande le signale. Une commande à laquelle on donne `--project` pour
un autre projet conserve `REBASE_TOKEN`, et le déploiement qu'exécute `init --claim` utilise
toujours le jeton propre au projet. Il expire avec le projet. `rebase cloud whoami` dans ce répertoire montre le projet, ce que le
jeton peut faire, l'URL de réclamation et la date d'expiration du projet. Une commande qui a besoin de la
session d'une personne refuse avec `session_required` et conserve le jeton ; il n'est oublié
que lorsque le plan de contrôle le refuse partout, après une réclamation ou à l'expiration, et
l'URL de réclamation est affichée à ce moment-là. `rebase cloud status` montre aussi l'URL de réclamation et
l'expiration (`unclaimed` dans `--json`). `rebase cloud unlink`
ne supprime pas un projet non réclamé : il avertit que le projet continue de tourner
jusqu'à son expiration et affiche l'URL de réclamation, et `init --claim` dans un répertoire
déjà lié à un tel projet renvoie vers son URL de réclamation au lieu d'en provisionner un
second. Jusqu'à la réclamation, l'app n'atteint internet que sur les ports 80 et 443 ;
les ports de messagerie dont dispose tout autre projet (465, 587 et 993) sont ouverts lorsque le projet
est réclamé.

Une fois que le déploiement a construit l'app, la commande définit aussi `REBASE_API_TOKEN` dans
`.env` : une clé émise sur l'app elle-même, que le serveur MCP et le SDK
lui envoient. Un `REBASE_API_TOKEN` déjà présent dans `.env` est conservé et aucun n'est émis,
et un `.env` que la commande crée n'est lisible que par vous. Elle lit et écrit des données (`data:read`, `data:write`) à travers la
sécurité au niveau des lignes de l'app, en tant qu'appelant qui n'est ni une personne ni un administrateur. Elle ne
détient rien du plan d'administration, et elle expire avec la fenêtre de réclamation, sauf si le
projet est réclamé avant. Avec `--no-deploy`, ou lorsque ce premier déploiement échoue,
il n'y a pas encore de clé : le prochain `rebase cloud deploy` qui réussit dans le
répertoire en demande une, tant que le projet n'est pas réclamé et que `.env` ne définit pas déjà de
`REBASE_API_TOKEN`. `init`, `deploy`, `status` et `whoami` affichent la
date d'expiration.

La réclamation remet la clé : elle en supprime l'expiration, si bien que le `.env` de l'app
continue de fonctionner. L'agent en détient toujours une copie, la personne qui a réclamé le
projet peut donc la remplacer. `rebase cloud app-key rotate`, ou **Rotate app key** dans les
Settings du projet, émet une nouvelle clé et révoque aussitôt toutes les clés d'agent antérieures. Il écrit
la nouvelle clé dans un `.env` qui définit déjà `REBASE_API_TOKEN`,
ou l'affiche une fois. Les propriétaires et administrateurs la font pivoter, connectés. Une clé qui n'a pas pu
être remise conserve son expiration, ce qui arrive lorsque l'app n'était pas déployée ou
ne répondait pas au moment de la réclamation. La rotation la remplace par une clé qui n'expire pas.

La réclamation remplace aussi le `REBASE_SERVICE_KEY` du projet, qui est administrateur sur
l'API propre à l'app et que le code déployé de l'agent pouvait lire. L'app
redémarre une fois sur une nouvelle clé, et tout ce que l'agent avait conservé cesse de fonctionner lorsque
ce redémarrage est terminé. Si un déploiement est en cours au moment de la réclamation,
le prochain déploiement porte la nouvelle clé.

La réclamation exige une session de navigateur connectée, pas un jeton, et un moyen de paiement sur
l'organisation dans laquelle le projet est déplacé. À partir de la réclamation, le projet est
facturé comme n'importe quel autre. Réclamer révoque aussi le jeton de l'agent : connectez-vous avec
`rebase cloud login`, ou créez un nouveau jeton avec `rebase cloud tokens create`.

Le provisionnement sans compte est plafonné par adresse, par réseau (un /24 IPv4) et au total, et un plan de contrôle qui ne l'a pas activé refuse avec un
message qui le dit. L'usage antérieur à la réclamation n'est pas facturé à qui
réclame le projet.
