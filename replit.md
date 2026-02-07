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
Replit Auth provides OIDC-based user authentication. Server-side sessions are stored in PostgreSQL. API endpoints are protected by middleware, and a custom ACL system manages access to uploaded documents. Role-based access distinguishes between regular users and drivers.

### Geographic and Location Services
Browser-based geolocation, Leaflet maps with OpenStreetMap tiles, and real-time GPS tracking provide location functionality. Proximity search identifies nearby drivers, filtering by availability and estimated ride completion time.

### Real-time Features
WebSocket integration enables live ride updates, push notifications, and in-app messaging between drivers and riders.

### Dynamic Pricing System
Fares are calculated dynamically based on GPS-tracked distance and time using a formula: `(duration_hours × $18) + (miles × $1.50)`, with a minimum fare of $5.00 and a maximum of $100.00. GPS waypoints are tracked every 5 seconds, and real-time estimated fares are displayed. Final fares are automatically calculated upon ride completion.

### Payment System: Virtual PG Card
All transactions occur via a Virtual PG Card system, where each user has a virtual balance starting at $1000. Estimated fares are deducted upon ride acceptance, and adjustments are made upon completion. Cancellation fees are applied for rider cancellations after a driver has started traveling.

### Admin Back Office System
An administrative panel at `/admin` allows users with `isAdmin: true` to manage users, drivers, rides, disputes, finances, driver ownership, and profit declarations, as well as view an activity log.

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