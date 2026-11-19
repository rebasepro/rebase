---
sourceHash: 932f7373eaaf4e2e
title: Rebase Cloud
sidebar_label: Rebase Cloud
description: Rebase Cloud est le même Rebase, exploité pour vous. Ce que c'est, comment lier et déployer un projet, et ce que la bêta privée n'inclut pas encore.
---

Rebase Cloud exécute le même Rebase open source que vous auto-hébergeriez — la même
image publiée `rebasepro/server`, le même bundle, le même Postgres. La
différence réside dans qui l'exploite.

:::note[Bêta privée]
Rebase Cloud est en **bêta privée**. Il fait tourner de véritables tenants aujourd'hui et ouvre par
vagues. [Demander un accès](https://rebase.pro/pricing).

Ce n'est pas en libre-service, donc les commandes ci-dessous nécessitent un compte ayant été autorisé.
Tout le reste sur ce site fonctionne sans compte.
:::

## De quoi s'agit-il

Un **projet** Cloud correspond à trois éléments que la plateforme gère pour vous :

| | Ce que vous obtenez |
|---|---|
| **App** | Votre bundle, s'exécutant sur l'image d'exécution publiée. Les déploiements sont un téléversement de bundle, pas une construction de conteneur |
| **Database** | Un PostgreSQL managé, avec sauvegardes automatisées et récupération à un point dans le temps (point-in-time recovery) |
| **Storage** | Votre propre bucket, si votre projet utilise le stockage de fichiers |

Chacun est provisionné lors de votre premier déploiement, et chacun est facturé en
fonction de ce qu'il réserve plutôt que par utilisateur.

**Rien ne change dans votre projet pour y fonctionner.** Le même dépôt
s'auto-héberge avec `docker compose`, et la porte de sortie est bien réelle : `rebase build`
produit un bundle qui démarre partout où l'image d'exécution fonctionne.

## Lier un projet

Depuis le répertoire d'un projet :

```bash
rebase cloud login
rebase cloud billing setup
rebase cloud projects create --name "My app" --subdomain my-app --link
```

`login` ouvre la console dans votre navigateur et affiche un code court. Vérifiez que
la console affiche le même code, puis approuvez la connexion à cet endroit : le terminal
récupère la session et l'écrit dans `~/.rebase/credentials.json`. Si vous n'êtes
pas connecté à la console, connectez-vous-y d'abord avec le moyen de votre choix, Google
et GitHub inclus. Par SSH, `rebase cloud login --no-browser` affiche le lien
à ouvrir sur votre propre machine.

`projects create` ne prend aucun argument positionnel. Le nom et le sous-domaine sont
des options (flags), et tous deux sont requis — dans un terminal, ils vous sont demandés, et une
exécution sans interface qui omet l'un d'eux se termine avec `input_required` plutôt que d'en inventer
un. **Le sous-domaine n'est pas modifiable par la suite :** il s'agit de l'hôte
`<slug>.rebase.website` sur lequel le projet répond, choisissez-le donc avec soin.

`--link` associe ce répertoire au projet lors du même appel, évitant ainsi une
étape `link` distincte. Il écrit `.rebase/cloud.json`, qui enregistre l'identifiant et le
slug du projet. Ce fichier n'est pas un secret et ne contient pas vos identifiants — ceux-ci
résident dans `~/.rebase/credentials.json`, écrit par `login`.

Il est toutefois commité avec le code, de sorte qu'un dépôt cloné peut désigner n'importe quel
plan de contrôle. Lorsque l'hôte provient uniquement de ce fichier et qu'il ne s'agit ni de celui
de la plateforme ni d'un hôte auquel vous vous êtes connecté auparavant, `login` le nomme et demande
confirmation avant d'y envoyer votre e-mail et votre mot de passe. Sans terminal, ou avec
`--json`, il refuse avec `unknown_control_plane` ; passez `--url <host>` (ou définissez
`REBASE_CLOUD_URL`) pour vous y connecter délibérément.

Pour vous connecter sans le navigateur, transmettez votre e-mail : `rebase cloud login --email
me@example.com` demande votre mot de passe. **Vous vous êtes inscrit avec Google, GitHub ou
LinkedIn ?** Votre compte n'a pas de mot de passe, utilisez donc un code à la place :

```bash
rebase cloud login --code --email me@example.com
```

Le plan de contrôle vous envoie par e-mail un code à 6 chiffres, valable dix minutes, que vous saisissez
à l'invite. Avec `--email` et sans mot de passe, `rebase cloud login` demande
si vous souhaitez utiliser votre mot de passe ou un code. Les codes nécessitent que le plan de contrôle soit en mesure d'envoyer
des e-mails ; si ce n'est pas le cas, `--code` vous en informe et quitte avec `otp_unavailable`.

Si vous avez activé l'authentification à deux facteurs, `login` demande ensuite le code de
votre application d'authentification ou l'un de vos codes de récupération, quelle que soit la méthode de connexion
utilisée. Via le navigateur, la console le demande lorsque vous vous y connectez. Ni un code de connexion ni un second facteur ne peuvent être saisis sans terminal.
Pour un script, créez un jeton d'accès dans la console (**Settings → Access
tokens**) et définissez `REBASE_TOKEN` ; consultez [CI et agents](/docs/deployment/cloud-agents/#ci-and-agents).

Un mot de passe incorrect renvoie `invalid_credentials` avec les deux mêmes moyens d'accès,
la cause habituelle étant un compte qui n'en a jamais eu.

`billing setup` associe une carte à l'organisation, une seule fois. Cette étape figure
délibérément en premier dans la séquence : le premier déploiement d'un projet est refusé sans carte, et
s'en rendre compte après la fin du téléversement d'un bundle est le pire scénario.

Après cela, la page **Billing** de la console liste les factures de l'organisation,
chacune avec la page hébergée par Stripe et le PDF, et donne un aperçu de la prochaine facture de chaque
projet. `rebase cloud billing invoices` et `rebase cloud billing upcoming`
affichent la même chose. Les deux s'adressent aux propriétaires et administrateurs de l'organisation. Lorsque
la plateforme le propose, **Manage billing** ouvre le portail client de Stripe pour la
carte bancaire, les détails de facturation et les factures antérieures.

Avec une carte déjà enregistrée, créer un autre projet dans la console ne nécessite
aucun second paiement : le projet est facturé sur cette carte et se déploie. Si la carte
est refusée ou si la banque demande une confirmation de paiement, la console vous redirige vers
**Billing**, où **Fix your card** permet d'enregistrer une autre carte et **Complete the
payment** ouvre la facture Stripe.

La consommation d'un projet s'affiche sur sa vue d'ensemble, sous **Usage this month**, et
pour tous les projets à la fois sur la page **Billing** : les requêtes par rapport au
quota inclus (la barre devient orange à 80 %), les erreurs 5xx, le dépassement actuel
et l'estimation pour la fin du mois à ce rythme. Le dépassement est calculé par
le même code qui le transmet à Stripe, c'est donc ce qui figurera sur la facture ; il
apparaît sur la facture du mois suivant. `rebase cloud usage` affiche la même
chose, et `rebase cloud usage org` pour l'ensemble de l'organisation. N'importe quel membre peut
le consulter. Les chiffres précisent ce qu'ils ne peuvent pas encore mesurer : le stockage objet n'est pas mesuré,
aucun dépassement de stockage n'est donc facturé ; tant qu'un projet exécute deux pods applicatifs ou plus,
ses requêtes ne sont pas comptabilisées ; et une journée avec des échantillons manquants sous-estime le total. Un
projet avec autoscaling affiche également les pods exécutés au-delà de `--replicas`, en heures-pods,
ce qu'ils coûtent selon ses propres tarifs et si cette plateforme les facture déjà. Un
projet réclamé depuis un agent ne compte que les jours à partir de la réclamation : avant
cela, le projet appartenait à la plateforme.

Un projet existant peut être lié sans en créer un nouveau :

```bash
rebase cloud projects list
rebase cloud link --project my-app
```

## Déployer

```bash
rebase cloud deploy
```

Une seule commande, et aucune option à mémoriser. Le fichier `rebase.json` d'un scaffold déclare
`runtime: "managed"` pour son backend, et `deploy` lit cette déclaration — il
l'indique au passage (`rebase.json declares runtime: managed — deploying a
bundle`), compile l'application dans `dist-bundle`, téléverse le bundle, l'exécute sur
l'image d'exécution publiée et suit le déploiement jusqu'à son état final. Le code
de sortie fait foi, cette même ligne fonctionne donc de manière automatisée en CI.

Elle se termine en indiquant où chaque application répond désormais et si la nouvelle version
y est en ligne :

```text
  ✓ Deployed songbuzz in 1m 12s  (deployment fb3c7442-9937-4179-8d3c-88a106da149d)

    game     static   https://songbuzz.rebase.website      live
    backend  backend  https://songbuzz.rebase.website/api  live

  ✓ Live: the new version answers on every address above.
  Something wrong? `rebase cloud rollback` puts the previous deployment back.
```

« Live » signifie que l'adresse a répondu après la compilation : le `/health` d'un backend a
renvoyé `ok`, et la page d'une application statique s'est chargée (à partir de ce déploiement, lorsque
la plateforme la sert). La vérification attend jusqu'à `--live-timeout` secondes, 60 par
défaut ; `0` l'ignore. Si une application ne répond pas à temps, le déploiement se termine quand même avec un code
zéro, car le déploiement a réussi, et la dernière ligne indique quelle application n'a pas
répondu et pourquoi. Un déploiement ayant échoué se termine plutôt sur une seule ligne, indiquant l'application et la
raison, avec `rebase cloud logs` pour le journal de build complet.

Les scripts passent `--json` pour obtenir un objet contenant les mêmes informations — `apps`, `hosts`,
`live`, `liveChecks`, `durationMs` et l'identifiant de déploiement. Contrairement au reste de
`rebase cloud`, `deploy` ne bascule pas automatiquement en JSON lorsqu'il est utilisé dans un pipe.

Ce que ce runtime autorise — packages et modules natifs, mémoire et instances,
délais d'expiration (timeouts) et tailles de corps, système de fichiers, secrets, stockage et réseau
sortant — est détaillé sur sa propre page :
[Managed backend runtime](/docs/deployment/managed-runtime/).

Pour déployer un artefact compilé plus tôt — par exemple, un job de CI qui compile une fois et
déploie deux fois —, pointez vers le répertoire au lieu de recompiler :

```bash
rebase build
rebase cloud deploy --bundle-dir dist-bundle
```

Quitter le runtime managé dispose de sa propre option, `--eject`, et rien d'autre ne le
demande : un build qui transférerait un projet managé vers une image de conteneur dont il
devient propriétaire est refusé tant que vous ne l'avez pas explicitement demandé. Auparavant, `--force` avait cette signification, ce qui
plaçait l'action la moins réversible de la CLI sous le même mot que « écraser ce
fichier » ; il s'agit désormais d'une option inconnue plutôt que d'un alias, de sorte qu'un script l'utilisant
s'interrompt.

### La vérification syntaxique avant le téléversement

Les fichiers d'une application statique sont servis exactement tels quels. Lorsque son `build` se
contente de copier des scripts écrits à la main dans `output`, rien ne les a analysés, et un fichier
contenant une faute de frappe est mis en ligne et empêche la page de se charger. Par conséquent, avant tout
téléversement, `deploy` analyse chaque fichier `.js`, `.mjs` et `.cjs` dans le dossier `output` de chaque
application statique, ainsi que chaque balise `<script>` inline dans ses fichiers `.html`. Cela
couvre une application statique déployée seule ainsi que les applications statiques intégrées au
bundle du backend. Une erreur de syntaxe interrompt le déploiement en indiquant le fichier, la ligne et la colonne :

```
✗ A syntax error in the static output, so nothing was deployed:
    web/cloud.js:42:23  Unexpected token
        42 |     return fetch("/api";
Fix it and deploy again, or pass --no-verify to deploy anyway.
```

Avec `--json`, le `code` d'erreur est `syntax_error`. Les scripts inline qu'un navigateur
n'exécute pas en tant que JavaScript sont ignorés : JSON, import maps, templates et tout
autre `type` non-JavaScript, les `<script src>`, ainsi que les scripts contenant encore
du balisage de template non rendu tel que `{{ }}`. Un fichier `.js` est validé s'il s'analyse soit
comme un script classique, soit comme un module, car c'est la page qui en décide. Rien
sous `node_modules` n'est lu, pas plus qu'un `--bundle-dir` pré-compilé.
`--no-verify` permet d'ignorer la vérification pour un déploiement.

Pour surveiller :

```bash
rebase cloud logs               # the build log
rebase cloud logs --runtime -f  # what the running app prints, live, until Ctrl-C
rebase cloud status             # what the platform thinks the project is doing
```

`status` signale `blockedOn` et `nextAction`. Lorsque `blockedOn` vaut `null`, la
plateforme travaille réellement et faire du polling est la bonne chose à faire ; lorsqu'il
désigne quelque chose, ce quelque chose vous attend.

L'un d'eux est `email_not_configured` : l'application a activé la connexion par lien magique ou par code
e-mail (`AUTH_MAGIC_LINK`, `AUTH_EMAIL_OTP`) et n'a pas de service d'e-mail, de sorte que
le déploiement est en ligne mais personne ne peut s'y connecter. Rebase Cloud n'envoie pas d'e-mails
pour votre application : configurez `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` et
`SMTP_FROM` avec `rebase cloud env set`, puis déployez. `status` le lit depuis le
`GET /api/auth/config` propre à l'application (son champ `unavailable`), et `deploy` affiche
la même chose sous son test de disponibilité en direct.

## Prévisualiser une modification

```bash
rebase cloud deploy --preview
```

Cela compile et téléverse exactement la même chose que `deploy`, mais le sert à une adresse
propre, par exemple `https://shop--k3x9ab.rebase.website`. La production continue de
servir ce qu'elle servait auparavant. Le déploiement affiche l'adresse de la prévisualisation dès que le
build est terminé.

Pour conserver la même adresse au fil des déploiements, donnez un nom à la prévisualisation. Déployer à nouveau
sous le même nom la met à jour :

```bash
rebase cloud deploy --preview-name new-checkout
```

Ce avec quoi une prévisualisation communique dépend de ce que vous avez déployé :

- **`rebase cloud deploy --preview`** prévisualise le backend, avec ses applications statiques
  intégrées, de la même façon que la production les exécute. Il obtient son propre backend sur
  **sa propre base de données vide**, jamais celle de production. Démarrer sur
  la base de données de production lui appliquerait le schéma et les règles d'accès de la prévisualisation.
- **`rebase cloud deploy web --preview`** prévisualiserait une application statique seule,
  ses pages appelant le backend de **production**. Cela nécessite un plan de contrôle
  qui sert les sites statiques de manière autonome, ce que Rebase Cloud ne fait pas encore : il
  refuse avec `PREVIEW_STATIC_UNSERVED` et ne publie rien. Prévisualisez plutôt le
  backend, qui sert les applications statiques qui y sont intégrées ; un projet sans
  backend managé ne peut pas encore être prévisualisé.

Une prévisualisation ne téléverse aucun code source et n'enregistre aucune application ni aucun nom d'hôte, car chacun
d'eux modifierait le projet de production. `--source` et `--eject` ne peuvent pas être
combinés avec `--preview`. Chacun construit une image de conteneur pour la production.

```bash
rebase cloud previews                      # name, address, app, backend, expiry
rebase cloud logs --preview new-checkout   # its build log; -f follows a build still running
rebase cloud logs --runtime --preview new-checkout -f  # what its backend prints
rebase cloud previews delete new-checkout  # stops serving it and drops its database
```

`rebase cloud logs` sans `--preview` concerne toujours la production.

La page **Deployments** de la console liste ces mêmes prévisualisations, et permet d'ouvrir, d'afficher
les logs de build ou de supprimer chacune d'elles. La création reste une étape en CLI.

Une prévisualisation expire une semaine après son dernier déploiement.

Lorsqu'il se termine, le déploiement vérifie que l'adresse de la prévisualisation répond, tout comme
un déploiement en production (`--live-timeout <seconds>`, `0` pour ignorer). Le certificat d'une
nouvelle prévisualisation pouvant prendre une ou deux minutes, un déploiement réussi peut
indiquer que l'adresse ne répond pas encore.

Une prévisualisation de backend est facturée comme une unité d'application à la taille par défaut (100m de CPU
et 384 Mio de mémoire, au tarif de votre application pour sa région et sa capacité),
au prorata de sa durée d'existence, et apparaît dans le devis mensuel du projet
dans la console. `rebase cloud deploy --preview` affiche la même estimation mensuelle
(`cost` avec `--json`). En démarrer une nécessite une carte enregistrée, tout comme pour un déploiement en
production. Un premier déploiement qui
échoue avant que quoi que ce soit ne tourne est supprimé plutôt que facturé. Un projet peut exécuter
trois prévisualisations de backend simultanément.

Chaque nouvelle adresse de prévisualisation reçoit son propre certificat TLS de Let's Encrypt,
qui autorise 50 nouveaux certificats par semaine pour un domaine, partagés avec tous les sites de production sur celui-ci.
Les prévisualisations peuvent en consommer 20 sur une période glissante de 7 jours, à l'échelle de la plateforme. Au-delà,
une nouvelle prévisualisation est refusée (`429`, `preview_cert_budget`) en indiquant le moment où elle pourra
être déployée ; redéployer une prévisualisation existante n'est jamais décompté.

La base de données d'une prévisualisation de backend est une seconde base de données sur le Postgres de **production** :
ses propres données, mais la même instance et le même disque. Elle est limitée à 10
connexions, de sorte que les prévisualisations ne puissent pas saturer celles de la production, et à 2 Go : une
prévisualisation dont la base de données dépasse cette taille est mise en pause. Son backend s'arrête, son adresse cesse
de répondre, `rebase cloud previews` et la console l'affichent comme `paused` avec la
raison, et les propriétaires et administrateurs du projet en sont informés (`preview.paused`). Ses
données sont conservées jusqu'à son expiration. Déployez-la à nouveau pour la redémarrer (elle sera remise en pause
tant que la base de données reste trop volumineuse), ou supprimez-la. Une prévisualisation en pause reste
facturée jusqu'à ce qu'elle soit supprimée ou expire. Supprimez les prévisualisations dont vous n'avez plus besoin. Les extensions installées en production ne sont pas
installées dans la base de données d'une prévisualisation.

Les prévisualisations sont en cours de déploiement progressif. Un plan de contrôle qui ne les gère pas encore refuse
`--preview` avec `previews_unavailable` et ne déploie rien.

## Roll back

```bash
rebase cloud deployments
rebase cloud rollback
```

Un rollback redirige le projet vers ce qu'un déploiement réussi précédent
avait mis en production, et ne reconstruit jamais rien — l'intérêt d'un rollback est de livrer un
artefact qui a déjà fait ses preuves en exécution.

Les déploiements éligibles dépendent du mode de déploiement du projet, et les deux types
fonctionnent :

| Mode de déploiement | Ce qui est restauré |
|---|---|
| `rebase cloud deploy` (un build depuis les sources) | L'image publiée par ce build |
| `rebase cloud deploy --bundle` (le runtime de la plateforme) | Le bundle livré par ce déploiement, sur la version du runtime actuellement exécutée par le projet |

Les applications statiques intégrées au bundle du backend (un simple `rebase cloud deploy` sur un
projet avec un backend) font partie de ce bundle, elles sont donc restaurées avec lui.

Une application statique déployée seule (`rebase cloud deploy <app>`) ne peut pas encore faire
l'objet d'un rollback. Son déploiement enregistre l'application qu'il a publiée, mais aucun bundle, de sorte que le
plan de contrôle n'a aucun élément à partir duquel la restaurer. La solution consiste à redéployer la dernière
version valide, par exemple à partir du commit précédant le commit défaillant. Après un tel
déploiement, `deploy` signale cette situation au lieu d'orienter vers `rollback`, et `rollback`
sans identifiant refuse d'agir plutôt que de redéployer le backend en service.

Un rollback nécessite donc un déploiement ayant enregistré l'un des deux éléments, ce qui implique
un projet ayant été déployé avec succès au moins deux fois. `rebase cloud deployments`
signale ceux qui sont éligibles, et `--json` indique `rollbackable` pour chaque ligne ainsi
que l'`image` ou le `bundle` qui serait restauré.

Deux cas de déploiements sont refusés, et la CLI précise lequel : un qui n'a pas réussi,
et un datant d'avant que la plateforme n'enregistre son artefact. Il n'y a rien à deviner
dans les deux cas — deviner reviendrait à livrer ce qui a été compilé ou téléversé le plus
récemment tout en prétendant restaurer celui-ci — déployez donc plutôt la version souhaitée.

Chaque déploiement réussi se termine en indiquant le moyen de revenir en arrière (`rebase cloud rollback`),
pour qu'il soit directement sous vos yeux au moment où une mise en production défaillante est constatée.

Un rollback ajoute un nouveau déploiement plutôt que de réécrire l'historique, et attend que
la version restaurée soit en service avant de signaler le succès. Suivez-le avec
`rebase cloud logs -f`.

## Restaurer la base de données à un point dans le temps

Une base de données managée peut être restaurée à n'importe quelle minute dans sa fenêtre de récupération,
depuis **Database → Backups** dans la console ou avec la CLI :
`rebase cloud db pitr status | restore --target <ISO> | cutover | discard`.
Cela se déroule en deux étapes. D'abord, une copie restaurée est préparée aux côtés de la base de données active ;
votre application continue de fonctionner sur la base active, et le stockage de la copie est facturé jusqu'à ce
que vous effectuiez le basculement (cutover) ou que vous l'abandonniez (discard).
Ensuite, une fois la copie prête, le basculement redirige l'application vers celle-ci et la redémarre.
Tout ce qui a été écrit après l'heure cible ne figure pas dans la copie. La base de données d'origine
est conservée comme voie de retour et continue d'être facturée pour son stockage ; revenir en arrière,
la supprimer ou effectuer une seconde restauration nécessite de contacter le support. Seul un propriétaire ou un administrateur
peut préparer, basculer ou abandonner, et la console demande le nom du projet
avant de basculer.

## Sécuriser votre compte

Votre compte de console peut accéder aux bases de données de production, aux secrets et à la facturation :
protégez-le en conséquence. Ouvrez **Account security** depuis le menu sous votre avatar
dans la console (ou rendez-vous sur `/account`). Cette page vous appartient, et non à une
organisation : ce que vous y configurez s'applique à toutes les organisations dont vous faites partie.

- **Vérification en deux étapes.** Activez-la avec n'importe quelle application d'authentification (1Password,
  Google Authenticator, Authy). La page affiche une clé de configuration à ajouter à l'application, ou un
  lien qui ouvre l'application avec la clé pré-remplie sur un téléphone, puis demande le
  code à 6 chiffres affiché par l'application. Dès lors, chaque connexion exigera un code,
  que vous vous connectiez avec un mot de passe, Google ou GitHub.
- **Codes de récupération.** L'activation vous fournit dix codes à usage unique, affichés une seule fois.
  Chacun d'eux vous permet de vous connecter à la place du code d'authentification si vous perdez votre
  téléphone, enregistrez-les donc avant de fermer la boîte de dialogue. **New recovery codes**
  les remplace, et les anciens cessent de fonctionner. La désactivation de la vérification en deux étapes
  et la génération de nouveaux codes exigent toutes deux un code au préalable.
- **Mot de passe.** Le modifier vous déconnecte de tous les autres appareils. Un compte
  créé avec Google, GitHub ou LinkedIn n'a pas de mot de passe ; la page vous propose de
  vous envoyer un lien par e-mail pour en définir un.
- **Appareils connectés.** Chaque navigateur et terminal connecté à votre compte,
  avec son adresse et l'heure de sa connexion. Déconnectez tout appareil que vous ne
  reconnaissez pas, ou tous en même temps.

Les [jetons d'accès](/docs/deployment/cloud-agents/#ci-and-agents) ne sont pas des sessions et ne demandent pas de second
facteur, de sorte que la CI continue de déployer après leur activation. Révoquez un jeton auquel vous ne faites plus
confiance sous **Settings → Access tokens**.

## Inviter votre équipe

**Members → Invite member** fournit un lien à copier (envoyé par e-mail lorsque ce plan de contrôle
gère l'envoi d'e-mails) qui fonctionne une seule fois, pendant 7 jours, pour un compte ayant vérifié cette
adresse ; personne ne rejoint tant qu'il n'a pas accepté. Invitez un administrateur ou un membre, et faites-en
un propriétaire une fois qu'il a rejoint. Les propriétaires et administrateurs peuvent le voir, le renvoyer ou le révoquer dans
**Pending invitations** ; depuis un terminal, [`rebase cloud orgs members invite`](/docs/cli/cloud/#organizations).

## Voir qui a fait quoi

La page **Activity** de la console et la commande `rebase cloud activity` indiquent aux
propriétaires et administrateurs de l'organisation qui a déployé, défini ou affiché une variable d'environnement
(par son nom, jamais par sa valeur), modifié un domaine, restauré une sauvegarde,
redimensionné, arrêté ou supprimé un projet, modifié le rôle d'un membre ou créé un
jeton, et à quel moment. Les paramètres (**Settings**) d'un projet renvoient à ses propres entrées ; une entrée
concernant un projet supprimé est conservée. Un script peut les lire avec un jeton créé avec
`--can audit` sur l'organisation. Les entrées sont conservées pendant un an. Les filtres sont décrits dans
[`rebase cloud`](/docs/cli/cloud/#organizations).

## CI et agents

Un job de CI ou un agent ne doit pas détenir votre mot de passe. Attribuez-lui un jeton restreint à
quelques actions sur un seul projet, créé depuis un terminal connecté avec
`rebase cloud tokens create --project shop --can deploy,logs`, et définissez-le comme
`REBASE_TOKEN`. La facturation, le journal d'activité et les paramètres de notification
d'une organisation sont des autorisations distinctes (`--can billing`, `audit`,
`notifications`) qu'un jeton ne possède que si elles sont expressément demandées. Les autorisations, un
workflow GitHub Actions et ce qui reste réservé à un utilisateur connecté sont décrits dans
[CI and agents](/docs/deployment/cloud-agents/#ci-and-agents).

## Un backend sans compte

`rebase cloud init --claim` fournit à une application un backend actif avant même que quiconque ne soit
inscrit, et affiche une URL de réclamation permettant à la personne de le conserver ; un projet que personne ne réclame
dans les 72 heures est supprimé. Ce que le jeton du projet non réclamé peut faire, le
`REBASE_API_TOKEN` qu'il écrit et ce que change la réclamation sont détaillés dans
[A backend with no account](/docs/deployment/cloud-agents/#a-backend-with-no-account).

## Puissance de calcul (Compute), et ce que cela coûte

Le tarif d'un projet est déterminé en fonction de ce qu'il réserve, et non à partir d'un forfait. `compute` affiche
chaque curseur de réglage ainsi que le devis détaillé établi par le plan de contrôle. (`rebase cloud
resources` est différent : il s'agit des bases de données et des buckets déclarés par le code,
et si chacun est provisionné — voir la [CLI reference](/docs/cli/cloud/).)

```bash
rebase cloud compute
rebase cloud compute set --cpu 500m --memory 2Gi
```

| Paramètre | Unité et signification |
|---|---|
| `--cpu`, `--memory` | Demande (request) de l'application par instance, ex. `500m` et `2Gi`. Vide correspond à la valeur par défaut de la plateforme — `100m` et `384Mi`, avec des pointes possibles (burst) à 2 CPU et `2Gi` |
| `--replicas` | Instances qui existent en permanence : le plancher de l'autoscaler, et ce que l'abonnement du projet facture mensuellement |
| `--autoscale-max` | 1–16. Le plafond pouvant être atteint. Les instances que l'autoscaler ajoute au-delà de `--replicas` sont mesurées en secondes-pods aux mêmes tarifs, et facturées uniquement là où la plateforme a activé cette option ; **Usage this month** l'indique. `--no-autoscale` le désactive |
| `--autoscale-cpu-target` | 10–95. L'utilisation CPU que l'autoscaler maintient, par rapport à la demande (request) plutôt qu'à la limite. Vide équivaut à 70 |
| `--spot` | `true` ou `false`. Capacité préemptible : moins chère, et redémarrée sans préavis |
| `--db-instances` | 1–3. `1` correspond à une instance unique sans basculement (failover) ; `2` ajoute une instance de secours (standby) automatique |
| `--db-cpu`, `--db-memory` | Par instance de base de données. Vide équivaut à `160m` et `1Gi` |

Un paramètre laissé vide n'est pas identique à un paramètre fixé au même nombre : un paramètre vide
suit les valeurs par défaut de la plateforme et évolue lorsque celles-ci changent.

Rien n'est validé par la CLI, de manière délibérée — les limites relèvent du cluster sur lequel
tourne le projet, et elles varient selon les fournisseurs. Le plan de contrôle refuse une
valeur qu'il ne peut pas honorer et nomme le champ en cause. Exécutez `rebase cloud compute` pour voir
le montant en €/mois avant et après ; une modification s'applique immédiatement, au prorata à compter d'aujourd'hui,
sauf celle qui redémarre la base de données, qui attend une fenêtre de maintenance.

## Le reste des fonctionnalités

| Groupe de commandes | Ce qu'il couvre |
|---|---|
| `login`, `logout`, `whoami`, `access-token` | Votre session ; `access-token` affiche le bearer token que la CLI enverrait actuellement, pour les scripts et le serveur MCP |
| `tokens` | Jetons pour la CI et les agents, chacun restreint à un seul projet. Voir [CI and agents](/docs/deployment/cloud-agents/#ci-and-agents) |
| `link`, `unlink`, `use`, `open` | Lier ce répertoire à un projet, sélectionner une organisation, ouvrir la console |
| `connect` | Ajouter un serveur Rebase auto-hébergé à votre compte, afin que le [connecteur Rebase](/docs/ai/rebase-connector/#add-your-self-hosted-instances) dans Claude puisse y accéder aux côtés de vos projets Cloud. `--list` les affiche, `--remove` en supprime un. Propriétaires et administrateurs |
| `init`, `claim` | Avec `--claim` : un backend actif sans compte, et un lien pour le réclamer ; `claim` affiche à nouveau ce lien. Voir [A backend with no account](/docs/deployment/cloud-agents/#a-backend-with-no-account) |
| `projects` | Créer, lister, inspecter, supprimer |
| `deploy`, `logs`, `deployments`, `rollback`, `cancel` | Déploiement et surveillance |
| `deploy-hooks` | URLs secrètes qu'un hébergeur git ou une CI appelle pour déployer le projet : lister, créer (l'URL n'est affichée qu'une fois), révoquer. |
| `previews` | Builds servis sur leur propre adresse par `deploy --preview`, et leur suppression. Voir [Prévisualiser une modification](#prévisualiser-une-modification) |
| `start`, `stop`, `restart` | Mettre un projet en pause et le relancer. Un projet arrêté conserve son abonnement, sauf si la plateforme facture pour les projets arrêtés uniquement le stockage et les frais de plateforme ; la ligne **Billing** de la console l'indique le cas échéant |
| `status`, `metrics`, `debug` | Ce qu'il fait, et pourquoi il ne le fait pas |
| `alerts` | Les incidents ouverts du projet, ainsi que leur prise en compte (acknowledge) ou mise en sourdine (snooze). |
| `cron` | Les tâches cron de l'application déployée et leurs exécutions enregistrées, lues avec vos identifiants `rebase cloud`. En lecture seule |
| `env` | Variables d'environnement. `list` n'affiche jamais les valeurs ; `--secret` est en écriture seule |
| `app-key` | La clé écrite dans `.env` par `init --claim` en tant que `REBASE_API_TOKEN`, transférée lors de la réclamation ; `rotate` la remplace et révoque l'ancienne. Propriétaires et administrateurs |
| `service-key` | `REBASE_SERVICE_KEY`, administrateur sur l'API propre à l'application : date de sa dernière rotation ; `rotate` en attribue une nouvelle à l'application. Propriétaires et administrateurs |
| `domains` | Domaines personnalisés, enregistrements DNS à ajouter et vérification. Un projet peut répondre sur plusieurs domaines, chacun vérifié indépendamment ; `verify` et `remove` prennent le domaine à traiter, qui ne peut être omis que lorsqu'il n'y en a qu'un seul (pour `verify`, un seul encore en attente). Chaque domaine vérifié sert le projet comme s'il était lui-même ; `primary <domain>` choisit le domaine canonique et `redirect <domain>` répond à un autre avec une 308 vers celui-ci, le chemin et la requête étant conservés (`--off` le sert à nouveau) — faites-le pour `www.` aux côtés d'un apex, car la connexion Google, les cookies et les passkeys sont définis par origine. Un domaine sur lequel une application est servie (un `path` d'application avec un nom d'hôte) ne redirige jamais. `list --json` renvoie `{ projectId, tenantHost, domains: [...] }` |
| `db` | Attacher ou créer une base de données, s'y connecter depuis votre machine, sauvegardes, restauration et récupération à un point dans le temps |
| `guests` | Les utilisateurs invités laissés par la connexion anonyme : les compter, en supprimer un, purger ceux qui n'ont pas été vus depuis longtemps. Voir [Guests](/docs/cli/cloud/#guests). Propriétaires et administrateurs |
| `extensions` | La liste d'autorisation (allowlist) des extensions Postgres |
| `storage` | Le bucket du projet |
| `resources` | Les bases de données et buckets détenus par la plateforme, par rapport à ce que le code déclare |
| `compute` | Ce que ce projet réserve, ce qu'il coûte et comment le modifier |
| `events` | Ce qui s'est produit sur le backend, du plus récent au plus ancien : dimensionnement de l'application, modifications de la base de données planifiées et appliquées, prise de relais par une instance de secours, extension du disque |
| `usage` | Requêtes utilisées ce mois-ci par rapport au quota inclus, et dépassement actuel, tel que décompté sur la facture. `usage org` liste tous les projets de l'organisation |
| `clusters` | Les clusters sur lesquels tournent les tenants. Administrateur de la plateforme uniquement |
| `settings`, `orgs`, `billing` | Paramètres du projet, organisations ainsi que leurs membres et invitations, paiement |
| `activity` | Le journal d'audit de l'organisation : qui a déployé, modifié une variable d'environnement (par son nom), un domaine, une sauvegarde, un membre ou un jeton. Propriétaires et administrateurs. Voir [Voir qui a fait quoi](#voir-qui-a-fait-quoi) |
| `notifications` | Où les événements du projet sont envoyés par POST : Slack, Discord ou toute URL https ([Cloud notifications](/docs/deployment/cloud-notifications/)) |

Chaque groupe de cette table répond à `--help` avec sa propre page — une ligne d'utilisation,
ses options (flags) et des exemples — et `--help` n'exécute jamais la commande. Un test conserve
l'index de ces pages, de sorte qu'un groupe ajouté sans page fait échouer le build plutôt que de
répondre avec la table des matières. `verify:docs` aligne le tableau lui-même sur
cet index : chaque groupe distribué par la CLI apparaît ici exactement une fois, ainsi un groupe
ajouté sans ligne dédiée fait également échouer le build.

Utilisé dans un pipe, `--help` répond plutôt en JSON : la même ligne d'utilisation, les mêmes options et exemples
sous forme d'une structure lisible plutôt que soixante lignes de séquences d'échappement de terminal.

## Ce que la bêta n'inclut pas

Exprimé en toute franchise, car le découvrir plus tard est bien pire :

- **Pas de choix de région.** Tout fonctionne dans une seule région aujourd'hui. Le modèle de placement
  existe dans la plateforme, mais un projet ne peut pas choisir sa région.
  `projects create --provider` et `--region` ne sont pas l'exception qu'ils paraissent
  être : ils enregistrent à laquelle des cibles de déploiement configurées du plan de contrôle un
  projet appartient ; comme il n'y en a qu'une, les deux prennent celle-ci par défaut et aucun des deux ne déplace un
  projet ailleurs. `rebase cloud projects create --help` indique la même chose.
- **Pas en libre-service.** L'accès est accordé par vagues ; il n'y a pas d'inscription directe avec paiement.
- **Aucun SLA publié**, et pas de SOC 2. Si vous avez besoin de l'un ou de l'autre, mentionnez-le
  lors de votre demande d'accès plutôt que de le présumer.
- **Pas de déploiements par branche**, et pas d'application GitHub officielle. Les hooks de déploiement — des URL
  secrètes vers lesquelles vous pointez un webhook de dépôt — constituent l'automatisation prise en charge. Les [déploiements
  de prévisualisation](#prévisualiser-une-modification) sont en cours de déploiement progressif et sont initiés depuis la CLI.
- **Les jetons agissent en tant que personne.** Un [jeton](/docs/deployment/cloud-agents/#ci-and-agents) est généré par un compte
  et agit en son nom ; il n'y a pas encore d'identité machine appartenant à l'organisation. Si vous
  vous connectez plutôt depuis la CI, transmettez `REBASE_CLOUD_EMAIL` et `REBASE_CLOUD_PASSWORD`
  depuis un gestionnaire de secrets — `--password` place le mot de passe dans l'historique de votre shell et
  dans la table des processus, et vous en avertit avant de vous connecter. Si le fichier
  `.rebase/cloud.json` du dépôt mentionne un plan de contrôle autre que celui de la plateforme, transmettez-le
  également via `--url` : en l'absence de terminal, `login` refuse d'envoyer un mot de passe à un
  hôte qui n'était mentionné que par le fichier extrait.
- **Pas de point de terminaison public pour la base de données.** Une base de données managée n'est pas exposée à
  Internet, ainsi l'hôte affiché par la console est l'adresse que votre backend utilise pour la joindre et
  ne résout rien sur votre machine. `rebase cloud db connect` ouvre un port local
  qui correspond à cette base de données, tunnellisée à travers le plan de contrôle, aussi longtemps
  que vous le laissez tourner — mais il n'existe pas de nom d'hôte permanent auquel un service
  tiers puisse se connecter. Pour exécuter du SQL sans client Postgres local,
  `rebase cloud db query "<sql>"` ou `rebase cloud db query --file file.sql` ouvre le
  même tunnel pour une requête, exécute le texte comme un script unique (s'arrêtant à la première
  erreur) et affiche la réponse de chaque instruction (`--json` pour un script). Ce tunnel, ainsi que le mot de passe accessible via
  `rebase cloud db info --reveal`, requièrent tous deux le rôle de propriétaire ou d'administrateur
  de l'organisation : le même que celui exigé par l'éditeur SQL de Studio, car tous trois aboutissent à
  une session sur vos données de production.
- **Déployer revient à exécuter du code avec les secrets de production.** L'environnement
  de l'application contient `REBASE_SERVICE_KEY` (administrateur de sa propre API),
  `DATABASE_URL` et `JWT_SECRET`, de sorte que le code déployé par un membre peut les lire,
  même si seuls les propriétaires et administrateurs peuvent les afficher dans la console. N'invitez
  comme membre qu'une personne à qui vous feriez confiance avec ces valeurs.
- **La clé de service peut être remplacée.** Les **Settings** du projet
  (ou `rebase cloud service-key rotate`) génèrent une nouvelle `REBASE_SERVICE_KEY`
  et redémarrent l'application avec celle-ci. L'ancienne clé fonctionne jusqu'à ce que le redémarrage
  soit terminé, et plus du tout après, de sorte que tout ce qui l'avait copiée est rejeté par
  la suite. Réclamer un projet effectue la même opération.

## S'auto-héberger à la place

Rien ici ne vous enferme. Le [guide d'auto-hébergement](/docs/deployment/self-hosting/)
exécute l'image et le bundle identiques avec `docker compose`, et le
[guide Kubernetes](/docs/deployment/kubernetes/) restitue la même topologie à partir
du Helm chart.
