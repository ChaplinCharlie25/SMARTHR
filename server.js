const express = require('express'), crypto = require('crypto'), pg = require('pg');
pg.types.setTypeParser(1082, v => v);               // keep DATE columns as 'YYYY-MM-DD' strings
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const q = (s, p) => pool.query(s, p).then(r => r.rows);
const SECRET = process.env.SESSION_SECRET || 'dev-only-change-me', MAXAGE = 8 * 3600e3;
const sign = v => crypto.createHmac('sha256', SECRET).update(v).digest('hex');
const app = express(); app.use(express.json()); app.use(express.static('public'));

const verifyPw = (pw, stored) => { const [salt, h] = stored.split(':'); const x = crypto.scryptSync(pw, salt, 32).toString('hex'); return h.length === x.length && crypto.timingSafeEqual(Buffer.from(h), Buffer.from(x)); };
async function auth(req, res, next) {
  try {
    const c = (req.headers.cookie || '').split('; ').find(x => x.startsWith('sid='));
    if (c) {
      const [uid, ts, sig] = c.slice(4).split('.');
      if (sig && sig.length === 64 && crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(sign(uid + '.' + ts))) && Date.now() - ts < MAXAGE) {
        const u = (await q('select id, employee_id, username, role from users where id=$1', [uid]))[0];
        if (u) { req.user = u; return next(); }
      }
    }
  } catch (e) { /* fall through */ }
  res.status(401).json({ error: 'Please log in' });
}
const need = (...r) => (req, res, next) => r.includes(req.user.role) ? next() : res.status(403).json({ error: 'Not allowed for your role' });
const wrap = f => (req, res) => f(req, res).catch(e => { console.error(e); res.status(500).json({ error: 'Server error' }); });

app.post('/api/login', wrap(async (req, res) => {
  const { username, password } = req.body || {};
  const u = (await q('select * from users where username=$1', [username]))[0];
  if (!u || !verifyPw(String(password || ''), u.password_hash)) return res.status(401).json({ error: 'Wrong username or password' });
  const v = u.id + '.' + Date.now();
  res.cookie('sid', v + '.' + sign(v), { httpOnly: true, sameSite: 'lax', maxAge: MAXAGE });
  res.json({ username: u.username, role: u.role });
}));
app.post('/api/logout', (req, res) => { res.clearCookie('sid'); res.json({ ok: true }); });
app.get('/api/me', auth, (req, res) => res.json(req.user));
app.get('/api/employees', auth, wrap(async (req, res) =>
  res.json(await q("select id, first_name||' '||last_name as name, position from employees where active order by last_name"))));

// ---- Travel orders ----
app.get('/api/travel-orders', auth, wrap(async (req, res) => {
  const all = req.user.role !== 'employee', me = req.user.employee_id;
  res.json(await q(`select t.id, t.version, t.to_number, t.to_year, t.destination, t.date_from, t.date_to, t.status,
      (select json_agg(e.first_name||' '||e.last_name order by tt.sort_order) from travel_order_travelers tt
         join employees e on e.id=tt.employee_id where tt.travel_order_id=t.id) as travelers
    from travel_orders t
    where $1 or t.filed_by=$2 or exists (select 1 from travel_order_travelers x where x.travel_order_id=t.id and x.employee_id=$2)
    order by t.id desc`, [all, me]));
}));

app.post('/api/travel-orders', auth, need('employee', 'hrmo'), wrap(async (req, res) => {
  const b = req.body || {}, ids = (b.travelers || []).map(Number).filter(Boolean);
  if (!['executive', 'sb'].includes(b.version) || !b.destination || !b.purpose || !b.date_from || !b.date_to || !ids.length)
    return res.status(400).json({ error: 'Fill in every field and pick at least one traveler' });
  if (b.date_to < b.date_from) return res.status(400).json({ error: 'The end date is before the start date' });
  const c = await pool.connect();
  try {
    await c.query('begin');
    const o = (await c.query(`insert into travel_orders(version,to_year,filed_by,destination,purpose,date_from,date_to,status)
      values($1, extract(year from current_date)::int, $2,$3,$4,$5,$6,'filed') returning id`,
      [b.version, req.user.employee_id, b.destination.trim(), b.purpose.trim(), b.date_from, b.date_to])).rows[0];
    for (const [i, id] of ids.entries())
      await c.query(`insert into travel_order_travelers(travel_order_id,employee_id,position_printed,sort_order)
        select $1::int, id, position, $3::int from employees where id=$2::int`, [o.id, id, i]);
    await c.query(`insert into status_log(doc_type,doc_id,status,changed_by) values('travel_order',$1,'filed',$2)`, [o.id, req.user.id]);
    await c.query('commit'); res.json({ id: o.id });
  } catch (e) { await c.query('rollback'); throw e; } finally { c.release(); }
}));

app.get('/api/travel-orders/:id', auth, wrap(async (req, res) => {
  const o = (await q(`select t.*, r.printed_name rec_name, r.title rec_title, a.printed_name app_name, a.title app_title
    from travel_orders t left join officials r on r.id=t.recommender_id left join officials a on a.id=t.approver_id where t.id=$1`, [req.params.id]))[0];
  if (!o) return res.status(404).json({ error: 'Not found' });
  o.travelers = await q(`select e.id as employee_id, e.first_name||' '||e.last_name as name, tt.position_printed as position
    from travel_order_travelers tt join employees e on e.id=tt.employee_id where tt.travel_order_id=$1 order by tt.sort_order`, [o.id]);
  const me = req.user.employee_id;
  if (req.user.role === 'employee' && o.filed_by !== me && !o.travelers.some(t => t.employee_id === me)) return res.status(403).json({ error: 'Not allowed' });
  o.conflicts = await q(`select c.employee_id, l.date_from, l.date_to from travel_leave_conflicts c join leave_applications l on l.id=c.leave_id where c.travel_order_id=$1`, [o.id]);
  o.log = await q(`select s.status, s.changed_at, u.username, s.remarks from status_log s join users u on u.id=s.changed_by
    where s.doc_type='travel_order' and s.doc_id=$1 order by s.id`, [o.id]);
  res.json(o);
}));

// Each action: who may do it, from which statuses (depends on version), and the new status
const ACT = {
  record:     { role: ['hrmo'],     from: () => ['filed'],                                          to: 'recorded' },
  recommend:  { role: ['official'], from: v => v === 'sb' ? ['recorded'] : [],                      to: 'recommended' },
  approve:    { role: ['official'], from: v => v === 'sb' ? ['recommended'] : ['recorded'],         to: 'approved' },
  disapprove: { role: ['official'], from: v => v === 'sb' ? ['recorded', 'recommended'] : ['recorded'], to: 'disapproved' },
  release:    { role: ['hrmo'],     from: () => ['approved'],                                       to: 'released' }
};
app.post('/api/travel-orders/:id/:action', auth, wrap(async (req, res) => {
  const act = req.params.action, a = ACT[act];
  if (!a) return res.status(404).json({ error: 'Unknown action' });
  if (!a.role.includes(req.user.role)) return res.status(403).json({ error: 'Not allowed for your role' });
  const o = (await q('select * from travel_orders where id=$1', [req.params.id]))[0];
  if (!o) return res.status(404).json({ error: 'Not found' });
  if (!a.from(o.version).includes(o.status)) return res.status(409).json({ error: `Cannot ${act} an order that is ${o.status}` });
  const reason = String((req.body && req.body.reason) || '').trim();
  if (act === 'disapprove' && !reason) return res.status(400).json({ error: 'A reason is required' });
  const off = (await q('select id from officials where employee_id=$1 and active', [req.user.employee_id]))[0];
  if (a.role.includes('official') && !off) return res.status(403).json({ error: 'Your account is not linked to a signing official' });
  const c = await pool.connect();
  try {
    await c.query('begin');
    if (act === 'record') await c.query('select assign_travel_order_no($1)', [o.id]);   // number assigned here only
    await c.query('update travel_orders set status=$1 where id=$2', [a.to, o.id]);
    if (act === 'recommend') await c.query('update travel_orders set recommender_id=$1 where id=$2', [off.id, o.id]);
    if (act === 'approve' || act === 'disapprove') await c.query('update travel_orders set approver_id=$1 where id=$2', [off.id, o.id]);
    if (act === 'disapprove') await c.query('update travel_orders set disapproval_reason=$1 where id=$2', [reason, o.id]);
    await c.query(`insert into status_log(doc_type,doc_id,status,changed_by,remarks) values('travel_order',$1,$2,$3,$4)`, [o.id, a.to, req.user.id, reason || null]);
    await c.query('commit'); res.json({ status: a.to });
  } catch (e) { await c.query('rollback'); throw e; } finally { c.release(); }
}));

app.listen(process.env.PORT || 3000, () => console.log('HRMIS running at http://localhost:' + (process.env.PORT || 3000)));
