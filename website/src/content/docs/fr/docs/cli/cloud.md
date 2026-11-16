---
sourceHash: b5c0e7ccbbb0b521
title: rebase cloud
sidebar_label: rebase cloud
description: Les groupes de commandes pour Rebase Cloud dans la CLI — auth, liaison de projet, déploiements, notifications, config, organisations, bases de données, ressources, calcul, stockage, clusters, facturation et consommation.
---

Tout ce qui concerne Rebase Cloud, qui est actuellement en version bêta privée. Consultez le
[guide Rebase Cloud](/docs/deployment/cloud/) pour savoir en quoi cela consiste et ce qui n'est
pas inclus dans la bêta.

Chaque groupe répond à `--help`, et `--help` n'exécute jamais la commande. La plupart des commandes
agissent sur le projet lié dans `.rebase/cloud.json` ; `--project <id>` opère sur
un projet sans nécessiter de liaison.

Trois options s'appliquent partout : `--json` pour une sortie lisible par une machine (également la
valeur par défaut lors d'une redirection dans un tube/pipe, sauf pour `deploy`, ou avec `REBASE_JSON=1`), `--url <origin>` pour cibler un
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
(`--project`, ou le projet lié), ainsi que `billing`, `audit` et
`notifications` sur une organisation : `--org`, sinon l'organisation du projet,
sinon celle sélectionnée. Un jeton peut détenir uniquement des capacités d'organisation.
`logs` couvre également `usage`. Le périmètre auquel chacune donne accès est détaillé dans
[CI and agents](/docs/deployment/cloud-agents/#ci-and-agents). Lorsque le plan de
contrôle marque la réponse à un jeton comme dépréciée (par exemple un jeton antérieur à `billing`
qui consulte la facturation), la CLI affiche l'avertissement une seule fois sur stderr, jamais dans la
valeur `--json`.

Sans option, `login` effectue la connexion via le navigateur. La commande affiche un code court et
un lien vers la console, ouvre le navigateur et attend que vous y approuviez la
connexion. Soit vous êtes déjà connecté à la console, soit vous vous connectez avec
l'une des méthodes proposées (mot de passe, Google, GitHub, LinkedIn). Vérifiez que le
navigateur affiche le même code avant de l'approuver. Le lien expire au bout de dix
minutes et n'est utilisable qu'une seule fois. Sans terminal ou avec `--json`, le lien et le code
sont envoyés sur stderr et `login` continue d'attendre, permettant à un agent de vous transmettre le lien. Une
connexion refusée quitte avec `access_denied`, et une tentative expirée avec `expired_token`.

Avec `--email`, `login` vous demande s'il faut utiliser votre mot de passe ou un code que le plan de
contrôle vous envoie par e-mail. Si l'authentification à deux facteurs est activée, la commande demande ensuite votre
code d'authentification (ou un code de récupération) ; via le navigateur, approuvez la connexion depuis une
session de console qui l'a utilisée. Sans terminal, aucun des deux codes ne peut être saisi : définissez
`REBASE_TOKEN` avec un jeton d'accès créé dans la console sous Settings → Access
tokens. Consultez [Rebase Cloud](/docs/deployment/cloud#link-a-project).

## Project link

```bash
rebase cloud link         # link this directory to a cloud project
rebase cloud link [url]   # or straight at a backend: no control plane, no login, and the rest of the family refuses until you unlink
rebase cloud unlink       # remove the link
rebase cloud use [org]    # select the active organization
rebase cloud open         # open the dashboard in a browser
```

### Connect a self-hosted instance to Claude

```bash
rebase cloud connect https://your-app.com      # add it to your account; prints two variables, waits until it answers
rebase cloud connect --list                    # the instances you added, and whether each is connected
rebase cloud connect --remove https://your-app.com
```

Le [connecteur Rebase](/docs/ai/rebase-connector/) (`https://app.rebase.pro/mcp`)
peut ensuite y accéder aux côtés de vos projets Cloud. `connect` affiche
`REBASE_PLATFORM_TOKEN_KEY` et `REBASE_PLATFORM_TOKEN_AUDIENCE` ; définissez-les sur
le serveur et redémarrez-le. Dans le dossier du projet, il propose de les écrire dans
`.env`. Réexécuter la commande est sans risque. `--name` nomme l'instance, `--org` choisit
l'organisation, `--no-wait` rend la main sans attendre. Réservé aux propriétaires et administrateurs.

## Projects

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
machine qui a exécuté `init --claim`, dans `~/.rebase/credentials.json` ; le plan de
contrôle en stocke un hachage et ne peut pas l'afficher à nouveau. Avant de répondre, `claim`
demande au plan de contrôle si le jeton propre au projet fonctionne toujours. Une réclamation
révoque ce jeton ; ainsi, dès que quelqu'un a réclamé le projet, `claim` refuse
avec `already_claimed` au lieu d'afficher un lien mort. La commande refuse également une fois le
délai écoulé (`claim_expired`), et dans un répertoire sans lien de réclamation
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

`deploy` sans nom d'application déploie le backend. Le déploiement
d'un bundle backend téléverse également les sources du projet — ce qui est suivi par git, jamais un fichier `.env` — afin
qu'une mise à niveau de la plateforme puisse le recompiler ; `--no-source` ignore cela une fois, et `cloud settings set
--platform-rebuilds off` désactive cette fonctionnalité et supprime la copie stockée. `--allow-downgrade` permet de déployer une version antérieure.

Un `deploy` suivi se termine par un résumé : chaque application déployée avec son URL,
l'identifiant du déploiement, le temps nécessaire, et si la nouvelle version y répond. Il
attend jusqu'à `--live-timeout` secondes (60 par défaut ; `0` ignore la vérification) qu'une
réponse soit reçue sur le `/health` du backend et sur l'adresse de chaque application statique. Un déploiement
échoué se termine par une ligne indiquant l'application et la raison, et quitte avec un code d'erreur non nul. Le résumé
s'affiche même lors d'une redirection dans un pipe ; `--json` (ou `REBASE_JSON=1`) affiche à la place un objet unique,
avec `apps`, `hosts`, `live`, `liveChecks` et `durationMs`.

Avant le téléversement, `deploy` analyse le JavaScript de chaque application statique livrée :
les fichiers `.js`/`.mjs`/`.cjs` dans son `output` et les blocs `<script>` intégrés dans
son HTML. Une erreur de syntaxe interrompt le déploiement en indiquant `file:line:column` (code
`syntax_error` avec `--json`), et `--no-verify` permet d'ignorer cette vérification. Un déploiement
réussi se termine en indiquant le moyen de revenir en arrière, `rebase cloud rollback`. Une application statique
déployée seule ne peut pas encore faire l'objet d'un retour arrière ; voir
[Roll back](/docs/deployment/cloud#roll-back).

`--preview` sert le build sur `https://<project>--<name>.rebase.website` et
ne modifie pas la production. Une prévisualisation du backend exécute son propre backend, sur sa
propre base de données vide, avec ses applications statiques intégrées. Une application statique ne peut pas encore être
prévisualisée seule sur Rebase Cloud : `rebase cloud deploy <app> --preview`
est refusé avec `PREVIEW_STATIC_UNSERVED` et ne publie rien. Une prévisualisation
de backend est facturée comme une unité d'application supplémentaire à la taille par défaut pendant toute son existence, et
le déploiement indique le coût mensuel correspondant d'après l'estimation propre au plan de contrôle
(`cost` sous `--json` ; uniquement la règle et ce lien si le plan de contrôle ne peut pas en
calculer le prix) ; `rebase cloud previews delete <name>` l'arrête. `rebase cloud previews`
affiche une prévisualisation mise en pause par la plateforme (sa base de données ayant dépassé la limite autorisée pour une prévisualisation) sous l'état
`paused`, avec la raison (`statusMessage` sous `--json`). Une nouvelle adresse de prévisualisation
peut être refusée avec `preview_cert_budget` lorsque le quota hebdomadaire de certificats de
prévisualisation de la plateforme est épuisé ; le message précise alors jusqu'à quand.
Consultez [Preview a change](/docs/deployment/cloud/#preview-a-change).

### Logs

`rebase cloud logs` affiche le journal du dernier build, et `-f` suit en direct un build qui
est toujours en cours d'exécution. `--runtime` lit plutôt ce que l'application affiche sur sa sortie standard, depuis chaque pod
associé, chaque ligne étant marquée avec son pod :

```bash
rebase cloud logs --runtime -f                    # follow until Ctrl-C (exits 0)
rebase cloud logs --runtime --since 15m --grep timeout
rebase cloud logs --runtime -f --level error      # errors only
rebase cloud logs --runtime --previous            # a restarted container's last run
```

- `--since` accepte une durée (`30s`, `5m`, `1h`) ou une heure au format RFC3339.
- `--tail <n>` indique le nombre de lignes par pod par lesquelles commencer (le plan de contrôle le plafonne à 2000).
- `--grep` ne conserve que les lignes contenant le texte, sans tenir compte de la casse ; écrivez `/re/flags` pour une
  expression régulière.
- Avec `--grep` ou `--level`, le filtre recherche dans chaque ligne renvoyée par le plan de contrôle
  pour la fenêtre donnée (les 2000 plus récentes de chaque pod), et `--tail` compte les lignes correspondantes :
  les `n` correspondances les plus récentes par pod, 500 par défaut. Lorsqu'un pod a généré plus de lignes
  dans la fenêtre que cette limite, la sortie indique que les lignes plus anciennes n'ont pas
  été analysées (`filter.scanCapped` sous `--json`).
- `--level error|warn|info|debug` conserve les lignes de cette gravité ou pire. Il lit
  la `severity` structurée qu'un backend Rebase consigne, un mot de niveau au début d'une
  ligne en texte brut, ou une structure d'erreur telle que `TypeError:`. Les lignes n'en comportant aucune sont exclues.

Un suivi (`follow`) interroge le serveur toutes les deux secondes et affiche chaque ligne une seule fois. Il annonce les pods
qui démarrent, s'arrêtent ou redémarrent. Lorsqu'un conteneur redémarre, il affiche également les dernières
lignes de l'instance qui s'est arrêtée, là où se trouve généralement la raison. Il attend tant qu'aucun
pod n'est en cours d'exécution, et après une coupure de connexion, il réessaie avec un délai exponentiel (backoff) et
reprend là où il s'était arrêté. Avec `--json`, un suivi affiche un objet JSON par
ligne (NDJSON) : `{"type":"line","ts","pod","text"}` pour chaque ligne de journal, et
`{"type":"event","event":…}` pour le reste.

`--preview <name>` lit une prévisualisation au lieu de la production. Utilisez le
nom de la prévisualisation, ou l'identifiant de déploiement affiché lors du déploiement de la prévisualisation. Utilisé seul, `--preview`
lit l'unique prévisualisation du projet. Une prévisualisation statique dispose d'un journal de build mais d'aucun
journal d'exécution (runtime), car elle n'exécute aucun serveur.

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
le nom `REBASE_API_TOKEN`, par son préfixe et jamais par sa valeur. La réclamation du projet
transfère cette clé et celle-ci cesse d'expirer. `app-key rotate` en génère une nouvelle et
révoque toutes les clés d'agent précédentes en même temps. Elle écrit la nouvelle clé dans un `.env`
qui définit déjà `REBASE_API_TOKEN`, et l'exclut du retour `--json` dans ce cas. Dans
tout autre répertoire, elle affiche la clé une seule fois. Les clés créées dans le panneau d'administration de l'application
ne sont pas modifiées. Cette commande s'exécute avec votre session de connexion : aucune capacité de jeton ne permet de l'accorder.

`service-key`
affiche la génération de la clé `REBASE_SERVICE_KEY` du projet, la date de sa dernière
rotation, et indique si l'application est toujours en cours de redémarrage pour basculer sur la plus récente. Elle n'affiche jamais
la clé : pour cela, utilisez `env reveal REBASE_SERVICE_KEY`. `service-key rotate`
génère une nouvelle clé et redémarre l'application dessus. L'ancienne clé fonctionne jusqu'à ce que le
redémarrage soit terminé, et plus du tout après. Cette commande est refusée pendant qu'un déploiement est en
cours, et elle s'exécute avec votre session de connexion. La réclamation d'un projet effectue également la rotation de sa
clé de service.

Une prévisualisation de backend démarre à partir des variables de production, clés en direct incluses.
`env set KEY=VALUE --preview` attribue aux prévisualisations leur propre valeur, `env unset KEY
--preview` en exclut la variable, `env reset KEY --preview` rétablit
la valeur de production, et `env list --preview` affiche les différences.
Aucune d'entre elles ne modifie jamais la production.

`env set KEY --stdin` lit la valeur depuis l'entrée standard plutôt que depuis la
ligne de commande, où `ps` et l'historique de votre shell la rendraient visible :

```bash
read -rs STRIPE_KEY   # paste the value; nothing is echoed
printf %s "$STRIPE_KEY" | rebase cloud env set STRIPE_KEY --stdin --secret
```

Le saut de ligne final éventuel est supprimé. La fonction `rebase_cloud_env_set` du serveur MCP définit
les valeurs de cette manière.

## Organizations

```bash
rebase cloud orgs list | create
rebase cloud orgs members [list] | invite <email> [--role admin|member] | remove <email|uid> | role <email|uid> <role>
rebase cloud orgs invites [list] | revoke <id|email> | resend <id|email>
rebase cloud activity [--project <id|slug>] [--action <area|action>] [--actor <email>] [--limit N] [--before <cursor>]
```

`members invite` crée une invitation et affiche son lien : à usage unique,
valide 7 jours, accepté uniquement par un compte ayant vérifié cette adresse e-mail.
Personne ne rejoint l'organisation tant que l'invitation n'a pas été acceptée, même un utilisateur possédant déjà un compte Rebase.
La sortie (et `emailDelivery` dans `--json`) indique si le lien a été envoyé par e-mail ; si
ce n'est pas le cas, un avertissement vous invite à envoyer le lien vous-même. `--role` peut être `admin` ou
`member` (par défaut). Personne ne peut être invité en tant que `owner` : invitez la personne en tant qu'administrateur, et
un propriétaire pourra la promouvoir avec `members role <email> owner` une fois qu'elle aura rejoint l'organisation.
`invites resend` génère un nouveau lien et l'ancien cesse de fonctionner.
Inviter et utiliser `invites` nécessitent une session `rebase cloud login` ; `REBASE_TOKEN` est
refusé. L'invitation, le listage, le renvoi et la révocation requièrent le rôle
propriétaire ou administrateur ; un membre en est informé.
`members remove` demande confirmation préalable (`--yes` passe outre) ; supprimer ou rétrograder un propriétaire
nécessite d'être propriétaire, et le dernier propriétaire ne peut pas être retiré. `--org <id>` permet de sélectionner une organisation
autre que celle actuellement active.

`activity` correspond au journal d'audit de l'organisation sélectionnée, du plus récent au plus ancien : qui a
déployé, effectué un retour arrière, défini, supprimé ou révélé une variable d'environnement (par son
nom, jamais par sa valeur), modifié un domaine, créé, restauré ou téléchargé une
sauvegarde, modifié les ressources de calcul d'un projet, arrêté ou supprimé un projet, modifié le rôle
d'un membre, ou créé ou révoqué un jeton d'accès. `--action` accepte un domaine
(`deploy`, `deploy_hook`, `env`, `domain`, `backup`, `pitr`, `database`,
`extension`, `storage`, `project`, `org`, `member`, `invite`, `token`) ou une action complète
telle que `env.set`. Une page contient jusqu'à 100 entrées (`--limit`, 50 par défaut) ; la
sortie affiche le curseur `--before` pour la page suivante. `--json` renvoie une valeur unique,
`{ org, events, nextCursor }`. Cette commande nécessite le rôle propriétaire ou administrateur de l'organisation.
Un jeton ne peut la lire qu'avec la capacité `audit` sur l'organisation
(`rebase cloud tokens create --can audit`). La page **Activity** de la console
affiche le même journal.

## Databases

```bash
rebase cloud db list | create | info | connect | test
rebase cloud db backup list | create | restore | status | download
rebase cloud db pitr status | restore | cutover | discard
```

`db connect` ouvre un port local qui *est* la base de données gérée (aucun point d'accès
public) jusqu'à Ctrl-C ; `--reveal` ajoute le mot de passe. Propriétaire ou administrateur uniquement.

## Guests

Chaque `signInAnonymously()` lors d'un test, d'un passage de bot ou d'une visite abandonnée laisse une ligne
dans la table des utilisateurs du projet. Ces commandes comptent ces lignes et les suppriment, pour
que personne n'ait à les parcourir une à une.

```bash
rebase cloud guests                              # how many, and the ones last seen longest ago
rebase cloud guests --older-than 30d --limit 100 # the ones not seen for 30 days
rebase cloud guests delete <id>                  # one guest; asks first
rebase cloud guests prune --older-than 30d       # dry run: how many would go
rebase cloud guests prune --older-than 30d --yes # deletes them
```

`prune` prend une durée assortie d'une unité : `45m`, `12h`, `30d` ou `2w`. Sans `--yes`, la commande
compte et ne supprime rien. Elle traite des projets de toute taille par petits
lots.

Seuls les invités peuvent être supprimés. Un invité est une ligne avec `is_anonymous` activé, sans mot de passe et sans
identité liée, et l'application applique cette règle directement dans l'instruction qui supprime la
ligne, de sorte que la commande ne peut pas toucher à un vrai compte, même si celui-ci s'est inscrit un instant
après le listage. `delete` refuse un compte avec `NOT_ANONYMOUS`.

**Last seen** correspond au moment où la session de l'invité a été émise ou actualisée pour la dernière fois, ou au moment où
l'invité a été créé s'il n'a plus de jeton d'actualisation. Un invité qui continue de revenir n'est pas ancien,
quelle que soit la date de sa création. Les jetons d'actualisation d'un invité supprimé ainsi que toutes ses autres lignes d'authentification
sont supprimés avec lui.

Les lignes dans vos propres tables suivent leur clé étrangère :

| La colonne | Ce qui arrive à la ligne |
|---|---|
| Lien facultatif (`ON DELETE SET NULL`, par défaut) | Conservée, avec le lien vidé |
| Lien obligatoire (`ON DELETE RESTRICT`, par défaut) | Conservée, et l'invité avec : l'invité est signalé comme ignoré, avec `GUEST_REFERENCED` |
| `onDelete: "cascade"` | Supprimée avec l'invité |
| Pas de clé étrangère (un champ `userSelect`, un identifiant brut) | Conservée, contenant un identifiant qui n'existe plus |

Vérifiez lesquels de vos liens sont configurés en cascade avant de passer `--yes` : l'opération ne peut pas être annulée.

La commande transite par le proxy Studio de la console, qui détient la clé de l'application, de sorte que la clé n'atteint jamais votre
machine. Elle requiert le rôle de propriétaire ou d'administrateur de l'organisation, sur un projet dont l'accès Studio est activé
(`rebase cloud settings set --studio on`). Un projet fonctionnant sur un runtime plus ancien est informé qu'une mise à niveau est nécessaire.
`rebase users guests --project <slug>` est la même commande dans la famille de commandes du projet.

## Resources

Ce que la plateforme détient pour le projet, par rapport à ce que son code déclare.

```bash
rebase cloud resources                       # each database and bucket: declared? provisioned?
rebase cloud resources prune database <key>  # remove one the code no longer declares
```

Un déploiement ne supprime jamais une base de données provisionnée lorsque sa déclaration disparaît — cela
reviendrait à supprimer des données lors d'un push. Il la conserve, la lie et la facture jusqu'à ce que quelqu'un
la purge explicitement par son nom.

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
`true` est refusé et `false` est ignoré avec un avertissement. Il n'existe pas de paliers
d'abonnements : tout est tarifé par ressource. Consultez
[Rebase Cloud](/docs/deployment/cloud/).

## Storage, notifications, clusters, billing and usage

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
prend une liste séparée par des virgules de `deploy.failed` (par défaut),
`deploy.succeeded`, `deploy.rolled_back`, `backup.unhealthy`,
`billing.payment_failed`, `usage.threshold` et `preview.paused`. `--format slack` envoie
`{ "text" }` seul au lieu du JSON de l'événement, qui transporte également un champ `text`. L'URL
est un argument positionnel car `--url` sert à désigner le plan de contrôle. `add` affiche
le secret de signature une seule fois ; `--json` renvoie `{ projectId, webhook, secret }`.
`test <id>` quitte avec le code 1 et le code d'erreur `delivery_failed` lorsque le récepteur n'a pas accepté
l'événement de test. Le listage est ouvert à tout membre de l'organisation ; `add`, `test`
et `remove` nécessitent le rôle propriétaire ou administrateur. Un jeton peut les gérer avec la
capacité `notifications` sur l'organisation, selon les mêmes règles de rôle. Consultez
[Cloud notifications](/docs/deployment/cloud-notifications/).

`clusters registry <cluster-id> --repository <host/project/repo>
--push-service-account <email> --pull-key-file <key.json>` attribue au cluster d'un client
son propre registre d'images, utilisé pour ce cluster uniquement. Sans cela, un tel cluster utilise le registre partagé de la plateforme, et chaque déploiement vers celui-ci
le signale dans son journal. Avec ce registre dédié, les builds effectuent un push vers ce dépôt avec un jeton pour
ce compte, les pods effectuent un pull avec cette clé uniquement, et un retour arrière accepte les
images du projet présentes à cet endroit. Les images
que le projet a compilées auparavant dans le registre partagé restent récupérables par pull et restent
des cibles valides pour un retour arrière. Les trois valeurs vont ensemble ; `--clear` les efface. La clé
est scellée lorsqu'elle est écrite et n'est jamais relue. Comme le reste des commandes de `clusters`,
cette action nécessite le rôle administrateur de plateforme (platform-admin). L'opérateur crée le dépôt et les deux
comptes avec Terraform (`saas/infra/gcp/registry-linked-clusters.tf`).

`billing invoices` et `billing upcoming` lisent les mêmes données Stripe que la
page Facturation de la console, et sont accessibles uniquement aux propriétaires et administrateurs de l'organisation.
Un jeton y accède, ainsi qu'au reste de `billing`, avec la capacité `billing`
sur l'organisation ; un jeton créé avant cette capacité continue de fonctionner pendant une version, avec un avertissement sur chaque réponse. Les montants dans `--json` sont dans l'unité mineure de la devise (centimes), exactement tels que
Stripe les transmet. Les factures à l'état de brouillon ne sont pas listées ; la prévisualisation est calculée par
Stripe et ses lignes à l'usage continuent d'augmenter jusqu'à la clôture de la période.

`usage` indique ce que le projet lié (ou `--project`) a consommé au cours d'un mois
civil, en UTC : les requêtes par rapport au quota inclus, les erreurs 5xx, le dépassement
actuel en euros et, pour le mois en cours, l'estimation vers laquelle il se dirige à ce
rythme. Le dépassement est le calcul propre du rapport de dépassement,
celui qui indique à Stripe quoi facturer, et qui atterrit sur la facture du mois suivant.
`usage org` liste chaque projet de l'organisation sélectionnée avec `rebase cloud
use`, ainsi que le total. Tout membre de l'organisation peut le lire. Un jeton le lit
avec la capacité `logs` sur le projet ; `usage org` liste les projets pour lesquels le
jeton détient cette capacité.
`--month` prend un mois passé. La réponse comporte des avertissements (`caveats`), chacun avec un `code` : `storage_not_measured`
(le stockage d'objets affiche 0), `multi_pod_undercount` (les requêtes servies pendant que deux
pods applicatifs ou plus s'exécutent ne sont pas comptées), `partial_days`, `metering_off`,
`overage_billing_off`, `not_billed`, `billed_next_month`, `pre_claim_days` (un
projet réclamé depuis un agent ne compte que les jours à partir de la réclamation) et
`autoscale_not_charged` (des pods ont tourné au-delà de `--replicas` et cette plateforme ne
les facture pas encore). La réponse d'un projet avec autoscaling comporte également `autoscale` :
`extraPodSeconds` au-dessus du plancher, `amountEur` à ses tarifs, et `charged`.

## Deploy hooks, alerts and the rest

```bash
rebase cloud deploy-hooks [list] | create [--name <name>] [--branch <branch>] | revoke <id>   # secret URLs a git host or CI calls to deploy
rebase cloud alerts [list] [--all] | ack <id> | snooze <id> --hours <1-168>   # the project's incidents
rebase cloud deploy --git [<branch>]     # build on the control plane from the connected repository
rebase cloud metrics --runtime           # requests, errors and latency, per surface
rebase cloud metrics --history [--series cpu_millicores|memory_bytes|event_loop_delay_ms] [--minutes <n>]
rebase cloud domains primary <domain>    # make a verified domain the canonical one
rebase cloud domains redirect <domain> [--off]   # answer it with a 308 to the primary, path and query kept
rebase cloud settings set --studio on|off
rebase cloud orgs rename <name> [--slug <slug>]
rebase cloud orgs delete                 # refused while the organization has projects
rebase cloud billing email <address>     # where invoices go
rebase cloud clusters baseline <id> [--install]   # platform admins
```

`domains redirect` est configuré par domaine et désactivé par défaut, de sorte qu'un projet servant un hôte `api.` à côté de son site conserve les deux ; il prend effet tant que le domaine est vérifié et qu'un autre domaine est défini comme principal, et ne s'applique jamais à un domaine sur lequel une application est hébergée. `deploy-hooks create` affiche l'URL du hook une seule fois. `deploy --git` ne peut pas être combiné avec les options d'un build local, et sur le runtime géré, il nécessite `--eject`, car le plan de contrôle compile à partir des sources. `settings set --studio` est l'option que les commandes de projet (`rebase data`, `rebase users`, …) doivent voir activée pour `--project` : elles accèdent à l'application via le proxy Studio de la console. Une commande dont la route du plan de contrôle n'est pas encore déployée répond `not_served` en la nommant. Les commandes destructives demandent d'abord confirmation et refusent d'agir avec `confirmation_required` si personne ne peut répondre : passez `--yes`.
