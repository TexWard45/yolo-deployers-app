"use client";

import { useState } from "react";
import { Telemetry } from "@shared/telemetry";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardHeader, CardTitle, CardContent, CardFooter } from "@/components/ui/card";
import Link from "next/link";
import { cn } from "@/lib/utils";

export default function TelemetryTestPage() {
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [counter, setCounter] = useState(0);

  const handleIdentify = () => {
    Telemetry.setUser({ email, name });
    alert(`Identified as ${name} (${email})`);
  };

  const handleStop = () => {
    Telemetry.stop();
    alert("Recording stopped and flushed.");
  };

  return (
    <div className="container mx-auto py-10 max-w-2xl">
      <Card className="shadow-lg border-2 border-primary/20">
        <CardHeader className="bg-primary/5">
          <CardTitle className="text-3xl font-bold text-primary">
            Telemetry Demo & Test
          </CardTitle>
          <p className="text-muted-foreground mt-2">
            This page is used to test the &ldquo;Event Replay&rdquo; migration. Every action you take here
            (clicks, typing, scrolling) is being recorded by the Telemetry SDK.
          </p>
        </CardHeader>
        <CardContent className="space-y-6 pt-6">
          <div className="space-y-2">
            <h3 className="text-lg font-semibold border-b pb-1">1. Interaction Test</h3>
            <p className="text-sm text-muted-foreground">Click the button multiple times to generate events.</p>
            <div className="flex items-center gap-4 py-2">
              <Button onClick={() => setCounter(c => c + 1)} size="lg">
                Clicks: {counter}
              </Button>
              <Button variant="outline" onClick={() => setCounter(0)}>
                Reset
              </Button>
            </div>
          </div>

          <div className="space-y-4">
            <h3 className="text-lg font-semibold border-b pb-1">2. Form & Privacy Test</h3>
            <p className="text-sm text-muted-foreground">
              Type your info below. The SDK is configured to mask inputs by default for privacy.
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">Name</label>
                <Input 
                  placeholder="Enter your name" 
                  value={name} 
                  onChange={(e) => setName(e.target.value)} 
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Email</label>
                <Input 
                  type="email" 
                  placeholder="user@example.com" 
                  value={email} 
                  onChange={(e) => setEmail(e.target.value)} 
                />
              </div>
            </div>
            <Button className="w-full" onClick={handleIdentify} variant="secondary">
              Identify Session (setUser)
            </Button>
          </div>

          <div className="space-y-2" data-telemetry-block>
            <h3 className="text-lg font-semibold border-b pb-1">3. Privacy Blocker Test</h3>
            <div className="bg-destructive/10 p-4 border border-destructive/20 rounded-md">
              <p className="text-destructive font-medium">This entire block is HIDDEN from replay.</p>
              <p className="text-sm">It uses `data-telemetry-block` attribute. Check the replay later to see if this is visible.</p>
            </div>
          </div>
        </CardContent>
        <CardFooter className="bg-primary/5 flex justify-between items-center py-4 px-6">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
            <span className="text-xs font-mono">REC: {Telemetry.getSessionId()?.slice(0, 8)}...</span>
          </div>
          <Button variant="ghost" onClick={handleStop} className="text-destructive hover:bg-destructive/10 hover:text-destructive">
            Force Stop & Flush
          </Button>
        </CardFooter>
      </Card>

      <div className="mt-8 text-center">
        <p className="text-muted-foreground mb-4 italic">
          After interacting, visit the admin portal to see your replay.
        </p>
        <Link 
          href="/admin/replays" 
          className={cn(buttonVariants({ variant: "link" }))}
        >
          Go to Admin Replays →
        </Link>
      </div>
    </div>
  );
}
