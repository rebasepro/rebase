---
sourceHash: 784025478be49fb3
title: rebase cloud
sidebar_label: rebase cloud
description: Les groupes de commandes pour Rebase Cloud dans la CLI — authentification, liaison de projet, déploiements, notifications, configuration, organisations, bases de données, ressources, calcul, stockage, clusters, facturation et utilisation.
---

Tout ce qui concerne Rebase Cloud, actuellement en version bêta privée. Consultez le
[guide Rebase Cloud](/docs/deployment/cloud/) pour savoir de quoi il s'agit et ce que la version bêta
n'inclut pas.

Chaque groupe répond à `--help`, et `--help` n'exécute jamais la commande. La plupart des commandes
agissent sur le projet lié dans `.rebase/cloud.json` ; `--project <id>` opère sur
un projet sans liaison.

Trois options s'appliquent partout : `--json` pour une sortie lisible par une machine (également
par défaut lors d'une redirection via pipe, sauf pour `deploy`, ou avec `REBASE_JSON=1`), `--url <origin>` pour cibler un
plan de contrôle spécifique (ou `REBASE_CLOUD_URL`), et `--project, -p <id>`.

## Authentification

```bash
rebase cloud login      # sign in to the control plane
rebase cloud login --code   # with an emailed 6-digit code: accounts made with Google, GitHub or LinkedIn
rebase cloud logout     # sign out
rebase cloud whoami     # the current session, or what REBASE_TOKEN may do
rebase cloud access-token   # the bearer the CLI would send now, refreshed first; for scripts and the MCP server
rebase cloud tokens create --can deploy,logs   # a token for CI, shown once
rebase cloud tokens create --can billing --org <id>   # a token for an organization's billing
```

`--can` accepte `deploy`, `logs`, `env`, `database` et `backups` sur un seul projet
(`--project`, ou le projet lié), et `billing`, `audit` et
`notifications` sur une seule organisation : `--org`, sinon l'organisation du projet,
sinon celle sélectionnée. Un jeton peut uniquement détenir des capacités d'organisation.
`logs` couvre également `usage`. La portée de chacun est détaillée dans
[CI and agents](/docs/deployment/cloud-agents/#ci-and-agents). Lorsque le plan de contrôle
marque une réponse à un jeton comme dépréciée (un jeton antérieur à `billing`
lisant la facturation), la CLI affiche l'avertissement une seule fois sur stderr, jamais dans la
valeur `--json`.

Dans un terminal sans mot de passe fourni, `login` demande s'il faut utiliser votre mot de passe
ou un code envoyé par e-mail par le plan de contrôle. Lorsque l'authentification à deux facteurs est activée, il
demande ensuite votre code d'authentification (ou un code de récupération). Sans terminal,
aucun des deux ne peut être saisi : définissez `REBASE_TOKEN` avec un jeton d'accès créé dans la console
sous Settings → Access tokens. Consultez [Rebase Cloud](/docs/deployment/cloud#link-a-project).

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
`.env`. La réexécution ne présente aucun risque. `--name` nomme l'instance, `--org` sélectionne
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

`claim` affiche le lien de revendication du projet que `init --claim` a provisionné dans ce
répertoire, ainsi que le temps restant avant sa suppression s'il n'est pas réclamé (`Unclaimed: deleted
in 41h`). `--open` l'ouvre également dans un navigateur. Le lien n'est conservé que sur la
machine ayant exécuté `init --claim`, dans `~/.rebase/credentials.json` ; le plan de
contrôle en stocke un hachage et ne peut plus l'afficher. Avant de répondre, `claim`
demande au plan de contrôle si le jeton propre au projet fonctionne toujours. Une revendication
révoque ce jeton ; ainsi, une fois qu'un utilisateur a revendiqué le projet, `claim` refuse
avec `already_claimed` au lieu d'afficher un lien mort. La commande refuse également une fois le
délai écoulé (`claim_expired`), ainsi que dans un répertoire sans lien de revendication
(`no_claim_link`). `rebase cloud status` et `rebase cloud whoami` affichent le même
lien tant que le projet n'a pas été revendiqué.

## Déploiement et observation

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
téléverse également le code source du projet — ce qui est suivi par git, jamais un fichier `.env` — afin
qu'une mise à niveau de la plateforme puisse le reconstruire ; `--no-source` ignore cela une fois, et `cloud settings set
--platform-rebuilds off` l'arrête et supprime la copie stockée. `--allow-downgrade` déploie une version antérieure.

Un `deploy` suivi se termine par un récapitulatif : chaque application livrée avec son URL,
l'identifiant du déploiement, la durée nécessaire et si la nouvelle version y répond. Il
attend jusqu'à `--live-timeout` secondes (60 par défaut ; `0` ignore la vérification) que le
`/health` d'un backend et l'adresse de chaque application statique répondent. Un déploiement ayant
échoué se termine sur une ligne indiquant l'application et la raison, et quitte avec un code d'erreur non nul. Le récapitulatif
s'affiche même lors d'une redirection via un pipe ; `--json` (ou `REBASE_JSON=1`) affiche un seul objet à la place,
avec `apps`, `hosts`, `live`, `liveChecks` et `durationMs`.

Avant le téléversement, `deploy` analyse le JavaScript de chaque application statique livrée :
les fichiers `.js`/`.mjs`/`.cjs` dans son `output` et les blocs `<script>` inline dans
son HTML. Une erreur de syntaxe interrompt le déploiement avec `file:line:column` (code
`syntax_error` sous `--json`), et `--no-verify` ignore cette vérification. Un déploiement
réussi se termine par la méthode de retour en arrière, `rebase cloud rollback`. Une application statique déployée
seule ne peut pas encore faire l'objet d'un rollback ; consultez
[Roll back](/docs/deployment/cloud#roll-back).

`--preview` sert le build à l'adresse `https://<project>--<name>.rebase.website` et
ne modifie pas la production. Une prévisualisation du backend exécute son propre backend, sur une
base de données vide qui lui est propre, avec ses applications statiques intégrées. Une application statique ne peut pas
encore être prévisualisée seule sur Rebase Cloud : `rebase cloud deploy <app> --preview`
est refusé avec `PREVIEW_STATIC_UNSERVED` et ne publie rien. Une prévisualisation de backend
est facturée comme une unité d'application supplémentaire à la taille par défaut tant qu'elle existe, et
le déploiement indique à combien cela revient par mois, d'après l'estimation du plan de contrôle lui-même
(`cost` sous `--json` ; uniquement la règle et ce lien lorsque le plan de contrôle ne peut pas
calculer son prix) ; `rebase cloud previews delete <name>` l'arrête. `rebase cloud previews`
affiche une prévisualisation mise en pause par la plateforme (sa base de données a dépassé la limite de prévisualisation) sous
l'état `paused`, avec la raison (`statusMessage` sous `--json`). Une nouvelle adresse de prévisualisation
peut être refusée avec `preview_cert_budget` lorsque le budget hebdomadaire de certificats de
prévisualisation de la plateforme est épuisé ; le message indique jusqu'à quand.
Consultez [Preview a change](/docs/deployment/cloud/#preview-a-change).

### Logs

`rebase cloud logs` affiche le dernier journal de build, et `-f` suit en direct un build en
cours d'exécution. `--runtime` lit plutôt ce que l'application affiche, à partir de chaque pod
sous-jacent, chaque ligne étant étiquetée avec son pod :

```bash
rebase cloud logs --runtime -f                    # follow until Ctrl-C (exits 0)
rebase cloud logs --runtime --since 15m --grep timeout
rebase cloud logs --runtime -f --level error      # errors only
rebase cloud logs --runtime --previous            # a restarted container's last run
```

- `--since` accepte une durée (`30s`, `5m`, `1h`) ou une heure au format RFC3339.
- `--tail <n>` est le nombre de lignes par pod à partir duquel commencer (le plan de contrôle le plafonne à 2000).
- `--grep` conserve les lignes contenant le texte, sans distinction de casse ; écrivez `/re/flags` pour une
  expression régulière.
- `--level error|warn|info|debug` conserve les lignes correspondant à cette sévérité ou pire. Il lit
  la `severity` structurée journalisée par un backend Rebase, un mot de niveau au début d'une
  ligne simple, ou un format d'erreur comme `TypeError:`. Les lignes sans indication sont omises.

Le suivi sonde toutes les deux secondes et affiche chaque ligne une seule fois. Il signale les pods
qui démarrent, s'arrêtent ou redémarrent. Lorsqu'un conteneur redémarre, il affiche également les dernières
lignes de l'instance qui s'est arrêtée, là où se trouve généralement la cause. Il attend tant qu'aucun
pod n'est en cours d'exécution, et après une perte de connexion, il réessaie avec un intervalle exponentiel et
reprend là où il s'était arrêté. Avec `--json`, un suivi affiche un objet JSON par
ligne (NDJSON) : `{"type":"line","ts","pod","text"}` pour chaque ligne de journal, et
`{"type":"event","event":…}` pour le reste.

`--preview <name>` lit les journaux d'une prévisualisation plutôt que de la production. Utilisez le
nom de la prévisualisation ou l'identifiant de déploiement affiché lors du déploiement de la prévisualisation. Utilisé seul, `--preview`
lit l'unique prévisualisation du projet. Une prévisualisation statique dispose d'un journal de build mais d'aucun
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

`app-key` liste la
clé que `rebase cloud init --claim` a générée sur l'application et écrite dans `.env` sous
le nom `REBASE_API_TOKEN`, par son préfixe et jamais sa valeur. La revendication du projet
transfère cette clé et celle-ci cesse d'expirer. `app-key rotate` en génère une nouvelle et
révoque toutes les clés d'agent antérieures en une seule fois. Elle écrit la nouvelle clé dans un `.env`
qui définit déjà `REBASE_API_TOKEN`, et l'exclut de `--json` à cet endroit. Dans
tout autre répertoire, elle affiche la clé une seule fois. Les clés créées dans le panneau d'administration de l'application
ne sont pas affectées. Elle s'exécute avec votre session de connexion : aucune capacité de jeton ne l'autorise.

`service-key`
affiche la génération de la clé `REBASE_SERVICE_KEY` du projet, la date de sa dernière
rotation, et indique si l'application est toujours en cours de redémarrage sur la plus récente. Elle n'affiche
jamais la clé : pour cela, utilisez `env reveal REBASE_SERVICE_KEY`. `service-key rotate`
émet une nouvelle clé et redémarre l'application dessus. L'ancienne clé fonctionne jusqu'à ce que le
redémarrage soit terminé, et plus du tout après. Cette commande est refusée pendant l'exécution d'un déploiement,
et elle s'exécute avec votre session de connexion. La revendication d'un projet effectue également une rotation de sa
clé de service.

Une prévisualisation de backend commence avec les variables de production, clés en direct incluses.
`env set KEY=VALUE --preview` attribue aux prévisualisations leur propre valeur, `env unset KEY
--preview` en retire la variable, `env reset KEY --preview` rétablit
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
valide 7 jours, accepté uniquement par un compte ayant vérifié cette adresse.
Personne ne rejoint tant qu'il n'a pas accepté, même quelqu'un possédant déjà un compte Rebase.
La sortie (et `emailDelivery` dans `--json`) indique si le message a été envoyé par e-mail ; si ce
n'est pas le cas, un avertissement vous invite à envoyer le lien vous-même. `--role` peut être `admin` ou
`member` (par défaut). Personne ne peut être invité en tant qu'`owner` : invitez-le en tant qu'administrateur, et
un propriétaire le promouvra via `members role <email> owner` une fois qu'il aura rejoint.
`invites resend` fournit un nouveau lien et l'ancien cesse de fonctionner.
L'invitation et `invites` nécessitent une session `rebase cloud login` ; `REBASE_TOKEN` est
refusé. Inviter, lister, renvoyer et révoquer requièrent le rôle de propriétaire ou d'administrateur ;
un membre en est informé.
`members remove` demande confirmation avant (`--yes` l'ignore) ; supprimer ou rétrograder un propriétaire
nécessite d'être propriétaire, et le dernier propriétaire est maintenu. `--org <id>` sélectionne une organisation
autre que celle actuellement sélectionnée.

`activity` correspond au journal d'audit de l'organisation sélectionnée, du plus récent au plus ancien : qui a
déployé, effectué un rollback, défini, supprimé ou révélé une variable d'environnement (par
nom, jamais par valeur), modifié un domaine, créé, restauré ou téléchargé une
sauvegarde, modifié les ressources de calcul d'un projet, arrêté ou supprimé un projet, modifié le
rôle d'un membre, ou créé ou révoqué un jeton d'accès. `--action` prend un domaine
(`deploy`, `deploy_hook`, `env`, `domain`, `backup`, `pitr`, `database`,
`extension`, `storage`, `project`, `org`, `member`, `invite`, `token`) ou une action complète
telle que `env.set`. Une page contient jusqu'à 100 entrées (`--limit`, 50 par défaut) ; la
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

`db connect` ouvre un port local qui *est* la base de données gérée (aucun endpoint
public) jusqu'à Ctrl-C ; `--reveal` ajoute le mot de passe. Propriétaire ou administrateur uniquement.

## Invités

Chaque `signInAnonymously()` lors d'un test, d'un bot ou d'une visite abandonnée laisse une ligne
dans les utilisateurs du projet. Ces commandes comptent ces lignes et les suppriment, évitant
ainsi d'avoir à les traiter une par une manuellement.

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

Seuls les invités peuvent être supprimés. Un invité est une ligne avec `is_anonymous` activé, sans mot de passe et sans
identité liée, et l'application applique cette règle dans l'instruction qui supprime la
ligne, de sorte que la commande ne peut affecter un compte, même inscrit un instant
après son recensement. `delete` refuse un compte avec `NOT_ANONYMOUS`.

**Last seen** correspond au moment où la session de l'invité a été émise ou actualisée pour la dernière fois, ou à
la date de création de l'invité s'il ne lui reste aucun jeton d'actualisation. Un invité qui revient
régulièrement n'est pas considéré comme ancien, quelle que soit sa date de création. Les jetons d'actualisation d'un invité
supprimé ainsi que toutes ses autres lignes d'authentification sont supprimés avec lui.

Les lignes de vos propres tables suivent leur clé étrangère :

| Colonne | Ce qui arrive à la ligne |
|---|---|
| Liaison facultative (`ON DELETE SET NULL`, par défaut) | Conservée, avec le lien vidé |
| Liaison obligatoire (`ON DELETE RESTRICT`, par défaut) | Conservée, ainsi que l'invité : l'invité est signalé comme ignoré, avec `GUEST_REFERENCED` |
| `onDelete: "cascade"` | Supprimée avec l'invité |
| Aucune clé étrangère (un champ `userSelect`, un identifiant simple) | Conservée, contenant un identifiant qui n'existe plus |

Vérifiez lesquelles de vos liaisons sont en cascade avant de spécifier `--yes` : cette action est irréversible.

La commande lit `REBASE_SERVICE_KEY` de la même manière que `env reveal` ; elle nécessite donc d'être
propriétaire ou administrateur (ou de disposer d'un jeton avec la capacité `env` appartenant à l'un d'eux). La
clé reste en mémoire et n'est transmise qu'à l'adresse propre du projet. Un projet fonctionnant sur un
runtime plus ancien est averti qu'il doit être mis à niveau vers une version plus récente.

## Ressources

Ce que la plateforme détient pour le projet, par rapport à ce que son code déclare.

```bash
rebase cloud resources                       # each database and bucket: declared? provisioned?
rebase cloud resources prune database <key>  # remove one the code no longer declares
```

Un déploiement ne supprime jamais une base de données provisionnée lorsque sa déclaration disparaît — cela
reviendrait à supprimer des données via un simple push. Elle est conservée, liée et facturée jusqu'à ce que quelqu'un
la supprime explicitement par son nom.

## Calcul

Ce que le projet réserve, et ce que cela coûte.

```bash
rebase cloud compute            # the current reservation and its monthly cost
rebase cloud compute set        # change it
```

`compute set` accepte `--cpu`, `--memory`, `--replicas`, `--spot`,
`--db-instances`, `--db-cpu`, `--db-memory`,
`--storage`, `--autoscale-max`, `--autoscale-cpu-target` et `--no-autoscale`.
`--scale-to-zero` est retiré : chaque backend exécute au moins une instance, donc
`true` est refusé et `false` est ignoré avec un avertissement. Il n'y a pas de niveaux d'abonnement
(plans) : tout est tarifé à la ressource. Consultez
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
est un argument positionnel car `--url` désigne le plan de contrôle. `add` affiche
le secret de signature une seule fois ; `--json` renvoie `{ projectId, webhook, secret }`.
`test <id>` quitte avec le code d'erreur 1 et le code `delivery_failed` lorsque le destinataire n'a pas accepté
l'événement de test. Le listage est ouvert à tout membre de l'organisation ; `add`, `test`
et `remove` nécessitent le rôle de propriétaire ou d'administrateur. Un jeton les gère grâce à la
capacité `notifications` sur l'organisation, selon les mêmes règles de rôle. Consultez
[Cloud notifications](/docs/deployment/cloud-notifications/).

`clusters registry <cluster-id> --repository <host/project/repo>
--push-service-account <email> --pull-key-file <key.json>` attribue au cluster
propre d'un client son propre registre d'images, utilisé pour ce cluster uniquement. Sans
cela, un tel cluster utilise le registre partagé de la plateforme, et chaque déploiement vers celui-ci
le signale dans ses journaux. Avec un registre dédié, les builds poussent vers ce dépôt avec un jeton pour
ce compte, les pods effectuent des pulls uniquement avec cette clé, et un rollback accepte les
images du projet présentes à cet endroit. Les images
que le projet a précédemment construites dans le registre partagé restent téléchargeables (pullable) et
restent des cibles de rollback valides. Les trois valeurs vont de pair ; `--clear` les efface. La clé
est scellée lorsqu'elle est écrite et n'est jamais relue. Comme pour le reste de `clusters`,
cela requiert le rôle d'administrateur de plateforme (platform-admin). L'opérateur crée le dépôt et les deux
comptes avec Terraform (`saas/infra/gcp/registry-linked-clusters.tf`).

`billing invoices` et `billing upcoming` lisent les mêmes données Stripe que la
page Billing de la console, et sont accessibles uniquement aux propriétaires et administrateurs
de l'organisation. Un jeton y accède, ainsi qu'au reste de `billing`, via la capacité `billing`
sur l'organisation ; un jeton créé avant l'introduction de cette capacité continue de
fonctionner pendant une version (release), avec un avertissement sur chaque réponse. Les montants dans `--json` sont exprimés dans la plus petite unité de la devise (centimes), exactement tels que
Stripe les envoie. Les factures à l'état de brouillon ne sont pas listées ; l'aperçu est calculé par
Stripe et ses lignes à l'usage continuent d'augmenter jusqu'à la clôture de la période.

`usage` lit ce que le projet lié (ou `--project`) a consommé au cours d'un
mois civil, en UTC : les requêtes par rapport au forfait inclus, les erreurs 5xx, le dépassement
actuel en euros et, pour le mois en cours, la trajectoire estimée à ce
rythme (une estimation). Le dépassement correspond au calcul propre du rapport de dépassement, celui-là
même qui indique à Stripe quoi facturer, et qui apparaît sur la facture du mois suivant.
`usage org` liste chaque projet de l'organisation sélectionnée avec `rebase cloud
use`, ainsi que le total. Tout membre de l'organisation peut le lire. Un jeton le lit
grâce à la capacité `logs` sur le projet ; `usage org` liste les projets pour lesquels
le jeton détient cette capacité.
`--month` prend un mois passé. La réponse comporte des `caveats`, chacun avec un `code` : `storage_not_measured`
(le stockage objet indique 0), `multi_pod_undercount` (les requêtes traitées lorsque deux pods
d'application ou plus s'exécutent ne sont pas comptées), `partial_days`, `metering_off`,
`overage_billing_off`, `not_billed`, `billed_next_month`, `pre_claim_days` (un
projet revendiqué depuis un agent ne compte que les jours à partir de la revendication) et
`autoscale_not_charged` (des pods ont fonctionné au-delà de `--replicas` et cette plateforme ne les
facture pas encore). La réponse d'un projet avec mise à l'échelle automatique (autoscaled) inclut également `autoscale` :
`extraPodSeconds` au-dessus du seuil de base, `amountEur` selon ses tarifs, et `charged`.
