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