'use strict';

/* ---------- browser compatibility ---------- */

const ext = globalThis.browser || globalThis.chrome;

if (!ext) {
    throw new Error('SmartForm Filler: Browser extension API unavailable.');
}

const $ = id => document.getElementById(id);

const S = {
    profiles: [],
    active: 0,
    settings: {}
};

/* ---------- element helper ---------- */

function h(tag, attrs = {}, ...kids) {
    const e = document.createElement(tag);

    for (const [k, v] of Object.entries(attrs)) {
        if (k === 'class') {
            e.className = v;
        } else if (k.startsWith('on')) {
            e[k] = v;
        } else if (k === 'value') {
            e.value = v;
        } else {
            e.setAttribute(k, v);
        }
    }

    kids.flat().forEach(c => {
        e.append(
            c && c.nodeType
                ? c
                : document.createTextNode(c == null ? '' : c)
        );
    });

    return e;
}

/* ---------- storage ---------- */

let timer;

async function touch() {
    $('status').textContent = 'Saving…';

    clearTimeout(timer);

    timer = setTimeout(async () => {
        try {
            await ext.storage.local.set({
                profiles: S.profiles,
                active: S.active,
                settings: S.settings
            });

            $('status').textContent = 'All changes saved';

        } catch (error) {
            console.error('SmartForm Filler: Storage error:', error);
            $('status').textContent = 'Could not save changes';
        }
    }, 450);
}

/* ---------- profile preparation ---------- */

function ensure(p) {
    p.keywords = p.keywords || [];
    p.fields = p.fields || [];

    FA.CANON.forEach(c => {
        if (!p.fields.some(f => f.key === c.key)) {
            p.fields.push({
                key: c.key,
                label: c.label,
                value: '',
                synonyms: []
            });
        }
    });

    return p;
}

/* ---------- initialize ---------- */

async function initialize() {
    try {
        const d = await ext.storage.local.get([
            'profiles',
            'active',
            'settings'
        ]);

        S.profiles = (
            d.profiles && d.profiles.length
                ? d.profiles
                : [FA.defaultProfile()]
        ).map(ensure);

        S.active = Math.min(
            Number.isInteger(d.active) ? d.active : 0,
            S.profiles.length - 1
        );

        S.settings = Object.assign({
            overwrite: false,
            auto: false,
            learn: true,
            useLLM: false,
            apiKey: '',
            model: 'claude-haiku-5-5'
        }, d.settings || {});

        bindSettings();
        render();

    } catch (error) {
        console.error('SmartForm Filler: Initialization error:', error);

        S.profiles = [ensure(FA.defaultProfile())];
        S.active = 0;

        S.settings = {
            overwrite: false,
            auto: false,
            learn: true,
            useLLM: false,
            apiKey: '',
            model: 'claude-haiku-5-5'
        };

        bindSettings();
        render();

        $('status').textContent = 'Storage could not be loaded';
    }
}

initialize();

/* ---------- tabs ---------- */

document.querySelectorAll('nav button').forEach(b => {
    b.onclick = () => {
        document.querySelectorAll('nav button').forEach(x => {
            const active = x === b;

            x.classList.toggle('on', active);

            if (active) {
                x.setAttribute('aria-current', 'page');
            } else {
                x.removeAttribute('aria-current');
            }
        });

        $('tab-profile').hidden = b.dataset.tab !== 'profile';
        $('tab-settings').hidden = b.dataset.tab !== 'settings';
    };
});

/* ---------- profile list ---------- */

function renderList() {
    const ul = $('plist');
    ul.textContent = '';

    S.profiles.forEach((p, i) => {
        const b = h(
            'button',
            {
                type: 'button',
                class: i === S.active ? 'on' : '',
                onclick: () => {
                    S.active = i;
                    touch();
                    render();
                }
            },
            h('span', {}, p.name),
            i === S.active
                ? h('span', { class: 'tag' }, 'Default')
                : ''
        );

        ul.append(h('li', {}, b));
    });
}

$('newProfile').onclick = () => {
    const name = prompt(
        'Name for the new profile (for example: Work, or a family member)'
    );

    if (!name || !name.trim()) return;

    const p = ensure(FA.defaultProfile());

    p.name = name.trim();

    S.profiles.push(p);
    S.active = S.profiles.length - 1;

    touch();
    render();
};

/* ---------- photo ---------- */

function loadImg(file) {
    return new Promise((res, rej) => {
        const u = URL.createObjectURL(file);
        const i = new Image();

        i.onload = () => {
            URL.revokeObjectURL(u);
            res(i);
        };

        i.onerror = error => {
            URL.revokeObjectURL(u);
            rej(error);
        };

        i.src = u;
    });
}

async function processPhoto(file) {
    const img = await loadImg(file);

    const make = (w, hgt, q) => {
        const c = document.createElement('canvas');

        c.width = w;
        c.height = hgt;

        const x = c.getContext('2d');

        x.fillStyle = '#fff';
        x.fillRect(0, 0, w, hgt);

        const ratio = w / hgt;

        let sw = img.width;
        let sh = sw / ratio;

        if (sh > img.height) {
            sh = img.height;
            sw = sh * ratio;
        }

        x.drawImage(
            img,
            (img.width - sw) / 2,
            (img.height - sh) * 0.25,
            sw,
            sh,
            0,
            0,
            w,
            hgt
        );

        return c.toDataURL('image/jpeg', q);
    };

    return {
        name: file.name,
        std: make(413, 531, 0.92),
        small: make(240, 308, 0.7)
    };
}

function photoCard(p) {
    const frame = h('div', { class: 'frame' }, 'No photo');

    if (p.photo) {
        frame.textContent = '';

        frame.append(
            h('img', {
                src: p.photo.std,
                alt: 'Passport size photo'
            })
        );
    }

    const file = h('input', {
        type: 'file',
        accept: 'image/*',
        hidden: ''
    });

    file.onchange = async () => {
        if (!file.files || !file.files[0]) return;

        try {
            p.photo = await processPhoto(file.files[0]);

            touch();
            render();

        } catch (error) {
            console.error('Photo processing error:', error);

            alert('That image could not be read. Try a JPG or PNG.');
        }
    };

    const up = h(
        'button',
        {
            type: 'button',
            class: 'btn primary',
            onclick: () => file.click()
        },
        p.photo ? 'Replace photo' : 'Upload photo'
    );

    const rm = h(
        'button',
        {
            type: 'button',
            class: 'btn danger',
            onclick: () => {
                p.photo = null;
                touch();
                render();
            }
        },
        'Remove'
    );

    return h(
        'div',
        { class: 'card' },

        h('h2', {}, 'Passport size photo'),

        h(
            'p',
            { class: 'lead' },
            'Used for photo upload fields on forms.'
        ),

        h(
            'div',
            { class: 'photo' },

            frame,

            h(
                'div',
                {},

                h(
                    'div',
                    { class: 'btns' },
                    up,
                    p.photo ? rm : ''
                ),

                h(
                    'div',
                    { class: 'hint' },
                    'Cropped to the passport ratio (35 × 45 mm) and stored only in this browser. A smaller copy is kept for forms with a file size limit.'
                )
            ),

            file
        )
    );
}

/* ---------- fields ---------- */

function fieldEl(f, p, custom) {
    const m = FA.META[f.key] || {};

    let ctl;

    if (m.input === 'select') {
        ctl = h(
            'select',
            {},
            h('option', { value: '' }, 'Not set')
        );

        const opts = [...m.options];

        if (f.value && !opts.includes(f.value)) {
            opts.push(f.value);
        }

        opts.forEach(o => {
            ctl.append(h('option', { value: o }, o));
        });

        ctl.value = f.value || '';

    } else {
        ctl = h('input', {
            type: m.input || 'text'
        });

        ctl.value = f.value || '';

        if (m.input === 'date') {
            ctl.max = '2100-12-31';
        }
    }

    const upd = () => {
        f.value = ctl.value;
        progress(p);
        touch();
    };

    ctl.addEventListener('input', upd);
    ctl.addEventListener('change', upd);

    const alias = h('input', {
        type: 'text',
        placeholder: 'Other names, separated by commas'
    });

    alias.value = (f.synonyms || []).join(', ');

    alias.oninput = () => {
        f.synonyms = alias.value
            .split(',')
            .map(x => x.trim())
            .filter(Boolean);

        touch();
    };

    const det = h(
        'details',
        { class: 'alias' },
        h('summary', {}, 'Other names for this field'),
        alias
    );

    if ((f.synonyms || []).length) {
        det.open = true;
    }

    const id = 'f_' + f.key;

    ctl.id = id;

    const label = h(
        'label',
        { class: 'l', for: id },
        f.label
    );

    if (custom) {
        label.append(
            h(
                'button',
                {
                    type: 'button',
                    class: 'remove',
                    onclick: () => {
                        p.fields.splice(p.fields.indexOf(f), 1);
                        touch();
                        render();
                    }
                },
                'Remove'
            )
        );
    }

    return h(
        'div',
        { class: 'field' },
        label,
        ctl,
        m.hint ? h('div', { class: 'hint' }, m.hint) : '',
        det
    );
}

/* ---------- profile progress ---------- */

function progress(p) {
    const list = p.fields.filter(f =>
        FA.META[f.key] ||
        !FA.CANON.some(c => c.key === f.key)
    );

    const filled =
        list.filter(f => String(f.value || '').trim()).length +
        (p.photo ? 1 : 0);

    const total = list.length + 1;

    const pct = Math.round(filled / total * 100);

    const el = $('meterFill');

    if (el) {
        el.style.width = pct + '%';
    }

    const tx = $('meterText');

    if (tx) {
        tx.textContent = `${filled} of ${total} filled`;
    }
}

/* ---------- render profiles ---------- */

function render() {
    renderList();

    const p = S.profiles[S.active];

    const panel = $('panel');

    panel.textContent = '';

    const name = h('input', {
        type: 'text',
        class: 'name',
        'aria-label': 'Profile name'
    });

    name.value = p.name;

    name.oninput = () => {
        p.name = name.value || 'Untitled';

        renderList();
        touch();
    };

    const del = h(
        'button',
        {
            type: 'button',
            class: 'btn danger',
            onclick: () => {
                if (S.profiles.length < 2) {
                    return alert('You need at least one profile.');
                }

                if (confirm(`Delete the profile "${p.name}"?`)) {
                    S.profiles.splice(S.active, 1);

                    S.active = 0;

                    touch();
                    render();
                }
            }
        },
        'Delete profile'
    );

    const kw = h('input', {
        type: 'text',
        id: 'kw',
        placeholder: 'job, career, resume'
    });

    kw.value = p.keywords.join(', ');

    kw.oninput = () => {
        p.keywords = kw.value
            .split(',')
            .map(x => x.trim())
            .filter(Boolean);

        touch();
    };

    panel.append(
        h(
            'div',
            { class: 'card' },

            h('div', { class: 'head' }, name, del),

            h(
                'div',
                { class: 'meter' },

                h(
                    'div',
                    { class: 'track' },
                    h('div', {
                        class: 'fill',
                        id: 'meterFill'
                    })
                ),

                h('span', { id: 'meterText' })
            ),

            h(
                'div',
                {
                    class: 'field',
                    style: 'margin-top:16px'
                },

                h(
                    'label',
                    { class: 'l', for: 'kw' },
                    'Use this profile automatically when the form title contains'
                ),

                kw,

                h(
                    'div',
                    { class: 'hint' },
                    'The default profile is used for every other form. Leave empty if this profile should only be used when you pick it.'
                )
            )
        )
    );

    panel.append(photoCard(p));

    FA.GROUPS.forEach(g => {
        const fields = p.fields.filter(
            f => (FA.META[f.key] || {}).group === g.id
        );

        if (!fields.length) return;

        panel.append(
            h(
                'div',
                { class: 'card' },

                h('h2', {}, g.title),

                h(
                    'div',
                    {
                        class: 'grid',
                        style: 'margin-top:12px'
                    },
                    fields.map(f => fieldEl(f, p, false))
                )
            )
        );
    });

    const custom = p.fields.filter(
        f => !FA.CANON.some(c => c.key === f.key)
    );

    const nf = h('input', {
        type: 'text',
        placeholder: 'For example: Driving licence number'
    });

    const add = () => {
        const label = nf.value.trim();

        if (!label) return;

        let key = label
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '_')
            .replace(/^_|_$/g, '') || 'field';

        while (p.fields.some(f => f.key === key)) {
            key += '_2';
        }

        p.fields.push({
            key,
            label,
            value: '',
            synonyms: []
        });

        touch();
        render();
    };

    nf.onkeydown = e => {
        if (e.key === 'Enter') {
            add();
        }
    };

    panel.append(
        h(
            'div',
            { class: 'card' },

            h('h2', {}, 'Your own fields'),

            h(
                'p',
                { class: 'lead' },
                'Anything a form might ask that is not listed above. Use the question as the field name, and the answer as its value. Dropdowns, radio buttons and checkboxes are matched by their option text.'
            ),

            custom.length
                ? h(
                    'div',
                    { class: 'grid' },
                    custom.map(f => fieldEl(f, p, true))
                )
                : '',

            h(
                'div',
                { class: 'addrow' },
                nf,
                h(
                    'button',
                    {
                        type: 'button',
                        class: 'btn primary',
                        onclick: add
                    },
                    'Add field'
                )
            )
        )
    );

    progress(p);
}

/* ---------- settings ---------- */

function bindSettings() {
    ['auto', 'overwrite', 'learn', 'useLLM'].forEach(k => {
        $(k).checked = !!S.settings[k];

        $(k).onchange = () => {
            S.settings[k] = $(k).checked;

            if (k === 'useLLM') {
                aiVis();
            }

            touch();
        };
    });

    ['apiKey', 'model'].forEach(k => {
        $(k).value = S.settings[k] || '';

        $(k).oninput = () => {
            S.settings[k] = $(k).value.trim();
            touch();
        };
    });

    aiVis();
}

const aiVis = () => {
    $('aiBox').style.display =
        S.settings.useLLM ? 'grid' : 'none';
};

/* ---------- keyboard shortcuts ---------- */

$('shortcut').onclick = async () => {
    try {
        if (globalThis.browser) {
            // Firefox: open Add-ons Manager.
            // Open Manage Extension Shortcuts from its settings menu.
            await ext.tabs.create({
                url: 'about:addons'
            });
        } else {
            // Chrome: open extension keyboard shortcuts.
            await ext.tabs.create({
                url: 'chrome://extensions/shortcuts'
            });
        }
    } catch (error) {
        console.error('Could not open shortcut settings:', error);

        alert('Could not open keyboard shortcut settings. Please open your browser extension settings manually.');
    }
};

/* ---------- clear learned names ---------- */

$('clearLearned').onclick = async () => {
    try {
        await ext.storage.local.remove('learned');

        $('status').textContent = 'Learned names cleared';

    } catch (error) {
        console.error('Could not clear learned names:', error);

        $('status').textContent = 'Could not clear learned names';
    }
};

/* ---------- export profiles ---------- */

$('export').onclick = () => {
    try {
        const blob = new Blob(
            [
                JSON.stringify({
                    profiles: S.profiles
                }, null, 2)
            ],
            {
                type: 'application/json'
            }
        );

        const url = URL.createObjectURL(blob);

        const a = h('a', {
            href: url,
            download: 'smartform-profiles.json'
        });

        document.body.append(a);
        a.click();
        a.remove();

        setTimeout(() => {
            URL.revokeObjectURL(url);
        }, 1000);

    } catch (error) {
        console.error('Export error:', error);

        alert('Could not export profiles.');
    }
};

/* ---------- import profiles ---------- */

$('import').onclick = () => {
    $('importFile').click();
};

$('importFile').onchange = async e => {
    const file = e.target.files && e.target.files[0];

    if (!file) return;

    try {
        const data = JSON.parse(await file.text());

        if (
            !data ||
            !Array.isArray(data.profiles) ||
            !data.profiles.length
        ) {
            throw new Error('Invalid backup format');
        }

        if (!confirm('This replaces your current profiles. Continue?')) {
            e.target.value = '';
            return;
        }

        S.profiles = data.profiles.map(ensure);
        S.active = 0;

        touch();
        render();

    } catch (error) {
        console.error('Import error:', error);

        alert('That file is not a valid SmartForm Filler export.');

    } finally {
        e.target.value = '';
    }
};
