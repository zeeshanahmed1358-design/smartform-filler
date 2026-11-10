/* ============================================================
   SMARTFORM FILLER — POPUP CONTROLLER
   Firefox + Chrome Compatible
   Profile Management | Form Scanning | Autofill
   ============================================================ */

(() => {
  'use strict';

  /* ==========================================================
     1. BROWSER API
     ========================================================== */

  const ext = globalThis.browser || globalThis.chrome;

  if (!ext) {
    throw new Error('SmartForm Filler: Browser API unavailable.');
  }

  /* ==========================================================
     2. DOM UTILITIES
     ========================================================== */

  const $ = id => document.getElementById(id);

  const h = (tag, cls = '', text = null) => {
    const element = document.createElement(tag);

    if (cls) element.className = cls;
    if (text != null) element.textContent = text;

    return element;
  };

  const requiredElements = [
    'pill', 'prof', 'photo', 'body',
    'fill', 'rescan', 'opts'
  ];

  function validateDOM() {
    const missing = requiredElements.filter(id => !$(id));

    if (missing.length) {
      console.error('[SmartForm Filler] Missing popup elements:', missing);
      return false;
    }

    return true;
  }

  /* ==========================================================
     3. APPLICATION STATE
     ========================================================== */

  const store = {
    profiles: [],
    active: 0
  };

  let groups = [];
  let scanAvailable = false;

  const KIND = {
    radio: 'option',
    checkgroup: 'options',
    checkbox: 'checkbox',
    select: 'list',
    dropdown: 'list',
    file: 'photo',
    text: ''
  };

  /* ==========================================================
     4. STATUS MANAGEMENT
     ========================================================== */

  function setPill(kind, text) {
    const pill = $('pill');

    pill.className = 'pill ' + kind;
    pill.textContent = text;
  }

  function setButton(text, disabled = false) {
    $('fill').textContent = text;
    $('fill').disabled = disabled;
  }

  /* ==========================================================
     5. PROFILE STORAGE
     ========================================================== */

  async function loadStore() {
    try {
      const data = await ext.storage.local.get([
        'profiles',
        'active'
      ]);

      store.profiles =
        Array.isArray(data.profiles) && data.profiles.length
          ? data.profiles
          : [{
              name: 'Personal',
              photo: null,
              fields: []
            }];

      const active = Number(data.active);

      store.active = Number.isInteger(active)
        ? Math.max(0, Math.min(active, store.profiles.length - 1))
        : 0;

    } catch (error) {
      console.error('[SmartForm Filler] Profile loading failed:', error);

      store.profiles = [{
        name: 'Personal',
        photo: null,
        fields: []
      }];

      store.active = 0;
    }
  }

  /* ==========================================================
     6. PROFILE HELPERS
     ========================================================== */

  function getActiveProfile() {
    return store.profiles[store.active] || {
      name: 'Personal',
      photo: null,
      fields: []
    };
  }

  function getFilledFields(profile) {
    return (profile.fields || []).filter(field =>
      String(field.value ?? '').trim() !== ''
    );
  }

  function hasProfileData(profile) {
    return getFilledFields(profile).length > 0 ||
      Boolean(profile.photo);
  }

  /* ==========================================================
     7. PROFILE SELECTOR
     ========================================================== */

  function renderProfile() {
    const select = $('prof');

    select.textContent = '';

    store.profiles.forEach((profile, index) => {
      const option = h(
        'option',
        '',
        profile.name || `Profile ${index + 1}`
      );

      option.value = index;
      select.append(option);
    });

    select.value = String(store.active);

    const profile = getActiveProfile();
    const photo = $('photo');

    photo.className = 'chip' + (
      profile.photo ? ' ok' : ''
    );

    photo.textContent = profile.photo
      ? 'Photo ready'
      : 'No photo';

    const filled = getFilledFields(profile).length;

    if (!filled && !profile.photo) {
      setPill('warn', 'Profile is empty');
    }
  }

  /* ==========================================================
     8. ACTIVE TAB / CONTENT SCRIPT EXECUTION
     ========================================================== */

  async function exec(mode) {
    try {
      const [tab] = await ext.tabs.query({
        active: true,
        currentWindow: true
      });

      if (!tab || tab.id == null) {
        throw new Error('No active browser tab found.');
      }

      const results = await ext.scripting.executeScript({
        target: {
          tabId: tab.id,
          allFrames: true
        },

        func: mode => {
          if (typeof window.__FA_RUN !== 'function') {
            return null;
          }

          return window.__FA_RUN(mode);
        },

        args: [mode]
      });

      return results
        .map(result => result.result)
        .filter(Boolean);

    } catch (error) {
      console.error(
        `[SmartForm Filler] ${mode} execution failed:`,
        error
      );

      return null;
    }
  }

  /* ==========================================================
     9. RESULT ROW COMPONENT
     ========================================================== */

  function row(kind, mark, label, right) {
    const element = h('div', 'row ' + kind);

    element.append(
      h('span', 'dot', mark),
      h('span', 'lbl', label),
      h('span', 'key', right)
    );

    return element;
  }

  /* ==========================================================
     10. FORM RESULT RENDERING
     ========================================================== */

  function render(mode) {
    const body = $('body');

    body.textContent = '';

    groups.forEach(group => {
      const card = h('div', 'card');

      // Form title
      card.append(
        h(
          'h3',
          '',
          group.title?.text || 'Untitled form'
        )
      );

      // Form information
      const information = [];

      information.push(
        'Profile: ' +
        (group.profile || 'Personal') +
        (group.profileAuto ? ' (picked from the title)' : '')
      );

      if (group.types?.length) {
        information.push(
          'looks like: ' + group.types.join(', ')
        );
      }

      card.append(
        h('div', 'sub', information.join('. '))
      );

      // Matched fields
      (group.matches || []).forEach(match => {
        const kind = KIND[match.kind]
          ? ' · ' + KIND[match.kind]
          : '';

        if (mode === 'fill') {
          card.append(
            match.applied
              ? row(
                  'done',
                  '✓',
                  match.label,
                  match.key + kind
                )
              : row(
                  'fail',
                  '!',
                  match.label,
                  'could not fill'
                )
          );
        } else {
          card.append(
            row(
              '',
              '✓',
              match.label,
              match.key + kind
            )
          );
        }
      });

      // Uncertain matches
      (group.uncertain || []).forEach(match => {
        card.append(
          row(
            'review',
            '?',
            match.label,
            match.candidate
              ? 'unsure: ' + match.candidate
              : 'no match'
          )
        );
      });

      // Existing field values
      if (group.alreadyFilled) {
        card.append(
          h(
            'div',
            'sub',
            group.alreadyFilled +
            ' field(s) already had a value and were left alone.'
          )
        );
      }

      body.append(card);
    });
  }

  /* ==========================================================
     11. FRAME RESULT HELPERS
     ========================================================== */

  function collectGroups(frames) {
    return frames.flatMap(frame =>
      Array.isArray(frame.groups)
        ? frame.groups
        : []
    );
  }

  function countMatches() {
    return groups.reduce(
      (total, group) =>
        total + (group.matches || []).length,
      0
    );
  }

  /* ==========================================================
     12. SCAN FORMS
     ========================================================== */

  async function scan() {
    renderProfile();

    const profile = getActiveProfile();

    setPill('', 'Checking');
    setButton('Checking...', true);

    const frames = await exec('scan');

    $('body').textContent = '';

    if (frames === null) {
      scanAvailable = false;

      setPill('', 'Not available here');

      $('body').append(
        h(
          'div',
          'empty',
          'Browser pages and extension store pages cannot be scanned.'
        )
      );

      setButton('Scan unavailable', true);
      return;
    }

    scanAvailable = true;
    groups = collectGroups(frames);

    if (!groups.length) {
      setPill('', 'No form detected');

      $('body').append(
        h(
          'div',
          'empty',
          'Open a page that has a form and it will be detected automatically.'
        )
      );

      setButton('Nothing to fill', true);
      return;
    }

    const total = countMatches();

    setPill('ok', 'Form detected');

    render('scan');

    const canFill = total > 0 && hasProfileData(profile);

    setButton(
      total
        ? `Fill ${total} field${total > 1 ? 's' : ''}`
        : 'Nothing to fill',
      !canFill
    );

    if (!hasProfileData(profile)) {
      $('body').prepend(
        h(
          'div',
          'empty',
          'Add your details in Edit profile first.'
        )
      );
    }
  }

  /* ==========================================================
     13. FILL DETECTED FORMS
     ========================================================== */

  async function fill() {
    if (!scanAvailable) {
      await scan();
      return;
    }

    const profile = getActiveProfile();

    if (!hasProfileData(profile)) {
      setPill('warn', 'Profile is empty');
      return;
    }

    setButton('Filling...', true);
    setPill('', 'Filling');

    const frames = await exec('fill');

    if (frames === null) {
      setPill('warn', 'Fill failed');
      setButton('Try again', false);
      return;
    }

    groups = collectGroups(frames);

    const done = groups.reduce(
      (total, group) =>
        total +
        (group.matches || []).filter(match => match.applied).length,
      0
    );

    const total = groups.reduce(
      (count, group) =>
        count +
        (group.matches || []).length +
        (group.uncertain || []).length,
      0
    );

    const failed = groups.reduce(
      (count, group) =>
        count +
        (group.matches || []).filter(match => match.failed).length +
        (group.uncertain || []).length,
      0
    );

    setPill(
      failed ? 'warn' : 'done',
      `Filled ${done} of ${total}`
    );

    render('fill');

    setButton('Fill again', false);
  }

  /* ==========================================================
     14. EVENT LISTENERS
     ========================================================== */

  function bindEvents() {

    // Fill forms
    $('fill').addEventListener('click', fill);

    // Rescan current page
    $('rescan').addEventListener('click', event => {
      event.preventDefault();
      scan();
    });

    // Open profile settings
    $('opts').addEventListener('click', event => {
      event.preventDefault();

      ext.runtime.openOptionsPage().catch(error => {
        console.error(
          '[SmartForm Filler] Could not open options page:',
          error
        );
      });
    });

    // Switch profile
    $('prof').addEventListener('change', async event => {
      store.active = Number(event.target.value);

      try {
        await ext.storage.local.set({
          active: store.active
        });

        await scan();

      } catch (error) {
        console.error(
          '[SmartForm Filler] Profile update failed:',
          error
        );

        setPill('warn', 'Could not save profile');
      }
    });
  }

  /* ==========================================================
     15. APPLICATION INITIALIZATION
     ========================================================== */

  async function init() {
    if (!validateDOM()) return;

    await loadStore();

    bindEvents();

    await scan();

    console.info('[SmartForm Filler] Popup initialized.');
  }

  // Start application
  init().catch(error => {
    console.error(
      '[SmartForm Filler] Initialization failed:',
      error
    );

    setPill('warn', 'Initialization failed');
  });

})();
