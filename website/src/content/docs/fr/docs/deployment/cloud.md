---
sourceHash: a66e695d7d7fc2a9
title: Rebase Cloud
sidebar_label: Rebase Cloud
description: Rebase Cloud est le même Rebase, opéré pour vous. Ce que c'est, comment lier et déployer un projet, et ce que la bêta privée n'inclut pas encore.
---

Rebase Cloud exécute le même Rebase open source que vous auto-hébergeriez — la même
image `rebasepro/server` publiée, le même bundle, le même Postgres. La
différence réside dans qui l'opère.

:::note[Bêta privée]
Rebase Cloud est en **bêta privée**. Il fait tourner de véritables tenants aujourd'hui et s'ouvre par
vagues. [Demandez l'accès](https://rebase.pro/pricing).

Il n'est pas en libre-service, donc les commandes ci-dessous nécessitent un compte ayant été accepté.
Tout le reste sur ce site fonctionne sans compte.
:::

## Ce que c'est

Un **projet** Cloud, ce sont trois éléments que la plateforme opère pour vous :

| | Ce que vous obtenez |
|---|---|
| **App** | Votre bundle, s'exécutant sur l'image d'exécution publiée. Les déploiements sont un téléversement de bundle, pas un build de conteneur |
| **Database** | Un PostgreSQL managé, avec des sauvegardes automatisées et une récupération à un point dans le temps (PITR) |
| **Storage** | Votre propre bucket, si votre projet utilise le stockage de fichiers |

Chacun est provisionné lors de votre premier déploiement, et chacun est facturé en fonction de ce qu'il
réserve plutôt que par utilisateur.

**Rien ne change dans votre projet pour y tourner.** Le même dépôt
s'auto-héberge avec `docker compose`, et la porte de sortie est bien réelle : `rebase build`
produit un bundle qui démarre partout où l'image d'exécution tourne.

## Lier un projet

Depuis le répertoire d'un projet :

```bash
rebase cloud login
rebase cloud billing setup
rebase cloud projects create --name "My app" --subdomain my-app --link
```

`projects create` ne prend aucun argument positionnel. Le nom et le sous-domaine sont
des options (flags), et tous deux sont obligatoires — dans un terminal, ils vous seront demandés, et une
exécution headless omettant l'un d'eux se terminera avec l'erreur `input_required` plutôt que d'en inventer
un. **Le sous-domaine n'est pas modifiable par la suite :** c'est l'hôte
`<slug>.rebase.website` sur lequel le projet répond, choisissez-le donc avec soin.

`--link` associe ce répertoire au projet lors du même appel, évitant ainsi une
étape `link` distincte. Cela écrit `.rebase/cloud.json`, qui enregistre l'identifiant du projet
et son slug. Ce fichier n'est pas un secret et ne contient pas vos identifiants — ceux-ci résident
dans `~/.rebase/credentials.json`, écrit par `login`.

Il est toutefois commité avec le code, ce qui permet à un dépôt cloné d'indiquer n'importe quel
plan de contrôle. Lorsque l'hôte provient uniquement de ce fichier et qu'il ne s'agit ni de celui
de la plateforme ni d'un hôte auquel vous vous êtes déjà connecté auparavant, `login` le nomme et vous
demande confirmation avant d'y envoyer votre e-mail et votre mot de passe. Sans terminal, ou avec
`--json`, la commande refuse avec `unknown_control_plane` ; passez `--url <host>` (ou définissez
`REBASE_CLOUD_URL`) pour vous y connecter délibérément.

**Inscrit avec Google, GitHub ou LinkedIn ?** Votre compte ne possède pas de mot de passe,
connectez-vous donc avec un code à la place :

```bash
rebase cloud login --code --email me@example.com
```

Le plan de contrôle vous envoie par e-mail un code à 6 chiffres, valable dix minutes, que vous
saisissez à l'invite de commande. Exécuté simplement dans un terminal, `rebase cloud login` vous
demande si vous souhaitez utiliser votre mot de passe ou un code. Les codes nécessitent que le plan de contrôle
puisse envoyer des e-mails ; si ce n'est pas le cas, `--code` le signale et quitte avec `otp_unavailable`.

Si vous avez activé l'authentification à deux facteurs, `login` demande ensuite le code de
votre application d'authentification, ou l'un de vos codes de récupération, quelle que soit la méthode
de connexion utilisée. Ni un code de connexion ni un second facteur ne peuvent être saisis sans terminal.
Pour un script, créez un jeton d'accès dans la console (**Settings → Access
tokens**) et définissez `REBASE_TOKEN` ; consultez [CI et agents](/docs/deployment/cloud-agents/#ci-and-agents).

Un mot de passe incorrect renvoie `invalid_credentials` avec les deux mêmes méthodes d'accès,
la cause habituelle étant un compte qui n'en a jamais eu.

`billing setup` associe une carte bancaire à l'organisation, une seule fois. C'est placé en premier
dans la séquence à dessein : le premier déploiement d'un projet est refusé sans carte, et
s'en rendre compte une fois le téléversement du bundle terminé serait bien plus frustrant.

Après cela, la page **Billing** de la console liste les factures de l'organisation,
chacune accompagnée de la page hébergée Stripe et du PDF, et affiche un aperçu de la prochaine facture
de chaque projet. `rebase cloud billing invoices` et `rebase cloud billing upcoming`
affichent la même chose. Les deux s'adressent aux propriétaires et administrateurs de l'organisation. Lorsque
la plateforme le propose, **Manage billing** ouvre le portail client Stripe pour gérer la
carte, les coordonnées de facturation et les anciennes factures.

Avec une carte déjà enregistrée, la création d'un autre projet dans la console ne requiert
aucun paiement supplémentaire : le projet est facturé sur cette carte et déployé. Si la carte
est refusée ou que la banque demande une confirmation de paiement, la console vous redirige vers
**Billing**, où **Fix your card** permet d'enregistrer une autre carte et **Complete the
payment** ouvre la facture Stripe.

La consommation d'un projet est visible sur sa vue d'ensemble, sous **Usage this month**, et
pour tous les projets en même temps sur la page **Billing** : les requêtes par rapport au
quota inclus (la barre devient orange à 80 %), les erreurs 5xx, le dépassement actuel
et la tendance pour le reste du mois à ce rythme. Le dépassement est calculé par
le même code qui le transmet à Stripe, c'est donc ce qui figurera sur la facture ; il
apparaît sur la facture du mois suivant. `rebase cloud usage` affiche la
même chose, et `rebase cloud usage org` pour l'ensemble de l'organisation. N'importe quel membre
peut le consulter. Les chiffres précisent ce qu'ils ne mesurent pas encore : le stockage objet n'est pas mesuré,
donc aucun dépassement de stockage n'est facturé ; lorsqu'un projet exécute deux pods applicatifs ou plus,
ses requêtes ne sont pas comptabilisées ; et un jour avec des échantillons manqués sous-estime le total. Un
projet avec autoscaling affiche également les pods exécutés au-delà de `--replicas`, en heures-pod,
leur coût à ses propres tarifs et si cette plateforme les facture déjà. Un
projet réclamé depuis un agent ne compte que les jours à partir de la réclamation :
avant cela, le projet appartenait à la plateforme.

Un projet existant peut être lié sans en créer un nouveau :

```bash
rebase cloud projects list
rebase cloud link --project my-app
```

## Déployer

```bash
rebase cloud deploy
```

Une seule commande, et aucune option à retenir. Le `rebase.json` généré déclare
`runtime: "managed"` pour son backend, et `deploy` lit cette déclaration — il
l'indique au passage (`rebase.json declares runtime: managed — deploying a
bundle`), compile l'application dans `dist-bundle`, téléverse le bundle, l'exécute sur
l'image d'exécution publiée et suit le déploiement jusqu'à un état terminal. Le code
de sortie fait foi, donc la même ligne fonctionne sans surveillance en CI.

La commande se termine en indiquant où chaque application répond désormais et si la nouvelle version
y est en ligne :

```text
  ✓ Deployed songbuzz in 1m 12s  (deployment fb3c7442-9937-4179-8d3c-88a106da149d)

    game     static   https://songbuzz.rebase.website      live
    backend  backend  https://songbuzz.rebase.website/api  live

  ✓ Live: the new version answers on every address above.
  Something wrong? `rebase cloud rollback` puts the previous deployment back.
```

« En ligne » (Live) signifie que l'adresse a répondu après le build : le `/health` d'un backend
a renvoyé `ok`, et la page d'une application statique s'est chargée (depuis ce déploiement, lorsque la
plateforme la sert). Cette vérification attend jusqu'à `--live-timeout` secondes, 60 par
défaut ; `0` l'ignore. Si une application ne répond pas à temps, le déploiement se termine tout de même
avec un code zéro, car le déploiement a réussi, et la dernière ligne indique quelle application n'a pas
répondu et pourquoi. Un déploiement échoué se termine sur une seule ligne à la place, nommant l'application et la
raison, avec `rebase cloud logs` pour consulter l'intégralité du journal de build.

Les scripts peuvent passer `--json` pour obtenir un objet unique contenant les mêmes informations — `apps`, `hosts`,
`live`, `liveChecks`, `durationMs` et l'identifiant de déploiement. Contrairement au reste de
`rebase cloud`, `deploy` ne bascule pas automatiquement en JSON lorsqu'il est utilisé dans un pipe.

Ce que cet environnement d'exécution autorise — paquets et modules natifs, mémoire et instances,
délais d'expiration et tailles de corps, système de fichiers, secrets, stockage et réseau
sortant — se trouve sur sa propre page :
[Environnement d'exécution backend managé](/docs/deployment/managed-runtime/).

Pour déployer un artefact compilé plus tôt — par exemple un job CI qui compile une fois et
déploie deux fois —, pointez vers le répertoire au lieu de recompiler :

```bash
rebase build
rebase cloud deploy --bundle-dir dist-bundle
```

Quitter l'environnement d'exécution managé se fait avec son propre flag, `--eject`, et rien d'autre
ne le déclenche : un build qui ferait passer un projet managé vers une image de conteneur dont il devient
propriétaire est refusé tant que vous ne l'avez pas explicitement demandé. `--force` avait auparavant cette signification, ce qui plaçait
l'action la moins réversible de la CLI sous le même mot que « écraser ce
fichier » ; il s'agit désormais d'une option inconnue plutôt que d'un alias, de sorte qu'un script l'utilisant
s'arrête plutôt que de s'exécuter.

### La vérification syntaxique avant le téléversement

Les fichiers d'une application statique sont servis exactement tels quels. Lorsque son `build`
se contente de copier des scripts écrits à la main dans `output`, rien ne les a analysés, et un fichier
contenant une coquille peut passer en production et empêcher le chargement de la page. Par conséquent, avant tout
téléversement, `deploy` analyse chaque fichier `.js`, `.mjs` et `.cjs` dans le dossier `output` de chaque
application statique, ainsi que chaque balise `<script>` inline dans ses fichiers `.html`. Cela
couvre aussi bien une application statique déployée seule que les applications statiques intégrées au
bundle du backend. Une erreur de syntaxe interrompt le déploiement en indiquant le fichier, la ligne et la colonne :

```
✗ A syntax error in the static output, so nothing was deployed:
    web/cloud.js:42:23  Unexpected token
        42 |     return fetch("/api";
Fix it and deploy again, or pass --no-verify to deploy anyway.
```

Avec `--json`, le `code` de l'erreur est `syntax_error`. Les scripts inline qu'un navigateur
n'exécute pas comme du JavaScript sont ignorés : JSON, import maps, modèles (templates) et tout
autre `type` non-JavaScript, un `<script src>`, ainsi qu'un script contenant encore des balises
de template non rendues comme `{{ }}`. Un fichier `.js` est accepté s'il est analysé avec succès soit comme
script classique, soit comme module, car c'est la page qui en décide. Rien dans `node_modules`
n'est lu, pas plus qu'un `--bundle-dir` pré-compilé.
`--no-verify` permet d'ignorer la vérification pour un déploiement.

Pour surveiller :

```bash
rebase cloud logs               # the build log
rebase cloud logs --runtime -f  # what the running app prints, live, until Ctrl-C
rebase cloud status             # what the platform thinks the project is doing
```

`status` indique `blockedOn` et `nextAction`. Lorsque `blockedOn` est `null`, la
plateforme travaille activement et scruter (polling) est la bonne chose à faire ; lorsqu'il désigne
quelque chose, cet élément attend votre intervention.

## Prévisualiser une modification

```bash
rebase cloud deploy --preview
```

Cette commande compile et téléverse exactement la même chose que `deploy`, mais le sert sur une adresse
dédiée, telle que `https://shop--k3x9ab.rebase.website`. La production continue de
servir ce qu'elle servait auparavant. Le déploiement affiche l'adresse de la prévisualisation lorsque le
build est terminé.

Pour conserver la même adresse d'un déploiement à l'autre, nommez la prévisualisation. Déployer à nouveau
sous le même nom la met à jour :

```bash
rebase cloud deploy --preview-name new-checkout
```

Ce avec quoi une prévisualisation communique dépend de ce que vous avez déployé :

- **`rebase cloud deploy --preview`** prévisualise le backend, avec ses applications statiques
  intégrées, de la même manière que la production les exécute. Il obtient son propre backend sur
  une **propre base de données vide**, jamais celle de production. Démarrer sur la
  base de données de production lui appliquerait le schéma et les règles d'accès de la prévisualisation.
- **`rebase cloud deploy web --preview`** prévisualiserait une seule application statique isolée,
  ses pages appelant le backend de **production**. Cela nécessite un plan de contrôle
  qui serve des sites statiques de manière autonome, ce que Rebase Cloud ne fait pas encore : il
  refuse avec `PREVIEW_STATIC_UNSERVED` et ne publie rien. Prévisualisez le
  backend à la place, qui sert les applications statiques qui y sont intégrées ; un projet
  sans backend managé ne peut pas encore être prévisualisé.

Une prévisualisation ne téléverse aucun code source et n'enregistre aucune application ni nom d'hôte, car chacun
de ces éléments modifierait le projet de production. `--source` et `--eject` ne peuvent pas être
combinés avec `--preview`. Chacun construit une image de conteneur pour la production.

```bash
rebase cloud previews                      # name, address, app, backend, expiry
rebase cloud logs --preview new-checkout   # its build log; -f follows a build still running
rebase cloud logs --runtime --preview new-checkout -f  # what its backend prints
rebase cloud previews delete new-checkout  # stops serving it and drops its database
```

`rebase cloud logs` sans `--preview` concerne toujours la production.

La page **Deployments** de la console liste les mêmes prévisualisations, et permet d'ouvrir, d'afficher le
journal de build ou de supprimer chacune d'elles. La création reste une étape de la CLI.

Une prévisualisation expire une semaine après son dernier déploiement.

Lorsqu'il se termine, le déploiement vérifie que l'adresse de la prévisualisation répond, tout comme un
déploiement en production (`--live-timeout <seconds>`, `0` pour ignorer). Le certificat d'une nouvelle
prévisualisation peut prendre une minute ou deux à être délivré, de sorte qu'un déploiement réussi peut
indiquer que l'adresse ne répond pas encore.

Une prévisualisation de backend est facturée comme une unité d'application à la taille par défaut (100m de CPU
et 384 MiB de mémoire, au tarif de votre application pour sa région et sa capacité),
au prorata de sa durée d'existence, et apparaît dans l'estimation mensuelle du
projet dans la console. `rebase cloud deploy --preview` affiche la même estimation pour
celle-ci, par mois (`cost` sous `--json`). En démarrer une nécessite une carte enregistrée, comme pour un déploiement de production.
Un premier déploiement qui
échoue avant que quoi que ce soit ne s'exécute est supprimé plutôt que facturé. Un projet peut exécuter
trois prévisualisations de backend simultanément.

Chaque nouvelle adresse de prévisualisation reçoit son propre certificat TLS de Let's Encrypt,
qui autorise un domaine à émettre 50 nouveaux certificats par semaine, partagés avec tous les sites de production hébergés dessus.
Les prévisualisations peuvent en consommer 20 sur une période glissante de 7 jours, à l'échelle de toute la plateforme. Au-delà,
une nouvelle prévisualisation est refusée (`429`, `preview_cert_budget`) en indiquant le moment où elle pourra
être déployée ; redéployer une prévisualisation déjà existante n'est jamais décompté.

La base de données d'une prévisualisation de backend est une seconde base de données sur l'instance Postgres de **production** :
ses propres données, mais la même instance et le même disque. Elle est limitée à 10
connexions, afin que les prévisualisations ne s'accaparent pas celles de la production, et à 2 Go : une prévisualisation
dont la base dépasse cette taille est mise en pause. Son backend s'arrête, son adresse ne répond
plus, `rebase cloud previews` et la console l'affichent comme `paused` avec
la raison, et les propriétaires et administrateurs du projet sont notifiés (`preview.paused`). Ses
données sont conservées jusqu'à son expiration. Déployez-la à nouveau pour la redémarrer (elle sera remise en pause
tant que la base de données reste trop volumineuse), ou supprimez-la. Une prévisualisation en pause continue d'être
facturée jusqu'à sa suppression ou son expiration. Supprimez les prévisualisations dont vous n'avez plus besoin. Les extensions installées en production ne sont pas
installées dans la base de données d'une prévisualisation.

Les prévisualisations sont en cours de déploiement progressif. Un plan de contrôle qui ne les prend pas encore en charge refuse
`--preview` avec `previews_unavailable` et ne déploie rien.

## Rollback

```bash
rebase cloud deployments
rebase cloud rollback
```

Un rollback redirige le projet vers ce qu'un déploiement réussi précédent a
livré, sans jamais recompiler — tout l'intérêt d'un rollback étant de livrer un
artefact qui a déjà fonctionné.

Les déploiements éligibles dépendent du mode de déploiement du projet, et les deux types
fonctionnent :

| Mode de déploiement | Ce qui est restauré |
|---|---|
| `rebase cloud deploy` (un build depuis les sources) | L'image publiée par ce build |
| `rebase cloud deploy --bundle` (l'environnement d'exécution de la plateforme) | Le bundle livré par ce déploiement, sur la version du runtime que le projet utilise actuellement |

Les applications statiques intégrées au bundle du backend (un simple `rebase cloud deploy` sur un
projet avec un backend) font partie de ce bundle, elles reviennent donc en arrière avec lui.

Une application statique déployée isolément (`rebase cloud deploy <app>`) ne peut pas encore
faire l'objet d'un rollback. Son déploiement enregistre quelle application a été publiée, mais aucun bundle, donc le
plan de contrôle n'a rien à partir de quoi la restaurer. La solution consiste à redéployer la dernière version
valide, par exemple à partir du commit précédant l'erreur. Après un tel
déploiement, `deploy` indique ceci au lieu de renvoyer vers `rollback`, et `rollback`
sans identifiant refuse de s'exécuter plutôt que de redéployer le backend actif.

Un rollback nécessite donc un déploiement ayant enregistré l'un des deux, ce qui implique un
projet ayant été déployé avec succès au moins deux fois. `rebase cloud deployments`
indique ceux qui sont éligibles, et `--json` signale `rollbackable` par ligne ainsi
que l'`image` ou le `bundle` qu'il restaurerait.

Deux types de déploiements sont refusés, et la CLI précise lequel : un qui n'a pas abouti,
et un antérieur à l'époque où la plateforme enregistrait ses artefacts. Il n'y a rien à deviner
dans les deux cas — deviner reviendrait à livrer ce qui a été compilé ou téléversé le
plus récemment tout en prétendant restaurer celui-ci — déployez donc plutôt la version souhaitée.

Chaque déploiement réussi se termine en indiquant le moyen de revenir en arrière (`rebase cloud rollback`),
afin qu'il soit directement sous vos yeux dès qu'une mauvaise version est constatée.

Un rollback ajoute un nouveau déploiement plutôt que de réécrire l'historique, et attend que
la version restaurée réponde avant de confirmer le succès. Suivez-le avec
`rebase cloud logs -f`.

## Restaurer la base de données à un point dans le temps (PITR)

Une base de données managée peut être restaurée à n'importe quelle minute comprise dans sa fenêtre de rétention,
depuis **Database → Backups** dans la console ou avec la CLI :
`rebase cloud db pitr status | restore --target <ISO> | cutover | discard`.
L'opération se déroule en deux étapes. D'abord, une copie restaurée est préparée aux côtés de la base de données active ;
votre application continue de tourner sur la base active, et le stockage de la copie est facturé jusqu'au
basculement (cutover) ou à son abandon (discard).
Ensuite, dès que la copie est prête, le basculement redirige l'application vers celle-ci et la redémarre.
Tout ce qui a été écrit après l'heure cible n'est pas présent dans la copie. La base de données
d'origine est conservée pour permettre un retour arrière et continue d'être facturée au niveau du stockage ; revenir en arrière,
la supprimer ou effectuer une deuxième restauration nécessite de passer par le support. Seul un propriétaire ou un administrateur
peut préparer, basculer ou abandonner la copie, et la console demande le nom du projet
avant d'effectuer le basculement.

## Sécuriser votre compte

Votre compte de console peut accéder aux bases de données de production, aux secrets et à la facturation,
protégez-le donc en conséquence. Ouvrez **Account security** depuis le menu sous votre avatar
dans la console (ou rendez-vous sur `/account`). Cette page vous appartient en propre et non à une
organisation : ce que vous y configurez s'applique à toutes les organisations dont vous faites partie.

- **Validation en deux étapes.** Activez-la avec n'importe quelle application d'authentification (1Password,
  Google Authenticator, Authy). La page affiche une clé de configuration à ajouter à l'application, ou un
  lien qui ouvre l'application avec la clé pré-remplie sur un téléphone, puis demande le
  code à 6 chiffres affiché par l'application. Dès lors, chaque connexion requiert un code,
  que vous vous connectiez par mot de passe, Google ou GitHub.
- **Codes de récupération.** L'activation vous fournit dix codes à usage unique, affichés une seule fois.
  Chacun d'eux vous permet de vous connecter à la place du code d'authentification si vous perdez votre
  téléphone ; enregistrez-les donc avant de fermer la boîte de dialogue. **New recovery codes**
  les remplace, et les anciens cessent de fonctionner. La désactivation de la validation en deux étapes
  et l'obtention de nouveaux codes demandent toutes deux un code préalable.
- **Mot de passe.** Le modifier vous déconnecte de tous vos autres appareils. Un compte
  créé avec Google, GitHub ou LinkedIn n'a pas de mot de passe ; la page propose de
  vous envoyer un lien par e-mail pour en définir un.
- **Appareils connectés.** Chaque navigateur et terminal connecté à votre compte,
  avec son adresse et la date de connexion. Déconnectez tout appareil que vous ne
  reconnaissez pas, ou tous en même temps.

Les [jetons d'accès](/docs/deployment/cloud-agents/#ci-and-agents) ne sont pas des sessions et ne demandent pas de second
facteur, ce qui permet à la CI de continuer à déployer après l'activation. Révoquez un jeton auquel vous ne faites plus
confiance sous **Settings → Access tokens**.

## Inviter votre équipe

**Members → Invite member** génère un lien à copier (envoyé par e-mail si ce plan de contrôle
envoie des e-mails) valable une seule fois, pendant 7 jours, pour un compte ayant vérifié cette
adresse ; personne ne rejoint l'organisation tant que l'invitation n'a pas été acceptée. Invitez un administrateur ou un membre, et faites-en
un propriétaire une fois qu'il a rejoint l'organisation. Les propriétaires et administrateurs peuvent voir, renvoyer ou révoquer l'invitation dans
**Pending invitations** ; depuis un terminal, [`rebase cloud orgs members invite`](/docs/cli/cloud/#organizations).

## Voir qui a fait quoi

La page **Activity** de la console et `rebase cloud activity` indiquent aux
propriétaires et administrateurs de l'organisation qui a déployé, défini ou affiché une variable
d'environnement (par son nom, jamais par sa valeur), modifié un domaine, restauré une sauvegarde,
redimensionné, arrêté ou supprimé un projet, modifié le rôle d'un membre ou créé un
jeton, et à quel moment. Les **Settings** d'un projet pointent vers ses propres entrées ; une entrée
relative à un projet supprimé est conservée. Un script peut les lire avec un jeton créé avec
`--can audit` sur l'organisation. Les entrées sont conservées pendant un an. Les filtres sont décrits dans
[`rebase cloud`](/docs/cli/cloud/#organizations).

## CI et agents

Un job de CI ou un agent ne devrait pas détenir votre mot de passe. Attribuez-lui un jeton restreint à
quelques actions sur un seul projet, créé depuis un terminal connecté avec
`rebase cloud tokens create --project shop --can deploy,logs`, et définissez-le comme
`REBASE_TOKEN`. La facturation, le journal d'activité et les paramètres de notification
d'une organisation sont des autorisations distinctes (`--can billing`, `audit`,
`notifications`) qu'un jeton ne possède que si elles sont expressément demandées. Les autorisations, un
workflow GitHub Actions et les privilèges réservés à un utilisateur connecté sont décrits dans
[CI et agents](/docs/deployment/cloud-agents/#ci-and-agents).

## Un backend sans compte

`rebase cloud init --claim` attribue à une application un backend fonctionnel avant même que quiconque ne soit
inscrit, et affiche une URL de réclamation pour permettre à l'utilisateur de le conserver ; un projet que personne ne réclame
dans les 72 heures est supprimé. Ce que le jeton du projet non réclamé peut faire, le
`REBASE_API_TOKEN` qu'il écrit et ce que la réclamation modifie sont expliqués dans
[Un backend sans compte](/docs/deployment/cloud-agents/#a-backend-with-no-account).

## Puissance de calcul et coûts

Le prix d'un projet dépend de ce qu'il réserve, et non d'un forfait. `compute` affiche
chaque curseur et le devis détaillé établi par le plan de contrôle. (`rebase cloud
resources` est différent : ce sont les bases de données et les buckets déclarés par le code,
et si chacun est provisionné — voir la [référence de la CLI](/docs/cli/cloud/).)

```bash
rebase cloud compute
rebase cloud compute set --cpu 500m --memory 2Gi
```

| Curseur | Unité, et signification |
|---|---|
| `--cpu`, `--memory` | Ressource requise (request) par instance d'application, par ex. `500m` et `2Gi`. Vide signifie la valeur par défaut de la plateforme — `100m` et `384Mi`, avec des pointes possibles (burst) jusqu'à 2 CPU et `2Gi` |
| `--replicas` | Instances existant en permanence : le plancher de l'autoscaler, et ce que l'abonnement du projet facture chaque mois |
| `--autoscale-max` | 1–16. Le plafond qu'il peut atteindre. Les instances ajoutées par l'autoscaler au-delà de `--replicas` sont mesurées à la seconde-pod aux mêmes tarifs, et facturées uniquement là où la plateforme l'a activé ; **Usage this month** l'indique. `--no-autoscale` le désactive |
| `--autoscale-cpu-target` | 10–95. L'utilisation CPU visée par l'autoscaler, par rapport à la requête (request) plutôt qu'à la limite. Vide équivaut à 70 |
| `--spot` | `true` ou `false`. Capacité préemptible : moins chère, mais redémarrée sans préavis |
| `--db-instances` | 1–3. `1` correspond à une instance unique sans basculement ; `2` ajoute une instance de secours (standby) automatique |
| `--db-cpu`, `--db-memory` | Par instance de base de données. Vide équivaut à `160m` et `1Gi` |

Un curseur vide n'est pas identique à un curseur fixé à la même valeur : un curseur vide
suit la valeur par défaut de la plateforme et s'adapte lorsqu'elle évolue.

Rien n'est validé par la CLI, à dessein — les limites dépendent du cluster sur lequel tourne
le projet, et elles varient selon les fournisseurs. Le plan de contrôle refuse une
valeur qu'il ne peut pas honorer et nomme le champ en cause. Exécutez `rebase cloud compute` pour voir
le montant en €/mois avant et après ; une modification s'applique immédiatement, au prorata à compter d'aujourd'hui,
à l'exception de celle qui redémarre la base de données, qui attend une fenêtre de maintenance.

## Le reste des commandes

| Groupe de commandes | Ce qu'il couvre |
|---|---|
| `login`, `logout`, `whoami`, `access-token` | Votre session ; `access-token` affiche le jeton bearer que la CLI enverrait maintenant, pour les scripts et le serveur MCP |
| `tokens` | Jetons pour la CI et les agents, chacun restreint à un projet. Voir [CI et agents](/docs/deployment/cloud-agents/#ci-and-agents) |
| `link`, `unlink`, `use`, `open` | Lier ce répertoire à un projet, sélectionner une organisation, ouvrir la console |
| `connect` | Ajouter un serveur Rebase auto-hébergé à votre compte, pour que le [connecteur Rebase](/docs/ai/rebase-connector/) dans Claude l'atteigne à côté de vos projets Cloud. `--list` les affiche, `--remove` en retire un. Propriétaires et administrateurs |
| `init`, `claim` | Avec `--claim` : un backend opérationnel sans compte, et un lien pour le réclamer ; `claim` affiche à nouveau ce lien. Voir [Un backend sans compte](/docs/deployment/cloud-agents/#a-backend-with-no-account) |
| `projects` | Créer, lister, inspecter, supprimer |
| `deploy`, `logs`, `deployments`, `rollback`, `cancel` | Déploiement et suivi |
| `previews` | Builds servis sur leur propre adresse par `deploy --preview`, et leur suppression. Voir [Prévisualiser une modification](#prévisualiser-une-modification) |
| `start`, `stop`, `restart` | Mettre en pause un projet et le relancer. Un projet arrêté conserve son abonnement, à moins que la plateforme ne facture aux projets arrêtés uniquement le stockage et les frais de plateforme ; la ligne **Billing** de la console l'indique le cas échéant |
| `status`, `metrics`, `debug` | Ce qu'il fait, et pourquoi il ne le fait pas |
| `cron` | Les tâches cron de l'application déployée et leurs exécutions enregistrées, lues avec votre identifiant `rebase cloud`. En lecture seule |
| `env` | Variables d'environnement. `list` n'affiche jamais les valeurs ; `--secret` est en écriture seule |
| `app-key` | La clé écrite par `init --claim` dans `.env` en tant que `REBASE_API_TOKEN`, transmise lors de la réclamation ; `rotate` la remplace et révoque l'ancienne. Propriétaires et administrateurs |
| `service-key` | `REBASE_SERVICE_KEY`, administrateur sur l'API propre de l'application : date de sa dernière rotation ; `rotate` en fournit une nouvelle à l'application. Propriétaires et administrateurs |
| `domains` | Domaines personnalisés, enregistrements DNS à ajouter et vérification. Un projet peut répondre sur plusieurs domaines, chacun vérifié individuellement ; `verify` et `remove` prennent le domaine sur lequel agir, qui ne peut être omis que lorsqu'il n'y en a qu'un seul (pour `verify`, un seul encore en attente). `list --json` renvoie `{ projectId, tenantHost, domains: [...] }` |
| `db` | Associer ou créer une base de données, s'y connecter depuis votre machine, sauvegardes, restauration et récupération à un point dans le temps (PITR) |
| `guests` | Les utilisateurs invités laissés par les connexions anonymes : les compter, en supprimer un, purger ceux qui n'ont pas été vus depuis longtemps. Voir [Guests](/docs/cli/cloud/#guests). Propriétaires et administrateurs |
| `extensions` | La liste d'autorisation (allowlist) des extensions Postgres |
| `storage` | Le bucket du projet |
| `resources` | Les bases de données et buckets détenus par la plateforme, par rapport à ce que déclare le code |
| `compute` | Ce que ce projet réserve, ce qu'il coûte et comment le modifier |
| `usage` | Requêtes consommées ce mois-ci par rapport au quota inclus, et le dépassement actuel, tel qu'il est comptabilisé sur la facture. `usage org` liste tous les projets de l'organisation |
| `clusters` | Les clusters sur lesquels tournent les tenants. Réservé aux administrateurs de la plateforme |
| `settings`, `orgs`, `billing` | Paramètres du projet, organisations ainsi que leurs membres et invitations, paiement |
| `activity` | Le journal d'audit de l'organisation : qui a déployé, modifié une variable d'environnement (par nom), un domaine, une sauvegarde, un membre ou un jeton. Propriétaires et administrateurs. Voir [Voir qui a fait quoi](#voir-qui-a-fait-quoi) |
| `notifications`, `webhooks` | Où les événements du projet sont envoyés via POST : Slack, Discord ou n'importe quelle URL https ([Notifications Cloud](/docs/deployment/cloud-notifications/)). `webhooks` est obsolète et se termine avec le code 1 et l'erreur `command_retired` |

Chaque groupe de ce tableau répond à `--help` avec sa propre page — une ligne d'utilisation,
ses options et des exemples — et `--help` n'exécute jamais la commande. Un test conserve l'index
de ces pages, de sorte qu'un groupe ajouté sans page fait échouer le build plutôt que de
renvoyer la table des matières. `verify:docs` soumet le tableau lui-même à cet index :
chaque groupe géré par la CLI apparaît ici exactement une fois, de sorte qu'un groupe
ajouté sans ligne dédiée fait également échouer le build.

Utilisé dans un pipe, `--help` répond en JSON à la place : la même ligne d'utilisation, les options et les exemples
sous forme de structure lisible plutôt que soixante lignes de séquences d'échappement de terminal.

## Ce que la bêta n'inclut pas

Dit en toute franchise, car le découvrir plus tard serait pire :

- **Pas de choix de région.** Tout s'exécute aujourd'hui dans une seule région. Le modèle
  de placement existe dans la plateforme, mais un projet ne peut pas choisir sa région.
  `projects create --provider` et `--region` ne constituent pas l'exception qu'ils semblent
  être : ils enregistrent simplement à quelle cible de déploiement enregistrée du plan de contrôle
  un projet appartient, et il n'y en a qu'une seule, de sorte que les deux adoptent cette valeur par
  défaut et qu'aucun ne déplace un projet ailleurs. `rebase cloud projects create --help` indique la même chose.
- **Pas de libre-service.** L'accès est accordé par vagues ; il n'y a pas d'inscription avec paiement direct.
- **Aucun SLA publié**, et pas de SOC 2. Si vous avez besoin de l'un ou de l'autre, mentionnez-le
  lors de votre demande d'accès au lieu de le supposer acquis.
- **Pas de déploiements par branche**, et pas d'application GitHub officielle. Les hooks de déploiement — des URL
  secrètes vers lesquelles pointer un webhook de dépôt — constituent l'automatisation prise en charge. Les [déploiements
  de prévisualisation](#prévisualiser-une-modification) sont en cours de déploiement progressif et sont initiés depuis la CLI.
- **Les jetons agissent en tant qu'utilisateur.** Un [jeton](/docs/deployment/cloud-agents/#ci-and-agents) est généré par un compte
  et agit en son nom ; il n'y a pas encore d'identité machine appartenant à l'organisation. Si vous
  vous connectez depuis la CI à la place, passez `REBASE_CLOUD_EMAIL` et `REBASE_CLOUD_PASSWORD`
  depuis un gestionnaire de secrets — `--password` inscrit le mot de passe dans l'historique de votre shell et
  dans la table des processus, et vous en avertit avant de vous connecter. Si le fichier
  `.rebase/cloud.json` du dépôt mentionne un plan de contrôle autre que celui de la plateforme, passez-le
  également via `--url` : sans terminal, `login` refuse d'envoyer un mot de passe à un
  hôte qui n'a été spécifié que par le fichier extrait.
- **Aucun endpoint public de base de données.** Une base de données managée n'est pas exposée à
  Internet ; l'hôte affiché par la console correspond donc à l'adresse que votre backend utilise pour
  la joindre et ne résout rien sur votre machine. `rebase cloud db connect` ouvre un port local relié
  à cette base de données, encapsulé dans un tunnel via le plan de contrôle, aussi longtemps
  que vous le laissez tourner — mais il n'existe aucun nom d'hôte permanent auquel un service tiers
  pourrait se connecter. Ce tunnel, ainsi que le mot de passe révélé par
  `rebase cloud db info --reveal`, nécessitent tous deux le rôle de propriétaire ou d'administrateur
  de l'organisation : le même rôle que demande l'éditeur SQL de Studio, car tous trois aboutissent à
  une session sur vos données de production.
- **Déployer revient à exécuter du code avec les secrets de production.** L'environnement
  de l'application contient `REBASE_SERVICE_KEY` (administrateur sur sa propre API),
  `DATABASE_URL` et `JWT_SECRET` ; le code déployé par un membre peut donc les lire,
  même si seuls les propriétaires et administrateurs peuvent les afficher dans la console. N'invitez
  en tant que membre qu'une personne à qui vous confieriez ces valeurs.
- **La clé de service peut être remplacée.** Les **Settings** du projet
  (ou `rebase cloud service-key rotate`) génèrent une nouvelle `REBASE_SERVICE_KEY`
  et redémarrent l'application avec celle-ci. L'ancienne clé fonctionne jusqu'à ce que le redémarrage
  soit terminé, et plus du tout après, de sorte que toute entité l'ayant copiée sera rejetée
  à partir de ce moment. Réclamer un projet effectue la même opération.

## S'auto-héberger à la place

Rien ici ne constitue un verrouillage propriétaire (lock-in). Le [guide d'auto-hébergement](/docs/deployment/self-hosting/)
exécute la même image et le même bundle avec `docker compose`, et le
[guide Kubernetes](/docs/deployment/kubernetes/) restitue la même topologie à partir
du Helm chart.
