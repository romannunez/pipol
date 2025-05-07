import passport from "passport";
import { Strategy as LocalStrategy } from "passport-local";
import { Express, Request, Response, NextFunction } from "express";
import session from "express-session";
import bcrypt from "bcryptjs";
import { z } from "zod";
import connectPg from "connect-pg-simple";
import { pool } from "./db";
import { storage } from "./storage";
import { type User as SchemaUser } from "@shared/schema";

// Make TypeScript aware of the user object in Express
declare global {
  namespace Express {
    interface User extends Omit<SchemaUser, 'password'> {}
  }
}

// Create a session store connected to our PostgreSQL database
const PostgresSessionStore = connectPg(session);

export function setupAuth(app: Express) {
  console.log("Setting up authentication...");

  // Trust first proxy - needed for secure cookies behind a proxy/load balancer
  app.set("trust proxy", 1);
  
  // Configure express-session with secure settings
  const sessionOptions: session.SessionOptions = {
    secret: process.env.SESSION_SECRET || "pipol-app-secret-default-key",
    resave: false,
    saveUninitialized: false,
    store: new PostgresSessionStore({ 
      pool, 
      createTableIfMissing: true, // Create table if it doesn't exist
      tableName: 'session',
    }),
    cookie: {
      httpOnly: true,       // Prevents client-side JS from reading the cookie
      secure: false,        // Set to true in production with HTTPS
      sameSite: 'lax',      // Helps prevent CSRF attacks
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days in milliseconds
      path: '/',
    },
  };
  
  // Initialize session middleware
  app.use(session(sessionOptions));

  // Initialize Passport and restore authentication state from session
  app.use(passport.initialize());
  app.use(passport.session());

  // Configure Passport to use a local strategy (username/password)
  passport.use(new LocalStrategy(
    // Configure to use email instead of username
    { usernameField: 'email', passwordField: 'password' },
    // Verify function
    async (email, password, done) => {
      try {
        // Attempt to find user by email
        const user = await storage.getUserByEmail(email);
        
        // If user not found, authentication fails
        if (!user) {
          console.log(`Login attempt failed: User with email ${email} not found`);
          return done(null, false, { message: 'Invalid email or password' });
        }
        
        // Compare provided password with stored hash
        const isPasswordValid = await bcrypt.compare(password, user.password);
        
        if (!isPasswordValid) {
          console.log(`Login attempt failed: Invalid password for ${email}`);
          return done(null, false, { message: 'Invalid email or password' });
        }
        
        // Password matches - remove password from user object before serializing
        const { password: _, ...safeUser } = user;
        console.log(`User ${email} authenticated successfully`);
        return done(null, safeUser);
      } catch (error) {
        console.error(`Authentication error:`, error);
        return done(error);
      }
    }
  ));

  // Serialize user to the session
  passport.serializeUser((user: Express.User, done) => {
    console.log(`Serializing user: ${user.id}`);
    done(null, user.id);
  });

  // Deserialize user from the session
  passport.deserializeUser(async (id: number, done) => {
    try {
      console.log(`Deserializing user: ${id}`);
      const user = await storage.getUserById(id);
      
      if (!user) {
        console.log(`Deserialization failed: User ${id} not found`);
        return done(null, false);
      }
      
      // Remove password before providing user data
      const { password: _, ...safeUser } = user;
      return done(null, safeUser);
    } catch (error) {
      console.error(`Deserialization error:`, error);
      return done(error);
    }
  });
  
  // Middleware to check if a user is authenticated
  app.use((req: Request, res: Response, next: NextFunction) => {
    // Log authentication status for debugging
    if (req.path.startsWith('/api/')) {
      console.log(`Auth check for ${req.method} ${req.path}: ${req.isAuthenticated() ? 'Authenticated' : 'Not authenticated'}`);
    }
    next();
  });
  
  console.log("Authentication setup complete");
}