/* Token Launch Radar: the page. One global (window.RADAR, written by main.ts to ../data.js), no
   framework, no fetch, no network. Every view is a pure function of the data and the hash. */

(function () {
  'use strict';

  var R = window.RADAR;
  var view = document.getElementById('view');

  if (!R || !R.rows) {
    view.innerHTML = '<p class="empty">No radar data: ../data.js was not written beside the page.</p>';
    return;
  }

  // -------------------------------------------------------------- formatting

  var usdFmt = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  var numFmt = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });

  function compact(n) {
    if (n === null || n === undefined) return 'n/a';
    if (n >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (n >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (n >= 1e3) return '$' + (n / 1e3).toFixed(0) + 'K';
    return '$' + Math.round(n);
  }

  function money(n) {
    return n === null || n === undefined ? 'n/a' : usdFmt.format(n);
  }

  function pct(n) {
    if (n === null || n === undefined) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(1) + '%';
  }

  function changeClass(n) {
    if (n === null || n === undefined) return 'flat';
    if (n > 0.5) return 'up';
    if (n < -0.5) return 'down';
    return 'flat';
  }

  function esc(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // How a protocol's TVL is held: the distinction the valuation is built on.
  var KIND_LABEL = {
    protocol: 'protocol-owned TVL',
    depositor: 'depositor capital',
    chain: 'network stake',
    stable: 'pegged TVL'
  };

  function ageLabel(days) {    if (days === null || days === undefined) return 'age unknown';
    if (days < 90) return days + ' days tracked';
    if (days < 730) return Math.round(days / 30) + ' months tracked';
    return (days / 365).toFixed(1).replace('.0', '') + ' years tracked';
  }

  // -------------------------------------------------------------- state

  var byRank = R.rows.slice();
  var maxImplied = byRank.reduce(function (m, r) { return Math.max(m, r.implied_value_usd); }, 1);
  var watchlist = new Set(byRank.filter(function (r) { return r.rank <= R.watchlist_size; }).map(function (r) { return r.slug; }));

  var categories = [];
  var chains = [];
  byRank.forEach(function (r) {
    if (r.category && categories.indexOf(r.category) < 0) categories.push(r.category);
    r.chains.forEach(function (c) { if (chains.indexOf(c) < 0) chains.push(c); });
  });
  categories.sort();
  chains.sort();

  var state = { view: 'board', q: '', cat: '', chain: '', tvl: 'any', sort: 'value', watch: false, slug: null };

  // -------------------------------------------------------------- hash routing

  function readHash() {
    var h = (location.hash || '#/board').replace(/^#\/?/, '');
    var parts = h.split('?');
    var path = parts[0] || 'board';
    var qs = new URLSearchParams(parts[1] || '');
    state.q = qs.get('q') || '';
    state.cat = qs.get('cat') || '';
    state.chain = qs.get('chain') || '';
    state.tvl = qs.get('tvl') || 'any';
    state.sort = qs.get('sort') || 'value';
    state.watch = qs.get('watch') === '1';
    if (path.indexOf('p/') === 0) {
      state.view = 'detail';
      state.slug = decodeURIComponent(path.slice(2));
    } else {
      state.view = path === 'radar' || path === 'method' ? path : 'board';
      state.slug = null;
    }
  }

  function hashFor(next) {
    var s = Object.assign({}, state, next || {});
    var qs = new URLSearchParams();
    if (s.q) qs.set('q', s.q);
    if (s.cat) qs.set('cat', s.cat);
    if (s.chain) qs.set('chain', s.chain);
    if (s.tvl && s.tvl !== 'any') qs.set('tvl', s.tvl);
    if (s.sort && s.sort !== 'value') qs.set('sort', s.sort);
    if (s.watch) qs.set('watch', '1');
    var q = qs.toString();
    var path = s.view === 'detail' ? 'p/' + encodeURIComponent(s.slug) : s.view;
    return '#/' + path + (q ? '?' + q : '');
  }

  function go(next) {
    location.hash = hashFor(next);
  }

  // -------------------------------------------------------------- filtering

  function tvlBandMatch(r) {
    if (state.tvl === 'mega') return r.tvl_usd >= 1e9;
    if (state.tvl === 'large') return r.tvl_usd >= 250e6 && r.tvl_usd < 1e9;
    if (state.tvl === 'mid') return r.tvl_usd >= 50e6 && r.tvl_usd < 250e6;
    if (state.tvl === 'small') return r.tvl_usd < 50e6;
    return true;
  }

  function filtered() {
    var q = state.q.trim().toLowerCase();
    var rows = R.rows.filter(function (r) {
      if (state.cat && r.category !== state.cat) return false;
      if (state.chain && r.chains.indexOf(state.chain) < 0) return false;
      if (!tvlBandMatch(r)) return false;
      if (state.watch && !watchlist.has(r.slug)) return false;
      if (q) {
        var hay = (r.name + ' ' + (r.category || '') + ' ' + r.chains.join(' ') + ' ' + r.slug).toLowerCase();
        if (hay.indexOf(q) < 0) return false;
      }
      return true;
    });
    var sorters = {
      value: function (a, b) { return b.implied_value_usd - a.implied_value_usd; },
      readiness: function (a, b) { return b.readiness - a.readiness || b.implied_value_usd - a.implied_value_usd; },
      tvl: function (a, b) { return b.tvl_usd - a.tvl_usd; },
      momentum: function (a, b) { return (b.change_7d || -999) - (a.change_7d || -999); },
      youth: function (a, b) { return (a.age_days === null ? 1e9 : a.age_days) - (b.age_days === null ? 1e9 : b.age_days); }
    };
    return rows.sort(sorters[state.sort] || sorters.value);
  }

  function activeFilters() {
    var out = [];
    if (state.q) out.push(['Search: ' + state.q, 'q']);
    if (state.cat) out.push(['Category: ' + state.cat, 'cat']);
    if (state.chain) out.push(['Chain: ' + state.chain, 'chain']);
    if (state.tvl !== 'any') {
      var names = { mega: 'TVL over $1B', large: 'TVL $250M to $1B', mid: 'TVL $50M to $250M', small: 'TVL under $50M' };
      out.push([names[state.tvl], 'tvl']);
    }
    if (state.watch) out.push(['Watchlist only', 'watch']);
    return out;
  }

  // -------------------------------------------------------------- shell

  function renderVitals() {
    var el = document.getElementById('vitals');
    var totalImplied = R.rows.reduce(function (s, r) { return s + r.implied_value_usd; }, 0);
    var cells = [
      ['Watchlist', numFmt.format(R.watchlist_size), 'protocols at the floor'],
      ['Rows scored', numFmt.format(R.board_size), R.early_size + ' from the early radar'],
      ['Implied in all', compact(totalImplied), 'sum of the board'],
      ['Live set aside', numFmt.format(R.live_size), 'already trading']
    ];
    el.innerHTML = cells
      .map(function (c) {
        return '<div><dt>' + esc(c[0]) + '</dt><dd>' + esc(c[1]) + ' <small>' + esc(c[2]) + '</small></dd></div>';
      })
      .join('');
  }

  function renderControls() {
    var cat = document.getElementById('category');
    cat.innerHTML = '<option value="">All categories</option>' + categories.map(function (c) {
      return '<option value="' + esc(c) + '"' + (state.cat === c ? ' selected' : '') + '>' + esc(c) + '</option>';
    }).join('');
    var chain = document.getElementById('chain');
    chain.innerHTML = '<option value="">All chains</option>' + chains.map(function (c) {
      return '<option value="' + esc(c) + '"' + (state.chain === c ? ' selected' : '') + '>' + esc(c) + '</option>';
    }).join('');
    document.getElementById('search').value = state.q;
    document.getElementById('tvlband').value = state.tvl;
    document.getElementById('sort').value = state.sort;
    document.getElementById('watchonly').checked = state.watch;
    document.querySelectorAll('.tab').forEach(function (t) {
      t.classList.toggle('is-on', t.getAttribute('data-view') === state.view || (state.view === 'detail' && t.getAttribute('data-view') === 'board'));
    });
  }

  function renderChips(rows) {
    var el = document.getElementById('chips');
    var active = activeFilters();
    if (active.length === 0) {
      el.hidden = true;
      el.innerHTML = '';
      return;
    }
    el.hidden = false;
    el.innerHTML =
      active
        .map(function (a) {
          return '<span class="chip">' + esc(a[0]) + '<button type="button" data-clear="' + a[1] + '" aria-label="Clear">x</button></span>';
        })
        .join('') +
      '<span class="count">' + rows.length + ' of ' + R.rows.length + ' rows match</span>';
  }

  // -------------------------------------------------------------- board view

  function spotlight(rows) {
    var top = rows.slice(0, 3);
    if (top.length === 0) return '';
    return '<div class="spotlights">' + top.map(function (r) {
      return (
        '<article class="spot" data-slug="' + esc(r.slug) + '">' +
        '<div class="place">BOARD #' + r.rank + '</div>' +
        '<h3>' + esc(r.name) + '</h3>' +
        '<div class="sub">' + esc(r.category || 'unclassified') + ' / ' + esc(r.chains.slice(0, 2).join(', ') || 'no chain') + '</div>' +
        '<div class="figure">' + compact(r.implied_value_usd) + '<small>implied at launch</small></div>' +
        '<div class="meta">' +
        '<span>' + compact(r.tvl_usd) + ' TVL</span>' +
        '<span class="' + changeClass(r.change_7d) + '">' + pct(r.change_7d) + '</span>' +
        '<span>readiness ' + r.readiness + '</span>' +
        '</div></article>'
      );
    }).join('') + '</div>';
  }

  function rowHtml(r) {
    var width = Math.max(2, Math.round((r.implied_value_usd / maxImplied) * 100));
    var pillClass = r.readiness >= 72 ? 'pill hi' : r.readiness >= 52 ? 'pill mid' : 'pill low';
    var isNew = r.age_days !== null && r.age_days < 180;
    return (
      '<tr data-slug="' + esc(r.slug) + '">' +
      '<td class="rank">' + (r.rank <= 3 ? '<strong>' + r.rank + '</strong>' : r.rank) + '</td>' +
      '<td class="who"><div class="name">' + esc(r.name) + (isNew ? '<span class="newtag">new</span>' : '') + '</div>' +
      '<div class="tags"><span class="cat">' + esc(r.category || 'unclassified') + '</span> / ' +
      '<span class="kind k-' + esc(r.tvl_kind) + '">' + esc(KIND_LABEL[r.tvl_kind]) + '</span> / ' +
      esc(r.chains.slice(0, 2).join(' / ') || 'no chain') + '</div></td>' +
      '<td class="num">' + compact(r.tvl_usd) + '</td>' +
      '<td class="num"><span class="' + changeClass(r.change_7d) + '">' + pct(r.change_7d) + '</span></td>' +
      '<td class="num"><div class="implied"><span class="bar"><i style="width:' + width + '%"></i></span><span class="val">' + compact(r.implied_value_usd) + '</span></div></td>' +
      '<td class="num"><span class="' + pillClass + '">' + r.readiness + '</span></td>' +
      '</tr>'
    );
  }

  function viewBoard() {
    var rows = filtered();
    if (rows.length === 0) return '<p class="empty">No protocol matches these filters. Clear one to see the board again.</p>';
    var sortNames = {
      value: 'implied launch value',
      readiness: 'farm readiness',
      tvl: 'TVL',
      momentum: '7-day momentum',
      youth: 'newest listing'
    };
    var html = spotlight(rows);
    html += '<div class="block-head"><h2>Ranked board</h2><p>' + rows.length + ' of ' + R.rows.length +
      ' pre-token protocols, by ' + esc(sortNames[state.sort] || 'implied launch value') +
      '. Click a row for its case and its farm plan.</p></div>';
    html += '<table class="board"><thead><tr>' +
      '<th>Place</th><th>Protocol</th><th class="num">TVL</th><th class="num">7 days</th>' +
      '<th class="num">Implied value</th><th class="num">Readiness</th>' +
      '</tr></thead><tbody>';
    html += rows.slice(0, 120).map(rowHtml).join('');
    html += '</tbody></table>';
    if (rows.length > 120) {
      html += '<p class="empty">The board holds ' + rows.length + ' rows; the first 120 are shown. Narrow the filters to see others.</p>';
    }
    return html;
  }

  // -------------------------------------------------------------- readiness view

  function viewRadar() {
    var rows = filtered().slice().sort(function (a, b) {
      return b.readiness - a.readiness || b.implied_value_usd - a.implied_value_usd;
    });
    var html = '<div class="block-head"><h2>Farm readiness</h2><p>The same protocols, ranked on how likely a token is to ' +
      'arrive and how cheap the qualifying activity is, not on what the token might be worth.</p></div>';
    html += '<div class="grid">' + rows.slice(0, 36).map(function (r) {
      return (
        '<article class="card" data-slug="' + esc(r.slug) + '">' +
        '<div class="top"><h3>' + esc(r.name) + '</h3><span class="rank">readiness ' + r.readiness + '/100</span></div>' +
        '<div class="line">' + esc(r.rationale) + '</div>' +
        '<div class="meter"><i style="width:' + r.readiness + '%"></i></div>' +
        '<div class="foot"><span>' + compact(r.tvl_usd) + ' TVL</span><span class="' + changeClass(r.change_7d) + '">' + pct(r.change_7d) + '</span><span>' + esc(r.farm_steps.length) + ' steps</span></div>' +
        '</article>'
      );
    }).join('') + '</div>';
    return html;
  }

  // -------------------------------------------------------------- method view

  function viewMethod() {
    var sectors = Object.keys(R.sector_multiples).sort().map(function (k) {
      return '<tr><td>' + esc(k) + '</td><td class="n">' + R.sector_multiples[k].toFixed(2) + 'x</td></tr>';
    }).join('');
    return (
      '<div class="method">' +
      '<h2>What this board answers</h2>' +
      '<p>Take every protocol in the snapshot that records no token: no market cap, no CoinGecko id, no ' +
      'ticker. Those are the protocols whose launch has not happened yet. For each one the board asks a ' +
      'single question: if a token launched tomorrow, what would it be worth? The answer is an implied ' +
      'fully diluted value, with a range beside it, because one TVL reading is a thin basis for a valuation.</p>' +
      '<h2>The formula</h2>' +
      '<div class="formula">implied = TVL x sector x chain x momentum x maturity\n\n' +
      'sector    what a dollar of TVL is worth in this category, 0.12x to 0.60x\n' +
      'chain     the best chain\'s weight, plus 0.02 per extra chain, capped at 4\n' +
      'momentum  1 + (clamp(change_7d, -50, +100) / 100) x 0.45\n' +
      'maturity  0.85 + min(age_days, 1825) / 1825 x 0.35\n' +
      'range     implied x 0.65 to implied x 1.35</div>' +
      '<p>Momentum is shrunk on purpose: half of a stated weekly move is carried into the value, so one ' +
      'incentive program cannot re-price a protocol. The maturity term rewards a protocol that has held ' +
      'TVL for years over one that appeared last month, which is the order credibility actually runs in.</p>' +
      '<h2>Not all TVL is the same TVL</h2>' +
      '<p>The first thing this radar separates is how a protocol holds its TVL. Protocol-owned TVL, in a ' +
      'DEX or a lending market, is liquidity the protocol books and earns a fee on. Depositor capital, in ' +
      'a vault curator or an allocator, is money other people put there for the protocol to manage: it ' +
      'earns a management fee and leaves when the depositor leaves. Pegged TVL in a bridge or a stable ' +
      'wrapper is real, but it is not revenue, and network stake in a chain prices a network, not an app. ' +
      'The sector multiple is where that distinction lives, which is why a curator with $2.7B of ' +
      'depositor capital does not outrank an RWA issuer with a tenth of the TVL.</p>' +
      '<h2>Sector multiples</h2>' +
      '<p>Each multiple is what comparable launches in that category traded at, relative to the TVL the ' +
      'protocol carried before its token. Lending and DEXs sit in the middle; bridges and stablecoins are ' +
      'cheaper per dollar of TVL because their TVL is not their revenue.</p>' +
      '<table class="mult-table"><thead><tr><th>Category</th><th class="n">Multiple</th></tr></thead><tbody>' +
      sectors + '</tbody></table>' +
      '<h2>Readiness is a second question</h2>' +
      '<p>Value and readiness are not the same thing. A protocol can be worth a lot at launch and be a ' +
      'miserable farm, or worthless and cheap to qualify in. The readiness score weighs size, age, the ' +
      'weekly trend, the category and the chain footprint, 0 to 100, and the farm plans name a capital ' +
      'figure and a holding period for each protocol from its own record.</p>' +
      '<h2>What this model cannot see</h2>' +
      '<p>The snapshot carries ten fields and no revenue, no team, no funding, no roadmap and no token ' +
      'announcement. So the board prices TVL and its trend, and says so. Every row carries its own ' +
      'risks, and the range beside every figure is the honest part of the answer.</p>' +
      '</div>'
    );
  }

  // -------------------------------------------------------------- detail view

  function findRow(slug) {
    for (var i = 0; i < R.rows.length; i++) if (R.rows[i].slug === slug) return R.rows[i];
    return null;
  }

  /** The rows that sit either side of this one on the board: what it is being compared against. */
  function neighbours(r) {
    var at = R.rows.indexOf(r);
    var picks = [];
    for (var d = 1; d <= 3 && picks.length < 6; d++) {
      if (at - d >= 0) picks.push(R.rows[at - d]);
      if (at + d < R.rows.length && picks.length < 6) picks.push(R.rows[at + d]);
    }
    picks.sort(function (a, b) { return a.rank - b.rank; });
    return picks.map(function (n) {
      return '<li data-slug="' + esc(n.slug) + '"><span class="nrank">' + n.rank + '</span>' +
        '<span class="nname">' + esc(n.name) + '</span>' +
        '<span class="ncat">' + esc(KIND_LABEL[n.tvl_kind]) + '</span>' +
        '<span class="nval">' + compact(n.implied_value_usd) + '</span></li>';
    }).join('');
  }

  function viewDetail() {
    var r = findRow(state.slug);
    if (!r) return '<p class="empty">No protocol on the board has that slug. <button class="back" id="back">Back to the board</button></p>';
    var factors = [
      ['Sector', r.sector_multiple, 0.6],
      ['Chain', r.chain_multiplier, 1.3],
      ['Momentum', r.growth_multiplier, 1.5],
      ['Maturity', r.maturity_multiplier, 1.25]
    ];
    var waterfall = factors.map(function (f) {
      var w = Math.min(100, Math.round((f[1] / f[2]) * 100));
      return '<div class="wf-row"><span class="label">' + f[0] + '</span>' +
        '<span class="track"><i style="width:' + w + '%"></i></span>' +
        '<span class="num">' + f[1].toFixed(2) + 'x</span></div>';
    }).join('');
    var facts = [
      ['TVL', money(r.tvl_usd)],
      ['TVL kind', KIND_LABEL[r.tvl_kind] || 'protocol-owned TVL'],
      ['7-day change', pct(r.change_7d)],
      ['Age', ageLabel(r.age_days)],
      ['Listed', r.listed_at || 'unknown'],
      ['Chains', String(r.chains.length)],
      ['TVL per chain', money(r.tvl_per_chain_usd)],
      ['Readiness', r.readiness + ' / 100'],
      ['Board place', '#' + r.rank],
      ['Sector multiple', r.sector_multiple.toFixed(2) + 'x']
    ];
    var detailUrl = hashFor({ view: 'detail', slug: r.slug });
    return (
      '<div class="detail">' +
      '<button class="back" id="back" data-href="' + esc(hashFor({ view: 'board', slug: null })) + '">All protocols</button>' +
      '<div class="detail-head">' +
      '<div><h2>' + esc(r.name) + '</h2>' +
      '<div class="sub">' + esc(r.category || 'unclassified') + ' / ' + esc(r.chains.join(', ') || 'no chain') + ' / ' + esc(r.slug) + '</div></div>' +
      '<div class="hero"><div class="big">' + compact(r.implied_value_usd) + '</div>' +
      '<div class="range">range ' + compact(r.implied_low_usd) + ' to ' + compact(r.implied_high_usd) + '</div></div>' +
      '</div>' +
      '<div class="cols">' +
      '<div>' +
      '<div class="panel"><h3>The case</h3><p class="lede">' + esc(r.rationale) + '</p></div>' +
      '<div class="panel"><h3>How the value is built</h3><div class="waterfall">' + waterfall + '</div></div>' +
      '<div class="panel"><h3>What could go wrong</h3><ul class="risks">' +
      r.risks.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul></div>' +
      '<div class="panel"><h3>Neighbours on the board</h3><ul class="near">' + neighbours(r) + '</ul></div>' +
      '</div>' +
      '<div>' +
      '<div class="panel"><h3>The record</h3><dl class="facts">' +
      facts.map(function (f) { return '<div><dt>' + esc(f[0]) + '</dt><dd>' + esc(f[1]) + '</dd></div>'; }).join('') +
      '</dl></div>' +
      '<div class="panel"><h3>Farm plan</h3><ol class="steps">' +
      r.farm_steps.map(function (s) {
        return '<li><div class="text">' + esc(s.text) + '</div><div class="cost">' + esc(s.cost) + ' / ' + esc(s.time) + '</div></li>';
      }).join('') + '</ol></div>' +
      '</div></div></div>'
    );
  }

  // -------------------------------------------------------------- render

  function render() {
    readHash();
    renderControls();
    var rows = filtered();
    renderChips(rows);
    if (state.view === 'detail') view.innerHTML = viewDetail();
    else if (state.view === 'radar') view.innerHTML = viewRadar();
    else if (state.view === 'method') view.innerHTML = viewMethod();
    else view.innerHTML = viewBoard();
    var colophon = document.getElementById('colophon');
    colophon.textContent =
      'Snapshot ' + R.as_of + ' / ' + R.source + ' / model ' + R.model_version +
      ' / ' + R.rows.length + ' rows, ' + R.watchlist_size + ' on the watchlist / no network at read time';
  }

  // -------------------------------------------------------------- events

  document.getElementById('search').addEventListener('input', function (e) {
    go({ q: e.target.value, view: state.view === 'detail' ? 'board' : state.view });
  });
  document.getElementById('category').addEventListener('change', function (e) { go({ cat: e.target.value }); });
  document.getElementById('chain').addEventListener('change', function (e) { go({ chain: e.target.value }); });
  document.getElementById('tvlband').addEventListener('change', function (e) { go({ tvl: e.target.value }); });
  document.getElementById('sort').addEventListener('change', function (e) { go({ sort: e.target.value }); });
  document.getElementById('watchonly').addEventListener('change', function (e) { go({ watch: e.target.checked }); });

  document.getElementById('tabs').addEventListener('click', function (e) {
    var t = e.target.closest('.tab');
    if (t) go({ view: t.getAttribute('data-view'), slug: null });
  });

  document.getElementById('chips').addEventListener('click', function (e) {
    var b = e.target.closest('button[data-clear]');
    if (!b) return;
    var key = b.getAttribute('data-clear');
    var reset = {};
    reset[key === 'q' ? 'q' : key] = key === 'watch' ? false : '';
    go(reset);
  });

  view.addEventListener('click', function (e) {
    var back = e.target.closest('#back');
    if (back) {
      location.hash = back.getAttribute('data-href') || hashFor({ view: 'board', slug: null });
      return;
    }
    var hit = e.target.closest('[data-slug]');
    if (hit) {
      location.hash = hashFor({ view: 'detail', slug: hit.getAttribute('data-slug') });
    }
  });

  window.addEventListener('hashchange', render);
  renderVitals();
  render();
})();
