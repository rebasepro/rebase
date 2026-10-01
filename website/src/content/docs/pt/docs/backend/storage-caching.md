---
title: Cache de armazenamento e CDNs
sidebar_label: Cache de armazenamento e CDNs
description: Como o Rebase serve arquivos armazenados para que navegadores e CDNs possam fazer cache deles — ETags e 304s, Cache-Control de acordo com quem pode ler um objeto, byte ranges para navegação em áudio e vídeo, e o que configurar em uma CDN na frente.
---

Cada objeto passa por proxy pelo servidor em vez de ser redirecionado para uma
URL assinada — uma URL assinada falha em conteúdo misto (uma página HTTPS, um MinIO HTTP) e em
endpoints acessíveis apenas pelo cluster. Portanto, os cabeçalhos de resposta são o que fazem
o cache funcionar.

Cada resposta inclui um `ETag` fraco e `Last-Modified`, construídos a partir do
tamanho do objeto e do horário de modificação. Um cliente que já possui o objeto envia
`If-None-Match` e recebe **304 sem corpo**, de modo que um carregamento repetido custa apenas um
round-trip em vez de uma transferência.

O `Cache-Control` depende de quem tem permissão para ler o objeto:

| Objeto | Cabeçalho |
|---|---|
| Sob o prefixo `public/`, ou `publicRead: true` | `public, max-age=60, stale-while-revalidate=86400, must-revalidate` |
| Qualquer outro | `private, max-age=60, must-revalidate` |
| Transformações de imagem | o mesmo, com `max-age=3600` |

`private` é deliberado: um objeto que necessitou de credenciais para ser obtido não deve ser
armazenado por um cache compartilhado, sob risco de uma CDN entregar o arquivo de um usuário para a próxima requisição.
`Vary: Authorization` é enviado pelo mesmo motivo.

Nada é marcado como `immutable`. Uma chave de armazenamento pode ser sobrescrita — gravar
em uma chave existente é uma operação comum — portanto, uma promessa de nunca revalidar
tornaria um arquivo substituído invisível até que a janela expirasse.

## Navegação (Seeking) em áudio e vídeo

Toda resposta de objeto inclui `Accept-Ranges: bytes`, e uma requisição com `Range` é
respondida com `206 Partial Content` e um `Content-Range`. Sem isso, o navegador
não oferecerá o recurso de avançar/retroceder (seek) em um elemento de mídia servido aqui — e o Safari se recusa
a reproduzir um `<video>` cuja primeira resposta não seja um `206` — portanto, para mídia, essa é
a diferença entre um player funcional e um com defeito.

- Um range por requisição: `bytes=0-499`, `bytes=500-`, `bytes=-500`. É isso que
  os navegadores enviam para reprodução.
- Múltiplos ranges em um único cabeçalho são respondidos com o objeto inteiro e um `200`,
  o que é sempre válido. Nenhum cliente relevante os envia.
- Um range que começa além do fim resulta em um `416` com `Content-Range: bytes */<size>`,
  e não em uma resposta silenciosa com o arquivo inteiro.
- A revalidação tem precedência sobre o range: uma requisição contendo tanto `If-None-Match` quanto
  `Range` recebe o `304`.

No armazenamento local, apenas o trecho solicitado é lido do disco. No S3 e GCS, o
objeto ainda é buscado por inteiro — um `StorageController` não possui leitura particionada —, portanto
a economia acontece na resposta, e não no tráfego upstream.

## Colocando uma CDN na frente

Como objetos públicos são definidos como `public` com uma janela de `stale-while-revalidate` e um
validador, qualquer proxy reverso comum ou CDN pode armazená-los em cache sem nenhuma configuração
adicional. Aponte-o para a origem da API e deixe-o honrar os cabeçalhos.

Duas coisas para configurar na própria CDN:

- **Respeitar `Vary: Authorization`**, ou não armazenar em cache rotas autenticadas de forma alguma.
  Uma CDN que ignora `Vary` e armazena em cache respostas `private` é a falha que
  este cabeçalho existe para evitar.
- **Esperar revalidação.** O `max-age` curto significa que a CDN fará novas requisições
  regularmente; essas requisições são 304s leves, e são elas que evitam que um
  objeto sobrescrito seja servido desatualizado.

## Relacionados

- [Configuração de Armazenamento](/docs/backend/storage/) — os backends a partir dos quais esses cabeçalhos são servidos, e o prefixo `public/` e o `publicRead` que tornam um objeto `public`.
- [Autorização por objeto](/docs/backend/storage/#autorização-por-objeto-per-object-authorization) — quem pode ler um objeto, o que decide entre `public` e `private`.
- [Uploads de arquivos](/docs/collections/file-uploads/) — as propriedades de coleção que armazenam arquivos.
