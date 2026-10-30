/** Astro `base` may or may not include a trailing slash — normalize joins. */
export function withBase(path = ''): string {
	const raw = import.meta.env.BASE_URL || '/';
	const base = raw.endsWith('/') ? raw.slice(0, -1) : raw;
	if (!path || path === '/') {
		return base || '/';
	}
	const suffix = path.startsWith('/') ? path : `/${path}`;
	return `${base}${suffix}`;
}

export function baseRoot(): string {
	return withBase('/');
}
