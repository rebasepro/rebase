const fs = require('fs');
const path = require('path');

const newEn = {
  "index.meta.title": "Rebase — The Schema-Driven App Platform for Postgres",
  "index.meta.description": "Define your schema once in TypeScript. Get a production-ready admin panel, REST & GraphQL APIs, a typed SDK, and real-time sync — all generated instantly. Open-source, self-hosted.",
};

const newEs = {
  "index.meta.title": "Rebase — La Plataforma de Aplicaciones Impulsada por Esquemas para Postgres",
  "index.meta.description": "Define tu esquema una vez en TypeScript. Obtén un panel de administración listo para producción, APIs REST y GraphQL, un SDK tipado y sincronización en tiempo real, todo generado instantáneamente. Código abierto, autoalojado.",
};

const newFr = {
  "index.meta.title": "Rebase — La plateforme d'applications pilotée par schéma pour Postgres",
  "index.meta.description": "Définissez votre schéma une seule fois en TypeScript. Obtenez un panneau d'administration prêt pour la production, des API REST et GraphQL, un SDK typé et une synchronisation en temps réel — le tout généré instantanément. Open-source, auto-hébergé.",
};

const newDe = {
  "index.meta.title": "Rebase — Die Schema-gesteuerte App-Plattform für Postgres",
  "index.meta.description": "Definieren Sie Ihr Schema einmalig in TypeScript. Erhalten Sie ein produktionsbereites Admin-Panel, REST- & GraphQL-APIs, ein typisiertes SDK und Echtzeit-Synchronisation — alles sofort generiert. Open-Source, selbst gehostet.",
};

const i18nDir = '/Users/francesco/rebase/website/src/i18n';

function updateLang(lang, newData) {
  const filePath = path.join(i18nDir, `${lang}.ts`);
  let content = fs.readFileSync(filePath, 'utf8');
  
  const lastBraceIndex = content.lastIndexOf('};');
  if (lastBraceIndex === -1) return;
  
  let newEntries = '';
  for (const [key, value] of Object.entries(newData)) {
    if (!content.includes(`"${key}"`)) {
      newEntries += `  "${key}": ${JSON.stringify(value)},\n`;
    }
  }
  
  if (newEntries) {
    content = content.substring(0, lastBraceIndex) + newEntries + '};\n';
    fs.writeFileSync(filePath, content);
    console.log(`Updated ${lang}.ts`);
  }
}

updateLang('en', newEn);
updateLang('es', newEs);
updateLang('fr', newFr);
updateLang('de', newDe);
