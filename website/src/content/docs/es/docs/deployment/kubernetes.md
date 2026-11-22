---
sourceHash: 51abd249a5639803
title: Kubernetes
sidebar_label: Kubernetes
description: Despliega Rebase en un clúster de Kubernetes con el chart oficial de Helm — un Deployment o varios, un Job de migración que gestiona el esquema y aplicaciones estáticas en el mismo host.
---

## Descripción general

El chart oficial es la contraparte en Kubernetes de la configuración de autoalojamiento
con Docker Compose. Misma idea, misma imagen, mismo bundle: **el runtime es la
imagen, tu proyecto es el bundle y actualizar Rebase es un cambio de etiqueta (tag).**

Se publica como un artefacto OCI junto a la imagen del runtime, y ambos llevan
la misma versión: el chart que despliega el runtime `0.17.3` *es* el chart `0.17.3`,
por lo que solo hay un número al que seguirle la pista. Sin `--version`, obtendrás
la más reciente; fíjala para un despliegue real, de la misma forma en que fijarías
`image.tag`:

```bash
helm install rebase oci://registry-1.docker.io/rebasepro/rebase \
  --set config.databaseUrl='postgres://user:pass@host:5432/db' \
  --set config.jwtSecret="$(openssl rand -hex 32)" \
  --set config.serviceKey="$(openssl rand -hex 32)" \
  --set config.adminEmail=you@example.com \
  --set config.adminPassword="$(openssl rand -hex 16)" \
  --set ingress.host=api.example.com \
  --set image.repository=my-registry/my-app
```

El chart viene con el autoregistro desactivado, por lo que una versión (release) debe
indicar la cuenta con la que inicia sesión su operador; de lo contrario, se iniciará
con una tabla de usuarios vacía y sin forma de generar el primer emisor de llamadas
autenticado. `config.adminPassword` debe tener al menos 12 caracteres y `config.adminEmail`
necesita un punto en su dominio: la ruta de inicio de sesión analiza su cuerpo con
`z.string().email()`, por lo que `admin@localhost` es una cuenta en la que nadie
podría iniciar sesión y el runtime se niega a inicializarla (seed). Ambas son negativas
en tiempo de renderizado en lugar de sorpresas en tiempo de ejecución; consulta
[lo que el chart se niega a renderizar](#lo-que-el-chart-se-niega-a-renderizar). Inicia
sesión y cambia la contraseña; estos valores se almacenan en un Secret.

Adminístralos fuera de banda apuntando `existingSecret` a un Secret que contenga
`REBASE_ADMIN_EMAIL` y `REBASE_ADMIN_PASSWORD` junto con `DATABASE_URL` y el resto.

El chart despliega **únicamente el runtime**. No despliega Postgres: utiliza
CloudNativePG, una base de datos administrada o tu propio StatefulSet, y apunta
`config.databaseUrl` hacia él. Un chart que también se encargara de tu base de
datos asumiría la gestión de tus copias de seguridad y de tu conmutación por error
(failover), lo cual es una promesa mucho mayor que simplemente "ejecutar la aplicación".

> **Madurez.** En CI se comprueban dos cosas distintas, y una tercera no.
> El chart se analiza (lint) y renderiza contra Helm v4.2.4: cada topología
> documentada en esta página, incluido el comando de instalación anterior, y un caso
> para cada negativa listada a continuación. La imagen del runtime que despliega el
> chart se construye y arranca contra un Postgres real, para ambas formas en que puede
> llegar un bundle. Lo que **nunca se ha ejecutado es el chart contra un clúster en vivo**:
> nada ha programado (scheduled) estos manifiestos, por lo que las sondas (probes),
> el orden del Job de migración previo a la instalación y el ingress son correctos
> como YAML pero no han sido probados como despliegue. Considéralo como un punto de
> partida bien probado en lugar de una opción predeterminada probada en producción,
> y consulta [Autoalojamiento](/docs/deployment/self-hosting) para conocer la vía que sí lo está.

Para trabajar en su lugar desde un repositorio clonado (checkout) —un chart modificado
o una instalación aislada (air-gapped)—, `helm install rebase ./infra/charts/rebase`
acepta los mismos valores.

## Cómo incorporar tu proyecto al pod

| `bundle.mode` | Cómo | Cuándo |
|---|---|---|
| `image` (predeterminado) | Construye `FROM rebasepro/server` con `COPY dist-bundle /bundle`, luego establece `image.repository` | Casi siempre. Un solo artefacto, inmutable, sin dependencia en tiempo de ejecución de que una URL permanezca disponible |
| `url` | Imagen estándar; el runtime descarga un archivo tarball en cada inicio del pod | Un plano de control que envía bundles fuera de banda |

## Un solo proceso o varios

El valor predeterminado es un único Deployment que sirve todo: la misma estructura
que ejecuta el archivo Compose. Dividirlo requiere un solo valor:

```yaml
split: true
functions:
  enabled: true
  replicas: 3
worker:
  enabled: true
```

Eso te da un nivel `api`, un nivel `functions` y un `worker`, todos a partir de
la misma imagen y el mismo bundle. Consulta [Procesos divididos](/docs/deployment/split-processes)
para conocer la función de cada rol y por qué querrías separarlos.

Lo que el chart añade respecto a hacerlo manualmente es que **deriva las configuraciones
cuyo modo de fallo es el silencio**, a partir de los valores que ya le proporcionaste:

- `REBASE_ROLE` por unidad: `all` en la api cuando no hay unidad de functions, de modo que siga sirviendo tus funciones
- `REBASE_MIGRATE_ON_BOOT=none` en todas partes, ya que el Job de migración gestiona el esquema
- `REBASE_CRON_SCHEDULER=false` / `REBASE_JOB_WORKERS=false` en la api en cuanto existe un worker
- `TRUSTED_PROXY_HOPS` en la unidad de functions
- `REBASE_RATE_LIMIT_STORE=sql` tan pronto como un segundo proceso sirve HTTP

Un `REBASE_ROLE` incorrecto no sirve HTTP mientras que `/health` sigue respondiendo,
por lo que la comprobación de preparación (readiness) pasa y cada solicitud devuelve
un 404. La falta de `REBASE_MIGRATE_ON_BOOT` provoca un bucle de reinicios (crash loop)
cuya causa queda en un registro que nadie está mirando. El chart escribe todos ellos,
y `config.env` no puede sobrescribirlos.

### Separar cron de la ejecución de jobs

Dos workers con responsabilidades opuestas: ningún rol nuevo y sin código:

```yaml
worker:
  enabled: true
  cronScheduler: true
  jobWorkers: false
```

## El panel de administración y cualquier otro frontend

Una aplicación estática es la misma imagen de runtime iniciando un bundle con
`kind: static`. Esa ruta se interrumpe antes de que el runtime lea `DATABASE_URL`
o `JWT_SECRET`, por lo que estos pods no contienen **ningún secreto en absoluto**.

```yaml
staticApps:
  - name: admin
    path: /admin
    image:
      repository: my-registry/my-admin
      tag: "1.4.0"
```

El ingress enruta `/admin` hacia ella y `/` hacia la API, en el **mismo host**.
Esto es deliberado: el mismo origen significa que la autenticación mediante cookies
y CORS se mantienen exactamente iguales, y la división sigue siendo una decisión
de topología interna en lugar de un cambio en la superficie pública de tu producto.
El coste es que los recursos (assets) deben estar *compilados* para esa ruta, lo
cual comprueba el runtime al arrancar.

Desplegar el panel de administración consiste simplemente en actualizar la etiqueta
de la imagen en un Deployment. El backend no se reinicia.

## Esquema

`migrationJob.enabled` (el valor predeterminado) ejecuta un Job con hook
`pre-install,pre-upgrade` que aprovisiona y finaliza, y cada pod se inicia con
`REBASE_MIGRATE_ON_BOOT=none`. Nada en la ruta de las peticiones es responsable
del esquema de las tablas, lo cual es la respuesta más limpia posible a "exactamente
un proceso aprovisiona el esquema": deja de ser una regla que alguien deba recordar.
Los pods siguen manteniendo actualizadas al arrancar las tablas propias del
framework (autenticación, claves API, jobs, cron); `provision: false` también detiene
eso, no renderiza ningún Job y delega el esquema a una
[ejecución de aprovisionamiento](/docs/deployment/self-hosting/#when-only-your-change-process-may-change-the-database)
bajo tu propio proceso de cambios.

`mode: ensure` crea lo que falta, de manera aditiva, y es el único modo que acepta
la imagen del runtime. `push` se rechaza en el arranque: aplicar cambios en el
esquema de tablas es destructivo, y `rebase db push` desde un checkout o CI realiza
un simulacro (dry-run) del cambio, rechaza los cambios destructivos sin confirmación
y puede realizar una copia de seguridad previamente; nada de lo cual puede hacer
un pod que se inicia sin supervisión.

## Lo que el chart se niega a renderizar

Cada una de estas es una configuración que no produce ningún error en tiempo de
ejecución: el despliegue se levanta y algo deja de cumplirse silenciosamente.
En su lugar, `helm install` falla, indicando el valor que se debe cambiar:

- más de un proceso HTTP con `sharedState.rateLimitStore=memory`
- `functions.enabled` o `worker.enabled` mientras `split=false`
- dos aplicaciones estáticas reclamando la misma ruta, o una reclamando una ruta bajo `/api`
- `bundle.mode=image` mientras `image.repository` sigue siendo la imagen de runtime estándar
- `ingress.enabled` sin host, o `bundle.mode=url` sin URL
- un `migrationJob.mode` o `sharedState.rateLimitStore` no reconocido
- falta de `config.adminEmail` con el autoregistro desactivado: una versión en la que
  nadie puede iniciar sesión. Establece los dos valores de administración o
  `config.allowSelfRegistration=true`, teniendo en cuenta que la primera persona
  que llegue al formulario de registro se convertirá en su administrador
- un `config.adminPassword` de menos de 12 caracteres, o un `config.adminEmail`
  cuyo dominio no tenga punto. El runtime se niega a inicializar cualquiera de los dos
  en el arranque y deja la misma versión bloqueada

## Lo que el chart no puede hacer por ti

**Transmisión (broadcast) y presencia en tiempo real entre réplicas.** El bus de
canales predeterminado del runtime está en memoria, por lo que con más de una
réplica de API, un suscriptor en un pod no verá una transmisión publicada en otro.
La solución reside en la configuración de tu proyecto, no en el chart:

```ts
realtime: { bus: { type: "postgres" } }
```

Establece `sharedState.channelBusConfigured: true` para confirmar que lo has
hecho; el chart lo utiliza únicamente para decidir si debe mostrar una advertencia.
Las suscripciones a tablas ordinarias no se ven afectadas; esas viajan a través
de Postgres CDC.

El resto de lo que un proceso mantiene para sí mismo —archivos locales, subidas
reanudables, la caché de transformación de imágenes, la vista de Logs de Studio—
se detalla junto con la configuración que comparte cada uno en
[Ejecutar más de una instancia](/docs/deployment/multiple-instances/).
