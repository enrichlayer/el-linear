import type { Command, OptionValues } from "commander";
import { createGraphQLAttachmentsService } from "../utils/graphql-attachments-service.js";
import { createGraphQLDocumentsService } from "../utils/graphql-documents-service.js";
import { createLinearService } from "../utils/linear-service.js";
import { handleAsyncCommand, outputSuccess } from "../utils/output.js";

function extractDocumentIdFromUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (!parsed.hostname.includes("linear.app")) {
      return null;
    }
    const pathParts = parsed.pathname.split("/");
    const docIndex = pathParts.indexOf("document");
    if (docIndex === -1 || docIndex >= pathParts.length - 1) {
      return null;
    }
    const docSlug = pathParts[docIndex + 1];
    const lastHyphenIndex = docSlug.lastIndexOf("-");
    if (lastHyphenIndex === -1) {
      return docSlug || null;
    }
    return docSlug.substring(lastHyphenIndex + 1) || null;
  } catch {
    return null;
  }
}

async function handleCreateDocument(options: OptionValues, command: Command): Promise<void> {
  const rootOpts = command.parent!.parent!.opts();
  const documentsService = createGraphQLDocumentsService(rootOpts);
  const linearService = createLinearService(rootOpts);

  const document = await documentsService.createDocument({
    title: options.title,
    content: options.content,
    projectId: options.project ? await linearService.resolveProjectId(options.project) : undefined,
    teamId: options.team ? await linearService.resolveTeamId(options.team) : undefined,
    issueId: options.issue ? await linearService.resolveIssueId(options.issue) : undefined,
    icon: options.icon,
    color: options.color,
  });

  if (options.attachTo) {
    const attachmentsService = createGraphQLAttachmentsService(rootOpts);
    const issueId = await linearService.resolveIssueId(options.attachTo);
    try {
      await attachmentsService.createAttachment({
        issueId,
        url: document.url,
        title: document.title,
      });
    } catch (attachError) {
      const errorMessage = attachError instanceof Error ? attachError.message : String(attachError);
      throw new Error(
        `Document created (${document.id}) but failed to attach to issue "${options.attachTo}": ${errorMessage}.`,
      );
    }
  }

  outputSuccess(document);
}

async function handleListDocuments(options: OptionValues, command: Command): Promise<void> {
  if (options.project && options.issue) {
    throw new Error("Cannot use --project and --issue together. Choose one filter.");
  }

  const rootOpts = command.parent!.parent!.opts();
  const documentsService = createGraphQLDocumentsService(rootOpts);
  const linearService = createLinearService(rootOpts);
  const limit = Number.parseInt(options.limit || "50", 10);
  if (Number.isNaN(limit) || limit < 1) {
    throw new Error(`Invalid limit "${options.limit}": must be a positive number`);
  }

  if (options.issue) {
    const attachmentsService = createGraphQLAttachmentsService(rootOpts);
    const issueId = await linearService.resolveIssueId(options.issue);
    const attachments = await attachmentsService.listAttachments(issueId);
    const documentSlugIds = [
      ...new Set(
        attachments
          .map((att) => extractDocumentIdFromUrl(att.url))
          .filter((id: string | null) => id !== null),
      ),
    ];
    if (documentSlugIds.length === 0) {
      outputSuccess({ data: [], meta: { count: 0 } });
      return;
    }
    const docs = await documentsService.listDocumentsBySlugIds(documentSlugIds as string[], limit);
    outputSuccess({ data: docs, meta: { count: docs.length } });
    return;
  }

  let projectId: string | undefined;
  if (options.project) {
    projectId = await linearService.resolveProjectId(options.project);
  }
  const docs = await documentsService.listDocuments({ projectId, first: limit });
  outputSuccess({ data: docs, meta: { count: docs.length } });
}

export function setupDocumentsCommands(program: Command): void {
  const documents = program
    .command("documents")
    .alias("document")
    .alias("doc")
    .alias("docs")
    .description("Document operations (project-level documentation)");
  documents.action(() => documents.help());

  documents
    .command("create")
    .description("Create a new document")
    .requiredOption("--title <title>", "document title")
    .option("--content <content>", "document content (markdown)")
    .option("--project <project>", "project name or ID")
    .option("--team <team>", "team key or name")
    .option("--icon <icon>", "document icon")
    .option("--color <color>", "icon color")
    .option("--issue <issue>", "link document to issue (e.g., ABC-123)")
    .option("--attach-to <issue>", "also attach document to issue (e.g., ABC-123)")
    .action(handleAsyncCommand(handleCreateDocument));

  documents
    .command("update <documentId>")
    .description("Update an existing document")
    .option("--title <title>", "new document title")
    .option("--content <content>", "new document content (markdown)")
    .option("--project <project>", "move to different project")
    .option("--icon <icon>", "document icon")
    .option("--color <color>", "icon color")
    .action(
      handleAsyncCommand(async (documentId: string, options: OptionValues, command: Command) => {
        const rootOpts = command.parent!.parent!.opts();
        const documentsService = createGraphQLDocumentsService(rootOpts);
        const linearService = createLinearService(rootOpts);
        const input: Record<string, unknown> = {};
        if (options.title) {
          input.title = options.title;
        }
        if (options.content) {
          input.content = options.content;
        }
        if (options.project) {
          input.projectId = await linearService.resolveProjectId(options.project);
        }
        if (options.icon) {
          input.icon = options.icon;
        }
        if (options.color) {
          input.color = options.color;
        }
        outputSuccess(await documentsService.updateDocument(documentId, input));
      }),
    );

  documents
    .command("read <documentId>")
    .description("Read a document")
    .action(
      handleAsyncCommand(async (documentId: string, _options: OptionValues, command: Command) => {
        const rootOpts = command.parent!.parent!.opts();
        outputSuccess(await createGraphQLDocumentsService(rootOpts).getDocument(documentId));
      }),
    );

  documents
    .command("list")
    .description("List documents")
    .option("--project <project>", "filter by project name or ID")
    .option("--issue <issue>", "filter by issue (shows documents attached to the issue)")
    .option("-l, --limit <limit>", "maximum number of documents", "50")
    .action(handleAsyncCommand(handleListDocuments));

  documents
    .command("delete <documentId>")
    .description("Delete (trash) a document")
    .action(
      handleAsyncCommand(async (documentId: string, _options: OptionValues, command: Command) => {
        const rootOpts = command.parent!.parent!.opts();
        await createGraphQLDocumentsService(rootOpts).deleteDocument(documentId);
        outputSuccess({ success: true, message: "Document moved to trash" });
      }),
    );
}
