---
sourceHash: 4b7b199f1aa18e8d
title: rebase cloud
sidebar_label: rebase cloud
description: Les groupes de commandes pour Rebase Cloud dans la CLI — auth, liaison de projet, déploiements, notifications, configuration, organisations, bases de données, ressources, calcul, stockage, clusters, facturation et utilisation.
---

Tout ce qui concerne Rebase Cloud, actuellement en bêta privée. Consultez le
[guide Rebase Cloud](/docs/deployment/cloud/) pour savoir en quoi il consiste et ce que la bêta
n'inclut pas.

Chaque groupe répond à `--help`, et `--help` n'exécute jamais la commande. La plupart des commandes
agissent sur le projet lié dans `.rebase/cloud.json` ; `--project <id>` opère sur
un projet sans liaison.

Trois options s'appliquent partout : `--json` pour une sortie lisible par une machine (également
par défaut lors d'une redirection par tube, sauf pour `deploy`, ou avec `REBASE_JSON=1`), `--url <origin>` pour cibler un
plan de contrôle spécifique (ou `REBASE_CLOUD_URL`), et `--project, -p <id>`.

## Auth

```bash
rebase cloud login      # sign in to the control plane
rebase cloud login --code   # with an emailed 6-digit code: accounts made with Google, GitHub or LinkedIn
rebase cloud logout     # sign out
rebase cloud whoami     # the current session, or what REBASE_TOKEN may do
rebase cloud tokens create --can deploy,logs   # a token for CI, shown once
rebase cloud tokens create --can billing --org <id>   # a token for an organization's billing
```

`--can` accepte `deploy`, `logs`, `env`, `database` et `backups` sur un projet
(`--project`, ou celui qui est lié), et `billing`, `audit` et
`notifications` sur une organisation : `--org`, sinon l'organisation du projet,
sinon celle sélectionnée. Un jeton peut ne détenir que des capacités d'organisation.
`logs` couvre également `usage`. La portée de chacun est détaillée dans
[CI et agents](/docs/deployment/cloud-agents/#ci-and-agents). Lorsque le plan de contrôle
marque une réponse à un jeton comme obsolète (un jeton antérieur à `billing`
consultant la facturation), la CLI affiche l'avertissement une fois sur stderr, jamais dans la
valeur `--json`.

Sur un terminal sans mot de passe fourni, `login` demande s'il faut utiliser votre mot de passe
ou un code que le plan de contrôle vous envoie par e-mail. Lorsque l'authentification à deux facteurs est activée, il
demande ensuite votre code d'authentification (ou un code de récupération). Sans terminal,
aucun des deux ne peut être saisi : définissez `REBASE_TOKEN` avec un jeton d'accès créé dans la console
sous Settings → Access tokens. Consultez [Rebase Cloud](/docs/deployment/cloud#link-a-project).

## Project link

```bash
rebase cloud link         # link this directory to a cloud project
rebase cloud link [url]   # or straight at a backend: no control plane, no login, and the rest of the family refuses until you unlink
rebase cloud unlink       # remove the link
rebase cloud use [org]    # select the active organization
rebase cloud open         # open the dashboard in a browser
```

## Projects

```bash
rebase cloud init --claim [--name <name>]   # a live backend with no account, and a link to claim it within 72 hours
rebase cloud claim [--open]                 # that link again, and how long is left
rebase cloud projects list
rebase cloud projects create [--link]
rebase cloud projects info [id]
rebase cloud projects delete [id]
```

`claim` affiche le lien de réclamation du projet provisionné par `init --claim` dans ce
répertoire, ainsi que le temps restant avant qu'il ne soit supprimé s'il n'est pas réclamé (`Unclaimed: deleted
in 41h`). `--open` l'ouvre également dans un navigateur. Le lien n'est conservé que sur la
machine qui a exécuté `init --claim`, dans `~/.rebase/credentials.json` ; le plan de contrôle
en conserve un hachage et ne peut pas l'afficher à nouveau. Avant de répondre, `claim`
demande au plan de contrôle si le jeton propre au projet fonctionne toujours. Une réclamation
révoque ce jeton, de sorte qu'une fois que quelqu'un a réclamé le projet, `claim` refuse
avec `already_claimed` au lieu d'afficher un lien mort. Il refuse également une fois le
délai expiré (`claim_expired`), et dans un répertoire sans lien de réclamation
(`no_claim_link`). `rebase cloud status` et `rebase cloud whoami` affichent le même
lien tant que le projet n'est pas réclamé.

## Deploy and observe

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

`deploy` sans nom d'application déploie le backend. Un déploiement de bundle
backend téléverse également les sources du projet — ce que git suit, jamais un `.env` — afin qu'une
mise à niveau de la plateforme puisse le reconstruire ; `--no-source` ignore cela une fois, et `cloud settings set
--platform-rebuilds off` l'arrête et supprime la copie stockée. `--allow-downgrade` déploie une version antérieure.

Un `deploy` suivi se termine par un résumé : chaque application livrée avec son URL,
l'identifiant du déploiement, le temps qu'il a pris, et si la nouvelle version y répond. Il
attend jusqu'à `--live-timeout` secondes (par défaut 60 ; `0` ignore la vérification) que
le `/health` d'un backend et l'adresse de chaque application statique répondent. Un déploiement ayant échoué
se termine sur une ligne indiquant l'application et la raison, et quitte avec un code non nul. Le résumé
s'affiche même en cas de redirection par tube ; `--json` (ou `REBASE_JSON=1`) affiche un objet à la place,
avec `apps`, `hosts`, `live`, `liveChecks` et `durationMs`.

Avant le téléversement, `deploy` analyse le JavaScript de chaque application statique qu'il livre :
les fichiers `.js`/`.mjs`/`.cjs` dans son `output` et les blocs `<script>` inline dans
son HTML. Une erreur de syntaxe interrompt le déploiement avec `file:line:column` (code
`syntax_error` sous `--json`), et `--no-verify` ignore la vérification. Un déploiement
réussi se termine par la solution de retour en arrière, `rebase cloud rollback`. Une application statique déployée
seule ne peut pas encore faire l'objet d'un rollback ; voir
[Roll back](/docs/deployment/cloud#roll-back).

`--preview` sert le build sur `https://<project>--<name>.rebase.website` et
ne touche pas à la production. Une prévisualisation du backend exécute son propre backend, sur
sa propre base de données vide, avec ses applications statiques intégrées. Une application statique ne peut
pas encore être prévisualisée seule sur Rebase Cloud : `rebase cloud deploy <app> --preview`
est refusé avec `PREVIEW_STATIC_UNSERVED` et ne publie rien. Une prévisualisation de
backend est facturée comme une unité d'application supplémentaire à la taille par défaut tant qu'elle existe, et
le déploiement indique ce que cela représente par mois, d'après l'estimation propre au plan de contrôle
(`cost` sous `--json` ; uniquement la règle et ce lien lorsque le plan de contrôle ne peut
pas calculer de tarif) ; `rebase cloud previews delete <name>` l'arrête. `rebase cloud previews`
affiche une prévisualisation mise en pause par la plateforme (sa base de données ayant dépassé la limite de prévisualisation) sous
l'état `paused`, avec la raison (`statusMessage` sous `--json`). Une nouvelle adresse de prévisualisation
peut être refusée avec `preview_cert_budget` lorsque le quota hebdomadaire de certificats de
prévisualisation de la plateforme est épuisé ; le message indique jusqu'à quand.
Consultez [Prévisualiser une modification](/docs/deployment/cloud/#preview-a-change).

### Logs

`rebase cloud logs` affiche le dernier journal de build, et `-f` suit en temps réel un build
toujours en cours. `--runtime` lit plutôt ce que l'application affiche, depuis chaque pod
sous-jacent, chaque ligne étant étiquetée avec son pod :

```bash
rebase cloud logs --runtime -f                    # follow until Ctrl-C (exits 0)
rebase cloud logs --runtime --since 15m --grep timeout
rebase cloud logs --runtime -f --level error      # errors only
rebase cloud logs --runtime --previous            # a restarted container's last run
```

- `--since` prend une durée (`30s`, `5m`, `1h`) ou une heure RFC3339.
- `--tail <n>` indique le nombre de lignes par pod à partir duquel commencer (le plan de contrôle le plafonne à 2000).
- `--grep` conserve les lignes contenant le texte, sans tenir compte de la casse ; écrivez `/re/flags` pour
  une expression régulière.
- `--level error|warn|info|debug` conserve les lignes correspondant à cette sévérité ou pire. Il lit
  le champ structuré `severity` consigné par un backend Rebase, un mot de niveau au début d'une
  ligne de texte brut, ou une structure d'erreur telle que `TypeError:`. Les lignes sans indication sont omises.

Un suivi interroge toutes les deux secondes et affiche chaque ligne une seule fois. Il signale les pods
qui démarrent, s'arrêtent ou redémarrent. Lorsqu'un conteneur redémarre, il affiche également les dernières
lignes de l'instance qui s'est arrêtée, là où se trouve généralement la cause. Il patiente lorsqu'aucun
pod n'est en cours d'exécution, et après une coupure de connexion, il réessaie avec un délai exponentiel et
reprend là où il s'était arrêté. Avec `--json`, un suivi affiche un objet JSON par
ligne (NDJSON) : `{"type":"line","ts","pod","text"}` pour chaque ligne de log, et
`{"type":"event","event":…}` pour le reste.

`--preview <name>` lit les journaux d'une prévisualisation plutôt que ceux de la production. Utilisez le nom
de la prévisualisation ou l'identifiant de déploiement affiché lors d'un déploiement de prévisualisation. Utilisé seul, `--preview`
lit l'unique prévisualisation du projet. Une prévisualisation statique dispose d'un journal de build mais pas de
journal d'exécution, car elle n'exécute aucun serveur.

## Config

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
le nom `REBASE_API_TOKEN`, par son préfixe et jamais par sa valeur. Réclamer le projet
transfère cette clé et celle-ci cesse d'expirer. `app-key rotate` en génère une nouvelle et
révoque toutes les clés d'agent antérieures en une seule fois. Il écrit la nouvelle clé dans un `.env`
qui définit déjà `REBASE_API_TOKEN`, et l'exclut du `--json` à cet endroit. Dans
tout autre répertoire, il affiche la clé une seule fois. Les clés créées dans le panneau d'administration de l'application
ne sont pas modifiées. La commande s'exécute avec votre session de connexion : aucune capacité de jeton ne l'octroie.

`service-key`
affiche la génération de la clé `REBASE_SERVICE_KEY` du projet, la date de sa dernière
rotation, et indique si l'application est toujours en cours de redémarrage sur la clé la plus récente. Elle ne
l'affiche jamais : pour cela, utilisez `env reveal REBASE_SERVICE_KEY`. `service-key rotate`
génère une nouvelle clé et redémarre l'application sur celle-ci. L'ancienne clé fonctionne jusqu'à ce que le
redémarrage soit terminé, et plus du tout après. La commande est refusée pendant l'exécution d'un déploiement,
et elle s'exécute avec votre session de connexion. La réclamation d'un projet effectue également une rotation de sa clé de service.

Une prévisualisation backend démarre à partir des variables de production, clés actives incluses.
`env set KEY=VALUE --preview` attribue aux prévisualisations leur propre valeur, `env unset KEY
--preview` omet la variable de celles-ci, `env reset KEY --preview` restitue
la valeur de production, et `env list --preview` montre les différences.
La production n'est jamais modifiée par aucune de ces commandes.

`env set KEY --stdin` lit la valeur depuis l'entrée standard au lieu de la
ligne de commande, où `ps` et l'historique de votre shell la rendraient visible :

```bash
read -rs STRIPE_KEY   # paste the value; nothing is echoed
printf %s "$STRIPE_KEY" | rebase cloud env set STRIPE_KEY --stdin --secret
```

Un saut de ligne final éventuel est supprimé. La commande `rebase_cloud_env_set` du
serveur MCP définit les valeurs de cette manière.

## Organizations

```bash
rebase cloud orgs list | create
rebase cloud orgs members [list] | invite <email> [--role admin|member] | remove <email|uid> | role <email|uid> <role>
rebase cloud orgs invites [list] | revoke <id|email> | resend <id|email>
rebase cloud activity [--project <id|slug>] [--action <area|action>] [--actor <email>] [--limit N] [--before <cursor>]
```

`members invite` crée une invitation et affiche son lien : à usage unique,
valable 7 jours, accepté uniquement par un compte ayant vérifié cette adresse.
Personne ne rejoint l'organisation avant d'avoir accepté, même une personne possédant déjà un compte Rebase.
La sortie (et `emailDelivery` dans `--json`) indique si le lien a été envoyé par e-mail ; si
ce n'est pas le cas, un avertissement vous invite à envoyer le lien vous-même. `--role` peut être `admin` ou
`member` (par défaut). Personne n'est invité en tant que `owner` : invitez-le en tant qu'admin, puis
un propriétaire le promeut avec `members role <email> owner` une fois qu'il a rejoint l'organisation.
`invites resend` fournit un nouveau lien et l'ancien cesse de fonctionner.
L'envoi d'invitations et les sous-commandes de `invites` nécessitent une session `rebase cloud login` ; `REBASE_TOKEN` est
refusé. Inviter, lister, renvoyer et révoquer exigent le rôle de propriétaire ou d'administrateur ;
un membre en est informé.
`members remove` demande confirmation au préalable (`--yes` l'ignore) ; supprimer ou rétrograder un propriétaire
requiert d'être propriétaire, et le dernier propriétaire est conservé. `--org <id>` sélectionne une organisation
autre que celle sélectionnée.

`activity` correspond au journal d'audit de l'organisation sélectionnée, du plus récent au plus ancien : qui
a déployé, effectué un rollback, défini, supprimé ou révélé une variable d'environnement (par son
nom, jamais par sa valeur), modifié un domaine, créé, restauré ou téléchargé une
sauvegarde, modifié les ressources de calcul d'un projet, arrêté ou supprimé un projet, modifié le
rôle d'un membre, ou créé ou révoqué un jeton d'accès. `--action` prend un domaine
(`deploy`, `deploy_hook`, `env`, `domain`, `backup`, `pitr`, `database`,
`extension`, `storage`, `project`, `org`, `member`, `invite`, `token`) ou une action complète
telle que `env.set`. Une page contient jusqu'à 100 entrées (`--limit`, 50 par défaut) ; la
sortie affiche le curseur `--before` pour la suivante. `--json` renvoie une seule valeur,
`{ org, events, nextCursor }`. Cette commande nécessite le rôle de propriétaire ou d'administrateur de l'organisation.
Un jeton ne peut la lire qu'avec la capacité `audit` sur l'organisation
(`rebase cloud tokens create --can audit`). La page **Activity** de la console
affiche le même journal.

## Databases

```bash
rebase cloud db list | create | info | connect | test
rebase cloud db backup list | create | restore | status | download
rebase cloud db pitr status | restore | cutover | discard
```

`db connect` ouvre un port local qui *est* la base de données gérée (aucun point
de terminaison public) jusqu'à Ctrl-C ; `--reveal` ajoute le mot de passe. Propriétaire ou administrateur uniquement.

## Guests

<span class="since-badge" data-since="0.27">Since 0.27</span>

Chaque appel à `signInAnonymously()` lors d'un test, d'un bot ou d'une visite abandonnée laisse une ligne
dans les utilisateurs du projet. Ces commandes dénombrent ces lignes et les suppriment, évitant ainsi
d'avoir à les parcourir une par une manuellement.

```bash
rebase cloud guests                              # how many, and the ones last seen longest ago
rebase cloud guests --older-than 30d --limit 100 # the ones not seen for 30 days
rebase cloud guests delete <id>                  # one guest; asks first
rebase cloud guests prune --older-than 30d       # dry run: how many would go
rebase cloud guests prune --older-than 30d --yes # deletes them
```

`prune` prend un âge avec une unité : `45m`, `12h`, `30d` ou `2w`. Sans `--yes`, la commande
compte et ne supprime rien. Elle traite un projet de n'importe quelle taille par petits
lots.

Seuls les invités peuvent être supprimés. Un invité est une ligne avec `is_anonymous` activé, sans mot de passe et sans
identité liée, et l'application applique cette règle dans l'instruction qui supprime la
ligne, de sorte que la commande ne peut pas toucher à un compte, même inscrit un moment
après avoir été listé. `delete` refuse un compte avec `NOT_ANONYMOUS`.

**Dernière visite** correspond au moment où la session de l'invité a été émise ou actualisée pour la dernière fois, ou à
la date de création de l'invité s'il ne possède plus de jeton d'actualisation. Un invité qui revient régulièrement
n'est pas considéré comme ancien, peu importe quand il a été créé. Les jetons d'actualisation d'un invité
supprimé ainsi que toutes les autres lignes d'authentification associées sont supprimés en même temps.

Les lignes de vos propres tables suivent leur clé étrangère :

| La colonne | Ce qui arrive à la ligne |
|---|---|
| Lien optionnel (`ON DELETE SET NULL`, par défaut) | Conservée, avec le lien vidé |
| Lien obligatoire (`ON DELETE RESTRICT`, par défaut) | Conservée, ainsi que l'invité : l'invité est signalé comme ignoré, avec `GUEST_REFERENCED` |
| `onDelete: "cascade"` | Supprimée avec l'invité |
| Pas de clé étrangère (un champ `userSelect`, un simple identifiant) | Conservée, contenant un identifiant qui n'existe plus |

Vérifiez quels sont vos liens en cascade avant de passer `--yes` : l'opération est irréversible.

La commande lit `REBASE_SERVICE_KEY` de la même manière que `env reveal` ; elle nécessite donc d'être
propriétaire ou administrateur (ou un jeton doté de la capacité `env` appartenant à l'un d'eux). La
clé reste en mémoire et n'est envoyée qu'à l'adresse propre au projet. Un projet exécuté sur
un runtime plus ancien est averti qu'il doit utiliser une version plus récente.

## Resources

Ce que la plateforme détient pour le projet, par rapport à ce que son code déclare.

```bash
rebase cloud resources                       # each database and bucket: declared? provisioned?
rebase cloud resources prune database <key>  # remove one the code no longer declares
```

Un déploiement ne supprime jamais une base de données provisionnée lorsque sa déclaration disparaît — cela
reviendrait à supprimer des données lors d'un push. Il la conserve, la lie et la facture jusqu'à ce que quelqu'un
la supprime explicitement par son nom via prune.

## Compute

Ce que le projet réserve, et ce que cela coûte.

```bash
rebase cloud compute            # the current reservation and its monthly cost
rebase cloud compute set        # change it
```

`compute set` accepte `--cpu`, `--memory`, `--replicas`, `--spot`,
`--db-instances`, `--db-cpu`, `--db-memory`,
`--storage`, `--autoscale-max`, `--autoscale-cpu-target` et `--no-autoscale`.
`--scale-to-zero` est obsolète : chaque backend exécute au moins une instance, donc
`true` est refusé et `false` est ignoré avec un avertissement. Il n'y a pas de niveaux
d'abonnement : tout est facturé par ressource. Consultez
[Rebase Cloud](/docs/deployment/cloud/).

## Storage, notifications, clusters, billing and usage

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
le secret de signature une seule fois ; `--json` retourne `{ projectId, webhook, secret }`.
`test <id>` quitte avec le code 1 et l'erreur `delivery_failed` lorsque le récepteur n'a pas accepté
l'événement de test. La consultation de la liste est ouverte à tout membre de l'organisation ; `add`, `test`
et `remove` requièrent le rôle de propriétaire ou d'administrateur. Un jeton peut les gérer avec la
capacité `notifications` sur l'organisation, selon les mêmes règles de rôle. Consultez
[Notifications Cloud](/docs/deployment/cloud-notifications/).

`clusters registry <cluster-id> --repository <host/project/repo>
--push-service-account <email> --pull-key-file <key.json>` attribue au cluster d'un
client son propre registre d'images, réservé exclusivement à ce cluster. Sans
registre dédié, un tel cluster utilise le registre partagé de la plateforme, et chaque déploiement vers celui-ci
le signale dans ses journaux. Avec un registre dédié, les builds poussent vers ce dépôt avec un jeton pour
ce compte, les pods effectuent des pulls avec cette seule clé, et un rollback accepte les
images du projet qui s'y trouvent. Les images
que le projet a construites auparavant dans le registre partagé restent récupérables et continuent de pouvoir
servir de cibles de rollback. Les trois valeurs doivent être fournies ensemble ; `--clear` les efface. La clé
est scellée lors de son écriture et n'est jamais relue. Comme pour le reste de `clusters`,
le rôle platform-admin est requis. L'opérateur crée le dépôt et les deux
comptes avec Terraform (`saas/infra/gcp/registry-linked-clusters.tf`).

`billing invoices` et `billing upcoming` lisent les mêmes données Stripe que la
page Billing de la console, et ne sont accessibles qu'aux propriétaires et administrateurs
de l'organisation. Un jeton peut y accéder, ainsi qu'au reste de `billing`, grâce à la capacité `billing`
sur l'organisation ; un jeton créé avant l'introduction de cette capacité continue de
fonctionner pendant une version, avec un avertissement à chaque réponse. Les montants dans `--json` sont exprimés dans la sous-unité de la devise (centimes), exactement tels que
Stripe les envoie. Les factures à l'état de brouillon ne sont pas listées ; la prévisualisation est calculée par
Stripe et ses lignes à l'usage continuent d'augmenter jusqu'à la clôture de la période.

`usage` lit ce que le projet lié (ou `--project`) a consommé au cours d'un mois
civil, en UTC : requêtes par rapport au forfait inclus, erreurs 5xx, dépassement
jusqu'à présent en euros et, pour le mois en cours, projection à ce
rythme (une estimation). Le dépassement correspond au calcul propre du rapport de dépassement,
celui qui indique à Stripe quoi facturer, et qui apparaît sur la facture du mois suivant.
`usage org` liste chaque projet de l'organisation sélectionnée avec `rebase cloud
use`, ainsi que le total. Tout membre de l'organisation peut le consulter. Un jeton peut le lire
avec la capacité `logs` sur le projet ; `usage org` liste les projets pour lesquels le
jeton détient cette capacité.
`--month` prend un mois passé. La réponse comporte des `caveats`, chacun avec un `code` : `storage_not_measured`
(le stockage d'objets affiche 0), `multi_pod_undercount` (les requêtes traitées lorsque deux pods d'application
ou plus s'exécutent ne sont pas comptabilisées), `partial_days`, `metering_off`,
`overage_billing_off`, `not_billed`, `billed_next_month`, `pre_claim_days` (un
projet réclamé depuis un agent ne compte que les jours à partir de la réclamation) et
`autoscale_not_charged` (des pods ont fonctionné au-delà de `--replicas` et cette plateforme ne les
facture pas encore). La réponse d'un projet avec autoscaling comporte également `autoscale` :
`extraPodSeconds` au-dessus du plancher, `amountEur` selon ses tarifs, et `charged`.
