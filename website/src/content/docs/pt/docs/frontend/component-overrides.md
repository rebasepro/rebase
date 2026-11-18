---
sourceHash: bad5fe6e295033b6
title: Substituições de Componentes (Swizzling)
sidebar_label: Substituições de Componentes
description: Substitua componentes de interface padrão por implementações personalizadas no nível da aplicação ou da coleção.
---

## Visão Geral

O Rebase permite que você substitua componentes de UI padrão por suas próprias implementações personalizadas. Isso implementa um modelo de swizzling de componentes no estilo Docusaurus que suporta dois padrões de personalização:
- **Modo Eject** (padrão): Seu componente substitui completamente o componente integrado.
- **Modo Wrap** (`wrap: true`): Seu componente envolve o original. O que ele envolve (geralmente o componente integrado) é passado como a prop `OriginalComponent` para que você possa renderizá-lo dentro do seu layout/lógica personalizada.

Para alterar apenas a *aparência* do admin — cores, fontes, cantos, logotipo — você não precisa de uma substituição: consulte [Theming & Branding](/docs/frontend/theming).

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

Para substituir componentes de apenas uma tabela, passe `components` em seu `customizeTable`. Isso é útil para o estado vazio (empty state), os cards ou o formulário de uma tabela específica. Cada `Component` é o próprio componente, importado por valor: o arquivo é executado apenas no navegador.

```tsx
// frontend/src/cms/products.tsx
import { customizeTable } from "@rebasepro/cms";
import type { products } from "../../../backend/schema/products";
import { ProductCustomForm } from "../../../../../components/ProductCustomForm";
import { ProductsEmptyState } from "../../../../../components/ProductsEmptyState";

export const productsCms = customizeTable<typeof products>("products", {
    components: {
        // Replace: the product form is drawn by your component alone.
        "Entity.Form": { Component: ProductCustomForm },
        // Wrap: your component receives the original as `OriginalComponent`.
        "Collection.EmptyState": { Component: ProductsEmptyState, wrap: true },
    },
});
```

Um componente wrapper recebe o que ele envolve como `OriginalComponent`: o componente integrado, a menos que sua aplicação também o substitua (consulte [Quando ambos os escopos substituem um componente](#quando-ambos-os-escopos-substituem-um-componente)):

```tsx
// frontend/src/components/ProductsEmptyState.tsx
import React from "react";

export function ProductsEmptyState({ OriginalComponent, ...props }: {
    OriginalComponent: React.ComponentType<Record<string, unknown>>
}) {
    return (
        <div className="empty-state-wrapper">
            <OriginalComponent {...props} />
            <a href="/docs/import">Import your first products</a>
        </div>
    );
}
```

Um caminho de string ou um thunk lazy `() => import(…)` em `Component` lança um erro quando o módulo é carregado, informando o que escrever em vez disso.

### Quando ambos os escopos substituem um componente

Os dois escopos se compõem. A substituição no nível da aplicação (`<Rebase components>`) é aplicada primeiro ao componente integrado, e a da tabela (`components` em `customizeTable`) é aplicada ao resultado:

| Nível da aplicação | Nível da coleção | O que é renderizado dentro dessa coleção |
|---|---|---|
| qualquer | nenhum | o que é renderizado em qualquer outro lugar: a substituição no nível da aplicação ou o componente integrado |
| nenhum | wrap | o wrapper da coleção em torno do componente integrado |
| replace ou wrap | wrap | o wrapper da coleção em torno da substituição no nível da aplicação, passado como `OriginalComponent` |
| qualquer | replace | somente o componente da coleção; ele substitui ambos |

Dessa forma, uma coleção pode adicionar algo ao redor de um componente que sua aplicação já personaliza sem perder essa personalização. Para descartar a versão no nível da aplicação para uma coleção, substitua em vez de envolver.

---

## Escopos de Componentes Substituíveis

### Componentes com Escopo de Aplicação (`AppComponentName`)

Esses componentes só podem ser substituídos no nível do provedor raiz `<Rebase>`, pois representam a estrutura no nível do shell.

| Chave do Componente | Descrição |
|---|---|
| `"Shell.AppBar"` | A barra de cabeçalho na parte superior da página |
| `"Shell.Drawer"` | O menu lateral principal retrátil de navegação |
| `"Shell.DrawerNavigationItem"` | Links individuais dentro da barra lateral |
| `"Shell.DrawerNavigationGroup"` | Cabeçalhos de grupos de navegação retráteis na barra lateral |
| `"HomePage"` | A página inicial padrão no modo de conteúdo |
| `"HomePage.CollectionCard"` | Cards individuais de coleção na página inicial |
| `"Auth.LoginView"` | A sobreposição exibida ao solicitar autenticação |

### Componentes com Escopo de Coleção (`CollectionComponentName`)

Esses componentes podem ser substituídos globalmente (atuando como padrões para todas as coleções) ou em coleções individuais.

| Chave do Componente | Descrição |
|---|---|
| `"Collection.View"` | A página inicial completa da coleção |
| `"Collection.Table"` | A visualização tabular padrão em formato de planilha |
| `"Collection.Card"` | O wrapper de item na visualização em cards |
| `"Collection.EmptyState"` | Visualização exibida quando uma coleção está vazia |
| `"Collection.Actions"` | Botões da barra de ferramentas acima da tabela/cards |
| `"Collection.FilterField"` | Campo de entrada de filtro personalizado para uma coluna |
| `"Entity.Form"` | O formulário de detalhes para criação/atualização |
| `"EditView.FormActions"` | Barra de botões para envio/cancelamento de formulário |
| `"DetailView"` | Visualização de detalhes somente leitura |
| `"Entity.SidePanel"` | O contêiner do painel lateral para formulário/detalhes |
| `"EntityPreview"` | Pré-visualização inline em chip de referência/relação |
| `"Entity.MissingReference"` | Renderizado quando uma entidade referenciada está ausente |

:::note[Três chaves não seguem o padrão `Entity.`]
`"DetailView"`, `"EntityPreview"` e `"EditView.FormActions"` não possuem o prefixo `Entity.`. `"Entity.DetailView"`, `"Entity.Preview"` e `"Entity.FormActions"` não fazem parte da união — eles causam erros de tipo e, em JavaScript puro, a substituição simplesmente nunca é aplicada.
:::

Seu substituto recebe as mesmas props que o componente integrado recebeu. O mapa de substituição não nomeia um tipo de props por chave — `ComponentOverride<P>` define `P` por padrão como `Record<string, unknown>` — portanto, tipifique o parâmetro você mesmo ou passe um argumento de tipo quando quiser que as props sejam validadas. Alguns dos componentes integrados exportam um tipo de props que você pode importar e reutilizar: `CollectionViewProps` (`@rebasepro/ui`); `CollectionEmptyStateProps`, `CollectionActionsProps`, `SidePanelBindingProps` e `FilterFieldBindingProps` (`@rebasepro/cms-types`); `EntityFormProps`, `EntityFormBindingProps`, `EntityFormActionsProps`, `CollectionTableBindingProps`, `DetailViewBindingProps`, `DrawerNavigationItemProps` e `DrawerNavigationGroupProps` (`@rebasepro/cms`); `LoginViewProps` (`@rebasepro/app`). Os demais não possuem tipos de props exportados — defina o formato que você de fato lê.

### O que uma substituição de `Collection.View` deve respeitar

O `Collection.View` é o que um `CollectionPanel` renderiza, de modo que as props do painel chegam à sua substituição como `CollectionViewBindingProps` (`@rebasepro/cms`), distribuídas sobre as da própria coleção. Uma substituição que as ignore quebra todas as páginas que incorporam a coleção. Respeite pelo menos estas:

| Prop | O que o chamador espera |
|---|---|
| `collectionOverrides` | O que o chamador altera na coleção (um filtro fixo, uma ordenação, o modo de visualização), aplicado sobre a coleção registrada |
| `fields` | Apenas estas propriedades, nesta ordem: as colunas e os dados com os quais as linhas da lista e os cards são preenchidos |
| `highlightedIds` | Os IDs das linhas exibidas como selecionadas; `[]` para nenhuma |
| `onRowClick` | Chamado com a linha clicada, conforme enviada pelo servidor, e seu ID, em vez de abri-la. O próprio `onRowClick` do painel |

O painel também passa `viewMode` (o modo em que deve abrir), `toolbar` (a barra de ferramentas a ser exibida, `null` para nenhuma) e `title` (`false` para não exibir título), onde o chamador os definiu. O `CollectionViewBinding` integrado lida com todos eles; uma substituição que o envolva em vez de substituí-lo pode simplesmente repassá-los diretamente.

Para começar a partir da parte integrada em vez de começar do zero, copie o código-fonte dela para o seu projeto e registre a cópia aqui: todas as partes, com exceção de `Collection.View`, `DetailView` e o recurso de arrastar e soltar (drag-and-drop) da página inicial, compilam com importações de pacotes. Consulte [Copying a built-in part](/docs/frontend/customizing#copying-a-built-in-part).

## Relacionados

- [Theming & Branding](/docs/frontend/theming/) — reestilizando o admin com tokens em vez de componentes
- [Extending Rebase](/docs/frontend/extending/) — os pontos de extensão que não necessitam de substituição
- [Custom Fields](/docs/frontend/custom-fields/) — substituindo o editor de uma propriedade em vez de um componente
- [Slots](/docs/frontend/slots/) — adicionando a um componente em vez de substituí-lo
