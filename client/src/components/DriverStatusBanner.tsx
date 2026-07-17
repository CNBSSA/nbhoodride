import { Button } from "@/components/ui/button";
import { AlertCircle } from "lucide-react";
import { useLocation } from "wouter";

type ApprovalStatus = string | undefined;

interface DriverStatusBannerProps {
  approvalStatus: ApprovalStatus;
  isVerifiedNeighbor?: boolean;
}

/** Surfaces driver approval state on the dashboard (Wave A.6). */
export function DriverStatusBanner({ approvalStatus, isVerifiedNeighbor }: DriverStatusBannerProps) {
  const [, setLocation] = useLocation();

  if (isVerifiedNeighbor || approvalStatus === "approved") return null;

  let title = "Complete driver setup";
  let body = "Upload your documents in Profile. An administrator will review them before you can go online.";
  let action = "Go to Profile";

  if (approvalStatus === "background_check_pending") {
    title = "Background check in progress";
    body = "We are reviewing your background check. You cannot go online until this finishes.";
    action = "View Profile";
  } else if (approvalStatus === "rejected") {
    title = "Driver application not cleared";
    body = "Contact support@peoplegoverned.com if you believe this is a mistake.";
    action = "Contact support";
  } else if (approvalStatus === "pending" || !approvalStatus) {
    title = "Documents under review";
    body = "We typically review within 24 hours. Going online will stay disabled until you are approved.";
  }

  return (
    <div
      className="mx-4 mt-3 mb-1 rounded-lg border border-orange-300 bg-orange-50 dark:bg-orange-950/30 p-3 flex gap-3"
      data-testid="driver-status-banner"
    >
      <AlertCircle className="w-5 h-5 text-orange-600 shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="font-semibold text-sm">{title}</p>
        <p className="text-xs text-muted-foreground mt-0.5">{body}</p>
        <Button
          size="sm"
          variant="outline"
          className="mt-2 h-8 text-xs"
          onClick={() => {
            if (approvalStatus === "rejected") {
              window.location.href = `mailto:support@peoplegoverned.com`;
            } else {
              setLocation("/");
              window.dispatchEvent(new CustomEvent("pgride:open-profile"));
            }
          }}
        >
          {action}
        </Button>
      </div>
    </div>
  );
}
