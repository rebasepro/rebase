---
sourceHash: 4561f107537e7ada
title: Pool de conexiones
sidebar_label: Pool de conexiones
description: El servicio pgbouncer que incluye el archivo compose autohospedado para clientes que no pueden mantener una conexión, y qué deja de funcionar mediante el pooling de transacciones a través de su puerto.
---

El runtime mantiene un pool pequeño y de larga duración y no necesita un pooler. Lo que sí lo necesita es todo lo demás que se comunica con la misma base de datos y no puede mantener una conexión: una función serverless, un script programado, una herramienta de BI, un worker de cola que escala a cincuenta instancias. El `max_connections` de Postgres es un límite estricto de unos pocos cientos y cada conexión es un *proceso*, por lo que un despliegue masivo en abanico (fan-out) de lambdas lo agota mucho antes de que la base de datos esté ocupada.

El archivo compose incluye un servicio `pgbouncer` para ese tráfico, bajo un perfil para que un despliegue sin este tipo de clientes no ejecute un proceso que no necesita:

```bash
docker compose --profile pooler up -d
```

```
postgres://rebase:$POSTGRES_PASSWORD@your-host:6432/rebase
```

```bash
PGBOUNCER_PORT=6432           # host port
PGBOUNCER_MAX_CLIENT_CONN=500 # client connections accepted
PGBOUNCER_POOL_SIZE=20        # server connections used to serve them
```

La autenticación del cliente se genera a partir de `DATABASE_URL` al iniciar, por lo que la contraseña no se escribe dos veces. El pooler se autentica en Postgres con `scram-sha-256`, que es lo que almacena Postgres 18; el valor predeterminado `md5` de la imagen falla en el inicio de sesión del *servidor* con `FATAL: server login failed: wrong password type`, lo que parece un error de contraseña incorrecta sin serlo.

Mantén la suma de `PGBOUNCER_POOL_SIZE` de todos los poolers holgadamente por debajo del `max_connections` de la base de datos; el runtime consume del mismo presupuesto.

## Qué cambia con el pooling de transacciones

Un cliente en el pool retiene una conexión del servidor durante la duración de una transacción y luego la devuelve, que es lo que permite que 500 clientes compartan 20 conexiones. Hay tres cosas que dejan de funcionar a través de ese puerto, y cada una de ellas es algo que el propio Rebase utiliza, razón exacta por la cual el runtime se conecta directamente y este puerto queda reservado para otros clientes:

- **`LISTEN`/`NOTIFY`.** [Realtime](/docs/backend/realtime/) se basa en esto, y un listener necesita una conexión que perdure más allá de una transacción. `LISTEN` es *aceptado* a través del pooler: responde a `LISTEN`, y luego nunca llega ninguna notificación.
- **Estado de la sesión**: `SET` (a diferencia de `SET LOCAL`), bloqueos consultivos (advisory locks) mantenidos entre sentencias, cursores `WITH HOLD`, tablas temporales. La siguiente transacción puede recaer en una conexión de servidor diferente, la cual no verá nada de esto. Ambos casos fallan de la misma manera poco intuitiva: con un solo cliente inactivo el estado suele seguir ahí, por lo que funciona mientras realizas pruebas y deja de funcionar bajo la concurrencia para la cual introdujiste el pooler.
- **Sentencias preparadas a nivel de protocolo.** Se puede configurar la mayoría de los controladores para que no las utilicen: node-postgres no lo hace de forma predeterminada; asyncpg necesita `statement_cache_size=0`.

`SET LOCAL` tiene alcance a nivel de transacción y funciona, que es con lo que se configura la seguridad a nivel de fila; por lo tanto, RLS se comporta de manera idéntica a través del puerto con pool.

Deja el perfil desactivado si no hay nada fuera del runtime que se conecte a tu base de datos. Un puerto sin usar es superficie de ataque.

## Siguiente

- [Self-hosting](/docs/deployment/self-hosting/): el archivo compose del que forma parte este servicio.
- [Más de una instancia](/docs/deployment/multiple-instances/): el estado que mantiene cada proceso del runtime, antes de añadir una réplica.
