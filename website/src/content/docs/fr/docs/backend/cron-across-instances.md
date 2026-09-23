---
sourceHash: cae06a81ae018c4f
title: Cron entre plusieurs instances
sidebar_label: Cron entre plusieurs instances
description: "Comment les tâches cron se comportent avec plus d'un processus serveur : une exécution par créneau, un créneau perdu lors d'un redémarrage, une pause que toutes les répliques respectent, et des exécutions qui ne se chevauchent jamais."
---

Les [tâches cron](/docs/backend/cron-jobs) s'exécutent dans chaque processus dont
le planificateur est actif : toutes les répliques par défaut, ou seulement le
worker dans un [déploiement scindé](/docs/deployment/split-processes/). Chacun de
ces processus arme les mêmes minuteurs, et c'est la base de données qui les
empêche de se marcher dessus — une revendication par `(job, slot)`, pour qu'un
créneau s'exécute une seule fois ; un rattrapage pour un créneau perdu lors d'un
redémarrage ; et une ligne par tâche dans `rebase.cron_job_state`, qui porte la
pause que lisent toutes les répliques et le bail qu'une exécution détient tant
qu'elle dure.

Tout cela nécessite une base de données SQL ; les tables sont listées dans
[Schéma de persistance en base de données](/docs/backend/cron-jobs/#database-persistence-schema).
Sous MongoDB, ou avec `cronPersistence: false`, rien ne coordonne les processus :
chacun exécute chaque tâche, donc n'activez le planificateur que dans un seul
d'entre eux (`REBASE_CRON_SCHEDULER`).

## Récupération des créneaux manqués

Comme le planificateur calcule le prochain créneau à partir de l'instant présent (*now*) à chaque démarrage, un créneau ne s'exécute que si une instance était active et opérationnelle lorsqu'il s'est présenté. Tout ce qui remplace le processus pendant un créneau — un déploiement progressif (rolling deploy), un crash, le recyclage du conteneur par la plateforme — ignore cette exécution, et le processus de remplacement planifie le créneau *suivant*. Aucune erreur n'est levée ; l'exécution n'a simplement jamais lieu.

Ce n'est **pas** seulement un problème lié au scale-to-zero. Un service assigné à une instance active continue de perdre des exécutions, car une plateforme est libre de retirer l'instance hébergeant le timer et d'en démarrer une nouvelle.

Définissez `catchUpWindowSeconds` sur une fenêtre largement supérieure à un redémarrage, et le démarrage exécutera un créneau qu'il trouvera non réclamé dans cette fenêtre :

```typescript
export default defineCron({
    schedule: "0 6 * * *",       // daily at 06:00
    name: "Scrape Listings",
    catchUpWindowSeconds: 3600,  // tolerate an hour of downtime around 06:00
    handler: async (ctx) => { /* … */ }
});
```

Trois points à retenir :

- **Désactivé par défaut.** Sans `catchUpWindowSeconds`, le comportement reste inchangé.
- **Seul le créneau manqué le plus récent est exécuté.** Un démarrage après six heures d'interruption rattrape une tâche horaire une seule fois, pas six. Le rattrapage évite qu'une exécution disparaisse ; il ne rejoue pas l'historique.
- **Un magasin supportant les réservations (claims) est requis.** Le rattrapage réserve le créneau via la même clé `(job_id, slot)` que le parcours planifié utilise, ce qui est la seule chose distinguant « ce créneau n'a jamais tourné » de « ce créneau a déjà tourné sur l'instance en cours de remplacement ». Sans magasin connecté, le rattrapage est ignoré et un avertissement est consigné — sinon, une instance recyclée toutes les 30 minutes réexécuterait la même tâche horaire à chaque démarrage.

Dans le cas habituel — un redémarrage quelques minutes après qu'un créneau s'est exécuté normalement — le créneau le plus récent est déjà réclamé, donc le rattrapage ne coûte qu'une vérification de réservation par tâche par démarrage et ne fait rien de plus.

Au démarrage, les réservations de plus de sept jours sont supprimées, mais la plus récente de chaque tâche est toujours conservée, quel que soit son âge. Cette réservation est la preuve que le créneau a déjà tourné : une tâche mensuelle avec une fenêtre de rattrapage d'un mois n'est donc pas réexécutée par un déploiement le 10.

Une exécution récupérée constitue une entrée normale dans `cron_logs` (`manual` vaut `false`), avec une première ligne de journal indiquant le créneau récupéré et son retard :

```
⏰ Catch-up run for missed slot 2026-07-29T06:00:00.000Z (612s late)
```

---

## Mettre une tâche en pause dans tous les processus

<span class="since-badge" data-since="0.23">Since 0.23</span> Une pause est enregistrée dans
`rebase.cron_job_state`, et non dans la mémoire du processus qui a répondu, de
sorte qu'elle atteint chaque réplique — et, dans un
[déploiement scindé](/docs/deployment/split-processes/), le worker, quand la
requête a été servie par un processus `api` qui n'exécute aucun minuteur. Elle
survit aussi aux redémarrages et aux redéploiements : une tâche mise en pause
dans Studio reste en pause.

`$TOKEN` est un jeton d'accès administrateur et `$API_URL` l'adresse affichée
par `rebase dev` ; voir l'[API REST](/docs/backend/cron-jobs/#rest-api).

```bash
# Mettre en pause, pour tous les processus, jusqu'à ce que quelqu'un la reprenne
curl -X PUT -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
    -d '{ "enabled": false }' "$API_URL/api/admin/cron/health-check"

# Ne plus surcharger : suivre de nouveau le `enabled` que déclare le fichier de la tâche
curl -X PUT -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
    -d '{ "enabled": null }' "$API_URL/api/admin/cron/health-check"
```

`true` et `false` surchargent le `enabled` du fichier de la tâche ; `null`
supprime la surcharge. La ligne enregistre qui a fait le changement, et quand.

Chaque planificateur lit l'état quand un créneau arrive à échéance, avant de
revendiquer le créneau — une requête par déclenchement —, de sorte qu'une tâche
en pause ne consomme pas son créneau, et qu'une tâche reprise sur une réplique
s'exécute à son créneau suivant sur la réplique qui le revendique. Le rattrapage
au démarrage le lit aussi.

Si l'état ne peut pas être lu — table absente, base de données momentanément
injoignable —, le planificateur revient au `enabled` du fichier de la tâche et
journalise un avertissement. C'est voulu : une exécution planifiée échoue en mode
ouvert, comme lorsque la table des revendications ne peut pas répondre, car une
table défaillante ne doit pas arrêter silencieusement toutes les tâches. Si le
changement lui-même ne peut pas être enregistré, le `PUT` répond `503` et aucun
processus n'est modifié.

Sans base de données SQL (MongoDB) ou avec `cronPersistence: false`, il n'y a
nulle part où conserver l'état : une pause s'applique au processus qui l'a servie
et disparaît au redémarrage.

---

## Gestion de la concurrence

Pour garantir la stabilité lors de l'exécution d'opérations gourmandes en ressources, Rebase implémente un **verrou d'exécution à concurrence unique** strict par identifiant de tâche :
- **Chevauchements planifiés** : Si le déclenchement planifié d'une tâche survient alors que l'exécution précédente est toujours en cours, le planificateur ignore le déclenchement et planifie immédiatement la prochaine exécution candidate.
- **Collisions avec déclenchement manuel** : Si un opérateur déclenche manuellement une tâche en cours d'exécution via Rebase Studio ou l'API REST, la requête répond `409` avec le code `CRON_JOB_ALREADY_EXECUTING`, protégeant ainsi le worker actif. `details.log` est l'entrée d'omission décrite ci-dessous.

Dans les deux cas, une ligne est écrite dans `rebase.cron_logs`, de sorte que l'omission apparaît dans l'historique
d'exécution plutôt que seulement dans le journal du processus :

```json
{
  "jobId": "expire-users",
  "success": true,
  "result": { "skipped": true, "reason": "already_executing" },
  "logs": ["Skipped: the previous run has not finished"]
}
```

`success: true` car rien n'a échoué — c'est `result.skipped` qui le signale. Une
série de ces enregistrements d'affilée est la signature d'une tâche devenue trop longue pour sa fréquence,
et c'est un schéma qu'il est impossible de repérer si ces omissions ne sont pas enregistrées.

<span class="since-badge" data-since="0.23">Since 0.23</span> Le verrou vaut entre processus, pas
seulement au sein d'un seul. Chaque exécution — planifiée, manuelle ou de
rattrapage — prend un **bail d'exécution** dans `rebase.cron_job_state` avant que
son handler ne démarre, et le libère à la fin de l'exécution. Ainsi, un
déclenchement manuel depuis le processus `api` pendant que le worker exécute la
tâche répond `409`, et un créneau qui arrive à échéance pendant qu'une exécution
manuelle détient le bail dans un autre processus est ignoré. La ligne de journal
de l'omission nomme le processus qui détient le bail.

Un bail dure le `timeoutSeconds` de la tâche plus 30 secondes, et c'est aussi ce
qui libère une tâche dont le processus a planté en pleine exécution. Une tâche
avec `timeoutSeconds: Infinity` le détient au plus une heure : un plantage bloque
alors la tâche une heure plutôt qu'indéfiniment, et une exécution encore en cours
au bout d'une heure n'empêche plus un autre processus de démarrer la tâche. Une
tâche qui dure légitimement des heures doit indiquer un `timeoutSeconds` fini,
que son bail suit alors. Si le bail ne peut pas être pris parce que la base de
données ne répond pas, l'exécution se poursuit avec un avertissement, comme une
exécution planifiée dont la revendication ne peut pas être lue.
