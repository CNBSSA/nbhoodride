import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Package } from "lucide-react";

interface LostFoundModalProps {
  isOpen: boolean;
  onClose: () => void;
  rideId: string | null;
}

const CATEGORIES = [
  { value: "phone", label: "Phone" },
  { value: "wallet", label: "Wallet / purse" },
  { value: "keys", label: "Keys" },
  { value: "bag", label: "Bag / backpack" },
  { value: "clothing", label: "Clothing" },
  { value: "other", label: "Other" },
];

export default function LostFoundModal({ isOpen, onClose, rideId }: LostFoundModalProps) {
  const [itemCategory, setItemCategory] = useState("other");
  const [itemDescription, setItemDescription] = useState("");
  const [riderNote, setRiderNote] = useState("");
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const reportMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/lost-found", {
        rideId,
        itemCategory,
        itemDescription: itemDescription.trim(),
        riderNote: riderNote.trim() || undefined,
      });
      return res.json();
    },
    onSuccess: () => {
      toast({
        title: "Lost item reported",
        description: "We notified your driver. Check Ride History for updates.",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/lost-found/mine"] });
      onClose();
      setItemCategory("other");
      setItemDescription("");
      setRiderNote("");
    },
    onError: (err: Error) => {
      toast({ title: "Could not submit", description: err.message, variant: "destructive" });
    },
  });

  if (!isOpen || !rideId) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center max-w-[430px] mx-auto">
      <div className="fixed inset-0 bg-black/50" onClick={onClose} />
      <Card className="w-full mx-4 max-h-[90vh] overflow-y-auto relative z-10" data-testid="lost-found-modal">
        <div className="flex items-center justify-between p-4 border-b">
          <div className="flex items-center gap-2">
            <Package className="w-5 h-5 text-primary" />
            <h2 className="text-lg font-semibold">Left something behind?</h2>
          </div>
          <Button variant="ghost" size="sm" onClick={onClose} data-testid="button-close-lost-found">
            ✕
          </Button>
        </div>
        <CardContent className="p-4 space-y-4">
          <p className="text-sm text-muted-foreground">
            We'll alert your driver to check the vehicle. Most items are returned within 24 hours.
          </p>
          <div>
            <label className="text-sm font-medium mb-1 block">Item type</label>
            <Select value={itemCategory} onValueChange={setItemCategory}>
              <SelectTrigger data-testid="select-lost-category">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CATEGORIES.map((c) => (
                  <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-sm font-medium mb-1 block">Describe the item</label>
            <Textarea
              value={itemDescription}
              onChange={(e) => setItemDescription(e.target.value)}
              placeholder="e.g. Black iPhone in blue case, left on back seat"
              rows={3}
              data-testid="textarea-lost-description"
            />
          </div>
          <div>
            <label className="text-sm font-medium mb-1 block">Pickup notes (optional)</label>
            <Textarea
              value={riderNote}
              onChange={(e) => setRiderNote(e.target.value)}
              placeholder="How can the driver return it to you?"
              rows={2}
              data-testid="textarea-lost-note"
            />
          </div>
          <Button
            className="w-full"
            disabled={reportMutation.isPending || itemDescription.trim().length < 3}
            onClick={() => reportMutation.mutate()}
            data-testid="button-submit-lost-found"
          >
            {reportMutation.isPending ? "Sending…" : "Notify driver"}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
