import { ui, defaultLang } from "../i18n/ui";

type LangKey = keyof typeof ui;

export function generateMarkdownForPage(page: string, lang: string): string {
  const currentLang = (lang in ui ? lang : defaultLang) as LangKey;
  const t = ui[currentLang];

  const tr = (key: string): string => {
    const val = (t as any)[key] || (ui[defaultLang] as any)[key] || "";
    return val;
  };

  const cleanHtml = (text: string): string => {
    return text
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<b[^>]*>(.*?)<\/b>/gi, "**$1**")
      .replace(/<strong[^>]*>(.*?)<\/strong>/gi, "**$1**")
      .replace(/<em[^>]*>(.*?)<\/em>/gi, "*$1*")
      .replace(/<i[^>]*>(.*?)<\/i>/gi, "*$1*")
      .replace(/<a[^>]*href=["']([^"']+)["'][^>]*>(.*?)<\/a>/gi, "[$2]($1)")
      .replace(/<[^>]*>/g, "");
  };

  if (page === "index" || page === "") {
    return `# ${cleanHtml(tr("index.meta.title"))}

${cleanHtml(tr("index.meta.description"))}

## Key Benefits
- **${cleanHtml(tr("howitworks.step1.title"))}**: ${cleanHtml(tr("howitworks.step1.desc"))}
- **${cleanHtml(tr("howitworks.step2.title"))}**: ${cleanHtml(tr("howitworks.step2.desc"))}
- **${cleanHtml(tr("howitworks.step3.title"))}**: ${cleanHtml(tr("howitworks.step3.desc"))}

## Generated Platform Features
Define your schema in TypeScript, and Rebase automatically generates:
- **${cleanHtml(tr("features.kanban.title"))}** (Badge: ${cleanHtml(tr("features.kanban.badge"))}): ${cleanHtml(tr("features.kanban.desc"))}
- **${cleanHtml(tr("features.customization.title"))}** (Badge: ${cleanHtml(tr("features.customization.badge"))}): ${cleanHtml(tr("features.customization.desc"))}
- **${cleanHtml(tr("features.history.title"))}** (Badge: ${cleanHtml(tr("features.history.badge"))}): ${cleanHtml(tr("features.history.desc"))}
- **${cleanHtml(tr("features.import.title"))}** (Badge: ${cleanHtml(tr("features.import.badge"))}): ${cleanHtml(tr("features.import.desc"))}
- **${cleanHtml(tr("features.api.title"))}** (Badge: ${cleanHtml(tr("features.api.badge"))}): ${cleanHtml(tr("features.api.desc"))}
- **${cleanHtml(tr("features.sdk.title"))}** (Badge: ${cleanHtml(tr("features.sdk.badge"))}): ${cleanHtml(tr("features.sdk.desc"))}
- **${cleanHtml(tr("features.realtime.title"))}** (Badge: ${cleanHtml(tr("features.realtime.badge"))}): ${cleanHtml(tr("features.realtime.desc"))}

## Frequently Asked Questions
- **${cleanHtml(tr("faq.q1"))}**
  ${cleanHtml(tr("faq.a1"))}
- **${cleanHtml(tr("faq.q2"))}**
  ${cleanHtml(tr("faq.a2"))}
- **${cleanHtml(tr("faq.q3"))}**
  ${cleanHtml(tr("faq.a3"))}
- **${cleanHtml(tr("faq.q4"))}**
  ${cleanHtml(tr("faq.a4"))}
- **${cleanHtml(tr("faq.q5"))}**
  ${cleanHtml(tr("faq.a5"))}
- **${cleanHtml(tr("faq.q6"))}**
  ${cleanHtml(tr("faq.a6"))}
- **${cleanHtml(tr("faq.q7"))}**
  ${cleanHtml(tr("faq.a7"))}

## Security & Open-Source Infrastructure
- **${cleanHtml(tr("security.title"))}** (Badge: ${cleanHtml(tr("security.badge"))}): ${cleanHtml(tr("security.desc"))}
- **${cleanHtml(tr("opensource.title"))}** (Badge: ${cleanHtml(tr("opensource.badge"))}): ${cleanHtml(tr("opensource.desc"))}
`;
  }

  if (page === "why-rebase") {
    return `# Why Rebase

Rebase eliminates the custom boilerplate work between database, API, and UI by generating your admin panel and type-safe APIs directly from your database schema.

- **${cleanHtml(tr("opensource.title"))}**: ${cleanHtml(tr("opensource.desc"))}
- **${cleanHtml(tr("showcase.sync.title"))}**: ${cleanHtml(tr("showcase.sync.subtitle"))}
  - **${cleanHtml(tr("showcase.sync.tab1.title"))}**: ${cleanHtml(tr("showcase.sync.tab1.desc"))}
  - **${cleanHtml(tr("showcase.sync.tab2.title"))}**: ${cleanHtml(tr("showcase.sync.tab2.desc"))}
  - **${cleanHtml(tr("showcase.sync.tab3.title"))}**: ${cleanHtml(tr("showcase.sync.tab3.desc"))}
  - **${cleanHtml(tr("showcase.sync.tab4.title"))}**: ${cleanHtml(tr("showcase.sync.tab4.desc"))}
`;
  }

  if (page === "features") {
    return `# Rebase Features

Define your schema once in TypeScript, and Rebase automatically generates your admin views, forms, database schema, APIs, and TypeScript SDK.

- **${cleanHtml(tr("features.kanban.title"))}** (${cleanHtml(tr("features.kanban.badge"))}): ${cleanHtml(tr("features.kanban.desc"))}
- **${cleanHtml(tr("features.customization.title"))}** (${cleanHtml(tr("features.customization.badge"))}): ${cleanHtml(tr("features.customization.desc"))}
- **${cleanHtml(tr("features.history.title"))}** (${cleanHtml(tr("features.history.badge"))}): ${cleanHtml(tr("features.history.desc"))}
- **${cleanHtml(tr("features.import.title"))}** (${cleanHtml(tr("features.import.badge"))}): ${cleanHtml(tr("features.import.desc"))}
- **${cleanHtml(tr("features.api.title"))}** (${cleanHtml(tr("features.api.badge"))}): ${cleanHtml(tr("features.api.desc"))}
- **${cleanHtml(tr("features.sdk.title"))}** (${cleanHtml(tr("features.sdk.badge"))}): ${cleanHtml(tr("features.sdk.desc"))}
- **${cleanHtml(tr("features.realtime.title"))}** (${cleanHtml(tr("features.realtime.badge"))}): ${cleanHtml(tr("features.realtime.desc"))}
`;
  }

  if (page === "agencies") {
    return `# Rebase for Agencies

## ${cleanHtml(tr("agencies.hero.title"))}
${cleanHtml(tr("agencies.hero.subtitle"))}

### ${cleanHtml(tr("agencies.weapon.title"))}
${cleanHtml(tr("agencies.weapon.desc1"))}
${cleanHtml(tr("agencies.weapon.desc2"))}

### ${cleanHtml(tr("agencies.accelerate.title"))}
- **${cleanHtml(tr("agencies.accelerate.f1.title"))}**: ${cleanHtml(tr("agencies.accelerate.f1.desc"))}
- **${cleanHtml(tr("agencies.accelerate.f2.title"))}**: ${cleanHtml(tr("agencies.accelerate.f2.desc"))}
- **${cleanHtml(tr("agencies.accelerate.f3.title"))}**: ${cleanHtml(tr("agencies.accelerate.f3.desc"))}

### Customization & Developer Experience
${cleanHtml(tr("agencies.customize.title"))}
- ${cleanHtml(tr("agencies.customize.desc1"))}
- ${cleanHtml(tr("agencies.customize.desc2"))}

### Agency Features
- **${cleanHtml(tr("agencies.features.f1.title"))}**: ${cleanHtml(tr("agencies.features.f1.desc"))}
- **${cleanHtml(tr("agencies.features.f2.title"))}**: ${cleanHtml(tr("agencies.features.f2.desc"))}
- **${cleanHtml(tr("agencies.features.f3.title"))}**: ${cleanHtml(tr("agencies.features.f3.desc"))}
- **${cleanHtml(tr("agencies.features.f4.title"))}**: ${cleanHtml(tr("agencies.features.f4.desc"))}
- **${cleanHtml(tr("agencies.features.f5.title"))}**: ${cleanHtml(tr("agencies.features.f5.desc"))}
- **${cleanHtml(tr("agencies.features.f6.title"))}**: ${cleanHtml(tr("agencies.features.f6.desc"))}
`;
  }

  if (page === "about") {
    return `# About Rebase

## ${cleanHtml(tr("about.hero.title"))}
${cleanHtml(tr("about.hero.subtitle"))}

### Our Story
${cleanHtml(tr("about.story.p1"))}

${cleanHtml(tr("about.story.p2"))}

${cleanHtml(tr("about.story.p3"))}

### Our Values
- **${cleanHtml(tr("about.values.v1.title"))}**: ${cleanHtml(tr("about.values.v1.desc"))}
- **${cleanHtml(tr("about.values.v2.title"))}**: ${cleanHtml(tr("about.values.v2.desc"))}
- **${cleanHtml(tr("about.values.v3.title"))}**: ${cleanHtml(tr("about.values.v3.desc"))}
`;
  }

  const pageTitle = page.charAt(0).toUpperCase() + page.slice(1).replace("-", " ");
  return `# Rebase — ${pageTitle}

Manage your PostgreSQL database with a schema-driven admin panel and auto-generated APIs.

- **Developer First**: Built with React 19, TypeScript, and Hono.
- **Postgres Native**: Integrates with your existing database schemas, enums, relations, and RLS rules.
- **Fast Delivery**: Eliminates CRUD glue code.
- **Visual Schema Builder**: Customize your schema visually while keeping TypeScript definitions in version control.
`;
}
