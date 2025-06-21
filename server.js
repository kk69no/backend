const API = 'https://backend-2wm0.onrender.com';
Telegram.WebApp.ready();

const user = Telegram.WebApp.initDataUnsafe?.user || {};
const userHeaders = {
  'X-Telegram-User-ID': user?.id || 999999,
  'X-Telegram-Username': user?.username || "demo_user",
  'X-Telegram-Photo': user?.photo_url || ""
};

let circles = [];
let chartInstance = null;

document.getElementById('deal-form').onsubmit = async (e) => {
  e.preventDefault();
  const type = document.getElementById("type").value;
  const amount = parseFloat(document.getElementById("amount").value);
  const currency = document.getElementById("currency").value.trim();
  const price = parseFloat(document.getElementById("price").value);
  const note = document.getElementById("note").value.trim();

  if (!amount || (type === "sell" && (!currency || !price))) return alert("Заполните поля корректно");

  try {
    if (type === "buy") {
      await fetch(`${API}/circles`, {
        method: "POST",
        headers: { 'Content-Type': 'application/json', ...userHeaders },
        body: JSON.stringify({ buyAmount: amount })
      });

    } else {
      const sel = document.getElementById("circleSelect");
      const circle = circles[sel.selectedIndex];
      if (!circle) return alert("Выберите круг");

      const saleValue = amount * price;
      if (saleValue > circle.buyamount * 5) {
        if (!confirm("Сделка превышает 5x вложений – продолжить?")) return;
      }

      await fetch(`${API}/circles/${circle.id}/sells`, {
        method: "POST",
        headers: { 'Content-Type': 'application/json', ...userHeaders },
        body: JSON.stringify({ amount, currency, price, note })
      });
    }

    ['amount','currency','price','note'].forEach(id => document.getElementById(id).value = '');
    await loadCircles();

  } catch (err) { alert("Ошибка: " + err.message); }
};

async function loadCircles() {
  const res = await fetch(`${API}/circles`, { headers: userHeaders });
  circles = await res.json();
  renderCircles();
  drawChart();
}

function renderCircles() {
  const wrap = document.getElementById("circles");
  const select = document.getElementById("circleSelect");
  wrap.innerHTML = '';
  select.innerHTML = '';

  circles.forEach((c, i) => {
    const bought = parseFloat(c.buyamount);
    let totalAsset = 0, revenue = 0;

    c.sells.forEach(s => {
      const amt = parseFloat(s.amount), pr = parseFloat(s.price);
      totalAsset += amt;
      revenue += amt * pr;
    });

    const pnl = revenue - bought;
    const percent = bought ? Math.min(100, Math.round(revenue / bought * 100 * 10)/10) : 0;

    const currencyLabel = c.sells[0]?.currency || '';
    const card = document.createElement("div");
    card.className = "card";
    card.innerHTML = `
      <b>Круг #${i + 1}</b><br>
      Куплено: ${bought.toLocaleString()}₽<br>
      Продано: ${totalAsset.toLocaleString()} ${currencyLabel}<br>
      Выручка: ${revenue.toLocaleString()}₽<br>
      PnL: ${pnl.toLocaleString()}₽<br>
      Выполнено: ${percent}%<br>
      <ul>${c.sells.map(s =>
        `<li>${parseFloat(s.amount).toLocaleString()} ${s.currency} × ${parseFloat(s.price).toLocaleString()}₽ — ${s.note || ''}</li>`
      ).join("")}</ul>
      <button onclick="deleteCircle(${c.id})">Удалить</button>
    `;
    wrap.appendChild(card);

    const opt = document.createElement("option");
    opt.textContent = `Круг #${i + 1}`;
    select.appendChild(opt);
  });
}

async function deleteCircle(id) {
  await fetch(`${API}/circles/${id}`, {
    method: "DELETE",
    headers: userHeaders
  });
  await loadCircles();
}

function drawChart() {
  const ctx = document.getElementById("mainChart").getContext("2d");
  if (chartInstance) chartInstance.destroy();

  const labels = circles.map((_,i) => `Круг #${i+1}`);
  const revenue = circles.map(c =>
    c.sells.reduce((sum,s) => sum + parseFloat(s.amount)*parseFloat(s.price),0)
  );
  const pnl = revenue.map((r,i) => r - parseFloat(circles[i].buyamount));

  chartInstance = new Chart(ctx, {
    type: "bar",
    data: { labels, datasets: [
      { label:"Выручка", data: revenue, backgroundColor:"#4caf50"},
      { label:"Прибыль", data: pnl, backgroundColor:"#2196f3"}
    ]},
    options: { responsive: true, plugins:{legend:{position:"bottom"}} }
  });
}

document.querySelectorAll(".tab").forEach(tab => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach(t=>t.classList.remove("active"));
    document.querySelectorAll(".tab-content").forEach(c=>c.classList.remove("active"));
    tab.classList.add("active");
    document.getElementById(tab.dataset.tab).classList.add("active");
  });
});

loadCircles();
