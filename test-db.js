import { Pool } from 'pg';
import dotenv from 'dotenv';
dotenv.config({ path: 'app/backend/.env' });
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
pool.query('SELECT id, email, picture FROM authors LIMIT 5').then(res => {
  console.log(res.rows);
  process.exit(0);
}).catch(err => console.error(err));
