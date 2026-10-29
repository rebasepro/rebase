---
sourceHash: bf0e0428a86e411f
title: Notifications Cloud
sidebar_label: Notifications
description: Comment Rebase Cloud prévient les personnes lorsqu'un déploiement échoue, que les sauvegardes s'arrêtent, qu'un paiement est refusé ou que l'usage dépasse 80 % du quota — webhooks signés vers Slack, Discord ou n'importe quelle URL, et e-mail par personne.
---

La plateforme prévient les personnes lorsqu'un déploiement échoue, qu'une base de données
cesse d'être sauvegardée, qu'un paiement est refusé, ou qu'un projet atteint 80 % puis
100 % de son quota du mois.
Cela fait partie de [Rebase Cloud](/docs/deployment/cloud/), et chaque commande présentée ici
figure dans la [référence cloud de la CLI](/docs/cli/cloud/).

## Webhooks

Un projet peut envoyer ces événements vers un webhook entrant Slack ou Discord,
ou vers n'importe quelle URL https, depuis **Settings → Notifications** dans la console
ou avec la CLI :

```bash
rebase cloud notifications add https://hooks.slack.com/services/T000/B000/XXXX
rebase cloud notifications add https://ops.example.com/rebase --events deploy.failed,backup.unhealthy
rebase cloud notifications test <id>
rebase cloud notifications            # each destination, and how its last delivery went
rebase cloud notifications remove <id>
```

Les événements sont `deploy.failed` (par défaut), `deploy.succeeded`,
`deploy.rolled_back`, `backup.unhealthy`, `billing.payment_failed`,
`usage.threshold` et `preview.paused` (un aperçu de backend dont la base de données a dépassé
la limite des aperçus a été arrêté). Chaque POST est du JSON avec un `type`, le `project`, les faits de
l'événement, une `url` de console et un `text` d'une ligne. Slack affiche le `text` comme
message, si bien qu'une URL de webhook entrant Slack fonctionne sans aucune configuration. Pour Discord,
ajoutez `/slack` à la fin de l'URL de son webhook. `--format slack` envoie `{ "text" }`
seul, pour un récepteur qui rejette les champs qu'il ne connaît pas. Un log de build n'entre
jamais dans un webhook.

Chaque POST est signé : `X-Webhook-Signature: sha256=<hex HMAC-SHA256 of the raw body>`, avec le secret affiché une fois lors de l'ajout de la destination. Il porte aussi
`X-Webhook-Event` et un identifiant `X-Webhook-Delivery` qui reste le même
d'une nouvelle tentative à l'autre d'une même livraison. Une livraison est tentée trois fois, à 1 et 5
secondes d'intervalle, 5 secondes chacune. Un 4xx autre que 429, une redirection ou une
adresse refusée ne donne pas lieu à une nouvelle tentative. L'URL doit être en https. Le plan de contrôle refuse une URL qui se résout vers
une adresse privée, de bouclage (loopback), link-local ou de métadonnées cloud, à la fois lors de son
ajout et sur l'adresse à laquelle chaque livraison se connecte. N'importe quel membre de
l'organisation peut lister les destinations d'un projet, avec leurs URLs masquées.
Les ajouter, les tester et les supprimer exige le rôle de propriétaire ou d'administrateur.

## E-mail

Chaque membre choisit quels e-mails il reçoit, par organisation, sous
**Account → Notifications** dans la console. Les échecs sont activés par défaut : un
déploiement échoué est envoyé à celui ou celle qui l'a lancé ainsi qu'aux propriétaires et administrateurs. Un
déploiement réussi est désactivé par défaut et, lorsqu'il est activé, n'est envoyé qu'à celui ou celle qui l'a
lancé. Un paiement refusé est envoyé aux propriétaires et à l'adresse de facturation, une fois par
facture. Une sauvegarde défaillante est envoyée aux propriétaires et administrateurs au plus une fois par jour et par
base de données. Chaque seuil d'usage est envoyé une fois par mois et par projet. Un plan de contrôle
sans envoi d'e-mails configuré n'envoie aucun e-mail, et cette page le dit.
Les webhooks fonctionnent dans les deux cas.

Chaque événement atteint chaque personne ou destination une seule fois, quel que soit le nombre de fois où il est
signalé. Un déploiement annulé par une personne, et une mise à niveau de la plateforme qui a
réussi, ne sont pas signalés.

`rebase cloud webhooks` est retiré. Il n'a jamais rien livré, et chaque
action se termine désormais avec le code 1 et `command_retired`. Pour recevoir un POST lorsque des lignes changent
dans les propres tables de votre app, utilisez un `WebhookDispatcher` dans le code de votre app (voir
[la recette Webhooks](/docs/recipes/webhooks/)).
