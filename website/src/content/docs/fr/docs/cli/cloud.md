---
sourceHash: a31629385c88f416
title: rebase cloud
sidebar_label: rebase cloud
description: Les groupes de commandes pour Rebase Cloud dans la CLI — auth, liaison de projet, déploiements, config, organisations, bases de données, ressources, compute, stockage, webhooks, clusters et facturation.
---

Tout ce qui concerne Rebase Cloud, actuellement en bêta privée. Consultez le
[guide Rebase Cloud](/docs/deployment/cloud/) pour savoir ce que c'est et ce que la bêta
n'inclut pas.

Chaque groupe répond à `--help`, et `--help` n'exécute jamais la commande. La plupart des commandes
agissent sur le projet lié dans `.rebase/cloud.json` ; `--project <id>` opère sur
un projet sans liaison préalable.

Trois options s'appliquent partout : `--json` pour une sortie lisible par machine (également par défaut lors d'une redirection par pipe, sauf pour `deploy`, ou avec `REBASE_JSON=1`), `--url <origin>` pour cibler un plan de contrôle spécifique (ou `REBASE_CLOUD_URL`), et `--project, -p <id>`.

## Authentification

```bash
rebase cloud login      # sign in to the control plane
rebase cloud logout     # sign out
rebase cloud whoami     # the current session, or what REBASE_TOKEN may do
rebase cloud tokens create --can deploy,logs   # a token for CI, shown once
```

## Liaison de projet

```bash
rebase cloud link         # link this directory to a cloud project
rebase cloud link [url]   # or straight at a backend: no control plane, no login, and the rest of the family refuses until you unlink
rebase cloud unlink       # remove the link
rebase cloud use [org]    # select the active organization
rebase cloud open         # open the dashboard in a browser
```

## Projets

```bash
rebase cloud init --claim [--name <name>]   # un backend en ligne sans compte, et un lien pour le réclamer sous 72 heures
rebase cloud projects list
rebase cloud projects create [--link]
rebase cloud projects info [id]
rebase cloud projects delete [id]
```

## Déploiement et observation

```bash
rebase cloud deploy [app] [--source .]   # deploy an app and stream build logs
rebase cloud logs [--runtime] [-f]       # build logs, or the running process's
rebase cloud deployments list [--limit N|--all]
rebase cloud rollback [id] [-y]          # back to a successful deploy
rebase cloud cancel [-y]                 # cancel the in-flight build
rebase cloud start | stop | restart [-y] # stop and restart need -y
rebase cloud status                      # one-glance project status
rebase cloud metrics                     # live CPU / memory / disk
rebase cloud debug [health|logs|…]       # diagnose a deployment, read-only
```

`deploy` sans nom d'application déploie le backend. Un déploiement de bundle backend
téléverse également les sources du projet — ce que git suit, jamais un `.env` — afin qu'une
mise à niveau de la plateforme puisse le reconstruire ; `--no-source` ignore cela une fois, et `cloud settings set
--platform-rebuilds off` l'arrête et supprime la copie stockée. `--allow-downgrade` déploie une version plus ancienne.

Un `deploy` suivi se termine par un résumé : chaque application déployée avec son URL, l'identifiant du déploiement, sa durée et si la nouvelle version y répond. Il attend jusqu'à `--live-timeout` secondes (60 par défaut ; `0` ignore la vérification) que le `/api/health` du backend et l'adresse de chaque application statique répondent. Un déploiement en échec se termine par une ligne qui nomme l'application et la raison, avec un code de sortie non nul. Le résumé s'affiche aussi via un pipe ; `--json` (ou `REBASE_JSON=1`) affiche à la place un objet avec `apps`, `hosts`, `live`, `liveChecks` et `durationMs`.

Avant le téléversement, `deploy` analyse le JavaScript de chaque application statique qu'il livre : les fichiers `.js`/`.mjs`/`.cjs` de son `output` et les blocs `<script>` en ligne de son HTML. Une erreur de syntaxe arrête le déploiement avec `file:line:column` (code `syntax_error` avec `--json`), et `--no-verify` désactive la vérification. Un déploiement réussi se termine par le chemin du retour, `rebase cloud rollback`. Une application statique déployée seule ne peut pas encore faire l'objet d'un rollback ; voir [Rollback](/docs/deployment/cloud#roll-back).

## Configuration

```bash
rebase cloud env list | set | unset | reveal | pull
rebase cloud domains list | add <domain> | verify [domain] | remove <domain>
rebase cloud extensions list | enable | disable
rebase cloud settings show | set        # name, branch, repo, subdomain, rebuilds
```

## Organisations

```bash
rebase cloud orgs list | create | members
```

## Bases de données

```bash
rebase cloud db list | create | info | connect | test
rebase cloud db backup list | create | restore | status | download
rebase cloud db pitr status | restore | cutover | discard
```

`db connect` ouvre un port local qui *est* la base de données gérée (aucun point
d'accès public) jusqu'à Ctrl-C ; `--reveal` ajoute le mot de passe. Propriétaire ou administrateur uniquement.

## Ressources

Ce que la plateforme détient pour le projet, par rapport à ce que son code déclare.

```bash
rebase cloud resources                       # each database and bucket: declared? provisioned?
rebase cloud resources prune database <key>  # remove one the code no longer declares
```

Un déploiement ne supprime jamais une base de données provisionnée lorsque sa déclaration disparaît — cela
reviendrait à supprimer des données lors d'un push. Il la conserve, la lie et la facture jusqu'à ce que quelqu'un
la supprime explicitement par son nom.

## Compute

Ce que le projet réserve, et ce que cela coûte.

```bash
rebase cloud compute            # the current reservation and its monthly cost
rebase cloud compute set        # change it
```

`compute set` accepte `--cpu`, `--memory`, `--replicas`, `--spot`,
`--db-instances`, `--db-cpu`, `--db-memory`,
`--storage`, `--autoscale-max`, `--autoscale-cpu-target` et `--no-autoscale`.
`--scale-to-zero` est retiré : chaque backend exécute au moins une instance, donc
`true` est refusé et `false` est ignoré avec un avertissement. Il n'y a pas de niveaux
d'abonnements : chaque ressource est facturée à l'usage. Consultez
[Rebase Cloud](/docs/deployment/cloud/).

## Stockage, webhooks, clusters et facturation

```bash
rebase cloud storage             # list storage buckets
rebase cloud storage create      # provision platform-managed storage
rebase cloud storage attach      # attach your own S3-compatible bucket
rebase cloud webhooks list | create | delete
rebase cloud clusters list | add | verify   # the clusters tenants run on; `add` registers one from a kubeconfig
rebase cloud billing             # the billing account and card on file
rebase cloud billing setup       # attach a card, one-time, opens a browser
rebase cloud billing checkout    # a Stripe session for one project
```
