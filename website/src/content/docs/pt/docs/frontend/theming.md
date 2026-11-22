---
sourceHash: 93a59ca2be100841
title: Temas e Marca
sidebar_label: Temas e Marca
description: Aplique a sua marca no admin — cores, fontes, cantos, superfícies, modo claro e escuro, logotipo e tela de login — substituindo alguns tokens de CSS, sem precisar reescrever componentes.
---

## Visão Geral

Cada parte do admin — o drawer, as tabelas, os formulários, as caixas de diálogo, o Studio, a tela de login — é baseada em um único conjunto de tokens de design no `@rebasepro/ui`. Altere um token na sua própria folha de estilos e todas as partes que o utilizam acompanharão a mudança, em ambos os temas.

Portanto, a personalização da marca possui dois níveis, e você raramente precisará do segundo:

1. **Tokens.** Cor da marca, fontes, raio dos cantos e superfícies são variáveis CSS que você substitui em `frontend/src/index.css`. Logotipo e nome são propriedades (props) no `<RebaseShell>`. Isso atende ao que a maioria dos projetos busca ao "deixar com a nossa cara".
2. **Componentes.** Quando uma parte precisa se *comportar ou ser estruturada* de maneira diferente — sua própria barra de aplicativo, sua própria tela de login — substitua-a com uma [substituição de componente](/docs/frontend/component-overrides).

## Cor da marca

Uma linha. Adicione um bloco `@theme` após as importações em `frontend/src/index.css`:

```css
@import "tailwindcss";
@import "@rebasepro/ui/index.css" layer(base);

@source "../node_modules/@rebasepro";
@custom-variant dark (&:where(.dark, .dark *));

@theme {
    --color-primary: #16a34a;
}
```

Tudo o que utiliza "primary" muda junto: botões preenchidos, links, caixas de seleção (checkboxes) e interruptores (switches) marcados, anéis de foco, a linha ativa no drawer, gráficos, seleções. Os tokens relacionados são derivados dele, portanto você não precisa defini-los manualmente:

| Token | Derivado como | Usado para |
|---|---|---|
| `--color-primary-light` | 0.15 mais claro em luminosidade OKLCH | texto de destaque em fundos escuros |
| `--color-primary-dark` | 0.15 mais escuro | estados pressionado e hover |
| `--color-primary-bg` | primária com 10% de opacidade | linhas selecionadas, fundos com tonalidade |
| `--color-on-primary` | branco ou preto, o que tiver melhor contraste sobre a cor primária | o texto de um botão preenchido, a marcação em um checkbox |

O `--color-on-primary` (novo na versão 0.34; antes dele, botões preenchidos sempre exibiam textos em branco) é o que mantém uma marca com tons claros legível. Uma cor primária amarela ou verde-limão recebe textos pretos em seus botões, em vez de brancos com contraste inadequado de 2:1. Ele alterna na luminosidade OKLCH 0.6, que escolhe a cor de texto com maior contraste para quase qualquer cor de marca real; se a sua estiver próxima desse limite e você preferir a outra cor de texto, defina-a:

```css
@theme {
    --color-primary: #8b5cf6;
    --color-on-primary: #ffffff;
}
```

`--color-secondary` e `--color-on-secondary` funcionam da mesma forma. O admin quase não usa a cor secundária — ela está disponível para a sua própria interface.

## Fontes

O admin define o texto do corpo em `--font-sans`, títulos em `--font-headers` e valores medidos (IDs, carimbos de data/hora, código) em `--font-mono`. Instale a fonte, importe-a uma vez e aponte o token para ela:

```bash
pnpm --dir frontend add @fontsource-variable/manrope
```

```tsx no-verify
// frontend/src/App.tsx, next to the existing font imports
import "@fontsource-variable/manrope";
```

```css
@theme {
    --font-sans: "Manrope Variable", ui-sans-serif, system-ui, sans-serif;
    --font-headers: "Manrope Variable", ui-sans-serif, system-ui, sans-serif;
}
```

Remova as importações de fontes que você não usa mais (`@fontsource-variable/inter`, `@fontsource-variable/instrument-sans`), caso contrário elas ainda serão baixadas.

## Cantos

Três raios de arredondamento definem toda a interface:

| Token | Padrão | Usado para |
|---|---|---|
| `--radius-md` | `6px` | chips, blocos de código, blocos pequenos |
| `--radius-lg` | `9px` | controles, menus, destaques de linha |
| `--radius-xl` | `13px` | cards, caixas de diálogo, painéis laterais (side sheets) |

```css
@theme {
    /* A squarer, denser look */
    --radius-lg: 4px;
    --radius-xl: 6px;
}
```

## Superfícies

Os planos de fundo são nomeados por função, e cada função tem um valor claro e um escuro. Estas são variáveis CSS comuns em vez de tokens de `@theme`, pois alternam de acordo com o tema — portanto, substitua-as sob `:root` para o modo claro e `.dark` para o modo escuro:

```css
/* A warmer ground in both themes */
:root {
    --surface-frame: #f4f1ec;
    --surface-sheet: #faf8f5;
}

.dark {
    --surface-frame: #0d0b09;
    --surface-sheet: #15120f;
    --surface-card: #1b1814;
}
```

| Variável | O que é |
|---|---|
| `--surface-frame` | a página atrás de tudo, ao redor do drawer |
| `--surface-sheet` | a área de conteúdo principal |
| `--surface-card` | cards, linhas de tabela, painéis de formulário |
| `--surface-raised` | um controle ou painel elevado em relação a um card |
| `--surface-lifted` | menus, popovers, diálogos |
| `--surface-field` | o preenchimento de um campo de texto (translúcido) |
| `--surface-hover` / `--surface-active` | preenchimentos ao passar o mouse (hover) e pressionar (translúcidos) |
| `--surface-well` | um bloco rebaixado para código ou logs |
| `--hairline` / `--hairline-strong` | bordas e divisores (translúcidos) |

Mantenha a hierarquia: em cada tema, frame, sheet e card devem se distanciar uns dos outros na mesma direção. As cores do texto são ajustadas de acordo com os padrões, portanto, após uma grande alteração, verifique uma página em ambos os temas para conferir o contraste.

## Modos claro e escuro

Por padrão, o admin segue o sistema operacional, exibe um botão de alternância de tema e memoriza a escolha do usuário.

Para disponibilizar apenas um único tema, controle o modo você mesmo. Passe para o `<Rebase>` um `modeController` cujo `setMode` ignore a alternância, e adicione a classe correspondente na tag `<html>` — com o seu próprio controller, o Rebase não altera as classes da página:

```tsx
import type { ModeController } from "@rebasepro/app";

// Dark only. `frontend/index.html` also needs <html class="dark">.
const darkOnly: ModeController = {
    mode: "dark",
    setMode: () => {}
};

// <Rebase client={rebaseClient} authController={authController} modeController={darkOnly}>
```

## Logotipo e nome

O `<RebaseShell>` aceita o nome e o logotipo exibidos no drawer. O mesmo logotipo aparece na tela de login integrada. Coloque os arquivos em `frontend/public/`:

```tsx
import { RebaseShell } from "@rebasepro/cms";

export function Shell() {
    return <RebaseShell title="Acme Ops" logo="/logo.svg" logoDark="/logo-dark.svg"/>;
}
```

`logoDark` é opcional. Use-o quando o seu logotipo tiver traços escuros que desapareceriam no tema escuro; sem ele, `logo` é usado em ambos.

O título e o ícone da aba do navegador vêm de `frontend/index.html`:

```html
<title>Acme Ops</title>
<link rel="icon" href="/favicon.svg" type="image/svg+xml"/>
```

## A tela de login

A tela de login integrada herda a cor da sua marca, as fontes, as superfícies e o `logo` do shell sem a necessidade de código extra.

Para alterar seus textos ou adicionar conteúdo próprio, passe para o `<RebaseAuth>` uma `LoginView` configurada. No `App.tsx` gerado na estrutura inicial, o `authController` já está no escopo:

```tsx
import { LoginView, RebaseAuth } from "@rebasepro/app";

<RebaseAuth loginView={
    <LoginView
        authController={authController}
        logo="/logo.svg"
        logoDark="/logo-dark.svg"
        title="Acme Ops"
        subtitle="Sign in with your work account"
        additionalComponent={<a href="https://acme.example/help">Trouble signing in?</a>}
    />
}/>
```

Outras props: `topComponent` (acima dos botões de login), `layout="form-first"` (sem um card próprio, ideal para uma página que emoldura o login por conta própria, como uma tela dividida ao lado da imagem de um produto) e `disableSignupScreen`.

Para substituir a tela completamente, sobrescreva `"Auth.LoginView"` (consulte [Substituições de componentes](/docs/frontend/component-overrides)).

## Além dos tokens

- **Substitua uma parte do shell** — a barra de aplicativos, o drawer, uma linha de navegação, a tela de login — com uma [substituição de componente](/docs/frontend/component-overrides).
- **Adicione suas próprias páginas** que combinem com o tema: [Estilizando UI personalizada](/docs/frontend/styling) explica com quais componentes e classes construí-las, para que seus tokens também sejam aplicados a elas.

## Checklist

- A cor da marca é definida apenas uma vez, em `@theme`, e em nenhum outro lugar. Não a utilize como valor literal em componentes; use `bg-primary` / `text-primary`.
- Observe um botão preenchido e um checkbox marcado: o texto e a marcação de seleção devem ser fáceis de ler.
- Alterne o tema e observe uma tabela, um formulário e um diálogo em ambos os modos.
- Se você substituiu as fontes, remova as importações das fontes padrão.
