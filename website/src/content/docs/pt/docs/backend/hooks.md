---
sourceHash: 81fb68b88d544514
title: Hooks Globais de Backend
sidebar_label: Hooks Globais
description: "Aplique hooks de ciclo de vida transversais a todas as tabelas no nível do servidor: exporte hooks de backend/hooks.ts, no mesmo formato TableHooks que os hooks da própria tabela usam."
---

## Visão Geral

<span class="since-badge" data-since="0.31">Desde 0.31</span>

O Rebase executa hooks de tabela em dois níveis, ambos do tipo `TableHooks` de
`@rebasepro/server/schema`:

- **[Hooks de tabela](/docs/collections/callbacks)**: a chave `hooks` de um `defineTable`. Eles são executados apenas para essa tabela.
- **Hooks globais**: exportados como `hooks` a partir de `backend/hooks.ts`. Eles são acionados em **todas** as tabelas, em todos os caminhos de dados (API REST, WebSocket / realtime, MCP, `rebase.dataAsAdmin` no lado do servidor). O único gravador que eles não veem é o sistema de autenticação: cadastro (sign-up), login via OAuth e o gerenciamento de usuários pelo admin gravam linhas de usuários diretamente e executam os [auth hooks](/docs/backend/authentication/) (`afterUserCreate`, …) em vez disso.

Use hooks globais para:
- **Escopo de linhas (Row scoping)** — `beforeQuery` em todas as tabelas, para que as leituras de um tenant sejam restritas em um único lugar em vez de por tabela. Consulte [`beforeQuery`](/docs/collections/callbacks#beforequery).
- **Mascaramento de PII** — oculte campos confidenciais para chamadores não administradores em todas as tabelas.
- **Log de auditoria unificado** — registre cada criação, atualização ou exclusão em um só lugar. Novas contas de cadastro e OAuth não estão entre elas; registre essas a partir de `afterUserCreate`.
- **Validação transversal** — aplique invariantes que abrangem múltiplas tabelas.

:::note
**Ordem de execução**: hooks globais → hooks da própria tabela → `.transform()` das suas colunas.
:::

Cada hook recebe o descritor da tabela para a qual está sendo executado como `table`, portanto,
hooks globais precisam de tabelas declaradas: um backend que faz introspecção do banco de dados
(sem `backend/schema`) irá recusá-los na inicialização.

---

## Configuração

:::note[Onde isso fica]
**Runtime gerenciado** — `export const hooks = { … }` a partir de `backend/hooks.ts`. O runtime lê essa exportação na inicialização; nada mais precisa ser alterado. Qualquer outra exportação do arquivo é reportada na inicialização e ignorada.

**Ejetado (Ejected)** — a chave `hooks` em `initializeRebaseBackend({ … })`.

O mapeamento completo está na [Visão Geral do Backend](/docs/backend/#where-each-option-lives).
:::

```typescript
// backend/hooks.ts
import type { TableHooks } from "@rebasepro/server/schema";

export const hooks: TableHooks = {
    afterRead({ values }) {
        // Runs after every row read, across all tables
        return values;
    },
    beforeSave({ values }) {
        // Runs before every save
        return values;
    }
};
```

`hooks` recebe um conjunto. Para manter várias responsabilidades separadas, escreva cada uma
como seu próprio conjunto e passe `composeTableHooks(tenantScope, auditTrail)` de
`@rebasepro/common`: eles se combinam exatamente como as camadas acima. Consulte
[Combinando conjuntos de hooks](/docs/collections/callbacks/#combining-hook-sets).
O mesmo vale para `backend.setTableHooks(slug, hooks)`, que substitui os
hooks que uma tabela declarou: passe `composeTableHooks(declared, yours)` para mantê-los.

---

## Tipo `TableHooks`

```typescript
type TableHooks = {
    beforeQuery?(props): QueryNarrowing | void;     // Conditions to AND into a read before it is compiled
    afterRead?(props):   Record<string, unknown>;  // Transform the row before returning it to the caller
    beforeSave?(props):  Partial<Values>;           // Modify values before writing to DB
    afterSave?(props):   void;                      // After the write, still in the transaction
    afterSaveError?(props): void;                   // Side-effects after a failed save
    beforeDelete?(props): boolean | void;           // Return false (403) or throw to block deletion
    afterDelete?(props): void;                      // After the delete, still in the transaction
};
```

`beforeQuery` restringe uma leitura antes de ser compilada; consulte
[`beforeQuery`](/docs/collections/callbacks#beforequery).

Todos os hooks podem retornar uma `Promise` (assíncrono) ou um valor direto (síncrono).

---

## Props do Hook

Cada hook recebe um único objeto props. Campos comuns:

| Campo | Tipo | Presente em |
|-------|------|------------|
| `table` | `TableDescriptor` | Todos os hooks |
| `path` | `string` | Todos os hooks |
| `values` | `Record<string, unknown>` | Todos exceto `beforeQuery`: a linha lida (`afterRead`), sendo excluída (`beforeDelete`, `afterDelete`), ou os valores gravados (os hooks de salvamento) |
| `id` | `string \| number` | `beforeSave` (opcional), `afterSave`, `afterSaveError` (opcional), `beforeDelete`, `afterDelete` |
| `previousValues` | linha (opcional) | `beforeSave`, `afterSave`, `afterSaveError` |
| `status` | `"new" \| "existing" \| "copy"` | `beforeSave`, `afterSave`, `afterSaveError` |
| `error` | `unknown` | `afterSaveError` |
| `operation`, `query` | tipo de leitura, a query do chamador | `beforeQuery` |
| `context` | `RebaseCallContext` | Todos os hooks |

`context.user` contém o usuário autenticado (`uid`, `roles`, etc.). Uma requisição sem token, quando a API permite a entrada, carrega a identidade anônima `{ uid: "anonymous", roles: ["anon"] }` em vez de `undefined`.

`context.credential` identifica a chave de API com a qual a gravação foi feita: `{ kind, id, name }`, onde `kind` é `"personal"` ou `"service"`. Uma chave pessoal atua como seu proprietário, portanto, `context.user` é o proprietário quer ele tenha salvo manualmente ou um job de CI tenha gravado com sua chave; `context.credential` diferencia os dois casos. Ele é definido na API de dados, no socket realtime e em `/mcp`, e fica ausente para sessões, para a chave de serviço, tarefas em contexto de servidor (`rebase.dataAsAdmin`, crons) e no navegador. Ele nunca carrega o segredo.

`table` está sempre presente. Um hook global é acionado para todas as tabelas, sendo a única
camada registrada independentemente de qualquer uma delas — mas ele ainda assim nunca recebe
uma tabela inexistente. Uma requisição especificando um caminho que o servidor não consegue resolver
é recusada com `404 NOT_FOUND` antes que qualquer camada seja executada, o que é a mesma resposta que
os caminhos de leitura e gravação dariam a tal caminho de qualquer forma. A alternativa — pular a
camada para esses caminhos — tornaria o `afterRead` uma etapa de redação com uma exceção
silenciosa, portanto, não é uma opção.

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
 │ 3. Global hook: beforeSave         ─┐                       │
 │ 4. Table hook: beforeSave          ─┘ awaited               │
 │ 5. Drizzle SQL execution & Postgres RLS evaluation          │
 │ 6. Global hook: afterSave          ─┐                       │
 │ 7. Table hook: afterSave           ─┘ awaited               │
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

## Semântica Bloqueante vs. Assíncrona

**Cada hook na lista abaixo é aguardado com await, e todos eles, exceto
`afterSaveError`, são executados dentro da transação que realiza a gravação.** Não
existe camada de "disparar e esquecer" (fire and forget): a linha e tudo o que seus hooks
fizeram são confirmados (commit) juntos ou não são de forma alguma.

- **`beforeSave`, `beforeDelete`** — se o hook lançar um erro (throw), a operação é rejeitada com um HTTP 400 contendo sua mensagem e o código `CALLBACK_REJECTED`, e a gravação no banco de dados nunca acontece. Lance um `RebaseApiError` de `@rebasepro/types` para definir o status você mesmo — consulte [Hooks de tabela](/docs/collections/callbacks#beforesave). Um `beforeDelete` que *retorna* `false` é a mesma recusa sem mensagem, respondendo **403** com esse código.
- **`afterRead`** — a linha retornada (ou transformada) é o que o chamador recebe, e apenas o chamador: em uma gravação ela molda a resposta, enquanto `afterSave`, `beforeDelete`, `afterDelete` e o histórico recebem a linha como armazenada — um valor mascarado nunca é gravado ou revertido na coluna. Sua transação é `READ ONLY` — consulte [abaixo](#afterread-não-pode-gravar).
- **`afterSave`, `afterDelete`** — executam *antes* do commit, aguardados com await. Um erro lançado aqui reverte (rollback) a linha e responde com o mesmo **400 `CALLBACK_REJECTED`**, com `details.stage` indicando o nome do hook. Eles mantêm a transação aberta enquanto são executados, portanto, um hook lento significa um bloqueio (lock) mantido.
- **`afterSaveError`** — executa quando o salvamento falha, na saída. Em uma requisição, ele executa após o rollback da transação de gravação com falha, com um `context` onde cada chamada é uma transação própria, de modo que um job enfileirado por ele para relatar a falha é mantido. Um erro lançado por ele é registrado em log; o chamador recebe o próprio erro do salvamento.

:::caution[Esta página costumava dizer o oposto]
Versões anteriores diziam que `afterSave` e `afterDelete` "executam após o commit
da transação" e "não bloqueiam a resposta HTTP". Eles nunca fizeram nenhum dos dois.
Código que foi escrito com base nessa frase — uma chamada de webhook em `afterSave`,
por exemplo — esteve mantendo uma transação de banco de dados aberta durante o tempo de
ida e volta (round trip) HTTP, revertendo a linha sempre que o serviço remoto estava fora do ar.
:::

### Quando o `afterSaveError` é executado

Ele relata um salvamento que falhou **no banco de dados ou após ele** — a partir da
instrução INSERT ou UPDATE em diante. Um salvamento recusado antes desse ponto nunca chegou
ao banco de dados, portanto, o hook não é notificado sobre ele.

| Executa | Não executa |
|---|---|
| O banco de dados recusa a instrução: uma violação de chave única ou estrangeira, uma restrição de verificação (check constraint) ou trigger, uma política de segurança em nível de linha (`WRITE_DENIED`) | Uma recusa de `beforeSave` — o hook que recusou é o que sabe |
| `afterRead` ou `afterSave` lança um erro (o chamador recebe `CALLBACK_REJECTED`) | Uma requisição recusada antes do driver: validação (`VALIDATION_*`), um campo que o chamador não pode gravar, uma permissão ausente |
| A entrada do histórico não pode ser registrada | Uma linha que o chamador não pode acessar (`404`), uma marca de tenant (tenant stamp) que não pode ser definida |
| | O commit é recusado após o retorno do salvamento: `TRANSACTION_ABORTED` (uma instrução com falha capturada por um hook), ou uma restrição adiada verificada no `COMMIT` |
| | Uma exclusão — não há equivalente para deleção |

Em uma gravação em lote ou `_batch`, ele é executado para a linha que falhou; as linhas anteriores
são revertidas com o lote e não são relatadas.

### Efeitos colaterais que não devem prender a transação

Qualquer coisa lenta, ou qualquer coisa que não possa ser desfeita se a transação for revertida,
não pertence ao corpo do hook:

| Objetivo | Faça isso em vez disso |
|---|---|
| Chamar um serviço de terceiros, enviar e-mail, gerar um arquivo | [Enfileirar um job](/docs/backend/jobs). Um job enfileirado em uma transação revertida nunca foi enfileirado — o que é o comportamento desejado. |
| Notificar outros processos de que algo aconteceu | Publique em um [canal realtime](/docs/backend/realtime) após a conclusão da gravação, não de dentro do hook. |
| Trabalho em uma [função customizada](/docs/backend/custom-functions) pelo qual o chamador não precisa esperar | `waitUntil(c, promise)` de `@rebasepro/server/functions` — é executado após a resposta, e o host espera por ele antes de desligar. |

A regra geral: se o trabalho ainda deve acontecer quando a gravação for desfeita, ele não
faz parte da gravação, portanto, não deve entrar no hook.

### `afterRead` não pode gravar

Uma leitura com escopo de requisição abre sua transação como `READ ONLY`, assim como a nova
busca (refetch) de uma assinatura realtime. O `afterRead` é executado dentro
dela, portanto **nenhuma gravação a partir desse hook terá sucesso** — nem uma criação com
`context.data`, nem uma atualização, nem algo oculto em um helper chamado por ele. O Postgres recusa a
instrução com o SQLSTATE `25006`, e o chamador recebe como resposta:

```json
{ "error": { "message": "An `afterRead` hook tried to write. …",
             "code": "READ_ONLY_TRANSACTION",
             "details": { "dbCode": "25006" } } }
```

Isso é um 409, não um 500: é o seu código sendo recusado, não uma falha no servidor.
O modo somente leitura é intencional — uma leitura que faz gravações silenciosamente é uma
leitura cujo custo, locks e superfície de RLS ninguém planejou.

Portanto, **a auditoria de leitura não deve ficar no `afterRead`**. Em vez disso, registre a leitura fora
da requisição — a partir de um job em segundo plano alimentado pelo que você já emite, ou
a partir de uma função customizada que faz a leitura *e* a gravação em duas chamadas
separadas:

```typescript no-verify
// ✗ Fails with READ_ONLY_TRANSACTION on every read.
export const hooks: TableHooks = {
    afterRead: async ({ path, values, context }) => {
        await context.data.read_log.create({ path, uid: context.user?.uid });
        return values;
    }
};
```

```typescript
// backend/functions/read-article.ts — served at /api/functions/read-article/:id
// ✓ The read and the audit row are two operations, and only the second writes.
import { defineFunction, getUserId, requireAuth, requireDriver } from "@rebasepro/server/functions";

export default defineFunction((app, { rebase }) => {
    app.get("/:id", requireAuth, async (c) => {
        const article = await requireDriver(c).fetchOne({ path: "articles", id: c.req.param("id") });
        await rebase.dataAsAdmin.read_log.create({ path: "articles", uid: getUserId(c) });
        return c.json(article);
    });
});
```

A auditoria de gravação não tem esse problema: `afterSave` e `afterDelete` são executados em uma
transação de leitura e gravação, e a linha de auditoria é confirmada (commit) junto com a alteração registrada.

---

## Exemplos

### Mascaramento de PII

Oculte endereços de e-mail para chamadores não administradores em todas as tabelas:

```typescript
// backend/hooks.ts
import type { TableHooks } from "@rebasepro/server/schema";

export const hooks: TableHooks = {
    afterRead({ values, context }) {
        const isAdmin = context.user?.roles?.includes("admin");
        if (!isAdmin && values.email) {
            return { ...values, email: "********" };
        }
        return values;
    }
};
```

### Log de Auditoria Global

Registre todas as exclusões, em todas as tabelas, em uma tabela `audit_log`. Como
`afterDelete` é executado na própria transação da exclusão, a linha de auditoria e a
exclusão são confirmadas juntas — não há brecha na qual uma exista sem a
outra:

```typescript no-verify
// backend/hooks.ts
import type { TableHooks } from "@rebasepro/server/schema";

export const hooks: TableHooks = {
    async afterDelete({ table, id, values, context }) {
        if (table.slug === "audit_log") return;   // don't audit the audit
        await context.data.audit_log.create({
            action: "delete",
            table: table.slug,
            entity_id: String(id),
            actor: context.user?.uid ?? "anonymous",
            // The API key, when the delete was made with one.
            via_key: context.credential?.name ?? null,
            snapshot: values
        });
    }
};
```

Observe os prós e contras: se a linha de auditoria não puder ser gravada, a
exclusão também não acontece. Para uma trilha de auditoria, geralmente é isso que se deseja.
Caso contrário, capture o erro dentro do hook e explicite isso em um comentário.

### Lógica Específica por Tabela

Os hooks globais são acionados para todas as tabelas. Para delimitar a lógica a uma única tabela, verifique `table.slug` ou `path`:

```typescript
import type { TableHooks } from "@rebasepro/server/schema";

export const hooks: TableHooks = {
    beforeSave({ table, values }) {
        if (table.slug === "orders") {
            const total = values.total;
            if (typeof total !== "number" || total <= 0) {
                throw new Error("Order total must be positive");
            }
        }
        return values;
    }
};
```

Para hooks que se aplicam apenas a uma única tabela, prefira usar os [hooks da própria tabela](/docs/collections/callbacks).
