---
sourceHash: bd5ca4ed0e47d867
title: Redirecionamentos e URLs limpas
sidebar_label: Redirecionamentos e URLs Limpas
description: "Um app estático no rebase.json pode responder a requisições com redirecionamentos (correspondência :param estilo Vercel, condições de host, host negado e query) e servir x.html em /x com cleanUrls."
---

Um app estático pode responder a algumas requisições com um redirecionamento em vez de um arquivo, e servir suas páginas HTML sem o `.html`:

```jsonc
"site": {
  "type": "static",
  "root": "site",
  "output": "site",
  "path": "https://www.example.com",
  "cleanUrls": true,
  "redirects": [
    { "from": "/privacy", "to": "/privacidad" },
    { "from": "/blog/:slug", "to": "/posts/:slug", "status": 301 },
    { "from": "/docs/:path*", "to": "https://docs.example.com/:path*" },
    { "from": "/", "to": "/es", "query": { "lang": "es" }, "status": 302 }
  ]
}
```

## `redirects`

- **`from`** é um caminho no endereço do app, absoluto e dentro do seu `path`. `:name` corresponde a um segmento e `:name*`, como o último segmento, corresponde ao restante do caminho, nenhum incluído: `/docs/:path*` corresponde a `/docs`, `/docs/start` e `/docs/a/b`. Uma barra final na requisição é ignorada, e a correspondência diferencia maiúsculas de minúsculas.
- **`to`** é um caminho no mesmo endereço ou uma URL absoluta `http://` ou `https://`. Cada `:name` nele é substituído pelo que `from` capturou, em seu caminho ou query. Um parâmetro no hostname de uma URL é recusado.
- **`status`** é `301`, `302`, `307` ou `308`. Se omitido, é `308`: permanente, e o método é mantido.
- **`host`** limita um redirecionamento a requisições para um hostname. Em um app cujo `path` especifica um hostname, ele só pode ser esse.
- **`notHost`** o limita a requisições para qualquer hostname exceto um. Não pode ser usado junto com `host`, e em um app cujo `path` especifica um hostname ele não pode ser esse, já que o redirecionamento nunca corresponderia.
- **`query`** o limita a requisições cuja query string contenha cada parâmetro exatamente com aquele valor, comparado após a decodificação. `""` corresponde a um parâmetro presente sem valor (`?preview` ou `?preview=`); não há caractere curinga.

A query string da requisição é repassada a menos que `to` tenha uma própria. Os redirecionamentos são verificados na ordem em que estão escritos, antes de qualquer arquivo do build, e o primeiro que corresponder responde. Um caminho que uma das [`routes`](/docs/architecture/apps-and-repositories/#serving-a-function-at-a-path-on-an-app) do app envia para uma função pertence à função, e os caminhos do backend (`/api`, `/health` e os demais) nunca são redirecionados. O `rebase.json` é recusado quando um redirecionamento nunca puder corresponder (um `from` fora do app, ou sob o caminho de outro app), quando dois redirecionamentos corresponderem às mesmas requisições, e quando um redirecionamento enviar uma requisição para um caminho com o qual seu próprio `from` coincida novamente, o que causaria um loop infinito.

## Um caminho, uma página diferente por hostname

Um app servido em vários hostnames pode enviar o mesmo caminho para uma página diferente em cada um. Aqui `/` abre o app em `app.example.com` e a demo em todos os outros hostnames:

```json
"redirects": [
  { "from": "/", "host": "app.example.com", "to": "/app.html", "status": 307 },
  { "from": "/", "notHost": "app.example.com", "to": "/demo.html", "status": 307 }
]
```

Sem `notHost`, o segundo redirecionamento pode não ter nenhuma condição: a primeira correspondência responde, então ele só vê o que o primeiro deixou passar. `notHost` faz cada redirecionamento dizer por conta própria onde se aplica, como faz uma condição `missing` do `vercel.json`, de modo que a ordem deixa de importar.

## Enviando um domínio para outro

Um app cujo único trabalho é um redirecionamento envia o domínio raiz para `www`, mantendo caminho e query:

```jsonc
"apex": {
  "type": "static",
  "root": "apex",
  "output": "apex",
  "path": "https://example.com",
  "redirects": [{ "from": "/:path*", "to": "https://www.example.com/:path*" }]
},
"www": { "type": "static", "root": "site", "output": "site", "path": "https://www.example.com", "cleanUrls": true }
```

`root` e `output` ainda especificam um diretório, que um deploy precisa que exista: mantenha um arquivo placeholder nele, como um `index.html`, já que o git não mantém diretórios vazios. Nenhuma requisição chega até ele. No Rebase Cloud, o deploy registra `example.com` como o hostname de qualquer app e exibe o registro A de que o apex do domínio precisa. Ao contrário de [`rebase cloud domains redirect`](/docs/cli/cloud/), que envia um domínio para o domínio principal do projeto, um redirecionamento pode enviá-lo para qualquer lugar, e um domínio no qual um app é servido nunca é redirecionado para o principal.

## `cleanUrls`

Com `"cleanUrls": true`, `/privacidad` serve `privacidad.html` e `/legal/terms` serve `legal/terms.html`. Uma requisição que especifica o arquivo, `/privacidad.html`, responde `308` para `/privacidad`, mantendo a query. Um arquivo ou diretório com o nome exato da requisição é servido primeiro, então `/about` ainda serve `about/index.html` quando ele existe, e `/docs/index.html` responde `308` para `/docs/`. Sem isso, `/privacidad` é um caminho sem arquivo, o qual um site com `spa: false` responde com 404.

## Vindo da Vercel

`vercel.json`:

```json
{
  "cleanUrls": true,
  "redirects": [
    { "source": "/blog/:slug", "destination": "/posts/:slug", "permanent": true },
    { "source": "/:path*", "has": [{ "type": "host", "value": "example.com" }], "destination": "https://www.example.com/:path*" },
    { "source": "/", "has": [{ "type": "query", "key": "lang", "value": "es" }], "destination": "/es", "permanent": false },
    { "source": "/", "missing": [{ "type": "host", "value": "app.example.com" }], "destination": "/demo.html", "permanent": false }
  ]
}
```

torna-se, no app estático em `rebase.json`:

```json
{
  "cleanUrls": true,
  "redirects": [
    { "from": "/blog/:slug", "to": "/posts/:slug" },
    { "from": "/:path*", "host": "example.com", "to": "https://www.example.com/:path*" },
    { "from": "/", "query": { "lang": "es" }, "to": "/es", "status": 307 },
    { "from": "/", "notHost": "app.example.com", "to": "/demo.html", "status": 307 }
  ]
}
```

| `vercel.json` | `rebase.json` |
| --- | --- |
| `source` | `from` |
| `destination` | `to` |
| `"permanent": true` | `"status": 308`, o padrão |
| `"permanent": false` | `"status": 307` |
| `statusCode` | `status` |
| `has` de `"type": "host"` | `host` |
| `has` de `"type": "query"` com um `value` | `query` |
| `missing` de `"type": "host"` | `notHost` |
| `cleanUrls` | `cleanUrls` |

Um projeto da Vercel por domínio se torna um app estático por hostname, como em [Enviando um domínio para outro](#enviando-um-domínio-para-outro). Condições em um cabeçalho ou cookie, um parâmetro de query `missing` e expressões regulares em `source`, são lógica: uma [rota](/docs/architecture/apps-and-repositories/#serving-a-function-at-a-path-on-an-app) encaminha tal caminho para uma função, que pode responder com qualquer redirecionamento que decidir.

## Onde eles se aplicam

Ambos são servidos pelo runtime, a partir do bundle gerado, onde quer que ele seja executado: `rebase start`, um servidor auto-hospedado e, no Rebase Cloud, todo app estático que o `rebase cloud deploy` incorpora ao bundle do backend. Sob o `rebase dev`, um app sem etapa de build é servido pelo backend de desenvolvimento com ambos. Um app com build é executado no servidor de desenvolvimento do Vite, que não aplica nenhum dos dois; teste-os contra um build com `rebase start`. Um app estático implantado no Rebase Cloud isoladamente (`rebase cloud deploy <app>`) é servido por hospedagem estática, que ainda não os aplica, portanto esse deploy é recusado; faça o deploy do backend, que incorpora o app.

## Relacionados

- [Apps and Repositories](/docs/architecture/apps-and-repositories/): as entradas de app no `rebase.json` às quais estes campos pertencem e as duas formas de `path`.
