---
sourceHash: 8ba7c94e0a895b48
title: rebase cloud
sidebar_label: rebase cloud
description: Les groupes de commandes pour Rebase Cloud dans la CLI — auth, liaison de projet, déploiements, notifications, configuration, organisations, bases de données, ressources, calcul, stockage, clusters, facturation et utilisation.
---

Tout ce qui concerne Rebase Cloud, actuellement en bêta privée. Consultez le
[guide Rebase Cloud](/docs/deployment/cloud/) pour savoir ce que c'est et ce que la bêta
n'inclut pas.

Chaque groupe répond à `--help`, et `--help` n'exécute jamais la commande. La plupart des commandes
agissent sur le projet lié dans `.rebase/cloud.json` ; `--project <id>` opère sur
un projet sans liaison préalable.

Trois options s'appliquent partout : `--json` pour une sortie lisible par une machine (également la
valeur par défaut lorsqu'un pipe est utilisé, sauf pour `deploy`, ou avec `REBASE_JSON=1`), `--url <origin>` pour cibler un
plan de contrôle spécifique (ou `REBASE_CLOUD_URL`), et `--project, -p <id>`.

## Authentification

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

`--can` accepte `deploy`, `logs`, `env`, `database` et `backups` sur un projet
(`--project`, ou celui lié), et `billing`, `audit` et
`notifications` sur une organisation : `--org`, sinon l'organisation du projet,
sinon celle sélectionnée. Un jeton ne peut détenir que des capacités d'organisation.
`logs` couvre également `usage`. La portée de chacun est détaillée dans
[CI et agents](/docs/deployment/cloud-agents/#ci-and-agents). Lorsque le plan de
contrôle marque la réponse à un jeton comme obsolète (par exemple, un jeton créé avant l'existence de `billing`
qui consulte la facturation), la CLI affiche l'avertissement une seule fois sur stderr, jamais dans la
valeur `--json`.

Sans options, `login` effectue la connexion via le navigateur. Il affiche un code court et
un lien vers la console, ouvre le navigateur et attend que vous approuviez la
connexion à cet endroit. Vous devez déjà être connecté à la console, ou vous connecter avec
l'une des méthodes proposées (mot de passe, Google, GitHub, LinkedIn). Vérifiez que le
navigateur affiche le même code avant de l'approuver. Le lien expire au bout de dix
minutes et ne fonctionne qu'une seule fois. Sans terminal, ou avec `--json`, le lien et le code
sont envoyés sur stderr et `login` continue d'attendre, permettant à un agent de vous transmettre le lien. Une
connexion refusée se termine par `access_denied`, et une connexion expirée par `expired_token`.

Avec `--email`, `login` demande s'il faut utiliser votre mot de passe ou un code que le plan de
contrôle vous envoie par e-mail. Si l'authentification à deux facteurs est activée, il demande ensuite votre
code d'authentification (ou un code de récupération) ; via le navigateur, approuvez la demande depuis une
session de console qui l'a utilisé. Sans terminal, aucun code ne peut être saisi : définissez
`REBASE_TOKEN` avec un jeton d'accès créé dans la console sous Settings → Access
tokens. Consultez [Rebase Cloud](/docs/deployment/cloud#link-a-project).

## Liaison de projet

```bash
rebase cloud link         # link this directory to a cloud project (picked from a list)
rebase cloud link <slug>  # link the project with that slug or id, as --project <slug> does
rebase cloud link [url]   # or straight at a backend: no control plane, no login, and the rest of the family refuses until you unlink
rebase cloud unlink       # remove the link
rebase cloud use [org]    # select the active organization
rebase cloud open         # open the dashboard in a browser
```

Les commandes d'organisation (`orgs`, `billing`, `usage org`, `activity`,
`projects create`, `tokens create --can billing`) agissent sur `--org <id>`, sinon sur
l'organisation sélectionnée par `cloud use`, sinon sur l'organisation du projet lié. Dans
ce dernier cas, elles indiquent celle qui a été utilisée. `orgs delete` ne l'extrait jamais
du lien : elle nécessite `--org` ou une organisation sélectionnée.

### Connecter une instance auto-hébergée à Claude

```bash
rebase cloud connect https://your-app.com      # add it to your account; prints two variables, waits until it answers
rebase cloud connect --list                    # the instances you added, and whether each is connected
rebase cloud connect --remove https://your-app.com
```

Le [connecteur Rebase](/docs/ai/rebase-connector/) (`https://app.rebase.pro/mcp`)
peut ensuite y accéder aux côtés de vos projets Cloud. `connect` affiche
`REBASE_PLATFORM_TOKEN_KEY` et `REBASE_PLATFORM_TOKEN_AUDIENCE` ; définissez-les sur
le serveur et redémarrez-le. Dans le dossier du projet, il propose de les écrire dans
`.env`. La réexécuter est sans risque. `--name` nomme l'instance, `--org` choisit
l'organisation, `--no-wait` rend la main sans attendre. Propriétaires et administrateurs.

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

`claim` affiche le lien de réclamation du projet provisionné par `init --claim` dans ce
répertoire, ainsi que le temps restant avant sa suppression s'il n'est pas réclamé (`Unclaimed: deleted
in 41h`). `--open` l'ouvre également dans un navigateur. Le lien est conservé uniquement sur la
machine ayant exécuté `init --claim`, dans `~/.rebase/credentials.json` ; le plan de contrôle
en stocke un hash et ne peut pas l'afficher à nouveau. Avant de répondre, `claim`
demande au plan de contrôle si le jeton propre au projet fonctionne toujours. Une réclamation
révoque ce jeton, de sorte qu'une fois le projet réclamé par quelqu'un, `claim` refuse
avec `already_claimed` au lieu d'afficher un lien mort. Il refuse également lorsque le
délai est écoulé (`claim_expired`), ainsi que dans un répertoire ne comportant aucun lien de réclamation
(`no_claim_link`). `rebase cloud status` et `rebase cloud whoami` affichent le même
lien tant que le projet n'est pas réclamé.

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

`deploy` sans nom d'application déploie le backend. Un déploiement de bundle backend
téléverse également le code source du projet — ce que git suit, jamais de `.env` — afin qu'une
mise à niveau de la plateforme puisse le reconstruire ; `--no-source` ignore cette étape pour une fois, et `cloud settings set
--platform-rebuilds off` la désactive et supprime la copie stockée. `--allow-downgrade` déploie une version plus ancienne.

Une mise à niveau de la plateforme peut reconstruire une application gérée sur une version de `@rebasepro` plus
récente que celle fixée dans votre copie locale. Un déploiement depuis cette copie réinstallerait l'ancien panneau
d'administration et l'ancien pilote, il est donc refusé avant toute construction, en indiquant la
commande de correction (`rebase upgrade --to <version>`). `rebase cloud status`
signale cela plus tôt : une ligne `Rebuilt on`, et dans `--json`,
`runtime.platformRebuiltVersion` et `frameworkDrift`.

Un `deploy` suivi se termine par un résumé : chaque application déployée avec son URL, l'ID
de déploiement, le temps écoulé, et si la nouvelle version y répond. Il
attend jusqu'à `--live-timeout` secondes (60 par défaut ; `0` ignore la vérification) que le
`/health` du backend et l'adresse de chaque application statique répondent. Un déploiement échoué
se termine par une ligne indiquant l'application et la raison, et quitte avec un code d'erreur non nul. Le résumé
s'affiche même en cas de redirection via pipe ; `--json` (ou `REBASE_JSON=1`) affiche à la place un objet unique,
avec `apps`, `hosts`, `live`, `liveChecks` et `durationMs`. Un hôte dont le certificat
HTTPS n'est pas encore émis est signalé comme non actif (not live), avec cette raison.

Avant le téléversement, `deploy` analyse le JavaScript de chaque application statique déployée :
les fichiers `.js`/`.mjs`/`.cjs` dans son répertoire `output` et les blocs `<script>` intégrés dans
son code HTML. Une erreur de syntaxe interrompt le déploiement en indiquant `file:line:column` (code
`syntax_error` sous `--json`), et `--no-verify` ignore cette vérification. Un déploiement réussi
se termine en indiquant comment revenir en arrière : `rebase cloud rollback`. Une application statique déployée
seule ne peut pas encore faire l'objet d'un retour arrière ; voir
[Retour arrière](/docs/deployment/cloud#roll-back).

`--preview` sert le build sur `https://<project>--<name>.rebase.website` et
ne modifie pas la production. Une prévisualisation du backend exécute son propre backend, sur
sa propre base de données vide, avec ses applications statiques intégrées. Une application statique ne peut pas encore être
prévisualisée seule sur Rebase Cloud : `rebase cloud deploy <app> --preview`
est refusé avec `PREVIEW_STATIC_UNSERVED` et ne publie rien. Une prévisualisation de backend
est facturée comme une unité d'application supplémentaire à la taille par défaut pendant toute sa durée de vie, et
le déploiement indique le coût mensuel correspondant d'après l'estimation du plan de contrôle
(`cost` sous `--json` ; uniquement la règle et ce lien si le plan de contrôle ne peut pas
en calculer le prix) ; `rebase cloud previews delete <name>` l'arrête. `rebase cloud previews`
affiche une prévisualisation mise en pause par la plateforme (sa base de données ayant dépassé la limite de prévisualisation) sous l'état
`paused`, accompagnée de la raison (`statusMessage` sous `--json`). Une nouvelle adresse de prévisualisation
peut être refusée avec `preview_cert_budget` lorsque le quota hebdomadaire de certificats de
prévisualisation de la plateforme est épuisé ; le message précise jusqu'à quand.
Consultez [Prévisualiser une modification](/docs/deployment/cloud/#preview-a-change).

### Logs

`rebase cloud logs` affiche le dernier journal de build, et `-f` suit en temps réel un build en
cours d'exécution. `--runtime` lit à la place ce que l'application affiche, depuis chaque pod
sous-jacent, chaque ligne étant étiquetée avec son pod :

```bash
rebase cloud logs --runtime -f                    # follow until Ctrl-C (exits 0)
rebase cloud logs --runtime --since 15m --grep timeout
rebase cloud logs --runtime -f --level error      # errors only
rebase cloud logs --runtime --previous            # a restarted container's last run
```

- `--since` prend une durée (`30s`, `5m`, `1h`) ou une heure au format RFC3339.
- `--tail <n>` correspond au nombre de lignes par pod à partir duquel commencer (le plan de contrôle le plafonne à 2000).
- `--grep` conserve les lignes contenant le texte, sans tenir compte de la casse ; utilisez `/re/flags` pour une
  expression régulière.
- Avec `--grep` ou `--level`, le filtre recherche dans chaque ligne renvoyée par le plan de contrôle
  pour la fenêtre donnée (les 2000 plus récentes de chaque pod), et `--tail` compte les lignes correspondantes :
  les `n` correspondances les plus récentes par pod, 500 par défaut. Lorsqu'un pod a généré plus
  de lignes que cela dans la fenêtre, la sortie signale que les plus anciennes n'ont pas
  été analysées (`filter.scanCapped` sous `--json`).
- `--level error|warn|info|debug` conserve les lignes de cette gravité ou pire. Il lit
  la `severity` structurée enregistrée par un backend Rebase, un mot de niveau au début d'une
  ligne brute, ou un motif d'erreur tel que `TypeError:`. Les lignes sans indication sont omises.

Un suivi (`follow`) interroge toutes les deux secondes et affiche chaque ligne une seule fois. Il signale les pods
qui démarrent, s'arrêtent ou redémarrent. Lorsqu'un conteneur redémarre, il affiche également les dernières
lignes de l'instance qui s'est arrêtée, là où se trouve généralement la cause. Il patiente tant qu'aucun
pod n'est en cours d'exécution, et après une interruption de connexion, il réessaie avec un backoff et
reprend là où il s'était arrêté. Avec `--json`, un suivi affiche un objet JSON par
ligne (NDJSON) : `{"type":"line","ts","pod","text"}` pour chaque ligne de log, et
`{"type":"event","event":…}` pour le reste.

`--preview <name>` lit les logs d'une prévisualisation au lieu de la production. Utilisez le nom
de la prévisualisation ou l'ID de déploiement affiché lors du déploiement de celle-ci. Utilisé seul, `--preview`
lit l'unique prévisualisation du projet. Une prévisualisation statique dispose d'un log de build mais d'aucun
log d'exécution, car elle ne fait tourner aucun serveur.

## Configuration

```bash
rebase cloud env list | set | unset | reveal | pull
rebase cloud domains list | add <domain> | verify [domain] | remove <domain>
rebase cloud extensions list | enable | disable
rebase cloud settings show | set        # name, branch, repo, subdomain, rebuilds
rebase cloud app-key [rotate]           # the app key init --claim wrote; owners and admins
rebase cloud service-key [rotate]       # REBASE_SERVICE_KEY; owners and admins
rebase cloud service-key [rotate] --preview <name>  # a backend preview's own key
```

`domains add` pour un hôte dont dispose déjà le projet, comme un hôte qu'un déploiement a
enregistré depuis `rebase.json`, affiche les enregistrements DNS et l'état de cet hôte tout comme un
nouvel ajout ; `--json` ajoute `alreadyRegistered: true`. Un hôte vérifié est
servi en HTTPS dès que son certificat est émis, quelques minutes après
la vérification. D'ici là, l'ingress répond avec un certificat temporaire,
et `domains list`, `domains verify` et `status` indiquent
`verified, certificate pending` plutôt que 'live'. La CLI vérifie cela à l'aide d'une
négociation TLS sur chaque hôte vérifié ; `--json` transmet cette information dans `certificate`
(`ready`, `pending` ou `unreachable`, avec une `reason`).

`app-key` liste la
clé créée par `rebase cloud init --claim` sur l'application et écrite dans `.env` sous le nom
`REBASE_API_TOKEN`, en affichant son préfixe et jamais sa valeur. Réclamer le projet
transfère cette clé et supprime son expiration. `app-key rotate` en génère une nouvelle et
révoque immédiatement toutes les clés d'agents antérieures. Elle écrit la nouvelle clé dans un fichier `.env`
définissant déjà `REBASE_API_TOKEN`, et l'exclut du `--json` dans ce cas. Dans
tout autre répertoire, elle affiche la clé une seule fois. Les clés créées dans le panneau d'administration de l'application
ne sont pas modifiées. La commande s'exécute avec votre session de connexion : aucune capacité de jeton ne peut l'autoriser.

`service-key`
affiche la génération de la clé `REBASE_SERVICE_KEY` du projet, la date de sa dernière
rotation, et indique si l'application est toujours en train de redémarrer sur la plus récente. Elle n'affiche
jamais la clé elle-même : pour cela, utilisez `env reveal REBASE_SERVICE_KEY`. `service-key rotate`
émet une nouvelle clé et redémarre l'application sur celle-ci. L'ancienne clé fonctionne jusqu'à ce que le
redémarrage soit terminé, et plus du tout après. Elle est refusée lorsqu'un déploiement est en
cours, et elle s'exécute avec votre session de connexion. Réclamer un projet effectue également une rotation de sa
clé de service.

Une prévisualisation de backend possède sa propre clé de service. Son premier déploiement la crée,
les redéploiements la conservent, et la clé de production renvoie un code 401 sur la prévisualisation.
`service-key --preview <name>` l'affiche, tout comme `env reveal
REBASE_SERVICE_KEY --preview <name>`. `service-key rotate --preview <name>`
en génère une nouvelle et ne redémarre que le pod de cette prévisualisation ; l'ancienne clé fonctionne jusqu'à ce que
le nouveau pod soit prêt. La commande demande confirmation au préalable, et `--yes` permet de sauter la question. Les deux requièrent
les mêmes droits que `env reveal` : le rôle de propriétaire (owner) ou d'administrateur (admin) de l'organisation, et pour un
jeton d'accès, la capacité `env` sur un projet réclamé. La clé et le
pod de production ne sont pas modifiés.

Une prévisualisation de backend démarre à partir des variables de production, clés actives incluses.
`env set KEY=VALUE --preview` attribue aux prévisualisations leur propre valeur, `env unset KEY
--preview` omet la variable de celles-ci, `env reset KEY --preview` rétablit
la valeur de production, et `env list --preview` affiche les différences.
Aucune de ces commandes ne modifie jamais la production.

`env set KEY --stdin` lit la valeur depuis l'entrée standard plutôt que depuis la
ligne de commande, où `ps` et l'historique de votre shell la rendraient visible :

```bash
read -rs STRIPE_KEY   # paste the value; nothing is echoed
printf %s "$STRIPE_KEY" | rebase cloud env set STRIPE_KEY --stdin --secret
```

Le saut de ligne final est supprimé. La fonction `rebase_cloud_env_set` du serveur MCP
définit les valeurs de cette façon.

`env set KEY --prompt` demande la valeur via une invite masquée sur votre terminal.
Rien ne s'affiche à l'écran, et la valeur est stockée comme un secret, tout comme avec `--stdin
--secret`. Un agent peut vous fournir la commande à exécuter, de sorte que la valeur ne transite jamais
par le chat. Sans terminal, elle refuse l'exécution (`input_required`) et renvoie
vers `--stdin`.

## Organisations

```bash
rebase cloud orgs list | create
rebase cloud orgs members [list] | invite <email> [--role admin|member] | remove <email|uid> | role <email|uid> <role>
rebase cloud orgs invites [list] | revoke <id|email> | resend <id|email>
rebase cloud activity [--project <id|slug>] [--action <area|action>] [--actor <email>] [--limit N] [--before <cursor>]
```

`members invite <email>` ajoute une personne disposant déjà d'un compte Rebase avec une
adresse e-mail vérifiée, tout comme l'action 'Add member' de la console. Elle obtient l'accès
immédiatement et aucun e-mail n'est envoyé. Rebase Cloud n'envoie pas encore d'invitations, donc une
personne sans compte ne reçoit aucun lien : la commande refuse avec `no_account` et
vous demande de la faire s'inscrire d'abord, puis de réexécuter la commande. Un plan de contrôle prenant en
charge les invitations en crée une à la place et affiche son lien (usage unique, valable 7
jours, accepté uniquement par un compte ayant vérifié cette adresse) ; `invites`
permet de les lister, les révoquer et les renvoyer, et répond `not_served` dans les autres cas.
`--role` peut être `admin` ou `member` (par défaut). Personne n'est ajouté en tant qu'`owner` : ajoutez-les
comme administrateur, puis un propriétaire pourra les promouvoir avec `members role <email> owner`.
L'ajout de membres et la gestion des `invites` nécessitent une session `rebase cloud login` ;
`REBASE_TOKEN` est refusé. Les deux requièrent le rôle de propriétaire ou d'administrateur ; un membre est notifié
en conséquence.
`members remove` demande confirmation au préalable (`--yes` l'ignore) ; supprimer ou rétrograder un propriétaire
requiert d'être propriétaire, et le dernier propriétaire est obligatoirement conservé. `--org <id>` sélectionne une organisation
autre que celle actuellement sélectionnée.

`activity` est le journal d'audit de l'organisation sélectionnée, du plus récent au plus ancien : qui
a déployé, effectué un rollback, défini, supprimé ou révélé une variable d'environnement (par
son nom, jamais par sa valeur), modifié un domaine, créé, restauré ou téléchargé une
sauvegarde, modifié les ressources de calcul d'un projet, arrêté ou supprimé un projet, modifié le
rôle d'un membre, ou créé ou révoqué un jeton d'accès. `--action` accepte un domaine
(`deploy`, `deploy_hook`, `env`, `domain`, `backup`, `pitr`, `database`,
`extension`, `storage`, `project`, `org`, `member`, `invite`, `token`) ou une action complète
telle que `env.set`. Une page contient jusqu'à 100 entrées (`--limit`, 50 par défaut) ; la
sortie affiche le curseur `--before` pour la page suivante. `--json` renvoie une seule valeur,
`{ org, events, nextCursor }`. Cela nécessite le rôle de propriétaire ou d'administrateur de l'organisation.
Un jeton ne peut le lire qu'avec la capacité `audit` sur l'organisation
(`rebase cloud tokens create --can audit`). La page **Activity** de la console
affiche le même journal.

## Bases de données

```bash
rebase cloud db list | create | info | connect | test
rebase cloud db backup list | create | restore | status | download
rebase cloud db pitr status | restore | cutover | discard
```

`db connect` ouvre un port local qui *est* la base de données gérée (aucun endpoint
public) jusqu'à Ctrl-C ; `--reveal` ajoute le mot de passe. Propriétaire ou administrateur uniquement.

## Invités

Chaque `signInAnonymously()` lors d'un test, par un bot ou lors d'une visite abandonnée laisse une ligne
dans les utilisateurs du projet. Ces commandes dénombrent ces lignes et les suppriment, évitant
d'avoir à les traiter une par une manuellement.

```bash
rebase cloud guests                              # how many, and the ones last seen longest ago
rebase cloud guests --older-than 30d --limit 100 # the ones not seen for 30 days
rebase cloud guests delete <id>                  # one guest; asks first
rebase cloud guests prune --older-than 30d       # dry run: how many would go
rebase cloud guests prune --older-than 30d --yes # deletes them
```

`prune` prend une durée avec une unité : `45m`, `12h`, `30d` ou `2w`. Sans `--yes`, la commande se
contente de compter et ne supprime rien. Elle traite un projet de n'importe quelle taille par petits
lots.

Seuls les invités peuvent être supprimés. Un invité est une ligne avec `is_anonymous` activé, sans mot de passe et sans
identité liée ; l'application applique cette règle dans l'instruction de suppression de la
ligne, de sorte que la commande ne peut pas toucher à un compte, même inscrit un instant
après le listing. `delete` refuse un compte avec l'erreur `NOT_ANONYMOUS`.

**Last seen** (dernière activité) correspond au moment où la session de l'invité a été émise ou actualisée pour la dernière fois, ou au moment où
l'invité a été créé s'il ne possède plus de refresh token. Un invité qui revient régulièrement
n'est pas considéré comme ancien, quelle que soit sa date de création. Les refresh tokens d'un invité supprimé
ainsi que toutes ses autres lignes d'authentification sont supprimés avec lui.

Les lignes de vos propres tables suivent leur clé étrangère :

| Colonne | Ce qu'il advient de la ligne |
|---|---|
| Lien optionnel (`ON DELETE SET NULL`, par défaut) | Conservée, avec le lien vidé |
| Lien obligatoire (`ON DELETE RESTRICT`, par défaut) | Conservée, et l'invité avec elle : l'invité est signalé comme ignoré, avec `GUEST_REFERENCED` |
| `onDelete: "cascade"` | Supprimée avec l'invité |
| Aucune clé étrangère (un champ `userSelect`, un identifiant brut) | Conservée, contenant un identifiant qui n'existe plus |

Vérifiez quels liens sont en cascade avant de passer `--yes` : l'opération est irréversible.

La commande passe par le proxy Studio de la console, qui détient la clé de l'application, afin que celle-ci n'atteigne jamais votre
machine. Elle requiert le rôle de propriétaire ou d'administrateur de l'organisation, sur un projet dont l'accès Studio est activé
(`rebase cloud settings set --studio on`). Un projet fonctionnant sur un runtime plus ancien est informé qu'une version plus récente est nécessaire.
`rebase users guests --project <slug>` est la même commande au sein de la famille de commandes du projet.

## Ressources

Ce que la plateforme gère pour le projet, en comparaison avec ce que déclare son code.

```bash
rebase cloud resources                       # each database and bucket: declared? provisioned?
rebase cloud resources prune database <key>  # remove one the code no longer declares
```

Un déploiement ne supprime jamais une base de données provisionnée lorsque sa déclaration disparaît — cela
reviendrait à supprimer des données lors d'un push. La plateforme la conserve, la lie et la facture jusqu'à ce que quelqu'un
la supprime explicitement par son nom via `prune`.

## Calcul

Ce que le projet réserve, et ce que cela coûte.

```bash
rebase cloud compute            # the current reservation and its monthly cost
rebase cloud compute set        # change it
```

`compute set` prend en charge `--cpu`, `--memory`, `--replicas`, `--spot`,
`--db-instances`, `--db-cpu`, `--db-memory`,
`--storage`, `--autoscale-max`, `--autoscale-cpu-target` et `--no-autoscale`.
`--scale-to-zero` est obsolète : chaque backend exécute au moins une instance, donc
`true` est refusé et `false` est ignoré avec un avertissement. Il n'y a pas de niveaux
d'abonnement (tiers) : tout est tarifé à la ressource. Consultez
[Rebase Cloud](/docs/deployment/cloud/).

## Stockage, notifications, clusters, facturation et utilisation

```bash
rebase cloud storage             # list storage buckets
rebase cloud storage create      # provision platform-managed storage
rebase cloud storage attach      # attach your own S3-compatible bucket
rebase cloud notifications [list] | add <url> | test <id> | remove <id>   # deploy, backup, billing and usage events to Slack, Discord or any URL
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
est un argument positionnel car `--url` désigne le plan de contrôle. `add` affiche
le secret de signature une seule fois ; `--json` renvoie `{ projectId, webhook, secret }`.
`test <id>` quitte avec le code d'erreur 1 et le code `delivery_failed` si le destinataire n'a pas accepté
l'événement de test. La consultation de la liste est ouverte à tout membre de l'organisation ; `add`, `test`
et `remove` nécessitent le rôle de propriétaire ou d'administrateur. Un jeton peut les gérer avec la
capacité `notifications` sur l'organisation, selon les mêmes règles de rôles. Consultez
[Notifications Cloud](/docs/deployment/cloud-notifications/).

`clusters registry <cluster-id> --repository <host/project/repo>
--push-service-account <email> --pull-key-file <key.json>` attribue au cluster d'un
client son propre registre d'images, dédié à ce cluster uniquement. Sans
cela, un tel cluster utilise le registre partagé de la plateforme, et chaque déploiement vers celui-ci
le signale dans ses logs. Avec ce paramétrage, les builds sont poussés vers ce dépôt avec un jeton pour
ce compte, les pods récupèrent les images uniquement avec cette clé, et un rollback accepte les
images du projet présentes sur ce registre. Les images
précédemment construites par le projet dans le registre partagé restent récupérables et restent
des cibles de rollback. Les trois valeurs vont de pair ; `--clear` les réinitialise. La clé
est scellée lors de son écriture et n'est jamais relue. Comme le reste de `clusters`,
cela nécessite le rôle platform-admin. L'opérateur crée le dépôt et les deux
comptes via Terraform (`saas/infra/gcp/registry-linked-clusters.tf`).

`billing invoices` et `billing upcoming` lisent les mêmes données Stripe que la
page Billing de la console, et sont accessibles uniquement aux propriétaires et administrateurs de
l'organisation. Un jeton peut y accéder, ainsi qu'au reste de `billing`, avec la capacité `billing`
sur l'organisation ; un jeton créé avant l'introduction de cette capacité continue de
fonctionner pendant une version, avec un avertissement à chaque réponse. Les montants dans `--json` sont exprimés dans la sous-unité de la devise (centimes), exactement tels que
Stripe les transmet. Les factures à l'état de brouillon ne sont pas listées ; l'aperçu est calculé par
Stripe et ses lignes à l'usage continuent d'augmenter jusqu'à la clôture de la période.

`usage` lit la consommation du projet lié (ou `--project`) sur un mois calendaire,
en UTC : requêtes par rapport au quota inclus, erreurs 5xx, dépassement
à ce jour en euros et, pour le mois en cours, projection estimée à ce
rythme. Le dépassement correspond au calcul propre du rapport de dépassement, celui
qui indique à Stripe quoi facturer, et qui apparaît sur la facture du mois suivant.
`usage org` liste chaque projet de l'organisation sélectionnée avec `rebase cloud
use`, ainsi que le total. Tout membre de l'organisation peut le consulter. Un jeton peut le lire
avec la capacité `logs` sur le projet ; `usage org` liste les projets pour lesquels le
jeton dispose de cette capacité.
`--month` prend un mois passé. La réponse comporte des `caveats` (mises en garde), chacune avec un `code` : `storage_not_measured`
(le stockage objet indique 0), `multi_pod_undercount` (les requêtes servies lorsque deux
pods d'application ou plus tournent ne sont pas comptabilisées), `partial_days`, `metering_off`,
`overage_billing_off`, `not_billed`, `billed_next_month`, `pre_claim_days` (un
projet réclamé depuis un agent ne compte que les jours à partir de la réclamation) et
`autoscale_not_charged` (des pods ont tourné au-delà de `--replicas` et cette plateforme ne les
facture pas encore). La réponse d'un projet avec autoscaling comporte également `autoscale` :
`extraPodSeconds` au-delà du seuil minimal, `amountEur` selon ses tarifs, et `charged`.

## Hooks de déploiement, alertes et le reste

```bash
rebase cloud deploy-hooks [list] | create [--name <name>] [--branch <branch>] | revoke <id>   # secret URLs a git host or CI calls to deploy
rebase cloud alerts [list] [--all] | ack <id> | snooze <id> --hours <1-168>   # the project's incidents
rebase cloud deploy --git [<branch>]     # build on the control plane from the connected repository
rebase cloud metrics --runtime           # requests, errors and latency, per surface
rebase cloud metrics --history [--series cpu_millicores|memory_bytes|event_loop_delay_ms|requests_<surface>|errors_<surface>] [--minutes <n>]
rebase cloud domains primary <domain>    # make a verified domain the canonical one
rebase cloud domains redirect <domain> [--off]   # answer it with a 308 to the primary, path and query kept
rebase cloud settings set --studio on|off
rebase cloud orgs rename <name> [--slug <slug>]
rebase cloud orgs delete                 # refused while the organization has projects
rebase cloud billing email <address>     # where invoices go
rebase cloud clusters baseline <id> [--install]   # platform admins
```

`domains redirect` se configure par domaine et est désactivé par défaut, de sorte qu'un projet servant un hôte `api.` à côté de son site conserve les deux ; il prend effet lorsque le domaine est vérifié et qu'un autre est défini comme principal, et ne s'applique jamais à un domaine sur lequel une application est servie. `deploy-hooks create` affiche l'URL du hook une seule fois. `deploy --git` ne peut pas être combiné avec les options d'un build local, et sur le runtime géré, il nécessite `--eject` car le plan de contrôle compile à partir du code source. `settings set --studio` est le commutateur que les commandes de projet (`rebase data`, `rebase users`, …) nécessitent activé pour `--project` : elles accèdent à l'application via le proxy Studio de la console. Une commande dont la route sur le plan de contrôle n'est pas encore déployée répond `not_served` et la nomme. Les commandes destructives demandent confirmation au préalable et refusent l'exécution avec `confirmation_required` en mode non interactif : utilisez `--yes`.
