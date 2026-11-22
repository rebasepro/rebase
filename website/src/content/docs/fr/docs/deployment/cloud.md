---
sourceHash: a6cdd8811eca0897
title: Rebase Cloud
sidebar_label: Rebase Cloud
description: Rebase Cloud est le même Rebase, opéré pour vous. Ce que c'est, comment lier et déployer un projet, et ce que la bêta privée n'inclut pas encore.
---

Rebase Cloud exécute le même Rebase open source que vous hébergeriez vous-même — la même
image `rebasepro/server` publiée, le même bundle, le même Postgres. La
différence réside dans la personne qui l'opère.

:::note[Bêta privée]
Rebase Cloud est en **bêta privée**. Il héberge de véritables tenants aujourd'hui et ouvre
par vagues. [Demander un accès](https://rebase.pro/pricing).

Il n'est pas en libre-service, donc les commandes ci-dessous nécessitent un compte ayant été
accepté. Tout le reste sur ce site fonctionne sans compte.
:::

## Ce que c'est

Un **projet** Cloud correspond à trois éléments que la plateforme gère pour vous :

| | Ce que vous obtenez |
|---|---|
| **Application** | Votre bundle, s'exécutant sur l'image d'exécution publiée. Les déploiements sont un téléversement de bundle, pas une construction de conteneur |
| **Base de données** | Un PostgreSQL géré, avec sauvegardes automatisées et restauration à un instant précis (point-in-time recovery) |
| **Stockage** | Votre propre bucket, si votre projet utilise le stockage de fichiers |

L'application et la base de données sont provisionnées lors de votre premier déploiement ; un bucket
uniquement lorsque vous en faites la demande ([Stockage de fichiers](#stockage-de-fichiers)). Chacun est facturé
en fonction de ce qu'il réserve plutôt que par utilisateur.

**Rien ne change dans votre projet pour s'y exécuter.** Le même dépôt
s'auto-héberge avec `docker compose`, et la porte de sortie est bien réelle : `rebase build`
produit un bundle qui démarre partout où l'image d'exécution peut tourner.

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
pas connecté à la console, connectez-vous-y d'abord avec le moyen de votre choix,
y compris Google et GitHub. En SSH, `rebase cloud login --no-browser` affiche le lien
à ouvrir sur votre propre machine.

`projects create` ne prend aucun argument positionnel. Le nom et le sous-domaine sont
des options (flags), et tous deux sont obligatoires — ils sont demandés interactivement
dans un terminal, et une exécution non interactive qui omet l'un d'eux se termine avec `input_required` plutôt que d'en inventer
un. **Le sous-domaine n'est pas modifiable ultérieurement :** c'est l'hôte
`<slug>.rebase.website` sur lequel le projet répond, choisissez-le donc avec soin.

`--link` lie ce répertoire au projet dans le même appel, évitant ainsi une étape
`link` distincte. Il écrit `.rebase/cloud.json`, qui enregistre l'identifiant et
le slug du projet. Ce fichier n'est pas un secret et ne contient pas vos identifiants — ceux-ci
résident dans `~/.rebase/credentials.json`, écrit par `login`.

Il est toutefois commité avec le code, de sorte qu'un dépôt cloné peut désigner n'importe quel
plan de contrôle (control plane). Lorsque l'hôte provient uniquement de ce fichier et qu'il ne s'agit ni de celui
de la plateforme ni d'un hôte auquel vous vous êtes connecté auparavant, `login` le nomme et demande confirmation
avant d'y envoyer votre e-mail et votre mot de passe. Sans terminal, ou avec
`--json`, il refuse avec `unknown_control_plane` ; passez `--url <host>` (ou définissez
`REBASE_CLOUD_URL`) pour vous y connecter délibérément.

Pour vous connecter sans navigateur, renseignez votre e-mail : `rebase cloud login --email
me@example.com` vous demande votre mot de passe. **Inscrit avec Google, GitHub ou
LinkedIn ?** Votre compte n'a pas de mot de passe, utilisez donc un code à la place :

```bash
rebase cloud login --code --email me@example.com
```

Le plan de contrôle vous envoie un code à 6 chiffres par e-mail, valide pendant dix minutes, que vous
saisissez dans l'invite. Avec `--email` et aucun mot de passe, `rebase cloud login` demande
s'il faut utiliser votre mot de passe ou un code. Les codes nécessitent que le plan de contrôle soit en mesure d'envoyer
des e-mails ; s'il ne le peut pas, `--code` le signale et quitte avec `otp_unavailable`.

Si vous avez activé l'authentification à deux facteurs, `login` vous demande alors le code de
votre application d'authentification ou l'un de vos codes de récupération, quelle que soit la méthode
de connexion utilisée. Via le navigateur, la console vous le demande lors de votre connexion. Ni un code de connexion ni un second facteur ne peuvent être saisis sans terminal.
Pour un script, créez un jeton d'accès dans la console (**Settings → Access
tokens**) et définissez `REBASE_TOKEN` ; voir [CI et agents](/docs/deployment/cloud-agents/#ci-and-agents).

Un mot de passe erroné renvoie `invalid_credentials` avec les deux mêmes options d'accès, la
cause habituelle étant un compte qui n'en a jamais eu.

`billing setup` associe une carte à l'organisation, une seule fois. Cette commande est intentionnellement
placée en premier dans la séquence : le premier déploiement d'un projet est refusé sans carte, et
s'en apercevoir une fois le bundle téléversé est bien plus frustrant.

Ensuite, la page **Billing** de la console liste les factures de l'organisation,
chacune avec sa page hébergée par Stripe et son PDF, et donne un aperçu de la prochaine facture de chaque
projet. `rebase cloud billing invoices` et `rebase cloud billing upcoming`
affichent la même chose. Les deux s'adressent aux propriétaires et administrateurs de l'organisation. Lorsque la
plateforme le propose, **Manage billing** ouvre le portail client de Stripe pour
la carte, les détails de facturation et l'historique des factures.

Si une carte est déjà enregistrée, la création d'un autre projet dans la console ne nécessite
aucun second paiement : le projet est facturé sur cette carte et se déploie. Si la carte
est refusée ou si la banque demande une confirmation du paiement, la console vous redirige vers
**Billing**, où **Fix your card** permet d'enregistrer une autre carte et **Complete the
payment** ouvre la facture Stripe.

L'utilisation d'un projet s'affiche sur sa vue d'ensemble, sous **Usage this month**, et
pour tous les projets à la fois sur la page **Billing** : requêtes par rapport au
quota inclus (la barre devient orange à 80 %), erreurs 5xx, dépassement actuel
et projection pour la fin du mois à ce rythme. Le dépassement est calculé par
le même code que celui qui le transmet à Stripe, il correspond donc exactement à ce qui figurera sur la facture ; il
apparaît sur la facture du mois suivant. `rebase cloud usage` affiche ces
mêmes informations, et `rebase cloud usage org` pour l'ensemble de l'organisation. Tout membre peut
les consulter. Les chiffres précisent ce qu'ils ne peuvent pas encore mesurer : le stockage d'objets n'est pas mesuré,
aucun dépassement de stockage n'est donc facturé ; tant qu'un projet exécute deux pods applicatifs ou plus,
ses requêtes ne sont pas comptabilisées ; et une journée avec des échantillons manquants sous-estime le total. Un
projet avec autoscaling affiche également les pods exécutés au-delà de `--replicas`, en heures-pods,
leur coût selon ses propres tarifs et si cette plateforme les facture déjà. Un
projet réclamé depuis un agent ne compte que les jours à partir de la réclamation : avant
cela, le projet appartenait à la plateforme.

Un projet existant se lie sans en créer un nouveau :

```bash
rebase cloud projects list
rebase cloud link --project my-app
```

## Déployer

```bash
rebase cloud deploy
```

Une seule commande, et aucun flag à mémoriser. Le `rebase.json` d'un projet généré déclare
`runtime: "managed"` pour son backend, et `deploy` lit cette déclaration — il
l'indique au passage (`rebase.json declares runtime: managed — deploying a
bundle`), compile l'application dans `dist-bundle`, téléverse le bundle, l'exécute sur
l'image d'exécution publiée et suit le déploiement jusqu'à un état final. Le code de sortie
fait foi, cette même ligne fonctionne donc de manière autonome dans un pipeline CI.

Elle se termine en indiquant où chaque application répond désormais et si la nouvelle version
y est bien en ligne :

```text
  ✓ Deployed songbuzz in 1m 12s  (deployment fb3c7442-9937-4179-8d3c-88a106da149d)

    game     static   https://songbuzz.rebase.website      live
    backend  backend  https://songbuzz.rebase.website/api  live

  ✓ Live: the new version answers on every address above.
  Something wrong? `rebase cloud rollback` puts the previous deployment back.
```

« Live » signifie que l'adresse a répondu après le build : le `/health` d'un backend a
renvoyé `ok`, et la page d'une application statique a chargé (depuis ce déploiement, lorsque
la plateforme la sert). Cette vérification attend jusqu'à `--live-timeout` secondes, 60 par
défaut ; `0` l'ignore. Si une application ne répond pas à temps, le déploiement se termine tout de même avec
le code zéro, car le déploiement a réussi, et la dernière ligne indique quelle application n'a pas
répondu et pourquoi. Un déploiement ayant échoué se termine au contraire sur une seule ligne, en nommant l'application et
la cause de l'échec, avec `rebase cloud logs` pour consulter l'intégralité du journal de build.

Les scripts passent `--json` pour recevoir un objet unique contenant ces mêmes faits — `apps`, `hosts`,
`live`, `liveChecks`, `durationMs` et l'identifiant du déploiement. Contrairement au reste de
`rebase cloud`, `deploy` ne bascule pas automatiquement en JSON lorsqu'il est utilisé dans un pipe.

Ce que cet environnement d'exécution autorise — paquets et modules natifs, mémoire et instances,
délais d'expiration (timeouts) et tailles de requêtes, système de fichiers, secrets, stockage et réseau
sortant — est détaillé sur sa propre page :
[Environnement d'exécution backend géré](/docs/deployment/managed-runtime/).

Pour livrer un artefact déjà compilé — par exemple un job CI qui compile une fois et
déploie deux fois — pointez vers le répertoire au lieu de recompiler :

```bash
rebase build
rebase cloud deploy --bundle-dir dist-bundle
```

Quitter l'environnement géré dispose de son propre flag, `--eject`, et rien d'autre ne
le déclenche : un build qui ferait passer un projet géré vers une image de conteneur dont
il est ensuite propriétaire est refusé tant que vous ne l'avez pas explicitement demandé. `--force` avait autrefois cette signification, ce qui
plaçait l'action la moins réversible de la CLI sous le même mot que « écraser ce
fichier » ; il s'agit désormais d'une option inconnue plutôt que d'un alias, de sorte qu'un script
qui la contient s'arrête net.

### La vérification syntaxique avant le téléversement

Les fichiers d'une application statique sont servis exactement tels quels. Lorsque son `build` se contente de
copier des scripts écrits à la main dans `output`, rien ne les a analysés, et un fichier
contenant une coquille passe en production et empêche la page de se charger. C'est pourquoi, avant tout
téléversement, `deploy` analyse chaque fichier `.js`, `.mjs` et `.cjs` dans le dossier `output` de chaque
application statique, ainsi que chaque `<script>` inline dans ses fichiers `.html`. Cela
s'applique aussi bien à une application statique déployée seule qu'aux applications statiques intégrées au
bundle du backend. Une erreur de syntaxe interrompt le déploiement en indiquant le fichier, la ligne et la colonne :

```
✗ A syntax error in the static output, so nothing was deployed:
    web/cloud.js:42:23  Unexpected token
        42 |     return fetch("/api";
Fix it and deploy again, or pass --no-verify to deploy anyway.
```

Avec `--json`, le `code` de l'erreur est `syntax_error`. Les scripts inline qu'un navigateur
n'exécute pas en tant que JavaScript sont ignorés : JSON, import maps, templates et tout
autre `type` non-JavaScript, un `<script src>`, ainsi qu'un script contenant encore des
balises de template non interprétées telles que `{{ }}`. Un fichier `.js` est validé s'il s'analyse
soit comme un script classique, soit comme un module, car c'est la page qui en décide. Rien dans
`node_modules` n'est lu, pas plus qu'un `--bundle-dir` précompilé.
`--no-verify` permet d'ignorer la vérification pour un déploiement.

Surveillez-le :

```bash
rebase cloud logs               # the build log
rebase cloud logs --runtime -f  # what the running app prints, live, until Ctrl-C
rebase cloud status             # what the platform thinks the project is doing
```

`status` indique `blockedOn` et `nextAction`. Lorsque `blockedOn` est `null`, la
plateforme travaille activement et le sondage (polling) est approprié ; lorsqu'il mentionne un
élément, c'est que cet élément attend une action de votre part.

L'un d'eux est `email_not_configured` : l'application a activé la connexion par magic link ou par
code e-mail (`AUTH_MAGIC_LINK`, `AUTH_EMAIL_OTP`) mais ne dispose d'aucun service d'e-mail, de sorte que
le déploiement est en ligne mais que personne ne peut s'y connecter. Rebase Cloud n'envoie pas
d'e-mails pour votre application : configurez `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` et
`SMTP_FROM` avec `rebase cloud env set`, puis déployez. `status` lit cette information depuis l'endpoint
`GET /api/auth/config` propre à l'application (son champ `unavailable`), et `deploy` indique la
même chose sous sa vérification en direct.

## Stockage de fichiers

Un nouveau projet ne possède aucun bucket : les téléversements sont refusés avec `501 STORAGE_NOT_CONFIGURED`,
et le récapitulatif du déploiement l'indique, plutôt que d'écrire sur un disque que chaque déploiement réinitialise.

Fournissez-lui l'une des deux options, puis déployez à nouveau pour que l'application la prenne en compte :

```bash
# A bucket Rebase runs for you. The console's Storage page does the same.
rebase cloud storage create

# Or your own S3-compatible bucket: AWS S3, Cloudflare R2, Backblaze B2, MinIO…
rebase cloud storage attach --bucket <name> \
  --access-key-id <id> --secret-access-key <secret> \
  --endpoint <url>        # omit for AWS; add --force-path-style for MinIO

rebase cloud deploy
```

`rebase cloud storage` liste les buckets du projet. Un projet en comptant plusieurs
associe chacun avec `--source <key>` ; un projet qui configure le stockage dans le code n'a besoin ni de l'un ni de l'autre.

## Prévisualiser une modification

```bash
rebase cloud deploy --preview
```

Cela compile et téléverse exactement la même chose que `deploy`, mais le sert à une adresse
dédiée, telle que `https://shop--k3x9ab.rebase.website`. La production continue de
servir ce qu'elle servait auparavant. Le déploiement affiche l'adresse de la prévisualisation lorsque la
compilation se termine.

Pour conserver une même adresse au fil des déploiements, nommez la prévisualisation. Déployer à nouveau
sous le même nom la met à jour :

```bash
rebase cloud deploy --preview-name new-checkout
```

Les services avec lesquels communique une prévisualisation dépendent de ce que vous avez déployé :

- **`rebase cloud deploy --preview`** prévisualise le backend, avec ses applications statiques
  intégrées, de la même manière que la production les exécute. Il obtient son propre backend sur
  **sa propre base de données vide**, jamais celle de production. Démarrer sur la base
  de données de production lui appliquerait le schéma et les règles d'accès de la prévisualisation.
- **`rebase cloud deploy web --preview`** prévisualiserait une seule application statique de
  manière autonome, ses pages appelant le backend de **production**. Cela nécessite un plan de contrôle
  qui sert les sites statiques isolément, ce que Rebase Cloud ne prend pas encore en charge : il
  refuse avec `PREVIEW_STATIC_UNSERVED` et ne publie rien. Prévisualisez plutôt le
  backend, qui sert les applications statiques qui y sont intégrées ; un projet sans
  backend géré ne peut pas encore être prévisualisé.

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

La page **Deployments** de la console liste ces mêmes prévisualisations, et permet d'ouvrir, d'afficher
le journal de build ou de supprimer chacune d'elles. La création reste une étape de la CLI.

Une prévisualisation expire une semaine après son dernier déploiement.

Lorsqu'il se termine, le déploiement vérifie que l'adresse de la prévisualisation répond, tout comme
un déploiement de production (`--live-timeout <seconds>`, `0` pour ignorer). Le certificat d'une
nouvelle prévisualisation peut prendre une minute ou deux à s'établir, de sorte qu'un déploiement réussi
peut indiquer que l'adresse ne répond pas encore.

Une prévisualisation de backend est facturée comme une unité d'application à la taille par défaut (100m de CPU
et 384 Mio de mémoire, au tarif de votre application pour sa région et sa capacité),
au prorata de sa durée d'existence, et apparaît dans le devis mensuel du projet
dans la console. `rebase cloud deploy --preview` affiche la même estimation pour
celle-ci, par mois (`cost` sous `--json`). En démarrer une nécessite une carte enregistrée, comme pour
un déploiement en production. Un premier déploiement qui
échoue avant que quoi que ce soit ne s'exécute est supprimé plutôt que facturé. Un projet peut exécuter
trois prévisualisations de backend simultanément.

Chaque nouvelle adresse de prévisualisation reçoit son propre certificat TLS de Let's Encrypt,
qui autorise 50 nouveaux certificats par semaine et par domaine, partagés avec tous les sites de production
sur celui-ci. Les prévisualisations peuvent en consommer 20 sur n'importe quelle période de 7 jours, à l'échelle de la plateforme.
Au-delà, une nouvelle prévisualisation est refusée (`429`, `preview_cert_budget`) en indiquant le moment où elle pourra
être déployée ; redéployer une prévisualisation existante n'est jamais décompté de cette limite.

La base de données d'une prévisualisation de backend est une seconde base de données sur le Postgres de **production** :
ses propres données, mais la même instance et le même disque. Elle est limitée à 10
connexions, de sorte que les prévisualisations ne peuvent pas saturer celles de production, et à 2 Go : une
prévisualisation dont la base dépasse cette taille est mise en pause. Son backend s'arrête, son adresse cesse
de répondre, `rebase cloud previews` et la console l'affichent comme `paused` avec la
raison, et les propriétaires et administrateurs du projet en sont notifiés (`preview.paused`). Ses
données sont conservées jusqu'à son expiration. Déployez-la à nouveau pour la démarrer (elle est remise en pause
tant que la base reste trop volumineuse), ou supprimez-la. Une prévisualisation en pause continue d'être
facturée jusqu'à sa suppression ou son expiration. Supprimez les prévisualisations dont vous n'avez plus besoin. Les extensions installées en production ne sont
pas installées dans la base de données d'une prévisualisation.

Les prévisualisations sont en cours de déploiement progressif. Un plan de contrôle qui ne les prend pas encore en charge refusera
`--preview` avec `previews_unavailable` et ne déploiera rien.

## Roll back

```bash
rebase cloud deployments
rebase cloud rollback
```

Un rollback redirige le projet vers ce qu'un déploiement réussi précédent
avait livré, et ne recompile jamais — l'intérêt d'un rollback réside dans le fait de livrer
un artefact qui a déjà fait ses preuves en cours d'exécution.

L'éligibilité des déploiements dépend du mode de déploiement du projet, et les deux types
fonctionnent :

| Mode de déploiement | Ce qui est restauré |
|---|---|
| `rebase cloud deploy` (compilation depuis la source) | L'image publiée par cette compilation |
| `rebase cloud deploy --bundle` (environnement d'exécution de la plateforme) | Le bundle livré par ce déploiement, sur la version de l'environnement d'exécution actuellement utilisée par le projet |

Les applications statiques intégrées au bundle du backend (un simple `rebase cloud deploy` sur
un projet doté d'un backend) font partie de ce bundle, elles sont donc restaurées en même temps.

Une application statique déployée individuellement (`rebase cloud deploy <app>`) ne peut pas encore faire
l'objet d'un rollback. Son déploiement enregistre l'application publiée, mais aucun bundle, le
plan de contrôle n'a donc rien à partir de quoi la restaurer. La solution consiste à redéployer la dernière
version valide, par exemple à partir du commit précédant l'erreur. Après un tel
déploiement, `deploy` l'indique au lieu d'orienter vers `rollback`, et `rollback`
sans identifiant refuse l'opération plutôt que de redéployer le backend actuellement en service.

Un rollback nécessite donc un déploiement ayant enregistré l'un des deux, ce qui implique
un projet ayant été déployé avec succès au moins deux fois. `rebase cloud deployments`
signale ceux qui sont éligibles, et `--json` indique `rollbackable` pour chaque ligne ainsi
que l'`image` ou le `bundle` qui serait restauré.

Deux types de déploiements sont refusés, et la CLI précise lequel : un qui n'a pas réussi,
et un datant d'avant que la plateforme n'enregistre son artefact. Il n'y a rien à deviner
dans les deux cas — faire des suppositions reviendrait à livrer ce qui a été compilé ou téléversé le
plus récemment tout en prétendant restaurer celui-ci — déployez donc plutôt la version souhaitée.

Chaque déploiement réussi se termine en indiquant la commande de retour en arrière (`rebase cloud rollback`),
afin qu'elle soit directement visible au moment où une mise en production défectueuse est constatée.

Un rollback ajoute un nouveau déploiement plutôt que de remonter l'historique, et attend que
la version restaurée soit active avant d'indiquer le succès. Suivez-le avec
`rebase cloud logs -f`.

## Restaurer la base de données à un instant précis

Une base de données gérée peut être restaurée à n'importe quelle minute dans sa fenêtre de récupération,
depuis **Database → Backups** dans la console ou avec la CLI :
`rebase cloud db pitr status | restore --target <ISO> | cutover | discard`.
Cela s'effectue en deux étapes. D'abord, une copie restaurée est préparée aux côtés de la base en production ;
votre application continue de tourner sur la base active, et le stockage de la copie est facturé jusqu'à ce que
vous effectuiez la bascule (cutover) ou que vous l'abandonniez (discard).
Ensuite, une fois la copie prête, la bascule fait pointer l'application vers celle-ci et la redémarre.
Tout ce qui a été écrit après l'heure cible n'est pas présent dans la copie. La base de données
d'origine est conservée comme recours de secours et continue d'être facturée pour son stockage ; y revenir,
la supprimer ou effectuer une deuxième restauration nécessite de passer par le support. Seul un propriétaire ou un administrateur
peut préparer, basculer ou abandonner, et la console demande le nom du projet
avant d'effectuer la bascule.

## Sécuriser votre compte

Votre compte de console peut accéder aux bases de données de production, aux secrets et à la facturation,
protégez-le donc en conséquence. Ouvrez **Account security** depuis le menu sous votre avatar
dans la console (ou rendez-vous sur `/account`). Cette page vous est propre, elle n'appartient pas à
une organisation : ce que vous y configurez s'applique à toutes les organisations dont vous faites partie.

- **Validation en deux étapes.** Activez-la avec n'importe quelle application d'authentification (1Password,
  Google Authenticator, Authy). La page affiche une clé de configuration à ajouter à l'application, ou un
  lien qui ouvre l'application avec la clé préremplie sur un téléphone, puis demande le
  code à 6 chiffres affiché par l'application. Dès lors, chaque connexion nécessite un code,
  que vous vous connectiez avec un mot de passe, Google ou GitHub.
- **Codes de récupération.** L'activation vous fournit dix codes à usage unique, affichés une seule fois.
  Chacun vous permet de vous connecter à la place du code d'authentification si vous perdez votre
  téléphone, enregistrez-les donc avant de fermer la boîte de dialogue. **New recovery codes**
  les remplace, et les anciens cessent de fonctionner. Désactiver la validation en deux étapes
  et générer de nouveaux codes demandent tous deux un code préalable.
- **Mot de passe.** Le modifier vous déconnecte de tous les autres appareils. Un compte
  créé avec Google, GitHub ou LinkedIn n'a pas de mot de passe ; la page propose de
  vous envoyer un lien par e-mail pour en définir un.
- **Appareils connectés.** Chaque navigateur et terminal connecté à votre compte,
  avec son adresse et sa date de connexion. Déconnectez tout appareil que vous ne
  reconnaissez pas, ou déconnectez-les tous en une seule fois.

Les [jetons d'accès](/docs/deployment/cloud-agents/#ci-and-agents) ne sont pas des sessions et ne demandent pas de second
facteur, la CI continue donc de déployer après leur activation. Révoquez un jeton auquel vous ne faites plus
confiance sous **Settings → Access tokens**.

## Inviter votre équipe

**Members → Add member** permet d'ajouter une personne disposant déjà d'un compte Rebase avec une
adresse e-mail vérifiée, en tant qu'administrateur ou membre ; un propriétaire peut la nommer propriétaire
par la suite. Elle a immédiatement accès et aucun e-mail n'est envoyé. Rebase Cloud n'envoie
pas encore d'invitations, demandez donc à un coéquipier sans compte de s'inscrire et
de vérifier son adresse au préalable. Depuis un terminal :
[`rebase cloud orgs members invite <email>`](/docs/cli/cloud/#organizations), qui
le signale si l'adresse n'a pas de compte.

## Accès Cloud et utilisateurs de votre application

<span class="since-badge" data-since="0.35">Depuis 0.35</span>

Deux ensembles distincts d'utilisateurs sont impliqués, comme dans Firebase et Supabase :

- L'**accès Cloud** concerne les personnes autorisées à travailler sur le projet dans Rebase Cloud. Les
  propriétaires et administrateurs d'une organisation sont `admin` sur chaque projet qu'elle possède, et
  ses membres sont `developer`. Un projet peut également attribuer à une personne un rôle qui
  lui est propre, `admin`, `developer` ou `viewer`, via une invitation par e-mail, sans
  en faire un membre de l'organisation. Le rôle le plus élevé des deux s'applique.
  [`rebase cloud access`](/docs/cli/cloud/#project-access) permet de le gérer.
- Les **utilisateurs de votre application** résident dans la propre base de données de l'application, avec leur
  système d'inscription et leurs rôles. Cloud ne les liste ni ne les modifie jamais.

La seule passerelle est le bouton **Open admin panel**. Il connecte une personne disposant d'un accès Cloud
`admin` au panneau d'administration de l'application, sur la base de son e-mail vérifié : l'application
trouve ou crée le compte avec cette adresse, lui attribue le rôle `admin` et
consigne que ce rôle provient de Rebase Cloud (la section Utilisateurs et rôles de Studio
l'indique). Lorsque cette personne perd son accès Cloud `admin` au projet, Rebase
Cloud demande à l'application de révoquer ce rôle `admin`
et met fin à ses sessions dans l'application. Un rôle accordé manuellement dans l'application,
y compris un rôle `admin` détenu avant la première utilisation de Open admin panel, est conservé, et le
compte n'est jamais supprimé.

## Voir qui a fait quoi

La page **Activity** de la console et `rebase cloud activity` permettent aux
propriétaires et administrateurs de l'organisation de voir qui a déployé, défini ou affiché une variable
d'environnement (par nom, jamais par valeur), modifié un domaine, restauré une sauvegarde,
redimensionné, arrêté ou supprimé un projet, modifié le rôle d'un membre ou créé un
jeton, ainsi que la date et l'heure. La section **Settings** d'un projet renvoie à ses propres entrées ; une entrée
relative à un projet supprimé est conservée. Un script peut les lire grâce à un jeton créé avec
`--can audit` sur l'organisation. Les entrées sont conservées pendant un an. Les filtres sont décrits dans
[`rebase cloud`](/docs/cli/cloud/#organizations).

## CI et agents

Un job CI ou un agent ne doit pas détenir votre mot de passe. Attribuez-lui un jeton restreint à
quelques actions sur un projet précis, créé depuis un terminal connecté via
`rebase cloud tokens create --project shop --can deploy,logs`, et définissez-le comme
`REBASE_TOKEN`. La facturation, le journal d'activité et les paramètres de notification
d'une organisation constituent des autorisations spécifiques (`--can billing`, `audit`,
`notifications`) qu'un jeton ne détient que si elles sont explicitement demandées. Les autorisations, un
workflow GitHub Actions et les éléments qui restent réservés à un utilisateur connecté sont détaillés dans
[CI et agents](/docs/deployment/cloud-agents/#ci-and-agents).

## Un backend sans compte

`rebase cloud init --claim` attribue à une application un backend actif avant même que quiconque ne soit
inscrit, et affiche une URL de réclamation permettant à la personne de le conserver ; un projet que personne ne réclame
dans les 72 heures est supprimé. Les actions autorisées pour le jeton d'un projet non réclamé, le
`REBASE_API_TOKEN` qu'il génère et les changements apportés par la réclamation sont détaillés dans
[Un backend sans compte](/docs/deployment/cloud-agents/#a-backend-with-no-account).

## Ressources de calcul et tarification

Le tarif d'un projet dépend de ce qu'il réserve, et non d'un palier prédéfini. `compute` affiche
chaque paramètre et le devis détaillé fourni par le plan de contrôle pour chacun d'eux. (`rebase cloud
resources` est une commande différente : elle concerne les bases de données et les buckets déclarés par le code,
et indique si chacun est provisionné — voir la [référence de la CLI](/docs/cli/cloud/).)

```bash
rebase cloud compute
rebase cloud compute set --cpu 500m --memory 2Gi
```

| Paramètre | Unité et signification |
|---|---|
| `--cpu`, `--memory` | Demande (request) de l'application par instance, ex. `500m` et `2Gi`. Vide signifie la valeur par défaut de la plateforme, qui dépend de la région (ci-dessous) |
| `--replicas` | Instances qui existent en permanence : le plancher de l'autoscaler, et ce que l'abonnement du projet facture chaque mois |
| `--autoscale-max` | 1–16. Le plafond qu'il peut atteindre. Les instances que l'autoscaler ajoute au-delà de `--replicas` sont mesurées en pod-secondes aux mêmes tarifs, et facturées uniquement là où la plateforme a activé cette option ; **Usage this month** l'indique. `--no-autoscale` le désactive |
| `--autoscale-cpu-target` | 10–95. L'utilisation du CPU ciblée par l'autoscaler, par rapport à la demande (request) plutôt qu'à la limite. Vide équivaut à 70 |
| `--spot` | `true` ou `false`. Capacité préemptible : moins chère, mais redémarrée sans préavis |
| `--db-instances` | 1–3. `1` correspond à une instance unique sans basculement (failover) ; `2` ajoute une instance de secours (standby) automatique |
| `--db-cpu`, `--db-memory` | Par instance de base de données. Vide équivaut à `160m` et `1Gi` |

Un paramètre laissé vide n'est pas identique à un paramètre fixé à ce même chiffre : un paramètre vide
suit la valeur par défaut de la plateforme et s'adapte lorsque celle-ci évolue.

En Belgique (europe-west1), la configuration par défaut réserve 100m de CPU et 384 Mio, avec des pointes possibles
jusqu'à 2 CPU et 2 Gio ; à Falkenstein et Helsinki, la mémoire peut s'étendre jusqu'à 1,4× la
demande et le CPU jusqu'à 10× (au maximum 1,7 vCPU). `rebase cloud compute` affiche les chiffres
propres à votre projet.

Rien n'est validé par la CLI, délibérément — les limites sont propres au cluster sur lequel s'exécute
un projet, et diffèrent d'un fournisseur à l'autre. Le plan de contrôle rejette toute
valeur qu'il ne peut pas honorer et précise le champ concerné. Exécutez `rebase cloud compute` pour voir
le montant en €/mois avant et après ; une modification s'applique immédiatement, calculée au prorata à partir d'aujourd'hui.
Une modification de base de données s'applique dès maintenant ; elle est facturée à la taille actuelle jusqu'à ce qu'elle soit opérationnelle.
Une nouvelle valeur de CPU ou de mémoire pour la base de données, ou une réduction du nombre d'instances, redémarre la base de données (environ
30 secondes à 3 minutes ; les connexions sont interrompues puis rétablies) : `compute set`
l'indique et demande confirmation, et hors terminal `--yes` tient lieu d'accord. Si ce redémarrage
échoue, `rebase cloud compute apply` réessaie.

## Le reste des commandes

| Groupe de commandes | Ce qu'il couvre |
|---|---|
| `login`, `logout`, `whoami`, `access-token` | Votre session ; `access-token` affiche le jeton bearer que la CLI enverrait actuellement, pour les scripts et le serveur MCP |
| `tokens` | Jetons pour la CI et les agents, chacun restreint à un seul projet. Voir [CI et agents](/docs/deployment/cloud-agents/#ci-and-agents) |
| `link`, `unlink`, `use`, `open` | Lier ce répertoire à un projet, sélectionner une organisation, ouvrir la console |
| `connect` | Ajouter un serveur Rebase auto-hébergé à votre compte, afin que le [connecteur Rebase](/docs/ai/rebase-connector/#add-your-self-hosted-instances) dans Claude y accède aux côtés de vos projets Cloud. `--list` les affiche, `--remove` en supprime un. Propriétaires et administrateurs |
| `init`, `claim` | Avec `--claim` : un backend actif sans compte, et un lien pour le réclamer ; `claim` affiche à nouveau ce lien. Voir [Un backend sans compte](/docs/deployment/cloud-agents/#a-backend-with-no-account) |
| `projects` | Créer, lister, inspecter, supprimer |
| `deploy`, `logs`, `deployments`, `rollback`, `cancel` | Déploiement et suivi |
| `deploy-hooks` | URL secrètes qu'un hôte Git ou une CI appelle pour déployer le projet : lister, créer (l'URL n'est affichée qu'une seule fois), révoquer. |
| `previews` | Builds servis sur leur propre adresse via `deploy --preview`, et leur suppression. Voir [Prévisualiser une modification](#prévisualiser-une-modification) |
| `sleep` | Mise en veille en cas d'inactivité : `on [--after 15m\|30m\|1h\|4h]`, `off`, `wake` et `status` (par défaut). En veille, un projet ne consomme ni CPU ni mémoire et la requête suivante le réveille ; les tâches planifiées et le travail en arrière-plan ne s'exécutent pas pendant ce temps. Lorsqu'un projet ne peut pas être mis en veille, le plan de contrôle le refuse et en explique la raison |
| `start`, `stop`, `restart` | Mettre un projet en pause et le réactiver. Un projet arrêté conserve son abonnement, à moins que la plateforme ne facture les projets arrêtés uniquement pour le stockage et les frais de plateforme ; la ligne **Billing** de la console le précise le cas échéant |
| `status`, `metrics`, `debug` | Ce qu'il fait, et pourquoi il ne le fait pas |
| `alerts` | Les incidents ouverts du projet, et leur acquittement ou mise en attente. |
| `cron` | Les tâches cron de l'application déployée et l'historique de leurs exécutions, lus avec vos identifiants `rebase cloud`. En lecture seule |
| `env` | Variables d'environnement. `list` n'affiche jamais les valeurs ; `--secret` est en écriture seule |
| `app-key` | La clé écrite par `init --claim` dans `.env` sous `REBASE_API_TOKEN`, transmise lors de la réclamation ; `rotate` la remplace et révoque l'ancienne. Propriétaires et administrateurs |
| `service-key` | `REBASE_SERVICE_KEY`, admin sur l'API propre à l'application : date de dernière rotation ; `rotate` en fournit une nouvelle à l'application. Propriétaires et administrateurs |
| `domains` | Domaines personnalisés, enregistrements DNS à ajouter et vérification. Un projet peut répondre sur plusieurs domaines, chacun vérifié individuellement ; `verify` et `remove` prennent le domaine sur lequel agir, qui ne peut être omis que s'il n'y en a qu'un seul (pour `verify`, un seul encore en attente). Chaque domaine vérifié dessert le projet sous son propre nom ; `primary <domain>` choisit le domaine canonique et `redirect <domain>` redirige un autre domaine vers celui-ci avec une 308, en conservant le chemin et les paramètres de requête (`--off` le dessert à nouveau) — faites cela pour `www.` aux côtés d'un apex, car la connexion Google, les cookies et les passkeys dépendent de l'origine. Un domaine sur lequel une application est servie (un `path` d'application avec un nom d'hôte) ne redirige jamais. Un domaine apex (`example.com`, sans sous-domaine) nécessite un enregistrement **A**, car le DNS n'y autorise pas de CNAME. Cette adresse est l'ingress de la plateforme, et il n'est pas garanti qu'elle reste identique : si la plateforme déménage, un enregistrement A continue de pointer vers l'ancienne adresse. Si votre hôte DNS propose l'aplatissement CNAME (CNAME flattening), ALIAS ou ANAME sur l'apex, pointez plutôt l'apex vers le `tenantHost` du projet, qui suit la plateforme. Le CNAME d'un sous-domaine la suit déjà. `list` indique `verified, certificate pending` jusqu'à ce que HTTPS réponde avec un certificat réel. `list --json` renvoie `{ projectId, tenantHost, domains: [...] }` |
| `db` | Associer ou créer une base de données, s'y connecter depuis votre machine, sauvegardes, restauration et récupération à un instant précis (point-in-time recovery) |
| `guests` | Les utilisateurs invités laissés par la connexion anonyme : les compter, en supprimer un, purger ceux qui n'ont pas été vus depuis un certain temps. Voir [Invités](/docs/cli/cloud/#guests). Propriétaires et administrateurs |
| `extensions` | La liste blanche (allowlist) des extensions Postgres |
| `storage` | Le bucket du projet |
| `resources` | Les bases de données et les buckets que la plateforme héberge, par rapport à ce que le code déclare |
| `compute` | Ce que ce projet réserve, ce qu'il coûte et comment le modifier |
| `events` | Ce qui s'est passé sur le backend, du plus récent au plus ancien : mise à l'échelle de l'application, modifications de la base planifiées et appliquées, prise de relais par un standby, agrandissement du disque |
| `usage` | Requêtes consommées ce mois-ci par rapport au quota inclus, et dépassement actuel, tel que comptabilisé sur la facture. `usage org` liste tous les projets de l'organisation |
| `clusters` | Les clusters sur lesquels les tenants s'exécutent. Réservé aux administrateurs de la plateforme |
| `settings`, `orgs`, `access`, `billing` | Paramètres du projet, organisations et leurs membres et invitations, personnes ayant accès à un projet, paiement |
| `activity` | Le journal d'audit de l'organisation : qui a déployé, modifié une variable d'environnement (par son nom), un domaine, une sauvegarde, un membre ou un jeton. Propriétaires et administrateurs. Voir [Voir qui a fait quoi](#voir-qui-a-fait-quoi) |
| `notifications` | Où les événements du projet sont envoyés par POST : Slack, Discord ou toute URL https ([Notifications Cloud](/docs/deployment/cloud-notifications/)) |

Chaque groupe de ce tableau répond à `--help` avec sa propre page d'aide — une ligne d'utilisation,
ses options (flags) et des exemples — et `--help` n'exécute jamais la commande. Un test vérifie
l'index de ces pages, de sorte qu'un groupe ajouté sans page fait échouer le build plutôt que
de renvoyer vers la table des matières. `verify:docs` aligne ce tableau sur cet index :
chaque groupe géré par la CLI apparaît ici exactement une fois, de sorte qu'un groupe
ajouté sans ligne correspondante fait également échouer le build.

Utilisé dans un pipe, `--help` répond en JSON : la même ligne d'utilisation, les options et les exemples
sous forme d'une structure lisible plutôt que soixante lignes de séquences d'échappement de terminal.

## Ce que la bêta n'inclut pas

Pas de choix de région, pas d'inscription en libre-service, pas de SLA publié, pas de déploiements par branche,
des jetons qui agissent au nom d'une personne, et aucun endpoint public pour la base de données. [Ce que la bêta
n'inclut pas](/docs/deployment/cloud-beta-limits/) détaille clairement chacun de ces points,
ainsi que ce qu'implique un déploiement avec les secrets de production.

## S'auto-héberger plutôt

Rien ici ne vous enferme (aucun lock-in). Le [guide d'auto-hébergement](/docs/deployment/self-hosting/)
exécute la même image et le même bundle avec `docker compose`, et le
[guide Kubernetes](/docs/deployment/kubernetes/) restitue la même topologie à partir
du chart Helm.
