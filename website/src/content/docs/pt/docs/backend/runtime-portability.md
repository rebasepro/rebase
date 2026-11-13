---
sourceHash: 78888eb91334da42
title: Portabilidade de runtime
sidebar_label: Portabilidade de runtime
description: O que uma custom function importa decide se ela pode ser executada fora de um processo Node — o que é portátil, o que é exclusivo do Node e como o rebase build e o rebase doctor relatam isso.
---

Uma custom function é um app Hono, e o Hono roda em qualquer runtime JavaScript de servidor. Se a *sua* função pode rodar em outro lugar além de um processo Node depende, portanto, do que o próprio arquivo dela importa e acessa.

Nada aqui é uma restrição ao que você pode escrever hoje. Toda implantação do Rebase é um processo Node, uma função que lê um arquivo ou abre um socket é uma função perfeitamente válida, e nenhum build ou deploy falha por causa disso. Isso está documentado para que a resposta seja conhecida agora, em vez de descoberta arquivo por arquivo mais tarde.

**Portátil — funciona em qualquer runtime:**

- Tudo o que é exportado de `@rebasepro/server/functions`
- `getDriver(c)` e `rebase.dataAsAdmin` — ambos trafegam pela mesma conexão onde quer que sejam executados
- `rebase.auth`, `rebase.storage`, `rebase.email`
- `fetch`, `Request`/`Response`, `URL`, `crypto.subtle`, `TextEncoder` — a plataforma web
- Qualquer dependência que não precise do Node

**Exclusivo do Node:**

- `rebase.sql()` — a conexão de proprietário do banco de dados (database owner) é um socket TCP
- Um cliente Drizzle ou `pg` importado diretamente, pelo mesmo motivo
- Módulos nativos do Node (built-ins): `fs`, `path`, `crypto` (o módulo do Node — `globalThis.crypto` é portátil), `child_process`, …
- Pacotes construídos sobre eles: `jsonwebtoken`, `nodemailer`, `sharp`, `bcrypt`, …

**Bugs latentes em todos os runtimes** — vale a pena corrigi-los independentemente disso:

- Leitura de `process.env` no escopo do módulo (veja [Configuração e Segredos](/docs/backend/custom-functions/#configuration-and-secrets))
- Promises no padrão fire-and-forget em vez de [`waitUntil`](/docs/backend/custom-functions/#background-work)
- Depender de um handler continuar executando após a requisição atingir o timeout. No Node ele continua; essa é uma propriedade do processo, não uma garantia que o framework oferece

## Verificando suas próprias funções

O `rebase build` imprime uma linha por constatação acionável e registra o veredito por função no manifesto do bundle:

```json
{
  "functions": [
    { "name": "hello", "file": "backend/functions/hello.js", "portable": true },
    { "name": "reports", "file": "backend/functions/reports.js", "portable": false,
      "requires": ["imports the Node built-in \"fs\""] }
  ]
}
```

O `rebase doctor` relata a mesma coisa sem compilar.

## Se você precisar de um caminho específico para o runtime

O `runtimeKey()` retorna `"node"`, `"workerd"`, `"deno"`, `"bun"`, `"edge-light"`, `"fastly"` ou `"other"`; `isNodeRuntime()` é a verificação mais comum. Use-os para degradar recursos, não para bifurcar uma implementação — uma função que precisa de duas implementações são duas funções.

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
