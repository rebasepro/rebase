---
sourceHash: 936afac32ad9dc9d
title: Despliegue de Rebase en AWS
description: Despliegue su instancia de Rebase de forma segura en Amazon Web Services utilizando RDS y AWS App Runner, con un fuerte enfoque europeo.
sidebar_label: AWS
---

Amazon Web Services (AWS) proporciona una escala increíble y seguridad de nivel empresarial. Para un despliegue de Rebase en producción, recomendamos desacoplar la arquitectura utilizando **Amazon RDS** para la base de datos PostgreSQL y **AWS App Runner** (o ECS Fargate) para servir el backend de Node.js.

Para mantener un estricto cumplimiento de la normativa europea de datos, asegúrese de operar completamente dentro de una región de la UE, como **eu-central-1 (Fráncfort)**, **eu-west-1 (Irlanda)**, o **eu-west-3 (París)**.

## 1. Aprovisionar Amazon RDS (PostgreSQL)

1. Navegue a la consola de **RDS** en la región de la UE seleccionada.
2. Haga clic en **Crear base de datos** y seleccione **Creación estándar**.
3. Elija el motor **PostgreSQL**.
4. En Plantillas, elija **Producción** o **Capa gratuita/Desarrollo** según su carga.
5. Cree un Nombre de usuario maestro (ej., `rebase_admin`) y genere de forma segura una Contraseña maestra.
6. En Conectividad, asegúrese de que la base de datos esté ubicada dentro de una **VPC** a la que su futura instancia de App Runner pueda acceder de forma segura (o hágalo públicamente accesible si controla estrictamente los rangos de IP de entrada).
7. Una vez aprovisionado, anote la **Dirección del endpoint** y ensamble su URI:
   `postgresql://rebase_admin:YOUR_PASSWORD@YOUR_ENDPOINT:5432/postgres`

## 2. Enviar imagen a ECR (Elastic Container Registry)

AWS App Runner extrae directamente de ECR.

**No hay ninguna imagen de aplicación que construir a partir de tu código**. `rebase build` produce un directorio `dist-bundle` con tus colecciones, funciones y crons compilados y —si tu proyecto declara una app estática— tu frontend construido. La imagen de runtime publicada lo ejecuta:

```bash
rebase build
```

App Runner extrae desde un registro, así que hornea el bundle en una imagen derivada. Tres líneas, y fija exactamente lo que se ejecuta:

```dockerfile title="Dockerfile"
FROM rebasepro/server:0.17.3
COPY dist-bundle /bundle
```

Actualizar Rebase más adelante es un cambio en esa línea `FROM`. Tu bundle queda intacto.

1. Navegue a **Elastic Container Registry** y cree un nuevo repositorio privado llamado `rebase-backend`.
2. Obtenga los comandos de envío proporcionados por AWS en la consola (que gestionan la autenticación de Docker).
3. Compila y envía desde la raíz del proyecto:
   ```bash
   docker build -t rebase-backend .
   ```
4. Etiquétela y envíela a su repositorio ECR recién creado.

## 3. Desplegar a través de AWS App Runner

App Runner es la forma más sencilla de ejecutar contenedores en AWS sin gestionar orquestadores.

1. Navegue a **AWS App Runner** y haga clic en **Crear servicio**.
2. Seleccione **Registro de contenedores** y elija **Amazon ECR**.
3. Busque y seleccione su imagen `rebase-backend`.
4. En **Configuración del servicio**, establezca el Puerto en **3001**.
5. Añada las Variables de Entorno necesarias en la pestaña de configuración:
   
| Clave | Valor |
|-----|-------|
| `DATABASE_URL` | Su cadena de conexión de RDS |
| `JWT_SECRET` | Un hash seguro generado aleatoriamente (32+ caracteres) |
| `NODE_ENV` | `production` |

6. (Opcional) Si su instancia de RDS es estrictamente privada, configure la red **VPC personalizada** en App Runner para que el contenedor pueda comunicarse de forma segura con la base de datos.
7. Haga clic en **Crear y desplegar**.

AWS gestionará la terminación TLS (proporcionando una URL `https` lista para usar) y pondrá en marcha el servidor Rebase.

## 4. Crear el Esquema de la Base de Datos

Al arrancar, Rebase crea automáticamente **solo las tablas de autenticación**. Las tablas de sus propias colecciones **no se crean automáticamente**. Debe aplicar el esquema una vez contra la base de datos de producción:

```bash
pnpm run db:push
```

Si omite este paso, la aplicación arranca con normalidad y el inicio de sesión funciona —esa es la trampa—, pero cada colección devuelve un error de «tabla inexistente» (*missing table*) en su primera consulta.

Ejecútelo desde un checkout del proyecto o desde CI con `DATABASE_URL` apuntando a la base de datos de producción, **no dentro del contenedor**: la imagen de producción se distribuye sin la CLI. Como RDS suele residir en una VPC privada, ejecute el comando desde una máquina con acceso a esa VPC (por ejemplo, un host bastión) o abra temporalmente el acceso al endpoint de RDS a su IP.

Para migraciones versionadas, use `pnpm run db:generate` + `pnpm run db:migrate` en lugar de `pnpm run db:push`.

---
