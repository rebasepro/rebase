---
title: Substituição de Componentes (Swizzling)
sidebar_label: Substituição de Componentes
description: Substitua os componentes de UI padrão por implementações personalizadas no nível da aplicação ou da coleção.
---

## Visão Geral

A Rebase permite que você substitua os componentes de UI padrão pelas suas próprias implementações personalizadas. Isso implementa um modelo de swizzling de componentes no estilo Docusaurus que suporta dois padrões de personalização:
- **Modo eject** (padrão): Seu componente substitui totalmente o integrado.
- **Modo wrap** (`wrap: true`): Seu componente envolve o original. O componente integrado é passado como a prop `OriginalComponent` para que você possa renderizá-lo dentro do seu layout/lógica personalizada.

As substituições de componentes podem ser aplicadas **globalmente** no nível da aplicação (no provedor `<Rebase>`) ou **localmente** no nível da coleção (dentro das definições de coleções individuais).

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

Para substituir componentes apenas para uma coleção específica, adicione um objeto `components` à sua definição. Isso é útil para personalizar estados vazios, cards ou visões de detalhe para modelos específicos.

```tsx
import { defineCollection } from "@rebasepro/cms-types";
import { ProductCustomForm } from "./components/ProductCustomForm";

const productsCollection = defineCollection({
    name: "Products",
    slug: "products",
    table: "products",
    properties: { /* ... */ },
    admin: {
        components: {
            // Eject Mode: Replace the default entity form view
            "Entity.Form": { Component: ProductCustomForm },

            // Wrap Mode: Wrap the empty state to add quick links
            "Collection.EmptyState": {
                // `OriginalComponent` is injected at runtime when `wrap: true`; the override
                    // slot's type does not model it, hence the annotation.
                    Component: (({ OriginalComponent, ...props }: {
                        OriginalComponent: React.ComponentType<Record<string, unknown>>
                    }) => (
                    <div className="empty-state-wrapper">
                        <OriginalComponent {...props} />
                        <button onClick={() => importDemoProducts()}>
                            Load Demo Products
                        </button>
                    </div>
                )) as unknown as React.ComponentType<Record<string, unknown>>,
                wrap: true
            }
        }
    }
});

```

---

## Escopos de Componentes Substituíveis

### Componentes com Escopo de App (`AppComponentName`)

Esses componentes só podem ser substituídos no nível do provedor raiz `<Rebase>`, pois representam a estrutura no nível do shell.

| Chave do Componente | Descrição |
|---|---|
| `"Shell.AppBar"` | A barra de cabeçalho no topo da página |
| `"Shell.Drawer"` | O drawer de navegação lateral principal recolhível |
| `"Shell.DrawerNavigationItem"` | Links individuais dentro da barra lateral |
| `"Shell.DrawerNavigationGroup"` | Cabeçalhos de grupos de navegação recolhíveis na barra lateral |
| `"HomePage"` | A página inicial padrão no modo de conteúdo |
| `"HomePage.CollectionCard"` | Cards de coleção individuais na página inicial |
| `"Auth.LoginView"` | A sobreposição exibida ao solicitar autenticação |

### Componentes com Escopo de Coleção (`CollectionComponentName`)

Esses componentes podem ser substituídos globalmente (agindo como padrões para todas as coleções) ou em coleções individuais.

| Chave do Componente | Descrição |
|---|---|
| `"Collection.View"` | A página inicial completa da coleção |
| `"Collection.Table"` | A visão tabular tipo planilha padrão |
| `"Collection.Card"` | O invólucro do item da visão em cards |
| `"Collection.EmptyState"` | Visão exibida quando uma coleção está vazia |
| `"Collection.Actions"` | Botões da barra de ferramentas acima da tabela/cards |
| `"Collection.FilterField"` | Campo de filtro personalizado para uma coluna |
| `"Entity.Form"` | O formulário de detalhe para criar/atualizar |
| `"EditView.FormActions"` | Barra de botões de envio/cancelamento do formulário |
| `"DetailView"` | Visão de detalhe somente leitura |
| `"Entity.SidePanel"` | O contêiner do painel lateral para formulário/detalhe |
| `"EntityPreview"` | Pré-visualização inline do chip de referência/relação |
| `"Entity.MissingReference"` | Renderizado quando uma entidade referenciada está ausente |
