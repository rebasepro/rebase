---
sourceHash: b16bc057fd9a76c0
title: Substituição de Componentes (Swizzling)
sidebar_label: Substituição de Componentes
description: Substitua componentes de UI padrão por implementações personalizadas no nível da aplicação ou da coleção.
---

## Visão Geral

O Rebase permite que você substitua componentes de UI padrão por suas próprias implementações personalizadas. Isso implementa um modelo de swizzling de componentes no estilo Docusaurus que suporta dois padrões de personalização:
- **Modo Eject** (padrão): Seu componente substitui completamente o componente nativo.
- **Modo Wrap** (`wrap: true`): Seu componente envolve o original. O que ele envolve (geralmente o componente nativo) é passado como a prop `OriginalComponent` para que você possa renderizá-lo dentro do seu layout/lógica personalizada.

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

## Substituições de Componentes no Nível de Coleção

<span class="since-badge" data-since="0.31">Desde 0.31</span>

Para substituir componentes para apenas uma tabela, passe `components` em seu
`customizeTable`. Isso é útil para o estado vazio (empty state), os cards ou o formulário de
uma tabela específica. Cada `Component` é o próprio componente, importado por valor:
o arquivo é executado apenas no navegador.

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

Um componente de wrapping recebe o que ele envolve como `OriginalComponent`: o
componente nativo, a menos que sua aplicação também o substitua (consulte
[Quando ambos os escopos substituem um componente](#quando-ambos-os-escopos-substituem-um-componente)):

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

Um caminho em string ou um thunk lazy `() => import(…)` em `Component` lança um erro
quando o módulo carrega, informando o que deve ser escrito no lugar.

### Quando ambos os escopos substituem um componente

<span class="since-badge" data-since="0.31">Desde 0.31</span>

Os dois escopos se compõem. A substituição no nível da aplicação (`<Rebase components>`) é aplicada primeiro ao componente nativo, e a da tabela (`components` em `customizeTable`) é aplicada ao resultado:

| Nível da aplicação | Nível da coleção | O que renderiza dentro dessa coleção |
|---|---|---|
| qualquer | nenhum | o que renderiza em todos os outros lugares: a substituição no nível da aplicação ou o componente nativo |
| nenhum | wrap | o wrapper da coleção em torno do componente nativo |
| replace ou wrap | wrap | o wrapper da coleção em torno da substituição no nível da aplicação, passado como `OriginalComponent` |
| qualquer | replace | somente o componente da coleção; ele substitui ambos |

Assim, uma coleção pode adicionar algo em torno de um componente que sua aplicação já personaliza sem perder essa personalização. Para descartar a versão do nível da aplicação em uma coleção, substitua (replace) em vez de envolver (wrap).

---

## Escopos de Componentes Substituíveis

### Componentes com Escopo de Aplicação (`AppComponentName`)

Esses componentes só podem ser substituídos no nível do provedor raiz `<Rebase>`, pois representam a estrutura no nível de shell.

| Chave do Componente | Descrição |
|---|---|
| `"Shell.AppBar"` | A barra de cabeçalho no topo da página |
| `"Shell.Drawer"` | A barra lateral retrátil principal de navegação (drawer) |
| `"Shell.DrawerNavigationItem"` | Links individuais dentro da barra lateral |
| `"Shell.DrawerNavigationGroup"` | Cabeçalhos recolhíveis de grupos de navegação na barra lateral |
| `"HomePage"` | A página inicial padrão no modo de conteúdo |
| `"HomePage.CollectionCard"` | Cards individuais de coleção na página inicial |
| `"Auth.LoginView"` | O overlay exibido ao solicitar autenticação |

### Componentes com Escopo de Coleção (`CollectionComponentName`)

Esses componentes podem ser substituídos globalmente (atuando como padrões para todas as coleções) ou em coleções individuais.

| Chave do Componente | Descrição |
|---|---|
| `"Collection.View"` | A página de destino inteira da coleção |
| `"Collection.Table"` | A visualização tabular padrão estilo planilha |
| `"Collection.Card"` | O wrapper do item de visualização em card |
| `"Collection.EmptyState"` | Visualização exibida quando uma coleção está vazia |
| `"Collection.Actions"` | Botões da barra de ferramentas acima da tabela/cards |
| `"Collection.FilterField"` | Input de filtro personalizado para uma coluna |
| `"Entity.Form"` | O formulário de detalhes para criação/atualização |
| `"EditView.FormActions"` | Barra de botões de envio/cancelamento do formulário |
| `"DetailView"` | Visualização de detalhes somente leitura |
| `"Entity.SidePanel"` | O contêiner de painel lateral para formulário/detalhes |
| `"EntityPreview"` | Pré-visualização inline em chip de referência/relação |
| `"Entity.MissingReference"` | Renderizado quando uma entidade referenciada está ausente |

:::note[Três chaves fogem do padrão `Entity.`]
`"DetailView"`, `"EntityPreview"` e `"EditView.FormActions"` não possuem o prefixo
`Entity.`. `"Entity.DetailView"`, `"Entity.Preview"` e `"Entity.FormActions"` não
estão na union — geram erro de tipo no TypeScript e, em JavaScript puro, a substituição
simplesmente nunca é aplicada.
:::

A sua substituição recebe as mesmas props fornecidas ao componente nativo. O
mapa de substituição não especifica um tipo de props por chave — `ComponentOverride<P>` define
`P` como `Record<string, unknown>` por padrão —, portanto, tipifique o parâmetro você mesmo,
ou passe um argumento de tipo, quando desejar a verificação de tipos nas props. Alguns dos
componentes nativos exportam um tipo de props que você pode importar e reutilizar:
`CollectionViewProps` (`@rebasepro/ui`); `CollectionEmptyStateProps`, `CollectionActionsProps`,
`SidePanelBindingProps` e `FilterFieldBindingProps` (`@rebasepro/cms-types`); `EntityFormProps`,
`EntityFormBindingProps`, `EntityFormActionsProps`, `CollectionTableBindingProps`,
`DetailViewBindingProps`, `DrawerNavigationItemProps` e
`DrawerNavigationGroupProps` (`@rebasepro/cms`); `LoginViewProps`
(`@rebasepro/app`). Os demais não têm tipo de props exportado — declare a estrutura
que você de fato lê.

### O que uma substituição de `Collection.View` deve respeitar

`Collection.View` é o que um `CollectionPanel` renderiza, portanto, as props do painel chegam
à sua substituição como `CollectionViewBindingProps` (`@rebasepro/cms`), combinadas com as
da própria coleção. Uma substituição que as ignore quebra todas as páginas que incorporam
a coleção. Respeite pelo menos estas:

| Prop | O que o chamador espera |
|---|---|
| `collectionOverrides` | O que o chamador altera sobre a coleção (um filtro fixo, uma ordenação, o modo de visualização), aplicado sobre a coleção registrada |
| `fields` | Apenas estas propriedades, nesta ordem: as colunas e com o que as linhas da lista e cards são preenchidos |
| `highlightedIds` | Os IDs das linhas renderizadas como selecionadas; `[]` para nenhum |
| `onRowClick` | Chamado com a linha clicada, conforme enviada pelo servidor, e seu ID, em vez de abri-la. O próprio `onRowClick` do painel |

O painel também passa `viewMode` (o modo no qual abrir), `toolbar` (a barra de ferramentas
a renderizar, `null` para nenhuma) e `title` (`false` para não renderizar título), quando
definidos pelo chamador. O `CollectionViewBinding` nativo lida com todos eles; uma
substituição que o envolva (wrap) em vez de substituí-lo pode simplesmente repassá-los diretamente.

Para começar a partir da parte nativa em vez do zero, copie seu código-fonte para
o seu projeto e registre a cópia aqui: todas as partes, exceto `Collection.View`,
`DetailView` e o recurso de arrastar e soltar da página inicial, compilam com as importações do pacote.
Consulte [Copiando uma parte nativa](/docs/frontend/customizing#copying-a-built-in-part).

## Relacionados

- [Estendendo o Rebase](/docs/frontend/extending/) — os pontos de extensão que não necessitam de substituição
- [Campos Personalizados](/docs/frontend/custom-fields/) — substituindo o editor de uma única propriedade em vez de um componente
- [Slots](/docs/frontend/slots/) — adicionando elementos a um componente em vez de substituí-lo
