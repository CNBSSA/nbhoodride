/**
 * Admin → Reports → Error reporting (Sentry work order, 2026-10-27): whether
 * the server is sending error reports, and a button that sends a test event so
 * the wiring can be seen working after the switch is turned on. The server
 * decides what leaves it (shared/errorScrub.ts); this card changes nothing.
 */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { apiRequest } from "@/lib/queryClient";

interface Status { enabled: boolean; droppedReports: number }
interface TestResult { enabled: boolean; sent: boolean; message: string }

export function ErrorReportingCard() {
  const status = useQuery<Status>({
    queryKey: ["/api/admin/analytics/error-reporting"],
    retry: false,
  });
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<TestResult | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  const sendTest = async () => {
    setBusy(true); setResult(null); setFailure(null);
    try {
      const res = await apiRequest("POST", "/api/admin/analytics/error-reporting/test", { note: "sent from Admin → Reports" });
      setResult(await res.json());
    } catch (err) {
      setFailure((err as Error)?.message || "The test event could not be sent.");
    } finally { setBusy(false); }
  };

  const s = status.data;
  return (
    <Card data-testid="card-error-reporting">
      <CardHeader><CardTitle>Error reporting (Sentry)</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">
          When on, the server sends a stack trace for each crash or failed background job to Sentry. It never sends names, phones, addresses,
          emails, request data or cookies. It is on only when the service has <strong>SENTRY_ENABLED=true</strong> and a key.
        </p>
        {status.isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
        {status.error && <p className="text-sm text-red-600" data-testid="text-error-reporting-error">{(status.error as Error).message}</p>}
        {s && (
          <p className="text-sm" data-testid="text-error-reporting-status">
            Error reporting is <strong>{s.enabled ? "ON" : "OFF"}</strong>.
            {s.droppedReports > 0 ? ` ${s.droppedReports} report${s.droppedReports === 1 ? " was" : "s were"} held back by the rate limit since the last restart.` : ""}
          </p>
        )}
        <Button variant="outline" size="sm" onClick={sendTest} disabled={busy} data-testid="button-report-sentry-test">
          {busy ? "Sending…" : "Send a test event"}
        </Button>
        {result && <p className="text-sm" data-testid="text-error-reporting-result">{result.message}</p>}
        {failure && <p className="text-sm text-red-600" data-testid="text-error-reporting-failure">{failure}</p>}
      </CardContent>
    </Card>
  );
}
