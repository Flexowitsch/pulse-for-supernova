// Supernova REST client: everything the widget needs to read, nothing it would
// need to write. All calls run in the widget's main thread with the viewer's
// own API token; there is no backend and no shared service token.

const API_ROOT = 'https://api.supernova.io/api';

// The three Supernova component properties the widget turns into tiles.
export type SignalKey = 'status' | 'repository' | 'documentationLink';
export const SIGNAL_KEYS: SignalKey[] = ['status', 'repository', 'documentationLink'];

/** A property definition as the widget stores it. Supernova exposes both an
 *  `id` (version-scoped) and a `persistentId` (stable across versions), and
 *  property values have referenced either one depending on the endpoint — so
 *  we keep both and match on any of them. */
export interface PropertyRef {
	ids: string[];
	name: string;
}

export type PropertyMapping = Record<SignalKey, PropertyRef | null>;

/** What a widget instance is connected to. Lives in the document (synced
 *  state), so everyone who opens the file sees the same source. */
export interface SourceConfig {
	designSystemId: string;
	designSystemName: string;
	properties: PropertyMapping;
	/** Published docs site, confirmed or corrected in setup. Wins over detection. */
	docsUrl?: string;
}

export interface DesignSystemSummary {
	id: string;
	name: string;
	workspaceName: string;
}

export interface PropertyDefinition extends PropertyRef {
	type: string;
	options: Array<{ id: string; name: string }>;
}

export interface ComponentSummary {
	persistentId: string;
	name: string;
}

export type StatusVariant = 'healthy' | 'warning' | 'danger' | 'neutral';

export interface CardData {
	componentName: string;
	componentPersistentId: string;
	designSystemName: string;
	statusLabel: string;
	statusVariant: StatusVariant;
	designReady: boolean;
	codeReady: boolean;
	docsReady: boolean;
	/** Published docs page; empty when the design system has no docs site. */
	openUrl: string;
	/** Link from the CODE property (Storybook, repository …); empty when it isn't a URL. */
	codeUrl: string;
	syncedAt: number;
}

export type FailureReason = 'unauthorized' | 'notfound' | 'network';

export class SupernovaError extends Error {
	constructor(
		readonly reason: FailureReason,
		message: string,
	) {
		super(message);
	}
}

// ---- Transport ------------------------------------------------------------

// Cache-busting is critical: Figma's fetch caches GET responses by URL, so
// edits made in Supernova would not show up until a new URL is requested.
async function get(token: string, path: string): Promise<any> {
	const sep = path.includes('?') ? '&' : '?';
	let res: Awaited<ReturnType<typeof fetch>> | undefined;
	// Supernova's gateway answers the odd 502/503/504 under load; one retry
	// clears most of them.
	for (let attempt = 0; attempt < 2; attempt++) {
		try {
			res = await fetch(`${API_ROOT}/${path}${sep}_=${Date.now()}`, {
				cache: 'no-store',
				headers: {
					Authorization: `Bearer ${token}`,
					'Cache-Control': 'no-cache, no-store, must-revalidate',
					Pragma: 'no-cache',
				},
			});
		} catch (e: any) {
			throw new SupernovaError('network', e?.message ?? 'Network error');
		}
		if (res.status < 502 || res.status > 504 || attempt === 1) break;
		await new Promise((r) => setTimeout(r, 800));
	}
	if (!res) throw new SupernovaError('network', 'No response');
	// Supernova answers 404 "does not exist or operation is forbidden" when the
	// token has no access, so 404 is treated as an auth failure too.
	if (res.status === 401 || res.status === 403 || res.status === 404) {
		throw new SupernovaError('unauthorized', 'Token expired, invalid, or without access to this design system');
	}
	if (!res.ok) throw new SupernovaError('network', `Supernova answered HTTP ${res.status} (${path.split('?')[0]})`);
	const json: any = await res.json();
	return json?.result ?? json;
}

export function toFailure(e: unknown): { ok: false; reason: FailureReason; message: string } {
	if (e instanceof SupernovaError) return { ok: false, reason: e.reason, message: e.message };
	return { ok: false, reason: 'network', message: (e as any)?.message ?? 'Unknown error' };
}

const firstString = (...vals: unknown[]): string | undefined =>
	vals.find((v): v is string => typeof v === 'string' && v.trim().length > 0)?.trim();

// ---- Discovery (used by the setup UI) --------------------------------------

export async function getCurrentUser(token: string): Promise<{ id: string; name: string }> {
	const r = await get(token, 'users/me');
	const u = r?.user ?? r;
	if (!u?.id) throw new SupernovaError('unauthorized', 'Could not read the user for this token');
	return { id: String(u.id), name: firstString(u.profile?.name, u.email) ?? 'Supernova user' };
}

export async function listDesignSystems(token: string): Promise<DesignSystemSummary[]> {
	const user = await getCurrentUser(token);
	const m = await get(token, `users/${user.id}/workspaces`);
	const memberships: any[] = m?.membership ?? m?.memberships ?? m?.workspaces ?? [];
	const out: DesignSystemSummary[] = [];
	await Promise.all(
		memberships.map(async (ms) => {
			const ws = ms?.workspace ?? ms;
			if (!ws?.id) return;
			const workspaceName = firstString(ws.profile?.name, ws.name, ws.profile?.handle) ?? 'Workspace';
			try {
				const r = await get(token, `workspaces/${ws.id}/design-systems`);
				for (const ds of r?.designSystems ?? []) {
					out.push({
						id: String(ds.id),
						name: firstString(ds.meta?.name, ds.name) ?? `Design system ${ds.id}`,
						workspaceName,
					});
				}
			} catch {
				// A workspace the token can see but not list is not a reason to fail
				// the whole picker — the others are still useful.
			}
		}),
	);
	return out.sort((a, b) => a.workspaceName.localeCompare(b.workspaceName) || a.name.localeCompare(b.name));
}

interface VersionInfo {
	id: string;
	isReadonly: boolean;
	createdAt: number;
}

async function listVersions(token: string, dsId: string): Promise<VersionInfo[]> {
	const r = await get(token, `design-systems/${dsId}/versions`);
	return (r?.designSystemVersions ?? [])
		.map((v: any) => ({
			id: String(v.id),
			isReadonly: v.isReadonly === true,
			createdAt: Date.parse(v.createdAt) || 0,
		}))
		.sort((a: VersionInfo, b: VersionInfo) => b.createdAt - a.createdAt);
}

/** The version the team is working in. Supernova names it on the design
 *  system itself (`sharedDraftId`), which is one small request. Listing every
 *  version is the fallback only: on large design systems that endpoint is slow
 *  enough to time out at Supernova's gateway (HTTP 502). Resolved on every
 *  sync, so a new draft never leaves widgets behind. */
async function workingVersion(token: string, dsId: string): Promise<string> {
	try {
		const r = await get(token, `design-systems/${dsId}`);
		const ds = r?.designSystem ?? r;
		const draft = firstString(ds?.sharedDraftId);
		if (draft) return draft;
		console.log('[Pulse] design system record has no sharedDraftId; listing versions', Object.keys(ds ?? {}));
	} catch (e) {
		if (e instanceof SupernovaError && e.reason === 'unauthorized') throw e;
	}
	const versions = await listVersions(token, dsId);
	const v = versions.find((x) => !x.isReadonly) ?? versions[0];
	if (!v) throw new SupernovaError('notfound', 'This design system has no versions');
	return v.id;
}

function toDefinition(d: any): PropertyDefinition {
	return {
		ids: [d?.id, d?.persistentId].filter((x): x is string => typeof x === 'string' && x.length > 0),
		name: firstString(d?.meta?.name, d?.name, d?.codeName) ?? 'Unnamed property',
		type: String(d?.type ?? ''),
		options: (d?.options ?? []).map((o: any) => ({ id: String(o.id), name: String(o.name ?? o.id) })),
	};
}

async function fetchDefinitions(token: string, base: string): Promise<PropertyDefinition[]> {
	const r = await get(token, `${base}/element-properties/definitions`);
	return (r?.definitions ?? [])
		.filter((d: any) => (d?.targetElementType ?? 'Component') === 'Component')
		.map(toDefinition);
}

export async function listComponentProperties(token: string, dsId: string): Promise<PropertyDefinition[]> {
	const version = await workingVersion(token, dsId);
	return fetchDefinitions(token, `design-systems/${dsId}/versions/${version}`);
}

async function fetchComponents(token: string, base: string): Promise<any[]> {
	const r = await get(token, `${base}/design-system-components`);
	return r?.designSystemComponents ?? [];
}

export async function listComponents(token: string, dsId: string): Promise<ComponentSummary[]> {
	const version = await workingVersion(token, dsId);
	return (await fetchComponents(token, `design-systems/${dsId}/versions/${version}`))
		.map((c: any) => ({ persistentId: String(c.persistentId), name: firstString(c.meta?.name, c.name) ?? 'Unnamed' }))
		.sort((a, b) => a.name.localeCompare(b.name));
}

// Pre-select the obvious property for each signal so most teams only have to
// confirm. Exact names first, then a loose match; never the same property twice.
const HINTS: Record<SignalKey, { exact: RegExp; loose: RegExp; types: string[] }> = {
	status: { exact: /^status$/i, loose: /status|health|state|lifecycle|maturity/i, types: ['Select'] },
	repository: { exact: /^repo(sitory)?$/i, loose: /repo|code|github|gitlab|storybook|source/i, types: ['URL', 'Text', 'Link'] },
	documentationLink: { exact: /^documentation( link)?$/i, loose: /doc/i, types: ['Link', 'URL'] },
};

export function suggestMapping(defs: PropertyDefinition[]): PropertyMapping {
	const used = new Set<PropertyDefinition>();
	const pick = (key: SignalKey): PropertyRef | null => {
		const h = HINTS[key];
		const free = defs.filter((d) => !used.has(d));
		const hit =
			free.find((d) => h.exact.test(d.name)) ??
			free.find((d) => h.loose.test(d.name) && h.types.includes(d.type)) ??
			free.find((d) => h.loose.test(d.name));
		if (!hit) return null;
		used.add(hit);
		return { ids: hit.ids, name: hit.name };
	};
	return { status: pick('status'), repository: pick('repository'), documentationLink: pick('documentationLink') };
}

// ---- Status --------------------------------------------------------------

function humanize(raw: string): string {
	const s = raw.replace(/^status[-_ ]/i, '').replace(/[-_]+/g, ' ').trim();
	return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Map whatever a team named its status options onto four colours. Only a
 *  "healthy"-like value counts as design-ready; the pill always shows the
 *  team's own label. */
export function normalizeStatus(raw: string | undefined): { label: string; variant: StatusVariant; designReady: boolean } {
	if (!raw) return { label: 'No status', variant: 'neutral', designReady: false };
	const label = humanize(raw);
	const v = raw.toLowerCase();
	if (/deprecat|danger|sunset|removed|broken|blocked/.test(v)) return { label, variant: 'danger', designReady: false };
	if (/known.?issue|warning|beta|experimental|in.?progress|review|draft|wip/.test(v))
		return { label, variant: 'warning', designReady: false };
	if (/\bnot\b|un-?ready/.test(v)) return { label, variant: 'neutral', designReady: false };
	if (/healthy|ready|stable|production|released|done|approved/.test(v)) return { label, variant: 'healthy', designReady: true };
	return { label, variant: 'neutral', designReady: false };
}

// ---- Documentation deep links ---------------------------------------------

function slugify(s: string): string {
	return s
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '');
}

// Supernova has used several ID-shaped fields for structure items over time.
function structureItemMatches(item: any, pid: string): boolean {
	if (!item || !pid) return false;
	return [
		item.persistentId,
		item.id,
		item.shortPersistentId,
		item.referenceId,
		item.sourceId,
		item.originalPersistentId,
		item.attachedTo?.persistentId,
		item.attachedTo?.id,
		item.target?.persistentId,
		item.target?.id,
	].some((c) => typeof c === 'string' && c === pid);
}

function buildDocsPageUrl(docsRoot: string, structure: any[], pid: string): string | null {
	const byPid: Record<string, any> = {};
	const parentOf: Record<string, string> = {};
	for (const item of structure) {
		byPid[item.persistentId] = item;
		for (const cid of item.childrenIds ?? []) parentOf[cid] = item.persistentId;
	}
	let target = byPid[pid] ?? structure.find((it) => structureItemMatches(it, pid));
	if (!target) return null;
	// A link to a group opens its first page.
	while (target?.type === 'Group' && (target.childrenIds?.length ?? 0) > 0) {
		const next = byPid[target.childrenIds[0]];
		if (!next) break;
		target = next;
	}
	if (!target?.shortPersistentId || !target?.title) return null;
	const slugs: string[] = [];
	let cur: string | undefined = parentOf[target.persistentId];
	while (cur && byPid[cur]) {
		const p = byPid[cur];
		if (!p.isRoot && p.title) slugs.unshift(slugify(p.title));
		cur = parentOf[cur];
	}
	const base = docsRoot.replace(/\/$/, '');
	const page = `${slugify(target.title)}-${target.shortPersistentId}`;
	// Root-level pages use a doubled short ID.
	return slugs.length === 0 ? `${base}/${page}-${target.shortPersistentId}` : `${base}/${slugs.join('/')}/${page}`;
}

// "Latest published" is not necessarily what the docs site serves — teams
// snapshot versions and republish older ones — so scan recent published
// versions and use the first that actually contains the page.
const PUBLISHED_VERSION_SCAN_LIMIT = 10;

async function fetchStructure(token: string, dsId: string, versionId: string): Promise<any[]> {
	try {
		const r = await get(token, `design-systems/${dsId}/versions/${versionId}/documentation/structure`);
		return r?.items ?? [];
	} catch {
		return [];
	}
}

// The public docs site serves the latest published version under /latest.
function withLatest(docsRoot: string): string {
	const base = docsRoot.replace(/\/$/, '');
	// No URL global in the widget sandbox: a bare origin gets /latest appended.
	return /^https?:\/\/[^/]+$/.test(base) ? `${base}/latest` : base;
}

/** First page under a structure item: a linked tab group opens its first tab. */
function firstPage(structure: any[], pid: string): any | null {
	const byPid: Record<string, any> = {};
	for (const item of structure) byPid[item.persistentId] = item;
	let target = byPid[pid] ?? structure.find((it) => structureItemMatches(it, pid));
	while (target?.type === 'Group' && (target.childrenIds?.length ?? 0) > 0) target = byPid[target.childrenIds[0]];
	return target?.type === 'Group' ? null : target ?? null;
}

/** Root of the published docs site.
 *
 *  `documentation/url` can still answer with the legacy subdomain built from the
 *  workspace handle (e.g. acme-a1b2c3d4.supernova-docs.io), which only leads to
 *  a login screen once a team has set its own docs slug. The design system
 *  record carries the current one (`docUserSlug`), so that wins; a custom view
 *  URL comes next, the API's answer last. */
export async function detectDocsSite(token: string, dsId: string): Promise<string | null> {
	return docsSiteRoot(token, dsId, await workingVersion(token, dsId));
}

async function docsSiteRoot(token: string, dsId: string, working: string): Promise<string | null> {
	const [ds, apiUrl] = await Promise.all([
		get(token, `design-systems/${dsId}`)
			.then((r) => r?.designSystem ?? r)
			.catch(() => null),
		get(token, `design-systems/${dsId}/versions/${working}/documentation/url`)
			.then((r) => firstString(r?.url) ?? null)
			.catch(() => null),
	]);
	const userSlug = firstString(ds?.docUserSlug);
	const root = userSlug ? `https://${userSlug}.supernova-docs.io` : (firstString(ds?.docViewUrl) ?? apiUrl);
	console.log('[Pulse] docs: site', { root, docUserSlug: userSlug, docViewUrl: ds?.docViewUrl, docSlug: ds?.docSlug, apiUrl });
	return root ?? null;
}

/** Where "Open documentation in Supernova" goes, per component — always the
 *  published docs site, never the editor.
 *
 *  The docs site resolves a page by its short ID alone — the path in front of
 *  it is cosmetic, and short IDs never change between versions. So the URL is
 *  built from the draft structure directly; no version list (which times out on
 *  large design systems) is involved. A linked tab group opens its first tab. Without a docs site the
 *  result is null and the widget shows no button. */
async function resolveOpenUrl(
	token: string,
	dsId: string,
	working: string,
	linkPid: string,
	docsUrl: string | undefined,
): Promise<string | null> {
	const configured = firstString(docsUrl);
	const [docsRoot, draft] = await Promise.all([
		configured ? Promise.resolve(configured) : docsSiteRoot(token, dsId, working),
		fetchStructure(token, dsId, working),
	]);
	if (!docsRoot) return null;
	const root = withLatest(docsRoot);
	const page = firstPage(draft, linkPid);
	const url = page?.shortPersistentId ? buildDocsPageUrl(root, draft, page.persistentId) : null;
	console.log('[Pulse] docs: link', { linkPid, page: page?.title, shortId: page?.shortPersistentId, url: url ?? root });
	return url ?? root;
}

// ---- Sync -------------------------------------------------------------------

// Property values have come back in two shapes; read both.
function valueFor(values: any[], targetPid: string, ref: PropertyRef | null): unknown {
	if (!ref) return undefined;
	const ids = new Set(ref.ids);
	const v = values.find(
		(x) =>
			(x?.targetElementId ?? x?.targetElementPersistentId) === targetPid &&
			ids.has(x?.definitionId ?? x?.definitionPersistentId),
	);
	if (!v) return undefined;
	return v.value ?? v.stringValue ?? v.referenceValue ?? v.numberValue ?? v.booleanValue;
}

// Values are sometimes a raw string, sometimes wrapped in an object.
function extractString(v: unknown): string | undefined {
	if (typeof v === 'string') return firstString(v);
	if (v && typeof v === 'object') {
		const o = v as Record<string, unknown>;
		return firstString(o.value, o.id, o.persistentId, o.pageId, o.targetId, o.url);
	}
	return undefined;
}

/** Button label for a CODE link, named after where it leads. */
export function codeLinkLabel(url: string): string {
	if (/storybook|chromatic\.com/i.test(url)) return 'Open in Storybook';
	if (/github\.com/i.test(url)) return 'Open on GitHub';
	if (/gitlab\./i.test(url)) return 'Open on GitLab';
	return 'Open code';
}

export async function fetchCardData(token: string, config: SourceConfig, componentPid: string): Promise<CardData> {
	const dsId = config.designSystemId;
	const working = await workingVersion(token, dsId);
	const base = `design-systems/${dsId}/versions/${working}`;

	const [valuesRes, components, definitions] = await Promise.all([
		get(token, `${base}/element-properties/values`),
		fetchComponents(token, base),
		fetchDefinitions(token, base).catch(() => [] as PropertyDefinition[]),
	]);

	const comp = components.find((c: any) => c.persistentId === componentPid);
	if (!comp) throw new SupernovaError('notfound', 'Component not found in this design system');

	const values: any[] = valuesRes?.values ?? [];
	const { status, repository, documentationLink } = config.properties;

	// A Select value is an option ID; show the option's name instead.
	const rawStatus = extractString(valueFor(values, componentPid, status));
	const statusDef = status ? definitions.find((d) => d.ids.some((id) => status.ids.includes(id))) : undefined;
	const statusName = statusDef?.options.find((o) => o.id === rawStatus)?.name ?? rawStatus;
	const { label, variant, designReady } = normalizeStatus(statusName);

	const codeValue = extractString(valueFor(values, componentPid, repository));
	const codeReady = !!codeValue;
	const codeUrl = codeValue && /^https?:\/\//i.test(codeValue) ? codeValue : '';
	const linkPid = extractString(valueFor(values, componentPid, documentationLink));
	const openUrl = linkPid ? await resolveOpenUrl(token, dsId, working, linkPid, config.docsUrl) : null;

	return {
		componentName: firstString(comp.meta?.name, comp.name) ?? 'Unnamed',
		componentPersistentId: componentPid,
		designSystemName: config.designSystemName,
		statusLabel: label,
		statusVariant: variant,
		designReady,
		codeReady,
		docsReady: !!linkPid,
		openUrl: openUrl ?? '',
		codeUrl,
		syncedAt: Date.now(),
	};
}
