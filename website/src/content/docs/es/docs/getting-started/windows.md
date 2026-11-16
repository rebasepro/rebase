---
sourceHash: 3f66e135e36c529b
title: Windows
sidebar_label: Windows
description: "Instala y ejecuta un proyecto Rebase en Windows: qué funciona de forma nativa, la única herramienta (Atlas) que necesita su propio binario de Windows para db push, db generate y db migrate, y cuándo usar WSL2 en su lugar."
---

Un proyecto de Rebase se instala y ejecuta en Windows. Una herramienta requiere un paso adicional:
[Atlas](https://atlasgo.io/), el motor que planifica las migraciones de esquemas. Su paquete
npm, `@ariga/atlas`, solo incluye compilaciones para Linux y macOS, por lo que en Windows
debes instalar el binario propio de Atlas para Windows en su lugar.

Solo tres comandos utilizan Atlas: [`rebase db push`, `rebase db generate` y
`rebase db migrate`](/docs/cli/database/#commands). Ejecutar la aplicación no lo necesita. `rebase dev` crea las
tablas y columnas faltantes al iniciar sin él, por lo que puedes comenzar a construir antes de
instalarlo.

El CI de Rebase se ejecuta en Linux y macOS. Si deseas que tu máquina coincida
exactamente con un servidor Linux, usa [WSL2](#alternativa-wsl2) en su lugar.

## 1. Requisitos previos

- **Node.js** 22.22+ y **pnpm**, como en el [Inicio rápido](/docs/getting-started/quickstart/#prerequisites)
- PowerShell, para el paso de Atlas a continuación

## 2. Crear el proyecto

```bash
pnpm dlx @rebasepro/cli init my-app
```

La instalación muestra un `preinstall` fallido para `@ariga/atlas`, con
`Unsupported platform`, y luego finaliza. Esto es lo esperado. El scaffold
declara `@ariga/atlas` como una dependencia opcional, por lo que si una plataforma
no puede instalarlo, lo omite y la instalación continúa.

```bash
cd my-app
pnpm dev
```

Esto no necesita nada más. La aplicación, el panel de administración y la base de datos
de desarrollo administrada funcionan sin Atlas.

## 3. Instalar Atlas para los comandos de esquema

Descarga el binario de Windows de Atlas, guárdalo como `atlas.exe` y añade su carpeta al
`PATH` de tu usuario. En PowerShell:

```powershell
$dir = "$env:LOCALAPPDATA\Programs\atlas"
New-Item -ItemType Directory -Force $dir | Out-Null
Invoke-WebRequest https://release.ariga.io/atlas/atlas-windows-amd64-v1.2.3.exe -OutFile "$dir\atlas.exe"
[Environment]::SetEnvironmentVariable("Path", [Environment]::GetEnvironmentVariable("Path", "User") + ";$dir", "User")
```

Abre una nueva terminal para que reconozca el nuevo `PATH` y verifícalo:

```powershell
atlas version
```

La versión 1.2.3 es la versión más antigua que acepta el scaffold (`"@ariga/atlas": "^1.2.3"`).
En Linux y macOS la instalación toma la versión 1.x más reciente, por lo que cualquier versión 1.x
posterior también funciona aquí: cambia la versión en la URL. Solo se publica una compilación x64;
Windows en Arm la ejecuta bajo emulación.

La CLI busca primero en `node_modules/.bin` y luego consulta a Windows (`where atlas`),
por lo que una vez que `atlas.exe` está en el `PATH`, los tres comandos lo encontrarán:

```bash
pnpm run db:push
```

[`rebase doctor`](/docs/cli/#rebase-doctor) también lo comprueba. Hasta que `atlas.exe` esté en el `PATH`, mostrará
una advertencia y enlazará a esta página.

## Un proyecto creado con anterioridad

Un proyecto generado con una versión anterior de `@rebasepro/cli` declara `@ariga/atlas` en
`dependencies`, y su instalación falla en Windows con
`ELIFECYCLE Command failed with exit code 1`. Muévelo a `optionalDependencies`
en `backend/package.json`:

```json
{
    "optionalDependencies": {
        "@ariga/atlas": "^1.2.3"
    }
}
```

Elimínalo de `dependencies`, ejecuta `pnpm install` y luego sigue el
[paso 3](#3-instalar-atlas-para-los-comandos-de-esquema). En Linux y macOS nada
cambia, ya que una dependencia opcional que se puede instalar, se instala. Esto
incluye el CI y la imagen de despliegue.

## Alternativa: WSL2

[WSL2](https://learn.microsoft.com/windows/wsl/install) ejecuta una distribución
de Linux real, por lo que el paquete npm se instala con normalidad y ninguno de los pasos
anteriores aplica. También es sobre lo que se ejecuta Docker Desktop.

Mantén el proyecto dentro del sistema de archivos de Linux (`~/code/my-app`), no bajo
`/mnt/c/`. Leer archivos a través de ese límite ralentiza las instalaciones y el observador
de archivos (file watcher). Abre el proyecto desde Windows con la
[extensión de WSL para VS Code](https://code.visualstudio.com/docs/remote/wsl), o
a través de `\\wsl$\`.

## Próximos pasos

- [Inicio rápido](/docs/getting-started/quickstart/): el resto de una primera ejecución, igual en todas las plataformas
- [Comandos de base de datos](/docs/cli/database/): qué hace cada uno de los comandos `db push`, `db generate` y `db migrate`
- [Solución de problemas](/docs/troubleshooting/): los fallos que impiden que un backend se inicie y cómo se ve cada uno
