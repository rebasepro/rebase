/**
 * The one sample collection every "one file → everything" figure draws.
 *
 * Two components render it: `CollectionPowerSection` (home, beat 01 — the file in
 * the middle, five artifacts fanned around it) and `CollectionLayersSection`
 * (/product — the same file forked into the two layers). They share the SAMPLE and
 * nothing else, so the code, the rows and the endpoints can never disagree
 * between the two pages while the compositions stay free to differ.
 *
 * Strings are pre-highlighted HTML because whitespace inside a <pre> has to be
 * exact and Astro's template would re-indent it.
 */

/** products.ts — the only file written by hand. */
export const COLLECTION_CODE_HTML = `<span class="text-primary-light">import type</span> { PostgresCollectionConfig }
  <span class="text-primary-light">from</span> <span class="text-green-400">"@rebasepro/types"</span>;

<span class="text-primary-light">export const</span> <span class="text-white">products</span>: PostgresCollectionConfig = {
  <span class="text-blue-300">name</span>: <span class="text-green-400">"Products"</span>,
  <span class="text-blue-300">slug</span>: <span class="text-green-400">"products"</span>,
  <span class="text-blue-300">table</span>: <span class="text-green-400">"products"</span>,
  <span class="text-blue-300">properties</span>: {
    <span class="text-blue-300">name</span>: {
      <span class="text-blue-300">name</span>: <span class="text-green-400">"Name"</span>,
      <span class="text-blue-300">type</span>: <span class="text-green-400">"string"</span>,
      <span class="text-blue-300">validation</span>: { <span class="text-blue-300">required</span>: <span class="text-primary-light">true</span> },
    },
    <span class="text-blue-300">category</span>: {
      <span class="text-blue-300">name</span>: <span class="text-green-400">"Category"</span>,
      <span class="text-blue-300">type</span>: <span class="text-green-400">"string"</span>,
      <span class="text-blue-300">enum</span>: {
        <span class="text-blue-300">electronics</span>: <span class="text-green-400">"Electronics"</span>,
        <span class="text-blue-300">fashion</span>: <span class="text-green-400">"Fashion"</span>,
        <span class="text-blue-300">home</span>: <span class="text-green-400">"Home &amp; Garden"</span>,
      },
    },
    <span class="text-blue-300">price</span>:     { <span class="text-blue-300">name</span>: <span class="text-green-400">"Price"</span>, <span class="text-blue-300">type</span>: <span class="text-green-400">"number"</span> },
    <span class="text-blue-300">in_stock</span>:  { <span class="text-blue-300">name</span>: <span class="text-green-400">"In Stock"</span>, <span class="text-blue-300">type</span>: <span class="text-green-400">"boolean"</span> },
    <span class="text-blue-300">image_url</span>: { <span class="text-blue-300">name</span>: <span class="text-green-400">"Image"</span>, <span class="text-blue-300">type</span>: <span class="text-green-400">"string"</span>, <span class="text-blue-300">url</span>: <span class="text-primary-light">true</span> },
  },
};`;

/** What `rebase db push` writes for it. */
export const SQL_HTML = `<span class="text-primary-light">CREATE TABLE</span> <span class="text-white">"products"</span> (
  <span class="text-blue-300">"id"</span>         <span class="text-white">uuid PRIMARY KEY</span>,
  <span class="text-blue-300">"name"</span>       <span class="text-white">text NOT NULL</span>,
  <span class="text-blue-300">"category"</span>   <span class="text-white">text</span>,
  <span class="text-blue-300">"price"</span>      <span class="text-white">numeric(10,2)</span>,
  <span class="text-blue-300">"in_stock"</span>   <span class="text-white">boolean</span>
                 <span class="text-white">DEFAULT false</span>,
  <span class="text-blue-300">"image_url"</span>  <span class="text-white">text</span>,
  <span class="text-blue-300">"created_at"</span> <span class="text-white">timestamptz</span>
                 <span class="text-white">DEFAULT now()</span>
);`;

/** The typed client, against the same collection. */
export const SDK_HTML = `<span class="text-primary-light">import</span> <span class="text-white">{ createRebaseClient }</span> <span class="text-primary-light">from</span> <span class="text-green-400">"@rebasepro/client"</span>;

<span class="text-primary-light">const</span> <span class="text-white">client</span> <span class="text-primary-light">=</span> <span class="text-blue-300">createRebaseClient</span>&lt;Database&gt;({
  <span class="text-blue-300">baseUrl</span>: <span class="text-blue-300">import.meta.env.VITE_API_URL</span>
});

<span class="text-surface-500">// Fully typed queries</span>
<span class="text-primary-light">const</span> <span class="text-white">{ data }</span> <span class="text-primary-light">=</span> <span class="text-primary-light">await</span> <span class="text-white">client</span>.data.products.<span class="text-blue-300">find</span>({
  <span class="text-blue-300">where</span>: {
    <span class="text-blue-300">category</span>: [<span class="text-green-400">"=="</span>, <span class="text-green-400">"Electronics"</span>],
    <span class="text-blue-300">in_stock</span>: [<span class="text-green-400">"=="</span>, <span class="text-primary-light">true</span>]
  }
});

<span class="text-surface-500">// Type-safe inserts</span>
<span class="text-primary-light">await</span> <span class="text-white">client</span>.data.products.<span class="text-blue-300">create</span>({
  <span class="text-blue-300">name</span>: <span class="text-green-400">"Camera"</span>,
  <span class="text-blue-300">price</span>: <span class="text-amber-500">299</span>,
  <span class="text-blue-300">category</span>: <span class="text-green-400">"Electronics"</span>
});

<span class="text-surface-500">// Realtime, over the same collection</span>
<span class="text-primary-light">const</span> <span class="text-white">unsubscribe</span> = <span class="text-white">client</span>.data.products.<span class="text-blue-300">listen</span>(
  { <span class="text-blue-300">where</span>: { <span class="text-blue-300">in_stock</span>: [<span class="text-green-400">"=="</span>, <span class="text-primary-light">true</span>] } },
  (<span class="text-white">res</span>) =&gt; <span class="text-white">setRows</span>(<span class="text-white">res</span>.<span class="text-blue-300">data</span>)
);`;

/** The rows the collection view shows. `catColor` pairs with the `chip` utilities. */
export const SAMPLE_ROWS = [
    { id: "x7kQ2p", name: "Wireless Headphones", cat: "Electronics", catColor: "chip chip-xs chip-blue",  price: "€129", stock: true  },
    { id: "mR9vLw", name: "Silk Scarf",          cat: "Fashion",     catColor: "chip chip-xs chip-pink",  price: "€99",  stock: false },
    { id: "p4tN8x", name: "Mechanical Keyboard", cat: "Electronics", catColor: "chip chip-xs chip-blue",  price: "€149", stock: true  },
    { id: "b2vF1z", name: "Ceramic Mug",         cat: "Home",        catColor: "chip chip-xs chip-green", price: "€24",  stock: true  },
];

/** The REST surface the collection gets. */
export const SAMPLE_ENDPOINTS = [
    { method: "GET",    color: "bg-blue-950 text-blue-300 border-blue-800/40",    path: "/api/products" },
    { method: "POST",   color: "bg-green-950 text-green-300 border-green-800/40", path: "/api/products" },
    { method: "PATCH",  color: "bg-amber-950 text-amber-300 border-amber-800/40", path: "/api/products/:id" },
    { method: "DELETE", color: "bg-red-950 text-red-300 border-red-800/40",       path: "/api/products/:id" },
];
