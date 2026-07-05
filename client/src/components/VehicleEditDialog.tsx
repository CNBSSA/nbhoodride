import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Loader2 } from "lucide-react";

interface VehicleEditDialogProps {
  isOpen: boolean;
  onClose: () => void;
  vehicle: {
    id: string;
    make?: string | null;
    model?: string | null;
    year?: number | null;
    color?: string | null;
    licensePlate?: string | null;
  } | null;
}

/** Edit the driver's vehicle details (make/model/year/color/plate). */
export default function VehicleEditDialog({ isOpen, onClose, vehicle }: VehicleEditDialogProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [make, setMake] = useState("");
  const [model, setModel] = useState("");
  const [year, setYear] = useState("");
  const [color, setColor] = useState("");
  const [licensePlate, setLicensePlate] = useState("");

  useEffect(() => {
    if (isOpen) {
      setMake(vehicle?.make ?? "");
      setModel(vehicle?.model ?? "");
      setYear(vehicle?.year ? String(vehicle.year) : "");
      setColor(vehicle?.color ?? "");
      setLicensePlate(vehicle?.licensePlate ?? "");
    }
  }, [isOpen, vehicle]);

  const save = useMutation({
    mutationFn: async () => {
      const payload = {
        make: make.trim(),
        model: model.trim(),
        year: parseInt(year, 10),
        color: color.trim(),
        licensePlate: licensePlate.trim(),
      };
      // Create when no vehicle exists yet (drivers who registered without
      // vehicle details previously had NO way to add one), edit otherwise.
      const res = vehicle
        ? await apiRequest("PUT", `/api/vehicles/${vehicle.id}`, payload)
        : await apiRequest("POST", "/api/vehicles", payload);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/vehicles"] });
      toast({ title: vehicle ? "Vehicle updated" : "Vehicle added" });
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

  const currentYear = new Date().getFullYear();
  const yearNum = parseInt(year, 10);
  const valid =
    make.trim().length > 0 &&
    model.trim().length > 0 &&
    Number.isInteger(yearNum) && yearNum >= 1990 && yearNum <= currentYear + 1 &&
    color.trim().length > 0 &&
    /^[A-Z0-9\- ]{2,10}$/i.test(licensePlate.trim());

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{vehicle ? "Edit Vehicle" : "Add Vehicle"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-sm font-medium">Make</label>
              <Input value={make} onChange={(e) => setMake(e.target.value)} placeholder="Toyota" data-testid="input-vehicle-make" />
            </div>
            <div>
              <label className="text-sm font-medium">Model</label>
              <Input value={model} onChange={(e) => setModel(e.target.value)} placeholder="Sienna" data-testid="input-vehicle-model" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-sm font-medium">Year</label>
              <Input value={year} onChange={(e) => setYear(e.target.value)} inputMode="numeric" placeholder="2021" data-testid="input-vehicle-year" />
            </div>
            <div>
              <label className="text-sm font-medium">Color</label>
              <Input value={color} onChange={(e) => setColor(e.target.value)} placeholder="Silver" data-testid="input-vehicle-color" />
            </div>
          </div>
          <div>
            <label className="text-sm font-medium">License plate</label>
            <Input value={licensePlate} onChange={(e) => setLicensePlate(e.target.value)} placeholder="ABC-1234" data-testid="input-vehicle-plate" />
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="ghost" onClick={onClose} data-testid="button-cancel-edit-vehicle">Cancel</Button>
            <Button onClick={() => save.mutate()} disabled={!valid || save.isPending} data-testid="button-save-vehicle">
              {save.isPending && <Loader2 className="w-4 h-4 animate-spin mr-2" />}
              {vehicle ? "Save" : "Add vehicle"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
