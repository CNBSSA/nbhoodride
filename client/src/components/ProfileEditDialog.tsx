import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Loader2 } from "lucide-react";

interface ProfileEditDialogProps {
  isOpen: boolean;
  onClose: () => void;
  user: {
    firstName?: string | null;
    lastName?: string | null;
    phone?: string | null;
    emergencyContact?: string | null;
  } | null | undefined;
}

/** Edit basic profile fields (name, phone, emergency contact). Email is the
 *  login identity and verification-gated, so it's intentionally not editable
 *  here. */
export default function ProfileEditDialog({ isOpen, onClose, user }: ProfileEditDialogProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [phone, setPhone] = useState("");
  const [emergencyContact, setEmergencyContact] = useState("");

  useEffect(() => {
    if (isOpen) {
      setFirstName(user?.firstName ?? "");
      setLastName(user?.lastName ?? "");
      setPhone(user?.phone ?? "");
      setEmergencyContact(user?.emergencyContact ?? "");
    }
  }, [isOpen, user]);

  const save = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("PATCH", "/api/user/profile", {
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        phone: phone.trim(),
        emergencyContact: emergencyContact.trim(),
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
      toast({ title: "Profile updated" });
      onClose();
    },
    onError: (err: any) => {
      toast({
        title: "Update failed",
        description: String(err?.message ?? err).replace(/^\d+:\s*/, ""),
        variant: "destructive",
      });
    },
  });

  const valid = firstName.trim().length > 0 && lastName.trim().length > 0;

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Edit Profile</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-sm font-medium">First name</label>
              <Input value={firstName} onChange={(e) => setFirstName(e.target.value)} data-testid="input-edit-firstname" />
            </div>
            <div>
              <label className="text-sm font-medium">Last name</label>
              <Input value={lastName} onChange={(e) => setLastName(e.target.value)} data-testid="input-edit-lastname" />
            </div>
          </div>
          <div>
            <label className="text-sm font-medium">Phone</label>
            <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="301-555-1234" inputMode="tel" data-testid="input-edit-phone" />
          </div>
          <div>
            <label className="text-sm font-medium">Emergency contact</label>
            <Input value={emergencyContact} onChange={(e) => setEmergencyContact(e.target.value)} placeholder="Name · phone" data-testid="input-edit-emergency" />
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="ghost" onClick={onClose} data-testid="button-cancel-edit-profile">Cancel</Button>
            <Button onClick={() => save.mutate()} disabled={!valid || save.isPending} data-testid="button-save-profile">
              {save.isPending && <Loader2 className="w-4 h-4 animate-spin mr-2" />}
              Save
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
