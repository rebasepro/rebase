---
sourceHash: 720d2918ad0263cf
title: rebase cloud
sidebar_label: rebase cloud
description: Les groupes de commandes pour Rebase Cloud dans le CLI — auth, liaison de projet, déploiements, notifications, configuration, organisations, bases de données, ressources, calcul, stockage, clusters, facturation et utilisation.
---

Tout ce qui concerne Rebase Cloud, actuellement en version bêta privée. Consultez le
[guide Rebase Cloud](/docs/deployment/cloud/) pour savoir en quoi il consiste et ce que la version bêta
n'inclut pas.

Chaque groupe répond à `--help`, et `--help` n'exécute jamais la commande. La plupart des commandes
agissent sur le projet lié dans `.rebase/cloud.json` ; `--project <id>` opère sur
un projet sans le lier.

Trois options s'appliquent partout : `--json` pour une sortie lisible par une machine (également la
valeur par défaut dans un tube, sauf pour `deploy`, ou avec `REBASE_JSON=1`), `--url <origin>` pour cibler un
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

`--can` accepte `deploy`, `logs`, `env`, `database` et `backups` sur un projet
(`--project`, ou celui lié), et `billing`, `audit` et
`notifications` sur une organisation : `--org`, sinon l'organisation du projet,
sinon celle sélectionnée. Un jeton ne peut détenir que des capacités d'organisation.
`logs` couvre également `usage`. La portée de chacun est détaillée dans
[CI et agents](/docs/deployment/cloud-agents/#ci-and-agents). Lorsque le plan
de contrôle marque une réponse à un jeton comme dépréciée (un jeton antérieur à `billing`
lisant la facturation), le CLI affiche l'avertissement une fois sur stderr, jamais dans la
valeur `--json`.

Sans aucun drapeau, `login` s'authentifie via le navigateur. Il affiche un code court et
un lien vers la console, ouvre le navigateur et attend que vous approuviez la
connexion à cet endroit. Vous êtes déjà connecté à la console, ou vous vous connectez avec
l'une des méthodes proposées (mot de passe, Google, GitHub, LinkedIn). Vérifiez que le
navigateur affiche le même code avant de l'approuver. Le lien expire au bout de dix
minutes et ne fonctionne qu'une seule fois. Sans terminal, ou avec `--json`, le lien et le code
sont envoyés sur stderr et `login` continue d'attendre, afin qu'un agent puisse vous transmettre le lien. Une
connexion refusée se termine avec `access_denied`, une connexion expirée avec `expired_token`.

Avec `--email`, `login` demande s'il faut utiliser votre mot de passe ou un code que le plan
de contrôle vous envoie par e-mail. Lorsque l'authentification à deux facteurs est activée, il demande ensuite votre
code d'authentification (ou un code de récupération) ; via le navigateur, approuvez depuis une
session de console qui l'a utilisé. Sans terminal, aucun code ne peut être saisi : définissez
`REBASE_TOKEN` sur un jeton d'accès créé dans la console sous Settings → Access
tokens. Consultez [Rebase Cloud](/docs/deployment/cloud#link-a-project).

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
y accède ensuite aux côtés de vos projets Cloud. `connect` affiche
`REBASE_PLATFORM_TOKEN_KEY` et `REBASE_PLATFORM_TOKEN_AUDIENCE` ; définissez-les sur
le serveur et redémarrez-le. Dans le dossier du projet, il propose de les écrire dans
`.env`. Le réexécuter est sans risque. `--name` nomme l'instance, `--org` choisit
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
répertoire, ainsi que le temps restant avant qu'il ne soit supprimé s'il n'est pas réclamé (`Unclaimed: deleted
in 41h`). `--open` l'ouvre également dans un navigateur. Le lien n'est conservé que sur la
machine ayant exécuté `init --claim`, dans `~/.rebase/credentials.json` ; le plan de
contrôle en stocke un hachage et ne peut pas l'afficher à nouveau. Avant de répondre, `claim`
demande au plan de contrôle si le propre jeton du projet fonctionne toujours. Une réclamation
révoque ce jeton, de sorte qu'une fois que quelqu'un a réclamé le projet, `claim` refuse
avec `already_claimed` au lieu d'afficher un lien mort. Il refuse également une fois la
période écoulée (`claim_expired`), et dans un répertoire sans lien de réclamation
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
téléverse également les sources du projet — ce que git suit, jamais un `.env` — afin qu'une
mise à niveau de la plateforme puisse le recompiler ; `--no-source` ignore cela une fois, et `cloud settings set
--platform-rebuilds off` l'interrompt et supprime la copie stockée. `--allow-downgrade` déploie une version antérieure.

Un `deploy` suivi se termine par un résumé : chaque application livrée avec son URL, l'identifiant
du déploiement, le temps que cela a pris et si la nouvelle version y répond. Il
attend jusqu'à `--live-timeout` secondes (60 par défaut ; `0` ignore la vérification) qu'un
`/health` de backend et que l'adresse de chaque application statique répondent. Un déploiement échoué
se termine par une ligne indiquant le nom de l'application et la raison, avec un code de sortie non nul. Le résumé
s'affiche même dans un tube ; `--json` (ou `REBASE_JSON=1`) affiche un seul objet à la place,
avec `apps`, `hosts`, `live`, `liveChecks` et `durationMs`.

Avant le téléversement, `deploy` analyse le JavaScript de chaque application statique qu'il livre :
les fichiers `.js`/`.mjs`/`.cjs` dans sa sortie `output` et les blocs `<script>` intégrés dans
son HTML. Une erreur de syntaxe interrompt le déploiement avec `file:line:column` (code
`syntax_error` sous `--json`), et `--no-verify` ignore la vérification. Un déploiement réussi
se termine par le chemin de retour, `rebase cloud rollback`. Une application statique déployée
seule ne peut pas encore faire l'objet d'un rollback ; consultez
[Roll back](/docs/deployment/cloud#roll-back).

`--preview` dessert le build sur `https://<project>--<name>.rebase.website` et
ne touche pas à la production. Une prévisualisation du backend exécute son propre backend, sur sa
propre base de données vide, avec ses applications statiques intégrées. Une application statique ne peut pas encore être
prévisualisée seule sur Rebase Cloud : `rebase cloud deploy <app> --preview`
est refusé avec `PREVIEW_STATIC_UNSERVED` et ne publie rien. Une prévisualisation
de backend est facturée comme une unité d'application supplémentaire à la taille par défaut tant qu'elle existe, et
le déploiement indique à combien cela s'élève par mois, selon l'estimation propre au plan de contrôle
(`cost` sous `--json` ; uniquement la règle et ce lien lorsque le plan de contrôle ne peut pas
en estimer le prix) ; `rebase cloud previews delete <name>` l'arrête. `rebase cloud previews`
affiche une prévisualisation mise en pause par la plateforme (sa base de données a dépassé la limite de prévisualisation) sous l'état
`paused`, avec la raison (`statusMessage` sous `--json`). Une nouvelle adresse de prévisualisation
peut être refusée avec `preview_cert_budget` lorsque le budget hebdomadaire de certificats de
prévisualisation de la plateforme est épuisé ; le message précise jusqu'à quand.
Consultez [Preview a change](/docs/deployment/cloud/#preview-a-change).

### Logs

`rebase cloud logs` affiche le dernier journal de build, et `-f` suit un build
toujours en cours d'exécution. `--runtime` lit à la place ce que l'application affiche, depuis chaque pod
associé, chaque ligne étant étiquetée avec son pod :

```bash
rebase cloud logs --runtime -f                    # follow until Ctrl-C (exits 0)
rebase cloud logs --runtime --since 15m --grep timeout
rebase cloud logs --runtime -f --level error      # errors only
rebase cloud logs --runtime --previous            # a restarted container's last run
```

- `--since` accepte une durée (`30s`, `5m`, `1h`) ou une heure RFC3339.
- `--tail <n>` indique le nombre de lignes par pod à partir duquel commencer (le plan de contrôle le plafonne à 2000).
- `--grep` conserve les lignes contenant le texte, sans distinction de casse ; écrivez `/re/flags` pour une expression régulière.
- Avec `--grep` ou `--level`, le filtre analyse chaque ligne renvoyée par le plan de contrôle
  pour la fenêtre donnée (les 2000 plus récentes de chaque pod), et `--tail` compte les lignes
  correspondantes : les `n` correspondances les plus récentes par pod, 500 par défaut. Lorsqu'un pod a généré plus
  de lignes dans cette fenêtre, la sortie indique que les plus anciennes n'ont pas été
  analysées (`filter.scanCapped` sous `--json`).
- `--level error|warn|info|debug` conserve les lignes de cette gravité ou pire. Il lit
  la `severity` structurée journalisée par un backend Rebase, un mot de niveau au début d'une
  ligne brute, ou un motif d'erreur tel que `TypeError:`. Les lignes n'en comportant aucun sont exclues.

Un suivi interroge toutes les deux secondes et affiche chaque ligne une seule fois. Il annonce les pods
qui démarrent, s'arrêtent ou redémarrent. Lorsqu'un conteneur redémarre, il affiche également les dernières
lignes de l'instance qui s'est arrêtée, là où se trouve généralement la cause. Il attend tant qu'aucun
pod n'est en cours d'exécution, et après une coupure de connexion, il réessaie avec un intervalle exponentiel et
reprend là où il s'était arrêté. Avec `--json`, un suivi affiche un objet JSON par
ligne (NDJSON) : `{"type":"line","ts","pod","text"}` pour chaque ligne de log, et
`{"type":"event","event":…}` pour le reste.

`--preview <name>` lit une prévisualisation au lieu de la production. Utilisez le nom
de la prévisualisation ou l'identifiant de déploiement affiché lors du déploiement de la prévisualisation. Utilisé seul, `--preview`
lit l'unique prévisualisation du projet. Une prévisualisation statique dispose d'un journal de build mais d'aucun
journal d'exécution, car elle n'exécute aucun serveur.

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

`app-key` liste la
clé générée par `rebase cloud init --claim` sur l'application et écrite dans `.env` sous
`REBASE_API_TOKEN`, par son préfixe et jamais par sa valeur. Réclamer le projet
transfère cette clé et elle cesse d'expirer. `app-key rotate` en génère une nouvelle et
révoque toutes les clés d'agent antérieures en une seule fois. Elle écrit la nouvelle clé dans un fichier `.env`
qui définit déjà `REBASE_API_TOKEN`, et l'exclut de `--json`. Dans
tout autre répertoire, elle affiche la clé une seule fois. Les clés créées dans le panneau d'administration de l'application
ne sont pas modifiées. Elle s'exécute avec votre session de connexion : aucune capacité de jeton ne l'octroie.

`service-key`
affiche la génération de la `REBASE_SERVICE_KEY` du projet, la date de sa dernière
rotation, et indique si l'application est toujours en cours de redémarrage sur la plus récente. Elle n'affiche
jamais la clé : pour cela, utilisez `env reveal REBASE_SERVICE_KEY`. `service-key rotate`
émet une nouvelle clé et redémarre l'application dessus. L'ancienne clé fonctionne jusqu'à ce que le
redémarrage soit terminé, et plus du tout après. L'opération est refusée pendant qu'un déploiement est en
cours, et elle s'exécute avec votre session de connexion. La réclamation d'un projet effectue également une rotation de sa
clé de service.

Une prévisualisation de backend possède sa propre clé de service. Son premier déploiement la crée,
les redéploiements la conservent, et la clé de production renvoie une erreur 401 sur la prévisualisation.
`service-key --preview <name>` l'affiche, tout comme `env reveal
REBASE_SERVICE_KEY --preview <name>`. `service-key rotate --preview <name>`
en écrit une nouvelle et redémarre uniquement le pod de cette prévisualisation ; l'ancienne clé fonctionne jusqu'à
ce que le nouveau pod soit prêt. La commande demande confirmation au préalable, et `--yes` évite la confirmation. Les deux commandes exigent
les mêmes droits que `env reveal` : le rôle de propriétaire ou d'administrateur de l'organisation, et pour un
jeton d'accès, la capacité `env` sur un projet réclamé. La clé et le pod
de production ne sont pas modifiés.

Une prévisualisation de backend démarre à partir des variables de production, clés en production comprises.
`env set KEY=VALUE --preview` attribue aux prévisualisations leur propre valeur, `env unset KEY
--preview` exclut la variable de celles-ci, `env reset KEY --preview` rétablit
la valeur de production, et `env list --preview` affiche les différences.
La production n'est jamais modifiée par aucune de ces commandes.

`env set KEY --stdin` lit la valeur depuis l'entrée standard au lieu de la
ligne de commande, où `ps` et l'historique de votre shell l'exposeraient :

```bash
read -rs STRIPE_KEY   # paste the value; nothing is echoed
printf %s "$STRIPE_KEY" | rebase cloud env set STRIPE_KEY --stdin --secret
```

Un saut de ligne final éventuel est supprimé. La fonction `rebase_cloud_env_set` du serveur MCP définit
les valeurs de cette manière.

## Organisations

```bash
rebase cloud orgs list | create
rebase cloud orgs members [list] | invite <email> [--role admin|member] | remove <email|uid> | role <email|uid> <role>
rebase cloud orgs invites [list] | revoke <id|email> | resend <id|email>
rebase cloud activity [--project <id|slug>] [--action <area|action>] [--actor <email>] [--limit N] [--before <cursor>]
```

`members invite` génère une invitation et affiche son lien : à usage unique,
valide 7 jours, accepté uniquement par un compte ayant vérifié cette adresse e-mail.
Personne ne rejoint l'organisation tant que l'invitation n'a pas été acceptée, même une personne possédant déjà un compte Rebase.
La sortie (et `emailDelivery` dans `--json`) indique si le lien a été envoyé par e-mail ; si ce
n'est pas le cas, un avertissement vous invite à transmettre le lien vous-même. `--role` peut être `admin` ou
`member` (par défaut). Personne ne peut être invité en tant qu'`owner` : invitez la personne comme administrateur, puis
un propriétaire la promeut avec `members role <email> owner` une fois qu'elle a rejoint.
`invites resend` fournit un nouveau lien et l'ancien cesse de fonctionner.
L'invitation et la commande `invites` nécessitent une session `rebase cloud login` ; `REBASE_TOKEN` est
refusé. Inviter, lister, renvoyer et révoquer requièrent le rôle de
propriétaire ou d'administrateur ; un membre en sera informé.
`members remove` demande confirmation préalable (`--yes` l'ignore) ; supprimer ou rétrograder un propriétaire
requiert d'être propriétaire, et le dernier propriétaire est conservé. `--org <id>` sélectionne une organisation
autre que celle active.

`activity` est le journal d'audit de l'organisation sélectionnée, du plus récent au plus ancien : qui
a déployé, effectué un rollback, défini, supprimé ou révélé une variable d'environnement (par
son nom, jamais par sa valeur), modifié un domaine, créé, restauré ou téléchargé une
sauvegarde, modifié les ressources de calcul d'un projet, arrêté ou supprimé un projet, modifié le
rôle d'un membre, ou créé ou révoqué un jeton d'accès. `--action` accepte un domaine
(`deploy`, `deploy_hook`, `env`, `domain`, `backup`, `pitr`, `database`,
`extension`, `storage`, `project`, `org`, `member`, `invite`, `token`) ou une action complète
telle que `env.set`. Une page contient jusqu'à 100 entrées (`--limit`, 50 par défaut) ; la
sortie affiche le curseur `--before` pour la page suivante. `--json` est une valeur unique,
`{ org, events, nextCursor }`. Cette commande requiert le rôle de propriétaire ou d'administrateur de l'organisation.
Un jeton ne peut la lire qu'avec la capacité `audit` sur l'organisation
(`rebase cloud tokens create --can audit`). La page **Activity** de la console
affiche le même journal.

## Bases de données

```bash
rebase cloud db list | create | info | connect | test
rebase cloud db backup list | create | restore | status | download
rebase cloud db pitr status | restore | cutover | discard
```

`db connect` ouvre un port local qui *est* la base de données gérée (aucun
point de terminaison public) jusqu'à Ctrl-C ; `--reveal` ajoute le mot de passe. Propriétaire ou administrateur uniquement.

## Invités

Chaque appel à `signInAnonymously()` lors d'un test, par un robot ou lors d'une visite abandonnée laisse une ligne
dans les utilisateurs du projet. Ces commandes décomptent ces lignes et les suppriment, pour
que personne n'ait à les parcourir une par une.

```bash
rebase cloud guests                              # how many, and the ones last seen longest ago
rebase cloud guests --older-than 30d --limit 100 # the ones not seen for 30 days
rebase cloud guests delete <id>                  # one guest; asks first
rebase cloud guests prune --older-than 30d       # dry run: how many would go
rebase cloud guests prune --older-than 30d --yes # deletes them
```

`prune` prend une durée avec une unité : `45m`, `12h`, `30d` ou `2w`. Sans `--yes`, la commande
compte et ne supprime rien. Elle traite un projet de n'importe quelle taille par petits
lots.

Seuls les invités peuvent être supprimés. Un invité est une ligne avec `is_anonymous` activé, sans mot de passe ni
identité liée, et l'application applique cette règle dans l'instruction qui supprime la
ligne, de sorte que la commande ne peut pas toucher à un compte, même inscrit un instant
après avoir été listé. `delete` refuse un compte avec `NOT_ANONYMOUS`.

**Dernière activité** (Last seen) correspond au moment où la session de l'invité a été émise ou actualisée pour la dernière fois, ou au moment où
l'invité a été créé s'il ne lui reste aucun jeton d'actualisation. Un invité qui continue de revenir
n'est pas considéré comme ancien, quelle que soit sa date de création. Les jetons d'actualisation
d'un invité supprimé ainsi que toutes les autres lignes d'authentification associées sont supprimés avec lui.

Les lignes de vos propres tables suivent leur clé étrangère :

| La colonne | Ce qui arrive à la ligne |
|---|---|
| Lien optionnel (`ON DELETE SET NULL`, par défaut) | Conservée, avec le lien vidé |
| Lien obligatoire (`ON DELETE RESTRICT`, par défaut) | Conservée, ainsi que l'invité : l'invité est signalé comme ignoré, avec `GUEST_REFERENCED` |
| `onDelete: "cascade"` | Supprimée avec l'invité |
| Aucune clé étrangère (un champ `userSelect`, un simple identifiant) | Conservée, contenant un identifiant qui n'existe plus |

Vérifiez lesquels de vos liens sont en cascade avant de passer `--yes` : l'opération est irréversible.

La commande passe par le proxy Studio de la console, qui détient la clé de l'application, afin que la clé n'atteigne jamais votre
machine. Elle nécessite un propriétaire ou un administrateur d'organisation, sur un projet dont l'accès Studio est activé
(`rebase cloud settings set --studio on`). Un projet utilisant un runtime plus ancien est informé qu'il nécessite une version plus récente.
`rebase users guests --project <slug>` est la même commande dans la famille de commandes du projet.

## Ressources

Ce que la plateforme détient pour le projet, par rapport à ce que son code déclare.

```bash
rebase cloud resources                       # each database and bucket: declared? provisioned?
rebase cloud resources prune database <key>  # remove one the code no longer declares
```

Un déploiement ne supprime jamais une base de données provisionnée lorsque sa déclaration disparaît — cela
reviendrait à supprimer des données lors d'un push. Il la conserve, la lie et la facture jusqu'à ce que quelqu'un
la supprime explicitement par son nom via `prune`.

## Calcul

Ce que le projet réserve, et ce que cela coûte.

```bash
rebase cloud compute            # the current reservation and its monthly cost
rebase cloud compute set        # change it
```

`compute set` accepte `--cpu`, `--memory`, `--replicas`, `--spot`,
`--db-instances`, `--db-cpu`, `--db-memory`,
`--storage`, `--autoscale-max`, `--autoscale-cpu-target` et `--no-autoscale`.
`--scale-to-zero` est obsolète : chaque backend exécute au moins une instance, donc
`true` est refusé et `false` est ignoré avec un avertissement. Il n'y a pas de
paliers de forfait : tout est tarifié à la ressource. Consultez
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
uniquement `{ "text" }` au lieu du JSON d'événement, qui transporte également un `text`. L'URL
est un argument positionnel car `--url` désigne le plan de contrôle. `add` affiche
le secret de signature une seule fois ; `--json` renvoie `{ projectId, webhook, secret }`.
`test <id>` se termine avec le code 1 et l'erreur `delivery_failed` lorsque le destinataire n'a pas accepté
l'événement de test. Le listage est ouvert à tout membre de l'organisation ; `add`, `test`
et `remove` nécessitent le rôle de propriétaire ou d'administrateur. Un jeton les gère avec la
capacité `notifications` sur l'organisation, selon la même règle de rôle. Consultez
[Cloud notifications](/docs/deployment/cloud-notifications/).

`clusters registry <cluster-id> --repository <host/project/repo>
--push-service-account <email> --pull-key-file <key.json>` attribue au cluster
propre d'un client son propre registre d'images, utilisé exclusivement pour ce cluster. Sans
cela, un tel cluster utilise le registre partagé de la plateforme, et chaque déploiement vers celui-ci
le mentionne dans ses journaux. Avec un registre dédié, les builds poussent vers ce dépôt avec un jeton pour
ce compte, les pods tirent les images avec cette seule clé, et un rollback accepte les
images du projet qui s'y trouvent. Les images
que le projet a compilées auparavant dans le registre partagé restent récupérables et demeurent des
cibles de rollback valides. Les trois valeurs vont de pair ; `--clear` les efface. La clé
est scellée lors de son écriture et n'est jamais relue. Comme le reste des commandes `clusters`,
elle nécessite le rôle platform-admin. L'opérateur crée le dépôt et les deux
comptes avec Terraform (`saas/infra/gcp/registry-linked-clusters.tf`).

`billing invoices` et `billing upcoming` lisent les mêmes données Stripe que la
page Facturation de la console, et ne sont accessibles qu'aux propriétaires et administrateurs de l'organisation.
Un jeton y accède, ainsi qu'au reste de `billing`, grâce à la capacité `billing`
sur l'organisation ; un jeton créé avant l'introduction de cette capacité continue de
fonctionner pendant une version, avec un avertissement sur chaque réponse. Les montants dans `--json` sont exprimés dans la sous-unité de la devise (centimes), exactement comme
Stripe les transmet. Les factures à l'état de brouillon ne sont pas listées ; la prévisualisation est calculée par
Stripe et ses lignes à l'usage continuent d'augmenter jusqu'à la clôture de la période.

`usage` lit ce que le projet lié (ou `--project`) a consommé durant un mois
civil, en UTC : les requêtes par rapport au quota inclus, les erreurs 5xx, le dépassement
actuel en euros et, pour le mois en cours, la projection à ce
rythme (une estimation). Le dépassement correspond au calcul propre du rapport de dépassement,
celui qui indique à Stripe ce qu'il faut facturer, et qui apparaît sur la facture du mois suivant.
`usage org` répertorie chaque projet de l'organisation sélectionnée avec `rebase cloud
use`, ainsi que le total. Tout membre de l'organisation peut le consulter. Un jeton peut le lire
avec la capacité `logs` sur le projet ; `usage org` liste les projets pour lesquels le
jeton dispose de cette capacité.
`--month` prend un mois passé. La réponse comporte des avertissements (`caveats`), chacun associé à un `code` : `storage_not_measured`
(le stockage objet indique 0), `multi_pod_undercount` (les requêtes traitées pendant que deux
pods d'application ou plus fonctionnent ne sont pas comptabilisées), `partial_days`, `metering_off`,
`overage_billing_off`, `not_billed`, `billed_next_month`, `pre_claim_days` (un
projet réclamé auprès d'un agent ne comptabilise que les jours à partir de la réclamation) et
`autoscale_not_charged` (les pods ont dépassé `--replicas` et cette plateforme ne
les facture pas encore). La réponse d'un projet avec dimensionnement automatique comporte également `autoscale` :
`extraPodSeconds` au-delà du seuil minimal, `amountEur` selon ses tarifs, et `charged`.

## Hooks de déploiement, alertes et autres

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

`domains redirect` s'applique par domaine et est désactivé par défaut, de sorte qu'un projet desservant un hôte `api.` à côté de son site conserve les deux ; la redirection prend effet lorsque le domaine est vérifié et qu'un autre domaine est défini comme principal, et ne s'applique jamais à un domaine sur lequel une application est hébergée. `deploy-hooks create` affiche l'URL du hook une seule fois. `deploy --git` ne peut pas être combiné avec les options d'un build local, et sur le runtime géré, il nécessite `--eject`, car le plan de contrôle compile à partir des sources. `settings set --studio` est l'interrupteur que les commandes de projet (`rebase data`, `rebase users`, …) doivent avoir activé pour `--project` : elles accèdent à l'application via le proxy Studio de la console. Une commande dont la route du plan de contrôle n'est pas encore déployée répond `not_served` et indique son nom. Les commandes destructives demandent d'abord confirmation et refusent d'agir avec `confirmation_required` lorsque personne ne peut répondre : utilisez `--yes`.
