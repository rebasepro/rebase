---
sourceHash: cae06a81ae018c4f
title: Cron entre instancias
sidebar_label: Cron entre instancias
description: "Cómo se comportan las tareas cron con más de un proceso de servidor: una ejecución por intervalo, un intervalo que un reinicio perdió, una pausa que respetan todas las réplicas y ejecuciones que nunca se solapan."
---

Las [tareas cron](/docs/backend/cron-jobs) se ejecutan en cada proceso cuyo
programador está activo: en todas las réplicas por defecto, o solo en el worker
en un [despliegue dividido](/docs/deployment/split-processes/). Cada uno de esos
procesos arma los mismos temporizadores, y la base de datos es lo que evita que
se pisen entre sí: una reclamación por `(job, slot)`, para que un intervalo se
ejecute una vez; una recuperación para un intervalo que un reinicio perdió; y
una fila por tarea en `rebase.cron_job_state`, con la pausa que leen todas las
réplicas y el lease que una ejecución mantiene mientras dura.

Todo esto necesita una base de datos SQL; las tablas se listan en
[Esquema de persistencia en base de datos](/docs/backend/cron-jobs/#database-persistence-schema).
En MongoDB, o con `cronPersistence: false`, nada coordina los procesos: cada uno
ejecuta todas las tareas, así que activa el programador en uno solo
(`REBASE_CRON_SCHEDULER`).

## Recuperación de intervalos perdidos (Missed Slots)

Dado que el programador calcula el siguiente intervalo a partir de *ahora* en cada inicio, un intervalo solo se ejecuta si alguna instancia estaba activa y corriendo cuando llegó el momento. Cualquier cosa que reemplace el proceso durante un intervalo —un despliegue continuo (rolling deploy), una caída, una plataforma reciclando el contenedor— descarta esa ejecución, y el reemplazo programa el intervalo *posterior* a este. Nada produce un error; la ejecución simplemente nunca ocurre.

Esto **no** es un problema exclusivo del escalado a cero (scale-to-zero). Un servicio fijado a una instancia activa (warm) sigue perdiendo ejecuciones, porque la plataforma tiene la libertad de retirar la instancia que contiene el temporizador e iniciar una nueva.

Configura `catchUpWindowSeconds` con una ventana cómodamente más amplia que un reinicio, y el inicio ejecutará un intervalo que encuentre sin reclamar dentro de esa ventana:

```typescript
export default defineCron({
    schedule: "0 6 * * *",       // daily at 06:00
    name: "Scrape Listings",
    catchUpWindowSeconds: 3600,  // tolerate an hour of downtime around 06:00
    handler: async (ctx) => { /* … */ }
});
```

Tres cosas a tener en cuenta:

- **Desactivado por defecto.** Sin `catchUpWindowSeconds`, el comportamiento no cambia.
- **Solo se ejecuta el intervalo perdido más reciente.** Arrancar tras una interrupción de seis horas pondrá al día una tarea horaria una sola vez, no seis. La recuperación (catch-up) evita que una ejecución se pierda; no reproduce el historial.
- **Se requiere un almacenamiento compatible con reclamaciones (claims).** Catch-up reclama el intervalo a través de la misma clave `(job_id, slot)` que utiliza la ruta programada, que es lo único que distingue «este intervalo nunca se ejecutó» de «este intervalo ya se ejecutó en la instancia que está siendo reemplazada». Sin un almacenamiento vinculado, catch-up se omite y se registra una advertencia; de lo contrario, una instancia reciclada cada 30 minutos volvería a ejecutar la misma tarea horaria cada vez que se iniciara.

En el caso habitual —un reinicio minutos después de que un intervalo se ejecutara normalmente—, el intervalo más reciente ya está reclamado, por lo que catch-up solo cuesta una comprobación de reclamación por tarea en cada inicio y no hace nada.

Al arrancar se eliminan las reclamaciones de más de siete días, pero siempre se conserva la más reciente de cada tarea, sea cual sea su antigüedad. Esa reclamación es el registro de que el intervalo ya se ejecutó, así que un despliegue el día 10 no vuelve a ejecutar una tarea mensual con una ventana de catch-up de un mes.

Una ejecución recuperada es una entrada normal en `cron_logs` (`manual` es `false`), con una primera línea de registro indicando el intervalo que recuperó y cuánto retraso tuvo:

```
⏰ Catch-up run for missed slot 2026-07-29T06:00:00.000Z (612s late)
```

---

## Pausar una tarea en todos los procesos

<span class="since-badge" data-since="0.23">Since 0.23</span> Una pausa se guarda en
`rebase.cron_job_state`, no en la memoria del proceso que atendió la petición,
así que llega a todas las réplicas — y, en un
[despliegue dividido](/docs/deployment/split-processes/), al worker, cuando la
petición la atendió un proceso `api` que no ejecuta temporizadores. También
sobrevive a reinicios y redespliegues: una tarea pausada en Studio sigue pausada.

`$TOKEN` es un token de acceso de administrador y `$API_URL` la dirección que
imprimió `rebase dev`; consulta la [API REST](/docs/backend/cron-jobs/#rest-api).

```bash
# Pausar, para todos los procesos, hasta que alguien la reanude
curl -X PUT -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
    -d '{ "enabled": false }' "$API_URL/api/admin/cron/health-check"

# Dejar de sobrescribir: volver a seguir el `enabled` que declara el archivo de la tarea
curl -X PUT -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
    -d '{ "enabled": null }' "$API_URL/api/admin/cron/health-check"
```

`true` y `false` sobrescriben el `enabled` del archivo de la tarea; `null` elimina
la sobrescritura. La fila registra quién hizo el cambio y cuándo.

Cada programador lee el estado cuando vence un intervalo, antes de reclamarlo —
una consulta por disparo —, de modo que una tarea pausada no gasta su intervalo, y
una tarea reanudada en una réplica se ejecuta en su siguiente intervalo en la
réplica que lo reclame. La recuperación al arrancar también lo lee.

Si el estado no se puede leer — falta la tabla, la base de datos no responde por
un momento —, el programador recurre al `enabled` del archivo de la tarea y
registra una advertencia. Es deliberado: una ejecución programada falla en
abierto, igual que cuando la tabla de reclamaciones no puede responder, porque
una tabla rota no debe detener en silencio todas las tareas. Si el propio cambio
no se puede guardar, el `PUT` responde `503` y no se modifica ningún proceso.

Sin una base de datos SQL (MongoDB) o con `cronPersistence: false` no hay dónde
guardar el estado: una pausa se aplica al proceso que la atendió y se pierde al
reiniciar.

---

## Protección de concurrencia

Para garantizar la estabilidad al ejecutar operaciones que consumen muchos recursos, Rebase implementa un estricto **bloqueo de ejecución de concurrencia única** por ID de tarea:
- **Solapamientos programados**: Si el tick programado de una tarea se dispara mientras la ejecución anterior todavía se está ejecutando, el programador omite el tick y programa inmediatamente la siguiente ejecución candidata.
- **Colisiones por activación manual**: Si un operador activa manualmente una tarea en ejecución a través de Rebase Studio o la API REST, la petición responde `409` con el código `CRON_JOB_ALREADY_EXECUTING`, protegiendo al worker activo. `details.log` es la entrada de omisión descrita más abajo.

En cualquier caso, se escribe una fila en `rebase.cron_logs`, por lo que la omisión queda registrada en el historial de ejecución y no solo en el log del proceso:

```json
{
  "jobId": "expire-users",
  "success": true,
  "result": { "skipped": true, "reason": "already_executing" },
  "logs": ["Skipped: the previous run has not finished"]
}
```

`success: true` porque nada falló: `result.skipped` es lo que lo marca. Varias de estas omisiones consecutivas son la señal característica de una tarea que ha sobrepasado su programación, y ese es un patrón que solo puedes ver si las omisiones quedan registradas.

<span class="since-badge" data-since="0.23">Since 0.23</span> El bloqueo se mantiene entre procesos,
no solo dentro de uno. Cada ejecución — programada, manual o de recuperación —
toma un **lease de ejecución** en `rebase.cron_job_state` antes de que arranque
su handler, y lo libera cuando termina. Así, una activación manual desde el
proceso `api` mientras el worker ejecuta la tarea responde `409`, y un intervalo
que vence mientras una ejecución manual en otro proceso tiene el lease se omite.
La línea de log de la omisión nombra el proceso que tiene el lease.

Un lease dura el `timeoutSeconds` de la tarea más 30 segundos, y eso es también
lo que libera una tarea cuyo proceso falló a mitad de una ejecución. Una tarea
con `timeoutSeconds: Infinity` lo mantiene como máximo una hora: un fallo bloquea
entonces la tarea una hora en lugar de para siempre, y una ejecución que sigue en
marcha pasada una hora ya no impide que otro proceso inicie la tarea. Una tarea
que legítimamente dura horas debería indicar un `timeoutSeconds` finito, que su
lease sigue entonces. Si el lease no se puede tomar porque la base de datos no
responde, la ejecución sigue adelante con una advertencia, igual que una
ejecución programada cuya reclamación no se puede leer.
