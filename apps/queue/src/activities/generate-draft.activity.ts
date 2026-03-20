import { prisma } from "@shared/database";

export interface GenerateDraftInput {
  conversationId: string;
}

export async function generateReplyDraft(input: GenerateDraftInput): Promise<{
  draftId: string;
  body: string;
}> {
  const conversation = await prisma.conversation.findUnique({
    where: { id: input.conversationId },
    include: {
      messages: { orderBy: { sentAt: "desc" }, take: 10 },
      customerProfile: true,
    },
  });

  if (!conversation) {
    throw new Error(`Conversation not found: ${input.conversationId}`);
  }

  const config = await prisma.workspaceAgentConfig.findUnique({
    where: { workspaceId: conversation.workspaceId },
  });

  const customerName = conversation.customerProfile.displayName ?? "Customer";
  const tone = config?.tone ?? "professional and friendly";

  // TODO: Replace with actual LLM API call
  // For now, generate a template-based draft
  const draftBody = [
    `Hi ${customerName},`,
    "",
    `Thank you for reaching out. I've reviewed your message and I'm happy to help.`,
    "",
    `Based on our conversation, here's what I can share:`,
    "",
    `[Agent: please review and customize this response]`,
    "",
    `Best regards`,
  ].join("\n");

  const lastMessage = conversation.messages[conversation.messages.length - 1];

  const draft = await prisma.replyDraft.create({
    data: {
      conversationId: input.conversationId,
      basedOnMessageId: lastMessage?.id,
      status: "GENERATED",
      body: draftBody,
      model: config?.model ?? "template",
      promptVersion: "v1",
      metadataJson: JSON.parse(JSON.stringify({
        tone,
        messageCount: conversation.messages.length,
        customerName,
      })),
    },
  });

  return { draftId: draft.id, body: draftBody };
}
