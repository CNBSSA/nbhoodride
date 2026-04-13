import { useState } from "react";
import { loadStripe } from "@stripe/stripe-js";
import {
  Elements,
  PaymentElement,
  useStripe,
  useElements,
} from "@stripe/react-stripe-js";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Loader2, CreditCard, CheckCircle } from "lucide-react";

const stripePromise = loadStripe(import.meta.env.VITE_STRIPE_PUBLIC_KEY);

const PRESET_AMOUNTS = [10, 20, 25, 50];

interface TopUpFormProps {
  amount: number;
  clientSecret: string;
  onSuccess: (newBalance: string) => void;
  onCancel: () => void;
}

function TopUpForm({ amount, clientSecret, onSuccess, onCancel }: TopUpFormProps) {
  const stripe = useStripe();
  const elements = useElements();
  const { toast } = useToast();
  const [processing, setProcessing] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!stripe || !elements) return;

    setProcessing(true);
    try {
      const { error, paymentIntent } = await stripe.confirmPayment({
        elements,
        redirect: "if_required",
        confirmParams: {},
      });

      if (error) {
        toast({ title: "Payment failed", description: error.message, variant: "destructive" });
        return;
      }

      if (paymentIntent?.status === "succeeded") {
        const res = await apiRequest("POST", "/api/virtual-card/topup/confirm", {
          paymentIntentId: paymentIntent.id,
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.message);
        queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
        queryClient.invalidateQueries({ queryKey: ["/api/virtual-card/balance"] });
        onSuccess(data.newBalance);
        toast({
          title: "Balance Added!",
          description: `$${amount.toFixed(2)} added to your Virtual PG Card.`,
        });
      }
    } catch (err: any) {
      toast({ title: "Error", description: err.message || "Something went wrong", variant: "destructive" });
    } finally {
      setProcessing(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="rounded-lg bg-green-50 dark:bg-green-950 border border-green-200 dark:border-green-800 p-4 text-center">
        <p className="text-sm text-green-700 dark:text-green-300 font-medium">Adding to your PG Virtual Card</p>
        <p className="text-3xl font-bold text-green-800 dark:text-green-100 mt-1">${amount.toFixed(2)}</p>
      </div>

      <PaymentElement />

      <div className="flex gap-3">
        <Button type="button" variant="outline" className="flex-1" onClick={onCancel} disabled={processing}>
          Cancel
        </Button>
        <Button type="submit" className="flex-1 bg-green-600 hover:bg-green-700" disabled={processing}>
          {processing ? (
            <><Loader2 className="w-4 h-4 animate-spin mr-2" />Processing...</>
          ) : (
            `Pay $${amount.toFixed(2)}`
          )}
        </Button>
      </div>

      <p className="text-xs text-center text-muted-foreground">
        Secured by Stripe. Your card info is never stored on our servers.
      </p>
    </form>
  );
}

interface TopUpModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentBalance: string;
}

export default function TopUpModal({ isOpen, onClose, currentBalance }: TopUpModalProps) {
  const { toast } = useToast();
  const [step, setStep] = useState<"select" | "pay" | "done">("select");
  const [selectedAmount, setSelectedAmount] = useState<number>(20);
  const [customAmount, setCustomAmount] = useState<string>("");
  const [clientSecret, setClientSecret] = useState<string>("");
  const [newBalance, setNewBalance] = useState<string>("");
  const [creating, setCreating] = useState(false);

  const finalAmount = customAmount
    ? parseFloat(customAmount)
    : selectedAmount;

  const handleProceed = async () => {
    if (!finalAmount || finalAmount < 5 || finalAmount > 500) {
      toast({ title: "Invalid amount", description: "Choose between $5 and $500.", variant: "destructive" });
      return;
    }
    setCreating(true);
    try {
      const res = await apiRequest("POST", "/api/virtual-card/topup/create-intent", { amount: finalAmount });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message);
      setClientSecret(data.clientSecret);
      setStep("pay");
    } catch (err: any) {
      toast({ title: "Error", description: err.message || "Could not start payment", variant: "destructive" });
    } finally {
      setCreating(false);
    }
  };

  const handleClose = () => {
    setStep("select");
    setClientSecret("");
    setSelectedAmount(20);
    setCustomAmount("");
    setNewBalance("");
    onClose();
  };

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="max-w-sm mx-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CreditCard className="w-5 h-5 text-green-600" />
            Add to Virtual PG Card
          </DialogTitle>
          <DialogDescription>
            Current balance: <span className="font-semibold text-foreground">${parseFloat(currentBalance || "0").toFixed(2)}</span>
          </DialogDescription>
        </DialogHeader>

        {step === "select" && (
          <div className="space-y-4">
            <div>
              <p className="text-sm font-medium mb-3">Choose an amount</p>
              <div className="grid grid-cols-4 gap-2">
                {PRESET_AMOUNTS.map((amt) => (
                  <button
                    key={amt}
                    onClick={() => { setSelectedAmount(amt); setCustomAmount(""); }}
                    className={`rounded-lg border-2 py-3 text-sm font-bold transition-all ${
                      selectedAmount === amt && !customAmount
                        ? "border-green-600 bg-green-50 dark:bg-green-950 text-green-700 dark:text-green-300"
                        : "border-gray-200 dark:border-gray-700 hover:border-green-400"
                    }`}
                    data-testid={`button-topup-${amt}`}
                  >
                    ${amt}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <p className="text-sm font-medium mb-2">Or enter a custom amount</p>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground font-medium">$</span>
                <input
                  type="number"
                  min="5"
                  max="500"
                  step="1"
                  placeholder="5 – 500"
                  value={customAmount}
                  onChange={(e) => { setCustomAmount(e.target.value); setSelectedAmount(0); }}
                  className="w-full pl-7 pr-3 py-2 border rounded-lg bg-background text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                  data-testid="input-custom-topup"
                />
              </div>
            </div>

            <Button
              onClick={handleProceed}
              disabled={creating || !finalAmount || finalAmount < 5}
              className="w-full bg-green-600 hover:bg-green-700"
              data-testid="button-topup-proceed"
            >
              {creating ? (
                <><Loader2 className="w-4 h-4 animate-spin mr-2" />Preparing...</>
              ) : (
                `Add $${finalAmount && finalAmount >= 5 ? finalAmount.toFixed(2) : "..."} to Card`
              )}
            </Button>
          </div>
        )}

        {step === "pay" && clientSecret && (
          <Elements
            stripe={stripePromise}
            options={{ clientSecret, appearance: { theme: "stripe" } }}
          >
            <TopUpForm
              amount={finalAmount}
              clientSecret={clientSecret}
              onSuccess={(bal) => { setNewBalance(bal); setStep("done"); }}
              onCancel={() => setStep("select")}
            />
          </Elements>
        )}

        {step === "done" && (
          <div className="text-center py-4 space-y-4">
            <CheckCircle className="w-16 h-16 text-green-500 mx-auto" />
            <div>
              <p className="text-lg font-bold">Balance Added!</p>
              <p className="text-muted-foreground text-sm mt-1">Your new balance is</p>
              <p className="text-3xl font-bold text-green-600 mt-2">${parseFloat(newBalance || "0").toFixed(2)}</p>
            </div>
            <Button onClick={handleClose} className="w-full" data-testid="button-topup-done">
              Done
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
