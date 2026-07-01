import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { statusLabel } from "@shared/lostFoundPolicy";
import { Package, CheckCircle, XCircle } from "lucide-react";

interface LostFoundDriverCardProps {
  reports: Array<{
    id: string;
    itemDescription: string;
    itemCategory: string;
    status: string;
    rideId: string;
    createdAt: string;
  }>;
}

export function LostFoundDriverCard({ reports }: LostFoundDriverCardProps) {
  const open = reports.filter((r) =>
    ["reported", "driver_notified", "driver_has_item"].includes(r.status),
  );
  if (open.length === 0) return null;

  return (
    <Card className="border-amber-200 bg-amber-50/50" data-testid="driver-lost-found-card">
      <CardContent className="p-4 space-y-3">
        <div className="flex items-center gap-2 font-semibold text-amber-900">
          <Package className="w-4 h-4" />
          Lost items to check ({open.length})
        </div>
        {open.map((report) => (
          <LostFoundDriverRow key={report.id} report={report} />
        ))}
      </CardContent>
    </Card>
  );
}

function LostFoundDriverRow({ report }: { report: LostFoundDriverCardProps["reports"][0] }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const updateStatus = useMutation({
    mutationFn: async (status: string) => {
      const res = await apiRequest("PATCH", `/api/lost-found/${report.id}`, { status });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/lost-found/mine"] });
      toast({ title: "Status updated" });
    },
    onError: (err: Error) => toast({ title: "Update failed", description: err.message, variant: "destructive" }),
  });

  return (
    <div className="bg-white rounded-lg p-3 border text-sm space-y-2" data-testid={`lost-found-driver-${report.id}`}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <Badge variant="outline" className="text-[10px] mb-1">{report.itemCategory}</Badge>
          <p className="font-medium">{report.itemDescription}</p>
        </div>
        <Badge>{statusLabel(report.status)}</Badge>
      </div>
      <div className="flex flex-wrap gap-2">
        {report.status !== "driver_has_item" && (
          <Button
            size="sm"
            variant="outline"
            className="h-8 text-xs"
            disabled={updateStatus.isPending}
            onClick={() => updateStatus.mutate("driver_has_item")}
            data-testid={`btn-has-item-${report.id}`}
          >
            <CheckCircle className="w-3 h-3 mr-1" /> I have it
          </Button>
        )}
        {report.status === "driver_has_item" && (
          <Button
            size="sm"
            className="h-8 text-xs"
            disabled={updateStatus.isPending}
            onClick={() => updateStatus.mutate("returned")}
            data-testid={`btn-returned-${report.id}`}
          >
            Mark returned
          </Button>
        )}
        <Button
          size="sm"
          variant="ghost"
          className="h-8 text-xs text-muted-foreground"
          disabled={updateStatus.isPending}
          onClick={() => updateStatus.mutate("closed_not_found")}
          data-testid={`btn-not-found-${report.id}`}
        >
          <XCircle className="w-3 h-3 mr-1" /> Not in car
        </Button>
      </div>
    </div>
  );
}
