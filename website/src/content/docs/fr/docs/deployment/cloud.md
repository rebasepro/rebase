---
sourceHash: 6a1d65000e50846a
title: Rebase Cloud
sidebar_label: Rebase Cloud
description: Rebase Cloud est le même Rebase, géré pour vous. Ce qu'il est, comment lier et déployer un projet, et ce que la bêta privée n'inclut pas encore.
---

Rebase Cloud exécute le même Rebase open source que vous hébergeriez vous-même — la même image `rebasepro/server` publiée, le même bundle, le même Postgres. La différence réside dans qui l'exploite.

:::note[Bêta privée]
Rebase Cloud est en **bêta privée**. Il héberge de véritables tenants aujourd'hui et ouvre ses accès par vagues. [Demander un accès](https://rebase.pro/pricing).

Il n'est pas en libre-service, les commandes ci-dessous nécessitent donc un compte autorisé. Tout le reste sur ce site fonctionne sans compte.
:::

## En quoi cela consiste

Un **projet** Cloud correspond à trois éléments que la plateforme gère pour vous :

| | Ce que vous obtenez |
|---|---|
| **App** | Votre bundle, s'exécutant sur l'image de runtime publiée. Les déploiements sont un téléversement de bundle, pas une compilation de conteneur |
| **Base de données** | Un PostgreSQL managé, avec sauvegardes automatisées et récupération à un instant précis (point-in-time recovery) |
| **Stockage** | Votre propre bucket, si votre projet utilise le stockage de fichiers |

L'application et la base de données sont provisionnées lors de votre premier déploiement ; un bucket uniquement lorsque vous en faites la demande ([Stockage de fichiers](#stockage-de-fichiers)). Chacun est facturé en fonction de ce qu'il réserve plutôt que par utilisateur (seat).

**Rien ne change dans votre projet pour y tourner.** Le même dépôt s'auto-héberge avec `docker compose`, et la porte de sortie est bien réelle : `rebase build` produit un bundle qui démarre partout où l'image de runtime s'exécute.

## Lier un projet

Depuis le répertoire d'un projet :

```bash
rebase cloud login
rebase cloud billing setup
rebase cloud projects create --name "My app" --subdomain my-app --link
```

`login` ouvre la console dans votre navigateur et affiche un code court. Vérifiez que la console affiche le même code, puis approuvez la connexion : le terminal récupère la session et l'écrit dans `~/.rebase/credentials.json`. Si vous n'êtes pas connecté à la console, connectez-vous-y d'abord avec la méthode de votre choix, y compris Google et GitHub. En SSH, `rebase cloud login --no-browser` affiche le lien à ouvrir sur votre propre machine.

`projects create` ne prend aucun argument positionnel. Le nom et le sous-domaine sont des options (flags), et tous deux sont obligatoires — dans un terminal, ils vous seront demandés, et une exécution automatisée (headless) qui omet l'un ou l'autre se termine avec `input_required` plutôt que d'en inventer un. **Le sous-domaine n'est pas modifiable par la suite :** c'est l'hôte `<slug>.rebase.website` sur lequel le projet répond, choisissez-le donc avec soin.

`--link` associe ce répertoire au projet lors du même appel, évitant ainsi une étape `link` distincte. Il écrit `.rebase/cloud.json`, qui enregistre l'identifiant et le slug du projet. Ce fichier n'est pas secret et ne contient pas vos identifiants — ceux-ci se trouvent dans `~/.rebase/credentials.json`, écrit par `login`.

Il est cependant commité avec le code, de sorte qu'un dépôt cloné peut désigner n'importe quel plan de contrôle (control plane). Lorsque l'hôte provient uniquement de ce fichier, et qu'il ne s'agit ni de celui de la plateforme ni d'un hôte auquel vous vous êtes déjà connecté auparavant, `login` le nomme et demande confirmation avant d'y envoyer votre e-mail et votre mot de passe. Sans terminal, ou avec `--json`, il refuse avec `unknown_control_plane` ; passez `--url <host>` (ou définissez `REBASE_CLOUD_URL`) pour vous y connecter délibérément.

Pour vous connecter sans le navigateur, transmettez votre e-mail : `rebase cloud login --email me@example.com` demande votre mot de passe. **Inscrit avec Google, GitHub ou LinkedIn ?** Votre compte n'a pas de mot de passe, utilisez donc un code à la place :

```bash
rebase cloud login --code --email me@example.com
```

Le plan de contrôle vous envoie par e-mail un code à 6 chiffres, valable dix minutes, que vous saisissez dans l'invite. Avec `--email` et sans mot de passe, `rebase cloud login` vous demande d'utiliser soit votre mot de passe, soit un code. Les codes nécessitent que le plan de contrôle puisse envoyer des e-mails ; s'il ne le peut pas, `--code` le signale et se termine avec `otp_unavailable`.

Si vous avez activé l'authentification à deux facteurs, `login` vous demande ensuite le code de votre application d'authentification ou l'un de vos codes de récupération, quel que soit le mode de connexion choisi. Via le navigateur, la console vous le demande lors de votre connexion. Ni un code de connexion ni un second facteur ne peuvent être saisis sans terminal. Pour un script, créez un jeton d'accès dans la console (**Settings → Access tokens**) et définissez `REBASE_TOKEN` ; voir [CI et agents](/docs/deployment/cloud-agents/#ci-and-agents).

Un mot de passe incorrect renvoie `invalid_credentials` avec les deux mêmes moyens d'accès, la cause habituelle étant un compte qui n'en a jamais eu.

`billing setup` associe une carte à l'organisation, une seule fois. Cette commande est intentionnellement placée en premier dans la séquence : le premier déploiement d'un projet est refusé sans carte, et s'en rendre compte une fois le téléversement du bundle terminé serait la pire situation.

Après cela, la page **Billing** de la console répertorie les factures de l'organisation, chacune avec la page hébergée par Stripe et le PDF, et donne un aperçu de la prochaine facture de chaque projet. `rebase cloud billing invoices` et `rebase cloud billing upcoming` affichent la même chose. Les deux s'adressent aux propriétaires et administrateurs de l'organisation. Lorsque la plateforme le propose, **Manage billing** ouvre le portail client de Stripe pour gérer la carte, les coordonnées de facturation et les factures passées.

Lorsqu'une carte est déjà enregistrée, créer un autre projet dans la console ne demande aucun second paiement : le projet est facturé sur cette carte et déployé. Si la carte est refusée ou si la banque demande une confirmation de paiement, la console vous redirige vers **Billing**, où **Fix your card** enregistre une autre carte et **Complete the payment** ouvre la facture Stripe.

La consommation d'un projet s'affiche sur sa vue d'ensemble, sous **Usage this month**, et pour tous les projets à la fois sur la page **Billing** : requêtes par rapport au quota inclus (la barre devient orange à 80 %), erreurs 5xx, dépassement actuel et projection pour le reste du mois à ce rythme. Le dépassement est calculé par le même code que celui qui le transmet à Stripe, c'est donc ce qui figurera sur la facture ; il apparaît sur la facture du mois suivant. `rebase cloud usage` affiche la même chose, et `rebase cloud usage org` pour l'ensemble de l'organisation. Tout membre peut le consulter. Les chiffres précisent ce qu'ils ne mesurent pas encore : le stockage objet n'est pas mesuré, donc aucun dépassement de stockage n'est facturé ; lorsqu'un projet exécute deux pods d'application ou plus, ses requêtes ne sont pas comptabilisées ; et un jour avec des échantillons manquants sous-estime le total. Un projet avec autoscaling affiche également les pods exécutés au-delà de `--replicas`, en heures-pod, leur coût selon ses propres tarifs et si cette plateforme les facture déjà. Un projet réclamé depuis un agent ne compte que les jours à partir de la réclamation : avant cela, le projet appartenait à la plateforme.

Un projet existant se lie sans en créer un nouveau :

```bash
rebase cloud projects list
rebase cloud link --project my-app
```

## Déployer

```bash
rebase cloud deploy
```

Une seule commande, et aucun flag à retenir. Le `rebase.json` d'un projet généré déclare `runtime: "managed"` pour son backend, et `deploy` lit cette déclaration — il le signale au passage (`rebase.json declares runtime: managed — deploying a bundle`), compile l'application dans `dist-bundle`, téléverse le bundle, l'exécute sur l'image de runtime publiée et suit le déploiement jusqu'à son état final. Le code de sortie fait foi, cette même ligne fonctionne donc de manière autonome dans une CI.

Il se termine en indiquant où chaque application répond désormais et si la nouvelle version y est active :

```text
  ✓ Deployed songbuzz in 1m 12s  (deployment fb3c7442-9937-4179-8d3c-88a106da149d)

    game     static   https://songbuzz.rebase.website      live
    backend  backend  https://songbuzz.rebase.website/api  live

  ✓ Live: the new version answers on every address above.
  Something wrong? `rebase cloud rollback` puts the previous deployment back.
```

« Live » signifie que l'adresse a répondu après le build : le `/health` d'un backend a renvoyé `ok`, et la page d'une application statique s'est chargée (depuis ce déploiement, lorsque la plateforme la sert). Cette vérification attend jusqu'à `--live-timeout` secondes, 60 par défaut ; `0` l'ignore. Si une application ne répond pas à temps, le déploiement renvoie tout de même un code de sortie zéro car le déploiement a réussi, et la dernière ligne indique quelle application n'a pas répondu et pourquoi. Un déploiement ayant échoué se termine plutôt sur une seule ligne, précisant l'application et la raison, avec `rebase cloud logs` pour consulter l'intégralité du journal de build.

Les scripts passent `--json` pour obtenir un objet unique contenant les mêmes informations — `apps`, `hosts`, `live`, `liveChecks`, `durationMs` et l'identifiant du déploiement. Contrairement au reste de `rebase cloud`, `deploy` ne bascule pas automatiquement en JSON lorsqu'il est utilisé dans un pipe.

Ce que permet ce runtime — paquets et modules natifs, mémoire et instances, délais d'expiration et tailles de corps de requête, système de fichiers, secrets, stockage et réseau sortant — est détaillé sur sa propre page :
[Runtime backend managé](/docs/deployment/managed-runtime/).

Pour déployer un artefact compilé précédemment — par exemple un job CI qui compile une fois et déploie deux fois —, pointez vers le répertoire au lieu de recompiler :

```bash
rebase build
rebase cloud deploy --bundle-dir dist-bundle
```

Quitter le runtime managé nécessite un flag dédié, `--eject`, et rien d'autre ne le déclenche : un build qui ferait passer un projet managé sur une image de conteneur dont il devient propriétaire est refusé tant que vous ne l'avez pas explicitement demandé. Auparavant, `--force` avait cette signification, ce qui plaçait l'action la moins réversible de la CLI sous le même terme que « écraser ce fichier » ; il s'agit désormais d'une option inconnue plutôt que d'un alias, de sorte qu'un script qui l'utilise s'arrête.

### La vérification syntaxique avant le téléversement

Les fichiers d'une application statique sont servis exactement tels quels. Lorsque son `build` ne fait que copier des scripts écrits à la main dans `output`, rien ne les a analysés, et un fichier contenant une faute de frappe peut être mis en production et empêcher la page de se charger. Ainsi, avant tout téléversement, `deploy` analyse chaque fichier `.js`, `.mjs` et `.cjs` dans le dossier `output` de chaque application statique, ainsi que chaque `<script>` inline dans ses fichiers `.html`. Cela couvre aussi bien une application statique déployée seule que les applications statiques intégrées au bundle du backend. Une erreur de syntaxe interrompt le déploiement en indiquant le fichier, la ligne et la colonne :

```
✗ A syntax error in the static output, so nothing was deployed:
    web/cloud.js:42:23  Unexpected token
        42 |     return fetch("/api";
Fix it and deploy again, or pass --no-verify to deploy anyway.
```

Avec `--json`, le `code` de l'erreur est `syntax_error`. Les scripts inline qu'un navigateur n'exécute pas en tant que JavaScript sont ignorés : JSON, import maps, templates et tout autre `type` non-JavaScript, un `<script src>`, ainsi qu'un script contenant encore du balisage de template non interprété tel que `{{ }}`. Un fichier `.js` est validé s'il peut être analysé soit comme un script classique, soit comme un module, car c'est la page qui en décide. Rien dans `node_modules` n'est lu, pas plus qu'un `--bundle-dir` pré-compilé. `--no-verify` ignore cette vérification pour un déploiement.

Pour observer :

```bash
rebase cloud logs               # the build log
rebase cloud logs --runtime -f  # what the running app prints, live, until Ctrl-C
rebase cloud status             # what the platform thinks the project is doing
```

`status` rapporte `blockedOn` et `nextAction`. Lorsque `blockedOn` est `null`, la plateforme travaille activement et le sondage (polling) est approprié ; lorsqu'il désigne un élément, cet élément est en attente d'une action de votre part.

L'un d'eux est `email_not_configured` : l'application a activé la connexion par magic link ou par code e-mail (`AUTH_MAGIC_LINK`, `AUTH_EMAIL_OTP`) sans service de messagerie configuré, de sorte que le déploiement est actif mais personne ne peut s'y connecter. Rebase Cloud n'envoie pas d'e-mails pour votre application : configurez `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` et `SMTP_FROM` avec `rebase cloud env set`, puis déployez. `status` lit cette information depuis l'endpoint `GET /api/auth/config` de l'application elle-même (son champ `unavailable`), et `deploy` indique la même chose dans son contrôle de disponibilité (live check).

## Stockage de fichiers

Un nouveau projet n'a aucun bucket : les téléversements sont refusés avec `501 STORAGE_NOT_CONFIGURED`, et le résumé du déploiement l'indique, plutôt que d'écrire sur un disque que chaque déploiement remplace.

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

`rebase cloud storage` liste les buckets du projet. Un projet en possédant plusieurs attache chacun d'eux avec `--source <key>` ; un projet configurant le stockage dans le code n'a besoin ni de l'un ni de l'autre.

## Prévisualiser une modification

```bash
rebase cloud deploy --preview
```

Cette commande compile et téléverse exactement la même chose que `deploy`, mais la met à disposition sur sa propre adresse, comme `https://shop--k3x9ab.rebase.website`. La production continue de servir ce qu'elle servait auparavant. Le déploiement affiche l'adresse de la prévisualisation une fois le build terminé.

Pour conserver la même adresse d'un déploiement à l'autre, nommez la prévisualisation. Déployer à nouveau sous le même nom la met à jour :

```bash
rebase cloud deploy --preview-name new-checkout
```

Les services auxquels une prévisualisation s'adresse dépendent de ce que vous avez déployé :

- **`rebase cloud deploy --preview`** prévisualise le backend, avec ses applications statiques intégrées, de la même manière que la production les exécute. Il obtient son propre backend sur sa **propre base de données vide**, jamais celle de production. Démarrer sur la base de production appliquerait le schéma et les règles d'accès de la prévisualisation à cette dernière.
- **`rebase cloud deploy web --preview`** prévisualiserait une application statique isolée, ses pages appelant le backend de **production**. Cela nécessite un plan de contrôle capable de servir des sites statiques de manière autonome, ce que Rebase Cloud ne prend pas encore en charge : il refuse avec `PREVIEW_STATIC_UNSERVED` et ne publie rien. Prévisualisez plutôt le backend, qui sert les applications statiques qui y sont intégrées ; un projet sans backend managé ne peut pas encore être prévisualisé.

Une prévisualisation ne téléverse aucun code source et n'enregistre aucune application ni aucun nom d'hôte, car chacun d'eux modifierait le projet de production. `--source` et `--eject` ne peuvent pas être combinés avec `--preview`. Chacun compile une image de conteneur pour la production.

```bash
rebase cloud previews                      # name, address, app, backend, expiry
rebase cloud logs --preview new-checkout   # its build log; -f follows a build still running
rebase cloud logs --runtime --preview new-checkout -f  # what its backend prints
rebase cloud previews delete new-checkout  # stops serving it and drops its database
```

`rebase cloud logs` sans `--preview` concerne toujours la production.

La page **Deployments** de la console liste ces mêmes prévisualisations, et permet d'ouvrir, d'afficher le journal de build ou de supprimer chacune d'elles. La création reste une étape de la CLI.

Une prévisualisation expire une semaine après son dernier déploiement.

Une fois terminé, le déploiement vérifie que l'adresse de la prévisualisation répond, tout comme pour un déploiement en production (`--live-timeout <seconds>`, `0` pour ignorer). Le certificat d'une nouvelle prévisualisation pouvant prendre une minute ou deux, un déploiement réussi peut indiquer que l'adresse ne répond pas encore.

Une prévisualisation de backend est facturée comme une unité d'application à la taille par défaut (100m de CPU et 384 MiB de mémoire, au tarif de votre application pour sa région et sa capacité), au prorata de sa durée d'existence, et apparaît dans le devis mensuel du projet dans la console. `rebase cloud deploy --preview` affiche la même estimation par mois (`cost` sous `--json`). En démarrer une nécessite une carte enregistrée, tout comme pour un déploiement en production. Un premier déploiement qui échoue avant que quoi que ce soit ne s'exécute est supprimé plutôt que facturé. Un projet peut exécuter trois prévisualisations de backend simultanément.

Chaque nouvelle adresse de prévisualisation reçoit son propre certificat TLS de Let's Encrypt, qui autorise 50 nouveaux certificats par semaine par domaine, partagés avec tous les sites de production sur ce dernier. Les prévisualisations peuvent en consommer 20 sur une période glissante de 7 jours, à l'échelle de la plateforme. Au-delà, toute nouvelle prévisualisation est refusée (`429`, `preview_cert_budget`) avec l'indication du moment où elle pourra être déployée ; redéployer une prévisualisation existante n'est jamais décompté.

La base de données d'une prévisualisation de backend est une seconde base de données sur l'instance Postgres de **production** : ses propres données, mais la même instance et le même disque. Elle est limitée à 10 connexions, de sorte que les prévisualisations ne puissent pas saturer celles de la production, et à 2 Go : une prévisualisation dont la base dépasse cette taille est mise en pause. Son backend s'arrête, son adresse cesse de répondre, `rebase cloud previews` et la console l'affichent comme `paused` avec la raison, et les propriétaires et administrateurs du projet sont notifiés (`preview.paused`). Ses données sont conservées jusqu'à son expiration. Déployez-la à nouveau pour la démarrer (elle est remise en pause tant que la base reste trop volumineuse), ou supprimez-la. Une prévisualisation en pause reste facturée jusqu'à sa suppression ou son expiration. Supprimez les prévisualisations dont vous n'avez plus besoin. Les extensions installées en production ne sont pas installées dans la base de données d'une prévisualisation.

Les prévisualisations sont en cours de déploiement progressif. Un plan de contrôle qui ne les prend pas encore en charge refusera `--preview` avec `previews_unavailable` et ne déploiera rien.

## Revenir en arrière (Roll back)

```bash
rebase cloud deployments
rebase cloud rollback
```

Un rollback redirige le projet vers ce qu'un déploiement réussi précédent avait livré, sans jamais recompiler — tout l'intérêt d'un rollback étant de livrer un artefact qui a déjà tourné avec succès.

Les déploiements éligibles dépendent de la manière dont le projet est déployé, et les deux approches fonctionnent :

| Mode de déploiement | Ce qui est restauré |
|---|---|
| `rebase cloud deploy` (build depuis les sources) | L'image publiée par ce build |
| `rebase cloud deploy --bundle` (runtime de la plateforme) | Le bundle livré par ce déploiement, sur la version de runtime actuellement exécutée par le projet |

Les applications statiques intégrées dans le bundle du backend (un simple `rebase cloud deploy` sur un projet avec backend) font partie de ce bundle, elles sont donc restaurées avec lui.

Une application statique déployée individuellement (`rebase cloud deploy <app>`) ne peut pas encore faire l'objet d'un rollback. Son déploiement enregistre quelle application a été publiée, mais aucun bundle, le plan de contrôle n'a donc aucun élément à partir duquel la restaurer. La solution consiste à redéployer la dernière version valide, par exemple depuis le commit précédant celui qui pose problème. Après un tel déploiement, `deploy` indique ceci au lieu de renvoyer vers `rollback`, et `rollback` sans identifiant refuse d'agir plutôt que de redéployer le backend actif.

Un rollback nécessite donc un déploiement ayant enregistré l'un des deux éléments, ce qui implique un projet ayant été déployé avec succès au moins deux fois. `rebase cloud deployments` indique ceux qui sont éligibles, et `--json` signale `rollbackable` pour chaque ligne ainsi que l'élément `image` ou `bundle` qu'il restaurerait.

Deux types de déploiements sont refusés, et la CLI précise lequel : un qui n'a pas abouti, et un antérieur à la prise en charge de l'enregistrement de l'artefact par la plateforme. Il n'y a rien à deviner dans les deux cas — faire des suppositions risquerait de livrer ce qui a été compilé ou téléversé le plus récemment tout en prétendant restaurer cette version —, déployez donc plutôt la version souhaitée.

Chaque déploiement réussi se termine en indiquant comment revenir en arrière (`rebase cloud rollback`), afin que la commande soit directement visible au moment où une anomalie de release est détectée.

Un rollback ajoute un nouveau déploiement plutôt que de remonter l'historique, et attend que la version restaurée réponde avant de confirmer le succès. Suivez-le avec `rebase cloud logs -f`.

## Restaurer la base de données à un instant précis

Une base de données managée peut être restaurée à n'importe quelle minute comprise dans sa fenêtre de récupération, depuis **Database → Backups** dans la console ou via la CLI :
`rebase cloud db pitr status | restore --target <ISO> | cutover | discard`.
Cela se déroule en deux étapes. Tout d'abord, une copie restaurée est préparée (staged) aux côtés de la base de données active ; votre application continue de fonctionner sur la base active, et le stockage de la copie est facturé jusqu'au basculement (cutover) ou à son abandon (discard).
Ensuite, une fois la copie prête, le basculement redirige l'application vers celle-ci et la redémarre. Tout ce qui a été écrit après l'heure cible ne figure pas dans la copie. La base de données d'origine est conservée en tant que solution de repli et continue d'être facturée pour son stockage ; revenir en arrière, la supprimer ou effectuer une seconde restauration nécessite de contacter le support. Seul un propriétaire ou un administrateur peut préparer, basculer ou abandonner une restauration, et la console demande le nom du projet avant le basculement.

## Sécuriser votre compte

Votre compte de console permet d'accéder aux bases de données de production, aux secrets et à la facturation, protégez-le en conséquence. Ouvrez **Account security** depuis le menu sous votre avatar dans la console (ou allez sur `/account`). Cette page est personnelle et n'appartient pas à une organisation : ce que vous y configurez s'applique à toutes les organisations dont vous faites partie.

- **Vérification en deux étapes.** Activez-la avec n'importe quelle application d'authentification (1Password, Google Authenticator, Authy). La page affiche une clé de configuration à ajouter à l'application, ou un lien qui ouvre l'application avec la clé préremplie sur un téléphone, puis demande le code à 6 chiffres affiché par l'application. Dès lors, chaque connexion exigera un code, que vous vous connectiez avec un mot de passe, Google ou GitHub.
- **Codes de récupération.** L'activation génère dix codes à usage unique, affichés une seule fois. Chacun d'eux permet de vous connecter à la place du code d'authentification si vous perdez votre téléphone ; enregistrez-les donc avant de fermer la boîte de dialogue. **New recovery codes** les remplace, et les anciens cessent de fonctionner. Désactiver la vérification en deux étapes et générer de nouveaux codes demandent tous deux la saisie préalable d'un code.
- **Mot de passe.** Le modifier vous déconnecte de tous les autres appareils. Un compte créé avec Google, GitHub ou LinkedIn n'a pas de mot de passe ; la page propose de vous envoyer un lien par e-mail pour en définir un.
- **Appareils connectés.** Chaque navigateur et terminal connecté à votre compte, avec son adresse et la date/heure de connexion. Déconnectez tout appareil que vous ne reconnaissez pas, ou tous en même temps.

Les [jetons d'accès](/docs/deployment/cloud-agents/#ci-and-agents) ne sont pas des sessions et ne requièrent pas de second facteur, ce qui permet à la CI de continuer à déployer après activation. Révoquez un jeton en lequel vous n'avez plus confiance sous **Settings → Access tokens**.

## Inviter votre équipe

**Members → Add member** permet d'ajouter une personne possédant déjà un compte Rebase avec une adresse e-mail vérifiée, en tant qu'administrateur ou membre ; un propriétaire pourra ensuite lui attribuer le rôle de propriétaire. Elle a accès immédiatement et aucun e-mail n'est envoyé. Rebase Cloud n'envoie pas encore d'invitations, demandez donc à un coéquipier sans compte de s'inscrire et de vérifier son adresse au préalable. Depuis un terminal :
[`rebase cloud orgs members invite <email>`](/docs/cli/cloud/#organizations), qui vous le signalera si l'adresse ne correspond à aucun compte.

## Voir qui a fait quoi

La page **Activity** de la console et `rebase cloud activity` permettent aux propriétaires et administrateurs de l'organisation de voir qui a déployé, défini ou affiché une variable d'environnement (par son nom, jamais par sa valeur), modifié un domaine, restauré une sauvegarde, redimensionné, arrêté ou supprimé un projet, modifié le rôle d'un membre ou créé un jeton, et à quel moment. Les **Settings** d'un projet renvoient à ses propres entrées ; une entrée relative à un projet supprimé est conservée. Un script peut les lire à l'aide d'un jeton créé avec `--can audit` sur l'organisation. Les entrées sont conservées pendant un an. Les filtres sont décrits dans
[`rebase cloud`](/docs/cli/cloud/#organizations).

## CI et agents

Un job CI ou un agent ne devrait jamais détenir votre mot de passe. Donnez-lui un jeton limité à quelques actions sur un projet précis, créé depuis un terminal authentifié avec
`rebase cloud tokens create --project shop --can deploy,logs`, et définissez-le comme
`REBASE_TOKEN`. La facturation, le journal d'activité et les paramètres de notification d'une organisation constituent des fonctionnalités (capabilities) distinctes (`--can billing`, `audit`,
`notifications`) qu'un jeton ne détient que si elles sont demandées. Ces fonctionnalités, un workflow GitHub Actions et les actions réservées à une personne authentifiée sont détaillés dans
[CI et agents](/docs/deployment/cloud-agents/#ci-and-agents).

## Un backend sans compte

`rebase cloud init --claim` attribue à une application un backend actif avant même que quiconque ne soit inscrit, et affiche une URL de réclamation pour permettre à la personne de le conserver ; un projet que personne ne réclame sous 72 heures est supprimé. Les actions autorisées pour le jeton d'un projet non réclamé, le
`REBASE_API_TOKEN` qu'il écrit et les changements qu'entraîne la réclamation sont détaillés dans
[Un backend sans compte](/docs/deployment/cloud-agents/#a-backend-with-no-account).

## Calcul (Compute) et tarification

Le tarif d'un projet dépend des ressources qu'il réserve, et non d'un forfait. `compute` affiche chaque curseur et le devis détaillé établi par le plan de contrôle. (`rebase cloud resources` est une commande différente : elle concerne les bases de données et buckets déclarés par le code, et si chacun est provisionné — voir la [référence de la CLI](/docs/cli/cloud/).)

```bash
rebase cloud compute
rebase cloud compute set --cpu 500m --memory 2Gi
```

| Paramètre | Unité et signification |
|---|---|
| `--cpu`, `--memory` | Demande de l'application par instance (request), ex. `500m` et `2Gi`. Vide correspond à la valeur par défaut de la plateforme, qui dépend de la région (ci-dessous) |
| `--replicas` | Instances permanentes : le plancher de l'autoscaler, et ce que l'abonnement du projet facture chaque mois |
| `--autoscale-max` | 1–16. Le plafond pouvant être atteint. Les instances ajoutées par l'autoscaler au-delà de `--replicas` sont mesurées en secondes-pod aux mêmes tarifs, et facturées uniquement là où la plateforme l'a activé ; **Usage this month** le précise. `--no-autoscale` le désactive |
| `--autoscale-cpu-target` | 10–95. L'utilisation du processeur visée par l'autoscaler, par rapport à la demande (request) plutôt qu'à la limite. Vide équivaut à 70 |
| `--spot` | `true` ou `false`. Capacité préemptible : moins chère, mais redémarrée sans préavis |
| `--db-instances` | 1–3. `1` correspond à une instance unique sans basculement (failover) ; `2` ajoute une instance de secours (standby) automatique |
| `--db-cpu`, `--db-memory` | Par instance de base de données. Vide équivaut à `160m` et `1Gi` |

Laisser un paramètre vide n'est pas équivalent à le fixer à ce même chiffre : un paramètre vide suit les valeurs par défaut de la plateforme et évolue en même temps qu'elles.

En Belgique (europe-west1), la configuration par défaut réserve 100m CPU et 384 Mi et peut monter en pointe (burst) jusqu'à 2 CPU et 2 Gio ; à Falkenstein et Helsinki, la mémoire peut s'étendre jusqu'à 1,4× la demande et le processeur jusqu'à 10× (avec un maximum de 1,7 vCPU). `rebase cloud compute` affiche les valeurs de votre projet.

Rien n'est validé par la CLI, délibérément — les limites sont propres au cluster sur lequel s'exécute le projet, et varient d'un fournisseur à l'autre. Le plan de contrôle refuse toute valeur qu'il ne peut pas honorer et nomme le champ concerné. Exécutez `rebase cloud compute` pour voir les €/mois avant et après ; un changement s'applique immédiatement, calculé au prorata dès aujourd'hui. Une modification de base de données s'applique immédiatement ; elle reste facturée à la taille actuelle jusqu'à son activation. Une nouvelle configuration CPU ou mémoire de base de données, ou une réduction du nombre d'instances, redémarre la base de données (environ 30 secondes à 3 minutes ; les connexions sont interrompues et se reconnectent) : `compute set` le signale et demande confirmation, et hors terminal, `--yes` fait office de consentement. Si ce redémarrage échoue, `rebase cloud compute apply` tente à nouveau l'opération.

## Le reste des commandes

| Groupe de commandes | Ce qu'il couvre |
|---|---|
| `login`, `logout`, `whoami`, `access-token` | Votre session ; `access-token` affiche le jeton bearer que la CLI enverrait actuellement, utile pour les scripts et le serveur MCP |
| `tokens` | Jetons pour la CI et les agents, chacun restreint à un seul projet. Voir [CI et agents](/docs/deployment/cloud-agents/#ci-and-agents) |
| `link`, `unlink`, `use`, `open` | Liaison de ce répertoire à un projet, sélection d'une organisation, ouverture de la console |
| `connect` | Ajout d'un serveur Rebase auto-hébergé à votre compte, afin que le [connecteur Rebase](/docs/ai/rebase-connector/#add-your-self-hosted-instances) dans Claude puisse l'atteindre aux côtés de vos projets Cloud. `--list` les affiche, `--remove` en supprime un. Propriétaires et administrateurs |
| `init`, `claim` | Avec `--claim` : un backend actif sans compte, et un lien pour le réclamer ; `claim` réaffiche ce lien. Voir [Un backend sans compte](/docs/deployment/cloud-agents/#a-backend-with-no-account) |
| `projects` | Créer, lister, inspecter, supprimer |
| `deploy`, `logs`, `deployments`, `rollback`, `cancel` | Déploiement et suivi |
| `deploy-hooks` | URLs secrètes appelées par un hébergeur git ou une CI pour déployer le projet : lister, créer (l'URL n'est affichée qu'une fois), révoquer. |
| `previews` | Builds servis sur leur propre adresse par `deploy --preview`, et leur suppression. Voir [Prévisualiser une modification](#prévisualiser-une-modification) |
| `sleep` | Mise en veille en cas d'inactivité : `on [--after 15m\|30m\|1h\|4h]`, `off`, `wake`, et `status` (par défaut). Endormi, un projet ne retient ni CPU ni mémoire et la prochaine requête le réveille ; les tâches planifiées et le travail en arrière-plan ne s'exécutent pas pendant ce temps. Lorsqu'un projet ne peut pas se mettre en veille, le plan de contrôle refuse et en explique la raison |
| `start`, `stop`, `restart` | Mettre en pause un projet et le réactiver. Un projet arrêté conserve son abonnement, à moins que la plateforme ne facture aux projets arrêtés uniquement le stockage et les frais de plateforme ; la ligne **Billing** de la console le précise le cas échéant |
| `status`, `metrics`, `debug` | Ce qu'il fait, et pourquoi il ne le fait pas |
| `alerts` | Les incidents ouverts du projet, et leur acquittement ou report (snooze). |
| `cron` | Les tâches cron de l'application déployée et leurs exécutions enregistrées, lues avec vos identifiants `rebase cloud`. Lecture seule |
| `env` | Variables d'environnement. `list` n'affiche jamais les valeurs ; `--secret` est en écriture seule |
| `app-key` | La clé écrite par `init --claim` dans `.env` sous `REBASE_API_TOKEN`, transmise lors de la réclamation ; `rotate` la remplace et révoque l'ancienne. Propriétaires et administrateurs |
| `service-key` | `REBASE_SERVICE_KEY`, admin sur l'API propre de l'application : date de sa dernière rotation ; `rotate` en attribue une nouvelle à l'application. Propriétaires et administrateurs |
| `domains` | Domaines personnalisés, enregistrements DNS à ajouter et vérification. Un projet peut répondre sur plusieurs domaines, chacun vérifié individuellement ; `verify` et `remove` prennent le domaine sur lequel agir, qui ne peut être omis que s'il n'y en a qu'un (pour `verify`, un seul encore en attente). Chaque domaine vérifié sert le projet directement ; `primary <domain>` sélectionne le domaine canonique et `redirect <domain>` répond à un autre avec une redirection 308 vers celui-ci, en conservant le chemin et les paramètres de requête (`--off` permet de le servir à nouveau) — faites cela pour `www.` à côté d'un apex, car la connexion Google, les cookies et les passkeys sont définis par origine. Un domaine sur lequel une application est servie (un `path` d'application avec un nom d'hôte) ne redirige jamais. Un domaine apex (`example.com`, sans sous-domaine) nécessite un enregistrement **A**, car le DNS n'autorise pas de CNAME à ce niveau. Cette adresse est l'ingress de la plateforme, et il n'est pas garanti qu'elle reste inchangée : si la plateforme déménage, un enregistrement A continue de pointer vers l'ancienne adresse. Si votre hébergeur DNS propose les enregistrements ALIAS, ANAME ou le CNAME flattening sur l'apex, faites plutôt pointer l'apex vers le `tenantHost` du projet, qui s'adapte à la plateforme. Le CNAME d'un sous-domaine la suit déjà automatiquement. `list` indique `verified, certificate pending` jusqu'à ce que HTTPS réponde avec un certificat réel. `list --json` renvoie `{ projectId, tenantHost, domains: [...] }` |
| `db` | Attacher ou créer une base de données, s'y connecter depuis votre machine, sauvegardes, restauration et récupération à un instant précis (point-in-time recovery) |
| `guests` | Les utilisateurs invités laissés par la connexion anonyme : les compter, en supprimer un, purger ceux non vus depuis longtemps. Voir [Guests](/docs/cli/cloud/#guests). Propriétaires et administrateurs |
| `extensions` | La liste autorisée (allowlist) des extensions Postgres |
| `storage` | Le bucket du projet |
| `resources` | Les bases de données et les buckets hébergés par la plateforme, par rapport à ce que le code déclare |
| `compute` | Ce que ce projet réserve, ce qu'il coûte et comment le modifier |
| `events` | Les événements survenus sur le backend, du plus récent au plus ancien : dimensionnement de l'application, modifications de la base de données planifiées et appliquées, reprise par une instance de secours, extension du disque |
| `usage` | Requêtes consommées ce mois-ci par rapport au quota inclus, et dépassement actuel, tel que décompté sur la facture. `usage org` liste chaque projet de l'organisation |
| `clusters` | Les clusters sur lesquels tournent les tenants. Réservé aux administrateurs de la plateforme |
| `settings`, `orgs`, `billing` | Paramètres du projet, organisations ainsi que leurs membres et invitations, paiement |
| `activity` | Le journal d'audit de l'organisation : qui a déployé, modifié une variable d'environnement (par son nom), un domaine, une sauvegarde, un membre ou un jeton. Propriétaires et administrateurs. Voir [Voir qui a fait quoi](#voir-qui-a-fait-quoi) |
| `notifications` | Où les événements du projet sont envoyés via POST : Slack, Discord ou toute URL https ([Notifications Cloud](/docs/deployment/cloud-notifications/)) |

Chaque groupe de ce tableau répond à `--help` avec sa propre page d'aide — une ligne d'utilisation, ses options et des exemples — et `--help` n'exécute jamais la commande. Un test référence l'index de ces pages, de sorte qu'un groupe ajouté sans documentation fait échouer le build au lieu de renvoyer vers la table des matières. `verify:docs` aligne ce tableau sur cet index : chaque groupe géré par la CLI apparaît ici exactement une fois, ainsi un groupe ajouté sans ligne dédiée fera également échouer le build.

Utilisé dans un pipe, `--help` répond plutôt en JSON : la même ligne d'utilisation, les mêmes options et exemples sous forme de structure lisible plutôt que soixante lignes de séquences d'échappement de terminal.

## Ce que la bêta n'inclut pas

Pas de choix de région, pas d'inscription en libre-service, pas de SLA publié, pas de déploiements par branche, des jetons qui agissent en tant que personne physique, et aucun endpoint de base de données public. [Ce que la bêta n'inclut pas](/docs/deployment/cloud-beta-limits/) détaille clairement chacun de ces points, ainsi que ce qu'implique un déploiement avec les secrets de production.

## S'auto-héberger à la place

Rien ici ne vous enferme (aucun vendor lock-in). Le [guide d'auto-hébergement](/docs/deployment/self-hosting/) exécute l'image et le bundle à l'identique avec `docker compose`, et le [guide Kubernetes](/docs/deployment/kubernetes/) déploie la même topologie à partir du chart Helm.
