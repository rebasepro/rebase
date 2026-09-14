---
sourceHash: 3e8accd144f401d4
title: Substituição de Componentes (Swizzling)
sidebar_label: Substituição de Componentes
description: Substitua componentes padrão de UI por implementações personalizadas no nível da aplicação ou da coleção.
---

## Visão Geral

O Rebase permite que você substitua componentes de UI padrão por suas próprias implementações personalizadas. Isso implementa um modelo de swizzling de componentes no estilo Docusaurus que suporta dois padrões de personalização:
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

Para substituir componentes apenas para uma coleção específica, adicione um objeto `components` à sua definição. Isso é útil para personalizar estados vazios, cards ou visualizações de detalhes para modelos específicos.

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

### Componentes com Escopo de Aplicação (`AppComponentName`)

Estes componentes só podem ser substituídos no nível do provedor raiz `<Rebase>`, pois representam a estrutura no nível do shell.

| Chave do Componente | Descrição |
|---|---|
| `"Shell.AppBar"` | A barra de cabeçalho na parte superior da página |
| `"Shell.Drawer"` | O menu lateral (sidebar) de navegação retrátil principal |
| `"Shell.DrawerNavigationItem"` | Links individuais dentro do menu lateral |
| `"Shell.DrawerNavigationGroup"` | Cabeçalhos de grupos de navegação retráteis no menu lateral |
| `"HomePage"` | A página inicial padrão do modo de conteúdo |
| `"HomePage.CollectionCard"` | Cards individuais de coleção na página inicial |
| `"Auth.LoginView"` | A sobreposição (overlay) exibida ao solicitar autenticação |

### Componentes com Escopo de Coleção (`CollectionComponentName`)

Estes componentes podem ser substituídos globalmente (atuando como padrões para todas as coleções) ou em coleções individuais.

| Chave do Componente | Descrição |
|---|---|
| `"Collection.View"` | A página inteira da coleção |
| `"Collection.Table"` | A visualização tabular de planilha padrão |
| `"Collection.Card"` | O wrapper do item de visualização em card |
| `"Collection.EmptyState"` | Visualização exibida quando uma coleção está vazia |
| `"Collection.Actions"` | Botões da barra de ferramentas acima da tabela/cards |
| `"Collection.FilterField"` | Entrada de filtro personalizada para uma coluna |
| `"Entity.Form"` | O formulário de detalhes para criação/atualização |
| `"EditView.FormActions"` | Barra de botões de envio/cancelamento do formulário |
| `"DetailView"` | Visualização de detalhes somente leitura |
| `"Entity.SidePanel"` | O contêiner do painel lateral para formulário/detalhes |
| `"EntityPreview"` | Pré-visualização do chip de referência/relação inline |
| `"Entity.MissingReference"` | Renderizado quando uma entidade referenciada está ausente |

:::note[Três chaves quebram o padrão `Entity.`]
`"DetailView"`, `"EntityPreview"` e `"EditView.FormActions"` não possuem o prefixo `Entity.`. `"Entity.DetailView"`, `"Entity.Preview"` e `"Entity.FormActions"` não estão na união — eles causam erro de tipo e, em JavaScript puro, a substituição simplesmente nunca é aplicada.
:::

Sua substituição recebe as mesmas props que foram fornecidas ao componente integrado. O mapa de substituição não especifica um tipo de props por chave — `ComponentOverride<P>` define `P` como padrão para `Record<string, unknown>` — portanto, tipifique o parâmetro manualmente ou passe um argumento de tipo quando quiser que as props sejam verificadas. Alguns dos componentes integrados exportam um tipo de props que você pode importar e reutilizar: `CollectionViewProps` (`@rebasepro/ui`); `CollectionEmptyStateProps`, `CollectionActionsProps` e `FilterFieldBindingProps` (`@rebasepro/cms-types`); `EntityFormProps` e `EntityFormActionsProps` (`@rebasepro/cms`). O restante não possui um tipo de props exportado — declare a estrutura que você realmente utiliza.

## Relacionado

- [Estendendo o Rebase](/docs/frontend/extending/) — os pontos de extensão que não precisam de substituição
- [Campos Personalizados](/docs/frontend/custom-fields/) — substituindo o editor de uma propriedade em vez de um componente
- [Slots](/docs/frontend/slots/) — adicionando elementos a um componente em vez de substituí-lo
