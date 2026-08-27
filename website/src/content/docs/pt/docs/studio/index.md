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
import { RebaseCMS } from "@rebasepro/cms";

// The Collection Editor is automatically enabled when you provide the 
// collectionEditor configuration to your RebaseCMS component
<RebaseCMS
    collections={collections}
    collectionEditor={{
        getAuthToken: authController.getAuthToken
    }}
/>
```

### Ferramentas incorporadas

Vêm com o Studio e são **carregadas de forma diferida pelo `RebaseStudio`** — cada uma é um chunk separado, obtido na primeira vez que a abres. Não são importáveis isoladamente: o `@rebasepro/studio` exporta deliberadamente apenas o orquestrador, por isso uma consola que nunca abres não custa nada.

| Separador | Slug | O que faz |
|-----------|------|-----------|
| Consola SQL | `sql` | Executar SQL direto na base de dados PostgreSQL e ler os resultados numa tabela |
| Consola JS | `js` | Escrever e executar JavaScript através do SDK do Rebase |
| Editor de políticas RLS | `rls` | Inspecionar e gerir as políticas de Row Level Security das tabelas |
| Navegador de armazenamento | `storage` | Navegar, carregar e gerir ficheiros nos backends de armazenamento |


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
