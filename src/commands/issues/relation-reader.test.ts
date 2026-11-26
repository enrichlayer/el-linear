import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { request, factory } = vi.hoisted(() => ({
	request: vi.fn(),
	factory: vi.fn(),
}));
vi.mock("../../utils/graphql-service.js", () => ({
	createGraphQLService: factory,
}));

import { RELATION_READ_LIMITS, readIssueRelations } from "./relation-reader.js";

const peer = {
	id: "peer",
	identifier: "DEV-2",
	title: "Peer",
	state: { id: "s", name: "Todo" },
	priority: null,
	assignee: null,
	team: null,
};
const row = (id = "r", type = "blocks", issue: unknown = peer) => ({
	id,
	type,
	issue,
});
const connection = (
	nodes: unknown[] = [],
	hasNextPage = false,
	endCursor: string | null = null,
) => ({ nodes, pageInfo: { hasNextPage, endCursor } });
const page = (
	incoming: unknown = connection(),
	outgoing: unknown = connection(),
) => ({
	issue: {
		id: "root",
		identifier: "DEV-1",
		title: "Root",
		relations: outgoing,
		inverseRelations: incoming,
	},
});

beforeEach(() => {
	request.mockReset();
	factory.mockReset().mockResolvedValue({ rawRequest: request });
});
afterEach(() => {
	vi.useRealTimers();
});

describe("canonical bounded relation reader", () => {
	it("both terminal empty connections establish complete absence", async () => {
		request.mockResolvedValue(page());
		expect(await readIssueRelations("root", {})).toEqual({
			id: "root",
			identifier: "DEV-1",
			title: "Root",
			data: [],
			meta: { count: 0, relations_complete: true },
		});
	});
	it("walks independent cursors and preserves outgoing then incoming rows", async () => {
		request
			.mockResolvedValueOnce(
				page(
					connection([row("i1")]),
					connection(
						[{ id: "o1", type: "similar", relatedIssue: peer }],
						true,
						"o-next",
					),
				),
			)
			.mockResolvedValueOnce({
				issue: {
					id: "root",
					identifier: "DEV-1",
					title: "Root",
					relations: connection([
						{ id: "o2", type: "duplicate", relatedIssue: peer },
					]),
				},
			});
		const result = await readIssueRelations("root", {});
		expect(result.data.map(({ id, type }) => [id, type])).toEqual([
			["o1", "similar"],
			["o2", "duplicate"],
			["i1", "blockedBy"],
		]);
		expect(request.mock.calls[1][1]).toEqual({
			id: "root",
			first: 50,
			outAfter: "o-next",
			inAfter: null,
			outgoing: true,
			incoming: false,
		});
	});
	it.each(["blocks", "related", "duplicate", "similar"])(
		"preserves actual raw enum %s",
		async (type) => {
			request.mockResolvedValue(page(connection([row("r", type)])));
			expect((await readIssueRelations("root", {})).data).toHaveLength(1);
		},
	);
	it("preserves schema-null optional state without inventing a closed state", async () => {
		request.mockResolvedValue(
			page(connection([row("r", "blocks", { ...peer, state: null })])),
		);
		expect(
			(await readIssueRelations("root", {})).data[0].issue,
		).not.toHaveProperty("state");
	});
	it.each([
		["null relation", null],
		["missing peer", row("r", "blocks", null)],
		["unknown type", row("r", "block")],
		["missing id", { ...row(), id: undefined }],
		[
			"missing identifier",
			row("r", "blocks", { ...peer, identifier: undefined }),
		],
		[
			"malformed identifier",
			row("r", "blocks", { ...peer, identifier: "DEV-2junk" }),
		],
		[
			"malformed state",
			row("r", "blocks", { ...peer, state: { id: "s", name: "" } }),
		],
		[
			"missing selected field",
			row("r", "blocks", { ...peer, state: undefined }),
		],
	])(
		"fails whole mixed read on %s instead of dropping a row",
		async (_, bad) => {
			request.mockResolvedValue(page(connection([row("valid"), bad])));
			await expect(readIssueRelations("root", {})).rejects.toThrow(
				/invalid relation/,
			);
		},
	);
	it.each([
		undefined,
		null,
		{ nodes: [] },
		{ nodes: [], pageInfo: { hasNextPage: "false", endCursor: null } },
		{ nodes: [], pageInfo: { hasNextPage: false } },
	])("rejects incomplete connection metadata %#", async (bad) => {
		const result = page();
		result.issue.inverseRelations = bad;
		request.mockResolvedValue(result);
		await expect(readIssueRelations("root", {})).rejects.toThrow(
			/pagination|connection/,
		);
	});
	it("missing issue never becomes complete empty", async () => {
		request.mockResolvedValue({ issue: null });
		await expect(readIssueRelations("root", {})).rejects.toThrow(
			/issue missing/,
		);
	});
	it("rejects a changed issue scope", async () => {
		request.mockResolvedValue({ issue: { ...page().issue, id: "other" } });
		await expect(readIssueRelations("root", {})).rejects.toThrow(/scope/);
	});
	it("rejects repeated cursors and relation IDs", async () => {
		request
			.mockResolvedValueOnce(page(connection([row("1")], true, "same")))
			.mockResolvedValueOnce(page(connection([row("2")], true, "same")));
		await expect(readIssueRelations("root", {})).rejects.toThrow(/cursor/);
		request
			.mockReset()
			.mockResolvedValue(page(connection([row("1")], true, "next")));
		await expect(readIssueRelations("root", {})).rejects.toThrow(
			/duplicate relation/,
		);
	});
	it.each(["incoming", "outgoing"] as const)(
		"rejects an empty %s page claiming more results on the first request",
		async (direction) => {
			const emptyMore = connection([], true, "next");
			request.mockResolvedValue(
				direction === "incoming"
					? page(emptyMore)
					: page(connection(), emptyMore),
			);
			await expect(readIssueRelations("root", {})).rejects.toThrow(/cursor/);
			expect(request).toHaveBeenCalledTimes(1);
		},
	);
	it("bounds total pages even with unique cursors", async () => {
		request.mockImplementation(async () => {
			const n = request.mock.calls.length;
			return page(connection([row(String(n))], true, String(n)));
		});
		await expect(readIssueRelations("root", {})).rejects.toThrow(/page limit/);
		expect(request).toHaveBeenCalledTimes(RELATION_READ_LIMITS.pages);
	});
	it("bounds individual page rows", async () => {
		request.mockResolvedValue(
			page(connection(Array.from({ length: 51 }, (_, i) => row(String(i))))),
		);
		await expect(readIssueRelations("root", {})).rejects.toThrow(
			/page row limit/,
		);
	});
	it("bounds retained total rows across both directions", async () => {
		request.mockImplementation(async () => {
			const n = request.mock.calls.length;
			return page(
				connection(
					Array.from({ length: 50 }, (_, i) => row(`${n}-${i}`)),
					true,
					String(n),
				),
			);
		});
		await expect(readIssueRelations("root", {})).rejects.toThrow(
			/total row limit/,
		);
		expect(request).toHaveBeenCalledTimes(21);
	});
	it("bounds response and formatted output bytes", async () => {
		request.mockResolvedValue(
			page(
				connection([
					row("r", "blocks", {
						...peer,
						title: "x".repeat(RELATION_READ_LIMITS.bytes),
					}),
				]),
			),
		);
		await expect(readIssueRelations("root", {})).rejects.toThrow(/byte limit/);
	});
	it("bounds pretty formatted output even when accumulated input fits", async () => {
		request.mockImplementation(async () => {
			const n = request.mock.calls.length;
			return page(
				connection(
					Array.from({ length: 50 }, (_, i) =>
						row(`${n}-${i}`, "blocks", { ...peer, title: "x".repeat(1850) }),
					),
					n < 10,
					String(n),
				),
			);
		});
		await expect(readIssueRelations("root", {})).rejects.toThrow(
			/output byte limit/,
		);
		expect(request).toHaveBeenCalledTimes(10);
	});
	it("later-page failure propagates, no partial or empty success", async () => {
		request
			.mockResolvedValueOnce(page(connection([row("1")], true, "next")))
			.mockRejectedValueOnce(new Error("relay unavailable"));
		await expect(readIssueRelations("root", {})).rejects.toThrow(
			/relay unavailable/,
		);
	});
	it("one total deadline aborts in-flight read and clears timer", async () => {
		vi.useFakeTimers();
		request.mockReturnValue(new Promise(() => {}));
		const pending = readIssueRelations("root", {});
		const failed = expect(pending).rejects.toThrow(/deadline/);
		await vi.advanceTimersByTimeAsync(RELATION_READ_LIMITS.timeoutMs);
		await failed;
		expect(factory.mock.calls[0][1].signal.aborted).toBe(true);
		expect(vi.getTimerCount()).toBe(0);
	});
	it("late service initialization cannot start a request after timeout", async () => {
		vi.useFakeTimers();
		let finish!: (value: unknown) => void;
		factory.mockReturnValue(
			new Promise((resolve) => {
				finish = resolve;
			}),
		);
		const pending = readIssueRelations("root", {});
		const failed = expect(pending).rejects.toThrow(/deadline/);
		await vi.advanceTimersByTimeAsync(RELATION_READ_LIMITS.timeoutMs);
		await failed;
		finish({ rawRequest: request });
		await Promise.resolve();
		await Promise.resolve();
		expect(request).not.toHaveBeenCalled();
	});
});
