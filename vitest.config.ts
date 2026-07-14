import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		// `.tmp/` and `.claude/` are gitignored dirs that hold full git worktrees
		// (`.tmp/wt-*` is this repo's standard wt-new placement). Unexcluded, a full
		// `pnpm test` walks every worktree and collects its copy of the suite — so
		// the same tests run N times and the run dies with `Cannot find module` on
		// test files whose worktree branch has since deleted them. None of that
		// reflects the working tree's own code, which is what makes it so
		// misleading: it masks whether a real failure exists. CI runs on a clean
		// checkout and stays green, so this only bites local contributors
		// (DEV-5944). biome.json excludes the same two dirs for the same reason.
		exclude: ["dist/**", "node_modules/**", ".tmp/**", ".claude/**"],
	},
});
