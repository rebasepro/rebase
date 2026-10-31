---
sourceHash: 4b7b199f1aa18e8d
title: rebase cloud
sidebar_label: rebase cloud
description: Les groupes de commandes pour Rebase Cloud dans la CLI — auth, liaison de projet, déploiements, notifications, config, organisations, bases de données, ressources, compute, stockage, clusters, facturation et utilisation.
---

Tout ce qui concerne Rebase Cloud, actuellement en bêta privée. Consultez le
[guide Rebase Cloud](/docs/deployment/cloud/) pour savoir ce que c'est et ce que la bêta
n'inclut pas.

Chaque groupe répond à `--help`, et `--help` n'exécute jamais la commande. La plupart des commandes
agissent sur le projet lié dans `.rebase/cloud.json` ; `--project <id>` opère sur
un projet sans liaison préalable.

Trois options s'appliquent partout : `--json` pour une sortie lisible par machine (également par défaut lors d'une redirection par pipe, sauf pour `deploy`, ou avec `REBASE_JSON=1`), `--url <origin>` pour cibler un plan de contrôle spécifique (ou `REBASE_CLOUD_URL`), et `--project, -p <id>`.

## Authentification

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
sinon celle qui est sélectionnée. Un jeton peut ne détenir que des capacités d'organisation.
`logs` couvre aussi `usage`. Ce que chacune permet d'atteindre se trouve dans
[CI et agents](/docs/deployment/cloud-agents/#ci-and-agents). Lorsque le plan de
contrôle marque une réponse à un jeton comme dépréciée (un jeton antérieur à `billing`
qui lit la facturation), le CLI affiche l'avis une fois sur stderr, jamais dans la
valeur `--json`.

Dans un terminal, sans mot de passe fourni, `login` demande s'il faut utiliser votre mot de passe
ou un code que le plan de contrôle vous envoie par e-mail. Si l'authentification à deux facteurs est activée, il
demande ensuite le code de votre application d'authentification (ou un code de récupération). Sans terminal,
ni l'un ni l'autre ne peut être saisi : définissez `REBASE_TOKEN` avec un jeton d'accès créé dans la console
sous Settings → Access tokens. Voir [Rebase Cloud](/docs/deployment/cloud#link-a-project).

## Liaison de projet

```bash
rebase cloud link         # link this directory to a cloud project
rebase cloud link [url]   # or straight at a backend: no control plane, no login, and the rest of the family refuses until you unlink
rebase cloud unlink       # remove the link
rebase cloud use [org]    # select the active organization
rebase cloud open         # open the dashboard in a browser
```

## Projets

```bash
rebase cloud init --claim [--name <name>]   # a live backend with no account, and a link to claim it within 72 hours
rebase cloud claim [--open]                 # that link again, and how long is left
rebase cloud projects list
rebase cloud projects create [--link]
rebase cloud projects info [id]
rebase cloud projects delete [id]
```

`claim` affiche le lien de réclamation du projet que `init --claim` a provisionné dans ce
répertoire, ainsi que le temps restant avant sa suppression s'il n'est pas réclamé (`Unclaimed: deleted
in 41h`). `--open` l'ouvre aussi dans un navigateur. Le lien n'est conservé que sur la
machine qui a exécuté `init --claim`, dans `~/.rebase/credentials.json` ; le plan de
contrôle en stocke un hash et ne peut pas l'afficher de nouveau. Avant de répondre, `claim`
demande au plan de contrôle si le jeton propre au projet fonctionne encore. Une réclamation
révoque ce jeton ; une fois le projet réclamé par quelqu'un, `claim` refuse donc
avec `already_claimed` plutôt que d'afficher un lien mort. Il refuse aussi une fois la
fenêtre terminée (`claim_expired`), et dans un répertoire sans lien de réclamation
(`no_claim_link`). `rebase cloud status` et `rebase cloud whoami` affichent le même
lien tant que le projet n'est pas réclamé.

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
téléverse également les sources du projet — ce que git suit, jamais un `.env` — afin qu'une
mise à niveau de la plateforme puisse le reconstruire ; `--no-source` ignore cela une fois, et `cloud settings set
--platform-rebuilds off` l'arrête et supprime la copie stockée. `--allow-downgrade` déploie une version plus ancienne.

Un `deploy` suivi se termine par un résumé : chaque application déployée avec son URL, l'identifiant du déploiement, sa durée et si la nouvelle version y répond. Il attend jusqu'à `--live-timeout` secondes (60 par défaut ; `0` ignore la vérification) que le `/health` du backend et l'adresse de chaque application statique répondent. Un déploiement en échec se termine par une ligne qui nomme l'application et la raison, avec un code de sortie non nul. Le résumé s'affiche aussi via un pipe ; `--json` (ou `REBASE_JSON=1`) affiche à la place un objet avec `apps`, `hosts`, `live`, `liveChecks` et `durationMs`.

Avant le téléversement, `deploy` analyse le JavaScript de chaque application statique qu'il livre : les fichiers `.js`/`.mjs`/`.cjs` de son `output` et les blocs `<script>` en ligne de son HTML. Une erreur de syntaxe arrête le déploiement avec `file:line:column` (code `syntax_error` avec `--json`), et `--no-verify` désactive la vérification. Un déploiement réussi se termine par le chemin du retour, `rebase cloud rollback`. Une application statique déployée seule ne peut pas encore faire l'objet d'un rollback ; voir [Rollback](/docs/deployment/cloud#roll-back).

`--preview` sert le build à l'adresse `https://<project>--<name>.rebase.website` et laisse la production intacte. Un aperçu du backend exécute son propre backend, sur une base de données vide qui lui est propre, avec ses applications statiques intégrées. Une application statique ne peut pas encore être prévisualisée seule sur Rebase Cloud : `rebase cloud deploy <app> --preview` est refusé avec `PREVIEW_STATIC_UNSERVED` et ne publie rien. Un aperçu de backend est facturé comme une unité d'application supplémentaire à la taille par défaut tant qu'il existe, et le déploiement indique ce que cela représente par mois, d'après le devis du plan de contrôle lui-même (`cost` avec `--json` ; seulement la règle et ce lien lorsque le plan de contrôle ne peut pas établir de prix) ; `rebase cloud previews delete <name>` l'arrête. `rebase cloud previews` affiche un aperçu mis en pause par la plateforme (sa base de données a dépassé la limite des aperçus) comme `paused`, avec la raison (`statusMessage` avec `--json`). Une nouvelle adresse d'aperçu peut être refusée avec `preview_cert_budget` lorsque le budget hebdomadaire de certificats d'aperçu de la plateforme est épuisé ; le message indique jusqu'à quand. Voir [Prévisualiser un changement](/docs/deployment/cloud/#preview-a-change).

### Logs

`rebase cloud logs` affiche le dernier log de build, et `-f` suit un build encore en
cours. `--runtime` lit à la place ce que l'app affiche, depuis chaque pod
derrière elle, chaque ligne étant étiquetée avec son pod :

```bash
rebase cloud logs --runtime -f                    # follow until Ctrl-C (exits 0)
rebase cloud logs --runtime --since 15m --grep timeout
rebase cloud logs --runtime -f --level error      # errors only
rebase cloud logs --runtime --previous            # a restarted container's last run
```

- `--since` accepte une durée (`30s`, `5m`, `1h`) ou une heure RFC3339.
- `--tail <n>` est le nombre de lignes par pod à partir desquelles démarrer (le plan de contrôle le plafonne à 2000).
- `--grep` garde les lignes contenant le texte, sans tenir compte de la casse ; écrivez `/re/flags` pour une
  expression régulière.
- `--level error|warn|info|debug` garde les lignes de cette sévérité ou pire. Il lit
  le `severity` structuré qu'un backend Rebase journalise, un mot de niveau au début d'une
  ligne simple, ou une forme d'erreur telle que `TypeError:`. Les lignes sans aucun de ces éléments sont exclues.

Un suivi interroge toutes les deux secondes et affiche chaque ligne une seule fois. Il signale les pods
qui démarrent, s'arrêtent ou redémarrent. Lorsqu'un conteneur redémarre, il affiche aussi les dernières
lignes de l'instance qui est morte, là où se trouve généralement la raison. Il attend tant qu'aucun
pod ne tourne, et après une connexion interrompue il réessaie avec un backoff et
reprend là où il s'était arrêté. Avec `--json`, un suivi affiche un objet JSON par
ligne (NDJSON) : `{"type":"line","ts","pod","text"}` pour chaque ligne de log, et
`{"type":"event","event":…}` pour le reste.

`--preview <name>` lit un aperçu au lieu de la production. Utilisez le nom de l'aperçu,
ou l'identifiant de déploiement qu'un déploiement d'aperçu a affiché. Seul, `--preview`
lit l'unique aperçu du projet. Un aperçu statique a un log de build mais pas de log
d'exécution, car il ne fait tourner aucun serveur.

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
clé que `rebase cloud init --claim` a créée sur l'app et écrite dans `.env` sous le nom
`REBASE_API_TOKEN`, par son préfixe et jamais par sa valeur. Réclamer le projet
transmet cette clé et elle cesse d'expirer. `app-key rotate` en crée une nouvelle et
révoque d'un coup toutes les clés d'agent précédentes. Il écrit la nouvelle clé dans un `.env`
qui définit déjà `REBASE_API_TOKEN`, et la garde hors de `--json` dans ce cas. Dans
tout autre répertoire, il affiche la clé une seule fois. Les clés créées dans le panneau d'administration de l'app
ne sont pas touchées. Il s'exécute avec votre session : aucune capacité de jeton ne l'autorise.

`service-key`
affiche la génération du `REBASE_SERVICE_KEY` du projet, la date de sa dernière
rotation, et si l'app est encore en train de redémarrer sur la plus récente. Il n'affiche jamais
la clé : c'est le rôle de `env reveal REBASE_SERVICE_KEY`. `service-key rotate`
émet une nouvelle clé et redémarre l'app dessus. L'ancienne clé fonctionne jusqu'à la fin du
redémarrage, et plus du tout ensuite. Il est refusé pendant qu'un déploiement
est en cours, et il s'exécute avec votre session. Réclamer un projet fait aussi tourner sa clé
de service.

Un aperçu de backend démarre avec les variables de la production, clés live comprises. `env set KEY=VALUE --preview` donne aux aperçus leur propre valeur, `env unset KEY --preview` exclut la variable des aperçus, `env reset KEY --preview` rend la valeur de la production, et `env list --preview` montre les différences. Aucune de ces commandes ne modifie la production.

`env set KEY --stdin` lit la valeur sur l'entrée standard plutôt que sur la
ligne de commande, où `ps` et l'historique de votre shell l'afficheraient :

```bash
read -rs STRIPE_KEY   # paste the value; nothing is echoed
printf %s "$STRIPE_KEY" | rebase cloud env set STRIPE_KEY --stdin --secret
```

Un saut de ligne final est supprimé. `rebase_cloud_env_set` du serveur MCP définit les
valeurs de cette façon.

## Organisations

```bash
rebase cloud orgs list | create
rebase cloud orgs members [list] | invite <email> [--role admin|member] | remove <email|uid> | role <email|uid> <role>
rebase cloud orgs invites [list] | revoke <id|email> | resend <id|email>
rebase cloud activity [--project <id|slug>] [--action <area|action>] [--actor <email>] [--limit N] [--before <cursor>]
```

`members invite` ouvre une invitation et affiche son lien : à usage unique,
valable 7 jours, acceptée uniquement par un compte ayant vérifié cette adresse.
Personne ne rejoint l'organisation tant qu'il n'a pas accepté, même quelqu'un qui a déjà un compte Rebase.
La sortie (et `emailDelivery` dans `--json`) indique si le lien a été envoyé par e-mail ; sinon,
un avertissement demande d'envoyer le lien vous-même. `--role` vaut `admin` ou
`member` (par défaut). Personne n'est invité comme `owner` : invitez-le comme administrateur, et
un propriétaire le promeut avec `members role <email> owner` une fois qu'il a rejoint l'organisation.
`invites resend` donne un nouveau lien et l'ancien cesse de fonctionner.
Inviter et `invites` exigent une session `rebase cloud login` ; `REBASE_TOKEN` est
refusé. Inviter, lister, renvoyer et révoquer exigent le rôle de propriétaire ou d'administrateur ;
un membre en est informé.
`members remove` demande d'abord confirmation (`--yes` l'ignore) ; retirer ou rétrograder un propriétaire
exige un propriétaire, et le dernier propriétaire reste. `--org <id>` choisit une organisation
autre que celle qui est sélectionnée.

`activity` est le journal d'audit de l'organisation sélectionnée, du plus récent au plus ancien : qui a
déployé, annulé un déploiement, défini, supprimé ou révélé une variable d'environnement (par son
nom, jamais par sa valeur), modifié un domaine, créé, restauré ou téléchargé une
sauvegarde, modifié le compute d'un projet, arrêté ou supprimé un projet, changé le rôle d'un
membre, ou créé ou révoqué un jeton d'accès. `--action` accepte un domaine
(`deploy`, `deploy_hook`, `env`, `domain`, `backup`, `pitr`, `database`,
`extension`, `storage`, `project`, `org`, `member`, `invite`, `token`) ou une action complète
telle que `env.set`. Une page contient jusqu'à 100 entrées (`--limit`, 50 par défaut) ; la
sortie affiche le curseur `--before` pour la suivante. `--json` est une seule valeur,
`{ org, events, nextCursor }`. Cela exige le rôle de propriétaire ou d'administrateur de l'organisation.
Un jeton ne le lit qu'avec la capacité `audit` sur l'organisation
(`rebase cloud tokens create --can audit`). La page **Activity** de la console
affiche le même journal.

## Bases de données

```bash
rebase cloud db list | create | info | connect | test
rebase cloud db backup list | create | restore | status | download
rebase cloud db pitr status | restore | cutover | discard
```

`db connect` ouvre un port local qui *est* la base de données gérée (aucun point
d'accès public) jusqu'à Ctrl-C ; `--reveal` ajoute le mot de passe. Propriétaire ou administrateur uniquement.

## Invités

<span class="since-badge" data-since="0.27">Depuis 0.27</span>

Chaque `signInAnonymously()` dans un test, un bot ou une visite abandonnée laisse une ligne
dans les utilisateurs du projet. Ces commandes comptent ces lignes et les suppriment, pour
que personne n'ait à les parcourir une par une.

```bash
rebase cloud guests                              # how many, and the ones last seen longest ago
rebase cloud guests --older-than 30d --limit 100 # the ones not seen for 30 days
rebase cloud guests delete <id>                  # one guest; asks first
rebase cloud guests prune --older-than 30d       # dry run: how many would go
rebase cloud guests prune --older-than 30d --yes # deletes them
```

`prune` prend un âge avec une unité : `45m`, `12h`, `30d` ou `2w`. Sans `--yes`, il
compte et ne supprime rien. Il traite un projet de n'importe quelle taille par petits
lots.

Seuls les invités peuvent disparaître. Un invité est une ligne dont `is_anonymous` est
défini, sans mot de passe ni identité liée, et l'application applique cette règle dans
l'instruction qui supprime la ligne : la commande ne peut donc atteindre aucun compte,
même un compte créé juste après l'établissement de la liste. `delete` refuse un compte
avec `NOT_ANONYMOUS`.

**Vu pour la dernière fois** désigne le moment où la session de l'invité a été émise ou
renouvelée pour la dernière fois, ou celui où l'invité a été créé s'il ne lui reste
aucun jeton de rafraîchissement. Un invité qui revient régulièrement n'est pas ancien,
quelle que soit sa date de création. Les jetons de rafraîchissement d'un invité supprimé
et toutes les autres lignes d'authentification partent avec lui.

Les lignes de vos propres tables suivent leur clé étrangère :

| La colonne | Ce qui arrive à la ligne |
|---|---|
| Lien facultatif (`ON DELETE SET NULL`, la valeur par défaut) | Conservée, avec le lien vidé |
| Lien obligatoire (`ON DELETE RESTRICT`, la valeur par défaut) | Conservée, et l'invité avec elle : l'invité est signalé comme ignoré, avec `GUEST_REFERENCED` |
| `onDelete: "cascade"` | Supprimée avec l'invité |
| Aucune clé étrangère (un champ `userSelect`, un identifiant simple) | Conservée, avec un identifiant qui n'existe plus |

Vérifiez lesquels de vos liens sont en cascade avant de passer `--yes` : l'opération est irréversible.

La commande lit `REBASE_SERVICE_KEY` comme le fait `env reveal`, elle accepte donc un
propriétaire ou un administrateur (ou un jeton disposant de la capacité `env` qui
appartient à l'un d'eux). La clé reste en mémoire et n'est envoyée qu'à l'adresse
propre au projet. Un projet sur un runtime plus ancien se voit signaler qu'il lui en
faut un plus récent.

## Ressources

Ce que la plateforme détient pour le projet, par rapport à ce que son code déclare.

```bash
rebase cloud resources                       # each database and bucket: declared? provisioned?
rebase cloud resources prune database <key>  # remove one the code no longer declares
```

Un déploiement ne supprime jamais une base de données provisionnée lorsque sa déclaration disparaît — cela
reviendrait à supprimer des données lors d'un push. Il la conserve, la lie et la facture jusqu'à ce que quelqu'un
la supprime explicitement par son nom.

## Compute

Ce que le projet réserve, et ce que cela coûte.

```bash
rebase cloud compute            # the current reservation and its monthly cost
rebase cloud compute set        # change it
```

`compute set` accepte `--cpu`, `--memory`, `--replicas`, `--spot`,
`--db-instances`, `--db-cpu`, `--db-memory`,
`--storage`, `--autoscale-max`, `--autoscale-cpu-target` et `--no-autoscale`.
`--scale-to-zero` est retiré : chaque backend exécute au moins une instance, donc
`true` est refusé et `false` est ignoré avec un avertissement. Il n'y a pas de niveaux
d'abonnements : chaque ressource est facturée à l'usage. Consultez
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

`notifications add <url>` envoie les événements du projet lié vers une URL. `--events`
accepte une liste séparée par des virgules parmi `deploy.failed` (par défaut),
`deploy.succeeded`, `deploy.rolled_back`, `backup.unhealthy`,
`billing.payment_failed`, `usage.threshold` et `preview.paused`. `--format slack` envoie
`{ "text" }` seul au lieu du JSON de l'événement, qui porte lui aussi un `text`. L'URL
est un argument positionnel car `--url` désigne le plan de contrôle. `add` affiche
le secret de signature une seule fois ; `--json` renvoie `{ projectId, webhook, secret }`.
`test <id>` se termine avec le code 1 et `delivery_failed` lorsque le destinataire n'a pas accepté
l'événement de test. Lister est ouvert à tout membre de l'organisation ; `add`, `test`
et `remove` exigent le rôle de propriétaire ou d'administrateur. Un jeton les gère avec la
capacité `notifications` sur l'organisation, selon la même règle de rôle. Voir
[Cloud notifications](/docs/deployment/cloud-notifications/).

`clusters registry <cluster-id> --repository <host/project/repo>
--push-service-account <email> --pull-key-file <key.json>` donne au cluster
d'un client son propre registre d'images, utilisé pour ce seul cluster. Sans
registre, un tel cluster utilise le registre partagé de la plateforme, et chaque déploiement vers lui
l'indique dans son log. Avec un registre, les builds poussent vers ce dépôt avec un jeton pour
ce compte, les pods tirent avec cette seule clé, et un rollback accepte les images du
projet qui s'y trouvent. Les images
que le projet a construites auparavant dans le dépôt partagé restent récupérables et restent des
cibles de rollback. Les trois valeurs vont ensemble ; `--clear` les oublie. La clé
est scellée à l'écriture et jamais relue. Comme le reste de `clusters`,
il exige le rôle d'administrateur de la plateforme. L'opérateur crée le dépôt et les deux
comptes avec Terraform (`saas/infra/gcp/registry-linked-clusters.tf`).

`billing invoices` et `billing upcoming` lisent les mêmes données Stripe que la
page Billing de la console, et sont réservés aux propriétaires et administrateurs de l'organisation.
Un jeton y accède, comme au reste de `billing`, avec la capacité
`billing` sur l'organisation ; un jeton créé avant cette capacité continue de
fonctionner pendant une version, avec un avertissement à chaque réponse. Les montants dans `--json` sont dans la plus petite unité de la devise (centimes), exactement comme
Stripe les envoie. Les factures brouillon ne sont pas listées ; l'aperçu est calculé par
Stripe et ses lignes mesurées continuent de croître jusqu'à la clôture de la période.

`usage` lit ce que le projet lié (ou `--project`) a consommé sur un mois
calendaire, en UTC : les requêtes par rapport au quota inclus, les erreurs 5xx, le dépassement
à ce jour en euros et, pour le mois en cours, la projection à ce
rythme (une estimation). Le dépassement est le calcul propre du rapport de dépassement, celui
qui indique à Stripe quoi facturer, et figure sur la facture du mois suivant.
`usage org` liste chaque projet de l'organisation sélectionnée avec `rebase cloud
use`, et le total. Tout membre de l'organisation peut le lire. Un jeton le lit avec
la capacité `logs` sur le projet ; `usage org` liste les projets pour lesquels le
jeton détient cette capacité.
`--month` accepte un mois passé. La réponse porte des `caveats`, chacun avec un `code` : `storage_not_measured`
(le stockage d'objets indique 0), `multi_pod_undercount` (les requêtes servies pendant que deux
pods d'application ou plus tournent ne sont pas comptées), `partial_days`, `metering_off`,
`overage_billing_off`, `not_billed`, `billed_next_month`, `pre_claim_days` (un
projet réclamé depuis un agent ne compte que les jours à partir de la réclamation) et
`autoscale_not_charged` (des pods ont tourné au-delà de `--replicas` et cette plateforme ne les
facture pas encore). La réponse d'un projet avec autoscaling porte aussi `autoscale` :
`extraPodSeconds` au-delà du plancher, `amountEur` à ses tarifs, et `charged`.
