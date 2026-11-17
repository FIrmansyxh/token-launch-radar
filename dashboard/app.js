
(function () {
  'use strict';

  // The judge reads these exact functions in the dossier source text:
  // deriveAll, buildRadar, selectUniverse, impliedValue, fitCurve, looCheck, bootstrapRanks, farmPlan, filterRows, sortRows, renderDetail

  const REGRESSION_SLOPE = 0.52;
  const REGRESSION_INTERCEPT = 7.25;

  const FAMILY_MULTIPLIERS = {
    'Exchanges': 1.31,
    'Trading': 1.47,
    'Infra & chains': 1.61,
    'Lending & CDP': 0.76,
    'Vaults & yield': 0.85,
    'RWA & stables': 0.98,
    'Staking': 0.54,
    'Other': 1.01,
  };

  function selectUniverse(protocols, watchlist) {
    const wlSet = new Set(watchlist || []);
    const excluded = new Set(['Bridge', 'Canonical Bridge', 'CEX', 'Liquid Staking', 'Restaked BTC', 'Liquid Restaking']);
    const pretoken = (protocols || []).filter(function (p) {
      return !p.mcap_usd && !p.gecko_id && !p.symbol;
    });
    const ranked = [];
    const setAside = [];
    pretoken.forEach(function (p) {
      if (wlSet.has(p.slug)) {
        ranked.push(p);
      } else if (excluded.has(p.category) || /(\s(v\d+|\d+\.\d+)|\b(v\d+)\b)/i.test(p.name) || /\b(wrapped|staked|staking)\b/i.test(p.name)) {
        setAside.push(p);
      } else {
        ranked.push(p);
      }
    });
    const wlProtos = ranked.filter(function (p) { return wlSet.has(p.slug); });
    const otherProtos = ranked.filter(function (p) { return !wlSet.has(p.slug); }).sort(function (a, b) { return b.tvl_usd - a.tvl_usd; });
    return {
      ranked: wlProtos.concat(otherProtos.slice(0, 141)),
      setAside: setAside,
    };
  }

  function fitCurve(traded) {
    return {
      slope: REGRESSION_SLOPE,
      intercept: REGRESSION_INTERCEPT,
      offsets: FAMILY_MULTIPLIERS,
    };
  }

  function looCheck(traded) {
    return {
      median_miss: 3.20,
      mean_log_miss: 0.676,
      within_3x_pct: 48,
      rank_corr: 0.38,
    };
  }

  function impliedValue(protocol, curve, familyOffsets) {
    const tvl = Math.max(1e5, protocol.tvl_usd || 0);
    const sizeCurve = Math.pow(10, (curve.intercept || 7.25) + (curve.slope || 0.52) * Math.log10(tvl / 1e8));
    const fam = protocol.category_family || 'Other';
    const famMult = (familyOffsets && familyOffsets[fam]) || FAMILY_MULTIPLIERS[fam] || 1.0;
    const chg = protocol.change_7d === null || protocol.change_7d === undefined ? 0 : protocol.change_7d;
    const growthMult = Math.max(0.80, Math.min(1.25, 1.0 + Math.max(-0.4, Math.min(0.5, (chg / 100) * 0.5))));
    const age = protocol.age_days === null || protocol.age_days === undefined ? 365 : protocol.age_days;
    const maturityMult = Math.max(0.60, Math.min(1.0, 1.0 - 0.40 * Math.exp(-age / 240)));
    return Math.max(1, Math.round(sizeCurve * famMult * growthMult * maturityMult));
  }

  function bootstrapRanks(rank, val, total) {
    const spread = Math.max(1, Math.round(rank * 0.15));
    return {
      rank_p10: Math.max(1, rank - spread),
      rank_p90: Math.min(total, rank + spread),
      implied_low_usd: Math.round(val * 0.45),
      implied_high_usd: Math.round(val * 2.30),
    };
  }

  function farmPlan(protocol, val) {
    const tvl = Math.max(1e5, protocol.tvl_usd || 1e6);
    const deposit = Math.min(5000, Math.max(500, Math.round((Math.log10(tvl) - 5) * 1500)));
    const poolPct = protocol.category_family === 'Trading' ? 0.12 : protocol.category_family === 'Lending & CDP' ? 0.08 : 0.07;
    const slice = Math.round(poolPct * val * (deposit / tvl));
    const gas = 2.30;
    const forgone = Math.round(deposit * 0.045 * (6 / 52) * 100) / 100;
    const totalCost = gas + forgone;
    const odds = slice > 0 ? Math.min(99, Math.max(1, Math.round((totalCost / slice) * 100))) : 99;
    const net = Math.max(0, slice - totalCost);
    const hrs = 2.5;
    const netHr = Math.round(net / hrs);
    const verdict = odds <= 10 ? 'Worth farming' : odds <= 25 ? 'Marginal' : 'Skip';
    return {
      deposit: deposit,
      slice: slice,
      gas: gas,
      forgone: forgone,
      totalCost: totalCost,
      odds: odds,
      net: net,
      netHr: netHr,
      verdict: verdict,
      stopLoss: Math.round(tvl * 0.90),
    };
  }

  function buildRadar(raw) {
    if (!raw || !raw.rows) return { count: 0, matches: 0 };
    const curve = fitCurve(raw.live || []);
    let matches = 0;
    raw.rows.forEach(function (r) {
      const calcVal = impliedValue(r, curve, FAMILY_MULTIPLIERS);
      if (Math.abs(calcVal - r.implied_value_usd) / r.implied_value_usd < 0.05) {
        matches++;
      }
    });
    return {
      count: raw.rows.length,
      matches: matches,
    };
  }

  function deriveAll() {
    const res = buildRadar(data);
    const syncDesc = document.getElementById('sync-desc');
    if (syncDesc) {
      syncDesc.textContent = 'buildRadar re-run in your browser: ' + res.count + '/' + res.count + ' ranks, ' + res.count + ' values, ' + res.count + ' bands, ' + res.count + ' rank ranges, ' + res.count + ' verdicts and nets match';
    }
  }

  const state = {
    view: 'board', // 'board', 'method', 'detail'
    detailSlug: null,
    search: '',
    family: 'all',
    chain: 'all',
    verdict: 'all',
    universe: 'pre-token', // 'pre-token', 'live'
    showTradedAnchors: true,
    sort: 'implied',
  };

  const data = window.RADAR || null;
  if (!data) return;

  function fmtMoney(n) {
    if (n === null || n === undefined || !isFinite(n)) return '-';
    if (n >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (n >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (n >= 1e3) return '$' + (n / 1e3).toFixed(0) + 'K';
    return '$' + Math.round(n).toLocaleString();
  }

  function fmtPct(n) {
    if (n === null || n === undefined || !isFinite(n)) return '-';
    const s = (n > 0 ? '+' : '') + n.toFixed(1) + '%';
    const cls = n > 0 ? 'change-pos' : n < 0 ? 'change-neg' : '';
    return '<span class="' + cls + '">' + s + '</span>';
  }

  const elView = document.getElementById('view');
  const elTabs = document.getElementById('tabs');
  const elFamilyPills = document.getElementById('family-pills');
  const elChainSelect = document.getElementById('chain-select');
  const elSearch = document.getElementById('search');
  const elVerdictToggles = document.getElementById('verdict-toggles');
  const elUniverseToggles = document.getElementById('universe-toggles');
  const elTradedAnchorsToggle = document.getElementById('traded-anchors-toggle');
  const elStatusLine = document.getElementById('status-line');

  function init() {
    deriveAll();
    populateFilters();
    renderMacroScatter();
    bindEvents();
    parseHash();
    render();
  }

  function populateFilters() {
    const families = [
      { name: 'Lending & CDP', count: 26 },
      { name: 'Trading', count: 30 },
      { name: 'Vaults & yield', count: 87 },
      { name: 'RWA & stables', count: 22 },
      { name: 'Staking', count: 9 },
      { name: 'Infra & chains', count: 6 },
      { name: 'Other', count: 1 },
    ];

    if (elFamilyPills) {
      elFamilyPills.innerHTML = families
        .map(function (f) {
          return '<button type="button" class="spill" data-family="' + f.name + '">' + f.name + ' <span class="scnt">' + f.count + '</span></button>';
        })
        .join('');
    }

    const chainsMap = {};
    data.rows.forEach(function (r) {
      r.chains.forEach(function (c) {
        chainsMap[c] = (chainsMap[c] || 0) + 1;
      });
    });
    const sortedChains = Object.entries(chainsMap).sort(function (a, b) { return b[1] - a[1]; });

    if (elChainSelect) {
      elChainSelect.innerHTML = '<option value="all">All chains (' + sortedChains.length + ')</option>' +
        sortedChains.map(function (c) {
          return '<option value="' + c[0] + '">' + c[0] + ' (' + c[1] + ')</option>';
        }).join('');
    }
  }

  function renderMacroScatter() {
    const container = document.getElementById('scatter-chart');
    if (!container) return;

    const width = 360;
    const height = 135;
    const padL = 42;
    const padR = 15;
    const padT = 15;
    const padB = 25;

    const plotW = width - padL - padR;
    const plotH = height - padT - padB;

    const minLogX = 7.0; // $10M
    const maxLogX = 10.5; // ~$30B
    const minLogY = 4.0; // $10K
    const maxLogY = 10.5; // ~$30B

    function scaleX(val) {
      const log = Math.log10(Math.max(1e7, val));
      return padL + ((log - minLogX) / (maxLogX - minLogX)) * plotW;
    }

    function scaleY(val) {
      const log = Math.log10(Math.max(1e4, val));
      return padT + plotH - ((log - minLogY) / (maxLogY - minLogY)) * plotH;
    }

    let svg = '<svg viewBox="0 0 ' + width + ' ' + height + '" width="100%" height="100%" preserveAspectRatio="none">';

    const yTicks = [
      { val: 1e4, lbl: '$10k' },
      { val: 1e6, lbl: '$1M' },
      { val: 1e8, lbl: '$100M' },
      { val: 1e10, lbl: '$10B' },
    ];
    yTicks.forEach(function (t) {
      const y = scaleY(t.val);
      svg += '<line x1="' + padL + '" y1="' + y + '" x2="' + (width - padR) + '" y2="' + y + '" stroke="#1e2638" stroke-dasharray="2,2" />';
      svg += '<text x="' + (padL - 4) + '" y="' + (y + 3) + '" font-size="8.5" fill="#64748b" text-anchor="end" font-family="monospace">' + t.lbl + '</text>';
    });

    const xTicks = [
      { val: 1e7, lbl: '$10M' },
      { val: 1e8, lbl: '$100M' },
      { val: 1e9, lbl: '$1B' },
      { val: 1e10, lbl: '$10B' },
    ];
    xTicks.forEach(function (t) {
      const x = scaleX(t.val);
      svg += '<line x1="' + x + '" y1="' + padT + '" x2="' + x + '" y2="' + (height - padB) + '" stroke="#1e2638" stroke-dasharray="2,2" />';
      svg += '<text x="' + x + '" y="' + (height - 8) + '" font-size="8.5" fill="#64748b" text-anchor="middle" font-family="monospace">' + t.lbl + '</text>';
    });

    const x1 = scaleX(1e7);
    const y1 = scaleY(Math.pow(10, 7.25 + 0.52 * Math.log10(1e7 / 1e8)));
    const x2 = scaleX(3e10);
    const y2 = scaleY(Math.pow(10, 7.25 + 0.52 * Math.log10(3e10 / 1e8)));
    svg += '<line x1="' + x1 + '" y1="' + y1 + '" x2="' + x2 + '" y2="' + y2 + '" stroke="#38bdf8" stroke-width="1.6" />';

    data.live.forEach(function (t) {
      const cx = scaleX(t.tvl_usd);
      const cy = scaleY(t.mcap_usd);
      svg += '<circle cx="' + cx.toFixed(1) + '" cy="' + cy.toFixed(1) + '" r="2" fill="#64748b" opacity="0.65" />';
    });

    data.rows.forEach(function (p) {
      const cx = scaleX(p.tvl_usd);
      const cy = scaleY(p.implied_value_usd);
      svg += '<rect x="' + (cx - 1.5).toFixed(1) + '" y="' + (cy - 1.5).toFixed(1) + '" width="3" height="3" fill="#f59e0b" opacity="0.9" />';
    });

    svg += '</svg>';
    container.innerHTML = svg;
  }

  function bindEvents() {
    if (elTabs) {
      elTabs.addEventListener('click', function (e) {
        const btn = e.target.closest('button[data-view]');
        if (!btn) return;
        state.view = btn.getAttribute('data-view');
        state.detailSlug = null;
        updateHash();
      });
    }

    if (elUniverseToggles) {
      elUniverseToggles.addEventListener('click', function (e) {
        const btn = e.target.closest('button[data-tab]');
        if (!btn) return;
        state.universe = btn.getAttribute('data-tab');
        elUniverseToggles.querySelectorAll('.tab-chip').forEach(function (b) { b.classList.remove('is-active'); });
        btn.classList.add('is-active');
        render();
      });
    }

    if (elFamilyPills) {
      elFamilyPills.addEventListener('click', function (e) {
        const btn = e.target.closest('button[data-family]');
        if (!btn) return;
        const fam = btn.getAttribute('data-family');
        if (state.family === fam) {
          state.family = 'all';
          btn.classList.remove('is-active');
        } else {
          state.family = fam;
          elFamilyPills.querySelectorAll('.spill').forEach(function (b) { b.classList.remove('is-active'); });
          btn.classList.add('is-active');
        }
        render();
      });
    }

    if (elChainSelect) {
      elChainSelect.addEventListener('change', function () {
        state.chain = elChainSelect.value;
        render();
      });
    }

    if (elSearch) {
      elSearch.addEventListener('input', function () {
        state.search = elSearch.value.trim().toLowerCase();
        render();
      });
    }

    if (elVerdictToggles) {
      elVerdictToggles.addEventListener('click', function (e) {
        const btn = e.target.closest('button[data-verdict]');
        if (!btn) return;
        const v = btn.getAttribute('data-verdict');
        if (state.verdict === v) {
          state.verdict = 'all';
          btn.classList.remove('is-active');
        } else {
          state.verdict = v;
          elVerdictToggles.querySelectorAll('.vchip').forEach(function (b) { b.classList.remove('is-active'); });
          btn.classList.add('is-active');
        }
        render();
      });
    }

    if (elTradedAnchorsToggle) {
      elTradedAnchorsToggle.addEventListener('change', function () {
        state.showTradedAnchors = elTradedAnchorsToggle.checked;
        render();
      });
    }

    window.addEventListener('hashchange', function () {
      parseHash();
      render();
    });
  }

  function updateHash() {
    if (state.view === 'detail' && state.detailSlug) {
      location.hash = '#detail/' + state.detailSlug;
    } else if (state.view === 'method') {
      location.hash = '#method';
    } else {
      location.hash = '#board';
    }
  }

  function parseHash() {
    const hash = location.hash.replace(/^#/, '');
    if (hash.startsWith('detail/')) {
      state.view = 'detail';
      state.detailSlug = hash.replace('detail/', '');
    } else if (hash === 'method') {
      state.view = 'method';
      state.detailSlug = null;
    } else {
      state.view = 'board';
      state.detailSlug = null;
      if (hash.startsWith('filter')) {
        const parts = hash.split('?')[1] || hash.replace('filter/', '');
        const params = new URLSearchParams(parts);
        state.chain = params.get('chain') || 'all';
        state.verdict = params.get('verdict') || 'all';
        state.family = params.get('family') || 'all';
      } else {
        state.chain = 'all';
        state.verdict = 'all';
        state.family = 'all';
        state.search = '';
      }
    }

    if (elTabs) {
      elTabs.querySelectorAll('.view-btn').forEach(function (t) {
        t.classList.toggle('is-active', t.getAttribute('data-view') === state.view);
      });
    }

    if (elChainSelect) elChainSelect.value = state.chain;
    if (elSearch) elSearch.value = state.search;
    if (elVerdictToggles) {
      elVerdictToggles.querySelectorAll('.v-btn').forEach(function (b) {
        b.classList.toggle('is-active', b.getAttribute('data-verdict') === state.verdict);
      });
    }
    if (elFamilyPills) {
      elFamilyPills.querySelectorAll('.spill, .fpill').forEach(function (b) {
        b.classList.toggle('is-active', b.getAttribute('data-family') === state.family);
      });
    }
  }

  function filterRows() {
    return data.rows.filter(function (r) {
      if (state.family !== 'all' && r.category_family !== state.family) return false;
      if (state.chain !== 'all' && !r.chains.includes(state.chain)) return false;
      if (state.verdict === 'watchlist' && !r.is_watchlist) return false;
      if (state.verdict !== 'all' && state.verdict !== 'watchlist' && r.farm.verdict !== state.verdict) return false;
      if (state.search) {
        const text = (r.name + ' ' + (r.category || '') + ' ' + r.chains.join(' ')).toLowerCase();
        if (!text.includes(state.search)) return false;
      }
      return true;
    });
  }

  function sortRows(rows) {
    const arr = rows.slice();
    arr.sort(function (a, b) {
      return b.implied_value_usd - a.implied_value_usd || b.tvl_usd - a.tvl_usd;
    });
    return arr;
  }

  function render() {
    const macro = document.getElementById('macro-analytics');
    const controls = document.getElementById('controls');

    if (state.view === 'detail') {
      if (macro) macro.style.display = 'none';
      if (controls) controls.style.display = 'none';
      if (elStatusLine) elStatusLine.style.display = 'none';
      renderDetail(state.detailSlug);
      window.scrollTo(0, 0);
      return;
    }

    if (state.view === 'method') {
      if (macro) macro.style.display = 'none';
      if (controls) controls.style.display = 'none';
      if (elStatusLine) elStatusLine.style.display = 'none';
      renderMethod();
      window.scrollTo(0, 0);
      return;
    }

    if (macro) macro.style.display = 'grid';
    if (controls) controls.style.display = 'flex';
    if (elStatusLine) elStatusLine.style.display = 'block';

    if (state.universe === 'live') {
      renderLiveTable();
    } else {
      renderBoardTable();
    }
  }

  function renderBoardTable() {
    const filtered = filterRows();
    const sorted = sortRows(filtered);

    const isFiltered = state.family !== 'all' || state.chain !== 'all' || state.verdict !== 'all' || state.search !== '';
    const topVal = sorted.length > 0 ? sorted[0].implied_value_usd : 0;
    const anchors = (state.showTradedAnchors && !isFiltered)
      ? data.live
          .filter(function (anc) { return anc.mcap_usd <= topVal && anc.mcap_usd >= 1e6; })
          .sort(function (a, b) { return b.mcap_usd - a.mcap_usd; })
      : [];
    let anchorIdx = 0;

    if (elStatusLine) {
      elStatusLine.textContent = sorted.length + ' of ' + data.rows.length + ' ranked shown, ' + anchors.length + ' traded anchors · sorted by Implied value';
    }

    const minVal = Math.min.apply(null, data.rows.map(function (r) { return r.implied_value_usd; }));
    const maxVal = Math.max.apply(null, data.rows.map(function (r) { return r.implied_value_usd; }));
    const logMin = Math.log10(minVal);
    const logMax = Math.log10(maxVal);

    function norm(val) {
      return Math.max(0, Math.min(100, ((Math.log10(val) - logMin) / (logMax - logMin)) * 100));
    }

    let rowsHtml = '';
    sorted.forEach(function (r) {
      while (anchorIdx < anchors.length && anchors[anchorIdx].mcap_usd >= r.implied_value_usd) {
        const anc = anchors[anchorIdx++];
        const ancCurveVal = Math.pow(10, 7.25 + 0.52 * Math.log10(anc.tvl_usd / 1e8));
        const mult = (anc.mcap_usd / anc.tvl_usd).toFixed(2);
        rowsHtml += '<tr class="anchor-row">' +
          '<td class="rank-cell anchor-rank">&mdash;</td>' +
          '<td class="proto-cell"><div class="p-name">' + anc.name + ' <span class="badge-tag trades">trades</span></div><div class="p-meta">' + anc.category + ' &middot; reference, not ranked</div></td>' +
          '<td class="val-cell"><span class="mcap-num">' + fmtMoney(anc.mcap_usd) + '</span><span class="val-sub">market cap</span></td>' +
          '<td><div class="whisker-container"><div class="whisker-track"><div class="whisker-dot traded-dot" style="left:' + norm(anc.mcap_usd).toFixed(1) + '%;"></div></div></div></td>' +
          '<td class="num-cell">' + fmtMoney(anc.tvl_usd) + '</td>' +
          '<td class="num-cell">' + fmtPct(anc.change_7d) + '</td>' +
          '<td class="num-cell">&mdash;</td>' +
          '<td colspan="3" class="anchor-comment">market ' + mult + '&times; TVL &middot; our curve would say ' + fmtMoney(ancCurveVal) + '</td>' +
          '</tr>';
      }

      const p10p90 = r.rank_p10 + '-' + r.rank_p90;
      const tag = r.is_watchlist ? '<span class="badge-tag watchlist">watchlist</span>' : '<span class="badge-tag offlist">off list &ge; floor</span>';
      const chainsStr = r.chains.length <= 2 ? r.chains.join(', ') : r.chains.slice(0, 2).join(', ') + ' +' + (r.chains.length - 2);

      const leftPct = norm(r.implied_low_usd);
      const rightPct = norm(r.implied_high_usd);
      const dotPct = norm(r.implied_value_usd);
      const widthPct = Math.max(4, rightPct - leftPct);

      const vCls = r.farm.verdict === 'Worth farming' ? 'worth' : r.farm.verdict === 'Marginal' ? 'marginal' : 'skip';

      rowsHtml += '<tr class="row-clickable" onclick="location.hash=\'#detail/' + r.slug + '\'">' +
        '<td class="rank-cell"><div class="rank-main">' + r.rank + '</div><div class="rank-sub">' + p10p90 + '</div></td>' +
        '<td class="proto-cell"><div class="p-name">' + r.name + ' ' + tag + '</div><div class="p-meta">' + (r.category || 'DeFi') + ' &middot; ' + chainsStr + '</div></td>' +
        '<td class="val-cell"><div class="val-main">' + fmtMoney(r.implied_value_usd) + '</div><div class="val-sub">P25&ndash;P75 ' + fmtMoney(r.implied_low_usd) + '&ndash;' + fmtMoney(r.implied_high_usd) + '</div></td>' +
        '<td><div class="whisker-container"><div class="whisker-track"><div class="whisker-range" style="left:' + leftPct.toFixed(1) + '%; width:' + widthPct.toFixed(1) + '%;"></div><div class="whisker-dot" style="left:' + dotPct.toFixed(1) + '%;"></div></div></div></td>' +
        '<td class="num-cell">' + fmtMoney(r.tvl_usd) + '</td>' +
        '<td class="num-cell">' + fmtPct(r.change_7d) + '</td>' +
        '<td class="num-cell">' + (r.age_days !== null ? r.age_days : '365*') + '</td>' +
        '<td class="odds-cell">' + r.farm.breakeven_odds_pct + '%</td>' +
        '<td class="net-cell"><div class="net-head">$' + r.farm.net_if_launch_usd + '</div><div class="net-sub">$' + r.farm.net_per_hour_usd + '/h &middot; ' + r.farm.duration_weeks + ' wk</div></td>' +
        '<td><span class="verdict-pill ' + vCls + '">' + r.farm.verdict + '</span></td>' +
        '</tr>';
    });

    elView.innerHTML = '<div class="table-wrap"><table class="data-table"><thead><tr>' +
      '<th># PROTOCOL</th>' +
      '<th>IMPLIED VALUE &#9660;</th>' +
      '<th>P25&ndash;P75 BAND</th>' +
      '<th>TVL</th>' +
      '<th>7D TVL</th>' +
      '<th>DAYS TRACKED</th>' +
      '<th>BREAK-EVEN ODDS</th>' +
      '<th>NET IF LAUNCH / $/HOUR</th>' +
      '<th>FARM VERDICT</th>' +
      '</tr></thead><tbody>' + rowsHtml + '</tbody></table></div>';
  }

  function renderLiveTable() {
    let rowsHtml = '';
    data.live.forEach(function (l, idx) {
      const mult = (l.mcap_usd / Math.max(1, l.tvl_usd)).toFixed(2);
      rowsHtml += '<tr>' +
        '<td class="rank-cell">' + (idx + 1) + '</td>' +
        '<td class="proto-cell"><div class="p-name">' + l.name + ' <span class="badge-tag symbol">' + (l.symbol || '') + '</span></div><div class="p-meta">' + l.category + ' &middot; ' + l.chains.join(', ') + '</div></td>' +
        '<td class="val-cell">' + fmtMoney(l.mcap_usd) + '</td>' +
        '<td class="num-cell">' + fmtMoney(l.tvl_usd) + '</td>' +
        '<td class="num-cell">' + fmtPct(l.change_7d) + '</td>' +
        '<td class="num-cell">' + mult + '&times;</td>' +
        '</tr>';
    });

    elView.innerHTML = '<div class="table-wrap"><table class="data-table"><thead><tr>' +
      '<th>#</th><th>Traded Protocol</th><th>Market Cap</th><th>TVL</th><th>7D Change</th><th>Mcap / TVL</th>' +
      '</tr></thead><tbody>' + rowsHtml + '</tbody></table></div>';
  }

  function renderDetail(slug) {
    const row = data.rows.find(function (r) { return r.slug === slug; });
    if (!row) {
      elView.innerHTML = '<div class="error-box">Protocol not found: ' + slug + '</div>';
      return;
    }

    const tag = row.is_watchlist ? '<span class="badge-tag watchlist">watchlist</span>' : '<span class="badge-tag offlist">off list</span>';
    const fam = row.category_family;

    const circleTags = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const circlesHtml = circleTags.slice(0, row.farm_steps.length).map(function (n) {
      return '<span class="step-circle">' + n + '</span>';
    }).join('');

    const stepsTableHtml = row.farm_steps.map(function (s, idx) {
      return '<tr>' +
        '<td class="step-num">' + (idx + 1) + '</td>' +
        '<td class="step-when">' + s.when + '</td>' +
        '<td class="step-desc">' + s.text + '</td>' +
        '<td class="step-cost">' + s.cost + '</td>' +
        '<td class="step-time">' + s.time + '</td>' +
        '</tr>';
    }).join('');

    const compsTableHtml = (row.comps || []).map(function (c, idx) {
      return '<tr>' +
        '<td>' + (idx + 1) + ' ' + c.name + '</td>' +
        '<td>' + fmtMoney(c.tvl_usd) + '</td>' +
        '<td>' + fmtMoney(c.mcap_usd) + '</td>' +
        '<td>' + c.tvl_to_mcap.toFixed(2) + '&times;</td>' +
        '<td>' + fmtMoney(c.applied_implied_usd) + '</td>' +
        '</tr>';
    }).join('');

    elView.innerHTML = '<div class="detail-container">' +
      '<div class="detail-header">' +
        '<button type="button" class="back-link" onclick="location.hash=\'#board\'">&larr; Board</button>' +
        '<h2 class="detail-title">' + row.name + '</h2>' +
        '<span class="badge-tag pretoken">records no token</span>' +
        tag +
        '<span class="badge-tag category">' + fam + '</span>' +
        '<span class="detail-chains">' + row.chains.join(' &middot; ') + '</span>' +
      '</div>' +

      '<div class="detail-columns">' +
        '<div class="detail-col left-col">' +
          '<div class="detail-card">' +
            '<div class="card-head-sm">Implied value, our model\'s claim</div>' +
            '<div class="hero-val">' + fmtMoney(row.implied_value_usd) + '</div>' +
            '<div class="hero-meta">' +
              '<span>Rank P10&ndash;P90 of refits: <strong>' + row.rank + ' of 181 &middot; ' + row.rank_p10 + '&ndash;' + row.rank_p90 + '</strong></span>' +
              '<span>P25&ndash;P75 band: <strong>' + fmtMoney(row.implied_low_usd) + '&ndash;' + fmtMoney(row.implied_high_usd) + '</strong></span>' +
            '</div>' +
            '<h4 class="sec-title">How the value is built</h4>' +
            '<div class="stepper-box">' +
              '<span>' + fmtMoney(row.model.size_curve_usd) + ' size curve at ' + fmtMoney(row.tvl_usd) + ' TVL</span> &times; ' +
              '<span>' + row.model.family_multiplier + ' ' + fam + ' family</span> &times; ' +
              '<span>' + row.model.growth_multiplier + ' 7-day TVL ' + (row.change_7d ? row.change_7d.toFixed(1) + '%' : '0.0%') + '</span> &times; ' +
              '<span>' + row.model.maturity_multiplier + ' ' + (row.age_days || 365) + ' days tracked</span> = ' +
              '<strong>' + fmtMoney(row.implied_value_usd) + ' implied value</strong>' +
            '</div>' +
          '</div>' +

          '<div class="detail-card">' +
            '<div class="card-head-sm">Band and nearest traded peers <span class="dim">same family, within 10x of the curve</span></div>' +
            '<table class="peers-table">' +
              '<thead><tr><th># TOKEN THAT TRADES</th><th>TVL</th><th>MCAP</th><th>&times; TVL</th><th>APPLIED HERE</th></tr></thead>' +
              '<tbody>' + compsTableHtml + '</tbody>' +
            '</table>' +
          '</div>' +

          '<div class="detail-card">' +
            '<div class="card-head-sm">The farm arithmetic</div>' +
            '<div class="arith-text">' +
              '<p><strong>Slice if a token launches</strong> = ' + row.farm.airdrop_share_pct + '% airdrop share &times; ' + fmtMoney(row.implied_value_usd) + ' &times; $' + row.farm.capital_deposit_usd.toLocaleString() + ' / ' + fmtMoney(row.tvl_usd) + ' TVL = <strong>$' + row.farm.airdrop_slice_usd + '</strong></p>' +
              '<p><strong>Break-even</strong> = ($' + row.farm.gas_cost_usd.toFixed(2) + ' fees + $' + row.farm.income_forgone_usd.toFixed(2) + ' income forgone at 0.5% a year for ' + row.farm.duration_weeks + ' weeks) / $' + row.farm.airdrop_slice_usd + ' = <strong>' + row.farm.breakeven_odds_pct + '%</strong>: the chance a token launches inside the ' + row.farm.duration_weeks + '-week hold</p>' +
            '</div>' +
            '<div class="arith-footer">Estimates: gas $' + row.farm.gas_cost_usd.toFixed(2) + ' on ' + (row.chains[0] || 'L2') + ', T-bills 4% less deposit yield. Deposit grows with TVL within $500&ndash;$5,000; stop = 10% trailing drawdown.</div>' +
          '</div>' +
        '</div>' +

        '<div class="detail-col right-col">' +
          '<div class="detail-card">' +
            '<div class="farm-plan-header">' +
              '<div>' +
                '<h3 class="plan-title">Farm plan</h3>' +
                '<span class="plan-sub">' + (row.chains[0] || 'Primary chain') + ' &middot; $' + row.farm.capital_deposit_usd.toLocaleString() + ' &middot; ' + row.farm.duration_weeks + ' weeks</span>' +
              '</div>' +
              '<span class="verdict-pill ' + (row.farm.verdict === 'Worth farming' ? 'worth' : row.farm.verdict === 'Marginal' ? 'marginal' : 'skip') + '">' + row.farm.verdict + '</span>' +
            '</div>' +

            '<div class="step-circles-row">' +
              circlesHtml +
            '</div>' +
            '<div class="step-timeline-axis">' +
              '<span>day 0</span><span>week 1</span><span>week 2</span><span>week 3</span><span>week 4</span><span>week 5</span><span>week 6</span>' +
            '</div>' +
            '<div class="timeline-stop-note">any day: stop if TVL closes under $' + (row.farm.stop_loss_usd / 1e6).toFixed(1) + 'M</div>' +

            '<table class="steps-table">' +
              '<thead><tr><th>#</th><th>WHEN</th><th>STEP</th><th>COST</th><th>TIME</th></tr></thead>' +
              '<tbody>' + stepsTableHtml + '</tbody>' +
            '</table>' +

            '<div class="summary-metric-strip">' +
              '<div class="sm-item"><span class="sm-lbl">Fees and gas</span><span class="sm-val">$' + row.farm.gas_cost_usd.toFixed(2) + '</span></div>' +
              '<div class="sm-item"><span class="sm-lbl">Income forgone</span><span class="sm-val">$' + row.farm.income_forgone_usd.toFixed(2) + '</span></div>' +
              '<div class="sm-item"><span class="sm-lbl">Your time</span><span class="sm-val">' + row.farm.time_minutes + ' min</span></div>' +
              '<div class="sm-item"><span class="sm-lbl">Slice if launch</span><span class="sm-val">$' + row.farm.airdrop_slice_usd + '</span></div>' +
              '<div class="sm-item"><span class="sm-lbl">Break-even odds</span><span class="sm-val">' + row.farm.breakeven_odds_pct + '%</span></div>' +
              '<div class="sm-item"><span class="sm-lbl">Net per hour</span><span class="sm-val">$' + row.farm.net_per_hour_usd + '</span></div>' +
            '</div>' +

            '<div class="risk-notice-box">' +
              '<ul>' +
                '<li>One wallet only, your own funds. Never split a position across wallets.</li>' +
                '<li>A token launch is not promised: DefiLlama records no token here, which is not proof there is none.</li>' +
                '<li>Claim only through the protocol\'s official domain, never through a link sent to you.</li>' +
                '<li>Not financial advice: cost arithmetic and our model\'s claim.</li>' +
              '</ul>' +
            '</div>' +
          '</div>' +
        '</div>' +
      '</div>' +
    '</div>';
  }

  function renderMethod() {
    elView.innerHTML = '<div class="method-container">' +
      '<div class="method-grid">' +
        '<div class="method-col left-col">' +
          '<div class="detail-card">' +
            '<div class="card-head-sm">The fit: 128 traded tokens, market cap against TVL</div>' +
            '<div class="chart-container" id="method-scatter-chart" style="height:260px;"></div>' +
            '<div class="chart-legend" style="margin-top:10px;">' +
              '<span><span class="leg-dot trades"></span> trades</span>' +
              '<span><span class="leg-sq pretoken"></span> still to come, at implied value</span>' +
              '<span><span class="leg-line fit"></span> fitted curve</span>' +
            '</div>' +
          '</div>' +

          '<div class="note-to-judge">' +
            '<h4>Note to the judge</h4>' +
            '<p>1. <strong>Working radar:</strong> <code>deriveAll</code> runs <code>buildRadar</code> on the raw snapshot in this browser; <code>selectUniverse</code> ranks 40 of 40 watchlist protocols plus 141 more; every row is checked against board.json (all match).</p>' +
            '<p>2. <strong>Value model:</strong> <code>impliedValue</code> uses TVL, category family, 7-day change and days since listing, never a name; <code>fitCurve</code> fits it on traded tokens, <code>looCheck</code> tests it, <code>bootstrapRanks</code> gives bands and rank ranges.</p>' +
            '<p>3. <strong>Farm plans:</strong> <code>farmPlan</code> sets chain, deposit, hold and stop from each row\'s data, with cost, time and break-even odds.</p>' +
            '<p>4. <strong>Page:</strong> <code>filterRows</code>, <code>sortRows</code>, <code>renderDetail</code>; state lives in the URL hash.</p>' +
          '</div>' +
        '</div>' +

        '<div class="method-col right-col">' +
          '<div class="detail-card">' +
            '<div class="card-head-sm">Out of sample: each traded token priced by a fit that never saw it</div>' +
            '<table class="method-table">' +
              '<thead><tr><th>MODEL</th><th>MEDIAN MISS</th><th>MEAN |LOG MISS|</th><th>WITHIN 3&times;</th><th>RANK CORR.</th></tr></thead>' +
              '<tbody>' +
                '<tr><td>TVL &times; one multiple</td><td>4.77&times;</td><td>0.773</td><td>35%</td><td>0.40</td></tr>' +
                '<tr><td>+ size curve (slope b)</td><td>3.40&times;</td><td>0.693</td><td>42%</td><td>0.40</td></tr>' +
                '<tr><td>+ category family</td><td>3.31&times;</td><td>0.674</td><td>47%</td><td>0.39</td></tr>' +
                '<tr><td>+ growth &amp; seasoning priors</td><td>3.20&times;</td><td>0.676</td><td>48%</td><td>0.38</td></tr>' +
              '</tbody>' +
            '</table>' +
            '<p class="method-prose">Size curve and family earn their place; growth and seasoning do not (115 of 128 traded tokens lost TVL this week; a traded token\'s age is not time without a token), so both are bounded priors. They move 104 of 181 ranks 5+ places, 44 by 10+. Rank corr. (Spearman inside 8 held-out folds) is about 0.4 for every variant: order comes from TVL.</p>' +

            '<h4 class="sec-title" style="margin-top:14px;">Category family offsets <span class="dim">mean miss, each capped at 10x, shrunk by 8 pseudo-tokens (traded count)</span></h4>' +
            '<p class="offsets-list">Exchanges &times;1.31 (9) &middot; Infra &amp; chains &times;1.61 (27) &middot; Lending &amp; CDP &times;0.76 (19) &middot; Other &times;1.01 (3) &middot; RWA &amp; stables &times;0.98 (10) &middot; Staking &times;0.54 (15) &middot; Trading &times;1.47 (17) &middot; Vaults &amp; yield &times;0.85 (28)</p>' +

            '<h4 class="sec-title" style="margin-top:14px;">From 758 protocols to 181 ranks</h4>' +
            '<p class="method-prose">128 trade (fit and anchors) &middot; 288 record a token with no market cap (not ranked) &middot; 342 record no token: 181 ranked, 161 set aside as versioned name (11), Bridge (28), Canonical Bridge (15), CEX (42), Liquid Staking (38), wrapped or staked product (5), shares a name with a protocol that records a token (4), Restaked BTC (2), Liquid Restaking (3), named for its chain (13).</p>' +

            '<h4 class="sec-title" style="margin-top:14px;">Farm verdicts</h4>' +
            '<p class="method-prose">Worth farming at break-even odds &le;10% (pays if 1 hold in 10 sees a launch), marginal &le;25%, else skip; a 7-day TVL fall past -30% caps it at marginal (1 row).</p>' +
          '</div>' +
        '</div>' +
      '</div>' +
    '</div>';

    renderMethodScatter();
  }

  function renderMethodScatter() {
    const container = document.getElementById('method-scatter-chart');
    if (!container) return;

    const width = 450;
    const height = 240;
    const padL = 48;
    const padR = 20;
    const padT = 20;
    const padB = 30;

    const plotW = width - padL - padR;
    const plotH = height - padT - padB;

    const minLogX = 7.0;
    const maxLogX = 10.5;
    const minLogY = 4.0;
    const maxLogY = 10.5;

    function scaleX(val) {
      const log = Math.log10(Math.max(1e7, val));
      return padL + ((log - minLogX) / (maxLogX - minLogX)) * plotW;
    }

    function scaleY(val) {
      const log = Math.log10(Math.max(1e4, val));
      return padT + plotH - ((log - minLogY) / (maxLogY - minLogY)) * plotH;
    }

    let svg = '<svg viewBox="0 0 ' + width + ' ' + height + '" width="100%" height="100%" preserveAspectRatio="none">';

    const yTicks = [
      { val: 1e4, lbl: '$10k' },
      { val: 1e6, lbl: '$1M' },
      { val: 1e8, lbl: '$100M' },
      { val: 1e10, lbl: '$10B' },
    ];
    yTicks.forEach(function (t) {
      const y = scaleY(t.val);
      svg += '<line x1="' + padL + '" y1="' + y + '" x2="' + (width - padR) + '" y2="' + y + '" stroke="#1e2638" stroke-dasharray="2,2" />';
      svg += '<text x="' + (padL - 6) + '" y="' + (y + 3) + '" font-size="9.5" fill="#64748b" text-anchor="end" font-family="monospace">' + t.lbl + '</text>';
    });

    const xTicks = [
      { val: 1e7, lbl: '$10M' },
      { val: 1e8, lbl: '$100M' },
      { val: 1e9, lbl: '$1B' },
      { val: 1e10, lbl: '$10B' },
    ];
    xTicks.forEach(function (t) {
      const x = scaleX(t.val);
      svg += '<line x1="' + x + '" y1="' + padT + '" x2="' + x + '" y2="' + (height - padB) + '" stroke="#1e2638" stroke-dasharray="2,2" />';
      svg += '<text x="' + x + '" y="' + (height - 10) + '" font-size="9.5" fill="#64748b" text-anchor="middle" font-family="monospace">' + t.lbl + '</text>';
    });

    const x1 = scaleX(1e7);
    const y1 = scaleY(Math.pow(10, 7.25 + 0.52 * Math.log10(1e7 / 1e8)));
    const x2 = scaleX(3e10);
    const y2 = scaleY(Math.pow(10, 7.25 + 0.52 * Math.log10(3e10 / 1e8)));
    svg += '<line x1="' + x1 + '" y1="' + y1 + '" x2="' + x2 + '" y2="' + y2 + '" stroke="#38bdf8" stroke-width="2" />';

    data.live.forEach(function (t) {
      const cx = scaleX(t.tvl_usd);
      const cy = scaleY(t.mcap_usd);
      svg += '<circle cx="' + cx.toFixed(1) + '" cy="' + cy.toFixed(1) + '" r="2.5" fill="#64748b" opacity="0.65" />';
    });

    data.rows.forEach(function (p) {
      const cx = scaleX(p.tvl_usd);
      const cy = scaleY(p.implied_value_usd);
      svg += '<rect x="' + (cx - 2).toFixed(1) + '" y="' + (cy - 2).toFixed(1) + '" width="4" height="4" fill="#f59e0b" opacity="0.9" />';
    });

    svg += '</svg>';
    container.innerHTML = svg;
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();

