const $ = s => document.querySelector(s);
let me = null;
async function api(url, method = 'GET', body) {
  const r = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: body && JSON.stringify(body) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(d.error || 'Request failed'), { status: r.status });
  return d;
}
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const day = s => new Date(s + 'T00:00:00');
const long = s => day(s).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
const short = s => { const [y, m, d] = s.split('-'); return `${m}/${d}/${y}`; };
function range(a, b) {                       // "November 09-14, 2026" like the paper form
  if (a === b) return long(a);
  const x = day(a), y = day(b), p = n => String(n).padStart(2, '0');
  if (x.getMonth() === y.getMonth() && x.getFullYear() === y.getFullYear())
    return `${x.toLocaleDateString('en-US', { month: 'long' })} ${p(x.getDate())}-${p(y.getDate())}, ${y.getFullYear()}`;
  return `${long(a)} - ${long(b)}`;
}

async function start() {
  try { me = await api('/api/me'); } catch { me = null; }
  $('#login').hidden = !!me; $('#app').hidden = !me;
  if (!me) return;
  $('#who').textContent = `${me.username} (${me.role})`;
  $('#newBtn').hidden = !['employee', 'hrmo'].includes(me.role);
  load();
}
async function load() {
  const rows = await api('/api/travel-orders');
  $('#rows').innerHTML = rows.map(o => `<tr><td>${o.to_number ? o.to_number + ' s. ' + o.to_year : '—'}</td>
    <td>${o.version === 'sb' ? 'SB' : 'Executive'}</td><td>${esc((o.travelers || []).join('; '))}</td><td>${esc(o.destination)}</td>
    <td>${range(o.date_from, o.date_to)}</td><td><span class="st ${o.status}">${o.status}</span></td>
    <td><button data-id="${o.id}">Open</button></td></tr>`).join('') || '<tr><td colspan="7">No travel orders yet.</td></tr>';
}

function actionsFor(o) {
  const hr = me.role === 'hrmo', of = me.role === 'official', sb = o.version === 'sb', out = [];
  if (hr && o.status === 'filed') out.push(['record', 'Record and number']);
  if (of && sb && o.status === 'recorded') out.push(['recommend', 'Recommend'], ['disapprove', 'Disapprove']);
  if (of && o.status === (sb ? 'recommended' : 'recorded')) out.push(['approve', 'Approve'], ['disapprove', 'Disapprove']);
  if (hr && o.status === 'approved') out.push(['release', 'Release']);
  return out;
}
async function openOrder(id) {
  const o = await api('/api/travel-orders/' + id);
  const conflict = o.conflicts.length ? `<p class="warn">Warning: a traveler has approved leave that overlaps these dates (${o.conflicts.map(c => range(c.date_from, c.date_to)).join('; ')}).</p>` : '';
  $('#detail').innerHTML = `<h3>${o.to_number ? 'T.O. No. ' + o.to_number + ' s. ' + o.to_year : 'Not yet numbered'} <span class="st ${o.status}">${o.status}</span></h3>
    <p><b>Version:</b> ${o.version === 'sb' ? 'Sangguniang Bayan' : 'Executive'}<br><b>Destination:</b> ${esc(o.destination)}<br>
    <b>Date:</b> ${range(o.date_from, o.date_to)}<br><b>Purpose:</b> ${esc(o.purpose)}</p>
    <p><b>Travelers:</b></p><ul>${o.travelers.map(t => `<li>${esc(t.name)}, ${esc(t.position)}</li>`).join('')}</ul>${conflict}
    ${o.disapproval_reason ? `<p><b>Disapproved:</b> ${esc(o.disapproval_reason)}</p>` : ''}
    <div class="actions">${actionsFor(o).map(([a, l]) => `<button class="primary" data-act="${a}">${l}</button>`).join('')}
    ${o.to_number ? '<button data-print>Print</button>' : ''}</div>
    <p><b>History</b></p><ul class="log">${o.log.map(l => `<li>${new Date(l.changed_at).toLocaleString()}: ${l.status} by ${esc(l.username)}${l.remarks ? ' (' + esc(l.remarks) + ')' : ''}</li>`).join('')}</ul>`;
  $('#detail').onclick = async e => {
    const a = e.target.dataset.act;
    if (e.target.hasAttribute('data-print')) return printOrder(o);
    if (!a) return;
    let reason = '';
    if (a === 'disapprove') { reason = prompt('Reason for disapproval:'); if (!reason) return; }
    try { await api(`/api/travel-orders/${id}/${a}`, 'POST', { reason }); await load(); openOrder(id); }
    catch (err) { alert(err.message); }
  };
  $('#dlg').showModal();
}

function printOrder(o) {
  const sig = (n, t) => `<div class="sg"><b>${esc(n)}</b><br>${esc(t)}</div>`;
  const sb = o.version === 'sb';
  $('#printArea').innerHTML = `<div class="ph"><div>OFFICE OF THE MUNICIPAL MAYOR</div><div>REPUBLIC OF THE PHILIPPINES<br>PROVINCE OF NUEVA VIZCAYA<br>MUNICIPALITY OF BAMBANG</div></div>
    <p class="ito">T.O. No. ${o.to_number} s. ${o.to_year}</p><h2>TRAVEL ORDER</h2><p class="rt">${short(o.order_date)}</p>
    <table>${o.travelers.map(t => `<tr><td>${esc(t.name)}</td><td>${esc(t.position)}</td></tr>`).join('')}</table>
    <p>This Municipality</p><p>You are hereby authorized to undertake an official trip:</p>
    <dl><dt>DESTINATION</dt><dd>: ${esc(o.destination)}</dd><dt>DATE</dt><dd>: ${range(o.date_from, o.date_to)}</dd><dt>PURPOSE</dt><dd>: ${esc(o.purpose)}</dd></dl>
    <p>${esc(o.expense_statement)}</p>
    <div class="sigs"><div>${sb ? '<p>Recommending Approval:</p>' + sig(o.rec_name || '', o.rec_title || '') : ''}</div>
    <div>${sb ? '<p>Approved:</p>' : ''}${sig(o.app_name || '', o.app_title || '')}</div></div>`;
  window.print();
}

$('#loginForm').onsubmit = async e => {
  e.preventDefault(); $('#loginErr').textContent = '';
  try { await api('/api/login', 'POST', Object.fromEntries(new FormData(e.target))); e.target.reset(); start(); }
  catch (err) { $('#loginErr').textContent = err.message; }
};
$('#logout').onclick = async () => { await api('/api/logout', 'POST'); start(); };
$('#rows').onclick = e => e.target.dataset.id && openOrder(e.target.dataset.id);
$('#dlgClose').onclick = () => $('#dlg').close();
$('#newBtn').onclick = async () => {
  const emps = await api('/api/employees');
  $('#trav').innerHTML = emps.map(x => `<option value="${x.id}">${esc(x.name)} (${esc(x.position)})</option>`).join('');
  $('#newErr').textContent = ''; $('#newDlg').showModal();
};
$('#newCancel').onclick = () => $('#newDlg').close();
$('#newForm').onsubmit = async e => {
  e.preventDefault();
  const f = new FormData(e.target), body = Object.fromEntries(f);
  body.travelers = f.getAll('travelers');
  try { await api('/api/travel-orders', 'POST', body); e.target.reset(); $('#newDlg').close(); load(); }
  catch (err) { $('#newErr').textContent = err.message; }
};
start();
