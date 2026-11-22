---
sourceHash: 5e278801233fce19
title: rebase cloud
sidebar_label: rebase cloud
description: Les groupes de commandes pour Rebase Cloud dans la CLI — auth, liaison de projet, déploiements, notifications, configuration, organisations, bases de données, ressources, calcul, stockage, clusters, facturation et utilisation.
---

Tout ce qui concerne Rebase Cloud, actuellement en version bêta privée. Consultez le
[guide Rebase Cloud](/docs/deployment/cloud/) pour savoir de quoi il s'agit et ce que la version bêta
n'inclut pas.

Chaque groupe répond à `--help`, et `--help` n'exécute jamais la commande. La plupart des commandes
agissent sur le projet lié dans `.rebase/cloud.json` ; `--project <id>` opère sur
un projet sans liaison.

Trois options s'appliquent partout : `--json` pour une sortie lisible par une machine (également la
valeur par défaut lorsqu'un pipe est utilisé, sauf pour `deploy`, ou avec `REBASE_JSON=1`), `--url <origin>` pour cibler un
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
`logs` couvre également `usage`. Ce à quoi chacun donne accès est détaillé dans
[CI and agents](/docs/deployment/cloud-agents/#ci-and-agents). Lorsque le plan de contrôle
marque une réponse à un jeton comme dépréciée (un jeton antérieur à `billing`
lisant la facturation), la CLI affiche l'avertissement une fois sur stderr, jamais dans la
valeur `--json`.

Sans option, `login` se connecte via le navigateur. La commande affiche un code court et
un lien vers la console, ouvre le navigateur et attend que vous approuviez la
connexion. Vous êtes déjà connecté à la console, ou vous vous connectez avec
l'une des méthodes proposées (mot de passe, Google, GitHub, LinkedIn). Vérifiez que le
navigateur affiche le même code avant de l'approuver. Le lien expire au bout de dix
minutes et n'est utilisable qu'une seule fois. Sans terminal, ou avec `--json`, le lien et le code
sont envoyés sur stderr et `login` continue d'attendre, afin qu'un agent puisse vous transmettre le lien. Une
connexion refusée se termine avec le code `access_denied`, une connexion expirée avec `expired_token`.

Avec `--email`, `login` demande s'il faut utiliser votre mot de passe ou un code que le plan de
contrôle vous envoie par e-mail. Si l'authentification à deux facteurs est activée, la commande demande ensuite votre
code d'authentification (ou un code de récupération) ; via le navigateur, approuvez la demande depuis une
session de console l'ayant utilisé. Sans terminal, aucun code ne peut être saisi : définissez
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
ce dernier cas, elles indiquent celle qu'elles ont utilisée. `orgs delete` ne la déduit jamais de
la liaison : elle nécessite `--org` ou une organisation sélectionnée.

### Connecter une instance auto-hébergée à Claude

```bash
rebase cloud connect https://your-app.com      # add it to your account; prints two variables, waits until it answers
rebase cloud connect --list                    # the instances you added, and whether each is connected
rebase cloud connect --remove https://your-app.com
```

Le [connecteur Rebase](/docs/ai/rebase-connector/) (`https://app.rebase.pro/mcp`)
y a alors accès aux côtés de vos projets Cloud. `connect` affiche
`REBASE_PLATFORM_TOKEN_KEY` et `REBASE_PLATFORM_TOKEN_AUDIENCE` ; définissez-les sur
le serveur et redémarrez-le. Dans le dossier du projet, la commande propose de les écrire dans
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
rebase cloud projects transfer [id] --to-org <id|slug>
rebase cloud projects delete [id]
```

`claim` affiche le lien de réclamation du projet que `init --claim` a provisionné dans ce
répertoire, ainsi que le temps restant avant sa suppression s'il n'est pas réclamé (`Unclaimed: deleted
in 41h`). `--open` l'ouvre également dans un navigateur. Le lien n'est conservé que sur la
machine qui a exécuté `init --claim`, dans `~/.rebase/credentials.json` ; le plan de contrôle
en stocke un hash et ne peut pas l'afficher à nouveau. Avant de répondre, `claim`
demande au plan de contrôle si le jeton propre au projet fonctionne toujours. Une réclamation
révoque ce jeton, de sorte qu'une fois que quelqu'un a réclamé le projet, `claim` refuse
avec `already_claimed` au lieu d'afficher un lien mort. La commande refuse également lorsque le
délai est écoulé (`claim_expired`), et dans un répertoire sans lien de réclamation
(`no_claim_link`). `rebase cloud status` et `rebase cloud whoami` affichent le même
lien tant que le projet n'est pas réclamé.

`projects transfer` déplace un projet vers une autre organisation, sans modification : le
même identifiant, adresse, domaines personnalisés, base de données, stockage, variables d'environnement et
déploiements. Seuls le propriétaire, les personnes pouvant le voir et celles qui le paient changent. Vous
devez être propriétaire ou administrateur des deux organisations et connecté avec `rebase cloud login` ;
un jeton d'accès ne peut pas déplacer un projet. La destination est facturée à partir de ce moment-là,
de sorte qu'une organisation sans carte enregistrée (et non facturée en interne) refuse le transfert et
rien ne change. Un projet encore en attente de réclamation est déplacé via son lien de réclamation. La
console propose la même action sous les paramètres (Settings) du projet, dans la
zone de danger.

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

`deploy` sans nom d'application déploie le backend. Un déploiement de bundle
backend téléverse également le code source du projet — ce que git suit, jamais un `.env` — afin qu'une
mise à niveau de la plateforme puisse le recompiler ; `--no-source` ignore cela une fois, et `cloud settings set
--platform-rebuilds off` désactive cette fonctionnalité et supprime la copie stockée. `--allow-downgrade` déploie une version antérieure.

Une mise à niveau de la plateforme peut recompiler une application gérée sur une version de `@rebasepro` plus
récente que celle fixée dans votre copie de travail. Un déploiement depuis cette copie réinstallerait l'ancien panneau
d'administration et l'ancien pilote ; il est donc refusé avant toute compilation, avec la
commande permettant de corriger la situation (`rebase upgrade --to <version>`). `rebase cloud status`
signale cela plus tôt : une ligne `Rebuilt on`, et dans `--json`,
`runtime.platformRebuiltVersion` et `frameworkDrift`.

Un `deploy` suivi se termine par un récapitulatif : chaque application déployée avec son URL,
l'identifiant du déploiement, la durée nécessaire et si la nouvelle version y répond. La commande
attend jusqu'à `--live-timeout` secondes (60 par défaut ; `0` ignore la vérification) que le
`/health` du backend et l'adresse de chaque application statique répondent. Un déploiement échoué
se termine sur une ligne indiquant l'application et la raison, avec un code de sortie non nul. Le récapitulatif
s'affiche même en cas de redirection (pipe) ; `--json` (ou `REBASE_JSON=1`) affiche un objet à la place,
avec `apps`, `hosts`, `live`, `liveChecks` et `durationMs`. Un hôte dont le certificat HTTPS
n'est pas encore émis est signalé comme non opérationnel (not live), avec cette raison.

Avant le téléversement, `deploy` analyse le JavaScript de chaque application statique qu'il déploie :
les fichiers `.js`/`.mjs`/`.cjs` dans son répertoire `output` et les blocs `<script>` inline dans
son HTML. Une erreur de syntaxe interrompt le déploiement en indiquant `file:line:column` (code
`syntax_error` avec `--json`), et `--no-verify` ignore cette vérification. Un déploiement
réussi se termine en indiquant comment revenir en arrière, `rebase cloud rollback`. Une application statique déployée
seule ne peut pas encore faire l'objet d'un retour arrière ; consultez
[Roll back](/docs/deployment/cloud#roll-back).

`--preview` sert le build à l'adresse `https://<project>--<name>.rebase.website` et
ne touche pas à la production. Une prévisualisation du backend exécute son propre backend, sur
sa propre base de données vide, avec ses applications statiques intégrées. Une application statique ne peut pas
encore être prévisualisée seule sur Rebase Cloud : `rebase cloud deploy <app> --preview`
est refusé avec `PREVIEW_STATIC_UNSERVED` et ne publie rien. Une prévisualisation de backend
est facturée comme une unité d'application supplémentaire à la taille par défaut pendant toute sa durée d'existence, et
le déploiement indique ce que cela représente par mois d'après l'estimation du plan de contrôle
(`cost` sous `--json` ; seulement la règle et ce lien lorsque le plan de contrôle ne peut pas
en calculer le prix) ; `rebase cloud previews delete <name>` l'arrête. `rebase cloud previews`
affiche une prévisualisation mise en pause par la plateforme (sa base de données ayant dépassé la limite de prévisualisation) sous
l'état `paused`, avec la raison (`statusMessage` sous `--json`). Une nouvelle adresse de prévisualisation
peut être refusée avec `preview_cert_budget` lorsque le quota hebdomadaire de certificats de
prévisualisation de la plateforme est épuisé ; le message précise jusqu'à quand.
Consultez [Prévisualiser une modification](/docs/deployment/cloud/#preview-a-change).

### Logs

`rebase cloud logs` affiche le journal du dernier build, et `-f` suit en direct un build encore
en cours d'exécution. `--runtime` lit plutôt ce que l'application affiche, depuis chaque pod
associé, chaque ligne étant étiquetée avec son pod :

```bash
rebase cloud logs --runtime -f                    # follow until Ctrl-C (exits 0)
rebase cloud logs --runtime --since 15m --grep timeout
rebase cloud logs --runtime -f --level error      # errors only
rebase cloud logs --runtime --previous            # a restarted container's last run
```

- `--since` accepte une durée (`30s`, `5m`, `1h`) ou un horodatage au format RFC3339.
- `--tail <n>` correspond au nombre de lignes par pod à partir duquel commencer (le plan de contrôle le plafonne à 2000).
- `--grep` conserve les lignes contenant le texte, sans tenir compte de la casse ; écrivez `/re/flags` pour une
  expression régulière.
- Avec `--grep` ou `--level`, le filtre recherche dans toutes les lignes renvoyées par le plan de contrôle
  pour la fenêtre considérée (les 2000 plus récentes de chaque pod), et `--tail` compte les lignes correspondantes :
  les `n` correspondances les plus récentes par pod, 500 par défaut. Lorsqu'un pod a généré plus de
  lignes que cette limite dans la fenêtre, la sortie indique que les plus anciennes n'ont pas
  été analysées (`filter.scanCapped` sous `--json`).
- `--level error|warn|info|debug` conserve les lignes correspondant à ce niveau de gravité ou supérieur. L'option lit
  la `severity` structurée qu'un backend Rebase enregistre, un mot de niveau au début d'une
  ligne brute, ou un motif d'erreur tel que `TypeError:`. Les lignes qui n'en comportent aucun sont ignorées.

Le suivi (`follow`) interroge toutes les deux secondes et affiche chaque ligne une seule fois. Il signale les pods
qui démarrent, s'arrêtent ou redémarrent. Lorsqu'un conteneur redémarre, il affiche également les dernières
lignes de l'instance qui s'est arrêtée, là où se trouve généralement la cause. Il attend lorsqu'aucun
pod n'est en cours d'exécution, et après une déconnexion, il réessaie avec un recul exponentiel (backoff) et
reprend là où il s'était arrêté. Avec `--json`, le suivi affiche un objet JSON par
ligne (NDJSON) : `{"type":"line","ts","pod","text"}` pour chaque ligne de log, et
`{"type":"event","event":…}` pour le reste.

`--preview <name>` lit les logs d'une prévisualisation au lieu de la production. Utilisez le nom de la prévisualisation
ou l'identifiant de déploiement affiché lors du déploiement de la prévisualisation. Utilisé seul, `--preview`
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
rebase cloud service-key [rotate] --preview <name>  # a backend preview's own key
```

`domains add` pour un hôte dont le projet dispose déjà, comme un hôte enregistré
par un déploiement depuis `rebase.json`, affiche les enregistrements DNS et l'état de cet hôte tout
comme le ferait un nouvel ajout ; `--json` ajoute `alreadyRegistered: true`. Un hôte vérifié est
servi en HTTPS dès que son certificat est émis, quelques minutes après
la vérification. D'ici là, l'ingress répond avec un certificat temporaire,
et `domains list`, `domains verify` ainsi que `status` indiquent
`verified, certificate pending` au lieu de live. La CLI le détecte grâce à
un handshake TLS effectué vers chaque hôte vérifié ; `--json` transmet cette information sous le champ `certificate`
(`ready`, `pending` ou `unreachable`, avec un champ `reason`).

`app-key` liste la
clé que `rebase cloud init --claim` a générée sur l'application et écrite dans `.env` sous le nom
`REBASE_API_TOKEN`, par son préfixe et jamais par sa valeur. Réclamer le projet
transfère cette clé et celle-ci cesse d'expirer. `app-key rotate` en génère une nouvelle et
révoque toutes les clés d'agent antérieures d'un coup. La commande écrit la nouvelle clé dans un fichier `.env`
qui définit déjà `REBASE_API_TOKEN`, et l'exclut alors de la sortie `--json`. Dans
tout autre répertoire, elle affiche la clé une seule fois. Les clés créées dans le panneau d'administration de l'application
ne sont pas modifiées. Cette commande s'exécute avec votre connexion : aucune capacité de jeton ne permet de l'accorder.

`service-key`
affiche la génération de la clé `REBASE_SERVICE_KEY` du projet, la date de sa dernière
rotation, et si l'application est encore en cours de redémarrage sur la nouvelle clé. Elle n'affiche
jamais la clé elle-même : pour cela, utilisez `env reveal REBASE_SERVICE_KEY`. `service-key rotate`
émet une nouvelle clé et redémarre l'application dessus. L'ancienne clé fonctionne jusqu'à ce que le
redémarrage soit terminé, et plus du tout ensuite. La commande est refusée pendant qu'un déploiement est
en cours, et s'exécute avec votre connexion. Réclamer un projet effectue également la rotation de sa clé de
service.

Une prévisualisation de backend possède sa propre clé de service. Son premier déploiement la crée,
les redéploiements la conservent, et la clé de production renvoie une erreur 401 sur la prévisualisation.
`service-key --preview <name>` l'affiche, tout comme `env reveal
REBASE_SERVICE_KEY --preview <name>`. `service-key rotate --preview <name>`
en génère une nouvelle et redémarre uniquement le pod de cette prévisualisation ; l'ancienne clé reste valide jusqu'à
ce que le nouveau pod soit prêt. La commande demande confirmation au préalable, et `--yes` permet d'ignorer la confirmation. Les deux
exigent les mêmes autorisations que `env reveal` : le rôle de propriétaire ou d'administrateur de l'organisation, et pour un
jeton d'accès, la capacité `env` sur un projet réclamé. La clé et le
pod de production ne sont pas modifiés.

Une prévisualisation de backend démarre avec les variables de production, clés de production incluses.
`env set KEY=VALUE --preview` attribue aux prévisualisations leur propre valeur, `env unset KEY
--preview` omet la variable de celles-ci, `env reset KEY --preview` rétablit
la valeur de production, et `env list --preview` montre les différences.
Aucune de ces actions ne modifie la production.

`env set KEY --stdin` lit la valeur depuis l'entrée standard plutôt que depuis la
ligne de commande, où `ps` et l'historique de votre shell la rendraient visible :

```bash
read -rs STRIPE_KEY   # paste the value; nothing is echoed
printf %s "$STRIPE_KEY" | rebase cloud env set STRIPE_KEY --stdin --secret
```

Le saut de ligne final éventuel est supprimé. La fonction `rebase_cloud_env_set` du
serveur MCP définit les valeurs de cette manière.

`env set KEY --prompt` demande la valeur via une invite masquée dans votre terminal.
Rien n'est affiché à l'écran, et la valeur est stockée en tant que secret, comme avec `--stdin
--secret`. Un agent peut vous fournir la commande à exécuter, évitant ainsi que la valeur ne transite
par le chat. Sans terminal, la commande est refusée (`input_required`) et renvoie
vers `--stdin`.

## Organisations

```bash
rebase cloud orgs list | create
rebase cloud orgs members [list] | invite <email> [--role admin|member] | remove <email|uid> | role <email|uid> <role>
rebase cloud orgs invites [list] | revoke <id|email> | resend <id|email>
rebase cloud activity [--project <id|slug>] [--action <area|action>] [--actor <email>] [--limit N] [--before <cursor>]
```

`members invite <email>` ajoute une personne disposant déjà d'un compte Rebase avec une
adresse e-mail vérifiée, tout comme l'action Ajouter un membre (Add member) de la console. Elle obtient immédiatement
l'accès et aucun e-mail n'est envoyé. Rebase Cloud n'envoie pas encore d'invitations ; ainsi, une
personne sans compte ne reçoit aucun lien : la commande refuse l'opération avec `no_account` et
vous demande de l'inviter à s'inscrire d'abord, puis de réexécuter la commande. Un plan de contrôle prenant en
charge les invitations en crée une à la place et affiche son lien (usage unique, valide 7
jours, accepté uniquement par un compte ayant vérifié cette adresse) ; `invites`
liste, révoque et renvoie ces invitations, et renvoie `not_served` dans les autres cas.
`--role` peut être `admin` ou `member` (par défaut). Personne ne peut être ajouté en tant que `owner` : ajoutez la
personne comme administrateur, et un propriétaire la promeut avec `members role <email> owner`.
L'ajout de membres et `invites` nécessitent une session `rebase cloud login` ;
`REBASE_TOKEN` est refusé. Les deux requièrent le rôle de propriétaire ou d'administrateur ; un membre en est
informé par un message d'erreur.
`members remove` demande confirmation au préalable (`--yes` permet de l'ignorer) ; supprimer ou rétrograder un propriétaire
requiert d'être propriétaire, et le dernier propriétaire ne peut être supprimé. `--org <id>` permet de sélectionner une organisation
autre que celle actuellement choisie.

`activity` est le journal d'audit de l'organisation sélectionnée, du plus récent au plus ancien : qui a
déployé, effectué un rollback, défini, supprimé ou révélé une variable d'environnement (par
nom, jamais par valeur), modifié un domaine, créé, restauré ou téléchargé une
sauvegarde, modifié les ressources de calcul d'un projet, arrêté ou supprimé un projet, modifié le
rôle d'un membre, ou créé ou révoqué un jeton d'accès. `--action` accepte un domaine
(`deploy`, `deploy_hook`, `env`, `domain`, `backup`, `pitr`, `database`,
`extension`, `storage`, `project`, `org`, `member`, `invite`, `token`) ou une action complète
comme `env.set`. Une page contient jusqu'à 100 entrées (`--limit`, 50 par défaut) ; la
sortie affiche le curseur `--before` pour la page suivante. `--json` renvoie une valeur unique,
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

`db connect` ouvre un port local qui *est* la base de données gérée (aucun
point de terminaison public) jusqu'à Ctrl-C ; `--reveal` affiche le mot de passe. Réservé aux propriétaires ou administrateurs.

## Invités

Chaque appel à `signInAnonymously()` lors d'un test, par un robot ou lors d'une visite abandonnée laisse une ligne
dans les utilisateurs du projet. Ces commandes comptent ces lignes et les suppriment, évitant
d'avoir à les parcourir une par une manuellement.

```bash
rebase cloud guests                              # how many, and the ones last seen longest ago
rebase cloud guests --older-than 30d --limit 100 # the ones not seen for 30 days
rebase cloud guests delete <id>                  # one guest; asks first
rebase cloud guests prune --older-than 30d       # dry run: how many would go
rebase cloud guests prune --older-than 30d --yes # deletes them
```

`prune` accepte un âge accompagné d'une unité : `45m`, `12h`, `30d` ou `2w`. Sans `--yes`, la
commande compte les enregistrements sans rien supprimer. Elle traite les projets de toute taille par petits
lots.

Seuls les invités peuvent être supprimés. Un invité est une ligne avec `is_anonymous` défini, sans mot de passe et sans
identité liée ; l'application applique cette règle directement dans l'instruction qui supprime la
ligne, de sorte que la commande ne peut pas toucher à un compte réel, même créé un instant
après avoir été listé. `delete` refuse un compte avec l'erreur `NOT_ANONYMOUS`.

**Last seen** (dernière activité) correspond au moment où la session de l'invité a été émise ou rafraîchie pour la dernière fois, ou à
la date de création de l'invité s'il ne possède plus de jeton de rafraîchissement. Un invité qui revient régulièrement
n'est pas considéré comme ancien, quelle que soit sa date de création. La suppression d'un invité entraîne celle de ses jetons de rafraîchissement
et de toutes ses autres lignes d'authentification.

Les lignes de vos propres tables suivent leur clé étrangère :

| La colonne | Ce qui arrive à la ligne |
|---|---|
| Liaison optionnelle (`ON DELETE SET NULL`, par défaut) | Conservée, avec la liaison vidée |
| Liaison requise (`ON DELETE RESTRICT`, par défaut) | Conservée, et l'invité avec elle : l'invité est signalé comme ignoré, avec `GUEST_REFERENCED` |
| `onDelete: "cascade"` | Supprimée avec l'invité |
| Pas de clé étrangère (un champ `userSelect`, un simple identifiant) | Conservée, contenant un identifiant qui n'existe plus |

Vérifiez quelles liaisons sont en cascade avant de passer `--yes` : cette action est irréversible.

La commande passe par le proxy Studio de la console, qui détient la clé de l'application, afin que celle-ci n'atteigne jamais votre
machine. Elle nécessite d'être propriétaire ou administrateur de l'organisation, sur un projet dont l'accès Studio est activé
(`rebase cloud settings set --studio on`). Un projet utilisant un runtime plus ancien est informé qu'il doit utiliser une version plus récente.
`rebase users guests --project <slug>` est la même commande dans la famille des commandes de projet.

## Ressources

Ce que la plateforme détient pour le projet, par rapport à ce que son code déclare.

```bash
rebase cloud resources                       # each database and bucket: declared? provisioned?
rebase cloud resources prune database <key>  # remove one the code no longer declares
```

Un déploiement ne supprime jamais une base de données provisionnée lorsque sa déclaration disparaît — cela
reviendrait à supprimer des données lors d'un push. Il la conserve, la lie et la facture jusqu'à ce que quelqu'un
la nettoie explicitement par son nom.

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
`true` est refusé et `false` est ignoré avec un avertissement. Il n'existe pas de paliers
d'abonnement : chaque ressource est facturée à l'usage. Consultez
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
prend une liste séparée par des virgules de `deploy.failed` (par défaut),
`deploy.succeeded`, `deploy.rolled_back`, `backup.unhealthy`,
`billing.payment_failed`, `usage.threshold` et `preview.paused`. `--format slack` envoie
uniquement `{ "text" }` au lieu du JSON complet de l'événement, qui contient également un champ `text`. L'URL
est un argument positionnel car `--url` sert à désigner le plan de contrôle. `add` affiche
le secret de signature une seule fois ; `--json` renvoie `{ projectId, webhook, secret }`.
`test <id>` quitte avec le code 1 et l'erreur `delivery_failed` lorsque le récepteur n'a pas accepté
l'événement de test. Le listage est accessible à tout membre de l'organisation ; `add`, `test`
et `remove` nécessitent le rôle de propriétaire ou d'administrateur. Un jeton les gère avec la
capacité `notifications` sur l'organisation, selon la même règle de rôle. Consultez
[Cloud notifications](/docs/deployment/cloud-notifications/).

`clusters registry <cluster-id> --repository <host/project/repo>
--push-service-account <email> --pull-key-file <key.json>` attribue au propre
cluster d'un client un registre d'images dédié, utilisé pour ce seul cluster. Sans
cela, un tel cluster utilise le registre partagé de la plateforme, et chaque déploiement sur celui-ci
le signale dans ses journaux. Avec un registre dédié, les builds poussent vers ce dépôt avec un jeton pour
ce compte, les pods effectuent leurs pulls avec cette seule clé, et un rollback accepte les
images du projet présentes sur ce registre. Les images
précédemment compilées par le projet dans le registre partagé restent récupérables et utilisables
pour des rollbacks. Les trois valeurs fonctionnent ensemble ; `--clear` les efface. La clé
est scellée dès son écriture et n'est jamais relue. Comme pour le reste de `clusters`,
cette opération requiert le rôle d'administrateur de la plateforme (platform-admin). L'opérateur crée le dépôt et les deux
comptes à l'aide de Terraform (`saas/infra/gcp/registry-linked-clusters.tf`).

`clusters add --platform-capacity` enregistre une capacité exploitée par Rebase : les projets
assignés à sa région s'y déploient dès que sa configuration de base est prête. Cette commande ne propose pas
la région aux clients. `--open-to-customers` permet de la proposer, dès l'enregistrement ou ultérieurement
avec `clusters open <id-or-name>` ; `clusters close <id-or-name>` cesse de la proposer.
Les opérateurs peuvent déployer sur un cluster fermé. Laissez un cluster fermé tant que son
domaine de base est partagé avec un autre cluster : jusqu'à ce que l'enregistrement wildcard soit déplacé, ses
noms d'hôtes ne sont résolus qu'au moyen d'enregistrements explicites (`ingress.<baseDomain>`,
`s3.<baseDomain>` et un par projet), et `clusters add` affiche les enregistrements
à ajouter. Lorsque le domaine est partagé, `open` avertit que l'enregistrement wildcard doit
déjà pointer vers le cluster. La commande ne demande pas de confirmation, ce qui lui permet de fonctionner dans un script.

`billing invoices` et `billing upcoming` lisent les mêmes données Stripe que la
page Billing de la console, et sont accessibles uniquement aux propriétaires et administrateurs
de l'organisation. Un jeton y a accès, ainsi qu'au reste de `billing`, grâce à la capacité `billing`
sur l'organisation ; un jeton créé avant l'introduction de cette capacité continue de
fonctionner pendant une version, avec un avertissement à chaque réponse. Les montants dans `--json` sont exprimés dans la plus petite unité de la devise (centimes), exactement tels que
Stripe les envoie. Les factures à l'état de brouillon ne sont pas listées ; la prévisualisation est calculée par
Stripe et ses lignes à l'usage continuent d'augmenter jusqu'à la clôture de la période.

`usage` lit les consommations du projet lié (ou de `--project`) au cours d'un mois
civil, en UTC : les requêtes par rapport au forfait inclus, les erreurs 5xx, le dépassement
actuel en euros et, pour le mois en cours, l'estimation à ce
rythme. Le dépassement correspond au calcul propre du rapport de dépassement, celui
qui indique à Stripe quoi facturer, et qui apparaît sur la facture du mois suivant.
`usage org` liste chaque projet de l'organisation sélectionnée avec `rebase cloud
use`, ainsi que le total. Tout membre de l'organisation peut le consulter. Un jeton peut le lire
avec la capacité `logs` sur le projet ; `usage org` liste les projets pour lesquels le
jeton détient cette capacité.
`--month` prend un mois passé. La réponse comporte des avertissements (`caveats`), chacun avec un `code` : `storage_not_measured`
(le stockage d'objets affiche 0), `multi_pod_undercount` (les requêtes servies lorsque deux
pods d'application ou plus s'exécutent ne sont pas comptées), `partial_days`, `metering_off`,
`overage_billing_off`, `not_billed`, `billed_next_month`, `pre_claim_days` (un
projet réclamé depuis un agent ne compte que les jours à partir de la réclamation) et
`autoscale_not_charged` (des pods ont fonctionné au-delà de `--replicas` et cette plateforme ne les
facture pas encore). La réponse pour un projet avec autoscaling comporte également `autoscale` :
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

`domains redirect` s'applique par domaine et est désactivé par défaut, de sorte qu'un projet servant un hôte `api.` à côté de son site conserve les deux ; l'option prend effet tant que le domaine est vérifié et qu'un autre domaine est défini comme principal, et ne s'applique jamais à un domaine sur lequel une application est servie. `deploy-hooks create` affiche l'URL du hook une seule fois. `deploy --git` ne peut pas être combiné avec les options d'un build local, et sur le runtime géré, nécessite `--eject`, car le plan de contrôle compile à partir des sources. `settings set --studio` est l'option que les commandes de projet (`rebase data`, `rebase users`, …) nécessitent d'activer pour `--project` : elles accèdent à l'application via le proxy Studio de la console. Une commande dont la route du plan de contrôle n'est pas encore déployée répond `not_served` et la nomme. Les commandes destructives demandent confirmation au préalable et échouent avec `confirmation_required` si personne ne peut répondre : utilisez `--yes`.
