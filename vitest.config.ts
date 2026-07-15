import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		// `.tmp/`, `.claude/` and `.agents/` are gitignored dirs that hold no tracked
		// source of ours, but that local agent tooling fills with content from OTHER
		// checkouts — either full git worktrees (`.tmp/wt-*` is this repo's standard
		// wt-new placement) or symlink farms pointing into a separate repo
		// (`.agents/skills/*`, `.claude/`).
		//
		// Unexcluded, a full `pnpm test` walks every worktree and collects its copy of
		// the suite — so the same tests run N times and the run dies with `Cannot find
		// module` on test files whose worktree branch has since deleted them. None of
		// that reflects the working tree's own code, which is what makes it so
		// misleading: it masks whether a real failure exists. `.agents/` carries no
		// test files today, so its entry here is pre-emptive — it costs nothing and
		// keeps the excluded set identical across vitest, biome, and .gitignore.
		//
		// CI runs on a clean checkout and stays green, so this only bites local
		// contributors (DEV-5944, DEV-6206). biome.json excludes the same dirs for the
		// same reason.
		exclude: [
			"dist/**",
			"node_modules/**",
			".tmp/**",
			".claude/**",
			".agents/**",
		],
	},
});
