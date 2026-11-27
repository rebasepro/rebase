---
sourceHash: 3594b5aeed9b6b44
title: Rebase Cloud
sidebar_label: Rebase Cloud
description: Rebase Cloud est le même Rebase, opéré pour vous. Présentation, association et déploiement d'un projet, et ce que la bêta privée n'inclut pas encore.
---

Rebase Cloud exécute le même Rebase open-source que vous hébergeriez vous-même — la même
image `rebasepro/server` publiée, le même bundle, le même Postgres. La
différence réside dans la personne qui l'opère.

:::note[Private beta]
Rebase Cloud est en **bêta privée**. Il fait tourner de véritables tenants aujourd'hui et ouvre ses accès
par vagues. [Demander un accès](https://rebase.pro/pricing).

Il n'est pas en libre-service ; les commandes ci-dessous nécessitent donc un compte ayant obtenu un accès.
Tout le reste sur ce site fonctionne sans compte.
:::

## Présentation

Un **projet** Cloud correspond à trois éléments que la plateforme gère pour vous :

| | Ce que vous obtenez |
|---|---|
| **App** | Votre bundle, s'exécutant sur l'image runtime publiée. Les déploiements sont un téléversement de bundle, pas un build de conteneur |
| **Database** | Un PostgreSQL infogéré, avec sauvegardes automatisées et restauration à un point dans le temps |
| **Storage** | Votre propre bucket sur [Rebase Storage](/docs/deployment/rebase-storage/), si votre projet utilise le stockage de fichiers |

L'application et la base de données sont provisionnées lors de votre premier déploiement ; un bucket uniquement
lorsque vous en faites la demande ([Stockage de fichiers](#stockage-de-fichiers)). Chacun est facturé pour ce qu'il
réserve plutôt que par utilisateur.

**Rien dans votre projet ne change pour s'y exécuter.** Le même dépôt
s'auto-héberge avec `docker compose`, et la porte de sortie est bien réelle : `rebase build`
produit un bundle qui démarre partout où l'image runtime s'exécute.

## Associer un projet

Depuis le répertoire d'un projet :

```bash
rebase cloud login
rebase cloud billing setup
rebase cloud projects create --name "My app" --subdomain my-app --link
```

`login` ouvre la console dans votre navigateur et affiche un code court. Vérifiez que
la console affiche le même code et approuvez-y la connexion : le terminal
récupère la session et l'enregistre dans `~/.rebase/credentials.json`. Si vous n'êtes
pas connecté à la console, connectez-vous-y d'abord avec le moyen de votre choix,
y compris Google et GitHub. Via SSH, `rebase cloud login --no-browser` affiche le lien
à ouvrir sur votre propre machine.

`projects create` ne prend aucun argument positionnel. Le nom et le sous-domaine sont
des options (flags), et tous deux sont obligatoires — dans un terminal, ils vous sont demandés, et
une exécution sans terminal interactif (headless) omettant l'un d'eux se termine avec `input_required` plutôt que d'en inventer
un. **Le sous-domaine n'est pas modifiable par la suite :** c'est l'hôte
`<slug>.rebase.website` sur lequel le projet répond, choisissez-le donc avec soin.

`--link` associe ce répertoire au projet au sein du même appel, évitant ainsi une
étape `link` séparée. Elle génère le fichier `.rebase/cloud.json`, qui enregistre l'identifiant du projet
et son slug. Ce fichier n'est pas un secret et ne constitue pas vos identifiants — ceux-ci
résident dans `~/.rebase/credentials.json`, écrit par `login`.

Il est toutefois commité avec le code, de sorte qu'un dépôt cloné peut désigner n'importe quel
plan de contrôle. Lorsque l'hôte provient uniquement de ce fichier et qu'il ne s'agit ni de celui
de la plateforme ni d'un hôte auquel vous vous êtes déjà connecté, `login` le nomme et vous demande
confirmation avant d'y envoyer votre e-mail et votre mot de passe. Sans terminal ou avec
`--json`, la commande refuse avec `unknown_control_plane` ; passez `--url <host>` (ou définissez
`REBASE_CLOUD_URL`) pour vous y connecter délibérément.

Pour vous connecter sans navigateur, renseignez votre e-mail : `rebase cloud login --email
me@example.com` vous demandera votre mot de passe. **Inscrit avec Google, GitHub ou
LinkedIn ?** Votre compte ne possède pas de mot de passe, utilisez plutôt un code :

```bash
rebase cloud login --code --email me@example.com
```

Le plan de contrôle vous envoie par e-mail un code à 6 chiffres, valable dix minutes, que vous saisissez
dans l'invite. Avec `--email` et sans mot de passe, `rebase cloud login` demande
s'il faut utiliser votre mot de passe ou un code. Les codes nécessitent que le plan de contrôle soit en mesure d'envoyer des
e-mails ; si ce n'est pas le cas, `--code` le signale et se termine avec `otp_unavailable`.

Si vous avez activé l'authentification à deux facteurs, `login` demande ensuite le code de
votre application d'authentification ou l'un de vos codes de secours, quel que soit votre mode
de connexion. Via le navigateur, la console le demande lors de votre connexion. Ni un code de connexion ni un second facteur ne peuvent être saisis sans terminal.
Pour un script, créez un jeton d'accès dans la console (**Settings → Access
tokens**) et définissez `REBASE_TOKEN` ; consultez [CI et agents](/docs/deployment/cloud-agents/#ci-and-agents).

Un mot de passe incorrect renvoie `invalid_credentials` en rappelant ces deux modes de connexion,
la cause habituelle étant un compte qui n'a jamais eu de mot de passe.

`billing setup` associe une carte à l'organisation, une fois pour toutes. Elle se trouve au début
de la séquence à dessein : le premier déploiement d'un projet est refusé sans carte, et
s'en apercevoir après avoir téléversé tout le bundle est la pire des situations.

Ensuite, la page **Billing** de la console liste les factures de l'organisation,
chacune avec la page hébergée par Stripe et le PDF, et prévisualise la prochaine facture de chaque
projet. `rebase cloud billing invoices` et `rebase cloud billing upcoming`
affichent la même chose. Les deux s'adressent aux propriétaires et administrateurs de l'organisation. Lorsque
la plateforme le propose, **Manage billing** ouvre le portail client de Stripe pour gérer
la carte, les détails de facturation et les factures passées.

Avec une carte déjà enregistrée, créer un autre projet dans la console ne requiert
aucun paiement supplémentaire : le projet est facturé sur cette carte et déployé. Si la carte
est refusée ou que la banque demande une confirmation de paiement, la console vous redirige vers
**Billing**, où **Fix your card** permet d'enregistrer une autre carte et **Complete the
payment** ouvre la facture Stripe.

La consommation d'un projet apparaît dans sa vue d'ensemble, sous **Usage this month**, et
pour tous les projets à la fois sur la page **Billing** : requêtes par rapport au quota
inclus (la barre devient orange à 80 %), erreurs 5xx, dépassement actuel
et projection pour la fin du mois à ce rythme. Le dépassement est calculé par
le même code qui le transmet à Stripe, c'est donc ce qui figurera sur la facture ; il
apparaît sur la facture du mois suivant. `rebase cloud usage` affiche la
même chose, et `rebase cloud usage org` affiche l'organisation entière. Tout membre peut
le consulter. Les chiffres indiquent ce qu'ils ne prennent pas encore en compte : le stockage objet est mesuré mais
pas encore facturé ([Rebase Storage](/docs/deployment/rebase-storage/) indique son
tarif) ; lorsqu'un projet exécute deux pods applicatifs ou plus,
ses requêtes ne sont pas comptabilisées ; et une journée avec des échantillons manquants sous-estime le total. Un
projet avec autoscaling affiche également les pods exécutés au-delà de `--replicas`, en heures-pod,
leur coût selon ses propres tarifs et si cette plateforme les facture déjà. Un
projet revendiqué (claimed) depuis un agent ne compte que les jours à partir de la revendication : avant
cela, le projet appartenait à la plateforme.

Un projet existant peut être associé sans en créer un nouveau :

```bash
rebase cloud projects list
rebase cloud link --project my-app
```

## Déployer

```bash
rebase cloud deploy
```

Une seule commande, et aucun flag à mémoriser. Le fichier `rebase.json` généré déclare
`runtime: "managed"` pour son backend, et `deploy` lit cette déclaration — elle
le signale au passage (`rebase.json declares runtime: managed — deploying a
bundle`), compile l'application dans `dist-bundle`, téléverse le bundle, l'exécute sur
l'image runtime publiée et suit le déploiement jusqu'à un état final. Le code
de sortie fait foi, la même ligne fonctionne donc sans surveillance dans la CI.

Elle se termine en indiquant où chaque application répond désormais et si la nouvelle version est
bien en ligne :

```text
  ✓ Deployed songbuzz in 1m 12s  (deployment fb3c7442-9937-4179-8d3c-88a106da149d)

    game     static   https://songbuzz.rebase.website      live
    backend  backend  https://songbuzz.rebase.website/api  live

  ✓ Live: the new version answers on every address above.
  Something wrong? `rebase cloud rollback` puts the previous deployment back.
```

« Live » signifie que l'adresse a répondu après le build : le endpoint `/health` d'un backend a
renvoyé `ok`, et la page d'une application statique s'est chargée (depuis ce déploiement, lorsque la
plateforme la sert). Cette vérification attend jusqu'à `--live-timeout` secondes, 60 par
défaut ; `0` l'ignore. Si une application ne répond pas à temps, le déploiement renvoie tout de même un code
de sortie zéro car le déploiement a réussi, et la dernière ligne indique quelle application n'a pas
répondu et pourquoi. Un déploiement ayant échoué se termine plutôt sur une seule ligne, précisant l'application et la
raison, avec `rebase cloud logs` pour consulter l'intégralité du journal de build.

Les scripts peuvent passer `--json` pour obtenir un objet contenant les mêmes informations — `apps`, `hosts`,
`live`, `liveChecks`, `durationMs` et l'identifiant du déploiement. Contrairement au reste de
`rebase cloud`, `deploy` ne bascule pas automatiquement en JSON lorsqu'il est utilisé dans un pipe.

Ce que ce runtime autorise — paquets et modules natifs, mémoire et instances,
délais d'expiration et tailles de requêtes, système de fichiers, secrets, stockage et réseau
sortant — est détaillé sur sa propre page :
[Managed backend runtime](/docs/deployment/managed-runtime/).

Pour déployer un artefact compilé plus tôt — par exemple un job CI qui compile une fois et
déploie deux fois —, pointez vers le répertoire au lieu de recompiler :

```bash
rebase build
rebase cloud deploy --bundle-dir dist-bundle
```

Quitter le runtime géré possède son propre flag, `--eject`, et rien d'autre ne
le demande : un build qui ferait passer un projet géré sur une image de conteneur dont il devient
responsable est refusé tant que vous ne le spécifiez pas explicitement. Auparavant, `--force` avait cette signification, ce qui plaçait
l'action la moins réversible de la CLI sous le même terme qu'« écraser ce
fichier » ; il s'agit désormais d'une option inconnue plutôt que d'un alias, de sorte qu'un script l'utilisant
s'interrompt.

### La vérification de syntaxe avant le téléversement

Les fichiers d'une application statique sont servis exactement tels quels. Lorsque son `build` se contente
de copier des scripts écrits à la main dans `output`, rien ne les a analysés, et un fichier
contenant une faute de frappe part en production et empêche la page de se charger. C'est pourquoi, avant tout
téléversement, `deploy` analyse chaque fichier `.js`, `.mjs` et `.cjs` dans le dossier `output` de chaque application
statique, ainsi que chaque balise `<script>` inline dans ses fichiers `.html`. Cela
couvre aussi bien une application statique déployée seule que les applications statiques intégrées au
bundle du backend. Une erreur de syntaxe interrompt le déploiement en indiquant le fichier, la ligne et la colonne :

```
✗ A syntax error in the static output, so nothing was deployed:
    web/cloud.js:42:23  Unexpected token
        42 |     return fetch("/api";
Fix it and deploy again, or pass --no-verify to deploy anyway.
```

Avec `--json`, le `code` de l'erreur est `syntax_error`. Les scripts inline qu'un navigateur
n'exécute pas en tant que JavaScript sont ignorés : JSON, import maps, templates et tout
autre `type` non-JavaScript, les `<script src>`, ainsi que les scripts contenant encore
des balises de template non interprétées telles que `{{ }}`. Un fichier `.js` est validé s'il s'analyse
soit comme un script classique, soit comme un module, dans la mesure où c'est la page qui en décide. Rien
dans `node_modules` n'est lu, pas plus qu'un dossier `--bundle-dir` précompilé.
`--no-verify` ignore cette vérification pour un déploiement.

Surveiller :

```bash
rebase cloud logs               # the build log
rebase cloud logs --runtime -f  # what the running app prints, live, until Ctrl-C
rebase cloud status             # what the platform thinks the project is doing
```

`status` indique `blockedOn` et `nextAction`. Lorsque `blockedOn` vaut `null`, la
plateforme travaille normalement et scruter son état (polling) est approprié ; lorsqu'il désigne
un élément, cet élément attend une action de votre part.

L'un d'eux est `email_not_configured` : l'application a activé la connexion par magic link ou
code par e-mail (`AUTH_MAGIC_LINK`, `AUTH_EMAIL_OTP`) sans disposer de service de messagerie ;
le déploiement est donc en ligne mais personne ne peut s'y connecter. Rebase Cloud n'envoie pas
d'e-mails pour votre application : configurez `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` et
`SMTP_FROM` avec `rebase cloud env set`, puis déployez. `status` lit cette information depuis l'endpoint
`GET /api/auth/config` de l'application elle-même (son champ `unavailable`), et `deploy` affiche
la même chose sous sa vérification de disponibilité.

## Plusieurs bases de données

Déclarez chacune d'elles (`database("analytics")`) et déployez : elle est créée sur le serveur du projet sous
`DATABASE_URL__ANALYTICS`, partageant ses ressources et sa facture ([détails](/docs/backend/multiple-sources/#on-rebase-cloud)).

## Stockage de fichiers

Un nouveau projet n'a aucun bucket : les téléversements sont refusés avec `501 STORAGE_NOT_CONFIGURED`,
et le récapitulatif de déploiement l'indique, plutôt que d'écrire sur un disque remplacé à chaque déploiement.

Attribuez-lui l'un des deux types, puis redéployez pour que l'application le prenne en compte :

```bash
# A bucket Rebase runs for you. The console's Storage page does the same.
rebase cloud storage create

# Or your own S3-compatible bucket: AWS S3, Cloudflare R2, Backblaze B2, MinIO…
rebase cloud storage attach --bucket <name> \
  --access-key-id <id> --secret-access-key <secret> \
  --endpoint <url>        # omit for AWS; add --force-path-style for MinIO

rebase cloud deploy
```

`rebase cloud storage` liste les buckets du projet ; chaque `bucket("media")` déclaré
obtient le sien ([Multiple Databases and Buckets](/docs/backend/multiple-sources/#on-rebase-cloud)).
Avec vos propres buckets, associez
chacun avec `--source <key>` ; un bucket qui configure le stockage directement dans le code n'a besoin d'aucun des deux.

## Prévisualiser une modification

```bash
rebase cloud deploy --preview
```

Cette commande compile et téléverse exactement la même chose que `deploy`, mais la met à disposition sur une adresse
dédiée, telle que `https://shop--k3x9ab.rebase.website`. La production continue
de servir ce qu'elle servait auparavant. Le déploiement affiche l'adresse de la prévisualisation lorsque le
build se termine.

Pour conserver une même adresse au fil des déploiements, nommez la prévisualisation. Déployer à nouveau
avec le même nom la met à jour :

```bash
rebase cloud deploy --preview-name new-checkout
```

Les services avec lesquels communique une prévisualisation dépendent de ce que vous avez déployé :

- **`rebase cloud deploy --preview`** prévisualise le backend, avec ses applications statiques
  intégrées, de la même manière que la production les exécute. Il bénéficie de son propre backend sur
  sa **propre base de données vide**, jamais celle de production. Démarrer sur
  la base de données de production lui appliquerait le schéma et les règles d'accès de la prévisualisation.
- **`rebase cloud deploy web --preview`** prévisualiserait une application statique isolée,
  ses pages appelant le backend de **production**. Cela nécessite un plan de contrôle
  capable de servir des sites statiques de manière autonome, ce que Rebase Cloud ne prend pas
  encore en charge : il refuse l'opération avec `PREVIEW_STATIC_UNSERVED` et ne publie rien. Prévisualisez
  plutôt le backend, qui sert les applications statiques qui y sont intégrées ; un projet
  sans backend géré ne peut pas encore être prévisualisé.

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

La page **Deployments** de la console liste les mêmes prévisualisations et permet d'ouvrir, d'afficher le
journal de build ou de supprimer chacune d'elles. La création reste une étape via la CLI.

Une prévisualisation expire une semaine après son dernier déploiement.

À la fin, le déploiement vérifie que l'adresse de la prévisualisation répond, tout comme pour un
déploiement en production (`--live-timeout <seconds>`, `0` pour ignorer). Le certificat d'une nouvelle
prévisualisation pouvant prendre une minute ou deux, un déploiement réussi peut
indiquer que l'adresse ne répond pas encore.

Une prévisualisation de backend est facturée comme une unité applicative de taille par défaut (100m de CPU
et 384 Mio de mémoire, au tarif de votre application pour sa région et sa capacité),
au prorata de sa durée d'existence, et apparaît dans le devis mensuel du
projet sur la console. `rebase cloud deploy --preview` affiche la même estimation pour celle-ci,
par mois (`cost` sous `--json`). En démarrer une nécessite une carte enregistrée, comme pour
un déploiement en production. Un premier déploiement qui
échoue avant que quoi que ce soit ne tourne est supprimé plutôt que facturé. Un projet peut exécuter
jusqu'à trois prévisualisations de backend simultanément.

Chaque nouvelle adresse de prévisualisation reçoit son propre certificat TLS de Let's Encrypt,
qui autorise 50 nouveaux certificats par semaine pour un domaine, partagés avec tous les sites de production sur ce domaine.
Les prévisualisations peuvent en consommer 20 sur une période glissante de 7 jours, à l'échelle de la plateforme. Au-delà,
toute nouvelle prévisualisation est refusée (`429`, `preview_cert_budget`) en indiquant le moment où elle pourra
être déployée ; redéployer une prévisualisation existante n'est jamais décompté de ce quota.

La base de données d'une prévisualisation de backend est une seconde base de données sur le Postgres de **production** :
ses propres données, mais la même instance et le même disque. Elle est limitée à 10
connexions, afin que les prévisualisations ne puissent pas saturer celles de production, et à 2 Go : une prévisualisation
dont la base dépasse cette taille est mise en pause. Son backend s'arrête, son adresse cesse
de répondre, `rebase cloud previews` et la console l'affichent comme `paused` avec la
raison, et les propriétaires et administrateurs du projet sont notifiés (`preview.paused`). Ses
données sont conservées jusqu'à son expiration. Déployez-la à nouveau pour la démarrer (elle sera remise en pause
tant que la base reste trop volumineuse), ou supprimez-la. Une prévisualisation en pause reste
facturée jusqu'à sa suppression ou son expiration. Supprimez les prévisualisations dont vous n'avez plus besoin. Les extensions installées sur la production ne sont pas
installées dans la base de données d'une prévisualisation.

Les prévisualisations sont en cours de déploiement progressif. Un plan de contrôle qui ne les prend pas encore en charge refusera
`--preview` avec `previews_unavailable` et ne déploiera rien.

## Rollback

```bash
rebase cloud deployments
rebase cloud rollback
```

Un rollback fait pointer à nouveau le projet vers ce qu'un déploiement antérieur réussi
avait livré, et ne reconstruit jamais — l'intérêt d'un rollback étant de livrer un
artefact qui a déjà tourné avec succès.

Les déploiements éligibles dépendent du mode de déploiement du projet, et les deux
fonctionnent :

| Mode de déploiement | Ce qui est restauré |
|---|---|
| `rebase cloud deploy` (un build depuis les sources) | L'image publiée par ce build |
| `rebase cloud deploy --bundle` (le runtime de la plateforme) | Le bundle livré par ce déploiement, sur la version de runtime actuellement exécutée par le projet |

Les applications statiques intégrées au bundle du backend (un simple `rebase cloud deploy` sur un
projet avec un backend) font partie de ce bundle et reviennent donc en arrière avec lui.

Une application statique déployée seule (`rebase cloud deploy <app>`) ne peut pas encore faire l'objet
d'un rollback. Son déploiement enregistre quelle application a été publiée, mais aucun bundle, de sorte que le
plan de contrôle n'a rien à partir de quoi la restaurer. La solution consiste à redéployer la dernière
version fonctionnelle, par exemple depuis le commit précédant le commit défaillant. Après un tel
déploiement, `deploy` signale cela au lieu de suggérer `rollback`, et `rollback`
sans identifiant refuse d'agir plutôt que de redéployer le backend en cours d'exécution.

Un rollback nécessite donc un déploiement ayant enregistré l'un des deux éléments, ce qui implique
un projet ayant été déployé avec succès au moins deux fois. `rebase cloud deployments`
indique ceux qui sont éligibles, et `--json` renvoie `rollbackable` pour chaque ligne ainsi
que l'`image` ou le `bundle` qu'il restaurerait.

Deux types de déploiements sont refusés, et la CLI précise lequel : un qui n'a pas abouti,
et un antérieur à l'enregistrement des artefacts par la plateforme. Il n'y a rien à deviner
dans les deux cas — deviner reviendrait à livrer ce qui a été compilé ou téléversé le plus
récemment tout en prétendant restaurer celui-ci — déployez donc plutôt la version souhaitée.

Chaque déploiement réussi se termine en indiquant la commande de retour en arrière (`rebase cloud rollback`),
afin qu'elle reste visible au moment où une version défectueuse est constatée.

Un rollback ajoute un nouveau déploiement plutôt que de remonter le cours de l'historique, et attend
que la version restaurée soit en service avant d'indiquer le succès. Suivez-le avec
`rebase cloud logs -f`.

## Restaurer la base de données à un point dans le temps

Une base de données gérée peut être restaurée à n'importe quelle minute comprise dans sa fenêtre de rétention,
depuis **Database → Backups** dans la console ou avec la CLI :
`rebase cloud db pitr status | restore --target <ISO> | cutover | discard`.
L'opération se déroule en deux étapes. D'abord, une copie restaurée est préparée (staged) aux côtés de la base de données en production ;
votre application continue de tourner sur la base active, et le stockage de la copie est facturé jusqu'au
basculement (cutover) ou à son abandon (discard).
Ensuite, une fois la copie prête, le basculement redirige l'application vers celle-ci et la
redémarre. Tout ce qui a été écrit après l'heure cible ne figure pas dans la copie. La base de données d'origine
est conservée comme recours de secours et continue d'être facturée pour son stockage ; revenir en arrière,
la supprimer ou procéder à une seconde restauration nécessite de contacter le support. Seul un propriétaire ou un administrateur
peut préparer, basculer ou abandonner, et la console demande de confirmer le nom du projet
avant d'effectuer le basculement.

## Sécuriser votre compte

Votre compte console permet d'accéder aux bases de données de production, aux secrets et à la facturation,
protégez-le en conséquence. Ouvrez **Account security** depuis le menu situé sous votre avatar
dans la console (ou rendez-vous sur `/account`). Cette page vous est propre et n'appartient pas à une
organisation : vos réglages s'appliquent à toutes les organisations dont vous faites partie.

- **Validation en deux étapes.** Activez-la avec n'importe quelle application d'authentification (1Password,
  Google Authenticator, Authy). La page affiche une clé de configuration à ajouter à l'application, ou un
  lien qui ouvre l'application sur smartphone avec la clé préremplie, puis demande le
  code à 6 chiffres affiché par l'application. Dès lors, chaque connexion exigera un code,
  que vous vous connectiez avec un mot de passe, Google ou GitHub.
- **Codes de secours.** L'activation génère dix codes à usage unique, affichés une seule fois.
  Chacun d'eux permet de vous connecter à la place du code d'authentification si vous perdez votre
  téléphone, enregistrez-les donc avant de fermer la boîte de dialogue. **New recovery codes**
  les remplace et invalide les anciens. La désactivation de la validation en deux étapes
  ainsi que la génération de nouveaux codes exigent toutes deux un code au préalable.
- **Mot de passe.** Le modifier vous déconnecte de tous les autres appareils. Un compte
  créé via Google, GitHub ou LinkedIn ne possède pas de mot de passe ; la page propose de
  vous envoyer un lien par e-mail pour en définir un.
- **Appareils connectés.** Tous les navigateurs et terminaux connectés à votre compte,
  avec leur adresse et la date de connexion. Déconnectez tout appareil que vous ne
  reconnaissez pas, ou tous en une seule fois.

Les [jetons d'accès](/docs/deployment/cloud-agents/#ci-and-agents) ne constituent pas des sessions et ne demandent pas de second
facteur, la CI continue donc à déployer après l'activation. Révoquez tout jeton auquel vous ne faites plus
confiance sous **Settings → Access tokens**.

## Inviter votre équipe

**Members → Add member** permet d'ajouter une personne possédant déjà un compte Rebase avec une
adresse e-mail vérifiée, en tant qu'administrateur ou membre ; un propriétaire peut ensuite la promouvoir propriétaire.
L'accès est immédiat et aucun e-mail n'est envoyé. Rebase Cloud n'envoie pas
encore d'invitations, demandez donc à un collaborateur sans compte de s'inscrire et
de vérifier son adresse au préalable. Depuis un terminal :
[`rebase cloud orgs members invite <email>`](/docs/cli/cloud/#organizations), qui
vous avertit si l'adresse n'est associée à aucun compte.

## Accès Cloud et utilisateurs de votre application

Deux groupes de personnes distincts sont concernés, comme dans Firebase et Supabase :

- **L'accès Cloud** détermine qui peut intervenir sur le projet dans Rebase Cloud. Les
  propriétaires et administrateurs d'une organisation sont `admin` sur chaque projet qu'elle détient, et
  ses membres sont `developer`. Un projet peut également attribuer à une personne un rôle de son
  choix, `admin`, `developer` ou `viewer`, par le biais d'une invitation par e-mail, sans
  en faire un membre de l'organisation. Le rôle le plus élevé s'applique.
  [`rebase cloud access`](/docs/cli/cloud/#project-access) permet de le gérer.
- **Les utilisateurs de votre application** résident dans la propre base de données de l'application, avec son inscription et
  ses rôles. Rebase Cloud ne les liste ni ne les modifie jamais.

La seule passerelle est le bouton **Open admin panel**. Il connecte une personne disposant d'un
accès Cloud `admin` au panneau d'administration de l'application, en faisant correspondre son e-mail vérifié : l'application
trouve ou crée le compte avec cette adresse, lui attribue le rôle `admin`
et consigne que ce rôle provient de Rebase Cloud (le champ `roles` de la table des utilisateurs
dans le panneau d'administration le précise). Lorsque cette personne perd son accès Cloud `admin` au projet, Rebase
Cloud demande à l'application de révoquer ce rôle `admin`
et met fin à ses sessions dans l'application. Un rôle accordé manuellement dans l'application,
y compris un rôle `admin` détenu avant la première utilisation de Open admin panel, est conservé, et le
compte n'est jamais supprimé.

## Voir qui a fait quoi

La page **Activity** de la console et la commande `rebase cloud activity` permettent aux
propriétaires et administrateurs de l'organisation de voir qui a déployé, défini ou affiché une variable
d'environnement (par son nom, jamais par sa valeur), modifié un domaine, restauré une sauvegarde,
redimensionné, arrêté ou supprimé un projet, modifié le rôle d'un membre ou créé un
jeton, ainsi que la date et l'heure associées. La section **Settings** d'un projet renvoie vers ses propres entrées ; une entrée
relative à un projet supprimé est conservée. Un script peut les lire à l'aide d'un jeton créé avec
`--can audit` sur l'organisation. Les entrées sont conservées pendant un an. Les filtres sont décrits dans
[`rebase cloud`](/docs/cli/cloud/#organizations).

## CI et agents

Un job de CI ou un agent ne doit pas détenir votre mot de passe. Attribuez-lui un jeton restreint
à quelques actions sur un projet spécifique, créé depuis un terminal connecté via
`rebase cloud tokens create --project shop --can deploy,logs`, et définissez-le comme variable
`REBASE_TOKEN`. La facturation, le journal d'activité et les paramètres de notification d'une organisation
constituent des capacités distinctes (`--can billing`, `audit`,
`notifications`) qu'un jeton n'obtient que si elles sont explicitement demandées. Les capacités, un exemple
de workflow GitHub Actions et ce qui reste réservé à un utilisateur connecté sont détaillés dans
[CI et agents](/docs/deployment/cloud-agents/#ci-and-agents).

## Un backend sans compte

`rebase cloud init --claim` fournit à une application un backend opérationnel avant même que quiconque ne soit inscrit,
et affiche une URL de revendication (claim URL) pour que l'utilisateur puisse le conserver ; un projet que personne ne revendique
sous 72 heures est supprimé. Ce que le jeton du projet non revendiqué peut faire, la variable
`REBASE_API_TOKEN` qu'il écrit et les changements apportés par la revendication sont décrits dans
[Un backend sans compte](/docs/deployment/cloud-agents/#a-backend-with-no-account).

## Ressources de calcul et coûts

Le prix d'un projet est fixé d'après les ressources qu'il réserve, et non selon une offre forfaitaire. `compute` affiche
chaque curseur et le devis détaillé établi par le plan de contrôle. (`rebase cloud
resources` correspond à autre chose : les bases de données et buckets déclarés par le code,
et si chacun est provisionné — voir la [référence CLI](/docs/cli/cloud/).)

```bash
rebase cloud compute
rebase cloud compute set --cpu 500m --memory 2Gi
```

| Curseur | Unité, et signification |
|---|---|
| `--cpu`, `--memory` | Demande (request) applicative par instance, par ex. `500m` et `2Gi`. Laisser vide applique la valeur par défaut de la plateforme, qui dépend de la région (ci-dessous) |
| `--replicas` | Instances toujours existantes : le seuil minimal de l'autoscaler, et ce que l'abonnement du projet facture mensuellement |
| `--autoscale-max` | 1–16. Le plafond pouvant être atteint. Les instances ajoutées par l'autoscaler au-delà de `--replicas` sont mesurées à la seconde-pod aux mêmes tarifs, et facturées uniquement là où la plateforme a activé cette option ; **Usage this month** l'indique. `--no-autoscale` le désactive |
| `--autoscale-cpu-target` | 10–95. L'utilisation CPU visée par l'autoscaler, calculée par rapport à la demande (request) plutôt qu'à la limite. Vide équivaut à 70 |
| `--spot` | `true` ou `false`. Capacité préemptible : moins chère, mais redémarrée sans préavis |
| `--db-instances` | 1–3. `1` correspond à une instance unique sans basculement (failover) ; `2` ajoute une instance de secours (standby) automatique |
| `--db-cpu`, `--db-memory` | Par instance de base de données. Vide équivaut à `160m` et `1Gi` |

Un curseur laissé vide n'est pas identique à un curseur fixé à cette même valeur : un curseur vide
suit la valeur par défaut de la plateforme et évolue avec elle.

En Belgique (europe-west1), la configuration par défaut réserve 100m de CPU et 384 Mio avec possibilité d'extension
temporaire (burst) à 2 CPU et 2 Gio ; à Falkenstein et Helsinki, la mémoire peut s'étendre jusqu'à 1,4× la
demande (request) et le CPU jusqu'à 10× (au maximum 1,7 vCPU). `rebase cloud compute` affiche les valeurs de
votre projet.

Rien n'est validé par la CLI, à dessein — les limites dépendent du cluster sur lequel
tourne le projet, et elles diffèrent selon les fournisseurs. Le plan de contrôle rejette toute
valeur qu'il ne peut pas honorer et nomme le champ concerné. Exécutez `rebase cloud compute` pour voir
le montant en €/mois avant et après ; une modification s'applique immédiatement, au prorata à compter d'aujourd'hui.
Un changement de base de données s'applique immédiatement ; il est facturé à la taille actuelle jusqu'à son fonctionnement effectif.
Modifier le CPU ou la mémoire de la base de données, ou réduire le nombre d'instances, redémarre la base de données (environ
30 secondes à 3 minutes ; les connexions sont interrompues puis se rétablissent) : `compute set`
vous en avertit et demande confirmation, et hors d'un terminal interactif, `--yes` vaut consentement. Si ce redémarrage
échoue, `rebase cloud compute apply` réessaie.

## Le reste des commandes

| Groupe de commandes | Ce qu'il couvre |
|---|---|
| `login`, `logout`, `whoami`, `access-token` | Votre session ; `access-token` affiche le bearer token que la CLI enverrait actuellement, pour les scripts et le serveur MCP |
| `tokens` | Jetons pour la CI et les agents, chacun restreint à un projet. Voir [CI et agents](/docs/deployment/cloud-agents/#ci-and-agents) |
| `link`, `unlink`, `use`, `open` | Associer ce répertoire à un projet, sélectionner une organisation, ouvrir la console |
| `connect` | Ajouter un serveur Rebase auto-hébergé à votre compte, afin que le [connecteur Rebase](/docs/ai/rebase-connector/#add-your-self-hosted-instances) dans Claude y accède aux côtés de vos projets Cloud. `--list` les affiche, `--remove` en supprime un. Propriétaires et administrateurs |
| `init`, `claim` | Avec `--claim` : un backend actif sans compte, et un lien pour le revendiquer ; `claim` affiche à nouveau ce lien. Voir [Un backend sans compte](/docs/deployment/cloud-agents/#a-backend-with-no-account) |
| `projects` | Créer, lister, inspecter, supprimer |
| `deploy`, `logs`, `deployments`, `rollback`, `cancel` | Déploiement et surveillance |
| `deploy-hooks` | URLs secrètes qu'un hébergeur git ou un service de CI appelle pour déployer le projet : lister, créer (l'URL n'est affichée qu'une fois), révoquer. |
| `previews` | Builds mis à disposition sur leur propre adresse via `deploy --preview`, et leur suppression. Voir [Prévisualiser une modification](#prévisualiser-une-modification) |
| `sleep` | Mise en veille en cas d'inactivité : `on [--after 15m\|30m\|1h\|4h]`, `off`, `wake`, et `status` (par défaut). En veille, un projet n'occupe ni CPU ni mémoire et la requête suivante le réveille ; les tâches planifiées et traitements de fond ne s'exécutent pas pendant ce temps. Lorsqu'un projet ne peut pas être mis en veille, le plan de contrôle refuse et en explique la raison |
| `start`, `stop`, `restart` | Mettre un projet en pause et le réactiver. Un projet arrêté conserve son abonnement et ne paie que son disque, ou le minimum mensuel lorsque le disque coûte moins cher ; la ligne **Billing** de la console indique ce qu'il paie |
| `status`, `metrics`, `debug` | Ce qu'il fait, et pourquoi il ne le fait pas |
| `alerts` | Incidents ouverts du projet, et leur acquittement ou mise en sourdine. |
| `cron` | Tâches cron de l'application déployée et leurs exécutions enregistrées, lues avec vos identifiants `rebase cloud`. En lecture seule |
| `env` | Variables d'environnement. `list` n'affiche jamais les valeurs ; `--secret` est en écriture seule |
| `app-key` | La clé inscrite par `init --claim` dans `.env` en tant que `REBASE_API_TOKEN`, transférée lors de la revendication ; `rotate` la remplace et révoque l'ancienne. Propriétaires et administrateurs |
| `service-key` | `REBASE_SERVICE_KEY`, administrateur sur la propre API de l'application : date de sa dernière rotation ; `rotate` en fournit une nouvelle à l'application. Propriétaires et administrateurs |
| `domains` | Domaines personnalisés, enregistrements DNS à ajouter et vérification. Un projet peut répondre sur plusieurs domaines, chacun vérifié individuellement ; `verify` et `remove` prennent le domaine sur lequel agir, qui ne peut être omis que s'il n'en existe qu'un seul (pour `verify`, un seul en attente). Chaque domaine vérifié dessert le projet pour lui-même ; `primary <domain>` définit le domaine canonique et `redirect <domain>` redirige un autre domaine vers celui-ci avec une 308, chemin et paramètres de requête conservés (`--off` le sert à nouveau) — faites cela pour `www.` aux côtés d'un apex, car l'authentification Google, les cookies et les passkeys sont définis par origine. Un domaine sur lequel une application est servie (un `path` applicatif avec un nom d'hôte) n'est jamais redirigé. Un domaine apex (`example.com`, sans sous-domaine) nécessite un enregistrement **A**, car le DNS n'y autorise aucun CNAME. Cette adresse correspond à l'ingress de la plateforme et n'est pas garantie d'être immuable : si la plateforme migre, un enregistrement A continue de pointer vers l'ancienne adresse. Si votre hébergeur DNS propose l'aplatissement ALIAS, ANAME ou CNAME flattening sur l'apex, faites plutôt pointer l'apex vers le `tenantHost` du projet, qui suit la plateforme. Le CNAME d'un sous-domaine la suit déjà. `list` indique `verified, certificate pending` jusqu'à ce que HTTPS réponde avec un certificat réel. `list --json` renvoie `{ projectId, tenantHost, domains: [...] }` |
| `db` | Associer ou créer une base de données, s'y connecter depuis votre machine, sauvegardes, restauration et restauration à un point dans le temps |
| `guests` | Utilisateurs invités laissés par les connexions anonymes : les compter, en supprimer un, purger ceux non vus depuis longtemps. Voir [Guests](/docs/cli/cloud/#guests). Propriétaires et administrateurs |
| `extensions` | Liste d'autorisation (allowlist) des extensions Postgres |
| `storage` | Les buckets du projet et leurs clés, sur [Rebase Storage](/docs/deployment/rebase-storage/) |
| `resources` | Bases de données et buckets détenus par la plateforme, par rapport à ce que déclare le code |
| `compute` | Ce que ce projet réserve, ce qu'il coûte, et comment le modifier |
| `events` | Historique du backend, du plus récent au plus ancien : dimensionnement de l'application, modifications de la base planifiées et appliquées, prise de relais par une instance de secours, extension du disque |
| `usage` | Requêtes consommées ce mois-ci par rapport au quota inclus, et dépassement actuel, tel que décompté sur la facture. `usage org` liste tous les projets de l'organisation |
| `clusters` | Les clusters sur lesquels tournent les tenants. Administrateurs de la plateforme uniquement |
| `settings`, `orgs`, `access`, `billing` | Paramètres du projet, organisations, leurs membres et invitations, personnes ayant accès à un projet, paiement |
| `activity` | Journal d'audit de l'organisation : qui a déployé, modifié une variable d'environnement (par son nom), un domaine, une sauvegarde, un membre ou un jeton. Propriétaires et administrateurs. Voir [Voir qui a fait quoi](#voir-qui-a-fait-quoi) |
| `notifications` | Où les événements du projet sont envoyés par POST : Slack, Discord ou toute URL https ([Cloud notifications](/docs/deployment/cloud-notifications/)) |

Chaque groupe de ce tableau répond à `--help` avec une page qui lui est propre — une ligne d'utilisation,
ses options et des exemples — et `--help` n'exécute jamais la commande. Un test vérifie
l'index de ces pages ; ainsi, un groupe ajouté sans page fait échouer le build plutôt que
de répondre avec la table des matières. `verify:docs` confronte le tableau lui-même à
cet index : chaque groupe géré par la CLI apparaît ici exactement une fois, de sorte qu'un groupe
ajouté sans ligne dédiée fait également échouer le build.

Utilisé dans un pipe, `--help` répond en JSON : la même ligne d'utilisation, les mêmes options et exemples
sous forme de structure lisible plutôt que soixante lignes de séquences d'échappement de terminal.

## Ce que la bêta n'inclut pas

Pas de choix de région, pas d'inscription en libre-service, pas de SLA publié, pas de déploiements par branche,
des jetons qui agissent en tant que personne, et pas d'endpoint de base de données public. [Ce que la bêta
n'inclut pas](/docs/deployment/cloud-beta-limits/) détaille chacun de ces points en toute transparence,
ainsi que les implications d'un déploiement avec les secrets de production.

## Auto-hébergement à la place

Rien ici ne vous enferme. Le [guide d'auto-hébergement](/docs/deployment/self-hosting/)
exécute la même image et le même bundle avec `docker compose`, et le
[guide Kubernetes](/docs/deployment/kubernetes/) déploie la même topologie à partir
du Helm chart.
