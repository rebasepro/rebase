---
sourceHash: e7b16241ef98f0de
title: Hooks Globais de Backend
sidebar_label: Hooks Globais
description: Aplique callbacks de ciclo de vida transversais a todas as coleções no nível do servidor usando CollectionCallbacks.
---

## Visão Geral

O Rebase oferece dois níveis de callbacks de ciclo de vida de entidades — ambos usam o mesmo tipo `CollectionCallbacks` de `@rebasepro/types`:

- **[Callbacks por coleção](/docs/collections/callbacks)**: Definidos em configurações individuais de coleção. Eles são executados apenas para aquela coleção específica.
- **Callbacks globais**: Definidos em `initializeRebaseBackend({ callbacks })`. Eles são disparados em **todas** as coleções, em todos os caminhos de dados (API REST, WebSocket / tempo real, `rebase.dataAsAdmin` no lado do servidor).

Use callbacks globais para:
- **Mascaramento de PII** — ocultar campos confidenciais para chamadores não administradores em todas as coleções.
- **Registro unificado de auditoria (audit logging)** — registrar cada criação, atualização ou exclusão em um único local.
- **Validação transversal** — aplicar invariantes que abrangem múltiplas coleções.

:::note
**Ordem de execução**: callbacks globais → callbacks de coleção → callbacks de propriedade.
:::

---

## Configuração

:::note[Onde isso fica]
**Managed runtime** — `export const callbacks = { … }` em `config/index.ts`. O runtime lê essa exportação na inicialização; nada mais precisa ser alterado.

**Ejected** — a chave `callbacks` em `initializeRebaseBackend({ … })`.

O mapa completo está em [Visão Geral do Backend](/docs/backend/#where-each-option-lives).
:::

Passe a chave `callbacks` para `initializeRebaseBackend`:

```typescript no-verify
import { initializeRebaseBackend } from "@rebasepro/server";

const instance = await initializeRebaseBackend({
    // ... other config
    callbacks: {
        afterRead({ row, context }) {
            // Runs after every entity read, across all collections
            return row;
        },
        beforeSave({ values, context }) {
            // Runs before every entity save
            return values;
        }
    }
});
```

---

## Tipo `CollectionCallbacks`

```typescript
type CollectionCallbacks = {
    afterRead?(props):   Record<string, unknown>;  // Transform row before returning to caller
    beforeSave?(props):  Partial<Values>;           // Modify values before writing to DB
    afterSave?(props):   void;                      // After the write, still in the transaction
    afterSaveError?(props): void;                   // Side-effects after a failed save
    beforeDelete?(props): boolean | void;           // Return false (403) or throw to block deletion
    afterDelete?(props): void;                      // After the delete, still in the transaction
};
```

Todos os callbacks podem retornar uma `Promise` (assíncrono) ou um valor direto (síncrono).

---

## Propriedades dos Callbacks (Props)

Cada callback recebe um único objeto de propriedades. Campos comuns:

| Campo | Tipo | Presente em |
|-------|------|-------------|
| `collection` | `CollectionConfig` | Todos os callbacks |
| `path` | `string` | Todos os callbacks |
| `row` | `Record<string, unknown>` | `afterRead`, `beforeDelete`, `afterDelete` |
| `id` | `string` | `beforeSave` (opcional), `afterSave`, `afterSaveError`, `beforeDelete`, `afterDelete` |
| `values` | `EntityValues` | `beforeSave`, `afterSave`, `afterSaveError` |
| `previousValues` | `EntityValues` (opcional) | `beforeSave`, `afterSave`, `afterSaveError` |
| `status` | `"new" \| "existing"` | `beforeSave`, `afterSave`, `afterSaveError` |
| `context` | `RebaseCallContext` | Todos os callbacks |

`context.user` contém o usuário autenticado (`uid`, `roles`, etc.), ou é `undefined` para requisições públicas.

`collection` está sempre presente. Um callback global é disparado para todas as coleções, portanto
é o único nível registrado independentemente de qualquer uma delas — mas nunca
recebe uma coleção inexistente. Uma requisição que indique um caminho que o registro
de coleções não consegue resolver é recusada com `404 NOT_FOUND` antes que qualquer nível seja executado,
que é a mesma resposta que os caminhos de leitura e escrita já dão para tal caminho. A
alternativa — pular o nível para esses caminhos — transformaria o `afterRead` em
uma etapa de redação com uma exceção silenciosa, portanto isso não é disponibilizado.

---

## Pipeline de Execução

```
[Client Request]
       │
       ▼
 [Hono Router]
       │
 [Database Driver]
 ┌─────┴───────────────────────────────────────────────────────┐
 │ 1. Start PostgreSQL Transaction                             │
 │ 2. Set Config: app.user_id = '<uid>', app.user_roles = ...  │
 │                                                             │
 │ 3. Global Callback: beforeSave     ─┐                       │
 │ 4. Collection Callback: beforeSave ─┘ awaited               │
 │ 5. Drizzle SQL execution & Postgres RLS evaluation          │
 │ 6. Global Callback: afterSave      ─┐                       │
 │ 7. Collection Callback: afterSave  ─┘ awaited               │
 │                                                             │
 │ 8. Commit  ← a throw anywhere in 3–7 rolls the write back   │
 └─────┬───────────────────────────────────────────────────────┘
       │
 [Realtime notifications flushed — after the commit, never before]
       │
       ▼
[Client Response]
```

---

## Semântica de Bloqueio vs. Assíncrona

**Cada callback na lista abaixo é aguardado (`awaited`), e todos eles são executados dentro da
transação que processa a escrita.** Não há nível "fire and forget": a
linha e tudo o que seus callbacks executaram são confirmados (commit) juntos ou nada é confirmado.

- **`beforeSave`, `beforeDelete`** — se o callback lançar um erro (throw), a operação é rejeitada com um HTTP 400 contendo sua mensagem e o código `CALLBACK_REJECTED`, e a escrita no banco de dados nunca acontece. Lance um `RebaseApiError` de `@rebasepro/types` para escolher o status você mesmo — veja [Callbacks de Entidade](/docs/collections/callbacks#beforesave). Um `beforeDelete` que *retorna* `false` resulta na mesma recusa sem mensagem, e responde **403** com esse código.
- **`afterRead`** — a linha retornada (ou linha transformada) é o que o chamador recebe. Sua transação é `READ ONLY` — veja [abaixo](#afterread-cannot-write).
- **`afterSave`, `afterDelete`** — executam *antes* do commit, aguardados (`awaited`). Um erro lançado aqui reverte (rollback) a linha e responde com o mesmo **400 `CALLBACK_REJECTED`**, com `details.stage` indicando o hook. Eles mantêm a transação aberta enquanto são executados, portanto, um callback lento significa um lock retido.
- **`afterSaveError`** — executa quando o salvamento falha, no fluxo de saída.

:::caution[Esta página costumava dizer o oposto]
Versões anteriores afirmavam que `afterSave` e `afterDelete` "executavam após o commit da transação"
e "não bloqueavam a resposta HTTP". Eles nunca fizeram nenhuma dessas coisas. Código que
foi escrito com base nessa afirmação — uma chamada de webhook em `afterSave`, por exemplo — estava
mantendo uma transação de banco de dados aberta durante o tempo de uma requisição HTTP inteira,
e revertendo a linha sempre que o endpoint remoto estivesse indisponível.
:::

### Efeitos colaterais que não devem prender a transação

Qualquer coisa lenta, ou qualquer coisa que não possa ser desfeita se a transação sofrer rollback,
não deve ficar no corpo do callback:

| Objetivo | Faça isso em vez disso |
|---|---|
| Chamar um serviço de terceiros, enviar e-mail, gerar um arquivo | [Enfileire um job](/docs/backend/jobs). Um job enfileirado em uma transação que sofre rollback nunca foi enfileirado — o que é exatamente o comportamento desejado. |
| Informar outros processos de que algo aconteceu | Publique em um [canal em tempo real (realtime)](/docs/backend/realtime) após o retorno da escrita, não dentro do hook. |
| Trabalhar em uma [função customizada](/docs/backend/custom-functions) pela qual o chamador não precisa esperar | `waitUntil(c, promise)` de `@rebasepro/server/functions` — é executado após a resposta, e o host aguarda sua finalização antes de desligar. |

A regra geral: se a tarefa ainda deve acontecer mesmo quando a escrita for desfeita, ela
não faz parte da escrita, portanto não deve ficar dentro do hook.

### `afterRead` não pode escrever

Uma leitura no escopo de uma requisição abre sua transação como `READ ONLY`. O `afterRead` é executado dentro
dela, portanto **nenhuma escrita a partir desse callback pode ser bem-sucedida** — nem uma criação
com `context.data`, nem uma atualização, nem mesmo uma oculta dentro de um helper chamado por ele. O Postgres recusa a
instrução com o SQLSTATE `25006`, e o chamador recebe a resposta:

```json
{ "error": { "message": "An `afterRead` callback tried to write. …",
             "code": "READ_ONLY_TRANSACTION",
             "details": { "dbCode": "25006" } } }
```

Isso é um 409, não um 500: é o seu código sendo recusado, não uma falha do servidor.
O modo somente leitura é proposital — uma leitura que silenciosamente realiza escritas é uma leitura cujo
custo, locks e superfície de RLS não foram previstos por ninguém.

Portanto, **a auditoria de leitura não deve ficar em `afterRead`**. Em vez disso, registre a leitura fora da
requisição — a partir de um job em segundo plano alimentado pelo que você já emite, ou
a partir de uma função customizada que faça a leitura *e* a escrita com duas chamadas
separadas:

```typescript no-verify
// ✗ Fails with READ_ONLY_TRANSACTION on every read.
callbacks: {
    afterRead: async ({ path, row, context }) => {
        await context.data.read_log.create({ path, uid: context.user?.uid });
        return row;
    }
}
```

```typescript no-verify
// ✓ The read and the audit row are two operations, and only the second writes.
import { rebase } from "@rebasepro/server";

export default defineFunction("read-article", (app) => {
    app.get("/:id", async (c) => {
        const article = await c.var.driver.fetchOne({ path: "articles", id: c.req.param("id") });
        await rebase.dataAsAdmin.read_log.create({ path: "articles", uid: c.var.user?.uid });
        return c.json(article);
    });
});
```

A auditoria do lado da escrita não tem esse problema: `afterSave` e `afterDelete` são executados em uma
transação de leitura e escrita, e a linha de auditoria é confirmada (commit) juntamente com a alteração que ela registra.

---

## Exemplos

### Mascaramento de PII

Oculte endereços de e-mail para chamadores não administradores em todas as coleções:

```typescript no-verify
import { initializeRebaseBackend } from "@rebasepro/server";

const instance = await initializeRebaseBackend({
    // ... other config
    callbacks: {
        afterRead({ row, context }) {
            const isAdmin = context.user?.roles?.includes("admin");
            if (!isAdmin && row.email) {
                return { ...row, email: "********" };
            }
            return row;
        }
    }
});
```

### Registro de Auditoria Global (Global Audit Logging)

Registre cada exclusão, em todas as coleções, em uma tabela `audit_log`. Como
`afterDelete` roda na própria transação da exclusão, a linha de auditoria e a
exclusão sofrem commit juntas — não há intervalo em que uma exista sem a
outra:

```typescript no-verify
import { initializeRebaseBackend } from "@rebasepro/server";

const instance = await initializeRebaseBackend({
    // ... other config
    callbacks: {
        async afterDelete({ collection, id, row, context }) {
            if (collection.slug === "audit_log") return;   // don't audit the audit
            await context.data.audit_log.create({
                action: "delete",
                collection: collection.slug,
                entity_id: String(id),
                actor: context.user?.uid ?? "anonymous",
                snapshot: row
            });
        }
    }
});
```

Observe o benefício e o custo disso: se a linha de auditoria não puder ser gravada, a
exclusão também não acontece. Para uma trilha de auditoria, isso é geralmente o que você deseja.
Se não for o caso, capture o erro no callback e documente isso em um comentário.

### Lógica Específica por Coleção

Callbacks globais disparam para todas as coleções. Para restringir a lógica a uma única coleção, verifique `collection.slug` ou `path`:

```typescript
callbacks: {
    beforeSave({ collection, values, context }) {
        if (collection.slug === "orders") {
            if (!values.total || values.total <= 0) {
                throw new Error("Order total must be positive");
            }
        }
        return values;
    }
}
```

Para callbacks que se aplicam apenas a uma única coleção, prefira usar [callbacks por coleção](/docs/collections/callbacks).

---
