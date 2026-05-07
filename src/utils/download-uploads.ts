import { mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { LinearIssue } from "../types/linear.js";
import type { FileService } from "./file-service.js";

const DOWNLOAD_DIR = join(tmpdir(), "el-linear-downloads");
const UPLOAD_URL_REGEX = /https:\/\/uploads\.linear\.app\/[^\s)>\]"]+/g;

function collectUploadUrls(text: string): string[] {
	const matches = text.match(UPLOAD_URL_REGEX);
	return matches ? [...new Set(matches)] : [];
}

function replaceUrls(text: string, urlMap: Map<string, string>): string {
	let result = text;
	for (const [remote, local] of urlMap) {
		result = result.replaceAll(remote, local);
	}
	return result;
}

/**
 * Downloads all uploads.linear.app URLs found in an issue's description
 * and comments, replacing them with local file paths so Claude Code
 * can read the images directly.
 */
export async function downloadLinearUploads(
	issue: LinearIssue,
	fileService: FileService,
): Promise<LinearIssue> {
	const allUrls = new Set<string>();

	if (issue.description) {
		for (const url of collectUploadUrls(issue.description)) {
			allUrls.add(url);
		}
	}
	if (issue.comments) {
		for (const comment of issue.comments) {
			for (const url of collectUploadUrls(comment.body)) {
				allUrls.add(url);
			}
		}
	}

	if (allUrls.size === 0) {
		return issue;
	}

	await mkdir(DOWNLOAD_DIR, { recursive: true });
	const urlMap = new Map<string, string>();

	await Promise.all(
		[...allUrls].map(async (url) => {
			const filename = extractUniqueFilename(url);
			const localPath = join(DOWNLOAD_DIR, filename);
			const result = await fileService.downloadFile(url, {
				output: localPath,
				overwrite: true,
			});
			if (result.success) {
				urlMap.set(url, result.filePath);
			}
		}),
	);

	if (urlMap.size === 0) {
		return issue;
	}

	const updated = { ...issue };
	if (updated.description) {
		updated.description = replaceUrls(updated.description, urlMap);
	}
	if (updated.comments) {
		updated.comments = updated.comments.map((comment) => ({
			...comment,
			body: replaceUrls(comment.body, urlMap),
		}));
	}
	if (updated.embeds) {
		updated.embeds = updated.embeds.map((embed) => {
			const local = urlMap.get(embed.url);
			return local ? { ...embed, url: local } : embed;
		});
	}

	return updated;
}

function extractUniqueFilename(url: string): string {
	try {
		const urlObj = new URL(url);
		// Path like /workspace-id/uuid1/uuid2/filename.png — take last two parts for uniqueness
		const parts = urlObj.pathname.split("/").filter(Boolean);
		if (parts.length >= 2) {
			return `${parts.at(-2)?.slice(0, 8)}-${parts.at(-1) ?? ""}`;
		}
		return parts.at(-1) || "download";
	} catch {
		return `download-${Date.now()}`;
	}
}
