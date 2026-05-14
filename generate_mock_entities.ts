import fs from 'fs';

const data = JSON.parse(fs.readFileSync('./app/backend/src/demo-products.json', 'utf8'));

const mapped = data.slice(0, 9).map((p: any, i: number) => {
  return {
    id: `PROD-${i + 1}`,
    title: p.name,
    image: `https://storage.googleapis.com/firecms-demo-27150.appspot.com/${p.main_image}`,
    status: p.available ? 'Available' : 'Out of Stock',
    brand: p.brand || 'Generic',
    category: p.category || 'Uncategorized',
  };
});

console.log(JSON.stringify(mapped, null, 2));
