import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { saveRecurringSchedule } from "@/lib/saveRecurringSchedule";
import { Repeat } from "lucide-react";
import { describeCircuitSchedule } from "@shared/circuitSchedule";

interface TimetableRun {
  id: string;
  name: string;
  description: string | null;
  anchorName: string | null;
  pickup: { lat: number; lng: number; address: string };
  destination: { lat: number; lng: number; address: string };
  dayOfWeek: number;
  departureHour: number;
  departureMinute: number;
  farePerSeat: string;
  runAt: string;
  cutoffAt: string;
  bookingOpen: boolean;
  seatsTotal: number;
  seatsLeft: number;
  alreadyBooked: boolean;
}

interface CircuitsTimetableSheetProps {
  isOpen: boolean;
  onClose: () => void;
}

function formatRunDate(iso: string): string {
  return new Date(iso).toLocaleString([], {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/**
 * "This week's rides" — the published Circuits timetable
 * (docs/CIRCUITS_LAUNCH_PLAN.md). Riders browse the weekly runs and book a
 * guaranteed seat with one tap; no join codes needed.
 */
export default function CircuitsTimetableSheet({ isOpen, onClose }: CircuitsTimetableSheetProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery<{ runs: TimetableRun[] }>({
    queryKey: ["/api/circuits/timetable"],
    enabled: isOpen,
    refetchOnMount: "always",
  });
  const runs = data?.runs ?? [];

  const subscribe = useMutation({
    mutationFn: async (run: TimetableRun) => {
      return saveRecurringSchedule({
        label: run.name,
        rideKind: "circuit",
        departureAt: new Date(run.runAt),
        circuitId: run.id,
        destination: run.destination,
        pickup: run.pickup,
      });
    },
    onSuccess: (_data, run) => {
      toast({
        title: "Weekly shuttle saved",
        description: `We'll remind you to book ${run.name} each week.`,
      });
    },
    onError: (err: any) => {
      toast({
        title: "Couldn't save subscription",
        description: String(err?.message ?? err).replace(/^\d+:\s*/, ""),
        variant: "destructive",
      });
    },
  });

  const book = useMutation({
    mutationFn: async (run: TimetableRun) => {
      const res = await apiRequest("POST", `/api/circuits/${run.id}/book`);
      return res.json();
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["/api/circuits/timetable"] });
      queryClient.invalidateQueries({ queryKey: ["/api/rides"] });
      toast({
        title: "Seat booked!",
        description: `${result.circuitName} · ${formatRunDate(result.runAt)}. Your driver is confirmed before departure.`,
      });
    },
    onError: (err: any) => {
      toast({
        title: "Couldn't book that seat",
        description: String(err?.message ?? err).replace(/^\d+:\s*/, ""),
        variant: "destructive",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/circuits/timetable"] });
    },
  });

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center max-w-[430px] mx-auto">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <Card className="relative z-10 w-full rounded-t-2xl border-0 shadow-2xl flex flex-col max-h-[90dvh]">
        <div className="flex items-center justify-between px-4 pt-4 pb-2 flex-shrink-0">
          <div>
            <h2 className="text-lg font-bold flex items-center gap-2">
              <Bus className="w-5 h-5 text-primary" />
              This Week's Shuttles
            </h2>
            <p className="text-xs text-gray-500">Guaranteed seats · fixed fare · no surge</p>
          </div>
          <Button variant="ghost" size="sm" onClick={onClose} className="rounded-full w-8 h-8 p-0" data-testid="button-close-circuits">
            <X className="w-4 h-4 text-gray-400" />
          </Button>
        </div>

        <div className="overflow-y-auto px-4 pb-6 space-y-3">
          {isLoading ? (
            <p className="text-sm text-gray-500 py-8 text-center" data-testid="loading-circuits-timetable">
              Loading this week's runs...
            </p>
          ) : runs.length === 0 ? (
            <div className="py-10 text-center space-y-2" data-testid="empty-circuits-timetable">
              <Bus className="w-10 h-10 mx-auto text-gray-300" />
              <p className="text-sm font-medium">No circuits published yet</p>
              <p className="text-xs text-gray-500">
                Circuits are scheduled community runs — church, grocery, Metro, and work-shift
                rides at fixed times. Check back soon.
              </p>
            </div>
          ) : (
            runs.map((run) => {
              const full = run.seatsLeft <= 0;
              const closed = !run.bookingOpen;
              const disabled = run.alreadyBooked || full || closed || book.isPending;
              return (
                <div
                  key={run.id}
                  className="border rounded-xl p-3 space-y-2"
                  data-testid={`circuit-run-${run.id}`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-sm">{run.name}</span>
                        {run.anchorName && (
                          <Badge variant="outline" className="text-[10px]">{run.anchorName}</Badge>
                        )}
                      </div>
                      <p className="text-xs font-medium text-gray-700 mt-0.5">
                        {describeCircuitSchedule(run)} · next: {formatRunDate(run.runAt)}
                      </p>
                    </div>
                    <span className="text-sm font-bold text-primary shrink-0">${run.farePerSeat}</span>
                  </div>

                  <p className="text-xs text-gray-500 flex items-center gap-1 truncate">
                    <MapPin className="w-3 h-3 shrink-0" />
                    <span className="truncate">{run.pickup.address} → {run.destination.address}</span>
                  </p>
                  {run.description && (
                    <p className="text-xs text-gray-500">{run.description}</p>
                  )}

                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs text-gray-600 flex items-center gap-1">
                      <Users className="w-3 h-3" />
                      {full ? "Full" : `${run.seatsLeft} of ${run.seatsTotal} seats left`}
                    </span>
                    {run.alreadyBooked ? (
                      <span className="text-xs font-semibold text-green-600 flex items-center gap-1" data-testid={`booked-${run.id}`}>
                        <CheckCircle className="w-3.5 h-3.5" /> You're booked
                      </span>
                    ) : closed ? (
                      <span className="text-xs text-gray-400 flex items-center gap-1">
                        <Clock className="w-3.5 h-3.5" /> Booking closed
                      </span>
                    ) : (
                      <div className="flex gap-1.5 shrink-0">
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-8 text-xs px-2"
                          disabled={subscribe.isPending}
                          onClick={() => subscribe.mutate(run)}
                          data-testid={`button-subscribe-${run.id}`}
                          title="Weekly reminder"
                        >
                          <Repeat className="w-3 h-3" />
                        </Button>
                        <Button
                          size="sm"
                          className="h-8 text-xs"
                          disabled={disabled}
                          onClick={() => book.mutate(run)}
                          data-testid={`button-book-${run.id}`}
                        >
                          {book.isPending ? "Booking..." : full ? "Full" : "Book seat"}
                        </Button>
                      </div>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </Card>
    </div>
  );
}
