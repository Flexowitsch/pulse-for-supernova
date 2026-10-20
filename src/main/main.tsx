import {
	detectDocsSite,
	fetchCardData,
	listComponentProperties,
	listComponents,
	listDesignSystems,
	getCurrentUser,
	suggestMapping,
	toFailure,
	type CardData,
	type SourceConfig,
	type StatusVariant,
} from './supernova';

const { widget } = figma;
const { AutoLayout, Text, SVG, useSyncedState, usePropertyMenu, useEffect, useWidgetNodeId } = widget;

// Shown in the widget footer so you can tell at a glance which build is running.
const BUILD_VERSION = 'v1.3.2';

// figma.clientStorage is per user and per machine: the token never travels
// with the file. The last source is remembered so a second widget only asks
// for the component.
const TOKEN_KEY = 'pulse.supernovaToken';
const LAST_SOURCE_KEY = 'pulse.lastSource';

// ---- Visual tokens --------------------------------------------------------
const COLORS = {
	cardBg: '#FFFFFF',
	cardBorder: { r: 0, g: 0, b: 0, a: 0.08 },
	title: '#1A1A1A',
	muted: '#6B7178',
	syncBlue: '#0C8CE9',
	tileBgIdle: '#F1F3F5',
	tileFgIdle: '#9AA1A8',
	tileLabelIdle: '#4F575E',
	tileBgReady: '#E6F8EC',
	tileFgReady: '#0E5C29',
	bannerBg: '#E7F0FE',
	bannerFg: '#1A3F73',
	buttonBg: '#1A1A1A',
	buttonFg: '#FFFFFF',
	pillHealthyBg: '#D3FEDE',
	pillHealthyFg: '#0E5C29',
	pillWarningBg: '#FCF4D6',
	pillWarningFg: '#7A5C00',
	pillDangerBg: '#FFF0F0',
	pillDangerFg: '#A50000',
	pillNeutralBg: '#F1F3F5',
	pillNeutralFg: '#4F575E',
	pillExpiredBg: '#FFE5E5',
	pillExpiredFg: '#A50000',
} as const;

type Mode = 'empty' | 'loading' | 'loaded' | 'unauthorized' | 'error';

// ---- SVG icons ------------------------------------------------------------
const CHECK_SVG = (fg: string) =>
	`<svg width="32" height="32" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg"><path d="M8 16.5L13.5 22L24 11" stroke="${fg}" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" fill="none"/></svg>`;
const DASH_SVG = (fg: string) =>
	`<svg width="32" height="32" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg"><path d="M8 16.5H24" stroke="${fg}" stroke-width="2.6" stroke-linecap="round" fill="none"/></svg>`;
const INFO_SVG = (fg: string) =>
	`<svg width="24" height="24" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><circle cx="12" cy="12" r="10" stroke="${fg}" stroke-width="1.8" fill="none"/><circle cx="12" cy="8" r="1.2" fill="${fg}"/><path d="M12 11V17" stroke="${fg}" stroke-width="1.8" stroke-linecap="round"/></svg>`;
const ARROW_NE_SVG = (fg: string) =>
	`<svg width="20" height="20" viewBox="0 0 20 20" xmlns="http://www.w3.org/2000/svg"><path d="M6 14L14 6M14 6H7M14 6V13" stroke="${fg}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" fill="none"/></svg>`;
const REFRESH_SVG = (fg: string) =>
	`<svg width="16" height="16" viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg"><path d="M13.5 4V7.5H10M2.5 12V8.5H6M3.5 6.5C4.16 4.94 5.71 3.75 7.6 3.55C9.49 3.36 11.32 4.2 12.3 5.75M12.5 9.5C11.84 11.06 10.29 12.25 8.4 12.45C6.51 12.64 4.68 11.8 3.7 10.25" stroke="${fg}" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" fill="none"/></svg>`;

// ---- Helpers --------------------------------------------------------------
// The most recent 18:00 (local). Data synced before it is stale and is
// silently refreshed when the file is next opened.
function endOfDayCutoff(now: number = Date.now()): number {
	const cutoff = new Date(now);
	cutoff.setHours(18, 0, 0, 0);
	if (now < cutoff.getTime()) cutoff.setDate(cutoff.getDate() - 1);
	return cutoff.getTime();
}

const isStale = (syncedAt: number) => syncedAt < endOfDayCutoff();

function describeDiff(prev: CardData | null, next: CardData): string | null {
	if (!prev) return null;
	const changes: string[] = [];
	if (prev.statusLabel !== next.statusLabel) changes.push(`status → ${next.statusLabel}`);
	if (prev.designReady !== next.designReady) changes.push(`design ${next.designReady ? 'ready' : 'not ready'}`);
	if (prev.codeReady !== next.codeReady) changes.push(`code ${next.codeReady ? 'ready' : 'not ready'}`);
	if (prev.docsReady !== next.docsReady) changes.push(`docs ${next.docsReady ? 'ready' : 'not ready'}`);
	return changes.length > 0 ? changes.join(', ') : null;
}

function relativeTime(ms: number): string {
	const s = Math.floor(Math.max(0, Date.now() - ms) / 1000);
	if (s < 5) return 'Synced just now';
	if (s < 60) return `Synced ${s}s ago`;
	const m = Math.floor(s / 60);
	if (m < 60) return `Synced ${m}m ago`;
	const h = Math.floor(m / 60);
	if (h < 24) return `Synced ${h}h ago`;
	return `Synced ${Math.floor(h / 24)}d ago`;
}

function pillColors(variant: StatusVariant | 'expired'): { bg: string; fg: string } {
	if (variant === 'healthy') return { bg: COLORS.pillHealthyBg, fg: COLORS.pillHealthyFg };
	if (variant === 'warning') return { bg: COLORS.pillWarningBg, fg: COLORS.pillWarningFg };
	if (variant === 'danger') return { bg: COLORS.pillDangerBg, fg: COLORS.pillDangerFg };
	if (variant === 'expired') return { bg: COLORS.pillExpiredBg, fg: COLORS.pillExpiredFg };
	return { bg: COLORS.pillNeutralBg, fg: COLORS.pillNeutralFg };
}

function openExternal(url: string): Promise<void> {
	const figmaAny = figma as any;
	if (typeof figmaAny.openExternal === 'function') {
		try {
			figmaAny.openExternal(url);
			return Promise.resolve();
		} catch (e) {
			console.warn('[Pulse] figma.openExternal threw, falling back to iframe', e);
		}
	}
	// Fallback: a visible 1px iframe, so popup blockers allow window.open.
	return new Promise<void>((resolve) => {
		figma.showUI(
			`<script>window.open(${JSON.stringify(url)},'_blank');parent.postMessage({pluginMessage:{type:'close'}},'*');</script>`,
			{ width: 1, height: 1, title: 'Opening…' },
		);
		figma.ui.onmessage = () => {
			figma.ui.close();
			resolve();
		};
	});
}

// ---- Setup UI orchestration -------------------------------------------------
// The iframe only renders; every Supernova call runs here, in the main thread.
type UIInitPayload =
	| {
			mode: 'setup';
			startAt: 'token' | 'source' | 'mapping' | 'component';
			source: SourceConfig | null;
			currentPid: string | null;
	  }
	| { mode: 'token-only' };

async function respond(type: string, work: () => Promise<Record<string, unknown>>) {
	try {
		figma.ui.postMessage({ type, result: { ok: true, ...(await work()) } });
	} catch (e) {
		figma.ui.postMessage({ type, result: toFailure(e) });
	}
}

function openUI(payload: UIInitPayload): Promise<void> {
	return new Promise((resolve) => {
		figma.showUI(__html__, { width: 380, height: 560, themeColors: true, title: 'Pulse for Supernova' });
		figma.ui.postMessage({ type: 'init', payload });

		figma.ui.onmessage = async (msg: any) => {
			if (!msg || typeof msg !== 'object') return;
			const token: string = msg.token ?? '';

			switch (msg.type) {
				case 'request-token': {
					const t = (await figma.clientStorage.getAsync(TOKEN_KEY)) ?? '';
					figma.ui.postMessage({ type: 'token', value: t });
					return;
				}
				case 'validate-token':
					return respond('token-result', async () => ({ user: await getCurrentUser(token) }));
				case 'list-design-systems':
					return respond('design-systems-result', async () => ({ items: await listDesignSystems(token) }));
				case 'list-properties':
					return respond('properties-result', async () => {
						const [definitions, docsSite] = await Promise.all([
							listComponentProperties(token, msg.designSystemId),
							detectDocsSite(token, msg.designSystemId).catch(() => null),
						]);
						return { definitions, suggested: suggestMapping(definitions), docsSite };
					});
				case 'list-components':
					return respond('components-result', async () => ({
						items: await listComponents(token, msg.designSystemId),
					}));
				case 'submit': {
					// Only overwrite the stored token when a new one was entered, so
					// "Change component" can never clear it.
					if (token) await figma.clientStorage.setAsync(TOKEN_KEY, token);
					if (msg.source) await figma.clientStorage.setAsync(LAST_SOURCE_KEY, msg.source);
					figma.ui.close();
					if (msg.source && msg.componentPersistentId) {
						await applySetup(msg.source, msg.componentPersistentId);
					} else {
						await refreshNode();
					}
					resolve();
					return;
				}
				case 'close':
					figma.ui.close();
					resolve();
					return;
			}
		};
	});
}

// Set by the widget on every render so UI callbacks reach the current state.
let refreshNode: () => Promise<void> = async () => {};
let applySetup: (source: SourceConfig, pid: string) => Promise<void> = async () => {};

/** Widget node ids whose stale-data refresh already ran this session. Module
 *  scope: it resets when Figma reloads the widget and never enters the
 *  document. */
const autoRefreshedThisSession = new Set<string>();

// ---- Widget -----------------------------------------------------------------
function Widget() {
	const [source, setSource] = useSyncedState<SourceConfig | null>('source', null);
	const [data, setData] = useSyncedState<CardData | null>('data', null);
	const [mode, setMode] = useSyncedState<Mode>('mode', 'empty');
	const [errMsg, setErrMsg] = useSyncedState<string>('errMsg', '');
	const widgetId = useWidgetNodeId();

	const refresh = async (opts?: { pid?: string; source?: SourceConfig; silent?: boolean }): Promise<CardData | null> => {
		const silent = opts?.silent === true;
		const pid = opts?.pid ?? data?.componentPersistentId;
		const src = opts?.source ?? source;

		// Synced state lives in the document and is shared with everyone who
		// opens the file; the token is per user. So once there is data, a failed
		// refresh must never overwrite it — one person's expired token or flaky
		// network would otherwise blank the card for the whole team.
		const hasData = data !== null && !opts?.pid;

		if (!pid || !src) {
			if (!hasData) setMode('empty');
			return null;
		}
		const token = (await figma.clientStorage.getAsync(TOKEN_KEY)) ?? '';
		if (!token) {
			// A colleague without a token: nothing is wrong with the card, they
			// just can't refresh it. An explicit sync asks them to connect one.
			if (!hasData) setMode('empty');
			if (!silent) await openUI({ mode: 'token-only' });
			return null;
		}
		// 'loading' is written to the document; an interrupted sync would leave
		// it stuck, so only show it when there is nothing to lose.
		if (!hasData) setMode('loading');
		const notif = silent ? null : figma.notify('Syncing from Supernova…', { timeout: 60_000 });
		try {
			const next = await fetchCardData(token, src, pid);
			notif?.cancel();
			const prev = data;
			setData(next);
			setMode('loaded');
			setErrMsg('');
			if (!silent) {
				const changes = describeDiff(prev, next);
				figma.notify(changes ? `Synced · ${changes}` : 'Synced — no changes', { timeout: 3000 });
			}
			return next;
		} catch (e) {
			notif?.cancel();
			const failure = toFailure(e);
			console.warn('[Pulse] sync failed', failure);
			if (!hasData) {
				setMode(failure.reason === 'unauthorized' ? 'unauthorized' : 'error');
				setErrMsg(failure.message);
			}
			if (!silent) {
				figma.notify(
					failure.reason === 'unauthorized' ? 'Token expired — paste a fresh one to sync' : `Sync failed: ${failure.message}`,
					{ error: true, timeout: 4000 },
				);
				// The token menu item is gone: an explicit sync with a rejected
				// token is where a fresh one gets pasted.
				if (failure.reason === 'unauthorized') await openUI({ mode: 'token-only' });
			}
			return null;
		}
	};

	const openSetup = async (startAt: 'token' | 'source' | 'mapping' | 'component') => {
		const last = (await figma.clientStorage.getAsync(LAST_SOURCE_KEY)) as SourceConfig | undefined;
		const known = source ?? last ?? null;
		return openUI({
			mode: 'setup',
			startAt: (startAt === 'component' || startAt === 'mapping') && !known ? 'source' : startAt,
			source: known,
			currentPid: data?.componentPersistentId ?? null,
		});
	};

	refreshNode = async () => {
		await refresh();
	};
	applySetup = async (src, pid) => {
		setSource(src);
		await refresh({ pid, source: src });
	};

	usePropertyMenu(
		// With data, always offer the full menu — a failed refresh must not take
		// Sync away from the card that needs it.
		data !== null || mode !== 'empty'
			? [
					{ itemType: 'action', tooltip: 'Sync', propertyName: 'sync' },
					{ itemType: 'action', tooltip: 'Hard refresh (clear cache)', propertyName: 'hard' },
					{ itemType: 'separator' },
					{ itemType: 'action', tooltip: 'Change component', propertyName: 'component' },
					{ itemType: 'action', tooltip: 'Edit tile mapping', propertyName: 'mapping' },
					{ itemType: 'action', tooltip: 'Change design system', propertyName: 'source' },
				]
			: [{ itemType: 'action', tooltip: 'Set up', propertyName: 'setup' }],
		({ propertyName }) => {
			if (propertyName === 'sync') return refresh().then(() => {});
			if (propertyName === 'hard') {
				const pid = data?.componentPersistentId;
				setData(null);
				setErrMsg('');
				setMode('empty');
				return pid ? refresh({ pid }).then(() => {}) : Promise.resolve();
			}
			if (propertyName === 'source') return openSetup('source');
			if (propertyName === 'component') return openSetup('component');
			if (propertyName === 'mapping') return openSetup('mapping');
			return openSetup('token');
		},
	);

	useEffect(() => {
		// Silent refresh of stale data, once per widget per session. A file can
		// hold a hundred of these widgets; unguarded, every render would fire a
		// sync for each and run straight into Supernova's rate limit.
		if (data?.syncedAt && isStale(data.syncedAt) && !autoRefreshedThisSession.has(widgetId)) {
			autoRefreshedThisSession.add(widgetId);
			figma.widget.waitForTask(refresh({ silent: true }));
		}
	});

	const tile = (label: string, ready: boolean) => (
		<AutoLayout
			name={`tile-${label}`}
			direction="vertical"
			width="fill-parent"
			height={120}
			cornerRadius={16}
			fill={ready ? COLORS.tileBgReady : COLORS.tileBgIdle}
			horizontalAlignItems="center"
			verticalAlignItems="center"
			spacing={12}
			padding={{ vertical: 20, horizontal: 12 }}
		>
			<SVG src={ready ? CHECK_SVG(COLORS.tileFgReady) : DASH_SVG(COLORS.tileFgIdle)} />
			<Text
				fill={ready ? COLORS.tileFgReady : COLORS.tileLabelIdle}
				fontFamily="Inter"
				fontSize={14}
				fontWeight={700}
				letterSpacing={1.2}
			>
				{label}
			</Text>
		</AutoLayout>
	);

	const pill = (label: string, variant: StatusVariant | 'expired') => {
		const c = pillColors(variant);
		return (
			<AutoLayout cornerRadius={8} fill={c.bg} padding={{ vertical: 8, horizontal: 14 }} verticalAlignItems="center">
				<Text fill={c.fg} fontFamily="Inter" fontSize={16} fontWeight={500}>
					{label}
				</Text>
			</AutoLayout>
		);
	};

	// `data` is the durable truth shared with the team; `mode` only decides
	// what to show when there is no data at all.
	const hasData = data !== null;
	const isExpired = mode === 'unauthorized' && !hasData;

	const pillLabel = hasData
		? data.statusLabel
		: isExpired
			? 'Token expired'
			: mode === 'loading'
				? 'Syncing…'
				: mode === 'error'
					? 'Error'
					: 'Not set up';
	const pillVariant: StatusVariant | 'expired' = hasData ? data.statusVariant : isExpired ? 'expired' : 'neutral';

	const bannerText = hasData
		? data.docsReady
			? 'New here? Open the documentation for specs, code, and usage examples.'
			: 'No documentation page is linked for this component yet.'
		: mode === 'unauthorized'
			? 'Your Supernova token is no longer valid. Update it to keep this widget in sync.'
			: mode === 'error'
				? `Couldn't sync from Supernova: ${errMsg || 'unknown error'}`
				: 'Connect your Supernova account and pick a component to see its health right here on the canvas.';

	const primaryLabel = hasData
		? 'Open documentation in Supernova'
		: mode === 'unauthorized'
			? 'Update token'
			: 'Connect to Supernova';

	// The link is resolved again on every click, so a widget last synced by an
	// older build — or before a page moved — never opens a stale URL. Without a
	// token (or offline) the stored link is used, but only if it is a docs-site
	// link: editor links from earlier builds are never opened.
	const openDocs = async () => {
		const fresh = await refresh({ silent: true });
		const stored = data?.openUrl && !/\/\/app\.supernova\.io\//.test(data.openUrl) ? data.openUrl : '';
		const url = fresh?.openUrl || stored;
		console.log('[Pulse] opening documentation', { url, freshlyResolved: !!fresh?.openUrl });
		if (!url) {
			figma.notify('No published documentation page found for this component', { timeout: 4000 });
			return;
		}
		await openExternal(url);
	};

	const showDocs = !hasData || (data.docsReady && !!data.openUrl);
	// Widgets synced by an older build have no codeUrl yet.
	const codeUrl = hasData ? (data.codeUrl ?? '') : '';

	const button = (label: string, kind: 'primary' | 'secondary', onClick: () => Promise<void> | void) => {
		const fg = kind === 'primary' ? COLORS.buttonFg : COLORS.buttonBg;
		return (
			<AutoLayout
				width="fill-parent"
				fill={kind === 'primary' ? COLORS.buttonBg : COLORS.cardBg}
				{...(kind === 'secondary' ? { stroke: COLORS.buttonBg, strokeWidth: 1.5, strokeAlign: 'inside' as const } : {})}
				cornerRadius={999}
				padding={{ vertical: 18, horizontal: 24 }}
				horizontalAlignItems="center"
				verticalAlignItems="center"
				spacing={8}
				onClick={onClick}
			>
				<Text fill={fg} fontFamily="Inter" fontSize={18} fontWeight={500}>
					{label}
				</Text>
				<SVG src={ARROW_NE_SVG(fg)} />
			</AutoLayout>
		);
	};

	const onPrimary = () => {
		if (hasData) return openDocs();
		if (mode === 'unauthorized') return openUI({ mode: 'token-only' });
		return openSetup('token');
	};

	const footerLeft = data?.syncedAt
		? `${relativeTime(data.syncedAt)} · ${data.designSystemName}`
		: mode === 'loading'
			? 'Syncing…'
			: mode === 'unauthorized'
				? 'Token expired'
				: mode === 'error'
					? 'Sync failed'
					: 'Not connected';
	const needsSetup = !hasData && (mode === 'empty' || mode === 'unauthorized');
	const footerRightFill = mode === 'unauthorized' && !hasData ? COLORS.pillDangerFg : COLORS.syncBlue;
	const onFooterRight = () => {
		if (!needsSetup) return refresh();
		return mode === 'unauthorized' ? openUI({ mode: 'token-only' }) : openSetup('token');
	};

	return (
		<AutoLayout
			name="Pulse for Supernova"
			direction="vertical"
			width={720}
			fill={COLORS.cardBg}
			cornerRadius={24}
			padding={32}
			spacing={24}
			effect={{ type: 'drop-shadow', color: { r: 0, g: 0, b: 0, a: 0.06 }, offset: { x: 0, y: 4 }, blur: 24, spread: 0 }}
			stroke={COLORS.cardBorder}
			strokeWidth={1}
		>
			{/* Header */}
			<AutoLayout width="fill-parent" verticalAlignItems="center" spacing="auto">
				<Text fill={COLORS.title} fontFamily="Inter" fontSize={32} fontWeight={700}>
					{data?.componentName ?? 'Pulse'}
				</Text>
				{pill(pillLabel, pillVariant)}
			</AutoLayout>

			{/* Status tiles */}
			<AutoLayout width="fill-parent" spacing={12}>
				{tile('DESIGN', !!data?.designReady)}
				{tile('CODE', !!data?.codeReady)}
				{tile('DOCS', !!data?.docsReady)}
			</AutoLayout>

			{/* Info banner */}
			<AutoLayout
				width="fill-parent"
				fill={COLORS.bannerBg}
				cornerRadius={12}
				padding={16}
				spacing={12}
				verticalAlignItems="center"
			>
				<SVG src={INFO_SVG(COLORS.bannerFg)} />
				<Text fill={COLORS.bannerFg} fontFamily="Inter" fontSize={16} width="fill-parent">
					{bannerText}
				</Text>
			</AutoLayout>

			{/* Actions — only when the click leads somewhere useful. Docs come first;
			    without docs, the code link takes the primary slot. */}
			{/* Ternaries, not &&: the widget renderer rejects "" and false children. */}
			{showDocs ? button(primaryLabel, 'primary', onPrimary) : null}
			{codeUrl ? button('Open code documentation', showDocs ? 'secondary' : 'primary', () => openExternal(codeUrl)) : null}

			{/* Footer */}
			<AutoLayout width="fill-parent" verticalAlignItems="center" spacing="auto">
				<AutoLayout direction="vertical" spacing={2}>
					<Text fill={COLORS.muted} fontFamily="Inter" fontSize={14}>
						{footerLeft}
					</Text>
					<Text fill={COLORS.muted} fontFamily="Inter" fontSize={10}>
						Pulse for Supernova {BUILD_VERSION}
					</Text>
				</AutoLayout>
				<AutoLayout spacing={6} verticalAlignItems="center" onClick={onFooterRight}>
					<Text fill={footerRightFill} fontFamily="Inter" fontSize={14} fontWeight={500}>
						{needsSetup ? 'Set up' : 'Sync'}
					</Text>
					<SVG src={REFRESH_SVG(footerRightFill)} />
				</AutoLayout>
			</AutoLayout>
		</AutoLayout>
	);
}

export default function () {
	widget.register(Widget);
}
