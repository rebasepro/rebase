---
sourceHash: 9d048d537401732a
title: rebase cloud
sidebar_label: rebase cloud
description: Les groupes de commandes pour Rebase Cloud dans la CLI — auth, liaison de projet, déploiements, notifications, configuration, organisations, bases de données, ressources, calcul, stockage, clusters, facturation et utilisation.
---

Tout ce qui concerne Rebase Cloud, actuellement en version bêta privée. Consultez le
[guide Rebase Cloud](/docs/deployment/cloud/) pour savoir de quoi il s'agit et ce que la version bêta
n'inclut pas.

Chaque groupe répond à `--help`, et `--help` n'exécute jamais la commande. La plupart des commandes
agissent sur le projet lié dans `.rebase/cloud.json` ; `--project <id>` opère sur
un projet sans liaison préalable.

Trois options s'appliquent partout : `--json` pour une sortie lisible par une machine (également la valeur
par défaut lors d'une redirection via pipe, sauf pour `deploy`, ou avec `REBASE_JSON=1`), `--url <origin>` pour cibler un
plan de contrôle spécifique (ou `REBASE_CLOUD_URL`), et `--project, -p <id>`.

## Auth

```bash
rebase cloud login      # sign in through the browser: a link and a code, approved in the console
rebase cloud login --no-browser   # print the link instead of opening it, e.g. over SSH
rebase cloud login --email me@example.com   # with your password instead
rebase cloud login --code   # with an emailed 6-digit code: accounts made with Google, GitHub or LinkedIn
rebase cloud logout     # sign out
rebase cloud whoami     # the current session, or what REBASE_TOKEN may do
rebase cloud access-token   # the bearer the CLI would send now, refreshed first; for scripts and the MCP server
rebase cloud tokens create --can deploy,logs   # a token for CI, shown once
rebase cloud tokens create --can billing --org <id>   # a token for an organization's billing
```

`--can` prend en charge `deploy`, `logs`, `env`, `database` et `backups` sur un projet
(`--project`, ou le projet lié), et `billing`, `audit` et
`notifications` sur une organisation : `--org`, sinon l'organisation du projet,
sinon celle sélectionnée. Un jeton peut ne détenir que des capacités d'organisation.
`logs` couvre également `usage`. La portée de chacun est détaillée dans
[CI et agents](/docs/deployment/cloud-agents/#ci-and-agents). Lorsque le plan de
contrôle marque la réponse à un jeton comme dépréciée (un jeton antérieur à `billing`
accédant à la facturation), la CLI affiche l'avertissement une seule fois sur stderr, jamais dans la
valeur `--json`.

Sans indicateur, `login` s'authentifie via le navigateur. Il affiche un code court et
un lien vers la console, ouvre le navigateur et attend que vous y approuviez la
connexion. Vous êtes déjà connecté à la console, ou vous vous connectez avec
l'une des méthodes proposées (mot de passe, Google, GitHub, LinkedIn). Vérifiez que le
navigateur affiche le même code avant de l'approuver. Le lien expire au bout de dix
minutes et n'est utilisable qu'une seule fois. Sans terminal ou avec `--json`, le lien et le code
sont envoyés sur stderr et `login` reste en attente, permettant à un agent de vous transmettre le lien. Une
connexion refusée se termine par `access_denied`, et une connexion expirée par `expired_token`.

Avec `--email`, `login` vous demande d'utiliser soit votre mot de passe, soit un code envoyé par
e-mail par le plan de contrôle. Si l'authentification à deux facteurs est activée, il vous demande ensuite votre
code d'authentification (ou un code de récupération) ; via le navigateur, approuvez la demande depuis une
session de console l'ayant déjà utilisé. Sans terminal, aucun des deux codes ne peut être saisi : définissez
`REBASE_TOKEN` avec un jeton d'accès créé dans la console sous Settings → Access
tokens. Voir [Rebase Cloud](/docs/deployment/cloud#link-a-project).

## Liaison de projet

```bash
rebase cloud link         # link this directory to a cloud project
rebase cloud link [url]   # or straight at a backend: no control plane, no login, and the rest of the family refuses until you unlink
rebase cloud unlink       # remove the link
rebase cloud use [org]    # select the active organization
rebase cloud open         # open the dashboard in a browser
```

### Connecter une instance auto-hébergée à Claude

```bash
rebase cloud connect https://your-app.com      # add it to your account; prints two variables, waits until it answers
rebase cloud connect --list                    # the instances you added, and whether each is connected
rebase cloud connect --remove https://your-app.com
```

Le [connecteur Rebase](/docs/ai/rebase-connector/) (`https://app.rebase.pro/mcp`)
y accède alors aux côtés de vos projets Cloud. `connect` affiche
`REBASE_PLATFORM_TOKEN_KEY` et `REBASE_PLATFORM_TOKEN_AUDIENCE` ; définissez-les sur
le serveur et redémarrez-le. Dans le dossier du projet, la commande propose de les inscrire dans
`.env`. La réexécuter est sans risque. `--name` nomme l'instance, `--org` choisit
l'organisation, `--no-wait` rend la main sans attendre. Réservé aux propriétaires et administrateurs.

## Projets

```bash
rebase cloud init --claim [--name <name>]   # a live backend with no account, and a link to claim it within 72 hours
rebase cloud claim [--open]                 # that link again, and how long is left
rebase cloud projects list
rebase cloud projects list --all-orgs   # every organization you belong to
rebase cloud projects create [--link]
rebase cloud projects info [id]
rebase cloud projects delete [id]
```

`claim` affiche le lien de revendication du projet approvisionné par `init --claim` dans ce
répertoire, ainsi que le temps restant avant sa suppression s'il n'est pas réclamé (`Unclaimed: deleted
in 41h`). `--open` l'ouvre également dans un navigateur. Le lien est conservé uniquement sur la
machine ayant exécuté `init --claim`, dans `~/.rebase/credentials.json` ; le plan de contrôle
en stocke un hash et ne peut pas l'afficher à nouveau. Avant de répondre, `claim`
demande au plan de contrôle si le jeton propre au projet fonctionne toujours. Une revendication
révoque ce jeton ; ainsi, dès que quelqu'un a revendiqué le projet, `claim` refuse
avec `already_claimed` au lieu d'afficher un lien inactif. La commande refuse également une fois le
délai écoulé (`claim_expired`), ainsi que dans un répertoire ne comportant aucun lien de revendication
(`no_claim_link`). `rebase cloud status` et `rebase cloud whoami` affichent le même
lien tant que le projet n'est pas revendiqué.

## Déployer et observer

```bash
rebase cloud deploy [app] [--source .]   # deploy an app and stream build logs
rebase cloud deploy [app] --preview [--preview-name <name>]  # its own address; production untouched
rebase cloud previews [list|delete <name>]
rebase cloud logs [--runtime] [-f] [--preview [name]]  # build log, or what the app prints
rebase cloud deployments list [--limit N|--all]
rebase cloud rollback [id] [-y]          # back to a successful deploy
rebase cloud cancel [-y]                 # cancel the in-flight build
rebase cloud start | stop | restart [-y] # stop and restart need -y
rebase cloud status                      # one-glance project status
rebase cloud metrics                     # live CPU / memory / disk, realtime per instance
rebase cloud debug [health|logs|…]       # diagnose a deployment, read-only
```

`deploy` sans nom d'application déploie le backend. Le déploiement d'un bundle
backend téléverse également les sources du projet — ce que git suit, jamais de `.env` — afin qu'une
mise à niveau de la plateforme puisse le recompiler ; `--no-source` ignore cette étape pour une fois, et `cloud settings set
--platform-rebuilds off` la désactive et supprime la copie stockée. `--allow-downgrade` déploie une version antérieure.

Un `deploy` suivi se termine par un récapitulatif : chaque application déployée avec son URL,
l'ID de déploiement, le temps écoulé, et si la nouvelle version y répond. Il
attend jusqu'à `--live-timeout` secondes (60 par défaut ; `0` ignore la vérification) que le
`/health` d'un backend et l'adresse de chaque application statique répondent. Un déploiement échoué
se termine sur une ligne indiquant l'application et la raison, avec un code de sortie différent de zéro. Le récapitulatif
s'affiche même en cas de redirection (pipe) ; `--json` (ou `REBASE_JSON=1`) affiche à la place un objet unique,
contenant `apps`, `hosts`, `live`, `liveChecks` et `durationMs`.

Avant le téléversement, `deploy` analyse le JavaScript de chaque application statique déployée :
les fichiers `.js`/`.mjs`/`.cjs` dans son `output` et les blocs `<script>` intégrés dans
son HTML. Une erreur de syntaxe interrompt le déploiement en indiquant `file:line:column` (code
`syntax_error` avec `--json`), et `--no-verify` ignore cette vérification. Un déploiement réussi
se termine en indiquant la commande de retour en arrière, `rebase cloud rollback`. Une application statique déployée
seule ne peut pas encore faire l'objet d'un rollback ; voir
[Roll back](/docs/deployment/cloud#roll-back).

`--preview` sert le build à l'adresse `https://<project>--<name>.rebase.website` et
ne touche pas à la production. Une prévisualisation du backend exécute son propre backend, sur sa
propre base de données vide, avec ses applications statiques intégrées. Une application statique ne peut pas encore être
prévisualisée seule sur Rebase Cloud : `rebase cloud deploy <app> --preview`
est refusé avec `PREVIEW_STATIC_UNSERVED` et ne publie rien. Une prévisualisation de backend
est facturée comme une unité d'application supplémentaire à la taille par défaut pendant toute sa durée d'existence, et
le déploiement indique le coût mensuel correspondant selon l'estimation du plan de contrôle
(`cost` avec `--json` ; uniquement la règle et ce lien si le plan de contrôle ne peut pas en
calculer le prix) ; `rebase cloud previews delete <name>` l'arrête. `rebase cloud previews`
affiche une prévisualisation mise en pause par la plateforme (sa base de données a dépassé la limite de prévisualisation) sous
l'état `paused`, avec la raison (`statusMessage` avec `--json`). Une nouvelle adresse de prévisualisation
peut être refusée avec `preview_cert_budget` lorsque le quota hebdomadaire de certificats de
prévisualisation de la plateforme est épuisé ; le message précise jusqu'à quand.
Voir [Prévisualiser une modification](/docs/deployment/cloud/#preview-a-change).

### Logs

`rebase cloud logs` affiche le dernier journal de build, et `-f` suit en temps réel un build
en cours d'exécution. `--runtime` lit plutôt ce que l'application affiche, depuis chaque pod
associé, chaque ligne étant étiquetée avec son pod :

```bash
rebase cloud logs --runtime -f                    # follow until Ctrl-C (exits 0)
rebase cloud logs --runtime --since 15m --grep timeout
rebase cloud logs --runtime -f --level error      # errors only
rebase cloud logs --runtime --previous            # a restarted container's last run
```

- `--since` prend une durée (`30s`, `5m`, `1h`) ou une heure au format RFC3339.
- `--tail <n>` correspond au nombre de lignes par pod à partir duquel commencer (le plan de contrôle le plafonne à 2000).
- `--grep` conserve les lignes contenant le texte, quelle que soit la casse ; écrivez `/re/flags` pour une
  expression régulière.
- `--level error|warn|info|debug` conserve les lignes ayant ce niveau de gravité ou pire. Il analyse
  le champ structuré `severity` consigné par un backend Rebase, un mot de niveau au début d'une
  ligne brute, ou un format d'erreur tel que `TypeError:`. Les lignes n'en comportant aucun sont ignorées.

Le suivi effectue un sondage toutes les deux secondes et affiche chaque ligne une seule fois. Il annonce les pods
qui démarrent, s'arrêtent ou redémarrent. Lorsqu'un conteneur redémarre, il affiche également les dernières
lignes de l'instance qui s'est arrêtée, là où se trouve généralement la cause. Il attend tant qu'aucun
pod n'est en cours d'exécution, et après une déconnexion, il réessaie avec un recul exponentiel (backoff) et
reprend là où il s'était arrêté. Avec `--json`, le suivi affiche un objet JSON par
ligne (NDJSON) : `{"type":"line","ts","pod","text"}` pour chaque ligne de log, et
`{"type":"event","event":…}` pour le reste.

`--preview <name>` lit une prévisualisation au lieu de la production. Utilisez le nom de
la prévisualisation ou l'ID de déploiement affiché lors du déploiement de la prévisualisation. Utilisé seul, `--preview`
lit l'unique prévisualisation du projet. Une prévisualisation statique dispose d'un journal de build mais pas de
journal d'exécution (runtime), car elle n'exécute aucun serveur.

## Configuration

```bash
rebase cloud env list | set | unset | reveal | pull
rebase cloud domains list | add <domain> | verify [domain] | remove <domain>
rebase cloud extensions list | enable | disable
rebase cloud settings show | set        # name, branch, repo, subdomain, rebuilds
rebase cloud app-key [rotate]           # the app key init --claim wrote; owners and admins
rebase cloud service-key [rotate]       # REBASE_SERVICE_KEY; owners and admins
```

`app-key` répertorie la
clé que `rebase cloud init --claim` a générée sur l'application et inscrite dans `.env` sous
`REBASE_API_TOKEN`, en affichant son préfixe et jamais sa valeur. La revendication du projet
transfère cette clé, qui cesse alors d'expirer. `app-key rotate` en génère une nouvelle et
révoque toutes les clés d'agent antérieures d'un coup. Elle écrit la nouvelle clé dans un `.env`
définissant déjà `REBASE_API_TOKEN`, et l'exclut de `--json` dans ce cas. Dans
tout autre répertoire, elle affiche la clé une seule fois. Les clés créées dans le panneau d'administration de l'application
ne sont pas modifiées. La commande s'exécute avec vos identifiants de connexion : aucune capacité de jeton ne peut l'autoriser.

`service-key`
affiche la génération de la clé `REBASE_SERVICE_KEY` du projet, la date de sa dernière
rotation, et si l'application est toujours en cours de redémarrage pour utiliser la plus récente. Elle ne
communique jamais la clé : cela se fait via `env reveal REBASE_SERVICE_KEY`. `service-key rotate`
émet une nouvelle clé et redémarre l'application dessus. L'ancienne clé fonctionne jusqu'à la fin
du redémarrage, et plus du tout après. La commande est refusée pendant qu'un déploiement est en
cours, et elle s'exécute avec vos identifiants de connexion. Revendiquer un projet effectue également la rotation de sa
clé de service.

Une prévisualisation backend démarre à partir des variables de production, clés actives incluses.
`env set KEY=VALUE --preview` attribue une valeur propre aux prévisualisations, `env unset KEY
--preview` exclut la variable de celles-ci, `env reset KEY --preview` rétablit
la valeur de production, et `env list --preview` affiche les différences.
La production n'est jamais modifiée par aucune de ces commandes.

`env set KEY --stdin` lit la valeur depuis l'entrée standard plutôt que depuis la
ligne de commande, où `ps` et l'historique de votre shell la rendraient visible :

```bash
read -rs STRIPE_KEY   # paste the value; nothing is echoed
printf %s "$STRIPE_KEY" | rebase cloud env set STRIPE_KEY --stdin --secret
```

Un saut de ligne final éventuel est supprimé. La fonction `rebase_cloud_env_set` du
serveur MCP définit les valeurs de cette façon.

## Organisations

```bash
rebase cloud orgs list | create
rebase cloud orgs members [list] | invite <email> [--role admin|member] | remove <email|uid> | role <email|uid> <role>
rebase cloud orgs invites [list] | revoke <id|email> | resend <id|email>
rebase cloud activity [--project <id|slug>] [--action <area|action>] [--actor <email>] [--limit N] [--before <cursor>]
```

`members invite` crée une invitation et affiche son lien : à usage unique,
valable 7 jours, accepté uniquement par un compte ayant validé cette adresse.
Personne ne rejoint l'organisation tant que l'invitation n'est pas acceptée, même une personne possédant déjà un compte Rebase.
La sortie (et `emailDelivery` dans `--json`) indique si le lien a été envoyé par e-mail ; si
ce n'est pas le cas, un avertissement vous invite à envoyer le lien vous-même. `--role` peut être `admin` ou
`member` (par défaut). Personne ne peut être invité en tant que `owner` : invitez-le en tant qu'administrateur, et
un propriétaire le promouvra via `members role <email> owner` une fois qu'il aura rejoint l'organisation.
`invites resend` génère un nouveau lien et l'ancien cesse de fonctionner.
L'invitation et `invites` nécessitent une session `rebase cloud login` ; `REBASE_TOKEN` est
refusé. Inviter, lister, renvoyer et révoquer nécessitent le rôle de propriétaire ou d'administrateur ;
un membre en est informé le cas échéant.
`members remove` demande confirmation préalable (`--yes` l'ignore) ; supprimer ou rétrograder un propriétaire
nécessite d'être propriétaire, et le dernier propriétaire ne peut être supprimé. `--org <id>` choisit une organisation
autre que celle sélectionnée.

`activity` est le journal d'audit de l'organisation sélectionnée, du plus récent au plus ancien : qui a
déployé, effectué un rollback, défini, supprimé ou révélé une variable d'environnement (par son
nom, jamais par sa valeur), modifié un domaine, créé, restauré ou téléchargé une
sauvegarde, modifié les ressources de calcul d'un projet, arrêté ou supprimé un projet, modifié le
rôle d'un membre, ou créé ou révoqué un jeton d'accès. `--action` prend un domaine
(`deploy`, `deploy_hook`, `env`, `domain`, `backup`, `pitr`, `database`,
`extension`, `storage`, `project`, `org`, `member`, `invite`, `token`) ou une action complète
comme `env.set`. Une page contient jusqu'à 100 entrées (`--limit`, 50 par défaut) ; la
sortie affiche le curseur `--before` pour la page suivante. `--json` renvoie une seule valeur,
`{ org, events, nextCursor }`. Cette commande nécessite le rôle de propriétaire ou d'administrateur de l'organisation.
Un jeton ne peut la lire qu'avec la capacité `audit` sur l'organisation
(`rebase cloud tokens create --can audit`). La page **Activity** de la console
affiche le même journal.

## Bases de données

```bash
rebase cloud db list | create | info | connect | test
rebase cloud db backup list | create | restore | status | download
rebase cloud db pitr status | restore | cutover | discard
```

`db connect` ouvre un port local qui *est* la base de données gérée (aucun point de terminaison
public) jusqu'à l'interruption par Ctrl-C ; `--reveal` ajoute le mot de passe. Réservé aux propriétaires ou administrateurs.

## Invités

Chaque appel à `signInAnonymously()` lors d'un test, par un robot ou lors d'une visite abandonnée laisse une ligne
dans les utilisateurs du projet. Ces commandes comptent ces lignes et les suppriment, évitant
d'avoir à les parcourir une par une.

```bash
rebase cloud guests                              # how many, and the ones last seen longest ago
rebase cloud guests --older-than 30d --limit 100 # the ones not seen for 30 days
rebase cloud guests delete <id>                  # one guest; asks first
rebase cloud guests prune --older-than 30d       # dry run: how many would go
rebase cloud guests prune --older-than 30d --yes # deletes them
```

`prune` prend une durée avec une unité : `45m`, `12h`, `30d` ou `2w`. Sans `--yes`, la commande
compte les entrées sans rien supprimer. Elle traite un projet de n'importe quelle taille par petits
lots.

Seuls les invités peuvent être supprimés. Un invité est une ligne avec `is_anonymous` activé, sans mot de passe et sans
identité liée, et l'application applique cette règle dans l'instruction qui supprime la
ligne, de sorte que la commande ne peut pas toucher à un compte, même inscrit un moment
après le listing. `delete` refuse un compte avec l'erreur `NOT_ANONYMOUS`.

**Last seen** correspond au moment où la session de l'invité a été émise ou actualisée pour la dernière fois, ou à la
date de création de l'invité s'il ne dispose plus d'aucun jeton d'actualisation. Un invité qui revient régulièrement
n'est pas considéré comme ancien, quelle que soit sa date de création. Les jetons d'actualisation d'un invité
supprimé ainsi que toute autre ligne d'authentification associée sont supprimés avec lui.

Les lignes de vos propres tables suivent leur clé étrangère :

| La colonne | Ce qui arrive à la ligne |
|---|---|
| Liaison facultative (`ON DELETE SET NULL`, par défaut) | Conservée, avec la liaison vidée |
| Liaison obligatoire (`ON DELETE RESTRICT`, par défaut) | Conservée, et l'invité avec elle : l'invité est signalé comme ignoré, avec `GUEST_REFERENCED` |
| `onDelete: "cascade"` | Supprimée avec l'invité |
| Aucune clé étrangère (un champ `userSelect`, un identifiant simple) | Conservée, contenant un identifiant qui n'existe plus |

Vérifiez lesquelles de vos liaisons sont en cascade avant de passer `--yes` : cette action est irréversible.

La commande lit `REBASE_SERVICE_KEY` de la même manière que `env reveal` ; elle requiert donc d'être
propriétaire ou administrateur (ou d'utiliser un jeton doté de la capacité `env` appartenant à l'un d'eux). La
clé reste en mémoire et n'est transmise qu'à l'adresse propre du projet. Un projet exécutant un
runtime plus ancien est averti qu'il doit utiliser une version plus récente.

## Ressources

Ce que la plateforme détient pour le projet, par rapport à ce que son code déclare.

```bash
rebase cloud resources                       # each database and bucket: declared? provisioned?
rebase cloud resources prune database <key>  # remove one the code no longer declares
```

Un déploiement ne supprime jamais une base de données approvisionnée lorsque sa déclaration disparaît — cela
reviendrait à supprimer des données lors d'un simple push. La plateforme la conserve, la relie et la facture jusqu'à ce que quelqu'un
la nettoie explicitement par son nom via `prune`.

## Calcul

Ce que le projet réserve, et ce que cela coûte.

```bash
rebase cloud compute            # the current reservation and its monthly cost
rebase cloud compute set        # change it
```

`compute set` prend `--cpu`, `--memory`, `--replicas`, `--spot`,
`--db-instances`, `--db-cpu`, `--db-memory`,
`--storage`, `--autoscale-max`, `--autoscale-cpu-target` et `--no-autoscale`.
`--scale-to-zero` est obsolète : chaque backend exécute au moins une instance, donc
`true` est refusé et `false` est ignoré avec un avertissement. Il n'y a pas de paliers
d'abonnements : tout est tarifié à la ressource. Voir
[Rebase Cloud](/docs/deployment/cloud/).

## Stockage, notifications, clusters, facturation et utilisation

```bash
rebase cloud storage             # list storage buckets
rebase cloud storage create      # provision platform-managed storage
rebase cloud storage attach      # attach your own S3-compatible bucket
rebase cloud notifications [list] | add <url> | test <id> | remove <id>   # deploy, backup, billing and usage events to Slack, Discord or any URL
rebase cloud webhooks            # retired: exits 1 (`command_retired`) and names `notifications`
rebase cloud clusters list | add | verify | registry   # the clusters tenants run on; `add` registers one from a kubeconfig
rebase cloud billing             # the billing account and card on file
rebase cloud billing setup       # attach a card, one-time, opens a browser
rebase cloud billing checkout    # a Stripe session for one project
rebase cloud billing invoices [--limit N]   # issued invoices, newest first, with Stripe's hosted page
rebase cloud billing upcoming    # a preview of each subscription's next invoice
rebase cloud usage [--month YYYY-MM]   # requests used this month against the allowance, and the overage so far
rebase cloud usage org           # every project of the selected organization, with the total
```

`notifications add <url>` envoie les événements du projet lié à une URL. `--events`
prend une liste séparée par des virgules parmi `deploy.failed` (par défaut),
`deploy.succeeded`, `deploy.rolled_back`, `backup.unhealthy`,
`billing.payment_failed`, `usage.threshold` et `preview.paused`. `--format slack` envoie
uniquement `{ "text" }` au lieu du JSON de l'événement, qui contient également un champ `text`. L'URL
est un argument positionnel car `--url` sert à désigner le plan de contrôle. `add` affiche
le secret de signature une seule fois ; `--json` renvoie `{ projectId, webhook, secret }`.
`test <id>` se termine avec le code de sortie 1 et le code `delivery_failed` lorsque le destinataire n'a pas accepté
l'événement de test. La consultation de la liste est ouverte à tout membre de l'organisation ; `add`, `test`
et `remove` nécessitent le rôle de propriétaire ou d'administrateur. Un jeton les gère avec la
capacité `notifications` sur l'organisation, selon les mêmes règles de rôle. Voir
[Notifications Cloud](/docs/deployment/cloud-notifications/).

`clusters registry <cluster-id> --repository <host/project/repo>
--push-service-account <email> --pull-key-file <key.json>` attribue au cluster
propre d'un client son propre registre d'images, utilisé pour ce seul cluster. Sans
registre dédié, un tel cluster utilise le registre partagé de la plateforme, et chaque déploiement sur celui-ci
l'indique dans ses logs. Lorsqu'il en possède un, les builds poussent vers ce dépôt avec un jeton pour
ce compte, les pods effectuent des pulls avec cette seule clé, et un rollback accepte les
images du projet présentes sur ce registre. Les images
précédemment compilées par le projet dans le registre partagé restent récupérables et demeurent
des cibles de rollback valides. Les trois valeurs vont de pair ; `--clear` les efface. La clé
est scellée lors de son écriture et n'est jamais relue. Comme pour le reste de `clusters`,
cela requiert le rôle d'administrateur de plateforme (platform-admin). L'opérateur crée le dépôt et les deux
comptes à l'aide de Terraform (`saas/infra/gcp/registry-linked-clusters.tf`).

`billing invoices` et `billing upcoming` lisent les mêmes données Stripe que la
page Facturation (Billing) de la console, et ne sont accessibles qu'aux propriétaires et administrateurs
de l'organisation. Un jeton y accède, ainsi qu'au reste de `billing`, via la capacité `billing`
sur l'organisation ; un jeton créé avant l'introduction de cette capacité continue de
fonctionner pendant une version, avec un avertissement sur chaque réponse. Les montants dans `--json` sont exprimés dans la sous-unité de la devise (centimes), exactement tels que
Stripe les transmet. Les factures à l'état de brouillon ne sont pas répertoriées ; la prévisualisation est calculée par
Stripe et ses lignes à l'usage continuent d'augmenter jusqu'à la clôture de la période.

`usage` lit la consommation du projet lié (ou `--project`) au cours d'un mois
civil, en UTC : requêtes par rapport au forfait inclus, erreurs 5xx, le dépassement
actuel en euros et, pour le mois en cours, sa projection à ce
rythme (une estimation). Le dépassement correspond au calcul propre du rapport de dépassement,
celui qui indique à Stripe quoi facturer, et qui apparaît sur la facture du mois suivant.
`usage org` liste tous les projets de l'organisation sélectionnée avec `rebase cloud
use`, ainsi que le total. N'importe quel membre de l'organisation peut le lire. Un jeton le lit
avec la capacité `logs` sur le projet ; `usage org` liste les projets pour lesquels le
jeton détient cette capacité.
`--month` accepte un mois passé. La réponse comporte des `caveats`, chacun avec un `code` : `storage_not_measured`
(le stockage d'objets affiche 0), `multi_pod_undercount` (les requêtes traitées pendant que deux pods
d'application ou plus s'exécutent ne sont pas comptabilisées), `partial_days`, `metering_off`,
`overage_billing_off`, `not_billed`, `billed_next_month`, `pre_claim_days` (un
projet revendiqué depuis un agent ne compte que les jours à partir de la revendication) et
`autoscale_not_charged` (des pods ont fonctionné au-delà de `--replicas` et cette plateforme ne les
facture pas encore). La réponse pour un projet avec dimensionnement automatique comporte également `autoscale` :
`extraPodSeconds` au-dessus du seuil de base, `amountEur` selon ses tarifs, et `charged`.
