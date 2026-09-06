---
sourceHash: 44b8d8c5aa0525b6
title: Implementación de Rebase en Microsoft Azure
description: Implemente su instancia de Rebase de forma segura en Azure utilizando Azure Database for PostgreSQL y Azure Container Apps.
sidebar_label: Azure
---

Microsoft Azure ofrece integraciones estrechas y cumplimiento empresarial. La arquitectura óptima para ejecutar Rebase en Azure implica el uso de **Azure Database for PostgreSQL - Flexible Server** para la capa de datos y **Azure Container Apps** para alojar el contenedor de backend.

Para cumplir con la normativa europea de datos y obtener tiempos de respuesta locales rápidos, aprovisione sus recursos en regiones como **Europa Occidental (Ámsterdam)**, **Europa del Norte (Irlanda)** o **Francia Central (París)**.

## 1. Aprovisionar Servidor Flexible de PostgreSQL

**No hay ninguna imagen de aplicación que construir a partir de tu código**. `rebase build` produce un directorio `dist-bundle` con tus colecciones, funciones y crons compilados y —si tu proyecto declara una app estática— tu frontend construido. La imagen de runtime publicada lo ejecuta:

```bash
rebase build
```

Container Apps extrae desde un registro, así que hornea el bundle en una imagen derivada. Tres líneas, y fija exactamente lo que se ejecuta:

```dockerfile title="Dockerfile"
FROM rebasepro/server:0.17.3
COPY dist-bundle /bundle
```

Actualizar Rebase más adelante es un cambio en esa línea `FROM`. Tu bundle queda intacto.

1. Desde el Portal de Azure, busque y seleccione **Servidores de Azure Database for PostgreSQL**.
2. Haga clic en **Crear** y seleccione **Servidor Flexible**.
3. Elija su Grupo de Recursos y establezca su Región de la UE preferida.
4. Seleccione su tamaño de cómputo (por ejemplo, Propósito General o de Ráfaga `B2s` para implementaciones más pequeñas).
5. Configure la pestaña de **Autenticación** con un nombre de usuario de Administrador y una contraseña segura.
6. En **Redes**, asegúrese de que la opción "Permitir acceso público desde cualquier servicio de Azure dentro de Azure a este servidor" esté marcada para que su Container App pueda conectarse, o configure una VNet segura.
7. Anote el nombre de su servidor y ensamble la URI de conexión:
   `postgresql://your_admin:YOUR_PASSWORD@your-server-name.postgres.database.azure.com:5432/postgres`

## 2. Compilar y Enviar a Azure Container Registry (ACR)

Azure Container Apps extraerá su imagen de Docker desde ACR.
1. Cree un nuevo **Registro de Contenedores** en la región de la UE que haya elegido.
2. Inicie sesión desde su CLI:
   ```bash
   az acr login --name YourRegistryName
   ```
3. Compila y envía desde la raíz del proyecto:
   ```bash
   docker build -t yourregistryname.azurecr.io/rebase-backend:latest .
   docker push yourregistryname.azurecr.io/rebase-backend:latest
   ```
   Compile desde la raíz del proyecto — el Dockerfile del backend necesita todo el workspace como contexto de compilación (copia `pnpm-workspace.yaml`, `backend/` y `config/`), por lo que usar `./backend` como contexto falla.

## 3. Implementar Azure Container App

Azure Container Apps proporciona un entorno de contenedores sin servidor con entrada HTTPS integrada.

1. Busque en el portal **Container Apps** y haga clic en **Crear**.
2. Cree un nuevo Entorno de Container Apps en su región de la UE.
3. En la pestaña **Contenedor**, apunte a su registro ACR y seleccione la imagen `rebase-backend:latest`.
4. Configure las **Variables de entorno**:

| Nombre | Valor |
|------|-------|
| `DATABASE_URL` | Su cadena de conexión de Azure Postgres |
| `JWT_SECRET` | Una cadena segura aleatoria de 32+ caracteres |
| `NODE_ENV` | `production` |

5. En la pestaña **Ingreso**, habilite explícitamente el Ingreso.
6. Establezca el Puerto de Destino en **3001**.
7. Complete la creación. ¡Azure aprovisionará automáticamente el contenedor y le proporcionará una URL de Aplicación asegurada con TLS!

## 4. Crear el Esquema de la Base de Datos

Al arrancar, Rebase crea automáticamente **solo las tablas de autenticación**. Las tablas de sus propias colecciones **no se crean automáticamente**. Debe aplicar el esquema una vez contra la base de datos de producción:

```bash
pnpm run db:push
```

Si omite este paso, la aplicación arranca con normalidad y el inicio de sesión funciona —esa es la trampa—, pero cada colección devuelve un error de «tabla inexistente» (*missing table*) en su primera consulta.

Ejecútelo desde un checkout del proyecto o desde CI con `DATABASE_URL` apuntando a la base de datos de producción, **no dentro del contenedor**: la imagen de producción se distribuye sin la CLI. Añada temporalmente una regla de firewall en su Servidor Flexible de PostgreSQL que permita su IP (o el acceso desde servicios de Azure) mientras ejecuta el comando.

Para migraciones versionadas, use `pnpm run db:generate` + `pnpm run db:migrate` en lugar de `pnpm run db:push`.

---
