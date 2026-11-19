"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { setCreatorPermissionAction } from "@/app/discovery-actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { PERMISSION_STATUSES, type Creator, type PermissionStatus } from "@/lib/types";

const META: Record<PermissionStatus, { label: string; variant: "success" | "warning" | "danger" | "outline" }> = {
  none: { label: "Unknown", variant: "outline" },
  requested: { label: "Requested", variant: "warning" },
  granted: { label: "Yes", variant: "success" },
  denied: { label: "No", variant: "danger" },
};

export function PermissionDialog({ creator, editable }: { creator: Creator; editable: boolean }) {
  const router = useRouter();
  const status = creator.permission_status ?? "none";
  const badge = (
    <span className="inline-flex items-center gap-1.5">
      <Badge variant={META[status].variant}>{META[status].label}</Badge>
      {creator.permission_proof_url && (
        <a
          href={creator.permission_proof_url}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="text-[11px] text-muted-foreground hover:underline"
        >
          proof ↗
        </a>
      )}
    </span>
  );
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [form, setForm] = useState({
    status,
    proofUrl: creator.permission_proof_url ?? "",
    grantedAt: creator.permission_granted_at ?? "",
    notes: creator.permission_notes ?? "",
  });
  if (!editable) return badge;

  function save() {
    start(async () => {
      const res = await setCreatorPermissionAction({
        id: creator.id,
        status: form.status,
        proofUrl: form.proofUrl.trim() || null,
        grantedAt: form.grantedAt || null,
        notes: form.notes.trim() || null,
      });
      if (!res.ok) return void toast.error(res.error);
      toast.success(
        form.status === "granted"
          ? `${creator.name}'s clips are now marked as authorized`
          : status === "granted"
            ? `${creator.name}'s clips are no longer authorized`
            : "Permission saved",
      );
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button type="button" title="Edit clipping permission">
          {badge}
        </button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Clipping permission — {creator.name}</DialogTitle>
          <DialogDescription>
            Set Yes only with something you can point to: a DM/email, or a public clipping policy or program (bio, panel, Discord,
            post). Yes marks all of this creator&apos;s clips as authorized; changing it back takes that away.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>Status</Label>
            <Select value={form.status} onChange={(e) => setForm((f) => ({ ...f, status: e.target.value as PermissionStatus }))}>
              {PERMISSION_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s === "granted" ? "Yes — allowed to clip" : s === "denied" ? "No — not allowed" : s === "requested" ? "Requested — waiting for an answer" : "Unknown"}
                </option>
              ))}
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Proof link {form.status === "granted" && <span className="text-red-300">*</span>}</Label>
            <Input
              value={form.proofUrl}
              onChange={(e) => setForm((f) => ({ ...f, proofUrl: e.target.value }))}
              placeholder="Link to screenshot, email, post or clipping-program page"
            />
          </div>
          <div className="space-y-1.5">
            <Label>Date granted</Label>
            <Input type="date" value={form.grantedAt} onChange={(e) => setForm((f) => ({ ...f, grantedAt: e.target.value }))} />
          </div>
          <div className="space-y-1.5">
            <Label>Conditions / notes</Label>
            <Textarea
              rows={3}
              value={form.notes}
              onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
              placeholder="e.g. must credit @handle in title, no music, Shorts only"
            />
          </div>
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button onClick={save} disabled={pending}>
            {pending && <Loader2 className="animate-spin" />} Save
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
