---
sourceHash: d337d344b88534c8
title: Campos Personalizados
sidebar_label: Campos Personalizados
description: Crie campos de formulário personalizados para edição de entidades com acesso total ao contexto do formulário, valores da entidade e hooks do Rebase.
---

<video className="intro_video" loop autoPlay muted>
    <source src="/img/custom_fields_dark.mp4" type="video/mp4"/>
</video>

## Visão Geral

<span class="since-badge" data-since="0.31">Desde 0.31</span>

O CMS renderiza um campo para cada coluna a partir de seu tipo (veja
[Campos](/docs/collections/properties/)). Quando não for isso que você deseja, atribua
ao campo um componente próprio em `customizeTable`: `Field` substitui o
controle no formulário, `Preview` substitui como o valor é renderizado em qualquer outro lugar
(uma célula de tabela, um card, um chip de referência), e `Filter` substitui seu
controle de filtro.

Um componente é um valor. O `customizeTable` é executado apenas no bundle do navegador, portanto você
importa o componente como faria em qualquer outro lugar no seu frontend e passa ele
diretamente. Um caminho em string ou um thunk lazy `() => import(…)` gerará um erro, informando
o que escrever em seu lugar.

## Criando um Campo Personalizado

<span class="since-badge" data-since="0.31">Desde 0.31</span>

Um campo personalizado é um componente React que recebe `FieldProps`:

```tsx
// frontend/src/fields/ColorPickerField.tsx
import React from "react";
import type { FieldProps } from "@rebasepro/cms";
import type { StringProperty } from "@rebasepro/cms-types";

export function ColorPickerField({ value, setValue, error, showError, minimalistView }: FieldProps<StringProperty>) {
    return (
        <div>
            <input
                type="color"
                value={value ?? "#000000"}
                onChange={(e) => setValue(e.target.value)}
            />
            {!minimalistView && <span>{value}</span>}
            {showError && error && <span className="text-red-500">{error}</span>}
        </div>
    );
}
```

### FieldProps

<span class="since-badge" data-since="0.31">Desde 0.31</span>

| Prop | Tipo | Descrição |
|------|------|-------------|
| `value` | `T` | Valor atual do campo |
| `setValue` | `(value: T) => void` | Atualiza o valor do campo |
| `error` | `string` | Mensagem de erro de validação |
| `showError` | `boolean` | Se o erro deve ser exibido |
| `isSubmitting` | `boolean` | O formulário está sendo salvo |
| `property` | `Property` | O campo como o CMS o resolveu: rótulo, validação, opções |
| `context` | `FormContext` | O formulário: seus `values` (incluindo edições não salvas), `setFieldValue`, `id` e `row`, o registro salvo como o servidor o envia (ausente para um novo registro) |
| `disabled` | `boolean` | O campo é somente leitura |
| `minimalistView` | `boolean` | Renderização no editor de célula popup da tabela (modo compacto) |
| `customProps` | `unknown` | As `customProps` do campo vindas de `customizeTable`, intocadas |

## Como Usar

<span class="since-badge" data-since="0.31">Desde 0.31</span>

```tsx
// frontend/src/cms/brands.tsx
import { customizeTable } from "@rebasepro/cms";
import type { brands } from "../../../backend/schema/brands";
import { ColorPickerField } from "../fields/ColorPickerField";
import { ColorPreview } from "../fields/ColorPreview";

export const brandsCms = customizeTable<typeof brands>("brands", {
    fields: {
        brandColor: { Field: ColorPickerField, Preview: ColorPreview },
    },
});
```

`brandColor` é um `col.varchar({ length: 7 })` no backend. O backend nunca vê o
componente, e o frontend importa apenas o tipo da tabela de
`backend/schema`.

## Um tipo de campo reutilizável

<span class="since-badge" data-since="0.31">Desde 0.31</span>

Um campo que você usa em várias tabelas pode ser registrado uma única vez em
`<Rebase propertyConfigs>`, indexado por nome, e identificado em cada campo com
`propertyConfig: "color_picker"`.

## Acessando o Contexto do Formulário

<span class="since-badge" data-since="0.31">Desde 0.31</span>

Um campo personalizado pode ler todo o registro enquanto ele está sendo editado:

```tsx
import React from "react";
import type { FieldProps } from "@rebasepro/cms";
import type { NumberProperty } from "@rebasepro/cms-types";

export function PriceWithTaxField({ value, setValue, context }: FieldProps<NumberProperty>) {
    const taxRate = Number(context.values.taxRate ?? 0.1);
    const priceWithTax = value ? value * (1 + taxRate) : 0;

    return (
        <div>
            <input
                type="number"
                value={value ?? 0}
                onChange={(e) => setValue(Number(e.target.value))}
            />
            <p>With tax: {priceWithTax.toFixed(2)}</p>
        </div>
    );
}
```

## Modo Tabela

<span class="since-badge" data-since="0.31">Desde 0.31</span>

Um campo personalizado não é renderizado dentro de uma célula da tabela: a célula mostra o valor (ou
o seu `Preview`), e editá-lo abre o campo em um popup com `minimalistView`
definido. Mantenha-o compacto nesse modo, como o `ColorPickerField` faz acima.

## Previews Personalizados

<span class="since-badge" data-since="0.31">Desde 0.31</span>

O `Preview` renderiza o valor fora do formulário. Ele recebe `FieldPreviewProps`:
`value`, a `property` resolvida, o `size` que a superfície atribui a ele (`"small"`,
`"medium"` ou `"large"`) e as `customProps` do campo.

```tsx
// frontend/src/fields/ColorPreview.tsx
import React from "react";
import type { FieldPreviewProps } from "@rebasepro/cms-types";

export function ColorPreview({ value }: FieldPreviewProps) {
    const color = typeof value === "string" ? value : "transparent";
    return (
        <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
            <span style={{ width: 16, height: 16, borderRadius: 4, backgroundColor: color }}/>
            {typeof value === "string" ? value : ""}
        </span>
    );
}
```

## Filtros Personalizados

<span class="since-badge" data-since="0.31">Desde 0.31</span>

O `Filter` substitui o controle de filtro de um campo. Ele tem precedência sobre uma
substituição global da coleção em `Collection.FilterField` e sobre o controle nativo para
o tipo. Para apenas restringir os operadores oferecidos, use `filterOperators`.

## Próximos Passos

- **[customizeTable](/docs/frontend/customize-table)** — Todas as opções de campos
- **[Entity Views](/docs/frontend/entity-views)** — Abas personalizadas no editor de entidades
- **[Entity Actions](/docs/frontend/entity-actions)** — Botões de ação personalizados
- **[Additional Columns](/docs/frontend/additional-columns)** — Colunas de tabela computadas
