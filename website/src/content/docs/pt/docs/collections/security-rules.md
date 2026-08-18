---
title: Regras de Segurança (RLS)
sidebar_label: Regras de Segurança
description: Defina políticas de Segurança em Nível de Linha para suas coleções usando atalhos de conveniência ou expressões SQL brutas.
---

## Visão Geral

As regras de segurança permitem definir políticas de **Segurança em Nível de Linha (RLS)** para suas tabelas PostgreSQL diretamente nas definições de suas coleções. Quando o esquema Drizzle é gerado, o Rebase cria as instruções `CREATE POLICY` correspondentes.

```typescript
import { defineCollection } from "@rebasepro/admin-types";
const postsCollection = defineCollection({
    slug: "posts",
    name: "Posts",
    table: "posts",
    properties: { /* ... */ },
    securityRules: [
        { operation: "select", access: "public" },
        { operations: ["insert", "update", "delete"], ownerField: "authorId" }
    ]
});
```

## Como Funciona

1. Você define `securityRules` em uma coleção
2. `rebase schema generate` cria um esquema Drizzle com RLS habilitado
3. `rebase db push` ou `rebase db migrate` aplica as políticas ao PostgreSQL
4. Cada consulta é filtrada automaticamente pelo contexto do usuário atual

A identidade do usuário autenticado está disponível em SQL via:

| Função | Retorna |
|----------|---------|
| `rebase.uid()` | O ID do usuário atual |
| `rebase.roles()` | IDs de função de aplicativo separados por vírgula |
| `rebase.jwt()` | Declarações JWT completas como JSONB |

Estes são definidos automaticamente por transação pelo backend do Rebase.

## Atalhos de Conveniência

### Acesso Baseado no Proprietário

O padrão mais simples — usuários só podem acessar as linhas que possuem:

```typescript
securityRules: [
    { operation: "all", ownerField: "userId" }
]
```

Isso gera: `USING (user_id = rebase.uid())`

### Acesso Público

Permitir que qualquer pessoa (incluindo usuários não autenticados) leia:

```typescript
securityRules: [
    { operation: "select", access: "public" }
]
```

Isso gera: `USING (true)`

### Acesso Autenticado

Permitir qualquer usuário autenticado:

```typescript
securityRules: [
    { operation: "select", access: "authenticated" }
]
```

### Acesso Baseado em Função

Restringir operações a funções específicas:

```typescript
securityRules: [
    { operation: "all", roles: ["admin"] },
    { operation: "select", roles: ["editor", "viewer"] }
]
```

## Expressões SQL Brutas

Para lógica complexa, use `using` e `withCheck`:

```typescript
securityRules: [
    {
        operation: "select",
        using: "EXISTS (SELECT 1 FROM org_members WHERE org_members.org_id = {org_id} AND org_members.user_id = rebase.uid())"
    }
]
```

- **`using`** — Filtra quais linhas existentes são visíveis (aplica-se a SELECT, UPDATE, DELETE)
- **`withCheck`** — Valida novos valores de linha (aplica-se a INSERT, UPDATE)

As referências de coluna usam a sintaxe `{column_name}`, que é resolvida para a coluna totalmente qualificada da tabela.

## Combinando Atalhos e SQL

Misture atalhos de conveniência com SQL bruto:

```typescript
securityRules: [
    // Administradores podem fazer qualquer coisa
    { operation: "all", roles: ["admin"], using: "true" },
    // Usuários regulares só podem ver suas próprias linhas
    { operation: "select", ownerField: "userId" },
    // Usuários podem inserir, mas apenas para si mesmos
    { operation: "insert", withCheck: "{userId} = rebase.uid()" },
    // Linhas bloqueadas não podem ser atualizadas
    { operation: "update", mode: "restrictive", using: "{is_locked} = false" }
]
```

## Permissivo vs Restritivo

PostgreSQL possui dois modos de política:

- **Permissivo** (padrão) — Múltiplas políticas permissivas são combinadas com **OR**. Se alguma delas passar, o acesso é concedido.
- **Restritivo** — Políticas restritivas são combinadas com **AND**. Todas devem passar.

```typescript
securityRules: [
    // Permissivo: proprietários podem acessar suas linhas
    { operation: "all", ownerField: "userId" },
    // Restritivo: mas linhas bloqueadas não podem ser atualizadas
    { operation: "update", mode: "restrictive", using: "{is_locked} = false", withCheck: "{is_locked} = false" }
]
```

## Operações

| Operação | Equivalente SQL | Descrição |
|-----------|---------------|-------------|
| `"select"` | `SELECT` | Ler linhas |
| `"insert"` | `INSERT` | Criar novas linhas |
| `"update"` | `UPDATE` | Modificar linhas existentes |
| `"delete"` | `DELETE` | Remover linhas |
| `"all"` | Todas as anteriores | Atalho para todas as operações |

Você também pode usar `operations` (plural) para aplicar uma regra a múltiplas operações:

```typescript
{ operations: ["insert", "update", "delete"], ownerField: "authorId" }
```

## Interface Completa de SecurityRule

```typescript
interface SecurityRule {
    name?: string;              // Nome da política legível por humanos
    operation?: SecurityOperation;   // Operação única
    operations?: SecurityOperation[]; // Múltiplas operações
    mode?: "permissive" | "restrictive"; // Padrão: "permissive"
    access?: "public" | "authenticated";
    ownerField?: string;        // Coluna contendo o ID do usuário proprietário
    roles?: string[];           // Funções do aplicativo às quais esta política se aplica
    using?: string;             // Expressão SQL USING bruta
    withCheck?: string;         // Expressão SQL WITH CHECK bruta
}
```

## Exemplos

### Plataforma de Blog

```typescript
securityRules: [
    // Qualquer pessoa pode ler posts publicados
    { operation: "select", using: "{status} = 'published'" },
    // Autores podem ver seus próprios rascunhos
    { operation: "select", ownerField: "authorId" },
    // Autores podem criar e editar seus próprios posts
    { operations: ["insert", "update"], ownerField: "authorId" },
    // Apenas administradores podem deletar
    { operation: "delete", roles: ["admin"] }
]
```

### SaaS Multi-Tenant

```typescript
securityRules: [
    {
        operation: "all",
        using: "EXISTS (SELECT 1 FROM org_members WHERE org_members.org_id = {org_id} AND org_members.user_id = rebase.uid())"
    }
]
```

## Acesso Anônimo (Inserções Públicas)

Uma necessidade comum é permitir que **usuários não autenticados** enviem dados — formulários de contato, inscrições em newsletters, aplicações públicas. O Rebase oferece um padrão limpo para isso.

### Recomendado: `access: "public"` com `withCheck`

```typescript
import type { PostgresCollectionConfig } from "@rebasepro/types";

const contactMessagesCollection: PostgresCollectionConfig = {
    slug: "contact_messages",
    name: "Contact Messages",
    table: "contact_messages",
    securityRules: [
        // Qualquer pessoa pode enviar uma mensagem de contato
        {
            operation: "insert",
            // A raw rule carries `using` (which rows are visible) and `withCheck`
            // (what a write must satisfy); an insert only exercises the latter.
            using: "true",
            withCheck: "true"
        },
        // Apenas administradores podem ler, atualizar ou excluir mensagens
        { operations: ["select", "update", "delete"], roles: ["admin"] }
    ],
    properties: {
        email: { name: "Email", type: "string" }
    }
};
```

O atalho `access: "public"` gera uma política que permite a operação sem exigir autenticação.

### Para Captação de Leads / Inscrições

```typescript
import type { PostgresCollectionConfig } from "@rebasepro/types";

const leadSignupsCollection: PostgresCollectionConfig = {
    slug: "lead_magnet_signups",
    name: "Lead Magnet Signups",
    table: "lead_magnet_signups",
    securityRules: [
        // Permitir inserções anônimas
        { operation: "insert", using: "true", withCheck: "true" },
        // Administradores podem ver todas as inscrições
        { operation: "select", roles: ["admin"] }
    ],
    properties: {
        email: { name: "Email", type: "string" }
    }
};
```

### Como Funcionam as Requisições Anônimas

Quando uma requisição chega sem um token JWT, o backend do Rebase define as variáveis de sessão do PostgreSQL para:

| Variável | Valor |
|----------|-------|
| `app.userId` | `'anonymous'` |
| `app.user_roles` | `''` (vazio) |

Isso significa:

- `rebase.uid()` retorna `'anonymous'`
- `rebase.roles()` retorna uma string vazia
- Políticas `access: "public"` passam porque geram `USING (true)` / `WITH CHECK (true)`
- Políticas `access: "authenticated"` falham porque verificam um ID de usuário real
- Políticas `ownerField` falham porque nenhuma linha terá `userId = 'anonymous'` (a menos que explicitamente definido)

### Avançado: SQL Bruto para Anônimos

Se você precisar de controle mais granular, use SQL bruto:

```typescript
securityRules: [
    {
        operation: "insert",
        withCheck: "rebase.uid() = 'anonymous' OR rebase.uid() IS NOT NULL"
    }
]
```

:::dica
Evite o padrão legado de verificar `string_to_array(rebase.roles(), ',')` para acesso anônimo. O atalho `access: "public"` é mais simples e gera a política correta automaticamente.
:::

## Próximos Passos

- **[Relações](/docs/collections/relations)** — Chaves estrangeiras e junções
- **[Callbacks de Entidade](/docs/collections/callbacks)** — Ganchos de ciclo de vida
- **[Funções Personalizadas](/docs/backend/custom-functions)** — Endpoints de API personalizados
