---
sourceHash: 8d29618687855b39
title: Estilizando UI Personalizada
sidebar_label: Estilizando UI Personalizada
description: Construa visualizações, páginas iniciais e ações personalizadas a partir dos mesmos componentes e tokens de tema do restante do admin, para que pareçam nativas e sigam o tema.
---

## Visão Geral

Cada mecanismo de extensão nesta seção entrega a você um componente React e sai do caminho — uma [visualização personalizada](/docs/frontend/extending), uma [página inicial](/docs/frontend/component-overrides), uma [visualização de entidade](/docs/frontend/entity-views), um [slot](/docs/frontend/slots). O que nenhum deles diz é com o que *construí-lo*.

A resposta é: as mesmas partes a partir das quais o admin é construído. Uma visualização personalizada ainda é uma visualização do admin. Ela fica dentro da mesma estrutura, ao lado das mesmas tabelas, sob o mesmo seletor de tema — portanto, deve usar os mesmos componentes, a mesma escala tipográfica e os mesmos tokens de cor.

Esta página é sobre como construir suas próprias visualizações. Para alterar a própria aparência do admin — cor da marca, fontes, cantos, logotipo — consulte [Theming & Branding](/docs/frontend/theming); como suas visualizações usam os mesmos tokens, elas também acompanham essa alteração.

A alternativa é inventar uma segunda linguagem de design dentro da mesma aplicação. Essa é a falha mais comum, e ela não apenas parece inconsistente — ela quebra. Um `color: #111` escrito à mão fica invisível no momento em que alguém alterna para o tema escuro, e nenhum teste detecta isso.

## A regra

**Importe componentes de `@rebasepro/ui`. Recorra a uma `<div>` pura e a uma classe apenas para layout.**

```tsx
import { Alert, Button, Card, Chip, Typography } from "@rebasepro/ui";

export function DashboardView() {
    return (
        <div className="p-8 max-w-5xl mx-auto flex flex-col gap-8">
            <Typography variant="h4">Outreach</Typography>
            <Typography variant="body2" color="secondary">
                What ran last night, and what is waiting for you.
            </Typography>

            <Card className="p-4 flex flex-col gap-1">
                <Typography variant="h5" className="mb-0 tabular-nums">128</Typography>
                <Typography variant="subtitle2" className="mb-0">Signals</Typography>
                <Typography variant="caption" color="secondary" className="mb-0">12 approved</Typography>
            </Card>

            <Alert color="warning">Delivery is not configured, so nothing can be sent.</Alert>
        </div>
    );
}
```

Cada componente do kit está catalogado em [UI components](/docs/ui/components/card/) com suas props reais, geradas a partir do código-fonte. Consulte lá antes de criar manualmente: `Card`, `Chip`, `Badge`, `Alert`, `Button`, `Typography`, `Paper`, `Container`, `Table`, `Tooltip`, `Dialog` e cerca de outros setenta já existem.

## Cor: use tokens, nunca literais

O tema é um conjunto de variáveis CSS expostas como utilitários do Tailwind. Use-as e combine cada valor claro com um `dark:`:

| Uso | Classe |
|---|---|
| Texto do corpo | `text-surface-900 dark:text-surface-100` |
| Texto secundário | `text-surface-600 dark:text-surface-400` — ou apenas `<Typography color="secondary">` |
| Fundo do painel | `bg-surface-accent-50 dark:bg-surface-800` |
| Bordas | `border-surface-200 dark:border-surface-700` |
| Destaque | `text-primary` / `bg-primary` (a cor da marca do projeto, `#0070F4` por padrão) |
| Texto sobre preenchimento de destaque | `text-on-primary` — preto ou branco, o que for legível sobre a cor da marca |

Duas regras que surgiram de problemas reais:

- **Nunca escreva uma cor literal.** `#111`, `rgba(128,128,128,.28)`, `white` — cada uma delas está correta em exatamente um tema. Uma página cujos números eram `color: var(--fg, #111)` foi renderizada preto no preto para todos os usuários do tema escuro, e parecia perfeita para a pessoa que a escreveu.
- **Nunca defina uma cor que um componente já define.** `<Typography>` escolhe a cor de primeiro plano correta para o tema. Sobrescrevê-la com uma classe é como um título acaba sendo o único elemento na página que ignora o tema.

## Tipografia: use a escala

`Typography` abrange toda a escala — `h1`–`h6`, `subtitle1`/`subtitle2`, `body1`/`body2`, `lead`, `caption`, `label`, `button`, `stat`, `micro`, `mono`. Use `variant`, não uma classe de tamanho de fonte. A escala já codifica o espaçamento entre letras (tracking) que cada nível precisa (`--tracking-display` em ≥30px, `--tracking-title` em 20–24px, `--tracking-heading` abaixo disso), o que um `text-[27px]` não faz.

A interface do produto não fica abaixo de `text-xs`, com uma exceção: a variante `micro`, o rótulo em maiúsculas acima de um valor, fica em `text-2xs`. O nível `text-3xs` existe apenas para páginas de marketing.

## Configuração

A UI personalizada precisa do CSS do tema e do Tailwind apontados para os pacotes, caso contrário, as classes utilitárias usadas *dentro* do `@rebasepro/ui` nunca serão geradas:

```css
@import "tailwindcss";
@import "@rebasepro/ui/index.css" layer(base);

/* Without this, Tailwind never scans the kit's own classes. */
@source "../node_modules/@rebasepro";

@custom-variant dark (&:where(.dark, .dark *));
```

`rebase init` escreve isso para você. Se a sua visualização personalizada for renderizada sem estilos, essa é a primeira coisa a verificar.

## Checklist

Antes de publicar uma visualização personalizada:

- Sem cores literais — cada cor é um token ou vem de um componente.
- Todo `bg-`, `text-` e `border-` tem um equivalente `dark:`.
- O texto é `<Typography variant=…>`, não uma classe de tamanho de fonte.
- Contêineres são `Card` / `Paper`, não uma `<div>` com borda escrita à mão.
- Alterne o tema e olhe para a página. Esse é todo o teste, e leva cinco segundos.
