---
sourceHash: 97a20df64eaeffc7
title: Hooks Globais de Backend
sidebar_label: Hooks Globais
description: Aplique callbacks de ciclo de vida transversais a todas as coleções no nível do servidor usando CollectionCallbacks.
---

## Visão Geral

O Rebase oferece dois níveis de callbacks de ciclo de vida de entidades — ambos utilizam o mesmo tipo `CollectionCallbacks` de `@rebasepro/types`:

- **[Callbacks por coleção](/docs/collections/callbacks)**: Definidos nas configurações de coleções individuais. Eles são executados apenas para aquela coleção.
- **Callbacks globais**: Definidos em `initializeRebaseBackend({ callbacks })`. Eles são disparados em **todas** as coleções, em todos os caminhos de dados (API REST, WebSocket / realtime, `rebase.dataAsAdmin` no lado do servidor).

Use callbacks globais para:
- **Escopo de linhas (Row scoping)** — <span class="since-badge" data-since="0.22">Desde 0.22</span> `beforeQuery` em todas as coleções, para que as leituras de um locatário (tenant) sejam restringidas em um único local, em vez de coleção por coleção. Apenas para Postgres: junto a uma fonte de dados MongoDB ou Firestore, um `beforeQuery` global se recusará a inicializar em vez de deixar as leituras dessa fonte irrestritas. Consulte [`beforeQuery`](/docs/collections/callbacks#beforequery).
- **Mascaramento de PII** — ocultar campos confidenciais para chamadores não administradores em todas as coleções.
- **Registro de auditoria unificado** — registrar cada criação, atualização ou exclusão em um único lugar.
- **Validação transversal** — aplicar invariantes que abrangem várias coleções.

:::note
**Ordem de execução**: callbacks globais → callbacks de coleção → callbacks de propriedade.
:::

---

## Configuração

:::note[Onde isso é configurado]
**Runtime gerenciado** — `export const callbacks = { … }` a partir de `config/index.ts`. O runtime lê essa exportação na inicialização; nada mais precisa ser alterado.

**Ejetado (Ejected)** — a chave `callbacks` em `initializeRebaseBackend({ … })`.

O mapa completo está na [Visão Geral do Backend](/docs/backend/#where-each-option-lives).
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
    beforeQuery?(props): QueryNarrowing | void;     // Conditions to AND into a read before it is compiled
    afterRead?(props):   Record<string, unknown>;  // Transform row before returning to caller
    beforeSave?(props):  Partial<Values>;           // Modify values before writing to DB
    afterSave?(props):   void;                      // After the write, still in the transaction
    afterSaveError?(props): void;                   // Side-effects after a failed save
    beforeDelete?(props): boolean | void;           // Return false (403) or throw to block deletion
    afterDelete?(props): void;                      // After the delete, still in the transaction
};
```

<span class="since-badge" data-since="0.22">Desde 0.22</span> `beforeQuery` restringe uma leitura antes que ela seja compilada; consulte
[`beforeQuery`](/docs/collections/callbacks#beforequery).

Todos os callbacks podem retornar uma `Promise` (assíncrono) ou um valor direto (síncrono).

---

## Propriedades dos Callbacks (Callback Props)

Cada callback recebe um único objeto de propriedades. Campos comuns:

| Campo | Tipo | Presente em |
|-------|------|------------|
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
é a única camada registrada independentemente de qualquer uma delas — mas
ainda assim nunca recebe uma coleção inexistente. Uma requisição especificando um caminho que o
registro de coleções não consegue resolver é recusada com `404 NOT_FOUND` antes que qualquer camada seja executada,
que é a mesma resposta que os caminhos de leitura e escrita já fornecem a esse caminho. A
alternativa — ignorar a camada para esses caminhos — tornaria o `afterRead` uma
etapa de mascaramento com uma exceção silenciosa, portanto essa opção não é oferecida.

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
transação que processa a escrita.** Não existe uma camada "dispare e esqueça" (fire and forget): a
linha e tudo o que seus callbacks fizeram são confirmados juntos ou nada é confirmado.

- **`beforeSave`, `beforeDelete`** — se o callback lançar um erro (throw), a operação é rejeitada com um HTTP 400 contendo sua mensagem e o código `CALLBACK_REJECTED`, e a escrita no banco de dados nunca acontece. Lance um `RebaseApiError` de `@rebasepro/types` para definir o status você mesmo — consulte [Entity Callbacks](/docs/collections/callbacks#beforesave). Um `beforeDelete` que *retorna* `false` resulta na mesma recusa sem mensagem, respondendo **403** com esse código.
- **`afterRead`** — a linha retornada (ou a linha transformada) é o que o chamador recebe. Sua transação é `READ ONLY` — consulte [abaixo](#afterread-cannot-write).
- **`afterSave`, `afterDelete`** — são executados *antes* do commit, aguardados (`awaited`). Um erro lançado aqui desfaz a escrita da linha (rollback) e responde com o mesmo **400 `CALLBACK_REJECTED`**, com `details.stage` indicando o hook. Eles mantêm a transação aberta enquanto são executados, portanto, um callback lento significa um lock mantido por mais tempo.
- **`afterSaveError`** — é executado quando o salvamento falha, durante o fluxo de saída.

:::caution[Esta página costumava afirmar o oposto]
Versões anteriores afirmavam que `afterSave` e `afterDelete` "são executados após o commit da
transação" e "não bloqueiam a resposta HTTP". Eles nunca fizeram nenhuma dessas coisas. O código que
foi escrito com base nessa frase — uma chamada de webhook em `afterSave`, por exemplo — tem
mantido uma transação de banco de dados aberta durante a duração de uma viagem de ida e volta (round trip) HTTP,
e desfeito a gravação da linha sempre que o endpoint remoto estava indisponível.
:::

### Efeitos colaterais que não devem prender a transação

Qualquer operação lenta ou que não possa ser desfeita caso a transação sofra rollback
não deve estar no corpo do callback:

| Objetivo | Faça isto em vez disso |
|---|---|
| Chamar serviços de terceiros, enviar e-mails, gerar arquivos | [Enfileire um job](/docs/backend/jobs). Um job enfileirado em uma transação que sofre rollback nunca foi enfileirado — o que é exatamente o comportamento desejado. |
| Notificar outros processos de que algo aconteceu | Publique em um [canal realtime](/docs/backend/realtime) após o retorno da escrita, não dentro do hook. |
| Processar tarefas em uma [função personalizada](/docs/backend/custom-functions) pelas quais o chamador não precisa esperar | `waitUntil(c, promise)` de `@rebasepro/server/functions` — é executado após a resposta, e o host aguarda sua conclusão antes de desligar. |

A regra geral: se o trabalho ainda deve acontecer mesmo quando a escrita for desfeita, ele
não faz parte da escrita, portanto não deve estar no hook.

### `afterRead` não pode realizar escritas

Uma leitura com escopo de requisição abre sua transação como `READ ONLY`. O `afterRead` é executado dentro
dela, portanto **nenhuma escrita originada desse callback pode ter sucesso** — nem uma criação
com `context.data`, nem uma atualização, nem mesmo uma oculta dentro de uma função auxiliar que ele chame. O Postgres recusa a
instrução com o SQLSTATE `25006`, e o chamador recebe a resposta:

```json
{ "error": { "message": "An `afterRead` callback tried to write. …",
             "code": "READ_ONLY_TRANSACTION",
             "details": { "dbCode": "25006" } } }
```

Isso é um 409, não um 500: é o seu código sendo recusado, e não uma falha do servidor.
O modo somente leitura é intencional — uma leitura que realiza escritas silenciosamente é uma leitura cujo
custo, locks e superfície de RLS ninguém planejou.

Portanto, **a auditoria de leitura não deve ser feita em `afterRead`**. Registre a leitura fora da
requisição — a partir de um job em segundo plano alimentado pelo que você já emite, ou
a partir de uma função personalizada que realize a leitura *e* a escrita com duas
chamadas separadas:

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

A auditoria no lado da escrita não tem esse problema: `afterSave` e `afterDelete` são executados em uma
transação de leitura e escrita, e a linha de auditoria é commitada junto com a alteração que registra.

---

## Exemplos

### Mascaramento de PII

Oculte endereços de e-mail para chamadores que não sejam administradores em todas as coleções:

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

### Registro de Auditoria Global

Registre cada exclusão, em todas as coleções, em uma tabela `audit_log`. Como o
`afterDelete` é executado na própria transação da exclusão, a linha de auditoria e a
exclusão são confirmadas juntas — não há brecha na qual uma exista sem
a outra:

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

Observe o que isso garante e o que custa: se a linha de auditoria não puder ser gravada, a
exclusão também não acontece. Para uma trilha de auditoria, isso geralmente é o que se deseja.
Se não for esse o caso, capture o erro no callback e documente isso em um comentário.

### Lógica Específica por Coleção

Callbacks globais são acionados para todas as coleções. Para restringir a lógica a uma única coleção, verifique `collection.slug` ou `path`:

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

Para callbacks que se aplicam apenas a uma única coleção, prefira utilizar [callbacks por coleção](/docs/collections/callbacks).
