---
sourceHash: eb2b1e4f16ef2812
title: Cron sur plusieurs instances
sidebar_label: Cron sur plusieurs instances
description: "Comment les tâches cron se comportent avec plusieurs processus serveur : une exécution par créneau, un créneau manqué lors d'un redémarrage, une mise en pause respectée par chaque réplica et des exécutions qui ne se chevauchent jamais."
---

Les [tâches cron](/docs/backend/cron-jobs) s'exécutent dans chaque processus dont le planificateur est activé :
chaque réplica par défaut, ou seulement le worker sur un
[déploiement fractionné](/docs/deployment/split-processes/). Chacun de ces processus
arme les mêmes minuteurs, et c'est la base de données qui les empêche d'entrer en
conflit — une réservation par `(job, slot)`, afin qu'un créneau ne s'exécute qu'une seule fois ;
un rattrapage pour un créneau manqué suite à un redémarrage ; et une ligne par tâche dans
`rebase.cron_job_state`, contenant la mise en pause que chaque réplica lit et le bail (lease)
détenu par une exécution pendant son déroulement.

Les tables sont listées sous
[Database Persistence Schema](/docs/backend/cron-jobs/#database-persistence-schema).
Avec `cronPersistence: false`, rien ne coordonne les processus :
chacun d'eux exécute chaque tâche, veillez donc à n'activer le planificateur que dans un seul d'entre eux
(`REBASE_CRON_SCHEDULER`).

## Récupération des créneaux manqués

Comme le planificateur calcule le prochain créneau à partir de l'instant présent (*now*) à chaque démarrage, un créneau ne se déclenche que si une instance était active et en fonctionnement au moment prévu. Tout ce qui remplace le processus pendant un créneau — un déploiement progressif (rolling deploy), un crash, un recyclage du conteneur par la plateforme — abandonne cette exécution, et le remplaçant planifie le créneau *suivant*. Aucune erreur n'est levée ; l'exécution n'a tout simplement jamais lieu.

Il ne s'agit **pas** uniquement d'un problème lié au redimensionnement à zéro (scale-to-zero). Un service assigné à une instance active peut tout de même perdre des exécutions, car une plateforme est libre d'arrêter l'instance qui gère le minuteur pour en démarrer une nouvelle.

Définissez `catchUpWindowSeconds` sur une fenêtre largement supérieure à la durée d'un redémarrage, et le démarrage exécutera un créneau qu'il trouve non réclamé dans cette fenêtre :

```typescript
export default defineCron({
    schedule: "0 6 * * *",       // daily at 06:00
    name: "Scrape Listings",
    catchUpWindowSeconds: 3600,  // tolerate an hour of downtime around 06:00
    handler: async (ctx) => { /* … */ }
});
```

Trois choses à savoir :

- **Désactivé par défaut.** Sans `catchUpWindowSeconds`, le comportement reste inchangé.
- **Seul le créneau manqué le plus récent est exécuté.** Un démarrage après une interruption de six heures ne rattrape une tâche horaire qu'une seule fois, pas six. Le rattrapage évite qu'une exécution ne soit perdue ; il ne rejoue pas l'historique.
- **Un stockage prenant en charge les réservations (claims) est requis.** Le rattrapage réserve le créneau via la même clé `(job_id, slot)` que celle utilisée par l'exécution planifiée, ce qui est le seul moyen de distinguer « ce créneau n'a jamais été exécuté » de « ce créneau a déjà été exécuté sur l'instance en cours de remplacement ». Si aucun stockage n'est associé, le rattrapage est ignoré et un avertissement est consigné dans les logs — sinon, une instance recyclée toutes les 30 minutes réexécuterait la même tâche horaire à chaque démarrage.

Dans le cas classique — un redémarrage quelques minutes après qu'un créneau s'est exécuté normalement — le créneau le plus récent est déjà réservé, de sorte que le rattrapage ne coûte qu'une vérification de réservation par tâche à chaque démarrage et ne fait rien d'autre.

Le planificateur supprime les réservations de plus de sept jours à son démarrage puis toutes les heures, mais conserve toujours la plus récente pour chaque tâche, quel que soit son âge. Cette réservation atteste que le créneau a déjà été exécuté, de sorte qu'une tâche mensuelle avec une fenêtre de rattrapage d'un mois n'est pas réexécutée lors d'un déploiement le 10 du mois.

Une exécution rattrapée est une entrée normale dans `cron_logs` (`manual` est à `false`), avec une première ligne de log indiquant le créneau qu'elle a récupéré et son retard :

```
⏰ Catch-up run for missed slot 2026-07-29T06:00:00.000Z (612s late)
```

---

## Mettre en pause une tâche sur l'ensemble des processus

Une mise en pause est enregistrée
dans `rebase.cron_job_state`, et non dans la mémoire du processus qui l'a traitée, de sorte
qu'elle se propage à chaque réplica — et, sur un [déploiement fractionné](/docs/deployment/split-processes/),
au worker, lorsque la requête a été traitée par un processus `api` qui n'exécute aucun minuteur.
Elle survit également aux redémarrages et aux redéploiements : une tâche mise en pause dans Studio reste en pause.

`$TOKEN` est un jeton d'accès administrateur et `$API_URL` l'adresse affichée
par `rebase dev` — voir l'[API REST](/docs/backend/cron-jobs-api/).

```bash
# Pause, for every process, until someone resumes it
curl -X PUT -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
    -d '{ "enabled": false }' "$API_URL/api/admin/cron/health-check"

# Stop overriding: follow the `enabled` the job's file declares again
curl -X PUT -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
    -d '{ "enabled": null }' "$API_URL/api/admin/cron/health-check"
```

`true` et `false` surchargent la valeur de `enabled` définie dans le fichier de la tâche ; `null` supprime
la surcharge. La ligne enregistre qui a effectué la modification et à quel moment.

Chaque planificateur lit cet état lorsqu'un créneau arrive à échéance, avant de réserver
le créneau — une requête par déclenchement — de sorte qu'une tâche en pause ne consomme pas son créneau,
et qu'une tâche reprise sur un réplica s'exécute à son prochain créneau sur le réplica qui le réservera.
Le rattrapage au démarrage le lit également.

Si l'état ne peut pas être lu — table manquante, base de données momentanément
inaccessible —, le planificateur se rabat sur le `enabled` du fichier de la tâche et
consigne un avertissement. C'est un choix délibéré : une exécution planifiée applique le principe de « fail-open »,
tout comme lorsque la table des réservations ne peut pas répondre, car une table défectueuse ne doit pas
interrompre silencieusement toutes les tâches. Si la modification elle-même ne peut pas être enregistrée, le `PUT`
renvoie `503` et aucun processus n'est modifié.

Avec `cronPersistence: false`, il n'y a
aucun endroit où conserver l'état : une mise en pause ne s'applique qu'au processus qui l'a traitée
et disparaît au redémarrage.

---

## Protection contre la concurrence

Pour garantir la stabilité lors de l'exécution d'opérations gourmandes en ressources, Rebase implémente un **verrou d'exécution à concurrence unique (single-concurrency execution lock)** strict par identifiant de tâche :
- **Chevauchements planifiés (Scheduled Overlaps)** : Si le déclenchement planifié d'une tâche a lieu alors que l'exécution précédente est toujours en cours, le planificateur ignore ce déclenchement et planifie immédiatement la prochaine exécution candidate.
- **Collisions de déclenchements manuels (Manual Trigger Collisions)** : Si un opérateur déclenche manuellement une tâche en cours d'exécution via Rebase Studio ou l'API REST, la requête renvoie `409` avec le code `CRON_JOB_ALREADY_EXECUTING`, protégeant ainsi le worker actif. `details.log` correspond à l'entrée d'omission (skip) décrite ci-dessous.

Dans les deux cas, une ligne est écrite dans `rebase.cron_logs`, de sorte que l'omission figure
dans l'historique d'exécution plutôt que seulement dans les logs du processus :

```json
{
  "jobId": "expire-users",
  "success": true,
  "result": { "skipped": true, "reason": "already_executing" },
  "logs": ["Skipped: the previous run has not finished"]
}
```

`success: true` car rien n'a échoué — `result.skipped` est ce qui le signale. Une
suite de ces entrées consécutives est la signature d'une tâche devenue trop longue pour sa fréquence
de planification, et c'est un schéma que vous ne pouvez observer que si les omissions sont enregistrées.

Le verrou fonctionne
entre les différents processus, et pas seulement au sein d'un seul. Chaque exécution — planifiée, manuelle
ou de rattrapage — prend un **bail d'exécution (run lease)** dans `rebase.cron_job_state` avant que son
gestionnaire (handler) ne démarre, et le libère à la fin de l'exécution. Ainsi, un déclenchement manuel provenant
du processus `api` alors que le worker exécute la tâche renvoie `409`, et un créneau arrivant à échéance pendant
qu'une exécution manuelle détient le bail sur un autre processus est ignoré. La ligne de log de l'omission indique
le nom du processus qui détient le bail.

Un bail dure pendant la durée de `timeoutSeconds` de la tâche plus 30 secondes, ce qui permet
également de libérer une tâche dont le processus a planté en cours d'exécution. Une tâche avec `timeoutSeconds: Infinity`
le conserve au maximum une heure : un crash bloque alors la tâche pendant une heure plutôt
qu'indéfiniment, et une exécution toujours en cours après une heure n'empêche plus un autre
processus de démarrer la tâche. Une tâche qui s'exécute légitimement pendant des heures devrait
définir une valeur finie pour `timeoutSeconds`, sur laquelle son bail s'alignera. Si le bail ne peut pas
être obtenu parce que la base de données ne peut pas répondre, l'exécution se poursuit avec un avertissement,
tout comme une exécution planifiée lorsque sa réservation ne peut pas être lue.
