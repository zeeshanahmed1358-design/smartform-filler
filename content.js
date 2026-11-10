(() => {
'use strict';

if (window.__FA_LOADED) return;
window.__FA_LOADED = true;

const ext = globalThis.browser || globalThis.chrome;
const FA = globalThis.FA;

if (!ext) {
    console.error('SmartForm Filler: Extension API unavailable.');
    return;
}

if (
    !FA ||
    !FA.CANON ||
    !FA.FORM_TYPES ||
    !FA.PHOTO ||
    typeof FA.defaultProfile !== 'function'
) {
    console.error(
        'SmartForm Filler: Field Analyzer is missing or not loaded correctly.',
        FA
    );
    return;
}
if (!ext) {
    console.error('SmartForm Filler: Extension API unavailable.');
    return;
}

const THRESH = 0.62;
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* =====================================================================
   1. TEXT NORMALISATION + SIMILARITY
===================================================================== */

const STOP = new Set([
    'your','please','enter','the','a','an','is','are','input','field',
    'required','optional','here','type','provide','what','this','you',
    'my','mandatory','fill','in','to','for','of','and','or','with',
    'as','on','at','by','upload','attach','select','choose','pick','browse'
]);

const REL = new Set([
    'father','mother','spouse','husband','wife','guardian','parent',
    'emergency','reference','referee','sibling','brother','sister',
    'friend','manager','supervisor','nominee','kin','beneficiary',
    'recipient','sponsor','partner','child'
]);

const stem = t =>
    (t.length > 3 && t.endsWith('s') && !t.endsWith('ss'))
        ? t.slice(0, -1)
        : t;

function norm(s) {
    s = (s || '').toString().normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '');

    s = s.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase();
    s = s.replace(/\be[\s_-]?mail\b/g, 'email')
        .replace(/['’`]s\b/g, '');
    s = s.replace(/[^a-z0-9\u0080-\uFFFF]+/g, ' ');

    return s.split(' ')
        .filter(t => t && !STOP.has(t))
        .map(stem)
        .join(' ');
}

const clean = s => (s || '')
    .replace(/\s+/g, ' ')
    .replace(/^\s*\(?\d+[.)]\s+/, '')
    .replace(/^[*\s]+|[*:：\s]+$/g, '')
    .trim();

const wordCount = t => t.split(/\s+/).filter(Boolean).length;

function bigrams(s) {
    const t = s.replace(/ /g, '');
    const m = new Map();

    for (let i = 0; i < t.length - 1; i++) {
        const g = t.slice(i, i + 2);
        m.set(g, (m.get(g) || 0) + 1);
    }

    return m;
}

function bigramSim(a, b) {
    const A = bigrams(a);
    const B = bigrams(b);
    let n = 0, ta = 0, tb = 0;

    A.forEach(v => ta += v);
    B.forEach(v => tb += v);

    if (!ta || !tb) return 0;

    A.forEach((v, k) => {
        if (B.has(k)) n += Math.min(v, B.get(k));
    });

    return 2 * n / (ta + tb);
}

const nums = t => t.split(' ').filter(x => /^\d+$/.test(x));

function sim(a, b) {
    if (!a || !b) return 0;
    if (a === b) return 1;

    const na = nums(a), nb = nums(b);

    if (na.length && nb.length && na.join() !== nb.join()) return 0.1;

    const ca = a.replace(/ /g, '');
    const cb = b.replace(/ /g, '');

    if (ca === cb) return 0.95;

    const sa = new Set(a.split(' '));
    const sb = new Set(b.split(' '));

    let inter = 0;
    sb.forEach(t => {
        if (sa.has(t)) inter++;
    });

    let s = 2 * inter / (sa.size + sb.size) * 0.8;

    if (sb.size > 1 && inter === sb.size) {
        s = Math.max(s, 0.5 + 0.4 * sb.size / sa.size);
    }

    if (Math.min(ca.length, cb.length) >= 4) {
        s = Math.max(s, bigramSim(a, b) * 0.85);
    }

    return s;
}

/* =====================================================================
   2. PAGE READING
===================================================================== */

function getRoots() {
    const roots = [document];

    (function rec(r) {
        r.querySelectorAll('*').forEach(e => {
            if (e.shadowRoot) {
                roots.push(e.shadowRoot);
                rec(e.shadowRoot);
            }
        });
    })(document);

    return roots;
}

const deepQuery = sel =>
    getRoots().flatMap(r => [...r.querySelectorAll(sel)]);

function isVisible(el) {
    if (el.checkVisibility &&
        !el.checkVisibility({
            checkOpacity: true,
            checkVisibilityCSS: true
        })) return false;

    const r = el.getBoundingClientRect();
    return r.width > 1 && r.height > 1;
}

function proxyEl(el) {
    if (isVisible(el)) return el;

    const lab = el.labels && el.labels[0];
    if (lab && isVisible(lab)) return lab;

    let s = el.nextElementSibling;
    if (s && isVisible(s)) return s;

    s = el.previousElementSibling;
    if (s && isVisible(s)) return s;

    let p = el.parentElement;

    for (let i = 0; i < 3 && p; i++, p = p.parentElement) {
        if (isVisible(p)) {
            const r = p.getBoundingClientRect();
            if (r.width < 900 && r.height < 400) return p;
        }
    }

    return null;
}

function blockOf(el) {
    let e = el, i = 0;

    while (
        e &&
        e.parentElement &&
        i < 4 &&
        /^inline/.test(getComputedStyle(e).display)
    ) {
        e = e.parentElement;
        i++;
    }

    return e;
}

const SKIP_TAGS = new Set([
    'SCRIPT','STYLE','NOSCRIPT','OPTION','SELECT',
    'TEXTAREA','TEMPLATE'
]);

function buildTextIndex() {
    const out = [];
    const rg = document.createRange();

    for (const root of getRoots()) {
        const w = document.createTreeWalker(
            root,
            NodeFilter.SHOW_TEXT,
            null
        );

        let n;

        while ((n = w.nextNode()) && out.length < 5000) {
            const t = n.nodeValue.replace(/\s+/g, ' ').trim();

            if (!t || t.length > 160) continue;

            const p = n.parentElement;

            if (
                !p ||
                SKIP_TAGS.has(p.tagName) ||
                p.closest('option,[hidden],[aria-hidden="true"]')
            ) continue;

            if (
                p.checkVisibility &&
                !p.checkVisibility({
                    checkOpacity: true,
                    checkVisibilityCSS: true
                })
            ) continue;

            rg.selectNodeContents(n);
            const rect = rg.getBoundingClientRect();

            if (rect.width < 1 || rect.height < 1) continue;

            out.push({ node: n, el: p, text: t, rect });
        }
    }

    return out;
}

function plainLabel(l) {
    const c = l.cloneNode(true);

    c.querySelectorAll(
        'input,select,textarea,option,button,script,style'
    ).forEach(n => n.remove());

    return clean(c.textContent);
}

function pickText(n, own) {
    const blk = blockOf(n.el);

    if (blk && !(own && blk.contains(own))) {
        const t = clean(blk.innerText || '');
        if (t && wordCount(t) <= 8) return t;
    }

    return n.text;
}

function nearestText(r, idx, own, exclude) {
    let best = null, bd = Infinity;

    for (const n of idx) {
        if (own && own.contains(n.node)) continue;
        if (exclude && exclude(n)) continue;

        const b = n.rect;
        let d = Infinity;

        if (
            b.bottom <= r.top + 8 &&
            r.top - b.bottom < 80 &&
            b.left < r.right &&
            b.right > r.left - 24
        ) {
            d = (r.top - b.bottom) +
                Math.abs(b.left - r.left) * 0.1;
        } else if (
            b.right <= r.left + 8 &&
            r.left - b.right < 280 &&
            b.top < r.bottom &&
            b.bottom > r.top
        ) {
            d = (r.left - b.right) * 0.5 +
                Math.abs(
                    (b.top + b.bottom) / 2 -
                    (r.top + r.bottom) / 2
                ) * 0.4 + 6;
        }

        if (d < bd && wordCount(n.text) <= 8) {
            bd = d;
            best = n;
        }
    }

    return best ? pickText(best, own) : null;
}

function labelTexts(el, idx, opt = {}) {
    const out = [];

    const add = (t, w) => {
        t = clean(t || '');
        if (!t || t.length > 140) return;

        out.push({ t, w });

        const s = t
            .replace(/\(.*?\)|\[.*?\]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();

        if (s && s !== t) out.push({ t: s, w });
    };

    const root = el.getRootNode();

    const byIds = (attr, w) => {
        (el.getAttribute(attr) || '')
            .split(/\s+/)
            .filter(Boolean)
            .forEach(id => {
                const n = root.getElementById
                    ? root.getElementById(id)
                    : null;

                if (n) add(n.textContent, w);
            });
    };

    byIds('aria-labelledby', 1);
    add(el.getAttribute('aria-label'), 1);

    if (!opt.skipOwn) {
        if (el.labels && el.labels.length) {
            [...el.labels].forEach(l => add(plainLabel(l), 1));
        } else {
            const l = el.closest('label');
            if (l) add(plainLabel(l), 1);
        }
    }

    const own = opt.own === undefined ? el : opt.own;

    const g = nearestText(
        opt.rect || el.getBoundingClientRect(),
        idx,
        own,
        opt.exclude
    );

    if (g) add(g, 0.95);

    const grp = el.closest('[role=radiogroup],[role=group]');

    if (grp && grp !== el) {
        add(grp.getAttribute('aria-label'), 0.9);

        (grp.getAttribute('aria-labelledby') || '')
            .split(/\s+/)
            .filter(Boolean)
            .forEach(id => {
                const n = root.getElementById
                    ? root.getElementById(id)
                    : null;

                if (n) add(n.textContent, 0.9);
            });
    }

    add(el.placeholder, 0.9);
    add(el.title, 0.7);

    const fs = el.closest('fieldset');

    if (fs) {
        const lg = fs.querySelector('legend');
        if (lg) add(plainLabel(lg), 0.6);
    }

    if (typeof el.name === 'string') add(el.name, 0.65);
    if (el.id) add(el.id, 0.6);

    return out;
}

/* =====================================================================
   3. BUILD LOGICAL FORM UNITS
===================================================================== */

let formSeq = 0;
const formIds = new WeakMap();

const formKey = f => f
    ? (formIds.get(f) || (formIds.set(f, ++formSeq), formSeq))
    : 0;

const unionRect = rs => ({
    left: Math.min(...rs.map(r => r.left)),
    top: Math.min(...rs.map(r => r.top)),
    right: Math.max(...rs.map(r => r.right)),
    bottom: Math.max(...rs.map(r => r.bottom))
});

const isChecked = el =>
    typeof el.checked === 'boolean'
        ? el.checked
        : el.getAttribute('aria-checked') === 'true';

function isFillable(el) {
    if (el.disabled || el.readOnly) return false;

    const t = (el.type || 'text').toLowerCase();

    if ([
        'hidden','submit','button','reset','image',
        'password','search','range','color'
    ].includes(t)) return false;

    const hint = (
        el.name + ' ' + el.id + ' ' + (el.autocomplete || '')
    ).toLowerCase();

    if (
        /captcha|otp|one-time|search|coupon|promo|cvv|cvc|card-?number|cc-/.test(hint)
    ) return false;

    if (
        el.tagName === 'SELECT' ||
        t === 'radio' ||
        t === 'checkbox' ||
        t === 'file'
    ) return !!proxyEl(el);

    return isVisible(el);
}

function optionLabel(el, idx) {
    if (el.tagName !== 'INPUT') {
        return {
            text: clean(
                el.getAttribute('aria-label') ||
                el.textContent ||
                el.getAttribute('data-value') ||
                ''
            ),
            labelEl: el
        };
    }

    const lab = (el.labels && el.labels[0]) || el.closest('label');

    if (lab) return { text: plainLabel(lab), labelEl: lab };

    const a = el.getAttribute('aria-label');
    if (a) return { text: clean(a) };

    const r = (proxyEl(el) || el).getBoundingClientRect();

    let best = null, bd = 1e9;

    for (const n of idx) {
        const b = n.rect;

        if (
            b.left >= r.right - 6 &&
            b.left - r.right < 60 &&
            b.top < r.bottom &&
            b.bottom > r.top
        ) {
            const d = b.left - r.right;

            if (d < bd) {
                bd = d;
                best = n;
            }
        }
    }

    return {
        text: best ? best.text : (el.value || ''),
        node: best && best.node
    };
}

function makeUnit(el, type, idx) {
    const tag = el.tagName.toLowerCase();

    const kind = tag === 'select'
        ? 'select'
        : type === 'checkbox'
            ? 'checkbox'
            : type === 'file'
                ? 'file'
                : 'text';

    const px = proxyEl(el) || el;

    const u = {
        el,
        els: [el],
        kind,
        type: tag === 'textarea' ? 'textarea' : type,
        rect: px.getBoundingClientRect(),
        proxy: px,
        form: el.form || el.closest('form') || null,
        ac: (el.getAttribute('autocomplete') || '').split(/\s+/).pop(),
        placeholder: el.placeholder || '',
        maxlength: el.maxLength > 0 ? el.maxLength : 0,
        accept: el.accept || ''
    };

    u.texts = labelTexts(el, idx, {
        rect: u.rect,
        own: px
    });

    if (kind === 'select') {
        u.options = [...el.options]
            .filter(o =>
                o.value !== '' &&
                !/^[-–—\s]*(select|choose|pick)/i.test(o.text.trim())
            )
            .map(o => ({
                el: o,
                text: o.text.trim(),
                value: o.value
            }));
    }

    if (kind === 'checkbox') {
        const lb = (el.labels && el.labels[0]) || el.closest('label');

        u.ownLabel = lb
            ? plainLabel(lb)
            : ((u.texts[0] || {}).t || '');
    }

    return u;
}

function makeAriaCheckbox(el, idx) {
    const u = {
        el,
        els: [el],
        kind: 'checkbox',
        type: 'checkbox',
        rect: el.getBoundingClientRect(),
        proxy: el,
        form: el.closest('form') || null,
        ac: '',
        placeholder: '',
        maxlength: 0,
        accept: ''
    };

    u.texts = labelTexts(el, idx, {
        rect: u.rect,
        own: el
    });

    u.ownLabel = clean(
        el.getAttribute('aria-label') || el.textContent || ''
    );

    if (u.ownLabel) {
        u.texts.unshift({ t: u.ownLabel, w: 1 });
    }

    return u;
}

function makeGroupUnit(kind, els, idx, anchor) {
    const options = els.map(el => {
        const o = optionLabel(el, idx);

        const box = (o.labelEl && isVisible(o.labelEl))
            ? o.labelEl
            : (proxyEl(el) || el);

        return {
            el,
            value: el.getAttribute('data-value') || el.value || o.text,
            text: o.text,
            labelEl: o.labelEl,
            node: o.node,
            rect: box.getBoundingClientRect()
        };
    });

    const gr = unionRect(options.map(o => o.rect));

    const exclude = n => options.some(o =>
        (o.labelEl && o.labelEl.contains(n.node)) ||
        o.node === n.node ||
        o.el.contains(n.node)
    );

    const u = {
        kind,
        type: kind,
        el: els[0],
        els,
        options,
        rect: gr,
        proxy: els[0],
        ac: '',
        placeholder: '',
        maxlength: 0,
        accept: '',
        form: els[0].closest('form') || null
    };

    u.texts = labelTexts(anchor || els[0], idx, {
        rect: gr,
        exclude,
        skipOwn: true,
        own: null
    });

    return u;
}

function makeDropdownUnit(el, idx) {
    const u = {
        kind: 'dropdown',
        type: 'dropdown',
        el,
        els: [el],
        rect: el.getBoundingClientRect(),
        proxy: el,
        form: el.closest('form') || null,
        ac: '',
        placeholder: '',
        maxlength: 0,
        accept: ''
    };

    u.options = [...el.querySelectorAll('[role=option]')]
        .map(o => ({
            el: o,
            text: clean(o.getAttribute('aria-label') || o.textContent),
            value: o.getAttribute('data-value') || ''
        }))
        .filter(o =>

            (o.text || o.value) &&
            !/^[-–—\s]*(select|choose|pick)/i.test(o.text)
        );

    u.texts = labelTexts(el, idx, {
        rect: u.rect,
        own: el
    });

    return u;
}

function buildUnits() {
    const idx = buildTextIndex();
    const units = [];
    const radios = new Map();
    const checks = new Map();

    for (const el of deepQuery('input,select,textarea').filter(isFillable)) {
        const type = (el.type || 'text').toLowerCase();

        if (type === 'radio') {
            const k = formKey(el.form) + '|' + el.name;
            if (!radios.has(k)) radios.set(k, []);
            radios.get(k).push(el);
        } else if (type === 'checkbox' && el.name) {
            const k = formKey(el.form) + '|' + el.name;
            if (!checks.has(k)) checks.set(k, []);
            checks.get(k).push(el);
        } else {
            units.push(makeUnit(el, type, idx));
        }
    }

    radios.forEach(l =>
        units.push(makeGroupUnit('radio', l, idx, l[0]))
    );

    checks.forEach(l =>
        units.push(
            l.length >= 2
                ? makeGroupUnit('checkgroup', l, idx, l[0])
                : makeUnit(l[0], 'checkbox', idx)
        )
    );

    const claimed = [];

    const free = el =>
        !claimed.some(c => c.contains(el) || el.contains(c));

    deepQuery('[role=radiogroup]').forEach(g => {
        const opts = [...g.querySelectorAll('[role=radio]')];

        if (!opts.length || !isVisible(g) || !free(g)) return;

        claimed.push(g);
        units.push(makeGroupUnit('radio', opts, idx, g));
    });

    const aria = deepQuery('[role=checkbox]')
        .filter(e => isVisible(e) && free(e));

    const byGroup = new Map();

    aria.forEach(e => {
        const g = e.closest('[role=group]');
        const k = g || e;

        if (!byGroup.has(k)) byGroup.set(k, []);
        byGroup.get(k).push(e);
    });

    byGroup.forEach((l, g) => {
        if (g !== l[0] && l.length >= 2) {
            units.push(makeGroupUnit('checkgroup', l, idx, g));
        } else {
            l.forEach(e => units.push(makeAriaCheckbox(e, idx)));
        }

        l.forEach(e => claimed.push(e));
    });

    deepQuery('[role=listbox],[role=combobox],[aria-haspopup="listbox"]')
        .forEach(el => {
            if (
                /^(INPUT|SELECT|TEXTAREA)$/.test(el.tagName) ||
                !isVisible(el) ||
                el.querySelector('input,textarea') ||
                !free(el)
            ) return;

            claimed.push(el);
            units.push(makeDropdownUnit(el, idx));
        });

    return { units, idx };
}

function isEmpty(u) {
    switch (u.kind) {
        case 'select':
            return !u.el.value || u.el.selectedIndex <= 0;

        case 'radio':
        case 'checkgroup':
            return !u.els.some(isChecked);

        case 'checkbox':
            return !isChecked(u.el);

        case 'file':
            return !(u.el.files && u.el.files.length);

        case 'dropdown': {
            const sel = u.el.querySelector(
                '[role=option][aria-selected="true"]'
            );

            if (sel) {
                return !(sel.getAttribute('data-value') || '');
            }

            return /^(|choose|select|--+|select an option)$/i
                .test(clean(u.el.innerText || ''));
        }

        default:
            return !u.el.value.trim();
    }
}

const bestLabel = u =>
    ((u.texts.slice().sort((a, b) => b.w - a.w)[0]) || {}).t ||
    '(unlabelled)';

/* =====================================================================
   4. TITLE DETECTION
===================================================================== */

const FORMWORDS =
    /\b(form|application|apply|registration|register|sign ?up|contact|survey|checkout|enrol|enroll|admission|feedback|booking|reservation|request|order|subscribe|questionnaire|membership|inquiry|enquiry|quote|claim|donation)\b/i;

const SKIP_CLOSEST =
    'label,button,option,select,nav,footer,[role=navigation],[role=menu],[role=menubar],[role=tab],[role=tablist]';

function detectTitle(U, idx, list) {
    const known = new Set();

    list.forEach(u =>
        u.texts.forEach(x => known.add(norm(x.t)))
    );

    const seen = new Set();
    let best = null;

    for (const n of idx) {
        const b = n.rect;

        if (b.top >= U.top - 2 || U.top - b.bottom > 700) continue;
        if (b.right < U.left - 250 || b.left > U.right + 250) continue;

        const blk = blockOf(n.el);

        if (!blk || seen.has(blk)) continue;
        seen.add(blk);

        if (
            blk.closest(SKIP_CLOSEST) ||
            blk.querySelector('input,select,textarea,button')
        ) continue;

        const text = clean(blk.innerText || blk.textContent || '');
        const words = wordCount(text);

        if (
            !text ||
            words > 22 ||
            text.length > 180 ||
            known.has(norm(text))
        ) continue;

        const r = blk.getBoundingClientRect();

        if (r.height > 220 || r.bottom > U.top) continue;

        const cs = getComputedStyle(blk);
        const fs = parseFloat(cs.fontSize) || 16;
        const fw = cs.fontWeight === 'bold'
            ? 700
            : (parseInt(cs.fontWeight) || 400);

        const tag = blk.tagName;

        let emph =
            (Math.min(fs, 56) / 16 - 1) +
            (fw >= 600 ? 0.6 : 0) +
            ({
                H1: 1.5,
                H2: 1.1,
                H3: 0.8,
                H4: 0.4,
                H5: 0.3,
                H6: 0.3,
                LEGEND: 0.6,
                CAPTION: 0.4
            }[tag] || 0);

        if (blk.getAttribute('role') === 'heading') emph += 0.9;

        if (/title|heading|headline/i.test(
            (blk.className || '') + ' ' + blk.id
        )) emph += 0.4;

        if (emph < 0.7) continue;

        let s = emph +
            1.2 * (1 - Math.min(U.top - r.bottom, 600) / 600);

        if (FORMWORDS.test(text)) s += 0.9;
        if (words > 14) s -= 1.2;
        if (words < 2 && text.length < 4) s -= 1;
        if (/[.!?]$/.test(text) && words > 8) s -= 1;
        if (blk.closest('header')) s -= 0.3;

        if (!best || s > best.score) {
            best = {
                text,
                score: +s.toFixed(2),
                tag: tag.toLowerCase(),
                size: fs
            };
        }
    }

    if (best) {
        return {
            text: best.text,
            source: `visual (${best.tag}, ${Math.round(best.size)}px)`,
            score: best.score
        };
    }

    const og = document.querySelector('meta[property="og:title"]');

    return {
        text: clean((og && og.content) || document.title || ''),
        source: 'page title (fallback)',
        score: 0
    };
}

function analyzeTitle(title, store) {
    const nt = ' ' + norm(title) + ' ';
    const types = [];
    const boost = new Set();

    for (const [name, def] of Object.entries(FA.FORM_TYPES)) {
        if (def.words.some(w => nt.includes(' ' + norm(w) + ' '))) {
            types.push(name);
            def.boost.forEach(k => boost.add(k));
        }
    }

    const titleToks = new Set(nt.trim().split(' '));

    let profile =
        store.profiles[store.active] || store.profiles[0];

    let bestScore = 0;
    let auto = false;

    store.profiles.forEach(p => {
        let s = 0;

        (p.keywords || [])
            .map(norm)
            .filter(Boolean)
            .forEach(w => {
                if (w.split(' ').every(t => titleToks.has(t))) s = 1;
            });

        if (s > bestScore) {
            bestScore = s;
            profile = p;
            auto = p !== store.profiles[store.active];
        }
    });

    return { types, boost, profile, auto };
}

/* =====================================================================
   5. PROFILE PREPARATION
===================================================================== */

function prepareProfile(profile, learned) {
    const fields = profile.fields.map(f => ({ ...f }));

    const val = k =>
        (fields.find(f =>
            f.key === k && String(f.value || '').trim()
        ) || {}).value || '';

    const add = (key, label, value) => {
        if (
            value &&
            !fields.some(f =>
                f.key === key && String(f.value || '').trim()
            )
        ) {
            fields.push({ key, label, value, synonyms: [] });
        }
    };

    const first = val('firstName');
    const mid = val('middleName');
    const last = val('lastName');
    const full = val('fullName');

    if (!full && (first || last)) {
        add(
            'fullName',
            'Full name',
            [first, mid, last].filter(Boolean).join(' ')
        );
    }

    if (full && !first) {
        add('firstName', 'First name', full.split(/\s+/)[0]);
    }

    if (full && !last && full.split(/\s+/).length > 1) {
        add(
            'lastName',
            'Last name',
            full.split(/\s+/).slice(1).join(' ')
        );
    }

    const out = fields
        .filter(f => f.key && String(f.value || '').trim() !== '')
        .map(f => {
            const c = FA.CANON.find(c => c.key === f.key);
            const phrases = new Set();

            [
                f.label,
                f.key,
                ...(c ? c.syn : []),
                ...(f.synonyms || []),
                ...((learned && learned[f.key]) || [])
            ].forEach(p => {
                const n = norm(p);
                if (n) phrases.add(n);
            });

            return {
                key: f.key,
                label: f.label || f.key,
                value: String(f.value).trim(),
                canon: !!c,
                phrases: [...phrases],
                phraseTokens: new Set([...phrases].join(' ').split(' ')),
                strong: ((c && c.strong) || []).map(stem),
                ac: (c && c.ac) || [],
                types: (c && c.types) || []
            };
        });

    if (profile.photo && profile.photo.std) {
        const phrases = FA.PHOTO.syn.map(norm).filter(Boolean);

        out.push({
            key: 'photo',
            label: 'Photo',
            value: '[photo]',
            canon: true,
            phrases,
            phraseTokens: new Set(phrases.join(' ').split(' ')),
            strong: FA.PHOTO.strong.map(stem),
            ac: [],
            types: [],
            photo: profile.photo
        });
    }

    return out;
}

/* =====================================================================
   6. VALUE FITTING
===================================================================== */

const p2 = n => String(n).padStart(2, '0');

function toISO(v) {
    v = String(v).trim();
    let m;

    if ((m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(v))) {
        return `${m[1]}-${p2(m[2])}-${p2(m[3])}`;
    }

    if ((m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/.exec(v))) {
        let d = +m[1], mo = +m[2];

        if (mo > 12) [d, mo] = [mo, d];

        return `${m[3]}-${p2(mo)}-${p2(d)}`;
    }

    const t = Date.parse(v);

    if (!isNaN(t)) {
        const d = new Date(t);

        return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
    }

    return null;
}

function datePattern(p) {
    const m =
        /(d{1,2}|m{1,2}|y{2,4})\s*([\/.-])\s*(d{1,2}|m{1,2}|y{2,4})\s*\2\s*(d{1,2}|m{1,2}|y{2,4})/i.exec(p || '');

    return m ? [m[1], m[3], m[4], m[2]] : null;
}

function fmtDate(iso, pat) {
    const [y, mo, d] = iso.split('-');
    const [a, b, c, sep] = pat;

    const f = t => {
        t = t.toLowerCase();

        if (t[0] === 'd') return t.length === 1 ? String(+d) : d;
        if (t[0] === 'm') return t.length === 1 ? String(+mo) : mo;

        return t.length === 2 ? y.slice(2) : y;
    };

    return [f(a), f(b), f(c)].join(sep);
}

let regionNames = null;

try {
    regionNames = new Intl.DisplayNames(['en'], { type: 'region' });
} catch (e) {}

const regionName = c => {
    try {
        return regionNames ? regionNames.of(c.toUpperCase()) : null;
    } catch (e) {
        return null;
    }
};

function pickOption(options, value) {
    const nv = norm(value);
    const raw = String(value).trim().toLowerCase();

    const full = /^[a-z]{2}$/.test(raw)
        ? norm(regionName(raw) || '')
        : '';

    let best = null, bs = 0;

    for (const o of options) {
        let s = 0;

        for (const c of [o.text, o.value]) {
            if (!c) continue;

            const cs = String(c).trim();
            const nc = norm(cs);

            if (cs.toLowerCase() === raw || nc === nv) {
                s = 1;
            } else {
                s = Math.max(s, sim(nc, nv));
            }

            if (full && nc === full) {
                s = Math.max(s, 0.95);
            }

            if (
                /^[A-Za-z]{2}$/.test(cs) &&
                regionName(cs) &&
                norm(regionName(cs)) === nv
            ) {
                s = Math.max(s, 0.95);
            }

            if (
                raw.length > 1 &&
                cs.length === 1 &&
                cs.toLowerCase() === raw[0]
            ) {
                s = Math.max(s, 0.8);
            }
        }

        if (s > bs) {
            bs = s;
            best = o;
        }
    }

    return bs >= 0.72 ? best : null;
}

function wantedMime(accept) {
    const a = (accept || '').toLowerCase();

    if (!a) return 'image/jpeg';
    if (/image\/\*|jpe?g/.test(a)) return 'image/jpeg';
    if (/png/.test(a)) return 'image/png';

    return null;
}

function fits(u, v) {
    const NO = { ok: false };

    switch (u.kind) {
        case 'file':
            return wantedMime(u.accept) ? { ok: true } : NO;

        case 'select':
        case 'radio': {
            const o = pickOption(u.options || [], v);
            return o ? { ok: true, opt: o } : NO;
        }

        case 'dropdown': {
            if (!u.options.length) return { ok: true, lazy: true };

            const o = pickOption(u.options, v);
            return o ? { ok: true, opt: o } : NO;
        }

        case 'checkgroup': {
            const picked = [
                ...new Set(
                    v.split(/[,;|]/)
                        .map(x => x.trim())
                        .filter(Boolean)
                        .map(x => pickOption(u.options, x))
                        .filter(Boolean)
                )
            ];

            return picked.length ? { ok: true, opts: picked } : NO;
        }

        case 'checkbox': {
            if (/^(yes|true|1|y|checked|on|agree|accept)$/i.test(v)) {
                return { ok: true, check: true };
            }

            const mine = norm(u.ownLabel);

            return v.split(/[,;|]/).some(x =>
                mine && sim(norm(x), mine) >= 0.8
            )
                ? { ok: true, check: true }
                : NO;
        }
    }

    let val = v;

    if (u.type === 'email') {
        if (!/^\S+@\S+\.\S+$/.test(v)) return NO;
    } else if (u.type === 'tel') {
        if (!/^[+()\d\s.-]{5,}$/.test(v)) return NO;
    } else if (u.type === 'number') {
        const n = v.replace(/[,\s]/g, '');

        if (!/^-?\d+(\.\d+)?$/.test(n)) return NO;

        val = n;
    } else if (u.type === 'url') {
        if (!/^(https?:\/\/)?\S+\.\S+$/.test(v)) return NO;

        val = /^https?:/.test(v) ? v : 'https://' + v;
    } else if (u.type === 'date') {
        const iso = toISO(v);

        if (!iso) return NO;

        val = iso;
    } else {
        const pat =
            /^\d{4}-\d{2}-\d{2}$/.test(v) &&
            datePattern(u.placeholder);

        if (pat) val = fmtDate(v, pat);
    }

    if (u.maxlength && val.length > u.maxlength) return NO;

    return { ok: true, value: val };
}

/* =====================================================================
   7. SCORING
===================================================================== */

const TYPED = ['email', 'tel', 'url', 'date'];

function scoreUnit(u, f, ctx) {
    if ((u.kind === 'file') !== (f.key === 'photo')) return 0;

    let best = 0;
    const rel = new Set();

    if (u.ac && f.ac.includes(u.ac)) best = 1;

    for (const x of u.texts) {
        const nt = norm(x.t);

        if (!nt) continue;

        const toks = nt.split(' ');
        let s = 0;

        for (const ph of f.phrases) {
            s = Math.max(s, sim(nt, ph));
        }

        if (f.strong.length && toks.length <= 6) {
            const i = toks.findIndex(t => f.strong.includes(t));

            if (i >= 0) {
                s = Math.max(s, 0.74 - 0.03 * i);
            }
        }

        best = Math.max(best, s * x.w);

        toks.forEach(t => {
            if (REL.has(t)) rel.add(t);
        });
    }

    if (
        u.kind === 'file' &&
        /image|jpe?g|png/i.test(u.accept) &&
        best >= 0.3
    ) {
        best = Math.min(1, best + 0.15);
    }

    if (TYPED.includes(u.type)) {
        if (f.types.includes(u.type)) {
            best = Math.max(best, best >= 0.3 ? 0.9 : 0.8);
        } else if (f.canon && f.types.length) {
            best *= 0.4;
        }
    }

    if (best >= 0.35 && ctx.boost.has(f.key)) {
        best = Math.min(1, best + 0.1);
    }

    for (const t of rel) {
        if (!f.phraseTokens.has(t)) {
            best *= 0.2;
            break;
        }
    }

    if (best < 0.3) return 0;

    return fits(u, f.value).ok ? best : 0;
}

/* =====================================================================
   8. FILLING
===================================================================== */

function setNative(el, value) {
    const proto =
        el instanceof HTMLTextAreaElement
            ? HTMLTextAreaElement.prototype
            : el instanceof HTMLSelectElement
                ? HTMLSelectElement.prototype
                : HTMLInputElement.prototype;

    const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;

    el.focus({ preventScroll: true });
    setter.call(el, value);

    el.dispatchEvent(new InputEvent('input', {
        bubbles: true,
        inputType: 'insertText',
        data: value
    }));

    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.dispatchEvent(new Event('blur', { bubbles: true }));
}

function flash(el) {
    if (!el) return;

    const o = el.style.outline;
    el.style.outline = '2px solid #10b981';

    setTimeout(() => {
        el.style.outline = o;
    }, 1800);
}

function fire(el, types) {
    types.forEach(t => {
        const C =
            t.startsWith('pointer') && window.PointerEvent
                ? PointerEvent
                : MouseEvent;

        el.dispatchEvent(new C(t, {
            bubbles: true,
            cancelable: true,
            view: window,
            button: 0
        }));
    });
}

function activate(el) {
    if (el.tagName === 'INPUT') {
        el.click();
        return;
    }

    fire(el, [
        'pointerdown',
        'mousedown',
        'pointerup',
        'mouseup',
        'click'
    ]);
}

function visibleOptions(trigger) {
    const root = trigger.getRootNode();

    const ids = [
        trigger.getAttribute('aria-controls'),
        trigger.getAttribute('aria-owns')
    ]
        .filter(Boolean)
        .join(' ')
        .split(/\s+/)
        .filter(Boolean);

    let list = [];

    ids.forEach(id => {
        const n = root.getElementById && root.getElementById(id);

        if (n) {
            list.push(...n.querySelectorAll('[role=option]'));
        }
    });

    if (!list.length) {
        list = [...trigger.querySelectorAll('[role=option]')]
            .filter(isVisible);
    }

    if (!list.length) {
        list = deepQuery('[role=option]').filter(isVisible);
    }

    return list;
}

async function fillDropdown(u, value) {
    activate(u.el);
    await sleep(350);

    const opts = visibleOptions(u.el)
        .map(el => ({
            el,
            text: clean(el.getAttribute('aria-label') || el.textContent),
            value: el.getAttribute('data-value') || ''
        }))
        .filter(o => o.text || o.value);

    const o = pickOption(opts, value);

    if (!o) {
        u.el.dispatchEvent(new KeyboardEvent('keydown', {
            key: 'Escape',
            bubbles: true
        }));

        return false;
    }

    activate(o.el);
    await sleep(150);

    return true;
}

function dataUrlToBlob(d) {
    const [head, b64] = d.split(',');
    const mime = /:(.*?);/.exec(head)[1];

    const bin = atob(b64);
    const arr = new Uint8Array(bin.length);

    for (let i = 0; i < bin.length; i++) {
        arr[i] = bin.charCodeAt(i);
    }

    return new Blob([arr], { type: mime });
}

function toPng(dataUrl) {
    return new Promise(res => {
        const img = new Image();

        img.onload = () => {
            const c = document.createElement('canvas');

            c.width = img.width;
            c.height = img.height;

            c.getContext('2d').drawImage(img, 0, 0);

            c.toBlob(b => res(b), 'image/png');
        };

        img.onerror = () => res(null);
        img.src = dataUrl;
    });
}

function sizeLimitBytes(u) {
    const box =
        u.el.closest('div,li,td,fieldset,label') ||
        u.el.parentElement;

    const txt =
        u.texts.map(t => t.t).join(' ') +
        ' ' +
        ((box && box.innerText) || '').slice(0, 400);

    const m = /(\d+(?:\.\d+)?)\s*(kb|mb)\b/i.exec(txt);

    return m
        ? parseFloat(m[1]) *
            (m[2].toLowerCase() === 'mb' ? 1048576 : 1024)
        : 0;
}

async function fillFile(u, photo) {
    const mime = wantedMime(u.accept);

    if (!mime) return false;

    const limit = sizeLimitBytes(u);

    let src = photo.std;

    if (limit && src.length * 0.75 > limit && photo.small) {
        src = photo.small;
    }

    let blob = mime === 'image/png' ? await toPng(src) : null;
    const png = !!blob;

    if (!blob) blob = dataUrlToBlob(src);

    const file = new File(
        [blob],
        png ? 'passport-photo.png' : 'passport-photo.jpg',
        { type: png ? 'image/png' : 'image/jpeg' }
    );

    const dt = new DataTransfer();
    dt.items.add(file);

    u.el.files = dt.files;

    u.el.dispatchEvent(new Event('input', { bubbles: true }));
    u.el.dispatchEvent(new Event('change', { bubbles: true }));

    flash(u.proxy);

    return true;
}

async function apply(u, fit, f) {
    try {
        switch (u.kind) {
            case 'select':
                setNative(u.el, fit.opt.value);
                flash(u.proxy);
                return true;

            case 'radio':
                activate(fit.opt.el);
                flash(fit.opt.labelEl || fit.opt.el);
                return true;

            case 'checkgroup':
                fit.opts.forEach(o => {
                    if (!isChecked(o.el)) activate(o.el);
                    flash(o.labelEl || o.el);
                });
                return true;

            case 'checkbox':
                if (!isChecked(u.el)) activate(u.el);
                flash(u.proxy);
                return true;

            case 'dropdown': {
                const ok = await fillDropdown(u, f.value);

                if (ok) flash(u.el);

                return ok;
            }

            case 'file':
                return await fillFile(u, f.photo);

            default:
                setNative(u.el, fit.value);
                flash(u.el);
                return true;
        }
    } catch (e) {
        return false;
    }
}


/* =====================================================================
   9. MAIN PIPELINE
===================================================================== */

const llmCache = new Map();

async function askLLM(title, rest, pf) {
    const fields = rest.map((u, i) => ({
        id: 'f' + i,
        label: bestLabel(u),
        type: u.kind,
        options: (u.options || []).slice(0, 25).map(o => o.text)
    }));

    const sig = title + '|' + fields.map(f => f.label).join('|');

    if (llmCache.has(sig)) return llmCache.get(sig);

    let map = {};

    try {
        const r = await ext.runtime.sendMessage({
            type: 'llm',
            title,
            fields,
            keys: pf
                .filter(f => f.key !== 'photo')
                .map(f => ({
                    key: f.key,
                    label: f.label
                }))
        });

        map = (r && r.map) || {};
    } catch (e) {}

    const res = rest.map((u, i) => map['f' + i] || null);

    llmCache.set(sig, res);

    return res;
}

async function processGroup(list, idx, mode, store) {
    const title = detectTitle(
        unionRect(list.map(u => u.rect)),
        idx,
        list
    );

    const ctx = analyzeTitle(title.text, store);
    const pf = prepareProfile(ctx.profile, store.learned);
    const hasPhoto = pf.some(f => f.key === 'photo');

    const pending = list.filter(u =>
        (u.kind !== 'file' || hasPhoto) &&
        (store.settings.overwrite || isEmpty(u))
    );

    const scored = [];

    for (const u of pending) {
        for (const f of pf) {
            const s = scoreUnit(u, f, ctx);

            if (s > 0) scored.push({ u, f, s });
        }
    }

    scored.sort((a, b) => b.s - a.s);

    const assigned = new Map();
    const used = new Map();

    for (const c of scored) {
        if (c.s < THRESH) break;
        if (assigned.has(c.u)) continue;

        if (
            used.has(c.f.key) &&
            c.s < 0.85 &&
            c.f.key !== 'photo'
        ) continue;

        assigned.set(c.u, c);
        used.set(c.f.key, 1);
    }

    if (mode === 'fill' && store.settings.useLLM) {
        const rest = pending.filter(u =>
            !assigned.has(u) && u.kind !== 'file'
        );

        if (rest.length) {
            const keys = await askLLM(title.text, rest, pf);

            rest.forEach((u, i) => {
                const f = pf.find(x =>
                    x.key === keys[i] && x.key !== 'photo'
                );

                if (f && fits(u, f.value).ok) {
                    assigned.set(u, {
                        u,
                        f,
                        s: 0.6,
                        ai: true
                    });
                }
            });
        }
    }

    const matches = [];
    const uncertain = [];

    for (const [u, c] of assigned) {
        const fit = fits(u, c.f.value);
        let ok = false;

        if (mode === 'fill') {
            ok = await apply(u, fit, c.f);
        }

        matches.push({
            label: bestLabel(u),
            key: c.f.key,
            kind: u.kind,
            score: +c.s.toFixed(2),
            ai: !!c.ai,
            applied: mode === 'fill' && ok,
            failed: mode === 'fill' && !ok
        });
    }

    for (const u of pending) {
        if (!assigned.has(u)) {
            const top = scored.find(c => c.u === u);

            if (u.kind === 'file' && !top) continue;

            uncertain.push({
                label: bestLabel(u),
                kind: u.kind,
                candidate: top ? top.f.key : null,
                score: top ? +top.s.toFixed(2) : 0
            });
        }
    }

    return {
        title,
        types: ctx.types,
        profile: ctx.profile.name,
        profileAuto: ctx.auto,
        matches,
        uncertain,
        alreadyFilled: list.length - pending.length
    };
}

let running = false;

async function run(mode) {
    if (running) {
        return { url: location.href, groups: [] };
    }

    running = true;

    try {
        const store = await loadStore();
        const { units, idx } = buildUnits();
        const groups = new Map();

        units.forEach(u => {
            const k = u.form || 'doc';

            if (!groups.has(k)) groups.set(k, []);

            groups.get(k).push(u);
        });

        const report = [];

        for (const list of groups.values()) {
            report.push(await processGroup(list, idx, mode, store));
        }

        return {
            url: location.href,
            isTop: window === window.top,
            groups: report
        };
    } finally {
        running = false;
    }
}

window.__FA_RUN = run;

/* =====================================================================
   FIREFOX / CHROME STORAGE COMPATIBILITY
===================================================================== */

async function loadStore() {
    try {
        const d = await ext.storage.local.get([
            'profiles',
            'active',
            'settings',
            'learned'
        ]);

        const profiles =
            d.profiles && d.profiles.length
                ? d.profiles
                : [FA.defaultProfile()];

        return {
            profiles,
            active: Math.min(d.active || 0, profiles.length - 1),
            settings: Object.assign({
                overwrite: false,
                auto: false,
                learn: true,
                useLLM: false
            }, d.settings || {}),
            learned: d.learned || {}
        };
    } catch (error) {
        console.error('SmartForm Filler storage error:', error);

        const profiles = [FA.defaultProfile()];

        return {
            profiles,
            active: 0,
            settings: {
                overwrite: false,
                auto: false,
                learn: true,
                useLLM: false
            },
            learned: {}
        };
    }
}

/* =====================================================================
   10. LEARNING, STATUS REPORTING, AUTO MODE
===================================================================== */

document.addEventListener('change', async e => {
    if (!e.isTrusted) return;

    const el = e.target;

    if (
        !el ||
        !/^(INPUT|SELECT|TEXTAREA)$/.test(el.tagName) ||
        el.type === 'file'
    ) return;

    const st = await loadStore();

    if (!st.settings.learn) return;

    const typed = el.tagName === 'SELECT'
        ? (el.selectedOptions[0] || {}).text
        : el.value;

    const nv = norm(typed);

    if (!nv || nv.length < 3) return;

    const f = st.profiles[st.active].fields.find(
        x => norm(x.value) === nv
    );

    if (!f) return;

    const t = (
        labelTexts(el, buildTextIndex()).find(x => x.w >= 0.95) || {}
    ).t;

    if (!t || t.length > 60) return;

    const c = FA.CANON.find(c => c.key === f.key);

    const known = [
        f.label,
        f.key,
        ...(c ? c.syn : []),
        ...(f.synonyms || [])
    ].map(norm);

    if (known.some(k => sim(norm(t), k) >= 0.8)) return;

    const learned = st.learned;

    learned[f.key] = [
        ...new Set([...(learned[f.key] || []), t])
    ].slice(-20);

    try {
        await ext.storage.local.set({ learned });
    } catch (error) {
        console.error('SmartForm Filler learning error:', error);
    }
}, true);

function countFillable() {
    try {
        return (
            deepQuery('input,select,textarea').filter(isFillable).length +
            deepQuery('[role=radiogroup],[role=listbox]')
                .filter(isVisible).length
        );
    } catch (e) {
        return 0;
    }
}

let lastCount = -1;

function reportStatus() {
    const n = countFillable();

    if (n === lastCount) return;

    lastCount = n;

    ext.runtime.sendMessage({
        type: 'status',
        count: n
    }).catch(() => {});
}

(async () => {
    let st = await loadStore();

    try {
        ext.storage.onChanged.addListener(() => {
            loadStore().then(s => {
                st = s;
            });
        });
    } catch (e) {}

    let runs = 0;
    let tA = null;
    let tS = null;

    const sched = () => {
        clearTimeout(tS);
        tS = setTimeout(reportStatus, 1200);

        if (st.settings.auto) {
            clearTimeout(tA);

            tA = setTimeout(() => {
                if (runs++ < 6) run('fill');
            }, 900);
        }
    };

    sched();

    new MutationObserver(sched).observe(
        document.documentElement,
        {
            childList: true,
            subtree: true
        }
    );

    window.addEventListener('load', sched);
})();

})();
