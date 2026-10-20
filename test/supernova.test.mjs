// Tests for the Supernova client against a mocked REST API.
// Run with `npm test` — the client is bundled first (see package.json).
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
	fetchCardData,
	listDesignSystems,
	normalizeStatus,
	suggestMapping,
} from '../node_modules/.cache/pulse-test/supernova.mjs';

console.log = () => {}; // the client logs every lookup step; keep test output readable

// A design system shaped like a real one: the docs link of "Alert" points at a
// tab group whose first tab is published; the docs-URL endpoint still answers
// with a legacy subdomain.
let routes;
let calls;
beforeEach(() => {
	calls = [];
	routes = {
		'users/me': { user: { id: 'u1', profile: { name: 'Ada' } } },
		'users/u1/workspaces': { membership: [{ workspace: { id: 'w1', profile: { name: 'Acme' } } }] },
		'workspaces/w1/design-systems': { designSystems: [{ id: 1, meta: { name: 'Acme DS' } }] },
		'design-systems/1': {
			designSystem: { id: '1', sharedDraftId: 'draft', docSlug: 'acme-a1b2c3d4', docUserSlug: 'acme' },
		},
		'design-systems/1/versions/draft/element-properties/definitions': {
			definitions: [
				{
					id: 'd-status',
					persistentId: 'p-status',
					meta: { name: 'Status' },
					type: 'Select',
					targetElementType: 'Component',
					options: [
						{ id: 'opt-ok', name: 'Healthy' },
						{ id: 'opt-old', name: 'Deprecated' },
					],
				},
			],
		},
		'design-systems/1/versions/draft/element-properties/values': {
			values: [
				// older value shape
				{ targetElementId: 'alert', definitionId: 'p-status', value: 'opt-ok' },
				{ targetElementId: 'alert', definitionId: 'p-repo', value: 'https://github.com/acme/alert' },
				{ targetElementId: 'alert', definitionId: 'p-doc', value: 'grp-alert' },
				// newer value shape
				{ targetElementPersistentId: 'button', definitionPersistentId: 'p-status', stringValue: 'opt-old' },
				{ targetElementPersistentId: 'button', definitionPersistentId: 'p-doc', referenceValue: 'pg-button' },
			],
		},
		'design-systems/1/versions/draft/design-system-components': {
			designSystemComponents: [
				{ persistentId: 'alert', meta: { name: 'Alert' } },
				{ persistentId: 'button', meta: { name: 'Button' } },
				{ persistentId: 'divider', meta: { name: 'Divider' } },
			],
		},
		'design-systems/1/versions/draft/documentation/url': { url: 'https://acme-a1b2c3d4.supernova-docs.io' },
		'design-systems/1/versions/draft/documentation/structure': {
			items: [
				{ persistentId: 'root', isRoot: true, type: 'Group', title: 'Root', childrenIds: ['comp'] },
				{ persistentId: 'comp', type: 'Group', title: 'Components', childrenIds: ['grp-alert', 'pg-button'] },
				{ persistentId: 'grp-alert', type: 'Group', groupBehavior: 'Tabs', title: 'Alert', childrenIds: ['pg-alert-1', 'pg-alert-2'] },
				{ persistentId: 'pg-alert-1', type: 'Page', title: 'Guideline', shortPersistentId: 'AbCd1234' },
				{ persistentId: 'pg-alert-2', type: 'Page', title: 'Specs', shortPersistentId: 'EfGh5678' },
				{ persistentId: 'pg-button', type: 'Page', title: 'Button', shortPersistentId: 'IjKl9012' },
			],
		},
	};
	globalThis.fetch = async (url) => {
		const path = url.replace('https://api.supernova.io/api/', '').split('?')[0];
		calls.push(path);
		// Large design systems: the versions list times out at the gateway.
		if (path === 'design-systems/1/versions') return { ok: false, status: 502, json: async () => ({}) };
		if (!(path in routes)) return { ok: false, status: 404, json: async () => ({}) };
		return { ok: true, status: 200, json: async () => ({ result: routes[path] }) };
	};
});

const config = {
	designSystemId: '1',
	designSystemName: 'Acme DS',
	properties: {
		status: { ids: ['d-status', 'p-status'], name: 'Status' },
		repository: { ids: ['p-repo'], name: 'Repository' },
		documentationLink: { ids: ['p-doc'], name: 'Documentation link' },
	},
};

test('normalizeStatus keeps the team label and picks a colour', () => {
	const n = (s) => Object.values(normalizeStatus(s));
	assert.deepEqual(n('status-healthy'), ['Healthy', 'healthy', true]);
	assert.deepEqual(n('Stable'), ['Stable', 'healthy', true]);
	assert.deepEqual(n('status-known-issues'), ['Known issues', 'warning', false]);
	assert.deepEqual(n('Beta'), ['Beta', 'warning', false]);
	assert.deepEqual(n('Deprecated'), ['Deprecated', 'danger', false]);
	assert.deepEqual(n('Not ready'), ['Not ready', 'neutral', false]);
	assert.deepEqual(n('Owner: design'), ['Owner: design', 'neutral', false]);
	assert.deepEqual(n(undefined), ['No status', 'neutral', false]);
});

test('suggestMapping prefers exact names and never reuses a property', () => {
	const defs = [
		{ ids: ['a'], name: 'Documentation link', type: 'Link', options: [] },
		{ ids: ['b'], name: 'Status', type: 'Select', options: [] },
		{ ids: ['c'], name: 'Repository', type: 'URL', options: [] },
	];
	const m = suggestMapping(defs);
	assert.equal(m.status.name, 'Status');
	assert.equal(m.repository.name, 'Repository');
	assert.equal(m.documentationLink.name, 'Documentation link');
	assert.equal(suggestMapping([{ ids: ['x'], name: 'Owner', type: 'Text', options: [] }]).status, null);
});

test('listDesignSystems walks every workspace the token can see', async () => {
	assert.deepEqual(await listDesignSystems('t'), [{ id: '1', name: 'Acme DS', workspaceName: 'Acme' }]);
});

test('a linked tab group opens its first tab on the current docs domain', async () => {
	const card = await fetchCardData('t', config, 'alert');
	assert.equal(card.openUrl, 'https://acme.supernova-docs.io/latest/components/alert/guideline-AbCd1234');
	assert.equal(card.statusLabel, 'Healthy');
	assert.equal(card.designReady, true);
	assert.equal(card.codeReady, true);
	assert.equal(card.docsReady, true);
});

test('select values resolve to option names; the newer value shape is read too', async () => {
	const card = await fetchCardData('t', config, 'button');
	assert.equal(card.statusLabel, 'Deprecated');
	assert.equal(card.statusVariant, 'danger');
	assert.equal(card.codeReady, false);
	assert.equal(card.openUrl, 'https://acme.supernova-docs.io/latest/components/button-IjKl9012');
});

test('a URL in the CODE property becomes the code link; text does not', async () => {
	routes['design-systems/1/versions/draft/element-properties/values'].values.push(
		{ targetElementPersistentId: 'divider', definitionPersistentId: 'p-repo', stringValue: 'Not in code yet, see ticket' },
	);
	assert.equal((await fetchCardData('t', config, 'alert')).codeUrl, 'https://github.com/acme/alert');
	const divider = await fetchCardData('t', config, 'divider');
	assert.equal(divider.codeReady, true);
	assert.equal(divider.codeUrl, '');
	assert.equal((await fetchCardData('t', config, 'button')).codeUrl, '');
});

test('no documentation link means no button target', async () => {
	const card = await fetchCardData('t', config, 'divider');
	assert.equal(card.docsReady, false);
	assert.equal(card.openUrl, '');
});

test('the versions list is never needed (it returns 502 on large design systems)', async () => {
	await fetchCardData('t', config, 'alert');
	assert.ok(!calls.includes('design-systems/1/versions'));
});

test('a docs site confirmed in setup wins over detection', async () => {
	routes['design-systems/1'] = { designSystem: { id: '1', sharedDraftId: 'draft' } };
	const card = await fetchCardData('t', { ...config, docsUrl: 'https://docs.acme.com' }, 'alert');
	assert.equal(card.openUrl, 'https://docs.acme.com/latest/components/alert/guideline-AbCd1234');
});

test('without a docs slug, the API docs URL is used', async () => {
	routes['design-systems/1'] = { designSystem: { id: '1', sharedDraftId: 'draft' } };
	const card = await fetchCardData('t', config, 'alert');
	assert.equal(card.openUrl, 'https://acme-a1b2c3d4.supernova-docs.io/latest/components/alert/guideline-AbCd1234');
});

test('a rejected token surfaces as unauthorized', async () => {
	globalThis.fetch = async () => ({ ok: false, status: 401, json: async () => ({}) });
	await assert.rejects(fetchCardData('t', config, 'alert'), (e) => e.reason === 'unauthorized');
});
