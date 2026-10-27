---
sourceHash: 958615612ce5d124
title: Cloud-Benachrichtigungen
sidebar_label: Benachrichtigungen
description: Wie Rebase Cloud Personen benachrichtigt, wenn ein Deployment fehlschlägt, Backups aufhören, eine Zahlung abgelehnt wird oder die Nutzung 80 % überschreitet – signierte Webhooks an Slack, Discord oder eine beliebige URL, und E-Mail pro Person.
---

Die Plattform benachrichtigt Personen, wenn ein Deployment fehlschlägt, eine Datenbank
nicht mehr gesichert wird, eine Zahlung abgelehnt wird oder ein Projekt 80 % und dann
100 % seines Kontingents für den Monat überschreitet.
Sie ist Teil von [Rebase Cloud](/docs/deployment/cloud/), und jeder Befehl hier
steht in der [Cloud-Referenz der CLI](/docs/cli/cloud/).

## Webhooks

<span class="since-badge" data-since="0.26">Seit 0.26</span>

Ein Projekt kann diese Ereignisse an einen eingehenden Webhook von Slack oder Discord
oder an eine beliebige https-URL senden, über **Settings → Notifications** in der Konsole
oder mit der CLI:

```bash
rebase cloud notifications add https://hooks.slack.com/services/T000/B000/XXXX
rebase cloud notifications add https://ops.example.com/rebase --events deploy.failed,backup.unhealthy
rebase cloud notifications test <id>
rebase cloud notifications            # each destination, and how its last delivery went
rebase cloud notifications remove <id>
```

Die Ereignisse sind `deploy.failed` (der Standard), `deploy.succeeded`,
`deploy.rolled_back`, `backup.unhealthy`, `billing.payment_failed`,
`usage.threshold` und `preview.paused` (eine Backend-Preview, deren Datenbank über das
Preview-Limit hinausgewachsen ist, wurde gestoppt). Jeder POST ist JSON mit einem `type`, dem `project`, den Fakten des
Ereignisses, einer Konsolen-`url` und einem einzeiligen `text`. Slack zeigt den `text` als
Nachricht an, sodass die URL eines eingehenden Slack-Webhooks ohne jede Einrichtung funktioniert. Für Discord
hängen Sie `/slack` an das Ende seiner Webhook-URL an. `--format slack` sendet allein `{ "text" }`,
für einen Empfänger, der Felder ablehnt, die er nicht kennt. Ein Build-Log
gelangt nie in einen Webhook.

Jeder POST ist signiert: `X-Webhook-Signature: sha256=<hex HMAC-SHA256 of the raw
body>`, mit dem Secret, das einmalig angezeigt wird, wenn das Ziel hinzugefügt wird. Er
trägt außerdem `X-Webhook-Event` und eine `X-Webhook-Delivery`-ID, die über die Wiederholungen
einer Zustellung hinweg gleich bleibt. Eine Zustellung wird dreimal versucht, im Abstand von 1 und 5
Sekunden, jeder Versuch 5 Sekunden. Eine 4xx-Antwort außer 429, eine Weiterleitung oder eine abgelehnte
Adresse wird nicht wiederholt. Die URL muss https sein. Die Control Plane lehnt eine ab, die zu
einer privaten, Loopback-, Link-Local- oder Cloud-Metadaten-Adresse auflöst, sowohl beim
Hinzufügen als auch bei der Adresse, mit der sich jede Zustellung verbindet. Jedes Mitglied der
Organisation kann die Ziele eines Projekts auflisten, mit maskierten URLs.
Ein Ziel hinzuzufügen, zu testen und zu entfernen erfordert die Rolle Owner oder Admin.

## E-Mail

Jedes Mitglied wählt pro Organisation unter **Account → Notifications** in der Konsole,
welche E-Mails es erhält. Fehlschläge sind standardmäßig eingeschaltet: Ein
fehlgeschlagenes Deployment geht an die Person, die es gestartet hat, und an die Owners und Admins. Ein
erfolgreiches Deployment ist standardmäßig aus und geht, wenn eingeschaltet, nur an die Person,
die es gestartet hat. Eine abgelehnte Zahlung geht an die Owners und die Abrechnungs-E-Mail, einmal pro
Rechnung. Ein defektes Backup geht an die Owners und Admins, höchstens einmal am Tag pro
Datenbank. Jede Nutzungsmarke wird einmal im Monat pro Projekt gesendet. Eine Control Plane
ohne konfigurierten ausgehenden Mailversand sendet überhaupt keine E-Mails, und diese Seite in der Konsole sagt das.
Webhooks funktionieren in beiden Fällen.

Jedes Ereignis erreicht jede Person und jedes Ziel einmal, egal wie oft es
gemeldet wird. Ein von einer Person abgebrochenes Deployment und ein erfolgreiches
Plattform-Upgrade werden nicht gemeldet.

`rebase cloud webhooks` ist stillgelegt. Es hat nie etwas zugestellt, und jede
Aktion beendet sich jetzt mit 1 und dem Code `command_retired`. Um einen POST zu erhalten, wenn sich Zeilen
in den eigenen Tabellen Ihrer App ändern, verwenden Sie einen `WebhookDispatcher` im Code Ihrer App (siehe
[das Webhook-Rezept](/docs/recipes/webhooks/)).
