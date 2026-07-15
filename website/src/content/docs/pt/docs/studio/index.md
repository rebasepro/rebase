---
title: Ferramentas do Studio
sidebar_label: Studio
description: O Rebase Studio oferece ferramentas para desenvolvedores para edição visual de esquemas, consultas SQL, scripting JavaScript, gerenciamento de políticas RLS e navegação de armazenamento.
---

## Visão Geral

Rebase tem dois modos:

- **Modo Conteúdo** — Para editores de conteúdo e equipes de operações. Mostra coleções e gerenciamento de dados.
- **Modo Studio** — Para desenvolvedores. Desbloqueia ferramentas voltadas para desenvolvedores.

Alterne entre os modos usando o controlador de modo admin ou o seletor da UI na barra do aplicativo.

## Ferramentas do Studio Integradas

### Editor de Coleções

Um editor visual de esquemas que permite criar e modificar coleções através de uma interface de arrastar e soltar. Ao salvar as alterações, ele usa [ts-morph](https://ts-morph.com/) para atualizar seus arquivos-fonte TypeScript via manipulação de AST — preservando todo o código existente e lógica personalizada.

![Editor de coleção](/img/collection_editor.png)

```tsx
import { RebaseAdmin } from "@rebasepro/admin";

// The Collection Editor is automatically enabled when you provide the 
// collectionEditor configuration to your RebaseAdmin component
<RebaseAdmin
    collections={collections}
    collectionEditor={{
        getAuthToken: authController.getAuthToken
    }}
/>
```

### Console SQL

Execute consultas SQL brutas no seu banco de dados PostgreSQL e veja os resultados em uma tabela:

```tsx
import { SQLEditor } from "@rebasepro/studio";

{ slug: "sql", name: "SQL Console", view: <SQLEditor /> }
```

### Console JS

Escreva e execute JavaScript usando o SDK do Rebase:

```tsx
import { JSEditor } from "@rebasepro/studio";

{ slug: "js", name: "JS Console", view: <JSEditor /> }
```

### Editor de Políticas RLS

Visualize e gerencie políticas de Row Level Security (Segurança em Nível de Linha) para suas tabelas PostgreSQL:

```tsx
import { RLSEditor } from "@rebasepro/studio";

{ slug: "rls", name: "RLS Policies", view: <RLSEditor /> }
```

### Navegador de Armazenamento

Navegue, carregue e gerencie arquivos em seus backends de armazenamento:

```tsx
import { StorageView } from "@rebasepro/studio";

{ slug: "storage", name: "Storage", view: <StorageView /> }
```

## Adicionando Vistas do Studio

As ferramentas do Studio ficam automaticamente disponíveis quando você inclui o componente `RebaseStudio` dentro do seu aplicativo:

```tsx
import { RebaseStudio } from "@rebasepro/studio";

export function App() {
    return (
        <Rebase client={client} authController={authController}>
            {/* Custom views are injected and studio mode is managed automatically */}
            <RebaseStudio />
            {/* ... */}
        </Rebase>
    );
}
```

Essas vistas aparecem na navegação da barra lateral quando o modo Studio está ativo.

## Próximos Passos

- **[Plugins](/docs/plugins)** — Estenda o framework com plugins
- **[Coleções](/docs/collections)** — Configuração de coleções

---
