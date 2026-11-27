const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const {test} = require('node:test');

function node(tag) {
    return {
        tag, value: '', children: [], handlers: {},
        prepend(...children) { this.children.unshift(...children); },
        append(...children) { this.children.push(...children); },
        replaceChildren(...children) { this.children = children; },
        setAttribute() {},
        addEventListener(type, handler) { this.handlers[type] = handler; },
    };
}

function find(root, predicate) {
    if (predicate(root)) return root;
    for (const child of root.children) {
        const result = find(child, predicate);
        if (result) return result;
    }
}

test('capture a note and archive it in the Atomic table', async () => {
    const source = readFileSync('atomic/inbox-rs-0.1.0.js', 'utf8');
    const {view} = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
    global.document = {createElement: node};
    const core = 'https://atomicdata.dev/properties/';
    const data = new Map();
    function resource(subject) {
        const props = {...data.get(subject)};
        return {
            subject,
            get: key => props[key],
            set: (key, value) => { props[key] = value; },
            save: async () => { data.set(subject, props); }
        };
    }
    const store = {
        getData: async () => ({table: 'inbox', rowClass: 'item'}),
        query: async () => [...data.keys()],
        getMany: async subjects => subjects.map(resource),
        getResource: async subject => resource(subject),
        newResource: async ({parent, isA, propVals}) => {
            data.set('saved', {...propVals, [core + 'parent']: parent, [core + 'isA']: isA});
        }
    };
    const root = node('div');
    await view({root, store});
    const button = text => find(root, n => n.tag === 'button' && n.textContent === text);
    const title = find(root, n => n.tag === 'label' && n.textContent === 'Title');
    const url = find(root, n => n.tag === 'label' && n.textContent === 'URL (optional)');
    const note = find(root, n => n.tag === 'label' && n.textContent === 'Note');
    title.children[0].value = 'My note';
    url.children[0].value = '';
    note.children[0].value = 'Saved locally in my Atomic drive.';
    await button('Add to inbox').handlers.click();
    assert.ok(button('Archive item'));
    await button('Archive item').handlers.click();
    const payload = data.get('saved')[core + 'description'];
    assert.equal(JSON.parse(payload.slice('inbox-rs-item/v1:'.length)).archived, true);
    await view({root, store});
    const checkbox = find(root, n => n.type === 'checkbox');
    checkbox.checked = true;
    checkbox.handlers.change();
    assert.ok(button('Return to inbox'));
});
