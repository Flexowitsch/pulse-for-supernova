// Runs the widget's own Supernova code against a real account and prints every
// step of a sync, so a wrong status or documentation link can be traced without
// Figma. Usage:
//
//   copy your Supernova API token, then:  npm run diagnose -- "<component name>" ["<design system name>"]
//
// The token is read from the clipboard (macOS pbpaste) or SUPERNOVA_TOKEN and is
// never printed.
import { execSync } from 'node:child_process';
import {
	fetchCardData,
	listComponentProperties,
	listComponents,
	listDesignSystems,
	suggestMapping,
	type SourceConfig,
} from '../src/main/supernova';

const [componentName = '', dsName = ''] = process.argv.slice(2);
const token = (process.env.SUPERNOVA_TOKEN ?? execSync('pbpaste').toString()).trim();
if (!token || /\s/.test(token)) {
	console.error('Copy your Supernova API token to the clipboard first (or set SUPERNOVA_TOKEN).');
	process.exit(1);
}

const step = (title: string, value: unknown) => console.log(`\n▸ ${title}\n`, value);

const systems = await listDesignSystems(token);
step('Design systems', systems.map((d) => `${d.name} (${d.id}) · ${d.workspaceName}`));
const ds = systems.find((d) => !dsName || d.name.toLowerCase() === dsName.toLowerCase()) ?? systems[0];
if (!ds) throw new Error('No design system visible to this token');

const defs = await listComponentProperties(token, ds.id);
const properties = suggestMapping(defs);
step('Property mapping (as the widget suggests it)', properties);

const components = await listComponents(token, ds.id);
const comp = components.find((c) => c.name.toLowerCase() === componentName.toLowerCase());
if (!comp) {
	step('Components', components.map((c) => c.name).join(', '));
	throw new Error(`Component "${componentName}" not found`);
}

const source: SourceConfig = { designSystemId: ds.id, designSystemName: ds.name, properties };
const card = await fetchCardData(token, source, comp.persistentId);
step('Card', card);

if (card.openUrl) {
	const res = await fetch(card.openUrl, { redirect: 'follow' });
	const title = (await res.text()).match(/<title>([^<]*)/)?.[1] ?? '(no title)';
	step('Docs link check', { url: card.openUrl, landedOn: res.url, title, ok: !/login|Supernova\.io$/.test(title + res.url) });
}
