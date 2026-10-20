import React, { useEffect, useMemo, useRef, useState } from 'react';

// Mirrors the types in src/main/supernova.ts — the iframe and the widget only
// share messages, not modules.
type SignalKey = 'status' | 'repository' | 'documentationLink';
interface PropertyRef {
	ids: string[];
	name: string;
}
type PropertyMapping = Record<SignalKey, PropertyRef | null>;
interface SourceConfig {
	designSystemId: string;
	designSystemName: string;
	properties: PropertyMapping;
	docsUrl?: string;
}
interface DesignSystemSummary {
	id: string;
	name: string;
	workspaceName: string;
}
interface PropertyDefinition extends PropertyRef {
	type: string;
}
interface ComponentSummary {
	persistentId: string;
	name: string;
}

type InitPayload =
	| {
			mode: 'setup';
			startAt: 'token' | 'source' | 'mapping' | 'component';
			source: SourceConfig | null;
			currentPid: string | null;
	  }
	| { mode: 'token-only' };

type Step = 'token' | 'source' | 'mapping' | 'component';

const SIGNALS: Array<{ key: SignalKey; tile: string; help: string }> = [
	{ key: 'status', tile: 'DESIGN', help: 'Status property. A "Healthy"/"Ready"/"Stable" value turns the tile green.' },
	{ key: 'repository', tile: 'CODE', help: 'Storybook or repository link. Any value turns the tile green; a link also adds a button to it.' },
	{ key: 'documentationLink', tile: 'DOCS', help: 'Link to the documentation page. Also powers the "Open" button.' },
];

const send = (msg: Record<string, unknown>) => parent.postMessage({ pluginMessage: msg }, '*');

const App = () => {
	const [payload, setPayload] = useState<InitPayload | null>(null);
	const [step, setStep] = useState<Step>('token');
	const [token, setToken] = useState('');
	const [showToken, setShowToken] = useState(false);
	const [tokenStatus, setTokenStatus] = useState<'unknown' | 'valid' | 'invalid'>('unknown');
	const [userName, setUserName] = useState('');
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState('');
	const [query, setQuery] = useState('');

	const [designSystems, setDesignSystems] = useState<DesignSystemSummary[] | null>(null);
	const [manualId, setManualId] = useState('');
	const [source, setSource] = useState<SourceConfig | null>(null);
	const [definitions, setDefinitions] = useState<PropertyDefinition[]>([]);
	const [components, setComponents] = useState<ComponentSummary[] | null>(null);
	const [selectedPid, setSelectedPid] = useState<string | null>(null);

	// Refs give the message handler the latest values without re-registering it.
	const payloadRef = useRef<InitPayload | null>(null);
	const tokenRef = useRef('');
	const sourceRef = useRef<SourceConfig | null>(null);

	const goTo = (next: Step, src: SourceConfig | null = sourceRef.current) => {
		setError('');
		setQuery('');
		setStep(next);
		if (next === 'source') {
			setLoading(true);
			send({ type: 'list-design-systems', token: tokenRef.current });
		}
		if (next === 'component' && src) {
			setComponents(null);
			setLoading(true);
			send({ type: 'list-components', token: tokenRef.current, designSystemId: src.designSystemId });
		}
	};

	// After a valid token: continue where the menu action asked to start.
	const afterToken = () => {
		const p = payloadRef.current;
		if (p?.mode === 'token-only') {
			send({ type: 'submit', token: tokenRef.current });
			return;
		}
		const src = sourceRef.current;
		if (p?.mode === 'setup' && p.startAt === 'mapping' && src) {
			// Straight to the mapping step; the properties result keeps the current mapping.
			setLoading(true);
			send({ type: 'list-properties', token: tokenRef.current, designSystemId: src.designSystemId });
			return;
		}
		goTo(p?.mode === 'setup' && p.startAt === 'component' && src ? 'component' : 'source');
	};

	// Opened via "Edit tile mapping" on a configured widget: save the mapping
	// without picking the component again.
	const editingMapping = payload?.mode === 'setup' && payload.startAt === 'mapping' && !!payload.currentPid;

	useEffect(() => {
		const onMessage = (event: MessageEvent) => {
			const msg = event.data?.pluginMessage;
			if (!msg) return;
			const r = msg.result;
			switch (msg.type) {
				case 'init': {
					const p: InitPayload = msg.payload;
					payloadRef.current = p;
					setPayload(p);
					if (p.mode === 'setup') {
						sourceRef.current = p.source;
						setSource(p.source);
						setSelectedPid(p.currentPid);
					}
					send({ type: 'request-token' });
					return;
				}
				case 'token': {
					const t: string = msg.value ?? '';
					tokenRef.current = t;
					setToken(t);
					// A stored token skips the token step — except when we are here to replace it.
					if (t && payloadRef.current?.mode === 'setup') {
						setLoading(true);
						send({ type: 'validate-token', token: t });
					}
					return;
				}
				case 'token-result':
					setLoading(false);
					if (r?.ok) {
						setTokenStatus('valid');
						setUserName(r.user?.name ?? '');
						afterToken();
					} else {
						setTokenStatus('invalid');
						setStep('token');
						setError(
							r?.reason === 'unauthorized'
								? 'This token was rejected. Paste a fresh one.'
								: `Couldn't reach Supernova: ${r?.message ?? 'unknown error'}`,
						);
					}
					return;
				case 'design-systems-result':
					setLoading(false);
					if (r?.ok) setDesignSystems(r.items);
					else {
						setDesignSystems([]);
						setError(`Couldn't list design systems: ${r?.message}. You can still enter an ID below.`);
					}
					return;
				case 'properties-result':
					setLoading(false);
					if (r?.ok) {
						setDefinitions(r.definitions);
						const current = sourceRef.current;
						if (current) {
							// Keep an existing mapping when re-opening the same design system.
							const keep = Object.values(current.properties).some(Boolean);
							const next = {
								...current,
								properties: keep ? current.properties : r.suggested,
								docsUrl: current.docsUrl || r.docsSite || '',
							};
							sourceRef.current = next;
							setSource(next);
						}
						setStep('mapping');
					} else setError(`Couldn't load properties: ${r?.message}`);
					return;
				case 'components-result':
					setLoading(false);
					if (r?.ok) setComponents(r.items);
					else setError(`Couldn't load components: ${r?.message}`);
					return;
			}
		};
		window.addEventListener('message', onMessage);
		return () => window.removeEventListener('message', onMessage);
	}, []);

	const chooseDesignSystem = (id: string, name: string) => {
		const sameAsBefore = sourceRef.current?.designSystemId === id;
		const next: SourceConfig = {
			designSystemId: id,
			designSystemName: name,
			properties: sameAsBefore && sourceRef.current
				? sourceRef.current.properties
				: { status: null, repository: null, documentationLink: null },
		};
		if (!sameAsBefore) setSelectedPid(null);
		sourceRef.current = next;
		setSource(next);
		setError('');
		setLoading(true);
		send({ type: 'list-properties', token: tokenRef.current, designSystemId: id });
	};

	const setMapping = (key: SignalKey, idKey: string) => {
		if (!source) return;
		const def = definitions.find((d) => d.ids[0] === idKey);
		const next = { ...source, properties: { ...source.properties, [key]: def ? { ids: def.ids, name: def.name } : null } };
		sourceRef.current = next;
		setSource(next);
	};

	const filteredSystems = useMemo(() => {
		const q = query.trim().toLowerCase();
		return (designSystems ?? []).filter(
			(d) => !q || d.name.toLowerCase().includes(q) || d.workspaceName.toLowerCase().includes(q),
		);
	}, [designSystems, query]);

	const filteredComponents = useMemo(() => {
		const q = query.trim().toLowerCase();
		return (components ?? []).filter((c) => !q || c.name.toLowerCase().includes(q));
	}, [components, query]);

	if (!payload) return <div style={s.center}>Loading…</div>;

	const isTokenOnly = payload.mode === 'token-only';
	const header: Record<Step, [string, string]> = {
		token: isTokenOnly
			? ['Update Supernova token', 'Paste a fresh API token to restore the live connection.']
			: ['Connect Supernova', 'Paste your Supernova API token. It stays on this device.'],
		source: ['Pick a design system', userName ? `Signed in as ${userName}.` : 'Every design system your token can read.'],
		mapping: editingMapping
			? ['Edit tile mapping', source ? `Which property of ${source.designSystemName} drives each tile?` : '']
			: ['Map the tiles', 'Which component property drives each tile? We pre-selected the likely ones.'],
		component: ['Pick a component', source ? `From ${source.designSystemName}.` : ''],
	};
	const [title, subtitle] = header[step];

	const submitToken = () => {
		if (!token) return setError('Please paste your Supernova token.');
		tokenRef.current = token;
		setLoading(true);
		setError('');
		send({ type: 'validate-token', token });
	};

	const onSave = () => {
		if (!selectedPid || !source) return setError('Pick a component first.');
		send({ type: 'submit', token: tokenRef.current, source, componentPersistentId: selectedPid });
	};

	let body: React.ReactNode;
	let primary: React.ReactNode;

	if (step === 'token') {
		body = (
			<>
				<label style={s.label}>
					Supernova API token
					{tokenStatus === 'invalid' && <span style={s.badgeBad}>Invalid</span>}
				</label>
				<div style={s.secretField}>
					<input
						type={showToken ? 'text' : 'password'}
						value={token}
						placeholder="Paste token"
						onChange={(e) => {
							setToken(e.target.value);
							setTokenStatus('unknown');
						}}
						onKeyDown={(e) => e.key === 'Enter' && submitToken()}
						style={{ ...s.input, marginBottom: 0, paddingRight: 56 }}
						autoComplete="off"
						spellCheck={false}
						autoFocus
					/>
					<button
						type="button"
						style={s.revealBtn}
						onClick={() => setShowToken((v) => !v)}
						aria-label={showToken ? 'Hide token' : 'Show token'}
						aria-pressed={showToken}
					>
						{showToken ? 'Hide' : 'Show'}
					</button>
				</div>
				<div style={s.hint}>
					Create a personal access token in your Supernova profile settings. Read access is enough. It is
					stored in Figma's local storage on this device only and never written into the file.
				</div>
			</>
		);
		primary = (
			<button style={s.primaryBtn} disabled={!token || loading} onClick={submitToken}>
				{loading ? 'Checking…' : isTokenOnly ? 'Save token' : 'Continue'}
			</button>
		);
	} else if (step === 'source') {
		body = (
			<>
				<input
					type="text"
					value={query}
					placeholder="Search design systems…"
					onChange={(e) => setQuery(e.target.value)}
					style={s.input}
					autoFocus
				/>
				{loading && !designSystems ? (
					<div style={s.empty}>Loading design systems…</div>
				) : (
					<div style={s.list}>
						{filteredSystems.length === 0 && <div style={s.empty}>No design systems found.</div>}
						{filteredSystems.map((d) => (
							<button
								key={d.id}
								style={{ ...s.row, ...(source?.designSystemId === d.id ? s.rowSelected : {}) }}
								onClick={() => chooseDesignSystem(d.id, d.name)}
								disabled={loading}
							>
								<div>{d.name}</div>
								<div style={s.rowMeta}>{d.workspaceName}</div>
							</button>
						))}
					</div>
				)}
				<div style={{ ...s.hint, marginTop: 12 }}>Not listed? Enter the design system ID from its Studio URL.</div>
				<div style={{ display: 'flex', gap: 6 }}>
					<input
						type="text"
						value={manualId}
						placeholder="e.g. 123456"
						onChange={(e) => setManualId(e.target.value.trim())}
						style={{ ...s.input, marginBottom: 0 }}
					/>
					<button
						style={s.secondaryBtn}
						disabled={!manualId || loading}
						onClick={() => chooseDesignSystem(manualId, `Design system ${manualId}`)}
					>
						Use ID
					</button>
				</div>
			</>
		);
		primary = loading && designSystems ? <span style={s.hint}>Loading properties…</span> : null;
	} else if (step === 'mapping') {
		body = (
			<>
				{SIGNALS.map(({ key, tile, help }) => (
					<div key={key} style={{ marginBottom: 14 }}>
						<label style={s.label}>
							<span>
								<span style={s.tileTag}>{tile}</span> tile
							</span>
						</label>
						<select
							style={s.input}
							value={source?.properties[key]?.ids[0] ?? ''}
							onChange={(e) => setMapping(key, e.target.value)}
						>
							<option value="">— Not used —</option>
							{definitions.map((d) => (
								<option key={d.ids[0]} value={d.ids[0]}>
									{d.name}
									{d.type ? ` (${d.type})` : ''}
								</option>
							))}
						</select>
						<div style={s.hint}>{help}</div>
					</div>
				))}
				<div style={{ marginBottom: 14 }}>
					<label style={s.label}>
						Published docs site
						<span style={s.optionalTag}>Optional</span>
					</label>
					<input
						type="text"
						style={s.input}
						value={source?.docsUrl ?? ''}
						placeholder="https://your-team.supernova-docs.io"
						onChange={(e) => {
							if (!source) return;
							const next = { ...source, docsUrl: e.target.value.trim() };
							sourceRef.current = next;
							setSource(next);
						}}
					/>
					<div style={s.hint}>
						Where "Open documentation" links to. Leave it empty to use the site Supernova reports; set it if your docs live elsewhere.
					</div>
				</div>
				{definitions.length === 0 && (
					<div style={s.empty}>This design system has no component properties yet. Tiles will stay grey.</div>
				)}
			</>
		);
		primary = editingMapping ? (
			<button style={s.primaryBtn} onClick={onSave}>
				Save
			</button>
		) : (
			<button style={s.primaryBtn} onClick={() => goTo('component')}>
				Continue
			</button>
		);
	} else {
		body = (
			<>
				<div style={s.tokenRow}>
					<span style={s.badgeGood}>{source?.designSystemName}</span>
					<button style={s.linkBtn} onClick={() => goTo('source')}>
						Change design system
					</button>
				</div>
				<input
					type="text"
					value={query}
					placeholder="Search components…"
					onChange={(e) => setQuery(e.target.value)}
					style={s.input}
					autoFocus
				/>
				{loading && !components ? (
					<div style={s.empty}>Loading components…</div>
				) : (
					<div style={s.list}>
						{filteredComponents.length === 0 && <div style={s.empty}>No matches.</div>}
						{filteredComponents.map((c) => (
							<button
								key={c.persistentId}
								style={{ ...s.row, ...(selectedPid === c.persistentId ? s.rowSelected : {}) }}
								onClick={() => setSelectedPid(c.persistentId)}
							>
								{c.name}
							</button>
						))}
					</div>
				)}
			</>
		);
		primary = (
			<button style={s.primaryBtn} disabled={!selectedPid} onClick={onSave}>
				Save
			</button>
		);
	}

	const steps: Step[] = ['token', 'source', 'mapping', 'component'];

	return (
		<div style={s.root}>
			<div style={s.header}>
				{!isTokenOnly && (
					<div style={s.stepper}>
						{steps.map((st, i) => (
							<div key={st} style={{ ...s.stepDot, ...(steps.indexOf(step) >= i ? s.stepDotOn : {}) }} />
						))}
					</div>
				)}
				<div style={s.title}>{title}</div>
				<div style={s.subtitle}>{subtitle}</div>
			</div>
			<div style={s.body}>
				{body}
				{error && <div style={s.error}>{error}</div>}
			</div>
			<div style={s.footer}>
				<button style={s.linkBtn} onClick={() => send({ type: 'close' })}>
					Cancel
				</button>
				{primary}
			</div>
		</div>
	);
};

const s: Record<string, React.CSSProperties> = {
	root: {
		display: 'flex',
		flexDirection: 'column',
		height: '100%',
		fontFamily: 'Inter, system-ui, sans-serif',
		fontSize: 13,
		color: 'var(--figma-color-text)',
		background: 'var(--figma-color-bg)',
	},
	header: { padding: '14px 16px 10px', borderBottom: '1px solid var(--figma-color-border)' },
	stepper: { display: 'flex', gap: 4, marginBottom: 10 },
	stepDot: { flex: 1, height: 3, borderRadius: 2, background: 'var(--figma-color-border)' },
	stepDotOn: { background: 'var(--figma-color-bg-brand, #0C8CE9)' },
	title: { fontSize: 14, fontWeight: 600, marginBottom: 2 },
	subtitle: { fontSize: 12, color: 'var(--figma-color-text-secondary)' },
	body: { flex: 1, padding: '12px 16px', overflowY: 'auto', display: 'flex', flexDirection: 'column' },
	label: { fontWeight: 600, marginBottom: 6, display: 'flex', alignItems: 'center', justifyContent: 'space-between' },
	tileTag: {
		fontSize: 10,
		letterSpacing: 1,
		padding: '2px 6px',
		borderRadius: 4,
		background: 'var(--figma-color-bg-secondary)',
		marginRight: 4,
	},
	tokenRow: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
	input: {
		width: '100%',
		padding: '8px 10px',
		borderRadius: 6,
		border: '1px solid var(--figma-color-border)',
		fontSize: 12,
		background: 'var(--figma-color-bg-secondary)',
		color: 'var(--figma-color-text)',
		marginBottom: 6,
	},
	secretField: { position: 'relative', marginBottom: 6 },
	revealBtn: {
		position: 'absolute',
		top: 0,
		right: 0,
		height: '100%',
		padding: '0 10px',
		fontSize: 11,
		fontWeight: 600,
		color: 'var(--figma-color-text-secondary)',
		cursor: 'pointer',
	},
	hint: { fontSize: 11, color: 'var(--figma-color-text-secondary)', marginBottom: 4, lineHeight: 1.45 },
	list: {
		maxHeight: 300,
		overflowY: 'auto',
		border: '1px solid var(--figma-color-border)',
		borderRadius: 6,
		marginTop: 6,
	},
	row: {
		display: 'block',
		width: '100%',
		textAlign: 'left',
		padding: '8px 10px',
		borderBottom: '1px solid var(--figma-color-border)',
		color: 'var(--figma-color-text)',
		fontSize: 12,
		cursor: 'pointer',
	},
	rowMeta: { fontSize: 11, color: 'var(--figma-color-text-secondary)', marginTop: 2 },
	rowSelected: { background: 'var(--figma-color-bg-selected, rgba(12,140,233,0.15))', fontWeight: 600 },
	empty: { padding: 12, color: 'var(--figma-color-text-secondary)', fontSize: 12 },
	error: {
		marginTop: 10,
		padding: '8px 10px',
		borderRadius: 6,
		background: 'rgba(220, 38, 38, 0.08)',
		color: '#a50000',
		fontSize: 12,
	},
	footer: {
		padding: '10px 16px',
		borderTop: '1px solid var(--figma-color-border)',
		display: 'flex',
		justifyContent: 'space-between',
		alignItems: 'center',
	},
	linkBtn: { color: 'var(--figma-color-text-secondary)', cursor: 'pointer', fontSize: 12, padding: 0 },
	primaryBtn: {
		padding: '8px 14px',
		borderRadius: 6,
		background: 'var(--figma-color-bg-brand, #0C8CE9)',
		color: 'white',
		cursor: 'pointer',
		fontWeight: 600,
		fontSize: 12,
	},
	secondaryBtn: {
		padding: '8px 12px',
		borderRadius: 6,
		border: '1px solid var(--figma-color-border)',
		cursor: 'pointer',
		fontSize: 12,
		whiteSpace: 'nowrap',
	},
	optionalTag: {
		fontSize: 10,
		fontWeight: 500,
		padding: '1px 6px',
		borderRadius: 4,
		border: '1px solid var(--figma-color-border)',
		color: 'var(--figma-color-text-secondary)',
	},
	badgeGood: { fontSize: 11, padding: '2px 8px', borderRadius: 4, background: '#D3FEDE', color: '#0E5C29' },
	badgeBad: { fontSize: 10, padding: '2px 6px', borderRadius: 4, background: '#FFE5E5', color: '#A50000' },
	center: { display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' },
};

export default App;
