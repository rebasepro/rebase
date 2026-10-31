---
sourceHash: 3f0338ecb589f00b
title: Rebase Cloud
sidebar_label: Rebase Cloud
description: Rebase Cloud est le même Rebase, opéré pour vous. Ce que c'est, comment un projet se lie et se déploie, et ce que la bêta privée n'inclut pas encore.
---

Rebase Cloud exécute le même Rebase open-source que vous auto-hébergeriez — la même
image `rebasepro/server` publiée, le même bundle, le même Postgres. La
différence réside dans l'entité qui l'opère.

:::note[Bêta privée]
Rebase Cloud est en **bêta privée**. Il fait tourner de véritables environnements aujourd'hui et s'ouvre par
vagues. [Demander l'accès](https://rebase.pro/pricing).

Il n'est pas en libre-service, donc les commandes ci-dessous nécessitent un compte ayant été accepté.
Tout le reste sur ce site fonctionne sans compte.
:::

## Ce que c'est

Un **projet** Cloud correspond à trois éléments que la plateforme opère pour vous :

| | Ce que vous obtenez |
|---|---|
| **App** | Votre bundle, s'exécutant sur l'image de runtime publiée. Les déploiements sont un téléversement de bundle, pas un build de conteneur |
| **Database** | Un PostgreSQL géré, avec sauvegardes automatisées et récupération à un instant précis (point-in-time recovery) |
| **Storage** | Votre propre bucket, si votre projet utilise le stockage de fichiers |

Chacun est provisionné lors de votre premier déploiement, et chacun est facturé selon ce qu'il
réserve plutôt que par utilisateur.

**Rien ne change dans votre projet pour s'y exécuter.** Le même dépôt
s'auto-héberge avec `docker compose`, et la porte de sortie est bien réelle : `rebase build`
produit un bundle qui démarre partout où l'image de runtime s'exécute.

## Lier un projet

Depuis le répertoire d'un projet :

```bash
rebase cloud login
rebase cloud billing setup
rebase cloud projects create --name "My app" --subdomain my-app --link
```

`projects create` ne prend aucun argument positionnel. Le nom et le sous-domaine sont
des options, et tous deux sont obligatoires — dans un terminal, ils vous sont demandés, et une
exécution sans interface qui omet l'un ou l'autre se termine avec `input_required` plutôt que d'en
inventer un. **Le sous-domaine n'est pas modifiable par la suite :** il s'agit de l'hôte
`<slug>.rebase.website` sur lequel le projet répond, choisissez-le donc avec soin.

`--link` associe ce répertoire au projet lors du même appel, évitant ainsi une
étape `link` séparée. Il écrit `.rebase/cloud.json`, qui enregistre l'identifiant
et le slug du projet. Ce fichier n'est pas un secret et ne contient pas vos identifiants — ceux-ci résident
dans `~/.rebase/credentials.json`, écrit par `login`.

Il est cependant commité avec le code, de sorte qu'un dépôt cloné puisse désigner n'importe quel
plan de contrôle. Lorsque l'hôte provient uniquement de ce fichier et qu'il ne s'agit ni de celui de la
plateforme ni d'un hôte auquel vous vous êtes déjà connecté auparavant, `login` le nomme et vous demande
confirmation avant d'y envoyer votre e-mail et votre mot de passe. Sans terminal ou avec
`--json`, il refuse avec `unknown_control_plane` ; passez `--url <host>` (ou définissez
`REBASE_CLOUD_URL`) pour vous y connecter délibérément.

**Inscrit avec Google, GitHub ou LinkedIn ?** Votre compte n'a pas de mot de passe,
connectez-vous donc avec un code :

```bash
rebase cloud login --code --email me@example.com
```

Le plan de contrôle vous envoie par e-mail un code à 6 chiffres, valable dix minutes, que vous
saisissez à l'invite de commande. Exécuté simplement dans un terminal, `rebase cloud login` vous demande
si vous souhaitez utiliser votre mot de passe ou un code. Les codes nécessitent que le plan de contrôle puisse envoyer
des e-mails ; si ce n'est pas le cas, `--code` l'indique et se termine avec `otp_unavailable`.

Si vous avez activé l'authentification à deux facteurs, `login` vous demande ensuite le code de
votre application d'authentification ou l'un de vos codes de secours, quel que soit le mode de connexion
utilisé. Ni un code de connexion ni un second facteur ne peuvent être saisis sans terminal.
Pour un script, créez un jeton d'accès dans la console (**Settings → Access
tokens**) et définissez `REBASE_TOKEN` ; voir [CI et agents](/docs/deployment/cloud-agents/#ci-and-agents).

Un mauvais mot de passe renvoie `invalid_credentials` avec les deux mêmes moyens d'accès,
la cause courante étant un compte qui n'en a jamais eu.

`billing setup` associe une carte bancaire à l'organisation, une seule fois. Cette commande est intentionnellement
placée en premier dans la séquence : le premier déploiement d'un projet est refusé sans carte, et
s'en rendre compte après la fin du téléversement d'un bundle est le pire cas de figure.

Après cela, la page **Billing** de la console liste les factures de l'organisation,
chacune avec la page hébergée par Stripe et le PDF, et donne un aperçu de la prochaine facture de chaque
projet. `rebase cloud billing invoices` et `rebase cloud billing upcoming`
affichent la même chose. Les deux s'adressent aux propriétaires et administrateurs de l'organisation. Lorsque
la plateforme le propose, **Manage billing** ouvre le portail client de Stripe pour la
carte, les coordonnées de facturation et l'historique des factures.

Avec une carte déjà enregistrée, la création d'un autre projet dans la console ne demande
aucun second paiement : le projet est facturé sur cette carte et se déploie. Si la carte
est refusée, ou si la banque demande la confirmation du paiement, la console vous redirige vers
**Billing**, où **Fix your card** enregistre une autre carte et **Complete the
payment** ouvre la facture Stripe.

L'utilisation d'un projet s'affiche sur sa vue d'ensemble, sous **Usage this month**, et
pour tous les projets à la fois sur la page **Billing** : les requêtes par rapport au
forfait inclus (la barre devient orange à 80 %), les erreurs 5xx, le dépassement actuel
et l'estimation pour la fin du mois à ce rythme. Le dépassement est calculé par le
même code qui le transmet à Stripe, c'est donc ce qui figurera sur la facture ; il
apparaît sur la facture du mois suivant. `rebase cloud usage` affiche la
même chose, et `rebase cloud usage org` pour toute l'organisation. Tout membre peut le
consulter. Les chiffres indiquent ce qu'ils ne peuvent pas encore voir : le stockage objet n'est pas mesuré,
aucun dépassement de stockage n'est donc facturé ; lorsqu'un projet exécute deux pods d'application ou plus,
ses requêtes ne sont pas comptabilisées ; et une journée avec des échantillons manqués sous-estime le compte. Un
projet avec autoscaling affiche également les pods exécutés au-delà de `--replicas`, en heures-pods,
ce qu'ils coûtent à ses propres tarifs et si cette plateforme les facture déjà. Un
projet réclamé depuis un agent ne compte que les jours à partir de la réclamation : avant
celle-ci, le projet appartenait à la plateforme.

Un projet existant se lie sans en créer un nouveau :

```bash
rebase cloud projects list
rebase cloud link --project my-app
```

## Déployer

```bash
rebase cloud deploy
```

Une seule commande, et aucune option à mémoriser. Le `rebase.json` d'un scaffold déclare
`runtime: "managed"` pour son backend, et `deploy` lit cette déclaration — il
l'indique au passage (`rebase.json declares runtime: managed — deploying a
bundle`), compile l'application dans `dist-bundle`, téléverse le bundle, l'exécute sur
l'image de runtime publiée et suit le déploiement jusqu'à son état final. Le code
de sortie constitue le verdict, la même ligne fonctionne donc sans intervention humaine dans un pipeline CI.

Elle se termine en indiquant où chaque application répond désormais et si la nouvelle version
y est active :

```text
  ✓ Deployed songbuzz in 1m 12s  (deployment fb3c7442-9937-4179-8d3c-88a106da149d)

    game     static   https://songbuzz.rebase.website      live
    backend  backend  https://songbuzz.rebase.website/api  live

  ✓ Live: the new version answers on every address above.
  Something wrong? `rebase cloud rollback` puts the previous deployment back.
```

« Live » signifie que l'adresse a répondu après le build : le `/health` d'un backend a
renvoyé `ok`, et la page d'une application statique s'est chargée (depuis ce déploiement, lorsque
la plateforme la sert). La vérification attend jusqu'à `--live-timeout` secondes, 60 par
défaut ; `0` l'ignore. Si une application ne répond pas à temps, le déploiement renvoie tout de même
un code de sortie zéro car le déploiement a réussi, et la dernière ligne indique quelle application n'a pas
répondu et pourquoi. Un déploiement échoué se termine plutôt sur une seule ligne, en nommant l'application et la
raison, avec `rebase cloud logs` pour consulter l'intégralité des logs de build.

Les scripts passent `--json` pour obtenir un objet contenant les mêmes informations — `apps`, `hosts`,
`live`, `liveChecks`, `durationMs` et l'identifiant du déploiement. Contrairement au reste de
`rebase cloud`, `deploy` ne bascule pas automatiquement en JSON lorsqu'il est utilisé dans un pipe.

Ce que ce runtime autorise — packages et modules natifs, mémoire et instances,
délais d'expiration et tailles de corps de requête, système de fichiers, secrets, stockage et réseau
sortant — est détaillé sur sa propre page :
[Runtime backend géré](/docs/deployment/managed-runtime/).

Pour livrer un artefact compilé plus tôt — par exemple, un job CI qui compile une fois et
déploie deux fois — pointez vers le répertoire au lieu de recompiler :

```bash
rebase build
rebase cloud deploy --bundle-dir dist-bundle
```

Quitter le runtime géré nécessite sa propre option, `--eject`, et rien d'autre ne le
demande : un build qui déplacerait un projet géré vers une image de conteneur dont il devient
propriétaire est refusé tant que vous ne l'avez pas explicitement demandé. `--force` avait auparavant cette signification, ce qui plaçait
l'action la moins réversible de la CLI sous le même mot que « écraser ce
fichier » ; il s'agit désormais d'une option inconnue plutôt que d'un alias, de sorte qu'un script l'utilisant
s'interrompt.

### La vérification syntaxique avant le téléversement

Les fichiers d'une application statique sont servis exactement tels quels. Lorsque son `build` ne fait que
copier des scripts écrits à la main dans `output`, rien ne les a analysés, et un fichier
contenant une faute de frappe est mis en ligne et empêche la page de se charger. Ainsi, avant tout
téléversement, `deploy` analyse chaque fichier `.js`, `.mjs` et `.cjs` dans le dossier `output`
de chaque application statique, ainsi que chaque balise `<script>` inline dans ses fichiers `.html`. Cela
couvre une application statique déployée seule ainsi que les applications statiques intégrées au
bundle du backend. Une erreur de syntaxe interrompt le déploiement en indiquant le fichier, la ligne et la colonne :

```
✗ A syntax error in the static output, so nothing was deployed:
    web/cloud.js:42:23  Unexpected token
        42 |     return fetch("/api";
Fix it and deploy again, or pass --no-verify to deploy anyway.
```

Avec `--json`, le `code` de l'erreur est `syntax_error`. Les scripts inline qu'un navigateur
n'exécute pas en tant que JavaScript sont ignorés : JSON, import maps, templates et tout
autre `type` non-JavaScript, les `<script src>`, et tout script contenant encore
du balisage de template non rendu tel que `{{ }}`. Un fichier `.js` est validé s'il s'analyse
soit comme un script classique, soit comme un module, car c'est la page qui en décide. Rien
sous `node_modules` n'est lu, pas plus qu'un `--bundle-dir` précompilé.
`--no-verify` ignore cette vérification pour un déploiement.

Suivre l'exécution :

```bash
rebase cloud logs               # the build log
rebase cloud logs --runtime -f  # what the running app prints, live, until Ctrl-C
rebase cloud status             # what the platform thinks the project is doing
```

`status` rapporte `blockedOn` et `nextAction`. Lorsque `blockedOn` vaut `null`, la
plateforme travaille réellement et faire du polling est la bonne chose à faire ; lorsqu'il nomme
un élément, cet élément vous attend.

## Prévisualiser une modification

```bash
rebase cloud deploy --preview
```

Cela compile et téléverse exactement la même chose que `deploy`, mais le sert à une adresse
propre, telle que `https://shop--k3x9ab.rebase.website`. La production continue
de servir ce qu'elle servait auparavant. Le déploiement affiche l'adresse de la prévisualisation lorsque le
build est terminé.

Pour conserver la même adresse d'un déploiement à l'autre, nommez la prévisualisation. Déployer à nouveau
avec le même nom la met à jour :

```bash
rebase cloud deploy --preview-name new-checkout
```

Ce avec quoi communique une prévisualisation dépend de ce que vous avez déployé :

- **`rebase cloud deploy --preview`** prévisualise le backend, avec ses applications statiques
  intégrées, de la même façon que la production les exécute. Il obtient son propre backend sur
  sa **propre base de données vide**, jamais celle de production. Démarrer sur
  la base de données de production lui appliquerait le schéma et les règles d'accès de la prévisualisation.
- **`rebase cloud deploy web --preview`** prévisualiserait une application statique seule,
  ses pages appelant le backend de **production**. Cela nécessite un plan de contrôle
  capable de servir des sites statiques de manière autonome, ce que Rebase Cloud ne fait pas encore : il
  refuse avec `PREVIEW_STATIC_UNSERVED` et ne publie rien. Prévisualisez
  plutôt le backend, qui sert les applications statiques qui y sont intégrées ; un projet sans
  backend géré ne peut pas encore faire l'objet d'une prévisualisation.

Une prévisualisation ne téléverse aucun code source et n'enregistre aucune application ni aucun nom d'hôte, car chacun
de ces éléments modifierait le projet de production. `--source` et `--eject` ne peuvent pas être
combinés avec `--preview`. Chacun construit une image de conteneur pour la production.

```bash
rebase cloud previews                      # name, address, app, backend, expiry
rebase cloud logs --preview new-checkout   # its build log; -f follows a build still running
rebase cloud logs --runtime --preview new-checkout -f  # what its backend prints
rebase cloud previews delete new-checkout  # stops serving it and drops its database
```

`rebase cloud logs` sans `--preview` concerne toujours la production.

La page **Deployments** de la console liste les mêmes prévisualisations, et permet d'ouvrir, d'afficher les
logs de build ou de supprimer chacune d'elles. La création reste une étape en CLI.

Une prévisualisation expire une semaine après son dernier déploiement.

Lorsqu'il se termine, le déploiement vérifie que l'adresse de la prévisualisation répond, comme le fait
un déploiement en production (`--live-timeout <seconds>`, `0` pour ignorer). Le certificat d'une nouvelle
prévisualisation pouvant prendre une minute ou deux, un déploiement réussi peut
indiquer que l'adresse ne répond pas encore.

Une prévisualisation de backend est facturée comme une unité d'application à la taille par défaut (100m de CPU
et 384 MiB de mémoire, au tarif de votre application pour sa région et sa capacité),
au prorata de sa durée d'existence, et apparaît dans le devis mensuel du
projet dans la console. `rebase cloud deploy --preview` affiche la même estimation pour
celle-ci, par mois (`cost` avec `--json`). En démarrer une nécessite une carte enregistrée, tout comme un déploiement en production.
Un premier déploiement qui
échoue avant que quoi que ce soit ne s'exécute est supprimé plutôt que facturé. Un projet peut exécuter
trois prévisualisations de backend simultanément.

Chaque nouvelle adresse de prévisualisation reçoit son propre certificat TLS de Let's Encrypt,
qui autorise un domaine à obtenir 50 nouveaux certificats par semaine, partagés avec tous les sites de production sur celui-ci.
Les prévisualisations peuvent en consommer 20 sur toute période de 7 jours, à l'échelle de la plateforme. Au-delà,
une nouvelle prévisualisation est refusée (`429`, `preview_cert_budget`) avec l'indication du moment où elle pourra
être déployée ; redéployer une prévisualisation existante n'est jamais décompté.

La base de données d'une prévisualisation de backend est une seconde base de données sur le Postgres de **production** :
ses propres données, mais la même instance et le même disque. Elle est limitée à 10
connexions afin que les prévisualisations n'épuisent pas celles de la production, et à 2 Go : une prévisualisation
dont la base de données dépasse cette taille est mise en pause. Son backend s'arrête, son adresse cesse de
répondre, `rebase cloud previews` et la console l'affichent comme `paused` avec le
motif, et les propriétaires et administrateurs du projet sont notifiés (`preview.paused`). Ses
données sont conservées jusqu'à son expiration. Déployez-la à nouveau pour la démarrer (elle est remise en pause
tant que la base de données reste trop volumineuse), ou supprimez-la. Une prévisualisation en pause reste
facturée jusqu'à sa suppression ou son expiration. Supprimez les prévisualisations dont vous n'avez plus besoin. Les extensions installées en production ne sont pas
installées dans la base de données d'une prévisualisation.

Les prévisualisations sont en cours de déploiement progressif. Un plan de contrôle qui ne les prend pas encore en charge refuse
`--preview` avec `previews_unavailable` et ne déploie rien.

## Retour arrière

```bash
rebase cloud deployments
rebase cloud rollback
```

Un retour arrière (rollback) repointe le projet vers ce qu'un déploiement réussi antérieur
avait livré, et ne recompile jamais — l'intérêt d'un rollback étant de livrer un
artefact qui a déjà fonctionné.

Les déploiements éligibles dépendent du mode de déploiement du projet, et les deux types
fonctionnent :

| Mode de déploiement | Ce qui est restauré |
|---|---|
| `rebase cloud deploy` (un build depuis les sources) | L'image publiée par ce build |
| `rebase cloud deploy --bundle` (le runtime de la plateforme) | Le bundle livré par ce déploiement, sur la version de runtime actuellement exécutée par le projet |

Les applications statiques intégrées au bundle du backend (un simple `rebase cloud deploy` sur un
projet avec backend) font partie de ce bundle, elles reviennent donc en arrière avec lui.

Une application statique déployée seule (`rebase cloud deploy <app>`) ne peut pas encore faire l'objet d'un
retour arrière. Son déploiement enregistre l'application publiée, mais aucun bundle, le
plan de contrôle n'a donc rien à partir de quoi la restaurer. La solution consiste à redéployer la dernière
version fonctionnelle, par exemple depuis le commit précédant le commit défaillant. Après un tel
déploiement, `deploy` signale cela au lieu d'orienter vers `rollback`, et `rollback`
sans identifiant refuse plutôt que de redéployer le backend actuellement en service.

Un retour arrière nécessite donc un déploiement ayant enregistré l'un des deux, ce qui implique
un projet ayant été déployé avec succès au moins deux fois. `rebase cloud deployments`
signale ceux qui sont éligibles, et `--json` indique `rollbackable` pour chaque ligne ainsi
que l'élément `image` ou `bundle` qu'il restaurerait.

Deux types de déploiements sont refusés, et la CLI précise lequel : un déploiement qui n'a pas réussi,
et un déploiement antérieur au moment où la plateforme a commencé à enregistrer son artefact. Il n'y a rien à deviner
dans les deux cas — faire des suppositions livrerait ce qui a été compilé ou téléversé le plus
récemment tout en prétendant restaurer celui-ci — déployez donc plutôt la version souhaitée.

Chaque déploiement réussi se termine en indiquant le moyen de revenir en arrière (`rebase cloud rollback`),
afin qu'il soit bien visible au moment où une version défectueuse est constatée.

Un retour arrière ajoute un nouveau déploiement plutôt que de remonter l'historique, et attend que
la version restaurée soit en service avant d'indiquer le succès. Suivez-le avec
`rebase cloud logs -f`.

## Restaurer la base de données à un instant précis

Une base de données gérée peut être récupérée à n'importe quelle minute de sa fenêtre de rétention,
depuis **Database → Backups** dans la console ou avec la CLI :
`rebase cloud db pitr status | restore --target <ISO> | cutover | discard`.
Cela se fait en deux étapes. D'abord, une copie récupérée est préparée aux côtés de la base de données active ;
votre application continue de fonctionner sur la base active, et le stockage de la copie est facturé jusqu'à
ce que vous effectuiez le basculement ou que vous la rejetiez.
Ensuite, une fois la copie prête, le basculement redirige l'application vers celle-ci et la redémarre.
Tout ce qui a été écrit après l'heure cible ne figure pas dans la copie. La base de données d'origine
est conservée comme recours de secours et continue de facturer le stockage ; y revenir,
la supprimer ou effectuer une seconde restauration nécessite de contacter le support. Seul un propriétaire ou un administrateur
peut préparer, basculer ou rejeter, et la console demande le nom du projet
avant d'effectuer le basculement.

## Sécuriser votre compte

Votre compte console peut accéder aux bases de données de production, aux secrets et à la facturation,
protégez-le donc en conséquence. Ouvrez **Account security** depuis le menu sous votre avatar
dans la console (ou rendez-vous sur `/account`). Cette page vous est propre et n'appartient pas
à une organisation : ce que vous y configurez s'applique à toutes les organisations dont vous faites partie.

- **Validation en deux étapes.** Activez-la avec n'importe quelle application d'authentification (1Password,
  Google Authenticator, Authy). La page affiche une clé de configuration à ajouter à l'application, ou un
  lien qui ouvre l'application avec la clé préremplie sur un téléphone, puis demande le
  code à 6 chiffres affiché par l'application. Dès lors, chaque connexion requiert un code,
  que vous vous connectiez avec un mot de passe, Google ou GitHub.
- **Codes de secours.** L'activer vous donne dix codes à usage unique, affichés une seule fois.
  Chacun d'eux vous permet de vous connecter à la place du code de l'application si vous perdez votre
  téléphone, enregistrez-les donc avant de fermer la boîte de dialogue. **New recovery codes**
  les remplace, et les anciens cessent de fonctionner. Désactiver la validation en deux étapes
  et générer de nouveaux codes demandent tous deux un code au préalable.
- **Mot de passe.** Le modifier vous déconnecte de tous les autres appareils. Un compte
  créé avec Google, GitHub ou LinkedIn n'a pas de mot de passe ; la page propose de
  vous envoyer par e-mail un lien pour en définir un.
- **Appareils connectés.** Chaque navigateur et terminal connecté à votre compte,
  avec son adresse et la date de connexion. Déconnectez tout appareil que vous ne
  reconnaissez pas, ou tous à la fois.

Les [jetons d'accès](/docs/deployment/cloud-agents/#ci-and-agents) ne sont pas des sessions et ne demandent pas de second
facteur, la CI continue donc de déployer après leur activation. Révoquez un jeton auquel vous ne faites plus
confiance sous **Settings → Access tokens**.

## Inviter votre équipe

**Members → Invite member** génère un lien à copier (envoyé par e-mail lorsque ce plan de contrôle
envoie des e-mails) valable une seule fois, pendant 7 jours, pour un compte ayant vérifié cette
adresse ; personne ne rejoint l'équipe tant que l'invitation n'a pas été acceptée. Invitez un administrateur ou un membre, et faites-en
un propriétaire une fois qu'il a rejoint l'organisation. Les propriétaires et administrateurs peuvent voir, renvoyer ou révoquer l'invitation dans
**Pending invitations** ; depuis un terminal, [`rebase cloud orgs members invite`](/docs/cli/cloud/#organizations).

## Voir qui a fait quoi

La page **Activity** de la console et `rebase cloud activity` montrent
aux propriétaires et administrateurs de l'organisation qui a déployé, défini ou révélé une variable
d'environnement (par son nom, jamais par sa valeur), modifié un domaine, restauré une sauvegarde,
redimensionné, arrêté ou supprimé un projet, changé le rôle d'un membre ou créé un
jeton, et à quel moment. Les **Settings** d'un projet pointent vers ses propres entrées ; une entrée
concernant un projet supprimé reste conservée. Un script peut la lire avec un jeton créé avec
`--can audit` sur l'organisation. Les entrées sont conservées pendant un an. Les filtres sont décrits dans
[`rebase cloud`](/docs/cli/cloud/#organizations).

## CI et agents

Un job CI ou un agent ne devrait pas transporter votre mot de passe. Attribuez-lui un jeton restreint à
quelques actions sur un seul projet, créé depuis un terminal connecté avec
`rebase cloud tokens create --project shop --can deploy,logs`, et définissez-le comme
`REBASE_TOKEN`. La facturation, le journal d'activité et les paramètres de notification
d'une organisation sont des capacités à part entière (`--can billing`, `audit`,
`notifications`) qu'un jeton ne détient que si elles sont expressément demandées. Les capacités, un
workflow GitHub Actions et ce qui reste réservé à une personne connectée sont détaillés dans
[CI et agents](/docs/deployment/cloud-agents/#ci-and-agents).

## Un backend sans compte

`rebase cloud init --claim` attribue à une application un backend actif avant même que quiconque ne soit
inscrit, et affiche une URL de réclamation permettant à la personne de le conserver ; un projet que personne ne réclame
sous 72 heures est supprimé. Ce que le jeton du projet non réclamé peut faire, le
`REBASE_API_TOKEN` qu'il écrit et les changements apportés par la réclamation sont détaillés dans
[Un backend sans compte](/docs/deployment/cloud-agents/#a-backend-with-no-account).

## Compute et coûts associés

Le prix d'un projet est calculé à partir de ce qu'il réserve, et non selon une offre par paliers. `compute` affiche
chaque curseur de configuration ainsi que le devis détaillé du plan de contrôle pour ceux-ci. (`rebase cloud
resources` est une commande différente : les bases de données et buckets déclarés par le code,
et si chacun est provisionné — voir la [référence CLI](/docs/cli/cloud/).)

```bash
rebase cloud compute
rebase cloud compute set --cpu 500m --memory 2Gi
```

| Paramètre | Unité et signification |
|---|---|
| `--cpu`, `--memory` | Requête de l'application par instance, par ex. `500m` et `2Gi`. Vide correspond à la valeur par défaut de la plateforme — `100m` et `384Mi`, avec burst jusqu'à 2 CPU et `2Gi` |
| `--replicas` | Instances existant en permanence : le plancher de l'autoscaler, et ce que facture mensuellement l'abonnement du projet |
| `--autoscale-max` | 1–16. Le plafond pouvant être atteint. Les instances ajoutées par l'autoscaler au-delà de `--replicas` sont mesurées en secondes-pod aux mêmes tarifs, et facturées uniquement là où la plateforme a activé cette option ; **Usage this month** l'indique. `--no-autoscale` le désactive |
| `--autoscale-cpu-target` | 10–95. L'utilisation CPU visée par l'autoscaler, mesurée par rapport à la requête plutôt qu'à la limite. Vide correspond à 70 |
| `--spot` | `true` ou `false`. Capacité préemptible : moins chère, et redémarrée sans préavis |
| `--db-instances` | 1–3. `1` correspond à une instance unique sans basculement ; `2` ajoute un standby automatique |
| `--db-cpu`, `--db-memory` | Par instance de base de données. Vide correspond à `160m` et `1Gi` |

Un paramètre laissé vide n'est pas identique à un paramètre fixé au même nombre : un paramètre vide
suit les valeurs par défaut de la plateforme et évolue avec elles.

Rien n'est validé par la CLI, de manière délibérée — les limites dépendent du cluster sur lequel
s'exécute un projet, et elles varient selon les fournisseurs. Le plan de contrôle refuse une
valeur qu'il ne peut pas honorer et nomme le champ concerné. Exécutez `rebase cloud compute` pour voir
le montant en €/mois avant et après ; une modification s'applique immédiatement, au prorata à compter d'aujourd'hui,
sauf si elle nécessite un redémarrage de la base de données, auquel cas elle attend une fenêtre de maintenance.

## Le reste des commandes

| Groupe de commandes | Ce qu'il couvre |
|---|---|
| `login`, `logout`, `whoami` | Votre session |
| `tokens` | Jetons pour la CI et les agents, chacun restreint à un projet. Voir [CI et agents](/docs/deployment/cloud-agents/#ci-and-agents) |
| `link`, `unlink`, `use`, `open` | Liaison de ce répertoire à un projet, sélection d'une organisation, ouverture de la console |
| `init`, `claim` | Avec `--claim` : un backend actif sans compte, et un lien pour le réclamer ; `claim` réaffiche ce lien. Voir [Un backend sans compte](/docs/deployment/cloud-agents/#a-backend-with-no-account) |
| `projects` | Créer, lister, inspecter, supprimer |
| `deploy`, `logs`, `deployments`, `rollback`, `cancel` | Déploiement et suivi |
| `previews` | Builds servis sur leur propre adresse par `deploy --preview`, et leur suppression. Voir [Prévisualiser une modification](#prévisualiser-une-modification) |
| `start`, `stop`, `restart` | Mettre un projet en pause et le réactiver. Un projet arrêté conserve son abonnement, à moins que la plateforme ne facture aux projets arrêtés uniquement le stockage et les frais de plateforme ; la ligne **Billing** de la console le précise si c'est le cas |
| `status`, `metrics`, `debug` | Ce qu'il fait, et pourquoi il ne le fait pas |
| `cron` | Les tâches cron de l'application déployée et l'enregistrement de leurs exécutions, lus avec votre connexion `rebase cloud`. En lecture seule |
| `env` | Variables d'environnement. `list` n'affiche jamais les valeurs ; `--secret` est en écriture seule |
| `app-key` | La clé inscrite dans `.env` par `init --claim` en tant que `REBASE_API_TOKEN`, transférée lors de la réclamation ; `rotate` la remplace et révoque l'ancienne. Propriétaires et administrateurs |
| `service-key` | `REBASE_SERVICE_KEY`, droits admin sur l'API propre à l'application : date de sa dernière rotation ; `rotate` en attribue une nouvelle à l'application. Propriétaires et administrateurs |
| `domains` | Domaines personnalisés, enregistrements DNS à ajouter et vérification. Un projet peut répondre sur plusieurs domaines, chacun vérifié individuellement ; `verify` et `remove` prennent le domaine à traiter, qui ne peut être omis que s'il n'y en a qu'un seul (pour `verify`, un seul encore en attente). `list --json` renvoie `{ projectId, tenantHost, domains: [...] }` |
| `db` | Rattacher ou créer une base de données, s'y connecter depuis votre machine, sauvegardes, restauration et récupération à un instant précis (PITR) |
| `guests` | <span class="since-badge" data-since="0.27">Since 0.27</span> Les utilisateurs invités laissés par la connexion anonyme : les compter, en supprimer un, purger ceux qui n'ont pas été vus depuis longtemps. Voir [Guests](/docs/cli/cloud/#guests). Propriétaires et administrateurs |
| `extensions` | La liste autorisée des extensions Postgres |
| `storage` | Le bucket du projet |
| `resources` | Les bases de données et buckets détenus par la plateforme, par rapport à ce que le code déclare |
| `compute` | Ce que ce projet réserve, ce qu'il coûte et comment le modifier |
| `usage` | Requêtes consommées ce mois-ci par rapport au forfait inclus, et dépassement actuel, tel que comptabilisé sur la facture. `usage org` liste tous les projets de l'organisation |
| `clusters` | Les clusters sur lesquels s'exécutent les tenants. Administrateurs de la plateforme uniquement |
| `settings`, `orgs`, `billing` | Paramètres du projet, organisations, leurs membres et invitations, paiement |
| `activity` | Le journal d'audit de l'organisation : qui a déployé, modifié une variable d'environnement (par son nom), un domaine, une sauvegarde, un membre ou un jeton. Propriétaires et administrateurs. Voir [Voir qui a fait quoi](#voir-qui-a-fait-quoi) |
| `notifications`, `webhooks` | Où les événements du projet sont envoyés par POST : Slack, Discord ou toute URL https ([Cloud notifications](/docs/deployment/cloud-notifications/)). `webhooks` est retiré et renvoie 1 avec le code `command_retired` |

Chaque groupe de ce tableau répond à `--help` avec une page qui lui est propre — une ligne d'utilisation,
ses options et des exemples — et `--help` n'exécute jamais la commande. Un test conserve
l'index de ces pages, de sorte qu'un groupe ajouté sans page fait échouer le build plutôt que de
renvoyer la table des matières. `verify:docs` vérifie la conformité de la table elle-même avec
cet index : chaque groupe distribué par la CLI apparaît ici exactement une fois, de sorte qu'un groupe
ajouté sans ligne dédiée fait également échouer le build.

Utilisé dans un pipe, `--help` répond en JSON à la place : la même ligne d'utilisation, les mêmes options et exemples
sous forme de structure facile à lire plutôt que soixante lignes de séquences d'échappement de terminal.

## Ce que la version bêta n'inclut pas

Exprimé clairement, car le découvrir plus tard est bien pire :

- **Pas de choix de région.** Tout fonctionne dans une seule région aujourd'hui. Le modèle de
  placement existe dans la plateforme, mais un projet ne peut pas choisir de région.
  `projects create --provider` et `--region` ne sont pas l'exception qu'ils paraissent
  être : ils enregistrent simplement à quelle cible de déploiement enregistrée du plan de contrôle un
  projet appartient, et il n'y en a qu'une seule, donc les deux prennent cette valeur par défaut et aucun ne déplace un
  projet ailleurs. `rebase cloud projects create --help` indique la même chose.
- **Pas de libre-service.** L'accès est accordé par vagues ; il n'y a pas d'inscription avec paiement immédiat.
- **Aucun SLA publié**, et pas de certification SOC 2. Si vous avez besoin de l'un ou de l'autre, précisez-le
  lors de votre demande d'accès plutôt que de le supposer.
- **Pas de déploiements par branche**, et aucune GitHub App officielle. Les deploy hooks — des URL
  secrètes vers lesquelles vous pointez un webhook de dépôt — constituent l'automatisation prise en charge. Les [déploiements de
  prévisualisation](#prévisualiser-une-modification) sont en cours de déploiement progressif et sont initiés depuis la CLI.
- **Les jetons agissent en tant que personne.** Un [jeton](/docs/deployment/cloud-agents/#ci-and-agents) est généré par un compte
  et agit en son nom ; il n'existe pas encore d'identité machine appartenant à l'organisation. Si vous
  vous connectez plutôt depuis la CI, transmettez `REBASE_CLOUD_EMAIL` et `REBASE_CLOUD_PASSWORD`
  depuis un gestionnaire de secrets — `--password` place le mot de passe dans l'historique de votre shell et
  dans la table des processus, et le signale avant de vous connecter. Si le fichier `.rebase/cloud.json`
  du dépôt mentionne un plan de contrôle autre que celui de la plateforme, transmettez-le
  également via `--url` : sans terminal, `login` refuse d'envoyer un mot de passe à un
  hôte qui n'a été spécifié que par le fichier extrait.
- **Aucun endpoint public de base de données.** Une base de données gérée n'est pas exposée à
  Internet, l'hôte affiché par la console est donc l'adresse que votre backend utilise pour la joindre et
  ne résout rien sur votre machine. `rebase cloud db connect` ouvre un port local
  correspondant à cette base de données, via un tunnel à travers le plan de contrôle, aussi longtemps
  que vous le laissez ouvert — mais il n'existe aucun nom d'hôte permanent auquel un service
  tiers pourrait se connecter. Ce tunnel, ainsi que le mot de passe révélé par
  `rebase cloud db info --reveal`, nécessitent tous deux le rôle de propriétaire ou d'administrateur
  de l'organisation : le même que celui exigé par l'éditeur SQL de Studio, car tous trois aboutissent à
  une session sur vos données de production.
- **Déployer revient à exécuter du code avec les secrets de production.** L'environnement
  de l'application contient `REBASE_SERVICE_KEY` (droits admin sur sa propre API),
  `DATABASE_URL` et `JWT_SECRET` ; le code déployé par un membre peut donc les lire,
  même si seuls les propriétaires et administrateurs peuvent les afficher dans la console. N'invitez
  comme membre qu'une personne à qui vous feriez confiance avec ces valeurs.
- **La clé de service peut être remplacée.** Les **Settings** du projet
  (ou `rebase cloud service-key rotate`) génèrent une nouvelle `REBASE_SERVICE_KEY`
  et redémarrent l'application avec celle-ci. L'ancienne clé fonctionne jusqu'à la fin du
  redémarrage, et plus du tout après, de sorte que tout ce qui l'aurait copiée est refusé à partir de
  ce moment. La réclamation d'un projet effectue la même opération.

## S'auto-héberger à la place

Rien ici n'est un enfermement propriétaire. Le [guide d'auto-hébergement](/docs/deployment/self-hosting/)
exécute la même image et le même bundle avec `docker compose`, et le
[guide Kubernetes](/docs/deployment/kubernetes/) restitue la même topologie à partir
du Helm chart.
