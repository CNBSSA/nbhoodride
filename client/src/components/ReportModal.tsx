import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface ReportModalProps {
  isOpen: boolean;
  onClose: () => void;
  rideId: string | null;
}

export default function ReportModal({ isOpen, onClose, rideId }: ReportModalProps) {
  const [selectedIssue, setSelectedIssue] = useState<string>("");
  const [description, setDescription] = useState<string>("");
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const reportMutation = useMutation({
    mutationFn: async (reportData: any) => {
      const response = await apiRequest('POST', '/api/disputes', reportData);
      return response.json();
    },
    onSuccess: () => {
      toast({
        title: "Report Submitted",
        description: "Our support team will review your report within 24 hours.",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/rides"] });
      onClose();
      resetForm();
    },
    onError: () => {
      toast({
        title: "Report Failed",
        description: "Unable to submit your report. Please try again.",
        variant: "destructive",
      });
    }
  });

  const resetForm = () => {
    setSelectedIssue("");
    setDescription("");
  };

  const handleSubmit = () => {
    if (!selectedIssue || !description.trim()) {
      toast({
        title: "Missing Information",
        description: "Please select an issue type and provide a description.",
        variant: "destructive",
      });
      return;
    }

    if (!rideId) {
      toast({
        title: "Error",
        description: "No ride selected for reporting.",
        variant: "destructive",
      });
      return;
    }

    const reportData = {
      rideId,
      issueType: selectedIssue,
      description: description.trim()
    };

    reportMutation.mutate(reportData);
  };

  if (!isOpen) return null;

  const issueTypes = [
    {
      id: "fare-dispute",
      title: "Fare Dispute",
      description: "Driver charged incorrect amount"
    },
    {
      id: "route-issue",
      title: "Route Issue",
      description: "Driver took longer/wrong route"
    },
    {
      id: "safety-concern",
      title: "Safety Concern",
      description: "Driver behavior or vehicle condition"
    },
    {
      id: "lost-item",
      title: "Lost Item",
      description: "Left something in the vehicle"
    },
    {
      id: "other",
      title: "Other",
      description: "Something else happened"
    }
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center max-w-[430px] mx-auto">
      <div className="fixed inset-0 bg-black/50" onClick={onClose} />
      <Card className="w-full mx-4 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-4 border-b">
          <h2 className="text-lg font-semibold">Report an Issue</h2>
          <Button
            variant="ghost"
            size="sm"
            onClick={onClose}
            data-testid="button-close-report"
          >
            <i className="fas fa-times" />
          </Button>
        </div>
        
        <CardContent className="p-4 space-y-6">
          <div>
            <h3 className="font-semibold mb-3">What happened?</h3>
            <div className="space-y-2">
              {issueTypes.map((issue) => (
                <label
                  key={issue.id}
                  className="flex items-center p-3 border rounded-lg cursor-pointer hover:bg-muted"
                  data-testid={`issue-type-${issue.id}`}
                >
                  <input
                    type="radio"
                    name="issue"
                    value={issue.id}
                    checked={selectedIssue === issue.id}
                    onChange={(e) => setSelectedIssue(e.target.value)}
                    className="mr-3"
                  />
                  <div>
                    <p className="font-medium">{issue.title}</p>
                    <p className="text-sm text-muted-foreground">{issue.description}</p>
                  </div>
                </label>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium mb-2">
              Describe the issue
            </label>
            <Textarea
              placeholder="Please provide details about what happened. This helps us resolve the issue quickly."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={4}
              data-testid="textarea-description"
            />
          </div>

          <Card className="bg-muted">
            <CardContent className="p-4">
              <h4 className="font-medium mb-2">What happens next?</h4>
              <ul className="text-sm text-muted-foreground space-y-1">
                <li>• Our support team will review your report within 24 hours</li>
                <li>• We may contact you and the driver for additional details</li>
                <li>• If applicable, we'll issue refunds or take corrective action</li>
                <li>• You'll receive updates via push notification and email</li>
              </ul>
            </CardContent>
          </Card>
        </CardContent>

        <div className="p-4 border-t">
          <Button
            onClick={handleSubmit}
            disabled={reportMutation.isPending || !selectedIssue || !description.trim()}
            className="w-full"
            data-testid="button-submit-report"
          >
            {reportMutation.isPending ? "Submitting..." : "Submit Report"}
          </Button>
        </div>
      </Card>
    </div>
  );
}
