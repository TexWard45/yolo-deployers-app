"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createManualInboundMessage } from "@/actions/inbox";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface ManualIntakeFormProps {
  workspaceId: string;
}

export function ManualIntakeForm({ workspaceId }: ManualIntakeFormProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError(null);

    const form = event.currentTarget;
    const formData = new FormData(form);
    const customerName = String(formData.get("customerName") ?? "").trim();
    const customerExternalId = String(formData.get("customerExternalId") ?? "").trim();
    const messageBody = String(formData.get("messageBody") ?? "").trim();
    const threadGroupingHint = String(formData.get("threadGroupingHint") ?? "").trim();

    if (!customerName || !messageBody) {
      setError("Customer and message are required");
      setLoading(false);
      return;
    }

    const result = await createManualInboundMessage({
      workspaceId,
      customerName,
      customerExternalId: customerExternalId || undefined,
      messageBody,
      threadGroupingHint: threadGroupingHint || undefined,
    });

    if (!result.success) {
      setError(result.error);
      setLoading(false);
      return;
    }

    form.reset();
    setLoading(false);
    router.push(`/inbox/${result.threadId}`);
    router.refresh();
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Manual Intake (UI Test Mode)</CardTitle>
      </CardHeader>
      <form onSubmit={onSubmit}>
        <CardContent className="space-y-4">
          {error ? (
            <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
              {error}
            </div>
          ) : null}

          <div className="space-y-2">
            <Label htmlFor="customerName">Customer</Label>
            <Input id="customerName" name="customerName" placeholder="Acme Inc / Jane Doe" />
          </div>

          <div className="space-y-2">
            <Label htmlFor="customerExternalId">Customer External ID (optional)</Label>
            <Input
              id="customerExternalId"
              name="customerExternalId"
              placeholder="cust-123 (stable id for grouping)"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="messageBody">Incoming message</Label>
            <Textarea
              id="messageBody"
              name="messageBody"
              placeholder="Paste customer message here..."
              rows={4}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="threadGroupingHint">Thread Grouping Hint (optional)</Label>
            <Input
              id="threadGroupingHint"
              name="threadGroupingHint"
              placeholder="e.g. webhook-delivery-failure"
            />
          </div>

          <Button type="submit" disabled={loading}>
            {loading ? "Creating..." : "Create Thread"}
          </Button>
        </CardContent>
      </form>
    </Card>
  );
}
