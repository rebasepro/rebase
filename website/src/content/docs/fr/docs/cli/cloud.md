---
sourceHash: ea9a6d9deb4ba31b
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

Trois options s'appliquent partout : `--json` pour une sortie lisible par machine (également par
défaut en cas de redirection via un tube, sauf pour `deploy`, ou avec `REBASE_JSON=1`), `--url <origin>` pour cibler un
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
(`--project`, ou celui qui est lié), ainsi que `billing`, `audit` et
`notifications` sur une organisation : `--org`, sinon l'organisation du projet,
sinon celle sélectionnée. Un jeton ne peut détenir que des capacités d'organisation.
`logs` couvre également `usage`. La portée de chacun est détaillée dans
[CI et agents](/docs/deployment/cloud-agents/#ci-and-agents). Lorsque le plan de
contrôle marque une réponse à un jeton comme dépréciée (un jeton antérieur à `billing`
lisant la facturation), la CLI affiche l'avertissement une fois sur stderr, jamais dans la
valeur `--json`.

Sans option, `login` vous connecte via le navigateur. Il affiche un code court et
un lien vers la console, ouvre le navigateur et attend que vous approuviez la
connexion à cet endroit. Vous êtes déjà connecté à la console, ou vous vous connectez avec
l'une des méthodes proposées (mot de passe, Google, GitHub, LinkedIn). Vérifiez que le
navigateur affiche le même code avant de l'approuver. Le lien expire après dix
minutes et fonctionne une seule fois. Sans terminal, ou avec `--json`, le lien et le code
sont envoyés sur stderr et `login` continue d'attendre, permettant ainsi à un agent de vous transmettre le lien. Une
connexion refusée se termine par `access_denied`, une connexion expirée par `expired_token`.

Avec `--email`, `login` vous demande s'il faut utiliser votre mot de passe ou un code que le plan de
contrôle vous envoie par e-mail. Si l'authentification à deux facteurs est activée, il demande ensuite votre code
d'authentification (ou un code de récupération) ; via le navigateur, approuvez depuis une
session de console qui l'a utilisé. Sans terminal, aucun des deux codes ne peut être saisi : définissez
`REBASE_TOKEN` sur un jeton d'accès créé dans la console sous Settings → Access
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
ce dernier cas, elles indiquent celle qu'elles ont utilisée. `orgs delete` ne la déduit jamais
du lien : elle nécessite `--org` ou une organisation sélectionnée.

### Connecter une instance auto-hébergée à Claude

```bash
rebase cloud connect https://your-app.com      # add it to your account; prints two variables, waits until it answers
rebase cloud connect --list                    # the instances you added, and whether each is connected
rebase cloud connect --remove https://your-app.com
```

Le [connecteur Rebase](/docs/ai/rebase-connector/) (`https://app.rebase.pro/mcp`)
peut alors y accéder aux côtés de vos projets Cloud. `connect` affiche
`REBASE_PLATFORM_TOKEN_KEY` et `REBASE_PLATFORM_TOKEN_AUDIENCE` ; définissez-les sur
le serveur et redémarrez-le. Dans le dossier du projet, il propose de les écrire dans
`.env`. Il est sans danger de le réexécuter. `--name` nomme l'instance, `--org` choisit
l'organisation, `--no-wait` rend la main sans attendre. Propriétaires et administrateurs.

## Projets

```bash
rebase cloud init --claim [--name <name>]   # a live backend with no account, and a link to claim it within 72 hours
rebase cloud claim [--open]                 # that link again, and how long is left
rebase cloud projects list
rebase cloud projects list --all-orgs   # every organization you belong to
rebase cloud projects create [--link]
rebase cloud projects info [id]
rebase cloud projects transfer [id] --to-org <id|slug>
rebase cloud projects delete [id]
```

`claim` affiche le lien de réclamation du projet provisionné par `init --claim` dans ce
répertoire, ainsi que le temps restant avant qu'il ne soit supprimé s'il n'est pas réclamé (`Unclaimed: deleted
in 41h`). `--open` l'ouvre également dans un navigateur. Le lien n'est conservé que sur la
machine qui a exécuté `init --claim`, dans `~/.rebase/credentials.json` ; le plan de
contrôle en stocke un hachage et ne peut pas l'afficher à nouveau. Avant de répondre, `claim`
demande au plan de contrôle si le propre jeton du projet fonctionne toujours. Une réclamation
révoque ce jeton ; ainsi, dès que quelqu'un a réclamé le projet, `claim` refuse
avec `already_claimed` au lieu d'afficher un lien mort. Il refuse également une fois le
délai expiré (`claim_expired`), et dans un répertoire ne contenant aucun lien de réclamation
(`no_claim_link`). `rebase cloud status` et `rebase cloud whoami` affichent le même
lien tant que le projet n'est pas réclamé.

`projects transfer` déplace un projet vers une autre organisation, sans modification :
même identifiant, adresse, domaines personnalisés, base de données, stockage, variables d'environnement et
déploiements. Seuls le propriétaire, les personnes pouvant le voir et celles qui le financent changent. Vous
devez être propriétaire ou administrateur des deux organisations et être connecté avec `rebase cloud login` ;
un jeton d'accès ne peut pas déplacer un projet. La destination est facturée à partir de ce moment ;
ainsi, une organisation sans carte bancaire enregistrée (et non facturée en interne) refuse le déplacement et
rien ne change. Un projet encore en attente de réclamation est plutôt déplacé via son lien de réclamation.
La console propose la même action sous les paramètres (Settings) du projet, dans la
zone de danger.

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
rebase cloud sleep [status|on|off|wake]  # sleep when idle; `on --after 15m|30m|1h|4h`
rebase cloud status                      # one-glance project status
rebase cloud metrics                     # live CPU / memory / disk, realtime per instance
rebase cloud debug [health|logs|…]       # diagnose a deployment, read-only
```

`deploy` sans nom d'application déploie le backend. Un déploiement de bundle backend
téléverse également les sources du projet — ce que git suit, jamais un `.env` — afin qu'une
mise à niveau de la plateforme puisse le recompiler ; `--no-source` ignore cela une fois, et `cloud settings set
--platform-rebuilds off` l'arrête et supprime la copie stockée. `--allow-downgrade` déploie une version plus ancienne.

Une mise à niveau de la plateforme peut recompiler une application gérée sur une version plus récente de `@rebasepro`
que celle fixée par votre extraction (checkout). Un déploiement depuis cette extraction réinstallerait l'ancien panneau
d'administration et l'ancien pilote ; il est donc refusé avant toute compilation, avec la
commande permettant de corriger le problème (`rebase upgrade --to <version>`). `rebase cloud status`
signale la même chose plus tôt : une ligne `Rebuilt on`, et dans `--json`,
`runtime.platformRebuiltVersion` et `frameworkDrift`.

Un `deploy` suivi se termine par un résumé : chaque application livrée avec son URL, l'ID
de déploiement, le temps que cela a pris, et si la nouvelle version répond à cette adresse. Il
attend jusqu'à `--live-timeout` secondes (60 par défaut ; `0` ignore la vérification) que le `/health`
d'un backend et l'adresse de chaque application statique répondent. Un déploiement échoué
se termine sur une ligne indiquant l'application et la raison, et retourne un code de sortie non nul. Le résumé
s'affiche même en cas de redirection dans un tube ; `--json` (ou `REBASE_JSON=1`) affiche à la place un objet contenant
`apps`, `hosts`, `live`, `liveChecks` et `durationMs`. Un hôte dont le certificat HTTPS
n'a pas encore été délivré est signalé comme non disponible (not live), avec ce motif.

Avant le téléversement, `deploy` analyse le JavaScript de chaque application statique livrée :
les fichiers `.js`/`.mjs`/`.cjs` dans son `output` et les blocs `<script>` intégrés dans
son HTML. Une erreur de syntaxe interrompt le déploiement en indiquant `file:line:column` (code
`syntax_error` sous `--json`), et `--no-verify` ignore cette vérification. Un déploiement
réussi se termine par la commande de retour arrière, `rebase cloud rollback`. Une application statique déployée
seule ne peut pas encore faire l'objet d'un rollback ; consultez
[Retour arrière](/docs/deployment/cloud#roll-back).

`--preview` sert le build à l'adresse `https://<project>--<name>.rebase.website` et
ne touche pas à la production. Une prévisualisation du backend exécute son propre backend, sur
sa propre base de données vide, avec ses applications statiques intégrées. Une application statique ne peut pas
encore être prévisualisée seule sur Rebase Cloud : `rebase cloud deploy <app> --preview`
est refusé avec `PREVIEW_STATIC_UNSERVED` et ne publie rien. Une prévisualisation de backend
est facturée comme une unité applicative supplémentaire à la taille par défaut tant qu'elle existe, et
le déploiement indique ce que cela représente par mois, d'après le devis du plan de contrôle
(`cost` sous `--json` ; uniquement la règle et ce lien si le plan de contrôle ne peut pas en
calculer le prix) ; `rebase cloud previews delete <name>` l'arrête. `rebase cloud previews`
affiche une prévisualisation suspendue par la plateforme (sa base de données a dépassé la limite de prévisualisation) sous l'état
`paused`, avec la raison (`statusMessage` sous `--json`). Une nouvelle adresse de prévisualisation
peut être refusée avec `preview_cert_budget` lorsque le quota hebdomadaire de certificats de
prévisualisation de la plateforme est épuisé ; le message indique jusqu'à quand.
Consultez [Prévisualiser une modification](/docs/deployment/cloud/#preview-a-change).

### Logs

`rebase cloud logs` affiche le journal de compilation le plus récent, et `-f` suit en temps réel un build
encore en cours d'exécution. `--runtime` lit plutôt ce que l'application affiche, depuis chaque pod
associé, chaque ligne précisant son pod lorsque plusieurs ont écrit :

```bash
rebase cloud logs --runtime -f                    # follow until Ctrl-C (exits 0)
rebase cloud logs --runtime --since 15m --grep timeout
rebase cloud logs --runtime -f --level error      # errors only
rebase cloud logs --runtime --previous            # a restarted container's last run
rebase cloud logs --runtime --raw                 # the lines exactly as the pods wrote them
```

- `--since` prend une durée (`30s`, `5m`, `1h`) ou une heure au format RFC3339.
- `--tail <n>` correspond au nombre de lignes par pod à partir duquel commencer (le plan de contrôle le plafonne à 2000).
- `--grep` conserve les lignes contenant le texte, sans distinction de casse ; écrivez `/re/flags` pour une
  expression régulière.
- Avec `--grep` ou `--level`, le filtre recherche dans chaque ligne renvoyée par le plan de contrôle
  pour la période (les 2000 plus récentes de chaque pod), et `--tail` compte les lignes correspondantes :
  les `n` correspondances les plus récentes par pod, 500 par défaut. Lorsqu'un pod a généré plus
  de lignes sur la période, la sortie indique que les plus anciennes n'ont pas été
  analysées (`filter.scanCapped` sous `--json`).
- `--level error|warn|info|debug` conserve les lignes de cette gravité ou pire. Il lit
  le champ structuré `severity` consigné par un backend Rebase, un mot de niveau au début d'une
  ligne de texte brut, ou une structure d'erreur telle que `TypeError:`. Les lignes n'en comportant aucun sont ignorées.
- Une ligne structurée s'affiche de manière lisible : `14:30:32.126 WARN  [boot] Driver version skew …  fix="bump …"`, et une requête sous la forme `GET /api/data/rooms/RCTF 404 16ms  requestId=…`. `--raw` affiche plutôt chaque ligne telle que le pod l'a écrite ; les lignes en texte brut s'affichent sans changement dans les deux cas, et `--json` transporte toujours les lignes d'origine.

Le suivi (`follow`) interroge toutes les deux secondes et affiche chaque ligne une seule fois. Il signale les pods
qui démarrent, s'arrêtent ou redémarrent. Lorsqu'un conteneur redémarre, il affiche également les dernières
lignes de l'instance qui s'est arrêtée, là où se trouve généralement la raison. Il attend tant qu'aucun
pod n'est en cours d'exécution, et après une interruption de connexion, il réessaie avec un intervalle exponentiel (backoff) et
reprend là où il s'était arrêté. Avec `--json`, un suivi affiche un objet JSON par
ligne (NDJSON) : `{"type":"line","ts","pod","text"}` pour chaque ligne de log, et
`{"type":"event","event":…}` pour le reste.

`--preview <name>` lit une prévisualisation au lieu de la production. Utilisez le nom de la
prévisualisation ou l'identifiant de déploiement affiché lors du déploiement de prévisualisation. Utilisé seul, `--preview`
lit l'unique prévisualisation du projet. Une prévisualisation statique a un journal de compilation mais aucun
journal d'exécution (runtime), car elle n'exécute aucun serveur.

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

`domains add` pour un hôte que le projet possède déjà, tel qu'un hôte enregistré par un déploiement
depuis `rebase.json`, affiche les enregistrements DNS et l'état de cet hôte tout comme le ferait un
nouvel ajout ; `--json` ajoute `alreadyRegistered: true`. Un hôte vérifié est servi via HTTPS une fois
son certificat délivré, quelques minutes après la vérification. Jusque-là, l'ingress répond avec un
certificat temporaire, et `domains list`, `domains verify` et `status` indiquent
`verified, certificate pending` plutôt que disponible (live). La CLI s'en assure par
un handshake TLS avec chaque hôte vérifié ; `--json` le signale sous `certificate`
(`ready`, `pending` ou `unreachable`, avec un champ `reason`).

`app-key` liste la
clé que `rebase cloud init --claim` a générée sur l'application et écrite dans `.env` sous
`REBASE_API_TOKEN`, par son préfixe et jamais par sa valeur. La réclamation du projet
transfère cette clé et celle-ci cesse d'expirer. `app-key rotate` en génère une nouvelle et
révoque toutes les clés d'agent antérieures à la fois. La commande écrit la nouvelle clé dans un fichier `.env`
qui définit déjà `REBASE_API_TOKEN`, et l'exclut de `--json` dans ce cas. Dans
tout autre répertoire, elle affiche la clé une seule fois. Les clés créées dans le panneau d'administration
de l'application ne sont pas modifiées. Elle s'exécute avec votre connexion : aucune capacité de jeton ne permet de l'accorder.

`service-key`
affiche la génération de la `REBASE_SERVICE_KEY` du projet, la date de sa dernière
rotation et si l'application est toujours en cours de redémarrage avec la plus récente. Elle ne
renvoie jamais la clé : cela correspond à `env reveal REBASE_SERVICE_KEY`. `service-key rotate`
émet une nouvelle clé et redémarre l'application dessus. L'ancienne clé fonctionne jusqu'à ce que le
redémarrage soit terminé, et plus du tout après. L'opération est refusée pendant qu'un déploiement est en cours
d'exécution, et s'exécute avec votre connexion. La réclamation d'un projet effectue également une rotation de
sa clé de service.

Une prévisualisation de backend possède sa propre clé de service. Son premier déploiement la génère,
les redéploiements la conservent, et la clé de production renvoie un code 401 sur la prévisualisation.
`service-key --preview <name>` l'affiche, tout comme `env reveal
REBASE_SERVICE_KEY --preview <name>`. `service-key rotate --preview <name>`
en écrit une nouvelle et redémarre uniquement le pod de cette prévisualisation ; l'ancienne clé fonctionne jusqu'à
ce que le nouveau pod soit prêt. Elle demande confirmation au préalable, et `--yes` permet de passer la question. Les deux demandent
la même chose que `env reveal` : le rôle de propriétaire ou d'administrateur de l'organisation, et pour un
jeton d'accès, la capacité `env` sur un projet réclamé. La clé et le
pod de production ne sont pas modifiés.

Une prévisualisation de backend démarre à partir des variables de production, clés en direct incluses.
`env set KEY=VALUE --preview` attribue aux prévisualisations leur propre valeur, `env unset KEY
--preview` exclut la variable de celles-ci, `env reset KEY --preview` restitue
la valeur de production, et `env list --preview` affiche les différences.
La production n'est jamais modifiée par aucune de ces commandes.

`env set KEY --stdin` lit la valeur depuis l'entrée standard plutôt que depuis la
ligne de commande, où `ps` et l'historique de votre shell la rendraient visible :

```bash
read -rs STRIPE_KEY   # paste the value; nothing is echoed
printf %s "$STRIPE_KEY" | rebase cloud env set STRIPE_KEY --stdin --secret
```

Un saut de ligne final est supprimé. La fonction `rebase_cloud_env_set` du
serveur MCP définit les valeurs de cette façon.

`env set KEY --prompt` demande la valeur via une invite masquée dans votre terminal.
Rien n'est affiché à l'écran, et la valeur est stockée sous forme de secret, comme avec `--stdin
--secret`. Un agent peut vous fournir la commande à exécuter pour que la valeur ne transite
jamais par le chat. Sans terminal, elle refuse (`input_required`) et renvoie
vers `--stdin`.

## Organisations

```bash
rebase cloud orgs list | create
rebase cloud orgs members [list] | invite <email> [--role admin|member] | remove <email|uid> | role <email|uid> <role>
rebase cloud orgs invites [list] | revoke <id|email> | resend <id|email>
rebase cloud activity [--project <id|slug>] [--action <area|action>] [--actor <email>] [--limit N] [--before <cursor>]
```

`members invite <email>` ajoute une personne disposant déjà d'un compte Rebase avec une
adresse e-mail vérifiée, tout comme le fait « Add member » dans la console. Elle bénéficie d'un accès
immédiat et aucun e-mail n'est envoyé. Rebase Cloud n'envoie pas encore d'invitations, donc une
personne sans compte ne reçoit aucun lien : la commande refuse avec `no_account` et
vous demande de lui faire créer un compte d'abord, puis de réexécuter la commande. Un plan de contrôle qui
gère les invitations en ouvre une à la place et affiche son lien (usage unique, valide 7
jours, accepté uniquement par un compte ayant vérifié cette adresse) ; `invites`
liste, révoque et renvoie ces invitations, et renvoie `not_served` dans les autres cas.
`--role` correspond à `admin` ou `member` (par défaut). Personne n'est ajouté en tant qu'`owner` : ajoutez-les
comme administrateurs, et un propriétaire les promouvra avec `members role <email> owner`.
L'ajout de membres et la commande `invites` nécessitent une session `rebase cloud login` ;
`REBASE_TOKEN` est refusé. Les deux requièrent le rôle de propriétaire ou d'administrateur ; un membre en est
informé.
`members remove` demande confirmation (`--yes` permet de la passer) ; supprimer ou rétrograder un propriétaire
requiert d'être propriétaire, et le dernier propriétaire est conservé. `--org <id>` sélectionne une organisation
autre que celle active.

### Accès aux projets

```bash
rebase cloud access [list]
rebase cloud access invite <email> [--role admin|developer|viewer]
rebase cloud access role <email|uid> <admin|developer|viewer>
rebase cloud access remove <email|uid>
rebase cloud access invites [list] | revoke <id|email> | resend <id|email>
```

`access` gère qui accède à un projet spécifique, le projet lié ou `--project`. Les
propriétaires et administrateurs d'une organisation sont `admin` sur chaque projet qu'elle possède et ses
membres sont `developer` ; `access` permet d'attribuer à quelqu'un un rôle sur ce projet uniquement,
qu'il appartienne ou non à l'organisation. Son rôle effectif est le plus élevé des deux, et
`access` le répertorie avec sa provenance. `admin` donne tous les droits,
accès et paramètres inclus ; `developer` permet de déployer et d'utiliser Studio,
les logs et l'environnement ; `viewer` permet uniquement la lecture.

`invite` génère une invitation au projet (`--role` est défini par défaut sur `developer`)
et affiche son lien : usage unique, valide 7 jours, accepté uniquement par un compte
ayant vérifié cette adresse. `role` et `remove` modifient ou retirent le rôle propre au
projet et demandent confirmation au préalable (`--yes` permet de la passer) ; une personne accédant au
projet par le biais de l'organisation est retirée via `orgs members remove`.
La perte du rôle `admin` sur un projet révoque également le rôle `admin` que **Open admin
panel** attribuait à cette personne au sein de l'application, et met fin à ses sessions. Chaque
modification requiert une session `rebase cloud login` et les droits `admin` sur le projet ; un
plan de contrôle sans gestion des accès aux projets répond `not_served`.

`activity` correspond au journal d'audit de l'organisation sélectionnée, du plus récent au plus ancien : qui
a déployé, effectué un rollback, défini, supprimé ou révélé une variable d'environnement (par son
nom, jamais par sa valeur), modifié un domaine, créé, restauré ou téléchargé une
sauvegarde, modifié les ressources de calcul d'un projet, arrêté ou supprimé un projet, changé le
rôle d'un membre, ou créé ou révoqué un jeton d'accès. `--action` prend un domaine
(`deploy`, `deploy_hook`, `env`, `domain`, `backup`, `pitr`, `database`,
`extension`, `storage`, `project`, `org`, `member`, `invite`, `token`) ou une action complète
telle que `env.set`. Une page contient jusqu'à 100 entrées (`--limit`, 50 par défaut) ; la
sortie affiche le curseur `--before` pour la page suivante. `--json` renvoie une valeur unique,
`{ org, events, nextCursor }`. Cela requiert le rôle de propriétaire ou d'administrateur de l'organisation.
Un jeton ne peut le lire qu'avec la capacité `audit` sur l'organisation
(`rebase cloud tokens create --can audit`). La page **Activity** de la console
affiche le même journal.

## Bases de données

```bash
rebase cloud db list | create | info | connect | test
rebase cloud db query [sql] [--file <path>]
rebase cloud db backup list | create | restore | status | download
rebase cloud db pitr status | restore | cutover | discard
```

`db connect` ouvre un port local qui *est* la base de données gérée (aucun point de
terminaison public) jusqu'à Ctrl-C ; `--reveal` ajoute le mot de passe. Propriétaire ou administrateur uniquement.

`db query` exécute du SQL sur la base de données gérée et affiche le résultat de chaque instruction,
sans `psql` local : il ouvre le même tunnel pour la durée d'une requête. Un fichier comportant plusieurs
instructions s'exécute comme un seul script et s'arrête à la première erreur ; aucune transaction n'étant
ajoutée automatiquement, encapsulez le fichier dans `BEGIN`/`COMMIT` pour le rendre atomique
(tout ou rien). `COPY … FROM STDIN` est refusé. Propriétaire ou administrateur uniquement. Avec
`--json`, la commande affiche `{ projectId, results: [{ command, rowCount, rows }] }`.

`db connect`, `db query` et `db backup` acceptent `--database <key>` pour l'une des
[autres bases de données](/docs/backend/multiple-sources/) du projet, la `clé`
d'une déclaration `database("<key>")`. Sans cela, elles agissent sur la base par défaut.

## Invités

Chaque appel à `signInAnonymously()` lors d'un test, par un bot ou lors d'une visite abandonnée laisse une ligne
dans les utilisateurs du projet. Ces commandes comptent ces lignes et les suppriment, évitant ainsi
d'avoir à les parcourir une par une manuellement.

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
ligne ; la commande ne peut donc pas toucher un compte standard, même si celui-ci s'est inscrit un instant
après avoir été listé. `delete` refuse un compte avec l'erreur `NOT_ANONYMOUS`.

**Dernière activité** (**Last seen**) correspond au moment où la session de l'invité a été émise ou actualisée pour la dernière fois, ou
à la date de création de l'invité s'il ne dispose plus de jeton d'actualisation. Un invité qui revient
régulièrement n'est pas considéré comme ancien, peu importe la date de sa création. Les jetons d'actualisation d'un invité
supprimé ainsi que toute autre ligne d'authentification associée sont supprimés avec lui.

Les lignes dans vos propres tables suivent leur clé étrangère :

| La colonne | Ce qui arrive à la ligne |
|---|---|
| Lien optionnel (`ON DELETE SET NULL`, par défaut) | Conservée, avec le lien vidé |
| Lien requis (`ON DELETE RESTRICT`, par défaut) | Conservée, et l'invité avec elle : l'invité est signalé comme ignoré, avec `GUEST_REFERENCED` |
| `onDelete: "cascade"` | Supprimée avec l'invité |
| Aucune clé étrangère (un champ `userSelect`, un simple identifiant) | Conservée, contenant un identifiant qui n'existe plus |

Vérifiez lesquels de vos liens sont en cascade avant de passer `--yes` : l'opération est irréversible.

La commande passe par le proxy Studio de la console, qui détient la clé de l'application, de sorte que la clé n'arrive jamais sur votre
machine. Elle nécessite d'être propriétaire ou administrateur de l'organisation, sur un projet dont l'accès Studio est activé
(`rebase cloud settings set --studio on`). Un projet utilisant un runtime plus ancien est averti qu'il doit être mis à niveau.
`rebase users guests --project <slug>` est la commande équivalente dans la famille de commandes de projet.

## Ressources

Ce que la plateforme conserve pour le projet, par rapport à ce que son code déclare.

```bash
rebase cloud resources                       # each database and bucket: declared? provisioned?
rebase cloud resources prune database <key>  # remove one the code no longer declares
```

Un déploiement ne supprime jamais une base de données provisionnée lorsque sa déclaration disparaît — cela
reviendrait à supprimer des données via un simple push. Il la conserve, la lie et la facture jusqu'à ce que quelqu'un
la nettoie explicitement par son nom.

## Calcul

Ce que le projet réserve et ce que cela coûte.

```bash
rebase cloud compute            # the current reservation and its monthly cost
rebase cloud compute set        # change it
```

`compute set` prend en charge `--cpu`, `--memory`, `--replicas`, `--spot`,
`--db-instances`, `--db-cpu`, `--db-memory`,
`--storage`, `--autoscale-max`, `--autoscale-cpu-target` et `--no-autoscale`.
`--scale-to-zero` est obsolète : chaque backend exécute au moins une instance, donc
`true` est refusé et `false` est ignoré avec un avertissement. Il n'y a pas de
niveaux d'abonnements : tout est tarifié à la ressource. Consultez
[Rebase Cloud](/docs/deployment/cloud/).

## Stockage, notifications, clusters, facturation et utilisation

```bash
rebase cloud storage             # list storage buckets
rebase cloud storage create      # provision platform-managed storage
rebase cloud storage attach      # attach your own S3-compatible bucket
rebase cloud notifications [list] | add <url> | test <id> | remove <id>   # deploy, backup, billing and usage events to Slack, Discord or any URL
rebase cloud clusters list | add | verify | registry | open | close   # the clusters tenants run on; `add` registers one from a kubeconfig
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
uniquement `{ "text" }` au lieu du JSON d'événement complet, qui comporte également un champ `text`. L'URL
est un argument positionnel car `--url` désigne le plan de contrôle. `add` affiche
le secret de signature une seule fois ; `--json` renvoie `{ projectId, webhook, secret }`.
`test <id>` quitte avec le code 1 et l'erreur `delivery_failed` lorsque le récepteur n'a pas accepté
l'événement de test. Le listage est ouvert à tout membre de l'organisation ; `add`, `test`
et `remove` requièrent le rôle de propriétaire ou d'administrateur. Un jeton les gère via la
capacité `notifications` sur l'organisation, selon la même règle de rôles. Consultez
[Notifications Cloud](/docs/deployment/cloud-notifications/).

`clusters registry <cluster-id> --repository <host/project/repo> --push-service-account <email> --pull-key-file <key.json>` attribue au cluster d'un
client son propre registre d'images, utilisé uniquement pour ce cluster. Sans
cela, un tel cluster utilise le registre partagé de la plateforme, et chaque déploiement sur celui-ci
l'indique dans ses logs. Avec ce paramètre, les builds sont poussés vers ce dépôt avec un jeton pour
ce compte, les pods effectuent des pulls avec cette clé uniquement, et un rollback accepte les
images du projet présentes à cet endroit. Les images
que le projet a précédemment compilées dans le registre partagé restent récupérables et restent
utilisables comme cibles de retour arrière. Les trois valeurs fonctionnent ensemble ; `--clear` les efface. La clé
est scellée lors de son écriture et n'est jamais relue. Comme le reste des commandes `clusters`,
elle nécessite le rôle d'administrateur de la plateforme (platform-admin). L'opérateur crée le dépôt et les deux
comptes avec Terraform (`saas/infra/gcp/registry-linked-clusters.tf`).

`clusters add --platform-capacity` enregistre de la capacité opérée par Rebase : les projets
placés dans sa région s'y déploient dès que sa configuration de base (baseline) est prête. Cela ne propose pas
la région aux clients. `--open-to-customers` le fait, dès l'enregistrement, ou plus tard avec
`clusters open <id-or-name>` ; `clusters close <id-or-name>` cesse de la proposer.
Les opérateurs peuvent déployer sur un cluster fermé. Laissez un cluster fermé tant que son
domaine de base est partagé avec un autre cluster : jusqu'à ce que l'enregistrement générique (wildcard) soit déplacé, ses
noms d'hôtes ne sont résolus que par des enregistrements explicites (`ingress.<baseDomain>`,
`s3.<baseDomain>` et un par projet), et `clusters add` indique quels enregistrements
ajouter. Lorsque le domaine est partagé, `open` avertit que l'enregistrement générique doit
déjà pointer vers le cluster. Il ne pose pas de question de confirmation, ce qui lui permet de fonctionner depuis un script.

`billing invoices` et `billing upcoming` lisent les mêmes données Stripe que la
page Facturation (Billing) de la console, et ne sont accessibles qu'aux propriétaires et administrateurs
de l'organisation. Un jeton peut y accéder, ainsi qu'au reste de `billing`, avec la capacité
`billing` sur l'organisation ; un jeton créé avant l'introduction de cette capacité continue de
fonctionner pendant une version, avec un avertissement sur chaque réponse. Les montants dans `--json` sont exprimés dans la plus petite unité de la devise (centimes), exactement tels que
Stripe les envoie. Les factures à l'état de brouillon ne sont pas listées ; l'aperçu est calculé par
Stripe et ses lignes à l'usage continuent d'augmenter jusqu'à la clôture de la période.

`usage` lit ce que le projet lié (ou `--project`) a consommé au cours d'un mois
civil, en UTC : les requêtes par rapport au quota inclus, les erreurs 5xx, le dépassement
actuel en euros et, pour le mois en cours, la projection à ce
rythme (une estimation). Le dépassement correspond au calcul propre du rapport de dépassement,
celui qui indique à Stripe ce qu'il faut facturer, et apparaît sur la facture du mois suivant.
`usage org` liste tous les projets de l'organisation sélectionnée avec `rebase cloud
use`, ainsi que le total. Tout membre de l'organisation peut le lire. Un jeton le lit
avec la capacité `logs` sur le projet ; `usage org` liste les projets pour lesquels le
jeton détient cette capacité.
`--month` prend un mois passé. La réponse comporte des `caveats` (avertissements), chacun associé à un `code` : `storage_not_measured`
(le stockage d'objets indique 0), `multi_pod_undercount` (les requêtes traitées pendant que deux
pods d'application ou plus s'exécutent ne sont pas comptabilisées), `partial_days`, `metering_off`,
`overage_billing_off`, `not_billed`, `billed_next_month`, `pre_claim_days` (un
projet réclamé auprès d'un agent ne comptabilise que les jours à partir de la réclamation) et
`autoscale_not_charged` (des pods ont fonctionné au-delà de `--replicas` et cette plateforme ne les
facture pas encore). La réponse d'un projet avec mise à l'échelle automatique (autoscale) comporte également `autoscale` :
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

`domains redirect` s'applique par domaine et est désactivé par défaut, de sorte qu'un projet servant un hôte `api.` à côté de son site conserve les deux ; la redirection prend effet lorsque le domaine est vérifié et qu'un autre domaine est défini comme principal, et ne s'applique jamais à un domaine sur lequel une application est servie. `deploy-hooks create` affiche l'URL du hook une seule fois. `deploy --git` ne peut pas être combiné avec les options d'un build local, et sur le runtime géré, il nécessite `--eject` car le plan de contrôle compile à partir des sources. `settings set --studio` est le commutateur que les commandes de projet (`rebase data`, `rebase users`, …) doivent avoir activé pour `--project` : elles accèdent à l'application via le proxy Studio de la console. Une commande dont la route sur le plan de contrôle n'est pas encore déployée répond `not_served` et la nomme. Les commandes destructives demandent confirmation au préalable et échouent avec `confirmation_required` lorsque personne ne peut répondre : utilisez `--yes`.
