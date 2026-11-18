"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { AddClipForm } from "./add-clip-form";

export function AddClipDialog() {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus /> <span className="hidden sm:inline">Add clip</span>
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Add clip by URL</DialogTitle>
          <DialogDescription>Paste a Twitch, YouTube, Kick, TikTok or Instagram link. It goes straight into the review queue.</DialogDescription>
        </DialogHeader>
        <AddClipForm onCreated={() => setOpen(false)} />
      </DialogContent>
    </Dialog>
  );
}
