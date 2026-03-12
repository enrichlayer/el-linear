export interface Embed {
  expiresAt: string;
  label: string;
  url: string;
}

function stripCodeContexts(content: string): string {
  let cleaned = content.replace(/\\`/g, "");
  cleaned = cleaned.replace(/```[\s\S]*?```/g, "");
  cleaned = cleaned.replace(/`[^`]+`/g, "");
  return cleaned;
}

export function extractEmbeds(content: string | null | undefined): Embed[] {
  if (!content) {
    return [];
  }

  const cleanedContent = stripCodeContexts(content);
  const embeds: Embed[] = [];
  const imageRegex = /!\[([^\]]*)\]\(([^)]+)\)/g;
  const linkRegex = /(?<!!)\[([^\]]+)\]\(([^)]+)\)/g;
  const expiresAt = new Date(Date.now() + 3600 * 1000).toISOString();

  for (const match of cleanedContent.matchAll(imageRegex)) {
    const label = match[1] || "file";
    const url = match[2];
    if (isLinearUploadUrl(url)) {
      embeds.push({ label, url, expiresAt });
    }
  }

  for (const match of cleanedContent.matchAll(linkRegex)) {
    const label = match[1] || "file";
    const url = match[2];
    if (isLinearUploadUrl(url)) {
      embeds.push({ label, url, expiresAt });
    }
  }

  return embeds;
}

export function isLinearUploadUrl(url: string): boolean {
  if (!url) {
    return false;
  }
  try {
    const urlObj = new URL(url);
    return urlObj.hostname === "uploads.linear.app";
  } catch {
    return false;
  }
}

export function extractFilenameFromUrl(url: string): string {
  try {
    const urlObj = new URL(url);
    const pathname = urlObj.pathname;
    const parts = pathname.split("/");
    return parts.at(-1) || "download";
  } catch {
    return "download";
  }
}
