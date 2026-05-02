const http = require('http');

async function check() {
  try {
    const res = await fetch('http://localhost:3000/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'admin@rebase.com', password: 'password123' })
    });
    console.log(res.status, await res.text());
  } catch(e) { console.log(e); }
}
check();
