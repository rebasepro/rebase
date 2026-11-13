---
sourceHash: 5711b13e11b0b4c4
title: Cache de armazenamento e CDNs
sidebar_label: Cache de armazenamento e CDNs
description: Como o Rebase serve arquivos armazenados para que navegadores e CDNs possam armazená-los em cache — ETags e 304s, Cache-Control de acordo com quem pode ler um objeto, intervalos de bytes para busca em áudio e vídeo e o que configurar em uma CDN frontal.
---

Cada objeto passa por proxy através do servidor em vez de ser redirecionado para
uma URL assinada — uma URL assinada falha em conteúdo misto (uma página HTTPS, um
MinIO HTTP) e em endpoints que apenas o cluster pode alcançar. Portanto, os
cabeçalhos de resposta são o que fazem o cache funcionar.

Cada resposta carrega um `ETag` fraco e `Last-Modified`, construídos a partir do
tamanho do objeto e da hora de modificação. Um cliente que já possui o objeto
envia `If-None-Match` e recebe um **304 sem corpo**, de modo que um carregamento
repetido custa um round trip em vez de uma transferência.

O `Cache-Control` depende de quem pode ler o objeto:

| Objeto | Cabeçalho |
|---|---|
| Sob o prefixo `public/`, ou `publicRead: true` | `public, max-age=60, stale-while-revalidate=86400, must-revalidate` |
| Qualquer outra coisa | `private, max-age=60, must-revalidate` |
| Transformações de imagem | o mesmo, com `max-age=3600` |

`private` é intencional: um objeto que precisou de credenciais para ser obtido
não deve ser armazenado por um cache compartilhado, caso contrário, uma CDN pode
entregar o arquivo de um usuário para a próxima chamada. `Vary: Authorization` é
enviado pelo mesmo motivo.

Nada é marcado como `immutable`. Uma chave de armazenamento pode ser sobrescrita
— gravar em uma chave existente é uma operação comum — portanto, uma promessa de
nunca revalidar tornaria um arquivo substituído invisível até que a janela expirasse.

## Busca em áudio e vídeo

Toda resposta de objeto carrega `Accept-Ranges: bytes`, e uma requisição `Range` é
respondida com `206 Partial Content` e um `Content-Range`. Sem isso, o navegador
não oferecerá a opção de buscar/avançar em um elemento de mídia servido a partir
daqui — e o Safari se recusa a reproduzir um `<video>` cuja primeira resposta
não seja um `206` — portanto, para mídias, essa é a diferença entre um reprodutor
funcional e um quebrado.

- Um intervalo por requisição: `bytes=0-499`, `bytes=500-`, `bytes=-500`. É isso
  que os navegadores enviam para a reprodução.
- Múltiplos intervalos em um único cabeçalho são respondidos com o objeto inteiro
  e um `200`, o que é sempre válido. Nada relevante envia isso.
- Um intervalo que começa após o final resulta em um `416` com
  `Content-Range: bytes */<size>`, e não em uma resposta silenciosa de arquivo
  completo.
- A revalidação tem prioridade sobre um intervalo: uma requisição que contém tanto
  `If-None-Match` quanto `Range` recebe o `304`.

Apenas os bytes requisitados são lidos — do disco no armazenamento local, e com
uma leitura por intervalo do S3 e do GCS — e cada objeto é transmitido via
streaming para o cliente conforme é lido, em vez de ser mantido em memória
primeiro, de modo que servir um vídeo grande custa ao servidor a mesma memória que
servir uma miniatura. Uma revalidação que resulta em um `304`, um `HEAD`, um `416`
e uma renderização de imagem em cache são respondidos a partir dos metadados do
objeto, sem ler seus bytes.

Um `StorageController` customizado obtém o mesmo comportamento implementando os
métodos opcionais `statObject` e `getObjectStream`. Um controlador sem eles é
servido através de `getObject`, que lê o objeto inteiro para cada requisição,
intervalos inclusos.

## Colocando uma CDN à frente

Como os objetos públicos são `public` com uma janela de `stale-while-revalidate`
e um validador, qualquer proxy reverso comum ou CDN pode armazená-los em cache sem
configuração adicional. Aponte para a origem da API e deixe que ele respeite os
cabeçalhos.

Duas coisas a configurar na própria CDN:

- **Respeitar `Vary: Authorization`**, ou não armazenar em cache rotas
  autenticadas de forma alguma. Uma CDN que ignora `Vary` e armazena em cache
  respostas `private` é a falha que este cabeçalho existe para prevenir.
- **Esperar por revalidação.** O `max-age` curto significa que a CDN fará novas
  consultas regularmente; essas requisições são 304s econômicos e são o que impede
  que um objeto sobrescrito seja servido desatualizado.

## Relacionado

- [Configuração de armazenamento](/docs/backend/storage/) — os backends a partir dos quais esses cabeçalhos são servidos, e o prefixo `public/` e `publicRead` que tornam um objeto `public`.
- [Autorização por objeto](/docs/backend/storage-authorization/) — quem pode ler um objeto, o que define a escolha entre `public` e `private`.
- [Uploads de arquivos](/docs/collections/file-uploads/) — as colunas de armazenamento que guardam arquivos e como o painel faz o upload deles.
