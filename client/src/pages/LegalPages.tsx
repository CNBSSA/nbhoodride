import { useLocation } from "wouter";
import { ArrowLeft, Shield } from "lucide-react";
import { Button } from "@/components/ui/button";

function BackButton() {
  const [, navigate] = useLocation();
  return (
    <Button variant="ghost" size="sm" onClick={() => navigate(-1 as any)} className="mb-4 gap-2">
      <ArrowLeft className="w-4 h-4" />
      Back
    </Button>
  );
}

export function TermsOfService() {
  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-2xl mx-auto px-4 py-8">
        <BackButton />
        <div className="flex items-center gap-3 mb-6">
          <Shield className="w-7 h-7 text-primary" />
          <h1 className="text-2xl font-bold">Terms of Service</h1>
        </div>
        <p className="text-sm text-muted-foreground mb-6">Last updated: April 13, 2026</p>

        <div className="prose prose-sm dark:prose-invert space-y-6 text-sm leading-relaxed">

          <section>
            <h2 className="font-semibold text-base mb-2">1. About PG Ride</h2>
            <p>PG Ride ("PG Ride," "we," "us," or "our") is a community-owned, hyper-local rideshare platform exclusively serving Prince George's County, Maryland. By creating an account or using our services, you agree to these Terms of Service.</p>
          </section>

          <section>
            <h2 className="font-semibold text-base mb-2">2. Eligibility</h2>
            <p>You must be at least 18 years old and a resident of or have a valid reason to travel within Prince George's County. Accounts require administrator approval before becoming active. You must provide accurate information during registration.</p>
          </section>

          <section>
            <h2 className="font-semibold text-base mb-2">3. Virtual PG Card & Payments</h2>
            <p>The Virtual PG Card is a stored-value account balance used to pay for rides on the platform. Balances are non-transferable, non-refundable except at our discretion, and have no cash value outside the platform. Top-up payments are processed securely by Stripe. No surge pricing is applied on PG Ride — fares are calculated transparently using distance and time only.</p>
          </section>

          <section>
            <h2 className="font-semibold text-base mb-2">4. Welcome Promo Credit</h2>
            <p>New users receive $20 in Virtual PG Card credit and 4 promo rides with a $5 discount each upon account approval. These credits are for personal use only, are non-transferable, and expire 12 months from account creation. We reserve the right to revoke credits for abuse or fraudulent activity.</p>
          </section>

          <section>
            <h2 className="font-semibold text-base mb-2">5. Driver Requirements</h2>
            <p>Drivers must submit valid identification, a driver's license, vehicle registration, and proof of insurance for verification. Drivers must comply with all applicable Maryland traffic laws and maintain a valid license at all times while driving on the platform. Driver accounts may be suspended or permanently banned for safety violations, low ratings, or fraudulent conduct.</p>
          </section>

          <section>
            <h2 className="font-semibold text-base mb-2">6. Cancellation Policy</h2>
            <p>Riders may cancel a ride request at any time before the driver has traveled significant distance toward pickup. Cancellation fees may apply as follows: $3.50 if the driver traveled at least 1.5 miles and 3 minutes; $5.00 if the driver traveled at least 3 miles and 5 minutes. These fees compensate drivers for their time and fuel.</p>
          </section>

          <section>
            <h2 className="font-semibold text-base mb-2">7. SOS & Safety Features</h2>
            <p>PG Ride provides an SOS emergency feature for in-ride emergencies. This feature should only be used in genuine emergencies. Misuse of the SOS feature may result in account suspension. We are not a 911 service and are not responsible for emergency response times.</p>
          </section>

          <section>
            <h2 className="font-semibold text-base mb-2">8. Cooperative Ownership</h2>
            <p>PG Ride operates as a community cooperative. Qualified drivers may purchase ownership shares. Share purchases are subject to separate Share Certificate agreements and Maryland cooperative law. Dividends, if declared, are distributed proportionally to share ownership. Past distributions do not guarantee future returns.</p>
          </section>

          <section>
            <h2 className="font-semibold text-base mb-2">9. Prohibited Conduct</h2>
            <p>You may not: use the platform for illegal activity; harass or threaten other users or drivers; create fraudulent accounts; attempt to circumvent fare or payment systems; reverse-engineer the platform; or resell access to the platform.</p>
          </section>

          <section>
            <h2 className="font-semibold text-base mb-2">10. Limitation of Liability</h2>
            <p>PG Ride is a technology platform connecting riders and drivers. We are not a transportation carrier. Drivers are independent contractors. To the maximum extent permitted by law, PG Ride is not liable for personal injury, property damage, or other losses arising from rides facilitated through our platform. Our maximum liability to you for any claim is limited to the amount paid through your account in the 30 days preceding the claim.</p>
          </section>

          <section>
            <h2 className="font-semibold text-base mb-2">11. Dispute Resolution</h2>
            <p>Disputes between riders and drivers should first be reported through the in-app dispute system. We will review disputes within 5 business days. Our decision is final for amounts under $100. For larger disputes, parties may pursue mediation under Maryland law.</p>
          </section>

          <section>
            <h2 className="font-semibold text-base mb-2">12. Changes to These Terms</h2>
            <p>We may update these Terms at any time. We will notify you of material changes via email or in-app notification. Continued use of the platform after changes constitutes acceptance of the new Terms.</p>
          </section>

          <section>
            <h2 className="font-semibold text-base mb-2">13. Contact</h2>
            <p>For questions about these Terms, contact us at <a href="mailto:support@pgride.app" className="text-primary underline">support@pgride.app</a>.</p>
          </section>

        </div>
      </div>
    </div>
  );
}

export function PrivacyPolicy() {
  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-2xl mx-auto px-4 py-8">
        <BackButton />
        <div className="flex items-center gap-3 mb-6">
          <Shield className="w-7 h-7 text-primary" />
          <h1 className="text-2xl font-bold">Privacy Policy</h1>
        </div>
        <p className="text-sm text-muted-foreground mb-6">Last updated: April 13, 2026</p>

        <div className="space-y-6 text-sm leading-relaxed">

          <section>
            <h2 className="font-semibold text-base mb-2">1. Information We Collect</h2>
            <p className="text-muted-foreground">We collect the following information when you use PG Ride:</p>
            <ul className="list-disc list-inside mt-2 space-y-1 text-muted-foreground">
              <li><strong className="text-foreground">Account information:</strong> Name, email, phone number, and password (hashed)</li>
              <li><strong className="text-foreground">Location data:</strong> GPS coordinates during active rides and route tracking</li>
              <li><strong className="text-foreground">Payment information:</strong> Virtual card balance and transaction history (card details handled by Stripe)</li>
              <li><strong className="text-foreground">Driver documents:</strong> License, registration, and insurance uploads for verification</li>
              <li><strong className="text-foreground">Ride data:</strong> Origin, destination, timestamps, fare, and driver/rider feedback</li>
              <li><strong className="text-foreground">Usage data:</strong> App interactions, feature usage, and in-app AI assistant conversations</li>
            </ul>
          </section>

          <section>
            <h2 className="font-semibold text-base mb-2">2. How We Use Your Information</h2>
            <ul className="list-disc list-inside space-y-1 text-muted-foreground">
              <li>To match riders with nearby drivers</li>
              <li>To process payments and maintain your Virtual PG Card balance</li>
              <li>To verify driver identities and credentials</li>
              <li>To provide real-time GPS tracking during rides</li>
              <li>To operate the SOS emergency feature and contact emergency services if needed</li>
              <li>To improve the platform and resolve disputes</li>
              <li>To send service notifications (not marketing without consent)</li>
            </ul>
          </section>

          <section>
            <h2 className="font-semibold text-base mb-2">3. Location Data</h2>
            <p className="text-muted-foreground">We collect your precise location only during active rides. For drivers, location is shared with matched riders in real time so they can track their pickup. Location data is not collected when the app is closed. We retain ride route data for 90 days for dispute resolution, then anonymize it.</p>
          </section>

          <section>
            <h2 className="font-semibold text-base mb-2">4. Data Sharing</h2>
            <p className="text-muted-foreground">We share your information only as follows:</p>
            <ul className="list-disc list-inside mt-2 space-y-1 text-muted-foreground">
              <li><strong className="text-foreground">Drivers & Riders:</strong> First name, profile photo, and vehicle info are shared between matched parties during rides</li>
              <li><strong className="text-foreground">Stripe:</strong> Payment processing (Stripe Privacy Policy applies)</li>
              <li><strong className="text-foreground">Emergency services:</strong> Location and contact info shared if SOS is triggered</li>
              <li><strong className="text-foreground">Legal requirements:</strong> If required by law or court order</li>
            </ul>
            <p className="text-muted-foreground mt-2">We do not sell your personal information. Ever.</p>
          </section>

          <section>
            <h2 className="font-semibold text-base mb-2">5. AI Assistant</h2>
            <p className="text-muted-foreground">Conversations with our in-app AI assistant are used to provide responses and may be reviewed to improve safety and service quality. Do not share sensitive personal information (e.g., full SSN, financial account numbers) in AI conversations.</p>
          </section>

          <section>
            <h2 className="font-semibold text-base mb-2">6. Data Security</h2>
            <p className="text-muted-foreground">We use industry-standard security including encrypted connections (HTTPS/TLS), bcrypt password hashing, and secure cloud storage for driver documents. Despite these measures, no system is 100% secure. Please use a strong, unique password.</p>
          </section>

          <section>
            <h2 className="font-semibold text-base mb-2">7. Data Retention</h2>
            <p className="text-muted-foreground">We retain your account data as long as your account is active. Ride history is retained for 3 years for tax and legal purposes. You may request account deletion at any time — we will delete personal data within 30 days, except data we are legally required to retain.</p>
          </section>

          <section>
            <h2 className="font-semibold text-base mb-2">8. Your Rights</h2>
            <p className="text-muted-foreground">Under Maryland and applicable U.S. law, you have the right to: access your personal data, correct inaccurate data, request deletion of your data, opt out of non-essential communications, and receive a copy of your data in a portable format. To exercise these rights, contact us at <a href="mailto:privacy@pgride.app" className="text-primary underline">privacy@pgride.app</a>.</p>
          </section>

          <section>
            <h2 className="font-semibold text-base mb-2">9. Children's Privacy</h2>
            <p className="text-muted-foreground">PG Ride is not intended for users under 18. We do not knowingly collect personal information from minors.</p>
          </section>

          <section>
            <h2 className="font-semibold text-base mb-2">10. Contact</h2>
            <p className="text-muted-foreground">Questions about your privacy? Email us at <a href="mailto:privacy@pgride.app" className="text-primary underline">privacy@pgride.app</a>.</p>
          </section>

        </div>
      </div>
    </div>
  );
}
