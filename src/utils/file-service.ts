import { access, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { basename, dirname, extname } from "node:path";
import type { FileDownloadResult, FileUploadResult } from "../types/linear.js";
import { extractFilenameFromUrl, isLinearUploadUrl } from "./embed-parser.js";

const MAX_FILE_SIZE = 20 * 1024 * 1024;

const MIME_TYPES: Record<string, string> = {
	".png": "image/png",
	".jpg": "image/jpeg",
	".jpeg": "image/jpeg",
	".gif": "image/gif",
	".webp": "image/webp",
	".svg": "image/svg+xml",
	".ico": "image/x-icon",
	".pdf": "application/pdf",
	".doc": "application/msword",
	".docx":
		"application/vnd.openxmlformats-officedocument.wordprocessingml.document",
	".xls": "application/vnd.ms-excel",
	".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
	".ppt": "application/vnd.ms-powerpoint",
	".pptx":
		"application/vnd.openxmlformats-officedocument.presentationml.presentation",
	".txt": "text/plain",
	".csv": "text/csv",
	".json": "application/json",
	".xml": "application/xml",
	".html": "text/html",
	".css": "text/css",
	".js": "application/javascript",
	".ts": "application/typescript",
	".md": "text/markdown",
	".zip": "application/zip",
	".tar": "application/x-tar",
	".gz": "application/gzip",
	".mp4": "video/mp4",
	".mp3": "audio/mpeg",
	".wav": "audio/wav",
};

function getMimeType(filePath: string): string {
	const ext = extname(filePath).toLowerCase();
	return MIME_TYPES[ext] || "application/octet-stream";
}

/**
 * Constructor arg shapes for `FileService`:
 *   - `string` → personal API token (legacy; sent as `Authorization: <token>`).
 *   - `{apiKey: string}` → personal API token (explicit).
 *   - `{oauthToken: string}` → OAuth access token (sent as
 *     `Authorization: Bearer <token>`).
 *
 * The string variant exists because dozens of tests construct `FileService`
 * with a plain string. We continue to support it indefinitely.
 */
export type FileServiceAuth =
	| string
	| { apiKey: string }
	| { oauthToken: string };

function buildAuthHeader(auth: FileServiceAuth): string {
	if (typeof auth === "string") return auth;
	if ("oauthToken" in auth) return `Bearer ${auth.oauthToken}`;
	return auth.apiKey;
}

export class FileService {
	private readonly authHeader: string;

	constructor(auth: FileServiceAuth) {
		this.authHeader = buildAuthHeader(auth);
	}

	async downloadFile(
		url: string,
		options: { output?: string; overwrite?: boolean } = {},
	): Promise<FileDownloadResult> {
		if (!isLinearUploadUrl(url)) {
			return {
				success: false,
				error: "URL must be from uploads.linear.app domain",
			};
		}

		const outputPath = options.output || extractFilenameFromUrl(url);
		if (!options.overwrite) {
			try {
				await access(outputPath);
				return {
					success: false,
					error: `File already exists: ${outputPath}. Use --overwrite to replace.`,
				};
			} catch {
				// File doesn't exist, good
			}
		}

		try {
			const urlObj = new URL(url);
			const isSignedUrl = urlObj.searchParams.has("signature");
			const headers: Record<string, string> = {};
			if (!isSignedUrl) {
				headers.Authorization = this.authHeader;
			}

			const response = await fetch(url, { method: "GET", headers });
			if (!response.ok) {
				return {
					success: false,
					error: `HTTP ${response.status}: ${response.statusText}`,
					statusCode: response.status,
				};
			}

			const arrayBuffer = await response.arrayBuffer();
			const buffer = Buffer.from(arrayBuffer);
			const outputDir = dirname(outputPath);
			if (outputDir !== ".") {
				await mkdir(outputDir, { recursive: true });
			}
			await writeFile(outputPath, buffer);
			return { success: true, filePath: outputPath };
		} catch (error) {
			return {
				success: false,
				error: error instanceof Error ? error.message : String(error),
			};
		}
	}

	async uploadFile(filePath: string): Promise<FileUploadResult> {
		const filename = basename(filePath);
		const validation = await this.validateFileForUpload(filePath);
		if (!validation.ok) {
			return validation.error;
		}

		const contentType = getMimeType(filePath);
		try {
			const uploadMeta = await this.requestUploadUrl(
				contentType,
				filename,
				validation.fileSize,
			);
			if (!uploadMeta.ok) {
				return uploadMeta.error;
			}
			return await this.putFileToUrl(
				filePath,
				contentType,
				filename,
				uploadMeta,
			);
		} catch (error) {
			return {
				success: false,
				error: error instanceof Error ? error.message : String(error),
			};
		}
	}

	private async validateFileForUpload(
		filePath: string,
	): Promise<
		{ ok: true; fileSize: number } | { ok: false; error: FileUploadResult }
	> {
		try {
			await access(filePath);
		} catch {
			return {
				ok: false,
				error: { success: false, error: `File not found: ${filePath}` },
			};
		}
		try {
			const fileStat = await stat(filePath);
			if (fileStat.size > MAX_FILE_SIZE) {
				const maxMB = MAX_FILE_SIZE / (1024 * 1024);
				const actualMB = fileStat.size / (1024 * 1024);
				return {
					ok: false,
					error: {
						success: false,
						error: `File too large: ${actualMB.toFixed(1)}MB exceeds limit of ${maxMB}MB`,
					},
				};
			}
			return { ok: true, fileSize: fileStat.size };
		} catch (error) {
			return {
				ok: false,
				error: {
					success: false,
					error: `Cannot read file: ${error instanceof Error ? error.message : String(error)}`,
				},
			};
		}
	}

	private async requestUploadUrl(
		contentType: string,
		filename: string,
		fileSize: number,
	): Promise<
		| {
				ok: true;
				uploadUrl: string;
				assetUrl: string;
				headers: Array<{ key: string; value: string }>;
		  }
		| { ok: false; error: FileUploadResult }
	> {
		const query = `
      mutation FileUpload($contentType: String!, $filename: String!, $size: Int!) {
        fileUpload(contentType: $contentType, filename: $filename, size: $size) {
          success
          uploadFile { uploadUrl assetUrl headers { key value } }
        }
      }
    `;
		const response = await fetch("https://api.linear.app/graphql", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: this.authHeader,
			},
			body: JSON.stringify({
				query,
				variables: { contentType, filename, size: fileSize },
			}),
		});
		if (!response.ok) {
			return {
				ok: false,
				error: {
					success: false,
					error: `GraphQL request failed: HTTP ${response.status}`,
					statusCode: response.status,
				},
			};
		}
		const data = (await response.json()) as {
			errors?: Array<{ message?: string }>;
			data?: {
				fileUpload?: {
					success: boolean;
					uploadFile?: {
						uploadUrl: string;
						assetUrl: string;
						headers: Array<{ key: string; value: string }>;
					};
				};
			};
		};
		if (data.errors) {
			return {
				ok: false,
				error: {
					success: false,
					error: `Failed to request upload URL: ${data.errors[0]?.message || "GraphQL error"}`,
				},
			};
		}
		const fileUpload = data.data?.fileUpload;
		if (!fileUpload?.success) {
			return {
				ok: false,
				error: {
					success: false,
					error: "Failed to request upload URL: success=false",
				},
			};
		}
		const uploadFile = fileUpload.uploadFile;
		if (!(uploadFile?.uploadUrl && uploadFile?.assetUrl)) {
			return {
				ok: false,
				error: {
					success: false,
					error: "Missing uploadUrl or assetUrl in response",
				},
			};
		}
		return {
			ok: true,
			uploadUrl: uploadFile.uploadUrl,
			assetUrl: uploadFile.assetUrl,
			headers: uploadFile.headers || [],
		};
	}

	private async putFileToUrl(
		filePath: string,
		contentType: string,
		filename: string,
		meta: {
			uploadUrl: string;
			assetUrl: string;
			headers: Array<{ key: string; value: string }>;
		},
	): Promise<FileUploadResult> {
		const fileBuffer = await readFile(filePath);
		const putHeaders: Record<string, string> = { "Content-Type": contentType };
		for (const header of meta.headers) {
			putHeaders[header.key] = header.value;
		}
		const putResponse = await fetch(meta.uploadUrl, {
			method: "PUT",
			headers: putHeaders,
			body: new Uint8Array(fileBuffer),
		});
		if (!putResponse.ok) {
			return {
				success: false,
				error: `File upload failed: HTTP ${putResponse.status}`,
				statusCode: putResponse.status,
			};
		}
		return { success: true, assetUrl: meta.assetUrl, filename };
	}
}

import { getActiveAuth } from "../auth/token-resolver.js";
import type { AuthOptions } from "./auth.js";

/**
 * OAuth-aware factory: resolves the active credential (with auto-refresh
 * for OAuth tokens) and returns a `FileService` configured with the right
 * `Authorization` header shape. Personal tokens use `Authorization:
 * <token>` (no Bearer prefix); OAuth tokens use `Authorization: Bearer
 * <token>`.
 */
export async function createFileService(
	options: AuthOptions,
): Promise<FileService> {
	const auth = await getActiveAuth(options);
	if (auth.kind === "oauth") {
		return new FileService({ oauthToken: auth.token });
	}
	return new FileService({ apiKey: auth.token });
}
