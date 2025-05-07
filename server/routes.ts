import express, { Express, Request, Response } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { supabaseStorage } from "./supabase-adapter";
import bcrypt from "bcryptjs";
import passport from "passport";
import { loginUserSchema, insertUserSchema, insertEventSchema, insertEventAttendeeSchema } from "@shared/schema";
import { z } from "zod";
import Stripe from "stripe";
import { WebSocketServer } from 'ws';
import { WebSocket } from 'ws';

if (!process.env.SESSION_SECRET) {
  console.warn("No SESSION_SECRET provided, using default secret. This is insecure!");
}

if (!process.env.STRIPE_SECRET_KEY) {
  console.warn("Missing STRIPE_SECRET_KEY. Payment functionality will not work!");
}

// Initialize Stripe if available
const stripe = process.env.STRIPE_SECRET_KEY ? new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: "2025-04-30.basil",
}) : null;

export async function registerRoutes(app: Express): Promise<Server> {
  // Serve static files from public directory
  app.use(express.static('public'));

  // Auth route middleware
  const isAuthenticated = (req: Request, res: Response, next: Function) => {
    if (!req.isAuthenticated()) {
      return res.status(401).json({ message: "Not authenticated" });
    }
    return next();
  };

  // Auth routes
  // Register a new user
  app.post("/api/auth/register", async (req, res) => {
    try {
      console.log("Registration attempt with data:", { 
        email: req.body.email,
        username: req.body.username,
        name: req.body.name
      });
      
      // Validate all input data
      const validatedData = insertUserSchema.parse(req.body);
      
      // Check if email already exists
      const existingEmail = await storage.getUserByEmail(validatedData.email);
      if (existingEmail) {
        console.log(`Registration rejected: Email ${validatedData.email} already exists`);
        return res.status(400).json({ message: "Email already in use" });
      }

      // Check if username already exists
      const existingUsername = await storage.getUserByUsername(validatedData.username);
      if (existingUsername) {
        console.log(`Registration rejected: Username ${validatedData.username} already exists`);
        return res.status(400).json({ message: "Username already taken" });
      }

      // Hash password with bcrypt
      const salt = await bcrypt.genSalt(10);
      const hashedPassword = await bcrypt.hash(validatedData.password, salt);

      // Create user with the hashed password
      const user = await storage.insertUser({
        ...validatedData,
        password: hashedPassword,
      });

      console.log(`User registered successfully: ID=${user.id}, Username=${user.username}`);

      // Remove password from the response data
      const { password: _, ...userWithoutPassword } = user;

      // Automatically log the user in after registration
      req.login(userWithoutPassword, (err) => {
        if (err) {
          console.error("Error during auto-login after registration:", err);
          return res.status(500).json({ message: "Registration successful, but automatic login failed" });
        }
        
        console.log(`User ${user.id} automatically logged in after registration`);
        return res.status(201).json(userWithoutPassword);
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        console.log("Registration validation errors:", error.errors);
        return res.status(400).json({ 
          message: "Validation error",
          errors: error.errors.map(e => ({
            field: e.path.join('.'),
            message: e.message
          }))
        });
      }
      console.error("Error registering user:", error);
      return res.status(500).json({ message: "Internal server error during registration" });
    }
  });

  // User login
  app.post("/api/auth/login", (req, res, next) => {
    try {
      console.log("Login attempt for:", req.body.email);
      
      // Validate login data
      loginUserSchema.parse(req.body);
      
      // Use passport for authentication
      passport.authenticate("local", (err: any, user: any, info: any) => {
        if (err) {
          console.error("Authentication error:", err);
          return next(err);
        }
        
        // Authentication failed
        if (!user) {
          console.log(`Login failed for ${req.body.email}: ${info?.message || "Unknown reason"}`);
          return res.status(401).json({ message: info?.message || "Invalid email or password" });
        }
        
        // User authenticated, establish session
        req.login(user, (err) => {
          if (err) {
            console.error("Session error during login:", err);
            return next(err);
          }
          
          console.log(`User ${user.id} (${user.email}) logged in successfully`);
          
          // Debug session info
          if (req.session) {
            console.log(`Session created: id=${req.session.id}, expires=${req.session.cookie.expires}`);
          }
          
          return res.json(user);
        });
      })(req, res, next);
    } catch (error) {
      if (error instanceof z.ZodError) {
        console.log("Login validation errors:", error.errors);
        return res.status(400).json({ 
          message: "Invalid login data", 
          errors: error.errors
        });
      }
      console.error("Unexpected login error:", error);
      return res.status(500).json({ message: "Internal server error during login" });
    }
  });

  // Get current user data
  app.get("/api/auth/me", (req, res) => {
    if (!req.isAuthenticated()) {
      return res.status(401).json({ message: "Not authenticated" });
    }
    
    console.log(`User data requested for user ${req.user.id}`);
    res.json(req.user);
  });

  // User logout
  app.post("/api/auth/logout", (req, res) => {
    if (!req.isAuthenticated()) {
      return res.status(200).json({ message: "Already logged out" });
    }
    
    // Store user ID for logging
    const userId = req.user.id;
    console.log(`Logout requested for user ${userId}`);
    
    req.logout((err) => {
      if (err) {
        console.error("Error during logout:", err);
        return res.status(500).json({ message: "Error during logout" });
      }
      
      // Destroy the session completely
      req.session.destroy((err) => {
        if (err) {
          console.error("Error destroying session:", err);
        }
        
        console.log(`User ${userId} logged out successfully`);
        res.clearCookie('connect.sid');
        res.json({ message: "Logged out successfully" });
      });
    });
  });
  
  // Proxy para solicitudes a la API de Google Places (para evitar problemas CORS)
  app.get('/api/google-proxy/:service/:endpoint', async (req, res) => {
    try {
      const { service, endpoint } = req.params;
      // Copiar los query params para no modificar el objeto original
      const queryParams = { ...req.query };
      
      // Eliminar clave 'key' del query string
      if (queryParams.key) {
        delete queryParams.key;
      }
      
      // Si es una solicitud de búsqueda, agregamos parámetros para mejorar los resultados
      if (endpoint === 'textsearch' || endpoint === 'findplacefromtext') {
        // Priorizar la región del usuario (Argentina) para mostrar resultados más relevantes
        if (!queryParams.region && !queryParams.location) {
          queryParams.region = 'ar'; // Argentina
        }
        
        // Si la consulta es muy genérica (como 'parque'), agregar más contexto
        if (queryParams.query && typeof queryParams.query === 'string' && queryParams.query.length < 10) {
          // Agregar "en Argentina" o "en Mexico" según la región especificada
          const region = queryParams.region || 'ar';
          const countryName = region === 'ar' ? 'Argentina' : (region === 'mx' ? 'México' : '');
          
          if (countryName && !queryParams.query.includes(countryName)) {
            queryParams.query = `${queryParams.query} en ${countryName}`;
            console.log('Query modificada para mejorar resultados:', queryParams.query);
          }
        }
        
        // Parámetros para mejorar resultados
        queryParams.language = 'es'; // Resultados en español
        queryParams.inputtype = 'textquery';
        
        // Aumentar el número de resultados
        if (!queryParams.maxResults) {
          queryParams.maxResults = '10';
        }
      }
      
      // Usar la API key del servidor para mayor seguridad
      const API_KEY = 'AIzaSyCy5iYWFh36MvrxPKr58A7TPd-f6YHtT1I';
      
      const urlParams = new URLSearchParams(queryParams as Record<string, string>).toString();
      const url = `https://maps.googleapis.com/maps/api/${service}/${endpoint}?${urlParams}&key=${API_KEY}`;
      console.log(`Proxying Google API request to: ${url}`);
      
      const response = await fetch(url);
      
      if (!response.ok) {
        console.error('Error en respuesta HTTP de Google API:', response.status, response.statusText);
        return res.status(response.status).json({ 
          status: 'ERROR',
          error_message: `Error HTTP ${response.status}: ${response.statusText}` 
        });
      }
      
      // Parsear la respuesta como texto primero para depurar cualquier problema
      const responseText = await response.text();
      
      try {
        // Intentar parsear JSON
        const data = JSON.parse(responseText);
        console.log('Google API response status:', data.status);
        
        if (data.status !== 'OK') {
          console.log('Google API error details:', data.error_message || 'No error message provided');
        } else {
          console.log('Google API returned', data.results?.length || 0, 'results');
        }
        
        return res.json(data);
      } catch (jsonError) {
        console.error('Error parsing Google API response as JSON:', jsonError);
        console.error('Response text (first 200 chars):', responseText.substring(0, 200));
        
        return res.status(500).json({ 
          status: 'ERROR',
          error_message: 'Error parsing Google API response',
          response_preview: responseText.substring(0, 100) + '...' 
        });
      }
    } catch (error) {
      console.error('Error proxy Google API:', error);
      res.status(500).json({ 
        status: 'ERROR',
        error_message: error instanceof Error ? error.message : 'Unknown error in Google API proxy'
      });
    }
  });

  // Event routes
  app.get("/api/events", async (req, res) => {
    try {
      const { lat, lng, radius, category, paymentType } = req.query;
      
      let events;
      
      // If lat and lng are provided, get nearby events
      if (lat && lng) {
        events = await supabaseStorage.getNearbyEvents(
          parseFloat(lat as string),
          parseFloat(lng as string),
          radius ? parseFloat(radius as string) : 10
        );
      } else {
        // Otherwise get all events with filters
        const filters: any = {};
        
        if (category) {
          filters.category = Array.isArray(category) ? category : [category as string];
        }
        
        if (paymentType) {
          filters.paymentType = Array.isArray(paymentType) ? paymentType : [paymentType as string];
        }
        
        events = await supabaseStorage.getEvents(filters);
      }
      
      res.json(events);
    } catch (error) {
      console.error("Error fetching events:", error);
      res.status(500).json({ message: "Error fetching events" });
    }
  });

  app.get("/api/events/:id", async (req, res) => {
    try {
      const eventId = parseInt(req.params.id);
      const event = await storage.getEventById(eventId);
      
      if (!event) {
        return res.status(404).json({ message: "Event not found" });
      }
      
      res.json(event);
    } catch (error) {
      console.error("Error fetching event:", error);
      res.status(500).json({ message: "Error fetching event" });
    }
  });

  app.post("/api/events", isAuthenticated, async (req, res) => {
    try {
      console.log("Creando evento. Datos recibidos:", JSON.stringify(req.body));
      const userId = (req.user as any).id;
      console.log("Usando organizerId:", userId);
      
      try {
        const validatedData = insertEventSchema.parse({
          ...req.body,
          organizerId: userId
        });
        console.log("Datos validados:", JSON.stringify(validatedData));
        
        const event = await storage.insertEvent(validatedData);
        console.log("Evento creado con éxito:", JSON.stringify(event));
        res.status(201).json(event);
      } catch (validationError) {
        console.error("Error de validación:", validationError);
        if (validationError instanceof z.ZodError) {
          return res.status(400).json({ errors: validationError.errors });
        }
        throw validationError;
      }
    } catch (error) {
      console.error("Error completo al crear evento:", error);
      
      // Check if this is a foreign key constraint error
      if (error instanceof Error && 
          error.toString().includes("violates foreign key constraint") &&
          error.toString().includes("events_organizer_id_users_id_fk")) {
        return res.status(401).json({ 
          message: "You need to sign up and log in before creating an event",
          code: "USER_NOT_FOUND"
        });
      }
      
      res.status(500).json({ message: "Error creating event", error: String(error) });
    }
  });

  app.put("/api/events/:id", isAuthenticated, async (req, res) => {
    try {
      const user = req.user as any;
      const eventId = parseInt(req.params.id);
      
      // Check if event exists
      const event = await storage.getEventById(eventId);
      if (!event) {
        return res.status(404).json({ message: "Event not found" });
      }
      
      // Check if user is the organizer
      if (event.organizerId !== user.id) {
        return res.status(403).json({ message: "Not authorized to update this event" });
      }
      
      // Update event
      const updatedEvent = await storage.updateEvent(eventId, req.body);
      res.json(updatedEvent);
    } catch (error) {
      console.error("Error updating event:", error);
      res.status(500).json({ message: "Error updating event" });
    }
  });

  app.delete("/api/events/:id", isAuthenticated, async (req, res) => {
    try {
      const user = req.user as any;
      const eventId = parseInt(req.params.id);
      
      // Check if event exists
      const event = await storage.getEventById(eventId);
      if (!event) {
        return res.status(404).json({ message: "Event not found" });
      }
      
      // Check if user is the organizer
      if (event.organizerId !== user.id) {
        return res.status(403).json({ message: "Not authorized to delete this event" });
      }
      
      // Delete event
      await storage.deleteEvent(eventId);
      res.json({ message: "Event deleted successfully" });
    } catch (error) {
      console.error("Error deleting event:", error);
      res.status(500).json({ message: "Error deleting event" });
    }
  });

  // Event attendance routes
  app.post("/api/events/:id/join", isAuthenticated, async (req, res) => {
    try {
      const user = req.user as any;
      const eventId = parseInt(req.params.id);
      
      // Check if event exists
      const event = await storage.getEventById(eventId);
      if (!event) {
        return res.status(404).json({ message: "Event not found" });
      }
      
      // Check if user is already attending
      const existingAttendee = await storage.getEventAttendee(eventId, user.id);
      if (existingAttendee) {
        return res.status(400).json({ 
          message: "Already joined this event",
          status: existingAttendee.status
        });
      }
      
      // Check if event is at capacity
      if (event.maxCapacity) {
        const attendees = await storage.getEventAttendees(eventId);
        if (attendees.length >= event.maxCapacity) {
          return res.status(400).json({ message: "Event is at maximum capacity" });
        }
      }
      
      // For private events, create a pending request
      if (event.privacyType === 'private') {
        const attendee = await storage.joinEvent({
          eventId,
          userId: user.id,
          status: 'pending',
          paymentStatus: event.paymentType === 'free' ? 'completed' : 'pending'
        });
        
        return res.status(201).json({ 
          attendee, 
          requiresPayment: false,
          isPendingApproval: true
        });
      }
      
      // For paid events, process through Stripe
      if (event.paymentType === 'paid' && event.price) {
        if (!stripe) {
          return res.status(500).json({ message: "Payment processing is not available" });
        }
        
        // Create a payment intent
        const paymentIntent = await stripe.paymentIntents.create({
          amount: Math.round(parseFloat(event.price.toString()) * 100), // Convert to cents
          currency: "usd",
          metadata: {
            eventId: event.id.toString(),
            userId: user.id.toString()
          }
        });
        
        // Create attendance record with pending payment
        const attendee = await storage.joinEvent({
          eventId,
          userId: user.id,
          status: 'approved',
          paymentStatus: 'pending',
          paymentIntentId: paymentIntent.id
        });
        
        return res.status(201).json({ 
          attendee,
          clientSecret: paymentIntent.client_secret,
          requiresPayment: true,
          isPendingApproval: false
        });
      }
      
      // For free events, just add them
      const attendee = await storage.joinEvent({
        eventId,
        userId: user.id,
        status: 'approved',
        paymentStatus: 'completed'
      });
      
      res.status(201).json({ 
        attendee, 
        requiresPayment: false,
        isPendingApproval: false
      });
    } catch (error) {
      console.error("Error joining event:", error);
      res.status(500).json({ message: "Error joining event" });
    }
  });

  app.delete("/api/events/:id/leave", isAuthenticated, async (req, res) => {
    try {
      const user = req.user as any;
      const eventId = parseInt(req.params.id);
      
      // Check if user is attending
      const attendee = await storage.getEventAttendee(eventId, user.id);
      if (!attendee) {
        return res.status(404).json({ message: "Not attending this event" });
      }
      
      // Cannot leave a paid event if payment is completed
      if (attendee.paymentStatus === 'completed' && attendee.paymentIntentId) {
        return res.status(400).json({ message: "Cannot leave a paid event after payment is completed" });
      }
      
      // If there's a pending payment, cancel it
      if (attendee.paymentStatus === 'pending' && attendee.paymentIntentId && stripe) {
        await stripe.paymentIntents.cancel(attendee.paymentIntentId);
      }
      
      // Remove attendee record
      await storage.leaveEvent(eventId, user.id);
      res.json({ message: "Left event successfully" });
    } catch (error) {
      console.error("Error leaving event:", error);
      res.status(500).json({ message: "Error leaving event" });
    }
  });
  
  // Approve/reject join requests for private events
  app.post("/api/events/:id/requests/:attendeeId/approve", isAuthenticated, async (req, res) => {
    try {
      const user = req.user as any;
      const eventId = parseInt(req.params.id);
      const attendeeId = parseInt(req.params.attendeeId);
      
      // Verify the event exists and user is the organizer
      const event = await storage.getEventById(eventId);
      if (!event) {
        return res.status(404).json({ message: "Event not found" });
      }
      
      if (event.organizerId !== user.id) {
        return res.status(403).json({ message: "Only the event organizer can approve requests" });
      }
      
      // Get the attendee record
      const attendee = await storage.getEventAttendee(eventId, attendeeId);
      if (!attendee) {
        return res.status(404).json({ message: "Join request not found" });
      }
      
      if (attendee.status !== 'pending') {
        return res.status(400).json({ message: "This request has already been processed" });
      }
      
      // Update attendee status
      const updatedAttendee = await storage.updateEventAttendee(attendee.id, {
        status: 'approved'
      });
      
      res.json({ 
        attendee: updatedAttendee,
        message: "Join request approved" 
      });
    } catch (error) {
      console.error("Error approving join request:", error);
      res.status(500).json({ message: "Server error" });
    }
  });
  
  app.post("/api/events/:id/requests/:attendeeId/reject", isAuthenticated, async (req, res) => {
    try {
      const user = req.user as any;
      const eventId = parseInt(req.params.id);
      const attendeeId = parseInt(req.params.attendeeId);
      
      // Verify the event exists and user is the organizer
      const event = await storage.getEventById(eventId);
      if (!event) {
        return res.status(404).json({ message: "Event not found" });
      }
      
      if (event.organizerId !== user.id) {
        return res.status(403).json({ message: "Only the event organizer can reject requests" });
      }
      
      // Get the attendee record
      const attendee = await storage.getEventAttendee(eventId, attendeeId);
      if (!attendee) {
        return res.status(404).json({ message: "Join request not found" });
      }
      
      if (attendee.status !== 'pending') {
        return res.status(400).json({ message: "This request has already been processed" });
      }
      
      // Delete the attendee record
      await storage.leaveEvent(eventId, attendeeId);
      
      res.json({ message: "Join request rejected" });
    } catch (error) {
      console.error("Error rejecting join request:", error);
      res.status(500).json({ message: "Server error" });
    }
  });
  
  // Get pending join requests for an event
  app.get("/api/events/:id/requests", isAuthenticated, async (req, res) => {
    try {
      const user = req.user as any;
      const eventId = parseInt(req.params.id);
      
      // Verify the event exists and user is the organizer
      const event = await storage.getEventById(eventId);
      if (!event) {
        return res.status(404).json({ message: "Event not found" });
      }
      
      if (event.organizerId !== user.id) {
        return res.status(403).json({ message: "Only the event organizer can view join requests" });
      }
      
      // Get all attendees for the event
      const attendees = await storage.getEventAttendees(eventId);
      
      // Filter to only pending requests
      const pendingRequests = attendees.filter(attendee => attendee.status === 'pending');
      
      res.json(pendingRequests);
    } catch (error) {
      console.error("Error fetching join requests:", error);
      res.status(500).json({ message: "Server error" });
    }
  });
  
  // Check user's status for an event (for pending requests)
  app.get("/api/events/:id/status", isAuthenticated, async (req, res) => {
    try {
      const user = req.user as any;
      const eventId = parseInt(req.params.id);
      
      // Get user's attendance record
      const attendee = await storage.getEventAttendee(eventId, user.id);
      if (!attendee) {
        return res.status(404).json({ 
          message: "No estás registrado en este evento",
          status: null
        });
      }
      
      // Return status
      res.json({ 
        status: attendee.status,
        paymentStatus: attendee.paymentStatus
      });
    } catch (error) {
      console.error("Error checking event status:", error);
      res.status(500).json({ message: "Error del servidor" });
    }
  });

  // Simplified payment routes - all events are free
  app.post("/api/payment/confirm", isAuthenticated, async (req, res) => {
    try {
      const user = req.user as any;
      const { eventId } = req.body;
      
      // Check if the event exists
      const event = await storage.getEventById(parseInt(eventId));
      if (!event) {
        return res.status(404).json({ message: "Event not found" });
      }
      
      // Automatically join the event as free
      try {
        // Update the attendee record
        const updatedAttendee = await storage.updatePaymentStatus(
          parseInt(eventId),
          user.id,
          'free',
          ""
        );
        
        res.json(updatedAttendee);
      } catch (error) {
        console.error("Error updating event status:", error);
        res.status(500).json({ message: "Error updating event attendance" });
      }
    } catch (error) {
      console.error("Error joining event:", error);
      res.status(500).json({ message: "Error joining event" });
    }
  });

  // User events routes
  app.get("/api/user/events/created", isAuthenticated, async (req, res) => {
    try {
      const user = req.user as any;
      const events = await storage.getUserCreatedEvents(user.id);
      res.json(events);
    } catch (error) {
      console.error("Error fetching created events:", error);
      res.status(500).json({ message: "Error fetching created events" });
    }
  });

  app.get("/api/user/events/attending", isAuthenticated, async (req, res) => {
    try {
      const user = req.user as any;
      const events = await storage.getUserAttendingEvents(user.id);
      res.json(events);
    } catch (error) {
      console.error("Error fetching attending events:", error);
      res.status(500).json({ message: "Error fetching attending events" });
    }
  });

  // Simplified payment intent route - all events are free
  app.post("/api/create-payment-intent", isAuthenticated, async (req, res) => {
    try {      
      const { eventId } = req.body;
      const user = req.user as any;
      
      // Get the event details
      const event = await storage.getEventById(parseInt(eventId));
      if (!event) {
        return res.status(404).json({ message: "Event not found" });
      }
      
      // Automatically join the event as a free event
      try {
        await storage.joinEvent({
          eventId: parseInt(eventId),
          userId: user.id,
          paymentStatus: "free",
          paymentIntentId: ""
        });
        
        // Return a fake client secret to keep the client logic working
        res.json({ 
          clientSecret: "free_event_no_payment_required",
          message: "Joined event successfully" 
        });
      } catch (error) {
        console.error("Error joining event:", error);
        res.status(500).json({ message: "Error joining event" });
      }
    } catch (error) {
      console.error("Error handling free event join:", error);
      res.status(500).json({ message: "Server error" });
    }
  });

  const httpServer = createServer(app);
  
  // Initialize WebSocket server on a different path to avoid conflict with Vite HMR
  const wss = new WebSocketServer({ 
    server: httpServer, 
    path: '/ws' 
  });
  
  // Store active connections
  const clients = new Map<string, { ws: WebSocket, userId: number, userName: string }>();
  
  wss.on('connection', (ws) => {
    console.log('WebSocket connection established');
    
    // Generate client ID
    const clientId = Math.random().toString(36).substring(2, 15);
    
    // Handle messages
    ws.on('message', async (message) => {
      try {
        const data = JSON.parse(message.toString());
        
        // Handle authentication
        if (data.type === 'auth') {
          const { userId, userName } = data;
          clients.set(clientId, { ws, userId, userName });
          console.log(`Client authenticated: ${userName} (${userId})`);
          
          // Send confirmation to the client
          ws.send(JSON.stringify({
            type: 'auth_success',
            userId,
            userName
          }));
          
          return;
        }
        
        // Handle chat messages - only logged in users
        if (data.type === 'message' && clients.has(clientId)) {
          const { eventId, content } = data;
          const sender = clients.get(clientId)!;
          
          // Validate data
          if (!eventId || !content || content.trim() === '') {
            return;
          }
          
          const messageData = {
            type: 'message',
            eventId,
            userId: sender.userId,
            userName: sender.userName,
            content,
            timestamp: new Date().toISOString()
          };
          
          // Broadcast to all clients connected to the same event
          clients.forEach((client) => {
            if (client.ws.readyState === WebSocket.OPEN) {
              client.ws.send(JSON.stringify(messageData));
            }
          });
          
          return;
        }
      } catch (error) {
        console.error('Error processing WebSocket message:', error);
      }
    });
    
    // Handle disconnection
    ws.on('close', () => {
      clients.delete(clientId);
      console.log('WebSocket connection closed');
    });
    
    // Send initial message
    ws.send(JSON.stringify({ 
      type: 'connection_established',
      message: 'Successfully connected to Pipol chat server'
    }));
  });

  return httpServer;
}
