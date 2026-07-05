import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ObjectUploader } from "@/components/ObjectUploader";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface DocumentUploadModalProps {
  isOpen: boolean;
  onClose: () => void;
}

interface UploadedDocument {
  type: string;
  url: string;
  name: string;
}

export default function DocumentUploadModal({ isOpen, onClose }: DocumentUploadModalProps) {
  const [uploadedDocuments, setUploadedDocuments] = useState<UploadedDocument[]>([]);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // What's already on file — so drivers can see their existing submission
  // and understand that uploading again replaces it.
  const { data: profileDocs } = useQuery<{
    approvalStatus: string;
    licenseImageUrl: string | null;
    insuranceImageUrl: string | null;
    vehiclePhotoUrls: string[];
  }>({
    queryKey: ["/api/driver/profile/me"],
    enabled: isOpen,
    retry: false,
  });

  const submitDocumentsMutation = useMutation({
    mutationFn: async (documents: UploadedDocument[]) => {
      // Vehicle photos arrive as types vehicle-0..vehicle-3; collect them in
      // slot order (front/side/interior/back) and persist alongside license
      // and insurance so the admin reviewer can see the full submission.
      const vehiclePhotoUrls = ['vehicle-0', 'vehicle-1', 'vehicle-2', 'vehicle-3']
        .map((type) => documents.find((d) => d.type === type)?.url)
        .filter((url): url is string => Boolean(url));

      const response = await apiRequest('PUT', '/api/driver/profile', {
        licenseImageUrl: documents.find((d) => d.type === 'license')?.url,
        insuranceImageUrl: documents.find((d) => d.type === 'insurance')?.url,
        vehiclePhotoUrls,
      });
      return response.json();
    },
    onSuccess: () => {
      toast({
        title: "Documents Submitted",
        description: "Your documents will be reviewed within 24 hours.",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
      queryClient.invalidateQueries({ queryKey: ["/api/driver/profile/me"] });
      onClose();
    },
    onError: () => {
      toast({
        title: "Submission Failed",
        description: "Unable to submit documents. Please try again.",
        variant: "destructive",
      });
    }
  });

  const getUploadParameters = async () => {
    const response = await apiRequest('POST', '/api/objects/upload', {});
    const data = await response.json();
    return {
      method: 'PUT' as const,
      url: data.uploadURL,
    };
  };

  const handleUploadComplete = (type: string) => (result: { successful: Array<{ uploadURL: string; name: string }> }) => {
    if (result.successful && result.successful[0]) {
      const file = result.successful[0];
      const newDoc: UploadedDocument = {
        type,
        url: file.uploadURL,
        name: file.name ?? type,
      };
      
      setUploadedDocuments(prev => {
        const filtered = prev.filter(doc => doc.type !== type);
        return [...filtered, newDoc];
      });

      toast({
        title: "Upload Successful",
        description: `${type} document uploaded successfully.`,
      });
    }
  };

  const handleSubmit = () => {
    if (uploadedDocuments.length === 0) {
      toast({
        title: "No Documents",
        description: "Please upload at least one document.",
        variant: "destructive",
      });
      return;
    }

    submitDocumentsMutation.mutate(uploadedDocuments);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center max-w-[430px] mx-auto">
      <div className="fixed inset-0 bg-black/50" onClick={onClose} />
      <Card className="w-full mx-4 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-4 border-b">
          <h2 className="text-lg font-semibold">Driver Documents</h2>
          <Button
            variant="ghost"
            size="sm"
            onClick={onClose}
            data-testid="button-close-documents"
          >
            <i className="fas fa-times" />
          </Button>
        </div>
        
        <CardContent className="p-4 space-y-6">
          {/* Driver's License */}
          <div className="space-y-3">
            <h3 className="font-semibold">Driver's License</h3>
            <div className="border-2 border-dashed border-border rounded-lg p-6 text-center">
              <i className="fas fa-id-card text-3xl text-muted-foreground mb-2" />
              <p className="text-sm text-muted-foreground mb-2">
                Upload front and back of license
              </p>
              <ObjectUploader
                maxNumberOfFiles={2}
                onGetUploadParameters={getUploadParameters}
                onComplete={handleUploadComplete('license')}
                buttonClassName="bg-primary text-primary-foreground px-4 py-2 rounded text-sm"
              >
                <span data-testid="button-upload-license">Choose Files</span>
              </ObjectUploader>
              {uploadedDocuments.find(d => d.type === 'license') ? (
                <p className="text-sm text-secondary mt-2">✓ License uploaded</p>
              ) : profileDocs?.licenseImageUrl ? (
                <p className="text-sm text-green-600 mt-2" data-testid="license-on-file">✓ Already on file — uploading replaces it</p>
              ) : null}
            </div>
          </div>

          {/* Insurance */}
          <div className="space-y-3">
            <h3 className="font-semibold">Insurance Certificate</h3>
            <div className="border-2 border-dashed border-border rounded-lg p-6 text-center">
              <i className="fas fa-file-contract text-3xl text-muted-foreground mb-2" />
              <p className="text-sm text-muted-foreground mb-2">
                Current insurance documentation
              </p>
              <ObjectUploader
                maxNumberOfFiles={1}
                onGetUploadParameters={getUploadParameters}
                onComplete={handleUploadComplete('insurance')}
                buttonClassName="bg-primary text-primary-foreground px-4 py-2 rounded text-sm"
              >
                <span data-testid="button-upload-insurance">Choose File</span>
              </ObjectUploader>
              {uploadedDocuments.find(d => d.type === 'insurance') ? (
                <p className="text-sm text-secondary mt-2">✓ Insurance uploaded</p>
              ) : profileDocs?.insuranceImageUrl ? (
                <p className="text-sm text-green-600 mt-2" data-testid="insurance-on-file">✓ Already on file — uploading replaces it</p>
              ) : null}
            </div>
          </div>

          {/* Vehicle Photos */}
          <div className="space-y-3">
            <h3 className="font-semibold">Vehicle Photos</h3>
            <p className="text-sm text-muted-foreground">
              Upload up to 4 photos. One must show the license plate clearly.
            </p>
            {(profileDocs?.vehiclePhotoUrls?.length ?? 0) > 0 && uploadedDocuments.every(d => !d.type.startsWith('vehicle-')) && (
              <p className="text-sm text-green-600" data-testid="vehicle-photos-on-file">
                ✓ {profileDocs!.vehiclePhotoUrls.length} photo{profileDocs!.vehiclePhotoUrls.length === 1 ? "" : "s"} already on file — uploading replaces them
              </p>
            )}
            
            <div className="grid grid-cols-2 gap-3">
              {['Front with plate', 'Side view', 'Interior', 'Back view'].map((label, index) => (
                <div key={label} className="border-2 border-dashed border-border rounded-lg p-4 text-center aspect-square">
                  <i className="fas fa-camera text-2xl text-muted-foreground mb-2" />
                  <p className="text-xs text-muted-foreground mb-2">{label}</p>
                  <ObjectUploader
                    maxNumberOfFiles={1}
                    onGetUploadParameters={getUploadParameters}
                    onComplete={handleUploadComplete(`vehicle-${index}`)}
                    buttonClassName="bg-primary text-primary-foreground px-3 py-1 rounded text-xs"
                  >
                    <span data-testid={`button-upload-vehicle-${index}`}>Add Photo</span>
                  </ObjectUploader>
                  {uploadedDocuments.find(d => d.type === `vehicle-${index}`) && (
                    <p className="text-xs text-secondary mt-1">✓</p>
                  )}
                </div>
              ))}
            </div>
          </div>
        </CardContent>

        <div className="p-4 border-t">
          <Button
            onClick={handleSubmit}
            disabled={submitDocumentsMutation.isPending}
            className="w-full"
            data-testid="button-submit-documents"
          >
            {submitDocumentsMutation.isPending ? "Submitting..." : "Submit for Review"}
          </Button>
          <p className="text-xs text-muted-foreground text-center mt-2">
            Documents will be reviewed within 24 hours
          </p>
        </div>
      </Card>
    </div>
  );
}
