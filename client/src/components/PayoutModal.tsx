import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Separator } from "@/components/ui/separator";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { DollarSign, Clock, CheckCircle, XCircle, Loader2 } from "lucide-react";
import { format } from "date-fns";

const payoutSchema = z.object({
  amount: z.string().refine((v) => !isNaN(parseFloat(v)) && parseFloat(v) >= 5, {
    message: "Minimum payout amount is $5.00",
  }),
  payoutMethod: z.enum(["zelle", "cashapp", "paypal", "check"], {
    required_error: "Please select a payout method",
  }),
  payoutDetails: z.string().min(3, "Please enter your payout details"),
});

type PayoutFormValues = z.infer<typeof payoutSchema>;

const METHOD_LABELS: Record<string, string> = {
  zelle: "Zelle (phone or email)",
  cashapp: "Cash App ($cashtag)",
  paypal: "PayPal (email)",
  check: "Check (mailing address)",
};

const STATUS_BADGE: Record<string, { label: string; className: string }> = {
  pending:    { label: "Pending",    className: "bg-yellow-100 text-yellow-800" },
  processing: { label: "Processing", className: "bg-blue-100 text-blue-800" },
  paid:       { label: "Paid",       className: "bg-green-100 text-green-800" },
  rejected:   { label: "Rejected",   className: "bg-red-100 text-red-800" },
};

interface PayoutModalProps {
  open: boolean;
  onClose: () => void;
  availableBalance: number;
}

export default function PayoutModal({ open, onClose, availableBalance }: PayoutModalProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [view, setView] = useState<"form" | "history">("form");

  const { data: history = [], isLoading: historyLoading } = useQuery<any[]>({
    queryKey: ["/api/driver/payout-requests"],
    enabled: open,
  });

  const form = useForm<PayoutFormValues>({
    resolver: zodResolver(payoutSchema),
    defaultValues: { amount: "", payoutMethod: undefined, payoutDetails: "" },
  });

  const mutation = useMutation({
    mutationFn: async (values: PayoutFormValues) => {
      const res = await apiRequest("POST", "/api/driver/payout-requests", values);
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || "Failed to submit payout");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/driver/payout-requests"] });
      queryClient.invalidateQueries({ queryKey: ["/api/virtual-card/balance"] });
      queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
      toast({ title: "Payout Requested", description: "We'll process your payout within 1–2 business days." });
      form.reset();
      setView("history");
    },
    onError: (error: any) => {
      toast({ title: "Request Failed", description: error.message, variant: "destructive" });
    },
  });

  const PRESETS = [10, 20, 50].filter((p) => p <= availableBalance);

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-md max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <DollarSign className="w-5 h-5 text-green-600" />
            Request Payout
          </DialogTitle>
        </DialogHeader>

        {/* Balance banner */}
        <div className="rounded-xl bg-green-50 dark:bg-green-950 border border-green-200 dark:border-green-800 p-4 text-center">
          <p className="text-sm text-muted-foreground">Available to withdraw</p>
          <p className="text-3xl font-bold text-green-700 dark:text-green-300" data-testid="text-payout-balance">
            ${availableBalance.toFixed(2)}
          </p>
        </div>

        {/* Tab switcher */}
        <div className="flex rounded-lg border overflow-hidden">
          <button
            className={`flex-1 py-2 text-sm font-medium transition-colors ${view === "form" ? "bg-primary text-primary-foreground" : "bg-background hover:bg-muted"}`}
            onClick={() => setView("form")}
            data-testid="tab-request-payout"
          >
            Request Payout
          </button>
          <button
            className={`flex-1 py-2 text-sm font-medium transition-colors ${view === "history" ? "bg-primary text-primary-foreground" : "bg-background hover:bg-muted"}`}
            onClick={() => setView("history")}
            data-testid="tab-payout-history"
          >
            History {history.length > 0 && `(${history.length})`}
          </button>
        </div>

        {view === "form" ? (
          availableBalance < 5 ? (
            <div className="text-center py-6 text-muted-foreground space-y-2">
              <DollarSign className="w-10 h-10 mx-auto opacity-40" />
              <p className="font-medium">Minimum payout is $5.00</p>
              <p className="text-sm">Complete more rides to accumulate earnings.</p>
            </div>
          ) : (
            <Form {...form}>
              <form onSubmit={form.handleSubmit((v) => mutation.mutate(v))} className="space-y-4">
                {/* Quick amount presets */}
                {PRESETS.length > 0 && (
                  <div>
                    <Label className="text-xs text-muted-foreground mb-1 block">Quick amounts</Label>
                    <div className="flex gap-2">
                      {PRESETS.map((p) => (
                        <Button
                          key={p}
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => form.setValue("amount", String(p))}
                          data-testid={`button-preset-${p}`}
                        >
                          ${p}
                        </Button>
                      ))}
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => form.setValue("amount", availableBalance.toFixed(2))}
                        data-testid="button-preset-max"
                      >
                        All (${availableBalance.toFixed(2)})
                      </Button>
                    </div>
                  </div>
                )}

                <FormField
                  control={form.control}
                  name="amount"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Payout Amount ($)</FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          type="number"
                          step="0.01"
                          min="5"
                          max={availableBalance}
                          placeholder="0.00"
                          data-testid="input-payout-amount"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="payoutMethod"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Payout Method</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl>
                          <SelectTrigger data-testid="select-payout-method">
                            <SelectValue placeholder="Select method" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="zelle">Zelle</SelectItem>
                          <SelectItem value="cashapp">Cash App</SelectItem>
                          <SelectItem value="paypal">PayPal</SelectItem>
                          <SelectItem value="check">Check by mail</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="payoutDetails"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>
                        {form.watch("payoutMethod")
                          ? METHOD_LABELS[form.watch("payoutMethod")]
                          : "Your payout details"}
                      </FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          placeholder={
                            form.watch("payoutMethod") === "check"
                              ? "123 Main St, Hyattsville, MD 20781"
                              : form.watch("payoutMethod") === "cashapp"
                              ? "$cashtag"
                              : "phone or email"
                          }
                          data-testid="input-payout-details"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <p className="text-xs text-muted-foreground">
                  Payouts are processed within 1–2 business days. The requested amount will be held until processed.
                </p>

                <Button
                  type="submit"
                  className="w-full"
                  disabled={mutation.isPending}
                  data-testid="button-submit-payout"
                >
                  {mutation.isPending ? (
                    <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Submitting…</>
                  ) : "Request Payout"}
                </Button>
              </form>
            </Form>
          )
        ) : (
          <div className="space-y-3">
            {historyLoading ? (
              <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin" /></div>
            ) : history.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <Clock className="w-8 h-8 mx-auto mb-2 opacity-40" />
                <p>No payout requests yet</p>
              </div>
            ) : (
              history.map((req: any) => {
                const badge = STATUS_BADGE[req.status] || STATUS_BADGE.pending;
                return (
                  <div
                    key={req.id}
                    className="rounded-lg border p-3 space-y-1"
                    data-testid={`payout-history-${req.id}`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-green-700">${parseFloat(req.amount).toFixed(2)}</span>
                      <Badge className={badge.className}>{badge.label}</Badge>
                    </div>
                    <p className="text-sm text-muted-foreground capitalize">
                      {METHOD_LABELS[req.payoutMethod] || req.payoutMethod} — {req.payoutDetails}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {req.createdAt ? format(new Date(req.createdAt), "MMM d, yyyy 'at' h:mm a") : ""}
                    </p>
                    {req.adminNote && (
                      <p className="text-xs text-muted-foreground italic">Note: {req.adminNote}</p>
                    )}
                  </div>
                );
              })
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
