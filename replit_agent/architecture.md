# Architecture Overview

## Overview

Pipol is a full-stack web application for event discovery and coordination. The application allows users to create, find, and attend events based on location and interests. It features user authentication, interactive maps, and potentially payment processing capabilities.

## System Architecture

The application follows a client-server architecture with a clear separation between:

- **Frontend**: React-based single-page application (SPA)
- **Backend**: Express.js API server
- **Database**: PostgreSQL with Drizzle ORM
- **Services**: Map integration, authentication, and payment processing

### High-level Architecture Diagram

```
┌─────────────┐      ┌─────────────┐      ┌─────────────┐
│             │      │             │      │             │
│   Client    │<─────│   Server    │<─────│  Database   │
│   (React)   │      │  (Express)  │      │ (PostgreSQL)│
│             │─────>│             │─────>│             │
└─────────────┘      └─────────────┘      └─────────────┘
       │                    │                    │
       │                    │                    │
       ▼                    ▼                    │
┌─────────────┐      ┌─────────────┐             │
│  Map APIs   │      │   Stripe    │             │
│ (Mapbox/    │      │  Payment    │             │
│  Google)    │      │  Gateway    │             │
└─────────────┘      └─────────────┘             │
                                                 │
                                                 ▼
                                          ┌─────────────┐
                                          │ Neon.tech   │
                                          │ Serverless  │
                                          │ PostgreSQL  │
                                          └─────────────┘
```

## Key Components

### Frontend Architecture

The frontend is a React single-page application with the following features:

1. **Component Structure**:
   - Uses a UI component library based on Radix UI primitives with Tailwind CSS
   - Implements shadcn/ui components for consistent design
   - Organized with a feature-based structure (pages, components, hooks, lib)

2. **State Management**:
   - Utilizes React Query for server state management
   - Uses React Context for global state (auth, theming)
   - Local component state with React hooks

3. **Routing**:
   - Uses Wouter for lightweight client-side routing
   - Implements protected routes for authenticated sections

4. **Form Handling**:
   - Uses React Hook Form with Zod validation
   - Custom form components with error handling

5. **Map Integration**:
   - Mapbox for map rendering and geocoding
   - Alternative Google Maps integration available

### Backend Architecture

The backend is built on Express.js with:

1. **API Structure**:
   - RESTful API endpoints
   - Server-side rendering fallback for client routes
   - WebSocket support for real-time features

2. **Authentication System**:
   - Session-based authentication with Passport.js
   - Password hashing with bcryptjs
   - PostgreSQL session store

3. **Database Access Layer**:
   - Drizzle ORM for type-safe database operations
   - Centralized storage layer with reusable database functions
   - Data validation with Zod schemas

4. **External Integrations**:
   - Stripe payment processing
   - Mapbox/Google Maps APIs

### Database Schema

The database uses PostgreSQL with the following core entities:

1. **Users**:
   - Authentication credentials
   - Profile information
   - Stripe customer data

2. **Events**:
   - Event details (title, description, date, etc.)
   - Geolocation data
   - Categories and privacy settings
   - Payment information

3. **Event Attendees**:
   - User-to-event relationship
   - Attendance status

4. **User Interests**:
   - User preferences for event categories

Relations are managed through Drizzle ORM with appropriate foreign key constraints.

## Data Flow

### Authentication Flow

1. User submits credentials via login/register form
2. Server validates credentials and creates session
3. Client receives session cookie for subsequent authenticated requests
4. Protected routes check session validity before rendering

### Event Creation Flow

1. User submits event details through create-event form
2. Map component provides location data
3. Server validates and stores event data
4. Event becomes available for discovery by other users

### Event Discovery Flow

1. Map-based UI displays events in geographical area
2. Filters apply based on user preferences
3. User can view event details and opt to attend
4. For paid events, payment flow is initiated

### Payment Flow (if implemented)

1. User selects paid event to attend
2. Stripe integration handles secure payment processing
3. On successful payment, user is added to event attendees
4. Confirmation is sent to user

## External Dependencies

### Frontend Dependencies

- **React**: Core UI library
- **Tailwind CSS**: Utility-first CSS framework
- **shadcn/ui**: Component library based on Radix UI
- **TanStack Query**: Data fetching and cache management
- **Wouter**: Lightweight routing
- **React Hook Form**: Form state management 
- **Zod**: Schema validation
- **Mapbox GL**: Map visualization
- **Stripe.js**: Payment processing

### Backend Dependencies

- **Express**: Web server framework
- **Passport.js**: Authentication middleware
- **Bcrypt.js**: Password hashing
- **Drizzle ORM**: Database ORM
- **PostgreSQL**: Database
- **Neon Serverless**: PostgreSQL provider
- **connect-pg-simple**: Session store
- **ws**: WebSocket implementation

## Deployment Strategy

The application is configured for deployment on Replit with:

1. **Build Process**:
   - Vite for frontend build
   - esbuild for server bundling

2. **Environment Configuration**:
   - Environment variables for API keys and connections
   - Development vs production settings

3. **Database Strategy**:
   - Uses Neon.tech serverless PostgreSQL
   - Database migrations with Drizzle Kit

4. **Scaling Considerations**:
   - Autoscaling configuration in Replit
   - Serverless database for elastic scaling

5. **Performance Optimization**:
   - Static asset serving
   - Client-side caching strategies
   - Optimized build output

The deployment is configured to work seamlessly with Replit's ecosystem, leveraging its CI/CD capabilities and scaling features.