# PG County Community Ride-Share Platform

## Overview

The PG County Community Ride-Share Platform is a hyper-local, community-focused ride-sharing application for residents of Prince George's County, Maryland. It connects trusted neighborhood drivers with local riders, prioritizing transparency, safety, and community trust. Key features include real-time GPS tracking, transparent GPS-based dynamic pricing without surge fees, driver verification, and a unique Virtual PG Card payment system. The platform aims to foster community engagement and provide economic opportunities for local drivers through a cooperative ownership model.

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

The application adopts a mobile-first, responsive design with Progressive Web App (PWA) capabilities.

### Frontend
A React-based Single Page Application (SPA) uses TypeScript, Vite, Shadcn/ui (built on Radix UI), Tailwind CSS, React Query for state management, Wouter for routing, Leaflet for mapping, and Uppy for file uploads.

### Backend
The backend is a Node.js Express.js REST API. It uses Drizzle ORM with Neon serverless PostgreSQL for data persistence. Authentication is handled via Replit Auth (OpenID Connect) with server-side sessions. Real-time features like live ride tracking and communication use WebSockets. Google Cloud Storage is used for driver document storage with custom ACL policies.

### Data Storage
PostgreSQL stores core entities including Users, Driver Profiles, Vehicles, Rides, Disputes, Emergency Incidents, and Sessions.

### Authentication and Authorization
Email/password authentication with bcrypt password hashing and server-side sessions stored in PostgreSQL. API endpoints are protected by middleware. A custom ACL system manages access to uploaded documents.

### Role-Based Access Control (RBAC)
Three-tier role system:
- **Super Admin** (thrynovainsights@gmail.com only): Can create admin accounts, promote/demote admins, delete any user, approve users. Hardcoded email restriction ensures only one super admin exists.
- **Admin**: Can approve/revoke users, suspend users, delete non-admin users. Cannot modify other admins.
- **Regular User**: Must be approved by an admin before they can log in. Signup creates an unapproved account that requires admin approval.

User fields: `isSuperAdmin`, `isAdmin`, `isApproved`, `approvedBy`, `isSuspended`. The super admin setup endpoint requires a `SUPER_ADMIN_SETUP_TOKEN` environment variable and user-provided password (POST /api/admin/setup-super-admin).

### Geographic and Location Services
Browser-based geolocation, Leaflet maps with OpenStreetMap tiles, and real-time GPS tracking provide location functionality. Proximity search identifies nearby drivers, filtering by availability and estimated ride completion time.

### AI Assistant (Self-Learning)
An AI-powered chat assistant ("PG Ride Assistant") is accessible via the bottom navigation "Assistant" tab. It uses OpenAI (via Replit AI Integrations) with streaming responses and personalized context. The system dynamically builds prompts with user-specific data (ride history, balance, rating, driver status, recent activity) for tailored responses. Users can provide feedback (thumbs up/down) on AI responses, which feeds into satisfaction analytics. Conversations and messages are stored in PostgreSQL (`conversations` and `chat_messages` tables). API routes are under `/api/ai/conversations`.

### Analytics & Self-Learning System
The platform includes a comprehensive analytics and self-learning layer:
- **Event Tracking**: Non-blocking, fire-and-forget analytics capturing ride searches, bookings, completions, feature usage, page views, and errors via the `useAnalytics` hook (frontend) and `/api/analytics/track` (backend). Stored in `event_tracking` table.
- **AI Feedback**: Thumbs up/down on AI responses stored in `ai_feedback` table, with satisfaction rate metrics.
- **Driver Scorecards**: Automated KPI computation (completion rate, acceptance rate, avg rating, earnings, disputes) stored in `driver_scorecard` table, refreshable via admin action.
- **Demand Heatmap**: Ride data aggregated by location grid and time into `demand_heatmap` table for demand prediction.
- **Safety Pattern Detection**: Automated detection of low completion rates, high disputes, multiple SOS incidents, and low driver ratings, generating alerts in `safety_alerts` table.
- **FAQ Auto-Generation**: Uses OpenAI to summarize common AI chat topics into FAQ entries stored in `faq_entries` table.
- **Platform Insights**: Actionable insights generated and stored in `platform_insights` table with priority levels and suggested actions.
- **Driver Insights Page**: `/driver/insights` shows performance scorecards, optimal driving hours, and demand heatmap summaries.
- **Admin Analytics Panel**: Admin dashboard's "Analytics" tab shows event stats, conversion funnel, AI satisfaction rates, safety alerts, platform insights, and admin action buttons for batch operations.

### Real-time Features
WebSocket integration enables live ride updates, push notifications, and in-app messaging between drivers and riders.

### Dynamic Pricing System (Rate Card Model)
Fares use a rate card model inspired by rideshare platforms. Default (suggested) rates: Base fare $4.00 + $0.29/min + $0.90/mi, with a minimum fare of $7.65 and maximum of $100.00. Drivers can customize their rates via `/driver/rate-card` page or toggle back to suggested rates. Rate cards are stored in `driver_rate_cards` table with per-driver values for minimumFare, baseFare, perMinuteRate, perMileRate, surgeAdjustment, and useSuggested toggle. The fare calculation API (`/api/rides/calculate-fare`) accepts an optional `driverId` to compute fare using that driver's custom rate card. GPS waypoints are tracked every 5 seconds during rides, and final fares are automatically calculated upon completion using the driver's active rate card.

### Payment System: Virtual PG Card
All transactions occur via a Virtual PG Card system. New users receive $20 in welcome credit and 4 promo rides with $5 off each (promoRidesRemaining, virtualCardBalance on users table). Riders can top up their balance at any time via Stripe (debit/credit card) using the "Add Funds" button on their Profile page. Top-up flow: POST /api/virtual-card/topup/create-intent → client confirms via Stripe Elements → POST /api/virtual-card/topup/confirm → balance updated. Fare deductions happen at ride acceptance, promo discounts applied automatically. Cancellation fees deducted for rider cancellations after driver has started traveling. VITE_STRIPE_PUBLIC_KEY env var required for Stripe Elements on frontend.

### Rate Limiting
express-rate-limit applied globally: 200 req/15min general; 20 req/15min for /api/auth/login and /api/auth/signup; 10 req/min for /api/ai endpoints.

### Legal Pages
Terms of Service at /terms and Privacy Policy at /privacy — publicly accessible without login.

### Push Notifications (Web Push API)
Drivers and riders receive push notifications even when the app is closed. Uses the Web Push API with VAPID authentication. Service worker at `client/public/sw.js` handles push events, shows notifications, and opens the app when tapped. VAPID keys stored as env vars (VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_EMAIL, VITE_VAPID_PUBLIC_KEY). Push subscriptions stored in `push_subscriptions` table (userId, endpoint, p256dh, auth). Backend routes: `GET /api/push/vapid-key`, `POST /api/push/subscribe`, `POST /api/push/unsubscribe`. Push notifications are sent at: ride accepted (→ rider), ride completed (→ rider), new ride request for a specific driver (→ driver). Frontend: `usePushNotifications` hook manages permission, subscription, subscribe/unsubscribe. `PushNotificationPrompt` component appears automatically after login if permission not yet granted. Profile page has a "Ride Notifications" toggle switch with denied-state message.

### Driver Payout System
Drivers accumulate earnings in their Virtual PG Card wallet. They can request cash withdrawals via the "Withdraw" button on the Driver Dashboard. Supported payout methods: Zelle, Cash App, PayPal, or check by mail. Minimum payout $5.00. The requested amount is held (deducted from balance) immediately. If an admin rejects the request, the balance is refunded. Payouts table: `payout_requests` (driverId, amount, payoutMethod, payoutDetails, status, adminNote, processedBy, processedAt). Driver routes: `GET/POST /api/driver/payout-requests`. Admin routes: `GET /api/admin/payout-requests`, `PATCH /api/admin/payout-requests/:id` (status: processing | paid | rejected). Admin Payouts tab in the admin dashboard shows pending queue with mark-processing/mark-paid/reject actions.

### Admin Back Office System
An administrative panel at `/admin` allows users with `isAdmin: true` to manage users, drivers, rides, disputes, payouts, finances, driver ownership, and profit declarations, as well as view an activity log.

### Driver Cooperative Ownership Model
The platform implements a cooperative ownership model where 49% of the platform's ownership is distributed among qualifying drivers. Drivers can achieve "Ad-Hoc Ownership" after 12 qualifying weeks (40+ hours/week with 4.85+ rating) and "Lifetime Ownership" after accumulating 5,640 total hours. Share certificates are issued, and profit distributions are made from a 49% pool among owners. Drivers have a dashboard to track their progress and view profit history.

## External Dependencies

### Core Infrastructure
- **Replit Platform**: Development, deployment, and authentication.
- **Neon Database**: Serverless PostgreSQL hosting.
- **Google Cloud Storage**: Object storage for driver documents.

### Third-Party Services
- **OpenStreetMap**: Map tile services via Leaflet.
- **Browser APIs**: Geolocation, Notifications, WebSockets.
- **Google Fonts**: Typography (Inter).
- **Font Awesome**: UI iconography.

### UI and Component Libraries
- **Radix UI**: Unstyled, accessible component primitives.
- **Shadcn/ui**: Pre-built component library on Radix UI.
- **Leaflet**: Interactive mapping library.
- **Uppy**: File upload handling.
- **Wouter**: Client-side routing.
- **React Query**: Server state management.