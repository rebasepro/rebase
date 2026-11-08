---
sourceHash: adec4552f7386908
title: Campos Personalizados
sidebar_label: Campos Personalizados
description: Crie campos de formulário personalizados para edição de entidades com acesso total ao contexto do formulário, valores da entidade e hooks do Rebase.
---

<video className="intro_video" loop autoPlay muted>
    <source src="/img/custom_fields_dark.mp4" type="video/mp4"/>
</video>

## Visão Geral

O Rebase gera campos de formulário automaticamente com base nos tipos de propriedades. Para comportamentos personalizados, você pode construir seus próprios campos.

## Criando um Campo Personalizado

Um campo personalizado é um componente React que recebe `FieldProps`:

```tsx
import type { FieldProps } from "@rebasepro/cms";
import type { StringProperty, NumberProperty } from "@rebasepro/types";

function ColorPickerField({ value, setValue, error, showError }: FieldProps<StringProperty>) {
    return (
        <div>
            <input
                type="color"
                value={value ?? "#000000"}
                onChange={(e) => setValue(e.target.value)}
            />
            {showError && error && <span className="text-red-500">{error}</span>}
        </div>
    );
}
```

### FieldProps

| Prop | Tipo | Descrição |
|------|------|-------------|
| `value` | `T` | Valor atual do campo |
| `setValue` | `(value: T) => void` | Atualiza o valor do campo |
| `error` | `string` | Mensagem de erro de validação |
| `showError` | `boolean` | Se o erro deve ser exibido |
| `isSubmitting` | `boolean` | O formulário está sendo salvo |
| `property` | `Property` | A configuração da propriedade |
| `context` | `FormContext` | O formulário: seus `values` (incluindo edições não salvas), `setFieldValue`, `id` e `row`, o registro salvo conforme enviado pelo servidor (ausente para um novo registro) |
| `disabled` | `boolean` | O campo é somente leitura |
| `minimalistView` | `boolean` | Renderização no editor de célula popup da tabela (modo compacto) |

## Registrando um Campo Personalizado

### Por Propriedade

Registre em uma única propriedade:

```typescript
properties: {
    brand_color: {
        type: "string",
        name: "Brand Color",
        admin: {
            Field: ColorPickerField
        }
    }
}
```

### Quando o arquivo da coleção também é lido pelo servidor

No scaffold padrão, `config/collections/` é carregado **tanto** pelo painel administrativo quanto pelo backend — o backend lê os mesmos arquivos para derivar o schema e a API. Uma referência direta ao componente só é segura quando nada no servidor carrega esse arquivo, porque importar `ColorPickerField` também importa o React, seu CSS e tudo mais que o componente traz para o grafo de módulos do servidor.

Em vez disso, aponte para o componente com uma importação dinâmica (*lazy import*). Ele é verificado por tipos exatamente da mesma maneira, e o backend nunca o chama:

```ts no-verify
// config/collections/products.ts
properties: {
    brand_color: {
        type: "string",
        name: "Brand Color",
        admin: {
            Field: () => import("../../frontend/src/ColorPickerField"),
            Preview: () => import("../../frontend/src/ColorPreview")
        }
    }
}
```

O módulo deve ter uma **exportação padrão** (`default export`) — o thunk resolve para `default`, e uma exportação apenas nomeada não renderiza nada. O admin o envolve em `React.lazy` na primeira renderização, portanto, o componente também se torna um chunk separado em vez de fazer parte do bundle inicial.

### Configuração Global de Propriedade

Registre um tipo de campo reutilizável:

```tsx
const colorPropertyConfig: PropertyConfig = {
    key: "color_picker",
    name: "Color Picker",
    property: {
        type: "string",
        admin: {
            Field: ColorPickerField
        }
    }
};

// Register globally — keyed by the config's `key`
<Rebase propertyConfigs={{ color_picker: colorPropertyConfig }}>…</Rebase>
```

Em seguida, use-o em qualquer coleção:

```typescript
properties: {
    color: {
        type: "string",
        name: "Color",
        propertyConfig: "color_picker"
    }
}
```

## Acessando o Contexto do Formulário

Campos personalizados podem acessar os valores completos da entidade:

```tsx
function PriceWithTaxField({ value, setValue, context }: FieldProps<NumberProperty>) {
    const taxRate = Number(context.values.tax_rate ?? 0.1);
    const priceWithTax = value ? value * (1 + taxRate) : 0;

    return (
        <div>
            <input
                type="number"
                value={value ?? 0}
                onChange={(e) => setValue(Number(e.target.value))}
            />
            <p>With tax: ${priceWithTax.toFixed(2)}</p>
        </div>
    );
}
```

## Modo Tabela

Um campo personalizado não é renderizado dentro de uma célula da tabela: a célula exibe o valor (ou sua `Preview`), e editá-lo abre o campo em um popup com `minimalistView` ativado. Mantenha-o compacto nesse contexto:

```tsx
function MyField({ value, setValue, minimalistView }: FieldProps<StringProperty>) {
    if (minimalistView) {
        return <input value={value ?? ""} onChange={(e) => setValue(e.target.value)}/>;
    }

    return (
        <div>
            <label>Full Editor</label>
            <textarea value={value ?? ""} onChange={(e) => setValue(e.target.value)} />
        </div>
    );
}
```

## Pré-visualizações Personalizadas

Para renderização personalizada na tabela (modo de não-edição), use o componente `Preview`:

```tsx
function ColorPreview({ value }: { value: string }) {
    return (
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{
                width: 24, height: 24,
                borderRadius: 4,
                backgroundColor: value
            }} />
            <span>{value}</span>
        </div>
    );
}

// Register it
properties: {
    color: {
        type: "string",
        name: "Color",
        admin: {
            Field: ColorPickerField,
            Preview: ColorPreview
        }
    }
}
```

## Próximos Passos

- **[Entity Views](/docs/frontend/entity-views)** — Abas personalizadas no editor de entidades
- **[Entity Actions](/docs/frontend/entity-actions)** — Botões de ação personalizados
- **[Additional Columns](/docs/frontend/additional-columns)** — Colunas calculadas da tabela
