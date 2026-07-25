---
title: Regras de Segurança (RLS)
sidebar_label: Regras de Segurança
description: Defina políticas de Segurança em Nível de Linha para suas coleções usando atalhos de conveniência ou expressões SQL brutas.
---

## Visão Geral

As regras de segurança permitem definir políticas de **Segurança em Nível de Linha (RLS)** para suas tabelas PostgreSQL diretamente nas definições de suas coleções. Quando o esquema Drizzle é gerado, o Rebase cria as instruções `CREATE POLICY` correspondentes.

```typescript
const postsCollection: CollectionConfig = {
    slug: "posts",
    table: "posts",
    properties: { /* ... */ },
    securityRules: [
        { operation: "select", access: "public" },
        { operations: ["insert", "update", "delete"], ownerField: "author_id" }
    ]
};
```

## Como Funciona

1. Você define `securityRules` em uma coleção
2. `rebase schema generate` cria um esquema Drizzle com RLS habilitado
3. `rebase db push` ou `rebase db migrate` aplica as políticas ao PostgreSQL
4. Cada consulta é filtrada automaticamente pelo contexto do usuário atual

A identidade do usuário autenticado está disponível em SQL via:

| Função | Retorna |
|----------|---------|
| `auth.uid()` | O ID do usuário atual |
| `auth.roles()` | IDs de função de aplicativo separados por vírgula |
| `auth.jwt()` | Declarações JWT completas como JSONB |

Estes são definidos automaticamente por transação pelo backend do Rebase.

## Atalhos de Conveniência

### Acesso Baseado no Proprietário

O padrão mais simples — usuários só podem acessar as linhas que possuem:

```typescript
securityRules: [
    { operation: "all", ownerField: "user_id" }
]
```

Isso gera: `USING (user_id = auth.uid())`

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
        using: "EXISTS (SELECT 1 FROM org_members WHERE org_members.org_id = {org_id} AND org_members.user_id = auth.uid())"
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
    { operation: "select", ownerField: "user_id" },
    // Usuários podem inserir, mas apenas para si mesmos
    { operation: "insert", withCheck: "{user_id} = auth.uid()" },
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
    { operation: "all", ownerField: "user_id" },
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
{ operations: ["insert", "update", "delete"], ownerField: "author_id" }
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
    { operation: "select", ownerField: "author_id" },
    // Autores podem criar e editar seus próprios posts
    { operations: ["insert", "update"], ownerField: "author_id" },
    // Apenas administradores podem deletar
    { operation: "delete", roles: ["admin"] }
]
```

### SaaS Multi-Tenant

```typescript
securityRules: [
    {
        operation: "all",
        using: "EXISTS (SELECT 1 FROM org_members WHERE org_members.org_id = {org_id} AND org_members.user_id = auth.uid())"
    }
]
```

## Acesso Anônimo (Inserções Públicas)

Uma necessidade comum é permitir que **usuários não autenticados** enviem dados — formulários de contato, inscrições em newsletters, aplicações públicas. O Rebase oferece um padrão limpo para isso.

### Recomendado: `access: "public"` com `withCheck`

```typescript
const contactMessagesCollection: CollectionConfig = {
    slug: "contact_messages",
    securityRules: [
        // Qualquer pessoa pode enviar uma mensagem de contato
        {
            operation: "insert",
            access: "public",
            withCheck: "true"
        },
        // Apenas administradores podem ler, atualizar ou excluir mensagens
        { operations: ["select", "update", "delete"], roles: ["admin"] }
    ],
    properties: { /* ... */ }
};
```

O atalho `access: "public"` gera uma política que permite a operação sem exigir autenticação.

### Para Captação de Leads / Inscrições

```typescript
const leadSignupsCollection: CollectionConfig = {
    slug: "lead_magnet_signups",
    securityRules: [
        // Permitir inserções anônimas
        { operation: "insert", access: "public", withCheck: "true" },
        // Administradores podem ver todas as inscrições
        { operation: "select", roles: ["admin"] }
    ],
    properties: { /* ... */ }
};
```

### Como Funcionam as Requisições Anônimas

Quando uma requisição chega sem um token JWT, o backend do Rebase define as variáveis de sessão do PostgreSQL para:

| Variável | Valor |
|----------|-------|
| `app.user_id` | `'anonymous'` |
| `app.user_roles` | `''` (vazio) |

Isso significa:

- `auth.uid()` retorna `'anonymous'`
- `auth.roles()` retorna uma string vazia
- Políticas `access: "public"` passam porque geram `USING (true)` / `WITH CHECK (true)`
- Políticas `access: "authenticated"` falham porque verificam um ID de usuário real
- Políticas `ownerField` falham porque nenhuma linha terá `user_id = 'anonymous'` (a menos que explicitamente definido)

### Avançado: SQL Bruto para Anônimos

Se você precisar de controle mais granular, use SQL bruto:

```typescript
securityRules: [
    {
        operation: "insert",
        withCheck: "auth.uid() = 'anonymous' OR auth.uid() IS NOT NULL"
    }
]
```

:::dica
Evite o padrão legado de verificar `string_to_array(auth.roles(), ',')` para acesso anônimo. O atalho `access: "public"` é mais simples e gera a política correta automaticamente.
:::

## Próximos Passos

- **[Relações](/docs/collections/relations)** — Chaves estrangeiras e junções
- **[Callbacks de Entidade](/docs/collections/callbacks)** — Ganchos de ciclo de vida
- **[Funções Personalizadas](/docs/backend/custom-functions)** — Endpoints de API personalizados
