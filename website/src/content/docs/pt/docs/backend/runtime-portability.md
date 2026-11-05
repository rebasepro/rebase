---
sourceHash: 088ee76c9513e196
title: Portabilidade de runtime
sidebar_label: Portabilidade de runtime
description: O que uma função personalizada importa decide se ela poderia rodar fora de um processo Node — o que é portável, o que é exclusivo do Node e como rebase build e rebase doctor informam isso.
---

Uma função personalizada é um aplicativo Hono, e o Hono roda em todos os runtimes JavaScript para servidores. Saber se a *sua* função poderia rodar em outro lugar que não um processo Node se resume, portanto, ao que o arquivo dela importa e acessa.

Nada do que está aqui representa uma restrição sobre o que você pode escrever hoje. Toda implantação do Rebase é um processo Node; uma função que lê um arquivo ou abre um socket é perfeitamente válida, e nenhuma compilação ou deploy falha por causa disso. Isso está detalhado aqui para que as capacidades sejam conhecidas agora, em vez de descobertas caso a caso no futuro.

**Portável — funciona em qualquer runtime:**

- Tudo exportado de `@rebasepro/server/functions`
- `getDriver(c)` e `rebase.dataAsAdmin` — ambos utilizam a mesma comunicação de rede onde quer que estejam rodando
- `rebase.auth`, `rebase.storage`, `rebase.email`
- `fetch`, `Request`/`Response`, `URL`, `crypto.subtle`, `TextEncoder` — a plataforma web padrão
- Qualquer dependência que não exija o Node

**Exclusivo do Node:**

- `rebase.sql()` — a conexão proprietária com o banco de dados é um socket TCP
- Um cliente Drizzle/`pg`/`mongodb` importado diretamente, pelo mesmo motivo
- Módulos nativos do Node: `fs`, `path`, `crypto` (o módulo Node — `globalThis.crypto` é portável), `child_process`, …
- Pacotes construídos sobre eles: `jsonwebtoken`, `nodemailer`, `sharp`, `bcrypt`, …

**Bugs latentes em qualquer runtime** — vale a pena corrigi-los de qualquer maneira:

- `process.env` lido no escopo do módulo (consulte [Configuração e Variáveis Secretas](/docs/backend/custom-functions/#configuration-and-secrets))
- Promises estilo "dispare e esqueça" (fire-and-forget) em vez de [`waitUntil`](/docs/backend/custom-functions/#background-work)
- Depender de um manipulador que continua rodando após o tempo limite da requisição ter expirado. No Node ele continua; essa é uma propriedade do processo, não uma garantia fornecida pelo framework

## Verificando suas próprias funções

O comando `rebase build` imprime uma linha para cada ocorrência detectada e grava o resultado por função no manifesto do bundle:

```json
{
  "functions": [
    { "name": "hello", "file": "backend/functions/hello.js", "portable": true },
    { "name": "reports", "file": "backend/functions/reports.js", "portable": false,
      "requires": ["imports the Node built-in \"fs\""] }
  ]
}
```

O comando `rebase doctor` relata a mesma informação sem a necessidade de compilar.

## Caso você precise de um caminho específico para determinado runtime

`runtimeKey()` retorna `"node"`, `"workerd"`, `"deno"`, `"bun"`, `"edge-light"`, `"fastly"` ou `"other"`; `isNodeRuntime()` é a verificação mais comum. Use-os para degradação graciosa, não para bifurcar uma implementação — uma função que precisa de duas implementações consiste em duas funções diferentes.

```typescript
import { defineFunction, isNodeRuntime } from "@rebasepro/server/functions";

export default defineFunction((app, { rebase }) => {
    app.get("/stats", async (c) => {
        if (!isNodeRuntime()) return c.json({ error: "Not available here" }, 501);
        const rows = await rebase.sql("SELECT count(*) AS total FROM jobs");
        return c.json({ totalJobs: Number(rows[0]?.total ?? 0) });
    });
});
```
