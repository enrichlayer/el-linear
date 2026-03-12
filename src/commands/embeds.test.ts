import type { Command } from "commander";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTestProgram, runCommand } from "./test-helpers.js";

const mockDownloadFile = vi.fn();
const mockUploadFile = vi.fn();
const mockOutputSuccess = vi.fn();
const mockGetApiToken = vi.fn().mockReturnValue("test-token");

vi.mock("../utils/file-service.js", () => ({
  FileService: vi.fn().mockImplementation(function (this: Record<string, unknown>) {
    this.downloadFile = mockDownloadFile;
    this.uploadFile = mockUploadFile;
  }),
}));

vi.mock("../utils/auth.js", () => ({
  getApiToken: mockGetApiToken,
}));

vi.mock("../utils/output.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../utils/output.js")>();
  return {
    ...actual,
    outputSuccess: mockOutputSuccess,
  };
});

let setupEmbedsCommands: (program: Command) => void;

beforeEach(async () => {
  vi.clearAllMocks();
  const mod = await import("./embeds.js");
  setupEmbedsCommands = mod.setupEmbedsCommands;
});

describe("embeds download command", () => {
  it("outputs success with filePath on success", async () => {
    const program = createTestProgram();
    setupEmbedsCommands(program);

    mockDownloadFile.mockResolvedValue({
      success: true,
      filePath: "/tmp/downloaded-file.png",
    });

    await runCommand(program, ["embeds", "download", "https://example.com/file.png"]);

    expect(mockDownloadFile).toHaveBeenCalledWith("https://example.com/file.png", {
      output: undefined,
      overwrite: false,
    });
    expect(mockOutputSuccess).toHaveBeenCalledWith({
      success: true,
      filePath: "/tmp/downloaded-file.png",
      message: "File downloaded successfully to /tmp/downloaded-file.png",
    });
  });

  it("outputs error with statusCode on failure", async () => {
    const program = createTestProgram();
    setupEmbedsCommands(program);

    mockDownloadFile.mockResolvedValue({
      success: false,
      error: "Not found",
      statusCode: 404,
    });

    await runCommand(program, ["embeds", "download", "https://example.com/missing.png"]);

    expect(mockOutputSuccess).toHaveBeenCalledWith({
      success: false,
      error: "Not found",
      statusCode: 404,
    });
  });
});

describe("embeds upload command", () => {
  it("outputs success with assetUrl on success", async () => {
    const program = createTestProgram();
    setupEmbedsCommands(program);

    mockUploadFile.mockResolvedValue({
      success: true,
      assetUrl: "https://uploads.linear.app/file.png",
      filename: "file.png",
    });

    await runCommand(program, ["embeds", "upload", "/tmp/file.png"]);

    expect(mockUploadFile).toHaveBeenCalledWith("/tmp/file.png");
    expect(mockOutputSuccess).toHaveBeenCalledWith({
      success: true,
      assetUrl: "https://uploads.linear.app/file.png",
      filename: "file.png",
      message: "File uploaded successfully: https://uploads.linear.app/file.png",
    });
  });

  it("outputs error on failure", async () => {
    const program = createTestProgram();
    setupEmbedsCommands(program);

    mockUploadFile.mockResolvedValue({
      success: false,
      error: "Upload failed",
    });

    await runCommand(program, ["embeds", "upload", "/tmp/file.png"]);

    expect(mockOutputSuccess).toHaveBeenCalledWith({
      success: false,
      error: "Upload failed",
    });
  });
});
