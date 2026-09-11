/**
 * Billing — how the account pays, and every week it has been charged for.
 *
 * Last week's jobs are debited on Monday morning from the bank account the
 * desk attaches here (a card works too, and costs the account more in
 * processing). Weeks that could not be collected say so plainly, with what
 * to do about it.
 */
import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Landmark, AlertTriangle } from "lucide-react";

interface Statement {
  id: string; periodKey: string; periodLabel: string; jobCount: number; total: string;
  status: string; attempts: number; lastError: string | null; statusText: string; paidAt: string | null;
}
interface Detail { billingText?: string; hasPaymentMethod?: boolean; billingMode?: string }

const money = (n: string | number) => `$${Number(n ?? 0).toFixed(2)}`;
const tone: Record<string, "default" | "secondary" | "destructive" | "outline"> = { paid: "default", charging: "secondary", failed: "destructive", void: "outline", open: "outline" };

async function json<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await apiRequest(method, url, body);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as any)?.message || `${res.status}`);
  return data as T;
}

export function BillingView({ orgId }: { orgId: string }) {
  const { toast } = useToast();
  const [starting, setStarting] = useState(false);
  const { data: detail } = useQuery<Detail>({ queryKey: ["/api/org", orgId, "detail"], queryFn: () => json("GET", `/api/org/${orgId}`) });
  const { data: statements = [], isLoading } = useQuery<Statement[]>({ queryKey: ["/api/org", orgId, "statements"], queryFn: () => json("GET", `/api/org/${orgId}/statements`) });

  const setup = useMutation({
    mutationFn: () => json<{ clientSecret: string }>("POST", `/api/org/${orgId}/billing/setup-intent`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/org", orgId, "detail"] });
      toast({ title: "Ready to add an account", description: "Finish in the window that opens. A bank account costs less to process than a card." });
    },
    onError: (e: Error) => toast({ title: "Could not start the setup", description: e.message, variant: "destructive" }),
    onSettled: () => setStarting(false),
  });

  const owed = statements.filter((s) => s.status === "failed" || s.status === "open");

  return (
    <section className="space-y-4 max-w-4xl" data-testid="portal-billing">
      <div>
        <h1 className="text-xl font-semibold">Billing</h1>
        <p className="text-sm text-muted-foreground" data-testid="text-portal-billing-how">{detail?.billingText ?? "Loading…"}</p>
      </div>

      <div className="rounded-lg border bg-card p-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Landmark className="h-5 w-5 text-muted-foreground" />
          <div>
            <p className="font-medium">{detail?.hasPaymentMethod ? "Payment method on file" : "No payment method yet"}</p>
            <p className="text-xs text-muted-foreground">A bank account is cheaper to process than a card and is what we recommend.</p>
          </div>
        </div>
        <Button
          variant={detail?.hasPaymentMethod ? "outline" : "default"}
          disabled={starting || setup.isPending}
          onClick={() => { setStarting(true); setup.mutate(); }}
          data-testid="button-portal-add-payment-method"
        >
          {detail?.hasPaymentMethod ? "Replace it" : "Add a bank account"}
        </Button>
      </div>

      {owed.length > 0 && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 dark:bg-amber-950 dark:border-amber-900 p-4 text-sm" data-testid="portal-billing-owed">
          <p className="font-medium flex items-center gap-2"><AlertTriangle className="h-4 w-4" /> {owed.length} week{owed.length === 1 ? "" : "s"} not yet collected</p>
          <p className="text-muted-foreground mt-1">
            {detail?.hasPaymentMethod
              ? "We will try again on the next run. Nothing is double-charged: each week is collected once."
              : "Add a bank account above and we will collect these on the next run."}
          </p>
        </div>
      )}

      <div className="rounded-lg border bg-card overflow-x-auto">
        {isLoading ? <p className="p-4 text-sm text-muted-foreground">Loading…</p> : statements.length === 0 ? (
          <p className="p-6 text-sm text-muted-foreground" data-testid="text-portal-no-statements">No weeks billed yet. The first statement is issued the Monday after your first jobs.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-xs uppercase text-muted-foreground bg-muted/40">
              <tr><th className="text-left px-3 py-2">Week</th><th className="text-left px-3 py-2">Jobs</th><th className="text-right px-3 py-2">Total</th><th className="text-left px-3 py-2">State</th><th className="text-left px-3 py-2">Detail</th></tr>
            </thead>
            <tbody>
              {statements.map((s) => (
                <tr key={s.id} className="border-t" data-testid={`row-portal-statement-${s.id}`}>
                  <td className="px-3 py-2 whitespace-nowrap">{s.periodLabel}</td>
                  <td className="px-3 py-2 tabular-nums">{s.jobCount}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{money(s.total)}</td>
                  <td className="px-3 py-2"><Badge variant={tone[s.status] ?? "outline"} className="whitespace-nowrap">{s.status}</Badge></td>
                  <td className="px-3 py-2 text-muted-foreground">{s.status === "failed" && s.lastError ? s.lastError : s.statusText}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
}
