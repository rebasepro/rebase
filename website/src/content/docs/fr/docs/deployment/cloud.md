---
sourceHash: 1ed19c3d147505c2
title: Rebase Cloud
sidebar_label: Rebase Cloud
description: Rebase Cloud est le même Rebase, opéré pour vous. Ce que c'est, comment lier et déployer un projet, et ce que la bêta privée n'inclut pas encore.
---

Rebase Cloud exécute le même Rebase open source que vous hébergeriez vous-même — la même
image publiée `rebasepro/server`, le même bundle, le même Postgres. La
seule différence réside dans la personne qui l'opère.

:::note[Bêta privée]
Rebase Cloud est en **bêta privée**. Il fait tourner de véritables environnements aujourd'hui et s'ouvre par
vagues. [Demander un accès](https://rebase.pro/pricing).

Il n'est pas en libre-service, les commandes ci-dessous nécessitent donc un compte ayant été autorisé.
Tout le reste sur ce site fonctionne sans compte.
:::

## Ce que c'est

Un **projet** Cloud correspond à trois éléments que la plateforme opère pour vous :

| | Ce que vous obtenez |
|---|---|
| **App** | Votre bundle, s'exécutant sur l'image d'exécution publiée. Les déploiements sont un téléversement de bundle, pas une construction de conteneur |
| **Base de données** | Un PostgreSQL managé, avec sauvegardes automatisées et récupération à un instant précis (PITR) |
| **Stockage** | Votre propre bucket, si votre projet utilise le stockage de fichiers |

Chaque élément est provisionné lors de votre premier déploiement, et chacun est facturé en fonction de ce qu'il
réserve plutôt que par utilisateur.

**Rien ne change dans votre projet pour y tourner.** Le même dépôt
s'auto-héberge avec `docker compose`, et la solution de sortie est réelle : `rebase build`
génère un bundle qui démarre partout où l'image d'exécution fonctionne.

## Lier un projet

Depuis le répertoire d'un projet :

```bash
rebase cloud login
rebase cloud billing setup
rebase cloud projects create --name "My app" --subdomain my-app --link
```

`projects create` ne prend aucun argument positionnel. Le nom et le sous-domaine sont
des options, et tous deux sont requis — ils sont demandés interactivement sur un terminal, et une
exécution non interactive qui omet l'un d'eux quitte avec l'erreur `input_required` plutôt que d'en
inventer un. **Le sous-domaine n'est pas modifiable par la suite :** il s'agit de l'hôte
`<slug>.rebase.website` sur lequel le projet répond, choisissez-le donc avec soin.

`--link` associe ce répertoire au projet au sein du même appel, évitant ainsi
une étape `link` séparée. Cela écrit `.rebase/cloud.json`, qui enregistre l'identifiant et le
slug du projet. Ce fichier n'est pas un secret et ne contient pas vos identifiants — ceux-ci résident
dans `~/.rebase/credentials.json`, généré par `login`.

Il est toutefois versionné avec le code, ce qui permet à un dépôt cloné de désigner n'importe quel
plan de contrôle. Lorsque l'hôte provient uniquement de ce fichier et qu'il ne s'agit ni de celui
de la plateforme ni d'un hôte auquel vous vous êtes connecté auparavant, `login` le nomme et demande
confirmation avant d'y envoyer votre e-mail et votre mot de passe. Sans terminal, ou avec
`--json`, il refuse avec l'erreur `unknown_control_plane` ; passez `--url <host>` (ou définissez
`REBASE_CLOUD_URL`) pour vous y connecter délibérément.

**Inscrit avec Google, GitHub ou LinkedIn ?** Votre compte n'a pas de mot de passe, connectez-vous donc
avec un code :

```bash
rebase cloud login --code --email me@example.com
```

Le plan de contrôle vous envoie par e-mail un code à 6 chiffres, valable dix minutes, que vous saisissez
à l'invite. Exécuté simplement dans un terminal, `rebase cloud login` demande s'il faut
utiliser votre mot de passe ou un code. Les codes exigent que le plan de contrôle puisse envoyer des
e-mails ; s'il ne le peut pas, `--code` l'indique et se termine avec `otp_unavailable`.

Si vous avez activé l'authentification à deux facteurs, `login` demande ensuite le code de
votre application d'authentification, ou l'un de vos codes de récupération, quelle que soit la façon dont vous vous êtes
connecté. Ni un code de connexion ni un second facteur ne peuvent être saisis sans terminal.
Pour un script, créez un jeton d'accès dans la console (**Settings → Access
tokens**) et définissez `REBASE_TOKEN` ; voir [CI et agents](/docs/deployment/cloud-agents/#ci-and-agents).

Un mauvais mot de passe répond `invalid_credentials` avec les deux mêmes moyens de se connecter, car
la cause habituelle est un compte qui n'en a jamais eu.

`billing setup` associe une carte bancaire à l'organisation, une seule fois. Cette commande est intentionnellement
la première de la séquence : le premier déploiement d'un projet est refusé sans carte, et
s'en rendre compte après avoir terminé le téléversement d'un bundle est la pire des situations.

Ensuite, la page **Billing** de la console liste les factures de l'organisation,
chacune avec la page hébergée de Stripe et son PDF, et prévisualise la prochaine facture de chaque
projet. `rebase cloud billing invoices` et `rebase cloud billing upcoming`
affichent la même chose. Ces deux vues sont réservées aux propriétaires et administrateurs de l'organisation. Lorsque la
plateforme le propose, **Manage billing** ouvre le portail client de Stripe pour la
carte, les informations de facturation et les factures passées.

Avec une carte déjà enregistrée, créer un autre projet dans la console ne demande
aucun second paiement : le projet est facturé sur cette carte et se déploie. Si la carte
est refusée, ou si la banque veut que le paiement soit confirmé, la console vous redirige vers
**Billing**, où **Fix your card** enregistre une autre carte et **Complete the
payment** ouvre la facture Stripe.

Ce qu'un projet a consommé s'affiche dans sa vue d'ensemble, sous **Usage this month**, et
pour tous les projets à la fois sur la page **Billing** : les requêtes par rapport au
quota inclus (la barre passe à l'orange à 80 %), les erreurs 5xx, le dépassement
à ce jour et la projection du mois à ce rythme. Le dépassement est calculé par le
même code que celui qui le transmet à Stripe ; c'est donc ce que la facture comportera ; il
figure sur la facture du mois suivant. `rebase cloud usage` affiche la
même chose, et `rebase cloud usage org` l'ensemble de l'organisation. Tout membre peut le
consulter. Les chiffres indiquent ce qu'ils ne voient pas encore : le stockage d'objets n'est pas mesuré,
donc aucun dépassement de stockage n'est facturé ; tant qu'un projet exécute deux pods d'application ou plus,
ses requêtes ne sont pas comptées ; et un jour avec des échantillons manquants sous-compte. Un
projet avec autoscaling affiche aussi les pods qu'il a exécutés au-delà de `--replicas`, en pod-heures,
ce qu'ils coûtent à ses propres tarifs et si cette plateforme les facture déjà. Un
projet réclamé depuis un agent ne compte que les jours à partir de la réclamation : avant,
le projet appartenait à la plateforme.

Un projet existant se lie sans création préalable :

```bash
rebase cloud projects list
rebase cloud link --project my-app
```

## Déployer

```bash
rebase cloud deploy
```

Une seule commande, et aucune option à retenir. Le fichier `rebase.json` d'un projet généré déclare
`runtime: "managed"` pour son backend, et `deploy` lit cette déclaration — il
l'indique au passage (`rebase.json declares runtime: managed — deploying a
bundle`), compile l'application dans `dist-bundle`, téléverse le bundle, l'exécute sur
l'image d'exécution publiée, et suit le déploiement jusqu'à son état final. Le code de
sortie faisant foi, la même ligne fonctionne de manière non surveillée en CI.

Il se termine en indiquant où chaque application répond désormais et si la nouvelle version y est en ligne :

```text
  ✓ Deployed songbuzz in 1m 12s  (deployment fb3c7442-9937-4179-8d3c-88a106da149d)

    game     static   https://songbuzz.rebase.website      live
    backend  backend  https://songbuzz.rebase.website/api  live

  ✓ Live: the new version answers on every address above.
  Something wrong? `rebase cloud rollback` puts the previous deployment back.
```

« Live » signifie que l'adresse a répondu après le build : le `/health` du backend a renvoyé `ok`, et la page d'une application statique s'est chargée (depuis ce déploiement, quand la plateforme la sert). La vérification attend jusqu'à `--live-timeout` secondes, 60 par défaut ; `0` la désactive. Si une application ne répond pas à temps, le déploiement se termine quand même avec le code zéro, car il a réussi, et la dernière ligne indique quelle application n'a pas répondu et pourquoi. Un déploiement en échec se termine à la place par une ligne qui nomme l'application et la raison, avec `rebase cloud logs` pour le log de build complet.

Les scripts passent `--json` pour obtenir un objet portant les mêmes informations — `apps`, `hosts`, `live`, `liveChecks`, `durationMs` et l'identifiant du déploiement. Contrairement au reste de `rebase cloud`, `deploy` ne passe pas de lui-même en JSON via un pipe.

Ce que ce runtime autorise — paquets et modules natifs, mémoire et instances, timeouts et tailles de payload, système de fichiers, secrets, stockage et réseau sortant — se trouve sur sa propre page :
[Runtime backend managé](/docs/deployment/managed-runtime/).

Pour déployer un artefact compilé plus tôt — par exemple un job CI qui compile une fois et
déploie deux fois —, pointez vers le répertoire au lieu de recompiler :

```bash
rebase build
rebase cloud deploy --bundle-dir dist-bundle
```

Quitter le runtime managé s'effectue via sa propre option, `--eject`, et rien d'autre ne la
demande : une compilation qui déplacerait un projet managé vers une image de conteneur dont il
devient propriétaire est refusée tant que vous ne l'avez pas explicitement demandé. Auparavant, `--force` avait cette signification,
ce qui plaçait l'action la moins réversible du CLI sous le même terme que « écraser ce
fichier » ; il s'agit désormais d'une option inconnue plutôt que d'un alias, ce qui interrompt
un script qui la contiendrait.

### La vérification de syntaxe avant le téléversement

Les fichiers d'une application statique sont servis tels quels. Lorsque son `build` se contente de copier des scripts écrits à la main dans `output`, personne ne les a analysés, et un fichier contenant une faute de frappe est mis en ligne et empêche la page de se charger. C'est pourquoi, avant tout téléversement, `deploy` analyse chaque fichier `.js`, `.mjs` et `.cjs` du `output` de chaque application statique, ainsi que chaque `<script>` en ligne de ses fichiers `.html`. Cela couvre une application statique déployée seule comme les applications statiques intégrées au bundle du backend. Une erreur de syntaxe arrête le déploiement en indiquant le fichier, la ligne et la colonne :

```
✗ A syntax error in the static output, so nothing was deployed:
    web/cloud.js:42:23  Unexpected token
        42 |     return fetch("/api";
Fix it and deploy again, or pass --no-verify to deploy anyway.
```

Avec `--json`, le `code` de l'erreur est `syntax_error`. Les scripts en ligne qu'un navigateur n'exécute pas comme du JavaScript sont ignorés : JSON, import maps, templates et tout autre `type` non JavaScript, un `<script src>`, ainsi qu'un script qui contient encore du balisage de template non rendu comme `{{ }}`. Un fichier `.js` est accepté s'il s'analyse comme script classique ou comme module, car c'est la page qui en décide. Rien sous `node_modules` n'est lu, pas plus qu'un `--bundle-dir` déjà construit. `--no-verify` désactive la vérification pour un déploiement.

Surveiller le déploiement :

```bash
rebase cloud logs               # the build log
rebase cloud logs --runtime -f  # what the running app prints, live, until Ctrl-C
rebase cloud status             # what the platform thinks the project is doing
```

`status` rapporte `blockedOn` et `nextAction`. Lorsque `blockedOn` vaut `null`, la
plateforme travaille réellement et le polling est la bonne chose à faire ; lorsqu'il indique
une valeur, cette étape est en attente d'une action de votre part.

## Prévisualiser un changement

```bash
rebase cloud deploy --preview
```

Cela compile et téléverse exactement ce que ferait `deploy`, mais le sert à une adresse
qui lui est propre, comme `https://shop--k3x9ab.rebase.website`. La production continue
de servir ce qu'elle servait auparavant. Le déploiement affiche l'adresse de l'aperçu une fois
le build terminé.

Pour conserver la même adresse d'un déploiement à l'autre, nommez l'aperçu. Déployer
le même nom à nouveau le met à jour :

```bash
rebase cloud deploy --preview-name new-checkout
```

Ce à quoi un aperçu parle dépend de ce que vous avez déployé :

- **`rebase cloud deploy --preview`** prévisualise le backend, avec ses applications statiques
  intégrées, comme la production les exécute. Il obtient un backend à lui sur une
  **base de données vide qui lui est propre**, jamais celle de la production. Démarrer sur
  la base de données de production lui appliquerait le schéma et les règles d'accès de l'aperçu.
- **`rebase cloud deploy web --preview`** prévisualiserait une application statique seule,
  ses pages appelant le backend de **production**. Cela suppose un plan de contrôle
  qui sert des sites statiques isolés, ce que Rebase Cloud ne fait pas encore : il
  refuse avec `PREVIEW_STATIC_UNSERVED` et ne publie rien. Prévisualisez plutôt le
  backend, qui sert les applications statiques intégrées ; un projet sans
  backend managé ne peut pas encore être prévisualisé.

Un aperçu ne téléverse aucune source et n'enregistre aucune application ni aucun nom d'hôte, car chacun
de ces éléments modifierait le projet de production. `--source` et `--eject` ne peuvent pas
être combinés avec `--preview`. Chacun construit une image de conteneur pour la production.

```bash
rebase cloud previews                      # name, address, app, backend, expiry
rebase cloud logs --preview new-checkout   # its build log; -f follows a build still running
rebase cloud logs --runtime --preview new-checkout -f  # what its backend prints
rebase cloud previews delete new-checkout  # stops serving it and drops its database
```

`rebase cloud logs` sans `--preview` concerne toujours la production.

La page **Deployments** de la console liste les mêmes aperçus, et permet d'ouvrir, d'afficher le
log de build ou de supprimer chacun d'eux. En créer un reste une étape du CLI.

Un aperçu expire une semaine après son dernier déploiement.

À la fin, le déploiement vérifie que l'adresse de l'aperçu répond, comme un
déploiement de production (`--live-timeout <seconds>`, `0` pour ignorer). Le certificat d'un nouvel
aperçu peut mettre une minute ou deux, si bien qu'un déploiement réussi peut
indiquer que l'adresse ne répond pas encore.

Un aperçu de backend est facturé comme une unité d'application à la taille par défaut (100m de CPU
et 384 MiB de mémoire, au tarif de votre application pour sa région et sa capacité),
au prorata de sa durée d'existence, et il apparaît dans le devis mensuel du projet
dans la console. `rebase cloud deploy --preview` affiche le même devis, par mois
(`cost` avec `--json`). En démarrer un exige une carte enregistrée, comme un déploiement
de production. Un premier déploiement qui échoue avant que quoi que ce soit ne s'exécute est
supprimé plutôt que facturé. Un projet peut exécuter
trois aperçus de backend à la fois.

Chaque nouvelle adresse d'aperçu reçoit son propre certificat TLS de Let's Encrypt,
qui autorise 50 nouveaux certificats par semaine pour un domaine, partagés avec chaque site
de production qui en dépend. Les aperçus peuvent en consommer 20 sur 7 jours glissants, pour l'ensemble de la plateforme. Au-delà,
un nouvel aperçu est refusé (`429`, `preview_cert_budget`) avec l'heure à laquelle il peut
être déployé ; redéployer un aperçu qui existe déjà ne compte jamais.

La base de données d'un aperçu de backend est une seconde base sur le Postgres de la **production** :
ses propres données, mais la même instance et le même disque. Elle est limitée à 10
connexions, afin que les aperçus ne puissent pas épuiser celles de la production, et à 2 Go : un aperçu
dont la base dépasse cette taille est mis en pause. Son backend s'arrête, son adresse cesse de
répondre, `rebase cloud previews` et la console l'affichent comme `paused` avec la
raison, et les propriétaires et administrateurs du projet sont notifiés (`preview.paused`). Ses
données sont conservées jusqu'à son expiration. Redéployez-le pour le démarrer (il est de nouveau mis en pause
tant que la base est encore trop volumineuse), ou supprimez-le. Un aperçu en pause est toujours
facturé jusqu'à sa suppression ou son expiration. Supprimez les aperçus dont vous n'avez plus besoin. Les extensions installées en production ne sont pas
installées dans la base de données d'un aperçu.

Les aperçus sont en cours de déploiement. Un plan de contrôle qui ne les sert pas encore refuse
`--preview` avec `previews_unavailable` et ne déploie rien.

## Revenir en arrière (Rollback)

```bash
rebase cloud deployments
rebase cloud rollback
```

Un rollback redirige le projet vers ce qu'un déploiement réussi antérieur a
livré, sans jamais recompiler — tout l'intérêt d'un rollback réside dans le déploiement d'un
artefact qui a déjà tourné avec succès.

Les déploiements éligibles dépendent de la façon dont le projet a été déployé, et les deux approches
fonctionnent :

| Comment il a été déployé | Ce qui est restauré |
|---|---|
| `rebase cloud deploy` (un build depuis les sources) | L'image publiée par ce build |
| `rebase cloud deploy --bundle` (le runtime de la plateforme) | Le bundle livré par ce déploiement, sur la version du runtime exécutée actuellement par le projet |

Les applications statiques intégrées au bundle du backend (un simple `rebase cloud deploy` dans un projet doté d'un backend) font partie de ce bundle et reviennent donc en arrière avec lui.

Une application statique déployée seule (`rebase cloud deploy <app>`) ne peut pas encore faire l'objet d'un rollback. Son déploiement enregistre l'application qu'il a publiée, mais pas de bundle, si bien que le plan de contrôle n'a rien à partir de quoi la restaurer. La solution consiste à redéployer la dernière version correcte, par exemple depuis le commit précédant le commit fautif. Après un tel déploiement, `deploy` le signale au lieu de renvoyer vers `rollback`, et `rollback`
sans identifiant refuse plutôt que de redéployer le backend qui sert déjà.

Un rollback nécessite donc un déploiement ayant enregistré l'un des deux, ce qui implique
un projet ayant été déployé avec succès au moins deux fois. `rebase cloud deployments`
signale ceux qui sont éligibles, et `--json` renvoie `rollbackable` pour chaque ligne avec
l'`image` ou le `bundle` qui serait restauré.

Deux types de déploiements sont refusés, et le CLI précise lequel : un déploiement qui n'a pas réussi,
et un déploiement antérieur à l'enregistrement de l'artefact par la plateforme. Il n'y a rien à
deviner dans les deux cas — deviner reviendrait à livrer ce qui a été compilé ou téléversé le
plus récemment tout en prétendant restaurer cette version —, déployez donc plutôt la version souhaitée.

Chaque déploiement réussi se termine en indiquant le chemin du retour (`rebase cloud rollback`), pour qu'il soit sous les yeux au moment où une version défectueuse est repérée.

Un rollback ajoute un nouveau déploiement plutôt que de rembobiner l'historique, et attend
que la version restaurée réponde avant de confirmer le succès. Suivez-le avec
`rebase cloud logs -f`.

## Restaurer la base de données à un instant précis

Une base de données managée peut être récupérée à n'importe quelle minute de sa fenêtre de récupération,
depuis **Database → Backups** dans la console ou avec le CLI :
`rebase cloud db pitr status | restore --target <ISO> | cutover | discard`.
Cela se fait en deux étapes. D'abord, une copie récupérée est préparée à côté de la base de données active ;
votre app continue de tourner sur la base active, et le stockage de la copie est facturé jusqu'à
ce que vous basculiez ou la supprimiez.
Ensuite, une fois la copie prête, la bascule (cutover) redirige l'app vers elle et la redémarre.
Tout ce qui a été écrit après l'heure cible n'est pas dans la copie. La base de données d'origine
est conservée comme chemin de retour, et continue de facturer son stockage ; revenir en arrière,
la supprimer ou lancer une seconde restauration passe par le support. Seul un propriétaire ou administrateur
peut préparer, basculer ou supprimer, et la console demande le nom du projet
avant de basculer.

## Sécuriser votre compte

Votre compte de console peut atteindre les bases de données de production, les secrets et la facturation ; protégez-le
en conséquence. Ouvrez **Account security** depuis le menu sous votre avatar
dans la console (ou allez sur `/account`). Cette page est la vôtre, pas celle d'une
organisation : ce que vous y définissez s'applique à chaque organisation dont vous faites partie.

- **Vérification en deux étapes.** Activez-la avec n'importe quelle application d'authentification (1Password,
  Google Authenticator, Authy). La page affiche une clé de configuration à ajouter à l'application, ou un
  lien qui ouvre l'application avec la clé préremplie sur un téléphone, puis demande le
  code à 6 chiffres affiché par l'application. À partir de là, chaque connexion demande un code,
  que vous vous connectiez avec un mot de passe, Google ou GitHub.
- **Codes de récupération.** L'activer vous donne dix codes à usage unique, affichés une seule fois.
  Chacun vous connecte à la place du code de l'application d'authentification si vous perdez votre
  téléphone ; enregistrez-les donc avant de fermer la boîte de dialogue. **New recovery codes**
  les remplace, et les anciens cessent de fonctionner. Désactiver la vérification en deux étapes
  et obtenir de nouveaux codes demandent tous deux un code au préalable.
- **Mot de passe.** Le changer vous déconnecte de tous les autres appareils. Un compte
  créé avec Google, GitHub ou LinkedIn n'a pas de mot de passe ; la page propose de
  vous envoyer par e-mail un lien pour en définir un.
- **Appareils connectés.** Chaque navigateur et terminal connecté à votre compte,
  avec son adresse et l'heure de connexion. Déconnectez tout appareil que vous ne
  reconnaissez pas, ou tous à la fois.

Les [jetons d'accès](/docs/deployment/cloud-agents/#ci-and-agents) ne sont pas des sessions et ne demandent pas de second
facteur ; la CI continue donc de déployer après que vous l'avez activé. Révoquez un jeton en lequel vous n'avez plus
confiance sous **Settings → Access tokens**.

## Inviter votre équipe

**Members → Invite member** fournit un lien à copier (envoyé par e-mail lorsque ce plan de contrôle
envoie des e-mails) qui ne fonctionne qu'une fois, pendant 7 jours, pour un compte ayant vérifié cette
adresse ; personne ne rejoint l'organisation tant qu'il n'a pas accepté. Invitez un administrateur ou un membre, et faites-en
un propriétaire une fois qu'il a rejoint l'organisation. Les propriétaires et administrateurs la voient, la renvoient ou la révoquent dans
**Pending invitations** ; depuis un terminal, [`rebase cloud orgs members invite`](/docs/cli/cloud/#organizations).

## Voir qui a fait quoi

La page **Activity** de la console et `rebase cloud activity` montrent aux
propriétaires et administrateurs de l'organisation qui a déployé, défini ou révélé une variable d'environnement
(par son nom, jamais par sa valeur), modifié un domaine, restauré une sauvegarde,
redimensionné, arrêté ou supprimé un projet, changé le rôle d'un membre, ou créé un
jeton, et quand. Les **Settings** d'un projet renvoient vers ses propres entrées ; une entrée
concernant un projet supprimé est conservée. Un script la lit avec un jeton créé avec
`--can audit` sur l'organisation. Les entrées sont conservées un an. Les filtres sont dans
[`rebase cloud`](/docs/cli/cloud/#organizations).

## CI et agents

Un job CI ou un agent ne devrait pas détenir votre mot de passe. Donnez-lui un jeton restreint à
quelques actions sur un seul projet, créé depuis un terminal authentifié avec
`rebase cloud tokens create --project shop --can deploy,logs`, et définissez-le comme
`REBASE_TOKEN`. La facturation, le journal d'activité et les paramètres de notification d'une organisation
sont des capacités à part entière (`--can billing`, `audit`,
`notifications`) qu'un jeton ne détient que si on les lui demande. Les capacités, un
workflow GitHub Actions et ce qui reste réservé à une personne connectée se trouvent dans
[CI et agents](/docs/deployment/cloud-agents/#ci-and-agents).

## Un backend sans compte

`rebase cloud init --claim` donne à une app un backend en ligne avant que quiconque se soit
inscrit, et affiche une URL de réclamation pour que la personne le garde ; un projet que personne ne réclame
dans les 72 heures est supprimé. Ce que le jeton du projet non réclamé peut faire, le
`REBASE_API_TOKEN` qu'il écrit et ce que change la réclamation se trouvent dans
[Un backend sans compte](/docs/deployment/cloud-agents/#a-backend-with-no-account).

## Compute, et combien cela coûte

Le tarif d'un projet dépend de ce qu'il réserve, et non d'un forfait prédéfini. `compute` affiche
chaque paramètre ainsi que l'estimation détaillée établie par le plan de contrôle. (`rebase cloud
resources` est une commande différente : elle liste les bases de données et buckets déclarés par le code,
et indique si chacun est provisionné — voir la [référence CLI](/docs/cli/cloud/).)

```bash
rebase cloud compute
rebase cloud compute set --cpu 500m --memory 2Gi
```

| Paramètre | Unité, et signification |
|---|---|
| `--cpu`, `--memory` | Ressource demandée par instance de l'application, ex. `500m` et `2Gi`. Vide correspond à la valeur par défaut de la plateforme — `100m` et `384Mi`, avec des pics possibles jusqu'à 2 CPU et `2Gi` |
| `--replicas` | Nombre d'instances permanentes : le plancher de l'autoscaler, et ce que l'abonnement du projet facture chaque mois |
| `--autoscale-max` | 1–16. Le plafond pouvant être atteint. Les instances que l'autoscaler ajoute au-delà de `--replicas` sont mesurées par pod-seconde aux mêmes tarifs, et facturées uniquement là où la plateforme l'a activé ; **Usage this month** l'indique. `--no-autoscale` le désactive |
| `--autoscale-cpu-target` | 10–95. L'utilisation du CPU que l'autoscaler maintient, par rapport à la ressource demandée (request) plutôt qu'à la limite. Vide correspond à 70 |
| `--spot` | `true` ou `false`. Capacité préemptible : moins chère, mais redémarrée sans préavis |
| `--db-instances` | 1–3. `1` est une instance unique sans basculement automatique ; `2` ajoute une instance de secours (standby) automatique |
| `--db-cpu`, `--db-memory` | Par instance de base de données. Vide correspond à `160m` et `1Gi` |

Un paramètre laissé vide n'est pas équivalent à un paramètre fixé à la même valeur : un paramètre vide
suit la valeur par défaut de la plateforme et évolue avec elle.

Rien n'est validé par le CLI, à dessein — les limites dépendent du cluster sur lequel
le projet s'exécute, et elles varient selon les fournisseurs. Le plan de contrôle refuse toute
valeur qu'il ne peut honorer et indique le champ concerné. Exécutez `rebase cloud compute` pour voir
le montant en €/mois avant et après ; une modification s'applique immédiatement, au prorata à compter d'aujourd'hui,
sauf celle qui redémarre la base de données, qui attendra une fenêtre de maintenance.

## L'ensemble des commandes

| Groupe de commandes | Ce qu'il couvre |
|---|---|
| `login`, `logout`, `whoami` | Votre session |
| `tokens` | Jetons pour la CI et les agents, chacun restreint à un projet. Voir [CI et agents](/docs/deployment/cloud-agents/#ci-and-agents) |
| `link`, `unlink`, `use`, `open` | Lier ce répertoire à un projet, sélectionner une organisation, ouvrir la console |
| `init`, `claim` | Avec `--claim` : un backend en ligne sans compte, et un lien pour le réclamer ; `claim` affiche de nouveau ce lien. Voir [Un backend sans compte](/docs/deployment/cloud-agents/#a-backend-with-no-account) |
| `projects` | Créer, lister, inspecter, supprimer |
| `deploy`, `logs`, `deployments`, `rollback`, `cancel` | Déployer et surveiller |
| `previews` | Les builds servis à leur propre adresse par `deploy --preview`, et leur suppression. Voir [Prévisualiser un changement](#prévisualiser-un-changement) |
| `start`, `stop`, `restart` | Mettre un projet en pause et le réactiver. Un projet arrêté conserve son abonnement, sauf si la plateforme ne facture aux projets arrêtés que le stockage et les frais de plateforme ; la ligne **Billing** de la console l'indique lorsque c'est le cas |
| `status`, `metrics`, `debug` | Ce qu'il fait, et pourquoi il ne le fait pas |
| `cron` | Les tâches cron de l'application déployée et leurs exécutions enregistrées, consultées avec votre session `rebase cloud`. Lecture seule |
| `env` | Variables d'environnement. `list` n'affiche jamais les valeurs ; `--secret` est en écriture seule |
| `app-key` | La clé que `init --claim` a écrite dans `.env` sous le nom `REBASE_API_TOKEN`, remise lors de la réclamation ; `rotate` la remplace et révoque l'ancienne. Propriétaires et administrateurs |
| `service-key` | `REBASE_SERVICE_KEY`, administrateur sur l'API propre à l'app : date de sa dernière rotation ; `rotate` donne à l'app une nouvelle clé. Propriétaires et administrateurs |
| `domains` | Domaines personnalisés, enregistrements DNS à ajouter, et vérification. Un projet peut répondre sur plusieurs domaines, chacun vérifié indépendamment ; `verify` et `remove` prennent le domaine à traiter, qui ne peut être omis que lorsqu'il n'y en a qu'un seul (pour `verify`, un seul en attente). `list --json` retourne `{ projectId, tenantHost, domains: [...] }` |
| `db` | Associer ou créer une base de données, s'y connecter depuis votre machine, sauvegardes, restauration et récupération PITR |
| `extensions` | La liste d'autorisation des extensions Postgres |
| `storage` | Le bucket du projet |
| `resources` | Les bases de données et buckets gérés par la plateforme, par rapport à ce que le code déclare |
| `compute` | Ce que ce projet réserve, ce qu'il coûte, et comment le modifier |
| `usage` | Les requêtes utilisées ce mois-ci par rapport au quota inclus, et le dépassement à ce jour, tel que la facture le compte. `usage org` liste chaque projet de l'organisation |
| `clusters` | Les clusters sur lesquels tournent les projets. Réservé aux administrateurs de la plateforme |
| `settings`, `orgs`, `billing` | Paramètres du projet, organisations avec leurs membres et invitations, paiement |
| `activity` | Le journal d'audit de l'organisation : qui a déployé, modifié une variable d'environnement (par son nom), un domaine, une sauvegarde, un membre ou un jeton. Propriétaires et administrateurs. Voir [Voir qui a fait quoi](#voir-qui-a-fait-quoi) |
| `notifications`, `webhooks` | Où les événements du projet sont envoyés en POST : Slack, Discord ou n'importe quelle URL https ([Cloud notifications](/docs/deployment/cloud-notifications/)). `webhooks` est retiré et se termine avec le code 1 et `command_retired` |

Chaque groupe de ce tableau répond à `--help` avec sa propre page — une ligne d'utilisation,
ses options et des exemples — et `--help` n'exécute jamais la commande. Un test maintient
l'index de ces pages, de sorte qu'un groupe ajouté sans documentation fait échouer le build au lieu de
répondre avec la table des matières. La commande `verify:docs` aligne le tableau lui-même sur
cet index : chaque groupe géré par le CLI apparaît ici exactement une fois, et un groupe
ajouté sans ligne dédiée fait également échouer le build.

Redirigée via un tube (pipe), `--help` répond en JSON : la même ligne d'utilisation, les options et les exemples
sous forme de structure exploitable plutôt que soixante lignes de séquences d'échappement de terminal.

## Ce que la version bêta n'inclut pas

Indiqué en toute transparence, car s'en rendre compte plus tard est toujours désagréable :

- **Pas de choix de région.** Tout tourne dans une seule région aujourd'hui. Le modèle de placement
  existe dans la plateforme, mais un projet ne peut pas choisir sa région.
  `projects create --provider` et `--region` ne font pas exception malgré les apparences : ils enregistrent
  à quelle cible de déploiement configurée dans le plan de contrôle le projet appartient, et il n'y en a qu'une,
  les deux utilisent donc cette valeur par défaut et aucun ne déplace le projet ailleurs. `rebase cloud projects create --help` indique la même chose.
- **Pas de libre-service.** L'accès est accordé par vagues ; il n'y a pas d'inscription directe avec paiement.
- **Pas de SLA publié**, ni de certification SOC 2. Si vous avez besoin de l'un d'eux, mentionnez-le lors de votre demande
  d'accès plutôt que de le supposer.
- **Pas de déploiements par branche**, et aucune application GitHub officielle. Les hooks de déploiement —
  des URLs secrètes vers lesquelles pointer un webhook de dépôt — constituent l'automatisation prise en charge. Les [déploiements
  de prévisualisation](#prévisualiser-un-changement) sont en cours de déploiement et se lancent depuis le CLI.
- **Les jetons agissent en tant que personne.** Un [jeton](/docs/deployment/cloud-agents/#ci-and-agents) est généré par un compte
  et agit en son nom ; il n'y a pas encore d'identité machine propre à l'organisation. Si vous
  vous authentifiez depuis une CI, transmettez `REBASE_CLOUD_EMAIL` et `REBASE_CLOUD_PASSWORD`
  depuis un gestionnaire de secrets — `--password` place le mot de passe dans l'historique de votre shell et
  dans la table des processus, et vous en avertit avant de vous connecter. Si le fichier
  `.rebase/cloud.json` du dépôt mentionne un plan de contrôle autre que celui de la plateforme, passez-le
  également avec `--url` : sans terminal, `login` refuse d'envoyer un mot de passe à un
  hôte mentionné uniquement dans le fichier extrait.
- **Pas de point de terminaison public pour la base de données.** Une base de données managée n'est pas exposée à
  Internet, donc l'hôte affiché par la console correspond à son adresse pour votre backend et
  ne résout rien sur votre machine locale. `rebase cloud db connect` ouvre un port local
  relié à cette base de données, via un tunnel traversant le plan de contrôle, aussi longtemps
  que vous le laissez tourner — mais il n'existe pas de nom d'hôte permanent auquel un service tiers
  peut se connecter. Ce tunnel, ainsi que le mot de passe révélé par
  `rebase cloud db info --reveal`, requièrent tous deux le rôle de propriétaire (owner) ou d'administrateur (admin) de l'organisation :
  le même rôle requis par l'éditeur SQL de Studio, car tous trois aboutissent à une
  session directe sur vos données de production.
- **Déployer, c'est exécuter du code avec les secrets de production.** L'environnement de l'app
  contient `REBASE_SERVICE_KEY` (administrateur sur sa propre API),
  `DATABASE_URL` et `JWT_SECRET` ; le code qu'un membre déploie peut donc les lire,
  même si seuls les propriétaires et administrateurs peuvent les révéler dans la console. N'invitez
  comme membre qu'une personne à qui vous confieriez ces valeurs.
- **La clé de service peut être remplacée.** Les **Settings** du projet
  (ou `rebase cloud service-key rotate`) émettent un nouveau `REBASE_SERVICE_KEY`
  et redémarrent l'app dessus. L'ancienne clé fonctionne jusqu'à la fin du
  redémarrage, et plus du tout ensuite ; tout ce qui l'avait copiée est donc refusé
  à partir de là. Réclamer un projet fait la même chose.

## S'auto-héberger à la place

Rien ici ne vous enferme. Le [guide d'auto-hébergement](/docs/deployment/self-hosting/)
exécute l'image et le bundle identiques avec `docker compose`, et le
[guide Kubernetes](/docs/deployment/kubernetes/) déploie la même topologie à partir
du Helm chart.
