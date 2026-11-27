const core = 'https://atomicdata.dev/properties/';
const prefix = 'inbox-rs-item/v1:';
const fields = [
  ['name', 'Title'],
  ['url', 'URL (optional)'],
  ['body', 'Note', true],
];
const filename = 'https://atomicdata.dev/properties/filename';

function el(tag, text) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  return node;
}

async function inbox(store) {
  const { table, rowClass } = await store.getData();
  if (!table || !rowClass) throw new Error('Inbox RS needs an inbox table.');

  function item(row) {
    if (row.error) throw new Error('Atomic could not read an inbox item.');
    const data = row.get(`${core}description`);
    if (
      row.get(`${core}parent`) !== table ||
      !row.get(`${core}isA`)?.includes(rowClass) ||
      typeof data !== 'string' ||
      !data.startsWith(prefix)
    )
      return;
    return {
      ...JSON.parse(data.slice(prefix.length)),
      name: row.get(`${core}name`),
      subject: row.subject,
    };
  }

  return {
    async list() {
      const all = await store.query({
        property: `${core}parent`,
        value: table,
      });
      if (all.length >= 500)
        throw new Error('This version supports fewer than 500 rows.');
      const result = [];
      for (let offset = 0; offset < all.length; offset += 100) {
        const rows = await store.getMany(all.slice(offset, offset + 100));
        result.push(...rows.map(item).filter(Boolean));
      }
      return result.sort((first, second) =>
        first.name.localeCompare(second.name),
      );
    },
    async save({ subject, name, ...record }) {
      const props = {
        [`${core}name`]: name,
        [`${core}description`]: prefix + JSON.stringify(record),
      };
      if (!subject) {
        await store.newResource({
          parent: table,
          isA: [rowClass],
          propVals: props,
        });
        return;
      }
      const row = await store.getResource(subject);
      if (!item(row)) throw new Error('That item is outside this inbox.');
      for (const [property, value] of Object.entries(props))
        row.set(property, value);
      await row.save();
    },
    async remove(subject) {
      const row = await store.getResource(subject);
      if (!item(row)) throw new Error('That item is outside this inbox.');
      await row.destroy();
    },
  };
}

export async function view({ root, store }) {
  const items = await inbox(store);
  const style = el(
    'style',
    `
    main { max-width: 60rem; margin: auto; padding: 1.25rem; font: 1rem system-ui; }
    fieldset { display: grid; gap: .6rem; }
    fieldset label, fieldset input, textarea { display: block; width: 100%; box-sizing: border-box; }
    textarea { min-height: 4rem; }
    input, textarea, button { font: inherit; padding: .35rem; }
    button { margin: .2rem .4rem .2rem 0; }
    article { border-top: 1px solid #8886; margin-block: 1rem; padding-block: .5rem; }
    label input[type=checkbox] { display: inline; width: auto; }
    pre { white-space: pre-wrap; overflow-wrap: anywhere; }
  `,
  );
  const main = el('main');
  const editor = el('fieldset');
  editor.append(el('legend', 'New item'));
  const input = {};
  for (const [key, label, multiline] of fields) {
    input[key] = el(multiline ? 'textarea' : 'input');
    if (key === 'url') input[key].type = 'url';
    const wrapper = el('label', label);
    wrapper.append(input[key]);
    editor.append(wrapper);
  }
  const actions = el('div');
  const save = el('button', 'Add to inbox');
  const cancel = el('button', 'Cancel edit');
  const attach = el('button', 'Choose attachment');
  attach.hidden = !store.ui?.pickFile;
  const attachment = el('p');
  actions.append(save, attach, cancel, attachment);
  editor.append(actions);
  const status = el('p');
  status.setAttribute('role', 'status');
  const filterLabel = el('label', 'Find items');
  const filter = el('input');
  filter.type = 'search';
  filterLabel.append(filter);
  const includeDone = el('input');
  includeDone.type = 'checkbox';
  const includeLabel = el('label', 'Show archived items');
  includeLabel.prepend(includeDone);
  const results = el('section');
  main.append(
    el('h1', 'Inbox RS'),
    editor,
    status,
    filterLabel,
    includeLabel,
    results,
  );
  root.replaceChildren(style, main);

  let all = [];
  let selected;
  let busy = false;
  let file;

  function edit(record) {
    selected = record;
    file = record?.file;
    attachment.textContent = file?.name ?? '';
    for (const [key] of fields) {
      input[key].value = record?.[key] || '';
    }
    save.textContent = record ? 'Save item' : 'Add to inbox';
    cancel.hidden = !record;
  }

  function render() {
    results.replaceChildren();
    const query = filter.value.trim().toLocaleLowerCase();
    for (const item of all) {
      if (item.archived && !includeDone.checked) continue;
      if (
        ![item.name, item.body, item.url, item.file?.name]
          .join(' ')
          .toLocaleLowerCase()
          .includes(query)
      )
        continue;
      const card = el('article');
      card.append(el('h2', item.name));
      if (item.url) {
        const label = el('label', 'Saved URL');
        const url = el('input');
        url.value = item.url;
        url.readOnly = true;
        url.addEventListener('focus', () => url.select());
        label.append(url);
        card.append(label);
      }
      if (item.body) card.append(el('pre', item.body));
      if (item.file) {
        const open = el('button', 'Open attachment in Atomic');
        open.hidden = !store.ui?.openResource;
        open.addEventListener('click', () =>
          run(() => store.ui.openResource(item.file.subject)),
        );
        card.append(el('p', item.file.name), open);
      }
      const archive = el(
        'button',
        item.archived ? 'Return to inbox' : 'Archive item',
      );
      archive.addEventListener('click', () =>
        run(
          async () => {
            await items.save({ ...item, archived: !item.archived });
            if (selected?.subject === item.subject)
              selected = { ...item, archived: !item.archived };
          },
          item.archived ? 'Item returned to inbox.' : 'Item archived.',
        ),
      );
      const change = el('button', 'Edit item');
      change.addEventListener('click', () => {
        if (!busy) edit(item);
      });
      const remove = el('button', 'Delete item');
      remove.addEventListener('click', () => {
        if (busy || !window.confirm(`Delete ${item.name} from the inbox?`))
          return;
        run(async () => {
          await items.remove(item.subject);
          if (selected?.subject === item.subject) edit();
        }, 'Item deleted.');
      });
      card.append(archive, change, remove);
      results.append(card);
    }
    if (!results.children.length) results.append(el('p', 'No matching items.'));
  }

  async function run(operation, message = '') {
    if (busy) return;
    busy = editor.disabled = true;
    status.textContent = '';
    try {
      await operation();
      all = await items.list();
      render();
      status.textContent = message;
    } catch (error) {
      status.textContent = error.message;
    } finally {
      busy = editor.disabled = false;
    }
  }

  filter.addEventListener('input', render);
  includeDone.addEventListener('change', render);
  cancel.addEventListener('click', () => edit());
  attach.addEventListener('click', () =>
    run(async () => {
      const subject = await store.ui.pickFile();
      if (!subject) return;
      const resource = await store.getResource(subject);
      file = {
        subject,
        name: resource.get(filename) || resource.title || 'Attachment',
      };
      attachment.textContent = file.name;
    }),
  );
  save.addEventListener('click', () =>
    run(async () => {
      const name = input.name.value.trim();
      if (!name) throw new Error('Enter a title.');
      const value = input.url.value.trim();
      let url = '';
      if (value) {
        const parsed = new URL(value);
        if (
          !['https:', 'http:'].includes(parsed.protocol) ||
          parsed.username ||
          parsed.password
        ) {
          throw new Error('Enter an HTTP or HTTPS URL without credentials.');
        }
        url = parsed.href;
      }
      await items.save({
        subject: selected?.subject,
        name,
        url,
        file,
        type: file ? 'document' : url ? 'bookmark' : 'note',
        body: input.body.value,
        createdAt: selected?.createdAt || new Date().toISOString(),
        archived: selected?.archived ?? false,
      });
      edit();
    }, 'Item saved.'),
  );
  edit();
  await run(async () => {}, '');
}
