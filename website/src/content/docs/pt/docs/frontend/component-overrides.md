---
sourceHash: 78c7b0d8c3e6c984
title: Substituições de Componentes (Swizzling)
sidebar_label: Substituições de Componentes
description: Substitua componentes de interface padrão por implementações personalizadas no nível da aplicação ou da coleção.
---

## Visão Geral

O Rebase permite que você substitua componentes de interface de usuário (UI) padrão por suas próprias implementações personalizadas. Isso implementa um modelo de swizzling de componentes no estilo Docusaurus que suporta dois padrões de personalização:
- **Modo Eject** (padrão): Seu componente substitui totalmente o componente integrado.
- **Modo Wrap** (`wrap: true`): Seu componente envolve o original. O componente integrado é passado como a prop `OriginalComponent` para que você possa renderizá-lo dentro do seu layout/lógica personalizada.

As substituições de componentes podem ser aplicadas **globalmente** no nível da aplicação (no provedor `<Rebase>`) ou **localmente** no nível da coleção (dentro das definições individuais de coleção).

---

## Substituições Globais de Componentes

Para substituir componentes globalmente em toda a sua aplicação, passe um objeto `components` para o provedor raiz `<Rebase>`.

```tsx
import { Rebase } from "@rebasepro/app";
import { MyAppBar } from "./components/MyAppBar";

function App() {
    return (
        <Rebase
            client={rebaseClient}
            components={{
                // Eject Mode: Replace the default AppBar entirely
                "Shell.AppBar": { Component: MyAppBar },

                // Wrap Mode: Wrap the login view to insert branding
                "Auth.LoginView": {
                    // `OriginalComponent` is injected at runtime when `wrap: true`; the override
                    // slot's type does not model it, hence the annotation.
                    Component: (({ OriginalComponent, ...props }: {
                        OriginalComponent: React.ComponentType<Record<string, unknown>>
                    }) => (
                        <div className="login-branding-container">
                            <header className="branding-header">My Custom Brand</header>
                            <OriginalComponent {...props} />
                        </div>
                    )) as unknown as React.ComponentType<Record<string, unknown>>,
                    wrap: true
                }
            }}
        >
            {/* your app */}
            …
        </Rebase>
    );
}
```

---

## Substituições de Componentes no Nível da Coleção

Para substituir componentes apenas para uma coleção específica, adicione um objeto `components` sob o bloco `admin` dela. Isso é útil para personalizar estados vazios, cards ou visualizações de detalhes para modelos específicos.

No scaffold padrão, `config/collections/` é carregado **tanto** pelo painel de administração quanto pelo backend, que lê os mesmos arquivos para derivar o schema e a API. Portanto, aponte para cada componente pelo **caminho do módulo** em vez de importá-lo. `Component` aceita as mesmas formas que `admin.Field` e `entityViews[].Builder`: um caminho, um `import()` dinâmico/lazy ou o próprio componente.

```ts
// config/collections/products.ts
import { defineCollection } from "@rebasepro/cms-types";

export const productsCollection = defineCollection({
    name: "Products",
    slug: "products",
    table: "products",
    properties: { /* ... */ },
    admin: {
        components: {
            // Eject Mode: Replace the default entity form view
            "Entity.Form": { Component: "../../frontend/src/ProductCustomForm" },

            // Wrap Mode: Wrap the empty state to add quick links
            "Collection.EmptyState": {
                Component: "../../frontend/src/ProductsEmptyState",
                wrap: true
            }
        }
    }
});
```

O componente que envolve o original reside junto ao restante do seu código frontend e recebe o componente integrado como `OriginalComponent`:

```tsx
// frontend/src/ProductsEmptyState.tsx
import type React from "react";

export default function ProductsEmptyState({ OriginalComponent, ...props }: {
    OriginalComponent: React.ComponentType<Record<string, unknown>>
}) {
    return (
        <div className="empty-state-wrapper">
            <OriginalComponent {...props} />
            <button onClick={() => importDemoProducts()}>
                Load Demo Products
            </button>
        </div>
    );
}
```

Cada módulo precisa de um **export padrão** (default export). O plugin Vite para coleções reescreve um caminho em um lazy import, de modo que o componente seja seu próprio chunk e carregue na primeira vez que a substituição for renderizada. Essa reescrita cobre os arquivos dentro do `collectionsDir` configurado. Um caminho em um arquivo fora dele chega ao admin como uma string simples: o console emitirá um aviso e o componente integrado será renderizado em seu lugar. Fora do `collectionsDir`, escreva você mesmo o lazy import: `Component: () => import("../../frontend/src/ProductCustomForm")`.

Uma referência direta (`Component: ProductCustomForm`) também funciona, mas apenas em um arquivo de coleção que nada no servidor carregue, pois importar o componente também importa o React e tudo o que ele traz consigo.

---

## Escopos de Componentes Substituíveis

### Componentes com Escopo de Aplicação (`AppComponentName`)

Estes componentes só podem ser substituídos no nível do provedor raiz `<Rebase>`, pois representam a estrutura do shell.

| Chave do Componente | Descrição |
|---|---|
| `"Shell.AppBar"` | A barra de cabeçalho no topo da página |
| `"Shell.Drawer"` | O menu lateral (sidebar) principal colapsável de navegação |
| `"Shell.DrawerNavigationItem"` | Links individuais dentro da barra lateral |
| `"Shell.DrawerNavigationGroup"` | Cabeçalhos colapsáveis de grupos de navegação na barra lateral |
| `"HomePage"` | A página inicial padrão do modo de conteúdo |
| `"HomePage.CollectionCard"` | Cards de coleções individuais na página inicial |
| `"Auth.LoginView"` | A sobreposição exibida ao solicitar autenticação |

### Componentes com Escopo de Coleção (`CollectionComponentName`)

Estes componentes podem ser substituídos globalmente (agindo como padrões para todas as coleções) ou em coleções individuais.

| Chave do Componente | Descrição |
|---|---|
| `"Collection.View"` | Toda a página inicial da coleção |
| `"Collection.Table"` | A visualização tabular padrão em formato de planilha |
| `"Collection.Card"` | O wrapper do item na visualização em cards |
| `"Collection.EmptyState"` | Visualização exibida quando uma coleção está vazia |
| `"Collection.Actions"` | Botões da barra de ferramentas acima da tabela/cards |
| `"Collection.FilterField"` | Entrada de filtro personalizada para uma coluna |
| `"Entity.Form"` | O formulário detalhado para criação/atualização |
| `"EditView.FormActions"` | Barra de botões de envio/cancelamento do formulário |
| `"DetailView"` | Visualização de detalhes somente leitura |
| `"Entity.SidePanel"` | O contêiner do painel lateral para formulário/detalhes |
| `"EntityPreview"` | Pré-visualização inline de chip de referência/relação |
| `"Entity.MissingReference"` | Renderizado quando uma entidade referenciada está ausente |

:::note[Três chaves fogem do padrão `Entity.`]
`"DetailView"`, `"EntityPreview"` e `"EditView.FormActions"` não possuem o prefixo
`Entity.`. `"Entity.DetailView"`, `"Entity.Preview"` e `"Entity.FormActions"` não
estão na união de tipos — elas geram erros de tipo e, em JavaScript puro, a substituição
simplesmente nunca se aplica.
:::

O seu componente de substituição recebe as mesmas props que foram fornecidas ao componente integrado. O
mapa de substituição não nomeia um tipo de props por chave — `ComponentOverride<P>` define
`P` como padrão para `Record<string, unknown>` — portanto, tipifique o parâmetro você mesmo, ou passe um argumento
de tipo, quando desejar a verificação de tipos das props. Alguns dos componentes integrados exportam um
tipo de props que você pode importar e reutilizar: `CollectionViewProps` (`@rebasepro/ui`);
`CollectionEmptyStateProps`, `CollectionActionsProps` e
`FilterFieldBindingProps` (`@rebasepro/cms-types`); `EntityFormProps` e
`EntityFormActionsProps` (`@rebasepro/cms`). O restante não possui um tipo de props exportado —
escreva a estrutura que você realmente lê.

## Relacionados

- [Estendendo o Rebase](/docs/frontend/extending/) — os pontos de extensão que não precisam de substituição
- [Campos Personalizados](/docs/frontend/custom-fields/) — substituindo o editor de uma propriedade em vez de um componente
- [Slots](/docs/frontend/slots/) — adicionando conteúdo a um componente em vez de substituí-lo
