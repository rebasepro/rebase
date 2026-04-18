import { Hono } from 'hono';
const app = new Hono();
const child = new Hono();
child.get('/*', (c) => {
  return c.json({ star: c.req.param('*'), path: c.req.path });
})
app.route('/api', child);
app.request(new Request('http://localhost/api/users/1/posts')).then(r => r.json()).then(console.log);
