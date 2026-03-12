import { beforeEach, describe, expect, it, vi } from "vitest";

const mockAccess = vi.fn();
const mockMkdir = vi.fn();
const mockReadFile = vi.fn();
const mockStat = vi.fn();
const mockWriteFile = vi.fn();

vi.mock("node:fs/promises", () => ({
  access: (...args: unknown[]) => mockAccess(...args),
  mkdir: (...args: unknown[]) => mockMkdir(...args),
  readFile: (...args: unknown[]) => mockReadFile(...args),
  stat: (...args: unknown[]) => mockStat(...args),
  writeFile: (...args: unknown[]) => mockWriteFile(...args),
}));

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

const { FileService } = await import("./file-service.js");

function createService() {
  return new FileService("test-api-token");
}

describe("FileService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("downloadFile", () => {
    it("rejects non-Linear URLs", async () => {
      const service = createService();
      const result = await service.downloadFile("https://example.com/file.pdf");
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toBe("URL must be from uploads.linear.app domain");
      }
    });

    it("returns error if file already exists and overwrite is false", async () => {
      const service = createService();
      mockAccess.mockResolvedValue(undefined);
      const result = await service.downloadFile(
        "https://uploads.linear.app/abc/file.png",
        { output: "file.png" },
      );
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toContain("File already exists");
      }
    });

    it("downloads file with auth header for unsigned URLs", async () => {
      const service = createService();
      mockAccess.mockRejectedValue(new Error("ENOENT"));
      mockMkdir.mockResolvedValue(undefined);
      mockWriteFile.mockResolvedValue(undefined);
      mockFetch.mockResolvedValue({
        ok: true,
        arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)),
      });

      const result = await service.downloadFile(
        "https://uploads.linear.app/abc/photo.png",
        { output: "output/photo.png" },
      );

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.filePath).toBe("output/photo.png");
      }
      expect(mockFetch).toHaveBeenCalledWith(
        "https://uploads.linear.app/abc/photo.png",
        expect.objectContaining({
          headers: { Authorization: "test-api-token" },
        }),
      );
    });

    it("skips auth header for signed URLs", async () => {
      const service = createService();
      mockAccess.mockRejectedValue(new Error("ENOENT"));
      mockWriteFile.mockResolvedValue(undefined);
      mockFetch.mockResolvedValue({
        ok: true,
        arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)),
      });

      await service.downloadFile(
        "https://uploads.linear.app/abc/photo.png?signature=abc123",
        { output: "photo.png" },
      );

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ headers: {} }),
      );
    });

    it("returns error on HTTP failure", async () => {
      const service = createService();
      mockAccess.mockRejectedValue(new Error("ENOENT"));
      mockFetch.mockResolvedValue({
        ok: false,
        status: 404,
        statusText: "Not Found",
      });

      const result = await service.downloadFile(
        "https://uploads.linear.app/abc/missing.png",
        { output: "missing.png" },
      );

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toBe("HTTP 404: Not Found");
        expect(result.statusCode).toBe(404);
      }
    });

    it("allows overwrite when option is set", async () => {
      const service = createService();
      mockFetch.mockResolvedValue({
        ok: true,
        arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)),
      });
      mockWriteFile.mockResolvedValue(undefined);

      const result = await service.downloadFile(
        "https://uploads.linear.app/abc/file.png",
        { output: "file.png", overwrite: true },
      );

      expect(result.success).toBe(true);
      expect(mockAccess).not.toHaveBeenCalled();
    });
  });

  describe("uploadFile", () => {
    it("returns error if file not found", async () => {
      const service = createService();
      mockAccess.mockRejectedValue(new Error("ENOENT"));

      const result = await service.uploadFile("/path/to/missing.pdf");
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toBe("File not found: /path/to/missing.pdf");
      }
    });

    it("returns error if file too large", async () => {
      const service = createService();
      mockAccess.mockResolvedValue(undefined);
      mockStat.mockResolvedValue({ size: 25 * 1024 * 1024 });

      const result = await service.uploadFile("/path/to/huge.pdf");
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toContain("File too large");
        expect(result.error).toContain("25.0MB");
      }
    });

    it("returns error on GraphQL upload URL request failure", async () => {
      const service = createService();
      mockAccess.mockResolvedValue(undefined);
      mockStat.mockResolvedValue({ size: 1024 });
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
      });

      const result = await service.uploadFile("/path/to/doc.pdf");
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toContain("GraphQL request failed: HTTP 500");
      }
    });

    it("returns error on GraphQL errors in response", async () => {
      const service = createService();
      mockAccess.mockResolvedValue(undefined);
      mockStat.mockResolvedValue({ size: 1024 });
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ errors: [{ message: "Unauthorized" }] }),
      });

      const result = await service.uploadFile("/path/to/doc.pdf");
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toContain("Failed to request upload URL: Unauthorized");
      }
    });

    it("completes full upload flow", async () => {
      const service = createService();
      mockAccess.mockResolvedValue(undefined);
      mockStat.mockResolvedValue({ size: 1024 });
      mockReadFile.mockResolvedValue(Buffer.from("file-content"));

      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () =>
            Promise.resolve({
              data: {
                fileUpload: {
                  success: true,
                  uploadFile: {
                    uploadUrl: "https://storage.example.com/upload",
                    assetUrl: "https://uploads.linear.app/final/doc.pdf",
                    headers: [{ key: "x-amz-acl", value: "public-read" }],
                  },
                },
              },
            }),
        })
        .mockResolvedValueOnce({ ok: true });

      const result = await service.uploadFile("/path/to/doc.pdf");

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.assetUrl).toBe("https://uploads.linear.app/final/doc.pdf");
        expect(result.filename).toBe("doc.pdf");
      }

      expect(mockFetch).toHaveBeenCalledTimes(2);
      const putCall = mockFetch.mock.calls[1];
      expect(putCall[0]).toBe("https://storage.example.com/upload");
      expect(putCall[1].headers["x-amz-acl"]).toBe("public-read");
      expect(putCall[1].headers["Content-Type"]).toBe("application/pdf");
    });

    it("sends API key without Bearer prefix in GraphQL auth header", async () => {
      const service = createService();
      mockAccess.mockResolvedValue(undefined);
      mockStat.mockResolvedValue({ size: 1024 });
      mockReadFile.mockResolvedValue(Buffer.from("content"));

      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () =>
            Promise.resolve({
              data: {
                fileUpload: {
                  success: true,
                  uploadFile: {
                    uploadUrl: "https://storage.example.com/upload",
                    assetUrl: "https://uploads.linear.app/final/doc.pdf",
                    headers: [],
                  },
                },
              },
            }),
        })
        .mockResolvedValueOnce({ ok: true });

      await service.uploadFile("/path/to/doc.pdf");

      const graphqlCall = mockFetch.mock.calls[0];
      const authHeader = graphqlCall[1].headers.Authorization;
      expect(authHeader).toBe("test-api-token");
      expect(authHeader).not.toMatch(/^Bearer /);
    });

    it("returns error when PUT upload fails", async () => {
      const service = createService();
      mockAccess.mockResolvedValue(undefined);
      mockStat.mockResolvedValue({ size: 1024 });
      mockReadFile.mockResolvedValue(Buffer.from("content"));

      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () =>
            Promise.resolve({
              data: {
                fileUpload: {
                  success: true,
                  uploadFile: {
                    uploadUrl: "https://storage.example.com/upload",
                    assetUrl: "https://uploads.linear.app/final/doc.pdf",
                    headers: [],
                  },
                },
              },
            }),
        })
        .mockResolvedValueOnce({ ok: false, status: 403 });

      const result = await service.uploadFile("/path/to/doc.pdf");
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toContain("File upload failed: HTTP 403");
      }
    });
  });
});
