---
sourceHash: 4b05c04581ef0b7d
title: Rebase Cloud
sidebar_label: Rebase Cloud
description: Rebase Cloud est le même Rebase, géré pour vous. Ce qu'il est, comment lier et déployer un projet, et ce que la bêta privée n'inclut pas encore.
---

Rebase Cloud exécute le même Rebase open source que vous hébergeriez vous-même — la même
image `rebasepro/server` publiée, le même bundle, le même Postgres. La
différence réside dans la personne qui l'exploite.

:::note[Bêta privée]
Rebase Cloud est en **bêta privée**. Il fait tourner de véritables environnements clients aujourd'hui et s'ouvre par
vagues. [Demander un accès](https://rebase.pro/pricing).

Il n'est pas en libre-service, les commandes ci-dessous nécessitent donc un compte autorisé.
Tout le reste sur ce site fonctionne sans compte.
:::

## Ce que c'est

Un **projet** Cloud correspond à trois éléments que la plateforme gère pour vous :

| | Ce que vous obtenez |
|---|---|
| **App** | Votre bundle, tournant sur l'image d'exécution publiée. Les déploiements sont un téléversement de bundle, pas une compilation de conteneur |
| **Database** | Un PostgreSQL managé, avec sauvegardes automatisées et restauration à un instant précis (point-in-time recovery) |
| **Storage** | Votre propre bucket, si votre projet utilise le stockage de fichiers |

Chacun est provisionné lors de votre premier déploiement, et chacun est facturé en fonction de ce qu'il
réserve plutôt que par utilisateur (per seat).

**Rien dans votre projet ne change pour s'y exécuter.** Le même dépôt
s'auto-héberge avec `docker compose`, et la porte de sortie existe bel et bien : `rebase build`
produit un bundle qui démarre partout où l'image d'exécution fonctionne.

## Lier un projet

Depuis le répertoire d'un projet :

```bash
rebase cloud login
rebase cloud billing setup
rebase cloud projects create --name "My app" --subdomain my-app --link
```

`login` ouvre la console dans votre navigateur et affiche un code court. Vérifiez que
la console affiche le même code et approuvez la connexion à cet endroit : le terminal
récupère la session et l'enregistre dans `~/.rebase/credentials.json`. Si vous
n'êtes pas connecté à la console, connectez-vous-y d'abord avec la méthode de votre choix,
y compris Google et GitHub. Via SSH, `rebase cloud login --no-browser` affiche le lien
à ouvrir sur votre propre machine.

`projects create` ne prend aucun argument positionnel. Le nom et le sous-domaine sont
des options (flags), et tous deux sont obligatoires — dans un terminal, ils vous sont demandés,
et une exécution sans interface (headless) qui omet l'un ou l'autre se termine avec `input_required` plutôt que d'en
inventer un. **Le sous-domaine ne peut plus être modifié par la suite :** il s'agit de l'hôte
`<slug>.rebase.website` sur lequel le projet répond, choisissez-le donc avec soin.

`--link` associe ce répertoire au projet au cours du même appel, évitant ainsi une
étape `link` distincte. Il génère `.rebase/cloud.json`, qui enregistre l'identifiant et
le slug du projet. Ce fichier n'est pas un secret et ne contient pas vos identifiants — ceux-ci
résident dans `~/.rebase/credentials.json`, écrit par `login`.

Il est toutefois commité avec le code, ce qui permet à un dépôt cloné de désigner
n'importe quel plan de contrôle (control plane). Lorsque l'hôte provient uniquement de ce fichier et
qu'il ne s'agit ni de celui de la plateforme ni d'un hôte auquel vous vous êtes déjà connecté, `login` le mentionne et demande
confirmation avant d'y envoyer votre e-mail et votre mot de passe. Sans terminal, ou avec
`--json`, la commande refuse avec `unknown_control_plane` ; passez `--url <host>` (ou définissez
`REBASE_CLOUD_URL`) pour vous y connecter délibérément.

Pour vous connecter sans navigateur, fournissez votre e-mail : `rebase cloud login --email
me@example.com` vous demandera votre mot de passe. **Inscrit avec Google, GitHub ou
LinkedIn ?** Votre compte n'a pas de mot de passe, utilisez donc un code à la place :

```bash
rebase cloud login --code --email me@example.com
```

Le control plane vous envoie par e-mail un code à 6 chiffres, valable dix minutes, que vous
saisissez à l'invite. Avec `--email` et sans mot de passe, `rebase cloud login` demande
s'il faut utiliser votre mot de passe ou un code. Les codes nécessitent que le control plane puisse envoyer
des e-mails ; si ce n'est pas possible, `--code` le signale et se termine avec `otp_unavailable`.

Si vous avez activé l'authentification à deux facteurs, `login` demande ensuite le code de
votre application d'authentification ou l'un de vos codes de secours, quel que soit le mode de connexion
utilisé. Dans le navigateur, la console le demande lors de la connexion. Ni un code de connexion ni un second facteur ne peuvent être saisis sans terminal.
Pour un script, créez un jeton d'accès dans la console (**Settings → Access
tokens**) et définissez `REBASE_TOKEN` ; voir [CI et agents](/docs/deployment/cloud-agents/#ci-and-agents).

Un mot de passe erroné renvoie `invalid_credentials` avec les deux mêmes méthodes d'accès,
la cause fréquente étant un compte qui n'en a jamais eu.

`billing setup` associe une carte à l'organisation, une seule fois. Cette commande est intentionnellement
placée au début de la séquence : le premier déploiement d'un projet est refusé sans moyen de paiement,
et le découvrir après le téléversement complet d'un bundle serait bien plus frustrant.

Ensuite, la page **Billing** de la console répertorie les factures de l'organisation,
chacune avec la page hébergée par Stripe et le PDF associé, et donne un aperçu de la prochaine facture de chaque
projet. `rebase cloud billing invoices` et `rebase cloud billing upcoming`
affichent les mêmes informations. Les deux sont réservées aux propriétaires (owners) et administrateurs de l'organisation. Lorsque
la plateforme le propose, **Manage billing** ouvre le portail client Stripe pour gérer la
carte, les informations de facturation et l'historique des factures.

Si une carte est déjà enregistrée, la création d'un autre projet dans la console ne demande
aucun paiement supplémentaire : le projet est facturé sur cette carte et déployé. Si la carte
est refusée ou si la banque demande une confirmation de paiement, la console vous redirige vers
**Billing**, où **Fix your card** permet d'enregistrer une autre carte et **Complete the
payment** ouvre la facture Stripe.

La consommation d'un projet apparaît sur sa page de vue d'ensemble, sous **Usage this month**, et
pour tous les projets à la fois sur la page **Billing** : requêtes par rapport au
quota inclus (la barre devient orange à 80 %), erreurs 5xx, dépassement actuel
et projection pour la fin du mois à ce rythme. Le dépassement est calculé par
le même code qui le transmet à Stripe, c'est donc ce qui figurera sur la facture ; il
apparaît sur la facture du mois suivant. `rebase cloud usage` affiche la
même chose, et `rebase cloud usage org` pour toute l'organisation. N'importe quel membre peut
le consulter. Les chiffres indiquent également ce qu'ils ne mesurent pas encore : le stockage objet n'est pas mesuré,
aucun dépassement de stockage n'est donc facturé ; tant qu'un projet exécute deux pods applicatifs ou plus,
ses requêtes ne sont pas comptabilisées ; et une journée avec des échantillons manqués sous-estime le total. Un
projet avec autoscaling affiche également les pods exécutés au-delà de `--replicas`, en heures-pod,
leur coût selon ses propres tarifs et si cette plateforme les facture déjà. Un
projet revendiqué (claimed) auprès d'un agent ne comptabilise que les jours à partir de la revendication : avant
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

Une seule commande, et aucun paramètre à mémoriser. Le fichier `rebase.json` d'un projet généré déclare
`runtime: "managed"` pour son backend, et `deploy` lit cette déclaration — il
l'indique au passage (`rebase.json declares runtime: managed — deploying a
bundle`), compile l'application dans `dist-bundle`, téléverse le bundle, l'exécute sur l'image
d'exécution officielle et suit le déploiement jusqu'à son état final. Le code
de sortie fait foi, cette même ligne fonctionne donc de manière automatisée en CI.

Elle se termine en indiquant où chaque application répond désormais et si la nouvelle version y est bien
en ligne :

```text
  ✓ Deployed songbuzz in 1m 12s  (deployment fb3c7442-9937-4179-8d3c-88a106da149d)

    game     static   https://songbuzz.rebase.website      live
    backend  backend  https://songbuzz.rebase.website/api  live

  ✓ Live: the new version answers on every address above.
  Something wrong? `rebase cloud rollback` puts the previous deployment back.
```

« Live » signifie que l'adresse a répondu après le build : le `/health` d'un backend a
renvoyé `ok`, et la page d'une application statique s'est chargée (depuis ce déploiement, lorsque
la plateforme la dessert). La vérification attend jusqu'à `--live-timeout` secondes, 60 par
défaut ; `0` l'ignore. Si une application ne répond pas à temps, le déploiement renvoie tout de même un code de sortie
zéro car le déploiement a réussi, et la dernière ligne indique quelle application n'a pas
répondu et pourquoi. En revanche, un déploiement ayant échoué se termine sur une seule ligne mentionnant l'application et la
raison, avec `rebase cloud logs` pour consulter l'intégralité du journal de build.

Les scripts passent `--json` pour obtenir un objet unique contenant ces mêmes éléments — `apps`, `hosts`,
`live`, `liveChecks`, `durationMs` et l'identifiant du déploiement. Contrairement au reste de
`rebase cloud`, `deploy` ne bascule pas automatiquement en JSON lorsqu'il est utilisé dans un pipe.

Ce que cet environnement d'exécution autorise — paquets et modules natifs, mémoire et instances,
délais d'expiration (timeouts) et tailles de corps de requête, système de fichiers, secrets, stockage et réseau
sortant — est détaillé sur sa propre page :
[Managed backend runtime](/docs/deployment/managed-runtime/).

Pour déployer un artefact compilé précédemment — par exemple un job CI qui compile une fois et
déploie deux fois —, pointez vers le répertoire au lieu de recompiler :

```bash
rebase build
rebase cloud deploy --bundle-dir dist-bundle
```

Quitter le runtime managé nécessite une option dédiée, `--eject`, et rien d'autre ne le
demande : un build qui transférerait un projet managé vers une image de conteneur dont il devient
responsable est refusé tant que vous ne l'avez pas explicitement demandé. `--force` avait auparavant cette signification, ce qui plaçait
l'action la moins réversible de la CLI sous le même mot que « écraser ce
fichier » ; il s'agit désormais d'une option inconnue plutôt que d'un alias, de sorte qu'un script qui la contient
s'arrêtera.

### La vérification syntaxique avant le téléversement

Les fichiers d'une application statique sont servis exactement tels quels. Lorsque son `build` ne fait que
copier des scripts écrits à la main dans `output`, rien ne les a analysés, et un fichier
contenant une faute de frappe peut être mis en ligne et empêcher le chargement de la page. Avant
tout téléversement, `deploy` analyse donc chaque fichier `.js`, `.mjs` et `.cjs` dans le dossier
`output` de chaque application statique, ainsi que chaque `<script>` inline dans ses fichiers `.html`. Cela
couvre aussi bien une application statique déployée seule que les applications statiques intégrées au
bundle du backend. Une erreur de syntaxe interrompt le déploiement en indiquant le fichier, la ligne et la colonne :

```
✗ A syntax error in the static output, so nothing was deployed:
    web/cloud.js:42:23  Unexpected token
        42 |     return fetch("/api";
Fix it and deploy again, or pass --no-verify to deploy anyway.
```

Avec `--json`, le `code` d'erreur est `syntax_error`. Les scripts inline qu'un navigateur
n'exécute pas en tant que JavaScript sont ignorés : JSON, import maps, templates et tout
autre `type` non-JavaScript, les `<script src>`, ainsi que les scripts contenant encore du
balisage de modèle non rendu tel que `{{ }}`. Un fichier `.js` est validé s'il s'analyse
soit comme un script classique, soit comme un module, car c'est la page qui en décide. Rien
sous `node_modules` n'est lu, pas plus qu'un `--bundle-dir` pré-compilé.
`--no-verify` permet d'ignorer cette vérification pour un déploiement donné.

Surveillez-le :

```bash
rebase cloud logs               # the build log
rebase cloud logs --runtime -f  # what the running app prints, live, until Ctrl-C
rebase cloud status             # what the platform thinks the project is doing
```

`status` signale `blockedOn` et `nextAction`. Lorsque `blockedOn` vaut `null`, la
plateforme travaille activement et le sondage (polling) est la bonne chose à faire ; lorsqu'il mentionne
un élément, cet élément est en attente d'une action de votre part.

## Prévisualiser une modification

```bash
rebase cloud deploy --preview
```

Cela compile et téléverse exactement la même chose qu'un `deploy` classique, mais le sert à une adresse
dédiée, par exemple `https://shop--k3x9ab.rebase.website`. La production continue de
servir ce qu'elle servait auparavant. La commande affiche l'adresse de la prévisualisation dès que le
build est terminé.

Pour conserver la même adresse au fil des déploiements, nommez la prévisualisation. Déployer à nouveau
avec le même nom la met à jour :

```bash
rebase cloud deploy --preview-name new-checkout
```

Ce avec quoi une prévisualisation communique dépend de ce que vous avez déployé :

- **`rebase cloud deploy --preview`** prévisualise le backend, avec ses applications statiques
  intégrées, de la même façon que la production les exécute. Il bénéficie de son propre backend sur
  sa **propre base de données vide**, jamais celle de production. Démarrer sur
  la base de production appliquerait le schéma et les règles d'accès de la prévisualisation à celle-ci.
- **`rebase cloud deploy web --preview`** prévisualiserait une application statique isolée,
  ses pages appelant le backend de **production**. Cela nécessite un control plane
  capable de servir des sites statiques de manière autonome, ce que Rebase Cloud ne prend pas encore en charge : il
  refuse avec `PREVIEW_STATIC_UNSERVED` et ne publie rien. Prévisualisez plutôt
  le backend, qui sert les applications statiques qui y sont intégrées ; un projet
  sans backend managé ne peut pas encore être prévisualisé.

Une prévisualisation ne téléverse aucun code source et n'enregistre ni applications ni noms d'hôte, car chacun de
ces éléments modifierait le projet de production. `--source` et `--eject` ne peuvent pas être
combinés avec `--preview`. Chacun construit une image de conteneur pour la production.

```bash
rebase cloud previews                      # name, address, app, backend, expiry
rebase cloud logs --preview new-checkout   # its build log; -f follows a build still running
rebase cloud logs --runtime --preview new-checkout -f  # what its backend prints
rebase cloud previews delete new-checkout  # stops serving it and drops its database
```

`rebase cloud logs` sans `--preview` concerne toujours la production.

La page **Deployments** de la console liste les mêmes prévisualisations, et permet d'ouvrir, d'afficher les
logs de build ou de supprimer chacune d'elles. La création reste une étape de la CLI.

Une prévisualisation expire une semaine après son dernier déploiement.

À la fin de l'opération, le déploiement vérifie que l'adresse de prévisualisation répond, tout comme pour
un déploiement en production (`--live-timeout <seconds>`, `0` pour ignorer). Le certificat d'une nouvelle
prévisualisation pouvant prendre une ou deux minutes, un déploiement réussi peut indiquer
que l'adresse ne répond pas encore.

Une prévisualisation de backend est facturée comme une unité d'application à la taille par défaut (100m de CPU
et 384 Mio de mémoire, au tarif de votre application pour sa région et sa capacité),
au prorata de sa durée d'existence, et apparaît dans l'estimation mensuelle
du projet dans la console. `rebase cloud deploy --preview` affiche la même estimation pour
celle-ci, par mois (`cost` sous `--json`). En démarrer une nécessite une carte enregistrée, tout comme un déploiement
en production. Un premier déploiement qui
échoue avant que quoi que ce soit ne tourne est supprimé plutôt que facturé. Un projet peut exécuter
trois prévisualisations de backend simultanément.

Chaque nouvelle adresse de prévisualisation reçoit son propre certificat TLS de Let's Encrypt,
qui autorise 50 nouveaux certificats par semaine pour un domaine, partagés avec tous les sites de production sur celui-ci.
Les prévisualisations peuvent en consommer 20 sur toute période de 7 jours, à l'échelle de la plateforme. Au-delà,
une nouvelle prévisualisation est refusée (`429`, `preview_cert_budget`) avec l'indication du moment où elle pourra
être déployée ; redéployer une prévisualisation existante n'est jamais comptabilisé dans cette limite.

La base de données d'une prévisualisation de backend est une seconde base de données sur l'instance Postgres de **production** :
ses propres données, mais la même instance et le même disque. Elle est limitée à 10
connexions, afin que les prévisualisations n'épuisent pas celles de production, et à 2 Go : une prévisualisation
dont la base dépasse cette taille est mise en pause. Son backend s'arrête, son adresse cesse
de répondre, `rebase cloud previews` et la console l'affichent comme `paused` avec la
raison, et les propriétaires et administrateurs du projet en sont notifiés (`preview.paused`). Ses
données sont conservées jusqu'à son expiration. Déployez-la à nouveau pour la redémarrer (elle sera remise en pause
tant que la base reste trop volumineuse), ou supprimez-la. Une prévisualisation en pause reste
facturée jusqu'à sa suppression ou son expiration. Supprimez les prévisualisations dont vous n'avez plus besoin. Les extensions
installées en production ne sont pas installées dans la base d'une prévisualisation.

Les prévisualisations sont en cours de déploiement progressif. Un control plane qui ne les prend pas encore en charge refusera
`--preview` avec l'erreur `previews_unavailable` et ne déploiera rien.

## Rollback

```bash
rebase cloud deployments
rebase cloud rollback
```

Un rollback redirige le projet vers ce qu'un déploiement réussi précédent
avait fourni, sans jamais recompiler — tout l'intérêt d'un rollback réside dans le déploiement d'un
artefact qui a déjà fonctionné.

Les déploiements éligibles dépendent du mode de déploiement du projet, et les deux types
fonctionnent :

| Comment il a été déployé | Ce qui est restauré |
|---|---|
| `rebase cloud deploy` (un build source) | L'image publiée par ce build |
| `rebase cloud deploy --bundle` (le runtime de la plateforme) | Le bundle livré par ce déploiement, sur la version de runtime que le projet utilise actuellement |

Les applications statiques intégrées dans le bundle du backend (un simple `rebase cloud deploy` sur
un projet disposant d'un backend) font partie de ce bundle, elles reviennent donc en arrière avec lui.

Une application statique déployée individuellement (`rebase cloud deploy <app>`) ne peut pas encore
faire l'objet d'un rollback. Son déploiement enregistre l'application publiée, mais aucun bundle, le
control plane n'a donc rien à partir de quoi la restaurer. La solution consiste à redéployer la dernière
version valide, par exemple à partir du commit précédant le commit défaillant. Après un tel
déploiement, `deploy` l'indique au lieu de suggérer `rollback`, et `rollback`
sans identifiant refuse l'opération plutôt que de redéployer le backend en cours d'exécution.

Un rollback nécessite donc un déploiement ayant enregistré l'un des deux, ce qui implique
un projet ayant été déployé avec succès au moins deux fois. `rebase cloud deployments`
indique ceux qui sont éligibles, et `--json` renvoie `rollbackable` pour chaque ligne ainsi
que l'`image` ou le `bundle` qui serait restauré.

Deux cas de déploiements sont refusés, et la CLI précise lequel : un qui n'a pas abouti,
et un antérieur à l'enregistrement des artefacts par la plateforme. Il n'y a rien à deviner
dans les deux cas — faire des suppositions reviendrait à livrer ce qui a été compilé ou téléversé
le plus récemment tout en prétendant restaurer celui-ci — redéployez donc plutôt la version de votre choix.

Chaque déploiement réussi se termine en indiquant la commande de retour en arrière (`rebase cloud rollback`),
afin qu'elle reste visible au moment où une version défectueuse est constatée.

Un rollback ajoute un nouveau déploiement plutôt que de remonter l'historique, et attend
que la version restaurée soit active avant d'indiquer le succès. Suivez
l'opération avec `rebase cloud logs -f`.

## Restaurer la base de données à un instant précis (Point-in-Time Recovery)

Une base de données managée peut être restaurée à n'importe quelle minute de sa fenêtre de récupération,
depuis **Database → Backups** dans la console ou via la CLI :
`rebase cloud db pitr status | restore --target <ISO> | cutover | discard`.
Cela s'effectue en deux étapes. D'abord, une copie restaurée est préparée (staged) à côté de la base de données active ;
votre application continue de fonctionner sur la base active, et le stockage de la copie est facturé jusqu'à
ce que vous effectuiez le basculement (cutover) ou que vous l'abandonniez (discard).
Ensuite, une fois la copie prête, le basculement redirige l'application vers celle-ci et la redémarre.
Tout élément écrit après l'heure cible ne figure pas dans la copie. La base de données d'origine
est conservée comme solution de secours et continue d'être facturée pour son stockage ; revenir en arrière,
la supprimer ou effectuer une seconde restauration nécessite de contacter le support. Seul un propriétaire (owner) ou un administrateur
peut préparer, basculer ou abandonner, et la console demande le nom du projet avant d'effectuer le basculement.

## Sécuriser votre compte

Votre compte de console a accès aux bases de données de production, aux secrets et à la facturation :
protégez-le en conséquence. Ouvrez **Account security** depuis le menu sous votre avatar
dans la console (ou rendez-vous sur `/account`). Cette page vous appartient, elle n'est pas
liée à une organisation : ce que vous y configurez s'applique à toutes les organisations auxquelles vous appartenez.

- **Validation en deux étapes.** Activez-la avec n'importe quelle application d'authentification (1Password,
  Google Authenticator, Authy). La page présente une clé de configuration à ajouter à l'application, ou un
  lien qui ouvre l'application avec la clé préremplie sur un téléphone, puis demande le
  code à 6 chiffres affiché par l'application. Dès lors, chaque connexion requiert un code,
  que vous vous connectiez avec un mot de passe, Google ou GitHub.
- **Codes de secours.** L'activation génère dix codes à usage unique, affichés une seule fois.
  Chacun d'eux vous permet de vous connecter à la place du code d'authentification si vous perdez votre
  téléphone ; enregistrez-les donc avant de fermer la boîte de dialogue. **New recovery codes**
  les remplace, et les anciens cessent de fonctionner. La désactivation de la validation en deux étapes
  et la génération de nouveaux codes nécessitent toutes deux la saisie préalable d'un code.
- **Mot de passe.** Le modifier vous déconnecte de tous les autres appareils. Un compte
  créé avec Google, GitHub ou LinkedIn n'a pas de mot de passe ; la page propose de
  vous envoyer un lien par e-mail pour en définir un.
- **Appareils connectés.** Chaque navigateur et terminal connecté à votre compte,
  avec son adresse et la date de connexion. Déconnectez tout appareil que vous ne
  reconnaissez pas, ou tous en même temps.

Les [jetons d'accès](/docs/deployment/cloud-agents/#ci-and-agents) ne sont pas des sessions et ne demandent pas de second
facteur, la CI continue donc de déployer après leur activation. Révoquez un jeton auquel vous ne
faites plus confiance sous **Settings → Access tokens**.

## Inviter votre équipe

**Members → Invite member** fournit un lien à copier (envoyé par e-mail lorsque ce control plane
prend en charge l'envoi d'e-mails) valable une seule fois, pendant 7 jours, pour un compte ayant vérifié cette
adresse ; personne ne rejoint l'organisation tant que l'invitation n'a pas été acceptée. Invitez un administrateur ou un membre, et
nommez-le propriétaire (owner) une fois qu'il a rejoint l'organisation. Les propriétaires et administrateurs peuvent voir, renvoyer ou révoquer l'invitation dans
**Pending invitations** ; depuis un terminal, utilisez [`rebase cloud orgs members invite`](/docs/cli/cloud/#organizations).

## Voir qui a fait quoi

La page **Activity** de la console et la commande `rebase cloud activity` indiquent aux
propriétaires et administrateurs de l'organisation qui a déployé, défini ou affiché une variable
d'environnement (par son nom, jamais par sa valeur), modifié un domaine, restauré une sauvegarde,
redimensionné, arrêté ou supprimé un projet, changé le rôle d'un membre ou créé un
jeton, et à quel moment. Les **Settings** d'un projet pointent vers ses propres entrées ; une entrée
relative à un projet supprimé est conservée. Un script peut les lire à l'aide d'un jeton créé avec
la permission `--can audit` sur l'organisation. Les entrées sont conservées pendant un an. Les filtres sont décrits dans
[`rebase cloud`](/docs/cli/cloud/#organizations).

## CI et agents

Un job CI ou un agent ne doit pas transporter votre mot de passe. Attribuez-lui un jeton limité à
quelques actions sur un seul projet, créé depuis un terminal connecté avec
`rebase cloud tokens create --project shop --can deploy,logs`, et définissez-le comme
`REBASE_TOKEN`. La facturation, le journal d'activité et les paramètres de notification
d'une organisation sont des autorisations distinctes (`--can billing`, `audit`,
`notifications`) qu'un jeton ne détient que si elles sont expressément demandées. Les autorisations, un
workflow GitHub Actions et les privilèges réservés aux personnes connectées sont détaillés dans
[CI et agents](/docs/deployment/cloud-agents/#ci-and-agents).

## Un backend sans compte

`rebase cloud init --claim` fournit à une application un backend actif avant même que quiconque ne soit
inscrit, et affiche une URL de revendication (claim URL) permettant à l'utilisateur de le conserver ; un projet que personne ne revendique
sous 72 heures est supprimé. Les actions autorisées pour le jeton d'un projet non revendiqué, la variable
`REBASE_API_TOKEN` qu'il génère et les changements apportés par la revendication sont décrits dans
[Un backend sans compte](/docs/deployment/cloud-agents/#a-backend-with-no-account).

## Ressources de calcul et tarification

Le tarif d'un projet est calculé d'après ce qu'il réserve, et non selon un forfait fixe. `compute` affiche
chaque curseur de configuration et le devis détaillé établi par le control plane. (`rebase cloud
resources` est une commande différente : elle liste les bases de données et les buckets déclarés par le code,
et indique si chacun est provisionné — voir la [référence CLI](/docs/cli/cloud/).)

```bash
rebase cloud compute
rebase cloud compute set --cpu 500m --memory 2Gi
```

| Paramètre | Unité et signification |
|---|---|
| `--cpu`, `--memory` | Demande (request) de l'application par instance, ex. `500m` et `2Gi`. Vide signifie la valeur par défaut de la plateforme — `100m` et `384Mi`, avec des pointes possibles à 2 CPU et `2Gi` |
| `--replicas` | Instances existant en permanence : le plancher de l'autoscaler, et ce que l'abonnement du projet facture chaque mois |
| `--autoscale-max` | 1–16. Le plafond qu'il peut atteindre. Les instances que l'autoscaler ajoute au-delà de `--replicas` sont décomptées à la seconde-pod aux mêmes tarifs, et facturées uniquement là où la plateforme a activé cette option ; **Usage this month** l'indique. `--no-autoscale` le désactive |
| `--autoscale-cpu-target` | 10–95. L'utilisation CPU visée par l'autoscaler, par rapport à la demande (request) plutôt qu'à la limite. Vide signifie 70 |
| `--spot` | `true` ou `false`. Capacité préemptible : moins chère, mais redémarrée sans préavis |
| `--db-instances` | 1–3. `1` correspond à une instance unique sans basculement (failover) ; `2` ajoute une instance de secours (standby) automatique |
| `--db-cpu`, `--db-memory` | Par instance de base de données. Vide signifie `160m` et `1Gi` |

Un paramètre laissé vide n'est pas équivalent à un paramètre fixé à cette même valeur : un paramètre vide
suit la valeur par défaut de la plateforme et évolue en même temps qu'elle.

Rien n'est validé par la CLI, à dessein — les limites relèvent du cluster sur lequel
s'exécute un projet, et diffèrent selon les fournisseurs. Le control plane refuse toute
valeur qu'il ne peut honorer et nomme le champ concerné. Exécutez `rebase cloud compute` pour voir
le montant en €/mois avant et après ; une modification s'applique immédiatement, au prorata à compter d'aujourd'hui,
sauf celle qui redémarre la base de données, qui attendra une fenêtre de maintenance.

## Le reste des commandes

| Groupe de commandes | Ce qu'il couvre |
|---|---|
| `login`, `logout`, `whoami`, `access-token` | Votre session ; `access-token` affiche le jeton bearer que la CLI enverrait actuellement, pour les scripts et le serveur MCP |
| `tokens` | Jetons pour la CI et les agents, chacun restreint à un seul projet. Voir [CI et agents](/docs/deployment/cloud-agents/#ci-and-agents) |
| `link`, `unlink`, `use`, `open` | Lier ce répertoire à un projet, sélectionner une organisation, ouvrir la console |
| `connect` | Ajouter un serveur Rebase auto-hébergé à votre compte, afin que le [connecteur Rebase](/docs/ai/rebase-connector/#add-your-self-hosted-instances) dans Claude y accède aux côtés de vos projets Cloud. `--list` les affiche, `--remove` en supprime un. Propriétaires et administrateurs |
| `init`, `claim` | Avec `--claim` : un backend actif sans compte, et un lien pour le revendiquer ; `claim` affiche à nouveau ce lien. Voir [Un backend sans compte](/docs/deployment/cloud-agents/#a-backend-with-no-account) |
| `projects` | Créer, lister, inspecter, supprimer |
| `deploy`, `logs`, `deployments`, `rollback`, `cancel` | Déployer et surveiller |
| `deploy-hooks` | URL secrètes qu'un hébergeur git ou un outil de CI appelle pour déployer le projet : lister, créer (l'URL n'est affichée qu'une fois), révoquer. |
| `previews` | Builds servis sur leur propre adresse via `deploy --preview`, et leur suppression. Voir [Prévisualiser une modification](#preview-a-change) |
| `start`, `stop`, `restart` | Mettre en pause un projet et le réactiver. Un projet arrêté conserve son abonnement, à moins que la plateforme ne facture aux projets arrêtés uniquement le stockage et les frais de plateforme ; la ligne **Billing** de la console le précise le cas échéant |
| `status`, `metrics`, `debug` | Ce qu'il fait, et pourquoi il ne le fait pas |
| `alerts` | Incidents en cours du projet, acquittement ou mise en veille d'un incident. |
| `cron` | Tâches cron de l'application déployée et historique de leurs exécutions, lus avec vos identifiants `rebase cloud`. Lecture seule |
| `env` | Variables d'environnement. `list` n'affiche jamais les valeurs ; `--secret` est en écriture seule |
| `app-key` | La clé que `init --claim` a écrite dans `.env` sous `REBASE_API_TOKEN`, transmise lors de la revendication ; `rotate` la remplace et révoque l'ancienne. Propriétaires et administrateurs |
| `service-key` | `REBASE_SERVICE_KEY`, administrateur sur l'API propre de l'application : date de sa dernière rotation ; `rotate` en attribue une nouvelle à l'application. Propriétaires et administrateurs |
| `domains` | Domaines personnalisés, enregistrements DNS à ajouter et vérification. Un projet peut répondre sur plusieurs domaines, chacun vérifié indépendamment ; `verify` et `remove` prennent en paramètre le domaine concerné, qui ne peut être omis que s'il n'en existe qu'un seul (pour `verify`, un seul encore en attente). Chaque domaine vérifié dessert le projet sous sa propre identité ; `primary <domain>` définit le domaine canonique et `redirect <domain>` redirige un autre domaine vers celui-ci avec une 308, en conservant le chemin et les paramètres de requête (`--off` recommence à le servir directement) — faites-le pour `www.` aux côtés d'un domaine apex, car la connexion Google, les cookies et les passkeys sont définis par origine. Un domaine sur lequel une application est servie (un `path` d'application avec un nom d'hôte) ne redirige jamais. `list --json` renvoie `{ projectId, tenantHost, domains: [...] }` |
| `db` | Attacher ou créer une base de données, s'y connecter depuis votre machine, sauvegardes, restauration et récupération à un instant précis (point-in-time recovery) |
| `guests` | Utilisateurs invités générés par la connexion anonyme : les compter, en supprimer un, purger ceux qui n'ont pas été vus depuis longtemps. Voir [Guests](/docs/cli/cloud/#guests). Propriétaires et administrateurs |
| `extensions` | Liste d'autorisation (allowlist) des extensions Postgres |
| `storage` | Le bucket du projet |
| `resources` | Bases de données et buckets hébergés par la plateforme, par rapport à ce que le code déclare |
| `compute` | Ce que ce projet réserve, ce qu'il coûte et comment le modifier |
| `events` | Événements survenus sur le backend, du plus récent au plus ancien : dimensionnement de l'application, modifications de base de données planifiées et appliquées, basculement vers une instance de secours, extension du disque |
| `usage` | Requêtes consommées ce mois-ci par rapport au quota inclus, et dépassement actuel tel que comptabilisé sur la facture. `usage org` liste tous les projets de l'organisation |
| `clusters` | Clusters sur lesquels tournent les environnements clients. Administrateurs de plateforme uniquement |
| `settings`, `orgs`, `billing` | Paramètres du projet, organisations ainsi que leurs membres et invitations, paiement |
| `activity` | Journal d'audit de l'organisation : qui a déployé, modifié une variable d'environnement (par nom), un domaine, une sauvegarde, un membre ou un jeton. Propriétaires et administrateurs. Voir [Voir qui a fait quoi](#see-who-did-what) |
| `notifications` | Emplacement où les événements du projet sont envoyés par POST : Slack, Discord ou toute URL https ([Notifications Cloud](/docs/deployment/cloud-notifications/)) |

Chaque groupe de ce tableau répond à `--help` par une page dédiée — une ligne d'utilisation,
ses options et des exemples — et `--help` n'exécute jamais la commande. Un test vérifie
l'index de ces pages ; ainsi, un groupe ajouté sans page dédiée fait échouer le build plutôt que de
renvoyer la table des matières. `verify:docs` aligne ce tableau sur cet
index : chaque groupe géré par la CLI apparaît ici exactement une fois, de sorte qu'un groupe
ajouté sans ligne correspondante fait également échouer le build.

Dans un pipe, `--help` renvoie du JSON à la place : la même ligne d'utilisation, les options et les exemples
sous forme de structure lisible plutôt que soixante lignes de séquences d'échappement pour terminal.

## Ce que la bêta n'inclut pas

Clairement énoncé, car le découvrir plus tard serait pire :

- **Pas de choix de région.** Tout s'exécute dans une seule région aujourd'hui. Le modèle de
  placement existe au sein de la plateforme, mais un projet ne peut pas choisir sa région.
  `projects create --provider` et `--region` ne font pas exception :
  ils enregistrent simplement la cible de déploiement déclarée du control plane à laquelle
  appartient un projet ; n'en existant qu'une seule, ils prennent tous deux cette valeur par défaut et aucun des deux ne
  déplace un projet ailleurs. `rebase cloud projects create --help` précise la même chose.
- **Pas de libre-service.** Les accès sont accordés par vagues ; il n'y a pas d'inscription avec paiement direct.
- **Aucun SLA publié**, et pas de conformité SOC 2. Si vous avez besoin de l'un ou l'autre, mentionnez-le
  lors de votre demande d'accès plutôt que de le présumer.
- **Pas de déploiements par branche**, et pas d'application GitHub officielle. Les deploy hooks — des URL secrètes
  vers lesquelles pointer un webhook de dépôt — constituent l'automatisation prise en charge. Les [déploiements de
  prévisualisation](#preview-a-change) sont en cours de déploiement et sont déclenchés depuis la CLI.
- **Les jetons agissent en tant que personne.** Un [jeton](/docs/deployment/cloud-agents/#ci-and-agents) est généré par un compte
  et agit en son nom ; il n'existe pas encore d'identité machine propre à une organisation. Si vous
  vous connectez plutôt depuis la CI, transmettez `REBASE_CLOUD_EMAIL` et `REBASE_CLOUD_PASSWORD`
  depuis un gestionnaire de secrets — `--password` place le mot de passe dans l'historique de votre shell et
  dans la table des processus, et vous en avertit avant la connexion. Si le fichier
  `.rebase/cloud.json` du dépôt mentionne un control plane autre que celui de la plateforme, passez-le
  également avec `--url` : sans terminal, `login` refuse d'envoyer un mot de passe à un
  hôte uniquement désigné par le fichier extrait du dépôt.
- **Aucun endpoint public de base de données.** Une base de données managée n'est pas exposée à
  Internet ; l'hôte affiché par la console correspond à son adresse pour votre backend et ne
  résout rien sur votre machine locale. `rebase cloud db connect` ouvre un port local
  redirigeant vers cette base de données via un tunnel traversant le control plane, aussi longtemps
  que vous le laissez tourner — mais il n'existe aucun nom d'hôte permanent auquel un service tiers
  puisse se connecter. Ce tunnel, tout comme le mot de passe révélé par
  `rebase cloud db info --reveal`, nécessitent le rôle de propriétaire (owner) ou d'administrateur
  de l'organisation : le même que celui exigé par l'éditeur SQL de Studio, car tous trois aboutissent à
  une session sur vos données de production.
- **Déployer revient à exécuter du code avec les secrets de production.** L'environnement
  de l'application contient `REBASE_SERVICE_KEY` (administrateur sur sa propre API),
  `DATABASE_URL` et `JWT_SECRET` ; le code déployé par un membre peut donc les lire,
  même si seuls les propriétaires et administrateurs peuvent les afficher dans la console. N'invitez
  comme membre qu'une personne à qui vous confieriez ces valeurs.
- **La clé de service peut être remplacée.** Les **Settings** du projet
  (ou `rebase cloud service-key rotate`) génèrent une nouvelle `REBASE_SERVICE_KEY`
  et redémarrent l'application avec celle-ci. L'ancienne clé fonctionne jusqu'à ce que le redémarrage soit
  terminé, et plus du tout ensuite, de sorte que toute entité l'ayant copiée sera rejetée à
  partir de ce moment. La revendication d'un projet effectue la même opération.

## Choisir l'auto-hébergement

Rien ici ne vous enferme dans la solution (pas de vendor lock-in). Le [guide d'auto-hébergement](/docs/deployment/self-hosting/)
exécute exactement la même image et le même bundle avec `docker compose`, et le
[guide Kubernetes](/docs/deployment/kubernetes/) déploie la même topologie à partir
du Helm chart.
