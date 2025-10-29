# PG County Community Ride-Share Platform

## Overview

The PG County Community Ride-Share Platform is a hyper-local, community-focused ride-sharing application designed specifically for residents of Prince George's County, Maryland. The platform connects trusted neighborhood drivers with local riders, emphasizing transparency, safety, and community trust over scale. The application features real-time GPS tracking, transparent pricing without surge fees, driver verification systems, and cash-only transactions to minimize barriers for drivers.

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend Architecture
The application uses a React-based single-page application (SPA) architecture with TypeScript:
- **Framework**: React 18 with TypeScript for type safety and component-based development
- **Build Tool**: Vite for fast development and optimized production builds
- **UI Framework**: Shadcn/ui components built on Radix UI primitives for accessible, customizable components
- **Styling**: Tailwind CSS for utility-first styling with custom CSS variables for theming
- **State Management**: React Query (TanStack Query) for server state management and caching
- **Routing**: Wouter for lightweight client-side routing
- **Maps**: Leaflet for interactive mapping and location services
- **File Uploads**: Uppy for handling driver document uploads with dashboard interface

### Backend Architecture  
The backend follows a REST API architecture using Node.js and Express:
- **Runtime**: Node.js with Express.js framework for HTTP server and API routing
- **Database ORM**: Drizzle ORM with PostgreSQL for type-safe database operations
- **Database Provider**: Neon serverless PostgreSQL for scalable cloud database hosting
- **Authentication**: Replit Auth integration with OpenID Connect (OIDC) for user authentication
- **Session Management**: Express sessions with PostgreSQL storage for persistent user sessions
- **Real-time Communication**: WebSocket server for live ride tracking and driver-rider communication
- **File Storage**: Google Cloud Storage with custom ACL (Access Control List) policies for driver documents

### Data Storage Solutions
The application uses PostgreSQL as the primary database with the following key entities:
- **Users**: Core user profiles with authentication data and basic information
- **Driver Profiles**: Extended profiles for drivers including verification status and location
- **Vehicles**: Driver vehicle information with photos and specifications
- **Rides**: Complete ride lifecycle tracking from booking to completion
- **Disputes**: Issue reporting and resolution system for ride problems
- **Emergency Incidents**: Safety incident tracking with location data
- **Sessions**: User session persistence for authentication state

### Authentication and Authorization
- **Primary Auth**: Replit Auth with OIDC for seamless user authentication
- **Session Management**: Server-side sessions stored in PostgreSQL with configurable TTL
- **API Protection**: Middleware-based authentication checks for protected endpoints  
- **Object Access Control**: Custom ACL system for controlling access to uploaded documents
- **Role-based Access**: Distinction between regular users and drivers with appropriate permissions

### Geographic and Location Services
- **Geolocation**: Browser-based geolocation API for user positioning
- **Mapping**: Leaflet maps with OpenStreetMap tiles for driver/rider visualization
- **Location Tracking**: Real-time GPS coordinate storage and updates for active rides
- **Proximity Search**: Database queries for finding nearby drivers within specified radius

### Real-time Features
- **WebSocket Integration**: Persistent connections for live ride updates and messaging
- **Live Tracking**: Real-time driver location updates during rides
- **Push Notifications**: Browser notifications for ride status changes
- **In-app Messaging**: WebSocket-based chat system between drivers and riders

### Mobile-First Design
- **Responsive Design**: Mobile-optimized UI with max-width containers for phone screens
- **PWA Capabilities**: Progressive Web App features with offline functionality
- **Touch-Friendly**: Large touch targets and mobile-appropriate navigation patterns
- **Bottom Navigation**: Mobile app-style bottom tab navigation for core features

## External Dependencies

### Core Infrastructure
- **Replit Platform**: Development environment, deployment, and authentication services
- **Neon Database**: Serverless PostgreSQL database hosting with connection pooling
- **Google Cloud Storage**: Object storage for driver verification documents and photos

### Third-Party Services
- **OpenStreetMap**: Map tile services through Leaflet for location visualization
- **Browser APIs**: Geolocation, Notifications, and WebSocket APIs for core functionality
- **Font Services**: Google Fonts (Inter) for consistent typography
- **Icon Library**: Font Awesome for UI iconography

### Development and Build Tools
- **TypeScript**: Type checking and enhanced developer experience
- **ESBuild**: Fast JavaScript bundling for production builds
- **PostCSS**: CSS processing with Tailwind CSS and Autoprefixer
- **Drizzle Kit**: Database migration and schema management tools

### UI and Component Libraries
- **Radix UI**: Unstyled, accessible component primitives
- **Shadcn/ui**: Pre-built component library built on Radix UI
- **Leaflet**: Interactive mapping library with marker and overlay support
- **Uppy**: File upload handling with progress tracking and dashboard UI
- **Wouter**: Minimalist client-side routing library
- **React Query**: Server state management, caching, and synchronization

## Dynamic Pricing System

The platform uses **GPS-based dynamic pricing** that calculates fares based on actual distance traveled and time spent, ensuring fair and transparent pricing for both drivers and riders.

### How Dynamic Pricing Works

1. **GPS Tracking During Rides**:
   - When a driver starts a ride, the system begins tracking GPS waypoints every 5 seconds
   - GPS coordinates are stored in the ride's `routePath` field with timestamps
   - System limits to 1000 waypoints per ride to prevent database bloat

2. **Distance Calculation**:
   - Uses the Haversine formula to calculate actual miles traveled
   - Sums distances between consecutive GPS waypoints
   - Provides accurate distance measurement even for complex routes

3. **Fare Calculation**:
   - **Time Rate**: $18 per hour of ride duration
   - **Distance Rate**: $1.50 per mile traveled
   - **Minimum Fare**: $5.00
   - **Maximum Fare**: $100.00
   - Formula: `(duration_hours × $18) + (miles × $1.50)` with min/max applied

4. **Real-Time Display**:
   - Drivers see live updates every 10 seconds during active rides
   - Displays current distance traveled, ride duration, and estimated fare
   - Updates automatically as the ride progresses

5. **Automatic Fare Calculation**:
   - When completing a ride, the system auto-calculates the final fare from GPS data
   - No manual fare entry required - fully automatic
   - Falls back to estimated fare if insufficient GPS data exists

### API Endpoints for Dynamic Pricing

- `POST /api/driver/rides/:rideId/track-location` - Track GPS waypoint during active ride
- `GET /api/driver/rides/:rideId/stats` - Get real-time ride statistics (distance, duration, fare)
- `POST /api/driver/rides/:rideId/complete` - Complete ride with auto-calculated fare

### Security and Authorization

- All GPS tracking endpoints verify the driver owns the ride
- Stats endpoint ensures only the assigned driver or rider can view data
- GPS tracking only works during "in_progress" rides

## Payment System: Virtual PG Card

The application uses a **Virtual PG Card** system as the primary and only payment method. Each user (rider and driver) has a virtual card balance that starts at $1000.

**Note:** Cash payment functionality has been deactivated and hidden from all users. The cash payment code remains in the backend for potential future use, but all UI references and navigation options have been removed. Virtual card is now the exclusive payment method.

### How Virtual Card Payments Work

1. **Ride Acceptance**: When a driver accepts a ride with card payment, the estimated fare is immediately deducted from the rider's virtual card balance
2. **Ride Completion**: 
   - If actual fare < estimated: The difference is refunded to the rider
   - If actual fare > estimated: The difference is deducted from the rider
   - Tips are deducted from rider and added to driver
   - The total amount (fare + tip) is added to the driver's virtual card balance
3. **Ride Cancellation**:
   - If cancelled before driver starts traveling: Full estimated fare is refunded to rider
   - If cancelled after driver starts traveling: Smart cancellation fee applies:
     - $3.50 if driver traveled ≥1.5mi AND ≥3min
     - $5.00 if driver traveled ≥3mi AND ≥5min
     - Rider gets refund of (estimated fare - cancellation fee)
     - Driver receives the cancellation fee

### Test Accounts

**Test Rider Accounts**

Three test rider accounts are pre-configured in the database for testing:

1. **Magdeline Akingba**
   - Email: magdelineakingba@gmail.com
   - Phone: (202) 381-6766
   - Virtual Card Balance: $1000.00

2. **Wunmi Akingba**
   - Email: wunmiakingba@gmail.com
   - Phone: (202) 731-1949
   - Virtual Card Balance: $1000.00

3. **Bola Akingba**
   - Email: bolaakingba@gmail.com
   - Phone: (240) 532-9500
   - Virtual Card Balance: $1000.00

**Test Driver Account**

One permanent test driver account is configured:

**Festus Akingba** (Driver)
- Email: kokobilo@gmail.com
- Phone: (202) 440-3954
- Virtual Card Balance: $1000.00
- Vehicle: 2018 Tesla Model 3 (Red)
  - License Plate: 5GRQ697 (Maryland)
  - VIN: 5YJ3E1EA3JF024429
- Status: Verified Neighbor Driver

### Enabling Test Login (Development Only)

The test login endpoint is **disabled by default** for security. To enable it for local testing:

1. Add the following environment variable in the Replit Secrets tab:
   ```
   ENABLE_TEST_LOGIN=true
   ```

2. Optionally, set a custom test password (defaults to "Fes5036tus@3"):
   ```
   TEST_PASSWORD=your_custom_password
   ```

3. Restart the application workflow

4. The test login page will be accessible at `/test-login` with a link on the landing page

**IMPORTANT**: Never enable `ENABLE_TEST_LOGIN` in production deployments as it bypasses normal authentication.