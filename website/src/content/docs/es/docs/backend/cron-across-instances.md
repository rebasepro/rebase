---
sourceHash: eb2b1e4f16ef2812
title: Cron en múltiples instancias
sidebar_label: Cron en múltiples instancias
description: "Cómo se comportan los cron jobs con más de un proceso de servidor: una ejecución por slot, un slot que un reinicio perdió, una pausa que cada réplica respeta y ejecuciones que nunca se superponen."
---

Los [cron jobs](/docs/backend/cron-jobs) se ejecutan en cada proceso cuyo programador esté activo:
cada réplica por defecto, o solo el worker en un
[despliegue dividido](/docs/deployment/split-processes/). Cada uno de esos procesos
activa los mismos temporizadores, y la base de datos es lo que evita que interfieran entre
sí: un claim por `(job, slot)`, para que un slot se ejecute una sola vez; un catch-up para un slot que
un reinicio descartó; y una fila por job en `rebase.cron_job_state`, que contiene la
pausa que lee cada réplica y el lease que una ejecución retiene mientras se ejecuta.

Las tablas se enumeran en
[Database Persistence Schema](/docs/backend/cron-jobs/#database-persistence-schema).
Con `cronPersistence: false`, nada coordina los procesos:
cada uno ejecuta cada job, por lo que debe activar el programador en solo uno de ellos
(`REBASE_CRON_SCHEDULER`).

## Recuperación de slots perdidos

Debido a que el programador calcula el siguiente slot a partir de *ahora* en cada inicio, un slot solo se dispara si alguna instancia estaba activa y funcionando cuando llegó el momento. Cualquier cosa que reemplace el proceso durante un slot —un despliegue continuo (rolling deploy), una caída, una plataforma reciclando el contenedor— descarta esa ejecución, y el reemplazo programa el slot *posterior* a este. No se produce ningún error; la ejecución simplemente nunca ocurre.

Esto **no** es solo un problema de escalado a cero (scale-to-zero). Un servicio fijado a una instancia activa (warm instance) aún pierde ejecuciones, porque una plataforma tiene la libertad de retirar la instancia que contiene el temporizador e iniciar una nueva.

Establezca `catchUpWindowSeconds` en una ventana cómodamente más amplia que un reinicio, y el inicio ejecutará un slot que encuentre sin reclamar dentro de esa ventana:

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
- **Solo se ejecuta el slot perdido más reciente.** Iniciar después de una interrupción de seis horas recupera un job horario una sola vez, no seis veces. El catch-up evita que una ejecución se pierda; no reproduce el historial.
- **Se requiere un almacenamiento con soporte para claims.** Catch-up reclama el slot mediante la misma clave `(job_id, slot)` que utiliza la ruta programada, que es lo único que distingue "este slot nunca se ejecutó" de "este slot ya se ejecutó en la instancia que se está reemplazando". Sin un almacén conectado, el catch-up se omite y se registra una advertencia; de lo contrario, una instancia reciclada cada 30 minutos volvería a ejecutar el mismo job horario cada vez que se inicie.

En el caso habitual —un reinicio minutos después de que un slot se ejecutara con normalidad— el slot más reciente ya está reclamado, por lo que el catch-up cuesta una verificación de claim por job en cada inicio y no hace nada.

El programador elimina los claims de más de siete días cuando se inicia y luego cada hora, pero siempre conserva el más reciente de cada job, sin importar su antigüedad. Ese claim es el registro de que el slot ya se ejecutó, por lo que un job mensual con una ventana de catch-up de un mes no se vuelve a ejecutar por un despliegue el día 10.

Una ejecución recuperada es una entrada normal en `cron_logs` (`manual` es `false`), con una primera línea de registro que indica el slot que recuperó y cuánto retraso tuvo:

```
⏰ Catch-up run for missed slot 2026-07-29T06:00:00.000Z (612s late)
```

---

## Pausar un job en todos los procesos

Una pausa se almacena
en `rebase.cron_job_state`, no en la memoria del proceso que la atendió, por lo que
llega a cada réplica y, en un [despliegue dividido](/docs/deployment/split-processes/),
al worker, cuando la solicitud fue atendida por un proceso `api` que no ejecuta temporizadores.
También sobrevive a reinicios y redespliegues: un job pausado en Studio permanece pausado.

`$TOKEN` es un token de acceso de administrador y `$API_URL` la dirección que imprimió
`rebase dev` — consulte la [API REST](/docs/backend/cron-jobs-api/).

```bash
# Pause, for every process, until someone resumes it
curl -X PUT -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
    -d '{ "enabled": false }' "$API_URL/api/admin/cron/health-check"

# Stop overriding: follow the `enabled` the job's file declares again
curl -X PUT -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
    -d '{ "enabled": null }' "$API_URL/api/admin/cron/health-check"
```

`true` y `false` anulan el `enabled` en el archivo del job; `null` elimina la
anulación. La fila registra quién realizó el cambio y cuándo.

Cada programador lee el estado cuando vence un slot, antes de reclamar el
slot —una consulta por disparo—, por lo que un job pausado no consume su slot, y un job
reanudado en una réplica se ejecuta en su siguiente slot en la réplica que lo reclame.
El catch-up en el inicio también lo lee.

Si el estado no se puede leer —falta la tabla o la base de datos está temporalmente
inaccesible—, el programador recurre al `enabled` en el archivo del job y
registra una advertencia. Esto es deliberado: una ejecución programada aplica fail-open (falla abierta), al igual que cuando
la tabla de claims no puede responder, ya que una tabla dañada no debe detener silenciosamente
todos los jobs. Si el cambio en sí no se puede guardar, el `PUT` responde `503` y ningún
proceso se modifica.

Con `cronPersistence: false` no hay
dónde guardar el estado: una pausa solo se aplica al proceso que la atendió y
desaparece al reiniciar.

---

## Protección de concurrencia

Para garantizar la estabilidad al ejecutar operaciones que consumen muchos recursos, Rebase implementa un estricto **bloqueo de ejecución de concurrencia única** por ID de job:
- **Superposiciones programadas**: si el tick programado de un job se dispara mientras la ejecución anterior todavía está en curso, el programador omite el tick y programa inmediatamente la siguiente ejecución candidata.
- **Colisiones de activación manual**: si un operador activa manualmente un job en ejecución a través de Rebase Studio o la API REST, la solicitud responde `409` con el código `CRON_JOB_ALREADY_EXECUTING`, protegiendo al worker activo. `details.log` es la entrada de omisión descrita a continuación.

En cualquiera de los casos, se escribe una fila en `rebase.cron_logs`, por lo que la omisión queda en el
historial de ejecuciones en lugar de solo en el registro del proceso:

```json
{
  "jobId": "expire-users",
  "success": true,
  "result": { "skipped": true, "reason": "already_executing" },
  "logs": ["Skipped: the previous run has not finished"]
}
```

`success: true` porque nada falló: `result.skipped` es lo que lo indica. Una
serie consecutiva de estas omisiones es la señal distintiva de un job que ha sobrepasado su programación,
y ese es un patrón que solo se puede ver si las omisiones quedan registradas.

El bloqueo se mantiene
entre procesos, no solo dentro de uno. Cada ejecución —programada, manual o
catch-up— toma un **lease de ejecución** en `rebase.cron_job_state` antes de que su handler
se inicie, y lo libera cuando finaliza la ejecución. De este modo, una activación manual desde el proceso
`api` mientras el worker está ejecutando el job responderá `409`, y un slot que vence
mientras una ejecución manual retiene el lease en otro proceso se omite. La línea de registro
de la omisión nombra al proceso que retiene el lease.

Un lease dura el valor de `timeoutSeconds` del job más 30 segundos, lo que también
libera un job cuyo proceso falló a mitad de la ejecución. Un job con `timeoutSeconds: Infinity`
lo retiene como máximo durante una hora: en ese caso, una caída bloquea el job durante una hora en
lugar de para siempre, y una ejecución que continúe después de una hora ya no impedirá que otro
proceso inicie el job. Un job que legítimamente tarde horas en ejecutarse debe
especificar un `timeoutSeconds` finito, al cual se ajustará su lease. Si el lease no
se puede tomar porque la base de datos no puede responder, la ejecución continúa con una advertencia,
tal como lo hace una ejecución programada cuando no se puede leer su claim.
