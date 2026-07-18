import { CheckCircle, Circle } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";

const STEPS = [
  { key: "email", label: "Verify your email" },
  { key: "account", label: "Account approved by PG Ride" },
  { key: "profile", label: "Submit your driver application" },
  { key: "documents", label: "Upload license, insurance & vehicle photos" },
  { key: "driver", label: "Application approved — driver mode unlocked" },
] as const;

/** Driver onboarding progress (Wave B.11). */
export function DriverOnboardingChecklist() {
  const { user } = useAuth();
  const { data: profileDocs } = useQuery<{
    licenseImageUrl: string | null;
    insuranceImageUrl: string | null;
    vehiclePhotoUrls: string[];
  }>({
    queryKey: ["/api/driver/profile/me"],
    // Applicants have a driver profile but isDriver stays false until an
    // admin approves — they still need to see their document progress.
    enabled: !!user?.isDriver || !!user?.driverProfile,
    retry: false,
  });
  if (!user) return null;

  const emailDone = !!user.emailVerifiedAt;
  const accountDone = !!user.isApproved;
  const profileDone = !!user.driverProfile || !!user.isDriver;
  const docsOnFile =
    !!profileDocs?.licenseImageUrl &&
    !!profileDocs?.insuranceImageUrl &&
    (profileDocs?.vehiclePhotoUrls?.length ?? 0) > 0;
  const approval = user.driverProfile?.approvalStatus;
  const driverDone = approval === "approved";

  const done = [emailDone, accountDone, profileDone, docsOnFile, driverDone];

  return (
    <div className="rounded-lg border bg-muted/30 p-3 space-y-2" data-testid="driver-onboarding-checklist">
      <p className="text-sm font-semibold">Your driver checklist</p>
      <ul className="space-y-1.5">
        {STEPS.map((step, i) => (
          <li key={step.key} className="flex items-start gap-2 text-sm">
            {done[i] ? (
              <CheckCircle className="w-4 h-4 text-green-600 shrink-0 mt-0.5" />
            ) : (
              <Circle className="w-4 h-4 text-muted-foreground shrink-0 mt-0.5" />
            )}
            <span className={done[i] ? "text-muted-foreground line-through" : ""}>{step.label}</span>
          </li>
        ))}
      </ul>
      {approval === "background_check_pending" && (
        <p className="text-xs text-purple-700 dark:text-purple-300">Background check in progress — we will email you.</p>
      )}
    </div>
  );
}
