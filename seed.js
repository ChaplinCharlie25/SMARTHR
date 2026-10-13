// Run once on an empty database after loading db/schema.sql. SAMPLE DATA ONLY: no real employees.
const { Pool } = require('pg'), crypto = require('crypto');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const hash = pw => { const s = crypto.randomBytes(16).toString('hex'); return s + ':' + crypto.scryptSync(pw, s, 32).toString('hex'); };
(async () => {
  const q = (s, p) => pool.query(s, p);
  for (const n of ['Office of the Municipal Mayor', 'Human Resource Management Office', 'Sangguniang Bayan', 'Office of the Municipal Agriculturist'])
    await q('insert into offices(name) values($1)', [n]);
  const E = [['Sample','Mayor','Municipal Mayor','elective',1], ['Sample','ViceMayor','Municipal Vice Mayor','elective',3],
    ['Maria','Santos','HRMO III','permanent',2], ['Juan','Dela Cruz','Administrative Aide IV','permanent',3],
    ['Ana','Lopez','Agricultural Technician','permanent',4]];
  for (const [f, l, p, s, o] of E) await q('insert into employees(first_name,last_name,position,employment_status,office_id) values($1,$2,$3,$4,$5)', [f, l, p, s, o]);
  await q("insert into officials(employee_id,printed_name,title) values(1,'HON. SAMPLE MAYOR','Municipal Mayor'),(2,'HON. SAMPLE VICEMAYOR','Vice Mayor')");
  const pw = hash('changeme123');
  for (const [e, u, r] of [[3,'hrmo','hrmo'],[1,'mayor','official'],[2,'vicemayor','official'],[4,'juan','employee'],[5,'ana','employee']])
    await q('insert into users(employee_id,username,password_hash,role) values($1,$2,$3,$4)', [e, u, pw, r]);
  console.log('Seeded. Log in as hrmo, mayor, vicemayor, juan or ana with password: changeme123 (change it).');
  await pool.end();
})().catch(e => { console.error(e); process.exit(1); });
