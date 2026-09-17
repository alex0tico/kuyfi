export function truncateContractId(id: string, head = 6, tail = 5): string {
	if (id.length <= head + tail + 3) return id;
	return `${id.slice(0, head)}...${id.slice(-tail)}`;
}

export function formatBytes(n: number): string {
	return n.toLocaleString('en-US');
}
